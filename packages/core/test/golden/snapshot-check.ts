// 관찰 스냅샷 형식 검사 (AC-S02-92, TD-S00-010).
// 코어 어댑터가 내놓은 GoldenSnapshot의 키·열거값·금액·목록·키 형식을 검사한다. 어기면 러너 오류다.
// 효과 종류 오타 같은 형식 오류 때문에 `effectCounts: { VOID_LABEL: 0 }`·`pendingEffects` 같은 부정 검사가 조용히 통과하는 일을 막는다.
import {
  BROADCAST_ID_RE,
  CLAIM_STATUSES,
  EFFECT_KINDS,
  PAYMENT_STATUSES,
  PRODUCT_KEY_RE,
  PRODUCT_STATUSES,
  REJECT_REASONS,
  TARGETS,
  isPlainObject,
  showValue,
} from './contract.ts'
import { parseDate } from './time.ts'

export const SNAPSHOT_KEYS = ['buyerKeys', 'broadcasts', 'products', 'buyers', 'settlements', 'effects', 'claims', 'pending', 'cancelRequests'] as const
export const EFFECT_STATUSES = ['PENDING', 'DONE', 'CANCELLED', 'SKIPPED'] as const
const BROADCAST_VIEW_KEYS = ['date', 'title', 'ended'] as const
const PRODUCT_VIEW_KEYS = ['status', 'winners', 'waitlist', 'conflict', 'price', 'priceHistory'] as const
const BUYER_VIEW_KEYS = ['display', 'nameHistory', 'items', 'subtotal', 'byBroadcast', 'phoneLast4'] as const
const SETTLEMENT_VIEW_KEYS = ['subtotal', 'shipping', 'adjustments', 'total', 'refundDue', 'payment'] as const
const EFFECT_VIEW_KEYS = ['kind', 'status', 'target', 'product', 'buyer', 'text', 'confirmVersion'] as const
const CLAIM_VIEW_KEYS = ['product', 'buyer', 'status', 'reason'] as const

class Issues {
  readonly found: string[] = []

  fail(path: string, message: string): void {
    this.found.push(`${path}: ${message}`)
  }

  /** 맵이고 키가 allowed 안이며 required를 모두 가졌는지 */
  record(path: string, value: unknown, allowed?: readonly string[], required: readonly string[] = allowed ?? []): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
      this.fail(path, `맵이어야 한다 (값: ${showValue(value)})`)
      return false
    }
    if (allowed !== undefined) {
      for (const key of Object.keys(value)) if (!allowed.includes(key)) this.fail(`${path}.${key}`, `모르는 키`)
      for (const key of required) if (!Object.hasOwn(value, key) || value[key] === undefined) this.fail(path, `'${key}'가 없다`)
    }
    return true
  }

  array(path: string, value: unknown): value is unknown[] {
    if (Array.isArray(value)) return true
    this.fail(path, `목록이어야 한다 (값: ${showValue(value)})`)
    return false
  }

  strings(path: string, value: unknown, item: (path: string, v: string) => void = () => undefined): void {
    if (!this.array(path, value)) return
    value.forEach((v, i) => {
      if (typeof v !== 'string') this.fail(`${path}[${String(i)}]`, `문자열이어야 한다 (값: ${showValue(v)})`)
      else item(`${path}[${String(i)}]`, v)
    })
  }

  str(path: string, value: unknown): void {
    if (typeof value !== 'string') this.fail(path, `문자열이어야 한다 (값: ${showValue(value)})`)
  }

  int(path: string, value: unknown, min: number | null): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || (min !== null && value < min)) {
      this.fail(path, `${min === null ? '' : `${String(min)} 이상 `}정수여야 한다 (값: ${showValue(value)})`)
    }
  }

  oneOf(path: string, value: unknown, choices: readonly string[]): void {
    if (typeof value !== 'string' || !choices.includes(value)) this.fail(path, `${choices.join(' / ')} 중 하나여야 한다 (값: ${showValue(value)})`)
  }

  productKey(path: string, value: string): void {
    if (!PRODUCT_KEY_RE.test(value)) this.fail(path, `상품 키 형식 오류 '${value}' ('<방송>/<번호>')`)
  }

  /** 있으면 검사 */
  optional(value: Record<string, unknown>, key: string, check: (v: unknown) => void): void {
    if (Object.hasOwn(value, key) && value[key] !== undefined) check(value[key])
  }
}

/** 형식 위반 목록 (`경로: 이유`). 비어 있으면 통과 */
export function snapshotIssues(snapshot: unknown): string[] {
  const c = new Issues()
  if (!c.record('스냅샷', snapshot, SNAPSHOT_KEYS)) return c.found
  // 빠진 최상위 키는 위에서 한 번만 알린다
  const has = (key: (typeof SNAPSHOT_KEYS)[number]): boolean => snapshot[key] !== undefined

  if (has('buyerKeys') && c.record('buyerKeys', snapshot.buyerKeys)) {
    for (const [key, id] of Object.entries(snapshot.buyerKeys)) c.str(`buyerKeys.${key}`, id)
  }

  if (has('broadcasts') && c.record('broadcasts', snapshot.broadcasts)) {
    for (const [id, broadcast] of Object.entries(snapshot.broadcasts)) {
      const p = `broadcasts.${id}`
      if (!BROADCAST_ID_RE.test(id)) c.fail(p, `방송 ID 형식 오류`)
      if (!c.record(p, broadcast, BROADCAST_VIEW_KEYS)) continue
      c.optional(broadcast, 'date', (v) => {
        if (typeof v !== 'string' || !parseDate(v)) c.fail(`${p}.date`, `YYYY-MM-DD 날짜여야 한다 (값: ${showValue(v)})`)
      })
      c.optional(broadcast, 'title', (v) => c.str(`${p}.title`, v))
      c.optional(broadcast, 'ended', (v) => {
        if (typeof v !== 'boolean') c.fail(`${p}.ended`, `true 또는 false여야 한다 (값: ${showValue(v)})`)
      })
    }
  }

  if (has('products') && c.record('products', snapshot.products)) {
    for (const [key, product] of Object.entries(snapshot.products)) {
      const p = `products.${key}`
      c.productKey(p, key)
      if (!c.record(p, product, PRODUCT_VIEW_KEYS)) continue
      c.optional(product, 'status', (v) => c.oneOf(`${p}.status`, v, PRODUCT_STATUSES))
      c.optional(product, 'winners', (v) => c.strings(`${p}.winners`, v))
      c.optional(product, 'waitlist', (v) => c.strings(`${p}.waitlist`, v))
      c.optional(product, 'conflict', (v) => {
        if (typeof v !== 'boolean') c.fail(`${p}.conflict`, `true 또는 false여야 한다 (값: ${showValue(v)})`)
      })
      c.optional(product, 'price', (v) => c.int(`${p}.price`, v, 0))
      c.optional(product, 'priceHistory', (v) => {
        if (!c.array(`${p}.priceHistory`, v)) return
        v.forEach((entry, i) => {
          const ep = `${p}.priceHistory[${String(i)}]`
          if (!c.record(ep, entry, ['from', 'to'])) return
          c.optional(entry, 'from', (x) => c.int(`${ep}.from`, x, 0))
          c.optional(entry, 'to', (x) => c.int(`${ep}.to`, x, 0))
        })
      })
    }
  }

  if (has('buyers') && c.record('buyers', snapshot.buyers)) {
    for (const [id, buyer] of Object.entries(snapshot.buyers)) {
      const p = `buyers.${id}`
      if (!c.record(p, buyer, BUYER_VIEW_KEYS)) continue
      c.optional(buyer, 'display', (v) => c.str(`${p}.display`, v))
      c.optional(buyer, 'nameHistory', (v) => c.strings(`${p}.nameHistory`, v))
      c.optional(buyer, 'items', (v) => c.strings(`${p}.items`, v, (ip, key) => c.productKey(ip, key)))
      c.optional(buyer, 'subtotal', (v) => c.int(`${p}.subtotal`, v, 0))
      c.optional(buyer, 'phoneLast4', (v) => {
        if (v !== null && (typeof v !== 'string' || !/^[0-9]{4}$/.test(v))) c.fail(`${p}.phoneLast4`, `숫자 4자리 문자열 또는 null이어야 한다 (값: ${showValue(v)})`)
      })
      c.optional(buyer, 'byBroadcast', (v) => {
        if (!c.record(`${p}.byBroadcast`, v)) return
        for (const [b, amount] of Object.entries(v)) {
          if (!BROADCAST_ID_RE.test(b)) c.fail(`${p}.byBroadcast.${b}`, `방송 ID 형식 오류`)
          c.int(`${p}.byBroadcast.${b}`, amount, 0)
        }
      })
    }
  }

  if (has('settlements') && c.record('settlements', snapshot.settlements)) {
    for (const [key, settlement] of Object.entries(snapshot.settlements)) {
      const p = `settlements.${key}`
      const at = key.lastIndexOf('@')
      if (at <= 0 || !parseDate(key.slice(at + 1))) c.fail(p, `정산 키 형식 오류 '${key}' ('<구매자 ID>@<YYYY-MM-DD>')`)
      if (!c.record(p, settlement, SETTLEMENT_VIEW_KEYS)) continue
      // 금액은 정수 원. 조정만 음수 가능 (INV-6)
      for (const field of ['subtotal', 'shipping', 'total', 'refundDue'] as const) c.optional(settlement, field, (v) => c.int(`${p}.${field}`, v, 0))
      c.optional(settlement, 'adjustments', (v) => c.int(`${p}.adjustments`, v, null))
      c.optional(settlement, 'payment', (v) => c.oneOf(`${p}.payment`, v, PAYMENT_STATUSES))
    }
  }

  if (has('effects') && c.array('effects', snapshot.effects)) {
    snapshot.effects.forEach((effect, i) => {
      const p = `effects[${String(i)}]`
      if (!c.record(p, effect, EFFECT_VIEW_KEYS, ['kind', 'status'])) return
      c.optional(effect, 'kind', (v) => c.oneOf(`${p}.kind`, v, EFFECT_KINDS))
      c.optional(effect, 'status', (v) => c.oneOf(`${p}.status`, v, EFFECT_STATUSES))
      c.optional(effect, 'target', (v) => c.oneOf(`${p}.target`, v, TARGETS))
      c.optional(effect, 'product', (v) => (typeof v === 'string' ? c.productKey(`${p}.product`, v) : c.str(`${p}.product`, v)))
      c.optional(effect, 'buyer', (v) => c.str(`${p}.buyer`, v))
      c.optional(effect, 'text', (v) => c.str(`${p}.text`, v))
      c.optional(effect, 'confirmVersion', (v) => c.int(`${p}.confirmVersion`, v, 1))
    })
  }

  if (has('claims') && c.array('claims', snapshot.claims)) {
    snapshot.claims.forEach((claim, i) => {
      const p = `claims[${String(i)}]`
      if (!c.record(p, claim, CLAIM_VIEW_KEYS, ['product', 'buyer', 'status'])) return
      c.optional(claim, 'product', (v) => (typeof v === 'string' ? c.productKey(`${p}.product`, v) : c.str(`${p}.product`, v)))
      c.optional(claim, 'buyer', (v) => c.str(`${p}.buyer`, v))
      c.optional(claim, 'status', (v) => c.oneOf(`${p}.status`, v, CLAIM_STATUSES))
      c.optional(claim, 'reason', (v) => c.oneOf(`${p}.reason`, v, REJECT_REASONS))
    })
  }

  if (has('pending') && c.record('pending', snapshot.pending)) {
    for (const [key, buyers] of Object.entries(snapshot.pending)) {
      c.productKey(`pending.${key}`, key)
      c.strings(`pending.${key}`, buyers)
    }
  }

  if (has('cancelRequests') && c.array('cancelRequests', snapshot.cancelRequests)) {
    snapshot.cancelRequests.forEach((request, i) => {
      const p = `cancelRequests[${String(i)}]`
      if (!c.record(p, request, ['product', 'buyer'])) return
      c.optional(request, 'product', (v) => (typeof v === 'string' ? c.productKey(`${p}.product`, v) : c.str(`${p}.product`, v)))
      c.optional(request, 'buyer', (v) => c.str(`${p}.buyer`, v))
    })
  }
  return c.found
}
