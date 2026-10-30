# SRV1 개발 노트

## dev-server

### 서버 읽기 입구 (약속 1 — acceptance 그대로)
- `POST /api/broadcasts/:id/read` 본문 `{ kind, text }` — kind `quick`·`fix`·`price`·`money`·`received`·`phone`. 그 방송(로그인한 판매자 것만, 아니면 404)의 설정 스냅샷(`price.unit`·`claim.maxNumber`)과 지금 상품으로 읽는다.
  - `fix`만 `text`가 세 칸 객체 `{ no, name, price }`(글). 나머지는 글 하나.
- `POST /api/read` 본문 `{ kind, text }` — 방송과 무관한 칸(`money`·`received`·`phone`)만. `quick`·`fix`·`price`는 400(방송 입구를 쓴다). 정산·설정·문자찜 화면용.
- 문: 쓰기와 같다 — Origin 403, JSON 415/400, 64KB 413, 세션 401. 글 한 칸 2,000자 넘으면 400. 모르는 키는 400 `UNKNOWN_FIELD`.
- 보조자: `received`·`phone`만(그 밖 403), 리허설 방송은 403.
- 응답 `{ read: … }` (모양: `packages/voice-session/src/read/index.ts` `ReadResult`)
  - `quick`: `{ kind, decision: 'none'|'register'|'edit'|'open'|'fix', no, name, price, priceWords, productId, closed, question, error, message, focus, noText, priceText, preview, previewNo }`
    - `preview` = "등록하면: 15번 핑크프릴 20,000원"(register일 때만), `previewNo` = 번호 찾기 미리 보기(PRD-03 AC3), `question` = edit의 "15번이 이미 있어요. 고칠까요?"
    - fix: `error`(PRICE_MISSING·PRICE_TOO_LOW·NUMBER_MISSING·NUMBER_INVALID)·`message`(지금 화면 문장)·`focus`(no·price)·`noText`·`priceText`(번호 오류 때 칸 채우기)
  - `fix`: quick과 같은 결정 칸 + `pricePreview`("= 15,000원")
  - `price`: `{ amount, words, preview }` (그 방송 가격 단위)
  - `money`: `{ empty, amount, words, message }` (원 단위, 읽지 못하면 "금액을 14000처럼 적어 주세요.") — 범위(입금 1~1억 등)는 화면 상수 그대로 화면이 숫자로 본다(막기만)
  - `received`: `{ state: 'empty'|'invalid'|'ok', value('15:10'), minute, time(ISO), day('어제'|'오늘'|'내일'), late, words('오늘 15:10'), message }` — 서버 시계 기준(옮기기 전 readReceived와 같은 규칙)
  - `phone`: `{ empty, valid, last4, hasPhone, message }` — 정리한 번호는 돌려주지 않는다. `hasPhone` = 글 안에 전화번호(메모·사유 칸 미리 검사용), `message` = 읽지 못한 전화번호 문장
- 저장·로그·이벤트 없음(AC-SRV1-03 시험).

### 원문 쓰기 (약속 2) — `POST /api/events`에 원문 필드
엔진 필드가 아니고 기록 경로의 build 안(범위 락·최신 상태)에서 읽기 입구와 같은 함수로 읽는다. 원문은 이벤트에 들어가지 않는다. 같은 칸을 원문과 숫자로 함께 보내면 400.
- `product.register` / `product.update`
  - 한 줄: `{ type, b, text: '15 핑크프릴 20', requestId }` (`name`·`no`·`price`와 함께 보내지 않는다)
  - 고치기 칸: `{ type, b, noText, name, priceText, requestId }` (`noText`·`priceText`는 함께)
  - 거절: 읽지 못함 400 `QUICK_FIX`(문장 = 지금 화면 문장, 본문 `read`에 칸 채우기), 등록하려는 번호가 이미 있음 409 `QUICK_EXISTS`(message = "15번이 이미 있어요. 고칠까요?" / 판매 종료면 "다시 팔까요?", `read`), 번호만 쳤고 상품이 있음 409 `QUICK_OPEN`(`read.productId`). 기록 없음.
  - "고칠까요?" 뒤에는 `product.update`에 같은 원문(`text`)을 새 요청 번호로. 줄에 품종이 없으면 품종은 그대로(웹 changedFields와 같다).
- `sms`: `noText`(번호 칸), `receivedText`(받은 시각 칸, 비우면 서버 도착 시각). `phone`·`memo`는 원래 원문. 메모의 전화번호는 지금처럼 400(`memo`, PHONE_NUMBER 문장).
  - 읽지 못한 전화번호는 쓰기에서 거절하지 않는다 — AC-S04-31 그대로(키·뒤 4자리 없이 기록, 응답 `phoneLast4: null`). 화면이 보내기 전에 막던 것은 읽기 입구 `phone`의 `valid:false`·`message`("휴대폰 번호로 읽지 못했어요. 고치거나 지워 주세요.")로 막는다(서버 값으로 막기만).
- `settlement.payment`·`refund`·`shippingOverride`: `amountText`. `settlement.adjust`: `amountText` + `amountSign: 'PLUS'|'MINUS'`.
- 설정 `PATCH /api/settings`: `shipping.baseFee`·`shipping.freeThreshold`는 글도 받는다("4천" → 4,000원).
- 기존 숫자 필드 요청도 이번 판 동안 그대로 받는다.

### 문자찜 번호 한도
- 안드로이드에서 범위 밖 보류 찜(전화번호가 붙은 긴 숫자)이 기록되던 것: 코어 `validate.ts`는 sms `no`를 1 이상만 본다. 서버 기록 경로(build 안)에서 그 방송 스냅샷의 `claim.maxNumber`로 막는다 — 숫자 `no`·`noText`·음성 문자찜 모두. 문장 "번호는 1부터 N까지예요. 번호를 확인해 주세요." 400, 기록 없음.
- dev-core 몫 제안: 코어 checkEvent도 sms `no`를 방송 스냅샷 한도로 보면 서버 밖 경로(재생·가져오기)까지 막힌다. 판정 엔진 영역이라 손대지 않았다.

### 채팅 이름 언급 (약속 5)
- 옵션 방송 채팅 항목에 새 칸 `nameMentions: number[]` — 상품 이름·별칭 언급 번호(옛 웹 `optionLook`과 같은 비교: 그 방송 상품 전부(판매 종료 포함), `compareChars` 두 글자 이상, 글 안 포함). 번호 언급 `mentions`는 지금 그대로(AC-O2-24). 번호 방송 항목에는 칸이 없다(옛 optionLook도 옵션 방송만).
  - 웹 `optionLook`: `named` = `products.filter(p => message.nameMentions.includes(p.no))`, `mention` = `… (message.mentions.length > 0 || (message.nameMentions?.length ?? 0) > 0)`. 증분 조회(`/changes`의 messages)·SSE도 같은 항목 모양이다.

### 확장은 원문만 (AC-SRV1-14)
- 유튜브 `/ext/chats`·틱톡 `/ext/tiktok/chats` 항목의 모르는 칸(`claimNo`·`no`·`claims` 같은 읽은 필드)은 지금도 400 `UNKNOWN_FIELD`·기록 0 — 서버 코드는 바꾸지 않았고 시험으로 지킨다(srv1-read).
- 같은 채팅을 공식 수집(`ingestYoutubeBatch`)과 확장으로 넣으면 찜(번호·상태·출처·가격·구매자 순서·취소 요청)과 채팅 항목(주문·취소·언급)이 같다 — 시험으로 지킨다.

### 읽기 함수 같은 결과 (AC-SRV1-01·07)
- 웹 `test/quick.test.ts`·`test/received.test.ts`를 `packages/voice-session/test/read/`로 같은 기대값으로 복사(웹 화면 몫 `changedFields`만 뺌 — 서버 원문 고치기의 같은 규칙은 srv1-read). 웹이 `lib/quick.ts`·`lib/received.ts`를 지울 때 웹 쪽 시험은 함께 지워도 된다.
- `read-text.test.ts`: 입구 함수 `readText` 칸마다 응답 모양.

### 음성 흐름 (약속 4)
- 기기가 보낸 받아쓴 글(`op: 'chromeResult'`)은 어느 연결이든 읽지 않고 `{ type: 'voice.error', code: 'UNSUPPORTED', message }`만 보낸다(연결은 유지, 쓰기 0).
- 조작 전용 연결의 새 인자: `capture=false` (일꾼을 잡지 않음). 옛 `mode=chrome`도 같은 조작 전용으로 받는다(기기가 옮길 때까지).
- `voice.effect.source`: `capture=false` 연결은 `'control'`, 옛 `mode=chrome` 연결은 지금처럼 `'chrome'`. 기기가 `source !== 'chrome'`으로 말 끝 시각 검사를 건너뛰던 곳(웹 `voice/remote.ts`, 앱 `lib/voice-session.ts`)은 `'control'`도 같이 건너뛰어야 한다.

### 음성 읽기 코드 자리 (AC-SRV1-15)
- `VoiceController`와 그것만 쓰는 도우미를 서버 전용 패키지로 복사: `packages/voice-session/src/controller/`(controller·instant·archive-model·rules(= 웹 lib/voice.ts)), 빠른 입력·받은 시각 읽기는 `packages/voice-session/src/read/`. 서버 음성 흐름(`server.ts`·`resume.ts`)과 `apps/server/src/voice/reading.ts`는 새 자리만 부른다(웹 `lib/quick.ts`·`lib/received.ts`·`lib/voice.ts`·`voice/controller.ts`를 더는 부르지 않음).
- 웹 쪽 `apps/web/src/voice/controller.ts`·`lib/quick.ts`·`lib/received.ts`는 남겨 뒀다(웹 몫으로 지움). 웹의 컨트롤러 시험 15개를 `packages/voice-session/test/controller/`로 복사해 서버 자리를 같은 기대값으로 돌린다 — 웹이 클래스를 지울 때 웹 쪽 사본은 함께 지워도 된다.
- 서버는 아직 웹 `lib/scope-data.ts`·`lib/derive.ts`·`api/types.ts`(표시·자료 모양, 남김 목록)를 부른다.
- 바꾼 기존 서버 시험: `i3-accounts`(보조자 허용 목록에 읽기 입구 둘), `print-rules` AC-I1-11(번호 10000 문자찜은 API가 막으므로 옛 기록과 같은 이벤트를 기록 경로로 바로 씀 — 라벨 오류 단언은 그대로).
- `packages/voice-session/test/server.test.ts`의 크롬 입력(`chromeResult`)은 일꾼 최종 글(`onResult`)로 바꿨다 — 단언은 그대로. `apps/server/test/app1-relay.test.ts`의 "크롬 최종 글도 등록 효과가 된다"는 스펙이 없앤 길이라 AC-SRV1-12(거절·쓰기 0·조작 전용 연결 그대로)로 바꾸고, 글이 DB·로그에 없다는 단언은 일꾼 결과 시험으로 옮겼다(D-APP-25 (3)).
