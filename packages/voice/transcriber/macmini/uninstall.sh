#!/bin/bash
# 일꾼 지우기: 자동 켜기를 끄고 설치 폴더(코드·파이썬 환경·설정·토큰)를 지운다.
# 내려받은 모델(허깅페이스 캐시, 수 GB)은 물어보고 지운다. 설치 묶음(내려받은 폴더)은 건드리지 않는다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

# 아래 전체를 한 덩어리로 먼저 읽는다 — 이 파일이 든 설치 폴더를 지우는 중에도 끝까지 돈다
{
say "받아쓰기 일꾼을 이 맥에서 지워요. 설정·토큰도 함께 지워져요."
printf '계속할까요? (y/N): '
IFS= read -r answer || answer=""
case "$answer" in y | Y | yes | 예 | ㅇ) ;; *) say "지우지 않았어요."; exit 0 ;; esac

if agent_loaded; then
  "$LAUNCHCTL" bootout "$(gui_domain)/$LABEL" 2>/dev/null || true
fi
rm -f "$PLIST_FILE"
# 토큰 파일은 덮어쓴 뒤 지운다
if [ -f "$TOKEN_FILE" ]; then
  : >"$TOKEN_FILE"
  rm -f "$TOKEN_FILE"
fi
case "$APP_DIR" in
  */LiveJjim/transcriber | "${LIVEJJIM_TRANSCRIBER_HOME:-/nonexistent}") rm -rf "$APP_DIR" ;;
  *) die "설치 폴더 위치가 예상과 달라 지우지 않았어요: $APP_DIR" ;;
esac
rmdir "$(dirname "$APP_DIR")" 2>/dev/null || true
rm -f "$LOG_FILE" "$LOG_FILE.1"
say "일꾼과 설정을 지웠어요."

HF_CACHE="${HF_HOME:-$HOME/.cache/huggingface}/hub"
models=""
for repo in "$COHERE_REPO" "$WHISPER_REPO"; do
  folder="$HF_CACHE/models--$(printf '%s' "$repo" | sed 's#/#--#g')"
  [ -d "$folder" ] && models="$models $folder"
done
if [ -n "$models" ]; then
  printf '내려받은 받아쓰기 모델(수 GB)도 지울까요? (y/N): '
  IFS= read -r answer || answer=""
  case "$answer" in
    y | Y | yes | 예 | ㅇ)
      for folder in $models; do rm -rf "$folder"; done
      say "모델도 지웠어요."
      ;;
    *) say "모델은 남겨 뒀어요(다시 설치할 때 바로 써요)." ;;
  esac
fi
say "설치 묶음 폴더는 그대로 있어요. 필요 없으면 직접 휴지통에 넣으세요."
exit 0
}
