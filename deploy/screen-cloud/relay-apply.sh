#!/usr/bin/env bash
# 클라우드 화면 일꾼용 유튜브 프록시 중계를 켠다 (D-SCR-CLOUD-01). 한 번만 돌리면 된다. 다시 돌려도 같은 결과.
#  1) 일꾼 서버용 보안 그룹 livegenie-screen-worker (들어오는 것 없음)
#  2) 운영 EC2 보안 그룹에 "그 그룹에서 오는 tcp 18889만" 허용
#  3) 운영 EC2에 lg-yt-relay.socket/.service (172.31.62.27:18889 → 맥 미니 터널 끝 172.17.0.1:18888)
# 되돌리기: relay-revert.sh
set -euo pipefail
export AWS_PROFILE=${AWS_PROFILE:-livegenie} AWS_REGION=${AWS_REGION:-ap-northeast-2}
cd "$(dirname "$0")"
PROD=i-06c97e0f4cef15b0a PROD_SG=sg-0009031d99fde05ff VPC=vpc-0b3d40f1c78990809

SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=livegenie-screen-worker --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name livegenie-screen-worker --description "livegenie cloud screen worker (egress only)" --vpc-id $VPC --query GroupId --output text)
  aws ec2 create-tags --resources "$SG" --tags Key=Name,Value=livegenie-screen-worker
fi
echo "일꾼 보안 그룹: $SG"
aws ec2 authorize-security-group-ingress --group-id $PROD_SG \
  --ip-permissions "IpProtocol=tcp,FromPort=18889,ToPort=18889,UserIdGroupPairs=[{GroupId=$SG,Description=screen-worker-yt-proxy}]" >/dev/null 2>&1 \
  && echo "운영 보안 그룹: 18889 허용(일꾼 그룹만)" || echo "운영 보안 그룹: 이미 허용됨"

S1=$(base64 < lg-yt-relay.socket | tr -d '\n'); S2=$(base64 < lg-yt-relay.service | tr -d '\n')
CMDS=$(python3 -c 'import json,sys; print(json.dumps({"commands": sys.argv[1:]}))' \
  "echo $S1 | base64 -d > /etc/systemd/system/lg-yt-relay.socket" \
  "echo $S2 | base64 -d > /etc/systemd/system/lg-yt-relay.service" \
  "systemctl daemon-reload && systemctl enable --now lg-yt-relay.socket && systemctl is-active lg-yt-relay.socket" \
  "curl -s -o /dev/null -w 'relay-youtube %{http_code} %{time_total}s\n' -m 20 -x http://172.31.62.27:18889 https://www.youtube.com/")
CID=$(aws ssm send-command --instance-ids $PROD --document-name AWS-RunShellScript --parameters "$CMDS" --query Command.CommandId --output text)
for _ in $(seq 1 20); do
  S=$(aws ssm get-command-invocation --command-id "$CID" --instance-id $PROD --query Status --output text 2>/dev/null || true)
  case "$S" in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 2
done
aws ssm get-command-invocation --command-id "$CID" --instance-id $PROD --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
