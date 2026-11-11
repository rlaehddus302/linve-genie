# 일꾼 결과 폴더 하나를 정답 CSV와 맞춰 상품마다 한 줄씩, 생략 없이 엑셀로 쓴다.
# 한 줄 = 정답 / 일꾼 판정(확정·확인요청·놓침·틀린 확정)과 이유 / OCR이 그 번호를 읽은 초 / 받아쓰기에서 그 번호를 들은 문장 /
#        금액(규칙·LLM·고른 값·후보·LLM 답 원문·금액을 정할 때 쓴 말 전부) / 품종(LLM 답 원문).
# 사용: python -m sw.report_run <엑셀 경로> <결과 폴더> <정답.csv> [<결과 폴더> <정답.csv> …]
#   정답 CSV: 번호, 가격 (+ 증정 또는 메모) — share/ 정답지 그대로 쓸 수 있다
import collections
import csv
import json
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from .decide import numbers_loose, numbers_with_beon
from .score_run import final


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def won(v):
    return "" if v is None else f"{v:,}"


def spans(secs):
    """[초…] → '0:09:02~0:09:40(39초), …'"""
    out, run = [], []
    for s in sorted(secs):
        if run and s - run[-1] > 3:
            out.append(run)
            run = []
        run.append(s)
    if run:
        out.append(run)
    return ", ".join(f"{hms(r[0])}~{hms(r[-1])}({len(r)}초)" for r in out)


def load(run, truth_csv):
    T = {}
    for r in csv.DictReader(open(truth_csv, encoding="utf-8-sig")):
        memo = r.get("메모") or ("증정" if r.get("증정") == "O" else "")
        T[int(r["번호"])] = (int(r["가격"]) if r["가격"] else None, memo)
    E = [json.loads(l) for l in open(os.path.join(run, "events.jsonl"), encoding="utf-8")]
    E = [e for e in E if e.get("by") != "resend"]
    seen = collections.defaultdict(list)          # 번호 → OCR이 읽은 초
    for l in open(os.path.join(run, "screen.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        for n in {z[0] for z in d["t"]}:
            seen[n].append(d["sec"])
    said = collections.defaultdict(list)          # 번호 → 받아쓰기에서 그 번호가 나온 문장
    for l in open(os.path.join(run, "transcript.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        x = d["text"]
        for n in set(numbers_with_beon(x)) | set(numbers_loose(x)):
            said[n].append(f"[{hms(d['start_sec'])}] {x}")
    dec = collections.defaultdict(list)
    p = os.path.join(run, "decisions.csv")
    if os.path.exists(p):
        for r in csv.DictReader(open(p, encoding="utf-8-sig")):
            dec[int(r["number"])].append(f"{hms(float(r['start_sec']))}~{hms(float(r['end_sec']))} {r['status']}: {r['reason']} "
                                         f"| 화면 후보 {r['image_candidates']} | 음성 {r['voice_mentions'] or '없음'}")
    return T, E, seen, said, dec


COLS = ["번호", "정답 가격", "정답 메모", "일꾼 결과", "번호 맞음", "가격 맞음",
        "번호 판단(일꾼 기록: 시각·이유·화면 읽은 횟수·음성 횟수)", "판정 구간 전부(decisions.csv)",
        "OCR: 화면에서 이 번호를 읽은 때", "STT: 이 번호를 말한 문장 전부",
        "일꾼 가격", "규칙 가격", "LLM 가격", "규칙=LLM(확인 필요 없음)", "가격 후보", "LLM 가격 답 원문",
        "금액 정할 때 쓴 말(STT) 전부", "품종", "LLM 품종 답 원문"]


def rows(run, truth_csv):
    T, E, seen, said, dec = load(run, truth_csv)
    alive = {(e["no"], e["start_sec"]) for e in final(E)}
    by = collections.defaultdict(list)
    for e in E:
        if "no" in e:
            by[e["no"]].append(e)
    nums = sorted(set(T) | {n for n, es in by.items() if any(e["kind"] in ("확정", "확인요청") for e in es)})
    out, tally = [], collections.Counter()
    for n in nums:
        es = by.get(n, [])
        conf = [e for e in es if e["kind"] == "확정" and (n, e["start_sec"]) in alive]
        asked = [e for e in es if e["kind"] == "확인요청"]
        tp, memo = T.get(n, (None, ""))
        if conf:
            res = "확정" if n in T else "틀린 확정(정답에 없음)"
        elif asked:
            res = "확인요청(판매자에게 물음)" if n in T else "확인요청(정답에 없음)"
        else:
            res = "놓침" if n in T else ""
        judge = "\n".join(f"{e['kind']} {e['start_hms']} ({e.get('why', '')}) 화면{e.get('image_reads') or {}} 음성{e.get('voice') or {}}"
                          for e in es if e["kind"] in ("확정", "확인요청", "확정취소"))
        pr = next((e for e in es if e["kind"] == "금액" and conf and e["start_sec"] == conf[0]["start_sec"]), None) \
            or next((e for e in es if e["kind"] == "금액"), None)
        va = next((e for e in es if e["kind"] == "품종"), None)
        n_ok = "O" if conf and n in T else ("X" if conf else "")
        p_ok = ""
        if conf and n in T and pr and tp is not None:
            p_ok = "O" if pr["pick"] == tp else "X"
        tally[res] += 1
        tally["가격 " + p_ok] += bool(p_ok)
        out.append([n, won(tp), memo, res, n_ok, p_ok, judge, "\n".join(dec.get(n, [])),
                    spans(seen.get(n, [])), "\n".join(said.get(n, [])),
                    won(pr["pick"]) if pr else "", won(pr["rule"]) if pr else "", won(pr["llm"]) if pr else "",
                    ("예" if pr["agree"] else "아니오(확인 필요)") if pr else "",
                    " / ".join(won(v) for v in pr.get("candidates") or []) if pr else "",
                    (pr.get("llm_answer") or "") if pr else "",
                    "\n".join(f"[{hms(t)}] {x}" for t, x in pr.get("heard") or []) if pr else "",
                    (va.get("name") or "") if va else "", (va.get("llm_answer") or "") if va else ""])
    return out, tally


def main():
    path, a = sys.argv[1], sys.argv[2:]
    wb = Workbook()
    summ = wb.active
    summ.title = "요약"
    summ.append(["방송", "결과 폴더", "정답 상품", "확정(맞음)", "틀린 확정", "확인요청(정답 있음)", "놓침", "가격 맞음", "가격 틀림"])
    bold, wrap = Font(bold=True), Alignment(wrap_text=True, vertical="top")
    red = PatternFill("solid", fgColor="FFD9D9")
    for i in range(0, len(a), 2):
        run, truth = a[i], a[i + 1]
        name = os.path.basename(run.rstrip("/"))[:28]
        rs, t = rows(run, truth)
        summ.append([name, run, sum(1 for r in rs if r[1] or r[2] or r[3] in ("확정", "놓침", "확인요청(판매자에게 물음)")),
                     t["확정"], t["틀린 확정(정답에 없음)"], t["확인요청(판매자에게 물음)"], t["놓침"], t["가격 O"], t["가격 X"]])
        ws = wb.create_sheet(name)
        ws.append(COLS)
        for c in ws[1]:
            c.font = bold
        for r in rs:
            ws.append(r)
            if r[3] != "확정" or r[5] == "X":
                for c in ws[ws.max_row]:
                    c.fill = red
        widths = [6, 9, 12, 16, 6, 6, 45, 45, 35, 60, 9, 9, 9, 12, 20, 16, 80, 12, 25]
        for j, w in enumerate(widths):
            ws.column_dimensions[chr(65 + j)].width = w
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = wrap
        ws.freeze_panes = "B2"
    for c in summ[1]:
        c.font = bold
    wb.save(path)
    print(path)


if __name__ == "__main__":
    main()
