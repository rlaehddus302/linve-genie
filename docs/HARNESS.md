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
| 테스트 고쳐서 통과 | 스펙·골든·적대 테스트·E2E는 **보호 경로**. 개발자는 `tests/**`를 쓸 수 없고, 커밋 역할 접두어로 기계적으로 검사한다 (`scripts/harness/check-protected.mjs`) |
| 조용한 임의 결정 | 모호하면 개발자는 구현하지 않고 `DISPUTED`. spec-keeper가 스펙 근거로 판정하고 결정을 기록한다 |
| 독립 확인 없음 | 테스터 2명이 깨뜨리고, 감사자 2명이 읽기 전용으로 검증한다. 게이트를 통과하기 전엔 스프린트가 끝나지 않는다 |

## 2. 역할 (11개)

| 역할 | 하는 일 | 쓸 수 있는 곳 | 커밋 접두어 |
|---|---|---|---|
| **오케스트레이터** (메인 세션) | 백로그 관리, 스프린트 실행, 리포트 검토, 범위 조정, 최종 보고 | 전부 | `[orch]` |
| **spec-keeper** 스펙 관리자 | 수용 기준 + 골든 작성, 영역 태그 배정, 자율 결정 기록, 분쟁 판정 | `docs/spec/**`, `docs/DECISIONS.md`, `tests/golden/**`, `acceptance.md` | `[spec]` |
| **dev-core** 코어 개발 | 판정 엔진·파서·정산·골든 러너·저장소 공용 도구 | `packages/core/**`, 루트 설정 | `[dev:core]` |
| **dev-device** 기기·문서 개발 | 라벨 렌더·B1 프린터·PDF·엑셀·음성 | `packages/{label,printer,documents,voice}/**` | `[dev:device]` |
| **dev-server** 서버 개발 | DB·이벤트 저장·API·실시간·인증·유튜브·outbox·백업 | `apps/server/**` | `[dev:server]` |
| **dev-web** 웹 개발 | React PWA 화면·실시간 클라이언트·한국어 UI | `apps/web/**` | `[dev:web]` |
| **test-domain** 도메인 테스터 | 속성 기반·적대 시나리오로 엔진·파서·정산·서버 깨뜨리기 | `tests/adversarial/**` | `[test:domain]` |
| **test-e2e** E2E 테스터 | 수용 기준 E2E, 여러 기기 동시, 휴대폰 폭, 재연결 | `tests/e2e/**` | `[test:e2e]` |
| **spec-auditor** 스펙 검증 감사 | 게이트 판정, 추적성, DOMAIN_RULES·DECISIONS 준수, 스펙 이탈 | 없음 (읽기 전용) | — |
| **risk-auditor** 위험 감사 | 보안·개인정보·외부 정책·동시성·성능·테스트 꼼수 | 없음 (읽기 전용, 테스트 실행 안 함) | — |
| **ux-reviewer** 사용성 감사 | 비전문가 판매자 관점 화면·문구·흐름, 스크린샷 | `harness/sprints/*/ux/**` | `[ux]` |

- 정의 파일: `.claude/agents/<역할>.md`. 공통 규칙: `harness/roles/dev-common.md`, `harness/roles/test-common.md`.
- 개발자 영역 침범(남의 패키지 수정)은 게이트가 막지 않는다. 대신 감사자가 판단한다. 공용 인터페이스는 함께 바뀌어야 할 때가 있기 때문이다.

## 3. 스프린트 루프 (Workflow `sprint`)

```
 backlog (Sxx: devs, tests)
   │
   ▼
 ① Spec    spec-keeper ─ 수용 기준(영역 태그) + 골든 + 자율 결정
   │        └ 사용자만 할 수 있는 일 없이는 진행 불가 → BLOCKED
   ▼
 ② Build   dev-core → dev-device → dev-server → dev-web   (이번 스프린트에 배정된 영역만, 의존 순서)
   │        각자 구현 → verify → 커밋 → handoff(인터페이스·기동 방법)를 다음 사람에게
   ▼
 ③ Test    test-domain → test-e2e (→ ux-reviewer)         버그 = 실패하는 테스트로 고정
   ▼
 ④ Audit   spec-auditor  ‖  risk-auditor                  병렬 (둘 다 읽기 전용, 테스트 실행은 spec-auditor만)
   │        게이트: verify 통과 · 보호 경로 무결 · 금지 패턴 없음
   ▼
 ⑤ Fix ×N  지적 → 담당 개발자 자동 배정 (area 필드 → 파일 경로 → NOT_MINE 재배정)
   │        DISPUTED → spec-keeper 판정 → 재검증 (spec-auditor 항상, 테스터·위험 감사는 열린 지적 있을 때)
   ▼
 ⑥ Report  PASS / FAIL / BLOCKED → harness/sprints/Sxx/report.md, backlog 상태 갱신
```

- 한 스프린트 = 한 Workflow 실행. 에이전트 수: 영역 1개 스프린트 약 6개, 영역 3개 + 테스트 2종이면 약 10개, 수정 라운드마다 추가.
- 개발·테스트는 **순차**로 돈다. 같은 작업 트리에서 커밋하므로 병렬이면 git 충돌이 난다. 감사자 둘은 파일을 쓰지 않으니 병렬로 돈다.
- 수정 라운드 기본 최대 2회. 그래도 blocker/major가 남으면 `FAIL`로 끝내고, 오케스트레이터가 범위를 줄이거나 같은 스프린트를 다시 돌린다.
- 결과물 위치는 `harness/sprints/<Sxx>/`다: `acceptance.md`, `dev-notes.md`, `test-notes-*.md`, `ux/`, `report.md`, `BASE`(시작 커밋).

## 4. 피드백 프로토콜

**지적(finding) 형식** — 테스터·감사자 공통
```json
{ "id": "SA-S02-003", "severity": "blocker|major|minor|nit", "category": "domain|money|spec|test|security|policy|ux|perf",
  "area": "core|device|server|web", "specRef": "ORD-06", "file": "packages/core/src/judge.ts", "line": 120,
  "title": "한 줄 요약", "detail": "무엇이 왜 문제인가", "repro": "재현 방법 또는 실패하는 테스트 경로",
  "suggestedFix": "선택", "confidence": "CONFIRMED|PLAUSIBLE" }
```
- ID 접두어

  | 접두어 | 누가 |
  |---|---|
  | `SA` | spec-auditor |
  | `RA` | risk-auditor |
  | `TD` | test-domain |
  | `TE` | test-e2e |
  | `UX` | ux-reviewer |
  | `GATE` | 게이트 자동 |

  재검토 라운드에선 같은 ID를 유지한다.
- **심각도**
  - blocker: 판정 오류, 금액 오류, 데이터 손실, 보안·개인정보, 게이트 실패
  - major: 스펙 불일치, 수용 기준 누락, 테스트 구멍
  - minor: 품질
  - nit: 취향
- `PLAUSIBLE`(추측)은 major 이상을 줄 수 없다.

**개발자 응답**

| 응답 | 담을 내용 |
|---|---|
| `FIXED` | 무엇을 어떻게 고쳤고 무엇으로 확인했는지 |
| `DISPUTED` | 스펙 인용 |
| `NOT_MINE` | 원인 영역(`reassignTo`) — 다음 라운드에 그 개발자에게 재배정 |
| `DEFERRED` | minor·nit만 |

**분쟁 판정** (spec-keeper)
- `UPHOLD`: 지적 유지
- `DISMISS`: 지적 기각
- `NEEDS_DECISION`: 사용자만 정할 수 있을 때만. 스펙이 침묵하면 spec-keeper가 판매자에게 안전한 쪽으로 정하고 기록한다.

## 5. 게이트 (기계적 판정, spec-auditor가 실행)

| 게이트 | 명령 | 통과 조건 |
|---|---|---|
| 검증 | `pnpm verify` | 타입체크·린트·단위·골든·적대·E2E(해당 시) 전부 통과, `packages/core` 커버리지 95% 이상 |
| 보호 경로 | `node scripts/harness/check-protected.mjs $(cat harness/sprints/<S>/BASE)` | 역할별 커밋이 자기 영역만 건드림, 금지 패턴(`.only`, `.skip`, `todo` 등) 없음, 커밋 안 된 변경 없음 |

## 6. 진행 방식: 자율 모드

사용자는 **묻지 말고 끝까지 진행, 완성되면 보고**를 원한다.
- spec-keeper와 오케스트레이터가 판매자에게 가장 안전한 쪽으로 스스로 결정하고 `DECISIONS.md`에 `AUTO`로 기록한다.
- 사람만 할 수 있는 확인(HG-1~4: 실제 B1 출력, 실제 유튜브 방송, 실제 목소리, 리허설 사용성)과 외부 계정·비용·법률은 모의 구현으로 대신하고, 최종 보고의 "사용자 확인 필요" 목록에 모은다.
- 사용자 입력 없이는 정말 진행할 수 없을 때만 멈춘다.

## 7. 실행 방법

오케스트레이터가 `harness/backlog.yaml`을 읽어 Workflow `sprint`를 실행한다.
```json
{ "sprintId": "S05", "devs": ["server", "web"], "tests": ["domain", "e2e"], "uxReview": true }
```

| 옵션 | 뜻 | 기본 |
|---|---|---|
| `maxFixRounds` | 수정 라운드 상한 | 2 |
| `uxReview` | ux-reviewer 포함 | false (백로그 값을 넘긴다) |
| `useAgentTypes` | `.claude/agents`를 서브에이전트 타입으로 등록해 쓰기. 끄면 프롬프트로 역할 주입 | false |
