# 번호표 위의 숫자만 번호로 (D-SCR-TAG-01) — 좌표는 2026-11-16 틱톡 방송 0:39~0:41 장면에서 읽힌 값 그대로
from sw import tagbox as T

TAG_450 = [0.166, 0.28, 0.357, 0.37, 0.79]          # 찾기 모델이 찾은 450번 번호표 상자
READ_450 = (450, 0.188, 0.294, 0.145, 0.06)          # 같은 장면에서 Vision이 읽은 450
RULER_9 = (9, 0.975, 0.906, 0.022, 0.019)            # 오른쪽 아래 줄자 눈금
RULER_567 = (567, 0.893, 0.918, 0.123, 0.09)         # 줄자 눈금 5 6 7을 한 덩어리로 읽은 것


def test_ruler_digits_are_not_numbers():
    kept, off = T.split([READ_450, RULER_9, RULER_567], [TAG_450])
    assert kept == [READ_450]
    assert off == [RULER_9, RULER_567]


def test_no_tag_on_screen_means_no_number():
    kept, off = T.split([RULER_9, RULER_567], [])
    assert kept == [] and off == [RULER_9, RULER_567]


def test_real_567_tag_is_kept():
    # 진짜 567번 번호표가 같은 자리에 나오면 숫자 모양·자리와 상관없이 번호로 받는다
    tag = [0.88, 0.90, 1.0, 0.99, 0.6]
    kept, _ = T.split([RULER_567], [tag])
    assert kept == [RULER_567]


def test_small_digit_inside_tag_box_kept():
    # 번호표 상자 안이면 작게 읽힌 한 자리 번호(9번)도 받는다
    tag = [0.40, 0.40, 0.48, 0.45, 0.5]
    nine = (9, 0.43, 0.41, 0.02, 0.03)
    assert T.on_tag(nine, [tag])


def test_margin_covers_digit_at_box_edge():
    tag = [0.30, 0.30, 0.50, 0.40, 0.7]
    edge = (321, 0.47, 0.37, 0.05, 0.04)              # 가운데 (0.495, 0.39) — 상자 안
    just_out = (321, 0.51, 0.37, 0.02, 0.04)          # 가운데 x 0.52 — 넓힌 상자(0.53까지) 안
    far = (321, 0.56, 0.37, 0.04, 0.04)               # 가운데 x 0.58 — 넓힌 상자 밖
    assert T.on_tag(edge, [tag]) and T.on_tag(just_out, [tag]) and not T.on_tag(far, [tag])


def test_default_model_is_shipped():
    # 일꾼은 저장소의 RF-DETR(ONNX) 가중치를 바로 쓴다(맥 미니 작업 폴더는 git pull로만 바뀜). YOLO(AGPL) 가중치는 저장소에 없다 (D-SCR-TAG-02)
    import os
    assert T.MODEL.endswith("tag_rfdetr_nano.onnx") and os.path.getsize(T.MODEL) > 1_000_000
    models = os.path.dirname(T.MODEL)
    assert not [f for f in os.listdir(models) if "yolo" in f.lower()]


def test_decode_rfdetr_output():
    import numpy as np
    dets = np.array([[0.5, 0.5, 0.2, 0.1], [0.1, 0.9, 0.3, 0.3], [0.7, 0.2, 0.1, 0.1]], dtype=np.float32)   # 가운데 x·y, 너비·높이
    logits = np.array([[-5.0, 2.0], [-5.0, -3.0], [1.0, -6.0]], dtype=np.float32)                         # 갈래마다 따로 sigmoid
    out = T.decode(dets, logits, conf=0.3)
    assert [b[:4] for b in out] == [[0.4, 0.45, 0.6, 0.55], [0.65, 0.15, 0.75, 0.25]]                   # 확신 큰 것부터, 0.3 이하 버림
    assert out[0][4] > out[1][4] > 0.3
    edge = T.decode(np.array([[0.05, 0.98, 0.2, 0.1]], dtype=np.float32), np.array([[3.0, 0.0]], dtype=np.float32))
    assert edge[0][:4] == [0.0, 0.93, 0.15, 1.0]                                                            # 화면 밖은 0~1로 자름
