#!/bin/bash
# 맥 미니 받아쓰기 일꾼 묶음 공용 함수 (D-APP-09·D-APP-14·D-APP-15).
# 다른 스크립트가 불러 쓴다. 맥 기본 bash 3.2에서 돈다(연관 배열·mapfile 안 씀).
# 토큰 값은 어떤 함수도 화면·로그에 찍지 않는다.

# 설치 위치 (시험에서는 환경변수로 바꾼다)
LABEL="com.livejjim.transcriber"
APP_DIR="${LIVEJJIM_TRANSCRIBER_HOME:-$HOME/Library/Application Support/LiveJjim/transcriber}"
APP_CODE="$APP_DIR/app"
CONF_FILE="$APP_DIR/worker.conf"
TOKEN_FILE="$APP_DIR/worker-token"
SOURCE_RECORD="$APP_DIR/source-folder"
VERSION_FILE="$APP_DIR/version"
LOG_FILE="${LIVEJJIM_TRANSCRIBER_LOG:-$HOME/Library/Logs/livejjim-transcriber.log}"
AGENTS_DIR="${LIVEJJIM_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}"
PLIST_FILE="$AGENTS_DIR/$LABEL.plist"
LAUNCHCTL="${LIVEJJIM_LAUNCHCTL:-/bin/launchctl}"
# 로그가 이만큼 커지면 한 벌만 남기고 새로 쓴다(5MB)
LOG_MAX_BYTES=5242880
DEFAULT_MODEL="cohere"
DEFAULT_MAX_STREAMS="4"
COHERE_REPO="CohereLabs/cohere-transcribe-03-2026"
WHISPER_REPO="openai/whisper-large-v3-turbo"

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }

gui_domain() { printf 'gui/%s' "$(id -u)"; }

# 설치 묶음(이 스크립트들이 든 transcriber 폴더)의 위치
bundle_root() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
}

# requirements.txt 내용으로 venv 이름을 정한다 — 고정 판이 바뀌면 새 venv를 따로 만들고 다 되면 바꾼다
requirements_hash() {
  /usr/bin/shasum -a 256 "$1" | cut -c1-12
}

venv_dir_for() {
  printf '%s/venv-%s' "$APP_DIR" "$(requirements_hash "$1")"
}

current_venv() {
  [ -f "$APP_CODE/requirements.txt" ] || return 1
  venv_dir_for "$APP_CODE/requirements.txt"
}

# 파이썬 3.12 찾기: uv가 있으면 uv가 관리하는 3.12, 없으면 이미 깔린 python.org·brew 3.12.
# 시스템 설정·시스템 파이썬은 건드리지 않는다. 찾으면 "uv <경로>" 또는 "python <경로>"를 찍는다.
find_python312() {
  local candidate uv_bin
  uv_bin="$(command -v uv 2>/dev/null || true)"
  [ -z "$uv_bin" ] && [ -x /opt/homebrew/bin/uv ] && uv_bin=/opt/homebrew/bin/uv
  [ -z "$uv_bin" ] && [ -x "$HOME/.local/bin/uv" ] && uv_bin="$HOME/.local/bin/uv"
  if [ -n "$uv_bin" ]; then
    candidate="$("$uv_bin" python find 3.12 2>/dev/null || true)"
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf 'uv %s\n' "$uv_bin"
      return 0
    fi
    printf 'uv-missing-312 %s\n' "$uv_bin"
    return 0
  fi
  for candidate in \
    /opt/homebrew/bin/python3.12 \
    /usr/local/bin/python3.12 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 \
    "$(command -v python3.12 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf 'python %s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

python312_help() {
  cat <<'EOF'
파이썬 3.12를 찾지 못했어요. 아래 둘 중 하나만 하고 다시 실행해 주세요.
  1) python.org에서 "Python 3.12" 맥용 설치 파일(macOS 64-bit universal2 installer)을 받아 설치
  2) 홈브루를 쓰고 있다면: brew install python@3.12
이 설치 묶음은 시스템 설정이나 맥에 원래 있는 파이썬을 바꾸지 않아요.
EOF
}

# 고정 requirements로 venv 하나를 만든다. $1=requirements 파일, $2=만들 venv 폴더
build_venv() {
  local requirements="$1" target="$2" kind tool found
  found="$(find_python312)" || { python312_help >&2; return 1; }
  kind="${found%% *}"
  tool="${found#* }"
  rm -rf "$target.partial"
  case "$kind" in
    uv)
      "$tool" venv --quiet --python 3.12 "$target.partial" || return 1
      "$tool" pip install --quiet --python "$target.partial/bin/python" -r "$requirements" || return 1
      ;;
    uv-missing-312)
      warn "uv는 있는데 파이썬 3.12가 없어요."
      warn "uv가 자기 폴더에 3.12를 받게 하려면: uv python install 3.12  (시스템 설정은 바뀌지 않아요)"
      return 1
      ;;
    python)
      "$tool" -m venv "$target.partial" || return 1
      "$target.partial/bin/python" -m pip install --quiet --disable-pip-version-check -r "$requirements" || return 1
      ;;
  esac
  # 꾸러미가 다 불러와지는지 확인한 뒤에만 자리를 바꾼다
  "$target.partial/bin/python" -B -c 'import websockets, onnxruntime, silero_vad, numpy, torch, transformers, librosa, huggingface_hub' || return 1
  rm -rf "$target"
  mv "$target.partial" "$target"
}

# 설치 묶음의 코드를 설치 폴더로 옮긴다(받아쓰기 코드·requirements·이 스크립트들). $1=설치 묶음 위치
deploy_code() {
  local src="$1"
  [ -d "$src/livegenie_transcriber" ] || die "설치 묶음에서 받아쓰기 코드를 찾지 못했어요: $src"
  rm -rf "$APP_DIR/app.new" "$APP_DIR/app.old"
  mkdir -p "$APP_DIR/app.new/macmini"
  cp -R "$src/livegenie_transcriber" "$APP_DIR/app.new/" || return 1
  find "$APP_DIR/app.new" -name '__pycache__' -type d -prune -exec rm -rf {} +
  cp "$src/requirements.txt" "$APP_DIR/app.new/" || return 1
  cp "$src"/macmini/*.sh "$APP_DIR/app.new/macmini/" || return 1
  [ -f "$src/macmini/README-맥미니.md" ] && cp "$src/macmini/README-맥미니.md" "$APP_DIR/app.new/macmini/"
  chmod 755 "$APP_DIR/app.new/macmini/"*.sh
  if [ -d "$APP_CODE" ]; then mv "$APP_CODE" "$APP_DIR/app.old"; fi
  mv "$APP_DIR/app.new" "$APP_CODE"
  rm -rf "$APP_DIR/app.old"
}

# 지금 쓰는 것 말고 다른 판의 파이썬 환경을 지운다. $1=남길 venv
cleanup_old_venvs() {
  local keep="$1" old
  for old in "$APP_DIR"/venv-*; do
    [ -d "$old" ] || continue
    [ "$old" = "$keep" ] && continue
    rm -rf "$old"
  done
}

# 설치 묶음의 판 이름: git이면 커밋 앞 7자, 아니면 requirements 해시
bundle_version() {
  local src="$1" commit
  commit="$(git -C "$src" rev-parse --short=7 HEAD 2>/dev/null || true)"
  if [ -n "$commit" ]; then printf 'git %s' "$commit"; else printf 'files %s' "$(requirements_hash "$src/requirements.txt")"; fi
}

# 설정 파일 읽기: 정해진 이름만 받는다(파일을 실행하지 않는다). 성공하면 SERVER·MODEL·MAX_STREAMS·DEVICE가 생긴다
load_conf() {
  SERVER=""
  MODEL="$DEFAULT_MODEL"
  MAX_STREAMS="$DEFAULT_MAX_STREAMS"
  DEVICE="auto"
  [ -f "$CONF_FILE" ] || return 1
  local key value
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in
      SERVER) SERVER="$value" ;;
      MODEL) MODEL="$value" ;;
      MAX_STREAMS) MAX_STREAMS="$value" ;;
      DEVICE) DEVICE="$value" ;;
    esac
  done <"$CONF_FILE"
  [ -n "$SERVER" ]
}

valid_server() {
  [[ "$1" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]]
}

# 일꾼 토큰: 보이는 아스키 글자만(빈칸 없음). 값은 찍지 않는다
valid_token() {
  local LC_ALL=C
  [[ "$1" =~ ^[!-~]+$ ]]
}

file_mode() {
  /usr/bin/stat -f '%Lp' "$1" 2>/dev/null
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# launchd 사용자 에이전트 파일을 만든다: 로그인 때 켜기·꺼지면 다시 켜기(30초 간격)
write_plist() {
  local run app home
  run="$(xml_escape "$APP_CODE/macmini/run.sh")"
  app="$(xml_escape "$APP_CODE")"
  home="$(xml_escape "$APP_DIR")"
  mkdir -p "$AGENTS_DIR"
  cat >"$PLIST_FILE.tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$app</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LIVEJJIM_TRANSCRIBER_HOME</key>
    <string>$home</string>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
EOF
  mv "$PLIST_FILE.tmp" "$PLIST_FILE"
  chmod 644 "$PLIST_FILE"
}

# 로그가 너무 커지면 한 벌(.1)만 남긴다
rotate_log() {
  local size
  [ -f "$LOG_FILE" ] || return 0
  size="$(/usr/bin/stat -f '%z' "$LOG_FILE" 2>/dev/null || echo 0)"
  if [ "$size" -gt "$LOG_MAX_BYTES" ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi
}

agent_loaded() {
  "$LAUNCHCTL" print "$(gui_domain)/$LABEL" >/dev/null 2>&1
}

agent_pid() {
  "$LAUNCHCTL" print "$(gui_domain)/$LABEL" 2>/dev/null | awk '$1 == "pid" && $2 == "=" { print $3; exit }'
}

# 허깅페이스 캐시에 모델이 있는지(인터넷 없이) 본다. $1=venv python, $2=모델 저장소
model_cached() {
  HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 "$1" -B -c '
import sys
from huggingface_hub import snapshot_download
try:
    snapshot_download(sys.argv[1], local_files_only=True)
except Exception:
    sys.exit(1)
' "$2" >/dev/null 2>&1
}

model_repo() {
  case "$1" in
    whisper) printf '%s' "$WHISPER_REPO" ;;
    *) printf '%s' "$COHERE_REPO" ;;
  esac
}
