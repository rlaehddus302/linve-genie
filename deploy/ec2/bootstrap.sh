#!/bin/bash
# 라이브지니 EC2 첫 설치 (deploy/ec2/README.md). EC2 user-data로 넣는다(16KB 한도 — 길게 늘리지 않는다).
# 앞에 export LJ_DOMAIN=… / export LJ_BACKUP_BUCKET=… 줄을 붙여 넘긴다. root로 돈다. 다시 돌려도 안전하다.
# 콘솔(get-console-output)에 남기는 줄: LG-DEPLOYKEY <공개 키> · LG-READY https://<주소> · LG-FAIL <단계> · LG-WARN <뜻>
# 비밀 키·비밀값은 어디에도 찍지 않는다(set -x 금지).
set -Eeuo pipefail
shopt -s inherit_errexit
umask 077

LG_ROOT=/opt/livegenie
LG_SRC=$LG_ROOT/src
LG_ENV=$LG_ROOT/.env
LG_KEY=$LG_ROOT/deploy_key
LG_REPO=${LG_REPO:-git@github.com:unhoyeo/livegenie.git}
LG_BRANCH=${LG_BRANCH:-main}
LG_SSM_PREFIX=${LG_SSM_PREFIX:-/livegenie/prod}
COMPOSE_VERSION=v5.5.1
COMPOSE_SHA_ARM64=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7
COMPOSE_SHA_AMD64=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
BUILDX_VERSION=v0.37.2
BUILDX_SHA_ARM64=efa38cb7aa7db2dbb9ad049b00b0a9737f66f033626177b5a4e845184ad7ab29
BUILDX_SHA_AMD64=982ca20490b45ed1ec8d99795974d3d874a358f75938c9c237305010e6b7e548
# GitHub 공식 ed25519 호스트 키 (docs.github.com "GitHub's SSH key fingerprints")
GITHUB_HOSTKEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

STEP=start
# 표준 출력은 값 돌려주기에 쓰므로 알림은 표준 오류와 콘솔로
say() { echo "$*" >&2; echo "$*" >/dev/console 2>/dev/null || true; }
trap 'rc=$?; say "LG-FAIL $STEP"; exit $rc' ERR
retry() { local n=0; until "$@"; do n=$((n + 1)); [ "$n" -ge 5 ] && return 1; sleep 15; done; }

imds() {
  local t
  t=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  curl -fsS -H "X-aws-ec2-metadata-token: $t" "http://169.254.169.254/latest/meta-data/$1"
}

install_bin() { # $1 주소 $2 체크섬 $3 놓을 곳
  local tmp
  if [ -x "$3" ] && echo "$2  $3" | sha256sum -c --status -; then return 0; fi
  tmp=$(mktemp)
  retry curl -fsSL -o "$tmp" "$1"
  echo "$2  $tmp" | sha256sum -c --status -
  install -m 0755 "$tmp" "$3"
  rm -f "$tmp"
}

step_install() {
  STEP=install
  # 2GB 메모리에서 화면 빌드가 모자라지 않게 스왑 2GB
  if [ ! -f /swapfile ]; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile && mkswap /swapfile >/dev/null
    echo '/swapfile none swap defaults 0 0' >>/etc/fstab
  fi
  swapon --show | grep -q /swapfile || swapon /swapfile
  # AL2023 저장소는 AMI 출시 판에 묶여 있다 — 같은 AMI면 같은 꾸러미 판이 깔린다
  retry dnf install -y -q docker git-core openssh-clients awscli-2 gzip
  local arch carch csha barch bsha
  arch=$(uname -m)
  case "$arch" in
    aarch64) carch=aarch64 csha=$COMPOSE_SHA_ARM64 barch=arm64 bsha=$BUILDX_SHA_ARM64 ;;
    x86_64) carch=x86_64 csha=$COMPOSE_SHA_AMD64 barch=amd64 bsha=$BUILDX_SHA_AMD64 ;;
    *) say "LG-WARN 모르는 CPU $arch"; return 1 ;;
  esac
  install -d -m 0755 /usr/local/lib/docker/cli-plugins
  install_bin "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$carch" \
    "$csha" /usr/local/lib/docker/cli-plugins/docker-compose
  install_bin "https://github.com/docker/buildx/releases/download/$BUILDX_VERSION/buildx-$BUILDX_VERSION.linux-$barch" \
    "$bsha" /usr/local/lib/docker/cli-plugins/docker-buildx
  systemctl enable --now docker
  docker compose version >/dev/null
}

step_deploy_key() {
  STEP=deploy-key
  install -d -m 0700 "$LG_ROOT"
  [ -f "$LG_KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "livegenie-ec2" -f "$LG_KEY"
  chmod 600 "$LG_KEY"
  echo "$GITHUB_HOSTKEY" >"$LG_ROOT/known_hosts"
  say "LG-DEPLOYKEY $(cat "$LG_KEY.pub")"
}

step_clone() {
  STEP=clone
  local ssh_cmd="ssh -i $LG_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$LG_ROOT/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15"
  if [ ! -d "$LG_SRC/.git" ]; then
    local tries=0
    rm -rf "$LG_SRC.part"
    # 배포 키가 GitHub에 등록될 때까지 30초마다, 최대 60분
    until GIT_SSH_COMMAND="$ssh_cmd" git clone -q --branch "$LG_BRANCH" "$LG_REPO" "$LG_SRC.part" 2>/dev/null; do
      rm -rf "$LG_SRC.part"
      tries=$((tries + 1))
      if [ "$tries" -ge 120 ]; then say "LG-WARN 60분 안에 저장소를 받지 못했어요(배포 키 등록 확인)"; return 1; fi
      # 콘솔 출력은 끝부분만 보이므로 10번마다 공개 키를 다시 찍는다
      [ $((tries % 10)) -eq 0 ] && say "LG-DEPLOYKEY $(cat "$LG_KEY.pub")"
      sleep 30
    done
    mv "$LG_SRC.part" "$LG_SRC"
  fi
  git -C "$LG_SRC" config core.sshCommand "$ssh_cmd"
  chmod 0755 "$LG_SRC/deploy/ec2/"*.sh
  ln -sf "$LG_SRC/deploy/ec2/lg-compose.sh" /usr/local/bin/lg-compose
}

# SSM SecureString 하나를 꺼낸다. 없으면 빈 줄 + 0, 권한·연결 문제면 1
ssm_get() {
  local out
  if out=$(aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption --query Parameter.Value --output text 2>&1); then
    printf '%s' "$out"
  elif grep -q ParameterNotFound <<<"$out"; then
    return 0
  else
    say "LG-WARN SSM $1 을 읽지 못했어요(인스턴스 역할 권한 확인)"
    return 1
  fi
}

ssm_put() { # 값은 명령행이 아니라 600 파일로 넘긴다. 이미 있으면 덮어쓰지 않는다
  local f rc=0
  f=$(mktemp)
  printf '{"Name":"%s","Type":"SecureString","Overwrite":false,"Value":"%s","Description":"livegenie prod (bootstrap.sh)"}' "$1" "$2" >"$f"
  aws ssm put-parameter --region "$REGION" --cli-input-json "file://$f" >/dev/null 2>&1 || rc=$?
  rm -f "$f"
  return $rc
}

# SSM에 있으면 그것을, 없으면 $2 명령으로 만들어 SSM에 넣은 값을 돌려준다(인스턴스를 다시 만들어도 같은 키)
ssm_secret() {
  local v
  v=$(ssm_get "$1")
  if [ -z "$v" ]; then
    v=$($2)
    if ! ssm_put "$1" "$v"; then
      v=$(ssm_get "$1") # 동시에 다른 곳이 넣었으면 그 값
      [ -n "$v" ] || { say "LG-WARN SSM $1 에 넣지 못했어요"; return 1; }
    fi
  fi
  printf '%s' "$v"
}

gen_key() { openssl rand -base64 32; }
gen_token() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }

env_value() { sed -n "s/^$1=//p" "$LG_ENV" | head -n1; }

step_secrets() {
  STEP=secrets
  REGION=${AWS_REGION:-$(imds placement/region)}
  if [ -f "$LG_ENV" ]; then
    # 이미 있으면 그대로 둔다. SSM에 없는 값만 채우고, 다르면 알리기만 한다(어느 쪽도 덮어쓰지 않음)
    local pair name key cur want
    for pair in master-key:LIVEJJIM_MASTER_KEY ops-token:LIVEJJIM_OPS_TOKEN transcribe-worker-token:LIVEJJIM_TRANSCRIBE_WORKER_TOKEN; do
      name="$LG_SSM_PREFIX/${pair%%:*}" key=${pair#*:}
      cur=$(env_value "$key")
      want=$(ssm_get "$name")
      if [ -z "$want" ] && [ -n "$cur" ]; then ssm_put "$name" "$cur" || say "LG-WARN SSM $name 에 넣지 못했어요"; fi
      if [ -n "$want" ] && [ "$want" != "$cur" ]; then say "LG-WARN .env의 $key 가 SSM $name 과 달라요"; fi
    done
    return 0
  fi
  local domain=${LJ_DOMAIN:-} ip
  if [ -z "$domain" ]; then
    ip=$(imds public-ipv4)
    domain="${ip//./-}.sslip.io"
    say "LG-WARN LJ_DOMAIN이 없어 $domain 을 써요(탄력적 IP를 붙이면 주소가 바뀌니 .env를 고치세요)"
  fi
  [ -n "${LJ_BACKUP_BUCKET:-}" ] || say "LG-WARN LJ_BACKUP_BUCKET이 비어 S3 백업이 실패해요"
  local master ops worker dbpw tmp
  master=$(ssm_secret "$LG_SSM_PREFIX/master-key" gen_key)
  ops=$(ssm_secret "$LG_SSM_PREFIX/ops-token" gen_token)
  worker=$(ssm_secret "$LG_SSM_PREFIX/transcribe-worker-token" gen_token)
  dbpw=$(openssl rand -hex 24)
  tmp=$(mktemp "$LG_ROOT/.env.XXXX")
  V_LJ_DOMAIN=$domain V_LJ_BACKUP_BUCKET=${LJ_BACKUP_BUCKET:-} V_LJ_DB_PASSWORD=$dbpw \
    V_LIVEJJIM_MASTER_KEY=$master V_LIVEJJIM_OPS_TOKEN=$ops V_LIVEJJIM_TRANSCRIBE_WORKER_TOKEN=$worker \
    V_LG_SSM_PREFIX=$LG_SSM_PREFIX \
    awk '{ while (match($0, /__[A-Z_]+__/)) { k = substr($0, RSTART + 2, RLENGTH - 4); $0 = substr($0, 1, RSTART - 1) ENVIRON["V_" k] substr($0, RSTART + RLENGTH) } print }' \
    "$LG_SRC/deploy/ec2/env.template" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$LG_ENV"
}

step_dirs() {
  STEP=dirs
  install -d -m 0700 -o 1000 -g 1000 "$LG_ROOT/backups/app"
  install -d -m 0700 "$LG_ROOT/backups/db"
}

step_backup_timer() {
  STEP=backup-timer
  cat >/etc/systemd/system/livegenie-backup.service <<EOF
[Unit]
Description=livegenie PostgreSQL backup to S3
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=$LG_SRC/deploy/ec2/backup.sh
EOF
  cat >/etc/systemd/system/livegenie-backup.timer <<'EOF'
[Unit]
Description=livegenie daily backup 04:00 KST
[Timer]
OnCalendar=*-*-* 04:00:00 Asia/Seoul
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now livegenie-backup.timer
}

step_up() {
  STEP=compose
  lg-compose up -d --build --remove-orphans
}

step_health() {
  STEP=health
  "$LG_SRC/deploy/ec2/wait-health.sh"
  say "LG-READY https://$(env_value LJ_DOMAIN)"
}

main() {
  step_install
  step_deploy_key
  step_clone
  step_secrets
  step_dirs
  step_backup_timer
  step_up
  step_health
}

main "$@"
