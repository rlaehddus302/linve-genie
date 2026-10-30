# SRV1 수용 기준 — 읽기는 서버

- 근거: 사용자 결정 D-APP-22("그리고 음성인식과 채팅에서 찜 읽기는 서버에서 수행하자.", 2026-10-30), D-APP-23(읽기·표시 경계), D-APP-24(빠른 입력·칸도 서버), D-APP-25(크롬 길 정리). SPEC VOC-01·VOC-05·VOC-06 AC6, APP-05 AC5·AC9~AC14, PRD-01·ORD-08·YT-03·YT-10·PLT-02 "읽는 곳" 줄. NFR-09, D-APP-20.
- 범위: 받아쓰기(소리→글)와 읽기(글→번호·품종·가격·찜·취소·받은 시각·전화번호)를 서버 한 곳에서만 한다. 기기(웹·앱·확장)는 원문을 보내고 서버가 읽은 결과를 받는다. PC 크롬 Web Speech 길을 없앤다. 순서 server → web.
- 바뀌지 않는 것: 판정·정산 규칙(DOMAIN_RULES)·파서 규칙·골든 정답. 같은 원문은 옮기기 전과 같은 결과여야 한다(골든을 서버 입구로 통과).
- 영역 배정: devs [server, web], tests [domain, e2e]. 앱(`apps/mobile`) 코드 수정은 web 영역이 맡는다(APP2와 같음).

## 조사 — 지금 기기에서 읽는 곳 (origin/main 561c2fee 기준, 시험 파일 제외)

경계(D-APP-23): 사람이 쓴/말한 글을 값·뜻으로 바꾸면 **옮김**. 서버가 준 값을 보이는 모양으로 바꾸기, 서버가 다시 하는 막기만 하는 사전 검사, 상수·타입, 기기 일(마이크·BLE·원문 꺼내기)은 **남김**. 판매자 안전: 등록·찜은 이미 서버 없이 안 되므로 옮겨서 새로 막히는 판매 기능은 없다 — 바뀌는 것은 미리 보기가 서버 답을 기다리는 것뿐.

| # | 파일 | 함수·부르는 것 | 하는 일 | 판단 | 옮기면 지연·오프라인 |
|---|---|---|---|---|---|
| 1 | `apps/web/src/voice/transport.ts` | `createWebSpeechEngine`(`packages/voice/src/web-speech.ts`) | PC 크롬 받아쓰기(소리→글을 브라우저·구글이 함) | **없앰**(D-APP-22) — PC도 PCM → 서버 받아쓰기 | 서버 받아쓰기 지연(조각 쉼 0.4초 + 처리)으로 같아짐. 받아쓰기 서버가 꺼지면 PC도 손 입력뿐 |
| 2 | `apps/web/src/voice/capabilities.ts` | `supportsVoiceCapture('chrome')` | `SpeechRecognition` 있는지 봄 | **없앰**(크롬 가지) — `livegenie` 검사만 남김 | 없음 |
| 3 | `apps/web/src/voice/remote.ts` | `canChooseVoiceEngine`·`readVoiceEngine`·`writeVoiceEngine`·`chromeMode` | "받아쓰기 방법" 칸·저장값·크롬 상태 문장 | **없앰**(D-APP-25) — 저장값 지움 | 없음 |
| 4 | `apps/web/src/components/VoicePanel.tsx`·`VoiceBand.tsx` | `canChooseVoiceEngine`·`readVoiceEngine` | 엔진 고르는 칸·띠 문장 | **없앰** | 없음 |
| 5 | `apps/web/src/voice/controller.ts` (4,407줄) | `VoiceController` 클래스(덩어리·카드·정정·문자찜 판단), 그 안의 `parseAmount` | 서버(`packages/voice-session/src/server.ts`)가 웹 소스에서 가져다 돌림. 웹은 상수·타입·문장만 씀 | **옮김(자리)** — 클래스를 서버 전용 패키지로, 웹엔 문장·타입만. 지금 웹 번들에서는 쓰이지 않으나(AC-APP1b-05) 소스가 웹에 있어 다시 불리기 쉽다 | 없음(이미 서버에서 돎) |
| 6 | `apps/web/src/voice/load.ts` | `import('@livejjim/voice')` | 음성 패키지 통째로 동적 import(부르는 곳 없음, 잔재) | **없앰** | 없음 |
| 7 | `apps/web/src/lib/quick.ts` | `parseQuickInput`·`parseAmount` (`decideQuickInput`·`previewNumber`·`numberErrorFill`·`decideFixForm`·`fixPricePreview`·`registerPreview`) | 빠른 입력 한 줄·고치기 칸을 번호·품종·가격으로 읽음, 미리 보기 | **옮김**(D-APP-24) | 미리 보기 한 번 왕복(50~300ms, 150ms 기다림 뒤). 끊기면 미리 보기 비움, 보내기는 지금처럼 "다시 보내기" |
| 8 | `apps/mobile/src/lib/quick.ts`·`screens/console/QuickInput.tsx` | `parseQuickInput`(`@livejjim/core/quick-input`) | 앱 빠른 입력 읽기 | **옮김**(D-APP-24) — 앱 판이 늦어도 같은 결과 | 7과 같음 |
| 9 | `apps/web/src/components/ActionDialogs.tsx` | `parseAmount` | 상품 고치기 창 가격 칸 읽기 | **옮김** | 저장 때 서버가 읽음, 칸 오류 문장은 서버 답 |
| 10 | `apps/web/src/lib/money.ts`·`lib/settings-fields.ts` | `parseAmount`(WON) | 정산 금액 칸·설정 금액 칸 읽기 | **옮김** | 9와 같음(방송 밖 화면이라 지연 영향 작음) |
| 11 | `apps/web/src/lib/received.ts` | `resolveReceivedTime`·`readReceived`(12/24시 고르기) | 문자찜 받은 시각 칸 → 보낼 시각. 선착순 순위에 들어가는 값 | **옮김**(D-APP-24) — 기기 시계·판에 기대지 않음 | 미리 보기 "오늘 15:10"이 서버 답. 보내기는 원문 |
| 12 | `apps/web/src/components/SmsPage.tsx` | `normalizePhone`·`phoneLast4`·`containsPhoneRun` | 전화번호 칸 정리·뒤 4자리 미리 보기·메모 전화번호 막기 | **옮김** — 서버가 이미 정리·거절(AC-SMS-04)하므로 기기 것은 지움 | 메모 경고가 보낸 뒤 서버 답으로(칸 글 그대로) |
| 13 | `apps/web/src/components/SettlementsPage.tsx` | `containsPhoneRun` | 정산 메모·사유 칸 전화번호 막기 | **옮김** — 서버가 같은 문장으로 거절해야 함(없으면 서버에 더함) | 12와 같음 |
| 14 | `apps/web/src/components/ChatPanel.tsx` `optionLook` | `compareChars`로 채팅 글에서 상품 이름·별칭 찾기 | 채팅 줄의 "언급" 표시(이름만 쓴 글) | **옮김**(D-APP-23) — 서버가 주는 `mentions`에 이름 언급을 넣음 | 없음(채팅은 이미 서버가 보냄) |
| 15 | `apps/web/src/lib/options.ts` | `compareChars`·`variantTexts`·`variantCount` | 옵션 편집 칸 이름 중복 막기·변형 글 표시 | **남김**(ⓑ막기만·ⓐ표시) — 서버가 같은 검사 | — |
| 16 | 웹·앱 여러 곳 | `formatWon`·`DEFAULT_SETTINGS`·`OPTION_LIMITS`·`FOCUS_GRACE_SEC`·`PRICE_UNITS`·`isPriceUnit`·타입 | 금액 모양·기본값·상수 | **남김**(ⓐⓒ) | — |
| 17 | `apps/web/src/lib/settlement.ts` | `settle` | 정산 합계 계산(읽기 아님) | **이번 범위 밖** — 읽기가 아니라 계산. 같은 원칙 후보로 기록만 | — |
| 18 | `apps/extension/src/reader.ts`·`tiktok-reader.ts`(`readComment`) | DOM에서 ID·닉네임·본문·시각 꺼내기 | 원문 수집 | **남김**(ⓓ) — 번호·찜을 읽지 않음(확인함). AC14로 지킴 | — |
| 19 | `apps/web/src/components/PasteDialog.tsx`·`DepositPaste.tsx` | `/paste/preview` 서버 호출 | 댓글·입금 붙여넣기 미리 보기 | **이미 서버** — D-APP-24 미리 보기의 본보기 | — |
| 20 | `apps/mobile/src/lib/voice-session.ts`·`apps/web/src/voice/transport.ts`(livegenie·pcm16·speech) | 소리 보내기·서버 결과 받기 | 기기 일 | **남김**(ⓓ) | — |

## 약속

1. 서버 읽기 입구 하나: 인증된 판매자·방송에 묶인 `POST` 하나(예: `/api/broadcasts/:id/read`)가 `{ kind, text }`(kind = `quick`·`fix`·`price`·`money`·`received`·`phone`)를 받아 지금 기기 함수와 같은 결과 모양(번호·품종·가격·오류 코드·지금 문장)을 돌려준다. 저장·로그·이벤트를 남기지 않는다(읽기만). 글 한 틀 2,000자 한도, 같은 쓰기 Origin 검사.
2. 쓰기 API는 원문을 받는다: 빠른 입력 등록·고치기·문자찜·정산 금액은 친 글 원문(+ 요청 번호)을 보내고 서버가 1과 같은 함수로 읽어 기록한다. 기존 숫자 필드 요청은 한 판 동안 함께 받아도 되지만 웹·앱은 원문만 보낸다.
3. 미리 보기: 마지막 글자 뒤 150ms에 1을 부르고, 그 사이 글이 바뀌면 앞 답은 버린다(늦게 온 옛 답을 보이지 않음). 답이 없거나 연결이 없으면 미리 보기 줄을 비운다. Enter는 답을 기다리지 않는다.
4. 음성 흐름: `mode=chrome` 최종 글 입력은 거절(`UNSUPPORTED` 같은 코드, 쓰기 0). 조작 전용 연결은 크롬과 무관한 인자로 연다. 저장된 `livejjim.voiceEngine`은 읽지 않고 지운다.
5. 채팅 언급: 서버가 채팅 보기 항목에 상품 이름·별칭 언급 번호를 넣는다(지금 `optionLook`과 같은 비교 — 두 글자 이상, `compareChars`). 기기는 서버 값만 쓴다.

## 수용 기준

| ID | 영역·근거 | Given / When / Then | 확인 |
|---|---|---|---|
| AC-SRV1-01 | [server] APP-05 AC10, 약속 1 | Given 골든 `tests/golden/parser/quick-input.yaml`·`parser/amount.yaml`. When 각 사례를 서버 읽기 입구로 넣는다. Then 모든 기대값과 같다. | 단위·골든 |
| AC-SRV1-02 | [server] 약속 1·2 | Given 판매자 세션·켠 방송(가격 단위 천원). When 빠른 입력 등록 API에 원문 `15 핑크프릴 20`을 보낸다. Then 15번·핑크프릴·20,000원 상품 하나, 요청 번호로 다시 보내도 하나. 다른 판매자 방송은 404, Origin 다르면 403. | 단위 |
| AC-SRV1-03 | [server] 약속 1 | Given 서버 읽기 입구. When 표지 글 `15 표지핑크 20`을 읽는다. Then 서버 로그·DB·이벤트·백업에 그 글이 없다. | 단위 |
| AC-SRV1-04 | [web] APP-05 AC10 | Given 가격 단위 천원 방송, PC 1280과 375 휴대폰. When 빠른 입력에 `15 핑크프릴 20`을 치고 Enter. Then 미리 보기가 서버 답으로 "15번 핑크프릴 20,000원"이고, 등록 요청 본문은 친 원문이며, 15번 20,000원 하나가 보인다. | E2E |
| AC-SRV1-05 | [web] APP-05 AC10 (앱) | Given 앱 빠른 입력 화면(모의 서버). When 같은 줄을 친다. Then 앱이 읽기 함수를 부르지 않고 서버 읽기 입구 답을 보이며 원문을 보낸다. | 앱 단위 |
| AC-SRV1-06 | [web] APP-05 AC11, 약속 3 | Given 서버 읽기 입구가 답하지 않음. When `15 핑크프릴 20`을 친다. Then 미리 보기 줄이 비어 있고 앞 글의 옛 답이 없다. Enter 뒤 "저장하지 못했어요", 연결이 돌아오면 같은 원문·같은 요청 번호로 한 번만 등록된다. | E2E |
| AC-SRV1-07 | [server][web] APP-05 AC12 | Given 문자찜 화면. When 받은 시각 `3:10`, 전화번호 `010-1234-5678`을 쳐 보낸다. Then 미리 보기·저장값이 서버 답(옮기기 전 화면이 고르던 날짜·시각과 같음, 끝 4자리 `5678`). 메모에 전화번호를 넣으면 서버가 지금 문장으로 거절하고 칸 글은 그대로다. | 단위 + E2E |
| AC-SRV1-08 | [server][web] 조사 13 | Given 정산 메모·사유 칸. When 전화번호를 넣고 저장. Then 서버가 지금 화면 문장(`PHONE_IN_TEXT`)으로 거절하고 아무것도 저장되지 않는다. | 단위 + E2E |
| AC-SRV1-09 | [server][web] APP-05 AC13, 약속 5 | Given 옵션 방송 상품 "핑크프릴". When 채팅 "핑크프릴 이뻐요"가 온다. Then 서버 채팅 항목에 15번 언급이 있고 PC·375 모두 같은 언급 줄로 보인다. 서버가 언급으로 주지 않은 글은 기기가 언급으로 바꾸지 않는다. | 단위 + E2E |
| AC-SRV1-10 | [web] VOC-06 AC6, D-APP-25 | Given PC 크롬 1280, 저장소 `livejjim.voiceEngine=chrome`, 가짜 `SpeechRecognition` 생성자. When 음성 켜기 → 안내 창 → 허락 → 모의 일꾼이 `15번 2만 원`. Then "받아쓰기 방법" 칸이 없고, `SpeechRecognition` 생성자가 0번 불리고, 저장값이 지워지고, 15번 20,000원이 등록된다. 375·앱도 칸 없음. | E2E |
| AC-SRV1-11 | [web] VOC-05, D-APP-22 | Given PC 1280에서 음성 켬, 모의 받아쓰기 서버를 끈다. When 한도까지 끊긴다. Then "듣기 멈춤 · 받아쓰기 서버에 연결하지 못했어요. 상품은 빠른 입력으로 넣어 주세요. [다시 켜기]"가 보이고 크롬으로 바꾸라는 안내·칸이 없으며 빠른 입력으로 등록된다. | E2E |
| AC-SRV1-12 | [server] APP-05 AC5, 약속 4 | Given 판매자 음성 흐름. When `mode=chrome`으로 최종 글 `15번 2만 원`을 보낸다. Then 거절되고 상품·찜·이벤트가 0. 조작 전용 연결의 카드 손 조작(D-APP1b-08)은 그대로 된다. | 단위 |
| AC-SRV1-13 | [web] APP-05 AC9 | Given `apps/web/src`·`apps/mobile/src`·`apps/extension/src`(시험 제외)와 운영 빌드 결과. When 의존·빌드 검사를 돌린다. Then D-APP-23 금지 목록의 값 import(정적·동적)가 0, 빌드 모듈 목록에 `packages/core/src/parse/`·`packages/voice/src/web-speech.ts`·음성 읽기 모듈·`VoiceController`가 없고, 결과에 `webkitSpeechRecognition` 글자가 없다. 금지 import 한 줄을 넣은 고정 사례에서 검사가 실패한다. | 단위(검사 스크립트, `pnpm verify` 안) |
| AC-SRV1-14 | [server] APP-05 AC14 | Given 확장 수집 API. When 유튜브·틱톡 확장 본문에 `claimNo` 같은 읽은 필드를 넣어 보낸다. Then 그 필드는 모르는 항목으로 거절되고, 같은 채팅을 공식 연결·확장으로 넣으면 같은 판정이다. | 단위 |
| AC-SRV1-15 | [server] APP-05 AC1 회귀 | Given APP1b 골든 `voice-extract`·`voice-register/*`·`voice/*`. When `VoiceController`를 서버 전용 자리로 옮긴 뒤 다시 돌린다. Then 모두 같은 기대값. | 단위·골든 |
| AC-SRV1-16 | [test:e2e] D-APP-25 (3) | Given 크롬 길 전제의 기존 E2E. When 갱신. Then 바뀐 시험마다 옛 AC → 새 AC·바꾼 전제·보존한 단언을 `harness/sprints/SRV1/test-notes-e2e.md`에 남기고 skip·only·todo·삭제가 없다. | 검토 |

## 하지 않는 것 (범위 밖)

- 판정·정산·파서·음성 추출 규칙과 골든 정답 변경, 새 받아쓰기 모델·정확도 조정.
- 정산 합계 계산(`settle`)·라벨 미리 보기 등 읽기가 아닌 기기 계산의 서버 이전(조사 17 — 같은 원칙 후보로만 기록).
- 문자 자동 수집 기능 자체(사용자 결정 대기 — 만들게 되면 원문을 서버로 보내는 것만 정함).
- `packages/voice`의 Web Speech 어댑터 코드 삭제 여부(부르지 않으면 개발 영역 판단).
- 실기기·실방송 확인(HG-APP1·HG-APP2 그대로).
