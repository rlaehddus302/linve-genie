# 개발 하네스 설계

> 스펙 기반으로 여러 에이전트가 서로 견제하며 "끝까지" 만들어 가는 구조.
> 핵심 생각: **판정과 돈은 테스트가 정답을 정하고, 구현자는 그 정답을 바꿀 수 없다.**

## 1. 왜 이렇게 나누나

바이브코딩이 망가지는 전형적인 경로는 세 가지다.

1. 구현자가 테스트를 자기 구현에 맞춰 고친다.
2. 스펙이 모호한 곳을 구현자가 조용히 마음대로 정한다.
3. "됐다"는 보고를 아무도 독립적으로 확인하지 않는다.

이 하네스는 역할과 권한을 나눠서 셋을 구조적으로 막는다.

| 막을 것 | 장치 |
|---|---|
| 테스트 고쳐서 통과 | 골든 시나리오·스펙은 **보호 경로**. spec-keeper만 쓸 수 있고, 커밋 역할 접두어로 기계적으로 검사 (`scripts/harness/check-protected.mjs`) |
| 조용한 임의 결정 | 모호하면 developer는 구현하지 않고 `DISPUTED`. spec-keeper가 판정하고, 스펙이 침묵하면 `DECISIONS.md`에 올려 사람에게 |
| 독립 확인 없음 | auditor(읽기 전용)와 qa-breaker(깨뜨리기)가 서로 따로 검증. 게이트 통과 전엔 스프린트 종료 불가 |

## 2. 역할

| 역할 | 하는 일 | 쓸 수 있는 곳 | 못 하는 것 |
|---|---|---|---|
| **오케스트레이터** (메인 세션 Claude + 사용자) | 백로그 관리, 스프린트 시작, 결과 검토, 결정 사항을 사용자에게 묻기, 사람 확인 지점 진행 | 전부 (`[orch]` 커밋) | — |
| **spec-keeper** 스펙 관리자 | 스프린트 범위 → 수용 기준 + 골든 시나리오. 모호함 → 결정 항목. 분쟁 판정 | `docs/spec/**`, `docs/DECISIONS.md`, `tests/golden/**`, `harness/sprints/*/acceptance.md` | 제품 코드 |
| **developer** 개발자 | 수용 기준·골든 통과하도록 구현, 지적에 항목별 응답 | 제품 코드, 단위 테스트, `harness/sprints/*/dev-notes.md` | 스펙·골든·적대 테스트·하네스 |
| **auditor** 감사자 | 게이트 판정 + 스펙 추적성·불변식·보안·정책·테스트 품질 감사 | 없음 (읽기 전용) | 파일 수정 |
| **qa-breaker** 파괴 테스터 | 엣지 케이스·속성 기반·E2E로 깨뜨리기, 버그는 실패하는 테스트로 남김 | `tests/adversarial/**`, `harness/sprints/*/qa-notes.md` | 제품 코드, 골든 |
| **ux-reviewer** 사용성 감사자 (단계 끝) | 비전문가 판매자 관점 화면·문구·흐름 점검, 스크린샷 | `harness/sprints/*/ux/**` | 제품 코드 |

에이전트 정의는 `.claude/agents/<역할>.md`.

## 3. 스프린트 루프 (Workflow `sprint`)

```
            ┌─────────────────────────────────────────────────────────────┐
 backlog ──▶│ ① Spec     spec-keeper: 수용 기준 + 골든 (+ 결정 항목)        │
 (Sxx)      │              └─ blocking 결정 있음 → BLOCKED, 사용자에게      │
            │ ② Build    developer: 구현 → pnpm verify → [dev] 커밋        │
            │ ③ Review   qa-breaker → (ux-reviewer) → auditor  순차 검증    │
            │              qa의 실패 테스트까지 포함해 auditor가 게이트 판정  │
            │              게이트: verify 통과 · 보호 경로 무결 · 금지 패턴 없음│
            │ ④ Fix ×N   developer: 지적별 FIXED / DISPUTED / DEFERRED      │
            │              DISPUTED → spec-keeper 판정 (UPHOLD/DISMISS/결정) │
            │              → 재검토 (auditor 항상, qa는 열린 지적 있을 때)    │
            │ ⑤ Report   PASS / FAIL / BLOCKED + 남은 지적 + 다음 제안      │
            └─────────────────────────────────────────────────────────────┘
                      │
                      ▼
 오케스트레이터가 리포트 검토 → 사용자 결정 필요하면 묻기 → 다음 스프린트
```

- 한 스프린트 = 한 Workflow 실행. 에이전트 약 6~10개.
- 검토는 **순차**로 돈다. 세 검토자가 같은 작업 트리에서 커밋하므로, 병렬이면 git 잠금 충돌과 "커밋 안 된 변경" 오탐이 생긴다. 서로의 결론을 보지 않는다는 의미의 독립성은 유지된다. 단 auditor는 qa가 추가한 테스트 목록만 받는다.
- 수정 라운드 기본 최대 2회. 그래도 blocker/major가 남으면 `FAIL`로 끝내고 오케스트레이터가 판단한다(범위 축소, 스펙 수정, 재시도).
- 모든 결과물은 `harness/sprints/<Sxx>/`에 남는다: `acceptance.md`, `dev-notes.md`, `qa-notes.md`, `report.md`, `BASE`(시작 커밋).

## 4. 피드백 프로토콜

**지적(finding) 형식** — auditor·qa-breaker·ux-reviewer 공통
```json
{ "id": "A-S02-003", "severity": "blocker|major|minor|nit", "category": "domain|money|spec|test|security|policy|ux|perf",
  "specRef": "ORD-06", "file": "packages/core/src/judge.ts", "line": 120,
  "title": "한 줄 요약", "detail": "무엇이 왜 문제인가", "repro": "재현 방법 또는 실패하는 테스트 경로",
  "suggestedFix": "선택", "confidence": "CONFIRMED|PLAUSIBLE" }
```
- ID 접두어: `A`=auditor, `Q`=qa-breaker, `U`=ux-reviewer. 재검토 라운드에선 같은 ID를 유지한다.
- **심각도 기준**
  - blocker: 판정 오류, 금액 오류, 데이터 손실, 보안·개인정보, 게이트 실패.
  - major: 스펙 불일치, 수용 기준 누락, 테스트 구멍.
  - minor: 품질·가독성.
  - nit: 취향.
- `PLAUSIBLE`(추측)은 major 이상을 줄 수 없다. 재현하거나 근거 줄을 대야 `CONFIRMED`다.

**developer 응답**
- `FIXED`: 어떻게 고쳤는지, 어떤 테스트로 확인했는지.
- `DISPUTED`: 스펙 문장을 인용해 왜 지적이 틀렸는지. 근거 없는 반박은 무효.
- `DEFERRED`: minor·nit만 가능. 백로그로 넘어간다.

**분쟁 판정** (spec-keeper)
- `UPHOLD`: 지적이 맞으므로 다음 라운드에 다시 고친다.
- `DISMISS`: 지적이 틀렸으므로 닫는다.
- `NEEDS_DECISION`: 스펙이 침묵하므로 `DECISIONS.md`에 올리고 스프린트 결과는 `BLOCKED`.

## 5. 게이트 (기계적 판정)

auditor가 매 라운드 실행하고 결과를 그대로 보고한다.

| 게이트 | 명령 | 통과 조건 |
|---|---|---|
| 검증 | `pnpm verify` | 타입체크·린트·단위·골든·속성·적대 테스트 전부 통과 (E2E는 UI 스프린트부터 포함) |
| 보호 경로 | `node scripts/harness/check-protected.mjs $(cat harness/sprints/<S>/BASE)` | 역할별 커밋이 자기 영역만 건드림, 금지 패턴(`.only`, `.skip`, `it.todo` 등) 없음, 커밋 안 된 변경 없음 |
| 커버리지 | `pnpm verify` 안에서 | `packages/core` 라인·분기 커버리지 95% 이상 |

`pnpm verify`는 S00(부트스트랩)에서 만든다. 그 전까지 auditor는 보호 경로 게이트만 본다.

## 6. 사람이 개입하는 지점

| 언제 | 무엇을 |
|---|---|
| 스프린트 `BLOCKED` | 결정 항목에 답하기 (오케스트레이터가 선택지와 추천을 정리해서 묻는다) |
| 사람 확인 지점 HG-1~4 (SPEC §9) | 실제 B1 출력, 실제 유튜브 방송, 실제 목소리, 리허설 사용성 |
| 단계(Phase) 종료 | ux-reviewer 리포트 + 데모를 보고 다음 단계 진행 여부 |
| 외부 계정·비용 | 구글 클라우드 프로젝트, 도메인, 호스팅, 유료 API 키 — 사용자만 만들 수 있다 |

## 7. 실행 방법

- **한 스프린트**: 오케스트레이터에게 "S03 돌려줘" → Workflow `sprint`를 `{ sprintId: "S03" }`으로 실행한다.
- **연속 실행**: "다음 사람 확인 지점까지 계속" → 오케스트레이터가 백로그 순서대로 스프린트를 이어 돌린다. 매 스프린트 리포트를 확인하고 `BLOCKED`·`FAIL`·HG에서 멈춘다.
- **옵션** (`args`)

  | 키 | 뜻 | 기본 |
  |---|---|---|
  | `maxFixRounds` | 수정 라운드 상한 | 2 |
  | `uxReview` | 이번 스프린트에 ux-reviewer 포함 | 백로그의 `uxReview` 값 |
  | `useAgentTypes` | `.claude/agents` 정의를 서브에이전트 타입으로 사용. 끄면 프롬프트로 역할 주입 | true |

## 8. 비용·속도 감각

- 스프린트 1회 ≈ 에이전트 6~10회 호출. 엔진처럼 순수 로직 스프린트는 빠르고, UI·외부 연동 스프린트는 E2E 때문에 느리다.
- 비용을 줄이는 순서:
  1. `maxFixRounds`를 1로 낮춘다.
  2. qa-breaker를 단계 끝에만 돌린다.
  3. auditor 노력(effort)을 낮춘다.
  
  판정·금액 스프린트(S01~S03)에서는 줄이지 않는 걸 권한다.
