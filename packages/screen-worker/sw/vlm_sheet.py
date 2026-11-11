# OCR 시험지(690장, data/ocr_test_690)를 이미지 이해 AI(Qwen2.5-VL)로 읽어 Apple Vision과 같은 기준으로 채점
#  - 정답 읽음: 그 장면에서 읽은 번호들 안에 정답 번호가 있음
#  - 틀린 번호만 읽음: 번호를 읽었는데 정답이 없음(다른 번호로 잘못 등록될 위험)
# 사용: python -m sw.vlm_sheet [모델]
import csv
import json
import os
import re
import sys
import time

from .paths import OCR_SHEET as D
Q = ("이 사진은 다육식물 판매 방송 화면입니다. 화분에 꽂힌 흰색 번호표(상품 번호)에 적힌 숫자를 모두 적으세요. "
     "전화번호나 화면 글씨는 빼고, 번호표 숫자만 쉼표로 구분해 적으세요. 번호표가 없으면 '없음'.")


def score(name, reads, labels):
    ok = sum(labels[f] in r for f, r in reads.items())
    wrong = sum(bool(r) and labels[f] not in r for f, r in reads.items())
    none = sum(not r for r in reads.values())
    n = len(reads)
    print(f"{name:14} {n}장 | 정답 읽음 {ok} ({ok / n:.1%}) | 틀린 번호만 읽음 {wrong} ({wrong / n:.1%}) | 아무것도 못 읽음 {none}", flush=True)


def main():
    mp = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"
    labels = {r["file"]: int(r["answer"]) for r in csv.DictReader(open(os.path.join(D, "labels.csv"), encoding="utf-8-sig"))}
    apple = {r["file"]: [int(x) for x in r["all_numbers"].split()] for r in csv.DictReader(open(os.path.join(D, "apple_vision_result.csv"), encoding="utf-8-sig"))}
    score("Apple Vision", apple, labels)
    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template
    from mlx_vlm.utils import load_config
    model, proc = load(mp)
    cfg = load_config(mp)
    prompt = apply_chat_template(proc, cfg, Q, num_images=1)
    out_path = os.path.join(D, f"vlm_{mp.split('/')[-1]}.jsonl")
    done = {}
    if os.path.exists(out_path):
        done = {d["file"]: d["nums"] for d in map(json.loads, open(out_path))}
    t0 = time.time()
    with open(out_path, "a") as o:
        for k, f in enumerate(labels):
            if f in done:
                continue
            r = generate(model, proc, prompt, [os.path.join(D, "images", f)], max_tokens=24, verbose=False)
            txt = r.text if hasattr(r, "text") else r
            nums = [int(x) for x in re.findall(r"\d{1,3}", txt)]
            done[f] = nums
            o.write(json.dumps({"file": f, "text": txt.strip(), "nums": nums}, ensure_ascii=False) + "\n")
            o.flush()
            if k % 100 == 0:
                print(k, f"{(time.time() - t0) / max(1, len(done)):.1f}초/장", flush=True)
    score(mp.split("/")[-1], {f: done[f] for f in labels}, labels)
    score("Apple(같은 장)", {f: apple[f] for f in labels}, labels)


if __name__ == "__main__":
    main()
