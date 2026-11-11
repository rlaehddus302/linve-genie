# 확인요청 다시 보기(사용자 제안 2026-11-10): 규칙이 확신하지 못해 판매자에게 물으려던 번호만, LLM(일꾼과 같은 Gemma 3 12B)이
# 그 앞뒤 판매자 말 + 그 순간 화면에 크게 보인 번호표를 보고 "이때 이 번호를 팔았나"를 판단한다. yes면 확정, 아니면(no·unsure) 그대로 확인요청.
# 이미 확정된 번호는 건드리지 않는다(번호를 LLM에 처음부터 맡긴 B 방식은 놓침이 늘었음 — 다육홀릭 272→243).
# 다육홀릭 11/3 확인요청 8개를 사람이 본 결과: 말은 했는데 화면에 안 잡힌 것(46·43·99), 번호 없이 가격만 말할 때 화면에 크게 보인 것(56·114) → 판매함,
#   두 번호표가 같이 보여 어느 화분인지 말로 알 수 없는 것(91), 다른 번호를 팔 때 뒤에 보인 것(2) → 판단 못 함/안 팔림
# 시험: python -m sw.judge  (보스·럭셔리·다육홀릭 + 회귀 5방송의 확인요청 전부를 판단시켜 정답과 맞춤)
#  → v1(예/아니오)은 12B가 거의 다 yes(믿을 만한 3방송 yes 21개 중 12개 틀림)라 쓰지 않음.
# v2(JUDGE=v2): 판매자가 그 번호를 말한 확인요청만, 열린 질문("판 번호와 근거 문장을 옮겨 적어") + 코드 검산
#   (옮긴 문장이 실제 받아쓰기에 있고 그 안에 그 번호가 있어야). LLM은 '파는 말인지'(인사·"4번 바뀌어요"가 아닌지) 맥락만 판단
import collections
import csv
import json
import os
import re
import sys

PRE, POST = 40, 40   # 확인요청 구간 앞뒤로 보여 줄 판매자 말(초)

PROMPT = """다육식물 유튜브 라이브 판매 방송입니다. 판매자는 화분에 붙은 번호표 번호로 상품을 팝니다.
자동 판정 프로그램이 {no}번 상품이 이때 팔렸는지 확실하지 않아 판단을 부탁합니다.

아래는 판매자가 한 말을 받아쓴 것입니다(받아쓰기 실수가 많고, 번호를 "43,55"처럼 붙여 적거나 '번'을 빼기도 합니다).
각 줄 앞 (화면 N번)은 그 순간 화면에 가장 크게 보인 번호표입니다.

{lines}

이 시간 동안 화면에 보인 번호표(보인 초 수): {seen}

질문: 이 시간에 판매자가 {no}번 화분을 상품으로 팔았습니까?
- 판매자가 {no}번을 말하며 소개하거나 가격을 말했거나 손님에게 넘겼으면 yes.
- 판매자가 번호를 말하지 않고 가격을 말하는 동안 화면에 {no}번 번호표가 가장 크게 보이고 있었으면 yes.
- 판매자가 다른 번호 상품을 팔고 있고 {no}번은 화면에 같이 보였을 뿐이면 no.
- 화면에 여러 번호표가 비슷하게 보여 어느 화분을 파는지 알 수 없거나, 근거가 부족하면 unsure.
JSON 한 줄로만 답하세요: {{"why": "짧은 이유", "answer": "yes" 또는 "no" 또는 "unsure"}}"""


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def prompt(no, s, e, lines, cand_sec, mains):
    """lines: [(초, 글)] 방송 전체(시간순), cand_sec: {초: [보인 번호]}, mains: {초: 가장 크게 보인 번호}"""
    a, b = s - PRE, e + POST
    win = [(t, x) for t, x in lines if a <= t <= b]

    def main_at(t):
        c = collections.Counter(mains.get(i) for i in range(int(t) - 1, int(t) + 4) if mains.get(i) is not None)
        return f"(화면 {c.most_common(1)[0][0]}번)" if c else "(화면 번호표 없음)"
    body = "\n".join(f"[{hms(t)}] {main_at(t)} {x}" for t, x in win) or "(이 시간에 받아쓴 말 없음)"
    seen = collections.Counter(n for i in range(int(a), int(b) + 1) for n in set(cand_sec.get(i, ())))
    seen_s = ", ".join(f"{n}번 {c}초" for n, c in seen.most_common(8)) or "없음"
    return PROMPT.format(no=no, lines=body, seen=seen_s)


PROMPT2 = """다육식물 유튜브 라이브 판매 방송에서 판매자가 한 말을 받아쓴 글입니다(받아쓰기 실수가 많고, 번호를 "43,55"처럼 붙여 적거나 '번'을 빼기도 합니다).

{lines}

이 시간에 판매자가 상품으로 판 화분 번호를 모두 찾으세요. 번호마다, 판매자가 그 번호를 상품으로 소개하거나 가격을 말하거나 손님에게 넘긴 말을 위 글에서 한 줄 그대로 옮겨 적으세요.
- 손님에게 인사만 한 것("114번 고맙습니다"), 지난번에 판 상품 이야기, 번호가 아닌 숫자("4번 바뀌어요", 가격·크기·날짜)는 적지 마세요.
- 확실한 것만 적고, 글에 없는 말을 지어내지 마세요.
한 줄에 하나씩 JSON으로만 답하세요: {{"no": 번호, "quote": "옮겨 적은 말"}}"""


# v3: 같은 방식 + 맥락 함정 예시(시험 방송 문장이 아닌, 숫자·말을 바꾼 예). 작은 모델이 문장 속 숫자를 다 줍지 않게
PROMPT3 = PROMPT2.replace("한 줄에 하나씩 JSON으로만 답하세요", """판매자 말을 맥락으로 읽으세요. 예:
- "번호 21번 아니고 84번이에요" → 84번만 (21번은 아니라고 정정함)
- "35번, 36번, 37번 만원씩 갑니다" → 35번, 36번, 37번
- "250번입니다" → 250번 (25번이 아님)
- "62번 언니 고맙습니다" → 적지 않음 (손님 인사)
- "1년에 3번 물들어요", "8번째 줄", "5번 정도 물 주세요" → 적지 않음 (번호표가 아님)
- "지난번에 19번 나갔어요" → 적지 않음 (지난 상품)
한 줄에 하나씩 JSON으로만 답하세요""")


def prompt2(s, e, lines):
    win = [(t, x) for t, x in lines if s - PRE <= t <= e + POST]
    pr = PROMPT3 if os.environ.get("JUDGE") == "v3" else PROMPT2
    return pr.format(lines="\n".join(f"[{hms(t)}] {x}" for t, x in win)), win


def _norm(x):
    return re.sub(r"[\s.,!?~'\"·…]", "", x)


def said(no, x):
    from .decide import numbers_loose, numbers_with_beon
    return no in numbers_with_beon(x) or no in numbers_loose(x)


def check2(out, no, win):
    """LLM 답에서 이 번호 + 실제 받아쓰기에 있는 문장(그 번호가 들어 있는)을 찾으면 그 문장, 아니면 None"""
    for m in re.finditer(r"\{[^{}]*\}", out):
        try:
            d = json.loads(m.group(0))
        except ValueError:
            continue
        n = d.get("no")
        n = str(n).strip().rstrip("번").strip() if isinstance(n, (int, str)) else ""
        n = int(n) if n.isdigit() else None
        q = _norm(str(d.get("quote") or ""))
        if n != no or len(q) < 4:
            continue
        for t, x in win:
            if q in _norm(x) and said(no, x):
                return x
    return None


def parse(out):
    m = re.search(r'"answer"\s*:\s*"(yes|no|unsure)"', out)
    return m.group(1) if m else "unsure"


# ---------- 시험 ----------
def _first_sellers():
    from .paths import FIRST
    from .rescore import SETS, SHARE
    from .run_regress import run as _unused  # noqa: F401 (같은 판정 코드를 쓰는지 확인용)
    from .decide import decide, loose_at, numbers_priced, numbers_with_beon
    from .screen import Screen
    for k, run_, tr in SETS:
        src = os.path.join(FIRST, "runs", run_)
        sc = Screen()
        for l in open(os.path.join(src, "screen.jsonl"), encoding="utf-8"):
            d = json.loads(l)
            sc.add(d["sec"], [tuple(z) for z in d["t"]])
        trs = [json.loads(l) for l in open(os.path.join(src, "transcript.jsonl"), encoding="utf-8")]
        voice = sorted((d["start_sec"], v) for d in trs for v in numbers_with_beon(d["text"]))
        loose = sorted(x for d in trs for x in loose_at(d["start_sec"], d.get("end_sec", d["start_sec"]), d["text"]))
        segs, cand_sec, mains = sc.build()
        priced = sorted((d["start_sec"], v) for d in trs for v in numbers_priced(d["text"]))
        items = decide(segs, cand_sec, voice, loose=loose, priced=priced)
        T = {int(r["번호"]) for r in csv.DictReader(open(os.path.join(SHARE, tr), encoding="utf-8-sig"))}
        auto = {g["no"] for g in items if g["auto"]}
        lines = [(d["start_sec"], d["text"]) for d in trs]
        for g in items:
            if not g["auto"] and not g.get("noise") and g["no"] not in auto:
                yield k, g, lines, cand_sec, mains, (g["no"] in T), None


def _regress():
    from .decide import decide
    from .regress import SETS, SP, load
    for k, vid, name in SETS:
        sc, voice, loose, truth, chat, priced = load(vid, name)
        segs, cand_sec, mains = sc.build()
        items = decide(segs, cand_sec, voice, loose=loose, priced=priced)
        lines = [(float(r["start_sec"]), r["text"]) for r in csv.DictReader(open(os.path.join(SP, "stt", "tm", "work", name, "stt_team.csv"), encoding="utf-8-sig"))]
        for g in items:
            if g["auto"] or g.get("noise"):
                continue
            ok = any(abs(t - g["s"]) <= 900 and g["no"] in S for t, S in truth)       # 관리자 글에 그 무렵 그 번호가 있음
            at = any(g["s"] - 90 <= t <= g["e"] + 30 and g["no"] in S for t, S in truth)
            yield "회귀 " + k, g, lines, cand_sec, mains, ok, at


def main2():
    from . import price
    gens = {}
    gen = lambda p, n: gens.setdefault("g", price._generator(price.LLM_MODEL))(p, n)
    ver = os.environ.get("JUDGE", "v2")
    cp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runs", f"judge_{ver}_cache.json")
    cache = json.load(open(cp, encoding="utf-8")) if os.path.exists(cp) else {}
    out_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "share", f"확인요청_LLM판단_시험_{os.environ.get('JUDGE', 'v2')}.csv")
    rows, tally = [], collections.defaultdict(collections.Counter)
    for k, g, lines, cand_sec, mains, ok, at in list(_first_sellers()) + list(_regress()):
        if not any(g["s"] - 5 <= t <= g["e"] + 5 and said(g["no"], x) for t, x in lines):
            continue   # 판매자가 그 번호를 말하지 않은 확인요청은 LLM도 근거가 없음 → 그대로 확인요청
        p, win = prompt2(g["s"], g["e"], lines)
        key = f"{k}|{g['no']}|{int(g['s'])}"
        if key not in cache:   # LLM 답은 저장해 두고 검산 코드만 바꿔 다시 돌릴 수 있게
            cache[key] = gen(p, 300)
            json.dump(cache, open(cp, "w", encoding="utf-8"), ensure_ascii=False)
        out = cache[key]
        q = check2(out, g["no"], win)
        ans = "확정" if q else "확인요청"
        tally[k][(ans, ok)] += 1
        rows.append([k, g["no"], hms(g["s"]), g["why"], ans, "정답에 있음" if ok else "정답에 없음", q or "", out.strip()])
        print(f"{k:<10} {g['no']:>4} {hms(g['s'])} → {ans:<4} {'정답O' if ok else '정답X'} {(q or '')[:60]}", flush=True)
    with open(out_p, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["방송", "번호", "시작", "규칙 판정", "LLM 뒤", "정답", "근거 문장(검산 통과)", "LLM 답 원문"])
        w.writerows(rows)
    print("\n== 요약: 확정으로 바뀐 것(정답/정답에 없음) | 확인요청 그대로(그중 정답)")
    for k, c in tally.items():
        print(f"{k:<10} 확정 {c[('확정', True)] + c[('확정', False)]:>3} (정답 {c[('확정', True)]}, 정답에 없음 {c[('확정', False)]}) | "
              f"확인요청 그대로 {c[('확인요청', True)] + c[('확인요청', False)]:>3} (정답이던 것 {c[('확인요청', True)]})")
    print(out_p)


def main():
    if os.environ.get("JUDGE") in ("v2", "v3"):
        return main2()
    from . import price
    gen = price._generator(price.LLM_MODEL)
    out_p = os.environ.get("JUDGE_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "share", "확인요청_LLM판단_시험.csv"))
    rows, tally = [], collections.defaultdict(collections.Counter)
    for k, g, lines, cand_sec, mains, ok, at in list(_first_sellers()) + list(_regress()):
        p = prompt(g["no"], g["s"], g["e"], lines, cand_sec, mains)
        out = gen(p, 120)
        ans = parse(out)
        tally[k][(ans, ok)] += 1
        rows.append([k, g["no"], hms(g["s"]), hms(g["e"]), g["why"], ans, "정답에 있음" if ok else "정답에 없음", "" if at is None else ("그 시각" if at else ""), out.strip()])
        print(f"{k:<10} {g['no']:>4} {hms(g['s'])} {g['why'][:20]:<20} → {ans:<6} {'정답O' if ok else '정답X'}", flush=True)
    with open(out_p, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["방송", "번호", "시작", "끝", "규칙 판정", "LLM 답", "정답", "회귀: 정답 시각과 맞음", "LLM 답 원문"])
        w.writerows(rows)
    print("\n== 요약: LLM이 yes(확정으로 바꿈) → 정답/오답 | no·unsure(확인요청 그대로) 중 정답 있던 것")
    for k, c in tally.items():
        print(f"{k:<10} yes {c[('yes', True)] + c[('yes', False)]:>3} (정답 {c[('yes', True)]}, 틀림 {c[('yes', False)]}) | "
              f"no {c[('no', True)] + c[('no', False)]:>3} (정답이던 것 {c[('no', True)]}) | unsure {c[('unsure', True)] + c[('unsure', False)]:>3} (정답이던 것 {c[('unsure', True)]})")
    print(out_p)


if __name__ == "__main__":
    sys.exit(main())
