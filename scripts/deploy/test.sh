#!/bin/bash
# 내보내기 스크립트 시험 — 방송 중 문지기·미룸 표시·따라잡기·화면 일꾼 갱신 (D-RETRO-30~34).
#   bash scripts/deploy/test.sh        (내보내기의 "빠른 시험" 단계도 돌린다)
# 진짜 서버·깃허브·launchd에는 닿지 않는다: curl·launchctl·uv는 임시 폴더의 가짜로 바꾸고, 홈 폴더도 임시 폴더로 바꾼다.
# 맥 미니의 기본 bash(3.2)에서 돈다.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT_REPO="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

export HOME="$T/home"
export LG_CI_DIR="$HOME/.livegenie-ci"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
unset GITHUB_STEP_SUMMARY GITHUB_ENV LG_SERVER LG_SCREEN_TOKEN_FILE LG_WORKER_DIR LG_WORKER_ROOT LG_WORKER_FORCE LG_SRC_REPO GH_TOKEN
mkdir -p "$HOME" "$LG_CI_DIR" "$T/bin"
# 스크립트들은 PATH 맨 앞에 /opt/homebrew/bin 을 둔다 — 가짜가 진짜에 밀리지 않게 경로로 못 박는다(진짜 uv가 돌면 몇 GB를 내려받는다)
export LG_CURL="$T/bin/curl" LG_LAUNCHCTL="$T/bin/launchctl" LG_UV="$T/bin/uv"

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "실패: $*" >&2; }
eq() { if [ "$2" = "$3" ]; then ok; else bad "$1 — 바란 값 [$3], 나온 값 [$2]"; fi; }
has() { case "$2" in *"$3"*) ok ;; *) bad "$1 — [$3]이 없음: $2" ;; esac; }
hasnt() { case "$2" in *"$3"*) bad "$1 — [$3]이 있으면 안 됨: $2" ;; *) ok ;; esac; }

# ───────────── 1. 문지기 판단 (가짜 응답) ─────────────
GATE="$HERE/live-gate.sh"
body() { printf '%s' "$1" > "$T/body.json"; echo "$T/body.json"; }
eq "방송 하나" "$(bash "$GATE" judge 200 "$(body '{"videos":[{"videoId":"abcdefghijk"}]}')")" "live 1"
eq "방송 둘" "$(bash "$GATE" judge 200 "$(body '{"videos":[{"videoId":"abcdefghijk"},{"videoId":"ABCDEFGHIJK"}]}')")" "live 2"
eq "모양이 이상한 줄도 방송으로" "$(bash "$GATE" judge 200 "$(body '{"videos":["?"]}')")" "live 1"
eq "방송 없음" "$(bash "$GATE" judge 200 "$(body '{"videos":[]}')")" "idle"
has "JSON 아님" "$(bash "$GATE" judge 200 "$(body '<html>')")" "unknown"
has "videos가 목록 아님" "$(bash "$GATE" judge 200 "$(body '{"videos":"x"}')")" "unknown"
has "videos 없음" "$(bash "$GATE" judge 200 "$(body '{}')")" "unknown"
for status in 000 401 404 500 502 503; do
  has "HTTP $status" "$(bash "$GATE" judge "$status" "$(body '{"videos":[{"videoId":"abcdefghijk"}]}')")" "unknown"
done

# 가짜 curl: 인자를 기록하고, 표준 입력(설정)에 토큰 머리글이 왔는지 보고, FAKE_STATUS·FAKE_BODY대로 답한다
cat > "$T/bin/curl" <<'SH'
#!/bin/bash
echo "$*" >> "$FAKE_LOG"
cat > "$FAKE_STDIN"
out=
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; esac
  shift
done
[ "${FAKE_STATUS:-200}" = fail ] && exit 7
[ -n "$out" ] && printf '%s' "${FAKE_BODY:-}" > "$out"
printf '%s' "${FAKE_STATUS:-200}"
SH
chmod +x "$T/bin/curl"
export FAKE_LOG="$T/curl.log" FAKE_STDIN="$T/curl.stdin"
TOKEN=screen-worker-token-0123456789abcdef
gate() { : > "$FAKE_LOG"; : > "$FAKE_STDIN"; bash "$GATE" "$@" 2> "$T/gate.err"; }

eq "토큰 파일 없음 → unknown" "$(gate)" "unknown"
eq "토큰 파일 없으면 서버에 묻지 않음" "$(cat "$FAKE_LOG")" ""
printf '%s\n' "$TOKEN" > "$HOME/.lg_screen_token"
eq "방송 중" "$(FAKE_BODY='{"videos":[{"videoId":"abcdefghijk"}]}' gate)" "live"
FAKE_BODY='{"videos":[{"videoId":"abcdefghijk"}]}' gate > /dev/null
has "일꾼 관리자와 같은 입구" "$(cat "$FAKE_LOG")" "https://livegenie.kr/internal/screen/live"
has "토큰은 표준 입력으로" "$(cat "$FAKE_STDIN")" "Authorization: Bearer $TOKEN"
hasnt "토큰이 명령행 인자에 없음" "$(cat "$FAKE_LOG")" "$TOKEN"
hasnt "토큰이 기록에 없음" "$(cat "$T/gate.err")" "$TOKEN"
has "까닭을 표준 오류에" "$(cat "$T/gate.err")" "방송 1개 진행 중"
eq "방송 없음" "$(FAKE_BODY='{"videos":[]}' gate)" "idle"
eq "서버 오류 → unknown" "$(FAKE_STATUS=503 FAKE_BODY='' gate)" "unknown"
eq "토큰 틀림 → unknown" "$(FAKE_STATUS=401 FAKE_BODY='{"error":{}}' gate)" "unknown"
eq "서버에 못 닿음 → unknown" "$(FAKE_STATUS=fail gate)" "unknown"
printf 'has "quote\n' > "$T/badtoken"
eq "토큰 모양이 아니면 unknown" "$(LG_SCREEN_TOKEN_FILE="$T/badtoken" FAKE_BODY='{"videos":[]}' gate)" "unknown"
# gate.env 의 토큰 파일 경로·서버 주소
printf '%s\n' "$TOKEN" > "$T/other-token"
printf 'LG_SCREEN_TOKEN_FILE=%s\nLG_SERVER=https://staging.example.test/\n' "$T/other-token" > "$LG_CI_DIR/gate.env"
rm "$HOME/.lg_screen_token"
eq "gate.env 의 토큰 파일" "$(FAKE_BODY='{"videos":[]}' gate)" "idle"
FAKE_BODY='{"videos":[]}' gate > /dev/null
has "gate.env 의 서버" "$(cat "$FAKE_LOG")" "https://staging.example.test/internal/screen/live"
rm "$LG_CI_DIR/gate.env"
printf '%s\n' "$TOKEN" > "$HOME/.lg_screen_token"
# 서버 판
eq "서버 판" "$(FAKE_BODY='{"commit":"63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5","endpoints":{}}' gate commit)" "63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5"
eq "서버 판 모름" "$(FAKE_BODY='{"commit":null,"endpoints":{}}' gate commit)" ""
eq "서버 판 — 옛 서버(입구 없음)" "$(FAKE_STATUS=404 gate commit)" ""
eq "서버 판 — 이상한 값은 버림" "$(FAKE_BODY='{"commit":"$(rm -rf /)"}' gate commit)" ""

# ───────────── 2. 무엇이 바뀌었나 ─────────────
CH="$HERE/ship-changed.sh"
changed() { printf '%s\n' "$2" | bash "$CH" "$1" > /dev/null && echo yes || echo no; }
# 2026-11-12 11:12 푸시(5cddb683): 일꾼 파일만 — 서버를 다시 올리면 안 된다
eq "일꾼만 바뀐 푸시는 서버 아님" "$(changed server "$(printf 'packages/screen-worker/DECISIONS.md\npackages/screen-worker/sw/llm_live.py\npackages/screen-worker/tests/test_llm_live.py')")" no
eq "앱만" "$(changed server "apps/mobile/src/App.tsx")" no
eq "문서만" "$(changed server "$(printf 'docs/DEPLOY.md\nCLAUDE.md\napps/server/README.md')")" no
eq "워크플로·내보내기 스크립트만" "$(changed server "$(printf '.github/workflows/ship.yml\n.github/workflows/catchup.yml\nscripts/deploy/live-gate.sh\nscripts/deploy/lg-apply.sh')")" no
eq "서버 소스" "$(changed server "apps/server/src/screen/routes.ts")" yes
eq "코어" "$(changed server "packages/core/src/engine.ts")" yes
eq "웹 화면" "$(changed server "apps/web/src/main.tsx")" yes
eq "서버 배포 설정" "$(changed server "deploy/ec2/compose.yaml")" yes
eq "Dockerfile" "$(changed server "Dockerfile")" yes
eq "일꾼 + 서버" "$(changed server "$(printf 'packages/screen-worker/sw/post.py\napps/server/src/screen/routes.ts')")" yes
eq "빈 목록" "$(changed server "")" no
eq "일꾼 코드" "$(changed worker "packages/screen-worker/sw/llm_live.py")" yes
eq "일꾼 지시문" "$(changed worker "packages/screen-worker/sw/prompts/sales_instruct_system_regstt8k2.txt")" yes
eq "일꾼 의존성" "$(changed worker "packages/screen-worker/requirements.lock.txt")" yes
eq "일꾼 시험·문서만" "$(changed worker "$(printf 'packages/screen-worker/tests/test_serve.py\npackages/screen-worker/DECISIONS.md')")" no
eq "서버만" "$(changed worker "apps/server/src/screen/routes.ts")" no

# ───────────── 3. 미룸 표시 · 네이티브 빌드 막기 ─────────────
(
  cd "$ROOT_REPO" || exit 1
  # shellcheck disable=SC1091
  . "$HERE/ship-lib.sh"
  export GITHUB_STEP_SUMMARY="$T/summary.md"; : > "$GITHUB_STEP_SUMMARY"
  defer server 1111111111111111111111111111111111111111
  [ "$(cut -d' ' -f1 "$LG_DEFERRED/server")" = 1111111111111111111111111111111111111111 ] || exit 21
  undefer server; [ ! -e "$LG_DEFERRED/server" ] || exit 22
  undefer server || exit 23   # 없어도 괜찮다
  # 방송 중 → 막힘(0), 표시와 요약이 남는다
  FAKE_BODY='{"videos":[{"videoId":"abcdefghijk"}]}' native_blocked android "안드로이드 APK" > /dev/null 2>&1 || exit 24
  [ -s "$LG_DEFERRED/native-android" ] || exit 25
  grep -q "방송 중이라 안드로이드 APK 빌드를 미뤘어요" "$GITHUB_STEP_SUMMARY" || exit 26
  # 방송 중이어도 force_native=yes → 안 막힘, 표시 지움
  if FORCE_NATIVE=yes FAKE_BODY='{"videos":[{"videoId":"abcdefghijk"}]}' native_blocked android "안드로이드 APK" > /dev/null 2>&1; then exit 27; fi
  [ ! -e "$LG_DEFERRED/native-android" ] || exit 28
  # 방송 없음 → 안 막힘
  if FAKE_BODY='{"videos":[]}' native_blocked ios "아이폰 TestFlight" > /dev/null 2>&1; then exit 29; fi
  # 확인 못 함 → 안 막힘 (서버가 죽었을 때 빌드까지 막지는 않는다)
  if FAKE_STATUS=503 native_blocked ios "아이폰 TestFlight" > /dev/null 2>&1; then exit 30; fi
  # 서버 배포를 미룬 실행 → 방송이 끝났어도 막힘
  SERVER_DEFERRED=yes FAKE_BODY='{"videos":[]}' native_blocked ios "아이폰 TestFlight" > /dev/null 2>&1 || exit 31
  [ -s "$LG_DEFERRED/native-ios" ] || exit 32
  undefer native-ios
)
eq "미룸 표시·네이티브 막기" "$?" 0

# ───────────── 4. 따라잡기 ─────────────
CATCH="$HERE/mini-catchup.sh"
cat > "$T/bin/fake-gate" <<'SH'
#!/bin/bash
echo x >> "$GATE_CALLS"
cat "$GATE_STATE"
SH
cat > "$T/bin/fake-dispatch" <<'SH'
#!/bin/bash
echo "android=$1" >> "$DISPATCH_LOG"
SH
chmod +x "$T/bin/fake-gate" "$T/bin/fake-dispatch"
export GATE_STATE="$T/gate.state" GATE_CALLS="$T/gate.calls" DISPATCH_LOG="$T/dispatch.log"
D="$LG_CI_DIR/deferred"
catchup() { LG_GATE="$T/bin/fake-gate" LG_DISPATCH="$T/bin/fake-dispatch" bash "$CATCH" 2>&1; }
dispatched() { wc -l < "$DISPATCH_LOG" | tr -d ' '; }
rm -rf "$D"; mkdir -p "$D"; : > "$GATE_CALLS"; : > "$DISPATCH_LOG"; echo idle > "$GATE_STATE"
NOW=$(date +%s)

has "미룬 것 없음" "$(catchup)" "미뤄 둔 것이 없어요"
eq "미룬 것이 없으면 서버에 묻지 않음" "$(cat "$GATE_CALLS")" ""
echo "1111111111111111111111111111111111111111 $NOW" > "$D/server"
echo live > "$GATE_STATE"; echo "$((NOW - 9999))" > "$D/.idle-since"
catchup > /dev/null
eq "방송 중이면 부르지 않음" "$(dispatched)" 0
eq "방송 중이면 조용한 시간을 처음부터" "$([ -e "$D/.idle-since" ] && echo 있음 || echo 없음)" 없음
echo unknown > "$GATE_STATE"; echo "$((NOW - 9999))" > "$D/.idle-since"
catchup > /dev/null
eq "확인 못 하면 부르지 않음" "$(dispatched)" 0
echo idle > "$GATE_STATE"
has "방송이 끝난 것을 처음 봄" "$(catchup)" "처음 봤어요"
eq "처음 본 때는 부르지 않음" "$(dispatched)" 0
catchup > /dev/null
eq "10분이 안 됐으면 부르지 않음" "$(dispatched)" 0
echo "$((NOW - 700))" > "$D/.idle-since"
has "조용한 지 10분 → 부름" "$(catchup)" "다시 불렀어요"
eq "한 번 부름" "$(cat "$DISPATCH_LOG")" "android=false"
catchup > /dev/null
eq "곧바로 또 부르지 않음" "$(dispatched)" 1
# 30분 뒤에도 표시가 남아 있으면 다시(세 번까지)
read -r FP TRIES _ < "$D/.dispatched"
eq "부른 횟수" "$TRIES" 1
echo "$FP 1 $((NOW - 2000))" > "$D/.dispatched"; catchup > /dev/null
eq "30분 뒤 두 번째" "$(dispatched)" 2
echo "$FP 3 $((NOW - 2000))" > "$D/.dispatched"
has "세 번 뒤에는 사람에게" "$(catchup)" "::warning::"
eq "세 번 뒤에는 부르지 않음" "$(dispatched)" 2
# 방송이 다시 시작돼 또 미뤄지면(표시 시각이 바뀜) 새로 센다
echo "1111111111111111111111111111111111111111 $((NOW + 5))" > "$D/server"; catchup > /dev/null
eq "다시 미뤄진 표시는 새로" "$(dispatched)" 3
# 안드로이드 APK를 미뤘으면 android=true 로
echo "2222222222222222222222222222222222222222 $NOW" > "$D/native-android"; catchup > /dev/null
eq "안드로이드 포함" "$(tail -n 1 "$DISPATCH_LOG")" "android=true"
# 표시가 다 지워지면 뒷정리
rm -f "$D/server" "$D/native-android"; catchup > /dev/null
eq "뒷정리" "$(ls -A "$D")" ""

# ───────────── 5. 화면 일꾼 갱신 ─────────────
UP="$HERE/mini-worker-update.sh"
# 가짜 launchctl: 상태 파일($SVC/pid·loaded)로 흉내 낸다. KEEPALIVE=1이면 kill 때 바로 새 pid, STUCK=1이면 안 멈춘다
cat > "$T/bin/launchctl" <<'SH'
#!/bin/bash
echo "$*" >> "$SVC/log"
case "$1" in
  print)
    [ -e "$SVC/loaded" ] || exit 113
    echo "$2 = {"
    if [ -s "$SVC/pid" ]; then printf '\tstate = running\n\tpid = %s\n' "$(cat "$SVC/pid")"; else printf '\tstate = not running\n'; fi
    echo "}" ;;
  kill)
    [ "${STUCK:-}" = 1 ] && exit 0
    if [ "${KEEPALIVE:-}" = 1 ]; then echo $(( $(cat "$SVC/pid") + 1 )) > "$SVC/pid"; else : > "$SVC/pid"; fi ;;
  kickstart) [ -s "$SVC/pid" ] || echo 7001 > "$SVC/pid" ;;
esac
SH
chmod +x "$T/bin/launchctl"
export SVC="$T/svc"; mkdir -p "$SVC"
svc_reset() { : > "$SVC/log"; touch "$SVC/loaded"; echo 4242 > "$SVC/pid"; }
restarts() { grep -c '^kill SIGTERM ' "$SVC/log"; }

# 원본 저장소(내보내기 작업 폴더 구실): 진짜 일꾼 관리자 파일로 커밋 A → B(지시문 바뀜)
SRC="$T/src"; mkdir -p "$SRC/packages/screen-worker/sw/prompts" "$SRC/packages/screen-worker/tests"
cp "$ROOT_REPO/packages/screen-worker/sw/__init__.py" "$ROOT_REPO/packages/screen-worker/sw/serve.py" "$ROOT_REPO/packages/screen-worker/sw/post.py" "$SRC/packages/screen-worker/sw/"
cp "$ROOT_REPO/packages/screen-worker/requirements.lock.txt" "$ROOT_REPO/packages/screen-worker/.python-version" "$SRC/packages/screen-worker/"
echo "지시문 1" > "$SRC/packages/screen-worker/sw/prompts/p.txt"
git -C "$SRC" init -q -b main && git -C "$SRC" add -A && git -C "$SRC" commit -q -m A
A=$(git -C "$SRC" rev-parse HEAD)
git clone -q "$SRC" "$T/mini" 2> /dev/null   # 맥 미니의 ~/livegenie 구실 (A 판)
echo "지시문 2" > "$SRC/packages/screen-worker/sw/prompts/p.txt"
git -C "$SRC" commit -q -am B
B=$(git -C "$SRC" rev-parse HEAD)
MINI="$T/mini"; WD="$MINI/packages/screen-worker"
update() { LG_GATE="$T/bin/fake-gate" LG_SRC_REPO="$SRC" LG_WORKER_STOP_WAIT=2 LG_WORKER_START_WAIT=2 bash "$UP" "$@" > "$T/update.out" 2>&1; echo $?; }
mini_head() { git -C "$MINI" rev-parse HEAD; }

eq "커밋 모양이 아니면 거절" "$(LG_WORKER_DIR="$WD" update main)" 2
# — 작업 폴더 방식 —
svc_reset; echo live > "$GATE_STATE"
eq "방송 중 → 미룸(10)" "$(LG_WORKER_DIR="$WD" update "$B")" 10
eq "방송 중에는 폴더를 건드리지 않음" "$(mini_head)" "$A"
eq "방송 중에는 지시문도 그대로" "$(cat "$WD/sw/prompts/p.txt")" "지시문 1"
eq "방송 중에는 다시 켜지 않음" "$(restarts)" 0
echo unknown > "$GATE_STATE"
eq "확인 못 함 → 미룸(10)" "$(LG_WORKER_DIR="$WD" update "$B")" 10
eq "확인 못 하면 다시 켜지 않음" "$(restarts)" 0
echo idle > "$GATE_STATE"
echo "# 손으로 고침" >> "$WD/sw/serve.py"
eq "손으로 고친 변경 → 실패" "$(LG_WORKER_DIR="$WD" update "$B")" 1
has "까닭을 알림" "$(cat "$T/update.out")" "손으로 고친 변경이 있어요"
eq "손으로 고친 폴더는 건드리지 않음" "$(mini_head)" "$A"
has "손으로 고친 내용이 그대로" "$(tail -n 1 "$WD/sw/serve.py")" "손으로 고침"
eq "실패하면 다시 켜지 않음" "$(restarts)" 0
git -C "$MINI" checkout -q -- .
git -C "$MINI" checkout -q -b side
eq "main이 아닌 가지 → 실패" "$(LG_WORKER_DIR="$WD" update "$B")" 1
git -C "$MINI" checkout -q main; git -C "$MINI" branch -q -D side
rm "$SVC/loaded"
eq "서비스가 launchd에 없음 → 실패" "$(LG_WORKER_DIR="$WD" update "$B")" 1
eq "다시 켤 수 없으면 폴더도 그대로" "$(mini_head)" "$A"
svc_reset
eq "방송 없음 → 갱신(0)" "$(LG_WORKER_DIR="$WD" update "$B")" 0
has "갱신 결과" "$(tail -n 1 "$T/update.out")" "WORKER-UPDATED checkout ${B:0:12}"
eq "폴더가 그 커밋으로" "$(mini_head)" "$B"
eq "지시문도 같이" "$(cat "$WD/sw/prompts/p.txt")" "지시문 2"
eq "한 번 다시 켬" "$(restarts)" 1
eq "새 pid" "$(cat "$SVC/pid")" 7001
svc_reset
eq "이미 그 판이어도 다시 켬(KeepAlive)" "$(KEEPALIVE=1 LG_WORKER_DIR="$WD" update "$B")" 0
eq "KeepAlive가 띄운 pid" "$(cat "$SVC/pid")" 4243
svc_reset
eq "안 멈추면 실패" "$(STUCK=1 LG_WORKER_DIR="$WD" update "$B")" 1
svc_reset
eq "폴더가 더 새 판 → 건너뜀(11)" "$(LG_WORKER_DIR="$WD" update "$A")" 11
eq "더 새 판이면 다시 켜지 않음" "$(restarts)" 0
git -C "$MINI" reset -q --hard "$A"; echo x > "$MINI/local.txt"; git -C "$MINI" add local.txt; git -C "$MINI" commit -q -m "내보내지 않은 커밋"
eq "갈라짐 → 실패" "$(LG_WORKER_DIR="$WD" update "$B")" 1
has "갈라진 까닭" "$(cat "$T/update.out")" "갈라져 있어요"
git -C "$MINI" reset -q --hard "$A"
# launchd 설정에서 폴더 읽기 (맥에서만)
if command -v plutil > /dev/null 2>&1; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$HOME/Library/LaunchAgents/kr.livegenie.screen-worker.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>kr.livegenie.screen-worker</string><key>WorkingDirectory</key><string>$WD</string></dict></plist>
PLIST
  svc_reset
  eq "launchd 설정의 폴더로 갱신" "$(update "$B")" 0
  eq "launchd 설정의 폴더가 그 커밋으로" "$(mini_head)" "$B"
  rm "$HOME/Library/LaunchAgents/kr.livegenie.screen-worker.plist"
fi
eq "launchd 설정도 LG_WORKER_DIR도 없음 → 실패" "$(update "$B")" 1
# gate.env 의 일꾼 폴더 (환경에 이미 있는 값이 이긴다)
git -C "$MINI" reset -q --hard "$A"; svc_reset
printf 'LG_WORKER_DIR=%s\n' "$WD" > "$LG_CI_DIR/gate.env"
eq "gate.env 의 일꾼 폴더로 갱신" "$(update "$B")" 0
eq "gate.env 의 폴더가 그 커밋으로" "$(mini_head)" "$B"
eq "환경값이 gate.env 를 이김" "$(LG_WORKER_DIR="$T/nowhere" update "$B")" 1
rm "$LG_CI_DIR/gate.env"

# — 판 폴더 방식 —
# 가짜 uv: `uv venv <폴더>`는 시스템 python3로 잇는 가짜 묶음을 만들고, `uv pip install`은 아무것도 하지 않는다
cat > "$T/bin/uv" <<'SH'
#!/bin/bash
echo "$*" >> "$UV_LOG"
if [ "$1" = venv ]; then
  for last; do :; done
  mkdir -p "$last/bin" && printf '#!/bin/bash\nexec python3 "$@"\n' > "$last/bin/python" && chmod +x "$last/bin/python"
fi
SH
chmod +x "$T/bin/uv"
export UV_LOG="$T/uv.log"; : > "$UV_LOG"
export LG_WORKER_ROOT="$T/lgsw"
REL="$LG_WORKER_ROOT/releases"
MINI_BEFORE=$(mini_head)
svc_reset; echo live > "$GATE_STATE"
eq "처음 옮기기: --stage 는 방송 중에도 판 폴더만 만든다" "$(update --stage "$A")" 0
eq "current → A" "$(readlink "$LG_WORKER_ROOT/current")" "releases/${A:0:12}"
eq "판 번호 파일" "$(cat "$LG_WORKER_ROOT/current/RELEASE")" "$A"
eq "판 폴더의 지시문" "$(cat "$LG_WORKER_ROOT/current/sw/prompts/p.txt")" "지시문 1"
eq "판 폴더의 파이썬" "$([ -x "$LG_WORKER_ROOT/current/.venv/bin/python" ] && echo 있음)" 있음
eq "--stage 는 다시 켜지 않음" "$(restarts)" 0
eq "파이썬 묶음을 한 번 만듦" "$(grep -c '^venv ' "$UV_LOG")" 1
eq "방송 중 → 미룸(10)" "$(LG_WORKER_DIR="$LG_WORKER_ROOT/current" update "$B")" 10
eq "방송 중에는 current 그대로" "$(readlink "$LG_WORKER_ROOT/current")" "releases/${A:0:12}"
eq "방송 중에는 새 판 폴더도 만들지 않음" "$(ls "$REL" | wc -l | tr -d ' ')" 1
echo idle > "$GATE_STATE"
eq "방송 없음 → 갱신(0)" "$(LG_WORKER_DIR="$LG_WORKER_ROOT/current" update "$B")" 0
has "판 폴더 갱신 결과" "$(tail -n 1 "$T/update.out")" "WORKER-UPDATED release ${B:0:12}"
eq "current → B" "$(readlink "$LG_WORKER_ROOT/current")" "releases/${B:0:12}"
eq "코드와 지시문이 한 묶음" "$(cat "$LG_WORKER_ROOT/current/RELEASE") $(cat "$LG_WORKER_ROOT/current/sw/prompts/p.txt")" "$B 지시문 2"
eq "옛 판은 그대로 남음" "$(cat "$REL/${A:0:12}/sw/prompts/p.txt")" "지시문 1"
eq "되돌릴 판 기록" "$(cat "$LG_WORKER_ROOT/previous")" "releases/${A:0:12}"
eq "잠금 파일이 같으면 파이썬 묶음을 다시 만들지 않음" "$(grep -c '^venv ' "$UV_LOG")" 1
eq "판 폴더 방식도 한 번 다시 켬" "$(restarts)" 1
eq "저장소 작업 폴더는 건드리지 않음" "$(mini_head)" "$MINI_BEFORE"
# 새 판의 관리자가 읽히지 않으면 current를 바꾸지 않는다
echo "def broken(:" >> "$SRC/packages/screen-worker/sw/serve.py"; git -C "$SRC" commit -q -am "깨진 판"
C=$(git -C "$SRC" rev-parse HEAD)
svc_reset
eq "깨진 판 → 실패" "$(LG_WORKER_DIR="$LG_WORKER_ROOT/current" update "$C")" 1
eq "깨진 판이면 current 그대로" "$(readlink "$LG_WORKER_ROOT/current")" "releases/${B:0:12}"
eq "깨진 판이면 다시 켜지 않음" "$(restarts)" 0
eq "만들다 만 폴더를 남기지 않음" "$(ls -A "$REL" | grep -c '^\.tmp-')" 0
unset LG_WORKER_ROOT

echo "내보내기 스크립트 시험: 통과 $PASS · 실패 $FAIL"
[ "$FAIL" -eq 0 ]
