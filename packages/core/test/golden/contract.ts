// tests/golden/README.md 형식 계약을 코드로 옮긴 것 (D-021).
// 여기 없는 suite·이벤트 종류·필드·설정 키·expect 키·열거값은 읽기 오류다.
// 새 어휘는 spec-keeper가 README에 먼저 추가하고, 그다음 이 파일을 맞춘다.

export const SUITES = ['chat', 'amount', 'korean-number', 'quick-input'] as const
export type SuiteName = (typeof SUITES)[number]

/** suite별 settings 키 → DOMAIN_RULES 키 */
export const SUITE_SETTINGS: Readonly<Record<SuiteName, Readonly<Record<string, string>>>> = {
  chat: { parseMode: 'claim.parseMode', multiNumber: 'claim.multiNumber', maxNumber: 'claim.maxNumber' },
  amount: { unit: 'price.unit' },
  'korean-number': {},
  'quick-input': { unit: 'price.unit' },
}

export const QUICK_INPUT_ERRORS = ['PRICE_MISSING', 'NUMBER_MISSING', 'EMPTY', 'NUMBER_INVALID', 'PRICE_TOO_LOW'] as const

// ── 열거값 (README "열거값") ──────────────────────────────────────────────
export const PRODUCT_STATUSES = ['READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED'] as const
export const CLAIM_STATUSES = ['PENDING', 'CONFIRMED', 'WAITLISTED', 'REJECTED', 'CANCELLED', 'CONFLICT', 'DUPLICATE'] as const
export const REJECT_REASONS = [
  'BLOCKED',
  'UNOPENED',
  'NOT_ON_SALE',
  'SOLD_OUT',
  'EXPIRED',
  'WAITLIST_CLEARED',
  'BY_HOST',
  'RENUMBERED',
] as const
export const EFFECT_KINDS = ['PRINT_PRODUCT_LABEL', 'PRINT_PACKING_LABEL', 'POST_THANKS', 'VOID_LABEL', 'NOTIFY'] as const
export const TARGETS = ['LIVE_CHAT', 'VIDEO_COMMENT'] as const
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'] as const

export type ProductStatus = (typeof PRODUCT_STATUSES)[number]
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]
export type RejectReason = (typeof REJECT_REASONS)[number]
export type EffectKind = (typeof EFFECT_KINDS)[number]
export type Target = (typeof TARGETS)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

// ── 값 검사기 ────────────────────────────────────────────────────────────
/** 값 검사 결과: 통과면 undefined, 아니면 이유 */
export type ValueCheck = (value: unknown) => string | undefined

const show = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const intAtLeast =
  (min: number): ValueCheck =>
  (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? undefined : `${min} 이상 정수여야 한다 (값: ${show(value)})`

export const anyInt: ValueCheck = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? undefined : `정수여야 한다 (값: ${show(value)})`

export const bool: ValueCheck = (value) =>
  typeof value === 'boolean' ? undefined : `true 또는 false여야 한다 (값: ${show(value)})`

export const str: ValueCheck = (value) => (typeof value === 'string' ? undefined : `문자열이어야 한다 (값: ${show(value)})`)

export const nonEmptyStr: ValueCheck = (value) =>
  typeof value === 'string' && value.trim() !== '' ? undefined : `빈 문자열이 아닌 문자열이어야 한다 (값: ${show(value)})`

export const oneOf =
  (choices: readonly string[]): ValueCheck =>
  (value) =>
    typeof value === 'string' && choices.includes(value)
      ? undefined
      : `${choices.join(' / ')} 중 하나여야 한다 (값: ${show(value)})`

export const intOrNull =
  (min: number): ValueCheck =>
  (value) =>
    value === null ? undefined : intAtLeast(min)(value) === undefined ? undefined : `${min} 이상 정수 또는 null이어야 한다 (값: ${show(value)})`

export { show as showValue }

// ── 설정 키 (README "설정 키", DOMAIN_RULES 설정표) ──────────────────────
export const SETTING_CHECKS: Readonly<Record<string, ValueCheck>> = {
  'claim.parseMode': oneOf(['STRICT', 'LOOSE']),
  'claim.multiNumber': oneOf(['ALL', 'FIRST', 'IGNORE']),
  'claim.maxNumber': intAtLeast(1),
  'claim.ignoreOwner': bool,
  'claim.preOpenWindowSec': intAtLeast(0),
  'waitlist.max': intAtLeast(0),
  'cancel.buyerChat': oneOf(['OFF', 'REQUEST', 'AUTO']),
  'cancel.succession': oneOf(['AUTO', 'ASK', 'REOPEN']),
  'contention.policy': oneOf(['ARRIVAL', 'RECEIVED_TIME']),
  'contention.sameMinuteTieBreaker': oneOf(['YOUTUBE', 'SMS', 'HOST']),
  'price.unit': oneOf(['WON', 'THOUSAND']),
  'shipping.baseFee': intAtLeast(0),
  'shipping.freeThreshold': intOrNull(0),
  'settlement.groupBy': oneOf(['DATE', 'MANUAL']),
  'print.autoOnConfirm': bool,
  'thanks.liveChat': bool,
  'thanks.videoComment': oneOf(['OFF', 'PER_SALE', 'SUMMARY']),
  'thanks.batchWindowSec': intAtLeast(0),
}

// ── 이벤트 종류와 필드 (README "이벤트 종류와 필드") ─────────────────────
/** 필드 값의 종류. 참조형(방송·구매자·메시지)은 시나리오 문맥이 필요해 validate에서 검사한다. */
export type FieldKind =
  | { readonly kind: 'broadcast' }
  | { readonly kind: 'buyer' }
  | { readonly kind: 'channel' }
  | { readonly kind: 'message' }
  | { readonly kind: 'smsRef' }
  | { readonly kind: 'date' }
  | { readonly kind: 'received' }
  | { readonly kind: 'at' }
  | { readonly kind: 'value'; readonly check: ValueCheck }

const F = {
  b: { kind: 'broadcast' },
  buyer: { kind: 'buyer' },
  channel: { kind: 'channel' },
  message: { kind: 'message' },
  smsRef: { kind: 'smsRef' },
  date: { kind: 'date' },
  received: { kind: 'received' },
  at: { kind: 'at' },
  no: { kind: 'value', check: intAtLeast(1) },
  reason: { kind: 'value', check: nonEmptyStr },
  v: (check: ValueCheck): FieldKind => ({ kind: 'value', check }),
} as const

export interface EventSpec {
  readonly required: Readonly<Record<string, FieldKind>>
  readonly optional: Readonly<Record<string, FieldKind>>
  /** 방송 필드 b가 있는 이벤트인지 (없으면 짧은 at 제약을 받는다) */
  readonly hasBroadcast: boolean
}

const spec = (required: Record<string, FieldKind>, optional: Record<string, FieldKind> = {}): EventSpec => ({
  required,
  optional,
  hasBroadcast: 'b' in required,
})

const hostWithBuyer = spec({ b: F.b, no: F.no, buyer: F.buyer, reason: F.reason })
const hostConfirmLike = spec({ b: F.b, no: F.no, buyer: F.buyer }, { reason: F.reason })
const productByNo = spec({ b: F.b, no: F.no })
const blockLike = spec({ buyer: F.buyer, reason: F.reason })

export const EVENT_SPECS: Readonly<Record<string, EventSpec>> = {
  'product.register': spec(
    { b: F.b, no: F.no, name: F.v(str), price: F.v(intAtLeast(0)) },
    { stock: F.v(intAtLeast(1)), status: F.v(oneOf(['OPEN', 'READY'])) },
  ),
  'product.open': productByNo,
  'product.hold': productByNo,
  'product.close': productByNo,
  'product.update': spec(
    { b: F.b, no: F.no },
    { name: F.v(str), price: F.v(intAtLeast(0)), stock: F.v(intAtLeast(1)), applyTo: F.v(oneOf(['NEW_ONLY', 'UNPAID_CLAIMS'])) },
  ),
  'product.renumber': spec({ b: F.b, from: F.no, to: F.no }),
  chat: spec(
    { b: F.b, id: F.v(nonEmptyStr), ch: F.channel, nick: F.v(nonEmptyStr), text: F.v(str) },
    { owner: F.v(bool), publishedAt: F.at },
  ),
  sms: spec({ b: F.b, ref: F.smsRef, no: F.no, received: F.received }, { memo: F.v(str), phone: F.v(str), buyer: F.buyer }),
  'host.cancel': hostWithBuyer,
  'host.reject': hostWithBuyer,
  'host.promote': hostWithBuyer,
  'host.confirm': hostConfirmLike,
  'host.approveCancel': hostConfirmLike,
  'host.resolveConflict': spec({ b: F.b, no: F.no, decision: F.v(oneOf(['KEEP', 'SWITCH'])) }, { reason: F.reason }),
  'host.convertMessage': spec({ b: F.b, msg: F.message, no: F.no }, { reason: F.reason }),
  'host.blockBuyer': blockLike,
  'host.unblockBuyer': blockLike,
  'buyer.merge': spec({ from: F.buyer, into: F.buyer, reason: F.reason }),
  'buyer.unmerge': spec({ from: F.buyer, reason: F.reason }),
  'effect.labelPrinted': spec({ b: F.b, no: F.no, buyer: F.buyer }),
  'effect.thanksSent': spec({ b: F.b, no: F.no, buyer: F.buyer }, { target: F.v(oneOf(TARGETS)) }),
  'settlement.shippingOverride': spec(
    { buyer: F.buyer, date: F.date, mode: F.v(oneOf(['PICKUP', 'COMBINED', 'FIXED'])) },
    { amount: F.v(intAtLeast(0)) },
  ),
  'settlement.adjust': spec({ buyer: F.buyer, date: F.date, amount: F.v(anyInt), reason: F.reason }),
  'settlement.payment': spec({ buyer: F.buyer, date: F.date, amount: F.v(intAtLeast(1)) }, { memo: F.v(str) }),
  'settlement.refund': spec({ buyer: F.buyer, date: F.date, amount: F.v(intAtLeast(1)), reason: F.reason }),
}

// ── expect 키 (README "expect 비교 규칙", "추가 검사 키") ────────────────
export const EXPECT_KEYS = [
  'products',
  'buyers',
  'settlements',
  'effects',
  'effectCounts',
  'pendingEffects',
  'claims',
  'pending',
  'sameBuyer',
  'claimCount',
  'cancelRequests',
] as const
export const PRODUCT_EXPECT_KEYS = ['status', 'winner', 'winners', 'waitlist', 'conflict', 'exists', 'price', 'priceHistory'] as const
export const BUYER_EXPECT_KEYS = ['items', 'subtotal', 'byBroadcast', 'display', 'nameHistory'] as const
export const SETTLEMENT_EXPECT_KEYS = ['subtotal', 'shipping', 'adjustments', 'total', 'refundDue', 'payment'] as const
export const EFFECT_EXPECT_KEYS = ['kind', 'target', 'product', 'buyer', 'text', 'confirmVersion'] as const
export const CLAIM_EXPECT_KEYS = ['product', 'buyer', 'status', 'reason'] as const

/** 품목이 없는(엔진이 보고하지 않은) 정산 묶음 (README: 금액 전부 0, UNPAID) */
export const EMPTY_SETTLEMENT = {
  subtotal: 0,
  shipping: 0,
  adjustments: 0,
  total: 0,
  refundDue: 0,
  payment: 'UNPAID',
} as const

export const SCENARIO_ID_RE = /^G-ENG-\d{3}$/
export const BROADCAST_ID_RE = /^[^\s/@]+$/
export const PRODUCT_KEY_RE = /^([^\s/@]+)\/([1-9]\d*)$/
export const SMS_PREFIX = 'sms:'
/** 허용 목록 예약 파일 이름 (골든 폴더 바로 아래) */
export const ALLOWLIST_FILE = 'known-unimplemented.yaml'
