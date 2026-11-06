#!/usr/bin/env bash
# 가입 문자 인증(네이버 클라우드 SENS, D-UX3-30·D-REAL-07)을 운영 서버에 켠다.
# 판매자(운영자)가 맥에서 직접 돌린다. 인증키 둘은 화면에 보이지 않게 입력받고,
# SSM Parameter Store(SecureString)에 넣은 뒤 서버가 거기서 읽어 /opt/livegenie/.env에 쓴다.
# 비밀값은 명령 기록·SSM 명령 기록에 남지 않는다.
#
# 사용: bash deploy/ec2/set-sms-env.sh <SENS 서비스 ID> <보내는 번호>
#   예: bash deploy/ec2/set-sms-env.sh ncp:sms:kr:123456789:livegenie-signup 01012345678
set -euo pipefail

REGION=${REGION:-ap-northeast-2}
PREFIX=${LG_SSM_PREFIX:-/livegenie/prod}
NAME_TAG=${LG_NAME_TAG:-livegenie-prod}
SERVICE_ID=${1:?SENS 서비스 ID(ncp:sms:kr:…)를 적어 주세요}
FROM=${2:?SENS에 등록한 보내는 번호를 적어 주세요}

[[ $SERVICE_ID =~ ^ncp:sms:kr:[0-9]+:[A-Za-z0-9_-]+$ ]] || { echo "서비스 ID 모양이 아니에요: $SERVICE_ID"; exit 1; }
FROM=${FROM//-/}
[[ $FROM =~ ^[0-9]{8,12}$ ]] || { echo "보내는 번호는 숫자 8~12자리여야 해요"; exit 1; }

IID=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=$NAME_TAG" Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
[[ $IID == i-* ]] || { echo "운영 서버($NAME_TAG)를 찾지 못했어요"; exit 1; }

read -rsp "Access Key ID 붙여넣기(화면에 안 보여요): " ACCESS; echo
read -rsp "Secret Key 붙여넣기(화면에 안 보여요): " SECRET; echo
[[ -n $ACCESS && -n $SECRET ]] || { echo "인증키가 비었어요"; exit 1; }

aws ssm put-parameter --region "$REGION" --name "$PREFIX/sms-ncp-access-key" --type SecureString --overwrite --value "$ACCESS" >/dev/null
aws ssm put-parameter --region "$REGION" --name "$PREFIX/sms-ncp-secret-key" --type SecureString --overwrite --value "$SECRET" >/dev/null
unset ACCESS SECRET
echo "인증키를 SSM에 넣었어요. 서버에 적용하는 중…"

REMOTE=$(cat <<EOF
set -e
F=/opt/livegenie/.env
g() { aws ssm get-parameter --region $REGION --name "\$1" --with-decryption --query Parameter.Value --output text; }
A=\$(g $PREFIX/sms-ncp-access-key); S=\$(g $PREFIX/sms-ncp-secret-key)
cp -p \$F \$F.bak-sms
sed -i '/^#\{0,1\} *LIVEJJIM_SMS_\(NCP_ACCESS_KEY\|NCP_SECRET_KEY\|SENS_SERVICE_ID\|FROM\)=/d' \$F
printf 'LIVEJJIM_SMS_NCP_ACCESS_KEY=%s\nLIVEJJIM_SMS_NCP_SECRET_KEY=%s\nLIVEJJIM_SMS_SENS_SERVICE_ID=%s\nLIVEJJIM_SMS_FROM=%s\n' "\$A" "\$S" '$SERVICE_ID' '$FROM' >> \$F
chmod 600 \$F
/usr/local/bin/lg-compose up -d --force-recreate app >/dev/null 2>&1
for i in \$(seq 1 60); do /usr/local/bin/lg-compose exec -T app node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null && { echo LG-SMS-READY; exit 0; }; sleep 3; done
echo LG-SMS-NOT-READY; /usr/local/bin/lg-compose logs --tail 30 app | grep -v -i 'key\|secret' || true
EOF
)
PARAMS=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()]}))' <<<"$REMOTE")
CID=$(aws ssm send-command --region "$REGION" --instance-ids "$IID" --document-name AWS-RunShellScript \
  --parameters "$PARAMS" --query Command.CommandId --output text)
for _ in $(seq 1 40); do
  sleep 4
  ST=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" --query Status --output text 2>/dev/null || echo Pending)
  [[ $ST == Pending || $ST == InProgress || $ST == Delayed ]] || break
done
OUT=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" --query StandardOutputContent --output text)
if grep -q LG-SMS-READY <<<"$OUT"; then
  echo "끝났어요. 가입 문자 인증이 켜졌어요."
else
  echo "서버가 준비되지 않았어요($ST). 아래 기록을 봐 주세요. 옛 설정은 /opt/livegenie/.env.bak-sms에 있어요."
  echo "$OUT"
  exit 1
fi
