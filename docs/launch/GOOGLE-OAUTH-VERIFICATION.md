# 구글 앱 확인(OAuth 검증)·유튜브 API 감사 신청 서류

> **초안 — 법률·세무 검토 필요.** 구글·유튜브에 내기 전에 사장님이 읽고 고쳐 쓰는 초안입니다. 구글 화면 이름·기간은 바뀔 수 있으니 아래 링크의 공식 안내를 최종 기준으로 삼아 주세요. 모르는 값은 **[확인 필요]**로 두었습니다.
>
> 작성: 2026-10-25 · 근거: 저장소 코드(`apps/server/src/youtube/google.ts`·`connect.ts`·`collector.ts`·`outbox.ts`·`quota.ts`·`seal.ts`, `apps/server/src/social/providers.ts`), `docs/DEPLOY.md` 4절·4-3절, `docs/DECISIONS.md` D-019·D-Y09·D-Y11·D-012

---

## 0. 한눈에

| 무엇 | 권한(범위) | 구글 분류 | 심사 |
|---|---|---|---|
| 유튜브 연결 — 채팅 읽기 | `https://www.googleapis.com/auth/youtube.readonly` | 민감(sensitive) [확인 필요 — 콘솔 "데이터 액세스" 화면에서 표시 확인] | 앱 확인(데이터 액세스 검증) 필요 |
| 유튜브 감사 메시지 올리기 (판매자가 켤 때만 추가로 받음) | `https://www.googleapis.com/auth/youtube.force-ssl` | 민감(sensitive) [확인 필요 — 같은 화면] | 앱 확인 필요 |
| 간편 로그인 "구글로 계속하기" | `openid email` | 민감하지 않음 | 브랜드 확인만 |

- 코드가 실제로 묻는 권한은 위 셋뿐입니다. **`profile`은 묻지 않습니다**(`social/providers.ts`의 `GOOGLE_LOGIN_SCOPE = 'openid email'`). `docs/OWNER-GUIDE.md` 5장 4에는 `profile`도 적혀 있는데, 동의 화면에도 `openid`·`email`만 넣어 주세요(넣지 않은 권한을 동의 화면에 올리면 "쓰지 않는 권한"으로 지적받을 수 있습니다).
- **유튜브 연결은 읽기 권한만 먼저** 받고, 판매자가 설정에서 "감사 메시지 자동 게시"에 동의할 때만 게시 권한(`force-ssl`)을 **추가로** 받습니다(`include_granted_scopes=true`, `connect.ts`). 심사 설명에서 이 "단계별 요청"을 강조하면 "최소 권한" 질문에 답이 됩니다.
- 로그인용 클라이언트와 유튜브용 클라이언트는 **같은 프로젝트·같은 동의 화면**을 써도 됩니다(DEPLOY 4-3). 다만 앱 확인은 프로젝트(동의 화면) 단위라, 같은 프로젝트면 한 번의 신청에 함께 들어갑니다.

### 우리 앱이 부르는 유튜브 API (할당량 비용은 코드 기본값, 구글 문서 2026-10-20 확인 — D-Y09)

| 호출 | 단위 | 언제 | 필요한 권한 |
|---|---|---|---|
| `channels.list` (mine) | 1 | 연결할 때 채널 이름·번호 확인 | readonly |
| `liveBroadcasts.list` (mine) | 1 | "내 라이브 목록"에서 방송 고르기 | readonly |
| `videos.list` | 1 | 예정 방송이 시작했는지 30초마다 | readonly |
| `liveChatMessages.streamList` | 5 | 채팅 받기(기본, 스트림) | readonly |
| `liveChatMessages.list` | 5 | 스트림이 안 될 때 대체(폴링, 2초보다 자주 하지 않음) | readonly |
| `liveChatMessages.insert` | 20 | 구매 감사 메시지(라이브 채팅) — 판매자 동의 뒤만 | force-ssl |
| `commentThreads.insert` | 50 | 방송 뒤 감사 요약(영상 댓글) — 판매자 동의 뒤만 | force-ssl |
| `commentThreads.list` | 1 | 올린 댓글이 실제로 올라갔는지 확인 | readonly 또는 force-ssl |

---

## 1. 신청 순서 (가장 오래 걸리는 것부터 미리)

1. **도메인 정하기·구매** → 서버에 올려 `https://<도메인>`이 열리게 하기 (CHECKLIST 참고).
2. **공개 홈페이지 만들기** — 로그인하지 않아도 보이고, 라이브지니가 무엇을 하는지 설명하고, 개인정보처리방침으로 가는 링크가 있는 첫 화면.
   - **[확인 필요 — 개발 작업]** 지금 앱은 `/`가 로그인 화면이고(로그인 화면 아래에 `/privacy`·`/terms` 링크는 있음), 서비스를 설명하는 공개 소개 화면이 없습니다. 구글은 "로그인 사용자만 보이는 화면은 홈페이지로 인정하지 않는다"고 적고 있어 **소개 화면(예: `/` 로그아웃 상태 또는 `/about`)을 만들어야** 합니다.
3. **개인정보처리방침 완성** — `PRIVACY-POLICY-GAPS.md`의 빈틈을 채우고 법률 검토. 구글은 "실제 데이터 사용과 방침이 맞는지"를 봅니다.
4. **구글 서치 콘솔에서 도메인 소유 확인** — https://search.google.com/search-console (구글 클라우드 프로젝트의 소유자·편집자 계정으로). 홈페이지·방침·약관·돌아오는 주소의 최상위 도메인(예: `example.com`)을 모두 확인합니다.
5. **구글 클라우드 프로젝트·API 켜기** — YouTube Data API v3 사용 설정(DEPLOY 4절).
6. **Google Auth Platform → 브랜딩**: 앱 이름 "라이브지니", 지원 이메일, 로고(선택), 홈페이지·개인정보처리방침·서비스 약관 주소, 승인된 도메인. → **"브랜딩 확인(Verify Branding)" → 결과가 나오면 "브랜딩 게시(Publish branding)"** (결과는 7일 안에 게시하지 않으면 사라짐).
7. **대상(Audience)**: 사용자 유형 "외부". 처음엔 "테스트" 상태로 두고 사장님 계정을 테스트 사용자로 넣어 실제 방송(HG-3)을 먼저 해 봅니다.
   - 테스트 상태에서는 유튜브 권한의 **새로 고침 토큰이 7일 뒤 만료**됩니다 — 1주일마다 다시 연결해야 하니, 실제 판매는 앱 확인 뒤가 편합니다. (기본 로그인 권한만 쓰는 경우는 7일 제한이 없습니다.)
8. **데이터 액세스(Data Access)**: 위 세 권한(readonly·force-ssl·openid/email)을 등록. 코드가 묻는 것과 똑같게.
9. **클라이언트(Clients)**: 웹 애플리케이션 하나 또는 둘 — 승인된 리디렉션 URI
   - 유튜브: `https://<도메인>/api/youtube/oauth/callback`
   - 로그인: `https://<도메인>/api/auth/google/callback`
10. **시연 영상 찍기**(3절) → 유튜브에 **일부 공개(Unlisted)**로 올리기.
11. **확인 센터(Verification Center)에서 데이터 액세스 확인 신청** — 권한마다 "왜 필요한가"(2절)와 영상 링크.
12. 구글 담당(Trust & Safety)이 **이메일로** 묻습니다 → 프로젝트의 지원 이메일·개발자 연락처를 매일 보는 주소로 두기.
13. 앱 확인이 끝나면 대상(Audience)을 **"프로덕션 게시"**로 바꿉니다.
14. 판매자가 늘어 하루 할당량 10,000단위가 모자라면 **유튜브 API 감사·할당량 늘리기 신청**(6절).

> 주의: 확인을 받은 뒤 **앱 이름 변경·새 권한 추가·리디렉션 주소 추가**를 하면 다시 확인이 필요할 수 있습니다. 서비스 이름(라이브지니)·도메인을 먼저 확정하고 신청하세요(D-RN1).

---

## 2. 권한별 "왜 필요한가" (심사는 영어 — 영문을 그대로 붙여 넣고, 한글은 사장님 확인용)

### 2-1. 앱 설명 (App description — 신청서 첫 칸)

**English**
> LiveGenie (라이브지니) is a web service for small Korean sellers who sell plants (succulents) and other goods during their own YouTube live streams. Viewers order by typing a product number in the live chat (e.g. "15"). LiveGenie reads the seller's own live chat, decides first-come-first-served orders, prints product labels, and helps the seller settle payments and pack orders after the stream. Only the channel owner connects their own channel; we never access other users' channels. Optionally, and only after the seller turns it on and agrees, LiveGenie posts a short thank-you message (e.g. "Thank you @viewer for ordering #15") in the seller's own live chat or as a comment on the seller's own video.

**한국어**
> 라이브지니는 자기 유튜브 라이브에서 다육이 등을 파는 소상공인용 웹 서비스입니다. 시청자가 채팅에 상품 번호("15")를 쓰면 주문이 됩니다. 라이브지니는 판매자 본인 방송의 채팅을 읽어 선착순 주문을 정하고, 라벨을 출력하고, 방송 뒤 정산·포장을 돕습니다. 판매자는 자기 채널만 연결하고, 다른 사람의 채널에는 접근하지 않습니다. 판매자가 설정에서 켜고 동의한 경우에만 판매자 본인 방송 채팅이나 본인 영상 댓글에 짧은 감사 글을 올립니다.

### 2-2. `youtube.readonly`

**English**
> We request youtube.readonly when the seller connects their YouTube channel. We use it to (1) read the seller's channel name and channel ID (channels.list, mine=true) to show which channel is connected and to make sure one channel belongs to one seller account, (2) list the seller's own live broadcasts (liveBroadcasts.list, mine=true) so the seller can pick today's stream, (3) check whether a scheduled stream has started (videos.list), and (4) read the live chat messages of that stream (liveChatMessages.streamList / liveChatMessages.list) to detect orders such as "15". Live chat text and viewer display names are deleted (sealed) 30 days after the broadcast date; only the seller's sales ledger remains. This is the narrowest scope that allows reading the seller's own broadcasts and live chat. Sellers who never enable thank-you messages grant only this read-only scope.

**한국어**
> 판매자가 유튜브 채널을 연결할 때 이 권한을 받습니다. (1) 연결한 채널 이름·번호를 보여 주고 채널 하나가 판매자 한 명에게만 묶이게 하려고, (2) 판매자 본인의 라이브 목록에서 오늘 방송을 고르려고, (3) 예정 방송이 시작했는지 보려고, (4) 그 방송 채팅을 읽어 "15" 같은 주문을 찾으려고 씁니다. 채팅 글과 시청자 이름은 방송 날짜부터 30일 뒤에 지우고 판매 장부만 남깁니다. 본인 방송·채팅을 읽을 수 있는 가장 좁은 권한이며, 감사 메시지를 켜지 않는 판매자는 이 읽기 권한만 줍니다.

### 2-3. `youtube.force-ssl`

**English**
> We request youtube.force-ssl only when the seller explicitly turns on "post thank-you messages automatically" in Settings and agrees in a confirmation dialog (incremental authorization with include_granted_scopes). It is not requested at first connection. We use it to (1) post one short thank-you message per confirmed order in the seller's own live chat (liveChatMessages.insert), and (2) post one summary thank-you comment on the seller's own video after the stream (commentThreads.insert), then check that it was posted (commentThreads.list). Each target (live chat, video comment) has its own consent switch, and the seller can turn it off at any time. Messages are generated only from confirmed orders in the seller's own stream, are rate-limited and batched, are never posted on other channels, and are never re-posted automatically when the result is uncertain. We do not delete, edit or upload videos, and we do not modify ratings or captions. youtube.force-ssl is the scope the YouTube Data API requires for commentThreads.insert; we are not aware of a narrower scope that allows posting a comment. [확인 필요 — 구글 API 문서에서 두 메서드의 허용 권한을 신청 직전에 다시 확인]

**한국어**
> 판매자가 설정에서 "감사 메시지 자동 게시"를 켜고 확인 창에서 동의할 때만 추가로 받습니다(처음 연결 때는 묻지 않음). (1) 확정된 주문마다 판매자 본인 라이브 채팅에 짧은 감사 글을 올리고, (2) 방송 뒤 본인 영상에 감사 요약 댓글 하나를 올리고 올라갔는지 확인하는 데만 씁니다. 대상(라이브 채팅·영상 댓글)마다 동의를 따로 받고 언제든 끌 수 있습니다. 본인 방송의 확정 주문으로만 글을 만들고, 속도를 제한해 묶어 보내고, 다른 채널에는 올리지 않고, 올라갔는지 모를 때 저절로 다시 올리지 않습니다. 영상 삭제·수정·업로드, 평가·자막 변경은 하지 않습니다. 영상 댓글을 올리려면 이 권한이 필요하고, 더 좁은 권한은 없는 것으로 압니다.

### 2-4. `openid email` (간편 로그인 — 민감하지 않음, 참고용)

**English**
> Used only for "Continue with Google" sign-in. A seller first signs in with the ID and password the operator created, then links a Google account in Settings. We store only the Google account ID (sub) and a masked email (e.g. se***@gmail.com) to recognize the linked account. We do not store Google tokens from sign-in, and sign-in does not request any YouTube permission.

**한국어**
> "구글로 계속하기" 로그인에만 씁니다. 판매자는 운영자가 만든 아이디로 먼저 로그인한 뒤 설정에서 구글 계정을 연결합니다. 구글 계정 번호와 가린 이메일만 저장하고, 로그인 때 받은 토큰은 저장하지 않으며, 유튜브 권한은 묻지 않습니다.

### 2-5. 구글 사용자 데이터 처리 요약 (심사 질문 "How will you store/share data?"에 붙일 문장)

**English**
> - Storage: OAuth refresh/access tokens are encrypted at rest with AES-256-GCM using a server master key kept separately from backups. Tokens and chat text are never written to logs.
> - Retention: Live chat text and viewer display names are deleted 30 days after the broadcast date (scheduled hourly job). Database backups are kept for 30 days. [확인 필요 — 백업에도 봉인 전 원문이 최대 30일 더 남는 점을 방침에 적었는지]
> - Sharing: We do not sell Google user data or use it for advertising. We do not transfer YouTube data to third parties. Chat messages received from YouTube (official API or our Chrome extension) are never sent to our optional AI suggestion feature; the server filters them by source before any AI request (D-AIY1-01).
> - Revocation: Sellers can disconnect in Settings → YouTube → "Disconnect" (we call Google's revoke endpoint and delete tokens) or at https://myaccount.google.com/permissions.
> - Hosting: [확인 필요 — 서버 업체·지역]

> **정리됨(AIY1, D-AIY1-01)**: 유튜브에서 받은 채팅(공식 연결·크롬 확장)은 AI 제안으로 보내지 않습니다. 서버가 출처를 보고 보내기 전에 거르고, 그런 줄은 규칙 제안만 보여 줍니다. 그래서 심사 서류에 "YouTube 데이터를 제3자에게 넘기지 않는다"고 그대로 적을 수 있습니다.

---

## 3. 시연 영상 대본 (영어 화면 권장, 3~5분, 유튜브 "일부 공개")

구글 요구: **OAuth 동의 과정 전체**를 영어로 보여 주기, 동의 화면에 **앱 이름**이 보이기, 주소창에 **OAuth 클라이언트 ID**가 보이기, **권한마다 그 기능**을 실제로 보여 주기.

준비: 실제 도메인의 운영 서버, 테스트 사용자로 넣은 사장님 구글 계정, 비공개/일부 공개 테스트 방송 하나(휴대폰 또는 OBS), 시청자 역할 두 번째 구글 계정. 브라우저 언어를 영어로(구글 동의 화면이 영어로 나오게). **[확인 필요 — 라이브지니 화면은 한국어뿐. 화면 자막(영어)을 영상 편집으로 넣거나 말로 설명]**

| 시각 | 화면 | 말/자막(영어) |
|---|---|---|
| 0:00–0:15 | 공개 홈페이지 `https://<도메인>` → 아래 개인정보처리방침 링크 클릭 → 방침 열림 | "This is LiveGenie's public home page and privacy policy on our verified domain." |
| 0:15–0:30 | 로그인(운영자가 만든 판매자 계정) | "A seller signs in to LiveGenie." |
| 0:30–1:10 | 설정 → 유튜브 → [구글로 유튜브 연결하기] → 구글 계정 선택 → **주소창을 확대해 `client_id=...` 보이기** → 동의 화면에서 **앱 이름 "라이브지니/LiveGenie"**와 권한 문구("View your YouTube account") 확대 → 허용 | "The consent screen shows our app name and requests only youtube.readonly. Note the client ID in the address bar." |
| 1:10–1:25 | 설정 화면에 연결한 채널 이름 표시 | "We read the channel name to show which channel is connected (channels.list)." |
| 1:25–1:50 | 방송 화면 → "내 라이브 목록"에서 오늘 방송 고르기 → 이음 | "We list the seller's own live broadcasts (liveBroadcasts.list)." |
| 1:50–2:30 | 두 번째 계정(시청자)이 유튜브 채팅에 "15" → 라이브지니 콘솔에 주문 1등으로 뜸 | "We read the seller's own live chat to detect orders (liveChatMessages)." |
| 2:30–3:20 | 설정 → 감사 메시지 자동 게시 켜기 → 설명 창 동의 → 다시 구글 동의 화면(**추가 권한 force-ssl** "Manage your YouTube account") 확대 → 허용 | "Only when the seller turns on automatic thank-you messages do we request youtube.force-ssl (incremental authorization)." |
| 3:20–3:50 | 시청자가 "16" → 확정 → 유튜브 채팅에 판매자 이름으로 감사 글이 올라감 | "A thank-you message is posted in the seller's own live chat (liveChatMessages.insert)." |
| 3:50–4:20 | 방송 끝 → 10분 뒤(편집으로 줄임) 판매자 영상에 감사 요약 댓글 | "After the stream, one summary comment is posted on the seller's own video (commentThreads.insert)." |
| 4:20–4:45 | 설정에서 자동 게시 끄기 → 설정 → 유튜브 → 연결 끊기 → myaccount.google.com/permissions에서 라이브지니가 사라진 것 보이기 | "Sellers can turn posting off or disconnect at any time; we revoke the token." |
| 4:45–5:00 | (선택) 구글 로그인 연결: 설정 → 로그인 방법 → 구글 연결 → 동의 화면(openid/email) | "Google sign-in requests only openid and email." |

팁: 한 영상에 모든 권한을 담고, 화면 녹화는 끊지 않는 편이 좋습니다(편집으로 잘라 붙이면 "흐름 전체"를 못 봤다고 할 수 있음 [확인 필요]).

---

## 4. 도메인 확인

- 구글 서치 콘솔 → 속성 추가 → **도메인** 유형 → 도메인 업체(가비아·Cloudflare 등) DNS에 TXT 레코드 추가.
- 확인하는 계정 = 구글 클라우드 프로젝트의 **소유자 또는 편집자** 계정.
- 확인할 것: 홈페이지·방침·약관·리디렉션 주소의 최상위 도메인 전부. 하위 도메인(`app.example.com`)을 쓰면 최상위(`example.com`)를 확인.
- 근거: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification

## 5. 개인정보처리방침 주소 요건 (구글 + 유튜브 정책)

| 요건 | 출처 | 지금 상태 |
|---|---|---|
| 홈페이지와 **같은 도메인**에 있고, 동의 화면에 링크 | 구글 브랜드 확인 | `/privacy` — 도메인만 정하면 됨 |
| 로그인 없이 열림 | 구글 | 됨(`PolicyPages.tsx` — 로그인 없이 열림) |
| 구글 사용자 데이터를 어떻게 접근·사용·저장·공유하는지 | 구글 | 일부 — PRIVACY-POLICY-GAPS 참고 |
| 유튜브 API 서비스를 쓴다는 알림 | 유튜브 개발자 정책 III.A.2.b | 됨(4번 절) |
| 구글 개인정보처리방침 링크 | III.A.2.c | 됨 |
| 쿠키 등 사용 고지 | III.A.2.g | 됨(7번 절) |
| 구글 보안 설정 페이지에서 권한을 거둘 수 있다는 안내·링크 | III.A.2.h | 됨(4번 절, myaccount.google.com/permissions) |
| 개인정보 문의 연락처 | III.A.2.i | **없음 — 10번 절 "[미정]"** |
| 약관에 "유튜브 이용약관에 동의하게 된다" | III.A.1 | 됨(이용약관 4번) |
| 실제 데이터 사용과 일치 | 구글 | **AI 제안·음성·인스타·틱톡 등 빠짐** — GAPS 문서 |
| 앱 안 연결 끊기 → 토큰 즉시 폐기, 권한 데이터 7일 안 삭제 | III.D.2.3.a | 토큰 폐기·삭제는 됨. 끊은 뒤 채팅 원문은 30일 봉인까지 남음 — **[확인 필요 — 7일 규칙에 걸리는지 법률·정책 검토]** |
| 사용자 삭제 요청 시 7일 안 삭제 | III.E.4.g | 운영자가 손으로 처리 [확인 필요 — 절차·기한을 방침에 적기] |

근거: https://developers.google.com/youtube/terms/developer-policies (III.A·III.D·III.E·III.I)

## 6. 예상 기간

| 단계 | 공식 안내 | 비고 |
|---|---|---|
| 브랜드 확인 | 자동이면 몇 분, 사람이 보면 보통 영업일 2~3일 | |
| 민감 권한 데이터 액세스 확인 | 보통 영업일 3~5일 | 질문 메일이 오가면 몇 주 [확인 필요]. 구글은 "몇 달 걸릴 수도"라고도 적음 |
| 유튜브 감사·할당량 늘리기 | 정해진 기간 없음("가능한 한 빨리" 연락) | 몇 주~몇 달 걸렸다는 개발자 후기가 많음 [확인 필요] |

> 계획: 도메인·홈페이지·방침이 준비되는 날 바로 신청 → 그동안 "테스트" 상태로 사장님 계정만으로 실제 방송 시험.

## 7. 거절 흔한 사유와 대비

| 흔한 사유 | 대비 |
|---|---|
| 홈페이지가 로그인 화면뿐이거나 앱 설명이 없음 | 공개 소개 화면을 만든다(1절 2) |
| 방침이 다른 도메인이거나, 실제 데이터 사용과 다름 | 같은 도메인 `/privacy`, GAPS 문서대로 고침(특히 AI·음성·백업) |
| 승인된 도메인을 서치 콘솔에서 확인하지 않음 | 4절 |
| 앱 이름·로고가 동의 화면과 홈페이지에서 다름 | 모든 곳 "라이브지니"(영문 표기를 쓰면 "LiveGenie"로 통일) — 상표 문제 없는지 먼저(키프리스) |
| 영상에 동의 화면·클라이언트 ID·권한별 기능이 안 보임 | 3절 대본 그대로 |
| 필요보다 넓은 권한·겹치는 권한 | readonly는 연결 때, force-ssl은 동의 때만이라는 점을 설명(겹친다고 하면 "force-ssl을 주지 않는 판매자가 많아 읽기 전용을 따로 둔다"고 답함) |
| 코드가 묻는 권한과 동의 화면 등록 권한이 다름 | 동의 화면에 `openid`·`email`·`youtube.readonly`·`youtube.force-ssl`만. `profile` 넣지 않기 |
| 자동 게시가 스팸처럼 보임 | 판매자의 명시적 동의(대상별), 확정 주문만, 속도 제한·묶음, 끄기 버튼을 영상에 보여 줌 — 유튜브 정책 III.I.2(사전·구체적·명시적 동의) |
| 메일 답장이 늦음 | 지원 이메일을 매일 보는 주소로 |

## 8. 유튜브 API 서비스 감사·할당량 늘리기 신청서 답변 초안

신청서: https://support.google.com/youtube/contact/yt_api_form (안내: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)

> 처음에는 기본 10,000단위로 시작합니다(판매자 1~2명). 서버는 남은 양이 20% 아래면 감사 메시지를 묶고 5% 아래면 멈추며 채팅 받기는 계속합니다(`quota.ts`). `QUOTA_EXCEEDED` 경보가 보이기 시작하면 신청하세요.

| 질문(대략) | 답변 초안 (English) |
|---|---|
| 회사·연락처 | TEUM (틈), sole proprietor, Republic of Korea. Business registration no. [확인 필요]. Contact: [확인 필요 — 지원 이메일] |
| 프로젝트 번호·API 키/클라이언트 ID | [확인 필요 — 구글 콘솔에서] |
| 앱 이름·주소 | LiveGenie (라이브지니), https://<도메인> [확인 필요] |
| 무엇을 하는 앱인가 | (2-1 영문 그대로) |
| 누가 쓰나 | Small business sellers in Korea who sell during their own YouTube live streams. Each seller connects only their own channel. Expected sellers in 12 months: [확인 필요 — 예: 20~50] |
| 쓰는 API·이유 | (0절 표의 호출과 이유를 영어로 — channels.list, liveBroadcasts.list, videos.list, liveChatMessages.streamList/list, liveChatMessages.insert, commentThreads.insert/list) |
| 필요한 하루 할당량과 계산 | One seller's 2-hour stream: reading chat with streamList reconnects or list polling (5 units per call, at most one call every 2–5 seconds) is about [확인 필요 — HG-3 실측] units, worst case ≈ 7,200 units with 5-second polling; thank-you messages (20 units each, batched) ≈ 1,000 units for 50 orders; one summary comment 50 units. Average ≈ [확인 필요] units per stream. With N sellers streaming on the same day we need about N × [확인 필요] units. We request [확인 필요] units/day. |
| 할당량을 아끼는 방법 | Streaming endpoint first; never poll faster than the server-provided interval or 2 seconds; stop reading 10 minutes after the stream ends; batch thank-you messages when quota is low and pause posting at 5% remaining; per-seller daily budget; every call is metered before sending. |
| 데이터 보관 | Live chat text and viewer names are deleted 30 days after the broadcast date; tokens encrypted; no data sold or used for ads. (2-5 그대로, [확인 필요] 줄 포함) |
| 사용자 동의·끄기 | Read access at connection; posting only after explicit, per-target consent; disconnect revokes tokens. |
| 화면 자료 | 시연 영상 링크(3절), 스크린샷: 연결 화면·동의 창·콘솔·설정 끄기 |
| 개인정보처리방침·약관 주소 | https://<도메인>/privacy, https://<도메인>/terms |

> 할당량 계산은 **HG-3 실제 테스트 방송**에서 `/ops/status`의 "오늘 프로젝트 할당량 사용"을 보고 채우세요. 짐작으로 크게 적으면 근거를 다시 묻습니다.

## 9. 참고 링크 (2025~2026 확인)

- 민감 권한 확인: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- 브랜드 확인: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- 확인되지 않은 앱·100명 제한: https://support.google.com/cloud/answer/7454865
- 테스트 상태 새로 고침 토큰 7일: https://developers.google.com/identity/protocols/oauth2 (Refresh token expiration)
- 유튜브 개발자 정책: https://developers.google.com/youtube/terms/developer-policies
- 유튜브 할당량·감사: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- 구글 API 서비스 사용자 데이터 정책: https://developers.google.com/terms/api-services-user-data-policy
