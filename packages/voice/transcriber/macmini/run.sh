#!/bin/bash
# launchd가 부르는 실행 스크립트. 직접 부르지 않는다(켜기는 start.sh).
# - 설정 파일(정해진 이름만)을 읽고 일꾼을 켠다. 토큰은 파일 경로로만 넘긴다(명령줄에 값 없음).
# - 일꾼이 도는 동안만 caffeinate -i로 맥이 저절로 잠들지 않게 한다(시스템 전원 설정은 그대로).
# - 로그는 일꾼이 찍는 셈·연결 상태뿐이다. 5MB가 넘으면 한 벌만 남긴다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

mkdir -p "$(dirname "$LOG_FILE")"
rotate_log
exec >>"$LOG_FILE" 2>&1

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

if ! load_conf; then
  say "$(stamp) 설정 파일이 없어요. install.sh를 다시 실행해 주세요."
  exit 2
fi
if [ ! -f "$TOKEN_FILE" ]; then
  say "$(stamp) 일꾼 토큰 파일이 없어요. configure.sh로 다시 넣어 주세요."
  exit 2
fi
VENV="$(current_venv)" || { say "$(stamp) 받아쓰기 코드가 없어요. install.sh를 다시 실행해 주세요."; exit 2; }
if [ ! -x "$VENV/bin/python" ]; then
  say "$(stamp) 파이썬 환경이 없어요. update.sh 또는 install.sh를 다시 실행해 주세요."
  exit 2
fi

cd "$APP_CODE" || exit 2
export PYTHONDONTWRITEBYTECODE=1 PYTHONIOENCODING=utf-8 HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_PROGRESS_BARS=1
unset HF_TOKEN HUGGING_FACE_HUB_TOKEN LIVEJJIM_TRANSCRIBE_WORKER_TOKEN

say "$(stamp) 일꾼을 켜요 (모델 $MODEL, 흐름 한도 $MAX_STREAMS)."
# 이 셸의 번호($$)는 exec 뒤 파이썬 일꾼의 번호가 된다. 일꾼이 끝나면 caffeinate도 끝난다.
/usr/bin/caffeinate -i -w $$ &
exec "$VENV/bin/python" -B -m livegenie_transcriber \
  --server "$SERVER" \
  --token-file "$TOKEN_FILE" \
  --model "$MODEL" \
  --max-streams "$MAX_STREAMS" \
  --device "$DEVICE"
