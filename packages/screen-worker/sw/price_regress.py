# 금액 회귀 시험: 관리자 글에 번호와 가격이 같이 있는 214건(럭셔리·수정·다육사랑)을 지금 금액 코드(sw/price.py)로 채점한다.
# 데이터 읽기와 상품 시간 찾기는 data/regress/stt/price/price_test.py를 그대로 쓴다(이미지+음성 확정 구간 [s-20, e+10]).
# 사용: python -m sw.price_regress          규칙만
#       python -m sw.price_regress --llm    규칙 + 맥 LLM(후보 중 고르기)
import argparse
import collections
import os
import sys
import time

from . import price

from .paths import REGRESS
PT = os.path.join(REGRESS, "stt", "price")


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.price_regress")
    ap.add_argument("--llm", action="store_true")
    a = ap.parse_args()
    sys.path.insert(0, PT)
    os.environ.pop("TRIM", None)
    os.environ.pop("BLOCK", None)
    sys.argv = [sys.argv[0], "rule"]
    import price_test as pt  # noqa: E402

    llm = price.Llm() if a.llm else None
    c = collections.Counter()
    t0 = time.time()
    owner = os.environ.get("PRICE_OWNER") == "1"
    screen_on = bool(os.environ.get("PRICE_OWNER"))
    from . import regress as RG
    vids = {name: vid for _, vid, name in RG.SETS}
    for name in pt.NAMES:
        stt, dec, truth = pt.load(name)
        unit = price.seller_unit(stt)
        known = {int(d["number"]) for d in dec}
        if screen_on:
            sc = RG.load(vids[name], name)[0]
            price.use_screen(sc.build()[2], known)
        for e in truth:
            lines, _ = pt.window(stt, dec, e)
            win = price.trim(lines, e["no"], known)
            if owner:
                seg = [d for d in dec if int(d["number"]) == e["no"] and float(d["start_sec"]) - 30 <= e["t"] and float(d["end_sec"]) >= e["t"] - 150]
                if seg:
                    win = [(t, x) for t, x in stt if float(seg[0]["start_sec"]) - 60 <= t <= float(seg[-1]["end_sec"]) + 30]
            r = price.rule(win, e["no"], unit)
            cands = price.candidates(win, unit)
            vals = [v for v, _ in cands]
            if llm and len(cands) > 1:
                llm.ask("k", e["no"], win, cands)
                got = None
                while True:
                    res = llm.poll()
                    if res:
                        got = res[0][2]
                        break
                    time.sleep(0.05)
            else:
                got = vals[0] if len(vals) == 1 else None
            agree = r is not None and r == got
            # 1순위는 규칙(가장 많이 말한 가격, 214건 86.0%). LLM 답을 1순위로 쓰면 84.6%로 내려가서 LLM은 같은지 확인용
            pick = r if r is not None else got
            c["n"] += 1
            c["rule"] += r == e["price"]
            c["pick"] += pick == e["price"]
            c["in_cands"] += e["price"] in vals
            c["agree"] += agree
            c["agree_ok"] += agree and r == e["price"]
            c["x10"] += pick is not None and (pick * 10 == e["price"] or pick == e["price"] * 10)
    if llm:
        llm.close()
    n = c["n"]
    print(f"[{'규칙+LLM' if a.llm else '규칙만'}] {n}건 | 규칙 {c['rule']/n:.1%} | 1순위 {c['pick']/n:.1%} | 후보에 정답 {c['in_cands']/n:.1%} | "
          f"둘이 같음 {c['agree']/n:.0%} 그중 맞음 {c['agree_ok']/max(1, c['agree']):.1%} | 10배 틀림 {c['x10']} | {time.time()-t0:.0f}초")


if __name__ == "__main__":
    main()
