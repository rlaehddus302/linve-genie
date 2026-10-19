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
1. **메모의 번호 모양 판단은 메모 전체의 숫자를 모아서 한다(R-1, `normalizePhone`).** 번호에 다른 숫자가 붙으면 숫자가 12자리 이상이 되어 통과하고, 평문 번호가 로그·표시 이름(`문자찜(…)`)에 남는다. 예: `3시 010-1234-5678`, `010-1234-5678 2개`, `15번 01012345678`. 규칙 문장대로 만들었다. 메모 안의 `01`로 시작하는 10~11자리 숫자 덩어리(구분자 허용)를 찾는 식으로 넓힐지 판단을 부탁한다. → **수정 라운드 1에서 넓혔다(아래 "수정 라운드 1"). 규칙 문장 갱신을 부탁한다.**
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
  - **서버가 만드는 `ref`에 휴대폰 번호가 들어 있으면 입력 오류다.** 무작위 base64url 등으로 만들면 아주 드물게 걸린다. 영문자만 쓰거나, `!containsPhoneNumber(ref)`인지 확인하고 다시 만든다(수정 라운드 1에서 `normalizePhone(ref) === null` → `containsPhoneNumber`). 메모·ref 입력 오류의 안내 문장도 `containsPhoneNumber(값)`으로 고른다.
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

### 수정 라운드 1 — 메모·ref 안의 휴대폰 번호 (RA-S04-001 blocker, SA-S04-003·TD-S04-003 major)
- **무엇이 문제였나**: R-1 문장("`ref`·`memo`에서 숫자만 모은 것이 휴대폰 번호 모양")대로 메모 전체의 숫자를 모아 `normalizePhone`에 넣었다. 번호 앞뒤에 다른 숫자가 붙으면(`3시 010-1234-5678`, `010-1234-5678 2개`, `15번 01012345678`) 12자리 이상이 되어 통과하고, 평문 번호가 지울 수 없는 이벤트 로그·스냅샷·이력 응답·표시 이름 `문자찜(…)`에 남았다.
- **판단**: 같은 스펙의 DAT-06·R-11("이벤트 로그·엔진 상태에는 전화번호 원문·정규화한 번호가 없다")과 D-073의 근거("평문 번호가 로그·화면 이름·백업에 남는다")를 지키려면 넓혀야 한다. 넓혀도 R-1이 입력 오류로 정한 것은 모두 그대로 입력 오류이고(상위 집합), AC-S04-07의 받는 예(`3시 15번 2개`·`101동 1203호`·`r-20261018-0001` 등)도 그대로 받는다. 잘못 거르는 비용은 "전화번호 칸에 적어 주세요" 안내 뒤 다시 적기, 놓치는 비용은 지울 수 없는 평문 번호라 보수적인 쪽을 골랐다(D-036, S04 결정 기준 "개인정보 노출을 만들지 않는 쪽").
- **코어 `containsPhoneNumber(text)`** (`packages/core/src/engine/phone.ts`, 공개 API):
  - 숫자만 모은 것이 번호 모양(`normalizePhone` 결과 있음)이면 true — R-1 문장 그대로.
  - 또는 글 안의 숫자 덩어리 중 **구분자만 사이에 둔** 연속한 몇 덩어리를 모은 것이 `01`로 시작하는 10~11자리, 또는 국가 번호 형태(`82 10…`·`82 010…`, 앞에 `00` 허용)면 true. 구분자 = 공백(전각 포함)·하이픈·대시·빼기·점·가운뎃점·괄호·빗금·밑줄·`+`·보이지 않는 서식 문자. 한글·영문·`:`·`,` 등이 끼면 다른 숫자다. 전각 숫자는 반각으로 본다.
  - 덩어리 경계에서만 자른다(`010123456789` 한 덩어리 12자리는 번호로 자르지 않는다 — 긴 주문·송장 번호를 잘못 거르지 않게).
  - 국가 번호 형태(`+82 10-1234-5678`)는 구매자를 잇는 `normalizePhone`에선 여전히 null(R-11, D-051)이지만 메모에 평문으로 남으면 같은 개인정보라 메모·ref 검사에선 번호로 본다. `engine-s04`의 받는 예에 있던 `'+82 10-1234-5678'`은 거절 예로 옮겼다(스펙 받는 예 목록에는 없던 값이다).
- **쓰는 곳**: 엔진 `sms`의 `ref`·`memo` 입력 오류(`validate.ts`), 골든 러너 읽기 오류(`test/golden/contract.ts` — README "읽기 오류 — 엔진에서는 입력 오류다"가 어긋나지 않게 같은 함수), 픽스처 `read-errors/18-sms-phone-shaped.yaml`에 거절 4·받는 예 1을 더했다.
- **서버 영역을 고친 것(dev-server 영역, 최소)**: `apps/server/src/messages.ts` — 메모·ref 입력 오류의 쉬운 문장을 고르는 판단과 되돌려 보내도 되는 필드 이름 판단을 `normalizePhone` → `containsPhoneNumber`로 바꿨다(안 바꾸면 새로 거르는 메모에 "메모는 글자로 적어 주세요"가 나간다). `apps/server/src/service.ts` — 바꿔 끼운 ref 생성기 검사도 같은 판단. 시험 `apps/server/test/sms-privacy.test.ts`에 번호에 숫자가 붙은 메모·국가 번호 메모 거절·안내 문장·DB에 없음, ref 생성기 `r-010-1234-5678-2` 다시 만들기를 더했다.
- **시험**: `engine-s04` AC-S04-07에 거절 10·받는 예 추가, `containsPhoneNumber` 표 시험·속성 시험 3개(번호 앞뒤에 아무 글 → true, `normalizePhone` 결과가 있으면 늘 true, `0`·`8`로 시작하는 덩어리가 없으면 false). `engine-properties-s03`의 번호 형식 생성기에 6가지(번호 앞뒤 숫자·국가 번호·`r-…-2`·`0082…`)를 더했다.
- **그대로 둔 것 — spec-keeper 판단 대기**: `settlement.payment`의 입금 메모·사유·방송 제목은 R-1이 검사 대상을 "`sms`의 `ref`나 `memo`"로 정해 넓히지 않았다(위 질문 2, `engine-s04` "입금 메모는 그대로 받는다"). 입금 메모는 표시 이름·효과에 쓰이지 않아 노출 경로가 문자찜 메모보다 좁다. 넓히기로 하면 `containsPhoneNumber`를 그 필드 검사에 붙이고 서버 안내 문장(전화번호 칸이 없는 화면)을 따로 정하면 된다.
- **spec-keeper에게 — 문장 갱신 부탁**: R-1 입력 오류의 "`sms`의 `ref`나 `memo`에서 숫자만 모은 것이 휴대폰 번호 모양", README `sms` 행, AC-S04-07 When을 "`ref`·`memo`에 휴대폰 번호가 들어 있음(코어 `containsPhoneNumber` — 숫자만 모은 것이 번호 모양이거나, 구분자만 사이에 둔 숫자 덩어리가 `01`로 시작하는 10~11자리·국가 번호 형태)"로 맞춰 주기 바란다. D-073 "메모·`ref` ②"도 같은 말로.

---

## dev-server

### 만든 것 (`apps/server/**`, 루트 `eslint.config.mjs`의 앱 규칙, `.env.example`)
- **DB (AC-S04-20)**: Drizzle 스키마 `src/db/schema.ts`, 마이그레이션 `apps/server/drizzle/0000_init.sql`(+ `meta/_journal.json`, drizzle 마이그레이터 형식). 서버 시작·`migrate` 명령이 적용한다. 시험은 PGlite(메모리)에 같은 마이그레이션을 적용한다.
  - 테이블: `sellers`(판매자·암호화한 전화번호 키·설정 덮어쓰기) · `accounts`(로그인, scrypt 해시, 연속 실패·잠금) · `sessions`(토큰 해시) · `scopes`(판매자, 날짜) · `broadcasts`(방송 ID → 범위, 제목, 끝난 시각) · `events`(범위 로그) · `outbox`(발송함) · `snapshots`.
  - 판매자 데이터 테이블 전부에 `seller_id`(판매자 테이블은 `id`). 유일 제약: `events (scope_id, seq)`·`(seller_id, request_id)`·`(seller_id, chat_broadcast, chat_message_id)`·`(seller_id, sms_ref)`, `outbox (seller_id, scope_id, effect_id)`, `scopes (seller_id, date)`.
  - `test/schema.test.ts`가 실제 DB 구조(컬럼·타입·NOT NULL·유일 제약·인덱스·외래 키)와 Drizzle 정의를 대조한다(drizzle-kit 없이 — drizzle-kit은 esbuild 빌드 스크립트 승인이 필요해 넣지 않았다).
  - 새 의존성(정확한 버전): `drizzle-orm 0.45.3`, `@electric-sql/pglite 0.5.8`, `postgres 3.4.9`, `@livejjim/core workspace:*`.
- **기록 경로 (AC-S04-21~26·30, `src/writer.ts`)** — 순서:
  1. 범위(판매자, 날짜)마다 프로세스 안 대기열 → 트랜잭션 → `pg_advisory_xact_lock(hashtextextended('<판매자>/<날짜>'))`.
  2. 트랜잭션 안에서 다른 인스턴스가 쓴 이벤트를 따라잡는다(`seq` > 메모리 seq). 요청 번호·채팅 ID가 이미 있으면 처음 결과.
  3. 이벤트를 메모리에서 미리 계산: `checkEvent` 문제 → 400, 지정 구매자 모름 → 400, `NotImplementedError` → 422, `StateFormatError` → 409(메모리 상태를 버림). 그 밖의 엔진 예외 → 실패 표시(`failed=true`)로 기록, 상태 그대로.
  4. 이벤트 행 + 발송함 행(+ 방송 목록 행)을 한 트랜잭션으로 커밋. 커밋 뒤에만 메모리 상태 교체 → SSE 알림 → 응답. `(scope_id, seq)` 충돌이면 최신 로그를 읽고 다시 계산(최대 5번).
  5. `seq`는 범위마다 1부터, `at` = max(서버 시계, 범위의 직전 at). `received_at`(timestamptz)·조치자(`actor`=account|server|collector, `account_id`)는 이벤트 행에만 두고 엔진 이벤트에는 넣지 않는다(DAT-05).
- **범위 상태(프로젝션, AC-S04-28, `src/runtime.ts`)**: 메모리 상태 + 스냅샷. 스냅샷은 범위마다 500건(시험에서 줄일 수 있음)마다와 `broadcast.end` 뒤, 상태 JSON·seq·형식 번호·확인 필요 목록. 쓰기 실패는 로그만 남기고 응답은 성공. 처음 읽을 때 형식이 같은 마지막 스냅샷(JSON·형식·`checkInvariants`·확인 필요 목록·그 seq 이벤트 존재를 확인) + 뒤 이벤트, 쓸 수 없으면 처음부터 재생. 재생은 실패 표시를 건너뛰고, 표시 없는 엔진 오류도 건너뛰며 경보·확인 필요에 남긴다.
- **차단 이어받기 (AC-S04-27)**: 새 범위의 첫 `broadcast.start` 바로 뒤에, 새 날짜보다 이른 날짜 중 이벤트가 있는 가장 늦은 범위의 최종 상태에서 차단 중인 유튜브 채널(`sms:`로 시작하지 않는 ID)마다 `host.blockBuyer { buyer, reason: "이전 방송에서 차단한 시청자" }`(조치자 server). 엔진 상태의 차단 목록(`state.blocked`)을 직접 읽어 **구매자로 기록된 적 없는 미리 차단한 채널도** 이어받는다(`listBuyers`만 보면 빠진다). 순서는 ID 사전 순.
- **재생 무결성 검사 (AC-S04-29, `src/check-replay.ts`, 명령 `check-replay`)**: 범위마다 처음부터 재생(실제 코어)해 (1) 스냅샷 전부(상태·확인 필요), (2) 발송함 전부(ID·내용·seq), (3) `checkInvariants`, (4) seq 빈틈, (5) 실패 표시 수(보고만)를 대조. 더해서 이벤트 행 요약값 `digest = SHA-256(범위·seq·종류·본문·실패 표시)`로 행이 바뀌었는지, 표시 없는 재생 오류도 불일치로 본다. 한 줄 출력, 종료 코드 0/1(설정 오류 2), 마이그레이션도 하지 않고 읽기만.
- **문자찜·개인정보 (AC-S04-31~34)**: 서버가 `ref`(영문 소문자 20자 — 숫자가 없어 번호 모양이 될 수 없다, 바꿔 끼운 생성기가 번호 모양을 내면 다시 만든다), `received` 기본값(그 이벤트 `at`의 KST `HH:MM:SS`), `phoneKey` = HMAC-SHA256(판매자 키, 정규화 번호) base64url, `phoneLast4`를 만든다. 원문·정규화 번호는 DB·로그·응답 어디에도 없다(시험: 테이블 전체 + PGlite 데이터 폴더 바이트 검색). 판매자 키는 판매자를 만들 때 32바이트 무작위, 마스터 키로 AES-256-GCM(판매자 ID를 AAD로 묶음) 암호화해 `sellers.phone_key_enc`에 둔다.
  - 로그는 정해진 코드·범위 날짜·seq·오류 종류 이름만(`src/log.ts`). 기본 오류 기록(`defaultLogError`)도 오류 객체 대신 종류 이름만 남긴다.
  - 금지 린트(루트 `eslint.config.mjs`, `apps/*/src/**`): `@livejjim/core/golden` 정적·별칭·이름 공간·타입·다시 내보내기·하위 경로·동적 import·`require`, `packages/core/test` 경로, `TEST_PHONE_SECRET` 이름(식별자·문자열·템플릿). 웹 소스는 XSS 규칙과 합쳤다(같은 규칙 이름은 뒤 블록이 덮어써서). `test/lint-guard.test.ts`가 실제로 잡는지 확인한다.
- **로그인·보호·격리 (AC-S04-40~42)**, **API (AC-S04-50~52)**, **SSE (AC-S04-60)**: 아래 계약.
- **지연 (AC-S04-70)**: `test/latency.test.ts` — 상품 100·채팅 3,000(+방송 시작) 범위, SSE 3개, 입력 200건(앞 20건 제외). 이 PC 측정: 응답 p99 약 2.6ms, 커밋 → 세 연결 수신 p99 약 0.03ms. p99는 최댓값이 아니다(시험 안에 계산 확인).

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **범위가 "있다" = 그 범위에 이벤트가 하나 이상 있다.** 범위 행만 있고 이벤트가 없으면(방송 만들기가 거절됨) 없는 범위로 본다(404). 범위 행은 첫 이벤트와 같은 트랜잭션에서 만든다.
- **같은 요청 번호는 끝점과 상관없이 처음 결과**를 처음 응답 모양으로 돌려준다(검사보다 먼저 확인 — "내용이 같든 다르든"). 동시에 온 경우는 트랜잭션 안 확인 + 유일 제약으로 막는다.
- **엔진이 처리하지 못한 입력의 응답은 500 `PROCESSING_FAILED`**(본문에 `date`·`seq`). 같은 요청 번호로 다시 보내도 같은 응답(이미 기록됨).
- **범위 조회의 시각 필드는 ISO 8601로 바꿔 낸다**: 코어 조회 결과 그대로이되 `at`·`endedAt`·`rankTime`(UTC 밀리초)만 `...Z` 문자열(AC-S04-52 "값은 코어 조회 함수의 결과와 같다" + "시각은 UTC ISO 8601"). `seq`·금액·`received`(받은 시각 글자)는 그대로.
- **방송이 있는 종류는 `?date=`를 받지 않는다(400)**, 없는 종류는 `?date=`가 필수다. 범위를 두 가지로 정하는 길을 없앴다.
- **방송 제목은 서버가 더 엄격하게 받는다**: 1~100자, 제어 문자 없음(DB 글자 칸이 NUL을 받지 않는다). 엔진 이벤트 본문은 JSON 문자열(text)로 둔다 — jsonb는 NUL·짝 없는 서로게이트가 든 채팅 본문을 받지 않는다. 채팅 메시지 ID도 제어 문자를 받지 않는다(유일 제약 칸).
- **없는 아이디도 잠근다(메모리)**: 있는 아이디만 잠그면 11번째 응답(429/401)으로 아이디가 있는지 알 수 있다. 있는 아이디의 잠금은 DB(`accounts`)에 둔다. 없는 아이디도 같은 비용의 해시 확인을 거친다.
- **세션 연장은 10분에 한 번** DB에 쓴다(요청마다 쓰지 않게). 연장하면 쿠키도 다시 보낸다.
- **상태를 바꾸는 요청은 로그아웃을 포함해 모두 JSON 객체 본문**이어야 한다(`{}`). 다른 출처의 폼 전송(CSRF)을 사전 요청 없이 보낼 수 없게.
- **서버 시험은 다른 프로젝트 뒤에 돈다**(`apps/server/vitest.config.ts`의 `sequence.groupOrder: 1`). PGlite·지연 시험이 같은 시간에 돌면 코어 `engine-timing`의 비율 비교(1ms 대 8ms)가 가끔 8배를 넘었다. 대상 파일·결과는 그대로다.
- **`main.ts`는 포트 오류·종료 때 DB를 닫고 끝낸다**(PGlite가 열려 있으면 프로세스가 남는다).

### 바꾼 기존 테스트 (약화 아님)
| 원래 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| 기본 기록 함수가 `console.error`에 오류 객체를 넘긴다 (`apps/server/test/app.test.ts`) | `console.error`에 한 번 남기되 오류 객체·메시지·경로는 없고 오류 종류 이름만 | D-073, AC-S04-34 (오류 메시지에 DB 질의 인자 — 전화번호 키·메모 — 가 들어 있을 수 있다) |

### 웹(S05)에게 — API 계약 (AC-S04-53)
- **공통**
  - 주소는 `/api/...`. 세션은 쿠키 `lj_session`(`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`) — 화면은 토큰을 직접 다루지 않는다. `fetch(..., { credentials: 'include' })`.
  - 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE): `Origin`이 서버의 `LIVEJJIM_APP_ORIGIN`과 정확히 같아야 하고(아니면 403), `Content-Type: application/json`(charset 허용, 아니면 415), 본문은 JSON 객체(아니면 400), 64KB 이하(아니면 413).
  - CORS 헤더를 내지 않는다 → 화면과 API는 같은 출처로 배포하거나 개발 때 Vite 프록시를 쓴다(`/api` → 서버). 프록시를 쓰면 Origin은 화면 주소(예: `http://localhost:5173`)이므로 그 값을 `LIVEJJIM_APP_ORIGIN`에 둔다.
  - 모든 `/api` 응답은 `Cache-Control: no-store`. 시각은 UTC ISO 8601(`Z`), 날짜는 `YYYY-MM-DD`.
  - 로그인·헬스체크 밖은 세션이 없으면(만료·위조 포함) `401 UNAUTHORIZED`. 다른 판매자의 방송·범위는 없는 것과 같은 `404 NOT_FOUND`.
- **오류 본문**: `{ "error": { "code", "message", "problems"?: [{ "field": string|null, "message" }] } }`. `message`·`problems[].message`는 화면에 그대로 보여 줘도 되는 쉬운 한국어(영어 없음 — 단 설정 문제는 코어 `checkSettings` 문장 그대로라 `true`·`false`가 들어 있다). 받은 값은 되돌려 보내지 않는다. `field`는 엔진 필드 이름(`no`, `price`, `memo`, `settings.waitlist.max` …) — 받은 키가 번호 모양·이상한 이름이면 `null`.

  | 상태 | code | 문장 | 언제 |
  |---|---|---|---|
  | 400 | `INVALID_REQUEST_ID` | 요청 번호가 없거나 형식이 올바르지 않아요. | 쓰기 요청의 `requestId`가 없거나 `^[A-Za-z0-9_-]{1,64}$`가 아님 |
  | 400 | `INVALID_INPUT` | 입력한 내용을 확인해 주세요. (+problems) | 엔진 입력 오류, 날짜·제목 형식, 범위 정하기 |
  | 400 | `UNKNOWN_FIELD` | 받을 수 없는 항목이 있어요. (+problems) | 그 종류에 없는 필드(`seq`·`at`·`ref`·`phoneKey`·`phoneLast4` 포함) |
  | 400·415 | `NOT_JSON` | 보낸 내용의 형식이 올바르지 않아요. | Content-Type·깨진 JSON·객체 아님 |
  | 400 | `BUYER_NOT_FOUND` | 고른 구매자를 찾지 못했어요. | 문자찜의 지정 구매자를 그 날짜 범위가 모름 |
  | 400 | `NOT_SUPPORTED` | 아직 지원하지 않는 설정이에요. | 설정 `settlement.groupBy: MANUAL` |
  | 401 | `UNAUTHORIZED` | 로그인이 필요해요. | 세션 없음·만료·위조 |
  | 401 | `LOGIN_FAILED` | 아이디나 비밀번호가 맞지 않아요. | 아이디 없음·비밀번호 틀림(같은 응답) |
  | 403 | `FORBIDDEN_ORIGIN` | 허용하지 않은 곳에서 온 요청이에요. | Origin 없음·다름 |
  | 404 | `NOT_FOUND` | 찾을 수 없어요. | 없는(또는 남의) 방송·범위 |
  | 409 | `STATE_FORMAT` | 저장된 상태를 다시 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요. | 상태 형식 오류(기록 없음) |
  | 413 | `PAYLOAD_TOO_LARGE` | 보낸 내용이 너무 커요. | 본문 64KB 초과 |
  | 422 | `NOT_SUPPORTED` | 아직 지원하지 않는 기능이에요. | 엔진 미구현(판매자 설정에 MANUAL이 들어간 방송 만들기 등) |
  | 429 | `LOGIN_LOCKED` | 로그인을 여러 번 틀려서 잠시 막아 두었어요. 15분 뒤에 다시 해 주세요. | 같은 아이디 연속 10번 실패 뒤 15분 |
  | 500 | `SAVE_FAILED` | 저장하지 못했어요. 다시 시도해 주세요. | DB 저장 실패(기록 없음 → 같은 요청 번호로 다시 보내면 된다) |
  | 500 | `PROCESSING_FAILED` | 처리하지 못했어요. 확인 필요 목록에 남겼어요. | 엔진이 처리하지 못함(기록됨·실패 표시, 본문에 `date`·`seq`) |
  | 500 | `INTERNAL_ERROR` | 서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요. | 그 밖 |

- **경로**

  | 메서드·경로 | 요청 | 응답 200 |
  |---|---|---|
  | `GET /api/health` | — (세션 불필요) | `{ "status": "ok" }` |
  | `POST /api/login` | `{ loginId, password }` (세션 불필요, Origin 필요) | `{ seller: { name }, loginId }` + `Set-Cookie` |
  | `POST /api/logout` | `{}` | `{ ok: true }` + 쿠키 지움. 그 세션의 SSE 연결이 닫힌다 |
  | `GET /api/me` | — | `{ seller: { name }, loginId }` |
  | `GET /api/settings` | — | `{ settings }` (18개 키 전부, 기본값으로 채움) |
  | `PATCH /api/settings` | `{ settings: { "<키>": 값, ... } }` (일부 키) | `{ settings }` (바꾼 뒤 전부). 다음에 만드는 방송부터 들어간다 |
  | `GET /api/broadcasts` | — | `{ broadcasts: [{ id, date, title, ended, endedAt }] }` (날짜·선언 순) |
  | `POST /api/broadcasts` | `{ requestId, date?, title? }` (날짜 없으면 서버 KST 오늘, 제목 없으면 `N부`) | 쓰기 결과 + `broadcast: { id, date, title }` |
  | `POST /api/broadcasts/:id/end` | `{ requestId }` | 쓰기 결과 (이미 끝났으면 `changed: false`) |
  | `POST /api/events[?date=YYYY-MM-DD]` | `{ requestId, type, ...그 종류의 엔진 필드 }` | 쓰기 결과 (`sms`는 `phoneLast4`도) |
  | `GET /api/days` | — | `{ days: [{ date, seq }] }` (이벤트가 있는 범위, 날짜 순) |
  | `GET /api/days/:date` | — | `{ date, seq, broadcasts, products, claims, pending, buyers, settlements, effects, cancelRequests, attention: [{ seq, message }] }` — 코어 `listBroadcasts`·`listProducts`·`listClaims`·`listPending`·`listBuyers`·`listSettlements`·`listEffects`·`listCancelRequests` 결과(시각 필드만 ISO) |
  | `GET /api/days/:date/history?after=0&limit=100` | `after` 0 이상, `limit` 1~9999(최대 500으로 자름) | `{ date, events: [{ seq, type, at, receivedAt, actor: { kind: 'account'\|'server'\|'collector', loginId }, reason, fields, failed }] }` — `fields`는 엔진 이벤트에서 `type`·`seq`·`at`·`reason`·`phoneKey`를 뺀 것 |
  | `GET /api/stream` | — | SSE (아래) |

- **쓰기 결과**: `{ date, seq, type, changed, effects: [효과 ID] }`. `changed`가 `false`면 맞지 않는 명령(기록은 됨) → 화면은 "적용되지 않았어요"로 알릴 수 있다. 같은 요청 번호면 내용이 달라도 처음 결과(처음 응답과 같은 모양·상태)를 돌려준다.
- **요청 번호**: 화면이 쓰기 버튼을 누를 때마다 새로 만들고(예: `crypto.randomUUID()`), 재시도(네트워크 오류·500 `SAVE_FAILED`)할 때는 같은 값을 다시 보낸다.
- **이벤트 쓰기 종류와 범위** (`src/api-fields.ts`의 `API_EVENTS`)
  - `b`가 있는 종류(그 방송의 범위, `?date=` 쓰면 400): `product.register|open|hold|close|update|renumber`, `sms`, `host.cancel|reject|promote|confirm|approveCancel|dismissCancel|assign|reopen|resolveConflict|convertMessage`.
  - `b`가 없는 종류(`?date=` 필수, 없는 범위면 404): `host.blockBuyer|unblockBuyer`, `buyer.merge|unmerge`, `settlement.shippingOverride|adjust|payment|refund`. `settlement.*`의 `date`는 `?date=`와 같아야 한다(400).
  - 필드 이름·값은 골든 README 이벤트 표·코어 타입 그대로. `broadcast.*`는 방송 경로로만, `chat`은 받지 않는다(서버 수집 함수), `effect.*`는 S08·S11.
  - **`sms`**: `{ requestId, type: 'sms', b, no, received?, memo?, phone?, buyer? }`. `phone`은 판매자가 적은 글자 그대로(서버가 정규화·키로 바꾸고 원문은 버린다). 응답 `phoneLast4`가 `null`이면 휴대폰 번호로 알아보지 못한 것. `memo`가 번호 모양이면 400(`problems[0].field = 'memo'`, "전화번호는 여기에 적을 수 없어요. 전화번호 칸에 적어 주세요.").
- **SSE `GET /api/stream`** (`text/event-stream`)
  ```
  retry: 3000
  event: ready
  data: {"scopes":[{"date":"2026-10-19","seq":12}]}

  id: 1
  event: change
  data: {"date":"2026-10-19","seq":13,"type":"sms"}

  : ping
  ```
  - `ready`는 연결 직후 한 번(그 판매자의 범위별 지금 seq). `change`는 커밋된 이벤트마다(같은 요청이 여러 이벤트를 쓰면 — 방송 만들기 + 차단 이어받기 — 하나씩), `id`는 연결마다 1부터. 화면은 알림을 받으면 그 날짜를 다시 조회한다(내용은 보내지 않는다). 하트비트 `: ping`은 15초마다. 다시 붙으면 `ready`의 seq로 놓친 변경을 안다. 로그아웃·세션 만료면 서버가 연결을 닫는다(만료 뒤 다시 붙으면 401).

### 실행·명령
- 환경 변수(`.env.example`): `PORT`, `DATABASE_URL`(운영 PostgreSQL) 또는 `LIVEJJIM_PGLITE_DIR`(개발용 파일 PGlite — 명시적으로 고를 때만, 둘 중 하나), `LIVEJJIM_MASTER_KEY`(32바이트 base64), `LIVEJJIM_APP_ORIGIN`(경로 없는 화면 주소). 하나라도 없거나 틀리면 쉬운 문장으로 시작하지 않는다(값은 출력하지 않는다, 메모리 DB로 바꾸지 않는다).
- 마스터 키 만들기: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
- 마이그레이션: `pnpm --filter @livejjim/server migrate` (서버 시작 때도 적용)
- 계정 만들기: `echo '비밀번호' | pnpm --filter @livejjim/server create-account --name "가게 이름" --login 아이디` (비밀번호는 표준 입력 첫 줄, 터미널이면 화면에 안 보이게 묻는다. 아이디는 영문 소문자로 시작 3~32자, 비밀번호 8~200자)
- 서버: `pnpm --filter @livejjim/server start`
- 재생 검사: `pnpm --filter @livejjim/server check-replay [--seller 판매자ID] [--date YYYY-MM-DD]` (PGlite 폴더는 서버를 끈 뒤에)
- 개발 예: `LIVEJJIM_PGLITE_DIR=./.data/dev LIVEJJIM_MASTER_KEY=… LIVEJJIM_APP_ORIGIN=http://localhost:5173 pnpm --filter @livejjim/server start`
- 시험: `pnpm test`(서버 시험 포함), 서버만 `npx vitest run --config vitest.config.ts --project server [파일]`

### 시험용 기동과 주입점 (test-domain·다음 개발자)
```ts
import { createSellerAccount, createServer, generateMasterKey, openPglite } from '@livejjim/server'
const database = await openPglite()                     // 메모리 PGlite + 마이그레이션 (database.pglite로 SQL 직접 가능)
const masterKey = generateMasterKey()                   // 시험 안에서 만든다
const cost = { N: 1024, r: 8, p: 1 }                    // 비밀번호 해시를 빠르게
const server = createServer({ database, masterKey, appOrigin: 'https://app.test', passwordCost: cost })
await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName: '가게', loginId: 'shop1', password: 'pass-word-1' }, { passwordCost: cost })
const res = await server.app.request('/api/login', { method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'shop1', password: 'pass-word-1' }) })
const cookie = /lj_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0]   // 이후 요청에 Cookie로
```
- `createServer` 옵션(주입점): `clock: { now() }`(서버 시계 — 날짜 기본값·at·세션 만료·잠금), `ids: { broadcast, smsRef, scope, seller, account }`(일부만 바꿔도 됨), `hooks: { beforeCommit, afterCommit, beforeSnapshot }`(던지면 각각 저장 실패·응답 전 멈춤·스냅샷 실패), `engine: { applyEvent }`(엔진 감싸기 — 쓰기와 재생 모두), `log`(로그 수집 — 기본은 표준 오류), `snapshotEvery`(1~500), `heartbeatMs`(1~30000), `passwordCost`.
- 같은 DB로 두 번째 인스턴스: `createServer({ database, masterKey, ... })`를 한 번 더(재시작·두 인스턴스 시험).
- 서버 안 채팅 수집: `server.ingestChat(sellerId, { b, id, ch, nick, text, owner?, publishedAt? })` → `{ status: 'recorded'|'duplicate'|'rejected'|'not_found'|'save_failed', ... }`.
- 메모리 범위 상태: `(await server.writer.read(sellerId, date)).state`(최신 로그까지 따라잡은 엔진 상태), 확인 필요: `.attention`.
- 재생 검사: `checkReplay(database.db, { sellerId?, date? })` → 범위별 `{ ok, firstDiff: { seq, part } | null, events, snapshots, outbox, failedMarked }`, 한 줄 문장은 `formatCheck`.
- 끝나면 `server.close()`(SSE·타이머), `database.close()`.

### 남의 몫 (test-domain, `tests/adversarial/**`)
| 파일 | 실패 이유 | 바꿀 것 |
|---|---|---|
| `s00/server.test.ts` "기동 (AC-S00-42)" 2건(포트에서 시작·이미 쓰는 포트) | S04부터 서버는 DB 연결 설정·마스터 키·앱 주소가 없으면 시작하지 않는다(AC-S04-20·32). 시험이 `PORT`만 넘긴다 | 자식 프로세스 환경에 `LIVEJJIM_PGLITE_DIR`(빈 임시 폴더), `LIVEJJIM_MASTER_KEY`(`generateMasterKey()`), `LIVEJJIM_APP_ORIGIN`(예: `http://localhost:5173`)을 더한다. 시작에 PGlite 초기화·마이그레이션이 더해져 1~2초 걸린다. 잘못된 PORT 시험은 그대로 통과한다(PORT를 먼저 본다) |
| `s02/engine-model.test.ts`, `s02/engine-random.test.ts`, `s03/engine-model-s03.test.ts`, `s03/engine-s03-chains.test.ts`, `s03b/rules-s03b.test.ts` | dev-core 절의 표 그대로(표에 없는 필드·설정 범위·상태 형식 4) | dev-core 절 참고 |

### spec-keeper에게 (규칙 문장대로 만들었지만 판매자 안전상 확인이 필요한 것)
1. **메모 번호 모양 판단이 메모 전체의 숫자를 모아서 한다(R-1, D-073)** — dev-core 질문 1과 같다. 서버 쪽에서 보면 `"3시 010-1234-5678"`·`"010-1234-5678 2개"`는 통과해 **평문 번호가 이벤트 로그·스냅샷·이력 응답·구매자 표시 이름에 남는다**(DAT-06 "이벤트 로그·엔진 상태에는 전화번호 원문이 남지 않는다"와 어긋난다). 서버에서 더 엄격하게 거르지 않았다(규칙과 다르게 조용히 만들지 않음). 메모 안의 번호 덩어리를 찾는 식으로 넓히면 서버는 코어 검사를 그대로 쓰므로 따로 고칠 것이 없다.
2. **입금 메모·사유·방송 제목의 번호** — dev-core 질문 2와 같다. 서버는 받은 그대로 기록한다.
3. **재생 검사의 한계**: 마지막 이벤트를 지우면, 그 뒤 스냅샷도 그 이벤트의 발송함 행도 없을 때 알아챌 수 없다(seq 빈틈이 생기지 않는다). 이벤트 행 덧붙이기만이라는 D-072 전제 아래 우연한 손상·수동 수정을 잡는 수준이다. 필요하면 범위마다 마지막 seq를 따로 남기는 방식을 정해 달라.

### 검증 (dev-server 끝, `pnpm verify`)
- typecheck 통과(설정 7 · TS 파일 165) · lint 통과 · **test 통과(파일 56 · 테스트 1432, 서버 시험 19파일 포함)** · golden 통과(19 · 379 · 111 · 490, 그 밖 0) · coverage 통과(코어 라인 100% · 분기 99.65%).
- adversarial 실패 7 — 모두 test-domain 몫(위 "남의 몫" 표): `s00/server.test.ts` 기동 2건(S04 시작 조건), dev-core 절의 5건.
- 서버 시험은 도커·네트워크·외부 DB 없이 PGlite로, `TZ=Pacific/Honolulu` 아래 돈다(AC-S04-94). 검증 파이프라인(`scripts/verify/**`)은 바꾸지 않았다.
