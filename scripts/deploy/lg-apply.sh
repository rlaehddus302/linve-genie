#!/bin/bash
# Apply a source snapshot to /opt/livegenie/src as a new "deploy" commit, keep the server-only Caddyfile, then switch slots (deploy/ec2/switch.sh).
# Usage: lg-apply.sh <presigned tgz url> <source commit> <message> [mode] [image url] [image sha256]
#   mode       switch(기본) = 대기 자리에 띄워 확인하고 올린다 · stage-only = 띄워 확인까지만(방송 중, D-RETRO-37·복기 E6)
#   image url  밖에서 만든 이미지(docker save | gzip)의 미리 서명한 주소. 비우면(-) 이 서버에서 만든다(지금까지의 방식) — 복기 E1
# 끝나면(switch.sh가 올리고 앞단 확인까지 통과한 뒤) 지금 운영 판을 /opt/livegenie/app-updates/server-commit 에 한 줄로 적는다(D-RETRO-32).
#   서버가 그 폴더를 읽기 전용으로 보고(compose.yaml의 /app-updates) `GET /internal/screen/capabilities`의 commit으로 돌려준다
#   (두 자리 구성에서는 자리마다 LIVEJJIM_COMMIT이 먼저다 — 이 파일은 그 값을 모르는 옛 판을 위한 것).
# 끝 줄: switch.sh의 LG-SWITCHED <자리> <커밋> · LG-STAGED <자리> <커밋> · LG-STAGE-SKIPPED <까닭> · LG-SWITCH-FAIL <단계>, 이 파일의 LG-APPLY-FAIL <까닭>
set -Eeuo pipefail
URL="$1"; SRC_COMMIT="$2"; MSG="$3"; MODE="${4:-switch}"; IMAGE_URL="${5:--}"; IMAGE_SHA="${6:-}"
[[ "$SRC_COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || { echo "LG-APPLY-FAIL bad commit"; exit 2; }
case "$MODE" in switch | stage-only) ;; *) echo "LG-APPLY-FAIL bad mode"; exit 2 ;; esac
[[ "$IMAGE_SHA" =~ ^([0-9a-f]{64})?$ ]] || { echo "LG-APPLY-FAIL bad image sha"; exit 2; }
S=/opt/livegenie/src
KEEP=/opt/livegenie/Caddyfile.server-keep
trap 'echo "LG-APPLY-FAIL line $LINENO"' ERR

echo "before: $(git -C "$S" log --oneline -1)"
# only the known server-only change may be present
DIRTY=$(git -C "$S" status --porcelain --ignored | grep -v ' deploy/ec2/Caddyfile$' || true)
if [ -n "$DIRTY" ]; then echo "unexpected changes:"; echo "$DIRTY"; exit 3; fi

curl -fsSL -o /tmp/lg-src.tgz "$URL"
rm -rf /tmp/lg-src && mkdir /tmp/lg-src && tar -xzf /tmp/lg-src.tgz -C /tmp/lg-src
[ -f /tmp/lg-src/package.json ] && [ -f /tmp/lg-src/deploy/ec2/switch.sh ]

# 두 자리 교대(D-RETRO-36): 서버에만 있는 앞단 설정(Caddyfile.server-keep)이 두 자리를 모두 알아야 한다.
# 옛 설정(reverse_proxy app:3000)인 채로 소스를 바꾸면 새 자리로 보낼 길이 없다 — 소스를 건드리기 전에 멈춘다(docs/DEPLOY.md 6-2절 "처음 적용")
if ! grep -q 'app-a:3000' "$KEEP" || ! grep -q 'app-b:3000' "$KEEP"; then
  echo "앞단 설정 $KEEP 에 app-a:3000 · app-b:3000 이 없어요. 저장소의 deploy/ec2/Caddyfile 처럼 두 자리를 모두 적은 뒤 다시 내보내 주세요."
  echo "LG-APPLY-FAIL caddyfile"; trap - ERR; exit 4
fi

find "$S" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a /tmp/lg-src/. "$S"/
git -C "$S" add -A
# 같은 소스를 다시 내보내면 바뀐 게 없다 — 그때는 커밋만 건너뛰고 나머지(Caddyfile 되돌리기·교체)는 그대로 한다
if git -C "$S" diff --cached --quiet; then echo "no source change — skip commit"; else
  git -C "$S" -c user.name=deploy -c user.email=deploy@livegenie.kr commit -q -m "deploy ${SRC_COMMIT:0:8} $MSG"
fi
git -C "$S" show --stat --format='%h %s' HEAD | tail -1
cp "$KEEP" "$S/deploy/ec2/Caddyfile"
chmod -R go+rX "$S"; chmod 0755 "$S/deploy/ec2/"*.sh
echo "after: $(git -C "$S" log --oneline -1)"
git -C "$S" status --porcelain
rm -rf /tmp/lg-src /tmp/lg-src.tgz

echo "== switch.sh ($MODE)"
ARGS=(--commit "$SRC_COMMIT")
if [ "$IMAGE_URL" != - ] && [ -n "$IMAGE_URL" ]; then
  ARGS+=(--image-url "$IMAGE_URL")
  if [ -n "$IMAGE_SHA" ]; then ARGS+=(--image-sha256 "$IMAGE_SHA"); fi
else
  ARGS+=(--build)
fi
if [ "$MODE" = stage-only ]; then ARGS+=(--stage-only); fi
OUT=$(mktemp)
# 실패하면 switch.sh가 LG-SWITCH-FAIL <단계>를 찍고 0이 아닌 값으로 끝난다 — 여기서도 그대로 실패로 끝낸다
trap - ERR
set +e
"$S/deploy/ec2/switch.sh" "${ARGS[@]}" | tee "$OUT"
RC=${PIPESTATUS[0]}
set -e
LAST=$(tail -n 1 "$OUT"); rm -f "$OUT"
if [ "$RC" -ne 0 ]; then exit "$RC"; fi

case "$LAST" in
  LG-SWITCHED\ *)
    U=/opt/livegenie/app-updates
    mkdir -p "$U"
    echo "$SRC_COMMIT" > "$U/server-commit.tmp" && chmod 0644 "$U/server-commit.tmp" && mv "$U/server-commit.tmp" "$U/server-commit"
    echo "server-commit $SRC_COMMIT"
    ;;
esac
# 맥 미니(mini-deploy.sh)가 끝 줄로 결과를 읽는다
echo "$LAST"
