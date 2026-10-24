# LND1 dev-notes

## dev-web — 바뀐 공개 모양 (시작 전에 적음)

- 새 경로: `{ name: 'login' }` ↔ `/login` (`apps/web/src/lib/router.ts`). `menuOf` → null, `isPublicRoute`에 들어감(정책 페이지처럼 위 줄 메뉴 없음).
- 소개를 보일지: `shouldShowLanding(input)` (`apps/web/src/lib/landing.ts`) — 입력 `{ signedOut, route, loginParam, leftInTab, standalone }`, 모두 맞을 때만 참.
- 문장 상수: `apps/web/src/lib/landing.ts` — `LANDING_TAGLINE`, `LANDING_DAY_STEPS`(5), `LANDING_START_TEXT`, `LANDING_GOOGLE_ITEMS`(5), `LANDING_LIMITED_USE_*`, `LANDING_ENGLISH`, `USER_DATA_POLICY_URL`, 절 제목 `LANDING_HEADINGS`.
- 운영 사업자 상수: `apps/web/src/operator.ts` — `export const OPERATOR: Operator = { name: '틈(TEUM)', representative: '', businessNumber: '', mailOrderNumber: '', address: '', email: '' }`. 줄 만들기는 `operatorLines(operator)`(landing.ts) — 빈 글인 항목은 줄이 없다. 값이 정해지면 이 파일 한 줄만 고친다(D-LND1-04, 사용자 몫).
- 화면: `apps/web/src/components/LandingPage.tsx` (`LandingPage({ operator?, onLogin })`).
- `index.html`: `<meta name="description">` + `#root` 안 정적 글(제목·한 줄 소개·`/privacy`·`/terms` 링크). 인라인 스크립트·style 없음.

## dev-web — 한 일 (커밋 `[dev:web] LND1: …` 둘)

- `App.tsx`: 로그아웃 상태에서 `route.name === 'home'`이고 `shouldShowLanding`이 참이면 `LandingPage`, 아니면 지금 `LoginPage`(그 자리). `/login`(로그아웃)은 `LoginPage`, 성공하면 `replace`로 `/`(보조자는 `/sms`). 로그인한 채 `/login` → 효과가 `replace`로 `/`(보조자 `/sms`).
  - 건너뛰기 (D-LND1-02): (a) 처음 연 주소에 `login` 값(모르는 값이어도) — 앱을 그린 때 한 번 읽음, (b) 이 탭에서 로그아웃 성공·로그아웃 401·쓰는 중 401 뒤(`leftInTab`, 새로고침하면 풀림), (c) `isStandalone()`(기존 `pwa/pwa.ts` — `navigator.standalone === true` 또는 `matchMedia('(display-mode: standalone)')`) — 앱을 그린 때 한 번.
  - 정책 페이지 위 줄: 로그아웃이면 "로그인 화면으로" → `/login`(href도 `/login`), 확인 중이면 "처음 화면으로" → `/` 그대로.
- 소개 화면 구조(E2E 잡을 곳): `main.page.landing` 안
  - `h1` "라이브지니" 하나, `p` 한 줄 소개, 링크 `role=link` "로그인"(`href="/login"`, 앱 안 이동 — 기록을 쌓음 → 뒤로 가기 = 소개), "시작하기"(`href="#landing-start"`, 누르면 `preventDefault` + "시작하려면" 제목 `scrollIntoView({block:'start'})`·포커스 — 주소·해시·기록 안 바뀜).
  - 절마다 `section`(`aria-labelledby` → `getByRole('region', { name: '판매자의 하루' })` 등 넷: "판매자의 하루"(`ol` 5) · "시작하려면" · "구글 사용자 데이터를 쓰는 곳"(`ul` 5 + 제한적 사용 `p` + `p[lang="en"]`) · "운영 사업자"(`ul.landing-operator`, 지금 `li` 하나 "상호: 틈(TEUM)")). 정책 링크 `nav[aria-label="약관"]`은 구글 절과 운영 사업자 절 사이.
  - 데이터 정책 링크: 새 창 아님(`target` 없음), `rel="noopener noreferrer"`. 링크·버튼 모두 `min-height: 2.75rem`.
  - 서버 요청 없음(`/api/me`는 App). 로그인 화면이 아니므로 `/api/client-config`도 부르지 않는다.
- `index.html`: `<meta name="description" content="<한 줄 소개>">`, `#root` 안 `main.page > h1 "라이브지니" + p 한 줄 소개 + nav.row.policy-links[aria-label="약관"] > a[href="/privacy"] "개인정보처리방침" + a[href="/terms"] "이용약관"`. React `createRoot`가 첫 그리기 때 지운다. 인라인 script·style 없음.
- 직접 본 것(스크래치 빌드 + 크로미움, 가짜 `/api/me` 401): 375×812·412×915·1440×900, 글자 100%·150%에서 `/`·`/login` 가로 넘침 0, 보이는 링크·버튼 높이 44px 미만 0, 375×812 100%에서 "로그인"·"시작하기" 첫 화면 안. 글 요소 폭 최대 1440 100%에서 608px(150%에서도 900px 안).
- 단위 시험: `apps/web/test/lnd1-landing.test.tsx`(AC-LND1-90·10 + 앱 흐름), `build.node.test.ts`에 AC-LND1-11. 기존 단위 시험 맞추기(`// LND1 D-LND1-0x`): `App.test.tsx`(loggedOut 도우미가 `/login`), `l1-social-login.test.tsx`(openLogin 기본 `/login`, 새로고침 재열기 `/login`), `wizard-app.test.tsx`(보조자 로그인 `/login`), `main.test.tsx`(`/login`), `index-html.test.ts`(주소 목록에 `/privacy`·`/terms`), `build.node.test.ts`(정책 링크는 파일이 아님). 웹 단위 95 파일 1550 통과(루트에서 `pnpm exec vitest run --project web`).
- 바꾸지 않은 것: `public/manifest.webmanifest`, `pwa/service-worker.ts`, `apps/server/**`, `packages/**`, 유튜브 파일.

## 다음 영역(test-e2e)에게

1. 로그아웃 상태 `goto('/')` 뒤 로그인 칸을 채우는 기존 E2E는 이제 소개 화면이라 실패한다 → AC-LND1-89대로 `goto('/login')`(도우미 `s05/support.ts login()`, `i3/support.ts loginAs()` 기본 경로). `goto('/settings')` 등 다른 주소 뒤 로그인은 그대로 된다.
2. 로그아웃(위 줄·더보기) 뒤에는 **같은 탭이면** 지금처럼 그 자리 로그인 화면이다. 다만 `page.reload()`·새 `page.goto('/')` 뒤에는 소개 화면이니 로그인 칸이 필요하면 `/login`.
3. 정책 페이지 "로그인 화면으로" 뒤 주소 기대 `/` → `/login`(D-LND1-08).
4. 홈 화면 앱 흉내는 `addInitScript`로 `window.matchMedia`를 `(display-mode: standalone)`에 참으로, WebKit은 `Object.defineProperty(navigator, 'standalone', { value: true })` — 앱이 처음 그릴 때 한 번 읽는다(그 전에 넣어야 함).
5. `/?login=…`은 처음 연 주소에서만 본다 — 같은 탭에서 앱 안 이동으로 붙인 값은 보지 않는다(서버 돌아오기는 늘 새 문서라 상관없음).
6. "시작하기"는 해시를 남기지 않는다(`location.hash === ''`), 제목 "시작하려면"에 포커스.
7. `tests/e2e/y1/**`는 고치지 않는다 — y1이 `goto('/')` 뒤 로그인 칸을 쓰면 test-notes "맥북 쪽에 알릴 것"에(공용 도우미를 쓰는 줄은 도우미 수정으로 맞음).
