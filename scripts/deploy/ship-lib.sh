#!/bin/bash
# 내보내기(ship.yml) 단계들이 같이 쓰는 작은 함수 — `. scripts/deploy/ship-lib.sh`로 읽어 쓴다.
# "미룸 표시"(D-RETRO-31): 방송 중이라 건너뛴 일을 ~/.livegenie-ci/deferred/<무엇> 파일로 남긴다(내용: "<커밋> <미룬 시각(초)>").
#   무엇: server(운영 서버 배포) · worker(화면 일꾼 갱신) · native-ios(TestFlight) · native-android(APK)
#   따라잡기(mini-catchup.sh)가 이 표시를 보고 방송이 끝난 뒤 내보내기를 다시 부른다.
#   표시는 "문지기가 미뤘고 아직 다시 해 보지 않은 것"만 뜻한다 — 실제로 하기 직전에 지운다(하다가 실패하면 빨간 실행이 알린다. 표시가 남아 저절로 되풀이되지 않게).
LG_CI_DIR="${LG_CI_DIR:-$HOME/.livegenie-ci}"
LG_DEFERRED="$LG_CI_DIR/deferred"
LG_SHIP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# note <글> — 기록에 찍고 실행 요약에도 남긴다
note() {
  echo "$*"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- $*" >> "$GITHUB_STEP_SUMMARY"; fi
}

# defer <무엇> <커밋> / undefer <무엇>
defer() {
  mkdir -p "$LG_DEFERRED"
  printf '%s %s\n' "$2" "$(date +%s)" > "$LG_DEFERRED/$1"
}
undefer() { rm -f "$LG_DEFERRED/$1"; }

# native_blocked <ios|android> <이름> — 방송 중이면 빌드를 미루고 0(막힘), 아니면 1 (D-RETRO-34, 복기 E15)
#   2026-11-12 방송: APK 빌드 동안 화면 일꾼의 LLM 한 번이 9.3초 → 17.6초(열에 하나 36.5초)로 느려졌다.
#   단계가 시작하는 지금 다시 묻는다 — 문지기 단계와 빌드 사이(시험·서버 배포 몇 분)에 방송이 시작됐을 수 있다.
native_blocked() {
  if [ "${FORCE_NATIVE:-no}" = yes ]; then undefer "native-$1"; return 1; fi
  # 서버 배포를 미룬 실행에서는 그 사이 방송이 끝났어도 만들지 않는다 — 새 앱이 서버보다 새 판으로 나가면 안 된다(늘 서버가 먼저)
  if [ "${SERVER_DEFERRED:-}" = yes ]; then
    defer "native-$1" "$(git rev-parse HEAD)"
    note "서버 배포를 미뤄서 $2 빌드도 미뤘어요 — 따라잡기가 서버 배포 다음에 다시 만들어요(급하면 수동 실행에서 force_native=yes)"
    return 0
  fi
  if [ "$(bash "$LG_SHIP_LIB_DIR/live-gate.sh")" = live ]; then
    defer "native-$1" "$(git rev-parse HEAD)"
    note "방송 중이라 $2 빌드를 미뤘어요 — 같은 맥 미니에서 빌드가 돌면 화면 일꾼의 상품 등록이 두 배 느려져요. 방송이 끝나면 따라잡기가 다시 내보내요(급하면 수동 실행에서 force_native=yes)"
    return 0
  fi
  undefer "native-$1"
  return 1
}

# ci_setting <이름> <기본값> — 맥 미니의 ~/.livegenie-ci/gate.env 에서 한 줄(이름=값)을 읽는다. 없으면 기본값. 파일을 실행하지 않고 글자로만 읽는다
ci_setting() {
  local v=""
  if [ -f "$LG_CI_DIR/gate.env" ]; then v=$(sed -n "s/^$1=//p" "$LG_CI_DIR/gate.env" | tail -n 1 | tr -d ' \t\r'); fi
  echo "${v:-$2}"
}

# server_mode <live|idle|unknown> <force_server: yes|no> <방송 중 할 일: defer|stage-only> → switch | stage-only | defer  (D-RETRO-37, 복기 E6)
#   방송이 없거나 확인하지 못하면 올린다(switch) — 서버가 죽었을 때 고침을 막으면 살릴 길이 없다(live-gate.sh 머리말).
#   방송 중이면: force_server=yes → 올린다 · stage-only → 대기 자리에 띄워 확인까지만 · 그 밖(모르는 값 포함) → 통째로 미룬다(지금까지와 같다).
server_mode() {
  if [ "$1" != live ] || [ "$2" = yes ]; then echo switch; return 0; fi
  if [ "$3" = stage-only ]; then echo stage-only; else echo defer; fi
}
