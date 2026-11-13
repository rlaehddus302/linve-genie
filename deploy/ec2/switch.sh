#!/bin/bash
# 두 자리 교대 (D-RETRO-35~39, 복기 E1~E8 · docs/DEPLOY.md 6-2절) — 운영 서버에서 root가 돌린다(lg-apply.sh·update.sh·bootstrap.sh가 부른다).
# 새 판을 대기 자리에 띄워 확인한 뒤 갈아 끼운다. 어느 단계든 실패하면 **교체하지 않고** 대기 자리를 내린다(운영 자리는 그대로).
#
#   switch.sh --commit <커밋> --build                       서버에서 이미지를 만들어 교체 (지금까지의 방식)
#   switch.sh --commit <커밋> --image-url <주소> [--image-sha256 <값>]   밖에서 만든 이미지(docker save | gzip)를 받아 와 교체
#   switch.sh --commit <커밋> --image-file <파일>            이미 서버에 있는 이미지 묶음으로 교체
#   … --stage-only          대기 자리에 띄워 확인까지만 하고 올리지 않는다(방송 중). 확인 뒤 대기 자리는 멈춰 둔다(메모리) — LG-STAGED <자리> <커밋>
#   … --keep-standby        --stage-only 뒤에도 대기 자리를 띄워 둔다
#   switch.sh --commit <커밋>                               이미지가 이미 이 서버에 있으면(앞서 --stage-only 한 판) 받거나 만들지 않고 교체
#   switch.sh --back                                        되돌리기: 바로 앞 운영 자리(멈춰 둔 컨테이너·옛 이미지)를 다시 올린다
#   switch.sh --status                                      지금 자리 상태
#
# 순서 (끝 줄에 LG-SWITCHED <자리> <커밋> · LG-STAGED <자리> <커밋> · LG-STAGE-SKIPPED <까닭> · LG-SWITCH-FAIL <단계>):
#   image    이미지를 받거나 만든다 (livegenie-app:<커밋 12자>)
#   backup   새 마이그레이션 파일이 있는 판이면 전체 백업을 먼저 한다(backup.sh). 없으면 건너뛴다 — 매일 04:00 백업이 따로 돈다 (D-RETRO-39)
#   stage    대기 자리(운영이 a면 b)에 새 이미지를 띄운다. 자리 표시 파일이 다른 자리를 가리키므로 대기로 뜬다(뒤 작업 없음). 이때 마이그레이션이 적용된다
#   health   대기 자리의 /health — 상태 standby · 자리 이름 · 판(커밋)이 맞는지
#   smoke    연습 방송 한 바퀴(node apps/server/src/commands/slot-smoke.ts — 점검용 가게의 리허설 범위만 쓴다)
#   front    앞단이 그 자리를 아는지(Caddyfile에 두 자리가 다 있는지, 앞단 컨테이너에서 그 자리에 닿는지)
#   handover 옛 자리에 SIGHUP → 뒤 작업을 멈추고 임대를 내려놓음(상태 handover). 요청은 옛 자리가 그대로 받는다 — 뒤 작업이 두 자리에서 같이 돌지 않는다
#   promote  자리 표시 파일을 새 자리로 고쳐 쓰고 새 자리에 SIGUSR2 → 상태 active (뒤 작업 시작)
#   retire   옛 자리를 내린다(docker stop → SIGTERM: 앞단이 알아챌 때까지 4초 더 받음 → 실시간 연결 닫음 → 진행 중 요청 마치고 끝)
#   verify   앞단을 지나 온 /health가 새 자리라고 답하는지. 아니면 옛 자리를 다시 올린다
#   옛 자리 컨테이너(멈춘 채)와 옛 이미지는 다음 배포까지 남긴다(--back). 그보다 오래된 이미지는 LG_KEEP_HOURS(기본 24시간)가 지나면 지운다.
#
# 처음 한 번:
#   - 자리 표시 파일도 옛 app 컨테이너도 없으면(새 서버) a 자리를 바로 운영으로 띄운다.
#   - 옛 한 자리 구성(app 컨테이너)이 돌고 있으면 "이사"를 한다: a 자리를 대기로 띄워 확인 → 올림 → 앞단을 새 설정으로 다시 켬(1~2초 끊김) → 옛 app 내림.
#
# 환경값: LG_ROOT(/opt/livegenie) · LG_FRONT_URL(기본 https://<LJ_DOMAIN>) · LG_SKIP_BACKUP=1 · LG_BACKUP_CMD · LG_SKIP_SMOKE=1(급할 때만) ·
#         LG_KEEP_HOURS(24) · LG_PROJECT(livegenie) — 내 컴퓨터 연습 환경(scripts/deploy/practice)이 바꿔 쓴다.
# 맥의 기본 bash(3.2)에서도 돈다(연습 환경·시험). 그래서 실패 처리를 ERR 처리기가 아니라 EXIT 처리기 하나로 한다 —
# bash 3.2는 errtrace(-E)를 켜면 if 조건 안에서 부른 함수의 실패에도 ERR 처리기를 부른다. 비밀값을 찍지 않는다(set -x 금지).
set -euo pipefail
# 결과 줄(LG-SWITCHED·LG-SWITCH-FAIL …)은 늘 처음의 표준 출력으로 낸다 — 표준 출력을 돌려 둔 명령(>&2) 안에서 실패해 끝나도 결과 줄이 딴 데로 가지 않게
exec 3>&1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LG_ROOT="${LG_ROOT:-/opt/livegenie}"
LG_SRC="${LG_SRC:-$LG_ROOT/src}"
SLOT_DIR="${LJ_SLOT_DIR:-$LG_ROOT/slot}"
export LJ_SLOT_DIR="$SLOT_DIR" LG_ROOT
PROJECT="${LG_PROJECT:-livegenie}"
IMAGE_REPO="${LG_IMAGE_REPO:-livegenie-app}"
KEEP_HOURS="${LG_KEEP_HOURS:-24}"
COMPOSE="$HERE/lg-compose.sh"
CADDYFILE="${LG_CADDYFILE:-$HERE/Caddyfile}"

STEP=start
TARGET=""          # 새 판을 띄우는 자리
ACTIVE=""          # 지금 운영 자리
STAGED_NEW=0       # 이번 실행이 대기 자리를 띄웠나(실패하면 내린다)
PROMOTED=0
LOCKED=0
FINISHED=0         # 결과 줄을 찍고 끝냈나(아니면 끝날 때 LG-SWITCH-FAIL)

say() { echo "$*" >&2; }
# 시험(scripts/deploy/test.sh)이 가짜로 바꿔 끼운다
docker() { command "${LG_DOCKER:-docker}" "$@"; }
curl() { command "${LG_CURL:-curl}" "$@"; }

compose() { LG_SLOTS=all "$COMPOSE" "$@"; }
other() { if [ "$1" = a ]; then echo b; else echo a; fi; }
upper() { echo "$1" | tr 'a-z' 'A-Z'; }
cid() { compose ps -aq "app-$1" 2>/dev/null | head -n1 || true; }
is_running() { [ -n "$1" ] && [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" = true ]; }

# 자리 컨테이너 안에서 /health 를 물어 "<상태> <자리> <판>" 한 줄로 (못 물으면 빈 줄)
slot_health() {
  docker exec "$1" node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((r) => r.json()).then((j) => { console.log([j.mode, j.slot, j.commit].join(' ')) }, () => process.exit(1))" 2>/dev/null || true
}

# wait_mode <컨테이너> <바라는 상태> <초> — 그 상태가 될 때까지(0.3초마다 묻는다). 컨테이너가 죽으면 바로 실패
wait_mode() {
  local i=0 line="" tries=$(($3 * 3))
  while [ "$i" -lt "$tries" ]; do
    line=$(slot_health "$1")
    if [ "${line%% *}" = "$2" ]; then echo "$line"; return 0; fi
    if ! is_running "$1"; then say "자리 컨테이너가 멈췄어요."; return 1; fi
    sleep 0.3; i=$((i + 1))
  done
  say "${3}초 안에 상태가 $2 가 되지 않았어요(마지막 답: ${line:-없음})."
  return 1
}

write_active() {
  install -d -m 0755 "$SLOT_DIR"
  printf '%s\n' "$1" > "$SLOT_DIR/.active.tmp"
  chmod 0644 "$SLOT_DIR/.active.tmp"
  mv -f "$SLOT_DIR/.active.tmp" "$SLOT_DIR/active"
}

read_active() {
  local v=""
  if [ -r "$SLOT_DIR/active" ]; then v=$(tr -d ' \t\r\n' < "$SLOT_DIR/active"); fi
  case "$v" in a | b) echo "$v" ;; *) echo "" ;; esac
}

# slots.env 의 한 줄을 바꾼다 (LG_IMAGE_A·LG_COMMIT_A·LG_IMAGE_B·LG_COMMIT_B — 비밀값 없음)
set_slot_env() {
  local f="$SLOT_DIR/slots.env"
  install -d -m 0755 "$SLOT_DIR"
  touch "$f"
  { grep -v "^$1=" "$f" || true; printf '%s=%s\n' "$1" "$2"; } > "$f.tmp"
  chmod 0644 "$f.tmp"
  mv -f "$f.tmp" "$f"
}
get_slot_env() { sed -n "s/^$1=//p" "$SLOT_DIR/slots.env" 2>/dev/null | head -n1; }

env_value() { sed -n "s/^$1=//p" "${LJ_ENV_FILE:-$LG_ROOT/.env}" 2>/dev/null | head -n1; }
front_url() {
  if [ -n "${LG_FRONT_URL:-}" ]; then echo "${LG_FRONT_URL%/}"; else echo "https://$(env_value LJ_DOMAIN)"; fi
}
# 앞단을 지나 온 /health 의 자리 이름 (못 읽으면 빈 줄)
front_slot() {
  curl -fsS --max-time 5 "$(front_url)/health" 2>/dev/null | sed -n 's/.*"slot":"\([a-z0-9-]*\)".*/\1/p' || true
}
wait_front() {
  local i=0 seen=""
  while [ "$i" -lt "$2" ]; do
    seen=$(front_slot)
    if [ "$seen" = "$1" ]; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  say "앞단이 ${2}초 안에 $1 자리로 보내지 않았어요(마지막으로 답한 자리: ${seen:-없음})."
  return 1
}

lock() {
  install -d -m 0755 "$SLOT_DIR"
  if ! mkdir "$SLOT_DIR/.lock" 2>/dev/null; then
    local pid=""
    pid=$(cat "$SLOT_DIR/.lock/pid" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then die "다른 교체가 돌고 있어요(pid $pid)."; fi
    rm -rf "$SLOT_DIR/.lock"
    mkdir "$SLOT_DIR/.lock"
  fi
  echo $$ > "$SLOT_DIR/.lock/pid"
  LOCKED=1
}
unlock() { if [ "$LOCKED" = 1 ]; then rm -rf "$SLOT_DIR/.lock"; LOCKED=0; fi; }

# 끝날 때: 결과 줄을 찍지 못하고 끝나면(어느 명령이든 실패) 실패 처리 — 올리기 전이면 이번에 띄운 대기 자리를 내린다. 운영 자리는 건드리지 않는다
on_exit() {
  local rc="$1"
  trap - EXIT
  set +e
  if [ "$FINISHED" = 1 ]; then unlock; exit "$rc"; fi
  if [ "$STAGED_NEW" = 1 ] && [ "$PROMOTED" = 0 ] && [ -n "$TARGET" ]; then
    say "실패해서 대기 자리(app-$TARGET)를 내려요. 운영 자리는 그대로예요. 대기 자리의 마지막 기록:"
    compose logs --tail 30 "app-$TARGET" >&2 2>/dev/null
    compose rm -sf "app-$TARGET" >/dev/null 2>&1
    rm -f "$SLOT_DIR/staged"
  fi
  unlock
  echo "LG-SWITCH-FAIL $STEP" >&3
  if [ "$rc" -eq 0 ]; then rc=1; fi
  exit "$rc"
}
trap 'on_exit $?' EXIT
die() { say "$*"; exit 1; }
# finish <결과 줄> — 잠금을 풀고 결과 줄을 끝 줄로 찍고 성공으로 끝낸다
finish() { FINISHED=1; unlock; echo "$1" >&3; exit 0; }

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }

get_image() { # 이미지 태그를 IMAGE에 두고, 없으면 받거나 만든다
  STEP=image
  IMAGE="$IMAGE_REPO:${COMMIT:0:12}"
  if image_exists "$IMAGE"; then say "이미지가 이미 있어요: $IMAGE"; return 0; fi
  case "$IMAGE_MODE" in
    build)
      say "서버에서 이미지를 만들어요: $IMAGE"
      docker build --pull -t "$IMAGE" -f "$LG_SRC/Dockerfile" "$LG_SRC"
      ;;
    url | file)
      local file="$IMAGE_SOURCE" tmp=""
      if [ "$IMAGE_MODE" = url ]; then
        tmp=$(mktemp "${TMPDIR:-/tmp}/lg-image.XXXXXX")
        file="$tmp"
        say "이미지를 받아 와요."
        curl -fsSL --retry 3 -o "$file" "$IMAGE_SOURCE"
      fi
      if [ -n "$IMAGE_SHA256" ]; then
        local sum=""
        if command -v sha256sum >/dev/null 2>&1; then sum=$(sha256sum "$file" | cut -d' ' -f1); else sum=$(shasum -a 256 "$file" | cut -d' ' -f1); fi
        if [ "$sum" != "$IMAGE_SHA256" ]; then rm -f "$tmp"; say "받은 이미지의 체크섬이 달라요."; return 1; fi
      fi
      gzip -dc "$file" | docker load >&2
      rm -f "$tmp"
      image_exists "$IMAGE" || { say "받은 묶음에 $IMAGE 가 없어요(밖에서 만들 때 같은 태그로 만들어야 해요)."; return 1; }
      ;;
    *)
      say "이미지 $IMAGE 가 이 서버에 없어요. --build 나 --image-url 을 주세요."
      return 1
      ;;
  esac
}

# 새 판에 아직 적용하지 않은 마이그레이션 파일이 있나 (있거나 모르면 0)
pending_migrations() {
  local want="" have=""
  want=$(docker run --rm --entrypoint sh "$1" -c 'ls apps/server/drizzle/*.sql 2>/dev/null | wc -l' 2>/dev/null | tr -d ' \r\n' || true)
  have=$(compose exec -T db psql -U livejjim -d livejjim -Atc 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null | tr -d ' \r\n' || true)
  if [[ "$want" =~ ^[0-9]+$ ]] && [[ "$have" =~ ^[0-9]+$ ]] && [ "$want" -le "$have" ]; then return 1; fi
  say "DB 변경이 있는 판이에요(이미지의 마이그레이션 ${want:-?}개, DB에 적용된 것 ${have:-?}개)."
  return 0
}

backup_if_needed() {
  STEP=backup
  if ! pending_migrations "$IMAGE"; then say "DB 변경이 없어 배포 전 백업을 건너뛰어요(매일 04:00 백업은 따로 돌아요)."; return 0; fi
  if [ "$STAGE_ONLY" = 1 ]; then
    # 방송 중에는 DB를 바꾸지 않는다: 대기 자리가 뜨면서 마이그레이션을 적용하기 때문이다(표 잠금·백업 부하)
    finish "LG-STAGE-SKIPPED migrations"
  fi
  if [ "${LG_SKIP_BACKUP:-}" = 1 ]; then say "LG_SKIP_BACKUP=1 이라 백업 없이 진행해요."; return 0; fi
  "${LG_BACKUP_CMD:-$HERE/backup.sh}"
}

stage() { # 대기 자리에 새 이미지를 띄운다
  STEP=stage
  local U
  U=$(upper "$TARGET")
  set_slot_env "LG_IMAGE_$U" "$IMAGE"
  set_slot_env "LG_COMMIT_$U" "$COMMIT"
  STAGED_NEW=1
  compose up -d --no-deps --force-recreate "app-$TARGET" >&2
}

check_health() { # <바라는 상태> — 대기 자리의 상태·자리 이름·판
  STEP=health
  local line="" tcid=""
  tcid=$(cid "$TARGET")
  [ -n "$tcid" ] || { say "app-$TARGET 컨테이너가 없어요."; return 1; }
  line=$(wait_mode "$tcid" "$1" "${LG_HEALTH_WAIT:-180}")
  # shellcheck disable=SC2086
  set -- $line
  if [ "${2:-}" != "$TARGET" ]; then say "자리 이름이 달라요(바란 값 $TARGET, 답 ${2:-없음})."; return 1; fi
  if [ "${3:-}" != "$COMMIT" ]; then say "판이 달라요(바란 값 ${COMMIT:0:12}, 답 ${3:-없음})."; return 1; fi
  say "대기 자리 확인: app-$TARGET · ${COMMIT:0:12} · ${1}"
}

smoke() {
  STEP=smoke
  if [ "${LG_SKIP_SMOKE:-}" = 1 ]; then say "LG_SKIP_SMOKE=1 이라 연습 방송 확인을 건너뛰어요."; return 0; fi
  docker exec "$(cid "$TARGET")" node apps/server/src/commands/slot-smoke.ts >&2
}

front_check() { # 앞단이 새 자리를 아는지 — 올리기 전에 본다(올린 뒤에 알면 늦다)
  STEP=front
  local caddy=""
  grep -q "app-$TARGET:3000" "$CADDYFILE" || { say "앞단 설정($CADDYFILE)에 app-$TARGET:3000 이 없어요. 두 자리를 모두 적은 Caddyfile인지 보세요(운영 서버는 Caddyfile.server-keep)."; return 1; }
  caddy=$(compose ps -q caddy 2>/dev/null | head -n1 || true)
  if [ "$LEGACY" = 1 ]; then
    # 이사: 돌고 있는 앞단은 아직 옛 설정이다. 새 설정이 읽히는지만 같은 이미지로 미리 본다(다시 켠 뒤에 틀린 걸 알면 늦다)
    local image=""
    image=$(docker inspect -f '{{.Config.Image}}' "$caddy" 2>/dev/null || true)
    [ -n "$image" ] || { say "앞단(caddy) 컨테이너가 없어요."; return 1; }
    docker run --rm -e LJ_DOMAIN=check.invalid -e LJ_OLD_DOMAINS= -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" "$image" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { say "새 앞단 설정($CADDYFILE)이 읽히지 않아요."; return 1; }
    return 0
  fi
  [ -n "$caddy" ] || { say "앞단(caddy) 컨테이너가 없어요."; return 1; }
  docker exec "$caddy" grep -q "app-$TARGET:3000" /etc/caddy/Caddyfile || { say "돌고 있는 앞단이 옛 설정이에요(app-$TARGET:3000 없음). sudo lg-compose restart caddy 뒤 다시 해 주세요."; return 1; }
  docker exec "$caddy" wget -q -T 5 -O /dev/null "http://app-$TARGET:3000/health" || { say "앞단 컨테이너에서 app-$TARGET 에 닿지 않아요."; return 1; }
}

promote() {
  local tcid="" ocid=""
  tcid=$(cid "$TARGET")
  if [ -n "$ACTIVE" ]; then ocid=$(cid "$ACTIVE"); fi
  if is_running "$ocid"; then
    # 옛 자리의 뒤 작업을 먼저 멈춘다(SIGHUP → 임대를 내려놓고 "넘기는 중") — 요청은 옛 자리가 그대로 받는다. 뒤 작업이 두 자리에서 같이 돌지 않는다
    STEP=handover
    if ! docker kill -s HUP "$ocid" >/dev/null || ! wait_mode "$ocid" handover 60 >/dev/null; then
      say "옛 자리가 뒤 작업을 넘기지 못했어요. 옛 자리를 다시 켜서 뒤 작업을 되살려요(몇 초 동안 요청이 앞단에서 기다려요)."
      docker restart -t 45 "$ocid" >/dev/null 2>&1 || true
      return 1
    fi
  fi
  STEP=promote
  # 파일을 먼저 고친다: 올린 자리가 죽었다 살아나도 운영으로 뜨게
  write_active "$TARGET"
  if ! docker kill -s USR2 "$tcid" >/dev/null || ! wait_mode "$tcid" active 30 >/dev/null; then
    if [ -n "$ACTIVE" ]; then write_active "$ACTIVE"; else rm -f "$SLOT_DIR/active"; fi
    if is_running "$ocid"; then
      say "새 자리를 올리지 못했어요. 옛 자리를 다시 켜서 뒤 작업을 되살려요(몇 초 동안 요청이 앞단에서 기다려요)."
      docker restart -t 45 "$ocid" >/dev/null 2>&1 || true
    fi
    return 1
  fi
  PROMOTED=1
  say "올렸어요: app-$TARGET 가 운영이에요."
}

# 올린 뒤 실패: 옛 자리를 다시 올리고 새 자리를 내린다
revert() {
  say "옛 자리(app-$ACTIVE)를 다시 올려요."
  set +e
  write_active "$ACTIVE"
  local ocid=""
  ocid=$(cid "$ACTIVE")
  docker start "$ocid" >/dev/null 2>&1
  wait_mode "$ocid" active 60 >/dev/null
  docker stop -t 45 "$(cid "$TARGET")" >/dev/null 2>&1
  set -e
}

retire_old() {
  STEP=retire
  local ocid=""
  ocid=$(cid "$ACTIVE")
  if is_running "$ocid"; then docker stop -t 45 "$ocid" >/dev/null; fi
  STEP=verify
  if ! wait_front "$TARGET" "${LG_FRONT_WAIT:-60}"; then revert; return 1; fi
  printf '%s %s %s %s\n' "$ACTIVE" "$(get_slot_env "LG_COMMIT_$(upper "$ACTIVE")")" "$(get_slot_env "LG_IMAGE_$(upper "$ACTIVE")")" "$(date +%s)" > "$SLOT_DIR/previous"
}

cleanup_images() {
  rm -f "$SLOT_DIR/staged"
  # 어느 컨테이너도(멈춘 것 포함) 쓰지 않는, 만든 지 KEEP_HOURS 지난 앱 이미지만 지운다 — 바로 앞 판은 멈춘 옛 자리가 붙들고 있어 남는다
  docker image prune -af --filter "label=kr.livegenie.app=1" --filter "until=${KEEP_HOURS}h" >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
}

legacy_cid() { docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=app" 2>/dev/null | head -n1 || true; }

status() {
  local s="" c="" line=""
  echo "운영 자리: $(read_active || true)"
  for s in a b; do
    c=$(cid "$s")
    if is_running "$c"; then line=$(slot_health "$c"); else line="(떠 있지 않음)"; fi
    echo "app-$s: ${line:-답 없음} · 이미지 $(get_slot_env "LG_IMAGE_$(upper "$s")")"
  done
  if [ -s "$SLOT_DIR/staged" ]; then echo "띄워 확인만 해 둔 판: $(cat "$SLOT_DIR/staged")"; fi
  if [ -s "$SLOT_DIR/previous" ]; then echo "되돌릴 수 있는 판: $(cat "$SLOT_DIR/previous")"; fi
  echo "앞단이 보내는 자리: $(front_slot)"
}

# ───────── 인자 ─────────
COMMIT=""; IMAGE=""; IMAGE_MODE=""; IMAGE_SOURCE=""; IMAGE_SHA256=""; STAGE_ONLY=0; KEEP_STANDBY=0; BACK=0; LEGACY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="${2:-}"; shift ;;
    --build) IMAGE_MODE=build ;;
    --image-url) IMAGE_MODE=url; IMAGE_SOURCE="${2:-}"; shift ;;
    --image-file) IMAGE_MODE=file; IMAGE_SOURCE="${2:-}"; shift ;;
    --image-sha256) IMAGE_SHA256="${2:-}"; shift ;;
    --stage-only) STAGE_ONLY=1 ;;
    --keep-standby) KEEP_STANDBY=1 ;;
    --back) BACK=1 ;;
    --status) status; FINISHED=1; exit 0 ;;
    *) say "모르는 인자예요: $1 (쓰는 법은 이 파일 머리말)"; STEP=args; exit 2 ;;
  esac
  shift
done

STEP=args
lock
ACTIVE=$(read_active)

if [ "$BACK" = 1 ]; then
  # ───────── 되돌리기 ─────────
  [ -n "$ACTIVE" ] || die "운영 자리를 몰라 되돌릴 수 없어요."
  [ -s "$SLOT_DIR/previous" ] || die "되돌릴 판 기록($SLOT_DIR/previous)이 없어요."
  read -r PREV_SLOT PREV_COMMIT PREV_IMAGE _ < "$SLOT_DIR/previous"
  [ "$PREV_SLOT" = "$(other "$ACTIVE")" ] || die "되돌릴 판 기록의 자리($PREV_SLOT)가 지금 대기 자리와 달라요."
  TARGET="$PREV_SLOT"; COMMIT="$PREV_COMMIT"; IMAGE="$PREV_IMAGE"
  image_exists "$IMAGE" || die "옛 이미지($IMAGE)가 지워져 되돌릴 수 없어요. 그 커밋을 다시 배포해 주세요."
  STEP=stage
  TCID=$(cid "$TARGET")
  STAGED_NEW=1
  if [ -n "$TCID" ] && [ "$(docker inspect -f '{{.Config.Image}}' "$TCID" 2>/dev/null || true)" = "$IMAGE" ]; then
    is_running "$TCID" || docker start "$TCID" >/dev/null
  else
    compose up -d --no-deps --force-recreate "app-$TARGET" >&2
  fi
  check_health standby
  smoke
  front_check
  promote
  retire_old
  STEP=cleanup
  rm -f "$SLOT_DIR/staged"
  finish "LG-SWITCHED $TARGET $COMMIT"
fi

[[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || die "--commit <커밋>이 필요해요."
get_image

if [ -z "$ACTIVE" ]; then
  LEGACY_CID=$(legacy_cid)
  if [ -z "$LEGACY_CID" ]; then
    # ───────── 새 서버: a 자리를 바로 운영으로 ─────────
    TARGET=a
    [ "$STAGE_ONLY" = 0 ] || die "처음 설치에는 --stage-only 를 쓸 수 없어요."
    STEP=stage
    set_slot_env LG_IMAGE_A "$IMAGE"
    set_slot_env LG_COMMIT_A "$COMMIT"
    write_active a
    STAGED_NEW=1; PROMOTED=1
    LG_SLOTS=a "$COMPOSE" up -d db caddy app-a >&2
    check_health active
    STEP=verify
    wait_front a "${LG_FRONT_WAIT_FIRST:-1200}"
    finish "LG-SWITCHED a $COMMIT"
  fi
  # ───────── 이사: 옛 한 자리(app) → 두 자리 ─────────
  LEGACY=1
  TARGET=a
  say "옛 한 자리 구성(app 컨테이너)을 두 자리로 옮겨요."
  backup_if_needed
  stage
  check_health standby
  smoke
  front_check
  if [ "$STAGE_ONLY" = 1 ]; then die "이사는 --stage-only 로 하지 않아요(방송이 없을 때 한 번에)."; fi
  promote
  STEP=front-restart
  # 앞단을 두 자리 설정으로 다시 켠다 — 여기서 1~2초 연결이 끊긴다(이사 때 한 번뿐)
  LG_SLOTS=a "$COMPOSE" up -d --no-deps --force-recreate caddy >&2
  STEP=verify
  if ! wait_front a "${LG_FRONT_WAIT:-60}"; then
    say "앞단이 새 자리로 보내지 않아요. 옛 app 컨테이너는 그대로 떠 있어요 — 앞단 설정을 옛 것으로 되돌리려면 Caddyfile을 고친 뒤 sudo lg-compose restart caddy."
    false
  fi
  STEP=retire
  docker stop -t 30 "$LEGACY_CID" >/dev/null
  cleanup_images
  say "이사를 마쳤어요. 옛 app 컨테이너($LEGACY_CID)는 멈춘 채 남겨 뒀어요 — 문제가 없으면 docker rm $LEGACY_CID"
  finish "LG-SWITCHED a $COMMIT"
fi

# ───────── 평소: 대기 자리에 띄워 확인 → 올리기 → 옛 자리 내리기 ─────────
TARGET=$(other "$ACTIVE")
TCID=$(cid "$TARGET")
T_COMMIT=$(get_slot_env "LG_COMMIT_$(upper "$TARGET")")
if [ -n "$TCID" ] && [ "$T_COMMIT" = "$COMMIT" ] && [ -s "$SLOT_DIR/staged" ] && [ "$(cut -d' ' -f2 "$SLOT_DIR/staged")" = "$COMMIT" ]; then
  # 앞서 --stage-only 로 띄워 확인해 둔 판 — 다시 만들지 않는다(마이그레이션도 그때 적용됐다)
  say "앞서 띄워 확인해 둔 판이에요(app-$TARGET · ${COMMIT:0:12})."
  STEP=stage
  STAGED_NEW=1
  is_running "$TCID" || docker start "$TCID" >/dev/null
else
  backup_if_needed
  stage
fi
check_health standby
smoke
front_check

if [ "$STAGE_ONLY" = 1 ]; then
  STEP=stage-only
  printf '%s %s %s\n' "$TARGET" "$COMMIT" "$(date +%s)" > "$SLOT_DIR/staged"
  if [ "$KEEP_STANDBY" = 0 ]; then docker stop -t 45 "$(cid "$TARGET")" >/dev/null; fi
  finish "LG-STAGED $TARGET $COMMIT"
fi

promote
retire_old
STEP=cleanup
cleanup_images
finish "LG-SWITCHED $TARGET $COMMIT"
