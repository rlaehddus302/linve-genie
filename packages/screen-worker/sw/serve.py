# 화면 일꾼 관리자: 라이브지니 서버에 "지금 이어진 방송의 유튜브 영상"을 30초마다 묻고, 영상마다 실시간 일꾼을 띄운다.
# 사용:
#   python -m sw.serve --server https://livegenie.kr --token-file ~/.lg_screen_token [--out-root runs/live]
#  - 새 영상 → `python -m sw <주소> --post <서버> --token-file <파일> --live-only --out <out-root>/<영상>-<시각>`
#  - 목록에서 빠진 영상 → 그 일꾼을 멈춤(SIGTERM, 20초 뒤에도 살아 있으면 SIGKILL; ffmpeg·글자 읽기 프로세스까지 한 묶음으로)
#  - 목록에 있는데 일꾼이 끝남 → 60초 뒤 다시 띄움. 단 "영상이 끝남"(종료 코드 0)은 라이브 영상이 잠깐 끊긴 것이라 3초 뒤 바로
#    (2026-11-12: 60초 기다리는 사이 397번 오색글래머 4만원을 통째로 못 들었다)
#  - 동시에 최대 2개(--max). 넘으면 기다리게 하고 기록
#  - 서버에 묻기가 실패하면(네트워크·5xx·아직 없는 입구 404) 지금 도는 일꾼은 그대로 둔다
#  - 판(D-RETRO-33): 관리자는 켜질 때의 폴더와 파이썬에 일꾼을 묶는다. 내보내기가 판 폴더 링크(~/lg/screen-worker/current)를
#    새 판으로 바꿔도, 관리자를 다시 켜기 전에는 일꾼이 옛 판의 코드·지시문(sw/prompts)·파이썬 묶음으로만 뜬다 — 반쪽만 새 판이 되지 않는다.
#    다시 켜는 것은 내보내기가 방송이 없을 때만 한다(scripts/deploy/mini-worker-update.sh). 지금 판은 시작 기록과 일꾼 시작 기록에 남긴다.
# 표준 라이브러리만 쓴다(무거운 모델은 일꾼 프로세스에서만 뜬다). 토큰은 어디에도 찍지 않는다.
import argparse
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime

from . import post
from . import tiktok
from .post import KST, VIDEO_RE, log

POLL = 30          # 서버에 묻는 간격(초)
STOP_GRACE = 20    # SIGTERM 뒤 이만큼 기다렸다가 SIGKILL
RESTART_WAIT = 60  # 끝난 일꾼을 다시 띄우기 전 기다림
REOPEN_WAIT = 3    # 목록에 있는 라이브가 "끝남"으로 끊겼을 때 다시 띄우기 전 기다림
# packages/screen-worker/ 또는 판 폴더(python -m sw 가 도는 곳). 링크를 풀어 둔다 — current 링크가 바뀌어도 이 관리자는 켜질 때의 판에 머문다
HERE = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def pin_python(exe, here):
    """일꾼을 띄울 파이썬. 관리자가 `<판 폴더 링크>/.venv/bin/python`으로 켜졌으면 같은 파일을 링크를 푼 폴더(here) 아래 경로로 바꾼다.
    그러지 않으면 링크가 새 판으로 바뀐 뒤 뜨는 일꾼이 새 판의 파이썬 묶음 + 옛 판의 코드로 돈다. 그 밖의 파이썬은 그대로."""
    bin_dir = os.path.dirname(exe)
    venv = os.path.dirname(bin_dir)
    if os.path.basename(bin_dir) != "bin" or os.path.basename(venv) != ".venv":
        return exe
    if os.path.realpath(os.path.dirname(venv)) != here:
        return exe
    return os.path.join(here, ".venv", "bin", os.path.basename(exe))


def release_id(here):
    """지금 도는 판(커밋 앞 12자). 판 폴더면 내보내기가 적어 둔 RELEASE 파일, 저장소를 그대로 돌리면 그 저장소의 HEAD. 모르면 None"""
    try:
        with open(os.path.join(here, "RELEASE"), encoding="utf-8") as f:
            rel = f.read().strip()
    except OSError:
        try:
            rel = subprocess.run(["git", "-C", here, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5,
                                 stdin=subprocess.DEVNULL).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            rel = ""
    return rel[:12] if len(rel) >= 7 and all(c in "0123456789abcdef" for c in rel) else None


class Job:
    def __init__(self, vid, proc, out):
        self.vid, self.proc, self.out = vid, proc, out
        self.stop_at = None          # SIGTERM 보낸 시각


class Serve:
    def __init__(self, a):
        self.a = a
        self.server = a.server.rstrip("/")
        self.jobs = {}               # 영상 → Job(돌고 있거나 멈추는 중)
        self.retry_at = {}           # 영상 → 다시 띄울 수 있는 시각
        self.waiting = set()         # 동시 개수 제한으로 기다리는 영상(기록 한 번만)
        self.listed = []             # 마지막으로 받은 목록
        self.last_poll_ok = None
        self.quit = False

    # ---------- 서버 ----------
    def fetch(self):
        """→ 영상 번호 목록, 실패면 None"""
        try:
            token = post.read_token(self.a.token_file)
        except (OSError, ValueError) as e:
            log(f"토큰 파일을 못 읽음({type(e).__name__}) — 지금 일꾼은 그대로")
            return None
        status, res = post.http_json("GET", self.server + "/internal/screen/live", token)
        ok = status == 200 and isinstance(res, dict) and isinstance(res.get("videos"), list)
        if not ok:
            why = res if status is None else (f"HTTP {status}" + (" — 서버에 아직 이 입구가 없거나 꺼져 있음" if status == 404 else ""))
            if self.last_poll_ok is not False:
                log(f"서버에 방송 목록 묻기 실패({why}) — 지금 일꾼은 그대로 두고 {self.a.interval}초마다 다시 물음")
            self.last_poll_ok = False
            return None
        if self.last_poll_ok is False:
            log("서버에 방송 목록 묻기 다시 됨")
        self.last_poll_ok = True
        out = []
        for v in res["videos"]:
            vid = v.get("videoId") if isinstance(v, dict) else None
            if isinstance(vid, str) and VIDEO_RE.match(vid) and vid not in out:
                out.append(vid)
        return out

    # ---------- 일꾼 ----------
    def command(self, vid, out):
        url = tiktok.url_of(vid) if vid.startswith("@") else f"https://www.youtube.com/watch?v={vid}"   # 틱톡은 `@아이디`(D-SCR-TT-01)
        if self.a.worker_cmd:   # 시험용: {url} {video_id} {out} 자리 채우기
            return [p.format(url=url, video_id=vid, out=out) for p in shlex.split(self.a.worker_cmd)]
        cmd = [pin_python(sys.executable, HERE), "-m", "sw", url, "--post", self.server, "--token-file", self.a.token_file, "--live-only", "--out", out]
        return cmd + list(self.a.worker_args or [])

    def start(self, vid):
        out = os.path.join(self.a.out_root, f"{vid}-{datetime.now(KST).strftime('%Y%m%d_%H%M%S')}")
        os.makedirs(out, exist_ok=True)
        cmd = self.command(vid, out)
        # 새 세션: 멈출 때 ffmpeg·글자 읽기·LLM 프로세스까지 한 묶음으로 신호를 보낸다
        proc = subprocess.Popen(cmd, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                start_new_session=True, env=dict(os.environ, PYTHONUNBUFFERED="1"))
        self.jobs[vid] = Job(vid, proc, out)
        self.waiting.discard(vid)
        threading.Thread(target=self.pipe, args=(vid, proc, out), daemon=True).start()
        # 저장소를 그대로 돌릴 때는 누가 git pull을 하면 관리자와 일꾼의 판이 달라진다 — 일꾼마다 그때의 판을 남겨 뒤에 가릴 수 있게
        log(f"[{vid}] 일꾼 시작 (pid {proc.pid}, 판 {release_id(HERE) or '모름'}) → {out}")

    def pipe(self, vid, proc, out):
        """일꾼 출력을 <out>/worker.log에 남기고 화면에도 영상 번호를 붙여 보여 준다"""
        with open(os.path.join(out, "worker.log"), "ab") as f:
            for line in iter(proc.stdout.readline, b""):
                f.write(line)
                f.flush()
                print(f"[{vid}] {line.decode('utf-8', 'replace').rstrip()}", flush=True)

    def signal_group(self, job, sig):
        try:
            os.killpg(job.proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass

    def stop(self, vid, why):
        job = self.jobs.get(vid)
        if job is None or job.stop_at is not None:
            return
        log(f"[{vid}] 일꾼 멈춤 ({why})")
        job.stop_at = time.time()
        self.signal_group(job, signal.SIGTERM)

    def reap(self):
        """끝난 일꾼 정리, 멈추라 했는데 안 끝난 일꾼은 SIGKILL"""
        now = time.time()
        for vid, job in list(self.jobs.items()):
            rc = job.proc.poll()
            if rc is None:
                if job.stop_at is not None and now - job.stop_at >= STOP_GRACE:
                    log(f"[{vid}] {STOP_GRACE}초 지나도 안 끝나서 강제로 멈춤")
                    self.signal_group(job, signal.SIGKILL)
                    job.stop_at = now + 3600   # 다시 SIGKILL을 연달아 보내지 않게
                continue
            # 묶음에 남은 프로세스(ffmpeg 등)도 정리
            self.signal_group(job, signal.SIGKILL)
            del self.jobs[vid]
            if job.stop_at is not None:
                log(f"[{vid}] 일꾼 끝남 (멈춤 요청, 종료 코드 {rc})")
            else:
                what = {0: "영상이 끝남", 2: "영상을 열지 못함", 3: "라이브가 아님"}.get(rc, "오류")
                wait = REOPEN_WAIT if rc == 0 else RESTART_WAIT
                log(f"[{vid}] 일꾼이 스스로 끝남 (종료 코드 {rc}, {what}) — 아직 목록에 있으면 {wait}초 뒤 다시")
                self.retry_at[vid] = now + wait

    def sync(self):
        """마지막 목록에 맞춰 일꾼을 띄우거나 멈춘다"""
        now = time.time()
        for vid in list(self.jobs):
            if vid not in self.listed:
                self.stop(vid, "방송 목록에서 빠짐")
        for vid in list(self.retry_at):
            if vid not in self.listed:
                del self.retry_at[vid]
        self.waiting &= set(self.listed)
        for vid in self.listed:
            if vid in self.jobs or self.retry_at.get(vid, 0) > now:
                continue
            if len(self.jobs) >= self.a.max:
                if vid not in self.waiting:
                    log(f"[{vid}] 동시 일꾼 {self.a.max}개가 다 차서 기다림 (도는 중: {', '.join(self.jobs)})")
                    self.waiting.add(vid)
                continue
            self.retry_at.pop(vid, None)
            self.start(vid)

    def shutdown(self):
        for vid in list(self.jobs):
            self.stop(vid, "관리자 끝냄")
        end = time.time() + STOP_GRACE
        while self.jobs and time.time() < end:
            self.reap()
            time.sleep(0.2)
        for job in list(self.jobs.values()):
            self.signal_group(job, signal.SIGKILL)
        self.reap()

    def run(self):
        def bye(*_):
            self.quit = True
        signal.signal(signal.SIGTERM, bye)
        signal.signal(signal.SIGINT, bye)
        log(f"화면 일꾼 관리자 시작 — 판 {release_id(HERE) or '모름'} ({HERE}), 서버 {self.server}, {self.a.interval}초마다 방송 목록 확인, 동시 최대 {self.a.max}개, 결과 {self.a.out_root}")
        next_poll = 0.0
        try:
            while not self.quit:
                if time.time() >= next_poll:
                    got = self.fetch()
                    if got is not None:
                        if got != self.listed:
                            log(f"방송 목록: {', '.join(got) or '없음'}")
                        self.listed = got
                    next_poll = time.time() + self.a.interval
                self.reap()
                self.sync()
                time.sleep(0.5)
        finally:
            self.shutdown()
            log("관리자 끝")


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.serve", description="라이브지니에 이어진 라이브마다 화면 일꾼을 띄우고 멈춘다")
    ap.add_argument("--server", required=True, help="라이브지니 서버 (예: https://livegenie.kr)")
    ap.add_argument("--token-file", help="일꾼 토큰 파일 (없으면 환경변수 LG_SCREEN_TOKEN_FILE)")
    ap.add_argument("--out-root", default=os.path.join("runs", "live"), help="일꾼 결과를 둘 곳 (기본 runs/live)")
    ap.add_argument("--max", type=int, default=2, help="동시에 돌릴 일꾼 수 (기본 2)")
    ap.add_argument("--interval", type=float, default=POLL, help=argparse.SUPPRESS)
    ap.add_argument("--worker-cmd", help=argparse.SUPPRESS)                    # 시험용: 일꾼 대신 띄울 명령
    ap.add_argument("--worker-arg", dest="worker_args", action="append", help="일꾼에 더 넘길 인자 (예: --worker-arg=--no-llm)")
    a = ap.parse_args()
    a.token_file = os.path.abspath(post.token_path(a.token_file))
    a.out_root = os.path.abspath(a.out_root)
    os.makedirs(a.out_root, exist_ok=True)
    Serve(a).run()


if __name__ == "__main__":
    main()
