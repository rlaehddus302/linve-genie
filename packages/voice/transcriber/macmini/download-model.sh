#!/bin/bash
# 설정한 받아쓰기 모델을 미리 내려받는다(방송 중에 받느라 늦지 않게). install.sh가 부르고, 모델을 바꾼 뒤 다시 불러도 된다.
# Cohere는 허깅페이스에서 모델 동의가 필요해 읽기 토큰을 한 번 묻는다.
# 그 토큰은 내려받는 동안만 메모리에 두고 파일·로그·화면에 남기지 않는다(hf auth login을 쓰지 않는다).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

load_conf || die "설정이 아직 없어요. 먼저 configure.sh를 실행해 주세요."
VENV="$(current_venv)" || die "받아쓰기 코드가 설치되지 않았어요. install.sh를 먼저 실행해 주세요."
PY="$VENV/bin/python"
[ -x "$PY" ] || die "파이썬 환경이 없어요. install.sh를 다시 실행해 주세요."
REPO="$(model_repo "$MODEL")"

if model_cached "$PY" "$REPO"; then
  say "모델이 이미 내려받아져 있어요: $REPO"
  exit 0
fi

say ""
say "모델을 내려받아요: $REPO (수 GB, 인터넷 속도에 따라 10~30분)"
hf_token=""
if [ "$MODEL" = "cohere" ]; then
  cat <<'EOF'
Cohere 모델은 허깅페이스에서 먼저 동의해야 받을 수 있어요.
  1) 인터넷 창에서 https://huggingface.co/CohereLabs/cohere-transcribe-03-2026 을 열고 로그인
  2) 모델 페이지의 동의 단추를 눌러 승인받기
  3) https://huggingface.co/settings/tokens 에서 "Read" 토큰을 하나 만들어 복사
토큰은 이번 내려받기에만 쓰고 저장하지 않아요. 다 받은 뒤 허깅페이스에서 그 토큰을 지워도 돼요.
EOF
  printf '허깅페이스 읽기 토큰을 붙여 넣고 Enter (화면에 보이지 않아요): '
  IFS= read -rs hf_token || hf_token=""
  printf '\n'
  hf_token="$(printf '%s' "$hf_token" | tr -d '\r\n')"
  if [ -z "$hf_token" ]; then
    die "토큰이 비어 있어 내려받지 않았어요. 준비되면 download-model.sh를 다시 실행해 주세요."
  fi
fi

# 토큰은 이 한 프로세스의 환경변수로만 넘긴다(명령줄·파일에 없음). 오류 글은 종류만 보여 준다.
HF_TOKEN="$hf_token" HF_HUB_DISABLE_TELEMETRY=1 "$PY" -B -c '
import os, sys
from huggingface_hub import snapshot_download
token = os.environ.pop("HF_TOKEN", "") or None
try:
    snapshot_download(sys.argv[1], token=token)
except Exception as error:
    name = type(error).__name__
    if "Gated" in name or "Authorization" in name or "401" in str(getattr(error, "response", "")) or "403" in str(getattr(error, "response", "")):
        print("허깅페이스가 내려받기를 막았어요. 모델 페이지에서 동의했는지, 읽기 토큰이 맞는지 확인해 주세요.", file=sys.stderr)
    else:
        print("모델을 내려받지 못했어요 (" + name + "). 인터넷 연결을 확인하고 다시 실행해 주세요.", file=sys.stderr)
    sys.exit(1)
' "$REPO"
status=$?
hf_token=""
unset hf_token
[ $status -eq 0 ] || exit 1

if model_cached "$PY" "$REPO"; then
  say "모델을 다 받았어요. 이제 인터넷 동의 확인 없이 이 파일을 써요."
else
  die "모델을 받았는데 확인이 안 돼요. download-model.sh를 다시 실행해 주세요."
fi
