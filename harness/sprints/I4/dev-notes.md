# I4 dev-notes

## dev-device (packages/voice, 코어 러너 합계)

### 바뀐 것 — dev-web·테스터가 먼저 알아야 할 것

1. **끊어 말한 번호 (AC-I4-01, R-17 3·4, D-I4-01)** — `extractVoice`
   - 번호 표시마다 `X` 바로 앞 토큰(붙여 쓴 꼴은 표시 토큰의 앞 토큰, 띄어 쓴 꼴은 `X` 토큰의 앞 토큰 — 끝 문장 부호를 지운 토큰 그대로, 끝말을 떼지 않음)을 `X` 앞에 공백 없이 붙인 글이 코어 `parseKoreanNumber`(R-15)로 읽히면 "끊어 말한 번호"다. 하나라도 있으면 결과의 `no`·`price` = `null`, `confidence` = `LOW`. 품종은 평소대로(번호 표시 토큰·가격 묶음 토큰은 가격을 비웠어도 품종 창에서 빠진다).
   - 그래서 `1 5번 핑크프릴 만오천 원`·`십 오번 라울 오천 원`·`백 오번 라울` 같은 문장엔 카드가 생기지 않는다(`isCardWorthy` 거짓 — 번호도, 품종·가격 짝도 없다). `이 15번`·`네 15번`은 그대로 15번(`이15`·`네15`는 수가 아니다).
   - 공개 함수·타입은 그대로다(`extractVoice(text, { maxNumber, dictionary })` → `{ no, name, price, confidence }`).
   - 코드: `packages/voice/src/extract.ts` `isSplitNumber`·`findNumberMarkers`(`split`). 시험: `packages/voice/test/extract.test.ts` "AC-I4-01" (단위 + 속성 2개 — 규칙 문장을 그대로 옮긴 시험 쪽 독립 판단과 대조).
2. **열린 카드 3장 예외 (AC-I4-02, D-I4-02)** — `addCard` 동작은 P2 그대로(코드 변경 없음). 함수 설명이 D-I4-02를 가리키게 고쳤고 단위·속성 시험을 더했다(`packages/voice/test/card.test.ts` "AC-I4-02"). 화면은 열린 카드가 4장 이상일 수 있다고 보고 그린다(상한 = max(3, 손댄 열린 카드 수 + 1)).
3. **경계 시험 (AC-I4-04)** — `packages/voice/test/boundaries.test.ts`를 바꿨다. 아래 "교체한 시험" 참고. dev-web이 지킬 것:
   - `apps/web/src`에서 `@livejjim/voice`의 값은 **한 파일**에서 **동적 `import('@livejjim/voice')`**로만 부른다(글자 그대로 `'@livejjim/voice'` — 하위 경로·상대 경로 안 됨).
   - 다른 파일은 `import type { … } from '@livejjim/voice'`(문장 전체가 type)와 타입 위치의 `typeof import('@livejjim/voice')`만 된다.
   - 안 되는 것: 정적 값 import, `import '@livejjim/voice'`, **`import { type X } from '@livejjim/voice'`**(verbatimModuleSyntax에선 빈 import로 남아 모듈을 불러온다 — `import type`으로 쓴다), `export … from '@livejjim/voice'`(type 포함), `require`, `packages/voice` 경로, 모듈 이름을 글자로 들고 다니기(`const m = '@livejjim/voice'`).
   - 주의: 저장소 ESLint의 `consistent-type-imports`(fixStyle inline)는 `--fix` 때 타입만 쓰는 import를 `import { type X } from …`로 고친다 — `@livejjim/voice`에는 손으로 `import type { X } from '@livejjim/voice'`를 쓴다(린트도 통과한다).
   - 검사는 TypeScript 구문 트리로 한다(주석 속 낱말은 괜찮다). 화면 안의 `voice` 폴더(`../voice/…`)는 음성 패키지가 아니므로 된다.
   - **지금(dev-device 커밋 시점) "동적 import는 정확히 한 파일" 시험 하나가 실패한다** — dev-web이 콘솔에 음성을 이으면 통과한다(남의 몫, 의도한 상태).
4. **정확도 측정 스크립트 (AC-I4-03, D-I4-08)** — 아래 "측정 스크립트" 참고.

### 교체한 시험 (교체 — 약화 아님)

| 시험 | 전 | 후 | 이유 |
|---|---|---|---|
| `packages/core/test/golden/core-adapter.test.ts` "실제 tests/golden 전체를 실제 코어로" | 파일 23 · 파서 448 · 엔진 121 · 통과 569 (AC-P2-90) | 파일 23 · 파서 **460** · 엔진 121 · 통과 **581** (AC-I4-95) | 골든이 12사례 늘었다(voice-extract 끊어 말한 번호). 코어 영역 최소 변경 — 숫자 두 개·시험 이름·주석만 바꿨다 |
| `packages/core/test/golden/voice-extract.test.ts` "실제 추출기로 voice-extract N사례가 모두 통과" (AC-P2-08) | 69사례 | **81**사례 | 같은 이유(골든 12사례 추가). 실제 골든 파일의 사례 수를 고정한 시험이라 core-adapter 합계와 같은 성격이다 — 숫자·시험 이름만 바꿨다. 수용 기준 AC-I4-95는 core-adapter 합계만 적었고 이 시험은 빠져 있었다(이것을 바꾸지 않으면 골든을 맞게 구현해도 `pnpm test`가 실패한다). 러너 계약·비교 규칙·다른 러너 시험은 그대로 |
| `packages/voice/test/boundaries.test.ts` "apps 안에 @livejjim/voice 참조가 없다" (AC-P2-15) | `apps/**` 전체에 글자로도 참조 없음 | `apps/web/src`: 값은 한 파일의 동적 `import('@livejjim/voice')`로만, 그 밖엔 `import type`·타입 위치 `import()`만(구문 트리로 검사, 검사기 자체 시험 포함). `apps/web` 밖의 앱(서버)·`packages/core/src`·`packages/label`·`packages/documents`는 전과 같이 글자로도 참조 없음 | AC-I4-04·D-I4-09: I4는 콘솔이 음성을 켤 때 불러온다. 코드가 첫 화면 조각에 들어가는 길(정적 import·`import { type X }`·re-export·경로 우회)은 모두 막는다 |

- `packages/voice/package.json` devDependencies에 `typescript` 6.0.3(루트와 같은 버전)을 더했다 — 경계 시험이 구문 트리를 쓴다. `pnpm-lock.yaml`은 그 importer 줄만 바뀐다.

### 측정 스크립트 (AC-I4-03, D-I4-08)

- 명령 (저장소 루트에서, 상대 경로는 명령을 실행한 폴더 기준 — pnpm이 넘기는 `INIT_CWD`):
  ```
  pnpm --filter @livejjim/voice accuracy packages/voice/samples/accuracy-example.csv
  pnpm --filter @livejjim/voice accuracy <표본.csv> --dictionary <이름.txt> --max-number 50 --out harness/sprints/I4/hg4-accuracy.md
  ```
  직접: `node packages/voice/scripts/accuracy.ts <표본.csv> …` (상대 경로는 지금 폴더 기준). 선택지는 `--이름 값`·`--이름=값` 둘 다, `--` 뒤는 표본 파일 자리.
- 파일
  - `packages/voice/scripts/accuracy.ts` — 명령(파일 읽기·쓰기·종료 코드). 타입 검사는 `packages/voice/tsconfig.test.json`(include에 `scripts/**/*.ts`를 더했다), 린트는 저장소 설정.
  - `packages/voice/src/accuracy.ts` — 순수 함수. **하위 경로 `@livejjim/voice/accuracy`**로 내보낸다(package.json `exports`) — 패키지 첫 입구(`index.ts`)에 넣지 않아 화면이 음성 코드를 불러올 때 같이 오지 않는다.
    - `parseCsv(text)` → `{ ok, value: { line, cells }[] }` (BOM·CRLF·LF·CR, 감싼 칸의 쉼표·줄바꿈·`""`, `line` = 레코드가 시작하는 줄)
    - `parseAccuracySamples(text)` → `{ ok, value: AccuracySample[] }` 또는 `{ ok: false, message }` (쉬운 한국어 한 문장, 줄 번호)
    - `parseDictionaryLines(text)` → 이름 목록 (BOM·CRLF, 앞뒤 공백 지움, 빈 줄 무시)
    - `scoreSample(sample, extraction)` / `scoreSamples(samples, { maxNumber?, history? })` → `ScoredSample[]` (칸 결과 `'맞음' | '빈칸' | '틀림' | '채점 안 함'`, `filledWrong`, `confidentWrong`, `cardWorthy`)
    - `summarizeAccuracy(scored)` → `{ samples, noCorrect, priceCorrect, bothCorrect, nameCorrect, nameScored, filledWrong, confidentWrong, cardWorthy }`
    - `formatRatio(correct, total)` → `"17/18 (94.4%)"` (정수 반올림, 0.05는 위로), 채점 수 0이면 `"0/0 (채점한 표본 없음)"`
    - `renderAccuracyReport(scored, summary, { sampleFile, maxNumber, historyNames })` → 마크다운, `tableCell(value)` → 표 칸 이스케이프
    - `parseAccuracyArgs(argv)` → `{ ok, value: { samples, dictionary, maxNumber, out } }` 또는 `{ ok: false, message, usage }`
- 정한 세부 (스펙이 정하지 않은 것 — 판단 근거는 "틀린 값보다 오류·빈칸이 안전", D-036 단순함)
  - 표본 파일 첫 줄은 글자 그대로 비교한다(앞뒤 공백도 다름). 칸이 모두 빈 줄(`,,,,`·빈 줄)은 건너뛴다. 칸 수가 5가 아닌 줄은 오류(엑셀이 붙이는 빈 끝 칸도 오류 — 어떤 칸이 어긋났는지 몰라 채점이 틀어질 수 있다).
  - 기대 번호: 앞뒤 공백을 지우고 숫자 1~4자리(앞 0 허용, `015` → 15) 1~9999. `15번`·전각 숫자·`일오`는 오류. 기대 가격: 숫자만(1~15자리, 앞 0 허용) 또는 올바른 천 단위 쉼표(`15,000`), 100 이상. `1,0000`·`50`·`-100`·`15000원`·`1.5만`은 오류.
  - 기대 품종: R-3 정규화(빈 글이면 채점 안 함). 비교는 정규화 → 공백 모두 지움 → NFC.
  - 표본 이름이 비면 보고서에 "N번째 줄".
  - 파일은 UTF-8이어야 한다(엄격 해독). 엑셀 기본 CSV(CP949)는 "UTF-8이 아니에요" 오류 — 깨진 글자로 조용히 채점하지 않게.
  - `--out`이 표본·이름 파일과 같은 파일이면 오류(장치·아이노드로 비교 — `/tmp`↔`/private/tmp` 같은 다른 이름도). 보고서 파일을 먼저 쓰고 성공해야 표준 출력에 쓴다 — 실패하면 표준 출력도 비어 있다.
  - 오류 문장·사용법은 표준 오류, 보고서는 표준 출력. 오류 문장에 보이는 사용자 값은 한 줄로 바꾸고 20글자로 줄인다.
  - 보고서 표 칸: 제어 글자·줄바꿈 → 공백, `&`·`<`·`>` → 문자 참조, `\`·`|`·`` ` `` → 백슬래시 이스케이프. 머리에는 표본 파일 **이름만**(경로 아님) 보인다.
  - 보고서 구성: 머리(표본 파일·사전 크기·최대 번호) → `## 요약`(`- 이름: 값` 줄 8개) → `## 살펴볼 표본`(틀린 값을 채움·확실한데 틀림인 표본과 문장 — HG-4에서 spec-keeper에게 넘길 것) → `## 표본별 결과`(표) → `## 읽는 법`.
- 예시 표본 `packages/voice/samples/accuracy-example.csv` (20행, 이름 `예시-01`…`예시-20`, 만든 문장): 요약 = 표본 20 · 번호 맞음 17/20 (85.0%) · 가격 맞음 14/20 (70.0%) · 둘 다 13/20 (65.0%) · 품종 17/18 (94.4%) · 틀린 값을 채움 3 (예시-15·16·18) · 확실한데 틀림 3 (예시-15·16·19) · 카드 16 (예시-05·06·08·12 빼고). 표본별 손 계산은 `packages/voice/test/accuracy.test.ts` 주석. 예시-15·16은 인식이 말을 놓치거나 잘못 들은 경우(실제 인식에서 나올 법한 "확실한데 틀림")를 보이려고 만든 행이다.

## dev-web (apps/web — 콘솔 음성 칸)

### 구조

- `apps/web/src/voice/load.ts` — `@livejjim/voice`를 부르는 **유일한 곳**(동적 `import('@livejjim/voice')`, 실패하면 다음에 새 주소로 다시 — 아래 "수정 라운드 1" 3). 다른 파일은 `import type`만(AC-I4-04 경계 시험 통과).
- `apps/web/src/voice/chunk.ts` — 음성 조각 주소 자리 글자 `VOICE_CHUNK_PLACEHOLDER`(운영용 빌드가 `vite.config.ts` `voiceChunkAddress`로 채운다).
- `apps/web/src/voice/controller.ts` — `VoiceController`(콘솔마다 하나, 떠나면 `dispose` → 인식 `stop`). 켜기·안내 창·엔진 상태·자막·들린 말 기록·카드 목록·고치기 칸·자동 확정 타이머·판매 이력 사전. 인식 문장은 이 객체 메모리에만 있다. 시각은 `host.now()`(콘솔은 `Date.now`), 기다림은 브라우저 `setTimeout` — `page.clock`으로 당길 수 있다. 시험용 갈림길·전역 훅 없음.
- `apps/web/src/voice/storage.ts` — 그 기기 저장소 키 `livejjim.voiceConsent`(값 `yes`), `livejjim.voiceSettings`(JSON `{"voice.autoConfirm": boolean, "voice.autoConfirmSec": number}` — 읽은 값은 `resolveVoiceSettings`로). 읽기·쓰기 예외면 확인 없음(다음에도 창)·설정 기본값.
- `apps/web/src/voice/history.ts` — 판매 이력: `GET /api/days`(실제 범위 목록) → `pickHistoryDays` → 날짜마다 `GET /api/days/:date`(실제)의 상품 이름. 음성을 켤 때 한 번(성공하면 그 콘솔에선 다시 받지 않고, 실패하면 다음에 켤 때 다시). 하나라도 실패하면 실패(404는 빈 날).
- `apps/web/src/lib/voice.ts` — 화면 순수 함수(음성 값 import 없음 — 음성 함수는 인자로): `frontCard`·`nextFront`·`enterReady`·`decideVoiceEnter`·`enterBadgeCard`(Enter 대상·1초), `decideAutoConfirm(input, checkAutoConfirm)`·`showsAutoCountdown`·`autoSecondsLeft`·`nextWake`(자동 확정), `pickHistoryDays`·`historyNames(current, past, normalizeDictionary)`(사전), `pushHeard`·`parseSecondsText`·`cardLine`. 상수 `ENTER_READY_MS` 1000, `WIDE_MIN_WIDTH` 768, `HEARD_LIMIT` 20, `HISTORY_DAYS` 10, `HISTORY_NAME_LIMIT` 2000.
- `apps/web/src/lib/use-wide.ts` — `matchMedia('(min-width: 768px)')`(PC 판단 — Enter 등록·고정 영역 배치).
- `apps/web/src/components/VoicePanel.tsx` — `VoiceToggle`·`VoiceConsentDialog`·`VoiceLive`(상태·안내·자막·오류·카드)·`VoiceExtras`(자동 확정 설정·들린 말 기록).
- `ConsolePage.tsx` — 카드 등록은 빠른 입력의 등록 경로(`enqueueRegistration` → 같은 차례·`product.register`·5초 되돌리기·일시 오류 "다시 보내기"·같은 요청 번호)를 그대로 쓴다. 등록 경로에 선택 두 개를 더했다: `onExists`(자동 확정 — 차례에서 번호가 생겼으면 창 대신 카드로 되돌림), `onFailed`(다시 보내기로 고칠 수 없는 실패·기록되지 않음 → 카드를 되살림). 빠른 입력 동작은 그대로다.

### 화면 (테스터가 찾을 이름)

- 머리 줄(방송 목록·방송 끝내기 옆) 버튼 **"음성 켜기"** — 꺼져 있을 때만. 스냅샷 설정이 없으면 잠김, 음성 코드를 받는 동안 잠김. 안내 창이 열린 동안은 머리 줄 버튼이 없다(창의 "음성 켜기" 하나 — 같은 이름 둘이 생기지 않게).
- 안내 창 `dialog` 이름 **"음성으로 상품 등록"**, 버튼 "닫기"(처음 포커스)·"음성 켜기". 닫기·Esc → 꺼진 그대로, 포커스 빠른 입력칸.
- 켜진 동안 `region` **"음성 등록"**: `status` "음성: 듣는 중"/"음성: 다시 시작 중", 글 "음성은 인식을 위해 구글로 보내져요.", 버튼 **"음성 끄기"**, 자막 "들리는 말: …"(중간 결과가 있을 때 한 줄), 오류 `alert`(D-205 문장 그대로), 이력 실패 `status`, 1초 안 Enter `alert` "새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요."(그 카드의 "Enter 등록"이 보이거나 맨 앞이 바뀌면 사라짐). 음성을 켜고 끈 뒤 포커스는 빠른 입력칸.
- 카드 목록 `list` **"음성 카드"**, 카드 `listitem` 이름 **"{짧은 글} 카드"** — 짧은 글 = `describeCard`에서 " — 등록할까요?"를 뗀 것(예 "15번 핑크프릴 15,000원", "번호 없음 핑크프릴 15,000원", "15번 핑크프릴 가격 없음"). 안: `describeCard` 글 그대로, "확인 필요"(LOW), "Enter 등록", "들은 말: {원래 문장}", "N초 뒤 자동 등록", 문장(자동 확정 때 번호가 있음 — `editQuestion`). 버튼 이름 **"{짧은 글} 등록"·"{짧은 글} 고치기"(aria-expanded)·"{짧은 글} 닫기"·"{짧은 글} 자동 등록 멈추기"**(보이는 글자는 "등록"·"고치기"·"닫기"·"자동 등록 멈추기").
- 고치기 칸 `group` **"{짧은 글} 고치기 칸"**, 칸 이름 "번호"·"품종"·"가격"(번호·가격 `inputmode=numeric`). Enter = `decideFixForm`(그 방송 `price.unit`), Esc = 칸만 닫기(창이 열려 있으면 창 먼저). 오류 문장은 `alert`.
- `region` **"음성 설정과 기록"**: 체크 "확실한 카드는 자동으로 등록", 칸 "기다리는 시간(초)"(글 칸 `inputmode=numeric`), 켜면 안내 문장, 틀린 기다림은 `alert`로 `checkVoiceSettings` 문장. `details` 요약 "들린 말 기록"(펼치면 `ol` 최근 20개). PC는 왼쪽 칸(현재 상품 아래), 휴대폰은 음성 칸 바로 아래.
- 배치: PC(폭 768px 이상)는 음성 칸을 고정 영역(`.console-sticky.console-sticky-voice`) 안에 — 폭 64rem 이상이면 두 칸(빠른 입력 | 음성), 음성 칸 높이 상한 `calc(50vh - 1.5rem)`(좁은 PC는 `max(10rem, 50vh - 13rem)`), 카드가 넘치면 카드 칸 안에서 스크롤. 휴대폰은 음성 칸·설정이 고정 영역 밖(고정 영역은 음성 전과 같다). 1440×900에서 카드 3장 + 되돌리기 대기 ≈ 341px(측정).

### 스펙이 정하지 않아 정한 것 (근거: D-036 단순함, "방송자 확인 없이 등록되지 않는 쪽")

1. **"Enter 등록" 표시 = 지금 빈 빠른 입력칸의 Enter가 등록할 카드에만**: 맨 앞·1초 지남·PC 폭에 더해 빠른 입력칸이 비어 있고, 창이 없고, 그 카드 고치기 칸이 닫혀 있을 때(`enterBadgeCard` = `decideVoiceEnter`). 표시가 보이는데 Enter가 등록하지 않는 일이 없게.
2. **음성 끄기·자동 확정 설정 끄기**: 기다리던 카드의 자동 확정 시각을 지운다 — 다시 켜도 그 카드는 자동 확정하지 않는다(새 카드부터). 음성을 끈 뒤 남은 카드는 "등록"·Enter·고치기·닫기로 손으로 다룬다(Enter도 손 조작으로 본다).
3. **되살리기**: 카드를 등록 경로로 넘긴 뒤 ① 다시 보내기로 고칠 수 없는 실패(서버 거절)·기록되지 않음(`changed: false`인데 그 번호 상품도 없음)이면 카드를 손댄 카드로 되살린다(오류는 빠른 입력과 같은 자리), ② 자동 확정인데 차례에서 그 번호가 생겼으면 창 없이 카드로 되돌리고 "고칠까요?" 문장을 붙인다(D-I4-05 "창을 띄우지 않는다"). 일시 오류는 빠른 입력과 같은 "다시 보내기" 목록(같은 요청 번호)이다.
4. **등록 줄**: 카드 등록의 줄은 빠른 입력 한 줄 모양 `15 핑크프릴 15,000원`(품종이 없으면 `15 15,000원`) — 저장 실패 목록·늦은 "고칠까요?" 목록에 보이고, 칸으로 옮겨도 같은 상품으로 읽힌다. 서버로는 번호·품종·가격만 간다.
5. **카드 "등록"을 고치기 칸이 열린 채 누르면** 그 칸의 값으로(칸의 Enter와 같다). "고치기"를 다시 누르면 칸을 닫는다.
6. **"고치기"의 커서**: 번호 → 품종 → 가격 중 첫 빈 칸, 없으면 번호(AC-I4-23 "비어 있는 칸이 있으면 그 칸 중 처음"). 등록하려다 연 칸은 빠진 칸(번호 없음 → 번호, 가격 없음 → 가격).
7. **같은 날짜 안의 이름 순서**: 서버가 준 상품 순서 그대로(스펙은 날짜 순서만 정했다).
8. **음성 코드를 받지 못함**: "음성 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요." — 꺼진 그대로, 다시 누르면 다시 받는다(스펙에 없는 문장, D-205 문장과 겹치지 않게). 다시 받을 때는 새 주소(`?retry=N`)로 받는다(수정 라운드 1 3).
11. **"음성: 다시 시작 중"을 적어도 1초**(`RESTART_LABEL_MS`): 엔진은 다시 시작하자마자 같은 순간에 듣는 중을 알리므로 그대로 그리면 한 번도 보이지 않는다(AC-I4-12 "거친다"). 1초 안에 최종 결과가 오면 바로 "듣는 중", 1초 안에 또 끊기면 그때부터 다시 1초, 끄거나 오류로 멈추면 버린다.
12. **자동 확정은 기다림이 끝난 카드를 모두 그 순간에**: `decideAutoConfirm`은 한 번에 하나를 고르므로 컨트롤러가 등록할 때마다 다시 본다(한 카드는 한 번만 넘긴다). 확정할 수 없는 카드(그 사이 번호 범위가 줄었다 등)는 칸을 열지 않고 그 카드의 자동 확정만 끈다(다시 넘기지 않는다).
9. **자동 확정의 창 판단**: 콘솔 창·음성 안내 창·떠날지 묻는 창 모두 — 화면에 `role="dialog"`가 있으면 미루고, 미룬 동안 250ms마다·창이 닫힐 때 다시 본다.
10. **기다리는 시간 칸**: 글 칸 + 숫자 키패드. 정수·소수 글자만 수로 읽고 나머지는 NaN — 받을지는 `checkVoiceSettings`가 정한다(값은 그대로, 문장만).

### 서비스 워커와 빌드 시험 (AC-I4-10 — 교체, 약화 아님)

- 운영용 빌드의 앱 껍데기 목록(`/sw.js`)에서 **누를 때만 받는 JS 조각**(진입 조각과 그 정적 import에 들지 않는 조각 — 음성 패키지)을 뺀다(`vite.config.ts` `lazyChunks`). 서비스 워커가 설치될 때 음성 조각을 미리 받으면 "누르기 전에는 음성 코드를 받지 않는다"(D-I4-09)가 깨진다. 음성은 인터넷이 있어야 돌므로 오프라인 껍데기에 필요 없다. 탐색으로 확인: 콘솔을 열고 다시 열어도 서비스 워커 요청에 음성 조각이 없고, "음성 켜기"를 누를 때 한 번 받는다.
- `apps/web/test/build.node.test.ts`
  - 바꾼 것: "PWA (AC-S06-50·51) … /sw.js가 그 빌드의 앱 껍데기만 저장" 시험의 "빌드의 해시가 붙은 파일이 모두 들어 있다" → "누를 때만 받는 조각은 **들어 있지 않고**(그런 조각이 하나 이상 있다), 나머지는 모두 들어 있다". 나머지 검사(적힌 파일이 모두 있음·/api 없음·버전)는 그대로.
  - 더한 것: "AC-I4-10: 첫 화면이 받는 JS(index.html이 부르는 스크립트와 그 정적 import를 꼬리까지)에 D-205 문장 '음성 인식이 자꾸 끊겨요.'·기본 사전 이름이 없고, 그 문장은 따로 받는 조각 하나에 있으며(그 조각에 `ko-KR`), index.html은 그 조각을 미리 받지 않는다".

### 수정 라운드 1 (SA-I4-001~003, TD-I4-001, TE-I4-001·002)

1. **TD-I4-001·SA-I4-001 기다림이 함께 끝난 둘째 카드** — `controller.ts`
   - `#autoConfirm`: 등록할 때마다 `decideAutoConfirm`을 다시 불러 기다림이 끝난 카드를 모두 그 순간에 넘긴다(한 카드는 한 번 — `tried`). `decideAutoConfirm`의 "한 장씩" 계약은 그대로다.
   - `#schedule`: `nextWake`(앞으로 올 시각만)에 더해 `#ripeAuto` — 기다림이 이미 끝난 열린 카드가 있으면 `decideAutoConfirm`으로 보고, 등록·"고칠까요?"할 것이 있으면 0ms, 창이 열려 미뤘으면 250ms마다. 다시 보기 전에 인식 결과 같은 다른 일로 타이머를 다시 잡아도(배경 탭에서 타이머가 늦는 경우) 끝난 카드를 놓치지 않는다. 바쁜 반복 없음: 0ms는 등록·"고칠까요?"로 반드시 바뀌는 카드가 있을 때만이고, 자동 확정의 `confirm` 실패는 늘 그 카드의 자동 확정을 끈다.
   - `refresh(deferred)` 인자는 없앴다(창 미룸을 `#schedule`이 스스로 본다).
   - **시험 한 곳이 스스로 어긋남(test-domain 몫)**: `tests/adversarial/i4/voice-controller-auto.test.ts` 둘째 시험 99행 `expect(registered).toHaveLength(1)`은 T0+5초(15번·16번 모두 자동 확정 시각) 순간에 하나만 등록됐다고 본다. 첫째 시험(같은 두 카드, 같은 순간에 둘 다 — AC-I4-31 "만든 시각 + 5초에 등록된다")과 함께 맞출 수 있는 구현이 없다(차이는 맨 앞 LOW 카드뿐). 고친 뒤 이 줄만 `Received 2`로 실패하고, 그 시험의 나머지(1분 뒤 [15,16])와 다른 세 시험은 통과한다. 99행을 `[15, 16]`으로 바꾸거나 지워 달라고 요청한다.
2. **TE-I4-001·SA-I4-002 "다시 시작 중"이 그려지지 않음** — `controller.ts` `#onState`: RESTARTING을 받으면 `RESTART_LABEL_MS`(1초) 동안 그 글자를 두고, 그 사이 온 LISTENING은 그 뒤에 그린다(정한 것 11). P2 엔진 계약·E2E 가짜는 그대로다.
3. **TE-I4-002·SA-I4-003 받지 못한 뒤 다시 켜도 받지 않음** — 크로미움은 받지 못한 모듈 주소를 모듈 지도에 실패로 남겨 같은 주소의 `import()`를 다시 받지 않는다.
   - `vite.config.ts` `voiceChunkAddress`(운영용 빌드만): `generateBundle`에서 음성 패키지 진입 파일(`packages/voice/src/index.ts`)의 조각을 찾아, 자리 글자가 든 조각마다 그 조각에서 본 상대 주소(예 `./src-abc.js`)로 바꾼다. 음성 조각이 하나가 아니거나 자리가 없으면 빌드를 멈춘다.
   - `load.ts`: 처음은 그대로 `import('@livejjim/voice')`, 받지 못한 뒤에는 `retryAddress(N)` = 그 조각 주소를 `import.meta.url`에서 풀고 `?retry=N`을 붙인 새 주소로 `import()`. 주소가 같은 출처의 `.js`가 아니면(개발 서버·시험 — 자리 글자 그대로) 같은 import를 다시 부른다. 다시 받은 조각의 정적 import(진입 조각)는 같은 주소라 같은 모듈이다.
   - 서비스 워커는 음성 조각을 저장하지 않으므로(위) `?retry=N` 요청은 네트워크로 간다. 경계 시험(동적 import 한 파일)은 그대로 통과한다 — 두 번째 `import()`의 인자는 글자가 아닌 주소 값이다.
   - 시험: `apps/web/test/voice-load.test.ts`(주소 만들기·거절), `build.node.test.ts` "TE-I4-002"(진입 조각에 음성 조각 주소가 동적 import 밖에 한 번 더 있고 자리 글자가 어디에도 없다).

### 수정 라운드 2 (SA-I4-008 — AC-S06-90 흔들림, test-e2e에게 요청)

- **결론**: 흔들림은 맞다. 원인은 화면이 아니라 시험이 시각 경쟁에 기댄 것이다. 화면은 D-090대로 동작한다. 목록 기본은 "그날 확정 찜이 있는 지금의 구매자"다. dev는 `tests/**`를 고치지 못하므로(dev-common "수정 금지") 아래 고침을 test-e2e에게 요청한다.
- **어떻게 갈리나** (임시 진단 시험, 커밋하지 않음 — `chat-speed 20`이라 생성기는 초당 80건, 1,000건이 약 12초)
  - 159행이 통과하려면 셋 중 하나가 이겨야 한다. 문자찜 5·7(김씨)이 1등이거나, 6(단골손님)이 1등이어야 한다. 셋 다 대기면 합친 단골손님에게 확정 찜이 없어 기본 목록에서 빠지고, 159행이 `element(s) not found`로 실패한다.
  - 1등인지는 생성기 채팅(시드 7)과 휴대폰 문자찜이 기록되는 차례로 갈린다. 생성기 메시지는 "그 시점의 열린 상품"으로 정해지므로, PC가 30줄을 등록하는 빠르기(약 1.7~4.2초, 기계 부하 따라 다름)에 따라 채팅 흐름 자체가 바뀐다.
  - 진단 4회 모두 통과했지만 이긴 길이 달랐다. 두 번은 생성기의 "6번 취소할게요" 뒤에 문자찜 6이 들어와 단골손님이 6번 1등이 됐다. 다른 두 번은 "5번·7번 취소" 뒤에 들어와 김씨가 5·7번 1등이 됐다. 취소가 문자찜보다 늦거나 없으면 셋 다 대기가 된다.
- **확인**: 실패 조건은 문자찜 전에 다른 시청자 찜 5·6·7을 넣으면 늘 만들어진다. 이 조건에서 지금 159행은 게이트와 같은 오류로 실패한다. 아래 고침을 넣으면 시험 전체가 통과한다(코어 재생 비교·정산 포함).
- **요청 고침** (AC-S06-90의 뜻 "휴대폰 합치기가 PC 구매자 화면에 반영" 그대로): 159행을 기본 목록 대신 PC 구매자 화면의 **찾기**로 본다. D-090: 찾기 칸은 "그날 기록된 모든 구매자"에서 찾는다.
  ```ts
  const pcList = page.getByRole('region', { name: '구매자 목록' })
  await pcList.getByLabel('구매자 찾기').fill('단골')
  await expect(pcList.getByRole('list', { name: '찾은 구매자' }).getByRole('link', { name: /단골손님/ })).toContainText('합친 구매자 1명')
  ```
  "찜 없는 구매자도 보기"를 켜는 방법은 권하지 않는다. 생성기 시청자가 수백 명이라 단골손님 줄이 첫 쪽 밖("더 보기")에 있을 수 있다. main의 S06b 판(표 `getByRole('table', { name: '구매자' })`)도 같은 경쟁이 있으니 합칠 때 같이 고쳐야 한다.
- **마감 verify에서 따로 본 실패 (남의 몫, test-e2e에게 요청)**: `tests/e2e/s06/sms.spec.ts:181`(AC-S06-14·81)과 `attacks-r1.spec.ts:172`(UX-S06-002 두 크기)가 **한국 시각 정오 뒤에 늘 실패**한다. 받은 시각을 `00:00:01`로 고정하고 시계를 가짜로 두지 않기 때문이다.
  - D-023 ③에 따라 받은 시각은 입력 시각에 가장 가까운 날짜로 읽는다. 12:00:01 KST 뒤에는 `00:00:01`이 "내일 00:00:01"이 된다.
  - 그러면 화면이 AC-S06-12대로 "받은 시각을 확인해 주세요" 창을 띄운다. 시험은 이 창을 기다리지 않아 번호 칸이 비지 않는다("15").
  - 이번 마감 verify에서 이 시험들이 12:0x KST에 돌았다. 12:10 KST에 단독으로 다시 돌려도 3개 모두 같은 창으로 실패했다.
  - I4는 `SmsPage.tsx`·`lib/received.ts`·코어 `time.ts`와 이 시험들을 바꾸지 않았다(BASE..HEAD 차이 없음).
  - 고침 예: `page.clock.setFixedTime`으로 오전 시각을 정한다. 또는 받은 시각을 지금보다 조금 이른 값으로 넣는다. 또는 `sms()`처럼 늦은 시각 창이 뜨면 "이대로 넣기"를 누른다.
- 덧붙여: 같은 작업자에서 `--repeat-each`로 돌리면 앞 반복과 같은 날짜 범위를 쓰는 일이 있었다(진단 2·3회의 이력이 겹침). 이 시험의 "김씨 찾기 → 첫 링크"가 앞 반복의 김씨(이미 합쳐짐)를 고를 수 있으니, 재현할 때는 반복마다 서버를 새로 띄우는 편이 정확하다.

### 단위 시험

- `apps/web/test/voice.test.ts`(순수 함수 23), `voice-controller.test.ts`(컨트롤러 34 — 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계; 수정 라운드 1에서 다시 시작 중 2·자동 확정 4 더함), `voice-load.test.ts`(다시 받을 주소 3), `console-voice.test.tsx`(콘솔 17 — 실제 코어 가짜 서버 + 가짜 인식 객체). 모두 `TZ=Pacific/Honolulu`에서 돈다.
