# python3 -m livegenie_transcriber --server <주소> --token-file <파일> [--model cohere|whisper] [--max-streams 4]
# 설정이 틀리면 시작하지 않고 쉬운 문장으로 끝낸다(끝 번호 2). 토큰 값은 어디에도 찍지 않는다.
from __future__ import annotations

import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, List, Optional

from .config import USAGE, ConfigError, HelpRequested, parse_args, read_token


def main(argv: Optional[List[str]] = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        config = parse_args(args)
        token = read_token(config)
    except HelpRequested:
        print(USAGE)
        return 0
    except ConfigError as error:
        print(f"일꾼을 시작하지 못했어요: {error}", file=sys.stderr)
        return 2

    from .runner import run_worker, stderr_log
    from .runtime import MissingPackage, load_transcriber, load_vad_factory

    try:
        import websockets  # noqa: F401 — 실행 때만 필요
    except ImportError:
        print("일꾼을 시작하지 못했어요: websockets 꾸러미가 없어요. README의 설치를 따라 주세요.", file=sys.stderr)
        return 2

    try:
        stderr_log(f"VAD를 불러와요. 흐름 한도 {config.max_streams}개")
        vad_factory = load_vad_factory(config)
        stderr_log(f"받아쓰기 모델을 불러와요 ({config.model}). 처음엔 몇 분 걸릴 수 있어요.")
        transcribe = load_transcriber(config)
    except MissingPackage as error:
        print(f"일꾼을 시작하지 못했어요: {error.name} 꾸러미가 없어요. README의 설치를 따라 주세요.", file=sys.stderr)
        return 2
    except FileNotFoundError as error:
        print(f"일꾼을 시작하지 못했어요: {error}", file=sys.stderr)
        return 2

    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="transcribe")

    async def go() -> None:
        loop = asyncio.get_running_loop()

        def run_blocking(job: Callable[[], str]) -> "asyncio.Future[str]":
            return loop.run_in_executor(executor, job)

        stderr_log("준비됐어요. 라이브지니 서버에 붙어요.")
        await run_worker(config.worker_url, token, config.max_streams, transcribe, vad_factory, run_blocking=run_blocking)

    try:
        asyncio.run(go())
    except KeyboardInterrupt:
        stderr_log("일꾼을 멈췄어요.")
    finally:
        executor.shutdown(wait=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
