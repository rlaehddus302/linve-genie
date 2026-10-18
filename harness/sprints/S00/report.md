# S00 리포트 — 부트스트랩

**결과: FAIL** — 수정 라운드 2회 뒤에도 `pnpm verify`가 adversarial 단계에서 실패한다(적대 테스트 파일 4 · 테스트 193 · 실패 11). 원인은 검증 게이트를 우회하는 길 4가지다.

## 영역별로 만든 것

### core
- pnpm 모노레포: `@livejjim/core`와 빈 `@livejjim/label`. 버전 고정: pnpm@12.14.0, Node 24 이상, 모든 의존성은 정확한 버전.
- TS strict + noUncheckedIndexedAccess, ESLint 경고 0.
- 코어 순수성 린트: Date·Math.random·Intl 등을 금지한다. noInlineConfig와 core-guards로 끄는 주석·커버리지 무시 주석도 막는다.
- `pnpm verify`: typecheck → lint → test → golden → adversarial → coverage 순서로 돈다. 요약표를 보여 주고 TZ=Pacific/Honolulu로 고정한다.
- 라운드 2에서 막은 우회: lint는 `--config`를 강제하고 하위 설정 파일을 검출한다. test·adversarial은 돈 파일 집합과 건너뛴 테스트 수를 대조한다. typecheck는 어느 tsconfig에도 없는 파일을 검출한다.
- 골든 러너: YAML 1.2 core 형식 계약 검증, 결과 상태 6종, 허용 목록 `known-unimplemented.yaml`, 결정성 2회 실행, 실패 보고. golden 결과는 파일 11 · 파서 사례 103 · 엔진 시나리오 42, 미구현(허용) 145, 실패 0이다.
- 커버리지: core/src 라인·분기 95%.

### server
- `@livejjim/server`(hono). `GET /health`는 200 `{"status":"ok"}`, HEAD를 처리하고 그 밖의 메서드는 405 JSON.
- 모든 오류를 JSON `{"error":{code,message}}`로 준다. 한국어 메시지이며 스택은 노출하지 않는다. 앱에 닿기 전에 나는 오류(Host·파서 오류)도 JSON이다.
- `start` 명령(PORT 기본 3000). 로그에 환경변수 값을 남기지 않는다. 정상 종료를 처리한다. `.env.example`에는 PORT만 있다.
- 단위 테스트는 포트를 열지 않는다(duplexPair 사용).

### web
- `@livejjim/web`(React 19 + Vite 8). `lang=ko`, 제목 '라이브찜', 문장 '준비 중이에요.' 글자 16px 이상이고 외부 리소스는 없다.
- XSS 린트: dangerouslySetInnerHTML의 모든 형태와 innerHTML·insertAdjacentHTML·document.write를 막는다. noInlineConfig를 켰다.
- 빌드를 확인하는 단위 테스트가 있다. 테스트는 파일 6개 · 71개.

### test-domain
- `tests/adversarial/s00/` 4개 파일: verify-gates, lint-guards, golden-runner, server.
- 이번 라운드 추가: TD-S00-017·018·019·020 실패 재현 테스트와 각 전제·회귀 테스트, lint-guards 회귀 5건.

## 남은 blocker / major

| ID | 심각도 | 내용 | 제안 |
|---|---|---|---|
| GATE-S00-VERIFY | blocker | `pnpm verify` 종료 코드 1. adversarial 실패 11건 | 아래 4건을 해결 |
| SA-S00-009 / TD-S00-017 | blocker | tsconfig에 `"noCheck": true`를 넣으면 typecheck가 타입 오류를 보지 않고 '모두 검사'로 통과한다 | `--showConfig`로 noCheck를 확인해 실패시키거나, tsc에 `--noCheck false`를 붙인다 |
| SA-S00-010 / TD-S00-018 | blocker | Vitest typecheck 모드를 켜면 실패하는 테스트가 passed로 보고된다(test·adversarial 모두) | vitest 명령에 `--typecheck.enabled=false`를 붙인다. 설정 파일을 보호 경로로 지정할지 검토 |
| SA-S00-011 | blocker | 범위 안 `.d.ts`는 skipLibCheck 때문에 검사되지 않는다 | 범위 안 .d.ts가 있으면 실패시킨다(지금은 그런 파일이 없음) |
| SA-S00-012 | blocker | `.gitignore`의 dist/·build/·coverage/·.vite/에 앵커가 없어 `src/build` 같은 소스 폴더가 커밋에서 빠진다 | 루트와 `{apps,packages}/*/` 바로 아래로 앵커를 붙인다 |
| SA-S00-013 | major | server·label·core test·adversarial 경로에서는 eslint-disable 주석 + `// @ts-nocheck`로 lint·typecheck를 함께 우회할 수 있다(테스트 없음) | typecheck에서 @ts-nocheck·@ts-ignore를 검출한다. 공통 블록에도 noInlineConfig를 켠다. 회귀 테스트를 요청 |

## 자율 결정 · 사용자 확인 필요 사항

모두 AUTO로 적용했고, 진행을 막는 결정은 없다. 에스컬레이션은 0건이다.

| ID | 결정 | 사용자 확인 |
|---|---|---|
| D-002 | 기술 스택은 TECH_REVIEW §6 값으로 정함 | **필요** — 원래 PROPOSED였던 결정이다 |
| D-020 | 미구현 허용은 전역 플래그 대신 보호 경로 파일의 항목별 허용 목록으로 한다(백로그 문구와 다름) | 권장 |
| D-021 | 골든 YAML을 1.2 core로 엄격하게 읽는다. 형식 계약 밖의 내용은 읽기 오류 | — |
| D-022 | 자정을 넘긴 방송의 정산 날짜 = 방송 날짜(R-12) | 권장(도메인 규칙) |
| D-023 | 문자 수신 시각은 입력 시각에 가장 가까운 날짜로 해석한다(R-6) | 권장(도메인 규칙) |
| D-024 | 코어 순수성을 ESLint 금지 목록으로 강제한다 | — |
| D-025 | 패키지 이름·버전 등 S00 골격 기본값 | — |
| D-026 | 테스트 시간대를 Pacific/Honolulu로 고정 | — |

함께 판단이 필요한 것
- SA-S00-010: `vitest.adversarial.config.ts`를 보호 경로로 둘지(오케스트레이터 결정).
- TD-S00-021: HTTP/1.0에 Host 없는 헬스체크를 허용할지(spec-keeper 결정).

## minor / nit 백로그 (techDebt에 등록)

| ID | 심각도 | 영역 | 제목 |
|---|---|---|---|
| RA-S00-001 | minor | core | 골든 러너가 엔진이 입력 state를 그 자리에서 고치는 것을 잡지 못함(S02 전에 처리) |
| RA-S00-002 | minor | core | observe가 항상 미구현이라 S02에서 G-ENG-* 허용으로 조용히 통과할 수 있음 |
| RA-S00-003 | minor | core | 순수성 린트가 외부 import·WeakRef·Atomics·import.meta를 막지 않음 |
| RA-S00-004 | nit | server | 오류 로그가 예외 객체 전체를 남김(S04 전) |
| TD-S00-007 | minor | server | 417·CONNECT 응답이 JSON이 아님 |
| TD-S00-008 | minor | server | Host 중복·absolute-form 요청에 200을 줌 |
| TD-S00-009 | minor | core | 결정성 검사가 시작 상태의 스냅샷을 비교하지 않음 |
| TD-S00-010 | minor | core | 관찰 스냅샷의 열거값을 검사하지 않음 |
| TD-S00-011 | nit | core | 순수성 린트의 정적 우회(Math 별칭, Function 생성자, .jsx 등) |
| TD-S00-012 | nit | core | 골든 탐색이 심볼릭 링크·.YAML을 건너뜀 |
| TD-S00-016 | nit | web | XSS 린트가 막지 못하는 다른 통로(setHTMLUnsafe·srcdoc 등) |
| TD-S00-019 | minor | core | .d.ts 검사 누락(SA-S00-011과 같은 건) |
| TD-S00-020 | minor | core | .gitignore 앵커 없음(SA-S00-012와 같은 건) |
| TD-S00-021 | minor | server | Host 없는 HTTP/1.0 헬스체크에 400(스펙 확인 필요) |

## 추적성

| 참조 | 구현 | 테스트 |
|---|---|---|
| NFR-02 | packages/core/src, eslint.config.mjs 코어 블록, scripts/verify/time-zone.mjs | purity-lint.test.ts, lint-guards.test.ts, golden-runner.test.ts(TZ) |
| AC-S00-01 | pnpm-workspace.yaml, package.json, pnpm-lock.yaml, .gitignore | verify-gates TD-S00-020(**실패**) |
| AC-S00-02 | 모든 package.json | 자동 테스트 없음 |
| AC-S00-03 | tsconfig*, stages.mjs typecheck() | verify-gates TD-S00-015(통과)·017·019(**실패**), @ts-nocheck 우회는 테스트 없음 |
| AC-S00-04 | eslint.config.mjs, stages.mjs lint() | verify-gates TD-S00-013 |
| AC-S00-05 | eslint.config.mjs 코어 블록 | purity-lint, lint-guards, TD-S00-013 |
| AC-S00-06 | eslint.config.mjs web 블록 | xss-lint.node.test.ts, lint-guards, TD-S00-013 |
| AC-S00-07 | .env.example, .gitignore | config.test.ts, TD-S00-020 회귀(통과) |
| AC-S00-10 | scripts/verify/*, 루트 스크립트 6개 | 감사 게이트 실행 |
| AC-S00-11 | stages.mjs vitestRun | TD-S00-014(통과)·018(**실패**) |
| AC-S00-12 | vitest*.config.ts, unitTestFiles()·adversarialFiles() | verify 출력 확인 |
| AC-S00-13 | vitest.coverage.config.ts, coverage() | lint-guards, purity-lint |
| AC-S00-14 | time-zone.mjs | golden-runner.test.ts |
| AC-S00-15 | golden/api.ts, 루트 tsconfig | tests/adversarial/s00/* |
| AC-S00-20 | fs-runner.ts·cli.ts | runner.test.ts, golden-runner.test.ts |
| AC-S00-21 | yaml.ts | yaml.test.ts, golden-runner.test.ts |
| AC-S00-22 | runner.ts·allowlist.ts | read-errors·allowlist·golden-runner |
| AC-S00-23 | allowlist.ts, known-unimplemented.yaml | allowlist·runner·golden-runner |
| AC-S00-24 | golden 단계(미구현(허용) 145) | golden-runner.test.ts |
| AC-S00-25 | compare.ts | compare.test.ts |
| AC-S00-26 | time.ts | time.test.ts, runner.test.ts |
| AC-S00-27 | runner.ts·serialize.ts | runner·golden-runner(RA-S00-001·TD-S00-009 미해결) |
| AC-S00-28 | report.ts | runner.test.ts |
| AC-S00-40 | apps/server/src/app.ts | app·node-server·server.test.ts |
| AC-S00-41 | errors.ts·node-server.ts | app·errors·node-server·server(TD-S00-007·008 미해결) |
| AC-S00-42 | config.ts·main.ts | config.test.ts, server.test.ts |
| AC-S00-50 | apps/web/index.html·App.tsx·main.tsx·styles.css | App·main·index-html·styles 테스트 |
| AC-S00-51 | apps/web/vite.config.ts | build.node.test.ts |

## 다음 스프린트 제안

1. **S00 수정 라운드를 한 번 더 돈다(S01보다 먼저).** dev-core가 처리할 것:
   - SA-S00-009: `--noCheck false`를 붙인다.
   - SA-S00-010: `--typecheck.enabled=false`를 test·adversarial 두 단계에 붙인다.
   - SA-S00-011: 범위 안 .d.ts를 금지한다.
   - SA-S00-012: .gitignore에 앵커를 붙인다.
   - SA-S00-013: @ts-nocheck·@ts-ignore를 검출하고, 공통 블록에 noInlineConfig를 켠다. test-domain이 회귀 테스트를 추가한다.

   모두 고칠 방법이 정해져 있고 작은 수정이다.
2. 오케스트레이터가 정할 것: Vitest 설정 파일을 보호 경로로 지정할지.
3. S00이 통과한 뒤 S01(파서)로 간다. spec-keeper가 할 일:
   - S02 수용 기준에 RA-S00-001·002와 TD-S00-009·010(골든 러너 보강)을 넣는다.
   - TD-S00-021을 판단한다.

---

## 오케스트레이터 후속 조치 (2026-10-19)

워크플로 결과는 FAIL이었다. 하지만 남은 blocker 5건은 모두 "검증 파이프라인을 설정으로 속이는 방법" 계열이었다. 제품 결함은 없었다. 수정 라운드를 더 돌려도 새 우회가 계속 나와 수렴하지 않을 구조였으므로, 오케스트레이터가 직접 막고 권한으로 닫았다(D-027).

| 지적 | 조치 |
|---|---|
| SA-S00-009 noCheck | 설정에 `noCheck: true`가 있으면 실패. tsc 실행에 `--noCheck false`로 덮어쓰기 |
| SA-S00-010 Vitest 타입 검사 모드 | test·adversarial·coverage 실행에 `--typecheck.enabled=false` 강제 |
| SA-S00-011 범위 안 .d.ts | 범위 안 선언 파일이 있으면 실패(`declarationFilesInScope`) |
| SA-S00-012 .gitignore | 결과물 폴더를 루트·패키지 바로 아래로 고정. 사용자 전역 gitignore의 `build/`도 저장소 쪽 `!build/`로 되돌림 |
| SA-S00-013 주석 우회 | ESLint 공통 블록에 `noInlineConfig` + `ban-ts-comment` 오류. lint 단계가 모든 범위에서 두 설정이 실제 적용됐는지 ESLint API로 확인 |
| 재발 방지 | `scripts/verify/**`, `vitest.adversarial.config.ts`를 개발자 금지 경로로. 테스터 범위를 "제품 공격"으로 한정 |

결과: `pnpm verify` 6단계 모두 통과.
- typecheck: 설정 7 · 파일 63
- lint: 오류 0
- test: 488
- golden: 파서 103 · 엔진 42, 미구현 허용 145
- adversarial: 193
- coverage: 100%
