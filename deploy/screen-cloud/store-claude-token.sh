#!/usr/bin/env bash
# Claude 구독 토큰을 만들어 SSM(/livegenie/prod/claude-oauth-token, 암호화)에만 넣는다 (D-SCR-CLOUD-01).
# 토큰은 화면에 다시 찍지 않고, 파일·기록에도 남기지 않는다. 사람이 자기 터미널에서 직접 돌린다.
set -euo pipefail
export AWS_PROFILE=${AWS_PROFILE:-livegenie} AWS_REGION=${AWS_REGION:-ap-northeast-2}
echo "1) 브라우저에서 로그인하면 토큰이 나옵니다."
claude setup-token
echo
read -r -s -p "2) 방금 나온 토큰(sk-ant-oat…)을 붙여 넣고 Enter: " TOKEN; echo
case "$TOKEN" in sk-ant-*) ;; *) echo "토큰 모양이 아니에요. 다시 해 주세요."; exit 1;; esac
aws ssm put-parameter --name /livegenie/prod/claude-oauth-token --type SecureString --overwrite --value "$TOKEN" >/dev/null
unset TOKEN
echo "저장했어요 (/livegenie/prod/claude-oauth-token)."
