# PAY2 dev-notes

## dev-web (apps/web · apps/mobile)

### 공개 요금 입구 (dev-server와 맞출 것)
- 웹 `/pricing` 화면은 `GET /api/pricing`(로그인 없이)을 부른다 — `apps/web/src/components/PricingPage.tsx`의 `PUBLIC_PRICING_PATH`.
  응답 `{ ready: boolean, items: [{ id, name, kind: 'FLAT_30D'|'DAYS'|'ORDERS'|'LABELS', quantity: number|null, price: number }] }`(요금 표 순서).
  서버가 다른 경로를 쓰면 이 상수 하나만 바꾼다. 모양이 다르거나 404면 화면은 "요금은 준비 중이에요."(가격을 잘못 보이지 않는 쪽).

### 앱에서 연 탭 (BL-11 3)
- `apps/web/src/lib/app-tab.ts`: `from=app`(정확히) → `sessionStorage['livejjim.fromApp']='1'`. 탭이 닫힐 때까지 남는다(새 탭엔 없음).
- 숨김: 메뉴 "요금"(TopBar), 홈 알림 띠, 새 방송 칸 `NO_PASS`(미리 보기·거절)는 `APP_NO_PASS_MESSAGE`만·"요금 화면 열기" 없음, 소개·로그인 화면 "요금 안내" 링크 없음.
- `/pricing`은 늘 `/`로. `/billing`은 요금 기능이 켜져 있을 때 `/`로(요금 화면을 그리지 않아 포트원 스크립트도 안 부름). 꺼진 서버는 지금처럼 "찾을 수 없는 화면이에요."(BL-11 3.5).
- `APP_NO_PASS_MESSAGE`는 웹·앱이 같은 상수를 쓴다(앱이 `@livejjim/web/src/lib/app-tab.ts`를 가져옴 — 이 파일엔 요금 화면 주소 글자가 없다).

### 앱 (apps/mobile)
- `webUrl`·`openWeb`·`openExternal`(라이브지니 출처일 때만)이 `from=app`을 붙인다(`withFromApp`). 간편 로그인 `/login`·개인정보처리방침 `/privacy`도.
- 홈 `NO_PASS` → 앱 문장(`startErrorMessage`). 다른 거절은 서버 문장.
- 정적 검사 `apps/mobile/test/billing-free.node.test.ts`(+ `billing-free-scan.ts`): 타입스크립트 구문 트리로 문자열·템플릿·JSX 글만(주석·import 경로 제외), 의존성 이름, app.json·네이티브 설정, 그리고 **시험이 직접 `expo export`(ios·android)** 해서 번들 글자를 본다(약 30~90초, 시간 한도 600초). 금지 글자를 넣으면 잡는 것도 같은 파일에서 보인다.

### 바꾼 기존 시험 (스펙 변경 때문, 약화 아님)
- `apps/web/test/App.test.tsx` 로그인 화면 링크 목록에 `['요금 안내', '/pricing']` 추가(§7 화면 17·18, D-PAY-11).
- `apps/mobile/test/home-screen.test.tsx` "웹으로 열기" 주소가 `…/settlements?from=app`(BL-11 3.1).
- `apps/mobile/test/thin-client.node.test.ts` 앱이 가져와도 되는 웹 모듈에 `lib/app-tab.ts` 추가(코어를 끌어오지 않는 상수·순수 함수뿐).

### 참고
- 웹 전체 시험을 부하 높은 때(load 100+) 돌리면 5초 시간 한도로 여러 기존 시험이 떨어진다. 파일별로 다시 돌리면 통과(billing-page 등). 내 몫의 실패 아님.
