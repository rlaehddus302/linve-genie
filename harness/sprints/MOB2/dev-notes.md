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
