# 길게 겹쳐 받아쓰기(STT): 0.4초 멈춤마다 짧게 자르면 앞뒤 맥락이 끊겨 숫자를 틀린다("101번 만원" → "101번 1010원").
# 소리를 WIN초씩 HOP초 간격으로 겹쳐 잘라 Whisper에 넣고, 각 조각에서 가운데 부분(가장자리 아닌 곳)의 말만 남겨 이어 붙인다.
# 결과는 일꾼과 같은 transcript.jsonl 모양 {start_sec, end_sec, text, conf, nos}.
# 사용: python -m sw.longstt <소리·영상 파일> <out.jsonl> [WIN HOP]   (STT_MODEL=mlx-community/whisper-large-v3-mlx 로 원판)
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

from . import audio
from .decide import numbers_with_beon
from .lg.cleanup import clean_text

SR = 16000


def transcriber(backend="mlx", model=None):
    """STT 모델 바꿔 끼우기: (소리 float32 16kHz) → [(시작초, 끝초, 글, avg_logprob 또는 None)]
    backend: mlx(맥, mlx-community 모델) · faster(리눅스·GPU, CTranslate2 모델) · hf(transformers 모델, 예: BuzzASR/korean)"""
    if backend == "mlx":
        import mlx_whisper
        model = model or os.environ.get("STT_MODEL", audio.MODEL)

        def run(pcm):
            r = mlx_whisper.transcribe(pcm, path_or_hf_repo=model, language="ko", task="transcribe",
                                       condition_on_previous_text=False, verbose=None)
            return [(g["start"], g["end"], g["text"], g.get("avg_logprob")) for g in r["segments"]]
        return run
    if backend == "faster":
        import ctranslate2
        from faster_whisper import WhisperModel
        cuda = ctranslate2.get_cuda_device_count() > 0
        m = WhisperModel(model or audio.FW_MODEL, device="cuda" if cuda else "cpu", compute_type="float16" if cuda else "int8")

        def run(pcm):
            segs, _ = m.transcribe(pcm, language="ko", task="transcribe", beam_size=5, condition_on_previous_text=False, vad_filter=False)
            return [(g.start, g.end, g.text, g.avg_logprob) for g in segs]
        return run
    if backend == "hf":
        import torch
        from transformers import pipeline
        dev = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        asr = pipeline("automatic-speech-recognition", model=model, device=dev, torch_dtype=torch.float16 if dev != "cpu" else torch.float32)

        def run(pcm):
            r = asr({"raw": pcm, "sampling_rate": SR}, return_timestamps=True,
                    generate_kwargs={"language": "korean", "task": "transcribe", "num_beams": 5})
            return [(c["timestamp"][0] or 0.0, c["timestamp"][1] or len(pcm) / SR, c["text"], None) for c in r.get("chunks", [])] \
                or [(0.0, len(pcm) / SR, r["text"], None)]
        return run
    raise SystemExit(f"backend? {backend}")


def run(src, out_path, win=30.0, hop=20.0, stt=None):
    """소리·영상 파일 → 길게 겹쳐 받아쓴 transcript.jsonl.
    이어 붙이기: 조각마다 받아쓴 문장을 전부 모은 뒤, 시간이 겹치고 글이 비슷한 문장(같은 말을 두 조각이 다 받아쓴 것)은
    조각 가장자리에서 더 먼 쪽 하나만 남긴다. (예전: 조각 가운데 구간에 든 문장만 남김 → 조각마다 STT 시각이 달라
    경계 문장이 양쪽에서 다 버려짐 — 보스다육 '263 요거는', '275 요거 2만원'이 빠짐)"""
    from rapidfuzz import fuzz
    stt = stt or transcriber()
    raw = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", src, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    total = len(pcm) / SR
    t0, s = time.time(), 0.0
    cands = []   # (시작, 끝, 글, logprob, 가장자리에서 떨어진 정도)
    while s < total:
        end = min(total, s + win)
        chunk = pcm[int(s * SR): int(end * SR)]
        if len(chunk) > SR // 2 and float(np.abs(chunk).max()) > 0.01:
            for a0, b0, text, lp in stt(chunk):
                text = clean_text(text.strip())
                if not text:
                    continue
                a, b = s + a0, s + b0
                lo_edge = a - s if s > 0 else win          # 맨 앞 조각의 앞쪽, 맨 끝 조각의 뒤쪽은 가장자리가 아니다
                hi_edge = end - b if end < total else win
                cands.append((a, b, text, lp, min(lo_edge, hi_edge)))
        s += hop
    keep = []
    for c in sorted(cands, key=lambda c: -c[4]):          # 가운데에 가까운 문장부터 자리를 잡는다
        a, b, text = c[0], c[1], c[2]
        dup = False
        for k in keep:
            ov = min(b, k[1]) - max(a, k[0])
            if ov > 0.5 * min(b - a, k[1] - k[0], 3.0) and fuzz.partial_ratio(text, k[2]) >= 60:
                dup = True
                break
        if not dup:
            keep.append(c)
    keep.sort(key=lambda c: c[0])
    with open(out_path, "w", encoding="utf-8") as out:
        for a, b, text, lp, _ in keep:
            conf = round(math.exp(lp), 3) if lp is not None and math.isfinite(lp) else None
            out.write(json.dumps({"start_sec": round(a, 2), "end_sec": round(b, 2), "text": text, "conf": conf,
                                  "nos": numbers_with_beon(text)}, ensure_ascii=False) + "\n")
    print(f"끝: {len(keep)}줄(후보 {len(cands)}), 소리 {total / 60:.0f}분, {(time.time() - t0) / 60:.1f}분 걸림", flush=True)


def main():
    src, out_path = sys.argv[1], sys.argv[2]
    win = float(sys.argv[3]) if len(sys.argv) > 3 else 30.0
    hop = float(sys.argv[4]) if len(sys.argv) > 4 else 20.0
    run(src, out_path, win, hop, transcriber(os.environ.get("STT_BACKEND_LONG", "mlx"), os.environ.get("STT_MODEL")))


if __name__ == "__main__":
    main()
