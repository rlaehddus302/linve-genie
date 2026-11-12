# B6 시험(사용자 2026-11-10): 인스트럭트GPT식 시스템 프롬프트(sw/prompts/sales_instruct_system.txt)만으로 잘 뽑는지.
# 시스템 = 그 파일 그대로(codex 기본 지시를 model_instructions_file로 갈아끼움), 사용자 = 2분 조각 줄들(L줄번호 [시각] (화면: 번호표) 말).
# 뒤처리 없음: 화면 구간 다시 묻기·화면으로 번호 채우기·화면 검증 모두 안 함 — 시스템 프롬프트 하나의 실력만 봄.
# 사용: OPENAI_MODEL=gpt-5.6-sol EFFORT=medium [RUN_DIR=결과폴더] python -m sw.llm_b6 보스
import collections
import concurrent.futures as cf
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import time

from . import llm_b4 as B
from . import llm_b5 as B5
from .llm_ocr import screen_of
from .paths import FIRST
from .rescore import SETS
from .score_run import final

HERE = os.path.dirname(os.path.abspath(__file__))
SYS_NAME = os.environ.get("SYS_PROMPT", "sales_instruct_system.txt")
SYS = os.path.join(HERE, "prompts", SYS_NAME)   # SYS_PROMPT=sales_instruct_system_v2.txt 등
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.6-sol")
EFFORT = os.environ.get("EFFORT", "medium")
SCREEN = os.environ.get("SCREEN", "start")   # start = 줄 시작 앞1~뒤3초 화면(예전) / span = 줄 시작~끝 전체 화면
TAG = ("" if SCREEN == "start" else "span_") + re.sub(r"[^A-Za-z0-9.-]", "_", MODEL) + "_" + EFFORT + ("" if os.path.basename(SYS) == "sales_instruct_system.txt" else "_" + os.path.basename(SYS)[len("sales_instruct_system_"):-4]) \
    + ("" if B5.TR == "transcript.jsonl" else "_" + B5.TR[len("transcript_"):-len(".jsonl")])   # TRANSCRIPT=transcript_<이름>.jsonl 이면 결과 파일도 따로
EMPTY = os.path.join(HERE, "..", "runs", "codex_empty")


def ask_claude(user, sys_path=None, model=None, effort=None):
    """Claude 모델(BACKEND=claude, 2026-11-11 모델 비교): claude CLI -p, 시스템 프롬프트는 이 파일로 통째 바꾸고 도구 끔, 빈 폴더에서"""
    os.makedirs(EMPTY, exist_ok=True)
    for k in range(4):
        r = subprocess.run(["claude", "-p", "--model", model or MODEL, "--effort", effort or EFFORT, "--system-prompt-file", sys_path or SYS, "--tools", "",
                            "--no-session-persistence", "--output-format", "text"],
                           input=user, text=True, capture_output=True, cwd=EMPTY, timeout=900)
        if r.returncode == 0:   # 빈 답 = 내놓은 상품 없음(프롬프트 출력형식), 실패 아님
            return r.stdout
        time.sleep(10 * (k + 1))
    raise RuntimeError(f"claude 실패: {r.stderr[-300:]}")


def ask(user, sys_path=None, model=None, effort=None):
    """시스템 프롬프트 파일·모델·노력은 안 주면 이 모듈 설정(환경변수)대로 — sw.llm_live가 지식판2로 부름"""
    if os.environ.get("BACKEND") == "claude":
        return ask_claude(user, sys_path, model, effort)
    os.makedirs(EMPTY, exist_ok=True)
    for k in range(4):
        with tempfile.NamedTemporaryFile("r", suffix=".txt", delete=False) as f:
            out_p = f.name
        r = subprocess.run(["codex"] + (["--search"] if os.environ.get("WEB_SEARCH") else []) + ["exec", "-m", model or MODEL, "-c", f"model_reasoning_effort={effort or EFFORT}", "-c", f"model_instructions_file={sys_path or SYS}",
                            "--skip-git-repo-check", "-s", "read-only", "-o", out_p, "-"],
                           input=user, text=True, capture_output=True, cwd=EMPTY, timeout=900)
        out = open(out_p, encoding="utf-8").read() if os.path.exists(out_p) else ""
        os.unlink(out_p)
        if r.returncode == 0:
            return out
        time.sleep(10 * (k + 1))
    raise RuntimeError(f"codex 실패: {r.stderr[-300:]}")


def shorthand_price(quote, text):
    """모델이 판매가로 지목한 원문이 그 줄에 독립된 한두 자리 수로 있을 때만 만원으로 환산한다."""
    if not isinstance(quote, str) or not text:
        return None
    digits = "일이삼사오육칠팔구"
    raw = "".join(quote.split())
    if re.fullmatch(r"[1-9][0-9]?", raw):
        value = int(raw)
    elif re.fullmatch(r"[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]", raw):
        tens, sep, ones = raw.partition("십")
        value = ((digits.index(tens) + 1 if tens else 1) * 10 if sep else 0)
        last = ones if sep else tens
        if last:
            value += digits.index(last) + 1
    else:
        return None
    # 숫자의 일부, '35 번', '35,000원', '35 개', '35 센티' 등은 금액 근거가 될 수 없다.
    literal = re.escape(quote.strip())
    if re.search(r"(?<![\w.,])" + literal + r"(?![0-9]|[.,][0-9]|\s*(?:번|원|천|백|만|개|호|센티|cm|프로|%|명|분|초|세트))(?=$|[\s.,!?]|까지|에|짜리|입니다|예요|이고)", text, re.I):
        return value * 10000
    return None


def rows_of(out, L):
    """답 → [{t, line, no, price, name, no_from, confidence, why}] (B.parse와 같은 거름 + 나머지 칸)"""
    ids = {i: t for i, t, _ in L}
    texts = {i: text for i, _, text in L}
    got = []
    for m in re.finditer(r"\{[^{}]*\}", out):
        try:
            d = json.loads(m.group(0))
        except ValueError:
            continue
        li = d.get("line")
        li = int(str(li).lstrip("Ll")) if li is not None and str(li).lstrip("Ll").isdigit() else None
        if li not in ids:
            continue
        no = d.get("no")
        no = int(str(no).rstrip("번").strip()) if no is not None and str(no).rstrip("번").strip().isdigit() else None
        no = no if no is not None and 0 < no < 1000 else None
        p = d.get("price")
        p = int(str(p).replace(",", "")) if p is not None and str(p).replace(",", "").isdigit() and int(str(p).replace(",", "")) > 0 else None
        price_line = str(d.get("price_line", "")).lstrip("Ll")
        if p is not None and price_line.isdigit():
            spoken = shorthand_price(d.get("price_short"), texts.get(int(price_line)))
            if spoken is not None and p in (spoken // 10000, spoken // 10):
                p = spoken
        if no is None and p is None:
            continue
        nm = d.get("name")
        got.append({"t": ids[li], "line": li, "no": no, "price": p, "variety": nm.strip() if isinstance(nm, str) and nm.strip() else None,
                    "no_from": d.get("no_from"), "confidence": d.get("confidence"), "why": d.get("why")})
    return got


def main():
    k = sys.argv[1] if len(sys.argv) > 1 else "보스"
    r, tr = {a: (b, c) for a, b, c in SETS}[k]
    run = os.environ.get("RUN_DIR") or os.path.join(FIRST, "runs", r)   # RUN_DIR = 영상에서 새로 뽑은 결과 폴더
    T = B5.truth(tr)
    stt = B5.load_stt(run)
    cand, mains = screen_of(run)
    cp = os.path.join(run, f"llm_b6_{TAG}.json")
    cache = json.load(open(cp, encoding="utf-8")) if os.path.exists(cp) else {}
    C = B.chunks(stt)
    t0 = time.time()

    ends = [d["end_sec"] for d in map(json.loads, open(os.path.join(run, B5.TR), encoding="utf-8"))]

    def span_note(i, t):
        """줄 시작~끝 동안 화면: 가장 크게 읽힌 번호를 처음 나온 순서대로 초 수와 함께, 그다음 크게는 아니지만 보인 번호 3개"""
        secs = range(int(t) - 1, int(ends[i]) + 2)
        big = collections.Counter(mains[x] for x in secs if mains.get(x) is not None)
        order = list(dict.fromkeys(mains[x] for x in secs if mains.get(x) is not None))
        other = collections.Counter(n for x in secs for n in set(cand.get(x, ())) if n not in big)
        parts = [f"{n} 크게 {big[n]}초" for n in order]
        rest = [str(n) for n, _ in other.most_common(3)]
        return (", ".join(parts) + (" / " + ", ".join(rest) if rest else "")) if parts or rest else "없음"

    def user_of(L):
        if SCREEN == "span":
            return "\n".join(f"L{i} [{B.hms(t)}] (화면: {span_note(i, t)}) {B.mask(x)}" for i, t, x in L)
        return "\n".join(f"L{i} [{B.hms(t)}] (화면: {B.screen_note(t, cand, mains)}) {B.mask(x)}" for i, t, x in L)
    todo = [(s, L) for s, L in C if str(s) not in cache]
    print(f"== {k} · {MODEL} {EFFORT} · 조각 {len(C)}개 중 새로 물을 것 {len(todo)}개", flush=True)
    log = open(os.path.join(run, f"llm_b6_{TAG}_log.jsonl"), "a", encoding="utf-8")

    def one(sL):
        s, L = sL
        u = user_of(L)
        return s, u, ask(u)
    done = 0
    with cf.ThreadPoolExecutor(int(os.environ.get("LLM_PAR", 4))) as ex:
        for s, u, out in ex.map(one, todo):
            cache[str(s)] = out
            json.dump(cache, open(cp, "w", encoding="utf-8"), ensure_ascii=False)
            log.write(json.dumps({"chunk": s, "user": u, "answer": out}, ensure_ascii=False) + "\n"); log.flush()
            done += 1
            if done % 10 == 0:
                print(f"    {done}/{len(todo)} ({time.time() - t0:.0f}초)", flush=True)
    found = []
    for s, L in C:
        found += rows_of(cache[str(s)], L)
    # 뒤처리 없음(사용자 2026-11-10): LLM 원답 그대로. 화면으로 번호 채우기·화면 검증 안 함.
    # 남긴 것: 번호 없는 줄은 등록할 수 없어 뺌(개수만 셈) / 같은 번호가 여러 줄이면 상품 하나로(조각 30초 겹침·다시 말함)
    #          그 번호의 가격 = LLM이 그 번호에 적은 가격 중 가장 많이 나온 것, 같으면 먼저 나온 것
    by = {}
    for f in sorted(found, key=lambda f: f["t"]):
        if f["no"] is None:
            continue
        g = by.setdefault(f["no"], {"no": f["no"], "t": f["t"], "prices": [], "names": [], "n": 0})
        g["n"] += 1
        if f["price"]:
            g["prices"].append(f["price"])
        if f["variety"]:
            g["names"].append(f["variety"])
    for g in by.values():
        g["price"] = collections.Counter(g["prices"]).most_common(1)[0][0] if g["prices"] else None
        g["variety"] = collections.Counter(g["names"]).most_common(1)[0][0] if g["names"] else None
    got = sorted(by.values(), key=lambda g: g["t"])
    ok = set(by)
    right, wrong = ok & set(T), ok - set(T)
    pn = [n for n in right if T[n][0] is not None]
    vn = [n for n in right if T[n][1]]
    print(f"\n== {k} 결과 · {SYS_NAME} · {MODEL} {EFFORT} · LLM 줄 {len(found)} (번호 없는 줄 {sum(f['no'] is None for f in found)}개는 뺌) · {time.time() - t0:.0f}초")
    s = (f"  번호: 맞게 {len(right)}/{len(T)} · 틀림 {len(wrong)} {sorted(wrong)[:20]} · 놓침 {len(set(T) - ok)} {sorted(set(T) - ok)[:25]}"
         f" | 가격 {sum(by[n]['price'] == T[n][0] for n in pn)}/{len(pn)} (비움 {sum(by[n]['price'] is None for n in pn)})")
    if vn:
        s += f" | 품종 {sum(B5.vsame(by[n]['variety'], T[n][1]) for n in vn)}/{len(vn)}"
    print(s, flush=True)
    with open(os.path.join(run, f"llm_b6_{TAG}_상품.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["번호", "처음 시각", "가격", "상품명", "LLM이 적은 줄 수", "정답에 있음", "정답 가격", "정답 품종"])
        for g in got:
            tv = T.get(g["no"], (None, None))
            w.writerow([g["no"], B.hms(g["t"]), g["price"], g["variety"], g["n"], "O" if g["no"] in T else "X", tv[0], tv[1]])
    with open(os.path.join(run, f"llm_b6_{TAG}_LLM줄.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["시각", "줄", "번호", "no_from", "가격", "상품명", "confidence", "why", "정답에 있음"])
        for x in sorted(found, key=lambda x: x["t"]):
            w.writerow([B.hms(x["t"]), x["line"], x["no"], x["no_from"], x["price"], x["variety"], x["confidence"], x["why"], "O" if x["no"] in T else ""])


if __name__ == "__main__":
    main()
