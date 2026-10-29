# AC-APP1-05 (D-APP-03·D-APP-04): 일꾼의 로그 출력에 표지 글·토큰 값·소리 바이트가 없고, 일꾼이 쓴 파일이 없다
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MARKER = "십오번 이만원"
TOKEN = "tok-Zq81-SECRET-livegenie"


def listing(folder):
    out = []
    for base, dirs, files in os.walk(folder):
        for name in dirs + files:
            out.append(os.path.relpath(os.path.join(base, name), folder))
    return sorted(out)


class NoTracesTest(unittest.TestCase):
    def test_logs_have_counts_only_and_no_files_are_written(self):
        with tempfile.TemporaryDirectory() as secrets, tempfile.TemporaryDirectory() as work, \
                tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as home:
            token_file = os.path.join(secrets, "worker-token")
            with open(token_file, "w") as handle:
                handle.write(TOKEN + "\n")
            os.chmod(token_file, 0o600)
            package_before = listing(ROOT)
            env = {
                "PATH": os.environ.get("PATH", ""),
                "TMPDIR": tmp,
                "HOME": home,
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONIOENCODING": "utf-8",
            }
            result = subprocess.run(
                [sys.executable, "-B", os.path.join(HERE, "fake_worker.py"), token_file, MARKER],
                cwd=work,
                env=env,
                capture_output=True,
                timeout=60,
            )
            output = result.stdout + result.stderr
            text = output.decode("utf-8", errors="replace")
            self.assertEqual(result.returncode, 0, "표지 글이 결과로 서버에 가야 한다")
            self.assertNotIn(MARKER.encode("utf-8"), output)
            self.assertNotIn(TOKEN.encode("utf-8"), output)
            self.assertNotIn(b"Bearer", output)
            # 소리 바이트(표지 소리 1234 = 0xd2 0x04)나 바이트 표현이 찍히지 않는다
            self.assertNotIn(b"\xd2\x04\xd2\x04", output)
            self.assertNotIn("\\x", text)
            # 로그 줄은 있다(셈·연결 상태)
            self.assertIn("라이브지니 서버에 붙었어요", text)
            # 일꾼이 쓴 파일이 없다
            self.assertEqual(listing(work), [])
            self.assertEqual(listing(tmp), [])
            self.assertEqual(listing(home), [])
            self.assertEqual(listing(secrets), ["worker-token"])
            self.assertEqual(listing(ROOT), package_before)


if __name__ == "__main__":
    unittest.main()
