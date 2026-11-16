# 번호표 찾기 모델 미세조정: r2에서 출발해 여러 가게(11-12·11-13 유튜브, 11-16 틱톡 비트다육) 장면으로 다시 학습
#   python -m sw.tag_train <data.yaml> <out project> <epochs>   → <out project>/r3/weights/best.pt (D-SCR-TAG-01, r3는 25 epoch·맥 미니 MPS 1시간 20분)
import os, sys
from ultralytics import YOLO
m = YOLO(os.path.join(os.path.dirname(__file__), "..", "models", "tag_yolo11n_r2.pt"))
m.train(data=sys.argv[1], project=sys.argv[2], name="r3", exist_ok=True, epochs=int(sys.argv[3]), imgsz=960, batch=16,
        device=os.environ.get("DEV", "mps"), patience=8, workers=4, degrees=30.0, mosaic=1.0, close_mosaic=3, plots=False, verbose=False)
