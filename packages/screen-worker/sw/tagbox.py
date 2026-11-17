# 번호표 위의 숫자만 번호로 받는다 (D-SCR-TAG-01, 모델은 D-SCR-TAG-02)
#  - 화면 전체 글자 읽기(sw/screen.py)는 숫자 모양이면 어디에 적힌 것이든 번호 후보로 받았다. 2026-11-16 틱톡 방송에서
#    판매자가 놓은 줄자 눈금 "9"·"5 6 7"을 번호표로 읽어 9번·567번이 등록됐다. 숫자 모양·자리로 거르면 진짜 9번·567번
#    번호표도 같이 버린다 — 거르는 기준은 "그 숫자가 번호표 위에 있나"여야 한다.
#  - 그래서 장면마다 번호표 찾기 모델로 번호표 상자를 찾고, 읽힌 숫자의 가운데가 어느 상자(조금 넓힌) 안에 있을 때만
#    번호 후보로 남긴다. 번호 읽기·대표 번호 고르기는 지금 방식(전체 화면 Vision 읽기, 가장 큰 글자) 그대로다 — 0단계에서
#    조각 읽기로 바꾸면 앞에 든 번호표 맞음이 91.5 → 88.3%로 떨어졌으므로 읽기는 바꾸지 않고 "번호표 위인가"만 더한다.
#  - 찾기 모델은 RF-DETR Nano(Apache-2.0)를 번호표 장면으로 미세조정해 ONNX로 내보낸 것(models/tag_rfdetr_nano.onnx,
#    sw/tag_ds.py·sw/tag_train.py). 일꾼에는 onnxruntime(MIT)과 opencv만 있으면 된다 — torch·ultralytics(AGPL)를 쓰지 않는다.
#  - 상자 판정(split)은 순수 계산이다. 모델은 처음 부를 때 한 번 올린다.
import os

MODEL = os.environ.get("SCREEN_TAG_MODEL") or os.path.join(os.path.dirname(__file__), "..", "models", "tag_rfdetr_nano.onnx")
CONF = float(os.environ.get("SCREEN_TAG_CONF", "0.3"))
MARGIN = 0.15        # 상자를 위아래·양옆으로 상자 크기의 이만큼씩 넓혀 본다(기울어진 번호표의 글자가 상자 끝에 걸릴 때)
THREADS = 2          # 화면 글자 읽기(Vision)·받아쓰기와 CPU를 나눠 쓴다
ON = os.environ.get("SCREEN_TAG_GATE", "1") != "0"
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


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


def decode(dets, logits, conf=CONF):
    """RF-DETR 출력 한 장 → [[x1, y1, x2, y2, 확신]](0~1, 확신 큰 것부터). dets (Q, 4) 가운데·너비 꼴, logits (Q, C) 갈래마다 따로 sigmoid"""
    import numpy as np
    score = 1.0 / (1.0 + np.exp(-np.clip(logits.max(axis=1), -88, 88)))
    out = []
    for i in np.argsort(-score):
        if score[i] <= conf:
            break
        cx, cy, w, h = (float(v) for v in dets[i])
        out.append([round(max(0.0, cx - w / 2), 4), round(max(0.0, cy - h / 2), 4),
                    round(min(1.0, cx + w / 2), 4), round(min(1.0, cy + h / 2), 4), round(float(score[i]), 3)])
    return out


class Finder:
    """번호표 찾기 모델(ONNX). 그래픽 칩은 받아쓰기가 쓰므로 CPU로 돈다"""

    def __init__(self, path=MODEL, conf=CONF):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = THREADS
        so.add_session_config_entry("session.intra_op.allow_spinning", "0")
        self.sess = ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])
        inp = self.sess.get_inputs()[0]
        self.name, (self.h, self.w) = inp.name, inp.shape[2:4]
        self.outs = [o.name for o in self.sess.get_outputs()]
        self.conf = conf

    def boxes(self, img_path):
        import cv2
        import numpy as np
        img = cv2.imread(img_path, cv2.IMREAD_COLOR)
        if img is None:
            raise OSError(f"장면을 못 읽음: {img_path}")
        x = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), (self.w, self.h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        x = ((x - MEAN) / STD).astype(np.float32).transpose(2, 0, 1)[None]
        res = dict(zip(self.outs, self.sess.run(None, {self.name: x})))
        return decode(res["dets"][0], res["labels"][0], self.conf)
