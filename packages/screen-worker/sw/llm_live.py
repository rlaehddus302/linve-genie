# 라이브 LLM 등록(사용자 2026-11-11: "라이브에서 지식판2로 등록", 2026-11-12: "정확도는 좋은데 3~5분은 너무 늦다 — 말하고 10초 안팎").
# 일꾼이 쓰는 transcript.jsonl·screen.jsonl을 1초마다 이어 읽어, 새 받아쓰기 줄이 들어올 때 묻는다(이벤트):
#   - 그 줄에 숫자·'번'·'만'·'천'·'원'이 있거나, 그 줄 동안 화면에 크게 보인 번호표가 앞 줄과 다르면 → 바로 최근 WINDOW초(기본 60초)의 줄을 묻는다
#   - 아무 이벤트 없이 SAFETY초(60초) 지나면 한 번 묻는다(안전망). 같은 줄로 두 번 묻지 않는다.
# 묻는 글은 끝난 방송 시험(sw.llm_b6, SCREEN=span)과 같은 줄 모양·화면 표시·닉네임 가림, 프롬프트 지식판2(regstt8k2), gpt-5.6-sol, 추론 low(LLM_REG_EFFORT).
# 동시에 묻는 것은 PAR개(기본 4)까지 — 다 차 있으면 들어온 줄을 들고 기다렸다가 자리가 나면 가장 새 줄로 묻는다.
#
# 보내기 (D-SCR-12~16, 2026-11-12 방송 복기 뒤): 첫 답으로 바로 보내지 않는다. 번호마다 답을 모아 두었다가(self.pend) 아래가 다 맞을 때 한 번 보낸다.
#   번호 — 판매자가 말했고 그 방송 번호대 안이거나, 화면에 온전히 TAG_FRAMES장(번호대 밖이면 OUT_FRAMES장) 넘게 읽힌 번호 (sw.reg_rules.number_evidence)
#          말한 번호와 화면 번호가 한 자리만 다르면 숫자 쌍으로 정한다(pair_verdict). 이미 보낸 번호에 다른 금액·품종이 나오면 번호표가 다시 보일 때까지 보류.
#   가격 — 판매자가 말한 금액과 LLM 금액이 같거나, 서로 다른 호출의 답이 PRICE_AGREE번 같을 때. 10배·100배 어긋나거나 가격대를 벗어나면 보내지 않는다(price_choice).
#          PRICE_WAIT초가 지나도 정해지지 않으면 "LLM확인요청"(번호 근거가 없으면 "LLM번호보류") 이벤트를 남기고, 뒤에 맞는 답이 오면 그때 보낸다.
#   품종 — LLM 이름과 품종 사전(sw.variety.pick_name)이 같거나, LLM 이름이 사전에 있거나, 사전 이름이 받아쓰기에 여러 번 나올 때만. 아니면 빈 이름.
#   서버는 같은 번호를 다시 받아도 바꾸지 않는다(R-2). LLM_REG_SAFE=0 이면 2026-11-12 방송 때처럼 첫 답으로 바로 보낸다(재현 비교·되돌리기용).
# 기록(결과 폴더): llm_live.jsonl(물을 때마다 글·답·걸린 초·까닭), llm_상품.csv(끝날 때: 보낸 값과 다수결 값), events.jsonl에 "LLM등록" 등
import collections
import concurrent.futures as cf
import csv
import glob
import json
import os
import re
import threading
import time

from . import llm_b4 as B
from . import llm_b6
from . import reg_rules as R
from .screen import EXPIRE, STABLE, Screen

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = os.path.join(HERE, "prompts", os.environ.get("LLM_REG_PROMPT", "sales_instruct_system_regstt8k2.txt"))
MODEL = os.environ.get("LLM_REG_MODEL", "gpt-5.6-sol")
EFFORT = os.environ.get("LLM_REG_EFFORT", "low")
WINDOW = float(os.environ.get("LLM_REG_WINDOW", 60))   # 물을 때 넣는 최근 줄의 길이(방송 초)
SAFETY = float(os.environ.get("LLM_REG_SAFETY", 60))   # 이벤트 없이 이만큼(방송 초) 지나면 한 번 묻는다
PAR = int(os.environ.get("LLM_REG_PAR", 4))            # 동시에 묻는 수(사용자 2026-11-12: 사용량보다 지연)
SCREEN_WAIT = 3.0                                      # 화면 읽기가 그 줄 끝까지 오기를 이만큼(실제 초)만 기다린다
CUE = re.compile(r"[0-9번만천원십]")
CONF = {"high": 0.9, "medium": 0.7, "low": 0.5}
# 잘못 들은 번호 바로잡기 (D-SCR-06, 사용자 2026-11-12 "391을 392로 잘못 알아먹고 등록 … 화면 인식 통해서 392는 잘못된거라고 판정"):
# 보낸 번호 N이 그 말 5초 앞부터 화면에 한 번도 안 읽혔는데, 그동안 다른 번호표 M이 크게 FIX_FRAMES장 이상 보였고(화면은 1초에 1장 —
# 사용자 2026-11-12 "한 상품 진짜 몇초밖에 안 보여준다. 같은 프레임이 몇번 보였나로": 15장 → 3장, 이어서가 아니어도 센다)
# M을 아직 보내지 않았으면 서버에 N → M 번호 바꾸기를 묻는다(서버가 찜·M 상품 유무를 다시 보고 안전할 때만 바꾼다).
# 말한 뒤 FIX_MIN초까지는 기다리고(번호표를 늦게 드는 판매자), FIX_MAX초가 지나면 그 번호는 더 보지 않는다.
# 품종 이름 고치기 (D-SCR-07): 보낸 뒤 NAME_WINDOW초 안의 LLM 답 중 "확실(high)"한 이름만 센다. 가장 많이 나온 이름(같으면 나중 것)이
# 지금 서버에 보낸 이름과 다르면 고쳐 보낸다(번호마다 NAME_MAX_FIX번까지). 확실한 답이 NAME_VOTES번 이상이고 다른 이름보다 많아야 한다
# (끝난 방송 재현 2026-11-12: 한 번만으로 바꾸면 재고·베개처럼 품종 아닌 말로 바뀌거나 이름이 오락가락했다).
NAME_WINDOW = float(os.environ.get("LLM_NAME_WINDOW", 180))
NAME_MAX_FIX = int(os.environ.get("LLM_NAME_MAX_FIX", 1))
NAME_VOTES = int(os.environ.get("LLM_NAME_VOTES", 2))
NOT_NAMES = {"재고", "제고", "재구", "베개", "서비스", "특가", "제곱"}         # 품종이 아닌데 LLM이 이름 칸에 적은 말
# 금액 고치기 (D-SCR-09): 보낸 번호를 나중에 다른 금액으로 다시 내놓으면(393 손톱 2만원 → 30분 뒤 만원) 그 번호가 화면에 보이는 줄의
# "확실(high)"한 금액 답을 PRICE_WINDOW초 안에서 센다. 지금 금액과 다른 금액이 PRICE_VOTES번 이상이고 다른 금액보다 많으면 고쳐 보낸다
# (번호마다 PRICE_MAX_FIX번까지). 서버는 판매자가 금액을 고친 번호·손으로 등록한 번호는 건드리지 않고, 이미 찜한 사람 금액은 그대로 둔다.
PRICE_WINDOW = float(os.environ.get("LLM_PRICE_WINDOW", 120))
PRICE_VOTES = int(os.environ.get("LLM_PRICE_VOTES", 2))
PRICE_MAX_FIX = int(os.environ.get("LLM_PRICE_MAX_FIX", 3))
FIX_FRAMES = int(os.environ.get("LLM_FIX_FRAMES", 3))
FIX_MIN = float(os.environ.get("LLM_FIX_MIN", 10))
FIX_MAX = float(os.environ.get("LLM_FIX_MAX", 180))

# ---------- 안전 규칙 (D-SCR-12~16) ----------
SAFE = os.environ.get("LLM_REG_SAFE", "1") != "0"              # 0 = 2026-11-12 방송 때 로직(첫 답으로 바로 보냄)
TAG_FRAMES = int(os.environ.get("LLM_TAG_FRAMES", 3))          # 말하지 않은 번호: 화면에 온전히 이만큼(장) 읽혀야 번호로 인정
OUT_FRAMES = int(os.environ.get("LLM_OUT_FRAMES", 5))          # 그 방송 번호대를 벗어난 번호: 이만큼(장)
BAND_SEG_FRAMES = 5                                            # 번호대를 정할 때: 화면에 이만큼(장) 넘게 읽힌 번호표도 넣는다(방송 처음·다시 켠 직후)
PRICE_UNIT = R.unit_of(os.environ.get("LLM_PRICE_UNIT"))       # 판매자의 가격 단위: 만(기본)·천·없음 — 단위 없이 말한 "35"를 무엇으로 읽나
PRICE_AGREE = int(os.environ.get("LLM_PRICE_AGREE", 2))        # 말한 금액과 못 맞출 때: 같은 금액의 답이 이만큼(서로 다른 호출)
PRICE_WAIT = float(os.environ.get("LLM_PRICE_WAIT", 20))       # 첫 답 뒤 이만큼(실제 초) 기다려도 못 정하면 확인요청을 남긴다
HOLD_MAX = float(os.environ.get("LLM_HOLD_MAX", 120))          # 마지막 답 뒤 이만큼(실제 초) 지나면 그 번호의 기다림을 접는다
CONFIRM_AFTER = float(os.environ.get("LLM_CONFIRM_AFTER", 4))  # 답이 한 번뿐인데 이만큼(실제 초) 다른 물음이 없으면 같은 창을 한 번 더 묻는다
SKIP_SETTLED = os.environ.get("LLM_SKIP_SETTLED", "1") != "0"  # 화면의 번호가 이미 보낸 번호이고 새 번호·금액 말이 없는 줄은 묻지 않는다(B-2의 L2)
NAME_DICT = os.environ.get("LLM_NAME_DICT", "1") != "0"        # 품종을 사전과 견줘 고른다(0 = LLM 이름 그대로)
REPRICE_STRICT = os.environ.get("LLM_REPRICE_STRICT", "1") != "0"  # 금액 고치기는 판매자가 그 번호를 다시 내놓았을 때만(번호를 다시 불렀거나 번호표가 다시 보임)
NAME_SELLER = os.environ.get("LLM_NAME_SELLER", "1") != "0"    # 판매자가 고쳐 적은 이름·별칭(data/varieties_seller.json)도 사전으로 쓴다
NAME_FOLLOW = float(os.environ.get("LLM_NAME_FOLLOW", 60))     # 품종 없이 보낸 번호는 이만큼(방송 초) 더 물어 이름을 채운다(묻기 줄이기에서 뺌)
NAME_PRE, NAME_POST = 30, 20                                   # 품종 사전이 보는 받아쓰기: 그 상품 첫 줄 앞 30초 ~ 뒤 20초(다른 번호를 말한 줄에서 끊는다)
CODEX_LEAN = os.environ.get("LLM_CODEX_LEAN", "1") != "0"      # codex exec에 --ephemeral --ignore-user-config --ignore-rules
CODEX_SCHEMA = os.environ.get("LLM_CODEX_SCHEMA", "1") != "0"  # codex exec에 --output-schema(답 JSON 모양 고정)


def ask_llm(user, sys_path=None):
    """라이브 등록이 LLM에 한 번 묻기(sw.doctor도 같은 길로 시험한다)"""
    return llm_b6.ask(user, sys_path or SYS, MODEL, EFFORT, lean=CODEX_LEAN, schema=llm_b6.SCHEMA_FILE if CODEX_SCHEMA else None)


def prompt_for_unit(unit, out):
    """판매자 단위가 만원이 아니면 지시문 10번(단위 없는 판매가)을 그 단위로 바꾼 파일을 결과 폴더에 만들어 그 경로를 준다"""
    if unit == 10000:
        return SYS
    text = open(SYS, encoding="utf-8").read()
    if unit == 1000 and "만원 단위다" in text and "350000원이다" in text:
        text = text.replace("만원 단위다", "천원 단위다").replace("350000원이다", "35000원이다").replace('"삼만 오천 원", "3만 5천", "35,000원"은 35000원이다. ', "")
    elif unit is None and "\n10. " in text:
        head, _, rest = text.partition("\n10. ")
        text = head + "\n10. 단위 없이 말한 수는 판매가로 적지 않는다(price는 null). 번호·수량·크기·호수와 구분한다. price_short와 price_line은 null로 둔다." + rest[rest.index("\n"):]
    else:
        print("           지시문에서 단위 규칙(10번)을 찾지 못해 그대로 써요", flush=True)
        return SYS
    path = os.path.join(out, "prompt_unit.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def prior_sent(out, video_id):
    """같은 방송의 앞선 실행(다시 켜기 전)이 서버로 보낸 번호 [{no, price, name, fixes}] — 결과 폴더 옆의 <영상>-* 폴더 events.jsonl에서.
    다시 켠 일꾼이 앞 번호표를 보고 이미 있는 번호를 다른 값으로 또 보내지 않게(2026-11-12 방송: 325·328·334번)"""
    if not video_id:
        return []
    here = os.path.abspath(out)
    events = []
    for run in sorted(glob.glob(os.path.join(os.path.dirname(here), f"{glob.escape(video_id)}-*"))):
        path = os.path.join(run, "events.jsonl")
        if os.path.abspath(run) == here or not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except ValueError:
                    pass
    return prior_from_events(events)


def prior_from_events(events):
    """일꾼 이벤트(시간순) → 서버에 남아 있을 번호 [{no, price, name, fixes}]: 등록 뒤의 금액·이름 고치기와 번호 바로잡기를 따라간다"""
    by = {}
    for e in events:
        kind, no = e.get("kind"), e.get("no")
        if kind == "LLM등록" and e.get("sent") and e.get("price"):
            by.setdefault(no, {"no": no, "price": e["price"], "name": e.get("name"), "fixes": 0})
        elif kind == "LLM금액고치기" and no in by:
            by[no]["price"], by[no]["fixes"] = e.get("to"), by[no]["fixes"] + 1
        elif kind == "LLM이름고치기" and no in by:
            by[no]["name"] = e.get("to")
        elif kind == "LLM번호바로잡기" and e.get("from") in by:
            src = by.pop(e["from"])
            if not e.get("drop"):
                by.setdefault(e.get("to"), dict(src, no=e.get("to")))
    return list(by.values())


def read_nicks(out):
    """손님 닉네임 목록(있으면): 결과 폴더의 nicknames.txt 또는 LLM_NICK_FILE — 한 줄에 하나. 품종으로 고르지 않는다"""
    out_set = set()
    for path in (os.environ.get("LLM_NICK_FILE"), os.path.join(out, "nicknames.txt")):
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                out_set.update(x.strip() for x in f if x.strip())
    return out_set


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
    def __init__(self, out, poster=None, video_id=None, emit=None, par=PAR, prior=None, safe=None):
        self.out = out
        self.poster, self.video_id = poster, video_id
        self.emit = emit or (lambda d: None)                 # events.jsonl에 쓰는 함수(일꾼 것)
        self.ex = cf.ThreadPoolExecutor(par)
        self.par = par
        self.flying = []                                     # [(마지막 줄 번호, L, 글, 물은 시각, 까닭, Future)]
        self.tr = []                                         # 받아쓰기 줄 [(시작, 끝, 글)] — 파일을 이어 읽음
        self.tr_pos = 0
        self.sc, self.sc_pos, self.screen_top = Screen(), 0, -1
        self.segs = []                                       # 화면 구간(Screen.build) — 번호대 계산용
        self.seen = {}                                       # 줄 번호 → 처음 읽은 시각(벽시계) — 늦음 재기
        self.checked = 0                                     # 이벤트를 본 줄 수
        self.want = None                                     # (줄 번호, 까닭) — 물어야 하는데 자리가 없어 기다리는 것
        self.asked_line = -1                                 # 마지막으로 물은 창의 끝 줄
        self.asked_t = None                                  # 마지막으로 물은 창의 끝(방송 초)
        self.prev_tag = None
        self.found = []                                      # LLM 줄 [{t, line, no, price, variety, confidence, why}]
        self.sent = {}                                       # 번호 → 보낸 상품(또는 안 보낸 까닭)
        self.last_evidence = {}
        self.names = {}                                      # 보낸 번호 → {"t": 처음 말한 방송 초, "now": 지금 서버 이름, "sure": 그 이름이 확실했나, "votes": Counter, "last": {이름: 시각}, "fixes": 횟수}
        self.prices = {}                                     # 보낸 번호 → {"now": 지금 서버 금액, "votes": [(방송 초, 금액)], "fixes": 횟수} (D-SCR-09)
        self.watch = {}                                      # 보낸 번호 → 말한 줄 시작(방송 초) — 화면으로 맞는지 볼 것 (D-SCR-06)
        self.calls = 0
        # ---- 안전 규칙 (D-SCR-12~16) ----
        self.safe = SAFE if safe is None else safe
        self.unit = PRICE_UNIT
        self.sys = prompt_for_unit(self.unit, out) if self.safe else SYS
        self.pend = {}                                       # 번호 → 답을 모으는 중인 상품(아직 안 보냄)
        self.skipped = set()                                 # 묻지 않기로 한 줄 번호(이벤트 없음 + 이미 정해진 번호의 줄) — 재현 도구가 줄인 호출을 센다
        self.confirm_calls = 0                               # 답이 한 번뿐이라 같은 창을 한 번 더 물은(묻고 싶었던) 횟수
        self.order = []                                      # 보낸 번호(보낸 순서) — 번호대
        self.sent_prices = []                                # 보낸 금액 — 가격대
        self.held = set()                                    # (번호, 줄) — 앞 번호표 보류를 한 번만 적으려고
        self.dic = None                                      # 품종 사전(처음 쓸 때 읽음)
        self.nicks = read_nicks(out)                         # 손님 닉네임(있으면)
        self.log = open(os.path.join(out, "llm_live.jsonl"), "a", encoding="utf-8")
        self.lock = threading.Lock()
        if self.safe:
            self.adopt(prior_sent(out, video_id) if prior is None else prior)

    def adopt(self, prior):
        """같은 방송의 앞선 실행이 보낸 번호를 이미 보낸 것으로 이어받는다(D-SCR-12c) — 번호표가 다시 보이고 확실한 새 소개일 때만 다시 보낸다"""
        for d in prior:
            no = d.get("no")
            if not isinstance(no, int) or no in self.sent:
                continue
            self.sent[no] = {"no": no, "price": d.get("price"), "name": d.get("name"), "prior": True, "sent": False}
            self.last_evidence[no] = -1e9
            if d.get("price"):
                self.prices.setdefault(no, {"now": d["price"], "votes": [], "fixes": int(d.get("fixes") or 0)})
                self.sent_prices.append(d["price"])
            self.order.append(no)

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
        self.segs, cand, mains = self.sc.build()
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
        fut = self.ex.submit(ask_llm, user, self.sys) if self.safe else self.ex.submit(llm_b6.ask, user, SYS, MODEL, EFFORT)
        self.flying.append((upto, L, user, time.time(), why, fut))

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
            if self.safe and SKIP_SETTLED and why and self._quiet(tag, x, why, t):
                why = None                                   # 새로 알 것이 없는 줄 — 이미 정해진 번호만을 위해 다시 묻지 않는다
            if why is None and (self.asked_t is None or t - self.asked_t >= SAFETY):
                why = "안전망"
            if why and i > self.asked_line:
                self.want = (i, why)
            elif why is None:
                self.skipped.add(i)
            self.checked += 1
        if final and tr and self.asked_line < len(tr) - 1:
            self.want = (len(tr) - 1, "끝")
        # 2) 물을 것이 있고 자리가 있으면 가장 새 줄로 묻는다
        busy = len([f for f in self.flying if not f[5].done()])
        if self.want and busy < self.par:
            i, why = self.want
            self.want = None
            if i > self.asked_line or why == "가격 확인":
                self._ask(i, cand, mains, why)
        # 3) 답이 온 것을 받아 번호+가격이 나온 상품을 보낸다(안전 규칙: 모아서 / 옛 로직: 첫 답으로 바로)
        for item in [f for f in self.flying if f[5].done() or final]:
            upto, L, user, asked_at, why, fut = item
            try:
                out = fut.result()
            except Exception as err:                         # codex 4번 실패: 이 창은 빈 답으로 두고 기록
                out = ""
                self.emit({"kind": "LLM등록오류", "upto": upto, "error": str(err)[:300]})
            self.flying.remove(item)
            rows = llm_b6.rows_of(out, L, self.unit, wide=True) if self.safe else llm_b6.rows_of(out, L)
            self.log.write(json.dumps({"upto": upto, "why": why, "user": user, "answer": out, "at": time.strftime("%H:%M:%S"),
                                       "sec": round(time.time() - asked_at, 1)}, ensure_ascii=False) + "\n")
            self.log.flush()
            for r in sorted(rows, key=lambda r: r["t"]):
                if r["no"] is None:
                    continue
                start, end, _ = self.tr[r["line"]]
                if self.safe:
                    r = self._pair(r, start, end, cand, mains)
                tag = conflicting_tag(r["no"], start, end, cand, mains) if r["confidence"] == "low" and not r.get("pair_wait") else None
                if tag is not None:
                    self.emit({"kind": "LLM번호충돌보류", "no": r["no"], "screen_no": tag,
                               "line": r["line"], "start_sec": start, "price": r["price"]})
                    continue
                # 이미 보낸 번호에 다른 값이 붙은 답(D-SCR-12c): 금액·품종이 둘 다 다르고 판매자가 그 번호를 다시 내놓은 것이 아니면
                # 앞 상품 번호표가 남아 있는 것 — 고치기 투표에도, 다시 보내기에도 쓰지 않는다
                diff = self._differs(r) if self.safe and r["no"] in self.sent else None
                again = bool(diff) and self._reoffered(r, start, mains)
                leftover = diff == "둘 다" and not again
                if leftover:
                    r["leftover"] = True
                    self._note_leftover(r, start)
                self.found.append(r)
                if not leftover:
                    self._vote_name(r)
                if r["price"]:
                    no = r["no"]
                    if not leftover and not (self.safe and no in self.sent and self._reprice_blocked(r, upto, start, cand, mains)):
                        self._vote_price(r, start, end, mains)
                    previous = self.last_evidence.get(no)
                    if not leftover:                         # 앞 번호표로 보류한 답은 그 번호의 근거로 치지 않는다
                        self.last_evidence[no] = max(r["t"], previous if previous is not None else r["t"])
                    new_scene = previous is not None and r["t"] - previous > WINDOW and r.get("confidence") == "high" and any(
                        mains.get(sec) == no for sec in range(int(start), int(end) + 1))
                    if no not in self.sent or new_scene:
                        if not self.safe:
                            self._send(r)
                        elif not diff or again:              # 값이 다른데 다시 내놓은 것이 아니면 다시 보내지 않는다(금액·품종 고치기 투표로만 따라간다)
                            self._pend_add(r, upto, cand, (upto, asked_at))
        if self.safe:
            self._settle(cand, mains, final and not self.flying and not self.want)
            if not final and not self.want and not self.flying and tr:
                self._want_confirm(len(tr) - 1)              # 다음 번 돌 때 묻는다
        self._check_numbers(cand, mains)

    # ---------- 안전 규칙: 묻기 줄이기 (B-2의 L2) ----------
    def _quiet(self, tag, text, why, t=None):
        """이 줄 때문에 물을 필요가 없나(기다리는 상품이 없을 때만):
        - 화면의 번호가 이미 보낸 번호이고, 이 줄에 다른 번호도 그 상품 값과 다른 금액도 없다(번호표가 그 번호로 바뀐 것뿐인 줄도).
          단 품종 없이 보낸 번호는 NAME_FOLLOW초 동안은 계속 묻는다(뒤 답으로 이름을 채우려고)
        - 숫자가 하나도 없고 번호·금액으로 읽히는 말도 없다('만족'·'원래'·'이번'처럼 글자만 걸린 줄)"""
        if self.pend:
            return False
        g = self.names.get(tag) if tag is not None else None
        if g is not None and not g["now"] and t is not None and t - g["t"] <= NAME_FOLLOW:
            return False
        numbers = R.spoken_numbers([text])
        explicit, short = R.spoken_amounts(text, self.unit, exclude={tag} if tag is not None else ())
        amounts = explicit | short
        rec = self.sent.get(tag) if tag is not None else None
        if rec and (rec.get("sent") or rec.get("prior")):
            price = (self.prices.get(tag) or {}).get("now") or rec.get("price")
            return not (numbers - {tag}) and not (amounts - {price})
        return why == "숫자" and not numbers and not amounts and not re.search(r"\d", text)

    def _want_confirm(self, last):
        """답이 한 번뿐인 상품이 있는데 날아가 있는 물음이 없으면 같은 창을 한 번 더 묻는다(상품마다 한 번)"""
        now = time.time()
        for p in self.pend.values():
            if p["confirm"] or not p.get("ok_no") or len(set().union(*p["votes"].values())) != 1 or now - p["last"] < CONFIRM_AFTER:
                continue                                     # 번호 근거가 없는 것(일부만 읽힌 번호표)을 위해서는 다시 묻지 않는다
            p["confirm"] = True
            self.confirm_calls += 1
            self.want = (last, "가격 확인")
            return

    # ---------- 안전 규칙: 번호 ----------
    def _pair(self, r, start, end, cand, mains):
        """말한 번호와 화면의 큰 번호표가 한 자리만 다를 때 숫자 쌍으로 어느 쪽인지 정한다(D-SCR-14). 번호를 바꾼 줄(또는 기다릴 줄)을 돌려준다"""
        no, li = r["no"], r["line"]
        texts = [self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2))]
        secs = range(int(start) - 5, int(min(self.screen_top, end + 10)) + 1)
        big = collections.Counter(mains[x] for x in secs if mains.get(x) is not None)
        visible = lambda n: any(n in cand.get(x, ()) for x in secs)
        said = screen = None
        if no in R.spoken_numbers(texts) and not visible(no):
            # LLM이 말한 번호를 골랐는데 화면에는 한 자리 다른 번호표만 보인다
            screen = next((tag for tag, k in big.most_common() if k >= STABLE and R.digit_pair(no, tag)), None)
            said = no if screen is not None else None
        elif big.get(no, 0) >= STABLE:
            # LLM이 화면 번호를 골랐는데 판매자는 한 자리 다른 번호를 'N번'으로 말했다
            beon = {v for x in texts for v in R.numbers_with_beon(x)}
            said = next((s for s in sorted(beon) if R.digit_pair(s, no) and not visible(s)), None)
            screen = no if said is not None else None
        if said is None:
            return r
        frames = big[screen]
        verdict = R.pair_verdict(said, screen, frames, FIX_FRAMES)
        pair = "↔".join(R.digit_pair(said, screen))
        if verdict != "말" and no == said and r["price"] is not None and screen in self.sent:
            # 화면 번호는 이미 다른 금액으로 보낸 상품이다 — 번호를 차례로 파는 판매자(421 다음 422)가 앞 번호표를 든 채 다음 번호를 부른 것으로 보고
            # 말한 번호를 그대로 둔다. 같은 금액이면 같은 상품을 잘못 들은 것(334를 333으로)이라 화면을 따른다
            sent_price = (self.prices.get(screen) or {}).get("now") or self.sent[screen].get("price")
            if sent_price is not None and sent_price != r["price"]:
                return r
        if verdict == "기다림":
            return dict(r, pair_wait=(said, screen))
        to = said if verdict == "말" else screen
        if to != no:
            self.emit({"kind": "LLM번호쌍판정", "said": said, "screen": screen, "pair": pair, "to": to, "frames": frames, "line": li, "start_sec": start})
            print(f"           번호 쌍 판정 말 {said}번 / 화면 {screen}번({frames}장) → {to}번 ({pair})", flush=True)
            return dict(r, no=to, pair_from=no)
        return r

    def _same_name(self, a, b):
        """두 품종 이름이 같은가(받아쓰기 모양은 사전 이름으로 맞춰 견준다). 한쪽이 비었으면 다르다고 할 수 없다"""
        key = lambda x: "".join((x or "").split())
        if not key(a) or not key(b) or key(a) == key(b):
            return True
        if not NAME_DICT:
            return False
        from . import variety
        return variety.norm(variety.canon(variety.tidy(a), self._dic())[0]) == variety.norm(variety.canon(variety.tidy(b), self._dic())[0])

    def _reoffered(self, r, start, mains):
        """이미 보낸 번호를 판매자가 실제로 다시 내놓았나: 그 번호를 다시 불렀거나, 번호표가 한동안(EXPIRE초) 안 보였다가 다시 보였다"""
        no, li = r["no"], r["line"]
        if no in R.spoken_numbers(self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2))):
            return True
        previous = self.last_evidence.get(no)
        lo = int(max(previous if previous is not None else start - 600, start - 600))
        return sum(1 for x in range(lo, int(start)) if x in self.sc.tokens and mains.get(x) != no) >= EXPIRE

    def _differs(self, r):
        """이미 보낸 번호의 값과 이 답이 어떻게 다른가 → None(같음) / "금액" / "품종" / "둘 다" """
        no = r["no"]
        rec = self.sent[no]
        name = (self.names.get(no) or {}).get("now") or rec.get("name")
        price = (self.prices.get(no) or {}).get("now") or rec.get("price")
        p = r["price"] is not None and price is not None and r["price"] != price
        n = not self._same_name(name, r.get("variety"))
        return "둘 다" if p and n else "금액" if p else "품종" if n else None

    def _note_leftover(self, r, start):
        no = r["no"]
        if (no, r["line"]) in self.held:
            return
        self.held.add((no, r["line"]))
        rec = self.sent[no]
        self.emit({"kind": "LLM앞번호표보류", "no": no, "line": r["line"], "start_sec": start, "price": r["price"], "name": r.get("variety"),
                   "sent_price": (self.prices.get(no) or {}).get("now") or rec.get("price"), "sent_name": (self.names.get(no) or {}).get("now") or rec.get("name")})

    def _said_amounts(self, r, upto, cand):
        """그 답이 본 줄(그 줄 15초 앞 ~ 물은 창의 끝)에서 판매자가 말한 금액 → (단위를 말한 것, 단위를 뺀 것). 화면에 보인 번호와 상품 번호는 금액으로 읽지 않는다"""
        li = r["line"]
        start, end, _ = self.tr[li]
        shown = {n for x in range(int(start) - 5, int(end) + 6) for n in cand.get(x, ())} | {r["no"]}
        explicit, short = set(), set()
        for j in range(max(0, li - 12), min(len(self.tr), max(upto, li) + 1)):
            if r["t"] - 15 <= self.tr[j][0] <= r["t"] + 30:
                e, s = R.spoken_amounts(self.tr[j][2], self.unit, exclude=shown)
                explicit |= e
                short |= s
        return explicit, short

    def _reprice_blocked(self, r, upto, start, cand, mains):
        """이미 보낸 번호의 금액 고치기(D-SCR-09)에 이 답을 세면 안 되는 까닭이 있나(D-SCR-13):
        - 판매자가 그 번호를 다시 내놓은 것이 아니다(번호를 다시 부르지도, 번호표가 치워졌다 다시 보이지도 않음) — 앞 번호표를 든 채 다음 상품 값을 말한 것일 수 있다
        - 판매자가 말한 금액이 아니거나, 지금 금액·받아쓴 금액과 꼭 10배·100배 다른데 단위까지 말한 금액이 아니다(350,000을 35,000으로 되돌리지 않게)"""
        no, price = r["no"], r["price"]
        now_price = (self.prices.get(no) or {}).get("now")
        if now_price is None or price == now_price:
            return False
        if REPRICE_STRICT and not self._reoffered(r, start, mains):
            return True
        explicit, short = self._said_amounts(r, upto, cand)
        if price in explicit:
            return False
        return price not in short or R.magnitude_conflict(price, {now_price}) is not None

    def _pend_add(self, r, upto, cand, call):
        """보낼 수도 있는 답 하나를 그 번호의 모음에 더한다. call = 그 답이 나온 호출(같은 호출의 답은 한 번으로 센다)"""
        no, li, now = r["no"], r["line"], time.time()
        p = self.pend.get(no)
        if p is None:
            p = self.pend[no] = {"no": no, "t0": now, "last": now, "t": r["t"], "line": li, "rows": [], "votes": {}, "explicit": set(), "short": set(),
                                 "spoken": False, "pair": None, "flag": False, "confirm": False}
        p["rows"].append(r)
        p["last"] = now
        p["votes"].setdefault(r["price"], set()).add(call)
        if r.get("pair_wait"):
            p["pair"] = r["pair_wait"]
        p["spoken"] = p["spoken"] or no in R.spoken_numbers(self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2)))
        explicit, short = self._said_amounts(r, upto, cand)
        p["explicit"] |= explicit
        p["short"] |= short

    def _band(self):
        return R.band_of(self.order[-R.BAND_RECENT:] + [g["img"] for g in self.segs if g["reads"].get(g["img"], 0) >= BAND_SEG_FRAMES][-R.BAND_RECENT:])

    def _settle(self, cand, mains, final=False):
        """모아 둔 상품마다 번호 근거와 가격이 정해졌는지 보고, 정해졌으면 보낸다. 상한을 넘기면 확인요청·번호보류를 한 번 남긴다"""
        if not self.pend:
            return
        now, band = time.time(), self._band()
        for no, p in list(self.pend.items()):
            secs = range(int(p["t"]) - 5, int(min(self.screen_top, p["t"] + 60)) + 1)
            if p["pair"]:
                said, screen = p["pair"]
                if any(said in cand.get(x, ()) for x in secs):
                    p["pair"] = None                         # 말한 번호도 화면에 보인다 — 번호표가 따로 있다
                elif sum(1 for x in secs if mains.get(x) == screen) >= FIX_FRAMES:
                    self._pair_move(p, said, screen)
                    continue
            ok, why_no = (False, f"한 자리 다른 번호표({p['pair'][1]}번)를 더 봐야 함") if p["pair"] else R.number_evidence(
                no, p["spoken"], secs, cand, band, TAG_FRAMES, OUT_FRAMES)
            p["ok_no"] = ok
            votes = {price: len(calls) for price, calls in p["votes"].items()}
            price, why_price, blocked = R.price_choice(votes, p["explicit"], p["short"], self.sent_prices, PRICE_AGREE)
            if ok and price is not None:
                del self.pend[no]
                self._send_pending(p, price, why_no, why_price)
                continue
            if not p["flag"] and (final or now - p["t0"] >= PRICE_WAIT):
                p["flag"] = True
                rec = {"kind": "LLM확인요청" if ok else "LLM번호보류", "no": no, "why": why_price if ok else why_no, "line": p["line"], "start_sec": p["t"],
                       "start_hms": B.hms(p["t"]), "prices": {str(k): v for k, v in votes.items()}, "said": sorted(p["explicit"] | p["short"]),
                       "wait_sec": round(now - p["t0"], 1), "again": no in self.sent}   # again = 이미 보낸 번호를 다시 내놓은 답(새 등록이 아님)
                self.emit(rec)
                print(f"           {'확인요청' if ok else '번호 보류'} {no:>4}번  {rec['why']}  (답: {', '.join(f'{k:,}원 {v}번' for k, v in votes.items())})", flush=True)
            if final or now - p["last"] >= HOLD_MAX:
                del self.pend[no]

    def _pair_move(self, p, said, screen):
        """기다리던 숫자 쌍: 화면 번호표가 충분히 보였다 — 화면 번호로 옮긴다"""
        del self.pend[p["no"]]
        to = screen
        pair = "↔".join(R.digit_pair(said, screen))
        self.emit({"kind": "LLM번호쌍판정", "said": said, "screen": screen, "pair": pair, "to": to, "line": p["line"], "start_sec": p["t"], "waited": True})
        p["pair"] = None
        if to in self.sent:
            return                                           # 화면 번호는 이미 보낸 상품이다
        q = self.pend.get(to)
        for r in p["rows"]:
            r.update(no=to, pair_from=said)                  # self.found의 같은 줄도 바뀐다 — 품종·들은 말 찾기가 따라온다
        if q is None:
            p["no"], p["spoken"] = to, False
            self.pend[to] = p
            return
        for price, calls in p["votes"].items():
            q["votes"].setdefault(price, set()).update(calls)
        q["rows"] += p["rows"]
        q["explicit"] |= p["explicit"]
        q["short"] |= p["short"]

    # ---------- 안전 규칙: 품종 ----------
    def _product_lines(self, no, p):
        """그 상품의 받아쓰기 [(초, 글)]: 첫 줄 앞 NAME_PRE초 ~ 뒤 NAME_POST초, 다른 번호를 말한 줄에서 끊는다"""
        from .decide import numbers_bare
        known = {g["img"] for g in self.segs} | set(self.sent) | {no}
        other = lambda x: any(v != no for v in R.numbers_with_beon(x) + [v for v in numbers_bare(x) if v >= 100 and v in known])
        first = p["line"]
        lo = first
        while lo > 0 and self.tr[lo - 1][0] >= p["t"] - NAME_PRE and not other(self.tr[lo - 1][2]):
            lo -= 1
        hi = first
        while hi + 1 < len(self.tr) and self.tr[hi + 1][0] <= p["t"] + NAME_POST and not other(self.tr[hi + 1][2]):
            hi += 1
        return [(s, x) for s, _, x in self.tr[lo:hi + 1]]

    def _dic(self):
        if self.dic is None:
            from . import variety
            self.dic = variety.Dictionary(seller=NAME_SELLER)
        return self.dic

    def _name(self, no, p):
        """보낼 품종 이름: LLM이 그 번호에 적은 이름들과 사전 규칙을 견준다(D-SCR-15) → (이름 또는 None, 까닭, 굳은 이름인가)"""
        names = [f["variety"] for f in self.found if f["no"] == no and abs(f["t"] - p["t"]) <= WINDOW and f["variety"] and not f.get("leftover")]
        if not NAME_DICT:
            return (collections.Counter(names).most_common(1)[0][0] if names else None), "LLM 이름", False
        from . import variety
        name, why, strong = variety.pick_name(names, self._product_lines(no, p), self._dic(), self.nicks, detail=True)
        return name or None, why, strong

    def _send_pending(self, p, price, why_no, why_price):
        no = p["no"]
        first = next(r for r in p["rows"] if r["price"] == price)
        name, why_name, locked = self._name(no, p)
        ruled = price in p["explicit"] or price in p["short"]
        conf = 0.9 if ruled else CONF.get(str(first.get("confidence")).lower(), 0.7)
        r = dict(first, no=no, t=p["t"], line=p["line"], variety=name)
        self._send(r, picked=True, conf=conf, note={"why_no": why_no, "why_price": why_price, "why_name": why_name, "name_locked": locked,
                                                    "answers": sum(len(c) for c in p["votes"].values()), "flagged": p["flag"]})

    # ---------- 고치기 (D-SCR-06·07·09) ----------
    def _vote_name(self, r):
        """D-SCR-07: 보낸 번호에 대한 확실한 품종 답을 세고, 지금 이름과 다르면 고쳐 보낸다"""
        g = self.names.get(r["no"])
        name = (r.get("variety") or "").strip()
        if g is None or not name or str(r.get("confidence")).lower() != "high" or r["t"] - g["t"] > NAME_WINDOW:
            return
        key = "".join(name.split())
        if key in NOT_NAMES:
            return
        if self.safe and NAME_DICT:
            # 품종이 아닌 말·손님 닉네임을 거르고, 받아쓰기 모양(세검·상광)을 사전 이름으로 맞춘 뒤 센다(D-SCR-15)
            from . import variety
            name = variety.tidy(name)
            near = [(s, x) for s, _, x in self.tr[max(0, r["line"] - 12):r["line"] + 3]]
            if not name or variety.not_a_name(name, self.nicks | variety.nicknames(near)):
                return
            name, known = variety.canon(name, self._dic())
            if not known:
                return                                       # 사전에 없는 이름으로는 고치지 않는다(틀린 이름보다 빈 이름)
            key = "".join(name.split())
        g["votes"][key] += 1
        g["last"][key] = r["t"]
        g["shown"][key] = name
        ranked = sorted(g["votes"], key=lambda k: (g["votes"][k], g["last"][k]), reverse=True)
        best = ranked[0]
        if best == "".join((g["now"] or "").split()) or g["fixes"] >= NAME_MAX_FIX:
            return
        # 처음 이름이 확실(high)했으면 한 표 더 (재현: 청개구리 → 청수처럼 맞던 이름을 바꾸는 일을 줄인다)
        need = NAME_VOTES + (1 if g["now"] and g["sure"] else 0)
        if g["votes"][best] < need or (len(ranked) > 1 and g["votes"][ranked[1]] >= g["votes"][best]):
            return
        g["fixes"] += 1
        old, g["now"], g["sure"] = g["now"], g["shown"][best], True
        rec = {"kind": "LLM이름고치기", "no": r["no"], "from": old, "to": g["now"], "votes": g["votes"][best], "sent": bool(self.poster)}
        self.emit(rec)
        print(f"           이름 고치기 {r['no']}번 {old or '(없음)'} → {g['now']}", flush=True)
        if self.poster:
            self.poster.rename(self.video_id, r["no"], g["now"], g["fixes"])

    def _vote_price(self, r, start, end, mains):
        """D-SCR-09: 보낸 번호가 화면에 보이는 줄의 확실한 금액을 세고, 지금 금액과 다르면 고쳐 보낸다"""
        g = self.prices.get(r["no"])
        if g is None or str(r.get("confidence")).lower() != "high" or g["fixes"] >= PRICE_MAX_FIX:
            return
        if not any(mains.get(sec) == r["no"] for sec in range(int(start), int(end) + 1)):
            return
        g["votes"] = [v for v in g["votes"] if r["t"] - v[0] <= PRICE_WINDOW] + [(r["t"], r["price"])]
        count = collections.Counter(p for _, p in g["votes"])
        last = {p: t for t, p in g["votes"]}
        ranked = sorted(count, key=lambda p: (count[p], last[p]), reverse=True)
        best = ranked[0]
        if best == g["now"] or count[best] < PRICE_VOTES or (len(ranked) > 1 and count[ranked[1]] >= count[best]):
            return
        g["fixes"] += 1
        old, g["now"], g["votes"] = g["now"], best, []
        self.emit({"kind": "LLM금액고치기", "no": r["no"], "from": old, "to": best, "votes": count[best], "start_sec": r["t"], "sent": bool(self.poster)})
        print(f"           금액 고치기 {r['no']}번 {old:,}원 → {best:,}원", flush=True)
        if self.poster:
            self.poster.reprice(self.video_id, r["no"], best, g["fixes"])

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
            rid = self.sent.get(no, {}).get("rid")
            if rid is None:                                  # 이 일꾼이 보낸 등록이 아니면 바꾸지 않는다
                del self.watch[no]
                continue
            other = self.sent.get(tag)
            drop = other is not None
            if drop and not (other.get("sent") and "fixed_from" not in other and other.get("start_sec", -1) >= start - 5):
                continue
            del self.watch[no]
            rec = {"kind": "LLM번호바로잡기", "from": no, "to": tag, "drop": drop, "frames": frames, "start_sec": start, "sent": bool(self.poster)}
            self.emit(rec)
            print(f"           번호 바로잡기 {no}번 → {tag}번{' (지움)' if drop else ''} (화면에 {no}번은 안 보이고 {tag}번이 {frames}장)", flush=True)
            if self.poster:
                self.poster.renumber(self.video_id, no, tag, rid, drop=drop)
            # 잘못 들은 번호는 보낸 것으로 남겨 같은 말을 다시 받아도 또 등록하지 않는다(화면에 그 번호가 보이면 new_scene으로만)
            if not drop:
                self.sent[tag] = dict(self.sent.get(no, {}), no=tag, fixed_from=no)
            self.sent[no] = dict(self.sent.get(no, {}), fixed_to=tag)

    def finish(self):
        """방송 끝: 남은 줄을 한 번 더 묻고 답을 다 받은 뒤 남은 상품을 정리한다.
        안전 규칙: 모아 둔 상품 가운데 번호·가격이 정해진 것만 보내고 나머지는 확인요청으로 남긴다. 옛 로직: 가격이 있는데 아직 안 보낸 번호를 다 보낸다"""
        self.tick(final=True)
        while self.flying or self.want:
            time.sleep(1)
            self.tick(final=True)
        self.ex.shutdown(wait=True)
        if not self.safe:
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

    def _send(self, r, picked=False, conf=None, note=None):
        """r = LLM 줄 하나(번호·가격이 있는 답). 옛 로직: 품종이 비었으면 이미 받은 줄에서 그 번호의 품종을 찾는다.
        picked = 안전 규칙이 품종까지 정했다(빈 이름이면 빈 채로 보낸다), conf·note = 그때의 확신과 까닭"""
        no, price, name = r["no"], r["price"], r["variety"]
        if not name and not picked:
            name = next((f["variety"] for f in reversed(self.found) if f["no"] == no and abs(f["t"] - r["t"]) <= WINDOW and f["variety"]), None)
        if conf is None:
            conf = CONF.get(str(r.get("confidence")).lower(), 0.7)
        lines = [f["line"] for f in self.found if f["no"] == no and abs(f["t"] - r["t"]) <= WINDOW and not f.get("leftover")] or [r["line"]]
        now = time.time()
        line = r["line"]
        rec = {"kind": "LLM등록", "no": no, "start_sec": r["t"], "start_hms": B.hms(r["t"]), "price": price, "name": name, "conf": conf,
               "line": line, "line_end_sec": self.tr[line][1] if line is not None and line < len(self.tr) else None,
               "line_seen_wall": round(self.seen.get(line, now), 2), "sent_wall": round(now, 2), "wait_sec": round(now - self.seen.get(line, now), 1)}
        if note:
            rec.update(note)
        why = None
        if price is None:
            why = "금액 모름"
        elif self.poster:
            from . import post
            body = post.make_body(self.video_id, no, price, name or "", self._heard(lines), conf)
            if body is not None:
                observed = int(self.seen.get(line, now) * 1000)
                body.update(observedAt=observed, requestId=f"screen-{self.video_id}-{no}-{observed}")
                rec["rid"] = body["requestId"]
            if body is None:
                why = "보낼 수 없는 값"
            else:
                self.poster.send(body)
        rec["sent"] = bool(self.poster) and why is None
        if rec["sent"]:
            self.watch[no] = r["t"]
            sure = bool(name) and str(r.get("confidence")).lower() == "high"
            # 다시 보낸 등록(새 장면)은 서버에 이미 있는 번호면 무시된다(R-2) — 서버 금액을 아는 처음 값을 두고 금액 고치기 투표로 맞춘다
            self.prices.setdefault(no, {"now": price, "votes": [], "fixes": 0})
            # LLM과 사전이 같았거나 사전 이름이 여러 번 나온 이름은 굳힌다 — 뒤 답으로 바꾸지 않는다(재현: 맞던 이름 7개가 틀리게 바뀜)
            locked = NAME_MAX_FIX if note and note.get("name_locked") else 0
            self.names[no] = {"t": r["t"], "now": name, "sure": sure, "votes": collections.Counter(), "last": {}, "shown": {}, "fixes": locked}
        if why is None:
            self.order.append(no)
            self.sent_prices.append(price)
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
