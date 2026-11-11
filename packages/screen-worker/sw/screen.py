# 화면 1초 1장 → 번호 후보 → 화면 구간 (scratchpad num/ocr_dir.py + fuse2.py의 이미지 규칙을 실시간용으로 옮김, 숫자 그대로)
#  - 읽기: Apple Vision OCR 두 번(전체 화면, 가운데 8~88%를 2배 키운 화면). 숫자가 든 글자만 남긴다.
#  - 번호: "123", "123.", "123번" 모양만, 확신도 0.5 이상.
#  - 배경 숫자: 같은 번호가 같은 자리(8% 칸)에 100번 넘게, 20분 넘게 보이면 배경(전화번호·선반 표 등)으로 보고 뺀다.
#  - 대표 번호: 남은 번호 중 글자가 가장 큰 것. 최근 5초 중 2번 이상이면 현재 번호, 12초 동안 아무 번호도 없으면 모름.
import collections
import re

NUM = re.compile(r"^(\d{1,3})[.번]?$")
STABLE, WIN, EXPIRE = 2, 5, 12
STATIC_N, STATIC_SPAN = 100, 1200
CO_SIZE, CO_MIN = 0.6, 5   # 같이 보인 번호표: 대표 글자 크기의 60% 이상, 5번 넘게 읽힘


def ocr_frame(path):
    """한 장 → [(번호, x, y, w, h)] (위쪽 원점, 0~1). 다른 프로세스에서 부른다"""
    from ocrmac import ocrmac
    from PIL import Image

    img = Image.open(path)
    img.load()
    W, H = img.size
    out = []
    # 전체 화면
    for txt, conf, (x, y, w, h) in ocrmac.OCR(img, recognition_level="accurate", language_preference=["ko-KR", "en-US"]).recognize():
        m = NUM.match(txt.strip())
        if m and conf >= 0.5:
            out.append((int(m.group(1)), round(x, 3), round(1 - (y + h), 3), round(w, 3), round(h, 3)))
    # 가운데를 잘라 2배: 작은 번호표 글자를 키운다
    top, bot = int(H * 0.08), int(H * 0.88)
    crop = img.crop((0, top, W, bot)).resize((W * 2, (bot - top) * 2), Image.LANCZOS)
    oy, sh = top / H, (bot - top) / H
    for txt, conf, (x, y, w, h) in ocrmac.OCR(crop, recognition_level="accurate", language_preference=["ko-KR", "en-US"]).recognize():
        m = NUM.match(txt.strip())
        if m and conf >= 0.5:
            out.append((int(m.group(1)), round(x, 3), round(oy + (1 - (y + h)) * sh, 3), round(w, 3), round(h * sh, 3)))
    return out


# 글자 읽기가 자주 헷갈리는 숫자(번호표 글씨체의 1은 위에 꺾인 획이 있어 흐리면 7로 읽힌다).
# 같은 무리로 묶어 화면 구간을 쪼개지 않고, 어느 쪽인지는 판정 단계에서 판매자 말로 정한다.
CONFUSE = str.maketrans("7", "1")


def look(n):
    """헷갈리는 숫자를 하나로 맞춘 모양: 17 → 11, 70 → 10"""
    return str(n).translate(CONFUSE)


def _cell(x, y):
    return (round(x / 0.08), round(y / 0.08))


class Screen:
    """초마다 읽은 번호를 쌓고, 부를 때마다 처음부터 다시 계산한다(지난 시험 결과와 같은 규칙을 그대로 쓰려고)"""

    def __init__(self):
        self.tokens = {}  # 초 → [(번호, x, y, w, h)]

    def add(self, sec, toks):
        self.tokens[sec] = toks

    def build(self):
        """→ (화면 구간 목록, 초별 후보 번호, 초별 대표 번호)"""
        frames = sorted(self.tokens)
        occ = collections.defaultdict(list)
        for i in frames:
            for z in self.tokens[i]:
                occ[(z[0], _cell(z[1], z[2]))].append(i)
        static = {k for k, v in occ.items() if len(v) >= STATIC_N and max(v) - min(v) >= STATIC_SPAN}
        cands = {i: [z for z in self.tokens[i] if (z[0], _cell(z[1], z[2])) not in static] for i in frames}
        mains = {i: (max(c, key=lambda z: z[4])[0] if c else None) for i, c in cands.items()}
        state, cur, last_seen = {}, None, -999
        for i in frames:
            if mains[i] is not None:
                last_seen = i
            win = [x for x in (mains.get(j) for j in range(i - WIN + 1, i + 1)) if x is not None]
            cnt = collections.Counter(look(x) for x in win)
            if cnt:
                key, k = cnt.most_common(1)[0]
                if k >= STABLE:
                    # 같은 모양 무리 안에서는 지금까지 이 구간에서 더 많이 읽힌 번호를 대표로(1·7이 번갈아 읽혀도 구간을 쪼개지 않음)
                    same = collections.Counter(x for x in win if look(x) == key)
                    if cur is None or look(cur) != key:
                        cur = same.most_common(1)[0][0]
            if i - last_seen > EXPIRE:
                cur = None
            state[i] = cur
        segs = []
        for i in frames:
            s = state[i]
            if s is None:
                continue
            if segs and look(segs[-1]["img"]) == look(s) and i - segs[-1]["e"] <= EXPIRE:
                segs[-1]["e"] = i
            else:
                segs.append({"img": s, "s": i, "e": i})
        # 같이 보인 번호표(묶음 판매: 한 화면에 114·119): 대표 번호표와 글자 크기가 비슷하고(60% 이상) 5번 넘게 읽혔으며
        # 그때 다른 상품 구간이 열려 있으면, 대표가 아니어도 따로 구간을 만든다. 뒤쪽 선반의 작은 번호표는 크기 조건에서 빠진다.
        pres = collections.defaultdict(list)
        for i in frames:
            c = cands[i]
            if not c:
                continue
            hmax = max(z[4] for z in c)
            for n in {z[0] for z in c if z[4] >= CO_SIZE * hmax}:
                pres[n].append(i)
        extra = []
        for n, secs in pres.items():
            runs = []
            for i in secs:
                if runs and i - runs[-1][1] <= EXPIRE:
                    runs[-1][1] = i
                    runs[-1][2] += 1
                else:
                    runs.append([i, i, 1])
            for s, e, k in runs:
                if k < CO_MIN:
                    continue
                if any(look(g["img"]) == look(n) and g["s"] - EXPIRE <= e and s <= g["e"] + EXPIRE for g in segs):
                    continue  # 이미 그 번호의 구간이 있음
                if not any(g["s"] <= e and s <= g["e"] for g in segs):
                    continue  # 같이 보인 상품 구간이 없으면 배경으로 봄
                extra.append({"img": n, "s": s, "e": e, "co": True})
        segs = sorted(segs + extra, key=lambda g: g["s"])
        for g in segs:
            g["reads"] = collections.Counter(z[0] for i in range(g["s"], g["e"] + 1) for z in cands.get(i, []))
            # 구간 대표 = 같은 모양 무리 중 가장 많이 읽힌 번호
            fam = {n: c for n, c in g["reads"].items() if look(n) == look(g["img"])}
            if fam:
                g["img"] = max(fam, key=fam.get)
            # 번호표 크기(화면 높이 대비 글자 높이, 가운데값): 판매 중인 번호표는 크고(가까이 듦), 선반·옆 화분 번호표는 작다
            hs = sorted(z[4] for i in range(g["s"], g["e"] + 1) for z in cands.get(i, []) if z[0] == g["img"])
            g["h"] = hs[len(hs) // 2] if hs else 0.0
        cand_sec = {i: sorted({z[0] for z in c}) for i, c in cands.items() if c}
        return segs, cand_sec, mains
