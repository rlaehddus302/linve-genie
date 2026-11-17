# 번호표 찾기 모델 미세조정 자료(RF-DETR이 읽는 COCO 형식, D-SCR-TAG-01·02). 사람이 붙인 정답이 없어 일꾼 기록으로 근사 정답을 만든다.
#  - 진짜 번호표 글자: 그 번호가 이 방송에 등록됐고(post.jsonl, 상품 목록이 있으면 그 목록) 그 장면 앞뒤 60초 안에 판매자가 "N번"이라 말한 숫자
#  - 정답 네모: 씨앗 모델(SEED_MODEL, 기본은 지금 일꾼 모델 models/tag_rfdetr_nano.onnx)이 확신 0.5 넘게 찾은 네모
#    + 진짜 글자인데 그 네모 밖이면 글자 네모를 번호표 크기로 넓힌 네모
#  - 장면을 버리는 경우(정답이 흐려지므로): 씨앗 모델 네모가 0.25~0.5 사이, 또는 어느 네모에도 없고 진짜도 아닌데 등록된 번호(또는 그 일부)인 글자
#  - 번호표 아닌 숫자만 있는 장면(줄자 눈금 등 — 등록된 적 없는 번호)은 네모 없는 장면으로 넣는다
#  - 같은 번호를 두 번 읽어 겹친 네모(IoU 0.5 넘음)는 하나로
#  - 저장소에는 장면·정답을 넣지 않는다(손님 닉네임이 화면에 섞임) — 결과 폴더는 저장소 밖에
#   python -m sw.tag_ds <out> <every> <run:split[:truth.json]> ...   (split = train | valid | auto(뒤 20%를 valid))
#   → <out>/train·valid·test/_annotations.coco.json + 장면 링크(test는 valid 앞 200장 — 학습 중 시험은 끄고 자료 모양만 맞춤)
#   첫 RF-DETR(2026-11-17)의 자료는 같은 규칙으로 r2(YOLO, 이전 씨앗)에서 만들었다: every 3, EXP_W=1.45 EXP_H=1.9, NOT_TAGS="@bit_succulent_farm-20261116_213923=9,567",
#     @bit_succulent_farm-20261116_213923 · Gqsa7bYIhOc-20261113_085837 · mo9alKLVEUI-20261113_125904 (auto)
#     xhv-E5HEWUw-20261112_115053 · _131840 · _111346 (auto, 정답 ~/lg/bench/20261112/products.json)
import json, os, random, sys

from PIL import Image

from . import tagbox

random.seed(11)
out, every = sys.argv[1], int(sys.argv[2])
root = os.path.expanduser(os.environ.get("LG_RUNS", "~/lg/runs/live"))
seed = tagbox.Finder(os.environ.get("SEED_MODEL", tagbox.MODEL), conf=0.25)
EXP_W, EXP_H = float(os.environ.get("EXP_W", 1.35)), float(os.environ.get("EXP_H", 1.7))
stats = {}
sets = {"train": [], "valid": []}                      # [(장면 이름, 원본 경로, 네모들)]


def iou(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    i = w * h
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i)


def inside(z, b, margin=0.0):
    cx, cy = z[1] + z[3] / 2, z[2] + z[4] / 2
    mx, my = (b[2] - b[0]) * margin, (b[3] - b[1]) * margin
    return b[0] - mx <= cx <= b[2] + mx and b[1] - my <= cy <= b[3] + my


for spec in sys.argv[3:]:
    name, split, *tf = spec.split(":")
    run = os.path.join(root, name)
    rows = [json.loads(l) for l in open(os.path.join(run, "screen.jsonl"))]
    for r in rows:                                     # 번호표 거르기가 켜진 뒤의 기록은 버린 숫자(off)까지 모두
        r["t"] = r["t"] + r.get("off", [])
    base = min(r["sec"] for r in rows)
    if tf:
        reg = {p["no"] for p in json.load(open(os.path.expanduser(tf[0])))["products"] if p["phase"] != "CLOSED"}
    else:
        reg = set()
        for l in open(os.path.join(run, "post.jsonl")):
            d = json.loads(l)
            if d.get("result") == "ok" and isinstance(d.get("no"), int):
                reg.add(d["no"])
    said = []
    for l in open(os.path.join(run, "transcript.jsonl")):
        d = json.loads(l)
        for n in d.get("nos") or []:
            said.append((d["start_sec"], n))
    # 눈으로 확인한 잘못된 등록(번호표 아닌 숫자): NOT_TAGS="실행=9,567;실행=…"
    wrong = {int(x) for spec2 in os.environ.get("NOT_TAGS", "").split(";") if spec2.startswith(name + "=") for x in spec2.split("=", 1)[1].split(",")}
    reg -= wrong
    regs = [str(n) for n in reg]
    st = {"pos": 0, "neg": 0, "skip": 0, "boxes": 0, "synth": 0}
    rows = [r for r in rows if r["t"]] + random.sample([r for r in rows if not r["t"]], min(len([r for r in rows if not r["t"]]) // (every * 10), 200))
    cut = sorted(r["sec"] for r in rows)[int(len(rows) * 0.8)]
    for r in sorted(rows, key=lambda r: r["sec"])[::every]:
        sp = split if split != "auto" else ("valid" if r["sec"] >= cut else "train")
        f = os.path.join(run, "frames", "%06d.jpg" % (r["sec"] - base))
        if not os.path.exists(f):
            continue
        yb = seed.boxes(f)
        if any(b[4] < 0.5 for b in yb):
            st["skip"] += 1
            continue
        boxes, bad = [b[:4] for b in yb], False
        near = {n for t, n in said if abs(t - r["sec"]) <= 60 and n in reg}
        for z in r["t"]:
            if any(inside(z, b, 0.15) for b in yb):
                continue
            real = z[0] in reg and any(abs(t - r["sec"]) <= 60 and n == z[0] for t, n in said)
            if real:
                cx, cy = z[1] + z[3] / 2, z[2] + z[4] / 2
                w, h = z[3] * EXP_W, z[4] * EXP_H
                boxes.append([max(0, cx - w / 2), max(0, cy - h / 2), min(1, cx + w / 2), min(1, cy + h / 2)])
                st["synth"] += 1
            elif z[0] in reg or any(str(z[0]) in str(n) for n in near | {q[0] for q in r["t"] if q is not z}):
                bad = True                                   # 등록된 번호인데 말한 때와 멀거나, 지금 말하는·같이 보인 번호의 일부(388의 38) — 진짜인지 모름
        if bad:
            st["skip"] += 1
            continue
        uniq = []
        for b in boxes:
            if all(iou(b, u) <= 0.5 for u in uniq):
                uniq.append(b)
        boxes = uniq
        sets[sp].append(("%s_%06d.jpg" % (name.replace("@", ""), r["sec"]), f, boxes))
        st["pos" if boxes else "neg"] += 1
        st["boxes"] += len(boxes)
    stats[name] = st
    print(name, split, st, flush=True)
sets["test"] = sets["valid"][:200]
for sp, items in sets.items():
    d = os.path.join(out, sp)
    os.makedirs(d, exist_ok=True)
    images, anns = [], []
    for i, (fn, f, boxes) in enumerate(items):
        if not os.path.exists(os.path.join(d, fn)):
            os.symlink(f, os.path.join(d, fn))
        W, H = Image.open(f).size
        images.append({"id": i, "file_name": fn, "width": W, "height": H})
        for x1, y1, x2, y2 in boxes:
            bw, bh = (x2 - x1) * W, (y2 - y1) * H
            anns.append({"id": len(anns), "image_id": i, "category_id": 1, "bbox": [x1 * W, y1 * H, bw, bh], "area": bw * bh, "iscrowd": 0})
    json.dump({"info": {}, "licenses": [], "images": images, "annotations": anns,
               "categories": [{"id": 0, "name": "tags", "supercategory": "none"}, {"id": 1, "name": "tag", "supercategory": "tags"}]},
              open(os.path.join(d, "_annotations.coco.json"), "w"))
    print(sp, len(images), "장", len(anns), "네모", flush=True)
json.dump(stats, open(os.path.join(out, "stats.json"), "w"), indent=1)
