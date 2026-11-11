# LLM 중심 시험: 규칙으로 상품 시간을 자르거나 후보를 주지 않고, LLM이 받아쓴 대본을 몇 분씩 읽어 상품 목록(번호·가격·품종)을 직접 쓴다.
# 파이썬은 최소한만: 같은 번호 합치기, 숫자 확인. 정답 방송(관리자 글)으로 지금 방식(규칙 + 작은 LLM)과 같은 기준으로 채점한다.
# 사용: python -m sw.llm_first [방송 이름…]   (LLM_BACKEND·LLM_MODEL 환경변수로 모델 바꿈)
import collections
import csv
import json
import os
import re
import sys
import time

from . import price, variety
from .variety_regress import near, truth_variety

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "regress")
from .paths import PKG
NAMES = ["luxury_20261104", "sujeong_20261103", "dayuksarang1004_20261029", "nuri_20261106", "sokcho_jeongwon_20261106"]
CHUNK, OVERLAP = 360, 60

PROMPT = """다육식물 유튜브 라이브 판매 방송에서 판매자가 한 말을 받아쓴 대본입니다. 받아쓰기 실수가 많습니다. [시:분:초] 뒤가 그때 한 말입니다.

{lines}

이 대본에서 판매자가 판 상품을 모두 찾아 한 줄에 하나씩 JSON으로 적으세요.
{{"t": "그 번호를 처음 말한 시:분:초", "no": 상품 번호(숫자), "price": 가격(원 단위 숫자), "name": "품종 이름"}}
- 상품 번호는 판매자가 말한 번호표 숫자입니다("N번" 또는 "N 가격"처럼). 번호를 말하지 않은 상품은 적지 마세요.
- 가격은 원 단위 숫자로 적습니다(만원 → 10000, 5천원 → 5000). 단위 없이 말한 가격은 이 방송 다른 가격의 단위를 따릅니다. 모르면 null.
- 품종은 받아쓰기 실수를 바로잡아 적고, 모르면 null. "○○님"으로 부르는 이름은 손님 이름이라 품종이 아닙니다.
- 대본에 없는 것을 지어내지 마세요. JSON 줄 말고는 아무것도 쓰지 마세요."""


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def sec(s):
    p = [int(x) for x in re.findall(r"\d+", s or "")]
    return p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else (p[0] * 60 + p[1] if len(p) == 2 else None)


def extract(gen, stt):
    """대본 → [{t, no, price, name}] (같은 번호는 5분 안이면 하나로)"""
    end = stt[-1][0] if stt else 0
    found = []
    s = 0
    while s < end:
        lines = [(t, x) for t, x in stt if s - OVERLAP <= t < s + CHUNK]
        if lines:
            out = gen(PROMPT.format(lines="\n".join(f"[{hms(t)}] {x}" for t, x in lines)), 800)
            for m in re.finditer(r"\{[^{}]*\}", out):
                try:
                    d = json.loads(m.group(0))
                except ValueError:
                    continue
                no = d.get("no")
                if isinstance(no, str) and no.strip().rstrip("번").strip().isdigit():
                    no = int(no.strip().rstrip("번").strip())   # LLM이 번호를 글자로 쓰는 일이 잦음("106") — 예전엔 버려서 보스 102·106을 놓침
                if not isinstance(no, int) or not 0 < no < 1000:
                    continue
                t = sec(str(d.get("t"))) or lines[0][0]
                p = d.get("price") if isinstance(d.get("price"), int) and d.get("price") > 0 else None
                n = d.get("name") if isinstance(d.get("name"), str) and d.get("name").lower() not in ("null", "none", "") else None
                found.append({"t": t, "no": no, "price": p, "name": n})
        s += CHUNK
    merged = []
    for f in sorted(found, key=lambda f: f["t"]):
        g = next((g for g in merged if g["no"] == f["no"] and abs(g["t"] - f["t"]) <= 300), None)
        if g:
            g["prices"].append(f["price"]); g["names"].append(f["name"])
        else:
            merged.append({"t": f["t"], "no": f["no"], "prices": [f["price"]], "names": [f["name"]]})
    for g in merged:
        ps = [p for p in g["prices"] if p]
        ns = [n for n in g["names"] if n]
        g["price"] = collections.Counter(ps).most_common(1)[0][0] if ps else None
        g["name"] = collections.Counter(ns).most_common(1)[0][0] if ns else None
    return merged


def main():
    names = sys.argv[1:] or NAMES
    gen = price._generator(os.environ.get("LLM_MODEL", price.LLM_MODEL))
    dic = variety.Dictionary()
    tag = os.environ.get("TAG", price.LLM_BACKEND)
    T = collections.Counter()
    t0 = time.time()
    for name in names:
        if os.path.isdir(name):
            # 정답 없는 방송(일꾼 결과 폴더): 일꾼이 받아쓴 글로 상품 목록만 만든다 → <폴더>/LLM만_상품목록.csv
            stt = [(d["start_sec"], d["text"]) for d in map(json.loads, open(os.path.join(name, "transcript.jsonl"), encoding="utf-8"))]
            prods = extract(gen, stt)
            with open(os.path.join(name, f"LLM만_{tag}_상품목록.csv"), "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                w.writerow(["시각", "번호", "가격", "품종"])
                for p in prods:
                    w.writerow([hms(p["t"]), p["no"], f"{p['price']:,}" if p["price"] else "", p["name"] or ""])
            print(f"{name}: 상품 {len(prods)}개 | {time.time() - t0:.0f}초", flush=True)
            continue
        stt = [(float(r["start_sec"]), r["text"]) for r in csv.DictReader(open(os.path.join(R, "stt", "tm", "work", name, "stt_team.csv"), encoding="utf-8-sig"))]
        prods = extract(gen, stt)
        json.dump(prods, open(os.path.join(R, f"llm_first_{tag}_{name}.json"), "w"), ensure_ascii=False, indent=0)
        c = collections.Counter()
        # 번호: 회귀 시험과 같은 정답(관리자 글) — 정답 글 앞 90초~뒤 30초에 그 번호를 냈나
        truth = []
        for r in csv.DictReader(open(os.path.join(R, "stt", "tm", "t2", "img", name, "answer_moderator.csv"), encoding="utf-8-sig")):
            t, nos = float(r["sec"]), {int(x) for x in r["numbers"].split() if x}
            if not any(nos == n and t - u < 300 for u, n in truth[-6:]):
                truth.append((t, nos))
        for t, S in truth:
            c["n"] += 1
            c["ok"] += any(p["no"] in S and t - 150 <= p["t"] <= t + 30 for p in prods)
        c["notruth"] = sum(not any(abs(t - p["t"]) <= 900 and p["no"] in S for t, S in truth) for p in prods)
        c["prods"] = len(prods)
        # 금액·품종: 관리자 글에 번호와 같이 쓴 것(럭셔리·수정·다육사랑)
        pa = os.path.join(PKG, name, "answer_moderator.csv")
        if os.path.exists(pa):
            seen = []
            for r in csv.DictReader(open(pa, encoding="utf-8-sig")):
                nos = [int(x) for x in r["numbers"].split() if x]
                if len(nos) != 1:
                    continue
                t = float(r["sec"])
                if any(n == nos[0] and t - u < 300 for u, n in seen[-6:]):
                    continue
                seen.append((t, nos[0]))
                p = next((p for p in prods if p["no"] == nos[0] and t - 300 <= p["t"] <= t + 60), None)
                ps = [int(x) for x in r["prices"].split() if x]
                if len(ps) == 1:
                    c["pn"] += 1
                    c["pok"] += bool(p) and p["price"] == ps[0]
                tv = truth_variety(r["text"])
                if len(tv) >= 2 and not re.search(r"번", tv):
                    c["vn"] += 1
                    nm = variety.snap(p["name"], dic) if p and p["name"] else None
                    c["vok"] += near(tv, nm)
        T += c
        pc = lambda a, b: f"{c[a]}/{c[b]} ({c[a] / c[b]:.0%})" if c[b] else "-"
        print(f"{name}: 상품 {c['prods']} | 번호 정답 {pc('ok', 'n')} 정답에 없는 {c['notruth']} | 금액 {pc('pok', 'pn')} | 품종 {pc('vok', 'vn')} | {time.time() - t0:.0f}초", flush=True)
    c = T
    pc = lambda a, b: f"{c[a]}/{c[b]} ({c[a] / c[b]:.1%})" if c[b] else "-"
    print(f"[{tag}] 합계 | 번호 정답 {pc('ok', 'n')} 정답에 없는 {c['notruth']} | 금액 {pc('pok', 'pn')} | 품종 {pc('vok', 'vn')}")


if __name__ == "__main__":
    main()
