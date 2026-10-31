#!/bin/bash
# 라이브지니 compose 묶음을 부르는 짧은 이름. bootstrap.sh가 /usr/local/bin/lg-compose로 이어 둔다.
#   예: sudo lg-compose ps · sudo lg-compose logs --tail 100 app
set -euo pipefail
LG_ROOT="${LG_ROOT:-/opt/livegenie}"
export LJ_ENV_FILE="$LG_ROOT/.env"
export LJ_APP_BACKUP_DIR="$LG_ROOT/backups/app"
exec docker compose \
  --project-name livegenie \
  --env-file "$LJ_ENV_FILE" \
  -f "$LG_ROOT/src/deploy/ec2/compose.yaml" \
  "$@"
