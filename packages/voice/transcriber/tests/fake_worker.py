# AC-APP1-05 시험용 실행: 진짜 연결 고리(run_worker)·진짜 로그(stderr_log)를 가짜 연결·가짜 모델로 한 번 돌린다.
# usage: python3 fake_worker.py <토큰 파일> <표지 글>
# 가짜 서버가 흐름을 열고 말 1초 + 쉼 1초를 보낸 뒤, 표지 글이 결과로 오면 흐름을 닫고 연결을 끝낸다.
# 표지 글이 결과로 왔으면 끝 번호 0, 아니면 3. 이 파일도 아무것도 찍거나 쓰지 않는다.
from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from livegenie_transcriber.config import parse_args, read_token  # noqa: E402
from livegenie_transcriber.protocol import pack_audio  # noqa: E402
from livegenie_transcriber.runner import run_worker  # noqa: E402

from helpers import AmplitudeVad, silence, tone  # noqa: E402


class FakeSocket:
    def __init__(self, marker: str) -> None:
        self.marker = marker
        self.sent = []
        self.got_marker = asyncio.Event()
        self.headers_token = None

    async def send(self, text: str) -> None:
        self.sent.append(text)
        message = json.loads(text)
        if message.get("type") == "result" and message.get("text") == self.marker:
            self.got_marker.set()

    def __aiter__(self):
        return self._messages()

    async def _messages(self):
        yield json.dumps({"type": "open", "stream": 7})
        for _ in range(10):
            yield pack_audio(7, tone(1600, 1234))
        for _ in range(10):
            yield pack_audio(7, silence(1600))
        await asyncio.wait_for(self.got_marker.wait(), 10)
        yield json.dumps({"type": "close", "stream": 7})


class FakeConnection:
    def __init__(self, socket: FakeSocket, token: str, expected: str) -> None:
        self.socket = socket
        self.ok = token == expected

    async def __aenter__(self):
        if not self.ok:
            raise RuntimeError("토큰 다름")
        return self.socket

    async def __aexit__(self, *exc):
        return False


def main() -> int:
    token_file, marker = sys.argv[1], sys.argv[2]
    config = parse_args(["--server", "https://live.example.com", "--token-file", token_file, "--max-streams", "2"], {})
    token = read_token(config, {})
    socket = FakeSocket(marker)

    def connect(url: str, given: str) -> FakeConnection:
        return FakeConnection(socket, given, token)

    async def go() -> None:
        await run_worker(config.worker_url, token, config.max_streams, lambda pcm: marker, AmplitudeVad, connect=connect, max_connections=1)

    asyncio.run(go())
    return 0 if socket.got_marker.is_set() else 3


if __name__ == "__main__":
    sys.exit(main())
