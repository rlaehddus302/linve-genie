# RN1 수용 기준 — 서비스 이름 '라이브지니'로 화면·문서 바꾸기

- 스프린트: RN1 (6단계, 병렬 트랙 worktree `rn1` · 브랜치 `track/rn1-rename`) · spec ID: **UX-01** (SPEC 제목·UX-01 "서비스 이름" 문장) · 근거 결정: D-015(사용자 확정 2026-10-23), **D-RN1-01~D-RN1-07**
- 개발 영역: **web**, **server**, **device** · 테스트: **e2e**(`tests/e2e/rn1/**` + 기존 E2E의 기대 문장 교체) · 사용성 검토 없음
- **dev-core가 없다.** `packages/core`는 바꾸지 않는다. 판정·정산·파서 규칙이 바뀌지 않아 **골든을 더하지 않았고** 허용 목록(`tests/golden/known-unimplemented.yaml`)은 계속 비어 있다(`sprint: RN1`).
- 이 트랙의 E2E는 늘 **`E2E_PORT_OFFSET=27500`**으로 돈다.
- 공통 전제: 지금까지의 결과(`pnpm verify` 7단계)가 그대로 유지된다. 이름 글자 말고는 화면 배치·동작·문장(이름 외)·API가 바뀌지 않는다. 외부 계정·네트워크·실기기가 필요 없다.
- 정답의 우선순위: SPEC UX-01 "서비스 이름" 문장 → DECISIONS D-RN1-01~07 → 이 문서. 정해지지 않은 경우는 dev-notes·결과의 `disputesWithSpec`으로 올린다.

## 영역 배정

| 태그 | 담당 | 파일 |
|---|---|---|
| `[web]` | dev-web | `apps/web/**` (화면 문장·`index.html`·`public/manifest.webmanifest`·서비스 워커 머리 주석, 이름 상수 `SERVICE_NAME`, 웹 단위 시험) |
| `[server]` | dev-server | `apps/server/**` (응답·내려받기 이름·안내 문장, 이름 상수), `scripts/try/**`, 사용자 문서 `docs/DEPLOY.md`·`docs/TRY-IT.md`·`docs/OWNER-GUIDE.md`·`docs/SETUP-GUIDE.md` |
| `[device]` | dev-device | `packages/documents/**` (PDF 문서 정보·엑셀 만든 이, 이름 상수), 필요하면 `packages/voice`·`packages/label`·`packages/printer`의 보이는 문장(지금은 없음 — 주석만 있음) |
| `[e2e]` | test-e2e | `tests/e2e/rn1/**`, 기존 `tests/e2e/**`의 옛 이름 기대 문장 |

의존 순서: device·server·web은 서로 독립(같은 파일을 겹쳐 고치지 않는다) → e2e.

## "보이는 소스" 범위 (D-RN1-03 검사 대상)

`apps/web/src/**`, `apps/web/index.html`, `apps/web/public/**`, `apps/web/pwa/**`, `apps/server/src/**`, `packages/documents/src/**`, `scripts/try/**`, 그리고 문서 `docs/DEPLOY.md`·`docs/TRY-IT.md`·`docs/OWNER-GUIDE.md`·`docs/SETUP-GUIDE.md`.
여기서 "라이브찜" 글자는 **주석(`//`·`/* */`·`<!-- -->`·SQL `--`) 밖에 0개**여야 한다. 문서 4개는 주석이 없으므로 **전체에서 0개**다("이전 이름은 라이브찜" 같은 안내도 넣지 않는다 — 이전 이름 안내는 SPEC·PLANNING에만 있다).

## 수용 기준

| ID | 영역 | spec | Given / When / Then | 확인 |
|---|---|---|---|---|
| AC-RN1-01 | [web] | UX-01, D-RN1-01·03 | Given 로그인하지 않은 브라우저. When 앱 주소(`/`)를 연다. Then 문서 제목(`document.title`)이 정확히 "라이브지니"이고, 로그인 화면의 제목(`h1`)이 "라이브지니"다. 세션 확인 중 화면의 `h1`도 "라이브지니"다. 화면 어디에도 "라이브찜"·"(가칭)"·"LiveGenie"가 보이지 않는다 | E2E · 단위 |
| AC-RN1-02 | [web] | UX-01, UX-07, D-RN1-01·02 | When `/manifest.webmanifest`를 받는다. Then `name`·`short_name`이 모두 "라이브지니"이고, `start_url`·`scope`·`display`·`lang`·`theme_color`·`background_color`·`icons`는 RN1 전과 같다(S06 PWA 시험의 나머지 항목 그대로). 아이콘 파일 바이트는 바뀌지 않는다 | E2E(`tests/e2e/s06/pwa.spec.ts` 기대 이름 교체) · 단위 |
| AC-RN1-03 | [web] | UX-01, D-RN1-01 | Given 로그인하지 않았다. When `/privacy`·`/terms`를 연다. Then 위 줄 이름이 "라이브지니"이고 본문의 서비스 이름(첫 문단 "라이브지니(이하 "서비스")는 …" — 조사도 "는"으로, 유튜브 권한 끊기 안내 "라이브지니 설정 → 유튜브 → …", 이용약관 서비스 설명)이 "라이브지니"다. 페이지 글 전체에 "라이브찜"이 없다. "(초안)" 표시는 그대로다 | E2E |
| AC-RN1-04 | [web] [server] | UX-01, D-RN1-06 | 화면 문장의 이름만 바뀐다(나머지 글자 그대로): 간편 로그인 결과 `NOT_LINKED` "이 {공} 계정에 연결된 라이브지니 계정이 없어요. 아이디로 로그인한 뒤 설정 → 로그인 방법에서 {공} 계정을 연결해 주세요."·`LINKED_ELSEWHERE` "이 {공} 계정은 이미 다른 라이브지니 계정에 연결돼 있어요. 다른 {공} 계정으로 해 주세요.", 음성 고지 "음성은 인식을 위해 구글 음성 인식 서버로 보내져요. 라이브지니는 음성을 녹음하거나 저장하지 않아요.", 유튜브 연결 설명 "연결하면 라이브지니가 할 수 있는 일:", 유튜브 시청자 알림 버튼 "라이브지니에서도 차단", 서버 유튜브 차단 알림 "유튜브에서 차단된 시청자예요. 라이브지니에서도 막으려면 차단해 주세요.", 틱톡 위험 고지 두 줄 "…라이브지니는 누구나 볼 수 있는 내 라이브의 댓글을 비공식 방법으로 읽어요."·"라이브지니는 틱톡에 글을 올리지 않아요. 감사 메시지도 틱톡에는 보내지 않아요." (조사: 은/는·이/가를 새 이름 받침에 맞춤 — "라이브지니는"·"라이브지니가") | E2E(기존 l1·i4·i3·n2b2 기대 문장 전체 교체) · 단위 |
| AC-RN1-05 | [server] | UX-01, DAT-04, D-RN1-04 | Given 판매자가 로그인했다. When 설정에서 "전체 판매대장"·"전체 기록 내려받기"를 누른다. Then 내려받는 파일 이름이 `라이브지니-판매대장-전체-YYYY-MM-DD.xlsx`·`라이브지니-전체기록-YYYY-MM-DD.json.gz`이고, `Content-Disposition`의 한글을 못 받는 브라우저용 대체 이름이 `livegenie-ledger-all-YYYY-MM-DD.xlsx`·`livegenie-records-YYYY-MM-DD.json.gz`다. 파일 안 값(행·열·금액·구매자)은 RN1 전과 같다 | E2E(`tests/e2e/i2/ledger-settings.spec.ts` 기대 이름 교체) · 단위 |
| AC-RN1-06 | [server] | DAT-03, D-RN1-02·04 | Given RN1 전에 만든(형식 이름 `livejjim-seller-backup`) 백업 파일. When 복구한다. Then 지금처럼 복구된다. Given 형식 이름이 다른 파일. Then 안내가 "라이브지니 백업 파일이 아니에요(형식 이름이 달라요)."다. 새로 만드는 백업의 형식 이름은 여전히 `livejjim-seller-backup`이다 | 단위 |
| AC-RN1-07 | [server] | SYS-05, DAT-03, NFR-06, D-RN1-02 | 바꾸지 않는 값이 그대로다: 쿠키 이름 `lj_session`, 환경 변수 `LIVEJJIM_*` 이름, 암호화 문맥 문자열(`livejjim/seller-phone-key/v1/`·`livejjim/<용도>/v1/<판매자>`·`livejjim/login-limit-key/v1`·`livejjim/receipt-link-key/v1`·`livejjim/receipt-link/v1/…`·`livejjim/deposit-account/v1/`·`livejjim/popbill-corp-key/v1`·`livejjim/youtube-token/v1/…`·`livejjim/youtube-verifier/v1/…`·`livejjim/login-verifier/v1/…`), 운영 DB 백업 파일 이름 `livejjim-YYYYMMDD-HHmmss.dump`와 그 보관 정리 규칙, DB 표·칸·마이그레이션(새 마이그레이션 없음), 패키지 이름 `@livejjim/*`. RN1 전에 암호화해 둔 값(전화번호 키·토큰·계좌·영수증 링크)을 RN1 뒤 서버가 그대로 풀고, RN1 전 세션 쿠키로 로그인이 유지된다 | 단위(기존 서버 시험 그대로 통과 + 상수 값 고정 시험) |
| AC-RN1-08 | [device] | STL-04, STL-06, RCP-02, D-RN1-04 | When 확인서·영수증 PDF와 판매대장 엑셀을 만든다. Then PDF 문서 정보의 만든 프로그램(Creator)·생성기(Producer)가 "라이브지니", 엑셀 만든 이(creator)가 "라이브지니"다. 그 밖의 문서 내용(글·숫자·쪽 수·배치)은 RN1 전과 같다 — 기존 문서 골든(`tests/golden/documents/*.json`, G-DOC-*)과 영수증 JPG 시험이 그대로 통과한다 | 단위 |
| AC-RN1-09 | [web] [server] [device] | UX-01, D-RN1-03 | 각 런타임에 이름 상수가 하나씩 있다: `apps/web`·`apps/server`·`packages/documents`에 `SERVICE_NAME = '라이브지니'` 한 곳. 그 영역의 이름이 들어간 문장·파일 이름·문서 정보는 이 상수에서 만든다(같은 영역에 "라이브지니" 글자를 따로 쓴 문장 없음 — 고정 파일 제외). 고정 파일(`index.html` 제목, manifest `name`·`short_name`, `scripts/try/*` 안내)은 글자로 두고, 단위 시험이 그 값이 상수와 같은지 본다 | 단위(영역마다) |
| AC-RN1-10 | [web] [server] [device] | UX-01, D-RN1-03 | 영역마다 단위 시험 하나가 위 "보이는 소스" 범위 중 자기 영역 파일을 읽어 주석 밖의 "라이브찜" 글자 수가 0인지 본다(web: `apps/web/src`·`index.html`·`public`·`pwa` / server: `apps/server/src`·`scripts/try`·문서 4개 / device: `packages/documents/src`). 시험용으로 "라이브찜"이 든 문장을 넣으면 이 시험이 실패한다(검사가 실제로 잡는지 시험 안에서 확인) | 단위 |
| AC-RN1-11 | [server] | UX-01, D-RN1-07 | Given `pnpm try`(연습 모드). When 켠다. Then 터미널 안내가 "라이브지니 연습 모드를 준비하고 있어요. 처음에는 1~2분 걸려요..."·" 라이브지니 연습 모드가 켜졌어요. (끄려면 이 창에서 Control + C)"이고, 가짜 채팅 넣기 화면(`scripts/try/chat.html`)의 안내 두 곳이 "라이브지니 방송 화면…"이다. 연습 모드의 가짜 간편 로그인 공급자에서 연결되지 않은 계정을 고르면 AC-RN1-04의 `NOT_LINKED` 새 문장이 보인다 | 단위(try 시험) · 수동(TRY-IT 따라 하기) |
| AC-RN1-12 | [server] | SYS-05, D-RN1-07 | 사용자 문서 `docs/DEPLOY.md`·`docs/TRY-IT.md`·`docs/OWNER-GUIDE.md`·`docs/SETUP-GUIDE.md`의 서비스 이름이 "라이브지니"다(제목 포함). TRY-IT는 폴더가 처음 나오는 곳에 "라이브지니 폴더(폴더 이름 `livejjim`)"로 적고 그 뒤로 "라이브지니 폴더", 터미널 안내 인용은 AC-RN1-11 새 문장, 간편 로그인 안내 인용은 AC-RN1-04 새 문장이다. OWNER-GUIDE·SETUP-GUIDE의 구글·카카오 앱 이름 안내는 "라이브지니", 상표 확인 안내는 "라이브지니"(영어 "LiveGenie"도 함께 확인)다. 환경 변수·명령·파일 이름(`LIVEJJIM_*`, `livejjim-….dump`, `pnpm --filter @livejjim/server`)은 실제 값 그대로다 | 단위(AC-RN1-10 검사) · 수동 읽기 |
| AC-RN1-13 | [web] [server] | D-RN1-05 | 감사 메시지(채팅·영상 댓글·인스타 DM)·영수증 JPG·구매자 공유 링크 화면(`/r/…`)·라벨에 서비스 이름이 **새로 생기지 않는다** — RN1 전과 같은 글이다. 화면에 "이름이 바뀌었어요" 같은 알림 띠가 없다 | 단위(기존 시험 그대로 통과) · E2E(AC-RN1-14 확인 중) |
| AC-RN1-14 | [e2e] | UX-01, D-RN1-01·06 | 새 `tests/e2e/rn1/`: 시험용 판매자로 로그인해 주요 화면(로그인·홈·방송 콘솔·문자찜·구매자·정산·라벨·설정·입금 확인·요금·영수증 보내기·확인 필요·`/privacy`·`/terms`·구매자 공유 링크 화면)을 차례로 열고 각 화면 `body` 글 전체와 `document.title`에 "라이브찜"이 0번 나오는지 본다. 로그인 화면·세션 확인 화면·정책 페이지 위 줄에 "라이브지니"가 보인다. manifest 이름(AC-RN1-02)과 내려받기 이름(AC-RN1-05)을 확인한다. PC·휴대폰 크기 두 가지 | E2E |
| AC-RN1-15 | [e2e] | D-RN1-06 | 기존 E2E에서 옛 이름을 기대하던 곳(`s06/pwa.spec.ts`, `i2/ledger-settings.spec.ts`, `i3/youtube.spec.ts` AC-I3-27, `i4/voice-onoff.spec.ts`, `l1/support.ts`, `n2b2/support.ts`)은 **같은 정확도로** 새 이름 문장으로 바꾼다 — 문장 전체 일치·정규식 앵커를 유지하고 부분 일치로 느슨하게 하지 않는다. 시험 데이터의 판매자 가게 이름(`i1/probes.spec.ts`의 '라이브찜 꽃집')은 서비스 이름이 아니라 판매자 입력 값이므로 바꾸지 않아도 된다(바꿔도 됨) | E2E 검토 |

## 이번 스프린트에서 하지 않는 것 (범위 밖)

- 코드 식별자·패키지 이름(`@livejjim/*`)·저장소·폴더 이름·DB 표와 칸·쿠키(`lj_*`)·환경 변수(`LIVEJJIM_*`)·암호화 문맥 문자열·백업 형식 이름·운영 DB 백업 파일 이름·브라우저 저장소 키·서비스 워커 저장 규칙 바꾸기(D-RN1-02).
- 아이콘·색·로고 새로 만들기, 화면 배치 바꾸기.
- 저장된 기록·봉인 장부·이미 만든 백업·문서 다시 쓰기(D-RN1-04).
- 감사 메시지·영수증·공유 링크·라벨에 서비스 이름 넣기, 이름 변경 알림 띠(D-RN1-05).
- 코드·SQL·Dockerfile 주석, `docs/FINAL-REPORT.md`, `docs/PLANNING.md`, `CLAUDE.md`·`.claude/**`·`harness/**`, 지난 SPEC·DECISIONS·수용 기준의 인용 문장 고치기(D-RN1-06·07).
- 영어 화면(`LiveGenie` 표기)·도메인·이메일/문자 문구(지금 서비스가 보내는 이메일·문자가 없다).
- 외부 콘솔의 앱 이름 변경(구글 OAuth 동의 화면·카카오·네이버·메타), 상표 확인·출원 — 사용자 몫(DECISIONS "사용자 확인 필요" — 서비스 이름 라이브지니 행, 막지 않음).
- 판정·정산·파서 규칙 변경, 골든 추가.
