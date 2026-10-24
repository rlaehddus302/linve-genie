# LND1 test-notes (test-e2e)

## 새 시험 (`tests/e2e/lnd1/`)

| 파일 | 수용 기준 | 묶음 |
|---|---|---|
| `landing.spec.ts` | AC-LND1-01·02·03·08·09·10(지금 값)·11(자바스크립트가 돈 뒤)·13 | chromium |
| `skip.spec.ts` | AC-LND1-04(`/packing?date=` 새 시험 + `/settings`·`/sms`)·05(@social)·06(PC·휴대폰 로그아웃, 서버에서 세션 끝남, 새로고침)·07(크로미움 matchMedia, @webkit `navigator.standalone`) · TE-LND1-001 | chromium·chromium-social·webkit-iphone |
| `layout.spec.ts` | AC-LND1-12 (375·412 × 100·150%, 375 첫 화면, 1440 × 100·150% 글 폭 ≤ 900, @webkit 393 × 100·150%) | chromium·webkit-iphone |
| `served.spec.ts` | AC-LND1-11(문서만 읽기·자바스크립트 끈 브라우저)·15(머리글이 `/privacy`와 같음) + 소개·`/login` CSP 위반 0 | chromium-served |
| `pwa.spec.ts` | AC-LND1-14(서비스 워커 설치 뒤 오프라인 `/login`) · TE-LND1-001(오프라인 `/` → 연결되면 소개) | chromium |

AC-LND1-14의 `manifest.webmanifest`·`pwa/service-worker.ts` 차이: `git diff BASE -- <두 파일>` 빔(확인함).

## 찾은 것

- **TE-LND1-001** (web, `apps/web/src/App.tsx`): 로그아웃 상태 `/`를 열 때 첫 로그인 확인(`/api/me`)이 인터넷 끊김·서버 오류로 실패하고, 다시 확인(연결 회복 / "다시 시도")에서 401이 오면 소개 화면이 아니라 **로그인 화면**이 나온다. 첫 확인이 끝나면(성공·실패 상관없이) `ready = true`가 되어, 다시 확인의 `/api/me` 401도 `onUnauthorized` → `setLeftInTab(true)`(로그인이 풀린 것으로 여김)로 간다. D-LND1-02는 "이 탭에서 로그아웃했거나 로그인이 풀린 뒤"만 건너뛴다. 실패 시험 3개: `pwa.spec.ts` TE-LND1-001, `skip.spec.ts` "TE-LND1-001 …" 두 개(끊김·503).

## AC-LND1-89 기존 E2E 맞추기 (바꾼 줄마다 `// LND1 D-LND1-0x`)

- 도우미: `s05/support.ts` `login()` → `goto('/login')`, `i3/support.ts` `loginAs()` 기본 `path = '/login'` (다른 주소를 주는 부름은 그대로).
- 로그아웃 상태 `goto('/')` 뒤 로그인 칸·간편 로그인 버튼을 쓰던 줄 → `goto('/login')`:
  - `l1/flows.spec.ts` 8줄, `l1/screens.spec.ts` 7줄, `l1/stacks.spec.ts` 2줄, `l1/attacks.spec.ts` 10줄
  - `n3/reasons.spec.ts`(하와이 시간대 문맥 로그인), `n4b/screens.spec.ts`(보조자 로그인), `rn1/rename.spec.ts`(로그인 화면 이름 검사)
  - `s05/basic.spec.ts` AC-S05-01, `s06/fixes.spec.ts` AC-S06-66(첫 화면 커서 — 주소만 `/login`)
- 로그인 화면에 머무는 주소 단언 `toHaveURL(/\/$/)` → `/\/login$/`: `l1/screens.spec.ts` "시작 요청이 실패하면…" 1줄 (시작한 주소가 `/login`이라서).
- 간편 로그인 결과(`/?login=…`) 뒤 **새로고침**하면 아이디 커서를 기대하던 줄(`l1/flows.spec.ts` 시험 4, `l1/screens.spec.ts` AC-L1-21 표 6개): D-LND1-02가 "새로고침은 소개 화면"이라 정했으므로 새로고침 뒤 소개 화면 + 문장 없음을 보고, 이어서 `/login`을 열어 아이디 커서·문장 없음을 본다(원래 단언 "문장이 다시 나오지 않음·아이디 커서"를 둘 다 유지). — 스펙 확인 필요 지적으로도 올림(AC-LND1-05 "기존 l1 그대로 통과"와 겹침).
- 정책 페이지 "로그인 화면으로" 뒤 `/` 기대: 기존 E2E에 그런 줄이 없었다(새 시험 AC-LND1-08이 `/login`을 본다).
- 그대로 둔 것(로그인한 상태의 `goto('/')`, 주소만 얻는 `goto('/')`, 같은 탭 로그아웃 뒤 로그인 칸): `mob1/*`, `o2/*`, `n5/*`, `wiz/*`, `s06/pwa.spec.ts`, `n4b/attacks.spec.ts`, `i3/served.spec.ts`, `menu.ts` `logoutFully` 등.

## 맥북 쪽에 알릴 것

- 이 worktree에는 `tests/e2e/y1/**`가 없다. y1 시험이 로그아웃 상태 `goto('/')` 뒤 로그인 칸을 채우면 `/login`으로 바꿔야 한다(공용 도우미 `login()`·`loginAs()`를 쓰는 줄은 저절로 맞음).

## 돌린 것

- `CI=1 E2E_PORT_OFFSET=1700 pnpm exec playwright test --config apps/web/playwright.config.ts tests/e2e/lnd1` 과 바꾼 기존 파일들(`l1/**`, `s05/basic`, `s06/fixes`, `n3/reasons`, `n4b/screens`, `rn1/rename`, `i3/accounts`). 전체 E2E·`pnpm verify`는 돌리지 않았다(오케스트레이터 몫).
- 도우미가 바뀐 영향 확인으로 `wiz/**`, `mob1/bar-logout`, `s05/attacks`, `s06/pwa`도 돌렸다. 하나만 실패했다. `s06/pwa` AC-S06-51 "새 버전…"은 `/sms`에서 시험 계정에 고를 방송이 없어 "메모" 칸이 잠겨 멈췄다("문자찜을 넣을 방송을 골라 주세요."). 앞 시험이 만든 방송이 있어야 통과하는 실행 순서 의존이고, 로그인 주소와는 상관없다(LND1 이전부터 있던 것).

## 2회차 (사용성 1회차 반영 D-LND1-10 · 감사 지적)

- **SA-LND1-01 고침**: `l1/flows.spec.ts` 시험 4·`l1/screens.spec.ts` AC-L1-21 표의 새로고침 뒤 "소개 화면" 확인을 h1만 보던 줄에서 `expectLanding()`으로 바꿈(`// LND1 SA-LND1-01`). `lnd1/support.ts` `expectLanding()`은 로그인 화면과 겹치는 h1 말고 소개 화면에만 있는 절 "판매자의 하루"·한 줄 소개·링크 "시작하기"와 아이디·비밀번호 칸 0개를 본다(단언이 늘어남).
- **새 시험 `lnd1/round1.spec.ts`** (375×812 크로미움 100·150%, 393×852 WebKit @webkit 100·150%, 1440×900):
  - AC-LND1-16: "시작하기" → "로그인하러 가기"가 "시작하려면" 절 안·문장 아래·뷰포트 안, `href=/login`, 44px 이상, "로그인"(exact) 링크 하나, 가로 넘침 0 → 누르면 `/login`·아이디 커서
  - AC-LND1-17: `/login` 계정 안내·"처음 화면으로"(로그인 버튼 아래·정책 링크 위, 44px) → `/` 소개 화면. `/settings`·`/sms`·`/packing`·같은 탭 로그아웃 뒤 `/`의 로그인 화면엔 없음. 틀린 비밀번호 → alert 글 그대로, 바로 아래(alert 밖, 사이에 다른 글 없음) 안내 → 맞게 다시 → 사라짐(`/login`·`/settings` 둘 다, WebKit 포함). 잠김(LOGIN_LOCKED)·연결 끊김엔 안내 없음
  - AC-LND1-18: `lang="en"` 문단 바로 앞 형제 글 "(영문 안내 — 구글 심사용)", 제목 아님, `lang="en"` 밖, 16px 이상, 영문 글 그대로
- **기존 시험 맞춤**: `l1/screens.spec.ts` AC-L1-20 Tab 순서(`/login`)에 정책 링크 앞 "처음 화면으로"를 더함(`// LND1 D-LND1-10` — 한 칸 늘어남, 약화 아님).
- **TE-LND1-001**: 고쳐짐 확인(`lnd1/pwa.spec.ts`·`skip.spec.ts` 셋 통과) → resolved.
- **s06/pwa.spec.ts:78 (AC-S06-51) — LND1과 무관한 실행 순서 의존**: 그 파일만 돌리면 실패, 여러 폴더를 함께 돌리면 통과. 기본 계정 e2e-shop에 방송이 없을 때 `/sms`는 "메모" 칸을 막는데(방송을 고르라는 안내), 시험은 방송을 만들지 않고 바로 메모를 친다. 앞 시험이 그 계정으로 방송을 만들어 두었을 때만 통과한다. 로그인 주소(`/login`)와 상관없다.
- **실행 환경**: 지정 오프셋 1900은 화면 서버 3100+1900=5000이 macOS 제어 센터(AirPlay 수신, 5000·7000)와 겹쳐 서버가 뜨지 않음 → 1950으로 돌림.

### 돌린 것
- `CI=1 E2E_PORT_OFFSET=1950 … tests/e2e/lnd1 tests/e2e/l1 tests/e2e/s06`(s06b도 함께 잡힘): 231 통과, 3 실패 → 실패 셋(내 시험 기대 2개: 새 판매자는 로그인 뒤 처음 안내 `/start`로 감, AC-L1-20 Tab 순서) 고친 뒤 `lnd1/round1`·`l1/screens`·`l1/flows` 69 통과. `s06/pwa.spec.ts` 단독: 3 통과·`:78` 실패(위 원인).
