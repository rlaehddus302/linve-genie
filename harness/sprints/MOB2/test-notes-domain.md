# MOB2 test-notes (test-domain)

폴더: `tests/adversarial/mob2/` — 4개 파일, 72개 시험. 그중 1개는 일부러 실패하게 둔 시험이다(TD-MOB2-001).

## 파일
- `pending-window-property.test.ts` (AC-MOB2-34)
  - 웹 `pendingWindowPassed`·`isPendingTimedOut`·`claimWord`·`alertCounts`·`splitPending`·`nextPendingFlip`을 코어 R-5와 견준다. 화면 쪽 값은 엔진 조회 결과를 서버의 `withIsoTimes`로 바꿔 `fromFull`에 넣어 만든다.
  - 공개 길 셋: 바로 등록, READY 뒤 `product.open`, 번호 바꾸기(`product.renumber`)로 보류 찜이 있는 번호로 옮김.
  - 속성 시험은 시드를 고정했다(20261026·34·341). 경계 사례(0초 W·같은 밀리초·1ms 넘김·정각)는 세 길 × 7개로 따로 둔다.
  - 결과: 통과. 경계가 같다.
- `same-request-once.test.ts` (AC-MOB2-46)
  - 서버 + PGlite에서 `product.register`·`host.cancel`·`product.hold`·문자찜 네 가지를 같은 요청 번호로 보낸다.
  - 보내는 방식 다섯: 응답을 잃은 뒤 다시(같은 인스턴스·새 인스턴스), 동시에 둘(같은 인스턴스·두 인스턴스), 10번 동시(세 인스턴스).
  - 확인하는 것: 이벤트 1개, outbox·출력 작업·라벨 키가 한 번 보낸 것과 같음, 모든 응답의 결과(seq·changed·효과·구매자)가 같음.
  - 다른 본문을 같은 번호로 보내면 처음 결과를 돌려준다(AC-S04-25). 실제·리허설 범위에 같은 번호를 동시에 보내도 기록은 하나다.
  - 결과: 통과.
- `vacated-engine.test.ts` (D-MOB2-04 보강)
  - `captureVacated`·`vacatedLine`을 실제 엔진 상태로 돌린다.
  - 사례: AUTO·ASK·REOPEN × 대기 0·2, ASK인데 대기 없음, 일시 중지, 재고 2, 무효, 취소 요청 승인, `<b>해커</b>`, 대기 찜 취소, 옵션 변형.
  - 결과: 통과.
- `resend-board.test.ts` (AC-MOB2-45 보강)
  - `ResendBoard`의 차례, 겹치지 않음, 내린 항목, 던진 항목을 본다.
  - **TD-MOB2-001이 실패한다(아래).**

## 지적
- **TD-MOB2-001** (major, web — `apps/web/src/lib/resend-board.ts` `flush`)
  - 다시 보내는 중에 회복 알림이 또 오면 버린다(`if (this.#running) return`).
  - 그래서 이런 순서가 생긴다: 회복 #1에 15번 등록을 다시 보냄 → 그 순간 연결이 또 끊겨 실패하고 다시 올라옴 → 문자찜 응답을 기다리는 동안 회복 #2가 옴(버려짐) → 연결은 이어졌는데 15번 등록은 다음 끊김·회복 때까지 가지 않는다.
  - 실패 줄에는 "연결이 돌아오면 저절로 다시 보내요."가 그대로 있어서, 판매자는 기다리기만 한다. 그동안 15번 채팅 찜은 보류로 쌓이고, 30초가 지나면 공개해도 만료된다.
  - 고칠 방향(제안): 보내는 중에 온 회복 알림을 기억했다가, 지금 차례가 끝나면 한 번 더 돈다. 동시에 하나라는 규칙은 그대로 지킨다.

## 메모 (시험 아님)
- AC-MOB2-34의 W 목록에 600이 있는데, 코어 설정표는 `claim.preOpenWindowSec`를 `int(0, 300)`으로만 받는다. 그래서 600은 순수 함수 대조에만 넣었고, 엔진 대조는 0·1·30·45·300으로 했다(스펙 문장의 사소한 차이 — spec-keeper 확인용).

## 수정 라운드 2 (test-domain)
- AC-MOB2-34: D-MOB2-11대로 순수 함수 대조의 W 목록을 0·1·30·45·300으로 바꿨다(600 → 300). 600은 "설정표가 거절"하는 범위 밖 확인에만 남았다. 위 메모는 판정으로 닫혔다.
- 새 `resend-received-fill.test.ts` (RA-MOB2-02 · D-MOB2-09 확인)
  - 화면이 채우는 값(`kstTime(처음 누른 때)`)을 화면의 `readReceived`로 읽고, 엔진에 늦게(최대 2시간, KST 자정 앞뒤 2시간) 넣는다.
  - 확인: 채운 값 = 처음 누른 초, 엔진 순위 시각(`rankTime`) = 처음 누른 초(자정을 넘겨 들어가도 전날), `RECEIVED_TIME`에서 끊긴 사이 같은 번호 채팅찜보다 문자찜이 1등(R-7 역전), 채팅찜 대기. 속성 400회(시드 고정) + 경계 3건(23:59:59.900, 00:00:00.000, 끊김 1시간 넘김).
  - 결과: 통과.
- TD-MOB2-001: 고쳐짐(`98019ed5`) — `resend-board.test.ts` 통과.
- SA-MOB2-04: 웹 단위 시험 `mob2-screens`·`sms-page`·`console-flows`·`mob2-register-resend`를 두 번 더 돌려 두 번 모두 70/70. 흔들림 없음.
- MOB2 적대 시험 전체: 76/76 통과(`TZ=Asia/Seoul`).

## 수정 라운드 3 (test-domain)
- AC-MOB2-34 (D-MOB2-15): 새 `pending-seen-property.test.ts` — 화면 판단을 처음 받은 시각 `seen`으로 잰 길을 견준다.
  - 속성(세 공개 길, 시드 고정): `seen` ≥ at, 지금 ≤ T에서 "시간 지남"이면 T 공개에서 반드시 `EXPIRED`. `seen` = at·지금 = T이면 같음. 낱말·알림 수·보류 찜 창 나눔도 같은 판단.
  - 속성(RA-MOB2-04): 휴대폰 시계 차이 Δ −5분~+5분(±90초 포함). 어떤 Δ에서도 시간 지남 ⇒ `EXPIRED`, 바로 받았으면 Δ와 상관없이 같음.
  - 고정: AC-MOB2-35 시작 조건(시계 +90초, W=30 — 받자마자 보류, 30초 정각 보류, 30초+1ms 시간 지남, 다음 바뀜 시각). `seen` 기록에 그 찜이 없으면 하루 뒤에도 시간 지남 아님·다음 바뀜 없음. `seen` 없는 자료는 at.
  - `nextPendingFlip` = 아직 안 바뀐 것 중 가장 이른 `seen` + W×1000 + 1(속성).
  - 실제 `ClaimSeen.note`: 처음 값 유지, 새 목록에 처음 든 찜만 그때 시각, 새 기록(새로고침)은 다시 잼, 날짜·리허설별 따로. note 길 속성(받은 시각 ≥ 모든 at)도 엔진보다 먼저 시간 지남 없음.
  - 기존 `pending-window-property.test.ts`(`seen` 없는 자료 = at 기준)는 그대로 둔다 — 대체 길(저장소를 거치지 않은 자료) 회귀.
- D-MOB2-14 (SA-MOB2-03·TE-MOB2-006·RA-MOB2-06): 새 `register-resend-server.test.ts` — 결정이 기대는 서버 성질을 실제 서버 + PGlite로 확인.
  - (가) 다른 기기가 먼저 등록 → 다시 보낸 등록 `changed:false`, 15번 청보석 20,000원·판정 그대로, 같은 요청 번호 또 보내도 같음(서버 다시 켬 포함).
  - (나) 응답만 잃은 자기 등록 → 다른 기기 등록 `changed:false`, 다시 보내면 `changed:true`·같은 seq·기록 1(서버 다시 켬 포함).
  - (다) 두 인스턴스 동시 6회 → 상품 하나, `changed:true` 정확히 하나, 내용 = 이긴 쪽 본문, 1등 1·대기 1.
  - 화면 쪽 처리(창 없음·한 줄 안내)는 웹 단위 시험(`mob2-register-resend.test.tsx`)·E2E 몫.
- 결과: MOB2 적대 시험 89/89, 새 두 파일 3번 반복 13/13씩. typecheck·eslint 통과.
- 남은 지적: 없음(도메인 쪽).

## 수정 라운드 4 (test-domain)
- 새 `round4-words.test.ts` — 개발 고침 `0c1fa5b3` 확인(5건, 모두 통과).
  - RA-MOB2-07: 실제 엔진 `previewMerge`가 낸 보류 찜 중복을 `mergeWords(…, now)`로 바꾼 글 = `claimWord(data, claim, now)`, 시간 지남 ⇔ `isPendingTimedOut`(처음 받은 시각 기준, W초 정각 ±1ms 포함) 속성(시드 고정, 두 쪽 모두 20번 넘게 지나감). 고정: 30초+1ms 뒤 "보류 · 시간 지남", 30초 안 "보류".
  - D-MOB2-18 (SA-MOB2-07): `WriteError autoResend` — 네트워크 실패 "저장하지 못했어요. 인터넷 연결을 확인해 주세요.", 저장 실패 "저장하지 못했어요.", "눌러 주세요"·"다시 시도해 주세요" 0개, "다시 보내기" 단추·자세히 그대로, 바뀐 것은 첫 문장뿐. autoResend 없음·false면 옛 문장. 저절로 보내지 않는 실패(409·PROCESSING_FAILED·400)는 autoResend를 줘도 그린 결과가 똑같다.
  - D-MOB2-17 (TE-MOB2-007): `NO_STATION_SHORT` = 결정 문장, `stationLeadShortText`가 출력 기기 없음·대기 있음에서 그 문장, 대기 0이면 없음, 끊김 문장은 그대로.
  - 줄 수(150% 두 줄 이하)·고정 영역 높이는 글꼴 폭이 필요해 E2E(test-e2e) 몫으로 둔다.
  - 문자찜 화면 판단(`autoResendShown`)은 소스로 대조: 받은 시각을 채운 경우도 `failedKeyRef`와 같은 키를 적어 저절로 보내는 조건과 화면 안내가 같은 값을 본다.
- 결과: MOB2 적대 시험 94/94. typecheck·eslint 통과.
- 남은 지적: 없음(도메인 쪽).
