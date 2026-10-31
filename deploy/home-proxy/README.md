# 집 회선 프록시 (방송 소리 받기용, D-LV1-13)

AWS(EC2·CloudShell) IP에서는 유튜브 재생 주소 요청이 "Sign in to confirm you're not a bot"으로 막힌다(D-LV1-11·D-LV1-12).
그래서 **팀이 가진 맥 미니의 집 회선**을 방송 소리 받기의 출구로 쓴다. 유료 프록시·IP 돌리기·쿠키·봇 검사 풀기 도구는 쓰지 않는다.

```
EC2 app(컨테이너) ──yt-dlp --proxy / ffmpeg -http_proxy──▶ host.docker.internal:18888 (= EC2 172.17.0.1:18888, sshd가 연 터널 끝)
   ══ SSH 역방향 터널(맥 미니가 EC2로 건다) ══▶ 맥 미니 127.0.0.1:8888 tinyproxy ──(youtube.com·googlevideo.com만)──▶ 유튜브
```

- 채팅 읽기는 지금처럼 EC2에서 바로 한다. 프록시는 **방송 소리(yt-dlp 주소 찾기 + ffmpeg HLS 받기)** 에만 쓴다.
- HLS 주소에 요청한 IP가 박혀 있어 목록·조각도 같은 출구로 받아야 한다 → 서버가 ffmpeg에도 `-http_proxy`를 넘긴다
  (환경변수 `http_proxy`가 아니라 옵션 — `no_proxy` 같은 바깥 값에 흔들리지 않고, 프록시가 죽으면 바로 나가지 않고 실패한다).
- 맥 미니에는 바깥에서 들어오는 포트를 하나도 열지 않는다. tinyproxy는 127.0.0.1에만 열리고, 연결은 맥 미니가 EC2로 거는 SSH 하나다.

| 파일 | 하는 일 |
|---|---|
| `tinyproxy.conf` | Port 8888 · Listen/Allow 127.0.0.1 · CONNECT 443만 · 도메인 허용 목록 · Via 머리글 없음 |
| `filter` | 허용 도메인(정규식): `youtube.com`·`googlevideo.com`과 그 하위만 |
| `com.livegenie.home-proxy.tinyproxy.plist` | tinyproxy를 launchd로 늘 켜 둔다(꺼지면 다시 띄움) |
| `com.livegenie.home-proxy.tunnel.plist` | autossh로 역방향 터널을 늘 걸어 둔다(ServerAliveInterval 30 · ExitOnForwardFailure yes) |
| `ec2-probe.md` | 출시 전 EC2 한 대로 이 경로를 재 보는 절차 |

허용 도메인은 실측으로 정했다(2026-11-01, 맥 미니, yt-dlp 2026.10.26 · ffmpeg 9.0.2, 캐시 없이): yt-dlp가 연 곳은 `www.youtube.com`·`manifest.googlevideo.com`,
ffmpeg가 연 곳은 `manifest.googlevideo.com`·`rr*---sn-*.googlevideo.com`뿐이다. `i.ytimg.com`·`www.google.com`·`github.com` 등은 필요 없어 막는다.
유튜브가 바뀌어 yt-dlp가 다른 곳을 부르게 되면 tinyproxy 로그의 `Proxying refused on filtered domain "…"`을 보고 그 도메인만 더한다.

## 1. 설치 (맥 미니)

```bash
brew install tinyproxy autossh
B=$(brew --prefix)                       # 애플 실리콘이면 /opt/homebrew (아니면 파일들의 /opt/homebrew를 바꾼다)
cp deploy/home-proxy/tinyproxy.conf "$B/etc/tinyproxy/livegenie.conf"
cp deploy/home-proxy/filter          "$B/etc/tinyproxy/livegenie-filter"
mkdir -p "$B/var/log/tinyproxy"
```

`brew services start tinyproxy`(기본 설정)는 쓰지 않는다 — 아래 launchd 항목이 이 설정으로 띄운다.

## 2. SSH 키 (이 장비에서 새로 만든다)

```bash
mkdir -p ~/.livejjim-release/home-proxy && chmod 700 ~/.livejjim-release/home-proxy
ssh-keygen -t ed25519 -N '' -C livegenie-home-proxy -f ~/.livejjim-release/home-proxy/id_ed25519
chmod 600 ~/.livejjim-release/home-proxy/id_ed25519
cat ~/.livejjim-release/home-proxy/id_ed25519.pub      # 이 한 줄(공개 키)만 EC2에 등록한다
```

- 비밀 키는 이 맥 밖으로 내보내지 않는다(복사·채팅·저장소·백업에 넣지 않는다). 다른 용도와 같이 쓰지 않는다.
- EC2 쪽은 **터널 전용 사용자 `lgtunnel`** 의 `authorized_keys`에 아래처럼 제한을 붙여 넣는다(셸·명령·다른 포워딩 불가):

```
restrict,port-forwarding,permitlisten="172.17.0.1:18888",command="/bin/false" ssh-ed25519 AAAA… livegenie-home-proxy
```

- 처음 한 번 EC2 호스트 키를 전용 known_hosts에 넣는다(값은 EC2 콘솔 출력·SSM으로 받은 지문과 대조):

```bash
ssh-keyscan -t ed25519 <EC2 주소> > ~/.livejjim-release/home-proxy/known_hosts
ssh-keygen -lf ~/.livejjim-release/home-proxy/known_hosts   # 지문이 EC2에서 본 것과 같은지 확인
```

## 3. EC2 쪽 (출시 서버)

`/etc/ssh/sshd_config.d/60-livegenie-tunnel.conf`:

```
Match User lgtunnel
    AllowTcpForwarding remote
    GatewayPorts clientspecified
    PermitListen 172.17.0.1:18888
    PermitOpen none
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    ForceCommand /bin/false
```

- 터널 끝은 **도커 브리지 주소 172.17.0.1의 18888 하나**만 열 수 있다(`PermitListen`). 0.0.0.0·공인 IP에는 열 수 없다.
  172.17.0.1은 그 기계 안 도커 브리지에만 있는 주소라 VPC·인터넷에서 닿지 않고, 보안 그룹에도 18888을 열지 않는다.
- 컨테이너 `app`은 `compose.yaml`의 `extra_hosts: host.docker.internal:host-gateway`로 그 주소에 닿는다.
  app을 host 망으로 바꾸지 않은 까닭: db·caddy와 이름으로 붙는 망(back·edge)과 "app 포트를 밖에 내지 않음"을 그대로 지키려고.
- 22번은 **맥 미니 공인 IP/32만** 연다(`curl -s https://checkip.amazonaws.com`). 집 IP가 바뀌면 보안 그룹을 고쳐야 한다(아래 위험).
  22번을 아예 열지 않으려면 SSM 세션 관리자 위로 SSH를 거는 방법(`ProxyCommand aws ssm start-session --document-name AWS-StartSSHSession`)도 있지만,
  그러면 맥 미니에 AWS 자격 증명이 있어야 해 이번에는 고르지 않았다.
- `/opt/livegenie/.env`: `LIVEJJIM_STREAM_AUDIO=on`(또는 줄 지움), `LIVEJJIM_YT_MEDIA_PROXY=http://host.docker.internal:18888` → `sudo lg-compose up -d`.

EC2 호스트에서 바로 시험할 때(ec2-probe.md)는 `GatewayPorts no`·`127.0.0.1:18888`로 하고 컨테이너는 쓰지 않는다.

## 4. 서비스로 올리기 (맥 미니, 로그인하지 않아도 켜짐)

```bash
EC2=<EC2 공인 주소 또는 도메인>
BIND=172.17.0.1                      # 컨테이너 서버. EC2 호스트에서 바로 쓰는 시험이면 127.0.0.1
for f in tinyproxy tunnel; do
  sed -e "s|__USER__|$(id -un)|g" -e "s|__HOME__|$HOME|g" -e "s|__EC2_HOST__|$EC2|g" -e "s|__BIND__|$BIND|g" \
    deploy/home-proxy/com.livegenie.home-proxy.$f.plist > /tmp/com.livegenie.home-proxy.$f.plist
  plutil -lint /tmp/com.livegenie.home-proxy.$f.plist
  sudo install -m 644 -o root -g wheel /tmp/com.livegenie.home-proxy.$f.plist /Library/LaunchDaemons/
  sudo launchctl bootstrap system /Library/LaunchDaemons/com.livegenie.home-proxy.$f.plist
done
```

끄기: `sudo launchctl bootout system/com.livegenie.home-proxy.tunnel` (tinyproxy도 같은 모양).

로그 돌리기(`/etc/newsyslog.d/livegenie-home-proxy.conf`, 1MB마다 5개, G = 이름 무늬):

```
/opt/homebrew/var/log/tinyproxy/livegenie*.log  <사용자>:admin  640  5  1024  *  GNJ
```

맥 미니 설정: 시스템 설정 → 에너지 → "디스플레이가 꺼져도 잠자기 방지"·"정전 후 자동 시작"을 켠다. 자동 업데이트 재시동 시간을 방송 없는 때로.

## 5. 끊김 감시

| 어디서 | 무엇을 | 정상 |
|---|---|---|
| 서버 로그 | 경보 `{"level":"alert","code":"STREAM_AUDIO_PROXY_DOWN",…}` | 없어야 한다. 있으면 판매자는 휴대폰 마이크로 넘어간 상태 |
| EC2 | `ss -ltn 'sport = :18888'` | `172.17.0.1:18888` LISTEN |
| EC2 | `curl -s -o /dev/null -w '%{http_code}\n' -x http://172.17.0.1:18888 https://www.youtube.com/` | `200` |
| 맥 미니 | `sudo launchctl print system/com.livegenie.home-proxy.tunnel \| grep -E 'state\|runs'` | `state = running`, runs가 계속 늘지 않음 |
| 맥 미니 | `tail /opt/homebrew/var/log/tinyproxy/livegenie-tunnel.log` | `remote port forwarding failed`가 반복되지 않음(이전 연결이 포트를 쥐고 있으면 ServerAlive 90초 뒤 풀린다) |
| 맥 미니 | `curl -s -o /dev/null -w '%{http_code}\n' -x http://127.0.0.1:8888 https://www.google.com/` | `000`(필터가 막음). `200`이면 필터가 빠진 것 |

서버는 프록시에 닿지 못하면(연결 거부·터널만 살아 있고 tinyproxy 꺼짐·필터 거절) `PROXY_DOWN`으로 따로 분류한다 — 봇 확인 막힘(`BLOCKED`)과 섞이지 않는다.
판매자 화면은 지금처럼 "휴대폰 마이크로 들어 주세요" 안내이고, 다시 이어지면 다음 방송 소리 잇기부터 프록시로 받는다.
