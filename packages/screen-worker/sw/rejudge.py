# 저장된 화면 기록(screen.jsonl)과 받아쓴 글(transcript.jsonl)로 판정만 다시 한다 — 영상을 다시 돌리지 않고 규칙을 바꿔 볼 때.
# 사용: python -m sw.rejudge <기존 결과 폴더> <새 결과 폴더> [--min-reads 5]
# 새 폴더에 events.jsonl(확정·확인요청·금액, 뜬 시각은 근사), decisions.csv, photos/를 만든다. 금액은 규칙만(LLM 없이).
import argparse
import collections
import csv
import json
import os
import shutil
import time

from . import price, variety
from .chat import buyer_numbers
from .decide import decide, numbers_loose, numbers_priced
from .photo import best_frame
from .screen import Screen


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.rejudge")
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--min-reads", type=int, default=5)
    ap.add_argument("--chat", help="채팅 다시보기 파일(yt-dlp live_chat.json) — 손님이 친 번호를 근거로")
    ap.add_argument("--llm", action="store_true", help="금액 1순위를 맥 LLM으로도 고른다(후보 중 고르기)")
    a = ap.parse_args()
    sc = Screen()
    for l in open(os.path.join(a.src, "screen.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        sc.add(d["sec"], [tuple(z) for z in d["t"]])
    lines, voice, loose, priced = [], [], [], []
    for l in open(os.path.join(a.src, "transcript.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        lines.append((d["start_sec"], d["text"]))
        voice.extend((d["start_sec"], v) for v in d["nos"])
        loose.extend((d["start_sec"], v) for v in numbers_loose(d["text"]))
        priced.extend((d["start_sec"], v) for v in numbers_priced(d["text"]))
    voice.sort()
    llm = price.Llm() if a.llm else None
    unit = price.seller_unit(lines)
    typ, com = price.typical(lines), price.common(lines)
    dic = variety.Dictionary() if llm else None
    segs, cand_sec, mains = sc.build()
    chat = buyer_numbers(a.chat) if a.chat else []
    items = decide(segs, cand_sec, voice, min_reads=a.min_reads, loose=loose, chat=chat, priced=sorted(priced))
    known = {g["img"] for g in segs} | {g["no"] for g in items}
    os.makedirs(os.path.join(a.dst, "photos"), exist_ok=True)
    base = min(sc.tokens) if sc.tokens else 0
    for f in ("screen.jsonl", "transcript.jsonl"):
        shutil.copy(os.path.join(a.src, f), os.path.join(a.dst, f))
    n = collections.Counter()
    with open(os.path.join(a.dst, "events.jsonl"), "w", encoding="utf-8") as ev, \
            open(os.path.join(a.dst, "decisions.csv"), "w", newline="", encoding="utf-8-sig") as dc:
        w = csv.writer(dc)
        w.writerow(["start_sec", "end_sec", "number", "status", "reason", "image_candidates", "voice_mentions"])
        for g in items:
            w.writerow([round(g["s"], 1), round(g["e"], 1), g["no"], "자동확정" if g["auto"] else ("거름" if g.get("noise") else "확인요청"), g["why"],
                        ";".join(f"{k}:{v}" for k, v in g["reads"].most_common(3)), ";".join(f"{k}:{v}" for k, v in g["vs"].most_common(3))])
            if not g["auto"] and g.get("noise"):
                n["거름"] += 1
                continue
            kind = "확정" if g["auto"] else "확인요청"
            n[kind] += 1
            # 대표 사진: 그 번호로 읽힌 초 중 번호표가 가장 크게 찍힌 몇 장에서 가장 선명한 것(없으면 구간 시작)
            sec = best_frame(sc.tokens, g["no"], g["s"], g["e"], lambda i: os.path.join(a.src, "frames", f"{i - base:06d}.jpg")) or int(g["s"])
            photo = ""
            src = os.path.join(a.src, "frames", f"{sec - base:06d}.jpg")
            if os.path.exists(src):
                photo = os.path.join("photos", f"{g['no']}_{hms(sec).replace(':', '-')}.jpg")
                shutil.copy(src, os.path.join(a.dst, photo))
            # 실제 라이브에서 떴을 시각(근사): 판매자가 그 번호를 처음 말한 뒤 5초. 말 없이 화면만으로 확정했으면 구간이 끝나고 10초. 확인요청은 끝나고 30초
            said = [t for t, v in voice if v == g["no"] and g["s"] - 20 <= t <= g["e"] + 10]
            media = (max(g["s"], said[0]) + 5 if said else g["e"] + 10) if g["auto"] else g["e"] + 30
            ev.write(json.dumps({"kind": kind, "no": g["no"], "start_sec": g["s"], "end_sec": g["e"], "start_hms": hms(g["s"]), "why": g["why"],
                                 "media_sec": media, "image_reads": dict(g["reads"].most_common(3)), "voice": dict(g["vs"].most_common(3)), "photo": photo},
                                ensure_ascii=False) + "\n")
            if g["auto"]:
                win = price.trim([(t, x) for t, x in lines if g["s"] - 20 <= t <= g["e"] + 10], g["no"], known)
                r, cands = price.rule(win, g["no"], unit), price.candidates(win, unit)
                got = cands[0][0] if len(cands) == 1 else None
                if llm and len(cands) > 1:
                    llm.ask("k", g["no"], win, cands)
                    while True:
                        res = llm.poll()
                        if res:
                            got = res[0][2]
                            break
                        time.sleep(0.05)
                pick = r if r is not None else got   # 1순위는 규칙, LLM은 같은지 확인용
                agree = r is not None and r == got and not price.odd(pick, typ)
                if pick is None or price.odd(pick, typ):   # 못 찾았거나 이상한 값(1,010원): 이 방송에서 가장 흔한 가격을 채우고 확인 필요로
                    pick, agree = com, False
                ev.write(json.dumps({"kind": "금액", "no": g["no"], "start_sec": g["s"], "start_hms": hms(g["s"]), "pick": pick, "rule": r, "llm": got,
                                     "agree": agree, "candidates": [v for v, _ in cands]}, ensure_ascii=False) + "\n")
                if llm:
                    # 품종: 상품 화면 구간 60초 전부터의 말에서 LLM이 직접 뽑고 사전으로 철자를 맞춘다
                    vwin = price.trim([(t, x) for t, x in lines if g["s"] - variety.VPRE <= t <= g["e"] + variety.VPOST], g["no"], known)
                    llm.ask_variety("v", g["no"], vwin)
                    while True:
                        res = llm.poll()
                        if res:
                            raw = res[0][2]
                            break
                        time.sleep(0.05)
                    ev.write(json.dumps({"kind": "품종", "no": g["no"], "start_sec": g["s"], "start_hms": hms(g["s"]), "name": variety.decide_name(raw, g["no"], vwin, dic)[0],
                                         "raw": raw}, ensure_ascii=False) + "\n")
    if llm:
        llm.close()
    print(f"확정 {n['확정']} · 확인요청 {n['확인요청']} · 걸러 냄 {n['거름']}")


if __name__ == "__main__":
    main()
