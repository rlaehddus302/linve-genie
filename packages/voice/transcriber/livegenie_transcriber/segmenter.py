# 말 자르기 (VOC-07 조각, D-APP-07, D-APP1-02) — 표준 라이브러리만 쓰는 순수 파이썬.
# VAD(silero)는 밖에서 틀마다 "말 확률"을 구해 넘긴다. 이 파일은 확률과 그 틀의 소리(PCM16)만 보고 조각을 자른다.
#  - 쉼 0.4초에서 끊는다. 조각 끝 = 마지막 말 틀의 끝 + 뒤 여유(post_roll_ms, 그 쉼의 앞부분). 나머지 쉼은 버린다.
#  - 말 시작 앞 여유(pre_roll_ms): 말이 아닌 틀의 소리를 고리 버퍼로 들고 있다가 말이 시작되면 조각 앞에 붙인다
#    (VAD가 말을 알아채기 전 첫 소리 — "십삼 번"의 "십" — 이 잘리지 않게). 앞 조각(뒤 여유까지)과 겹치지 않는다.
#  - 쉬지 않아도 20초를 넘기지 않는다. 20초가 차면 끝에서 cut_lookback_ms 안에서 말 확률이 가장 낮은 틀(숨 쉬는 틈)의 끝에서 자른다.
#    그 안에 말이 아닌 틀(확률 0.5 미만)이 없거나 cut_lookback_ms가 0이면 정확히 20초 = 320,000표본에서 자른다.
#    나머지는 다음 조각의 처음. 조각을 이어 붙이지 않는다. 여유를 붙여도 조각은 20초를 넘지 않는다.
#  - 0.25초보다 짧은 말(딸깍 소리 등, 여유는 빼고 잼)은 받아쓰지 않는다.
# 시각은 그 흐름에서 받은 첫 표본부터 센 표본 수로만 잰다(시계를 읽지 않는다). 밀리초 = 표본 수 // 16.
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2

# silero 기본과 같은 문턱: 말이 아닐 때는 0.5 이상이면 말 시작, 말하는 중에는 0.35 미만이면 쉼(흔들림 막기)
SPEECH_THRESHOLD = 0.5
SILENCE_THRESHOLD = 0.35
MIN_SILENCE_MS = 400
MAX_SEGMENT_MS = 20000
MIN_SPEECH_MS = 250
# 말 앞뒤 여유와 20초 자를 틈 찾는 범위 (실방송 재생 측정으로 고른 값 — V-05)
PRE_ROLL_MS = 0
POST_ROLL_MS = 0
CUT_LOOKBACK_MS = 0


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


# 조각 안 틀 하나: (말 확률, 표본 수). 앞 여유는 자를 자리로 고르지 않게 확률 1로 둔다
_Frame = Tuple[float, int]


class Segmenter:
    """흐름 하나의 자르기 상태. push(확률, 소리)마다 끝난 조각들을 돌려준다"""

    def __init__(
        self,
        min_silence_ms: int = MIN_SILENCE_MS,
        max_segment_ms: int = MAX_SEGMENT_MS,
        min_speech_ms: int = MIN_SPEECH_MS,
        speech_threshold: float = SPEECH_THRESHOLD,
        silence_threshold: float = SILENCE_THRESHOLD,
        pre_roll_ms: int = PRE_ROLL_MS,
        post_roll_ms: int = POST_ROLL_MS,
        cut_lookback_ms: int = CUT_LOOKBACK_MS,
    ) -> None:
        self._min_silence = ms_to_samples(min_silence_ms)
        self._max_segment = ms_to_samples(max_segment_ms)
        self._min_speech = ms_to_samples(min_speech_ms)
        self._speech_threshold = speech_threshold
        self._silence_threshold = silence_threshold
        # 여유는 쉼(0.4초)·최대 길이보다 길 수 없다
        self._pre_roll = max(0, min(ms_to_samples(pre_roll_ms), self._max_segment // 2))
        self._post_roll = max(0, min(ms_to_samples(post_roll_ms), self._min_silence))
        self._cut_lookback = max(0, min(ms_to_samples(cut_lookback_ms), self._max_segment // 2))
        # 지금까지 받은 표본 수 (다음 틀의 시작 위치)
        self._position = 0
        # 말하는 중인 조각: 시작 위치와 소리(앞 여유 + 말 틀 + 그 사이 짧은 쉼), 틀 목록, 앞 여유 표본 수
        self._start: Optional[int] = None
        self._buffer = bytearray()
        self._frames: List[_Frame] = []
        self._lead = 0
        # 말 뒤 아직 끊을지 모르는 쉼과 그 틀들
        self._pending = bytearray()
        self._pending_frames: List[_Frame] = []
        # 말이 아닐 때 들은 마지막 소리(앞 여유 고리 버퍼). 앞 조각에 들어간 소리는 들지 않는다
        self._recent = bytearray()

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
                lead = bytes(self._recent)
                self._recent = bytearray()
                self._lead = len(lead) // BYTES_PER_SAMPLE
                self._start = frame_start - self._lead
                self._buffer = bytearray(lead)
                self._buffer.extend(pcm)
                self._frames = ([(1.0, self._lead)] if self._lead else []) + [(p, samples)]
                self._cut_long(out)
            else:
                self._remember(pcm)
            return out
        if p < self._silence_threshold:
            self._pending.extend(pcm)
            self._pending_frames.append((p, samples))
            pending_samples = len(self._pending) // BYTES_PER_SAMPLE
            # 틀 단위로만 재므로 0.4초를 틀 반 개 안에서 맞춘다: 쉼 + 틀 반 ≥ 0.4초면 끊는다
            if pending_samples * 2 + samples >= self._min_silence * 2:
                self._finish(out)
            return out
        # 말이 이어짐: 짧은 쉼은 조각 안에 넣는다
        if self._pending:
            self._buffer.extend(self._pending)
            self._frames.extend(self._pending_frames)
            self._pending = bytearray()
            self._pending_frames = []
        self._buffer.extend(pcm)
        self._frames.append((p, samples))
        self._cut_long(out)
        return out

    def reset(self) -> None:
        """흐름이 닫힘: 아직 받아쓰지 않은 소리를 버린다"""
        self._clear()
        self._recent = bytearray()

    def _clear(self) -> None:
        self._start = None
        self._buffer = bytearray()
        self._frames = []
        self._lead = 0
        self._pending = bytearray()
        self._pending_frames = []

    def _remember(self, pcm: bytes) -> None:
        if self._pre_roll <= 0:
            return
        self._recent.extend(pcm)
        keep = self._pre_roll * BYTES_PER_SAMPLE
        if len(self._recent) > keep:
            del self._recent[: len(self._recent) - keep]

    def _cut_point(self) -> int:
        """20초가 찼을 때 자를 표본 수(조각 처음부터): 끝 몇 초 안의 가장 낮은 확률 틀의 끝, 말이 아닌 틀이 없으면 정확히 20초"""
        if self._cut_lookback <= 0:
            return self._max_segment
        best: Optional[int] = None
        best_p = 0.0
        end = 0
        for p, samples in self._frames:
            end += samples
            if end > self._max_segment:
                break
            # 같은 확률이면 뒤쪽(조각이 더 긴 쪽)을 고른다
            if end >= self._max_segment - self._cut_lookback and p < self._speech_threshold and (best is None or p <= best_p):
                best, best_p = end, p
        return self._max_segment if best is None else best

    def _cut_long(self, out: List[Segment]) -> None:
        max_bytes = self._max_segment * BYTES_PER_SAMPLE
        while self._start is not None and len(self._buffer) > max_bytes:
            cut = self._cut_point()
            cut_bytes = cut * BYTES_PER_SAMPLE
            out.append(Segment(self._start, self._start + cut, bytes(self._buffer[:cut_bytes])))
            self._start += cut
            del self._buffer[:cut_bytes]
            self._lead = max(0, self._lead - cut)
            # 틀 목록도 같은 자리에서 나눈다 (정확히 20초 자르기는 틀 가운데일 수 있다 — 남은 쪽 틀은 남은 표본 수로)
            used = 0
            rest: List[_Frame] = []
            for p, samples in self._frames:
                if used >= cut:
                    rest.append((p, samples))
                elif used + samples > cut:
                    rest.append((p, used + samples - cut))
                used += samples
            self._frames = rest

    def _finish(self, out: List[Segment]) -> None:
        start = self._start
        buffer = self._buffer
        lead = self._lead
        pending = self._pending
        self._clear()
        if start is None:
            return
        samples = len(buffer) // BYTES_PER_SAMPLE
        if samples - lead < self._min_speech:
            # 받아쓰지 않은 소리는 다음 말의 앞 여유가 될 수 있다
            self._remember(bytes(buffer) + bytes(pending))
            return
        # 뒤 여유: 쉼의 앞부분. 조각이 20초를 넘지 않게
        tail = max(0, min(self._post_roll, self._max_segment - samples)) * BYTES_PER_SAMPLE
        pcm = bytes(buffer) + bytes(pending[:tail])
        out.append(Segment(start, start + len(pcm) // BYTES_PER_SAMPLE, pcm))
        # 뒤 여유 다음 쉼만 다음 말의 앞 여유가 될 수 있다(조각끼리 겹치지 않게)
        self._remember(bytes(pending[tail:]))
