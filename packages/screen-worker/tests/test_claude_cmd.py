# Claude 구독으로 묻기(D-RECOG-40) 시험. 실제 claude는 부르지 않는다 — subprocess.run을 가짜로 바꿔 명령줄·환경·답 읽기만 본다.
import json
import os
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sw import llm_b6, llm_live


def ok(obj):
    return SimpleNamespace(returncode=0, stdout=json.dumps(obj, ensure_ascii=False), stderr="")


class ClaudeCommandTest(unittest.TestCase):
    def test_command_turns_off_tools_and_replaces_the_system_prompt(self):
        cmd = llm_b6.claude_cmd("/tmp/sys.txt", "sonnet", "low")
        self.assertEqual(cmd[1:6], ["-p", "--model", "sonnet", "--effort", "low"])
        self.assertEqual(cmd[cmd.index("--system-prompt-file") + 1], "/tmp/sys.txt")
        self.assertEqual(cmd[cmd.index("--tools") + 1], "")                           # 도구 없음
        for flag in ("--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--output-format") + 1], "json")
        self.assertEqual(cmd[cmd.index("--setting-sources") + 1], "project")           # 사용자 설정의 훅을 돌리지 않는다
        self.assertNotIn("--bare", cmd)                                              # --bare는 구독 로그인을 읽지 않는다
        self.assertNotIn("--json-schema", cmd)

    def test_schema_is_passed_inline(self):
        cmd = llm_b6.claude_cmd("/tmp/sys.txt", "sonnet", None, llm_b6.SCHEMA_FILE)
        self.assertNotIn("--effort", cmd)
        schema = json.loads(cmd[cmd.index("--json-schema") + 1])
        self.assertEqual(schema, json.load(open(llm_b6.SCHEMA_FILE, encoding="utf-8")))

    def test_env_drops_api_keys_and_adds_the_subscription_token(self):
        with tempfile.NamedTemporaryFile("w", suffix=".tok", delete=False) as f:
            f.write("  가짜-표\n")
        self.addCleanup(os.unlink, f.name)
        with patch("sw.llm_b6.TOKEN_FILE", f.name):
            env = llm_b6.claude_env({"ANTHROPIC_API_KEY": "k", "ANTHROPIC_AUTH_TOKEN": "t", "PATH": "/bin"})
        self.assertEqual(env, {"PATH": "/bin", "CLAUDE_CODE_OAUTH_TOKEN": "가짜-표"})  # 돈이 드는 API 열쇠는 넘기지 않는다
        with patch("sw.llm_b6.TOKEN_FILE", f.name + ".없음"):
            self.assertEqual(llm_b6.claude_env({"PATH": "/bin"}), {"PATH": "/bin"})   # 표가 없으면 키체인 로그인 그대로

    def test_answer_reading(self):
        self.assertEqual(llm_b6.claude_answer(json.dumps({"result": "", "structured_output": {"products": []}})), ('{"products": []}', None))
        self.assertEqual(llm_b6.claude_answer(json.dumps({"result": "7번 3만원", "is_error": False})), ("7번 3만원", None))
        self.assertEqual(llm_b6.claude_answer(json.dumps({"result": "", "is_error": False})), ("", None))   # 빈 답은 실패가 아니다
        self.assertEqual(llm_b6.claude_answer(json.dumps({"result": "Failed to authenticate", "is_error": True}))[0], None)
        self.assertEqual(llm_b6.claude_answer("깨진 글")[0], None)

    def test_live_ask_goes_to_claude_with_the_answer_shape(self):
        seen = []

        def run(cmd, **kw):
            seen.append((cmd, kw))
            return ok({"result": "", "is_error": False, "structured_output": {"products": []}})

        with patch("sw.llm_b6.subprocess.run", run), patch("sw.llm_live.BACKEND", "claude"), patch("sw.llm_live.MODEL", "sonnet"):
            self.assertEqual(llm_live.ask_llm("L0 [0:00:01] (화면: 없음) 안녕하세요"), '{"products": []}')
        cmd, kw = seen[0]
        self.assertEqual(cmd[0], llm_b6.CLAUDE_BIN)
        self.assertEqual(cmd[cmd.index("--model") + 1], "sonnet")
        self.assertEqual("--json-schema" in cmd, llm_live.CODEX_SCHEMA)
        self.assertEqual(kw["input"], "L0 [0:00:01] (화면: 없음) 안녕하세요")             # 물음은 표준 입력으로
        self.assertNotIn("ANTHROPIC_API_KEY", kw["env"])

    def test_login_failure_is_reported_at_once(self):
        calls = []

        def run(cmd, **kw):
            calls.append(cmd)
            return SimpleNamespace(returncode=1, stdout=json.dumps({"result": "Failed to authenticate: OAuth session expired", "is_error": True}), stderr="")

        with patch("sw.llm_b6.subprocess.run", run), patch("sw.llm_b6.time.sleep") as sleep:
            with self.assertRaises(llm_b6.ClaudeLoginError):
                llm_b6.ask("L0 …", "/tmp/sys.txt", "sonnet", "low", backend="claude")
        self.assertEqual(len(calls), 1)                                              # 로그인이 안 되면 다시 묻지 않는다
        sleep.assert_not_called()

    def test_other_failures_retry_then_give_up(self):
        calls = []

        def run(cmd, **kw):
            calls.append(cmd)
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(cmd, 1)
            return SimpleNamespace(returncode=1, stdout=json.dumps({"result": "Overloaded", "is_error": True}), stderr="")

        with patch("sw.llm_b6.subprocess.run", run), patch("sw.llm_b6.time.sleep"):
            with self.assertRaises(RuntimeError) as e:
                llm_b6.ask("L0 …", "/tmp/sys.txt", "sonnet", "low", backend="claude")
        self.assertEqual(len(calls), 4)
        self.assertNotIsInstance(e.exception, llm_b6.ClaudeLoginError)

    def test_default_backend_is_the_claude_subscription(self):
        self.assertEqual(llm_live.BACKEND, os.environ.get("LLM_REG_BACKEND", "claude"))


if __name__ == "__main__":
    unittest.main()
