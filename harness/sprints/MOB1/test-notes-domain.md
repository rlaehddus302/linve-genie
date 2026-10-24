# MOB1 test-notes — domain

## 만든 시험 (`tests/adversarial/mob1/`)
- `helpers.ts` — 서버 시험 `apps/server/test/mob1-try-relay.test.ts`의 구성(가짜 구글 + 서버 + 자체 서명 https + `createPhoneRelay`)을 복사하고 공격 도구를 더함:
  요청 줄을 글자 그대로 보내는 `raw()`, 미끼 서버(다른 곳으로 나가면 여기 닿음), TCP 연결 기록(`net.Socket.prototype.connect` — 허용 포트 밖이면 잡힘, 기록이 비어 통과하지 않게 꼭 지나야 할 포트도 확인).
- `try-relay.test.ts` (AC-MOB1-09)
  - 연습 전용 가짜 구글 경로: 조작 경로 23개 × GET/POST/HEAD/OPTIONS, Host 바꾸기 4개, 무작위 조각 대상 600개 → 404(또는 Node 요청 줄 거부 400)이거나 가짜 구글의 같은 승인 경로. 미끼 0, 허용 밖 연결 0, 가짜 구글에 닿은 수 = 허락한 대상 수. 통과.
  - `fakeGoogleTarget` 무작위 2,000개, `swapOrigin`·`relayAuthorizeUrl` 무작위 1,000개씩(출처는 원래 또는 휴대폰 주소), 실제 승인 주소 300개 왕복. 통과.
  - 진짜 구글: 시작 요청 1,000번(본문·머리글·청크·쿠키·쿼리 무작위) → 모두 409, 안쪽 서버 연결 시작 0, 휴대폰 포트 밖 연결 0. 통과.
  - **TD-MOB1-001 (실패 시험)**: 안쪽 서버(Hono, URL 정규화·퍼센트 해석)가 연결 시작으로 읽는 다른 모양의 경로
    `/api/youtube/connection/./start`·`/api/youtube/x/../connection/start`·`/api/youtube/connection/%73tart`·`/api/youtube/connection/%2e/start`·절대 주소 `http://localhost:<포트>/api/youtube/connection/start`(+ 요청 줄 `#x`)는
    `authorizeRoute`가 글자 그대로 비교해서 놓친다 → 그대로 넘겨 200 `authorizeUrl: https://accounts.google.com/...`이 휴대폰에 간다. 같은 계열: 동의(`PUT /api/youtube/consent`)·다시 보내기도 같은 경로 모양이면 승인 주소가 걸러지지 않고, 가짜 구글 모드에서는 승인 주소가 바뀌지 않는다.
    고칠 곳: `scripts/try/phone-relay.mjs` `authorizeRoute` — 안쪽 서버와 같은 방식으로 경로를 읽어 판정(예: `new URL(target, 'http://x')` 의 pathname을 퍼센트 해석한 값, 절대 주소면 그 pathname)하거나, 진짜 구글 모드에서는 `/api/youtube/` 아래 응답에 맨 위 `authorizeUrl`이 있으면 경로와 상관없이 409.
- `device-names.test.ts` (AC-MOB1-89, jsdom)
  - 위험한 이름 12개(`<script>`·`<img onerror>`·`&lt;`·RTL·아랍 글자·이모지 등, 다듬은 뒤 1~20자) → `AlertStrip` 맨 앞 항목·`PackingPrintResult` 안내에 HTML 요소 0, 문장 글자 그대로. 통과.
  - `defaultDeviceName` 사용자 에이전트 1,000개 × 출력 기기 이름(같음·공백/제로폭 섞인 같음·" 2"·다름·없음) → 네 이름 또는 " 2", 1~20자, `cleanDeviceName` 그대로, 출력 기기 이름과 늘 다름. 통과.

## 돌린 것
- `pnpm exec vitest run --config vitest.adversarial.config.ts tests/adversarial/mob1/` → 12개 중 11 통과, 1 실패(TD-MOB1-001, 의도). 전체 verify는 돌리지 않음(부하 규칙).
- `tsc -p tsconfig.json`·`eslint tests/adversarial/mob1` 깨끗.

## 참고 (시험으로 남기지 않음)
- 가짜 구글 경로는 `redirect_uri`를 검사하지 않아(가짜 구글이 등록 주소와 대조하지 않음) `https://<휴대폰>/_try/google/o/oauth2/v2/auth?client_id=<공개 값>&redirect_uri=https://아무곳/` 이 아무 곳으로 돌려보낸다(연습 모드 열린 돌려보내기). 중계 자체가 바깥으로 요청하지는 않는다.
- 중계가 위쪽 응답의 hop-by-hop 머리글(`connection: keep-alive`)을 그대로 옮긴다 — 클라이언트가 `connection: close`를 보내도 연결이 keep-alive 시간만큼 남는다. 브라우저 동작에는 영향 없음.
