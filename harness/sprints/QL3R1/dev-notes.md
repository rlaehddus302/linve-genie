# QL3R1 개발 메모

## dev-web

### 한 일 (커밋 `[dev:web] QL3R1: …`)
- **D-QL3R1-01** `components/Modal.tsx`: 처음 초점(`initialFocus` 또는 "닫기")과, 누른 단추가 사라져 "닫기"로 되돌리는 초점 모두 `focus({ preventScroll: true })`. 열 때 창 배경(`.backdrop`)·창(`.modal`)의 `scrollTop`을 0으로. 처음 초점을 받는 요소·Esc·숫자 키·Tab 돌기·`closeLast`·`phoneBottom`은 그대로.
  - 실측(배경 700px 내린 뒤 "1번 자세히"): 412×915 150% 제목 위 끝 72px·`.backdrop.scrollTop` 0·초점 "닫기"(창 안). 412 100% 48px, 1440 150% 72px.
- **D-QL3R1-02** `styles.css`(+ `ProductBoard.tsx`):
  - ⓐ 줄 폭이 글자 17자보다 좁을 때(`@container quick (max-width: 17rem)` — 휴대폰 + 큰 글씨) 빠른 입력 줄을 격자로: 위 한 줄에 이름 "빠른 입력"·"개수"(글만, 44px 높이 없음), 아래 한 줄에 **입력칸 | 개수 칸**. 문서·Tab 차례(이름 → 입력칸 → 개수)는 그대로. 개수 칸이 없으면(옵션을 붙임) 입력칸이 한 줄을 다 쓴다. 입력칸 폭: 375 150% 234px(화면 62%), 412 150% 271px(66%) — 기존 AC-MOB1-02의 "입력칸 폭 ≥ 화면 60%" 그대로 맞음.
  - ⓒ `@container console-sticky (max-width: 17rem)`에서 요약 줄(`.current-summary`)은 한 줄 말줄임(`text-wrap-mode: nowrap` + `text-overflow: ellipsis`). 문장 전체는 `title`에 같은 글로(접근성 이름 `aria-label="현재 상품 요약"`은 그대로 — 기존 선택자 유지). 보통 글씨(100%)는 줄바꿈 그대로(AC-QL2-01 100% 그대로).
  - ⓑ(여백 줄이기)는 하지 않았다 — ⓐⓒ로 기준을 맞춰 멈춤.
  - 실측(실제 방송·보류 찜 1·알림 접힘·출력 기기 정상·600px 내림): 375×812 150% **248px**(상한 284, 전 385), 412×915 150% **248px**(상한 320). 100%는 159px 그대로.
- **D-QL3R1-03** `ConsolePage.tsx`: 휴대폰 차례 = 고정 영역 → 단위 줄 → 현재 상품 → 음성 칸(켜졌을 때) → (음성 설정과 기록 접는 칸) → **상품 보드 → 채팅** → 행동 줄 → 리허설 조작판 → 여러 플랫폼 안내 → 유튜브 칸 → 인스타그램·틱톡 칸. PC는 그대로(보드·채팅은 `console-grid` 안). 실측 412 100%: 현재 상품 308 · 보드 626 · 채팅 1140 · 행동 줄 1256 · 플랫폼 칸 1366(문서 y). 유튜브 칸 파일은 건드리지 않음.
- **D-QL3R1-04** `lib/print-words.ts`(`deviceLostShortMessage`·`stationLeadShortText`·`DEVICE_SHORT_NAME_MAX`)·`AlertStrip.tsx`(`AlertLead.shortText`)·`styles.css`: 접힌 휴대폰 띠에서만 "알림" 영역 **밖**, 띠 아래 자기 줄에 단추 **"라벨이 안 나가요 · '{이름}' 화면을 켜 주세요"**(누르면 라벨 화면 — 같은 곳, 줄바꿈 됨). 이름 10낱자(`Array.from`) 넘으면 앞 10 + "…", 글로만.
  - "알림" 영역 안의 출력 기기 항목(긴 문장·이름·차례·항목 수)과 접힌 한 줄 높이(44px)는 **BASE 그대로** — AC-MOB1-13의 `alerts(page).getByRole('button')` 단언(접힌 휴대폰에서 3개·끝이 긴 문장)을 깨지 않으려고. 그래서 접힌 휴대폰에서는 긴 문장 단추(한 줄에서 잘려 안 보임)와 짧은 문장 단추가 접근성 트리에 둘 다 있다.
  - 펼친 띠·PC(`display: none`)·라벨 화면·포장 출력 안내는 `deviceLostMessage` 그대로.
- **D-QL3R1-05** `actions.ts`(`openClaimAction`의 `host.cancel`·`host.reject`에 `submitOnPick`)·`console-context.ts`(`ReasonSpec.submitOnPick`)·`ActionDialogs.tsx`·`ReasonField.tsx`(`onPicked(reason)`): 빠른 사유 단추·숫자 키 1~4 → 그 사유로 바로 `queueHost`(5초 되돌리기 띠, 창 닫힘). 상품 자세히·구매자 화면·문자찜 화면·음성 칸의 찜 취소도 같은 `openClaimAction`이라 같다. "1등으로 올리기"(`host.promote`)·차단·다시 판매·직접 배정 등 다른 사유 창은 그대로(고르면 보내기 단추로 초점).
- **D-QL3R1-06** `deposit-parts.tsx` 칸 이름·`<dt>` "받은 곳", `DepositPaste.tsx` 안내·단추 "은행 파일 고르기(.csv)"·읽기 오류. "입금 #12"·설정의 원천 관리 낱말은 그대로.
- **D-QL3R1-07** `SealNotice.tsx` "이 날짜 기록은 {시각}부터 잠겨요. 그 뒤로는 고칠 수 없어요.", `SettlementsPage.tsx` "손님 {n}명 · …"·"그날 정산할 손님이 없어요."·"맞는 손님이 없어요."·"그 구매자의 정산이 없어요.", `ProductDetail.tsx` "상품 바꾸기"(제목·`aria-label`)와 찜 목록 위 한 줄 설명(`CLAIM_BUTTONS_HELP`, `p.hint.claim-help`, 16px, 줄바꿈 — 1등·대기·보류·충돌 찜이 하나라도 있을 때만).
- **D-QL3R1-08** `PolicyPages.tsx` "3. 보관 기간" 첫 줄을 D-LND1-11 4번 줄과 같은 글로.

### 단위 시험
- 새 `apps/web/test/ql3r1.test.tsx`(Modal `preventScroll`·되돌리는 초점, 짧은 문장·자르기·이스케이프, 무효 빠른 사유 바로 보냄, 글 칸 숫자는 글자, 차단 창 그대로, 휴대폰 DOM 차례, 요약 `title`, 낱말).
- 결정이 바꾼 기존 웹 단위 단언을 새 문장·동작으로: `seal-pages`·`settlements-page`·`deposits-page`, 찜 취소 창에서 빠른 사유 뒤 "찜 취소하기"를 한 번 더 누르던 줄(`console-s06`·`console`·`buyers-page`·`sms-page` — 창이 이미 닫혀 아무 일도 안 하던 줄을 지우고 `// … (QL3R1 D-QL3R1-05)`).
- 웹 단위 105파일 1618개 통과(TZ=Pacific/Honolulu), `tsc --noEmit`·eslint(web src·test) 오류 0.

### test-e2e에게
- 고정 영역 요약 줄: 큰 글씨 휴대폰에서 한 줄 말줄임이라 **AC-QL2-01 150% 묶음의 `expectNoClip(요약 줄)`(scrollWidth ≤ clientWidth + 1)은 이제 맞지 않는다** — D-QL3R1-02 ⓒ가 D-QL2-11 (1)의 "줄 수 제한 없음"을 휴대폰 고정 영역에서 바꾼 것. 문장 전체는 `title` 속성(그리고 현재 상품 카드). 100%는 그대로 줄바꿈.
- AC-QL2-02(휴대폰 Tab·DOM 차례)·차례 단언은 D-QL3R1-03 차례로.
- 끊김 짧은 줄: `page.locator('.alert-bar').getByRole('button', { name: "라벨이 안 나가요 · 'PC' 화면을 켜 주세요" })` — "알림" 영역(`region '알림'`) 밖이다. 접힌 휴대폰에서만 보이고(PC·펼침은 `display: none`/그리지 않음).
- 찜 목록 위 설명: `getByText('찜 취소: 손님이 안 사기로 했을 때 · …')`, 클래스 `claim-help`.
- 사유 창: 찜 취소·무효는 빠른 사유를 누르면 창이 바로 닫힌다 — 기존 E2E 중 빠른 사유 뒤 "찜 취소하기"·"무효로 하기"를 누르는 줄은 이제 닫힌 창을 찾다가 실패한다(AC-S05-34·AC-S06-63 관련 줄 — `// QL3R1 D-QL3R1-05`).
- 붙여넣기 파일 칸 이름이 "은행 파일 고르기(.csv)"로 바뀌었다 — `tests/e2e/n3/paste.spec.ts:105`의 `getByLabel('CSV 파일 고르기')`(`// QL3R1 D-QL3R1-06`). 그 밖 낱말: `tests/e2e/i3/seal.spec.ts`·`tests/e2e/s06/settlements.spec.ts`(D-QL3R1-07).

### 남은 것·사용자 결정
- 사용자 결정 필요: 없음.
- disputesWithSpec: 없음. 다만 D-QL3R1-04의 "자기 줄"은 위처럼 "알림" 영역 밖 띠 아래 줄로 했다(영역 안에 두면 AC-MOB1-13의 접힌 한 줄 높이 44px 단언과 부딪힌다).

### 기존 E2E 실행 결과 (dev-web, 커밋 뒤)
`CI=1 E2E_PORT_OFFSET=4100 pnpm exec playwright test --config apps/web/playwright.config.ts tests/e2e/mob1/big.spec.ts tests/e2e/mob1/station.spec.ts tests/e2e/ql2/console.spec.ts tests/e2e/ql2/alerts.spec.ts` → 49 통과 · 10 실패. mob1(big·station — AC-MOB1-02·03·13·14)과 ql2/alerts는 모두 통과.
실패 10개는 모두 이번 결정이 바꾼 단언이다(test-e2e 몫):
- `tests/e2e/ql2/console.spec.ts:167`(375·412 × 실제·리허설), `:211`(393 WebKit × 실제·리허설), `:304`(375·412 리허설 띠) — 150% 요약 줄 `expectNoClip`의 옆 잘림(scrollWidth > clientWidth). D-QL3R1-02 ⓒ 한 줄 말줄임 → `// QL3R1 D-QL3R1-02`. 위아래 잘림·첫 화면·600px 뒤 보임은 통과.
- `tests/e2e/ql2/console.spec.ts:428`·`:462` — AC-QL2-02 휴대폰 차례(행동 줄 → 리허설 → 상품 보드). D-QL3R1-03 차례로 → `// QL3R1 D-QL3R1-03`.
