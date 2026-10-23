# PL1B 수용 기준 — 화면·증빙·시험 다듬기 (마무리 다듬기)

- 스프린트: PL1B (6단계, 마무리 다듬기 — **새 기능 없음**) · spec ID: **BIL-01**, **BIL-02**(BILLING_RULES BL-7·BL-8·BL-10), **STL-08**·**LBL-02**(포장 모드 B1 출력), **UX-02**(시작 마법사), **RCP-01**(라벨 끄기 L-13), **VOC-03**·**VOC-04**(음성 카드) · 규칙: DOMAIN_RULES 변경 없음, BILLING_RULES v0.1.1
- 근거 결정: **D-PL1-05~D-PL1-10**(AUTO), D-I2-07, D-N4a-05·D-N4a-07, D-I5-20, D-N5-10·D-N5-11, RA-N5-01, D-I4-05·D-I4-06, D-036
- 개발 영역: **server**(`apps/server/src/billing/**`, `apps/server/src/accounts.ts`, `docs/OWNER-GUIDE.md`) → **web**(`apps/web/**`) · 테스트: **domain**(`tests/adversarial/pl1b/**`), **e2e**(`tests/e2e/pl1b/**`와 아래 적은 기존 파일) · **사용성 검토 있음**(uxReview)
- 같은 BASE에서 **PL1A가 다른 작업 폴더에서 동시에** 개발된다. 아래 "파일 경계"를 지킨다.

## 금지 경로 (유튜브 — 사용자가 맥북에서 작업 중)

이 스프린트의 어떤 커밋도 아래를 **고치지 않는다**(읽기·기존 export의 import는 된다). 고쳐야만 할 것 같으면 고치지 말고 dev-notes와 `disputesWithSpec`으로 올린다.

- `apps/server/src/youtube/**`
- 웹의 유튜브 화면 파일 — `apps/web/src/components/ConsoleYoutube*.tsx`, `YoutubeConnection.tsx`, 그 밖에 파일 이름에 `youtube`·`Youtube`가 든 `apps/web/src/**` 파일. `WizardPage.tsx`는 고칠 수 있지만 **프린터 단계 블록(`step === PRINTER_STEP`)과 `PrinterStep`에 넘기는 값만** — `YoutubeStep`·유튜브 단계 블록·`YoutubeConnection` import는 고치지 않는다
- `tests/e2e/i3/**`, `tests/e2e/y1/**`

## 모호한 점 → 결정 → 수용 기준

| 모호한 점 | 결정 | 수용 기준 |
|---|---|---|
| 간이과세자 — 세금계산서 기본값·고르기·10/11 표기·약관 | D-PL1-07 현금영수증 하나, 세금계산서는 "지금은 발급할 수 없어요" | AC-PL1B-01~08 |
| 포장 모드 B1 출력 — 요청·문장·라벨 꺼짐·저절로 | D-PL1-05 정산 자세히와 같은 요청, 누를 때만, 꺼지면 칸 전체 안내 | AC-PL1B-10~15 |
| 마법사 "라벨을 쓰지 않아요" — 묻나·다음 단계 | D-PL1-06 바로 끄고 다음 단계 | AC-PL1B-16~19 |
| BL-7 환불 결과 모름·밖에서 취소 | D-PL1-08 지금 코드 확정 + 골든 `granted` | AC-PL1B-20~22 |
| D-I5-20(끝에서 넘긴 문자찜 카드) 시험 부족 | (결정 변경 없음 — 시험만) | AC-PL1B-23~26 |
| 음성을 켠 직후 2초 카드 미룸 | D-PL1-09 지금 코드 확정 | AC-PL1B-27 |
| PL1A와 겹치는 파일·새 골든 | D-PL1-10 | "파일 경계", AC-PL1B-00·14 |

## 이번 스프린트의 스펙·골든 변경 (spec-keeper)

| 파일 | 변경 |
|---|---|
| `docs/spec/BILLING_RULES.md` | v0.1.1 — BL-7 5(환불 결과 모름)·6(밖에서 취소)(D-PL1-08), BL-8 1·3 현금영수증 하나·6 "세금계산서는 지금 발급하지 않는다"(D-PL1-07), BL-10 8 약관 |
| `docs/spec/SPEC.md` | v0.1.31 — 포장 화면 "B1 출력"(D-PL1-05), UX-02 "라벨을 쓰지 않아요"(D-PL1-06), VOC-03 켠 직후 2초 미룸(D-PL1-09) |
| `docs/DECISIONS.md` | D-PL1-05~D-PL1-10(AUTO), "사용자 확인 필요"에 "간이과세자 증빙 (PL1)" 행(법률·세무 확인은 사용자 몫) |
| `tests/golden/drafts/pl1b/billing/granted.json` → `tests/golden/billing/granted.json` | 새 요금 골든 G-BIL-401~415(처음 적은 301~315는 bizno와 겹쳐 번호만 옮김, D-PL1-08)(종류 `granted`, D-PL1-08) — 초안으로 커밋, **PL1B 시작 때 spec-keeper가 옮긴다**(AC-PL1B-00). `tests/golden/README.md` "요금 골든" 표에 `granted` 종류 |

## 공통 전제

- 이미 합쳐진 모든 결과(`pnpm verify`)가 그대로 유지된다. 외부 계정·실기기 없이 돈다(가짜 결제 서버·가짜 발행기·시험용 프린터·가짜 `webkitSpeechRecognition`).
- 화면 문장 중 이 문서·DECISIONS·BILLING_RULES가 따옴표로 정한 것은 그대로 쓴다(E2E가 글자로 찾는다).
- 태그: `[server]` = dev-server, `[web]` = dev-web, `[domain]` = test-domain, `[e2e]` = test-e2e. 의존 순서 server → web. dev-server는 바뀐 공개 모양(사업자 정보 `receiptKind` 422)을 `harness/sprints/PL1B/dev-notes.md`에 먼저 적는다.
- 기존 시험의 기대값 교체는 이 스프린트가 바꾼 문장·동작에 한한다 — 바꾼 곳마다 근거 결정 번호를 주석으로: `apps/server/test/billing*.test.ts`(골든 종류·수 고정값, 증빙 종류 — D-PL1-07·08), `apps/web/test/**`의 요금 문장(D-PL1-07), `tests/e2e/n5/billing.spec.ts`(증빙 문장 — D-PL1-07), `tests/e2e/i2/packing.spec.ts`("B1 버튼 없음" — D-PL1-05). 그 밖의 기존 시험은 바꾸지 않는다.

## 파일 경계 (PL1A와 동시 개발 — D-PL1-10)

| 파일·폴더 | PL1A | PL1B(이 스프린트) |
|---|---|---|
| `apps/server/src/billing/**`, `apps/server/src/accounts.ts`, `docs/OWNER-GUIDE.md` | 고치지 않는다 | **고친다** |
| 그 밖의 `apps/server/src/**`(`backup.ts`·`closing.ts`·`packing.ts`·`past.ts`·`ops.ts`·`log.ts`·`errors.ts`·`api.ts`·`print-api.ts`·`parcel/**`·`e2e.ts`·`index.ts` 등), `docs/DEPLOY.md` | 고친다 | **고치지 않는다** — 포장 라벨 출력 요청(`POST /api/print/packing`)은 지금 서버 그대로 쓴다 |
| `apps/server/test/**` | `pl1a-*.test.ts`, 백업·봉인·문서 시험 | `pl1b-*.test.ts`, `billing*.test.ts`·`accounts*.test.ts`만 |
| `apps/web/src/components/PackingPage.tsx` | 데이터 받기(`sealed`)·`PackingChecklist`만 | **`PackingLabelSection`(포장 라벨 칸)과 그 칸이 쓰는 새 import만** — 출력 버튼을 새 파일(예: `components/PackingPrint.tsx`)로 만들어 그 칸에서 부르면 겹침이 가장 작다 |
| `apps/web/src/components/BusinessSection.tsx`·`BillingParts.tsx`·`BillingPage.tsx`, `lib/billing-words.ts`, `api/billing-types.ts`, `components/wizard/PrinterStep.tsx`, `WizardPage.tsx`(프린터 단계 블록만), `voice/**`·`VoicePanel.tsx`(시험에 필요한 접근만 — 동작은 바꾸지 않는다) | 고치지 않는다 | 고친다 |
| `apps/web/src/api/types.ts` | 고친다(`sealed`) | 고치지 않는다 |
| `apps/web/src/styles.css` | 고치지 않는다 | 꼭 필요할 때만(기존 클래스 먼저) |
| `apps/web/test/**` | `pl1a-*.test.tsx` | `pl1b-*.test.ts(x)`, `voice-controller.test.ts`(더하기만), 요금 문장 고정값 |
| `tests/adversarial/` | `pl1a/**` | `pl1b/**` |
| `tests/e2e/` | `pl1a/**` | `pl1b/**`, `n5/billing.spec.ts`(증빙 문장), `i2/packing.spec.ts`(B1 버튼 단언) |
| `tests/golden/**` | — | spec-keeper만(AC-PL1B-00) |

- `PackingPage.tsx` 맨 위 import 줄이 부딪치면 뒤에 합치는 트랙이 둘 다 남겨 푼다.
- **봉인 날짜에서 출력 버튼 숨기기** 연결은 뒤에 main에 합치는 트랙이 한다 — AC-PL1B-14.

## 수용 기준

**AC-PL1B-00** [spec] · D-PL1-10 — 시작 단계: 요금 골든 옮기기
- PL1B 작업 폴더에서 개발을 시작하기 전에 spec-keeper가 `tests/golden/drafts/pl1b/billing/granted.json`을 `tests/golden/billing/granted.json`으로 옮기고(내용 그대로), `tests/golden/README.md`의 `drafts/**` 줄에서 이 파일을 지운다 — 커밋 `[spec] PL1B: 요금 골든 granted 옮기기`. 그 커밋 전에는 dev가 요금 골든 시험을 고치지 않는다
- 옮긴 뒤 ID는 G-BIL-401~415다(초안의 301~315가 bizno G-BIL-301~313과 겹쳐 README "이 폴더 전체에서 유일"을 어겼으므로 번호만 옮김, 내용·기대값 그대로 — D-PL1-08, TD-PL1B-001·SA-PL1B-01)
- 확인: `git log`

### 간이과세자 증빙 (D-PL1-07)

**AC-PL1B-01** [server] · BIL-01 · BL-8 1·6 · D-PL1-07 — 사업자 정보의 증빙 종류
- Given 로그인한 판매자, 요금 기능 켜짐
- When 사업자 정보 저장(지금 경로·본문)을 (a) `receiptKind` 없이 (b) `receiptKind: 'CASH_RECEIPT'` (c) `receiptKind: 'TAX_INVOICE'` (d) `receiptKind: 'cash_receipt'`·`1`·`null`로 보낸다
- Then (a)·(b) 저장되고 응답·조회의 `receiptKind` = `CASH_RECEIPT`. (c) 422, 칸 `receiptKind`, 문장 "세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요." — 아무것도 저장하지 않는다(이미 있던 사업자 정보 그대로). (d) 지금처럼 422(기존 문장 "계좌이체 증빙은 …")이고 저장 없음 — dev-notes에 (c)와 (d)의 문장을 적는다
- 확인: 서버 시험

**AC-PL1B-02** [server] · BL-8 3·6 · D-PL1-07 — 옛 저장값과 증빙 요청
- Given DB에 `receipt_kind = 'TAX_INVOICE'`로 저장된 사업자 정보(BASE 코드로 만든 것과 같은 행), 그 판매자의 계좌이체 결제
- When 사업자 정보를 조회하고, 그 결제가 확인되어 부여된다
- Then 조회의 `receiptKind` = `CASH_RECEIPT`. 새 증빙 요청의 종류 = `CASH_RECEIPT`, 금액 = 결제 금액, 공급가액·세액 = BL-8 4(G-BIL-201~207 그대로). 이미 있던 `TAX_INVOICE` 증빙 요청·발행 기록은 바뀌지 않는다(같은 행·같은 종류). 카드 결제는 지금처럼 증빙 요청이 없다
- 확인: 서버 시험

**AC-PL1B-03** [server] · BL-8 1 · D-PL1-07 — 운영자 계정 명령
- When 운영자 계정 명령이 사업자등록번호와 함께 판매자를 만든다
- Then 그 판매자의 사업자 정보 `receiptKind` = `CASH_RECEIPT`(DB 행도)
- 확인: 서버 시험

**AC-PL1B-04** [server] · BL-8 · D-PL1-07 — 운영자 증빙 목록·문서
- Then 운영자 증빙 목록 명령의 종류 낱말은 저장된 종류 그대로(새 요청은 "현금영수증(지출증빙)", 옛 기록은 "세금계산서"). `docs/OWNER-GUIDE.md`의 요금 증빙 문장(8절 3, 9-6절)이 "지금은 현금영수증(지출증빙)만 — 간이과세자라 세금계산서를 발급하지 않음, 일반과세자로 바꾸면 다시 연다(세무사·세무서 확인)"로 맞춰진다
- 확인: 서버 시험·수동(문서 읽기)

**AC-PL1B-05** [web] · BIL-01·UX-01 · D-PL1-07 — 사업자 정보 화면
- Given 요금 화면의 사업자 정보 칸(1440·375)
- Then 고치는 칸: 사업자등록번호·상호·대표자 이름·"증빙 받을 이메일 (선택)". **계좌이체 증빙 고르기(라디오)가 없다**(`radio` 0개 — 이 칸 안). 칸 아래 "계좌이체 증빙: 현금영수증(지출증빙)"과 "세금계산서는 지금은 발급할 수 없어요. 카드로 결제하면 카드 매출전표가 증빙이에요." 저장 요청 본문에 `receiptKind`가 없거나 `CASH_RECEIPT`다. 보기 칸: "증빙 받을 이메일"·"계좌이체 증빙 — 현금영수증(지출증빙)"(저장값이 옛 `TAX_INVOICE`여도 서버가 `CASH_RECEIPT`로 주므로 같다). 화면 어디에도 "세금계산서 받을 이메일"이 없다
- 확인: 웹 단위 시험 + E2E(AC-PL1B-08)

**AC-PL1B-06** [web] · BL-9 · D-PL1-07 — 결제 전 안내·증빙 상태
- Then 결제 창 전 안내에서 계좌이체를 고르면 "현금영수증(지출증빙)을 발행해요."("세금계산서(또는 현금영수증)를 발행해요."는 없다). 시험 발행기로 발행된 새 증빙은 결제 내역에 "현금영수증 발행됨 · TEST-…". 증빙 낱말 표(`세금계산서`·`현금영수증`)는 옛 기록 표시를 위해 그대로 둔다. 요금 표 한 줄 "… · 30,000원 (부가세 포함)"은 그대로, 화면 어디에도 공급가액·세액 숫자가 없다
- 확인: 웹 단위 시험 + E2E

**AC-PL1B-07** [web] · BL-10 · D-PL1-07 — 약관 초안
- Then 화면의 이용권 약관 초안 "증빙" 항목 글이 BILLING_RULES BL-10 8과 글자 하나까지 같다("계좌이체로 결제한 이용권은 현금영수증(지출증빙)을 발행한다. 카드 결제는 카드 매출전표가 증빙이다. 회사는 지금 세금계산서를 발행하지 않는다." — 대괄호 법률 검토 메모는 화면에 보이지 않는다, 다른 항목의 메모와 같은 규칙). 나머지 항목은 그대로
- 확인: 웹 단위 시험(문서와 화면 글 맞대기)

**AC-PL1B-08** [e2e] · BIL-01 · D-PL1-07 — 증빙 흐름 (`@billing`)
- When 사업자 정보를 적고 저장한다 → 계좌이체로 이용권을 산다(시험 결제 창)
- Then AC-PL1B-05의 칸·문장, 결제 전 "현금영수증(지출증빙)을 발행해요.", 결제 내역 "현금영수증 발행됨 · TEST-…". `tests/e2e/n5/billing.spec.ts`의 바뀐 두 문장에 D-PL1-07 주석
- 확인: E2E

### 포장 모드 B1 출력 (D-PL1-05)

**AC-PL1B-10** [web] · STL-08·LBL-02 · D-PL1-05 — 포장 라벨 출력 버튼
- Given 라벨 기능 켜짐, 실제 날짜의 포장 모드에서 품목이 있는 구매자 X를 연다
- Then 포장 라벨 칸(`region "포장 라벨"`)에 보통 버튼 "포장 라벨 출력"이 "라벨 PDF"와 같은 줄에 있다(주 버튼은 지금처럼 체크리스트의 포장 완료). 누르면 `POST /api/print/packing { requestId, date, buyer: X }` 하나(정산 자세히와 같은 모양·같은 다시 보내기 규칙) — 보내는 동안 버튼이 잠긴다. 성공하면 "포장 라벨 N장 출력을 접수했어요."(role=status, N = 응답 작업 수). 서버 거절은 서버 문장 그대로(예: 출력 기기 없음은 지금처럼 접수되어 대기 — 같은 성공 문장)
- 확인: 웹 단위 시험 + E2E(AC-PL1B-15)

**AC-PL1B-11** [web] · LBL-02 · D-PL1-05 — 누를 때만, 누를 때마다
- Then 체크를 모두 하거나 "포장 완료"를 눌러도 출력 요청이 가지 않는다. 버튼을 두 번(첫 응답 뒤) 누르면 요청이 두 번, 서로 다른 `requestId`. 포장 라벨 그림이 다시 만들어지는 동안(미리 보기 받는 중)에도 누를 수 있고 서버가 지금 묶음으로 만든다(화면 그림을 보내지 않는다)
- 확인: 웹 단위 시험

**AC-PL1B-12** [web] · RCP-01 · L-13 9 · D-PL1-05 — 라벨이 꺼져 있거나 모를 때
- Given 라벨 기능 꺼짐
- Then 포장 모드의 포장 라벨 칸 전체가 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."(정산 자세히와 같은 안내 조각) — 미리 보기·그림 저장·라벨 PDF·포장 라벨 출력이 없고 포장 라벨 그림 요청(`packing-label`·`.png`)도 보내지 않는다. 다른 기기에서 켜면 1초 안에 칸이 돌아온다(라벨 켬/끔 알림 — 지금 연결 그대로). 켬/끔을 모르는 동안(불러오는 중·실패) "포장 라벨 출력"이 없다. 체크리스트·포장 완료·배송은 켬/끔과 상관없다
- 확인: 웹 단위 시험 + E2E

**AC-PL1B-13** [web] · STL-08 · D-PL1-05 — 품목 없는 묶음
- Then 담을 상품이 없는 묶음은 지금처럼 "담을 상품이 없어 포장 라벨을 만들 수 없어요."만 있고 "포장 라벨 출력"이 없다
- 확인: 웹 단위 시험

**AC-PL1B-14** [web] · STL-08 · D-PL1-04·D-PL1-10 — 봉인 날짜에서 숨김 (합칠 때)
- 이 기준은 **뒤에 main에 합치는 트랙**이 채운다. PL1A(포장 목록 응답의 `sealed`, 봉인 날짜 체크리스트)가 먼저 main에 들어가 있으면 PL1B가 합치기 전에 `sealed`를 포장 라벨 칸에 넘겨 출력 버튼을 그리지 않는다(그림 저장·라벨 PDF는 그대로). PL1B가 먼저 들어가면 PL1A가 한다(AC-PL1A-19). 서버는 봉인 날짜 출력 요청을 409로 거절한다(PL1A AC-PL1A-16)
- Then 봉인 날짜의 포장 모드에 "포장 라벨 출력" 0개
- 확인: E2E(PL1A의 AC-PL1A-90 단언)

**AC-PL1B-15** [e2e] · LBL-02 · D-PL1-05 — 포장 모드에서 시험용 프린터로 출력
- Given 라벨 켜짐, 이 기기를 출력 기기로 정하고 시험용 프린터를 이은 판매자(I1 E2E와 같은 길), 품목 12개(2쪽)인 구매자
- When 포장 모드에서 그 구매자를 열고 "포장 라벨 출력"을 누른다
- Then "포장 라벨 2장 출력을 접수했어요.", 출력 대기열에 포장 라벨 작업 2개가 생기고 시험용 프린터가 2장을 받는다(I1 E2E가 출력을 확인하는 방법 그대로). 라벨 기능을 끈 뒤 다시 열면 AC-PL1B-12의 안내. `tests/e2e/i2/packing.spec.ts` "B1 버튼 없음" 단언은 D-PL1-05 주석과 함께 "포장 라벨 출력이 있다"로 바꾼다(지금 정규식 `/B1|프린터/`는 새 버튼 이름과 맞지 않아 그대로 통과하더라도 뜻이 바뀌었으므로 고친다)
- 확인: E2E(`tests/e2e/pl1b/**`)

### 시작 마법사 "라벨을 쓰지 않아요" (D-PL1-06)

**AC-PL1B-16** [web] · UX-02·RCP-01 · D-PL1-06 — 보이는 때
- Given 시작 마법사 4/5 프린터 연결
- Then 라벨 켜짐: 연결 칸 아래 보통 버튼 "라벨을 쓰지 않아요"와 그 아래 "라벨 없이 팔아요. 설정에서 언제든 다시 켤 수 있어요." 켬/끔을 모름: 버튼 없음("불러오는 중…" 그대로). 꺼짐: 지금처럼 "라벨 쓰지 않음" 안내만, 버튼 없음
- 확인: 웹 단위 시험

**AC-PL1B-17** [web] · UX-02 · L-13 1·2 · D-PL1-06 — 고르면 끄고 다음 단계로
- When "라벨을 쓰지 않아요"를 누른다
- Then 확인 창 없이 `PUT /api/settings/labels { enabled: false }` 하나 — 보내는 동안 이 버튼과 "다음"이 잠긴다. 성공하면 단계 제목이 "5/5 리허설 해 보기"(포커스는 그 제목), 서버 단계 기록도 5. 설정 화면의 "바꾼 기록"에 "라벨 끔 · <로그인 아이디>" 한 줄(설정 화면에서 끈 것과 같은 이력). 메뉴의 "라벨"이 이 기기와 다른 기기에서 1초 안에 사라진다. 5/5에서 "이전"은 3/5 유튜브 연결로 간다(꺼지면 프린터 단계를 건너뛰는 지금 규칙)
- 확인: 웹 단위 시험 + E2E(AC-PL1B-19)

**AC-PL1B-18** [web] · UX-02 · D-PL1-06 — 실패하면 그 단계에 머문다
- When 서버가 끄기 요청에 5xx(또는 네트워크 실패)로 답한다
- Then 단계 4/5 그대로, 서버 문장(또는 지금 쓰는 네트워크 실패 문장)이 보이고 라벨 기능은 켜진 그대로(메뉴 "라벨" 그대로). 버튼이 다시 눌린다
- 확인: 웹 단위 시험

**AC-PL1B-19** [e2e] · UX-02 · D-PL1-06 — 마법사 흐름
- Given 실제 방송이 없는 새 판매자(라벨 켜짐)
- When 마법사 1→2→3→4에서 "라벨을 쓰지 않아요"
- Then 5/5, 설정 화면 "라벨 기능: 꺼짐", 메뉴에 "라벨" 없음, 리허설 시작 → 콘솔에 라벨 문장 없음(L-13 10)
- 확인: E2E(`tests/e2e/pl1b/**` — `tests/e2e/i3/**`·`wiz/**`의 기존 시험은 고치지 않는다)

### BL-7 환불 결과 모름·밖에서 취소 (D-PL1-08)

**AC-PL1B-20** [server] · BIL-01 · BL-7 5·6 · D-PL1-08 — 요금 골든 `granted`
- Then 서버 요금 골든 시험(`apps/server/test/billing-golden.test.ts`)이 종류 `granted`를 읽어 `judgeGranted`로 돌리고 `out`과 같음을 본다 — 파일 수 5·사례 수 82(status 26 · payment 21 · vat 7 · bizno 13 · granted 15) 고정값(D-PL1-08 주석), 모르는 키·열거값·중복 ID는 지금처럼 읽기 오류(granted ID는 G-BIL-401~415 — bizno 301~313과 겹치지 않는다). `judgeGranted` 코드는 바꾸지 않는다(골든 15개가 지금 코드로 통과한다 — spec-keeper가 계산해 확인함). TZ 세 가지 결정성 검사에 `granted`도 든다
- 확인: 서버 시험

**AC-PL1B-21** [server] · BL-7 5 · D-PL1-08 — 결과를 모르는 환불
- Given 쓰지 않은 결제 이용권 하나, 가짜 결제 서버가 결제 취소 요청에 (a) 응답 없이 시간 초과(실제로는 취소함) (b) 5xx(실제로는 취소 안 함)로 답한다
- When 판매자가 환불한다 → 결제 내역을 연다(맞추기) → (b)는 맡은 요청의 기한이 지난 뒤 다시 연다
- Then 환불 직후 둘 다 409 "환불을 처리하는 중이에요. 잠시 뒤 결제 내역을 확인해 주세요.", 그 이용권은 새 방송 시작·잔량에 쓰이지 않는다(정액이면 미리 보기가 그 이용권으로 시작하지 않는다). 같은 결제의 두 번째 환불도 409이고 결제 취소 요청은 한 번뿐. 맞춘 뒤: (a) 회수·"환불함" (b) 기한 전에는 그대로, 기한 뒤 환불 중이 풀리고 이용권을 다시 쓸 수 있다(회수 없음). 기존 서버 시험이 이를 이미 덮으면 그 시험 이름을 dev-notes에 적고 빠진 칸만 더한다
- 확인: 서버 시험

**AC-PL1B-22** [server] · BL-7 6 · D-PL1-08 — 밖에서 취소된 결제
- Given 부여된 카드 결제(환불 중 아님), 가짜 결제 서버에서 그 결제를 취소 상태로 바꾼다(포트원 콘솔 취소 흉내)
- When 웹훅 또는 결제 내역 열기로 맞춘다
- Then 주문 `NEEDS_REVIEW`(화면 "확인 필요"), 경고 로그 `PAYMENT_REVIEW`(결제 ID·금액·판매자 이름 없음), 운영자 목록에 보인다. 이용권은 회수되지 않아 그 판매자가 바로 새 실제 방송을 시작할 수 있다. 다시 맞춰도 같은 상태(두 번 올리지 않음)
- 확인: 서버 시험

### 끝에서 넘긴 문자찜 카드 시험 (D-I5-20 — 동작 변경 없음)

**AC-PL1B-23** [web] · VOC-04 · D-I5-20 — 저절로 넣지 않는다 (단위)
- Given 음성 켬, 문자찜 듣기 켬(기다림 3초), 15번 상품 있음, 가짜 엔진
- When (a) 끝에서 넘긴 결과(`flushedAtEnd` 참)로 "15번 문자찜 끝자리 1234"가 온다 (b) 같은 문장이 보통 최종 결과로 온다(다른 시험)
- Then (a) 문자찜 카드가 생기고 30초가 지나도 `sms` 쓰기가 0번, 카드에 "N초 뒤 넣어요"가 없다. 카드의 "넣기"를 누르면 쓰기 1번(15번·끝자리 1234). "넣지 않기"를 누르면 쓰기 0번. (b) 3초 뒤 쓰기 1번(대조군 — 미루기를 없애면 (a)가 실패함을 시험 안에서 보인다). 같은 말 검사·열린 카드 수 규칙은 (a)·(b)가 같다(같은 문장을 다시 말하면 앞 카드에 표시)
- 확인: 웹 단위 시험(`apps/web/test/voice-controller.test.ts`에 더함 또는 `pl1b-voice-flush.test.ts`)

**AC-PL1B-24** [web] · VOC-04 · D-I5-20·D-I5-09 — 밀려 닫힘 알림은 상품 카드만 (단위)
- Given 열린 카드가 가득 찬 상태(상품 카드·문자찜 카드 섞임)
- When 끝에서 넘긴 상품 카드와 끝에서 넘긴 문자찜 카드가 각각 밀려나는 경우를 만든다
- Then 끝에서 넘긴 **상품** 카드가 밀려 닫히면 "알겠어요"까지 남는 알림에 그 카드 글이 쌓인다. 넣을 수 있는 문자찜 카드는 열린 카드 수 규칙으로 닫히지 않는다(D-V1-18) — 밀려 닫힘 알림에 문자찜 카드 글이 없다
- 확인: 웹 단위 시험

**AC-PL1B-25** [web] · VOC-04 · D-I5-20·D-I5-10 — 휴대폰에서 맨 앞 카드가 보이게 (단위)
- Given 375px 폭(넓지 않음), 고치는 칸이 열려 있지 않음
- When 맨 앞에 새 문자찜 카드가 생긴다(끝에서 넘긴 것과 보통 것 각각)
- Then 목록 첫 줄 요소로 보이게 내리기가 한 번 불린다(상품 카드와 같다). PC 폭·고치는 중이면 불리지 않는다
- 확인: 웹 단위 시험(`VoicePanel` — 내리기 함수를 감시)

**AC-PL1B-26** [e2e] · VOC-04 · D-I5-20 — 사파리 흉내로 끝 넘김 문자찜 (`@webkit`)
- Given `webkit-iphone` 묶음, 사파리 흉내 가짜 인식(I5 AC-I5-20 모양 — 최종 표시 없이 끝남), 문자찜 듣기 켬, 15번 상품
- When 중간 결과 "15번 문자찜 끝자리 1234" 뒤 최종 없이 끝난다
- Then 문자찜 카드가 보이고 10초 동안 구매자·문자찜 목록에 새 문자찜이 없다. "넣기"를 누르면 15번에 끝자리 1234 문자찜이 생긴다. 화면이 393px에서 깨지지 않는다(가로 넘침 없음)
- 확인: E2E(`tests/e2e/pl1b/**`, 제목에 `@webkit`)

### 음성을 켠 직후 2초 미룸 확정 (D-PL1-09 — 동작 변경 없음)

**AC-PL1B-27** [web] · VOC-03 · D-PL1-09
- Then `apps/web/src/voice/controller.ts`의 미룸 동작(`HISTORY_WAIT_MS` = 2000)을 바꾸지 않는다. N3이 더한 단위 시험(이력을 기다린 뒤 온 차례·2초 넘으면 그때 사전·실패면 바로·끄면 카드·떠나면 버림·온 때의 설정과 번호 범위·보인 때부터 기다림)이 그대로 통과한다. 그 시험 이름 위에 `D-PL1-09` 주석을 더하는 것만 된다. 시험이 D-PL1-09의 한 항목이라도 덮지 않으면(dev-web이 확인해 dev-notes에) 그 항목의 시험을 더한다
- 확인: 웹 단위 시험

### 완료로만 적는 것

**AC-PL1B-28** — PL1-13·PL1-14
- PL1-13(`tests/e2e/menu.ts` 정규식 — 커밋 `ffb5de1`)과 PL1-14(`scripts/harness/stages.mjs` E2E 결과 없음 안내에 WebKit 설치 — 커밋 `880ad9f`)는 BASE에 이미 들어 있다. 이 스프린트에서 할 일이 없고 백로그에 완료로 적는다
- 확인: `git log`

### 시험 (domain · 금지 경로)

**AC-PL1B-91** [domain] · BL-8·L-13 · D-PL1-07·D-PL1-05 — 적대 시험
- (a) 사업자 정보 저장에 `receiptKind`를 `' TAX_INVOICE'`·`'TAX_INVOICE\u0000'`·`'Tax_Invoice'`·배열·객체·아주 긴 글로 보내면 모두 422이고 저장 없음, 저장된 종류는 늘 `CASH_RECEIPT` (b) 라벨 기능을 끈 판매자의 `POST /api/print/packing`은 지금처럼 `LABELS_OFF`, 리허설은 `PRINT_REHEARSAL`, 다른 판매자의 구매자 ID는 404 — 작업이 생기지 않는다 (c) 같은 `requestId`로 두 번 보낸 포장 라벨 출력은 작업이 한 번만 생긴다(지금 서버 규칙 — 화면이 같은 ID를 다시 보내는 경우)
- 확인: 적대 시험(`tests/adversarial/pl1b/**`)

**AC-PL1B-92** · 금지 경로 — 유튜브 파일을 고치지 않았다
- Then `git diff --name-only BASE HEAD`에 `apps/server/src/youtube/`, 파일 이름에 `youtube`·`Youtube`가 든 `apps/web/src/` 파일, `tests/e2e/i3/`, `tests/e2e/y1/`이 없다. `WizardPage.tsx`의 바뀐 줄은 프린터 단계 블록 안이다. 파일 경계 표의 PL1A 몫 파일이 없다(`PackingPage.tsx`는 `PackingLabelSection`과 import만)
- 확인: 게이트(오케스트레이터)·`git diff`

## 사용성 검토 (ux)

- 포장 모드(375px, 한 손): "포장 라벨 출력"이 주 버튼(포장 완료)과 헷갈리지 않는지, 출력 접수 문장이 체크리스트를 가리지 않는지.
- 사업자 정보: 고르는 칸이 사라진 뒤 "세금계산서는 지금은 발급할 수 없어요" 문장이 쉬운지.
- 마법사 4/5: "라벨을 쓰지 않아요"가 "나중에 할게요"와 헷갈리지 않는지(앞은 라벨을 끄고, 뒤는 마법사를 닫는다).

## 이번 스프린트에서 하지 않는 것 (범위 밖)

- **맥북 쪽 유튜브 작업으로 넘김**: PL1-10(SA-I3-002 멈춤 이유별 "채팅 다시 받기" 표시 · SA-I3-003 마친 마법사를 다시 열 때 상태 · SA-I3-004 다른 기기 설정 저장 때 요약 갱신 범위), PL1-11(SA-I3-005 유튜브 E2E 보강), PL1-15(UX-I3 minor·nit, RA-I3 minor) — `apps/server/src/youtube/**`·유튜브 화면·`tests/e2e/i3` 몫이라 이 스프린트에서 손대지 않는다(백로그에 적음)
- 세금계산서 발급·간이과세자 증빙의 실제 금액 칸·팝빌 실제 연동(사용자 확인 — D-PL1-07)
- `judgeGranted`·환불 흐름의 동작 변경(확정만), 밖에서 취소된 결제의 자동 회수
- 음성 엔진·카드 규칙의 동작 변경(D-I5-20·D-PL1-09는 시험·문서만)
- 포장 완료 때 저절로 출력, 포장 라벨 템플릿 바꾸기
- 봉인 날짜의 백업·문서·409(PL1A)
