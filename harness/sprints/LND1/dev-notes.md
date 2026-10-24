# LND1 dev-notes

## dev-web — 바뀐 공개 모양 (시작 전에 적음)

- 새 경로: `{ name: 'login' }` ↔ `/login` (`apps/web/src/lib/router.ts`). `menuOf` → null, `isPublicRoute`에 들어감(정책 페이지처럼 위 줄 메뉴 없음).
- 소개를 보일지: `shouldShowLanding(input)` (`apps/web/src/lib/landing.ts`) — 입력 `{ signedOut, route, loginParam, leftInTab, standalone }`, 모두 맞을 때만 참.
- 문장 상수: `apps/web/src/lib/landing.ts` — `LANDING_TAGLINE`, `LANDING_DAY_STEPS`(5), `LANDING_START_TEXT`, `LANDING_GOOGLE_ITEMS`(5), `LANDING_LIMITED_USE_*`, `LANDING_ENGLISH`, `USER_DATA_POLICY_URL`, 절 제목 `LANDING_HEADINGS`.
- 운영 사업자 상수: `apps/web/src/operator.ts` — `export const OPERATOR: Operator = { name: '틈(TEUM)', representative: '', businessNumber: '', mailOrderNumber: '', address: '', email: '' }`. 줄 만들기는 `operatorLines(operator)`(landing.ts) — 빈 글인 항목은 줄이 없다. 값이 정해지면 이 파일 한 줄만 고친다(D-LND1-04, 사용자 몫).
- 화면: `apps/web/src/components/LandingPage.tsx` (`LandingPage({ operator?, onLogin })`).
- `index.html`: `<meta name="description">` + `#root` 안 정적 글(제목·한 줄 소개·`/privacy`·`/terms` 링크). 인라인 스크립트·style 없음.
