# 번호 먼저 올리기 — 빠른 길 규칙 (D-RECOG-01·03·30~, 설계 docs/retro/2026-11-16-recognition-redesign.md 4.1·4.2·5.2·5.4·6.2절).
# 0단계 재현(sw.fastpath_sim)과 라이브 일꾼(sw.llm_live, LLM_NUMBER_FIRST=1)이 같은 규칙을 쓰도록 한곳에 둔다.
#  - 순수 계산: 시계·난수·파일·서버·LLM을 쓰지 않는다. 시간은 부르는 쪽이 주는 방송 초(t)뿐이다.
#  - 부르는 쪽이 화면 한 초(screen)·받아쓴 줄 하나(line)·거두기(sweep)를 차례로 넣고, 바뀐 것은 self.changes에서 꺼내 간다.
#    재현은 방송 초 순서대로 넣는다(화면 t → 그 초에 끝난 줄 → 거두기). 라이브는 화면이 받아쓰기보다 앞서 오므로 줄이 늦게 들어오면
#    그 줄이 연 번호의 "딱지 3번" 확인을 지나간 화면 초에 대해 한 번 더 본다(catch_up) — 재현에서는 일어나지 않는다.
#  - 상품 기록 r: state "확인 중"(올림) → "판매 중"(번호 맞음) / "거둠"(60초 안에 둘째 근거 없음). price_state "들림"(한 번) → "맞음"(같은 값 두 마디).
#  - 번호·금액·장부 읽기는 일꾼의 함수(decide·reg_rules·price·variety)를 그대로 쓴다.
import collections
import re

from . import variety as V
from .decide import numbers_bare, numbers_with_beon
from .reg_rules import band_of, digit_pair, EAR_PAIRS, EYE_PAIRS, full_frames, in_band, out_of_range, spoken_amounts

HOLD = 60            # 확인 중으로 올리고 둘째 근거를 기다리는 시간(초)
OPEN = 10            # 번호를 말한 뒤 이만큼은 그 상품이 "열려 있다"(번호 없는 금액의 주인)
TAG_WIN, TAG_NEED = 8, 5       # 딱지만으로 올릴 때: 8초 안에 5번
TAG_OK_WIN, TAG_OK = 10, 3     # 딱지가 둘째 근거가 될 때: 10초 안에 3번
TAG_CROWD = 3        # 딱지만으로 올릴 때: 그 8초에 보인 번호가 이만큼까지일 때만(진열대를 훑는 화면에서는 올리지 않는다)

_CLAUSE = re.compile(r"(?<=[.?!])\s+")
_DISCOUNT = re.compile(r"빼\s?드|빼\s?줄|빼\s?주|깎|할인|디씨|에누리")
_PAST = re.compile(r"했었|갔죠|갔었|갔던|갔는데|아까|원래|저번")
_PER = re.compile(r"씩|\d\s?개|[한두세네]\s?개|하나에|개에")
_ONE = re.compile(r"(?<![\w.,~])([1-9])(?=\s*(?:갑니다|가요|갈게요|가겠습니다|갈께요))")


def amounts(text, unit, exclude, cues=True):
    """한 줄 → [(금액, 갈래)] 갈래: now(지금 값) / per(낱개·묶음 값, 후보로만). 깎는 값·지난 값은 뺀다(5.1절의 곁말)"""
    out = []
    for cl in _CLAUSE.split(text):
        ex, sh = spoken_amounts(cl, unit, exclude)
        vals = set(ex) | set(sh)
        if unit:
            vals |= {int(m.group(1)) * unit for m in _ONE.finditer(cl) if int(m.group(1)) not in exclude}
        if not vals:
            continue
        kind = "now"
        if cues:
            if _DISCOUNT.search(cl) or _PAST.search(cl):
                continue
            if _PER.search(cl):
                kind = "per"
        out += [(v, kind) for v in sorted(vals)]
    return out


def ledger_pick(lines, ledger, nicks, no):
    """줄들 [(초, 글)]에서 들린 장부 이름 → (이름 또는 None, 서로 다른 두 마디에서 들렸나). 가장 많이 들린 이름이 하나일 때만(6.2절)"""
    c, nl = collections.Counter(), collections.Counter()
    for one in lines:
        got = V.ledger_said([one], ledger, nicks, no) if ledger else {}
        c.update(got)
        nl.update(set(got))
    top = sorted(c.items(), key=lambda kv: -kv[1])
    pick = top[0][0] if top and (len(top) == 1 or top[0][1] > top[1][1]) else None
    return pick, bool(pick) and nl[pick] >= 2


def new_state():
    """실행을 넘어 이어지는 상태(방송 중 일꾼을 다시 켠 재현)"""
    return {"recs": {}, "run": 0, "band": None, "confirmed": [], "prices": [], "stats": collections.Counter()}


class FastPath:
    """빠른 길 한 실행. lines = 받아쓴 줄 [(시작 초, 끝 초, 글)] — 부르는 쪽이 늘려 가는 같은 목록(앞 줄만 본다)"""

    def __init__(self, lines, unit, state=None, tag_only=True, cues=True, crowd=TAG_CROWD):
        self.lines, self.unit = lines, unit
        self.state = state if state is not None else new_state()
        self.recs, self.k_run, self.stats = self.state["recs"], self.state["run"], self.state["stats"]
        self.tag_only, self.cues, self.crowd = tag_only, cues, crowd
        self.recent_said = []                                # [(초, 번호)] 말로 들린 번호
        self.pending = {}                                    # 번호대 밖인데 말로 들린 번호 → (초, 줄): 딱지가 받쳐 주면 올린다
        self.orphans = []                                    # [(초, 금액, 줄)] 주인 없는 금액
        self.t_scr = None                                    # 마지막으로 본 화면 초
        self.changes = []                                    # [(종류, 번호, 덧붙임)] 종류: open·confirm·price·withdraw·card

    # ---------- 조각 ----------
    def reads(self, no, t, win, cand):
        return full_frames(no, range(t - win + 1, t + 1), cand, self.state["band"])

    @staticmethod
    def front(t0, t1, mains):
        c = collections.Counter(mains.get(j) for j in range(int(t0), int(t1) + 1) if mains.get(j) is not None)
        return c.most_common(1)[0][0] if c else None

    def rec_of(self, no):
        return self.recs.get(no)

    def live(self, no):
        r = self.recs.get(no)
        return r is not None and r["state"] != "거둠"

    def open_rec(self, no, t, src, line=None):
        r = self.recs.get(no)
        if r is not None and r["state"] != "거둠":
            return r
        if r is not None and src == "딱지만":               # 딱지만으로 올렸다 거둔 번호는 말이 들릴 때만 다시 올린다
            return None
        r = {"no": no, "run": self.k_run, "t": t, "src": src, "state": "확인 중", "t_ok": None, "why_ok": None, "withdrawn": (r or {}).get("withdrawn", 0),
             "first_t": (r or {}).get("first_t", (self.k_run, t)), "first_src": (r or {}).get("first_src", src),
             "price": None, "price_t": None, "price_state": None, "price_first": None, "price_with": {}, "cands": [], "card": set(),
             "line0": line if line is not None else len([1 for _, e, _ in self.lines if e <= t]) - 1, "wait_llm": False}
        self.recs[no] = r
        self.changes.append(("open", no, src))
        return r

    def confirm(self, r, t, why):
        if r["state"] == "확인 중":
            r["state"], r["t_ok"], r["why_ok"] = "판매 중", t, why
            r.pop("mismatch", None)
            self.state["confirmed"].append(r["no"])
            self.state["band"] = band_of(self.state["confirmed"])
            self.changes.append(("confirm", r["no"], why))

    def card(self, r, kind):
        if kind not in r["card"]:
            r["card"].add(kind)
            self.changes.append(("card", r["no"], kind))

    def add_price(self, r, v, t, line, with_no, kind):
        r["cands"].append((t, v, kind, with_no, line))
        if kind != "now":
            return
        before = (r["price"], r["price_state"])
        vals = {c[1] for c in r["cands"] if c[2] == "now"}
        if any(a * 10 in vals for a in vals):
            self.card(r, "열 배")
        if with_no:
            r["price_with"].setdefault(v, set()).add((self.k_run, line))
        if r["price_state"] == "맞음":
            if v != r["price"]:
                r["changed"] = True                          # 값이 바뀜(물음 C): 번호와 같이 들렸으면 카드까지
                if with_no:
                    self.card(r, "값이 바뀜")
            return
        if r["price"] is None or with_no or not r.get("price_by_no"):
            if r["price"] is None:
                r["price_first"], r["price_first_t"] = v, t
            r["price"], r["price_t"], r["price_state"] = v, t, "들림"
            r["price_by_no"] = bool(with_no) or r.get("price_by_no", False)
        if len(r["price_with"].get(v, ())) >= 2 and "열 배" not in r["card"] and not out_of_range(v, self.state["prices"]):
            r["price"], r["price_state"], r["price_ok_t"] = v, "맞음", t
            self.state["prices"].append(v)
        if (r["price"], r["price_state"]) != before:
            self.changes.append(("price", r["no"], (r["price"], r["price_state"])))

    # ---------- 화면 한 초 ----------
    def screen(self, t, cand, mains):
        self.t_scr = t if self.t_scr is None else max(self.t_scr, t)
        seen = cand.get(t, ())
        for no in set(seen):
            r = self.rec_of(no)
            if self._pending_check(no, t, cand):
                continue
            if r is not None and r["state"] == "확인 중" and self.reads(no, t, TAG_OK_WIN, cand) >= TAG_OK and r["src"] != "딱지만":
                self.confirm(r, t, "딱지 3번")
            elif (r is None or r["state"] == "거둠") and self.tag_only and in_band(no, self.state["band"]) and mains.get(t) == no \
                    and self.reads(no, t, TAG_WIN, cand) >= TAG_NEED and len({n for j in range(t - TAG_WIN + 1, t + 1) for n in cand.get(j, ())}) <= self.crowd:
                if self.open_rec(no, t, "딱지만") is not None:
                    self.stats["올림: 딱지만"] += 1

    def _pending_check(self, no, t, cand):
        """번호대 밖인데 말로 들린 번호: 딱지가 10초 안에 3번 받쳐 주면 올리고 번호 맞음"""
        r = self.rec_of(no)
        if no in self.pending and (r is None or r["state"] == "거둠") and t - self.pending[no][0] <= HOLD and self.reads(no, t, TAG_OK_WIN, cand) >= TAG_OK:
            r = self.open_rec(no, t, "말 + 딱지(번호대 밖)", self.pending.pop(no)[1])
            self.stats["올림: 말 + 딱지(번호대 밖)"] += 1
            self.confirm(r, t, "번호대 밖: 말 + 딱지 3번")
            return True
        return False

    def catch_up(self, nos, t0, cand):
        """라이브: 화면이 받아쓰기보다 앞서 왔다 — 줄이 연(또는 기다리게 한) 번호의 "딱지 3번"을 t0 ~ 지금 본 화면 초까지 한 번 더 본다"""
        if self.t_scr is None:
            return
        for t in range(t0, self.t_scr + 1):
            for no in nos:
                if no not in cand.get(t, ()):
                    continue
                if self._pending_check(no, t, cand):
                    continue
                r = self.rec_of(no)
                if r is not None and r["state"] == "확인 중" and self.reads(no, t, TAG_OK_WIN, cand) >= TAG_OK and r["src"] != "딱지만":
                    self.confirm(r, t, "딱지 3번")

    # ---------- 받아쓴 줄 하나 (그 줄이 끝난 다음 초 t에 들어옴) ----------
    def line(self, t, i, cand, mains):
        s, e, text = self.lines[i]
        rec_of, state = self.rec_of, self.state
        vis = {n for j in range(int(s) - 5, t + 1) for n in cand.get(j, ())}
        said_all = list(dict.fromkeys(numbers_with_beon(text)))
        said = [n for n in said_all if in_band(n, state["band"]) or (rec_of(n) is not None and rec_of(n)["state"] != "거둠")]
        for no in said_all:
            if no not in said:
                if self.reads(no, t, TAG_OK_WIN, cand) >= TAG_OK:
                    self.open_rec(no, t, "말 + 딱지(번호대 밖)", i)
                    self.stats["올림: 말 + 딱지(번호대 밖)"] += 1
                    self.confirm(rec_of(no), t, "번호대 밖: 말 + 딱지 3번")
                    said.append(no)
                else:
                    self.pending[no] = (t, i)
                    self.stats["번호대 밖이라 올리지 않은 말"] += 1
        bare = [n for n in dict.fromkeys(numbers_bare(text)) if n not in said and n in vis and in_band(n, state["band"])]
        fr = self.front(s - 3, t, mains)
        for no in said:
            self.recent_said.append((t, no))
            r = rec_of(no)
            fresh = r is None or r["state"] == "거둠"
            if fresh:
                r = self.open_rec(no, t, "말", i)
                self.stats["올림: 말"] += 1
            if r["state"] == "확인 중":
                pair = digit_pair(no, fr) if fr is not None and fr != no else None
                other = rec_of(fr) if fr is not None and fr != no else None
                if r["src"] == "딱지만":
                    self.confirm(r, t, "딱지 + 말")
                elif fr is None or fr == no:
                    self.confirm(r, t, "말 + 딱지 같음" if fr == no else "말 + 딱지 없음")
                elif pair in EYE_PAIRS:
                    self.confirm(r, t, "숫자 쌍: 말")
                elif pair in EAR_PAIRS and (other is None or other["state"] != "판매 중"):
                    o = self.open_rec(fr, t, "말(화면으로 바로잡음)", i)      # 화면 번호 쪽을 올린다
                    if o is not None and o["state"] == "확인 중":
                        self.confirm(o, t, "숫자 쌍: 화면")
                    self.stats["숫자 쌍으로 화면 번호를 올림"] += 1
                elif other is not None and other["state"] == "판매 중" and t - (other["t_ok"] or t) > OPEN and pair is None and fr not in said_all:
                    self.confirm(r, t, "말 + 앞 딱지는 이미 판매 중인 번호")
                else:
                    r["mismatch"] = fr                         # 말과 앞 딱지가 다르다 — 번호를 맞음으로 올리지 않는다
                    if fresh:
                        self.stats["말과 앞 딱지가 다름"] += 1
                    if not fresh and (self.k_run, i) != r.get("said_line"):
                        self.card(r, "말과 화면이 다름")
                        r["keep"] = True                       # 두 번 들렸으니 거두지 않고 판매자에게 묻는다
                r.setdefault("said_line", (self.k_run, i))
        for no in bare:
            self.recent_said.append((t, no))
            r = rec_of(no)
            if r is None or r["state"] == "거둠":
                r = self.open_rec(no, t, "번 없는 수 + 딱지", i)
                self.stats["올림: 번 없는 수 + 딱지"] += 1
            if r["state"] == "확인 중" and (r["src"] == "딱지만" or self.reads(no, t, TAG_OK_WIN, cand) >= TAG_OK):
                self.confirm(r, t, "번 없는 수 + 딱지 3번")
        nos = said + bare
        am = amounts(text, self.unit, set(nos) | vis | set(numbers_with_beon(text)), self.cues)
        now_vals = sorted({v for v, k in am if k == "now"})
        if nos:
            for no in nos:                                     # 번호가 먼저 잡히기 전에 들린 주인 없는 금액
                r = rec_of(no)
                for ot, ov, ol in [o for o in self.orphans if t - o[0] <= OPEN]:
                    self.add_price(r, ov, t, ol, False, "now")
            self.orphans = []
            if len(nos) == 1 and len(now_vals) == 1 and len(am) == 1:
                self.add_price(rec_of(nos[0]), now_vals[0], t, i, True, "now")
            elif am:
                for no in nos:
                    r = rec_of(no)
                    for v, k in am:
                        r["cands"].append((t, v, "여럿", True, i))
                    r["ask_now"] = True
        elif am:
            live = {n for tt, n in self.recent_said if t - tt <= OPEN}
            tagf = self.front(max(s, t - 5), t, mains)
            if not live and tagf is not None and rec_of(tagf) is not None and rec_of(tagf)["state"] != "거둠":
                live = {tagf}
            if len(live) == 1 and len(now_vals) == 1 and len(am) == 1:
                r = rec_of(next(iter(live)))
                if r is not None and r["state"] != "거둠":
                    self.add_price(r, now_vals[0], t, i, False, "now")
                    if r["src"] == "딱지만":
                        r["wait_llm"] = True
            elif len(live) == 1:
                r = rec_of(next(iter(live)))
                if r is not None:
                    for v, k in am:
                        r["cands"].append((t, v, "여럿" if k == "now" else k, False, i))
            elif not live:
                self.orphans += [(t, v, i) for v in now_vals]
                self.stats["주인 없는 금액"] += len(now_vals)
        self.recent_said = [x for x in self.recent_said if t - x[0] <= OPEN]
        if self.t_scr is not None and self.t_scr >= t:
            self.catch_up(set(said_all) | set(bare) | {n for n in (fr,) if n is not None}, t + 1, cand)

    # ---------- 거두기 ----------
    def sweep(self, t):
        for r in self.recs.values():
            if r["run"] == self.k_run and r["state"] == "확인 중" and t - r["t"] >= HOLD and not r["wait_llm"] and not r.get("keep"):
                r["state"], r["t_out"] = "거둠", t
                r["withdrawn"] += 1
                self.changes.append(("withdraw", r["no"], None))

    def take(self):
        out, self.changes = self.changes, []
        return out
