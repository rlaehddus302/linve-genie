#!/bin/bash
# 맥 미니에서 돈다: 소스 묶음(/tmp/lg-src.tgz)을 S3에 올리고, 운영 서버(EC2)에 SSM으로 lg-apply.sh를 돌려 결과를 보인다 (D-CI-01).
# 쓰는 법: git archive <SHA> -- . ':!harness' ':!tests/e2e' ':!tests/adversarial' | gzip > /tmp/lg-src.tgz && bash scripts/deploy/mini-deploy.sh <SHA> '<메모>'
# 맥 미니의 AWS 자격(배포 역할)이 있어야 한다 — 다른 맥에서는 직접 부르지 않고 main에 푸시하면 맥 미니 자동 배포가 부른다.
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
SHA="$1"; MSG="$2"
B=s3://livegenie-backup-445363794351/deploy
aws s3 cp --quiet /tmp/lg-src.tgz $B/lg-src.tgz
U=$(aws s3 presign $B/lg-src.tgz --expires-in 3600)
A=$(aws s3 presign $B/lg-apply.sh --expires-in 3600)
python3 - "$U" "$A" "$SHA" "$MSG" > /tmp/lg-ssm.json <<'PY'
import json,sys
u,a,sha,msg=sys.argv[1:]
cmd=f"curl -fsSL -o /tmp/lg-apply.sh '{a}' && bash /tmp/lg-apply.sh '{u}' {sha} '{msg}'"
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
aws ssm get-command-invocation --command-id $CID --instance-id i-06c97e0f4cef15b0a --query StandardOutputContent --output text | tail -8
aws ssm get-command-invocation --command-id $CID --instance-id i-06c97e0f4cef15b0a --query StandardErrorContent --output text | tail -5
[ "$ST" = Success ] || { echo "운영 배포 실패: $ST"; exit 1; }
