#!/bin/bash
# 일꾼 켜기(이미 켜져 있으면 다시 켜기). 로그인할 때마다 저절로 켜지고, 꺼지면 30초 안에 다시 켜진다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

load_conf || die "설정이 아직 없어요. 먼저 install.sh를 실행해 주세요."
[ -f "$TOKEN_FILE" ] || die "일꾼 토큰이 없어요. configure.sh를 실행해 주세요."
[ -x "$APP_CODE/macmini/run.sh" ] || die "설치가 끝나지 않았어요. install.sh를 다시 실행해 주세요."

write_plist
if ! /usr/bin/plutil -lint "$PLIST_FILE" >/dev/null; then
  die "자동 켜기 파일이 망가졌어요. install.sh를 다시 실행해 주세요."
fi

if agent_loaded; then
  "$LAUNCHCTL" kickstart -k "$(gui_domain)/$LABEL" || die "일꾼을 다시 켜지 못했어요."
  say "일꾼을 다시 켰어요."
else
  "$LAUNCHCTL" bootstrap "$(gui_domain)" "$PLIST_FILE" || die "일꾼을 켜지 못했어요. 맥에 로그인한 상태에서 실행해 주세요."
  say "일꾼을 켰어요. 이제 맥에 로그인할 때마다 저절로 켜져요."
fi
say "처음 켤 때는 모델을 불러오느라 1~3분 걸려요. 잘 되는지 보려면: bash \"$APP_CODE/macmini/status.sh\""
