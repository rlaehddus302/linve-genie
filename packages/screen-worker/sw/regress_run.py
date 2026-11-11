# 회귀 방송(data/regress — 예전에 읽어 둔 화면 OCR + 팀원 받아쓰기)을 일꾼 결과 폴더 모양(screen.jsonl·transcript.jsonl)으로 만든다.
# 2단계 시험(sw.stage2)·run_regress가 보스다육과 같은 방식으로 읽게 하려고. 정답은 관리자 글(번호·가격)을 번호,가격,증정 CSV로.
# 사용: python -m sw.regress_run   → data/first_sellers/runs/reg_<방송>_<id>/ 와 data/regress/<방송>_<id>_truth.csv
import csv
import json
import os

from . import regress as R
from .paths import DATA, FIRST, REGRESS

SHARED = {"CTpU2iLAIdA": "럭셔리다육_20261104_정답지.csv"}   # 판매자 본인 글(품종·가격·번호)을 번호마다 하나로 정리한 것
ADMIN = {"ehT8SyVBNXY": "수정다육_20261103_ehT8SyVBNXY", "8RY2ENKI6ko": "누리다육_20261106_8RY2ENKI6ko"}


def build(label, vid, name):
    out = os.path.join(FIRST, "runs", f"reg_{name}_{vid}")
    os.makedirs(out, exist_ok=True)
    toks = {}   # R.load와 같은 거르기: 번호 모양 글자, 확신 0.5 이상, 두 번 읽기(crop·full) 합침
    for fn in ("ocr_crop.jsonl", "ocr_full.jsonl"):
        for l in open(os.path.join(R.SP, "num", vid, fn), encoding="utf-8"):
            d = json.loads(l)
            t = toks.setdefault(d["i"], [])
            for r in d["r"]:
                m = R.NUM.match(r["t"].strip())
                if m and r["c"] >= 0.5:
                    t.append([int(m.group(1)), r["x"], r["y"], r["w"], r["h"]])
    with open(os.path.join(out, "screen.jsonl"), "w", encoding="utf-8") as f:
        for i in sorted(toks):
            f.write(json.dumps({"sec": i, "t": toks[i]}) + "\n")
    with open(os.path.join(out, "transcript.jsonl"), "w", encoding="utf-8") as f:
        for r in csv.DictReader(open(os.path.join(R.SP, "stt", "tm", "work", name, "stt_team.csv"), encoding="utf-8-sig")):
            f.write(json.dumps({"start_sec": float(r["start_sec"]), "end_sec": float(r["end_sec"]), "text": r["text"]}, ensure_ascii=False) + "\n")
    tpath = os.path.join(REGRESS, f"{name}_{vid}_truth.csv")
    if vid in SHARED:   # 사람이 정리한 정답지(share/)를 그대로 쓴다
        rows = list(csv.DictReader(open(os.path.join(DATA, "..", "share", SHARED[vid]), encoding="utf-8-sig")))
        with open(tpath, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["번호", "가격", "증정", "근거"])
            for r in rows:
                w.writerow([r["번호"], r["가격"], "", f"share/{SHARED[vid]}"])
        print(label, out, tpath, f"정답 번호 {len(rows)} · 가격 있음 {sum(1 for r in rows if r['가격'])}")
        return
    price = {}
    for r in csv.DictReader(open(os.path.join(DATA, "STT테스트용_공유", ADMIN[vid], "정답_관리자번호가격.csv"), encoding="utf-8-sig")):
        for n in r["번호(파싱)"].split():
            if n.isdigit() and (int(n) not in price or (price[int(n)] is None and r["가격(파싱)"])):
                price[int(n)] = int(r["가격(파싱)"]) if r["가격(파싱)"].isdigit() else None
    with open(tpath, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["번호", "가격", "증정", "근거"])
        for n in sorted(price):
            w.writerow([n, price[n] or "", "", "관리자 채팅 글(정답_관리자번호가격.csv)"])
    print(label, out, tpath, f"정답 번호 {len(price)} · 가격 있음 {sum(1 for v in price.values() if v)}")


if __name__ == "__main__":
    for label, vid, name in R.SETS:
        if vid in ADMIN or vid in SHARED:
            build(label, vid, name)
