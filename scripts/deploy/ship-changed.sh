#!/bin/bash
# 바뀐 파일 목록(표준 입력, 한 줄에 하나)에 "그 대상이 다시 나가야 하는" 파일이 있는지 본다 — ship.yml이 부른다.
#   git diff --name-only <지난 판> HEAD | bash scripts/deploy/ship-changed.sh server   → 있으면 그 파일들을 찍고 0, 없으면 1
#   … | bash scripts/deploy/ship-changed.sh worker
# server(운영 서버를 다시 올릴 까닭)에서 빼는 것:
#   - apps/mobile/ · docs/ · *.md · .github/   서버에 실리지 않는다
#   - packages/screen-worker/                  맥 미니에서 도는 화면 일꾼. 서버 이미지에 들어가지 않는다(Dockerfile이 복사하지 않음).
#       2026-11-12 11:12 푸시(5cddb683, 일꾼 파일만)가 이 판단에 걸려 방송 중에 서버 백업·이미지 빌드를 돌렸다(D-RETRO-33)
#   - scripts/deploy/                          맥 미니에서 도는 내보내기 스크립트. 서버에서 도는 lg-apply.sh는 배포 때마다 새로 올린다(mini-deploy.sh)
# worker(화면 일꾼을 갱신할 까닭): packages/screen-worker/ 가운데 시험(tests/)과 문서(*.md)가 아닌 것.
set -u
case "${1:-}" in
  server) grep -v -E '^$|^(apps/mobile/|docs/|\.github/|packages/screen-worker/|scripts/deploy/)' | grep -v -E '\.md$' ;;
  worker) grep -E '^packages/screen-worker/' | grep -v -E '^packages/screen-worker/tests/' | grep -v -E '\.md$' ;;
  *) echo "쓰는 법: ship-changed.sh server|worker < 파일 목록" >&2; exit 2 ;;
esac
