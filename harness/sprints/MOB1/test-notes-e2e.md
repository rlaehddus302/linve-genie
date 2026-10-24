# MOB1 test-notes — e2e

## 만든 시험 (`tests/e2e/mob1/`)

| 파일 | 수용 기준 | 묶음 |
|---|---|---|
| `support.ts` | 기기(375·412 안드로이드 흉내·393·1440), 글자 150%(addInitScript로 `html { font-size: 150% !important }`), 가로 넘침 검사(넘침을 자르는 조상으로 잘린 부분은 빼고 잼 — 넘친 요소 글을 실패 문장에), 대비 계산, 가짜 Wake Lock(`installFakeWake`·`hideScreen`·`showScreen`·`wakeCounts`), 새 판매자(`freshSeller` — 방송 목록·출력 기록이 시험끼리 섞이지 않게), 개발 용어 검사 | |
| `bar-logout.spec.ts` | AC-MOB1-04·05·06 | 기본 |
| `station.spec.ts` | AC-MOB1-12·13·14·24·25 (두 기기 — 안드로이드 흉내가 출력 기기, 끊김은 오프라인·탭 닫기) | 기본 |
| `hide.spec.ts` | AC-MOB1-15·16·17 | 기본 + `@multi` 1개 |
| `press.spec.ts` | AC-MOB1-01 (412 터치 `tap()` · 1440 마우스 `hover()`) | 기본 |
| `small.spec.ts` | AC-MOB1-21·22·23·26 | 기본 |
| `big.spec.ts` | AC-MOB1-02·03 (크로미움 375·412) | 기본 |
| `voice.spec.ts` | AC-MOB1-10·11 (412 크로미움) | 기본 |
| `webkit.spec.ts` | AC-MOB1-02(393)·10(393)·19·20 | `@webkit` 4개 · 기본 3개 · `@no-test-printer` 1개 |

모든 화면 흐름 시험은 `expectNoDevWords`(TRY_PHONE_YOUTUBE·DISCONNECTED·JSON·NOT_CONNECTED 등)를 거치는 화면이 있다(AC-MOB1-90).

## 찾은 것

- **TE-MOB1-001 (실패 시험, minor, web)** `bar-logout.spec.ts` "TE-MOB1-001 …": 로그아웃을 누를 때 받는 방송 목록(`GET /api/broadcasts`)의 응답이 오지 않으면(느린 망) 버튼이 잠긴 채 아무 창도 뜨지 않는다. AC-MOB1-06은 "알아내지 못했다(목록 요청 실패·**응답 전**)"이면 같은 창에 "방송 중인지 확인하지 못했어요."를 보이라고 한다. `apps/web/src/components/LogoutButton.tsx` `press()`가 `get()`을 시간 제한 없이 기다린다(`api/client.ts`의 `get`에는 시간 제한이 없다). 고칠 길: 응답을 기다리는 동안(또는 짧은 시간 뒤) 창을 "확인하지 못했어요" 문장으로 먼저 띄우고, 응답이 오면 문장을 맞춘다. 실패(연결 끊김)는 지금도 창이 뜬다(그 시험은 통과).

## 통과한 공격 (회귀로 남김)

- 412 터치에서 빨간·노란 알림을 손가락으로 누르고 창을 닫은 뒤·초점이 남은 채에도 색 그대로. `matchMedia('(hover: hover)')`가 터치 흉내에서 false인지도 본다(시험이 마우스 기기로 통과하지 않게).
- 출력 기기 이름에 `<b>…</b><script>` → 콘솔 띠에 글자 그대로, `b`·`script` 요소 0. 출력 기기 항목은 "알림 n 펼치기" 수에 들지 않는다(이 항목 하나뿐이면 펼치기 버튼 없음).
- 출력 기기 항목은 리허설·끝난 방송·라벨 꺼짐·이 기기가 출력 기기일 때 없다. 출력 기기를 정하면 "쌓이고 있어요" 항목이 사라진다.
- 두 번째 안드로이드가 기본 이름("안드로이드 폰 2")을 건드리지 않고 바꿔 맡으면 서버 출력 기기 이름도 "안드로이드 폰 2", 앞 기기는 저장한 이름 그대로.
- 끝난 방송을 다른 기기에서 끝내면 1초 안에 빠른 입력 줄이 사라지고, 치던 글은 Enter를 눌러도 보내지지 않는다. 켜져 있던 음성은 "음성 끄기"가 남고, 끈 뒤에는 "음성 켜기"도 없다.
- 휴대폰 설정의 크롬 확장 칸: PC에서 코드를 만든 상태에서 휴대폰으로 열고 새로 고쳐도 `/api/extension` 쓰기 요청 0, 서버 값 그대로.
- 화면 꺼짐 막기: 숨김·보임 두 번이면 요청 3번(처음 + 보일 때마다 1번), 보이는 채 다시 보임 알림은 더 요청하지 않음, 숨은 동안 음성을 끄면 보여도 요청 없음, 켜진 채 콘솔을 떠나면 잠금을 놓음, 출력 기기 잠금(D-I1-03)과 따로(음성만 끄면 그쪽은 남음), Wake Lock 없음·거절이면 음성 그대로·오류 없음.
- 글자 150% 375·412·393(WebKit): 방송 목록·콘솔(띠 접음·펼침)·리허설 콘솔(긴 닉네임 채팅)·끝난 콘솔·문자찜(고르기 전·고르기 창·고른 뒤)·구매자·정산·포장·라벨·설정·"더보기" 목록 모두 넘침 0.

## 기존 E2E 맞추기 (AC-MOB1-91) — 바꾼 줄마다 `// MOB1 D-MOB1-0x`

- 휴대폰 막대 "문자찜 입력" → "문자찜": `tests/e2e/menu.ts`(`BAR_LINKS`·머리 주석), `nav/phone-menu.spec.ts`(AC-NAV-04 칸 이름, 보조자 한 칸 3줄 — PC 위 줄 비교(AC-NAV-08)는 "문자찜 입력" 그대로 쓰도록 `pcLinks`로 나눔), `t1/screens.spec.ts`(막대 링크 넷), `n3/round1.spec.ts`·`n5/billing.spec.ts`(주석만 — 단언은 `expectPhoneBar`가 `BAR_LINKS`로). PC 메뉴·`h1` "문자찜 입력"을 보는 줄(`s06/navigation.spec.ts` 등 1280 기본 폭)은 그대로.
- 로그인 확인: `s05/support.ts` `login()`·`i3/support.ts` `loginAs()`가 위 줄 "로그아웃" 대신 메뉴(`navigation '메뉴'`)를 기다린다. `n4a/off-screens.spec.ts`(휴대폰 375 홈)·`nav/phone-menu.spec.ts`(휴대폰 3줄)도 같은 방식. PC 폭 줄(l1·s06/pwa·n3/reasons 등 1280)은 그대로.
- 로그아웃 누르기: 새 도우미 `menu.ts` `logoutButton()`(휴대폰 판매자는 "더보기" 목록 맨 끝)·`logoutFully()`(끝내지 않은 방송·출력 기기면 확인 창의 위험 버튼까지). `s05/basic.spec.ts`(AC-S05-01)·`s05/attacks.spec.ts`(AC-S05-41 — 끝내지 않은 리허설이 있어 확인 창)·`l1/support.ts` `logout()`.
- 출력 기기 끊김 문장: `i1/screens.spec.ts` AC-I1-23 줄 → 새 문장 + 옛 문장 없음.
- "전체 기록(JSON)" → "전체 기록 파일 (옮기기·보관용)": `i2/ledger-settings.spec.ts`.
- 끝난 방송·봉인 날짜의 빠른 입력: `s05/basic.spec.ts`(끝난 방송에서 빠른 입력으로 등록하던 줄 → 빠른 입력 없음 + 같은 등록을 API로 보내 서버가 받는 것 그대로), `i3/seal.spec.ts`(`toBeDisabled()` 두 줄 → 칸이 없음 `toHaveCount(0)`).
- 포장 라벨 출력 자리: `pl1b/packing-print.spec.ts` AC-PL1B-10의 "라벨 PDF와 같은 부모" → 그림 위·"라벨 PDF"는 그림 아래.

### 맥북 쪽에 알릴 것 (i3 파일)
- `tests/e2e/i3/support.ts` `loginAs()` — "로그아웃" 기다리기 → 메뉴 기다리기 한 줄(+주석 한 줄).
- `tests/e2e/i3/seal.spec.ts` — AC-I3-41 두 시험의 `getByLabel('빠른 입력')).toBeDisabled()` → `toHaveCount(0)` 두 줄(봉인 날짜는 빠른 입력 줄이 없다, D-MOB1-09).
- `tests/e2e/y1/**`는 건드리지 않았다.

## 돌린 것
- `CI=1 E2E_PORT_OFFSET=800 pnpm exec playwright test --config apps/web/playwright.config.ts <파일>` — `tests/e2e/mob1/` 전부(기본·@webkit·@multi·@no-test-printer), `nav/`·`t1/screens.spec.ts`. TE-MOB1-001 하나만 실패(의도).
- 기존 E2E 79개 파일(휴대폰 폭을 쓰는 시험 전부 + i5 WebKit 전부 + 위에서 고친 파일, y1 제외) 652개 — 651 통과, 1 실패(아래 "흔들림"). 그 1개를 `--repeat-each 3`로 다시 돌려 1/3 실패 — 흔들림으로 확인.
- `tests/e2e/mob1/` 전부 다시: 60 통과 + TE-MOB1-001 실패(의도).

## 흔들림 (실패 시험으로 남기지 않음 — 원인은 시험 쪽 측정 시점)
- `tests/e2e/i3/youtube.spec.ts:107` AC-I3-01·25 "invalid_grant → 콘솔 고정 영역 경고": 1280 폭 콘솔에서 `setViewportSize(375×812)` 직후 바로 `.console-sticky` 높이를 잰다. 화면은 폭이 바뀐 뒤 React가 휴대폰 모양으로 다시 그릴 때(`useWide` — matchMedia 알림 → 다시 그리기) 단위 줄·"등록하면" 줄을 고정 영역 밖으로 옮기는데, 그 전 한 순간(PC 구조 그대로 375 폭)을 재면 332px(> 284px)이다. 다시 그린 뒤는 231px. 탐침으로 확인: PC 구조 그대로 375 폭이면 단위 줄이 두 줄(58px)·"개수" 이름이 칸 위로 쌓여 고정 영역이 약 50px 커진다. 실제 휴대폰은 1280 → 375로 바뀌지 않으므로 제품 경쟁 상태가 아니라 시험의 측정 시점 문제다.
  고칠 길(맥북 쪽 — i3 파일, 이 스프린트는 고치지 않음): 폭을 바꾼 뒤 휴대폰 모양이 된 것을 기다리고 잰다(예: `await expect(page.locator('.console-sticky .quick-unit')).toHaveCount(0)` 또는 `expect.poll`로 높이). MOB1에서 새로 생긴 흔들림인지는 BASE에서 돌려 보지 않아 모른다.
- 전체 `pnpm verify`·전체 E2E는 돌리지 않았다(부하 규칙 — 오케스트레이터 몫).
