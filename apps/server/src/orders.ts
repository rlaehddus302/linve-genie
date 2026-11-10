// 주문 탭 목록·주문 상세 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항 … 주문 목록 … 상세 내역"). 응답 모양은 apps/web/src/api/order-types.ts와 같다.
// - 읽기만 한다: 엔진 이벤트·발송함·택배·문자 기록을 쓰지 않는다. 판정은 하지 않고 코어 조회 결과(정산 묶음·찜·구매자·방송 설정 스냅샷)를 옮겨 담는다.
// - 실제 날짜만 (리허설 범위는 읽지 않는다). 봉인 날짜(30일)는 봉인 장부로 다시 세운 상태로 읽는다 — 찜 시각이 장부에 없어 예약 시각은 null(D-PL1-03, 지어내지 않는다).
//   장부를 읽을 수 없는 날짜는 목록에서 빠지고(오류 로그 — 코드·날짜만), 그 날짜 상세는 500 LEDGER_UNREADABLE.
// - 목록: 최근 날짜부터, 같은 날짜 안에서는 첫 예약이 늦은 손님부터(예약 시각을 모르면 뒤, 같으면 구매자 ID 순). 쪽은 날짜 단위로 —
//   주문이 있는 날짜를 40줄 이상 또는 14날짜가 될 때까지 담고, next = 이 쪽의 가장 오래된 날짜(다음 쪽 ?before=).
// - 날짜마다 엔진에서 나온 줄(성함 빼고)은 (판매자, 범위)마다 한 벌 캐시한다 — 범위 seq·봉인 여부가 같으면 다시 쓴다(손님 기록 재료 캐시와 같은 방식, D-CRM1-11).
//   범위 상태는 공용 캐시를 밀어내지 않는 읽기(readDetached)로 불러온다. 성함은 날짜마다 배송지를 한 번에 읽는다(묶음마다 따로 읽지 않는다).
// - 전화번호·배송지는 상세 응답에만 (판매자 화면). 로그·오류 응답에 남기지 않는다. 받은 값(구매자 ID)은 오류 응답에 되돌려 보내지 않는다.
import { DEFAULT_SETTINGS, currentBuyerOf, getBuyer, getSettlement, isValidDate, listBroadcasts, listSettlements, type BuyerInfo, type EngineState, type PaymentStatus } from '@livejjim/core'
import { itemText } from '@livejjim/documents'
import type { Context, Hono } from 'hono'
import type { SessionContext } from './auth.ts'
import { buyerParam } from './closing.ts'
import { realScopes, type DayBundle, type ScopeRow } from './customers/facts.ts'
import type { CustomerService } from './customers/service.ts'
import type { Db } from './db/database.ts'
import { apiError, type FieldProblem } from './errors.ts'
import type { LogSink } from './log.ts'
import { lookupOf, type ScopeLookup } from './packing.ts'
import type { ParcelService } from './parcel/service.ts'
import { platformOfKey } from './platform.ts'
import type { ReceiptSmsService } from './receipt-sms.ts'
import { LEDGER_UNREADABLE_MESSAGE, readSealed } from './sealed-state.ts'
import { iso, kstDate, type Clock } from './time.ts'
import type { ScopeWriter } from './writer.ts'

/** 한 쪽에 담는 줄 수 (이만큼 차면 그 날짜까지만) */
export const ORDERS_PAGE_ROWS = 40
/** 한 쪽에 담는 날짜 수 상한 */
export const ORDERS_PAGE_DATES = 14
/** 상세의 다른 날짜 거래 줄 수 상한 */
export const ORDER_HISTORY_MAX = 20
/** 날짜 줄 캐시 자리 수 (판매자 여럿 × 날짜 — 넘으면 오래 안 쓴 것부터 버린다) */
const DAY_CACHE_MAX = 2000

// ── 응답 모양 (apps/web/src/api/order-types.ts와 같다) ──────────────────

export type OrderPlatform = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'BAND' | 'SMS'

export interface OrderRow {
  readonly date: string
  readonly buyer: string
  readonly name: string | null
  readonly nickname: string
  readonly platform: OrderPlatform | null
  readonly total: number
  readonly itemCount: number
  readonly firstClaimAt: string | null
}

export interface OrdersView {
  readonly today: string
  readonly orders: readonly OrderRow[]
  readonly more: boolean
  readonly next: string | null
}

export interface OrderItem {
  readonly no: number
  readonly name: string
  readonly price: number
  readonly qty: number
}

export interface OrderHistoryLine {
  readonly date: string
  readonly buyer: string
  readonly total: number
  readonly itemCount: number
  readonly openable: boolean
}

export type OrderShippingMode = 'DEFAULT' | 'PICKUP' | 'COMBINED' | 'FIXED'

export interface OrderDetailView {
  readonly date: string
  readonly buyer: string
  readonly name: string | null
  readonly nickname: string
  readonly platform: OrderPlatform | null
  readonly phone: string | null
  readonly address: { readonly address: string; readonly detail: string; readonly zip: string } | null
  readonly items: readonly OrderItem[]
  readonly claimedAt: string | null
  readonly itemCount: number
  readonly subtotal: number
  readonly shipping: number
  readonly shippingRule: { readonly baseFee: number; readonly freeThreshold: number | null; readonly mode: OrderShippingMode }
  readonly adjustments: number
  readonly total: number
  readonly received: number
  readonly refundDue: number
  readonly payment: PaymentStatus
  readonly history: { readonly count: number; readonly total: number; readonly lines: readonly OrderHistoryLine[] }
}

// ── 날짜 줄 ─────────────────────────────────────────────────────────────

/** 날짜 하나의 주문 줄 (성함 빼고 — 엔진 상태만으로 정해진다) */
interface DayOrder {
  readonly buyer: string
  readonly nickname: string
  readonly platform: OrderPlatform | null
  readonly total: number
  readonly itemCount: number
  readonly firstClaimAt: string | null
}

interface DayEntry {
  readonly seq: number
  readonly sealed: boolean
  /** 첫 예약이 늦은 손님부터 */
  readonly orders: readonly DayOrder[]
  readonly byBuyer: ReadonlyMap<string, DayOrder>
}

/** 구매자 → 찜한 곳: 채팅 구매자는 키의 플랫폼, 문자 구매자는 SMS, 모르면 null */
export function orderPlatformOf(info: BuyerInfo | null): OrderPlatform | null {
  if (info === null) return null
  if (info.kind === 'sms') return 'SMS'
  return platformOfKey(info.id)
}

/** 묶음(지금의 구매자)의 그 날짜 확정 찜: 수량 합과 가장 이른 예약 시각(R-6 실제 시각 — 봉인 장부로 세운 상태는 0이라 모름) */
function claimFacts(lookup: ScopeLookup, buyer: string, date: string): { qty: number; first: number | null } {
  let qty = 0
  let first: number | null = null
  for (const claim of lookup.confirmed.get(buyer) ?? []) {
    if (lookup.dates.get(claim.broadcast) !== date) continue
    qty += claim.qty
    if (claim.rankTime > 0 && (first === null || claim.rankTime < first)) first = claim.rankTime
  }
  return { qty, first }
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** 첫 예약이 늦은 것 먼저, 모르면 뒤, 같으면 구매자 ID 순 (결정적) */
function latestFirst(a: DayOrder, b: DayOrder): number {
  if (a.firstClaimAt !== b.firstClaimAt) {
    if (a.firstClaimAt === null) return 1
    if (b.firstClaimAt === null) return -1
    return byText(b.firstClaimAt, a.firstClaimAt)
  }
  return byText(a.buyer, b.buyer)
}

/** 범위 상태 → 그 날짜의 주문 줄 (품목이 있는 정산 묶음마다 하나 — 코어 값 그대로) */
export function dayOrdersOf(state: EngineState, date: string): DayOrder[] {
  const lookup = lookupOf(state)
  const out: DayOrder[] = []
  for (const settlement of listSettlements(state)) {
    if (settlement.date !== date || settlement.items.length === 0) continue
    const info = getBuyer(state, settlement.buyer)
    const { qty, first } = claimFacts(lookup, settlement.buyer, date)
    out.push({
      buyer: settlement.buyer,
      nickname: info?.display ?? '',
      platform: orderPlatformOf(info),
      total: settlement.total,
      itemCount: qty,
      firstClaimAt: first === null ? null : iso(first),
    })
  }
  return out.sort(latestFirst)
}

// ── 서비스 ──────────────────────────────────────────────────────────────

export interface OrderDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly log: LogSink
  /** 성함·전화·주소 (택배 배송지). 없으면 성함·주소는 null */
  readonly parcels?: ParcelService
  /** 문자 손님의 아는 번호 (영수증 문자). 없으면 배송지 번호만 */
  readonly receiptSms?: ReceiptSmsService
  /** 다른 날짜 거래 (손님 기록). 없으면 거래 0 */
  readonly customers?: CustomerService
}

type StateRead = { kind: 'ok'; state: EngineState; seq: number; sealed: boolean } | { kind: 'missing' } | { kind: 'unreadable' }

export type DetailOutcome = { kind: 'ok'; value: OrderDetailView } | { kind: 'not_found' } | { kind: 'unreadable' }

export class OrderService {
  readonly #deps: OrderDeps
  /** (판매자, 범위 ID) → 그 범위의 주문 줄 한 벌 */
  readonly #days = new Map<string, DayEntry>()

  constructor(deps: OrderDeps) {
    this.#deps = deps
  }

  /** 범위 상태 (봉인 날짜는 봉인 장부로 다시 세운 상태). 읽기만 한다 */
  async #state(sellerId: string, scope: ScopeRow): Promise<StateRead> {
    if (scope.sealedAt !== null) {
      const read = await readSealed(this.#deps.db, sellerId, scope.date)
      if (!read.sealed || read.state === null) {
        this.#deps.log({ level: 'error', code: 'LEDGER_UNREADABLE', date: scope.date })
        return { kind: 'unreadable' }
      }
      return { kind: 'ok', state: read.state, seq: scope.seq, sealed: true }
    }
    const runtime = await this.#deps.writer.readDetached(sellerId, scope.date, false)
    if (runtime.seq === 0 || runtime.scopeId !== scope.id) return { kind: 'missing' }
    return { kind: 'ok', state: runtime.state, seq: runtime.seq, sealed: false }
  }

  #remember(slot: string, entry: DayEntry): void {
    this.#days.delete(slot)
    this.#days.set(slot, entry)
    while (this.#days.size > DAY_CACHE_MAX) this.#days.delete(this.#days.keys().next().value as string)
  }

  /** 날짜 하나의 주문 줄 (캐시 — 범위 seq·봉인 여부가 같으면 다시 쓴다). 읽을 수 없으면 null */
  async #day(sellerId: string, scope: ScopeRow, known?: StateRead): Promise<DayEntry | null> {
    const slot = JSON.stringify([sellerId, scope.id])
    const sealed = scope.sealedAt !== null
    const hit = this.#days.get(slot)
    if (known === undefined && hit !== undefined && hit.sealed === sealed && hit.seq >= scope.seq) {
      this.#remember(slot, hit)
      return hit
    }
    const read = known ?? (await this.#state(sellerId, scope))
    if (read.kind !== 'ok') return null
    if (hit !== undefined && hit.sealed === read.sealed && hit.seq === read.seq) return hit
    const orders = dayOrdersOf(read.state, scope.date)
    const entry: DayEntry = { seq: read.seq, sealed: read.sealed, orders, byBuyer: new Map(orders.map((order) => [order.buyer, order])) }
    this.#remember(slot, entry)
    return entry
  }

  /** 그 날짜 묶음마다 배송지 받는 분 이름·전화·주소 (택배 기능이 없으면 빈 표) */
  async #addresses(sellerId: string, date: string) {
    return this.#deps.parcels === undefined ? new Map() : this.#deps.parcels.openAddresses(sellerId, date)
  }

  /** 주문 목록 (before가 있으면 그 날짜보다 앞선 날짜들만) */
  async list(sellerId: string, before: string | null): Promise<OrdersView> {
    const today = kstDate(this.#deps.clock.now())
    const scopes = (await realScopes(this.#deps.db, sellerId)).filter((scope) => before === null || scope.date < before).sort((a, b) => byText(b.date, a.date))
    const orders: OrderRow[] = []
    let dates = 0
    let last: string | null = null
    let index = 0
    for (; index < scopes.length; index += 1) {
      if (orders.length >= ORDERS_PAGE_ROWS || dates >= ORDERS_PAGE_DATES) break
      const scope = scopes[index] as ScopeRow
      const day = await this.#day(sellerId, scope)
      if (day === null || day.orders.length === 0) continue
      const addresses = await this.#addresses(sellerId, scope.date)
      for (const order of day.orders) orders.push({ date: scope.date, buyer: order.buyer, name: addresses.get(order.buyer)?.name ?? null, ...OrderService.#rowPart(order) })
      dates += 1
      last = scope.date
    }
    // 더 있는지: 남은 날짜 중 주문이 있는 날짜가 하나라도 있으면 (빈 날짜만 남았으면 다음 쪽이 비지 않게 false)
    let more = false
    for (; index < scopes.length && last !== null; index += 1) {
      const day = await this.#day(sellerId, scopes[index] as ScopeRow)
      if (day !== null && day.orders.length > 0) {
        more = true
        break
      }
    }
    return { today, orders, more, next: more ? last : null }
  }

  static #rowPart(order: DayOrder): Omit<OrderRow, 'date' | 'buyer' | 'name'> {
    return { nickname: order.nickname, platform: order.platform, total: order.total, itemCount: order.itemCount, firstClaimAt: order.firstClaimAt }
  }

  /** 주문 한 건 상세 (합쳐진 구매자 ID면 지금의 구매자로 푼다). 품목도 정산 기록도 없는 묶음·모르는 구매자는 없음 */
  async detail(sellerId: string, date: string, buyer: string): Promise<DetailOutcome> {
    const scopes = await realScopes(this.#deps.db, sellerId)
    const scope = scopes.find((item) => item.date === date)
    if (scope === undefined) return { kind: 'not_found' }
    const read = await this.#state(sellerId, scope)
    if (read.kind === 'unreadable') return { kind: 'unreadable' }
    if (read.kind === 'missing') return { kind: 'not_found' }
    const { state } = read
    if (getBuyer(state, buyer) === null) return { kind: 'not_found' }
    const root = currentBuyerOf(state, buyer) ?? buyer
    const settlement = getSettlement(state, root, date)
    if (settlement.items.length === 0 && settlement.records.length === 0) return { kind: 'not_found' }
    const info = getBuyer(state, root)
    const lookup = lookupOf(state)
    const claims = (lookup.confirmed.get(root) ?? []).filter((claim) => lookup.dates.get(claim.broadcast) === date)
    const items: OrderItem[] = claims
      .slice()
      .sort((a, b) => a.no - b.no || (lookup.order.get(a.broadcast) ?? 0) - (lookup.order.get(b.broadcast) ?? 0) || a.seq - b.seq)
      .map((claim) => {
        const price = claim.price ?? 0
        return { no: claim.no, name: itemText(lookup.names.get(claim.product) ?? '', claim.variant, price, 1), price, qty: claim.qty }
      })
    const { qty, first } = claimFacts(lookup, root, date)
    const address = (await this.#addresses(sellerId, date)).get(root) ?? null
    const phone = address !== null ? address.phone : this.#deps.receiptSms === undefined ? null : await this.#deps.receiptSms.knownPhone(sellerId, date, state, root)
    // 그 날짜 정산 설정 = 그 날짜 첫 방송(선언 순서)의 스냅샷 (DOMAIN_RULES 설정 스냅샷, D-070 — 코어 정산과 같은 규칙)
    const settings = listBroadcasts(state).find((broadcast) => broadcast.date === date)?.settings ?? DEFAULT_SETTINGS
    // 이 날짜 줄 캐시를 같은 상태로 새로 둔다 (목록과 숫자가 같게)
    await this.#day(sellerId, scope, read)
    return {
      kind: 'ok',
      value: {
        date,
        buyer: root,
        name: address?.name ?? null,
        nickname: info?.display ?? '',
        platform: orderPlatformOf(info),
        phone,
        address: address === null ? null : { address: address.address, detail: address.detail, zip: address.zip },
        items,
        claimedAt: first === null ? null : iso(first),
        itemCount: qty,
        subtotal: settlement.subtotal,
        shipping: settlement.shipping,
        shippingRule: { baseFee: settings['shipping.baseFee'], freeThreshold: settings['shipping.freeThreshold'], mode: settlement.shippingOverride ?? 'DEFAULT' },
        adjustments: settlement.adjustments,
        total: settlement.total,
        received: settlement.received,
        refundDue: settlement.refundDue,
        payment: settlement.payment,
        history: await this.#history(sellerId, date, root, scopes),
      },
    }
  }

  /**
   * 이 손님의 다른 날짜 거래: 손님 기록 묶음(D-CRM1-02) 중 이 날짜를 빼고 품목이 있는 것, 최근 날짜부터 20줄. count·total은 다른 날짜 전부.
   * 금액·개수는 그 날짜 주문 줄(코어 최종 금액·수량 합)로, 그 날짜를 읽을 수 없으면 손님 기록 값(상품 합계·수량 합)으로
   */
  async #history(sellerId: string, date: string, root: string, scopes: readonly ScopeRow[]): Promise<OrderDetailView['history']> {
    const none = { count: 0, total: 0, lines: [] }
    if (this.#deps.customers === undefined) return none
    const record = await this.#deps.customers.dayRecord(sellerId, date, root)
    if (record === null) return none
    const others = record.filter((bundle: DayBundle) => bundle.date !== date && bundle.items >= 1).sort((a, b) => byText(b.date, a.date))
    const scopeOf = new Map(scopes.map((scope) => [scope.date, scope]))
    const lines: OrderHistoryLine[] = []
    let total = 0
    for (const bundle of others) {
      const scope = scopeOf.get(bundle.date)
      const day = scope === undefined ? null : await this.#day(sellerId, scope)
      const found = day?.byBuyer.get(bundle.buyer)
      const line: OrderHistoryLine = {
        date: bundle.date,
        buyer: bundle.buyer,
        total: found?.total ?? bundle.subtotal,
        itemCount: found?.itemCount ?? bundle.items,
        openable: !bundle.archived,
      }
      total += line.total
      if (lines.length < ORDER_HISTORY_MAX) lines.push(line)
    }
    return { count: others.length, total, lines }
  }
}

// ── 경로 ────────────────────────────────────────────────────────────────

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalid = (problems: readonly FieldProblem[]) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)

/** 주문 탭 경로 (D-UX4-125). 로그인·Cache-Control: no-store는 /api 공통 미들웨어가 한다. 다른 판매자의 날짜는 없는 것과 같은 404 */
export function registerOrderRoutes(api: Hono<Env>, orders: OrderService): void {
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId

  // 주문 목록 (?before=YYYY-MM-DD 다음 쪽)
  api.get('/orders', async (c) => {
    const before = c.req.query('before')
    if (before !== undefined && !isValidDate(before)) return invalid([{ field: 'before', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    return c.json(await orders.list(sellerOf(c), before ?? null))
  })

  // 주문 한 건 상세 (?buyer=). 실제 날짜만: ?rehearsal=true는 404, 다른 값은 400
  api.get('/days/:date/order', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = c.req.query('rehearsal')
    if (rehearsal === 'true') return notFound()
    if (rehearsal !== undefined && rehearsal !== 'false') return invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요.' }])
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return apiError(buyer.error.status, buyer.error.code, buyer.error.message, buyer.error.problems ?? [])
    const outcome = await orders.detail(sellerOf(c), date, buyer.buyer)
    if (outcome.kind === 'unreadable') return apiError(500, 'LEDGER_UNREADABLE', LEDGER_UNREADABLE_MESSAGE)
    return outcome.kind === 'not_found' ? notFound() : c.json(outcome.value)
  })
}
