# INV1 dev-web 메모 — 화면이 기대하는 서버 약속

acceptance.md·D-INV1-02~04는 코드·칸 이름을 정하지 않았다. 화면(`apps/web`)은 아래 모양으로 만들었다. 서버가 다른 이름을 쓰면 한쪽을 맞춰야 한다(합칠 때 확인).

## 잇기 요청 `POST /api/broadcasts/:id/youtube`
- 처음: `{ requestId, video }` (지금과 같음)
- 확인한 뒤: `{ requestId, video, confirmOtherChannel: true }` — 새 요청 번호, 값은 JSON `true`만.
  - 서버는 모르는 칸을 거절(`UNKNOWN_FIELD`)하므로 `confirmOtherChannel`을 받는 칸에 더해야 한다.

## 확인 필요 응답 (AC-INV1-01)
- 409, `{ error: { code: 'OTHER_CHANNEL_CONFIRM', message }, videoId, channel: { id, title } }`
- 화면은 `error.code === 'OTHER_CHANNEL_CONFIRM'`일 때만 확인 줄을 띄운다. 이름은 `channel.title`(없으면 `channelTitle`), 비면 "(이름 없음)".
- 서버 `message`는 화면에 보이지 않는다(확인 줄 문장은 화면이 만든다). 옛 문장 "내 채널의 방송만 연결할 수 있어요."는 화면 어디에도 없다.

## 이은 기록 `LinkView.link` (GET·POST 응답)
- 더한 칸: `broadcastChannelId: string | null`, `broadcastChannelTitle: string | null`.
- `broadcastChannelId`가 비어 있거나 `channelId`(글 올리는 계정)와 같으면 내 방송(D-INV1-01) — "초대받은 방송 · {이름}" 줄 없음.

## 확장 감사 경고
- 초대 방송 콘솔에서는 확장 경고 `kind: 'OWNER'`("방송 채널 계정으로 로그인해야 …")를 보이지 않는다(서버가 맡기지 않으니 원래 생기지 않아야 하고, 화면은 한 번 더 거른다). 확장 팝업 문구는 서버 가져가기 응답 그대로라 서버가 초대 방송을 확장에 맡기지 않으면 나오지 않는다.

## 화면 이름(E2E용)
- 확인 줄: `role=group` 이름 "초대받은 방송 확인", 안의 문장 `role=alert` "내 채널 방송이 아니에요 (채널: {이름}). 초대받은 방송이 맞나요?", 버튼 "맞아요, 잇기"·"취소".
- 콘솔 유튜브 칸(`role=region` 이름 "유튜브")의 한 줄 "초대받은 방송 · {이름}". 이름은 40글자 넘으면 줄임표.
