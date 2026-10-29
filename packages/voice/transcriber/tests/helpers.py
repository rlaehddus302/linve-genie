# 시험 도우미: 합성 틀·합성 확률·가짜 VAD·가짜 모델 (모델·silero 없이 돈다)
from __future__ import annotations

import struct
from typing import List, Sequence, Tuple

FRAME_MS = 30
FRAME_SAMPLES = 480  # 16kHz 30ms


def tone(samples: int, value: int = 1000) -> bytes:
    """같은 값이 이어지는 PCM16 (말 자리)"""
    return struct.pack("<h", value) * samples


def silence(samples: int) -> bytes:
    return bytes(samples * 2)


def frames_from_timeline(timeline: Sequence[Tuple[int, bool]], frame_ms: int = FRAME_MS) -> List[Tuple[float, bytes]]:
    """[(길이 ms, 말인가)...] → 30ms 틀마다 (말 확률, 소리). 틀의 가운데가 말 구간이면 말(0.9), 아니면 쉼(0.05)"""
    edges: List[Tuple[int, int, bool]] = []
    at = 0
    for length, speech in timeline:
        edges.append((at, at + length, speech))
        at += length
    total = at
    frames: List[Tuple[float, bytes]] = []
    samples = frame_ms * 16
    start = 0
    while start + frame_ms <= total:
        middle = start + frame_ms / 2
        speech = any(a <= middle < b and s for a, b, s in edges)
        frames.append((0.9 if speech else 0.05, tone(samples) if speech else silence(samples)))
        start += frame_ms
    return frames


class AmplitudeVad:
    """가짜 VAD: 창 안에 0 아닌 표본이 있으면 말"""

    window = 512

    def probability(self, pcm: bytes) -> float:
        return 0.9 if any(pcm) else 0.05


def length_model(pcm: bytes) -> str:
    """가짜 모델: 받은 조각의 표본 수를 글로"""
    return f"표본 {len(pcm) // 2}"
