# 라이브 LLM 등록(사용자 2026-11-11: "라이브에서 지식판2로 등록"): 일꾼이 쓰는 transcript.jsonl·screen.jsonl을 2분 조각(30초 겹침)으로
# 끊어, 조각이 다 차면 지식판2(sw/prompts/sales_instruct_system_regstt8k2.txt, gpt-5.6-sol medium)에 묻는다 — 끝난 방송 시험(sw.llm_b6, SCREEN=span)과 같은 입력·같은 묶기.
# 묶기(뒤처리 없음, llm_b6와 같음): 번호 없는 줄은 뺌 / 같은 번호는 상품 하나 / 가격·품종 = 그 번호에 적힌 것 중 가장 많이 나온 것(같으면 먼저 나온 것).
# 보내기: 서버는 같은 번호를 한 번만 받으므로(requestId = 영상+번호), 그 번호가 마지막으로 나온 뒤 한 조각(2분)+겹침(30초)이 더 지나도록
#   다시 안 나오면 '정해짐'으로 보고 한 번 보낸다. 방송이 끝나면 남은 것을 모두 보낸다. 가격이 없으면 보내지 않는다(서버는 금액 필수).
# 기록(결과 폴더): llm_live.jsonl(조각마다 물은 글·답), llm_상품.csv(끝날 때 상품별 결과·보냄 여부), events.jsonl에 "LLM등록"
import collections
import concurrent.futures as cf
import csv
import json
import os
import threading
import time

from . import llm_b4 as B
from . import llm_b6
from .screen import Screen

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = os.path.join(HERE, "prompts", os.environ.get("LLM_REG_PROMPT", "sales_instruct_system_regstt8k2.txt"))
MODEL = os.environ.get("LLM_REG_MODEL", "gpt-5.6-sol")
EFFORT = os.environ.get("LLM_REG_EFFORT", "medium")
CHUNK, OVERLAP = B.CHUNK, B.OVERLAP   # 120초, 30초
SETTLE = CHUNK + OVERLAP              # 마지막으로 나온 뒤 이만큼(방송 초) 더 물어봤는데 안 나오면 정해짐
CONF = {"high": 0.9, "medium": 0.7, "low": 0.5}


def span_note(i, t, ends, cand, mains):
    """llm_b6 SCREEN=span과 같음: 줄 시작~끝 동안 크게 읽힌 번호(처음 나온 순서, 초 수) / 그다음 보인 번호 3개"""
    secs = range(int(t) - 1, int(ends[i]) + 2)
    big = collections.Counter(mains[x] for x in secs if mains.get(x) is not None)
    order = list(dict.fromkeys(mains[x] for x in secs if mains.get(x) is not None))
    other = collections.Counter(n for x in secs for n in set(cand.get(x, ())) if n not in big)
    parts = [f"{n} 크게 {big[n]}초" for n in order]
    rest = [str(n) for n, _ in other.most_common(3)]
    return (", ".join(parts) + (" / " + ", ".join(rest) if rest else "")) if parts or rest else "없음"


class LlmRegister:
    def __init__(self, out, poster=None, video_id=None, emit=None, par=2):
        self.out = out
        self.poster, self.video_id = poster, video_id
        self.emit = emit or (lambda d: None)                 # events.jsonl에 쓰는 함수(일꾼 것)
        self.ex = cf.ThreadPoolExecutor(par)
        self.asked = {}                                      # 조각 시작 초 → Future(답)
        self.answers = {}                                    # 조각 시작 초 → 답
        self.next_s = 0                                      # 다음에 물을 조각 시작 초
        self.done_upto = 0                                   # 이 시각(방송 초)까지 조각 답을 다 받음
        self.found = []                                      # LLM 줄 [{t, line, no, price, variety, confidence, why}]
        self.sent = {}                                       # 번호 → 보낸 상품(또는 안 보낸 까닭)
        self.log = open(os.path.join(out, "llm_live.jsonl"), "a", encoding="utf-8")
        self.lock = threading.Lock()

    # ---------- 입력: 일꾼이 쓰는 파일을 읽는다 ----------
    def _load(self):
        tr = []
        p = os.path.join(self.out, "transcript.jsonl")
        if os.path.exists(p):
            for l in open(p, encoding="utf-8"):
                try:
                    d = json.loads(l)
                except ValueError:
                    break                                    # 쓰는 중인 마지막 줄
                tr.append((d["start_sec"], d["end_sec"], d["text"]))
        sc = Screen()
        top = -1
        p = os.path.join(self.out, "screen.jsonl")
        if os.path.exists(p):
            for l in open(p, encoding="utf-8"):
                try:
                    d = json.loads(l)
                except ValueError:
                    break
                sc.add(d["sec"], [tuple(z) for z in d["t"]])
                top = max(top, d["sec"])
        _, cand, mains = sc.build()
        return tr, cand, mains, top

    # ---------- 일꾼이 TICK마다 부른다 ----------
    def tick(self, final=False):
        tr, cand, mains, screen_top = self._load()
        audio_top = tr[-1][0] if tr else 0
        ends = [e for _, e, _ in tr]
        # 1) 다 찬 조각을 묻는다: 받아쓰기·화면이 조각 끝(+5초)을 넘었을 때(끝날 때는 남은 것 모두)
        while tr and self.next_s <= audio_top and (final or (audio_top >= self.next_s + CHUNK and screen_top >= self.next_s + CHUNK + 5)):
            s = self.next_s
            L = [(i, t, x) for i, (t, _, x) in enumerate(tr) if s - OVERLAP <= t < s + CHUNK]
            if L:
                user = "\n".join(f"L{i} [{B.hms(t)}] (화면: {span_note(i, t, ends, cand, mains)}) {B.mask(x)}" for i, t, x in L)
                self.asked[s] = (L, user, self.ex.submit(llm_b6.ask, user, SYS, MODEL, EFFORT))
            self.next_s += CHUNK
        # 2) 답이 온 조각을 차례대로 받는다(앞 조각이 안 왔으면 기다림 — 정해짐 판단이 순서에 기대므로)
        for s in sorted(self.asked):
            L, user, fut = self.asked[s]
            if not fut.done() and not final:
                break
            try:
                out = fut.result()
            except Exception as e:                           # codex 4번 실패: 이 조각은 빈 답으로 두고 기록
                out = ""
                self.emit({"kind": "LLM등록오류", "chunk": s, "error": str(e)[:300]})
            del self.asked[s]
            self.answers[s] = out
            self.found += llm_b6.rows_of(out, L)
            self.log.write(json.dumps({"chunk": s, "user": user, "answer": out, "at": time.strftime("%H:%M:%S")}, ensure_ascii=False) + "\n")
            self.log.flush()
            self.done_upto = s + CHUNK
        # 3) 정해진 번호를 보낸다
        for g in self.products():
            if g["no"] in self.sent:
                continue
            if final or g["last"] + SETTLE <= self.done_upto:
                self._send(g)

    def finish(self):
        """방송 끝: 남은 조각을 모두 묻고 답을 다 받은 뒤 남은 상품을 보낸다"""
        self.tick(final=True)
        while self.asked:
            time.sleep(1)
            self.tick(final=True)
        self.ex.shutdown(wait=True)
        self._write_csv()

    # ---------- 묶기·보내기 ----------
    def products(self):
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

    def _heard(self, g):
        p = os.path.join(self.out, "transcript.jsonl")
        want = set(g["lines"])
        txt = [B.mask(json.loads(l)["text"]) for i, l in enumerate(open(p, encoding="utf-8")) if i in want]
        return " ".join(dict.fromkeys(txt))

    def _send(self, g):
        conf = min((CONF.get(str(c).lower(), 0.7) for c in g["confs"]), default=0.7)
        rec = {"kind": "LLM등록", "no": g["no"], "start_sec": g["t"], "start_hms": B.hms(g["t"]), "price": g["price"], "name": g["variety"],
               "lines": g["n"], "conf": conf}
        why = None
        if g["price"] is None:
            why = "금액 모름"
        elif self.poster:
            from . import post
            body = post.make_body(self.video_id, g["no"], g["price"], g["variety"] or "", self._heard(g), conf)
            if body is None:
                why = "보낼 수 없는 값"
            else:
                self.poster.send(body)
        rec["sent"] = bool(self.poster) and why is None
        if why:
            rec["skip"] = why
        self.sent[g["no"]] = rec
        self.emit(rec)
        won = f"{g['price']:,}원" if g["price"] else "금액 모름"
        print(f"           LLM등록 {g['no']:>4}번  {won}  {g['variety'] or '품종 모름'}"
              + ("  → 서버로" if rec["sent"] else (f"  (보내지 않음: {why})" if why else "")), flush=True)

    def _write_csv(self):
        with open(os.path.join(self.out, "llm_상품.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["번호", "처음 시각", "가격", "상품명", "LLM이 적은 줄 수", "서버로 보냄", "안 보낸 까닭"])
            for g in self.products():
                r = self.sent.get(g["no"], {})
                w.writerow([g["no"], B.hms(g["t"]), g["price"], g["variety"], g["n"], "O" if r.get("sent") else "", r.get("skip", "")])
