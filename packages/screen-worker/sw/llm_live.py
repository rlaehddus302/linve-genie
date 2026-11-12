# 라이브 LLM 등록(사용자 2026-11-11: "라이브에서 지식판2로 등록", 2026-11-12: "정확도는 좋은데 3~5분은 너무 늦다 — 말하고 10초 안팎").
# 일꾼이 쓰는 transcript.jsonl·screen.jsonl을 1초마다 이어 읽어, 새 받아쓰기 줄이 들어올 때 묻는다(이벤트):
#   - 그 줄에 숫자·'번'·'만'·'천'·'원'이 있거나, 그 줄 동안 화면에 크게 보인 번호표가 앞 줄과 다르면 → 바로 최근 WINDOW초(기본 60초)의 줄을 묻는다
#   - 아무 이벤트 없이 SAFETY초(60초) 지나면 한 번 묻는다(안전망). 같은 줄로 두 번 묻지 않는다.
# 묻는 글은 끝난 방송 시험(sw.llm_b6, SCREEN=span)과 같은 줄 모양·화면 표시·닉네임 가림, 프롬프트 지식판2(regstt8k2), gpt-5.6-sol, 추론 low(LLM_REG_EFFORT).
# 동시에 묻는 것은 PAR개(기본 4)까지 — 다 차 있으면 들어온 줄을 들고 기다렸다가 자리가 나면 가장 새 줄로 묻는다.
# 보내기: 화면과 충돌하는 낮은 확신의 답을 제외하고 번호와 가격을 함께 적으면 그 번호를 바로 한 번 보낸다(첫 답의 가격·품종). 서버는 같은 번호를 다시 받아도 바꾸지 않는다(R-2).
#   (9방송에서 첫 답으로 보내도 가격 95.8% → 95.5%.) 방송이 끝나면 남은 줄을 한 번 더 묻고, 가격이 있는데 아직 안 보낸 번호를 보낸다.
# 기록(결과 폴더): llm_live.jsonl(물을 때마다 글·답·걸린 초·까닭), llm_상품.csv(끝날 때: 보낸 첫 답 값과 다수결 값), events.jsonl에 "LLM등록"
import collections
import concurrent.futures as cf
import csv
import json
import os
import re
import threading
import time

from . import llm_b4 as B
from . import llm_b6
from .screen import STABLE, Screen

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = os.path.join(HERE, "prompts", os.environ.get("LLM_REG_PROMPT", "sales_instruct_system_regstt8k2.txt"))
MODEL = os.environ.get("LLM_REG_MODEL", "gpt-5.6-sol")
EFFORT = os.environ.get("LLM_REG_EFFORT", "low")
WINDOW = float(os.environ.get("LLM_REG_WINDOW", 60))   # 물을 때 넣는 최근 줄의 길이(방송 초)
SAFETY = float(os.environ.get("LLM_REG_SAFETY", 60))   # 이벤트 없이 이만큼(방송 초) 지나면 한 번 묻는다
PAR = int(os.environ.get("LLM_REG_PAR", 4))            # 동시에 묻는 수(사용자 2026-11-12: 사용량보다 지연)
SCREEN_WAIT = 3.0                                      # 화면 읽기가 그 줄 끝까지 오기를 이만큼(실제 초)만 기다린다
CUE = re.compile(r"[0-9번만천원]")
CONF = {"high": 0.9, "medium": 0.7, "low": 0.5}
# 잘못 들은 번호 바로잡기 (D-SCR-06, 사용자 2026-11-12 "391을 392로 잘못 알아먹고 등록 … 화면 인식 통해서 392는 잘못된거라고 판정"):
# 보낸 번호 N이 그 말 5초 앞부터 화면에 한 번도 안 읽혔는데, 그동안 다른 번호표 M이 크게 FIX_FRAMES초 이상 보였고
# M을 아직 보내지 않았으면 서버에 N → M 번호 바꾸기를 묻는다(서버가 찜·M 상품 유무를 다시 보고 안전할 때만 바꾼다).
# 말한 뒤 FIX_MIN초까지는 기다리고(번호표를 늦게 드는 판매자), FIX_MAX초가 지나면 그 번호는 더 보지 않는다.
FIX_FRAMES = int(os.environ.get("LLM_FIX_FRAMES", 15))
FIX_MIN = float(os.environ.get("LLM_FIX_MIN", 20))
FIX_MAX = float(os.environ.get("LLM_FIX_MAX", 180))


def span_note(i, t, ends, cand, mains):
    """llm_b6 SCREEN=span과 같음: 줄 시작~끝 동안 크게 읽힌 번호(처음 나온 순서, 초 수) / 그다음 보인 번호 3개"""
    secs = range(int(t) - 1, int(ends[i]) + 2)
    big = collections.Counter(mains[x] for x in secs if mains.get(x) is not None)
    order = list(dict.fromkeys(mains[x] for x in secs if mains.get(x) is not None))
    other = collections.Counter(n for x in secs for n in set(cand.get(x, ())) if n not in big)
    parts = [f"{n} 크게 {big[n]}초" for n in order]
    rest = [str(n) for n, _ in other.most_common(3)]
    return (", ".join(parts) + (" / " + ", ".join(rest) if rest else "")) if parts or rest else "없음"


def main_tag(i, t, ends, mains):
    """그 줄 동안 가장 오래 크게 보인 번호표(없으면 None)"""
    c = collections.Counter(mains[x] for x in range(int(t) - 1, int(ends[i]) + 2) if mains.get(x) is not None)
    return c.most_common(1)[0][0] if c else None


def conflicting_tag(number, start, end, candidates, mains):
    """해당 발화 동안 후보 번호는 한 번도 안 보이고 다른 큰 표가 과반 시간 유지됐는가."""
    seconds = range(int(start), int(end) + 1)
    if any(number in candidates.get(sec, ()) for sec in seconds):
        return None
    counts = collections.Counter(mains[sec] for sec in seconds if mains.get(sec) is not None)
    if not counts:
        return None
    tag, frames = counts.most_common(1)[0]
    return tag if frames >= STABLE and frames * 2 > len(seconds) else None


class LlmRegister:
    def __init__(self, out, poster=None, video_id=None, emit=None, par=PAR):
        self.out = out
        self.poster, self.video_id = poster, video_id
        self.emit = emit or (lambda d: None)                 # events.jsonl에 쓰는 함수(일꾼 것)
        self.ex = cf.ThreadPoolExecutor(par)
        self.par = par
        self.flying = []                                     # [(마지막 줄 번호, L, 글, 물은 시각, 까닭, Future)]
        self.tr = []                                         # 받아쓰기 줄 [(시작, 끝, 글)] — 파일을 이어 읽음
        self.tr_pos = 0
        self.sc, self.sc_pos, self.screen_top = Screen(), 0, -1
        self.seen = {}                                       # 줄 번호 → 처음 읽은 시각(벽시계) — 늦음 재기
        self.checked = 0                                     # 이벤트를 본 줄 수
        self.want = None                                     # (줄 번호, 까닭) — 물어야 하는데 자리가 없어 기다리는 것
        self.asked_line = -1                                 # 마지막으로 물은 창의 끝 줄
        self.asked_t = None                                  # 마지막으로 물은 창의 끝(방송 초)
        self.prev_tag = None
        self.found = []                                      # LLM 줄 [{t, line, no, price, variety, confidence, why}]
        self.sent = {}                                       # 번호 → 보낸 상품(또는 안 보낸 까닭)
        self.last_evidence = {}
        self.watch = {}                                      # 보낸 번호 → 말한 줄 시작(방송 초) — 화면으로 맞는지 볼 것 (D-SCR-06)
        self.calls = 0
        self.log = open(os.path.join(out, "llm_live.jsonl"), "a", encoding="utf-8")
        self.lock = threading.Lock()

    # ---------- 입력: 일꾼이 쓰는 파일을 이어 읽는다 ----------
    def _read_more(self, name, pos):
        p = os.path.join(self.out, name)
        if not os.path.exists(p):
            return [], pos
        with open(p, "rb") as f:
            f.seek(pos)
            data = f.read()
        out, used = [], 0
        for line in data.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                break                                        # 쓰는 중인 마지막 줄
            used += len(line)
            try:
                out.append(json.loads(line.decode("utf-8")))
            except ValueError:
                pass
        return out, pos + used

    def _load(self):
        rows, self.tr_pos = self._read_more("transcript.jsonl", self.tr_pos)
        now = time.time()
        for d in rows:
            self.seen[len(self.tr)] = now
            self.tr.append((d["start_sec"], d["end_sec"], d["text"]))
        rows, self.sc_pos = self._read_more("screen.jsonl", self.sc_pos)
        for d in rows:
            self.sc.add(d["sec"], [tuple(z) for z in d["t"]])
            self.screen_top = max(self.screen_top, d["sec"])
        _, cand, mains = self.sc.build()
        return cand, mains

    def _ask(self, upto, cand, mains, why):
        """줄 upto까지, 그 줄 시작 앞 WINDOW초의 줄을 묻는다"""
        tr = self.tr
        ends = [e for _, e, _ in tr]
        end_t = tr[upto][0]
        L = [(i, t, x) for i, (t, _, x) in enumerate(tr[:upto + 1]) if end_t - WINDOW <= t]
        self.asked_line, self.asked_t = upto, end_t
        user = "\n".join(f"L{i} [{B.hms(t)}] (화면: {span_note(i, t, ends, cand, mains)}) {B.mask(x)}" for i, t, x in L)
        self.calls += 1
        self.flying.append((upto, L, user, time.time(), why, self.ex.submit(llm_b6.ask, user, SYS, MODEL, EFFORT)))

    # ---------- 일꾼이 1초마다 부른다 ----------
    def tick(self, final=False):
        cand, mains = self._load()
        tr = self.tr
        ends = [e for _, e, _ in tr]
        # 1) 새 줄에서 이벤트 찾기 — 화면 읽기가 그 줄 끝까지 왔거나 SCREEN_WAIT초 지난 줄만 본다
        while self.checked < len(tr):
            i = self.checked
            t, e, x = tr[i]
            if not final and self.screen_top < e and time.time() - self.seen.get(i, 0) < SCREEN_WAIT:
                break
            tag = main_tag(i, t, ends, mains)
            why = "숫자" if CUE.search(x) else ("번호표 바뀜" if tag is not None and tag != self.prev_tag else None)
            if tag is not None:
                self.prev_tag = tag
            if why is None and (self.asked_t is None or t - self.asked_t >= SAFETY):
                why = "안전망"
            if why and i > self.asked_line:
                self.want = (i, why)
            self.checked += 1
        if final and tr and self.asked_line < len(tr) - 1:
            self.want = (len(tr) - 1, "끝")
        # 2) 물을 것이 있고 자리가 있으면 가장 새 줄로 묻는다
        busy = len([f for f in self.flying if not f[5].done()])
        if self.want and busy < self.par:
            i, why = self.want
            self.want = None
            if i > self.asked_line:
                self._ask(i, cand, mains, why)
        # 3) 답이 온 것을 받아 번호+가격이 처음 나온 상품은 바로 보낸다
        for item in [f for f in self.flying if f[5].done() or final]:
            upto, L, user, asked_at, why, fut = item
            try:
                out = fut.result()
            except Exception as err:                         # codex 4번 실패: 이 창은 빈 답으로 두고 기록
                out = ""
                self.emit({"kind": "LLM등록오류", "upto": upto, "error": str(err)[:300]})
            self.flying.remove(item)
            rows = llm_b6.rows_of(out, L)
            self.log.write(json.dumps({"upto": upto, "why": why, "user": user, "answer": out, "at": time.strftime("%H:%M:%S"),
                                       "sec": round(time.time() - asked_at, 1)}, ensure_ascii=False) + "\n")
            self.log.flush()
            for r in sorted(rows, key=lambda r: r["t"]):
                if r["no"] is None:
                    continue
                start, end, _ = self.tr[r["line"]]
                tag = conflicting_tag(r["no"], start, end, cand, mains) if r["confidence"] == "low" else None
                if tag is not None:
                    self.emit({"kind": "LLM번호충돌보류", "no": r["no"], "screen_no": tag,
                               "line": r["line"], "start_sec": start, "price": r["price"]})
                    continue
                self.found.append(r)
                if r["price"]:
                    no = r["no"]
                    previous = self.last_evidence.get(no)
                    self.last_evidence[no] = max(r["t"], previous if previous is not None else r["t"])
                    new_scene = previous is not None and r["t"] - previous > WINDOW and r.get("confidence") == "high" and any(
                        mains.get(sec) == no for sec in range(int(start), int(end) + 1))
                    if no not in self.sent or new_scene:
                        self._send(r)

        self._check_numbers(cand, mains)

    def _check_numbers(self, cand, mains):
        """D-SCR-06: 보낸 번호가 화면에 안 보이고 다른 번호표만 오래 보이면 그 번호로 바꿔 달라고 서버에 묻는다"""
        now = self.screen_top
        for no, start in list(self.watch.items()):
            secs = range(int(start) - 5, int(now) + 1)
            if any(no in cand.get(x, ()) for x in secs) or now - start > FIX_MAX:
                del self.watch[no]                           # 화면에서 봤다(맞음) 또는 너무 오래됨
                continue
            if now - start < FIX_MIN:
                continue
            seen = collections.Counter(mains[x] for x in secs if mains.get(x) is not None and mains[x] != no)
            if not seen:
                continue
            tag, frames = seen.most_common(1)[0]
            if frames < FIX_FRAMES:
                continue
            # tag를 이미 보냈으면: 이 번호를 말한 뒤에 따로 등록한 것(같은 상품을 두 번호로 들음, 실방송 392 → 391)일 때만 이 번호를 지운다.
            # 앞서 등록한 상품의 번호표가 아직 보이는 것(다음 상품 번호를 먼저 말함)은 건드리지 않는다
            other = self.sent.get(tag)
            drop = other is not None
            if drop and not (other.get("sent") and "fixed_from" not in other and other.get("start_sec", -1) >= start - 5):
                continue
            del self.watch[no]
            rec = {"kind": "LLM번호바로잡기", "from": no, "to": tag, "drop": drop, "frames": frames, "start_sec": start, "sent": bool(self.poster)}
            self.emit(rec)
            print(f"           번호 바로잡기 {no}번 → {tag}번{' (지움)' if drop else ''} (화면에 {no}번은 안 보이고 {tag}번이 {frames}초)", flush=True)
            if self.poster:
                self.poster.renumber(self.video_id, no, tag, drop=drop)
            # 잘못 들은 번호는 보낸 것으로 남겨 같은 말을 다시 받아도 또 등록하지 않는다(화면에 그 번호가 보이면 new_scene으로만)
            if not drop:
                self.sent[tag] = dict(self.sent.get(no, {}), no=tag, fixed_from=no)
            self.sent[no] = dict(self.sent.get(no, {}), fixed_to=tag)

    def finish(self):
        """방송 끝: 남은 줄을 한 번 더 묻고 답을 다 받은 뒤, 가격이 있는데 아직 안 보낸 번호를 보낸다"""
        self.tick(final=True)
        while self.flying or self.want:
            time.sleep(1)
            self.tick(final=True)
        self.ex.shutdown(wait=True)
        for g in self.products():
            if g["no"] not in self.sent:
                self._send({"no": g["no"], "price": g["price"], "variety": g["variety"], "t": g["t"], "line": g["lines"][0],
                            "confidence": (g["confs"] or [None])[0]})
        self._write_csv()

    # ---------- 묶기·보내기 ----------
    def products(self):
        """끝난 방송 시험과 같은 묶기(같은 번호 하나, 가격·품종 = 가장 많이 나온 것) — 기록·비교용"""
        by = {}
        for f in sorted(self.found, key=lambda f: f["t"]):
            if f["no"] is None:
                continue
            g = by.setdefault(f["no"], {"no": f["no"], "t": f["t"], "last": f["t"], "prices": [], "names": [], "confs": [], "lines": [], "n": 0})
            g["n"] += 1
            g["last"] = max(g["last"], f["t"])
            g["lines"].append(f["line"])
            if f["price"]:
                g["prices"].append(f["price"])
            if f["variety"]:
                g["names"].append(f["variety"])
            if f.get("confidence"):
                g["confs"].append(f["confidence"])
        for g in by.values():
            g["price"] = collections.Counter(g["prices"]).most_common(1)[0][0] if g["prices"] else None
            g["variety"] = collections.Counter(g["names"]).most_common(1)[0][0] if g["names"] else None
        return sorted(by.values(), key=lambda g: g["t"])

    def _heard(self, lines):
        want = set(lines)
        return " ".join(dict.fromkeys(B.mask(x) for i, (_, _, x) in enumerate(self.tr) if i in want))

    def _send(self, r):
        """r = LLM 줄 하나(번호·가격이 있는 첫 답) — 품종이 비었으면 이미 받은 줄에서 그 번호의 품종을 찾는다"""
        no, price, name = r["no"], r["price"], r["variety"]
        if not name:
            name = next((f["variety"] for f in reversed(self.found) if f["no"] == no and abs(f["t"] - r["t"]) <= WINDOW and f["variety"]), None)
        conf = CONF.get(str(r.get("confidence")).lower(), 0.7)
        lines = [f["line"] for f in self.found if f["no"] == no and abs(f["t"] - r["t"]) <= WINDOW] or [r["line"]]
        now = time.time()
        line = r["line"]
        rec = {"kind": "LLM등록", "no": no, "start_sec": r["t"], "start_hms": B.hms(r["t"]), "price": price, "name": name, "conf": conf,
               "line": line, "line_end_sec": self.tr[line][1] if line is not None and line < len(self.tr) else None,
               "line_seen_wall": round(self.seen.get(line, now), 2), "sent_wall": round(now, 2), "wait_sec": round(now - self.seen.get(line, now), 1)}
        why = None
        if price is None:
            why = "금액 모름"
        elif self.poster:
            from . import post
            body = post.make_body(self.video_id, no, price, name or "", self._heard(lines), conf)
            if body is not None:
                observed = int(self.seen.get(line, now) * 1000)
                body.update(observedAt=observed, requestId=f"screen-{self.video_id}-{no}-{observed}")
            if body is None:
                why = "보낼 수 없는 값"
            else:
                self.poster.send(body)
        rec["sent"] = bool(self.poster) and why is None
        if rec["sent"]:
            self.watch[no] = r["t"]
        if why:
            rec["skip"] = why
        self.sent[no] = rec
        self.emit(rec)
        won = f"{price:,}원" if price else "금액 모름"
        print(f"           LLM등록 {no:>4}번  {won}  {name or '품종 모름'}  (줄을 읽고 {rec['wait_sec']}초)"
              + ("  → 서버로" if rec["sent"] else (f"  (보내지 않음: {why})" if why else "")), flush=True)

    def _write_csv(self):
        with open(os.path.join(self.out, "llm_상품.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["번호", "처음 시각", "보낸 가격(첫 답)", "보낸 상품명", "다수결 가격", "다수결 상품명", "LLM이 적은 줄 수", "서버로 보냄", "안 보낸 까닭", "줄 읽고 보내기까지(초)"])
            for g in self.products():
                r = self.sent.get(g["no"], {})
                w.writerow([g["no"], B.hms(g["t"]), r.get("price"), r.get("name"), g["price"], g["variety"], g["n"],
                            "O" if r.get("sent") else "", r.get("skip", ""), r.get("wait_sec", "")])
        print(f"           LLM등록 끝: 물은 횟수 {self.calls}", flush=True)
