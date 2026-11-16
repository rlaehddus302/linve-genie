# 번호표 위의 숫자만 번호로 받는다 (D-SCR-TAG-01)
#  - 화면 전체 글자 읽기(sw/screen.py)는 숫자 모양이면 어디에 적힌 것이든 번호 후보로 받았다. 2026-11-16 틱톡 방송에서
#    판매자가 놓은 줄자 눈금 "9"·"5 6 7"을 번호표로 읽어 9번·567번이 등록됐다. 숫자 모양·자리로 거르면 진짜 9번·567번
#    번호표도 같이 버린다 — 거르는 기준은 "그 숫자가 번호표 위에 있나"여야 한다.
#  - 그래서 장면마다 번호표 찾기 모델로 번호표 상자를 찾고, 읽힌 숫자의 가운데가 어느 상자(조금 넓힌) 안에 있을 때만
#    번호 후보로 남긴다. 모델은 r3(models/tag_yolo11n_r3.pt): 다른 가게로 학습한 r2(0단계 측정 docs/retro/2026-11-16-stage0-results.md
#    4.1절)는 비트다육의 기울어진·작은 번호표를 놓쳐 학습에 안 쓴 세 방송에서 진짜 번호 187개 중 11개의 화면 근거를 잃었다.
#    r2에서 출발해 여섯 방송 장면으로 다시 학습한 r3는 1개(sw/tag_ds.py·sw/tag_train.py, 근사 정답).
#    번호 읽기·대표 번호 고르기는 지금 방식(전체 화면 Vision 읽기, 가장 큰 글자) 그대로다 — 0단계에서 조각 읽기로 바꾸면
#    앞에 든 번호표 맞음이 91.5 → 88.3%로 떨어졌으므로 읽기는 바꾸지 않고 "번호표 위인가"만 더한다.
#  - 상자 판정(split)은 순수 계산이다. 모델은 처음 부를 때 한 번 올린다.
import os

MODEL = os.environ.get("SCREEN_TAG_MODEL") or os.path.join(os.path.dirname(__file__), "..", "models", "tag_yolo11n_r3.pt")
IMGSZ = 960          # 0단계: 긴 변 960에서 작은 번호표 81.9% (640은 43.6%)
CONF = 0.25          # 0단계 측정과 같은 값
MARGIN = 0.15        # 상자를 위아래·양옆으로 상자 크기의 이만큼씩 넓혀 본다(기울어진 번호표의 글자가 상자 끝에 걸릴 때)
ON = os.environ.get("SCREEN_TAG_GATE", "1") != "0"


def on_tag(tok, boxes, margin=MARGIN):
    """읽힌 숫자 tok = (번호, x, y, w, h)(위쪽 원점, 0~1)의 가운데가 번호표 상자 [x1, y1, x2, y2, 확신] 안에 있나"""
    cx, cy = tok[1] + tok[3] / 2, tok[2] + tok[4] / 2
    for b in boxes:
        x1, y1, x2, y2 = b[0], b[1], b[2], b[3]
        mx, my = (x2 - x1) * margin, (y2 - y1) * margin
        if x1 - mx <= cx <= x2 + mx and y1 - my <= cy <= y2 + my:
            return True
    return False


def split(toks, boxes, margin=MARGIN):
    """→ (번호표 위의 숫자, 번호표 밖의 숫자)"""
    kept, off = [], []
    for z in toks:
        (kept if on_tag(z, boxes, margin) else off).append(z)
    return kept, off


class Finder:
    """번호표 찾기 모델. 그래픽 칩은 받아쓰기가 쓰므로 CPU로 돈다(r3 맥 미니: 장당 29~34ms, 1초 1장이면 한 코어의 3% 안팎)"""

    def __init__(self, path=MODEL):
        from ultralytics import YOLO
        self.model = YOLO(path)

    def boxes(self, img_path):
        r = self.model.predict(img_path, imgsz=IMGSZ, conf=CONF, verbose=False, device="cpu")[0]
        h, w = r.orig_shape
        return [[round(x1 / w, 4), round(y1 / h, 4), round(x2 / w, 4), round(y2 / h, 4), round(c, 3)]
                for (x1, y1, x2, y2), c in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist())]
