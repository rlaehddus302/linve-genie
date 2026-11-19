#!/usr/bin/env bash
# 클라우드 화면 일꾼 서버 한 대를 띄운다 (D-SCR-CLOUD-01). 먼저 relay-apply.sh.
# 이 작업 폴더의 packages/screen-worker + deploy/screen-cloud를 묶어 S3에 잠깐 올리고(1시간 주소), 서버가 받아 설치한다.
set -euo pipefail
export AWS_PROFILE=${AWS_PROFILE:-livegenie} AWS_REGION=${AWS_REGION:-ap-northeast-2}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BUCKET=livegenie-backup-445363794351 KEY=bench-tmp/screen-worker-cloud.tgz
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=livegenie-screen-worker --query 'SecurityGroups[0].GroupId' --output text)
[ "$SG" != "None" ] || { echo "보안 그룹이 없어요. relay-apply.sh 먼저"; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
tar czf "$TMP/b.tgz" -C "$ROOT" --exclude .venv --exclude runs --exclude __pycache__ packages/screen-worker deploy/screen-cloud
aws s3 cp "$TMP/b.tgz" "s3://$BUCKET/$KEY" --only-show-errors
URL=$(aws s3 presign "s3://$BUCKET/$KEY" --expires-in 3600)
python3 - "$ROOT/deploy/screen-cloud/worker-setup.sh" "$URL" > "$TMP/ud.sh" <<'PY'
import sys; print(open(sys.argv[1]).read().replace("__BUNDLE_URL__", sys.argv[2]))
PY
aws ec2 run-instances --image-id ami-01d3ac95922e89193 --instance-type c7i.4xlarge \
  --iam-instance-profile Name=livegenie-ec2 --security-group-ids "$SG" --subnet-id subnet-0290495cae13f9e15 \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=40,VolumeType=gp3,DeleteOnTermination=true}' \
  --user-data "file://$TMP/ud.sh" --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=livegenie-screen-worker}]' \
  --query 'Instances[0].InstanceId' --output text
