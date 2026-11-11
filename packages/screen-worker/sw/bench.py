# 모델 비교 시험(팀 공용): 모델만 바꿔 끼우면 같은 데이터·같은 규칙·같은 채점으로 점수표가 나온다.
#   STT: python -m sw.bench stt --backend mlx --model mlx-community/whisper-large-v3-turbo [--sets boss,five]
#        python -m sw.bench stt --backend hf --model BuzzASR/korean
#        python -m sw.bench stt --backend faster --model mobiuslabsgmbh/faster-whisper-large-v3-turbo
#   OCR: python -m sw.bench ocr --plugin 내모듈:함수        (함수: PIL 이미지 → [번호들])
#        python -m sw.bench ocr --vlm mlx-community/Qwen2.5-VL-7B-Instruct-4bit
#   기준 점수(지금 쓰는 것): python -m sw.bench base
# STT는 소리를 30초씩 20초 간격(10초 겹침)으로 잘라 받아쓰고(sw.longstt), 번호·가격은 지금 일꾼의 규칙 그대로 뽑아 채점한다.
#   boss = 보스다육 11/8 (사람이 영상으로 확인한 정답 148상품, 화면 읽기는 고정)  · five = 관리자 정답 방송 5개(407상품, 금액은 3개 방송 214건)
# 결과: <데이터>/bench/<이름>/ 아래 받아쓰기와 점수(score.txt)
import argparse
import csv
import importlib
import json
import os
import shutil
import sys

from . import longstt, price
from . import regress as RG
from . import run_regress as RR
from .decide import decide
from .paths import DATA, FIRST, OCR_SHEET, REGRESS, STT_AUDIO

_BA = os.path.join(FIRST, "video", "flK4emzquko.m4a")   # 소리만(공유 묶음). 없으면 영상에서 소리를 읽는다
BOSS = ("flK4emzquko", _BA if os.path.exists(_BA) else os.path.join(FIRST, "video", "flK4emzquko.mp4"), os.path.join(FIRST, "runs", "bossfinal_flK4emzquko"),
        os.path.join(REGRESS, "boss_flK4emzquko_truth.csv"))
FIVE_AUDIO = {"luxury_20261104": "럭셔리다육TV_20261104_CTpU2iLAIdA", "dayuksarang1004_20261029": "다육사랑1004농원_20261029_8iSjiWdgYIA",
              "sujeong_20261103": "수정다육_20261103_ehT8SyVBNXY", "nuri_20261106": "누리다육_20261106_8RY2ENKI6ko",
              "sokcho_jeongwon_20261106": "속초정원다육_20261106_5Fl6ySQkhFM"}


def say(out, line):
    print(line, flush=True)
    if out:
        open(os.path.join(out, "score.txt"), "a", encoding="utf-8").write(line + "\n")


def boss_score(run_dir, out=None, label=""):
    truth = {int(r["번호"]): (int(r["가격"]) if r["가격"] else None, r["증정"] == "O") for r in csv.DictReader(open(BOSS[3], encoding="utf-8-sig"))}
    got, rev = RR.run(run_dir)
    g, filled = {}, set()
    for x in got:
        if x["no"] not in g and x["check"] and x["price"] is not None:
            filled.add(x["no"])
        g.setdefault(x["no"], x["price"])
    pk = [n for n, (p, gift) in truth.items() if p and not gift]
    pok = sum(g.get(n) == truth[n][0] and n not in filled for n in pk)
    say(out, f"[보스다육 {label}] 번호 {len(set(g) & set(truth))}/{len(truth)} | 없는 번호 {len(set(g) - set(truth))} | "
             f"가격(직접 찾음) {pok}/{len(pk)} · 흔한 값으로 채움 {len(filled & set(pk))}")


def five_score(transcripts=None, out=None, label=""):
    """transcripts: {이름: [(초, 글)]} — 없으면 팀원 방식 STT(저장본)"""
    tot = {"ok": 0, "n": 0, "err": 0}
    for k, vid, name in RG.SETS:
        sc, voice, loose, truth, chat, priced = RG.load(vid, name, transcript=(transcripts or {}).get(name))
        segs, cand_sec, _ = sc.build()
        c = RG.score(decide(segs, cand_sec, voice, loose=loose, chat=chat, priced=priced), truth)
        for x in tot:
            tot[x] += c[x]
    # 금액: 관리자 글에 번호·가격이 같이 있는 214건(럭셔리·수정·다육사랑), 상품 구간은 고정(화면+팀원 STT 판정)
    sys.path.insert(0, os.path.join(REGRESS, "stt", "price"))
    os.environ.pop("TRIM", None)
    os.environ.pop("BLOCK", None)
    argv, sys.argv = sys.argv, [sys.argv[0], "rule"]
    import price_test as pt  # noqa: E402
    sys.argv = argv
    pn = pok = 0
    for name in pt.NAMES:
        stt, dec, truth = pt.load(name)
        if transcripts and name in transcripts:
            stt = transcripts[name]
        unit = price.seller_unit(stt)
        for e in truth:
            lines, _ = pt.window(stt, dec, e)
            pn += 1
            pok += price.rule(price.trim(lines, e["no"], {int(d["number"]) for d in dec}), e["no"], unit) == e["price"]
    say(out, f"[정답 방송 5개 {label}] 번호 {tot['ok']}/{tot['n']} ({tot['ok'] / tot['n']:.1%}) 오류 {tot['err']} | 금액 {pok}/{pn} ({pok / pn:.1%})")


def cmd_base(a):
    boss_score(BOSS[2], label="지금 일꾼(0.4초 끊기 STT·Apple OCR)")
    five_score(label="팀원 방식 STT(0.4초 끊기, faster-whisper turbo)")


def cmd_stt(a):
    tag = a.name or f"stt_{a.backend}_{a.model.split('/')[-1]}"
    out = os.path.join(DATA, "bench", tag)
    os.makedirs(out, exist_ok=True)
    say(out, f"== STT {a.backend} {a.model} · {a.win:.0f}초 조각 {a.hop:.0f}초 간격")
    stt = longstt.transcriber(a.backend, a.model)
    sets = a.sets.split(",")
    if "boss" in sets:
        d = os.path.join(out, "boss")
        os.makedirs(d, exist_ok=True)
        shutil.copy(os.path.join(BOSS[2], "screen.jsonl"), d)
        tp = os.path.join(d, "transcript.jsonl")
        if not os.path.exists(tp):
            longstt.run(BOSS[1], tp, a.win, a.hop, stt)
        boss_score(d, out, tag)
    if "five" in sets:
        trs = {}
        for name, folder in FIVE_AUDIO.items():
            tp = os.path.join(out, f"{name}.jsonl")
            if not os.path.exists(tp):
                longstt.run(os.path.join(STT_AUDIO, folder, "audio.m4a"), tp, a.win, a.hop, stt)
            trs[name] = [(d["start_sec"], d["text"]) for d in map(json.loads, open(tp, encoding="utf-8"))]
        five_score(trs, out, tag)


def cmd_ocr(a):
    from PIL import Image
    from . import vlm_sheet
    labels = {r["file"]: int(r["answer"]) for r in csv.DictReader(open(os.path.join(OCR_SHEET, "labels.csv"), encoding="utf-8-sig"))}
    apple = {r["file"]: [int(x) for x in r["all_numbers"].split()] for r in csv.DictReader(open(os.path.join(OCR_SHEET, "apple_vision_result.csv"), encoding="utf-8-sig"))}
    vlm_sheet.score("Apple Vision", apple, labels)
    if a.vlm:
        sys.argv = [sys.argv[0], a.vlm]
        return vlm_sheet.main()
    mod, fn = a.plugin.split(":")
    read = getattr(importlib.import_module(mod), fn)
    reads = {f: list(read(Image.open(os.path.join(OCR_SHEET, "images", f)).convert("RGB"))) for f in labels}
    vlm_sheet.score(a.plugin, reads, labels)


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.bench")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("base")
    s = sub.add_parser("stt")
    s.add_argument("--backend", default="mlx", choices=["mlx", "faster", "hf"])
    s.add_argument("--model", required=True)
    s.add_argument("--sets", default="boss", help="boss · five · boss,five")
    s.add_argument("--win", type=float, default=30.0)
    s.add_argument("--hop", type=float, default=20.0)
    s.add_argument("--name")
    o = sub.add_parser("ocr")
    o.add_argument("--plugin", help="모듈:함수 — PIL 이미지 → [번호들]")
    o.add_argument("--vlm", help="mlx-vlm 모델 이름")
    a = ap.parse_args()
    {"base": cmd_base, "stt": cmd_stt, "ocr": cmd_ocr}[a.cmd](a)


if __name__ == "__main__":
    main()
