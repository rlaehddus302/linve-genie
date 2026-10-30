# YT-SRV test-notes (test-domain)

## 적대 하네스를 웹 읽기 길로 (CH-26)
- `tests/adversarial/y1/helpers.ts`: `world({ chat: 'web' })` — 가짜 유튜브 웹(127.0.0.1) + `bridgeFakeWeb` + 서버 설정 `youtube.webChat = { on: true, baseUrl }`(sibling 서버도 같은 설정). `close()`가 다리·가짜 웹을 닫고, 그 world가 사는 동안 실제 구글·유튜브 주소로 나가려다 막힌 요청(`blockedRequests`)이 하나라도 있으면 실패한다. 기본(`world()`)은 옛 공식 읽기 그대로 — 감사 게시를 단언하는 시험용(D-YT-SRV-13 대기).
- 도우미 더함: `webCalls(w, endpoint)`, `recordedChatIds(w)`, `pass(w, ms, step)`.

## 옮긴 시험 (옛 → 새)
- `y1/collector-attacks.test.ts` TD-Y1-006 ×2 → 웹 길. 뜻 그대로(끝낸 뒤 글 기록 0, 10분 뒤 FINISHED, 회차 끊은 뒤 기록 0) + 기록 목록을 정확히 비교. `fake.openStreams` 0 → "멈춘(끊은) 뒤 2분 동안 가짜 웹 poll 수가 늘지 않음".
- `y1/round1-attacks.test.ts` '수집기 — 다른 서버에서 유튜브 연결을 끊음'(TD-Y1-006) → 웹 길. **스펙이 뜻을 바꿈**: D-YT-SRV-10·YT-11 AC9 "구글 연결 상태는 수집을 멈추지 않는다" → 끊은 뒤 글이 한 번 기록되고 수집기 LIVE로 남는지 본다.
- `inv1/confirm-bypass.test.ts` TD-INV1-007·008(초대 방송·내 방송 판정 같음) → 웹 길(채팅은 가짜 구글 방송 liveChatId로 — 웹 잇기 회차의 live_chat_id는 빈 글). 기록 ID가 넣은 순서 그대로 한 번씩인지 더했다. 잇기 확인 우회(001~006)는 옛 잇기 길 그대로.
- 감사 게시 단언 시험(y1 outbox·seal·round1의 014~016 등)은 옛 길 그대로.

## 새 시험 (모두 통과 — 회귀)
- TD-YT-SRV-001: poll 응답 모양이 두 번 깨져 새 전체 채팅 지점(최근 80줄 다시 줌)으로 다시 붙어도 중복 0, 그 사이 글 순서대로 한 번.
- TD-YT-SRV-002: 수집하던 서버가 멈추고 다른 서버가 임대를 넘겨받아도 그 사이 글 빠짐·중복 없음.
- TD-YT-SRV-003: 판매자 사이 새지 않음 + 두 판매자가 같은 방송을 이으면 각 회차에 한 번씩, 잇기 전 글은 새로 이은 회차에 안 들어감.

## 지적
- 없음 (이번 라운드에 실패하는 공격 없음).

## 감사만 공식 API 합친 뒤 (D-YT-SRV-17, SPEC v0.1.73 YT-06 세부 (3))
- 실시간 채팅 게시 확인이 공식 조회(`liveChatMessages.list`) 대신 "수집기가 본 우리 글"로만 바뀌고, 못 보면 다시 게시 없이 UNCONFIRMED가 되어 `y1/outbox-attacks.test.ts` 둘이 스펙 변경으로 실패 → 스펙이 바꾼 것만 바꿨다(근거 주석은 시험 위).
- TD-Y1-003 → 둘로: (가) 웹 길 + 수집기가 묶음 글을 봄 → SENT·SENT, 같은 묶음 글 1개, insert 1번, 공식 조회 0, 게시 보고 2(효과마다). (나) 수집기 없음 → 두 행 FAILED(UNCONFIRMED), 다시 시도 시각을 넘겨도 insert 1번·글 1개, 공식 조회 0, 게시 보고 0.
- TD-Y1-007: 동의를 끈 뒤 게시 0·insert 1번이 핵심, 상태는 NO_CONSENT → UNCONFIRMED (다시 시도 길이 없어졌고 올라갔는지 모르는 행이라 "확인 필요"가 사실에 맞음 — 개발 쪽 AC-Y1-31과 같음). 공식 조회 0·게시 보고 0 더함.
- `tests/adversarial` 안에 공식 조회 확인을 기대하는 다른 시험은 없었다. 도우미 주석(웹 길은 감사가 안 올라감)을 D-YT-SRV-15 기준으로 고침.
- 결과: 파일 6개 시험 모두 통과. 지적 없음.
