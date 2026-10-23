// 30일 봉인 날짜의 조회용 상태 (PL1A D-I2-22 (2)·D-PL1-04). 봉인한 범위는 채팅 원문을 지워 재생할 수 없다 — 문서(확인서·판매대장·포장·지난 구매)는
// 봉인 때 남긴 장부(youtube/seal.ts readLedger — 고치지 않고 import만)로 만든다.
// - 장부의 판매·상품·구매자·정산 기록으로 코어 상태 모양을 다시 세운다(판정은 하지 않는다 — 이벤트를 적용하지 않고 기록을 옮겨 담을 뿐).
//   그래서 문서 패키지·포장·지난 구매가 봉인 전과 같은 코어 조회 함수(listSettlements·listClaims·getBuyer…)로 같은 금액·줄·이름·순서를 만든다.
// - 장부에 없는 값: 방송의 설정 스냅샷은 그 범위의 이벤트 기록에 남은 broadcast.start(채팅이 아니라 지우지 않는다)에서 읽는다.
//   옵션 상품의 옵션 항목 이름·선택지는 판매의 고른 옵션과 변형 글에서 모은다(선택지 가격 차이는 장부에 없어 0 — 문서는 찜의 단가 스냅샷만 쓴다).
//   찜 시각(R-6 실제 시각)은 장부 판 `/2`에 없다 — 0으로 두고 판매대장 "찜 시각" 칸은 부르는 쪽이 빈칸으로 바꾼다(D-PL1-03, 지어내지 않는다).
// - 다시 세운 상태를 코어 조회 함수로 읽은 값이 장부에 적힌 값(정산 묶음 금액·기록, 판매, 상품, 구매자)과 하나라도 다르면 읽을 수 없는 장부로 본다(null) —
//   틀린 숫자를 문서로 내보내지 않는다(D-O3-15 원칙). 부르는 쪽은 500 LEDGER_UNREADABLE.
import {
  STATE_FORMAT,
  emptyPMap,
  listBuyers,
  listClaims,
  listProducts,
  listSettlements,
  pset,
  resolveSettings,
  type BroadcastRecord,
  type BuyerRecord,
  type ClaimRecord,
  type EngineState,
  type LedgerRecord,
  type OptionItem,
  type PMap,
  type ProductRecord,
  type SaleSettings,
  type SettingsOverride,
  type SettlementEntry,
  type SlotRecord,
} from '@livejjim/core'
import { and, asc, eq } from 'drizzle-orm'
import { canonicalJson } from './check-replay.ts'
import type { Db } from './db/database.ts'
import { events } from './db/schema.ts'
import { sha256Hex } from './secrets.ts'
import { scopeSealInfo } from './store.ts'
import { withIsoTimes } from './time.ts'
import { readLedger, type Ledger } from './youtube/seal.ts'

/** 봉인 장부를 읽지 못했을 때의 문장 (D-PL1-04) */
export const LEDGER_UNREADABLE_MESSAGE = '30일이 지나 봉인한 기록을 읽지 못했어요. 운영자에게 알려 주세요.'

type Row = Record<string, unknown>
const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)
const ms = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

class Unreadable extends Error {}
const need = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Unreadable()
  return value
}

function mapOf<V>(entries: Iterable<readonly [string, V]>): PMap<V> {
  let map = emptyPMap<V>()
  for (const [key, value] of entries) map = pset(map, key, value)
  return map
}

const PHASES = new Set(['READY', 'HOLD', 'CLOSED'])
const ORIGINS = new Set(['chat', 'sms', 'assign', 'convert'])

/** 옵션 항목: 변형 글(`흰색/대형`)의 자리마다 선택지(나온 순서), 항목 이름은 판매의 고른 옵션에서 (판매가 없는 자리는 `옵션 N`) */
function optionItems(texts: readonly string[], picks: readonly (readonly (readonly [string, string])[])[]): OptionItem[] {
  if (texts.length === 0) return []
  const width = need(texts[0]).split('/').length
  const items: { name: string; labels: string[] }[] = Array.from({ length: width }, (_, i) => ({ name: `옵션 ${String(i + 1)}`, labels: [] }))
  for (const text of texts) {
    const labels = text.split('/')
    if (labels.length !== width) throw new Unreadable()
    labels.forEach((label, i) => {
      const item = items[i] as { labels: string[] }
      if (!item.labels.includes(label)) item.labels.push(label)
    })
  }
  for (const pick of picks) {
    if (pick.length !== width) throw new Unreadable()
    pick.forEach(([name], i) => {
      ;(items[i] as { name: string }).name = name
    })
  }
  return items.map((item) => ({ name: item.name, choices: item.labels.map((label) => ({ label })) }))
}

/**
 * 장부 + 방송마다의 설정 스냅샷 → 조회용 엔진 상태. 장부와 맞지 않으면 null
 */
export function stateFromLedger(ledger: Ledger, settingsOf: ReadonlyMap<string, SaleSettings>): EngineState | null {
  try {
    const state = build(ledger, settingsOf)
    return matchesLedger(state, ledger) ? state : null
  } catch {
    return null
  }
}

function build(ledger: Ledger, settingsOf: ReadonlyMap<string, SaleSettings>): EngineState {
  const broadcasts: BroadcastRecord[] = ledger.broadcasts.map((broadcast) => {
    const endedAt = broadcast.endedAt === null ? null : need(ms(broadcast.endedAt))
    return { id: need(str(broadcast.id)), date: need(str(broadcast.date)), title: need(str(broadcast.title)), settings: need(settingsOf.get(broadcast.id)), endedAt, focus: null }
  })
  const broadcastIds = new Set(broadcasts.map((broadcast) => broadcast.id))

  // 찜 (확정 판매만 — 장부 순서 = 찜 생성 순서)
  const sales = ledger.sales as readonly Row[]
  const claims: ClaimRecord[] = sales.map((sale, index) => {
    const product = need(str(sale.product))
    const b = need(str(sale.broadcast))
    if (!broadcastIds.has(b)) throw new Unreadable()
    const origin = need(str(sale.origin))
    if (!ORIGINS.has(origin)) throw new Unreadable()
    const variant = sale.variant === null ? null : need(str(sale.variant))
    const options = sale.options === null ? null : (need(Array.isArray(sale.options) ? sale.options : null) as unknown[]).map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Unreadable()
      return [need(str(pair[0])), need(str(pair[1]))] as const
    })
    const qty = need(int(sale.qty))
    const price = need(int(sale.price))
    // 찜 금액 = 단가 스냅샷 × 수량이 코어의 정의다 — 장부의 찜 금액과 다르면 읽지 않는다 (다시 계산해 채우지 않는다)
    if (need(int(sale.amount)) !== price * qty) throw new Unreadable()
    return {
      id: need(str(sale.id)),
      n: index + 1,
      seq: 0,
      at: 0,
      time: 0,
      minute: false,
      b,
      no: need(int(sale.no)),
      key: product,
      pid: need(str(sale.productId)),
      buyer: need(str(sale.buyer)),
      origin: origin as ClaimRecord['origin'],
      message: null,
      ref: null,
      received: null,
      status: 'CONFIRMED',
      reason: null,
      price,
      version: need(int(sale.confirmVersion)),
      locked: false,
      request: null,
      effects: [],
      reprint: false,
      priceHistory: [],
      qty,
      qtyWritten: false,
      variant,
      options,
    }
  })
  const claimById = new Map(claims.map((claim) => [claim.id, claim]))
  if (claimById.size !== claims.length) throw new Unreadable()
  const currentOf = new Map(sales.map((sale) => [need(str(sale.id)), need(str(sale.currentBuyer))]))

  // 상품 (번호 자리) — 1등 목록(지금의 구매자, 확정 순)을 그 상품·변형의 판매에 하나씩 짝짓는다
  const used = new Set<string>()
  const winnersOf = (productId: string, variant: string | null, buyers: unknown): string[] => {
    if (!Array.isArray(buyers)) throw new Unreadable()
    return buyers.map((buyer) => {
      const found = claims.find((claim) => !used.has(claim.id) && claim.pid === productId && claim.variant === variant && currentOf.get(claim.id) === buyer)
      if (found === undefined) throw new Unreadable()
      used.add(found.id)
      return found.id
    })
  }
  const slots: [string, SlotRecord][] = []
  const productKeys: [string, string][] = []
  for (const row of ledger.products as readonly Row[]) {
    const id = need(str(row.id))
    const key = need(str(row.key))
    const b = need(str(row.broadcast))
    const no = need(int(row.no))
    if (!broadcastIds.has(b) || key !== `${b}/${String(no)}`) throw new Unreadable()
    const status = need(str(row.status))
    const variantRows = need(Array.isArray(row.variants) ? (row.variants as unknown[]) : null).map((variant) => {
      if (!isObject(variant)) throw new Unreadable()
      return { text: need(str(variant.text)), stock: need(int(variant.stock)), winners: variant.winners }
    })
    const texts = variantRows.map((variant) => variant.text)
    const options = optionItems(
      texts,
      claims.filter((claim) => claim.pid === id && claim.options !== null).map((claim) => claim.options as readonly (readonly [string, string])[]),
    )
    const priceHistory = need(Array.isArray(row.priceHistory) ? (row.priceHistory as unknown[]) : null).map((change) => {
      if (!isObject(change)) throw new Unreadable()
      return { from: need(int(change.from)), to: need(int(change.to)), seq: 0, at: need(ms(change.at)) }
    })
    const product: ProductRecord = {
      id,
      name: need(str(row.name)),
      price: need(int(row.price)),
      stock: need(int(row.stock)),
      phase: (PHASES.has(status) ? status : 'SELLING') as ProductRecord['phase'],
      priceHistory,
      nameHistory: [],
      aliases: [],
      options,
      variants: variantRows.map((variant) => ({ text: variant.text, stock: variant.stock })),
    }
    const units = variantRows.map((variant) => ({ text: variant.text, winners: winnersOf(id, variant.text, variant.winners), waitlist: [], awaiting: false, conflict: null }))
    const winners = variantRows.length === 0 ? winnersOf(id, null, row.winners) : []
    const versions = claims.filter((claim) => claim.pid === id).map((claim) => claim.version ?? 0)
    slots.push([
      key,
      {
        key,
        b,
        no,
        product,
        winners,
        waitlist: [],
        pending: emptyPMap(),
        active: emptyPMap(),
        awaiting: false,
        conflict: null,
        version: versions.length === 0 ? 0 : Math.max(...versions),
        units,
        variantActive: emptyPMap(),
        requests: [],
      },
    ])
    productKeys.push([id, key])
  }
  // 모든 판매가 어느 상품의 1등이어야 한다
  if (used.size !== claims.length) throw new Unreadable()

  // 정산 기록 — 적힌 (구매자 자신, 날짜)마다
  const ledgerRecords = new Map<string, { buyer: string; date: string; entries: SettlementEntry[] }>()
  for (const settlement of ledger.settlements as readonly Row[]) {
    const date = need(str(settlement.date))
    for (const record of need(Array.isArray(settlement.records) ? (settlement.records as unknown[]) : null)) {
      if (!isObject(record)) throw new Unreadable()
      const buyer = need(str(record.buyer))
      const seq = need(int(record.seq))
      const at = need(ms(record.at))
      const kind = need(str(record.kind))
      let entry: SettlementEntry
      if (kind === 'shipping') {
        const mode = need(str(record.mode)) as Extract<SettlementEntry, { kind: 'shipping' }>['mode']
        entry = { kind, mode, amount: record.amount === null ? null : need(int(record.amount)), seq, at }
      } else if (kind === 'adjust' || kind === 'refund') entry = { kind, amount: need(int(record.amount)), reason: need(str(record.reason)), seq, at }
      else if (kind === 'payment') entry = { kind, amount: need(int(record.amount)), memo: record.memo === null ? null : need(str(record.memo)), seq, at }
      else throw new Unreadable()
      const key = JSON.stringify([buyer, date])
      const found = ledgerRecords.get(key)
      if (found === undefined) ledgerRecords.set(key, { buyer, date, entries: [entry] })
      else found.entries.push(entry)
    }
  }
  for (const record of ledgerRecords.values()) record.entries.sort((a, b) => a.seq - b.seq)

  // 구매자 — 장부 순서 = 처음 기록된 순서
  const buyerRows = ledger.buyers as readonly Row[]
  const buyerIds = new Set(buyerRows.map((row) => need(str(row.id))))
  const children = new Map<string, string[]>()
  for (const row of buyerRows) {
    const parent = row.mergedInto === null ? null : need(str(row.mergedInto))
    if (parent === null) continue
    if (!buyerIds.has(parent)) throw new Unreadable()
    children.set(parent, [...(children.get(parent) ?? []), need(str(row.id))])
  }
  const buyers: [string, BuyerRecord][] = buyerRows.map((row, index) => {
    const id = need(str(row.id))
    const kind = need(str(row.kind))
    if (kind !== 'youtube' && kind !== 'sms') throw new Unreadable()
    const own = claims.filter((claim) => claim.buyer === id)
    const display = need(str(row.display))
    return [
      id,
      {
        id,
        n: index + 1,
        kind,
        display,
        names: [display],
        phoneLast4: row.phoneLast4 === null ? null : need(str(row.phoneLast4)),
        parent: row.mergedInto === null ? null : need(str(row.mergedInto)),
        children: children.get(id) ?? [],
        claims: mapOf(own.map((claim) => [claim.id, true as const] as const)),
        dates: [...ledgerRecords.values()].filter((record) => record.buyer === id).map((record) => record.date),
        subtotal: own.reduce((sum, claim) => sum + (claim.price as number) * claim.qty, 0),
      },
    ]
  })
  for (const claim of claims) if (!buyerIds.has(claim.buyer)) throw new Unreadable()
  for (const record of ledgerRecords.values()) if (!buyerIds.has(record.buyer)) throw new Unreadable()

  return {
    format: STATE_FORMAT,
    broadcasts,
    counters: { claims: claims.length, effects: 0, buyers: buyers.length, products: productKeys.length },
    messages: emptyPMap(),
    refs: emptyPMap(),
    phoneKeys: emptyPMap(),
    buyers: mapOf(buyers),
    blocked: emptyPMap(),
    slots: mapOf(slots),
    products: mapOf(productKeys),
    claims: mapOf(claims.map((claim) => [claim.id, claim] as const)),
    effects: emptyPMap(),
    ledger: mapOf([...ledgerRecords.entries()].map(([key, record]): [string, LedgerRecord] => [key, record])),
    reviews: emptyPMap(),
  }
}

const pick = (row: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((key) => [key, row[key]]))
const SALE_KEYS = ['id', 'product', 'productId', 'broadcast', 'no', 'buyer', 'currentBuyer', 'price', 'key', 'variant', 'options', 'qty', 'amount', 'confirmVersion', 'origin'] as const
const PRODUCT_KEYS = ['id', 'key', 'broadcast', 'no', 'name', 'price', 'stock', 'status', 'winners'] as const
const BUYER_KEYS = ['id', 'kind', 'display', 'phoneLast4', 'mergedInto', 'current', 'items', 'subtotal'] as const

/** 다시 세운 상태의 코어 조회 결과 = 장부에 적힌 값 (정산 묶음 전부, 판매, 상품, 장부에 남은 구매자) */
function matchesLedger(state: EngineState, ledger: Ledger): boolean {
  const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)
  if (!same(listSettlements(state).map((settlement) => withIsoTimes(settlement)), ledger.settlements)) return false
  const claims = listClaims(state)
  if (!same(claims.map((claim) => pick(claim as unknown as Row, SALE_KEYS)), ledger.sales.map((sale) => pick(sale, SALE_KEYS)))) return false
  const products = listProducts(state).map((product) => ({
    ...pick(product as unknown as Row, PRODUCT_KEYS),
    variants: product.variants.map((variant) => ({ text: variant.text, stock: variant.stock, winners: variant.winners })),
  }))
  if (!same(products, ledger.products.map((product) => ({ ...pick(product, PRODUCT_KEYS), variants: product.variants })))) return false
  const kept = new Set(ledger.buyers.map((buyer) => buyer.id))
  const buyers = listBuyers(state).filter((buyer) => kept.has(buyer.id))
  return same(
    buyers.map((buyer) => pick(buyer as unknown as Row, BUYER_KEYS)),
    ledger.buyers.map((buyer) => pick(buyer, BUYER_KEYS)),
  )
}

/** 봉인 범위의 방송마다 설정 스냅샷 (이벤트 기록의 broadcast.start — 실패 표시·상태를 바꾸지 않은 것은 뺀다, 판매자 ID 조건) */
async function broadcastSettings(db: Db, sellerId: string, scopeId: string): Promise<Map<string, SaleSettings>> {
  const rows = await db
    .select({ body: events.body, failed: events.failed, changed: events.changed })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.type, 'broadcast.start')))
    .orderBy(asc(events.seq))
  const out = new Map<string, SaleSettings>()
  for (const row of rows) {
    if (row.failed || !row.changed) continue
    const start = startSettings(row.body)
    if (start === null || out.has(start.b)) continue
    out.set(start.b, start.settings)
  }
  return out
}

/**
 * broadcast.start 이벤트 본문 하나 → (방송 ID, 설정 스냅샷). 읽을 수 없으면 null.
 * 봉인 날짜 문서(broadcastSettings)와 백업 파일 검사(backup.ts SealedScopeCheck)가 같은 함수로 설정을 읽는다 (SA-PL1A-04 — 기준이 둘로 갈리지 않게)
 */
export function startSettings(body: string): { b: string; settings: SaleSettings } | null {
  try {
    const event = JSON.parse(body) as { b?: unknown; settings?: unknown }
    if (!isObject(event) || typeof event.b !== 'string') return null
    return { b: event.b, settings: resolveSettings(isObject(event.settings) ? (event.settings as SettingsOverride) : {}) }
  } catch {
    return null
  }
}

/** 그 날짜(실제 범위)의 봉인 상태: 봉인 안 함, 봉인 + 조회용 상태, 봉인 + 읽을 수 없는 장부 */
export type SealedRead = { readonly sealed: false } | { readonly sealed: true; readonly scopeId: string; readonly state: EngineState | null }

/** 봉인 범위는 바뀌지 않는다 — (판매자, 범위 ID, 장부 글의 요약값)마다 다시 세운 상태를 조금 둔다 */
const CACHE_MAX = 32
const cache = new Map<string, EngineState | null>()

export async function readSealed(db: Db, sellerId: string, date: string): Promise<SealedRead> {
  const info = await scopeSealInfo(db, sellerId, date, false)
  if (info === null || info.sealedAt === null) return { sealed: false }
  // 키는 저장된 장부 글의 요약값 (장부 칸이 바뀌면 다시 세운다 — 요약값 칸은 믿지 않는다)
  const key = JSON.stringify([sellerId, info.scopeId, info.ledger === null ? null : sha256Hex(info.ledger)])
  if (cache.has(key)) {
    const state = cache.get(key) as EngineState | null
    cache.delete(key)
    cache.set(key, state)
    return { sealed: true, scopeId: info.scopeId, state }
  }
  const ledger = info.ledger === null ? null : readLedger(info.ledger)
  const state = ledger === null || ledger.date !== date ? null : stateFromLedger(ledger, await broadcastSettings(db, sellerId, info.scopeId))
  cache.set(key, state)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return { sealed: true, scopeId: info.scopeId, state }
}
