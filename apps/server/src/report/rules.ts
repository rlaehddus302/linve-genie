// 방송 리포트 순수 함수 (SPEC RPT-02~RPT-06·RPT-08, KP1 — D-KP1-09~D-KP1-13). 골든 `tests/golden/report/*.json`.
// 엔진 값을 모아 보이기만 한다 — 판정·금액을 바꾸지 않는다. 시계·DB를 쓰지 않고 실행 환경 시간대와 상관없다.
// 금액은 정수 원(나눗셈은 정수 몫만).
import { kstIso, parseOffsetIso } from '../deposit/calendar.ts'

/** 몰린 상품: 공개 뒤 30초 (RPT-06, 고정) */
export const RUSH_WINDOW_MS = 30_000
/** 이름이 빈 품종 (RPT-05) */
export const NO_NAME_VARIETY = '이름 없음'
/** 비교에 쓰는 앞선 방송 수 (RPT-08) */
export const COMPARE_RECENT_MAX = 4
/** 시간대 칸 (RPT-04) */
export const BUCKET_MS = 10 * 60_000

export interface SummaryBundleInput {
  readonly buyer: string
  /** 묶음 구성원의 표지 (없으면 빈 배열) */
  readonly keys: readonly string[]
  readonly items: number
  readonly subtotal: number
  readonly final: number
  readonly received: number
}

export interface ReportSummary {
  readonly sales: number
  readonly qty: number
  readonly received: number
  readonly unpaid: number
  readonly refund: number
  readonly buyers: number
  readonly unpaidBuyers: number
  readonly newBuyers: number
  readonly returningBuyers: number
  readonly unknownBuyers: number
}

/** RPT-02·RPT-03 돈·손님 숫자 */
export function reportSummary(input: { readonly bundles: readonly SummaryBundleInput[]; readonly earlier: readonly string[] }): ReportSummary {
  const earlier = new Set(input.earlier)
  let sales = 0
  let qty = 0
  let received = 0
  let unpaid = 0
  let refund = 0
  let buyers = 0
  let unpaidBuyers = 0
  let newBuyers = 0
  let returningBuyers = 0
  let unknownBuyers = 0
  for (const bundle of input.bundles) {
    sales += bundle.subtotal
    qty += bundle.items
    received += bundle.received
    unpaid += Math.max(bundle.final - bundle.received, 0)
    refund += Math.max(bundle.received - bundle.final, 0)
    if (bundle.items < 1) continue
    buyers += 1
    if (bundle.received < bundle.final) unpaidBuyers += 1
    if (bundle.keys.length === 0) unknownBuyers += 1
    else if (bundle.keys.some((key) => earlier.has(key))) returningBuyers += 1
    else newBuyers += 1
  }
  return { sales, qty, received, unpaid, refund, buyers, unpaidBuyers, newBuyers, returningBuyers, unknownBuyers }
}

export interface BucketRow {
  /** KST 칸 시작 `YYYY-MM-DD HH:MM` */
  readonly start: string
  readonly qty: number
  readonly amount: number
}

function parseTime(text: string, what: string): number {
  const ms = parseOffsetIso(text)
  if (ms === null) throw new RangeError(`${what}: 오프셋을 적은 ISO 시각이 아니다`)
  return ms
}

/** RPT-04 10분 칸 (찜이 있는 칸만, 시각 순) */
export function reportBuckets(input: { readonly claims: readonly { readonly time: string; readonly qty: number; readonly amount: number }[] }): BucketRow[] {
  const buckets = new Map<number, { qty: number; amount: number }>()
  for (const claim of input.claims) {
    const ms = parseTime(claim.time, 'claims.time')
    // KST는 UTC+9 정시라 UTC 밀리초에서 10분 칸으로 내려도 KST 칸과 같다
    const start = Math.floor(ms / BUCKET_MS) * BUCKET_MS
    const bucket = buckets.get(start) ?? { qty: 0, amount: 0 }
    bucket.qty += claim.qty
    bucket.amount += claim.amount
    buckets.set(start, bucket)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, bucket]) => {
      const text = kstIso(start)
      return { start: `${text.slice(0, 10)} ${text.slice(11, 16)}`, qty: bucket.qty, amount: bucket.amount }
    })
}

export interface VarietyRow {
  readonly name: string
  readonly qty: number
  readonly amount: number
}

/** 품종 묶는 키: NFC, 공백 문자(\s) 모두 지움, 비면 '이름 없음' */
export function varietyKey(name: string): string {
  const key = name.normalize('NFC').replace(/\s/g, '')
  return key === '' ? NO_NAME_VARIETY : key
}

/** 코드 포인트 순 비교 (UTF-16 단위가 아니라) */
export function compareCodePoints(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  const length = Math.min(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = ((left[i] as string).codePointAt(0) as number) - ((right[i] as string).codePointAt(0) as number)
    if (diff !== 0) return diff
  }
  return left.length - right.length
}

/** RPT-05 품종별 (금액 큰 순 → 수량 큰 순 → 이름 코드 포인트 순) */
export function reportVarieties(input: { readonly sales: readonly { readonly name: string; readonly qty: number; readonly amount: number }[] }): VarietyRow[] {
  const groups = new Map<string, { qty: number; amount: number }>()
  for (const sale of input.sales) {
    const key = varietyKey(sale.name)
    const group = groups.get(key) ?? { qty: 0, amount: 0 }
    group.qty += sale.qty
    group.amount += sale.amount
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([name, group]) => ({ name, qty: group.qty, amount: group.amount }))
    .sort((a, b) => b.amount - a.amount || b.qty - a.qty || compareCodePoints(a.name, b.name))
}

export interface RushProductInput {
  readonly b: string
  readonly no: number
  readonly name: string
  readonly stock: number
  readonly opened: string | null
  readonly claims: readonly { readonly time: string; readonly buyer: string }[]
}

export interface RushRow {
  readonly b: string
  readonly no: number
  readonly name: string
  readonly buyers: number
  readonly waiting: number
}

/** RPT-06 몰린 상품 (몰린 손님 큰 순, 같으면 입력 순서) */
export function reportRush(input: { readonly products: readonly RushProductInput[] }): RushRow[] {
  const rows: RushRow[] = []
  for (const product of input.products) {
    if (product.opened === null) continue
    const limit = parseTime(product.opened, 'opened') + RUSH_WINDOW_MS
    const buyers = new Set<string>()
    for (const claim of product.claims) if (parseTime(claim.time, 'claims.time') <= limit) buyers.add(claim.buyer)
    if (buyers.size === 0) continue
    rows.push({ b: product.b, no: product.no, name: product.name, buyers: buyers.size, waiting: Math.max(buyers.size - product.stock, 0) })
  }
  // Array.prototype.sort는 안정 정렬이다(같으면 입력 순서)
  return rows.sort((a, b) => b.buyers - a.buyers)
}

export interface CompareNumbers {
  readonly sales: number
  readonly qty: number
  readonly buyers: number
}

export interface CompareLast extends CompareNumbers {
  readonly date: string
  readonly diff: CompareNumbers
}

export interface CompareRecent extends CompareNumbers {
  readonly count: number
  readonly diff: CompareNumbers
}

export interface CompareView {
  readonly last: CompareLast | null
  readonly recent: CompareRecent | null
}

const diffOf = (current: CompareNumbers, other: CompareNumbers): CompareNumbers => ({
  sales: current.sales - other.sales,
  qty: current.qty - other.qty,
  buyers: current.buyers - other.buyers,
})

/** RPT-08 지난 방송(past[0])·앞선 4번 평균(정수 몫)과 비교. past는 늦은 날짜부터 */
export function reportCompare(input: { readonly current: CompareNumbers; readonly past: readonly (CompareNumbers & { readonly date: string })[] }): CompareView {
  const first = input.past[0]
  if (first === undefined) return { last: null, recent: null }
  const lastValues = { sales: first.sales, qty: first.qty, buyers: first.buyers }
  const recent = input.past.slice(0, COMPARE_RECENT_MAX)
  const count = recent.length
  const sum = recent.reduce((total, item) => ({ sales: total.sales + item.sales, qty: total.qty + item.qty, buyers: total.buyers + item.buyers }), { sales: 0, qty: 0, buyers: 0 })
  const average = { sales: Math.floor(sum.sales / count), qty: Math.floor(sum.qty / count), buyers: Math.floor(sum.buyers / count) }
  return {
    last: { date: first.date, ...lastValues, diff: diffOf(input.current, lastValues) },
    recent: { count, ...average, diff: diffOf(input.current, average) },
  }
}
