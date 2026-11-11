# 회귀 시험: 정답(관리자 채팅)이 있는 5개 방송을 지금 판정 코드로 한 번에 채점한다. 코드를 바꿀 때마다 돌려 전체가 나빠지지 않았는지 본다.
#  - 화면: 예전에 1초마다 읽어 둔 Apple Vision 결과(data/regress/num/<id>/ocr_crop·ocr_full.jsonl)
#  - 소리: 팀원 방식 받아쓰기(data/regress/stt/tm/work/<방송>/stt_team.csv)
#  - 정답: 관리자 글에서 뽑은 번호(stt/tm/t2/img/<방송>/answer_moderator.csv — "번" 없이 쓴 글 포함)
# 점수: 자동정답(정답 글 앞 90초~뒤 30초에 그 번호 확정), 자동오류(정답 시각에 걸친 구간을 다른 번호로 확정, 근처에 정답 번호 없음),
#       정답에 없는 확정(앞뒤 15분 안 정답에 없는 번호를 확정 — 관리자가 안 올린 진짜 상품일 수도 있음), 확인요청 수
# 사용: python -m sw.regress [--strong 30,30,0]
import argparse
import collections
import csv
import json
import os
import re

from .chat import buyer_numbers, buyer_numbers_csv
from .decide import decide, loose_at, numbers_loose, numbers_priced, numbers_with_beon, voice_from_words
from .screen import Screen

from .paths import DATA, REGRESS
SP = REGRESS
SETS = [("럭셔리", "CTpU2iLAIdA", "luxury_20261104"), ("다육사랑", "v2", "dayuksarang1004_20261029"), ("수정", "ehT8SyVBNXY", "sujeong_20261103"),
        ("누리", "8RY2ENKI6ko", "nuri_20261106"), ("속초", "5Fl6ySQkhFM", "sokcho_jeongwon_20261106")]
NUM = re.compile(r"^(\d{1,3})[.번]?$")
DATA_CSV = {"v2": os.path.join(REGRESS, "num", "v2", "comments.csv")}


WORDS = os.path.join(DATA, "stt_wordts")


def load(vid, name, words=False, ocr="", transcript=None):
    """transcript: [(초, 글)]을 주면 팀원 방식 STT 대신 그 받아쓰기로(sw.bench stt — 다른 STT 모델 시험)"""
    sc = Screen()
    toks = collections.defaultdict(list)
    for f in ((f"alt_{ocr}_crop.jsonl", f"alt_{ocr}_full.jsonl") if ocr else ("ocr_crop.jsonl", "ocr_full.jsonl")):
        for l in open(os.path.join(SP, "num", vid, f), encoding="utf-8"):
            d = json.loads(l)
            for r in d["r"]:
                m = NUM.match(r["t"].strip())
                if m and r["c"] >= 0.5:
                    toks[d["i"]].append((int(m.group(1)), r["x"], r["y"], r["w"], r["h"]))
            toks.setdefault(d["i"], [])
    for i, t in toks.items():
        sc.add(i, t)
    voice, loose, priced = [], [], []
    if transcript is not None:
        for t, x in transcript:
            voice.extend((t, v) for v in numbers_with_beon(x))
            loose.extend((t, v) for v in numbers_loose(x))
            priced.extend((t, v) for v in numbers_priced(x))
    elif words:
        # 단어 단위 받아쓰기: "N번"을 말한 단어의 시각
        for l in open(os.path.join(WORDS, name + ".jsonl"), encoding="utf-8"):
            rec = json.loads(l)
            v, lo = voice_from_words(rec)
            voice.extend(v)
            loose.extend(lo)
            priced.extend((rec["start_sec"], n) for n in numbers_priced(rec["text"]))
    else:
        for r in csv.DictReader(open(os.path.join(SP, "stt", "tm", "work", name, "stt_team.csv"), encoding="utf-8-sig")):
            t = float(r["start_sec"])
            voice.extend((t, v) for v in numbers_with_beon(r["text"]))
            loose.extend(loose_at(t, float(r.get("end_sec") or t), r["text"]))
            priced.extend((t, v) for v in numbers_priced(r["text"]))
    truth = []
    for r in csv.DictReader(open(os.path.join(SP, "stt", "tm", "t2", "img", name, "answer_moderator.csv"), encoding="utf-8-sig")):
        t, nos = float(r["sec"]), {int(x) for x in r["numbers"].split() if x}
        if not any(nos == n and t - u < 300 for u, n in truth[-6:]):
            truth.append((t, nos))
    cj = os.path.join(SP, "num", vid, "chat.json")
    chat = buyer_numbers(cj) if os.path.exists(cj) else buyer_numbers_csv(DATA_CSV[vid])
    return sc, sorted(voice), sorted(loose), truth, chat, sorted(priced)


def score(items, truth):
    c = collections.Counter()
    for t, S in truth:
        near = [g for g in items if g["e"] >= t - 90 and g["s"] <= t + 30]
        at = [g for g in items if g["s"] - 5 <= t <= g["e"] + 5]
        if any(g["auto"] and g["no"] in S for g in near):
            c["ok"] += 1
        elif any(g["auto"] and g["no"] not in S for g in at) and not any(g["no"] in S for g in near):
            c["err"] += 1
        c["n"] += 1
    auto = [g for g in items if g["auto"]]
    c["auto"] = len(auto)
    c["notruth"] = sum(not any(abs(t - g["s"]) <= 900 and g["no"] in S for t, S in truth) for g in auto)
    c["review"] = sum(1 for g in items if not g["auto"] and not g.get("noise"))
    return c


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.regress")
    ap.add_argument("--chat", action="store_true", help="손님 댓글 번호도 근거로")
    ap.add_argument("--words", action="store_true", help="단어 단위 받아쓰기 시각(data/stt_wordts)으로")
    ap.add_argument("--ocr", default="", help="애플이 아닌 OCR 결과로(num/<id>/alt_<이름>_crop·full.jsonl, ocr_alt.py가 만듦)")
    ap.add_argument("--win", default="20,10", help="화면 구간 앞,뒤로 판매자 말을 볼 여유(초)")
    ap.add_argument("--strong", action="append", default=[], help="초,읽힘,최소높이,비율,큰번호표높이 (여러 번 주면 나란히 비교)")
    a = ap.parse_args()
    variants = [tuple(float(x) if "." in x else int(x) for x in s.split(",")) for s in (a.strong or ["10,10,0"])]
    data = {k: load(vid, name, a.words, a.ocr) for k, vid, name in SETS}
    print(f"{'기준(초,읽힘,높이)':<18} " + " | ".join(f"{k:^22}" for k, _, _ in SETS) + " | 합계")
    for v in variants:
        T = collections.Counter()
        cells = []
        for k, _, _ in SETS:
            sc, voice, loose, truth, chat, priced = data[k]
            segs, cand_sec, _ = sc.build()
            pre, post = (int(x) for x in a.win.split(","))
            kw = {"strong": tuple(v[:3]), "chat": chat if a.chat else (), "vpre": pre, "vpost": post, "priced": priced}
            if len(v) > 3:
                kw["share"] = v[3]
            if len(v) > 4:
                kw["brief_h"] = v[4]
            if len(v) > 5:
                kw["neighbor_aware"] = bool(v[5])
            if len(v) > 7:
                kw["strong_big"] = (v[6], v[7])
            c = score(decide(segs, cand_sec, voice, loose=loose, **kw), truth)
            T += c
            cells.append(f"정답{c['ok']/c['n']:>4.0%} 오류{c['err']:>2} 없는{c['notruth']:>3} 확인{c['review']:>3}")
        print(f"{str(v):<18} " + " | ".join(cells) + f" | 정답 {T['ok']}/{T['n']} ({T['ok']/T['n']:.1%}) 오류 {T['err']} 정답에없는확정 {T['notruth']} 확인요청 {T['review']}")


if __name__ == "__main__":
    main()
