#!/bin/bash
# 서버 주소·일꾼 토큰·모델을 묻고 설정 파일을 만든다(권한 600). install.sh가 부르고, 따로 다시 불러도 된다.
#   bash configure.sh                       묻고 답하기
#   bash configure.sh --token-from <파일>   토큰을 붙여 넣는 대신 파일에서 가져오기(연습 서버가 만든 토큰 파일 등)
# 토큰은 화면에 보이지 않게 받고, 어디에도 찍지 않는다. 명령줄에 토큰을 적는 방법은 일부러 없다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

TOKEN_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --token-from)
      [ $# -ge 2 ] || die "--token-from 뒤에 토큰 파일 위치를 적어 주세요."
      TOKEN_FROM="$2"
      shift 2
      ;;
    *) die "모르는 설정이 있어요. 쓸 수 있는 것: --token-from <파일>" ;;
  esac
done

umask 077
mkdir -p "$APP_DIR"
chmod 700 "$APP_DIR"

load_conf || true
OLD_SERVER="$SERVER"

say ""
say "== 받아쓰기 일꾼 설정 =="
say "라이브지니 서버 주소를 적어 주세요. 예: https://livejjim.example.com"
say "(연습 서버는 http://localhost:7700, 다른 컴퓨터의 연습 서버는 http://그-컴퓨터-주소:7700)"
while :; do
  if [ -n "$OLD_SERVER" ]; then
    printf '서버 주소 [그대로 두려면 Enter: %s]: ' "$OLD_SERVER"
  else
    printf '서버 주소: '
  fi
  IFS= read -r answer || answer=""
  answer="$(printf '%s' "$answer" | tr -d '[:space:]')"
  [ -z "$answer" ] && answer="$OLD_SERVER"
  if [ -z "$answer" ]; then
    say "주소가 비어 있어요."
  elif valid_server "$answer"; then
    SERVER="${answer%/}"
    break
  else
    say "주소는 http:// 또는 https://로 시작하고, ? # @ 빈칸 없이 적어 주세요."
  fi
  # 입력이 끝났으면(파이프) 더 묻지 않는다
  [ -t 0 ] || die "서버 주소가 맞지 않아 설정을 멈췄어요."
done

say ""
say "받아쓰기 모델을 고르세요: 1) Cohere (기본, 더 정확) 2) 위스퍼 turbo (허깅페이스 동의 없이 받음)"
printf '번호 [그대로 두려면 Enter: %s]: ' "$( [ "$MODEL" = whisper ] && echo 2 || echo 1 )"
IFS= read -r answer || answer=""
case "$(printf '%s' "$answer" | tr -d '[:space:]')" in
  2 | whisper | 위스퍼) MODEL="whisper" ;;
  1 | cohere | Cohere | 코히어) MODEL="cohere" ;;
  "") ;;
  *) say "1 또는 2가 아니라서 Cohere로 둘게요."; MODEL="cohere" ;;
esac
[[ "$MAX_STREAMS" =~ ^[0-9]+$ ]] && [ "$MAX_STREAMS" -ge 1 ] && [ "$MAX_STREAMS" -le 64 ] || MAX_STREAMS="$DEFAULT_MAX_STREAMS"
case "$DEVICE" in auto | mps | cpu | cuda) ;; *) DEVICE="auto" ;; esac

# 토큰: 임시 파일에 쓰고(권한 600) 검사가 끝나면 자리를 바꾼다. 값은 변수에만 잠깐 둔다.
say ""
token=""
if [ -n "$TOKEN_FROM" ]; then
  [ -r "$TOKEN_FROM" ] || die "토큰 파일을 읽지 못했어요. 위치를 확인해 주세요."
  token="$(tr -d '\r\n' <"$TOKEN_FROM")"
  say "토큰을 파일에서 가져왔어요(값은 보여 주지 않아요)."
else
  say "일꾼 토큰을 붙여 넣고 Enter를 누르세요. 화면에는 아무것도 보이지 않아요."
  say "토큰은 라이브지니 서버의 LIVEJJIM_TRANSCRIBE_WORKER_TOKEN 값과 같아야 해요."
  if [ -f "$TOKEN_FILE" ]; then say "(이미 넣은 토큰을 그대로 쓰려면 그냥 Enter)"; fi
  printf '일꾼 토큰: '
  IFS= read -rs token || token=""
  printf '\n'
  token="$(printf '%s' "$token" | tr -d '\r\n')"
fi

if [ -z "$token" ] && [ -f "$TOKEN_FILE" ] && [ -z "$TOKEN_FROM" ]; then
  say "이미 넣은 토큰을 그대로 써요."
elif [ -z "$token" ]; then
  die "토큰이 비어 있어요. configure.sh를 다시 실행해 주세요."
elif ! valid_token "$token"; then
  token=""
  die "토큰에 쓸 수 없는 글자(빈칸·한글 등)가 있어요. 서버 설정의 값을 그대로 복사해 주세요."
else
  rm -f "$TOKEN_FILE.tmp"
  printf '%s' "$token" >"$TOKEN_FILE.tmp"
  chmod 600 "$TOKEN_FILE.tmp"
  mv -f "$TOKEN_FILE.tmp" "$TOKEN_FILE"
  say "토큰을 저장했어요(나만 읽을 수 있는 파일)."
fi
token=""
unset token
chmod 600 "$TOKEN_FILE"

rm -f "$CONF_FILE.tmp"
{
  printf 'SERVER=%s\n' "$SERVER"
  printf 'MODEL=%s\n' "$MODEL"
  printf 'MAX_STREAMS=%s\n' "$MAX_STREAMS"
  printf 'DEVICE=%s\n' "$DEVICE"
} >"$CONF_FILE.tmp"
chmod 600 "$CONF_FILE.tmp"
mv -f "$CONF_FILE.tmp" "$CONF_FILE"

say ""
say "설정을 저장했어요."
say "  서버 주소: $SERVER"
say "  모델: $( [ "$MODEL" = whisper ] && echo '위스퍼 turbo' || echo 'Cohere' )"
say "  설정 파일: $CONF_FILE"
if agent_loaded; then
  say "일꾼이 켜져 있어요. 새 설정으로 다시 켜려면: bash \"$APP_CODE/macmini/start.sh\""
fi
