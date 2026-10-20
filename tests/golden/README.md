# 골든 시나리오 (실행 가능한 스펙)

이 폴더는 **보호 경로**다. spec-keeper만 수정한다. 개발자·테스터가 이 폴더의 파일을 바꾸면 하네스 게이트가 실패한다.
골든은 DOMAIN_RULES.md의 규칙을 예시로 고정한 것이다. 구현이 골든과 다르면 구현이 틀린 것이다.
골든이 스펙과 다르면 spec-keeper가 DECISIONS.md 근거와 함께 고친다.

## 파일

| 경로 | 내용 |
|---|---|
| `parser/chat.yaml` | 채팅 메시지 → 주문/취소/언급 (R-3). Y1 보강: 발송함이 게시하는 감사 문구(한 건·묶음)는 STRICT에서 주문이 아니다(D-Y04·D-Y07). N2 사례: 인스타그램 댓글 모양 — 다른 계정을 부른 `@이름`·해시태그 `#`가 섞인 댓글은 주문·취소가 아니다(언급), 줄을 바꾼 번호는 띄어 쓴 번호와 같다(D-N2-02, 새 규칙 없음) |
| `parser/amount.yaml` | 한글·숫자 금액 → 원 (빠른 입력·음성 공용), 한글 수사 → 정수 |
| `parser/quick-input.yaml` | 빠른 입력 한 줄 → 번호·품종·가격 |
| `engine/*.yaml` | 이벤트 순서 → 판정·합계·효과 (R-4~R-13). `08-time.yaml`은 시각 해석(D-022, D-023), `09-host-and-product.yaml`은 방송자 조치·상품 명령 세부(S02, D-039~D-043·D-049). S03 보강: `10-sms.yaml` 문자찜 구매자(D-051), `11-received-time.yaml` 실제 시각순·역전·충돌·메시지 변환(D-052~D-054), `12-product-edit.yaml` 상품 수정·번호 변경(D-055·D-056), `13-merge-settlement.yaml` 구매자 합치기·정산(D-057·D-058). S03b 보강: `14-core-cleanup.yaml` 전화번호 키·문자찜 재전송·메시지 변환·시청자 취소·충돌 중 배정·확정버전 순서·충돌이 풀릴 때 대기 넘침(D-061~D-068). S04 보강: `15-broadcast.yaml` 방송 시작·종료와 방송마다의 설정 스냅샷(D-069·D-070), `16-s04-rules.yaml` 취소 메시지 변환 금지·대기 한도 0의 승계 묻기(D-076·D-077), S04 마무리 G-ENG-166 전화번호가 아닌 숫자는 받는다(D-079·D-080). S05 보강: `17-s05-console.yaml` 라이브 콘솔이 기대는 동작 — 등록 되돌리기(판매 종료)·5초 뒤 보낸 방송자 조치(D-083, 새 규칙 없음). S06 보강: `18-s06-sms-buyers-settlement.yaml` 문자찜 입력·구매자·정산 화면이 기대는 동작 — 수신 시각 기본값(초까지)·지정 구매자·끝난 방송의 늦은 문자찜·합치기가 막히는 경우와 중복·입금 바로잡기·떼어 내기가 막히는 경우·배송비 예외와 조정(D-089~D-092, 새 규칙 없음). S06b 보강: `19-s06b-merge-preview.yaml` 합치기 미리 보기(코어 `previewMerge`, 새 검사 키 `mergePreviews`)가 R-11과 같은 답 — 막히는 다섯 경우·옮길 찜·합친 뒤 합계·중복 정리 순서(D-100), `20-s06b-sms-buyer-payment.yaml` 뒤 4자리만 같은 두 문자 구매자에서 문자찜이 정한 구매자(D-099)·입금이 아닌 기록이 바꾸는 입금 상태(D-101) (새 규칙 없음). I1 보강: `21-i1-labels.yaml` 라벨·출력 화면 통합이 기대는 동작 — 라벨 키 = (찜, 확정버전)·출력 보고 잠금·품종·가격 변경은 효과 없음·재고 2의 라벨 키·방송마다의 자동 출력·포장 라벨 효과 없음·합치기는 라벨을 폐기하지 않음(D-I1-02·D-I1-04, 새 규칙 없음). Y1 보강(병렬 트랙 — 번호는 G-ENG-401부터): `19-y1-youtube.yaml` 유튜브 서버가 기대는 동작 — 묶음 감사의 효과마다 게시 보고·영상 댓글 보고도 잠금·게시 직전 취소된 효과, 끊겼다 이어받은 채팅의 접수순 판정과 겹친 사본(D-Y04·D-Y06·D-Y07, 새 규칙 없음). I3 보강(번호는 G-ENG-701부터 — 러너 형식이 `G-ENG-` + 세 자리라 `G-ENG-I3-…`은 쓰지 않는다, D-I3-18): `22-i3-settings.yaml` 설정 화면·시작 마법사가 기대는 동작 — 감사 메시지(`thanks.liveChat`·`thanks.videoComment`)·대기·승계·자동 출력·배송비를 바꾸고 같은 날 2부를 시작해도 1부 상품은 1부 스냅샷으로 판정·효과, 그날 배송비는 첫 방송 것(D-070·D-I3-08, 새 규칙 없음). N2 보강: `22-n2-instagram.yaml` 인스타그램 라이브 댓글이 기대는 동작 — `ig:` 접두어 키·username·게시 시각 없는 `chat`이 유튜브 채팅과 같게 판정되고 재배달·판매자 댓글·부르기 댓글은 찜이 없음, 한 댓글 두 번호의 감사 효과·게시 보고 뒤 취소·승계·메시지 변환·문자찜·직접 배정의 감사 효과(서버 DM의 재료), 같은 날 유튜브(실제 시각순)·인스타(접수순) 회차와 플랫폼 사이 합치기(G-ENG-N2-01~03, D-N2-02~D-N2-05·D-N2-09, 새 규칙 없음). N2b-2 보강: `23-n2b2-multi-platform.yaml` 동시 송출·틱톡이 기대는 동작 — 한 방송에 틱톡(`tt:` 키)·유튜브·인스타 댓글이 섞여도 접수순이면 서버 도착순(게시 시각이 이른 유튜브 채팅도 늦게 오면 대기), 같은 닉네임 다른 플랫폼은 다른 구매자, 틱톡 방송자 댓글·재수신은 찜 없음, 틱톡·인스타 합치기, 붙여넣기 = 번호마다 문자찜(한 번 넣기 안의 같은 닉네임은 지정 구매자로 한 구매자, 다시 보낸 넣기는 재전송 사본)과 틱톡 구매자에 합친 뒤의 승계(G-ENG-N2b-2-01·02, D-N2b-2-02·03·07·08, 새 규칙 없음) |
| `parser/voice-extract.yaml` | 음성 문장 하나 → 번호·품종·가격·신뢰도 (R-17, P2 — D-202·D-203·D-209, I4 보강 — 끊어 말한 번호 D-I4-01). 추출기는 `packages/voice`에 있고 이 러너가 부른다 |
| `known-unimplemented.yaml` | **예약 파일.** 알려진 미구현 허용 목록 (D-020). 골든 시나리오가 아니다 |
| `label/*.json` | 라벨 글·쪽 나누기·크기 (LABEL_RULES L-1~L-5, P1, D-P1-01). **JSON이라 코어 골든 러너는 읽지 않는다**(`*.yaml`만 읽는다). `packages/label` 단위 테스트가 읽는다 — 아래 "라벨 골든" |
| `printer/*.json` | 프린터 작업 바이트·기기 이름으로 고르기·프로필 표·바로 연결할 수 없는 브라우저의 까닭 (LABEL_RULES L-7·L-12, N1 — D-N1-01·09). **JSON이라 코어 골든 러너는 읽지 않는다.** `packages/printer` 단위 테스트가 읽는다 — 아래 "프린터 골든" |
| `tiktok/*.json` | 틱톡 아이디·방송 주소 해석, 웹캐스트 댓글 → 공통 댓글 레코드·중복 제거 (PLT-02, N2b-1, D-N2b-1-02~04), 공통 댓글 레코드 → `chat` 다섯 칸·댓글 붙여넣기 줄 읽기 (N2b-2, D-N2b-2-03·07). **JSON이라 코어 골든 러너는 읽지 않는다**. `apps/server` 시험이 읽는다 — 아래 "틱톡 골든" |

## 러너가 읽는 범위 (D-020, D-021)

- `tests/golden/` 아래 모든 `*.yaml`·`*.yml`을 하위 폴더까지 읽는다. 예외는 예약 파일 `tests/golden/known-unimplemented.yaml` 하나뿐이다.
- 파일은 경로의 문자 코드 순서로, 문서는 파일 안 순서로 처리한다. 같은 골든이면 출력도 항상 같다.
- **YAML 1.2 core schema**로 읽는다. 날짜·시각을 자동 변환하지 않고, `true`/`false`만 불리언이다. (`no:` 키나 `OFF` 값이 불리언으로 바뀌는 YAML 1.1 사고를 막는다.)
- 문서마다 `suite`가 있으면 파서 suite, `id`가 있으면 엔진 시나리오다. 둘 다 아니면 **읽기 오류**.
- 이 README의 형식 계약(이벤트 종류·필드, 설정 키, `expect` 키, 열거값, 시각 형식)에 없는 것이 나오면 **읽기 오류**다. 오타가 조용히 무시되어 검사가 빠지는 일을 막기 위해서다. 새 어휘가 필요하면 spec-keeper가 이 README에 먼저 추가한다.

## 결과 상태

| 상태 | 뜻 | 실패로 세나 |
|---|---|---|
| 통과 | 기대와 같음 | 아니오 |
| 불일치 | 기대와 다름 | **항상 실패** |
| 미구현 | 코어가 그 기능을 아직 "미구현"이라고 알림 (방법은 코어가 하나로 정함) | 허용 목록에 있으면 아니오(`미구현(허용)`으로 따로 셈), 없으면 실패 |
| 읽기 오류 | YAML 문법 오류, 형식 계약 위반, 허용 목록 오류 | **항상 실패** |
| 결정성 위반 | 같은 시나리오를 처음부터 두 번 돌린 결과가 다름 (NFR-02) | **항상 실패** |
| 러너 오류 | "미구현" 외의 예외, 효과 보고 이벤트의 대상 효과 없음 등 | **항상 실패** |

- 허용 목록에 있는데 실제로 통과한 항목은 "허용 목록에서 빼도 됨" 경고로 보여 준다(실패 아님).
- 실패마다 위치(파일, 시나리오 ID 또는 suite·사례 번호·입력, 중간 검사면 `events[n]`), `expect` 경로(예: `products.b1/15.winner`), 기대값, 실제값을 보여 준다.
- 끝에 합계를 보여 준다: 파일 수, 사례·시나리오 수, 통과 / 불일치 / 미구현(허용) / 미구현(불허) / 읽기 오류 / 결정성 위반 / 러너 오류.

## 파서 사례 형식

```yaml
suite: chat
settings: { multiNumber: ALL, maxNumber: 999 }   # 생략하면 DOMAIN_RULES 기본값
cases:
  - { in: "15번", out: { claims: [15] } }
  - { in: "15 취소", out: { cancels: [15] } }
  - { in: "15번 예뻐요", out: { mentions: [15] } }  # 주문 아님, 강조만
  - { in: "안녕하세요", out: {} }
```
`out`에 없는 키는 빈 값이어야 한다. 즉 `{}`는 주문·취소·언급이 모두 없다는 뜻이다.

| suite | settings 키 (DOMAIN_RULES 키) | `out` 형식과 비교 |
|---|---|---|
| `chat` | `parseMode`(`claim.parseMode`), `multiNumber`(`claim.multiNumber`), `maxNumber`(`claim.maxNumber`) | 키는 `claims`·`cancels`·`mentions`만. 값은 1 이상 정수 배열이고 **메시지에 나온 순서대로** 같아야 한다. 없는 키 = 빈 배열 |
| `amount` | `unit`(`price.unit`: `WON`/`THOUSAND`) | 0 이상 정수(원) 또는 `null`(해석 실패) |
| `korean-number` | 없음 | 1 이상 정수 또는 `null` |
| `quick-input` | `unit`(`price.unit`) | 성공 `{ no, name, price }` 정확히 세 키. 실패 `{ error, no?, name? }`, `error` ∈ `PRICE_MISSING`·`NUMBER_MISSING`·`EMPTY`·`NUMBER_INVALID`·`PRICE_TOO_LOW`. **`out`에 없는 키는 실제 결과에도 없어야 한다**(`undefined`는 없음으로 본다) |
| `voice-extract` (P2, D-209) | `maxNumber`(`claim.maxNumber`, 1~9999), `dictionary`(품종 사전 — 문자열 목록, 0개 이상, 생략하면 빈 목록. DOMAIN_RULES 설정표 키가 아니라 이 suite의 입력이다. 기본 사전은 쓰지 않는다) | `out` 키는 `no`(1 이상 정수)·`name`(빈 문자열이 아닌 문자열)·`price`(100 이상 정수)·`confidence`(`HIGH`/`LOW`, **필수**)만. `no`·`name`·`price`는 적지 않거나 `null`이면 `null`. 실제 결과는 정확히 네 키 `{ no, name, price, confidence }`(값이 없으면 `null`)이고 네 값이 모두 같아야 한다. 규칙은 DOMAIN_RULES R-17 |

사례의 키는 `in`(문자열)과 `out`뿐이다.

## 엔진 시나리오 형식

YAML 문서 하나 = 시나리오 하나. 한 파일에 `---`로 여러 개를 넣는다.

```yaml
id: G-ENG-001
title: 한 줄 설명
refs: [ORD-03, R-4]          # 연결된 스펙 ID
settings: {}                  # DOMAIN_RULES 설정표 키 (점 표기 그대로)
broadcasts:
  - { id: b1, date: 2026-10-18, title: 1부 }
events:                       # 파일 순서 = 서버 도착 순서(seq)
  - { at: "20:00:00", type: product.register, b: b1, no: 15, name: 핑크프릴, price: 10000 }
  - { at: "20:00:02.1", type: chat, b: b1, id: m1, ch: UC_A, nick: 홍길동, text: "15" }
expect:
  products:                   # "방송/번호"
    b1/15: { status: SOLD, winner: UC_A, waitlist: [UC_B], conflict: false }
  buyers:                     # 유튜브=채널ID, 문자=sms:<ref>
    UC_A: { items: [b1/15], subtotal: 10000 }
  settlements:                # "구매자@날짜"
    UC_A@2026-10-18: { subtotal: 10000, shipping: 4000, total: 14000, payment: UNPAID }
  effects:                    # 지금까지 엔진이 낸 효과 (실행 여부 무관), 순서 무관
    - { kind: POST_THANKS, target: LIVE_CHAT, product: b1/15, buyer: UC_A, text: "15번 핑크프릴 10,000원 홍길동님 구매 감사합니다" }
  claims:                     # 필요할 때만: 특정 찜 상태 확인
    - { product: b1/15, buyer: UC_C, status: REJECTED, reason: SOLD_OUT }
  pending: { b1/16: [UC_D] }  # 보류 중인 찜
```

- 시나리오 키: `id`(`G-ENG-` + 세 자리, 또는 병렬 트랙 형식 `G-ENG-<스프린트 ID>-<두 자리>` — 스프린트 ID는 영문 대문자로 시작하는 영문·숫자 1~8자이고 뒤에 `-` + 숫자 1~2자리를 한 번 붙일 수 있다, 예: `G-ENG-N2-01`(N2, D-N2-13)·`G-ENG-N2b-2-01`(N2b-2, D-N2b-2-12). 전체에서 유일), `title`, `refs`(1개 이상), `broadcasts`(0개 이상, 각 `{ id, date: YYYY-MM-DD, title }` — S04부터 빈 목록 `[]`도 된다: 서버처럼 빈 엔진에서 시작해 `broadcast.start`로 방송을 선언한다), `events`, `expect`, 선택 `settings`.
- `settings`는 DOMAIN_RULES 기본값 위에 덮어쓰며, `broadcasts` 목록의 방송(시작 때 선언한 방송)에 시작 시점 스냅샷으로 적용된다. `broadcast.start`로 선언한 방송은 그 이벤트의 `settings`(DOMAIN_RULES 기본값 위 — 시나리오 `settings`와 상관없다)를 쓴다 (S04, D-070).

**추가 검사 키** (`expect` 안, 필요할 때만)

| 키 | 뜻 |
|---|---|
| `products.<p>.winners` | 재고 2 이상일 때 확정 구매자 목록(순서 무관) |
| `products.<p>.exists: false` | 그 번호의 상품이 없어야 함 |
| `products.<p>.price` / `priceHistory` | 현재 가격 / `[{from, to}]` 이력 |
| `buyers.<b>.byBroadcast` | 방송별 상품 합계 `{ b1: 20000, ... }` |
| `buyers.<b>.display` / `nameHistory` | 표시 이름 / 닉네임 이력 |
| `buyers.<b>.phoneLast4` | 전화번호 뒤 4자리. 숫자 4자리 **문자열**(`"0000"`처럼 따옴표로 — 따옴표 없이 적어 정수가 되면 읽기 오류) 또는 `null` (S03b, D-061) |
| `sameBuyer` | 같은 구매자로 이어져야 하는 키 묶음 `[[sms:s1, sms:s2]]` |
| `claimCount` | 생성된 찜 수 (재수신·같은 사람 반복은 찜을 만들지 않음) |
| `effectCounts` | 효과 종류별 정확한 개수 `{ POST_THANKS: 2 }` |
| `cancelRequests` | 대기 중인 시청자 취소 요청 `[{ product, buyer }]` |
| `settlements.<k>.adjustments` / `refundDue` | 조정 합계 / 환불 필요 금액 |
| `pendingEffects` | 아직 실행 대상(취소·SKIPPED 아님)인 효과의 정확한 목록. `confirmVersion` = 그 상품의 몇 번째 확정인지(1부터) |
| `broadcasts.<b>` | 방송 하나의 `date`·`title`·`ended`(끝났는지) (S04, D-070) |
| `mergePreviews` | 그 시점 상태에서 코어 순수 조회 `previewMerge(from, into)`를 부른 결과 목록 — 합치기 미리 보기(R-11 "구매자 합치기", S06b, D-100). 항목마다 `from`·`into`(필수)와 선택 `blocked`·`bothConfirmed`·`moving`·`after`·`duplicates` |

**중간 검사**: 이벤트 목록 안에 `{ type: assert, expect: {...} }`를 넣으면 그 시점의 상태를 검사한다. 중간 검사가 틀리면 마지막 `expect`가 맞아도 시나리오는 실패다.

**규칙**
- `at`은 `HH:MM:SS[.mmm]` (KST, 방송 날짜 기준). 채팅의 `publishedAt`은 따로 적지 않으면 `at`과 같다.
- 방송 시작·종료 (S04, D-070): `{ type: broadcast.start, b, date, title, settings? }`는 새 방송 `b`를 선언한다. 그 뒤의 이벤트는 `b`를 쓸 수 있다(그 전에 쓰면 읽기 오류). `b`가 이미 선언된 방송(`broadcasts` 목록이나 앞선 `broadcast.start`)이면 그 방송의 **재전송 사본**이다 — 내용(`date`·`title`·`settings`)이 달라도 엔진은 아무 일도 하지 않아야 한다(채팅 메시지 ID의 재수신처럼). `{ type: broadcast.end, b }`는 끝났다는 기록만 남긴다(판정·정산은 바뀌지 않는다, 다시 적으면 아무 일도 없다). 중간 검사와 마지막 `expect`에 적는 방송·상품 키(`broadcasts.<b>`, `<b>/<번호>`, `byBroadcast`)는 그 검사 시점까지 선언된 방송만 쓸 수 있다(마지막 `expect`는 모든 이벤트 뒤).
- 문자찜: `{ type: sms, b, ref: s1, no: 15, received: "20:01" | "20:01:05", memo?, phone? }` → 구매자 키 `sms:s1`.
  - `phone`은 판매자가 적은 글자 그대로다. 엔진은 전화번호 원문을 받지 않으므로(DOMAIN_RULES R-1, D-061) 러너(코어 어댑터)가 서버가 할 일을 흉내 내 바꿔 넘긴다: 코어 `normalizePhone`으로 정규화해 휴대폰 번호 모양이 아니면 전화번호 없이, 모양이면 `phoneKey` = 정규화한 번호마다 다르고 같은 번호면 같은 결정적 불투명 키(번호 숫자를 그대로 담지 않는 16~128자 영문·숫자·`_`·`-`, 예: 테스트 전용 비밀 키의 HMAC-SHA256 base64url)와 `phoneLast4` = 정규화한 번호의 뒤 4자리를 넘긴다. `phone`은 엔진에 넘기지 않는다.
  - 같은 `ref`를 다시 적으면 그 문자찜의 **재전송 사본**이다(채팅 메시지 ID의 재수신처럼, S03b, D-067). 사본은 다른 필드가 달라도 되고, 엔진은 아무 일도 하지 않아야 한다(INV-3·INV-12). 처음 것이 아무 일도 없었던 문자찜(모르는 지정 구매자)이어도 같다.
- 방송자 조치: `{ type: host.cancel, b, no, buyer, reason }` 같은 식. 이름은 DOMAIN_RULES R-1과 같다.
- 효과 실행 결과: `{ type: effect.labelPrinted, b, no, buyer }` / `{ type: effect.thanksSent, ... }`.
- `expect`에 적은 것만 검사한다. 적지 않은 상품·구매자는 검사하지 않는다(단, 불변식은 항상 검사).
- 러너는 시나리오마다 불변식 INV-1~12를 자동으로 함께 검사한다.
- 러너는 시나리오마다 처음부터 **두 번** 실행해 각 이벤트 뒤의 상태·효과가 같은지 확인한다. 다르면 결정성 위반 (NFR-02).

## 시각 (D-022, D-026)

| 형식 | 예 | 해석 |
|---|---|---|
| 짧은 형식 | `"20:00:00"`, `"20:00:02.1"`, `"20:00:02.100"` | 그 이벤트의 방송(`b`) 날짜의 KST 시각. `broadcast.start`는 그 이벤트의 `date` 기준이다(사본도 같다). 소수점 아래는 1~3자리 = 밀리초(`.1` = 100ms) |
| ISO 8601 | `"2026-10-19T00:00:10+09:00"`, `"2026-10-18T15:00:10Z"` | 적힌 오프셋 그대로. 오프셋 없는 ISO는 읽기 오류 |

- 러너는 `at`을 UTC 시각으로 바꿔 엔진에 넘긴다(예: 2026-10-18 방송의 `"20:00:00"` → `2026-10-18T11:00:00.000Z`). 결과는 실행 환경의 시간대와 무관해야 한다.
- `at`은 파일 순서대로 **줄어들면 안 된다**(같은 값은 허용). 자정을 넘긴 시각을 짧은 형식으로 쓰면 앞 이벤트보다 이른 시각이 되어 읽기 오류가 난다 → 자정 뒤는 ISO로 쓴다.
- `b`가 없는 이벤트(`host.blockBuyer`, `buyer.*`, `settlement.*` 등)의 짧은 형식은 방송 날짜가 하나뿐인 시나리오에서만 쓸 수 있다. 날짜가 다른 방송이 섞이면 ISO가 필수다. 방송 날짜는 `broadcasts` 목록과 시나리오의 모든 `broadcast.start`(사본 포함)의 `date`를 함께 센다.
- `publishedAt`은 `at`과 같은 형식이다. 순서 제한은 없다(유튜브 게시 시각은 도착 순서와 다를 수 있다).
- `received`(문자 수신 시각)는 `HH:MM` 또는 `HH:MM:SS`. 날짜는 DOMAIN_RULES R-6 "문자 수신 시각의 날짜"(D-023)로 정한다: 입력 시각(`at`)에 가장 가까운 날짜. 분 단위면 구간 `[HH:MM:00, +1분)`.
- `seq`는 `events`에서 `assert`를 뺀 순번(1부터)이다. 재수신 사본도 자기 `seq`를 받는다.
- 정산 묶음 날짜(`구매자@날짜`)는 찜 시각이 아니라 **방송의 `date`**다 (R-12).

## 이벤트 종류와 필드 (형식 계약)

모든 이벤트에 `at`(필수)과 `type`이 있다. 표에 없는 종류·필드는 읽기 오류다. `b`는 `broadcasts`에 선언되었거나 그 이벤트보다 앞선 `broadcast.start`로 선언된 방송이어야 한다(`broadcast.start` 자신의 `b`는 새 ID이거나, 이미 선언된 방송이면 사본).

| type | 필수 | 선택 |
|---|---|---|
| `broadcast.start` | `b`(빈 문자열이 아닌 방송 ID), `date`(`YYYY-MM-DD`), `title`(문자열 — 글 칸: 휴대폰 번호가 있으면 읽기 오류, 아래 "판매자가 적는 칸의 휴대폰 번호") | `settings`(설정 키 → 값. 아래 "설정 키"의 키·값·범위만, DOMAIN_RULES 기본값 위에 덮어쓴다. 없으면 기본값. `settlement.groupBy: MANUAL`은 엔진 미구현이라 쓰지 않는다) (S04, D-070) |
| `broadcast.end` | `b` | (S04, D-070) |
| `product.register` | `b`, `no`(1 이상), `name`(빈 문자열 가능 — 글 칸), `price`(0 이상 정수) | `stock`(1 이상, 기본 1), `status`(`OPEN` 기본 / `READY`) |
| `product.open` / `product.hold` / `product.close` | `b`, `no` | |
| `product.update` | `b`, `no` | `name`(글 칸), `price`, `stock`, `applyTo`(`NEW_ONLY` 기본 / `UNPAID_CLAIMS`) |
| `product.renumber` | `b`, `from`, `to` | |
| `chat` | `b`, `id`(메시지 ID), `ch`(채널 ID), `nick`, `text` | `owner`(불리언, 기본 false), `publishedAt` |
| `sms` | `b`, `ref`(영문·숫자·`_`·`-` 1~64자. 다시 적으면 재전송 사본, S03b. 글 칸), `no`, `received` | `memo`(글 칸), `phone`(판매자가 적은 글자 그대로 — 러너가 `phoneKey`·`phoneLast4`로 바꿔 넘긴다, S03b. 번호는 이 칸에만 적는다), `buyer`(지정 구매자 키 — ID 칸). `ref`·`memo`에 휴대폰 번호가 있거나 `buyer`가 휴대폰 번호면 읽기 오류다(아래 "판매자가 적는 칸의 휴대폰 번호", S04 마무리 D-079·D-080 — D-073의 "숫자만 모은 것이 번호 모양" 판단은 쓰지 않는다) |
| `host.cancel` / `host.reject` / `host.promote` | `b`, `no`, `buyer`, `reason` | |
| `host.confirm` / `host.approveCancel` / `host.dismissCancel` | `b`, `no`, `buyer` | `reason` |
| `host.assign` | `b`, `no`, `buyer`, `reason` | `replace`(구매자 키 — 교체할 지금 1등), `replaceTo`(`WAITLIST`/`CANCEL`). 둘은 함께 쓴다(하나만 있으면 읽기 오류. 엔진에서도 입력 오류, D-065) |
| `host.reopen` | `b`, `no`, `reason` | |
| `host.resolveConflict` | `b`, `no`, `decision`(`KEEP`/`SWITCH`) | `reason` |
| `host.convertMessage` | `b`, `msg`(메시지 ID), `no` | `reason` |
| `host.blockBuyer` / `host.unblockBuyer` | `buyer`, `reason` | |
| `buyer.merge` | `from`, `into`, `reason` | |
| `buyer.unmerge` | `from`, `reason` | |
| `effect.labelPrinted` | `b`, `no`, `buyer` | |
| `effect.thanksSent` | `b`, `no`, `buyer` | `target`(`LIVE_CHAT` 기본 / `VIDEO_COMMENT`) |
| `settlement.shippingOverride` | `buyer`, `date`, `mode`(`PICKUP`/`COMBINED`/`FIXED`/`DEFAULT`) | `amount`(0 이상. `FIXED`일 때 필수, 그 밖에는 쓰지 않는다). `DEFAULT` = 예외 지우기 (S03, D-058) |
| `settlement.adjust` | `buyer`, `date`, `amount`(정수, 음수 가능), `reason` | |
| `settlement.payment` | `buyer`, `date`, `amount`(1 이상) | `memo`(글 칸 — 휴대폰 번호가 있으면 읽기 오류) |
| `settlement.refund` | `buyer`, `date`, `amount`(1 이상), `reason` | |
| `assert` | `expect` | (`at` 없음, `seq` 없음) |

- **판매자가 적는 칸의 휴대폰 번호** (S04 마무리, D-079·D-080 = DOMAIN_RULES R-1 같은 이름의 항목): 골든은 서버가 기록 전 검사(`checkEvent`)를 통과시킨 로그만 적는다. 아래 칸에 휴대폰 번호가 있으면 **읽기 오류**다(엔진에서는 `checkEvent`의 입력 오류. `applyEvent`는 재생 때 이 검사를 하지 않는다 — R-1 "기록 전에만 검사한다"). 판단은 R-1과 같고, 글의 숫자를 전부 모아 번호 모양을 보는 판단은 쓰지 않는다.
  - **글 칸**: `sms`의 `ref`·`memo`, `settlement.payment`의 `memo`, 모든 사유(`reason` — `host.*`·`buyer.*`·`settlement.adjust`·`settlement.refund`), `broadcast.start`의 `title`, `product.register`·`product.update`의 `name`. 숫자 덩어리(이어 적은 숫자, 전각은 반각) 사이에 구분자(공백·문장 부호·기호·이모지·보이지 않는 글자, 한글 자모 `ㅡ`·`ㅣ`·`ㆍ`)만 있으면 이어진 배열이다. (가) 덩어리 하나가 `01X`(X는 `0`·`1`·`6`·`7`·`8`·`9`)로 시작하는 10~11자리 전체이거나, (나) `01X` 세 자리 덩어리 바로 뒤에 이어진 덩어리들을 붙여 정확히 7~8자리가 되는 곳이 있으면 번호다. 읽기 오류: `"010-1234-5678"`, `"김영희 010 1234 5678"`, `"01012345678"`, `"3시,010,1234,5678"`, `"010-1234-5678 2개"`, `"3시 010ㅡ1234ㅡ5678"`, `"０１０-１２３４-５６７８"`, `ref` `"s01012345678"`. 받는다: `"01/05 3개 25,000원"`, `"01/05 구피 30종 1000원"`, `"1234-5678"`(`010`을 뺀 8자리), `"3시 15번 2개"`, `"101동 1203호"`, `"r-20261018-0001"`, `"+82 10-1234-5678"`(국가 번호 표기) — G-ENG-166.
  - **ID 칸**: `buyer`(`host.*`·`sms`·`settlement.*` — 효과 보고 `effect.*`의 `buyer`는 빼고: 엔진에는 효과 ID로 넘긴다), `buyer.merge`의 `from`·`into`, `buyer.unmerge`의 `from`, `host.assign`의 `replace`, `host.convertMessage`의 `msg`. 값 전체가 숫자와 구분자(위와 같다)로만 되어 있고 코어 `normalizePhone`의 결과가 있으면 읽기 오류다(`"010-5151-6161"`, `"01051516162"`, `"010 5151 6163"`). 영문 같은 글자가 하나라도 섞인 키(`UC_A`, `sms:s1`, `"UC01012345678abcdEFGH_-"`)는 받는다 — G-ENG-166.
  - 시청자 쪽 값(`chat`의 `id`·`ch`·`nick`·`text`)과 `phone`은 이 검사를 하지 않는다.
- R-1의 나머지(포장·배송 상태)는 처음 쓰는 스프린트에서 spec-keeper가 이 표에 추가한다. `effect.failed`는 쓰지 않는다(게시 실패는 발송함 상태로만, D-Y01) — 골든에 적으면 읽기 오류다. (`host.assign`·`host.reopen`·`host.dismissCancel`은 S02에서, `broadcast.start`·`broadcast.end`는 S04에서 추가 — D-041~D-043, D-070)
- **이벤트 안의 구매자 키** (S03, D-057): `buyer.merge`의 `from`·`into`, `buyer.unmerge`의 `from`은 그 키의 구매자 자신(합치기 전)을 가리킨다. 그 밖의 이벤트(`host.*`의 `buyer`·`replace`, `sms`의 `buyer`, `settlement.*`의 `buyer`)도 그 키의 구매자 자신으로 엔진에 넘기고, 엔진이 지금의 구매자(합친 결과)로 풀어 판정·대상 찾기를 한다. `sms:<ref>`는 그 `ref`의 문자찜이 정한 구매자다(지정 구매자, 같은 전화번호로 이어진 구매자, 새 문자 구매자 — DOMAIN_RULES R-11). 키를 구매자 ID로 바꾸는 일은 코어 어댑터가 한다. 이벤트 전체가 아무 일도 없었던 문자찜(모르는 지정 구매자)의 `sms:<ref>`는 풀리지 않는다. 같은 `ref`의 재전송 사본이 있으면 `sms:<ref>`는 그 `ref`의 처음 문자찜으로 정한다(사본은 아무것도 바꾸지 않는다, D-067).
- 효과 보고(`effect.labelPrinted` / `effect.thanksSent`)는 그 (상품, 구매자[, 대상])의 가장 최근에 나온, 취소되지 않은 해당 효과의 실행 완료로 본다. 상품 키는 효과가 나온 때의 키, 구매자는 지금의 구매자로 풀어 비교한다(S03). 그런 효과가 없으면 러너 오류. 엔진에는 그 효과의 ID로 넘긴다(R-13 "효과 보고" — 바꾸는 일은 코어 어댑터가 한다). 이미 실행 완료된 효과도 "취소되지 않은" 효과이므로 같은 보고를 두 번 적을 수 있다(두 번째는 아무 일도 없어야 한다, INV-11).

## 설정 키 (형식 계약)

`settings`(시나리오의 `settings`와 `broadcast.start`의 `settings`)의 키는 DOMAIN_RULES 설정표의 키만 쓴다. 값도 표의 선택지와 "설정값 범위"(DOMAIN_RULES 설정표 아래, S04, D-071) 안의 값만 쓴다. 밖이면 읽기 오류다.
`claim.parseMode`, `claim.multiNumber`, `claim.maxNumber`, `claim.ignoreOwner`, `claim.preOpenWindowSec`, `waitlist.max`, `cancel.buyerChat`, `cancel.succession`, `contention.policy`, `contention.sameMinuteTieBreaker`, `price.unit`, `shipping.baseFee`, `shipping.freeThreshold`(정수 또는 `null`), `settlement.groupBy`, `print.autoOnConfirm`, `thanks.liveChat`, `thanks.videoComment`, `thanks.batchWindowSec`.

## `expect` 비교 규칙 (형식 계약)

| 키 | 비교 방식 |
|---|---|
| `products.<방송>/<번호>` | 지금 그 번호를 가진 상품(번호 변경 뒤엔 새 번호로 찾는다). 적은 필드만 비교 |
| └ `status` | `READY`·`OPEN`·`SOLD`·`HOLD`·`CLOSED` |
| └ `winner` | 확정 구매자 1명. `null` = 확정 없음. 확정이 2명 이상이면 불일치 |
| └ `winners` | 확정 구매자 집합. 순서 무관, 정확히 같음 |
| └ `waitlist` | 대기 구매자, **1순위부터 순서대로** 정확히 같음 |
| └ `conflict` | 충돌 표시 여부 |
| └ `exists` | 그 번호의 상품 기록이 있는지(`CLOSED`도 있는 것으로 본다) |
| └ `price` / `priceHistory` | 현재 가격 / 가격 변경 이력 `[{ from, to }]` 시간순, 정확히 같음 |
| `buyers.<키>` | 키를 지금의 구매자로 풀어서(합치기·전화번호 연결 반영) 비교 |
| └ `items` | 확정 찜의 상품 키 집합. 순서 무관, 정확히 같음 |
| └ `subtotal` | 확정 찜 가격 스냅샷의 합 |
| └ `byBroadcast` | 방송별 합계. 확정 찜이 있는 방송 전부와 정확히 같음 |
| └ `display` / `nameHistory` | 표시 이름 / 닉네임이 바뀔 때마다 쌓인 목록(처음 것 포함, 시간순, 연속 중복 없음) |
| └ `phoneLast4` | 지금의 구매자 자신의 전화번호 뒤 4자리(숫자 4자리 문자열). 그 구매자를 만든 문자찜의 `phoneLast4`이고, 유튜브 구매자와 전화번호 없이 만든 문자 구매자는 `null` (S03b, D-061) |
| `settlements.<키>@<날짜>` | (구매자, 날짜) 정산 묶음. 키는 지금의 구매자로 푼다. 품목도 입금·환불 기록도 없는 묶음은 금액 전부 0, `payment: UNPAID`. 품목이 없어도 받은 금액이 있으면 엔진이 그 묶음을 보여 준다(최종 0, 과입금 — DOMAIN_RULES R-12, D-058) |
| └ `subtotal`·`shipping`·`adjustments`·`total`·`refundDue` | 정수 원. `refundDue`는 `OVERPAID`일 때 차액, 아니면 0 |
| └ `payment` | `UNPAID`·`PARTIAL`·`PAID`·`OVERPAID` |
| `effects` | 적은 항목마다, 지금까지 나온 효과(실행·취소 여부 무관) 중 적은 필드가 모두 같은 것이 **서로 다른 효과로 하나씩** 있어야 함. 순서 무관. 효과의 상품 키·문구는 효과가 나온 때의 것이다(번호를 바꿔도 그대로, `VOID_LABEL`은 폐기할 라벨과 같은 상품 키). 효과의 구매자는 지금의 구매자로 푼다 |
| `effectCounts` | 종류별로 지금까지 나온 효과 수가 정확히 같음(0이면 하나도 없어야 함) |
| `pendingEffects` | 아직 실행 대상인 효과(나왔고, 취소·SKIPPED가 아니고, 실행 완료 보고가 없는 것) **전체**와 적은 필드 기준으로 정확히 같은 목록. 순서 무관. `VOID_LABEL`은 엔진에 완료 보고 이벤트가 없어 나온 뒤 계속 실행 대상이다 — 폐기 표시의 실행 기록은 서버 출력 대기열이 가진다(I1, D-I1-02). 엔진은 `NOTIFY`·`PRINT_PACKING_LABEL`을 내지 않는다(D-044, D-I1-02) |
| `claims` | 적은 항목마다 (상품 키, 구매자)의 **가장 최근** 찜의 `status`와 (적었으면) `reason`. 상품 키는 상품이 아직 없어도 된다(보류 찜). 찜의 상품 키는 지금의 상품 키다(번호를 바꾸면 그 상품의 찜은 새 번호로, 원래 번호에 남은 보류 찜은 원래 번호로 — D-056). 구매자는 지금의 구매자로 풀어 비교하므로, 합친 구매자의 찜은 합친 쪽의 키로도 찾힌다(가장 최근 = 가장 나중에 생긴 찜) |
| `pending` | 번호별 보류 찜의 구매자, 판정 순위(R-6) 순서대로 정확히 같음. `[]` = 없음 |
| `sameBuyer` | 묶음마다 모든 키가 같은 구매자로 풀림 |
| `claimCount` | 생성된 찜 수(상태 무관). 재수신 메시지와 R-4 4번 줄(같은 사람 반복)은 찜을 만들지 않는다 |
| `cancelRequests` | 처리 대기 중인 시청자 취소 요청 전체와 정확히 같음. 순서 무관 |
| `broadcasts.<b>` | 선언된 방송(`broadcasts` 목록 또는 `broadcast.start`)만 적을 수 있다. 적은 필드만 비교: `date`(`YYYY-MM-DD`)·`title`(문자열) = 처음 선언한 값(사본은 바꾸지 않는다), `ended`(불리언) = `broadcast.end`를 받았는지 |
| `mergePreviews` | (S06b, D-100) 항목마다 코어 `previewMerge`를 그 시점 상태(중간 검사면 그 자리, 마지막 `expect`면 모든 이벤트 뒤)로 부르고 적은 필드만 비교한다. 미리 보기는 상태를 바꾸지 않는다(부른 뒤에도 같은 상태 — 러너가 확인한다). 항목에 이 표에 없는 키가 있으면 읽기 오류 |
| └ `from` / `into` | 필수. 구매자 키 — `buyer.merge`의 `from`·`into`처럼 **그 키의 구매자 자신**으로 풀어 넘긴다(ID 칸 — 휴대폰 번호면 읽기 오류). 유튜브 채널 ID는 그대로 넘기므로 이벤트에 나온 적 없는 채널(`UC_Z`)은 엔진이 모르는 구매자다. 구매자를 정하지 않은 `sms:<ref>`(모르는 지정 구매자·없는 ref)는 키 그대로 넘긴다(엔진이 모르는 구매자) |
| └ `blocked` | `null`(합칠 수 있음) 또는 막힘 이유 하나: `UNKNOWN_BUYER`(둘 중 하나를 엔진이 모름) → `SAME_BUYER`(같은 구매자) → `FROM_MERGED`(옮길 구매자가 이미 다른 구매자에 합쳐져 있음) → `CYCLE`(남는 쪽의 지금의 구매자가 옮길 구매자) → `BOTH_CONFIRMED`(확정 찜이 둘이 되는 상품이 있음). 위에서부터 처음 맞는 것 |
| └ `bothConfirmed` | 옮길 쪽과 남는 쪽(남는 쪽의 지금의 구매자와 그 아래 전부)이 모두 확정 찜을 가진 상품 키 집합. 순서 무관, 정확히 같음. `blocked`가 `BOTH_CONFIRMED`가 아니면 `[]` |
| └ `moving` | `{ items, subtotal }` — 옮길 구매자와 그 아래 합쳐 있던 구매자 전부의 확정 찜 상품 키 집합(순서 무관, 정확히 같음)과 가격 스냅샷 합(= 그 구매자의 `buyers.<b>.items`·`subtotal`). 엔진이 모르는 구매자면 `{ items: [], subtotal: 0 }` |
| └ `after` | 막히면 `null`. 아니면 `{ items, subtotal }` — 합친 뒤의 지금의 구매자(남는 쪽의 지금의 구매자)의 확정 찜 상품 키 집합과 합. `buyer.merge`를 실제로 적용한 뒤의 그 구매자 조회와 같아야 한다 |
| └ `duplicates` | 막히면 `[]`. 아니면 합치면 `DUPLICATE`가 될 찜 **전체** `[{ product, buyer, status }]`, 순서 무관, 정확히 같음. `product` = 지금의 상품 키, `buyer` = 그 찜의 **구매자 자신**(키를 구매자 자신으로 풀어 비교 — 지금의 구매자로 풀지 않는다), `status` = 지금 상태(`CONFLICT`·`WAITLISTED`·`PENDING` — 남는 찜은 R-11 "앞선 쪽": 확정 > 충돌 > 대기 앞 순번 > 보류 판정 순위). `buyer.merge`를 실제로 적용하면 바로 이 찜들이 `DUPLICATE`가 된다 |

**열거값**: 찜 상태 `PENDING`·`CONFIRMED`·`WAITLISTED`·`REJECTED`·`CANCELLED`·`CONFLICT`·`DUPLICATE` / 거절 사유 `BLOCKED`·`UNOPENED`·`NOT_ON_SALE`·`SOLD_OUT`·`EXPIRED`·`WAITLIST_CLEARED`·`BY_HOST`·`RENUMBERED` / 효과 `PRINT_PRODUCT_LABEL`·`PRINT_PACKING_LABEL`·`POST_THANKS`·`VOID_LABEL`·`NOTIFY` / 대상 `LIVE_CHAT`·`VIDEO_COMMENT`.

**구매자 키**: `sms:`로 시작하지 않으면 채팅 채널 키 — 유튜브 채널 ID 또는 플랫폼 접두어가 붙은 키(인스타그램 `ig:<IGSID>`, N2, D-N2-02 · 틱톡 `tt:<숫자 사용자 ID>`, N2b-2, D-N2b-2-03. 러너는 유튜브 채널 ID와 똑같이 그대로 넘긴다), `sms:<ref>`는 그 `ref`의 (처음) 문자찜이 만든(또는 `buyer`로 지정한, 같은 전화번호로 이은) 구매자. 상품 키 `<방송>/<번호>`의 방송은 선언된 방송이어야 한다.

## 라벨 골든 (`label/*.json`, P1 — D-P1-01)

라벨 패키지가 찍는 **글**(항목마다의 값, 포장 라벨의 쪽 나누기)과 **라벨 크기**를 고정한다. 규칙 문장은 `docs/spec/LABEL_RULES.md`다. 글꼴로 그린 점 배치는 기기·글꼴 판에 따라 흔들리므로 골든으로 고정하지 않고 수용 기준의 배치 검사로 본다(L-5 배치 결과).

- **누가 읽나**: 코어 골든 러너(`pnpm golden`)는 `*.yaml`만 읽어 이 폴더를 건너뛴다. `packages/label`의 단위 테스트가 이 폴더의 모든 `*.json`을 읽어 라벨 패키지의 순수 함수(글 계산 — L-0 2)로 돌리고 `out`과 비교한다(`pnpm test` 단계). 그 테스트는 파일 수와 사례 수 합계를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
- **파일** = JSON 객체 `{ "kind", "about", "cases" }`. `kind` ∈ `product`·`packing`·`size`. 모르는 키·모르는 `kind`는 테스트 실패(읽기 오류)다. 보이지 않는 글자는 `\uXXXX`로 적는다.
- **사례 공통 키**: `id`(`G-LBL-` + 세 자리, 또는 병렬 스프린트가 더한 `G-LBL-<스프린트>-` + 두 자리 — 예 `G-LBL-N1-01`. 이 폴더 전체에서 유일), `title`, `refs`(1개 이상), 선택 `note`(손 계산 메모 — 비교하지 않는다), `out`.
- `out`이 `{ "error": <코드> }`면 그 사례는 그 오류여야 하고 라벨(글·그림)을 만들지 않아야 한다. 코드: `INVALID_DATA`(라벨 데이터 형식 위반 — L-3·L-4 표 밖의 칸 포함), `INVALID_TEMPLATE`(템플릿 검사 위반 — L-5).

| `kind` | 사례 키 | `out` (오류가 아닐 때) |
|---|---|---|
| `product` | `data`(L-3 라벨 데이터 그대로), 선택 `template` = 기본 템플릿(50×30 상품)에 덮어쓸 값: `size`(L-1 크기 ID — N1), `shopName`(문자열), `priceStyle`(`THOUSAND`/`WON`), `visible`(항목 ID → 불리언) | `{ "items": { 항목 ID: 값 } }` — 찍는 항목만, 정확히 같은 키 집합. 값은 L-3 "값" 열의 글(캡션·머리글 꾸밈 `-…-` 빼고, 다듬은 뒤, 그리기 전 — 글꼴에 없는 글자도 그대로) |
| `packing` | `data`(L-4 라벨 데이터 그대로), 선택 `template` = 기본 템플릿(50×30 포장)에 덮어쓸 값: `size`(L-1 크기 ID — N1), `shopName`, `perPage`(정수), `visible` | `{ "common": { 항목 ID: 값 }, "pages": [ { "page": "k/n", "broadcast"?: 제목, "numbers": [정수…] } ] }` — `common`은 `shop`·`date`·`buyer`·`count`·`subtotal` 중 찍는 것만(정확히 같은 키 집합), `pages`는 쪽 순서대로 정확히 같다. `broadcast`는 방송이 둘 이상일 때만 있다 |
| `size` | `size`(L-1 크기 ID — `"<폭>x<높이>"` mm 또는 테이프 `"tape<테이프 폭>x<길이>"` — N1) | `{ "width", "height", "a4PerPage", "default" }` — 그 크기의 기본 템플릿(상품)으로 만든 그림의 점 수, A4 모아찍기 한 장의 라벨 수(L-6), 기본 크기인지. 목록 밖 크기는 `INVALID_TEMPLATE` |

- 기본 템플릿의 값: 크기 50×30, `shopName` 빈 글, `priceStyle` `THOUSAND`, 포장 `perPage` 10, 모든 항목 켬. `visible`에 없는 항목은 기본(켬) 그대로다.
- **`size` 덮어쓰기 (N1, D-N1-03)**: `template.size`가 있으면 그 크기의 기본 템플릿(상품 또는 포장)에서 시작해 나머지 값(`shopName`·`priceStyle`·`perPage`·`visible`)을 덮어쓴다. 작은 크기(50×15·테이프 세 가지)의 기본 상품 템플릿은 `shop`·`date`·`name`이 꺼져 있다(L-5). 포장 템플릿이 없는 크기(작은 크기)를 포장 사례의 `size`로 주면, 50×30 기본 포장 템플릿의 `size`만 그 크기로 바꾼 템플릿을 검사해 `INVALID_TEMPLATE`이어야 한다(테스트가 지어내는 템플릿이 하나로 정해지게).
- 파일(N1 뒤): `product.json`(상품 50) · `product-sized.json`(크기를 고른 상품 18 — N1) · `packing.json`(포장 29 + N1 5) · `sizes.json`(크기 4 + N1 8) — 파일 4 · 사례 114. 테스트는 이 수를 고정값으로 단언한다.
- 항목 ID: 상품 `shop`·`number`·`price`·`date`·`name`·`buyer`, 포장 `shop`·`date`·`buyer`·`page`·`broadcast`·`count`·`subtotal`·`numbers` (L-3·L-4 표).

## 프린터 골든 (`printer/*.json`, N1 — D-N1-01·09)

프린터 패키지가 프린터로 보내는 **바이트**, 블루투스 기기 **이름으로 프로필 고르기**, **프로필 표**, **바로 연결할 수 없는 브라우저의 까닭**을 고정한다. 규칙 문장은 `docs/spec/LABEL_RULES.md` L-7·L-12다.

- **누가 읽나**: 코어 골든 러너는 읽지 않는다(`*.yaml`만). `packages/printer` 단위 테스트가 이 폴더의 모든 `*.json`을 읽어 프린터 패키지의 순수 함수(작업 바이트 만들기·이름으로 고르기·프로필 목록·까닭 판단)로 돌리고 `out`과 비교한다(`pnpm test` 단계). 파일 수·사례 수 합계를 고정값으로 단언한다 — 지금 파일 4(`browser.json` 15 · `job.json` 34 · `name.json` 27 · `profile.json` 11) · 사례 87(N1 감사 뒤 `name` 3사례 G-PRT-N1-76~78을 더함 — D-N1-11, 기존 사례는 그대로).
- **파일** = JSON 객체 `{ "kind", "about", "cases" }`. `kind` ∈ `job`·`name`·`profile`·`browser`. 모르는 키·모르는 `kind`·겹친 `id`는 테스트 실패(읽기 오류)다.
- **사례 공통 키**: `id`(`G-PRT-N1-` + 두 자리, 이 폴더 전체에서 유일 — 다음 스프린트는 `G-PRT-<스프린트>-`), `title`, `refs`(1개 이상), 선택 `note`(손 계산 메모 — 비교하지 않는다), `out`.

| `kind` | 사례 키 | `out` |
|---|---|---|
| `job` | `profile`(프로필 ID), `image`(아래 그림), 선택 `options` = `{ "density": 수 }` | 성공 `{ "bytes": [조각…] }` — 만든 바이트가 조각을 차례로 이어 붙인 것과 **처음부터 끝까지** 같아야 한다(앞뒤에 남는 바이트 없음). 실패 `{ "error": 코드 }` — 코드 ∈ `IMAGE_TOO_WIDE`·`INVALID_DENSITY`·`PRINT_FAILED`, 바이트를 만들지 않는다 |
| `name` | `name`(기기 이름 글 — 그대로 넘긴다. 앞뒤 공백도 지우지 않는다) | `{ "profile": 프로필 ID 또는 null }` — 목록은 Marklife 9종 + 바우아토(실험적) 전부 |
| `profile` | `profile`(프로필 ID) | 그 프로필의 칸 `maker`·`displayName`·`protocol`·`dpi`·`headDots`·`rotate`·`sizes`·`defaultSize`·`density`(`{ min, max, default }` 또는 null)·`experimental`·`fallbackApp`·`namePrefix`(글 또는 null)와 깊은 같음(이 열두 칸이 모두 있어야 한다) |
| `browser` | `ua`(사용자 에이전트 글), 선택 `maxTouchPoints`(정수, 없으면 0) | `{ "reason": 까닭 }` — 까닭 ∈ `IOS`·`IN_APP`·`OTHER` |

**그림** (`image`): `{ "width", "height", "rows" }` — `rows`는 줄마다 16진 글 하나(공백 허용), 한 줄 = `ceil(width/8)`바이트(L-1 형식: 왼쪽 점이 높은 비트, 1 = 검정). 폭 밖의 남는 비트는 아무 값이어도 점이 아니다 — 보내는 줄의 남는 비트는 늘 0이다(L-12 2). 또는 `{ "width", "height", "fill" }` — `width`는 8의 배수, `fill` ∈ `white`(모두 흰색)·`black`(모두 검정)·`border`(맨 위·맨 아래 줄과 맨 왼쪽·맨 오른쪽 열만 검정).

**조각** (`out.bytes`의 원소):
- 16진 글(공백 허용) — 그 바이트 그대로.
- `{ "yxqRaster": { "widthBytes", "height", "rows" | "fill" } }` — `1F 10` + `widthBytes`(BE16) + `height`(BE16) + 압축 길이 L(BE32) + 압축 바이트 L개. 압축 바이트는 ① 첫 바이트(CMF)가 `28`(deflate, 창 1KiB), ② (CMF×256 + FLG)가 31의 배수이고 사전 비트(FDICT)가 0, ③ 창 1KiB(windowBits 10)로 풀면 오류 없이 `rows`(또는 `fill`을 `widthBytes×8`×`height` 그림으로 만든 줄)를 이어 붙인 바이트와 정확히 같고, ④ 풀기가 L바이트에서 정확히 끝난다(Adler-32 포함). 압축 바이트 자체는 비교하지 않는다(D-N1-09 — 압축기마다 다르다. 같은 그림이면 같은 바이트인지는 AC-N1-20).
- `{ "rawRaster": { "widthBytes", "height", "rows" | "fill" } }` — `1D 76 30 00` + `widthBytes`(LE16) + `height`(LE16) + 줄 바이트 그대로(`widthBytes × height`바이트, 길이 칸 없음).

- 프로필 ID: `NIIMBOT_B1`, `MARKLIFE_P50`·`MARKLIFE_S2`·`MARKLIFE_X2`(YXQ), `MARKLIFE_P11`·`MARKLIFE_P12`·`MARKLIFE_P15`·`MARKLIFE_L13`·`MARKLIFE_LP90`·`MARKLIFE_LP15`(L11), `BAUATO_PPA2L`(실험적). `job` 사례에 `NIIMBOT_B1`은 쓰지 않는다(B1 바이트는 niimbluelib이 만든다 — L-7).
- 열거값: `protocol` ∈ `NIIMBOT_B1`·`MARKLIFE_YXQ2`·`MARKLIFE_YXQ3`·`MARKLIFE_YXQ8`·`MARKLIFE_L11`, `rotate` ∈ `NONE`·`CW90`.

## 틱톡 골든 (`tiktok/*.json`, N2b-1 — D-N2b-1-02~04·D-N2b-1-07)

틱톡 연결 모듈(`apps/server/src/tiktok/**`)의 두 해석기를 고정한다: 판매자가 넣은 **틱톡 아이디·방송 주소 한 줄 → 연결할 아이디**, **웹캐스트 댓글 → 공통 댓글 레코드(또는 버림)**. N2b-2가 둘을 더한다: **공통 댓글 레코드 → 서버가 기록하는 `chat`의 다섯 칸**(`chat.json`), **댓글 붙여넣기 한 번 → 줄마다 닉네임·댓글 또는 오류**(`paste.json`). 연결·다시 연결·상태 문장은 시계에 기대므로 골든이 아니라 수용 기준(`harness/sprints/N2b-1/acceptance.md`)의 통합 시험으로 본다.

- **누가 읽나**: 코어 골든 러너(`pnpm golden`)는 `*.yaml`만 읽어 이 폴더를 건너뛴다. `apps/server`의 시험이 이 폴더의 모든 `*.json`을 읽어 틱톡 모듈의 순수 함수로 돌리고 `out`과 깊은 같음으로 비교한다(`pnpm test` 단계). 그 시험은 파일 수와 사례 수 합계를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
- **파일** = JSON 객체 `{ "kind", "about", "cases" }`. `kind` ∈ `target`·`comment`·`chat`·`paste`(뒤 둘은 N2b-2 — 서버 시험이 알기 전까지는 읽기 오류로 실패한다). 모르는 키·모르는 `kind`는 시험 실패(읽기 오류)다. 보이지 않는 글자는 `\uXXXX`로 적는다.
- **사례 공통 키**: `id`(`G-TTK-` + 스프린트 + `-` + 두 자리 이상 숫자, 예 `G-TTK-N2b-1-01`, 이 폴더 전체에서 유일), `title`, `refs`(1개 이상), 선택 `note`(손 계산 메모 — 비교하지 않는다), `out`.

| `kind` | 사례 키 | `out` |
|---|---|---|
| `target` | `in`(문자열 — 판매자가 넣은 한 줄 그대로) | 성공 `{ "uniqueId": 아이디 }`, 실패 `{ "error": 코드 }` — 정확히 한 키. 코드: `EMPTY`(비었음)·`INVALID`(아이디·틱톡 주소가 아님)·`SHORT_LINK`(짧은 공유 주소 — 열어 보지 않는다). 해석 규칙은 D-N2b-1-02와 파일의 `about` |
| `comment` | `target`(연결한 아이디 — `target` 해석이 돌려준 모양), `events`(1개 이상: `{ "receivedAt", "raw" }`) | `events`와 같은 길이의 목록. 항목마다 `{ "record": 레코드 }` 또는 `{ "drop": 코드 }` |
| `chat` | `in`(공통 댓글 레코드 — 정확히 일곱 키, `comment` 사례의 `record`와 같은 모양) | `{ "id", "ch", "nick", "text", "owner" }` — 정확히 다섯 키. `id` = `tt:` + `commentId`, `ch` = `tt:` + `userId`, `nick` = 수집 경로 이름 정리(D-Y05), `text`·`owner` 그대로(D-N2b-2-03). 서버가 붙이는 `b`·`type`·`at`은 비교하지 않고, `publishedAt`은 없어야 한다 |
| `paste` | `in`(문자열 — 판매자가 붙여 넣은 글 그대로) | 성공 `{ "rows": [...] }` — 빈 줄이 아닌 줄마다 `{ "line", "nickname", "text" }` 또는 `{ "line", "error" }`(`line` = 원래 줄 번호, 1부터. 오류: `NO_NICKNAME`·`PHONE_NUMBER`·`NO_TEXT`·`TEXT_TOO_LONG`), 전체 거절 `{ "error": "TOO_LONG" \| "TOO_MANY_LINES" }`. 규칙은 D-N2b-2-07과 파일의 `about`. 댓글의 번호 해석·구매자 묶기는 이 골든 밖이다(파서 골든·G-ENG-N2b-2-02) |

- `comment` 사례는 사례마다 `target`으로 **새 거르개**(중복 기억이 빈 것)를 만들고 `events`를 순서대로 넣는다. `receivedAt`은 오프셋 `Z`가 붙은 ISO 8601(밀리초까지) — 시험이 `new Date(receivedAt)`로 바꿔 넘긴다. `raw`는 라이브러리 `chat` 이벤트에서 꺼낸 값을 흉내 낸 객체로, 키는 `msgId`·`userId`·`uniqueId`·`nickname`·`comment`·`createTime`만 쓸 수 있다(모두 선택, 값은 아무 JSON 값 — 틀린 형식이 버림 사례다). 키가 없는 것과 `null`은 둘 다 "값 없음"이다.
- 레코드 = 정확히 일곱 키 `{ "platform": "TIKTOK", "commentId", "userId", "nickname", "text", "receivedAt", "owner" }`. `commentId`·`userId`는 0으로 시작하지 않는 양의 10진 문자열(1~32자리), `receivedAt`은 `toISOString()` 모양(UTC, 밀리초), `owner`는 불리언.
- 버림 코드(이 순서로 검사, 처음 걸린 것): `BAD_COMMENT_ID`·`BAD_USER_ID`·`NO_TEXT`·`TEXT_TOO_LONG`·`DUPLICATE`. 버린 댓글의 ID는 중복 기억에 넣지 않는다.
- JSON 숫자는 읽는 순간 double이 된다 — 2^53을 넘는 숫자 ID가 안전 정수가 아니어서 버려지는 것도 골든이 고정한다(G-TTK-N2b-1-44). `bigint`와 라이브러리의 64비트 정수 객체는 JSON으로 적을 수 없어 서버 단위 시험(AC-N2b-1-21)이 본다. 2,000자를 넘는 `target` 입력도 단위 시험이 본다.
