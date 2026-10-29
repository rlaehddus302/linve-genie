# 말 자르기 (VOC-07 조각, D-APP-07, D-APP1-02) — 표준 라이브러리만 쓰는 순수 파이썬.
# VAD(silero)는 밖에서 틀마다 "말 확률"을 구해 넘긴다. 이 파일은 확률과 그 틀의 소리(PCM16)만 보고 조각을 자른다.
#  - 쉼 0.4초에서 끊는다(조각 끝 = 마지막 말 틀의 끝, 뒤 쉼은 버린다).
#  - 쉬지 않아도 20초에서 끊는다(정확히 20초 = 320,000표본에서 자르고 나머지는 다음 조각의 처음). 조각을 이어 붙이지 않는다.
#  - 0.25초보다 짧은 조각(딸깍 소리 등)은 받아쓰지 않는다.
# 시각은 그 흐름에서 받은 첫 표본부터 센 표본 수로만 잰다(시계를 읽지 않는다). 밀리초 = 표본 수 // 16.
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2

# silero 기본과 같은 문턱: 말이 아닐 때는 0.5 이상이면 말 시작, 말하는 중에는 0.35 미만이면 쉼(흔들림 막기)
SPEECH_THRESHOLD = 0.5
SILENCE_THRESHOLD = 0.35
MIN_SILENCE_MS = 400
MAX_SEGMENT_MS = 20000
MIN_SPEECH_MS = 250


@dataclass(frozen=True)
class Segment:
    """조각 하나: 흐름 처음부터 센 표본 위치 [start, end)와 그 소리"""

    start_sample: int
    end_sample: int
    pcm: bytes

    @property
    def start_ms(self) -> int:
        return self.start_sample * 1000 // SAMPLE_RATE

    @property
    def end_ms(self) -> int:
        return self.end_sample * 1000 // SAMPLE_RATE


def ms_to_samples(ms: int) -> int:
    return ms * SAMPLE_RATE // 1000


class Segmenter:
    """흐름 하나의 자르기 상태. push(확률, 소리)마다 끝난 조각들을 돌려준다"""

    def __init__(
        self,
        min_silence_ms: int = MIN_SILENCE_MS,
        max_segment_ms: int = MAX_SEGMENT_MS,
        min_speech_ms: int = MIN_SPEECH_MS,
        speech_threshold: float = SPEECH_THRESHOLD,
        silence_threshold: float = SILENCE_THRESHOLD,
    ) -> None:
        self._min_silence = ms_to_samples(min_silence_ms)
        self._max_segment = ms_to_samples(max_segment_ms)
        self._min_speech = ms_to_samples(min_speech_ms)
        self._speech_threshold = speech_threshold
        self._silence_threshold = silence_threshold
        # 지금까지 받은 표본 수 (다음 틀의 시작 위치)
        self._position = 0
        # 말하는 중인 조각: 시작 위치와 소리(말 틀 + 그 사이 짧은 쉼)
        self._start: Optional[int] = None
        self._buffer = bytearray()
        # 말 뒤 아직 끊을지 모르는 쉼
        self._pending = bytearray()

    @property
    def in_speech(self) -> bool:
        return self._start is not None

    def push(self, probability: float, pcm: bytes) -> List[Segment]:
        """틀 하나(말 확률, PCM16 little-endian)를 넣는다. 홀수 바이트 틀은 버린다(시각에도 넣지 않는다)"""
        if len(pcm) % BYTES_PER_SAMPLE != 0 or len(pcm) == 0:
            return []
        samples = len(pcm) // BYTES_PER_SAMPLE
        frame_start = self._position
        self._position += samples
        try:
            p = float(probability)
        except (TypeError, ValueError):
            p = 0.0
        if p != p:  # NaN은 쉼으로
            p = 0.0
        out: List[Segment] = []
        if self._start is None:
            if p >= self._speech_threshold:
                self._start = frame_start
                self._buffer = bytearray(pcm)
                self._cut_long(out)
            return out
        if p < self._silence_threshold:
            self._pending.extend(pcm)
            pending_samples = len(self._pending) // BYTES_PER_SAMPLE
            # 틀 단위로만 재므로 0.4초를 틀 반 개 안에서 맞춘다: 쉼 + 틀 반 ≥ 0.4초면 끊는다
            if pending_samples * 2 + samples >= self._min_silence * 2:
                self._finish(out)
            return out
        # 말이 이어짐: 짧은 쉼은 조각 안에 넣는다
        if self._pending:
            self._buffer.extend(self._pending)
            self._pending = bytearray()
        self._buffer.extend(pcm)
        self._cut_long(out)
        return out

    def reset(self) -> None:
        """흐름이 닫힘: 아직 받아쓰지 않은 소리를 버린다"""
        self._start = None
        self._buffer = bytearray()
        self._pending = bytearray()

    def _cut_long(self, out: List[Segment]) -> None:
        max_bytes = self._max_segment * BYTES_PER_SAMPLE
        while self._start is not None and len(self._buffer) > max_bytes:
            head = bytes(self._buffer[:max_bytes])
            out.append(Segment(self._start, self._start + self._max_segment, head))
            self._start += self._max_segment
            del self._buffer[:max_bytes]

    def _finish(self, out: List[Segment]) -> None:
        start = self._start
        buffer = self._buffer
        self.reset()
        if start is None:
            return
        samples = len(buffer) // BYTES_PER_SAMPLE
        if samples < self._min_speech:
            return
        out.append(Segment(start, start + samples, bytes(buffer)))
