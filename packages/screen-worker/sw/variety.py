# 품종: 상품을 파는 동안 판매자가 한 말에서 품종 후보를 만들고(사전과 소리가 비슷한 말), 규칙(가장 비슷한 것)과 맥 LLM(후보 중 고르기)으로 1순위를 정한다.
# 금액과 같은 원칙: LLM은 이름을 지어내지 않고 후보 번호만 고른다. 판매자가 확인한다.
#  - 사전 = 라이브지니 품종 사전(2,082개 + 별칭) + 채팅·방송 제목에서 거둔 이름(sw/harvest.py)
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
    def __init__(self, exclude_src=None, harvest=True, seller=False, clean=False, market=False):
        """market=True: 넓은 시장 사전(data/varieties_market.json, D-RECOG-43)만 읽는다 — 품종 고르기 시장 방식(sw.variety_market)이 쓴다.
        이름마다 실제로 붙어 팔린 무늬 말을 붙인 이름("먼로철화")과 철자 변형(별칭)도 싣는다.
        seller=True: 판매자가 손으로 고친 이름·별칭(data/varieties_seller.json)도 읽는다 — 라이브 LLM 등록의 품종 고르기(pick_name)만 켠다.
        옛 규칙 길(decide_name·variety_regress)은 그대로라 지난 시험 점수가 바뀌지 않는다.
        clean=True: 품종과 옵션을 따로 정리한 사전(data/varieties_clean.json, D-SCR-38)을 읽는다 — 가게 장부 방식(shop)의 품종 고르기만 켠다.
        품종 이름과 틀리게 들리는 모양을 싣고, 사전에 적혀 있던 그대로의 이름("쿠스백금")도 그대로 알아본다. 품종이 아닌 말·옵션뿐인 말은 없다"""
        mp = os.path.join(HERE, "..", "data", "varieties_market.json")
        if market and os.path.exists(mp):
            names = {}
            with open(mp, encoding="utf-8") as f:
                rows = json.load(f)["names"]
            for v in rows:
                if not v.get("of") and len(norm(v["name"])) >= 2:
                    names.setdefault(norm(v["name"]), v["name"])
            for v in rows:
                if v.get("of"):
                    names.setdefault(norm(v["name"]), v["of"])          # 철자 변형은 흔한 쪽 이름으로
                for w in v.get("written", ()):                          # 무늬 말·앞말이 붙어 팔린 꼴("먼로철화", "SP몰게인")
                    names.setdefault(norm(w), w.replace(v["name"], v["of"]) if v.get("of") else w)
            self.names = names
            self.keys = list(names)
            self.jkeys = [jamo(k) for k in self.keys]
            return
        cp = os.path.join(HERE, "..", "data", "varieties_clean.json")
        if clean and os.path.exists(cp):
            names = {}
            with open(cp, encoding="utf-8") as f:
                # SP·종자(품종 이름을 모르는 것을 부르는 품종, D-DICT-SP-02)는 여기서 맞추지 않는다 — 일꾼은 이름 없이 판 상품 길(split_parts·pick_shop)로 고른다
                rows = [v for v in json.load(f)["varieties"] if not v.get("unnamed")]
            for v in rows:
                names[norm(v["name"])] = v["name"]
            for v in rows:
                for w in v.get("written", ()):
                    names.setdefault(norm(w), w)
                for a in v.get("aliases", ()):
                    names.setdefault(norm(a), v["name"])
            self.names = names
            self.keys = list(names)
            self.jkeys = [jamo(k) for k in self.keys]
            return
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
_STOP_THANK = {"자", "요거", "이거", "그리고", "여러분", "대단히", "완전", "찐", "아주", "또", "다시", "역시", "우리", "바로", "빨리", "잘", "꼭"}


_NICK_TITLE = re.compile(r"(?:사장|회장|대표|여사|선생|형|언니|누나|오빠|이모)$")   # "별빛사장님"의 사장 — 떼고 앞 이름만 본다
_THANKED = re.compile(r"([가-힣A-Za-z]{2,8})\s(?:감사합니다|감사드립니다|감사드리고|감사해요|땡큐|축하드립니다|축하드리고|축하합니다)")
_NOT_THANKED = {"진짜", "정말", "너무", "문자", "오늘", "항상", "다들", "모두", "먼저", "일단", "많이", "잡으셔서", "주셔서", "들어오셔서", "해주셔서", "와주셔서"}


def nicknames(lines):
    """판매자가 '○○님'으로 부르거나 '○○ 감사합니다'로 인사한 이름(찜한 손님) — 품종으로 고르면 안 된다"""
    out = set()
    for _, x in lines:
        for m in re.finditer(r"([가-힣A-Za-z]{2,8})\s?님", x):
            w = m.group(1)
            if w not in _NOT_NICK and not any(w.startswith(n) for n in _NOT_NICK):
                out.add(w)
                short = _NICK_TITLE.sub("", w)
                if len(short) >= 2 and short != w:
                    out.add(short)
        for m in re.finditer(_THANKED, x):
            w = m.group(1)
            if w not in _NOT_NICK and w not in _NOT_THANKED and w not in _STOP_THANK and not re.search(r"(?:님|번|원|개)$", w):
                out.add(w)
    return out


# "유아이"(요 아이 = 이 상품)를 받아쓰기·LLM이 이름 옆에 적는다(2026-11-16 방송 408번 "뿌리 보감 유아이도" → 뿌리보감유아이도, "UI는 LSP",
#   450번 "유아의 환영 마리아") — 따로 선 말일 때만 뗀다(D-RETRO16-08)
_UI = re.compile(r"(?:^|(?<=\s))(?:UI|유아이|요아이|여아이|유아의|요아의)(?:는|도|가|의)?(?=\s|$)", re.I)


def clean(name):
    name = _UI.sub("", _FILLER.sub("", (name or "").strip())).strip()
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


def sound(s):
    """받아쓰기가 흔히 바꿔 듣는 소리만 접은 자모(D-RETRO16-04): 모음 ㅡ·ㅜ(포르트나 → 포르투나), 받침 ㅇ·ㄴ(킨레드 → 킹레드), ㅐ·ㅔ.
    가게 장부의 sjamo보다 훨씬 좁다 — 전국 사전 2,500여 이름에서 이렇게 접어 같아지는 이름은 18쌍뿐이다"""
    out = []
    for ch in s:
        c = ord(ch) - 0xAC00
        if 0 <= c < 11172:
            jung, jong = _JUNG[(c % 588) // 28], _JONG[c % 28].strip()
            out.append(_CHO[c // 588] + ("ㅜ" if jung == "ㅡ" else jung) + ("ㄴ" if jong == "ㅇ" else jong))
        else:
            out.append(ch)
    return "".join(out).replace("ㅔ", "ㅐ")


def sound_name(name, dic, cutoff=88):
    """dict_name이 못 찾은 이름을 소리를 접어 한 번 더 찾는다 — 접은 소리로 cutoff 넘게 비슷한 사전 이름이 하나뿐일 때만(둘이면 고르지 않는다).
    자모 편집 거리 비율(rapidfuzz ratio)은 모음 하나 바뀐 네 글자 이름이 87.5점이라 cutoff 88에 걸렸다(186번 포르트나 분채)"""
    skeys = dic.__dict__.get("_skeys")
    if skeys is None:
        skeys = dic.__dict__["_skeys"] = [sound(k) for k in dic.keys]
    hits = {dic.names[dic.keys[i]] for _, _, i in process.extract(sound(norm(name)), skeys, scorer=fuzz.ratio, limit=3, score_cutoff=cutoff)}
    hits = {h for h in hits if _tail(h) == _tail(name)}
    return hits.pop() if len(hits) == 1 else None


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


_words_of = _words                                                         # 아래 옵션 글 나누기(_words)가 같은 이름이라 낱말 나누기를 이 이름으로도 둔다


def said_with_number(lines, no, dic, nicks=None, need_dict=False):
    """그 번호를 말한 문장들에서 이름 후보 → 가장 그럴듯한 이름 하나(없으면 None)"""
    from .decide import numbers_loose, numbers_with_beon
    nicks = nicknames(lines) if nicks is None else nicks
    score = {}
    for _, x in lines:
        if no not in numbers_with_beon(x) and no not in numbers_loose(x):
            continue
        ws = _words_of(x)                                                  # 낱말 나누기(옵션 글 나누기 _words가 같은 이름으로 뒤에 있다)
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
             "사이즈", "대품", "중품", "소품", "고급종", "저렴이", "커팅", "실생", "선물", "가격", "번호", "마지막", "오프닝", "이벤트", "득템", "쿠폰", "행복",
             # 2026-11-13 방송에서 LLM이 품종으로 적은 말: 모양을 이르는 말("청수가 좋네", "입성이 다르다")과 파는 꼴
             "청수", "청소", "층수", "입성", "장입성", "입장", "잎장", "모주", "직배", "집배", "분채", "이름표", "가격표", "커팅사이즈"}
GENERIC = {"색금", "녹금", "금", "철화", "종자", "산반", "복륜"}          # 이름이라기보다 무늬·종류를 이르는 말 — 다른 이름이 있으면 그쪽이 먼저
MENTIONS = 2                                                              # (b): 사전 이름이 받아쓰기에 이만큼 나와야 한다
_COUNT_TAIL = re.compile(r"\s*(?:\d+|한|두|세|네|다섯)\s*(?:개|포기|두|촉|장|세트|번)\s*$")
_ONLY_COUNT = re.compile(r"^\s*(?:\d+|한|두|세|네|다섯|여러)\s*(?:개|포기|두|촉|장|세트|번|가지|종류)?\s*$")
_GREET = re.compile(r"감사|고맙|고마워|축하|안녕|어서\s?오|반갑|잡으셨|잡아요|잡으세요|들어오세요|수고|사랑해|땡큐")
# 받아쓰기·LLM이 '색금'을 적는 모양(2026-11-12 방송: 세금 62 · 새껌 8 · 3금 6 · 새금 6 · 세 끔 6 · 새 끔 6 · 새꿈 3 · 색급 3 · 세크 1, LLM 첫 답 세검·새검,
#   2026-11-16 방송: 셋금 — 27번 "슈빌셋금 분채" → 슈빌색금, D-RETRO16-01. 붙여 쓴 셋금만, 선셋·썬셋(사전 품종)은 그대로)
_SAEK_LIVE = re.compile(r"(?<![선썬])셋금|(?:세|새|색|섹|쌕)\s?(?:금|끔|껌|꿈|검|급|컴|김)|세크|(?<=[가-힣A-Za-z])\s?3\s?금|^3\s?금")
# 한글로 읽어 적은 "에스피"는 SP다(D-DICT-SP-01, 사용자 2026-11-16 "사전에 에스피 들어있는데 이거 다 SP로 병합해") — 이름의 앞·끝·따로 선 말일 때만
# 받아쓰기는 SP를 NSP·ASP·엔스피로도 적는다(2026-11-16 방송: 3·7·14·484번이 "NSP"로 등록, 판매자는 "SP입니다") — 따로 선 말일 때만 SP로(D-RETRO16-02)
#   같은 방송에 LSP·N.SP·UISP·에이스피·앤스피도 나왔다(442·161·437번, 판매자 "SP를 ASP, LSP, NSP 로 인식함") — 앞에 붙은 로마자 한 글자(점 있어도)는 모두 SP로(D-RETRO16-05)
_SP_READ = re.compile(r"(?<![가-힣])(?:에이|에|엔|앤|애)스\s?피|(?:에이|에|엔|앤|애)스\s?피(?![가-힣])|(?<![A-Za-z])(?:UI\s?|[A-Za-z]\.?)?SP(?![A-Za-z])", re.I)


def sp_read(text):
    """ "에스피색금"·"에스피 금"·"NSP 분채"·"LSP"·"N.SP"·"엔스피" → "SP색금"·"SP 금"·"SP 분채"·"SP"·"SP"·"SP". 사전을 만들 때(clean_dict)와 방송 중 이름을 쪼갤 때(split_parts) 같이 쓴다"""
    return _SP_READ.sub("SP", text or "")


# 받아쓰기가 이름 뒤 옵션 말을 적는 모양(2026-11-16 방송, D-RETRO16-06~08) — 방송 중 들은 이름에만(사전 이름에는 하지 않는다, D-DICT-OPT-01 ⑤):
#   백금 → "100금"(427번 쿠스 100금, 판매자 "숫자 백금으로 적히네요") — 금이 바로 붙은 100만. 가격 "100"·"1,100금"은 그대로
#   녹금 → "높금"(484번 높금 SP) · 철화 → 철학·처라·쳐라·절하(161번 N.SP 철학, 레인보우 철학, 진달래처라) · 분채 → 분체·문채(442번 SP분체, 417번 슈빌문채)
_BAEK = re.compile(r"(?<![\d,.])100\s?금")
_NOK_HIGH = re.compile(r"높\s?금")
_CHEOL = re.compile(r"(?:철학|처라|쳐라|절하)(?=$|[\s.,]|분채|분체|SP|[A-Za-z])")
_BUNCHAE = re.compile(r"(?:분체|문채)(?=$|[\s.,])")


def heard_fix(text):
    """LLM·받아쓰기가 적은 이름 글에서 옵션 말의 받아쓰기 모양을 바로잡는다: 색금·SP·백금·녹금·철화·분채"""
    text = sp_read(_SAEK_LIVE.sub("색금", text or ""))
    text = _NOK_HIGH.sub("녹금", _BAEK.sub("백금", text))
    return _BUNCHAE.sub("분채", _CHEOL.sub("철화", text))


AFFIX = ("복륜금", "색금종자", "색금", "창금", "녹금", "철화", "산반", "복륜", "종자", "무지", "금")   # 이름 뒤에 붙는 말 — 앞 이름만 사전과 맞추고 그대로 붙인다
PREFIX = ("창",)                                                          # 이름 앞에 붙는 말("창녹금")


def tidy(name):
    """LLM·받아쓰기가 적은 이름 다듬기: 앞 군말·뒤 수량("로라클론 4개") 떼기, 색금 바로잡기"""
    name = _COUNT_TAIL.sub("", clean(name))
    return heard_fix(name).strip()


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


def canon(name, dic, cutoff=88, fold=True):
    """다듬은 이름 → (정식 이름, 사전에 있는가). 통째로 사전에 있거나(철자 바로잡기 포함), 앞 이름이 사전에 있고 뒤에 색금·금·철화…가 붙은 꼴.
    fold = 철자로 못 찾으면 받아쓰기가 헷갈리는 소리를 접어 한 번 더 찾는다(sound_name, D-RETRO16-04) — LLM이 적은 이름에만. 받아쓰기 낱말을 셀 때(said_counts)는 끈다"""
    key = norm(name)
    if key in dic.names:
        return dic.names[key], True
    memo = dic.__dict__.setdefault("_canon", {})           # 같은 말을 여러 번 견주므로(받아쓰기 n-그램) 사전마다 기억해 둔다
    if (name, cutoff, fold) not in memo:
        memo[(name, cutoff, fold)] = _canon(name, key, dic, cutoff, fold)
    return memo[(name, cutoff, fold)]


def _canon(name, key, dic, cutoff, fold=True):
    if len(key) >= 3:
        hit = dict_name(name, dic, cutoff) or (sound_name(name, dic, cutoff) if fold else None)
        if hit:
            return hit, True
    for suf in AFFIX:
        if key.endswith(suf) and len(key) - len(suf) >= 2:
            base = key[: -len(suf)]
            for pre in ("",) + PREFIX:
                if pre and not base.startswith(pre):
                    continue
                stem = base[len(pre):]
                head = dic.names.get(stem) or (dict_name(stem, dic, cutoff) or (sound_name(stem, dic, cutoff) if fold else None) if len(stem) >= 3 else None)
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
                name, known = canon(ph, dic, cutoff, fold=False)
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


# ---------- 가게 장부로 품종 고르기 (D-SCR-29~32, 2026-11-13 방송 복기 뒤 — 개선 단계표 B단계) ----------
# 전국 사전으로 거르던 D-SCR-15는 맞는 이름을 버렸다(11-13 방송: 틀린 이름 21개를 막고 맞는 이름 47개를 버림 — 그 가게 품종 118가지 중 64가지가 사전에 없었다).
# 바꾼 것: LLM이 적은 이름을 기본으로 쓰고, 그 가게가 파는 품종 목록(장부)에서 소리가 가장 가까운 이름으로 철자를 맞춘다.
#   장부에 없는 이름은 버리지 않고 "확인 중 품종"(unsure)으로 보낸다 — 판매자가 확정하면 장부에 더해진다. 품종이 아닌 말(닉네임·인사·재고)만 거른다.
#   이름은 품종 / 옵션 / 개수로 나눈다: "은갈치퍼플"·"밀레창"·"황소윗동"처럼 옆 말이 붙은 것과 "테라로사색금"을 "색금"으로 줄이던 것을 막는다.
# 옵션 목록은 하나다(D-DICT-OPT-01, 사용자 2026-11-17 "방송 중에 'SP색금'이라고 말하면 품종은 SP, 옵션은 색금 이렇게 따로 인식한 다음 품명에는 'SP 색금'"):
#   사전을 만들 때(clean_dict)와 방송 중 이름을 읽을 때(split_parts) 같은 목록·같은 함수로 뗀다. 무늬·형태·갈래를 나누지 않고 모두 옵션이다.
#   보내는 이름은 "품종 옵션"(띄어 씀): "SP 색금", "청개구리 백금", "슈빌 색금 분채". 품종 이름이 없으면 옵션만("색금").
#   분채 같은 파는 꼴도 옵션이라 이름에 남긴다 — D-RETRO16-01 ②의 "분채는 이름에서 뗀다"를 바꿈(판매자가 말한 것을 버리지 않는다)
# 같은 옵션의 다른 모양 → 한 모양(D-DICT-OPT-02, 사용자 2026-11-17 "창, 창금, 창녹, 창색 → 다 창으로 통일", "찐녹, 찐녹금 둘 다 같은걸로 통일
#   (복륜, 복륜금와 같은 형태면 같은걸로 본다)"). X와 X금은 같은 옵션 — 사전·두 방송에서 더 많이 쓴 모양으로 적는다
# 녹색은 없는 옵션이고, 녹색금(녹금 + 색금)은 녹금·색금과 다른 옵션이다(D-DICT-OPT-03, 사용자 2026-11-17).
#   X와 X금의 대표 모양은 판매자가 영수증에 쓴 쪽: 복륜(루밍복륜)·수박·찐녹, 영수증에 없으면 사전에 많은 쪽(변이)
SAME = {"복륜금": "복륜", "수박금": "수박", "변이금": "변이", "찐녹금": "찐녹",
        # 핏줄은 빨간 색이 올라온 금이라 색금에 든다: 핏줄 = 핏줄금 = 핏줄색금 → "핏줄금"(D-DICT-OPT-05, 사용자 2026-11-17 "품종은 SP, 옵션은 핏줄금").
        #   힘줄은 금이 아니라 돌기다 — 힘줄금은 힘줄 + 금으로 따로 둔다
        "핏줄": "핏줄금", "핏줄색금": "핏줄금"}
# 창은 모양이고 그 위에 금·녹금·색금이 더해진다 — 창과 무늬를 따로 적는다(D-DICT-OPT-04, 사용자 2026-11-17 "창금 창녹 창색에서 창과 따로 봐야 해.
#   창 이라는 모양에 금, 녹금, 색금이 추가된 구조"): 창금 → 창 금, 창녹 → 창 녹금, 창색 → 창 색금, 창녹금 → 창 녹금, 창녹색금 → 창 녹색금
SPLIT = {"창금": ("창", "금"), "창녹": ("창", "녹금"), "창색": ("창", "색금")}
# 사전·두 방송에 한 번이라도 나온 옵션만 둔다(D-DICT-OPT-02, 사용자 "아무데도 등록된 적 없는 애들은 … 필요없으면 지워": 아랫동·커팅·중품·소품을 뺌)
OPTIONS = tuple(sorted(set(SAME) | set(SPLIT) | {
    "녹색금", "복륜", "색금", "녹금", "백금", "찐녹", "철화", "산반", "수박", "힘줄", "핏줄금", "무지", "변이종", "변이", "금",   # 무늬
    "군생", "윗동", "자구", "분채", "대품", "쌍두", "외두",                                                                 # 파는 꼴
    "교배종", "특이종", "실생", "환엽"}, key=lambda w: (-len(w), w)))                                         # 어떻게 난 것인가(긴 것부터 뗀다)
# 환엽(넓은 잎)은 품종이 아니라 옵션 — 쇼핑몰에서 "환엽"으로 찾으면 환엽 마리아·환엽 실생·SP가 다 나온다(D-DICT-OPT-05). 이름 앞에 붙는다
HEADS = ("수입", "실생", "환엽")                                                   # 이름 앞에 붙는 옵션("수입몰디브" → 몰디브 + 수입)
UNNAMED = ("종자", "SP")                                                   # 품종 이름을 모르는 것을 부르는 품종(D-DICT-SP-02): 종자 = 고급 SP, SP = 종자를 모르는 것. 둘 다 있으면 종자
EVENT = ("꿀이벵", "이벵", "특가", "툭가")                                 # 행사·값 말 — 옵션이 아니다. 이름에서 지운다("블루엘프특가" → 블루엘프)
# 옵션만으로 된 말(품종이 아니다)
PATTERN_ONLY = set(OPTIONS) | set(HEADS) | set(UNNAMED) | {"창", "환엽", "골드"}
PATTERNS, FORMS = OPTIONS, ()                                              # 옛 이름(다른 도구가 읽는다)
# 품종 없이 이 말만 하고 판 상품(D-RETRO16-09, 판매자 "그냥 옵션만 말하면 상품명으로 안 적는 문제"): "4번 분채 2만원"·"164번 화분 6,000원"(화분 자체를 판다).
#   답이 이 말뿐이면 품종이 아닌 말(NOT_NAMES)로 버려져 이름이 비었다 — 품종도 다른 옵션도 들리지 않았을 때만 그 말을 이름으로 보낸다.
#   분채는 옵션이라 "포르투나 분채"처럼 이름에 붙으면 그대로 남는다(D-DICT-OPT-01). 이름이 이 말뿐이면 빈칸처럼 보고 뒤 답의 이름으로 채운다(bare_name)
BARE_WORDS = ("분채", "화분")
_QTY = re.compile(r"\s*((?:\d+|한|두|세|네|다섯)\s*(?:개|포기|두|촉|장|세트)|통째|통채|통으로)\s*$")
LEDGER_CUT = float(os.environ.get("LLM_LEDGER_CUT", 72))                  # 장부 이름과 자모 편집 거리 비율이 이만큼 넘으면 그 이름으로 맞춘다
LEDGER_CUT_SHORT = float(os.environ.get("LLM_LEDGER_CUT_SHORT", 80))      # 두 글자쯤의 짧은 이름은 더 엄하게("청수"가 청춘에, "산마"가 삼광에 붙지 않게)
_NOK_TAIL = re.compile(r"(?:노금|녹음|녹급|녹극|녹운|노끔|녹끔|록금)$")       # 받아쓰기가 이름 끝의 '녹금'을 적는 모양(11-13 방송: 녹음 41 · 노금 6 · 녹급 4, LLM 답 녹극·녹운·창록금)
_JJIN_TAIL = re.compile(r"(?:찐|진)(?:노|농|록|녹)$")                       # '찐녹'을 적는 모양(11-13 방송 LLM 답: 찐노 4 · 진농 4 · 진노 3 · 창찐록 3)
LEDGER_SAID_CUT = float(os.environ.get("LLM_LEDGER_SAID_CUT", 86))        # 받아쓰기 낱말을 장부 이름으로 볼 자모 비율(짧은 이름은 소리가 같을 때만)
LEDGER_SHORT_LEN = int(os.environ.get("LLM_LEDGER_SHORT_LEN", 2))         # 이만큼(글자)까지의 이름은 짧은 이름으로 보고 더 엄하게 맞춘다("청송"이 채홍에, "호스"가 윤슬에 붙었다)
LEDGER_WEIGHT = float(os.environ.get("LLM_LEDGER_WEIGHT", 3))              # LLM이 적은 모르는 이름이 장부 이름을 이기려면 답이 이 배수보다 많아야 한다(같은 받아쓰기를 거듭 읽은 답은 같은 틀린 말을 거듭 적는다)
LEDGER_SAID_OVER = int(os.environ.get("LLM_LEDGER_SAID_OVER", 0))         # 받아쓰기에 장부 이름이 이만큼 나오면 LLM이 적은 모르는 이름도 덮는다(0 = 덮지 않음)
LEDGER_SAID_SCOPE = os.environ.get("LLM_LEDGER_SAID_SCOPE", "all")        # near = 번호를 처음 말한 줄의 한 줄 앞부터만 본다(앞 상품 이야기가 섞이지 않게)
LEDGER_SAID_ADJ = os.environ.get("LLM_LEDGER_SAID_ADJ", "1") != "0"       # 번호 바로 옆에서 말한 장부 이름("46번 아웃사이드")은 두 번으로 센다
LEDGER_SAID = int(os.environ.get("LLM_LEDGER_SAID", 2))                    # 장부 이름이 그 상품 받아쓰기에 이만큼 나오면 LLM이 적은 모르는 이름보다 먼저 쓴다(0 = 끔)
LEDGER_PREFIX = 3                                                          # 장부 이름이 앞·뒤에 통째로 들어 있을 때("은갈치퍼플"의 은갈치)는 이만큼(글자) 넘는 이름만


# 받아쓰기가 흔히 바꿔 적는 소리는 한 소리로 접어 견준다: 쉘/셀, 홍/용, 혜/애, 쿠/구, 뱅/벵 — 좁은 가게 목록 안에서만 쓴다(전국 사전에서는 다른 품종끼리 붙는다)
_FOLD = str.maketrans({"ㅛ": "ㅗ", "ㅜ": "ㅗ", "ㅠ": "ㅗ", "ㅑ": "ㅏ", "ㅕ": "ㅓ", "ㅖ": "ㅐ", "ㅒ": "ㅐ", "ㅔ": "ㅐ", "ㅞ": "ㅐ", "ㅙ": "ㅐ", "ㅚ": "ㅐ", "ㅢ": "ㅣ", "ㅟ": "ㅣ", "ㅘ": "ㅏ", "ㅝ": "ㅓ",
                       "ㅋ": "ㄱ", "ㄲ": "ㄱ", "ㅌ": "ㄷ", "ㄸ": "ㄷ", "ㅍ": "ㅂ", "ㅃ": "ㅂ", "ㅊ": "ㅈ", "ㅉ": "ㅈ", "ㅆ": "ㅅ", "ㅎ": "ㅇ"})


def sjamo(s):
    """자모로 풀고 헷갈리는 소리를 접은 글"""
    return jamo(s).translate(_FOLD)


class Ledger:
    """가게 품종 장부: 그 가게가 파는 품종 이름과 틀리게 들리는 모양(별칭), 가게 말버릇.
    파일 모양 {"names": [{"name": "쿠스", "aliases": ["코스", "구스"]}], "habits": {"색금": "SP"}} — 영수증·손 수정·확정에서 쌓는다(손님 이름은 넣지 않는다)"""

    def __init__(self, path=None, names=(), habits=None):
        rows = [{"name": n} for n in names]
        self.habits = dict(habits or {})
        if path and os.path.exists(path):
            d = json.load(open(path, encoding="utf-8"))
            rows += d.get("names", [])
            self.habits.update(d.get("habits") or {})
        self.names = {}                                                    # norm(이름·별칭) → 정식 이름
        for v in rows:
            name = " ".join(str(v.get("name") or "").split())
            if len(norm(name)) < 2:
                continue
            self.names.setdefault(norm(name), name)
            for a in v.get("aliases", ()):
                if len(norm(a)) >= 2:
                    self.names[norm(a)] = name
        self.keys = list(self.names)
        self.jkeys = [sjamo(k) for k in self.keys]

    def __bool__(self):
        return bool(self.keys)

    def near(self, name, cutoff=None):
        """→ (장부의 정식 이름 또는 None, 점수). 글자가 같으면 100, 아니면 자모 편집 거리 비율이 가장 큰 이름(cutoff 넘을 때)"""
        key = norm(name)
        if key in self.names:
            return self.names[key], 100.0
        if len(key) < 2 or not self.keys:
            return None, 0.0
        folded = sjamo(key)
        if cutoff is None:
            cutoff = LEDGER_CUT_SHORT if len(folded) <= 5 or len(key) <= LEDGER_SHORT_LEN else LEDGER_CUT
        hit = process.extractOne(folded, self.jkeys, scorer=fuzz.ratio, score_cutoff=cutoff)
        return (self.names[self.keys[hit[2]]], hit[1]) if hit else (None, 0.0)

    def inside(self, name):
        """이름의 앞이나 뒤에 통째로 들어 있는 장부 이름(가장 긴 것) — "은갈치퍼플" → 은갈치, "만화손톱" → 손톱"""
        key = norm(name)
        best = None
        for k in self.keys:
            if LEDGER_PREFIX <= len(k) < len(key) and (key.startswith(k) or key.endswith(k)) and (best is None or len(k) > len(best)):
                best = k
        if best is None:                                                   # 두 글자 이름은 앞에 있고 나머지가 무늬·형태 말일 때만("밀레창", "황소윗동")
            for k in self.keys:
                if len(k) == 2 and key.startswith(k) and key[2:] in PATTERN_ONLY:
                    best = k
        return self.names[best] if best else None


def parts(name, heard=True):
    """heard=False(사전에 적힌 이름): 받아쓰기 소리 바로잡기(녹음 → 녹금 등)를 하지 않는다("모노금"이 모녹금이 되지 않게).
    이름 → (품종, [앞 옵션…], [옵션…], 개수). 사전을 만들 때와 방송 중이 같이 쓴다(D-DICT-OPT-01).
    "몰디브색금무지" → (몰디브, [], [색금, 무지]), "수입몰디브" → (몰디브, [수입], []), "SP색금" → ("", [], [SP, 색금]), "색금종자" → ("", [], [색금, 종자]),
    "블루엘프특가" → (블루엘프, [], []), "채홍 3개" → (채홍, [], [], 3개). 품종 이름이 없으면 품종은 "" — SP·종자도 옵션 자리에 둔다(label이 앞으로 옮긴다)"""
    text = clean(name)
    qty = ""
    m = _QTY.search(text)
    if m:
        qty, text = "".join(m.group(1).split()), text[:m.start()]
    text = (heard_fix(text) if heard else sp_read(_SAEK_LIVE.sub("색금", text))).strip()
    fix = (lambda k: _JJIN_TAIL.sub("찐녹", _NOK_TAIL.sub("녹금", k))) if heard else (lambda k: k)
    key = fix(norm(text))
    if heard and len(key) >= 3 and key[0] in "이자요저그" and key[1:] in PATTERN_ONLY:   # "이 색금"·"자 색금"을 붙여 적은 것
        key = key[1:]
    heads, opts = [], []
    for h in HEADS:
        if key.startswith(h) and (len(key) - len(h) >= 2 or key[len(h):].upper() in PATTERN_ONLY):
            heads.append(h)
            key = key[len(h):]
            break
    changed = True
    while changed and key:
        changed = False
        for w in EVENT + UNNAMED + OPTIONS:
            rest = key[:-len(w)]
            # 품종이 한 글자만 남게는 떼지 않는다("황금" → 황 + 금 아님). 남는 것이 옵션뿐인 말이면 뗀다
            if w == "SP" and rest[-1:].isascii() and rest[-1:].isalpha():
                continue                                                   # "RASP"처럼 다른 로마자에 붙은 SP는 그대로
            if key.upper().endswith(w) and (len(rest) >= 2 or not rest or rest.upper() in PATTERN_ONLY):
                if w not in EVENT:
                    opts.insert(0, w)
                key = fix(rest)
                changed = True
                break
    if opts and opts[0] in ("녹금", "색금", "녹색금") and key.endswith("창") and len(key) >= 3:
        opts.insert(0, "창")                                               # "몰디브창색금" → 몰디브 + 창 + 색금(D-DICT-OPT-03·04 — 창과 무늬를 따로)
        key = fix(key[:-1])
    if key.upper() in PATTERN_ONLY:
        opts.insert(0, key.upper() if key.upper() in UNNAMED else key)
        key = ""
    for u in UNNAMED:                                                      # "SP골드"·"SP창": 앞의 SP 뒤가 옵션뿐이면 SP + 옵션
        if key.upper().startswith(u) and key[len(u):].upper() in PATTERN_ONLY:
            opts[:0] = [u, key[len(u):]]
            key = ""
    return key, heads, same(opts), qty


def same(opts):
    """옵션을 한 모양으로(SAME): "복륜금" → 복륜, 창 + 무늬는 나눠서(SPLIT): "창녹" → 창, 녹금.
    뒤에 따로 붙은 "금"이 앞 옵션과 같은 것이면 뺀다("찐녹 금" → 찐녹). "창 금"은 창 + 금 그대로"""
    out = []
    for word in opts:
        for o in SPLIT.get(word, (word,)):
            o = SAME.get(o, o)
            if o == "금" and out and out[-1] + "금" in SAME:
                continue
            if o in ("금", "색금") and out and out[-1] == "핏줄금":            # "핏줄 색금"·"핏줄 금" → 핏줄금 하나
                continue
            if out and out[-1] == o:
                continue
            out.append(o)
    return out


def _unnamed(pat):
    """옵션 글에 품종 SP·종자가 들어 있나"""
    return any(u in _words(pat)[1] for u in UNNAMED)


def label(base, opts=(), heads=()):
    """보낼 이름: "품종 옵션"(띄어 씀). 품종 이름이 없고 SP·종자가 있으면 그것이 품종이다(D-DICT-SP-02)
    ("몰디브", [색금, 무지]) → "몰디브 색금 무지", ("", [SP, 색금]) → "SP 색금", ("", [색금, 종자]) → "종자 색금", ("", [SP, 종자]) → "종자", ("", [색금]) → "색금" """
    opts = [o for o in opts if o]
    un = [u for u in UNNAMED if u in opts]
    if not base and un:                                                    # 품종 이름이 없으면 SP·종자가 품종
        base, opts = un[0], [o for o in opts if o not in UNNAMED]
    return " ".join(x for x in (*heads, base, *opts) if x)                 # 품종 이름이 있으면 SP도 버리지 않는다("동자SP" → "동자 SP")


def split_parts(name):
    """LLM이 적은 이름 → (품종, 옵션, "", 개수). "테라로사 색금" → (테라로사, 색금, "", ""), "채홍 3개" → (채홍, "", "", 3개), "색금" → ("", 색금, "", ""),
    "아리엘 분채" → (아리엘, 분채, "", ""), "SP색금" → ("", SP색금, "", ""). 옵션은 앞 옵션까지 붙여 적은 글(label이 다시 나눈다)"""
    base, heads, opts, qty = parts(name)
    return base, "".join(heads + opts), "", qty


def _words(pat):
    """붙여 적은 옵션 글 → (앞 옵션, 옵션). "수입색금" → ([수입], [색금]), "SP색금" → ([], [SP, 색금]), "창녹금" → ([], [창, 녹금]).
    이름 나누기(parts)와 같은 규칙으로 뒤에서부터 뗀다 — 앞에서부터 떼면 "창녹금"이 창녹 + 금(→ 창)이 된다(D-DICT-OPT-03)"""
    heads, s = [], pat or ""
    for h in HEADS:                                                        # 앞 옵션은 앞에 둔다("수입", "환엽" → 환엽 마리아)
        if s.startswith(h):
            heads.append(h)
            s = s[len(h):]
            break
    base, more, opts, _ = parts(s, heard=False)
    return heads + more, ([base] if base else []) + opts


# 판매자가 품종 없이 무늬·종류만 말하는 모양(받아쓰기 그대로). "종자"는 칭찬으로 늘 하는 말이라 세지 않는다
_PAT_SAID = (("창녹금", re.compile(r"창\s?(?:녹\s?금|노\s?금|녹\s?음|록\s?금|노\s?끔)")),
             ("창색금", re.compile(r"창\s?(?:세|새|색)\s?(?:금|끔|급|껌)")),
             ("녹색금", re.compile(r"녹\s?색\s?금|녹\s?(?:세|새)\s?(?:금|끔)")),
             ("찐녹", re.compile(r"(?:찐|진)\s?(?:녹|노|농|록)(?![금음급끔])")),
             ("녹금", re.compile(r"(?<!창)(?<!창\s)(?:녹\s?금|높\s?금|노\s?금|녹\s?음|노\s?끔|녹\s?급)")),
             ("색금", re.compile(r"(?<![창녹])(?<![창녹]\s)(?:세|새|색|섹)\s?(?:금|끔|껌|꿈|검|급|컴|김)")),
             ("SP", re.compile(r"(?<![A-Za-z])(?:[A-Za-z]\.?)?SP(?![A-Za-z])|(?:에이|에|엔|앤)스\s?피", re.I)))


def pattern_said(lines):
    """그 상품의 받아쓰기에서 무늬·종류 말이 나온 줄 수 Counter"""
    count = collections.Counter()
    for _, x in lines:
        for name, rx in _PAT_SAID:
            if rx.search(x):
                count[name] += 1
    return count


_DENIED = re.compile(r"^(?:아니|아님|아닌|아녀)")


def denied(name, lines):
    """판매자가 그 이름을 아니라고 말한 줄 수("아베 아니죠", "아베가 아니고")"""
    rx = re.compile(re.escape(norm(name)) + r"(?:이|가|는|은|도|의)?(?:아니|아님|아닌|아녀)")
    return sum(1 for _, x in lines if rx.search(norm(x)))


def ledger_said(lines, ledger, nicks=(), no=None):
    """그 상품의 받아쓰기에서 가게 장부 이름이 나온 줄 수 Counter(정식 이름). 무늬 말뿐인 장부 이름("색금")은 세지 않는다.
    두 글자 이름은 글자가 같을 때만("금이"가 금휘로 읽히지 않게), 세 글자부터는 소리가 같거나(쉘브르·셀브로) 긴 이름이면 LEDGER_SAID_CUT 넘게 비슷할 때.
    한 줄에서 겹치는 말은 긴 쪽 하나만. no를 주면 그 번호 바로 옆에서 말한 이름은 두 번으로 센다"""
    count = collections.Counter()
    if not ledger:
        return count
    memo = ledger.__dict__.setdefault("_said", {})
    mine = re.compile(rf"(?<!\d){int(no)}(?!\d)") if no is not None else None
    if mine is not None and LEDGER_SAID_SCOPE == "near":
        first = next((k for k, (_, x) in enumerate(lines) if mine.search(x)), 0)
        lines = lines[max(0, first - 1):]
    for _, x in lines:
        raws = re.findall(r"[가-힣A-Za-z0-9]+", x)
        ws = [_JOSA.sub("", raw) if len(raw) > 2 else raw for raw in raws]
        found = []
        for n in (3, 2, 1):
            for i in range(len(ws) - n + 1):
                ph = "".join(ws[i:i + n])
                key = norm(ph)
                if len(key) < 2 or ph in _STOP or key in NOT_NAMES:
                    continue
                if key not in memo:
                    if len(key) <= 2:
                        hit = ledger.names.get(key)
                    else:
                        hit, score = ledger.near(key, cutoff=LEDGER_SAID_CUT)
                        if hit and score < 100 and (len(sjamo(key)) <= 5 or len(sjamo(norm(hit))) <= 5):
                            hit = None
                    if hit and not split_parts(hit)[0]:
                        hit = None
                    memo[key] = hit
                hit = memo[key]
                if hit and i + n < len(raws) and _DENIED.match(raws[i + n]):
                    continue                                               # "아베 아니죠", "청사 아니야 황소야": 아니라고 한 이름
                if hit and not not_a_name(ph, nicks) and not any(i < j + m and j < i + n for j, m, _ in found):
                    found.append((i, n, hit))
        beside = lambda i, n: mine is not None and LEDGER_SAID_ADJ and any(
            0 <= j < len(raws) and mine.fullmatch(re.sub(r"번.*$", "", raws[j])) for j in (i - 1, i + n))
        for name in {name for _, _, name in found}:
            count[name] += 2 if any(beside(i, n) for i, n, v in found if v == name) else 1
    return count


def join_parts(base, pat):
    """품종과 옵션 글 → 보낼 이름(label). 품종 이름이 이미 옵션으로 끝나면("황제수박") 그대로"""
    if pat and base and norm(base).endswith(norm(pat)):
        return base
    heads, opts = _words(pat)
    return label(base, same(opts), heads)


def shop_name(raw, ledger, dic=None):
    """LLM 이름 하나 → (정식 이름, 무늬, 형태, 개수, 장부에 있나, 전국 사전에 있나). 품종이 없으면 이름은 ""."""
    base, pat, form, qty = split_parts(raw)
    whole = norm(_QTY.sub("", clean(raw)))
    if ledger and whole in ledger.names:                                   # "황제수박"·"홍등힘줄"처럼 무늬 말로 끝나는 이름이 장부에 통째로 있다
        return ledger.names[whole], "", form, qty, True, False
    if not base:
        return "", pat, form, qty, False, False
    if ledger:
        hit, _ = ledger.near(base)
        hit = hit or ledger.inside(base)
        if hit:
            return hit, pat, form, qty, True, False
    if dic is not None:
        fixed, known = canon(base, dic)
        if known:
            return fixed, pat, form, qty, False, True
    return base, pat, form, qty, False, False


def pick_shop(llm_names, lines, dic, ledger=None, nicks=(), no=None):
    """→ (서버로 보낼 품종 이름 또는 "", 까닭, 굳은 이름인가, 확인 중 품종인가, {"pattern", "form", "qty", "votes", "in_ledger", "source", "tally"})
    llm_names = 그 번호에 LLM이 적은 이름들(답한 순서), lines = 그 상품의 받아쓰기 [(초, 글)]
    고르는 차례(D-SCR-34): ① LLM이 가장 많이 적은 이름이 장부에 있으면 그 이름 ② 장부 이름이 받아쓰기에 LEDGER_SAID번 넘게 나오면 그 이름
    ③ LLM이 적은 모르는 이름(확인 중 품종) ④ 무늬 말만 들렸으면 그 말 ⑤ 받아쓰기에 여러 번 나온 사전 이름"""
    nicks = set(nicks) | nicknames(lines)
    votes, info, order = collections.Counter(), {}, {}
    pats, forms, qtys, only = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    bare = collections.Counter()                                           # "분채"·"화분"만 적은 답 — 품종이 아닌 말(NOT_NAMES)이라 아래에서 버려지므로 따로 센다
    for k, raw in enumerate(llm_names):
        if not raw:
            continue
        cleaned = tidy(raw)
        if norm(cleaned) in BARE_WORDS:
            bare[norm(cleaned)] += 1
            continue
        if not cleaned or not_a_name(cleaned, nicks):
            continue
        name, pat, form, qty, in_ledger, in_dic = shop_name(raw, ledger, dic)
        if form:
            forms[form] += 1
        if qty:
            qtys[qty] += 1
        if not name:
            if pat:
                only[pat] += 1
            continue
        if not_a_name(name, nicks):
            continue
        key = norm(name)
        votes[key] += 1
        order[key] = k
        info[key] = (name, in_ledger, in_dic)
        if pat:
            pats[(key, pat)] += 1
    extra = {"form": forms.most_common(1)[0][0] if forms else "", "qty": qtys.most_common(1)[0][0] if qtys else "",
             "pattern": "", "votes": 0, "in_ledger": False, "rank": 0, "source": "", "tally": dict(votes), "only": {norm(k): n for k, n in only.items()}}
    heard = ledger_said(lines, ledger, nicks, no) if LEDGER_SAID and ledger is not None else collections.Counter()
    best = max(heard, key=lambda n: (heard[n], len(norm(n)))) if heard else None
    top = max(votes, key=lambda k: (votes[k], info[k][1], info[k][2], order[k])) if votes else None
    mine = [k for k in votes if info[k][1]]
    if mine and not info[top][1]:                                          # 장부 이름과 모르는 이름이 같이 나왔다: 모르는 이름이 LEDGER_WEIGHT배 넘게 많지 않으면 장부 이름
        ours = max(mine, key=lambda k: (votes[k], order[k]))
        if votes[ours] * LEDGER_WEIGHT >= votes[top]:
            top = ours
    if top is not None and sum(only.values()) > votes[top]:
        top = None                                                         # 이름을 적은 답보다 무늬 말만 적은 답이 많다 — 이름 없는 상품으로 본다(옆 상품 이름·잘못 들은 말 한 번에 끌려가지 않게)
    elif best is not None and heard[best] >= LEDGER_SAID and not only and (
            top is None or (LEDGER_SAID_OVER and not info[top][1] and heard[best] >= LEDGER_SAID_OVER)):
        # LLM은 이름을 못 적었는데 판매자가 그 상품을 소개하며 장부 이름을 거듭 말했다
        # (LLM이 모르는 이름을 적었을 때는 덮지 않는다 — 처음 파는 품종일 수 있고, 옆 상품의 장부 이름이 섞여 들린다: 117번에서 처음 듣는 이름이 옆 상품의 빅뱅으로 바뀌었다)
        extra.update(votes=heard[best], in_ledger=True, rank=2, source="장부 말")
        return best, f"받아쓰기에 {heard[best]}번 나온 장부 이름", heard[best] >= STRONG_MENTIONS, False, extra
    if top is not None:
        name, in_ledger, in_dic = info[top]
        mine = {p: n for (k, p), n in pats.items() if k == top}
        pat = max(mine, key=mine.get) if mine and max(mine.values()) * 2 >= votes[top] else ""
        sure = in_ledger or (in_dic and votes[top] >= 2)
        extra.update(pattern=pat, votes=votes[top], in_ledger=in_ledger, rank=2 if in_ledger else 1 if in_dic else 0, source="LLM")
        why = "가게 장부에 있는 이름" if in_ledger else "전국 사전에 있는 이름" if in_dic else "LLM이 적은 이름(장부에 없음)"
        return join_parts(name, pat), f"{why} · 답 {votes[top]}번", in_ledger and votes[top] >= 2, not sure, extra
    said = pattern_said(lines)
    if only or said:                                                       # 이름 없이 무늬 말만: 가게 말버릇(장부에 적혀 있을 때만 — 예: 색금만 말하면 SP)
        pat = only.most_common(1)[0][0] if only else max(said, key=said.get)
        if only or said[pat] >= MENTIONS:
            habit = ledger.habits.get(pat) if ledger is not None else None
            extra.update(pattern=pat, votes=only[pat] if only else said[pat], source="무늬 말")
            return habit or join_parts("", pat), "무늬 말만 들림" + (f" → 가게 말버릇 {habit}" if habit else ""), False, False, extra
    named = said_counts(lines, dic, nicks) if dic is not None else collections.Counter()
    named = {n: c - denied(n, lines) for n, c in named.items() if norm(n) not in GENERIC}
    if named and not votes:                                                # LLM이 이름을 적지 않았다: 받아쓰기에 여러 번 나온 사전 이름(D-SCR-15의 (b)와 같다)
        top_said = max(named, key=lambda n: (named[n], len(norm(n))))
        if named[top_said] >= MENTIONS:
            hit = ledger.near(top_said)[0] if ledger is not None and ledger else None
            extra.update(votes=named[top_said], in_ledger=bool(hit), rank=2 if hit else 1, source="사전 말")
            return hit or top_said, f"받아쓰기에 {named[top_said]}번 나온 이름", named[top_said] >= STRONG_MENTIONS, False, extra
    if bare:                                                               # 품종도 다른 옵션도 없이 "분채"·"화분"만 말하고 팔았다 — 빈칸 대신 그 말을 이름으로(D-RETRO16-09)
        word = bare.most_common(1)[0][0]
        extra.update(votes=bare[word], source="파는 꼴 말")
        return word, "파는 꼴·물건 말만 들림", False, False, extra
    return "", "모름", False, False, extra


def said_in(name, text, cutoff=85):
    """이름 name을 이 받아쓴 줄에서 말했나(띄어쓰기·받아쓰기 모양을 바로잡아 견준다). 두 글자 이름은 글자가 같을 때만, 더 긴 이름은 자모가 cutoff 넘게 비슷하면"""
    key, line = norm(heard_fix(clean(name))), norm(heard_fix(text))
    if not key:
        return False
    if key in line:
        return True
    return len(key) > 2 and fuzz.partial_ratio(jamo(key), jamo(line)) >= cutoff


def sounds_alike(a, b, cutoff=70):
    """두 이름이 비슷하게 들리나(같은 상품을 받아쓰기가 다르게 적었을 수 있나, D-RETRO16-11). 소리를 접은 자모의 부분 비율로 본다.
    11-16 방송: 산비 ↔ 선비 군생 80 · 한연말 ↔ 유아의 환영 마리아 89(같은 상품) / 링구아스 ↔ 설록 40 · 진달래변이 ↔ 까르띠에 철화 32(다른 상품)"""
    a, b = norm(heard_fix(clean(a or ""))), norm(heard_fix(clean(b or "")))
    if len(a) < 2 or len(b) < 2:
        return False
    return fuzz.partial_ratio(sound(a), sound(b)) >= cutoff


_NOT_RESTATE = {"여러분", "그쵸", "그죠", "UI", "유아이", "요아이", "여아이", "여기", "여기는", "거기", "저기", "이건", "요건", "얘가", "얘도", "이것도", "요것도", "아이", "애기"}


def name_words(text, nicks=(), no=None, near=4):
    """한 줄에서 품종 이름일 수 있는 낱말 — 번호·금액·쉬는 말·끝말(갈게요·입니다)·인사·손님 이름을 뺀 것.
    no를 주면 그 번호를 말한 낱말에서 near 낱말 안의 것만("442번 SP분체"는 되고, "61번이구요. 사이즈 … 포장하기도 힘들어"의 먼 말은 뺀다).
    "146번 은희님 감사합니다"는 [], "484번 녹음 SP입니다"는 ["녹음"]"""
    nicks = set(nicks) | nicknames([(0, text)])
    words = _words_of(heard_fix(text))
    at = [i for i, (raw, _) in enumerate(words) if no is not None and re.fullmatch(rf"0*{int(no)}(?:번.*)?", raw)]
    out = []
    for i, (raw, w) in enumerate(words):
        if no is not None and not any(abs(i - j) <= near for j in at):
            continue
        if re.search(r"\d", raw) or raw in _STOP or w in _STOP or w in _STOP_THANK or w.upper() in _NOT_RESTATE or _GREET.search(raw) or raw.endswith("님") \
                or _VERB.search(raw) or len(norm(w)) < 2:
            continue
        if norm(w).upper() != "SP" and not_a_name(w, nicks):
            continue
        out.append(w)
    return out


def bare_name(name):
    """품종도 무늬 말도 없이 파는 꼴·물건 말뿐인 이름("분채", "화분")인가 — 빈칸처럼 뒤 답의 이름으로 채운다"""
    if norm(name) == "화분":
        return True
    base, heads, opts, _ = parts(name or "")
    return not base and not heads and opts == ["분채"]


NAME_FILL = int(os.environ.get("LLM_NAME_FILL", 2))                        # 빈칸을 LLM이 적은 모르는 이름으로 채우려면 답이 이만큼


def should_rename(now, name, extra, now_rank=0):
    """이미 보낸 품종 now를 (그 뒤 답까지 모아) 다시 고른 name으로 바꿀까(D-SCR-35). extra = pick_shop의 다섯째 값, now_rank = 지금 이름을 고를 때의 extra["rank"]
    (2 = 가게 장부 이름, 1 = 전국 사전 이름, 0 = 모르는 이름). 빈칸은 채운다. 아는 이름을 덜 아는 이름으로 바꾸지 않는다.
    무늬 말은 장부 이름으로만 바꾼다. 같은 급이면 답이 더 많이 나온 쪽으로.
    extra["again"] = 판매자가 보낸 뒤 그 번호와 함께 다시 말한 이름의 답 수(D-RETRO16-10) — 두 번 넘게 다시 말했으면 아는 이름(사전)도 그 이름으로 바꾼다"""
    if not name or norm(name) == norm(now or ""):
        return False
    votes, rank, source = extra.get("votes", 0), extra.get("rank", 0), extra.get("source")
    if not now or bare_name(now):                                          # 빈칸, 또는 파는 꼴·물건 말뿐인 이름("분채", "화분")은 빈칸처럼 채운다
        return votes >= NAME_FILL if source in ("무늬 말", "파는 꼴 말") or (source == "LLM" and rank == 0) else True
    if bare_name(name):
        return False                                                       # 이름·옵션을 파는 꼴·물건 말뿐인 이름으로 바꾸지 않는다
    old, new = split_parts(now), split_parts(name)
    if not old[0]:                                                         # 지금은 무늬 말뿐
        if not new[0] and old[1] and norm(new[1]).startswith(norm(old[1])):
            return votes >= 2                                              # 옵션에 옵션이 더 붙었다(161번 SP → SP 철화)
        had = (extra.get("only") or {}).get(norm(old[1]), 0)
        if not new[0] and votes >= 2 and _unnamed(new[1]) and not _unnamed(old[1]) and 0 < had < votes:
            return True                                                    # 같은 장면에서 옵션뿐("특이종")보다 품종 SP·종자가 더 많이 나왔다(D-DICT-OPT-01, 11-12 방송 220번)
                                                                           # 지금 옵션이 이 답들에 없으면(번호를 다시 쓴 다른 장면) 바꾸지 않는다(11-13 방송 31번)
        return bool(new[0]) and rank == 2 and (votes >= 2 or source == "장부 말")
    if not new[0]:                                                         # 이름 → 무늬 말: 모르는 이름일 때만, 그 옵션이 이미 이름에 들어 있지 않을 때만
        return now_rank == 0 and votes >= 2 and norm(new[1]) not in norm(now)   # 89번 킹레드SP변이 → SP로 줄이지 않는다
    if norm(old[0]) == norm(new[0]):
        return bool(new[1]) and not old[1]                                 # 같은 품종에 무늬 말이 더 붙었다("테라로사" → "테라로사색금")
    if norm(now).startswith(norm(name)):
        return False                                                       # 더 자세한 이름을 그 앞부분으로 줄이지 않는다(65번 레오파드찐실버 → 레오파드, 446번 가르시아산만금 → 가르시아)
    tally = extra.get("tally") or {}
    had = max(tally.get(norm(now), 0), tally.get(norm(old[0]), 0))
    if rank < now_rank:
        return extra.get("again", 0) >= 2 and votes > had                 # 판매자가 번호와 함께 두 번 넘게 다시 말한 이름은 사전 이름도 바꾼다
    if source == "장부 말":
        return now_rank < 2
    if rank > now_rank:
        return votes >= 2 or 0 < had <= votes                              # 지금 이름이 이 답들에 없으면(다른 장면) 한 번 나온 이름으로는 바꾸지 않는다
    return votes >= 2 and votes > had


# ---------- 상품마다 한 번 품종만 묻기 (D-SCR-37, 개선 단계표 B7·C단계의 품종 부분) ----------
# 등록 답은 번호·가격을 찾는 글에 품종을 곁들여 적은 것이라, 같은 받아쓰기를 거듭 읽어도 같은 틀린 말을 적는다.
# 상품이 올라간 뒤 그 상품의 받아쓰기와 가게 장부를 한 번 보여 주고 품종만 묻는다. 답은 등록 답들과 함께 pick_shop이 쓴다(ask=).
ASK_SYS = os.path.join(HERE, "prompts", "name_ask_system.txt")
ASK_SCHEMA = os.path.join(HERE, "prompts", "name_ask.schema.json")
ASK_LEDGER_MAX = 400                                                       # 묻는 글에 싣는 장부 이름 수


def ask_prompt(no, lines, ledger=None, mask=None):
    """품종을 묻는 글. lines = 그 상품의 받아쓰기 [(초, 글)], mask = 손님 이름을 가리는 함수(sw.llm_b4.mask)"""
    mine = re.compile(rf"(?<!\d){int(no)}(?!\d)")
    names = sorted({v for v in ledger.names.values() if split_parts(v)[0]})[:ASK_LEDGER_MAX] if ledger else []
    out = [f"상품 번호: {int(no)}", "가게 장부: " + (", ".join(names) if names else "없음"), ""]
    for k, (sec, x) in enumerate(lines):
        text = mask(x) if mask else x
        out.append(f"{'*' if mine.search(x) else ''}L{k} [{int(sec) // 3600}:{int(sec) % 3600 // 60:02d}:{int(sec) % 60:02d}] {text}")
    return "\n".join(out)


def parse_ask(text):
    """묻기 답 → {"name", "pattern", "confidence"} 또는 None(읽을 수 없는 답)"""
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        d = json.loads(m.group(0)) if m else None
    except ValueError:
        d = None
    if not isinstance(d, dict):
        return None
    clean_ = lambda v: " ".join(str(v or "").split())
    return {"name": clean_(d.get("name")), "pattern": clean_(d.get("pattern")), "confidence": "high" if str(d.get("confidence")).lower() == "high" else "low"}


def ask_name_of(ans, ledger=None, dic=None):
    """묻기 답 → (보낼 이름, 종류). 종류: "장부"·"사전"·"모름"(품종 이름) / "무늬"(이름 없이 무늬·종류 말뿐) / None(쓸 답 없음)"""
    if not ans:
        return "", None
    raw = sp_read("".join(ans.get("pattern", "").split()))
    pat = split_parts(raw)[1] if raw else ""
    if not pat and raw.upper() == "SP":
        pat = "SP"
    name = ans.get("name") or ""
    if name and not not_a_name(tidy(name) or name):
        fixed, tail, _, _, in_ledger, in_dic = shop_name(name, ledger, dic)
        if fixed:
            return join_parts(fixed, pat or tail), ("장부" if in_ledger else "사전" if in_dic else "모름")
        pat = pat or tail
    if pat and pat != "금":                                                 # "금"만으로는 이름 없는 상품이라고 하지 않는다
        return ((ledger.habits.get(pat) if ledger is not None else None) or join_parts("", pat)), "무늬"
    return "", None


def use_ask(now, kind, high, now_rank=0):
    """지금 이름 now를 묻기 답으로 바꿀까(D-SCR-37). kind = ask_name_of의 종류, high = 확실한 답인가, now_rank = 지금 이름의 급(2 장부·1 사전·0 모름)
    두 방송(11-12·11-13) 상품마다 물어 본 결과로 정했다:
      - "이름 없이 무늬 말로만 판 상품"이라는 확실한 답은 쓴다(지금 이름이 모르는 이름·사전 이름·장부 이름인 79건: 지금 이름 19건, 답 57건이 맞았다)
      - 빈칸은 답으로 채운다. 모르는 이름은 답이 장부·사전 이름일 때 바꾼다
      - 이름과 이름이 다를 때, 지금이 무늬 말일 때는 지금 것을 둔다(등록 답을 여럿 모은 쪽이 더 맞았다)"""
    if kind is None:
        return False
    if not now:
        return high or kind == "무늬"
    if not split_parts(now)[0]:
        return False
    if kind == "무늬":
        return high
    return high and now_rank == 0 and kind in ("장부", "사전")
