#!/bin/bash
# 라이브지니 compose 묶음을 부르는 짧은 이름. bootstrap.sh가 /usr/local/bin/lg-compose로 이어 둔다.
#   예: sudo lg-compose ps · sudo lg-compose logs --tail 100 app-a
# 두 자리 교대(D-RETRO-35~39): 앱 자리는 app-a·app-b 둘이고 profiles로 갈려 있다.
#   - 그냥 부르면 **운영 자리만** 고른다(/opt/livegenie/slot/active 한 줄). `sudo lg-compose up -d`가 대기 자리까지 띄우지 않는다.
#   - 운영 자리 이름을 몰라도 되게 `app`이라고 적으면 운영 자리 이름으로 바꿔 준다: sudo lg-compose logs --tail 100 app · sudo lg-compose exec app …
#   - 두 자리를 다 보려면 LG_SLOTS=all (switch.sh가 그렇게 부른다): sudo LG_SLOTS=all lg-compose ps -a
#   - 자리마다 이미지·판은 /opt/livegenie/slot/slots.env (switch.sh가 적는다. 비밀값 없음)
set -euo pipefail
LG_ROOT="${LG_ROOT:-/opt/livegenie}"
export LJ_ENV_FILE="${LJ_ENV_FILE:-$LG_ROOT/.env}"
export LJ_APP_BACKUP_DIR="${LJ_APP_BACKUP_DIR:-$LG_ROOT/backups/app}"
export LJ_APP_SECRETS_DIR="${LJ_APP_SECRETS_DIR:-$LG_ROOT/secrets}"
export LJ_APP_UPDATES_DIR="${LJ_APP_UPDATES_DIR:-$LG_ROOT/app-updates}"
export LJ_SLOT_DIR="${LJ_SLOT_DIR:-$LG_ROOT/slot}"

ACTIVE=""
if [ -r "$LJ_SLOT_DIR/active" ]; then ACTIVE=$(tr -d ' \t\r\n' < "$LJ_SLOT_DIR/active"); fi
case "$ACTIVE" in a | b) ;; *) ACTIVE="" ;; esac

if [ "${LG_SLOTS:-}" = all ]; then
  export COMPOSE_PROFILES=a,b
elif [ -n "${LG_SLOTS:-}" ]; then
  export COMPOSE_PROFILES="$LG_SLOTS"
else
  # 운영 자리를 아직 모르면(처음 설치 전) 앱 자리를 고르지 않는다 — db·caddy만 다룬다
  export COMPOSE_PROFILES="$ACTIVE"
fi

ENV_FILES=(--env-file "$LJ_ENV_FILE")
if [ -f "$LJ_SLOT_DIR/slots.env" ]; then ENV_FILES+=(--env-file "$LJ_SLOT_DIR/slots.env"); fi

# `app` → 운영 자리 이름 (명령 뒤의 서비스 이름 자리에서만 — 정확히 app 한 낱말일 때)
ARGS=()
for arg in "$@"; do
  if [ "$arg" = app ] && [ -n "$ACTIVE" ]; then ARGS+=("app-$ACTIVE"); else ARGS+=("$arg"); fi
done

exec "${LG_DOCKER:-docker}" compose \
  --project-name "${LG_PROJECT:-livegenie}" \
  "${ENV_FILES[@]}" \
  -f "${LG_COMPOSE_FILE:-$LG_ROOT/src/deploy/ec2/compose.yaml}" \
  ${ARGS[@]+"${ARGS[@]}"}
