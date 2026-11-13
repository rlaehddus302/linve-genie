# 품종: 상품을 파는 동안 판매자가 한 말에서 품종 후보를 만들고(사전과 소리가 비슷한 말), 규칙(가장 비슷한 것)과 맥 LLM(후보 중 고르기)으로 1순위를 정한다.
# 금액과 같은 원칙: LLM은 이름을 지어내지 않고 후보 번호만 고른다. 판매자가 확인한다.
#  - 사전 = 라이브지니 품종 사전(2,084개 + 별칭) + 채팅·방송 제목에서 거둔 이름(sw/harvest.py)
#  - 소리 비슷한 정도 = 한글을 자모로 풀어 편집 거리 비율(rapidfuzz). 받아쓰기가 "유나스쿨"을 "은하스쿨"로 적어도 잡힌다
#  - "레오파드색금"처럼 이름 뒤에 금·색금·철화 등이 붙으면 앞부분을 사전과 맞추고 뒤를 그대로 붙인다
import collections
import json
import os
import re

from rapidfuzz import fuzz, process

HERE = os.path.dirname(os.path.abspath(__file__))
SUFFIX = ("복륜금", "색금", "창금", "녹금", "철화", "산반", "복륜", "금")
_JOSA = re.compile(r"(이에요|에요|이고요|이구요|입니다|이죠|이요|이고|이랑|하고|은|는|이|가|을|를|도|요|야|이야|로|으로)$")
_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"


def jamo(s):
    out = []
    for ch in s:
        c = ord(ch) - 0xAC00
        if 0 <= c < 11172:
            out.append(_CHO[c // 588] + _JUNG[(c % 588) // 28] + _JONG[c % 28].strip())
        else:
            out.append(ch)
    # 소리가 같은 모음(ㅐ/ㅔ)은 하나로
    return "".join(out).replace("ㅔ", "ㅐ")


def norm(s):
    return re.sub(r"[^가-힣A-Za-z0-9]", "", s or "")


class Dictionary:
    def __init__(self, exclude_src=None, harvest=True, seller=False):
        """seller=True: 판매자가 손으로 고친 이름·별칭(data/varieties_seller.json)도 읽는다 — 라이브 LLM 등록의 품종 고르기(pick_name)만 켠다.
        옛 규칙 길(decide_name·variety_regress)은 그대로라 지난 시험 점수가 바뀌지 않는다"""
        names = {}
        for v in json.load(open(os.path.join(HERE, "..", "data", "varieties.ko.json"), encoding="utf-8"))["varieties"]:
            for n in [v["name"]] + v.get("aliases", []):
                if len(norm(n)) >= 2:
                    names[norm(n)] = v["name"]
        hp = os.path.join(HERE, "..", "data", "varieties_harvest.json")
        if harvest and os.path.exists(hp):
            for n, info in json.load(open(hp, encoding="utf-8")).items():
                # 시험하는 방송에서만 거둔 이름은 뺀다(답을 미리 보는 것을 막음)
                if exclude_src and set(info["src"]) <= {exclude_src}:
                    continue
                names.setdefault(norm(n), n)
        sp = os.path.join(HERE, "..", "data", "varieties_seller.json")
        if seller and os.path.exists(sp):
            for v in json.load(open(sp, encoding="utf-8"))["names"]:
                if exclude_src and set(v.get("src", ())) <= {exclude_src}:
                    continue
                names.setdefault(norm(v["name"]), v["name"])
                for n in v.get("aliases", []):          # 별칭은 받아쓰기가 틀린 모양이라 다른 사전의 같은 글자보다 앞선다
                    names[norm(n)] = names[norm(v["name"])]
        self.names = names
        self.keys = list(names)
        self.jkeys = [jamo(k) for k in self.keys]

    def match(self, phrase, cutoff=75):
        """한 말 → [(정식 이름, 점수)] 비슷한 순"""
        p = norm(phrase)
        if len(p) < 2:
            return []
        out = []
        for _, score, i in process.extract(jamo(p), self.jkeys, scorer=fuzz.ratio, limit=3, score_cutoff=cutoff):
            out.append((self.names[self.keys[i]], score))
        # 이름 뒤 금·색금·철화: 앞부분을 사전과 맞추고 뒤를 붙임
        for suf in SUFFIX:
            if p.endswith(suf) and len(p) - len(suf) >= 2:
                for _, score, i in process.extract(jamo(p[: -len(suf)]), self.jkeys, scorer=fuzz.ratio, limit=2, score_cutoff=cutoff):
                    base = self.names[self.keys[i]]
                    out.append((base if base.endswith(suf) else base + suf, score))
                break
        return out


def phrases(text):
    words = [_JOSA.sub("", w) for w in re.findall(r"[가-힣A-Za-z]+", text)]
    words = [w for w in words if w]
    out = []
    for n in (1, 2, 3):
        for i in range(len(words) - n + 1):
            out.append("".join(words[i:i + n]))
    return out


def candidates(lines, dic, k=5):
    """그 상품 시간의 말 [(초, 글)] → [(품종, 점수, 받아쓴 말)] 점수순 k개"""
    best = {}
    for _, x in lines:
        for ph in phrases(x):
            for name, score in dic.match(ph):
                if name not in best or score > best[name][0]:
                    best[name] = (score, ph)
    ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:k]
    return [(name, round(sc, 1), ph) for name, (sc, ph) in ranked]


PROMPT = """다육식물 라이브 판매 방송에서 판매자가 한 말을 받아쓴 글입니다. 품종 이름은 받아쓰기가 자주 틀립니다(비슷한 소리의 다른 말로 적힘).
판매자는 지금 {no}번 상품을 팔고 있습니다. 앞뒤에 다른 상품 이야기가 섞여 있을 수 있습니다.

{lines}

품종 이름 후보입니다(받아쓴 말과 소리가 비슷한 사전 속 이름):
{cands}

{no}번 상품의 품종은 몇 번 후보입니까? 다른 상품의 품종은 고르지 마세요. 맞는 후보가 없으면 0.
JSON 한 줄로만 답하세요: {{"choice": 후보 번호}}"""


def fmt(lines):
    return "\n".join(f"[{int(t) // 60}:{int(t) % 60:02d}] {x}" for t, x in lines)


def prompt(no, lines, cands):
    listing = "\n".join(f"{i}) {n}  (받아쓴 말: '{ph}')" for i, (n, _, ph) in enumerate(cands, 1))
    return PROMPT.format(no=no, lines=fmt(lines), cands=listing)


# ---------- 직접 뽑기(시험 결과 이 방식이 나음: 정답 품종의 70%가 사전에 없어서 후보 고르기로는 못 맞힘) ----------
# 시험(관리자 글 품종 173건): 사전 후보 고르기 22%, 직접 뽑기 + 상품 시간 앞 60초 + 사전 철자 맞춤(85) 50% (럭셔리 68%, 수정 46%)
FREE = """다육식물 라이브 판매 방송에서 판매자가 한 말을 받아쓴 글입니다. 품종 이름은 받아쓰기가 자주 틀립니다.
판매자는 지금 {no}번 상품을 팔고 있습니다.

{lines}

{no}번 상품의 품종 이름을 받아쓰기 실수를 바로잡아 적으세요.
- 품종 이름은 보통 "자 요 아이는 ○○", "○○ 2만원", "○○ 갈게요"처럼 가격·번호 가까이에서 나옵니다. 앞뒤 다른 상품의 이름은 고르지 마세요.
- 크기·색감 설명(예: 대품, 금 잘 들었다)은 품종이 아닙니다. 이름 뒤의 금·색금·철화는 품종 이름에 포함합니다.
- 모르면 null.
JSON 한 줄로만 답하세요: {{"variety": "이름" 또는 null}}"""
VPRE = 60   # 품종은 번호표를 보여 주기 전에 먼저 소개하는 경우가 많아 상품 화면 구간 60초 전부터 본다
VPOST = int(os.environ.get("VPOST", 10))   # 번호표가 사라진 뒤 몇 초까지 볼지(다음 상품 소개가 섞이는 것 시험 중)


# 받아쓰기가 '색금'을 이렇게 적는다(보스·경성·수담·천동 방송에서 본 것): 사전과 맞추기 전에 바로잡는다
_SAEK = re.compile(r"(세\s?금|새\s?금|새\s?끔|세\s?끔|세\s?컴|색\s?김|섹\s?금|새\s?꿈|세\s?꿈|색\s?끔|색\s?검|(?<=[가-힣A-Za-z])\s?3\s?금|삼\s?금(?=$))")
_FILLER = re.compile(r"^(자|요거|요거는|이거|이거는|요|얘|얘는)\s+")
_NOT_NICK = {"사장", "고객", "손님", "회원", "선생", "여러분", "형", "언니", "누나", "오빠", "어머", "아버", "고맙", "감사"}


def nicknames(lines):
    """판매자가 '○○님'으로 부른 이름(찜한 손님) — 품종으로 고르면 안 된다"""
    out = set()
    for _, x in lines:
        for m in re.finditer(r"([가-힣A-Za-z]{2,8})\s?님", x):
            w = m.group(1)
            if w not in _NOT_NICK and not any(w.startswith(n) for n in _NOT_NICK):
                out.add(w)
    return out


def clean(name):
    name = _FILLER.sub("", (name or "").strip())
    return _SAEK.sub("색금", name)


def _tail(n):
    return next((t for t in SUFFIX if norm(n).endswith(t)), "")


def dict_name(name, dic, cutoff=85):
    """사전에서 소리 비슷한 이름(꼬리 금·색금·철화가 같은 것만). 없으면 None"""
    for _, _, i in process.extract(jamo(norm(name)), dic.jkeys, scorer=fuzz.ratio, limit=3, score_cutoff=cutoff):
        cand = dic.names[dic.keys[i]]
        if _tail(cand) == _tail(name):
            return cand
    return None


def snap(name, dic, cutoff=85, lines=()):
    """LLM이 적은 이름 → 색금 바로잡기·앞 군말 떼기 → 손님 이름이면 버림 → 사전과 견줘 철자 바로잡기(사전에 비슷한 게 없으면 그대로)"""
    name = clean(name)
    if len(norm(name)) < 2:
        return None
    if norm(name) in SUFFIX:   # "색금"·"녹금"만 말한 경우: 그대로 둔다(사전의 아무 '…색금'에 붙이지 않음)
        return norm(name)
    jn = jamo(norm(name))
    for nick in nicknames(lines):
        if fuzz.ratio(jamo(nick), jn) >= 85 or norm(name).startswith(nick):
            return None
    return dict_name(name, dic, cutoff) or name


# ---------- 번호와 같이 말한 이름 (규칙, LLM보다 먼저) ----------
# 판매자는 보통 번호·이름·가격을 한 문장에 말한다. 순서는 사람마다 다르다:
#   "209번 녹색금 만원" / "녹금 209번 만원" / "자 243 5천원 … 천상화" / "성마리아예요 … 203번 만원"
# 그래서 순서는 따지지 않고 "그 번호를 말한 문장에서, 번호에 가까이, 여러 번 같이 나온 이름"을 고른다.
_STOP = set("""자 자자 요거 요거는 요것도 이거 이거는 이것도 얘 얘는 요 요건 이건 그거 저거 여기 거기 오늘 지금 진짜 엄청 완전 너무 정말 아주 좀 또 막 그냥 일단 다시
만원 천원 원 갑니다 가요 갈게요 가볼게요 가겠습니다 드릴게요 드립니다 드려요 드려볼게요 들어갑니다 들어가요 들어오세요 잡아요 잡으세요 주세요 보세요 보시고 키워보세요 키워
번 번이고 번이구요 번입니다 개 한개 두개 하나 둘 세개 자구 자구만 통채 통째 통으로 서비스 가격 특가 찜 문자 감사 감사합니다 축하 축하드립니다 땡큐 네 예 아 어 음 와 우와 아이고
예쁜 이쁜 예쁘 이쁘 예뻐요 이뻐요 예쁩니다 이쁩니다 좋은 좋아요 대품 소품 중품 큰거 작은거 사이즈 화분 포장 뿌리 잎 색감 키운 못 잘 다 안 있어요 없어요 있는 없는
입니다 이고 이구요 이에요 예요 이요 그리고 근데 그래서 인데 해서 하고 하나만 마지막 처음 다음 이번 한번 고급종 저렴이 실생 종자
빨리 얼른 같이 먼저 바로 조금 많이 대박 행복 행복으로 쿠폰 득템 데려가요 데려가세요""".split())
_BUYER_NEXT = re.compile(r"^(잡아|잡으|잡았|축하|감사|땡큐|고마)")   # "○○이 잡아요": 손님 이름 뒤에 오는 말
_VERB = re.compile(r"(게요|게|세요|니다|어요|아요|해요|고요|구요|같구|지요|죠|네요|래요|데요|봐요|까요|겠|는데|지만|어서|해서|하고|하면|으면|볼게|줄게|할게|갈게)$")
_PRICE = re.compile(r"^(\d[\d,]*)(원|만|천|만원|천원)?$|^[일이삼사오육칠팔구십백천만]+(원|만원|천원)$")


def _words(text):
    """[(받아쓴 그대로, 조사 뗀 것)]"""
    out = []
    for m in re.finditer(r"[가-힣A-Za-z0-9]+", text):
        raw = m.group(0)
        out.append((raw, _JOSA.sub("", raw) if re.search(r"[가-힣]", raw) and len(raw) > 2 else raw))
    return out


def said_with_number(lines, no, dic, nicks=None, need_dict=False):
    """그 번호를 말한 문장들에서 이름 후보 → 가장 그럴듯한 이름 하나(없으면 None)"""
    from .decide import numbers_loose, numbers_with_beon
    nicks = nicknames(lines) if nicks is None else nicks
    score = {}
    for _, x in lines:
        if no not in numbers_with_beon(x) and no not in numbers_loose(x):
            continue
        ws = _words(x)
        pos = [i for i, (_, w) in enumerate(ws) if w == str(no) or w == f"{no}번"] or [len(ws) // 2]
        # 이름 덩어리: 쉬는 말·가격·숫자로 끊고, '색금'처럼 꼬리만 따로 적힌 건 앞 말에 붙인다
        from .price import prices_in
        isprice = lambda w: bool(_PRICE.match(clean(w)) or prices_in(w))
        after = [i for i, (_, w) in enumerate(ws) if isprice(w) and i > min(pos)]
        cut = after[0] if after else len(ws)
        chunks, cur = [], []
        for i, (raw, w) in enumerate(ws[:cut]):
            wc = clean(w)
            nxt = ws[i + 1][0] if i + 1 < len(ws) else ""
            bad = (wc in _STOP or raw in _STOP or _VERB.search(raw) or _VERB.search(wc) or isprice(w) or _BUYER_NEXT.match(nxt) or _PRICE.match(wc) or wc.isdigit() or re.fullmatch(r"\d+번", wc) or len(wc) < 2 and wc not in SUFFIX
                   or wc.endswith("님") or any(fuzz.ratio(jamo(n), jamo(wc)) >= 80 for n in nicks))
            if bad:
                if cur:
                    chunks.append(cur)
                cur = []
            elif cur and len(cur) < 3:   # 붙어 나온 이름 말은 한 이름으로("황홀한 연꽃 색금", "보라골드 색금")
                cur.append((i, wc))
            else:
                if cur:
                    chunks.append(cur)
                cur = [(i, wc)]
        if cur:
            chunks.append(cur)
        for ch in chunks:
            name = "".join(w for _, w in ch)
            if norm(name) in SUFFIX or len(norm(name)) < 2:
                continue
            d = min(abs(i - p) for i, _ in ch for p in pos)
            score[name] = score.get(name, 0) + (3 if d <= 2 else 2 if d <= 4 else 1)
    best = None
    for name, s in score.items():
        hit = dict_name(name, dic)
        if need_dict and not hit:   # 사전에 있는 이름만(받아쓴 군말을 이름으로 잘못 고르지 않게)
            continue
        s += 1 if hit else 0
        if best is None or s > best[1]:
            best = (hit or name, s)
    return best[0] if best and best[1] >= 3 else None


def decide_name(raw, no, lines, dic):
    """일꾼이 쓰는 품종 최종 결정: 번호와 같은 문장에서 말한 사전 이름이 있으면 그것(앞부분만 같은 줄임은 제외), 없으면 LLM이 적은 이름 → 다듬기"""
    sent = said_with_number(lines, no, dic, need_dict=True)
    if sent and raw and norm(clean(raw)).startswith(norm(sent)):
        sent = None
    return snap(sent or raw, dic, lines=lines), ("번호 문장" if sent else "LLM")


# ---------- 라이브 LLM 등록의 품종 고르기 (D-SCR-15, 개선 계획 D-2의 V1·V3~V7) ----------
# LLM이 적은 이름과 사전 규칙(받아쓴 말에서 사전과 맞는 이름)을 견줘, 둘이 같으면 그 이름, 다르면
#   (a) LLM 이름이 사전에 있으면 LLM  (b) 사전 이름이 그 상품의 받아쓰기에 여러 번 나오면 사전  (c) 그 밖에는 빈 이름
# 틀린 이름보다 빈 이름이 낫다 — 판매자가 채우기 쉽고, 틀린 이름은 감사 채팅·라벨로 나간다(2026-11-12 방송: 세검·녹음에지는·손님 닉네임).
NOT_NAMES = {"재고", "제고", "재구", "베개", "서비스", "특가", "제곱", "통채", "통째", "통으로", "자구", "한개", "두개", "세개", "하나", "상품", "화분", "다육", "다육이",
             "사이즈", "대품", "중품", "소품", "고급종", "저렴이", "커팅", "실생", "선물", "가격", "번호", "마지막", "오프닝", "이벤트", "득템", "쿠폰", "행복"}
GENERIC = {"색금", "녹금", "금", "철화", "종자", "산반", "복륜"}          # 이름이라기보다 무늬·종류를 이르는 말 — 다른 이름이 있으면 그쪽이 먼저
MENTIONS = 2                                                              # (b): 사전 이름이 받아쓰기에 이만큼 나와야 한다
_COUNT_TAIL = re.compile(r"\s*(?:\d+|한|두|세|네|다섯)\s*(?:개|포기|두|촉|장|세트|번)\s*$")
_ONLY_COUNT = re.compile(r"^\s*(?:\d+|한|두|세|네|다섯|여러)\s*(?:개|포기|두|촉|장|세트|번|가지|종류)?\s*$")
_GREET = re.compile(r"감사|고맙|고마워|축하|안녕|어서\s?오|반갑|잡으셨|잡아요|잡으세요|들어오세요|수고|사랑해|땡큐")
# 받아쓰기·LLM이 '색금'을 적는 모양(2026-11-12 방송: 세금 62 · 새껌 8 · 3금 6 · 새금 6 · 세 끔 6 · 새 끔 6 · 새꿈 3 · 색급 3 · 세크 1, LLM 첫 답 세검·새검)
_SAEK_LIVE = re.compile(r"(?:세|새|색|섹|쌕)\s?(?:금|끔|껌|꿈|검|급|컴|김)|세크|(?<=[가-힣A-Za-z])\s?3\s?금|^3\s?금")
AFFIX = ("복륜금", "색금종자", "색금", "창금", "녹금", "철화", "산반", "복륜", "종자", "무지", "금")   # 이름 뒤에 붙는 말 — 앞 이름만 사전과 맞추고 그대로 붙인다
PREFIX = ("창",)                                                          # 이름 앞에 붙는 말("창녹금")


def tidy(name):
    """LLM·받아쓰기가 적은 이름 다듬기: 앞 군말·뒤 수량("로라클론 4개") 떼기, 색금 바로잡기"""
    name = _COUNT_TAIL.sub("", clean(name))
    return _SAEK_LIVE.sub("색금", name).strip()


def not_a_name(name, nicks=()):
    """품종이 아닌 말이면 까닭, 품종일 수 있으면 None"""
    key = norm(name)
    if len(key) < 2:
        return "너무 짧음"
    if key in NOT_NAMES or _ONLY_COUNT.match(name):
        return "품종이 아닌 말"
    if "○" in name or _GREET.search(name):
        return "인사 구절"
    jn = jamo(key)
    for nick in nicks:
        nk = norm(nick)
        if len(nk) >= 2 and (fuzz.ratio(jamo(nk), jn) >= 85 or key.startswith(nk)):
            return "손님 닉네임"
    return None


def canon(name, dic, cutoff=88):
    """다듬은 이름 → (정식 이름, 사전에 있는가). 통째로 사전에 있거나(철자 바로잡기 포함), 앞 이름이 사전에 있고 뒤에 색금·금·철화…가 붙은 꼴"""
    key = norm(name)
    if key in dic.names:
        return dic.names[key], True
    memo = dic.__dict__.setdefault("_canon", {})           # 같은 말을 여러 번 견주므로(받아쓰기 n-그램) 사전마다 기억해 둔다
    if (name, cutoff) not in memo:
        memo[(name, cutoff)] = _canon(name, key, dic, cutoff)
    return memo[(name, cutoff)]


def _canon(name, key, dic, cutoff):
    if len(key) >= 3:
        hit = dict_name(name, dic, cutoff)
        if hit:
            return hit, True
    for suf in AFFIX:
        if key.endswith(suf) and len(key) - len(suf) >= 2:
            base = key[: -len(suf)]
            for pre in ("",) + PREFIX:
                if pre and not base.startswith(pre):
                    continue
                stem = base[len(pre):]
                head = dic.names.get(stem) or (dict_name(stem, dic, cutoff) if len(stem) >= 3 else None)
                if head and len(stem) >= 2:
                    return pre + head + suf, True
            break
    return name, False


def said_counts(lines, dic, nicks=(), cutoff=90):
    """그 상품의 받아쓰기 [(초, 글)]에서 사전 이름이 나온 횟수 Counter(정식 이름). 한 줄에서 겹치는 말은 긴 쪽 하나만 센다"""
    count = collections.Counter()
    for _, x in lines:
        ws = [w for w in (_JOSA.sub("", raw) if len(raw) > 2 else raw for raw in re.findall(r"[가-힣A-Za-z0-9]+", _SAEK_LIVE.sub(" 색금 ", x))) if w]
        found = []
        for n in (3, 2, 1):
            for i in range(len(ws) - n + 1):
                ph = "".join(ws[i:i + n])
                if len(norm(ph)) < 2 or ph in _STOP or not_a_name(ph, nicks):
                    continue
                name, known = canon(ph, dic, cutoff)
                if known and not any(i < j + m and j < i + n for j, m, _ in found):
                    found.append((i, n, name))
        for name in {name for _, _, name in found}:
            count[name] += 1
    return count


STRONG_MENTIONS = 3                                                       # 사전 이름이 이만큼 나왔으면 굳은 이름(뒤 답으로 바꾸지 않는다)


def pick_name(llm_names, lines, dic, nicks=(), detail=False):
    """→ (서버로 보낼 품종 이름 또는 "", 까닭). llm_names = 그 번호에 LLM이 적은 이름들(답한 순서), lines = 그 상품의 받아쓰기 [(초, 글)]
    detail=True면 (이름, 까닭, 굳은 이름인가) — LLM과 사전이 같거나 사전 이름이 STRONG_MENTIONS번 넘게 나온 이름"""
    name, why, strong = _pick_name(llm_names, lines, dic, nicks)
    return (name, why, strong) if detail else (name, why)


def _pick_name(llm_names, lines, dic, nicks):
    nicks = set(nicks) | nicknames(lines)
    votes, known_of, order = collections.Counter(), {}, {}
    for k, raw in enumerate(llm_names):
        name = tidy(raw) if raw else ""
        if not name or not_a_name(name, nicks):
            continue
        name, known = canon(name, dic)
        key = norm(name)
        votes[key] += 1
        known_of[key] = (name, known)
        order[key] = k
    llm = max(votes, key=lambda k: (votes[k], known_of[k][1], order[k])) if votes else None
    said = said_counts(lines, dic, nicks)
    # 사전 1순위: 많이 나온 이름, 같으면 무늬 말(색금·녹금)보다 이름, 그다음 긴 이름
    top = max(said, key=lambda n: (said[n], norm(n) not in GENERIC, len(norm(n)))) if said else None
    if llm and top and llm == norm(top):
        return known_of[llm][0], "LLM과 사전이 같음", True
    if llm and known_of[llm][1]:
        return known_of[llm][0], "LLM 이름이 사전에 있음", False
    if top and said[top] >= MENTIONS:
        return top, f"사전 이름이 받아쓰기에 {said[top]}번", said[top] >= STRONG_MENTIONS
    return "", "모름", False
