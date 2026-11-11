# 일꾼 결과(events.jsonl) → 앱에 등록될 상품 목록(번호·품종·가격) 표와 CSV
# 사용: python -m sw.listing <결과 폴더>   → 화면에 표, <결과 폴더>/상품목록.csv
import csv
import json
import os
import sys


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def main():
    run = sys.argv[1]
    ev = [json.loads(l) for l in open(os.path.join(run, "events.jsonl"), encoding="utf-8")]
    items, price, name = {}, {}, {}
    for e in ev:
        k, key = e.get("kind"), (e.get("no"), e.get("start_sec"))
        if k in ("확정", "확인요청"):
            items[key] = dict(e)
        elif k == "확정취소":
            items.pop(key, None)
        elif k == "금액":
            price[key] = e
        elif k == "품종":
            n = e.get("name")
            name[key] = None if not n or str(n).lower() in ("null", "none", "모름") else n
    conf = sorted((v for v in items.values() if v["kind"] == "확정"), key=lambda v: v["start_sec"])
    # 이미 앞에서 등록된 번호의 확인요청은 묻지 않음(sw/decide.py와 같은 규칙)
    rev = sorted((v for v in items.values() if v["kind"] == "확인요청"
                  and not any(c["no"] == v["no"] and c["start_sec"] < v["start_sec"] for c in conf)), key=lambda v: v["start_sec"])

    def won(key):
        p = price.get(key)
        if not p or p.get("pick") is None:
            return "", ""
        note = "" if p.get("agree") else "확인 필요(후보 " + ", ".join(f"{c:,}" for c in p.get("candidates", [])) + ")"
        return f"{p['pick']:,}", note

    rows = []
    for v in conf:
        key = (v["no"], v["start_sec"])
        w, note = won(key)
        rows.append([hms(v["start_sec"]), v["no"], name.get(key) or "", w, "자동 등록", note])
    # 확인요청도 판매자가 확인할 때 바로 누를 수 있게 가격을 미리 채운다(같은 규칙: 횟수 + 번호와 같은 문장)
    from . import price
    tp = os.path.join(run, "transcript.jsonl")
    lines = [(d["start_sec"], d["text"]) for d in map(json.loads, open(tp, encoding="utf-8"))] if os.path.exists(tp) else []
    unit = price.seller_unit(lines)
    for v in rev:
        win = price.trim([(t, x) for t, x in lines if v["start_sec"] - 20 <= t <= v["end_sec"] + 10], v["no"])
        p = price.rule(win, v["no"], unit)
        rows.append([hms(v["start_sec"]), v["no"], "", f"{p:,}" if p else "", "판매자 확인 필요", v.get("why", "")])
    with open(os.path.join(run, "상품목록.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["시각", "번호", "품종", "가격", "상태", "참고"])
        w.writerows(rows)
    print(f"자동 등록 {len(conf)}개 · 판매자 확인 필요 {len(rev)}개 → {os.path.join(run, '상품목록.csv')}")
    print("| 시각 | 번호 | 품종 | 가격 | 참고 |\n|---|---|---|---|---|")
    for r in rows[:len(conf)]:
        print(f"| {r[0]} | {r[1]} | {r[2] or '-'} | {r[3] or '-'} | {r[5]} |")
    print("\n확인 필요:", ", ".join(f"{r[1]}번({r[0]})" for r in rows[len(conf):]))


if __name__ == "__main__":
    main()
