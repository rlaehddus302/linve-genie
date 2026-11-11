# 받아쓰기 모델 비교(사용자 지시 2026-11-10: 비용보다 성능): 일꾼과 같은 자르기(sw.audio.Listener)로 방송 소리를 다시 받아써
# 결과 폴더에 transcript_<이름>.jsonl로 둔다. 판정은 TRANSCRIPT=transcript_<이름>.jsonl python -m sw.rescore 로 같은 규칙·같은 정답 채점.
# 사용: python -m sw.restt <이름> <mlx 모델> [보스 럭셔리 다육홀릭 경성]   (환경변수 STT_PROMPT: 힌트 문장, STT_PROMPT_JSON: {세트: 힌트} 파일, LIVE_STT=1: 팀원 live_stt.py 방식 — 온도 0·힌트 베낌 거르기)
import json
import os
import subprocess
import sys
import time

import mlx_whisper
import numpy as np

from . import audio
from .audio import clean_text
from .paths import FIRST
from .rescore import SETS

VIDEO = os.path.join(FIRST, "video")


def main():
    name, model, want = sys.argv[1], sys.argv[2], sys.argv[3:] or [k for k, _, _ in SETS]
    hint0 = os.environ.get("STT_PROMPT")
    hints = json.load(open(os.environ["STT_PROMPT_JSON"], encoding="utf-8")) if os.environ.get("STT_PROMPT_JSON") else {}   # {세트: 힌트} 방송마다 다른 힌트
    for k, run, _ in SETS:
        if k not in want:
            continue
        out = os.path.join(FIRST, "runs", run, f"transcript_{name}.jsonl")
        if os.path.exists(out):
            continue
        hint = hints.get(k, hint0)
        t0 = time.time()
        ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", os.path.join(VIDEO, run[-11:] + ".mp4"), "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
                              stdout=subprocess.PIPE)
        lis, rows = audio.Listener(), []

        def do(segs):
            for s in segs:
                x = np.frombuffer(s.pcm, dtype="<i2").astype(np.float32) / 32768.0
                kw = dict(language="ko", task="transcribe", condition_on_previous_text=False, without_timestamps=True, verbose=None)
                if os.environ.get("LIVE_STT"):   # 팀원 live_stt.py 방식(2026-11-11): 온도 0 고정(되풀이 풀이 없음)
                    kw["temperature"] = 0.0
                if hint:
                    kw["initial_prompt"] = hint
                r = mlx_whisper.transcribe(x, path_or_hf_repo=model, **kw)
                txt = clean_text("".join(p["text"] for p in r["segments"]).strip())
                if os.environ.get("LIVE_STT") and hint and txt and txt.strip(" .,") in hint:   # live_stt.py: 결과 전체가 힌트 토막이면 베낀 것이라 버림(D-V3-127 ③)
                    txt = ""
                lp = [p["avg_logprob"] for p in r["segments"] if np.isfinite(p["avg_logprob"])]
                if txt:
                    rows.append({"start_sec": round(s.start_ms / 1000, 2), "end_sec": round(s.end_ms / 1000, 2), "text": txt,
                                 "conf": round(float(np.exp(np.mean(lp))), 3) if lp else None, "nos": []})
        while True:
            pcm = ff.stdout.read(3200 * 50)
            if not pcm:
                break
            do(lis.push(pcm))
        do(lis.flush())
        with open(out + ".tmp", "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(out + ".tmp", out)
        print(f"{k}: {len(rows)}줄 {time.time() - t0:.0f}초", flush=True)


if __name__ == "__main__":
    main()
