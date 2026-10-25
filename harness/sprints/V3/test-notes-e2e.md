# V3 test-e2e 메모

## 새 시험 — `tests/e2e/v3/**` (81개, D-V3-44까지 반영)
- `support.ts`: `setupV3`(바로 등록 기본 켬 그대로, 이력 2초 넘김), `sayWords`(사례 표 꼴: 토큰 k개 중간 결과 → 마지막 최종, 200ms), `recordWrites`/`productWrites`(POST /api/events 상품 쓰기).
- `instant.spec.ts`: AC-V3-20~24·26·29·50·51 (R1~R12·R21·R27·R28·R31~R50·R52·R53)
- `same-number.spec.ts`: AC-V3-30~32·35~37·39 (R13~R20, 거절한 번호, 응답 늦음·500)
- `numbers-merge.spec.ts`: AC-V3-25·27·28·51 (R7·R22·R24~R26·R51)
- `settings.spec.ts`: AC-V3-38 (두 페이지)·40~44 (a)~(e)·46·49

## 기존 시험 다루기 (D-V3-22, AC-V3-47)
(a) 준비 단계: `tests/e2e/i4/support.ts` `installFakeSpeech`와 `tests/e2e/i5/support.ts` `installSafariSpeech`가 기본으로 그 기기 설정에 `voice.autoRegister: false`를 넣는다. 시험이 넣은 설정에 그 키가 없으면 더하고, 넣은 설정이 없으면 저장값이 없을 때만 쓴다. 기대 글은 그대로이다. V3 시험과 아래 (b) 시험만 `autoRegister: true`로 그대로 둔다.

(b) 바뀐 규칙을 단언하던 시험. AC-V3 기준으로 바꿨고, 시험 이름이나 주석에 D-V3-01·06·18·22를 적었다.
- `i4/voice-auto.spec.ts` 전부 (AC-I4-30·31). 기본 꺼짐·5초·`HIGH`만·카운트다운을 바꿨다. 기본 켬, 틀린 값·옛 키면 켬, 원 들리면 바로 등록, 신뢰도와 상관없이 등록, 원 없는 카드는 등록 안 함, 창 미룸, 같은 번호는 "이미 등록됐어요", Enter와 겹쳐도 쓰기 1번.
- `i4/attacks.spec.ts`
  - "서버가 등록을 거절하면…"을 바로 등록이 거절되는 경우로 바꿨다.
  - "자동 확정 카드와 같은 번호의 빠른 입력…"을 바로 등록 + 차례에서 번호가 생기면 창 없이 R-22로 바꿨다 (D-V3-18).
- `i4/voice-flow.spec.ts` ⑦⑧: 자동 확정 켬을 바로 등록 켬으로, ⑧은 원 없는 말(카드)로 바꿨다.
- `i4/voice-layout.spec.ts` AC-I4-51: 새 체크를 쓴다. 틀린 값 오류는 조용한 시간 칸으로 본다.
- `n3/round1.spec.ts` TE-N3-004: 체크 이름만 바꿨다. 기대는 그대로다(D-V3-35로 확정, TE-V3-009).
- `mob1/voice.spec.ts` AC-MOB1-11, `i4/voice-onoff.spec.ts` AC-I4-11: 처음 켜는 기기(바로 등록 켬)로 두고 D-V3-36 첫 줄·D-V3-17 줄을 단언한다(끔은 v3 AC-V3-42).
- `v2/chunks.spec.ts` S5, `v2/decisions.spec.ts` AC-V2-35 두 개: 카운트다운이 보인다는 단언을 "없다"로 바꿨다. 저절로 등록되지 않는다는 기대는 그대로다.
- `i5/safari.spec.ts`
  - AC-I5-04: 5초 뒤 자동 등록을 바로 등록으로 바꿨다.
  - AC-I5-23: "자동 등록 멈추기"가 없다. 고치기 칸을 열었다 닫아 손댄 카드로 만든다.
- `i5/breaks.spec.ts` D-I5-02: 체크 이름만 바꿨다(끝에서 넘긴 덩어리는 바로 등록 안 함).

- D-V3-41 (번호 없는 결과는 카드 없음): `v2/chunks.spec.ts` S23, `i4/voice-cards.spec.ts` AC-I4-20(세 번째 카드를 번호 있는 말로)·AC-I4-22(번호 없는 카드 단계), `i4/attacks.spec.ts` 범위 밖 번호, `i4/voice-onoff.spec.ts` XSS 문장(기록으로 봄), `i4/voice-layout.spec.ts` AC-I4-51(고치기 칸 오류는 번호만 카드로), `i4/voice-flow.spec.ts` ⑤(번호만 카드에 가격 채우기).
- D-V3-06 (같은 번호는 R-22): `i4/voice-cards.spec.ts` AC-I4-22 앞부분, `i4/voice-flow.spec.ts` ⑥ — 카드·"고칠까요?" 창 대신 묻기 카드.
- D-V3-44 (켬이면 원 없는 결과 카드 없음): `i4/voice-auto.spec.ts` 원 없는 카드 시험 둘은 설정 끔으로, `i4/voice-flow.spec.ts` ⑧ 앞에서 바로 등록을 끈다. `v2/chunks.spec.ts` S3는 준비 단계 끔 그대로 V2 문구(D-V3-43 개정).

`.skip`·`.only`·삭제 없음.

## 지적
첫 라운드 TE-V3-001~009는 모두 고쳐졌다(dev 커밋 1e6dba77·453176a0·5e052b4d). TE-V3-002·005는 D-V3-37로 기대가 바뀌었다. TE-V3-004는 D-V3-30으로 R1에 품종이 없어 문장이 "방금 등록한 108번을 …"이다. TE-V3-009는 D-V3-35로 정해졌다.

2026-10-25 마지막 실행(HEAD 09c6e453): v3 81개 + 기존 음성 E2E 190개 = 271개 중 268개 통과. 실패 3개 가운데 AC-V3-37은 시험을 D-V3-44에 맞춰 고쳤다. 나머지 둘(n3 TE-N3-004의 `/api/days` 요청 수 1 → 2, i5 audit2 `clock.pauseAt` 과거 시각)은 다시 돌리면 통과했다. 같은 기계에 다른 실행이 겹친 부하 탓으로 본다.
