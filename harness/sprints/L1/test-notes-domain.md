# L1 test-domain 노트 (라운드 0)

## 실행
- `npx vitest run -c vitest.adversarial.config.ts tests/adversarial/l1/` (단계: `pnpm adversarial`)
- 파일: `tests/adversarial/l1/helpers.ts`(가짜 OAuth + PGlite 서버, 실제 공급자 주소 차단), `social-attacks.test.ts`(AC-L1-31 묶음 전부), `unlink-race.test.ts`(TD-L1-001).

## AC-L1-31 덮은 것 (모두 통과 — 회귀 시험으로 남김)
- 같은 이메일 합치기 없음(공급자마다·공급자 바꿔 같은 이메일·같은 숫자 ID)
- 테넌트 격리(B의 목록·끊기·숨은 항목, A 공급자 세션으로 B 방송 404, A의 연결 state → B 브라우저 EXPIRED/SESSION_GONE)
- 빼앗기 없음(LINKED_ELSEWHERE, 네 판매자 동시 연결 하나만, 한 판매자 두 계정 동시 → ALREADY_LINKED)
- 로그인 CSRF·연결 CSRF(쿠키 없음·다른 쿠키, Origin 다름·없음·null, 폼·text/plain 본문)
- state 동시 사용(로그인·연결 20번 → 하나, 교환 한 번)
- 열린 리디렉션(next·redirect·return_to·redirect_uri·login·provider 주입 + Host·X-Forwarded-Host·Forwarded)
- 보조자(403, 손상된 연결 행으로 세션 없음)
- 꺼진 공급자(404, 남은 연결 끊기만 200, 공급자 0개면 /api/auth/** 404)
- 결과 문장 주입(주소 글이 Location·본문에 없음)
- 공급자 계정 ID 모양 밖·255자 경계, 가린 이름의 제어·방향·HTML·긴 글
- 끊기(동시 10번 하나만, 비밀번호 없는 계정 동시 끊기 → 하나는 409)
- 운영 서버에 /_try/oauth·/_fake 경로 없음
- 비밀 누출: 위 흐름 + 실패 8종 뒤 로그·DB·응답 전체

## 찾은 것
- TD-L1-001 (major): 끊기와 겹친 간편 로그인이 끊은 공급자의 세션을 남긴다 — `unlink-race.test.ts` 실패 시험.
