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
