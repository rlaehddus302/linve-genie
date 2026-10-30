#!/bin/bash
# 일꾼 끄기. 다음에 맥에 로그인하면 다시 저절로 켜진다(아예 지우려면 uninstall.sh).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

if agent_loaded; then
  "$LAUNCHCTL" bootout "$(gui_domain)/$LABEL" 2>/dev/null || true
  say "일꾼을 껐어요. 방송 중이던 사장님 화면에는 '받아쓰기 서버가 꺼져 있어요'가 보여요."
  say "다시 켜려면: bash \"$APP_CODE/macmini/start.sh\"  (맥에 다시 로그인해도 켜져요)"
else
  say "일꾼이 이미 꺼져 있어요."
fi
