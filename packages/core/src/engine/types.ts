// 판정 엔진의 공개 타입 (R-1 이벤트, 상태, 효과, 조회 결과). AC-S02-01, AC-S03-01.
// 상태는 JSON으로 직렬화할 수 있는 순수 데이터다: 객체·배열·문자열·유한한 수·불리언·null만 쓴다(undefined 값 없음, AC-S02-02).
import type { SaleSettings, SettingsOverride } from '../settings.ts'
import type { PMap } from './pmap.ts'

// ── 열거값 (tests/golden/README "열거값") ────────────────────────────────

export type ClaimStatus = 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED' | 'CONFLICT' | 'DUPLICATE'
export type ClaimReason = 'BLOCKED' | 'UNOPENED' | 'NOT_ON_SALE' | 'SOLD_OUT' | 'EXPIRED' | 'WAITLIST_CLEARED' | 'BY_HOST' | 'RENUMBERED'
export type ProductStatus = 'READY' | 'OPEN' | 'SOLD' | 'HOLD' | 'CLOSED'
export type EffectKind = 'PRINT_PRODUCT_LABEL' | 'PRINT_PACKING_LABEL' | 'POST_THANKS' | 'VOID_LABEL' | 'NOTIFY'
export type ThanksTarget = 'LIVE_CHAT' | 'VIDEO_COMMENT'
/** PENDING = 아직 실행 대상, DONE = 실행 완료 보고됨, CANCELLED = 확정이 풀려 취소됨(R-13) */
export type EffectStatus = 'PENDING' | 'DONE' | 'CANCELLED'
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID'
/** 찜이 생긴 경로: 채팅 주문, 문자찜, 방송자 직접 배정, 방송자의 메시지 변환 */
export type ClaimOrigin = 'chat' | 'sms' | 'assign' | 'convert'
/** 유튜브 채널 구매자, 문자 구매자 (R-11) */
export type BuyerKind = 'youtube' | 'sms'
/** 배송비 예외 (R-12). DEFAULT = 예외 지우기 (D-058) */
export type ShippingMode = 'PICKUP' | 'COMBINED' | 'FIXED' | 'DEFAULT'

// ── 시작 ─────────────────────────────────────────────────────────────────

/** 방송(회차). 상품 번호는 방송 안에서 유일하다 (R-0). */
export interface BroadcastInfo {
  readonly id: string
  /** 방송 날짜 YYYY-MM-DD (KST). 정산 묶음 날짜가 된다 (R-12). */
  readonly date: string
  readonly title: string
}

export interface EngineSetup {
  readonly broadcasts: readonly BroadcastInfo[]
  /** 시작 시점 스냅샷으로 모든 방송에 적용할 설정 (DOMAIN_RULES 기본값 위에 덮어쓴다) */
  readonly settings: SettingsOverride
}

// ── 이벤트 (R-1, tests/golden/README "이벤트 종류와 필드") ────────────────
// 필드 이름은 골든 README와 같다(b = 방송 ID, no = 상품 번호, buyer = 구매자 ID). 효과 보고만 효과 ID로 가리킨다(R-13).
// 구매자 ID는 그 구매자 자신을 가리킨다. 판정·대상 찾기는 엔진이 지금의 구매자(합친 결과)로 한다(R-11, D-057).

interface EventBase {
  /** 서버 일련번호. 판정 순위(ARRIVAL)의 키 */
  readonly seq: number
  /** 서버 도착 시각, UTC 밀리초. 코어는 시계를 읽지 않는다 */
  readonly at: number
}

export interface ProductRegisterEvent extends EventBase {
  readonly type: 'product.register'
  readonly b: string
  readonly no: number
  /** 품종 (빈 문자열 가능) */
  readonly name: string
  /** 정수 원, 0 이상 */
  readonly price: number
  /** 1 이상, 기본 1 */
  readonly stock?: number
  /** 기본 OPEN */
  readonly status?: 'OPEN' | 'READY'
}

export interface ProductCommandEvent extends EventBase {
  readonly type: 'product.open' | 'product.hold' | 'product.close'
  readonly b: string
  readonly no: number
}

/** 상품 수정 (R-10, D-055): 적힌 값만 한 번에 바꾼다 */
export interface ProductUpdateEvent extends EventBase {
  readonly type: 'product.update'
  readonly b: string
  readonly no: number
  readonly name?: string
  readonly price?: number
  readonly stock?: number
  /** 가격 적용 범위, 기본 NEW_ONLY */
  readonly applyTo?: 'NEW_ONLY' | 'UNPAID_CLAIMS'
}

/** 번호 변경 (R-10, D-056) */
export interface ProductRenumberEvent extends EventBase {
  readonly type: 'product.renumber'
  readonly b: string
  readonly from: number
  readonly to: number
}

export interface ChatEvent extends EventBase {
  readonly type: 'chat'
  readonly b: string
  /** 메시지 ID. 재수신은 (방송, 메시지 ID)로 판단한다 (D-045) */
  readonly id: string
  /** 채널 ID = 유튜브 구매자 ID. `sms:`로 시작할 수 없다(문자 구매자 ID 자리) */
  readonly ch: string
  readonly nick: string
  readonly text: string
  /** 방송자 본인 메시지 (기본 false) */
  readonly owner?: boolean
  /** 유튜브 게시 시각(UTC 밀리초). 없으면 at. RECEIVED_TIME의 순위 재료 */
  readonly publishedAt?: number
}

/** 문자찜 (R-1, R-11, D-051) */
export interface SmsEvent extends EventBase {
  readonly type: 'sms'
  readonly b: string
  /** 문자찜 입력 ID. 같은 ref가 다시 오면 아무 일도 없다 */
  readonly ref: string
  readonly no: number
  /** 실제 수신 시각 `HH:MM` 또는 `HH:MM:SS` (KST). 날짜는 at에 가장 가까운 날 (D-023) */
  readonly received: string
  readonly memo?: string
  readonly phone?: string
  /** 지정 구매자 ID */
  readonly buyer?: string
}

export interface HostClaimEvent extends EventBase {
  readonly type: 'host.cancel' | 'host.reject' | 'host.promote'
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly reason: string
}

export interface HostClaimOptionalReasonEvent extends EventBase {
  readonly type: 'host.confirm' | 'host.approveCancel' | 'host.dismissCancel'
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly reason?: string
}

export interface HostAssignEvent extends EventBase {
  readonly type: 'host.assign'
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly reason: string
  /** 교체할 지금 1등의 구매자 ID. replaceTo와 함께 쓴다 */
  readonly replace?: string
  readonly replaceTo?: 'WAITLIST' | 'CANCEL'
}

export interface HostReopenEvent extends EventBase {
  readonly type: 'host.reopen'
  readonly b: string
  readonly no: number
  readonly reason: string
}

/** 충돌 결정 (R-7 7, D-053) */
export interface HostResolveConflictEvent extends EventBase {
  readonly type: 'host.resolveConflict'
  readonly b: string
  readonly no: number
  readonly decision: 'KEEP' | 'SWITCH'
  readonly reason?: string
}

/** 채팅 메시지를 찜으로 바꾸기 (R-7 4, D-054) */
export interface HostConvertMessageEvent extends EventBase {
  readonly type: 'host.convertMessage'
  readonly b: string
  /** 그 방송에서 받은 메시지 ID */
  readonly msg: string
  readonly no: number
  readonly reason?: string
}

export interface HostBlockEvent extends EventBase {
  readonly type: 'host.blockBuyer' | 'host.unblockBuyer'
  readonly buyer: string
  readonly reason: string
}

/** 구매자 합치기 (R-11, D-057): from·into는 그 구매자 자신 */
export interface BuyerMergeEvent extends EventBase {
  readonly type: 'buyer.merge'
  readonly from: string
  readonly into: string
  readonly reason: string
}

export interface BuyerUnmergeEvent extends EventBase {
  readonly type: 'buyer.unmerge'
  readonly from: string
  readonly reason: string
}

export interface EffectReportEvent extends EventBase {
  readonly type: 'effect.labelPrinted' | 'effect.thanksSent'
  /** 보고하는 효과의 ID (`{찜ID}:{효과종류}:{대상}:{확정버전}`) */
  readonly effectId: string
}

/** 배송비 예외 (R-12, D-058). amount는 FIXED일 때만 (필수) */
export interface SettlementShippingEvent extends EventBase {
  readonly type: 'settlement.shippingOverride'
  readonly buyer: string
  /** 묶음 날짜 YYYY-MM-DD */
  readonly date: string
  readonly mode: ShippingMode
  readonly amount?: number
}

export interface SettlementAdjustEvent extends EventBase {
  readonly type: 'settlement.adjust'
  readonly buyer: string
  readonly date: string
  /** 정수 원, 음수 가능 */
  readonly amount: number
  readonly reason: string
}

export interface SettlementPaymentEvent extends EventBase {
  readonly type: 'settlement.payment'
  readonly buyer: string
  readonly date: string
  /** 1 이상 정수 원 */
  readonly amount: number
  readonly memo?: string
}

export interface SettlementRefundEvent extends EventBase {
  readonly type: 'settlement.refund'
  readonly buyer: string
  readonly date: string
  /** 1 이상 정수 원 */
  readonly amount: number
  readonly reason: string
}

/** 처음 쓰는 스프린트가 따로 있는 R-1 이벤트 (S04·S11). 엔진은 NotImplementedError를 던진다 */
export type DeferredEventType = 'broadcast.start' | 'broadcast.end' | 'effect.failed'

export interface DeferredEvent extends EventBase {
  readonly type: DeferredEventType
  readonly [field: string]: unknown
}

export type EngineEvent =
  | ProductRegisterEvent
  | ProductCommandEvent
  | ProductUpdateEvent
  | ProductRenumberEvent
  | ChatEvent
  | SmsEvent
  | HostClaimEvent
  | HostClaimOptionalReasonEvent
  | HostAssignEvent
  | HostReopenEvent
  | HostResolveConflictEvent
  | HostConvertMessageEvent
  | HostBlockEvent
  | BuyerMergeEvent
  | BuyerUnmergeEvent
  | EffectReportEvent
  | SettlementShippingEvent
  | SettlementAdjustEvent
  | SettlementPaymentEvent
  | SettlementRefundEvent
  | DeferredEvent

export type EngineEventType = EngineEvent['type']

/** 입력 오류 하나 (R-1 "입력 오류", D-050) */
export interface EventProblem {
  /** 문제가 있는 필드 (이벤트 전체 문제면 null) */
  readonly field: string | null
  readonly message: string
}

// ── 효과 (R-13) ──────────────────────────────────────────────────────────

/** 엔진이 내놓는 "해야 할 일". 실행은 바깥(outbox)이 한다 */
export interface EngineEffect {
  /** `{찜ID}:{효과종류}:{대상}:{확정버전}` — 대상이 없는 효과(라벨)는 `-` */
  readonly id: string
  readonly kind: EffectKind
  /** POST_THANKS만 대상이 있다 */
  readonly target: ThanksTarget | null
  readonly claim: string
  /** 상품 키 `<방송>/<번호>` — 효과가 나온 때의 것 (VOID_LABEL은 폐기할 라벨의 것) */
  readonly product: string
  readonly broadcast: string
  readonly no: number
  /** 찜의 구매자 자신 */
  readonly buyer: string
  /** 감사 문구 (POST_THANKS만) */
  readonly text: string | null
  /** 그 상품의 몇 번째 확정인지(1부터). VOID_LABEL은 폐기할 라벨의 확정버전 */
  readonly confirmVersion: number
}

export interface ApplyResult {
  readonly state: EngineState
  /** 이 이벤트로 새로 나온 효과 (판정 순위·처리 순서) */
  readonly effects: readonly EngineEffect[]
}

// ── 상태 레코드 ──────────────────────────────────────────────────────────

/** 상품의 판매 단계. READY·HOLD·CLOSED는 방송자가 정하고, SELLING이면 확정 수로 OPEN/SOLD를 보인다 (R-2) */
export type ProductPhase = 'READY' | 'SELLING' | 'HOLD' | 'CLOSED'

/** 가격·품종 변경 이력 한 줄 (R-10). seq·at = 바꾼 이벤트 */
export interface PriceChange {
  readonly from: number
  readonly to: number
  readonly seq: number
  readonly at: number
}

export interface NameChange {
  readonly from: string
  readonly to: string
  readonly seq: number
  readonly at: number
}

export interface ProductRecord {
  /** 상품 ID (`p1`부터). 번호를 바꿔도 그대로다 (D-056) */
  readonly id: string
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly phase: ProductPhase
  readonly priceHistory: readonly PriceChange[]
  readonly nameHistory: readonly NameChange[]
}

/** 방송의 번호 하나 (상품이 아직 없어도 보류 찜이 있으면 생긴다) */
export interface SlotRecord {
  /** 상품 키 `<방송>/<번호>` */
  readonly key: string
  readonly b: string
  readonly no: number
  readonly product: ProductRecord | null
  /** 확정 찜 ID, 확정된 순서 (재고 이하) */
  readonly winners: readonly string[]
  /** 대기 찜 ID, 1순위부터 (대기 한도 이하) */
  readonly waitlist: readonly string[]
  /** 보류 찜 ID 집합. 판정 순위 순서는 볼 때 정렬한다 (보류 찜이 많아도 이벤트마다 목록을 복사하지 않게, AC-S03-05) */
  readonly pending: PMap<true>
  /** 지금의 구매자 ID → 그 구매자의 활성 찜(확정·대기·보류·충돌) ID. INV-2 때문에 구매자마다 하나 */
  readonly active: PMap<string>
  /** "승계 결정 필요" 표시 (cancel.succession=ASK, D-041) */
  readonly awaiting: boolean
  /** 충돌 찜 ID (상품마다 하나, R-7 7) */
  readonly conflict: string | null
  /** 지금 상품의 확정 횟수 = 마지막 확정버전 (R-13). 번호를 바꾸면 상품과 함께 옮긴다 */
  readonly version: number
}

export interface ClaimRecord {
  readonly id: string
  /** 생성 순서 (1부터) */
  readonly n: number
  /** 순위 재료 seq (R-6 "찜마다의 순위 재료") */
  readonly seq: number
  /** 보류 찜 유효 시간을 재는 시각 (R-5) — 메시지 변환이면 원래 메시지의 at */
  readonly at: number
  /** 순위 재료 실제 시각 (UTC 밀리초): 정확한 시각, 분 단위 문자는 구간 시작 */
  readonly time: number
  /** 분 단위 문자 (구간 [time, time + 1분)) */
  readonly minute: boolean
  readonly b: string
  readonly no: number
  /** 찜이 생긴 번호의 키 */
  readonly key: string
  /** 상품에 붙은 찜이면 그 상품 ID. 번호를 바꾸면 찜의 상품 키도 상품을 따라간다 (D-056) */
  readonly pid: string | null
  /** 구매자 자신 */
  readonly buyer: string
  readonly origin: ClaimOrigin
  /** 만든 채팅 메시지 키 (채팅·변환) */
  readonly message: string | null
  /** 문자찜 입력 ID와 원문 수신 시각 */
  readonly ref: string | null
  readonly received: string | null
  readonly status: ClaimStatus
  readonly reason: ClaimReason | null
  /** 가격 스냅샷 = 확정 시점 상품 가격 (확정된 적 없으면 null) */
  readonly price: number | null
  /** 지금(또는 마지막) 확정의 확정버전 */
  readonly version: number | null
  /** 지금 확정에 출력·게시 완료 보고나 host.confirm이 있는지 (R-7.3 — 입금 기록은 정산 묶음에서 본다) */
  readonly locked: boolean
  /** 처리 대기 중인 시청자 취소 요청을 받은 seq (없으면 null, D-043) */
  readonly request: number | null
  /** 이 찜의 효과 ID, 나온 순서 */
  readonly effects: readonly string[]
  /** 재출력 필요 (R-10, D-055) */
  readonly reprint: boolean
  /** 찜별 가격 이력 (UNPAID_CLAIMS로 스냅샷이 바뀐 때) */
  readonly priceHistory: readonly PriceChange[]
}

export interface BuyerRecord {
  /** 구매자 ID: 유튜브 = 채널 ID, 문자 구매자 = `sms:<처음 만든 ref>` */
  readonly id: string
  /** 처음 기록된 순서 (1부터) */
  readonly n: number
  readonly kind: BuyerKind
  /** 표시 이름: 유튜브 = 가장 최근 닉네임, 문자 = `문자찜` 또는 `문자찜(메모)` */
  readonly display: string
  /** 표시 이름이 바뀔 때마다 쌓은 목록 (처음 것 포함, 연속 중복 없음) */
  readonly names: readonly string[]
  /** 문자 구매자를 이은 휴대폰 번호 (숫자만). 조회 결과에는 뒤 4자리만 보인다 (R-11) */
  readonly phone: string | null
  /** 이 구매자가 합쳐진 구매자 (바로 위). 합쳐져 있지 않으면 null */
  readonly parent: string | null
  /** 이 구매자에 바로 합쳐진 구매자, 합친 순서 */
  readonly children: readonly string[]
  /** 이 구매자 자신의 찜 ID 집합 */
  readonly claims: PMap<true>
  /** 이 구매자 자신에게 적힌 정산 기록의 날짜, 처음 적힌 순서 */
  readonly dates: readonly string[]
  /** 자신의 확정 찜 가격 스냅샷의 합 (확정·해제·가격 변경 때마다 더하고 뺀다. INV-5가 찜 목록과 대조한다) */
  readonly subtotal: number
}

export interface EffectRecord {
  readonly id: string
  /** 나온 순서 (1부터) */
  readonly n: number
  /** 나온 이벤트의 seq */
  readonly seq: number
  readonly kind: EffectKind
  readonly target: ThanksTarget | null
  readonly claim: string
  readonly key: string
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly text: string | null
  readonly version: number
  readonly status: EffectStatus
}

/** 받은 채팅 메시지 (재수신 판단, 메시지 변환의 대상, D-054) */
export interface MessageRecord {
  readonly ch: string
  readonly seq: number
  readonly at: number
  readonly publishedAt: number
  /** 무시한 방송자 메시지 (claim.ignoreOwner) */
  readonly ignored: boolean
  /** 이 메시지가 찜을 만든 번호 (주문·변환) */
  readonly claimed: readonly number[]
}

/** 정산 기록 한 줄 (R-12) — 적힌 구매자 자신에 붙는다 */
export type SettlementEntry =
  | { readonly kind: 'shipping'; readonly mode: ShippingMode; readonly amount: number | null; readonly seq: number; readonly at: number }
  | { readonly kind: 'adjust'; readonly amount: number; readonly reason: string; readonly seq: number; readonly at: number }
  | { readonly kind: 'payment'; readonly amount: number; readonly memo: string | null; readonly seq: number; readonly at: number }
  | { readonly kind: 'refund'; readonly amount: number; readonly reason: string; readonly seq: number; readonly at: number }

/** (구매자 자신, 날짜)의 정산 기록 */
export interface LedgerRecord {
  readonly buyer: string
  readonly date: string
  /** 적힌 순서 */
  readonly entries: readonly SettlementEntry[]
}

export interface EngineState {
  /** 상태 형식 버전 (S03 = 2) */
  readonly format: 2
  /** 선언 순서 */
  readonly broadcasts: readonly BroadcastInfo[]
  /** 시작 설정 스냅샷 (DOMAIN_RULES 기본값 위에 덮어쓴 값) */
  readonly settings: SaleSettings
  readonly counters: { readonly claims: number; readonly effects: number; readonly buyers: number; readonly products: number }
  /** 이미 받은 채팅 메시지: JSON.stringify([방송, 메시지 ID]) → 메시지 */
  readonly messages: PMap<MessageRecord>
  /** 받은 문자찜 ref → 그 문자찜이 정한 구매자 자신 */
  readonly refs: PMap<string>
  /** 휴대폰 번호(숫자만) → 문자 구매자 */
  readonly phones: PMap<string>
  readonly buyers: PMap<BuyerRecord>
  /** 차단한 구매자 ID (엔진이 아직 모르는 채널도 차단할 수 있다) */
  readonly blocked: PMap<true>
  /** 상품 키 → 번호 */
  readonly slots: PMap<SlotRecord>
  /** 상품 ID → 지금의 상품 키 */
  readonly products: PMap<string>
  readonly claims: PMap<ClaimRecord>
  readonly effects: PMap<EffectRecord>
  /** JSON.stringify([구매자 자신, 날짜]) → 정산 기록 */
  readonly ledger: PMap<LedgerRecord>
}

// ── 조회 결과 ────────────────────────────────────────────────────────────

export interface PriceChangeInfo {
  readonly from: number
  readonly to: number
  readonly at: number
}

export interface NameChangeInfo {
  readonly from: string
  readonly to: string
  readonly at: number
}

export interface ProductInfo {
  readonly key: string
  /** 상품 ID (번호를 바꿔도 그대로) */
  readonly id: string
  readonly broadcast: string
  readonly no: number
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly status: ProductStatus
  /** 확정 찜의 지금의 구매자 ID, 확정된 순서 */
  readonly winners: readonly string[]
  readonly winnerClaims: readonly string[]
  /** 대기 찜의 지금의 구매자 ID, 1순위부터 */
  readonly waitlist: readonly string[]
  readonly waitlistClaims: readonly string[]
  /** 승계 결정 필요 (ASK) */
  readonly awaitingSuccession: boolean
  /** 충돌 표시 (R-7) */
  readonly conflict: boolean
  /** 충돌 찜 ID와 그 지금의 구매자 */
  readonly conflictClaim: string | null
  readonly conflictBuyer: string | null
  readonly priceHistory: readonly PriceChangeInfo[]
  readonly nameHistory: readonly NameChangeInfo[]
  /** 지금까지의 확정 횟수 */
  readonly confirmVersion: number
}

export interface ClaimInfo {
  readonly id: string
  /** 지금의 상품 키 (번호를 바꾸면 그 상품의 찜은 새 번호, 원래 번호에 남은 보류 찜은 원래 번호 — D-056) */
  readonly product: string
  readonly broadcast: string
  readonly no: number
  /** 구매자 자신 */
  readonly buyer: string
  /** 지금의 구매자 (합친 결과) */
  readonly currentBuyer: string
  readonly status: ClaimStatus
  readonly reason: ClaimReason | null
  readonly origin: ClaimOrigin
  /** 순위 재료: seq, 실제 시각(정확한 시각 또는 분 구간 시작), 분 단위 여부 */
  readonly seq: number
  readonly rankTime: number
  readonly rankMinute: boolean
  /** 문자찜 원문 수신 시각 */
  readonly received: string | null
  /** 보류 찜 유효 시간의 기준 시각 */
  readonly at: number
  readonly price: number | null
  readonly confirmVersion: number | null
  /** 잠금 (R-7.3: 출력·게시 보고, host.confirm, 입금 기록) — 확정 찜만 */
  readonly locked: boolean
  readonly cancelRequested: boolean
  /** 재출력 필요 (R-10) — 확정 찜만 */
  readonly reprintNeeded: boolean
  /** 찜별 가격 이력 (UNPAID_CLAIMS) */
  readonly priceHistory: readonly PriceChangeInfo[]
}

export interface PendingInfo {
  readonly product: string
  readonly broadcast: string
  readonly no: number
  /** 보류 찜의 지금의 구매자 ID, 판정 순위 순 */
  readonly buyers: readonly string[]
  readonly claims: readonly string[]
}

export interface BuyerInfo {
  readonly id: string
  readonly kind: BuyerKind
  /** 지금의 구매자 (합쳐져 있지 않으면 자기 자신) */
  readonly current: string
  /** 바로 위 (합쳐진 대상) */
  readonly mergedInto: string | null
  /** 이 구매자에 합쳐진 구매자 전부 (아래쪽 전부), 합친 순서 */
  readonly merged: readonly string[]
  /** 자신의 표시 이름과 이력 */
  readonly display: string
  readonly nameHistory: readonly string[]
  /** 문자 구매자의 휴대폰 번호 뒤 4자리 (전체 번호는 보이지 않는다, ORD-08 AC4) */
  readonly phoneLast4: string | null
  /** 확정 찜의 상품 키 — 자신과 합쳐진 구매자 전부 */
  readonly items: readonly string[]
  /** 확정 찜 가격 스냅샷의 합 — 자신과 합쳐진 구매자 전부 */
  readonly subtotal: number
  /** 방송별 합계 (확정이 있는 방송만) */
  readonly byBroadcast: Readonly<Record<string, number>>
  /** 이 구매자 자신의 차단 여부 */
  readonly blocked: boolean
}

export interface SettlementRecordInfo {
  readonly kind: SettlementEntry['kind']
  /** 기록이 적힌 구매자 자신 */
  readonly buyer: string
  readonly amount: number | null
  readonly mode: ShippingMode | null
  readonly reason: string | null
  readonly memo: string | null
  readonly seq: number
  readonly at: number
}

export interface SettlementInfo {
  /** 지금의 구매자 */
  readonly buyer: string
  /** 방송 날짜 YYYY-MM-DD */
  readonly date: string
  /** 품목 = 그 날짜 방송들의 확정 찜 상품 키 (합친 구매자 포함) */
  readonly items: readonly string[]
  readonly subtotal: number
  readonly shipping: number
  /** 적용 중인 배송비 예외 (없으면 null) */
  readonly shippingOverride: Exclude<ShippingMode, 'DEFAULT'> | null
  /** 조정 합계 (품목이 없으면 0으로 본다) */
  readonly adjustments: number
  readonly total: number
  /** 받은 금액 = 입금 합 − 환불 합 */
  readonly received: number
  /** 환불 필요 금액 (OVERPAID일 때 차액) */
  readonly refundDue: number
  readonly payment: PaymentStatus
  /** 정산 기록, 적힌 순서 */
  readonly records: readonly SettlementRecordInfo[]
}

export interface EffectInfo {
  readonly id: string
  readonly kind: EffectKind
  readonly target: ThanksTarget | null
  readonly claim: string
  /** 효과가 나온 때의 상품 키 */
  readonly product: string
  /** 찜의 구매자 자신 */
  readonly buyer: string
  /** 지금의 구매자 */
  readonly currentBuyer: string
  readonly text: string | null
  readonly confirmVersion: number
  readonly status: EffectStatus
}

export interface CancelRequestInfo {
  readonly product: string
  readonly buyer: string
  readonly currentBuyer: string
  readonly claim: string
  /** 요청을 받은 seq */
  readonly seq: number
}

export interface SmsRefInfo {
  readonly ref: string
  /** 그 문자찜이 정한 구매자 자신 */
  readonly buyer: string
  readonly currentBuyer: string
}

export interface InvariantViolation {
  /** `INV-1` 같은 불변식 ID */
  readonly id: string
  readonly message: string
}
