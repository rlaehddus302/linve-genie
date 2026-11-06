# AC-APP1-04 흐름 한도·닫은 흐름, AC-APP1-53 일꾼 입력(짧은 틀·열지 않은 흐름·깨진 JSON·홀수 바이트)
from __future__ import annotations

import asyncio
import json
import unittest

from livegenie_transcriber.protocol import pack_audio
from livegenie_transcriber.segmenter import worker_segmenter
from livegenie_transcriber.session import WorkerSession

from helpers import AmplitudeVad, length_model, silence, tone

CHUNK = 1600  # 100ms


def speech_then_pause(speech_ms: int = 1000, pause_ms: int = 1000):
    """100ms 조각들: 말 → 쉼"""
    chunks = [tone(CHUNK) for _ in range(speech_ms // 100)]
    chunks += [silence(CHUNK) for _ in range(pause_ms // 100)]
    return chunks


class Recorder:
    def __init__(self):
        self.sent = []

    async def send(self, text):
        self.sent.append(json.loads(text))

    def results(self, stream=None):
        return [m for m in self.sent if m["type"] == "result" and (stream is None or m["stream"] == stream)]


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def make(max_streams=4, model=length_model, run_blocking=None):
    recorder = Recorder()
    session = WorkerSession(recorder.send, model, AmplitudeVad, max_streams, Clock(), run_blocking)
    session.start()
    return session, recorder


async def feed(session, stream, chunks):
    for pcm in chunks:
        await session.handle_binary(pack_audio(stream, pcm))


class LimitTest(unittest.IsolatedAsyncioTestCase):
    async def test_third_stream_over_limit_gets_no_result(self):
        session, recorder = make(max_streams=2)
        for stream in (1, 2, 3):
            await session.handle_text(json.dumps({"type": "open", "stream": stream}))
        self.assertEqual(session.open_streams, 2)
        for stream in (1, 2, 3):
            await feed(session, stream, speech_then_pause())
        await session.drain()
        self.assertEqual(len(recorder.results(1)), 1)
        self.assertEqual(len(recorder.results(2)), 1)
        self.assertEqual(recorder.results(3), [])
        self.assertEqual(session.stats.streams_refused, 1)
        # 결과 모양: 받은 조각 길이를 글로 돌려주는 가짜 모델, 시각은 정수
        result = recorder.results(1)[0]
        self.assertEqual(result["startMs"], 0)
        self.assertTrue(abs(result["endMs"] - 1000) <= 32)
        self.assertEqual(result["text"], f"표본 {result['endMs'] * 16}")
        self.assertIsInstance(result["procMs"], int)
        await session.close()

    async def test_slot_frees_after_close(self):
        session, recorder = make(max_streams=1)
        await session.handle_text('{"type":"open","stream":1}')
        await session.handle_text('{"type":"open","stream":2}')
        await session.handle_text('{"type":"close","stream":1}')
        await session.handle_text('{"type":"open","stream":3}')
        await feed(session, 3, speech_then_pause())
        await session.drain()
        self.assertEqual(len(recorder.results(3)), 1)
        await session.close()


class CloseTest(unittest.IsolatedAsyncioTestCase):
    async def test_close_discards_unfinished_speech(self):
        session, recorder = make()
        await session.handle_text('{"type":"open","stream":1}')
        await feed(session, 1, [tone(CHUNK) for _ in range(10)])
        await session.handle_text('{"type":"close","stream":1}')
        await feed(session, 1, [silence(CHUNK) for _ in range(10)])
        await session.drain()
        self.assertEqual(recorder.results(), [])
        await session.close()

    async def test_close_during_transcription_drops_result(self):
        gate = asyncio.Event()
        started = asyncio.Event()

        async def run_blocking(job):
            started.set()
            await gate.wait()
            return job()

        session, recorder = make(run_blocking=run_blocking)
        await session.handle_text('{"type":"open","stream":1}')
        await feed(session, 1, speech_then_pause())
        await asyncio.wait_for(started.wait(), 2)
        await session.handle_text('{"type":"close","stream":1}')
        gate.set()
        await session.drain()
        self.assertEqual(recorder.results(), [])
        await session.close()

    async def test_queued_segments_of_closed_stream_are_dropped(self):
        gate = asyncio.Event()

        async def run_blocking(job):
            await gate.wait()
            return job()

        session, recorder = make(run_blocking=run_blocking)
        for stream in (1, 2):
            await session.handle_text(json.dumps({"type": "open", "stream": stream}))
        await feed(session, 1, speech_then_pause())  # 받아쓰는 중(문 앞에서 기다림)
        await feed(session, 2, speech_then_pause())  # 줄에 섬
        await feed(session, 2, speech_then_pause())
        await session.handle_text('{"type":"close","stream":2}')
        gate.set()
        await session.drain()
        self.assertEqual(len(recorder.results(1)), 1)
        self.assertEqual(recorder.results(2), [])
        await session.close()

    async def test_empty_text_is_not_sent(self):
        session, recorder = make(model=lambda pcm: "   ")
        await session.handle_text('{"type":"open","stream":1}')
        await feed(session, 1, speech_then_pause())
        await session.drain()
        self.assertEqual(recorder.sent, [])
        await session.close()

    async def test_model_error_does_not_kill_session(self):
        calls = []

        def flaky(pcm):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("모델 오류")
            return "둘째"

        session, recorder = make(model=flaky)
        await session.handle_text('{"type":"open","stream":1}')
        await feed(session, 1, speech_then_pause() + speech_then_pause())
        await session.drain()
        self.assertEqual([r["text"] for r in recorder.results()], ["둘째"])
        self.assertEqual(session.stats.model_errors, 1)
        await session.close()


class BadInputTest(unittest.IsolatedAsyncioTestCase):
    async def test_bad_frames_are_dropped_without_exception(self):
        session, recorder = make()
        await session.handle_text('{"type":"open","stream":1}')
        await session.handle_binary(b"\x00\x01")  # 4바이트보다 짧음
        await session.handle_binary(pack_audio(9, tone(CHUNK)))  # 열지 않은 흐름
        await session.handle_binary(b"\x00\x00\x00\x00" + tone(CHUNK))  # 0번
        await session.handle_binary(pack_audio(1, tone(CHUNK) + b"\x01"))  # 홀수 바이트
        await session.handle_binary("글")  # type: ignore[arg-type]
        for raw in ("{", "null", '{"type":"open","stream":-1}', '{"type":"result"}', "x" * 5000):
            await session.handle_text(raw)
        self.assertEqual(session.stats.bad_frames, 10)
        # 그 뒤에도 정상 흐름은 받아쓴다
        await feed(session, 1, speech_then_pause())
        await session.drain()
        self.assertEqual(len(recorder.results(1)), 1)
        await session.close()

    async def test_broken_vad_counts_as_silence(self):
        class Broken:
            window = 512

            def probability(self, pcm):
                raise ValueError("vad")

        recorder = Recorder()
        session = WorkerSession(recorder.send, length_model, Broken, 4, Clock())
        session.start()
        await session.handle_text('{"type":"open","stream":1}')
        await feed(session, 1, speech_then_pause())
        await session.drain()
        self.assertEqual(recorder.sent, [])
        await session.close()

    async def test_connection_close_discards_everything(self):
        gate = asyncio.Event()

        async def run_blocking(job):
            await gate.wait()
            return job()

        session, recorder = make(run_blocking=run_blocking)
        await session.handle_text('{"type":"open","stream":1}')
        await feed(session, 1, speech_then_pause() + speech_then_pause())
        await session.close()
        gate.set()
        await asyncio.sleep(0)
        self.assertEqual(recorder.sent, [])
        self.assertEqual(session.open_streams, 0)


class WorkerSegmenterTest(unittest.IsolatedAsyncioTestCase):
    """일꾼 흐름은 고른 여유로 자른다: 말 앞 쉼 0.2초·말 뒤 쉼 0.2초까지 조각에 들어간다"""

    async def test_each_stream_gets_its_own_segmenter_with_rolls(self):
        recorder = Recorder()
        session = WorkerSession(recorder.send, length_model, AmplitudeVad, 4, Clock(), None, None, worker_segmenter)
        session.start()
        for stream in (1, 2):
            await session.handle_text(json.dumps({"type": "open", "stream": stream}))
            await feed(session, stream, [silence(CHUNK) for _ in range(5)] + speech_then_pause())
        await session.drain()
        for stream in (1, 2):
            result = recorder.results(stream)[0]
            self.assertTrue(abs(result["startMs"] - 300) <= 32, result)
            self.assertTrue(abs(result["endMs"] - 1700) <= 32, result)
        await session.close()


if __name__ == "__main__":
    unittest.main()


class HintTest(unittest.IsolatedAsyncioTestCase):
    """D-V3-127: 흐름을 열 때 받은 힌트를 그 흐름의 조각마다 모델에 같이 준다. 힌트를 안 받는 모델(pcm 하나)은 그대로"""

    async def test_hint_reaches_model_per_stream(self):
        seen = []

        def model(pcm, hint):
            seen.append(hint)
            return f"표본 {len(pcm) // 2}"

        session, recorder = make(model=model)
        await session.handle_text(json.dumps({"type": "open", "stream": 1, "hint": "이백팔번 오만 원. 아사달금."}))
        await session.handle_text(json.dumps({"type": "open", "stream": 2}))
        await feed(session, 1, speech_then_pause())
        await feed(session, 2, speech_then_pause())
        await session.drain()
        self.assertEqual(sorted(seen), ["", "이백팔번 오만 원. 아사달금."])
        self.assertEqual(len(recorder.results()), 2)
        await session.close()

    async def test_model_without_hint_parameter_still_runs(self):
        session, recorder = make()
        await session.handle_text(json.dumps({"type": "open", "stream": 1, "hint": "녹금"}))
        await feed(session, 1, speech_then_pause())
        await session.drain()
        self.assertEqual(len(recorder.results(1)), 1)
        await session.close()
