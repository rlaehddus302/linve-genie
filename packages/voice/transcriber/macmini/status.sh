#!/bin/bash
# 일꾼 상태를 쉬운 말로 보여 준다: 켜져 있나, 서버에 붙어 있나, 마지막으로 붙은 때, 받아쓰기 처리 시간(95%).
# 로그에는 셈·연결 상태만 있으므로 여기서도 그것만 읽는다. 토큰 값은 읽지 않는다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

say "== 받아쓰기 일꾼 상태 =="

if load_conf; then
  say "서버 주소: $SERVER"
  say "모델: $( [ "$MODEL" = whisper ] && echo '위스퍼 turbo' || echo 'Cohere' ) · 동시에 받아쓰는 수 한도 $MAX_STREAMS"
else
  say "설정: 아직 없어요 (install.sh를 실행해 주세요)"
fi

if [ -f "$TOKEN_FILE" ]; then
  mode="$(file_mode "$TOKEN_FILE")"
  if [ "$mode" = "600" ]; then
    say "일꾼 토큰: 넣어 둠 (나만 읽을 수 있음)"
  else
    say "일꾼 토큰: 넣어 둠 — 다른 사람도 읽을 수 있어요. 고치려면: chmod 600 \"$TOKEN_FILE\""
  fi
else
  say "일꾼 토큰: 없어요 (configure.sh를 실행해 주세요)"
fi

pid="$(agent_pid || true)"
if [ -n "$pid" ]; then
  say "일꾼 프로그램: 켜져 있어요"
  if /bin/ps -p "$pid" >/dev/null 2>&1 && /usr/bin/pgrep -q -f "caffeinate -i -w $pid" 2>/dev/null; then
    say "잠자기 막기: 일꾼이 도는 동안 맥이 저절로 잠들지 않아요"
  fi
elif agent_loaded; then
  say "일꾼 프로그램: 다시 켜지는 중이에요 (꺼졌다가 30초 안에 다시 켜져요)"
else
  say "일꾼 프로그램: 꺼져 있어요. 켜려면: bash \"$APP_CODE/macmini/start.sh\""
fi

if [ ! -f "$LOG_FILE" ]; then
  say "기록: 아직 없어요"
  exit 0
fi

# 로그 끝부분만 본다. 줄 앞의 시각은 "2026-10-30 21:05:11" 또는 (옛 판) "21:05:11"
tail -n 4000 "$LOG_FILE" | awk '
function stamp_of(line,   parts) {
  split(line, parts, " ")
  if (parts[1] ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) return parts[1] " " parts[2]
  if (parts[1] ~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/) return parts[1]
  return ""
}
{
  s = stamp_of($0)
  if (index($0, "라이브지니 서버에 붙었어요")) { state = "connected"; last_connected = s; state_at = s; next }
  if (index($0, "일꾼 토큰을 받지 않았어요")) { state = "token"; state_at = s; next }
  if (index($0, "일꾼 연결을 받지 않았어요")) { state = "refused"; state_at = s; next }
  if (index($0, "서버에 닿지 않아요")) { state = "unreachable"; state_at = s; next }
  if (index($0, "연결이 끊겼어요") || index($0, "연결이 닫혔어요")) { state = "lost"; state_at = s; next }
  if (index($0, "일꾼을 시작하지 못했어요") || index($0, "설정 파일이 없어요") || index($0, "토큰 파일이 없어요") || index($0, "환경이 없어요") || index($0, "코드가 없어요")) { state = "failed"; state_at = s; failed = $0; next }
  if (index($0, "일꾼을 켜요")) { state = "starting"; state_at = s; next }
  if (match($0, /95% [0-9]+ms/)) { p95 = substr($0, RSTART + 4, RLENGTH - 6); p95_at = s }
  if (index($0, "처리 시간 없음")) { p95 = ""; p95_at = s; p95_none = 1 }
}
END {
  if (state == "connected") print "서버 연결: 붙어 있어요 (" state_at "부터)"
  else if (state == "starting") print "서버 연결: 모델을 불러오는 중이에요 (" state_at "에 켬, 1~3분 걸려요)"
  else if (state == "token") print "서버 연결: 서버가 일꾼 토큰을 받지 않아요 (" state_at "). configure.sh로 서버와 같은 토큰을 다시 넣어 주세요."
  else if (state == "refused") print "서버 연결: 서버가 연결을 받지 않아요 (" state_at "). 서버 주소를 확인해 주세요."
  else if (state == "unreachable") print "서버 연결: 서버에 닿지 않아요 (" state_at "). 인터넷과 서버 주소를 확인해 주세요. 저절로 다시 붙어 봐요."
  else if (state == "lost") print "서버 연결: 끊겼어요 (" state_at "). 저절로 다시 붙어 봐요."
  else if (state == "failed") print "서버 연결: 일꾼이 시작하지 못했어요 (" state_at "). 아래 기록을 보세요."
  else print "서버 연결: 기록이 아직 없어요"
  if (last_connected != "") print "마지막으로 서버에 붙은 때: " last_connected
  else print "마지막으로 서버에 붙은 때: 아직 없어요"
  if (p95 != "") print "받아쓰기 처리 시간: 100번 중 95번은 " p95 "ms 안에 끝났어요 (" p95_at " 기준, 5분마다 새로 적어요)"
  else if (p95_none) print "받아쓰기 처리 시간: 아직 받아쓴 말이 없어요"
  else print "받아쓰기 처리 시간: 아직 기록이 없어요 (붙은 뒤 5분마다 적어요)"
  if (failed != "") print "마지막 오류 기록: " failed
}'
say "기록 파일: $LOG_FILE"
