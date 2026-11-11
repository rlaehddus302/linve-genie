# 2단계 시험(사용자 설계 2026-11-09): 1단계(STT+OCR → 규칙) 결과를 LLM이 문맥으로 확인·보정한다.
#   조각(--chunk): ocr = 번호표 구간 앞20·뒤10초 / stt = 번호를 말한 문장 앞2·뒤4문장 / time = 번호를 처음 말한(없으면 구간 시작) 때 앞뒤 30초
#   히스토리(--history): 최근 10분 장부(등록된 번호·가격) + 아직 확인 안 된 후보(확인요청) — 있으면 빈칸 채우기도 한다
# LLM은 번호·가격을 직접 쓰지 않고 후보 목록에서 고른다("60만원"을 60000으로 쓰는 실수 방지).
# 채점(사람이 확인한 정답): 규칙=LLM일 때 정답률 / 다를 때 누가 맞나 / 물어볼 횟수 / 빈칸 채우기로 새로 찾음·잘못 채움
# 사용: python -m sw.stage2 --chunk ocr|stt|time [--history] [--limit N]   (LLM_MODEL로 모델 바꿈, 기본 Gemma 27B)
import argparse
import collections
import csv
import json
import os
import re
import time

from . import price
from . import run_regress as RR
from .decide import numbers_loose, numbers_with_beon

PROMPT = """다육식물 유튜브 라이브 판매 방송입니다. 판매자가 한 말(받아쓰기라 틀린 글자가 있음)과 그때 화면 번호표 정보를 봅니다.
{history}
[판매자가 한 말]
{lines}

[화면에 읽힌 번호표]
{screen}

자동 프로그램은 이 장면을 "{no}번, {price}"으로 등록했습니다.
이 장면에서 실제로 판 상품의 번호와 가격을 아래 후보에서 고르세요.
번호 후보: {ncands}
가격 후보: {pcands}
- 판매자가 그 상품을 말하며 정한 가격을 고릅니다. 앞뒤 다른 상품 가격, '원래 얼마짜리' 같은 지나가는 말은 고르지 마세요.
- 근거가 부족하면 0.
JSON 한 줄로만: {{"번호": 후보 번호, "가격": 후보 번호}}"""

GAP = """다육식물 유튜브 라이브 판매 방송입니다. 판매자가 한 말(받아쓰기라 틀린 글자가 있음)과 화면 번호표 정보를 봅니다.
{history}
[판매자가 한 말]
{lines}

[화면에 읽힌 번호표]
{screen}

자동 프로그램이 "{no}번"을 화면에서 봤지만 확실하지 않아 등록하지 않았습니다.
{no}번이 이 장면에서 실제로 판매된 상품입니까? 판매됐다면 가격을 후보에서 고르세요.
가격 후보: {pcands}
JSON 한 줄로만: {{"판매": true 또는 false, "가격": 후보 번호(모르면 0)}}"""


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def said(x, no):
    return no in numbers_with_beon(x) or no in numbers_loose(x)


def chunk(kind, lines, p):
    """상품 p(no, s, e)에 대해 LLM에게 줄 말 [(초, 글)]"""
    no, s, e = p["no"], p["s"], p.get("e", p["s"])
    if kind == "ocr":
        return [(t, x) for t, x in lines if s - 20 <= t <= e + 10]
    idx = [i for i, (t, x) in enumerate(lines) if s - 60 <= t <= e + 60 and said(x, no)]
    if kind == "stt":
        if not idx:
            return [(t, x) for t, x in lines if s - 20 <= t <= e + 10]
        a, b = max(0, idx[0] - 2), min(len(lines), idx[-1] + 5)
        out = lines[a:b]
        return [(t, x) for t, x in out if out[0][0] <= t <= out[0][0] + 90]   # 너무 길면 90초까지
    m = lines[idx[0]][0] if idx else s
    return [(t, x) for t, x in lines if m - 30 <= t <= m + 30]


def screen_text(screen, a, b):
    c = collections.Counter(n for sec in range(int(a), int(b) + 1) for n in {z[0] for z in screen.get(sec, [])})
    return ", ".join(f"{n}({k}초)" for n, k in c.most_common(6)) or "없음", [n for n, _ in c.most_common(6)]


def history_text(ledger, pending, t):
    rec = [x for x in ledger if t - 600 <= x["s"] < t]
    out = "[지금까지 등록된 상품(최근 10분)]\n" + ("\n".join(f"{hms(x['s'])} {x['no']}번 {x['price'] or '?'}원" for x in rec[-12:]) or "없음")
    pen = [x for x in pending if abs(x["s"] - t) <= 300]
    if pen:
        out += "\n[아직 확인 안 된 후보]\n" + "\n".join(f"{hms(x['s'])} {x['no']}번(화면만)" for x in pen[:8])
    return out + "\n"


def choose(v, cands):
    """후보 번호(1부터) → 값. LLM이 번호 대신 값을 그대로 적은 경우(\"가격\": 10000)도 후보에 있으면 받아 준다"""
    if not v or not v.isdigit():
        return None
    k = int(v)
    if 1 <= k <= len(cands):
        return cands[k - 1]
    return k if k in cands else None


def pick(out, n):
    m = re.search(r'"' + n + r'"\s*:\s*(\d+|true|false)', out)
    return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.stage2")
    ap.add_argument("--chunk", choices=["ocr", "stt", "time"], required=True)
    ap.add_argument("--history", action="store_true")
    ap.add_argument("--src", default=RR.SETS[0][0])
    ap.add_argument("--truth", default=RR.SETS[0][1])
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    model = os.environ.get("LLM_MODEL", "mlx-community/gemma-3-27b-it-4bit")
    tag = f"{a.chunk}{'+히스토리' if a.history else ''}"
    truth = {int(r["번호"]): (int(r["가격"]) if r["가격"] else None, r["증정"] == "O") for r in csv.DictReader(open(a.truth, encoding="utf-8-sig"))}
    got, rev = RR.run(a.src)
    tr = [json.loads(l) for l in open(os.path.join(a.src, "transcript.jsonl"), encoding="utf-8")]
    lines = [(d["start_sec"], d["text"]) for d in tr]
    screen = {d["sec"]: d["t"] for d in map(json.loads, open(os.path.join(a.src, "screen.jsonl"), encoding="utf-8"))}
    unit = price.seller_unit(lines)
    gen = price._generator(model)
    ledger = sorted(got, key=lambda x: x["s"])
    pending = [{"no": g["no"], "s": g["s"], "e": g["e"]} for g in rev]
    out_dir = os.path.join(os.path.dirname(a.truth), "..", "bench", "stage2")
    os.makedirs(out_dir, exist_ok=True)
    log = open(os.path.join(out_dir, f"{os.path.basename(a.src)}_{tag}.jsonl"), "w", encoding="utf-8")
    c = collections.Counter()
    t0 = time.time()
    items = ledger[: a.limit] if a.limit else ledger
    for p in items:
        L = chunk(a.chunk, lines, p)
        st, snums = screen_text(screen, L[0][0] if L else p["s"], L[-1][0] if L else p["e"])
        ncands = list(dict.fromkeys([p["no"]] + [v for _, x in L for v in numbers_with_beon(x) + numbers_loose(x) if v >= 10] + snums))[:8]
        pc = list(dict.fromkeys(([p["price"]] if p["price"] else []) + [v for _, x in L for v, _ in price.prices_said(x, unit)]))[:8]
        hist = history_text(ledger, pending, p["s"]) if a.history else ""
        txt = PROMPT.format(history=hist, lines="\n".join(f"[{hms(t)}] {x}" for t, x in L) or "(말 없음)", screen=st, no=p["no"],
                            price=f"{p['price']:,}원" if p["price"] else "가격 모름",
                            ncands=" ".join(f"{i}) {n}번" for i, n in enumerate(ncands, 1)),
                            pcands=" ".join(f"{i}) {v:,}원" for i, v in enumerate(pc, 1)) or "없음")
        ans = gen(txt, 30)
        ni, pi = pick(ans, "번호"), pick(ans, "가격")
        lno, lpr = choose(ni, ncands), choose(pi, pc)
        tno = p["no"] in truth
        tpr = truth.get(p["no"], (None, False))[0]
        if tpr is None:   # 정답지에 가격이 없으면 맞다·틀리다를 셀 수 없다(누리다육 관리자 글엔 가격이 아예 없었음) — 따로 센다
            c["정답가격없음"] += 1
        rule_ok = tno and tpr is not None and p["price"] == tpr
        llm_ok = lno == p["no"] and tno and tpr is not None and lpr == tpr if lno else False
        agree = lno == p["no"] and lpr == p["price"]
        c["상품"] += 1
        c["같음"] += agree
        c["같음_규칙맞음"] += agree and rule_ok
        c["다름"] += not agree
        c["다름_규칙맞음"] += (not agree) and rule_ok
        c["다름_LLM맞음"] += (not agree) and llm_ok
        log.write(json.dumps({"no": p["no"], "s": p["s"], "rule": p["price"], "llm_no": lno, "llm_price": lpr, "truth": tpr, "in_truth": tno, "ans": ans}, ensure_ascii=False) + "\n")
        log.flush()
    if a.history:
        for g in pending:
            L = chunk(a.chunk, lines, g)
            st, _ = screen_text(screen, L[0][0] if L else g["s"], L[-1][0] if L else g["e"])
            pc = list(dict.fromkeys(v for _, x in L for v, _ in price.prices_said(x, unit)))[:8]
            txt = GAP.format(history=history_text(ledger, pending, g["s"]), lines="\n".join(f"[{hms(t)}] {x}" for t, x in L) or "(말 없음)",
                             screen=st, no=g["no"], pcands=" ".join(f"{i}) {v:,}원" for i, v in enumerate(pc, 1)) or "없음")
            ans = gen(txt, 30)
            sold = pick(ans, "판매") == "true"
            gpr = choose(pick(ans, "가격"), pc)
            real = g["no"] in truth and g["no"] not in {x["no"] for x in ledger}
            c["빈칸후보"] += 1
            c["빈칸_판매라함"] += sold
            c["빈칸_판매라함_맞음"] += sold and real
            c["빈칸_실제있음"] += real
            log.write(json.dumps({"gap": g["no"], "s": g["s"], "sold": sold, "price": gpr, "real": real, "truth": truth.get(g["no"], (None,))[0], "ans": ans}, ensure_ascii=False) + "\n")
    n = c["상품"]
    line = (f"[{os.path.basename(a.src)} {tag}] 상품 {n} | 같음 {c['같음']} ({c['같음'] / max(1, n):.0%}) 그중 규칙 맞음 {c['같음_규칙맞음']} | "
            f"다름(물어봄) {c['다름']}: 규칙 맞음 {c['다름_규칙맞음']} · LLM 맞음 {c['다름_LLM맞음']} | 정답 가격 없음 {c['정답가격없음']}")
    if a.history:
        line += f" | 빈칸 후보 {c['빈칸후보']}: 판매라 함 {c['빈칸_판매라함']}(맞음 {c['빈칸_판매라함_맞음']}) · 실제 있던 것 {c['빈칸_실제있음']}"
    line += f" | {time.time() - t0:.0f}초"
    print(line, flush=True)
    open(os.path.join(out_dir, "score.txt"), "a", encoding="utf-8").write(line + "\n")


if __name__ == "__main__":
    main()
