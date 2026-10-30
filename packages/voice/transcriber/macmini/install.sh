#!/bin/bash
# 맥 미니에 받아쓰기 일꾼을 설치한다(한 번). 다시 실행해도 안전하다(있는 것은 그대로 쓴다).
#   bash install.sh
# 하는 일: 파이썬 3.12 찾기 → 설치 폴더에 코드 복사 → 따로 된 파이썬 환경에 고정 판 꾸러미 설치
#        → 서버 주소·일꾼 토큰 설정(권한 600) → 모델 미리 받기 → 자동 켜기 등록(물어봄)
# 하지 않는 일: 시스템 설정·전원 설정·맥 기본 파이썬 바꾸기, 관리자 암호 묻기, 토큰 화면 출력
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
SRC="$(bundle_root)"

[ "$(uname -s)" = "Darwin" ] || die "이 설치 묶음은 맥에서만 써요."
if [ "$(id -u)" = "0" ]; then die "관리자 권한(sudo)을 붙이지 말고 그냥 실행해 주세요."; fi
if [ "$(uname -m)" != "arm64" ]; then
  warn "애플 실리콘(M 칩) 맥이 아니에요. 설치는 되지만 받아쓰기가 많이 느릴 수 있어요."
fi

say "== 1/5 파이썬 3.12 찾기 =="
found="$(find_python312)" || { python312_help; exit 1; }
case "$found" in
  uv-missing-312*)
    say "uv는 있는데 파이썬 3.12가 없어요."
    printf 'uv가 자기 폴더에 파이썬 3.12를 받게 할까요? 시스템 설정은 바뀌지 않아요 (Y/n): '
    IFS= read -r answer || answer=""
    case "$answer" in
      n | N | no | 아니오) python312_help; exit 1 ;;
    esac
    "${found#* }" python install 3.12 || die "파이썬 3.12를 받지 못했어요. 인터넷 연결을 확인해 주세요."
    ;;
  uv*) say "uv의 파이썬 3.12를 써요." ;;
  python*) say "파이썬 3.12를 찾았어요: ${found#* }" ;;
esac

say ""
say "== 2/5 받아쓰기 코드와 꾸러미 설치 =="
mkdir -p "$APP_DIR"
chmod 700 "$APP_DIR"
VENV="$(venv_dir_for "$SRC/requirements.txt")"
if [ -x "$VENV/bin/python" ]; then
  say "꾸러미가 이미 설치돼 있어요."
else
  say "꾸러미를 설치해요(처음엔 수 분, 약 3GB). requirements.txt에 적힌 판 그대로 설치해요."
  build_venv "$SRC/requirements.txt" "$VENV" || die "꾸러미를 설치하지 못했어요. 인터넷 연결을 확인하고 install.sh를 다시 실행해 주세요."
fi
deploy_code "$SRC" || die "코드를 설치 폴더로 옮기지 못했어요."
printf '%s\n' "$SRC" >"$SOURCE_RECORD"
bundle_version "$SRC" >"$VERSION_FILE"
say "설치 폴더: $APP_DIR"

say ""
say "== 3/5 서버 주소·일꾼 토큰 =="
if [ -f "$CONF_FILE" ] && [ -f "$TOKEN_FILE" ]; then
  printf '이미 설정이 있어요. 다시 설정할까요? (y/N): '
  IFS= read -r answer || answer=""
  case "$answer" in
    y | Y | yes | 예 | ㅇ) bash "$APP_CODE/macmini/configure.sh" || exit 1 ;;
    *) say "설정을 그대로 써요." ;;
  esac
else
  bash "$APP_CODE/macmini/configure.sh" || exit 1
fi

say ""
say "== 4/5 받아쓰기 모델 미리 받기 =="
bash "$APP_CODE/macmini/download-model.sh" || die "모델을 받지 못했어요. 준비되면 다음 명령만 다시 실행하면 돼요: bash \"$APP_CODE/macmini/download-model.sh\""

say ""
say "== 5/5 늘 켜 두기 =="
write_plist
/usr/bin/plutil -lint "$PLIST_FILE" >/dev/null || die "자동 켜기 파일을 만들지 못했어요."
printf '지금 일꾼을 켜고, 앞으로 로그인할 때마다 저절로 켜지게 할까요? (Y/n): '
IFS= read -r answer || answer=""
case "$answer" in
  n | N | no | 아니오)
    say "켜지 않았어요. 켜려면: bash \"$APP_CODE/macmini/start.sh\""
    ;;
  *) bash "$APP_CODE/macmini/start.sh" || exit 1; started=1 ;;
esac

# 켜진 일꾼이 옛 환경을 쓰고 있지 않을 때만 옛 파이썬 환경을 치운다
if ! agent_loaded || [ "${started:-0}" = "1" ]; then cleanup_old_venvs "$VENV"; fi

say ""
say "설치가 끝났어요."
say "  상태 보기: bash \"$APP_CODE/macmini/status.sh\""
say "  끄기:      bash \"$APP_CODE/macmini/stop.sh\""
say "  업데이트:  bash \"$APP_CODE/macmini/update.sh\""
