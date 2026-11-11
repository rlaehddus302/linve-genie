// 주문 탭 목록·주문 상세 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항 … 주문 목록 … 상세 내역"). 응답 모양은 apps/web/src/api/order-types.ts와 같다.
// - 읽기만 한다: 엔진 이벤트·발송함·택배·문자 기록을 쓰지 않는다. 판정은 하지 않고 코어 조회 결과(정산 묶음·찜·구매자·방송 설정 스냅샷)를 옮겨 담는다.
// - 실제 날짜만 (리허설 범위는 읽지 않는다). 봉인 날짜(30일)는 봉인 장부로 다시 세운 상태로 읽는다 — 찜 시각이 장부에 없어 예약 시각은 null(D-PL1-03, 지어내지 않는다).
//   장부를 읽을 수 없는 날짜는 목록에서 빠지고(오류 로그 — 코드·날짜만), 그 날짜 상세는 500 LEDGER_UNREADABLE.
// - 목록: 최근 날짜부터, 같은 날짜 안에서는 첫 예약이 늦은 손님부터(예약 시각을 모르면 뒤, 같으면 구매자 ID 순). 쪽은 날짜 단위로 —
//   주문이 있는 날짜를 40줄 이상 또는 14날짜가 될 때까지 담고, next = 이 쪽의 가장 오래된 날짜(다음 쪽 ?before=).
// - 날짜마다 엔진에서 나온 줄(성함 빼고)은 (판매자, 범위)마다 한 벌 캐시한다 — 범위 seq·봉인 여부가 같으면 다시 쓴다(손님 기록 재료 캐시와 같은 방식, D-CRM1-11).
//   범위 상태는 공용 캐시를 밀어내지 않는 읽기(readDetached)로 불러온다. 성함은 날짜마다 배송지를 한 번에 읽는다(묶음마다 따로 읽지 않는다).
// - 전화번호·배송지는 상세 응답에만 (판매자 화면). 로그·오류 응답에 남기지 않는다. 받은 값(구매자 ID)은 오류 응답에 되돌려 보내지 않는다.
// - D-UX4-126 (사용자 지시 2026-11-11 주문 탭 수정): 목록 줄마다 아직 모르는 손님 정보(missing — 성함·휴대폰 번호·주소 순).
//   배송지는 DB라 요청마다 읽고, 번호 키(엔진 상태만으로 정해짐)는 날짜 캐시에 두어 번호 기록은 날짜마다 한 번에 키만 본다(번호를 풀지 않는다).
//   배송지 보관 기간(30일)이 지난 날짜는 더 넣을 수 없으니 빈 목록(지난 주문에 "모름"을 띄우지 않는다).
// - D-UX4-126 주문 한 건 내보내기: GET /api/days/:date/order.csv·order.xlsx?buyer= — 상세와 같은 검사·404. 휴대폰 번호·주소는 넣지 않는다
//   (AUTO: 파일은 메신저로 넘겨지기 쉽다 — 손님 엑셀도 연락처는 기본으로 빼는 것과 같은 쪽).
import { DEFAULT_SETTINGS, currentBuyerOf, formatWon, getBuyer, getSettlement, isValidDate, listBroadcasts, listSettlements, type BuyerInfo, type EngineState, type PaymentStatus } from '@livejjim/core'
import { itemText, textRowsToXlsx } from '@livejjim/documents'
import type { Context, Hono } from 'hono'
import type { SessionContext } from './auth.ts'
import { buyerParam } from './closing.ts'
import { realScopes, type DayBundle, type ScopeRow } from './customers/facts.ts'
import type { CustomerService } from './customers/service.ts'
import type { Db } from './db/database.ts'
import { apiError, type FieldProblem } from './errors.ts'
import { MIME, fileNamePart, fileResponse } from './files.ts'
import type { LogSink } from './log.ts'
import { lookupOf, type ScopeLookup } from './packing.ts'
import type { ParcelAddress } from './parcel/rules.ts'
import type { ParcelService } from './parcel/service.ts'
import { platformOfKey } from './platform.ts'
import { receiptPhoneKeys, type ReceiptSmsService } from './receipt-sms.ts'
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
  /** 아직 모르는 손님 정보 (D-UX4-126). 이 순서로, 다 알면 빈 목록. 배송지 보관 기간이 지난 날짜는 빈 목록 */
  readonly missing: readonly OrderInfoField[]
}

/** 손님 정보 칸 (D-UX4-126) */
export type OrderInfoField = 'name' | 'phone' | 'address'

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
  /** 구매자 → 번호 키 (receiptPhoneKeys — 상태·날짜만으로 정해진다, D-UX4-126) */
  readonly phoneKeys: ReadonlyMap<string, readonly string[]>
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
    const entry: DayEntry = {
      seq: read.seq,
      sealed: read.sealed,
      orders,
      byBuyer: new Map(orders.map((order) => [order.buyer, order])),
      phoneKeys: new Map(orders.map((order) => [order.buyer, receiptPhoneKeys(read.state, scope.date, order.buyer)])),
    }
    this.#remember(slot, entry)
    return entry
  }

  /** 그 날짜 묶음마다 배송지 받는 분 이름·전화·주소 (택배 기능이 없으면 빈 표) */
  async #addresses(sellerId: string, date: string): Promise<Map<string, ParcelAddress>> {
    return this.#deps.parcels === undefined ? new Map<string, ParcelAddress>() : this.#deps.parcels.openAddresses(sellerId, date)
  }

  /**
   * 그 날짜 줄마다 모르는 손님 정보 (D-UX4-126): 성함·주소는 배송지로, 휴대폰 번호는 배송지 번호 → 문자 번호 기록(키만, 한 번에) 순.
   * 배송지 보관 기간이 지난 날짜는 모두 빈 목록
   */
  async #missing(sellerId: string, date: string, day: DayEntry, addresses: ReadonlyMap<string, ParcelAddress>): Promise<Map<string, OrderInfoField[]>> {
    const out = new Map<string, OrderInfoField[]>()
    if (this.#deps.parcels?.addressExpired(date) === true) {
      for (const order of day.orders) out.set(order.buyer, [])
      return out
    }
    const ask = new Map<string, readonly string[]>()
    for (const order of day.orders) if ((addresses.get(order.buyer)?.phone ?? '') === '') ask.set(order.buyer, day.phoneKeys.get(order.buyer) ?? [])
    const withPhone = ask.size === 0 || this.#deps.receiptSms === undefined ? new Set<string>() : await this.#deps.receiptSms.buyersWithPhone(sellerId, ask)
    for (const order of day.orders) {
      const address = addresses.get(order.buyer)
      const fields: OrderInfoField[] = []
      if ((address?.name ?? '') === '') fields.push('name')
      if (ask.has(order.buyer) && !withPhone.has(order.buyer)) fields.push('phone')
      if ((address?.address ?? '') === '') fields.push('address')
      out.set(order.buyer, fields)
    }
    return out
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
      const missing = await this.#missing(sellerId, scope.date, day, addresses)
      for (const order of day.orders) {
        orders.push({ date: scope.date, buyer: order.buyer, name: addresses.get(order.buyer)?.name ?? null, ...OrderService.#rowPart(order), missing: missing.get(order.buyer) ?? [] })
      }
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

  static #rowPart(order: DayOrder): Omit<OrderRow, 'date' | 'buyer' | 'name' | 'missing'> {
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

// ── 주문 한 건 내보내기 (D-UX4-126) ────────────────────────────────────

/**
 * 내보내기 표 (CSV·엑셀이 같은 줄): 위 묶음(닉네임·성함·예약 날짜) → 빈 줄 → 상품 표(번호·상품명·수량·가격) → 빈 줄 → 금액 묶음.
 * 휴대폰 번호·주소는 넣지 않는다 (D-UX4-126 AUTO — 파일은 메신저로 넘겨지기 쉽다. 손님 엑셀도 연락처는 기본으로 뺀다).
 * 금액은 정수 원 그대로 formatWon (가격 = 한 개 가격 × 수량)
 */
export function orderExportRows(view: OrderDetailView): string[][] {
  const day = view.claimedAt === null ? view.date : kstDate(Date.parse(view.claimedAt))
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const rows: string[][] = [
    ['닉네임', view.nickname],
    ['성함', view.name ?? '모름'],
    ['예약 날짜', `${String(year)}년 ${String(month)}월 ${String(date)}일`],
    [],
    ['번호', '상품명', '수량', '가격'],
    ...view.items.map((item) => [String(item.no), item.name, String(item.qty), formatWon(item.price * item.qty)]),
    [],
    ['총 개수', `${String(view.itemCount)}개`],
    ['배송비', formatWon(view.shipping)],
  ]
  // 앱 화면(signedWon)과 같이 빼기만 − (U+2212) — 수식 시작 글자 '-'가 아니라 CSV에서 따옴표가 붙지 않는다
  if (view.adjustments !== 0) rows.push(['할인·추가', `${view.adjustments < 0 ? '−' : ''}${formatWon(Math.abs(view.adjustments))}`])
  rows.push(['총 금액', formatWon(view.total)], ['받은 금액', formatWon(view.received)], ['남은 금액', formatWon(Math.max(view.total - view.received, 0))])
  if (view.refundDue > 0) rows.push(['돌려줄 돈', formatWon(view.refundDue)])
  return rows
}

/** 스프레드시트 수식으로 읽히는 첫 글자 (닉네임·상품명은 믿을 수 없는 글 — 앞에 '를 붙여 글로 둔다) */
const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r'])

/** CSV 칸 하나: 수식 막기 → RFC 4180 따옴표(쉼표·따옴표·줄바꿈이 있으면 감싸고 "는 ""로) */
export function csvCell(value: string): string {
  const safe = value !== '' && FORMULA_START.has(value[0] as string) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** CSV 바이트: UTF-8 BOM(엑셀이 한글을 바로 읽게) + CRLF 줄 */
export function orderCsv(rows: readonly (readonly string[])[]): Uint8Array {
  return new TextEncoder().encode(`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`)
}

/** 엑셀: 첫 줄(굵게)은 항목·내용, 모든 칸은 글 칸(수식이 되지 않는다 — textRowsToXlsx) */
export async function orderXlsx(rows: readonly (readonly string[])[]): Promise<Uint8Array> {
  return textRowsToXlsx('주문', ['항목', '내용', '', ''], rows, [12, 36, 8, 14])
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

  /** 상세·내보내기 공통 (?buyer=). 실제 날짜만: ?rehearsal=true는 404, 다른 값은 400 */
  const detailOf = async (c: Context<Env>): Promise<Response | OrderDetailView> => {
    const date = c.req.param('date') ?? ''
    if (!isValidDate(date)) return notFound()
    const rehearsal = c.req.query('rehearsal')
    if (rehearsal === 'true') return notFound()
    if (rehearsal !== undefined && rehearsal !== 'false') return invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요.' }])
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return apiError(buyer.error.status, buyer.error.code, buyer.error.message, buyer.error.problems ?? [])
    const outcome = await orders.detail(sellerOf(c), date, buyer.buyer)
    if (outcome.kind === 'unreadable') return apiError(500, 'LEDGER_UNREADABLE', LEDGER_UNREADABLE_MESSAGE)
    return outcome.kind === 'not_found' ? notFound() : outcome.value
  }

  // 주문 한 건 상세
  api.get('/days/:date/order', async (c) => {
    const view = await detailOf(c)
    return view instanceof Response ? view : c.json(view)
  })

  // 주문 한 건 내보내기 (D-UX4-126 — 앱 [내보내기]). 파일 이름: 주문-<날짜>-<닉네임>.csv/.xlsx (영문 대체 이름 order-<날짜>)
  api.get('/days/:date/order.csv', async (c) => {
    const view = await detailOf(c)
    if (view instanceof Response) return view
    return fileResponse(orderCsv(orderExportRows(view)), MIME.csv, `주문-${view.date}-${fileNamePart(view.nickname)}.csv`, `order-${view.date}.csv`)
  })
  api.get('/days/:date/order.xlsx', async (c) => {
    const view = await detailOf(c)
    if (view instanceof Response) return view
    return fileResponse(await orderXlsx(orderExportRows(view)), MIME.xlsx, `주문-${view.date}-${fileNamePart(view.nickname)}.xlsx`, `order-${view.date}.xlsx`)
  })
}
