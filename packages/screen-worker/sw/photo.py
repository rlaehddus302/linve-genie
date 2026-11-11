# 상품 대표 사진 고르기: 그 번호로 읽힌 초들 중 번호표 글자가 가장 크게 찍힌 몇 장을 고르고, 그중 흔들림이 가장 적은(선명한) 사진.
# 선명도 = 회색조 이미지의 경계(라플라시안 근사) 세기의 분산. 크게 들고 보여 준 순간 + 흔들리지 않은 순간을 고른다.
import os

from PIL import Image, ImageFilter, ImageStat

TOP = 5  # 글자가 큰 순으로 이만큼 본 뒤 그중 가장 선명한 것


def sharpness(path):
    img = Image.open(path).convert("L")
    img.thumbnail((640, 640))
    return ImageStat.Stat(img.filter(ImageFilter.FIND_EDGES)).var[0]


def best_frame(tokens, no, s, e, frame_path):
    """tokens: {초: [(번호, x, y, w, h)]}, frame_path(초) → 파일 경로. → 고른 초(없으면 None)"""
    sized = []
    for i in range(int(s), int(e) + 1):
        hs = [z[4] for z in tokens.get(i, []) if z[0] == no]
        if hs and os.path.exists(frame_path(i)):
            sized.append((max(hs), i))
    if not sized:
        return None
    sized.sort(reverse=True)
    return max(sized[:TOP], key=lambda x: sharpness(frame_path(x[1])))[1]
