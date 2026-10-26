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

### dev-device 추가 — '번' 없는 번호 (사용자 추가 요구 "168을 백육십팔, 일육팔 이렇게 부를 때도 있단 말이지")
- 앞 규칙 1("'번' 붙은 것만 번호")을 바꿨다. 오케스트레이터가 제안한 규칙대로 구현했다(extract.ts `findBareNumbers`·`plainNumberValue`·`findWonLines`). **스펙 R-17 3·4 문장과 다르다 — 스펙 관리자 반영 필요.**
  1. 우선순위: 'N번'(자리 읽기 + 번 포함)이 하나라도 있으면 그것만 쓴다. 없을 때만 '번' 없는 번호를 본다.
  2. '번' 없는 번호 = 따로 선 토큰이 숫자 1~4자리 또는 한자어 수사 2글자 이상(`168`·`백육십팔`, 1글자 `이`·`오`·`삼` 같은 말버릇은 제외)이거나 자리 읽기(`일육팔`·`1 6 8`, 기존), 값 1..maxNumber,
     끝말은 `은 는 이 가 요 이요 이에요 입니다`만 허용, 다음 토큰이 단위가 아님(`BARE_NUMBER_UNIT_PREFIXES`: 원 만 천 백 십 cm 센치 센티 미리 mm 키로 kg 마리 송이 포기 프로 % 번째 개월로 시작 / `BARE_NUMBER_UNITS`: 개 분 초 살 년 월 일 시 등 위 배 장 촉 명 주 대 차 호 층 번과 같음), 원 가격 줄에 들지 않음.
     원 가격 줄 다음·가격 묶음 전에 잡는다(`백육십팔`이 168원 묶음이 되지 않게).
  3. 원 가격 줄: 왼쪽 끝부터 붙여 읽어 읽히는 가장 긴 줄(자리가 내려갈 때만 R-14/한자어 붙여 읽기가 성공). 읽히지 않아 빠진 왼쪽 수(`170 25만 원`의 170)는 '번' 없는 번호가 된다.
     단 'N번'이 있는 문장에서는 빠진 수를 설명할 수 없으니 줄이 애매(가격 null) — 그래서 골든 `15번 라울 174 28만 원`·`15번 핑크프릴 3 5만 원`(LOW·가격 없음)은 그대로 통과한다.
  4. '번' 없는 번호가 서로 다르게 둘 이상 → 번호 비움(`heardNumbers`에 다 나옴). 같은 수 되풀이는 하나.
- 골든: voice-extract.yaml 120사례·voice-register 54사례 모두 통과(부딪힘 없음). 단위 시험 `108 bts 10만 원 → 확정 아님` 기대는 새 요구로 108번 확정으로 바꿨다.
- 위험: 방송 말에 섞인 '번' 없는 수(`자 10 이거 10만 원`, `백일`)가 번호로 읽혀 바로 등록될 수 있다(되돌리기로 고침). 단위 목록 밖 단위(`3 송이`는 막음, `3 포트` 등은 못 막음)도 마찬가지.

### dev-device 추가 2 — D-V3-23·D-V3-24 판정 반영 (spec da8b3857)
- '번' 없는 번호를 R-17 3 문장에 맞춤
  - 끝말은 `은 는 이 가 요`만 허용한다(앞서 넣은 `이요 이에요 입니다`는 뺐다).
  - 단위 낱말은 스펙 목록과 정확히 맞춘다(다음 토큰 그대로 또는 끝말 뗀 모양이 같을 때만 — 앞 글자 일치 방식은 뺐다).
  - 끊어 말한 번호를 더했다: 후보 앞 토큰을 붙여 R-15로 읽히면 no = null(`백 육십팔`, `1 68`).
  - 원 가격 줄에서 앞 토큰을 뗄 수 있는 조건에 "꼬리 첫 토큰이 단위만인 토큰이 아님"을 더했다(`1.5 만원`).
  - 품종 추측의 번호 토큰은 `no`와 같은 값의 첫 후보다.
- 골든 사례 수를 정확한 값으로 단언한다(D-V3-24 (3) — "81 이상"은 되돌렸다). 바꾼 곳은 아래 넷이다.
  - `packages/voice/test/sms.test.ts`: 141
  - `packages/voice/test/v3-register.test.ts`: voice-register 58
  - `packages/core/test/golden/voice-extract.test.ts`: 141
  - `packages/core/test/golden/core-adapter.test.ts`: 파서 693 · 통과 852
  - core 시험 파일 둘은 dev-core 영역이지만 D-V3-22 (c)가 dev-device에 배정했다.
- `pnpm golden` 통과: 파일 39 · 파서 693 · 엔진 159 · 통과 852 · 불일치 0.

### dev-device 추가 3 — 적대 지적 TD-V3-001·002 (48e183d4)
- TD-V3-001 고침: 자리 읽기('번' 없음)에도 번호 후보 조건을 적용한다.
  - 붙어도 되는 끝말은 은·는·이·가·요뿐이다.
  - 다음 토큰이 단위 낱말이면 후보가 아니다.
  - `일육팔에`·`일육팔까지`·`일육팔이에요`·`일육팔 개`·`일 육 팔 개`·`일육팔 마리` → 번호 없음.
  - 자리 읽기 토큰은 지금처럼 가격 줄·품종 창에서는 뺀다.
- TD-V3-002 고침: 원 가격 줄에서 앞 수를 떼는 것은 **자리 겹침**일 때만 한다.
  - 자리 겹침 = 뗀 수의 가장 낮은 0 아닌 자리 ≤ 꼬리 첫 토큰 수 부분의 가장 높은 자리.
  - `170 25만`(십의 자리 겹침) → 170 떼기.
  - `3 5만`·`174 28만`(일의 자리 겹침) → 떼기. 'N번'이 없을 때만 그렇다.
  - `100 5만 원`·`이백 오만 원`·`육백 삼만원`·`자 300 2만 원` → 자리는 안 겹치는데 R-14(D-032)로 안 읽힌다 → 줄이 애매하다(가격·번호 비움).
  - 스펙 R-17 4 "j = 1부터 처음 읽히는 꼬리" 문장에 이 조건을 더해야 한다 — 스펙 관리자 반영 필요.
- 중간 결과 끝의 수 낱말: `readyToRegister`·`readRegistration` 옵션에 `isFinal?: boolean`을 더했다.
  - **화면 담당은 중간 결과를 넣을 때 `isFinal: false`, 최종 결과(덩어리 끝)일 때 `isFinal: true`를 넘긴다.**
  - `false`면 글 맨 끝 토큰이 수 낱말(숫자·한글 수 글자로만 된 토큰)일 때 확정하지 않는다(`25만 원 1`·`25만 원 이십`).
  - 생략하면 끝 낱말을 보지 않는다. 오케스트레이터는 기본 false를 제안했지만, 적대 시험 AC-V3 사례 표("자 9cm에 이거 25만 원 170" → k=6 확정, 옵션 없이 부름)가 지금 스펙대로 확정을 기대해서 생략 = 지금 스펙으로 두었다.
  - 스펙 관리자가 기본값을 정하면 맞춘다.
- 하지 않은 것: "띄어 쓴 한 글자 한글 수 자리 읽기(`이 삼 일`)는 '번'이 붙을 때만 번호". 골든 voice-extract `일 육 팔 라울 만원` → 168(HIGH)·`일 육 팔 이십오만 원` → 168과 부딪혀 넣지 않았다. 스펙 관리자 판정 필요.

### dev-device 추가 4 — D-V3-25~28 (spec 1cbfc0b8)
- D-V3-26: 확정 읽기 옵션 이름은 **`final`**(`isFinal`은 없앴다).
  - `readyToRegister(text, { dictionary, final })`·`readRegistration`에 쓴다. 생략 = 중간 결과.
  - 중간 결과에서 `no`가 '번' 없는 번호이고 그 후보 토큰이 글의 마지막 토큰이면 확정이 아니다(`25만 원 1`·`25만 원 이십`).
  - 'N번'은 글 끝이어도 바로 확정이다.
  - **화면 담당: 최종 결과(덩어리 끝)를 읽을 때 `final: true`를 넘길 것.**
  - 추가 3에 적은 "글 끝의 아무 수 낱말이면 막음"은 스펙대로 좁혔다.
- D-V3-27: 띄어 쓴 한글 한 글자가 든 자리 읽기 셋(`일 육 팔`·`이 삼 일`)은 '번'이 붙을 때만 자리 읽기다. '번'이 없으면 자리 읽기가 아니고 보통 토큰이 된다.
  - `일 육 팔 이십오만 원` → 줄이 애매해 번호·가격 모두 비움.
  - 숫자 셋 `1 6 8`은 '번' 없이도 그대로 번호다.
- D-V3-25(자리 겹침일 때만 떼기)는 추가 3에서 이미 구현했다. D-V3-28은 구현 그대로다(이어진 같은 번호는 한 덩이).
- 사례 수 단언: sms.test·core voice-extract.test 149, core-adapter 파서 701·통과 860, voice-register 파일 2·사례 62.
- 패키지 단위 시험 손봄(규칙이 바뀐 것을 따라감):
  - extract.test의 끊어 말한 번호 속성 시험 판정 함수에서 자리 읽기 ⓑ + 번(`1 1 5번` → 115번, D-V3-11 "끊어 말한 번호 검사 안 함")을 뺐다. 무작위 반례로 드러났다.
  - v3-register의 `일 육 팔` 기대를 D-V3-27로 바꿨다.
- 적대 tests/adversarial/v3 남은 실패 2건은 시험이 D-V3-26·27보다 먼저 써졌기 때문이다(test-domain 몫).
  - "일 육 팔 bts 25만 원 → 168번 확정"(TD-V3-001 회귀 짝): D-V3-27로 이제 번호 없음이다.
  - 사례 표 "자 9cm에 이거 25만 원 170 → k=6 확정": D-V3-26으로 중간 결과 끝의 '번' 없는 번호라 k=6에서 확정되지 않는다. 최종 결과(`final: true`)라야 확정이다.

### dev-device 추가 5 — 실방송 3차 위험 사례 (오케스트레이터 지시, 판매자 안전 우선)
대상 문장: "… 65만 원까지 … 나왔네요 자 60 어 자"가 60번 · "나왔네" · 650,000원으로 바로 등록됐고, 38번이 "설비"·"나왔네"·6,050,000원으로 자동으로 고쳐졌다.
1. **품종 추측**
   - `readRegistration`에 `safeGuess`를 더했다. 추측(R-17 7 `guess`)이 같은 덩어리에 후보 낱말로 두 번 이상 나왔고 말끝 모양(`looksLikePredicate` — …습니다·니다·는데·어요·아요·해요·네요·죠·네·요·다·고·게·서·데·해·어·지)이 아닐 때만 값이 있다.
   - `ready.name`은 사전 이름 ?? `safeGuess`다. **화면은 카드에도 `guess` 대신 `safeGuess`를 쓰길 권한다.**
   - `guessVariety`·`guess`는 골든(variety-guess) 그대로다.
2. **추측 품종으로 이미 있는 상품을 건드리지 않는다**
   - `decideForExisting`에서 `nameNeedsCheck: true`인 품종은 없는 것으로 본다. 채우기·바꾸기 모두 없다(그래서 FILL_NAME·AUTO_FIX에 이름이 들어가지 않는다).
   - 사전 이름만 채우거나 고친다.
   - `decideSameNumber`(R-22 골든)는 그대로다. 골든 G-VSN-V3-03 "빈 품종을 추측으로 채움 → AUTO_FIX"와 화면 판단이 달라졌다 — **스펙 판정 필요**.
3. **numberFrom**
   - `ReadyRegistration.numberFrom: 'marker' | 'bare'`, `RegistrationReading.numberFrom: 'marker' | 'bare' | null`을 더했다.
   - `decideForExisting`의 heard에 `numberFrom?`를 받는다. `'bare'`면 바로 고치지 않는다. 바뀔 칸이 없으면 IGNORE, 있으면 ASK다(FILL_NAME도 ASK).
4. **가격 크기**
   - 바로 등록 가격 상한은 `AUTO_REGISTER_PRICE_MAX` = 3,000,000원이다. 넘으면 `ready` = null, `blocked` = `'PRICE_TOO_HIGH'`다(카드에 "가격 확인 필요").
   - 바로 고침은 새 가격이 기존의 3배(`AUTO_FIX_PRICE_RATIO`)를 넘거나 1/3 미만이면 ASK다.
5. **원 가격 줄 뒤의 '번' 없는 번호**
   - `no`가 '번' 없는 번호이고 그 후보 토큰이 어떤 원 가격 줄보다 뒤에 있으면 바로 등록하지 않는다. `blocked` = `'BARE_NUMBER_AFTER_PRICE'`, 카드만 보여 준다.
   - real-broadcast R34 "자 9cm에 이거 25만 원 170"(final)도 이제 카드다(D-V3-23 사례 — **스펙 판정 필요**).
   - `170 25만 원`처럼 번호가 가격 앞이면 지금처럼 바로 등록된다.
- 골든·적대와 부딪히는 사례:
  - 골든 voice-register `same-number.json` G-VSN-V3-03: `decideSameNumber`는 그대로 통과한다. 화면용 `decideForExisting`만 추측으로 채우지 않는다.
  - real-broadcast 1 "108번 bts …" 기대 "bts(품종 확인 필요)" → 이제 품종 없음(bts가 한 번만 나옴).
  - 적대 v3 "15번 999 만 9천9백 원 → 9,999,900원 바로 등록" → 300만 원 상한으로 카드만(blocked PRICE_TOO_HIGH).
  - 적대 v3 사례 표 "자 9cm에 이거 25만 원 170 → k=6 확정" → 카드만(앞서부터 실패하던 건과 같은 사례).
  - `pnpm golden` 불일치는 없다(155사례 통과).

### dev-device 추가 6 — D-V3-30~34 (spec 960d30d4), TE-V3-001·004
- `guessVariety`는 D-V3-30을 따른다: 두 번 이상 나온 후보 낱말만 품종 추측이 된다. 낱말이 다·요·죠·네·까·고·게·서·면·데로 끝나면 후보가 아니다(`PREDICATE_END_CHARS`). 번호 앞뒤 낱말을 보던 규칙은 없앴다. `safeGuess`는 이제 `guess`와 같다(옛 이름이라 남겨 둠).
- `decideSameNumber`는 R-22 새 입력을 받는다.
  - `heard.numberFrom?: 'MARKER' | 'BARE'`(없으면 MARKER)를 받는다. BARE면 `ASK`이고 까닭은 NUMBER_BARE다.
  - 가격이 바뀌면 PRICE_JUMP를 본다: 새 가격이 3배를 넘거나 1/3 미만이거나 300만 원을 넘으면 `ASK`다. 딱 3배와 300만 원은 받는다.
  - 추측(GUESS)은 이미 있는 상품의 품종을 채우지도 바꾸지도 않는다.
- `decideForExisting`은 `decideSameNumber` 위에 얹었다. heard의 `numberFrom: 'marker'|'bare'`와 `nameNeedsCheck`를 R-22 입력으로 바꿔 넘긴다.
- D-V3-34 "가격 뒤의 '번' 없는 번호"는 처음 나온 후보 토큰과 첫 원 가격 줄을 견준다(스펙 문장대로 좁힘).
- TE-V3-001: 삼광색금 별칭을 AC-V3-05 목록 그대로 맞췄다(삼강색금·삼강세금·상강색금·상관세금·삼광세금).
  - 실방송 3 문장을 낱말 하나씩 늘려 넣으면, 처음 확정되는 때(k=11) 품종이 이미 삼광색금이다. 단위 시험으로 확인했다.
  - 이제 추측은 두 번 나와야 하고, `상관 세금`은 별칭에 정확히 맞는다. 그래서 '상관'으로 먼저 등록되는 일이 없다.
- TE-V3-004: `withObject`(target.ts, 이제 index.ts로도 내보냄)가 로마자·숫자의 읽는 소리로 받침을 본다.
  - `bts` → "bts를", L·M·N·R은 "을".
  - 숫자는 0·1·3·6·7·8이면 "을", 나머지는 "를".
- 사례 수: voice-register 80(variety-guess 42, same-number 38). `pnpm golden` 불일치 0, tests/adversarial/v3 100개 통과.
- 남은 device 몫(acceptance에 [device]로 적혔는데 packages/voice에 아직 없음): AC-V3-06 `mergeIntoCard`, AC-V3-07 `resolveVoiceSettings`의 `voice.autoRegister`, AC-V3-08 할 일 고르기 확장(`otherNumber`·`undoRegistered`), AC-V3-09의 `readSure`. 화면 담당이 apps/web/src/voice/instant.ts에 비슷한 것을 만들었다 — 어느 쪽에 둘지 오케스트레이터 판단 필요.

### dev-device 추가 7 — AC-V3-06~09 [device] 함수 (packages/voice, index.ts로 내보냄)
- `mergeIntoCard(card, reading: ChunkReading, registration?: RegistrationReading | null, options?: { maxNumber? }): { card, changed, autoDue, reason }` (AC-V3-06)
  - 판단은 controller.ts `#mergeCard`와 같다: 손댄 카드는 그대로이고 까닭은 `MERGE_TOUCHED_REASON`("고치는 중인 카드라 바꾸지 않았어요").
  - 품종은 사전 이름이면 바꾼다. 추측은 카드 품종이 비었거나 추측(nameNeedsCheck)일 때만 쓴다. 가격은 다르면 바꾼다.
  - acceptance의 `nameGuessed`는 카드의 `nameNeedsCheck`로 본다.
  - `autoDue` = 원 가격(priceSure) ∧ blocked 없음 ∧ **numberFrom = 'marker'** ∧ 번호·가격 있음 ∧ 300만 원 이하.
  - 화면 `#mergeCard`는 numberFrom을 보지 않는다(AC-V3-06 (e) "번호가 음성 N번이면"). 옮길 때 이 차이로 '번' 없는 번호 카드는 합쳐도 바로 등록되지 않는다.
- `resolveVoiceSettings(...)['voice.autoRegister']` (AC-V3-07)
  - 기본 켬이다. 끈 때(false)만 끔이고, 옛 `voice.autoConfirm`은 읽지 않는다.
  - `checkVoiceSettings`는 `voice.autoRegister`가 불리언이 아니면 문제로 돌려준다.
  - `VoiceSettings`의 이 칸은 선택(?) 칸이다 — 옛 모양 객체를 만드는 화면 시험이 깨지지 않게. 결과는 늘 채운다.
  - 화면 `readInstant(stored)`와 결과가 같다.
- `chooseInstantAction(reading: ChunkReading, { registered, handled?, registration }): InstantAction | null` (AC-V3-08)
  - `undoRegistered{nos}` | `otherNumber{no, others, message}` | `sameNumber{no}`(→ R-22) | null(V2 chooseAction 그대로).
  - controller.ts `#instantChunk` 앞부분과 같은 차례다: 취소 → 다른 번호 → 처리한 번호.
  - `otherNumberMessage`도 같은 글로 내보낸다.
- `readSure(text, options?: { dictionary, maxNumber, final }): { sure, no, price, name, guess, numbers, numberFrom, blocked }` (AC-V3-09 이름, readRegistration의 짧은 모양). 예외를 던지지 않는다.
- 단위 시험: packages/voice/test/v3-acceptance.test.ts. 무작위 1,000개 문자열에서 예외가 없음을 확인한다.

**화면이 바꿔 쓸 함수 (화면 담당이 옮김 — 지금 화면 파일은 그대로)**
| 화면(apps/web/src/voice) | packages/voice |
|---|---|
| controller.ts `#mergeCard`의 합치기 판단 | `mergeIntoCard` (autoDue에 numberFrom 'marker' 조건이 더해짐) |
| controller.ts `#instantChunk`의 취소·다른 번호·처리한 번호 고르기 | `chooseInstantAction` |
| instant.ts `readInstant(stored)` | `resolveVoiceSettings(stored)['voice.autoRegister']` |
| instant.ts `otherNumberMessage` | `otherNumberMessage` (같은 글) |
| controller.ts `#readRegistration(...).ready !== null` | `readSure(...).sure` (또는 지금처럼 readRegistration) |
| target.ts 밖에서 쓰던 조사 붙이기가 있다면 | `withObject`·`withRo` |

### dev-device 추가 8 — E2E R48 "108 12만 원 자"
- 원인: 원 가격 줄을 통째로 읽을 때 숫자를 한자어로 바꿔 붙이면 `108`+`12만` → `백팔십이만`(1,820,000원)이 R-14로 읽혀 버렸다. 자리 겹침 검사는 앞 수를 떼는 단계에만 있었다.
- 고침: 한자어로 붙여 읽기 전에 이웃한 두 토큰마다 자리 겹침(D-V3-25)을 보고, 겹치면 붙여 읽지 않는다. 결과: 108(번 없음, numberFrom bare) · 120,000원.
- 단위만인 토큰(`백`·`천`·`만원`)은 계수가 없다고 본다(`2 천 5 백 원` = 2,500원 그대로).
- 골든 불일치 0, adversarial/v3 100개 통과.

### dev-device 추가 9 — D-V3-37·38 (spec 7b0469e2), AC-V3-50
- D-V3-37: 확정 읽기의 등록 품종은 사전 맞춤 `name`뿐이다.
  - `ReadyRegistration.name` = `extraction.name`(없으면 null), `nameNeedsCheck`는 늘 false다.
  - 추측은 `RegistrationReading.guess`(= `safeGuess`)·`SureReading.guess`로만 돌려준다. 화면에서는 품종이 빈 카드의 후보 단추로 쓴다.
  - `mergeIntoCard`는 추측을 쓰지 않는다. 사전 이름과 칸 이름으로 말한 품종만 쓴다.
  - `mergeSameNumberCards`는 nameNeedsCheck 카드의 품종을 옮기지 않는다.
  - `decideSameNumber`·`decideForExisting`은 이미 사전 이름만 본다(D-V3-31).
- D-V3-38: `canLearnAlias`가 흔한 말을 배우지 않는다 — `isCommonWord`: 2글자 이하·군말·풀이말 끝 다요죠네까고게서면데·숫자가 든 글. `readLearnedAliases`는 같은 검사로 저장값에서도 버린다.
- AC-V3-50 "15번 보니까 만오천 원 → 품종 미입력"을 맞추려고 하나 더 했다. **스펙 관리자 확인 필요.**
  - 기본 사전에 `보니타`가 있어, 배운 별칭을 버려도 R-17 5 비슷함(자모 거리 1/6)으로 `보니까` → 보니타가 됐다.
  - 그래서 풀이말 끝 모양 창은 비슷함 맞추기에서 뺀다(extract.ts findVariety. 공백만 다른 정확한 맞춤은 그대로).
  - 골든 155사례는 그대로 통과한다. 처음엔 2글자 이하도 뺐는데 골든 `15번 나울 오천 원 → 라울`이 깨져 풀이말 끝만 남겼다.
  - 이 내용을 R-17 5 문장에 더해야 한다.
- 낱말 목록(정정 표시·취소·칸 이름·군말·풀이말 끝)은 새 파일 `src/words.ts`로 옮겼다. 사전·정정·등록이 서로 가져오며 생기는 고리를 막으려는 것이다. 내보내는 이름은 그대로다.
- 단위 시험 손봄(규칙 변경을 따라감):
  - v2-units "200개 넘으면 오래된 것부터": 들은 말을 숫자 없는 3글자 이상으로 바꿨다(D-V3-38).
  - v3-register 실방송 2: 품종을 null로 바꾸고 guess bts를 따로 확인한다.
  - v3-acceptance (c2): 빈 카드에 추측을 채우지 않는다.

### dev-device 추가 10 — D-V3-41 (spec fcb3880a), AC-V3-51, '자보' 사례
- `isCardWorthy`는 `no ≠ null`일 때만 참이다.
- `chooseAction`이 새 context 칸 `registration?: { heardNumbers, blocked }`를 받는다. 화면은 같은 덩어리의 `readRegistration` 결과를 넘긴다.
  - 서로 다른 번호 둘 이상 → `discard`, 까닭 `manyNumbersReason([189, 139])` = "번호가 여럿 들렸어요: 189·139".
  - '번' 없는 번호가 가격 뒤(`blocked` = `BARE_NUMBER_AFTER_PRICE`) → `discard`, 까닭 `VOICE_LOG_REASONS.numberAfterPrice` = "번호가 가격 뒤에 들렸어요".
  - 번호 없음(품종·가격은 있음) → 이어 채우기만 한다. 채울 카드가 없으면 `discard`, 까닭 `VOICE_LOG_REASONS.noNumber` = "번호를 못 들었어요".
  - `registration`을 생략하면 번호 둘·가격 뒤 검사는 하지 않는다(번호 없음 검사는 한다).
- `ASK_PRICE`·`ASK_NAME_PRICE` = "가격을 말하면 바로 등록돼요"(번호만·품종만 있는 카드). V2 단위 시험 S3 문구 기대를 D-V3-41로 바꿨다.
- '자보' 사례: 최신 코드로 재현하면 그 문장은 번호 없음 → 카드 없음이고, 추측도 쓰지 않는다.
  - '자보'는 군말 토큰 `자`와 다음 토큰을 이은 창에서 맞춰진 것으로 본다. 그래서 군말 토큰을 품종 창에서 뺀다(extract.ts, words.ts `isWindowFiller`).
  - 빼는 토큰: 한 글자 군말 자·네·예·어·음·응·요·좀·막·또·뭐·얘·쟤·걔, 그리고 R-17 7 군말. 끝말 은·는·이·가·을·를·요·도·랑을 뗀 모양까지 본다.
  - 골든 159사례는 그대로 통과한다(`나울→라울` 포함). **R-17 5 창 문장에 더해야 한다 — 스펙 관리자 확인 필요.**

### dev-device 추가 11 — D-V3-44 (spec 5a2e5e02)
- `chooseAction` context에 `autoRegister?: boolean`을 더했다(생략 = 끔 = V2 그대로). `registration`에 `priceSure`를 넘기면 원 가격 판단에 쓴다(readRegistration 결과 그대로 넘기면 된다).
- **켬일 때**
  - 번호는 확정인데 원 가격이 없는 결과(번호만, `만오천`처럼 원 없는 가격, 애매해 비운 가격)는 카드를 만들지 않는다.
  - 대신 할 일 `{ kind: 'discard', reason: '가격을 못 들었어요', cancelled: false, remembered: { no, name, price, confidence } }`를 돌려준다. 새 kind를 만들지 않은 것은 화면 할 일 표(controller.ts LOG_ACTION)를 깨지 않으려는 것이다. 화면은 지금처럼 버림으로 기록하면 된다.
  - 같은 덩어리 안의 "기억"은 덩어리 글 전체를 다시 읽는 확정 읽기(`readRegistration`)가 맡는다. 원 가격이 들리는 순간 바로 등록된다.
  - 덩어리 사이 이어 채우기는 하지 않는다. 번호 없는 덩어리는 "번호를 못 들었어요"로 버린다.
  - 원 가격이 있는 카드(300만 원 넘음, 정정 덩어리 새 카드)는 그대로 카드다.
- **끔일 때**: V2 할 일과 문구 그대로다. `ASK_NAME_PRICE` = "품종·가격을 말해 주세요", `ASK_PRICE` = "가격을 말해 주세요"(D-V3-41에서 바꿨던 "가격을 말하면 바로 등록돼요"는 되돌렸다). 이어 채우기도 V2 그대로다.
- `chooseInstantAction` context에 `autoRegister?: boolean`(생략 = 켬)을 더했다. `false`면 늘 null이다.
- 단위 시험: R25·R51·R52·R53과 켬일 때 300만 원 넘음 카드(v3-acceptance.test.ts).
- 적대 v3 "R51 "15번" → 작은 카드 하나 '가격을 말하면 바로 등록돼요'"가 D-V3-44로 바뀐 기대라 실패한다 — test-domain 몫.

### dev-device 추가 12 — TD-V3-003 (6ecfad4e)
- 켬에서 정정 덩어리의 새 카드는 덮은 가격이 **원 가격 줄**에서 읽혔을 때만 남긴다. 원 없는 정정("15번 만오천 아니 만팔천" 등)은 버리고 까닭은 "가격을 못 들었어요"다. "15번 만오천원 아니 만팔천원"은 그대로 카드 15번 18,000원이다.
- `RegistrationReading.wonPrices`(원 가격 줄 값, 겹친 값은 한 번)를 더했다. `chooseAction`의 `registration`에 readRegistration 결과를 그대로 넘기면 이 칸을 쓴다.
- tests/adversarial/v3 141개 통과.

### dev-device 추가 13 — 실방송 7차 품종 사전 추가 (사용자 확인 필요)
- 추가: 녹금(별칭 녹색금·록금), 빅뱅, 청개구리, 청수박, 로제스타수박(별칭 로제스타).
- 빅뱅은 빅뱅금과 별개 이름이다(겹침 규칙에 걸리지 않음). "빅뱅 금"·"빅뱅금"은 품는 이름 규칙으로 빅뱅금, "빅뱅"만 말하면 빅뱅이다.
- "판매자 채팅에 나온 이름들"은 채팅 원문을 받지 못해 넣지 못했다. 목록을 주시면 추가한다.
- 영향: 실방송 화면 사례 문장("… 청개구리 …")의 사전 이름이 이제 청개구리다(번호가 없으니 카드는 그대로 없음). 골든 불일치 0, adversarial/v3 141개 통과.

### dev-server — X1 상태 흔들림 (실방송 2026-10-25 16:1x, 사용자 "연결 끊겼다가 붙었다가 반복")
- **원인**: 확장 서비스 워커(`apps/extension/src/hub.ts`)와 서버(`/ext/status`, 판매자마다 한 줄)가 모두 **마지막으로 보고한 프레임 하나**로 상태를 정했다. 채팅 프레임마다 10초마다(또 탭 숨김·보임 때) 따로 보고하므로,
  1. 같은 영상의 시청 페이지 안 채팅 iframe(보임)과 팝아웃(뒤에 있음)이 번갈아 보고 → 받는 중 ↔ "앞으로 꺼내 두세요"가 몇 초마다 바뀜.
  2. 끝난 다른 방송(JbBfRCRKtE8)의 팝아웃이 남아 보고 → 워커의 "지금 영상"이 그 영상으로 바뀌어 "어느 회차로 받을지 골라 주세요"(이어지지 않음), 서버에는 그 창의 숨음이 쓰여 콘솔도 HIDDEN.
  3. 탭을 잠깐만 바꿔도 바로 경고.
- **고친 것 (확장)**: 프레임(탭 번호·프레임 번호)마다 마지막 보고를 두고 합쳐 정한다.
  - 지금 영상 = 열린 프레임의 영상 중 끝나지 않은 것, 회차에 이어진 것 > 모르는 것 > 이어지지 않은 것, 같으면 마지막으로 보인 것.
  - 지금 영상이 아닌 프레임의 보고는 서버로 보내지 않는다(서버 받은 때를 새로 쓰지 않아 진짜로 끊기면 그대로 STALE).
  - 서버로 보내는 hidden = 그 영상의 **어느 프레임도** `HIDDEN_WARN_MS`(30초) 동안 보이지 않았는가. read/unread는 그 영상 프레임들의 합.
  - 숨은 채 30초가 되는 때에 배지를 다시 보는 타이머를 건다(그사이 보고가 없어도 경고가 늦지 않게).
  - `FRAME_GONE_MS`(90초) 보고가 없는 프레임은 닫힌 것으로 본다.
  - 401(토큰 끊김)·STALE·UNREADABLE은 전처럼 바로 알린다.
- **시간 값 근거**
  - `HIDDEN_WARN_MS = 30_000`: 보고 간격 10초 × 3. 서버 STALE 30초(D-X1-11)와 같은 크기라 경고 둘의 늦음이 같다. 잠깐 다른 탭을 보는 것은 경고하지 않는다.
  - `FRAME_GONE_MS = 90_000`: 크롬은 5분 넘게 뒤에 있는 탭의 타이머를 1분에 한 번까지 늦춘다. 1분 + 여유 30초. 이보다 짧으면 뒤에 있는 팝아웃이 "닫힘"으로 보였다 다시 나타나며 지금 영상이 바뀔 수 있다.
- **고친 것 (서버, 옛 확장도 막게)**: `ExtensionService.status`는 보고한 영상이 이어지지 않았고 다른 영상이 끝나지 않은 회차에 이어져 있으면 상태 줄을 쓰지 않고 지금 상태만 돌려준다.
- **스펙과 다른 점 (spec-keeper 확인 요청)**: SPEC YT-10 AC7은 "채팅 탭이 뒤로 가면 … 보인다"이고, AC-X1-18 단위 시험은 숨는 즉시 경고를 기대했다. 이제는 30초 이어질 때만 경고한다(오케스트레이터 지시, 실방송 흔들림). `apps/extension/test/hub.test.ts`의 AC-X1-18 시험을 "30초 이어지면"으로 바꿨다. D-X1-11에 숨김 기다림 30초와 "여러 프레임을 합쳐 정함"을 넣어 주세요.
- **남은 것**: (아래 "추가"에서 서버 쪽 기다림을 넣었다.) 5분 넘게 뒤에 있는 탭만 남으면 보고가 1분에 한 번이라 콘솔이 HIDDEN ↔ STALE로 바뀔 수 있다(둘 다 경고). 실제 크롬에서 frameId·숨김 전환은 아직 직접 확인하지 못했다(가짜 크롬 API로 시험).
- 시험: `apps/extension/test/hub.test.ts` "X1 상태 흔들림" 5개(고치기 전 코드에서 4개 실패 확인), `apps/server/test/x1-extension.test.ts` "X1 상태 흔들림" 1개.

### dev-device 추가 14 — D-V3-46~49 (spec 9633223a), 실방송 8차
**화면이 한 덩어리에서 여러 번 등록하는 API** — `readSegments(text, { dictionary, maxNumber, final, priceUnit })` → `{ tokens, picks, others, tail, rest }`
- `picks[]` = `{ no, price, name, numberFrom: 'marker'|'bare', priceFrom: 'won'|'quick', start, end, blocked }`. 앞에서부터 조각마다 하나다.
  - 화면은 결과가 올 때마다(중간 결과 포함) 덩어리 글 전체로 부른다. 아직 처리하지 않은 pick마다 한 번 바로 등록하거나, 이미 있는 번호면 R-22를 탄다.
  - `blocked: 'PRICE_TOO_HIGH'`면 카드만 만든다.
  - 같은 글 앞부분은 늘 같은 pick을 낸다. 그래서 `${no}@${start}`나 지금처럼 덩어리 안 번호로 거르면 된다.
- `others` = 버렸거나 짝을 못 찾은 다른 'N번'이다(고른 번호와 다른 값). 덩어리 끝에 "N번으로 등록했는데 M번도 들렸어요" 알림에 쓴다(`otherNumberMessage`).
- `tail` = 고른 뒤 남은 조각이 정정·취소로 시작하고 'N번'이 없으면 `{ kind: 'correction'|'cancel', no, text }`. 정정이면 `readChunk(text)` 결과로 그 번호에 R-22를 적용하고, 취소면 되돌린다.
  - 실방송 8차 반영: 정정 표시 바로 뒤(군말 건너)에 원 가격 줄이나 사전 품종이 와야 정정으로 본다. "55번 … 만 원 아니 가격이 좀 있는 거부터…"는 정정이 아니고, "55번 만 원 아니 만오천 원"은 정정이다.
- `priceUnit`은 그 방송 판매 규칙의 `price.unit`이다. "N번 사전품종 수" 꼴(D-V3-48)에 쓴다.
  - 수 토큰이 중간 결과 글의 마지막이면 기다린다.
  - "가격 뒤 번호"(`… 10만 원 108번`)는 `final: true`일 때만 짝짓는다.
- 기존 `readyToRegister`·`readRegistration`·`readSure`는 덩어리 전체를 한 번 읽는 옛 판단으로 그대로 둔다. 바로 등록 판단은 `readSegments`로 바꿔 주세요.

**그 밖**
- D-V3-47: `decideSameNumber`는 `priceSure` 거짓인 가격을 바꿀 칸에서 뺀다. 바꿀 칸이 없으면 `IGNORE`/`PRICE_NOT_SURE`(가격이 달랐을 때), 같으면 null이다. 골든 same-number 41 통과.
- R-23 `readSellerNote(text, { maxNumber })` → `{ no, name, price } | null`(src/seller-note.ts). 서버가 주인 배지 채팅에 쓴다. 골든 seller-note 22 통과, 무작위 1,000개 예외 없음.
- voice-register 사례 수 단언: 파일 3 · 사례 105.
- 단위 시험: packages/voice/test/v3-segments.test.ts(R54~R64, 실제 방송 2·3·4·6, 일육팔, 실방송 8차, 조각 경계 `end` 단언).
- **위험(실방송 8차)**: "84번 누르셨네요"처럼 시청자 찜을 말하는 'N번'이 섞이면, 원 가격 바로 앞의 가장 뒤 'N번'이 짝이 된다. 이 사례에서는 85번 · 10,000원이 맞게 됐지만, 판매자가 가격을 말한 뒤 시청자 번호를 읽고 다시 가격을 말하면 시청자 번호로 등록될 수 있다. 스펙대로 두고 84번은 알림에 나온다.
- 적대 v3 `guess-same-number` 두 시험(AC-V3-61 조합 모델)은 D-V3-47 전 모델이라 실패한다(priceSure 거짓 + 가격 다름 → 옛 기대 ASK, 골든·스펙은 IGNORE/PRICE_NOT_SURE) — test-domain 몫.
- **추가 (코디네이터 재확인: 07:29 콘솔이 RECEIVING → HIDDEN 4초 → RECEIVING)**
  - 원인: 연습 서버와 사용자 크롬의 확장이 825ea090 전 빌드였다. 그 빌드는 프레임의 숨김을 그대로 `/ext/status`로 보냈고, 서버는 그것을 바로 HIDDEN으로 썼다.
  - 825ea090부터 확장이 `/ext/status`로 보내는 hidden은 이미 합치고 기다린 값이다. 그 영상의 어느 프레임이라도 30초 안에 보였으면 false다(시험 `AC-X1-18 …`·`같은 영상의 … 서버에 숨음을 보내지 않는다`). 그래서 확장만 새로 고치면 옛 서버에서도 흔들리지 않는다.
  - 서버에도 같은 기다림을 넣었다. `HIDDEN_WARN_MS = 30_000`이고 `stateOf(status, hasLive, now, hiddenSince)`가 HIDDEN을 정한다.
    - HIDDEN은 숨음 보고가 30초 이어지고, 마지막 채팅이 30초보다 오래됐을 때만이다(채팅이 들어오면 읽기가 되고 있으니 받는 중).
    - 숨음이 시작된 때는 판매자마다 메모리(`#hiddenSince`)에 둔다. 서버를 다시 켜면 그때부터 다시 센다(경고가 늦을 뿐 거짓 경고 없음). 열은 더하지 않았다.
    - 바뀌는 때(숨음 시작 + 30초, 마지막 채팅 + 30초)에 다시 보고 알린다.
  - 둘 다 새 빌드면 콘솔 HIDDEN은 실제 숨김 뒤 약 60초(확장 30초 + 서버 30초)에 뜬다. 배지는 30초. 판매자에게 조용한 쪽으로 두었다. 줄이려면 서버 기다림을 10초로 줄이는 방법이 있다 — spec-keeper가 D-X1-11에서 정해 주세요.
  - 서버 시험 `탭이 뒤로 간 채 30초 이어지면 HIDDEN …`의 기대를 "바로"에서 "30초 이어지면"으로 바꿨다. 시험 하나를 더했다: 잠깐 숨음·채팅 들어오는 동안 받는 중.

### dev-server — D-V3-49·R-23 판매자 채팅 품종 글 (AC-V3-55 서버 몫)
- **읽는 곳**: `Service.ingestYoutubeBatch`(공식 수집기·확장 `/ext/chats` 둘 다 이 길). 채팅 이벤트가 커밋된 **뒤**, 이번에 새로 기록된 채팅 중 `ownerSure`인 것만 `readSellerNote(text, { maxNumber: 그 방송 스냅샷 claim.maxNumber })`(packages/voice)로 읽는다. 서버에 규칙 복제 없음.
  - 공식: `isChatOwner` = 확실.
  - 확장 (D-V3-62): 회차에 묶인 영상의 채팅에서 owner로 기록한 글이면 확실 — 회차 채널을 몰라도(확장만 쓰는 판매자) 읽는다. 회차 채널을 알고 다르면 owner가 아니라(ownerDenied) 읽지 않는다. 묶이지 않은 영상의 채팅은 409라 기록도 읽기도 없다.
  - 리허설 회차는 이 길로 오지 않는다(배우지 않음).
- **사전 저장**: 새 표 `seller_names`(마이그레이션 0020) — (판매자, 이름) 유일, 같은 이름은 `seen_at`만 고침, 판매자마다 2,000줄(넘으면 오래 안 본 것부터 지움). 복구는 이 표를 그대로 둔다(RESTORE_KEPT_TABLES — 백업 파일에 없음).
- **상품 고치기**: 그 방송 같은 번호 상품이 있고 `name === ''`이고 `price === ₩가격`이면 `product.update { b, no, name }`(품종만, actor server, 요청 번호 `sn_<해시(방송·채팅 ID)>`)를 writer로 기록한다 — 손 고치기(`POST /api/events`)와 같은 기록 경로·이벤트라 상품 이력(`/api/days/:date/history?b&no`)에 그대로 나온다. 범위 락 안의 상태로 한 번 더 보고(그사이 판매자가 품종을 적었으면 덮지 않음), 아니면 기록만(로그 `SELLER_NOTE` reason = FILLED·NO_PRODUCT·HAS_NAME·PRICE_DIFFERS·NOT_FILLED, 글·닉네임·품종은 로그에 없음). 배우다 실패해도 채팅 기록은 성공(로그 `SELLER_NOTE_FAILED`).
- 채팅 판정(언급)·감사·발송함은 건드리지 않는다(product.update는 효과를 내지 않음 — 시험으로 확인).

**화면이 쓸 API**
- `GET /api/voice/seller-names` (판매자 로그인, 보조자는 403 — 보조자 허용 목록에 넣지 않음) → `200 { names: string[], max: 2000 }` — 최근 본 것부터, 최대 2,000개. 이름은 2~20글자 한글·로마자·공백(R-23 4). 화면은 글자로만 그린다.
- SSE `event: voice`, `data: { kind: 'sellerNames', name }` — **새 이름**이 생길 때만(같은 이름 다시 배움은 알림 없음). 판매자의 모든 연결(보조자 포함)에 간다. 화면은 받으면 위 API를 다시 읽으면 된다(web 7da75311이 이미 이렇게 한다).
- **놓친 번호 신호 (D-V3-60, AC-V3-68 (d))**: SSE `event: voice`, `data: { kind: 'sellerNoteMissing', b, date, no, name, price, chat }`
  - 판매자 글(R-23)이 읽혔는데 그 방송에 그 번호 상품이 없을 때, 채팅 이벤트를 기록한 **뒤** 한 번 보낸다. 상품은 만들지 않는다.
  - `b` 방송 ID · `date` 범위 날짜 · `no` 번호 · `name` 품종(2~20글자 한글·로마자·공백) · `price` 원(정수) · `chat` 유튜브 메시지 ID(같은 신호 거르기용).
  - 화면 글 예: "61번이 아직 등록 안 됐어요 · 판매자 글: 61번 [녹금] ₩30,000" — 화면이 `no`·`name`·`price`로 만든다(글자로만 그린다). 원문 채팅 글은 보내지 않는다.
  - 품종이 있는 상품·가격이 다른 상품이면 신호가 없다(그 번호는 등록돼 있다).

**남의 영역**: 루트 `Dockerfile` 실행 단계에 `packages/voice`(package.json·src·node_modules)를 더함 — 서버가 이제 `@livejjim/voice`를 부른다. `pnpm-lock.yaml`에 apps/server → @livejjim/voice 링크 한 줄을 손으로 더함.
  - 확인: 저장소의 package.json 전부와 lockfile을 다른 폴더에 복사해 `pnpm install --frozen-lockfile --lockfile-only` → 통과. 그 한 줄을 빼면 같은 명령이 실패한다(검사가 실제로 본다).
  - 저장소 안에서 실제 `pnpm install --frozen-lockfile`은 돌리지 않았다(돌던 verify의 node_modules를 바꿀 수 있어서). `apps/server/node_modules/@livejjim/voice` 링크는 pnpm이 만드는 것과 같게 손으로 만들었다.
- 덧붙여 본 것(고치지 않음): 실행 단계가 `packages/documents/src`를 복사하지 않는데 서버(receipt-page.ts)가 `@livejjim/documents`의 값을 가져온다 — 이미지에서 확인 필요(orch).

### dev-device 추가 15 — D-V3-54~61 (spec 3fe41580·3b4a9dfe), 실방송 8차, TD-V3-004
- **D-V3-54 앞 수와 합치기 (상품 등록 R-17만, 음성 문자찜 R-21은 D-I4-01 그대로)**: extract.ts `mergeLeft`.
  - 번호 표시의 X 바로 앞 토큰이 수(숫자·R-15 한글 수, `이` 제외, 끝 문장 부호 없음)면 합친다.
  - 둘 다 숫자 한 개면 두 자리다(`6 3번` 63·`1 5번` 15). 아니면 앞 수의 0 아닌 가장 낮은 자리 > 뒤 수의 가장 높은 자리일 때만 더하고, 왼쪽으로 이어 더한다(`오십 삼번` 53·`60 3번` 63·`백 이십 삼번` 123).
  - 겹치면(`5 13번`·`50 13번`·`오 13번`·`오 십 번`) 번호·가격을 비운다.
  - 번호 표시 바로 뒤 한 자리 수(`60번 3 라울 만원`)는 번호만 비운다. 단 다음이 단위(`3 개`)나 금액(`2 만원`)이면 아니다.
  - `punctuatedTokens(text)`를 새로 내보냈다(끝 문장 부호가 있던 토큰). readSegments의 표시 목록도 같은 규칙이다.
- **흔한 말 별칭** — 데이터 `commonAliases`(녹금: `녹음`), `DEFAULT_COMMON_ALIASES`.
  - R-17 5 비슷함 맞추기에서는 이 낱말 창을 뺀다(`녹음` → 녹금 비슷함 1/6이 원래 맞았다).
  - readSegments의 'N번' 조각 안(번호와 원 가격 사이, "N번 품종 수" 꼴)에서만 이름으로 쓴다.
- **R-22 (D-V3-55·57·59)**
  - `decideSameNumber`: CLAIMS·3배·1/3 묻기를 없앴다. 묻는 것은 NO_AUTO·NUMBER_BARE·NOT_OPEN·PRICE_JUMP(300만 원 초과)·MAYBE_OTHER다.
  - 새 입력 `recent?: boolean`(생략 = 참). 거짓이고 찜이 있으면 ASK/MAYBE_OTHER, 거짓이고 찜이 0이면 AUTO_FIX/NOT_RECENT다.
  - `decideForExisting` context에도 `recent?`를 더했다.
- **R-24 `readRenumber(text, { maxNumber })` → `{ from, to } | null`**(src/renumber.ts): 골든 renumber 20 통과.
- **D-V3-56 기록 모아 두기**(src/archive.ts)
  - `maskArchiveText`: 8자리 이상 숫자, 끝자리·뒷번호·뒷자리·끝 자리·뒷 번호 뒤 4숫자 → `****`.
  - `createArchiveChunk`·`createArchiveExport(broadcasts, exportedAt)` → 정확히 `{ format: 'livegenie-voice-log', version: 1, exportedAt(ISO), broadcasts }`.
  - `pruneArchive(chunks, now)`(30일), `VOICE_ARCHIVE_NOTICE`.
- **TD-V3-004**: readSellerNote 가격이 0으로 시작하면(`₩0500`·`₩070,000`) null이다.
- **판매자 채팅 읽기 하위 경로**: `@livejjim/voice/seller-note`(package.json exports)를 더했다.
  - 서버(apps/server/src/service.ts)가 지금 `@livejjim/voice` 전체를 불러와 음성 경계 시험(AC-I4-04 — 서버는 음성 묶음에 기대지 않음)이 실패한다. **서버 담당: import를 `@livejjim/voice/seller-note`로 바꿔 주세요.**
  - 경계 시험은 서버에 그 경로와 package.json 의존 줄만 허용하도록 고쳤다.
- 사례 수: voice-extract 174, core-adapter 파서 726 · 통과 885, voice-register 파일 4 · 사례 138. `pnpm golden` 불일치 0.
- 단위 시험 손봄(규칙 변경을 따라감): extract.test D-I4-01 사례 6개를 합친 번호로 바꿨다. 속성 시험 두 개는 합칠 수 있는 꼴을 빼고(끊어 말한 판정 함수에 D-V3-54 반영), v3-register decideForExisting 기대를 D-V3-57로 바꿨다.
- 적대 v3 실패 7건은 D-V3-54·57 전 모델이다(test-domain 몫): "15번 1 5번 만 원 → 비움"(이제 15), R-22 조합 모델·늘 지키는 것·decideForExisting(CLAIMS·3배), 확정 읽기 성질·"25만 원 1 5번"·"25만 원 이십 오번"(이제 합쳐 15·25).

### dev-device 추가 16 — D-V3-63 (방향 확정, 스펙 작성 중)
- readSegments 빠른 꼴(priceFrom 'quick')은 품종이 없어도 된다. 조건은 'N번' 바로 뒤(군말만 사이) 수가 조각 끝이고 `final`일 때다. 수는 priceUnit으로 읽는다.
  - 품종이 있는 꼴은 지금처럼 중간 결과에서도 된다(수가 글 끝이면 기다림).
  - 품종이 없는 꼴은 덩어리 끝(`final`)에서만 된다.
- 한글 수만 된 수 토큰(`이십오`)은 숫자로 바꿔 단위를 적용한다. 만원 단위 `이십오` = 250,000원이다(R-14는 한글 수에 단위를 곱하지 않아 25원이 됐다).
- 사례(v3-segments.test.ts): "육십팔번 이십오"(final, 만원) → 68 · 250,000. 중간 결과 → 없음. "68번 25 개" → 없음. "68번 이십오 자 요거"(final) → 68 · 250,000. "92번 60"·"92번 저거 60"(final, 천원) → 60,000(R64 처음 기대를 바꿈).
- 적대 v3의 R64 두 건과 "빠른 꼴은 품종 있음" 성질은 D-V3-63 전 기대다 — test-domain 몫.
- (D-V3-63 확정 6a125c5d에 맞춤) 품종 없는 꼴에서 수가 숫자 한 개·한글 한 글자면 가격이 아니다. `68번 3`은 D-V3-54 번호 뒤 한 자리 수 규칙으로 번호도 비운다. R69~R73 단위 시험. 사례 수 176 · 파서 728 · 통과 887.

### dev-device 추가 17 — TD-V3-006 (ebb09fa1)
- `maskArchiveText`: 끝자리 낱말에 끝말이 붙어도(`끝자리는`·`뒷번호가`) 뒤 숫자 4개를 가린다. 끝말은 R-17 2 목록이다. TD-V3-005(recent가 "다른 번호를 고침"에 끊김)는 화면 controller.ts `#recentVoice` 몫이다 — web.

### dev-device 추가 18 — D-V3-64·65 (spec b276382b), R-25, AC-V3-70·71
- 가격 크기로 막거나 묻지 않는다.
  - `decideSameNumber`에서 PRICE_JUMP를 없앴다(골든 same-number 54 통과).
  - `readSegments` pick의 `blocked`는 늘 null이고 새 칸 `bigChange`를 실었다(등록 가격 > 3,000,000원).
  - `readRegistration`의 PRICE_TOO_HIGH와 `mergeIntoCard` autoDue의 300만 원 상한도 뺐다.
- `isBigChange(before: number | null, after: number)`(R-25 크게 바뀜, 정수 비교): 등록(before null)이면 > 3,000,000. 고침이면 > 3,000,000 또는 > 전 × 3 또는 × 3 < 전. 서버 기록·화면 표시에 쓴다.
- `decideForExisting` AUTO_FIX 결과에 크게 바뀜이면 `bigChange: true`가 붙는다.
- 가리기 함수 `maskArchiveText`는 그대로 내보낸다(서버 R-25 들은 말 가리기에 쓰면 됨).
- packages/documents
  - `ledgerToXlsx(rows, options?, { voiceLog })`: voiceLog를 넘기면 "음성 기록" 시트를 더한다. 열은 시각·번호·한 일·전·후·출처·찜 수·들은 말·표시이고, 기존 "판매대장" 시트·열은 그대로다.
  - 줄 모양은 `VoiceLedgerRow { at, no, toNo?, action: REGISTER|PRICE|NAME|RENUMBER|UNDO, before, after, source: voice|seller-note, claims, heard(가린 글), marks: BIG_CHANGE|WITH_CLAIMS|UNDONE[] }`이다.
  - 글은 글 칸(수식 아님), 가격은 #,##0이다.
  - 넘기지 않으면 지금처럼 시트 하나다.
- 단위 시험: 크게 바뀜 경계(AC-V3-70 숫자 그대로), documents/test/voice-ledger.test.ts. 실방송 3차 사례의 "605만 원 막음"·"300만 원 넘으면 묻기" 기대를 D-V3-64로 바꿨다.
- **추가 2 (실방송 07:57: 팝업이 "유튜브 라이브 채팅 창이 열려 있지 않아요"인데 서버는 RECEIVING·statusAt 새로움·broadcasts [])**
  - 의심 1 (코디네이터): MV3 워커가 쉬었다 깨면 메모리의 프레임 표가 비어 팝업이 NO_CHAT이 된다.
    - 고침: 프레임 표·지금 영상·처음 본 때/보인 때·이어짐·끝남을 `chrome.storage.session`(`FRAMES_KEY`)에 두고, 워커가 깰 때 읽는다.
    - 쓰기는 모양(영상·숨음·수·이어짐)이 바뀌면 바로, 보고 시각만 바뀌면 `FRAMES_SAVE_MS`(10초, 보고 간격)에 한 번이다. 그래서 90초 닫힘 기준은 세션의 마지막 보고 시각으로 보며, 많아야 10초 늦다.
    - 팝업을 열었는데 표가 비면 youtube.com 탭(host 권한으로만 찾음, 새 권한 없음 — D-X1-14)에 `ASK_STATUS`를 보낸다. content script가 곧바로 상태를 보내고, 워커는 첫 답을 `ASK_WAIT_MS`(1.5초)까지 기다린 뒤 보인다.
  - 의심 2 (더 그럴듯함): 워커는 10초 보고 때문에 보통 쉬지 않는다. 그런데도 NO_CHAT이면 보고의 영상 ID가 비어 있었다는 뜻이다(지금 영상은 v가 있는 보고로만 정해진다). 회차가 이어지지 않은 것(broadcasts [])·채팅이 오지 않는 것과도 맞는다.
    - 시청 페이지 안 채팅 iframe 주소는 `live_chat?continuation=…`이라 v=가 없다. content script는 바깥 페이지(window.top) 주소에서 꺼내는데, 못 꺼내면 v=null로 보고하고 채팅은 보내지 않았다.
    - 고침 1: content script가 `document.referrer`(같은 사이트라 시청 페이지 전체 주소)도 본다.
    - 고침 2: 워커가 v 없는 보고는 보낸 탭 주소(`sender.tab.url` — youtube.com host 권한으로 채워짐)에서 영상 ID를 꺼낸다. 상태 답 `frameVideo`로 content script에 알려 주면, 그 뒤 채팅·감사 올리기를 그 영상으로 보낸다. 영상을 알기 전(첫 상태 답 전, 1초 안쪽)에 붙은 채팅은 보내지 않는다.
  - 실제 크롬에서 iframe 주소·window.top 접근·tab.url이 어떤지는 아직 직접 보지 못했다(HG-X1).

### dev-device 추가 19 — D-V3-66 (spec 25d48ce7·08e11452)
- 앞 수와 합치기에서 이어 더하다 왼쪽에서 겹치면 문장 전체 번호·가격을 비운다(`1 이십 오번` → 비움).
- 0 토큰(`0`·`영`·`공`)은 합치기와 D-I4-01 끊어 말한 번호 검사 둘 다에서 보지 않는다(`0 5번` = 5번).
- 번호 뒤 한 자리 수가 다음 번호 표시의 앞 조각이면(`6 5번은 6 1번`) 번호를 비우지 않는다.
- 기록 가리기 끝자리 낱말에 `끝번호`를 더했다.
- R-24 `readRenumber`는 R-17 3 번호 표시(listNumberMarkers — 띄어 쓴 번·합치기)를 그대로 쓴다. 겹쳐 비우는 꼴이면 null이고, 끝 토큰의 `이야` 등 끝말은 떼고 읽는다. 골든 renumber 24 통과.
- 사례 수: voice-extract 179, core-adapter 파서 731 · 통과 890, voice-register 파일 4 · 사례 142. 골든 불일치 0, adversarial/v3 324개 통과.

### dev-device 추가 20 — 판매 말투 꼬리, D-V3-67 기다리는 번호
- 빠른 꼴(N번 + 수)의 수 뒤에 오는 판매 말투는 조각 끝으로 본다(`SALE_TAIL_WORDS`: 갑니다·가겠습니다·갈게요·가요·드릴게요·드려요·드립니다·보낼게요·보냅니다·보내요·할게요·입니다·이에요·예요·요·까지·까지요, 끝말 붙은 꼴 포함). "150번 180 가겠습니다"(final) → 천원 단위 180,000원, 만원 단위 1,800,000원. 스펙 반영 필요(오케스트레이터가 알림).
- D-V3-67 `stepWaiting({ waiting, now, piece: { markerNo, wonPrice, paired }, exists })` → `{ take, card, waiting }`, `waitingExpired(waiting, now)`, `WAITING_MS` = 60,000.
  - 화면은 덩어리마다 조각 결과로 `piece`를 만들어 넘긴다. `markerNo`는 'N번' 확정 번호, `wonPrice`는 원 가격 줄 확정 가격, `paired`는 이 조각으로 등록함이다.
  - `take`면 "이어 받음"으로 등록하고, `card`면 "가격 못 들은 번호" 카드를 만든다.
  - 60초 경계(60,000 받음·60,001 카드), 다른 N번 먼저 → 카드, 있는 번호·'번' 없는 번호는 안 기다림, 원 가격만 이어 받음.
  - 단위 시험: test/v3-waiting.test.ts(R51·R74·R75·R79·R80).

### dev-server — D-V3-68 판매자 채팅 품종 읽기 없앰 (spec 43f688ac)
- 지움: `ingestYoutubeBatch`의 판매자 글 읽기(`#sellerNotes`·`#fillFromNote`), `@livejjim/voice/seller-note` import와 apps/server의 `@livejjim/voice` 의존 줄(lockfile 줄, Dockerfile의 voice 복사 포함), `src/seller-names.ts`, `GET /api/voice/seller-names`, SSE `voice`(`sellerNames`·`sellerNoteMissing`, hub `publishVoice`), 확장·수집기의 `ownerSure`(D-V3-62 예외), 로그 코드 `SELLER_NOTE*`.
  - 위 "D-V3-49·R-23"·"D-V3-60" 항목의 API·신호는 이제 없다. 화면은 `/api/voice/seller-names`(이제 404)와 SSE `voice`를 쓰지 않아야 한다.
- 시험 `apps/server/test/v3-seller-names.test.ts`는 "없음 확인"으로 바꿈: 공식·확장(묶인 영상 owner 글) 어느 길로 주인 글이 와도 품종 미입력 상품 그대로·product.* 고치기 없음·판정 언급·감사 줄 없음·조회 404·`publishVoice` 없음.
- **표 지움 (뒤 커밋)**: `0022_v3_drop_seller_names`(DROP TABLE IF EXISTS seller_names, R-25 0021 뒤 — orch 결정), schema·복구 목록 줄 정리, commands 표 수 71→70, fb1 되돌리기 시험은 `drop table if exists seller_names`. (아래는 지우기 전 메모)
- **아직 남긴 것(지금은 지움)**: `seller_names` 표(0020)와 schema·복구 목록 줄. 지우려면 DROP 마이그레이션이 필요한데 0021 번호는 R-25 음성 기록(`0021_v3_voice_log.sql`, 다른 dev-server, 아직 커밋 전)이 쓰고 있다. 그 커밋 뒤에 `0022_v3_drop_seller_names`(DROP TABLE IF EXISTS)로 넣겠다 — 번호 순서를 orch가 정해 주면 된다. 표는 이제 쓰는 코드가 없어 비어 있다.
- R-25 쪽(`voice-log.ts`의 `seller-note` 출처, seal.ts의 seller-note 질의)은 그 작업자 몫이라 건드리지 않았다. 판매자 글 읽기가 없어졌으니 그 출처는 더 생기지 않는다.

### dev-device 추가 21 — D-V3-68 (spec 43f688ac, 서버 8e6d2146 뒤)
- R-23 판매자 채팅 읽기를 없앴다. src/seller-note.ts, package.json `./seller-note` 하위 경로, index.ts `readSellerNote` 내보내기, 골든 seller-note 러너 갈래, 관련 단위 시험(TD-V3-004·AC-V3-54의 판매자 글 부분)을 지웠다.
- readSegments 예외 없음 무작위 시험은 남겼다.
- 경계 시험(boundaries.test.ts)은 원래 규칙으로 되돌렸다 — 서버는 `@livejjim/voice`를 전혀 참조하지 않는다.

### dev-server — R-25 음성 등록·고침 기록 (D-V3-64·65, AC-V3-70)
- 표 `voice_log` (마이그레이션 `0021_v3_voice_log.sql`). (판매자, 요청 번호, 한 일) 하나에 한 줄. 출처는 `voice`만(D-V3-68로 판매자 채팅 줄 없음).
- **쓰기 (dev-web)**: 음성으로 한 `POST /api/events`에 선택 칸 `voiceLog`를 싣는다. 없으면 손 입력이라 기록하지 않는다.
  - `voiceLog = { heard: string, source?: 'voice', undo?: <되돌린 쓰기의 requestId>, device?: /^[A-Za-z0-9_-]{1,64}$/ }`
  - `heard`: 가린(maskArchiveText) 한 줄, 300글자(코드 포인트) 넘으면 400. 서버는 제어 문자를 빼고(줄바꿈 → 공백) 긴 숫자·끝자리 뒤 4숫자를 한 번 더 가린다. 모르는 칸은 400.
  - 받는 종류: `product.register`(REGISTER) · `product.update`(값이 바뀐 칸마다 PRICE·NAME 한 줄씩) · `product.renumber`(RENUMBER — `no`=from·`toNo`=to) · `product.close`(`undo`가 있을 때만 — 음성 등록 되돌리기).
  - 되돌리기: 되돌리는 쓰기(가격 되돌림 update·옮기기 되돌림 renumber·등록 되돌림 close)에 `undo: 처음 requestId`를 싣는다 → UNDO 줄이 생기고, 되돌린 줄에 `undone: true`가 붙는다. `product.register`에 `undo`를 실으면 400.
  - 기록 줄은 같은 기록 트랜잭션 안에서 상품 이벤트보다 먼저 넣는다. 반영되지 않으면 `failed: true`: 거절·저장 실패, 실패로 기록됨, 엔진이 바꾼 것 없음(없는 번호·같은 값) 모두. 같은 requestId로 다시 보내 성공하면 실패 표시가 풀린다.
- **조회**: `GET /api/voice/log?b=&date=&product=&no=&rehearsal=` (b·date 중 하나는 꼭). `{ entries: Entry[] }`, 시각순. 판매자 자기 것만 보이고 보조자는 403.
  - `b`가 없으면 실제 범위만 보인다(`rehearsal=true`면 리허설). `no`는 옮긴 줄의 전·후 번호 어느 쪽이든 걸린다. `product`는 엔진 상품 ID(번호를 바꿔도 같음).
  - `Entry = { id, at(ISO), date, rehearsal, b, product(id|null), no, toNo, kind: 'REGISTER'|'PRICE'|'NAME'|'RENUMBER'|'UNDO', before, after ({ no?, name?, price? } | null), source: 'voice', by: { kind: 'account', accountId } | { kind: 'server' }, device, claims(살아 있는 찜 수 — 확정·대기·보류·충돌), heard, big, withClaims, undone, undoOf, failed }`
  - `big`: 등록 > 3,000,000원, 가격 고침은 새 값 > 3,000,000원 · 새 값 > 전 값 × 3 · 새 값 × 3 < 전 값. `withClaims`: PRICE·NAME·RENUMBER에서 claims > 0. 노란 띠 "확인할 음성 고침 N건"은 화면이 `big || withClaims`(그리고 `!failed`)로 센다.
- **백업**: 파일 맨 위 `parcels` 뒤에 `voiceLog` 칸을 더했다. 형식 번호는 3 그대로이고, 칸이 없는 옛 파일도 읽는다. 요약값의 end 조각에는 칸이 있을 때만 줄 수가 붙는다. 검사는 칸 22개·한 일·출처·글자 수·`__proto__`·겹친 줄을 본다. 복구는 줄을 지우고 파일 것으로 다시 넣는다(RESTORE_REPLACED_TABLES).
- **판매대장**: 날짜 조각마다 `voiceLog: VoiceLedgerRow[]`(packages/documents)를 넘기고, 워커는 줄이 하나라도 있을 때만 `ledgerToXlsx(rows, options, { voiceLog })`로 시트를 더한다. 줄이 없으면 전과 같은 파일이다. 실패 줄은 시트에 넣지 않는다. 등록의 "후"는 `"품종 100,000원"` 글(품종이 없으면 가격 수)이다.
- `writer.afterInsert`에 5번째 인자 `states`를 더했다(등록 줄의 상품 ID를 채운다).
- 서버 시험 `apps/server/test/v3-voice-log.test.ts`. 교체(약화 아님): api.test(voiceLog는 엔진 필드 아님), i2-backup(맨 위 칸 목록에 voiceLog), commands(표 71개), fb1-parcel-settings(0018 모양으로 되돌릴 때 voice_log도 지움 — 0022에서 seller_names를 지우면 이 줄도 맞춰야 한다).

### dev-device 추가 22 — 빠른 꼴 말투(4b1ee23d), D-V3-70·71 (spec bad7b4d3·f6d0928e)
- 4b1ee23d: 빠른 꼴 수에 붙은 `에`·`에요`(`45에`)를 뗀다. 판매 말투에 드려볼게요·드려(+볼게요/보겠습니다)·드려봅니다·줄게요·드릴게요요를 더했다. 늘임표(`45~`)는 토큰 끝 문장 부호로 이미 지운다. 같은 수 되풀이(`자 45~`)도 조각 끝으로 본다.
- D-V3-70: 빠른 꼴은 core `parseAmount`의 `price.unit` AUTO를 그대로 쓴다. 한글 수만 된 토큰은 R-15 값을 숫자로 바꿔 넘긴다(`이십오` → 25 → AUTO 250,000원). R85~R87 단위 시험.
- D-V3-71 중간 결과 안정(src/interim.ts) — 화면이 쓰는 법:
  - `interimCandidate(text, segmentOptions)` → 중간 결과 글의 빠른 꼴 후보 `{ no, price, name } | null`. 최종이면 확정될 것만 낸다(원 가격 짝은 이미 바로 확정이라 후보가 아님).
  - `trackInterim(seen, candidate, now)` → `{ seen, stable }`. 중간 결과마다·타이머마다 부르고, `stable`이 오면 바로 등록한다(기록 "중간 글로 등록"). 999ms 아직, 1,000ms 확정. 후보가 바뀌면 새로 센다.
  - `interimFallback(seen, finalPicks, registered)` → 덩어리 끝에 최종 글에서 그 번호 가격이 사라졌으면 1,000ms 이상 보였던 후보(가장 나중 것).
  - `INTERIM_STABLE_MS` = 1,000.
  - 단위 시험: test/v3-interim.test.ts(R89~R92).

### dev-device 추가 23 — TE-V3-013, D-V3-73 (spec a91ae406)
- TE-V3-013: readSegments 짝 조각의 품종을 조각 범위(앞 조각 소비 끝, 또는 앞 'N번' 뒤 ~ 이 원 가격) 안에서 찾는다.
  - 번호보다 먼저 말한 품종도 잡는다(`… 상강 색금 … 28만 원 174번 … 28만 원` → 174번 삼광색금, `… 189번인데 … 빅뱅 금 139번 … 50만 원` → 139번 빅뱅금).
  - 앞 'N번' 바로 뒤(군말 건너)의 품종은 그 앞 번호 것이라 쓰지 않는다(`93번 청개구리 97번 23만 원` → 97번 품종 없음).
  - 흔한 말 별칭(녹음)은 지금처럼 'N번'과 원 가격 사이에서만 쓴다.
- D-V3-73: 조각 소비 뒤 남은 조각에서는 '번' 없는 번호 후보를 쓰지 않는다('N번'만). R6 → 3번 하나, R39·R40 → 덩어리 끝 15·25번 250,000원.
- 적대 v3 "실제 방송 6 … → 139번 품종 없음" 기대는 TE-V3-013 전 기대라 실패한다(이제 빅뱅금) — test-domain 몫.
- **추가 3 — RA-V3-010 (옛 채팅 프레임이 SPA로 옮긴 새 영상 ID를 받을 수 있음)**
  - 프레임의 영상 ID는 그 문서에서 한 번만 정한다.
    - content script는 v를 정한 뒤 바꾸지 않는다.
    - 워커의 프레임 이름에 `sender.documentId`(크롬 106+)를 넣었다. 같은 문서가 v 없이 보고하면 표에 둔 그 프레임의 영상을 그대로 쓴다. 탭 주소가 바뀌어도 그대로다.
    - 같은 iframe이 새 주소로 다시 열려 문서 번호가 바뀌면 새 프레임으로 본다.
  - 바깥 주소(content: window.top → referrer, 워커: 탭 주소)에서 꺼낸 영상 ID는 채팅 주소의 continuation과 맞춰 본다(`reader.ts continuationMatches/frameVideoOf`).
    - continuation은 base64 안에 base64가 든 프로토콜 버퍼이고, 안쪽에 영상 ID가 글자로 있다.
    - 판정: 그 영상 ID가 있으면 맞음. 다른 11자 영상 ID 칸만 있으면 다름이고, 버린다(v=null — 채팅을 보내지 않음, 팝업은 채팅 창 없음). 풀지 못하면 모름이고, 다르다는 증거가 없으니 쓴다.
    - "모름도 버림"으로 하면 유튜브가 모양을 바꿨을 때 시청 페이지 채팅이 통째로 안 된다. 그래서 다른 영상이라는 증거가 있을 때만 버린다. 팝아웃은 주소에 v=가 있어 이 검사를 거치지 않는다.
  - 시험: `apps/extension/test/continuation.test.ts`(구조는 pytchat liveparam과 같게 만든 가짜 continuation — 실제 토큰처럼 `0ofMyAN…`로 시작한다), `hub.test.ts` RA-V3-010.
  - 실제 유튜브 continuation에서 확인하는 일은 HG-X1 몫이다.

### dev-device 추가 24 — D-V3-75·76 (spec ec55941a), 스펙 감사 SA-V3-002·007·008·009, TD-V3-008·009
- **가리기 `maskArchiveText` 규칙 (서버가 같은 그물을 쓴다 — 이 차례 그대로)**
  1. 숫자(0-9)가 공백·`-`을 사이에 두고 이어져 8개 이상 → `****`.
  2. 자리 글자로만 된 토큰이 공백을 사이에 두고 이어지고 그 자리 수 합이 8 이상이면 전부 `****`. 자리 글자 = 숫자 0-9와 한글 공·영·일·이·삼·사·오·육·칠·팔·구. 토큰 앞뒤에 다른 한글 음절이 붙지 않아야 한다(`사이`·`오이`처럼 낱말 안의 글자는 토큰 전체가 자리 글자여도 8개 미만이면 그대로).
     - 정규식: ``(?<![가-힣])[0-9공영일이삼사오육칠팔구]+(?:\s+[0-9공영일이삼사오육칠팔구]+)*(?![가-힣])``. 공백을 뺀 길이가 8 이상일 때만 바꾼다.
  3. 끝자리 낱말(`끝자리`·`뒷번호`·`뒷자리`·`끝번호`·`끝 자리`·`뒷 번호` — 낱말 안 공백은 `\s*`) + 끝말(R-17 2 목록, 긴 것부터, 없어도 됨) + 공백 뒤 자리 글자 4개(사이 공백 허용) → `****`.
     - 조건: 그 뒤가 숫자가 아니고, 공백·끝으로 끝나는 한글 자리 글자 토큰으로 이어지지 않아야 한다(`5678이요`의 `이요`는 끝말이라 가림, `일이삼사오`는 다섯 자리라 안 가림).
- **D-V3-76**: `decideSameNumber`·`decideForExisting`(context)에 `otherDevice?`를 더했다. 참이면 NOT_OPEN 다음 차례에 `ASK`/`MAYBE_OTHER`다(찜 0이어도). 골든 same-number 58, voice-register 파일 3 · 사례 124.
- **SA-V3-002**: 사전 363개, '금'으로 끝나는 이름 48개(main 5 + 43). 청옥금·홍학금·은하수금·설국금·월광금·백야금을 더했다(사용자 확인 필요). 개수 시험 추가.
- **SA-V3-007**: documents voice-ledger 출처는 `voice`만 남겼다("판매자 채팅" 낱말·시험 사례 지움).
- **SA-V3-008**: `SameNumberReason`에서 PRICE_JUMP·CLAIMS를 뺐다. 옛 설명 문장을 고쳤고, 골든 러너는 PRICE_JUMP를 받지 않는다.
- **SA-V3-009**: `checkVoiceSettings`는 옛 키 voice.autoConfirm·autoConfirmSec의 틀린 값에 문제를 내지 않는다. V2 card.test 기대를 바꿨다. 화면 controller.ts가 이 검사로 기다리는 초 칸 오류를 보이던 곳이 있으면 이제 오류가 안 난다 — web 확인 필요.
- **적대 성질에서 찾은 것**
  - 빠른 꼴에 정정·취소 낱말이 끼면 확정이 아니다(`15번 다시 180`).
  - 자리 읽기 ⓑ + 번에서 `이번`은 번호가 아니다(`1 6 이번` → 162번이던 버그).
  - 첫 조각의 '번' 없는 번호는 첫 원 가격 줄까지의 글로만 본다(뒤에 낱말이 붙어도 이미 고른 값이 바뀌지 않음 — TD-V3-008 (d)).
- 결과: adversarial/v3 428개 통과, 골든 불일치 0.

### dev-server — RA-V3-001·003·004·009·010 (D-V3-75·77, spec ec55941a)
- RA-V3-001: `voiceLog`가 실린 `product.renumber`(되돌리기 포함)는 같은 범위 락 안의 상태로 옮길 상품에 살아 있는 찜(확정·대기·보류·충돌)이 있는지 본다. 있으면 **409 `VOICE_RENUMBER_CLAIMED`** "찜이 있는 상품이라 번호를 옮기지 않았어요."로 거절하고 이벤트는 쓰지 않으며, 실패 줄을 남긴다(`failed`, `claims`, `withClaims: true`). 손 번호 바꾸기(기록 칸 없음)는 지금처럼 R-10 그대로다. dev-web: 이 코드를 받으면 4초 안내로 같은 문장을 보여 주면 된다.
- RA-V3-003: UNDO 줄에도 그때 찜 수와 `withClaims`(> 0)를 단다. 화면 띠 셈(`big || withClaims`)에 그대로 걸린다.
- D-V3-75 그물(voice-log.ts `maskHeard`): 이어진 숫자 8개 이상(공백·`-` 허용), 이어진 한글 자리 글자(공·영·일~구, 륙 포함) 8개 이상(공백·`-` 허용), 끝자리 낱말(끝자리·끝 자리·끝번호·끝 번호·뒷번호·뒷 번호·뒷자리·뒷 자리 + 끝말) 바로 뒤의 숫자 4개 또는 자리 글자 4개(사이 공백 허용)를 `****`로 바꾼다. dev-device 규칙보다 덜 가리지 않게 맞춘다.
- D-V3-77: 봉인(실제 범위, 방송 날짜 + 30일) 트랜잭션에서 그 날짜의 실제 범위 `voice_log.heard`를 ''로 비운다. 나머지 칸은 그대로다. 화면은 `heard === ''`이고 그 날짜가 봉인됐으면 "들은 말: (지움)"으로 보여 준다.
- RA-V3-010: 확장 상태 보고(`#otherVideoReceives`)와 `view`가 묶음마다 `findBroadcast`를 부르던 것을 `liveBindings`(묶음·방송·범위를 한 번에 잇는 조회 하나)로 바꿨다.
- 조회 줄에는 `device` 칸이 이미 있다(D-V3-76의 다른 기기 판단에 쓴다).

### dev-server — 서버 그물 가리기를 dev-device 규칙(36dcd5dc, "추가 24")에 맞춤
- `maskHeard`(apps/server/src/voice-log.ts)는 "추가 24"의 규칙 1~3을 그대로 옮겼다. 끝말 목록도 packages/voice ENDINGS와 같은 목록을 복사해 두었다(바꾸면 함께 바꾼다).
- 서버만 더 거는 그물 4는 이렇다.
  - 자리 글자(숫자·한글, 륙 포함 — 섞여도)가 공백·`-`을 사이에 두고 8개 이상이면 낱말 경계를 보지 않고 가린다.
  - `끝 번호`·`뒷 자리`처럼 띄어 쓴 낱말도 끝자리 낱말로 본다.
  - 규칙 2와 그물 4는 규칙 1보다 먼저 건다. 그래서 TD-V3-010 사례("영일영 1234 5678")는 서버에서 전부 `****`가 된다.
- 무작위 30만 줄을 맞대 보니 서버가 기기보다 덜 가리는 줄은 0이었다.
- 같은 사례 표를 서버 시험(test/v3-voice-log.test.ts `SAME_AS_DEVICE`)에 넣었다. 결과는 다음과 같다.
  - "뒷번호가 5678이요" → "뒷번호가 ****이요"
  - "일이삼사오"·"15번 사이 오이 라울 만원"은 그대로다.

### dev-device 추가 25 — TD-V3-009 남은 부분·TD-V3-010 (4a966438)
- 빠른 꼴에서 정정 낱말이 붙은 토큰(`만오천말고`)이 품종 창이나 번호~수 사이에 끼면 빠른 꼴이 아니다(`15번 삼광색금 만오천말고 25만` → pick 없음). 품종 창(nameWindowEnd)도 정정·취소 토큰에서 끊긴다.
- 가리기 `maskArchiveText` 차례를 바꿨다.
  1. 자리 글자 토큰 이어짐(숫자 섞여도) 8자리 이상 → `****`. 숫자만 가리기보다 먼저 한다. 그래서 `영일영 1234 5678` → `****`.
  2. 섞인 자리 글자(륙 포함)가 공백·`-` 사이로 8개 이상 → `****`(`공일공-1234-5678`).
  3. 숫자만 8자리 이상.
  4. 끝자리 낱말 뒤 4자리. 낱말에 `끝 번호`·`뒷 자리`도 더했다.
- 서버 확인: apps/server/src/voice-log.ts `maskHeard`(작업 트리에 있음, 아직 커밋 전)는 1(DIGIT_RUNS) → 2(LONG_MIXED_DIGITS) → 3 → 4(LAST4_WORDS 8개)로, 이번에 맞춘 음성 쪽과 같은 차례·같은 정규식이다.
- 알림(서버 몫): 그 파일 주석의 "packages/voice" 글자 때문에 음성 경계 시험(AC-I4-04 — 서버는 글자로도 음성 패키지를 참조하지 않음)이 실패한다. 주석을 "음성 패키지 가리기 함수" 같은 말로 바꿔 달라.
