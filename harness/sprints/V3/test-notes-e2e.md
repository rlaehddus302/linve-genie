# V3 test-e2e 메모

## 새 시험 — `tests/e2e/v3/**` (64개)
- `support.ts`: `setupV3`(바로 등록 기본 켬 그대로, 이력 2초 넘김), `sayWords`(사례 표 꼴: 토큰 k개 중간 결과 → 마지막 최종, 200ms), `recordWrites`/`productWrites`(POST /api/events 상품 쓰기).
- `instant.spec.ts`: AC-V3-20~24·26·29 (R1~R12·R27·R28·R31~R43)
- `same-number.spec.ts`: AC-V3-30~32·35~37·39 (R13~R20, 거절한 번호, 응답 늦음·500)
- `numbers-merge.spec.ts`: AC-V3-25·27·28 (R7·R22~R26)
- `settings.spec.ts`: AC-V3-38 (두 페이지)·40~44·46·49

## 기존 시험 다루기 (D-V3-22, AC-V3-47)
(a) 준비 단계: `tests/e2e/i4/support.ts` `installFakeSpeech`와 `tests/e2e/i5/support.ts` `installSafariSpeech`가 기본으로 그 기기 설정에 `voice.autoRegister: false`를 넣는다. 시험이 넣은 설정에 그 키가 없으면 더하고, 넣은 설정이 없으면 저장값이 없을 때만 쓴다. 기대 글은 그대로이다. V3 시험과 아래 (b) 시험만 `autoRegister: true`로 그대로 둔다.

(b) 바뀐 규칙을 단언하던 시험. AC-V3 기준으로 바꿨고, 시험 이름이나 주석에 D-V3-01·06·18·22를 적었다.
- `i4/voice-auto.spec.ts` 전부 (AC-I4-30·31). 기본 꺼짐·5초·`HIGH`만·카운트다운을 바꿨다. 기본 켬, 틀린 값·옛 키면 켬, 원 들리면 바로 등록, 신뢰도와 상관없이 등록, 원 없는 카드는 등록 안 함, 창 미룸, 같은 번호는 "이미 등록됐어요", Enter와 겹쳐도 쓰기 1번.
- `i4/attacks.spec.ts`
  - "서버가 등록을 거절하면…"을 바로 등록이 거절되는 경우로 바꿨다.
  - "자동 확정 카드와 같은 번호의 빠른 입력…"을 바로 등록 + 차례에서 번호가 생기면 창 없이 R-22로 바꿨다 (D-V3-18).
- `i4/voice-flow.spec.ts` ⑦⑧: 자동 확정 켬을 바로 등록 켬으로, ⑧은 원 없는 말(카드)로 바꿨다.
- `i4/voice-layout.spec.ts` AC-I4-51: 새 체크를 쓴다. 틀린 값 오류는 조용한 시간 칸으로 본다.
- `n3/round1.spec.ts` TE-N3-004: 체크 이름만 바꿨다. 기대는 그대로이며 지금 실패한다(아래 TE-V3-009).
- `mob1/voice.spec.ts` AC-MOB1-11: 안내 창 줄에 D-V3-17 줄 하나를 더했다.
- `v2/chunks.spec.ts` S5, `v2/decisions.spec.ts` AC-V2-35 두 개: 카운트다운이 보인다는 단언을 "없다"로 바꿨다. 저절로 등록되지 않는다는 기대는 그대로다.
- `i5/safari.spec.ts`
  - AC-I5-04: 5초 뒤 자동 등록을 바로 등록으로 바꿨다.
  - AC-I5-23: "자동 등록 멈추기"가 없다. 고치기 칸을 열었다 닫아 손댄 카드로 만든다.
- `i5/breaks.spec.ts` D-I5-02: 체크 이름만 바꿨다(끝에서 넘긴 덩어리는 바로 등록 안 함).

`.skip`·`.only`·삭제 없음.

## 지적 (실패로 남긴 시험)
| ID | 심각도 | 시험 | 내용 | 원인 추정 파일 |
|---|---|---|---|---|
| TE-V3-001 | major | instant R4 | 실제 방송 3을 k=11에서 `180번 상관 350,000원`(추측)으로 등록하고, 덩어리 끝에 삼광색금으로 고치기를 또 보낸다. 사전 별칭이 AC-V3-05와 다르다(`상관세금`·`삼광세금` 없음, `삼강색급`·`상강세금` 있음). | `packages/voice/data/varieties.ko.json` |
| TE-V3-002 | major | instant R27 | 추측 품종 카드(`19번 선버스 8,000원`)에 "품종 확인 필요"와 후보 단추가 없다. `card.name === null`일 때만 보인다(D-V3-09). | `apps/web/src/components/VoicePanel.tsx` |
| TE-V3-003 | critical | numbers-merge R24 | 고치기 칸을 열어 손댄 15번 카드가 있어도 "15번 루비 이만 원" 중간 결과로 15번 루비 20,000원을 바로 등록하고 카드를 닫는다. `#tryInstant`가 손댄 열린 카드를 보지 않는다. | `apps/web/src/voice/controller.ts` |
| TE-V3-004 | minor | same-number R19 | "방금 등록한 108번 bts**을**…"이라고 나온다. 스펙 글자는 "bts**를**"이다. | `packages/voice/src/target.ts` (`withObject`) |
| TE-V3-005 | major | settings R30 | 설정을 끄면 카드에 추측 품종이 빠진다(`108번 품종 미입력 100,000원`). 스펙은 "108번 bts 100,000원"과 품종 확인 필요다. | `apps/web/src/voice/controller.ts` |
| TE-V3-006 | major | settings (a) | 음성 기록 창이 열린 동안의 R1은 카드가 되고, 창을 닫아도 등록되지 않는다. 보드 자세히 창은 voice-auto에서 통과한다. 음성 기록 창을 닫을 때 다시 보지 않는 것으로 보인다. | `apps/web/src/components/VoicePanel.tsx`·`controller.ts` |
| TE-V3-007 | major | same-number R15 | 찜이 있는 상품의 빈 품종을 사전 이름으로 채우는 바로 고침이 "108번을 고치는 중이에요"(단추 꺼짐)에 멈춘다. | `apps/web/src/voice/controller.ts` `#autoFix` |
| TE-V3-008 | minor | same-number 500 | 등록이 500(INTERNAL_ERROR)이면 "다시 보내기"만 있고 그 덩어리 카드가 없다(AC-V3-39 "카드 하나와 다시 보내기"). | `apps/web/src/components/ConsolePage.tsx` |
| TE-V3-009 | 스펙 확인 필요 | n3 TE-N3-004 | 끈 채 말하고 이력을 기다리는 사이 켜면 그 문장이 바로 등록된다. V3에서 이 경우의 정답이 정해져 있지 않다(D-V3-22 (a)로 기대는 그대로 둠). | spec |

그 밖의 메모(시험 없음): 안내 창 첫 줄 "카드를 확인하고 등록해야 상품이 생겨요."가 V3 줄 "바로 등록돼요"와 어긋난다(D-I5-11 줄 그대로라 스펙대로이다 — ux 확인).
