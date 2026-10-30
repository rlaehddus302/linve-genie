# INV1 dev-notes

## server (dev-server)

### 잇기 API (화면·E2E에게)

`POST /api/broadcasts/:id/youtube` 본문 `{ requestId, video, confirmInvited? }`

- `confirmInvited`: JSON 불리언만 받는다(D-INV1-02). `true`만 확인이다. 빠졌거나 `false`이면 확인이 아니다. `"true"`·`1`·`{}`·`null`은 400 `INVALID_INPUT`이고 `problems[0].field = 'confirmInvited'`이다.
- 영상의 채널이 내 채널과 다르고 확인이 없을 때: **409**를 준다. 잇기 기록·수집기는 만들지 않는다.
  ```json
  { "channel": { "id": "UC…", "title": "다육이유튜버" },
    "error": { "code": "INVITED_CONFIRM_NEEDED", "message": "내 채널 방송이 아니에요. 초대받은 방송이 맞나요?" } }
  ```
  - `channel.title`은 바깥 글이다. 비어 있으면 `''`로 온다. 화면이 "(이름 없음)"으로 바꾸고 글자로만 넣는다(D-INV1-03).
  - 화면은 [맞아요, 잇기]를 누르면 **같은 본문에 `confirmInvited: true`만 더해** 다시 보낸다. 같은 `requestId`를 그대로 써도 된다. 확인 전 요청은 아무것도 남기지 않기 때문이다.
  - 서버는 확인 요청을 받을 때마다 영상을 다시 조회한다. 그사이 채팅이 꺼졌으면 `NO_LIVE_CHAT`이고, 그사이 채널이 내 채널이 됐으면 그냥 내 방송으로 잇는다.
- 성공 응답과 `GET /api/broadcasts/:id/youtube`의 `link`에 다음 칸이 더해졌다.
  - `broadcastChannelId`: 방송 채널(영상의 채널)
  - `broadcastChannelTitle`: 방송 채널 이름. 옛 기록이면 `null`
  - `invited`: 초대 방송 여부(boolean). 방송 채널 ≠ 글 올리는 계정
  - `channelId`는 그대로 "글 올리는 계정"(이을 때 연결돼 있던 내 채널)이다.
  - 콘솔 한 줄 "초대받은 방송 · {이름}"은 `invited === true`일 때만 띄운다.
- 옛 잇기 오류 `NOT_MY_CHANNEL`("내 채널의 방송만 연결할 수 있어요.")은 잇기에서 더 나가지 않는다(D-INV1-04). 발송함 실패 이유 `NOT_MY_CHANNEL`은 그대로다.

### 자율 결정(dev 수준, 스펙 범위 안)

- **보이지 않는 영상**(videos.list 404 또는 결과 없음): 예전에는 `NOT_MY_CHANNEL`을 줬다. 이제는 `409 NO_LIVE_CHAT`("채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.")을 준다. 옛 문장은 쓰지 말라는 결정(D-INV1-04)을 따랐다. D-PHN-17의 받는 조건 "사장님 계정으로 영상이 보이고"가 깨진 경우를 가장 가까운 기존 문장으로 알린다.
- **받는 조건을 보는 순서**: 진행 중·예정이고 채팅 ID가 있는지를 채널 판단보다 **먼저** 본다. 그래서 채팅이 꺼진 남의 방송은 확인 줄 없이 바로 `NO_LIVE_CHAT`이 된다. 확인을 받아 놓고 결국 잇지 못하는 헛걸음을 막기 위해서다.
- **확장**: 초대 방송 회차(이은 기록의 방송 채널 ≠ 글 올리는 계정)에서는 다음과 같이 한다.
  - `route()`가 null을 준다. 그래서 자동·수동 다시 보내기 모두 확장에 맡기지 않는다. 공식으로 올릴 수 없으면 지금의 공식 실패 이유가 남는다.
  - `/ext/thanks/take`는 `NONE`(afterMs 60초)을 준다. 주인 확인 경고(`OWNER`)는 적지도 보여 주지도 않는다.
  - 방송자 배지 기준(`broadcastChannel`)은 이은 기록의 방송 채널이다.
- D-PHN-18 권고(A의 손 글을 owner로 적기)는 넣지 않았다. 수용 기준이 아니고 사용자 전제(사장님은 채팅을 치지 않음)로 닫혔다.

### 기존 시험을 고친 곳

- `apps/server/test/youtube-link.test.ts` AC-Y1-12의 "남의 채널 방송" 한 줄: `NOT_MY_CHANNEL`·옛 문장을 기대하던 것을 `INVITED_CONFIRM_NEEDED`와 채널로 바꿨다. 근거는 D-PHN-17이 D-Y03을 개정하고 D-INV1-04가 잇기 응답 코드를 바꾼 것이다. 스펙이 바뀌었기 때문이지, 구현에 기대값을 맞춘 것이 아니다.

### 저장

- 마이그레이션 `apps/server/drizzle/0029_inv1_youtube_broadcast_channel.sql`: `youtube_links`에 `broadcast_channel_id`·`broadcast_channel_title`(둘 다 null 허용)을 더한다.
  - 옛 행은 고쳐 쓰지 않는다. 읽을 때 `coalesce(broadcast_channel_id, channel_id)`로 읽는다(D-INV1-01).
  - 다른 스프린트가 같은 번호 0029를 쓰면 합칠 때 번호만 뒤로 민다.

### 가짜 구글

- `videos.list` 응답 `snippet.channelTitle`: 가짜 채널 이름을 넣는다. 모르는 채널이면 `''`이다.
- `fake.chatReads`: 어느 채널 토큰으로 어느 채팅을 읽었는지 남긴다(liveChatMessages.list·streamList). 단위 시험용이다.
- E2E는 기존 조작 경로를 그대로 쓴다.
  - `POST /_fake/accounts`
  - `POST /_fake/channels {account,title,channelId?}` — B "다육이유튜버"
  - `POST /_fake/broadcasts {channelId,status:'live'}`
  - `POST /_fake/messages {liveChatId,author,name,text}`: author가 방송 채널 B이면 자동으로 `isChatOwner` true
  - `GET /_fake/state`: posted에 `authorChannelId`가 있다. A 이름의 감사 확인에 쓴다.
