// 지난 구매 (BUY-05, I2 D-I2-08, AC-I2-40). 엔진 범위는 날짜마다 따로라(D-069) 구매자 ID·합치기가 날짜를 넘지 않는다 — 서버가 표지로 잇는다.
// - 표지: 보고 있는 묶음의 구매자들(지금의 구매자 X + 그 아래 합쳐진 구매자) 각자 — 유튜브 구매자는 채널 ID, 휴대폰 번호가 있는 문자 구매자는
//   그 구매자를 만든 문자찜의 전화번호 키(서버가 자기 이벤트 기록에서 찾는다 — 응답·화면에 내지 않는다). 전화번호 없는 문자 구매자는 표지가 없다.
// - 판매자의 다른 실제 날짜마다 같은 채널 ID의 유튜브 구매자, 같은 전화번호 키로 만들어진 문자 구매자를 찾아 그날 그 구매자의 지금의 구매자 Y의 묶음을 낸다.
//   한 번만 따라간다(찾은 묶음의 다른 구매자로 다시 넓히지 않는다). 품목이 없고 받은 금액도 0인 묶음·리허설 범위·보고 있는 날짜는 넣지 않는다.
// - 후보 날짜는 DB에서 먼저 거른다(채팅 본문의 채널 ID·문자찜 본문의 전화번호 키 — 판매자 ID 조건, 실제 범위만). 그다음 그 날짜의 범위 상태(코어 조회)로 확인한다.
// - 품목 (O4 D-O4-06): 옵션 글(variant)·수량(qty)·찜 금액(amount — 코어 ClaimInfo.amount 그대로, 다시 계산하지 않는다, D-O3-15).
//   찜 금액이 없으면(프로그램 오류) 그 품목의 amount는 null이고 AMOUNT_MISSING 로그(찜 ID만)를 남긴다 — 단가로 채우지 않는다. price는 지금처럼 단가다.
import { currentBuyerOf, getBuyer, getSettlement, listBroadcasts, listClaims, listProducts, type ClaimInfo, type EngineState, type PaymentStatus } from '@livejjim/core'
import { productTitle } from '@livejjim/core/format'
import { and, desc, eq, lt, ne, sql } from 'drizzle-orm'
import { claimAmount } from './amount.ts'
import type { Db } from './db/database.ts'
import { events, scopes } from './db/schema.ts'
import type { LogSink } from './log.ts'
import { packingRows, packingStatusOf, type PackingWord } from './packing.ts'
import type { ScopeRuntime } from './runtime.ts'

export const PAST_PAGE_SIZE = 20
const SMS_PREFIX = 'sms:'

export interface PastItemLine {
  readonly title: string
  readonly no: number
  readonly name: string
  /** 단가 (찜 때 단가 — 지금 그대로) */
  readonly price: number
  /** 옵션 글 (`105/검정색`), 옵션 없는 찜이면 null (O4 D-O4-06) */
  readonly variant: string | null
  /** 수량 */
  readonly qty: number
  /** 찜 금액 = 코어 ClaimInfo.amount. 없으면(프로그램 오류) null — 화면은 금액 칸을 비운다 */
  readonly amount: number | null
}

/** 지난 구매 항목 하나 = 다른 날짜의 묶음 (AC-I2-40) */
export interface PastItem {
  readonly date: string
  /** 그날 그 묶음의 지금의 구매자 ID (정산 자세히로 갈 때) */
  readonly buyer: string
  /** 그날 품목이 있는 방송 제목들 (선언 순) */
  readonly broadcasts: readonly string[]
  /** 그날 이름 (Y의 표시 이름) */
  readonly name: string
  readonly phoneLast4: string | null
  readonly items: readonly PastItemLine[]
  readonly subtotal: number
  readonly shipping: number
  readonly adjustments: number
  readonly total: number
  readonly payment: PaymentStatus
  readonly received: number
  readonly refundDue: number
  readonly packing: PackingWord
  readonly invoice: string | null
  /** 찾은 까닭: `같은 유튜브 채널` / `같은 휴대폰 번호(끝자리 2222)` */
  readonly reasons: readonly string[]
}

export interface PastView {
  readonly date: string
  readonly buyer: string
  readonly items: readonly PastItem[]
  /** 더 지난 항목이 있다 — 다음 쪽은 ?before=<next> */
  readonly more: boolean
  readonly next: string | null
}

type Marker = { readonly kind: 'channel'; readonly channel: string } | { readonly kind: 'phone'; readonly key: string; readonly last4: string }

const reasonOf = (marker: Marker): string => (marker.kind === 'channel' ? '같은 유튜브 채널' : `같은 휴대폰 번호(끝자리 ${marker.last4})`)

export interface PastDeps {
  readonly db: Db
  /** 그 날짜의 실제 범위 상태 (최신 로그까지) — 보고 있는 날짜 */
  readonly read: (date: string) => Promise<ScopeRuntime>
  /** 다른 날짜의 실제 범위 상태 (최신 로그까지) — 여러 날짜를 훑으므로 서버 공용 캐시에 넣지 않는 읽기 (TD-I2-008) */
  readonly readOther: (date: string) => Promise<ScopeRuntime>
  /** 서버 로그 (찜 금액이 없는 품목 — 찜 ID만) */
  readonly log?: LogSink
}

/**
 * 지난 구매 품목 줄 (O4 D-O4-06): 그 묶음(지금의 구매자 root)의 확정 찜을 방송 선언 순 → 번호 순으로. 찜 금액은 코어 값 그대로,
 * 없으면 null과 AMOUNT_MISSING 로그(찜 ID·날짜만 — 닉네임·금액 없음)
 */
export function pastItemLines(state: EngineState, claims: readonly ClaimInfo[], root: string, products: readonly string[], day: string, log?: LogSink): (PastItemLine & { readonly broadcast: string })[] {
  const broadcasts = listBroadcasts(state)
  const order = new Map(broadcasts.map((broadcast, i) => [broadcast.id, i]))
  const titles = new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast.title]))
  const names = new Map(listProducts(state).map((product) => [product.key, productTitle(product.name, product.pieces)]))
  const wanted = new Set(products)
  return claims
    .filter((claim) => claim.status === 'CONFIRMED' && claim.currentBuyer === root && (wanted.has(claim.key) || wanted.has(claim.product)))
    .sort((a, b) => (order.get(a.broadcast) ?? 0) - (order.get(b.broadcast) ?? 0) || a.no - b.no)
    .map((claim) => {
      const amount = claimAmount(claim)
      if (amount === null) log?.({ level: 'error', code: 'AMOUNT_MISSING', date: day, claim: claim.id })
      return { broadcast: claim.broadcast, title: titles.get(claim.broadcast) ?? '', no: claim.no, name: names.get(claim.product) ?? '', price: claim.price ?? 0, variant: claim.variant, qty: claim.qty, amount }
    })
}

/** 문자 구매자를 만든 문자찜의 전화번호 키 (그 구매자 ID = sms:<그 ref>, 판매자 ID 조건) */
async function phoneKeyOfRef(db: Db, sellerId: string, ref: string): Promise<string | null> {
  const rows = await db
    .select({ body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.smsRef, ref), eq(events.type, 'sms')))
    .limit(1)
  const body = rows[0]?.body
  if (body === undefined) return null
  try {
    const key = (JSON.parse(body) as { phoneKey?: unknown }).phoneKey
    return typeof key === 'string' && key !== '' ? key : null
  } catch {
    return null
  }
}

/** 보고 있는 묶음의 표지 (X와 X 아래 합쳐진 구매자 각각) */
async function markersOf(db: Db, sellerId: string, state: EngineState, root: string): Promise<Marker[]> {
  const info = getBuyer(state, root)
  if (info === null) return []
  const markers: Marker[] = []
  for (const id of [root, ...info.merged]) {
    const buyer = getBuyer(state, id)
    if (buyer === null) continue
    if (buyer.kind === 'youtube') markers.push({ kind: 'channel', channel: id })
    else if (buyer.kind === 'sms' && buyer.phoneLast4 !== null && id.startsWith(SMS_PREFIX)) {
      const key = await phoneKeyOfRef(db, sellerId, id.slice(SMS_PREFIX.length))
      if (key !== null) markers.push({ kind: 'phone', key, last4: buyer.phoneLast4 })
    }
  }
  return markers
}

/** 후보: 날짜 → 그날 찾을 (구매자 ID, 표지). DB에서 먼저 거른다 (실제 범위, 보고 있는 날짜 밖, before보다 이른 날짜) */
async function candidates(db: Db, sellerId: string, date: string, before: string | null, markers: readonly Marker[]): Promise<Map<string, { id: string; marker: Marker }[]>> {
  const out = new Map<string, { id: string; marker: Marker }[]>()
  const add = (day: string, id: string, marker: Marker) => {
    const list = out.get(day)
    if (list === undefined) out.set(day, [{ id, marker }])
    else list.push({ id, marker })
  }
  const scopeConditions = [eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), ne(scopes.date, date), ...(before === null ? [] : [lt(scopes.date, before)])]
  for (const marker of markers) {
    if (marker.kind === 'channel') {
      // 채팅 이벤트 본문 {"type":"chat",…,"ch":"<채널>",…} — 글자 안의 따옴표는 \" 로 적혀 이 모양과 맞지 않는다
      const needle = `"ch":${JSON.stringify(marker.channel)}`
      const rows = await db
        .selectDistinct({ date: scopes.date })
        .from(events)
        .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, sellerId)))
        .where(and(eq(events.sellerId, sellerId), eq(events.type, 'chat'), sql`strpos(${events.body}, ${needle}) > 0`, ...scopeConditions))
      for (const row of rows) add(row.date, marker.channel, marker)
    } else {
      const needle = `"phoneKey":${JSON.stringify(marker.key)}`
      const rows = await db
        .select({ date: scopes.date, ref: events.smsRef })
        .from(events)
        .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, sellerId)))
        .where(and(eq(events.sellerId, sellerId), eq(events.type, 'sms'), sql`strpos(${events.body}, ${needle}) > 0`, ...scopeConditions))
        .orderBy(desc(scopes.date))
      for (const row of rows) if (row.ref !== null) add(row.date, `${SMS_PREFIX}${row.ref}`, marker)
    }
  }
  return out
}

/** 그 날짜의 항목들 (같은 Y로 가는 표지는 묶음 하나 — 까닭은 모두) */
async function itemsOn(db: Db, sellerId: string, runtime: ScopeRuntime, day: string, found: readonly { id: string; marker: Marker }[], log?: LogSink): Promise<PastItem[]> {
  const { state, scopeId } = runtime
  if (scopeId === null) return []
  const byRoot = new Map<string, string[]>()
  for (const { id, marker } of found) {
    const buyer = getBuyer(state, id)
    if (buyer === null) continue
    // 채널 ID는 그날의 유튜브 구매자, 전화번호 키는 그날 그 키로 만들어진 문자 구매자(sms:<만든 ref>)
    if (marker.kind === 'channel' ? buyer.kind !== 'youtube' : buyer.kind !== 'sms') continue
    const root = currentBuyerOf(state, id)
    if (root === null) continue
    const reasons = byRoot.get(root) ?? []
    const reason = reasonOf(marker)
    if (!reasons.includes(reason)) reasons.push(reason)
    byRoot.set(root, reasons)
  }
  if (byRoot.size === 0) return []
  const records = await packingRows(db, sellerId, scopeId)
  const broadcasts = listBroadcasts(state)
  const claims = listClaims(state)
  const items: PastItem[] = []
  for (const [root, reasons] of byRoot) {
    const settlement = getSettlement(state, root, day)
    if (settlement.items.length === 0 && settlement.received === 0) continue
    const info = getBuyer(state, root)
    const lines = pastItemLines(state, claims, root, settlement.items, day, log)
    const shownIds = new Set(lines.map((line) => line.broadcast))
    const entry = packingStatusOf(state, day, root, records)
    items.push({
      date: day,
      buyer: root,
      broadcasts: broadcasts.filter((broadcast) => shownIds.has(broadcast.id)).map((broadcast) => broadcast.title),
      name: info?.display ?? '',
      phoneLast4: info?.phoneLast4 ?? null,
      items: lines.map(({ title, no, name, price, variant, qty, amount }) => ({ title, no, name, price, variant, qty, amount })),
      subtotal: settlement.subtotal,
      shipping: settlement.shipping,
      adjustments: settlement.adjustments,
      total: settlement.total,
      payment: settlement.payment,
      received: settlement.received,
      refundDue: settlement.refundDue,
      packing: entry.status,
      invoice: entry.invoice,
      reasons,
    })
  }
  // 같은 날 여러 묶음은 이름 → 구매자 ID 순 (결정적)
  return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.buyer < b.buyer ? -1 : a.buyer > b.buyer ? 1 : 0))
}

/**
 * 지난 구매 (AC-I2-40): 실제 범위 날짜 D의 구매자(합쳐진 구매자 ID면 지금의 구매자로 푼다). 최근 날짜부터 20개, 더 있으면 more·next.
 * 날짜 하나의 항목은 쪽을 나누지 않는다. 범위가 없거나 그 범위가 모르는 구매자면 null(404)
 */
export async function pastPurchases(deps: PastDeps, sellerId: string, date: string, buyer: string, before: string | null): Promise<PastView | null> {
  const runtime = await deps.read(date)
  const { state, seq } = runtime
  if (seq === 0) return null
  if (getBuyer(state, buyer) === null) return null
  const root = currentBuyerOf(state, buyer)
  if (root === null) return null
  const markers = await markersOf(deps.db, sellerId, state, root)
  const found = await candidates(deps.db, sellerId, date, before, markers)
  const days = [...found.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  const items: PastItem[] = []
  let more = false
  for (const day of days) {
    const dayItems = await itemsOn(deps.db, sellerId, await deps.readOther(day), day, found.get(day) ?? [], deps.log)
    if (dayItems.length === 0) continue
    if (items.length >= PAST_PAGE_SIZE) {
      more = true
      break
    }
    items.push(...dayItems)
  }
  return { date, buyer: root, items, more, next: more ? (items.at(-1)?.date ?? null) : null }
}
