# PL1A 수용 기준 — 30일 봉인 날짜의 백업·문서 (마무리 다듬기, 서버 중심)

- 스프린트: PL1A (6단계, 마무리 다듬기 — **새 기능 없음**) · spec ID: **DAT-03**, **DAT-04**, **DAT-06**, **STL-04**, **STL-06**, **STL-08**, **STL-10**, **BUY-05**, **SYS-05** · 규칙: DOMAIN_RULES 변경 없음
- 근거 결정: **D-I2-22**(봉인 날짜 백업·문서 — 이미 결정), **D-O3-12**(장부 판 `/2`), **D-PL1-01~D-PL1-04**, **D-PL1-10**, 감사 뒤 **D-PL1-11~D-PL1-15**(AUTO), D-Y11, D-I2-11, D-O3-15, D-036
- 이어받는 수용 기준: I2의 **AC-I2-66**(백업)·**AC-I2-67**(문서) — 이 문서가 그 둘을 구현 가능한 세부로 대신한다(`harness/sprints/I2/acceptance.md:425`). AC-I2-67의 "장부 형식에 찜 시각" 문장은 D-PL1-03으로 이번에 하지 않는다.
- 개발 영역: **server**(`apps/server/**`, `docs/DEPLOY.md`) → **web**(`apps/web/**`) · 테스트: **domain**(`tests/adversarial/pl1a/**`), **e2e**(`tests/e2e/pl1a/**`)
- 같은 BASE에서 **PL1B가 다른 작업 폴더에서 동시에** 개발된다. 아래 "파일 경계"를 지킨다.

## 금지 경로 (유튜브 — 사용자가 맥북에서 작업 중)

이 스프린트의 어떤 커밋도 아래를 **고치지 않는다**(읽기·기존 export의 import는 된다). 고쳐야만 할 것 같으면 고치지 말고 dev-notes와 `disputesWithSpec`으로 올린다.

- `apps/server/src/youtube/**` — 특히 `youtube/seal.ts`(`LEDGER_FORMAT`·`buildLedger`·`readLedger`·`sealedView`)는 import해서 쓰기만 한다. 장부 판은 `/2` 그대로(D-PL1-03).
- 웹의 유튜브 화면 파일 — `apps/web/src/components/ConsoleYoutube*.tsx`, `YoutubeConnection.tsx`, 그 밖에 파일 이름에 `youtube`·`Youtube`가 든 `apps/web/src/**` 파일
- `tests/e2e/i3/**`, `tests/e2e/y1/**`

## 모호한 점 → 결정 → 수용 기준

| 모호한 점 | 결정 | 수용 기준 |
|---|---|---|
| 백업에 봉인 범위를 어떻게 담나, 형식 번호는 | D-PL1-01 형식 3, 범위마다 `sealed` | AC-PL1A-01·06 |
| 봉인 범위의 파일 검사 | D-PL1-01 재생 없이 seq·이벤트 요약값·장부 요약값·읽기·날짜·실제 범위 | AC-PL1A-02·03 |
| 복구·가져오기 뒤 봉인 | D-PL1-01 봉인된 그대로, 다시 봉인하지 않음 | AC-PL1A-04·05·07 |
| 판매자 자동 백업 실패를 운영자가 어떻게 아나 | D-PL1-02 운영 경보(`seller` 칸) | AC-PL1A-08·09 |
| 장부 판 `/3`(찜 시각) | D-PL1-03 이번엔 안 함, 봉인 날짜 "찜 시각"은 빈칸 | AC-PL1A-11·12 |
| 봉인 날짜 문서·읽을 수 없는 장부·쓰기 | D-PL1-04 | AC-PL1A-10~18 |
| PL1B와 겹치는 파일 | D-PL1-10 파일 경계 | "파일 경계", AC-PL1A-19 |

## 이번 스프린트의 스펙·골든 변경 (spec-keeper)

| 파일 | 변경 |
|---|---|
| `docs/spec/SPEC.md` | v0.1.31 — DAT-03 "자동 백업 실패"(D-PL1-02), DAT-04 "봉인 범위의 백업 세부"(D-PL1-01)·"봉인 날짜의 문서 세부"(D-PL1-03·04) |
| `docs/DECISIONS.md` | 새 절 "마무리 다듬기 (PL1A·PL1B 자율 결정)" D-PL1-01~D-PL1-10(AUTO), "사용자 확인 필요"에 "봉인 날짜 장부의 찜 시각 (PL1)" 행 |
| `tests/golden/**` | PL1A 몫 새 골든 없음(판정·정산·파서 규칙이 바뀌지 않는다 — 봉인 날짜 문서는 "봉인 직전과 같다"를 서버 시험이 직접 비교한다). `known-unimplemented.yaml` `sprint: PL1`, 허용 목록은 비어 있다. PL1B 몫 초안 `drafts/pl1b/billing/granted.json`은 어떤 러너도 읽지 않는다 — PL1A 작업 폴더의 요금 골든 시험(파일 4·사례 67)은 그대로 통과해야 한다 |

## 공통 전제

- 이미 합쳐진 모든 결과(`pnpm verify`)가 그대로 유지된다. 외부 계정·실기기·실제 유튜브 없이 돈다(가짜 시계, 시험 제어 경로 `/_e2e/dates`·`/_e2e/seal`, 기존 봉인 작업 `Sealer`).
- **"봉인 직전과 같다"** = 같은 서버 시각(가짜 시계)으로 봉인 직전에 받은 응답·파일과 봉인 뒤에 받은 것을 비교해, 만든 시각(문서 정보·파일 이름의 시각)과 이 문서가 따로 적은 칸(판매대장 "찜 시각") 말고 **바이트·JSON이 같다**. PDF·엑셀은 글자·셀·쪽 순서, PNG는 픽셀이 같다.
- 시험 날짜 A = 유튜브 채팅·확정(옵션 없는 방송과 옵션 방송을 각각 한 번 이상, 수량 2 이상 변형 포함)·문자찜·입금·환불 기록·배송비 조정·포장 완료·배송 완료(송장)·택배 기록이 있는 실제 범위, 가짜 시계로 A + 30일 0시(KST)를 지나 봉인. 날짜 B = 봉인 전 실제 범위. 리허설 범위 하나.
- 태그: `[server]` = dev-server(`apps/server/**`·`docs/DEPLOY.md`), `[web]` = dev-web(`apps/web/**`), `[domain]` = test-domain(`tests/adversarial/pl1a/**`), `[e2e]` = test-e2e(`tests/e2e/pl1a/**`). 의존 순서 server → web. dev-server는 바뀐 공개 모양(백업 형식 3의 `sealed` 칸, 포장 목록 응답의 `sealed`, 새 오류 코드 `LEDGER_UNREADABLE`)을 `harness/sprints/PL1A/dev-notes.md`에 먼저 적는다.
- 기존 시험의 기대값 교체는 이 스프린트가 바꾼 것(백업 형식 번호 2→3, 봉인 날짜 동작)에 한한다 — 바꾼 곳마다 근거 결정 번호(D-PL1-xx)를 주석으로. 그 밖의 기존 시험은 바꾸지 않는다.

## 파일 경계 (PL1B와 동시 개발 — D-PL1-10)

| 파일·폴더 | PL1A(이 스프린트) | PL1B |
|---|---|---|
| `apps/server/src/backup.ts`, `check-replay.ts`, `closing.ts`, `packing.ts`, `past.ts`, `ops.ts`, `log.ts`, `errors.ts`, `api.ts`, `print-api.ts`·출력 서비스, `parcel/**`, `receipt*.ts`, `service.ts`, `store.ts`, `runtime.ts`, `writer.ts`, `e2e.ts`, `index.ts`, 새 서버 파일 | **고친다**(필요한 곳만) | 고치지 않는다 |
| `apps/server/src/billing/**`, `apps/server/src/accounts.ts` | 고치지 않는다 | 고친다 |
| `apps/server/test/**` | 새 시험 파일(`pl1a-*.test.ts`)과 백업·봉인·문서 시험 | 새 시험 파일(`pl1b-*.test.ts`), `billing*.test.ts`·`accounts*.test.ts`만 |
| `docs/DEPLOY.md` | 경보 표 `BACKUP_FAILED` 줄 | 고치지 않는다 |
| `docs/OWNER-GUIDE.md` | 고치지 않는다 | 요금 증빙 문장 |
| `apps/web/src/components/PackingPage.tsx` | **데이터 받기(포장 목록 응답의 `sealed`)·`PackingChecklist`(체크 칸·포장 완료·배송 완료·취소·송장 칸·봉인 안내)만** | **`PackingLabelSection`(포장 라벨 칸 — 출력 버튼·라벨 꺼짐 안내)만** |
| `apps/web/src/api/types.ts` | 포장 목록 응답 타입에 `sealed` | 고치지 않는다(필요하면 `print-types.ts`·`billing-types.ts`) |
| `apps/web/src/components/` 요금·사업자·마법사·음성 파일, `lib/billing-words.ts`, `voice/**` | 고치지 않는다 | 고친다 |
| `apps/web/src/styles.css` | 고치지 않는다(기존 클래스를 쓴다) | 꼭 필요할 때만 |
| `apps/web/test/**` | 새 시험 파일(`pl1a-*.test.tsx`) | 새 시험 파일(`pl1b-*.test.ts(x)`)·`voice-controller.test.ts` |
| `tests/adversarial/` | `pl1a/**` | `pl1b/**` |
| `tests/e2e/` | `pl1a/**` | `pl1b/**`, `n5/**`(증빙 문장), `i2/packing.spec.ts`(B1 버튼 단언) |

- `PackingPage.tsx` 맨 위 import 줄이 부딪치면 뒤에 합치는 트랙이 둘 다 남겨 푼다.
- **봉인 날짜에서 포장 라벨 출력 버튼 숨기기**(PL1A의 `sealed`를 PL1B의 포장 라벨 칸에 넘기는 연결)는 **뒤에 main에 합치는 트랙**이 한다 — AC-PL1A-19.

## 수용 기준

### 백업·전체 기록·복구 (D-PL1-01)

**AC-PL1A-01** [server] · DAT-03·DAT-04·DAT-06 · D-PL1-01 — 백업 파일에 봉인 범위를 담는다
- Given 공통 전제의 날짜 A(봉인됨)·B(봉인 전)·리허설 범위
- When 자동 백업(`BackupScheduler.createNow`)과 전체 기록 내려받기(`GET /api/export/records.json.gz`)를 만든다
- Then 두 파일 모두 `format` = `livejjim-seller-backup`, `version` = **3**. A 범위의 `sealed` = `{ sealedAt, ledger, ledgerDigest }` — `sealedAt`은 범위 행의 봉인 시각(UTC ISO), `ledger`는 범위 행에 저장된 장부 글과 **바이트가 같고**, `ledgerDigest`는 저장된 장부 요약값과 같다. A의 이벤트는 저장된 그대로(seq 1부터, 이벤트마다 요약값) — 채팅 본문·채팅 원문 칸과 **산 적도 정산 기록도 없는 시청자(채팅만 한 사람)의** 유튜브 닉네임이 파일 어디에도 없다(A의 유튜브 채팅 글 "15"·그 시청자 닉네임으로 파일 전체를 찾아 0개, A 이벤트 본문에 채팅 글·닉네임 칸 없음). 산 사람·정산 기록이 있는 사람의 표시 이름은 봉인 장부(`ledger`) 안에만 있다(D-Y11 — 봉인 뒤 문서를 만드는 데 필요, D-PL1-13·SA-PL1A-03). B와 리허설 범위의 `sealed`는 `null`이고 그 밖의 칸은 형식 2와 같다. 파일 요약값(`digest`)은 `sealed` 칸까지 덮는다(A의 `sealed.sealedAt` 한 글자를 바꾸고 다른 곳을 그대로 두면 파일 요약값이 맞지 않는다)
- 확인: 서버 시험(PGlite, 가짜 시계, 봉인 작업을 실제로 돌려 A를 봉인)

**AC-PL1A-02** [server] · DAT-04 · D-PL1-01 — 봉인 범위는 재생하지 않고 검사한다
- Given AC-PL1A-01의 파일
- When 파일 검사(복구·가져오기 전 검사)를 한다
- Then 통과한다. 검사 요약의 A 범위는 봉인 표시·이벤트 수 = A의 이벤트 수·상태 스냅샷 0·발송함 0이고, A의 이벤트를 엔진에 넣지 않는다(엔진 재생 함수를 감시해 A의 seq로 불린 적 0번). B·리허설은 지금처럼 재생 검사. 같은 서버의 재생 검사 명령(`check-replay`)이 A를 다루는 방식(`checkSealed` — 장부 요약값 대조, 요금 대조 없음)과 판정이 같다
- 확인: 서버 시험

**AC-PL1A-03** [server] · DAT-04 · D-PL1-01 — 손상된 봉인 범위는 거절하고 아무것도 바꾸지 않는다
- Given AC-PL1A-01의 파일에서 한 가지씩 바꾸고 **파일 요약값은 다시 계산해 맞춘** 파일들: (a) `ledger` 한 글자 (b) `ledgerDigest` 한 글자 (c) A의 이벤트 하나를 뺌(seq 빈틈) (d) A의 이벤트 본문 한 글자(그 이벤트 요약값 그대로) (e) `ledger`를 모르는 판(`livejjim-ledger/9`)으로 바꾸고 `ledgerDigest`도 그 글로 다시 계산 (f) 장부의 `date`를 다른 날짜로(요약값 다시 계산) (g) 리허설 범위에 `sealed`를 넣음 (h) 파일 요약값만 틀림
- When 각 파일로 바꾸기 복구와 빈 판매자 가져오기를 한다
- Then 모두 거절되고 판매자 기록(범위·이벤트·포장·택배 기록·백업 목록)이 하나도 바뀌지 않는다(안전 백업도 남기지 않는다). 거절 까닭: (a)·(b) "범위 YYYY-MM-DD의 봉인 장부 요약값이 맞지 않아요(장부가 바뀌었어요)." (c) seq 빈틈 문장(지금과 같음) (d) 이벤트 요약값 문장(지금과 같음) (e)·(f) "범위 YYYY-MM-DD의 봉인 장부를 읽을 수 없어요." (g) "리허설 범위는 봉인할 수 없어요." (h) "파일 요약값이 맞지 않아요(파일이 손상됐거나 바뀌었어요)."
- 확인: 서버 시험

**AC-PL1A-04** [server] · DAT-04 · D-PL1-01 — 바꾸기 복구 뒤에도 A는 봉인된 날짜다
- Given AC-PL1A-01의 자동 백업 파일. 그 뒤 판매자가 B에 찜을 하나 더 했다
- When 바꾸기 복구를 한다
- Then 지금 기록이 먼저 안전 백업으로 남고(형식 3) B는 백업 때로 돌아간다. A: 범위 행의 봉인 시각·장부·장부 요약값이 파일 값과 같고, 상태 스냅샷·발송함·채팅 원문 행이 0개, `GET /api/days/A`가 백업 전과 같은 봉인 조회(`sealed: true`, 같은 상품·판매·구매자·정산). A에 쓰는 요청(상품 등록·문자찜·입금 기록·포장 명령)은 모두 409 `SEALED` "30일이 지난 방송 기록은 봉인되어 고칠 수 없어요." 복구한 뒤 재생 검사 명령이 통과한다(A는 장부 요약값 대조, B·리허설은 재생). 봉인 작업을 한 바퀴 더 돌려도 A의 장부·봉인 시각이 바뀌지 않는다
- 확인: 서버 시험

**AC-PL1A-05** [server] · DAT-04 · D-PL1-01 — 빈 판매자(다른 서버)로 가져오기
- Given AC-PL1A-01의 전체 기록 파일, 다른 PGlite 서버의 기록 없는 판매자
- When 가져오기를 한다
- Then AC-PL1A-04의 A에 대한 Then이 그 서버에서도 같다(판매자 ID·계정·문자 구매자 키 연결 빼고). 가져온 서버의 가짜 시계가 A + 30일보다 **앞**이어도 A는 봉인된 채 들어간다(봉인 시각은 파일 값)
- 확인: 서버 시험

**AC-PL1A-06** [server] · DAT-04 · D-PL1-01 — 형식 2 파일도 읽는다
- Given BASE 코드로 만든 형식 2 백업 파일 둘 — (a) 봉인 범위가 없는 판매자 (b) 봉인 범위가 있는 판매자 (시험 자료로 저장해 둔다)
- When 이 스프린트 코드로 검사·복구한다
- Then (a)는 BASE와 같이 통과하고 복구 결과가 같다(모든 범위를 봉인 안 함으로 재생). (b)는 BASE와 같이 거절된다(봉인 범위의 이벤트를 재생하면 장부와 다르다 — 새로 생기는 손실 없음. 거절 문장은 BASE와 같다)
- 확인: 서버 시험

**AC-PL1A-07** [server] · DAT-04·DAT-06 · D-PL1-01 — 봉인 전에 만든 백업을 봉인 뒤에 복구 (기존 동작 고정)
- Given A가 봉인되기 전(A + 29일)에 만든 백업 파일 — A의 `sealed`는 `null`
- When 가짜 시계를 A + 31일로 옮긴 뒤 그 파일로 바꾸기 복구를 하고 봉인 작업을 한 바퀴 돌린다
- Then 복구 직후 A는 봉인 안 한 범위로 재생돼 들어가고, 봉인 작업 한 바퀴 뒤 A가 봉인된다(장부가 다시 만들어지고 채팅 본문이 지워짐). 봉인된 A의 조회는 처음 봉인 때의 조회와 같다(봉인 시각만 다름)
- 확인: 서버 시험

### 판매자 자동 백업 실패 경보 (D-PL1-02)

**AC-PL1A-08** [server] · DAT-03·SYS-05 · D-PL1-02 — 자동 백업이 실패하면 운영 경보
- Given 판매자 셋(P·Q·R), 백업 저장소가 Q의 쓰기만 실패하게 만든 가짜 저장소, 경보를 모으는 로그 싱크와 `Alerter`(서버 기동과 같은 연결)
- When 그날 04:00(KST)이 지난 뒤 백업 확인을 돌리고, 가짜 시계로 5분·9분 59초·10분 뒤에 다시 돌린다
- Then 첫 확인: P·R 백업이 만들어지고 Q는 실패(`failed`에 Q). 경보 줄 `{ level: 'alert', code: 'BACKUP_FAILED', count: 1, seller: Q }` 하나 — 판매자 이름·오류 메시지·파일 경로·스택이 없다. 5분·9분 59초 뒤의 실패는 경보 없음, 10분 뒤 경보 `count: 3`(그 사이 두 번 + 이번). P·R은 그날 다시 만들지 않고 경보도 없다. 운영 백업 명령의 `BACKUP_FAILED` 경보(seller 칸 없음)는 그대로다. 보관 정리 실패(`BACKUP_PRUNE_FAILED`)는 경고 로그만, 경보 없음. `/ops/status` 응답 모양은 바뀌지 않는다
- 확인: 서버 시험

**AC-PL1A-09** [server] · SYS-05 · D-PL1-02 — 운영 문서
- Then `docs/DEPLOY.md` 경보 표의 `BACKUP_FAILED` 줄이 "운영 백업 명령 실패" 와 "판매자 자동 백업 실패(`seller` 칸 = 판매자 ID — 다음 확인 때 다시 한다)"를 둘 다 적고, 할 일 칸에 판매자 백업 폴더(`LIVEJJIM_BACKUP_DIR/<판매자 ID>`) 확인을 더한다. 경보 코드 목록과 문서를 맞대는 기존 시험이 통과한다
- 확인: 서버 시험(기존 문서 맞대기)·수동(문서 읽기)

### 봉인 날짜의 문서·포장·지난 구매 (D-I2-22 (2), D-PL1-03, D-PL1-04)

**AC-PL1A-10** [server] · STL-04·STL-06·RCP-02 · D-PL1-04 — 확인서
- Given 공통 전제의 날짜 A. 봉인 직전에 A의 구매자마다 확인서 데이터(`GET /api/days/A/receipt?buyer=…`)·전원 PDF(`receipts.pdf` — 쪽 순서)·확인서 그림 묶음(`receipts.zip`)·확인서 구매자 목록(`receipt-buyers`)을 받아 둔다
- When A가 봉인된 뒤 같은 것을 다시 받는다
- Then 모두 봉인 직전과 같다(공통 전제의 "같다"). 빈 문서·빈 파일·404·오류가 아니다. 옵션 방송 판매는 옵션 글·수량·찜 금액이 같다(D-O3-12)
- 확인: 서버 시험

**AC-PL1A-11** [server] · STL-06 · D-PL1-03·D-PL1-04 — 판매대장 (그날·기간·전체)
- Given 날짜 A와 B. 봉인 직전에 A의 판매대장, A~B 기간 판매대장(`GET /api/ledger.xlsx?from=…&to=…`), 전체 판매대장(`GET /api/export/ledger.xlsx`)을 받아 둔다
- When A가 봉인된 뒤 같은 것을 다시 받는다
- Then 시트·열·행 수·행 순서와 셀 값이 봉인 직전과 같다 — **단 A의 행의 "찜 시각" 셀만 빈칸**(B의 행은 그대로 찜 시각이 있다). 옵션 열 시트(`LEDGER_OPTION_COLUMNS`)도 같다. A의 행이 빠지지 않는다
- 확인: 서버 시험

**AC-PL1A-12** [server] · DAT-06 · D-PL1-03 — 장부 판은 `/2` 그대로, 찜 시각을 지어내지 않는다
- Then 이 스프린트 뒤 새로 봉인한 장부의 `format`은 `livejjim-ledger/2`이고(`git diff BASE -- apps/server/src/youtube` 가 비어 있다), 봉인 날짜 판매대장의 "찜 시각"은 장부의 확정 시각(`confirmedAt`)·다른 시각으로 채우지 않은 빈칸이다. `/1` 장부(O3 전)로 봉인한 날짜도 같은 대장 행을 만든다(수량 1·찜 금액 = 가격, 찜 시각 빈칸)
- 확인: 서버 시험·`git diff`

**AC-PL1A-13** [server] · STL-08·LBL-02 · D-PL1-04 — 포장 목록·포장 라벨
- Given 날짜 A. 봉인 직전에 포장 목록(`GET /api/days/A/packing` — 구매자마다 상태 말·송장·품목), 구매자마다 포장 라벨 데이터(`packing-label`)·PNG(`packing-label.png` 쪽마다)·PDF(`packing-label.pdf`)를 받아 둔다
- When A가 봉인된 뒤 같은 것을 다시 받는다
- Then 모두 봉인 직전과 같다. 포장 상태는 장부의 판매(지금의 구매자·상품 ID·찜 키·수량)와 포장 기록으로 AC-I2-30·AC-O3 규칙 그대로 계산한다(포장 완료·포장 다시 확인·배송 완료가 봉인 전과 같은 구매자에게 같다). 봉인 뒤 포장 목록 응답에만 `sealed: true`가 더해진다(봉인 전과 봉인 안 한 날짜는 `sealed` 칸이 없거나 `false` — dev-notes에 하나로 정해 적는다)
- 확인: 서버 시험

**AC-PL1A-14** [server] · BUY-05 · D-PL1-04 — 지난 구매
- Given 날짜 A의 구매자 X가 날짜 B에도 산다. 봉인 직전에 B에서 X의 지난 구매(`GET /api/days/B/past?buyer=…`)를 받아 둔다
- When A가 봉인된 뒤 다시 받는다
- Then 같다 — A의 항목(날짜·상품·금액·입금 상태)이 그대로 있다
- 확인: 서버 시험

**AC-PL1A-15** [server] · STL-06·BUY-05 · D-PL1-04 — 읽을 수 없는 장부
- Given 날짜 A의 범위 행 장부를 읽을 수 없는 글(모르는 판 `livejjim-ledger/9`, 그리고 따로 `/2`인데 판매 행 `amount`가 없음)로 바꾼 DB
- When A의 확인서 데이터·전원 PDF·그림 묶음·그날 판매대장·A가 든 기간 판매대장·전체 판매대장·포장 목록·포장 라벨, B의 X 지난 구매를 받는다
- Then 지난 구매 말고는 모두 500, 코드 `LEDGER_UNREADABLE`, 문장 "30일이 지나 봉인한 기록을 읽지 못했어요. 운영자에게 알려 주세요." — 빈 파일·A가 빠진 대장을 주지 않는다. 오류 로그 줄은 코드·날짜만(장부 글·구매자 이름 없음). B의 X 지난 구매는 200이고 A의 항목만 빠진다(오류 로그 한 줄). 판매 쓰기(B의 찜·입금)는 영향이 없다
- 확인: 서버 시험

**AC-PL1A-16** [server] · DAT-06·STL-08 · D-I2-22 (3)·D-PL1-04 — 봉인 날짜의 쓰기는 409
- Given 날짜 A(봉인됨), A의 구매자 X(포장 완료)와 Y(포장 대기)
- When A에 대해 보낸다: 포장 완료(Y)·포장 취소(X)·배송 완료(X, 송장 포함)·배송 취소, 포장 라벨 B1 출력(`POST /api/print/packing { date: A, buyer: X }`), 택배 접수·취소(`POST /api/parcels/days/A/book`·`cancel`), 확인서 공유 링크 만들기(한 명·전원 — `POST /api/days/A/receipt-links`·`/all`)
- Then 모두 409, 코드 `SEALED`, 문장 "30일이 지난 방송 기록은 봉인되어 고칠 수 없어요." — 포장·택배·출력 작업·링크 기록이 하나도 생기지 않고 실시간 알림도 없다. 검사 순서: 입력 형식 오류(400/422)는 지금처럼 먼저, 라벨 꺼짐(`LABELS_OFF`)보다 봉인이 먼저다(봉인 날짜면 켬/끔과 상관없이 409). 줄이거나 끝내는 요청(공유 링크 끊기 `revoke`)과 모든 조회는 받는다. B(봉인 전)에 같은 요청은 지금처럼 된다
- 확인: 서버 시험

**AC-PL1A-17** [server] · DAT-06·SYS-02 · D-I2-22 — 봉인 날짜 응답에 원문·번호 키가 없다
- Then AC-PL1A-10~16의 응답·파일(JSON·PDF 글자·엑셀 셀·PNG 아닌 모든 글)에 A의 유튜브 채팅 글·채팅 원문·전화번호 키(HMAC)·전화번호 전체가 없다(AC-I2-81과 같은 검사). 다른 판매자로 A의 같은 경로를 부르면 404(지금과 같음)
- 확인: 서버 시험

**AC-PL1A-18** [web] · STL-08·UX-01 · D-PL1-04 — 봉인 날짜의 포장 모드는 볼 수만
- Given 날짜 A(봉인됨)의 포장 모드 `/packing?date=A&buyer=X`(375px·1440px)
- Then 체크리스트 위에 "30일이 지나 봉인한 날짜예요. 볼 수만 있어요."(안내 색, role=status 아님 — 늘 보이는 문장). 담을 품목 줄(번호·품종·옵션 글·수량)은 보이고 **체크 칸·"포장 완료"·"배송 완료"·"포장 완료 취소"·"배송 완료 취소"·송장번호 칸이 없다**(버튼 이름으로 찾아 0개). 포장 목록의 상태 말(포장 완료·배송 완료·송장)은 봉인 전과 같게 보인다. 포장 라벨 칸의 그림 저장·라벨 PDF는 된다. B(봉인 전)는 지금 화면 그대로
- 확인: 웹 단위 시험(`apps/web/test/pl1a-*.test.tsx`) + E2E(AC-PL1A-90)

**AC-PL1A-19** [web] · STL-08 · D-PL1-05·D-PL1-10 — 봉인 날짜에서 포장 라벨 출력 버튼 숨김 (합칠 때)
- 이 기준은 **뒤에 main에 합치는 트랙**이 채운다. PL1B(포장 라벨 칸의 "포장 라벨 출력" 버튼)가 먼저 main에 들어가 있으면 PL1A가 합치기 전에 이 연결을 넣는다 — `PackingChecklist`가 `sealed`를 `PackingLabelSection`에 넘기고 그 칸은 `sealed`면 출력 버튼을 그리지 않는다(그림 저장·라벨 PDF는 그대로). PL1A가 먼저 들어가면 PL1B가 같은 일을 한다(AC-PL1B-14)
- Then 봉인 날짜 A의 포장 모드에 이름이 "포장 라벨 출력"인 버튼이 0개, B에는 1개(라벨 켜짐)
- 확인: E2E(AC-PL1A-90의 마지막 단언 — PL1B 전에는 0개로 늘 통과하고, 합친 뒤에는 실제로 숨김을 확인한다)

**AC-PL1A-20** [server][web] · 회귀 — 봉인 안 한 날짜는 그대로
- Then 봉인 안 한 날짜의 확인서·판매대장·포장·지난 구매·백업 동작과 화면이 BASE와 같다(기존 서버 시험·웹 시험·E2E `i2/**`·`o3`·`o4/**`·`t1/**`·`n4b/**`가 기대값을 바꾸지 않고 통과 — 형식 번호 2→3 고정값만 D-PL1-01 주석으로 바꾼다)
- 확인: 기존 시험

### 시험 (domain · e2e)

**AC-PL1A-90** [e2e] · STL-08 · D-PL1-04 — 봉인 날짜 포장 화면 한 흐름
- Given 시험 제어 경로로 만든 유튜브 날짜(`/_e2e/dates` `kind: 'youtube'`, 날짜는 오늘 − 31일)에 찜·포장 완료(구매자 X)를 적고 `/_e2e/seal`로 봉인
- When 판매자가 포장 모드에서 그 날짜를 고르고 X를 연다(PC 1440·휴대폰 375)
- Then AC-PL1A-18의 화면, 포장 목록에서 X의 상태 "포장 완료", 라벨 PDF 내려받기 1개(쪽 수 > 0), 버튼 "포장 완료"·"배송 완료" 0개, "포장 라벨 출력" 0개(AC-PL1A-19). 같은 화면에서 브라우저 요청으로 `POST /api/days/<날짜>/packing`을 보내면 409와 봉인 문장
- 확인: E2E(`tests/e2e/pl1a/**`, 오케스트레이터가 정한 `E2E_PORT_OFFSET`)

**AC-PL1A-91** [domain] · DAT-04 · D-PL1-01 — 백업 파일 변조 적대 시험
- Given 형식 3 백업 파일(봉인 범위 포함)
- When 무작위·의도적 변조 — `sealed`를 봉인 안 한 범위에 끼움, `sealed: {}`·`sealed: "x"`·`ledger: null`, 같은 범위 `sealed` 두 번(JSON 키 중복), 봉인 범위 이벤트 seq 0·음수·순서 뒤집음, 아주 긴 장부(64MB), 장부 안 `__proto__`, 형식 번호 4, 파일 요약값만 맞춘 장부 바꿔치기(다른 날짜의 장부)
- Then 모두 거절되고 판매자 기록이 바뀌지 않는다(예외로 서버가 멈추지 않고 문장은 판매자·운영자가 읽을 수 있는 한국어). 바르게 만든 파일은 같은 시험 안에서 통과한다(늘 거절하는 구현을 잡는다)
- 확인: 적대 시험(`tests/adversarial/pl1a/**`)

**AC-PL1A-92** · 금지 경로 — 유튜브 파일을 고치지 않았다
- Then `git diff --name-only BASE HEAD`에 `apps/server/src/youtube/`, 파일 이름에 `youtube`·`Youtube`가 든 `apps/web/src/` 파일, `tests/e2e/i3/`, `tests/e2e/y1/`이 없다. 파일 경계 표의 PL1B 몫 파일도 없다(`PackingPage.tsx`는 `PackingChecklist`·데이터 받기 부분만 — 리뷰로 확인)
- 확인: 게이트(오케스트레이터)·`git diff`

## 감사 뒤 정리 (spec-keeper, 2026-10-24)

- D-PL1-11: 이스케이프로 숨긴 `__proto__`가 든 봉인 장부도 AC-PL1A-03 (e)와 같은 문장으로 거절(이미 반영, `apps/server/test/pl1a-backup-ledger.test.ts`).
- D-PL1-12: AC-PL1A-03 (e)의 "읽을 수 없는 장부"는 봉인 날짜 문서와 같은 기준(`stateFromLedger`·`startSettings`)이다 — 그 기준에 맞지 않는 장부가 든 파일도 검사·바꾸기 복구·빈 판매자 가져오기 모두 거절, 아무것도 바꾸지 않는다(이미 반영). 재생 검사 명령은 요약값만 — 다음 판단.
- D-PL1-13: AC-PL1A-01의 닉네임 0개는 채팅만 한 시청자의 닉네임(위 문장 고침).
- D-PL1-14: 둘 넘게 합친 구매자의 지난 구매 "찾은 까닭" 나열 순서는 봉인 전과 다를 수 있다(금액·줄·문서 순서는 같음) — AC-PL1A-14(지난 구매)의 "봉인 전과 같음"에서 이 나열 순서만 뺀다.
- D-PL1-15: `packages/core/src/engine.ts`의 순수 도우미 export 두 줄(dev-server 커밋 `f2a79bfd`)은 받아들인다.

## 이번 스프린트에서 하지 않는 것 (범위 밖)

- 장부 판 `/3`(판매마다 찜 시각)과 그것을 읽는 판매대장 "찜 시각" — 맥북 쪽 유튜브 작업(D-PL1-03, 백로그 넘김)
- `apps/server/src/youtube/**`·유튜브 화면·`tests/e2e/i3`·`y1`의 어떤 수정
- 봉인 작업 자체(언제 봉인하나·무엇을 지우나)·장부를 만드는 방식의 변경
- `/ops/status`의 새 칸, 백업을 다른 저장소로 보내기, 판매자 화면의 새 복구 버튼
- 포장 모드의 B1 출력 버튼 자체(PL1B), 요금·증빙·마법사·음성(PL1B)
- 봉인 날짜의 확인서 공유 링크 공개 화면(`/r/…`) — 링크는 14일이면 끝나 봉인(30일) 때 살아 있는 링크가 없다(D-N4b)
