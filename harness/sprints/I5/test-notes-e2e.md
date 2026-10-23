# I5 test-e2e 메모

## 실행
- `CI=1 E2E_PORT_OFFSET=27900 pnpm exec playwright test --config apps/web/playwright.config.ts tests/e2e/i5` — 27개 통과(webkit-iphone 23 · chromium 3 + 이력 기다림 1)
- `... tests/e2e/i4` — 56개 통과(I5 문장 교체 반영, 바꾼 곳마다 D-I5-03·06 주석)
- WebKit 설치 필요: `pnpm exec playwright install webkit`(webkit-2336)

## 파일
- `tests/e2e/i5/support.ts` — 사파리 흉내 가짜 인식(AC-I5-20 모양: webkitSpeechRecognition만, 최종 뒤 100ms onend, 말 없으면 3초 뒤 onend, navigator.standalone 흉내, 지원 안 함)
- `tests/e2e/i5/safari.spec.ts` — AC-I5-04·10·11·12·14·20·21(a~d)·22·23·24 (@webkit)
- `tests/e2e/i5/breaks.spec.ts` — 크로미움 AC-I5-10·12·13, WebKit AC-I5-13, AC-I5-03(b~e) 화면 쪽, D-I5-01 1분 창 양쪽 경계, 넘긴 카드에 자동 등록을 나중에 켬, 393px 긴 문장 + 홈 화면 앱 줄

## 알아 둘 것
- **WebKit에서는 서비스 워커가 페이지를 맡으면 `page.route`가 요청을 잡지 못한다**(요청 기록 `page.on('request')`는 잡힘). 크로미움은 잡는다. 그래서 이력 조회를 붙잡는 시험만 `test.use({ serviceWorkers: 'block' })`로 둔다. `apps/web/playwright.config.ts` 머리 주석("page.route가 그대로 쓰인다")은 WebKit 묶음에는 맞지 않는다.
- 이력 기다림(켠 때부터 2초)을 보는 시험은 시계를 켜기 **전에** 멈춘다 — 그렇지 않으면 실제 시간에 기다림이 닳아 흔들린다.

## 제품 버그
- 찾지 못함. 깨뜨리기 공격(중간 결과 뒤 끄기·오류, 공백 중간 결과, 최종 뒤 다시 넘김 없음, 조용함 끝 반복, 1분 창 경계, 넘긴 카드 + 자동 등록 켜기, 좁은 화면 긴 문장)이 모두 스펙대로였다.

## HG-4(사람 확인)로 남는 것
- 실제 아이폰 사파리의 오류 코드 경로(not-allowed·service-not-allowed가 다시 시작에서 오는지), 최종 표시 없이 끝나는 빈도, 홈 화면 앱 동작 — Playwright WebKit은 실제 사파리 음성이 아니다.
