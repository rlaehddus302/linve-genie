# B4 시험(사용자 제안 2026-11-10): 더 좋은 LLM(OpenAI API)이 받아쓴 말의 맥락을 읽어 상품(번호·가격)을 먼저 뽑고, 화면(OCR)으로 검증·보충한다.
# B2(Gemma 27B)에서 드러난 문제를 고친 판:
#   - 6분 조각 → 2분 조각(30초 겹침): 한 번에 상품이 너무 많으면 건너뜀
#   - 시각을 LLM이 쓰지 않음: 줄 번호(L12)로 답하게 하고 코드가 그 줄의 실제 받아쓰기 시각을 붙임(B3는 예제 시각을 베꼈음)
#   - 번호를 말했으면 그 시각 앞 30초~뒤 60초 화면에 2초 이상 보였는지로 검증, 말하지 않았으면 그 시각 가장 크게 보인 번호표로 채움
#     (번호표 둘이 비슷하게 보이면 채우지 않고 확인요청)
#   - 손님 닉네임("○○님", "○○ 사장님/언니")은 보내기 전에 가림(개인정보, 팀 밖 서버로 나감)
# 사용: OPENAI_API_KEY=… OPENAI_MODEL=… python -m sw.llm_b4 [보스|럭셔리|다육홀릭|경성 …]   (LLM 답은 결과 폴더에 저장해 두고 다시 씀)
import collections
import concurrent.futures as cf
import csv
import json
import os
import re
import sys
import time

import requests

from .llm_ocr import screen_of
from .paths import FIRST
from .rescore import SETS, SHARE
from .score_run import final

MODEL = os.environ.get("OPENAI_MODEL", "")
VER = os.environ.get("B_VER", "b4")      # b4 = 말만(예전 프롬프트) / b5 = 시스템 프롬프트(sw/prompts/sales_system.txt) + 줄마다 화면 번호표
SYSTEM = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts", "sales_system.txt"), encoding="utf-8").read()
# b5 = 멘토 방식 지시형 프롬프트(sw/prompts/sales_instruct.txt, '항목: 값;' 형식, {lines} 자리에 줄마다 화면 번호표를 붙인 2분 대본)
INSTRUCT = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts", "sales_instruct.txt"), encoding="utf-8").read()
CHUNK, OVERLAP = 120, 30

PROMPT = """다육식물 유튜브 라이브 판매 방송에서 판매자가 한 말을 받아쓴 글입니다. 받아쓰기 실수가 많습니다.
각 줄 앞의 L번호는 줄 번호입니다. (○○님·○○ 사장님은 손님 이름을 가린 것입니다)

{lines}

판매자는 화분에 붙은 번호표 번호로 상품을 팝니다. 이 글에서 판매자가 판 상품을 모두 찾아, 상품마다 JSON 한 줄로 적으세요.
{{"line": 판매자가 그 상품의 번호나 가격을 말한 줄 번호, "no": 상품 번호(숫자, 말하지 않았으면 null), "price": 최종 가격(원 단위 숫자, 모르면 null)}}

맥락으로 판단하세요.
- 번호는 "106번"처럼 '번'을 붙이기도 하지만 "자 244", "273 레옹색금 만원"처럼 숫자만 말하기도 하고, 받아쓰기가 "2 3 5", "43,55"처럼 끊어 적기도 합니다.
- "11번 아니고 67번"처럼 정정하면 정정한 번호만 적습니다.
- 손님에게 인사한 번호("114번 고맙습니다", "○○님 232 감사드립니다"), 지난번에 판 상품 이야기, 번호표가 아닌 숫자("12번째", "1년에 4번", 크기 cm, 날짜, 개수)는 상품이 아닙니다.
- 번호를 말하지 않고 "요거 5만원"처럼 판 상품도 적되 no는 null로 적습니다(번호는 화면 번호표에서 따로 찾습니다).
- 여러 개를 한 번에 팔면("35번, 36번, 37번 만원씩") 번호마다 한 줄씩 적습니다.
- 가격을 바꾸면("3만원인데 2만5천원에 드릴게요") 마지막 가격, "원래 13만원짜리 12만원"이면 파는 가격(12만원)입니다. 만원 → 10000, 100만원 → 1000000.
- 글에 없는 상품을 지어내지 마세요. 파는 상품이 없으면 아무것도 적지 마세요. JSON 줄 말고는 아무것도 쓰지 마세요."""

_NICK = re.compile(r"([가-힣A-Za-z0-9]{1,10})(\s?)(님|사장님|언니|선생님)")


def mask(x):
    """손님 닉네임 가림: '자성님' → '○○님', '계룡산 사장님' → '○○ 사장님'"""
    return _NICK.sub(lambda m: "○○" + m.group(2) + m.group(3) if m.group(1) not in ("사장", "선생", "고객", "손님", "여러분") else m.group(0), x)


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


BACKEND = os.environ.get("LLM_BACKEND", "api")   # api = OpenAI API(크레딧) / codex = Codex CLI(ChatGPT 구독 로그인, 시험용)
_EMPTY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runs", "codex_empty")


def ask_codex(prompt):
    """Codex CLI로 한 번 묻기: 읽기 전용, 빈 폴더에서(저장소를 읽지 않게), 마지막 답만 받음"""
    import subprocess
    import tempfile
    os.makedirs(_EMPTY, exist_ok=True)
    for k in range(4):
        with tempfile.NamedTemporaryFile("r", suffix=".txt", delete=False) as f:
            out_p = f.name
        r = subprocess.run(["codex", "exec", "-m", MODEL, "--skip-git-repo-check", "-s", "read-only", "-o", out_p, "-"],
                           input=prompt, text=True, capture_output=True, cwd=_EMPTY, timeout=600)
        out = open(out_p, encoding="utf-8").read() if os.path.exists(out_p) else ""
        os.unlink(out_p)
        if r.returncode == 0:
            return out   # 판 상품이 없으면 빈 답이 정상

        time.sleep(10 * (k + 1))
    raise RuntimeError(f"codex 실패: {r.stderr[-300:]}")


def ask(prompt, system=None):
    if BACKEND == "codex":   # Codex는 시스템 자리를 자기 지시로 채워서, 우리 시스템 프롬프트는 사용자 메시지 맨 앞에 붙인다
        return ask_codex((system + "\n\n---\n\n" if system else "") + prompt)
    key = os.environ["OPENAI_API_KEY"]
    for k in range(5):
        r = requests.post("https://api.openai.com/v1/chat/completions", timeout=180,
                          headers={"Authorization": f"Bearer {key}"},
                          json={"model": MODEL, "messages": ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]})
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"]
        if r.status_code in (429, 500, 502, 503):
            time.sleep(5 * (k + 1))
            continue
        raise RuntimeError(f"OpenAI {r.status_code}: {r.text[:300]}")
    raise RuntimeError("OpenAI 재시도 실패")


def chunks(stt):
    """[(시작 초, [(줄 번호, 초, 글)])] — 2분씩, 30초 겹침"""
    end = stt[-1][0] if stt else 0
    out, s = [], 0
    while s < end:
        L = [(i, t, x) for i, (t, x) in enumerate(stt) if s - OVERLAP <= t < s + CHUNK]
        if L:
            out.append((s, L))
        s += CHUNK
    return out


def parse(out, L):
    ids = {i: t for i, t, _ in L}
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
        if no is None and p is None:
            continue
        got.append({"t": ids[li], "line": li, "no": no, "price": p})
    return got


def screen_note(t, cand, mains):
    """그 줄 시각(앞 1초~뒤 3초)에 화면에서 읽힌 번호표: '297 크게, 55, 68' / '없음'"""
    m = collections.Counter(mains.get(i) for i in range(int(t) - 1, int(t) + 4) if mains.get(i) is not None)
    big = m.most_common(1)[0][0] if m else None
    other = collections.Counter(n for i in range(int(t) - 1, int(t) + 4) for n in set(cand.get(i, ())) if n != big)
    parts = ([f"{big} 크게"] if big is not None else []) + [str(n) for n, _ in other.most_common(3)]
    return ", ".join(parts) or "없음"


def extract(run):
    """결과 폴더 → LLM이 적은 상품 목록(조각별 답은 llm_b4_<모델>.json에 저장)"""
    stt = [(d["start_sec"], d["text"]) for d in map(json.loads, open(os.path.join(run, "transcript.jsonl"), encoding="utf-8"))]
    cp = os.path.join(run, f"llm_{VER}_{re.sub(r'[^A-Za-z0-9.-]', '_', MODEL)}.json")
    cache = json.load(open(cp, encoding="utf-8")) if os.path.exists(cp) else {}
    C = chunks(stt)
    todo = [(s, L) for s, L in C if str(s) not in cache]
    if VER == "b5":
        cand, mains = screen_of(run)

    def one(sL):
        s, L = sL
        if VER == "b5":
            # 시스템 프롬프트(INSTRUCT, 늘 같음) + 사용자 메시지(이 2분의 방송내용만)
            return s, ask("방송내용:\n" + "\n".join(f"L{i} [{hms(t)}] (화면: {screen_note(t, cand, mains)}) {mask(x)}" for i, t, x in L), INSTRUCT)
        return s, ask(PROMPT.format(lines="\n".join(f"L{i} [{hms(t)}] {mask(x)}" for i, t, x in L)))
    with cf.ThreadPoolExecutor(int(os.environ.get("LLM_PAR", 4 if BACKEND == "codex" else 8))) as ex:
        for s, out in ex.map(one, todo):
            cache[str(s)] = out
            json.dump(cache, open(cp, "w", encoding="utf-8"), ensure_ascii=False)
    found = []
    for s, L in C:
        found += parse(cache[str(s)], L)
    return found


GAP = """라이브 커머스 방송에서 판매자가 한 말을 받아쓴 글입니다. 받아쓰기 실수가 많습니다. (○○님·○○ 사장님은 손님 이름을 가린 것입니다)
이 시간({a}~{b})에 화면에는 {no}번 번호표가 가장 크게 {sec}초 동안 보였습니다.

{lines}

판매자가 이 시간에 {no}번 상품을 손님에게 팔았는지 말의 맥락으로 판단하세요.
- 번호를 말하지 않고 상품을 보여 주며 팔았을 수 있습니다. 그때 화면에 크게 보인 번호표가 그 상품 번호입니다.
- 다른 상품을 팔고 있었고 {no}번은 옆이나 뒤에 놓여 보였을 뿐이면 판 것이 아닙니다.
- 설명만 하고 팔지 않았거나, 판 근거가 없으면 판 것이 아닙니다.
JSON 한 줄로만: {{"sold": true 또는 false, "line": 근거가 된 줄 번호 또는 null, "price": 최종 가격(원 단위 숫자) 또는 null}}"""


def gaps(got, segs, lo=0, hi=10 ** 9):
    """화면에 번호표가 3초 넘게 가장 크게 보였는데 그 무렵(앞 20초~뒤 10초) LLM 결과에 그 번호가 없는 구간 — LLM이 안 적은 상품 후보"""
    out = []
    for g in segs:
        if g["e"] - g["s"] + 1 < 3 or not lo <= g["s"] < hi:
            continue
        if any(x["no"] == g["img"] and g["s"] - 120 <= x["t"] <= g["e"] + 120 for x in got):
            continue
        out.append(g)
    return out


def rescue(run, got, segs, stt, cache, cp, lo=0, hi=10 ** 9):
    """LLM이 안 적은 화면 구간을 그 구간만 좁게 다시 물어 살린다(사용자 제안 2026-11-10: LLM이 안 적어도 OCR이 살려야 함)"""
    G = gaps(got, segs, lo, hi)

    def one(g):
        key = f"gap:{g['img']}:{g['s']}"
        if key in cache:
            return key, cache[key]
        L = [(i, t, x) for i, (t, x) in enumerate(stt) if g["s"] - 30 <= t <= g["e"] + 20]
        if not L:
            return key, ""
        return key, ask(GAP.format(no=g["img"], a=hms(g["s"]), b=hms(g["e"]), sec=g["e"] - g["s"] + 1,
                                   lines="\n".join(f"L{i} [{hms(t)}] {mask(x)}" for i, t, x in L)))
    with cf.ThreadPoolExecutor(int(os.environ.get("LLM_PAR", 4 if BACKEND == "codex" else 8))) as ex:
        for key, out in ex.map(one, G):
            cache[key] = out
    json.dump(cache, open(cp, "w", encoding="utf-8"), ensure_ascii=False)
    add = []
    for g in G:
        m = re.search(r"\{[^{}]*\}", cache.get(f"gap:{g['img']}:{g['s']}", ""))
        try:
            d = json.loads(m.group(0)) if m else {}
        except ValueError:
            d = {}
        if d.get("sold") is True:
            p = d.get("price")
            p = int(str(p).replace(",", "")) if p is not None and str(p).replace(",", "").isdigit() else None
            add.append({"no": g["img"], "t": g["s"], "prices": [p], "price": p, "srcs": {"화면 구간 다시 물음"}, "ok": True, "seen": g["e"] - g["s"] + 1})
    return add, len(G)


def checked(found, cand, mains):
    """번호 말함 → 그 무렵 화면에 보였는지 검증 / 말 안 함 → 그 순간 가장 크게 보인 번호표로 채움(비슷한 둘이면 못 채움) → 같은 번호 합침"""
    rows = []
    for f in found:
        t = int(f["t"])
        if f["no"] is None:
            c = collections.Counter(mains[s] for s in range(t - 10, t + 21) if mains.get(s) is not None).most_common(2)
            if not c or c[0][1] < 2 or (len(c) > 1 and c[1][1] * 2 > c[0][1]):
                continue   # 번호를 모르고 화면도 애매 → 확인요청감(번호가 없어 채점 대상 아님)
            rows.append(dict(f, no=c[0][0], src="화면으로 채움"))
        else:
            rows.append(dict(f, src="말"))
    # 줄마다 먼저 검증하고 같은 번호를 합친다(예전엔 합친 뒤 첫 시각으로만 검증해서, 다른 때 잘못 적힌 같은 번호와 묶이면 맞는 것도 떨어졌음 — 보스 137)
    for r in rows:
        r["seen"] = sum(r["no"] in cand.get(s, ()) for s in range(int(r["t"]) - 30, int(r["t"]) + 61))
        r["ok"] = r["src"] == "화면으로 채움" or r["seen"] >= 2
    merged = []
    for r in sorted(rows, key=lambda r: (not r["ok"], r["t"])):
        g = next((g for g in merged if g["no"] == r["no"] and abs(g["t"] - r["t"]) <= 300), None)
        if g:
            g["prices"].append(r["price"]); g["srcs"].add(r["src"]); g["ok"] = g["ok"] or r["ok"]; g["seen"] = max(g["seen"], r["seen"])
        else:
            merged.append({"no": r["no"], "t": r["t"], "prices": [r["price"]], "srcs": {r["src"]}, "ok": r["ok"], "seen": r["seen"]})
    for g in merged:
        ps = [p for p in g["prices"] if p]
        g["price"] = collections.Counter(ps).most_common(1)[0][0] if ps else None
    return merged


def main():
    if not MODEL or (BACKEND == "api" and not os.environ.get("OPENAI_API_KEY")):
        sys.exit("OPENAI_MODEL과 (API면) OPENAI_API_KEY를 환경변수로 주세요")
    want = sys.argv[1:] or [k for k, _, _ in SETS]
    for k, r, tr in SETS:
        if k not in want:
            continue
        run = os.path.join(FIRST, "runs", r)
        T = {int(x["번호"]): (int(x["가격"]) if x["가격"] else None) for x in csv.DictReader(open(os.path.join(SHARE, tr), encoding="utf-8-sig"))}
        t0 = time.time()
        found = extract(run)
        cand, mains = screen_of(run)
        got = checked(found, cand, mains)
        # 4단계: 화면에 번호표가 보였는데 LLM이 안 적은 구간 → 그 구간만 다시 물음
        from .screen import Screen
        sc = Screen()
        for l in open(os.path.join(run, "screen.jsonl"), encoding="utf-8"):
            d = json.loads(l)
            sc.add(d["sec"], [tuple(z) for z in d["t"]])
        segs, _, _ = sc.build()
        stt = [(d["start_sec"], d["text"]) for d in map(json.loads, open(os.path.join(run, "transcript.jsonl"), encoding="utf-8"))]
        cp = os.path.join(run, f"llm_{VER}_{re.sub(r'[^A-Za-z0-9.-]', '_', MODEL)}.json")
        add, ngap = rescue(run, got, segs, stt, json.load(open(cp, encoding="utf-8")), cp)
        got += add
        print(f"  (화면 구간 다시 물음 {ngap}개 → 판매라고 한 것 {len(add)}개)")
        E = [json.loads(l) for l in open(os.path.join(run, "events.jsonl"), encoding="utf-8")]
        A = {e["no"] for e in final(E)}
        ok = {g["no"] for g in got if g["ok"]}
        ask_ = {g["no"] for g in got if not g["ok"]} - ok
        pr = {g["no"]: g["price"] for g in got if g["ok"]}

        def line(label, conf, asked, prices=None):
            right, wrong = conf & set(T), conf - set(T)
            s = f"  {label:<22} 잡은 비율 {len(right)}/{len(T)} · 맞은 비율 {len(right)}/{len(conf)} ({len(right) / max(1, len(conf)):.1%}) · 틀린 확정 {len(wrong)} {sorted(wrong)[:10]}" \
                f" · 확인요청(정답) {len((asked - conf) & set(T))} · 놓침 {len(set(T) - conf - asked)}"
            if prices is not None:
                pn = [n for n in right if T[n] is not None and prices.get(n) is not None]
                s += f" · 가격 {sum(prices[n] == T[n] for n in pn)}/{len(pn)}"
            print(s, flush=True)
        print(f"\n== {k} (정답 {len(T)}) · LLM {MODEL} · 상품 {len(found)}줄 · {time.time() - t0:.0f}초")
        line("A 지금 일꾼", A, set())
        line("B4 LLM 먼저+OCR", ok, ask_, pr)
        line("A 또는 B4", A | ok, ask_)


if __name__ == "__main__":
    main()
