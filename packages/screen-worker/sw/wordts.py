# 단어 단위 시각으로 받아쓰기(시험용): 라이브지니 말 자르기 + Whisper turbo(mlx) + word_timestamps.
# 조각 시작 시각 대신 "N번"을 말한 단어의 정확한 초를 얻으려는 것. 결과 jsonl: {start_sec, end_sec, text, words:[[단어, 시작, 끝], ...]}
# 사용: python -m sw.wordts <소리 파일> <out.jsonl>
import json
import subprocess
import sys
import time

import numpy as np

from . import audio
from .lg.cleanup import clean_text
from .lg.segmenter import SAMPLE_RATE


def main():
    src, out_path = sys.argv[1], sys.argv[2]
    import mlx_whisper

    lis = audio.Listener()
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-i", src, "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
                            stdout=subprocess.PIPE)
    out = open(out_path, "w", encoding="utf-8")
    t0, n = time.time(), 0

    def emit(seg):
        nonlocal n
        pcm = np.frombuffer(seg.pcm, dtype="<i2").astype(np.float32) / 32768.0
        r = mlx_whisper.transcribe(pcm, path_or_hf_repo=audio.MODEL, language="ko", task="transcribe",
                                   condition_on_previous_text=False, word_timestamps=True, verbose=None)
        text = clean_text("".join(p["text"] for p in r["segments"]).strip())
        if not text:
            return
        base = seg.start_ms / 1000
        words = [[w["word"].strip(), round(base + w["start"], 2), round(base + w["end"], 2)] for p in r["segments"] for w in p.get("words", [])]
        out.write(json.dumps({"start_sec": round(base, 2), "end_sec": round(seg.end_ms / 1000, 2), "text": text, "words": words}, ensure_ascii=False) + "\n")
        out.flush()
        n += 1

    while True:
        pcm = proc.stdout.read(3200)
        if not pcm:
            break
        for s in lis.push(pcm):
            emit(s)
    for s in lis.flush():
        emit(s)
    print(f"끝: {n}줄, {(time.time() - t0) / 60:.1f}분", flush=True)


if __name__ == "__main__":
    main()
