# 일꾼 연결 고리 (VOC-07, D-APP-09, D-APP1-11): 라이브지니 서버로 먼저 웹소켓을 열고(일꾼 토큰은 Authorization 머리글로만),
# hello를 보내고, 서버가 여는 흐름을 받아쓴다. 서버에 닿지 않거나 끊기면 1·2·4·8·16·30초(가장 길게 30초) 간격으로 다시 붙는다.
# 연결 함수·잠자기·로그는 넘겨받는다 — 단위 시험은 가짜 연결로 돈다. websockets는 실제로 붙을 때만 불러온다.
# 로그에는 셈만 남긴다: 토큰 값·머리글·받아쓴 글·소리를 찍지 않는다(D-APP-03·D-APP-09).
from __future__ import annotations

import asyncio
import math
import sys
import time
from typing import Any, AsyncContextManager, Awaitable, Callable, List, Optional

from .segmenter import Segmenter, worker_segmenter
from .session import Stats, Transcribe, VadFactory, WorkerSession

BACKOFF_SECONDS = (1, 2, 4, 8, 16, 30)
# 이만큼 붙어 있다 끊긴 것은 "닿았던 것"으로 보고 다시 붙기 간격을 처음(1초)부터 센다
STABLE_SECONDS = 10.0
SUMMARY_SECONDS = 300.0


class Rejected(Exception):
    """서버가 일꾼을 받지 않음(토큰 틀림 등). status = HTTP 상태 번호"""

    def __init__(self, status: int) -> None:
        super().__init__(status)
        self.status = status


Connect = Callable[[str, str], AsyncContextManager[Any]]
Log = Callable[[str], None]
Sleep = Callable[[float], Awaitable[None]]


def stderr_log(line: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"{stamp} {line}", file=sys.stderr, flush=True)


def backoff_seconds(failures: int) -> int:
    """연달아 실패한 횟수(1부터) → 기다릴 초"""
    index = max(0, min(failures - 1, len(BACKOFF_SECONDS) - 1))
    return BACKOFF_SECONDS[index]


def percentile(values: List[int], rank: float) -> Optional[int]:
    """가까운 순위 백분위 (값이 없으면 None)"""
    if not values:
        return None
    ordered = sorted(values)
    position = max(1, math.ceil(rank * len(ordered) / 100))
    return ordered[min(position, len(ordered)) - 1]


def summary_line(stats: Stats, open_streams: int) -> str:
    p50 = percentile(stats.proc_ms, 50)
    p95 = percentile(stats.proc_ms, 95)
    proc = "처리 시간 없음" if p50 is None else f"처리 시간 중앙 {p50}ms · 95% {p95}ms"
    return (
        f"지금 흐름 {open_streams}개 · 연 흐름 {stats.streams_opened}개(한도로 거절 {stats.streams_refused}) · "
        f"조각 {stats.segments}개 · 결과 {stats.results}개 · 버린 조각 {stats.dropped_segments}개 · {proc}"
    )


def websockets_connect(url: str, token: str) -> AsyncContextManager[Any]:
    """실제 웹소켓 연결 (websockets 꾸러미는 여기서만 불러온다)"""
    import websockets  # 실행 때만

    headers = {"Authorization": f"Bearer {token}"}
    kwargs = {"max_size": 2 ** 20, "ping_interval": 20, "ping_timeout": 20, "open_timeout": 10}
    try:
        return websockets.connect(url, additional_headers=headers, **kwargs)
    except TypeError:  # 오래된 판
        return websockets.connect(url, extra_headers=headers, **kwargs)


def rejected_status(error: BaseException) -> Optional[int]:
    """websockets의 업그레이드 거절 예외에서 HTTP 상태 번호만 꺼낸다(머리글·본문은 보지 않는다)"""
    if isinstance(error, Rejected):
        return error.status
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None)
    if isinstance(status, int):
        return status
    status = getattr(error, "status_code", None)
    return status if isinstance(status, int) else None


async def serve_connection(socket: Any, session: WorkerSession, log: Optional[Log] = None) -> None:
    """붙은 연결 하나: hello → 받는 틀을 흐름 관리에 넘긴다. 연결이 끝나면 돌아온다. 붙어 있는 동안 5분마다 셈 한 줄"""
    await socket.send(session.hello())
    session.start()

    async def summarize() -> None:
        while True:
            await asyncio.sleep(SUMMARY_SECONDS)
            if log is not None:
                log(summary_line(session.stats, session.open_streams))

    summary = asyncio.ensure_future(summarize())
    try:
        async for message in socket:
            if isinstance(message, str):
                await session.handle_text(message)
            else:
                await session.handle_binary(message)
    finally:
        summary.cancel()
        await session.close()


async def run_worker(
    worker_url: str,
    token: str,
    max_streams: int,
    transcribe: Transcribe,
    vad_factory: VadFactory,
    connect: Connect = websockets_connect,
    sleep: Sleep = asyncio.sleep,
    log: Log = stderr_log,
    clock: Callable[[], float] = time.monotonic,
    run_blocking: Optional[Callable[[Callable[[], str]], Awaitable[str]]] = None,
    stop: Optional[asyncio.Event] = None,
    max_connections: Optional[int] = None,
    segmenter_factory: Callable[[], Segmenter] = worker_segmenter,
) -> Stats:
    """끝없이 붙어 있는다(stop이 켜지거나 max_connections번 붙어 본 뒤 끝). 셈을 돌려준다"""
    stats = Stats()
    failures = 0
    attempts = 0
    while stop is None or not stop.is_set():
        if max_connections is not None and attempts >= max_connections:
            break
        attempts += 1
        connected_at: Optional[float] = None
        session: Optional[WorkerSession] = None
        try:
            async with connect(worker_url, token) as socket:
                connected_at = clock()
                log("라이브지니 서버에 붙었어요.")

                async def send_text(text: str) -> None:
                    await socket.send(text)

                session = WorkerSession(send_text, transcribe, vad_factory, max_streams, clock, run_blocking, stats, segmenter_factory)
                await serve_connection(socket, session, log)
            log("라이브지니 서버 연결이 닫혔어요.")
        except asyncio.CancelledError:
            raise
        except Exception as error:  # 어떤 까닭이든 다시 붙는다. 예외 글은 찍지 않는다(주소·머리글이 들어 있을 수 있다)
            status = rejected_status(error)
            if status == 401:
                log("라이브지니 서버가 일꾼 토큰을 받지 않았어요(401). 토큰 파일이 서버 설정과 같은지 확인해 주세요.")
            elif status is not None:
                log(f"라이브지니 서버가 일꾼 연결을 받지 않았어요({status}).")
            elif connected_at is None:
                log("라이브지니 서버에 닿지 않아요.")
            else:
                log("라이브지니 서버 연결이 끊겼어요.")
        if connected_at is not None and clock() - connected_at >= STABLE_SECONDS:
            failures = 0
        if stop is not None and stop.is_set():
            break
        if max_connections is not None and attempts >= max_connections:
            break
        failures += 1
        wait = backoff_seconds(failures)
        log(f"{wait}초 뒤 다시 붙어요.")
        await sleep(wait)
    return stats
