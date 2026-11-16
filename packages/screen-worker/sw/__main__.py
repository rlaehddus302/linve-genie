# 화면 일꾼: 유튜브 라이브(또는 시험용 영상 파일)를 받아 1초마다 번호표를 읽고, 판매자 말과 맞춰 상품 번호를 확정한다.
# 사용:
#   python -m sw "https://youtu.be/<방송>"                 라이브
#   python -m sw video.mp4 --speed 4 --from 600 --to 1800   시험: 파일을 라이브처럼 흘려보냄(4배속, 10분~30분 구간)
#   python -m sw "https://youtu.be/<방송>" --post https://livegenie.kr --token-file ~/.lg_screen_token   확정 상품을 서버에 등록
# 결과(--out 폴더): events.jsonl(확정·확인요청이 나온 순서), decisions.csv(마지막 판정 전체), photos/, frames/, transcript.jsonl,
#                  post.jsonl(--post: 서버로 보낸 결과)
import argparse
import collections
import csv
import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone

from . import audio, llm_live, post, price, tagbox, tiktok, variety
from .chat import buyer_numbers
from .photo import best_frame
from .decide import decide, loose_at, numbers_priced, numbers_with_beon
from .screen import Screen, ocr_frame

KST = timezone(timedelta(hours=9))
TICK = 5            # 판정 다시 계산 간격(초, 실제 시계)
LLM_TICK = 1.0      # LLM 등록이 새 받아쓰기 줄·화면을 보는 간격(초) — 줄이 들어오면 바로 묻게(2026-11-12)
REVIEW_WAIT = 30    # 화면 구간이 끝나고 이만큼(방송 초) 지나도 확정이 안 되면 확인요청
STRONG_WAIT = 10    # 화면만으로 확정하는 규칙은 구간이 끝나고 이만큼 기다린 뒤 내보냄(그 사이 다른 번호를 말하면 취소되므로)
NAME_WAIT = 60      # --post: 금액이 나온 뒤 품종 답을 이만큼(초, 실제 시계)까지 기다렸다 보냄(서버는 같은 번호를 다시 받아도 바꾸지 않으므로 한 번에)


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def resolve(src):
    """→ (입력 목록, 라이브인지). 파일이면 그대로, 틱톡 라이브면 방 정보에서(D-SCR-TT-01), 유튜브 주소면 yt-dlp로 실제 스트림 주소"""
    if os.path.exists(src):
        return [src], False
    tt = tiktok.key_of(src)
    if tt:
        try:
            return tiktok.resolve(tt), True
        except tiktok.NotLive as e:
            raise subprocess.CalledProcessError(2, ["tiktok", tt], stderr=str(e)) from e
    ytdlp = os.path.join(os.path.dirname(sys.executable), "yt-dlp")
    info = json.loads(subprocess.run([ytdlp, "-J", "--no-warnings", src], capture_output=True, text=True, check=True).stdout)
    live = bool(info.get("is_live"))
    fmt = "best[height<=720][protocol^=m3u8]/bv*[height<=720][protocol^=m3u8]+ba[protocol^=m3u8]/best[height<=720]" if live else "bv*[height<=720]+ba/best[height<=720]"
    # 라이브가 화면+소리 합본 없이 따로만 줄 때(2026-11 확인)는 화면·소리 주소 둘 → ffmpeg 입력 둘
    urls = subprocess.run([ytdlp, "-g", "-f", fmt, "--no-warnings", src], capture_output=True, text=True, check=True).stdout.split()
    return urls, live


def wants_gemma(a):
    """맥 LLM(Gemma 3 12B)을 띄울지. 그 답(금액 확인·품종 뽑기)은 예전 규칙 등록(--register rule)만 쓴다.
    LLM 등록 길(기본, 서버로 보내는 유일한 길)은 그 답을 읽지 않으므로 띄우지 않는다 — 2026-11-16 틱톡 방송에서
    금액·품종 157번씩 답했지만 서버로 간 값은 하나도 없었고 받아쓰기와 맥 GPU만 나눠 썼다(D-SCR-GEMMA-01). 견줘 보려면 --gemma"""
    if a.no_llm:
        return False
    return getattr(a, "register", "llm") == "rule" or bool(getattr(a, "gemma", False))


class Worker:
    def __init__(self, a):
        self.a = a
        self.out = a.out
        for d in ("frames", "photos"):
            os.makedirs(os.path.join(self.out, d), exist_ok=True)
        self.base = int(a.t0)                 # 영상 안 시각 = base + 프레임 번호(초)
        self.screen = Screen()
        self.voice = []                       # [(초, 번호)]
        self.loose = []                       # [(초, 번호)] '25분'처럼 번호일 수도 있는 말 — 화면과 맞을 때만 씀
        self.vpriced = []                     # [(초, 번호)] 'N번' 뒤에 같은 문장에서 가격을 말한 번호
        self.lock = threading.Lock()
        self.audio_t = 0.0                    # 받아쓰기가 끝난 소리 시각
        self.audio_done = False
        self.emitted = []                     # 내보낸 상품 [{no, s, e, kind}]
        self.ev = open(os.path.join(self.out, "events.jsonl"), "a", encoding="utf-8")
        self.tr = open(os.path.join(self.out, "transcript.jsonl"), "a", encoding="utf-8")
        self.sc = open(os.path.join(self.out, "screen.jsonl"), "a", encoding="utf-8")
        # 번호표 위의 숫자만 번호로(D-SCR-TAG-01). 찾기 모델을 못 올리면 예전처럼 모든 숫자를 받되 일꾼 기록에 크게 남긴다
        self.finder = None
        if tagbox.ON:
            try:
                self.finder = tagbox.Finder()
            except Exception as e:  # noqa: BLE001 — 모델·라이브러리가 없어도 방송은 이어 본다
                print(f"!! 번호표 찾기 모델을 올리지 못함 — 화면의 모든 숫자를 번호 후보로 받음(줄자·가격표 숫자도 들어올 수 있음): {e}", flush=True)
        self.mains = {}
        self.lines = []                       # 받아쓴 글 [(초, 글)] — 금액 찾기용
        # 손님이 친 번호 [(초, 번호)]: 시험 모드는 채팅 다시보기 파일에서(그 시각까지 올라온 것만 씀). 라이브는 라이브지니 서버 채팅과 연결할 자리
        self.chat_all = buyer_numbers(a.chat) if a.chat else []
        self.llm = price.Llm() if wants_gemma(a) else None
        self.priced = {}                      # key → (상품 기록, 규칙 값, 후보, 말)
        self.dic = variety.Dictionary()
        self.vwins = {}                        # 품종을 물어본 상품의 말(손님 이름 거르기용)
        self.varieties = {}                   # key → 상품 기록(품종 답 기다리는 중)       # 품종 사전(라이브지니 + 거둔 이름) — LLM이 뽑은 이름 철자 맞춤용
        # --post: 확정 상품을 라이브지니 서버에 등록. 금액(+품종)이 나오면 뒤 스레드로 보낸다
        self.video_id = getattr(a, "video_id", None)
        # 켜질 때 서버가 받는 입구·항목(E11)과 이 방송의 가격 단위를 묻는다 — 임시 등록을 쓸지, 단위 없는 금액을 무엇으로 읽을지(D-SCR-18·21)
        self.poster = post.Poster(a.post, a.token_file, os.path.join(self.out, "post.jsonl"), video_id=self.video_id) if getattr(a, "post", None) else None
        self.ready = {}                       # key → 보낼 상품 {rec, price, conf, heard, t}(품종 답 기다리는 중)
        self.names = {}                       # key → 품종 이름(먼저 온 답)
        self.heard = {}                       # key → 금액을 정할 때 쓴 판매자 말 [(초, 글)] — 결과 기록·서버 heard용
        # 등록 방식(사용자 2026-11-11): llm = 2분 조각을 지식판2(gpt-5.6-sol)에 물어 등록·서버로(기본) / rule = 예전 규칙 확정+금액
        self.llmreg = llm_live.LlmRegister(self.out, self.poster, self.video_id, self._event) if getattr(a, "register", "llm") == "llm" else None

    # ---------- 입력 ----------
    def start_ffmpeg(self, inputs, live):
        a = self.a
        cmd = ["ffmpeg", "-v", "error", "-nostdin"]
        for k, src in enumerate(inputs):
            if src.startswith("http"):
                cmd += ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
            elif a.speed:
                cmd += ["-readrate", str(a.speed)]
            # 자르기는 입력 쪽에 둔다(출력 쪽 -t는 첫 출력인 화면에만 걸려 소리가 끝까지 흐른다)
            if a.t0 and not live:
                cmd += ["-ss", str(a.t0)]
            if a.t1 and not live:
                cmd += ["-t", str(a.t1 - a.t0)]
            cmd += ["-i", src]
        vmap, amap = "0:v:0", ("1:a:0" if len(inputs) > 1 else "0:a:0")
        cmd += ["-map", vmap, "-vf", "fps=1", "-q:v", "3", "-start_number", "0", os.path.join(self.out, "frames", "%06d.jpg"),
                "-map", amap, "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"]
        self.ff = subprocess.Popen(cmd, stdout=subprocess.PIPE)

    # ---------- 소리 ----------
    def audio_loop(self, q):
        lis = audio.Listener()
        n = 0
        while True:
            pcm = self.ff.stdout.read(3200)
            if not pcm:
                break
            n += len(pcm) // 2
            for s in lis.push(pcm):
                q.put(s)
        for s in lis.flush():
            q.put(s)
        q.put(None)

    def asr_loop(self, q):
        while True:
            s = q.get()
            if s is None:
                break
            text, conf = audio.transcribe(s)
            t0, t1 = self.base + s.start_ms / 1000, self.base + s.end_ms / 1000
            with self.lock:
                self.audio_t = t1
                if text:
                    self.lines.append((t0, text))
                    nos = numbers_with_beon(text)
                    self.voice.extend((t0, v) for v in nos)
                    self.loose.extend(loose_at(t0, t1, text))
                    self.vpriced.extend((t0, v) for v in numbers_priced(text))
                    self.tr.write(json.dumps({"start_sec": round(t0, 2), "end_sec": round(t1, 2), "text": text, "conf": conf, "nos": nos}, ensure_ascii=False) + "\n")
                    self.tr.flush()
        with self.lock:
            self.audio_done = True

    # ---------- 판정 ----------
    def photo(self, g):
        # 대표 사진: 그 번호로 읽힌 초 중 번호표가 가장 크게 찍힌 몇 장에서 가장 선명한 것
        sec = best_frame(self.screen.tokens, g["no"], g["s"], g["e"],
                         lambda i: os.path.join(self.out, "frames", f"{i - self.base:06d}.jpg")) or int(g["s"])
        src = os.path.join(self.out, "frames", f"{sec - self.base:06d}.jpg")
        if not os.path.exists(src):
            return ""
        dst = os.path.join("photos", f"{g['no']}_{hms(sec).replace(':', '-')}.jpg")
        shutil.copy(src, os.path.join(self.out, dst))
        return dst

    def emit(self, kind, g, now):
        rec = {"kind": kind, "no": g["no"], "start_sec": g["s"], "end_sec": g["e"], "start_hms": hms(g["s"]), "why": g["why"],
               "media_sec": now, "delay_sec": round(now - g["s"], 1), "at": datetime.now(KST).strftime("%H:%M:%S"),
               "image_reads": dict(g["reads"].most_common(3)), "voice": dict(g["vs"].most_common(3)), "photo": self.photo(g)}
        self.ev.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.ev.flush()
        mark = {"확정": "확정    ", "확인요청": "확인요청", "확정취소": "확정취소"}[kind]
        print(f"[방송 {hms(now)}] {mark} {g['no']:>4}번  ({hms(g['s'])}부터, {g['why']})", flush=True)

    def tick(self, final=False):
        with self.lock:
            voice = sorted(self.voice)
            loose = sorted(self.loose)
            vpriced = sorted(self.vpriced)
            audio_t, audio_done = self.audio_t, self.audio_done
        segs, cand_sec, self.mains = self.screen.build()
        frames = sorted(self.screen.tokens)
        if not frames:
            return
        # 지금 = 화면과 소리 둘 다 처리가 끝난 방송 시각
        now = float("inf") if final else min(frames[-1], audio_t if not audio_done else frames[-1])
        shown = now if now != float("inf") else max(frames[-1], audio_t)
        upto = shown if now != float("inf") else float("inf")
        chat = [c for c in self.chat_all if c[0] <= upto]
        items = decide(segs, cand_sec, voice, loose=loose, chat=chat, priced=vpriced)
        self.known = {g["img"] for g in segs} | {g["no"] for g in items}   # 화면에 번호표로 보인 번호(가격 구간 경계용)
        match = lambda r, g: r["no"] == g["no"] and g["s"] - 120 <= r["e"] and r["s"] <= g["e"] + 120
        for g in items:
            rec = next((r for r in self.emitted if match(r, g)), None)
            # 같은 번호의 다른 조각이 확정돼 있으면, 확정 안 된 조각 때문에 취소하지 않는다
            if not g["auto"] and rec is not None and rec["kind"] == "확정" and any(h["auto"] and match(rec, h) for h in items):
                continue
            strong_only = g["why"].startswith("화면만이지만")
            if g["auto"]:
                if strong_only and g["e"] > now - STRONG_WAIT:
                    continue
                if rec is None or rec["kind"] != "확정":
                    self.emit("확정", g, shown)
                    if rec is None:
                        self.emitted.append({"no": g["no"], "s": g["s"], "e": g["e"], "kind": "확정"})
                    else:
                        rec["kind"] = "확정"
            else:
                if rec is not None and rec["kind"] == "확정":
                    self.emit("확정취소", g, shown)
                    rec["kind"] = "확정취소"
                    if rec.get("sent"):
                        print(f"           ⚠ {g['no']}번은 이미 서버에 보냈어요 — 판매자가 앱에서 확인해야 해요", flush=True)
                elif rec is None and not g.get("noise") and g["e"] <= now - REVIEW_WAIT:
                    self.emit("확인요청", g, shown)
                    self.emitted.append({"no": g["no"], "s": g["s"], "e": g["e"], "kind": "확인요청"})
            if rec is not None:
                rec["s"], rec["e"] = min(rec["s"], g["s"]), max(rec["e"], g["e"])
        self.ask_prices(now)
        if final:
            with open(os.path.join(self.out, "decisions.csv"), "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                w.writerow(["start_sec", "end_sec", "number", "status", "reason", "image_candidates", "voice_mentions"])
                for g in items:
                    w.writerow([round(g["s"], 1), round(g["e"], 1), g["no"], "자동확정" if g["auto"] else "확인요청", g["why"],
                                ";".join(f"{k}:{v}" for k, v in g["reads"].most_common(3)), ";".join(f"{k}:{v}" for k, v in g["vs"].most_common(3))])

    # ---------- 금액 ----------
    def ask_prices(self, now):
        """확정된 상품의 화면 구간이 끝나고 10초 지나면 그 사이 판매자 말에서 금액 후보를 만든다"""
        with self.lock:
            lines = list(self.lines)
        for rec in self.emitted:
            if rec["kind"] != "확정" or rec.get("price_key") or rec["e"] + 10 > now:
                continue
            win = price.trim([(t, x) for t, x in lines if rec["s"] - 20 <= t <= rec["e"] + 10], rec["no"], getattr(self, "known", None))
            key = f"{rec['no']}@{int(rec['s'])}"
            rec["price_key"] = key
            unit = price.seller_unit(lines)
            self.typ, self.com = price.typical(lines), price.common(lines)
            r, cands = price.rule(win, rec["no"], unit), price.candidates(win, unit)
            self.heard[key] = win
            if self.llm and len(cands) > 1:
                self.priced[key] = (rec, r, cands)
                self.llm.ask(key, rec["no"], win, cands)
            else:
                self.emit_price(rec, r, None, cands)
            if self.llm:
                # 품종: 상품 화면 구간 60초 전부터의 말에서 LLM이 직접 뽑는다(사전 맞춤은 받을 때)
                vwin = price.trim([(t, x) for t, x in lines if rec["s"] - variety.VPRE <= t <= rec["e"] + variety.VPOST], rec["no"], getattr(self, "known", None))
                self.varieties[key] = rec
                self.llm.ask_variety(key, rec["no"], vwin)
                self.vwins[key] = vwin

    def poll_prices(self):
        if not self.llm:
            return
        for kind, key, val in self.llm.poll():
            if kind == "variety":
                rec = self.varieties.pop(key)
                vw = self.vwins.pop(key, ())
                name = variety.decide_name(val, int(key.split("@")[0]), vw, self.dic)[0]
                self.ev.write(json.dumps({"kind": "품종", "no": rec["no"], "start_sec": rec["s"], "start_hms": hms(rec["s"]), "name": name, "raw": val,
                                          "llm_answer": self.llm.raw.pop(("variety", key), None), "heard": [[round(t, 1), x] for t, x in vw],
                                          "at": datetime.now(KST).strftime("%H:%M:%S")}, ensure_ascii=False) + "\n")
                self.ev.flush()
                print(f"           품종  {rec['no']:>4}번  {name or '모름'}", flush=True)
                if self.poster:
                    self.names[key] = name or ""
                if key in self.ready:
                    self.send(key)
                continue
            rec, r, cands = self.priced.pop(key)
            self.emit_price(rec, r, val, cands)

    def emit_price(self, rec, r, llm_val, cands):
        # 후보가 하나뿐이면 고를 게 없어 LLM에 묻지 않는다(그대로 같음으로 본다)
        if llm_val is None and len(cands) == 1:
            llm_val = cands[0][0]
        pick = r if r is not None else llm_val   # 1순위는 규칙(가장 많이 말한 가격), LLM은 같은지 확인용
        agree = r is not None and r == llm_val and not price.odd(pick, getattr(self, "typ", None))
        found = pick is not None and not price.odd(pick, getattr(self, "typ", None))
        if not found:   # 못 찾았거나 이상한 값: 이 방송에서 가장 흔한 가격을 채우고 확인 필요로
            pick, agree = getattr(self, "com", None), False
        cands = [v for v, _ in cands]
        key = rec.get("price_key")
        heard = self.heard.pop(key, ())
        out = {"kind": "금액", "no": rec["no"], "start_sec": rec["s"], "start_hms": hms(rec["s"]), "pick": pick, "rule": r, "llm": llm_val,
               "agree": agree, "candidates": cands, "llm_answer": self.llm.raw.pop(("price", key), None) if self.llm else None,
               "heard": [[round(t, 1), x] for t, x in heard], "at": datetime.now(KST).strftime("%H:%M:%S")}
        self.ev.write(json.dumps(out, ensure_ascii=False) + "\n")
        self.ev.flush()
        won = lambda v: f"{v:,}원" if v is not None else "모름"
        mark = "✓ 규칙·AI 같음" if agree else "확인 필요"
        if self.llmreg:   # LLM 등록 길: 이 줄은 규칙 기록일 뿐 서버 값이 아니다(서버 값은 위의 LLM등록·고치기 줄)
            mark = "규칙 기록만" if not self.llm else f"{mark} · 기록만"
        print(f"           금액  {rec['no']:>4}번  {won(pick)}  ({mark}, 후보: {' / '.join(won(c) for c in cands) or '없음'})", flush=True)
        if self.poster and not self.llmreg:
            # 흔한 값으로 채운 금액은 짐작이라 보내지 않는다(서버는 금액이 꼭 있어야 하고, 틀린 금액 등록이 가장 나쁨)
            key = rec["price_key"]
            self.ready[key] = {"rec": rec, "price": pick if found else None, "conf": 0.9 if agree else 0.6,
                               "heard": " ".join(x for _, x in heard), "t": time.time()}
            if not self.llm or key in self.names:   # LLM이 있으면 품종도 물었으니 답(또는 NAME_WAIT)을 기다린다
                self.send(key)

    def _event(self, d):
        d["at"] = datetime.now(KST).strftime("%H:%M:%S")
        self.ev.write(json.dumps(d, ensure_ascii=False) + "\n")
        self.ev.flush()

    # ---------- 서버로 보내기(--post) ----------
    def send(self, key):
        item = self.ready.pop(key)
        name = self.names.pop(key, "")
        rec = item["rec"]
        no = rec["no"]
        why = None
        if rec["kind"] != "확정":
            why = "그사이 확정취소됨"
        elif item["price"] is None:
            why = "금액 모름"
        body = None if why else post.make_body(self.video_id, no, item["price"], name, item["heard"], item["conf"])
        if body is None:
            why = why or "보낼 수 없는 값"
            print(f"           서버  {no:>4}번  보내지 않음({why})", flush=True)
            if self.poster.logf:
                self.poster.logf.write(json.dumps({"at": post.stamp(), "no": no, "result": "skipped", "why": why}, ensure_ascii=False) + "\n")
                self.poster.logf.flush()
            return
        rec["sent"] = True
        self.poster.send(body)

    def flush_ready(self, force=False):
        """품종 답을 NAME_WAIT초 넘게 기다린 상품은 이름 없이 보낸다(끝날 때는 모두)"""
        if not self.poster:
            return
        now = time.time()
        for key in [k for k, v in self.ready.items() if force or now - v["t"] >= NAME_WAIT]:
            self.send(key)

    # ---------- 전체 ----------
    def run(self, inputs, live):
        self.start_ffmpeg(inputs, live)
        q = queue.Queue()
        threading.Thread(target=self.audio_loop, args=(q,), daemon=True).start()
        asr = threading.Thread(target=self.asr_loop, args=(q,), daemon=True)
        asr.start()
        pool = ProcessPoolExecutor(max_workers=self.a.workers)
        pending = {}
        k = 0
        last_tick = last_llm = time.time()
        frames_dir = os.path.join(self.out, "frames")
        try:
            while True:
                done = self.ff.poll() is not None
                # 다음 프레임이 생겼거나 ffmpeg가 끝났으면 이번 프레임은 다 쓰인 것
                while os.path.exists(os.path.join(frames_dir, f"{k:06d}.jpg")) and (done or os.path.exists(os.path.join(frames_dir, f"{k + 1:06d}.jpg"))):
                    pending[k] = pool.submit(ocr_frame, os.path.join(frames_dir, f"{k:06d}.jpg"))
                    k += 1
                for i in [i for i, f in pending.items() if f.done()]:
                    toks = pending.pop(i).result()
                    row = {"sec": self.base + i, "t": toks}
                    if self.finder is not None and toks:
                        try:
                            boxes = self.finder.boxes(os.path.join(frames_dir, f"{i:06d}.jpg"))
                            kept, off = tagbox.split(toks, boxes)
                            row = {"sec": self.base + i, "t": kept, "off": off, "tags": boxes}
                        except Exception as e:  # noqa: BLE001 — 한 장을 못 보면 그 장의 숫자는 번호로 쓰지 않는다
                            row = {"sec": self.base + i, "t": [], "off": toks, "tag_error": str(e)[:200]}
                    self.screen.add(row["sec"], row["t"])
                    self.sc.write(json.dumps(row) + "\n")
                self.poll_prices()
                self.flush_ready()
                if time.time() - last_tick >= TICK:
                    self.sc.flush()
                    self.tick()
                    last_tick = time.time()
                if self.llmreg and time.time() - last_llm >= LLM_TICK:
                    self.sc.flush()
                    self.llmreg.tick()
                    last_llm = time.time()
                if done and not pending and not os.path.exists(os.path.join(frames_dir, f"{k:06d}.jpg")):
                    break
                time.sleep(0.2)
            asr.join()
            self.tick(final=True)
            deadline = time.time() + 60 + 5 * (len(self.priced) + len(self.varieties))
            while (self.priced or self.varieties) and time.time() < deadline:
                self.poll_prices()
                self.flush_ready()
                time.sleep(0.5)
            if self.llm:
                self.llm.close()
            self.flush_ready(force=True)
            if self.llmreg:
                self.sc.flush()
                self.llmreg.finish()
            if self.poster:
                self.poster.close(timeout=60)
        finally:
            pool.shutdown(cancel_futures=True)
            if self.ff.poll() is None:
                self.ff.terminate()
        print(f"끝. 결과: {self.out}", flush=True)


def main():
    ap = argparse.ArgumentParser(prog="python -m sw")
    ap.add_argument("source", help="유튜브 라이브 주소 또는 시험용 영상 파일")
    ap.add_argument("--out", help="결과 폴더 (기본 runs/<시각>)")
    ap.add_argument("--speed", type=float, default=1.0, help="파일 시험: 라이브보다 몇 배 빨리 흘려보낼지")
    ap.add_argument("--from", dest="t0", type=float, default=0, help="파일 시험: 시작 초")
    ap.add_argument("--to", dest="t1", type=float, default=0, help="파일 시험: 끝 초")
    ap.add_argument("--workers", type=int, default=3, help="화면 글자 읽기 프로세스 수")
    ap.add_argument("--chat", help="시험: 채팅 다시보기 파일(yt-dlp live_chat.json) — 손님이 친 번호를 근거로")
    ap.add_argument("--no-llm", action="store_true", help="금액 1순위를 규칙만으로(맥 LLM을 띄우지 않음)")
    ap.add_argument("--gemma", action="store_true",
                    help="LLM 등록 길에서도 맥 LLM(Gemma)을 띄워 금액·품종 답을 기록에 남김(견주기용 — 서버로는 보내지 않음). 규칙 등록은 늘 띄움")
    ap.add_argument("--post", metavar="SERVER", help="확정 상품을 라이브지니 서버에 등록(예: https://livegenie.kr)")
    ap.add_argument("--token-file", help="--post: 일꾼 토큰 파일(없으면 환경변수 LG_SCREEN_TOKEN_FILE)")
    ap.add_argument("--video-id", help="--post: 유튜브 영상 번호(기본: 주소에서 뽑음)")
    ap.add_argument("--register", choices=["llm", "rule"], default="llm",
                    help="상품 등록 방식: llm = 2분마다 지식판2에 물어 등록(기본 — Claude 구독, ~/.lg_claude_token 또는 claude 로그인 필요, LLM_REG_BACKEND=codex면 Codex) / rule = 예전 규칙 확정+금액")
    ap.add_argument("--live-only", action="store_true", help="라이브가 아니면 바로 끝냄(종료 코드 3) — sw.serve가 씀")
    a = ap.parse_args()
    a.out = a.out or os.path.join("runs", datetime.now(KST).strftime("%Y%m%d_%H%M%S"))
    if a.post:
        if a.register != "llm":
            ap.error("서버 상품 등록은 지식판2만 지원해요. 규칙 시험은 --post 없이 실행하세요.")
        a.token_file = post.token_path(a.token_file)
        a.video_id = a.video_id or post.video_id(a.source)
        if not a.video_id or not post.VIDEO_RE.match(a.video_id):
            sys.exit("--post에는 유튜브 영상 번호나 틱톡 @아이디가 필요해요(주소에서 못 찾으면 --video-id)")
    # sw.serve가 멈출 때(SIGTERM) 정리하고 끝나게: ffmpeg·글자 읽기 프로세스를 닫는다
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        inputs, live = resolve(a.source)
    except subprocess.CalledProcessError as e:
        print(f"영상을 열지 못했어요(아직 시작 전이거나 끝난 방송): {(e.stderr or '').strip()[:300]}", flush=True)
        sys.exit(2)
    if a.live_only and not live:
        print("라이브가 아니라서 끝냄", flush=True)
        sys.exit(3)
    if live:
        a.t0 = a.t1 = 0
    print(f"{'라이브' if live else '파일'} 시작 → {a.out}", flush=True)
    Worker(a).run(inputs, live)


if __name__ == "__main__":
    main()
