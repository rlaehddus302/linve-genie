#!/usr/bin/env bash
# relay-apply.sh 되돌리기: 운영 EC2의 중계를 끄고 지우고, 운영 보안 그룹의 18889 허용을 뺀다(일꾼 보안 그룹은 남김)
set -euo pipefail
export AWS_PROFILE=${AWS_PROFILE:-livegenie} AWS_REGION=${AWS_REGION:-ap-northeast-2}
PROD=i-06c97e0f4cef15b0a PROD_SG=sg-0009031d99fde05ff
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=livegenie-screen-worker --query 'SecurityGroups[0].GroupId' --output text)
[ "$SG" != "None" ] && aws ec2 revoke-security-group-ingress --group-id $PROD_SG \
  --ip-permissions "IpProtocol=tcp,FromPort=18889,ToPort=18889,UserIdGroupPairs=[{GroupId=$SG}]" >/dev/null && echo "18889 허용 뺌"
aws ssm send-command --instance-ids $PROD --document-name AWS-RunShellScript --parameters \
  '{"commands":["systemctl disable --now lg-yt-relay.socket lg-yt-relay.service || true","rm -f /etc/systemd/system/lg-yt-relay.socket /etc/systemd/system/lg-yt-relay.service","systemctl daemon-reload"]}' \
  --query Command.CommandId --output text >/dev/null && echo "중계 끔"
