# V1 dev-notes

## dev-device — `packages/voice` 바뀐 API (서버·화면이 먼저 읽을 것)

모두 `@livejjim/voice` 첫 입구(`src/index.ts`)로 나간다. 화면은 지금처럼 `apps/web/src/voice/load.ts`의 동적 import 한 곳으로만 받는다(`VoiceModule = typeof Voice`라 새 함수가 그대로 보인다). 서버는 이 패키지를 쓰지 않는다(경계 시험 AC-I4-04 그대로) — 서버 쪽 계약은 아래 "서버에 바라는 것"만 보면 된다.

### 1. 문장 읽기 (R-21, AC-V1-01·02)

```ts
readSmsSentence(text: unknown, options?: SmsReadOptions): SmsReading | null
// SmsReadOptions = { parseMode?: string /* 'OPTIONS'이면 옵션 방식 */, maxNumber?: number, maxQuantity?: number,
//                    catalog?: OptionCatalogEntry[] /* 옵션 방식 — R-20 입력 */, focus?: OptionFocus | null }
// SmsReading = { orders: { no, options?, qty }[], last4: string|null, name: string|null, time: 'H:MM'|'H:MM:SS'|null,
//                problem: null|'CANCEL'|'LAST4_UNCLEAR'|'NAME_UNCLEAR'|'TIME_UNCLEAR'|'NUMBER_UNCLEAR'|'OPTION_UNCLEAR' }

readVoiceSentence(text, { extract?: ExtractOptions, sms?: SmsReadOptions, smsSettings?: unknown }): 
  | { kind: 'sms', reading } | { kind: 'product', extraction } | { kind: 'none' }
```
- 화면 입구는 `readVoiceSentence` 하나를 쓰면 된다. 문자찜 표시가 있으면 R-17(`extractVoice`)을 부르지 않는다. "문자찜도 듣기"가 꺼져 있으면 문자찜 문장은 `none`(어떤 카드도 만들지 않음).
- 옵션 방식은 코어 `parseOptionComment`를 그대로 부른다. `catalog`·`focus`는 댓글 옵션 인식에 넘기는 것과 같은 값.

### 2. 설정 (그 기기에 저장, AC-V1-03·20)

```ts
DEFAULT_SMS_SETTINGS = { 'voice.smsListen': true, 'voice.smsAutoSec': 3 }
resolveSmsSettings(stored: unknown): SmsVoiceSettings   // 못 읽거나 범위(0~10 정수) 밖이면 기본값
checkSmsSettings(value: unknown): { key, message }[]     // 입력 칸 검사(쉬운 한국어)
```
- 지금의 음성 설정(`voice.autoConfirm`·`voice.autoConfirmSec`, `resolveVoiceSettings`)과 **따로**다. 같은 저장 키에 넣으면 `checkVoiceSettings`가 모르는 키로 본다 — 저장 키를 따로 쓰거나, 읽을 때 각자 resolve로 걸러 쓰면 된다(어느 쪽이든 깨진 값 → 기본값).

### 3. 문자찜 카드 (AC-V1-03·04)

```ts
type SmsCard = { kind: 'sms', id, text, reading, createdAt, status: 'OPEN'|'SENT'|'CLOSED', touched, autoAt: number|null,
                 candidates: SmsBuyerCandidate[]|null, repeats: number }
type VoiceCard = SuggestionCard | SmsCard;  isSmsCard(card)

createSmsCard({ id, reading, text, createdAt, settings /* 문자찜 설정 */ }): SmsCard
  // autoAt = 주문 하나·문제 없음이면 createdAt + smsAutoSec*1000 (0이면 createdAt), 아니면 null(누르기)
checkSmsAuto(card, { now, voiceOn, dialogOpen, product: (no) => SmsProductView|null, timeAfterNow }): 
  | { due: true, card } | { due: false, card /* 바뀐 카드로 교체 */, block: { no, block }|null }
  // block이 있으면 넣을 수 없는 상품 → 이유 카드로 보이기(smsBlockMessage). timeAfterNow=true면 autoAt이 null이 됨(시각 확인 카드)
  // voiceOn=false면 autoAt이 null이 됨(다시 켜도 저절로 안 함). dialogOpen이면 그대로 두고 다음에 다시 본다
sendSmsCard(card, { product, buyer? }): { ok: true, card /* SENT */, writes: SmsWrite[] } | { ok: false, reason, message, card }
  // SmsWrite = { no, options?, qty, memo: string|null, last4?: string, buyer?: string, time: string|null }
  //   memo: 이름 → 이름, 없으면 null(비움), 뒤 4자리도 이름도 없고 고른 구매자도 없으면 '확인 필요'
  //   last4·buyer는 둘 중 하나만 들어간다(고른 구매자가 있으면 last4 없음)
  //   time은 말한 그대로('2:15') — 화면이 손 입력 문자찜과 같은 읽기(ORD-08 AC6·D-089)로 receivedAt을 만든다
  // 문제 카드·넣을 수 없는 상품·이미 넣은/닫은 카드는 ok:false. 고르기 카드는 buyer가 후보 중 하나여야 한다
chooseSmsBuyer(card, candidates): SmsCard     // 409 BUYER_AMBIGUOUS 받음 → OPEN·autoAt null·candidates
reopenSmsCard(card) / closeSmsCard(card) / touchSmsCard(card) / stopSmsAuto(card)
findSmsRepeat(cards, reading, now): SmsCard|null   // 10초 안(차이 ≤ 10,000ms) 같은 주문·같은 구매자 말·같은 문제 → 그 카드
markSmsRepeat(card)                                 // repeats + 1 → 화면이 SMS_REPEAT_NOTE를 보인다
pruneSmsCards(cards, now)                           // 10초 지난 닫힌·넣은 문자찜 카드 빼기(열린 카드·상품 카드는 그대로)
addVoiceCard(cards, card) / openVoiceCardCount(cards)  // 열린 카드 수 규칙: 상품·문자찜 함께, 손댄 카드·고르기 카드는 닫지 않음
smsProductBlock(view) / findSmsBlock(card, lookup)   // SmsProductView = { state: 'READY'|'OPEN'|'HOLD'|'SOLD'|'CLOSED', waitlistFull }
```
- **중요(같은 말 막기)**: 넣었거나 닫은 문자찜 카드도 10초 동안은 목록(또는 따로 된 최근 목록)에 들고 있어야 `findSmsRepeat`가 찾는다. 지금 컨트롤러의 `.filter(isOpen)`을 문자찜 카드에 그대로 쓰면 닫자마자 잊는다 — `pruneSmsCards`로 10초 뒤에 빼면 된다.
- `addCard`(상품 카드만)는 그대로다. 두 종류를 한 목록에 두면 `addVoiceCard`를 쓴다.

### 4. 화면 문장 (acceptance 따옴표 그대로)
- `SMS_PROBLEM_MESSAGES[problem]`: 번호·끝자리·이름·시각·옵션·취소 이유(AC-V1-23 그대로)
- `smsBlockMessage(no, block)`: "300번 상품이 없어요." / "300번은 지금 판매 중이 아니에요." / "300번은 대기까지 다 찼어요."
- `describeSmsCard(card, { productName? })`: "165번 · 끝자리 1234 · 문자찜", "165번 · 김민지님 · 문자찜", "165번 · 손님 확인 필요 · 문자찜", "15번 · 28번 · 끝자리 1234 · 문자찜 — 넣을까요?", "… · 문자찜 · 받은 시각 2:15", 옵션 방식은 `productName`을 넘기면 "21번 반바지 M 2개 · 끝자리 1234 · 문자찜"(옵션이 있거나 수량이 1이 아니면 "N개"). 번호 방식은 `productName`을 넘기지 않는다.
- `smsCountdownText(card, now)`: "3초 뒤 넣어요"(남은 초 올림, 0 이하면 "곧 넣어요")
- `smsChooseMessage(last4)`: "끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요." (서버 409 `message`와 같은 문장)
- `SMS_REPEAT_NOTE` "같은 말을 한 번 더 들었어요", `SMS_TIME_CHECK` "받은 시각이 지금보다 늦어요. 그래도 넣을까요?", `SMS_LISTENING` "문자찜도 듣는 중", `SMS_LABELS`(문자찜도 듣기·문자찜 자동으로 넣기까지(초)·넣지 않기·지금 넣기·넣기·닫기·찜 취소하기)
- 카드 글(이름 포함)은 말한 그대로다 — 화면이 글자로만 그려야 한다(AC-V1-30).

### 5. 정확도 측정 (AC-V1-05)
- `pnpm --filter @livejjim/voice accuracy packages/voice/samples/accuracy-example-sms.csv` — 문자찜 예시(문자찜 12행 `예시-문자찜-01`…, 등록 3행).
- CSV 선택 열 `종류`·`기대 끝자리`·`기대 이름`(기본 다섯 열 뒤, 아무 순서, 0~3개). 문자찜 줄의 `기대 번호`는 띄어 여러 개("15 28").

### 서버에 바라는 것 (dev-server 몫 — 패키지는 정하지 않음, acceptance B 그대로)
- 화면은 `SmsWrite` 하나마다 `POST /api/events` `sms` 한 번: `no`·(`options`·`qty`)·(`receivedAt`)·(`memo`)·(`last4` 또는 `buyer`)·방송·요청 번호(주문마다 다름).
- 409 본문 `{ error: 'BUYER_AMBIGUOUS', message, candidates: [{ buyer, display, phoneLast4 }] }` → 화면이 `chooseSmsBuyer(card, candidates)`.

## dev-device 정한 것 (스펙이 정하지 않은 세부 — 판매자에게 안전한 쪽)
1. **문자찜 예시 표본은 새 파일**(`samples/accuracy-example-sms.csv`)에 넣었다. acceptance는 "예시 표본에 10행 이상을 더한다"이고 같은 줄에 "기존 예시 파일·시험은 그대로 통과"도 요구한다 — 기존 예시(20행·요약 수를 고정한 AC-I4-03 시험)에 행을 더하면 그 시험이 깨진다. 기존 표는 그대로, 문자찜 예시를 따로 둔다.
2. 같은 말 비교 키에 `problem`도 넣었다(문제 카드끼리는 같은 문제일 때만 하나로). 문제 카드는 주문이 비어 있어(R-21) 번호로 가를 수 없고, 다른 이유를 하나로 합치면 판매자가 두 번째 이유를 못 본다. 넣지 않는 카드라 찜 수에는 영향이 없다.
3. 시각: `H시`만 말하면 `H:00`, `초`는 `분`을 숫자로 말했을 때만(`반` 뒤의 초는 읽지 않는다 — R-21 6 "분이 있을 때만"을 글자 그대로).
4. 이름: `님`으로 끝나는 읽는 모양이 여럿이면 처음 것(토큰 그대로 → 짧은 끝말부터) 하나만 본다.
5. 고르기 카드(409 후보)는 열린 카드가 넘쳐도 닫지 않는다 — 판매자가 넣으려던 찜을 말없이 잃지 않게(손댄 카드와 같은 대우). 기다리는 카드는 acceptance대로 닫힐 수 있다.
6. 음성을 끄면 기다리던 문자찜 카드의 기다림은 멈추고 다시 켜도 저절로 넣지 않는다(상품 카드 `#becomeOff`와 같다 — 누르면 넣는다).
7. 정확도 보고서의 "다른 번호·끝자리로 저절로 넣을 문장"에 **등록 줄인데 저절로 넣을 문자찜으로 읽힌 문장**도 센다(문자찜이 아닌 말이 찜이 되는 것은 늘 기대와 다른 넣기). 시각은 측정에서 보지 않는다(지금 시각이 없다 — 보수적으로 저절로 넣는 쪽으로 센다).
8. `voice` 패키지에 devDependency `yaml 2.9.1`(코어와 같은 버전, 잠금 파일에 이미 있음)을 더했다 — `voice-extract.yaml` 81사례가 새 입구에서도 그대로인지(AC-V1-02) 읽으려고.

## dev-server — `POST /api/events` `sms`의 `last4` (AC-V1-10~12)

### 요청
- `sms` 본문에 선택 칸 `last4`(반각 숫자 정확히 4개 글). 받은 시각 칸 이름은 지금과 같은 `received`('HH:MM' 또는 'HH:MM:SS', KST) — acceptance의 "receivedAt"은 이 칸이다.
- `last4`가 숫자 4개 글이 아니면(전각 `１２３４`·`123`·`12345`·`12a4`·숫자형 1234·null·빈 글) 400 `INVALID_INPUT`, `problems: [{ field: 'last4', message: '끝자리는 숫자 네 개로 적어 주세요.' }]`.
- `last4`와 `phone`, 또는 `last4`와 `buyer`를 함께 보내면 400 `INVALID_INPUT`, `problems: [{ field: 'last4', message: '끝자리·전화번호·구매자 중 하나만 보내 주세요.' }]`.
- 메모·옵션·수량·받은 시각·방송 검사는 손 입력과 같은 코어 checkEvent(메모의 휴대폰 번호 D-079 포함).

### 서버가 정하는 것 (기록 경로의 범위 줄 안, 쓰기 직전 그 범위 상태)
- 코어 `listBuyers`에서 `kind === 'sms'`이고 `phoneLast4 === last4`인 구매자의 `current`(지금의 구매자)를 모은다(같은 사람은 하나 — 합친 구매자, 유튜브 구매자에 합친 문자 구매자면 그 유튜브 구매자).
  - 한 사람 → `buyer = 그 지금의 구매자`인 `sms` 이벤트(`phoneKey`·`phoneLast4` 없음). 응답 `phoneLast4`는 그래서 `null`이다 — 결과 카드의 끝자리는 화면이 카드의 `last4`로 보인다.
  - 없음 → `phoneKey = HMAC-SHA256(판매자 키, 'livejjim/sms-last4/v1|<날짜>|<live|rehearsal>|<last4>')`, `phoneLast4 = last4`인 `sms` 이벤트 → 새 문자 구매자 `sms:<ref>`. 영문 머리가 있어 숫자만인 정규화 전화번호의 키와 겹칠 수 없고, 날짜·리허설 여부가 글에 있어 다른 범위·지난 구매(BUY-05)와 이어지지 않는다. 판매자 키가 달라 다른 판매자와도 다르다.
  - 둘 이상 → 기록하지 않고 409.
- 판정은 코어 그대로(서버는 구매자 칸만 정한다).

### 409 본문 — 기존 API 오류 모양 그대로 (disputesWithSpec에 올림)
```json
{ "error": { "code": "BUYER_AMBIGUOUS", "message": "끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요." },
  "candidates": [{ "buyer": "sms:abc", "display": "문자찜(김씨)", "phoneLast4": "1234" }, …] }
```
- acceptance는 `{ error: 'BUYER_AMBIGUOUS', message, candidates }`로 적었지만 서버의 모든 오류 본문은 `{ error: { code, message }, ...extra }`(errors.ts `apiError`, AC-S00-41)이고 화면의 `errorFromBody`가 이 모양만 읽는다. 그래서 code·message는 `error` 안, `candidates`는 그 밖(화면에서는 `ApiError.details.candidates`)에 둔다.
- 후보 순서 = 지금의 구매자가 처음 생긴 순서. 후보에는 구매자 ID·표시 이름·뒤 4자리만(키·전화번호 없음).
- 409는 기록이 없으므로 같은 요청 번호로 다시 보내면 다시 판단한다(상태가 같으면 다시 409). 고른 뒤에는 같은 요청 번호로 `buyer`를 보내도 되고, 새 요청 번호여도 된다.

### 로그
- `last4`·이름 메모·키·요청 본문은 로그에 없다(로그 기록 함수는 자유 문장을 받지 않는다, log.ts). 시험: `apps/server/test/v1-sms-last4.test.ts` AC-V1-12.

### dev-web에게 (서버 몫 끝, 재시작 뒤 다시 확인함)
- 409는 `ApiError`로 온다: `code === 'BUYER_AMBIGUOUS'`, `message`는 `smsChooseMessage(last4)`와 같은 문장, 후보는 `error.details.candidates`(`{ buyer, display, phoneLast4 }[]`) → `chooseSmsBuyer(card, candidates)`. `retryable`·`transient`가 아니라 저절로 다시 보내지 않는다.
- 고른 뒤 쓰기는 `last4` 없이 `buyer`만(둘을 함께 보내면 400). 받은 시각 칸 이름은 `received`(KST 'HH:MM' 또는 'HH:MM:SS').
- 한 사람으로 이어진 경우 응답 `phoneLast4`는 `null` — 결과 카드의 "끝자리 1234"는 카드의 `last4`로 그린다. 이미 1등이면 지금처럼 D-099 응답(`buyer`)으로 "이미 찜한 구매자라…".
- 확인: `apps/server` 시험 1776개 중 1775 통과. 남은 1개(`test/time.test.ts` 시간대)는 `pnpm --filter … exec vitest`로 돌려 `TZ`가 없어서이고 `TZ=Pacific/Honolulu`로는 통과(verify 단계는 TZ를 붙인다). tsc·eslint(apps/server) 깨끗.
