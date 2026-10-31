#!/bin/sh
# 아이폰 앱용 연습 서버 주소를 tailnet 전용으로 열고 닫는다 (APP).
# tailscale serve(정식 인증서) https:8443 → 연습 모드 휴대폰 중계(https://127.0.0.1:7701, 자체 서명이라 insecure로 잇는다).
# Funnel(공개 인터넷)은 쓰지 않는다. 다른 serve 설정(예: 5173)은 건드리지 않는다.
# 쓰는 법: sh scripts/try/tailnet-app.sh on|off|status   (포트 바꾸기: TRY_PHONE_PORT=7701 TAILNET_APP_PORT=8443)
set -eu
PHONE_PORT="${TRY_PHONE_PORT:-7701}"
APP_PORT="${TAILNET_APP_PORT:-8443}"
case "${1:-status}" in
  on)  tailscale serve --bg --https="$APP_PORT" "https+insecure://127.0.0.1:$PHONE_PORT" ;;
  off) tailscale serve --https="$APP_PORT" off ;;
  status) tailscale serve status ;;
  *) echo "on, off, status 중 하나를 적어 주세요."; exit 1 ;;
esac
