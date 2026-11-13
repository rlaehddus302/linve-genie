#!/bin/bash
# 두 자리 교대 연습 환경 (D-RETRO-35~39, docs/DEPLOY.md 6-2절) — **내 컴퓨터의 도커에서만** 돈다. 운영 서버·AWS에 닿지 않는다.
# 운영과 같은 compose(deploy/ec2/compose.yaml)·앞단(Caddyfile)·교체 스크립트(switch.sh)를 이름과 포트만 바꿔 띄우고,
# 교체하는 동안 요청이 실패하는지·실시간 연결이 얼마 만에 다시 붙는지·쓰기가 유실·중복되는지를 잰다(measure.mjs).
#
#   bash scripts/deploy/practice/practice.sh all        처음부터 끝까지: 이미지 만들기 → 지금 방식 3번 → 이사 → 두 자리 교대 3번 → 되돌리기 → 표 → 치우기
#   bash scripts/deploy/practice/practice.sh <걸음>     init · build · legacy-up · account · run-old · migrate · run-new · back · report · status · down
#
# 다른 점(운영 대비): 주소는 http://localhost:18080 (인증서 없음 — 서버의 "앱 주소는 https" 검사는 내 컴퓨터 시험 규칙대로 http://localhost 만 통과한다, DEPLOY.md 1절),
#   프로젝트 이름 lg-practice, DB는 연습용 볼륨, 유튜브 읽기·방송 소리·요금은 끔, 백업은 하지 않는다(S3에 올리지 않게 가짜 백업 명령).
#   비밀값(마스터 키·DB 비밀번호·일꾼 토큰)은 그때 무작위로 만들어 .practice-slots/.env 에만 둔다(저장소에 들어가지 않는다 — .gitignore).
# "지금 방식"은 main의 한 자리 compose(app 하나, reverse_proxy app:3000)를 같은 이미지로 띄워 `up -d --force-recreate app` 으로 잰다
#   (이미지가 바뀐 배포에서 compose가 하는 일과 같다: 멈추고 → 새로 띄움).
#
# 이 맥 미니에서 화면 일꾼이 방송을 보고 있으면 돌지 않는다(이미지 빌드가 CPU를 몇 분 쓴다, D-RETRO-34). 그래도 돌리려면 LG_PRACTICE_FORCE=1.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
P="${LG_PRACTICE_ROOT:-$REPO/.practice-slots}"
PORT_HTTP="${LG_PRACTICE_PORT:-18080}"
BASE="http://localhost:$PORT_HTTP"
export LG_ROOT="$P" LG_SRC="$REPO" LG_PROJECT=lg-practice LG_FRONT_URL="$BASE"
export LJ_HTTP_PORT="$PORT_HTTP" LJ_HTTPS_PORT="${LG_PRACTICE_TLS_PORT:-18443}"
export LJ_ENV_FILE="$P/.env" LJ_SLOT_DIR="$P/slot" LJ_APP_BACKUP_DIR="$P/backups/app" LJ_APP_SECRETS_DIR="$P/secrets" LJ_APP_UPDATES_DIR="$P/app-updates"
export LG_COMPOSE_FILE="$REPO/deploy/ec2/compose.yaml" LG_BACKUP_CMD="$P/no-backup.sh"
SWITCH="$REPO/deploy/ec2/switch.sh"
COMPOSE="$REPO/deploy/ec2/lg-compose.sh"
R="$P/results"
PAUSE="${LG_PRACTICE_PAUSE:-15}"   # 교체와 교체 사이에 재는 시간(초)

say() { echo "== $*"; }
die() { echo "연습 환경: $*" >&2; exit 1; }
rand() { node -e "console.log(require('node:crypto').randomBytes($1).toString('$2'))"; }

guard() {
  if [ "${LG_PRACTICE_FORCE:-}" != 1 ] && pgrep -f "python -m sw https://" > /dev/null 2>&1; then
    die "화면 일꾼이 방송을 보고 있어요. 방송이 끝난 뒤에 돌려 주세요(그래도 돌리려면 LG_PRACTICE_FORCE=1)."
  fi
  docker info > /dev/null 2>&1 || die "도커가 꺼져 있어요(OrbStack을 켜 주세요: open -a OrbStack)."
}

# 연습에 쓸 판(커밋) 넷: 진짜 HEAD 하나와, 같은 이미지에 태그만 다르게 붙인 셋(첫 글자만 바꾼다 — 태그는 앞 12자라 서로 달라진다)
commits() {
  local head first c
  head=$(git -C "$REPO" rev-parse HEAD)
  first=${head:0:1}
  C0="$head"
  CS=()
  for c in 0 1 2 3 4; do
    [ "$c" = "$first" ] && continue
    CS+=("$c${head:1}")
    [ "${#CS[@]}" -ge 3 ] && break
  done
}
tag_of() { echo "livegenie-app:${1:0:12}"; }

cmd_init() {
  mkdir -p "$P/slot" "$P/backups/app" "$P/secrets" "$P/app-updates" "$R" "$P/legacy"
  chmod 0755 "$P/slot"
  if [ ! -f "$P/.env" ]; then
    local dbpw
    dbpw=$(rand 24 hex)
    umask 077
    cat > "$P/.env" <<EOF
LJ_DOMAIN=:80
LJ_BACKUP_BUCKET=
LJ_DB_PASSWORD=$dbpw
DATABASE_URL=postgres://livejjim:$dbpw@db:5432/livejjim
LIVEJJIM_MASTER_KEY=$(rand 32 base64)
LIVEJJIM_APP_ORIGIN=$BASE
LIVEJJIM_TRUSTED_PROXIES=1
LIVEJJIM_BACKUP_DIR=/backups
LIVEJJIM_TRANSCRIBE_WORKER_TOKEN=$(rand 32 base64url)
LIVEJJIM_YT_WEB_CHAT=off
LIVEJJIM_STREAM_AUDIO=off
LIVEJJIM_BILLING=off
EOF
    umask 022
  fi
  sed -n 's/^LIVEJJIM_TRANSCRIBE_WORKER_TOKEN=//p' "$P/.env" > "$P/worker-token"
  chmod 600 "$P/worker-token"
  printf '#!/bin/bash\necho "연습 환경: 백업은 하지 않아요"\n' > "$P/no-backup.sh"
  chmod +x "$P/no-backup.sh"
}

cmd_build() {
  guard
  commits
  say "이미지 만들기 $(tag_of "$C0") (몇 분 걸려요)"
  local started
  started=$(date +%s)
  docker build -t "$(tag_of "$C0")" -f "$REPO/Dockerfile" "$REPO"
  echo "이미지 빌드 $(($(date +%s) - started))초" | tee "$R/build.txt"
  docker image inspect -f '이미지 크기 {{.Size}} 바이트' "$(tag_of "$C0")" | tee -a "$R/build.txt"
  local c
  for c in "${CS[@]}"; do docker tag "$(tag_of "$C0")" "$(tag_of "$c")"; done
}

# 옛 한 자리 구성: main의 compose·Caddyfile을 포트만 바꿔 쓴다
legacy_compose() {
  docker compose --project-name "$LG_PROJECT" --env-file "$P/.env" -f "$P/legacy/compose.yaml" "$@"
}
cmd_legacy_up() {
  guard
  commits
  # 이미지 이름은 이번에 만든 태그로 바꾼다 — 이 컴퓨터에 이미 있을 수 있는 livegenie-app:local 을 덮어쓰지 않는다
  git -C "$REPO" show origin/main:deploy/ec2/compose.yaml \
    | sed -e '/^    build:$/d' -e '/^      context: \.\.\/\.\.$/d' -e '/^      dockerfile: Dockerfile$/d' \
          -e "s/image: livegenie-app:local/image: $(tag_of "$C0")/" \
          -e "s/\"80:80\"/\"$LJ_HTTP_PORT:80\"/" -e "s/\"443:443\"/\"$LJ_HTTPS_PORT:443\"/" -e "s/\"443:443\\/udp\"/\"$LJ_HTTPS_PORT:443\\/udp\"/" \
    > "$P/legacy/compose.yaml"
  git -C "$REPO" show origin/main:deploy/ec2/Caddyfile > "$P/legacy/Caddyfile"
  grep -q 'reverse_proxy app:3000' "$P/legacy/Caddyfile" || die "main의 Caddyfile이 한 자리 구성이 아니에요."
  say "옛 한 자리 구성 띄우기 (app 하나)"
  legacy_compose up -d --no-build
  wait_front
}

wait_front() {
  local i
  for i in $(seq 1 120); do
    if curl -fsS -o /dev/null --max-time 3 "$BASE/health"; then return 0; fi
    sleep 1
  done
  die "$BASE/health 에 닿지 않아요."
}

# 지금 요청을 받는 앱 컨테이너 (옛 app 또는 운영 자리)
app_cid() {
  local c=""
  if [ -s "$P/slot/active" ]; then c=$(LG_SLOTS=all "$COMPOSE" ps -q "app-$(tr -d ' \n' < "$P/slot/active")" 2>/dev/null | head -n1 || true); fi
  if [ -z "$c" ]; then c=$(docker ps -q --filter "label=com.docker.compose.project=$LG_PROJECT" --filter "label=com.docker.compose.service=app" | head -n1 || true); fi
  echo "$c"
}

# 계정 만들고 로그인까지 (쿠키를 $P/cookie 에)
make_account() {
  local c pw login
  c=$(app_cid)
  [ -n "$c" ] || die "앱 컨테이너가 없어요."
  pw=$(rand 12 base64url)
  login="practice$(date +%s)"
  printf '%s\n' "$pw" | docker exec -i "$c" node apps/server/src/commands/create-account.ts --name 연습가게 --login "$login" > /dev/null
  curl -sS -D "$P/login.headers" -o /dev/null -X POST "$BASE/api/login" -H "Origin: $BASE" -H 'Content-Type: application/json' \
    -d "{\"loginId\":\"$login\",\"password\":\"$pw\"}"
  sed -n 's/^[Ss]et-[Cc]ookie: \(lj_session=[^;]*\).*/\1/p' "$P/login.headers" | tr -d '\r' > "$P/cookie"
  rm -f "$P/login.headers"
  [ -s "$P/cookie" ] || die "로그인하지 못했어요."
  chmod 600 "$P/cookie"
  say "연습 계정 $login 로그인"
}

MEASURE_PID=""
STATS_PID=""
measure_start() { # <이름표> <결과 파일>
  node "$HERE/measure.mjs" --base "$BASE" --cookie-file "$P/cookie" --worker-token-file "$P/worker-token" --out "$R/$2" --label "$1" &
  MEASURE_PID=$!
  ( while :; do docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null | grep "^$LG_PROJECT-" >> "$R/${2%.json}.mem" || true; sleep 2; done ) &
  STATS_PID=$!
  sleep "${LG_PRACTICE_WARM:-8}"
}
measure_stop() {
  sleep "$PAUSE"
  { kill "$STATS_PID" && wait "$STATS_PID"; } 2>/dev/null || true
  kill -INT "$MEASURE_PID"
  wait "$MEASURE_PID" || true
}

cmd_run_old() {
  guard
  [ -s "$P/cookie" ] || make_account
  measure_start "지금 방식: 그 자리에서 다시 켜기 3번" old.json
  local i t
  for i in 1 2 3; do
    t=$(date +%s)
    say "지금 방식 $i/3: up -d --force-recreate app"
    legacy_compose up -d --no-build --force-recreate app > /dev/null 2>&1
    wait_front
    echo "지금 방식 $i: $(($(date +%s) - t))초" | tee -a "$R/old.times"
    [ "$i" = 3 ] || sleep "$PAUSE"
  done
  measure_stop
}

cmd_migrate() {
  guard
  commits
  [ -s "$P/cookie" ] || make_account
  measure_start "이사: 한 자리 → 두 자리 (한 번)" migrate.json
  say "이사: switch.sh --commit ${C0:0:12}"
  local t
  t=$(date +%s)
  "$SWITCH" --commit "$C0" | tee "$R/migrate.out"
  echo "이사: $(($(date +%s) - t))초" | tee "$R/migrate.times"
  measure_stop
}

cmd_run_new() {
  guard
  commits
  [ -s "$P/slot/active" ] || die "먼저 이사(migrate)를 하거나 switch.sh로 첫 자리를 띄워 주세요."
  [ -s "$P/cookie" ] || make_account
  measure_start "두 자리 교대 3번" new.json
  local i t
  for i in 1 2 3; do
    t=$(date +%s)
    say "두 자리 교대 $i/3: switch.sh --commit ${CS[$((i - 1))]:0:12}"
    "$SWITCH" --commit "${CS[$((i - 1))]}" | tee -a "$R/new.out"
    echo "두 자리 교대 $i: $(($(date +%s) - t))초" | tee -a "$R/new.times"
    [ "$i" = 3 ] || sleep "$PAUSE"
  done
  measure_stop
}

cmd_back() {
  guard
  [ -s "$P/cookie" ] || make_account
  measure_start "되돌리기 (switch.sh --back) 한 번" back.json
  local t
  t=$(date +%s)
  "$SWITCH" --back | tee "$R/back.out"
  echo "되돌리기: $(($(date +%s) - t))초" | tee "$R/back.times"
  measure_stop
}

cmd_report() { node "$HERE/report.mjs" "$R"; }
cmd_status() { "$SWITCH" --status || true; docker ps --filter "label=com.docker.compose.project=$LG_PROJECT" --format '{{.Names}}\t{{.Status}}\t{{.Image}}'; }

cmd_down() {
  # 연습 프로젝트의 컨테이너·볼륨·망만 지운다(이름표로 고른다). 이미지는 남긴다 — 지우려면: docker image prune -af --filter label=kr.livegenie.app=1
  local ids
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$LG_PROJECT" || true)
  if [ -n "$ids" ]; then echo "$ids" | xargs docker rm -f > /dev/null; fi
  ids=$(docker volume ls -q --filter "label=com.docker.compose.project=$LG_PROJECT" || true)
  if [ -n "$ids" ]; then echo "$ids" | xargs docker volume rm > /dev/null 2>&1 || true; fi
  ids=$(docker network ls -q --filter "label=com.docker.compose.project=$LG_PROJECT" || true)
  if [ -n "$ids" ]; then echo "$ids" | xargs docker network rm > /dev/null 2>&1 || true; fi
  # 결과(results)는 남기고 비밀값이 든 것만 지운다
  rm -rf "$P/.env" "$P/cookie" "$P/worker-token" "$P/slot" "$P/backups" "$P/legacy" "$P/secrets" "$P/app-updates" "$P/no-backup.sh"
  say "치웠어요. 결과는 $R 에 있어요."
}

cmd_all() {
  guard
  cmd_down > /dev/null 2>&1 || true
  rm -rf "$R"
  cmd_init
  cmd_build
  cmd_legacy_up
  make_account
  cmd_run_old
  cmd_migrate
  cmd_run_new
  cmd_back
  cmd_report | tee "$R/report.md"
  cmd_down
}

case "${1:-}" in
  init) cmd_init ;;
  build) cmd_init; cmd_build ;;
  legacy-up) cmd_init; cmd_legacy_up ;;
  account) make_account ;;
  run-old) cmd_run_old ;;
  migrate) cmd_migrate ;;
  run-new) cmd_run_new ;;
  back) cmd_back ;;
  report) cmd_report ;;
  status) cmd_status ;;
  down) cmd_down ;;
  all) cmd_all ;;
  *) echo "쓰는 법: practice.sh all | init | build | legacy-up | account | run-old | migrate | run-new | back | report | status | down" >&2; exit 2 ;;
esac
