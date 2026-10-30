# YT-SRV dev-notes (dev-server)

YT-11(서버가 유튜브 채팅 읽기, D-YT-SRV-01~12) 서버 몫. 스펙 `origin/spec/yt-server-scrape` 5343fd11을 받아 맞췄다.

## 만든 것
- `apps/server/src/youtube/web-chat.ts` — 순수 함수(입출력 없음): 방송 페이지·채팅 페이지·`get_live_chat` 응답 읽기 (AC4).
- `apps/server/src/youtube/web-chat-source.ts` — 원천(ChatSource 모양): `WebTransport` 인터페이스 뒤에서 유튜브에 묻는다(AC7 — 맥 미니 일꾼은 이것만 갈아 끼움). 기본 `HttpWebTransport`(고정 사용자 에이전트, 쿠키 없음, 15초, 8MB).
- `collector.ts` 방식 `WEB`: 간격 `timeoutMs` 1~10초(없으면 5초), 실패 5·10·20·30초 / 막힘 30·60·120·300초, 끝은 공개 페이지로 한 번 더 확인, 모르는 모양·지점 거절은 새 전체 채팅 지점 + gap, 1분 창(읽은 0 + 모르는 종류·읽지 못함) → FORMAT, `#stillCollecting`·`#verdict`·`#changedSince`에서 구글 연결 조건을 뺐다(WEB 방식).
- `system.ts` 서버 잇기(구글 연결 없이), 처음 잇는 채널만 확인, 최근 채널 3개 찾기(`GET /api/youtube/live-broadcasts`), `/ops/status`의 `youtubeWebChat`.
- 끄기 `LIVEJJIM_YT_WEB_CHAT`(config `readYoutubeWebChat`), 경보 `YT_CHAT_BLOCKED`·`YT_CHAT_FORMAT`·`YT_CHAT_NETWORK`(판매자 정보 없음), 로그 `YT_CHAT_UNKNOWN_ITEM`(이름·수만), `YT_WEB_CHAT_INVALID`.
- 가짜 유튜브 웹 서버 `apps/server/src/youtube/fake-youtube-web.ts`, 녹화본 `apps/server/test/fixtures/youtube-web/`(가린 것만).

## 실제 붙기 측정 (2026-10-31, 공개 상시 라이브 1곳, 약 4분, 숫자만)
- 방송 페이지의 짧은 지점(44자)은 `get_live_chat`이 400 INVALID_ARGUMENT로 거절 → 채팅 페이지(`/live_chat?v=&is_popout=1`)의 "Live chat" 지점(552자)을 쓴다. 그 응답은 `liveChatCurrentFilter = LIVE_CHAT_FILTER_MODE_UNFILTERED`(Top chat은 `…_DEFAULT`).
- 24번 부름 모두 200, 막힘 0. 지점 종류는 모두 invalidation, `timeoutMs` 10000(다른 뉴스 방송 첫 응답은 3000) → 실제 간격 약 10.2초.
- 지연(메시지 timestampUsec → 받은 시각, 첫 응답 묶음 제외 69건): 최소 1.4초 · 중앙 5.9초 · 90% 9.8초 · 최대 11.6초.
- 본 종류: 일반 채팅, 선물(`giftMessageViewModel` — 작성자 채널 ID 없음, 기록 안 함), 시스템 글, 자리 표시, 지움(`removeChatItemAction`), 신고 상태 동작. 슈퍼챗·멤버십·주인·운영자 배지·작성자 글 모두 지움은 이번 붙기에서 못 봤다(본뜬 모양으로 시험).

## 스펙과 다르거나 스펙이 정하지 않은 곳 (판단 — spec-keeper 확인 요청)
1. **글 올리는 계정(`youtube_links.channel_id`)**: D-YT-SRV-03은 "구글 연결이 있을 때만 남는다"인데, 칸이 NOT NULL이고 발송함·확장 감사가 이 값으로 "이은 채널 = 연결한 채널"·초대 방송을 판단한다. 감사 쪽을 건드리지 않으려고(D-YT-SRV-13 대기) **구글 연결이 있으면 그 채널, 없으면 방송 채널**을 적었다 — 연결 없이 이은 남의 방송은 나중에 연결해도 "이은 채널과 다름"으로 감사를 올리지 않는다(안전 쪽). 확장 감사는 지금처럼 주인 배지로만 올린다.
2. **공식 채팅 ID(`live_chat_id`)는 빈 글**: 읽기·방송 확인에 공식 API를 부르지 않으므로(D-YT-SRV-01) 공식 `liveChatMessages.insert` 감사는 서버 잇기 회차에서 **올라가지 않는다**(발송함이 실패로 남김). D-YT-SRV-13 결정 뒤 그쪽에서 채운다 — 사용자 결정 대기 항목에 함께 올려 주세요.
3. 수집 중 방송이 비공개·멤버 전용·연령 제한으로 바뀌면 이유 `CHAT_NOT_FOUND`(판매자가 다시 시작). 스펙의 새 이유는 BLOCKED·FORMAT·OPERATOR_OFF뿐이라 새 이유를 만들지 않았다. 로그인 요구 화면 중 까닭을 모르는 것은 AC5대로 막힘.
4. 예정 방송 잇기는 공개 페이지(예정·채널)만 본다 — 시작 전에는 채팅 페이지가 없을 수 있어 전체 채팅 지점은 시작할 때 수집기가 본다(없으면 FORMAT/채팅 꺼짐).
5. 작성자 글 모두 지움의 알림: 영구/임시는 모름(`banType` null), 이름은 같은 응답에 그 작성자 글이 있으면 그 이름, 없으면 빈 이름(화면 "시청자").
6. 구글 연결 설정이 없는 서버도 유튜브 칸을 연다(`main.ts`가 늘 webChat을 넣는다). 구글 연결·게시 동의 경로는 503 `YOUTUBE_NOT_CONFIGURED`.
7. 옛 공식 읽기(STREAM·POLL)는 **설정에 webChat이 없을 때만** 돈다 — 가짜 구글로 도는 기존 시험 하네스(서버 Y1·I3·INV1·X1 시험, `tests/adversarial/y1`, `tests/e2e`, `src/e2e.ts` E2E 서버)를 깨지 않으려고 남겼다. 운영(`main.ts`)은 늘 webChat이라 공식 읽기를 부르지 않고, 이미 있던 STREAM·POLL 수집기는 다음 찾기에서 WEB으로 바꾼다(지점은 새로 — 받던 중이면 gap 표시).

## 바꾼 기존 시험 (스펙 변경을 따름)
- `apps/server/test/i3-deploy.test.ts`: 경보 코드 목록에 `YT_CHAT_*` 셋, `/ops/status` 키에 `youtubeWebChat` (YT-11 AC5). 다른 단언은 그대로.

## 화면(dev-web)에게 — 서버 계약
- `GET /api/youtube/connection` → `{ connection, webChat: { on } | null, oauth: boolean }`. `webChat`이 있으면 구글 연결 없이 잇기 칸(주소 붙여넣기 + 최근 채널)을 연다. `oauth: false`면 구글 연결 버튼 대신 안내.
- 잇기 `POST /api/broadcasts/:id/youtube`: 처음 잇는 채널이면 409 `INVITED_CONFIRM_NEEDED`(본문 `channel {id,title}`, 문장 "처음 잇는 채널이에요. 이 방송이 맞나요?") — 확인 방식(`confirmInvited: true`)은 INV1 그대로. 새 거절 코드 `YOUTUBE_NOT_PUBLIC`(로그인 없이 볼 수 있는 방송만…), `YOUTUBE_WEB_CHAT_OFF`(운영자 끔).
- `GET /api/youtube/live-broadcasts`(잇기 칸을 열 때·"다시 찾기"만): 최근 채널 3개의 지금·예정 방송, 항목에 `channelId`·`channelTitle`(바깥 글 — 이스케이프).
- 수집 상태: `RETRYING` + `reason` `BLOCKED`·`FORMAT`은 **바로** 경고(10초 기다리지 않음), `STOPPED` + `OPERATOR_OFF`(다시 시작 버튼 없음 — `restartable: false`). 다시 `LIVE`가 되면 "유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요."는 화면이 상태 전환으로 띄운다(서버에 저장한 표시는 없다).

## 시험 쪽(test-domain·test-e2e)에게
- 가짜 유튜브 웹 서버: `FakeYoutubeWeb`(같은 프로세스 메서드 조작만 — E2E용 `/_fake/*` JSON 조작 경로는 아직 없다). 서버 설정은 `youtube.webChat = { on: true, baseUrl: fake.url }` + `allowInsecure: true`.
- 적대·E2E 하네스는 아직 공식 읽기 길(webChat 없음)이다 — 옮기면 D-YT-SRV-10의 "구글 연결과 무관" 단언이 적대 시험에서도 돈다.

## 감사만 공식 API (D-YT-SRV-13·15·16·17, SPEC v0.1.73) — dev-server
- 위 "스펙과 다르거나…" 1·2번은 D-YT-SRV-16·15로 정해져 고쳤다: 서버 잇기는 구글 연결이 없으면 글 올리는 계정(`youtube_links.channel_id`)을 **비운다(null)** — 마이그레이션 0030이 NOT NULL을 풀었다(옛 기록 그대로). 공식 채팅 ID(`live_chat_id`)는 빈 글 그대로.
- 발송함 `#prepare`(게시 검사 뒤·올리기 바로 전, 행은 WAITING): 글 올리는 계정이 비면 그때 연결한 채널을 적고(비어 있을 때만), 실시간 채팅이고 채팅 ID가 비면 글 올리는 계정 토큰으로 `videos.list(part=liveStreamingDetails)` 한 번 → 비어 있을 때만 저장. 실패: 연결·시간 초과·5xx·429·속도 제한 → RETRY(2·4·8·16·32초, 넘으면 GAVE_UP), 토큰 못 씀 → RECONNECT, quotaExceeded → QUOTA(멈춤 표시), 권한 → NO_PERMISSION, 채널 다름 → NOT_MY_CHANNEL, 영상·activeLiveChatId 없음·그 밖의 거절 → REJECTED(저장 없음). 채팅 끝을 적지 않는다. 로그 코드는 기존 `YOUTUBE_API_FAILED`.
- 실시간 채팅 게시 확인: `liveChatMessages.list`를 부르지 않는다. 수집기가 그 회차에서 본 우리 글(`youtube_own_messages.link_id` = 회차, `author_channel_id` = 글 올리는 계정 또는 옛 행 null)로만 짝짓고, 확인 시간이 끝나면 UNCONFIRMED(다시 게시 없음). 같은 글을 게시하는 다른 묶음 때문에 미루면 10초 간격 3번까지. 영상·요약 댓글 확인 조회는 그대로.
- 우리 감사 거르기(수집기·확장 읽기): 작성자가 글 올리는 계정(있으면) 또는 방송 채널. 초대 방송 판단은 글 올리는 계정이 있을 때만. 확장 감사의 기대 채널은 이은 기록의 방송 채널.
- 바꾼 기존 시험(스펙 변경 D-YT-SRV-17 "기존 Y1·I3 확인 조회 시험은 실시간 채팅 몫을 이 규칙으로"): `test/youtube-outbox.test.ts`(AC-Y1-36 (가)(나)(마), AC-Y1-31 확인 중 동의 끔), `test/youtube-followup.test.ts`(AC-Y1-93 (가)~(라), AC-Y1-96 (가)(라)(바)), `test/youtube-i3-followup.test.ts`(AC-I3-86 (가)(나)·(라) 도우미 인자, RA-I3-001 회귀 둘, AC-I3-87 LIVE_CHAT 지연 둘 → 조회 0·UNCONFIRMED 하나). 실시간 채팅에서 "못 찾음 → 다시 게시"였던 기대는 UNCONFIRMED·게시 1번으로, 조회 횟수 기대는 0으로. 새 시험 `test/youtube-web-thanks.test.ts`.
- 화면(dev-web)에게: `GET/POST /api/broadcasts/:id/youtube`의 `link.channelId`가 **null**일 수 있다(연결 없이 이음). `invited`는 서버 판단을 쓰면 된다.
- 시험 쪽에게: `tests/adversarial/y1`·`tests/e2e/i3/youtube.spec.ts` 중 실시간 채팅 확인 조회(`liveChatMessages.list`)·확인 실패 뒤 다시 게시를 기대하는 것은 D-YT-SRV-17로 바뀐다(남의 몫 — 고치지 않았다).
