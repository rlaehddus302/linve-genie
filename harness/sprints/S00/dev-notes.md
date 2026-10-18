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
