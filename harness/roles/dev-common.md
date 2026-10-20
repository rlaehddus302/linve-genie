# 개발자 공통 규칙 (dev-core · dev-server · dev-web · dev-device)

## 수정 금지 (보호 경로 게이트가 커밋을 검사한다)
- `docs/spec/**`, `docs/DECISIONS.md`: spec-keeper 소유
- `tests/**` (골든·적대·E2E 전부): spec-keeper·테스터 소유
- `.claude/**`, `scripts/harness/**`, `harness/**`, `CLAUDE.md`
- **검증 게이트**: `scripts/verify/**`, `vitest.adversarial.config.ts`. S00 이후 오케스트레이터 소유다. 바꿔야 하면 `dev-notes.md`에 요청을 남긴다(D-027).
- 예외: `harness/sprints/<Sxx>/dev-notes.md`는 써도 된다

## 내 영역과 남의 영역
- 각자 맡은 디렉터리가 있다(역할 파일 참고). 남의 영역을 고쳐야 하면 최소한으로 하고 dev-notes에 "누구 영역, 왜"를 남긴다.
- 루트 공용 파일(`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint` 설정, `vitest.workspace.ts`, `pnpm-lock.yaml`)은 누구나 고칠 수 있다. 단 다른 패키지를 깨뜨리면 안 된다.
- 앞서 실행된 개발자의 결과 요약이 프롬프트에 들어온다. 그 인터페이스를 존중하고, 바꿔야 하면 사용처까지 같이 고친다.

## 구현 원칙
- 시작 전에 읽는다
  - `harness/sprints/<Sxx>/acceptance.md`
  - 관련 골든
  - `docs/TECH_REVIEW.md` §5~6
- **판정 엔진 `packages/core`는 순수**하다. `Date.now`, 인자 없는 `new Date()`, `Math.random`, 파일·네트워크·DB 접근 금지.
- **금액은 정수 원**이다. 표시용 포맷은 별도 함수로 둔다.
- 외부 서비스(유튜브, 프린터, STT, 저장소)는 인터페이스(어댑터) 뒤에 둔다. 테스트에선 가짜 구현을 쓴다. 실제 계정·기기가 없어도 모든 테스트가 돌아야 한다.
- 채팅 텍스트·닉네임은 신뢰할 수 없는 입력이다. 화면에선 항상 이스케이프한다.
- 비밀값은 `.env`(커밋 금지)에 두고 `.env.example`로 키 목록만 남긴다. 전화번호·토큰은 로그에 남기지 않는다.
- 화면 문구는 쉬운 한국어로 쓴다. 개발 용어·영어 상태값을 노출하지 않는다.
- 의존성은 꼭 필요한 것만, 버전을 고정해서 추가한다.

## 스펙과 다르게 해야 할 것 같을 때
조용히 다르게 만들지 않는다.
1. 구현하지 않는다.
2. `dev-notes.md`에 이유를 쓴다.
3. 결과의 `disputesWithSpec`으로 알린다.

## 테스트
- 단위 테스트는 자기 패키지 안에 둔다(`*.test.ts`).
- **걸린 시간을 재는 시험(p99·몇 ms 이내·크기 배수 대비 시간)은 `*.perf.test.ts`에 따로 둔다(D-902).** `pnpm verify`는 이 파일을 돌리지 않고, `pnpm perf`가 돌린다. 정확성 단언과 한 시험에 섞지 않는다.
- 금지
  - `.only` / `.skip` / `todo`
  - 기대값을 구현에 맞춰 바꾸기
  - 실패하는 테스트 지우기
- 끝내기 전에 `pnpm verify`를 실행하고 결과를 그대로 보고한다.
  - 아직 다른 개발자가 할 몫 때문에 실패하는 항목은 "남의 몫"으로 구분해 보고한다.
  - 내 몫의 실패는 숨기지 않는다.

## 커밋
작게 나눠서 `[dev:<영역>] <Sxx>: <요약>`으로 커밋한다(예: `[dev:core] S02: 보류 찜 판정`). 작업을 끝낼 때 커밋 안 된 변경이 없어야 한다.

## 지적에 응답할 때 (수정 라운드)
나에게 배정된 blocker/major마다 하나씩 응답한다.

| 응답 | 쓰는 경우 | 담을 내용 |
|---|---|---|
| `FIXED` | 고쳤을 때 | 무엇을 어떻게 고쳤는지, 어떤 테스트로 확인했는지 |
| `DISPUTED` | 지적이 틀렸다고 볼 때 | SPEC/DOMAIN_RULES 문장을 인용한 반박. 근거 없는 반박은 무효 |
| `NOT_MINE` | 원인이 다른 영역일 때 | 어느 영역·파일이 원인인지 |
| `DEFERRED` | minor/nit일 때만 | 미룬 이유 |
