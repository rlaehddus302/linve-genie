# 골든 시나리오 (실행 가능한 스펙)

이 폴더는 **보호 경로**다. spec-keeper만 수정한다. developer·qa-breaker가 이 폴더의 파일을 바꾸면 하네스 게이트가 실패한다.
골든은 DOMAIN_RULES.md의 규칙을 예시로 고정한 것이다. 구현이 골든과 다르면 구현이 틀린 것이다.
골든이 스펙과 다르면 spec-keeper가 DECISIONS.md 근거와 함께 고친다.

## 파일

| 경로 | 내용 |
|---|---|
| `parser/chat.yaml` | 채팅 메시지 → 주문/취소/언급 (R-3) |
| `parser/amount.yaml` | 한글·숫자 금액 → 원 (빠른 입력·음성 공용) |
| `parser/quick-input.yaml` | 빠른 입력 한 줄 → 번호·품종·가격 |
| `engine/*.yaml` | 이벤트 순서 → 판정·합계·효과 (R-4~R-13) |

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

**추가 검사 키** (`expect` 안, 필요할 때만)

| 키 | 뜻 |
|---|---|
| `products.<p>.winners` | 재고 2 이상일 때 확정 구매자 목록(순서 무관) |
| `products.<p>.exists: false` | 그 번호의 상품이 없어야 함 |
| `products.<p>.price` / `priceHistory` | 현재 가격 / `[{from, to}]` 이력 |
| `buyers.<b>.byBroadcast` | 방송별 상품 합계 `{ b1: 20000, ... }` |
| `buyers.<b>.display` / `nameHistory` | 표시 이름 / 닉네임 이력 |
| `sameBuyer` | 같은 구매자로 이어져야 하는 키 묶음 `[[sms:s1, sms:s2]]` |
| `claimCount` | 생성된 찜 수 (재수신·같은 사람 반복은 찜을 만들지 않음) |
| `effectCounts` | 효과 종류별 정확한 개수 `{ POST_THANKS: 2 }` |
| `cancelRequests` | 대기 중인 시청자 취소 요청 `[{ product, buyer }]` |
| `settlements.<k>.adjustments` / `refundDue` | 조정 합계 / 환불 필요 금액 |
| `pendingEffects` | 아직 실행 대상(취소·SKIPPED 아님)인 효과의 정확한 목록. `confirmVersion` = 그 상품의 몇 번째 확정인지(1부터) |

**중간 검사**: 이벤트 목록 안에 `{ type: assert, expect: {...} }`를 넣으면 그 시점의 상태를 검사한다.

**규칙**
- `at`은 `HH:MM:SS[.mmm]` (KST, 방송 날짜 기준). 채팅의 `publishedAt`은 따로 적지 않으면 `at`과 같다.
- 문자찜: `{ type: sms, b, ref: s1, no: 15, received: "20:01" | "20:01:05", memo?, phone? }` → 구매자 키 `sms:s1`.
- 방송자 조치: `{ type: host.cancel, b, no, buyer, reason }` 같은 식. 이름은 DOMAIN_RULES R-1과 같다.
- 효과 실행 결과: `{ type: effect.labelPrinted, b, no, buyer }` / `{ type: effect.thanksSent, ... }`.
- `expect`에 적은 것만 검사한다. 적지 않은 상품·구매자는 검사하지 않는다(단, 불변식은 항상 검사).
- 러너는 시나리오마다 불변식 INV-1~12를 자동으로 함께 검사한다.
