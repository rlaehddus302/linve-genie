# 라이브지니 서버로 확정 상품 보내기 (D-SCR-01 입구 `POST /internal/screen/register`). 표준 라이브러리만 쓴다.
#  - 보내기는 뒤 스레드에서: 화면·소리 처리를 절대 막지 않는다.
#  - 다시 보내기: 404(방송이 아직 이어지지 않음)·409(이어진 방송이 여럿)·401(토큰)·429·5xx·네트워크 오류는
#    처음 넣은 뒤 10분까지 점점 길게 기다리며 다시. 400 등 나머지는 버리고 기록만.
#  - requestId는 영상·번호마다 하나(screen-<영상>-<번호>)라 몇 번을 다시 보내도 서버는 한 번만 등록한다.
#  - 토큰은 파일에서 읽고(보낼 때마다 다시 읽어 바뀐 토큰도 반영) 화면·기록 어디에도 쓰지 않는다.
#  - 서버 능력 묻기 (E11·D-RETRO-32, D-SCR-18): 켜질 때와 CAPS_EVERY초마다 `GET /internal/screen/capabilities`를 물어 서버가 받는 입구·항목만 쓴다.
#    그 입구가 없으면(옛 서버, 404) 지금까지 하던 대로 보낸다. 임시 등록(`tentative`)·확정·거두기는 서버가 셋 다 받을 때만 쓴다(tentative_ok).
#    같은 때 `GET /internal/screen/live`에서 이 영상의 가격 단위(priceUnit)도 읽어 둔다(price_unit).
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
VIDEO_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
RETRY_FOR = 600          # 처음 넣은 뒤 이만큼(초)까지 다시 보낸다
NAME_MAX, HEARD_MAX = 60, 300
RETRYABLE = {401, 404, 408, 409, 425, 429}
CAPS_EVERY = float(os.environ.get("LG_SCREEN_CAPS_EVERY", 300))   # 서버 능력·가격 단위를 다시 묻는 간격(초)
CAPS_RETRY = 30                                                   # 서버에 닿지 못했으면 이만큼(초) 뒤 다시
OPTIONAL = frozenset({"heard", "conf", "observedAt"})             # 서버가 모르면 빼고 보내도 뜻이 바뀌지 않는 항목(그 밖의 모르는 항목이 있으면 그 요청은 보내지 않는다)
PRICE_UNITS = frozenset({"WON", "THOUSAND", "TEN_THOUSAND", "AUTO"})
REASON_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,31}$")
REASONS_MAX, CANDIDATES_MAX = 6, 4


def stamp():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")


def log(msg):
    print(f"[{stamp()}] {msg}", flush=True)


def video_id(src):
    """유튜브 주소(watch?v= · youtu.be/ · /live/ · /shorts/ · /embed/) 또는 영상 번호 11자 → 영상 번호. 못 찾으면 None"""
    if not src:
        return None
    if VIDEO_RE.match(src):
        return src
    try:
        u = urllib.parse.urlparse(src)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if host.endswith("youtu.be"):
        cand = u.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        q = urllib.parse.parse_qs(u.query).get("v")
        if q:
            cand = q[0]
        else:
            parts = [p for p in u.path.split("/") if p]
            cand = parts[1] if len(parts) >= 2 and parts[0] in ("live", "shorts", "embed", "v") else ""
    else:
        return None
    return cand if VIDEO_RE.match(cand) else None


def read_token(path):
    with open(path, encoding="utf-8") as f:
        tok = f.read().strip()
    if not tok:
        raise ValueError("토큰 파일이 비어 있어요")
    return tok


def token_path(arg):
    p = arg or os.environ.get("LG_SCREEN_TOKEN_FILE")
    if not p:
        raise SystemExit("토큰 파일이 필요해요: --token-file 경로 또는 환경변수 LG_SCREEN_TOKEN_FILE")
    p = os.path.expanduser(p)
    try:
        read_token(p)   # 처음에 한 번 확인(없거나 비면 바로 멈춤)
    except (OSError, ValueError) as e:
        raise SystemExit(f"토큰 파일을 못 읽어요: {p} ({type(e).__name__})")
    return p


def http_json(method, url, token, body=None, timeout=15):
    """→ (상태 코드, JSON 또는 None). 네트워크 오류는 (None, 오류 글)"""
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "livegenie-screen-worker")
    if data is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    except (urllib.error.URLError, OSError, ValueError) as e:
        return None, str(getattr(e, "reason", e))[:200]
    try:
        return status, json.loads(raw.decode("utf-8")) if raw else None
    except (ValueError, UnicodeDecodeError):
        return status, None


def make_tentative(reasons, nos=(), prices=(), names=()):
    """임시 등록 칸 { reasons, candidates } — 서버(코어)가 받는 모양으로 다듬는다: 까닭 낱말 1~6개, 후보는 칸마다 4개까지, 겹치지 않게.
    닉네임·채팅 글은 넣지 않는다(부르는 쪽이 번호·금액·품종만 준다). 까닭이 하나도 없으면 None"""
    rs = [r for r in dict.fromkeys(reasons) if isinstance(r, str) and REASON_RE.match(r)][:REASONS_MAX]
    if not rs:
        return None
    whole = lambda v: isinstance(v, int) and not isinstance(v, bool)
    no_list = [n for n in dict.fromkeys(nos) if whole(n) and 1 <= n <= 9999][:CANDIDATES_MAX]
    price_list = [p for p in dict.fromkeys(prices) if whole(p) and 0 <= p <= 100_000_000][:CANDIDATES_MAX]
    name_list = list(dict.fromkeys(" ".join(str(n).split())[:NAME_MAX] for n in names if n and str(n).strip()))[:CANDIDATES_MAX]
    return {"reasons": rs, "candidates": {"no": no_list, "price": price_list, "name": name_list}}


def make_body(vid, no, price, name=None, heard=None, conf=None, tentative=None):
    """서버가 받는 열쇠만으로. 금액이 없으면 None(보내지 않음). tentative = make_tentative의 값(임시 등록 — 서버가 받을 때만 보낸다)"""
    if price is None or not isinstance(no, int) or not 1 <= no <= 9999:
        return None
    price = int(price)
    if not 0 <= price <= 100_000_000:
        return None
    body = {"videoId": vid, "no": no, "price": price, "requestId": f"screen-{vid}-{no}"}
    if name:
        body["name"] = str(name)[:NAME_MAX]
    if heard:
        body["heard"] = " ".join(str(heard).split())[:HEARD_MAX]
    if conf is not None:
        body["conf"] = round(min(1.0, max(0.0, float(conf))), 3)
    if tentative:
        body["tentative"] = tentative
    return body


class Poster:
    """확정 상품을 뒤 스레드에서 서버로 보낸다. send()는 바로 돌아온다"""

    def __init__(self, server, token_file, log_path=None, retry_for=RETRY_FOR, backoff=(5, 10, 20, 40, 60), video_id=None, ask=True):
        self.base = server.rstrip("/") + "/internal/screen"
        self.url = self.base + "/register"
        self.token_file = token_file
        self.video_id = video_id
        self.caps = None               # 서버가 받는 입구 → 항목 집합. None = 모름(옛 서버이거나 아직 못 물음) — 지금까지 하던 대로 보낸다
        self.caps_note = None          # 마지막으로 화면에 적은 능력 상태(바뀔 때만 적는다)
        self.price_unit = None         # 서버가 알려 준 이 영상의 가격 단위(WON·THOUSAND·TEN_THOUSAND·AUTO), 모르면 None
        self.retry_for = retry_for
        self.backoff = backoff
        self.items = []                # [{body, first, tries, next}]
        self.busy = 0
        self.cv = threading.Condition()
        self.closed = False
        self.logf = open(log_path, "a", encoding="utf-8") if log_path else None
        self.th = threading.Thread(target=self._loop, name="poster", daemon=True)
        self.th.start()
        if ask:                        # 한 번은 바로 묻고(일꾼이 첫 등록 전에 알게), 그 뒤로는 뒤 스레드가 주기적으로
            ok = self.refresh()
            threading.Thread(target=self._watch, args=(ok,), name="capabilities", daemon=True).start()

    # ---------- 서버 능력 (E11) ----------
    def refresh(self):
        """서버가 받는 입구·항목과 이 영상의 가격 단위를 묻는다 → 서버에 닿았나. 닿지 못하면 지난 답을 그대로 둔다"""
        try:
            token = read_token(self.token_file)
        except (OSError, ValueError):
            return False
        status, res = http_json("GET", self.base + "/capabilities", token, timeout=5)
        reached = status is not None and status < 500 and status not in (401, 408, 425, 429)
        endpoints = res.get("endpoints") if status == 200 and isinstance(res, dict) else None
        if isinstance(endpoints, dict):
            self.caps = {str(name): frozenset(f for f in (d.get("fields") or ()) if isinstance(f, str))
                         for name, d in endpoints.items() if isinstance(d, dict)}
            note = "임시 등록·확정·거두기를 받는 서버" if self.tentative_ok() else "임시 등록을 받지 않는 서버 — 지금 방식으로 등록"
        elif reached:
            self.caps = None           # 이 입구가 없는 옛 서버(404 등)
            note = f"서버 능력 묻기 입구가 없는 서버(HTTP {status}) — 지금 방식으로 등록"
        else:
            note = "서버 능력을 아직 못 물음 — 알 때까지 지금 방식으로 등록" if self.caps is None else self.caps_note
        if note != self.caps_note:
            self.caps_note = note
            log(note)
        if not reached:
            return False
        if self.video_id:
            status, res = http_json("GET", self.base + "/live", token, timeout=5)
            if status == 200 and isinstance(res, dict) and isinstance(res.get("videos"), list):
                for v in res["videos"]:
                    if isinstance(v, dict) and v.get("videoId") == self.video_id:
                        unit = v.get("priceUnit")
                        self.price_unit = unit if unit in PRICE_UNITS else None
        return True

    def _watch(self, ok):
        while not self.closed:
            end = time.time() + (CAPS_EVERY if ok else CAPS_RETRY)
            while time.time() < end and not self.closed:
                time.sleep(min(1.0, max(0.05, end - time.time())))
            if not self.closed:
                ok = self.refresh()

    def supports(self, endpoint, *fields):
        """서버가 이 입구(와 항목들)를 받는다고 알려 줬나. 모르면 False"""
        caps = self.caps
        return caps is not None and endpoint in caps and all(f in caps[endpoint] for f in fields)

    def tentative_ok(self):
        """임시 등록 흐름을 써도 되나: 등록의 tentative 항목과 확정·거두기 입구를 서버가 모두 받는다(계약서 2절)"""
        return self.supports("register", "tentative") and self.supports("confirm", "registerRequestId") and self.supports("withdraw", "registerRequestId")

    def _fit(self, endpoint, body):
        """서버가 받는 항목만 남긴 본문. 입구가 없거나, 빼면 뜻이 바뀌는 항목을 서버가 모르면 None(보내지 않는다).
        서버 능력을 모르면(옛 서버) 지금까지 보내던 것은 그대로 보내고, 새 입구(확정·거두기)와 임시 등록은 보내지 않는다 — 임시 등록이 확인 없는 등록으로 바뀌면 안 된다"""
        caps = self.caps
        if caps is None:
            return None if endpoint in ("confirm", "withdraw") or "tentative" in body else body
        if endpoint not in caps:
            return None
        unknown = [k for k in body if k not in caps[endpoint]]
        if any(k not in OPTIONAL for k in unknown):
            return None
        return {k: v for k, v in body.items() if k not in unknown} if unknown else body

    def _record(self, body, result, status, code=None):
        if self.logf:
            self.logf.write(json.dumps({"at": stamp(), "no": body["no"], "price": body["price"], "requestId": body["requestId"],
                                        "result": result, "status": status, "code": code}, ensure_ascii=False) + "\n")
            self.logf.flush()

    def send(self, body, on_result=None):
        """on_result(서버 응답 dict) — 끝났을 때 뒤 스레드에서 한 번 부른다. 못 보냈으면 {"ok": False, "error": 까닭}"""
        now = time.time()
        with self.cv:
            self.items.append({"body": body, "first": now, "tries": 0, "next": now, "cb": on_result})
            self.cv.notify()

    def renumber(self, vid, frm, to, rid, drop=False):
        """잘못 들은 번호 바로잡기(D-SCR-06): from → to를 뒤 스레드에서 한 번 보낸다(네트워크 오류면 3번까지). 서버가 지금 상태로 다시 보고 안전할 때만 바꾼다"""
        base = self.url.rsplit("/", 1)[0]
        # rid = 이 일꾼이 frm을 등록한 요청 번호 — 서버는 그 등록이 만든 상품일 때만 바꾼다(D-SCR-10: 다시 켠 일꾼이 옛 429를 371로 옮김)
        body = {"videoId": vid, "from": int(frm), "to": int(to), "requestId": f"screen-{vid}-fix-{int(frm)}-{int(to)}", "registerRequestId": rid}
        if drop:
            body["drop"] = True                              # to를 뒤에 따로 등록함 — 서버가 from을 지운다(찜 없을 때만)
        body = self._fit("renumber", body)
        if body is None:
            log(f"번호 바로잡기 {frm}→{to} → 서버가 아직 받지 않는 요청이라 보내지 않음")
            return

        def go():
            for wait in (0, 5, 15):
                time.sleep(wait)
                try:
                    token = read_token(self.token_file)
                except (OSError, ValueError) as e:
                    log(f"번호 바로잡기 {frm}→{to} → 토큰 파일을 못 읽음({type(e).__name__})")
                    return
                status, res = http_json("POST", base + "/renumber", token, body)
                if status == 200 and isinstance(res, dict):
                    skips = [r.get("skip") for r in res.get("broadcasts", []) if r.get("skip")]
                    log(f"번호 바로잡기 {frm}번 → {to}번: " + (("지움" if drop else "바꿈") if res.get("changed") else f"그대로({', '.join(skips) or '바뀐 것 없음'})"))
                    if self.logf:
                        self.logf.write(json.dumps({"at": stamp(), "fix": [frm, to], "result": res}, ensure_ascii=False) + "\n")
                        self.logf.flush()
                    return
                if status is not None and status < 500:
                    log(f"번호 바로잡기 {frm}→{to} → 거절(HTTP {status})")
                    return
            log(f"번호 바로잡기 {frm}→{to} → 서버에 못 보냄")

        threading.Thread(target=go, name="renumber", daemon=True).start()

    def rename(self, vid, no, name, n):
        """품종 이름 고치기(D-SCR-07): 서버가 일꾼 등록이고 판매자가 이름을 고친 적 없을 때만 바꾼다. n = 이 번호의 몇 번째 고침(요청 번호용)"""
        body = {"videoId": vid, "no": int(no), "name": str(name)[:NAME_MAX], "requestId": f"screen-{vid}-name-{int(no)}-{int(n)}"}
        self._fix("rename", body, f"이름 고치기 {no}번 → {name}")

    def reprice(self, vid, no, price, n):
        """금액 고치기(D-SCR-09): 같은 번호를 다른 금액으로 다시 내놓았을 때. 판매자가 금액을 고친 적 없을 때만 서버가 바꾼다"""
        body = {"videoId": vid, "no": int(no), "price": int(price), "requestId": f"screen-{vid}-price-{int(no)}-{int(n)}"}
        self._fix("reprice", body, f"금액 고치기 {no}번 → {int(price):,}원")

    def confirm(self, vid, no, rid, to=None, price=None, name=None, n=1, on_result=None):
        """임시 등록 확정(계약서 2.2): rid = 그 임시 등록의 요청 번호. to·price·name은 적은 것만 바꾼다. 서버가 방송마다 지금 상태로 다시 보고
        판매자가 먼저 확정·수정한 것은 그대로 둔다(skip·kept). on_result(응답)로 결과를 돌려준다"""
        body = {"videoId": vid, "no": int(no), "registerRequestId": rid, "requestId": f"screen-{vid}-ok-{int(no)}-{n}"}
        if to is not None and int(to) != int(no):
            body["to"] = int(to)
        if price is not None:
            body["price"] = int(price)
        if name:
            body["name"] = str(name)[:NAME_MAX]
        self._fix("confirm", body, f"확정 {no}번" + (f" → {to}번" if "to" in body else ""), on_result, done="확정함", record="confirm")

    def withdraw(self, vid, no, rid, n=1, on_result=None):
        """임시 등록 거두기(계약서 2.3): 판매자가 손댄 상품은 서버가 거두지 않는다(SELLER_EDITED)"""
        body = {"videoId": vid, "no": int(no), "registerRequestId": rid, "requestId": f"screen-{vid}-no-{int(no)}-{n}"}
        self._fix("withdraw", body, f"임시 등록 거두기 {no}번", on_result, done="거둠", record="withdraw")

    def _fix(self, path, body, label, on_result=None, done="바꿈", record=None):
        tell = on_result or (lambda res: None)
        fitted = self._fit(path, body)
        if fitted is None:
            log(f"{label} → 서버가 아직 받지 않는 요청이라 보내지 않음")
            tell({"ok": False, "error": "UNSUPPORTED"})
            return
        body = fitted

        def go():
            why = "서버에 못 보냄"
            for wait in (0, 5, 15):
                time.sleep(wait)
                try:
                    token = read_token(self.token_file)
                except (OSError, ValueError) as e:
                    why = f"토큰 파일을 못 읽음({type(e).__name__})"
                    break
                status, res = http_json("POST", self.base + "/" + path, token, body)
                if status == 200 and isinstance(res, dict):
                    rows = [r for r in res.get("broadcasts") or [] if isinstance(r, dict)]
                    skips = [r.get("skip") for r in rows if r.get("skip")]
                    kept = sorted({k for r in rows for k in (r.get("kept") or ())})
                    log(f"{label}: " + (done if res.get("changed") else f"그대로({', '.join(skips) or '바뀐 것 없음'})") + (f" · 판매자 값을 둔 칸: {', '.join(kept)}" if kept else ""))
                    if record and self.logf:
                        self.logf.write(json.dumps({"at": stamp(), record: body["no"], "requestId": body["requestId"], "result": res}, ensure_ascii=False) + "\n")
                        self.logf.flush()
                    tell(res)
                    return
                if status is not None and status < 500:
                    why = f"거절(HTTP {status})"
                    break
            log(f"{label} → {why}")
            tell({"ok": False, "error": why})

        threading.Thread(target=go, name=path, daemon=True).start()

    def pending(self):
        with self.cv:
            return len(self.items) + self.busy

    def close(self, timeout=30):
        """남은 것을 timeout초까지 기다렸다가 멈춘다. 다 못 보낸 수를 돌려준다"""
        end = time.time() + timeout
        while self.pending() and time.time() < end:
            time.sleep(0.2)
        left = self.pending()
        with self.cv:
            self.closed = True
            self.cv.notify()
        if left:
            log(f"서버로 못 보낸 상품 {left}개를 남기고 멈춰요")
        return left

    def _loop(self):
        while True:
            with self.cv:
                while not self.closed:
                    now = time.time()
                    due = [it for it in self.items if it["next"] <= now]
                    if due:
                        break
                    wait = min((it["next"] for it in self.items), default=now + 60) - now
                    self.cv.wait(timeout=max(0.05, wait))
                if self.closed:
                    return
                it = min(due, key=lambda x: x["next"])
                self.items.remove(it)
                self.busy += 1
            try:
                self._try(it)
            finally:
                with self.cv:
                    self.busy -= 1

    def _try(self, it):
        b = it["body"]
        tell = it.get("cb") or (lambda res: None)
        it["tries"] += 1
        won = f"{b['price']:,}원"
        fitted = self._fit("register", b)
        if fitted is None:
            # 임시 등록을 받지 않는 서버가 됐다(되돌림) — 확인 없는 등록으로 바꿔 보내지 않는다. 일꾼이 근거를 다 모은 뒤 지금 방식으로 보낸다
            log(f"서버 보냄  {b['no']:>4}번 {won} → 서버가 아직 받지 않는 요청이라 보내지 않음")
            self._record(b, "dropped", None, "UNSUPPORTED")
            tell({"ok": False, "error": "UNSUPPORTED"})
            return
        try:
            token = read_token(self.token_file)
        except (OSError, ValueError) as e:
            status, res = None, f"토큰 파일을 못 읽음({type(e).__name__})"
        else:
            status, res = http_json("POST", self.url, token, fitted)
        code = (res.get("error") or {}).get("code") if isinstance(res, dict) else None
        if status == 200 and isinstance(res, dict) and res.get("ok"):
            new = "임시로 올림(확인 중)" if res.get("tentative") else "등록됨"
            what = "이미 받은 것" if res.get("duplicate") else (new if res.get("changed") else "이미 있는 번호라 그대로")
            log(f"서버 보냄  {b['no']:>4}번 {won} → {what}")
            self._record(b, "ok", status, "duplicate" if res.get("duplicate") else (("tentative" if res.get("tentative") else "changed") if res.get("changed") else "unchanged"))
            tell(res)
            return
        why = code or (res if status is None else f"HTTP {status}")
        retry = status is None or status in RETRYABLE or status >= 500
        age = time.time() - it["first"]
        if retry and age < self.retry_for:
            wait = self.backoff[min(it["tries"] - 1, len(self.backoff) - 1)]
            it["next"] = time.time() + wait
            log(f"서버 보냄  {b['no']:>4}번 {won} → 다시 보낼 것({why}, {it['tries']}번째, {wait}초 뒤)")
            self._record(b, "retry", status, why)
            with self.cv:
                self.items.append(it)
                self.cv.notify()
            return
        log(f"서버 보냄  {b['no']:>4}번 {won} → 포기({why}{', 10분 넘음' if retry else ''})")
        self._record(b, "dropped", status, why)
        tell({"ok": False, "error": str(why)})
