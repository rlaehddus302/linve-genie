# B 방식 시험(사용자 제안 2026-11-10): 받아쓴 말을 LLM이 읽어 번호·가격을 먼저 뽑고(sw.llm_first와 같은 프롬프트),
# 그 번호가 그 무렵 화면 OCR에 보였는지로 검증한다. 지금 일꾼(A: OCR+STT 규칙)과 같은 정답으로 비교하고, 둘을 합친 결과도 센다.
#   검증: LLM이 말한 때 앞 30초~뒤 60초 화면 후보(배경 숫자 뺀 것)에 같은 번호가 2초 이상 → 검증됨, 아니면 확인요청감
# 사용: python -m sw.llm_ocr <일꾼 결과 폴더> <정답.csv> [...]   (LLM_MODEL, 기본 Gemma 27B. LLM 결과는 폴더에 저장해 두고 다시 쓴다)
import collections
import csv
import json
import os
import sys
import time

from . import price
from .llm_first import hms
from .score_run import final
from .screen import Screen

MODEL = os.environ.get("LLM_MODEL", "mlx-community/gemma-3-27b-it-4bit")

# B2(사용자 제안 2026-11-10): '번' 없이 숫자만 말한 번호도 번호로, 번호를 말하지 않고 "요거는 3만원"처럼 판 상품은 번호 없이 적게 하고
# 번호는 그 순간 화면에 가장 크게 보인 번호표(OCR)로 채운다
PROMPT2 = """다육식물 유튜브 라이브 판매 방송에서 판매자가 한 말을 받아쓴 대본입니다. 받아쓰기 실수가 많습니다. [시:분:초] 뒤가 그때 한 말입니다.

{lines}

이 대본에서 판매자가 판 상품을 모두 찾아 한 줄에 하나씩 JSON으로 적으세요.
{{"t": "그 상품을 팔기 시작한 시:분:초", "no": 상품 번호(숫자, 모르면 null), "price": 가격(원 단위 숫자), "name": "품종 이름"}}
- 상품 번호는 화분에 붙은 번호표 숫자입니다. "106번"처럼 '번'을 붙이기도 하지만 "자 244", "273 레옹색금 만원"처럼 숫자만 말하기도 합니다. 받아쓰기가 번호를 "2 3 5", "3.2.6"처럼 한 자리씩 끊어 적기도 합니다. 가격·크기(cm)·개수·날짜 숫자와 헷갈리지 마세요.
- 번호를 말하지 않고 "요거는 3만원"처럼 가격을 말하며 판 상품도 적되, no는 null로 적습니다(번호는 화면에서 따로 찾습니다).
- 번호는 숫자로 적습니다("106"이 아니라 106).
- 가격은 원 단위 숫자로 적습니다(만원 → 10000, 5천원 → 5000). 모르면 null.
- 인사, 키우는 법 설명처럼 파는 상품이 아닌 이야기는 적지 마세요. 대본에 없는 것을 지어내지 마세요. JSON 줄 말고는 아무것도 쓰지 마세요."""


# B3(사용자 제안 2026-11-10): B2 + 실제 방송에서 뽑아 사람이 답을 확인한 예제 28개(few-shot, sw/fewshot_examples.json — 시험 방송은 안 씀).
# 품종은 빼고 번호·가격만(번호에 집중하게)
def prompt3():
    ex = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fewshot_examples.json"), encoding="utf-8"))
    parts = []
    for i, e in enumerate(ex, 1):
        lines = "\n".join(f"[{t}] {x}" for t, x in e["대본"])
        ans = "\n".join(json.dumps(a, ensure_ascii=False) for a in e["답"]) or "(판 상품 없음 — 아무것도 적지 않음)"
        parts.append(f"<예시 {i}>\n대본:\n{lines}\n답:\n{ans}".replace("{", "{{").replace("}", "}}"))
    head = PROMPT2.split("{lines}")[0].rstrip()
    rule = PROMPT2.split("{lines}")[1].replace(', "name": "품종 이름"', "")
    return (head + "\n(아래 대본을 읽기 전에, 실제 방송 대본과 그 답 예시를 먼저 봅니다)\n\n" + "\n\n".join(parts)
            + "\n\n<이제 이 대본>\n{lines}\n" + rule)


def extract3(gen, stt):
    """B2와 같은 방식, 프롬프트만 few-shot"""
    global PROMPT2
    keep, PROMPT2 = PROMPT2, prompt3()
    try:
        return extract2(gen, stt)
    finally:
        PROMPT2 = keep


def extract2(gen, stt):
    """대본 → [{t, no(없으면 None), price, name}] — 같은 번호 합치기는 번호를 채운 뒤에"""
    import re
    from .llm_first import CHUNK, OVERLAP, sec
    end = stt[-1][0] if stt else 0
    found, s = [], 0
    done = json.load(open(PARTIAL, encoding="utf-8")) if PARTIAL and os.path.exists(PARTIAL) else {}
    while s < end:
        lines = [(t, x) for t, x in stt if s - OVERLAP <= t < s + CHUNK]
        if lines:
            out = done.get(str(s))
            if out is None:   # 조각마다 LLM 답을 저장해 두고, 중간에 죽어도 이어서 돌린다
                out = gen(PROMPT2.format(lines="\n".join(f"[{hms(t)}] {x}" for t, x in lines)), 1000)
                done[str(s)] = out
                if PARTIAL:
                    json.dump(done, open(PARTIAL, "w", encoding="utf-8"), ensure_ascii=False)
            for m in re.finditer(r"\{[^{}]*\}", out):
                try:
                    d = json.loads(m.group(0))
                except ValueError:
                    continue
                no = d.get("no")
                if isinstance(no, str) and no.strip().rstrip("번").strip().isdigit():
                    no = int(no.strip().rstrip("번").strip())
                no = no if isinstance(no, int) and 0 < no < 1000 else None
                p = d.get("price")
                p = int(p) if isinstance(p, (int, str)) and str(p).isdigit() and int(p) > 0 else None
                if no is None and p is None:
                    continue   # 번호도 가격도 없으면 상품으로 보지 않음
                t = sec(str(d.get("t"))) or lines[0][0]
                n = d.get("name") if isinstance(d.get("name"), str) and d.get("name").lower() not in ("null", "none", "") else None
                found.append({"t": t, "no": no, "price": p, "name": n})
        s += CHUNK
    return found


def merge(found):
    merged = []
    for f in sorted(found, key=lambda f: f["t"]):
        g = next((g for g in merged if g["no"] == f["no"] and abs(g["t"] - f["t"]) <= 300), None)
        if g:
            g["prices"].append(f["price"]); g["from"].add(f["from"])
        else:
            merged.append({"t": f["t"], "no": f["no"], "prices": [f["price"]], "name": f["name"], "from": {f["from"]}})
    for g in merged:
        ps = [p for p in g["prices"] if p]
        g["price"] = collections.Counter(ps).most_common(1)[0][0] if ps else None
        g["from"] = "+".join(sorted(g["from"]))
    return merged
PRE, POST, NEED = 30, 60, 2
PARTIAL = None   # 조각별 LLM 답 저장 파일(main이 정함)


def screen_of(run):
    sc = Screen()
    for l in open(os.path.join(run, "screen.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        sc.add(d["sec"], [tuple(z) for z in d["t"]])
    _, cand, mains = sc.build()
    return cand, mains


def checked(raw, cand, mains):
    """LLM이 적은 상품 → 번호 없는 것은 그 순간 가장 크게 보인 번호표로 채우고, 같은 번호 합치고, 화면에 보였는지 검증"""
    for f in raw:
        f["from"] = "말"
        f.setdefault("name", None)
        if f["no"] is None:
            c = collections.Counter(mains[s] for s in range(int(f["t"]) - 10, int(f["t"]) + 21) if mains.get(s) is not None)
            if c and c.most_common(1)[0][1] >= 2:
                f["no"], f["from"] = c.most_common(1)[0][0], "화면"
    out = merge([f for f in raw if f["no"] is not None])
    for p in out:
        p["seen"] = sum(p["no"] in cand.get(s, ()) for s in range(int(p["t"]) - PRE, int(p["t"]) + POST + 1))
        p["ok"] = p["seen"] >= NEED
    return out


METHODS = {"b2": ("B2 번 없는 번호+화면으로 채움", extract2), "b3": ("B3 = B2 + few-shot 예제 28개", extract3)}


def main():
    a = sys.argv[1:]
    want = os.environ.get("METHODS", "b2,b3").split(",")
    cache = {}
    gen = lambda: cache.setdefault("g", price._generator(MODEL))
    rows = []
    for i in range(0, len(a), 2):
        run, truth = a[i], a[i + 1]
        name = os.path.basename(run.rstrip("/"))
        T = {int(r["번호"]): (int(r["가격"]) if r["가격"] else None) for r in csv.DictReader(open(truth, encoding="utf-8-sig"))}
        cand, mains = screen_of(run)
        E = [json.loads(l) for l in open(os.path.join(run, "events.jsonl"), encoding="utf-8")]
        A = {e["no"] for e in final(E)}
        A_ask = {e["no"] for e in E if e.get("kind") == "확인요청"} - A
        Apr = {}
        for e in E:
            if e.get("kind") == "금액":
                Apr.setdefault(e["no"], e["pick"])

        def line(label, conf, ask, prices):
            right, wrong = conf & set(T), conf - set(T)
            asked = (ask - conf) & set(T)
            lost = set(T) - conf - ask
            pn = [n for n in right if T[n] is not None and prices.get(n) is not None]
            pok = sum(prices[n] == T[n] for n in pn)
            print(f"  {label:<30} 맞게 확정 {len(right):>3} · 틀린 확정 {len(wrong):>2} {sorted(wrong)[:12]} | 확인요청(정답) {len(asked):>2} | 놓침 {len(lost):>3} {sorted(lost)[:15]}"
                  f" | 가격 {pok}/{len(pn)}", flush=True)
        res = {}
        for m in want:
            label, fn = METHODS[m]
            p = os.path.join(run, f"llm_{m}_27b.json")
            if not os.path.exists(p):
                global PARTIAL
                PARTIAL = p + ".part"
                stt = [(d["start_sec"], d["text"]) for d in map(json.loads, open(os.path.join(run, "transcript.jsonl"), encoding="utf-8"))]
                t1 = time.time()
                json.dump(fn(gen(), stt), open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
                print(f"{name}: {m} LLM {time.time() - t1:.0f}초", flush=True)
            raw = json.load(open(p, encoding="utf-8"))
            res[m] = (label, raw, checked(raw, cand, mains))
        print(f"\n== {name} (정답 {len(T)})")
        line("A 지금 일꾼(OCR+STT 규칙)", A, A_ask, Apr)
        for m, (label, raw, got) in res.items():
            ok = {p["no"] for p in got if p["ok"]}
            ask = {p["no"] for p in got if not p["ok"]} - ok
            pr = {p["no"]: p["price"] for p in got if p["ok"]}
            print(f"  ({m}: LLM이 적은 상품 {len(raw)} · 번호 없이 적은 것 {sum(f['from'] == '화면' or f['no'] is None for f in raw)} 중 화면으로 채움 {sum(f['from'] == '화면' for f in raw)})")
            line(label, ok, ask, pr)
            line(f"A 또는 {m.upper()}(검증됨)", A | ok, (A_ask | ask) - (A | ok), {n: Apr.get(n, pr.get(n)) for n in A | ok})
            for p in got:
                rows.append([name, m.upper(), hms(p["t"]), p["no"], p["price"] or "", p["seen"], ("검증됨" if p["ok"] else "화면에 없음") + f" · 번호 출처 {p['from']}",
                             "정답" if p["no"] in T else "정답에 없음", "A도 확정" if p["no"] in A else ("A는 확인요청" if p["no"] in A_ask else "A에 없음")])
            for n in sorted(A - ok):
                rows.append([name, m.upper(), "", n, Apr.get(n) or "", "", f"{m.upper()}가 못 찾음", "정답" if n in T else "정답에 없음", "A만 확정"])
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "share", "B방식_LLM먼저_OCR검증.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["방송", "방식", "LLM이 말한 시각", "번호", "LLM 가격", "그 무렵 화면에서 읽힌 초", "OCR 검증", "정답", "A(지금 일꾼)"])
        w.writerows(rows)
    print("\n번호마다:", os.path.abspath(out))


if __name__ == "__main__":
    main()
