# 확인 중(임시 등록) 상품 — 다음 작업자를 위한 약속

- 근거: [개선 계획표](2026-11-12-improvement-plan.md) A2·A5·A6·B2·C절·G6, [라이브 복기](2026-11-12-live-retro.md) 5·6·9절
- 규칙: `docs/spec/DOMAIN_RULES.md` R-2 "확인 중"·"가격 없는 확인 중"·R-5·R-10·R-13, `docs/spec/SPEC.md` PRD-07, 결정 `docs/DECISIONS.md` D-RETRO-80~85·D-RECOG-22~27
- 쓴 날: 2026-11-13 · 가격 없는 임시 등록 더함 2026-11-16 (인식·등록 다시 설계 1단계, DOMAIN_RULES v0.1.54)
- 상태: **엔진(`packages/core`)과 서버(`apps/server`)는 끝났다.** 화면 일꾼(`packages/screen-worker`)과 앱 화면(`apps/mobile`·`apps/web`)은 아직 고치지 않았다 — 이 문서가 그 두 작업이 쓸 모양이다.

## 0. 한 줄 요약

화면 일꾼이나 계정 동기화가 아직 확인하지 못한 값으로 올린 상품은 "확인 중"이다. 찜은 그때부터 받지만(보류), 감사 채팅과 라벨은 **확정한 뒤에, 확정한 값으로** 나간다. 확정은 일꾼(근거가 둘 모였을 때)이나 판매자(앱에서 한 번 탭)가 한다. 판매자의 손 등록은 지금처럼 바로 판매 중이다.

지금 서버만 올려도 달라지는 것은 하나다: **다른 계정의 손 등록이 동기화로 들어올 때, 그 번호로 기다리는 찜이 있으면 확인 중으로 들어온다**(313번 사고를 막는다). 지금 앱에서는 그 상품이 "공개 전"으로 보이고, 가격을 고친 뒤 [공개]를 누르면 그 값으로 확정된다. 일꾼의 임시 등록은 일꾼이 새 항목을 보내기 시작해야 켜진다(옛 일꾼은 지금 그대로).

## 1. 엔진이 하는 일 (바뀌지 않는 약속)

| 일 | 이벤트 | 결과 |
|---|---|---|
| 임시 등록 | `product.register` + `tentative: { by, reasons, candidates? }` | 상품이 공개 전(`READY`)으로 생기고 확인 중 표시가 붙는다. 그 번호의 찜은 보류 |
| 확정 | `product.confirm { b, no, to?, name?, price? }` | 최종 번호·품종·가격을 정하고 판매 중. 최종 번호로 기다리던 찜이 먼저 온 순서대로 **확정하는 값**으로 판정되고 그때 라벨·감사 효과가 나온다 |
| 거두기 | `product.withdraw { b, no }` | 상품 기록이 없어진다. 그 번호의 찜은 그대로 보류(그 번호를 다시 등록하면 그때 판정) |
| 공개 | `product.open { b, no }` (지금 있는 이벤트) | 확인 중 상품이면 지금 값으로 확정한 것 |
| 판매 종료 | `product.close { b, no }` (지금 있는 이벤트) | 지금 규칙 그대로 — 보류 찜은 "판매 중 아님"으로 끝난다. 거두기와 다르다 |
| 가격 없는 임시 등록 | `product.register` + `tentative`, `price` 없음 (D-RECOG-22) | 위 임시 등록과 같고 가격이 빈(`null`, 0원 아님) 상품. **가격을 채우기 전에는 공개·확정이 아무 일도 없다**(가격 없는 `confirm`·`open`). 가격은 `product.update`나 `confirm`의 `price`로 채운다 — 빈 가격을 채운 것은 가격 이력에 남지 않는다 |

- 확인 중인 동안 고치기(`product.update`)·번호 바꾸기(`product.renumber`)는 그대로 되고 확인 중 그대로다.
- 확인 중이 아닌 상품·없는 번호의 확정·거두기는 아무 일도 없다(`changed: false`). 이미 확정한 값을 늦게 온 확정이 덮지 않는다.
- 확정하며 옮길 번호(`to`)에 상품이 이미 있으면(판매 종료한 상품 포함) 확정 전체가 아무 일도 없다.
- 같은 번호의 다시 등록은 확인 중이어도 아무 일도 없다. 확정은 `product.confirm`·`product.open`으로만.
- 찜 유효 시간(만료를 켠 방송만 — 운영 기본은 끔)은 임시 등록 시각에서 잰다. 확정이 늦어도 임시 등록 때 온 찜은 살아 있다.
- `tentative`의 모양: `by` = `WORKER`(일꾼)·`SYNC`(계정 동기화). `reasons` = 까닭 낱말 1~6개(영문 대문자로 시작하는 대문자·숫자·`_` 1~32자, 겹치지 않게). `candidates` = `no`·`price`·`name` 칸마다 4개까지, 겹치지 않게(번호 1 이상 정수, 가격 0 이상 정수 원, 품종 1~60자). 닉네임·채팅 글은 담지 않는다.

지금 쓰는 까닭 낱말(코어 `TENTATIVE_REASONS`). 엔진은 모양만 검사하므로 일꾼이 낱말을 더해도 서버를 먼저 고칠 필요가 없다 — 대신 화면은 모르는 낱말을 "확인이 필요해요"로 보여야 한다.

| 낱말 | 뜻 | 화면 문구 제안 |
|---|---|---|
| `NUMBER_SINGLE_SOURCE` | 번호 근거가 하나뿐(말한 번호만, 또는 번호표만) | 번호를 한 번만 확인했어요 |
| `NUMBER_MISMATCH` | 말한 번호와 화면 번호표가 다르다 | 말한 번호와 번호표가 달라요 |
| `NUMBER_OUT_OF_RANGE` | 오늘 쓰는 번호대 밖 | 오늘 번호와 많이 달라요 |
| `PRICE_SINGLE_SOURCE` | 가격 근거가 하나뿐 | 가격을 한 번만 확인했어요 |
| `PRICE_DISAGREE` | 가격 답이 갈린다(규칙 값 ≠ LLM 값) | 가격이 두 가지로 들렸어요 |
| `PRICE_OUT_OF_RANGE` | 자릿수·가격대가 이 판매자와 맞지 않는다 | 가격이 평소와 많이 달라요 |
| `NAME_UNSURE` | 품종 답이 갈리거나 사전에 없다 | 품종을 확인해 주세요 |
| `OTHER_ACCOUNT` | 다른 계정이 넣은 값 | 다른 계정에서 넣은 상품이에요 |
| `PENDING_CLAIMS` | 그 번호로 기다리는 찜이 있다 | 기다리는 손님이 있어요 |

## 2. 화면 일꾼이 쓸 입구

모두 `Authorization: Bearer <일꾼 토큰>`. 서버가 이 입구·항목을 받는지는 켜질 때 `GET /internal/screen/capabilities`로 묻는다(D-RETRO-32) — `endpoints.register.fields`에 `tentative`가 있고 `endpoints.confirm`·`endpoints.withdraw`가 있을 때만 임시 등록을 쓴다. 없으면(옛 서버) 지금 방식 그대로 보낸다. **가격 없는 임시 등록**(2.1.1)은 `endpoints.register.waived`가 `{ "price": "tentative" }`일 때만 보낸다(D-RECOG-26) — 이 칸이 없는 옛 서버는 가격 없는 등록을 400으로 거절한다.

### 2.1 임시 등록 — `POST /internal/screen/register`

지금 등록에 `tentative`를 더한다. 싣지 않으면 지금처럼 바로 판매 중이다.

```json
{
  "videoId": "abcdefghijk",
  "no": 334,
  "price": 20000,
  "name": "색금",
  "heard": "자 삼삼사 번 색금 이만 원",
  "conf": 0.7,
  "requestId": "screen-abcdefghijk-334-1763000361000",
  "observedAt": 1763000361000,
  "tentative": {
    "reasons": ["NUMBER_MISMATCH", "PRICE_SINGLE_SOURCE"],
    "candidates": { "no": [334, 333], "price": [20000], "name": ["색금"] }
  }
}
```

응답(200):

```json
{ "ok": true, "changed": true, "tentative": true, "broadcastId": "…", "no": 334,
  "broadcasts": [{ "broadcastId": "…", "changed": true, "duplicate": false, "tentative": true }] }
```

- 같은 영상에 이어진 방송(계정) 모두에 임시로 들어간다. 방송마다 `broadcasts[]`에 결과가 있다.
- `changed: false`인 방송: 그 번호에 이미 상품이 있다(확인 중이든 아니든). `skip: "CLOSED"`면 판매자가 지운 번호다 — **임시 등록은 지운 번호를 다시 열지 않는다.** 근거가 모인 뒤 `tentative` 없는 등록(`observedAt` 포함)으로 다시 보내면 지금의 다시 열기 규칙(D-SCR-11, 지운 뒤 60초)이 그대로 적용된다.
- `tentative` 모양이 틀리면 400(까닭 낱말 모양·후보 수 포함).
- `requestId`는 꼭 기억한다 — 확정·거두기에 `registerRequestId`로 보낸다.

#### 2.1.1 가격 없는 임시 등록 (D-RECOG-22, 인식·등록 다시 설계 1단계)

"N번"만 들리고 가격을 아직 못 들었으면 **`price`를 빼고** 임시 등록한다. `tentative`가 있을 때만 뺄 수 있다.

```json
{
  "videoId": "abcdefghijk",
  "no": 356,
  "heard": "자 삼백오십육 번",
  "requestId": "screen-abcdefghijk-356-1763000361000",
  "observedAt": 1763000361000,
  "tentative": { "reasons": ["PRICE_SINGLE_SOURCE"], "candidates": { "no": [356] } }
}
```

- 응답은 2.1과 같다(`tentative: true`). 판매자 화면에는 "356번 가격 듣는 중"으로 보이고, 그 번호의 찜은 보류로 기다린다. 감사 채팅·라벨은 나가지 않는다.
- `tentative` 없이 `price`를 빼면 400(`price는 0~100,000,000 정수(원)예요. 가격 없이는 임시 등록(tentative)만 보낼 수 있어요.`). `"price": null`도 400 — 비우려면 칸을 싣지 않는다. `name`은 지금처럼 빼도 된다.
- **가격 채우기**(둘 중 하나):
  1. **금액 고치기** `POST /internal/screen/reprice { videoId, no, price, requestId }`(100원 이상) — 가격만 채우고 **확인 중 그대로**다. 근거가 하나 더 모이면 그 뒤 확정(2.2)을 가격 없이 보내도 된다. 판매자가 그사이 가격을 적었으면 `skip: SELLER_PRICED`(판매자 값 그대로).
  2. **확정에 `price`** — 가격을 채우며 바로 확정한다(2.2). 가격 근거가 모였을 때.
  - 빈 가격을 채운 것은 가격 바꿈이 아니어서 가격 이력에 남지 않는다. 채운 뒤 다시 고치면 그때부터는 지금처럼 이력이 남는다.
- **가격 없이 확정하면** 아무것도 쓰지 않고 `skip: "NO_PRICE"`가 온다(2.2 표). 가격을 채운 뒤 다시 보낸다(새 `requestId`).
- 거두기(2.3)·번호 바꾸기(`/renumber`)는 가격이 없어도 지금 그대로 된다. 번호를 옮겨도 빈 가격·확인 중은 그대로다.
- 같은 영상에 이어진 다른 계정에도 가격 없이 확인 중으로 들어간다. 계정을 새로 이을 때(처음 맞추기)도 가진 계정이 모두 가격 없는 확인 중이면 새 계정에 가격 없이 확인 중으로 넣고, 그 계정에서도 일꾼의 금액 고치기가 빈 가격을 채운다(D-RECOG-26).

### 2.2 확정 — `POST /internal/screen/confirm`

```json
{ "videoId": "abcdefghijk", "no": 334, "registerRequestId": "screen-abcdefghijk-334-1763000361000",
  "requestId": "screen-abcdefghijk-ok-334-1", "to": 333, "price": 20000, "name": "색금" }
```

`to`·`price`·`name`은 선택(적지 않은 칸은 지금 값 그대로). 응답(200):

```json
{ "ok": true, "changed": true, "no": 334, "to": 333,
  "broadcasts": [{ "broadcastId": "…", "changed": true },
                 { "broadcastId": "…", "changed": true, "kept": ["price"] },
                 { "broadcastId": "…", "changed": false, "skip": "NOT_TENTATIVE" }] }
```

방송마다 지금 상태로 다시 보고 확정한다. 넣지 않은 까닭(`skip`):

| skip | 뜻 | 일꾼이 할 일 |
|---|---|---|
| `NOT_TENTATIVE` | 판매자(또는 앞선 확정)가 이미 확정했다 | 끝. 값을 더 고치려면 지금의 금액 고치기·이름 고치기 입구(각자의 안전 규칙) |
| `NO_PRODUCT` | 그 번호에 상품이 없다(거뒀거나 판매자가 지웠거나 번호를 옮겼다) | 끝 |
| `OTHER_REGISTER` | 그 상품을 만든 등록이 `registerRequestId`가 아니다(다시 켠 일꾼) | 건드리지 않는다 |
| `NOT_SCREEN` | 일꾼이 올린 상품이 아니다(다른 계정의 손 등록이 동기화로 들어온 확인 중 상품) | 건드리지 않는다 — 그 계정 판매자가 확정한다 |
| `TARGET_EXISTS` | 옮길 번호(`to`)에 상품이 이미 있다 | 옮기지 않고 그 번호 그대로 확정할지, 거둘지 정한다 |
| `NO_PRICE` | 가격이 빈 상품(2.1.1)을 `price` 없이 확정하려 했다 | 가격을 듣고 `price`를 실어 다시 확정하거나, 먼저 `/reprice`로 채운다 |

`kept` = 판매자가 그사이 고쳐서 일꾼 값으로 덮지 않은 칸(`no`·`name`·`price`). 그 칸은 판매자 값으로 확정됐다.

### 2.3 거두기 — `POST /internal/screen/withdraw`

```json
{ "videoId": "abcdefghijk", "no": 334, "registerRequestId": "screen-abcdefghijk-334-1763000361000",
  "requestId": "screen-abcdefghijk-no-334-1" }
```

응답은 확정과 같은 모양. `skip`에 하나가 더 있다: `SELLER_EDITED` — 판매자가 그 상품의 품종·금액·번호를 손댔다. 거두지 않는다.

거둔 번호로 와 있던 찜은 그대로 기다린다. 같은 번호를 다시 임시 등록해도 되고(새 `requestId`), 다른 번호로 등록해도 된다.

### 2.4 가격 단위 — `GET /internal/screen/live`

```json
{ "videos": [{ "videoId": "abcdefghijk", "priceUnit": "TEN_THOUSAND" }] }
```

`priceUnit` = 그 방송의 설정 `price.unit`: `WON`(원)·`THOUSAND`(천 원)·`TEN_THOUSAND`(만 원)·`AUTO`(1~2자리는 만 원, 3자리는 천 원, 4자리 이상은 원). 같은 영상에 이어진 계정끼리 값이 다르거나 읽지 못하면 `null` — 그때는 지금처럼 `LLM_PRICE_UNIT`을 쓴다. 설정 기본값은 여전히 `THOUSAND`다 — 판매자가 단위를 고르지 않은 계정도 `THOUSAND`가 온다. 지금 일꾼의 기본은 만 원(`LLM_PRICE_UNIT`, D-SCR-13)이라, **판매자가 단위를 고르는 화면이 나가기 전에는 일꾼이 `THOUSAND`를 받았다고 곧바로 천 원으로 바꾸면 안 된다**(고르지 않은 값인지 고른 값인지 이 응답으로는 구별하지 못한다). `TEN_THOUSAND`·`WON`·`AUTO`는 판매자가 고른 값이다.

### 2.5 `sw/llm_live.py`에서 어디를 고치나

지금 흐름(D-SCR-12~16): 답을 번호마다 `self.pend`에 모으고(`_pend_add`), `_settle`이 번호 근거(`R.number_evidence`)와 가격(`R.price_choice`)이 **둘 다** 정해졌을 때만 `_send_pending` → `_send` → `poster.send`로 한 번 보낸다. 못 정하면 `PRICE_WAIT`(20초) 뒤 "LLM확인요청"·"LLM번호보류" 이벤트만 남기고, `HOLD_MAX`(120초) 뒤 그 번호를 버린다. 그래서 지금은 근거가 모일 때까지 서버에 상품이 없다 — 찜은 보류로 쌓이지만 판매자 화면에는 아무것도 보이지 않는다.

바꿀 흐름("빨리 임시로, 근거가 둘 모이면 확정"):

1. **`_pend_add`** — 그 번호의 모음(`p`)을 처음 만들 때, 번호와 가격 후보가 하나라도 있으면 바로 임시 등록을 보낸다.
   - 본문: `post.make_body(...)`에 `observedAt`·`requestId`(지금 `_send`와 같은 식 `screen-<영상>-<번호>-<observed>`)·`tentative`를 더한다. `p["rid"]`에 요청 번호를 적어 둔다.
   - `reasons`: 말한 번호가 아니면(`p["spoken"]`이 거짓) 또는 번호표를 아직 `TAG_FRAMES`장 못 봤으면 `NUMBER_SINGLE_SOURCE`, `r.get("pair_wait")`가 있으면 `NUMBER_MISMATCH`, 번호대 밖(`R.band_of`)이면 `NUMBER_OUT_OF_RANGE`, 가격이 말한 금액(`explicit`·`short`)과 아직 맞지 않으면 `PRICE_SINGLE_SOURCE`, 품종이 사전과 맞지 않으면 `NAME_UNSURE`.
   - `candidates.no`: `pair_wait`의 `(said, screen)` 둘 — **따르기로 한 쪽을 `no`로 등록하고 둘 다 후보에 넣는다**(C절: 눈으로 헷갈리는 쌍은 말한 번호, 귀로 헷갈리는 쌍은 화면 번호, `R.pair_verdict`). `candidates.price`: 지금까지의 `p["votes"]` 금액과 말한 금액. `candidates.name`: LLM 이름과 사전 후보.
   - 임시 등록은 LLM 답을 기다리지 않아도 된다(B2·L1): 규칙이 번호와 가격을 한 구절에서 읽었으면 그것만으로 올리고 LLM은 확정에만 쓴다. 이 부분은 `_pend_add`보다 앞(`run`에서 받아쓰기 줄을 받는 곳)에 규칙 등록을 더하는 일이다.
   - 이미 `self.sent`에 있는 번호(다시 내놓은 상품)는 임시 등록하지 않는다 — 지금처럼 금액·이름 고치기 투표로만.
2. **`_settle`** — 번호 근거와 가격이 정해졌을 때(`ok and price is not None`) 지금의 `_send_pending` 대신 **확정**을 보낸다: `poster.confirm(video, no=p["first_no"], to=<최종 번호가 다르면>, price, name, rid=p["rid"])`. 응답의 방송마다 `changed`·`skip`·`kept`를 기록(events.jsonl "LLM확정")한다. 그 뒤 지금 `_send`가 하던 뒷일(`self.sent`·`self.watch`·`self.prices`·`self.names` 채우기)을 그대로 한다 — 확정 뒤의 금액·이름·번호 고치기는 지금 입구를 그대로 쓴다.
   - `PRICE_WAIT`가 지나 "LLM확인요청"·"LLM번호보류"를 남기는 자리: 상품은 이미 확인 중으로 올라가 있고 판매자 화면에 후보가 보인다. 여기서는 기록만 남기면 된다(더 보낼 것이 없다). 후보가 늘었으면(새 금액 답) 지금은 후보를 고치는 입구가 없다 — 5절 "알려진 한계".
   - `HOLD_MAX`가 지나 그 번호를 버리는 자리(`del self.pend[no]`), 그리고 번호 근거가 끝내 없던 것(없는 번호·앞 상품 번호표): **거두기**를 보낸다 `poster.withdraw(video, no, rid=p["rid"])`. `skip: SELLER_EDITED`·`NOT_TENTATIVE`면 판매자가 이미 손댄 것이니 그대로 둔다.
   - 방송이 끝날 때(`final`) 남은 확인 중 상품은 거두지 말고 둔다 — 판매자가 방송 뒤에 확정하거나 지운다.
3. **`_pair_move`** — 기다리던 숫자 쌍에서 화면 번호로 옮기는 자리: 이미 임시 등록한 번호(`said`)가 있으면 새로 등록하지 말고, 확정할 때 `to=screen`으로 옮긴다(`p["first_no"]`는 그대로 두고 `p["no"]`만 바꾼다). 옮길 번호가 `self.sent`에 있으면(이미 보낸 상품) 임시 등록을 거둔다.
4. **`_send_pending`** — 서버가 임시 등록을 받지 않을 때(capabilities에 `tentative` 없음)와 판매자가 지운 번호(`skip: CLOSED`)를 다시 열 때만 지금처럼 쓴다.
5. **`sw/post.py`** — `Poster.confirm`·`Poster.withdraw`를 `renumber`와 같은 모양으로 더한다(요청 번호 `screen-<영상>-ok-<번호>-<n>`·`screen-<영상>-no-<번호>-<n>`, 실패하면 지금의 다시 보내기). `make_body`에 `tentative` 인자. 켜질 때 capabilities를 읽어 `tentative`를 쓸지 정하는 값 하나.
6. **재현 도구(`sw/replay_live.py`)** — "임시 등록까지 걸린 시간"과 "확정까지 간 틀린 번호·금액 수"를 따로 잰다(계획표 목표: 임시 등록 중앙 3초, 확정까지 가는 틀린 값 0건).

순서: 서버를 먼저 올리고(capabilities에 새 항목이 보인다) 일꾼을 나중에 올린다(E11). 일꾼이 먼저 올라가도 capabilities를 보고 옛 방식으로 보내면 안전하다.

## 3. 모바일·웹이 읽을 상태와 보낼 이벤트

### 3.1 읽기 — 방송 상태의 상품

`GET /api/days/:date`(와 증분 조회)의 `products[]` 항목에, 확인 중일 때만 `tentative`가 있다. 없으면 확인 중이 아니다. 확인 중 상품의 `status`는 `READY`다.

```json
{
  "key": "b_abc/334", "id": "p12", "broadcast": "b_abc", "no": 334,
  "name": "색금", "price": 20000, "stock": 1, "status": "READY",
  "winners": [], "waitlist": [],
  "tentative": {
    "by": "WORKER",
    "reasons": ["NUMBER_MISMATCH", "PRICE_SINGLE_SOURCE"],
    "candidates": { "no": [334, 333], "price": [20000], "name": ["색금"] },
    "seq": 412,
    "at": "2026-11-12T04:19:21.000Z"
  }
}
```

- `by`: `WORKER`(화면 일꾼) · `SYNC`(다른 계정에서 동기화로).
- `candidates`의 세 칸은 늘 있다(없으면 빈 목록). 지금 값(`no`·`price`·`name`)이 후보에 들어 있지 않을 수도 있다 — 화면은 지금 값을 첫 후보로 보이면 된다.
- 그 번호로 기다리는 찜 수는 같은 응답의 `pending[]`에서 `no`가 같은 항목의 `buyers.length`. 번호 후보마다 기다리는 찜 수를 보이면 판매자가 고르기 쉽다(C3 "손님 찜이 들어온 번호").
- 닉네임·채팅 글은 `tentative`에 없다.
- **가격 없는 확인 중 상품은 `"price": null`이다**(0이 아니다, D-RECOG-22). 화면은 "가격 듣는 중"으로 보이고, 금액·합계·정렬·라벨에 0원으로 넣지 않는다. 가격이 빈 상품은 늘 확인 중이거나 판매 종료다(INV-14).
- 지금 앱은 이 칸을 모르고 상품을 "공개 전"으로 보인다. [공개](`product.open`)는 지금 값으로 확정하고, 고치기는 그대로 된다.

### 3.2 쓰기 — `POST /api/events`

한 번 탭으로 확정(후보에서 고른 값만 적는다. 적지 않은 칸은 지금 값):

```json
{ "requestId": "c-7f3a…", "type": "product.confirm", "b": "b_abc", "no": 334, "to": 333, "price": 20000, "name": "색금" }
```

거두기:

```json
{ "requestId": "w-91bc…", "type": "product.withdraw", "b": "b_abc", "no": 334 }
```

- 응답은 다른 이벤트 쓰기와 같다(`{ type, changed, seq, … }`). `changed: false`면 이미 확정됐거나(일꾼·다른 기기가 먼저) 옮길 번호에 상품이 있다 — 화면을 새로 읽어 보인다.
- 값을 직접 쳐서 확정할 때: 숫자는 기기가 읽지 않는다(SRV1). 두 길 가운데 하나를 쓴다 — ① 지금의 고치기 칸 원문(`product.update`에 `noText`·`priceText`·`name`)으로 고친 뒤 `product.confirm { b, no }`. ② 서버 읽기 입구(`POST /api/broadcasts/:id/read` — 고치기 칸 읽기)로 읽은 숫자를 `product.confirm`의 `price`에. ①은 요청이 둘이지만 둘 다 다시 보내도 안전하다.
- 화면은 `product.register`에 `tentative`를 보내지 못한다(400). 손 등록은 늘 바로 판매 중이다.
- 가격이 빈 상품에 `price` 없는 `product.confirm`이나 `product.open`을 보내면 서버가 기록하지 않고 400(`INVALID_INPUT`, `problems: [{ field: "price", message: "가격을 먼저 적어 주세요. 가격을 적어야 판매를 시작할 수 있어요." }]`)을 돌려준다(D-RECOG-23). 앱은 가격을 받아 `product.confirm { price }`로 보내거나, 고치기 칸 원문으로 가격을 채운 뒤 확정한다(위 ①).
- 확인 중 상품이 있는 번호에 판매자가 손 등록을 치면 지금처럼 "이미 있는 번호"(`changed: false`)다. 그때 화면은 "고칠까요?" 대신 **친 값으로 확정할지** 물어 `product.confirm { no, name, price }`를 보내면 된다(5절).
- 조치 기록(상품 자세히의 이력)에 새 종류 `product.confirm`·`product.withdraw`가 나온다 — 낱말을 더해야 한다(제안: "확정", "임시 등록 거둠").

### 3.3 확인 카드에 필요한 값

| 카드에 보일 것 | 어디서 |
|---|---|
| 번호 후보 둘(좌우 단추) | `tentative.candidates.no` — 왼쪽·오른쪽 순서는 화면이 정한다. 한 번 탭 = `product.confirm { no, to: <고른 번호> }`(지금 번호를 고르면 `to` 없이). 단추 규칙(CLAUDE.md 8)은 "부정 왼쪽·긍정 오른쪽"인데 번호 후보는 긍정·부정이 아니다 — 지금 번호(일꾼이 따른 쪽)를 오른쪽에 두는 것을 권한다 |
| 금액 후보·품종 후보 | `tentative.candidates.price`·`.name`. 칩으로 띄워 고르면 확정 요청에 `price`·`name`으로 |
| 까닭 한 줄 | `tentative.reasons`(1절 표) |
| 기다리는 손님 수 | `pending[]`에서 그 번호·후보 번호의 `buyers.length` |
| 누가 올렸나 | `tentative.by` — `SYNC`면 "다른 계정에서 넣은 상품이에요" |
| 거두기 | `product.withdraw` — 부정 단추(왼쪽) |

**번호표 사진은 이번에 만들지 않았다.** 넣으려면 서버에 필요한 것:

1. 일꾼이 잘라 낸 번호표 사진을 올릴 입구(예: `POST /internal/screen/tag-photo` — 일꾼 토큰, 영상·등록 요청 번호·JPEG 한 장, 크기 상한 수십 KB). 사진은 이벤트 로그에 넣지 않는다(엔진 상태·백업이 커진다) — 방송이 끝나면 지우는 짧은 보관 표나 파일 저장소에 `(판매자, 방송, 등록 요청 번호)`로.
2. 판매자 앱이 읽을 입구(예: `GET /api/broadcasts/:id/products/:no/tag-photo` — 그 상품의 `tentative.seq`가 가리키는 등록의 사진). 판매자 로그인·자기 방송만.
3. `SCREEN_ENDPOINTS` 표에 한 줄(capabilities), 확정·거두기·방송 종료 때 사진 지우기.
4. 사진에는 손님 정보가 없지만 방송 화면 조각이므로 방송이 끝나면 지운다.

엔진·`tentative` 모양은 바꾸지 않아도 된다(사진은 등록 요청 번호로 찾는다).

## 4. 계정 동기화가 하는 일 (이미 들어갔다)

같은 유튜브 라이브에 계정이 여럿 이어져 있을 때(`apps/server/src/screen/catalog.ts`):

| 일어난 일 | 다른 계정에 |
|---|---|
| 일꾼의 임시 등록·확정·거두기 | 일꾼 입구가 이어진 계정마다 직접 넣는다(동기화 대기열을 거치지 않는다) |
| 사람의 손 등록 | 그 계정에 그 번호로 **기다리는 찜이 있으면 확인 중으로**(`by: SYNC`, 까닭 `OTHER_ACCOUNT`·`PENDING_CLAIMS`), 없으면 지금처럼 판매 중으로 |
| 사람이 확인 중 상품을 고침(확정 전) | 값만 옮긴다(확인 중 그대로). 그 번호가 없는 계정에는 확인 중으로 넣는다 |
| 사람이 확정(또는 확인 중 상품을 [공개]) | 그 계정의 같은 상품이 아직 확인 중이면 같은 값으로 확정(번호 옮김 포함). 이미 판매 중이면 품종·금액 고침으로. 없으면 위 "손 등록" 규칙으로 |
| 사람이 거둠 | 그 계정에서도 아직 확인 중일 때만 거둔다 |
| 계정이 새로 이어짐(처음 맞추기) | 가진 계정이 모두 확인 중인 번호는 새 계정에도 확인 중으로. 옮겨 온 일꾼의 임시 등록은 그 계정에서도 일꾼이 확정할 수 있다 |

다른 계정의 손 등록으로 들어온 확인 중 상품(`by: SYNC`)은 일꾼이 확정·거두지 못한다. 그 계정 판매자가 확정한다.

## 5. 알려진 한계

- **확인 중 상품의 후보를 나중에 고치는 길이 없다.** 후보는 임시 등록할 때 한 번 정해진다. 일꾼이 뒤에 새 금액·번호 답을 얻어도 후보 목록에 더하지 못한다(값 자체는 금액 고치기·이름 고치기 입구로 고칠 수 있다 — 확인 중 상품에도 된다). 필요하면 `product.update`에 `tentative` 후보 고치기를 더하는 일이 다음이다.
- **손 등록이 확인 중 상품을 확정하지 않는다.** 확인 중 상품이 있는 번호의 손 등록은 "이미 있는 번호"다(엔진은 누가 보냈는지 몰라, 다시 등록을 확정으로 받으면 옛 일꾼의 등록이 다른 계정에서 들어온 확인 중 상품을 확정해 버린다). 화면이 `product.confirm`을 보내야 한다(3.2). 그 전까지 지금 앱에서는 "고칠까요?" → 고친 뒤 [공개]의 두 걸음이다.
- **판매 종료(지우기)는 거두기가 아니다.** 지금 앱에서 상품을 지우면 `product.close`(판매 종료)가 가서 그 번호로 기다리던 찜이 "판매 중 아님"으로 끝나고, 그 번호에 `CLOSED` 기록이 남는다. 확인 중 상품을 없앨 때는 `product.withdraw`를 보내는 단추가 따로 있어야 한다.
- **사람의 번호 바꾸기는 여전히 기다리던 찜을 확정시킨다.** 다른 계정에서 사람이 판매 중인 상품의 번호를 바꾸면, 받는 계정에서도 바꾼 번호로 기다리던 찜이 그 계정의 값으로 판정된다(R-10). 같은 상품의 값이라 313번과는 다르지만 "기다리는 찜은 확인 뒤 확정"의 밖이다.
- **거의 동시에 넣은 손 등록 알림(D-RETRO-13)은 그대로다.** 받는 계정에 확인 중 상품이 생긴 직후(2초 안) 친 손 등록은 `syncClash`로 두 값을 돌려준다. 화면은 고른 값으로 `product.confirm`을 보내면 된다(지금은 `product.update`만 보낸다).
- **가격 단위는 계정마다 다를 수 있다.** 같은 영상에 이어진 계정의 `price.unit`이 다르면 일꾼에게 `null`이 간다. 기준 계정(D-RETRO-14)의 값을 주는 것은 하지 않았다.
- **확인 중 상품이 오래 남을 수 있다.** 일꾼이 죽거나 방송이 끝나면 확인 중 상품이 그대로 남는다. 저절로 확정하거나 거두지 않는다(틀린 값을 저절로 확정하는 것보다 안전하다). 화면에 "확인 중 n개"를 보이고 방송을 끝낼 때 묻는 것을 권한다. 정산·매출표에는 확정된 찜만 들어가므로 금액이 틀어지지는 않는다.
- **옵션 방송**(의류 등)에서도 엔진 규칙은 같지만 화면 일꾼은 다육 번호 방송만 다룬다. 서버 일꾼 입구의 번호 바꾸기는 옵션 상품을 건너뛰지만 확정·거두기는 건너뛰지 않는다.
- **감사 채팅 10초 지연(D-RETRO-01)과의 관계.** 확정한 뒤에도 감사 채팅은 10초 뒤에 나가고 그사이 고친 품종·적용한 가격이 글에 들어간다(D-RETRO-02). 라벨은 확정하는 순간 나온다.
- **서버를 옛 판으로 되돌릴 때.** 확인 중 등록·확정·거두기가 한 번이라도 기록된 방송 날짜는, 이 규칙을 모르는 옛 서버가 그 기록을 다시 재생하지 못한다(모르는 이벤트 종류·모르는 칸). 서버를 먼저 올리는 것은 안전하지만(옛 일꾼·지금 앱은 새 종류를 보내지 않는다 — 단, 계정 동기화는 올리는 즉시 확인 중 등록을 쓴다), 올린 뒤 이 판보다 앞으로 되돌리는 것은 그렇지 않다. 두 자리 교대(계획 E)에서 옛 자리와 새 자리가 잠깐 같이 뜨는 동안에도 같다.
- **가격 없는 확인 중 상품의 음성(휴대폰 마이크) 길.** 음성 같은 번호 규칙(R-22)은 가격이 빈 상품을 견줄 가격이 없어 "없는 번호"처럼 본다. 다만 그 번호와 가격이 들려 등록하려 할 때(바로 등록·카드 [등록]·고친 값으로 등록·가격 못 들은 카드)는 새로 등록하지 않고 같은 상품 고치기(`product.update`의 `price`)로 빈 가격만 채운다(D-RECOG-28). 채우기는 가격 이력에 남지 않고(D-RECOG-24) 상품은 확인 중 그대로 — 판매는 판매자가 확인 카드에서 확정한 뒤다. 등록이 아니라 5초 되돌리기는 없다. 화면 일꾼이 상품을 맡는 서버(`screenProducts`)에서는 음성이 상품을 다루지 않으므로 이 길도 돌지 않는다. 확인 카드의 [가격 적기]는 수정창의 가격 칸(숫자판)을 바로 연다(D-RECOG-29).
- **서버를 옛 판으로 되돌릴 때(가격 없는 등록).** 가격 없는 임시 등록이 한 번이라도 기록된 방송 날짜는 이 판보다 앞의 서버가 다시 재생하지 못한다(옛 엔진은 `price`가 필수). 일꾼은 `waived` 칸을 보고서만 보내므로 서버를 먼저 올리면 안전하다.
- **판매자 화면 문구**: 상태값 `READY`·`tentative`·까닭 낱말을 그대로 보이지 않는다(CLAUDE.md 절대 규칙 6). "확인 중" 같은 쉬운 말로.

## 6. 시험이 지키는 것

| 무엇 | 어디 |
|---|---|
| 엔진 규칙·성질(확인 중에는 효과 없음, 확정 시점의 값, 번호 옮김, 거두기, 옛 로그 그대로) | `packages/core/test/unit/engine-tentative.test.ts` |
| 손으로 계산한 골든 7개 | `tests/golden/engine/26-retro-tentative.yaml` (G-ENG-RETRO-01~07) |
| 가격 없는 확인 중 — 엔진 규칙·성질·INV-14 | `packages/core/test/unit/engine-tentative.test.ts` ("R-2 가격 없는 확인 중") |
| 가격 없는 확인 중 골든 4개 | `tests/golden/engine/28-recog-priceless.yaml` (G-ENG-RETRO-08~11) |
| 가격 없는 임시 등록·`NO_PRICE`·금액 고치기로 채움·판매자 앱 400·계정 동기화·처음 맞추기 | `apps/server/test/tentative.test.ts` ("D-RECOG-22~26") |
| 앱의 "가격 듣는 중"·[거두기 \| 가격 적기]·가격 없이 확정 막기·[가격 적기]가 가격 칸을 바로 엶 | `apps/mobile/test/tentative-retro-90.test.tsx` ("D-RECOG-22·27", "D-RECOG-29") |
| 음성으로 빈 가격 채우기(등록 대신 가격만, 되돌리기 없음, 못 채우면 카드) | `packages/voice-session/test/controller/v3-voice-instant.test.ts`·`test/server.test.ts`, `apps/mobile/test/remote-voice.node.test.ts`, `apps/server/test/tentative.test.ts` ("D-RECOG-28") |
| 일꾼 입구·판매자 확정·가격 단위·313번 재현·확정 전달·옛 일꾼 호환 | `apps/server/test/tentative.test.ts` |
| 서버가 받는 일꾼 요청 목록 | `apps/server/test/screen-intake.test.ts` (D-RETRO-32 묶음) |
