#!/bin/bash
# 맥 미니에서 돈다: 소스 묶음(/tmp/lg-src.tgz)을 S3에 올리고, 운영 서버(EC2)에 SSM으로 lg-apply.sh를 돌려 결과를 보인다 (D-CI-01).
# 쓰는 법: git archive <SHA> -- . ':!harness' ':!tests/e2e' ':!tests/adversarial' | gzip > /tmp/lg-src.tgz && bash scripts/deploy/mini-deploy.sh <SHA> '<메모>' [switch|stage-only] [이미지 묶음 파일]
#   switch(기본)      대기 자리에 띄워 확인하고 올린다 (두 자리 교대, D-RETRO-35~39 · docs/DEPLOY.md 6-2절)
#   stage-only        대기 자리에 띄워 확인까지만 — 방송 중(D-RETRO-37). 올리기는 방송이 끝난 뒤 같은 커밋으로 switch를 다시 부르면 된다(이미지를 다시 만들지 않는다)
#   이미지 묶음 파일   밖에서 만든 이미지(scripts/deploy/mini-image.sh 가 만든 docker save | gzip). 주면 서버는 받아 오기만 하고, 안 주면 서버에서 만든다(복기 E1)
# 끝 줄에 서버가 알린 결과를 그대로 찍는다: LG-SWITCHED <자리> <커밋> · LG-STAGED <자리> <커밋> · LG-STAGE-SKIPPED <까닭> (그 밖이면 실패로 끝난다)
# 맥 미니의 AWS 자격(배포 역할)이 있어야 한다 — 다른 맥에서는 직접 부르지 않고 main에 푸시하면 맥 미니 자동 배포가 부른다.
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
SHA="$1"; MSG="$2"; MODE="${3:-switch}"; IMAGE_FILE="${4:-}"
case "$MODE" in switch | stage-only) ;; *) echo "모르는 방식이에요: $MODE (switch · stage-only)"; exit 2 ;; esac
B=s3://livegenie-backup-445363794351/deploy
aws s3 cp --quiet /tmp/lg-src.tgz $B/lg-src.tgz
# 서버에서 도는 적용 스크립트도 저장소 것이 기준이다 — 매번 올린다
aws s3 cp --quiet "$(dirname "$0")/lg-apply.sh" $B/lg-apply.sh
U=$(aws s3 presign $B/lg-src.tgz --expires-in 3600)
A=$(aws s3 presign $B/lg-apply.sh --expires-in 3600)
I=-; ISHA=
if [ -n "$IMAGE_FILE" ]; then
  # 늘 같은 이름으로 덮어쓴다(버킷에 쌓이지 않게). 서버는 받은 묶음의 체크섬과 태그(livegenie-app:<커밋 12자>)를 확인한다
  ISHA=$(shasum -a 256 "$IMAGE_FILE" | cut -d' ' -f1)
  aws s3 cp --quiet "$IMAGE_FILE" $B/lg-image.tar.gz
  I=$(aws s3 presign $B/lg-image.tar.gz --expires-in 3600)
fi
python3 - "$U" "$A" "$SHA" "$MSG" "$MODE" "$I" "$ISHA" > /tmp/lg-ssm.json <<'PY'
import json,sys
u,a,sha,msg,mode,image,isha=sys.argv[1:]
cmd=f"curl -fsSL -o /tmp/lg-apply.sh '{a}' && bash /tmp/lg-apply.sh '{u}' {sha} '{msg}' {mode} '{image}' '{isha}'"
print(json.dumps({"InstanceIds":["i-06c97e0f4cef15b0a"],"DocumentName":"AWS-RunShellScript","TimeoutSeconds":3600,"Parameters":{"commands":[cmd],"executionTimeout":["3600"]}}))
PY
CID=$(aws ssm send-command --cli-input-json file:///tmp/lg-ssm.json --query Command.CommandId --output text)
echo "cmd $CID"
for i in $(seq 1 120); do
  ST=$(aws ssm get-command-invocation --command-id $CID --instance-id i-06c97e0f4cef15b0a --query Status --output text 2>/dev/null || echo Pending)
  case $ST in Success|Failed|Cancelled|TimedOut) break;; esac
  sleep 15
done
echo $ST
OUT=$(aws ssm get-command-invocation --command-id $CID --instance-id i-06c97e0f4cef15b0a --query StandardOutputContent --output text)
echo "$OUT" | tail -12
aws ssm get-command-invocation --command-id $CID --instance-id i-06c97e0f4cef15b0a --query StandardErrorContent --output text | tail -40
[ "$ST" = Success ] || { echo "운영 배포 실패: $ST"; exit 1; }
RESULT=$(echo "$OUT" | grep -E '^LG-(SWITCHED|STAGED|STAGE-SKIPPED) ' | tail -n 1 || true)
[ -n "$RESULT" ] || { echo "운영 서버가 결과 줄(LG-SWITCHED·LG-STAGED)을 알리지 않았어요"; exit 1; }
echo "$RESULT"
