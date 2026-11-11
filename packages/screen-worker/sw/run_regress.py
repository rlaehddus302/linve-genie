# 정답 있는 일꾼 결과 폴더 채점(LLM 없이 규칙만): 저장된 화면 읽기·받아쓰기로 판정 + 금액 규칙을 다시 돌려 사람 확인 정답과 맞춘다.
# 정답 CSV: 번호, 가격, 증정(O) — 예: data/regress/boss_flK4emzquko_truth.csv (사장님이 영상으로 확인, 2026-11-09)
# 사용: python -m sw.run_regress [결과 폴더 정답.csv] …   (없으면 보스다육 11/8)
import csv
import json
import os
import sys

from . import price
from .decide import decide, loose_at, numbers_priced
from .screen import Screen

from .paths import FIRST, REGRESS
SETS = [(os.path.join(FIRST, "runs", "bossfinal_flK4emzquko"), os.path.join(REGRESS, "boss_flK4emzquko_truth.csv"))]


def run(src, chat=()):
    sc = Screen()
    for l in open(os.path.join(src, "screen.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        sc.add(d["sec"], [tuple(z) for z in d["t"]])
    tr = [json.loads(l) for l in open(os.path.join(src, os.environ.get("TRANSCRIPT", "transcript.jsonl")), encoding="utf-8")]
    from .decide import numbers_with_beon
    voice = sorted((d["start_sec"], v) for d in tr for v in numbers_with_beon(d["text"]))
    loose = sorted(x for d in tr for x in loose_at(d["start_sec"], d.get("end_sec", d["start_sec"]), d["text"]))
    lines = [(d["start_sec"], d["text"]) for d in tr]
    segs, cand_sec, mains = sc.build()
    priced = sorted((d["start_sec"], v) for d in tr for v in numbers_priced(d["text"]))
    items = decide(segs, cand_sec, voice, loose=loose, chat=chat, priced=priced)
    unit = price.seller_unit(lines)
    known = {g["img"] for g in segs} | {g["no"] for g in items}
    owner = os.environ.get("PRICE_OWNER") == "1"
    screen_on = bool(os.environ.get("PRICE_OWNER"))
    price.use_screen(mains if screen_on else None, known)
    typ, com = price.typical(lines), price.common(lines)
    out = []
    for g in items:
        if not g["auto"]:
            continue
        if owner:   # 주인으로 가르니 시간 틀은 넓게, 자르지 않음
            win = [(t, x) for t, x in lines if g["s"] - 60 <= t <= g["e"] + 30]
        else:
            win = price.trim([(t, x) for t, x in lines if g["s"] - 20 <= t <= g["e"] + 10], g["no"], known)
        p, check = price.fill(price.rule(win, g["no"], unit), typ, com)
        out.append({"no": g["no"], "s": g["s"], "e": g["e"], "price": p, "check": check, "why": g["why"]})
    rev = [g for g in items if not g["auto"] and not g.get("noise")]
    return out, rev


def main():
    sets = [tuple(sys.argv[i:i + 2]) for i in range(1, len(sys.argv), 2)] or SETS
    for src, tp in sets:
        truth = {int(r["번호"]): (int(r["가격"]) if r["가격"] else None, r["증정"] == "O") for r in csv.DictReader(open(tp, encoding="utf-8-sig"))}
        got, rev = run(src)
        g, filled = {}, set()
        for x in got:
            if x["no"] not in g and x["check"] and x["price"] is not None:
                filled.add(x["no"])
            g.setdefault(x["no"], x["price"])
        pk = [n for n, (p, gift) in truth.items() if p and not gift]
        # 흔한 가격으로 채운 것(못 찾았거나 이상한 값)은 맞아도 '찾은 가격'으로 세지 않는다
        pok = sum(g.get(n) == truth[n][0] and n not in filled for n in pk)
        wrong = [(n, g.get(n), truth[n][0]) for n in pk if n in g and g[n] != truth[n][0]]
        print(f"{os.path.basename(src)}: 번호 {len(set(g) & set(truth))}/{len(truth)} | 없는 번호 {sorted(set(g) - set(truth))} | 놓침 {sorted(set(truth) - set(g))} | "
              f"가격(직접 찾음) {pok}/{len(pk)} · 흔한 값으로 채움 {len(filled & set(pk))} | 확인요청 {len(rev)}")
        print(f"  틀린 가격(번호, 우리, 정답): {wrong}")


if __name__ == "__main__":
    main()
