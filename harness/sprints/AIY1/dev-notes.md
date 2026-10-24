# AIY1 개발 인계

## server (dev-server)

- 거르기 (D-AIY1-01·02): `apps/server/src/assist/rules.ts` `isYoutubeSource(source)` — `other`·`rehearsal`만 false, `youtube`·`extension`·null·빈 값·모르는 값은 true. `planAssist` 항목 키 `youtube?: boolean`(없으면 false)이 true면 같은 글 묶기·묶음 수보다 먼저 빠진다(골든 G-AST-A1-314~317).
- 출처 읽기: `apps/server/src/store.ts` `chatSourcesAt(db, sellerId, scopeId, seqs)` — DB `events.chat_source`(판매자 ID 조건). 요청 본문은 그대로 `rehearsal`·`broadcast`만(`UNKNOWN_FIELD`).
- `assist/service.ts`: `AttachItem.youtube`(필수), `youtubeLine(origin, source)`, `excludedOf(item)`. `#runBroadcast`는 유튜브 줄을 가리지도·해시하지도 않고, plan에 글도 넘기지 않는다. 보낼 것이 없으면 켬 다시 읽기·`#reserve`(상한)보다 먼저 `'none'` → 유튜브 줄만이면 상한에 닿아도 `DONE`·`called: 0`. 고른 목록에 유튜브 줄이 있으면 부르지 않는 마지막 안전장치도 `#reserve` 앞.
- `attach`: 유튜브 줄은 AI 캐시를 찾지 않는다(규칙 제안 `RULE` 또는 null). 캐시 행은 지우지 않는다.
- 로그: 새 코드 `ASSIST_EXCLUDED` { level: info, code, seller, count } — 방송마다 AI 대상이었을 유튜브 줄(사유 둘·규칙 제안 없음·글 있음) 수. AI 제안 받기(켜짐·키 있음)에서만 남는다.
- 시험: `apps/server/test/aiy1-youtube.test.ts`(AC-AIY1-01~09, 18개). `a1-support.ts`의 `chat()`은 이제 인스타그램 댓글 경로(`ingestOpenChat`, 출처 other)로 넣는다 — A1 시험·`tests/adversarial/a1`이 같은 뜻으로 그대로 통과. 유튜브 줄은 새 `youtubeChat()`(ingestChat, 실제 범위면 youtube·리허설이면 rehearsal). 골든 러너 사례 수 112.
- `docs/DEPLOY.md` 4-5에 한 줄(AC-AIY1-10).

## 화면에게 (MOB1 뒤 web 후속 — 계약)

- `GET /api/reviews` 항목마다 새 키 **`excluded`**: `'YOUTUBE_POLICY'` | `null`. 기존 키·순서·항목 수 그대로(맨 끝에 붙음, `suggestion` 다음).
  - `'YOUTUBE_POLICY'` = 채팅 항목이고 유튜브에서 온 줄(공식 연결·크롬 확장·출처 모름). 이 줄의 `suggestion`은 `source: 'RULE'`이거나 `null` — `'AI'`는 오지 않는다.
  - `null` = 문자찜 항목, 인스타·틱톡·붙여넣기 채팅, 리허설 채팅.
  - 값은 AI 설정(켜짐·꺼짐·키 없음)·사유·규칙 제안과 상관없이 같다. 언제 보일지는 화면이 정한다(D-AIY1-05 ①: AI 제안이 켜져 있고 `excluded: 'YOUTUBE_POLICY'` 항목이 하나라도 보이면 목록 위에 "유튜브 채팅은 AI에 보내지 않아요. 규칙 제안만 보여 드려요." — 꺼짐·키 없음이면 안 보임).
- `POST /api/assist/suggest` 응답 `{ result, called }` 그대로. 유튜브 줄만 있으면 `{ result: 'DONE', called: 0 }`.
- 설정 고지 문장(②)·`/privacy` 한 줄(③)은 D-AIY1-05 문장 그대로.

## 시험에게 (test-domain, 선택)

- 공격 거리: `events.chat_source`를 null·빈 값·대소문자 바꾼 값(`YouTube`, `OTHER`)으로 둔 줄 → 모두 유튜브 줄로 취급(정확히 `other`·`rehearsal`만 보냄). 백업 복구는 실제 범위 채팅을 `youtube`로 적는다(`backup.ts`) → 복구 뒤엔 보내지 않음.
- 요청 본문에 `source`·`includeYoutube`·`items` → 400 `UNKNOWN_FIELD`.
