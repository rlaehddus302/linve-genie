# 품종 고르기 "시장" 방식(D-RECOG-43, 사용자 2026-11-17): 가게 장부 없이 넓은 시장 사전 하나로 고른다.
#   1. 거르기 — 손님 닉네임·"아니다"라고 한 이름·모양 말을 빼고, 노금·찐노처럼 받아쓰기가 틀린 무늬 말을 녹금·찐녹으로 고친다.
#      닉네임처럼 보여도 사전에 있는 이름은 손님 이름으로 보지 않는다(막기).
#   2. 무늬 말뿐 — LLM 답의 절반 넘게가 무늬 말뿐(색금·녹금·SP…)이면 그 무늬 말을 이름으로 쓴다.
#   3. LLM 답 가운데 가장 많이 나온 이름(같은 표면 먼저 나온 이름). 사전에 있으면(자모 88점) 사전 표기로.
#   4. 바꾸기 — 그 이름이 상품 받아쓰기에서 안 들리는데, 받아쓰기 투표(variety.pick_name)가 고른 진짜 품종은 들리면 그 이름으로.
#   확인 중(NAME_UNSURE)은 사전에 없는 이름에만 붙인다. 사전에 있는 이름은 바로 확정한다.
#   나누기(SPLIT, 기본 켬, D-RECOG-44): 답마다 품종·옵션으로 나눠(variety.parts) 품종만 사전과 맞추고 품종끼리 투표, 옵션은 그 품종 답의 절반 넘게 붙인 것만
#   다시 붙여 "품종 옵션"(variety.label)으로 보낸다. 장부 방식의 나누기에서 고친 것: 무늬 말뿐 답과 이름 답이 같은 표면 먼저 나온 쪽(장부 방식은 무늬 말이
#   더 많아야 이김), 창독·창록 → 창녹, "색금창" → 창 색금, 앞에 붙은 SP·종자·창·찐은 떼고 품종을 맞춤(통째로 사전에 있으면 떼지 않음),
#   품종만으로 사전에 없으면 통째 이름으로 다시 맞춤("왕색금" → 왕비 색금). 생금·설금 → 색금(D-RECOG-45). LLM_NAME_SPLIT=0이면 통째로.
# 9방송 930상품(받아 둔 sol 답, 정답이 새지 않는 사전) 시험: 장부 방식(shop, 빈 장부) 71.7%·확인 중 645 → 이 방식 74.8%·확인 중 165.
import collections
import os
import re

from rapidfuzz import fuzz

from . import variety as V

SPLIT = os.environ.get("LLM_NAME_SPLIT", "1") != "0"                     # 품종·옵션으로 나눠 품종끼리 투표(D-RECOG-44)
FRONT = ("SP", "종자", "창", "찐")                                         # 품종 이름 앞에 붙여 적는 말("SP몰디브", "창몰디브")
_CHANG = re.compile(r"창\s?(?:독|록|노|농)\s?(색금|금)")                    # 창독색금·창록금 → 창녹색금·창녹금(무늬 자리에서만)
_PAT_CHANG = re.compile(r"(녹색금|색금|녹금|금)창")                        # "색금창" → "창색금"
# 받아쓰기·LLM이 이름 뒤 '색금'을 생금·설금으로 적는다(9방송 sol 답: 마테 생금·몰디브 생금·소믈리에 설금 무지, D-RECOG-45) — 이름 뒤에서만.
#   "생·설"까지가 사전 품종이거나 통째로 사전에 있으면 그대로(세설금 = 세설 + 금, 환생금·담설금·왕비세설금, 실생금 = 실생 + 금)
_OPT_TYPO = re.compile(r"([가-힣A-Za-z]+)\s?(생|설|섹|쌕)\s?금(?=$|\s)")
CUT = 88                                                                    # 사전 이름으로 볼 자모 비율(canon)
nz0 = lambda s: re.sub(r"[^가-힣A-Za-z0-9]", "", s or "")

SHAPE = {"청수", "청소", "층수", "입성", "장입성", "입장", "잎장", "모주", "직배", "집배", "분채", "이름표", "가격표", "커팅사이즈"}   # 모양·파는 꼴 말
PATTERNS = sorted(["복륜금", "색금종자", "녹색금", "창녹금", "창색금", "창금", "색금", "녹금", "찐녹", "철화", "산반", "복륜", "수박", "힘줄", "종자", "무지", "금"],
                  key=len, reverse=True)
PATTERN_ONLY = set(PATTERNS) | {"SP", "창", "녹색", "창녹", "창색"}
_PO = sorted(PATTERN_ONLY, key=len, reverse=True)
_NOK_FIX = re.compile(r"(노금|녹음|녹급|녹극|녹운|노끔|녹끔|록금)(?=\s|$)")
_JJIN_FIX = re.compile(r"(찐|진)\s?(노|농|록)(?=\s|$)")
_DENY = "(이|가|는|은|도|의)?(아니|아님|아닌|아녀)"
_NICK_CALL = re.compile(r"([가-힣A-Za-z]{2,8})\s?(?:사장님|님)")
_NICK_TITLE = re.compile(r"([가-힣A-Za-z]{2,8})\s?(?:사장님|회장님|대표님|여사님|선생님|형님|언니|누나|오빠|이모)")
_NICK_THANK = re.compile(r"([가-힣A-Za-z]{2,8})\s(?:감사합니다|감사해요|땡큐|축하드립니다|축하드려요)")
_THANK_NOT = re.compile(r"(요|다|게|고|서|니|네|죠|진짜|너무|정말|항상|늘|오늘|모두|다들)$")

# 이름 줄기(무늬 말 차이를 무시하고 견줄 때)
_MOD = r"(녹색금|색금|녹금|백금|황금|금무지|무지|철화|군생|통째|금|찐녹|\d+개)$"
GENERIC = {"녹금", "색금", "녹색금", "찐녹", "종자", "sp", "금", "백금", "황금", "녹", "창", "찐", "창녹금", "창색금", "창찐녹", "종자녹금", "종자색금", "종자찐녹",
           "sp색금", "sp녹금", "녹색", "철화", "금무지"}


def _nz(s):
    return re.sub(r"\s+", "", s or "").lower()


def stem(x):
    x = _nz(x)
    for _ in range(4):
        y = re.sub(_MOD, "", x)
        if y == x or len(y) < 2:
            break
        x = y
    return x


def real(x):
    """무늬 말이 아닌 진짜 품종 이름인가"""
    b = stem(x)
    return len(b) >= 2 and b not in GENERIC and _nz(x) not in GENERIC


def pattern_only(s):
    """이름 없이 무늬 말만으로 된 말인가("색금", "창녹금", "SP색금")"""
    k = nz0(s).upper()
    while k:
        for p in _PO:
            if k.startswith(p):
                k = k[len(p):]
                break
        else:
            return False
    return True


def fixpat(x):
    """받아쓰기가 틀리게 적은 무늬 말을 고친다: 노금·녹음 → 녹금, 찐노·진농 → 찐녹"""
    x = _NOK_FIX.sub("녹금", x or "")
    return _JJIN_FIX.sub("찐녹", x)


def denied(name, lines):
    """→ (판매자가 "○○ 아니고"라고 한 줄 수, 그냥 말한 줄 수)"""
    k = re.escape(nz0(name))
    if len(k) < 2:
        return 0, 0
    neg = pos = 0
    for _, x in lines:
        y = nz0(x)
        if re.search(rf"{k}{_DENY}", y):
            neg += 1
        elif k in y:
            pos += 1
    return neg, pos


def said(name, lines):
    """이름(줄기)이 그 상품 받아쓰기에 들렸나 — 글자 그대로, 또는 세 글자 넘는 이름은 자모 90점"""
    st = stem(name)
    if len(st) < 2:
        return False
    js = V.jamo(st)
    for _, t in lines:
        tt = _nz(t)
        if st in tt:
            return True
        if len(st) >= 3 and fuzz.partial_ratio(js, V.jamo(tt)) >= 90:
            return True
    return False


def nick_calls(trs, upto=None):
    """방송 받아쓰기 [(초, 글)]에서 upto초까지 "○○님"으로 두 번 넘게 부른 이름"""
    c = collections.Counter()
    for t, x in trs:
        if upto is not None and t > upto:
            break
        for m in _NICK_CALL.finditer(x):
            w = m.group(1)
            if w not in V._NOT_NICK and not any(w.startswith(n) for n in V._NOT_NICK):
                c[w] += 1
    return {w for w, k in c.items() if k >= 2}


def nicknames(lines):
    """그 상품 받아쓰기에서 손님으로 부른 이름(○○님·○○ 사장님·○○ 감사합니다)"""
    out = set(V.nicknames(lines))
    for _, x in lines:
        for m in _NICK_TITLE.finditer(x):
            out.add(m.group(1))
        for m in _NICK_THANK.finditer(x):
            w = m.group(1)
            if not _THANK_NOT.search(w):
                out.add(w)
    return out


def known(name, dic):
    return bool(name) and V.canon(V.tidy(name), dic, CUT)[1]


def unsure(name, dic):
    """확인 중 품종인가: 이름이 있고, 무늬 말뿐이 아니고, 사전에 없다"""
    return bool(name) and not pattern_only(name) and not known(name, dic)


def _exact(k, dic):
    return len(k) >= 2 and (nz0(k) in dic.names or V.norm(k) in dic.names)


def fix_typo(t, dic):
    """이름 뒤 생금·설금 → 색금. "생·설"까지가 사전 품종(세설·환생·담설)이거나 통째로 사전에 있거나(세설금) 실생이면 그대로"""
    def one(m):
        head = m.group(1) + m.group(2)
        if head.endswith("실생") or _exact(head, dic) or _exact(m.group(0), dic):
            return m.group(0)
        return m.group(1) + " 색금"
    return _OPT_TYPO.sub(one, t or "")


def parts(name, dic):
    """LLM 이름 하나 → (품종 열쇠, 보일 품종, 사전에 있나, [앞 옵션], [옵션]). 품종이 없으면 열쇠 ""(옵션만).
    "먼로 철화" → (먼로, 먼로, True, [], [철화]), "SP몰디브색금" → (몰디브, 몰디브, True, [], [SP, 색금]), "창록금" → ("", "", False, [], [창, 녹금])"""
    t = _CHANG.sub(lambda m: "창녹" + m.group(1), name)
    t = fix_typo(t, dic)
    m = _PAT_CHANG.fullmatch(V.norm(t))
    if m:
        t = "창" + m.group(1)
    whole = V.norm(V._QTY.sub("", V.tidy(t)))
    if _exact(whole, dic):                                                 # 통째로 사전에 있는 꼴("백산금", "먼로철화")은 사전 표기를 나눈다
        b2, h2, o2, _ = V.parts(dic.names.get(whole) or dic.names.get(nz0(whole)) or whole, heard=False)
        if b2:
            return V.norm(b2), b2, True, h2, o2
    base, heads, opts, _ = V.parts(t)
    front = []
    while base and not _exact(base, dic):
        f = next((f for f in FRONT if base.upper().startswith(f.upper()) and len(base) - len(f) >= 2), None)
        if not f:
            break
        front.append("SP" if f.upper() == "SP" else f)
        base = base[len(f):]
    if not base:
        return "", "", False, heads, front + opts
    c, ok = V.canon(base, dic, CUT)
    if not ok:                                                             # 품종만으로 못 맞추면 통째 이름으로("왕색금" → 왕비색금, "UF금" → UFO금)
        c2, ok2 = V.canon(V.tidy(t), dic, CUT)
        b2, h2, o2, _ = V.parts(c2, heard=False) if ok2 else ("", [], [], "")
        if b2:
            return V.norm(b2), b2, True, h2 or heads, o2 or (front + opts)
    nm = c if ok else base
    return V.norm(nm), nm, ok, heads, front + opts


def _label(name, dic):
    """이름 하나를 "품종 옵션" 모양으로(받아쓰기 투표로 바꾼 이름에 쓴다) → (이름, 사전에 있나)"""
    k, nm, ok, heads, opts = parts(name, dic)
    if not k:
        return V.label("", opts, heads), False
    return V.label(nm, opts, heads), ok


def pick_market(llm_names, lines, dic, trs=(), t0=None, nicks=()):
    """→ (이름 또는 "", 까닭, 굳은 이름인가, 확인 중 품종인가, extra) — variety.pick_shop과 같은 모양.
    llm_names = 그 번호에 LLM이 적은 이름들(답한 순서), lines = 그 상품 받아쓰기 [(초, 글)], trs = 방송 받아쓰기 [(초, 글)], t0 = 그 상품 첫 줄 시각"""
    extra = {"pattern": "", "form": "", "qty": "", "votes": 0, "rank": 0, "source": "", "tally": {}, "in_ledger": False}
    calls = nick_calls(trs, None if t0 is None else t0 + 20)
    guests = (set(nicks) | calls | nicknames(lines))
    guests = {w for w in guests if not V.canon(w, dic, CUT)[1]}                # 막기: 사전에 있는 이름은 손님 이름으로 보지 않는다
    raw, dropped = [], []
    for x in llm_names:
        if not x:
            continue
        y = fixpat(V.tidy(x))
        why = "모양 말" if nz0(y) in SHAPE else V.not_a_name(y, guests)
        ng, ps = denied(y, lines)
        if not why and ng and ng >= ps:
            why = f"판매자가 아니라고 함({ng}줄)"
        if why:
            dropped.append(f"{x}({why})")
        else:
            raw.append(y)
    drop = (" · 버림: " + ", ".join(dropped)) if dropped else ""
    cands = [V.tidy(x) for x in raw if V.tidy(x) and not V.not_a_name(V.tidy(x), guests)]
    qty = collections.Counter(V.split_parts(c)[3] for c in cands if V.split_parts(c)[3])
    extra["qty"] = qty.most_common(1)[0][0] if qty else ""
    cc = collections.Counter(cands)                                          # most_common: 같은 표면 먼저 나온 이름
    extra["tally"] = {V.norm(k): v for k, v in cc.items()}
    if SPLIT:
        return _pick_split(cands, raw, lines, dic, guests, drop, extra)
    if cands:
        pats = [nz0(c) for c in cands if pattern_only(c)]
        if len(pats) * 2 > len(cands):
            p = collections.Counter(pats).most_common(1)[0][0]
            extra.update(pattern=p, votes=len(pats), rank=1, source="무늬 말")
            return p, f"LLM 답 {len(cands)}개 중 {len(pats)}개가 무늬 말뿐 → '{p}'" + drop, False, False, extra
    llm = cc.most_common(1)[0][0] if cc else ""
    name, why = llm, (f"LLM 1위 '{llm}'" + (f"({cc[llm]}/{len(cands)})" if len(cands) > 1 else "")) if llm else "LLM 이름 없음"
    if llm:
        c, ok = V.canon(llm, dic, CUT)
        if ok:
            name = c
            why += f" → 사전 표기 '{c}'" if nz0(c) != nz0(llm) else " (사전에 있음)"
    w = V.pick_name(raw, lines, dic, guests)[0]
    source, votes = "LLM", cc[llm] if llm else 0
    if not name:
        name, source = w or "", "받아쓰기"
        if name:
            why += f" → 받아쓰기 투표 '{w}'"
    elif w and real(w) and stem(w) != stem(name) and not said(name, lines) and said(w, lines):
        why += f" → 받아쓰기 투표 '{w}'(LLM 이름은 안 들리고 이것은 들림)"
        name, source = w, "받아쓰기"
    sure_name = known(name, dic) or pattern_only(name)
    extra.update(votes=votes, rank=1 if sure_name else 0, source=source)
    return name, why + drop, False, unsure(name, dic), extra


def _pick_split(cands, raw, lines, dic, guests, drop, extra):
    """나누기 켬: 품종끼리 투표(같은 표면 먼저 나온 품종), 무늬 말뿐 답이 더 많거나 같은 표에 먼저 나왔으면 무늬 말, 옵션은 절반 넘게 붙인 것만"""
    votes, info, first = collections.Counter(), {}, {}
    hs, os_ = collections.Counter(), collections.Counter()
    only, first_only = collections.Counter(), None
    for i, c in enumerate(cands):
        k, nm, ok, heads, opts = parts(c, dic)
        if not k:
            p = V.label("", opts, heads) if (opts or heads) else (c if pattern_only(c) else "")
            if p:
                only[p] += 1
                first_only = i if first_only is None else first_only
            continue
        votes[k] += 1
        info.setdefault(k, (nm, ok))
        first.setdefault(k, i)
        if heads:
            hs[(k, tuple(heads))] += 1
        if opts:
            os_[(k, tuple(V.same(opts)))] += 1
    extra["tally"] = dict(votes)
    on = sum(only.values())
    top = max(votes, key=lambda k: (votes[k], -first[k])) if votes else None
    if on and (top is None or on > votes[top] or (on == votes[top] and first_only < first[top])):
        p = only.most_common(1)[0][0]
        extra.update(pattern=p, votes=on, rank=1, source="무늬 말")
        return p, f"무늬 말뿐 답 '{p}'({on}/{len(cands)})" + drop, False, False, extra
    w = V.pick_name(raw, lines, dic, guests)[0]
    if top is None:
        if not w:
            return "", "LLM 이름 없음" + drop, False, False, extra
        name, ok = _label(w, dic)
        extra.update(votes=0, rank=1 if ok or pattern_only(name) else 0, source="받아쓰기")
        return name, f"LLM 이름 없음 → 받아쓰기 투표 '{w}'" + drop, False, not ok and not pattern_only(name), extra

    def half(ctr):
        mine = {v: n for (k, v), n in ctr.items() if k == top}
        return list(max(mine, key=mine.get)) if mine and max(mine.values()) * 2 >= votes[top] else []
    nm, ok = info[top]
    opts, heads = half(os_), half(hs)
    name = V.label(nm, opts, heads)
    why = f"품종 '{nm}'({votes[top]}/{len(cands)})" + (" (사전에 있음)" if ok else "") + (f" + 옵션 '{' '.join(heads + opts)}'" if opts or heads else "")
    source = "LLM"
    if w and real(w) and stem(w) != stem(nm) and not said(nm, lines) and said(w, lines):
        why += f" → 받아쓰기 투표 '{w}'(LLM 이름은 안 들리고 이것은 들림)"
        name, ok = _label(w, dic)
        source = "받아쓰기"
    extra.update(pattern=" ".join(heads + opts), votes=votes[top], rank=1 if ok else 0, source=source)
    return name, why + drop, False, not ok and not pattern_only(name), extra


def should_rename(now, name, extra, now_rank=0):
    """이미 보낸 품종 now를 (그 뒤 답까지 모아) 다시 고른 name으로 바꿀까 — 시장 방식은 모든 답을 모아 고른 이름을 따르되,
    빈칸은 채우고, 사전에 있는 이름을 사전에 없는 이름으로 바꾸지 않고, 한 번 나온 이름으로는 바꾸지 않는다"""
    if not name or V.norm(name) == V.norm(now or ""):
        return False
    if not now or V.bare_name(now):
        return True
    if V.bare_name(name):
        return False
    rank = extra.get("rank", 0)
    if rank < now_rank:
        return False
    return extra.get("votes", 0) >= 2 or rank > now_rank
