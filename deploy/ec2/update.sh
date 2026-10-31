#!/bin/bash
# 새 버전 올리기 (SSM Run Command로 root가 부른다, README "새 버전"). 다시 돌려도 안전하다.
#   백업(backup.sh) → git pull(main, 빨리 감기만) → 이미지 빌드 → up -d → /health 확인
# 백업이 실패하면 올리지 않는다. 급할 때만 LG_SKIP_BACKUP=1.
# 마이그레이션은 서버가 시작할 때 적용한다(서버 한 대 — docs/DEPLOY.md 6절).
# 끝에 LG-UPDATED <커밋> 또는 LG-UPDATE-FAIL <단계>를 찍는다.
set -Eeuo pipefail
LG_ROOT="${LG_ROOT:-/opt/livegenie}"
LG_SRC="$LG_ROOT/src"
LG_BRANCH="${LG_BRANCH:-main}"
STEP=start
# rc는 trap 안에서 정한다
# shellcheck disable=SC2154
trap 'rc=$?; echo "LG-UPDATE-FAIL $STEP"; exit $rc' ERR

# 함수 안에 두어, git pull이 이 파일을 바꿔도 이미 읽은 내용으로 끝까지 돈다
main() {
  if [ "${LG_SKIP_BACKUP:-}" != 1 ]; then
    STEP=backup
    "$LG_SRC/deploy/ec2/backup.sh"
  fi
  STEP=pull
  git -C "$LG_SRC" fetch -q origin "$LG_BRANCH"
  git -C "$LG_SRC" checkout -q "$LG_BRANCH"
  git -C "$LG_SRC" merge -q --ff-only "origin/$LG_BRANCH"
  chmod 0755 "$LG_SRC/deploy/ec2/"*.sh
  STEP=build
  lg-compose build --pull app
  STEP=up
  lg-compose up -d --remove-orphans
  STEP=health
  "$LG_SRC/deploy/ec2/wait-health.sh"
  docker image prune -f >/dev/null || true
  echo "LG-UPDATED $(git -C "$LG_SRC" rev-parse --short HEAD)"
}

main "$@"
