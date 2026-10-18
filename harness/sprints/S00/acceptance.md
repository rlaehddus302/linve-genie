# S00 수용 기준 — 부트스트랩: 저장소 골격과 검증 파이프라인

- 스프린트: S00 (1단계) · spec ID: **NFR-02** · 근거 결정: D-002, D-020~D-026
- 개발 영역: **core → server → web** · 테스트: **domain** · 사람 확인 지점 없음
- 목표(백로그): pnpm 모노레포, TypeScript strict, ESLint, Vitest, fast-check, 골든 러너 골격, `pnpm verify`, 서버 헬스체크, 웹 빈 화면.
- 공통 전제: 깨끗한 체크아웃, Node 24.x, pnpm 12.14.0. 설치 뒤에는 네트워크 없이 모든 검사가 돈다. 실제 외부 계정·기기는 필요 없다.
- "임시 주입"은 확인하는 사람이 작업 트리에서 잠깐 바꿔 보고 되돌리는 것이다. 커밋하지 않는다.
- 골든 형식의 정답은 `tests/golden/README.md`(형식 계약)다. 이 문서는 그 계약을 러너가 지키는지 확인하는 기준이다.

## 이번 스프린트의 스펙·골든 변경 (spec-keeper)

| 파일 | 변경 |
|---|---|
| `tests/golden/README.md` | 형식 계약 추가: 읽는 범위, 결과 상태, 시각 형식, 이벤트 종류·필드, 설정 키, `expect` 비교 규칙, 열거값. 기존 규칙은 그대로 |
| `tests/golden/known-unimplemented.yaml` | 새 예약 파일: 알려진 미구현 허용 목록 (S00 = 파서 4개 suite + `G-ENG-*`) |
| `tests/golden/engine/08-time.yaml` | 새 시나리오 G-ENG-070~073: 자정을 넘긴 방송, 문자 수신 시각의 날짜, 날짜가 다른 방송의 정산 |
| `docs/spec/DOMAIN_RULES.md` | R-6 "문자 수신 시각의 날짜"(D-023), R-12 정산 날짜 = 방송 날짜(D-022) |
| `docs/spec/SPEC.md` | NFR-02에 "실행 환경의 시간대·언어 설정과 무관" 명시 |
| `docs/DECISIONS.md` | `AUTO` 상태 정의, D-020~D-026, D-002 → AUTO, "사용자 확인 필요" 표 |

---

## A. 저장소 골격

### AC-S00-01 [core] 워크스페이스 설치
- 근거: D-025, 백로그 S00
- Given 깨끗한 체크아웃
- When `pnpm install --frozen-lockfile`
- Then 종료 코드 0. `pnpm-lock.yaml`이 커밋되어 있다. 워크스페이스 패키지는 정확히 넷이다: `@livejjim/core`(`packages/core`), `@livejjim/label`(`packages/label`), `@livejjim/server`(`apps/server`), `@livejjim/web`(`apps/web`). 루트 `package.json`에 `"packageManager": "pnpm@12.14.0"`과 `engines.node`(24 이상)가 있다.
- `packages/label`은 빈 패키지다: 설정과 빈 진입점만, 런타임 의존성·렌더링 코드 없음.
- 확인: 명령 실행 + `package.json` 검사

### AC-S00-02 [core] [server] [web] 의존성 버전 고정
- 근거: D-025, dev-common "버전을 고정해서 추가"
- Given 모든 `package.json`
- Then `dependencies`·`devDependencies`의 버전이 정확한 버전이다. `^`·`~`·`*`·`latest`·범위 표기가 없다. 워크스페이스 내부 참조만 `workspace:*`를 쓴다. 쓰지 않는 의존성이 없다.
- 확인: `package.json` 검사

### AC-S00-03 [core] TypeScript strict
- 근거: D-025
- Given 루트 `tsconfig.base.json`
- Then `strict: true`, `noUncheckedIndexedAccess: true`. 모든 패키지 설정이 이를 상속하고 끄지 않는다. 타입 검사 범위: `packages/*`(src·test), `apps/*`, `tests/adversarial/**`.
- When 범위 안 어느 파일에든 타입 오류를 넣으면
- Then typecheck 단계가 실패한다.
- 확인: 설정 검사 + 임시 주입

### AC-S00-04 [core] 린트 (경고 0)
- Given ESLint flat config, 범위는 AC-S00-03과 같음
- When 범위 안에 린트 경고 하나 또는 오류 하나를 넣으면
- Then lint 단계가 실패한다(`--max-warnings 0`).
- 확인: 설정 검사 + 임시 주입

### AC-S00-05 [core] 코어 순수성 린트
- 근거: D-024, NFR-02, CLAUDE.md 절대 규칙 1
- Given `packages/core/src` 아래 파일
- When 다음 중 하나라도 쓰면
  - `Date` (모든 형태: `Date.now()`, `new Date(...)`, `Date.UTC(...)`, `Date()`)
  - `Math.random`, `performance`, `crypto`, `process`, `console`
  - `setTimeout`·`setInterval`·`setImmediate`·`queueMicrotask`
  - `Intl`, `toLocaleString`·`toLocaleDateString`·`toLocaleTimeString`, `localeCompare`
  - Node 내장 모듈 import (`fs`·`node:fs`처럼 `node:` 접두어 유무와 상관없이)
- Then lint 단계가 실패하고, 메시지에 "코어는 순수 함수"라는 이유가 나온다.
- 이 규칙은 `packages/core/test`(골든 러너 포함)와 다른 패키지에는 적용하지 않는다.
- 확인: 임시 주입, test-domain 회귀 테스트(F절)

### AC-S00-06 [web] 화면 XSS 린트
- 근거: NFR-06, CLAUDE.md 절대 규칙 7
- When `apps/web`에서 `dangerouslySetInnerHTML`을 쓰면
- Then lint 단계가 실패한다.
- 확인: 임시 주입

### AC-S00-07 [server] 비밀값 파일
- 근거: DAT-06, dev-common
- Then `.env.example`이 있고 S00에서 쓰는 키(`PORT`)만 실제 비밀 없이 적혀 있다. `.env`·`.env.*`(`.env.example` 제외)는 git이 무시한다.
- 확인: 파일 검사, `git check-ignore .env`

---

## B. 검증 파이프라인

### AC-S00-10 [core] `pnpm verify` 한 번으로 전체 검사
- 근거: 백로그 수용 힌트 1, HARNESS §5, NFR-02
- Given 설치 완료
- When `pnpm verify`
- Then 다음 순서로 실행한다: **typecheck → lint → test → golden → adversarial → coverage**.
- Then 끝에 단계별 요약표를 보여 준다.
  - 단계 이름과 결과(`통과`/`실패`/`건너뜀`)
  - test·adversarial: 실행한 테스트 파일 수와 테스트 수
  - golden: README "결과 상태"의 합계
  - coverage: 라인·분기 수치
  - 사용한 시간대(D-026)
- Then 모든 단계가 통과할 때만 종료 코드 0.
- 각 단계는 루트 스크립트로 따로 돌릴 수 있다: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm golden`, `pnpm adversarial`, `pnpm coverage`.
- CI용 단일 명령은 `pnpm install --frozen-lockfile && pnpm verify`다.
- verify 스크립트는 `scripts/harness/` 밖에 둔다(보호 경로라 개발자 커밋이 게이트에 걸린다).
- 확인: 명령 실행과 출력 (spec-auditor 게이트)

### AC-S00-11 [core] 실패는 반드시 드러난다
- When 다음 중 하나를 임시로 넣으면
  - (a) 어느 패키지든 단위 테스트 실패
  - (b) `tests/adversarial` 테스트 실패
  - (c) 골든 불일치·읽기 오류·미구현(불허)
  - (d) 커버리지 미달
  - (e) 타입 오류 또는 린트 오류
- Then 해당 단계가 `실패`로 표시되고 verify 종료 코드가 0이 아니다. 앞 단계 실패로 뒤 단계를 돌리지 않았다면 `건너뜀`으로 표시한다(`통과`로 표시 금지).
- 확인: 임시 주입 (spec-auditor·test-domain)

### AC-S00-12 [core] 단계 분리
- Then 각 단계는 자기 대상만 돈다.

  | 단계 | 대상 |
  |---|---|
  | test | `packages/*`·`apps/*` 안의 단위 테스트(골든 러너 자체 테스트 포함). `tests/**`는 돌리지 않는다 |
  | golden | 골든 러너가 `tests/golden`만 |
  | adversarial | `tests/adversarial/**/*.test.ts`만. 파일이 0개면 통과하되 요약에 "적대 테스트 0개"를 보여 준다 |

- 확인: 출력의 파일 목록·개수

### AC-S00-13 [core] 코어 커버리지 95%
- 근거: HARNESS §5, dev-core
- Then coverage 단계는 `packages/core/src`의 라인 95% 이상, 분기 95% 이상을 요구하고 미달이면 실패한다.
- 측정 대상은 `packages/core/src`의 모든 소스 파일이다. 테스트가 import하지 않은 파일도 0%로 포함한다. 제외는 타입 선언만 있는 파일뿐이다.
- 확인: 설정 검사 + 임시 주입(테스트 없는 분기 추가)

### AC-S00-14 [core] 테스트 시간대 고정
- 근거: D-026, NFR-02, NFR-07
- Then test·golden·adversarial·coverage 단계는 개발 PC 시간대와 상관없이 `TZ=Pacific/Honolulu`로 돌고, 요약에 그 값을 보여 준다.
- 확인: 스크립트 검사 + 출력

### AC-S00-15 [core] 적대 테스트 기반 (test-domain 인계)
- Given `tests/adversarial/` 아래 새 `*.test.ts`
- Then 이 파일은 다음을 import할 수 있다: `@livejjim/core`, 골든 러너 프로그램 API(정해진 import 경로 하나, handoff에 기록), `fast-check`, `vitest`.
- Then 이 파일은 typecheck·lint·adversarial 단계에 포함된다. `fast-check`는 정확한 버전의 devDependency다.
- 개발자는 `tests/adversarial`에 파일을 만들지 않는다(보호 경로).
- 확인: test-domain이 실제 테스트를 추가해 돌린다

---

## C. 골든 러너 (`packages/core/test/golden/**`)

### AC-S00-20 [core] 골든 전부 읽기
- 근거: 백로그 수용 힌트 2, D-021, README "러너가 읽는 범위"
- Given S00 스펙 커밋의 `tests/golden`: YAML 11개(파서 3개 + 엔진 8개), 예약 파일 제외
- When `pnpm golden`
- Then 모든 파일을 읽어 파서 suite 문서 9개(사례 103개)와 엔진 시나리오 42개를 읽기 오류 0개로 불러온다.
- 파일 탐색은 하위 폴더를 포함한 모든 `*.yaml`·`*.yml`이다. 예약 파일 `known-unimplemented.yaml`만 빼고, 경로 순서로 처리한다.
- 확인: 출력 합계 (spec-auditor)

### AC-S00-21 [core] YAML 1.2 core schema
- 근거: D-021
- Given `no:` 키, `OFF`·`yes`·`on` 값, `date: 2026-10-18`이 든 문서
- Then `no`는 문자열 키, `OFF`·`yes`·`on`은 문자열, `2026-10-18`은 문자열이다(날짜 객체로 바뀌거나 시간대 때문에 하루 밀리지 않음).
- 확인: 러너 자체 테스트

### AC-S00-22 [core] 형식 계약 위반 = 읽기 오류
- 근거: D-021, README 형식 계약
- Given 다음 범주의 입력
  1. `suite`도 `id`도 없는 문서, 모르는 suite 이름
  2. 사례에 `in`·`out` 외의 키, suite별 `out` 형식 위반
  3. 시나리오 필수 키 없음, ID 형식 오류·중복
  4. 모르는 이벤트 종류
  5. 이벤트 필수 필드 없음, 모르는 필드, 값 형식 오류
  6. 선언하지 않은 방송
  7. `at`·`publishedAt`·`received`·`date` 형식 오류, 오프셋 없는 ISO
  8. `at` 역행
  9. 날짜가 섞인 시나리오에서 방송 없는 이벤트의 짧은 `at`
  10. sms `ref` 중복
  11. 모르는 설정 키나 값
  12. 모르는 `expect` 키(최상위·하위, 중간 검사 포함)
  13. 열거값 오류
  14. 상품 키·정산 키 형식 오류
  15. YAML 문법 오류
- When 러너가 읽으면
- Then 허용 목록과 상관없이 읽기 오류로 실패한다. 메시지에 파일, 위치(문서 번호·시나리오 ID·`events[n]`), 이유가 나온다.
- 한 파일의 오류가 다른 파일 결과를 가리지 않는다. 나머지 파일은 계속 처리한다.
- 확인: 러너 자체 테스트. 범주마다 픽스처 하나 이상. 픽스처는 `tests/golden` 밖(예: `packages/core/test/golden/fixtures/`)에 둔다

### AC-S00-23 [core] 결과 상태와 허용 목록
- 근거: D-020, README "결과 상태"
- Then 통과 / 불일치 / 미구현 / 읽기 오류 / 결정성 위반 / 러너 오류를 구분한다.
- "미구현"은 코어가 정한 한 가지 방법으로만 판단한다(handoff에 기록). 그 밖의 예외는 러너 오류다.
- 허용 목록은 다음과 같이 동작한다.

  | 경우 | 결과 |
  |---|---|
  | 목록에 있는 항목이 미구현 | `미구현(허용)`, 실패 아님 |
  | 목록에 없는 항목이 미구현 | 실패 |
  | 목록에 있어도 불일치·읽기 오류·결정성 위반·러너 오류 | 실패 |
  | 목록에 있는데 통과 | 경고("허용 목록에서 빼도 됨"), 실패 아님 |
  | 맞는 시나리오가 없는 패턴, 모르는 suite 이름, 목록 파일 형식 오류 | 읽기 오류 |
  | 목록 파일 없음 | 빈 목록(모든 미구현이 실패) |

- verify가 부르는 golden 단계는 항상 `tests/golden`과 `tests/golden/known-unimplemented.yaml`만 쓴다. 이를 바꾸는 환경변수·명령행 옵션은 없다. 다른 폴더·목록은 프로그램 API(테스트용)로만 넘긴다.
- 확인: 러너 자체 테스트(가짜 코어로 표의 각 경우) + 코드 검사(우회 옵션 없음)

### AC-S00-24 [core] S00 시점의 golden 결과
- Given S00 스펙 커밋의 골든과 허용 목록(파서 4개 suite + `G-ENG-*`), 코어는 아직 미구현
- When `pnpm golden`
- Then golden 단계가 통과한다. 합계:
  - 미구현(허용): 파서 사례 103개 + 엔진 시나리오 42개
  - 불일치·읽기 오류·결정성 위반·러너 오류·미구현(불허): 0
  - 미구현을 `통과`로 세지 않는다
- When 허용 목록에서 suite 하나(예: `chat`)를 임시로 지우면
- Then golden 단계가 실패하고 chat 사례 수만큼 미구현(불허)이 나온다.
- 확인: 출력 (spec-auditor) + 임시 주입

### AC-S00-25 [core] 비교 규칙 — 러너는 틀린 기대에서 실제로 실패한다
- 근거: README "파서 사례 형식"·"`expect` 비교 규칙", dev-core "항상 통과하는 러너가 가장 위험하다"
- Given 가짜 코어(테스트 대역)
- Then 비교 규칙 표의 **키마다** 두 가지를 확인한다: 맞는 기대는 통과, 기대를 하나 바꾸면 불일치.
- 최소한 다음 경우를 포함한다.
  - chat: 없는 키는 빈 배열로 본다. 배열 순서가 다르면 불일치
  - quick-input: `out`에 없는 키가 실제 결과에 있으면 불일치
  - amount·korean-number: `null`과 숫자를 구분한다
  - `waitlist` 순서가 다르면 불일치. `winners`·`items`·`cancelRequests`는 순서가 달라도 통과
  - `effects`: 같은 항목을 두 번 적으면 실제 효과도 두 개 있어야 한다
  - `effectCounts`: `0`을 적었는데 하나라도 있으면 불일치
  - `pendingEffects`: 실제에 하나라도 더 있으면 불일치
  - `claims`: 같은 (상품, 구매자)의 찜이 여럿이면 가장 최근 찜으로 판단
  - 구매자 키 풀기: 합친 구매자, `sameBuyer`
  - 품목 없는 정산 묶음은 금액 전부 0, `UNPAID`
  - 중간 검사만 틀려도 시나리오 실패
  - 적지 않은 상품·구매자는 검사하지 않는다
- 확인: 러너 자체 테스트 목록 (spec-auditor가 키별로 대조)

### AC-S00-26 [core] 이벤트 변환
- 근거: README "시각", D-022, D-026, NFR-07
- Then `seq`는 `assert`를 뺀 1부터의 순번이다. 재수신 사본도 자기 `seq`를 받는다.
- Then `at`을 UTC로 바꾼다.

  | 입력 (2026-10-18 방송) | 결과 |
  |---|---|
  | `"20:00:00"` | `2026-10-18T11:00:00.000Z` |
  | `"20:00:02.1"` | `2026-10-18T11:00:02.100Z` |
  | `"2026-10-19T00:00:10+09:00"` | `2026-10-18T15:00:10.000Z` |

- Then chat의 `publishedAt`이 없으면 `at`과 같다.
- Then `received`는 형식만 검사하고 원문(분·초 정밀도 포함)을 그대로 넘긴다. 날짜 해석(D-023)은 S03 코어 함수가 맡는다.
- 변환 결과는 프로세스 시간대와 무관하다(verify가 `Pacific/Honolulu`로 돌 때도 위 값).
- 확인: 러너 자체 테스트(고정 값)

### AC-S00-27 [core] 결정성 검사
- 근거: NFR-02
- Then 엔진 시나리오마다 새 상태에서 두 번 실행해, 각 이벤트 뒤의 상태·효과를 직렬화해 비교한다. 다르면 결정성 위반(항상 실패)이고, 처음 달라진 `events[n]`을 보여 준다.
- Then 러너 출력도 결정적이다. 같은 입력으로 두 번 돌린 golden 출력은 소요 시간 표시를 빼면 글자 하나까지 같다.
- 확인: 러너 자체 테스트(호출마다 달라지는 숨은 상태를 가진 가짜 엔진을 결정성 위반으로 잡는지) + 두 번 실행 비교

### AC-S00-28 [core] 실패 보고
- Then 불일치마다 다음을 보여 준다: 파일, 시나리오 ID(또는 suite·사례 번호·입력), 중간 검사면 `events[n]`, `expect` 경로(예: `products.b1/15.winner`), 기대값, 실제값.
- Then 끝에 README "결과 상태"의 합계를 보여 준다.
- 확인: 러너 자체 테스트(메시지 내용 검사)

---

## D. 서버 (`apps/server`)

### AC-S00-40 [server] 헬스체크
- 근거: 백로그 S00, D-025
- Given DB·외부 서비스·비밀값이 없는 상태
- When `GET /health`
- Then 상태 200, `Content-Type: application/json`, 본문은 정확히 `{"status":"ok"}`.
- 확인: 서버 단위 테스트(포트를 열지 않는 프로세스 안 요청). test 단계에 포함

### AC-S00-41 [server] 없는 경로와 오류 응답
- When `GET /없는-경로`
- Then 404와 JSON 본문. 응답에 스택 추적·파일 경로·프레임워크 내부 메시지가 없다.
- 확인: 서버 단위 테스트

### AC-S00-42 [server] 기동
- When `pnpm --filter @livejjim/server start`(빌드가 필요하면 그 명령을 handoff에 적는다)
- Then `PORT`(기본 3000)에서 대기하고, `curl -s localhost:3000/health`가 `{"status":"ok"}`를 돌려준다. 기동 로그에 환경변수 값을 찍지 않는다. Ctrl+C로 정상 종료한다.
- 확인: 수동 (spec-auditor)

---

## E. 웹 (`apps/web`)

### AC-S00-50 [web] 한국어 빈 화면
- 근거: 백로그 S00, UX-01, D-025
- Then `index.html`에 `<html lang="ko">`, `<title>라이브찜</title>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`가 있다.
- Then 첫 화면에 제목(heading) "라이브찜"과 문장 "준비 중이에요."가 있다. 영어·개발 용어가 보이지 않고, 기본 글자는 16px 이상이다.
- Then 서버 호출과 외부 리소스(CDN·외부 글꼴)가 없다.
- 확인: 웹 단위 테스트(Vitest + Testing Library, jsdom)로 heading 역할·이름 "라이브찜"과 문장 존재 확인(test 단계 포함) + `index.html` 검사

### AC-S00-51 [web] 빌드와 개발 서버
- When `pnpm --filter @livejjim/web build`
- Then 성공한다.
- When `pnpm --filter @livejjim/web dev`
- Then 첫 화면이 뜬다. 375px 폭에서 가로 스크롤을 만드는 고정 폭 요소가 없다.
- 확인: 명령 실행 (spec-auditor) + 스타일 검사

---

## F. 테스트 관점 (test-domain, `tests/adversarial/**`)

개발자 보고를 믿지 말고 아래를 공격한다. 무엇을 남길지는 test-domain이 정한다. 아래 확인 대상은 위 기준(AC)이다.

- **러너가 항상 통과하지 않는지** (AC-S00-22·23·25): 프로그램 API로 픽스처 골든을 돌린다. 불일치, 키 오타(`prodcuts`), 열거값 오타(`SOLDOUT`), `at` 역행, YAML 1.1 함정(`no:`·`OFF`), 허용 목록 패턴 오타를 넣고 실패·읽기 오류가 나는지 본다.
- **허용 목록 우회** (AC-S00-23): 불일치·읽기 오류를 숨기지 않는지, 환경변수나 명령행 옵션으로 넓혀지지 않는지.
- **결정성** (AC-S00-27): 숨은 상태를 가진 가짜 엔진, 실행할 때마다 순서가 바뀌는 효과 목록.
- **시간대** (AC-S00-14·26): 다른 `TZ`의 자식 프로세스에서 `at` 변환 결과가 같은지.
- **코어 순수성 회귀** (AC-S00-05): ESLint API로 금지 예시를 하나씩 린트해 모두 오류가 나는지. 린트 설정이 나중에 약해지면 이 테스트가 잡는다.
- **커버리지 설정 약화 감지** (AC-S00-13): 임계값 95·측정 범위가 설정에 그대로 있는지.
- **서버** (AC-S00-40·41): 다른 메서드·없는 경로·잘못된 헤더에서 스택이 노출되지 않는지.

---

## 추적 표

| 근거 | 수용 기준 |
|---|---|
| NFR-02 결정성 | 05, 10, 14, 21, 26, 27 |
| 백로그 힌트 1 (`pnpm verify` 한 번) | 10, 11, 12, 13 |
| 백로그 힌트 2 (골든 전부 읽기, 미구현 표시, 알려진 실패 허용) | 20, 23, 24 |
| D-020 허용 목록 | 23, 24 |
| D-021 엄격한 형식 | 20, 21, 22 |
| D-022 시각 표기·정산 날짜 | 20(G-ENG-070·073 불러오기), 26 |
| D-023 문자 수신 시각 | 22·26(형식만). 해석은 범위 밖(S03) |
| D-024 코어 순수성 | 05 |
| D-025 골격 기본값 | 01, 02, 03, 07, 10, 40, 42, 50 |
| D-026 시간대 고정 | 14, 26 |
| NFR-06·CLAUDE.md 규칙 7 (이스케이프) | 06, 41 |
| CLAUDE.md 규칙 4 (보호 경로) | 10(verify 위치), 15, 22(픽스처 위치) |

## 범위 밖 (이번 스프린트에서 하지 않는다)

- 판정 엔진·파서·정산 구현 → S01~S03. 골든 통과는 S01부터 허용 목록을 항목별로 줄이며 요구한다(D-020).
- 시나리오별 INV-1~12 자동 검사 → S02(엔진 상태 형태가 정해진 뒤). 러너는 나중에 붙일 수 있는 자리만 둔다.
- 문자 수신 시각 해석 함수(D-023) → S03. 입력 시각보다 늦은 수신 시각 확인 화면 → S06.
- E2E·Playwright 설정·`tests/e2e` 단계 → S05. 사용성 감사 없음.
- DB(Drizzle·PGlite)·이벤트 저장·인증·실시간 푸시·REST API → S04. 헬스체크는 DB를 확인하지 않는다.
- Tailwind·TanStack Query·PWA·실제 화면 → S05~S06.
- `packages/label` 렌더링 → S07. S00은 빈 워크스페이스 패키지만.
- 원격 CI 서비스 설정 파일(원격 저장소 없음). 단일 명령만 제공한다.
- 배포·컨테이너 → S12.
- 하네스 게이트(`scripts/harness/**`)·`.claude/**` 수정: 오케스트레이터 소유.
