# 품종 회귀 시험: 관리자 글에 번호와 품종이 같이 있는 것(럭셔리 "<셀레네> 1만5천원 319번", 수정 "151번 허니핑크 3000원", 다육사랑)을 정답으로
# 지금 품종 코드(sw/variety.py)를 채점한다. 상품 시간은 금액 시험과 같다(이미지+음성 확정 구간).
#  - 맞음: 띄어쓰기 빼고 같음 / 비슷: 자모 비슷한 정도 90 이상(블랜시아·블렌시아 같은 표기 차이)
# 사용: python -m sw.variety_regress [--llm] [--free]
import argparse
import collections
import csv
import json
import os
import re
import sys
import time

from rapidfuzz import fuzz

from . import variety as V

from .paths import PKG, REGRESS
PT = os.path.join(REGRESS, "stt", "price")
SETS = [("luxury_20261104", "CTpU2iLAIdA"), ("sujeong_20261103", "ehT8SyVBNXY"), ("dayuksarang1004_20261029", "8iSjiWdgYIA")]
STOP = {"각", "분포", "식물만", "개", "한판", "셋트", "세트", "입니다", "특가", "원", "만원", "천원", "찜"}

FREE = """다육식물 라이브 판매 방송에서 판매자가 한 말을 받아쓴 글입니다. 품종 이름은 받아쓰기가 자주 틀립니다.
판매자는 지금 {no}번 상품을 팔고 있습니다.

{lines}

{no}번 상품의 품종 이름을 받아쓰기 실수를 바로잡아 적으세요.
- 품종 이름은 보통 "자 요 아이는 ○○", "○○ 2만원", "○○ 갈게요"처럼 가격·번호 가까이에서 나옵니다. 앞뒤 다른 상품의 이름은 고르지 마세요.
- 크기·색감 설명(예: 대품, 금 잘 들었다)은 품종이 아닙니다. 이름 뒤의 금·색금·철화는 품종 이름에 포함합니다.
- 모르면 null.
JSON 한 줄로만 답하세요: {{"variety": "이름" 또는 null}}"""


def truth_variety(text):
    m = re.search(r"<\s*([^>]+?)\s*>", text)
    if m:
        s = m.group(1)
    else:
        s = re.sub(r"\d+\s*번", "", text)
        s = re.sub(r"\d[\d,.]*\s*(만|천|원|개|cm)?\s*(원)?", "", s)
        s = " ".join(w for w in re.findall(r"[가-힣A-Za-z]+", s) if w not in STOP)
    s = re.sub(r"(입니다|이에요)$", "", s.strip())
    return V.norm(s)


def same(a, b):
    return bool(a) and bool(b) and V.norm(a) == V.norm(b)


def near(a, b):
    return bool(a) and bool(b) and fuzz.ratio(V.jamo(V.norm(a)), V.jamo(V.norm(b))) >= 90


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.variety_regress")
    ap.add_argument("--llm", action="store_true")
    ap.add_argument("--free", action="store_true", help="비교용: LLM이 후보 없이 이름을 직접 적기")
    ap.add_argument("--no-harvest", action="store_true")
    ap.add_argument("--pre", type=int, default=20, help="상품 화면 구간 시작 몇 초 전부터 말을 볼지(품종은 먼저 소개하는 경우가 많음)")
    ap.add_argument("--sent", action="store_true", help="번호와 같은 문장에서 이름 뽑기(규칙)도 채점")
    ap.add_argument("--llm-csv", help="LLM을 다시 돌리지 않고 저장한 결과(LLM자유 열)를 규칙 없을 때 대신 씀")
    ap.add_argument("--snap", type=int, default=0, help="LLM이 뽑은 이름을 사전과 맞춰 철자 바로잡기 기준(0이면 안 함)")
    a = ap.parse_args()
    sys.path.insert(0, PT)
    os.environ.pop("TRIM", None)
    os.environ.pop("BLOCK", None)
    sys.argv = [sys.argv[0], "rule"]
    import price_test as pt  # noqa: E402
    from . import price

    gen = None
    if a.llm or a.free:
        _gen = price._generator(price.LLM_MODEL)   # LLM_BACKEND=llamacpp 이면 리눅스용 방식으로

        def gen(text, max_tokens=30):
            return _gen(text, max_tokens)
    c = collections.Counter()
    rows = []
    saved = {}
    if a.llm_csv:
        for r in csv.DictReader(open(a.llm_csv, encoding="utf-8-sig")):
            saved[(r["방송"], int(r["초"]), int(r["번호"]))] = r["LLM자유"] or None
    t0 = time.time()
    for name, vid in SETS:
        dic = V.Dictionary(exclude_src=vid, harvest=not a.no_harvest)
        stt, dec, _ = pt.load(name)
        seen = []
        for r in csv.DictReader(open(os.path.join(PKG, name, "answer_moderator.csv"), encoding="utf-8-sig")):
            nos = [int(x) for x in r["numbers"].split() if x]
            tv = truth_variety(r["text"])
            if len(nos) != 1 or len(tv) < 2 or re.search(r"번", tv):
                continue
            t = float(r["sec"])
            if any(n == nos[0] and t - u < 300 for u, n in seen[-6:]):
                continue
            seen.append((t, nos[0]))
            e = {"t": t, "no": nos[0]}
            lines, _ = pt.window(stt, dec, e)
            if a.pre != 20:
                seg = [d for d in dec if int(d["number"]) == e["no"] and float(d["start_sec"]) - 30 <= t and float(d["end_sec"]) >= t - 150]
                if seg:
                    lines = [(u, x) for u, x in stt if float(seg[0]["start_sec"]) - a.pre <= u <= float(seg[-1]["end_sec"]) + V.VPOST]
            win = price.trim(lines, e["no"])
            text = " ".join(x for _, x in win)
            cands = V.candidates(win, dic)
            top = cands[0][0] if cands else None
            c["n"] += 1
            c["in_dict"] += any(near(tv, k) for k in dic.names.values()) if tv not in dic.names else 1
            c["said_exact"] += V.norm(tv) in V.norm(text)
            c["cand_same"] += any(same(tv, n) for n, _, _ in cands)
            c["cand_near"] += any(near(tv, n) for n, _, _ in cands)
            c["top_same"] += same(tv, top)
            c["top_near"] += near(tv, top)
            pick = top
            if a.llm and len(cands) > 1:
                out = gen(V.prompt(e["no"], win, cands))
                m = re.search(r'"choice"\s*:\s*(\d+)', out)
                k = int(m.group(1)) if m else 0
                pick = cands[k - 1][0] if 1 <= k <= len(cands) else None
            c["pick_same"] += same(tv, pick)
            c["pick_near"] += near(tv, pick)
            free = None
            if a.free:
                out = gen(V.FREE.format(no=e["no"], lines=V.fmt(win)), 40)
                m = re.search(r'"variety"\s*:\s*"([^"]+)"', out)
                free = m.group(1) if m else None
                if free and a.snap:
                    free = V.snap(free, dic, a.snap, lines=win)   # 일꾼과 같은 바로잡기(색금·군말·손님 이름·사전)
                c["free_same"] += same(tv, free)
                c["free_near"] += near(tv, free)
            if a.sent:
                sent = V.said_with_number(win, e["no"], dic, need_dict=bool(os.environ.get("NEED_DICT")))
                sent = V.snap(sent, dic, 85, lines=win) if sent else None
                if a.llm_csv:
                    free = saved.get((name, int(t), e["no"]))
                both = sent or free
                c["sent_found"] += sent is not None
                c["sent_same"] += same(tv, sent)
                c["sent_near"] += near(tv, sent)
                c["both_same"] += same(tv, both)
                c["both_near"] += near(tv, both)
                why = "맞음" if near(tv, both) else ("못 찾음" if not both else ("손님 이름" if any(fuzz.partial_ratio(V.jamo(n), V.jamo(V.norm(both))) >= 85 for n in V.nicknames(win)) else "다른 이름"))
                c["why_" + why] += 1
                free = f"{both} (규칙:{sent or '-'})"
            rows.append([name, int(t), e["no"], tv, top, pick, free, "; ".join(f"{n}({s})" for n, s, _ in cands)])
    n = c["n"]
    pc = lambda k: f"{c[k] / n:.0%}"
    print(f"[품종{' +LLM' if a.llm else ''}{' +자유' if a.free else ''}{' (거둔 이름 없이)' if a.no_harvest else ''}] {n}건 | 사전에 있음(비슷 포함) {pc('in_dict')} | "
          f"받아쓴 글에 그대로 {pc('said_exact')} | 후보에 정답 {pc('cand_same')}/비슷 {pc('cand_near')} | 규칙 1순위 {pc('top_same')}/비슷 {pc('top_near')} | "
          f"고른 것 {pc('pick_same')}/비슷 {pc('pick_near')}" + (f" | LLM 자유 {pc('free_same')}/비슷 {pc('free_near')}" if a.free else "") + (f" | 번호 문장 규칙: 찾음 {pc('sent_found')}, 맞음 {pc('sent_same')}/비슷 {pc('sent_near')} | 규칙→없으면 LLM: {pc('both_same')}/비슷 {pc('both_near')} | 틀린 이유 " + ", ".join(f"{k[4:]} {v}" for k, v in c.items() if k.startswith("why_")) if a.sent else "") + f" | {time.time() - t0:.0f}초")
    out = os.path.join(os.path.dirname(__file__), "..", "data", "variety_regress_last.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["방송", "초", "번호", "정답", "규칙1순위", "고른것", "LLM자유", "후보"])
        w.writerows(rows)


if __name__ == "__main__":
    main()
