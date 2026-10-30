# 맥 미니 설치 묶음(macmini/*.sh) 시험: 문법, launchd 파일 형식, 설정 파일 권한, 토큰이 화면·설정·명령줄에 안 나옴, 상태 보기.
# 실제 launchd 등록·꾸러미 설치·모델 내려받기는 하지 않는다(launchctl은 가짜, 설치 폴더는 임시 폴더).
from __future__ import annotations

import hashlib
import os
import plistlib
import shutil
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MACMINI = os.path.join(ROOT, "macmini")
BASH = "/bin/bash"
TOKEN = "wkr-Q7z9-SECRET-macmini-0042"
SCRIPTS = ("lib.sh", "run.sh", "install.sh", "configure.sh", "download-model.sh", "start.sh", "stop.sh", "status.sh", "update.sh", "uninstall.sh")


def mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


class Sandbox:
    """임시 설치 폴더(빈칸 있는 경로)·가짜 launchctl·임시 로그"""

    def __init__(self, launchctl="/usr/bin/false"):
        self._tmp = tempfile.TemporaryDirectory()
        base = self._tmp.name
        self.home = os.path.join(base, "Application Support", "LiveJjim", "transcriber")
        self.agents = os.path.join(base, "LaunchAgents")
        self.log = os.path.join(base, "Logs", "livejjim-transcriber.log")
        self.env = {
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": base,
            "LANG": "ko_KR.UTF-8",
            "LIVEJJIM_TRANSCRIBER_HOME": self.home,
            "LIVEJJIM_LAUNCH_AGENTS": self.agents,
            "LIVEJJIM_TRANSCRIBER_LOG": self.log,
            "LIVEJJIM_LAUNCHCTL": launchctl,
        }

    def run(self, script, stdin="", args=(), extra_env=None, folder=MACMINI):
        env = dict(self.env)
        env.update(extra_env or {})
        return subprocess.run(
            [BASH, os.path.join(folder, script), *args],
            input=stdin.encode("utf-8"),
            env=env,
            capture_output=True,
            timeout=60,
        )

    def close(self):
        self._tmp.cleanup()


def code_lines(name):
    """주석을 뺀 스크립트 줄"""
    with open(os.path.join(MACMINI, name), encoding="utf-8") as handle:
        return "\n".join(line for line in handle.read().splitlines() if not line.lstrip().startswith("#"))


def output_of(result):
    return (result.stdout + result.stderr).decode("utf-8", errors="replace")


class SyntaxTest(unittest.TestCase):
    def test_all_scripts_parse(self):
        shellcheck = shutil.which("shellcheck")
        for name in SCRIPTS:
            path = os.path.join(MACMINI, name)
            self.assertTrue(os.path.isfile(path), name)
            result = subprocess.run([BASH, "-n", path], capture_output=True)
            self.assertEqual(result.returncode, 0, f"{name}: {output_of(result)}")
            if shellcheck:
                checked = subprocess.run([shellcheck, "-x", "-S", "warning", path], cwd=MACMINI, capture_output=True)
                self.assertEqual(checked.returncode, 0, f"{name}: {output_of(checked)}")

    def test_no_bash4_only_syntax(self):
        # 맥 기본 bash는 3.2다: 연관 배열·mapfile·${x,,}·${x^^}를 쓰지 않는다
        for name in SCRIPTS:
            text = code_lines(name)
            for banned in ("declare -A", "mapfile", "readarray", ",,}", "^^}"):
                self.assertFalse(banned in text, f"{name}: {banned}")

    def test_no_system_changes_or_sudo(self):
        # 시스템 전원 설정·관리자 권한을 쓰지 않는다
        for name in SCRIPTS:
            code = code_lines(name)
            for banned in ("sudo ", "pmset", "systemsetup", "hf auth login", "huggingface-cli login"):
                self.assertFalse(banned in code, f"{name}: {banned}")


class PlistTest(unittest.TestCase):
    def setUp(self):
        self.box = Sandbox()

    def tearDown(self):
        self.box.close()

    def test_launch_agent_file_is_valid_and_keeps_worker_alive(self):
        result = subprocess.run(
            [BASH, "-c", '. "$1/lib.sh" && write_plist', "-", MACMINI],
            env=self.box.env,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, output_of(result))
        path = os.path.join(self.box.agents, "com.livejjim.transcriber.plist")
        if os.path.exists("/usr/bin/plutil"):
            lint = subprocess.run(["/usr/bin/plutil", "-lint", path], capture_output=True)
            self.assertEqual(lint.returncode, 0, output_of(lint))
        with open(path, "rb") as handle:
            data = plistlib.load(handle)
        self.assertEqual(data["Label"], "com.livejjim.transcriber")
        self.assertIs(data["RunAtLoad"], True)
        self.assertIs(data["KeepAlive"], True)
        self.assertGreaterEqual(data["ThrottleInterval"], 10)
        self.assertEqual(data["ProgramArguments"], ["/bin/bash", os.path.join(self.box.home, "app", "macmini", "run.sh")])
        self.assertEqual(data["EnvironmentVariables"]["LIVEJJIM_TRANSCRIBER_HOME"], self.box.home)
        self.assertEqual(mode(path), 0o644)
        with open(path, encoding="utf-8") as handle:
            self.assertNotIn("TOKEN", handle.read().upper().replace("TOKEN_FILE", ""))


class ConfigureTest(unittest.TestCase):
    def setUp(self):
        self.box = Sandbox()

    def tearDown(self):
        self.box.close()

    def token_path(self):
        return os.path.join(self.box.home, "worker-token")

    def conf_path(self):
        return os.path.join(self.box.home, "worker.conf")

    def test_writes_private_files_and_never_prints_token(self):
        result = self.box.run("configure.sh", "http://localhost:7700/\n2\n" + TOKEN + "\n")
        text = output_of(result)
        self.assertEqual(result.returncode, 0, text)
        self.assertNotIn(TOKEN, text)
        self.assertNotIn(TOKEN[:12], text)
        with open(self.token_path(), encoding="utf-8") as handle:
            self.assertEqual(handle.read(), TOKEN)
        self.assertEqual(mode(self.token_path()), 0o600)
        self.assertEqual(mode(self.conf_path()), 0o600)
        self.assertEqual(mode(self.box.home), 0o700)
        with open(self.conf_path(), encoding="utf-8") as handle:
            conf = handle.read()
        self.assertNotIn(TOKEN, conf)
        self.assertIn("SERVER=http://localhost:7700\n", conf)
        self.assertIn("MODEL=whisper\n", conf)
        self.assertIn("MAX_STREAMS=4\n", conf)
        self.assertEqual(sorted(os.listdir(self.box.home)), ["worker-token", "worker.conf"])

    def test_rerun_with_empty_answers_keeps_existing_settings_and_token(self):
        first = self.box.run("configure.sh", "https://live.example.com\n1\n" + TOKEN + "\n")
        self.assertEqual(first.returncode, 0, output_of(first))
        again = self.box.run("configure.sh", "\n\n\n")
        text = output_of(again)
        self.assertEqual(again.returncode, 0, text)
        self.assertNotIn(TOKEN, text)
        with open(self.token_path(), encoding="utf-8") as handle:
            self.assertEqual(handle.read(), TOKEN)
        with open(self.conf_path(), encoding="utf-8") as handle:
            conf = handle.read()
        self.assertIn("SERVER=https://live.example.com\n", conf)
        self.assertIn("MODEL=cohere\n", conf)

    def test_bad_token_is_refused_without_echo(self):
        bad = "has space " + TOKEN
        result = self.box.run("configure.sh", "https://live.example.com\n1\n" + bad + "\n")
        text = output_of(result)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(TOKEN, text)
        self.assertFalse(os.path.exists(self.token_path()))
        self.assertIn("쓸 수 없는 글자", text)

    def test_bad_server_is_refused(self):
        result = self.box.run("configure.sh", "ftp://x?token=" + TOKEN + "\n1\n" + TOKEN + "\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(os.path.exists(self.token_path()))

    def test_token_from_file(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "voice-worker-7700.token")
            with open(source, "w", encoding="utf-8") as handle:
                handle.write(TOKEN + "\n")
            result = self.box.run("configure.sh", "http://127.0.0.1:7700\n\n", args=("--token-from", source))
            text = output_of(result)
            self.assertEqual(result.returncode, 0, text)
            self.assertNotIn(TOKEN, text)
            with open(self.token_path(), encoding="utf-8") as handle:
                self.assertEqual(handle.read(), TOKEN)
            self.assertEqual(mode(self.token_path()), 0o600)

    def test_no_way_to_pass_token_on_command_line(self):
        result = self.box.run("configure.sh", "", args=("--token", TOKEN))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(TOKEN, output_of(result))


class RunTest(unittest.TestCase):
    """run.sh: 가짜 파이썬으로 일꾼에 넘기는 명령줄을 본다(토큰 값이 아니라 토큰 파일 경로)"""

    def setUp(self):
        self.box = Sandbox()
        configured = self.box.run("configure.sh", "https://live.example.com\n1\n" + TOKEN + "\n")
        self.assertEqual(configured.returncode, 0, output_of(configured))
        app = os.path.join(self.box.home, "app")
        os.makedirs(os.path.join(app, "macmini"))
        for name in SCRIPTS:
            shutil.copy(os.path.join(MACMINI, name), os.path.join(app, "macmini", name))
        shutil.copy(os.path.join(ROOT, "requirements.txt"), os.path.join(app, "requirements.txt"))
        with open(os.path.join(ROOT, "requirements.txt"), "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()[:12]
        venv_bin = os.path.join(self.box.home, "venv-" + digest, "bin")
        os.makedirs(venv_bin)
        self.args_out = os.path.join(os.path.dirname(self.box.agents), "args.txt")
        fake = os.path.join(venv_bin, "python")
        with open(fake, "w", encoding="utf-8") as handle:
            handle.write('#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_OUT"\necho "2026-10-30 21:00:00 라이브지니 서버에 붙었어요."\n')
        os.chmod(fake, 0o755)
        self.app = app

    def tearDown(self):
        self.box.close()

    def test_worker_gets_token_file_not_token_and_logs_go_to_file(self):
        result = self.box.run("run.sh", folder=os.path.join(self.app, "macmini"), extra_env={"ARGS_OUT": self.args_out})
        self.assertEqual(result.returncode, 0, output_of(result))
        self.assertEqual(output_of(result), "")
        with open(self.args_out, encoding="utf-8") as handle:
            args = handle.read().split("\n")
        self.assertIn("--token-file", args)
        self.assertEqual(args[args.index("--token-file") + 1], os.path.join(self.box.home, "worker-token"))
        self.assertEqual(args[args.index("--server") + 1], "https://live.example.com")
        self.assertEqual(args[args.index("--model") + 1], "cohere")
        self.assertEqual(args[:3], ["-B", "-m", "livegenie_transcriber"])
        self.assertNotIn(TOKEN, "\n".join(args))
        with open(self.box.log, encoding="utf-8") as handle:
            log = handle.read()
        self.assertIn("일꾼을 켜요", log)
        self.assertIn("서버에 붙었어요", log)
        self.assertNotIn(TOKEN, log)

    def test_big_log_is_rotated(self):
        os.makedirs(os.path.dirname(self.box.log))
        with open(self.box.log, "wb") as handle:
            handle.write(b"x" * (5 * 1024 * 1024 + 10))
        result = self.box.run("run.sh", folder=os.path.join(self.app, "macmini"), extra_env={"ARGS_OUT": self.args_out})
        self.assertEqual(result.returncode, 0, output_of(result))
        self.assertTrue(os.path.exists(self.box.log + ".1"))
        self.assertLess(os.path.getsize(self.box.log), 4096)

    def test_missing_config_stops_with_plain_sentence(self):
        os.remove(os.path.join(self.box.home, "worker.conf"))
        result = self.box.run("run.sh", folder=os.path.join(self.app, "macmini"), extra_env={"ARGS_OUT": self.args_out})
        self.assertEqual(result.returncode, 2)
        self.assertFalse(os.path.exists(self.args_out))
        with open(self.box.log, encoding="utf-8") as handle:
            self.assertIn("설정 파일이 없어요", handle.read())


class StatusTest(unittest.TestCase):
    def setUp(self):
        self.box = Sandbox()
        configured = self.box.run("configure.sh", "https://live.example.com\n1\n" + TOKEN + "\n")
        self.assertEqual(configured.returncode, 0, output_of(configured))
        os.makedirs(os.path.dirname(self.box.log))

    def tearDown(self):
        self.box.close()

    def write_log(self, lines):
        with open(self.box.log, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")

    def test_connected_with_p95_and_last_connected(self):
        self.write_log([
            "2026-10-30 20:00:00 일꾼을 켜요 (모델 cohere, 흐름 한도 4).",
            "2026-10-30 20:00:01 VAD를 불러와요. 흐름 한도 4개",
            "2026-10-30 20:01:10 라이브지니 서버에 붙었어요.",
            "2026-10-30 20:06:10 지금 흐름 1개 · 연 흐름 2개(한도로 거절 0) · 조각 30개 · 결과 28개 · 버린 조각 0개 · 처리 시간 중앙 260ms · 95% 530ms",
        ])
        result = self.box.run("status.sh")
        text = output_of(result)
        self.assertEqual(result.returncode, 0, text)
        self.assertIn("서버 연결: 붙어 있어요 (2026-10-30 20:01:10부터)", text)
        self.assertIn("마지막으로 서버에 붙은 때: 2026-10-30 20:01:10", text)
        self.assertIn("530ms", text)
        self.assertIn("꺼져 있어요", text)  # 가짜 launchctl은 등록된 것이 없다고 답한다
        self.assertIn("나만 읽을 수 있음", text)
        self.assertNotIn(TOKEN, text)

    def test_unreachable_after_connection_keeps_last_connected(self):
        self.write_log([
            "2026-10-30 20:01:10 라이브지니 서버에 붙었어요.",
            "2026-10-30 21:00:00 라이브지니 서버 연결이 끊겼어요.",
            "2026-10-30 21:00:00 1초 뒤 다시 붙어요.",
            "2026-10-30 21:00:01 라이브지니 서버에 닿지 않아요.",
        ])
        text = output_of(self.box.run("status.sh"))
        self.assertIn("서버에 닿지 않아요 (2026-10-30 21:00:01)", text)
        self.assertIn("마지막으로 서버에 붙은 때: 2026-10-30 20:01:10", text)
        self.assertIn("아직 기록이 없어요", text)

    def test_token_rejected_is_explained(self):
        self.write_log(["2026-10-30 21:00:01 라이브지니 서버가 일꾼 토큰을 받지 않았어요(401). 토큰 파일이 서버 설정과 같은지 확인해 주세요."])
        text = output_of(self.box.run("status.sh"))
        self.assertIn("configure.sh로 서버와 같은 토큰", text)
        self.assertIn("마지막으로 서버에 붙은 때: 아직 없어요", text)

    def test_loose_token_permission_is_warned(self):
        os.chmod(os.path.join(self.box.home, "worker-token"), 0o644)
        text = output_of(self.box.run("status.sh"))
        self.assertIn("다른 사람도 읽을 수 있어요", text)

    def test_running_agent_is_reported(self):
        fake = os.path.join(os.path.dirname(self.box.agents), "launchctl")
        with open(fake, "w", encoding="utf-8") as handle:
            handle.write('#!/bin/sh\necho "gui/501/com.livejjim.transcriber = {"\necho "\tstate = running"\necho "\tpid = 4242"\n')
        os.chmod(fake, 0o755)
        self.write_log(["2026-10-30 20:01:10 라이브지니 서버에 붙었어요."])
        text = output_of(self.box.run("status.sh", extra_env={"LIVEJJIM_LAUNCHCTL": fake}))
        self.assertIn("일꾼 프로그램: 켜져 있어요", text)


if __name__ == "__main__":
    unittest.main()
