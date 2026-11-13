#!/bin/bash
# 미뤄 둔 내보내기 따라잡기 (D-RETRO-31) — 맥 미니에서 10분마다 돈다(.github/workflows/catchup.yml).
# 내보내기(ship.yml)가 매번 ~/.livegenie-ci/bin/ 에 깔아 주는 사본으로 돈다(저장소를 내려받지 않는다 — 내보내기 작업 폴더를 건드리지 않게).
#
# 하는 일: 미룸 표시(~/.livegenie-ci/deferred/*, ship-lib.sh)가 있고 → 방송이 없고(idle) → 그 상태가 10분 넘게 이어졌으면
#          내보내기를 main에서 수동 실행으로 부른다. 그 실행이 서버 배포 → 앱 화면 → 앱 빌드 → 화면 일꾼 순서로 밀린 것을 한다.
#  - 방송 여부를 확인하지 못하면(unknown) 부르지 않는다. 사람이 없는 자동 실행이라 헷갈릴 때는 기다린다(live-gate.sh 머리말).
#  - 10분을 기다리는 까닭: 판매자가 방송을 끝냈다가 바로 다시 잇는 일이 있다. 끝나자마자 서버를 다시 켜면 그 방송이 끊긴다.
#  - 같은 미룸 표시에 세 번(30분 간격)까지만 부른다. 부른 실행이 시험 실패처럼 앞 단계에서 멈추면 표시가 그대로 남는데, 그때 끝없이 부르지 않게.
#    방송이 다시 시작돼 또 미뤄지면 표시의 시각이 바뀌어 새 표시로 센다.
# 환경값: GH_TOKEN·GITHUB_REPOSITORY(워크플로가 넘긴다) · LG_CATCHUP_QUIET_SEC(기본 600) · LG_GATE·LG_DISPATCH(시험용)
set -uo pipefail
export PATH=/opt/homebrew/bin:$PATH

HERE="$(cd "$(dirname "$0")" && pwd)"
CI_DIR="${LG_CI_DIR:-$HOME/.livegenie-ci}"
D="$CI_DIR/deferred"
GATE="${LG_GATE:-$HERE/live-gate.sh}"
QUIET="${LG_CATCHUP_QUIET_SEC:-600}"
RETRY_GAP="${LG_CATCHUP_RETRY_SEC:-1800}"
MAX_TRIES=3
NOW=$(date +%s)

note() {
  echo "$*"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- $*" >> "$GITHUB_STEP_SUMMARY"; fi
}

MARKS=""
for what in server worker native-ios native-android; do
  if [ -s "$D/$what" ]; then MARKS="$MARKS $what"; fi
done
if [ -z "$MARKS" ]; then
  rm -f "$D/.idle-since" "$D/.dispatched"
  echo "미뤄 둔 것이 없어요"
  exit 0
fi
echo "미뤄 둔 것:$MARKS"

STATE=$(bash "$GATE")
if [ "$STATE" != idle ]; then
  rm -f "$D/.idle-since"
  echo "방송 중이거나 방송 여부를 확인하지 못했어요($STATE) — 기다려요"
  exit 0
fi

SINCE=$(cat "$D/.idle-since" 2>/dev/null || true)
if ! [[ "$SINCE" =~ ^[0-9]+$ ]]; then
  echo "$NOW" > "$D/.idle-since"
  echo "방송이 없는 것을 처음 봤어요 — $((QUIET / 60))분 뒤에도 조용하면 내보내요"
  exit 0
fi
if [ $((NOW - SINCE)) -lt "$QUIET" ]; then
  echo "방송이 끝난 지 $(((NOW - SINCE) / 60))분 — $((QUIET / 60))분을 채우면 내보내요"
  exit 0
fi

# 같은 표시에 몇 번 불렀나 (.dispatched: "<표시 지문> <횟수> <마지막 시각>")
FP=$(for what in $MARKS; do echo "$what $(cat "$D/$what")"; done | shasum -a 256 | cut -c1-16)
read -r LAST_FP TRIES LAST_AT < <(cat "$D/.dispatched" 2>/dev/null || echo "- 0 0")
if [ "$LAST_FP" != "$FP" ] || ! [[ "${TRIES:-}" =~ ^[0-9]+$ ]] || ! [[ "${LAST_AT:-}" =~ ^[0-9]+$ ]]; then TRIES=0; LAST_AT=0; fi
if [ "$TRIES" -ge "$MAX_TRIES" ]; then
  echo "::warning::미뤄 둔 내보내기($MARKS)를 ${MAX_TRIES}번 불렀는데도 남아 있어요 — 최근 내보내기 실행이 왜 실패했는지 봐 주세요(gh run list -w 내보내기 -L 5)"
  exit 0
fi
if [ $((NOW - LAST_AT)) -lt "$RETRY_GAP" ]; then
  echo "조금 전에 불렀어요($(((NOW - LAST_AT) / 60))분 전, ${TRIES}번째) — 그 실행을 기다려요"
  exit 0
fi

ANDROID=false
case " $MARKS " in *" native-android "*) ANDROID=true ;; esac

dispatch() {
  if [ -n "${LG_DISPATCH:-}" ]; then "$LG_DISPATCH" "$ANDROID"; return; fi
  [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || { echo "GH_TOKEN·GITHUB_REPOSITORY가 없어 내보내기를 부르지 못해요" >&2; return 1; }
  # 토큰은 명령행 인자가 아니라 표준 입력(설정)으로 넘긴다
  printf 'header = "Authorization: Bearer %s"\n' "$GH_TOKEN" | "${LG_CURL:-curl}" -fsS -m 30 --config - -X POST \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
    "${GITHUB_API_URL:-https://api.github.com}/repos/$GITHUB_REPOSITORY/actions/workflows/ship.yml/dispatches" \
    -d "{\"ref\":\"main\",\"inputs\":{\"android\":\"$ANDROID\"}}"
}

if dispatch; then
  echo "$FP $((TRIES + 1)) $NOW" > "$D/.dispatched"
  note "방송이 끝나서 미뤄 둔 내보내기($MARKS)를 main에서 다시 불렀어요$([ "$ANDROID" = true ] && echo ' (안드로이드 포함)')"
else
  echo "::warning::미뤄 둔 내보내기를 부르지 못했어요 — 다음 차례에 다시 해 봐요"
fi
exit 0
