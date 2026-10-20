# Y1 리포트 — 유튜브 서버 (계정 연결·채팅 수집·감사 발송함)

**결과: FAIL** — 수정 라운드 2회 뒤에도 `pnpm verify`의 test 단계에서 시간 측정 시험 2건이 실패했다. 병렬 트랙 부하 때문으로 보인다(GATE-Y1-VERIFY). 기능 지적 가운데 blocker는 없다.

- 작업 폴더: /Users/unhoyeo/livejjim-wt/y1 (브랜치 track/y1-youtube-server), BASE 942bc87, 스펙 커밋 2733002
- 개발: server / 테스트: domain / 라운드: 2

## 영역별로 만든 것 (server)

- **구글 연결 (AC-Y1-01~06)**: 연결 때는 readonly 권한만 받는다. PKCE S256과 세션에 묶인 state(10분, 한 번만, 해시로 저장)를 쓴다. 토큰은 마스터 키로 암호화한다. 갱신은 판매자마다 하나씩, 401이 오면 한 번 갱신하고 다시 시도한다. invalid_grant나 복호화 실패는 '다시 연결 필요'로 둔다. 판매자마다 채널 하나이고 한 채널은 한 판매자에만 연결된다. 연결을 끊으면 토큰 폐기·삭제, 동의 삭제, 수집기 즉시 중지를 한다. 라운드 1에서 다시 연결할 때 force-ssl을 함께 요청하도록 바꿨다.
- **방송 잇기 (10~13)**: 내 라이브 목록, 주소·ID에서 영상 ID 읽기, 잇기 조건, 요청 번호로 멱등인 잇기, 연결 끊기.
- **채팅 수집 (20~29)**: streamList(기본)·list 폴링(대체)·가짜 서버. 이어받기 지점은 커밋 뒤에만 저장한다. 잇기 전·끝낸 뒤 채팅과 우리가 게시한 감사는 기록하지 않는다. 이름을 정리하고, 지운 메시지·차단은 알림만 남긴다. DB 임대(20초)로 회차마다 수집기는 하나만 돈다. 2,000건(끊김 5번, 저장 직전 서버 죽음)·1만 건으로 시험했다. 라운드 1·2에서 기록 트랜잭션 안의 guard(`#stillCollecting`: 연결·CONNECTED·같은 채널)를 넣어, 다른 서버에서 끝내기·끊기를 해도 그 뒤 채팅을 저장하지 않는다.
- **발송함 (30~46)**: rehearsal=false로 고정한 조회 함수만 쓰고 코드 검사 시험으로 고정했다. 보내기 직전에 동의와 엔진 상태를 다시 읽는다(라운드 1에서 캐시 제거). 기한은 실시간 채팅 10분, 영상 댓글 24시간이다. 다시 시도는 2~32초 간격이다. 타임아웃이면 게시 여부를 먼저 확인한다. 게시에 성공하면 효과마다 effect.thanksSent를 기록한다. 수동 재전송, 실행기 둘 동시 실행, 묶음·200자 분할, 판매마다 댓글, 방송 후 요약 댓글을 넣었다.
- **할당량 (50~53)**: 실패한 호출도 포함해 모든 호출을 센다. 하루는 태평양 시간 자정에 바뀐다. 20% 미만이면 묶음, 5% 미만이면 게시를 멈추고 수집은 계속한다. 표시 API가 있다.
- **원문 30일 (60~62)**: chat_raw를 따로 둔다. 날짜 + 30일 0시(KST)에 장부 JSON으로 봉인하고 원문을 지운다. 봉인 뒤 쓰기는 409 SEALED다.
- **보안·시험 기반 (70~72, 80, 81, 90, 91)**: 로그에 토큰·본문·닉네임을 남기지 않는다. 운영 설정은 https만 받는다. 시험에서 실제 구글 주소로 나가면 실패한다. 127.0.0.1 가짜 구글·유튜브 서버를 두고 `--youtube fake`로 E2E에서 띄운다. 골든 합계는 22/385/121/506이다.

## 남은 blocker / major

| ID | 심각도 | 확신 | 내용 | 제안 |
|---|---|---|---|---|
| GATE-Y1-VERIFY | blocker | CONFIRMED | `E2E_PORT_OFFSET=300 pnpm verify`가 test 단계 2건에서 실패했다. adversarial(TD-Y1-006)은 dda19f6으로 고쳐져 통과한다. 다시 돌리면 실패하는 시험이 바뀌고, 단독 실행에서는 모두 통과한다. 병렬 트랙 부하(평균 10~23) 때문으로 보인다. | 다른 작업 폴더가 verify·e2e를 돌리지 않을 때 다시 돌린다. |
| SA-Y1-009 | major | PLAUSIBLE | apps/server/test/changes.test.ts:197 AC-S05-61 증분 조회 p99가 806ms였다(기준 300ms). 다시 돌렸을 때는 '덮으면 같다' 시험이 30초 시간 초과로 실패했다. Y1이 바꾼 시험은 아니다. | 부하 없이 통과하면 시험 기준을 부하에 강하게 바꾼다. 부하 없이도 실패하면 writer.ts·store.ts 봉인 확인이 조회를 늘렸는지 본다. |
| SA-Y1-010 | major | CONFIRMED | packages/core/test/unit/engine-timing.test.ts:85 AC-S03-05에서 시간 비율이 8.66으로 기준 8을 넘었다. D-901 보강 뒤에도 실패했다. Y1은 core/src를 바꾸지 않았다. | 오케스트레이터 몫: 중앙값 비율을 쓰거나 측정 하한을 키우거나, 시간 시험을 병렬 verify와 겹치지 않게 돌린다. |

## 자율 결정 · 사용자 확인 필요 사항

D-Y01~D-Y13은 모두 AUTO이고, 다음 단계를 막는 결정은 없다. 에스컬레이션도 없다.

| ID | 결정 |
|---|---|
| D-Y01 | 게시 실패는 발송함 상태로만 남기고 effect.failed는 쓰지 않는다. 성공하면 thanksSent를 쓴다. 요약은 서버 몫이고 라벨은 S08 몫이다. |
| D-Y02 | 연결 때는 readonly만 받고, 동의할 때 force-ssl을 더 받는다. PKCE·state를 쓰고, 판매자마다 채널 하나, 토큰은 암호화한다. (라운드 1 동작과 다르다. SA-Y1-008 참고) |
| D-Y03 | 내 채널의 진행 중·예정이고 채팅이 있는 방송만, 실제 회차에 1:1로 잇는다. |
| D-Y04 | ingestChat 경로를 쓰고 owner는 isChatOwner일 때만이다. 커밋 뒤에만 이어받기 지점을 저장한다. 잇기 전·끝낸 뒤 채팅과 우리 감사는 받지 않는다. streamList가 3번 실패하면 폴링으로 바꾼다. |
| D-Y05 | 수집 경로에서 이름을 정리한다(30자, @ 제거, 빈 이름은 '시청자'). |
| D-Y06 | 동의 전 효과는 자동으로 보내지 않는다. 기한은 10분·24시간, 다시 시도는 5번이다. 타임아웃이면 확인한 뒤 다시 보낸다. 실행기는 하나다. (SA-Y1-008 참고) |
| D-Y07 | 실시간 채팅만 묶고, 끝말은 한 번, 200자에서 판매 경계로 나눈다. |
| D-Y08 | 영상 댓글은 판매마다 하나, 요약은 끝내고 10분 뒤 한 번이다. |
| D-Y09 | 비용 표는 2026-10-20 기준이다. 남은 양 20%·5% 기준을 쓰고 수집은 계속한다. |
| D-Y10 | 지운 메시지·차단은 알림만 남긴다. |
| D-Y11 | 원문 30일 뒤 봉인하고, 그 뒤 쓰기는 409 SEALED다. |
| D-Y12 | 동의는 대상마다 따로이고 기본은 꺼짐이다. thanks.*와 동의가 둘 다 있어야 자동 게시한다. |
| D-Y13 | 127.0.0.1 가짜 구글·유튜브 서버로 시험하고, 화면 트랙(I3)도 같은 가짜를 쓴다. |

**사용자 확인 필요**
- 원문 30일 봉인 정책(D-Y11)의 법률 검토
- 실제 구글 OAuth 프로젝트 검증과 실제 테스트 방송(HG-3). HG-3 목록에 폴링 최소 간격(RA-Y1-005)을 더한다.
- 시간 시험 실패를 부하 탓으로 볼지 결정: 부하 없이 verify를 다시 돌린 결과로 판정한다.

## minor / nit 백로그 (backlog.yaml techDebt에 추가함)

| ID | 심각도 | 내용 | 위치 |
|---|---|---|---|
| SA-Y1-006 | minor | 서버 재시작 뒤 첫 판정·프로젝트 한도 감소로 할당량 모드가 바뀔 때 SSE가 나가지 않는다(AC-Y1-52). | quota.ts:88 |
| RA-Y1-003 | minor | 발송함이 connection.channelId와 link.channelId를 비교하지 않아, 채널을 바꾸면 남의 채팅에 감사를 올린다. | outbox.ts:459 |
| RA-Y1-004 | minor | findOwnMessage가 다른 행의 remote_id를 빼지 않아 같은 글의 감사를 빠뜨린다. | store.ts:334 |
| RA-Y1-005 | minor | 폴링·스트림을 다시 열 때 최소 간격이 없어 할당량을 다 쓸 수 있다. | collector.ts:419 |
| RA-Y1-006 | nit | VIDEO_IN_USE 검사가 읽은 뒤 넣기라 동시에 이으면 경합한다. | system.ts:320 |
| SA-Y1-008 | minor | 라운드 1 동작이 D-Y02·D-Y06·AC-Y1-36과 다르다. 스펙 문서를 지금 동작대로 고친다. | connect.ts:187 |
| RA-Y1-007 | minor | 다시 연결 중 동의를 다시 켜면 동의 시각이 덮여 기다리던 감사가 NO_CONSENT가 된다. | connect.ts:244 |
| RA-Y1-008 | minor | 이른 조회가 실패해도 CONFIRM_LISTED로 적혀 다시 게시할 수 있다(INV-11). | outbox.ts:734 |

## 추적성

| 수용 기준 | 구현 | 시험 |
|---|---|---|
| AC-Y1-01~06 | apps/server/src/youtube/connect.ts | youtube-connect.test.ts; adversarial/y1 round1-attacks(04·06), outbox-attacks(05) |
| AC-Y1-10~13 | youtube/system.ts:253,320 | youtube-link·youtube-texts·youtube-collector(12·13) |
| AC-Y1-20~29 | youtube/collector.ts (#handle 590, #stillCollecting 631~634, 폴링 419) | youtube-collector.test.ts(455~474 신규); adversarial collector-attacks, round1-attacks TD-Y1-006 |
| AC-Y1-30~46 | youtube/outbox.ts (#gate 459, #confirm 694~744) | youtube-outbox·youtube-texts; adversarial outbox-attacks, round1-attacks |
| AC-Y1-50~53 | youtube/quota.ts (#checkMode 84~89) | youtube-quota.test.ts (52의 첫 판정 SSE는 시험 없음) |
| AC-Y1-60~62 | youtube/seal*, store.ts scopeSealInfo·scopeSealedAt, writer.ts | youtube-seal·rehearsal·scope-seq; adversarial seal-attacks |
| AC-Y1-70~72 | log.ts, secrets.ts, youtube/* | youtube-security, setup-network-guard; adversarial isolation |
| AC-Y1-80~81 | youtube/fake*, commands/e2e-server.ts | youtube-fake, youtube-support |
| AC-Y1-90 | packages/core/test/golden/core-adapter.test.ts | verify golden 22·385·121·506 |
| AC-Y1-91 | apps/server/test/setup-network-guard.ts | youtube-security.test.ts |

## 다음 스프린트 제안

1. **Y1 재게이트(먼저)**: 다른 작업 폴더가 verify·e2e를 돌리지 않을 때 `E2E_PORT_OFFSET=300 pnpm verify`를 다시 돌린다. 통과하면 PASS로 올린다. 앞으로는 시간 시험이 들어간 verify를 병렬 트랙끼리 겹치지 않게 순서대로 돌린다.
2. **시간 시험 안정화(오케스트레이터)**: SA-Y1-009·010. 중앙값·반복 측정과 시간 초과 조정으로 부하에 덜 흔들리게 한다.
3. **Y1 후속 server 정리**: RA-Y1-003(다른 채널 게시)과 RA-Y1-008(두 번 게시 가능)이 외부에 보이는 위험이 가장 크니 먼저 한다. 그다음 RA-Y1-007·004·006, SA-Y1-006.
4. **spec-keeper**: SA-Y1-008에 따라 D-Y02·D-Y06·AC-Y1-36을 지금 동작대로 고친다.
5. **I3(화면)**: dev-notes의 가짜 서버 계약으로 시작한다. HG-3 확인 목록에 RA-Y1-005를 더한다.
