# 번호표 찾기(시제품): 장면 한 장에서 "흰 딱지 위의 굵은 검은 숫자" 후보를 색·모양만으로 찾는다(모델 없음).
#  - 흰 영역부터 찾는 방법은 버렸다: 흰 자갈·밝은 손가락과 딱지가 한 덩어리로 붙는다(어제 방송 장면의 26%가 "흰색").
#  - 그래서 글자부터 찾는다: 어두운 덩어리 중 숫자만 한 크기·모양이고 둘레가 희고 옅은 색인 것 → 옆으로 나란한 것끼리 묶음(숫자 1~4개)
#    → 묶음의 기울기를 재서 펴고, 여백을 붙여 잘라(crop_tag) 글자 읽기 모델에 넘긴다.
#  - 화면 위 가게 이름·전화번호 띠는 글자가 길게 이어져 묶음이 너무 길어서 빠진다(남는 조각은 추적기가 "배경"으로 거른다).
#  - 추적·다수결은 sw/tagtrack.py. 필요: numpy, opencv(cv2) — 화면 일꾼 설치 목록에 이미 있다.
import math
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class FindParams:
    dark_rel: float = 0.68     # 글자: 둘레의 가장 밝은 값(종이)의 이 비율보다 어두운 점 — 흐리거나 옅게 찍힌 숫자도 잡으려고 상대값으로
    bg_px: int = 68            # 둘레를 보는 너비(화소, 1280 기준). 가까이 찍은 숫자의 획보다 넓어야 한다
    bg_min: int = 120          # 둘레가 이보다 어두우면 글자 후보로 보지 않는다
    ink_rel: float = 0.56      # 글자 덩어리의 평균 밝기는 둘레 밝기의 이 비율보다 어둡다(자갈 그림자는 회색)
    max_candidates: int = 120  # 글자 후보가 너무 많으면 큰 것부터 이만큼만 본다
    white_min: int = 140       # 딱지 바탕: 세 색 중 가장 어두운 값이 이보다 밝고
    white_spread: int = 70     # 세 색의 차이가 이보다 작다(노란 이름표·분홍 잎·살색 제외)
    h_min: float = 0.015       # 글자 높이(화면 높이 대비)
    h_max: float = 0.42
    char_ratio_min: float = 0.12   # 글자 덩어리의 가로/세로(1은 가늘다)
    char_ratio_max: float = 3.6    # 흐린 장면에서는 숫자 셋이 한 덩어리로 붙는다
    fill_min: float = 0.18     # 덩어리 넓이 / 둘러싼 네모 넓이
    ring: float = 0.28         # 둘레를 글자 높이의 이만큼 넓혀 바탕색을 본다
    ring_white: float = 0.66   # 둘레에서 글자를 뺀 점 중 흰 점의 비율
    gap_max: float = 0.6       # 옆 글자와의 틈(글자 높이 대비, 어느 방향이든)
    size_ratio: float = 1.5    # 옆 글자와의 높이 비
    group_ratio_max: float = 4.6   # 묶음의 가로/세로(전화번호 띠 제외)
    max_chars: int = 5
    max_group: int = 14        # 가까이 이어진 글자 덩어리가 이보다 많으면 띠·인쇄물로 보고 버린다
    min_chars: int = 2         # 묶음의 글자 수(흐려서 한 덩어리로 붙은 넓은 덩어리는 하나여도 받는다)
    align_ratio: float = 1.4   # 묶음 안 글자 높이의 비
    align_shift: float = 0.22  # 묶음 안 글자의 위아래 어긋남(글자 높이 대비)
    ring_std: float = 27.0     # 둘레 흰 점 밝기의 표준편차(종이는 고르고 자갈은 얼룩덜룩)


@dataclass(frozen=True)
class Tag:
    x: float      # 화면 0~1 (왼쪽 위 원점): 글자 묶음에 딱지 여백을 붙인 바깥 네모
    y: float
    w: float
    h: float
    score: float  # 둘레가 희고 고른 정도(종이 딱지 0.7 안팎, 자갈 0.4 안팎)
    rect: tuple   # 글자 묶음의 기운 네모 ((cx, cy), (가로, 세로), 각도°) — 화소 단위, 가로가 글줄 방향
    chars: int = 1


def _box_sum(ii, x0, y0, x1, y1):
    return ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0]


class StaticMask:
    """방송 내내 같은 자리에 떠 있는 글자(가게 이름·전화번호 띠)를 익혀 지운다.

    카메라를 손에 들고 찍으므로 화면의 다른 것은 계속 바뀐다. 최근 horizon장의 거의 모든 장면에서 어두웠던 점만 "붙박이"로 본다.
    horizon은 번호표를 가만히 비추는 시간보다 훨씬 길게(기본: 초당 5장으로 3분) 잡는다.
    """

    def __init__(self, horizon=900, level=0.85):
        self.alpha, self.level, self.n, self.horizon, self.ema = 1.0 / horizon * 2.3, level, 0, horizon, None

    def update(self, bgr, p=None):
        p = p or FindParams()
        dark = dark_mask(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), p)[0].astype(np.float32)
        self.ema = dark if self.ema is None else cv2.addWeighted(self.ema, 1 - self.alpha, dark, self.alpha, 0)
        self.n += 1

    def mask(self):
        """붙박이 점(조금 부풀림). 아직 덜 익었으면 None"""
        if self.ema is None or self.n < self.horizon:
            return None
        m = (self.ema >= self.level).astype(np.uint8)
        return cv2.dilate(m, np.ones((5, 5), np.uint8))


def dark_mask(gray, p):
    """글자일 수 있는 어두운 점(0/1)과 둘레 밝기. 둘레 밝기 = 가까운 곳(bg_px)의 가장 밝은 값"""
    H, W = gray.shape
    k = max(3, int(round(p.bg_px * W / 1280 / 4)) | 1)
    small = cv2.resize(gray, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    bg = cv2.resize(cv2.blur(cv2.dilate(small, np.ones((k, k), np.uint8)), (5, 5)), (W, H), interpolation=cv2.INTER_LINEAR)
    dark = ((gray.astype(np.float32) < p.dark_rel * bg) & (bg >= p.bg_min)).astype(np.uint8)
    return dark, bg


def _best_line(g, p):
    """가까이 모인 글자 덩어리들(x 순서) 가운데 한 줄로 가지런한 가장 큰 무리의 차례들.

    두 덩어리를 잇는 선을 글줄로 놓아 보고, 그 선에서 벗어나지 않고 크기가 비슷한 덩어리를 센다(딱지 옆 그림자·잎을 떼어 낸다).
    같은 글씨체로 찍은 숫자는 크기가 같고 한 줄에 놓인다. 딱지가 세로로 서 있어도 된다(크기 = 가로·세로 중 긴 쪽).
    """
    n = len(g)
    cx = [c[0] + c[2] / 2 for c in g]
    cy = [c[1] + c[3] / 2 for c in g]
    size = [max(c[2], c[3]) for c in g]
    best, key = [0], (0, 0.0)
    for i in range(n):
        for j in range(i + 1, n):
            dx, dy = cx[j] - cx[i], cy[j] - cy[i]
            d = math.hypot(dx, dy)
            if d < 1 or max(size[i], size[j]) > p.align_ratio * min(size[i], size[j]):
                continue
            ux, uy = dx / d, dy / d
            off = [-(cx[k] - cx[i]) * uy + (cy[k] - cy[i]) * ux for k in range(n)]
            inl = [k for k in range(n) if abs(off[k]) <= p.align_shift * size[i] and max(size[k], size[i]) <= p.align_ratio * min(size[k], size[i])]
            if len(inl) > p.max_chars:
                continue
            k2 = (len(inl), -sum(abs(off[k]) for k in inl) / size[i])
            if k2 > key:
                best, key = inl, k2
    return best


def find_tags(bgr, p=FindParams(), ignore=None):
    """BGR 그림 → [Tag] (큰 것부터). ignore: 지울 점(StaticMask.mask())"""
    H, W = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lo = bgr.min(axis=2)
    hi = bgr.max(axis=2)
    dark, bg = dark_mask(gray, p)
    if ignore is not None:
        dark[ignore > 0] = 0
    white = ((lo >= p.white_min) & (hi - lo <= p.white_spread)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    if n <= 1:
        return []
    x, y, w, h, area = (stats[1:, k].astype(np.int64) for k in range(5))
    ok = (h >= p.h_min * H) & (h <= p.h_max * H) & (w >= p.char_ratio_min * h) & (w <= p.char_ratio_max * h) & (area >= p.fill_min * w * h)
    ok &= (x > 0) & (y > 0) & (x + w < W) & (y + h < H)  # 화면 가장자리에 잘린 덩어리는 글자가 아니거나 못 읽는다
    # 인쇄한 숫자는 새까맣다: 자갈 그림자(회색)는 덩어리의 평균 밝기로 거른다
    mean = np.bincount(labels.ravel(), weights=gray.ravel(), minlength=n)[1:] / np.maximum(1, area)
    around = np.bincount(labels.ravel(), weights=bg.ravel(), minlength=n)[1:] / np.maximum(1, area)
    ok &= mean <= p.ink_rel * around
    idx = np.nonzero(ok)[0]
    if len(idx) > p.max_candidates:
        idx = idx[np.argsort(-h[idx])[:p.max_candidates]]
    if len(idx) == 0:
        return []
    iw = cv2.integral(white)
    idk = cv2.integral(dark)
    gw_ = gray.astype(np.float64) * white
    i1, i2 = cv2.integral(gw_), cv2.integral(gw_ * gray)
    chars = []
    for i in idx:
        r = int(round(p.ring * h[i]))
        x0, y0, x1, y1 = max(0, x[i] - r), max(0, y[i] - r), min(W, x[i] + w[i] + r), min(H, y[i] + h[i] + r)
        tot = (x1 - x0) * (y1 - y0)
        dk = _box_sum(idk, x0, y0, x1, y1)
        wh = _box_sum(iw, x0, y0, x1, y1)
        if tot - dk <= 0 or wh <= 0:
            continue
        ratio = wh / (tot - dk)
        m1 = _box_sum(i1, x0, y0, x1, y1) / wh
        var = _box_sum(i2, x0, y0, x1, y1) / wh - m1 * m1
        if var > p.ring_std ** 2:
            continue
        if ratio >= p.ring_white:
            # 점수: 둘레가 희고(1에 가까움) 고를수록(얼룩이 적음) 높다 — 종이 딱지는 0.7 안팎, 자갈은 0.4 안팎
            chars.append((int(x[i]), int(y[i]), int(w[i]), int(h[i]), float(ratio - math.sqrt(max(0.0, var)) / 60.0), int(i) + 1))
    if not chars:
        return []
    # 옆으로 나란한 글자끼리 묶는다
    chars.sort()
    parent = list(range(len(chars)))

    def root(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    # 어느 방향으로든 가까이 붙은 비슷한 크기의 글자끼리(딱지가 세로로 서 있어도 묶이게)
    for a in range(len(chars)):
        ax, ay, aw, ah = chars[a][:4]
        for b in range(a + 1, len(chars)):
            bx, by, bw, bh = chars[b][:4]
            if max(ah, bh) > p.size_ratio * min(ah, bh):
                continue
            dx = max(0, bx - (ax + aw), ax - (bx + bw))
            dy = max(0, by - (ay + ah), ay - (by + bh))
            if math.hypot(dx, dy) <= p.gap_max * min(ah, bh):
                parent[root(a)] = root(b)
    groups = {}
    for a in range(len(chars)):
        groups.setdefault(root(a), []).append(chars[a])
    out = []
    # 글자가 길게 이어진 무리(가게 이름·전화번호 띠, 인쇄물)는 번호표가 아니다
    todo = [g for g in groups.values() if len(g) <= p.max_group]
    while todo:
        g = todo.pop()
        if len(g) >= 2:
            keep = _best_line(g, p)
            rest = [c for k, c in enumerate(g) if k not in keep]
            if len(rest) >= 2 or (rest and rest[0][2] >= 1.3 * rest[0][3]):
                todo.append(rest)   # 가까이 놓인 다른 번호표일 수 있다
            g = [g[k] for k in keep]
        if len(g) < p.min_chars and g[0][2] < 1.3 * g[0][3]:
            continue  # 글자 하나짜리(자갈 그림자·한글 받침이 대부분). 한 자리 번호를 쓰는 판매자는 min_chars=1
        pts = np.concatenate([(np.argwhere(labels[c[1]:c[1] + c[3], c[0]:c[0] + c[2]] == c[5])[:, ::-1] + (c[0], c[1])).astype(np.float32) for c in g])
        # 글줄 방향: 글자가 둘 이상이면 처음과 끝 글자의 중심을 잇는 선, 하나(흐려서 붙은 덩어리)면 덩어리의 긴 축
        if len(g) >= 2:
            first, last = g[0], g[-1]
            ang = math.degrees(math.atan2((last[1] + last[3] / 2) - (first[1] + first[3] / 2), (last[0] + last[2] / 2) - (first[0] + first[2] / 2)))
        else:
            (_, _), (rw, rh), ra = cv2.minAreaRect(pts)
            ang = ra if rw >= rh else ra - 90.0
            while ang > 45:
                ang -= 90
            while ang < -45:
                ang += 90
        c0 = pts.mean(axis=0)
        ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        hmed = float(np.median([c[3] for c in g]))
        # 그 방향으로 돌린 좌표에서 글자 묶음의 네모
        u = (pts[:, 0] - c0[0]) * ca + (pts[:, 1] - c0[1]) * sa
        v = -(pts[:, 0] - c0[0]) * sa + (pts[:, 1] - c0[1]) * ca
        gw, gh = float(u.max() - u.min()) + 1, float(v.max() - v.min()) + 1
        if gw > p.group_ratio_max * gh or gh < p.h_min * H * 0.8:
            continue
        mu, mv = (u.max() + u.min()) / 2, (v.max() + v.min()) / 2
        cxy = (float(c0[0] + mu * ca - mv * sa), float(c0[1] + mu * sa + mv * ca))
        # 딱지 바깥 네모(추적용): 글자 묶음에 여백
        x0, y0 = pts[:, 0].min() - 0.4 * hmed, pts[:, 1].min() - 0.35 * hmed
        x1, y1 = pts[:, 0].max() + 0.4 * hmed, pts[:, 1].max() + 0.35 * hmed
        x0, y0, x1, y1 = max(0.0, x0), max(0.0, y0), min(float(W), x1), min(float(H), y1)
        score = float(np.mean([c[4] for c in g]))
        out.append(Tag(x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H, round(score, 3), (cxy, (gw, gh), float(ang)), len(g)))
    # 먼저 읽을 차례: 글자 수가 번호표다운 것(둘 이상) 먼저, 그 안에서는 종이다운 것(점수)부터
    return sorted(out, key=lambda t: (t.chars < 2, -t.score))


def crop_tag(bgr, tag, pad=0.3, height=64, extend=True):
    """글자 묶음을 기울기를 펴서 잘라 낸다. pad = 글자 높이 대비 여백, 높이는 height 화소로 맞춘다.

    extend: 묶음 바로 옆에 글자 같은 어두운 것이 붙어 있으면(잎·손가락에 닿아 찾기가 놓친 첫 숫자·끝 숫자) 그쪽으로 글자 하나만큼씩
    두 번까지 넓힌다. 숫자가 잘린 조각은 "421"을 "21"이나 "121"로 읽게 만든다.
    """
    (cx, cy), (gw, gh), ang = tag.rect
    side = ((1.6 if extend else 0.0) + pad) * gh
    M = cv2.getRotationMatrix2D((cx, cy), ang, 1.0)
    ow, oh = int(round(gw + 2 * side)), int(round(gh * (1 + 2 * pad)))
    ow, oh = max(8, ow), max(8, oh)
    M[0, 2] += ow / 2 - cx
    M[1, 2] += oh / 2 - cy
    strip = cv2.warpAffine(bgr, M, (ow, oh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    x0, x1 = side, side + gw   # 펴 놓은 띠에서 글자 묶음이 차지하는 가로 범위
    if extend:
        g = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY)
        band = g[int(oh * 0.3):int(oh * 0.7) + 1]
        paper = float(np.percentile(band[:, int(x0):max(int(x0) + 1, int(x1))], 95))
        dark = band < 0.68 * paper
        for _ in range(2):   # 왼쪽
            a, b = int(x0 - 0.28 * gh), int(x0 - 0.06 * gh)
            if a < 0 or b <= a or dark[:, a:b].mean() <= 0.12:
                break
            x0 -= 0.8 * gh
        for _ in range(2):   # 오른쪽
            a, b = int(x1 + 0.06 * gh), int(x1 + 0.28 * gh)
            if b > ow or b <= a or dark[:, a:b].mean() <= 0.12:
                break
            x1 += 0.8 * gh
    xa, xb = int(max(0, x0 - pad * gh)), int(min(ow, x1 + pad * gh))
    crop = strip[:, xa:max(xa + 8, xb)]
    s = height / crop.shape[0]
    return cv2.resize(crop, (max(8, int(round(crop.shape[1] * s))), height), interpolation=cv2.INTER_CUBIC if s > 1 else cv2.INTER_AREA)
