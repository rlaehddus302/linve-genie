# SRV1 dev-notes

## dev-web (웹·앱 몫, 브랜치 sprint/SRV1-web)

### 서버와 맞출 약속 (클라이언트가 이 모양으로 부른다 — 서버 몫과 다르면 한쪽으로 맞춘다)

1. **읽기 입구** `POST /api/broadcasts/:id/read` `{ kind, text }` → 본문이 곧 읽은 결과(감싸지 않음). 결과 모양은 `packages/voice-session/src/read.ts`의 `ReadingOf[kind]` (웹·앱은 이 타입만 `import type`).
   - `quick` → `{ no, name, price, error, message, noText?, priceText? }` (error: `EMPTY`·`PRICE_MISSING`·`PRICE_TOO_LOW`·`NUMBER_MISSING`·`NUMBER_INVALID`·null, message = AC-S05-11 문장)
   - `fix`(고치기 칸 번호) → `{ no, error: 'NUMBER_MISSING'|'NUMBER_INVALID'|null, message }`
   - `price`(그 방송 가격 단위) → `{ amount, error: 'PRICE_MISSING'|'PRICE_TOO_LOW'|null, message }`
   - `money`(원 단위) → `{ amount }`
   - `received` → `{ kind: 'empty' } | { kind: 'invalid' } | { kind: 'ok', value, minute, time, day, late }` (서버 시계)
   - `phone` → `{ phone, last4 }`
   - **방송 없는 화면(정산)의 돈 칸은 `POST /api/read` `{ kind: 'money', text }`** — 정산은 구매자·날짜 단위라 방송 id가 없다. 서버가 한 입구만 두려면 `/api/read`를 같은 처리기로 두면 된다.
   - 구현은 `packages/voice-session/src/read.ts` `readText(kind, text, { settings, now })`를 그대로 부르면 된다(옮기기 전 웹 함수와 같은 결과 — 웹 단위 시험 quick/received/money/fb1이 기대값 그대로 이 함수를 지난다). 서버 입구가 다른 곳에 따로 생기면 이 파일과 합친다.
2. **원문 쓰기** (`POST /api/events`):
   - 빠른 입력 등록: `{ type: 'product.register', b, text: '<친 줄>', stock?, options?, stocks?, aliases? }` — no·name·price 없음.
   - 고치기 칸 등록(빠른 입력 고치기 칸·음성 카드 고치기 칸): `{ type: 'product.register', b, no: '<번호 칸 글>', name, price: '<가격 칸 글>' }` — no·price가 **글자**.
   - 상품 고치기 창의 가격 칸: `{ type: 'product.update', b, no, price: '<가격 칸 글>', ... }` — price가 글자.
   - 문자찜: `received`는 친 글 그대로(`'3:10'`, `'오후 8:01'` 등), `phone`도 친 글 그대로. (옛 서버에 넣어도 `isValidReceivedTime`이 `8:01` 같은 애매한 글을 거절하므로 조용히 다르게 기록되지 않는다.)
   - 정산: `settlement.payment|shippingOverride|refund`의 `amount`가 **글자**. `settlement.adjust`는 `amount: '<글>'` + `sign: 'minus'|'plus'`(할인이면 빼는 쪽).
   - 숫자 필드로 오는 옛 요청(음성 카드·"고칠까요?"에서 고른 값 — 서버가 이미 읽어 준 값)은 그대로 받는다.
   - 메모·사유의 전화번호: 화면은 먼저 막지 않는다. 서버가 400 `problems: [{ field: 'memo'|'reason', message: PHONE_IN_TEXT 문장 }]`으로 거절해야 칸 아래에 보인다(AC-SRV1-07·08).
3. **조작 전용 음성 연결**은 `?capture=false`로 연다(`mode=chrome` 없음). 웹·앱 둘 다. 서버 relay가 `capture=false`면 일꾼을 붙이지 않아야 한다.
4. **채팅 언급**: 화면은 `message.mentions`(번호)만 본다 — 이름·별칭 언급 번호도 서버가 `mentions`에 넣는다(약속 5).

### 서버 영역을 건드린 곳 (최소, 이유)
- `packages/voice-session/src/read.ts` 새 파일 + `package.json` exports `./read`: 웹 `lib/quick.ts`·`received.ts`에서 걷어낸 읽기 함수의 새 자리(서버 전용 패키지). 서버 입구가 이걸 쓰면 결과 모양이 클라이언트와 같다.
- `packages/voice-session/src/server.ts` import 한 줄: `decideFixForm`(웹 lib/quick.ts) → `readFixForm`(read.ts). 같은 판단.
- `apps/server/src/voice/reading.ts` import 한 줄: `readReceived`를 웹 `lib/received.ts` → `@livejjim/voice-session/read`.
- 웹 `voice/controller.ts`: 화면용 문장·타입·작은 함수(VOICE_IDLE·SmsEntry…)를 `voice/model.ts`로 나누고 `export * from './model.ts'`로 다시 내보낸다. **파일 이동(서버 전용 자리)은 서버 몫** — 이동 때 `model.ts`는 웹에 남기고 클래스만 옮기면 된다. 옮기면 `apps/web/test/legacy-voice-ui-fixture.ts`·`i5-voice-screen.test.tsx`의 `../src/voice/controller.ts` import 경로만 새 자리로 바꾼다.
  - 그 전까지 `apps/web/test/srv1-reading-boundary.node.test.ts`의 "VoiceController 실행 코드가 기기 소스에 없다"는 **실패한다(서버 몫 대기)**.

### 판단 (AUTO 후보 — spec-keeper가 DECISIONS에 올릴지)
- **Enter 흐름**: Enter 때 그 줄을 서버에 한 번 읽혀(미리 보기 답은 기다리지 않음) 지금처럼 등록/"고칠까요?"/자세히/고치기 칸을 정하고, 등록 본문은 원문 `text`. 쓰기 응답 모양을 바꾸지 않아도 되는 쪽. 읽기 입구에 닿지 못하면 "저장하지 못했어요" 줄로 남기고 연결이 돌아오면 **처음 정한 요청 번호**로 다시 읽어 한 번 보낸다(AC-SRV1-06).
- **문자찜 받은 시각**: 넣기를 누를 때 서버에 읽혀 "지금보다 늦은 시각" 물음(D-089)을 지킨다. 읽지 못하면(연결 없음) 넣지 않고 칸 아래에 문장 — 늦은 시각을 묻지 않고 넣는 일을 막는 쪽.
- **문자찜 번호 칸**: 웹은 숫자만 받는 칸이라 숫자로 보낸다(글 해석 없음). 앱 문자찜 번호도 `Number(trim)` 그대로 — 읽기 함수가 아니라 숫자 칸 확인.
- **설정 금액 칸**: 정수 글은 숫자로, "4천" 같은 글은 원문 그대로 보낸다(서버가 원 단위로 읽어야 함 — 서버 설정 저장에 `readMoney` 필요).
- 옛 크롬 고르기 저장값(`livejjim.voiceEngine`)은 음성 컨트롤러를 만들 때 지운다(읽지 않음).
