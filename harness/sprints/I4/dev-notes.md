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
