#!/bin/bash
# 서버가 살아났는지 본다(bootstrap.sh·update.sh가 부른다). 성공 0, 실패 1.
#   1) 컨테이너 안 http://127.0.0.1:3000/health — 최대 15분(첫 빌드 뒤 시작·마이그레이션)
#   2) 밖에서 https://<LJ_DOMAIN>/health — 최대 20분(인증서 발급·탄력적 IP 연결을 기다림)
set -Eeuo pipefail
LG_ROOT="${LG_ROOT:-/opt/livegenie}"

main() {
  local domain i
  domain=$(sed -n 's/^LJ_DOMAIN=//p' "$LG_ROOT/.env" | head -n1)
  for ((i = 0; i < 90; i++)); do
    if lg-compose exec -T app node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
      break
    fi
    sleep 10
  done
  if [ "$i" -ge 90 ]; then
    echo "서버가 15분 안에 살아나지 않았어요. 최근 기록:" >&2
    lg-compose ps >&2 || true
    lg-compose logs --tail 40 app >&2 || true
    return 1
  fi
  for ((i = 0; i < 120; i++)); do
    if curl -fsS --max-time 10 -o /dev/null "https://$domain/health"; then return 0; fi
    sleep 10
  done
  echo "https://$domain/health 에 닿지 않아요(주소의 IP·보안 그룹 80·443·인증서 기록을 보세요)." >&2
  lg-compose logs --tail 40 caddy >&2 || true
  return 1
}

main "$@"
