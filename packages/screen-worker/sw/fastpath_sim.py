# 빠른 길 재현 (D-RECOG-01·03, 설계 문서 docs/retro/2026-11-16-recognition-redesign.md 4~6절·12.1절):
# 끝난 방송의 일꾼 기록(transcript.jsonl·screen.jsonl·events.jsonl)을 그때 시각대로 다시 흘려,
# LLM 없이 규칙만으로 "번호가 잡히면 가격 없이도 확인 중으로 올리고 금액·품종을 칸마다 붙이면" 무엇이 언제 올라갔을지를 잰다.
#  - 순수 계산: 시계·난수·서버·LLM을 쓰지 않는다. 받아쓴 줄은 그 줄의 끝 초에, 화면 한 장은 그 초에 들어온 것으로 본다(줄 도착 기준).
#  - 번호·금액·장부 읽기는 일꾼의 함수(decide·reg_rules·price·variety)를 그대로 쓴다. 여기에는 "언제 올리고 언제 맞음으로 보나"만 있다.
#  - 화면의 배경 숫자 거르기(같은 자리 20분)는 방송 전체를 보고 한 것이라 그 부분만 뒤를 미리 안다.
#  - 정답 파일: {"번호": {"prices": [원], "names": [품종]}} — 손님 이름은 넣지 않는다. 결과에는 번호·금액·품종·수치만 적는다.
# 사용: python -m sw.fastpath_sim --runs 실행폴더… --truth truth.json [--ledger 장부.json] [--half 홀수장부 짝수장부] [--out 결과.json]
import argparse
import collections
import difflib
import json
import os
import re

from . import variety as V
from .decide import numbers_bare, numbers_with_beon
from .price import prices_in, seller_unit
from .reg_rules import band_of, digit_pair, EAR_PAIRS, EYE_PAIRS, full_frames, in_band, out_of_range, spoken_amounts
from .screen import Screen

HOLD = 60            # 확인 중으로 올리고 둘째 근거를 기다리는 시간(초)
OPEN = 10            # 번호를 말한 뒤 이만큼은 그 상품이 "열려 있다"(번호 없는 금액의 주인)
TAG_WIN, TAG_NEED = 8, 5       # 딱지만으로 올릴 때: 8초 안에 5번
TAG_OK_WIN, TAG_OK = 10, 3     # 딱지가 둘째 근거가 될 때: 10초 안에 3번
TAG_CROWD = 3        # 딱지만으로 올릴 때: 그 8초에 보인 번호가 이만큼까지일 때만(진열대를 훑는 화면에서는 올리지 않는다)
NAME_WAIT = 25       # 품종 묻기가 나갈 때(초)

_CLAUSE = re.compile(r"(?<=[.?!])\s+")
_DISCOUNT = re.compile(r"빼\s?드|빼\s?줄|빼\s?주|깎|할인|디씨|에누리")
_PAST = re.compile(r"했었|갔죠|갔었|갔던|갔는데|아까|원래|저번")
_PER = re.compile(r"씩|\d\s?개|[한두세네]\s?개|하나에|개에")
_GO = re.compile(r"\s*(?:만\s?원)?\s*(?:에\s)?(?:갑니다|가요|갈게요|가겠습니다|가려요|갈께요|드릴게요|드립니다)")
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


# ---------- 채점(품종): 실험실 채점과 같은 등급 ----------
_AFF = ("복륜금", "색금종자", "녹색금", "색금", "창금", "녹금", "찐녹", "철화", "산반", "복륜", "종자", "무지", "수박", "힘줄", "금")
_GEN = {"색금", "녹금", "SP", "종자", "찐녹", "녹색금", "창녹금", "창색금", "금", "창금", "SP녹금", "SP색금", "종자녹금", "종자색금", "종자찐녹", "종자녹색금", "녹금종자", "색금종자"}
_nrm = lambda s: re.sub(r"\s+", "", (s or "")).upper()
_strip = lambda n: re.sub(r"(\d+개|통째|통채|,.*)$", "", re.sub(r"[·ㆍ]", "", _nrm(n)))


def _base(n):
    n = _strip(n)
    if n in _GEN:
        return ""
    ch = True
    while ch:
        ch = False
        for x in _AFF:
            if n.endswith(x) and len(n) - len(x) >= 2:
                n, ch = n[:-len(x)], True
                break
    return n


def _sim(x, y):
    return difflib.SequenceMatcher(None, V.jamo(x), V.jamo(y)).ratio()


def name_ok(d, names):
    """받아 적은 이름이 정답 품종 가운데 하나와 같은 이름인가(무늬 말은 같은 것으로 본다)"""
    for t in names:
        d0, t0 = _strip(d), _strip(t)
        if not d0:
            return False
        bd, bt = _base(d), _base(t)
        if d0 == t0 or (bd and bt and (bd == bt or _sim(bd, bt) >= 0.8)) or _sim(d0, t0) >= 0.82:
            return True
    return False


# ---------- 한 방송 흘리기 ----------
def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]


def spot_name(text, no, nicks):
    """장부에 없는 이름 자리 찾기(6.2절): "N번"과 금액 사이의 말. 닉네임·군말·무늬 말뿐이면 None"""
    m = re.search(rf"(?<!\d){no}\s*번\s*(?:은|는|이|도)?\s*([가-힣A-Za-z ]{{2,14}})", text)
    if not m:
        return None
    words = [w for w in m.group(1).split() if w not in V._STOP][:2]
    for k in (2, 1):
        name = V.tidy("".join(words[:k]))
        base = V.split_parts(name)[0]
        if len(words) >= k and base and len(V.norm(base)) >= 2 and not V.not_a_name(base, nicks) and not _GO.match(base):
            return name
    return None


def simulate(run, state, ledger=None, tag_only=True, cues=True, crowd=TAG_CROWD):
    """실행 폴더 하나 → 그 실행의 상품 기록을 state["recs"]에 쌓는다. state는 실행을 넘어 이어진다(일꾼을 다시 켠 방송)"""
    lines = [(x["start_sec"], x["end_sec"], x["text"]) for x in read_jsonl(os.path.join(run, "transcript.jsonl"))]
    scr = Screen()
    for x in read_jsonl(os.path.join(run, "screen.jsonl")):
        toks = [tuple(z) for z in x.get("t", []) if str(z[0]).isdigit() or isinstance(z[0], int)]
        scr.add(int(x["sec"]), [(int(z[0]),) + tuple(z[1:]) for z in toks])
    _, cand, mains = scr.build()
    unit = seller_unit([(s, x) for s, _, x in lines])
    nicks = V.nicknames([(s, x) for s, _, x in lines])
    recs, k_run = state["recs"], state["run"]
    by_sec = collections.defaultdict(list)
    for i, (s, e, x) in enumerate(lines):
        by_sec[int(e) + 1].append(i)
    last = max([int(e) + 1 for _, e, _ in lines] + list(cand) + [0])
    recent_said = []                                    # [(초, 번호)] 말로 들린 번호
    pending = {}                                        # 번호대 밖인데 말로 들린 번호 → (초, 줄): 딱지가 받쳐 주면 올린다
    orphans = []                                        # [(초, 금액, 줄)] 주인 없는 금액
    stats = state["stats"]

    def reads(no, t, win):
        return full_frames(no, range(t - win + 1, t + 1), cand, state["band"])

    def front(t0, t1):
        c = collections.Counter(mains.get(j) for j in range(int(t0), int(t1) + 1) if mains.get(j) is not None)
        return c.most_common(1)[0][0] if c else None

    def rec_of(no):
        return recs.get(no)

    def open_rec(no, t, src, line=None):
        r = recs.get(no)
        if r is not None and r["state"] != "거둠":
            return r
        if r is not None and src == "딱지만":         # 딱지만으로 올렸다 거둔 번호는 말이 들릴 때만 다시 올린다
            return None
        r = {"no": no, "run": k_run, "t": t, "src": src, "state": "확인 중", "t_ok": None, "why_ok": None, "withdrawn": (r or {}).get("withdrawn", 0),
             "first_t": (r or {}).get("first_t", (k_run, t)), "first_src": (r or {}).get("first_src", src),
             "price": None, "price_t": None, "price_state": None, "price_first": None, "price_with": {}, "cands": [], "card": set(),
             "line0": line if line is not None else len([1 for _, e, _ in lines if e <= t]) - 1, "wait_llm": False}
        recs[no] = r
        return r

    def confirm(r, t, why):
        if r["state"] == "확인 중":
            r["state"], r["t_ok"], r["why_ok"] = "판매 중", t, why
            state["confirmed"].append(r["no"])
            state["band"] = band_of(state["confirmed"])

    def add_price(r, v, t, line, with_no, kind):
        r["cands"].append((t, v, kind, with_no, line))
        if kind != "now":
            return
        vals = {c[1] for c in r["cands"] if c[2] == "now"}
        if any(a * 10 in vals for a in vals):
            r["card"].add("열 배")
        if with_no:
            r["price_with"].setdefault(v, set()).add((k_run, line))
        if r["price_state"] == "맞음":
            if v != r["price"]:
                r["changed"] = True                            # 값이 바뀜(물음 C): 번호와 같이 들렸으면 카드까지
                if with_no:
                    r["card"].add("값이 바뀜")
            return
        if r["price"] is None or with_no or not r.get("price_by_no"):
            if r["price"] is None:
                r["price_first"], r["price_first_t"] = v, t
            r["price"], r["price_t"], r["price_state"] = v, t, "들림"
            r["price_by_no"] = bool(with_no) or r.get("price_by_no", False)
        if len(r["price_with"].get(v, ())) >= 2 and "열 배" not in r["card"] and not out_of_range(v, state["prices"]):
            r["price"], r["price_state"], r["price_ok_t"] = v, "맞음", t
            state["prices"].append(v)

    for t in range(0, last + HOLD + 2):
        # --- 화면 ---
        seen = cand.get(t, ())
        for no in set(seen):
            r = rec_of(no)
            if no in pending and (r is None or r["state"] == "거둠") and t - pending[no][0] <= HOLD and reads(no, t, TAG_OK_WIN) >= TAG_OK:
                r = open_rec(no, t, "말 + 딱지(번호대 밖)", pending.pop(no)[1])
                stats["올림: 말 + 딱지(번호대 밖)"] += 1
                confirm(r, t, "번호대 밖: 말 + 딱지 3번")
                continue
            if r is not None and r["state"] == "확인 중" and reads(no, t, TAG_OK_WIN) >= TAG_OK and r["src"] != "딱지만":
                confirm(r, t, "딱지 3번")
            elif (r is None or r["state"] == "거둠") and tag_only and in_band(no, state["band"]) and mains.get(t) == no \
                    and reads(no, t, TAG_WIN) >= TAG_NEED and len({n for j in range(t - TAG_WIN + 1, t + 1) for n in cand.get(j, ())}) <= crowd:
                if open_rec(no, t, "딱지만") is not None:
                    stats["올림: 딱지만"] += 1
        # --- 받아쓴 줄 ---
        for i in by_sec.get(t, ()):
            s, e, text = lines[i]
            vis = {n for j in range(int(s) - 5, t + 1) for n in cand.get(j, ())}
            said_all = list(dict.fromkeys(numbers_with_beon(text)))
            said = [n for n in said_all if in_band(n, state["band"]) or (rec_of(n) is not None and rec_of(n)["state"] != "거둠")]
            for no in said_all:
                if no not in said:
                    if reads(no, t, TAG_OK_WIN) >= TAG_OK:
                        open_rec(no, t, "말 + 딱지(번호대 밖)", i)
                        stats["올림: 말 + 딱지(번호대 밖)"] += 1
                        confirm(rec_of(no), t, "번호대 밖: 말 + 딱지 3번")
                        said.append(no)
                    else:
                        pending[no] = (t, i)
                        stats["번호대 밖이라 올리지 않은 말"] += 1
            bare = [n for n in dict.fromkeys(numbers_bare(text)) if n not in said and n in vis and in_band(n, state["band"])]
            fr = front(s - 3, t)
            for no in said:
                recent_said.append((t, no))
                r = rec_of(no)
                fresh = r is None or r["state"] == "거둠"
                if fresh:
                    r = open_rec(no, t, "말", i)
                    stats["올림: 말"] += 1
                if r["state"] == "확인 중":
                    pair = digit_pair(no, fr) if fr is not None and fr != no else None
                    other = rec_of(fr) if fr is not None and fr != no else None
                    if r["src"] == "딱지만":
                        confirm(r, t, "딱지 + 말")
                    elif fr is None or fr == no:
                        confirm(r, t, "말 + 딱지 같음" if fr == no else "말 + 딱지 없음")
                    elif pair in EYE_PAIRS:
                        confirm(r, t, "숫자 쌍: 말")
                    elif pair in EAR_PAIRS and (other is None or other["state"] != "판매 중"):
                        o = open_rec(fr, t, "말(화면으로 바로잡음)", i)      # 화면 번호 쪽을 올린다
                        if o is not None and o["state"] == "확인 중":
                            confirm(o, t, "숫자 쌍: 화면")
                        stats["숫자 쌍으로 화면 번호를 올림"] += 1
                    elif other is not None and other["state"] == "판매 중" and t - (other["t_ok"] or t) > OPEN and pair is None and fr not in said_all:
                        confirm(r, t, "말 + 앞 딱지는 이미 판매 중인 번호")
                    else:
                        if fresh:
                            stats["말과 앞 딱지가 다름"] += 1
                        if not fresh and (k_run, i) != r.get("said_line"):
                            r["card"].add("말과 화면이 다름")
                            r["keep"] = True                       # 두 번 들렸으니 거두지 않고 판매자에게 묻는다
                    r.setdefault("said_line", (k_run, i))
            for no in bare:
                recent_said.append((t, no))
                r = rec_of(no)
                if r is None or r["state"] == "거둠":
                    r = open_rec(no, t, "번 없는 수 + 딱지", i)
                    stats["올림: 번 없는 수 + 딱지"] += 1
                if r["state"] == "확인 중" and (r["src"] == "딱지만" or reads(no, t, TAG_OK_WIN) >= TAG_OK):
                    confirm(r, t, "번 없는 수 + 딱지 3번")
            nos = said + bare
            am = amounts(text, unit, set(nos) | vis | set(numbers_with_beon(text)), cues)
            now_vals = sorted({v for v, k in am if k == "now"})
            if nos:
                for no in nos:                             # 번호가 먼저 잡히기 전에 들린 주인 없는 금액
                    r = rec_of(no)
                    for ot, ov, ol in [o for o in orphans if t - o[0] <= OPEN]:
                        add_price(r, ov, t, ol, False, "now")
                orphans = []
                if len(nos) == 1 and len(now_vals) == 1 and len(am) == 1:
                    add_price(rec_of(nos[0]), now_vals[0], t, i, True, "now")
                elif am:
                    for no in nos:
                        r = rec_of(no)
                        for v, k in am:
                            r["cands"].append((t, v, "여럿", True, i))
                        r["ask_now"] = True
            elif am:
                live = {n for tt, n in recent_said if t - tt <= OPEN}
                tagf = front(max(s, t - 5), t)
                if not live and tagf is not None and rec_of(tagf) is not None and rec_of(tagf)["state"] != "거둠":
                    live = {tagf}
                if len(live) == 1 and len(now_vals) == 1 and len(am) == 1:
                    r = rec_of(next(iter(live)))
                    if r is not None and r["state"] != "거둠":
                        add_price(r, now_vals[0], t, i, False, "now")
                        if r["src"] == "딱지만":
                            r["wait_llm"] = True
                elif len(live) == 1:
                    r = rec_of(next(iter(live)))
                    if r is not None:
                        for v, k in am:
                            r["cands"].append((t, v, "여럿" if k == "now" else k, False, i))
                elif not live:
                    orphans += [(t, v, i) for v in now_vals]
                    stats["주인 없는 금액"] += len(now_vals)
            recent_said = [x for x in recent_said if t - x[0] <= OPEN]
        # --- 거두기 ---
        for r in recs.values():
            if r["run"] == k_run and r["state"] == "확인 중" and t - r["t"] >= HOLD and not r["wait_llm"] and not r.get("keep"):
                r["state"], r["t_out"] = "거둠", t
                r["withdrawn"] += 1
    # --- 품종(빠른 길): 장부 이름 찾기 ---
    plain = [(s, x) for s, _, x in lines]
    for r in recs.values():
        if r["run"] != k_run or "name" in r:
            continue
        i0 = max(0, r["line0"])
        near = plain[max(0, i0 - 1):i0 + 2]
        t0 = lines[i0][1] if lines else 0
        j = i0 + 1
        while j < len(lines) and lines[j][1] <= t0 + NAME_WAIT and not [n for n in numbers_with_beon(lines[j][2]) if n != r["no"]]:
            j += 1
        later = plain[max(0, i0 - 1):j]
        for key, ls in (("name", near), ("name25", later)):
            r[key] = {}
            for tag, led in ledger.items():
                c, nl = collections.Counter(), collections.Counter()
                for one in ls:
                    got = V.ledger_said([one], led, nicks, r["no"]) if led else {}
                    c.update(got)
                    nl.update(set(got))
                top = sorted(c.items(), key=lambda kv: -kv[1])
                pick = top[0][0] if top and (len(top) == 1 or top[0][1] > top[1][1]) else None
                r[key][tag] = {"name": pick, "twice": bool(pick) and nl[pick] >= 2}
        r["spot"] = spot_name(lines[i0][2], r["no"], nicks) if lines else None
        pats = V.pattern_said(later)
        r["pattern"] = pats.most_common(1)[0][0] if pats else None
    state["run"] += 1
    return {"lines": len(lines), "sec": last, "unit": unit}


# ---------- 채점 ----------
def pct(q, xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None


def old_registrations(runs):
    """그날 일꾼이 처음 서버로 보낸 때: 번호 → (실행, 보낸 초, 그 줄의 끝 초, 금액)"""
    out = {}
    for k, run in enumerate(runs):
        for e in read_jsonl(os.path.join(run, "events.jsonl")):
            if e.get("kind") == "LLM등록" and e.get("sent") is True and e.get("line_end_sec") is not None and e.get("wait_sec") is not None:
                out.setdefault(int(e["no"]), (k, float(e["line_end_sec"]) + float(e["wait_sec"]), float(e["line_end_sec"]), e.get("price")))
    return out


def score(recs, truth, old, half):
    m = collections.OrderedDict()
    T = {int(k): v for k, v in truth.items()}
    reg = {n: r for n, r in recs.items()}
    ever = set(reg)
    good = sorted(n for n in T if n in reg and reg[n]["state"] == "판매 중")
    left = sorted(n for n in T if n in reg and reg[n]["state"] == "확인 중")
    out = sorted(n for n in T if n in reg and reg[n]["state"] == "거둠")
    m["정답 상품 수"] = len(T)
    m["올라온 정답 번호(확인 중으로라도)"] = len([n for n in T if n in ever])
    m["놓친 번호(한 번도 안 올라옴)"] = sorted(n for n in T if n not in ever)
    m["번호 맞음(판매 중)까지 간 정답"] = len(good)
    m["확인 중으로 남은 정답(LLM 답을 기다림)"] = left
    m["거둬진 채 끝난 정답"] = out
    ghosts = sorted(n for n in reg if n not in T)
    m["없는 번호: 올라온 수"] = len(ghosts)
    m["없는 번호: 상품 대비 %"] = round(100 * len(ghosts) / max(1, len(T)), 1)
    m["없는 번호: 어디서"] = dict(collections.Counter(reg[n]["first_src"] for n in ghosts))
    m["없는 번호: 60초 안에 거둠"] = len([n for n in ghosts if reg[n]["state"] == "거둠"])
    m["없는 번호: 판매 중까지 감(틀린 확정)"] = sorted(n for n in ghosts if reg[n]["state"] == "판매 중")
    m["없는 번호: 확인 중으로 남음"] = sorted(n for n in ghosts if reg[n]["state"] == "확인 중")
    m["정답 번호가 처음 올라온 길"] = dict(collections.Counter(reg[n]["first_src"] for n in T if n in reg))
    m["정답 번호가 한 번 거둬졌다 다시 올라옴"] = len([n for n in T if n in reg and reg[n]["withdrawn"] and reg[n]["state"] != "거둠"])
    # 시간: 둘 중 먼저 안 때를 기준으로
    gain, new_d, old_d, later = [], [], [], []
    for n in T:
        if n in reg and n in old and reg[n]["first_t"][0] == old[n][0]:
            tn, (k, to, tl, _) = reg[n]["first_t"][1], old[n]
            ref = min(tn, tl)
            new_d.append(tn - ref); old_d.append(to - ref); gain.append(to - tn)
            if tn > to:
                later.append(n)
    m["견줄 수 있는 상품(그날도 올라온 것)"] = len(gain)
    m["처음 보이기: 새 길(초) 가운데/90%"] = [pct(.5, new_d), pct(.9, new_d)]
    m["처음 보이기: 그날 일꾼(초) 가운데/90%"] = [round(pct(.5, old_d), 1) if old_d else None, round(pct(.9, old_d), 1) if old_d else None]
    m["그날보다 앞당겨진 시간(초) 가운데/90%"] = [round(pct(.5, gain), 1) if gain else None, round(pct(.9, gain), 1) if gain else None]
    m["그날보다 늦게 올라온 번호"] = sorted(later)
    ok_wait = [reg[n]["t_ok"] - reg[n]["t"] for n in good if reg[n]["t_ok"] is not None]
    m["올림 → 번호 맞음(초) 가운데/90%"] = [pct(.5, ok_wait), pct(.9, ok_wait)]
    # 가격
    P = [n for n in T if n in reg and T[n]["prices"]]
    has = [n for n in P if reg[n]["price"] is not None]
    first_ok = [n for n in has if reg[n]["price_first"] in T[n]["prices"]]
    last_ok = [n for n in has if reg[n]["price"] in T[n]["prices"]]
    fixed = [n for n in has if reg[n]["price_state"] == "맞음"]
    m["가격: 정답 가격이 있는 올라온 상품"] = len(P)
    m["가격: 빠른 길이 값을 붙인 상품"] = len(has)
    m["가격: 처음 붙인 값이 맞음"] = len(first_ok)
    m["가격: 끝에 남은 값이 맞음"] = len(last_ok)
    m["가격: 규칙만으로 맞음(같은 값 두 마디)"] = len(fixed)
    m["가격: 규칙만으로 맞음인데 틀린 값"] = sorted(n for n in fixed if reg[n]["price"] not in T[n]["prices"])
    m["가격: 그중 뒤에 다른 값이 들려 값이 바뀜 물음(C)이 걸린 것"] = sorted(n for n in fixed if reg[n]["price"] not in T[n]["prices"] and reg[n].get("changed"))
    m["LLM 물음 C(값이 바뀜)가 걸린 상품"] = len([n for n in reg if reg[n].get("changed")])
    both = [n for n in P if n in old and old[n][3] is not None]
    m["가격: 그날 일꾼과 견줌(둘 다 올린 상품) 상품 수 / 그날 첫 등록 값 맞음 / 새 길 처음 값 맞음 / 새 길 값 없음"] = [
        len(both), len([n for n in both if int(old[n][3]) in T[n]["prices"]]), len([n for n in both if n in first_ok]), len([n for n in both if n not in has])]
    follow = {}
    for n in has:                                             # 값이 바뀜을 따랐다면: 번호와 같이 들린 마지막 지금 값
        w = [c[1] for c in reg[n]["cands"] if c[2] == "now" and c[3]]
        follow[n] = w[-1] if w else reg[n]["price"]
    m["가격: 번호와 같이 들린 마지막 값을 따랐다면 맞음"] = len([n for n in has if follow[n] in T[n]["prices"]])
    m["가격: 들린 후보 안에 정답"] = len([n for n in P if any(c[1] in T[n]["prices"] for c in reg[n]["cands"])])
    m["가격: 값 없음(후보도 없음)"] = len([n for n in P if not reg[n]["cands"]])
    pw = [reg[n]["price_first_t"] - reg[n]["t"] for n in has if reg[n].get("price_first_t") is not None and reg[n]["price_first_t"] >= reg[n]["t"]]
    m["가격: 올림 → 값 붙음(초) 가운데/90%"] = [pct(.5, pw), pct(.9, pw)]
    m["가격: 올릴 때 값이 같이 붙음"] = len([x for x in pw if x == 0])
    # 품종
    N = [n for n in T if n in reg and T[n]["names"]]
    m["품종: 채점 대상"] = len(N)
    for tag in next(iter(reg.values()))["name"] if reg else ():
        for key, label in (("name", "바로(같은·옆 마디)"), ("name25", "25초 안")):
            use = lambda n: reg[n][key][(tag if not half else ("홀수 장부" if n % 2 == 0 else "짝수 장부"))]
            got = [n for n in N if use(n)["name"]]
            ok = [n for n in got if name_ok(use(n)["name"], T[n]["names"])]
            tw = [n for n in got if use(n)["twice"]]
            m[f"품종[{'절반 장부' if half else tag}] {label}: 붙음 / 맞음 / 두 번 들림 / 두 번 들림 중 맞음"] = [len(got), len(ok), len(tw), len([n for n in tw if n in ok])]
        if half:
            break
    spot = [n for n in N if reg[n]["spot"]]
    m["품종[장부 없음] 자리 규칙: 붙음 / 맞음"] = [len(spot), len([n for n in spot if name_ok(reg[n]["spot"], T[n]["names"])])]
    # 물음·카드
    A = [n for n in reg if reg[n]["state"] != "거둠" and reg[n]["price_state"] != "맞음"]
    cards = collections.Counter(c for r in reg.values() if r["state"] != "거둠" for c in r["card"])
    m["LLM 물음 A(가격 맞추기)가 필요한 상품"] = len(A)
    tag0 = None if half or not reg else next(iter(next(iter(reg.values()))["name"]), None)
    use25 = lambda n: reg[n]["name25"].get(tag0 if not half else ("홀수 장부" if n % 2 == 0 else "짝수 장부"), {})
    m["LLM 물음 B(품종)가 필요한 상품(장부 이름이 두 마디에서 들리지 않은 것)"] = len([n for n in reg if reg[n]["state"] != "거둠" and not use25(n).get("twice")])
    m["번호가 맞음이 된 까닭"] = dict(collections.Counter(r["why_ok"] for r in reg.values() if r["why_ok"]))
    m["카드: 까닭별"] = dict(cards)
    m["카드가 뜬 상품 수"] = len([1 for r in reg.values() if r["state"] != "거둠" and r["card"]])
    return m


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--truth", required=True)
    ap.add_argument("--ledger")
    ap.add_argument("--half", nargs=2, metavar=("홀수장부", "짝수장부"))
    ap.add_argument("--no-tag-only", action="store_true", help="딱지만으로는 올리지 않는다")
    ap.add_argument("--no-cues", action="store_true", help="금액 곁말(깎는 값·지난 값·낱개 값)을 가리지 않는다")
    ap.add_argument("--crowd", type=int, default=TAG_CROWD, help="딱지만으로 올릴 때 같이 보여도 되는 번호 수")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    truth = json.load(open(a.truth, encoding="utf-8"))
    ledger = {"장부 있음": V.Ledger(a.ledger)} if a.ledger else {}
    if a.half:
        ledger = {"홀수 장부": V.Ledger(a.half[0]), "짝수 장부": V.Ledger(a.half[1])}
    state = {"recs": {}, "run": 0, "band": None, "confirmed": [], "prices": [], "stats": collections.Counter()}
    info = [simulate(r, state, ledger, not a.no_tag_only, not a.no_cues, a.crowd) for r in a.runs]
    m = score(state["recs"], truth, old_registrations(a.runs), bool(a.half))
    m["올린 횟수"] = dict(state["stats"])
    m["실행"] = info
    for k, v in m.items():
        print(f"{k}: {v}")
    if a.out:
        json.dump({"metrics": m, "recs": {str(n): r for n, r in state["recs"].items()}}, open(a.out, "w", encoding="utf-8"),
                  ensure_ascii=False, default=lambda o: sorted(o) if isinstance(o, (set, frozenset)) else str(o))


if __name__ == "__main__":
    main()
