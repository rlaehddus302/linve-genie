#!/bin/bash
# Apply a source snapshot to /opt/livegenie/src as a new "deploy" commit, keep the server-only Caddyfile, then run update.sh.
# Usage: lg-apply.sh <presigned tgz url> <source commit> <message>
set -Eeuo pipefail
URL="$1"; SRC_COMMIT="$2"; MSG="$3"
S=/opt/livegenie/src
KEEP=/opt/livegenie/Caddyfile.server-keep
trap 'echo "LG-APPLY-FAIL line $LINENO"' ERR

echo "before: $(git -C "$S" log --oneline -1)"
# only the known server-only change may be present
DIRTY=$(git -C "$S" status --porcelain --ignored | grep -v ' deploy/ec2/Caddyfile$' || true)
if [ -n "$DIRTY" ]; then echo "unexpected changes:"; echo "$DIRTY"; exit 3; fi

curl -fsSL -o /tmp/lg-src.tgz "$URL"
rm -rf /tmp/lg-src && mkdir /tmp/lg-src && tar -xzf /tmp/lg-src.tgz -C /tmp/lg-src
[ -f /tmp/lg-src/package.json ] && [ -f /tmp/lg-src/deploy/ec2/update.sh ]

find "$S" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a /tmp/lg-src/. "$S"/
git -C "$S" add -A
# 같은 소스를 다시 내보내면 바뀐 게 없다 — 그때는 커밋만 건너뛰고 나머지(Caddyfile 되돌리기·update.sh)는 그대로 한다
if git -C "$S" diff --cached --quiet; then echo "no source change — skip commit"; else
  git -C "$S" -c user.name=deploy -c user.email=deploy@livegenie.kr commit -q -m "deploy $SRC_COMMIT $MSG"
fi
git -C "$S" show --stat --format='%h %s' HEAD | tail -1
cp "$KEEP" "$S/deploy/ec2/Caddyfile"
chmod -R go+rX "$S"; chmod 0755 "$S/deploy/ec2/"*.sh
echo "after: $(git -C "$S" log --oneline -1)"
git -C "$S" status --porcelain
rm -rf /tmp/lg-src /tmp/lg-src.tgz

echo "== update.sh"
"$S/deploy/ec2/update.sh"
