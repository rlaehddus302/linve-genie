// 골든 문서 검증 — README 형식 계약 밖은 전부 읽기 오류 (D-021).
// 검증을 통과한 문서만 러너가 실행한다. 이벤트 변환(at → UTC, seq 부여)도 여기서 한다.
import type { SettingsOverride } from '@livejjim/core'
import {
  ASSIGN_REPLACE_FIELDS,
  BROADCAST_EXPECT_KEYS,
  BROADCAST_ID_RE,
  BUYER_EXPECT_KEYS,
  CLAIM_EXPECT_KEYS,
  CLAIM_STATUSES,
  EFFECT_EXPECT_KEYS,
  EFFECT_KINDS,
  EVENT_SPECS,
  EXPECT_KEYS,
  MERGE_BLOCK_REASONS,
  MERGE_DUPLICATE_EXPECT_KEYS,
  MERGE_DUPLICATE_STATUSES,
  MERGE_ITEMS_EXPECT_KEYS,
  MERGE_PREVIEW_EXPECT_KEYS,
  PAYMENT_STATUSES,
  PRODUCT_EXPECT_KEYS,
  PRODUCT_KEY_RE,
  PRODUCT_STATUSES,
  QUICK_INPUT_ERRORS,
  REJECT_REASONS,
  SCENARIO_ID_RE,
  SETTING_CHECKS,
  SETTLEMENT_EXPECT_KEYS,
  SMS_PREFIX,
  SMS_REF_RE,
  SUITES,
  SUITE_SETTINGS,
  TARGETS,
  VOICE_CONFIDENCES,
  VOICE_DICTIONARY_KEY,
  VOICE_EXTRACT_KEYS,
  anyInt,
  bool,
  intAtLeast,
  isPlainObject,
  nonEmptyStr,
  notPhoneId,
  notPhoneShaped,
  oneOf,
  phoneLast4OrNull,
  showValue,
  str,
  type ClaimStatus,
  type EffectKind,
  type FieldKind,
  type MergeBlockReason,
  type MergeDuplicateStatus,
  type PaymentStatus,
  type ProductStatus,
  type RejectReason,
  type SuiteName,
  type Target,
  type ValueCheck,
} from './contract.ts'
import { isShortAt, isValidReceived, parseDate, resolveAt } from './time.ts'
import type { GoldenBroadcast, GoldenEvent, GoldenSetup } from './types.ts'
import type { PathSegment } from './yaml.ts'

// ── 검증된 문서 ──────────────────────────────────────────────────────────

export interface ProductExpect {
  readonly status?: ProductStatus
  readonly winner?: string | null
  readonly winners?: readonly string[]
  readonly waitlist?: readonly string[]
  readonly conflict?: boolean
  readonly exists?: boolean
  readonly price?: number
  readonly priceHistory?: readonly { readonly from: number; readonly to: number }[]
}

export interface BuyerExpect {
  readonly items?: readonly string[]
  readonly subtotal?: number
  readonly byBroadcast?: Readonly<Record<string, number>>
  readonly display?: string
  readonly nameHistory?: readonly string[]
  readonly phoneLast4?: string | null
}

export interface SettlementExpect {
  readonly subtotal?: number
  readonly shipping?: number
  readonly adjustments?: number
  readonly total?: number
  readonly refundDue?: number
  readonly payment?: PaymentStatus
}

export interface EffectExpect {
  readonly kind: EffectKind
  readonly target?: Target
  readonly product?: string
  readonly buyer?: string
  readonly text?: string
  readonly confirmVersion?: number
}

export interface ClaimExpect {
  readonly product: string
  readonly buyer: string
  readonly status: ClaimStatus
  readonly reason?: RejectReason
}

export interface BroadcastExpect {
  readonly date?: string
  readonly title?: string
  readonly ended?: boolean
}

export interface MergeItemsExpect {
  readonly items?: readonly string[]
  readonly subtotal?: number
}

/** `mergePreviews` 항목 (S06b, D-100). from·into는 구매자 키(러너가 구매자 자신으로 푼다), 나머지는 적은 것만 비교 */
export interface MergePreviewExpect {
  readonly from: string
  readonly into: string
  readonly blocked?: MergeBlockReason | null
  readonly bothConfirmed?: readonly string[]
  readonly moving?: MergeItemsExpect
  readonly after?: MergeItemsExpect | null
  readonly duplicates?: readonly { readonly product: string; readonly buyer: string; readonly status: MergeDuplicateStatus }[]
}

export interface Expect {
  readonly broadcasts?: Readonly<Record<string, BroadcastExpect>>
  readonly products?: Readonly<Record<string, ProductExpect>>
  readonly buyers?: Readonly<Record<string, BuyerExpect>>
  readonly settlements?: Readonly<Record<string, SettlementExpect>>
  readonly effects?: readonly EffectExpect[]
  readonly effectCounts?: Readonly<Partial<Record<EffectKind, number>>>
  readonly pendingEffects?: readonly EffectExpect[]
  readonly claims?: readonly ClaimExpect[]
  readonly pending?: Readonly<Record<string, readonly string[]>>
  readonly sameBuyer?: readonly (readonly string[])[]
  readonly claimCount?: number
  readonly cancelRequests?: readonly { readonly product: string; readonly buyer: string }[]
  readonly mergePreviews?: readonly MergePreviewExpect[]
}

export interface ParserCase {
  /** 문서 안 사례 번호 (1부터) */
  readonly index: number
  readonly input: string
  readonly out: unknown
}

export interface ParserSuiteDoc {
  readonly kind: 'suite'
  readonly suite: SuiteName
  /** DOMAIN_RULES 키(점 표기)로 바꾼 설정 */
  readonly settings: SettingsOverride
  /** voice-extract의 품종 사전 (settings.dictionary, 생략하면 빈 목록). 다른 suite에는 없다 (P2, D-209) */
  readonly dictionary?: readonly string[]
  readonly cases: readonly ParserCase[]
}

export type ScenarioStep =
  | { readonly kind: 'event'; readonly index: number; readonly event: GoldenEvent }
  | { readonly kind: 'assert'; readonly index: number; readonly expect: Expect }

export interface ScenarioDoc {
  readonly kind: 'scenario'
  readonly id: string
  readonly title: string
  readonly refs: readonly string[]
  readonly setup: GoldenSetup
  readonly steps: readonly ScenarioStep[]
  readonly expect: Expect
}

export type ValidatedDocument = ParserSuiteDoc | ScenarioDoc

export interface ValidationIssue {
  readonly path: readonly PathSegment[]
  readonly message: string
}

export type ValidationResult =
  | { readonly ok: true; readonly doc: ValidatedDocument }
  | { readonly ok: false; readonly label?: string; readonly issues: readonly ValidationIssue[] }

/** `events[3].at`, `expect.products.b1/15.winner` 같은 표시용 경로 */
export function formatPath(path: readonly PathSegment[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out === '' ? segment : `.${segment}`
  }
  return out
}

// ── 검사 도구 ────────────────────────────────────────────────────────────

interface ScenarioContext {
  /**
   * 지금까지 선언된 방송 (시작 때 선언한 broadcasts 목록 + 앞선 broadcast.start). 이벤트를 차례로 검사하며 늘어난다 —
   * 이벤트·중간 검사는 그 시점까지 선언된 방송만, 마지막 expect는 모든 방송을 쓸 수 있다 (README "규칙", S04)
   */
  readonly broadcasts: Map<string, GoldenBroadcast>
  readonly smsRefs: ReadonlySet<string>
  readonly messageIds: ReadonlySet<string>
  /** 방송 날짜(broadcasts 목록과 모든 broadcast.start의 date — 사본 포함) */
  readonly dates: ReadonlySet<string>
  /** 방송 날짜가 하나뿐이면 그 날짜 (방송 없는 이벤트의 짧은 at 기준) */
  readonly singleDate: string | undefined
}

class Checker {
  readonly issues: ValidationIssue[] = []

  fail(path: readonly PathSegment[], message: string): false {
    this.issues.push({ path: [...path], message })
    return false
  }

  value(path: readonly PathSegment[], value: unknown, check: ValueCheck): boolean {
    const reason = check(value)
    return reason === undefined ? true : this.fail(path, reason)
  }

  object(path: readonly PathSegment[], value: unknown, what = '맵'): value is Record<string, unknown> {
    return isPlainObject(value) ? true : this.fail(path, `${what}이어야 한다 (값: ${showValue(value)})`)
  }

  array(path: readonly PathSegment[], value: unknown, minLength = 0): value is unknown[] {
    if (!Array.isArray(value)) return this.fail(path, `목록이어야 한다 (값: ${showValue(value)})`)
    if (value.length < minLength) return this.fail(path, `항목이 ${minLength}개 이상이어야 한다`)
    return true
  }

  /** 모르는 키와 빠진 필수 키를 찾는다. */
  keys(path: readonly PathSegment[], obj: Record<string, unknown>, allowed: readonly string[], required: readonly string[], what = '키'): boolean {
    let ok = true
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) ok = this.fail([...path, key], `모르는 ${what} '${key}'`)
    }
    for (const key of required) {
      if (!Object.hasOwn(obj, key)) ok = this.fail(path, `필수 ${what} '${key}'가 없다`)
    }
    return ok
  }
}

function hasValue(obj: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(obj, key)
}

// ── 공통 참조 검사 ───────────────────────────────────────────────────────

function checkBuyerKey(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    return c.fail(path, `구매자 키는 앞뒤 공백 없는 문자열이어야 한다 (값: ${showValue(value)})`)
  }
  if (value.startsWith(SMS_PREFIX)) {
    const ref = value.slice(SMS_PREFIX.length)
    if (!ctx.smsRefs.has(ref)) return c.fail(path, `구매자 키 '${value}': 시나리오에 ref '${ref}'인 문자찜이 없다`)
  }
  return true
}

function checkProductKey(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown): value is string {
  if (typeof value !== 'string') return c.fail(path, `상품 키는 '<방송>/<번호>' 문자열이어야 한다 (값: ${showValue(value)})`)
  const m = PRODUCT_KEY_RE.exec(value)
  if (!m) return c.fail(path, `상품 키 형식 오류 '${value}' ('<방송>/<번호>', 번호는 1 이상)`)
  const broadcast = m[1] ?? ''
  if (!ctx.broadcasts.has(broadcast)) return c.fail(path, `상품 키 '${value}': 선언하지 않은 방송 '${broadcast}'`)
  return true
}

function checkBuyerList(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown, minLength = 0): boolean {
  if (!c.array(path, value, minLength)) return false
  let ok = true
  value.forEach((item, i) => {
    if (!checkBuyerKey(c, ctx, [...path, i], item)) ok = false
  })
  return ok
}

function checkSettlementKey(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], key: string): boolean {
  const at = key.lastIndexOf('@')
  if (at <= 0) return c.fail(path, `정산 키 형식 오류 '${key}' ('<구매자 키>@<YYYY-MM-DD>')`)
  const buyer = key.slice(0, at)
  const date = key.slice(at + 1)
  if (!parseDate(date)) return c.fail(path, `정산 키 '${key}'의 날짜 형식 오류 (YYYY-MM-DD)`)
  return checkBuyerKey(c, ctx, path, buyer)
}

// ── expect ───────────────────────────────────────────────────────────────

function checkEffectEntry(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown): void {
  if (!c.object(path, value)) return
  c.keys(path, value, EFFECT_EXPECT_KEYS, ['kind'])
  if (hasValue(value, 'kind')) c.value([...path, 'kind'], value.kind, oneOf(EFFECT_KINDS))
  if (hasValue(value, 'target')) c.value([...path, 'target'], value.target, oneOf(TARGETS))
  if (hasValue(value, 'product')) checkProductKey(c, ctx, [...path, 'product'], value.product)
  if (hasValue(value, 'buyer')) checkBuyerKey(c, ctx, [...path, 'buyer'], value.buyer)
  if (hasValue(value, 'text')) c.value([...path, 'text'], value.text, str)
  if (hasValue(value, 'confirmVersion')) c.value([...path, 'confirmVersion'], value.confirmVersion, intAtLeast(1))
}

/**
 * `mergePreviews[i].from`·`into` (README `mergePreviews` 비교 규칙): 구매자 키이고 판매자가 적는 ID 칸이다 — 휴대폰 번호면 읽기 오류(notPhoneId).
 * 엔진이 모르는 구매자도 적을 수 있다: 이벤트에 나온 적 없는 채널, 구매자를 정하지 않은 `sms:<ref>`(모르는 지정 구매자·없는 ref)는 키 그대로 넘긴다.
 */
function checkPreviewBuyer(c: Checker, path: readonly PathSegment[], value: unknown): void {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    c.fail(path, `구매자 키는 앞뒤 공백 없는 문자열이어야 한다 (값: ${showValue(value)})`)
    return
  }
  c.value(path, value, notPhoneId)
}

function checkMergeItems(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown): void {
  if (!c.object(path, value)) return
  c.keys(path, value, MERGE_ITEMS_EXPECT_KEYS, [], '합치기 미리 보기 찜 키')
  if (hasValue(value, 'items') && c.array([...path, 'items'], value.items)) {
    value.items.forEach((item, i) => checkProductKey(c, ctx, [...path, 'items', i], item))
  }
  if (hasValue(value, 'subtotal')) c.value([...path, 'subtotal'], value.subtotal, intAtLeast(0))
}

function checkMergePreview(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown): void {
  if (!c.object(path, value)) return
  c.keys(path, value, MERGE_PREVIEW_EXPECT_KEYS, ['from', 'into'], '합치기 미리 보기 키')
  if (hasValue(value, 'from')) checkPreviewBuyer(c, [...path, 'from'], value.from)
  if (hasValue(value, 'into')) checkPreviewBuyer(c, [...path, 'into'], value.into)
  if (hasValue(value, 'blocked') && value.blocked !== null) c.value([...path, 'blocked'], value.blocked, oneOf(MERGE_BLOCK_REASONS))
  if (hasValue(value, 'bothConfirmed') && c.array([...path, 'bothConfirmed'], value.bothConfirmed)) {
    value.bothConfirmed.forEach((item, i) => checkProductKey(c, ctx, [...path, 'bothConfirmed', i], item))
  }
  if (hasValue(value, 'moving')) checkMergeItems(c, ctx, [...path, 'moving'], value.moving)
  if (hasValue(value, 'after') && value.after !== null) checkMergeItems(c, ctx, [...path, 'after'], value.after)
  if (hasValue(value, 'duplicates') && c.array([...path, 'duplicates'], value.duplicates)) {
    value.duplicates.forEach((entry, i) => {
      const ep = [...path, 'duplicates', i]
      if (!c.object(ep, entry)) return
      c.keys(ep, entry, MERGE_DUPLICATE_EXPECT_KEYS, MERGE_DUPLICATE_EXPECT_KEYS, '중복 찜 키')
      if (hasValue(entry, 'product')) checkProductKey(c, ctx, [...ep, 'product'], entry.product)
      if (hasValue(entry, 'buyer')) checkBuyerKey(c, ctx, [...ep, 'buyer'], entry.buyer)
      if (hasValue(entry, 'status')) c.value([...ep, 'status'], entry.status, oneOf(MERGE_DUPLICATE_STATUSES))
    })
  }
}

function checkExpect(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], value: unknown): void {
  if (!c.object(path, value)) return
  c.keys(path, value, EXPECT_KEYS, [], 'expect 키')

  if (hasValue(value, 'broadcasts')) {
    const p = [...path, 'broadcasts']
    if (c.object(p, value.broadcasts)) {
      for (const [key, broadcast] of Object.entries(value.broadcasts)) {
        const kp = [...p, key]
        if (!ctx.broadcasts.has(key)) c.fail(kp, `선언하지 않은 방송 '${key}' (그 검사 시점까지 broadcasts 목록이나 broadcast.start로 선언한 방송만)`)
        if (!c.object(kp, broadcast)) continue
        c.keys(kp, broadcast, BROADCAST_EXPECT_KEYS, [], '방송 expect 키')
        if (hasValue(broadcast, 'date')) {
          c.value([...kp, 'date'], broadcast.date, (v) => (typeof v === 'string' && parseDate(v) ? undefined : `날짜 형식 오류 ${showValue(v)} (YYYY-MM-DD)`))
        }
        if (hasValue(broadcast, 'title')) c.value([...kp, 'title'], broadcast.title, str)
        if (hasValue(broadcast, 'ended')) c.value([...kp, 'ended'], broadcast.ended, bool)
      }
    }
  }

  if (hasValue(value, 'products')) {
    const p = [...path, 'products']
    if (c.object(p, value.products)) {
      for (const [key, product] of Object.entries(value.products)) {
        const kp = [...p, key]
        checkProductKey(c, ctx, kp, key)
        if (!c.object(kp, product)) continue
        c.keys(kp, product, PRODUCT_EXPECT_KEYS, [], '상품 expect 키')
        if (hasValue(product, 'status')) c.value([...kp, 'status'], product.status, oneOf(PRODUCT_STATUSES))
        if (hasValue(product, 'winner') && product.winner !== null) checkBuyerKey(c, ctx, [...kp, 'winner'], product.winner)
        if (hasValue(product, 'winners')) checkBuyerList(c, ctx, [...kp, 'winners'], product.winners)
        if (hasValue(product, 'waitlist')) checkBuyerList(c, ctx, [...kp, 'waitlist'], product.waitlist)
        if (hasValue(product, 'conflict')) c.value([...kp, 'conflict'], product.conflict, bool)
        if (hasValue(product, 'exists')) c.value([...kp, 'exists'], product.exists, bool)
        if (hasValue(product, 'price')) c.value([...kp, 'price'], product.price, intAtLeast(0))
        if (hasValue(product, 'priceHistory')) {
          const hp = [...kp, 'priceHistory']
          if (c.array(hp, product.priceHistory)) {
            product.priceHistory.forEach((entry, i) => {
              if (!c.object([...hp, i], entry)) return
              c.keys([...hp, i], entry, ['from', 'to'], ['from', 'to'])
              if (hasValue(entry, 'from')) c.value([...hp, i, 'from'], entry.from, intAtLeast(0))
              if (hasValue(entry, 'to')) c.value([...hp, i, 'to'], entry.to, intAtLeast(0))
            })
          }
        }
      }
    }
  }

  if (hasValue(value, 'buyers')) {
    const p = [...path, 'buyers']
    if (c.object(p, value.buyers)) {
      for (const [key, buyer] of Object.entries(value.buyers)) {
        const kp = [...p, key]
        checkBuyerKey(c, ctx, kp, key)
        if (!c.object(kp, buyer)) continue
        c.keys(kp, buyer, BUYER_EXPECT_KEYS, [], '구매자 expect 키')
        if (hasValue(buyer, 'items') && c.array([...kp, 'items'], buyer.items)) {
          buyer.items.forEach((item, i) => checkProductKey(c, ctx, [...kp, 'items', i], item))
        }
        if (hasValue(buyer, 'subtotal')) c.value([...kp, 'subtotal'], buyer.subtotal, intAtLeast(0))
        if (hasValue(buyer, 'byBroadcast') && c.object([...kp, 'byBroadcast'], buyer.byBroadcast)) {
          for (const [b, amount] of Object.entries(buyer.byBroadcast)) {
            if (!ctx.broadcasts.has(b)) c.fail([...kp, 'byBroadcast', b], `선언하지 않은 방송 '${b}'`)
            c.value([...kp, 'byBroadcast', b], amount, intAtLeast(0))
          }
        }
        if (hasValue(buyer, 'display')) c.value([...kp, 'display'], buyer.display, str)
        if (hasValue(buyer, 'nameHistory') && c.array([...kp, 'nameHistory'], buyer.nameHistory)) {
          buyer.nameHistory.forEach((name, i) => c.value([...kp, 'nameHistory', i], name, str))
        }
        if (hasValue(buyer, 'phoneLast4')) c.value([...kp, 'phoneLast4'], buyer.phoneLast4, phoneLast4OrNull)
      }
    }
  }

  if (hasValue(value, 'settlements')) {
    const p = [...path, 'settlements']
    if (c.object(p, value.settlements)) {
      for (const [key, settlement] of Object.entries(value.settlements)) {
        const kp = [...p, key]
        checkSettlementKey(c, ctx, kp, key)
        if (!c.object(kp, settlement)) continue
        c.keys(kp, settlement, SETTLEMENT_EXPECT_KEYS, [], '정산 expect 키')
        for (const field of ['subtotal', 'shipping', 'refundDue'] as const) {
          if (hasValue(settlement, field)) c.value([...kp, field], settlement[field], intAtLeast(0))
        }
        for (const field of ['adjustments', 'total'] as const) {
          if (hasValue(settlement, field)) c.value([...kp, field], settlement[field], anyInt)
        }
        if (hasValue(settlement, 'payment')) c.value([...kp, 'payment'], settlement.payment, oneOf(PAYMENT_STATUSES))
      }
    }
  }

  for (const listKey of ['effects', 'pendingEffects'] as const) {
    if (!hasValue(value, listKey)) continue
    const p = [...path, listKey]
    const list = value[listKey]
    if (c.array(p, list)) list.forEach((entry, i) => checkEffectEntry(c, ctx, [...p, i], entry))
  }

  if (hasValue(value, 'effectCounts')) {
    const p = [...path, 'effectCounts']
    if (c.object(p, value.effectCounts)) {
      for (const [kind, count] of Object.entries(value.effectCounts)) {
        c.value([...p, kind], kind, oneOf(EFFECT_KINDS))
        c.value([...p, kind], count, intAtLeast(0))
      }
    }
  }

  if (hasValue(value, 'claims')) {
    const p = [...path, 'claims']
    if (c.array(p, value.claims)) {
      value.claims.forEach((entry, i) => {
        const ep = [...p, i]
        if (!c.object(ep, entry)) return
        c.keys(ep, entry, CLAIM_EXPECT_KEYS, ['product', 'buyer', 'status'])
        if (hasValue(entry, 'product')) checkProductKey(c, ctx, [...ep, 'product'], entry.product)
        if (hasValue(entry, 'buyer')) checkBuyerKey(c, ctx, [...ep, 'buyer'], entry.buyer)
        if (hasValue(entry, 'status')) c.value([...ep, 'status'], entry.status, oneOf(CLAIM_STATUSES))
        if (hasValue(entry, 'reason')) c.value([...ep, 'reason'], entry.reason, oneOf(REJECT_REASONS))
      })
    }
  }

  if (hasValue(value, 'pending')) {
    const p = [...path, 'pending']
    if (c.object(p, value.pending)) {
      for (const [key, buyers] of Object.entries(value.pending)) {
        checkProductKey(c, ctx, [...p, key], key)
        checkBuyerList(c, ctx, [...p, key], buyers)
      }
    }
  }

  if (hasValue(value, 'sameBuyer')) {
    const p = [...path, 'sameBuyer']
    if (c.array(p, value.sameBuyer)) value.sameBuyer.forEach((group, i) => checkBuyerList(c, ctx, [...p, i], group, 2))
  }

  if (hasValue(value, 'claimCount')) c.value([...path, 'claimCount'], value.claimCount, intAtLeast(0))

  if (hasValue(value, 'cancelRequests')) {
    const p = [...path, 'cancelRequests']
    if (c.array(p, value.cancelRequests)) {
      value.cancelRequests.forEach((entry, i) => {
        const ep = [...p, i]
        if (!c.object(ep, entry)) return
        c.keys(ep, entry, ['product', 'buyer'], ['product', 'buyer'])
        if (hasValue(entry, 'product')) checkProductKey(c, ctx, [...ep, 'product'], entry.product)
        if (hasValue(entry, 'buyer')) checkBuyerKey(c, ctx, [...ep, 'buyer'], entry.buyer)
      })
    }
  }

  if (hasValue(value, 'mergePreviews')) {
    const p = [...path, 'mergePreviews']
    if (c.array(p, value.mergePreviews)) value.mergePreviews.forEach((entry, i) => checkMergePreview(c, ctx, [...p, i], entry))
  }
}

// ── 설정 ─────────────────────────────────────────────────────────────────

function checkScenarioSettings(c: Checker, value: unknown): SettingsOverride {
  if (value === undefined) return {}
  if (!c.object(['settings'], value)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, setting] of Object.entries(value)) {
    const check = Object.hasOwn(SETTING_CHECKS, key) ? SETTING_CHECKS[key] : undefined
    if (!check) {
      c.fail(['settings', key], `모르는 설정 키 '${key}'`)
      continue
    }
    if (c.value(['settings', key], setting, check)) out[key] = setting
  }
  return out as SettingsOverride
}

// ── 파서 suite ───────────────────────────────────────────────────────────

const intArray =
  (min: number): ValueCheck =>
  (value) => {
    if (!Array.isArray(value)) return `${min} 이상 정수 목록이어야 한다 (값: ${showValue(value)})`
    for (const item of value) {
      const reason = intAtLeast(min)(item)
      if (reason) return `${min} 이상 정수 목록이어야 한다 (값: ${showValue(value)})`
    }
    return undefined
  }

function checkSuiteOut(c: Checker, suite: SuiteName, path: readonly PathSegment[], out: unknown): void {
  switch (suite) {
    case 'chat': {
      if (!c.object(path, out)) return
      c.keys(path, out, ['claims', 'cancels', 'mentions'], [], 'chat out 키')
      for (const key of ['claims', 'cancels', 'mentions'] as const) {
        if (hasValue(out, key)) c.value([...path, key], out[key], intArray(1))
      }
      return
    }
    case 'amount':
      if (out !== null) c.value(path, out, (v) => (intAtLeast(0)(v) ? `0 이상 정수(원) 또는 null이어야 한다 (값: ${showValue(v)})` : undefined))
      return
    case 'korean-number':
      if (out !== null) c.value(path, out, (v) => (intAtLeast(1)(v) ? `1 이상 정수 또는 null이어야 한다 (값: ${showValue(v)})` : undefined))
      return
    case 'quick-input': {
      if (!c.object(path, out)) return
      if (hasValue(out, 'error')) {
        c.keys(path, out, ['error', 'no', 'name'], ['error'], 'quick-input 실패 out 키')
        c.value([...path, 'error'], out.error, oneOf(QUICK_INPUT_ERRORS))
        if (hasValue(out, 'no')) c.value([...path, 'no'], out.no, intAtLeast(1))
        if (hasValue(out, 'name')) c.value([...path, 'name'], out.name, str)
      } else {
        c.keys(path, out, ['no', 'name', 'price'], ['no', 'name', 'price'], 'quick-input 성공 out 키')
        if (hasValue(out, 'no')) c.value([...path, 'no'], out.no, intAtLeast(1))
        if (hasValue(out, 'name')) c.value([...path, 'name'], out.name, str)
        if (hasValue(out, 'price')) c.value([...path, 'price'], out.price, intAtLeast(0))
      }
      return
    }
    case 'voice-extract': {
      // README: 키는 no·name·price·confidence만, confidence 필수. no·name·price는 적지 않거나 null이면 null
      if (!c.object(path, out)) return
      c.keys(path, out, VOICE_EXTRACT_KEYS, ['confidence'], 'voice-extract out 키')
      if (hasValue(out, 'no') && out.no !== null) c.value([...path, 'no'], out.no, intAtLeast(1))
      if (hasValue(out, 'name') && out.name !== null) c.value([...path, 'name'], out.name, nonEmptyStr)
      if (hasValue(out, 'price') && out.price !== null) c.value([...path, 'price'], out.price, intAtLeast(100))
      if (hasValue(out, 'confidence')) c.value([...path, 'confidence'], out.confidence, oneOf(VOICE_CONFIDENCES))
      return
    }
  }
}

/** 문자열 목록 (voice-extract 품종 사전) */
const stringList: ValueCheck = (value) => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return `문자열 목록이어야 한다 (값: ${showValue(value)})`
  return undefined
}

function validateSuite(raw: Record<string, unknown>): ValidationResult {
  const c = new Checker()
  c.keys([], raw, ['suite', 'settings', 'cases'], ['suite', 'cases'])
  const suiteValue = raw.suite
  const label = typeof suiteValue === 'string' ? suiteValue : undefined
  if (typeof suiteValue !== 'string' || !(SUITES as readonly string[]).includes(suiteValue)) {
    c.fail(['suite'], `모르는 suite 이름 ${showValue(suiteValue)} (${SUITES.join(' / ')} 중 하나)`)
    return { ok: false, ...(label === undefined ? {} : { label }), issues: c.issues }
  }
  const suite = suiteValue as SuiteName
  const mapping = SUITE_SETTINGS[suite]
  const settings: Record<string, unknown> = {}
  let dictionary: readonly string[] | undefined = suite === 'voice-extract' ? [] : undefined
  if (hasValue(raw, 'settings') && c.object(['settings'], raw.settings)) {
    for (const [key, setting] of Object.entries(raw.settings)) {
      if (suite === 'voice-extract' && key === VOICE_DICTIONARY_KEY) {
        if (c.value(['settings', key], setting, stringList)) dictionary = Object.freeze([...(setting as string[])])
        continue
      }
      const domainKey = Object.hasOwn(mapping, key) ? mapping[key] : undefined
      const check = domainKey === undefined ? undefined : SETTING_CHECKS[domainKey]
      if (domainKey === undefined || check === undefined) {
        c.fail(['settings', key], `suite '${suite}'에 없는 설정 키 '${key}'`)
        continue
      }
      if (c.value(['settings', key], setting, check)) settings[domainKey] = setting
    }
  }
  const cases: ParserCase[] = []
  if (hasValue(raw, 'cases') && c.array(['cases'], raw.cases)) {
    raw.cases.forEach((entry, i) => {
      const p = ['cases', i]
      if (!c.object(p, entry)) return
      c.keys(p, entry, ['in', 'out'], ['in', 'out'], '사례 키')
      const inputOk = hasValue(entry, 'in') && c.value([...p, 'in'], entry.in, str)
      if (hasValue(entry, 'out')) checkSuiteOut(c, suite, [...p, 'out'], entry.out)
      if (inputOk) cases.push({ index: i + 1, input: entry.in as string, out: entry.out })
    })
  }
  if (c.issues.length > 0) return { ok: false, label: suite, issues: c.issues }
  return { ok: true, doc: { kind: 'suite', suite, settings: settings as SettingsOverride, ...(dictionary === undefined ? {} : { dictionary }), cases } }
}

// ── 엔진 시나리오 ────────────────────────────────────────────────────────

/** 방송 ID 형식 (broadcasts 목록·broadcast.start 공통): 공백·'/'·'@' 없는 문자열 — 상품 키 `<방송>/<번호>`에 쓴다 */
const broadcastId: ValueCheck = (v) => (typeof v === 'string' && BROADCAST_ID_RE.test(v) ? undefined : `방송 ID는 공백·'/'·'@' 없는 문자열이어야 한다 (값: ${showValue(v)})`)

/** 시작 때 선언한 방송(broadcasts 목록 — S04부터 빈 목록도 된다)과 이벤트 사전 조사 */
function collectContext(c: Checker, raw: Record<string, unknown>): { readonly ctx: ScenarioContext; readonly initial: readonly GoldenBroadcast[] } {
  const broadcasts = new Map<string, GoldenBroadcast>()
  if (hasValue(raw, 'broadcasts') && c.array(['broadcasts'], raw.broadcasts)) {
    raw.broadcasts.forEach((entry, i) => {
      const p = ['broadcasts', i]
      if (!c.object(p, entry)) return
      c.keys(p, entry, ['id', 'date', 'title'], ['id', 'date', 'title'], '방송 키')
      const idOk = hasValue(entry, 'id') && c.value([...p, 'id'], entry.id, broadcastId)
      const dateOk =
        hasValue(entry, 'date') &&
        c.value([...p, 'date'], entry.date, (v) => (typeof v === 'string' && parseDate(v) ? undefined : `날짜 형식 오류 ${showValue(v)} (YYYY-MM-DD)`))
      const titleOk = hasValue(entry, 'title') && c.value([...p, 'title'], entry.title, nonEmptyStr)
      if (!idOk || !dateOk || !titleOk) return
      const id = entry.id as string
      if (broadcasts.has(id)) {
        c.fail([...p, 'id'], `방송 ID '${id}' 중복`)
        return
      }
      broadcasts.set(id, { id, date: entry.date as string, title: entry.title as string })
    })
  }
  const smsRefs = new Set<string>()
  const messageIds = new Set<string>()
  const dates = new Set([...broadcasts.values()].map((b) => b.date))
  if (Array.isArray(raw.events)) {
    for (const event of raw.events) {
      if (!isPlainObject(event)) continue
      if (event.type === 'sms' && typeof event.ref === 'string') smsRefs.add(event.ref)
      if (event.type === 'chat' && typeof event.id === 'string') messageIds.add(event.id)
      // 방송 날짜는 broadcast.start(사본 포함)의 date도 센다 (README "시각")
      if (event.type === 'broadcast.start' && typeof event.date === 'string' && parseDate(event.date)) dates.add(event.date)
    }
  }
  const singleDate = dates.size === 1 ? [...dates][0] : undefined
  return { ctx: { broadcasts, smsRefs, messageIds, dates, singleDate }, initial: [...broadcasts.values()] }
}

/** broadcast.start의 settings: 설정 키 → 값 (README "설정 키" — 키·값·범위 밖은 읽기 오류) */
function checkEventSettings(c: Checker, path: readonly PathSegment[], value: unknown): void {
  if (!c.object(path, value)) return
  for (const [key, setting] of Object.entries(value)) {
    const check = Object.hasOwn(SETTING_CHECKS, key) ? SETTING_CHECKS[key] : undefined
    if (!check) c.fail([...path, key], `모르는 설정 키 '${key}'`)
    else c.value([...path, key], setting, check)
  }
}

function checkField(c: Checker, ctx: ScenarioContext, path: readonly PathSegment[], kind: FieldKind, value: unknown): void {
  switch (kind.kind) {
    case 'broadcast':
      if (typeof value !== 'string' || !ctx.broadcasts.has(value)) c.fail(path, `선언하지 않은 방송 ${showValue(value)} (broadcasts 목록이나 앞선 broadcast.start로 선언한 방송만)`)
      return
    case 'newBroadcast':
      // 새 ID이거나 이미 선언한 방송(재전송 사본). 선언은 validateScenario가 이벤트를 받은 뒤에 한다
      c.value(path, value, broadcastId)
      return
    case 'settings':
      checkEventSettings(c, path, value)
      return
    case 'buyer':
      if (checkBuyerKey(c, ctx, path, value) && kind.sellerTyped) c.value(path, value, notPhoneId)
      return
    case 'channel':
      if (c.value(path, value, nonEmptyStr) && (value as string).startsWith(SMS_PREFIX)) {
        c.fail(path, `채널 ID는 '${SMS_PREFIX}'로 시작할 수 없다 (문자찜 구매자 키와 겹친다)`)
      }
      return
    case 'message':
      if (typeof value !== 'string' || !ctx.messageIds.has(value)) c.fail(path, `시나리오에 없는 채팅 메시지 ID ${showValue(value)}`)
      else c.value(path, value, notPhoneId)
      return
    case 'smsRef':
      // 같은 ref를 다시 적으면 재전송 사본이다 (README sms 행, D-067) — 중복은 읽기 오류가 아니다
      // 휴대폰 번호가 들어 있으면 읽기 오류 (README sms 행·"판매자가 적는 칸의 휴대폰 번호", D-079·D-080)
      c.value(path, value, (v) =>
        typeof v === 'string' && SMS_REF_RE.test(v) ? notPhoneShaped(v) : `문자찜 ref는 영문·숫자·'_'·'-'로 된 1~64자여야 한다 (값: ${showValue(v)})`,
      )
      return
    case 'date':
      if (typeof value !== 'string' || !parseDate(value)) c.fail(path, `날짜 형식 오류 ${showValue(value)} (YYYY-MM-DD)`)
      return
    case 'received':
      if (typeof value !== 'string' || !isValidReceived(value)) c.fail(path, `수신 시각 형식 오류 ${showValue(value)} (HH:MM 또는 HH:MM:SS)`)
      return
    case 'at':
      // at·publishedAt은 방송 날짜가 필요해 호출한 쪽에서 해석한다
      return
    case 'value':
      c.value(path, value, kind.check)
      return
  }
}

function validateScenario(raw: Record<string, unknown>): ValidationResult {
  const c = new Checker()
  const label = typeof raw.id === 'string' ? raw.id : undefined
  c.keys([], raw, ['id', 'title', 'refs', 'settings', 'broadcasts', 'events', 'expect'], ['id', 'title', 'refs', 'broadcasts', 'events', 'expect'])
  c.value(['id'], raw.id, (v) => (typeof v === 'string' && SCENARIO_ID_RE.test(v) ? undefined : `시나리오 ID 형식 오류 ${showValue(v)} (G-ENG-세 자리)`))
  if (hasValue(raw, 'title')) c.value(['title'], raw.title, nonEmptyStr)
  if (hasValue(raw, 'refs') && c.array(['refs'], raw.refs, 1)) {
    raw.refs.forEach((ref, i) => c.value(['refs', i], ref, nonEmptyStr))
  }
  const settings = checkScenarioSettings(c, raw.settings)
  const { ctx, initial } = collectContext(c, raw)

  const steps: ScenarioStep[] = []
  let seq = 0
  let previousAt: { utcMs: number; index: number } | undefined
  if (hasValue(raw, 'events') && c.array(['events'], raw.events)) {
    raw.events.forEach((entry, n) => {
      const p = ['events', n]
      if (!c.object(p, entry, '이벤트는 맵')) return
      const type = entry.type
      if (type === 'assert') {
        c.keys(p, entry, ['type', 'expect'], ['expect'], '중간 검사 키')
        checkExpect(c, ctx, [...p, 'expect'], entry.expect)
        if (isPlainObject(entry.expect)) steps.push({ kind: 'assert', index: n, expect: entry.expect as Expect })
        return
      }
      const spec = typeof type === 'string' && Object.hasOwn(EVENT_SPECS, type) ? EVENT_SPECS[type] : undefined
      if (!spec) {
        c.fail(hasValue(entry, 'type') ? [...p, 'type'] : p, hasValue(entry, 'type') ? `모르는 이벤트 종류 ${showValue(type)}` : `이벤트 종류(type)가 없다`)
        return
      }
      const allowed = ['at', 'type', ...Object.keys(spec.required), ...Object.keys(spec.optional)]
      c.keys(p, entry, allowed, ['at', ...Object.keys(spec.required)], '필드')
      for (const [field, kind] of [...Object.entries(spec.required), ...Object.entries(spec.optional)]) {
        if (hasValue(entry, field)) checkField(c, ctx, [...p, field], kind, entry[field])
      }
      if (type === 'settlement.shippingOverride') {
        if (entry.mode === 'FIXED' && !hasValue(entry, 'amount')) c.fail(p, `mode FIXED에는 amount가 필요하다`)
        if (entry.mode !== 'FIXED' && hasValue(entry, 'amount')) c.fail([...p, 'amount'], `amount는 mode FIXED일 때만 쓴다`)
      }
      if (type === 'host.assign') {
        const present = ASSIGN_REPLACE_FIELDS.filter((field) => hasValue(entry, field))
        if (present.length === 1) c.fail(p, `host.assign의 replace와 replaceTo는 함께 쓴다 ('${present[0] ?? ''}'만 있다)`)
      }

      // 시각: 짧은 형식은 그 이벤트의 방송 날짜, broadcast.start는 그 이벤트의 date(사본도 같다), 방송 없는 이벤트는 하나뿐인 방송 날짜
      const starting = type === 'broadcast.start'
      const startDate = starting && typeof entry.date === 'string' && parseDate(entry.date) ? entry.date : undefined
      const broadcast = spec.hasBroadcast && !starting && typeof entry.b === 'string' ? ctx.broadcasts.get(entry.b) : undefined
      const baseDate = starting ? startDate : spec.hasBroadcast ? broadcast?.date : ctx.singleDate
      const baseKnown = starting ? startDate !== undefined : spec.hasBroadcast ? broadcast !== undefined : true
      let atMs: number | undefined
      if (hasValue(entry, 'at')) {
        if (typeof entry.at !== 'string') {
          c.fail([...p, 'at'], `at은 문자열이어야 한다 (값: ${showValue(entry.at)})`)
        } else if (!spec.hasBroadcast && ctx.dates.size > 1 && isShortAt(entry.at)) {
          c.fail([...p, 'at'], `날짜가 다른 방송이 섞인 시나리오에서 방송(b) 없는 이벤트의 짧은 at "${entry.at}" — ISO 시각(오프셋 포함)으로 적어야 한다`)
        } else if (baseKnown) {
          const resolved = resolveAt(entry.at, baseDate)
          if (!resolved.ok) c.fail([...p, 'at'], resolved.reason)
          else atMs = resolved.utcMs
        }
      }
      if (atMs !== undefined) {
        if (previousAt !== undefined && atMs < previousAt.utcMs) {
          c.fail([...p, 'at'], `at 역행: events[${previousAt.index}]보다 이르다 (자정 뒤는 ISO 시각으로 적는다)`)
        }
        previousAt = { utcMs: atMs, index: n }
      }
      let publishedMs: number | undefined
      if (type === 'chat' && hasValue(entry, 'publishedAt')) {
        if (typeof entry.publishedAt !== 'string') {
          c.fail([...p, 'publishedAt'], `publishedAt은 문자열이어야 한다 (값: ${showValue(entry.publishedAt)})`)
        } else if (baseKnown) {
          const resolved = resolveAt(entry.publishedAt, baseDate)
          if (!resolved.ok) c.fail([...p, 'publishedAt'], resolved.reason)
          else publishedMs = resolved.utcMs
        }
      }

      // 새 방송 선언: 이 이벤트 뒤의 이벤트·검사가 그 방송을 쓸 수 있다. 이미 선언한 방송이면 사본 — 처음 선언한 날짜·제목 그대로
      if (starting && startDate !== undefined && typeof entry.b === 'string' && BROADCAST_ID_RE.test(entry.b) && typeof entry.title === 'string' && !ctx.broadcasts.has(entry.b)) {
        ctx.broadcasts.set(entry.b, { id: entry.b, date: startDate, title: entry.title })
      }

      seq += 1
      if (atMs === undefined) return
      const { at: _at, type: _type, publishedAt: _publishedAt, ...fields } = entry
      const event: GoldenEvent = {
        seq,
        at: atMs,
        type: type as string,
        ...fields,
        ...(type === 'chat' ? { publishedAt: publishedMs ?? atMs } : {}),
      }
      steps.push({ kind: 'event', index: n, event })
    })
  }

  const expectValue = raw.expect
  if (hasValue(raw, 'expect')) checkExpect(c, ctx, ['expect'], expectValue)

  if (c.issues.length > 0) return { ok: false, ...(label === undefined ? {} : { label }), issues: c.issues }
  return {
    ok: true,
    doc: {
      kind: 'scenario',
      id: raw.id as string,
      title: raw.title as string,
      refs: raw.refs as string[],
      setup: { broadcasts: initial, settings },
      steps,
      expect: expectValue as Expect,
    },
  }
}

/** YAML 문서 하나를 형식 계약으로 검증한다. */
export function validateDocument(value: unknown): ValidationResult {
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: [], message: `문서는 맵이어야 한다 (suite 또는 id 필요, 값: ${showValue(value)})` }] }
  }
  const isSuite = Object.hasOwn(value, 'suite')
  const isScenario = Object.hasOwn(value, 'id')
  if (isSuite && isScenario) return { ok: false, issues: [{ path: [], message: `suite와 id가 함께 있다 (문서는 파서 suite 또는 엔진 시나리오 중 하나)` }] }
  if (isSuite) return validateSuite(value)
  if (isScenario) return validateScenario(value)
  return { ok: false, issues: [{ path: [], message: `suite도 id도 없는 문서` }] }
}
