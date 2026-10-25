# V3 dev-notes

## dev-device (packages/voice) — V3 음성 바로 등록

### 화면이 쓸 API (`@livejjim/voice`, 모두 순수 함수)
- `readyToRegister(text, options?: ExtractOptions): ReadyRegistration | null` — 중간 결과를 붙인 덩어리 글도 넣는다. 'N번'(또는 자리 읽기 번호)과 '…원' 가격이 둘 다 확정됐을 때만 `{ no, price, name, nameNeedsCheck }`. 번호가 서로 다르게 둘 이상·'원' 아직 없음·정정/취소 낱말 있음 → null. `name` = 사전 이름 ?? 추측 ?? null, `nameNeedsCheck` = 추측이면 참.
- `readRegistration(text, options?)` → `{ extraction, guess, priceSure, correction, heardNumbers, heardPrices, ready }` — 카드용 자세한 결과("번호 확인 필요 · 들린 번호: 189·139"는 `heardNumbers`).
- `guessVariety(text, { maxNumber? }): string | null` — R-17 7 품종 추측(골든 variety-guess.json).
- `decideSameNumber({ heard: { price, priceSure, name, nameFrom }, product: { name, price, status, liveClaims }, auto }): { action, changes, reason }` — R-22 그대로(골든 same-number.json).
- `decideForExisting(existing: { no, name, price, claimCount }, heard: { name, price, nameNeedsCheck?, priceSure? }, context?: { auto?, status? }): ExistingDecision` — 오케스트레이터가 고정한 짧은 모양. R-22 위에 얹은 것: `IGNORE` | `AUTO_FIX{price,name}`(바뀌는 칸만, 그대로면 null) | `FILL_NAME{name}`(찜 있고 비었던 품종을 사전 이름으로 채움) | `ASK{price,name}`. `context` 생략 = auto 참·판매 중.
  - 주의(스펙 우선): 찜이 있을 때 비었던 품종을 **추측**으로 채우는 것은 R-22대로 `ASK`(CLAIMS)다 — 오케스트레이터 문구 "FILL_NAME 찜 있어도 됨"보다 R-22 3을 따랐다. `nameNeedsCheck` 생략 = 사전 이름으로 본다.
- `mergeSameNumberCards(cards: SuggestionCard[]): SuggestionCard[]` — 같은 번호 열린 카드를 하나로(손댄 카드 우선, 없으면 목록 앞 = 새 카드). 남는 카드의 빈 품종·가격을 다른 카드 값으로 채우고 나머지는 닫는다.
- 그 밖: `analyzeSentence`(R-17 속 결과), `findDigitReadings`, `numberToSino`, `oneDigitReading`, `windowForms`, `guessWord`, `GUESS_FILLERS`.

### R-17 바뀐 것 (extract.ts — 골든 voice-extract.yaml 120사례 모두 통과)
- 끝말 `까지`·`인데`, 자리 읽기 번호(D-V3-11), 원 가격 줄(D-V3-03), 숫자 하나 붙은 토큰 `3강`→`삼강`(D-V3-12, 창 앞 토큰에도). `findNumberMarkers`(R-21·phrase가 씀)는 그대로.
- 단위 시험 손봄(스펙이 바뀐 것에 맞춤, 약화 아님): `15번 2 만원`·`15번 오 천 원` 가격 없음 기대 삭제(D-V3-03으로 20,000·5,000, 골든이 고정), R-15 속성 시험에서 한글 자리 글자 정확히 셋(`삼육팔번`→368, D-V3-11) 제외, sms.test 골든 사례 수 81 고정 → 81 이상(스펙 관리자가 사례를 늘리는 중).

### 사전 (data/varieties.ko.json) — 사용자 확인 필요
- '○○금' 무늬종 36개 추가(일반 지식으로 정리 — 실제 거래명인지 판매자 확인 필요): 삼광색금(별칭 삼강색금·상강색금·삼강색급·상강세금·삼강세금), 창녹금(창록금), 빅뱅금(빅벵금), 홍옥금, 정야금, 연봉금, 칠복수금, 염자금, 화월금, 흑법사금, 미니마금, 청솔금, 우주목금, 화제금, 백미인금, 월동자금, 사해파금, 립스틱금, 오로라금, 천대전송금, 축전금, 레드베리금, 블루버드금, 선셋금(썬셋금), 홍희금, 백봉금, 황려금, 라울금, 프리티금, 화이트그리니금, 룬데리금, 벨루스금, 녹귀란금, 홍채각금, 만손금, 백설공주금.
  - '핑크문금'은 기존 단위 시험(배운 별칭 예)과 부딪혀 넣지 않았다.
- 막는 낱말 더함: 요아이·유아이·ui·요거·그대로·보냅니다·이렇게.
- 'ui'/'UI'는 R-17 7 군말 목록에 없지만 stopWords에 넣어 군말이 되고, 추측의 군말 비교는 영어 대문자를 소문자로 본다(`UI는` → 군말). 스펙 관리자 확인 바람.

### 골든과 부딪힌 사례
- 없음(지금 작업 중인 voice-extract.yaml 120사례·voice-register 54사례 모두 통과). 오케스트레이터 사례 중 "3번 자 3강 → 확신 낮음"은 R-17 8(real-broadcast 5 기대: 3번·250,000원 확정)과 달라 스펙을 따랐다 — 바로 등록된다(D-V3-20 되돌리기로 고침).

### 남은 위험
- 사전 밖 퍼지 맞추기로 엉뚱한 사전 이름이 나올 수 있다(창이 많은 긴 덩어리). 실제 방송 6문장은 맞음.
- 원 가격 줄 앞의 '번' 없는 수(`170 25만 원`)는 줄이 애매해져 가격이 비고 바로 등록이 안 된다(스펙대로).
