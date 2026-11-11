# B5 시험(사용자 제안 2026-11-10): 가장 좋은 LLM이 받아쓴 말에서 번호·가격·품종을 모두 뽑고, 화면(OCR)은 검증·보충만.
# B4(번호·가격)와 같은 틀 + 품종까지 + 보낸 프롬프트·받은 답을 결과 폴더 llm_b5_<모델>_log.jsonl에 모두 남김(사람이 읽어 보려고).
# 사용: LLM_BACKEND=codex OPENAI_MODEL=gpt-6.1-sol python -m sw.llm_b5 [럭셔리 경성 보스 다육홀릭]
#       TRANSCRIPT=transcript_v3.jsonl 이면 다른 받아쓰기(예: Whisper large-v3 원판)로 같은 시험
import collections
import concurrent.futures as cf
import csv
import json
import os
import re
import sys
import time

from . import llm_b4 as B
from . import variety as V
from .llm_ocr import screen_of
from .paths import FIRST
from .rescore import SETS, SHARE
from .score_run import final

MODEL = B.MODEL
TR = os.environ.get("TRANSCRIPT", "transcript.jsonl")
TAG = re.sub(r"[^A-Za-z0-9.-]", "_", MODEL) + ("" if TR == "transcript.jsonl" else "_" + TR[len("transcript_"):-len(".jsonl")])

PROMPT = B.PROMPT.replace(
    '{{"line": 판매자가 그 상품의 번호나 가격을 말한 줄 번호, "no": 상품 번호(숫자, 말하지 않았으면 null), "price": 최종 가격(원 단위 숫자, 모르면 null)}}',
    '{{"line": 판매자가 그 상품의 번호나 가격을 말한 줄 번호, "no": 상품 번호(숫자, 말하지 않았으면 null), "price": 최종 가격(원 단위 숫자, 모르면 null), "variety": 품종 이름(모르면 null)}}',
).replace(
    "- 글에 없는 상품을",
    "- 품종은 판매자가 그 상품을 부른 다육식물 이름입니다(\"라울\", \"블루엘프금\"). 받아쓰기가 틀렸으면 가장 그럴듯한 실제 품종 이름으로 고쳐 적고,"
    " 이름 뒤의 금·색금·철화·복륜은 이름에 포함합니다. 크기·색감 설명(대품, 물 잘 든)과 손님 이름은 품종이 아닙니다. 말하지 않았으면 null.\n- 글에 없는 상품을",
).replace("파는 상품이 없으면 아무것도 적지 마세요.", "파는 상품이 없으면 '없음'이라고만 쓰세요.")   # 빈 답은 codex 실패와 구별이 안 됨
assert '"variety"' in PROMPT and "품종은 판매자가" in PROMPT and "'없음'이라고만" in PROMPT

GAP = B.GAP.replace('"price": 최종 가격(원 단위 숫자) 또는 null}}', '"price": 최종 가격(원 단위 숫자) 또는 null, "variety": 품종 이름 또는 null}}')
assert '"variety"' in GAP


def _log(run, kind, key, prompt, out):
    with open(os.path.join(run, f"llm_b5_{TAG}_log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"kind": kind, "key": key, "model": MODEL, "backend": B.BACKEND, "prompt": prompt, "answer": out}, ensure_ascii=False) + "\n")


def load_stt(run):
    return [(d["start_sec"], d["text"]) for d in map(json.loads, open(os.path.join(run, TR), encoding="utf-8"))]


def _var(d):
    v = d.get("variety")
    return v.strip() if isinstance(v, str) and v.strip() and v.strip().lower() != "null" else None


def extract(run, stt, cache, cp):
    C = B.chunks(stt)
    todo = [(s, L) for s, L in C if str(s) not in cache]
    print(f"  조각 {len(C)}개 중 새로 물을 것 {len(todo)}개", flush=True)

    def one(sL):
        s, L = sL
        p = PROMPT.format(lines="\n".join(f"L{i} [{B.hms(t)}] {B.mask(x)}" for i, t, x in L))
        out = B.ask(p)
        _log(run, "chunk", s, p, out)
        return s, out
    done = 0
    with cf.ThreadPoolExecutor(int(os.environ.get("LLM_PAR", 3))) as ex:
        for s, out in ex.map(one, todo):
            cache[str(s)] = out
            json.dump(cache, open(cp, "w", encoding="utf-8"), ensure_ascii=False)
            done += 1
            if done % 10 == 0:
                print(f"    {done}/{len(todo)}", flush=True)
    found = []
    for s, L in C:
        rows = B.parse(cache[str(s)], L)
        # parse()는 variety를 버리므로 같은 순서로 다시 읽어 붙인다
        vs = []
        ids = {i for i, _, _ in L}
        for m in re.finditer(r"\{[^{}]*\}", cache[str(s)]):
            try:
                d = json.loads(m.group(0))
            except ValueError:
                continue
            li = d.get("line")
            li = int(str(li).lstrip("Ll")) if li is not None and str(li).lstrip("Ll").isdigit() else None
            if li in ids and (d.get("no") is not None or d.get("price") is not None):
                vs.append(_var(d))
        for r, v in zip(rows, vs if len(vs) == len(rows) else [None] * len(rows)):
            r["variety"] = v
        found += rows
    return found


def checked(found, cand, mains):
    """B4 checked와 같고 품종을 같이 들고 다님"""
    rows = []
    for f in found:
        t = int(f["t"])
        if f["no"] is None:
            c = collections.Counter(mains[s] for s in range(t - 10, t + 21) if mains.get(s) is not None).most_common(2)
            if not c or c[0][1] < 2 or (len(c) > 1 and c[1][1] * 2 > c[0][1]):
                continue
            rows.append(dict(f, no=c[0][0], src="화면으로 채움"))
        else:
            rows.append(dict(f, src="말"))
    for r in rows:
        r["seen"] = sum(r["no"] in cand.get(s, ()) for s in range(int(r["t"]) - 30, int(r["t"]) + 61))
        r["ok"] = r["src"] == "화면으로 채움" or r["seen"] >= 2
    merged = []
    for r in sorted(rows, key=lambda r: (not r["ok"], r["t"])):
        g = next((g for g in merged if g["no"] == r["no"] and abs(g["t"] - r["t"]) <= 300), None)
        if g:
            g["prices"].append(r["price"]); g["vars"].append(r.get("variety")); g["srcs"].add(r["src"]); g["ok"] = g["ok"] or r["ok"]; g["seen"] = max(g["seen"], r["seen"])
        else:
            merged.append({"no": r["no"], "t": r["t"], "prices": [r["price"]], "vars": [r.get("variety")], "srcs": {r["src"]}, "ok": r["ok"], "seen": r["seen"]})
    for g in merged:
        ps = [p for p in g["prices"] if p]
        g["price"] = collections.Counter(ps).most_common(1)[0][0] if ps else None
        vs = [v for v in g["vars"] if v]
        g["variety"] = collections.Counter(vs).most_common(1)[0][0] if vs else None
    return merged


def rescue(run, got, segs, stt, cache, cp):
    G = B.gaps(got, segs)

    def one(g):
        key = f"gap:{g['img']}:{g['s']}"
        if key in cache:
            return key, cache[key]
        L = [(i, t, x) for i, (t, x) in enumerate(stt) if g["s"] - 30 <= t <= g["e"] + 20]
        if not L:
            return key, ""
        p = GAP.format(no=g["img"], a=B.hms(g["s"]), b=B.hms(g["e"]), sec=g["e"] - g["s"] + 1,
                       lines="\n".join(f"L{i} [{B.hms(t)}] {B.mask(x)}" for i, t, x in L))
        out = B.ask(p)
        _log(run, "gap", key, p, out)
        return key, out
    new = sum(("gap:%s:%s" % (g["img"], g["s"])) not in cache for g in G)
    print(f"  화면 구간 다시 물을 것 {new}개 / {len(G)}", flush=True)
    with cf.ThreadPoolExecutor(int(os.environ.get("LLM_PAR", 3))) as ex:
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
            add.append({"no": g["img"], "t": g["s"], "price": p, "variety": _var(d), "srcs": {"화면 구간 다시 물음"}, "ok": True, "seen": g["e"] - g["s"] + 1})
    return add, len(G)


def truth(tr):
    """정답지 → {번호: (가격, 품종)} — 품종은 '품종' 칸(럭셔리) 또는 메모 첫 부분(경성, '확인 필요: 품종'이면 뺌)"""
    T = {}
    for x in csv.DictReader(open(os.path.join(SHARE, tr), encoding="utf-8-sig")):
        v = x.get("품종") or None
        if v is None and "처음 말한 시각" in (x.get("메모") or ""):
            m = x["메모"]
            v = None if "확인 필요: 품종" in m else m.split(" / ")[0].strip() or None
        v = re.sub(r"\s*\(.*?\)", "", v).strip() or None if v else None   # '벨 (커팅)' → '벨'
        T[int(x["번호"])] = (int(x["가격"]) if x["가격"] else None, v)
    return T


def vsame(a, b):
    from rapidfuzz import fuzz
    return bool(a) and bool(b) and fuzz.ratio(V.jamo(V.norm(a)), V.jamo(V.norm(b))) >= 90


def main():
    if not MODEL:
        sys.exit("OPENAI_MODEL을 주세요(LLM_BACKEND=codex 권장)")
    order = ["럭셔리", "경성", "보스", "다육홀릭"]
    want = sys.argv[1:] or order
    S = {k: (r, tr) for k, r, tr in SETS}
    for k in [k for k in order if k in want]:
        r, tr = S[k]
        run = os.path.join(FIRST, "runs", r)
        T = truth(tr)
        t0 = time.time()
        stt = load_stt(run)
        cp = os.path.join(run, f"llm_b5_{TAG}.json")
        cache = json.load(open(cp, encoding="utf-8")) if os.path.exists(cp) else {}
        print(f"\n== {k} 시작 (정답 {len(T)}, 받아쓰기 {TR})", flush=True)
        found = extract(run, stt, cache, cp)
        cand, mains = screen_of(run)
        got = checked(found, cand, mains)
        from .screen import Screen
        sc = Screen()
        for l in open(os.path.join(run, "screen.jsonl"), encoding="utf-8"):
            d = json.loads(l)
            sc.add(d["sec"], [tuple(z) for z in d["t"]])
        segs, _, _ = sc.build()
        add, ngap = rescue(run, got, segs, stt, cache, cp)
        got += add
        E = [json.loads(l) for l in open(os.path.join(run, "events.jsonl"), encoding="utf-8")]
        A = {e["no"] for e in final(E)}
        Apr = {e["no"]: e["pick"] for e in E if e.get("kind") == "금액"}
        Avar = {e["no"]: e["name"] for e in E if e.get("kind") == "품종"}
        ok = {g["no"] for g in got if g["ok"]}
        ask_ = {g["no"] for g in got if not g["ok"]} - ok
        pr, va = {}, {}
        for g in sorted(got, key=lambda g: g["t"]):
            if g["ok"]:
                pr.setdefault(g["no"], g["price"]); va.setdefault(g["no"], g.get("variety"))
        res = {"set": k, "model": MODEL, "transcript": TR, "truth": len(T), "rows": []}

        def line(label, conf, asked, prices, vars_):
            right, wrong = conf & set(T), conf - set(T)
            pn = [n for n in right if T[n][0] is not None]
            vn = [n for n in right if T[n][1]]
            s = (f"  {label:<16} 번호: 맞게 확정 {len(right)}/{len(T)} · 틀린 확정 {len(wrong)} {sorted(wrong)[:12]} · 확인요청(정답) {len((asked - conf) & set(T))}"
                 f" · 놓침 {len(set(T) - conf - asked)} {sorted(set(T) - conf - asked)[:15]} | 가격 {sum(prices.get(n) == T[n][0] for n in pn)}/{len(pn)}")
            if any(v for _, v in T.values()):
                s += f" | 품종 {sum(vsame(vars_.get(n), T[n][1]) for n in vn)}/{len(vn)}"
            print(s, flush=True)
            res["rows"].append({"label": label, "right": sorted(right), "wrong": sorted(wrong), "asked": sorted((asked - conf) & set(T)),
                                "miss": sorted(set(T) - conf - asked), "price_ok": sum(prices.get(n) == T[n][0] for n in pn), "price_n": len(pn),
                                "var_ok": sum(vsame(vars_.get(n), T[n][1]) for n in vn), "var_n": len(vn)})
        print(f"== {k} 결과 · {MODEL}({B.BACKEND}) · LLM 상품 {len(found)}줄 · 화면 구간 다시 물음 {ngap}→판매 {len(add)} · {time.time() - t0:.0f}초")
        line("A 지금 일꾼", A, set(), Apr, Avar)
        line("B5 LLM 먼저", ok, ask_, pr, va)
        json.dump(res, open(os.path.join(run, f"llm_b5_{TAG}_score.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        # 상품 목록(사람이 보기용)
        with open(os.path.join(run, f"llm_b5_{TAG}_상품.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["번호", "시각", "가격", "품종", "근거", "화면 확인(초)", "확정", "정답 가격", "정답 품종"])
            for g in sorted(got, key=lambda g: g["t"]):
                tv = T.get(g["no"], (None, None))
                w.writerow([g["no"], B.hms(g["t"]), g["price"], g.get("variety"), "+".join(sorted(g["srcs"])), g["seen"], "확정" if g["ok"] else "확인요청", tv[0], tv[1]])


if __name__ == "__main__":
    main()
