# AIY1 수용 기준 — 유튜브 채팅은 AI로 보내지 않음

- 스프린트: AIY1 (worktree `aiy1` · 브랜치 `track/aiy1-ai-youtube` · BASE `a5ffd7b6`) · spec ID: **CMT-06** (연결: DAT-06 개인정보, YT-10 크롬 확장, SPEC §7 화면 15) · 규칙: DOMAIN_RULES **R-20 10** "유튜브 채팅은 보내지 않는다" · 근거 결정: **D-AIY1-01~D-AIY1-07** (A1 결정 D-A1-02~06 위에)
- 계기: 출시 서류 조사(`docs/launch/GOOGLE-OAUTH-VERIFICATION.md`·`PRIVACY-POLICY-GAPS.md`) — AI 제안을 켜면 유튜브 API로 받은 채팅 글이 Anthropic(미국)으로 갈 수 있어 유튜브 API 서비스 개발자 정책·구글 앱 확인 심사에서 문제가 된다.
- 개발 영역: **server**만 (`apps/server/**`, `docs/DEPLOY.md`). **`apps/server/src/youtube/**`는 고치지 않는다**(금지 경로) — 거르기는 `apps/server/src/assist/**`·`reviews.ts`·`store.ts`의 조회에서 한다. `apps/web/**`는 MOB1이 고치는 중이라 손대지 않는다. 테스트: **domain**(`tests/adversarial/aiy1/**`, 선택). E2E 없음(화면 변화 없음).
- 출처의 정의 (D-AIY1-01): 채팅 이벤트의 `events.chat_source`가 `youtube`·`extension`이거나 빈 값·모르는 값이면 **유튜브 줄**. `other`(인스타·틱톡·붙여넣기)·`rehearsal`만 AI로 보낼 수 있다.
- 공통 전제: A1 수용 기준(AC-A1-*)과 골든 `assist/*.json` 기존 108사례는 그대로 통과한다(출처가 `other`·`rehearsal`인 줄의 동작은 바뀌지 않는다). 키가 없거나 꺼진 서버는 지금과 똑같다(외부 호출 0번).

## 수용 기준

### AC-AIY1-01 [server] 유튜브 줄만 있는 방송은 부르지 않는다 — CMT-06, D-AIY1-01·03 · 확인: 서버 시험(가짜 LLM)
- Given AI 제안 켜짐·키 있음, 한 방송의 확인 필요 항목(사유 `UNKNOWN_WORD`·`PRODUCT_AMBIGUOUS`, 규칙 제안 없음)이 모두 출처 `youtube` 또는 `extension`
- When `POST /api/assist/suggest`
- Then 가짜 LLM 서버의 호출 수 0, 응답 `{ result: 'DONE', called: 0 }`, `assist_calls`에 새 줄 없음(설정의 `usedToday` 그대로), `assist_cache`에 새 줄 없음.

### AC-AIY1-02 [server] 섞인 묶음은 유튜브 줄만 빼고 보낸다 — CMT-06, D-AIY1-01·03 · 확인: 서버 시험(가짜 LLM)
- Given 한 방송에 출처 `youtube` 줄 A, `extension` 줄 B, `other`(인스타·틱톡처럼) 줄 C, `rehearsal` 범위가 아닌 같은 방송의 `other` 줄 D (모두 AI 대상 사유·규칙 제안 없음, 서로 다른 글)
- When AI 제안 받기
- Then 가짜 LLM이 받은 요청은 1개, 그 본문의 항목은 C·D의 가린 글뿐이고 id는 `"1"`·`"2"`(남은 줄로 다시 매김). 요청 본문 어디에도 A·B의 글(원문·가린 글)이 없다. `assist_calls`에 1줄, 그 `items` = 2. 응답 `{ result: 'DONE', called: 1 }`.
- 그 뒤 목록에서 C·D는 AI 제안(`source: 'AI'`)이 보일 수 있고, A·B는 규칙 제안이 있으면 `RULE`, 없으면 `suggestion: null`.
- 리허설 범위에서 출처 `rehearsal` 줄은 A1과 같이 보낸다.

### AC-AIY1-03 [server] 출처를 모르는 줄도 보내지 않는다 — D-AIY1-01·02 · 확인: 서버 시험
- Given 채팅 이벤트의 `chat_source`가 `null` 또는 정의 밖 값인 확인 필요 줄 (DB에 직접 넣은 시험 행), 또는 백업 복구로 `youtube`로 적힌 실제 범위 채팅
- When AI 제안 받기
- Then 그 줄은 요청에 없고(AC-AIY1-01·02와 같은 결과), 목록 응답의 그 항목 `excluded`는 `'YOUTUBE_POLICY'`.

### AC-AIY1-04 [server] 화면 요청을 믿지 않는다 — D-AIY1-02 · 확인: 서버 시험
- `POST /api/assist/suggest` 본문에 `rehearsal`·`broadcast` 밖의 칸(예: `source`, `includeYoutube`, `items`)이 있으면 400 `UNKNOWN_FIELD`, 가짜 LLM 호출 0, `assist_calls` 그대로 (A1 동작 유지 확인).
- 거르기는 서버가 DB의 `chat_source`로 하고, 하루 상한 세기·호출 기록 줄 넣기(`#reserve`)와 켬 다시 읽기보다 **먼저**다: 유튜브 줄만 있는 방송은 상한에 닿은 판매자여도 `LIMIT`가 아니라 `DONE`·`called: 0`(보낼 것이 없음 — A1의 "보낼 것이 없으면 DONE"과 같음).
- 서버 시험 하나가 `hooks.beforeCall`(또는 가짜 LLM 기록)로 보내는 순간의 항목 목록을 확인해, 유튜브 줄이 어댑터에 넘겨진 적이 없음을 단언한다.

### AC-AIY1-05 [server] 계량·묶음·같은 글 — D-AIY1-03 · 확인: 골든 + 서버 시험
- 골든 `tests/golden/assist/plan.json` G-AST-A1-314~317 통과: 항목 선택 키 `youtube`(없으면 `false`)가 `true`면 보내지 않고, 묶음 수(`batchMax`)·같은 글 묶기의 자리를 차지하지 않는다. 골든 러너 `apps/server/test/a1-golden.test.ts`는 `plan` 항목 키 `youtube`(boolean)를 받고, 사례 수 고정값을 **108 → 112**로 바꾼다(기존 사례 삭제·약화 금지).
- 서버 시험: 유튜브 줄 21개 + 인스타 줄 1개인 방송에서(배치 20) 인스타 줄 1개가 첫 호출로 보내진다(유튜브 줄이 묶음을 채우지 않는다). 같은 가린 글·같은 번호의 유튜브 줄과 인스타 줄이 있으면 인스타 줄이 보내진다.
- 서버 시험: 유튜브 줄만 있는 방송과 인스타 줄이 있는 방송이 한 범위에 있으면 호출 1번, 오늘 사용량 +1.

### AC-AIY1-06 [server] 유튜브 줄엔 AI 캐시 제안을 보이지 않는다 — D-AIY1-04 · 확인: 서버 시험
- Given `assist_cache`에 (같은 판매자·범위·방송, 그 유튜브 줄의 가린 글 해시, 같은 읽은 번호)의 제안이 있음 (AIY1 전에 생긴 것, 또는 같은 글의 인스타 줄로 생긴 것)
- When 확인 필요 목록 조회 (`attach`)
- Then 유튜브 줄의 `suggestion`은 규칙 제안이 있으면 `source: 'RULE'`, 없으면 `null` — `source: 'AI'`는 없다. 같은 글의 인스타 줄은 그 캐시 제안을 `source: 'AI'`로 보인다. 캐시 행은 지워지지 않는다.

### AC-AIY1-07 [server] 목록 응답의 이유 코드 — D-AIY1-04 · 확인: 서버 시험
- 확인 필요 목록 응답의 항목마다 키 `excluded`를 더한다(기존 키·순서·항목 수 그대로): 채팅 항목이고 유튜브 줄(AC-AIY1-03 정의 포함)이면 `'YOUTUBE_POLICY'`, 아니면 `null`(문자찜 항목·`other`·`rehearsal` 출처 채팅).
- 값은 AI 설정(켜짐·꺼짐·키 없음)·사유·규칙 제안 유무와 상관없이 같다.
- `POST /api/assist/suggest` 응답 모양 `{ result, called }`는 그대로.
- 계약(키 이름·값)을 `harness/sprints/AIY1/dev-notes.md` "화면에게"에 적는다 — MOB1 뒤 web 후속이 이것만 보고 문장을 붙인다.

### AC-AIY1-08 [server] 로그·기록에 원문이 없다 — D-AIY1-06, DAT-06 · 확인: 서버 시험
- AC-AIY1-01·02 시나리오의 로그 싱크에 모인 줄 전부에 유튜브 줄의 원문·가린 글·닉네임·채널 ID·메시지 ID가 들어 있지 않다(문자열 포함 검사). 남긴다면 코드 `ASSIST_EXCLUDED`·판매자 ID·개수(정수)만.
- `assist_calls`·`assist_cache`의 어느 칸에도 유튜브 줄의 글이 없다(캐시 새 줄 자체가 생기지 않는다 — AC-AIY1-01·02).

### AC-AIY1-09 [server] 인스타·틱톡·리허설은 그대로 — CMT-06, D-AIY1-01 · 확인: 기존 서버 시험·E2E
- A1 서버 시험(AC-A1-*)과 E2E `tests/e2e/a1/**`가 그대로 통과한다 — 리허설·`other` 출처 줄은 A1처럼 보낸다. 문자찜 항목은 지금처럼 제안 대상이 아니다.
- 키가 없는 서버·AI 꺼짐은 지금과 같다(외부 호출 0번).

### AC-AIY1-10 [server] 운영 문서 한 줄 — D-AIY1-01 · 확인: 수동(문서)
- `docs/DEPLOY.md` 4-5(AI 제안)에 "유튜브에서 받은 채팅(공식 연결·크롬 확장)은 AI로 보내지 않는다 — 규칙 제안만" 한 줄.

## 하지 않는 것 (범위 밖)

- **화면 문장** "유튜브 채팅은 AI에 보내지 않아요. 규칙 제안만 보여 드려요."(D-AIY1-05 ①), 설정 고지 문장 변경(②), `/privacy` 줄(③) — MOB1 뒤 web 후속(carryOver). 이번엔 서버 응답의 `excluded` 코드까지만.
- `docs/launch/**` 출시 서류 고치기 — 오케스트레이터 몫(spec-keeper·dev 경로 밖).
- 인스타그램·틱톡 정책 판단과 그 거르기 — "사용자 확인 필요" 표(AI 제안 — 플랫폼별 정책). 막기로 하면 같은 방식(출처로 거름)으로 다음 스프린트.
- 기존 `assist_cache` 행 지우기, 이미 켠 판매자에게 다시 동의 받기(D-AIY1-04·05).
- `apps/server/src/youtube/**`·크롬 확장 코드·`packages/core` 변경. 채팅 기록 출처(`chat_source`) 값 정하는 규칙 변경.
- 유튜브 줄에 대한 다른 AI 대체 경로(다른 모델·로컬 모델).
