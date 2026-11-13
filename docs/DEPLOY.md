# 라이브지니 배포·운영 안내

라이브지니를 인터넷에 올려 판매자가 쓰게 하는 운영자용 문서다(SYS-05, D-I3-13·14·16). 호스팅 업체·도메인·TLS 인증서 고르기는 사용자 몫이다(D-001). 이 문서의 명령은 두 가지로 적는다.

- 저장소에서: `pnpm --filter @livejjim/server <명령>`
- 컨테이너 안에서: `node apps/server/src/commands/<명령>.ts` (이미지에는 pnpm이 없다. 서버 시작만 `node apps/server/src/main.ts`)

## 1. 필요한 것

| 무엇 | 왜 | 비고 |
|---|---|---|
| PostgreSQL 데이터베이스 | 판매 기록·계정·유튜브 연결을 둔다 | 업체가 관리하는 PostgreSQL이면 편하다. 백업용 `pg_dump`는 DB와 같거나 높은 메이저 버전이어야 한다(아래 6절) |
| https 도메인 | 화면과 API를 같은 주소로 낸다. 로그인 쿠키는 https에서만 실린다 | 서버는 앱 주소가 https가 아니면 시작하지 않는다(내 컴퓨터 시험은 `http://localhost`만) |
| 컨테이너를 돌릴 곳 | 저장소 루트 `Dockerfile`로 만든 이미지 하나 | 업체에 매이지 않는다. 포트 3000, 헬스체크 `/health` |
| 구글 클라우드 프로젝트 (선택) | 유튜브 연동(채팅 받기·감사 메시지) | 없으면 유튜브 기능만 꺼진다. 4절 |
| 메타 개발자 앱 (선택) | 인스타그램 라이브 연동(댓글 받기·감사 DM) | 없으면 인스타그램 기능만 꺼진다. 4-1절 |
| 팝빌 연동 키 (선택) | 입금 자동 확인의 계좌조회 원천(은행 입금 내역 받아 오기, N3) | 없으면 계좌조회 원천만 "준비 중"이다(붙여넣기 원천은 그대로 쓴다). 4-2절 |

## 2. 환경변수

`.env.example`에 키 목록이 있다(값은 비어 있다). 운영에서는 업체의 비밀값 설정에 넣는다. **비밀값을 이미지·저장소·로그에 넣지 않는다.**

| 이름 | 필수 | 예 | 만드는 법·뜻 | 잃거나 틀리면 |
|---|---|---|---|---|
| `PORT` | 선택 | `3000` | 서버가 기다릴 포트(비우면 3000) | 다른 프로그램이 쓰는 포트면 시작하지 않는다 |
| `DATABASE_URL` | 필수 | `postgres://user:pass@db.example:5432/livejjim?sslmode=require` | 업체가 준 PostgreSQL 연결 문자열 | 없으면 시작하지 않는다(메모리 DB로 바꾸지 않는다) |
| `LIVEJJIM_PGLITE_DIR` | 개발만 | `./.data/pglite` | 내 컴퓨터용 파일 데이터베이스. `DATABASE_URL`과 함께 쓰지 않는다 | 운영에서는 쓰지 않는다 |
| `LIVEJJIM_MASTER_KEY` | 필수 | (32바이트 base64) | `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` — 판매자 전화번호 키·구글 토큰을 암호화한다 | **잃으면 구글 토큰을 풀 수 없어 모든 판매자가 유튜브를 다시 연결해야 하고, 이후 문자찜이 이전 문자 구매자와 이어지지 않는다.** 백업과 다른 곳에 따로 보관한다(7절) |
| `LIVEJJIM_APP_ORIGIN` | 필수 | `https://app.example.com` | 화면 앱 주소(경로 없이). 상태를 바꾸는 요청의 Origin이 이 값과 같아야 한다 | https가 아니면 시작하지 않는다. 실제 주소와 다르면 모든 저장이 403 |
| `LIVEJJIM_OLD_APP_ORIGINS` | 선택 | `https://old.example.com` | 도메인을 옮기는 동안 옛 주소로 깔린 앱·웹의 Origin도 받는다(D-OPS-DOMAIN — Origin 검사만). 경로 없이 쉼표로 여럿 | 모양이 틀리면 시작하지 않는다. 옮기기를 마치면 비운다 |
| `LIVEJJIM_WEB_DIR` | 선택 | `/app/apps/web/dist` | 화면 빌드 폴더. 적으면 서버가 화면을 같은 출처로 함께 낸다(이미지는 정해 둠) | 그 폴더에 `index.html`이 없으면 시작하지 않는다 |
| `LIVEJJIM_OPS_TOKEN` | 선택 | (32자 이상) | `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` — 운영 상태 `/ops/status`를 연다 | 비우면 `/ops/status`는 없다(404). 32자 미만이면 시작하지 않는다. 새면 바꾼다(합친 숫자만 보여 판매 정보는 새지 않는다) |
| `LIVEJJIM_TRANSCRIBE_WORKER_TOKEN` | 자체 받아쓰기면 필수 | (무작위 비밀값) | 서버와 일꾼만 공유한다. 일꾼에는 권한 0600 파일과 `--token-file`로 전달한다 | 비우거나 다르면 일꾼 연결이 401. 연결된 일꾼이 없으면 기기에 받아쓰기 서버가 꺼졌다고 알린다 |
| `LIVEJJIM_SCREEN_WORKER_TOKEN` | 선택 | (무작위 비밀값, 32자 이상) | 화면 일꾼(D-SCR-01·02 — 운영자 맥, 저장소 livegenie-screen-worker의 `sw.serve`)이 `GET /internal/screen/live`로 볼 라이브를 묻고 `POST /internal/screen/register`로 화면 번호표 + 판매자 말로 확정한 상품을 등록한다. 운영 값은 SSM `/livegenie/prod/screen-worker-token`, 일꾼에는 권한 0600 파일과 `--token-file`로 | 비우면 두 입구가 404(화면 인식 꺼짐). 32자보다 짧으면 서버가 시작하지 않는다. 틀리면 401 |
| `LIVEJJIM_APP_UPDATES_DIR` | 선택 | `/app-updates` | 앱 화면 새 버전 묶음 폴더(D-OTA-01). 맥 미니 내보내기가 `<플랫폼>/<지문>/<id>/`로 풀어 두고 서버는 읽기만 해서 `/app-updates/manifest`로 나눠 준다. 같은 폴더의 `server-commit` 한 줄(배포가 건강 확인 뒤 적는 지금 운영 커밋)을 `GET /internal/screen/capabilities`가 돌려준다(D-RETRO-32, 6-1절). EC2 배포는 `deploy/ec2/compose.yaml`이 정해 준다 | 비우면 앱 화면 새 버전이 늘 "새 것 없음"이고 서버 판은 `null` |
| `LIVEJJIM_TRUSTED_PROXIES` | 선택 | `1` | 서버 앞의 믿는 프록시 수(0~5, 기본 0). 5절 | 틀리게 적으면 로그인 IP 한도가 엉뚱한 주소를 센다. 0~5가 아니면 시작하지 않는다 |
| `LIVEJJIM_YT_WEB_CHAT` | 선택 | (비움) | 서버가 유튜브 채팅을 읽는 기능(YT-11 — 구글 연결·할당량 없이 방송 주소만으로)의 운영자 스위치. 다듬고 소문자로 `off`일 때만 끈다 — 비움·`on`은 켬. 서버 시작 때 한 번 읽는다 | 끄면 유튜브에 아무 요청도 하지 않고 이은 회차의 수집은 "지금은 유튜브 채팅을 자동으로 받지 않아요."로 멈춘다(크롬 확장은 그대로). `on`·`off`·빈 값이 아니면 켬으로 보고 경고 `YT_WEB_CHAT_INVALID`(값 없이)를 남긴다 |
| `LIVEJJIM_YT_SEND_ROUTE` | 선택 | (비움) | 실시간 채팅 감사를 올리는 길(D-YT-SEND-01~08). 비움·`official`은 공식 Data API(`liveChatMessages.insert` 20단위)만. `innertube`(YouTube.js 내부 API, 봇 계정 쿠키)·`browser`(서버 Chromium, 봇 계정 로그인 상태)·`nightbot`(Nightbot API, 보낸 사람 Nightbot)은 할당량을 쓰지 않는다. `official-bot`은 봇 계정의 **공식 Data API**가 기본 길(D-YT-SEND-20 — 약관 문제 없음, 할당량은 봇 몫: 1회 20단위·하루 약 500회, `LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID`만 적고 비공식 계정 칸은 비운다, 봇 연결은 `youtube-bot` 명령 — D-YT-SEND-21). 판매자 동의·채널 확인은 공식과 같다 | 유튜브가 허락한 연동이 아니다(약관 자동화 제한) — 고른 판매자에게만 켠다. 그 밖의 값이면 시작하지 않는다 |
| `LIVEJJIM_YT_SEND_SELLERS` | 다른 길이면 필수 | `s_abc,s_def` 또는 `*` | 다른 길을 쓸 판매자 ID 쉼표 목록(모두면 `*`). 목록에 없는 판매자는 공식 그대로 | 비우면 시작하지 않는다 |
| `LIVEJJIM_YT_SEND_CHANNEL_ID` | 다른 길이면 필수 | `UC…`(24자) | 그 길로 올린 글의 작성자 채널(봇 계정·Nightbot 채널). 수집기가 우리 감사 글을 찜으로 읽지 않게 거르고 게시 확인에 쓴다 | 틀리면 시작하지 않는다 |
| `LIVEJJIM_YT_SEND_SECRET_FILE` | 다른 길이면 필수 | `/run/secrets/yt-send` | innertube: 봇 계정 유튜브 쿠키 머리글(SAPISID 포함) 글 파일 · browser: Playwright 로그인 상태 JSON(보낼 때마다 새 쿠키를 다시 적는다 — 쓰기 권한 필요) · nightbot: 접근 토큰(`channel_send`) 글 파일. 권한 0600 | 읽지 못하면 시작하지 않는다. 내용은 로그에 남기지 않는다. 쓸 수 없게 되면 오류 로그 `CHAT_SEND_AUTH`(`route` 칸)가 남는다 — 봇 계정으로 다시 로그인해 파일을 새로 만들고 서버를 다시 켠다 |
| `LIVEJJIM_YT_SEND_CHROMIUM` | 선택 | `/usr/bin/chromium` | browser 길의 Chromium 실행 파일(비우면 Playwright가 설치한 것) | 이미지에는 Chromium이 없다 — browser 길을 쓰려면 따로 넣는다. 창 없는(headless) 브라우저는 유튜브 팝아웃 채팅이 "이전 버전의 브라우저" 화면만 내므로 가상 화면(Xvfb, 예: `xvfb-run`)에서 창 있는 브라우저로 띄운다(D-YT-SEND-09) |
| `LIVEJJIM_YT_SEND_ACCOUNTS_FILE` | 선택 | `/run/livegenie-secrets/bots.json` (EC2: 호스트 `/opt/livegenie/secrets`를 읽기 전용으로 연결, 파일은 uid 1000·600) | 봇 계정 여럿(D-YT-SEND-12, innertube·browser만): `[{"channelId":"UC…","secretFile":"/run/secrets/bot1.json"}, …]`. 방송마다 계정 하나를 붙이고 계정마다 3초 간격 — 방송끼리는 동시에. 로그인 풀림은 그 계정 10분·속도 제한 1분 쉬고 다음 계정으로, 서버 막힘은 모든 계정 5분 쉼(로그 `CHAT_SEND_ACCOUNT_DOWN`) | 쓰면 `LIVEJJIM_YT_SEND_CHANNEL_ID`·`SECRET_FILE`은 비운다(둘 다면 시작하지 않는다). 모양이 틀리거나 채널이 겹치면 시작하지 않는다 |
| `LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID` | 선택 | `UC…`(24자) | 봇 계정의 공식 API 채널. `official-bot`이면 기본 길(D-YT-SEND-20), 다른 길이면 봇 길이 막혔을 때(서버 IP 막힘·쓸 수 있는 계정 없음 — 올라가지 않은 것이 확실할 때만) 넘기는 길(D-YT-SEND-13). 봇 계정의 구글 연결은 로그인 계정이 없는 시스템 판매자에 두고 운영자 명령으로만 잇는다(D-YT-SEND-21): `node apps/server/src/commands/youtube-bot.ts connect`가 찍은 주소를 봇 계정으로 로그인한 브라우저에서 열어 허락, `node apps/server/src/commands/youtube-bot.ts status`로 확인. 토큰은 판매자 연결처럼 암호화 저장, 할당량은 봇 몫(1회 20단위) | 형식이 틀리면 시작하지 않는다. 구글 연결 설정(`LIVEJJIM_GOOGLE_CLIENT_ID`)이 없으면 시작하지 않는다. 승인한 채널이 이 채널이 아니면 잇지 않는다. 넘길 때 로그 `CHAT_SEND_FAILOVER`. 옛 봇 판매자 ID 칸은 읽지 않는다 |
| `LIVEJJIM_TT_SEND_SELLERS` | 선택 | (비움) · `seller_a,seller_b` · `*` | 틱톡 감사 채팅(D-TT-SEND-01~08)을 쓰는 판매자. 비우면 꺼짐 — 틱톡 구매자 감사는 건너뜀(NOT_SUPPORTED). 고른 판매자의 틱톡 구매자 찜이 확정되면 봇 틱톡 계정이 서버 Chromium으로 그 방송의 틱톡 라이브 채팅에 감사를 올린다(판매자 할 일 없음, 감사 스위치 그대로) | 틱톡이 허락한 연동이 아니다(자동화 제한 약관·스팸 단속) — 고른 판매자에게만 켠다. 로그 `TIKTOK_THANKS_SENT`·`TIKTOK_THANKS_FAILED` |
| `LIVEJJIM_TT_SEND_STATE_FILE` | 켤 때 필수 | `/run/livegenie-secrets/tiktok-bot.json` | 봇 틱톡 계정 Playwright 로그인 상태 파일. 사람이 `node apps/server/src/commands/tiktok-bot.ts login --out <파일>`로 한 번 로그인해 만든다(600), `node apps/server/src/commands/tiktok-bot.ts check --state <파일>`로 확인. 서버는 보낼 때마다 새 쿠키를 같은 파일에 다시 적는다 — 읽기 전용 자리면 다시 적기만 못 한다 | 켰는데 파일이 없으면 시작하지 않는다. 쿠키 값은 로그·문장에 없다 |
| `LIVEJJIM_TT_SEND_BOT_USER_IDS` | 선택 | `7300000000000000001` | 봇 틱톡 계정의 숫자 사용자 ID(쉼표 목록). 채팅에 뜬 봇 감사 글을 찜으로 읽지 않게 거른다(D-TT-SEND-06 — 없어도 보낸 글과 같은 본문은 15분 동안 거른다) | 숫자가 아니면 시작하지 않는다 |
| `LIVEJJIM_TT_SEND_CHROMIUM` | 선택 | `/usr/bin/chromium` | 틱톡 감사 채팅의 Chromium 실행 파일(비우면 Playwright가 설치한 것) | 이미지에는 Chromium이 없다 — 따로 넣는다 |
| `LIVEJJIM_TT_SEND_HEADLESS` | 선택 | (비움) · `1` | `1`이면 창 없는 브라우저. 기본은 창 있음 — 리눅스 서버는 가상 화면(`xvfb-run`)에서 띄운다 | 틱톡이 창 없는 브라우저를 가려낼 수 있다 |
| `LIVEJJIM_GOOGLE_CLIENT_ID` | 선택 | `1234-abc.apps.googleusercontent.com` | 구글 OAuth 클라이언트 ID(4절) — 감사 채팅 게시용(D-YT-SRV-13). 비우면 구글 연결이 없다(채팅 읽기는 `LIVEJJIM_YT_WEB_CHAT`로 그대로 된다) | 구글 연결 버튼이 "유튜브 연동을 준비하지 않은 서버예요."로 거절된다 |
| `LIVEJJIM_GOOGLE_CLIENT_SECRET` | 유튜브면 필수 | (구글이 준 값) | 구글 OAuth 클라이언트 비밀 | 새면 구글 콘솔에서 새로 만든다 |
| `LIVEJJIM_GOOGLE_REDIRECT_URI` | 유튜브면 필수 | `https://app.example.com/api/youtube/oauth/callback` | 구글에 등록한 돌아오는 주소 하나(https만) | 구글에 등록한 값과 다르면 연결이 실패한다 |
| `LIVEJJIM_YOUTUBE_RETURN_URL` | 선택 | `https://app.example.com/settings/youtube` | 연결을 마친 뒤 판매자를 보낼 화면(비우면 `<앱 주소>/settings/youtube`) | |
| `LIVEJJIM_YOUTUBE_QUOTA_LIMIT` | 선택 | `10000` | 구글 프로젝트의 하루 할당량(기본 10,000) | 실제보다 크게 적으면 구글이 먼저 막는다(경보 `QUOTA_EXCEEDED`) |
| `LIVEJJIM_YOUTUBE_SELLER_BUDGET` | 선택 | `5000` | 판매자 한 명의 하루 예산(기본 = 한도) | |
| `LIVEJJIM_GOOGLE_AUTH_URL` | 선택 | (비움) | 구글 승인 주소 — 보통 비워 둔다(https만) | |
| `LIVEJJIM_GOOGLE_TOKEN_URL` | 선택 | (비움) | 구글 토큰 주소 — 보통 비워 둔다 | |
| `LIVEJJIM_GOOGLE_REVOKE_URL` | 선택 | (비움) | 구글 토큰 폐기 주소 — 보통 비워 둔다 | |
| `LIVEJJIM_YOUTUBE_API_URL` | 선택 | (비움) | 유튜브 Data API 주소 — 보통 비워 둔다 | |
| `LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID` | 선택 | `1234-abc.apps.googleusercontent.com` | 간편 로그인 "구글로 계속하기"의 OAuth 클라이언트 ID(4-3절). 유튜브 연결의 `LIVEJJIM_GOOGLE_CLIENT_ID`와 다른 이름이다(값은 같아도 된다). 비밀값과 둘 다 비우면 구글 로그인 버튼이 없다 | 하나만 적으면 시작하지 않는다("구글 로그인 설정이 반만 적혀 있어요…") |
| `LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET` | 구글 로그인이면 필수 | (구글이 준 값) | 구글 OAuth 클라이언트 비밀. 서버에만 두고 로그·화면에 나오지 않는다 | 새면 구글 콘솔에서 새로 만든다 |
| `LIVEJJIM_LOGIN_KAKAO_REST_API_KEY` | 선택 | (카카오가 준 REST API 키) | 간편 로그인 "카카오로 계속하기"(4-3절). 비우면 카카오 로그인 버튼이 없다 | 틀리면 카카오 화면이 오류를 보인다 |
| `LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET` | 선택 | (카카오가 준 값) | 카카오 앱에서 "클라이언트 시크릿"을 켰을 때만 적는다. 로그·화면에 나오지 않는다 | REST API 키 없이 이것만 적으면 시작하지 않는다. 카카오 앱에서 켰는데 비우면 로그인이 실패한다 |
| `LIVEJJIM_LOGIN_NAVER_CLIENT_ID` | 선택 | (네이버가 준 값) | 간편 로그인 "네이버로 계속하기"의 클라이언트 ID(4-3절). 비밀값과 둘 다 비우면 네이버 로그인 버튼이 없다 | 하나만 적으면 시작하지 않는다 |
| `LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET` | 네이버 로그인이면 필수 | (네이버가 준 값) | 네이버 클라이언트 시크릿. 로그·화면에 나오지 않는다 | 새면 네이버 개발자 센터에서 새로 받는다 |
| `LIVEJJIM_LOGIN_APPLE_CLIENT_ID` | 선택 | `kr.livegenie.signin` | 간편 로그인 "Apple로 계속하기"의 Services ID(4-3절, D-UX3-34). 아래 셋과 함께 넷 다 적어야 켜진다 | 일부만 적으면 시작하지 않는다("Apple 로그인 설정이 일부만 적혀 있어요…") |
| `LIVEJJIM_LOGIN_APPLE_TEAM_ID` | Apple 로그인이면 필수 | `8UR4Y9DY8H` | Apple Developer 팀 ID(영문 대문자·숫자 10자) | 모양이 틀리면 시작하지 않는다 |
| `LIVEJJIM_LOGIN_APPLE_KEY_ID` | Apple 로그인이면 필수 | (키 화면의 Key ID 10자) | Sign in with Apple 키의 ID | 모양이 틀리면 시작하지 않는다 |
| `LIVEJJIM_LOGIN_APPLE_PRIVATE_KEY` | Apple 로그인이면 필수 | (.p8 가운데 글자 한 줄) | 받은 .p8 파일에서 BEGIN·END 줄을 뺀 가운데 글자를 한 줄로 붙인 값(`\n`을 넣은 PEM도 받는다). 서버가 이 키로 Apple에 낼 비밀값(5분짜리 서명)을 매번 만든다. 로그·화면에 나오지 않는다 | 읽을 수 없으면 시작하지 않는다. 새면 Apple Developer에서 그 키를 지우고(Revoke) 새로 만든다 |
| `LIVEJJIM_SMS_NCP_ACCESS_KEY` | 가입 문자 인증이면 필수 | (네이버 클라우드가 준 값) | 네이버 클라우드 인증키의 Access Key ID(D-UX3-30·D-REAL-07 — SENS). 넷(인증키 둘·서비스 ID·보내는 번호)을 다 적으면 간편 로그인 가입 때 휴대폰 번호를 문자로 확인해 같은 사람을 한 계정으로 묶는다. 넷 다 비우면 끔(바로 가입) | 일부만 적으면 서버가 시작하지 않는다. 문자가 안 가면 로그 `SMS_SEND_FAILED`(종류·HTTP 상태만) — 인증키·발신번호 등록을 본다 |
| `LIVEJJIM_SMS_NCP_SECRET_KEY` | 가입 문자 인증이면 필수 | (네이버 클라우드가 준 값) | 인증키의 Secret Key — 요청 서명(HMAC-SHA256)에 쓴다. 로그·화면에 나오지 않는다 | 새면 네이버 클라우드 인증키 관리에서 새로 만든다 |
| `LIVEJJIM_SMS_SENS_SERVICE_ID` | 가입 문자 인증이면 필수 | `ncp:sms:kr:…` | SENS 프로젝트의 SMS 서비스 ID | 틀리면 SENS가 거절한다(`SMS_SEND_FAILED`) |
| `LIVEJJIM_SMS_FROM` | 가입 문자 인증이면 필수 | `0212345678` | 인증번호 문자를 보내는 번호 — SENS에 미리 등록(발신번호 사전 등록, 전기통신사업법)한 번호, 숫자 8~12자리(하이픈 허용) | 등록하지 않은 번호면 SENS가 거절한다(`SMS_SEND_FAILED`) |
| `LIVEJJIM_OPS_ALERT_PHONE` | 선택 | `01012345678` | 운영자 문자 알림을 받을 휴대폰(D-YT-SEND-22, 하이픈 허용). 위 SENS 설정으로 보낸다: 감사 채팅 봇 계정 로그인 풀림(서버가 시작 1분 뒤·6시간마다 읽기만으로 확인하고, 보내다 풀린 것도)·계정이 글을 못 올림·서버 막힘·공식 API로 넘김·공식 API 봇 연결 풀림. 같은 일은 6~12시간에 한 번 | 비우거나 SENS 설정이 없으면 알림 없음(로그만). 010 휴대폰 모양이 아니면 끄고 시작 기록 `OPS_ALERT_PHONE_INVALID`(번호는 남기지 않음) |
| `LIVEJJIM_ASSIST_API_KEY` | 선택 | `여기에-키` | AI 확인 필요 제안의 Anthropic API 키(4-5절). 비우면 AI 제안을 쓸 수 없다 — 비슷한 글자로 찾는 규칙 제안만 보이고 바깥 호출은 0번이다. 값은 로그·화면에 나오지 않는다 | 틀리면 AI 제안 요청이 모두 실패한다(화면 "AI 제안을 지금 받지 못했어요. 직접 골라 주세요.", 로그 `ASSIST_HTTP_ERROR` status=401). 새면 Anthropic 콘솔에서 지우고 새로 만든다 |
| `LIVEJJIM_ASSIST_MODEL` | 선택 | `claude-haiku-5-5` | AI 제안 모델(비우면 `claude-haiku-5-5` — 가장 싼 Haiku). 영문·숫자·`.`·`_`·`-`·`:`만 | 모양이 틀리면 시작하지 않는다. 없는 모델이면 요청이 실패한다(로그 `ASSIST_HTTP_ERROR` status=404) |
| `LIVEJJIM_ASSIST_DAILY_CALLS` | 선택 | `20` | 판매자 한 명의 하루(KST 0시 기준) AI 호출 상한(기본 20). 실패한 호출도 센다 | 0~1000000 정수가 아니면 시작하지 않는다. 다 쓰면 그날은 규칙 제안만 |
| `LIVEJJIM_ASSIST_GLOBAL_DAILY_CALLS` | 선택 | `500` | 서버 전체 하루 AI 호출 상한(기본 500) — 비용의 마지막 막 | 0~1000000 정수가 아니면 시작하지 않는다 |
| `LIVEJJIM_STREAM_AUDIO` | 선택 | (비움) | 방송 소리로 듣기(LV1, D-LV1-08). `off`면 끈다(앞뒤 빈칸·대소문자 무시). 비우면 켬 — 서버에 ffmpeg가 있어야 한다 | ffmpeg가 없으면 시작 기록 한 줄을 남기고 꺼진다. 판매자 화면에는 "방송 소리로 듣기가 꺼져 있어요."가 보이고 휴대폰 마이크·빠른 입력은 그대로 쓴다 |
| `LIVEJJIM_YTDLP_PATH` | 선택 | `yt-dlp` | 방송 소리 주소를 찾는 yt-dlp 실행 파일 경로(D-LV1-11). 유튜브 방송 페이지에 HLS 주소가 없을 때만 부른다. 비우면 `yt-dlp`(PATH에서 찾음). 컨테이너 이미지에는 고정 판이 들어 있다 | yt-dlp가 없거나 막히면(데이터센터 IP의 봇 확인 등) 로그 `STREAM_AUDIO_YTDLP_FAILED`(종류만)를 남기고 판매자에게 "휴대폰 마이크로 들어 주세요" 안내가 보인다 |
| `LIVEJJIM_YT_MEDIA_PROXY` | 선택 | (비움) | 방송 소리용 집 회선 프록시(D-LV1-13, `deploy/home-proxy/README.md`). 값이 있으면 yt-dlp `--proxy`와 ffmpeg `-http_proxy`가 모두 이 출구로 나간다(HLS 주소에 요청 IP가 박혀 있어 조각도 같은 출구여야 한다). `http://127.0.0.1:<포트>`·`http://localhost:<포트>`·`http://host.docker.internal:<포트>`만 받는다. 컨테이너면 `http://host.docker.internal:18888` | 그 밖의 값이면 쓰지 않고 시작 기록 `STREAM_AUDIO_PROXY_IGNORED` 한 줄(값은 남기지 않음). 프록시에 닿지 못하면 경보 `STREAM_AUDIO_PROXY_DOWN`(판매자 ID만)을 남기고 판매자에게는 휴대폰 마이크 안내 |
| `LIVEJJIM_YT_WEB_PROXY` | 선택 | (비움) | 유튜브 웹 읽기(방송·채팅 페이지, 채팅 — 링크 잇기·수집기)를 `LIVEJJIM_YT_MEDIA_PROXY`의 집 회선 프록시로 보낸다(D-YT-SRV-21 — 데이터센터 IP는 봇 확인에 막힌다). 비우면 프록시가 있을 때 쓰고, `off`일 때만 바로 읽는다 | 프록시에 닿지 못하면 그 요청만 이 서버에서 바로 다시 부른다(막힐 수 있다) |
| `LIVEJJIM_TIKTOK_BETA` | 선택 | `on` | 틱톡 라이브 베타(읽기 전용, D-904) 운영자 전체 스위치. `on`일 때만 켜고, 비우거나 `off`면 끔 | 상용 출시 전 법률 검토 뒤에 켠다. `on`·`off`·빈 값이 아니면 끔으로 보고 경고 `TIKTOK_BETA_INVALID`를 남긴다 |
| `LIVEJJIM_TIKTOK_SIGN_API_KEY` | 선택 | (비움) | 틱톡 서명 서비스 키 — 보통 비워 둔다. 값은 로그·화면에 나오지 않는다 | 두지 마세요: 연결 라이브러리가 스스로 읽는 `SIGN_API_URL`·`SIGN_API_KEY`·`WHITELIST_AUTHENTICATED_SESSION_ID_HOST`(서명 키·판매자 아이디가 다른 주소로 갈 수 있다). 하나라도 있으면 서버는 정상으로 시작하되 틱톡을 끈 것으로 보고 경고 `TIKTOK_LIBRARY_ENV`(변수 이름만)를 남긴다 |
| `LIVEJJIM_TIKTOK_SIGN_DAILY_LIMIT` | 선택 | `500` | 틱톡 서명 서비스 하루(24시간) 요청 한도. 양의 정수만 받고 비우거나 잘못되면 기본값을 쓴다. 한도의 80%에 닿으면 판매자에게 "가까워요", 넘으면 "넘었어요"를 알리고 운영자에게 경고만 남긴다(CH-20) | 연결은 한도를 넘어도 막지 않는다(막으면 방송 중 댓글 수집이 끊긴다). 횟수만 로그에 남고 키 값은 나오지 않는다 |
| `LIVEJJIM_IG_APP_ID` | 선택 | `123456789012345` | 메타 개발자 앱 ID(4-1절). 앱 ID·앱 시크릿·확인 토큰·돌아오는 주소 넷 중 하나라도 비면 인스타그램 연동을 하지 않는다 | 인스타그램 기능만 꺼진다(화면에 "연동이 아직 준비되지 않았어요", 웹훅 주소는 503) |
| `LIVEJJIM_IG_APP_SECRET` | 인스타그램이면 필수 | (메타가 준 값) | 메타 앱 시크릿 — 웹훅 서명을 확인하고 토큰을 받는 데 쓴다. 값은 로그·응답에 나오지 않는다 | 틀리면 모든 웹훅이 401이라 댓글을 받지 못한다. 새면 메타 앱 설정에서 새로 만든다 |
| `LIVEJJIM_IG_VERIFY_TOKEN` | 인스타그램이면 필수 | (직접 만든 긴 무작위 값) | 웹훅 확인 토큰. `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`로 만들어 메타 앱의 웹훅 설정에도 같은 값을 넣는다 | 다르면 메타가 웹훅 주소를 등록하지 못한다 |
| `LIVEJJIM_IG_REDIRECT_URI` | 인스타그램이면 필수 | `https://app.example.com/api/instagram/callback` | 메타에 등록한 돌아오는 주소 하나(4-1절) | 메타에 등록한 값과 다르면 연결이 실패한다. 주소 모양이 아니면 시작하지 않는다. `https://`가 아니면(내 컴퓨터 시험 주소 `http://localhost`·`127.0.0.1`·`[::1]` 제외 — 메타 주소 덮어쓰기도 같다) 인스타그램을 끈 것으로 보고 경고 `INSTAGRAM_CONFIG_INSECURE`를 남긴다(서버는 시작한다) |
| `LIVEJJIM_IG_LOGIN` | 선택 | `FACEBOOK` | 로그인 방식: `FACEBOOK`(기본 — 페이스북 페이지에 이은 인스타그램 프로페셔널 계정) 또는 `INSTAGRAM` | 둘이 아니면 시작하지 않는다 |
| `LIVEJJIM_IG_SCOPES` | 선택 | (비움) | 권한 목록 덮어쓰기(쉼표 목록) — 보통 비워 둔다(로그인 방식의 기본 권한: 댓글 읽기·메시지 보내기) | 권한이 모자라면 연결 뒤 댓글 받기·감사 DM이 되지 않는다 |
| `LIVEJJIM_IG_RETURN_PATH` | 선택 | `/` | 연결을 마친 뒤 판매자를 보낼 화면 경로(기본 `/`, 결과는 `?instagram=코드`) | `/`로 시작하지 않으면 시작하지 않는다 |
| `LIVEJJIM_IG_GRAPH_URL` | 선택 | (비움) | 페이스북 그래프 API 주소 — 보통 비워 둔다(스테이징·시험용) | 주소 모양이 아니면 시작하지 않는다 |
| `LIVEJJIM_IG_IG_GRAPH_URL` | 선택 | (비움) | 인스타그램 그래프 API 주소 — 보통 비워 둔다 | 주소 모양이 아니면 시작하지 않는다 |
| `LIVEJJIM_IG_FB_DIALOG_URL` | 선택 | (비움) | 페이스북 로그인 승인 창 주소 — 보통 비워 둔다 | 주소 모양이 아니면 시작하지 않는다 |
| `LIVEJJIM_IG_IG_AUTHORIZE_URL` | 선택 | (비움) | 인스타그램 로그인 승인 창 주소 — 보통 비워 둔다 | 주소 모양이 아니면 시작하지 않는다 |
| `LIVEJJIM_IG_IG_TOKEN_URL` | 선택 | (비움) | 인스타그램 로그인 토큰 주소 — 보통 비워 둔다 | 주소 모양이 아니면 시작하지 않는다 |
| `LIVEJJIM_BAND_CLIENT_ID` | 선택 | (밴드가 준 값) | 네이버 밴드 개발자 "내 서비스"의 Client ID(4-6절). Client ID·Client Secret·돌아오는 주소 셋 중 하나라도 비면 밴드 연동을 하지 않는다 | 밴드 기능만 꺼진다(화면에 "밴드 연동이 아직 준비되지 않았어요") |
| `LIVEJJIM_BAND_CLIENT_SECRET` | 밴드면 필수 | (밴드가 준 값) | 밴드 Client Secret — 토큰을 받는 데 쓴다. **비밀값**: 로그·응답에 나오지 않는다 | 새면 밴드 개발자 사이트에서 새로 만든다 |
| `LIVEJJIM_BAND_REDIRECT_URI` | 밴드면 필수 | `https://app.example.com/api/band/callback` | 밴드에 등록한 돌아오는 주소(이 서버의 `GET /api/band/callback/<한 번 쓰는 표>`의 앞부분 — 서버가 뒤에 표를 붙인다) | `https://`가 아니면(내 컴퓨터 시험 주소 `http://localhost`·`127.0.0.1`·`[::1]` 제외 — 아래 두 주소도 같다) 밴드를 끈 것으로 보고 경고 `BAND_CONFIG_INVALID`(값 없이)를 남긴다(서버는 시작한다) |
| `LIVEJJIM_BAND_AUTH_URL` | 선택 | (비움) | 밴드 승인·토큰 주소 덮어쓰기(스테이징·시험용) — 보통 비워 둔다(`https://auth.band.us`) | 위와 같은 주소 규칙 |
| `LIVEJJIM_BAND_API_URL` | 선택 | (비움) | 밴드 Open API 주소 덮어쓰기(스테이징·시험용) — 보통 비워 둔다(`https://openapi.band.us`) | 위와 같은 주소 규칙 |
| `LIVEJJIM_POPBILL_LINK_ID` | 선택 | (팝빌이 준 값) | 팝빌 연동 아이디(4-2절). 연동 아이디·비밀 키 둘 다 있을 때만 계좌조회 원천을 만들 수 있다 | 계좌조회 원천만 꺼진다(화면에 "계좌 연동은 아직 준비 중이에요"). 붙여넣기 원천·판매는 그대로 |
| `LIVEJJIM_POPBILL_SECRET_KEY` | 계좌조회면 필수 | (팝빌이 준 값) | 팝빌 비밀 키(base64). 값은 로그·응답에 나오지 않는다 | 틀리면 받아 오기가 실패해 원천에 쉬운 오류 문장이 뜬다(다음 주기에 다시 함). 새면 팝빌에서 새로 받는다 |
| `LIVEJJIM_POPBILL_TEST_BED` | 선택 | (비움) | `true`면 팝빌 테스트베드를 쓴다 — 운영은 비워 둔다 | 운영에서 `true`면 실제 입금 내역을 받지 못한다 |
| `LIVEJJIM_BACKUP_DIR` | 백업이면 필수 | `/backups` | 백업 명령이 덤프를 둘 폴더(미리 만들어 둔다). 서버도 이 폴더의 판매자 ID 하위 폴더에 매일 판매자 백업을 둔다(I2 D-I2-10·D-I2-16 — 서버 컨테이너에도 같은 폴더를 붙인다) | 없으면 백업 명령이 실패하고(경보 `BACKUP_FAILED`) 서버의 판매자 자동 백업은 꺼진다(시작 경보, 판매는 그대로) |
| `LIVEJJIM_PG_DUMP` | 선택 | `/usr/lib/postgresql/17/bin/pg_dump` | 백업에 쓸 `pg_dump` 경로(기본 `pg_dump`) | DB보다 낮은 버전이면 백업이 실패한다 |
| `LIVEJJIM_BILLING` | 선택 | `on` | 요금 기능(이용권·결제, N5) 스위치. `on`일 때만 켜고, 비우거나 `off`면 끔(꺼지면 막지도 세지도 않고 요금 화면·경로가 없다) | `on`·`off`·빈 값이 아니면 시작하지 않는다. 켰는데 요금 표가 자리 표시 값이거나 포트원 값 넷 중 하나라도 비면 시작하지 않는다 |
| `LIVEJJIM_BILLING_PRICES` | 요금이면 필수 | `/app/config/prices.json` | 요금 표 JSON 파일 경로(형식은 `.env.example`). 비우면 기본 표(자리 표시 값) | 파일을 읽지 못하거나 형식이 틀리면 꺼져 있어도 시작하지 않는다 |
| `PORTONE_STORE_ID` | 요금이면 필수 | (포트원이 준 값) | 포트원 V2 상점 ID — 결제 창에 쓰는 공개 값 | 틀리면 결제 창이 열리지 않는다 |
| `PORTONE_CHANNEL_KEY` | 요금이면 필수 | (포트원이 준 값) | 포트원 V2 채널 키(결제 대행 채널 토스페이먼츠) — 결제 창에 쓰는 공개 값 | 틀리면 결제 창이 열리지 않는다 |
| `PORTONE_API_SECRET` | 요금이면 필수 | (포트원이 준 값) | 포트원 V2 API 비밀값 — 결제 조회·취소에 쓴다. 서버에만 두고 로그·화면에 나오지 않는다 | 틀리면 결제를 확인하지 못해 주문이 "확인 중"에 머문다. 새면 포트원 콘솔에서 새로 만든다 |
| `PORTONE_WEBHOOK_SECRET` | 요금이면 필수 | (포트원이 준 값) | 포트원 웹훅 서명 비밀값. 포트원 콘솔의 웹훅 주소는 `<앱 주소>/api/billing/webhook` | 틀리면 웹훅을 받지 않는다(결제는 화면의 "다시 확인"·결제 조회로 맞춘다). 새면 새로 만든다 |
| `LIVEJJIM_RECEIPT_ISSUER` | 선택 | `none` | 계좌이체 증빙 발행기(PAY2 D-PAY-10). 비우거나 `none` = 없음(운영 기본 — "발행 대기"로 남고 `billing-list`로 보고 손으로 발행). `portone` = 포트원 현금영수증(지출증빙) 자동 발급 — 먼저 그 결제의 현금영수증을 조회해 PG가 이미 낸 것과 겹치지 않게 한다. **금액 칸(공급가액·세액) 세무 확인 뒤에만 켠다** | `none`·`portone`·빈 값이 아니면 시작하지 않는다. `portone`인데 `PORTONE_STORE_ID`·`PORTONE_CHANNEL_KEY`·`PORTONE_API_SECRET` 중 하나라도 비면 시작하지 않는다. 사업자등록번호는 로그에 남지 않는다 |
| `LIVEJJIM_EPOST_API_KEY` | 비워 둔다 | (비움) | 우체국 택배 연동 키 자리(4-4절) — 우체국 택배 계약 뒤 실제 택배사 어댑터를 만든 다음에 쓴다. T1 서버는 이 값을 쓰지 않는다 | 값이 있으면 서버는 정상으로 시작하되 쓰지 않고 경고 `PARCEL_CARRIER_NOT_READY`를 남긴다 |
| `LIVEJJIM_DATA_GO_KR_KEY` | 선택 | (공공데이터포털이 준 일반 인증키) | 우체국 배송 상태 자동 조회(종적 조회)와 받는 분 우편번호 찾기(D-REAL-08). "우정사업본부_국내우편물 종적 조회 서비스"·"우정사업본부_도로명주소조회서비스" 둘 다 활용신청한 키 하나. 비우면 둘 다 꺼짐(접수됨에서 멈춤·우편번호 없는 주소는 주소 확인) | 틀리면 조회가 실패하고 상태가 그대로 남는다. 새면 공공데이터포털에서 재발급 |

## 3. 처음 배포

> AWS EC2 한 대(서울, docker compose + Caddy 자동 https + SSM 비밀값 + S3 매일 백업)로 올리는 묶음과 CloudShell 순서는 [deploy/ec2/README.md](../deploy/ec2/README.md)에 있다.

1. **데이터베이스**를 만들고 `DATABASE_URL`을 받는다.
2. **이미지**: `docker build -t livejjim .` (저장소 루트). 여러 단계 빌드로 화면을 빌드해 넣고 root가 아닌 사용자로 돈다.
3. **환경변수**를 업체 설정에 넣는다(2절 — 적어도 `DATABASE_URL`·`LIVEJJIM_MASTER_KEY`·`LIVEJJIM_APP_ORIGIN`).
4. **마이그레이션**: `pnpm --filter @livejjim/server migrate` (컨테이너: `node apps/server/src/commands/migrate.ts`). 서버도 시작할 때 적용하지만, 처음엔 따로 한 번 돌려 확인한다.
5. **판매자 계정**: `pnpm --filter @livejjim/server create-account --name "가게 이름" --login 아이디` (컨테이너: `node apps/server/src/commands/create-account.ts --name … --login …`). **비밀번호는 명령행 인자가 아니라 표준 입력**으로 받는다(터미널이면 화면에 보이지 않는다). 가입 화면은 없다.
6. **시작**: 컨테이너를 띄운다(`node apps/server/src/main.ts`, 저장소에서는 `pnpm --filter @livejjim/server start`). 설정이 틀리면 쉬운 문장으로 알리고 시작하지 않는다(값은 출력하지 않는다).
7. **준비 확인**: `curl https://app.example.com/health/ready` → `{"status":"ready"}` (200). 503이면 DB 연결을 본다.
8. **로그인**: 브라우저로 앱 주소를 열어 만든 계정으로 로그인한다.
9. **시작 마법사**가 처음 한 번 뜬다(실제 방송이 없는 판매자) — 가게 이름 → 판매 규칙 → 프린터 → 유튜브 → 리허설.

## 4. 구글 OAuth (유튜브 연동, D-019)

1. 구글 클라우드 콘솔에서 프로젝트를 만들고 **YouTube Data API v3**를 켠다.
2. OAuth 동의 화면: 앱 이름, 지원 이메일, **개인정보처리방침 주소 `<앱 주소>/privacy`**, **서비스 약관 주소 `<앱 주소>/terms`**(로그인 없이 열린다 — 지금은 초안, 법률 검토는 사용자 몫 D-012).
3. 권한(범위): `https://www.googleapis.com/auth/youtube.readonly`(연결 — 채널 이름·내 라이브 목록·채팅 읽기)와 `https://www.googleapis.com/auth/youtube.force-ssl`(판매자가 감사 메시지 자동 게시에 동의할 때만 더 받는다).
4. OAuth 클라이언트(웹 애플리케이션): **승인된 리디렉션 URI = `<앱 주소>/api/youtube/oauth/callback`** → `LIVEJJIM_GOOGLE_REDIRECT_URI`에 같은 값, 클라이언트 ID·비밀을 `LIVEJJIM_GOOGLE_CLIENT_ID`·`LIVEJJIM_GOOGLE_CLIENT_SECRET`에.
5. **검증**: 민감한 범위(`youtube.force-ssl`)는 구글의 앱 검증이 필요하다. 검증 전에는 테스트 사용자로 등록한 계정만 연결된다(D-019 — 사용자 몫).

### 할당량
- 구글 프로젝트 하루 할당량(기본 10,000단위, 태평양 자정에 다시 채워짐)을 `LIVEJJIM_YOUTUBE_QUOTA_LIMIT`에, 판매자 한 명의 예산을 `LIVEJJIM_YOUTUBE_SELLER_BUDGET`에 적는다.
- 남은 양이 예산의 20% 아래면 감사 메시지를 묶어서 보내고, 5% 아래거나 구글이 초과를 알리면 감사 메시지를 멈춘다(채팅 수집은 계속). 판매자 화면에 한국 시간으로 보인다.
- 판매자가 늘면 구글 콘솔에서 할당량 증설을 신청한다(경보 `QUOTA_EXCEEDED`가 보이면).

## 4-1. 메타 앱 (인스타그램 라이브 연동, D-N2-06·D-N2-11)

1. 메타 개발자 사이트에서 앱을 만들고 앱 ID·앱 시크릿을 `LIVEJJIM_IG_APP_ID`·`LIVEJJIM_IG_APP_SECRET`에 넣는다.
2. 로그인 설정의 **돌아오는 주소 = `<앱 주소>/api/instagram/callback`** → `LIVEJJIM_IG_REDIRECT_URI`에 같은 값.
3. **웹훅**: 받는 주소 `<앱 주소>/webhooks/instagram`(로그인 없이 서명으로만 받는다), 확인 토큰은 `LIVEJJIM_IG_VERIFY_TOKEN`과 같은 값, 구독 필드 `live_comments`.
4. 댓글·메시지 권한의 고급 액세스 심사와 비즈니스 인증, 판매자의 인스타그램 프로페셔널 계정과 페이스북 페이지 연결은 사용자 몫이다(DECISIONS "사용자 확인 필요" — 메타 앱·심사·계정).

## 4-2. 팝빌 (입금 자동 확인의 계좌조회, N3 D-N3-09)

1. 팝빌 연동 신청으로 받은 연동 아이디·비밀 키를 `LIVEJJIM_POPBILL_LINK_ID`·`LIVEJJIM_POPBILL_SECRET_KEY`에 넣는다(계약·요금·발급은 사용자 몫).
2. 서버는 연동 키 하나로 모든 판매자를 대신해 팝빌을 부른다. 운영자가 그 판매자의 팝빌 연동회원 등록과 사업자번호 주인을 확인한 뒤 판매자에게 사업자번호를 묶는다:
   `node apps/server/src/commands/popbill-corp.ts --login 아이디 --corp 사업자번호` (풀기: `--clear yes`). 묶지 않은 판매자는 계좌조회 원천을 쓸 수 없다.
3. 계좌 비밀번호·빠른조회 비밀번호는 이 서비스가 받지 않는다 — 판매자가 화면의 "계좌 관리" 주소(팝빌 화면)에서 직접 등록한다.

## 4-3. 간편 로그인 설정 (구글·카카오·네이버·Apple, L1 D-L1-01~D-L1-07, D-UX3-34)

판매자가 아이디·비밀번호 대신 구글·카카오·네이버 계정으로 로그인하게 한다. **가입은 받지 않는다** — 판매자 계정은 지금처럼 운영자가 만들고(3절 5), 판매자가 아이디로 한 번 로그인한 뒤 설정 → "로그인 방법"에서 공급자 계정을 연결해야 그 계정으로 들어올 수 있다. 공급자마다 따로 켜고 끈다. 아이디·비밀번호 로그인은 늘 남는다.

| 공급자 | 앱 만들기 | 돌아오는 주소(정확히 이 값 하나) | 묻는 권한 | 환경 변수 |
|---|---|---|---|---|
| 구글 | 구글 클라우드 콘솔 → OAuth 클라이언트(웹 애플리케이션). 유튜브 연결(4절)과 같은 프로젝트·동의 화면을 써도 된다 | `<앱 주소>/api/auth/google/callback` | `openid email`만(유튜브 권한은 묻지 않는다 — 유튜브 연결은 따로 묻는다) | `LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID`·`LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET` |
| 카카오 | 카카오 디벨로퍼스 → 내 애플리케이션 → 카카오 로그인 켜기. (선택) 보안 → 클라이언트 시크릿 켜기 | `<앱 주소>/api/auth/kakao/callback` | 추가 권한 없음(회원 번호, 받으면 닉네임). 이메일은 비즈 앱으로 바꾼 뒤에만 받을 수 있는데, **이메일이 없어도 연결·로그인이 된다**(설정에는 "카카오 계정"으로 보인다) | `LIVEJJIM_LOGIN_KAKAO_REST_API_KEY`(필수)·`LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET`(시크릿을 켰을 때만) |
| 네이버 | 네이버 개발자 센터 → 애플리케이션 등록 → 네이버 로그인. 서비스 URL = `<앱 주소>` | `<앱 주소>/api/auth/naver/callback` | 회원 ID(필수 항목만, 받으면 이메일·별명). 판매자 여럿에게 열기 전에 **네이버 검수**를 받는다(검수 전에는 등록한 테스트 아이디만 된다) | `LIVEJJIM_LOGIN_NAVER_CLIENT_ID`·`LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET` |
| Apple | Apple Developer → Identifiers: 앱 ID(`app.livejjim.mobile`)에 Sign in with Apple 켜기 → Services ID 새로 만들기(예: `kr.livegenie.signin`)·Sign in with Apple 켜고 Configure에서 기본 앱 ID 고르기·Domains `livegenie.kr`·Return URL 적기 → Keys: 새 키에 Sign in with Apple 켜기(기본 앱 ID) → .p8 내려받기(한 번만 받을 수 있다) | `<앱 주소>/api/auth/apple/callback` | 권한 없음(사용자 ID만 — 이름·이메일은 묻지 않는다, 그래서 Apple 화면에서 돌아올 때 GET 질의로 받는다) | `LIVEJJIM_LOGIN_APPLE_CLIENT_ID`·`LIVEJJIM_LOGIN_APPLE_TEAM_ID`·`LIVEJJIM_LOGIN_APPLE_KEY_ID`·`LIVEJJIM_LOGIN_APPLE_PRIVATE_KEY` |

- **비밀값 보관**: 클라이언트 비밀·시크릿은 업체의 비밀값 설정에만 넣는다(이미지·저장소·로그에 넣지 않는다). 서버는 공급자가 준 토큰을 저장하지 않는다 — 로그인할 때 사용자 정보를 읽는 데만 쓰고 버린다. 저장하는 것은 공급자 계정 번호와 가린 이메일(예: `se***@gmail.com`)뿐이다.
- **반만 적으면 시작하지 않는다**: 구글·네이버는 ID와 비밀을 둘 다, 카카오는 REST API 키를, Apple은 넷 다 적어야 한다("○○ 로그인 설정이 반만 적혀 있어요. 둘 다 적거나 둘 다 지워 주세요."). 공급자 주소는 서버에 고정되어 있어 바꾸는 설정이 없다.
- **끄는 법**: 그 공급자의 환경 변수를 지우고 서버를 다시 켠다. 로그인 화면의 그 버튼이 사라지고, 이미 연결한 판매자는 설정에서 "지금은 쓸 수 없어요"와 [연결 끊기]만 보인다(아이디 로그인은 그대로).
- **확인**: 서버를 다시 켠 뒤 로그인 화면 아래 "또는" 줄과 버튼이 보이는지, 시험 판매자로 설정 → 로그인 방법 → [연결하기] → 로그아웃 → "…로 계속하기"가 되는지 본다.
- 각 공급자의 디자인 지침(공식 로고 그림 요구 여부)·실제 앱 등록·검수·개인정보처리방침의 수집 항목 검토는 사용자 몫이다(DECISIONS "사용자 확인 필요").

## 4-4. 택배 자동 접수 (T1, PARCEL_RULES·D-T1-02·HG-T1)

1. **가짜 택배사는 시험 모드에서만** 뜬다: E2E 기동(서버 패키지의 `e2e` 스크립트 — 시험용, 운영에서 쓰지 않는다)이 `127.0.0.1`의 빈 포트에 가짜 택배사를 띄우고 서버가 그 주소를 쓴다. 운영 기동(`node apps/server/src/main.ts`)에는 택배사 어댑터가 하나도 없다 — 설정 "택배"에서 쓰는 택배사(우체국택배·CJ대한통운·한진택배·로젠택배·롯데택배·직접 입력)는 고를 수 있지만 자동 접수는 막혀 있고(택배 화면 "고른 택배사는 아직 자동 접수를 할 수 없어요…", FB1 D-FB1-04), 바깥 주소로 나가는 택배사 연결이 없다. 판매자는 지금처럼 포장 모드에서 "배송 완료"와 송장번호를 손으로 적는다.
2. **실제 택배사(1차 우체국 택배)** 는 사용자가 우체국과 계약 소포를 맺어 고객 번호·연동 키를 받은 뒤, 실제 응답을 보고 어댑터를 만든 다음에 켠다(같은 요청 번호로 같은 송장번호를 주는지 먼저 확인한다). 그때까지 `LIVEJJIM_EPOST_API_KEY`는 비워 둔다.
3. **배송지 30일 정리 작업은 서버 안에서 돈다**: 서버가 켜져 있는 동안 1시간마다 주문 날짜 + 30일의 0시(KST)가 지난 배송지(받는 분·연락처·주소·메모 암호문)를 지운다(로그 `PARCEL_ADDRESSES_SWEPT` — 지운 수만). 따로 예약 작업을 걸지 않는다. 접수 기록의 택배사·송장번호·상태는 남는다.
4. **배송 조회**: 서버가 접수한 택배를 30분마다 한 번에 조회한다(접수 뒤 14일·도착이면 그만). 실패하면 마지막 상태 그대로 두고 로그 `PARCEL_TRACK_FAILED`(택배사 코드·HTTP 상태만)를 남긴다.
5. 배송지·보내는 사람·택배사 고객 번호는 서버 마스터 키(`LIVEJJIM_MASTER_KEY`)로 암호화해 DB에 둔다 — 운영 DB 백업에는 암호문만 있고, 판매자 백업·전체 기록 파일에는 배송지가 없다. 복구·가져오기는 그 판매자의 배송지를 모두 지운다.

## 4-5. AI 확인 필요 제안 (Anthropic, A1 D-A1-04·D-A1-06·D-A1-08)

옵션 방송(상품명·옵션도 받기)에서 "확인 필요"로 모인 댓글 중 오타·애매한 상품 이름(사유 `UNKNOWN_WORD`·`PRODUCT_AMBIGUOUS`)에 "제안: 21번 반바지 M 1개"를 붙인다. 제안은 판정이 아니다 — 판매자가 [이대로 주문]을 누를 때만 주문이 된다.

- **규칙 제안은 늘 켜져 있고 돈이 들지 않는다**(비슷한 글자로 찾음, 바깥 호출 없음). AI 제안은 서버에 키가 있고 **판매자가 설정 → "AI 제안"에서 동의하고 켠 경우에만** 쓴다(기본 꺼짐).
- **키 만들기**: console.anthropic.com → 조직 만들기 → **결제 수단 등록**(선불 크레딧) → Settings → API Keys → Create Key. 받은 값을 업체 비밀값 설정의 `LIVEJJIM_ASSIST_API_KEY`에 넣고 서버를 다시 켠다(저장소·이미지·대화창에 붙이지 않는다).
- **결제 한도 걸기(꼭)**: Anthropic 콘솔 → Settings → Limits에서 **월 사용 한도**를 작게(예: 1만~3만 원어치) 건다. 서버도 하루 상한(판매자마다 `LIVEJJIM_ASSIST_DAILY_CALLS` 기본 20번, 서버 전체 `LIVEJJIM_ASSIST_GLOBAL_DAILY_CALLS` 기본 500번)으로 막지만, 콘솔 한도가 마지막 안전망이다.
- **얼마나 드나**: 확인 필요 화면을 열 때 방송마다 한 번, 많아야 20개 댓글을 묶어 가장 싼 모델(`claude-haiku-5-5`)에 묻는다. 한 번에 상품 목록 + 짧은 글 + 짧은 JSON이라 수천 토큰 — 보통 한 번에 몇 원 수준이다(정확한 값은 Anthropic 요금표). 같은 글은 다시 묻지 않는다(캐시). 서버는 호출마다 판매자·날짜·입력/출력/캐시 토큰·성공 여부를 `assist_calls` 표에 남긴다(원 단위 계산은 하지 않는다).
- **보내는 것**: 가린 댓글 글(닉네임 없음, `@` 부르기 빼고, 이어진 숫자 7개 이상은 `***`, 200글자까지)·읽은 번호·상품의 번호·이름·별칭·옵션 이름·선택지 이름. 가격·재고·가게 이름·판매자/구매자 ID는 보내지 않는다. 댓글 글·요청·응답은 저장·로그하지 않는다(캐시는 글의 해시와 제안만).
- **유튜브에서 받은 채팅(공식 연결·크롬 확장)은 AI로 보내지 않는다 — 규칙 제안만**(AIY1 D-AIY1-01). 출처를 모르는 채팅도 보내지 않는다. AI로 가는 것은 인스타그램·틱톡·붙여넣기 댓글과 리허설 채팅뿐이다. 뺀 개수는 로그 `ASSIST_EXCLUDED`(판매자 ID·개수만)로 남는다.
- **주소는 고정**(`https://api.anthropic.com`)이다. 주소를 바꾸는 환경 변수는 없다(다른 이름의 변수를 적어도 읽지 않는다). 시험·연습 모드만 127.0.0.1의 가짜 AI 서버를 쓴다.
- **끄는 법**: `LIVEJJIM_ASSIST_API_KEY`를 지우고 서버를 다시 켠다 — 모든 판매자에게 규칙 제안만 보이고 설정 칸은 "지금은 쓸 수 없어요."가 된다. 판매자 한 명만 끄려면 그 판매자가 설정에서 [끄기]를 누른다. 키가 새면 콘솔에서 그 키를 지운다.
- **확인**: 서버를 다시 켠 뒤 시험 판매자로 설정 → AI 제안 → 동의하고 켜기 → 옵션 리허설에서 "시청자로 보내기"로 `반바지 엠사이즈` 같은 글을 넣고 확인 필요 화면을 연다. 실패하면 로그의 `ASSIST_HTTP_ERROR`(status)·`ASSIST_TIMEOUT`을 본다.
- 실제 키·결제 계정, 상한 값, 모델 이름, "댓글 글이 AI 회사(미국)로 간다"는 고지·개인정보처리방침 문장의 법률 확인은 사용자 몫이다(DECISIONS "사용자 확인 필요").

## 4-6. 네이버 밴드 (글 댓글로 찜 받기, BND1 D-BND1-01·D-BND1-11·D-BND1-13)

1. developers.band.us "내 서비스"에 서비스를 등록하고 Client ID·Client Secret을 `LIVEJJIM_BAND_CLIENT_ID`·`LIVEJJIM_BAND_CLIENT_SECRET`에 넣는다(사용자 몫 — 밴드 Open API 약관의 상업적 이용·호출 한도를 먼저 읽는다).
2. 돌아오는 주소(Redirect URI)로 `<앱 주소>/api/band/callback`을 등록하고 같은 값을 `LIVEJJIM_BAND_REDIRECT_URI`에 넣는다. 서버는 그 뒤에 한 번 쓰는 표를 붙여 보낸다(공식 문서: 등록한 주소의 하위 경로로만 돌아온다 — 실물 확인 HG-BND1 2).
3. 밴드 모듈이 부르는 주소는 읽기 일곱 개뿐이다(모두 GET): `/oauth2/authorize`(브라우저)·`/oauth2/token`·`/v2/profile`·`/v2.1/bands`·`/v2/band/posts`·`/v2.1/band/post`·`/v2/band/post/comments`. 밴드에 글·댓글을 쓰지 않는다.
4. 밴드 토큰은 주소 질의에 실린다 — 앞단 프록시·로드 밸런서의 요청 주소 로그가 밴드로 나가는 요청을 남기지 않게 한다(서버는 바깥으로 나가는 주소를 로그에 쓰지 않는다, D-BND1-14).

## 4-7. 고객센터 메일 help@livegenie.kr (D-OPS-MAIL-01, 2026-11-06)

앱 로그인 화면 맨 아래의 고객센터 이메일(`SUPPORT_EMAIL`, D-UX3-32)이다. 서버 코드와는 관계없고 DNS와 외부 서비스로만 동작한다. **비용 0원**(가비아 도메인 연장비 말고 없음).

```
보내는 사람 → help@livegenie.kr → 가비아 DNS의 MX → ImprovMX(무료) → yuh001205@gmail.com
답장: Gmail "다른 주소에서 메일 보내기"(smtp.gmail.com:587, 앱 비밀번호) → 보내는 사람 help@livegenie.kr
```

| 위치 | 설정 |
|---|---|
| 가비아 DNS (livegenie.kr) | `MX @ mx1.improvmx.com. 10` · `MX @ mx2.improvmx.com. 20` · `TXT @ "v=spf1 include:spf.improvmx.com include:_spf.google.com ~all"` (A `@`·`www`는 서버용, 따로) |
| ImprovMX (계정 yuh001205@gmail.com) | 도메인 livegenie.kr · `help@` → yuh001205@gmail.com · `*@`(나머지 주소 전부) → yuh001205@gmail.com |
| Gmail | 설정 → 계정 → 다른 주소에서 메일 보내기: help@livegenie.kr, SMTP `smtp.gmail.com` 587 TLS, 사용자 = Gmail 주소, 비밀번호 = 구글 앱 비밀번호(2단계 인증 필요). "메일을 받은 주소에서 답장"을 켠다 |

**무료 한도**

| 항목 | 한도 |
|---|---|
| ImprovMX 도메인·주소 | 도메인 1개, 주소 25개 |
| 넘겨 받기 | 하루 500통 |
| ImprovMX 기록 | 7일 |
| ImprovMX로 직접 보내기 | 안 됨(유료 Premium 월 $9부터) — 그래서 Gmail로 보낸다 |
| Gmail 보내기 | 개인 Gmail 하루 약 500명 |
| 저장 | Gmail 15GB(드라이브·사진과 같이 씀) |

**주의**
1. 가비아의 MX 두 줄·TXT 한 줄을 지우거나 바꾸지 않는다(MX가 빠지면 그때부터 메일이 안 온다). 다른 메일 발송 서비스를 더할 때는 SPF 줄을 새로 만들지 말고 지금 줄에 `include:…`를 덧붙인다 — SPF 줄이 둘이면 둘 다 무효다. SPF는 DNS 조회 10번까지만 된다.
2. 보낸 메일은 Gmail 서버로 나가 받는 쪽에 "gmail.com 경유"로 보이거나 가끔 스팸함에 갈 수 있다. DMARC 줄(`p=quarantine`·`p=reject`)은 넣지 않는다 — 우리 답장이 막힌다.
3. 구글 비밀번호를 바꾸면 앱 비밀번호가 무효가 되어 보내기만 멈춘다(받기는 된다). 새 앱 비밀번호를 만들어 Gmail 설정에 다시 넣는다.
4. ImprovMX 무료는 가동 보장이 없다(유료 99%). 드물게 늦거나 빠질 수 있으니 문자·전화 연락 길도 남긴다.
5. `*@` 넘기기 때문에 스팸이 늘면 ImprovMX에서 `*` 줄만 지운다(help@는 남는다).
6. 개인 메일과 섞이므로 Gmail 필터(받는 사람 help@livegenie.kr → 라벨 "고객센터")를 둔다. 답장할 때 보내는 사람이 help@인지 본다.
7. 손님 메일이 해외 서비스(ImprovMX·Google)를 지나 개인 Gmail에 저장된다 — 개인정보처리방침의 처리 위탁·국외 이전 항목 검토가 필요하다(사용자 확인 필요).
8. ImprovMX 계정을 잃으면 넘기기를 바꿀 수 없다. ImprovMX 계정에 2단계 인증을 켠다.
9. **받는 사람 더하기**(예: 함께 보는 사람): ImprovMX → livegenie.kr → help@ 줄에 받는 주소를 더한다. 그 사람도 자기 Gmail에서 위 보내기 설정을 하면 help@로 답장할 수 있다.
10. "gmail.com 경유" 없이 보내려면 ImprovMX 유료(월 $9)나 Zoho Mail Lite(1인 월 약 $1~1.25)로 옮긴다.
11. **확인**: 다른 주소에서 help@livegenie.kr로 보내 Gmail에 오는지 본다(2026-11-06 확인함). DNS 확인은 `dig +short MX livegenie.kr`·`dig +short TXT livegenie.kr` 또는 ImprovMX → DNS Records의 ✓.

## 5. 운영 토큰·앞단 프록시

- **운영 토큰** `LIVEJJIM_OPS_TOKEN`(32자 이상)이 있으면 `/ops/status`가 열린다: `curl -H "Authorization: Bearer <토큰>" https://app.example.com/ops/status`. 토큰이 다르거나 없으면 401(힌트 없음), 설정이 없으면 404.
- **앞단 프록시**: 업체의 부하 분산기·CDN이 서버 앞에 있으면 그 수를 `LIVEJJIM_TRUSTED_PROXIES`에 적는다(보통 1). 로그인 IP 한도(같은 IP 10분에 20번)는 그때 `X-Forwarded-For`의 오른쪽에서 그 번째 주소를 본다. 프록시가 없는데 1 이상으로 적으면 공격자가 머리글을 바꿔 한도를 피할 수 있다 — 프록시 수와 꼭 같게 적는다. 0이면 TCP 연결 주소를 센다. `/s/` 공개 일정 페이지의 접속 주소 한도도 같은 값을 쓰고, IPv6는 앞 64비트를 한 칸으로 센다.
- 로그인 비밀번호 확인은 서버마다 동시에 4개까지다(넘치면 "지금 로그인 요청이 많아요." — 이미 로그인한 판매자는 상관없다).

### 자체 받아쓰기 연결 (APP1·APP1b)

앞단 프록시는 `/api/voice/stream`과 `/api/voice/worker`의 WebSocket 업그레이드와 지속 연결을 Node 서버로 넘겨야 한다. 기기 연결은 세션 쿠키와 `LIVEJJIM_APP_ORIGIN`과 같은 `Origin`이 필요하다. 앱도 네이티브 쿠키 저장소와 명시한 출처를 사용한다. 서버는 15초마다 핑을 보내며 30초 안에 응답이 없으면 연결을 정리한다.

일꾼은 [받아쓰기 일꾼 안내](../packages/voice/transcriber/README.md)에 따라 설치한 뒤 `wss://<앱 주소>/api/voice/worker`에 먼저 연결한다. 일꾼 토큰은 화면 번들·주소 매개변수에 넣지 않는다. `pnpm try`는 git에서 빠지는 연습 폴더에 토큰 파일을 만들고 그 파일 경로만 안내한다. 휴대폰 연습 중계는 기기 음성 경로만 넘기므로 일꾼은 안쪽 서버에 직접 연결한다.

현재 중계·읽기 세션은 서버 프로세스 메모리에 있다. 운영은 한 Node 프로세스로 시작한다. 여러 프로세스로 확장할 때는 일꾼과 기기 연결 배치·판매자별 한 흐름 제한을 공유하는 설계를 먼저 적용한다. 읽기 세션의 소리·받아쓴 글·후보는 저장하지 않으며, 명시적으로 배운 별칭만 판매자 계정 DB에 저장한다. 크롬 받아쓰기도 `mode=chrome`으로 같은 서버 읽기를 사용한다.

## 6. 새 버전·백업·복구

### 새 버전
운영(EC2)은 main에 푸시하면 맥 미니의 내보내기가 올린다. 방송 중에는 미룬다 — 6-1절.

1. **백업**을 먼저 한다(아래).
2. **마이그레이션**: `pnpm --filter @livejjim/server migrate` (컨테이너: `node apps/server/src/commands/migrate.ts`). **서버가 여럿이면 새 버전 서버를 띄우기 전에 마이그레이션을 한 번만 먼저** 한다.
3. 새 이미지로 **다시 시작**한다. 진행 중인 방송의 채팅 수집은 다시 시작한 서버가 저장한 지점부터 이어받는다.

### 백업 (DAT-03 — 매일, 30일 보관)
- 명령: `pnpm --filter @livejjim/server backup` (컨테이너: `node apps/server/src/commands/backup.ts`). `DATABASE_URL`의 PostgreSQL 전체를 `pg_dump` 사용자 정의 형식으로 `LIVEJJIM_BACKUP_DIR`에 `livejjim-YYYYMMDD-HHmmss.dump`(UTC)로 둔다. 임시 이름으로 다 쓴 뒤 이름을 바꾼다.
- 성공하면 그 폴더에서 이름 모양이 맞는 **30일 넘은 백업을 지운다**(가장 최근 것은 늘 하나 남긴다, 다른 파일은 건드리지 않는다). **실패하면 아무것도 지우지 않고** 종료 코드 1·경보 `BACKUP_FAILED`.
- 연결 문자열·비밀번호는 `pg_dump`의 환경변수로만 넘긴다(명령행 인자·로그에 나오지 않는다).
- 이미지에는 데비안 bookworm의 `pg_dump`(PostgreSQL 15 클라이언트)가 들어 있다. **DB가 16 이상이면** 같은 메이저의 `pg_dump`가 있는 곳(예: 같은 버전의 `postgres` 이미지에 이 저장소를 넣은 작업 컨테이너)에서 돌리거나 `LIVEJJIM_PG_DUMP`로 그 경로를 적는다.
- **일정**: 앱 안에 타이머는 없다(서버가 여럿이면 두 번 돌고 꺼지면 안 돈다). 업체의 예약 작업(cron)으로 **매일 04:00(KST)** 돌린다. 예(서버 시간대가 UTC인 cron):
  ```
  0 19 * * *  docker run --rm --env-file /etc/livejjim.env -v /srv/livejjim-backups:/backups -e LIVEJJIM_BACKUP_DIR=/backups livejjim node apps/server/src/commands/backup.ts
  ```
- 백업 폴더는 서버와 다른 곳(다른 디스크·업체의 객체 저장소)으로 옮겨 둔다.
- **개발용 PGlite**는 백업 명령이 하지 않는다 — 폴더를 통째로 복사한다.
- **법률 검토(D-012)**: 백업에는 봉인 전(방송 날짜부터 30일 안)의 채팅 원문·시청자 이름이 들어 있어, 서비스에서 지운 뒤에도 백업 보관 기간(최대 30일) 동안 더 남는다.

### 복구
1. **빈 데이터베이스**를 만든다.
2. `pg_restore --no-owner --dbname "$DATABASE_URL" livejjim-YYYYMMDD-HHmmss.dump` (DB와 같은 버전의 클라이언트로).
3. **마이그레이션**: `pnpm --filter @livejjim/server migrate` (백업 뒤 새 버전이 더한 변경을 적용).
4. 서버를 **시작**한다(같은 `LIVEJJIM_MASTER_KEY` — 다르면 토큰·전화번호 키를 풀 수 없다).
5. **재생 검사**: `pnpm --filter @livejjim/server check-replay` (컨테이너: `node apps/server/src/commands/check-replay.ts`) — 범위마다 기록과 상태가 같은지 본다(모두 같으면 종료 코드 0).

## 6-1. 방송 중 배포 (D-RETRO-30~34)

2026-11-12 방송 3시간 14분 동안 main에 푸시할 때마다 운영 서버가 다시 켜졌고(9번, 매번 9~10초 끊김), 화면 일꾼은 사람이 `git pull` 뒤 손으로 다시 켜서(3번) 서버보다 먼저 새 판이 됐으며, 같은 맥 미니에서 돈 APK 빌드 동안 상품 등록이 두 배 느려졌다([복기 8절](retro/2026-11-12-live-retro.md)). 그래서 내보내기(`.github/workflows/ship.yml`)는 **방송 중이면 판매자에게 닿는 일을 미룬다.**

### 문지기가 하는 일

내보내기는 서버 배포 전에 맥 미니에서 `scripts/deploy/live-gate.sh`를 돌린다. 화면 일꾼 관리자(`sw.serve`)가 30초마다 묻는 것과 같은 입구 `GET /internal/screen/live`를 같은 일꾼 토큰 파일로 묻는다. 끊지 않은 유튜브 연결이 있는 끝나지 않은 방송이 하나라도 있으면 "방송 중"이다.

| 무엇 | 방송 중 | 방송 없음 | 방송 여부를 확인하지 못함 |
|---|---|---|---|
| 빠른 시험(타입·앱 시험·내보내기 스크립트 시험) | 돈다 | 돈다 | 돈다 |
| 운영 서버 배포 | **미룬다**(실행은 성공으로 끝나고 요약에 "방송 중이라 서버 배포를 미뤘어요 … (커밋 …)") | 한다 | **한다** — 서버가 죽었을 때 고침을 막으면 살릴 길이 없다. 요약에 경고가 남는다 |
| 앱 화면 갱신(아이폰, 요청 시 안드로이드) | 서버 배포를 미뤘으면 같이 미룬다(화면이 서버보다 새 판이면 안 된다). 밀린 서버 변경이 없으면 한다 | 한다 | 한다 |
| TestFlight·APK 빌드 | **미룬다** | 한다 | 한다 |
| 화면 일꾼 갱신·다시 켜기 | **미룬다** | 서버 배포 다음에 한다 | **미룬다** — 다시 켜면 받아쓰기·번호표 이력을 잃는데 미뤄서 잃는 것은 없다 |

- 서버 배포 대상이 아닌 것: `apps/mobile/`·`docs/`·`*.md`·`.github/`·`packages/screen-worker/`·`scripts/deploy/`만 바뀐 푸시는 서버를 건드리지 않는다(`scripts/deploy/ship-changed.sh`). 11월 12일 11:12의 일꾼 파일만 바뀐 푸시(`5cddb683`)는 방송 중에 서버 배포 단계(백업·이미지 빌드, 25초)를 돌렸다. 이미지가 같아 컨테이너는 다시 켜지지 않았다(복기의 재시작 9번에 없다).
- 미룬 일은 맥 미니의 `~/.livegenie-ci/deferred/`에 표시 파일(`server`·`worker`·`native-ios`·`native-android`, 내용은 커밋과 미룬 시각)로 남는다.
- **따라잡기**(`.github/workflows/catchup.yml`, 10분마다): 표시가 있고 방송이 없는 상태가 10분 넘게 이어지면 내보내기를 main에서 다시 부른다. 그 실행이 서버 → 앱 화면 → 앱 빌드 → 화면 일꾼 순서로 밀린 것을 한다. 10분을 기다리는 까닭은 판매자가 방송을 끝냈다가 바로 다시 잇는 일이 있어서다. 같은 표시에는 세 번(30분 간격)까지만 부르고, 그래도 남으면 경고를 남긴다.

### 급할 때 넘기는 법

방송 중 급한 고침만, 사람이 명시해서 한다.

```
gh workflow run ship.yml --ref main -f force_server=yes     # 방송 중에도 운영 서버 배포 (9~10초 끊김, 실시간·음성 연결이 한 번 끊겼다 붙는다)
gh workflow run ship.yml --ref main -f force_native=yes     # 방송 중에도 TestFlight·(android=true면) APK 빌드 — 빌드 동안 화면 일꾼이 느려진다
```

화면 일꾼은 `force_server`로도 방송 중에 다시 켜지지 않는다. 꼭 바꿔야 하면 맥 미니에서 손으로(방송의 받아쓰기·번호표 이력이 처음부터 다시 시작된다):

```
cd ~/livegenie && git fetch origin main
LG_WORKER_FORCE=yes bash scripts/deploy/mini-worker-update.sh "$(git rev-parse origin/main)"
```

### 미뤄진 배포 확인법

```
gh run list -w 내보내기 -L 5                                  # 성공이어도 미뤘을 수 있다 — 실행 화면의 요약(Summary)을 본다
gh run view <실행 번호> --log | grep -E '미뤘어요|미룸'          # 요약과 같은 글이 기록에도 있다
gh run list -w 따라잡기 -L 5                                  # 따라잡기가 돌고 있는지 (10분마다)
```

맥 미니에서:

```
ls -l ~/.livegenie-ci/deferred/          # 지금 미뤄 둔 것 (없으면 다 나간 것)
cat ~/.livegenie-ci/deployed-sha         # 운영 서버에 마지막으로 배포한 커밋
cat ~/.livegenie-ci/worker-sha           # 화면 일꾼을 마지막으로 갱신한 커밋
bash ~/.livegenie-ci/bin/live-gate.sh          # live · idle · unknown (까닭이 같이 찍힌다)
bash ~/.livegenie-ci/bin/live-gate.sh commit   # 운영 서버가 스스로 알려 주는 판(커밋)
```

방송이 끝났는데 계속 `live`면 끝내지 않은 방송이 남은 것이다(앱에서 [라이브 연결 끊기], 옛 날짜 방송은 `POST /internal/screen/end-stale`).

### 서버가 받는 일꾼 요청 묻기

`GET /internal/screen/capabilities`(일꾼 토큰, 다른 일꾼 입구와 같은 인증)가 서버가 받는 일꾼 입구와 각 입구가 받는 항목, 지금 운영 판을 돌려준다. 일꾼은 켜질 때 이것을 보고 서버가 모르는 요청·항목을 보내지 않는다(복기 E11).

```json
{ "commit": "63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  "endpoints": {
    "register":     { "method": "POST", "path": "/internal/screen/register",  "fields": ["videoId","no","price","name","heard","conf","requestId","observedAt"] },
    "renumber":     { "method": "POST", "path": "/internal/screen/renumber",  "fields": ["videoId","from","to","requestId","drop","registerRequestId"] },
    "rename":       { "method": "POST", "path": "/internal/screen/rename",    "fields": ["videoId","no","name","requestId"] },
    "reprice":      { "method": "POST", "path": "/internal/screen/reprice",   "fields": ["videoId","no","price","requestId"] },
    "end-stale":    { "method": "POST", "path": "/internal/screen/end-stale", "fields": ["videoId"] },
    "live":         { "method": "GET",  "path": "/internal/screen/live",      "fields": [] },
    "capabilities": { "method": "GET",  "path": "/internal/screen/capabilities", "fields": [] } } }
```

- `commit`은 배포(`scripts/deploy/lg-apply.sh`)가 건강 확인까지 끝낸 뒤 `/opt/livegenie/app-updates/server-commit`에 적은 값이다. 모르면 `null`(내 컴퓨터·시험, 이 기능이 들어가기 전 배포).
- 입구가 없는 옛 서버는 404를 준다 — 일꾼은 그때 `register`만 있다고 본다.
- 입구·항목 목록은 서버의 요청 검사와 같은 표(`SCREEN_ENDPOINTS`, `apps/server/src/screen/routes.ts`)에서 나온다. 입구나 항목을 더할 때 그 표에 더한다.

### 화면 일꾼 갱신 순서

1. **서버가 먼저.** 내보내기의 일꾼 갱신 단계는 맨 뒤에 있고, 서버 배포가 끝났거나 서버 변경이 없을 때만 돈다. 서버 배포를 미뤘으면 일꾼 갱신도 미룬다.
2. `packages/screen-worker/`(시험·문서 제외)가 지난 갱신(`~/.livegenie-ci/worker-sha`) 뒤로 바뀌었을 때만 한다.
3. `scripts/deploy/mini-worker-update.sh <커밋>`이 문지기를 다시 묻고(방송 중·확인 못 함이면 미룸), 일꾼 폴더를 그 커밋으로 맞춘 뒤 launchd 서비스 `kr.livegenie.screen-worker`를 다시 켠다(SIGTERM으로 멈추고, launchd가 다시 띄우지 않으면 `kickstart`).
4. 일꾼 폴더는 launchd 설정의 `WorkingDirectory`에서 읽고, 방식은 두 가지다.

| 방식 | 언제 | 갱신 | 지시문(`sw/prompts`) |
|---|---|---|---|
| 작업 폴더 (지금) | `WorkingDirectory`가 저장소 안(`~/livegenie/packages/screen-worker`) | 그 저장소를 그 커밋으로 빨리 감기만. **손으로 고친 변경·main이 아닌 가지·내보내지 않은 커밋이 있으면 건드리지 않고 실패로 알린다** | 일꾼이 호출마다 읽으므로 누가 그 폴더에서 `git pull`만 해도 방송 중에 바뀐다(11월 12일에 코드와 어긋난 구간 두 번) |
| 판 폴더 (권장) | `WorkingDirectory`가 `~/lg/screen-worker/current` | 커밋의 `packages/screen-worker`를 `~/lg/screen-worker/releases/<커밋 12자>`에 풀고 `current` 링크를 바꾼다. 새 판의 관리자가 읽히지 않으면 링크를 바꾸지 않는다 | 판 폴더 안에 코드와 같이 있어 따로 바뀌지 않는다. 저장소에서 무엇을 해도 일꾼은 그대로다 |

판 폴더 방식의 모양:

```
~/lg/screen-worker/
  releases/<커밋 12자>/   그 커밋의 packages/screen-worker (RELEASE 파일에 커밋 40자, .venv → ../../venvs/<해시>)
  venvs/<해시>/           파이썬 묶음 — requirements.lock.txt·.python-version 내용마다 하나(바뀌면 uv로 새로 만든다)
  current → releases/<커밋 12자>
  previous                바로 앞 판(되돌릴 때)
```

관리자는 켜질 때의 판 폴더와 파이썬에 일꾼을 묶는다(`sw/serve.py`). 링크가 바뀌어도 관리자를 다시 켜기 전에는 옛 판으로만 일꾼이 뜬다. 지금 판은 일꾼 기록 첫 줄 `화면 일꾼 관리자 시작 — 판 <커밋 12자>`와 `일꾼 시작 (pid …, 판 …)`에 남는다.

되돌리기(방송이 없을 때):

```
ln -sfn "$(cat ~/lg/screen-worker/previous)" ~/lg/screen-worker/current
launchctl kickstart -k gui/$(id -u)/kr.livegenie.screen-worker
```

### 맥 미니에서 한 번 해 둘 것

launchd 설정(`~/Library/LaunchAgents/kr.livegenie.screen-worker.plist`)과 `~/.livegenie-ci/`는 저장소 밖이라 내보내기가 고치지 못한다. **방송이 없을 때** 한다.

1. 문지기가 쓸 토큰 파일 경로 — 일꾼 launchd 설정의 `--token-file`과 같은 경로를 적는다(값이 아니라 경로).
   ```
   /usr/libexec/PlistBuddy -c 'Print :ProgramArguments' ~/Library/LaunchAgents/kr.livegenie.screen-worker.plist   # --token-file 다음 줄이 경로
   mkdir -p ~/.livegenie-ci
   printf 'LG_SCREEN_TOKEN_FILE=%s\n' "$HOME/.lg_screen_token" > ~/.livegenie-ci/gate.env     # 위에서 본 경로로
   bash ~/.livegenie-ci/bin/live-gate.sh      # idle 또는 live 가 나와야 한다. unknown이면 까닭이 같이 찍힌다 (첫 내보내기 전이면 저장소의 scripts/deploy/live-gate.sh)
   ```
   이 파일이 없고 토큰이 `~/.lg_screen_token`에도 없으면 문지기는 늘 "확인 못 함"이라 **방송 중에도 서버를 배포한다**(실행마다 경고가 남는다).
2. launchd 설정에 `WorkingDirectory`가 있는지 본다. 없으면(명령 안에서 `cd` 하는 설정) `gate.env`에 일꾼 폴더를 적는다.
   ```
   plutil -extract WorkingDirectory raw -o - ~/Library/LaunchAgents/kr.livegenie.screen-worker.plist
   echo "LG_WORKER_DIR=$HOME/livegenie/packages/screen-worker" >> ~/.livegenie-ci/gate.env     # WorkingDirectory가 없을 때만
   ```
3. 깃허브 실행기가 일꾼 서비스를 볼 수 있는지 — 실행기와 같은 사용자로:
   ```
   launchctl print gui/$(id -u)/kr.livegenie.screen-worker | grep -E 'state|pid'
   ```
4. (권장) 판 폴더 방식으로 옮기기. 저장소가 추적하지 않는 파일에 일꾼이 기대고 있지 않은지 먼저 본다.
   ```
   cd ~/livegenie && git status --short --ignored packages/screen-worker        # .venv·runs·__pycache__ 말고 다른 것이 있으면 멈추고 확인
   git fetch origin main
   bash scripts/deploy/mini-worker-update.sh --stage "$(git rev-parse origin/main)"   # 판 폴더·파이썬 묶음·current 를 만든다(다시 켜지 않음, 처음엔 몇 분)
   (cd ~/lg/screen-worker/current && .venv/bin/python -m sw.doctor --server https://livegenie.kr --token-file ~/.lg_screen_token)   # 판 폴더에서 점검(서버에 등록하지 않는다)

   P=~/Library/LaunchAgents/kr.livegenie.screen-worker.plist
   cp "$P" "$P.bak-$(date +%Y%m%d)"
   /usr/libexec/PlistBuddy -c "Set :WorkingDirectory $HOME/lg/screen-worker/current" "$P"       # 항목이 없으면 Set 대신: Add :WorkingDirectory string …
   /usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $HOME/lg/screen-worker/current/.venv/bin/python" "$P"
   /usr/libexec/PlistBuddy -c 'Print' "$P"       # --out-root 가 절대 경로(~/lg/runs/live)인지, KeepAlive가 켜져 있는지도 본다
   launchctl bootout gui/$(id -u)/kr.livegenie.screen-worker
   launchctl bootstrap gui/$(id -u) "$P"
   launchctl print gui/$(id -u)/kr.livegenie.screen-worker | grep -E 'state|pid'
   ```
   일꾼 기록 첫 줄에 `판 <커밋 12자> (/Users/…/lg/screen-worker/releases/…)`가 보이면 된 것이다. 그 뒤로 `~/livegenie`는 일꾼과 상관없는 보통 작업 폴더다.
5. 따라잡기는 맥 미니에 따로 둘 것이 없다(깃허브 예약 실행이 같은 실행기에서 돈다). 첫 내보내기가 `~/.livegenie-ci/bin/`에 스크립트를 깐 뒤부터 일한다.

## 7. 마스터 키 보관

- `LIVEJJIM_MASTER_KEY`는 **백업과 다른 곳**(업체의 비밀값 저장소, 오프라인 사본)에 둔다. 백업과 같은 곳에 두면 백업이 새면 암호화한 구글 토큰·전화번호 키도 함께 풀린다.
- 바꾸지 않는다. 잃으면 모든 판매자가 유튜브를 다시 연결해야 하고, 문자찜 구매자가 이전 기록과 이어지지 않는다(판매 장부는 그대로 읽힌다).

## 8. 운영 모니터링

### 상태 경로
| 경로 | 무엇 | 쓰는 곳 |
|---|---|---|
| `/health` | 서버 프로세스가 살아 있는지(DB를 보지 않는다) — `{"status":"ok"}` | 컨테이너 헬스체크(이미지에 들어 있다), 업체의 재시작 판단 |
| `/health/ready` | DB가 2초 안에 답하는지 — 200 `{"status":"ready"}` / 503 `{"status":"not_ready"}` | 부하 분산기의 준비 확인, 외부 감시(예: 1분마다 이 주소를 불러 503이 3번 이어지면 알림) |
| `/ops/status` | 합친 숫자(운영 토큰 필요): 버전·시작 시각·DB 상태, 워커(수집기·발송함·봉인)마다 마지막 성공 시각·연속 실패 수, 수집 상태별 수, 오늘(KST) 발송함 상태·이유별 수와 남은 일, 최근 24시간 처리 실패 표시 수, 실시간 연결 수, 오늘 프로젝트 할당량 사용·한도·초과 여부, 로그인 제한으로 거절한 수 | 운영자가 직접 보거나 외부 감시 도구가 읽는다. 판매자 ID·이름·채널·채팅·토큰·IP는 없다 |

### 경보 기록
서버는 할 일이 있을 때 표준 오류 출력에 **JSON 한 줄** `{"level":"alert","code":"…","count":n,"seller":"…","date":"…"}`을 쓴다(정해진 코드·셈·서버가 만든 판매자 ID·범위 날짜·워커 이름만). 같은 코드(같은 판매자)는 10분에 한 번이고 그 사이 일어난 수는 다음 줄의 `count`에 담긴다. 업체의 로그 알림에서 `"level":"alert"`를 거르면 된다.

| 코드 | 뜻 | 판매자 화면에 보이는 것 | 운영자가 할 일 |
|---|---|---|---|
| `WORKER_FAILING` | 워커(`worker`: collector 수집기 · outbox 발송함 · sealer 봉인)가 연속 3번 실패 | 그 워커가 하던 일(채팅 받기·감사 메시지·봉인)이 늦거나 멈춘다 | `/health/ready`·`/ops/status`의 워커 칸과 DB 상태를 본다. DB가 정상인데 이어지면 서버를 다시 시작한다 |
| `ENGINE_FAILED` | 기록한 입력을 엔진이 처리하지 못해 실패 표시로 남겼다(상태는 그 전 그대로) | 콘솔 "확인 필요" 목록에 "처리하지 못했어요" | `check-replay`로 그 범위를 확인하고 개발자에게 알린다 |
| `OUTBOX_UNCONFIRMED` | 감사 메시지가 올라갔는지 확인하지 못했다(다시 게시하지 않음) | 알림 띠 "감사 실패"와 "이미 올라갔을 수 있어요" 경고 | 판매자가 유튜브를 보고 고른다. 자주 나오면 구글 응답 지연·할당량을 본다 |
| `OUTBOX_GAVE_UP` | 감사 메시지를 다섯 번 다시 보내도 실패 | 알림 띠 "감사 실패" | 구글 상태·할당량·네트워크를 본다. 판매자는 다시 보내기를 누를 수 있다 |
| `COLLECTOR_STOPPED` | 저절로 이어받지 않는 수집 멈춤(채팅 꺼짐·권한 없음·채팅 없음) | 콘솔 고정 영역에 "유튜브 채팅을 받지 못하고 있어요" 경고와 "채팅 다시 받기" | 판매자에게 유튜브 설정(채팅 켜기)을 안내한다 |
| `QUOTA_EXCEEDED` | 구글이 프로젝트 할당량 초과를 알렸다(오늘은 감사 메시지 멈춤) | "오늘 유튜브 사용량이 거의 다 되어 감사 메시지를 멈췄어요" | 구글 콘솔에서 할당량 증설을 신청하거나 `LIVEJJIM_YOUTUBE_QUOTA_LIMIT`·판매자 예산을 실제에 맞춘다 |
| `SEAL_FAILED` | 30일 지난 범위의 봉인이 실패(다음 시간에 다시 한다) | 봉인 예정 날짜가 지나도 봉인되지 않은 채로 보인다 | DB 상태를 보고, 이어지면 개발자에게 알린다 |
| `BACKUP_FAILED` | 운영 백업 명령 실패(아무것도 지우지 않음, `seller` 칸 없음) 또는 판매자 자동 백업 실패(`seller` 칸 = 판매자 ID — 다음 확인 때 다시 한다, 같은 판매자는 10분에 한 번) | 판매자 자동 백업이 26시간 넘게 없으면 백업 상태에 경고 | 백업 폴더(`LIVEJJIM_BACKUP_DIR`)가 있는지·디스크 공간·`pg_dump` 버전과 DB 연결을 확인하고 다시 돌린다. `seller` 칸이 있으면 그 판매자 백업 폴더(`LIVEJJIM_BACKUP_DIR/<판매자 ID>`)가 있는지·쓸 수 있는지를 본다 |
| `DB_UNAVAILABLE` | 준비 확인에서 DB가 2초 안에 답하지 않음 | 저장·조회가 실패한다 | 업체의 DB 상태·연결 수·네트워크를 본다 |
| `YT_CHAT_BLOCKED` | 서버의 유튜브 채팅 읽기가 막혔다(429·403·봇 확인·로그인 요구 화면 — 판매자 정보 없음) | 콘솔 고정 영역 "유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요." | `/ops/status`의 `youtubeWebChat`(막힘 수·분당 요청 수)을 본다. 우회하지 않는다 — 이어지면 끄기 스위치(`LIVEJJIM_YT_WEB_CHAT=off`)·맥 미니 일꾼 이전(사용자 확인)을 검토한다 |
| `YT_CHAT_FORMAT` | 유튜브 채팅 응답 모양을 알아볼 수 없다(지점·채팅 묶음 없음, 전체 채팅 지점 없음, 1분 동안 읽은 메시지 0개 + 모르는 종류) | 콘솔 고정 영역 "유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요." | 개발자에게 알린다 — 새 응답 녹화본(가린 것)으로 읽기 함수를 고친다. 로그 `YT_CHAT_UNKNOWN_ITEM`에 모르는 종류 이름이 있다 |
| `YT_CHAT_NETWORK` | 한 수집기에서 유튜브 채팅 읽기가 연결 오류(끊김·시간 초과·5xx)로 다섯 번 이어 실패 | 10초 넘게 이어지면 "유튜브 채팅을 받지 못하고 있어요" 경고 | 서버의 바깥 연결·DNS를 본다 |
| `TRANSCRIBE_NO_WORKER` | 받아쓰기 일꾼이 모두 끊겼거나 일꾼 없이 기기 연결이 들어옴(10분에 한 번, 판매자 정보 없음) | 받아쓰기 서버가 꺼져 있다는 안내 | 일꾼 프로세스·토큰 파일·네트워크를 확인한다. `/ops/status`의 `transcribe`에는 `workers`, `streams`, 최근 10분 처리 시간 `p95Ms`만 나온다 |

### 로그에 남기지 않는 것 (D-073)
요청 본문, 전화번호(원문·키), 문자찜 메모, 채팅 본문, 닉네임, 방송 제목, 가게 이름, 아이디·비밀번호, 세션 값, 구글 토큰·`code`·`state`, 간편 로그인 공급자의 토큰·`code`·`state`·공급자 계정 번호·이메일, 인스타그램 토큰·앱 시크릿·웹훅 확인 토큰·서명·username·IGSID, 마스터 키, IP, 오류 메시지(값이 들어 있을 수 있다), 택배 배송지(받는 분·연락처·주소·상세 주소·우편번호·배송 메모)·보내는 사람·택배사 고객 번호·택배사 원래 응답·송장번호·구매자 링크 토큰(T1), 밴드 토큰·Client Secret·`code`·돌아오는 주소의 표·토큰이 든 주소·user_key·밴드·글 키·손님 이름·댓글 본문(BND1). 로그에는 정해진 코드·범위 날짜·seq·오류 종류 이름·서버가 만든 판매자 ID·HTTP 상태·구글 오류 이유 코드만 남는다.
