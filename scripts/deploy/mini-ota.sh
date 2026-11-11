#!/bin/bash
# 앱 화면 새 버전을 운영 서버에 올린다 (D-OTA-01) — 맥 미니 자동 내보내기(ship.yml)가 부른다.
# 쓰는 법: bash scripts/deploy/mini-ota.sh <ios|android> <앱 버전 지문>
#   1) apps/mobile에서 그 휴대폰용 화면 묶음을 만든다(expo export) + 앱 설정(expo config, 빌드 스위치 extra 포함)
#   2) 묶다 → S3 → 운영 서버(EC2)에 SSM으로 /opt/livegenie/app-updates/<platform>/<지문>/<id>/에 풀고 current를 바꾼다
#   id는 묶음 내용에서 나온다 — 같은 화면이면 같은 id라 휴대폰이 다시 받지 않는다. 옛 묶음은 최근 3개만 남긴다.
# 환경값은 그 휴대폰 앱을 빌드할 때와 같아야 한다(ship.yml이 같은 값으로 부른다): EXPO_PUBLIC_SERVER_URL, NODE_ENV, LIVEGENIE_NOTICE, LIVEGENIE_SMS
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
PLATFORM="$1"; RUNTIME="$2"
case "$PLATFORM" in ios|android) ;; *) echo "플랫폼은 ios 또는 android"; exit 2 ;; esac
[[ "$RUNTIME" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "지문 모양이 이상해요: $RUNTIME"; exit 2; }
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/update"

cd "$ROOT/apps/mobile"
npx expo export --platform "$PLATFORM" --output-dir "$OUT" > "$WORK/export.log" 2>&1 || { tail -30 "$WORK/export.log"; exit 1; }
npx expo config --type public --json > "$OUT/expoConfig.json"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/created-at"
ID=$(cat "$OUT/metadata.json" "$OUT/expoConfig.json" | shasum -a 256 | python3 -c 'import sys;h=sys.stdin.read()[:32];print(f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}")')
tar -czf "$WORK/ota.tgz" -C "$OUT" .
echo "화면 묶음 $PLATFORM $RUNTIME $ID ($(du -h "$WORK/ota.tgz" | cut -f1))"

B=s3://livegenie-backup-445363794351/deploy
aws s3 cp --quiet "$WORK/ota.tgz" "$B/ota-$PLATFORM.tgz"
U=$(aws s3 presign "$B/ota-$PLATFORM.tgz" --expires-in 3600)
python3 - "$U" "$PLATFORM" "$RUNTIME" "$ID" > "$WORK/ssm.json" <<'PY'
import json,sys
u,platform,runtime,uid=sys.argv[1:]
d=f"/opt/livegenie/app-updates/{platform}/{runtime}"
cmd=(f"set -e; mkdir -p {d}; "
     f"if [ ! -f {d}/{uid}/metadata.json ]; then rm -rf {d}/{uid}.tmp && mkdir {d}/{uid}.tmp && curl -fsSL '{u}' | tar -xz -C {d}/{uid}.tmp && mv {d}/{uid}.tmp {d}/{uid}; fi; "
     f"echo {uid} > {d}/current.tmp && mv {d}/current.tmp {d}/current; "
     f"chmod -R go+rX /opt/livegenie/app-updates; "
     f"cd {d} && ls -1dt */ | sed 's#/$##' | grep -v '^{uid}$' | tail -n +3 | xargs -r rm -rf; "
     f"echo OTA-OK {uid}")
print(json.dumps({"InstanceIds":["i-06c97e0f4cef15b0a"],"DocumentName":"AWS-RunShellScript","TimeoutSeconds":600,"Parameters":{"commands":[cmd],"executionTimeout":["600"]}}))
PY
CID=$(aws ssm send-command --cli-input-json "file://$WORK/ssm.json" --query Command.CommandId --output text)
for i in $(seq 1 60); do
  ST=$(aws ssm get-command-invocation --command-id "$CID" --instance-id i-06c97e0f4cef15b0a --query Status --output text 2>/dev/null || echo Pending)
  case $ST in Success|Failed|Cancelled|TimedOut) break;; esac
  sleep 3
done
aws ssm get-command-invocation --command-id "$CID" --instance-id i-06c97e0f4cef15b0a --query StandardOutputContent --output text | tail -3
[ "$ST" = Success ] || { aws ssm get-command-invocation --command-id "$CID" --instance-id i-06c97e0f4cef15b0a --query StandardErrorContent --output text | tail -5; echo "화면 새 버전 올리기 실패: $ST"; exit 1; }

# 서버가 정말 그 묶음을 주는지 확인
curl -fsS -H "expo-platform: $PLATFORM" -H "expo-runtime-version: $RUNTIME" -H 'expo-protocol-version: 1' https://livegenie.kr/app-updates/manifest | grep -q "\"id\":\"$ID\"" \
  && echo "운영 서버가 새 화면을 줘요: $PLATFORM $ID" || { echo "운영 서버가 새 화면을 주지 않아요(서버 배포 전일 수 있다)"; exit 1; }
