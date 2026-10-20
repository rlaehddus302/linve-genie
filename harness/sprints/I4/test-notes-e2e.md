# I4 test-e2e 노트

## 라운드 0

E2E는 `tests/e2e/i4/`에 있다. 돌리기: `E2E_PORT_OFFSET=600 pnpm e2e` (또는 `cd apps/web && E2E_PORT_OFFSET=600 npx playwright test ../../tests/e2e/i4 --project chromium`).
가짜 음성 인식은 `tests/e2e/i4/support.ts`의 `installFakeSpeech`(addInitScript로 `SpeechRecognition`·`webkitSpeechRecognition`을 바꿈, `getUserMedia`를 셈, 저장소 미리 넣기·막기)와 `speak`·`speechError`·`speechEnd`(마지막 인식 객체가 결과·오류·끝을 냄)다. 화면 코드에 시험용 훅은 없다.

| 파일 | 대상 | 결과 |
|---|---|---|
| `voice-onoff.spec.ts` | 켜기·끄기·안내 창·상태·오류·자막·개인정보·떠나기 (AC-I4-10~14) | 통과 |
| `voice-cards.spec.ts` | 카드 글·Enter 1초·두 번 Enter·글자 있는 칸·창·고치기 칸·휴대폰·누르기·번호/가격 없음·이미 있는 번호·고치기 칸 해석·Tab·차례·오프라인 다시 보내기·Ctrl+Z (AC-I4-20~23) | 통과 |
| `voice-auto.spec.ts` | 자동 확정 설정·저장값·4.9/5초 경계·LOW·손댐·음성 끔·창 미룸·번호 생김·Enter와 겹침 (AC-I4-30·31, `page.clock`) | 통과 |
| `voice-history.spec.ts` | 판매 이력 사전 12개 날짜·리허설·지금 범위·조회 실패 (AC-I4-40) | 통과 |
| `voice-layout.spec.ts` | 375×812 고정 영역 ≤ 284px·44px·16px·가로 스크롤, 1440×900 ≤ 450px·끝까지 내려도 카드·5장 (AC-I4-50), 금지 낱말 (AC-I4-51) | 통과 |
| `voice-flow.spec.ts` | ①~⑧ 끝까지 + 보드·범위 이력·실제 범위·요청 맞대기 + 끈 뒤 빠른 입력 (AC-I4-90) | 통과 |
| `attacks.spec.ts` | 고치기 칸 그대로 등록(15,000원)·서버 거절 되살리기·기록 20개·한 이벤트에 최종 둘·지난 인식 객체의 늦은 결과·끈 뒤 늦은 결과·다른 방송으로 바로 이동·늦은 응답 중 또 누르기·maxNumber 스냅샷·긴 문장 375px·자동 확정과 차례·스냅샷 전 잠김 | 통과(회귀) |
| `attacks.spec.ts` TE-I4-001 | 저절로 끝나 다시 시작할 때 "음성: 다시 시작 중"이 한 번도 그려지지 않음 (AC-I4-12) | **실패** |
| `attacks.spec.ts` TE-I4-002 | 음성 코드 받기 실패 뒤 다시 눌러도 계속 실패(새로 고침 전까지) | **실패** |

- 기존 S05·S06 E2E는 고치지 않았다. I4 시험과 같은 서버에서 함께 돌려 모두 통과했다(chromium 묶음 186개 중 실패 2 = 위 두 지적).
- 같은 실행의 시험은 한 서버를 함께 쓴다. `voice-history`는 오늘(KST) 실제 범위를 지금 범위로, 오늘 바로 앞 12일에 지난 실제 범위를 만든다(다른 시험은 uniqueDate — 2005~2024 — 를 써서 "가장 늦은 10개"가 이 시험 날짜가 된다). 미래 날짜는 쓰지 않는다. 이 이력 이름은 뒤 시험의 사전에도 들어가므로 다른 시험이 말하는 이름(핑크프릴 등)의 공백 변형은 넣지 않았다(`레티 지아`만).

### TE-I4-001 "음성: 다시 시작 중"이 보이지 않는다 (minor)
- 원인: `packages/voice/src/web-speech.ts` `handleEnd`가 `setState('RESTARTING')` 직후 같은 호출 안에서 `open()` → `setState('LISTENING')`을 한다. 컨트롤러(`apps/web/src/voice/controller.ts` `#onState`)는 둘 다 받지만 React가 한 번에 그려서 화면에는 "듣는 중"만 남는다(MutationObserver로 음성 칸의 `status`를 지켜봐도 바뀜이 0번).
- AC-I4-12 "5번째까지는 다시 시작하고 상태가 '음성: 다시 시작 중'을 거친다"와 다르다. 판매 사고는 아니다.

### TE-I4-002 음성 코드를 한 번 받지 못하면 새로 고침 전까지 다시 켤 수 없다 (minor)
- 재현: "음성 켜기"를 누를 때 음성 조각(`assets/src-*.js`) 요청이 끊김 → "음성 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요." → 연결을 되돌리고 다시 누름 → 조각 요청이 **0번**이고 같은 문장이 다시 뜬다.
- 원인: `apps/web/src/voice/load.ts`는 실패하면 `pending`을 비워 `import('@livejjim/voice')`를 다시 부르지만, 크롬은 실패한 동적 import를 같은 주소로 다시 받지 않는다(모듈 지도에 실패가 남는다). dev-notes "정한 것 8 — 다시 누르면 다시 받는다"와 안내 문장("다시 켜 주세요")이 지켜지지 않는다.

### 스펙 확인 필요 (시험은 resolveVoiceSettings대로)
- AC-I4-30 "저장값이 틀렸거나(모르는 키·`"true"` 글자·0초·31초) … `resolveVoiceSettings`대로 꺼짐·5초다": `resolveVoiceSettings`는 키마다 따로 본다. `{"voice.autoConfirm": true, "voice.autoConfirmSec": 31}`이면 켬·5초(켬은 그대로)이고, 모르는 키가 있어도 나머지 값을 쓴다. 문장의 "꺼짐·5초"를 저장값 전체를 버리는 뜻으로 읽으면 다르다. 시험은 "resolveVoiceSettings대로"(키마다)로 썼다. 기다림이 기본 5초로 돌아가므로 판매 안전 문제는 아니다.
