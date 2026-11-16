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
import shutil
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


# ---------- Claude 구독으로 묻기 (D-RECOG-40, 2026-11-16 사용자 지시 "llm은 클로드 구독 이용해") ----------
# claude CLI -p(구독 로그인)로 한 번 묻는다. 시스템 프롬프트는 우리 파일로 통째 바꾸고, 도구·MCP·스킬을 끄고, 세션을 남기지 않고, 빈 폴더에서.
# 로그인: 맥 키체인은 SSH·관리자(launchd)에서 막히거나 만료되므로, `claude setup-token`으로 만든 오래 가는 표를 TOKEN_FILE(600)에 두면
#   CLAUDE_CODE_OAUTH_TOKEN으로 넘긴다(값은 읽기만, 찍지 않는다). 표가 없으면 키체인 로그인을 그대로 쓴다.
# 돈: ANTHROPIC_API_KEY·ANTHROPIC_AUTH_TOKEN이 환경에 있으면 claude가 API로 과금하므로 자식 환경에서 뺀다(D-RETRO-101 "돈 쓰지 마").
#   --bare는 구독 로그인을 읽지 않아 쓰지 않는다.
CLAUDE_BIN = os.environ.get("LLM_CLAUDE_BIN") or shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")   # 관리자 PATH에는 ~/.local/bin이 없다
TOKEN_FILE = os.path.expanduser(os.environ.get("LLM_CLAUDE_TOKEN_FILE", "~/.lg_claude_token"))
CLAUDE_TIMEOUT = float(os.environ.get("LLM_CLAUDE_TIMEOUT", 180))
_NO_LOGIN = re.compile(r"Failed to authenticate|OAuth|not logged in|Invalid API key|/login", re.I)


class ClaudeLoginError(RuntimeError):
    """로그인이 안 됨 — 다시 물어도 소용없으니 기다리지 않고 바로 알린다"""


def claude_env(base=None):
    """claude 자식 프로세스의 환경: API 열쇠는 빼고, 표 파일이 있으면 구독 표를 넣는다"""
    env = {k: v for k, v in (os.environ if base is None else base).items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            tok = f.read().strip()
        if tok:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = tok
    except OSError:
        pass
    return env


def claude_cmd(sys_path=None, model=None, effort=None, schema=None):
    """claude -p 명령줄(목록). schema = 답 모양 JSON 파일 경로(있으면 --json-schema로 그 모양을 강제)"""
    cmd = [CLAUDE_BIN, "-p", "--model", model or MODEL, "--system-prompt-file", sys_path or SYS, "--tools", "", "--strict-mcp-config",
           "--disable-slash-commands", "--no-session-persistence", "--setting-sources", "project", "--output-format", "json"]
    # --setting-sources project: 사용자 설정(~/.claude/settings.json)의 훅·환경을 읽지 않는다 — 맥 미니에는 훅이 13가지 걸려 있어 물음마다 돈다
    if effort:
        cmd[4:4] = ["--effort", effort]
    if schema:
        with open(schema, encoding="utf-8") as f:
            cmd += ["--json-schema", json.dumps(json.load(f), ensure_ascii=False, separators=(",", ":"))]
    return cmd


def claude_answer(stdout):
    """claude -p --output-format json의 답 → (답 글, 오류 글). 답 모양을 강제했으면 그 JSON을 글로, 아니면 result 글"""
    try:
        d = json.loads(stdout)
    except ValueError:
        return None, (stdout or "")[-300:] or "빈 출력"
    if d.get("is_error"):
        return None, str(d.get("result") or d.get("subtype") or "오류")[:300]
    if d.get("structured_output") is not None:
        return json.dumps(d["structured_output"], ensure_ascii=False), None
    return d.get("result") or "", None   # 빈 답 = 내놓은 상품 없음(프롬프트 출력형식), 실패 아님


def ask_claude(user, sys_path=None, model=None, effort=None, schema=None):
    """Claude 구독으로 한 번 묻기. 로그인이 안 되면 ClaudeLoginError를 바로, 그 밖의 실패는 4번까지 다시 묻는다"""
    os.makedirs(EMPTY, exist_ok=True)
    err = ""
    for k in range(4):
        try:
            r = subprocess.run(claude_cmd(sys_path, model, effort, schema), input=user, text=True, capture_output=True, cwd=EMPTY,
                               timeout=CLAUDE_TIMEOUT, env=claude_env())
            out, err = claude_answer(r.stdout)
            if out is not None and r.returncode == 0:
                return out
            err = err or (r.stderr or "")[-300:]
        except subprocess.TimeoutExpired:
            err = f"{CLAUDE_TIMEOUT:.0f}초 안에 답 없음"
        except FileNotFoundError:
            raise ClaudeLoginError(f"claude 없음({CLAUDE_BIN}): curl -fsSL https://claude.ai/install.sh | bash")
        if _NO_LOGIN.search(err):
            raise ClaudeLoginError(f"claude 로그인 안 됨: `claude setup-token`으로 만든 표를 {TOKEN_FILE}에 두세요 ({err[:120]})")
        time.sleep(5 * (k + 1))
    raise RuntimeError(f"claude 실패: {err}")


# codex 호출의 군더더기 빼기(개선 계획 B-2의 L3, D-SCR-16): 호출마다 붙던 1만6천 토큰(사용자 설정·규칙 파일·세션 기록)을 빼고 답 모양을 고정한다.
#   --ephemeral(세션을 디스크에 남기지 않음) --ignore-user-config(~/.codex/config.toml의 도구·플러그인 설정을 읽지 않음) --ignore-rules(AGENTS.md 등 규칙 파일을 읽지 않음)
#   --output-schema <파일>(마지막 답을 그 JSON 모양으로) — 맥 미니의 codex 0.167.1 기준.
# 이 옵션을 모르는 판이면 한 번 실패한 뒤 옵션 없이 바로 다시 묻고, 그 뒤로는 쓰지 않는다(등록이 멈추지 않게).
# 라이브 등록(sw.llm_live)만 켠다. 끄기: LLM_CODEX_LEAN=0, LLM_CODEX_SCHEMA=0
LEAN_FLAGS = ("--ephemeral", "--ignore-user-config", "--ignore-rules")
SCHEMA_FILE = os.path.join(HERE, "prompts", "reg_answer.schema.json")
_UNSUPPORTED = set()                                      # 이 codex 판이 모르는 것으로 드러난 옵션 묶음("lean"·"schema")
_BAD_ARG = re.compile(r"unexpected argument|unrecognized|unknown (?:option|argument|flag)|invalid value|wasn't expected|Usage:", re.I)


def codex_cmd(out_p, sys_path=None, model=None, effort=None, lean=False, schema=None):
    """codex exec 명령줄(목록). lean = 군더더기 빼는 옵션, schema = 답 모양 파일 경로(없으면 안 붙임)"""
    cmd = ["codex"] + (["--search"] if os.environ.get("WEB_SEARCH") else []) + [
        "exec", "-m", model or MODEL, "-c", f"model_reasoning_effort={effort or EFFORT}", "-c", f"model_instructions_file={sys_path or SYS}",
        "--skip-git-repo-check", "-s", "read-only"]
    if lean and "lean" not in _UNSUPPORTED:
        cmd += list(LEAN_FLAGS)
    if schema and "schema" not in _UNSUPPORTED:
        cmd += ["--output-schema", schema]
    return cmd + ["-o", out_p, "-"]


def ask(user, sys_path=None, model=None, effort=None, lean=False, schema=None, backend=None):
    """시스템 프롬프트 파일·모델·노력은 안 주면 이 모듈 설정(환경변수)대로 — sw.llm_live가 지식판2로 부름.
    backend = "claude"(Claude 구독) / "codex"(Codex 구독). 안 주면 환경변수 BACKEND(끝난 방송 시험용), 그것도 없으면 codex"""
    if (backend or os.environ.get("BACKEND")) == "claude":
        return ask_claude(user, sys_path, model, effort, schema)
    os.makedirs(EMPTY, exist_ok=True)
    k = 0
    while k < 4:
        with tempfile.NamedTemporaryFile("r", suffix=".txt", delete=False) as f:
            out_p = f.name
        r = subprocess.run(codex_cmd(out_p, sys_path, model, effort, lean, schema), input=user, text=True, capture_output=True, cwd=EMPTY, timeout=900)
        out = open(out_p, encoding="utf-8").read() if os.path.exists(out_p) else ""
        os.unlink(out_p)
        if r.returncode == 0:
            return out
        extra = [g for g, on in (("lean", lean), ("schema", schema)) if on and g not in _UNSUPPORTED]
        if extra and _BAD_ARG.search(r.stderr or ""):
            _UNSUPPORTED.update(extra)                    # 옵션을 모르는 판: 기다리지 않고 옵션 없이 다시 묻는다
            print(f"           codex가 새 옵션({'·'.join(extra)})을 받지 않아 옵션 없이 물어요: {(r.stderr or '').strip()[-200:]}", flush=True)
            continue
        time.sleep(10 * (k + 1))
        k += 1
    raise RuntimeError(f"codex 실패: {r.stderr[-300:]}")


def shorthand_price(quote, text, unit=10000, wide=False):
    """모델이 판매가로 지목한 원문이 그 줄에 독립된 한두 자리 수로 있을 때만 판매자 단위(기본 만원)로 환산한다.
    wide = 10으로 나누어떨어지는 세 자리("130", "230")도 읽는다(D-SCR-13 — 2026-11-12 방송 222번 "130에" → 1,300,000)"""
    if not isinstance(quote, str) or not text or not unit:
        return None
    digits = "일이삼사오육칠팔구"
    raw = "".join(quote.split())
    if re.fullmatch(r"[1-9][0-9]?", raw) or (wide and re.fullmatch(r"[1-9][0-9]0", raw)):
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
        return value * unit
    return None


def rows_of(out, L, unit=10000, wide=False):
    """답 → [{t, line, no, price, name, no_from, confidence, why}] (B.parse와 같은 거름 + 나머지 칸)
    답이 JSON 줄들이든 --output-schema 모양({"products": [...]})이든 안쪽 상품 줄을 하나씩 읽는다.
    unit = 단위 없는 판매가에 곱할 값(만원 10000 · 천원 1000 · 없음 None), wide = 세 자리 단위 생략 가격도(shorthand_price)"""
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
            spoken = shorthand_price(d.get("price_short"), texts.get(int(price_line)), unit, wide)
            # 모델이 그 수를 그대로·천원·만원 단위로 적었으면 판매자 단위로 맞춘다(만원 단위 판매자의 "35": 35 · 35,000 → 350,000)
            if spoken is not None and p != spoken and p in (spoken // unit, spoken // unit * 1000, spoken // unit * 10000):
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
