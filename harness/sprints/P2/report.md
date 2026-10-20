# P2 스프린트 리포트 — 문서·음성 패키지

**결과: PASS** — 수정 라운드 1회, 남은 blocker/major 없음, 마지막 `E2E_PORT_OFFSET=200 pnpm verify` 7단계 모두 통과(HEAD 141bab2).

- 브랜치: track/p2-docs-voice (작업 폴더 /Users/unhoyeo/livejjim-wt/p2)
- 스펙 커밋: 76bd2b0 ([spec] P2), BASE 358a6d2
- 개발: device / 테스트: domain
- 수용 기준: AC-P2-01~91 중 29개, 전부 [device]

## 1. 영역별로 만든 것

### packages/voice
- 추출기 `extractVoice`(R-17): 골든 69사례 모두 통과. 사전 3,000개에서 p99 약 7ms(기준 50ms).
- 품종 사전: 판매 이력 다음에 기본 사전 60개(출처 표기). 자모(NFD) 편집 거리 비트 병렬 계산, 유사도 0.8 이상만.
- 제안 카드 데이터 모델과 음성 설정: 확정·고치기·닫기, 자동 확정 기본 꺼짐·5초(HIGH·손대지 않음·번호 없음일 때만), 열린 카드 3장.
- SpeechEngine: Web Speech 어댑터(ko-KR, 60초 안 6번째 자동 종료 시 멈춤, 권한·마이크·미지원은 재시작 안 함), Deepgram·리턴제로 골격(서버 중계 연결 함수만, 키·주소 없음). 만들기만으로는 마이크를 열지 않는다.

### packages/documents
- 확인서 데이터: 금액은 코어 `getSettlement` 값 그대로, 문서 계산은 부분 입금의 남은 금액 하나. 줄 합 불일치·품목 없음은 오류.
- PDF: A4, 모든 쪽에 고지·쪽 번호, 부분 글꼴 내장(Pretendard + OFL). 전원 일괄은 표시 이름 코드 포인트 순, 구매자마다 새 쪽.
- 공유 이미지: 폭 1080px PNG, 글리프 윤곽을 직접 칠하는 Node·브라우저 공용 코드.
- 판매대장 행과 .xlsx: 확정 찜·안 팔린 상품마다 한 행, 찜 시각 KST, 수식 칸 없음, 첫 줄 틀 고정, 리허설 거부.
- 수정 라운드 1: 마지막 쪽에서 합계·최종 결제 금액이 빠지던 문제(SA-P2-001/TD-P2-001)를 금액+계좌 keepTogether 블록으로 고침(e613aef). 판매대장 속성 시험의 행 짝짓기 결함(SA-P2-002)을 고치고 seed 1300622960 회귀 사례 고정.

### 골든 러너 최소 연결 (코어 시험 영역)
- parser suite `voice-extract` 계약·실행·비교 추가(상대 경로 import, 워크스페이스 고리 없음).
- 읽기 오류 픽스처 20, 일부러 틀린 추출기 4종 시험.
- core-adapter.test.ts 합계: 파일 23 · 파서 448 · 엔진 121 · 통과 569.
- 코어 index.ts에 `normalizeText` 내보내기 한 줄.
- 러너 직렬화 빠른 길(SA-P2-003 대응): 골든 CLI 786ms → 540ms, 결과·오류 문장 동일(serialize.test.ts).

### 루트 공용
- eslint.config.mjs에 두 패키지 src 블록(Node 모듈·시계·난수·Intl 금지), 루트 devDependencies에 두 패키지.
- 적대 시험 testTimeout 60초(게이트 소유자 595f077) — 근거 번호 문제는 SA-P2-006.

## 2. 남은 blocker / major

없음.

## 3. 자율 결정 · 사용자 확인 필요 사항

에스컬레이션 없음. 아래 결정은 모두 blocking 아님으로 적용했다.

| ID | 질문 | 적용 |
|---|---|---|
| D-201 | 병렬 트랙 번호 충돌 | P2는 D-201~249, G-ENG-201~249, AC-P2-*, 골든 파일 이름에 p2 |
| D-202 | 번호·가격 고르기 | 숫자/한자어 수사+'번'만 번호('이' 제외), 가격은 R-14 원 단위 가장 긴 묶음, 애매하면 null, 300자 초과 전부 null |
| D-203 | 품종 자모 유사도 | NFD, 유사도 ≥0.8 분수 비교, 사전에 없으면 비움, 신뢰도 HIGH/LOW |
| D-204 | 카드·자동 확정 | 기본 꺼짐 5초(3~30), HIGH·손대지 않음·번호 없음, 열린 카드 3장 |
| D-205 | 음성 엔진 어댑터 | 60초 안 6번째 자동 종료 시 멈춤, 키 없음, 기본 꺼짐 |
| D-206 | 확인서 내용 | 찜 시점 가격, 조정 사유 미표기, 남은 금액만 계산, 문자 구매자 끝 4자리, 리허설 표기 |
| D-207 | 일괄 PDF·이미지 | 코드 포인트 순, A4, PNG 1080px, OFL 글꼴, 그릴 수 없는 글자 제거, node:* 금지 |
| D-208 | 판매대장 행 | 확정 찜·안 팔린 상품 한 행, R-6 시각(KST), 배송 비움, 리허설 거부 |
| D-209 | 음성 골든 위치 | 기존 러너에 parser suite voice-extract, 코어 src는 voice import 안 함 |

**사용자(또는 spec-keeper) 확인 필요**
- TD-P2-002: 끊어 말한 번호('1 5번', '이 십 번')를 HIGH로 채움 — 금액 조각처럼 애매 처리할지 결정 필요. 자동 확정을 켜면 다른 번호 상품이 등록될 수 있다.
- SA-P2-004: 열린 카드가 모두 손댄 카드면 새 카드도 닫지 않아 4장이 됨 — D-204 문장 보강 또는 코드 수정.
- TD-P2-004: 전원 일괄 순서를 원문 표시 이름 순/찍힌 이름 순 중 무엇으로 할지.
- SA-P2-006: 'D-098' 번호 충돌 — 적대 시험 시간 제한 결정에 새 번호 필요(main의 D-098은 구매자 표시 이름 결정).
- SA-P2-007: 직렬화 빠른 길을 dev-core가 사후 확인하고 D-209 범위에 더할지.

## 4. minor / nit 백로그

| ID | 심각도 | 제목 | 파일 | 제안 |
|---|---|---|---|---|
| SA-P2-004 | minor | 열린 카드 3장 규칙: 새 카드를 닫지 않는 예외를 스펙 확인 없이 정함 | packages/voice/src/card.ts:223 | D-204 보강 또는 문장대로 수정 |
| SA-P2-005 | minor | 공유 이미지 브라우저 동일성에 실행 시험 없음 | packages/documents/test/png.test.ts:28 | dev-notes 문구 정정, 브라우저 확인은 I2 E2E |
| TD-P2-002 | minor | 끊어 말한 번호가 엉뚱한 번호의 HIGH | packages/voice/src/extract.ts:133 | 번호 앞이 수 토큰이면 애매 처리 + 골든 |
| SA-P2-006 | minor | 'D-098' 근거 번호가 이 폴더에 없고 main에서 다른 뜻 | vitest.adversarial.config.ts:14 | 새 번호 부여, 참조 교체 |
| TD-P2-003 | nit | U+FFFE/U+FFFF가 있으면 .xlsx가 열리지 않음 | packages/documents/src/xlsx.ts:36 | XML 1.0 금지 글자 제거 |
| TD-P2-004 | nit | 일괄 순서가 찍힌 이름이 아니라 원문 코드 포인트 순 | packages/documents/src/receipt.ts:283 | spec-keeper 결정, AC-P2-24 기록 |
| SA-P2-007 | nit | 직렬화 빠른 길이 dev-core 영역을 근거 없이 변경 | packages/core/test/golden/serialize.ts:100 | 사후 확인, D-209 범위 보강 |

모두 harness/backlog.yaml techDebt에 추가했다.

## 5. 추적성

| AC | 구현 | 시험 |
|---|---|---|
| AC-P2-01 | packages/voice/src/extract.ts | packages/voice/test/extract.test.ts, tests/adversarial/p2/voice-broadcast-speech.test.ts |
| AC-P2-02 | packages/voice/src/extract.ts | packages/voice/test/extract.test.ts |
| AC-P2-03 | packages/voice/src/extract.ts | packages/voice/test/extract.test.ts |
| AC-P2-04 | packages/voice/src/extract.ts, jamo/dictionary | packages/voice/test/jamo-dictionary.test.ts, extract.test.ts |
| AC-P2-05 | packages/voice/src/extract.ts | packages/voice/test/extract.test.ts |
| AC-P2-06 | packages/voice/src (jamo·dictionary) | packages/voice/test/jamo-dictionary.test.ts |
| AC-P2-07 | packages/voice/src/extract.ts | packages/voice/test/perf.test.ts |
| AC-P2-08 | packages/core/test/golden/core-adapter.ts, tests/golden/parser/voice-extract.yaml | packages/core/test/golden/voice-extract.test.ts, packages/voice/test/extract.test.ts |
| AC-P2-10 | packages/voice/src/card.ts | packages/voice/test/card.test.ts |
| AC-P2-11 | packages/voice/src/card.ts | packages/voice/test/card.test.ts |
| AC-P2-12 | packages/voice/src/card.ts (SA-P2-004 열림) | packages/voice/test/card.test.ts |
| AC-P2-13 | packages/voice/src (speech) | packages/voice/test/speech.test.ts |
| AC-P2-14 | packages/voice/src (speech) | packages/voice/test/speech.test.ts, boundaries.test.ts |
| AC-P2-15 | packages/voice/src (speech) | packages/voice/test/speech.test.ts, boundaries.test.ts |
| AC-P2-20 | packages/documents/src/receipt.ts | packages/documents/test/receipt.test.ts, pdf.test.ts |
| AC-P2-21 | packages/documents/src/receipt.ts | packages/documents/test/receipt.test.ts, mismatch.test.ts, boundaries.test.ts |
| AC-P2-22 | packages/documents/src/receipt.ts | packages/documents/test/receipt.test.ts |
| AC-P2-23 | packages/documents/src/layout.ts (금액+계좌 한 블록, e613aef) | packages/documents/test/pdf.test.ts, tests/adversarial/p2/receipt-pages.test.ts |
| AC-P2-24 | packages/documents/src/receipt.ts (TD-P2-004 열림) | packages/documents/test/receipt.test.ts, pdf.test.ts |
| AC-P2-25 | packages/documents/src/png.ts | packages/documents/test/png.test.ts (Node만, 브라우저는 코드 검사 — SA-P2-005) |
| AC-P2-26 | packages/documents/src/pdf.ts | packages/documents/test/pdf.test.ts |
| AC-P2-27 | packages/documents/src (receipt·pdf·png) | packages/documents/test/pdf.test.ts, receipt.test.ts, png.test.ts |
| AC-P2-30 | packages/documents/src/ledger.ts | packages/documents/test/ledger.test.ts |
| AC-P2-31 | packages/documents/src/ledger.ts | packages/documents/test/ledger.test.ts |
| AC-P2-32 | packages/documents/src/xlsx.ts (TD-P2-003 열림) | packages/documents/test/ledger.test.ts |
| AC-P2-33 | packages/documents/src/ledger.ts | packages/documents/test/ledger.test.ts (짝짓기 속성 + seed 1300622960), tests/adversarial/p2/documents-random.test.ts |
| AC-P2-40 | packages/voice, packages/documents 경계 | packages/voice/test/boundaries.test.ts, packages/documents/test/boundaries.test.ts |
| AC-P2-90 | tests/golden (파일 23·파서 448·엔진 121) | packages/core/test/golden/core-adapter.test.ts, verify golden 단계 |
| AC-P2-91 | 전체 | E2E_PORT_OFFSET=200 pnpm verify 통과(HEAD 141bab2) |

## 6. 다음 스프린트 제안

1. **spec-keeper 정리(짧게)**: TD-P2-002·SA-P2-004·TD-P2-004 결정, SA-P2-006 번호 재부여, SA-P2-007 D-209 범위 보강. TD-P2-002는 자동 확정을 여는 I4 전에 닫아야 한다.
2. **I2 (문서 화면·서버 연결)**: 내려받기·공유·가게 설정 저장. 같은 확인서 → 같은 PNG 바이트를 브라우저 E2E로 확인해 SA-P2-005를 닫고, TD-P2-003도 함께 처리.
3. **I4 (음성 화면·서버 중계)**: 카드 화면, 마이크 켜기, 외부 전송 안내, 서버 중계, 판매 이력 모으기.
4. main·p1·y1 트랙과 합칠 때 D-2xx·G-ENG-2xx 번호 대역과 core-adapter 합계 고정값을 다시 맞춘다.
