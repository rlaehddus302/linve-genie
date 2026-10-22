# A1 개발 노트

## dev-server

### 만든 것 (파일)
- `apps/server/src/assist/rules.ts` — 순수 함수 넷(골든 `tests/golden/assist/*.json`): `ruleSuggestion`(규칙 제안 — 코어 `parseOptionComment`를 `focus = null`로 다시 부름)·`similar`(비교 글자 → NFD → 편집 거리 ≤ 1, 숫자 든 말·2글자 미만 이름 제외)·`redact`(가리기)·`validateResponse`(응답 검사)·`planAssist`(호출 고르기). 시계·난수·I/O 없음.
- `apps/server/src/assist/anthropic.ts` — `CommentAssist` 어댑터 모양과 Anthropic Messages API 구현(`AnthropicAssist`). 직접 HTTP(`fetch`) — SDK 의존성을 더하지 않았다.
- `apps/server/src/assist/service.ts` — `AssistService`: 설정 보기/바꾸기, 목록에 붙이는 제안(`attach` — 외부 호출 없음), AI 제안 받기(`run`), 운영 환경 변수 읽기(`readAssistEnv`), 설정 확인(`checkAssistSetup`).
- `apps/server/src/assist/routes.ts` — `/api/assist/**` 경로.
- `apps/server/src/assist/fake-llm.ts` — 가짜 LLM 서버(`FakeLlm`, 127.0.0.1).
- 마이그레이션 하나 `apps/server/drizzle/0015_a1_assist.sql` — 새 표 셋. 기존 표의 칸 뜻은 그대로.
  - `assist_settings`(판매자마다 한 줄: `enabled`·`consented_at`·`updated_at`, 줄이 없으면 꺼짐).
  - `assist_cache`(`seller_id`·`scope_date`·`rehearsal`·`broadcast_id`·`text_hash`·`no`(읽은 번호, 없으면 0)·`suggestion`(검사를 통과한 제안 JSON 또는 null = 제안 없음)·`created_at`, 유일 제약 `assist_cache_uq`). `text_hash` = 마스터 키에서 나눈 키의 HMAC-SHA256(가린 글) base64url — 짧은 글이라도 DB만으로 되돌릴 수 없다.
  - `assist_calls`(호출 하나 = 한 줄, 실패 포함: `seller_id`·`day`(KST)·`items`·`input_tokens`·`output_tokens`·`cache_read_tokens`·`cache_write_tokens`·`ok`(true/false/진행 중 null)·`failure`(`HTTP`·`TIMEOUT`·`NETWORK`)·`created_at`·`finished_at`).
  - 댓글 원문·가린 글·요청·응답 본문 칸은 어디에도 없다. 복구(I2): `assist_cache`는 지우는 표(`RESTORE_REPLACED_TABLES` — 다음에 다시 물을 뿐), `assist_settings`·`assist_calls`는 그대로 두는 표.
- 확인 필요 목록(`GET /api/reviews`) 항목에 `suggestion` 키 하나만 더했다(`apps/server/src/reviews.ts`). 다른 키·순서·항목 수는 O2 그대로.
- 로그 코드: `ASSIST_HTTP_ERROR`(status)·`ASSIST_TIMEOUT`·`ASSIST_NETWORK`·`ASSIST_FAILED`(errorKind)·`ASSIST_NO_SUGGESTION`(count) — 판매자 ID·HTTP 상태·개수만.
- 오류 코드 `CONSENT_REQUIRED`(errors.ts).

### LLM 사용법 확인 (D-A1-04)
- 이 작업 환경에는 claude-api 스킬이 없어(설치된 스킬 목록에 없음) 내가 아는 Messages API 최신 사용법으로 썼다. **실제 키로 확인하지 못했다** — 사용자 확인 필요(아래).
- 모델 기본값 **`claude-haiku-4-5`**: 백로그의 `claude-haiku-5-5`가 있는지 확인할 수 없어, 확실히 있는 가장 싼 Haiku를 기본값으로 했다(D-A1-04 "그 ID가 없으면 지금 가장 싼 Haiku"). `LIVEJJIM_ASSIST_MODEL`로 바꾼다.
- 요청: `POST https://api.anthropic.com/v1/messages`, 머리글 `x-api-key`·`anthropic-version: 2023-06-01`·`content-type: application/json`, 본문 `{ model, max_tokens: 1024, temperature: 0, system: [지시, { 상품 목록, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: JSON({ maxQuantity, items: [{ id, no?, text }] }) }], output_config: { format: { type: 'json_schema', schema } } }`.
  - 구조화 출력은 GA 방식(`output_config.format`)으로 썼다. 스키마는 `{ suggestions: [{ id(보낸 id enum), no(integer), options({ 목록의 옵션 항목 이름: string }, additionalProperties false), qty(integer) }] }` — 동적 키를 피하려고 그 요청 상품들의 옵션 항목 이름을 속성으로 펼쳤다. 서버는 그래도 `validateResponse`로 꼭 다시 검사한다.
  - 프롬프트 캐싱: 상품 목록 칸(system 둘째)에 `cache_control: ephemeral`. 최소 길이(Haiku 2,048토큰 안팎)에 못 미치면 캐싱되지 않는다(D-A1-04 허용).
  - 재시도 0번, 시간 제한 15초(`AbortSignal.timeout`), 응답 본문 64KB까지만 읽음, `redirect: 'error'`.
  - 응답: `content[].text`(text 칸을 이음)·`usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`(정수가 아니면 0).
- 실패 구분: HTTP 오류(2xx 아님)·시간 초과·연결 실패(본문 도중 끊김 포함) = **실패**(캐시 안 함, `FAILED`). 200인데 본문이 JSON이 아님·Messages 모양이 아님·64KB 넘음·모델 글이 형식 오류 = **모델이 답함**(보낸 항목 모두 "제안 없음"으로 캐시, `DONE`).

### 환경 변수 (AC-A1-11·12)
| 변수 | 기본 | 뜻 |
|---|---|---|
| `LIVEJJIM_ASSIST_API_KEY` | (없음) | 없으면 AI 제안을 쓸 수 없다(`available: false`, 규칙 제안만, 외부 호출 0) |
| `LIVEJJIM_ASSIST_MODEL` | `claude-haiku-4-5` | 영문·숫자·`.`·`_`·`-`·`:` 1~100자, 틀리면 시작하지 않음 |
| `LIVEJJIM_ASSIST_DAILY_CALLS` | 20 | 판매자 하루(KST) 상한, 0~1000000 정수(틀리면 시작하지 않음) |
| `LIVEJJIM_ASSIST_GLOBAL_DAILY_CALLS` | 500 | 서버 전체 하루(KST) 상한 |

- **주소 바꾸기는 "무시"** 쪽을 골랐다(AC-A1-11 "무시하거나 시작을 멈춘다"): 운영 기동(`productionServerOptions`)은 위 넷만 읽고 주소 변수는 아예 없다 — `LIVEJJIM_ASSIST_BASE_URL`·`ANTHROPIC_BASE_URL`을 적어도 읽지 않는다(서버 시험이 확인). 주소 바꾸기는 `ServerOptions.assist.baseUrl`(코드)로만 되고 그것을 쓰는 곳은 E2E 기동·연습 모드·시험뿐이며, http 주소는 `allowInsecure: true`일 때만 받는다(아니면 서버를 만들지 않음).

### 화면·시험에게 — API (D-074 규칙 그대로: 상태를 바꾸는 요청의 `Origin`·JSON·64KB, `Cache-Control: no-store`, 모르는 항목 400 `UNKNOWN_FIELD`, 받은 값을 오류에 되돌려 보내지 않음)
| 뜻 | 경로 | 본문 | 응답 |
|---|---|---|---|
| 확인 필요 목록 | `GET /api/reviews[?broadcast=][&rehearsal=true]` (기존) | | 항목마다 `suggestion`: `null` 또는 `{ no, options?, qty, source: 'RULE' \| 'AI' }`. `options`는 옵션 상품이면 모든 항목(항목 순서, 선택지 label), 옵션 없는 상품이면 키 없음. 외부 호출 없음 |
| AI 제안 받기 | `POST /api/assist/suggest` | `{ rehearsal: boolean, broadcast?: string }` | 200 `{ result, called }` — `result` ∈ `DONE`·`OFF`·`UNAVAILABLE`·`LIMIT`·`FAILED`·`BUSY`, `called` = 부른 호출 수. 다른 판매자·없는·리허설 구분이 다른 방송 404. `rehearsal` 없음·불리언 아님 400 |
| AI 제안 설정 보기 | `GET /api/assist/settings` | | `{ available, enabled, consentedAt, usedToday, dailyLimit }` — `consentedAt` UTC ISO 또는 null |
| 켜기·끄기 | `PUT /api/assist/settings` | `{ enabled: boolean, consent?: boolean }` | 200 새 설정(위와 같은 모양). 키 없는 서버에서 켜기 409 `UNAVAILABLE`("지금은 쓸 수 없어요."), 켜기에 `consent: true`가 없으면 400 `CONSENT_REQUIRED`(아무것도 바뀌지 않음), `enabled`가 불리언 아님 400 `INVALID_INPUT`. 끄기는 늘 됨 |

- 결과 코드 판단 순서(`run`): 방송 404 → 키 없음 `UNAVAILABLE` → 꺼짐 `OFF` → 같은 판매자 진행 중 `BUSY` → 범위 안 방송마다(범위 날짜 순, 범위 안 선언 순 = 오래된 방송부터) 보낼 것이 있으면 [켬 다시 읽기 → 상한 세기·호출 기록 넣기 → 부르기]. 어느 호출이든 HTTP 오류·시간 초과·연결 실패면 거기서 멈추고 `FAILED`(그 호출도 `called`에 셈). 상한에 닿으면 멈추고, 그때까지 부른 것이 없으면 `LIMIT`, 있으면 `DONE`. 도중에 꺼지면 멈추고 부른 것이 없으면 `OFF`, 있으면 `DONE`. 보낼 것이 없었으면 `DONE`·`called: 0`(세지 않음).
- `LIMIT` 문장의 `{상한}`은 `GET /api/assist/settings`의 `dailyLimit`(판매자 상한)을 쓴다 — 서버 전체 상한에 닿은 경우도 같은 문장(서버 전체 값은 화면에 내지 않는다).
- 보조자 세션: 세 경로 모두 403 `ASSISTANT_FORBIDDEN`(roles.ts 허용 목록 밖 — 처리기에 닿지 않는다). 확인 필요 목록도 지금처럼 403.
- 실시간 알림: 새 알림 없음. 설정을 바꿔도 범위 seq·이벤트가 늘지 않는다(제안은 판정이 아니다). 화면은 제안 받기 결과를 받은 뒤 목록을 한 번 다시 읽는다.
- `[이대로 주문]`은 기존 `POST /api/events` `{ type: 'host.resolveReview', b, item, no, options?, qty, requestId }` 하나 — 값은 `suggestion`의 `no`·`options`·`qty` 그대로(`source`는 보내지 않는다).
- "옵션 방송을 쓰는 판매자" 판단(AC-A1-22)은 기존 `GET /api/settings`의 `claim.parseMode === 'OPTIONS'` 또는 `GET /api/option-broadcasts/exists`의 `exists`.

### 시험에게 (test-domain·test-e2e)

#### E2E 기동 (AC-A1-11)
```
pnpm --filter @livejjim/server e2e --port <포트> --origin <화면 주소> --assist fake [--assist-port <포트, 기본 0>] [--assist-daily <판매자 하루 상한, 기본 20>] [--assist-global <서버 전체, 기본 500>] [--assist-timeout-ms <기본 15000>]
```
- 시작 줄에 `· 가짜 AI http://127.0.0.1:<포트>`가 붙는다. `--assist` 없음(기본)은 키 없음 — 기존 E2E 그대로(`available: false`, 외부 호출 0).
- 프로그램으로: `startE2eServer({ assist: { port?, dailyLimit?, globalLimit?, timeoutMs? } })` → `e2e.fakeLlm`.
- 이 트랙 E2E는 늘 `E2E_PORT_OFFSET=27100`. Playwright 묶음 추가는 dev-web 몫(`apps/web/playwright.config.ts`) — 제안: `chromium-assist`(화면 `5183+offset`, 서버 `3111+offset`, `--assist fake --assist-port ${4106+offset} --assist-daily 3 --assist-timeout-ms 2000`, 제목 `@assist`), 기본 묶음의 `grepInvert`에 `@assist`.

#### 가짜 LLM 서버 (`apps/server/src/assist/fake-llm.ts`, `FakeLlm`)
- `POST /v1/messages`: 키 머리글 `x-api-key`가 없거나 `fake-assist-key`가 아니면 401(이것도 요청 수에 센다). Messages 응답 `{ id, type: 'message', role, model, content: [{ type: 'text', text }], stop_reason, usage: { input_tokens, output_tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }`.
- 기본 답: 항목마다 상품(읽은 번호, 없으면 글에 이름이 든 첫 상품)의 옵션 항목에서 글에 이름·별칭(비교 글자)이 든 선택지가 **하나**면 그것(선택지 하나뿐인 항목은 그것), 다 고르면 수량 1. 못 고르면 그 항목을 뺀다. 정해 둔 답이 먼저.
- 조작 (JSON, 그 서버 주소):

| 경로 | 본문 | 뜻 |
|---|---|---|
| `GET /_fake/requests` | | `{ calls, requests: [{ at, headers, body }] }` — `headers`는 받은 머리글 그대로(소문자 이름, `x-api-key` 포함), `body`는 받은 JSON. 보낸 글은 `body.messages[0].content`(JSON 글)의 `items[].text` |
| `POST /_fake/answers` | `{ text, suggestion }` | 가린 글 `text`에 정해 둔 답 — `suggestion` = `{ no, options?, qty }`(id는 알아서) 또는 `null`(그 항목을 뺀다). 일부러 틀린 값(목록 밖 선택지·수량 99·글자 수량·모르는 키)도 그대로 돌려준다 |
| `POST /_fake/fail` | `{ kind, status?, delayMs?, text?, times? }` | 다음 `times`번(기본 1): `status`(그 HTTP 상태, 기본 500) · `not_json`(200, 본문 HTML) · `bad_shape`(모델 글이 JSON 아님) · `raw`(모델 글 = `text` 그대로) · `huge`(64KB 넘는 본문) · `slow`(`delayMs` 뒤 정상 답, 기본 20초 — 서버 시간 제한 시험) · `disconnect`(본문 도중 끊김) |
| `POST /_fake/reset` | | 받은 요청·정해 둔 답·넣은 실패를 지운다 |

- 같은 프로세스(서버 단위·적대 시험)에서는 `FakeLlm.start()` → `createServer({ assist: fake.setup({ dailyLimit?, globalLimit?, timeoutMs?, model? }) })`, `fake.answer(text, suggestion)`·`fake.failNext(fault, times)`·`fake.requests`·`fake.calls`·`fake.reset()`. 도우미는 `apps/server/test/a1-support.ts`(`assistWorld`·`shortsBroadcast`·`chat`·`enableAssist`·`suggest`·`reviews`·`byText`·`sentTexts`·`eventCount`).
- 동시·끄기 시험 주입점: `createServer({ assistHooks: { beforeCall } })` — 호출 기록 줄을 넣은 뒤 어댑터를 부르기 직전.
- 하루 상한의 날짜는 서버 시계(`clock`)의 KST 날짜다. E2E 기동에는 시계를 바꾸는 경로가 없다 — 자정 넘김은 서버 단위 시험(`a1-assist.test.ts` AC-A1-04)이 본다.
- 서버 시험은 실제 Anthropic 주소(`anthropic.com`과 하위 도메인)로 나가는 연결을 막고 시도가 있으면 그 파일을 실패시킨다(`apps/server/test/setup-assist-guard.ts`). 적대 시험은 `installOutboundGuard('assist', ['anthropic.com'])`(`apps/server/test/outbound-guard.ts`)를 쓸 수 있다.

### 연습 모드 (AC-A1-12)
- `pnpm try`가 가짜 LLM 서버를 연습 서버 안 경로 `/_try/llm`에 붙이고 가짜 키로 AI 제안을 켠다(조작 경로 없음, 운영 기동에는 없는 경로).
- 해 보는 법: 설정 → "AI 제안" → 동의하고 켜기 → 방송 시작에서 "상품명·옵션도 받기"로 리허설 → 상품 등록(예: 21 반바지, 사이즈 S/M[별칭 엠]/L) → 콘솔의 "시청자로 보내기"로 `반바지 엠사이즈` → 확인 필요 화면을 열면 "AI가 읽음" 제안. `반바지 미디엄`처럼 별칭과 한 글자 차이는 "비슷한 글자로 찾음".
- 리허설 가짜 채팅 생성기(O4)는 확인 필요 감 중 상품 이름만 쓴 댓글(`OPTION_MISSING`)이 먼저 뽑혀 `UNKNOWN_WORD`가 거의 안 나온다 — 생성기는 바꾸지 않았다(O4 결정성 시험·D-O4-01 그대로). 연습에서는 "시청자로 보내기"로 글을 넣는다.

### 스스로 정한 것 (스펙이 정하지 않은 세부)
- 끄면 `consentedAt`을 지운다(null) — "다시 켤 때 동의를 다시 받는다"를 저장 상태로도 분명히. 켤 때마다 새 동의 시각.
- 규칙 제안이 있는데 그 상품이 판매 중이 아니면(일시 중지 등) 제안 없음 — AI 캐시로 넘어가지 않는다("규칙 제안이 있으면 그것만").
- 응답 검사의 숫자는 **정수 글자 그대로**만 숫자로 본다(`JSON.parse` 원문 접근): `1e1`·`10.0`·`-0`은 같은 값이어도 그 항목 제안 없음(AC-A1-30 "수량 1e1").
- 응답의 `suggestions` 안에 객체가 아닌 값이 하나라도 있으면 형식 오류(모두 제안 없음)로 본다(골든에 없는 경우 — 더 엄격한 쪽).
- 실패한 호출 하나가 나오면 그 요청의 남은 방송은 부르지 않는다(대개 같은 원인 — 돈을 더 쓰지 않게).
- 가린 글이 200글자에서 잘릴 때 끝 공백은 그대로 둔다(R-20 10 순서: 공백 정리 → 앞 200글자).
- 서버 전체 상한·판매자 상한은 어드바이저리 락(`livejjim/assist-calls`) 안에서 세고 호출 기록 줄을 먼저 넣는다 — 서버 여럿이어도 넘지 않는다. 같은 판매자 동시 요청은 메모리 잠금으로 `BUSY`(서버 여럿이면 각 서버에서 하나씩 돌 수 있으나 상한은 DB가 지킨다).
- 캐시 키의 "범위"는 (범위 날짜, 리허설인지). 방송 ID는 서버 전체에서 유일하지만 판매자 ID도 함께 둔다.

### 사용자 확인 필요 (최종 보고에)
- 실제 Anthropic 키·결제 계정·콘솔 월 한도, 모델 ID(기본 `claude-haiku-4-5` — 백로그의 `claude-haiku-5-5`를 쓰려면 `LIVEJJIM_ASSIST_MODEL`), 구조화 출력 매개변수(`output_config.format`)가 실제 API에서 받아지는지 첫 실제 호출로 확인(실패하면 로그 `ASSIST_HTTP_ERROR status=400`), 하루 상한 값, 고지·개인정보처리방침 문장의 법률 확인.

### 실행·시험 명령
- 서버 단위(A1): `cd apps/server && npx vitest run test/a1-` (`a1-golden` 89사례 + 형식 검사·TZ, `a1-assist` AC-A1-02~11, `a1-docs` AC-A1-12).
- 기존 시험 중 바꾼 것: `test/commands.test.ts` 표 수 56 → 59(A1 표 셋 — 약화 아님, 주석에 이유).
