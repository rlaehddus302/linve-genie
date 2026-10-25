# MOB2 dev-notes

## web (dev-web)

### 바뀐 공개 모양 (먼저 적음)

**문장 상수·함수**
- `lib/deposit-words.ts`
  - `depositLabel(no)` = `"입금 번호 {no}"`. `components/deposit-parts.tsx`는 이것을 그대로 다시 내보낸다.
  - `storedMemoWords(text)`: 저장된 메모·사유를 보일 때만 바꿔 읽는다. 정확히 `입금 #{숫자}`이고 앞뒤가 글자·숫자·`_`·`#`가 아닐 때만 `입금 번호 {숫자}`로 바꾼다.
    - 그대로 두는 것: `"#12 국민"`·`"입금#12"`·`"입금 #12번"`·`"입금 #12a"`·`"재입금 #12"`·`"입금  #12"`(빈칸 둘).
    - 정산 화면 기록 줄의 `record.reason`·`record.memo`에만 쓴다. 이벤트 기록·백업·서버가 새로 적는 메모는 그대로 `입금 #12`다.
- `lib/derive.ts` (D-MOB2-06)
  - `PENDING_TIMED_OUT_WORD` = `"보류 · 시간 지남"`, `PENDING_TIMED_OUT_TAIL` = `" — 지금 등록해도 판정되지 않아요"`.
  - `pendingWindowPassed(atMs, nowMs, windowSec)` = `nowMs − atMs > windowSec × 1000`. 순수 함수이고 경계 정각은 아직 유효하다. **test-domain AC-MOB2-34는 이 함수를 코어 R-5와 견주면 된다.**
  - `preOpenWindowSec(data, b)`: 방송 설정 `claim.preOpenWindowSec`, 없으면 30.
  - `isPendingTimedOut(data, claim, now)`: 아래 셋이 모두 맞을 때 참이다.
    - 상태가 `PENDING`이다.
    - 그 번호의 상품이 없거나 `READY`다.
    - `pendingWindowPassed(Date.parse(claim.at), now, W)`가 참이다.
  - `claimWord(data, claim, now?)`: `now`를 주면 시간이 지난 보류 찜을 `"보류 · 시간 지남"`으로 쓴다(주지 않으면 지금 그대로).
  - `alertCounts(data, now?)`: `now`를 주면 `pending`은 시간이 지나지 않은 보류 찜만 센다. 콘솔은 늘 지금 시각을 준다.
  - `splitPending(data, now)` → `{ live, timedOut }`. 보류 찜 창의 두 목록이다.
  - `nextPendingFlip(data, now)`: 다음에 "시간 지남"으로 바뀌는 시각(`at + W×1000 + 1`).
- `lib/use-pending-now.ts` `usePendingNow(data)`: 1초마다 그리지 않는다. 다음에 바뀌는 순간에 한 번 다시 그린다(`Date.now`·`setTimeout`이라 당긴 시계가 그대로 먹는다).
- `lib/words.ts` `vacatedOutcome({ label, before, after, afterStatus, waitlistCleared, nameOfClaim })` → `{ kind: 'winner'|'ask'|'cleared'|'empty', text }` (D-MOB2-04 문장 그대로).
- `lib/vacated.ts`
  - `captureVacated(data, event, claims)`: 보내기 직전 조치 전 모양을 잡는다.
    - 대상: `host.cancel`·`host.reject`·`host.approveCancel`이고, `claims`가 정확히 하나이며, 그 찜이 `CONFIRMED`일 때.
    - 그 밖에는 null이다.
  - `vacatedLine(before, dataAfter)` → `{ text, tone }`. 아직 1등이면(따라잡지 못함) null.
  - `vacatedLabel(claim)`: `"15번"`, 옵션 찜이면 `"15번 빨강"`.
    - 모양은 변형 글만이고 수량은 붙이지 않는다. `claimOptionWords`의 `" 빨강 2개"`에서 수량을 뺀 것이다("15번 빨강 2개 새 1등"은 뜻이 어긋나서).
- `lib/resend-board.ts` (D-MOB2-07)
  - 문장 상수 셋
    - `RESENT_PREFIX` = `"연결이 돌아와 보냈어요: "`
    - `AUTO_RESEND_NOTE` = `"연결이 돌아오면 저절로 다시 보내요."`
    - `RESENDING_WORD` = `"다시 보내는 중…"`
  - `ResendBoard`
    - `add(key, kind: 'register'|'command'|'sms', run)`, `remove(key)`, `addHost(run)`, `flush()`.
    - 차례: 등록 → 상품 관리 명령 → 방송자 조치(`UndoQueue.resendRetryable`) → 문자찜. 하나씩 보내고, 보내는 중에 또 부르면 아무 일도 하지 않는다.
- `lib/undo-queue.ts`
  - `ActionStatus`에 `'outcome'`을 더했다.
  - `ActionItem`에 `auto`(저절로 다시 보냄)·`outcome: { text, tone } | null`을 더했다.
  - `RegistrationItem`에 `auto`를 더했다.
  - `ActionInput.outcome?(result)` → `Promise<OutcomeLine | null>`. changed이면 따라잡는 동안 `sending`에 두었다가, 결과 줄이면 `'outcome'`을 10초(`KEEP_OUTCOME_MS`) 보이고, null이면 `'done'`.
  - `resendRetryable()`: `failed`이고 `error.retryable`인 것만 id 차례로 같은 요청 번호로 한 번 보낸다. 끝날 때까지 기다린다.
- `components/console-context.ts` `ConsoleApi.resend?: ResendBoard`. 콘솔과 `host-actions.tsx`(문자찜·구매자 화면)가 만들어 넣는다.

**화면 표시 (E2E가 찾을 글자)**
- 되돌리기 띠(`section[aria-label="보내기 전 조치"]`)
  - 1등 찜 취소·무효·취소 승인 뒤: 결과 줄 `role="status"`, 예: "15번 새 1등: 김철수". 옆에 "확인" 단추가 있고 10초 뒤 사라진다. 이때 "보냈어요: …"는 없다.
  - 저절로 보낸 조치: 성공하면 "연결이 돌아와 보냈어요: {조치 이름}", 보내는 동안은 "다시 보내는 중…: {조치 이름}".
  - retryable 실패 줄(`role="alert"`) 끝에 " 연결이 돌아오면 저절로 다시 보내요."가 붙는다.
- 등록 되돌리기 줄: 저절로 보낸 등록이면 "연결이 돌아와 보냈어요: 15번을 등록했어요". "되돌리기" 단추와 남은 시간은 그대로다.
- 빠른 입력 실패 줄
  - "저장하지 못했어요. 다시 보내기를 눌러 주세요: {줄}" 아래, retryable이면 `<p>연결이 돌아오면 저절로 다시 보내요.</p>`가 붙는다.
  - 저절로 보내는 동안 상태 글자는 "다시 보내는 중…"이다(평소에는 "등록하는 중…").
- 상품 자세히
  - 영역 이름·제목이 "상품 관리"다.
  - retryable 실패면 오류 아래 `<p class="hint">`에 안내 문장이 붙고, 보내는 동안은 "다시 보내는 중…"이다.
- 문자찜 화면
  - retryable 실패면 쓰기 오류 아래에 안내 문장이 붙는다.
  - 저절로 보내 성공하면 결과 카드 `strong`이 "연결이 돌아와 보냈어요: {결과 문장}"이다.
  - 칸 7개(번호·받은 시각·전화번호·메모·구매자·옵션·수량) 중 하나라도 실패 뒤 바뀌었으면 보내지 않는다.
- 시간이 지난 보류 찜
  - 최근 넣은 문자찜 줄 태그·상품 자세히 찜 줄 태그·문자찜 결과 카드는 "보류 · 시간 지남"이다.
  - 결과 카드 문장 끝에 " — 지금 등록해도 판정되지 않아요"가 붙는다.
  - 보류 찜 창: 시간이 지난 찜만 남은 번호는 `section[aria-label="시간이 지난 보류 찜"]`(제목 h3 "시간이 지난 보류 찜")에 `"31번 1개"`로 보인다. "번호 넣기"는 없다.
- 입금 처리 기록: "정산 기록 {n}번" 글을 뺐다.

### 정한 것·남긴 것
- 결과 한 줄은 콘솔과 함께 `host-actions.tsx`(문자찜 화면·구매자 화면의 찜 취소)에도 붙였다. 둘 다 "보낸 기기"이고 같은 되돌리기 띠라서다.
  - `host-actions.tsx`는 파일 경계 표에 없지만 web 영역이다. 대신 그 화면들의 저절로 다시 보내기도 같이 켜졌다(방송자 조치 → 문자찜 차례).
- 음성 카드의 문자찜 결과(`VoicePanel.tsx`)는 범위 밖이라 `smsResultWords`의 새 `now` 인자를 넘기지 않았다(지금 그대로 "보류").
- 기존 웹 단위 시험 바꿈
  - `test/console-s06.test.tsx`·`test/ql2-alert-lift.test.tsx`·`test/ql2-summary-top.test.tsx`: 시험 엔진의 찜 시각이 고정(2026-10-19)이라 오늘 시계로는 보류 찜이 "시간 지남"으로 빠진다.
    - 화면 시계를 그 시각에 맞추는 `fixtureClock(T0)`(test/support.ts)를 더했다. 기대값은 그대로이고 `// MOB2 D-MOB2-06` 표시를 달았다.
  - console-s06의 1등 취소 뒤 "보냈어요: 15번 홍길동 취소"는 결과 줄로 바꿨다(`// MOB2 D-MOB2-04`).
  - 입금 낱말 시험 세 파일은 `// MOB2 D-MOB2-05`.
  - `apps/web`에서 vitest를 바로 돌리면 `received.test.ts`·`words-kst.test.ts`가 실패한다. 시험 환경 시간대 때문이고, 이번 변경 전에도 같다(루트에서 돌리면 통과).

### 150% 고정 영역 (D-MOB2-02·03) — 한 일과 측정
- 줄인 것(`styles.css` 끝 "MOB2 D-MOB2-02·03" 절). 큰 글씨인지는 줄 폭 ≤ 17rem 컨테이너 조건(D-MOB1-03과 같은 기준)이나 `10px − 0.25rem`(16px에서 6px, 24px에서 4px)으로 가린다. 그래서 100% 휴대폰·PC는 값이 그대로다.
  - (b) 빠른 입력 줄: 윗줄은 "빠른 입력"과 "개수" 이름, 아랫줄은 입력칸과 개수 칸(3.5rem)이다. 입력칸 폭은 줄 폭에서 3.5rem을 뺀 만큼이라 화면의 60%를 넘는다(AC-MOB1-03). 줄 높이는 216에서 115로 줄었다.
  - (c) 고정 영역 위아래 여백·틈은 큰 글씨에서 4px이다. 제목 줄(`.rehearsal-banner + .console-head`, `.console-head + .console-sticky`)의 위 틈은 큰 글씨에서 18px을 6px로 줄였다(D-MOB2-03이 허용한 제목 줄 여백만).
  - (d) 되돌리기 한 항목: 문장이 한 줄 전체를 쓰고 그 아래에 "남은 시간 n초"와 단추가 한 줄로 온다. 문장 줄 간격은 1.375, 단추는 `min-height: 44px`·위아래 여백 0.25rem이고 글자 크기는 그대로다.
  - (a) 요약 줄 6글자 꼴은 **쓰지 않았다**. AC-QL2-01의 150% 요약 줄 기대(10글자 자르기)를 바꾸게 되는데 AC-MOB2-04가 그 기대값 유지를 요구하기 때문이다. (b)~(d)만으로 기준을 맞췄다.
- 측정: 이 worktree 빌드, Playwright, 알림 접힘(출력 멈춤·보류 찜 + 출력 기기 없음), 스크롤 0. "대기"는 되돌리기 대기 1개(1등 찜 취소 5초 대기)다.

| 기기·글자 150% | 고정 영역 높이 (전 → 후) | 기준(50%) | 빠른 입력칸 아래 끝 / 막대 위 끝 (대기 없음, 전 → 후) |
|---|---|---|---|
| 375×812 크로미움 실제·리허설 | 562 → 395 | 406 | 실제 546 → 491, 리허설 614 → 547 / 733 |
| 412×915 크로미움 실제·리허설 | 562 → 395 | 457.5 | 546 → 491, 614 → 547 / 836 |
| 393×852 WebKit 실제·리허설 | 563 → 395 | 426 | 실제 737 → 682, 리허설 805 → 738 / 773 |

- 393 WebKit은 위 줄(169px) 아래에 "홈 화면에 추가" 안내(190px)가 더 있어서 빠른 입력칸이 더 아래에 있다.
- 접힌 알림 띠의 칩(`AlertStrip.tsx` `markOverflow`)
  - 띠 상자(`.alerts`) 안에 상자 전체가 들지 않는 항목(`li`)에는 `data-overflow="true"`를 붙이고 `visibility: hidden`으로 감춘다. 보조 기술에서도 빠진다.
  - 첫 항목은 늘 보인다. 그릴 때마다, 그리고 띠·목록 크기가 바뀔 때(ResizeObserver) 다시 본다. 펼치면 모두 지운다. 자리는 그대로라 띠 높이·차례는 바뀌지 않는다.
  - **100%에서도 같다.** 375에서 긴 "출력 멈춤 · …" 칩 뒤의 칩은 둘째 줄로 넘쳐 이제 접근성 트리에 없다.

### test-e2e에게 (AC-MOB2-80 — 고칠 기존 줄, 이 worktree에서 돌려 확인함)
아래 줄들은 접힌 띠의 칩을 역할로 찾거나 1등 취소·시간이 지난 보류 찜의 옛 표시를 기대한다. 찾은 방법: 사본 폴더(`test-results/e2ecopy`, git 밖)에서 숨은 칩 찾기에 `includeHidden: true`만 붙여 돌려 봤다. 그러면 ql2·mob1(big)·nav(AC-NAV-07 284px 포함)의 **배치 기대값은 바꾸지 않고 통과했다**. 고치는 방법(펼친 뒤 찾기, `includeHidden`, 띠 글자로 보기)은 test-e2e가 정한다.
- D-MOB2-02(접힌 띠의 숨은 칩이 접근성 트리에 없음)
  - `tests/e2e/ql2/console.spec.ts:70`: 준비 줄의 `보류 찜 1` 개수. AC-QL2-01·02·03·04 시험이 모두 여기서 멈춘다.
  - `tests/e2e/ql2/alerts.spec.ts:106~108`: 준비 줄 셋(보류 찜 1·판매자 멈춤·출력 기기 끊김).
  - `tests/e2e/mob1/big.spec.ts:77`
  - `tests/e2e/mob1/station.spec.ts:119·122~124`(띠의 모든 버튼·마지막 버튼 이름), `:195~201`(`stationItem` 개수·버튼 3개·차례 — 숨은 항목은 이름이 빈다)
  - `tests/e2e/nav/phone-menu.spec.ts:423~424`: AC-NAV-07 준비 줄 `toBeVisible`.
- D-MOB2-06: `tests/e2e/ql2/labels.spec.ts:76`(AC-QL2-43)이 383초 지난 31번을 위 묶음 "보류 찜 1개 · 가장 오래된 찜 6분 전"으로 기대한다. 이제 그 번호는 "시간이 지난 보류 찜" 목록의 "31번 1개"이고 "번호 넣기"가 없다.
- 사본으로 돌린 s05·s06·s06b 결과: 171개 중 5개가 실패했고, 모두 이번 결정이 바꾼 표시다.
  - D-MOB2-07(누르기 전에 연결이 돌아와 저절로 보냄 — "다시 보내기" 단추가 사라져 누르기가 멈춤): `tests/e2e/s05/attacks.spec.ts:235`(AC-S05-63 방송자 조치), `tests/e2e/s05/realtime.spec.ts:81`(AC-S05-63 등록), `tests/e2e/s06/sms.spec.ts:344`(AC-S06-14 문자찜). 누르기 전까지 막기를 유지하거나 저절로 보낸 결과를 기다리게 고치면 된다.
  - D-MOB2-04: `tests/e2e/s05/rehearsal-actions.spec.ts:135`. 1등 취소 뒤 "보냈어요: 18번 홍길동 취소" 대신 결과 줄이 나온다(그 시험은 대기 없음이라 "18번 1등 자리가 비었어요 · 대기 없음 · 판매 중").
  - D-MOB2-02: `tests/e2e/s06/layout.spec.ts:47~48`. AC-S06-61 준비 줄 `toBeVisible`, 위 AC-NAV-07과 같은 경우다.
- 돌리지 않은 폴더(i1·i3·i4·n3·o2·o4·v1 등)에도 같은 세 경우가 있을 수 있다.
  - 접힌 띠 칩을 역할로 찾기, 1등 취소 뒤 "보냈어요", 끊김 뒤 "다시 보내기".
  - n3에는 "입금 #n" 줄(D-MOB2-05)이 있다.
  - i3·y1은 고치지 않는다(acceptance 공통 전제).
- 새 시험이 쓸 손잡이
  - 결과 줄은 `section[aria-label="보내기 전 조치"]` 안 `role="status"`.
  - 접힌 칩 숨김은 `li[data-overflow]`.
  - 보류 찜 창 아래 목록은 `region "시간이 지난 보류 찜"`.
  - 문자찜 결과 카드는 `region "넣은 결과"`의 `strong`.
  - 상품 자세히는 `region "상품 관리"`.
- 시계: 화면 낱말·알림 수는 `Date.now`와 `setTimeout`(다음 바뀌는 때 at+W×1000+1ms)으로 바뀐다. `page.clock`으로 당기면 된다.

## server (dev-server)

### 바뀐 것 (AC-MOB2-24, D-MOB2-05) — 문장만, 코드·HTTP 상태·칸 이름 그대로
- `INVALID_REQUEST_ID`(400) 맨 위 "보내는 중 문제가 생겼어요. 화면을 새로고침한 뒤 다시 해 주세요.", 칸 `requestId` "화면을 새로고침한 뒤 다시 해 주세요."
  - 파일: `api.ts`·`print-api.ts`·`deposit/api.ts`·`parcel/api.ts`·`tiktok-live/routes.ts`, 칸 문장 표 `messages.ts`(`fieldMessage('requestId')`), 리허설 생성기 검사 `service.ts`
  - 경계 표 밖이지만 같은 문장 한 줄이라 함께 바꿈: `instagram/routes.ts`·`billing/api.ts`(같은 오류가 판매자 화면에 나가므로 문장을 맞춤 — 코드·상태는 그대로)
- 기기 칸 `deviceId`(출력 기기 4경로)·`device`(`/api/stream?device=`) "이 기기를 알아보지 못했어요. 화면을 새로고침한 뒤 다시 해 주세요."
- 조치 기록 조회에서 상품을 두 방법으로 고른 경우 칸 `product` "상품을 하나만 골라 주세요."
- 틱톡 붙여넣기 `REQUEST_REUSED`(409) "이미 보낸 내용이에요. 다시 미리 보기를 해 주세요."
- 시험: `apps/server/test/mob2-errors.test.ts`(7개 — 일반·출력·입금·택배·틱톡 쓰기 경로, 기기·상품·다시 쓴 요청, 문장에 "요청 번호"·"ID"·"영문"·"product" 없음, 거절된 쓰기는 이벤트 0)

### 남긴 것
- `apps/server/src/youtube/routes.ts`의 같은 `INVALID_REQUEST_ID` 문장은 금지 경로라 그대로다 — 맥북 쪽에서 같은 두 문장으로 바꾸면 된다(backlog carryOver 후보).
- 서버 안에서만 쓰는 오류(`receipt-links.ts`·`parcel/service.ts`의 `super('요청 번호가 이미 있다')`)와 운영 기록 문장(`log.ts`)은 화면에 나가지 않아 그대로.
- 기존 시험(`apps/**`·`tests/**`)에 옛 문장을 단언하는 줄은 없었다(grep 확인) — test-e2e·test-domain이 고칠 기존 줄 없음.

### test-domain·test-e2e에게
- 서버 문장 단언이 필요하면 위 문장 그대로. 화면은 오류 코드로 판단하므로 화면 동작은 바뀌지 않는다.
- AC-MOB2-70대(같은 요청 번호 여러 번 → 기록 하나)는 이번에 서버 코드를 바꾸지 않았다 — 기존 멱등 경로(`writer.ts` 요청 번호 확인, 붙여넣기 요약값)를 그대로 시험하면 된다.
