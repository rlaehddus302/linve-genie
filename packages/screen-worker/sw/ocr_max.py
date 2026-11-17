# OCR 최대 성능 시험(비용 무시): 번호표 찾기(sw/tagbox.Finder, RF-DETR) → 번호표마다 넉넉히 잘라 크게 키움 → 0°·±15°·±30° 돌려 각각 읽기 → 가장 확신 높은 숫자.
# 기울어진 번호표(보스다육 311을 322·312로 읽음)와 작은 번호표를 겨냥. 기존 화면 읽기(전체 + 가운데 2배)에 더해 쓴다.
# 결과: <결과 폴더>/screen_max.jsonl — screen.jsonl과 같은 모양 {sec, t:[[번호, x, y, w, h], …]} (기존 읽기 + 번호표 읽기)
# 사용: python -m sw.ocr_max <결과 폴더(frames/·screen.jsonl)> [가중치]
import json
import os
import re
import sys
from multiprocessing import Pool

from PIL import Image

NUM = re.compile(r"^(\d{1,3})[.번]?$")
ANGLES = (0, 15, -15, 30, -30)


def read_crop(crop):
    """잘라 낸 번호표 한 장 → (번호, 확신도) 또는 None"""
    from ocrmac import ocrmac
    best = None
    for a in ANGLES:
        im = crop.rotate(a, expand=True, fillcolor=(255, 255, 255)) if a else crop
        for txt, cf, _ in ocrmac.OCR(im, recognition_level="accurate", language_preference=["en-US"]).recognize():
            m = NUM.match(txt.strip().replace(" ", ""))
            if m and (best is None or cf > best[1]):
                best = (int(m.group(1)), cf)
    return best


def work(args):
    path, boxes = args
    img = Image.open(path).convert("RGB")
    W, H = img.size
    out = []
    for b in boxes:
        x1, y1, x2, y2 = b[0] * W, b[1] * H, b[2] * W, b[3] * H
        bw, bh = x2 - x1, y2 - y1
        box = (max(0, int(x1 - bw * .2)), max(0, int(y1 - bh * .2)), min(W, int(x2 + bw * .2)), min(H, int(y2 + bh * .2)))
        crop = img.crop(box)
        s = max(1.0, 200 / max(1, crop.height))
        crop = crop.resize((max(1, int(crop.width * s)), max(1, int(crop.height * s))), Image.LANCZOS)
        r = read_crop(crop)
        if r and r[1] >= 0.5:
            # 크기는 글자 높이에 맞춘다(기존 읽기와 같은 기준): 번호표 높이의 절반쯤
            out.append([r[0], round(x1 / W, 3), round(y1 / H, 3), round(bw / W, 3), round(bh * 0.5 / H, 3)])
    return out


def main():
    run = sys.argv[1]
    from . import tagbox
    finder = tagbox.Finder(sys.argv[2] if len(sys.argv) > 2 else tagbox.MODEL)
    fdir = os.path.join(run, "frames")
    old = {d["sec"]: d["t"] for d in map(json.loads, open(os.path.join(run, "screen.jsonl"), encoding="utf-8"))}
    fs = sorted(f for f in os.listdir(fdir) if f.endswith(".jpg"))
    jobs = []
    for k, f in enumerate(fs):
        jobs.append((os.path.join(fdir, f), finder.boxes(os.path.join(fdir, f))))
        if k % 1600 == 0:
            print("찾기", k, "/", len(fs), flush=True)
    with Pool(8) as p, open(os.path.join(run, "screen_max.jsonl"), "w", encoding="utf-8") as o:
        for (path, _), extra in zip(jobs, p.imap(work, jobs, chunksize=8)):
            sec = int(os.path.basename(path)[:6])
            o.write(json.dumps({"sec": sec, "t": old.get(sec, []) + extra}) + "\n")
    print("끝", len(jobs), flush=True)


if __name__ == "__main__":
    main()
