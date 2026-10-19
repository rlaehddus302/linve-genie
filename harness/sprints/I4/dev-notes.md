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
| `packages/voice/test/boundaries.test.ts` "apps 안에 @livejjim/voice 참조가 없다" (AC-P2-15) | `apps/**` 전체에 글자로도 참조 없음 | `apps/web/src`: 값은 한 파일의 동적 `import('@livejjim/voice')`로만, 그 밖엔 `import type`·타입 위치 `import()`만(구문 트리로 검사, 검사기 자체 시험 포함). `apps/web` 밖의 앱(서버)·`packages/core/src`·`packages/label`·`packages/documents`는 전과 같이 글자로도 참조 없음 | AC-I4-04·D-I4-09: I4는 콘솔이 음성을 켤 때 불러온다. 코드가 첫 화면 조각에 들어가는 길(정적 import·`import { type X }`·re-export·경로 우회)은 모두 막는다 |

- `packages/voice/package.json` devDependencies에 `typescript` 6.0.3(루트와 같은 버전)을 더했다 — 경계 시험이 구문 트리를 쓴다. `pnpm-lock.yaml`은 그 importer 줄만 바뀐다.
