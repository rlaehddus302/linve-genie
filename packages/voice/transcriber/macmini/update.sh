#!/bin/bash
# 일꾼 업데이트. 꾸러미 판은 requirements.txt에 고정된 그대로 설치한다(최신으로 마음대로 올리지 않는다).
#   bash update.sh            설치 묶음이 git 폴더면 최신 코드를 받고(git pull --ff-only), 아니면 그 폴더의 파일로 바꾼다
#   bash update.sh --no-pull  git 폴더여도 받지 않고 지금 폴더의 파일로만 바꾼다
# 새 파이썬 환경은 옆에 따로 만들고 다 된 뒤에만 바꾼다 — 중간에 실패해도 켜져 있던 일꾼은 그대로다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

# 아래 전체를 한 덩어리로 먼저 읽는다 — 최신 코드를 받으며 이 파일이 바뀌어도 도는 중에 섞이지 않게
{
PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    *) die "모르는 설정이 있어요. 쓸 수 있는 것: --no-pull" ;;
  esac
done

# 어디서 실행했나: 설치 폴더 안의 복사본이면 처음 설치한 묶음 위치를, 아니면 이 묶음을 쓴다
if [ "$HERE" = "$APP_CODE/macmini" ]; then
  [ -f "$SOURCE_RECORD" ] || die "처음 설치한 묶음 위치를 모르겠어요. 새 묶음 폴더 안의 macmini/update.sh를 실행해 주세요."
  SRC="$(cat "$SOURCE_RECORD")"
  [ -d "$SRC/livegenie_transcriber" ] || die "처음 설치한 묶음 폴더가 없어요($SRC). 새 묶음을 내려받아 그 안의 macmini/update.sh를 실행해 주세요."
else
  SRC="$(bundle_root)"
fi
[ -d "$APP_DIR" ] || die "아직 설치되지 않았어요. install.sh를 먼저 실행해 주세요."

before="$(cat "$VERSION_FILE" 2>/dev/null || echo '알 수 없음')"
if git -C "$SRC" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ "$PULL" = "1" ]; then
    if [ -n "$(git -C "$SRC" status --porcelain -- . 2>/dev/null)" ]; then
      die "묶음 폴더에 손댄 파일이 있어 최신 코드를 받지 않았어요. 그대로 쓰려면: bash update.sh --no-pull"
    fi
    say "최신 코드를 받아요..."
    git -C "$SRC" pull --ff-only --quiet || die "최신 코드를 받지 못했어요. 인터넷 연결을 확인하거나 --no-pull로 실행해 주세요."
  fi
else
  say "묶음 폴더가 git 폴더가 아니라서, 이 폴더에 있는 파일로 업데이트해요."
  say "(새 묶음을 내려받아 풀었다면, 그 새 폴더 안의 macmini/update.sh를 실행하면 돼요.)"
fi
after="$(bundle_version "$SRC")"

VENV="$(venv_dir_for "$SRC/requirements.txt")"
if [ -x "$VENV/bin/python" ]; then
  say "꾸러미 판은 그대로예요."
else
  say "꾸러미 판이 바뀌었어요. 새 파이썬 환경을 옆에 만들어요(수 분)..."
  build_venv "$SRC/requirements.txt" "$VENV" || die "새 꾸러미를 설치하지 못했어요. 켜져 있던 일꾼은 그대로예요."
fi

deploy_code "$SRC" || die "코드를 바꾸지 못했어요."
printf '%s\n' "$SRC" >"$SOURCE_RECORD"
printf '%s\n' "$after" >"$VERSION_FILE"

if agent_loaded; then
  write_plist
  "$LAUNCHCTL" kickstart -k "$(gui_domain)/$LABEL" >/dev/null 2>&1 || warn "일꾼을 다시 켜지 못했어요. start.sh를 실행해 주세요."
  say "일꾼을 새 판으로 다시 켰어요."
fi
cleanup_old_venvs "$VENV"

if load_conf && ! model_cached "$VENV/bin/python" "$(model_repo "$MODEL")"; then
  say "새 판이 쓰는 모델이 아직 없어요. 다음을 실행해 주세요: bash \"$APP_CODE/macmini/download-model.sh\""
fi
say "업데이트를 마쳤어요. ($before → $after)"
exit 0
}
