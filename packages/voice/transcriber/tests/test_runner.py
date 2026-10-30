# 일꾼 연결 고리 (D-APP1-11): hello 먼저, 다시 붙기 1·2·4·8·16·30초, 401 기록에 토큰 없음, 끊기면 흐름을 버림
from __future__ import annotations

import asyncio
import json
import unittest

from livegenie_transcriber.protocol import pack_audio
from livegenie_transcriber.runner import Rejected, backoff_seconds, percentile, run_worker, summary_line
from livegenie_transcriber.segmenter import worker_segmenter
from livegenie_transcriber.session import Stats

from helpers import AmplitudeVad, length_model, silence, tone

TOKEN = "tok-runner-SECRET"


class Script:
    """연결마다 어떻게 될지: 'fail' | '401' | 메시지 목록"""

    def __init__(self, plans):
        self.plans = list(plans)
        self.sockets = []
        self.tokens = []
        self.urls = []

    def connect(self, url, token):
        self.urls.append(url)
        self.tokens.append(token)
        plan = self.plans.pop(0) if self.plans else "fail"
        script = self

        class Connection:
            async def __aenter__(self):
                if plan == "fail":
                    raise OSError("닿지 않음 " + url)
                if plan == "401":
                    raise Rejected(401)
                socket = Socket(plan)
                script.sockets.append(socket)
                return socket

            async def __aexit__(self, *exc):
                return False

        return Connection()


class Socket:
    def __init__(self, messages):
        self.messages = messages
        self.sent = []

    async def send(self, text):
        self.sent.append(json.loads(text))

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for message in self.messages:
            if message == "wait":
                for _ in range(50):
                    await asyncio.sleep(0)
                continue
            yield message


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


async def run(script, attempts, clock=None):
    waits = []
    logs = []
    clock = clock or Clock()

    async def sleep(seconds):
        waits.append(seconds)
        clock.now += seconds

    stats = await run_worker(
        "wss://live.example.com/api/voice/worker", TOKEN, 3, length_model, AmplitudeVad,
        connect=script.connect, sleep=sleep, log=logs.append, clock=clock, max_connections=attempts,
    )
    return waits, logs, stats


class BackoffTest(unittest.TestCase):
    def test_sequence_caps_at_30(self):
        self.assertEqual([backoff_seconds(n) for n in range(1, 9)], [1, 2, 4, 8, 16, 30, 30, 30])


class RunnerTest(unittest.IsolatedAsyncioTestCase):
    async def test_unreachable_server_backs_off(self):
        script = Script(["fail"] * 8)
        waits, logs, _ = await run(script, 8)
        self.assertEqual(waits, [1, 2, 4, 8, 16, 30, 30])
        self.assertTrue(all(TOKEN not in line for line in logs))
        self.assertTrue(all("live.example.com" not in line for line in logs))
        self.assertEqual(script.tokens, [TOKEN] * 8)

    async def test_401_log_has_no_token(self):
        script = Script(["401", "401"])
        waits, logs, _ = await run(script, 2)
        self.assertTrue(any("401" in line for line in logs))
        self.assertTrue(all(TOKEN not in line and "Bearer" not in line for line in logs))

    async def test_hello_first_then_results_and_reconnect(self):
        audio = [pack_audio(1, tone(1600)) for _ in range(10)] + [pack_audio(1, silence(1600)) for _ in range(10)]
        script = Script([['{"type":"open","stream":1}', *audio, "wait"], "fail", ['{"type":"open","stream":1}']])
        waits, logs, stats = await run(script, 3)
        first = script.sockets[0].sent
        self.assertEqual(first[0], {"type": "hello", "maxStreams": 3})
        self.assertEqual([m["type"] for m in first[1:]], ["result"])
        self.assertEqual(script.sockets[1].sent, [{"type": "hello", "maxStreams": 3}])
        self.assertEqual(waits, [1, 2])
        self.assertEqual(stats.results, 1)

    async def test_stable_connection_resets_backoff(self):
        clock = Clock()

        class Slow(Socket):
            async def _iterate(self):
                clock.now += 15
                if False:
                    yield None

        script = Script(["fail", "fail"])
        original = script.connect

        def connect(url, token):
            if len(script.urls) == 2:
                script.urls.append(url)

                class Connection:
                    async def __aenter__(self):
                        return Slow([])

                    async def __aexit__(self, *exc):
                        return False

                return Connection()
            return original(url, token)

        script.connect = connect  # type: ignore[assignment]
        waits, _, _ = await run(script, 4, clock)
        self.assertEqual(waits, [1, 2, 1])


class SummaryTest(unittest.TestCase):
    def test_summary_has_counts_only(self):
        stats = Stats(streams_opened=2, segments=5, results=4, proc_ms=[100, 200, 300, 400])
        line = summary_line(stats, 1)
        self.assertIn("결과 4개", line)
        self.assertIn("95% 400ms", line)
        self.assertEqual(percentile([], 95), None)
        self.assertEqual(percentile(list(range(100, 2001, 100)), 95), 1900)


class WorkerSegmenterDefaultTest(unittest.TestCase):
    def test_run_worker_cuts_with_worker_values_by_default(self):
        import inspect

        self.assertIs(inspect.signature(run_worker).parameters["segmenter_factory"].default, worker_segmenter)


if __name__ == "__main__":
    unittest.main()
