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
