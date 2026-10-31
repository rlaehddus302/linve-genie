# 라이브지니 EC2 한 대 배포

출시용 서버 한 대를 AWS 서울 리전에 띄우는 묶음이다. 환경변수 뜻·백업·복구·마스터 키는 [docs/DEPLOY.md](../../docs/DEPLOY.md)가 기준이다.

| 무엇 | 값 |
|---|---|
| 기계 | EC2 `t4g.small`(arm64, 2 vCPU·2GB, 스왑 2GB를 더함) · Amazon Linux 2023 · gp3 30GB(암호화) · 서울 `ap-northeast-2` |
| 공개 포트 | 80·443만. SSH 없음 — 관리는 SSM(세션 관리자·Run Command) |
| 구성 | `compose.yaml`: `app`(저장소 Dockerfile을 그 기계에서 빌드) · `db`(postgres 15.19, 볼륨) · `caddy`(2.11.6, 자동 https) |
| 주소 | `.env`의 `LJ_DOMAIN` 하나. 도메인이 없으면 `<탄력적 IP 점을 대시로>.sslip.io` |
| 비밀값 | `/opt/livegenie/.env`(600). 마스터 키·운영 토큰·일꾼 토큰은 SSM Parameter Store `/livegenie/prod/*`(SecureString)에도 |
| 백업 | 매일 04:00(KST) `pg_dump` → gzip → S3 `postgres/`, 로컬 7일 · S3 30일 |

## 파일

| 파일 | 하는 일 |
|---|---|
| `bootstrap.sh` | EC2 user-data. 설치 → 배포 키 → 저장소 받기(최대 60분 기다림) → 비밀값 → 백업 타이머 → `up -d --build` → `/health` |
| `update.sh` | 새 버전: 백업 → `git pull --ff-only` → 빌드 → `up -d` → `/health` (SSM Run Command로 부른다) |
| `backup.sh` | DB 백업 하나 만들고 S3에 올린다(systemd `livegenie-backup.timer`) |
| `wait-health.sh` | 컨테이너 안 `/health`, 밖 `https://<주소>/health` 확인 |
| `lg-compose.sh` | `/usr/local/bin/lg-compose` — 올바른 `.env`·compose 파일로 `docker compose`를 부른다 |
| `compose.yaml` · `Caddyfile` · `env.template` | 서비스 정의 · 앞단 · `.env` 틀 |
| `iam-policy.json` | 인스턴스 역할 인라인 정책(SSM 그 경로 읽기·쓰기, 백업 버킷 `postgres/` 올리기만) |

콘솔 출력(`get-console-output`)에 찍는 줄: `LG-DEPLOYKEY <공개 키>` · `LG-READY https://<주소>` · `LG-FAIL <단계>`(install·deploy-key·clone·secrets·dirs·backup-timer·compose·health) · `LG-WARN <뜻>`. 비밀 키·비밀값은 찍지 않는다.

## CloudShell에서 처음 띄우기

AWS 콘솔 오른쪽 위 CloudShell을 서울 리전에서 연다. 이 폴더의 `bootstrap.sh`와 `iam-policy.json`을 CloudShell의 **작업 → 파일 업로드**로 올린다(저장소가 비공개라 CloudShell에서 바로 받을 수 없다). 아래는 한 셸에서 이어서 친다.

```bash
export AWS_REGION=ap-northeast-2
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=livegenie-backup-$ACCOUNT_ID          # 버킷 이름은 전 세계에서 하나여야 한다
```

### 1. VPC (기본 VPC)

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC_ID" = None ] && VPC_ID=$(aws ec2 create-default-vpc --query Vpc.VpcId --output text)
SUBNET_ID=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)
```

### 2. 보안 그룹 (80·443만)

```bash
SG_ID=$(aws ec2 create-security-group --group-name livegenie-web --description "livegenie 80/443 only" \
  --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SG_ID --ip-permissions \
  'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
  'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' \
  'IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]'
```

udp 443은 HTTP/3용이다(없어도 된다). 22번은 열지 않는다.

### 3. S3 백업 버킷 (버전 관리·퍼블릭 차단·30일 수명)

```bash
aws s3api create-bucket --bucket $BUCKET --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket $BUCKET --lifecycle-configuration '{"Rules":[{
  "ID":"backup-30d","Status":"Enabled","Filter":{"Prefix":"postgres/"},
  "Expiration":{"Days":30},"NoncurrentVersionExpiration":{"NoncurrentDays":1},
  "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
```

기본 암호화(SSE-S3)는 새 버킷에 저절로 켜진다. 백업에 봉인 전 채팅 원문이 있어(D-012) 지난 판도 하루 뒤 지운다 — 최대 약 31일.

### 4. IAM 역할·인스턴스 프로필

```bash
aws iam create-role --role-name livegenie-ec2 --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
# SSM 관리(세션 관리자·Run Command)는 AWS 관리형 정책을 따로 붙인다
aws iam attach-role-policy --role-name livegenie-ec2 \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
sed -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/" -e "s/__BACKUP_BUCKET__/$BUCKET/" iam-policy.json > livegenie-policy.json
aws iam put-role-policy --role-name livegenie-ec2 --policy-name livegenie-app \
  --policy-document file://livegenie-policy.json
aws iam create-instance-profile --instance-profile-name livegenie-ec2
aws iam add-role-to-instance-profile --instance-profile-name livegenie-ec2 --role-name livegenie-ec2
sleep 15   # 새 프로필이 퍼지는 시간
```

SecureString은 AWS 관리형 키 `aws/ssm`으로 암호화한다(따로 KMS 권한이 필요 없다).

### 5. 탄력적 IP와 주소

주소를 먼저 정해야 user-data에 넣을 수 있으므로 IP를 먼저 받는다.

```bash
read EIP_ALLOC EIP <<<"$(aws ec2 allocate-address --domain vpc --query '[AllocationId,PublicIp]' --output text)"
LJ_DOMAIN="${EIP//./-}.sslip.io"     # 도메인이 있으면 그 이름(A 레코드를 $EIP로 먼저 만든다)
echo "$LJ_DOMAIN"
```

### 6. 인스턴스 띄우기

user-data = 앞에 `export` 두 줄 + `bootstrap.sh`(첫 줄 제외). 16KB를 넘지 않는다.

```bash
{ printf '#!/bin/bash\nexport LJ_DOMAIN=%s\nexport LJ_BACKUP_BUCKET=%s\n' "$LJ_DOMAIN" "$BUCKET"; tail -n +2 bootstrap.sh; } > user-data.sh
wc -c user-data.sh
AMI_ID=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query Parameter.Value --output text); echo "AMI $AMI_ID"   # 기록해 두면 같은 판으로 다시 만들 수 있다
INSTANCE_ID=$(aws ec2 run-instances --image-id $AMI_ID --instance-type t4g.small \
  --subnet-id $SUBNET_ID --security-group-ids $SG_ID \
  --iam-instance-profile Name=livegenie-ec2 \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]' \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1,HttpEndpoint=enabled \
  --disable-api-termination \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=livegenie-prod}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids $INSTANCE_ID
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $EIP_ALLOC
```

- `HttpPutResponseHopLimit=1`: 컨테이너(앱)는 인스턴스 역할 자격 증명에 닿지 못한다. 호스트 스크립트만 쓴다.
- `--disable-api-termination`: DB가 이 디스크에 있으므로 실수로 지우지 못하게 막는다.

### 7. 배포 키 읽어 GitHub에 등록 (읽기 전용)

```bash
aws ec2 get-console-output --instance-id $INSTANCE_ID --latest --output text | grep -E 'LG-(DEPLOYKEY|FAIL|WARN)'
```

1~3분 뒤 `LG-DEPLOYKEY ssh-ed25519 AAAA… livegenie-ec2`가 나온다. `LG-DEPLOYKEY ` 뒤의 공개 키만 복사해 저장소 관리자 권한이 있는 곳(`gh` 로그인된 맥 등)에서 등록한다.

```bash
echo 'ssh-ed25519 AAAA… livegenie-ec2' > livegenie-ec2.pub
gh repo deploy-key add livegenie-ec2.pub --repo Port-051/livegenie --title "livegenie-ec2 $(date +%F)"
```

`--allow-write`를 붙이지 않는다(읽기 전용이 기본). 웹이면 저장소 Settings → Deploy keys → Add deploy key(Allow write access 끔). 서버는 60분 동안 30초마다 다시 받아 본다. 60분을 넘기면 `LG-FAIL clone` — 인스턴스를 재부팅하지 말고 아래 "다시 돌리기"를 한다.

### 8. 준비 확인

```bash
until aws ec2 get-console-output --instance-id $INSTANCE_ID --latest --output text | grep -E 'LG-(READY|FAIL)'; do sleep 30; done
curl -fsS "https://$LJ_DOMAIN/health"
```

첫 빌드는 t4g.small에서 10~20분 걸린다. `LG-FAIL <단계>`가 나오면 세션에 들어가 `sudo tail -n 200 /var/log/cloud-init-output.log`를 본다.

### 9. 운영자(판매자) 계정 만들기

```bash
aws ssm start-session --target $INSTANCE_ID
# 세션 안에서 (비밀번호는 표준 입력 — 화면에 보이지 않는다)
sudo lg-compose exec app node apps/server/src/commands/create-account.ts --name "가게 이름" --login 아이디
```

브라우저로 `https://$LJ_DOMAIN`을 열어 로그인한다.

### 10. 받아쓰기 일꾼(맥 미니) 연결

일꾼 토큰을 SSM에서 꺼내 맥 미니의 권한 600 파일에 넣고, 일꾼을 `wss://$LJ_DOMAIN/api/voice/worker`로 붙인다([일꾼 안내](../../packages/voice/transcriber/README.md)). EXPO 앱의 서버 주소는 `https://$LJ_DOMAIN`.

```bash
aws ssm get-parameter --name /livegenie/prod/transcribe-worker-token --with-decryption \
  --query Parameter.Value --output text      # 화면에 나오므로 복사 뒤 지운다
```

## 운영

| 할 일 | 명령 |
|---|---|
| 새 버전 | `aws ssm send-command --instance-ids $INSTANCE_ID --document-name AWS-RunShellScript --timeout-seconds 3600 --parameters 'commands=["/opt/livegenie/src/deploy/ec2/update.sh"]' --query Command.CommandId --output text` → `aws ssm get-command-invocation --command-id <ID> --instance-id $INSTANCE_ID --query '[Status,StandardOutputContent]' --output text` (끝 줄 `LG-UPDATED <커밋>`) |
| 상태·기록 | 세션에서 `sudo lg-compose ps` · `sudo lg-compose logs --tail 100 app` |
| 운영 상태 | `curl -H "Authorization: Bearer <ops-token>" https://$LJ_DOMAIN/ops/status` (토큰은 SSM `/livegenie/prod/ops-token`) |
| 백업 바로 하기·확인 | `sudo systemctl start livegenie-backup.service` · `systemctl list-timers livegenie-backup.timer` · `journalctl -u livegenie-backup` |
| 도메인 바꾸기 | DNS A 레코드를 탄력적 IP로 → `sudo vi /opt/livegenie/.env`에서 `LJ_DOMAIN`과 `LIVEJJIM_APP_ORIGIN`만 바꿈 → `sudo lg-compose up -d`. 구글·밴드 등 돌아오는 주소를 쓰면 함께 바꾼다 |
| 다시 돌리기 | 세션에서 `sudo bash /var/lib/cloud/instance/user-data.txt` (이미 있는 키·`.env`·저장소는 그대로 둔다) |
| 복구 | S3에서 받아 `gunzip -c livejjim-….dump.gz > x.dump` 뒤 DEPLOY.md 6절 "복구" |

인스턴스를 새로 만들어도 마스터 키·토큰은 SSM의 같은 값을 쓴다. DB는 새 디스크에서 빈 채로 시작하므로 S3 백업으로 복구한다.

## 월 예상 비용 (서울, 온디맨드, 2026-11 기준 추정 — 실제는 AWS 요금 계산기로 확인)

| 항목 | 계산 | 월(USD) |
|---|---|---|
| EC2 t4g.small | 약 $0.0208/시간 × 730 | 약 15.2 |
| EBS gp3 30GB | 약 $0.0912/GB × 30 (3000 IOPS·125MB/s 기본 포함) | 약 2.7 |
| 공인 IPv4(탄력적 IP) | $0.005/시간 × 730 | 약 3.7 |
| S3 백업 | 덤프 하루 수십 MB × 30일 = 1~3GB × 약 $0.025 + 요청 | 0.1 미만 |
| 바깥으로 나가는 전송 | 매달 100GB까지 무료 | 0 |
| SSM·Parameter Store(표준) | 무료 | 0 |
| **합계** | | **약 22 (약 3만 원)** |

1년 Savings Plan이면 EC2가 약 30~40% 준다.

## 남은 위험

- **sslip.io 인증서**: Let's Encrypt는 등록 도메인마다 주간 발급 한도가 있다. sslip.io를 쓰는 사람이 많으면 막힐 수 있다(Caddy는 ZeroSSL로도 시도한다). 출시 전 자기 도메인으로 바꾼다.
- **메모리 2GB**: 첫 빌드와 서버가 겹치면 느리다(스왑 2GB로 버틴다). 빌드가 OOM으로 죽으면 t4g.medium으로 한 번 올려 빌드한 뒤 내린다.
- **한 대·한 디스크**: DB와 서버가 같은 EBS에 있다. 백업은 하루 한 번이라 최대 하루치 기록을 잃을 수 있다. EBS 스냅숏(Data Lifecycle Manager)을 더하면 줄어든다.
- **데이터센터 IP와 유튜브**: 방송 소리는 막혀 끔(D-LV1-11·12). 서버 채팅 읽기도 봇 확인으로 막힐 수 있다(경보 `YT_CHAT_BLOCKED`, D-YT-SRV-19 대체 경로).
- **비밀값 두 곳**: `.env`(디스크 암호화)와 SSM. 마스터 키를 바꾸지 않는다. 백업 버킷에는 넣지 않는다.
- **꾸러미 판**: docker·git은 AL2023 저장소 판(AMI 판에 묶임), compose·buildx·이미지 태그는 고정. 보안 업데이트는 `sudo dnf upgrade --releasever=latest`를 따로 챙긴다.
