// 손님 기록·"모든 손님"·손님 메모·설정 "손님 관리" (CRM1, SPEC BUY-06·BUY-07, D-CRM1-02~D-CRM1-11).
// - 판정은 하지 않는다. 날짜별 재료(facts.ts — 코어 조회 결과)를 표지로 모아 요약 순수 함수(summary.ts)로 센다.
// - 날짜별 구매자 X의 기록 (D-CRM1-02) = 그날 X의 묶음 + X 묶음 구성원 각자의 표지로 다른 실제 날짜에서 찾은 그날 그 구매자의 지금의 구매자 묶음 — 한 번만
//   (찾은 묶음의 다른 구성원 표지로 다시 넓히지 않는다). 같은 (날짜, 묶음)은 한 번. 기록 묶음만 센다.
// - "모든 손님"은 표지마다 한 줄. 줄 ID는 서버가 만든 불투명 값(판매자·표지의 SHA-256 앞 32자) — 표지(채널 ID·전화번호 키)를 응답에 내지 않는다.
// - 오늘 날짜는 서버 시계의 KST 날짜다(화면 기기 시계와 상관없다, AC-CRM1-10).
// - 이 서비스는 엔진 이벤트·발송함을 쓰지 않는다. 메모·설정만 자기 표에 쓴다. 메모 글·표지는 로그에 남기지 않는다.
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { customerMemos, customerSettings } from '../db/schema.ts'
import type { LogSink } from '../log.ts'
import type { Platform } from '../platform.ts'
import { openSellerKey, sha256Hex } from '../secrets.ts'
import { findSeller } from '../store.ts'
import { kstDate, type Clock } from '../time.ts'
import type { ScopeWriter } from '../writer.ts'
import { allFacts, type DayBundle, type DayFacts } from './facts.ts'
import { DEFAULT_CUSTOMER_SETTINGS, customerSummary, isUnpaid, type CustomerSettings, type CustomerSummary } from './summary.ts'

export const CUSTOMERS_PAGE_SIZE = 20
export const CUSTOMER_DAYS_PAGE_SIZE = 20

export const CUSTOMER_SORTS = ['total', 'recent', 'unpaid'] as const
export type CustomerSort = (typeof CUSTOMER_SORTS)[number]
export const CUSTOMER_FILTERS = ['all', 'regular', 'caution'] as const
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number]

export interface CustomerDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly log: LogSink
  /** 판매자 전화번호 키를 여는 주 키 (끝자리만 말한 문자 구매자를 가려낸다, TD-CRM1-001) */
  readonly masterKey: Buffer
}

export interface MemoView {
  readonly text: string
  /** 저장한 시각 (UTC ISO) — 화면은 "10월 26일(월) 저장" */
  readonly savedAt: string
}

/** "모든 손님" 줄 하나 */
export interface CustomerRow extends CustomerSummary {
  /** 불투명 손님 ID */
  readonly id: string
  /** 가장 최근 실제 날짜의 표시 이름 */
  readonly name: string
  /** 채팅 구매자의 플랫폼, 문자 손님은 null */
  readonly platform: Platform | null
  /** "유튜브"·"인스타그램"·"틱톡"·"문자 · 끝자리 1234" */
  readonly kindLabel: string
  readonly phoneLast4: string | null
  /** 가장 최근 실제 날짜에서 그 구매자가 차단 중 */
  readonly blocked: boolean
  /** 그 표지가 나온 가장 최근 실제 날짜와 그날 그 구매자 ID (차단은 그 날짜 구매자 화면에서, D-CRM1-09) */
  readonly latestDate: string
  readonly latestBuyer: string
}

/** 날짜별 구매자 목록 꼬리표 (지금의 구매자마다) */
export interface DayCustomer extends CustomerSummary {
  readonly buyer: string
}

/** 구매자 자세히의 구성원 하나 (메모 칸) */
export interface DayMember {
  readonly buyer: string
  readonly name: string
  readonly platform: Platform | null
  readonly kindLabel: string
  readonly phoneLast4: string | null
  /** 불투명 손님 ID — 표지가 없으면(전화번호 없는 문자 손님) null: 메모 칸 대신 안내 문장 */
  readonly customer: string | null
  readonly memo: MemoView | null
}

/** 손님 자세히의 날짜 줄 */
export interface CustomerDay {
  readonly date: string
  /** 그날 지금의 구매자 (그날 구매자 자세히로) */
  readonly buyer: string
  /** 그날 이름 */
  readonly name: string
  readonly subtotal: number
  readonly payment: DayBundle['payment']
  /** 미입금 날인지 */
  readonly unpaid: boolean
}

export interface CustomerListQuery {
  readonly sort: CustomerSort
  readonly filter: CustomerFilter
  readonly q: string | null
  readonly offset: number
}

const PLATFORM_LABELS: Readonly<Record<Platform, string>> = { YOUTUBE: '유튜브', INSTAGRAM: '인스타그램', TIKTOK: '틱톡' }

export function kindLabelOf(platform: Platform | null, phoneLast4: string | null): string {
  if (platform !== null) return PLATFORM_LABELS[platform]
  return phoneLast4 === null ? '문자' : `문자 · 끝자리 ${phoneLast4}`
}

/** 이름 → ID 순 (결정적, 코드 포인트 순) */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** 판매자 하나의 지금 기록 (요청마다 만든다 — 날짜 재료는 캐시) */
interface Index {
  readonly sellerId: string
  readonly today: string
  readonly settings: CustomerSettings
  readonly days: ReadonlyMap<string, DayFacts>
  /** 표지 → 나온 실제 날짜들 (오름차순) */
  readonly markerDates: ReadonlyMap<string, readonly string[]>
}

export class CustomerService {
  readonly #deps: CustomerDeps
  readonly #sellerKeys = new Map<string, Buffer>()

  constructor(deps: CustomerDeps) {
    this.#deps = deps
  }

  /** 판매자 전화번호 키 (메모리에만 — 응답·로그에 내지 않는다) */
  readonly #sellerKey = async (sellerId: string): Promise<Buffer> => {
    const cached = this.#sellerKeys.get(sellerId)
    if (cached !== undefined) return cached
    const seller = await findSeller(this.#deps.db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    const key = openSellerKey(this.#deps.masterKey, sellerId, seller.phoneKeyEnc)
    this.#sellerKeys.set(sellerId, key)
    return key
  }

  // ── 설정 "손님 관리" (D-CRM1-05) ─────────────────────────────────────

  async settings(sellerId: string): Promise<CustomerSettings> {
    const rows = await this.#deps.db.select().from(customerSettings).where(eq(customerSettings.sellerId, sellerId)).limit(1)
    const row = rows[0]
    return row === undefined ? DEFAULT_CUSTOMER_SETTINGS : { regularCount: row.regularCount, regularAmount: row.regularAmount, waitDays: row.waitDays }
  }

  async saveSettings(sellerId: string, value: CustomerSettings): Promise<CustomerSettings> {
    const updatedAt = new Date(this.#deps.clock.now())
    const fields = { regularCount: value.regularCount, regularAmount: value.regularAmount, waitDays: value.waitDays, updatedAt }
    await this.#deps.db
      .insert(customerSettings)
      .values({ sellerId, ...fields })
      .onConflictDoUpdate({ target: customerSettings.sellerId, set: fields })
    return this.settings(sellerId)
  }

  // ── 기록 모으기 ──────────────────────────────────────────────────────

  async #index(sellerId: string): Promise<Index> {
    const { db, writer, log, clock } = this.#deps
    const facts = await allFacts({ db, writer, log, sellerKey: this.#sellerKey }, sellerId)
    const days = new Map<string, DayFacts>()
    const markerDates = new Map<string, string[]>()
    for (const day of facts) {
      days.set(day.date, day)
      for (const marker of day.markers.keys()) {
        const list = markerDates.get(marker)
        if (list === undefined) markerDates.set(marker, [day.date])
        else list.push(day.date)
      }
    }
    return { sellerId, today: kstDate(clock.now()), settings: await this.settings(sellerId), days, markerDates }
  }

  /** 표지가 나온 날짜마다 그날 그 구매자의 지금의 구매자 묶음 (기록 묶음만) */
  static #markerBundles(index: Index, marker: string): DayBundle[] {
    const out: DayBundle[] = []
    for (const date of index.markerDates.get(marker) ?? []) {
      const day = index.days.get(date)
      const id = day?.markers.get(marker)
      const root = id === undefined ? undefined : day?.buyers.get(id)?.root
      const bundle = root === undefined ? undefined : day?.bundles.get(root)
      if (bundle?.record === true) out.push(bundle)
    }
    return out
  }

  /** 날짜별 구매자 X의 기록 묶음 (D-CRM1-02 — 한 번만 따라간다) */
  static #recordOf(index: Index, day: DayFacts, root: string): DayBundle[] {
    const own = day.bundles.get(root)
    if (own === undefined) return []
    const out: DayBundle[] = own.record ? [own] : []
    const seen = new Set([JSON.stringify([day.date, root])])
    for (const member of own.members) {
      const marker = day.buyers.get(member)?.marker ?? null
      if (marker === null) continue
      for (const bundle of CustomerService.#markerBundles(index, marker)) {
        if (bundle.date === day.date) continue
        const key = JSON.stringify([bundle.date, bundle.buyer])
        if (seen.has(key)) continue
        seen.add(key)
        out.push(bundle)
      }
    }
    return out
  }

  static #summary(index: Index, bundles: readonly DayBundle[]): CustomerSummary {
    return customerSummary(index.today, index.settings, bundles)
  }

  static #idOf(sellerId: string, marker: string): string {
    return sha256Hex(`livejjim-customer\n${sellerId}\n${marker}`).slice(0, 32)
  }

  /** 표지 하나의 "모든 손님" 줄 (기록 묶음이 없으면 null) */
  static #row(index: Index, marker: string): CustomerRow | null {
    const bundles = CustomerService.#markerBundles(index, marker)
    if (bundles.length === 0) return null
    const dates = index.markerDates.get(marker) ?? []
    const latestDate = dates.at(-1) as string
    const day = index.days.get(latestDate) as DayFacts
    const latestBuyer = day.markers.get(marker) as string
    const buyer = day.buyers.get(latestBuyer)
    const platform = buyer?.platform ?? null
    const phoneLast4 = buyer?.phoneLast4 ?? null
    return {
      id: CustomerService.#idOf(index.sellerId, marker),
      name: buyer?.display ?? '',
      platform,
      kindLabel: kindLabelOf(platform, phoneLast4),
      phoneLast4,
      blocked: buyer?.blocked === true,
      latestDate,
      latestBuyer,
      ...CustomerService.#summary(index, bundles),
    }
  }

  /** 불투명 ID → 표지 (그 판매자의 기록에 있는 것만) */
  static #markerOf(index: Index, id: string): string | null {
    for (const marker of index.markerDates.keys()) if (CustomerService.#idOf(index.sellerId, marker) === id) return marker
    return null
  }

  /** 표지마다 마지막 메모 (빈 글이면 메모 없음) */
  async #memos(sellerId: string, markers: readonly string[]): Promise<Map<string, MemoView | null>> {
    const out = new Map<string, MemoView | null>()
    if (markers.length === 0) return out
    const rows = await this.#deps.db
      .select({ marker: customerMemos.marker, text: customerMemos.text, createdAt: customerMemos.createdAt })
      .from(customerMemos)
      .where(and(eq(customerMemos.sellerId, sellerId), inArray(customerMemos.marker, [...new Set(markers)])))
      .orderBy(desc(customerMemos.id))
    for (const row of rows) {
      if (out.has(row.marker)) continue
      out.set(row.marker, row.text === '' ? null : { text: row.text, savedAt: row.createdAt.toISOString() })
    }
    return out
  }

  // ── 날짜별 구매자 화면 ────────────────────────────────────────────────

  /** 그날 구매자 목록 꼬리표·누적 (실제 날짜만 — 없는 날짜·리허설은 null) */
  async dayCustomers(sellerId: string, date: string): Promise<{ date: string; today: string; settings: CustomerSettings; customers: DayCustomer[] } | null> {
    const index = await this.#index(sellerId)
    const day = index.days.get(date)
    if (day === undefined) return null
    const customers: DayCustomer[] = []
    for (const root of day.bundles.keys()) customers.push({ buyer: root, ...CustomerService.#summary(index, CustomerService.#recordOf(index, day, root)) })
    customers.sort((a, b) => byText(a.buyer, b.buyer))
    return { date, today: index.today, settings: index.settings, customers }
  }

  /** 그날 구매자 하나의 손님 기록 칸 (합쳐진 구매자 ID면 지금의 구매자로 푼다). 없으면 null */
  async dayCustomer(sellerId: string, date: string, buyer: string): Promise<{ date: string; buyer: string; summary: CustomerSummary; members: DayMember[] } | null> {
    const index = await this.#index(sellerId)
    const day = index.days.get(date)
    const root = day?.buyers.get(buyer)?.root
    if (day === undefined || root === undefined) return null
    const own = day.bundles.get(root)
    if (own === undefined) return null
    const memberBuyers = own.members.map((id) => day.buyers.get(id)).filter((item) => item !== undefined)
    const memos = await this.#memos(
      sellerId,
      memberBuyers.map((item) => item.marker).filter((marker) => marker !== null),
    )
    const members = memberBuyers.map((item) => ({
      buyer: item.id,
      name: item.display,
      platform: item.platform,
      kindLabel: kindLabelOf(item.platform, item.phoneLast4),
      phoneLast4: item.phoneLast4,
      customer: item.marker === null ? null : CustomerService.#idOf(sellerId, item.marker),
      memo: item.marker === null ? null : (memos.get(item.marker) ?? null),
    }))
    return { date, buyer: root, summary: CustomerService.#summary(index, CustomerService.#recordOf(index, day, root)), members }
  }

  // ── 모든 손님 ────────────────────────────────────────────────────────

  async customers(sellerId: string, query: CustomerListQuery): Promise<{ today: string; settings: CustomerSettings; customers: CustomerRow[]; count: number; more: boolean; next: number | null }> {
    const index = await this.#index(sellerId)
    const needle = query.q === null ? null : query.q.normalize('NFC').toLowerCase()
    const rows: CustomerRow[] = []
    for (const marker of index.markerDates.keys()) {
      const row = CustomerService.#row(index, marker)
      if (row === null) continue
      if (query.filter === 'regular' && !row.regular) continue
      if (query.filter === 'caution' && !row.caution) continue
      if (needle !== null && !CustomerService.#matches(index, marker, row, needle)) continue
      rows.push(row)
    }
    const tie = (a: CustomerRow, b: CustomerRow) => byText(a.name, b.name) || byText(a.id, b.id)
    const byTotal = (a: CustomerRow, b: CustomerRow) => b.purchaseTotal - a.purchaseTotal || tie(a, b)
    if (query.sort === 'total') rows.sort(byTotal)
    else if (query.sort === 'unpaid') rows.sort((a, b) => b.unpaidDays - a.unpaidDays || byTotal(a, b))
    else rows.sort((a, b) => (a.lastPurchase === b.lastPurchase ? 0 : a.lastPurchase === null ? 1 : b.lastPurchase === null ? -1 : byText(b.lastPurchase, a.lastPurchase)) || tie(a, b))
    const page = rows.slice(query.offset, query.offset + CUSTOMERS_PAGE_SIZE)
    const more = query.offset + CUSTOMERS_PAGE_SIZE < rows.length
    return { today: index.today, settings: index.settings, customers: page, count: rows.length, more, next: more ? query.offset + CUSTOMERS_PAGE_SIZE : null }
  }

  /** 찾기 (D-CRM1-06): 날짜마다의 표시 이름·닉네임 이력, 문자 손님은 끝자리 4개 */
  static #matches(index: Index, marker: string, row: CustomerRow, needle: string): boolean {
    if (row.phoneLast4 !== null && /^\d{1,4}$/.test(needle) && row.phoneLast4.includes(needle)) return true
    for (const date of index.markerDates.get(marker) ?? []) {
      const day = index.days.get(date)
      const buyer = day?.buyers.get(day.markers.get(marker) ?? '')
      if (buyer === undefined) continue
      for (const name of [buyer.display, ...buyer.nameHistory]) if (name.normalize('NFC').toLowerCase().includes(needle)) return true
      if (buyer.phoneLast4 !== null && /^\d{1,4}$/.test(needle) && buyer.phoneLast4.includes(needle)) return true
    }
    return false
  }

  /** 손님 자세히: 줄 + 메모 + 날짜 줄(최근부터 20개, before=<날짜>로 다음 쪽). 없으면 null(404) */
  async customer(sellerId: string, id: string, before: string | null): Promise<{ customer: CustomerRow; memo: MemoView | null; days: CustomerDay[]; more: boolean; next: string | null } | null> {
    const index = await this.#index(sellerId)
    const marker = CustomerService.#markerOf(index, id)
    if (marker === null) return null
    const row = CustomerService.#row(index, marker)
    if (row === null) return null
    const all = CustomerService.#markerBundles(index, marker)
      .filter((bundle) => before === null || bundle.date < before)
      .sort((a, b) => byText(b.date, a.date))
    const page = all.slice(0, CUSTOMER_DAYS_PAGE_SIZE)
    const more = all.length > CUSTOMER_DAYS_PAGE_SIZE
    const days = page.map((bundle) => ({
      date: bundle.date,
      buyer: bundle.buyer,
      name: bundle.name,
      subtotal: bundle.subtotal,
      payment: bundle.payment,
      unpaid: isUnpaid(bundle, index.today, index.settings.waitDays),
    }))
    const memo = (await this.#memos(sellerId, [marker])).get(marker) ?? null
    return { customer: row, memo, days, more, next: more ? (page.at(-1)?.date ?? null) : null }
  }

  // ── 메모 (D-CRM1-08) ─────────────────────────────────────────────────

  /** 메모 저장 (덧붙이기, 빈 글 = 지움). 없는 손님이면 null(404). 이벤트를 쓰지 않는다 */
  async saveMemo(sellerId: string, accountId: string, id: string, text: string): Promise<{ memo: MemoView | null } | null> {
    const index = await this.#index(sellerId)
    const marker = CustomerService.#markerOf(index, id)
    // 그 판매자의 실제 날짜에 나온 표지만 (기록 묶음이 아직 없어도 — 그날 자세히의 메모 칸)
    if (marker === null) return null
    const createdAt = new Date(this.#deps.clock.now())
    await this.#deps.db.insert(customerMemos).values({ sellerId, marker, text, accountId, createdAt })
    return { memo: text === '' ? null : { text, savedAt: createdAt.toISOString() } }
  }
}
