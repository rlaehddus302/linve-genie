# 운영 맥 준비 점검(2026-11-12): 일꾼을 띄우기 전에 한 번 돌려 빠진 것을 찾는다. 아무것도 서버에 등록하지 않는다.
# 사용: .venv/bin/python -m sw.doctor [--server https://livegenie.kr] [--token-file ~/.lg_screen_token]
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

from . import llm_live

OK, BAD = "  ✓", "  ✗"


def check(name, fn):
    try:
        msg = fn()
        print(f"{OK} {name}{(' — ' + msg) if msg else ''}", flush=True)
        return True
    except Exception as e:   # 점검 하나가 실패해도 나머지는 계속
        print(f"{BAD} {name} — {str(e)[:300]}", flush=True)
        return False


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.doctor")
    ap.add_argument("--server", help="라이브지니 서버 주소(있으면 /health 확인)")
    ap.add_argument("--token-file", help="일꾼 토큰 파일(있으면 읽히는지 확인 — 내용은 찍지 않음)")
    a = ap.parse_args()
    bindir = os.path.dirname(sys.executable)

    def ffmpeg():
        if not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg 없음: brew install ffmpeg")

    def ytdlp():
        p = os.path.join(bindir, "yt-dlp")
        if not os.path.exists(p):
            raise RuntimeError("가상환경에 yt-dlp 없음: requirements.lock.txt 설치")
        return subprocess.run([p, "--version"], capture_output=True, text=True).stdout.strip()

    def whisper():
        import mlx_whisper   # noqa: F401 — 애플 칩 맥 전용
        from huggingface_hub import snapshot_download
        from . import audio
        snapshot_download(audio.MODEL)   # 처음이면 내려받음(약 1.6GB)
        return audio.MODEL

    def vision():
        from .screen import ocr_frame
        with tempfile.NamedTemporaryFile(suffix=".jpg") as f:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=320x240", "-frames:v", "1", f.name], check=True)
            ocr_frame(f.name)
        return "Apple Vision 글자 읽기"

    def claude():
        from . import llm_b6
        if not os.path.exists(llm_b6.CLAUDE_BIN):
            raise RuntimeError(f"claude 없음({llm_b6.CLAUDE_BIN}): curl -fsSL https://claude.ai/install.sh | bash")
        how = f"표 파일 {llm_b6.TOKEN_FILE}" if "CLAUDE_CODE_OAUTH_TOKEN" in llm_b6.claude_env() else "claude 로그인(키체인)"
        return f"{llm_b6.CLAUDE_BIN} · {how}"

    def codex():
        if not shutil.which("codex"):
            raise RuntimeError("codex 없음: npm i -g @openai/codex (또는 brew install codex)")
        r = subprocess.run(["codex", "login", "status"], capture_output=True, text=True)
        if r.returncode != 0 or "Logged in" not in (r.stdout + r.stderr):
            raise RuntimeError("codex 로그인 안 됨: codex login")
        return (r.stdout + r.stderr).strip().splitlines()[0]

    def sol():
        from . import llm_b6
        # 라이브 등록과 같은 길로 묻는다(D-SCR-16: codex의 군더더기 빼는 옵션·답 모양 고정이 이 판에서 되는지도 여기서 드러난다)
        out = llm_live.ask_llm("L0 [0:00:01] (화면: 7 크게 3초) 자 7번 청개구리 3만원에 드릴게요")
        rows = llm_b6.rows_of(out, [(0, 1.0, "")])
        if not rows or rows[0]["no"] != 7:
            raise RuntimeError(f"답이 이상함: {out[:200]}")
        r = rows[0]
        off = "·".join(sorted(llm_b6._UNSUPPORTED))
        return f"{llm_live.BACKEND} {llm_live.MODEL} {llm_live.EFFORT} 답: {r['no']}번 {r['price']}원 {r['variety']}" + (f" (codex가 {off} 옵션을 받지 않아 옵션 없이 물음)" if off else "")

    def token():
        from . import post
        post.read_token(os.path.expanduser(a.token_file))
        return "읽힘(내용은 안 찍음)"

    def server():
        with urllib.request.urlopen(a.server.rstrip("/") + "/health", timeout=10) as r:
            return f"HTTP {r.status}"

    rs = [check("ffmpeg", ffmpeg), check("yt-dlp", ytdlp), check("받아쓰기 모델", whisper), check("화면 글자 읽기", vision),
          (check("Claude 구독", claude) if llm_live.BACKEND == "claude" else check("codex 로그인", codex)), check("LLM 등록(지식판2) 시험 질문", sol)]
    if a.token_file:
        rs.append(check("토큰 파일", token))
    if a.server:
        rs.append(check("서버", server))
    print("\n준비 끝 — 일꾼을 띄워도 돼요" if all(rs) else "\n✗ 표시를 먼저 고쳐 주세요", flush=True)
    sys.exit(0 if all(rs) else 1)


if __name__ == "__main__":
    main()
