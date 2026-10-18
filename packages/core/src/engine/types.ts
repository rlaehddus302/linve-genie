// 판정 엔진의 공개 타입 (R-1 이벤트, 상태, 효과, 조회 결과). AC-S02-01.
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

export interface ChatEvent extends EventBase {
  readonly type: 'chat'
  readonly b: string
  /** 메시지 ID. 재수신은 (방송, 메시지 ID)로 판단한다 (D-045) */
  readonly id: string
  /** 채널 ID = 유튜브 구매자 ID */
  readonly ch: string
  readonly nick: string
  readonly text: string
  /** 방송자 본인 메시지 (기본 false) */
  readonly owner?: boolean
  /** 유튜브 게시 시각(UTC 밀리초). ARRIVAL 정책에선 기록만 한다 */
  readonly publishedAt?: number
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

export interface HostBlockEvent extends EventBase {
  readonly type: 'host.blockBuyer' | 'host.unblockBuyer'
  readonly buyer: string
  readonly reason: string
}

export interface EffectReportEvent extends EventBase {
  readonly type: 'effect.labelPrinted' | 'effect.thanksSent'
  /** 보고하는 효과의 ID (`{찜ID}:{효과종류}:{대상}:{확정버전}`) */
  readonly effectId: string
}

/** S03 이후에 구현하는 이벤트 (D-037). 엔진은 NotImplementedError를 던진다 */
export type DeferredEventType =
  | 'broadcast.start'
  | 'broadcast.end'
  | 'effect.failed'
  | 'sms'
  | 'product.update'
  | 'product.renumber'
  | 'host.convertMessage'
  | 'host.resolveConflict'
  | 'buyer.merge'
  | 'buyer.unmerge'
  | 'settlement.shippingOverride'
  | 'settlement.adjust'
  | 'settlement.payment'
  | 'settlement.refund'

export interface DeferredEvent extends EventBase {
  readonly type: DeferredEventType
  readonly [field: string]: unknown
}

export type EngineEvent =
  | ProductRegisterEvent
  | ProductCommandEvent
  | ChatEvent
  | HostClaimEvent
  | HostClaimOptionalReasonEvent
  | HostAssignEvent
  | HostReopenEvent
  | HostBlockEvent
  | EffectReportEvent
  | DeferredEvent

export type EngineEventType = EngineEvent['type']

// ── 효과 (R-13) ──────────────────────────────────────────────────────────

/** 엔진이 내놓는 "해야 할 일". 실행은 바깥(outbox)이 한다 */
export interface EngineEffect {
  /** `{찜ID}:{효과종류}:{대상}:{확정버전}` — 대상이 없는 효과(라벨)는 `-` */
  readonly id: string
  readonly kind: EffectKind
  /** POST_THANKS만 대상이 있다 */
  readonly target: ThanksTarget | null
  readonly claim: string
  /** 상품 키 `<방송>/<번호>` */
  readonly product: string
  readonly broadcast: string
  readonly no: number
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

export interface ProductRecord {
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly phase: ProductPhase
  /** 가격 변경 이력 (product.update는 S03 — S02에서는 항상 비어 있다) */
  readonly priceHistory: readonly { readonly from: number; readonly to: number }[]
}

/** 방송의 번호 하나 (상품이 아직 없어도 보류 찜이 있으면 생긴다) */
export interface SlotRecord {
  /** 상품 키 `<방송>/<번호>` */
  readonly key: string
  readonly b: string
  readonly no: number
  readonly product: ProductRecord | null
  /** 확정 찜 ID, 확정된 순서 */
  readonly winners: readonly string[]
  /** 대기 찜 ID, 1순위부터 */
  readonly waitlist: readonly string[]
  /** 보류 찜 ID, 판정 순위 순 */
  readonly pending: readonly string[]
  /** 구매자 ID → 그 구매자의 활성 찜(확정·대기·보류) ID. INV-2 때문에 구매자마다 하나 */
  readonly active: Readonly<Record<string, string>>
  /** "승계 결정 필요" 표시 (cancel.succession=ASK, D-041) */
  readonly awaiting: boolean
  /** 지금까지의 확정 횟수 = 마지막 확정버전 (R-13) */
  readonly version: number
}

export interface ClaimRecord {
  readonly id: string
  /** 생성 순서 (1부터) */
  readonly n: number
  /** 만든 이벤트의 seq (판정 순위) */
  readonly seq: number
  /** 만든 이벤트의 at (보류 찜 유효 시간 계산, R-5) */
  readonly at: number
  readonly b: string
  readonly no: number
  readonly key: string
  readonly buyer: string
  /** 채팅 주문 또는 방송자 직접 배정 */
  readonly origin: 'chat' | 'assign'
  readonly status: ClaimStatus
  readonly reason: ClaimReason | null
  /** 가격 스냅샷 = 확정 시점 상품 가격 (확정된 적 없으면 null) */
  readonly price: number | null
  /** 지금(또는 마지막) 확정의 확정버전 */
  readonly version: number | null
  /** 지금 확정에 잠금이 걸렸는지 (R-7.3: 출력·게시 보고, host.confirm) */
  readonly locked: boolean
  /** 처리 대기 중인 시청자 취소 요청을 받은 seq (없으면 null, D-043) */
  readonly request: number | null
  /** 이 찜의 효과 ID, 나온 순서 */
  readonly effects: readonly string[]
}

export interface BuyerRecord {
  /** 구매자 ID = 유튜브 채널 ID */
  readonly id: string
  /** 처음 기록된 순서 (1부터) */
  readonly n: number
  /** 표시 이름 = 가장 최근 닉네임 */
  readonly display: string
  /** 닉네임이 바뀔 때마다 쌓은 목록 (처음 것 포함, 연속 중복 없음) */
  readonly names: readonly string[]
  /** 이 구매자의 찜 ID, 생성 순서 */
  readonly claims: readonly string[]
  /** 확정 찜 가격 스냅샷의 합 (확정·확정 해제 때마다 더하고 뺀다. INV-5가 찜 목록과 대조한다) */
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

export interface EngineState {
  /** 상태 형식 버전 */
  readonly format: 1
  /** 선언 순서 */
  readonly broadcasts: readonly BroadcastInfo[]
  /** 시작 설정 스냅샷 (DOMAIN_RULES 기본값 위에 덮어쓴 값) */
  readonly settings: SaleSettings
  readonly counters: { readonly claims: number; readonly effects: number; readonly buyers: number }
  /** 이미 받은 채팅 메시지: JSON.stringify([방송, 메시지 ID]) */
  readonly messages: PMap<true>
  readonly buyers: PMap<BuyerRecord>
  /** 차단한 구매자 ID (엔진이 아직 모르는 채널도 차단할 수 있다) */
  readonly blocked: PMap<true>
  /** 상품 키 → 번호 */
  readonly slots: PMap<SlotRecord>
  readonly claims: PMap<ClaimRecord>
  readonly effects: PMap<EffectRecord>
}

// ── 조회 결과 ────────────────────────────────────────────────────────────

export interface ProductInfo {
  readonly key: string
  readonly broadcast: string
  readonly no: number
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly status: ProductStatus
  /** 확정 구매자 ID, 확정된 순서 */
  readonly winners: readonly string[]
  /** 대기 구매자 ID, 1순위부터 */
  readonly waitlist: readonly string[]
  /** 승계 결정 필요 (ASK) */
  readonly awaitingSuccession: boolean
  /** 충돌 표시 (R-7, S03 — S02에서는 항상 false) */
  readonly conflict: boolean
  readonly priceHistory: readonly { readonly from: number; readonly to: number }[]
  /** 지금까지의 확정 횟수 */
  readonly confirmVersion: number
}

export interface ClaimInfo {
  readonly id: string
  readonly product: string
  readonly broadcast: string
  readonly no: number
  readonly buyer: string
  readonly status: ClaimStatus
  readonly reason: ClaimReason | null
  readonly origin: 'chat' | 'assign'
  readonly seq: number
  readonly at: number
  readonly price: number | null
  readonly confirmVersion: number | null
  readonly locked: boolean
  readonly cancelRequested: boolean
}

export interface PendingInfo {
  readonly product: string
  readonly broadcast: string
  readonly no: number
  /** 보류 찜 구매자 ID, 판정 순위 순 */
  readonly buyers: readonly string[]
  readonly claims: readonly string[]
}

export interface BuyerInfo {
  readonly id: string
  readonly display: string
  readonly nameHistory: readonly string[]
  /** 확정 찜의 상품 키 */
  readonly items: readonly string[]
  /** 확정 찜 가격 스냅샷의 합 */
  readonly subtotal: number
  /** 방송별 합계 (확정이 있는 방송만) */
  readonly byBroadcast: Readonly<Record<string, number>>
  readonly blocked: boolean
}

export interface SettlementInfo {
  readonly buyer: string
  /** 방송 날짜 YYYY-MM-DD */
  readonly date: string
  /** 품목 = 그 날짜 방송들의 확정 찜 상품 키 */
  readonly items: readonly string[]
  readonly subtotal: number
  readonly shipping: number
  /** 조정 합계 (settlement.adjust는 S03 — S02에서는 0) */
  readonly adjustments: number
  readonly total: number
  /** 환불 필요 금액 (입금·환불은 S03 — S02에서는 0) */
  readonly refundDue: number
  readonly payment: PaymentStatus
}

export interface EffectInfo {
  readonly id: string
  readonly kind: EffectKind
  readonly target: ThanksTarget | null
  readonly claim: string
  readonly product: string
  readonly buyer: string
  readonly text: string | null
  readonly confirmVersion: number
  readonly status: EffectStatus
}

export interface CancelRequestInfo {
  readonly product: string
  readonly buyer: string
  readonly claim: string
  /** 요청을 받은 seq */
  readonly seq: number
}

export interface InvariantViolation {
  /** `INV-1` 같은 불변식 ID */
  readonly id: string
  readonly message: string
}
