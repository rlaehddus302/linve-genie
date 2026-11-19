# 방송 소리 → 받아쓴 글. 라이브지니 받아쓰기 일꾼과 같은 자르기·거르기(sw/lg) + Whisper large-v3-turbo(mlx, 맥 GPU), 힌트 없음.
# 소리는 메모리에서만 다룬다.
import math
import os

import numpy as np

from .lg.cleanup import clean_text
from .lg.segmenter import SAMPLE_RATE, worker_segmenter

MODEL = "mlx-community/whisper-large-v3-turbo"
# 받아쓰기 돌리는 방식: mlx = 애플 칩 전용(맥) / faster = 같은 Whisper large-v3-turbo를 faster-whisper로(리눅스·엔비디아 GPU, AWS)
STT_BACKEND = os.environ.get("STT_BACKEND", "mlx")
FW_MODEL = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"   # 팀원 받아쓰기와 같은 변환본
_fw = None
SILERO_WINDOW = 512  # 16kHz에서 32ms
SILERO_CONTEXT = 64


class SileroVad:
    """livegenie runtime.py의 SileroVad(v5 모양만)를 옮김"""

    window = SILERO_WINDOW

    def __init__(self):
        import onnxruntime as ort
        from importlib.resources import files

        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.log_severity_level = 3
        path = str(files("silero_vad").joinpath("data/silero_vad.onnx"))
        self._session = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
        self._sr = np.array(SAMPLE_RATE, dtype=np.int64)
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, SILERO_CONTEXT), dtype=np.float32)

    def probability(self, pcm):
        x = (np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0).reshape(1, -1)
        joined = np.concatenate([self._context, x], axis=1)
        out, self._state = self._session.run(None, {"input": joined, "state": self._state, "sr": self._sr})
        self._context = joined[:, -SILERO_CONTEXT:]
        return float(out.reshape(-1)[0])


class Listener:
    """PCM16 16kHz 모노를 조금씩 넣으면 말 조각을 자른다. 받아쓰기는 transcribe()로 따로(느린 일이라 다른 스레드에서)"""

    def __init__(self):
        self.vad = SileroVad()
        self.seg = worker_segmenter()
        self._buf = bytearray()
        self.frame_bytes = SILERO_WINDOW * 2

    def push(self, pcm):
        self._buf.extend(pcm)
        out = []
        while len(self._buf) >= self.frame_bytes:
            fr = bytes(self._buf[: self.frame_bytes])
            del self._buf[: self.frame_bytes]
            out.extend(self.seg.push(self.vad.probability(fr), fr))
        return out

    def flush(self):
        """소리가 끝남: 무음 0.5초로 마지막 조각을 끝낸다"""
        out = []
        silence = bytes(self.frame_bytes)
        for _ in range(int(0.5 * SAMPLE_RATE / SILERO_WINDOW) + 1):
            out.extend(self.seg.push(self.vad.probability(silence), silence))
        return out


def transcribe(segment):
    """조각 하나 → (글, 확신도). 빈 글이면 ("", None)"""
    pcm = np.frombuffer(segment.pcm, dtype="<i2").astype(np.float32) / 32768.0
    if STT_BACKEND == "faster":
        global _fw
        if _fw is None:
            from faster_whisper import WhisperModel
            import ctranslate2
            cuda = ctranslate2.get_cuda_device_count() > 0
            # CPU 서버는 FW_THREADS로 글자 읽기와 CPU를 나눈다(D-SCR-OCR-02). 0 = faster-whisper 기본(코어 전부)
            _fw = WhisperModel(FW_MODEL, device="cuda" if cuda else "cpu", compute_type="float16" if cuda else "int8",
                               cpu_threads=int(os.environ.get("FW_THREADS", "0")))
        segs, _ = _fw.transcribe(pcm, language="ko", task="transcribe", condition_on_previous_text=False,
                                 without_timestamps=True, beam_size=5, vad_filter=False)  # 팀원 방식과 같게
        parts = [(p.text, p.avg_logprob) for p in segs]
        lp = [v for _, v in parts if math.isfinite(v)]
        conf = round(math.exp(sum(lp) / len(lp)), 3) if lp else None
        return clean_text("".join(t for t, _ in parts).strip()), conf
    import mlx_whisper

    r = mlx_whisper.transcribe(pcm, path_or_hf_repo=MODEL, language="ko", task="transcribe",
                               condition_on_previous_text=False, without_timestamps=True, verbose=None)
    parts = [(p["text"], p["avg_logprob"]) for p in r["segments"]]
    lp = [v for _, v in parts if math.isfinite(v)]
    conf = round(math.exp(sum(lp) / len(lp)), 3) if lp else None
    return clean_text("".join(t for t, _ in parts).strip()), conf
