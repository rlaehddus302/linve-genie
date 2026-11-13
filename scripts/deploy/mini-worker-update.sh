#!/bin/bash
# 화면 일꾼 갱신 (D-RETRO-33, 복기 E10·E12) — 맥 미니에서 돈다. 내보내기(ship.yml)가 **운영 서버 배포 다음에** 부른다.
# 2026-11-12 방송: 내보내기가 일꾼을 갱신하지 않아 누가 `git pull` 뒤 손으로 다시 켰고(5번), 일꾼이 서버보다 먼저 새 판이 됐다.
#
# 쓰는 법:
#   mini-worker-update.sh <커밋 40자>           문지기 확인 → 일꾼 폴더를 그 커밋으로 → launchd 서비스 다시 켜기
#   mini-worker-update.sh --stage <커밋 40자>   판 폴더만 만들고 current를 바꾼다(다시 켜지 않음 — 판 폴더 방식으로 처음 옮길 때, docs/DEPLOY.md 6-1절)
# 종료 코드: 0 갱신함 · 10 미룸(방송 중이거나 방송 여부를 확인하지 못함 — 다시 켜지 않았다) · 11 건너뜀(일꾼 폴더가 이미 더 새 판) · 그 밖 실패
#
# 일꾼 폴더는 launchd 설정(~/Library/LaunchAgents/kr.livegenie.screen-worker.plist)의 WorkingDirectory에서 읽는다. 두 방식을 스스로 가린다:
#   - 판 폴더 방식 (WorkingDirectory = ~/lg/screen-worker/current): 커밋의 packages/screen-worker 를 ~/lg/screen-worker/releases/<커밋 12자>로 풀고
#     current 링크를 바꾼 뒤 다시 켠다. 코드·지시문(sw/prompts)이 한 묶음이라 따로 바뀌지 않고, 누가 저장소에서 git pull을 해도 일꾼은 그대로다.
#     파이썬 묶음은 requirements.lock.txt 내용마다 하나(~/lg/screen-worker/venvs/<해시>)를 만들어 판 폴더의 .venv로 잇는다.
#   - 작업 폴더 방식 (그 밖 — 지금까지의 ~/livegenie/packages/screen-worker): 그 저장소를 그 커밋으로 빨리 감기만 한다.
#     손으로 고친 변경이 있거나 가지가 main이 아니거나 갈라져 있으면 건드리지 않고 실패로 알린다.
# 환경값(없으면 ~/.livegenie-ci/gate.env):
#   LG_WORKER_DIR    launchd 설정을 읽지 않고 일꾼 폴더를 직접 정한다        LG_WORKER_ROOT  판 폴더 뿌리 (기본 ~/lg/screen-worker)
#   LG_WORKER_LABEL  launchd 서비스 이름 (기본 kr.livegenie.screen-worker)   LG_WORKER_FORCE=yes  문지기를 건너뛴다(사람이 손으로 돌릴 때만)
#   LG_SRC_REPO      커밋을 가져올 저장소 (기본: 이 스크립트가 든 저장소 — 내보내기 작업 폴더)
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH

HERE="$(cd "$(dirname "$0")" && pwd)"
CI_DIR="${LG_CI_DIR:-$HOME/.livegenie-ci}"
if [ -f "$CI_DIR/gate.env" ]; then
  # 이미 환경에 있는 값이 이긴다
  KEEP=$(export -p | grep -E '^declare -x LG_' || true)
  # shellcheck disable=SC1091
  set -a; . "$CI_DIR/gate.env"; set +a
  eval "$KEEP"
fi

STAGE_ONLY=no
if [ "${1:-}" = --stage ]; then STAGE_ONLY=yes; shift; fi
SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "쓰는 법: mini-worker-update.sh [--stage] <커밋 40자>" >&2; exit 2; }
ID="${SHA:0:12}"

LABEL="${LG_WORKER_LABEL:-kr.livegenie.screen-worker}"
PLIST="${LG_WORKER_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
ROOT="${LG_WORKER_ROOT:-$HOME/lg/screen-worker}"
SRC="${LG_SRC_REPO:-$(git -C "$HERE" rev-parse --show-toplevel)}"
LAUNCHCTL="${LG_LAUNCHCTL:-launchctl}"
GATE="${LG_GATE:-$HERE/live-gate.sh}"
UV="${LG_UV:-uv}"
STOP_WAIT="${LG_WORKER_STOP_WAIT:-45}"     # 일꾼 관리자는 멈출 때 일꾼을 20초까지 기다린다(sw/serve.py STOP_GRACE)
START_WAIT="${LG_WORKER_START_WAIT:-30}"
TARGET="gui/$(id -u)/$LABEL"

die() { echo "화면 일꾼 갱신 실패: $*" >&2; exit 1; }
expand() { case "$1" in "~/"*) echo "$HOME/${1#"~/"}" ;; *) echo "$1" ;; esac; }
physical() { (cd "$1" 2>/dev/null && pwd -P) || true; }

# ---------- 판 폴더 ----------
stage_release() {
  local rel="$ROOT/releases/$ID" tmp hash venv prev
  mkdir -p "$ROOT/releases" "$ROOT/venvs"
  if [ ! -f "$rel/RELEASE" ]; then
    git -C "$SRC" cat-file -e "$SHA^{commit}" 2>/dev/null || die "저장소($SRC)에 커밋 $ID 이 없어요"
    tmp="$ROOT/releases/.tmp-$ID-$$"
    rm -rf "$tmp"; mkdir -p "$tmp"
    git -C "$SRC" archive --format=tar "$SHA" packages/screen-worker | tar -x -C "$tmp" --strip-components 2
    [ -f "$tmp/sw/serve.py" ] && [ -f "$tmp/requirements.lock.txt" ] || { rm -rf "$tmp"; die "커밋 $ID 에 화면 일꾼(packages/screen-worker)이 없어요"; }
    # 파이썬 묶음: 잠금 파일(+파이썬 판) 내용이 같으면 같이 쓴다. 가상환경은 옮기면 깨지므로 제자리에 만들고 다 되면 표시(.lg-ready)를 둔다
    hash=$(cat "$tmp/requirements.lock.txt" "$tmp/.python-version" 2>/dev/null | shasum -a 256 | cut -c1-16)
    venv="$ROOT/venvs/$hash"
    if [ ! -f "$venv/.lg-ready" ]; then
      command -v "$UV" >/dev/null 2>&1 || { rm -rf "$tmp"; die "파이썬 의존성이 바뀌어 새 묶음이 필요한데 uv가 없어요 — 맥 미니에 uv를 깔거나 $venv 를 손으로 만든 뒤 다시 내보내 주세요"; }
      echo "파이썬 묶음을 새로 만들어요: $venv (잠금 파일이 바뀜 — 몇 분 걸릴 수 있어요)"
      rm -rf "$venv"
      (cd "$tmp" && "$UV" venv -q "$venv" && VIRTUAL_ENV="$venv" "$UV" pip install -q -r requirements.lock.txt) || { rm -rf "$tmp" "$venv"; die "파이썬 묶음을 만들지 못했어요"; }
      date -u +%Y-%m-%dT%H:%M:%SZ > "$venv/.lg-ready"
    fi
    ln -s "../../venvs/$hash" "$tmp/.venv"
    # 새 판이 최소한 뜨는지: 관리자와 보내기 모듈을 읽어 본다(표준 라이브러리만 쓴다 — 무거운 모델은 읽지 않는다)
    (cd "$tmp" && .venv/bin/python -c 'import sw.serve, sw.post') || { rm -rf "$tmp"; die "새 판($ID)의 일꾼 관리자가 읽히지 않아요 — current는 그대로 둬요"; }
    echo "$SHA" > "$tmp/RELEASE"
    mv "$tmp" "$rel"
  fi
  prev=$(readlink "$ROOT/current" 2>/dev/null || true)
  if [ "$prev" != "releases/$ID" ]; then
    # 되돌릴 때: ln -sfn "$(cat previous)" current 뒤 다시 켜기
    if [ -n "$prev" ]; then echo "$prev" > "$ROOT/previous"; fi
    ln -sfn "releases/$ID" "$ROOT/current"
  fi
  # 옛 판은 최근 5개만 (지금 판·바로 앞 판은 늘 남긴다)
  local keep_prev d
  keep_prev=$(basename "$(cat "$ROOT/previous" 2>/dev/null || echo -)")
  # shellcheck disable=SC2012
  ls -1t "$ROOT/releases" | tail -n +6 | while read -r d; do
    if [ "$d" != "$ID" ] && [ "$d" != "$keep_prev" ]; then rm -rf "${ROOT:?}/releases/$d"; fi
  done
  echo "판 폴더: $ROOT/current → releases/$ID"
}

# ---------- 작업 폴더(저장소를 그대로 돌리는 옛 방식) ----------
sync_checkout() {
  local repo="$1" branch head
  # 손으로 고친 변경(추적하는 파일)이 있으면 건드리지 않는다 — 누가 방송용으로 급히 고쳐 둔 것일 수 있다
  if ! git -C "$repo" diff --quiet || ! git -C "$repo" diff --cached --quiet; then
    git -C "$repo" status --short | head -10 >&2
    die "일꾼 작업 폴더($repo)에 손으로 고친 변경이 있어요 — 건드리지 않았어요. 커밋해 내보내거나 되돌린 뒤 다시 내보내 주세요"
  fi
  branch=$(git -C "$repo" symbolic-ref -q --short HEAD || true)
  [ "$branch" = "${LG_WORKER_BRANCH:-main}" ] || die "일꾼 작업 폴더($repo)가 ${LG_WORKER_BRANCH:-main} 가지가 아니에요(지금: ${branch:-가지 없음}) — 건드리지 않았어요"
  if ! git -C "$repo" cat-file -e "$SHA^{commit}" 2>/dev/null; then
    # 내보내기 작업 폴더에서 그 커밋만 가져온다(맥 미니의 깃 로그인에 기대지 않는다)
    git -C "$repo" fetch -q --upload-pack 'git -c uploadpack.allowAnySHA1InWant=true upload-pack' "$SRC" "$SHA" || die "커밋 $ID 을 일꾼 작업 폴더로 가져오지 못했어요"
  fi
  head=$(git -C "$repo" rev-parse HEAD)
  if [ "$head" = "$SHA" ]; then
    echo "작업 폴더가 이미 $ID 판이에요"
  elif git -C "$repo" merge-base --is-ancestor "$head" "$SHA"; then
    git -C "$repo" merge -q --ff-only "$SHA"
    echo "작업 폴더: ${head:0:12} → $ID"
  elif git -C "$repo" merge-base --is-ancestor "$SHA" "$head"; then
    echo "일꾼 작업 폴더($repo)가 이미 더 새 판(${head:0:12})이에요 — 다시 켜지 않고 그 판의 내보내기에 맡겨요"
    exit 11
  else
    die "일꾼 작업 폴더($repo, ${head:0:12})가 $ID 와 갈라져 있어요(내보내지 않은 커밋) — 건드리지 않았어요"
  fi
}

# ---------- launchd ----------
svc_pid() { { "$LAUNCHCTL" print "$TARGET" 2>/dev/null || true; } | awk '$1 == "pid" && $2 == "=" { print $3; exit }'; }

restart_service() {
  local old now i
  old=$(svc_pid)
  if [ -n "$old" ]; then
    # SIGTERM: 관리자가 도는 일꾼을 정리하고 끝난다(강제로 죽이면 일꾼이 떠돌이로 남는다)
    "$LAUNCHCTL" kill SIGTERM "$TARGET" >/dev/null 2>&1 || true
    for ((i = 0; i < STOP_WAIT; i++)); do
      now=$(svc_pid)
      if [ "$now" != "$old" ]; then break; fi
      sleep 1
    done
    [ "$(svc_pid)" != "$old" ] || die "일꾼 관리자(pid $old)가 ${STOP_WAIT}초 안에 멈추지 않았어요"
  fi
  # KeepAlive면 launchd가 이미 다시 띄웠다 — 아니면 여기서 띄운다(이미 떠 있으면 아무 일도 없다)
  "$LAUNCHCTL" kickstart "$TARGET" >/dev/null 2>&1 || true
  for ((i = 0; i < START_WAIT; i++)); do
    now=$(svc_pid)
    if [ -n "$now" ] && [ "$now" != "$old" ]; then echo "일꾼 관리자 다시 켬 (pid ${old:-없음} → $now)"; return 0; fi
    sleep 1
  done
  die "일꾼 관리자가 ${START_WAIT}초 안에 다시 뜨지 않았어요 — launchctl print $TARGET 로 확인해 주세요"
}

# ---------- 차례 ----------
if [ "$STAGE_ONLY" = yes ]; then
  stage_release
  echo "WORKER-STAGED $ID"
  exit 0
fi

WD="${LG_WORKER_DIR:-}"
if [ -z "$WD" ]; then
  [ -f "$PLIST" ] || die "일꾼 launchd 설정($PLIST)이 없어요 — ~/.livegenie-ci/gate.env 에 LG_WORKER_DIR=<일꾼이 도는 폴더> 를 적어 주세요"
  WD=$(plutil -extract WorkingDirectory raw -o - "$PLIST" 2>/dev/null) || die "launchd 설정($PLIST)에 WorkingDirectory가 없어요 — gate.env 에 LG_WORKER_DIR 를 적어 주세요"
fi
WD=$(expand "$WD"); WD="${WD%/}"
if [ "$(basename "$WD")" = current ] && [ -n "$(physical "$ROOT")" ] && [ "$(physical "$(dirname "$WD")")" = "$(physical "$ROOT")" ]; then MODE=release; else MODE=checkout; fi

# 문지기를 먼저: 방송 중에는 아무것도 바꾸지 않는다(작업 폴더 방식은 폴더만 바꿔도 지시문이 바로 바뀐다 — 일꾼이 호출마다 읽는다).
# 확인하지 못했을 때(unknown)도 미룬다: 다시 켜면 받아쓰기·번호표 이력을 잃는데, 미뤄서 잃는 것은 없다(live-gate.sh 머리말).
if [ "${LG_WORKER_FORCE:-no}" != yes ]; then
  STATE=$(bash "$GATE" || true)
  if [ "$STATE" != idle ]; then
    echo "방송 중이거나 방송 여부를 확인하지 못해($STATE) 화면 일꾼을 갱신하지 않았어요 — 방송이 끝난 뒤 다시 해요"
    exit 10
  fi
fi

# 다시 켤 수 없으면 폴더도 바꾸지 않는다(폴더만 새 판이 되면 지시문만 먼저 바뀐다)
"$LAUNCHCTL" print "$TARGET" >/dev/null 2>&1 || die "일꾼 서비스($TARGET)가 launchd에 올라와 있지 않아요 — 아무것도 바꾸지 않았어요(docs/DEPLOY.md 6-1절)"

if [ "$MODE" = release ]; then
  stage_release
else
  [ -d "$WD" ] || die "일꾼 폴더($WD)가 없어요"
  REPO=$(git -C "$WD" rev-parse --show-toplevel 2>/dev/null) || die "일꾼 폴더($WD)가 깃 저장소가 아니에요"
  sync_checkout "$REPO"
fi
restart_service
echo "WORKER-UPDATED $MODE $ID"
