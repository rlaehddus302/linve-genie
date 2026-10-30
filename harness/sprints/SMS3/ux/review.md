# SMS3 사용성 점검 (ux-reviewer)

- 점검: 2026-10-31, 작업트리 커밋 69c88bea 기준. E2E 서버를 따로 띄움(서버 127.0.0.1:3960, 화면 localhost:6033 — 오프셋 860).
- 방법: Playwright(크로미움)로 새 판매자 → 설정 "휴대폰 알림 받기"(켜기·토큰·복사·단축어 안내·다시 만들기 확인 창·끄기 확인 창·꺼진 뒤 403·다시 켜기) → 실제 방송·상품 15·16·17 → 가짜 기기로 문자 7통(바로 넣기·확실하지 않음·이름만·판매 중 아님·취소·이름만 취소·늦게 온 문자) → 카드 넣기·무시·승인 → 은행 문자 4통(믿을 첫 입금·믿지 않는 번호·이름 없는 입금 취소·읽지 못함) → 입금 확인 화면 → 받기 멈춤·12시간 알림(응답만 바꿔 보임, round2 시험과 같은 방식).
- 폭: PC 1440×900(`pc-*.png`), 휴대폰 375×812 터치(`375-*.png`). 앱(apps/mobile)은 `PhoneNoticeCard.tsx`·`ui/parts.tsx` 코드로 봄.
- 좋았던 점: 화면에 영어 상태값이 보이지 않음(LATE·REJECTED·INBOX_OFF 등 없음). 카드 단추 높이 48px, 앱 단추 44px 이상, 앱 안내 글 16px. 다시 만들기·끄기에 확인 창이 있고 "그대로 두기"가 먼저. 늦게 온 문자·이름만 취소·판매 중 아님 문구가 무엇을 할지 말해 줌. 입금 줄에 "휴대폰 알림" 원천과 잔액 이어짐 문구가 보임.

심각도: major=상, minor=중, nit=하.

```json
[
{ "id": "UX-SMS3-001", "severity": "major", "category": "ux", "area": "device", "specRef": "ORD-13 C-02·D-SMS3-23",
  "file": "apps/mobile/src/screens/PhoneNoticeCard.tsx", "line": 238,
  "title": "앱 단축어 안내가 넣을 값을 큰따옴표로 감싸 보여 줌 — 따옴표까지 쳐 넣으면 문자를 하나도 못 받음",
  "detail": "앱은 `…` 값을 <Body bold>\"SMS\"</Body>처럼 따옴표를 붙여 그린다. 웹은 코드 글꼴로 따옴표 없이 보인다. 같은 줄에 \"현재 날짜\"·\"보낸 사람\"처럼 진짜로 따옴표로 묶은 고를 이름도 섞여 있어, 55세 판매자는 channel 칸에 \"SMS\"(따옴표 포함), 방법에 \"POST\", 헤더에 \"Bearer\"를 그대로 칠 수 있다. channel이 틀리면 묶음 전체 400이라 손님 문자를 다 잃는다(13단계 경고 문구가 바로 그 상황).",
  "repro": "PhoneNoticeCard.tsx 238줄 `part.value ? <Body key={at} bold>{`\"${part.text}\"`}</Body>` · 웹 비교 harness/sprints/SMS3/ux/375-07-settings-turned-off.png",
  "suggestedFix": "앱도 따옴표 없이 다른 글꼴·배경(코드 상자)으로 보이고, 값마다 \"복사\" 단추를 둔다. 안내 첫머리에 \"색칠된 글자만 그대로 적어요(따옴표는 적지 않아요)\" 한 줄.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-002", "severity": "major", "category": "ux", "area": "web", "specRef": "ORD-13 C-02·D-SMS3-23",
  "file": "apps/web/src/components/PhoneInboxSettings.tsx",
  "title": "아이폰 단축어에 넣을 43자 토큰·받는 주소를 컴퓨터에서 휴대폰으로 옮길 길이 없음",
  "detail": "토큰은 43자(대소문자·숫자·_·- 섞임, l/I/0/O 구분 어려움)이고 웹 설정에서 한 번만 보인다. 앱 아이폰 안내는 \"컴퓨터에서 … 받기 토큰을 만든 뒤\"라고 해, 판매자는 PC 화면을 보고 아이폰 단축어에 43자 + 받는 주소를 손으로 쳐야 한다(복사하기는 PC 클립보드에만 들어감). 한 글자 틀리면 401로 아무것도 안 온다. 앱은 받는 주소를 보여 주지도 않는다. 375 폭에서는 토큰 칸이 잘려 끝이 안 보인다.",
  "repro": "harness/sprints/SMS3/ux/pc-02-settings-token.png · 375-02-settings-token.png(토큰 잘림) · PhoneNoticeCard.tsx PHONE_NOTICE_SHORTCUT_GUIDE",
  "suggestedFix": "안내를 \"아이폰 사파리로 이 설정 화면을 열어 토큰을 만들고 '복사하기'\"로 바꾼다(웹은 휴대폰 폭에서도 됨). 받는 주소에도 복사 단추. 헤더 값은 \"Bearer \"+토큰을 한 번에 복사하는 단추(띄어쓰기 실수 없앰). 더 나아가 만들어 둔 단축어 링크(spec 판단).",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-003", "severity": "minor", "category": "ux", "area": "spec", "specRef": "ORD-13 C-02",
  "title": "단축어 안내 14단계가 개발 용어 덩어리 — 판매자가 혼자 따라 하기 어려움",
  "detail": "POST·Authorization·Bearer·JSON·사전·배열·yyyyMMddHHmmss·ISO 8601·device·messages·receivedAt 등 영어·개발 용어가 14단계에 몰려 있다(값이라 바꿀 수 없는 것은 이해하지만 양이 많다). 변수의 속성(\"보낸 사람\") 고르기, 날짜 형식 사용자 지정은 단축어 앱에서도 숨은 메뉴다. 1단계 \"보낸 사람·내용 조건은 비워 두고\"는 iOS 버전에 따라 다음 단추가 안 눌릴 수 있어 실물 확인 필요(HG).",
  "repro": "harness/sprints/SMS3/ux/pc-04-settings-shortcut.png · 375-07-settings-turned-off.png",
  "suggestedFix": "spec: 미리 만든 단축어(iCloud 링크)를 받아 토큰만 붙여 넣는 길을 DECISIONS에 올림. 그 전까지는 단계마다 단축어 화면 그림을 붙이고, 다 만든 뒤 \"시험 문자 보내기 → 여기 '받았어요'가 뜨면 끝\" 확인 칸을 설정에 둔다.",
  "confidence": "PLAUSIBLE" },

{ "id": "UX-SMS3-004", "severity": "minor", "category": "ux", "area": "web", "specRef": "ORD-13 화면 문구",
  "file": "apps/web/src/lib/inbox.ts", "line": 90,
  "title": "\"이름만 와서 누가 보냈는지 몰라요\" 바로 아래 \"연락처 이름: 김영희\" — 말이 서로 어긋남",
  "detail": "이름만 온 문자 카드 머리에 '누가 보냈는지 몰라요'라고 쓰고 바로 밑에 보낸 사람 이름을 보인다. 판매자는 '김영희라고 써 있는데?' 하고 헷갈린다. 실제 뜻은 '전화번호가 안 와서 같은 손님인지 확인할 수 없다'. 확실하지 않음 카드에는 굵은 사유 줄이 있는데 이 카드만 사유 줄이 없고 넣으면 누구 이름으로 들어가는지도 없다.",
  "repro": "harness/sprints/SMS3/ux/pc-11-panel.png · 375-11-panel.png (두 번째 카드, 이름만 취소 카드도 같음)",
  "suggestedFix": "\"전화번호 없이 연락처 이름(김영희)만 왔어요. 넣으면 '문자찜(김영희)'로 들어가요\" 같은 사유 줄. 취소 쪽은 \"전화번호가 없어 어느 찜인지 몰라요. 보드에서 직접 취소해 주세요\".",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-005", "severity": "minor", "category": "ux", "area": "web", "specRef": "ORD-13·D-SMS3-29",
  "title": "휴대폰 콘솔 위 '알림 없음'이 문자 확인 카드 6개·멈춤·12시간 알림이 있어도 그대로",
  "detail": "375 콘솔 맨 위 줄은 '알림 없음 / 알림 펼치기'인데, 그 위에 받기 멈춤·12시간 알림 두 칸이 떠 있고 아래 문자 확인 칸에 카드 6개가 있어도 '알림 없음'이다. 문자 확인 칸은 현재 상품 아래라 스크롤해야 보이고(PC 1440×900에서도 첫 화면엔 제목만), 새 카드가 와도 위쪽에서 알 길이 없다. 방송 중 한 손에 화분 든 판매자는 카드를 놓친다.",
  "repro": "harness/sprints/SMS3/ux/375-10-console-cards.png · 375-30-console-stale-stall.png · pc-10-console-cards.png",
  "suggestedFix": "위 줄에 \"문자 확인 6개\"를 세어 넣고 누르면 그 칸으로 내려간다. PC는 문자 확인 칸을 보드 옆(오른쪽 채팅 칸 위)처럼 첫 화면 안에.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-006", "severity": "minor", "category": "ux", "area": "web", "specRef": "ORD-13 C-05 승인",
  "file": "apps/web/src/components/SmsInbox.tsx",
  "title": "취소 요청 '승인'이 확인 없이 바로 찜을 취소하고 되돌리기 안내도 없음",
  "detail": "'승인' 한 번에 15번 1등 찜이 취소되고 대기자가 올라간다. 카드는 사라질 뿐 '15번 김민지 찜을 취소했어요 [되돌리기]' 같은 알림이 없다. 무시·승인 단추가 나란히 있어 잘못 누르기 쉽다. (콘솔 Ctrl+Z가 이 취소도 되돌리는지는 확인 못 함)",
  "repro": "harness/sprints/SMS3/ux/pc-11-panel.png → pc-14-console-after-approve.png (15번 '1등 문자찜'으로 바뀜)",
  "suggestedFix": "승인 뒤 몇 초간 '취소했어요 · 되돌리기' 줄을 카드 자리에 남긴다(확인 창보다 방송 중 빠름). 승인 단추 글을 '15번 취소하기'로.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-007", "severity": "minor", "category": "ux", "area": "web", "specRef": "D-SMS3-29",
  "title": "12시간 알림이 어느 방송인지·몇 통 놓쳤는지 말하지 않음",
  "detail": "서버는 staleBroadcast에 b·startedAt·count를 주지만 화면은 고정 문장만 보인다. 오늘 방송 콘솔에서 '끝내지 않은 방송…방송을 끝내 주세요'를 보면 판매자는 지금 방송을 끝내야 하는 줄 안다(실제로는 어제 방송일 수 있음). 손님 문자 3통을 못 넣었다는 것도 모른다. 375에서 '닫기' 단추가 글 끝에 붙어 줄바꿈되어 멈춤 알림과 모양이 다르다.",
  "repro": "harness/sprints/SMS3/ux/pc-30-console-stale-stall.png · 375-30-console-stale-stall.png · 375-31-settings-stale.png",
  "suggestedFix": "\"10월 30일 '1부' 방송이 끝나지 않아 손님 문자 3통을 넣지 않았어요\" + [그 방송으로 가기] 단추. 닫기 단추는 멈춤 알림처럼 아래 줄로.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-008", "severity": "nit", "category": "ux", "area": "web", "specRef": "D-SMS3-30",
  "title": "늦게 온 문자 카드의 시각 모양이 섞이고 같은 시각이 두 번",
  "detail": "머리 '10월 31일 05:45:51 뒤 4자리 2222 · 오전 6:00:51 도착'(24시간제와 오전/오후가 한 줄에), 본문에도 같은 시각을 또 쓴다. '넣으면 지금 받은 순서로 들어가요'는 '맨 뒤로 간다'는 뜻이 잘 안 읽힌다.",
  "repro": "harness/sprints/SMS3/ux/pc-11-panel.png 마지막 카드",
  "suggestedFix": "\"휴대폰엔 5시 45분에 왔는데 6시 00분에야 도착했어요. 넣으면 지금 온 손님들 뒤 순서예요\"처럼 한 번만, 오전/오후 모양 하나로.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-009", "severity": "nit", "category": "ux", "area": "web",
  "title": "카드의 'N번' 알약 단추와 'N번에 넣기'가 겹침",
  "detail": "후보가 하나뿐인데도 'N번'(선택된 알약)과 'N번에 넣기' 두 단추가 있어 무엇을 눌러야 하는지 잠깐 멈칫한다. 마우스 없이 카드를 처리할 단축키도 없다(Tab으로는 됨).",
  "repro": "harness/sprints/SMS3/ux/375-11-panel.png",
  "suggestedFix": "후보가 하나면 알약을 숨기고 'N번에 넣기'만.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-010", "severity": "nit", "category": "ux", "area": "web",
  "title": "바로 넣거나 카드로 넣은 이름 없는 문자찜이 보드에 '1등 문자찜'만 — 누군지 모름",
  "detail": "'15 있나요?'(뒤 2468) 카드를 넣고 앞 찜이 취소되자 보드가 '1등 문자찜'으로만 보인다. 포장·정산에서 같은 '문자찜'이 여럿이면 헷갈린다.",
  "repro": "harness/sprints/SMS3/ux/pc-14-console-after-approve.png · pc-30-console-stale-stall.png(15번)",
  "suggestedFix": "이름이 없으면 '문자찜(뒤 2468)'.",
  "confidence": "CONFIRMED" },

{ "id": "UX-SMS3-011", "severity": "nit", "category": "ux", "area": "web",
  "title": "설정 아래 고정 줄 '바꾼 칸이 없어요 · 저장'이 바로 저장되는 이 칸 위에 겹침",
  "detail": "휴대폰 알림 받기는 누르면 바로 바뀌는데 화면 아래 '저장' 줄이 늘 떠 있어 '저장을 눌러야 하나?' 싶고, 375에서 단축어 안내 단계를 가린다. 받기 멈춤 알림 문구 '앱의 알림 읽기'는 단축어(아이폰) 판매자에게 맞지 않는다.",
  "repro": "harness/sprints/SMS3/ux/pc-00-settings-landing.png · 375-05-settings-renew-confirm.png",
  "suggestedFix": "칸 안에 '누르면 바로 바뀌어요' 한 줄. 멈춤 문구에 '(아이폰은 단축어가 켜져 있는지)' 덧붙임.",
  "confidence": "CONFIRMED" }
]
```

스크린샷 목록(같은 이름 pc-·375-): 00 설정 첫 화면 · 01 꺼짐 · 02 토큰 · 03 복사함 · 04 단축어 안내 · 05 다시 만들기 확인 · 06 끄기 확인 · 07 꺼진 뒤 · 10 콘솔 카드 · 11 문자 확인 칸 · 12 넣기 뒤 · 13 무시 뒤 · 14 승인 뒤 · 20 입금 확인 · 30 콘솔 멈춤·12시간 알림 · 31 설정 12시간 알림.
