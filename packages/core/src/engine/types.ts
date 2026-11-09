// 판정 엔진의 공개 타입 (R-1 이벤트, 상태, 효과, 조회 결과). AC-S02-01, AC-S03-01.
// 상태는 JSON으로 직렬화할 수 있는 순수 데이터다: 객체·배열·문자열·유한한 수·불리언·null만 쓴다(undefined 값 없음, AC-S02-02).
import type { OptionItem, OptionPick } from '../options.ts'
import type { SaleSettings, SettingsOverride } from '../settings.ts'
import type { PMap } from './pmap.ts'

// ── 열거값 (tests/golden/README "열거값") ────────────────────────────────

export type ClaimStatus = 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED' | 'CONFLICT' | 'DUPLICATE'
export type ClaimReason = 'BLOCKED' | 'UNOPENED' | 'NOT_ON_SALE' | 'SOLD_OUT' | 'EXPIRED' | 'WAITLIST_CLEARED' | 'BY_HOST' | 'RENUMBERED' | 'OPTION_MISSING' | 'STOCK_SHORT'
/** 확인 필요 사유 (R-20 5·7, R-19 "수량"·"공개 전 찜", O1) */
export type ReviewReason =
  | 'OPTION_MISSING'
  | 'OPTION_CONFLICT'
  | 'UNKNOWN_WORD'
  | 'QTY_INVALID'
  | 'NUMBER_AMBIGUOUS'
  | 'PRODUCT_AMBIGUOUS'
  | 'MULTI_PRODUCT'
  | 'FOCUS_CHANGED'
  | 'STOCK_SHORT'
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
  /** 엔진을 시작할 때 선언하는 방송 (서버는 빈 목록에서 시작해 broadcast.start로 선언한다, D-069·D-070) */
  readonly broadcasts: readonly BroadcastInfo[]
  /**
   * 시작 때 선언한 방송들의 설정 스냅샷 (DOMAIN_RULES 기본값 위에 덮어쓴다). broadcast.start로 선언한 방송에는 쓰지 않는다.
   * 범위 밖 값이면 initEngine이 TypeError를 던진다(checkSettings, D-071)
   */
  readonly settings: SettingsOverride
}

/** 지금 상품 (R-20 6, D-O-09·D-O1-06): 상품 ID(번호를 바꾸면 따라간다)와 정한 이벤트의 시각 */
export interface FocusRecord {
  readonly pid: string
  readonly at: number
}

/** 방송 기록 (선언 순서로 상태에 남는다, D-070) */
export interface BroadcastRecord extends BroadcastInfo {
  /** 설정 스냅샷 = DOMAIN_RULES 기본값 위에 덮어쓴 값. 판정은 그 방송의 스냅샷으로, 정산 설정은 그 날짜 첫 방송의 스냅샷으로 한다 */
  readonly settings: SaleSettings
  /** broadcast.end를 받은 시각(그 이벤트의 at, UTC 밀리초). 끝나지 않았으면 null */
  readonly endedAt: number | null
  /** 지금 상품 — 옵션 방송만 정한다(다른 방송은 늘 null) */
  readonly focus: FocusRecord | null
}

// ── 이벤트 (R-1, tests/golden/README "이벤트 종류와 필드") ────────────────
// 모든 이벤트는 type·seq·at과 그 종류의 필드만 가진다. 표에 없는 필드는 값과 상관없이 입력 오류다(D-073).
// 필드 이름은 골든 README와 같다(b = 방송 ID, no = 상품 번호, buyer = 구매자 ID). 효과 보고만 효과 ID로 가리킨다(R-13).
// 구매자 ID는 그 구매자 자신을 가리킨다. 판정·대상 찾기는 엔진이 지금의 구매자(합친 결과)로 한다(R-11, D-057).

interface EventBase {
  /** 서버 일련번호. 판정 순위(ARRIVAL)의 키 */
  readonly seq: number
  /** 서버 도착 시각, UTC 밀리초. 코어는 시계를 읽지 않는다 */
  readonly at: number
}

/**
 * 방송 시작 (R-1 "방송 시작·종료", D-070): 새 방송을 선언한다. 이미 선언한 방송이면 내용이 달라도 아무 일도 없다(재전송 사본, INV-3).
 * settings는 DOMAIN_RULES 기본값 위에 덮어쓸 값(설정값 범위 안, D-071). 서버는 모든 키를 적는다. settlement.groupBy=MANUAL이면 NotImplementedError
 */
export interface BroadcastStartEvent extends EventBase {
  readonly type: 'broadcast.start'
  /** 새 방송 ID (빈 문자열이 아닌 문자열) */
  readonly b: string
  /** 방송 날짜 YYYY-MM-DD (KST). 정산 묶음 날짜가 된다 */
  readonly date: string
  /** 회차(제목) */
  readonly title: string
  readonly settings?: SettingsOverride
}

/** 방송 종료 (R-1, D-070): 끝났다는 기록(끝난 시각 = at)만 남긴다. 판정·정산은 바뀌지 않는다. 이미 끝났으면 아무 일도 없다 */
export interface BroadcastEndEvent extends EventBase {
  readonly type: 'broadcast.end'
  readonly b: string
}

/**
 * 방송 중 감사 채팅 켜기·끄기 (D-YT-SRV-24): 그 방송의 설정 스냅샷에서 thanks.liveChat만 바꾼다. 그 뒤 확정부터 따른다 — 이미 낸 감사 효과는 그대로.
 * 값이 지금과 같으면 아무 일도 없다
 */
export interface BroadcastThanksEvent extends EventBase {
  readonly type: 'broadcast.thanks'
  readonly b: string
  readonly liveChat: boolean
}

export interface ProductRegisterEvent extends EventBase {
  readonly type: 'product.register'
  readonly b: string
  readonly no: number
  /** 품종 (빈 문자열 가능) */
  readonly name: string
  /** 정수 원, 0 이상 */
  readonly price: number
  /** 1 이상, 기본 1 — 옵션 상품이면 stocks에 적지 않은 변형마다의 재고 */
  readonly stock?: number
  /** 기본 OPEN */
  readonly status?: 'OPEN' | 'READY'
  /** 상품 별칭 0~10개 (옵션 방송만, R-19) */
  readonly aliases?: readonly string[]
  /** 옵션 항목 0~3개 (옵션 방송만, R-19) */
  readonly options?: readonly OptionItem[]
  /** 옵션 글 → 변형 재고(0 이상). 키는 그 상품의 변형이어야 한다 (옵션 방송만, D-O1-03) */
  readonly stocks?: Readonly<Record<string, number>>
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
  /** 옵션 방송만 (R-19 "옵션 바꾸기", D-O-14): 상품 별칭·바꾼 뒤의 옵션 전체·변형 재고 */
  readonly aliases?: readonly string[]
  readonly options?: readonly OptionItem[]
  readonly stocks?: Readonly<Record<string, number>>
}

/** 지금 상품 정하기 (R-20 6, D-O1-06 — 옵션 방송만) */
export interface ProductFocusEvent extends EventBase {
  readonly type: 'product.focus'
  readonly b: string
  readonly no: number
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

/**
 * 문자찜 (R-1, R-11, D-051, D-061). 전화번호 원문(`phone`)은 받지 않는다 — 있으면 입력 오류다.
 * 서버가 받은 번호를 normalizePhone으로 정규화해, 휴대폰 번호 모양이면 판매자마다 고정한 비밀 키의 HMAC으로 만든
 * 불투명 키(phoneKey)와 정규화한 번호의 뒤 4자리(phoneLast4)를 함께 담는다. 모양이 아니면 둘 다 담지 않는다.
 */
export interface SmsEvent extends EventBase {
  readonly type: 'sms'
  readonly b: string
  /**
   * 문자찜 입력 ID — 서버가 만든 무작위·일련 ID(영문·숫자·`_`·`-` 1~64자). 개인정보를 담지 않는다(문자 구매자 ID·효과에 들어간다).
   * 처음 받을 때 기록하고, 같은 ref가 다시 오면 내용이 달라도 아무 일도 없다 (D-067)
   */
  readonly ref: string
  readonly no: number
  /** 실제 수신 시각 `HH:MM` 또는 `HH:MM:SS` (KST). 날짜는 at에 가장 가까운 날 (D-023) */
  readonly received: string
  readonly memo?: string
  /** 전화번호 키: 영문·숫자·`_`·`-` 16~128자. phoneLast4와 함께 온다 */
  readonly phoneKey?: string
  /** 정규화한 휴대폰 번호의 뒤 4자리 (숫자 4자리). phoneKey와 함께 온다 */
  readonly phoneLast4?: string
  /** 지정 구매자 ID */
  readonly buyer?: string
  /** 수량 1~claim.maxQuantity (옵션 방송만, 기본 1) */
  readonly qty?: number
  /** 고른 옵션 — 상품이 있으면 모든 항목, 없으면 쓰지 않는다 (옵션 방송만) */
  readonly options?: OptionPick
}

export interface HostClaimEvent extends EventBase {
  readonly type: 'host.cancel' | 'host.reject' | 'host.promote'
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly reason: string
  /** 옵션 상품의 변형 고르기 (옵션 방송만, R-19 "수량" 방송자 조치) */
  readonly options?: OptionPick
}

export interface HostClaimOptionalReasonEvent extends EventBase {
  readonly type: 'host.confirm' | 'host.approveCancel' | 'host.dismissCancel'
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly reason?: string
  readonly options?: OptionPick
}

export interface HostAssignEvent extends EventBase {
  readonly type: 'host.assign'
  readonly b: string
  readonly no: number
  readonly buyer: string
  readonly reason: string
  /** 교체할 지금 1등의 구매자 ID. replaceTo와 함께 쓴다 (한쪽만 있으면 입력 오류, D-065) */
  readonly replace?: string
  readonly replaceTo?: 'WAITLIST' | 'CANCEL'
  /** 수량 1~claim.maxQuantity (옵션 방송만, 기본 1) */
  readonly qty?: number
  /** 옵션 상품이면 모든 항목 (옵션 방송만) */
  readonly options?: OptionPick
}

export interface HostReopenEvent extends EventBase {
  readonly type: 'host.reopen'
  readonly b: string
  readonly no: number
  readonly reason: string
  /** 옵션 상품이면 다시 열 변형 (옵션 방송만) */
  readonly options?: OptionPick
}

/** 확인 필요 바로잡기 (R-20 7, D-O-10·D-O1-04 — 옵션 방송만): 원래 메시지(입력)의 순위로 판정, 1등을 밀어내지 않는다 */
export interface HostResolveReviewEvent extends EventBase {
  readonly type: 'host.resolveReview'
  readonly b: string
  /** 확인 필요 항목의 출처 — 메시지 ID 또는 `sms:<ref>` */
  readonly item: string
  readonly no: number
  /** 1~claim.maxQuantity */
  readonly qty: number
  /** 옵션 상품이면 모든 항목, 아니면 쓰지 않는다 */
  readonly options?: OptionPick
  readonly reason?: string
}

/** 확인 필요 지우기 (R-20 7 — 옵션 방송만): 주문이 아닌 것으로 정한다 */
export interface HostDismissReviewEvent extends EventBase {
  readonly type: 'host.dismissReview'
  readonly b: string
  readonly item: string
  readonly reason?: string
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

/** 처음 쓰는 스프린트가 따로 있는 R-1 이벤트 (S11). 엔진은 NotImplementedError를 던진다 */
export type DeferredEventType = 'effect.failed'

export interface DeferredEvent extends EventBase {
  readonly type: DeferredEventType
  readonly [field: string]: unknown
}

export type EngineEvent =
  | BroadcastStartEvent
  | BroadcastEndEvent
  | BroadcastThanksEvent
  | ProductRegisterEvent
  | ProductCommandEvent
  | ProductUpdateEvent
  | ProductRenumberEvent
  | ProductFocusEvent
  | ChatEvent
  | SmsEvent
  | HostClaimEvent
  | HostClaimOptionalReasonEvent
  | HostAssignEvent
  | HostReopenEvent
  | HostResolveConflictEvent
  | HostConvertMessageEvent
  | HostResolveReviewEvent
  | HostDismissReviewEvent
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
  /**
   * 판매자가 적는 칸의 휴대폰 번호 문제(R-1, D-079·D-080 — checkEvent만 돌려준다)일 때만 'PHONE_NUMBER'. 그 밖의 문제에는 없다.
   * 서버가 거절 안내(D-079 ⑥)를 값을 다시 보지 않고 이 표시로 정한다(AC-S04-22)
   */
  readonly code?: 'PHONE_NUMBER'
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

/** 변형 하나의 재고 (R-19 "변형과 재고 단위") */
export interface VariantStock {
  /** 옵션 글 (`흰색/대형`) */
  readonly text: string
  /** 0 이상 — 0이면 처음부터 다 팔린 것과 같다 */
  readonly stock: number
}

export interface ProductRecord {
  /** 상품 ID (`p1`부터). 번호를 바꿔도 그대로다 (D-056) */
  readonly id: string
  readonly name: string
  readonly price: number
  /** 옵션 없는 상품의 재고(1 이상). 옵션 상품이면 변형 재고를 정할 때의 기본값(stocks에 적지 않은 변형) */
  readonly stock: number
  readonly phase: ProductPhase
  readonly priceHistory: readonly PriceChange[]
  readonly nameHistory: readonly NameChange[]
  /** 상품 별칭 (R-19, 옵션 방송) */
  readonly aliases: readonly string[]
  /** 옵션 항목 (없으면 빈 목록 — 변형은 상품 자신 하나) */
  readonly options: readonly OptionItem[]
  /** 변형마다의 재고, 항목 순서·선택지 순서 (옵션이 없으면 빈 목록) */
  readonly variants: readonly VariantStock[]
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
  /** 지금 상품의 확정 횟수 = 마지막 확정버전 (R-13). 번호를 바꾸면 상품과 함께 옮긴다. 옵션 상품도 상품마다 센다 */
  readonly version: number
  /** 옵션 상품의 변형마다의 판정 자리 (확정·대기·승계 결정 필요·충돌). 옵션이 없으면 빈 목록 — 위 winners·waitlist가 그 자리다 */
  readonly units: readonly UnitRecord[]
  /** 변형을 가진 찜의 활성 표시: JSON.stringify([지금의 구매자, 옵션 글]) → 찜 ID (INV-2는 변형마다) */
  readonly variantActive: PMap<string>
  /** 변형을 정하지 않은 시청자 취소 요청 (그 채널이 변형 찜을 둘 이상 가질 때, R-20 8). 요청 순서 */
  readonly requests: readonly CancelRequestRecord[]
}

/** 옵션 상품의 변형 하나의 판정 자리 (R-19 "판정 단위는 변형이다") */
export interface UnitRecord {
  /** 옵션 글 */
  readonly text: string
  /** 확정 찜 ID, 확정된 순서 */
  readonly winners: readonly string[]
  /** 대기 찜 ID, 1순위부터 (모두 수량 1 — INV-O1) */
  readonly waitlist: readonly string[]
  readonly awaiting: boolean
  readonly conflict: string | null
}

/** 변형을 정하지 않은 시청자 취소 요청 */
export interface CancelRequestRecord {
  /** 요청한 채널 (구매자 자신) */
  readonly buyer: string
  readonly seq: number
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
  /** 수량 (1 이상, 옵션 방송만 1이 아닐 수 있다 — R-19 "수량"). 찜 금액 = price × qty */
  readonly qty: number
  /** 수량을 댓글·입력에 적었는지 (확인 필요 항목의 읽은 것, D-O1-08) */
  readonly qtyWritten: boolean
  /** 옵션 글 — 옵션을 가진 찜만 (없으면 null: 옵션 없는 상품, 번호만 쓴 보류 찜, D-O1-02) */
  readonly variant: string | null
  /** 고른 옵션 `[항목 이름, label]`, 항목 순서 (variant와 함께) */
  readonly options: readonly (readonly [string, string])[] | null
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
  /** 이 문자 구매자를 만든 문자찜의 전화번호 뒤 4자리 (없으면 null). 전화번호 원문·정규화한 번호는 엔진에 없다 (D-061) */
  readonly phoneLast4: string | null
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

/** 받은 채팅 메시지 (재수신 판단, 메시지 변환의 대상, D-054·D-062) */
export interface MessageRecord {
  readonly ch: string
  readonly seq: number
  readonly at: number
  readonly publishedAt: number
  /** 무시한 방송자 메시지 (claim.ignoreOwner) */
  readonly ignored: boolean
  /** 주문이었던 메시지: 받을 때 R-3이 주문 번호를 하나라도 읽었다 (찜을 만들었든 아니든). 어느 번호로도 변환하지 않는다 (D-062) */
  readonly order: boolean
  /** 취소였던 메시지: 받을 때 R-3이 취소 번호를 하나라도 읽었다 (처리·요청·무시와 상관없이). 어느 번호로도 변환하지 않는다 (D-076) */
  readonly cancel: boolean
  /** 주문도 취소도 아니었던 메시지를 찜으로 바꾼 번호 (번호마다 한 번) */
  readonly converted: readonly number[]
  /** 받을 때 확인 필요 항목이 된 메시지 (옵션 방송, R-20 7). 메시지 변환을 하지 않는다 (D-O1-07) */
  readonly review: boolean
}

/** 확인 필요 항목 (R-20 7, D-O-10·D-O1-08·D-O1-10) — 찜이 아니다(재고·합계·효과에 들어가지 않는다, INV-O2) */
export interface ReviewRecord {
  readonly b: string
  /** 출처 — 메시지 ID 또는 `sms:<ref>` */
  readonly item: string
  /** 구매자 자신 */
  readonly buyer: string
  readonly reason: ReviewReason
  /** 읽은 번호 (못 읽었으면 null) */
  readonly no: number | null
  /** 읽은 번호의 상품 ID (그때 있던 상품 — 번호를 바꾸면 따라간다) */
  readonly pid: string | null
  /** 읽은 옵션 `[항목 이름, label]` (읽은 항목만, 없으면 null) */
  readonly options: readonly (readonly [string, string])[] | null
  /** 읽은 수량 (안 썼으면 null) */
  readonly qty: number | null
  /** 원래 순위 재료 (출처 입력의 seq·at·실제 시각) */
  readonly seq: number
  readonly at: number
  readonly time: number
  readonly minute: boolean
  /** 출처 입력: chat이면 메시지 키, sms면 ref와 원문 수신 시각 */
  readonly origin: 'chat' | 'sms'
  readonly message: string | null
  readonly ref: string | null
  readonly received: string | null
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
  /**
   * 상태 형식 번호 (S03 = 2, S03b = 3, S04 = 4: 방송마다 설정 스냅샷·끝난 시각, 시작 설정 칸 없앰, 취소 메시지 표시,
   * O1 = 5: 옵션·변형·수량·확인 필요·지금 상품). applyEvent·checkEvent는 다른 형식을 받으면 StateFormatError를 던진다(D-072).
   * 형식 4의 상태는 upgradeState로 5로 바꿔 이어 쓸 수 있다
   */
  readonly format: 5
  /** 방송 기록, 선언 순서 (시작 때 선언한 방송 → broadcast.start 순) */
  readonly broadcasts: readonly BroadcastRecord[]
  readonly counters: { readonly claims: number; readonly effects: number; readonly buyers: number; readonly products: number }
  /** 이미 받은 채팅 메시지: JSON.stringify([방송, 메시지 ID]) → 메시지 */
  readonly messages: PMap<MessageRecord>
  /** 받은 문자찜 ref → 그 문자찜이 정한 구매자 자신 (모르는 지정 구매자라 구매자를 정하지 않았으면 null, D-067) */
  readonly refs: PMap<string | null>
  /** 전화번호 키(서버가 만든 불투명 키) → 그 키로 만든 문자 구매자 (D-061) */
  readonly phoneKeys: PMap<string>
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
  /** JSON.stringify([방송, 출처]) → 확인 필요 항목 (O1, R-20 7) */
  readonly reviews: PMap<ReviewRecord>
}

// ── 조회 결과 ────────────────────────────────────────────────────────────

/** 방송 조회 (listBroadcasts·getBroadcast, D-070) */
export interface BroadcastDetails {
  readonly id: string
  readonly date: string
  readonly title: string
  /** broadcast.end를 받았는지 */
  readonly ended: boolean
  /** 끝난 시각 (UTC 밀리초, 끝나지 않았으면 null) */
  readonly endedAt: number | null
  /** 그 방송의 설정 스냅샷 (모든 키) */
  readonly settings: SaleSettings
  /** 지금 상품 (옵션 방송, R-20 6). 없으면 null */
  readonly focus: FocusInfo | null
}

/** 지금 상품 조회 */
export interface FocusInfo {
  /** 지금의 상품 키 (번호를 바꾸면 따라간다) */
  readonly product: string
  readonly no: number
  readonly productId: string
  /** 정한 이벤트의 시각 (UTC 밀리초) — 채팅 at과의 차이가 15초 미만이면 이름 없는 옵션 댓글은 확인 필요 */
  readonly at: number
}

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
  /** 상품 별칭 (옵션 방송) */
  readonly aliases: readonly string[]
  /** 옵션 항목 (없으면 빈 목록). 옵션 상품의 1등·대기·충돌은 variants에만 있다 — winners·waitlist는 빈 목록 (D-O1-01) */
  readonly options: readonly OptionItem[]
  /** 옵션 항목이 있는지 */
  readonly hasOptions: boolean
  /** 모든 변형의 확정 수량 합 (옵션 없는 상품은 확정 찜 수량의 합) */
  readonly confirmedUnits: number
  /** 변형, 항목 순서·선택지 순서 (옵션이 없으면 빈 목록) */
  readonly variants: readonly VariantInfo[]
}

/** 변형 하나 (R-19 "변형과 재고 단위", D-O1-01) */
export interface VariantInfo {
  /** 변형 키 `<방송>/<번호>#<옵션 글>` */
  readonly key: string
  /** 옵션 글 `흰색/대형` */
  readonly text: string
  /** 고른 옵션 `[항목 이름, label]`, 항목 순서 */
  readonly options: readonly (readonly [string, string])[]
  /** 판매 중이면 확정 수량 = 재고일 때 SOLD, 아니면 OPEN. 판매 중이 아니면 상품 상태 */
  readonly status: ProductStatus
  readonly stock: number
  readonly confirmedUnits: number
  /** 남은 수량 = 재고 − 확정 수량 */
  readonly remaining: number
  /** 단가 = 상품 가격 + 가격 차이 합 */
  readonly price: number
  readonly winners: readonly string[]
  readonly winnerClaims: readonly string[]
  readonly waitlist: readonly string[]
  readonly waitlistClaims: readonly string[]
  readonly awaitingSuccession: boolean
  readonly conflict: boolean
}

export interface ClaimInfo {
  readonly id: string
  /** 지금의 상품 키 (번호를 바꾸면 그 상품의 찜은 새 번호, 원래 번호에 남은 보류 찜은 원래 번호 — D-056) */
  readonly product: string
  /** 판정받은 상품의 ID (아직 보류 중이거나 상품 없이 거절됐으면 null) */
  readonly productId: string | null
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
  /** 찜의 키: 옵션을 가진 찜은 변형 키, 아니면 상품 키 (D-O1-02) */
  readonly key: string
  /** 수량 (옵션 방송만 1이 아닐 수 있다) */
  readonly qty: number
  /** 옵션 글 (옵션을 가진 찜만, 아니면 null) */
  readonly variant: string | null
  /** 고른 옵션 `[항목 이름, label]` (옵션을 가진 찜만) */
  readonly options: readonly (readonly [string, string])[] | null
  /** 찜 금액 = 단가 스냅샷 × 수량 (확정된 적 없으면 null) */
  readonly amount: number | null
}

/** 확인 필요 항목 조회 (R-20 7, listReviews) — 원래 순위(출처 입력의 도착 순서) */
export interface ReviewInfo {
  readonly broadcast: string
  /** 출처 — 메시지 ID 또는 `sms:<ref>` */
  readonly item: string
  /** 구매자 자신 */
  readonly buyer: string
  /** 지금의 구매자 */
  readonly currentBuyer: string
  readonly reason: ReviewReason
  /** 읽은 번호의 지금 상품 키 (읽은 번호가 없으면 null) */
  readonly product: string | null
  readonly no: number | null
  /** 읽은 옵션 `[항목 이름, label]` (읽은 항목만) */
  readonly options: readonly (readonly [string, string])[] | null
  /** 읽은 수량 */
  readonly qty: number | null
  /** 원래 순위 재료 seq·at */
  readonly seq: number
  readonly at: number
  /** 출처 입력 종류 */
  readonly origin: 'chat' | 'sms'
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
  /** 이 구매자 자신의 전화번호 뒤 4자리 — 그 구매자를 만든 문자찜의 것 (유튜브 구매자·전화번호 없이 만든 문자 구매자는 null, ORD-08 AC4) */
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
  /** 찜의 키 (변형을 정하지 않은 요청이면 상품 키 — R-20 8, D-O1-02) */
  readonly product: string
  readonly buyer: string
  readonly currentBuyer: string
  /**
   * 요청이 걸린 찜 ID. 변형을 정하지 않은 요청(그 채널의 변형 찜이 둘 이상, R-20 8)이면 찜이 하나로 정해지지 않아
   * 요청 하나를 가리키는 키 `request:<상품 키>:<구매자 자신>`이다 — 판매자가 choices 중 변형을 골라(options) 승인·무시한다
   */
  readonly claim: string
  /** 변형을 정하지 않은 요청인지 */
  readonly chooseVariant: boolean
  /** 변형을 정하지 않은 요청이면 그 채널 자신의 그 상품 활성 찜 ID(생성 순서), 아니면 [claim] */
  readonly choices: readonly string[]
  /** 요청을 받은 seq */
  readonly seq: number
}

/** 받은 채팅 메시지 조회 (listMessages, D-086) — 본문·닉네임은 없다 */
export interface MessageInfo {
  /** 방송 ID */
  readonly broadcast: string
  /** 메시지 ID */
  readonly id: string
  /** 채널 ID */
  readonly channel: string
  /** 받은 이벤트의 seq */
  readonly seq: number
  /** 받은 시각 (그 이벤트의 at, UTC 밀리초) */
  readonly at: number
  /** 게시 시각 (UTC 밀리초 — 이벤트에 없었으면 at) */
  readonly publishedAt: number
  /** 무시한 방송자 메시지 (claim.ignoreOwner) */
  readonly ignored: boolean
  /** 주문이었던 메시지 (D-062) */
  readonly order: boolean
  /** 취소였던 메시지 (D-076) */
  readonly cancel: boolean
  /** 찜으로 바꾼 번호, 바꾼 순서 */
  readonly converted: readonly number[]
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

// ── 합치기 미리 보기 (R-11 "미리 보기", BUY-03, D-100) ──────────────────

/**
 * buyer.merge가 아무 일도 하지 않는 이유. 위에서부터 처음 맞는 것:
 * 둘 중 하나를 엔진이 모름 → 같은 구매자 → from이 이미 다른 구매자에 합쳐져 있음 → into의 지금의 구매자가 from(고리) → 확정 찜이 둘이 되는 상품
 */
export type MergeBlockReason = 'UNKNOWN_BUYER' | 'SAME_BUYER' | 'FROM_MERGED' | 'CYCLE' | 'BOTH_CONFIRMED'

/** 합치면 DUPLICATE가 될 찜 하나 */
export interface MergeDuplicate {
  /** DUPLICATE가 될 찜 ID */
  readonly claim: string
  /** 지금의 상품 키 */
  readonly product: string
  /** 그 찜의 구매자 자신 (지금의 구매자가 아니다) */
  readonly buyer: string
  /** 지금 상태 — 확정 찜은 DUPLICATE가 되지 않는다 */
  readonly status: 'CONFLICT' | 'WAITLISTED' | 'PENDING'
  /** 그 상품에 남는 찜 ID (R-11 "앞선 쪽": 확정 > 충돌 > 대기 앞 순번 > 보류 판정 순위 — 방향과 상관없다) */
  readonly keep: string
}

/** 확정 찜의 상품 키와 가격 스냅샷 합 */
export interface MergeItems {
  /** 확정 찜의 상품 키, 찜 생성 순서 (getBuyer·listBuyers의 items와 같은 순서) */
  readonly items: readonly string[]
  readonly subtotal: number
}

/**
 * previewMerge(state, from, into)의 결과 — buyer.merge(from, into)를 지금 상태에 적용하면 일어날 일.
 * 막히지 않으면(blocked = null) applyEvent의 결과와 같다: DUPLICATE가 되는 찜 = duplicates의 claim, 그 뒤 getBuyer(target)의 items·subtotal = after.
 */
export interface MergePreview {
  /** 넘긴 그대로 (구매자 자신의 ID) */
  readonly from: string
  readonly into: string
  /** null = 합칠 수 있다 */
  readonly blocked: MergeBlockReason | null
  /** 합친 뒤의 지금의 구매자 = into의 지금의 구매자 (into를 모르면 null) */
  readonly target: string | null
  /** from 쪽(from과 그 아래 전부)과 target 쪽이 모두 확정 찜을 가진 상품 키, 방송 선언 순서·번호 순. blocked가 BOTH_CONFIRMED가 아니면 빈 목록 */
  readonly bothConfirmed: readonly string[]
  /** 옮길 쪽: from과 그 아래 합쳐 있던 구매자 전부의 ID(from 먼저)와 그 확정 찜. 모르는 구매자면 빈 목록·0 */
  readonly moving: MergeItems & { readonly buyers: readonly string[] }
  /** 합친 뒤 target의 확정 찜. 막히면 null */
  readonly after: MergeItems | null
  /** 합치면 DUPLICATE가 될 찜, 상품 키(방송 선언 순서·번호) 순. 막히면 빈 목록 */
  readonly duplicates: readonly MergeDuplicate[]
}
