#!/bin/bash
# 내보내기 스크립트 시험 — 방송 중 문지기·미룸 표시·따라잡기·화면 일꾼 갱신 (D-RETRO-30~34), 두 자리 교대·DB 변경 규칙 (D-RETRO-35~39).
#   bash scripts/deploy/test.sh        (내보내기의 "빠른 시험" 단계도 돌린다)
# 진짜 서버·깃허브·launchd·도커에는 닿지 않는다: curl·launchctl·uv·docker는 임시 폴더의 가짜로 바꾸고, 홈 폴더도 임시 폴더로 바꾼다.
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

# ───────────── 6. 방송 중 서버 단계 고르기 (D-RETRO-37) ─────────────
(
  # shellcheck disable=SC1091
  . "$HERE/ship-lib.sh"
  [ "$(server_mode idle no defer)" = switch ] || exit 41
  [ "$(server_mode idle no stage-only)" = switch ] || exit 42
  [ "$(server_mode unknown no defer)" = switch ] || exit 43      # 확인 못 하면 올린다(서버가 죽었을 때 고침을 막지 않는다)
  [ "$(server_mode live no defer)" = defer ] || exit 44          # 기본: 지금까지처럼 통째로 미룸
  [ "$(server_mode live no stage-only)" = stage-only ] || exit 45
  [ "$(server_mode live yes defer)" = switch ] || exit 46        # force_server=yes
  [ "$(server_mode live yes stage-only)" = switch ] || exit 47
  [ "$(server_mode live no '')" = defer ] || exit 48             # 모르는 값은 미룸
  [ "$(server_mode live no switch)" = defer ] || exit 49         # 설정으로는 방송 중에 올릴 수 없다(force_server만)
  [ "$(ci_setting LG_LIVE_SERVER defer)" = defer ] || exit 50    # gate.env 없음
  printf 'LG_SCREEN_TOKEN_FILE=/x\nLG_LIVE_SERVER=stage-only\nLG_IMAGE_FROM= mini \n' > "$LG_CI_DIR/gate.env"
  [ "$(ci_setting LG_LIVE_SERVER defer)" = stage-only ] || exit 51
  [ "$(ci_setting LG_IMAGE_FROM server)" = mini ] || exit 52
  [ "$(ci_setting LG_NOPE fallback)" = fallback ] || exit 53
  rm "$LG_CI_DIR/gate.env"
)
eq "방송 중 서버 단계 고르기" "$?" 0

# ───────────── 7. DB 변경 규칙 검사 (D-RETRO-38) ─────────────
MIG="$HERE/check-migrations.sh"
M="$T/mig"; mkdir -p "$M"
mig() { rm -f "$M"/0056_*.sql; printf '%s\n' "$1" > "$M/0056_new.sql"; bash "$MIG" "$M" 55 > "$T/mig.out" 2>&1; echo $?; }
# 기준(0055)까지는 무엇이 들어 있어도 보지 않는다 — 이미 운영에 적용된 것
printf 'DROP TABLE old_things;\nALTER TABLE a RENAME TO b;\n' > "$M/0055_old.sql"
eq "저장소의 마이그레이션은 통과" "$(bash "$MIG" > /dev/null 2>&1; echo $?)" 0
eq "새 파일 없음 → 통과" "$(bash "$MIG" "$M" 55 > /dev/null 2>&1; echo $?)" 0
eq "열 더하기" "$(mig 'ALTER TABLE "print_attempts" ADD COLUMN IF NOT EXISTS "fail_reason" text;--> statement-breakpoint
ALTER TABLE "print_attempts" ADD COLUMN "tries" integer NOT NULL DEFAULT 0;')" 0
eq "표·색인 더하기" "$(mig 'CREATE TABLE things (id bigserial PRIMARY KEY, seller_id text NOT NULL REFERENCES sellers(id), code text NOT NULL UNIQUE);
--> statement-breakpoint
CREATE UNIQUE INDEX things_uq ON things (seller_id, code);
CREATE INDEX IF NOT EXISTS events_new_idx ON events (seller_id);
ALTER TABLE things ADD CONSTRAINT things_code_ck CHECK (code <> $$$$);')" 0
eq "조건 풀기(DROP NOT NULL)는 통과" "$(mig 'ALTER TABLE things ALTER COLUMN note DROP NOT NULL;')" 0
eq "주석·글자 속 낱말은 보지 않음" "$(mig "-- DROP TABLE 은 다음 판에서
/* RENAME COLUMN a TO b */
INSERT INTO notes (body) VALUES ('please DROP this; TRUNCATE that');")" 0
eq "표 지우기" "$(mig 'DROP TABLE live_catalog_members;')" 1
has "까닭과 파일 이름" "$(cat "$T/mig.out")" "실패 0056_new.sql: 지워요(DROP)"
eq "열 지우기" "$(mig 'ALTER TABLE sellers DROP COLUMN IF EXISTS "old_name";')" 1
eq "색인 지우기" "$(mig 'DROP INDEX "live_links_open_uq";')" 1
eq "기본값 지우기" "$(mig 'ALTER TABLE sellers ALTER COLUMN settings DROP DEFAULT;')" 1
eq "이름 바꾸기" "$(mig 'ALTER TABLE sellers RENAME COLUMN name TO shop_name;')" 1
eq "표 이름 바꾸기" "$(mig 'ALTER TABLE "sellers" RENAME TO "shops";')" 1
eq "있던 열을 NOT NULL로" "$(mig 'ALTER TABLE sellers ALTER COLUMN phone SET NOT NULL;')" 1
eq "기본값 없는 NOT NULL 열" "$(mig 'ALTER TABLE sellers ADD COLUMN level integer NOT NULL;')" 1
eq "열 종류 바꾸기" "$(mig 'ALTER TABLE events ALTER COLUMN seq TYPE bigint;')" 1
eq "열 종류 바꾸기(SET DATA TYPE)" "$(mig 'ALTER TABLE events ALTER COLUMN "seq" SET DATA TYPE bigint;')" 1
eq "있던 표에 겹침 금지 색인" "$(mig 'CREATE UNIQUE INDEX IF NOT EXISTS "accounts_phone_uq" ON "accounts" USING btree ("phone_hash");')" 1
eq "있던 표에 제약" "$(mig 'ALTER TABLE "outbox" ADD CONSTRAINT "outbox_x_uq" UNIQUE("seller_id","x");')" 1
eq "있던 표에 CHECK 제약" "$(mig 'ALTER TABLE outbox ADD CONSTRAINT outbox_ck CHECK (tries >= 0);')" 1
eq "기록 지우기" "$(mig 'DELETE FROM sessions WHERE expires_at < now();')" 1
eq "TRUNCATE" "$(mig 'TRUNCATE login_limits;')" 1
eq "여러 문장 가운데 하나만 나빠도 실패" "$(mig 'ALTER TABLE a ADD COLUMN b text;--> statement-breakpoint
ALTER TABLE a DROP COLUMN c;')" 1
eq "허락 줄이 있으면 넘김" "$(mig '-- lg:breaking-ok D-RETRO-99 옛 판(커밋 abcdef12)은 운영에서 완전히 내려갔고 이 표를 쓰는 코드가 없다
DROP TABLE live_catalog_members;')" 0
has "넘긴 것을 알림" "$(cat "$T/mig.out")" "되돌리기로 옛 판을 올릴 수 없어요"
eq "결정 번호 없는 허락 줄은 안 됨" "$(mig '-- lg:breaking-ok 그냥 지움
DROP TABLE live_catalog_members;')" 1
eq "까닭 없는 허락 줄은 안 됨" "$(mig '-- lg:breaking-ok D-RETRO-99
DROP TABLE live_catalog_members;')" 1
rm -f "$M"/0056_*.sql; echo 'select 1;' > "$M/new_table.sql"
eq "번호 없는 파일 이름은 실패(검사를 비켜 가지 못하게)" "$(bash "$MIG" "$M" 55 > /dev/null 2>&1; echo $?)" 1
rm -f "$M/new_table.sql"

# ───────────── 8. 두 자리 교대 switch.sh (D-RETRO-35~37) — 가짜 도커 ─────────────
# 가짜 도커: 컨테이너를 $FD/c-<자리> 파일(image / commit / running / mode 네 줄)로 흉내 낸다. 진짜 도커·서버에는 닿지 않는다.
SW="$ROOT_REPO/deploy/ec2/switch.sh"
cat > "$T/bin/docker" <<'SH'
#!/bin/bash
echo "$*" >> "$FD/log"
slot_of() { case "$1" in cid-a) echo a ;; cid-b) echo b ;; *) echo "" ;; esac; }
field() { sed -n "${2}p" "$FD/c-$1" 2>/dev/null; }
put() { printf '%s\n%s\n%s\n%s\n' "$2" "$3" "$4" "$5" > "$FD/c-$1"; }
active() { tr -d ' \n' < "$LJ_SLOT_DIR/active" 2>/dev/null; }
boot_mode() { if [ "$(active)" = "$1" ]; then echo active; else echo standby; fi; }
envget() { sed -n "s/^$1=//p" "$LJ_SLOT_DIR/slots.env" 2>/dev/null | head -n1; }
up_slot() {
  local s="$1" U; U=$(echo "$s" | tr a-z A-Z)
  if [ "${FAKE_BOOT_FAIL:-}" = "$s" ]; then put "$s" "$(envget "LG_IMAGE_$U")" "$(envget "LG_COMMIT_$U")" 0 standby
  else put "$s" "$(envget "LG_IMAGE_$U")" "${FAKE_BOOT_COMMIT:-$(envget "LG_COMMIT_$U")}" 1 "$(boot_mode "$s")"; fi
}
case "$1" in
  compose)
    shift
    while [ $# -gt 0 ]; do case "$1" in --project-name | --env-file | -f) shift 2 ;; *) break ;; esac; done
    sub="$1"; shift
    case "$sub" in
      ps)
        last=""; for last; do :; done
        case "$last" in
          app-a | app-b) [ -f "$FD/c-${last#app-}" ] && echo "cid-${last#app-}" ;;
          caddy) [ -f "$FD/no-caddy" ] || echo cid-caddy ;;
        esac ;;
      up)
        for arg in "$@"; do case "$arg" in app-a | app-b) up_slot "${arg#app-}" ;; caddy) echo x >> "$FD/caddy-recreated" ;; esac; done ;;
      rm) for arg in "$@"; do case "$arg" in app-a | app-b) rm -f "$FD/c-${arg#app-}" ;; esac; done ;;
      exec) echo "${FAKE_DB_MIGRATIONS:-56}" ;;
      logs) : ;;
    esac ;;
  inspect)
    # inspect -f <모양> <컨테이너>
    s=$(slot_of "$4")
    case "$3" in
      *Running*) if [ "$4" = cid-legacy ]; then [ -f "$FD/legacy" ] && cat "$FD/legacy"; elif [ "$(field "$s" 3)" = 1 ]; then echo true; else echo false; fi ;;
      *Image*) if [ "$4" = cid-caddy ]; then echo caddy:test; else field "$s" 1; fi ;;
    esac ;;
  exec)
    c="$2"; s=$(slot_of "$c")
    if [ "$c" = cid-caddy ]; then
      case "$3" in grep) [ "${FAKE_CADDY_OLD:-}" = 1 ] && exit 1; exit 0 ;; wget) [ "${FAKE_CADDY_UNREACHABLE:-}" = 1 ] && exit 1; exit 0 ;; esac
    fi
    [ "$(field "$s" 3)" = 1 ] || exit 1
    case "$4" in
      -e) echo "$(field "$s" 4) $s $(field "$s" 2)" ;;
      *slot-smoke.ts) echo "smoke $s" >> "$FD/smoke"; exit "${FAKE_SMOKE_RC:-0}" ;;
    esac ;;
  kill)
    s=$(slot_of "$4"); [ "$(field "$s" 3)" = 1 ] || exit 1
    case "$3" in
      USR2) [ "${FAKE_PROMOTE_FAIL:-}" = 1 ] || { [ "$(field "$s" 4)" = standby ] && put "$s" "$(field "$s" 1)" "$(field "$s" 2)" 1 active; } ;;
      HUP) [ "${FAKE_HANDOVER_FAIL:-}" = 1 ] || { [ "$(field "$s" 4)" = active ] && put "$s" "$(field "$s" 1)" "$(field "$s" 2)" 1 handover; } ;;
    esac
    exit 0 ;;
  stop)
    c="$4"; if [ "$c" = cid-legacy ]; then echo false > "$FD/legacy"; exit 0; fi
    s=$(slot_of "$c"); put "$s" "$(field "$s" 1)" "$(field "$s" 2)" 0 stopped ;;
  start | restart)
    for c; do :; done
    s=$(slot_of "$c"); put "$s" "$(field "$s" 1)" "$(field "$s" 2)" 1 "$(boot_mode "$s")" ;;
  image)
    case "$2" in
      inspect) [ -f "$FD/img-$(echo "$3" | tr ':/' '__')" ] ;;
      prune) : ;;
    esac ;;
  build)
    [ "${FAKE_BUILD_FAIL:-}" = 1 ] && exit 1
    while [ $# -gt 0 ]; do if [ "$1" = -t ]; then touch "$FD/img-$(echo "$2" | tr ':/' '__')"; fi; shift; done ;;
  load) cat > /dev/null; [ -n "${FAKE_LOAD_TAG:-}" ] && touch "$FD/img-$(echo "$FAKE_LOAD_TAG" | tr ':/' '__')"; exit 0 ;;
  run)
    case "$*" in *"caddy validate"*) exit "${FAKE_CADDY_INVALID:-0}" ;; *) echo "${FAKE_IMAGE_MIGRATIONS:-56}" ;; esac ;;
  ps) [ -f "$FD/legacy" ] && echo cid-legacy; exit 0 ;;
esac
SH
# 가짜 앞단: 요청을 받는 자리(운영·넘기는 중) 가운데 앞에 적힌 쪽(a 먼저 — Caddyfile의 lb_policy first)이 답한다
cat > "$T/bin/curl-front" <<'SH'
#!/bin/bash
[ "${FAKE_FRONT_DOWN:-}" = 1 ] && exit 7
for s in a b; do
  if [ "$(sed -n 3p "$FD/c-$s" 2>/dev/null)" = 1 ]; then
    case "$(sed -n 4p "$FD/c-$s")" in active | handover) printf '{"status":"ok","slot":"%s","commit":"x","mode":"active"}' "$s"; exit 0 ;; esac
  fi
done
exit 22
SH
chmod +x "$T/bin/docker" "$T/bin/curl-front"
C1=1111111111111111111111111111111111111111; C2=2222222222222222222222222222222222222222; C3=3333333333333333333333333333333333333333
sw_reset() {
  rm -rf "$T/lgroot" "$T/fd"; mkdir -p "$T/lgroot/slot" "$T/lgroot/src" "$T/fd"
  printf 'LJ_DOMAIN=example.test\n' > "$T/lgroot/.env"
  : > "$T/backup.calls"
}
printf '#!/bin/bash\necho x >> "%s"\nexit "${FAKE_BACKUP_RC:-0}"\n' "$T/backup.calls" > "$T/bin/backup"; chmod +x "$T/bin/backup"
sw() {
  LG_ROOT="$T/lgroot" LJ_SLOT_DIR="$T/lgroot/slot" FD="$T/fd" LG_DOCKER="$T/bin/docker" LG_CURL="$T/bin/curl-front" LG_BACKUP_CMD="$T/bin/backup" \
    LG_FRONT_URL=http://front.test LG_HEALTH_WAIT=2 LG_FRONT_WAIT=2 LG_FRONT_WAIT_FIRST=2 bash "$SW" "$@" > "$T/sw.out" 2> "$T/sw.err"
  echo $?
}
sw_last() { tail -n 1 "$T/sw.out"; }
swl() { sw "$@" > /dev/null; sw_last; }   # 돌리고 결과 줄만
c_mode() { sed -n 4p "$T/fd/c-$1" 2>/dev/null || true; }
c_commit() { sed -n 2p "$T/fd/c-$1" 2>/dev/null || true; }
active_slot() { cat "$T/lgroot/slot/active" 2>/dev/null || true; }
calls() { grep -c "$1" "$T/fd/log" 2>/dev/null || true; }
export LJ_SLOT_DIR="$T/lgroot/slot" FD="$T/fd"

# — 새 서버: a 자리를 바로 운영으로 —
sw_reset
eq "커밋 없이 부르면 실패" "$(sw --build)" 1
has "실패 줄" "$(sw_last)" "LG-SWITCH-FAIL"
eq "모르는 인자" "$(sw --nope)" 2
eq "새 서버 첫 설치" "$(sw --commit "$C1" --build)" 0
eq "첫 설치 결과 줄" "$(sw_last)" "LG-SWITCHED a $C1"
eq "첫 설치: 운영 자리 표시" "$(active_slot)" a
eq "첫 설치: a가 운영" "$(c_mode a)" active
eq "잠금을 남기지 않음" "$([ -e "$T/lgroot/slot/.lock" ] && echo 남음 || echo 없음)" 없음

# — 평소 교체: a → b —
eq "교체 a → b" "$(sw --commit "$C2" --build)" 0
eq "교체 결과 줄" "$(sw_last)" "LG-SWITCHED b $C2"
eq "운영 자리 표시가 b로" "$(active_slot)" b
eq "b가 운영" "$(c_mode b) $(c_commit b)" "active $C2"
eq "옛 자리 a는 멈춘 채 남음(되돌리기용)" "$(c_mode a) $(c_commit a)" "stopped $C1"
eq "연습 방송을 새 자리에서 돌림" "$(tail -n 1 "$T/fd/smoke")" "smoke b"
eq "되돌릴 판 기록" "$(cut -d' ' -f1,2 "$T/lgroot/slot/previous")" "a $C1"
eq "DB 변경이 없으면 백업하지 않음" "$(wc -l < "$T/backup.calls" | tr -d ' ')" 0
# 순서: 옛 자리 뒤 작업 넘기기(HUP) → 새 자리 올리기(USR2) → 옛 자리 내리기(stop)
ORDER=$(grep -n -E '^kill -s HUP cid-a|^kill -s USR2 cid-b|^stop -t 45 cid-a' "$T/fd/log" | tail -n 3 | cut -d: -f2 | cut -d' ' -f1-3 | tr '\n' '|')
eq "넘기기 → 올리기 → 내리기 순서" "$ORDER" "kill -s HUP|kill -s USR2|stop -t 45|"

# — 되돌리기: b → a (옛 컨테이너·옛 이미지로) —
eq "되돌리기" "$(sw --back)" 0
eq "되돌리기 결과 줄" "$(sw_last)" "LG-SWITCHED a $C1"
eq "되돌린 뒤 운영은 a(옛 판)" "$(active_slot) $(c_mode a) $(c_commit a)" "a active $C1"
eq "되돌린 뒤 b는 멈춘 채 남음" "$(c_mode b)" stopped
eq "한 번 더 되돌리면 다시 b" "$(swl --back)" "LG-SWITCHED b $C2"
eq "다시 b가 운영" "$(active_slot) $(c_mode b) $(c_commit b)" "b active $C2"

# — 어느 단계든 실패하면 교체하지 않는다 (운영 b · C2 그대로, 대기 자리 a는 내린다) —
unchanged() { eq "$1: 운영 자리 그대로" "$(active_slot) $(c_mode b) $(c_commit b)" "b active $C2"; eq "$1: 대기 자리를 내림" "$([ -e "$T/fd/c-a" ] && echo 남음 || echo 없음)" 없음; }
eq "이미지 만들기 실패" "$(FAKE_BUILD_FAIL=1 sw --commit "$C3" --build)" 1
eq "실패 단계 image" "$(sw_last)" "LG-SWITCH-FAIL image"
eq "이미지가 없는데 만들지도 받지도 않음" "$(swl --commit "$C3")" "LG-SWITCH-FAIL image"
eq "대기 자리가 뜨지 않음" "$(FAKE_BOOT_FAIL=a sw --commit "$C3" --build)" 1
eq "실패 단계 health" "$(sw_last)" "LG-SWITCH-FAIL health"
unchanged "뜨지 않음"
eq "판이 다른 컨테이너" "$(FAKE_BOOT_COMMIT=$C1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL health"
unchanged "판이 다름"
eq "연습 방송 실패" "$(FAKE_SMOKE_RC=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL smoke"
unchanged "연습 방송 실패"
eq "앞단이 옛 설정" "$(FAKE_CADDY_OLD=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL front"
unchanged "앞단이 옛 설정"
eq "앞단에서 새 자리에 닿지 않음" "$(FAKE_CADDY_UNREACHABLE=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL front"
unchanged "앞단에서 닿지 않음"
eq "옛 자리가 뒤 작업을 넘기지 못함" "$(FAKE_HANDOVER_FAIL=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL handover"
unchanged "넘기기 실패"
eq "넘기기 실패 뒤 옛 자리를 다시 켜 뒤 작업을 되살림" "$(calls '^restart -t 45 cid-b')" 1
eq "올리기 실패" "$(FAKE_PROMOTE_FAIL=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL promote"
unchanged "올리기 실패"
eq "올리기 실패 뒤에도 옛 자리를 다시 켬" "$(calls '^restart -t 45 cid-b')" 2
# 올린 뒤 앞단이 새 자리로 보내지 않으면 옛 자리를 다시 올린다
eq "앞단 확인 실패 → 옛 자리로" "$(FAKE_FRONT_DOWN=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL verify"
eq "앞단 확인 실패 뒤 운영은 다시 b" "$(active_slot) $(c_mode b) $(c_commit b)" "b active $C2"
eq "앞단 확인 실패 뒤 새 자리는 멈춤" "$(c_mode a)" stopped

# 실패한 배포는 되돌릴 자리(멈춰 둔 a)를 썼다 지운다 — 그래도 옛 이미지로 되돌릴 수 있어야 한다
sw_reset
sw --commit "$C1" --build > /dev/null; sw --commit "$C2" --build > /dev/null
eq "실패한 배포" "$(FAKE_SMOKE_RC=1 swl --commit "$C3" --build)" "LG-SWITCH-FAIL smoke"
eq "실패하면 그 자리에 적힌 이미지·판을 되돌려 적음" "$(sed -n 's/^LG_COMMIT_A=//p' "$T/lgroot/slot/slots.env") $(sed -n 's/^LG_IMAGE_A=//p' "$T/lgroot/slot/slots.env")" "$C1 livegenie-app:${C1:0:12}"
eq "실패한 배포 뒤에도 되돌리기" "$(swl --back)" "LG-SWITCHED a $C1"
eq "되돌린 자리는 옛 판·옛 이미지" "$(c_commit a) $(sed -n 1p "$T/fd/c-a")" "$C1 livegenie-app:${C1:0:12}"
sw_reset
sw --commit "$C1" --build > /dev/null; sw --commit "$C2" --build > /dev/null   # 다시 운영 b · C2

# — 방송 중: 띄워 확인까지만 —
USR2_BEFORE=$(calls '^kill -s USR2 cid-a')
eq "띄워 확인까지만" "$(sw --commit "$C3" --build --stage-only)" 0
eq "띄우기 결과 줄" "$(sw_last)" "LG-STAGED a $C3"
eq "운영은 그대로 b" "$(active_slot) $(c_mode b)" "b active"
eq "대기 자리는 확인 뒤 멈춰 둠(메모리)" "$(c_mode a) $(c_commit a)" "stopped $C3"
eq "올리지 않음" "$(calls '^kill -s USR2 cid-a')" "$USR2_BEFORE"
eq "옛 자리에 넘기기 신호도 보내지 않음" "$(c_mode b)" active
BUILDS=$(calls '^build ')
eq "방송 뒤 같은 판 올리기" "$(swl --commit "$C3" --build)" "LG-SWITCHED a $C3"
eq "띄워 둔 판은 다시 만들지 않음" "$(calls '^build ')" "$BUILDS"
eq "올린 뒤 표시 지움" "$([ -e "$T/lgroot/slot/staged" ] && echo 남음 || echo 없음)" 없음
eq "--keep-standby 는 대기 자리를 띄워 둠" "$(swl --commit "$C2" --stage-only --keep-standby) $(c_mode b)" "LG-STAGED b $C2 standby"
eq "띄워 둔 자리 올리기" "$(swl --commit "$C2")" "LG-SWITCHED b $C2"

# — DB 변경이 있는 판 —
sw_reset
sw --commit "$C1" --build > /dev/null
eq "DB 변경이 있으면 먼저 백업" "$(FAKE_IMAGE_MIGRATIONS=57 FAKE_DB_MIGRATIONS=56 swl --commit "$C2" --build) $(wc -l < "$T/backup.calls" | tr -d ' ')" "LG-SWITCHED b $C2 1"
eq "백업이 실패하면 올리지 않음" "$(FAKE_BACKUP_RC=1 FAKE_IMAGE_MIGRATIONS=58 FAKE_DB_MIGRATIONS=57 swl --commit "$C3" --build)" "LG-SWITCH-FAIL backup"
eq "백업 실패: 운영 그대로" "$(active_slot) $(c_commit b)" "b $C2"
eq "백업 실패: 대기 자리를 띄우지 않음" "$(c_commit a)" "$C1"
eq "방송 중에는 DB를 바꾸는 판을 띄우지 않음" "$(FAKE_IMAGE_MIGRATIONS=58 FAKE_DB_MIGRATIONS=57 swl --commit "$C3" --build --stage-only)" "LG-STAGE-SKIPPED migrations"
eq "띄우지 않음: 옛 자리 그대로" "$(c_commit a) $(c_mode a)" "$C1 stopped"
eq "DB 판을 못 읽으면 백업하는 쪽으로" "$(FAKE_DB_MIGRATIONS=x FAKE_IMAGE_MIGRATIONS=56 sw --commit "$C3" --build > /dev/null; wc -l < "$T/backup.calls" | tr -d ' ')" 3

# — 받아 오기(밖에서 만든 이미지) —
sw_reset
sw --commit "$C1" --build > /dev/null
printf 'fake image' | gzip > "$T/image.tar.gz"
SUM=$(shasum -a 256 "$T/image.tar.gz" | cut -d' ' -f1)
eq "받아 온 묶음으로 교체" "$(FAKE_LOAD_TAG="livegenie-app:${C2:0:12}" swl --commit "$C2" --image-file "$T/image.tar.gz" --image-sha256 "$SUM")" "LG-SWITCHED b $C2"
eq "받아 오면 서버에서 만들지 않음" "$(calls '^build ')" 1
eq "체크섬이 다르면 실패" "$(FAKE_LOAD_TAG="livegenie-app:${C3:0:12}" swl --commit "$C3" --image-file "$T/image.tar.gz" --image-sha256 "${SUM/[0-9a-f]/x}")" "LG-SWITCH-FAIL image"
eq "묶음의 태그가 다르면 실패" "$(FAKE_LOAD_TAG="livegenie-app:wrong" swl --commit "$C3" --image-file "$T/image.tar.gz")" "LG-SWITCH-FAIL image"
eq "받아 오기 실패: 운영 그대로" "$(active_slot) $(c_commit b)" "b $C2"

# — 이사: 옛 한 자리(app) → 두 자리 —
sw_reset
echo true > "$T/fd/legacy"
eq "이사" "$(sw --commit "$C1" --build)" 0
eq "이사 결과 줄" "$(sw_last)" "LG-SWITCHED a $C1"
eq "이사: a가 운영" "$(active_slot) $(c_mode a)" "a active"
eq "이사: 앞단을 새 설정으로 한 번 다시 켬" "$(wc -l < "$T/fd/caddy-recreated" | tr -d ' ')" 1
eq "이사: 옛 app을 내림" "$(cat "$T/fd/legacy")" false
eq "이사: 옛 app에는 넘기기 신호를 보내지 않음(옛 판은 모른다)" "$(calls '^kill -s HUP')" 0
sw_reset; echo true > "$T/fd/legacy"
eq "이사: 새 앞단 설정이 읽히지 않으면 하지 않음" "$(FAKE_CADDY_INVALID=1 swl --commit "$C1" --build)" "LG-SWITCH-FAIL front"
eq "이사 실패: 옛 app 그대로" "$(cat "$T/fd/legacy") $(active_slot)" "true "
eq "이사 실패: 앞단을 건드리지 않음" "$([ -e "$T/fd/caddy-recreated" ] && echo 건드림 || echo 그대로)" 그대로
sw_reset; echo true > "$T/fd/legacy"
eq "이사: 연습 방송이 실패하면 하지 않음" "$(FAKE_SMOKE_RC=1 swl --commit "$C1" --build) $(cat "$T/fd/legacy")" "LG-SWITCH-FAIL smoke true"

# — 동시에 두 번 돌지 않는다 —
sw_reset
sw --commit "$C1" --build > /dev/null
mkdir "$T/lgroot/slot/.lock"; echo $$ > "$T/lgroot/slot/.lock/pid"
eq "다른 교체가 돌고 있으면 실패" "$(sw --commit "$C2" --build)" 1
eq "잠긴 동안 아무것도 바꾸지 않음" "$(active_slot) $([ -e "$T/fd/c-b" ] && echo b있음 || echo b없음)" "a b없음"
echo 999999 > "$T/lgroot/slot/.lock/pid"
eq "죽은 실행이 남긴 잠금은 넘어감" "$(swl --commit "$C2" --build)" "LG-SWITCHED b $C2"

# — lg-compose: 운영 자리만 고른다 —
LGC="$ROOT_REPO/deploy/ec2/lg-compose.sh"
cat > "$T/bin/docker-echo" <<'SH'
#!/bin/bash
echo "profiles=${COMPOSE_PROFILES-unset} args=$*"
SH
chmod +x "$T/bin/docker-echo"
lgc() { LG_ROOT="$T/lgroot" LJ_SLOT_DIR="$T/lgroot/slot" LG_DOCKER="$T/bin/docker-echo" "$@" bash "$LGC" "${LGC_ARGS[@]}"; }
LGC_ARGS=(up -d)
has "운영 자리(b)만 고름" "$(lgc env)" "profiles=b "
LGC_ARGS=(logs --tail 100 app)
has "app 은 운영 자리 이름으로" "$(lgc env)" "logs --tail 100 app-b"
LGC_ARGS=(ps -a)
has "LG_SLOTS=all 이면 두 자리" "$(lgc env LG_SLOTS=all)" "profiles=a,b "
has "자리마다 이미지 값을 넘김" "$(lgc env)" "--env-file $T/lgroot/slot/slots.env"
rm -f "$T/lgroot/slot/active"
has "운영 자리를 모르면 앱 자리를 고르지 않음" "$(lgc env)" "profiles= "
LGC_ARGS=(exec app true)
has "운영 자리를 모르면 app 을 바꾸지 않음" "$(lgc env)" "exec app true"

echo "내보내기 스크립트 시험: 통과 $PASS · 실패 $FAIL"
[ "$FAIL" -eq 0 ]
