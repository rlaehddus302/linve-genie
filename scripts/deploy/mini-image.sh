#!/bin/bash
# 서버 이미지를 운영 서버 밖(맥 미니)에서 만든다 (복기 E1, D-RETRO-35) — 만든 묶음을 mini-deploy.sh 가 S3로 올리고 서버는 받아 오기만 한다.
# 쓰는 법: bash scripts/deploy/mini-image.sh <커밋 40자> [묶음을 둘 파일(기본 /tmp/lg-image.tar.gz)]
#   - 그 커밋을 깨끗한 폴더에 풀어 만든다(작업 폴더의 손댄 파일·.env 가 섞이지 않게). 태그는 livegenie-app:<커밋 12자> — 서버의 switch.sh 가 같은 태그를 찾는다.
#   - 운영 서버(t4g, arm64)와 맥 미니(애플 실리콘)가 같은 CPU라 그대로 돈다. 그래도 --platform linux/arm64 로 못 박는다.
#   - 비밀값은 이미지에 들어가지 않는다(Dockerfile이 ENV·ARG에 두지 않고 .dockerignore가 .env 를 뺀다).
# 주의: 이미지 빌드는 CPU를 몇 분 쓴다. 이 맥 미니에서 화면 일꾼이 방송을 보고 있으면 상품 등록이 느려진다(D-RETRO-34) — 내보내기(ship.yml)는 방송 중이면 부르지 않는다.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
SHA="$1"; OUT="${2:-/tmp/lg-image.tar.gz}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "커밋 40자를 주세요"; exit 2; }
DOCKER="${LG_DOCKER:-docker}"
TAG="livegenie-app:${SHA:0:12}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git archive "$SHA" -- . ':!harness' ':!tests/e2e' ':!tests/adversarial' | tar -x -C "$WORK"
"$DOCKER" build --platform "${LG_IMAGE_PLATFORM:-linux/arm64}" -t "$TAG" -f "$WORK/Dockerfile" "$WORK"
"$DOCKER" save "$TAG" | gzip -1 > "$OUT.part"
mv "$OUT.part" "$OUT"
echo "이미지 묶음: $OUT ($(du -h "$OUT" | cut -f1)) · $TAG"
