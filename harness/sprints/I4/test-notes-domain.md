# I4 test-domain 노트

## 라운드 0

적대 시험은 `tests/adversarial/i4/`에 있다. 돌리기: `npx vitest run --config vitest.adversarial.config.ts tests/adversarial/i4/` (또는 `pnpm adversarial`).

| 파일 | 대상 | 결과 |
|---|---|---|
| `voice-controller-auto.test.ts` | 콘솔 음성 컨트롤러 자동 확정 타이머 (AC-I4-31) | **실패 4 — TD-I4-001** |
| `voice-split-number.test.ts` | 끊어 말한 번호 변형 + 속성 시험 (AC-I4-01) | 통과(회귀) |
| `voice-card-list.test.ts` | 열린 카드 3장 예외 속성 시험 (AC-I4-02) | 통과(회귀) |
| `voice-console-decisions.test.ts` | `apps/web/src/lib/voice.ts` Enter·1초·자동 확정·이력 사전 (AC-I4-21·31·40) | 통과(회귀) |
| `voice-accuracy.test.ts` | 측정 스크립트 CSV·종료 코드·표 깨기·요약 손 계산 (AC-I4-03) | 통과(회귀) |

### TD-I4-001 자동 확정 시각이 지난 두 번째 카드에 타이머가 없다

- 원인: `apps/web/src/voice/controller.ts` `#autoConfirm`은 한 번에 카드 하나만 등록하고(`decideAutoConfirm`의 설계 — "나머지는 그 등록 뒤에 다시 본다"), 다시 보는 것은 `#schedule` → `nextWake`인데 `nextWake`는 자동 확정 시각이 이미 지난(`at <= now`) 카드를 건너뛴다. 맨 앞 카드가 바뀌어 "Enter 등록" 타이머가 생기면 1초 늦게, 맨 앞이 그대로면 아예 다시 보지 않는다.
- 나오는 경우: 한 `onresult`에 최종 결과 둘(같은 밀리초), 기다림을 바꾼 뒤 두 카드의 시각이 같음, **창이 열린 동안 기다림이 지난 카드가 둘 이상인데 창을 닫음**(가장 흔하다), 타이머가 몇 ms 늦게 돌아 두 카드가 함께 익음.
- 결과: 카드가 "1초 뒤 자동 등록"을 보인 채 멈추고, 나중에 아무 타이머(다른 카드의 "Enter 등록" 등)가 돌 때 뒤늦게 자동 등록된다.

### 스펙 확인 필요 (시험 없음)

- 섞어 쓴 끊어 말한 번호: `1 오번`·`일 5번`·`오 오번`·`십이 오번` → 앞 토큰 + X가 R-15로 읽히지 않아(섞기·숫자 하나씩 읽기 실패) 5번 `HIGH`. 규칙 문장대로다.
- 가격의 끊어 말함: `15번 라울 1 5천원` → 5,000원 `HIGH`. R-17 4 금액 조각은 R-16 D-048보다 좁아 앞 토큰 `1`을 보지 않는다. 규칙 문장대로다.
