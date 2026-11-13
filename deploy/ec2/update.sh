#!/bin/bash
# 새 버전 올리기 — 손으로 부를 때 (SSM Run Command로 root가 부른다, README "새 버전"). 다시 돌려도 안전하다.
#   git pull(main, 빨리 감기만) → 두 자리 교대(switch.sh --build: 대기 자리에 띄워 확인 → 올리기 → 옛 자리 내리기)
# 맥 미니 내보내기는 이 파일이 아니라 lg-apply.sh → switch.sh 를 부른다(커밋·이미지 주소를 넘긴다).
# 백업: 배포 때마다 하지 않는다 (D-RETRO-39, 복기 E8). 새 마이그레이션 파일이 있는 판일 때만 switch.sh가 먼저 한다 — 매일 04:00 백업은 따로 돈다(livegenie-backup.timer).
#   급할 때만 LG_SKIP_BACKUP=1.
# 마이그레이션은 대기 자리가 뜰 때 적용한다 — 옛 판이 같이 떠 있으므로 더하기만 한다(scripts/deploy/check-migrations.sh, D-RETRO-38).
# 끝에 LG-UPDATED <커밋> 또는 LG-UPDATE-FAIL <단계>를 찍는다(switch.sh의 LG-SWITCHED·LG-SWITCH-FAIL 줄도 그 앞에 남는다).
# 인자는 switch.sh로 그대로 넘긴다(예: --stage-only).
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
  STEP=pull
  git -C "$LG_SRC" fetch -q origin "$LG_BRANCH"
  git -C "$LG_SRC" checkout -q "$LG_BRANCH"
  git -C "$LG_SRC" merge -q --ff-only "origin/$LG_BRANCH"
  chmod -R go+rX "$LG_SRC"
  chmod 0755 "$LG_SRC/deploy/ec2/"*.sh
  STEP=switch
  local commit
  commit=$(git -C "$LG_SRC" rev-parse HEAD)
  # 새로 받은 switch.sh로 돈다(이 파일과 달리 따로 실행되는 파일이라 pull 뒤의 내용이다)
  "$LG_SRC/deploy/ec2/switch.sh" --commit "$commit" --build "$@"
  echo "LG-UPDATED ${commit:0:7}"
}

main "$@"
