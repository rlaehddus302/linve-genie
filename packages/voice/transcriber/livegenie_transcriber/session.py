# 일꾼 연결 하나의 흐름 관리 (VOC-07, D-APP-03·D-APP-10, D-APP1-11) — 표준 라이브러리만.
#  - open: 흐름 수 한도(--max-streams) 안이면 받는다. 넘치면 받지 않는다(그 흐름의 소리는 버리고 결과를 내지 않는다).
#  - 이진 틀: VAD 창마다 말 확률을 구해 자르기에 넣고, 끝난 조각을 받아쓰기 줄에 넣는다(모델은 한 번에 하나).
#  - close·연결 끊김: 그 흐름의 아직 받아쓰지 않은 소리와 줄에 선 조각을 버린다(끈 뒤 등록되지 않게, D-APP1-11).
#  - 소리·글은 메모리에서만 다룬다. 로그에는 셈(흐름 수·조각 수·처리 시간)만 남긴다(D-APP-03).
# 모델·VAD·보내기·시계는 넘겨받는다(단위 시험은 가짜로 돈다).
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Deque, Dict, List, Optional, Protocol, Set, Tuple
from collections import deque

from .protocol import hello_message, parse_server_message, result_message, unpack_audio
from .segmenter import BYTES_PER_SAMPLE, Segment, Segmenter


class Vad(Protocol):
    """흐름 하나의 VAD: window(표본 수) 크기의 PCM16 소리 → 말 확률 0~1"""

    window: int

    def probability(self, pcm: bytes) -> float: ...


VadFactory = Callable[[], Vad]
# 조각 소리(PCM16 16kHz) → 받아쓴 글. 무거운 일이라 따로 된 실행기에서 돈다
Transcribe = Callable[[bytes], str]
SendText = Callable[[str], Awaitable[None]]


@dataclass
class Stats:
    """로그에 남겨도 되는 셈만"""

    streams_opened: int = 0
    streams_refused: int = 0
    segments: int = 0
    results: int = 0
    dropped_segments: int = 0
    bad_frames: int = 0
    model_errors: int = 0
    proc_ms: List[int] = field(default_factory=list)


class _Stream:
    def __init__(self, stream_id: int, vad: Vad) -> None:
        self.id = stream_id
        self.vad = vad
        self.segmenter = Segmenter()
        self.pending = bytearray()
        self.open = True

    def window_bytes(self) -> int:
        window = int(getattr(self.vad, "window", 512) or 512)
        return max(1, window) * BYTES_PER_SAMPLE


class WorkerSession:
    """서버와 맺은 연결 하나 동안의 일 (연결이 끊기면 버리고 새로 만든다)"""

    def __init__(
        self,
        send_text: SendText,
        transcribe: Transcribe,
        vad_factory: VadFactory,
        max_streams: int,
        clock: Callable[[], float],
        run_blocking: Optional[Callable[[Callable[[], str]], Awaitable[str]]] = None,
        stats: Optional[Stats] = None,
    ) -> None:
        self._send_text = send_text
        self._transcribe = transcribe
        self._vad_factory = vad_factory
        self._max_streams = max_streams
        self._clock = clock
        self._run_blocking = run_blocking
        self.stats = stats if stats is not None else Stats()
        self._streams: Dict[int, _Stream] = {}
        self._refused: Set[int] = set()
        self._queue: Deque[Tuple[_Stream, Segment, float]] = deque()
        self._wake = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._closed = False
        self._runner: Optional["asyncio.Task[None]"] = None

    # 바깥에서 부르는 것 -------------------------------------------------

    def hello(self) -> str:
        return hello_message(self._max_streams)

    @property
    def open_streams(self) -> int:
        return len(self._streams)

    def start(self) -> None:
        if self._runner is None:
            self._runner = asyncio.ensure_future(self._run())

    async def handle_text(self, raw: object) -> None:
        message = parse_server_message(raw)
        if message is None:
            self.stats.bad_frames += 1
            return
        if message.type == "open":
            self._open(message.stream)
        else:
            self._close(message.stream)

    async def handle_binary(self, data: object) -> None:
        unpacked = unpack_audio(data)
        if unpacked is None:
            self.stats.bad_frames += 1
            return
        stream_id, pcm = unpacked
        stream = self._streams.get(stream_id)
        if stream is None:
            # 열지 않은 흐름·한도로 받지 않은 흐름의 소리는 버린다
            if stream_id not in self._refused:
                self.stats.bad_frames += 1
            return
        if len(pcm) % BYTES_PER_SAMPLE != 0:
            self.stats.bad_frames += 1
            return
        stream.pending.extend(pcm)
        size = stream.window_bytes()
        while len(stream.pending) >= size:
            window = bytes(stream.pending[:size])
            del stream.pending[:size]
            try:
                probability = float(stream.vad.probability(window))
            except Exception:  # VAD가 이상해도 흐름을 죽이지 않는다(쉼으로 본다)
                probability = 0.0
            for segment in stream.segmenter.push(probability, window):
                self.stats.segments += 1
                self._queue.append((stream, segment, self._clock()))
                self._idle.clear()
                self._wake.set()

    async def close(self) -> None:
        """연결이 끊김: 모든 흐름과 줄에 선 조각을 버린다"""
        self._closed = True
        for stream_id in list(self._streams):
            self._close(stream_id)
        self._queue.clear()
        self._wake.set()
        runner = self._runner
        self._runner = None
        if runner is not None:
            runner.cancel()
            try:
                await runner
            except (asyncio.CancelledError, Exception):
                pass
        self._idle.set()

    async def drain(self) -> None:
        """줄에 선 조각을 다 받아쓸 때까지 기다린다(시험·재생 측정용)"""
        await self._idle.wait()

    # 안쪽 ---------------------------------------------------------------

    def _open(self, stream_id: int) -> None:
        if stream_id in self._streams:
            return
        if len(self._streams) >= self._max_streams:
            self._refused.add(stream_id)
            self.stats.streams_refused += 1
            return
        try:
            vad = self._vad_factory()
        except Exception:
            self._refused.add(stream_id)
            self.stats.streams_refused += 1
            return
        self._refused.discard(stream_id)
        self._streams[stream_id] = _Stream(stream_id, vad)
        self.stats.streams_opened += 1

    def _close(self, stream_id: int) -> None:
        self._refused.discard(stream_id)
        stream = self._streams.pop(stream_id, None)
        if stream is None:
            return
        stream.open = False
        stream.pending = bytearray()
        stream.segmenter.reset()
        before = len(self._queue)
        self._queue = deque(item for item in self._queue if item[0] is not stream)
        self.stats.dropped_segments += before - len(self._queue)

    async def _run(self) -> None:
        while not self._closed:
            if not self._queue:
                self._idle.set()
                self._wake.clear()
                await self._wake.wait()
                continue
            stream, segment, cut_at = self._queue.popleft()
            if not stream.open:
                self.stats.dropped_segments += 1
                continue
            try:
                text = await self._call_model(segment.pcm)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.stats.model_errors += 1
                continue
            # 받아쓰는 동안 흐름이 닫혔으면 결과를 내지 않는다
            if not stream.open or self._closed:
                self.stats.dropped_segments += 1
                continue
            text = text.strip() if isinstance(text, str) else ""
            if not text:
                continue
            proc_ms = int(round((self._clock() - cut_at) * 1000))
            try:
                await self._send_text(result_message(stream.id, text, segment.start_ms, segment.end_ms, proc_ms))
            except asyncio.CancelledError:
                raise
            except Exception:
                # 보내지 못함 = 연결이 끊기는 중. 바깥 고리가 연결을 다시 맺는다
                continue
            self.stats.results += 1
            self.stats.proc_ms.append(proc_ms)
            if len(self.stats.proc_ms) > 1000:
                del self.stats.proc_ms[:500]

    async def _call_model(self, pcm: bytes) -> str:
        if self._run_blocking is None:
            return self._transcribe(pcm)
        transcribe = self._transcribe
        return await self._run_blocking(lambda: transcribe(pcm))
