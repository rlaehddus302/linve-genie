# 화면 일꾼 관리자(sw.serve) — 판 고정(D-RETRO-33)과 방송 목록 읽기. 표준 라이브러리만 쓴다(무거운 모델 없이 돈다).
#   cd packages/screen-worker && python3 -m unittest tests.test_serve
import argparse
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from sw import serve


class PinTest(unittest.TestCase):
    """내보내기가 current 링크를 새 판으로 바꿔도 이미 켜진 관리자는 옛 판의 코드와 파이썬 묶음으로만 일꾼을 띄운다"""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for rel in ("aaaaaaaaaaaa", "bbbbbbbbbbbb"):
            os.makedirs(os.path.join(self.root, "releases", rel, ".venv", "bin"))
            open(os.path.join(self.root, "releases", rel, ".venv", "bin", "python"), "w").close()
        self.current = os.path.join(self.root, "current")
        os.symlink(os.path.join("releases", "aaaaaaaaaaaa"), self.current)
        self.old = os.path.join(self.root, "releases", "aaaaaaaaaaaa")

    def test_python_started_through_the_link_is_pinned_to_the_resolved_release(self):
        exe = os.path.join(self.current, ".venv", "bin", "python")
        pinned = serve.pin_python(exe, self.old)
        self.assertEqual(pinned, os.path.join(self.old, ".venv", "bin", "python"))
        # 링크가 새 판으로 바뀐 뒤에도 그대로
        os.remove(self.current)
        os.symlink(os.path.join("releases", "bbbbbbbbbbbb"), self.current)
        self.assertEqual(os.path.realpath(os.path.dirname(os.path.dirname(os.path.dirname(pinned)))), self.old)
        self.assertTrue(os.path.exists(pinned))

    def test_other_pythons_are_left_alone(self):
        for exe in ("/usr/bin/python3", "/opt/homebrew/bin/python3.12", os.path.join(self.root, "releases", "bbbbbbbbbbbb", ".venv", "bin", "python"), ""):
            with self.subTest(exe=exe):
                self.assertEqual(serve.pin_python(exe, self.old), exe)

    def test_repo_checkout_keeps_the_same_path(self):
        # 저장소를 그대로 돌리는 옛 방식: packages/screen-worker/.venv/bin/python → 같은 경로
        exe = os.path.join(self.old, ".venv", "bin", "python")
        self.assertEqual(serve.pin_python(exe, self.old), exe)

    def test_worker_command_uses_the_pinned_python_and_folder(self):
        a = argparse.Namespace(server="https://example.test/", token_file="/tmp/token", out_root="/tmp/out", max=2, interval=30, worker_cmd=None, worker_args=["--no-llm"])
        with patch.object(serve, "HERE", self.old), patch.object(sys, "executable", os.path.join(self.current, ".venv", "bin", "python")):
            cmd = serve.Serve(a).command("abcdefghijk", "/tmp/out/x")
        self.assertEqual(cmd[0], os.path.join(self.old, ".venv", "bin", "python"))
        self.assertEqual(cmd[1:4], ["-m", "sw", "https://www.youtube.com/watch?v=abcdefghijk"])
        self.assertEqual(cmd[-1], "--no-llm")

    def test_here_is_a_resolved_path(self):
        self.assertEqual(serve.HERE, os.path.realpath(serve.HERE))
        self.assertTrue(os.path.isfile(os.path.join(serve.HERE, "sw", "serve.py")))


class ReleaseIdTest(unittest.TestCase):
    def test_release_file_wins_and_garbage_is_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            # 판 폴더도 저장소도 아니면 모름 (git이 없거나 실패해도 같다)
            with patch.object(serve.subprocess, "run", side_effect=OSError("no git")):
                self.assertIsNone(serve.release_id(tmp))
            path = os.path.join(tmp, "RELEASE")
            for text, expected in (("63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5\n", "63fb1cf8a0b1"), ("63fb1cf8\n", "63fb1cf8"), ("not a commit\n", None), ("\n", None)):
                with self.subTest(text=text):
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(text)
                    self.assertEqual(serve.release_id(tmp), expected)

    def test_repo_checkout_reports_its_head(self):
        class Done:
            stdout = "d2bfbb13aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
        with tempfile.TemporaryDirectory() as tmp, patch.object(serve.subprocess, "run", return_value=Done()) as run:
            self.assertEqual(serve.release_id(tmp), "d2bfbb13aaaa")
            self.assertEqual(run.call_args[0][0][:3], ["git", "-C", tmp])


class FetchTest(unittest.TestCase):
    """방송 목록 묻기 — 내보내기 문지기(scripts/deploy/live-gate.sh)가 같은 입구·같은 토큰 파일을 쓴다"""

    def serve_with(self, token_file):
        return serve.Serve(argparse.Namespace(server="https://example.test/", token_file=token_file, out_root="/tmp/out", max=2, interval=30, worker_cmd=None, worker_args=None))

    def test_asks_the_live_endpoint_with_the_token_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_file = os.path.join(tmp, "token")
            with open(token_file, "w", encoding="utf-8") as f:
                f.write("screen-worker-token-0123456789abcdef\n")
            s = self.serve_with(token_file)
            with patch.object(serve.post, "http_json", return_value=(200, {"videos": [{"videoId": "abcdefghijk"}, {"videoId": "abcdefghijk"}, {"videoId": "bad"}, "x"]})) as http:
                self.assertEqual(s.fetch(), ["abcdefghijk"])
            self.assertEqual(http.call_args[0], ("GET", "https://example.test/internal/screen/live", "screen-worker-token-0123456789abcdef"))
            with patch.object(serve.post, "http_json", return_value=(200, {"videos": []})):
                self.assertEqual(s.fetch(), [])

    def test_failures_are_none_so_running_workers_are_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_file = os.path.join(tmp, "token")
            s = self.serve_with(token_file)
            with patch.object(serve, "log"):
                self.assertIsNone(s.fetch())   # 토큰 파일 없음
                with open(token_file, "w", encoding="utf-8") as f:
                    f.write("screen-worker-token-0123456789abcdef")
                for answer in ((None, "timed out"), (404, None), (401, {"error": {}}), (503, None), (200, {"videos": "x"}), (200, [])):
                    with self.subTest(answer=answer), patch.object(serve.post, "http_json", return_value=answer):
                        self.assertIsNone(s.fetch())


if __name__ == "__main__":
    unittest.main()
