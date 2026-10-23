# PL1A dev-notes

## dev-server (AC-PL1A-01~17·20 서버 몫)

### 바뀐 공개 모양 (web·test가 먼저 읽을 것)

**포장 목록 응답 `GET /api/days/:date/packing`**
- 봉인한 날짜에만 맨 위에 `sealed: true`가 더해진다. 봉인 안 한 날짜(봉인 전·유튜브 아닌 날짜)는 **`sealed` 칸이 없다**(BASE 응답 그대로 — `false`를 싣지 않는다). 웹은 `sealed === true`일 때만 볼 수만 있는 화면으로.
- 나머지 칸(`date`·`seq`·`entries[]` — 구매자마다 상태 말·송장·품목·`parcel`)은 봉인 직전과 같다.

**새 오류 코드 `LEDGER_UNREADABLE`** (500)
- 문장: `30일이 지나 봉인한 기록을 읽지 못했어요. 운영자에게 알려 주세요.`
- 봉인 날짜의 장부를 읽을 수 없을 때(모르는 판, `/2`인데 판매 행 `amount` 없음, 다시 세운 상태가 장부와 맞지 않음): 확인서 데이터·PDF·PNG·JPG·전원 PDF·그림 묶음·확인서 구매자 목록(`receipt-buyers`)·판매대장(그날·기간·전체 — 그 날짜가 들면 파일 전체)·포장 목록·포장 라벨(데이터·PNG·PDF).
- 지난 구매는 200이고 그 날짜만 빠진다. 오류 로그는 `{ level: 'error', code: 'LEDGER_UNREADABLE', date }`만.

**봉인 날짜의 쓰기 409 `SEALED`** (`30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.`)
- 포장 명령 `POST /api/days/:date/packing`(포장 완료·포장 취소·배송 완료·배송 취소)은 입력 형식 검사(400) 뒤, 같은 요청 번호 확인보다 먼저 409. 범위 락 안에서 본다.
- `POST /api/print/packing { date: 봉인 날짜 }`는 입력 검사 뒤, 같은 요청 번호·라벨 꺼짐(`LABELS_OFF`)보다 먼저 409.
- `POST /api/days/:date/receipt-links`·`/all`은 409(링크·요청 번호 기록 없음). `revoke`·목록·조회는 그대로 받는다.
- 택배 접수·취소는 이미 409였다(T1) — 바꾸지 않았다.

**백업 파일 형식 3** (`format: 'livejjim-seller-backup'`, `version: 3`)
- 범위 칸 차례: `date`·`rehearsal`·**`sealed`**·`events`·`seq`·`broadcasts`(봉인 칸이 이벤트 앞이라 봉인 범위를 재생하지 않고 읽는다).
- `sealed`: 봉인 안 한 범위 `null`, 봉인 범위 `{ sealedAt(UTC ISO — 범위 행 값), ledger(저장된 장부 글 그대로), ledgerDigest(저장된 장부 요약값 그대로) }` — 칸은 이 셋만.
- 파일 요약값: 형식 3이면 범위 조각이 `["scope", 날짜, 리허설인지, 봉인 칸]`(형식 2는 지금처럼 `["scope", 날짜, 리허설인지]`). `backupDigest(file)`은 `file.version`을 보고 맞춰 계산한다(시험이 고친 파일을 다시 요약할 때 그대로 쓰면 된다).
- 읽는 번호 `BACKUP_READ_VERSIONS = [2, 3]`. 형식 2는 봉인 칸 없이 모든 범위를 재생(BASE와 같음). 모르는 번호 문장은 `이 서버가 읽을 수 없는 형식 번호예요(2·3만 읽어요).`
- 검사 요약 `BackupScopeSummary`에 `sealed`(boolean)·`snapshots`(봉인 0, 그 밖 1)·`outbox`(재생이 낸 효과 수, 봉인 0)를 더했다.
- 봉인 범위 검사 순서와 문장(`SEALED_BACKUP_MESSAGES` export):
  1. 봉인 칸 모양(객체·칸 셋·ISO·글) — `범위 YYYY-MM-DD의 봉인 칸 형식이 올바르지 않아요.` (`sealed: {}`·`"x"`·`ledger: null` 등)
  2. 리허설 범위 — `리허설 범위는 봉인할 수 없어요.`
  3. sha256(ledger) = ledgerDigest — `범위 YYYY-MM-DD의 봉인 장부 요약값이 맞지 않아요(장부가 바뀌었어요).`
  4. `readLedger`로 읽힘·장부 `date` = 범위 날짜 — `범위 YYYY-MM-DD의 봉인 장부를 읽을 수 없어요.`
  5. 이벤트마다 형식·seq 1부터 빈틈없음·이벤트 요약값·본문의 type/seq/at(지금 문장 그대로) — 엔진은 부르지 않는다
  6. 범위 seq = 이벤트 수, 방송 목록 = 이벤트로 정한 목록 = 장부의 방송(ID·날짜·제목·끝난 시각) — 다르면 4의 "읽을 수 없어요"
  7. 파일 끝에서 파일 요약값(지금 문장)
- 같은 범위 `sealed` 두 번(JSON 키 중복)은 칸 차례 검사에서 `범위의 형식이 올바르지 않아요.`로 거절된다.
- 복구·가져오기: 봉인 범위는 범위 행에 봉인 시각·장부·장부 요약값(파일 값), 이벤트는 저장된 그대로(채팅 원문 없음 → `raw = false`, 요약값은 원문 없이 다시 계산), 방송 줄 그대로. 상태 스냅샷·발송함·채팅 원문 행을 만들지 않는다. 이벤트 행의 `changed` 칸은 재생 없이 정한다: 장부의 방송을 처음 시작한 이벤트·장부의 끝난 시각과 같은 처음 끝낸 이벤트만 `true`, 다른 방송 시작·끝은 `false`, 그 밖은 실패 표시가 아니면 `true`(봉인 범위에 쓰기가 없어 이 칸을 읽는 곳은 다음 백업의 방송 목록뿐).

### 봉인 날짜 문서를 만드는 방법 (D-PL1-04)
- 새 파일 `apps/server/src/sealed-state.ts`: 봉인 장부(`readLedger` — `youtube/seal.ts`는 import만, 고치지 않음)의 판매·상품·구매자·정산 기록을 코어 상태 모양으로 옮겨 담는다(이벤트를 적용하지 않는다 — 판정 없음). 그래서 확인서·판매대장·포장·라벨·지난 구매는 봉인 전과 **같은 코드**(문서 패키지·`packing.ts`·`past.ts`·`label-data.ts`)로 만든다.
- 장부에 없는 값: 방송 설정 스냅샷은 그 범위의 이벤트 기록에 남은 `broadcast.start`(채팅이 아니라 봉인이 지우지 않는다)에서 읽는다. 옵션 상품의 옵션 항목은 변형 글·판매의 고른 옵션에서 모은다(선택지 가격 차이는 0 — 문서는 찜의 단가 스냅샷만 쓴다). 찜 시각은 0 → 판매대장 "찜 시각"은 `closing.ts`가 빈칸으로 바꾼다(D-PL1-03).
- 안전장치: 다시 세운 상태를 코어 조회 함수로 읽은 값(정산 묶음 전부·판매·상품·장부의 구매자)이 장부에 적힌 값과 하나라도 다르면 읽을 수 없는 장부로 본다(500) — 틀린 숫자를 문서로 내지 않는다(D-O3-15).
- (판매자, 범위, 장부 글의 sha256)마다 다시 세운 상태를 32개까지 메모리에 둔다(장부 칸이 바뀌면 다시 세운다).
- **코어 영역을 한 줄 건드렸다(dev-core 몫)**: `packages/core/src/engine.ts`에 `export { emptyPMap, pset } from './engine/pmap.ts'` — 영속 맵을 만드는 순수 도우미. 판정 로직은 없다. 코어 단위 시험 988개 통과.

### 판매자 자동 백업 실패 경보 (D-PL1-02)
- `ops.ts` `Alerter.observe`: `seller` 칸이 있는 `BACKUP_FAILED` 오류 로그(BackupScheduler가 이미 남기던 줄)를 `{ level: 'alert', code: 'BACKUP_FAILED', count, seller }` 경보로. 같은 판매자는 10분에 한 번(그 사이 수는 다음 `count`). 운영 백업 명령(seller 없음)은 그대로. `BACKUP_PRUNE_FAILED`는 경고 로그만. `/ops/status`는 바꾸지 않았다.
- `docs/DEPLOY.md` 경보 표 `BACKUP_FAILED` 줄을 고쳤다.

### 시험 (서버, `apps/server/test/pl1a-*.test.ts`)
- `pl1a-support.ts`: 날짜 A(2026-09-01 — 옵션 없는 1부·2부, 옵션 방송 3부(변형·수량 2·3), 산 적 없는 시청자 채팅, 문자찜(전화번호), 가격 변경·할인·직접 수령·입금·환불·배송비 따로 정함, X 배송 완료(송장)·문자 구매자 포장 완료·Y 포장 대기), 날짜 B(2026-09-20 — X가 또 삼), 리허설 범위. `sealA`는 가짜 시계를 2026-10-01 00:00:01 KST로 두고 `Sealer.runOnce()`.
- `pl1a-sealed-docs.test.ts`(AC-10~17·20), `pl1a-backup.test.ts`(AC-01·03~07), `pl1a-backup-check.test.ts`(AC-02 — `@livejjim/core`의 `applyEvent`를 감싸 셈), `pl1a-alert.test.ts`(AC-08·09).
- AC-06 시험 자료: `apps/server/test/fixtures/pl1a/v2-plain.json.gz`·`v2-sealed.json.gz`는 **BASE 코드(backup.ts를 고치기 전)** 로 만든 형식 2 파일, `*.base.json`은 그때 BASE의 검사 요약·복구 결과·날짜 조회·거절 문장(`범위 2026-09-01의 seq 4에서 다시 계산하지 못했어요.`).
- 기존 시험 기대값 교체는 `i2-backup.test.ts`의 `version: 2 → 3` 한 곳(D-PL1-01 주석).

### 스펙과 다르게 읽은 곳 / 확인 필요 (disputesWithSpec 후보)
- **AC-PL1A-01 "유튜브 닉네임이 파일 어디에도 없다"**: 봉인 장부(D-Y11)는 산 사람·정산 기록이 있는 사람의 표시 이름(유튜브 닉네임)을 남긴다(`youtube-seal.test.ts`가 "산 사람은 장부에 남는다"로 고정). AC는 `ledger`가 저장된 장부와 바이트가 같아야 한다고도 해서 두 문장을 함께 지키려면 "닉네임" = **산 적도 정산 기록도 없는 시청자의 닉네임**으로 읽어야 한다. 시험은 그 시청자의 닉네임·채팅 글과 A 이벤트 본문에 `text`·`nick` 칸이 없음을 본다. 산 사람의 닉네임까지 빼려면 장부 형식(유튜브 쪽)을 바꿔야 한다.
- **AC-PL1A-01 Given의 "택배 기록"**: 시험 장면 A에 택배 접수(T1)는 넣지 않았다 — 택배 접수 기록은 범위와 따로 있는 표(`parcels`)라 봉인·형식 3과 상관이 없고, 봉인 날짜의 접수·취소 409는 AC-16 시험이 본다.
- **합친 구매자의 순서**: 장부의 구매자 행에는 "합친 순서"가 없어 다시 세운 상태의 합친 구매자 목록은 처음 기록된 순서다. 한 구매자에 둘 넘게 합친 경우 지난 구매의 "찾은 까닭" 순서가 봉인 전과 다를 수 있다(금액·줄에는 영향 없음).
- **AC-PL1A-07**: 봉인 전 백업을 복구하면 다시 만든 발송함 행(`restored = true`)이 생기고, 봉인 작업은 그 행을 지우지 않고 문구만 비운다(기존 봉인 작업 그대로 — 범위 밖). 그래서 그 경우 A의 발송함 행은 0이 아니다(시험은 스냅샷·채팅 원문 0만 본다).

### 다음 영역에게
- **dev-web**: 포장 목록 응답 타입에 `sealed?: true` 하나만 더하면 된다(`apps/web/src/api/types.ts`). 봉인 날짜면 `PackingChecklist`의 체크 칸·포장/배송 버튼·취소·송장 칸을 그리지 않는다 — 서버도 409로 막는다. 포장 라벨 PNG·PDF는 봉인 날짜에도 200이다. 봉인 날짜 문서가 500 `LEDGER_UNREADABLE`이면 서버 문장을 그대로 보이면 된다.
- **test-domain (AC-91)**: 위 검사 순서·문장을 보라. 64MB 넘는 장부 글은 JSON 스트림 상한(`JSON_VALUE_MAX_LENGTH` = 64MiB)에서 거절된다(그 문장은 json-stream의 것). 바르게 만든 형식 3 파일은 `GET /api/export/records.json.gz`로 받으면 된다. 고친 파일은 `backupDigest(file)`로 다시 요약해 맞춘다.
- **test-e2e (AC-90)**: `/_e2e/dates { kind: 'youtube' }` + `/_e2e/seal`로 봉인하면 포장 목록에 `sealed: true`, 같은 화면에서 `POST /api/days/<날짜>/packing`은 409 `SEALED`. 서버 쪽 변경은 없다.
- **합치는 트랙**: AC-PL1A-19(봉인 날짜에서 포장 라벨 출력 버튼 숨기기)는 웹 몫. 서버는 이미 `POST /api/print/packing`을 409로 막는다.

## [web] 봉인 날짜 포장 모드 (AC-PL1A-18·20)

**바꾼 곳**
- `apps/web/src/api/types.ts`: `PackingList.sealed?: true`.
- `apps/web/src/lib/use-packing.ts`: `usePackingList()`가 `sealed: boolean`을 돌려준다(응답 `sealed === true`일 때만 true).
- `apps/web/src/components/PackingPage.tsx`: 데이터 받기(`ReadyPacking`이 `sealed`를 넘김)와 `PackingChecklist`만 고쳤다. `PackingLabelSection`은 손대지 않았다(PL1B 몫).
  - 봉인 날짜면 체크리스트 머리 아래에 `SEALED_VIEW_ONLY`("30일이 지나 봉인한 날짜예요. 볼 수만 있어요.")를 `<p class="notice" data-tone="info">`로 둔다. role이 없는 늘 보이는 글이다.
  - 품목 줄은 체크 칸 없이 `<div class="pack-item">`로 그린다(번호·품종·옵션 글·수량은 같은 모양).
  - 다음은 그리지 않는다: 담음 수, 결과·오류 칸, `포장·배송` 버튼 묶음 전체(포장 완료·배송 완료로 적기·송장번호 고치기·포장 완료 취소·배송 완료 취소·다음 구매자), "모두 담으면" 안내, 택배 잠금 안내(접수를 먼저 취소하라는 글. 봉인 날짜엔 접수 취소도 409라서).
  - 머리(이름·날짜·상품 수·입금·상태 말·송장)와 택배 줄, 포장 목록 줄, 걸러 보기는 봉인 전과 같다. 바뀐 품목 안내도 상태 정보라 그대로 둔다.
- 시험: `apps/web/test/pl1a-sealed-packing.test.tsx` (6개).

**test-e2e (AC-PL1A-90)**
- 걸러 보기 단추 이름이 "포장 완료"·"배송 완료"라서, 넓은 화면에서는 `getByRole('button', { name: '포장 완료' })`가 목록 쪽 단추를 잡는다. 버튼 0개 단언은 `getByRole('region', { name: '체크리스트' })` 안으로 좁히거나 `exact: true`와 함께 375px 화면(구매자를 열면 체크리스트만 보임)에서 하라.
- 안내 문장은 `getByText('30일이 지나 봉인한 날짜예요. 볼 수만 있어요.')`. role=status가 아니다.
- 체크 칸은 체크리스트 안 `checkbox` 0개, 송장번호 칸은 창을 열 버튼이 없어 생기지 않는다.

**합치는 트랙 (AC-PL1A-19)**
- `PackingChecklist`에는 이미 `sealed` prop이 있다. `<PackingLabelSection ... />` 호출에 `sealed={sealed}`를 더하고, 그 칸에서 `sealed`면 "포장 라벨 출력" 버튼만 그리지 않으면 된다(그림 저장·라벨 PDF는 그대로). 라벨 꺼짐 안내와 봉인이 겹치면 봉인 쪽이 우선이다(서버도 봉인 409가 먼저).

## [server] 감사 뒤 minor 수정 — 판매자 데이터 안전 (SA-PL1A-02, RA-PL1A-02·SA-PL1A-04·TD-PL1A-003)

spec-keeper가 DECISIONS에 옮길 결정 (AUTO, 판매자에게 안전한 쪽):

1. **SA-PL1A-02 — 이스케이프로 숨긴 `__proto__`도 거절**: `backup.ts` `hasProtoKey`의 지름길이 원문에 `__proto__`가 없으면 바로 false였다. JSON 이스케이프(`"__proto__"`·`"__proto__"`)는 원문에 그 글자가 없지만 JSON.parse 뒤 같은 칸이 된다. 지름길을 "`__proto__`도 `\u`도 없을 때만"으로 좁혔다 — `\u`가 있으면 reviver로 끝까지 읽는다. 정상 장부는 JSON.stringify가 만든 글이라 제어 글자·짝 없는 서로게이트가 아니면 `\u`가 생기지 않아 큰 장부도 보통은 지름길을 탄다. 문장은 그대로 `SEALED_BACKUP_MESSAGES.unreadable(date)`.
2. **RA-PL1A-02 / SA-PL1A-04 / TD-PL1A-003 — 백업 검사와 봉인 날짜 문서가 같은 기준**: 백업 파일 검사(`checkSealedField`·`SealedScopeCheck`)가 `readLedger`만 봐서, 봉인 날짜 문서(`sealed-state.ts` `stateFromLedger` — 찜 금액 = 단가 × 수량, 1등 짝, 다시 세운 값 = 장부 값 `matchesLedger`)가 못 읽는 장부를 받아들였다. 그러면 가져온 뒤 그 날짜 확인서·판매대장(전체 포함)이 계속 500 `LEDGER_UNREADABLE`이 된다. 이제 `SealedScopeCheck.finish`가 방송 목록 대조 뒤 **같은 함수 `stateFromLedger`**를 부르고 null이면 파일 전체를 `SEALED_BACKUP_MESSAGES.unreadable(date)`("범위 날짜의 봉인 장부를 읽을 수 없어요.")로 거절한다 — 검사·바꾸기 복구·빈 판매자 가져오기 모두, 아무것도 바꾸지 않는다.
   - 방송 설정 스냅샷도 같은 함수로 읽는다: `sealed-state.ts`에 `startSettings(body)`를 꺼내 문서 쪽 `broadcastSettings`와 백업 검사가 함께 쓴다(각 장부 방송을 처음 시작한 broadcast.start — 복구가 `changed = true`로 적는 바로 그 줄).
   - 엔진 재생은 여전히 없다(AC-PL1A-02 그대로 — `stateFromLedger`는 판정 없이 기록을 옮겨 담고 코어 조회 함수로 대조한다).
   - 재생 검사 명령(`checkReplay`의 봉인 범위)은 바꾸지 않았다 — 요약값만 본다. 같은 기준을 넣을지는 다음 스프린트 판단(DB 안 장부는 봉인 작업이 만든 것이라 위험이 낮다).
- 시험: `apps/server/test/pl1a-backup-ledger.test.ts` — 이스케이프 `__proto__` 3곳 거절·이스케이프만 있는 장부 통과, 문서 기준 위반 4가지(찜 금액, 1등 짝 없음, 구매자 소계, 판매 하나 뺌) 검사·두 복구 거절·DB 그대로, 같은 장부를 DB에 넣으면 문서 500. 고치기 전 코드에서 두 시험 모두 실패함을 확인했다.
