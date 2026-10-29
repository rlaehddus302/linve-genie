# AC-APP1-06 (D-APP-14) 모델 설정, --max-streams·--token-file 읽기
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest

from livegenie_transcriber.config import ConfigError, HelpRequested, parse_args, read_token, worker_url

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NO_ENV: dict = {}


def args(*extra):
    return ["--server", "https://live.example.com", "--token-file", "/x/token", *extra]


class ModelTest(unittest.TestCase):
    def test_default_is_cohere(self):
        config = parse_args(args(), NO_ENV)
        self.assertEqual(config.model, "cohere")
        self.assertEqual(config.model_id, "CohereLabs/cohere-transcribe-03-2026")

    def test_whisper_is_large_v3_turbo(self):
        config = parse_args(args("--model", "whisper"), NO_ENV)
        self.assertEqual(config.model_id, "openai/whisper-large-v3-turbo")
        self.assertEqual(parse_args(args("--model=WHISPER"), NO_ENV).model, "whisper")

    def test_unknown_model_stops_with_plain_sentence(self):
        with self.assertRaises(ConfigError) as caught:
            parse_args(args("--model", "qwen"), NO_ENV)
        self.assertIn("cohere 또는 whisper", str(caught.exception))

    def test_language_is_fixed_korean(self):
        from livegenie_transcriber import config as module

        self.assertEqual(module.LANGUAGE, "ko")
        with self.assertRaises(ConfigError):
            parse_args(args("--language", "en"), NO_ENV)


class StreamsTest(unittest.TestCase):
    def test_max_streams_default_and_range(self):
        self.assertEqual(parse_args(args(), NO_ENV).max_streams, 4)
        self.assertEqual(parse_args(args("--max-streams", "2"), NO_ENV).max_streams, 2)
        self.assertEqual(parse_args(args("--max-streams", "64"), NO_ENV).max_streams, 64)
        for bad in ("0", "65", "-1", "two", "1.5", ""):
            with self.assertRaises(ConfigError):
                parse_args(args("--max-streams", bad), NO_ENV)


class ServerTest(unittest.TestCase):
    def test_worker_url(self):
        self.assertEqual(worker_url("https://live.example.com"), "wss://live.example.com/api/voice/worker")
        self.assertEqual(worker_url("http://localhost:7700/"), "ws://localhost:7700/api/voice/worker")
        self.assertEqual(worker_url("wss://a.b/api/voice/worker"), "wss://a.b/api/voice/worker")

    def test_token_never_goes_in_url(self):
        for bad in ("https://a.b/?token=abc", "https://user:abc@a.b", "ftp://a.b", "a.b"):
            with self.assertRaises(ConfigError) as caught:
                worker_url(bad)
            self.assertNotIn("abc", str(caught.exception))

    def test_missing_server_or_token(self):
        with self.assertRaises(ConfigError):
            parse_args(["--token-file", "/x"], NO_ENV)
        with self.assertRaises(ConfigError):
            parse_args(["--server", "https://a.b"], NO_ENV)
        self.assertIsNone(parse_args(["--server", "https://a.b"], {"LIVEJJIM_TRANSCRIBE_WORKER_TOKEN": "t"}).token_file)

    def test_help(self):
        with self.assertRaises(HelpRequested):
            parse_args(["--help"], NO_ENV)

    def test_unknown_option_is_not_echoed(self):
        with self.assertRaises(ConfigError) as caught:
            parse_args(args("secret-token-value"), NO_ENV)
        self.assertNotIn("secret-token-value", str(caught.exception))


class TokenTest(unittest.TestCase):
    def test_reads_token_file_and_never_echoes_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "token")
            with open(path, "w") as handle:
                handle.write("tok-ABC123\n")
            config = parse_args(["--server", "https://a.b", "--token-file", path], NO_ENV)
            self.assertEqual(read_token(config, NO_ENV), "tok-ABC123")
            with open(path, "w") as handle:
                handle.write("  \n")
            with self.assertRaises(ConfigError):
                read_token(config, NO_ENV)
            with open(path, "w") as handle:
                handle.write("tok ABC")
            with self.assertRaises(ConfigError) as caught:
                read_token(config, NO_ENV)
            self.assertNotIn("ABC", str(caught.exception))

    def test_missing_token_file(self):
        config = parse_args(["--server", "https://a.b", "--token-file", "/no/such/token-file"], NO_ENV)
        with self.assertRaises(ConfigError):
            read_token(config, NO_ENV)


class CommandTest(unittest.TestCase):
    def test_unknown_model_exits_without_starting(self):
        result = subprocess.run(
            [sys.executable, "-m", "livegenie_transcriber", "--server", "https://a.b", "--token-file", "/x", "--model", "qwen"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("일꾼을 시작하지 못했어요", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
