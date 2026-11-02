#!/bin/bash
# 매일 04:00(KST) DB 백업 (systemd livegenie-backup.timer → livegenie-backup.service). update.sh도 먼저 부른다.
# db 컨테이너의 pg_dump(서버와 같은 판)로 사용자 정의 형식(-Fc, 압축 없이) → gzip → /opt/livegenie/backups/db → S3.
#   파일: livejjim-YYYYMMDD-HHMMSS.dump.gz (UTC). S3 위치: s3://$LJ_BACKUP_BUCKET/postgres/
#   복구: gunzip -c livejjim-….dump.gz > x.dump && pg_restore --no-owner --dbname "$DATABASE_URL" x.dump (docs/DEPLOY.md 6절)
# 로컬은 7일치만 둔다 — 단, S3에 올리기까지 성공한 날에만 지운다(올리기가 실패하면 아무것도 지우지 않는다).
# 마스터 키는 백업에 넣지 않는다(SSM에 따로, DEPLOY.md 7절). 백업에는 봉인 전 채팅 원문이 있다(D-012, S3 30일 수명).
set -Eeuo pipefail
umask 077
LG_ROOT="${LG_ROOT:-/opt/livegenie}"
DIR="$LG_ROOT/backups/db"
KEEP_DAYS=7

main() {
  local bucket ts file
  # 끝날 때 지우는 trap이 함수 밖(EXIT)에서 읽으므로 전역 (set -u — local이면 "unbound variable"로 실패)
  part=""
  bucket=$(sed -n 's/^LJ_BACKUP_BUCKET=//p' "$LG_ROOT/.env" | head -n1)
  install -d -m 0700 "$DIR"
  ts=$(date -u +%Y%m%d-%H%M%S)
  file="$DIR/livejjim-$ts.dump.gz"
  part="$file.part"
  trap 'rm -f "$part"' EXIT
  lg-compose exec -T db pg_dump -U livejjim -d livejjim -Fc -Z0 | gzip -6 >"$part"
  gzip -t "$part"
  mv "$part" "$file"
  echo "백업을 만들었어요: $file ($(du -h "$file" | cut -f1))"
  if [ -z "$bucket" ]; then
    echo "LJ_BACKUP_BUCKET이 비어 S3에 올리지 못했어요. 로컬 백업은 지우지 않아요." >&2
    return 1
  fi
  aws s3 cp --only-show-errors "$file" "s3://$bucket/postgres/$(basename "$file")"
  echo "S3에 올렸어요: s3://$bucket/postgres/$(basename "$file")"
  find "$DIR" -maxdepth 1 -name 'livejjim-*.dump.gz' -mtime +$((KEEP_DAYS - 1)) -print -delete
}

main "$@"
