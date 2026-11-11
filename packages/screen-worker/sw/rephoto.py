# 이미 만든 결과 폴더의 대표 사진만 다시 고른다(판정·금액은 그대로): python -m sw.rephoto <원본 결과 폴더(frames 있음)> <결과 폴더>
import json
import os
import shutil
import sys

from .photo import best_frame
from .screen import Screen


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    sc = Screen()
    for l in open(os.path.join(src, "screen.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        sc.add(d["sec"], [tuple(z) for z in d["t"]])
    base = min(sc.tokens) if sc.tokens else 0
    frame = lambda i: os.path.join(src, "frames", f"{i - base:06d}.jpg")
    evs = [json.loads(l) for l in open(os.path.join(dst, "events.jsonl"), encoding="utf-8")]
    shutil.rmtree(os.path.join(dst, "photos"), ignore_errors=True)
    os.makedirs(os.path.join(dst, "photos"))
    n = 0
    for e in evs:
        if e["kind"] in ("확정", "확인요청"):
            sec = best_frame(sc.tokens, e["no"], e["start_sec"], e["end_sec"], frame) or int(e["start_sec"])
            if os.path.exists(frame(sec)):
                e["photo"] = os.path.join("photos", f"{e['no']}_{hms(sec).replace(':', '-')}.jpg")
                shutil.copy(frame(sec), os.path.join(dst, e["photo"]))
                n += 1
    with open(os.path.join(dst, "events.jsonl"), "w", encoding="utf-8") as f:
        for e in evs:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    print(f"대표 사진 {n}장 다시 고름")


if __name__ == "__main__":
    main()
