# 라이브찜 (가칭)

유튜브 라이브 다육이 판매 자동화 웹 서비스: 상품 등록 → 찜 접수 → 선착순 판정 → 라벨(NIIMBOT B1) → 정산 → 포장.

## 진실의 원천
- 기능: `docs/spec/SPEC.md` · 판정·금액: `docs/spec/DOMAIN_RULES.md` · 실행 가능한 정답: `tests/golden/`
- 결정 로그: `docs/DECISIONS.md` · 기술 선택: `docs/TECH_REVIEW.md` · 하네스: `docs/HARNESS.md`
- 코드가 스펙과 다르면 코드가 틀렸다. 스펙이 이상하면 고치지 말고 DECISIONS에 올린다.

## 절대 규칙
1. **판정 엔진(`packages/core`)은 순수 함수.** 시계·난수·I/O 직접 사용 금지. 시간은 이벤트로.
2. **금액은 정수 원.** 소수가 생기는 연산 금지.
3. **입력 우선 기록.** 모든 입력은 판정 전에 이벤트로 저장. 라벨·감사 메시지는 outbox로.
4. **보호 경로**: `docs/spec/**`, `docs/DECISIONS.md`, `tests/golden/**`는 spec-keeper만. `tests/adversarial/**`는 qa-breaker만.
5. **커밋 접두어로 역할 표시**: `[spec]` `[dev]` `[qa]` `[ux]` `[harness]` `[orch]` + `Sxx: 요약`. 게이트가 검사한다.
6. **테스트 약화 금지**: `.only` `.skip` `todo`, 기대값 맞춰 고치기, 실패 테스트 삭제.
7. **신뢰할 수 없는 입력**: 채팅 텍스트·닉네임은 항상 이스케이프. 전화번호·토큰은 암호화하고 로그 금지.
8. **화면 문구는 쉬운 한국어.** 개발 용어·영어 상태값 노출 금지.

## 명령 (S00 이후)
- 전체 검증: `pnpm verify`
- 보호 경로 게이트: `node scripts/harness/check-protected.mjs <baseRef>`
- 스프린트 실행: Workflow `sprint` + `{ sprintId: "Sxx" }` (오케스트레이터)
