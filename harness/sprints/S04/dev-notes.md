# S04 개발 노트

## dev-core

### 만든 것 (`packages/core/src/**`)
- **방송 시작·종료 (AC-S04-01·04, D-070)**
  - `broadcast.start { b, date, title, settings? }`: 새 방송을 선언 순서 끝에 더한다. 스냅샷 = `resolveSettings(settings)` — DOMAIN_RULES 기본값 위에 덮어쓴 값이고 엔진 시작 설정과 상관없다.
  - 이미 선언한 방송(시작 목록이나 앞선 `broadcast.start`)이면 날짜·제목·설정이 달라도 **같은 상태 객체**를 돌려준다. 형식 검사는 그 전에 하므로 사본이어도 형식이 틀리면 입력 오류다.
  - `broadcast.end { b }`: 끝난 시각(`at`)만 남긴다. 이미 끝났으면 같은 상태 객체. 판정·정산·효과는 바뀌지 않는다.
  - 조회: `listBroadcasts(state)`(선언 순서), `getBroadcast(state, id)`. 둘 다 `{ id, date, title, ended, endedAt, settings }`를 돌려주고, 선언하지 않은 방송이면 `getBroadcast`가 `null`이다.
- **판정은 그 방송의 설정 (AC-S04-02)**
  - 엔진 안에서 설정을 읽는 곳은 모두 `d.settingsOf(방송)`으로 바꿨다: 주문 인식·방송자 무시·공개 전 찜·대기 한도·시청자 취소·승계·경합·확정 효과.
  - 한 번호(slot)의 찜은 모두 그 번호의 방송에 속하므로, 판정 순위 비교는 그 번호 방송의 경합 정책으로 한다.
- **정산 설정은 그날 첫 방송 (AC-S04-03)**: 그 날짜의 방송 중 선언 순서가 처음인 방송의 스냅샷을 쓴다. 그 날짜에 방송이 없으면 품목이 있을 수 없어 기본값을 쓴다(배송비 0).
- **설정값 검사 (AC-S04-05, D-071)**
  - `checkSettings(override)` → `SettingsProblem[]`(`{ key: string | null, message }`). 문구는 판매자에게 보여 줄 수 있는 쉬운 말이다(예: "0부터 100까지의 정수로 적어 주세요").
  - `broadcast.start`의 설정 검사는 이 함수 결과를 필드 `settings.<키>`로 옮긴다.
  - `initEngine`의 시작 설정이 범위 밖이면 TypeError, MANUAL이면 NotImplementedError다. `resolveSettings`는 그대로 검사하지 않는다.
- **입력 검사 (AC-S04-06·07, D-073)**
  - 모든 종류에서 `type`·`seq`·`at`과 그 종류의 필드 밖의 자기 속성은 입력 오류다. 값과 상관없이 보고, `undefined`·열거되지 않는 속성·기호 키·JSON의 `__proto__` 자기 속성도 잡는다(`Reflect.ownKeys`).
  - `sms`의 `ref`·`memo`에 `normalizePhone` 결과가 있으면 입력 오류다(필드 이름과 함께).
- **상태 형식 4 (AC-S04-08, D-072)**
  - `STATE_FORMAT` = 4를 내보낸다. `applyEvent`·`checkEvent`는 형식이 다른 상태(이전 번호, 형식 없음, 객체 아님)를 받으면 맨 먼저 `StateFormatError`(`received`·`supported`)를 던진다.
  - 판별은 `isStateFormatError`로 한다. 이전 형식을 읽는 길은 만들지 않았다.
- **취소 메시지 변환 금지 (AC-S04-10, D-076)**: 메시지 기록에 `cancel`(받을 때 R-3이 취소 번호를 읽었는지)을 더했다. `order || cancel`이면 어느 번호로도 아무 일도 없다.
- **대기 한도 0의 ASK = AUTO (AC-S04-11, D-077)**: 승계에서 `ASK && waitlist.max > 0`일 때만 "승계 결정 필요"를 건다. 대기 한도 0이면 풀린 충돌 찜이 확정된다.

### 상태 형식 4 (형식 3에서 바뀐 것)
| 항목 | 형식 3 | 형식 4 |
|---|---|---|
| `format` | `3` | `4` |
| 시작 설정 | `state.settings` 하나 | 없앴다. 방송 기록마다 `settings`(모든 키) |
| `broadcasts` | `{ id, date, title }` | `{ id, date, title, settings, endedAt }` (`endedAt`은 끝나지 않았으면 `null`) |
| 메시지 | `order`, `converted` | `order`, `cancel`, `converted` |

### 골든 러너 (`packages/core/test/golden/**`, AC-S04-91)
- **계약 (`contract.ts`·`validate.ts`)**
  - `broadcast.start`(`b`·`date`·`title`, 선택 `settings`)와 `broadcast.end`(`b`)를 더했다.
  - `b`는 선언한 뒤에만 쓸 수 있다. 이벤트도 중간 검사도 그 시점까지 선언된 방송만 본다. 이미 선언한 방송의 `broadcast.start`는 사본이다. `broadcast.start`의 짧은 `at`은 그 이벤트의 `date` 기준이다.
  - `broadcasts: []`를 허용한다. 방송 없는 이벤트의 짧은 at 판단은 `broadcast.start`(사본 포함)의 날짜도 센다.
  - 엔진 시작 목록에는 `broadcasts` 목록의 방송만 넘긴다. 그래서 시나리오 `settings`는 그 방송들에만 적용된다.
  - 설정값 범위 밖은 읽기 오류다(시나리오·`broadcast.start`·파서 suite 공통). 범위는 코어를 따르지 않고 README대로 따로 적었다.
  - 관찰 키 `broadcasts.<b>`(`date`·`title`·`ended`)를 더했다. 모르는 하위 키나 선언하지 않은 방송은 읽기 오류다.
  - `sms`의 `ref`·`memo`가 휴대폰 번호 모양이면 읽기 오류다.
  - `broadcast.start`의 `b`는 `broadcasts` 목록과 같은 방송 ID 형식(공백·`/`·`@` 없음)이어야 한다. 상품 키 `<방송>/<번호>`에 쓰기 때문이다.
- **어댑터·비교·형식 검사**
  - `broadcast.*`는 그대로 넘긴다.
  - 관찰 스냅샷에 `broadcasts`(조회 함수의 날짜·제목·끝남)를 넣었고, 스냅샷 형식 검사에 `broadcasts`를 필수 키로 더했다.
  - `compare.ts`에 `broadcasts.<b>` 비교를 더했다(강화). 기존 비교는 바꾸지 않았다.
- **읽기 오류 픽스처**
  - `17-broadcast.yaml`: 선언 전 방송(이벤트·중간 검사), `broadcast.start` 필드·설정 범위, `broadcasts.<b>` 키.
  - `18-sms-phone-shaped.yaml`: `ref`·`memo` 번호 모양.
  - `11-settings.yaml`에 범위 밖 시나리오·파서 설정 문서 둘을 더했다. 범주는 1~18이 됐다.
- **틀린 코어 (`core-adapter.test.ts`)**: 모두 불일치로 실패하고, 실패하는 시나리오는 아래 표와 정확히 같다.

  | 틀린 코어 | 실패하는 시나리오 |
  |---|---|
  | 사본을 받아 설정·제목을 바꾸는 코어 | G-ENG-160, G-ENG-162 (둘 다 사본이 있다) |
  | 모든 방송을 시작 설정으로 판정하는 코어 | G-ENG-160, G-ENG-161 (161은 b2만 실제 시각순) |
  | 정산 설정을 그날 가장 나중 방송으로 정하는 코어 | G-ENG-160 |
  | 끝난 방송의 문자찜·채팅을 거절하는 코어 | G-ENG-162 |
  | 취소 메시지를 변환하는 코어 | G-ENG-163 |
  | ASK·대기 한도 0에서 풀린 충돌 찜을 품절시키는 코어 | G-ENG-164 |

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **`state.settings`를 없앴다.** 남겨 두면 방송마다 설정이 생긴 뒤에도 그 칸을 읽는 실수가 조용히 틀린 판정을 낸다. 시작 설정은 시작 때 선언한 방송들의 스냅샷으로 옮겼다.
- **MANUAL인 `broadcast.start`는 이미 선언한 방송의 사본이어도 NotImplementedError다.** 사본을 "아무 일도 없음"으로 받으면 서버가 기록해 MANUAL이 로그에 남는다(K절 공격 지점).
- **`checkSettings`는 값이 `undefined`인 키도 문제로 본다.** `resolveSettings`는 그런 키를 기본값으로 채우지만, 검사 함수는 "값이 없다"를 알린다. JSON 경로(서버)에는 생기지 않는다.
- **상태 형식 검사는 이벤트 검사보다 먼저다.** 형식이 다르면 이벤트가 틀려도 StateFormatError다.
- **맞지 않는 명령은 같은 상태 객체를 돌려준다.** 속성 테스트로 고정했다. 문자찜은 `ref`를 처음 받을 때 기록하므로 예외다(D-067). 서버의 `changed`는 `result.state !== 넘긴 상태`로 정하면 된다.

### 바뀐 규칙에 맞춘 기존 테스트 교체 (AC-S04-93, 약화 아님)
| 원래 테스트 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| `broadcast.start`·`broadcast.end`는 미구현 (`engine-api` AC-S03-01 표) | 표에는 `effect.failed`만 남겼다. 방송 동작은 `engine-s04.test.ts` | D-070 |
| `EVENT_TYPES`에 `broadcast.start`가 없다 (`engine-s03-api`) | `broadcast.start`·`broadcast.end`가 있고 `effect.failed`는 없다 | D-070 |
| 어댑터를 거친 `broadcast.start`는 미구현으로 멈춘다 (`core-adapter`) | `effect.failed`로 같은 검사 | D-070 |
| `state.settings` 기대·조작 (`engine-api` initEngine·RECEIVED_TIME, `engine-invariants` 손상 상태 2건, `core-adapter`의 S03b 틀린 코어, `engine-properties-s03` 대기 순서·채팅 해석·승계 검사) | 방송 기록의 `settings`(`getBroadcast`·`withSettings`)로. 시작 때 선언한 방송은 시작 설정 그대로라 판정은 같다 | D-070 |
| 상태 형식 3 기대 (`engine-s03b`) | `STATE_FORMAT`(4) | D-072 |
| 메모 `'김영희 010-1234-5678'`을 받던 문자찜 (`engine-s03b`) | 메모는 이름만, 상태 검사에서 메모를 빼던 처리를 없앴다(더 엄격). 번호 메모는 `engine-s04`에서 입력 오류로 확인 | D-073 |
| `host.reopen`에 `buyer`를 붙여 넣던 처리 비용 로그 (`engine-timing`) | `buyer` 없이 | D-073 |
| 속성 테스트 생성기가 첫 방송 하나·시나리오 설정 하나를 가정 (`engine-properties-s03`) | 이벤트마다 선언된 방송 중 하나, 검사는 그 방송의 설정 | D-070 |
| 읽기 오류 03의 "broadcasts 1개 이상" | 지적을 뺐다(빈 목록 허용) | README 계약 변경 |
| 읽기 오류 11의 문구 "0 이상 정수 또는 null" | "0 이상 100000000 이하 정수 또는 null" | D-071 |
| 스냅샷 형식 오류 7건 (`runner.test`), 손으로 만든 스냅샷들 (`compare.test`·`read-errors.test`) | 8건(`broadcasts` 포함), 스냅샷에 `broadcasts` | README 관찰 키 |

### 테스트
- `test/unit/engine-s04.test.ts`(새, 100개): AC-S04-01~08·10·11. 경계와 경로는 아래와 같다.
  - 방송 시작: 선언 전 사용, 사본, 입력 오류 16가지, MANUAL(사본 포함)
  - 두 방송의 판정 설정 8가지: 승계, ASK, 시청자 취소, 공개 전 찜, 대기 한도, 방송자 무시와 효과, 주문 인식과 변환, 경합
  - 정산: 그날 첫 방송, 뒤 방송을 시작해도 금액 그대로, 방송 없는 날짜
  - 종료: 끝난 뒤의 입력이 종료 없는 로그와 같다, 종료 사본, 입력 오류
  - `checkSettings`: 키마다 최솟값·최댓값·±1, 정수가 아닌 수, 숨은 키
  - 표에 없는 필드 16가지, `ref`·`memo` 번호 모양과 받는 예
  - 상태 형식 6가지
  - 취소 메시지: OFF·REQUEST·AUTO, LOOSE, 이모지 꼬리, 언급
  - ASK·대기 0: 취소 승인, 시청자 자동 취소, 재고 2, 충돌 없음, 대기 1·REOPEN 대조
- 속성 테스트 (`engine-properties-s03`, AC-S04-92)
  - **생성기에 더한 것**
    - 빈 엔진 + `broadcast.start` 시작 로그
    - 로그 중간의 `broadcast.start`: 4개 ID, 날짜 둘, 범위 안 무작위 설정, 이미 선언한 방송의 사본
    - 아무 위치의 `broadcast.end`
    - ASK·대기 0 방송
    - 표에 없는 필드를 붙인 이벤트와 번호 모양 `ref`·`memo`: 기록되지 않고, 입력 오류·같은 필드·상태 그대로를 확인한다
  - **검사**
    - 매 이벤트 뒤: 대기 수 ≤ 그 상품 방송의 대기 한도, 대기 한도 0 방송에 "승계 결정 필요" 없음
    - 자리를 비우는 이벤트: AUTO와 ASK·대기 0에서 새 품절 없음
    - 같은 상태 객체: 사본·이미 끝난 방송의 종료·취소 메시지 변환
    - 새 방송·종료: 방송 조회 밖은 그대로
    - 로그 전체: 빈 엔진에서 재생한 상태 = 이어 온 상태, `broadcast.end`를 뺀 로그의 조회가 같다
    - 사본: 방송 시작 사본도 끼워 넣는다
    - 검사 함수 = 판정: 임의 이름 필드와 설정 범위 변형도 넣는다
  - **검사가 틀린 엔진을 잡는지 확인**: 엔진을 일부러 틀리게 바꿔 각각 속성 테스트가 실패하는 것을 로컬에서 확인했다(바꾼 것은 되돌렸다).
    - 취소 메시지를 변환하는 엔진
    - ASK·대기 0에서 승계 결정을 거는 엔진
    - 사본이 설정을 바꾸는 엔진
    - 표에 없는 필드를 받는 엔진
    - 끝난 방송의 채팅을 버리는 엔진
    - 모든 방송을 첫 방송 설정으로 판정하는 엔진

### spec-keeper에게 (규칙 문장이 정한 대로 만들었지만 판매자 안전상 확인이 필요한 것)
1. **메모의 번호 모양 판단은 메모 전체의 숫자를 모아서 한다(R-1, `normalizePhone`).** 번호에 다른 숫자가 붙으면 숫자가 12자리 이상이 되어 통과하고, 평문 번호가 로그·표시 이름(`문자찜(…)`)에 남는다. 예: `3시 010-1234-5678`, `010-1234-5678 2개`, `15번 01012345678`. 규칙 문장대로 만들었다. 메모 안의 `01`로 시작하는 10~11자리 숫자 덩어리(구분자 허용)를 찾는 식으로 넓힐지 판단을 부탁한다.
2. **번호 모양 검사는 `sms`의 `ref`·`memo`만 본다(D-073).** `settlement.payment`의 입금 메모, `host.*`·`settlement.*`의 사유, 방송 제목도 판매자가 손으로 적는 칸이라 번호가 들어갈 수 있다. 입금 메모는 "입금자 이름 + 전화번호"로 적힐 가능성이 크다. 넓힐지 판단을 부탁한다. 지금은 받는다(`engine-s04` "입금 메모는 그대로 받는다").

### 서버(dev-server)에게 — 코어 인터페이스
- **시작·적용**
  - `initEngine({ broadcasts: [], settings: {} })`로 시작한다.
  - `applyEvent(state, event)` → `{ state, effects }`. `effects`는 이 이벤트로 새로 나온 효과(발송함 행)다. `changed = result.state !== state`.
- **기록 전 거르기 (D-072)** — 순서대로 본다.
  1. `checkEvent(state, event)`가 문제를 돌려주면 입력 오류. 문구는 개발 문장("~한다")이라, 화면에는 서버가 쉬운 문장으로 바꿔 보내고 필드 이름은 그대로 쓴다.
  2. `applyEvent`가 던진 오류는 `isInvalidEvent` → 입력 오류, `isNotImplemented` → 미구현(`effect.failed`, MANUAL), `isStateFormatError` → 상태 형식 오류다.
  3. 그 밖의 예외(`CorruptStateError` 포함)는 "엔진이 처리하지 못한 입력"이다(AC-S04-24).
- **설정**
  - 저장 전 검사는 `checkSettings(부분 설정)`, 모든 키로 채우기는 `resolveSettings`.
  - `broadcast.start`의 `settings`에는 `resolveSettings(판매자 설정)`의 18개 키를 모두 적는다.
  - MANUAL은 `checkSettings`가 통과시키고 엔진이 NotImplementedError를 던진다. 서버 설정 저장에서 "아직 지원하지 않아요"로 따로 거른다.
- **방송**
  - 조회는 `listBroadcasts`·`getBroadcast`. 이미 선언한 방송의 `broadcast.start`는 같은 상태 객체를 돌려준다(`changed: false`).
  - 방송 ID는 영문·숫자·`_`·`-`로 만들기를 권한다. 엔진은 빈 문자열이 아닌 문자열이면 받지만, 골든·상품 키 `<방송>/<번호>` 모양과 맞추기 위해서다.
- **문자찜**
  - `normalizePhone(원문)` → 결과가 있으면 `phoneKey` = HMAC(판매자 키), `phoneLast4` = `phoneLast4(정규화한 번호)`.
  - **서버가 만드는 `ref`에 숫자가 10~11개 들어가 `01`로 시작하면 입력 오류다.** 무작위 base64url 등으로 만들면 아주 드물게 걸린다. 영문자만 쓰거나, `normalizePhone(ref) === null`인지 확인하고 다시 만든다.
  - 지정 구매자를 엔진이 아는지는 `getBuyer(state, id) !== null`로 본다.
- **차단 이어받기 (AC-S04-27)**: 이전 범위의 최종 상태에서 `listBuyers(state).filter((b) => b.blocked && b.kind === 'youtube')`를 고른다. 차단은 구매자 자신에게 걸린다.
- **상태 형식**: 스냅샷 형식 비교는 `STATE_FORMAT`과 한다. 재생 무결성 검사는 `checkInvariants(state)`를 쓴다.
- **조회**: `listProducts`·`listClaims`·`listPending`·`listBuyers`(뒤 4자리만, 키 없음)·`listSettlements`·`listEffects`(상태 포함)·`listCancelRequests`·`listBroadcasts`.
- `@livejjim/core/golden`(`smsPhoneFields`·`TEST_PHONE_SECRET`)은 테스트 전용이다. `apps/**/src`에서 import하지 않는다(AC-S04-32).

### 검증
- `pnpm verify`: typecheck·lint·test·golden·coverage는 통과, adversarial은 실패 5개다. 5개 모두 test-domain 몫이다(아래).
- 골든: 파일 19 · 파서 379 · 엔진 111 · 통과 490, 불일치·미구현·읽기 오류·결정성 위반·러너 오류 0.
- 코어 커버리지: 라인 100% · 분기 99.65%.

### 남의 몫 (test-domain, `tests/adversarial/**`) — 바뀐 규칙을 가정하지 않은 생성기·기대
| 파일 | 실패 이유 | 바꿀 것 |
|---|---|---|
| `s02/engine-model.test.ts` | 생성기가 `host.reopen`에 `buyer`를 붙인다. 표에 없는 필드라 입력 오류다(D-073) | `host.reopen`은 `b`·`no`·`reason`만 |
| `s02/engine-random.test.ts` | 생성기가 `product.register`에 `reason`을 붙인다(D-073) | 종류마다 표의 필드만 |
| `s03/engine-model-s03.test.ts` | 생성기가 `host.reopen`에 `buyer`를 붙인다(D-073) | 위와 같다 |
| `s03/engine-s03-chains.test.ts` (처리 비용) | 시작 설정 `claim.preOpenWindowSec: 100000`이 범위(0~300) 밖이라 `initEngine`이 TypeError를 던진다(D-071) | 300 이하로. 보류 찜이 만료되지 않게 하려면 공개 시각을 마지막 보류 찜에서 300초 안으로 둔다 |
| `s03b/rules-s03b.test.ts` "새 상태는 형식 3" | 상태 형식이 4로 올랐다(D-072) | `STATE_FORMAT`(4) |

`state.settings`를 쓰는 적대 테스트는 없다. 설정은 `getBroadcast(state, b).settings`로 읽는다.
