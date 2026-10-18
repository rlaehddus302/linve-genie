# S00 개발 노트

## dev-core

### 만든 것
- 워크스페이스: `@livejjim/core`(packages/core), `@livejjim/label`(packages/label, 빈 진입점). server·web은 dev-server·dev-web 몫.
- 공용 도구: `tsconfig.base.json`, 루트 `tsconfig.json`(루트 설정 파일 + `tests/adversarial/**`), `eslint.config.mjs`, `vitest.config.ts`(test), `vitest.coverage.config.ts`(coverage), `vitest.adversarial.config.ts`(adversarial), `scripts/verify/*`.
- 골든 러너: `packages/core/test/golden/` (CLI `cli.ts`, 프로그램 API `api.ts` = `@livejjim/core/golden`).
- 코어 API 자리: `parseChat`·`parseAmount`·`parseKoreanNumber`·`parseQuickInput`·`initEngine`·`applyEvent`는 모두 `NotImplementedError`를 던진다.

### 결정과 이유 (스펙과 다르지 않음, 구현 선택)
- **verify는 앞 단계가 실패해도 뒤 단계를 계속 돌린다.** 한 번에 전체 상황을 보이기 위해서다. 그래서 `건너뜀`은 쓰지 않는다(AC-S00-11은 "돌리지 않았다면 건너뜀"이므로 허용 범위).
- **coverage는 별도 설정(`vitest.coverage.config.ts`)으로 돈다.** `vitest --project core --coverage`는 Vitest 5가 측정 기준 폴더를 프로젝트 폴더로 바꿔 `include`가 조용히 비고 0/0이 "통과"로 나왔다. 그래서 프로젝트 없이 저장소 루트 기준 설정을 따로 두고, verify가 요약 파일을 다시 읽어 95%와 "측정 줄 0개"를 따로 확인한다.
- **타입만 있는 파일**(`settings.ts`)과 재수출만 있는 `index.ts`는 실행할 문장이 없어 V8이 "빈 파일"로 뺀다. 설정에서 따로 제외한 것은 `*.d.ts`뿐이다.
- **typecheck**는 워크스페이스 패키지마다 `tsconfig.json`(필수)과 `tsconfig.*.json`을 모두 검사하고, `tsc --showConfig`로 strict·noUncheckedIndexedAccess가 켜져 있는지(strict 계열 플래그를 끄지 않았는지) 확인한다. 코어 `src`는 Node 타입 없이(`types: []`) 따로 검사한다.
- **"미구현" 판단은 `@livejjim/core`의 `NotImplementedError`(`isNotImplemented` = instanceof) 하나뿐.** 같은 메시지·이름을 흉내 낸 예외는 러너 오류다.
- **at은 UTC 밀리초(number)로 넘긴다.** D-024("코어는 시각을 숫자로 받는다")에 맞췄다. 러너도 `Date` 없이 정수 산술로 변환한다.
- **엔진 결과는 `GoldenSnapshot`으로 비교한다.** 러너는 엔진 상태 모양을 모른다. S02에서 `core-adapter.ts`의 `observe`가 엔진 상태 → 스냅샷 변환을 맡는다(상태 모양이 정해지는 스프린트에서 붙임). 구매자 키는 스냅샷의 `buyerKeys`(키 → 지금의 구매자 ID)로 푼다.
- **결정성 검사**는 각 이벤트 뒤의 상태·효과와 관찰 스냅샷을 직렬화해 비교한다. 객체 키 순서가 달라도 위반으로 본다. 상태에 함수·클래스 인스턴스·순환 참조가 있으면 러너 오류.

### spec-keeper에게: README 형식 계약에 명시되지 않아 러너가 정한 해석
README에 문장으로 없는 부분은 판매자에게 안전한 쪽(오타가 조용히 통과하지 않는 쪽)으로 정했다. README에 옮겨 주면 좋겠다.
1. `effects`·`pendingEffects` 항목의 키: `kind`(필수)·`target`·`product`·`buyer`·`text`·`confirmVersion`. 그 밖의 키는 읽기 오류. (README 예시에 나온 키만 허용)
2. 효과 보고 대상: `effect.labelPrinted` ↔ `PRINT_PRODUCT_LABEL`, `effect.thanksSent` ↔ `POST_THANKS`(+`target`, 기본 `LIVE_CHAT`). "취소되지 않은" = 상태가 `CANCELLED`가 아님(이미 실행된 효과도 대상).
3. 참조 검사: `sms:<ref>` 구매자 키는 시나리오 안에 그 `ref`의 문자찜이 있어야 한다. `host.convertMessage.msg`는 시나리오 안의 채팅 `id`여야 한다. 채널 ID(`ch`)는 `sms:`로 시작할 수 없다.
4. `settlement.shippingOverride`: `mode: FIXED`면 `amount` 필수, 다른 mode에 `amount`가 있으면 읽기 오류.
5. 값 범위: `title`·`reason`·`nick`·방송 `title`은 빈 문자열 금지, `refs` 항목은 빈 문자열 금지, `sameBuyer` 묶음은 키 2개 이상, 방송 ID에 공백·`/`·`@` 금지, 상품 번호는 선행 0 없는 1 이상 정수.
6. `buyers.<키>`: 키를 풀 수 없거나 그 구매자의 기록이 없으면 불일치(빈 구매자로 보지 않는다). `settlements`는 README대로 보고되지 않은 묶음을 금액 0·`UNPAID`로 본다.
7. 허용 목록: 중복 항목, 맞는 문서가 없는 suite 이름도 읽기 오류(맞는 시나리오가 없는 패턴과 같은 취급). 문서가 비면(주석만) 빈 목록.
8. 골든 파일이 하나도 없거나, YAML 문서가 0개인 파일은 읽기 오류(항상 통과하는 러너 방지). YAML 명시적 태그(`!!timestamp` 등)도 읽기 오류.

### 의존성 메모 (AC-S00-02)
- 루트 `@livejjim/core`(workspace:*)·`fast-check`는 지금 루트 파일이 import하지 않지만, `tests/adversarial`이 import하도록 둔 것이다(AC-S00-15가 요구). 노드 모듈 해석은 루트 `node_modules`에서 찾는다.
- TypeScript는 6.0.3. typescript-eslint 8.71.2가 `<6.1.0`만 지원해서 최신 7.x 대신 6.0.x를 골랐다.

## dev-server

### 만든 것
- `apps/server` = `@livejjim/server`. 런타임 의존성 `hono` 4.13.13, `@hono/node-server` 2.1.5 (정확한 버전). 개발 의존성 `@types/node`·`vitest`(코어와 같은 버전).
- `src/app.ts` `createApp({ logError? })`: `GET /health` → 200 `application/json` `{"status":"ok"}`. DB·외부 서비스·환경변수를 보지 않는다.
- `src/errors.ts`: 모든 오류 응답은 `{"error":{"code","message"}}` JSON. message는 쉬운 한국어, code는 영문 대문자(프로그램 분기용).
- `src/node-server.ts` `createNodeServer({ app, logError? })`: 앱을 Node HTTP 서버에 붙인다(listen은 하지 않음).
- `src/config.ts` `readPort(env)`, `src/main.ts`(기동), 루트 `.env.example`(`PORT`만).

### 결정과 이유 (스펙과 다르지 않음, 구현 선택)
- **Hono를 골랐다(TECH_REVIEW §6 "Fastify 또는 Hono").** 웹 표준 Request/Response라 `app.request()`로 포트 없이 테스트하기 쉽고, SSE 도우미가 패키지 안에 있어 S04 실시간 푸시에 새 의존성이 필요 없다. Node 연결은 공식 어댑터 `@hono/node-server`.
- **빌드 없음.** `node src/main.ts`로 Node 24가 타입을 벗겨 바로 실행한다(`erasableSyntaxOnly`가 이를 보장). 배포(S12)에서 필요하면 그때 빌드 단계를 붙인다.
- **오류 응답은 앱에 닿기 전 단계까지 JSON으로 통일했다(AC-S00-41, F절 "잘못된 헤더").**
  - 없는 경로 404, 허용하지 않는 메서드 405(+`Allow: GET, HEAD`), 처리 중 예외 500.
  - Hono `onError`는 Error 인스턴스만 받으므로, 맨 앞 미들웨어가 Error가 아닌 값(`throw '문자열'`)도 JSON 500으로 바꾼다.
  - 프레임워크가 만든 `HTTPException`(예: 깨진 JSON 본문 → 400)은 상태만 살리고 메시지·사용자 지정 응답은 버린다. 5xx는 상태를 살리되 일반 문구로 답한다.
  - 응답에 받은 요청 값(경로·헤더·본문)을 되돌려 주지 않는다(반사형 XSS 차단).
  - `@hono/node-server`의 기본 동작은 잘못된 Host 헤더에 본문 없는 400, 앱 호출 실패에 본문 없는 500, 응답 스트림 오류에 `Error: <메시지>` 텍스트를 준다. 그래서 `serve()` 대신 `getRequestListener(..., { errorHandler })` + `http.createServer`로 직접 붙여 앞의 둘을 JSON으로 바꿨다. 응답 스트림 오류는 스트리밍 응답이 없는 지금은 생기지 않는다(S04에서 SSE를 붙일 때 다시 본다).
  - Node HTTP 파서 오류(`clientError`: 잘못된 요청 줄·헤더, 요청 밀반입 형태, 너무 큰 헤더, 시간 초과)도 Node 기본과 같은 상태(400·413·431·408)에 JSON 본문으로 답한다. 이미 응답 헤더를 보낸 연결이면 덧붙이지 않고 끊는다(Node 기본과 같은 기준).
  - `requireHostHeader: false`: Node가 Host 없는 HTTP/1.1 요청을 본문 없는 400으로 먼저 끊지 않게 했다. 그런 요청은 어댑터가 `RequestError`로 넘기고 JSON 400이 된다(상태는 RFC 9112대로 400 그대로). Host 없는 HTTP/1.0도 같은 400이다(주소를 만들 수 없음).
- **기동 로그에 환경변수 값을 찍지 않는다(AC-S00-42).** PORT를 지정했으면 "PORT 환경변수로 지정한 포트", 아니면 "기본 포트 3000"이라고만 쓴다. 포트 충돌 등 Node 오류 메시지에는 포트 번호가 들어 있어 오류 코드만 보고 우리 문장으로 알린다. 잘못된 PORT 값도 메시지에 되풀이하지 않는다.
- **PORT 규칙**: 없거나 빈 문자열이면 3000. 있으면 1~65535의 10진 숫자만(공백·소수·`1e3`·`0x50`·전각 숫자는 시작 실패, 종료 코드 1).
- **`.env`**: 저장소 루트의 `.env`가 있으면 `main.ts`가 `process.loadEnvFile`로 읽는다. 이미 있는 환경변수가 우선한다. `.env.example`은 루트에 두고 `PORT`만 적었다.
- **종료**: SIGINT(Ctrl+C)·SIGTERM → 새 연결을 받지 않고, 쉬는 연결은 바로 닫고, 진행 중인 요청을 마친 뒤 종료 코드 0. 5초가 지나도 남은 연결은 강제로 끊는다. 한 번 더 누르면 바로 종료(코드 1). `pnpm --filter @livejjim/server start`에서 pnpm이 SIGINT를 넘겨 주는 것까지 손으로 확인했다.
- **단위 테스트는 포트를 열지 않는다(AC-S00-40).** 앱은 `app.request()`, Node HTTP 계층은 listen하지 않은 서버에 `stream.duplexPair()`로 만든 메모리 연결을 `connection` 이벤트로 넘겨 원시 요청 바이트를 보낸다. 테스트 파일이 끝날 때 `Server.prototype.listen`이 한 번도 불리지 않았는지 확인한다.
- 구현을 일부러 망가뜨려(404 처리 제거, 미들웨어 제거, 4xx 메시지 노출, 헬스 본문 변경, 405 제거, Host 검사 기본값, clientError 처리 제거, headersSent 검사 무력화, 포트 하한 제거, Content-Type 덮어쓰기 허용) 10가지 모두 테스트가 잡는 것을 확인하고 되돌렸다.

### 의존성 메모 (AC-S00-02)
- 루트 `@livejjim/server`(workspace:*)는 루트 파일이 import하지 않지만, test-domain이 `tests/adversarial`에서 서버 오류 응답(F절)을 포트 없이 공격할 수 있게 둔 것이다. 루트 `@livejjim/core`와 같은 이유.
- 서버는 S00에서 `@livejjim/core`를 쓰지 않으므로 의존성에 넣지 않았다(S04에서 추가).

### 이 PC에서 확인할 때
- 이 개발 PC는 3000번 포트를 OrbStack(Grafana 컨테이너)이 쓰고 있다. 기본 포트로 띄우면 "다른 프로그램이 이미 쓰고 있는 포트예요(기본 포트 3000)"로 종료 코드 1이 나온다. `PORT=3456 pnpm --filter @livejjim/server start`로 확인했다.
