# 화면 구간 + 음성 "N번" → 자동확정/확인요청 (data/image_for_stt_test/fuse_image_stt.py의 판정 부분을 함수로 옮김, 규칙·숫자 그대로)
# 순수 함수: 시계·파일을 읽지 않는다. 같은 입력이면 언제나 같은 결과.
import collections
import re

# ---------- 받아쓴 글에서 "N번" 뽑기 ----------
D = {"영": 0, "공": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "륙": 6, "칠": 7, "팔": 8, "구": 9}
SMALL = {"십": 10, "백": 100, "천": 1000}


def to_int(s):
    s = s.replace(",", "").replace(" ", "")
    if re.fullmatch(r"\d+", s):
        return int(s)
    block = 0
    cur = None
    for c in s:
        if c.isdigit():
            cur = (cur or 0) * 10 + int(c)
        elif c in D:
            cur = D[c]
        elif c in SMALL:
            block += (cur if cur is not None else 1) * SMALL[c]
            cur = None
        else:
            return None
    return block + (cur or 0)


def numbers_with_beon(text):
    """'148번', '백사십팔번', '사십 사번' → [148, 148, 44]"""
    text = re.sub(r"([일이삼사오육칠팔구십백]+) ([일이삼사오육칠팔구십백]+ ?번)", r"\1\2", text)
    out = []
    for m in re.finditer(r"([0-9일이삼사오육륙칠팔구십백]+)\s*번", text):
        raw = m.group(1)
        if re.fullmatch(r"[일이삼사오육륙칠팔구]", raw) and not raw.isdigit():  # '이번','일번' 같은 애매한 한 글자 제외
            continue
        v = to_int(raw)
        if v is not None and 0 < v < 1000:
            out.append(v)
    return out


def numbers_priced(text):
    """'N번' 뒤에(다음 다른 번호 전까지) 같은 문장에서 가격을 말한 번호: "요고 46번으로 46번 4만원" → [46], "138번 13만원 옥나비" → [138].
    판매자가 번호와 가격을 같이 불렀으면 화면에 번호표가 안 잡혀도 확정할 근거(decide의 priced).
    시험(2026-11-10, 음성만 확인요청): 보스·럭셔리·다육홀릭 맞음 2·틀림 0, 회귀 5방송 맞음 18·정답에 없음 13(읽어 보니 거의 다 관리자가 안 올린 실제 판매)"""
    from .price import prices_in
    text = re.sub(r"([일이삼사오육칠팔구십백]+) ([일이삼사오육칠팔구십백]+ ?번)", r"\1\2", text)
    ms = [(m, numbers_with_beon(m.group(0))) for m in re.finditer(r"([0-9일이삼사오육륙칠팔구십백]+)\s*번", text)]
    out = []
    for i, (m, v) in enumerate(ms):
        if not v or v[0] in out:
            continue
        nxt = next((q for q, w in ms[i + 1:] if w and w[0] != v[0]), None)
        seg = text[m.end():nxt.start() if nxt else len(text)]
        # "코코맘님 115번 고맙습니다. 엘린 4천원": 손님에게 인사한 뒤 말한 가격은 다음 상품 것
        cut = re.search(r"감사|고맙|고마워", seg)
        if prices_in(seg[:cut.start()] if cut else seg):
            out.append(v[0])
    return out


def numbers_loose(text):
    """받아쓰기가 '번'을 '분'·'원'으로 잘못 적은 것("25분 20까지", "189원")까지 번호 후보로: 숫자로 적힌 1~999 + 분/원.
    '두 분', '5분만'과 섞이므로 화면에 같은 번호가 보일 때만 쓴다(decide의 loose)"""
    out = []
    for m in re.finditer(r"(?<![\d.,])(\d{1,3})\s*(?:분|원)(?!\s*(?:들|께|씩))", text):
        v = int(m.group(1))
        if 0 < v < 1000:
            out.append(v)
    # '번' 없이 번호 바로 뒤에 가격을 붙여 말하는 판매자("자 243 5천원", "304 만원"): 숫자 2~3자리 + 바로 가격
    from .price import prices_in
    # ("30만원"처럼 붙여 쓴 만은 가격이라 빼고, "304 만원"처럼 띄어 쓴 만은 번호 + 가격으로 본다)
    for m in re.finditer(r"(?<![\d.,])(\d{2,3})(?![\d,.]|만|\s*(?:번|분|원|천|cm|센|개|명|시|초|일|살|년|%|미리|리터|cc|ml|L))", text):
        rest = text[m.end():m.end() + 12]
        if re.match(r"\s+(?:\d|만|천|[일이삼사오육칠팔구십])", rest) and prices_in(rest):
            out.append(int(m.group(1)))
    return out + [v for v in numbers_bare(text) if v not in out]


# 번호만 말하는 판매자("자 237", "302", "309만원", "273 레옹색금 만원")와 받아쓰기가 띄어 적은 번호("자 2 3 5 요거 만원")
_UNIT = r"(?:번|분|원|천|cm|센|개|명|시|초|일|살|년|%|미리|리터|cc|ml|L|키로|kg|대|등|위|층|호|장|도|프로|주|개월|달|박스|판|송이|촉|포기|인치|미터|m)"


_KD = {"공": 0, "영": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "륙": 6, "칠": 7, "팔": 8, "구": 9}
_DG = r"[0-9공영일이삼사오육륙칠팔구]"


def loose_at(t0, t1, text):
    """'번' 없이 말한 번호의 시각: 받아쓰기 한 줄의 시작 초 + 줄이 길면(5초 넘게) 끝 초도.
    긴 문장 끝에서 말한 번호("… 자 이거 2,3일 구독을 …", 보스다육 231)가 시작 초 하나로만 찍혀 화면 구간과 어긋나지 않게"""
    ns = numbers_loose(text)
    return [(t0, v) for v in ns] + ([(t1, v) for v in ns] if t1 - t0 > 5 else [])


def numbers_bare(text):
    """'번'도 가격도 없이 말한 2~3자리 숫자 → 번호 후보. 화면에 같은 번호가 보일 때만 쓴다(decide의 loose).
    "30만원"처럼 두 자리에 붙은 만은 가격이라 빼고, "309만원"처럼 세 자리에 붙은 만은 번호 + 만원으로 본다"""
    out = []
    # 쉼표로 늘어놓은 번호("43,55, 18,000원", "248, 157")는 띄어 쓴 것으로 본다. 천 단위 쉼표(18,000 — 쉼표 뒤 띄어 쓰지 않은 세 자리)는 그대로
    listed = re.sub(r"(?<![\d.,])(\d{2,3}),(?=\s|\d{2}(?!\d))", r"\1 ", text)
    listed = re.sub(r"(?<![\d.,])(\d{2,3}),(?=\s|\d{2}(?!\d))", r"\1 ", listed)
    for m in re.finditer(rf"(?<![\d.,:~])(\d{{2,3}})(?![\d,.:]|\s*{_UNIT})", listed):
        v = m.group(1)
        if len(v) == 2 and re.match(r"\s*만", listed[m.end():]):
            continue
        out.append(int(v))
    # 한 자리씩 끊어 적힌 세 자리: "2 3 5", "3.2.6.", "2,3일"(이·삼·일을 숫자 둘 + 글자 하나로 적음 = 231). 아라비아 숫자가 하나는 있어야 한다
    for m in re.finditer(rf"(?<![\d.,가-힣])({_DG})\s*[,. ]?\s*({_DG})\s*[,. ]?\s*({_DG})(?!\d|\s*[,.]?\s*\d)", text):
        g = m.groups()
        if not any(x.isdigit() for x in g) or all(x.isdigit() for x in g) and not re.search(r"[,. ]", m.group(0)):
            continue   # 한글 숫자만 / 붙어 있는 세 자리(위에서 이미 읽음)
        v = int("".join(x if x.isdigit() else str(_KD[x]) for x in g))
        if v >= 100:
            out.append(v)
    return out


# ---------- 판정 ----------
VPRE, VPOST = 20, 10


def _d1(a, b):
    return len(str(a)) == len(str(b)) and sum(x != y for x, y in zip(str(a), str(b))) == 1


def _confuse(a, b):
    """1↔7만 다른 번호(번호표 글씨체 때문에 자주 헷갈림)"""
    a, b = str(a), str(b)
    return a != b and len(a) == len(b) and all(x == y or {x, y} == {"1", "7"} for x, y in zip(a, b))


def decide(segs, cand_sec, voice, min_reads=5, loose=(), strong=(10, 10, 0.0), share=0.6, brief_h=0.0, chat=(), neighbor_aware=True, strong_big=(10, 10), vpre=VPRE, vpost=VPOST, priced=(), co_said=(10, 0.25)):
    """segs: [{"img","s","e","reads":Counter}] 화면 구간, cand_sec: {초: [화면 번호들]}, voice: [(초, 번호)] 시간순
    strong: (초, 읽힘 수, 최소 글자 높이) — 말 없이 화면만으로 확정하는 기준
    share: 판매 중인 번호표만큼 크게 보인 번호표를 화면만으로 확정할 때 필요한 비율(작은 번호표는 0.8)
    brief_h: 참이면 판매 중인 번호표만큼 크게 보인 번호표는 잠깐 보였어도 거르지 않고 확인요청으로(손에 들고 보여 준 화분일 수 있음)
    chat: [(초, 번호)] 손님이 찜하려고 친 번호 — 화면에 그 번호가 보였을 때만 근거로 쓴다(구간 시작 10초 전~끝나고 60초)
    vpre, vpost: 화면 구간 앞뒤로 판매자 말을 볼 여유(초). 말 시각이 조각 시작이면 넉넉히(20/10), 단어 단위 시각이면 좁힐 수 있다
    priced: [(초, 번호)] 'N번' 뒤에 같은 문장에서 가격을 말한 번호(numbers_priced) — 화면에 번호표가 안 잡혀도 확정
    loose: [(초, 번호)] '25분'처럼 번호일 수도 있는 말 — 화면과 맞춰 볼 때만 쓴다(말만으로 확정하거나 다른 번호 언급으로 보지 않음)
    min_reads: 화면에 이만큼도 안 읽히고 판매자도 말하지 않은 번호는 확인요청을 내지 않는다(잠깐 스친 옆 화분 번호표)
    → 상품 목록 [{"no","img","s","e","auto","why","reads","vs"}] 시간순"""
    lo = 1                                   # 한 자리 번호도 다른 번호와 똑같이 다룬다(사용자 지시 2026-11-08: 한 자리 제한 없앰)
    # '번' 없이 들은 두 자리 숫자("50 주고 산 거")는 이 방송에서 판매자가 두 자리 번호를 'N번'으로 말한 적이 있을 때만 번호 후보로
    if voice and not any(10 <= v < 100 for _, v in voice):
        loose = [(t, v) for t, v in loose if v >= 100]
    segs = [dict(g, no=g["img"]) for g in segs]
    # 이 방송에서 "판매 중인 번호표"의 보통 크기: 판매자가 말한 번호와 화면 번호가 맞은 구간들의 글자 높이 가운데값.
    # 카메라 거리가 판매자마다 달라서 절대 크기 대신 이 값에 견줘 "크게 보인 번호표"를 가린다
    hs = sorted(g.get("h", 0) for g in segs if g.get("h") and any(v == g["img"] for t, v in voice if g["s"] - vpre <= t <= g["e"] + vpost))
    ref_h = hs[len(hs) // 2] if hs else 0.0
    big = lambda g: ref_h > 0 and g.get("h", 0) >= 0.8 * ref_h
    for g in segs:
        vs = collections.Counter(v for t, v in voice if g["s"] - vpre <= t <= g["e"] + vpost)
        vs_loose = {v for t, v in loose if g["s"] - vpre <= t <= g["e"] + vpost}
        g["vs"] = vs
        if g["img"] in vs:
            g["auto"], g["why"] = True, "화면=음성 일치"
            continue
        if g["img"] in vs_loose:
            g["vs"] = vs + collections.Counter({g["img"]: 1})
            g["auto"], g["why"] = True, f"화면=음성 일치('번' 없이 말한 {g['img']} — 숫자만·띄어 쓴 숫자·'분/원'으로 적힌 것)"
            continue
        inside = [v for t, v in voice if g["s"] - vpre <= t <= g["e"] + 3]
        # 판매자가 말한 번호가 그 구간 화면에서도 2번 이상 읽혔으면 말한 번호를 따른다(글자 읽기가 110을 230으로 읽는 등 여러 자리가 틀려도).
        # 1↔7만 다르면 화면에서 덜 읽혀도 따른다.
        # 단, 한 번만 들린 번호가 화면에서 겨우 몇 번 읽힌 정도면(대표 번호의 25% 미만) 조각·잘못 들은 것일 수 있어 따르지 않는다
        said = collections.Counter(inside)
        alt = [n for n in said if n >= lo and (_confuse(n, g["img"]) or (g["reads"].get(n, 0) >= 2 and
               (said[n] >= 2 or g["reads"].get(n, 0) >= 0.25 * g["reads"].get(g["img"], 0))))]
        if alt:
            g["no"] = max(alt, key=lambda n: g["reads"][n])
            g["auto"], g["why"] = True, f"화면 {g['img']}→음성 {g['no']} 보정(말한 번호가 화면에도 보임)"
            continue
        # 손님이 친 번호: 판매자가 번호를 말하지 않아도 손님은 찜하려고 번호를 친다. 화면 번호와 같거나, 화면에서도 읽힌 번호면 따른다
        typed = collections.Counter(n for t, n in chat if g["s"] - 10 <= t <= g["e"] + 60)
        if g["img"] in typed:
            g["auto"], g["why"] = True, "화면=손님 댓글 번호"
            continue
        calt = [n for n in typed if n >= lo and (_confuse(n, g["img"]) or (g["reads"].get(n, 0) >= 2 and
                (typed[n] >= 2 or g["reads"].get(n, 0) >= 0.25 * g["reads"].get(g["img"], 0))))]
        if calt:
            g["no"] = max(calt, key=lambda n: (typed[n], g["reads"].get(n, 0)))
            g["auto"], g["why"] = True, f"화면 {g['img']}→손님 댓글 {g['no']} (손님 번호가 화면에도 보임)"
            continue
        g["auto"], g["why"] = False, "화면만 (음성 확인 안 됨)"
        # 화면만 아주 강함: 10초 이상, 10회 이상, 구간 읽힘의 대부분이 같은 번호, 그동안 판매자가 (이웃 상품이 아닌) 다른 번호를 말하지 않음.
        # 이웃 상품 = 이 구간 앞뒤 30초 안에 자기 화면 구간이 있는 번호. 앞 상품 번호를 말하거나 앞 상품 번호표가 구석에 남은 건 판매 흐름상 당연해서 반대 근거로 보지 않는다
        # 단, 판매 중인 번호표만큼 크게 보인 번호표에만 적용(작은 번호표가 여럿 보이는 쟁반·선반에서는 쓰지 않음 — 회귀 시험에서 엉뚱한 확정이 늘었음)
        if neighbor_aware and big(g):
            nb = {h["img"] for h in segs if h is not g and h["img"] != g["img"] and h["s"] - 30 <= g["e"] and g["s"] <= h["e"] + 30}
        else:
            nb = set()
        tot = sum(c for n, c in g["reads"].items() if n not in nb)
        top = g["reads"].get(g["img"], 0)
        other = [v for t, v in voice if g["s"] - 10 <= t <= g["e"] + 5 and v != g["img"] and v >= lo and v not in nb]
        secs, reads, min_h = strong
        if big(g):
            secs, reads = strong_big   # 판매 중인 번호표만큼 크게 보이면 더 짧아도 화면만으로 확정
        # 판매 중인 번호표만큼 크게 보였으면 같이 보여 준 다른 화분 번호가 섞여도(share) 확정, 작으면 80% 이상 같은 번호여야
        need = share if big(g) else 0.8
        if g["img"] >= lo and g["e"] - g["s"] + 1 >= secs and top >= reads and top >= need * tot and not other and g.get("h", 1.0) >= min_h:
            g["auto"], g["why"] = True, f"화면만이지만 아주 강함({secs}초 이상 같은 번호)"
    # 같이 들고 판 번호(사용자 지적 2026-11-10, 다육홀릭 284: 273과 같이 보여 주며 "284, 273."): 확정된 구간 안에서
    # 대표가 아닌 번호가 많이 읽혔고(co_said = (최소 읽힘, 대표 대비 비율)) 판매자가 그 구간에 그 번호를 말했으면 같이 확정.
    # 화면에 많이 보였어도 말하지 않았거나, 말했어도 잠깐 보였으면 확정하지 않는다(잠깐 스친 번호표 규칙은 그대로)
    co_items = []
    if co_said[0]:
        for g in segs:
            if not g["auto"]:
                continue
            said_here = {v for t, v in list(voice) + list(loose) if g["s"] - vpre <= t <= g["e"] + vpost}
            for n, c in g["reads"].items():
                if n != g["no"] and n >= lo and c >= co_said[0] and c >= co_said[1] * g["reads"].get(g["img"], 0) and n in said_here:
                    co_items.append({"no": n, "img": n, "s": g["s"], "e": g["e"], "reads": collections.Counter({n: c}),
                                     "vs": collections.Counter({n: 1}), "auto": True, "why": f"{g['no']}번과 같이 보인 번호표 + 판매자가 말함"})
    vonly = []
    for t, v in voice:
        # 같은 번호 화면 구간이 이 말을 근거로 쓰는 경우만 건너뛴다(구간이 말을 보는 범위와 같게).
        # 예전 ±60초: 말은 구간 범위 밖이라 구간 근거도 못 되고 음성 쪽에서도 버려져 사라졌다(보스다육 206번)
        if any(g["no"] == v and g["s"] - vpre <= t <= g["e"] + vpost for g in segs):
            continue
        if vonly and vonly[-1]["no"] == v and t - vonly[-1]["e"] <= 120:
            vonly[-1]["e"] = t
            continue
        vonly.append({"no": v, "img": None, "s": t, "e": t, "reads": collections.Counter(), "vs": collections.Counter({v: 1}),
                      "auto": False, "why": "음성만 (화면 번호 없음)"})
    for g in vonly:
        # 음성 번호가 그 시각 앞뒤 20초 화면 후보(보인 번호 전부)에 2번 이상 있으면 자동확정
        c = collections.Counter(n for i in range(int(g["s"]) - 20, int(g["e"]) + 21) for n in cand_sec.get(i, []))
        if g["no"] >= lo and c.get(g["no"], 0) >= 2:
            g["auto"], g["why"], g["reads"] = True, "음성 번호가 화면 후보에 있음", c
            continue
        w = collections.Counter(v for t, v in voice if g["s"] - 30 <= t <= g["e"] + 30)
        others = sum(c for n, c in w.items() if n != g["no"])
        if g["no"] >= lo and w[g["no"]] >= 3 and w[g["no"]] >= 3 * others:
            g["auto"], g["why"] = True, "음성만이지만 강함(3회 이상)"
            continue
        # 판매자가 번호와 가격을 한 문장에 같이 불렀으면("46번 4만원") 번호표가 카메라에 안 잡혀도 확정(다육홀릭 46·56).
        # 한 자리 번호는 빼다("2번 3번 3만원" — 한 상품을 손님 셋에게 나눠 줄 때 순서, 경성 11/2 301번)
        if g["no"] >= 10 and any(v == g["no"] and g["s"] - 5 <= t <= g["e"] + 5 for t, v in priced):
            g["auto"], g["why"] = True, "음성만이지만 번호+가격을 한 문장에(화면에 번호표 안 잡힘)"
    merged = []
    for g in sorted(segs + vonly + co_items, key=lambda g: g["s"]):
        prev = next((h for h in reversed(merged[-6:]) if h["no"] == g["no"] and g["s"] - h["e"] <= 120), None)
        if prev:
            prev["e"] = max(prev["e"], g["e"])
            prev["reads"] = prev["reads"] + g["reads"]
            prev["vs"] = prev["vs"] + g["vs"]
            if g["auto"] and not prev["auto"]:
                # 앞 조각은 확정 안 된 배경(옆에 놓여 잠깐 보인 번호표)일 수 있다 — 상품 시작은 확정된 조각(실제 판매)부터
                prev["auto"], prev["why"], prev["s"], prev["img"] = True, g["why"], g["s"], g["img"]
        else:
            merged.append(dict(g))
    # 합친 뒤 점검: 자기 번호의 음성 근거 없이 확정된 구간에 판매자가 다른 번호를 말했으면 확인요청으로 되돌림
    for g in merged:
        if g["auto"] and g["img"] is not None and not any(v == g["no"] for t, v in list(voice) + list(loose) if g["s"] - vpre <= t <= g["e"] + vpost) \
                and not any(n == g["no"] for t, n in chat if g["s"] - 10 <= t <= g["e"] + 60):
            # 크게 보인 번호표면 이웃 상품(앞뒤 30초 안에 자기 구간이 있는 번호)을 말한 건 반대 근거로 보지 않는다(화면만 확정 규칙과 같은 기준)
            nb = {h["no"] for h in merged if h is not g and h["s"] - 30 <= g["e"] and g["s"] <= h["e"] + 30} if neighbor_aware and big(g) else set()
            if any(v != g["no"] and v >= lo and v not in nb for t, v in voice if g["s"] - 10 <= t <= g["e"] + 5):
                g["auto"], g["why"] = False, "화면만, 그 사이 다른 번호 언급"
    # 한쪽 근거만으로 확정한 것이 앞뒤 60초 안에 확정된 다른 번호의 조각·앞자리만 다른 번호면 확정하지 않는다
    #  - 번호+가격 말만: 받아쓰기가 앞자리를 빠뜨리거나 더함("124번 2만원"인데 화면은 224, "177번 20만원"인데 77) — 럭셔리 11/4 124·148·184·5, 경성 11/2 177·16
    #  - 화면만 아주 강함: 작은 글씨를 앞자리만 잘못 읽음 — 다육홀릭 11/3 464(판매자는 "164, 185", 화면 대표도 164)
    for g in merged:
        if g["auto"] and (g["why"].startswith("음성만이지만 번호+가격") or g["why"].startswith("화면만이지만")):
            for h in merged:
                if h is g or not h["auto"] or h["img"] is None or h["s"] - 60 > g["e"] or g["s"] > h["e"] + 60:
                    continue
                a, b = str(g["no"]), str(h["no"])
                if g["why"].startswith("화면만이지만"):
                    # 글자 읽기 실수: 앞자리 빠짐·앞자리만 다름. 1↔7만 다른 번호(181·187처럼 나란히 파는 이웃 상품)로는 되돌리지 않는다(회귀 수정 177·187)
                    bad = (len(a) < len(b) and b.endswith(a)) or (len(a) == len(b) == 3 and a[0] != b[0] and a[1:] == b[1:])
                else:
                    # 받아쓰기 실수: 앞자리 빠짐(224→124)·앞자리 더함(77→177)·앞자리만 다름(66→"6,16", 274→214는 화면 확인 규칙 쪽).
                    # 1↔7 혼동은 번호표 글씨체 탓이라 말에는 쓰지 않는다(경성 11/2 57번이 51번 오독으로 버려졌음)
                    bad = (len(a) != len(b) and (b.endswith(a) or a.endswith(b))) or (len(a) == len(b) >= 2 and a[0] != b[0] and a[1:] == b[1:])
                if bad:
                    g["auto"], g["noise"], g["why"] = False, True, f"{h['no']}번의 오독으로 봄(한쪽 근거만으로 확정하려던 것)"
                    break
    # 같이 보인 번호표(대표가 아닌 옆 화분): 판매자가 그 번호를 말해 확정된 것만 남기고, 말하지 않았으면 묻지 않는다
    for g in merged:
        if g.get("co") and not g["auto"]:
            g["noise"], g["why"] = True, "같이 보인 번호표(판매자가 말하지 않음)"
    # 잠깐 스친 번호표: 화면에 min_reads번도 안 읽히고 판매자가 말하지 않은 화면만 구간은 묻지 않는다
    for g in merged:
        if not g["auto"] and g["img"] is not None and not g["vs"].get(g["no"]) and g["reads"].get(g["no"], 0) < min_reads \
                and not (brief_h and big(g)):
            g["noise"], g["why"] = True, "잠깐 스친 번호표"
    # 쓸데없는 확인요청 거르기: 앞뒤 60초 안에 확정된 번호의 조각(앞자리 빠짐: 295→95·5)이거나 맨 앞자리만 다르면(295→195)
    # 받아쓰기·글자 읽기 실수로 보고 확인요청을 내지 않는다. 끝자리만 다른 번호(381·382)는 이웃 상품일 수 있어 거르지 않는다.
    # 확정은 건드리지 않고, 거른 것도 판정 목록에는 남는다(noise).
    for g in merged:
        if g["auto"]:
            continue
        for h in merged:
            if not h["auto"] or h is g or h["s"] - 60 > g["e"] or g["s"] > h["e"] + 60:
                continue
            a, b = str(g["no"]), str(h["no"])
            if (len(a) < len(b) and b.endswith(a)) or (len(a) == len(b) == 3 and a[0] != b[0] and a[1:] == b[1:]) or _confuse(a, b):
                g["noise"], g["why"] = True, f"{h['no']}번의 오독으로 봄"
                break
    # 이미 앞에서 등록된 번호는 다시 묻지 않는다: 한 방송에서 번호는 하나뿐이라(같은 번호 재등록은 앱이 무시) 물어도 바뀌는 게 없고,
    # 대부분 지난 상품 번호표가 다시 비친 것(회귀 5개 방송: 확인요청 279개 중 92개, 손해 없음)
    for g in merged:
        if not g["auto"] and not g.get("noise") and any(h["auto"] and h["no"] == g["no"] and h["s"] < g["s"] for h in merged):
            g["noise"], g["why"] = True, "이미 등록된 번호"
    return merged


def voice_from_words(rec):
    """단어 단위 받아쓰기 한 줄 {text, words:[[단어, 시작, 끝]]} → [(그 번호를 말한 단어의 시작 초, 번호)], 같은 식으로 '분/원' 후보도"""
    words = rec.get("words") or []
    if not words:
        return [(rec["start_sec"], v) for v in numbers_with_beon(rec["text"])], [(rec["start_sec"], v) for v in numbers_loose(rec["text"])]
    text, starts = "", []
    for w, t0, _ in words:
        if text:
            text += " "
        starts.append((len(text), t0))
        text += w

    def at(pos):
        t = words[0][1]
        for off, t0 in starts:
            if off <= pos:
                t = t0
        return t

    # "백 사십팔번"처럼 띄어 받아쓴 한글 숫자를 붙인 글에서 찾는다(붙이며 줄어든 글자 수만큼 시각이 한 단어쯤 앞설 수 있음 — 무시할 만함)
    merged = re.sub(r"([일이삼사오육칠팔구십백]+) ([일이삼사오육칠팔구십백]+ ?번)", r"\1\2", text)
    voice = [(at(m.start()), v) for m in re.finditer(r"([0-9일이삼사오육륙칠팔구십백]+)\s*번", merged) for v in numbers_with_beon(m.group(0))]
    loose = [(at(m.start()), int(m.group(1))) for m in re.finditer(r"(?<![\d.,])(\d{1,3})\s*(?:분|원)(?!\s*(?:들|께|씩))", text) if 0 < int(m.group(1)) < 1000]
    return voice, loose
