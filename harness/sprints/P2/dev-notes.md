# P2 개발 노트 — dev-device (문서·음성 패키지)

작업 폴더 `/Users/unhoyeo/livejjim-wt/p2`, 브랜치 `track/p2-docs-voice`. 스펙 커밋 76bd2b0, BASE 358a6d2.

## 만든 것

### `packages/voice` (`@livejjim/voice`)
| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/extract.ts` | `extractVoice(text, { maxNumber?, dictionary? })` → 정확히 `{ no, name, price, confidence }`. R-17 1~6 그대로: 토큰·300글자 상한·끝말 21개·번호 표시(숫자 1~4자리·한자어 수사 + `번`, `이` 제외)·원 단위 가격 묶음(6토큰까지, 처음 읽힌 값)·금액 조각·자모 유사도 품종·신뢰도. 정규화·금액·수사는 코어 `normalizeText`·`parseAmount(…, { 'price.unit': 'WON' })`·`parseKoreanNumber` | AC-P2-01~05 |
| `src/jamo.ts` | 자모 = 공백 지우고 NFD 코드 포인트, 편집 거리(기준 DP + Myers·Hyyrö 비트 병렬), 분수 비교, 후보 길이 범위 | AC-P2-04·07 |
| `src/dictionary.ts`·`src/default-dictionary.ts` | `buildDictionary(history, base = DEFAULT_DICTIONARY)`, `normalizeDictionary`, `prepareDictionary`(얼린 사전 — 정확히 같은 자모 색인·길이 색인·기호 번호). 기본 사전 60개, 출처는 파일 머리 | AC-P2-06 |
| `src/card.ts`·`src/settings.ts` | 제안 카드(만들기·확정·고치기·닫기·손대기·자동 확정 판단·목록 넣기·문장), 음성 설정(`voice.autoConfirm` 기본 false, `voice.autoConfirmSec` 기본 5·정수 3~30) 검사·해석 | AC-P2-10~12 |
| `src/speech.ts`·`src/web-speech.ts`·`src/cloud.ts` | `SpeechEngine` 모양·오류 문장(D-205 표)·상태 말, 다시 시작 한도(`RestartLimiter`), Web Speech 어댑터, Deepgram·리턴제로 골격 | AC-P2-13~15 |

### `packages/documents` (`@livejjim/documents`)
| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/receipt.ts` | `buildReceipt({ state, buyer, date, shop?, rehearsal, createdAt })`, `buildReceipts(scope)`(전원 일괄 순서) → `{ ok, receipt(s) }` 또는 `{ ok: false, error: { code, message } }` | AC-P2-20~22·24·27 |
| `src/font.ts` | `loadDocumentFont(bytes)` → `DocumentFont`(fontkit 한 번 읽기, 폭 재기 = pdf-lib와 같은 계산, 그릴 수 없는 글자 빼기) | AC-P2-26 |
| `src/layout.ts` | 배치 모델 `layoutReceipt(receipt, font, 'pdf' \| 'image')`, `layoutTexts`, `wrapText` | AC-P2-23·25·26 |
| `src/pdf.ts` | `renderReceiptPdf`·`renderReceiptsPdf`·`renderBatchPdf` (pdf-lib, A4, 부분 글꼴 내장) | AC-P2-23·24 |
| `src/png.ts` | `renderReceiptPng(receipt, font)` → 폭 1080px 회색조 PNG (글리프 윤곽 직접 칠하기 + fflate) | AC-P2-25 |
| `src/ledger.ts`·`src/xlsx.ts` | `buildLedger({ scopes, from, to, broadcasts? })` → 행, `ledgerToXlsx(rows)` → `.xlsx` 바이트(exceljs) | AC-P2-30~33 |
| `fonts/Pretendard-Regular.ttf`·`fonts/OFL.txt` | Pretendard 1.3.9 Regular(TrueType 판, npm `pretendard` 패키지의 `dist/public/static/alternative/`) + 그 패키지의 OFL 라이선스 원문 | AC-P2-40 |

### 골든 러너 최소 연결 (코어 영역 — 누구 영역, 왜)
코어 시험 코드는 dev-core 영역이지만 D-209·AC-P2-08이 dev-device에게 최소 연결을 맡겼다. 코어 `src`의 동작은 바꾸지 않았다.

| 파일 | 바꾼 것 | 왜 |
|---|---|---|
| `packages/core/src/index.ts` | `export { normalizeText } from './parse/text.ts'` 한 줄 (동작 변경 없음) | AC-P2-01: 음성 추출기가 R-3 정규화를 새로 만들지 않고 코어 함수를 쓴다 (acceptance 머리말이 허용한 예외) |
| `test/golden/contract.ts` | `SUITES`에 `voice-extract`, `SUITE_SETTINGS['voice-extract'] = { maxNumber }`, `VOICE_DICTIONARY_KEY`·`VOICE_EXTRACT_KEYS`·`VOICE_CONFIDENCES` | README 파서 suite 표 계약 |
| `test/golden/validate.ts` | `settings.dictionary`(문자열 목록) 받기, `out` 검사(키 4개·`confidence` 필수·`no` ≥1·`name` 빈 글 아님·`price` ≥100·`HIGH/LOW`), `ParserSuiteDoc.dictionary?` | 형식 계약 밖은 읽기 오류 |
| `test/golden/types.ts`·`runner.ts`·`fake-core.ts` | `GoldenParserCore.voiceExtract(text, settings, dictionary)`, 사례마다 사전 사본을 넘김, 가짜 코어 기본은 미구현 | 러너가 suite를 부른다 |
| `test/golden/compare.ts` | 정확히 네 키, 네 값이 모두 같아야 통과(적지 않은 `no`·`name`·`price` = null, 다른 키·빠진 키는 불일치) | README 비교 규칙 |
| `test/golden/core-adapter.ts` | 실제 어댑터가 `../../../voice/src/extract.ts`의 `extractVoice`를 부름(`price.unit`은 넘기지 않음) | D-209. 워크스페이스 의존(`@livejjim/voice`)으로 적으면 core ↔ voice가 서로 기대는 고리가 되어 `pnpm install`이 "cyclic workspace dependencies" 경고를 낸다 — 시험 코드에서 상대 경로로 추출 모듈만 가져왔다. 코어 `src`는 음성 패키지를 import하지 않는다 |
| `test/golden/fixtures/read-errors/20-voice-extract.yaml` (새) | 읽기 오류 픽스처: 모르는 out 키, `confidence` 빠짐, `price: 50`, 빈 `name`, `no: 0`·`confidence: MEDIUM`, 맵이 아닌 out, 목록이 아닌 `dictionary`, 문자열이 아닌 사전 항목, `maxNumber` 0·10000, 모르는 설정 키 `unit` | AC-P2-08 |
| `test/golden/voice-extract.test.ts` (새) | 실제 추출기 69사례 통과, 사전 사본·설정 전달, 비교 규칙, 허용 목록 suite 이름 `voice-extract`, 일부러 틀린 추출기 4종(고유어 번호·천원 단위·사전 밖 말·음절 유사도)이 각각 불일치 | AC-P2-08 |

### 바꾼 기존 시험 (교체 — 약화 아님)
| 시험 | 전 | 후 | 이유 |
|---|---|---|---|
| `core-adapter.test.ts` "실제 tests/golden 전체" | AC-S06-95: 파일 21 · 파서 379 · 엔진 119 · 통과 498 | AC-P2-90: 파일 23 · 파서 448 · 엔진 121 · 통과 569 | 골든이 늘었다(voice-extract 69사례, G-ENG-201·202). 나머지 0·경고 없음은 그대로 |
| `read-errors.test.ts` | 범주 1~19 | 범주 1~20 (20 = voice-extract) | 새 suite의 형식 계약 픽스처를 더했다. 기존 범주·기대값은 그대로 |

### 루트 공용 파일
- `package.json`: 루트 devDependencies에 `@livejjim/documents`·`@livejjim/voice`(`workspace:*`) — 테스터가 `tests/adversarial/p2`에서 패키지 이름으로 가져다 쓰게.
- `eslint.config.mjs`: `packages/{voice,documents}/src/**` 블록 하나를 끝에 더했다 — Node 내장 모듈·`process`·`Buffer`·`require`, `Date.now`·`new Date()`(인자 없음)·`Date()`·`Math.random`·`performance`, `Intl`·`localeCompare`·`toLocale*` 금지(AC-P2-40, D-207). 다른 블록은 그대로다.
- `pnpm-lock.yaml`: 새 의존성.

## 결정과 이유 (규칙 문장으로 정해지지 않은 구현 선택)

1. **열린 카드 3장 — 방금 넣은 카드는 닫지 않는다** (`addCard`). D-204 "넘치면 손대지 않은 가장 오래된 열린 카드를 닫는다(손댄 카드는 닫지 않는다)"에서, 기존 열린 카드 3장을 모두 손댔으면 손대지 않은 열린 카드는 새 카드뿐이다. 그것을 닫으면 방송자가 막 한 말이 보이지도 않고 사라진다. "모두 손댔으면 4장 이상도 된다"는 문장과 맞게 새 카드는 닫지 않았다(그다음 새 카드가 오면 그때는 앞서 넣은 손대지 않은 카드부터 닫는다). 시험: `card.test.ts` "모두 손댔으면 4장 이상도 된다".
2. **자동 확정 시각은 카드를 만들 때 정한다**: 설정 켬 ∧ `HIGH`일 때만 `createdAt + 기다림`, 아니면 null. 판단(`checkAutoConfirm`)은 그 시각과 지금 설정(켜져 있어야 함)을 함께 본다 — 만든 뒤 기다림을 바꿔도 그 카드의 시각은 그대로다. 고치기·손대기(`touchCard`)·이미 있는 번호는 시각을 null로 만든다(다시 켜지지 않음).
3. **확정 실패 이유**: 수용 기준의 셋(번호 없음 `NUMBER_MISSING`·가격 없음 `PRICE_MISSING`·이미 있는 번호 `NUMBER_EXISTS` "15번이 이미 있어요. 고칠까요?") 말고, 방어용으로 `NUMBER_OUT_OF_RANGE`(maxNumber를 줄인 뒤 등)·`PRICE_TOO_LOW`·`NOT_OPEN`을 더 둔다. 이미 있는 번호면 카드는 열린 채로 둔다.
4. **Web Speech 오류 코드**: `not-allowed`·`service-not-allowed` → 권한 거부, `audio-capture` → 마이크 없음(다시 시작 안 함), `network`·`no-speech`·`aborted` → 끝(onend)에서 한도 안에서 다시 시작(오류 알림 없음). 그 밖의 코드(`language-not-supported`·`bad-grammar`·모르는 값)는 다시 시작해도 낫지 않으므로 "그 밖" 오류로 바로 멈춘다(무한 재시작을 한도에만 맡기지 않는다). 다시 시작은 새 인식 객체로 한다(지난 객체의 늦은 결과·끝 이벤트는 무시). 같은 최종 결과 = 같은 인식 객체 안의 같은 결과 위치(다시 오면 알리지 않는다). 빈 최종 결과는 한도 셈을 비우지 않는다.
5. **다시 시작 한도 시계가 이상할 때**: 넣은 시계가 NaN이거나 뒤로 가면 지난 끝을 버리지 않는다 — 고장 난 시계로 무한 재시작하지 않게(6번째에서 멈춤).
6. **클라우드 골격의 "연결 실패" 알림 시점**: 끊김마다 오류를 알리지 않고 상태를 "다시 시작 중"으로 바꾼 뒤 다시 연결한다. 한도(최종 결과 없이 60초 안에 6번째)를 넘으면 그때 "연결 실패"로 멈춘다. 같은 연결의 오류·닫힘은 한 번으로 센다. 연결 함수가 예외를 던져도 같은 한도. 음성 조각은 `sendAudio(chunk)`로 그대로 전달(듣는 중일 때만). 마이크 소리 모으기(getUserMedia·녹음)는 I4 몫으로 두었다 — 엔진은 마이크를 열지 않는다.
7. **공유 이미지는 캔버스 없이 그린다**: AC-P2-25 "브라우저(캔버스)와 Node 시험 둘 다에서 같은 함수로"를, 글꼴의 글리프 윤곽(fontkit — PDF가 넣는 것과 같은 글리프)을 직접 칠하는 순수 함수로 지켰다. 캔버스는 글꼴 등록 방법이 환경마다 달라(브라우저 FontFace·Node 캔버스 라이브러리) 같은 함수가 되기 어렵고 Node용 네이티브 의존성이 필요해진다. 지금 방식은 브라우저·Node에서 바이트까지 같은 PNG를 만들고(시험으로 확인), Node 캔버스 개발 의존성도 필요 없다. 화소는 글자 상자 안 잉크로 시험한다.
8. **긴 확인서의 쪽 나눔**: 표 머리는 첫 쪽에만 둔다(다음 쪽은 줄이 바로 이어진다) — 이미지의 글자 목록이 PDF의 내용 글자와 같게(AC-P2-25). 블록(머리·정보·표 머리+첫 줄·줄 하나·합계·계좌)은 넘치면 통째로 다음 쪽으로, 한 쪽보다 큰 줄은 줄 단위로 나눈다. 합계 블록은 마지막 쪽에 한 번.
9. **배송비 옆 표시의 모양**: 금액 줄의 이름을 `배송비 (직접 수령)`처럼 적는다(`FIXED`는 금액이 0원이어도 `따로 정함`). 입금 완료는 `입금 상태 · 입금 완료` 줄.
10. **글꼴로 그릴 수 없는 글자**: NFC로 맞춘 뒤 제어(Cc)·서식(Cf — 방향 표시·폭 없는 글자·ZWJ)·줄/문단 구분·짝 없는 서로게이트를 빼고, 글꼴에 글리프가 없는 글자(이모지·변이 선택자·태국 문자·한자 등 — Pretendard에 없는 것)를 뺀다. 빼서 비면 구매자 `(이름 없음)`, 품종 `품종 미입력`, 회차 `(제목 없음)`, 가게 이름·계좌는 그 줄을 뺀다. 데이터(`ReceiptData`)에는 원래 글을 두고 그릴 때만 뺀다(화면은 다른 글꼴로 그릴 수 있다).
11. **일괄 순서의 이름**: 표시 이름 원문(그리기 전)의 코드 포인트 순이다(`🌵다육맘`은 한글 이름들 뒤). D-207 "표시 이름의 코드 포인트 순"을 데이터 그대로 적용했다.
12. **판매대장의 리허설 판단**: 범위의 `rehearsal`이 `false`가 아니면(빠뜨림 포함) 리허설로 보고 거절한다 — 연습 기록이 장부에 들어가지 않는 쪽으로.
13. **판매대장 여러 범위의 같은 방송 ID**: 범위마다 방송 ID가 겹칠 수 있다(G-ENG-201·202 모두 `b1`). 고른 ID는 넘긴 모든 범위에서 고른다. 같은 날짜의 방송은 범위 순 → 선언 순.
14. **PDF 메타데이터**: 제목·만든 프로그램만 적고 날짜를 넣지 않는다(시계를 읽지 않음 — 같은 입력이면 같은 PDF 바이트).
15. **기본 품종 사전에서 뺀 이름**: 방송 말과 자모 하나 차이인 짧은 이름(예: `당인` ↔ `당연`, `정야` ↔ `저야`)은 넣지 않았다 — 판매 이력으로는 들어온다.

## 공급자 응답 형식의 출처 (AC-P2-14)
- Deepgram 실시간: Live Streaming API 참조 — https://developers.deepgram.com/reference/speech-to-text/listen-streaming 의 `Results` 메시지(`type: "Results"`, `is_final`, `speech_final`, `channel.alternatives[0].transcript`, 다른 종류 `Metadata`·`SpeechStarted`·`UtteranceEnd`·`Error`)와 https://developers.deepgram.com/docs/understand-endpointing-interim-results. `final = is_final`(2026-10-20 확인).
- 리턴제로(RTZR) 스트리밍 STT 웹소켓: https://developers.rtzr.ai/docs/stt-streaming/websocket/ 의 결과 스키마(`seq`, `start_at`, `duration`, `final`, `alternatives[0].text`·`confidence`·`words`). `final = final`(2026-10-20 확인).

## 다음 개발자·테스터에게

### 실행
- 패키지 시험: `pnpm exec vitest run --project voice`, `pnpm exec vitest run --project documents` (두 패키지는 `groupOrder: 2` — 시간 재는 시험이 다른 패키지와 겹치지 않게 뒤에 돈다)
- 골든: `pnpm golden` → 파일 23 · 파서 448 · 엔진 121 · 통과 569
- 전체: `E2E_PORT_OFFSET=200 pnpm verify`

### 테스터(test-domain, `tests/adversarial/p2/**`)가 쓸 수 있는 도구
- 패키지: `import { extractVoice, … } from '@livejjim/voice'`, `import { buildReceipt, … } from '@livejjim/documents'` (루트 devDependencies에 있다)
- `packages/documents/test/helpers.ts`(상대 경로로 import): `replayGolden('G-ENG-201' | 'G-ENG-202' | 다른 파일의 ID, file?)`, `play(events, { broadcasts?, settings? })`(문자찜 `phone`은 골든 어댑터처럼 바꿔 넣음), `sale(no, buyer, nick, { price?, name?, b? })`, `randomEvents()`·`playLoosely()`, `fontBytes()`, `pdfPageTexts(bytes)`·`pdfText`·`pdfFonts`·`pdfPageSizes`, `decodePng(bytes)`, `readXlsx(bytes)`
- 배치 모델 겹침 검사 예: `packages/documents/test/pdf.test.ts`의 `overlapProblems(layout)`

### I2(문서 화면·서버)에게
- 글꼴: `@livejjim/documents/fonts/Pretendard-Regular.ttf`(package.json `exports`) — 바이트를 읽어 `loadDocumentFont(bytes)` 한 번, 그 글꼴을 PDF·PNG 함수에 넘긴다.
- 확인서: `buildReceipt` / `renderReceiptPdf(receipt, font)`(Promise) / `renderReceiptPng(receipt, font)`(동기, 큰 확인서는 웹 워커 권장) / `renderBatchPdf(scope, font)`. 오류는 `{ ok: false, error: { code: 'INVALID_INPUT' | 'NO_ITEMS' | 'AMOUNT_MISMATCH', message } }` — `message`는 판매자에게 그대로 보여도 되는 문장.
- 판매대장: `buildLedger({ scopes: [{ state, rehearsal }], from, to, broadcasts? })` → `ledgerToXlsx(rows)`. 오류 `INVALID_INPUT | PERIOD_INVALID | REHEARSAL | UNKNOWN_BROADCAST`.
- 가게 설정 모양: `{ name?, account?: { bank?, number?, holder? }, accountNote? }` (저장은 I2).

### I4(음성 화면·서버 중계)에게
- 사전: 판매 이력 이름(최근 것 먼저) → `prepareDictionary(buildDictionary(history))`를 한 번 만들어 `extractVoice(text, { maxNumber, dictionary })`에 넘긴다.
- 카드: `createCard({ id, extraction, text, createdAt, settings })` → `addCard(list, card)`, 타이머마다 `checkAutoConfirm(card, { settings, now, existingNumbers })` → `due`면 `confirmCard(card, { maxNumber, existingNumbers })`의 `registration`을 빠른 입력 등록과 같은 길로 보낸다(5초 되돌리기). 칸을 열면 `touchCard`.
- 엔진: `createWebSpeechEngine({ now: Date.now })`, `createDeepgramEngine({ connect, now })`·`createReturnZeroEngine(…)` — `connect(handlers)`는 서버 중계 웹소켓을 열어 `{ send, close }`를 돌려주고 `handlers.onMessage/onClose/onError`를 부른다. 마이크 소리는 I4가 모아 `engine.sendAudio(chunk)`로 넘긴다. 외부 전송 안내는 켤 때 화면이.

## verify 결과 (`E2E_PORT_OFFSET=200 pnpm verify`, 마지막 커밋 기준)

| 단계 | 결과 | 내용 |
|---|---|---|
| typecheck | 통과 | 설정 12개 · 범위 안 TS 파일 286개 |
| lint | 통과 | 오류 0 · 경고 0 |
| test | 통과 | 파일 91 · 테스트 2191 (voice 6파일·documents 6파일 포함) |
| golden | 통과 | 파일 23 · 파서 448 · 엔진 121 · 통과 569 · 나머지 0 |
| adversarial | **실패 1 (남의 몫 — 아래)** | 파일 30 · 테스트 642 · 실패 1 |
| e2e | 통과 | 파일 12 · 통과 67 |
| coverage | 통과 | 코어 라인 100% · 분기 99.65% (코어 `src` 바뀌지 않음 — `index.ts` 내보내기 한 줄뿐) |

### 남은 실패: `tests/adversarial/s00/golden-runner.test.ts` "환경변수·작업 폴더·시간대·언어 설정을 바꿔도 출력과 종료 코드가 같다" — 5초 기본 제한 시간 초과
- 이 시험은 골든 CLI(`node packages/core/test/golden/cli.ts`)를 차례로 4번 띄우고 Vitest 기본 제한 시간 5초를 쓴다. 적대 단계에서는 같은 시간에 typecheck 단계를 통째로 도는 시험들(TD-S00-017·019, 각 9.5초)이 함께 돌아 CPU를 다툰다.
- 측정: 이 커밋에서 단독 실행 2.9초(통과). 적대 단계 안에서 5,138~5,177ms(실패). 같은 날 main의 S06 verify 기록은 4,949ms(51ms 남기고 통과)였고, 병렬 트랙 y1(5,488ms)·p1(5,575ms)도 같은 시험이 같은 이유로 실패했다(공용 스크래치의 verify 기록). 병렬 트랙들이 같은 기계에서 동시에 verify를 돌려 부하 평균이 10~50이었다.
- P2가 더한 몫: 골든 CLI 한 번에 voice-extract 69사례 약 7ms + 음성 모듈 가져오기 약 10ms, 스펙의 엔진 골든 G-ENG-201·202 약 27ms (BASE 대비 CLI 0.69초 → 0.74초). 원래 50ms 남짓 남던 시험이라 이것만으로도 넘을 수 있다.
- 요청(시험·게이트 소유자, `tests/**`는 dev-device가 고칠 수 없다): 이 시험에 제한 시간을 따로 주거나(CLI 4번 = 넉넉히 20초), 병렬 트랙의 verify를 동시에 돌리지 않는다.

### 부하가 아주 높을 때(부하 평균 51) 한 번 본 다른 실패 — 모두 이 트랙 밖
- `packages/core/test/unit/engine-timing.test.ts`(시간 비율 8배 기준 8.5배), `engine-properties*.test.ts`(coverage 단계에서 5초 초과), `tests/e2e/s05/fill.spec.ts`(p99 1초) — 부하가 내려간 마지막 실행에서는 모두 통과.
- `apps/server/test/sms-contract.test.ts` "리허설 방송이면 … 전화번호 키도 만들지 않는다": `dumpAllTables`에 '5555'가 없어야 하는데, 무작위 방송 ID로 계산된 이벤트 `digest`(16진수)에 우연히 `5555`가 들어 있었다(`…cd475555f369…`). 시험이 무작위 값의 우연한 숫자 줄에 걸리는 흔들림이다(dev-server·테스터 몫 — 전화번호 숫자 대신 겹치지 않을 표지를 쓰거나 digest 칸을 빼고 찾기를 권한다).
