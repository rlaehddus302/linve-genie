# 번호표 찾기 모델 미세조정: RF-DETR Nano(Apache-2.0)를 sw/tag_ds.py 자료로 학습하고 일꾼이 쓰는 ONNX로 내보낸다 (D-SCR-TAG-02)
#   학습용 가상환경(일꾼 가상환경과 따로): uv pip install "rfdetr[train,onnx]==1.12.1" torch==2.15.0 torchvision==0.29.2
#   python -m sw.tag_train <자료(COCO)> <결과 폴더> <epochs>          → <결과 폴더>/checkpoint_best_total.pth
#   python -m sw.tag_train --export <checkpoint.pth> <결과 폴더>      → <결과 폴더>/tag_rfdetr_nano.onnx(가중치만 fp16, 61MB — fp32 115MB는 GitHub 100MB 한도를 넘음, 상자 차이 0.003 안) → models/로 복사
#   맥 미니는 방송 일꾼이 그래픽 칩을 쓰므로 학습은 다른 맥에서(2026-11-17 첫 모델: 맥북 M3 Pro, 해상도 512)
import os
import sys

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
RES = int(os.environ.get("RES", "512"))       # 64의 배수. 기본 384는 세로 화면(틱톡)의 작은 번호표가 너무 작아진다


def half(src, dst):
    """가중치(원소 1024개 넘는 float32)를 float16으로 담고, 읽을 때 float32로 되돌리는 Cast를 단다 — 계산은 float32 그대로, 파일만 절반"""
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    m = onnx.load(src)
    g = m.graph
    inits, casts = [], []
    for t in g.initializer:
        a = numpy_helper.to_array(t)
        if a.dtype == np.float32 and a.size >= 1024:
            h = numpy_helper.from_array(a.astype(np.float16), t.name + "__f16")
            inits.append(h)
            casts.append(helper.make_node("Cast", [h.name], [t.name], to=TensorProto.FLOAT, name=t.name + "__cast"))
        else:
            inits.append(t)
    del g.initializer[:]
    g.initializer.extend(inits)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.checker.check_model(m)
    onnx.save(m, dst)


def main():
    from rfdetr import RFDETRNano
    if sys.argv[1] == "--export":
        m = RFDETRNano(pretrain_weights=sys.argv[2], resolution=RES)
        m.export(output_dir=sys.argv[3])     # 입력 1×3×RES×RES, 출력 dets(가운데·너비 꼴 0~1)·labels(갈래 점수) — sw/tagbox.decode
        half(os.path.join(sys.argv[3], "rfdetr-nano.onnx"), os.path.join(sys.argv[3], "tag_rfdetr_nano.onnx"))
        return
    m = RFDETRNano(resolution=RES)
    m.train(dataset_dir=sys.argv[1], output_dir=sys.argv[2], epochs=int(sys.argv[3]), batch_size=int(os.environ.get("RF_BS", "4")),
            grad_accum_steps=int(os.environ.get("RF_ACC", "4")), lr=1e-4, num_workers=2, checkpoint_interval=1, tensorboard=False,
            wandb=False, early_stopping=False, run_test=False, multi_scale=False, expanded_scales=False, progress_bar=True)


if __name__ == "__main__":
    main()
