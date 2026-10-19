// tests/golden/README.md 형식 계약을 코드로 옮긴 것 (D-021).
// 여기 없는 suite·이벤트 종류·필드·설정 키·expect 키·열거값은 읽기 오류다.
// 새 어휘는 spec-keeper가 README에 먼저 추가하고, 그다음 이 파일을 맞춘다.

import { containsPhoneRun, looksLikePhoneId } from '@livejjim/core'
import { YamlFloat } from './yaml.ts'

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
  if (value instanceof YamlFloat) return `${value.source} (YAML 실수 표기)`
  try {
    return JSON.stringify(value, (_key, inner: unknown) => (inner instanceof YamlFloat ? `${inner.source} (YAML 실수 표기)` : inner)) ?? String(value)
  } catch {
    return String(value)
  }
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 실수 표기를 정수 자리에 썼을 때 덧붙이는 안내 */
const floatHint = (value: unknown): string =>
  value instanceof YamlFloat ? ' — 금액·번호·개수는 정수로만 적는다. 천 단위 구분 점·소수점·지수 표기는 쓸 수 없다' : ''

export const intAtLeast =
  (min: number): ValueCheck =>
  (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min
      ? undefined
      : `${min} 이상 정수여야 한다 (값: ${show(value)})${floatHint(value)}`

export const anyInt: ValueCheck = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? undefined : `정수여야 한다 (값: ${show(value)})${floatHint(value)}`

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

/** 구매자 전화번호 뒤 4자리: 숫자 4자리 문자열 또는 null. 따옴표 없이 적어 정수가 된 값은 읽기 오류 (README 추가 검사 키, D-061) */
export const phoneLast4OrNull: ValueCheck = (value) =>
  value === null || (typeof value === 'string' && /^[0-9]{4}$/.test(value))
    ? undefined
    : `숫자 4자리 문자열(따옴표로 적는다, 예: "0000") 또는 null이어야 한다 (값: ${show(value)})`

/** 정수 min~max (설정값 범위, D-071) */
export const intRange =
  (min: number, max: number): ValueCheck =>
  (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
      ? undefined
      : `${min} 이상 ${max} 이하 정수여야 한다 (값: ${show(value)})${floatHint(value)}`

/** null 또는 정수 min~max (설정값 범위, D-071) */
export const intRangeOrNull =
  (min: number, max: number): ValueCheck =>
  (value) =>
    value === null || intRange(min, max)(value) === undefined
      ? undefined
      : `${min} 이상 ${max} 이하 정수 또는 null이어야 한다 (값: ${show(value)})${floatHint(value)}`

// ── 판매자가 적는 칸의 휴대폰 번호 (README 이벤트 표 아래 같은 이름의 문단, S04 마무리 D-079·D-080) ──
// 골든은 서버가 기록 전 검사(checkEvent)를 통과시킨 로그만 적는다. 엔진의 기록 전 검사와 같은 코어 함수라 "읽기 오류 = 엔진 입력 오류"가 어긋나지 않는다.
// 글의 숫자를 전부 모아 번호 모양을 보는 판단(normalizePhone을 글 전체에)은 쓰지 않는다.

/** 문자찜 ref·memo의 휴대폰 번호 = 코어 containsPhoneRun (README sms 행) — 번호는 phone에만 */
export const notPhoneShaped: ValueCheck = (value) =>
  typeof value === 'string' && containsPhoneRun(value) ? `휴대폰 번호가 들어 있다 — 번호는 phone에만 적는다 (값: ${show(value)})` : undefined

/** 판매자가 적는 다른 글 칸(입금 메모·사유·방송 제목·상품 이름)의 휴대폰 번호 = 코어 containsPhoneRun */
export const noPhoneInText: ValueCheck = (value) =>
  typeof value === 'string' && containsPhoneRun(value) ? `휴대폰 번호가 들어 있다 — 판매자가 적는 글 칸에는 전화번호를 적지 않는다 (값: ${show(value)})` : undefined

/** 판매자가 적는 ID 칸(buyer·from·into·replace·msg — 효과 보고의 buyer는 빼고)의 휴대폰 번호 = 코어 looksLikePhoneId */
export const notPhoneId: ValueCheck = (value) =>
  typeof value === 'string' && looksLikePhoneId(value) ? `휴대폰 번호로 된 키다 — 판매자가 적는 구매자·메시지 ID 칸에는 전화번호를 적지 않는다 (값: ${show(value)})` : undefined

/** 문자열이고 휴대폰 번호가 없는 글 (입금 메모·방송 제목·상품 이름) */
const freeText: ValueCheck = (value) => str(value) ?? noPhoneInText(value)

export { show as showValue }

// ── 설정 키 (README "설정 키", DOMAIN_RULES 설정표·"설정값 범위" D-071) ────
// 코어 checkSettings를 쓰지 않고 README대로 따로 적는다 — 러너가 코어의 검사를 그대로 따라 하면 코어가 틀려도 잡지 못한다.
export const SETTING_CHECKS: Readonly<Record<string, ValueCheck>> = {
  'claim.parseMode': oneOf(['STRICT', 'LOOSE']),
  'claim.multiNumber': oneOf(['ALL', 'FIRST', 'IGNORE']),
  'claim.maxNumber': intRange(1, 9999),
  'claim.ignoreOwner': bool,
  'claim.preOpenWindowSec': intRange(0, 300),
  'waitlist.max': intRange(0, 100),
  'cancel.buyerChat': oneOf(['OFF', 'REQUEST', 'AUTO']),
  'cancel.succession': oneOf(['AUTO', 'ASK', 'REOPEN']),
  'contention.policy': oneOf(['ARRIVAL', 'RECEIVED_TIME']),
  'contention.sameMinuteTieBreaker': oneOf(['YOUTUBE', 'SMS', 'HOST']),
  'price.unit': oneOf(['WON', 'THOUSAND']),
  'shipping.baseFee': intRange(0, 1_000_000),
  'shipping.freeThreshold': intRangeOrNull(0, 100_000_000),
  'settlement.groupBy': oneOf(['DATE', 'MANUAL']),
  'print.autoOnConfirm': bool,
  'thanks.liveChat': bool,
  'thanks.videoComment': oneOf(['OFF', 'PER_SALE', 'SUMMARY']),
  'thanks.batchWindowSec': intRange(0, 600),
}

// ── 이벤트 종류와 필드 (README "이벤트 종류와 필드") ─────────────────────
/** 필드 값의 종류. 참조형(방송·구매자·메시지)은 시나리오 문맥이 필요해 validate에서 검사한다. */
export type FieldKind =
  | { readonly kind: 'broadcast' }
  /** broadcast.start의 방송: 새 방송 ID 또는 이미 선언한 방송(사본) (S04, D-070) */
  | { readonly kind: 'newBroadcast' }
  /** broadcast.start의 설정 스냅샷: 설정 키 → 값 (아래 SETTING_CHECKS) */
  | { readonly kind: 'settings' }
  /** 구매자 키. sellerTyped면 판매자가 적는 ID 칸 — 휴대폰 번호면 읽기 오류(notPhoneId). 효과 보고의 buyer는 아니다(엔진에는 효과 ID로 넘긴다) */
  | { readonly kind: 'buyer'; readonly sellerTyped: boolean }
  | { readonly kind: 'channel' }
  /** host.convertMessage의 msg — 판매자가 적는 ID 칸(notPhoneId) */
  | { readonly kind: 'message' }
  | { readonly kind: 'smsRef' }
  | { readonly kind: 'date' }
  | { readonly kind: 'received' }
  | { readonly kind: 'at' }
  | { readonly kind: 'value'; readonly check: ValueCheck }

const F = {
  b: { kind: 'broadcast' },
  newB: { kind: 'newBroadcast' },
  settings: { kind: 'settings' },
  buyer: { kind: 'buyer', sellerTyped: true },
  /** 효과 보고의 buyer — ID 칸 번호 검사 밖 (README "판매자가 적는 칸의 휴대폰 번호") */
  effectBuyer: { kind: 'buyer', sellerTyped: false },
  channel: { kind: 'channel' },
  message: { kind: 'message' },
  smsRef: { kind: 'smsRef' },
  date: { kind: 'date' },
  received: { kind: 'received' },
  at: { kind: 'at' },
  no: { kind: 'value', check: intAtLeast(1) },
  reason: { kind: 'value', check: (value: unknown) => nonEmptyStr(value) ?? noPhoneInText(value) },
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
/** host.assign의 교체 대상(replace)과 교체 방법(replaceTo)은 함께 쓴다 (README 이벤트 표, D-042). 하나만 있으면 validate에서 읽기 오류 */
export const ASSIGN_REPLACE_FIELDS = ['replace', 'replaceTo'] as const
const productByNo = spec({ b: F.b, no: F.no })
const blockLike = spec({ buyer: F.buyer, reason: F.reason })

export const EVENT_SPECS: Readonly<Record<string, EventSpec>> = {
  // 짧은 형식 at은 이 이벤트의 date 기준 (README "시각") — validate가 따로 다룬다
  'broadcast.start': spec({ b: F.newB, date: F.date, title: F.v(freeText) }, { settings: F.settings }),
  'broadcast.end': spec({ b: F.b }),
  'product.register': spec(
    { b: F.b, no: F.no, name: F.v(freeText), price: F.v(intAtLeast(0)) },
    { stock: F.v(intAtLeast(1)), status: F.v(oneOf(['OPEN', 'READY'])) },
  ),
  'product.open': productByNo,
  'product.hold': productByNo,
  'product.close': productByNo,
  'product.update': spec(
    { b: F.b, no: F.no },
    { name: F.v(freeText), price: F.v(intAtLeast(0)), stock: F.v(intAtLeast(1)), applyTo: F.v(oneOf(['NEW_ONLY', 'UNPAID_CLAIMS'])) },
  ),
  'product.renumber': spec({ b: F.b, from: F.no, to: F.no }),
  chat: spec(
    { b: F.b, id: F.v(nonEmptyStr), ch: F.channel, nick: F.v(nonEmptyStr), text: F.v(str) },
    { owner: F.v(bool), publishedAt: F.at },
  ),
  sms: spec(
    { b: F.b, ref: F.smsRef, no: F.no, received: F.received },
    { memo: F.v((value) => str(value) ?? notPhoneShaped(value)), phone: F.v(str), buyer: F.buyer },
  ),
  'host.cancel': hostWithBuyer,
  'host.reject': hostWithBuyer,
  'host.promote': hostWithBuyer,
  'host.confirm': hostConfirmLike,
  'host.approveCancel': hostConfirmLike,
  'host.dismissCancel': hostConfirmLike,
  'host.assign': spec({ b: F.b, no: F.no, buyer: F.buyer, reason: F.reason }, { replace: F.buyer, replaceTo: F.v(oneOf(['WAITLIST', 'CANCEL'])) }),
  'host.reopen': spec({ b: F.b, no: F.no, reason: F.reason }),
  'host.resolveConflict': spec({ b: F.b, no: F.no, decision: F.v(oneOf(['KEEP', 'SWITCH'])) }, { reason: F.reason }),
  'host.convertMessage': spec({ b: F.b, msg: F.message, no: F.no }, { reason: F.reason }),
  'host.blockBuyer': blockLike,
  'host.unblockBuyer': blockLike,
  'buyer.merge': spec({ from: F.buyer, into: F.buyer, reason: F.reason }),
  'buyer.unmerge': spec({ from: F.buyer, reason: F.reason }),
  'effect.labelPrinted': spec({ b: F.b, no: F.no, buyer: F.effectBuyer }),
  'effect.thanksSent': spec({ b: F.b, no: F.no, buyer: F.effectBuyer }, { target: F.v(oneOf(TARGETS)) }),
  'settlement.shippingOverride': spec(
    { buyer: F.buyer, date: F.date, mode: F.v(oneOf(['PICKUP', 'COMBINED', 'FIXED', 'DEFAULT'])) },
    { amount: F.v(intAtLeast(0)) },
  ),
  'settlement.adjust': spec({ buyer: F.buyer, date: F.date, amount: F.v(anyInt), reason: F.reason }),
  'settlement.payment': spec({ buyer: F.buyer, date: F.date, amount: F.v(intAtLeast(1)) }, { memo: F.v(freeText) }),
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
  'broadcasts',
  'mergePreviews',
] as const
export const PRODUCT_EXPECT_KEYS = ['status', 'winner', 'winners', 'waitlist', 'conflict', 'exists', 'price', 'priceHistory'] as const
export const BUYER_EXPECT_KEYS = ['items', 'subtotal', 'byBroadcast', 'display', 'nameHistory', 'phoneLast4'] as const
export const SETTLEMENT_EXPECT_KEYS = ['subtotal', 'shipping', 'adjustments', 'total', 'refundDue', 'payment'] as const
export const EFFECT_EXPECT_KEYS = ['kind', 'target', 'product', 'buyer', 'text', 'confirmVersion'] as const
export const CLAIM_EXPECT_KEYS = ['product', 'buyer', 'status', 'reason'] as const
/** `broadcasts.<b>` (S04, D-070) */
export const BROADCAST_EXPECT_KEYS = ['date', 'title', 'ended'] as const
/** `mergePreviews` 항목 (S06b, D-100). from·into는 필수 */
export const MERGE_PREVIEW_EXPECT_KEYS = ['from', 'into', 'blocked', 'bothConfirmed', 'moving', 'after', 'duplicates'] as const
/** `mergePreviews[i].moving`·`after` */
export const MERGE_ITEMS_EXPECT_KEYS = ['items', 'subtotal'] as const
/** `mergePreviews[i].duplicates[j]` — 셋 다 필수 */
export const MERGE_DUPLICATE_EXPECT_KEYS = ['product', 'buyer', 'status'] as const
/** 합치기 막힘 이유, 위에서부터 처음 맞는 것 (README `mergePreviews` 비교 규칙, R-11) */
export const MERGE_BLOCK_REASONS = ['UNKNOWN_BUYER', 'SAME_BUYER', 'FROM_MERGED', 'CYCLE', 'BOTH_CONFIRMED'] as const
/** 합치면 DUPLICATE가 될 찜의 지금 상태 — 확정 찜은 중복이 되지 않는다 */
export const MERGE_DUPLICATE_STATUSES = ['CONFLICT', 'WAITLISTED', 'PENDING'] as const

export type MergeBlockReason = (typeof MERGE_BLOCK_REASONS)[number]
export type MergeDuplicateStatus = (typeof MERGE_DUPLICATE_STATUSES)[number]

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
/** 문자찜 ref 형식: 영문·숫자·`_`·`-`로 된 1~64자 (README sms 행, DOMAIN_RULES R-1, D-061). 같은 ref를 다시 적으면 재전송 사본(D-067) */
export const SMS_REF_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 허용 목록 예약 파일 이름 (골든 폴더 바로 아래) */
export const ALLOWLIST_FILE = 'known-unimplemented.yaml'
