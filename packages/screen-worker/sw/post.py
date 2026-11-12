# 라이브지니 서버로 확정 상품 보내기 (D-SCR-01 입구 `POST /internal/screen/register`). 표준 라이브러리만 쓴다.
#  - 보내기는 뒤 스레드에서: 화면·소리 처리를 절대 막지 않는다.
#  - 다시 보내기: 404(방송이 아직 이어지지 않음)·409(이어진 방송이 여럿)·401(토큰)·429·5xx·네트워크 오류는
#    처음 넣은 뒤 10분까지 점점 길게 기다리며 다시. 400 등 나머지는 버리고 기록만.
#  - requestId는 영상·번호마다 하나(screen-<영상>-<번호>)라 몇 번을 다시 보내도 서버는 한 번만 등록한다.
#  - 토큰은 파일에서 읽고(보낼 때마다 다시 읽어 바뀐 토큰도 반영) 화면·기록 어디에도 쓰지 않는다.
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


def make_body(vid, no, price, name=None, heard=None, conf=None):
    """서버가 받는 열쇠만으로. 금액이 없으면 None(보내지 않음)"""
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
    return body


class Poster:
    """확정 상품을 뒤 스레드에서 서버로 보낸다. send()는 바로 돌아온다"""

    def __init__(self, server, token_file, log_path=None, retry_for=RETRY_FOR, backoff=(5, 10, 20, 40, 60)):
        self.url = server.rstrip("/") + "/internal/screen/register"
        self.token_file = token_file
        self.retry_for = retry_for
        self.backoff = backoff
        self.items = []                # [{body, first, tries, next}]
        self.busy = 0
        self.cv = threading.Condition()
        self.closed = False
        self.logf = open(log_path, "a", encoding="utf-8") if log_path else None
        self.th = threading.Thread(target=self._loop, name="poster", daemon=True)
        self.th.start()

    def _record(self, body, result, status, code=None):
        if self.logf:
            self.logf.write(json.dumps({"at": stamp(), "no": body["no"], "price": body["price"], "requestId": body["requestId"],
                                        "result": result, "status": status, "code": code}, ensure_ascii=False) + "\n")
            self.logf.flush()

    def send(self, body):
        now = time.time()
        with self.cv:
            self.items.append({"body": body, "first": now, "tries": 0, "next": now})
            self.cv.notify()

    def renumber(self, vid, frm, to, drop=False):
        """잘못 들은 번호 바로잡기(D-SCR-06): from → to를 뒤 스레드에서 한 번 보낸다(네트워크 오류면 3번까지). 서버가 지금 상태로 다시 보고 안전할 때만 바꾼다"""
        base = self.url.rsplit("/", 1)[0]
        body = {"videoId": vid, "from": int(frm), "to": int(to), "requestId": f"screen-{vid}-fix-{int(frm)}-{int(to)}"}
        if drop:
            body["drop"] = True                              # to를 뒤에 따로 등록함 — 서버가 from을 지운다(찜 없을 때만)

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
        it["tries"] += 1
        try:
            token = read_token(self.token_file)
        except (OSError, ValueError) as e:
            status, res = None, f"토큰 파일을 못 읽음({type(e).__name__})"
        else:
            status, res = http_json("POST", self.url, token, b)
        code = (res.get("error") or {}).get("code") if isinstance(res, dict) else None
        won = f"{b['price']:,}원"
        if status == 200 and isinstance(res, dict) and res.get("ok"):
            what = "이미 받은 것" if res.get("duplicate") else ("등록됨" if res.get("changed") else "이미 있는 번호라 그대로")
            log(f"서버 보냄  {b['no']:>4}번 {won} → {what}")
            self._record(b, "ok", status, "duplicate" if res.get("duplicate") else ("changed" if res.get("changed") else "unchanged"))
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
