# AC-APP1-03 (D-APP1-01) 틀 묶기·풀기, AC-APP1-53 일꾼 입력 일부
from __future__ import annotations

import json
import unittest

from livegenie_transcriber.protocol import (
    hello_message,
    pack_audio,
    parse_server_message,
    result_message,
    unpack_audio,
)

PCM = bytes(range(256)) * 12 + bytes(128)  # 3,200바이트


class FrameTest(unittest.TestCase):
    def test_pack_and_unpack_keep_number_and_bytes(self):
        self.assertEqual(len(PCM), 3200)
        for stream in (1, 258, 4294967295):
            frame = pack_audio(stream, PCM)
            self.assertEqual(frame[:4], stream.to_bytes(4, "big"))
            self.assertEqual(unpack_audio(frame), (stream, PCM))

    def test_258_is_big_endian(self):
        self.assertEqual(pack_audio(258, b"")[:4], b"\x00\x00\x01\x02")

    def test_short_or_zero_frames_are_dropped(self):
        self.assertIsNone(unpack_audio(b""))
        self.assertIsNone(unpack_audio(b"\x00\x00\x01"))
        self.assertIsNone(unpack_audio(b"\x00\x00\x00\x00" + PCM))
        self.assertIsNone(unpack_audio("글"))  # type: ignore[arg-type]

    def test_pack_rejects_out_of_range(self):
        for bad in (0, -1, 4294967296, True):
            with self.assertRaises(ValueError):
                pack_audio(bad, PCM)  # type: ignore[arg-type]


class MessageTest(unittest.TestCase):
    def test_hello_carries_max_streams(self):
        self.assertEqual(json.loads(hello_message(4)), {"type": "hello", "maxStreams": 4})
        self.assertEqual(json.loads(hello_message(2)), {"type": "hello", "maxStreams": 2})

    def test_open_and_close(self):
        self.assertEqual(parse_server_message('{"type":"open","stream":1}').type, "open")
        self.assertEqual(parse_server_message(b'{"type":"close","stream":4294967295}').stream, 4294967295)

    def test_bad_messages_are_none(self):
        for raw in ("{", "[]", '"open"', '{"type":"open"}', '{"type":"open","stream":0}', '{"type":"open","stream":1.5}',
                    '{"type":"open","stream":true}', '{"type":"open","stream":4294967296}', '{"type":"hi","stream":1}',
                    b"\xff\xfe", None, 3):
            self.assertIsNone(parse_server_message(raw), raw)

    def test_result_message_shape(self):
        message = json.loads(result_message(3, "15번 2만 원", 0, 1234, 210))
        self.assertEqual(message, {"type": "result", "stream": 3, "text": "15번 2만 원", "startMs": 0, "endMs": 1234, "procMs": 210})
        self.assertEqual(json.loads(result_message(1, "가", 0, 1, -5))["procMs"], 0)


if __name__ == "__main__":
    unittest.main()
