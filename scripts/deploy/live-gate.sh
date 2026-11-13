#!/bin/bash
# 방송 중 문지기 (D-RETRO-30, 복기 E6) — 맥 미니에서 돈다: 내보내기(ship.yml)·따라잡기(mini-catchup.sh)·일꾼 갱신(mini-worker-update.sh)이 부른다.
# 화면 일꾼 관리자(packages/screen-worker/sw/serve.py)가 30초마다 묻는 것과 같은 입구 `GET /internal/screen/live`를 같은 일꾼 토큰으로 묻는다.
#
# 쓰는 법:
#   live-gate.sh            → 한 줄: live(방송 중) | idle(방송 없음) | unknown(못 읽음). 까닭은 표준 오류에. 종료 코드는 늘 0
#   live-gate.sh commit     → 운영 서버가 알려 주는 판(커밋) 한 줄. 모르면 빈 줄 (`GET /internal/screen/capabilities`)
#   live-gate.sh judge <HTTP 상태> <응답 파일>   → 판단만(시험용): "live <개수>" | "idle" | "unknown <까닭>"
#
# 환경값 (없으면 ~/.livegenie-ci/gate.env 를 읽는다 — 맥 미니에만 있는 파일):
#   LG_SCREEN_TOKEN_FILE  일꾼 토큰 파일. 화면 일꾼 launchd 설정의 --token-file 과 같은 경로 (기본 ~/.lg_screen_token)
#   LG_SERVER             운영 서버 (기본 https://livegenie.kr)
#
# unknown을 부르는 쪽이 어떻게 다루나 — 일부러 다르게 정했다:
#   - 서버 배포(ship.yml): unknown이면 **방송 중이 아닌 것으로 보고 배포한다.** 입구를 못 읽는 가장 흔한 까닭은 서버가 죽은 것이고,
#     그때 고침을 막으면 서버를 살릴 길이 없다. 토큰 파일이 없거나 틀린 경우도 여기에 들어가므로 내보내기 요약에 경고를 남긴다.
#   - 일꾼 다시 켜기·따라잡기: unknown이면 **하지 않는다.** 미뤄도 잃는 것이 없고, 방송 중에 일꾼을 다시 켜면 받아쓰기·번호표 이력을 잃는다.
# 토큰은 어디에도 찍지 않는다 — curl에도 명령행 인자가 아니라 표준 입력(설정)으로 넘긴다(ps에 안 보이게).
set -uo pipefail
export PATH=/opt/homebrew/bin:$PATH

CI_DIR="${LG_CI_DIR:-$HOME/.livegenie-ci}"
if [ -f "$CI_DIR/gate.env" ]; then
  # 이미 환경에 있는 값이 이긴다
  KEEP_TOKEN_FILE="${LG_SCREEN_TOKEN_FILE:-}"; KEEP_SERVER="${LG_SERVER:-}"
  # shellcheck disable=SC1091
  set -a; . "$CI_DIR/gate.env"; set +a
  [ -n "$KEEP_TOKEN_FILE" ] && LG_SCREEN_TOKEN_FILE="$KEEP_TOKEN_FILE"
  [ -n "$KEEP_SERVER" ] && LG_SERVER="$KEEP_SERVER"
fi
SERVER="${LG_SERVER:-https://livegenie.kr}"
SERVER="${SERVER%/}"
TOKEN_FILE="${LG_SCREEN_TOKEN_FILE:-$HOME/.lg_screen_token}"
case "$TOKEN_FILE" in "~/"*) TOKEN_FILE="$HOME/${TOKEN_FILE#"~/"}" ;; esac
TIMEOUT="${LG_GATE_TIMEOUT:-10}"
CURL="${LG_CURL:-curl}"   # 시험에서 가짜로 바꾼다

say() { echo "문지기: $*" >&2; }

# ask <경로> <응답을 둘 파일> → HTTP 상태 한 줄 (못 닿으면 000, 토큰을 못 쓰면 "token <까닭>")
ask() {
  local token status
  if [ ! -r "$TOKEN_FILE" ]; then echo "token 토큰 파일을 못 읽어요($TOKEN_FILE)"; return 0; fi
  token=$(tr -d ' \t\r\n' < "$TOKEN_FILE")
  # 머리글에 그대로 들어가므로 모양을 본다(따옴표·줄바꿈이 섞이면 설정이 깨진다)
  if ! [[ "$token" =~ ^[A-Za-z0-9._~+/=-]{32,}$ ]]; then echo "token 토큰 파일 내용이 토큰 모양이 아니에요($TOKEN_FILE)"; return 0; fi
  status=$(printf 'header = "Authorization: Bearer %s"\n' "$token" | "$CURL" -sS -m "$TIMEOUT" -o "$2" -w '%{http_code}' --config - "$SERVER$1" 2>/dev/null) || status=000
  echo "${status:-000}"
}

judge() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

status, path = sys.argv[1], sys.argv[2]
if status != "200":
    hint = {"000": "서버에 닿지 않음", "401": "HTTP 401 — 토큰이 서버와 다름", "404": "HTTP 404 — 서버에 일꾼 토큰이 없거나 입구가 없음"}
    print("unknown", hint.get(status, f"HTTP {status}"))
    sys.exit()
try:
    with open(path, encoding="utf-8") as f:
        videos = json.load(f)["videos"]
    if not isinstance(videos, list):
        raise ValueError
except Exception:
    print("unknown 응답 모양이 다름")
    sys.exit()
# 모양이 이상한 줄도 방송으로 센다 — 헷갈릴 때는 "방송 중" 쪽이 판매자에게 안전하다
print(f"live {len(videos)}" if videos else "idle")
PY
}

case "${1:-state}" in
  state)
    BODY=$(mktemp); trap 'rm -f "$BODY"' EXIT
    STATUS=$(ask /internal/screen/live "$BODY")
    case "$STATUS" in
      token\ *) say "${STATUS#token } — 방송 여부를 확인하지 못함"; echo unknown ;;
      *)
        VERDICT=$(judge "$STATUS" "$BODY") || VERDICT="unknown 판단 실패"
        case "$VERDICT" in
          live\ *) say "방송 ${VERDICT#live }개 진행 중"; echo live ;;
          idle) say "진행 중인 방송 없음"; echo idle ;;
          *) say "${VERDICT#unknown } — 방송 여부를 확인하지 못함"; echo unknown ;;
        esac ;;
    esac ;;
  commit)
    BODY=$(mktemp); trap 'rm -f "$BODY"' EXIT
    STATUS=$(ask /internal/screen/capabilities "$BODY")
    if [ "$STATUS" = 200 ]; then
      python3 -c 'import json,re,sys
try:
    c = json.load(open(sys.argv[1], encoding="utf-8")).get("commit")
except Exception:
    c = None
print(c if isinstance(c, str) and re.fullmatch(r"[0-9a-f]{7,40}", c) else "")' "$BODY"
    else
      echo
    fi ;;
  judge) judge "$2" "$3" ;;
  *) echo "쓰는 법: live-gate.sh [state|commit|judge <상태> <파일>]" >&2; exit 2 ;;
esac
