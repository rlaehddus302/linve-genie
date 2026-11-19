// 지난 주문 같이 보내기 (D-STMT-CARRY-01, 판매자 요청 2026-11-20 "정산할 때 해당 구매자의 예전 주문(저번에 안 보낸 물품) 있으면 알려주기.
// 그래서 다 같이 묶어서 보낼 수 있게. 배송비도 함께 고려해 줘. 예전 2만 원 오늘 3만 원 주문했으면 묶어서 배송하면 5만 원이니까 배송비 무료"):
// - 지난 주문 = 같은 손님(손님 장부 표지로 이어진 손님 — 채팅 계정·문자 번호, D-CRM1-02)의 다른 날짜 주문 가운데
//   정산서 날짜보다 앞서고 CARRY_DAYS 안이며, 품목이 있고, 배송 완료(포장 기록 SHIPPED — 택배 접수 포함)가 아니고,
//   판매자가 "이미 보냈어요"라고 하지 않았고, 다른 정산서에 같이 보내기로 하지 않은 것.
// - 같이 보내기(carry)는 정산서 기록이다 — 엔진(판정·금액·정산 묶음)은 바뀌지 않는다. 정산서 한 장에 지난 상품 줄을 붙이고
//   배송비는 합친 상품 금액으로 다시 세며, 지난 날짜에 이미 받은 돈은 총액에서 뺀다(배송비를 두 번 받지 않는다 — broadcast-sales paperOrder·statementTotals).
// - 지난 주문 T가 또 다른 지난 주문 P를 같이 보내기로 했으면 T를 데려올 때 P의 줄도 함께 온다(한 상자).
// - 기록: statement_carry_events에 덧붙이기만 한다(carry · drop(빼기) · sent(이미 보냈어요)). 같은 지난 주문은 가장 나중 기록이 이긴다.
//   같은 요청 번호면 처음 결과. 연습 라이브는 없다. 복구는 기록을 지운다(구매자 ID가 다른 사람을 가리킬 수 있다).
import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import type { FullView } from '../../web/src/api/types.ts'
import { broadcastSales, pastDateWord, type PastOrder, type SaleLine, type StatementCarry } from '../../web/src/lib/broadcast-sales.ts'
import { fromFull, settlementKey } from '../../web/src/lib/scope-data.ts'
import type { DayBundle } from './customers/facts.ts'
import { addDays } from './customers/summary.ts'
import type { Db } from './db/database.ts'
import { packingRecords, statementCarryEvents } from './db/schema.ts'
import { replayPacking, type PackingKind } from './packing.ts'
import { statementBuyersOf } from './statement-file.ts'

export type { PastOrder, StatementCarry }

/** 정산서 날짜에서 며칠 전 주문까지 찾나 (그보다 오래된 주문은 알리지 않는다 — 봉인 30일과 같은 길이) */
export const CARRY_DAYS = 30
/** 한 번에 고를 수 있는 지난 주문 수 */
export const CARRY_MAX = 20

export type CarryKind = 'carry' | 'drop' | 'sent'
export const CARRY_KINDS: readonly CarryKind[] = ['carry', 'drop', 'sent']

export const CARRY_MESSAGES = {
  input: '같이 보낼 지난 주문을 다시 골라 주세요.',
  buyer: '어느 손님 정산서에 같이 보낼지 알 수 없어요.',
} as const

export interface CarryRef {
  readonly date: string
  readonly buyer: string
}

/** 지난 주문 하나에 대한 판매자의 가장 나중 결정 */
export interface CarryDecision {
  readonly kind: CarryKind
  /** carry: 같이 보내는 정산서의 날짜·구매자 */
  readonly date: string
  readonly buyer: string
}

const refKey = (ref: CarryRef): string => JSON.stringify([ref.date, ref.buyer])
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** 기록(차례대로) → 지난 주문마다 가장 나중 결정 (순수) */
export function foldCarries(rows: readonly { readonly kind: string; readonly date: string; readonly buyer: string; readonly pastDate: string; readonly pastBuyer: string }[]): Map<string, CarryDecision> {
  const out = new Map<string, CarryDecision>()
  for (const row of rows) {
    if (row.kind !== 'carry' && row.kind !== 'drop' && row.kind !== 'sent') continue
    out.set(refKey({ date: row.pastDate, buyer: row.pastBuyer }), { kind: row.kind, date: row.date, buyer: row.buyer })
  }
  return out
}

/**
 * 정산서 구매자 하나의 지난 주문 나누기 (순수): candidates = 손님 장부로 이어진 다른 날짜 주문, decisions = 판매자 결정, shipped = 배송 완료.
 * 같이 보내기로 한 것(이 날짜·이 구매자로) → carried, 결정 없음·뺐음이고 배송 전 → waiting. 이미 보냈어요·다른 정산서로 → 빠진다
 */
export function splitPast(date: string, buyer: string, candidates: readonly CarryRef[], decisions: ReadonlyMap<string, CarryDecision>, shipped: (ref: CarryRef) => boolean): { carried: CarryRef[]; waiting: CarryRef[] } {
  const from = addDays(date, -CARRY_DAYS)
  const carried: CarryRef[] = []
  const waiting: CarryRef[] = []
  const seen = new Set<string>()
  const here = (decision: CarryDecision) => decision.kind === 'carry' && decision.date === date && decision.buyer === buyer
  // 판매자가 이 정산서에 같이 보내기로 한 것은 손님 장부 연결이 바뀌어도 그대로 보인다
  for (const [key, decision] of decisions) {
    if (!here(decision)) continue
    const [pastDate, pastBuyer] = JSON.parse(key) as [string, string]
    if (pastDate >= date) continue
    seen.add(key)
    carried.push({ date: pastDate, buyer: pastBuyer })
  }
  for (const ref of candidates) {
    const key = refKey(ref)
    if (seen.has(key) || ref.date >= date || ref.date < from) continue
    seen.add(key)
    const decision = decisions.get(key)
    if (decision !== undefined && decision.kind !== 'drop') continue
    if (shipped(ref)) continue
    waiting.push(ref)
  }
  const order = (a: CarryRef, b: CarryRef) => byText(a.date, b.date) || byText(a.buyer, b.buyer)
  return { carried: carried.sort(order), waiting: waiting.sort(order) }
}

/** 받은 지난 주문 목록 검사 — 형식만 (2026-11-15 날짜 · 구매자 ID). 틀리면 null */
export function carryRefsInput(value: unknown, date: string): CarryRef[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > CARRY_MAX) return null
  const out: CarryRef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const keys = Object.keys(item)
    if (keys.length !== 2 || !keys.includes('date') || !keys.includes('buyer')) return null
    const { date: pastDate, buyer } = item as { date: unknown; buyer: unknown }
    if (typeof pastDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pastDate) || pastDate >= date) return null
    if (typeof buyer !== 'string' || buyer === '' || buyer.length > 64 || /[\p{Cc}]/u.test(buyer)) return null
    const ref = { date: pastDate, buyer }
    if (seen.has(refKey(ref))) return null
    seen.add(refKey(ref))
    out.push(ref)
  }
  return out
}

export interface StatementCarriesDeps {
  readonly db: Db
  readonly clock: { now(): number }
  /** 그 날짜 실제 범위의 화면 상태 (없으면 null) */
  readonly view: (sellerId: string, date: string) => Promise<FullView | null>
  /** 손님 장부로 이어진 다른 날짜 주문 (손님 기록 묶음 — 없으면 null) */
  readonly record?: (sellerId: string, date: string, buyer: string) => Promise<readonly DayBundle[] | null>
}

export class StatementCarries {
  readonly #deps: StatementCarriesDeps

  constructor(deps: StatementCarriesDeps) {
    this.#deps = deps
  }

  async #decisions(sellerId: string, date: string): Promise<Map<string, CarryDecision>> {
    const rows = await this.#deps.db
      .select({ kind: statementCarryEvents.kind, date: statementCarryEvents.date, buyer: statementCarryEvents.buyer, pastDate: statementCarryEvents.pastDate, pastBuyer: statementCarryEvents.pastBuyer })
      .from(statementCarryEvents)
      .where(and(eq(statementCarryEvents.sellerId, sellerId), gte(statementCarryEvents.pastDate, addDays(date, -2 * CARRY_DAYS))))
      .orderBy(asc(statementCarryEvents.id))
    return foldCarries(rows)
  }

  /** 날짜들의 배송 완료 구매자 (포장 기록을 차례로 읽어 SHIPPED인 구매자) */
  async #shipped(sellerId: string, dates: readonly string[]): Promise<Set<string>> {
    const out = new Set<string>()
    if (dates.length === 0) return out
    const rows = await this.#deps.db
      .select({ date: packingRecords.date, buyer: packingRecords.buyer, kind: packingRecords.kind })
      .from(packingRecords)
      .where(and(eq(packingRecords.sellerId, sellerId), inArray(packingRecords.date, [...dates])))
      .orderBy(asc(packingRecords.id))
    const byBuyer = new Map<string, { kind: PackingKind; items: null; invoice: null }[]>()
    for (const row of rows) {
      const key = refKey({ date: row.date, buyer: row.buyer })
      const list = byBuyer.get(key) ?? []
      list.push({ kind: row.kind as PackingKind, items: null, invoice: null })
      byBuyer.set(key, list)
    }
    for (const [key, list] of byBuyer) if (replayPacking(list).phase === 'SHIPPED') out.add(key)
    return out
  }

  /** 그 날짜 정산서 구매자마다 지난 주문 (있는 구매자만). 실제 범위만 */
  async carries(sellerId: string, date: string): Promise<StatementCarry[]> {
    const today = await this.#deps.view(sellerId, date)
    if (today === null) return []
    const buyers = statementBuyersOf(today)
    if (buyers.length === 0) return []
    const decisions = await this.#decisions(sellerId, date)
    const from = addDays(date, -CARRY_DAYS)
    const candidates = new Map<string, CarryRef[]>()
    for (const buyer of buyers) {
      const record = this.#deps.record === undefined ? null : await this.#deps.record(sellerId, date, buyer)
      candidates.set(buyer, (record ?? []).filter(bundle => bundle.date < date && bundle.date >= from && bundle.items >= 1 && !bundle.archived).map(bundle => ({ date: bundle.date, buyer: bundle.buyer })))
    }
    const dates = new Set<string>()
    for (const list of candidates.values()) for (const ref of list) dates.add(ref.date)
    const shipped = await this.#shipped(sellerId, [...dates])
    const splits = buyers.map(buyer => ({ buyer, ...splitPast(date, buyer, candidates.get(buyer) ?? [], decisions, ref => shipped.has(refKey(ref))) }))
    const views = new Map<string, Promise<FullView | null>>()
    const viewOf = (day: string) => {
      const known = views.get(day)
      if (known !== undefined) return known
      const loading = this.#deps.view(sellerId, day).catch(() => null)
      views.set(day, loading)
      return loading
    }
    const out: StatementCarry[] = []
    for (const split of splits) {
      if (split.carried.length === 0 && split.waiting.length === 0) continue
      const carried = await this.#orders(split.carried, decisions, viewOf)
      const waiting = await this.#orders(split.waiting, decisions, viewOf)
      if (carried.length === 0 && waiting.length === 0) continue
      out.push({ buyer: split.buyer, carried, waiting })
    }
    return out
  }

  async #orders(refs: readonly CarryRef[], decisions: ReadonlyMap<string, CarryDecision>, viewOf: (date: string) => Promise<FullView | null>): Promise<PastOrder[]> {
    const out: PastOrder[] = []
    for (const ref of refs) {
      const order = await this.#past(ref, decisions, viewOf, new Set([refKey(ref)]))
      if (order !== null) out.push(order)
    }
    return out
  }

  /** 지난 주문 하나 — 그 날짜의 확정 찜 줄(날짜를 번호 앞에) + 그 주문에 같이 보내기로 한 더 지난 주문. 줄이 없으면 null */
  async #past(ref: CarryRef, decisions: ReadonlyMap<string, CarryDecision>, viewOf: (date: string) => Promise<FullView | null>, visiting: Set<string>): Promise<PastOrder | null> {
    const view = await viewOf(ref.date)
    let lines: SaleLine[] = []
    let qty = 0
    let subtotal: number | null = 0
    let received = 0
    if (view !== null) {
      const data = fromFull(view)
      const sales = broadcastSales(data.claims, data.products, view.broadcasts.map(broadcast => broadcast.id))
      const order = sales.orders.find(row => row.id === ref.buyer)
      if (order !== undefined) {
        const round = pastDateWord(ref.date)
        lines = order.lines.map(line => ({ ...line, key: `${ref.date}|${line.key}`, round }))
        qty = order.qty
        subtotal = order.subtotal
        received = Math.max(0, data.settlements.get(settlementKey({ buyer: ref.buyer, date: ref.date }))?.received ?? 0)
      }
    }
    // 이 지난 주문에 같이 보내기로 한 더 지난 주문 (한 상자)
    for (const [key, decision] of decisions) {
      if (decision.kind !== 'carry' || decision.date !== ref.date || decision.buyer !== ref.buyer || visiting.has(key)) continue
      const [pastDate, pastBuyer] = JSON.parse(key) as [string, string]
      if (pastDate >= ref.date) continue
      visiting.add(key)
      const inner = await this.#past({ date: pastDate, buyer: pastBuyer }, decisions, viewOf, visiting)
      if (inner === null) continue
      lines = [...lines, ...inner.lines]
      qty += inner.qty
      subtotal = subtotal === null || inner.subtotal === null ? null : subtotal + inner.subtotal
      received += inner.received
    }
    if (lines.length === 0) return null
    return { date: ref.date, buyer: ref.buyer, lines, qty, subtotal, received }
  }

  /** 판매자 결정 하나 — 같은 요청 번호면 처음 결과. carry는 buyer(이 날짜 정산서의 구매자)가 있어야 한다 */
  async change(sellerId: string, accountId: string | null, requestId: string, date: string, kind: CarryKind, buyer: string, past: readonly CarryRef[]): Promise<StatementCarry[]> {
    await this.#deps.db.transaction(async (tx) => {
      const [prior] = await tx
        .select({ id: statementCarryEvents.id })
        .from(statementCarryEvents)
        .where(and(eq(statementCarryEvents.sellerId, sellerId), eq(statementCarryEvents.requestId, requestId)))
        .limit(1)
      if (prior !== undefined) return
      const createdAt = new Date(this.#deps.clock.now())
      await tx.insert(statementCarryEvents).values(
        past.map((ref, index) => ({ sellerId, requestId: index === 0 ? requestId : `${requestId}#${String(index)}`, kind, date, buyer, pastDate: ref.date, pastBuyer: ref.buyer, accountId, createdAt })),
      ).onConflictDoNothing()
    })
    return this.carries(sellerId, date)
  }
}
