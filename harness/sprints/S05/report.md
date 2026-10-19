# S05 리포트 — 라이브 콘솔 + 리허설(시뮬레이터) 모드

**결과: PASS** (수정 2라운드, 남은 blocker/major 0건, 개발 server·web, 시험 domain·e2e)

스펙 커밋 d4f0449([spec] S05), BASE 5a8f7ea. 인수 기준 38개(AC-S05-01~92). 골든 20파일·114 엔진 시나리오·493 통과(G-ENG-167·168 추가).

## 영역별로 만든 것

### server (dev-server, 13커밋 + 2라운드 수정)
- 코어 순수 조회 함수 `listBlocked`·`listMessages` 추가와 단위 시험(D-086). core-adapter.test.ts 골든 합계를 갱신함.
- 리허설 방송은 엔진 범위를 따로 씀: (판매자, 날짜, rehearsal). 마이그레이션 0002에서 `scopes.rehearsal`·`scopes.seq`·`outbox.rehearsal`과 채팅 인덱스를 추가함. 리허설 발송함 행에는 표시가 붙고, 차단 이어받기는 실제→실제로만 됨(D-081, RA-S04-006 해소).
- 범위의 현재 seq를 이벤트 커밋과 같은 트랜잭션에서 저장함. SSE ready와 `/api/days`는 집계 없이 이 값을 읽고, 재생 검사가 '범위 seq'를 맞춰 봄(RA-S04-008 해소).
- 증분 조회 `/api/days/:date/changes?since=N`을 만듦. '전체 + 증분 = 새 전체' 성질을 무작위 시험으로 확인하고, 너무 오래되었거나 미래인 seq에는 410 RESYNC_REQUIRED를 돌려줌(D-085, RA-S04-007 해소).
- 메시지 조회 `/api/days/:date/messages`(after·before·latest), 상품별 조치 기록 조회를 만듦.
- 가짜 채팅 생성기를 만듦. 수집기 경로로만 쓰고 seed와 현재 상태로 메시지를 고름. 시작·정지·상태 API, '시청자로 보내기', `/api/client-config`도 있음(D-082).
- E2E 서버 시작 명령을 만듦. 테스트 계정이 있고, 상품 500개·채팅 1만 건을 미리 채울 수 있음.
- 2라운드: TD-S05-005를 고침. 메시지 응답 seq가 실제 담긴 메시지보다 앞서던 경쟁 조건으로, 이제 await 전에 seq·state를 잡아 둠. `changes`도 같은 방식으로 정리함. 시험은 messages-seq.test.ts에 추가함.

### web (dev-web, 8커밋 + 1·2라운드 수정)
- 로그인, 방송 목록, 새 방송, 리허설 시작, 콘솔(`/broadcasts/<id>`)을 만듦.
- 빠른 입력은 코어 `parseQuickInput`으로 해석함. 번호를 치면 미리 보기가 뜨고, 번호만 친 채 Enter를 누르면 자세히가 열림. 오류가 나면 고칠 칸에 커서가 감. 있는 번호에는 '고칠까요?'를 묻고, 가격을 바꾸면 기존 찜에도 적용할지 물음(D-084).
- 현재 상품, 상품 보드, 상품 자세히(사유가 필요한 찜 조치, 수동 배정·교체, 차단, 조치 기록)를 만듦.
- 채팅 패널은 주문·취소·멘션·방송자 메시지를 표시하고 본문은 글자로만 보임. '찜으로 바꾸기'는 그에 해당하는 메시지에만 붙음.
- 알림 띠와 창을 만듦: 충돌, 취소 요청, 승계 결정, 보류 찜, 확인 필요.
- 되돌리기: host.* 조치는 5초 기다렸다 보내고, 등록은 5초 안에 상품 닫기로 되돌림(D-083).
- 단축키는 Esc, Ctrl/⌘+Z, Alt/⌥+1, 숫자 키. 모든 창은 처음 포커스가 '닫기'에 있음(D-087).
- 리허설 배너, 가짜 채팅 조작판, 시청자로 보내기를 만듦.
- 실시간 갱신은 SSE와 증분 조회로 함. 410이 오면 다시 맞추고, 재연결·오프라인도 처리함. 쓰기는 같은 요청 ID로 3번까지 재시도함.
- 모든 상태를 한국어 라벨로 보이고(D-088), KST로 표시하며, 375px에서 가로 스크롤이 없음.
- 1라운드 수정 9건:
  - 메시지·전체 조회 사이의 빈틈을 없앰.
  - 다시 연결되면 생성기 상태를 다시 받음.
  - 번호 해석을 코어로 통일함.
  - Enter 순간의 칸 글자를 고정해 둠.
  - 치는 중일 때 사유 거절 창이 끼어들지 않게 함.
  - 보류 만료를 밀리초 단위로 비교함.
  - PROCESSING_FAILED가 오면 바로 따라잡음.
- 2라운드: TE-S05-002를 고침. 늦게 온 '고칠까요?'가 치는 중인 입력을 가로채지 않음. 그때는 빠른 입력 아래 목록에 항목으로 남김(askEdit·EditAsk).

### 시험
- web 단위 시험 13파일·174개에 1라운드에서 26개를 더함. 서버 시험도 추가함.
- adversarial(tests/adversarial/s05)에서 리허설 분리, 메시지 seq 경쟁, 콘솔 저장소 경쟁, 증분 두 인스턴스를 확인함.
- E2E 67개가 모두 통과함(테스터 실행 기준, verify 밖). 다른 기기 갱신은 p99 83ms(상품 500·채팅 1만). 리허설 상품 30·채팅 1,000을 코어 재생과 비교함.
- `pnpm verify`는 6단계 모두 통과함.

## 남은 blocker/major

없음.

## 자율 결정 · 사용자 확인 필요 사항

에스컬레이션된 항목은 없음. 아래 결정은 모두 blocking=false이고 AUTO로 적용함. **HG-1에서 사용자 확인이 필요함**(DECISIONS의 '사용자 확인 필요' 표에 리허설·되돌리기·콘솔 조작 행이 추가됨).

| ID | 결정 요지 |
|---|---|
| D-081 | 리허설은 별도 범위(판매자, 날짜, rehearsal)를 씀. 날짜 기준 API의 기본값은 실제 범위. 리허설로는 차단을 이어받지 않음. 리허설 발송함은 표시만 하고 실행하지 않음. 가짜 채팅은 리허설에만 허용함 |
| D-082 | 서버 생성기가 ingestChat(collector)으로만 씀. 개수 1~10,000(기본 300), 초당 1~50(기본 1). seed와 상태로 결정함. 가짜 채널 ID는 실제 형식이 아님 |
| D-083 | 등록은 바로 기록하고, 5초 안의 되돌리기는 찜이 없을 때만 product.close로 함. host.*는 5초 지연 후 보내고, 되돌리거나 페이지를 닫으면 보내지 않음 |
| D-084 | 빠른 입력 하나로 등록·찾기·고치기를 함. 있는 번호에는 '고칠까요?'를 묻고, 가격을 바꾸면 기존 찜 적용 여부를 물음(기본은 새 찜만) |
| D-085 | 전체 1회 후 증분 조회. '전체+증분=새 전체' 성질을 지키고, 1초는 다른 기기 화면 p99 기준 |
| D-086 | dev-server가 코어에 순수 조회 함수를 최소로 추가함 |
| D-087 | 단축키를 정함. 모든 경고·확인 창의 처음 포커스는 '닫기' |
| D-088 | 상태값 한국어 라벨표를 고정함 |
| ENV-E2E | Playwright 설정은 dev-web이 제공함. verify에 E2E 단계를 넣는 일은 오케스트레이터 몫(D-027) |

추가로 확인할 것:
- TD-S05-004(번호 변경 뒤 조치 기록 필터 기준)는 spec-keeper의 판단이 필요함.
- UX-S05-013의 '시드' 낱말을 풀어 쓸지 결정이 필요함.

## minor / nit 백로그

모두 backlog.yaml의 techDebt에 추가함.

| ID | 심각도 | 영역 | 제목 |
|---|---|---|---|
| RA-S05-004 | minor | web | 410 뒤 전체 다시 받기 실패 시 재시도 없음 → 콘솔이 옛 상태로 멈춤 |
| RA-S05-001 | minor | server | 증분 조회가 매번 범위 전체를 재계산하고, 캐시를 판매자 모두가 8칸 하나로 공유함 |
| RA-S05-002 | minor | server | 리허설 효과를 걸러 내는 발송함 조회 함수·시험이 없음 |
| RA-S05-003 | minor | server | 리허설 생성기 판매자당 상한이 없고 끝난 실행을 정리하지 않음 |
| RA-S05-005 | minor | server | E2E가 typecheck·lint·verify 밖이고, 늘 참인 단언이 있음(changes.test.ts:369) |
| TD-S05-004 | minor | server | 번호 변경 뒤 같은 번호의 새 상품 조치 기록에 옛 조치가 섞임(스펙 확인 필요) |
| UX-S05-003 | minor | web | 사유 창 보내기 버튼 이름 '취소'가 '닫기'와 헷갈림 |
| UX-S05-004 | minor | web | 375px에서 고정 영역이 화면의 59%를 덮음 |
| UX-S05-005 | minor | web | 일반 채팅마다 붙는 '찜으로 바꾸기' 버튼 때문에 한 번에 4개만 보임 |
| UX-S05-006 | minor | web | 스크롤하면 연결 끊김 안내가 안 보임 |
| UX-S05-007 | minor | web | 찜 취소에 키보드 22번, 자주 쓰는 이유에 숫자 키가 없음 |
| UX-S05-008 | minor | web | 잠긴 주 버튼·위험 버튼 hover 시 명암비가 약 1.1:1 |
| UX-S05-009 | minor | web | 번호 오류 시 고치기 칸의 품종·가격이 비어 있음 |
| SA-S05-006 | nit | web | 남겨 둔 '고칠까요?' 항목이 번호 변경 뒤에도 옛 문장을 보임 |
| RA-S05-006 | nit | server | E2E 서버가 모든 인터페이스에서 열림 |
| UX-S05-010 | nit | web | 보류 찜 창 직후 1초간 '0초 전'으로 보임 |
| UX-S05-011 | nit | web | '끝난 방송이에요'가 버튼처럼 보임 |
| UX-S05-012 | nit | web | 휴대폰에서 조치 기록 시각이 잘림 |
| UX-S05-013 | nit | web | 리허설 조작판이 첫 화면 밖에 있고 '시드' 낱말이 보임 |
| UX-S05-014 | nit | server | 리허설 기본 제목이 '1부'로 실제 방송과 같음 |
| UX-S05-015 | nit | web | 로그인 '아이디' 칸에 autoFocus 없음 |

## 추적성 표

| 기준 | 구현 | 시험 |
|---|---|---|
| AC-S05-01 | web App.tsx, LoginPage.tsx, TopBar.tsx | web App.test.tsx, main.test.tsx; e2e basic, attacks |
| AC-S05-02 | web HomePage.tsx, ConsolePage.tsx | web App.test.tsx; e2e basic, misc |
| AC-S05-10 | web ConsolePage.tsx(onEnter·handleDecision·askEdit·typedNext), QuickInput.tsx, quick.ts | console-flows, console, quick; e2e misc, attacks-r1, attacks-r2 |
| AC-S05-11 | web quick.ts | quick.test.ts; adversarial quick-input-consistency; e2e basic |
| AC-S05-12 | web quick.ts, QuickInput.tsx | quick, console-flows; adversarial quick-input-consistency; e2e misc |
| AC-S05-13 | web ActionDialogs.tsx(EditDialog), ConsolePage.tsx, QuickInput.tsx(EditAsk), quick.ts(editQuestion) | console-flows; e2e basic, attacks-r1, attacks-r2 |
| AC-S05-14 | web ProductBoard.tsx, derive.ts | e2e basic, scopes |
| AC-S05-15 | web ProductDetail.tsx | e2e attacks |
| AC-S05-20 | server service.ts(messages), api.ts, views.ts | chat-messages, messages-seq; adversarial messages-seq-race·concurrent |
| AC-S05-21 | web ChatPanel.tsx, console-store.ts, kst.ts | console.test; adversarial console-store-race; e2e misc, attacks-r2 |
| AC-S05-22 | web ActionDialogs.tsx, ChatPanel.tsx | e2e misc, rehearsal-actions |
| AC-S05-30 | web AlertStrip.tsx, AlertDialogs.tsx, derive.ts | console-flows; e2e misc, scopes |
| AC-S05-31 | web AlertDialogs.tsx | e2e rehearsal-actions, keyboard-words; console.test |
| AC-S05-32 | web AlertDialogs.tsx | e2e rehearsal-actions |
| AC-S05-33 | web AlertDialogs.tsx, actions.ts | e2e attacks |
| AC-S05-34 | web ActionDialogs.tsx, ReasonField.tsx, ConsolePage.tsx, words.ts | console-flows; e2e attacks, attacks-r1, rehearsal-actions |
| AC-S05-35 | server service.ts, store.ts, api.ts | chat-messages; web words-kst |
| AC-S05-40 | web undo-queue.ts, UndoBar.tsx | undo-queue, console.test; e2e rehearsal-actions |
| AC-S05-41 | web undo-queue.ts; server server.ts | undo-queue; e2e prod-delay, attacks |
| AC-S05-42 | web ConsolePage.tsx, Modal.tsx, QuickInput.tsx | e2e keyboard-words, misc, attacks-r2 |
| AC-S05-50 | server store.ts, hub.ts, writer.ts | rehearsal, scope-seq; adversarial rehearsal-isolation |
| AC-S05-51 | server generator.ts, api.ts, errors.ts | generator; adversarial rehearsal-isolation; e2e rehearsal-full |
| AC-S05-52 | server service.ts | generator.test |
| AC-S05-53 | dev-notes.md API 계약 | 코드 검사(spec-auditor) 확인 |
| AC-S05-54 | web RehearsalPanel.tsx; server hub.ts | console.test; adversarial console-store-race; e2e rehearsal-actions |
| AC-S05-60 | server writer.ts, check-replay.ts | scope-seq, check-replay |
| AC-S05-61 | server service.ts(changes), views.ts; web scope-data.ts | changes, messages-seq, scope-data; adversarial changes-two-instances |
| AC-S05-62 | web console-store.ts; server service.ts | console-store; adversarial console-store-race, messages-seq-race; e2e realtime |
| AC-S05-63 | web api/client.ts | client.test; e2e realtime, attacks |
| AC-S05-64 | server e2e.ts, commands/e2e-server.ts | e2e realtime, fill |
| AC-S05-70 | web words.ts | words-kst; e2e keyboard-words |
| AC-S05-71 | web ErrorNote.tsx, ConsolePage.tsx, client.ts | console-flows |
| AC-S05-72 | web styles.css | e2e keyboard-words(hover 명암 UX-S05-008 열림) |
| AC-S05-73 | web styles.css | e2e realtime |
| AC-S05-74 | web ConsolePage.tsx | console.test |
| AC-S05-80 | core listBlocked·listMessages; server 차단 이어받기 | core engine-views-s05; server inherit-restart |
| AC-S05-90 | 골든 변경 없음 | core-adapter.test; golden 493 통과 |
| AC-S05-91 | server e2e.ts, e2e-server.ts; web playwright.config.ts | server e2e.test; tests/e2e/s05/* 67개(verify 밖) |
| AC-S05-92 | web kst.ts, words.ts | words-kst |
| TD-S05-005 / SA-S05-005 | server service.ts:627-640, 647-660 | adversarial messages-seq-race·concurrent; messages-seq |
| TE-S05-002 | web ConsolePage.tsx askEdit, QuickInput.tsx asks 목록 | console-flows; e2e attacks-r1, attacks-r2(3회 반복) |

이번 스프린트에서 추가한 회귀 시험:
- adversarial messages-seq-concurrent
- e2e attacks-r2.spec.ts 6건
  - TE-S05-002 반복
  - AC-S05-13 빈 칸에서 고치기
  - AC-S05-13 치는 중 고치기
  - 키보드만으로 '고칠까요?'
  - changed:false인데 치는 중
  - 채팅이 흐르는 중 새로고침

## 다음 스프린트 제안

1. **S06(문자찜 입력·구매자·정산 화면, HG-1)으로 진행.** HG-1에서 D-081~D-088을 사용자와 함께 확인한다.
2. **오케스트레이터가 먼저 할 일(S06 시작 전):**
   - E2E 단계를 `pnpm verify`·CI에 넣는다(RA-S05-005, D-027).
   - tests/e2e를 typecheck·lint 대상에 넣는다.
3. **S06 carryOver 후보:**
   - RA-S05-004: 410 재조회 실패 시 재시도. S06의 휴대폰 화면도 같은 저장소를 쓴다.
   - UX-S05-004·012: 375px 고정 영역과 표. 휴대폰 중심 스프린트와 겹친다.
   - UX-S05-003·007: 사유 창 버튼 이름과 숫자 키.
4. **실행기 스프린트 전 필수(S08·S11):** RA-S05-002. `rehearsal=false`로 고정한 발송함 조회 함수와 시험을 둔다.
5. **spec-keeper 확인:**
   - TD-S05-004: 조치 기록을 상품 key로 필터할지
   - UX-S05-013: '시드' 낱말
6. **성능 백로그:** RA-S05-001(판매자별 캐시, 다중 판매자 부하 시험), RA-S05-003(생성기 상한).
