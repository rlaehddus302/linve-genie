# 클라우드 화면 일꾼 (D-SCR-CLOUD-01)

> **2026-11-20부터 운영은 다시 맥 미니(D-SCR-CLOUD-02).** 실제 라이브에서 CPU 포화로 받아쓰기가 15~55초 밀려 판매자 손 등록보다 늦었다. `lg-screen`은 꺼 두었고(disable) 인스턴스 i-0b71991de2b3aa6c0도 중지했다(stop).

화면 일꾼(packages/screen-worker)을 Mac mini 대신 AWS CPU 서버에서 돌린다. 유튜브는 AWS 주소를 봇으로 막으므로
**유튜브 영상만** Mac mini 집 회선 프록시(deploy/home-proxy)를 거친다. 서버 등록·Claude·틱톡은 바로 나간다.

```
일꾼 EC2(livegenie-screen-worker) ─yt-dlp --proxy / ffmpeg -http_proxy─▶ 운영 EC2 172.31.62.27:18889 (lg-yt-relay)
   ─▶ 172.17.0.1:18888 (맥 미니 SSH 역방향 터널 끝) ═▶ 맥 미니 tinyproxy (youtube.com·googlevideo.com만) ─▶ 유튜브
```

| 순서 | 파일 | 하는 일 |
|---|---|---|
| 1 | `relay-apply.sh` | 일꾼 보안 그룹 만들기, 운영 보안 그룹에 그 그룹의 18889만 허용, 운영 EC2에 중계(`lg-yt-relay.*`) 켜기. 되돌리기 `relay-revert.sh` |
| 2 | `store-claude-token.sh` | `claude setup-token` 토큰을 SSM `/livegenie/prod/claude-oauth-token`(암호화)에만 넣기 — 사람이 자기 터미널에서 |
| 3 | `launch-worker.sh` | c7i.4xlarge(16코어) 한 대 띄우고 `worker-setup.sh`로 설치(ffmpeg·faster-whisper·RapidOCR·Claude CLI). 일꾼은 켜지 않음 |
| 4 | `lg-screen.service` | `sudo systemctl enable --now lg-screen` — `sw.serve --max 1`, 토큰 둘은 켤 때 SSM에서 `/run/lg`로 |

- **맥 미니 일꾼(`sw.serve`)과 동시에 켜지 않는다** — 같은 라이브를 둘이 보면 상품이 두 번 올라간다.
- 환경값은 `/etc/lg-screen.env`: `STT_BACKEND=faster` `OCR_BACKEND=rapid` `RAPID_THREADS=2` `FW_THREADS=6` `LG_YT_PROXY=http://172.31.62.27:18889`.
- 16코어 한 대에 방송 1개. 방송 중 비용 약 1,200원/시간(c7i.4xlarge), 방송이 없을 때는 서버를 꺼 둔다.
