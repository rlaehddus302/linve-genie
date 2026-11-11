# 받아쓰기 모델 비교 — OpenAI 받아쓰기 API(사용자 2026-11-11: "GPT 쪽에서 쓸 수 있는 더 좋은 STT도 해 보자")
# restt.py와 같은 자르기(sw.audio.Listener)로 조각을 만들고, 조각마다 API에 보내 transcript_<이름>.jsonl을 만든다(줄 = 조각, turbo와 같은 줄 나눔).
# 사용: OPENAI_API_KEY=… python -m sw.restt_api <이름> <모델(gpt-transcribe 등)> [천동 정성 마태]   (STT_PROMPT: 힌트 문장, STT_PAR: 동시 요청 수)
import concurrent.futures as cf
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
import wave

from . import audio
from .audio import clean_text
from .paths import FIRST
from .rescore import SETS

VIDEO = os.path.join(FIRST, "video")
URL = "https://api.openai.com/v1/audio/transcriptions"


def wav_bytes(pcm):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm)
    return b.getvalue()


def transcribe(pcm, model, hint):
    bd = "----sw" + str(time.time_ns())
    parts = [("model", model), ("language", "ko"), ("response_format", "json")] + ([("prompt", hint)] if hint else [])
    body = b""
    for k, v in parts:
        body += f"--{bd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    body += f"--{bd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode() + wav_bytes(pcm) + f"\r\n--{bd}--\r\n".encode()
    for k in range(5):
        try:
            req = urllib.request.Request(URL, data=body, headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"],
                                                                  "Content-Type": f"multipart/form-data; boundary={bd}"})
            return json.load(urllib.request.urlopen(req, timeout=120)).get("text", "")
        except Exception as e:   # 한도·일시 오류: 기다렸다 다시
            err = e
            time.sleep(5 * (k + 1))
    raise RuntimeError(f"받아쓰기 API 실패: {err}")


def main():
    name, model, want = sys.argv[1], sys.argv[2], sys.argv[3:] or [k for k, _, _ in SETS]
    hint = os.environ.get("STT_PROMPT")
    par = int(os.environ.get("STT_PAR", "8"))
    for k, run, _ in SETS:
        if k not in want:
            continue
        out = os.path.join(FIRST, "runs", run, f"transcript_{name}.jsonl")
        if os.path.exists(out):
            continue
        t0 = time.time()
        ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", os.path.join(VIDEO, run[-11:] + ".mp4"), "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
                              stdout=subprocess.PIPE)
        lis, segs = audio.Listener(), []
        while True:
            pcm = ff.stdout.read(3200 * 50)
            if not pcm:
                break
            segs.extend(lis.push(pcm))
        segs.extend(lis.flush())
        print(f"{k}: 조각 {len(segs)}개 → {model}", flush=True)
        with cf.ThreadPoolExecutor(par) as ex:
            texts = list(ex.map(lambda s: transcribe(s.pcm, model, hint), segs))
        rows = [{"start_sec": round(s.start_ms / 1000, 2), "end_sec": round(s.end_ms / 1000, 2), "text": clean_text(t.strip()), "conf": None, "nos": []}
                for s, t in zip(segs, texts) if clean_text(t.strip())]
        with open(out + ".tmp", "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(out + ".tmp", out)
        print(f"{k}: {len(rows)}줄 {time.time() - t0:.0f}초", flush=True)


if __name__ == "__main__":
    main()
