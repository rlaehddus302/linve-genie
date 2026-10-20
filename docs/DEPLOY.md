# 라이브찜 배포·운영 안내

라이브찜을 인터넷에 올려 판매자가 쓰게 하는 운영자용 문서다(SYS-05, D-I3-13·14·16). 호스팅 업체·도메인·TLS 인증서 고르기는 사용자 몫이다(D-001). 이 문서의 명령은 두 가지로 적는다.

- 저장소에서: `pnpm --filter @livejjim/server <명령>`
- 컨테이너 안에서: `node apps/server/src/commands/<명령>.ts` (이미지에는 pnpm이 없다. 서버 시작만 `node apps/server/src/main.ts`)

## 1. 필요한 것

| 무엇 | 왜 | 비고 |
|---|---|---|
| PostgreSQL 데이터베이스 | 판매 기록·계정·유튜브 연결을 둔다 | 업체가 관리하는 PostgreSQL이면 편하다. 백업용 `pg_dump`는 DB와 같거나 높은 메이저 버전이어야 한다(아래 6절) |
| https 도메인 | 화면과 API를 같은 주소로 낸다. 로그인 쿠키는 https에서만 실린다 | 서버는 앱 주소가 https가 아니면 시작하지 않는다(내 컴퓨터 시험은 `http://localhost`만) |
| 컨테이너를 돌릴 곳 | 저장소 루트 `Dockerfile`로 만든 이미지 하나 | 업체에 매이지 않는다. 포트 3000, 헬스체크 `/health` |
| 구글 클라우드 프로젝트 (선택) | 유튜브 연동(채팅 받기·감사 메시지) | 없으면 유튜브 기능만 꺼진다. 4절 |

## 2. 환경변수

`.env.example`에 키 목록이 있다(값은 비어 있다). 운영에서는 업체의 비밀값 설정에 넣는다. **비밀값을 이미지·저장소·로그에 넣지 않는다.**

| 이름 | 필수 | 예 | 만드는 법·뜻 | 잃거나 틀리면 |
|---|---|---|---|---|
| `PORT` | 선택 | `3000` | 서버가 기다릴 포트(비우면 3000) | 다른 프로그램이 쓰는 포트면 시작하지 않는다 |
| `DATABASE_URL` | 필수 | `postgres://user:pass@db.example:5432/livejjim?sslmode=require` | 업체가 준 PostgreSQL 연결 문자열 | 없으면 시작하지 않는다(메모리 DB로 바꾸지 않는다) |
| `LIVEJJIM_PGLITE_DIR` | 개발만 | `./.data/pglite` | 내 컴퓨터용 파일 데이터베이스. `DATABASE_URL`과 함께 쓰지 않는다 | 운영에서는 쓰지 않는다 |
| `LIVEJJIM_MASTER_KEY` | 필수 | (32바이트 base64) | `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` — 판매자 전화번호 키·구글 토큰을 암호화한다 | **잃으면 구글 토큰을 풀 수 없어 모든 판매자가 유튜브를 다시 연결해야 하고, 이후 문자찜이 이전 문자 구매자와 이어지지 않는다.** 백업과 다른 곳에 따로 보관한다(7절) |
| `LIVEJJIM_APP_ORIGIN` | 필수 | `https://app.example.com` | 화면 앱 주소(경로 없이). 상태를 바꾸는 요청의 Origin이 이 값과 같아야 한다 | https가 아니면 시작하지 않는다. 실제 주소와 다르면 모든 저장이 403 |
| `LIVEJJIM_WEB_DIR` | 선택 | `/app/apps/web/dist` | 화면 빌드 폴더. 적으면 서버가 화면을 같은 출처로 함께 낸다(이미지는 정해 둠) | 그 폴더에 `index.html`이 없으면 시작하지 않는다 |
| `LIVEJJIM_OPS_TOKEN` | 선택 | (32자 이상) | `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` — 운영 상태 `/ops/status`를 연다 | 비우면 `/ops/status`는 없다(404). 32자 미만이면 시작하지 않는다. 새면 바꾼다(합친 숫자만 보여 판매 정보는 새지 않는다) |
| `LIVEJJIM_TRUSTED_PROXIES` | 선택 | `1` | 서버 앞의 믿는 프록시 수(0~5, 기본 0). 5절 | 틀리게 적으면 로그인 IP 한도가 엉뚱한 주소를 센다. 0~5가 아니면 시작하지 않는다 |
| `LIVEJJIM_GOOGLE_CLIENT_ID` | 선택 | `1234-abc.apps.googleusercontent.com` | 구글 OAuth 클라이언트 ID(4절). 비우면 유튜브 연동을 하지 않는다 | 유튜브 기능이 꺼진다(화면에 "유튜브 연동을 준비하지 않은 서버예요.") |
| `LIVEJJIM_GOOGLE_CLIENT_SECRET` | 유튜브면 필수 | (구글이 준 값) | 구글 OAuth 클라이언트 비밀 | 새면 구글 콘솔에서 새로 만든다 |
| `LIVEJJIM_GOOGLE_REDIRECT_URI` | 유튜브면 필수 | `https://app.example.com/api/youtube/oauth/callback` | 구글에 등록한 돌아오는 주소 하나(https만) | 구글에 등록한 값과 다르면 연결이 실패한다 |
| `LIVEJJIM_YOUTUBE_RETURN_URL` | 선택 | `https://app.example.com/settings/youtube` | 연결을 마친 뒤 판매자를 보낼 화면(비우면 `<앱 주소>/settings/youtube`) | |
| `LIVEJJIM_YOUTUBE_QUOTA_LIMIT` | 선택 | `10000` | 구글 프로젝트의 하루 할당량(기본 10,000) | 실제보다 크게 적으면 구글이 먼저 막는다(경보 `QUOTA_EXCEEDED`) |
| `LIVEJJIM_YOUTUBE_SELLER_BUDGET` | 선택 | `5000` | 판매자 한 명의 하루 예산(기본 = 한도) | |
| `LIVEJJIM_GOOGLE_AUTH_URL` | 선택 | (비움) | 구글 승인 주소 — 보통 비워 둔다(https만) | |
| `LIVEJJIM_GOOGLE_TOKEN_URL` | 선택 | (비움) | 구글 토큰 주소 — 보통 비워 둔다 | |
| `LIVEJJIM_GOOGLE_REVOKE_URL` | 선택 | (비움) | 구글 토큰 폐기 주소 — 보통 비워 둔다 | |
| `LIVEJJIM_YOUTUBE_API_URL` | 선택 | (비움) | 유튜브 Data API 주소 — 보통 비워 둔다 | |
| `LIVEJJIM_TIKTOK_BETA` | 선택 | `on` | 틱톡 라이브 베타(읽기 전용, D-904) 운영자 전체 스위치. `on`일 때만 켜고, 비우거나 `off`면 끔 | 상용 출시 전 법률 검토 뒤에 켠다. `on`·`off`·빈 값이 아니면 끔으로 보고 경고 `TIKTOK_BETA_INVALID`를 남긴다 |
| `LIVEJJIM_TIKTOK_SIGN_API_KEY` | 선택 | (비움) | 틱톡 서명 서비스 키 — 보통 비워 둔다. 값은 로그·화면에 나오지 않는다 | 연결 라이브러리가 따로 읽는 `SIGN_API_URL`·`SIGN_API_KEY`는 운영 환경에 두지 않는다(서명 키가 다른 주소로 갈 수 있다) |
| `LIVEJJIM_BACKUP_DIR` | 백업이면 필수 | `/backups` | 백업 명령이 덤프를 둘 폴더(미리 만들어 둔다) | 없으면 백업이 실패한다(경보 `BACKUP_FAILED`) |
| `LIVEJJIM_PG_DUMP` | 선택 | `/usr/lib/postgresql/17/bin/pg_dump` | 백업에 쓸 `pg_dump` 경로(기본 `pg_dump`) | DB보다 낮은 버전이면 백업이 실패한다 |

## 3. 처음 배포

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

## 5. 운영 토큰·앞단 프록시

- **운영 토큰** `LIVEJJIM_OPS_TOKEN`(32자 이상)이 있으면 `/ops/status`가 열린다: `curl -H "Authorization: Bearer <토큰>" https://app.example.com/ops/status`. 토큰이 다르거나 없으면 401(힌트 없음), 설정이 없으면 404.
- **앞단 프록시**: 업체의 부하 분산기·CDN이 서버 앞에 있으면 그 수를 `LIVEJJIM_TRUSTED_PROXIES`에 적는다(보통 1). 로그인 IP 한도(같은 IP 10분에 20번)는 그때 `X-Forwarded-For`의 오른쪽에서 그 번째 주소를 본다. 프록시가 없는데 1 이상으로 적으면 공격자가 머리글을 바꿔 한도를 피할 수 있다 — 프록시 수와 꼭 같게 적는다. 0이면 TCP 연결 주소를 센다.
- 로그인 비밀번호 확인은 서버마다 동시에 4개까지다(넘치면 "지금 로그인 요청이 많아요." — 이미 로그인한 판매자는 상관없다).

## 6. 새 버전·백업·복구

### 새 버전
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
| `BACKUP_FAILED` | 백업 명령이 실패(아무것도 지우지 않음) | 없음 | 백업 폴더(`LIVEJJIM_BACKUP_DIR`)가 있는지·디스크 공간·`pg_dump` 버전과 DB 연결을 확인하고 다시 돌린다 |
| `DB_UNAVAILABLE` | 준비 확인에서 DB가 2초 안에 답하지 않음 | 저장·조회가 실패한다 | 업체의 DB 상태·연결 수·네트워크를 본다 |

### 로그에 남기지 않는 것 (D-073)
요청 본문, 전화번호(원문·키), 문자찜 메모, 채팅 본문, 닉네임, 방송 제목, 가게 이름, 아이디·비밀번호, 세션 값, 구글 토큰·`code`·`state`, 마스터 키, IP, 오류 메시지(값이 들어 있을 수 있다). 로그에는 정해진 코드·범위 날짜·seq·오류 종류 이름·서버가 만든 판매자 ID·HTTP 상태·구글 오류 이유 코드만 남는다.
