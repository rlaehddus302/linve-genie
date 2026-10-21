# O2 개발 노트

작업 폴더 `/Users/unhoyeo/livejjim-wt/o2`, 브랜치 `track/o2-options-ui`, BASE 06ef423, 스펙 커밋 172725f. 순서: server(이 절) → web.

## dev-server

### 만든 것 (`apps/server`)

| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/api-fields.ts` | 쓰기 API 칸: `product.register`·`product.update`에 `aliases`·`options`·`stocks`, `sms`에 `qty`·`options`, `host.assign`에 `qty`·`options`, 찜을 가리키는 조치(`host.cancel`·`reject`·`promote`·`confirm`·`approveCancel`·`dismissCancel`·`reopen`)에 `options`, 새 종류 `product.focus`·`host.resolveReview`·`host.dismissReview` | AC-O2-11·14·16·17·21·31·40·42·43·44 |
| `src/messages-options.ts` | 옵션 입력 오류(코어 `checkEvent` 문제) → 판매자 문장 (D-O2-13). 번호 방송인지는 그 범위 상태의 방송 설정으로 본다 | AC-O2-18 |
| `src/messages.ts`·`src/writer.ts` | `easyProblems(problems, event, state)` — 기록 경로가 지금 상태를 넘겨 옵션 문장을 고른다. 휴대폰 번호 문제는 지금 문장 그대로 | AC-O2-18 |
| `src/service.ts` | 방송 만들기 `saleMode`(`withSaleMode`), 설정 저장이 저장된 값과 합친 뒤 검사(옵션 + 실제 시각순), 옵션 방송 채팅 항목의 `optionOrders`·`review` | AC-O2-03·05·24 |
| `src/reviews.ts`·`src/store.ts` | `GET /api/reviews` (옵션 방송이 있는 범위만 읽는다 — `optionScopes`, 출처 입력 본문 `eventBodiesAt`) | AC-O2-30 |
| `src/runtime.ts` | 바로잡기·지우기는 그 채팅 메시지를 "바뀐 메시지"로 남긴다(증분 조회가 그 메시지를 다시 준다) | AC-O2-32 |
| `src/roles.ts` | 보조자의 방송자 취소 확인이 변형을 본다(문자찜으로 생긴 그 변형 찜만) | AC-O2-31 (SYS-04 그대로) |
| `src/views.ts` | 메시지 기록에 찜 상세·남은 확인 필요 항목 | AC-O2-24 |
| `packages/core/test/golden/core-adapter.test.ts` | 실제 골든 합계 교체: 파일 34 · 파서 596 · 엔진 148 · 통과 744 (O1 코어를 합친 뒤 통과) | AC-O2-62 |

단위 시험: `apps/server/test/o2-options.test.ts`(19), `apps/server/test/o2-option-messages.test.ts`(23). `apps/server/test/api.test.ts`의 쓰기 종류 수를 6·12 → 7·14로 바꿨다(O2가 연 세 종류 — 교체, 약화 아님).

### 화면에게 (AC-O2-61 — 계약)

엔진 조회·이벤트 모양의 정본은 `harness/sprints/O1/dev-notes.md` "O2·O3에게"다. 아래는 서버가 새로 열거나 바꾼 것이다.

#### 1. 설정 `PATCH /api/settings` (AC-O2-02·03)

- 판매 방식은 키 하나 `claim.parseMode`: `STRICT`·`LOOSE`(번호로만 받기) / `OPTIONS`(상품명·옵션도 받기).
- "상품명·옵션도 받기"를 저장할 때는 `{ settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }`로 **함께** 보낸다. `OPTIONS`만 보냈는데 저장된 값이 `RECEIVED_TIME`이면 400이다.
- 400 문제: `{ field: 'settings.contention.policy', message: '상품명·옵션도 받는 방송은 들어온 순서로만 판정해요' }`, 수량 상한 `{ field: 'settings.claim.maxQuantity', message: '1부터 99까지의 정수로 적어 주세요' }`. 설정은 바뀌지 않는다.
- "번호로만 받기"로 되돌리면 `{ 'claim.parseMode': 'STRICT' }`.

#### 2. 방송 만들기 `POST /api/broadcasts` (AC-O2-05, D-O2-02)

- 새 선택 칸 `saleMode`: `'NUMBERS'` | `'OPTIONS'`. 없으면 설정 그대로.
  - `OPTIONS` → 그 방송 스냅샷 `claim.parseMode=OPTIONS`·`contention.policy=ARRIVAL`.
  - `NUMBERS` → 설정이 `OPTIONS`일 때만 `STRICT`, 아니면 설정 그대로.
  - 판매자 설정은 바뀌지 않는다.
- 다른 값이면 400 `{ field: 'saleMode', message: '판매 방식은 "번호로만 받기"나 "상품명·옵션도 받기" 중에서 골라 주세요.' }`, 아무것도 기록하지 않는다.
- 방송이 옵션 방송인지는 범위 조회 `broadcasts[].settings['claim.parseMode'] === 'OPTIONS'`로 안다.

#### 3. 이벤트 쓰기 `POST /api/events` — 새·바뀐 칸

모든 칸은 옵션 방송에서만 쓴다. 번호 방송에 보내면 400이고 기록하지 않는다. 응답은 지금 그대로 `{ date, rehearsal, seq, type, changed, effects, … }`이다.

| 종류 | 요청 칸 |
|---|---|
| `product.register` | 지금 칸 + `aliases?: string[]`, `options?: { name, choices: { label, aliases?, price? }[] }[]`, `stocks?: Record<옵션 글, 정수 ≥0>` (옵션 글 = label을 항목 순서대로 `/`로, 예 `흰색/대형`. 적지 않은 변형은 `stock`(기본 1)) |
| `product.update` | 지금 칸 + 같은 세 칸 (`options`는 바꾼 뒤 **전체**). 찜이 있으면 선택지 더하기(항목 끝)·가격 차이·별칭·변형 재고만 반영된다. 막힌 바꾸기는 오류가 아니라 **`changed: false`** → 화면은 "바뀐 것이 없어요" |
| `product.focus` (새) | `b`, `no` — 지금 상품. 화면은 5초 대기 없이 바로 보낸다. 같은 상품이면 `changed: false`. 일시 중지·판매 종료 상품을 가리키면 지금 상품을 없앤다 |
| `sms` | 지금 칸 + `qty?`(1~`claim.maxQuantity`), `options?: { [항목]: label }` (옵션 상품이면 모든 항목 필수, 상품이 없으면 적지 않는다) |
| `host.assign` | 지금 칸 + `qty?`, `options?` (옵션 상품이면 필수) |
| `host.cancel`·`reject`·`promote`·`confirm`·`approveCancel`·`dismissCancel`·`reopen` | 지금 칸 + `options?` (그 찜의 변형. 적지 않으면 그 구매자의 활성 찜이 하나뿐일 때만) |
| `host.resolveReview` (새) | `b`, `item`(항목의 `item` 그대로 — 메시지 ID 또는 `sms:<ref>`), `no`, `qty`, `options?`, `reason?` |
| `host.dismissReview` (새) | `b`, `item`, `reason?` |

- 요청 ID 중복 방지는 지금 그대로다. 같은 `requestId`면 처음 결과를 돌려주고 다시 기록하지 않는다.
- 바로잡기 결과 판단(AC-O2-35·36·38): 응답 `changed`.
  - `true`면 범위 조회로 그 구매자의 새 찜을 보고 "1등"·"대기 n번"·"품절"을 정한다.
  - `false`면 줄이 남는다. 까닭은 화면이 상태로 정한다(D-O2-07):
    - 상품 상태가 `OPEN`·`SOLD`가 아님(판매 중 아님)
    - 그 변형에 그 구매자의 활성 찜이 있음
    - 수량이 남은 수량보다 큼
- 여러 줄은 원래 순서(목록 순서)로 하나씩 보낸다. 서버 묶음 API는 없다.
- 문자찜 결과(AC-O2-40): 응답은 지금 모양 그대로다(`seq`·`buyer`·`phoneLast4`). 찜이 생겼는지는 범위 조회의 `claims`에서 `origin === 'sms' && seq === 응답 seq`인 찜으로 본다. 그런 찜이 없고 `GET /api/reviews?broadcast=`에 `seq === 응답 seq`인 항목이 있으면 "찜이 생기지 않았어요 — 확인 필요로 보냈어요"다. 확인 필요 항목의 `seq`는 그 문자찜 이벤트의 seq다.
- 보조자(ASSISTANT): 지금처럼 `sms`·`host.cancel`만 쓴다. `product.focus`·바로잡기·지우기·`GET /api/reviews`는 403이다. 보조자의 `host.cancel`은 문자찜으로 생긴 **그 변형** 찜일 때만 된다.

#### 4. 입력 오류 문장 (D-O2-13) — 400 `{ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field, message }] } }`

`field`는 칸 경로(`options`, `options[0].name`, `options[0].choices[1].label`, `options[0].choices[1].aliases[0]`, `options[0].choices[1].price`, `options[0].choices`, `aliases`, `aliases[2]`, `stocks`, `qty`, `no`, `type`)다. 화면은 이 값으로 칸을 찾고, 판매자에게는 `message`만 보인다.

| 경우 | 문장 |
|---|---|
| 번호 방송에 옵션 칸·옵션 이벤트 | 이 방송은 번호로만 받기라 옵션을 쓸 수 없어요. |
| 이름·별칭 겹침 (비교 글자) | ‘{말}’이 두 군데 있어요. 한 상품 안에서 이름은 겹치면 안 돼요. (말에 휴대폰 번호 모양이 있으면 "같은 이름이 두 군데 있어요. …") |
| 빠졌거나 없는 선택지 | {항목}을(를) 골라 주세요. (여럿이면 `색상·크기을(를) 골라 주세요.`) |
| 없는 변형의 재고 | 없는 옵션의 재고가 있어요. |
| 변형 재고 값 | 옵션별 재고는 0 이상의 정수로 적어 주세요. |
| 옵션 없는 상품의 변형 재고 | 옵션이 없는 상품에는 옵션별 재고를 쓰지 않아요. 재고 칸에 적어 주세요. |
| 수량 범위 | 수량은 1부터 {최대}까지예요. |
| 바로잡기 번호에 상품 없음 | 이 방송에 {번호}번 상품이 없어요. |
| 변형 단가 0 아래 | 가격 차이 때문에 값이 0원보다 작아지는 옵션이 있어요. |
| 상품이 없는 문자찜·배정의 옵션 | 상품을 먼저 등록해 주세요. |
| 옵션 없는 상품에 옵션 | 이 상품에는 옵션이 없어요. 옵션을 빼고 보내 주세요. |
| 항목 4개 이상 / 변형 101개 이상 | 옵션 항목은 3개까지예요. / 옵션 조합(변형)은 100개까지예요. 선택지를 줄여 주세요. |
| 항목 이름 | 항목 이름은 1~10자로, 줄바꿈 같은 특수 글자 없이 적어 주세요. |
| 선택지 수 / 선택지 이름·별칭 / 선택지 별칭 수 | 선택지는 항목마다 1~20개예요. / 선택지 이름·별칭은 1~20자로, ‘/’·‘#’ 없이 적어 주세요. / 선택지 별칭은 10개까지예요. |
| 가격 차이 | 가격 차이는 −1,000,000원부터 1,000,000원까지의 정수로 적어 주세요. |
| 상품 별칭 수 / 길이 | 상품 별칭은 10개까지예요. / 상품 별칭은 1~20자로 적어 주세요. |
| 휴대폰 번호 모양 | 전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요. (지금 문장 그대로) |

- 문장은 서버 `apps/server/src/messages-options.ts`의 `OPTION_MESSAGES`에 있다.
- 겹침 문장의 {말}은 판매자가 적은 글 그대로다. 화면은 늘 글자로(이스케이프) 보인다.

#### 5. 확인 필요 조회 `GET /api/reviews` (AC-O2-30, D-O2-14)

- 검색값
  - 기본은 실제 범위만이다. `?rehearsal=true`면 리허설 범위만 본다.
  - `?broadcast=<방송 ID>`면 그 방송만 본다. 다른 판매자의 방송·없는 방송이면 404다. 리허설인지가 다른 방송도 404다. 리허설 방송은 `&rehearsal=true`를 함께 적는다.
  - `?rehearsal=`에 다른 값을 적으면 400이다.
- 응답 `{ rehearsal, reviews, products, broadcasts, scopes }`
  - `reviews[]`: 원래 순서다(범위 날짜 순, 범위 안은 엔진 `listReviews` 순서).
    - 엔진 칸 `ReviewInfo`: `broadcast, item, buyer, currentBuyer, reason, product, no, options([항목, label][] | null), qty | null, seq, origin('chat'|'sms')`
    - `at`(ISO)
    - 서버가 붙인 칸: `date, rehearsal, broadcastDate, broadcastTitle, buyerName, text, received, phoneLast4`
      - `text`: 채팅이면 댓글 글, 문자찜이면 메모(없으면 null)
      - `received`: 문자찜의 받은 시각 글
      - `phoneLast4`: 문자찜만
      - 전화번호 원문·키는 없다.
  - `products[]`: 항목이 있는 방송의 상품 전부다. 방송을 골랐으면 그 방송의 상품이다. 코어 `ProductInfo` 그대로이고 `variants[].remaining`을 쓴다.
  - `broadcasts[]`: 그 방송들의 코어 `getBroadcast` 결과다(`focus`·`settings` 포함).
  - `scopes[]`: `{ date, rehearsal, seq }`.
- 번호 방송만 있는 판매자면 모든 목록이 비어 있다. 홈의 "확인 필요 n건"은 `reviews.length`다(항목이 없으면 링크 없음).
- 실시간 갱신: 새 SSE 이름은 없다.
  - 지금 `event: change`(`{ date, rehearsal, seq, type }`)가 확인 필요가 바뀌는 모든 기록 뒤에 온다. 종류는 `chat`·`sms`·`host.resolveReview`·`host.dismissReview`·`product.*`·`buyer.merge` 등이다.
  - `/reviews`·콘솔 알림 띠는 옵션 방송 범위의 `change`를 받으면 `GET /api/reviews`를 다시 읽는다(짧게 모아서).
  - 범위 조회·증분 조회(`/api/days/:date`)에는 확인 필요 목록이 **없다**. 지금 항목 모양을 그대로 둔다.

#### 6. 지금 상품 (AC-O2-20~22)

- 범위 조회·증분 조회의 `broadcasts[].focus`: `{ product, no, productId, at(ISO) } | null`.
- 일시 중지·판매 종료하면 코어가 지우므로 `null`이 증분으로 온다.
- 15초 안내는 `at`과 지금 시각으로 정한다(코어 `FOCUS_GRACE_SEC` = 15).
- 상품을 공개(판매 중)로 등록하면 코어가 그 상품을 지금 상품으로 정한다(별도 `product.focus` 없음).

#### 7. 채팅 메시지 항목 (AC-O2-24) — `GET /api/days/:date/messages`, 증분 조회 `messages`

**옵션 방송의 메시지에만** 두 칸이 더 있다. 번호 방송의 메시지 항목은 지금 모양 그대로다(키가 없다).

- `optionOrders: { claim, no, variant(옵션 글 | null), qty }[]` — 그 메시지로 생긴 찜이다(받을 때 엔진이 정한 것, 바로잡은 찜 포함). 화면 문구는 "주문 21번 M"·"주문 21번 L ×2"(수량 1은 `×1`을 쓰지 않는다).
- `review: { reason, no, options, qty } | null` — 그 메시지의 **남은** 확인 필요 항목이다. 지우거나 바로잡으면 `null`이 되고, 증분 조회가 그 메시지를 다시 준다.
- `orders`는 `optionOrders`의 번호다. `cancels`·`mentions`는 코어 `parseOptionComment`로 다시 읽은 번호다.
- `mentions`는 **번호 언급만**이다. 상품 이름만 쓴 잡담(`반바지 예뻐요 너무`)은 `mentions: []`, `order: false`, `review: null`이다. 아래 "스펙 이의" 1을 본다.

### 스펙 이의·스스로 정한 경계

1. **AC-O2-24 "언급"** — `반바지 예뻐요 너무`가 "언급"이어야 한다고 적혀 있다.
   - 코어 `parseOptionComment`의 `mentions`는 번호 언급뿐이다(상품 이름 언급을 돌려주지 않는다).
   - 서버는 판정·인식을 복제하지 않으므로 이 메시지의 `mentions`는 빈 목록이다.
   - 화면은 옵션 방송에서 주문·취소·확인 필요·무시가 아닌 메시지를 "언급"으로 보이면 된다. 코어 산출 없이 할 수 있다.
   - 옵션 방송 메시지에 "찜으로 바꾸기"를 보일지는 화면 몫이다. `host.convertMessage`에는 `options` 칸이 없어 옵션 상품으로는 바꿀 수 없다.
   - 코어가 상품 이름 언급을 돌려줘야 한다면 코어(O1 후속)의 일이다.
2. `GET /api/reviews`는 옵션 방송(시작 이벤트의 설정 스냅샷 `OPTIONS`)이 있는 범위만 읽고, 공용 범위 캐시에 넣지 않는다(`readDetached`). 지난 날짜가 지금 방송의 캐시를 밀어내지 않게 하려는 것이다.
3. 확인 필요 목록을 범위 조회(`/api/days/:date`)에 넣지 않았다. 기존 항목 모양·증분 조회 계약(S05)과 그 시험을 바꾸지 않으려는 것이다. 화면은 `GET /api/reviews?broadcast=`를 쓴다.
4. 설정 저장은 저장된 값과 합친 뒤 다시 검사하고, 합친 값의 문제를 그 칸의 문장으로 돌려준다. 이전에는 "판매 규칙 설정을 확인해 주세요." 한 줄이었다.

### test-domain에게

- 서버 API 적대 재료(AC-O2-63)
  - 위 표 3·4·5의 경로
  - `saleMode`
  - 보조자 403
  - 같은 요청 ID 재전송: `requestId`가 같으면 처음 결과다.
  - 이미 지운 항목 바로잡기: `changed: false`로 기록된다.
- 문장 상수: `import { OPTION_MESSAGES, SALE_MODE_MESSAGE } from '@livejjim/server'`. 응답 모양 타입은 `ReviewsView`·`ReviewItem`이다.

### 기동

- 단위: `TZ=Pacific/Honolulu npx vitest run apps/server/test/o2-options.test.ts apps/server/test/o2-option-messages.test.ts`
- E2E 서버는 지금 그대로다(`apps/server/src/e2e.ts`). 옵션 방송은 `POST /api/broadcasts { saleMode: 'OPTIONS' }`로 만든다. 포트는 `E2E_PORT_OFFSET=5500`이다.

## dev-web

### 만든 것 (`apps/web`)

| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/lib/options.ts` | "옵션 추가" 칸 값·치는 동안 검사(겹침은 두 자리 "‘m’이 사이즈 M과 사이즈 L에 함께 있어요", 한도·모양·가격 차이·변형 100개), 변형 재고 표(처음 값 1·단가·"없음(처음부터 품절)"), 요약 "옵션: 사이즈 S/M/L · 변형 3개", 확인 필요 미리 채움(읽은 것만 — 수량 빈 칸)·후보 제안(편집 거리 1, 3개까지)·바로잡기 결과 낱말 | AC-O2-11~15·33·34·36·38 |
| `src/lib/option-templates.ts` | 업종 템플릿 데이터(D-O2-04 표 그대로, 항목 하나씩) | AC-O2-12 |
| `src/lib/reviews.ts` | `useReviews` — `GET /api/reviews`, 같은 리허설 구분의 SSE `change`를 250ms 모아 다시 읽기, 403·404는 목록 없음 | AC-O2-25·32 |
| `src/lib/words.ts` | 확인 필요 사유 9개·`OPTION_MISSING` "옵션 빠짐"·판매 방식 낱말 | AC-O2-52 |
| `src/lib/derive.ts` | 변형 대기 순번(대기 n번)·찜의 옵션 글 " M ×2"·찜 조치의 `options` | AC-O2-43 |
| `RuleFields.tsx`·`SettingsPage.tsx`·`WizardPage.tsx` | "판매 방식" 칸(맨 위). 옵션이면 엄격/느슨 칸 없음·겨루기는 고를 수 없는 글 "먼저 들어온 순서(접수순)" + 안내. 마법사 2단계는 고르면 바로 저장 | AC-O2-01·02·04 |
| `HomePage.tsx` | 새 방송 시작 창의 "판매 방식"(처음 값 = 설정) + "이 판매 방식으로 리허설 시작", `saleMode` 보냄. "확인 필요 n건"(실제)·"리허설 확인 필요 n건" 링크 | AC-O2-05·25 |
| `ConsolePage.tsx`·`QuickInput.tsx`·`OptionDialog.tsx` | 옵션 방송만: 머리 "상품명·옵션도 받기", "옵션 추가" → 붙은 옵션 요약 → Enter 한 번에 `product.register`(options·stocks·aliases), 등록하면 비움 | AC-O2-06·10·11 |
| `ProductBoard.tsx` | 지금 상품 띠(24px, 15초 안내), "지금 상품으로"(바로 `product.focus`), 변형 줄, "1등 변형별"·"변형 3개 · 남은 1" | AC-O2-20~23 |
| `ProductDetail.tsx`·`ProductOptions.tsx` | 옵션·별칭 표시, 변형별 1등·대기 칸, "옵션 고치기"(찜 있으면 더하기·가격·재고·별칭만, `changed=false` → "바뀐 것이 없어요") | AC-O2-16·17 |
| `ChatPanel.tsx` | 옵션 방송 메시지: "주문 21번 L ×2"·"확인 필요 · 옵션 빠짐"·언급, "확인 필요에서 고르기", 확인 필요·옵션 상품 언급에는 "찜으로 바꾸기" 없음 | AC-O2-24 |
| `AlertStrip.tsx` | "확인 필요 n건"(이 방송의 확인 필요) → `/reviews?broadcast=` | AC-O2-25 |
| `ReviewsPage.tsx` | `/reviews` 확인 필요 목록 | AC-O2-33~39 |
| `SmsPage.tsx` | 옵션·수량 칸, "찜이 생기지 않았어요 — 확인 필요로 보냈어요" | AC-O2-40·41 |
| `ActionDialogs.tsx`·`AlertDialogs.tsx`·`actions.ts` | 직접 배정 옵션·수량, 변형을 정하지 않은 취소 요청 고르기, 찜 조치에 `options` | AC-O2-42~44 |
| `ImportDialog.tsx` | 옵션 방송의 가져오기 안내 한 줄 | D-O2-15 |

단위 시험: `test/o2-options-lib.test.ts`(16), `test/o2-screens.test.tsx`(21).

### test-e2e에게 (선택자·문장)

- 판매 방식: `radiogroup` 이름 "판매 방식", 라디오 "번호로만 받기 (다육 등 — 기본)"·"상품명·옵션도 받기 (의류·식품·케이스 등)". 설정은 판매 규칙 "저장"(칸 묶음 저장)으로 저장, 마법사 2단계는 고르면 바로 저장("저장했어요. …").
- 홈 "새 방송 시작" 창: 같은 "판매 방식" 칸 + "이 방송 시작하기"(실제)·"이 판매 방식으로 리허설 시작"(리허설). 홈의 링크 "확인 필요 n건"·"리허설 확인 필요 n건".
- 콘솔(옵션 방송만): 머리 글 "상품명·옵션도 받기", 버튼 "옵션 추가", 영역 `region` "지금 상품"(문장 "지금 상품: 21번 반바지"·"15초 동안 상품 이름 없는 댓글은 확인 필요로 모아요"·"지금 상품 없음 — 상품 이름을 쓴 댓글만 받아요"), 붙은 옵션 `group` "붙은 옵션"(버튼 "옵션 고치기"·"옵션 떼기").
- "옵션 추가" 창(`dialog` "옵션 추가"): 버튼 "항목 더하기"·"템플릿에서 고르기"(템플릿 버튼 이름 "화분 — 호수"·"휴대폰 케이스 — 기종" …)·"선택지 더하기". 칸 이름 `항목 1 이름`·`항목 1 선택지 2 이름`·`항목 1 선택지 2 별칭`·`항목 1 선택지 2 가격 차이`·`항목 1 선택지 여러 개`(+ 버튼 `항목 1 선택지 한 번에 더하기`)·`M 재고`(변형 옵션 글 + " 재고")·"모두 같은 수로"(+ "모두 바꾸기")·"상품 별칭 (쉼표로 나눠 적기, 10개까지)". 넣기 버튼 "옵션 넣기"(문제가 있으면 잠김). 상품 상세의 고치기 창 이름은 "21번 옵션 고치기", 저장 버튼 "옵션 저장".
- 상품 보드(옵션 방송): 버튼 `지금 상품으로 — 22번`, 이미 지금 상품이면 글 "지금 상품", `변형 3개 펼치기`(이름 `변형 펼치기 — 21번`) → `list` `변형 — 21번`. 이 버튼들의 이름은 "21번 "으로 시작하지 않는다(기존 `boardItem` 선택자 `/^21번 /`와 겹치지 않게).
- 상품 상세: 변형마다 `region` "M 변형"(그 안에 "M 1등"·"M 대기" 칸).
- 확인 필요 목록 `/reviews[?broadcast=<id>][&rehearsal=true]`: `list` "확인 필요 목록", 줄 `listitem` "1번째 줄"…, 줄 안 고르기 상자 `1번째 줄 고르기`, 고르기 칸 이름 "상품"·항목 이름("사이즈")·"수량"(`select`·숫자 키패드), "남은 2개", 후보 버튼 "혹시: XL?", 버튼 `1번째 줄 주문으로`·`1번째 줄 주문 아님`, 위 "고른 줄 주문으로"·"고른 줄 주문 아님", 문장 "n번째 줄에 빈 칸이 있어요", 결과 `list` "보낸 결과"(예 "홍길동 · 반바지 — 대기 1번"), 남은 줄의 "그대로 두었어요 — …". 5초 대기는 콘솔과 같은 되돌리기 띠(`region` "보내기 전 조치").
- 채팅 패널: 태그 "주문 21번 M"·"주문 21번 L ×2"·"확인 필요 · 옵션 빠짐"·"언급", 버튼 "확인 필요에서 고르기".
- 문자찜(옵션 방송): 항목마다 `radiogroup`(이름 = 항목 이름, 선택지 이름 "M · 남은 1개"), 칸 "수량", 상품이 없으면 "상품을 등록하면 옵션을 고를 수 있어요", 결과 "21번 · 찜이 생기지 않았어요 — 확인 필요로 보냈어요"(주의 색).
- 취소 요청(변형을 정하지 않음): 라디오 "L · 1등" 등, 버튼 "고른 찜 취소"·"취소하지 않기".
- 직접 배정(옵션 상품): `select` 항목 이름·"수량"(처음 1).

### 스스로 정한 경계

1. 채팅 패널 "언급"(서버 이의 1과 같은 판단): 옵션 방송에서 주문·취소·확인 필요가 아닌 메시지 중 번호 언급이 있거나 이 방송 상품의 이름·별칭(비교 글자 2자 이상)이 글에 들어 있으면 "언급". 판정이 아니라 표시만이다. 확인 필요 메시지와 옵션 상품을 말한 메시지에는 "찜으로 바꾸기"가 없다(`host.convertMessage`에 옵션 칸이 없다).
2. 확인 필요 결과의 "1등·대기 n번·품절"은 보낸 뒤 그 방송의 확인 필요 조회(`?broadcast=`)의 상품 변형으로 정한다(마지막 줄을 보내도 상품이 남아 있다). 묶음의 요청 번호는 `<요청 번호>-<줄 번호>`(재전송 때 같은 번호).
3. 리허설의 새 방송 시작 창: 홈의 "리허설 해 보기"(바로 시작, 설정 그대로)는 그대로 두고, 새 방송 창 안에 "이 판매 방식으로 리허설 시작"을 더했다(기존 E2E의 `리허설 해 보기` 이름과 겹치지 않게).
4. 홈 링크는 실제 범위 "확인 필요 n건"과 리허설 범위 "리허설 확인 필요 n건"을 따로 둔다(D-081 범위 분리).
5. (수정 라운드, SA-O2-05·RA-O2-03 — spec-keeper가 D-O2-05 보강으로 정할 일, 그때까지 가장 안전한 쪽) 빠른 입력 줄에 붙인 옵션은 **빠른 입력 줄로 새 번호를 등록할 때만** 함께 간다. 이미 있는 번호를 친 "고칠까요?"·번호만 친 찾기·음성 카드 등록·남겨 둔 "고칠까요?"의 "새로 등록"에서는 옵션을 넣지 않고 **떼고** 안내한다(`role=status`, `data-tone=warning`): "붙인 옵션은 21번에 넣지 않고 뗐어요. 옵션은 빠른 입력 줄로 새 번호를 등록할 때만 함께 들어가요. 21번 옵션은 상품 자세히의 "옵션 고치기"로 넣어 주세요." 등록 차례에서 그사이 같은 번호가 생겼으면(첫 확인·`changed=false`) 같은 안내를 하고, 번호도 없이 등록되지 않았으면 붙인 옵션을 되살린다. 근거: 옵션이 엉뚱한 상품에 들어가 변형 판정이 틀리는 것(분쟁)이 옵션을 다시 넣는 수고보다 나쁘다.
6. (수정 라운드, SA-O2-04·TE-O2-001~003) `derive.ts`의 `productSlots(product)`가 옵션 상품의 1등·대기·승계·충돌을 변형 합으로 돌려준다(옵션 없는 상품은 상품 그대로). 알림 띠 수는 `successionUnits`·`conflictUnits`(상품 단위 + 변형 단위 하나씩)를 센다. 승계 창은 변형 단위면 제목이 "승계 결정 — 21번 M 반바지"이고 `host.promote`·`host.reopen`에 그 변형의 `options`를 붙인다. 변형 충돌은 엔진의 `host.resolveConflict`가 상품 단위만 받아 창에서 정하지 못하므로 "상품 자세히에서 그 변형의 찜을 취소하거나 거절해 정리해 주세요"로 안내한다(옵션 방송은 접수순이라 실제로는 생기지 않는다, R-20 7).
7. (수정 라운드, RA-O2-02) 확인 필요 목록 다시 읽기는 첫 알림부터 250ms 뒤 한 번(뒤 알림이 미루지 않는 최대 대기), 읽는 중에 온 알림은 끝난 뒤 한 번만 더 읽는다.
