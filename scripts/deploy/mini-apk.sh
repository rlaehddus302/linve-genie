#!/bin/bash
# 안드로이드 앱 내려받기 링크 채우기 (D-APK-LINK-01) — 맥 미니 자동 내보내기(ship.yml)가 안드로이드 수동 실행에서 부른다.
#   S3 share/livegenie.apk(맥 미니가 마지막으로 만든 출시 APK) → SSM으로 운영 서버(EC2) /opt/livegenie/app-updates/android.apk
#   서버가 https://livegenie.kr/app-updates/android.apk 로 내려준다. 같은 파일이면 다시 옮기지 않는다.
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
OBJ=s3://livegenie-backup-445363794351/share/livegenie.apk
SIZE=$(aws s3api head-object --bucket livegenie-backup-445363794351 --key share/livegenie.apk --query ContentLength --output text)
LINK=https://livegenie.kr/app-updates/android.apk
NOW=$(curl -fsSI "$LINK" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' || true)
if [ "$NOW" = "$SIZE" ] && [ "${APK_FORCE:-no}" != yes ]; then echo "내려받기 링크가 이미 같은 APK예요 ($SIZE 바이트): $LINK"; exit 0; fi
U=$(aws s3 presign "$OBJ" --expires-in 3600)
python3 - "$U" > "$WORK/ssm.json" <<'PY'
import json,sys
u=sys.argv[1]
d="/opt/livegenie/app-updates"
cmd=(f"set -e; mkdir -p {d}; curl -fsSL '{u}' -o {d}/android.apk.tmp && chmod 644 {d}/android.apk.tmp && mv {d}/android.apk.tmp {d}/android.apk; "
     f"echo APK-OK $(stat -c %s {d}/android.apk)")
print(json.dumps({"InstanceIds":["i-06c97e0f4cef15b0a"],"DocumentName":"AWS-RunShellScript","TimeoutSeconds":600,"Parameters":{"commands":[cmd],"executionTimeout":["600"]}}))
PY
CID=$(aws ssm send-command --cli-input-json "file://$WORK/ssm.json" --query Command.CommandId --output text)
for i in $(seq 1 60); do
  ST=$(aws ssm get-command-invocation --command-id "$CID" --instance-id i-06c97e0f4cef15b0a --query Status --output text 2>/dev/null || echo Pending)
  case $ST in Success|Failed|Cancelled|TimedOut) break;; esac
  sleep 3
done
aws ssm get-command-invocation --command-id "$CID" --instance-id i-06c97e0f4cef15b0a --query StandardOutputContent --output text | tail -3
[ "$ST" = Success ] || { aws ssm get-command-invocation --command-id "$CID" --instance-id i-06c97e0f4cef15b0a --query StandardErrorContent --output text | tail -5; echo "APK 올리기 실패: $ST"; exit 1; }
GOT=$(curl -fsSI "$LINK" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
[ "$GOT" = "$SIZE" ] && echo "안드로이드 앱 내려받기 링크: $LINK ($SIZE 바이트)" || { echo "링크가 새 APK를 주지 않아요(받은 크기 ${GOT:-없음}, 서버 배포 전일 수 있다)"; exit 1; }
