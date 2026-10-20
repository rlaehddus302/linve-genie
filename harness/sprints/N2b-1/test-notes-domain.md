# N2b-1 test-domain 노트 (라운드 0)

## 공격한 것
- 연결 객체 무작위 조작(fast-check, 500열 · 열마다 5~60 조작): start·stop·시계(1ms~5분)·붙잡기·실패 넣기·지금/이전 손잡이의 성공·실패·끊김·방송 끝·댓글(새 ID·같은 ID)·error 이벤트·동의 허용/거절/끝나지 않음/예외.
  불변식: 동시에 열린 연결 ≤ 1, 열린 연결 ⇔ CONNECTED, 문장 표 그대로, nextAttemptAt은 RETRYING일 때만, 멈춘 상태에 남은 타이머 0, 상태 알림은 바뀔 때만, 지금 연결의 새 댓글은 빠짐없이 한 번, 그 밖의 댓글은 0, stop() 뒤 레코드 0, failures ≤ 9, 처리되지 않은 거부 0.
  → 모두 통과(회귀로 남김: `tests/adversarial/n2b1/connection-random.test.ts`).
- 아이디·주소 해석: 닮은 호스트·사용자 정보·포트·`\`·`%2F`·언어 경로·전각 공백·제로폭 글자·두 개 붙인 주소 → 규칙대로(INVALID/SHORT_LINK). 버그 없음.
- 라이브러리 2.1.0 실제 실패 모양(설치된 dist 코드 읽기): 웹소켓 손잡기 실패는 오류 객체가 아니라 문자열로 거부된다 → **TD-N2b-1-001**.
- 라이브러리 방송 끝 처리: `CONTROL_ACTION_STREAM_SUSPENDED`(4, 일시 중단)도 `streamEnd`로 내보내고 스스로 끊는다 → 스펙 확인 필요(TD-N2b-1-002).
- 웹소켓이 조용히 멈춘 경우(닫힘 없음) 감지 없음 → 스펙 확인 필요(TD-N2b-1-003).

## 남긴 실패 테스트
- `tests/adversarial/n2b1/failure-kinds.test.ts` — TD-N2b-1-001 (웹소켓 403·429 → BLOCKED, 실제 감싸개 경로 포함). 같은 파일에 문자열 NETWORK 회귀(응답 없음·500·DNS 실패·빈 값).

## 참고
- `tests/adversarial`는 `apps/server` vitest 설정 밖이라 바깥 연결 막기 준비 파일이 깔리지 않는다. 이 폴더의 두 파일은 `installOutboundGuard('tiktok', …)`를 직접 깔고 막힌 시도 0을 확인한다.

# 라운드 2

## 다시 공격한 것
- TD-N2b-1-004 고침(02a5d16) 확인: 응답 본문 메시지(`Invalid response from API: …`)에 라이브러리 정답 모양 그대로(`API Error 19881007 (user_not_found)`)·`captcha`·`blocked by TikTok`·`Unexpected server response: 403`을 심어도 NETWORK. 실제 감싸개 경로에서 RETRYING/NETWORK, 5초 뒤 다시 시도. 진짜 없는 사용자는 STOPPED/USER_NOT_FOUND, 1시간 동안 시도 1번 → **해결**(회귀로 남김: `failure-text-injection.test.ts` 라운드 2 블록).
- 라이브러리 2.1.0의 다른 오류 문구에 사용자 자료가 섞이는 곳을 찾음: `fetch-room-info`의 `Failed to fetch room info. ${err.message}`(axios 오류 문구뿐), Euler `response.message`(서명 서비스 문구), SIGI_STATE 오류(고정 문구). 방송자가 쓴 글이 실리는 곳은 `Invalid response from API:` 하나였다 → 새 구멍 없음.
- TD-N2b-1-003(조용히 멈춘 웹소켓)·TD-N2b-1-005(라이브러리 20초 시간 초과 뒤 늦게 열린 웹소켓): DECISIONS에 결정이 아직 없어 그대로 남김(스펙 확인 필요).
