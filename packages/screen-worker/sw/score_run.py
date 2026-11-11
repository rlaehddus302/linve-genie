# 일꾼 결과 폴더(events.jsonl)를 정답 CSV(번호, 가격, 증정)로 채점하고 오답을 하나씩 보여 준다 — 일꾼이 실제로 낸 그대로(다시 계산하지 않음).
# 번호: 확정(확정취소 뺌)이 정답에 있으면 맞음, 없으면 틀린 확정. 정답인데 확정 못 한 것은 놓침(확인요청으로 물었는지 따로).
# 금액: 확정·정답 가격 있는 상품만. 일꾼이 고른 값(pick) / 규칙만(rule) / LLM(llm)을 따로 센다.
# 사용: python -m sw.score_run <결과 폴더> <정답.csv> [<결과 폴더> <정답.csv> …]
import csv
import json
import os
import sys


def won(v):
    return "없음" if v is None else f"{v:,}"


def final(E):
    """확정 → 확정취소 → 다시 확정처럼 오간 번호는 마지막 상태로 본다(같은 번호·같은 시작 초)"""
    last = {}
    for e in E:
        if e.get("kind") in ("확정", "확정취소"):
            last[(e["no"], e["start_sec"])] = e
    return [e for e in last.values() if e["kind"] == "확정"]


def score(run, truth_csv):
    T = {int(r["번호"]): (int(r["가격"]) if r["가격"] else None, r.get("증정") == "O") for r in csv.DictReader(open(truth_csv, encoding="utf-8-sig"))}
    E = [json.loads(l) for l in open(os.path.join(run, "events.jsonl"), encoding="utf-8")]
    E = [e for e in E if e.get("by") != "resend"]
    conf = final(E)
    asked = {e["no"] for e in E if e.get("kind") == "확인요청"}
    pr = {}
    for e in E:
        if e.get("kind") == "금액":
            pr.setdefault((e["no"], e["start_sec"]), e)
            pr.setdefault(e["no"], e)
    name = {e["no"]: e.get("name") for e in E if e.get("kind") == "품종"}
    got = {}
    for e in conf:
        got.setdefault(e["no"], e)
    right = [n for n in got if n in T]
    wrong = sorted(n for n in got if n not in T)
    missed = sorted(n for n in T if n not in got)
    print(f"\n== {os.path.basename(run.rstrip('/'))}  (정답 {len(T)}상품)")
    print(f"번호: 확정 {len(got)} → 맞음 {len(right)} · 틀린 확정 {len(wrong)} | 놓침 {len(missed)} (그중 확인요청으로 물어봄 {sum(n in asked for n in missed)})"
          + (f" | 같은 번호 두 번 확정 {len(conf) - len(got)}" if len(conf) > len(got) else ""))
    c = {"n": 0, "pick": 0, "rule": 0, "llm": 0, "norule": 0, "norule_pick": 0, "agree": 0, "agree_ok": 0}
    bad = []
    for n in sorted(right):
        tp = T[n][0]
        p = pr.get((n, got[n]["start_sec"])) or pr.get(n)
        if tp is None or p is None:
            continue
        c["n"] += 1
        c["pick"] += p["pick"] == tp
        c["rule"] += p["rule"] == tp
        c["llm"] += p["llm"] == tp
        c["agree"] += bool(p.get("agree"))
        c["agree_ok"] += bool(p.get("agree")) and p["pick"] == tp
        if p["rule"] is None:
            c["norule"] += 1
            c["norule_pick"] += p["pick"] == tp
        if p["pick"] != tp:
            bad.append((n, got[n]["start_hms"], tp, p))
    n = max(1, c["n"])
    print(f"금액({c['n']}상품): 일꾼이 고른 값 {c['pick']} ({c['pick'] / n:.1%}) | 규칙만 {c['rule']} · LLM만 {c['llm']} | "
          f"규칙이 못 찾아 LLM·흔한 가격으로 채움 {c['norule']}(맞음 {c['norule_pick']}) | 규칙=LLM이라 '확인 필요' 안 붙음 {c['agree']}(맞음 {c['agree_ok']})")
    print("-- 틀린 확정(정답에 없는 번호):")
    for x in wrong:
        e = got[x]
        print(f"   {x}번  {e['start_hms']}  {e.get('why', '')}  화면{e.get('image_reads')} 음성{e.get('voice')}")
    print("-- 놓친 번호:", ", ".join(f"{x}{'(물어봄)' if x in asked else ''}" for x in missed) or "없음")
    print("-- 금액 틀림:")
    for x, hms, tp, p in bad:
        print(f"   {x}번  {hms}  정답 {won(tp)} ← 일꾼 {won(p['pick'])} (규칙 {won(p['rule'])}, LLM {won(p['llm'])}, {'확인 필요 없음' if p.get('agree') else '확인 필요'})"
              f"  후보 {' / '.join(won(v) for v in p.get('candidates') or [])}  {name.get(x) or ''}")
    return c


if __name__ == "__main__":
    a = sys.argv[1:]
    for i in range(0, len(a), 2):
        score(a[i], a[i + 1])
