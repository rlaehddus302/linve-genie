# codex 명령줄 조립과 답 읽기(D-SCR-16) 시험. 실제 codex는 부르지 않는다 — subprocess.run을 가짜로 바꿔 명령줄만 본다.
import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sw import llm_b6, llm_live


class CodexCommandTest(unittest.TestCase):
    def setUp(self):
        llm_b6._UNSUPPORTED.clear()
        self.addCleanup(llm_b6._UNSUPPORTED.clear)

    def test_default_command_is_unchanged(self):
        # 끝난 방송 시험(sw.llm_b6)이 부르는 모양은 그대로다
        cmd = llm_b6.codex_cmd("/tmp/out.txt", "/tmp/sys.txt", "gpt-5.6-sol", "low")
        self.assertEqual(cmd, ["codex", "exec", "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=low", "-c", "model_instructions_file=/tmp/sys.txt",
                               "--skip-git-repo-check", "-s", "read-only", "-o", "/tmp/out.txt", "-"])

    def test_live_command_drops_overhead_and_fixes_the_answer_shape(self):
        cmd = llm_b6.codex_cmd("/tmp/out.txt", "/tmp/sys.txt", "gpt-5.6-sol", "low", lean=True, schema=llm_b6.SCHEMA_FILE)
        for flag in ("--ephemeral", "--ignore-user-config", "--ignore-rules"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--output-schema") + 1], llm_b6.SCHEMA_FILE)
        self.assertEqual(cmd[-3:], ["-o", "/tmp/out.txt", "-"])                      # 글은 여전히 표준 입력으로
        self.assertLess(cmd.index("exec"), cmd.index("--ephemeral"))                 # exec의 옵션으로 붙는다

    def test_schema_file_matches_the_answer_fields(self):
        schema = json.load(open(llm_b6.SCHEMA_FILE, encoding="utf-8"))
        item = schema["properties"]["products"]["items"]
        self.assertEqual(sorted(item["required"]), sorted(item["properties"]))        # 엄격한 모양: 모든 칸이 필수
        self.assertFalse(item["additionalProperties"])
        self.assertEqual(sorted(item["properties"]), sorted(["line", "no", "no_from", "price", "price_short", "price_line", "name", "confidence", "why"]))

    def test_live_ask_passes_the_flags(self):
        seen = []

        def run(cmd, **kw):
            seen.append(cmd)
            with open(cmd[cmd.index("-o") + 1], "w", encoding="utf-8") as f:
                f.write('{"products": []}')
            return SimpleNamespace(returncode=0, stderr="")

        with patch("sw.llm_b6.subprocess.run", run), patch("sw.llm_live.BACKEND", "codex"):   # 기본은 Claude 구독이 됐다(D-RECOG-40) — codex 길을 골라 본다
            self.assertEqual(llm_live.ask_llm("L0 [0:00:01] (화면: 없음) 안녕하세요"), '{"products": []}')
        self.assertEqual(seen[0][0:2], ["codex", "exec"])
        self.assertEqual("--ephemeral" in seen[0], llm_live.CODEX_LEAN)
        self.assertEqual("--output-schema" in seen[0], llm_live.CODEX_SCHEMA)

    def test_falls_back_when_codex_does_not_know_the_flags(self):
        seen = []

        def run(cmd, **kw):
            seen.append(cmd)
            if "--ignore-rules" in cmd or "--output-schema" in cmd:
                return SimpleNamespace(returncode=2, stderr="error: unexpected argument '--ignore-rules' found\n\nUsage: codex exec [OPTIONS]")
            with open(cmd[cmd.index("-o") + 1], "w", encoding="utf-8") as f:
                f.write('{"line":0,"no":7,"price":30000}')
            return SimpleNamespace(returncode=0, stderr="")

        with patch("sw.llm_b6.subprocess.run", run), patch("sw.llm_b6.time.sleep") as sleep:
            out = llm_b6.ask("L0 …", "/tmp/sys.txt", "gpt-5.6-sol", "low", lean=True, schema=llm_b6.SCHEMA_FILE)
            again = llm_b6.ask("L1 …", "/tmp/sys.txt", "gpt-5.6-sol", "low", lean=True, schema=llm_b6.SCHEMA_FILE)
        self.assertEqual(out, '{"line":0,"no":7,"price":30000}')
        self.assertEqual(again, out)
        sleep.assert_not_called()                                                    # 옵션 탓이면 기다리지 않고 바로 다시 묻는다
        self.assertEqual(len(seen), 3)                                               # 실패 1번 + 옵션 없이 1번, 그 뒤로는 처음부터 옵션 없이
        self.assertNotIn("--ephemeral", seen[1])
        self.assertNotIn("--output-schema", seen[2])

    def test_other_failures_still_retry_with_the_flags(self):
        calls = []

        def run(cmd, **kw):
            calls.append(cmd)
            return SimpleNamespace(returncode=1, stderr="stream disconnected before completion")

        with patch("sw.llm_b6.subprocess.run", run), patch("sw.llm_b6.time.sleep"):
            with self.assertRaises(RuntimeError):
                llm_b6.ask("L0 …", "/tmp/sys.txt", "gpt-5.6-sol", "low", lean=True)
        self.assertEqual(len(calls), 4)
        self.assertTrue(all("--ephemeral" in c for c in calls))


class AnswerShapeTest(unittest.TestCase):
    L = [(3, 10.0, "자 요거 35"), (4, 14.0, "305번 왕색금")]

    def test_reads_json_lines_and_schema_object_alike(self):
        row = {"line": 4, "no": 305, "no_from": "말", "price": 350000, "price_short": None, "price_line": None, "name": "왕색금", "confidence": "high", "why": "말"}
        lines = json.dumps(row, ensure_ascii=False)
        wrapped = json.dumps({"products": [row, dict(row, line=3, no=None, price=20000)]}, ensure_ascii=False)
        self.assertEqual(llm_b6.rows_of(lines, self.L)[0]["no"], 305)
        got = llm_b6.rows_of(wrapped, self.L)
        self.assertEqual([(r["line"], r["no"], r["price"]) for r in got], [(4, 305, 350000), (3, None, 20000)])
        self.assertEqual(llm_b6.rows_of('{"products": []}', self.L), [])
        self.assertEqual(llm_b6.rows_of("", self.L), [])

    def test_shorthand_follows_the_sellers_unit(self):
        ans = lambda price, quote: json.dumps({"line": 4, "no": 305, "price": price, "price_short": quote, "price_line": 3})
        self.assertEqual(llm_b6.rows_of(ans(35000, "35"), self.L)[0]["price"], 350000)                 # 만원 단위(기본)
        self.assertEqual(llm_b6.rows_of(ans(350000, "35"), self.L, unit=1000)[0]["price"], 35000)      # 천원 단위 판매자
        self.assertEqual(llm_b6.rows_of(ans(35, "35"), self.L, unit=1000)[0]["price"], 35000)
        self.assertEqual(llm_b6.rows_of(ans(35000, "35"), self.L, unit=None)[0]["price"], 35000)       # 단위 없음: 손대지 않는다

    def test_three_digit_shorthand_only_when_asked(self):
        L = [(7, 30.0, "222번 자 130에 드립니다")]
        ans = json.dumps({"line": 7, "no": 222, "price": 130000, "price_short": "130", "price_line": 7})
        self.assertEqual(llm_b6.rows_of(ans, L)[0]["price"], 130000)                                   # 옛 동작 그대로
        self.assertEqual(llm_b6.rows_of(ans, L, wide=True)[0]["price"], 1300000)                       # 라이브 등록(D-SCR-13)
        odd = json.dumps({"line": 7, "no": 222, "price": 225000, "price_short": "225", "price_line": 7})
        self.assertEqual(llm_b6.rows_of(odd, [(7, 30.0, "되고 225")], wide=True)[0]["price"], 225000)  # 10으로 안 떨어지는 세 자리는 그대로


class UnitPromptTest(unittest.TestCase):
    def test_prompt_follows_the_unit(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(llm_live.prompt_for_unit(10000, tmp), llm_live.SYS)       # 만원: 지시문 그대로
            self.assertFalse(os.listdir(tmp))
            text = open(llm_live.prompt_for_unit(1000, tmp), encoding="utf-8").read()
            self.assertIn("천원 단위다", text)
            self.assertIn('"자 요거 35", "305번 삼십오"는 35000원이다', text)
            self.assertNotIn("만원 단위다", text)
            text = open(llm_live.prompt_for_unit(None, tmp), encoding="utf-8").read()
            self.assertIn("10. 단위 없이 말한 수는 판매가로 적지 않는다", text)
            self.assertNotIn("만원 단위다", text)
            self.assertIn("출력형식:", text)                                            # 나머지 지시문은 그대로


if __name__ == "__main__":
    unittest.main()
