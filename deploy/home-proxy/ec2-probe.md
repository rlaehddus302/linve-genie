# EC2에서 집 회선 프록시 재 보기 (D-LV1-13)

출시 서버에 붙이기 전, **새 EC2 한 대**(서울, 시험 뒤 지움)에서 "맥 미니 집 회선을 터널로 끌어오면 yt-dlp·ffmpeg가 봇 확인 없이 받는가"를 잰다.
컨테이너는 쓰지 않는다 — EC2 호스트에서 바로 `127.0.0.1:18888`로 부른다(그래서 `GatewayPorts no`).
유튜브에는 아무것도 쓰지 않는다(공개 라이브 재생 주소 묻기·소리 30초 받기만).

준비물: 맥 미니에 tinyproxy가 떠 있음(README 1·4절, 또는 `tinyproxy -d -c $(brew --prefix)/etc/tinyproxy/livegenie.conf`), 시험 키 `~/.livejjim-release/home-proxy/id_ed25519`.

## 1. 맥 미니에서 값 두 개

```bash
curl -s https://checkip.amazonaws.com                    # 맥 미니 공인 IP → 아래 MAC_IP
cat ~/.livejjim-release/home-proxy/id_ed25519.pub        # 공개 키 한 줄 → 아래 MAC_PUBKEY (비밀 키는 보지도 옮기지도 않는다)
```

## 2. user-data (`probe-user-data.sh`로 저장, `__MAC_PUBKEY__` 자리에 공개 키 한 줄)

Amazon Linux 2023 arm64 기준. AL2023 기본 python3(3.9)은 최신 yt-dlp를 못 돌려 `python3.11`을 쓴다. AL2023 저장소에 ffmpeg가 없어 정적 빌드를 받고 md5로 확인한다.

```bash
#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/lg-probe-setup.log) 2>&1
dnf install -y -q python3.11 python3.11-pip tar xz bc
python3.11 -m venv /opt/lg-probe
/opt/lg-probe/bin/pip install -q --upgrade pip
/opt/lg-probe/bin/pip install -q 'yt-dlp[default]' deno
ln -sf /opt/lg-probe/bin/yt-dlp /usr/local/bin/yt-dlp
ln -sf /opt/lg-probe/bin/deno /usr/local/bin/deno

# ffmpeg 정적 빌드(arm64). 받은 파일은 따로 만든 빈 폴더에서만 푼다
mkdir -p /opt/lg-ffmpeg && cd /opt/lg-ffmpeg
curl -fsSLO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
curl -fsSLO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz.md5
md5sum -c ffmpeg-release-arm64-static.tar.xz.md5
tar xf ffmpeg-release-arm64-static.tar.xz
install -m 755 ffmpeg-*-arm64-static/ffmpeg /usr/local/bin/ffmpeg

# 터널 전용 사용자: 셸·명령·다른 포워딩 없이 127.0.0.1:18888 역방향 하나만
useradd -m -s /sbin/nologin lgtunnel
install -d -m 700 -o lgtunnel -g lgtunnel /home/lgtunnel/.ssh
cat > /home/lgtunnel/.ssh/authorized_keys <<'KEY'
restrict,port-forwarding,permitlisten="127.0.0.1:18888",command="/bin/false" __MAC_PUBKEY__
KEY
chown lgtunnel:lgtunnel /home/lgtunnel/.ssh/authorized_keys && chmod 600 /home/lgtunnel/.ssh/authorized_keys
cat > /etc/ssh/sshd_config.d/60-lg-tunnel.conf <<'CONF'
Match User lgtunnel
    AllowTcpForwarding remote
    GatewayPorts no
    PermitListen 127.0.0.1:18888
    PermitOpen none
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    ForceCommand /bin/false
CONF
sshd -t && systemctl restart sshd

# 시험 명령: lg-probe <영상 ID> [프록시|none]
cat > /usr/local/bin/lg-probe <<'PROBE'
#!/bin/bash
set -uo pipefail
id=${1:?영상 ID}; proxy=${2:-http://127.0.0.1:18888}
ytp=(); ffp=(); wl=https,tls,tcp,crypto,hls
if [ "$proxy" != none ]; then ytp=(--proxy "$proxy"); ffp=(-http_proxy "$proxy"); wl=$wl,httpproxy; fi
t0=$(date +%s.%N)
url=$(yt-dlp --ignore-config --no-playlist --no-warnings "${ytp[@]}" -g -f bestaudio/best -- "https://www.youtube.com/watch?v=$id" 2>/tmp/lg-probe.err | head -1)
t1=$(date +%s.%N)
if [ -z "$url" ]; then echo "RESOLVE FAIL ($(grep -oiE 'not a bot|unable to connect to proxy|tunnel connection failed|connection reset' /tmp/lg-probe.err | head -1))"; exit 1; fi
echo "RESOLVE OK $(echo "$t1 - $t0" | bc) s"
bytes=$(timeout 90 ffmpeg -hide_banner -loglevel error -nostdin "${ffp[@]}" -protocol_whitelist "$wl" -live_start_index -1 -i "$url" \
  -t 30 -vn -ac 1 -ar 16000 -f s16le pipe:1 2>/tmp/lg-probe-ff.err | wc -c)
t2=$(date +%s.%N)
echo "FFMPEG bytes=$bytes audio_s=$(echo "scale=1; $bytes / 32000" | bc) wall_s=$(echo "$t2 - $t1" | bc)"
PROBE
chmod 755 /usr/local/bin/lg-probe
echo "LG-PROBE-READY" > /dev/console
```

## 3. CloudShell(서울)에서 띄우기

```bash
export AWS_REGION=ap-northeast-2
MAC_IP=<1에서 본 IP>
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 create-security-group --group-name lg-proxy-probe --description "lg proxy probe: 22 from home only" \
  --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr $MAC_IP/32   # 22만, 맥 미니 IP/32만
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
# 역할(선택): SSM 세션으로 lg-probe를 부르려면 AmazonSSMManagedInstanceCore만 붙은 인스턴스 프로파일을 --iam-instance-profile Name=… 로
IID=$(aws ec2 run-instances --image-id $AMI --instance-type t4g.micro --security-group-ids $SG_ID \
  --user-data file://probe-user-data.sh --metadata-options HttpTokens=required \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=lg-proxy-probe}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids $IID
EC2_IP=$(aws ec2 describe-instances --instance-ids $IID --query 'Reservations[0].Instances[0].PublicIpAddress' --output text); echo $EC2_IP
# 3~5분 뒤 LG-PROBE-READY 확인
aws ec2 get-console-output --instance-id $IID --latest --output text | grep -E 'LG-PROBE-READY|ssh-ed25519'
```

콘솔 출력의 `ssh-ed25519` 호스트 키 줄(cloud-init이 찍는 `-----BEGIN SSH HOST KEY KEYS-----` 아래)을 맥 미니 known_hosts에 넣을 때 대조한다.

## 4. 맥 미니에서 터널 걸기 (창 하나를 열어 둔다)

```bash
EC2_IP=<3에서 본 IP>
ssh-keyscan -t ed25519 $EC2_IP > ~/.livejjim-release/home-proxy/known_hosts_probe   # 콘솔 출력의 키와 같은지 대조
ssh -i ~/.livejjim-release/home-proxy/id_ed25519 -N -T \
  -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.livejjim-release/home-proxy/known_hosts_probe \
  -R 127.0.0.1:18888:127.0.0.1:8888 lgtunnel@$EC2_IP
```

아무것도 찍지 않고 멈춰 있으면 붙은 것이다. `remote port forwarding failed`면 sshd 설정(2절)을 확인한다.

## 5. EC2에서 시험 (SSM 세션 또는 EC2 Instance Connect로 ec2-user 접속)

```bash
# 현재 공개 라이브 영상 ID (프록시로 — www.youtube.com은 필터 통과)
ID=$(yt-dlp --ignore-config --no-warnings --proxy http://127.0.0.1:18888 --print id https://www.youtube.com/@LofiGirl/live); echo $ID
lg-probe $ID none                        # 기대: RESOLVE FAIL (not a bot) — 데이터센터 IP 그대로
lg-probe $ID                             # 기대: RESOLVE OK 2~5 s, FFMPEG bytes≈960000 audio_s≈30 wall_s≈30~35
curl -s -o /dev/null -w '%{http_code}\n' -x http://127.0.0.1:18888 https://checkip.amazonaws.com/   # 기대: 000(필터가 막음)
ss -ltn 'sport = :18888'                 # 기대: 127.0.0.1:18888 만 (0.0.0.0 아님)
```

결과(두 `lg-probe` 줄·`ss` 줄)를 D-LV1-13에 붙인다. 프록시 쪽에서 막히면 맥 미니 `$(brew --prefix)/var/log/tinyproxy/livegenie.log`의 `refused on filtered domain`을 본다.

## 6. 맥 미니 터널 끊김 흉내 (선택)

- 4절 ssh를 Ctrl+C → EC2에서 `lg-probe $ID` → `RESOLVE FAIL (unable to connect to proxy)` (서버라면 `PROXY_DOWN` 경보)
- 터널은 두고 맥 미니 tinyproxy만 끔 → `RESOLVE FAIL (connection reset)` 또는 빈 값 (서버라면 `PROXY_DOWN`)

## 7. 치우기

```bash
aws ec2 terminate-instances --instance-ids $IID && aws ec2 wait instance-terminated --instance-ids $IID
aws ec2 delete-security-group --group-id $SG_ID
```

맥 미니: `rm ~/.livejjim-release/home-proxy/known_hosts_probe`. 시험 키는 출시 서버에도 쓸 거면 두고, 아니면 지운다.
