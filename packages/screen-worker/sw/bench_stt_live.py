# 받아쓰기(STT) 비교 시험: 모델 × 자르기 × 힌트를 같은 방송 소리·같은 채점으로 잰다 (개선 계획 B0·B7·D1·D6, 문서 docs/stt-compare.md).
# 사람이 받아쓴 정답은 없다. 정답 = 방송 끝 시점의 번호·품종·가격(products.json) + 그 번호를 일꾼이 등록한 시각(events.jsonl의 LLM등록).
# "이 번호를 소개한 구간에 이 품종 이름·번호·금액이 받아쓴 글에 맞게 나오는가"를 센다(대리 지표).
#   글만으로(소리 없이):  python -m sw.bench_stt_live text  --truth products.json --runs <일꾼 실행 폴더들>
#   소리 받아쓰기:        python -m sw.bench_stt_live run   --audio a.wav --out <폴더> --backend mlx --cut pause:400 [--hint-truth products.json]
#   영상 시각 맞추기:      python -m sw.bench_stt_live align --transcript <폴더>/transcript.jsonl --runs … --release-ts <방송 시작 유닉스초>
#   채점:                python -m sw.bench_stt_live score --transcript … --truth … --runs … --offsets offsets.json
#   두 받아쓰기 일치도:    python -m sw.bench_stt_live agree --a … --b …
# 소리·받아쓴 글·결과는 저장소 밖에 둔다(손님 닉네임이 불린다). 이 파일의 채점·맞추기·이어 붙이기는 순수 함수다(시계·파일·모델을 쓰지 않는다).
import argparse
import collections
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time

from . import price, variety
from .decide import numbers_with_beon
from .lg.cleanup import clean_text
from .lg.segmenter import (SAMPLE_RATE, WORKER_CUT_LOOKBACK_MS, WORKER_POST_ROLL_MS, WORKER_PRE_ROLL_MS, Segmenter)

SR = SAMPLE_RATE
FRAME = 512                                   # silero 틀 하나(32ms)
WATCH = ("색금", "삼광", "청개구리", "녹금", "창녹금", "찐녹", "빅뱅", "손톱", "팔색조")
BUCKETS = ((0.0, 1.5), (1.5, 3.0), (3.0, 6.0), (6.0, 12.0), (12.0, 1e9))
HINT_CHAR_LIMIT = 260                         # apps/server/src/voice/varieties.ts composeHint와 같은 한도
LIVE_WORKER = "python -m sw https://"         # 맥 미니에서 실제 방송을 듣는 화면 일꾼(이것이 돌면 무거운 계산을 하지 않는다)


# ---------- 읽기 ----------
def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]


def load_truth(path, min_no=0, rename=None):
    """products.json → {번호: {name, price, phase, sold}}. min_no보다 작은 번호는 뺀다(어제는 세 자리 번호만 썼고 2·5·27 같은 번호는
    일꾼이 잘못 넣은 채 남은 것). rename = {'상광': '삼광'}처럼 정답 목록에 틀린 채 남은 이름을 바로잡는다"""
    out = {}
    for p in json.load(open(path, encoding="utf-8"))["products"]:
        if int(p["no"]) < min_no:
            continue
        p = dict(p)
        p["name"] = (rename or {}).get((p.get("name") or "").strip(), (p.get("name") or "").strip())
        out[int(p["no"])] = p
    return out


def load_run(run_dir):
    """일꾼 실행 폴더 하나 → {name, lines, regs}. 시각은 그 실행의 0초부터(영상 시각이 아니다)"""
    regs = [e for e in read_jsonl(os.path.join(run_dir, "events.jsonl")) if e.get("kind") == "LLM등록"]
    return {"name": os.path.basename(os.path.normpath(run_dir)), "lines": read_jsonl(os.path.join(run_dir, "transcript.jsonl")), "regs": regs}


# ---------- 일꾼 실행 시각 ↔ 영상 시각 ----------
def folder_start_sec(name):
    """'xhv-E5HEWUw-20261112_105438' → 그날 0시부터 센 초(한국 시각 10:54:38 = 39278). 모양이 다르면 None"""
    m = re.search(r"_(\d{2})(\d{2})(\d{2})$", name)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else None


def coarse_offset(regs, release_ts):
    """시계로 어림한 (영상 시각 − 실행 시각). 등록 기록의 line_seen_wall(그 줄을 받아쓴 벽시계) − line_end_sec(그 줄 끝의 실행 시각)의
    가장 작은 값 = 실행 0초의 벽시계 + 받아쓰기 지연. 여기서 방송 시작(release_ts)을 뺀다.
    일꾼은 유튜브가 내보낸 뒤에 듣기 때문에 실제 값은 이것보다 유튜브 지연(몇 초~30초)만큼 작다 → align_offset으로 글을 맞춰 바로잡는다"""
    seen = [e["line_seen_wall"] - e["line_end_sec"] for e in regs if e.get("line_seen_wall") is not None and e.get("line_end_sec") is not None]
    return min(seen) - release_ts if seen else None


def align_offset(ref, new, coarse, slack=120.0, min_chars=6, cutoff=75, tol=1.5):
    """글로 맞춘 (영상 시각 − 실행 시각). ref = 일꾼 실행의 [(시작초, 글)], new = 영상 소리를 같은 방식으로 다시 받아쓴 [(시작초, 글)].
    ref의 긴 줄마다 coarse 근처(±slack)에서 가장 비슷한 new 줄을 찾아 시각 차이를 모으고, 가장 많이 모인 값(±tol)의 가운데값을 낸다.
    → (차이 또는 None, 그 값에 모인 줄 수, 짝을 찾은 줄 수). 모인 줄이 5개 미만이면 믿지 않는다(None)"""
    from rapidfuzz import fuzz
    new = sorted(new)
    deltas = []
    for rs, rt in ref:
        key = variety.norm(rt)
        if len(key) < min_chars:
            continue
        lo, hi = coarse + rs - slack, coarse + rs + slack
        best, best_s = None, cutoff
        for ns, nt in new:
            if ns < lo:
                continue
            if ns > hi:
                break
            s = fuzz.ratio(key, variety.norm(nt))
            if s > best_s:
                best, best_s = ns, s
        if best is not None:
            deltas.append(best - rs)
    if not deltas:
        return None, 0, 0
    support, center = max((sum(abs(x - d) <= tol for x in deltas), d) for d in deltas)
    near = [x for x in deltas if abs(x - center) <= tol]
    return (round(statistics.median(near), 2) if support >= 5 else None), support, len(deltas)


# ---------- 상품 소개 구간과 채점 ----------
def intro_windows(runs, offsets, truth, pre=20.0, post=40.0):
    """등록 기록 → 상품 소개 구간 [{no, name, price, t, t0, t1}] (영상 시각). runs = [(실행 이름, 등록들)], offsets = {실행 이름: 영상 − 실행}.
    정답에 없거나 판매자가 지운 번호(CLOSED, 대부분 잘못 넣은 번호)는 뺀다. 같은 번호는 처음 등록만"""
    out, seen = [], set()
    for name, regs in runs:
        off = offsets.get(name)
        if off is None:
            continue
        for e in regs:
            no = int(e["no"])
            p = truth.get(no)
            if p is None or p.get("phase") == "CLOSED" or no in seen:
                continue
            seen.add(no)
            t = off + float(e["start_sec"])
            out.append({"no": no, "name": (p.get("name") or "").strip(), "price": p.get("price"), "t": round(t, 2),
                        "t0": round(t - pre, 2), "t1": round(t + post, 2)})
    return sorted(out, key=lambda w: w["t"])


def text_in(lines, t0, t1):
    """t0~t1에 걸친 줄의 글을 이어 붙인다"""
    return " ".join(x["text"] for x in lines if x["end_sec"] > t0 and x["start_sec"] < t1)


def name_hit(text, name):
    """품종 이름이 글자 그대로(띄어쓰기·문장부호 무시) 들어 있는가. 빈 이름은 False"""
    n = variety.norm(name)
    return bool(n) and n in variety.norm(text)


def number_hit(text, no):
    """'326번', '삼백이십육번'처럼 번호로 말한 것"""
    return no in numbers_with_beon(text)


def number_loose(text, no):
    """'번' 없이 숫자만 적힌 것까지"""
    return number_hit(text, no) or re.search(rf"(?<![\d,.]){no}(?![\d,.]*\d)", text) is not None


def price_hit(text, won):
    """단위를 붙여 말한 금액('20만원', '이십만 원')"""
    return won in price.prices_in(text)


def price_loose(text, won, unit=10000):
    """단위 없이 말한 금액('20까지', '35에 드릴게요')도 판매자 단위(만원)로 읽어서"""
    return won in [v for v, _ in price.prices_said(text, unit)]


def score(lines, windows, fix=None):
    """소개 구간마다 품종·번호·금액이 받아쓴 글에 맞게 있는지 센다. fix = 글을 바로잡는 함수(사전 교정 효과를 잴 때)"""
    c = collections.Counter()
    per = collections.defaultdict(lambda: [0, 0])
    for w in windows:
        text = text_in(lines, w["t0"], w["t1"])
        if fix:
            text = fix(text)
        c["products"] += 1
        c["heard"] += bool(text.strip())
        c["no"] += number_hit(text, w["no"])
        c["no_loose"] += number_loose(text, w["no"])
        if w["price"]:
            c["priced"] += 1
            c["price"] += price_hit(text, w["price"])
            c["price_loose"] += price_loose(text, w["price"])
        if w["name"]:
            c["named"] += 1
            hit = name_hit(text, w["name"])
            c["name"] += hit
            per[w["name"]][0] += hit
            per[w["name"]][1] += 1
    return {**{k: c[k] for k in ("products", "heard", "no", "no_loose", "priced", "price", "price_loose", "named", "name")},
            "per_name": {k: v for k, v in per.items()}}


def count_exact(lines, names=WATCH):
    """방송 전체에서 이름이 글자 그대로 나온 횟수 {이름: 횟수}. 긴 이름부터 세고 지워서 '창녹금'을 '녹금'으로 또 세지 않는다"""
    out = {n: 0 for n in names}
    order = sorted(names, key=lambda n: -len(variety.norm(n)))
    for x in lines:
        t = variety.norm(x["text"])
        for n in order:
            k = variety.norm(n)
            out[n] += t.count(k)
            t = t.replace(k, " ")
    return out


# ---------- 소리가 비슷한 말 찾기·사전으로 바로잡기 ----------
_DOUBLE = str.maketrans({"ㄲ": "ㄱㄱ", "ㄸ": "ㄷㄷ", "ㅃ": "ㅂㅂ", "ㅆ": "ㅅㅅ", "ㅉ": "ㅈㅈ"})


def jamo2(s):
    """variety.jamo(자모 풀기, ㅔ=ㅐ)에 된소리를 예사소리 둘로 더 푼다: '새껌'(ㅅㅐㄱㄱㅓㅁ)이 '색금'(ㅅㅐㄱㄱㅡㅁ)과 한 글자 차이가 된다"""
    return variety.jamo(s).translate(_DOUBLE)


def _words(text):
    return [m for m in re.finditer(r"[가-힣A-Za-z0-9]+", text)]


def near_forms(lines, target, cutoff=75, known=()):
    """target을 말한 것으로 보이는 낱말을 적힌 모양별로 센다({'색금': 68, '세금': 62, …}). 글자 그대로 든 낱말은 target으로 센다.
    한 낱말, 그다음 붙여 읽은 두 낱말을 본다. known(다른 품종 이름)과 글자 그대로 같은 말은 세지 않는다('녹금'은 '창녹금'을 틀리게 적은 것이 아니다).
    두 글자 이름은 평범한 낱말과도 소리가 비슷해(세금·상관) 어림이다"""
    from rapidfuzz import fuzz
    tk = variety.norm(target)
    key, n = jamo2(tk), len(tk)
    other = {variety.norm(k) for k in known} - {tk}
    out = collections.Counter()

    def near(p):
        return len(p) >= 2 and n - 1 <= len(p) <= n + 1 and p not in other and fuzz.ratio(jamo2(p), key) >= cutoff
    for x in lines:
        ws = [variety._JOSA.sub("", m.group(0)) or m.group(0) for m in _words(x["text"])]
        i = 0
        while i < len(ws):
            if tk in ws[i]:
                out[target] += 1
            elif near(ws[i]):
                out[ws[i]] += 1
            elif i + 1 < len(ws) and tk not in ws[i + 1] and tk in ws[i] + ws[i + 1]:
                out[target] += 1
                i += 1
            elif i + 1 < len(ws) and tk not in ws[i + 1] and not near(ws[i + 1]) and near(ws[i] + ws[i + 1]):
                out[ws[i] + ws[i + 1]] += 1
                i += 1
            i += 1
    return out


class Corrector:
    """받아쓴 글의 낱말을 품종 이름 목록(판매자 장부나 품종 사전)과 견줘 소리가 가까우면 그 이름으로 바꾼다.
    한 낱말, 붙여 읽은 두 낱말을 본다. 이미 목록의 이름이 들어 있는 낱말은 건드리지 않는다. 글자 수가 한 글자 넘게 다르면 바꾸지 않는다."""

    def __init__(self, names, cutoff=80, deny=(), short_cutoff=83, long_cutoff=75):
        self.cutoff = cutoff
        self.short_cutoff = max(cutoff, short_cutoff)      # 두 글자 이름은 평범한 낱말과 겹치기 쉬워 더 엄하게('사과'→'삼광' 80점)
        self.long_cutoff = min(cutoff, long_cutoff)        # 네 글자 넘는 이름은 겹칠 낱말이 드물어 조금 느슨하게('전개구리'→'청개구리' 78점)
        self._memo = {}
        self.names = {}
        for n in names:
            k = variety.norm(n)
            if len(k) >= 2 and re.search(r"[가-힣]", k):
                self.names.setdefault(k, n)
        self.keys = list(self.names)
        self.jkeys = [jamo2(k) for k in self.keys]
        self.deny = {variety.norm(d) for d in deny}

    def best(self, phrase):
        """→ (이름, 점수) 또는 None. 이미 맞거나(이름이 들어 있음) 한글이 아니면 None"""
        p = variety.norm(phrase)
        if p not in self._memo:
            self._memo[p] = self._best(p)
        return self._memo[p]

    def _best(self, p):
        from rapidfuzz import fuzz, process
        if len(p) < 2 or not re.fullmatch(r"[가-힣]+", p) or p in self.deny or any(k in p for k in self.keys):
            return None
        for key, sc, i in process.extract(jamo2(p), self.jkeys, scorer=fuzz.ratio, score_cutoff=self.long_cutoff, limit=3):
            n = len(self.keys[i])
            need = self.short_cutoff if n <= 2 else (self.long_cutoff if n >= 4 else self.cutoff)
            if sc >= need and abs(n - len(p)) <= 1:
                return self.names[self.keys[i]], sc
        return None

    def correct(self, text):
        """→ (바로잡은 글, [(들린 말, 바꾼 이름, 점수)])"""
        ws = _words(text)
        out, changes, pos, i = [], [], 0, 0
        while i < len(ws):
            pick = None
            for span in (2, 1):
                if i + span > len(ws):
                    continue
                raw = "".join(m.group(0) for m in ws[i:i + span])
                for cand in (raw, variety._JOSA.sub("", raw)):
                    b = self.best(cand)
                    if b and (pick is None or b[1] > pick[1]):
                        pick = (b[0], b[1], span, cand, raw[len(cand):])
                if pick and pick[2] == 2:
                    break
            if pick:
                name, sc, span, heard, tail = pick
                out.append(text[pos:ws[i].start()] + name + tail)
                pos = ws[i + span - 1].end()
                changes.append((heard, name, round(sc, 1)))
                i += span
            else:
                i += 1
        out.append(text[pos:])
        return "".join(out), changes


def compose_hint(names, limit=HINT_CHAR_LIMIT):
    """서버의 composeHint와 같은 모양: 품종 이름만 ', '로 이어 한도 안에서 자르고 마침표. 빈 목록이면 빈 글"""
    seen, parts, length = set(), [], 0
    for n in names:
        n = (n or "").strip()
        k = variety.norm(n).lower()
        if not k or k in seen:
            continue
        if length + len(n) + 2 > limit:
            break
        seen.add(k)
        parts.append(n)
        length += len(n) + 2
    return ", ".join(parts) + "." if parts else ""


def ledger_names(truth, skip=("제곱", "통채", "20개")):
    """정답 목록의 품종 이름을 많이 나온 순으로(판매자 장부가 잘 채워졌을 때를 흉내). 품종이 아닌 말은 뺀다"""
    c = collections.Counter(p["name"].strip() for p in truth.values() if p.get("phase") != "CLOSED" and (p.get("name") or "").strip())
    return [n for n, _ in c.most_common() if n not in skip]


# ---------- 글만으로 하는 분석 ----------
_FRAG = re.compile(r"[0-9일이삼사오육칠팔구십백천만\s,.!?~]+(원|번|개)?[\s.!?~]*")


def by_length(lines, real_nos, real_prices):
    """조각 길이별로 [(구간, 줄 수, 확신도 0.6 미만, 'N번' 줄, 그중 정답에 없는 번호, 금액 줄, 그중 정답에 없는 금액, 숫자뿐인 줄)]"""
    rows = []
    for lo, hi in BUCKETS:
        c = collections.Counter()
        for x in lines:
            if not lo <= x["end_sec"] - x["start_sec"] < hi:
                continue
            c["n"] += 1
            c["low"] += x.get("conf") is not None and x["conf"] < 0.6
            nos = numbers_with_beon(x["text"])
            c["no"] += bool(nos)
            c["ghost"] += any(n not in real_nos for n in nos)
            ps = price.prices_in(x["text"])
            c["price"] += bool(ps)
            c["odd"] += any(p not in real_prices for p in ps)
            c["frag"] += _FRAG.fullmatch(x["text"].strip()) is not None
        rows.append(((lo, hi), c["n"], c["low"], c["no"], c["ghost"], c["price"], c["odd"], c["frag"]))
    return rows


def merge_by_gap(lines, min_silence_ms, roll_ms=WORKER_PRE_ROLL_MS + WORKER_POST_ROLL_MS, max_sec=20.0):
    """쉼 문턱을 min_silence_ms로 늘렸다면 조각이 어떻게 묶였을지를 받아쓴 줄의 시각만으로 어림한다(소리 없이).
    0.4초 쉼에서 자른 줄 사이의 틈 + 앞뒤 여유(0.2초씩) = 그 쉼의 길이. 쉼이 문턱보다 짧으면 앞 줄에 붙인다(20초는 넘기지 않는다).
    한 실행의 줄만 넣는다(실행마다 시각이 0부터라 섞으면 안 된다). → [{start_sec, end_sec, text, n(묶인 줄 수)}]"""
    out = []
    for x in lines:
        if out and (x["start_sec"] - out[-1]["end_sec"]) * 1000 + roll_ms < min_silence_ms and x["end_sec"] - out[-1]["start_sec"] <= max_sec:
            out[-1] = {"start_sec": out[-1]["start_sec"], "end_sec": x["end_sec"], "text": out[-1]["text"] + " " + x["text"], "n": out[-1]["n"] + 1}
        else:
            out.append({"start_sec": x["start_sec"], "end_sec": x["end_sec"], "text": x["text"], "n": 1})
    return out


# ---------- 자르기 ----------
def cut_pause(probs, min_silence_ms=400, max_segment_ms=20000, frame=FRAME):
    """틀마다의 말 확률 → [(시작초, 끝초, 조각이 나온 때의 소리 시각)]. 라이브 일꾼과 같은 자르기(sw/lg/segmenter, 앞뒤 여유 0.2초)에서 쉼 길이만 바꾼다.
    '조각이 나온 때' = 쉼을 min_silence만큼 들은 뒤(또는 20초가 찬 때) — 받아쓰기는 이때에야 시작할 수 있다"""
    seg = Segmenter(min_silence_ms=min_silence_ms, max_segment_ms=max_segment_ms, pre_roll_ms=WORKER_PRE_ROLL_MS,
                    post_roll_ms=WORKER_POST_ROLL_MS, cut_lookback_ms=WORKER_CUT_LOOKBACK_MS)
    blank = bytes(frame * 2)
    out = []
    tail = int(math.ceil((min_silence_ms + 100) * SR / 1000 / frame))
    for i, p in enumerate(list(probs) + [0.0] * tail):
        for s in seg.push(p, blank):
            out.append((s.start_sample / SR, s.end_sample / SR, (i + 1) * frame / SR))
    return out


def slide_windows(total, win=12.0, hop=2.0):
    """겹쳐 받아쓰기의 창 [(시작초, 끝초)]: hop초마다 최근 win초를 다시 받아쓴다. 마지막 창은 소리 끝에서 끝난다"""
    out, e = [], hop
    while e < total:
        out.append((max(0.0, e - win), e))
        e += hop
    out.append((max(0.0, total - win), total))
    return out


def stitch(results, hop, margin):
    """겹친 창들의 결과에서 '가운데만' 골라 한 줄씩 낸다. results = [(창 시작, 창 끝, [(a, b, 글, logprob)])] (a·b는 소리 전체 기준 초).
    창 끝이 e이면 그 창이 맡는 구간은 [e − margin − hop, e − margin): 창의 맨 끝 margin초는 다음 창이 더 길게 듣고 다시 받아쓴다.
    첫 창은 처음부터, 마지막 창은 끝까지 맡는다. 토막(낱말)은 가운데 시각이 맡은 구간에 들 때만 남긴다 → 빠지거나 두 번 나오지 않는다.
    → [{start_sec, end_sec, text, avail_sec(= 창 끝. 이 글이 나올 수 있는 가장 이른 소리 시각), lp}]"""
    out, lo = [], 0.0
    for k, (s, e, pieces) in enumerate(results):
        # 앞 창이 맡은 곳 바로 뒤부터 맡는다(마지막 창처럼 간격이 hop보다 짧아도 틈·겹침이 없다)
        hi = float("inf") if k == len(results) - 1 else max(lo, e - margin)
        keep = [p for p in pieces if lo <= (p[0] + p[1]) / 2 < hi and p[2].strip()]
        lo = hi
        if not keep:
            continue
        lps = [p[3] for p in keep if p[3] is not None]
        out.append({"start_sec": round(min(p[0] for p in keep), 2), "end_sec": round(max(p[1] for p in keep), 2),
                    "text": _join(p[2] for p in keep), "avail_sec": round(e, 2), "lp": sum(lps) / len(lps) if lps else None})
    return out


def _join(parts):
    """Whisper 낱말은 앞에 띄어쓰기를 달고 온다(' 삼백', ' 번'), Qwen 정렬기는 띄어쓰기 없는 낱말을 준다 — 둘 다 한 칸으로"""
    return re.sub(r"\s+", " ", " ".join(x.strip() for x in parts)).strip()


def queue_delays(jobs):
    """받아쓰기를 한 줄로 세워 처리할 때 말 끝에서 글이 나오기까지의 지연. jobs = [(말 끝 초, 일을 시작할 수 있는 소리 시각, 처리 초)] 시각 순.
    앞 일이 안 끝났으면 기다린다 → [지연초]"""
    out, free = [], 0.0
    for end, avail, proc in jobs:
        done = max(avail, free) + proc
        free = done
        out.append(done - end)
    return out


def pct(values, q):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, int(math.ceil(q * len(v))) - 1)]


def agreement(a, b, total=None, step=30.0):
    """두 받아쓰기의 일치도: step초 구간마다 글을 모아 자모 편집 거리 비율(0~100)의 평균. 사람 정답이 없을 때의 대리 지표"""
    from rapidfuzz import fuzz
    total = total or max([x["end_sec"] for x in a + b] or [0.0])
    scores, t = [], 0.0
    while t < total:
        ta = jamo2(variety.norm(" ".join(x["text"] for x in a if t <= (x["start_sec"] + x["end_sec"]) / 2 < t + step)))
        tb = jamo2(variety.norm(" ".join(x["text"] for x in b if t <= (x["start_sec"] + x["end_sec"]) / 2 < t + step)))
        if ta or tb:
            scores.append(fuzz.ratio(ta, tb))
        t += step
    return round(sum(scores) / len(scores), 1) if scores else None


# ---------- 모델 (무거운 것은 부를 때만 들여온다) ----------
def qwen_stt(model="TeamUNIVA/qwen3_asr_1.7b_ko", hint="", words=False, aligner="Qwen/Qwen3-ForcedAligner-0.6B", device=None):
    """Qwen3-ASR(qwen-asr 꾸러미, transformers 4.57) → fn(소리 float32 16kHz) → [(시작, 끝, 글, None)].
    시간 표시는 모델이 내지 않는다 — words=True면 따로 된 정렬 모델(Qwen3-ForcedAligner)로 낱말 시각을 붙인다(한 번에 180초까지).
    hint는 system 자리에 글로 들어간다(문맥·낱말 힌트). 실시간(streaming_transcribe)은 vLLM(엔비디아 GPU) 전용이라 맥에서는 못 쓴다."""
    import torch
    from qwen_asr import Qwen3ASRModel
    dev = device or ("cuda:0" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu"))
    dtype = torch.bfloat16 if dev.startswith("cuda") else (torch.float16 if dev == "mps" else torch.float32)
    kw = {"dtype": dtype, "device_map": dev}
    m = Qwen3ASRModel.from_pretrained(model, forced_aligner=aligner if words else None, forced_aligner_kwargs=kw if words else None,
                                      max_inference_batch_size=1, max_new_tokens=256, **kw)
    if not getattr(m.processor, "chat_template", None):
        # 미세조정 저장소에 chat_template이 빠져 있으면(TeamUNIVA 베타판이 그랬다) 모델 폴더의 chat_template.json이나 원본 모델 것을 쓴다
        from huggingface_hub import snapshot_download
        from transformers import AutoProcessor
        tpl = None
        try:
            path = os.path.join(model if os.path.isdir(model) else snapshot_download(model, local_files_only=True), "chat_template.json")
            tpl = json.load(open(path, encoding="utf-8"))["chat_template"]
        except Exception:
            tpl = AutoProcessor.from_pretrained("Qwen/Qwen3-ASR-1.7B", fix_mistral_regex=True).chat_template
        m.processor.chat_template = tpl

    def run(pcm):
        r = m.transcribe(audio=(pcm, SR), language="Korean", context=hint or "", return_time_stamps=bool(words))[0]
        if words and r.time_stamps is not None:
            return [(float(w.start_time), float(w.end_time), w.text, None) for w in r.time_stamps if (w.text or "").strip()]
        return [(0.0, len(pcm) / SR, r.text or "", None)] if (r.text or "").strip() else []
    return run


def group_words(words, gap=0.6, max_sec=8.0):
    """낱말 [(a, b, 글, lp)] → 문장쯤 되는 토막 [(a, b, 글, None)]: 낱말 사이가 gap초 넘게 비거나 토막이 max_sec을 넘으면 끊는다
    (longstt의 이어 붙이기는 문장 단위 토막을 받는다)"""
    out, cur = [], []
    for w in words:
        if cur and (w[0] - cur[-1][1] > gap or w[1] - cur[0][0] > max_sec):
            out.append((cur[0][0], cur[-1][1], _join(x[2] for x in cur), None))
            cur = []
        cur.append(w)
    if cur:
        out.append((cur[0][0], cur[-1][1], _join(x[2] for x in cur), None))
    return out


# ---------- 조각마다 다른 힌트 (D-SCR-39) ----------
# Whisper의 힌트(initial_prompt)는 224토큰(한글 260자쯤)이 한도라 가게 품종을 다 넣지 못한다. 한도는 조각 하나에 대한 것이므로,
# 먼저 힌트 없이 받아쓰고 그 글에 장부 품종과 소리가 비슷한 말이 있으면 그 후보 몇 개만 힌트로 넣어 그 조각만 다시 받아쓴다.
HINT_NEAR = 62          # 받아쓴 낱말과 장부 품종의 소리 비슷한 정도(접은 자모 비율)가 이만큼 넘으면 후보
HINT_TOP = 12           # 조각 하나에 넣는 후보 수


def hint_candidates(text, ledger, cutoff=HINT_NEAR, top=HINT_TOP):
    """받아쓴 글 → 장부 품종 가운데 소리가 비슷한 이름들(비슷한 순). ledger = variety.Ledger. 순수 함수"""
    from rapidfuzz import fuzz, process
    if not ledger:
        return []
    best = {}
    ws = [w for w in (variety._JOSA.sub("", raw) if len(raw) > 2 else raw for raw in re.findall(r"[가-힣A-Za-z]+", text or "")) if w]
    for n in (1, 2, 3):
        for i in range(len(ws) - n + 1):
            key = variety.norm("".join(ws[i:i + n]))
            if len(key) < 2:
                continue
            for _, sc, k in process.extract(variety.sjamo(key), ledger.jkeys, scorer=fuzz.ratio, score_cutoff=cutoff, limit=2):
                name = ledger.names[ledger.keys[k]]
                if len(variety.norm(name)) <= 2 and sc < 100:
                    continue                                  # 두 글자 품종은 소리가 같을 때만(흔한 두 글자 말이 다 후보가 된다)
                best[name] = max(best.get(name, 0), sc)
    return [n for n, _ in sorted(best.items(), key=lambda x: -x[1])][:top]


def hint_dynamic(stt, ledger, always=(), stats=None):
    """stt(조각, hint=None) → 조각마다 후보를 골라 한 번 더 받아쓰는 stt. always = 늘 넣는 말(옵션). stats에 조각 수·다시 받아쓴 수를 센다.
    다시 받아쓴 글이 힌트를 베낀 것뿐이면(소리 없는 조각에서 생긴다, D-V3-130) 처음 글을 쓴다"""
    stats = stats if stats is not None else {}

    def run(pcm):
        first = stt(pcm)
        stats["segments"] = stats.get("segments", 0) + 1
        cands = hint_candidates(clean_text(_join(p[2] for p in first)), ledger)
        if not cands:
            return first
        hint = compose_hint(list(cands) + list(always))
        again = stt(pcm, hint)
        stats["again"] = stats.get("again", 0) + 1
        text = clean_text(_join(p[2] for p in again))
        if not text or text.strip(" .,") in hint:
            stats["echo"] = stats.get("echo", 0) + 1
            return first
        return again
    return run


def make_stt(backend, model=None, hint="", words=False):
    """→ fn(소리 float32 16kHz) → [(시작, 끝, 글, avg_logprob 또는 None)]. words=True면 낱말마다(겹쳐 받아쓰기의 이어 붙이기용)"""
    if backend == "mlx":
        import mlx_whisper
        from . import audio
        model = model or audio.MODEL
        kw = {"path_or_hf_repo": model, "language": "ko", "task": "transcribe", "condition_on_previous_text": False, "verbose": None}
        if hint:
            kw["initial_prompt"] = hint
        if words:
            kw["word_timestamps"] = True
        else:
            kw["without_timestamps"] = True      # 라이브 일꾼(sw/audio.py)과 같게

        def run(pcm, hint=None):
            """hint를 주면 이 조각만 그 힌트로 받아쓴다(조각마다 다른 힌트 — hint_dynamic)"""
            r = mlx_whisper.transcribe(pcm, **(dict(kw, initial_prompt=hint) if hint else kw))
            if words:
                return [(w["start"], w["end"], w["word"], g.get("avg_logprob")) for g in r["segments"] for w in g.get("words", [])]
            return [(g["start"], g["end"], g["text"], g.get("avg_logprob")) for g in r["segments"]]
        return run
    if backend == "hf":
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
        dev = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        dtype = torch.float16 if dev != "cpu" else torch.float32
        proc = AutoProcessor.from_pretrained(model)
        asr = pipeline("automatic-speech-recognition", model=AutoModelForSpeechSeq2Seq.from_pretrained(model, torch_dtype=dtype).to(dev),
                       tokenizer=proc.tokenizer, feature_extractor=proc.feature_extractor, torch_dtype=dtype, device=dev)
        gen = {"language": "korean", "task": "transcribe"}
        if hint:
            gen["prompt_ids"] = proc.get_prompt_ids(hint, return_tensors="pt").to(dev)

        def run(pcm):
            r = asr({"raw": pcm, "sampling_rate": SR}, return_timestamps="word" if words else True, generate_kwargs=dict(gen))
            out = [(c["timestamp"][0] or 0.0, c["timestamp"][1] or len(pcm) / SR, c["text"], None) for c in r.get("chunks", [])]
            if hint and not words:                # transformers는 힌트를 결과 앞에 그대로 붙여 돌려줄 때가 있다
                out = [(a, b, t.replace(hint, " "), lp) for a, b, t, lp in out]
            return out or ([(0.0, len(pcm) / SR, r["text"], None)] if r.get("text", "").strip() else [])
        return run
    if backend == "qwen":
        return qwen_stt(model or "TeamUNIVA/qwen3_asr_1.7b_ko", hint=hint, words=words)
    if backend == "cohere":
        # 휴대폰 마이크 길의 받아쓰기 일꾼(packages/voice/transcriber/runtime.py)과 같게. transformers 5가 있어야 한다(Qwen과 다른 가상환경).
        # 코히어는 힌트도 시간 표시도 받지 않는다 → 쉼에서 자르는 방식으로만 잴 수 있다.
        import torch
        from transformers import AutoProcessor, CohereAsrForConditionalGeneration
        model = model or "CohereLabs/cohere-transcribe-03-2026"
        dev = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        dtype = torch.float16 if dev != "cpu" else torch.float32
        proc = AutoProcessor.from_pretrained(model, local_files_only=True)
        m = CohereAsrForConditionalGeneration.from_pretrained(model, torch_dtype=dtype, local_files_only=True).to(dev).eval()

        def run(pcm):
            inputs = proc([pcm], sampling_rate=SR, return_tensors="pt", language="ko")
            inputs.to(m.device, dtype=m.dtype)
            with torch.inference_mode():
                ids = m.generate(**inputs, max_new_tokens=256)
            t = proc.decode(ids, skip_special_tokens=True)
            t = t if isinstance(t, str) else (t[0] if t else "")
            return [(0.0, len(pcm) / SR, t, None)] if t.strip() else []
        return run
    raise SystemExit(f"backend? {backend}")


def peak_memory_mb():
    """→ (프로세스 최대 상주 메모리 MB, GPU 쪽 최대 MB 또는 None). 맥의 GPU 메모리는 통합 메모리라 둘을 더한 값이 실제 쓰임에 가깝다"""
    import resource
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == "darwin" else 1024)
    gpu = None
    if "mlx.core" in sys.modules:
        try:
            gpu = sys.modules["mlx.core"].get_peak_memory() / 1024 / 1024
        except Exception:
            gpu = None
    if gpu is None and "torch" in sys.modules:
        torch = sys.modules["torch"]
        try:
            if torch.backends.mps.is_available():
                gpu = torch.mps.driver_allocated_memory() / 1024 / 1024
            elif torch.cuda.is_available():
                gpu = torch.cuda.max_memory_allocated() / 1024 / 1024
        except Exception:
            gpu = None
    return round(rss), (round(gpu) if gpu is not None else None)


def live_worker_running():
    """맥 미니에서 실제 방송 일꾼이 돌고 있는가(돌면 GPU·CPU를 나눠 쓰게 되어 방송을 방해한다)"""
    return subprocess.run(["pgrep", "-f", LIVE_WORKER], capture_output=True).returncode == 0


# ---------- 소리 받아쓰기 ----------
def vad_probs(raw, cache=None):
    """PCM16 바이트 → 틀마다의 말 확률(silero). 쉼 길이만 바꿔 다시 자를 수 있게 한 번 재서 cache(.json)에 둔다.
    cache가 다른 길이의 소리(다른 구간) 것이면 다시 잰다"""
    step = FRAME * 2
    frames = len(raw) // step
    if cache and os.path.exists(cache):
        saved = json.load(open(cache))
        if saved.get("frames") == frames:
            return saved["probs"]
    from .audio import SileroVad
    vad = SileroVad()
    probs = [round(vad.probability(raw[i * step:(i + 1) * step]), 3) for i in range(frames)]
    if cache:
        json.dump({"frames": frames, "probs": probs}, open(cache, "w"))
    return probs


def shift(lines, jobs, dt):
    """구간만 잘라 받아쓴 결과의 시각을 소리 전체 기준으로 옮긴다"""
    lines = [{**x, "start_sec": round(x["start_sec"] + dt, 2), "end_sec": round(x["end_sec"] + dt, 2), "avail_sec": round(x["avail_sec"] + dt, 2)} for x in lines]
    return lines, [(None if e is None else e + dt, a + dt, p) for e, a, p in jobs]


def parse_cut(spec):
    """'pause:400' → ('pause', 400) · 'slide:12:2:3' → ('slide', 창 12초, 2초마다, 끝 3초는 다음 창에) · 'long:30:20' → sw.longstt 방식"""
    kind, *nums = spec.split(":")
    if kind == "pause" and len(nums) == 1:
        return kind, int(nums[0])
    if kind == "slide" and len(nums) == 3:
        return kind, float(nums[0]), float(nums[1]), float(nums[2])
    if kind == "long" and len(nums) == 2:
        return kind, float(nums[0]), float(nums[1])
    raise SystemExit(f"자르기 설정을 모르겠어요: {spec} (pause:400 · slide:12:2:3 · long:30:20)")


def transcribe_cut(raw, stt, cut, t_from=0.0, t_to=None, probs_cache=None, clock=time.perf_counter, progress=None):
    """소리(PCM16 바이트)의 t_from~t_to를 cut 방식으로 받아쓴다 → (줄들, 일들 [(말 끝, 시작할 수 있는 때, 처리초)]).
    시각은 소리 전체 기준. 줄 = {start_sec, end_sec, text, conf, nos, avail_sec, proc_sec}"""
    import numpy as np
    total = len(raw) / 2 / SR
    t_to = min(total, t_to or total)
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    lines, jobs = [], []

    def conf_of(lps):
        lps = [v for v in lps if v is not None and math.isfinite(v)]
        return round(math.exp(sum(lps) / len(lps)), 3) if lps else None

    if cut[0] == "pause":
        probs = vad_probs(raw, probs_cache)
        for a, b, emit in cut_pause(probs, cut[1]):
            if b <= t_from or a >= t_to:
                continue
            t0 = clock()
            pieces = stt(pcm[int(a * SR): int(b * SR)])
            proc = clock() - t0
            jobs.append((b, emit, proc))
            text = clean_text(_join(p[2] for p in pieces))
            if text:
                lines.append({"start_sec": round(a, 2), "end_sec": round(b, 2), "text": text, "conf": conf_of([p[3] for p in pieces]),
                              "nos": numbers_with_beon(text), "avail_sec": round(emit, 2), "proc_sec": round(proc, 3)})
            if progress:
                progress(b)
        return lines, jobs
    if cut[0] == "slide":
        _, win, hop, margin = cut
        results, procs = [], []
        for s, e in slide_windows(t_to - t_from, win, hop):
            s, e = s + t_from, e + t_from
            chunk = pcm[int(s * SR): int(e * SR)]
            t0 = clock()
            pieces = stt(chunk) if float(np.abs(chunk).max(initial=0.0)) > 0.01 else []
            procs.append(clock() - t0)
            results.append((s, e, [(s + p[0], s + p[1], p[2], p[3]) for p in pieces]))
            if progress:
                progress(e)
        proc_at = {round(e, 2): p for (_, e, _), p in zip(results, procs)}
        for x in stitch(results, hop, margin):
            text = clean_text(x["text"])
            if text:
                lines.append({"start_sec": x["start_sec"], "end_sec": x["end_sec"], "text": text, "conf": conf_of([x["lp"]]),
                              "nos": numbers_with_beon(text), "avail_sec": x["avail_sec"], "proc_sec": round(proc_at[x["avail_sec"]], 3)})
        jobs = [(None, e, p) for (_, e, _), p in zip(results, procs)]
        return lines, jobs
    raise SystemExit("long 방식은 sw.longstt로 돌린다: python -m sw.longstt <소리> <out.jsonl> 30 20")


def delays_of(lines, jobs, cut):
    """말 끝 → 글이 나오기까지(초). pause: 조각마다. slide: 창을 한 줄로 세워 처리했을 때 그 창이 맡은 줄의 끝에서부터"""
    if cut[0] == "pause":
        return queue_delays(jobs)
    done, free = {}, 0.0
    for _, avail, proc in jobs:
        free = max(avail, free) + proc
        done[round(avail, 2)] = free
    return [done[x["avail_sec"]] - x["end_sec"] for x in lines if x["avail_sec"] in done]


def cmd_run(a):
    if live_worker_running() and not a.allow_busy:
        raise SystemExit("지금 실제 방송 일꾼이 돌고 있어요. 방송이 끝난 뒤에 돌리세요(속도만 재 보려면 --allow-busy, 결과에 표시됩니다).")
    busy = live_worker_running()
    cut = parse_cut(a.cut)
    hint = ""
    if a.hint_truth:
        hint = compose_hint(ledger_names(load_truth(a.hint_truth, 100, {"상광": "삼광"})))
    elif a.hint_file:
        hint = open(a.hint_file, encoding="utf-8").read().strip()
    os.makedirs(a.out, exist_ok=True)
    # 재는 구간만 읽는다(3시간을 통째로 올리면 소리만 1GB라 메모리 수치가 흐려진다)
    span_args = (["-ss", str(a.t_from)] if a.t_from else []) + (["-to", str(a.t_to)] if a.t_to else [])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", *span_args, "-i", a.audio, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    t0 = time.perf_counter()
    stt = make_stt(a.backend, a.model, hint=hint, words=cut[0] == "slide")
    import numpy as np
    stt(np.full(SR, 0.001, dtype=np.float32))       # 첫 호출은 준비(그래프 만들기·메모리 잡기)로 느리다 — 처리 시간에 넣지 않는다
    dyn = {}
    if a.hint_dynamic:
        if a.backend != "mlx" or cut[0] != "pause":
            raise SystemExit("조각마다 다른 힌트는 mlx·pause 자르기에서만 됩니다.")
        names = [x.strip() for x in open(a.hint_dynamic, encoding="utf-8") if x.strip()]
        always = [x.strip() for x in (a.hint_always or "").split(",") if x.strip()]
        stt = hint_dynamic(stt, variety.Ledger(names=names), always, dyn)
    load_sec = time.perf_counter() - t0
    span = len(raw) / 2 / SR
    last = [0.0]

    def progress(t):
        if t - last[0] >= 300:
            last[0] = t
            print(f"  … {t / 60:.0f}분", flush=True)
    t0 = time.perf_counter()
    lines, jobs = transcribe_cut(raw, stt, cut, probs_cache=a.vad_cache, progress=progress)
    wall = time.perf_counter() - t0
    lines, jobs = shift(lines, jobs, a.t_from)
    with open(os.path.join(a.out, "transcript.jsonl"), "w", encoding="utf-8") as f:
        for x in lines:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    d = delays_of(lines, jobs, cut)
    proc = sum(j[2] for j in jobs)
    rss, gpu = peak_memory_mb()
    durs = [x["end_sec"] - x["start_sec"] for x in lines]
    meta = {"backend": a.backend, "model": a.model, "cut": a.cut, "hint_chars": len(hint), "from": a.t_from, "to": a.t_to, "audio_sec": round(span, 1),
            "lines": len(lines), "jobs": len(jobs), "line_sec_median": round(statistics.median(durs), 2) if durs else None,
            "proc_sec": round(proc, 1), "wall_sec": round(wall, 1), "load_sec": round(load_sec, 1), "speed_x": round(span / proc, 2) if proc else None,
            "delay_median": round(statistics.median(d), 2) if d else None, "delay_p90": round(pct(d, 0.9), 2) if d else None,
            "rss_mb": rss, "gpu_mb": gpu, "audio_mb": round(len(raw) * 3 / 1024 / 1024), "live_worker_running": busy,
            **({"hint_dynamic": dyn} if a.hint_dynamic else {})}
    json.dump(meta, open(os.path.join(a.out, "meta.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False))


# ---------- 명령 ----------
def _runs(a):
    return [load_run(d) for d in a.runs]


def _offsets(a, runs):
    if getattr(a, "offsets", None):
        return json.load(open(a.offsets))
    return {r["name"]: 0.0 for r in runs}        # 일꾼 자신의 받아쓰기를 채점할 때: 실행마다 제 시각 그대로


def _row(tag, s):
    def r(k, n):
        return f"{s[k]}/{s[n]} ({s[k] / s[n]:.0%})" if s[n] else "-"
    return (f"{tag} | 상품 {s['products']} | 품종 {r('name', 'named')} | 번호 'N번' {r('no', 'products')} · 숫자만도 {r('no_loose', 'products')} | "
            f"금액 {r('price', 'priced')} · 단위 없이도 {r('price_loose', 'priced')}")


def _truth(a):
    rename = dict(x.split("=", 1) for x in (a.rename or []))
    return load_truth(a.truth, a.min_no, rename)


def _bucket(sec):
    return next(i for i, (lo, hi) in enumerate(BUCKETS) if lo <= sec < hi)


def _bucket_name(i):
    lo, hi = BUCKETS[i]
    return f"{lo:g}~{hi:g}초" if hi < 1e8 else f"{lo:g}초 이상"


def cmd_text(a):
    """어제 일꾼이 받아쓴 글만으로: 조각 길이별 오류, 품종이 적힌 모양, 사전으로 바로잡았을 때의 맞춤률"""
    truth = _truth(a)
    runs = _runs(a)
    lines = [x for r in runs for x in r["lines"]]
    real = {n for n, p in truth.items() if p.get("phase") != "CLOSED"}
    prices = {p["price"] for n, p in truth.items() if n in real and p.get("price")}
    durs = [x["end_sec"] - x["start_sec"] for x in lines]
    print(f"줄 {len(lines)} · 길이 가운데값 {statistics.median(durs):.2f}초 · 1.5초 미만 {sum(d < 1.5 for d in durs) / len(durs):.0%}")
    ledger = ledger_names(truth)
    led = Corrector(ledger, a.cutoff, deny=a.deny)
    fixed = [(x, *led.correct(x["text"])) for x in lines]

    # 1) 조각 길이별
    exact = collections.Counter()
    wrong = collections.Counter()
    order = sorted((variety.norm(n) for n in ledger), key=lambda k: -len(k))
    for x, _, changes in fixed:
        i = _bucket(x["end_sec"] - x["start_sec"])
        t = variety.norm(x["text"])
        for k in order:
            exact[i] += t.count(k)
            t = t.replace(k, " ")
        wrong[i] += len(changes)
    reg_n, reg_bad = collections.Counter(), collections.Counter()
    seen = set()
    for r in runs:
        for e in r["regs"]:
            no = int(e["no"])
            if no not in real or no in seen or not truth[no].get("price") or e.get("line") is None or e["line"] >= len(r["lines"]):
                continue
            seen.add(no)
            x = r["lines"][e["line"]]
            i = _bucket(x["end_sec"] - x["start_sec"])
            reg_n[i] += 1
            reg_bad[i] += e.get("price") != truth[no]["price"]
    print("\n조각 길이 | 줄 | 확신도<0.6 | 숫자뿐인 줄 | 'N번' 줄 중 정답에 없는 번호 | 금액 줄 중 정답에 없는 금액 | 품종 낱말 중 틀리게 적힌 것 | 그 줄에서 등록한 상품 중 가격이 정답과 다른 것")
    for i, ((lo, hi), n, low, no, ghost, pr, odd, frag) in enumerate(by_length(lines, real, prices)):
        v = exact[i] + wrong[i]
        print(f"{_bucket_name(i)} | {n} | {low} ({low / max(1, n):.0%}) | {frag} | {ghost}/{no} | {odd}/{pr} | "
              f"{wrong[i]}/{v} ({wrong[i] / max(1, v):.0%}) | {reg_bad[i]}/{reg_n[i]} ({reg_bad[i] / max(1, reg_n[i]):.0%})")

    # 1-2) 쉼 문턱을 늘리면(줄 시각으로 어림)
    print("\n쉼 문턱 | 조각 | 길이 가운데값 | 1.5초 미만 | 숫자뿐인 조각 | 말 끝에서 받아쓰기를 시작하기까지")
    for ms in (400, 800, 1200, 2000):
        merged = [m for r in runs for m in merge_by_gap(r["lines"], ms)]
        d = [m["end_sec"] - m["start_sec"] for m in merged]
        frag = sum(_FRAG.fullmatch(m["text"].strip()) is not None for m in merged)
        print(f"{ms / 1000:g}초 | {len(merged)} | {statistics.median(d):.1f}초 | {sum(v < 1.5 for v in d) / len(d):.0%} | {frag} | {ms / 1000:g}초")

    # 2) 품종이 적힌 모양
    print("\n품종이 적힌 모양(소리가 비슷한 말, 어림):")
    for n in WATCH:
        forms = near_forms(lines, n, a.near, known=ledger)
        ok = forms.pop(n, 0)
        print(f"  {n}: 맞음 {ok} / 비슷한 말까지 {ok + sum(forms.values())} ({ok / max(1, ok + sum(forms.values())):.0%}) · "
              + " ".join(f"{k} {v}" for k, v in forms.most_common(10)))

    # 3) 소개 구간 채점: 실행마다 제 시각 그대로(같은 번호는 방송 전체에서 첫 등록만)
    per_run, seen = [], set()
    for r in runs:
        ws = [w for w in intro_windows([(r["name"], r["regs"])], {r["name"]: 0.0}, truth, a.pre, a.post) if w["no"] not in seen]
        seen.update(w["no"] for w in ws)
        per_run.append((r, ws))

    def total(fix=None):
        t = collections.Counter()
        per = collections.defaultdict(lambda: [0, 0])
        for r, ws in per_run:
            sc = score(r["lines"], ws, fix)
            for k, v in sc.items():
                if k != "per_name":
                    t[k] += v
            for k, (h, n) in sc["per_name"].items():
                per[k][0] += h
                per[k][1] += n
        return {**t, "per_name": per}
    print(f"\n소개 구간(등록 시각 −{a.pre:g}초 ~ +{a.post:g}초) 채점:")
    base = total()
    print("  " + _row("받아쓴 그대로", base))
    results = {}
    for tag, cx in (("장부", led), ("품종 사전 전체", Corrector(list(variety.Dictionary().names.values()), a.cutoff, deny=a.deny))):
        sc = total(lambda t, cx=cx: cx.correct(t)[0])
        print("  " + _row(f"{tag}로 바로잡음(문턱 {a.cutoff:g})", sc))
        ch = collections.Counter((h, n) for x in lines for h, n, _ in cx.correct(x["text"])[1])
        print(f"    바꾼 곳 {sum(ch.values())}군데(줄 {len(lines)}): " + " ".join(f"{h}→{n} {v}" for (h, n), v in ch.most_common(a.show)))
        results[tag] = sc
    print("\n이름별(받아쓴 그대로 → 장부로 바로잡음):")
    for n, (h, k) in sorted(base["per_name"].items(), key=lambda kv: -kv[1][1])[:24]:
        print(f"  {n}: {h}/{k} → {results['장부']['per_name'][n][0]}/{k}")
    after = [{"text": t} for _, t, _ in fixed]
    print("\n방송 전체에서 적힌 횟수(받아쓴 그대로 → 장부로 바로잡음): "
          + " · ".join(f"{n} {count_exact(lines, (n,))[n]}→{count_exact(after, (n,))[n]}" for n in WATCH))


def cmd_align(a):
    runs = _runs(a)
    new = [(x["start_sec"], x["text"]) for x in read_jsonl(a.transcript)]
    out = {}
    for r in runs:
        coarse = coarse_offset(r["regs"], a.release_ts)
        off, support, pairs = align_offset([(x["start_sec"], x["text"]) for x in r["lines"]], new, coarse - a.lag, a.slack)
        print(f"{r['name']}: 시계로 {coarse:.1f}초 → 글로 맞춤 {off}초 (모인 줄 {support}/{pairs}, 유튜브 지연 {None if off is None else round(coarse - off, 1)}초)")
        out[r["name"]] = off
    if a.out:
        json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)


def cmd_score(a):
    truth = _truth(a)
    runs = _runs(a)
    lines = read_jsonl(a.transcript)
    ws = intro_windows([(r["name"], r["regs"]) for r in runs], _offsets(a, runs), truth, a.pre, a.post)
    if a.t_from or a.t_to:
        ws = [w for w in ws if w["t0"] >= a.t_from and (not a.t_to or w["t1"] <= a.t_to)]
    s = score(lines, ws)
    print(_row(a.tag or a.transcript, s))
    print("  방송 전체에서 적힌 횟수: " + " ".join(f"{k} {v}" for k, v in count_exact(lines).items()))
    if a.fix:
        cx = Corrector(ledger_names(truth), a.cutoff)
        print(_row("  + 장부로 바로잡음", score(lines, ws, lambda t: cx.correct(t)[0])))
    if a.json:
        json.dump({k: v for k, v in s.items()}, open(a.json, "w"), ensure_ascii=False, indent=1)


def cmd_agree(a):
    x, y = read_jsonl(a.a), read_jsonl(a.b)
    print(f"일치도 {agreement(x, y, step=a.step)} (자모 편집 거리 비율, {a.step:g}초 구간 평균)")


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.bench_stt_live")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, transcript=True):
        p.add_argument("--truth", required=True, help="products.json (방송 끝 시점 번호·품종·가격)")
        p.add_argument("--runs", nargs="+", required=True, help="일꾼 실행 폴더들(events.jsonl·transcript.jsonl)")
        p.add_argument("--pre", type=float, default=20.0)
        p.add_argument("--post", type=float, default=40.0)
        p.add_argument("--cutoff", type=float, default=80.0, help="사전으로 바로잡을 때 소리 비슷한 정도 문턱")
        p.add_argument("--min-no", type=int, default=100, help="이보다 작은 번호는 정답에서 뺀다(어제는 세 자리 번호만 썼다)")
        p.add_argument("--rename", nargs="*", help="정답 목록에 틀린 채 남은 이름 바로잡기: 상광=삼광")
    t = sub.add_parser("text")
    common(t)
    t.add_argument("--near", type=float, default=75.0)
    t.add_argument("--show", type=int, default=25)
    t.add_argument("--deny", nargs="*", default=[], help="바로잡지 않을 낱말")
    r = sub.add_parser("run")
    r.add_argument("--audio", required=True)
    r.add_argument("--out", required=True, help="결과 폴더(저장소 밖)")
    r.add_argument("--backend", default="mlx", choices=["mlx", "hf", "qwen", "cohere"])
    r.add_argument("--model")
    r.add_argument("--cut", default="pause:400", help="pause:<쉼 ms> · slide:<창초>:<간격초>:<끝 여유초>")
    r.add_argument("--hint-truth", help="products.json — 품종 이름을 힌트로(장부가 채워졌을 때를 흉내)")
    r.add_argument("--hint-file")
    r.add_argument("--hint-dynamic", help="품종 이름 파일(한 줄에 하나) — 조각마다 소리가 비슷한 후보만 힌트로 넣어 한 번 더 받아쓴다")
    r.add_argument("--hint-always", help="조각마다 다른 힌트에 늘 같이 넣는 말(쉼표로 나눔, 예: 옵션)")
    r.add_argument("--from", dest="t_from", type=float, default=0.0)
    r.add_argument("--to", dest="t_to", type=float)
    r.add_argument("--vad-cache", help="말 확률을 둘 파일(.json) — 쉼 길이만 바꿔 다시 돌릴 때 다시 재지 않는다")
    r.add_argument("--allow-busy", action="store_true", help="방송 일꾼이 도는 중에도 돌린다(속도 수치에 표시)")
    g = sub.add_parser("align")
    g.add_argument("--transcript", required=True, help="영상 소리를 라이브와 같은 방식(mlx turbo, pause:400)으로 받아쓴 글")
    g.add_argument("--runs", nargs="+", required=True)
    g.add_argument("--release-ts", type=float, required=True, help="방송 시작 유닉스초(yt-dlp --print release_timestamp)")
    g.add_argument("--lag", type=float, default=15.0, help="어림한 유튜브 지연(초)")
    g.add_argument("--slack", type=float, default=120.0)
    g.add_argument("--out")
    s = sub.add_parser("score")
    common(s)
    s.add_argument("--transcript", required=True)
    s.add_argument("--offsets", help="align이 쓴 offsets.json. 없으면 실행 시각 그대로(일꾼 자신의 글을 채점할 때)")
    s.add_argument("--from", dest="t_from", type=float, default=0.0)
    s.add_argument("--to", dest="t_to", type=float)
    s.add_argument("--tag")
    s.add_argument("--fix", action="store_true", help="장부로 바로잡은 뒤의 점수도")
    s.add_argument("--json")
    g2 = sub.add_parser("agree")
    g2.add_argument("--a", required=True)
    g2.add_argument("--b", required=True)
    g2.add_argument("--step", type=float, default=30.0)
    a = ap.parse_args()
    {"text": cmd_text, "run": cmd_run, "align": cmd_align, "score": cmd_score, "agree": cmd_agree}[a.cmd](a)


if __name__ == "__main__":
    main()
