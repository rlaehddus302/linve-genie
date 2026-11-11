#!/usr/bin/env bash
# 실제 방송에 화면 일꾼을 켜고, 확정 상품을 라이브지니 서버에 등록한다(D-SCR-01).
# 토큰은 AWS SSM에서 꺼내 임시 파일(600)로만 넘기고 끝나면 지운다. 먼저: aws sso login --sso-session livegenie
# 사용: bash live.sh <유튜브 라이브 주소>
#   전제: 판매자가 앱에서 방송을 시작하고 이 유튜브 주소를 연결해 둠(아니면 서버가 404 NOT_LINKED로 거절하고 events.jsonl에 남김)
set -euo pipefail
cd "$(dirname "$0")"
URL=${1:?유튜브 라이브 주소를 적어 주세요}
export AWS_PROFILE=${AWS_PROFILE:-livegenie}
LG_SERVER=${LG_SERVER:-https://3-34-170-138.sslip.io}
# 토큰은 나만 읽는 임시 파일로 넘기고(sw.post가 파일에서 읽음) 끝나면 지운다
TOKEN_FILE=$(mktemp); chmod 600 "$TOKEN_FILE"; trap 'rm -f "$TOKEN_FILE"' EXIT
aws ssm get-parameter --region ap-northeast-2 --name /livegenie/prod/screen-worker-token --with-decryption --query Parameter.Value --output text > "$TOKEN_FILE"
[ $(wc -c < "$TOKEN_FILE") -ge 32 ] || { echo "토큰을 못 읽었어요. aws sso login --sso-session livegenie 먼저"; exit 1; }
curl -fsS -o /dev/null "$LG_SERVER/health" || { echo "서버($LG_SERVER)가 응답하지 않아요"; exit 1; }
OUT=runs/live_$(date +%Y%m%d_%H%M)
echo "화면 일꾼 시작 → $OUT (서버 등록 결과는 $OUT/post.jsonl)"
.venv/bin/python -m sw "$URL" --out "$OUT" --post "$LG_SERVER" --token-file "$TOKEN_FILE"
