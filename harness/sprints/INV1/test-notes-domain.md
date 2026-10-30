# INV1 test-notes (domain) — 라운드 0

`tests/adversarial/inv1/`

- `confirm-bypass.test.ts` (AC-INV1-11, 모두 통과 — 회귀)
  - TD-INV1-001 확인 칸 다른 모양("true"·1·{}·[]·null·"yes"·[true]·{value:true}·"false"·0) → 400 `confirmInvited`, 잇기 0
  - TD-INV1-002 다른 칸 이름·`__proto__`·`constructor.prototype`·주소 쿼리·영상 칸 안·배열 본문·같은 키 두 번 → 잇지 않음
  - TD-INV1-003 내 영상과 남의 영상을 한 주소에 섞기 → 확인 없이 이어지는 것은 내 채널 영상뿐
  - TD-INV1-004 내 방송을 이은 요청 번호를 남의 영상에 재사용(이은 채로·끊은 뒤) → 남의 방송 잇기 0
  - TD-INV1-005 확인 없는 동시 요청 10개 → 모두 409, 잇기 0
  - TD-INV1-006 다른 판매자 세션(남의 회차 404, 판매자 1의 채널도 판매자 2에겐 남의 방송, 판매자 1의 확인이 판매자 2에게 넘어가지 않음, 연결 없는 판매자)
  - TD-INV1-007·008 같은 채팅 열(방송자 글 포함)을 초대 방송·내 방송으로 공식 수집기에 넣으면 찜 결과가 같다(claim.ignoreOwner 예·아니오)
- `extension-after-unlink.test.ts` (실패 — 버그)
  - TD-INV1-009 초대 방송 회차에서 공식 잇기를 끊으면, 같은 영상을 계속 받는 확장에서 유튜버 B의 주인 배지 글이 시청자 찜이 되고(ownerDenied 1) `/ext/thanks/take`가 "방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요"를 준다. 원인: `ExtensionThanks.broadcastChannel`·`#invited`·`take`가 이어진(active) 기록만 보고, 끊으면 방송 채널을 연결 채널 A로 되돌린다.
