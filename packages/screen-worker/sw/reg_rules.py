# 라이브 LLM 등록의 안전 규칙 (D-SCR-12~15, 2026-11-12 방송 복기에서). 순수 함수만 — 시계·파일·난수를 쓰지 않는다.
#  - 번호: 화면에 온전히 읽힌 장수와 그 방송의 번호대로 근거를 따진다(없는 번호 15건·앞 상품 번호 10여 건).
#  - 숫자 쌍: 말한 번호와 화면 번호가 한 자리만 다를 때 어느 쪽을 믿을지.
#  - 가격: 받아쓴 말에서 뽑은 금액(단위를 말한 것 / 단위를 뺀 것)과 LLM 금액이 맞는지, 10배·100배 어긋나는지, 그 방송 가격대를 벗어나는지.
import collections
import re

from .decide import numbers_loose, numbers_with_beon
from .price import prices_in

# ---------- 번호대 ----------
BAND_RECENT = 30     # 번호대를 정할 때 보는 최근 번호 수
BAND_MIN = 5         # 이만큼 모이기 전에는 번호대를 모른다(모르면 번호대로 거르지 않는다)
BAND_MARGIN = 100    # 번호대 양쪽에 두는 여유(번호 수) — 아래·위 10%를 뺀 폭과 견줘 큰 쪽. 번호를 차례로 팔지 않는 판매자(377 → 330 → 245)가 걸리지 않게 넉넉히


def band_of(numbers):
    """최근 믿을 만한 번호들 → {"digits": 흔한 자릿수(80% 넘을 때만), "lo", "hi"} — 판매자가 몇 자리 번호를 쓰는지 가정하지 않고 방송을 따라간다"""
    xs = list(numbers)[-2 * BAND_RECENT:]
    if len(xs) < BAND_MIN:
        return None
    by = collections.Counter(len(str(n)) for n in xs)
    digits, k = by.most_common(1)[0]
    s = sorted(xs)
    lo, hi = s[len(s) // 10], s[len(s) - 1 - len(s) // 10]
    margin = max(BAND_MARGIN, hi - lo)
    return {"digits": digits if k * 5 >= len(xs) * 4 else None, "lo": lo - margin, "hi": hi + margin}


def in_band(no, band):
    """번호대를 모르면 True. 흔한 자릿수보다 짧으면(번호표가 일부만 읽힌 모양) 밖, 범위를 벗어나도 밖"""
    if band is None:
        return True
    if band["digits"] and len(str(no)) < band["digits"]:
        return False
    return band["lo"] <= no <= band["hi"]


def full_frames(no, secs, cand, band=None, part_min=3):
    """그 초들에 이 번호가 온전히 읽힌 장수(화면은 1초에 1장). 그 방송 번호보다 자릿수가 짧고, 같은 때 그 숫자를 품은 더 긴 번호가
    part_min장 넘게 읽혔으면 번호표의 일부(372의 2, 388의 38)로 보고 0"""
    hits = sum(1 for s in secs if no in cand.get(s, ()))
    if hits and band and band["digits"] and len(str(no)) < band["digits"]:
        seen = collections.Counter(n for s in secs for n in set(cand.get(s, ())))
        if any(q != no and str(no) in str(q) and k >= part_min for q, k in seen.items()):
            return 0
    return hits


def number_evidence(no, spoken, secs, cand, band, tag_frames=3, out_frames=5):
    """이 번호를 서버로 보낼 근거가 있나 → (근거 있음, 까닭)
    - 판매자가 말했고 번호대 안: 인정
    - 아니면 화면에 온전히 tag_frames장(번호대 밖이면 out_frames장) 넘게 읽혀야 한다"""
    inside = in_band(no, band)
    n = full_frames(no, secs, cand, band)
    if spoken and inside:
        return True, "말한 번호"
    need = tag_frames if inside else out_frames
    if n >= need:
        return True, f"화면에 온전히 {n}장"
    return False, ("번호대 밖 번호" if not inside else "화면 근거 부족") + f"(온전히 {n}장, {need}장 필요)"


def spoken_numbers(texts):
    """받아쓴 줄들에서 판매자가 말한 번호(‘N번’ + ‘번’ 없이 말한 숫자)"""
    out = set()
    for x in texts:
        out.update(numbers_with_beon(x))
        out.update(numbers_loose(x))
    return out


# ---------- 숫자 쌍 (C절) ----------
# 말한 번호와 화면의 큰 번호표가 한 자리만 다를 때 어느 쪽을 믿나. 근거: 2026-11-12 방송에서 한 자리 차이 7건 중 판정할 수 있던 4건
# (333/334, 334/344, 212/222, 153/353)은 모두 화면이 맞았다 — 삼/사, 일/이처럼 귀로 헷갈리는 쌍이라 받아쓰기가 틀린 것.
# 눈으로 헷갈리는 쌍(8↔3, 8↔9, 6↔8)은 번호표 읽기가 틀렸을 가능성이 커 말한 번호를 따른다(어제 사례는 없음 — 글자 모양 근거, 다른 방송으로 보강할 것).
# 1↔7은 눈(번호표 글씨체)으로도 귀(일/칠)로도 헷갈려 그 밖의 쌍과 같이 번호표가 충분히 보였을 때만 화면을 따른다.
EYE_PAIRS = frozenset({"38", "89", "68"})
EAR_PAIRS = frozenset({"34", "12"})


def digit_pair(a, b):
    """자릿수가 같고 한 자리만 다르면 그 두 숫자(작은 것 먼저, 예 "34"), 아니면 None"""
    a, b = str(a), str(b)
    if len(a) != len(b):
        return None
    diff = [(x, y) for x, y in zip(a, b) if x != y]
    return "".join(sorted(diff[0])) if len(diff) == 1 else None


def pair_verdict(said, screen, frames, need):
    """→ "말" / "화면" / "기다림" (한 자리 차이가 아니면 None). frames = 화면 번호표가 크게 보인 장수, need = 충분하다고 보는 장수(FIX_FRAMES)"""
    pair = digit_pair(said, screen)
    if pair is None:
        return None
    if pair in EYE_PAIRS:
        return "말"
    if pair in EAR_PAIRS:
        return "화면"
    return "화면" if frames >= need else "기다림"


# ---------- 가격 ----------
UNITS = {"만": 10000, "만원": 10000, "10000": 10000, "천": 1000, "천원": 1000, "1000": 1000, "": None, "없음": None, "원": None, "0": None}


def unit_of(value, default=10000):
    """환경변수 글 → 단위 없는 판매가에 곱할 값(만원 10000 · 천원 1000 · 없음 None). 모르는 글이면 기본값"""
    if value is None:
        return default
    return UNITS.get(str(value).strip(), default)


_KD = "일이삼사오육칠팔구"
_KNUM = rf"(?:[{_KD}]?백)?[{_KD}]?십[{_KD}]?|[{_KD}]?백"
# 단위 없이 말한 숫자: 앞뒤가 글자·숫자에 붙지 않은 1~3자리(또는 한글 수 '삼십오'·'백삼십'). 뒤가 끝·띄어쓰기·문장부호·'에/짜리/까지…'일 때만
_BARE = re.compile(rf"(?<![\w.,~])(\d{{1,3}}|{_KNUM})(?![0-9]|[.,][0-9])(?=$|[\s.,!?~]|까지|에|짜리|이면|입니다|이에요|예요|이고|이구요|이요)")
# 가격이 아닌 수: 번호·수량·크기·시각 … (단위를 말한 가격 '만/천/원'은 prices_in이 따로 읽는다)
_NOT_PRICE = re.compile(r"\s*(?:번|원|천|백|만|개|호|센티|cm|미리|mm|프로|%|명|분|초|세트|년|살|시|월|일|장|도|kg|키로|미터|배|차|등|위|층|포기|촉|가지|종|박스|병|주|회|평|줄|알|급|금|두)")


def _kor(raw):
    total, cur = 0, None
    for c in raw:
        if c in _KD:
            cur = _KD.index(c) + 1
        elif c == "백":
            total += (cur or 1) * 100
            cur = None
        elif c == "십":
            total += (cur or 1) * 10
            cur = None
    return total + (cur or 0)


def spoken_amounts(text, unit=10000, exclude=()):
    """한 줄에서 말한 금액 → (단위를 말한 금액 집합, 단위를 뺀 수를 unit으로 읽은 금액 집합)
    단위를 뺀 수: 두 자리(10~99)와 10으로 나누어떨어지는 세 자리(130·230) — "자 요거 35" → 350,000, "130에" → 1,300,000 (unit=만원).
    한 자리 수와 exclude(그 상품 번호·화면에 보인 번호)는 뺀다. unit이 없으면 단위를 뺀 수는 읽지 않는다"""
    explicit = set(prices_in(text))
    short = set()
    if unit:
        skip = set(exclude) | set(numbers_with_beon(text))
        for m in _BARE.finditer(text):
            if _NOT_PRICE.match(text, m.end()):
                continue
            raw = m.group(1)
            if raw == "십":
                continue
            v = int(raw) if raw.isdigit() else _kor(raw)
            if v < 10 or v > 999 or (v >= 100 and v % 10) or v in skip:
                continue
            short.add(v * unit)
    return explicit, short


def magnitude_conflict(price, amounts):
    """받아쓴 금액 가운데 이 금액과 꼭 10배·100배 다른 것(같은 금액을 말했으면 충돌이 아니다) → 그 금액, 없으면 None"""
    if price in amounts:
        return None
    for a in sorted(amounts):
        if price * 10 == a or price * 100 == a or a * 10 == price or a * 100 == price:
            return a
    return None


RANGE_MIN = 10       # 보낸 금액이 이만큼 쌓인 뒤에만 가격대를 따진다
RANGE_FACTOR = 5     # 지금까지 가장 싼 값의 1/5보다 싸거나 가장 비싼 값의 5배보다 비싸면 가격대 밖


def out_of_range(price, sent_prices):
    """그 방송에서 지금까지 보낸 금액 분포를 크게 벗어났나"""
    if len(sent_prices) < RANGE_MIN:
        return False
    return price * RANGE_FACTOR < min(sent_prices) or price > max(sent_prices) * RANGE_FACTOR


def price_choice(votes, explicit, short, sent_prices, agree=2):
    """한 번호에 모인 LLM 금액 답 {금액: 답한 호출 수} → (보낼 금액 또는 None, 까닭, 막힌 금액 {금액: 까닭})
    1) 판매자가 단위까지 말한 금액과 같으면 바로(규칙=LLM)
    2) 단위를 뺀 수를 판매자 단위로 읽은 금액과 같고 가격대 안이면 바로(규칙=LLM)
    3) 그 밖에는 서로 다른 호출의 답이 agree번 같고, 다른 금액보다 많고, 10배·100배 충돌·가격대 밖이 아닐 때
    여러 금액이 1)·2)에 걸리면 답이 많은 쪽, 같으면 보류"""
    blocked, ruled = {}, {}
    said = set(explicit) | set(short)
    for p, n in votes.items():
        if p in explicit:
            ruled[p] = "판매자가 말한 금액과 같음"
        elif out_of_range(p, sent_prices):
            blocked[p] = "이 방송 가격대를 벗어남"
        elif p in short:
            ruled[p] = "단위를 뺀 금액을 판매자 단위로 읽은 값과 같음"
        else:
            other = magnitude_conflict(p, said)
            if other is not None:
                blocked[p] = f"받아쓴 금액 {other:,}원과 10배·100배 다름"
    ranked = sorted(ruled, key=lambda p: votes[p], reverse=True)
    if ranked and (len(ranked) == 1 or votes[ranked[0]] > votes[ranked[1]]):
        return ranked[0], ruled[ranked[0]], blocked
    if ranked:
        return None, "말한 금액이 여럿이고 답이 갈림", blocked
    free = sorted((p for p in votes if p not in blocked), key=lambda p: votes[p], reverse=True)
    if free and votes[free[0]] >= agree and (len(free) == 1 or votes[free[0]] > votes[free[1]]):
        return free[0], f"같은 답 {votes[free[0]]}번", blocked
    if not free:
        return None, "; ".join(dict.fromkeys(blocked.values())), blocked
    return None, ("답이 갈림" if len(free) > 1 else "답이 한 번뿐"), blocked
