// 포장·배송 (STL-08, I2 D-I2-05·D-I2-06·D-I2-07, AC-I2-30~34). 엔진 이벤트가 아니다(DOMAIN_RULES R-1) — 서버가 덧붙이기만 하는 기록으로 상태를 계산한다.
// - 묶음(지금의 구매자 X, 실제 범위 날짜)의 상태는 X의 ID로 적힌 기록만 차례로 읽어 정한다.
// - 품목 = (상품 ID, 품목 키) 쌍 (I2 마지막 감사 TD-I2-005·SA-I2-005, D-I2-19). 지금 품목 = X의 그 날짜 확정 찜(코어 listClaims)을 찜의 키로 묶은 것마다 (상품 ID, 키, 수량).
//   포장 완료 기록은 그때 담은 쌍을 남기고, 쌍 집합이 같을 때만 "같다" — 키가 같아도 다른 상품이면, 같은 상품이어도 번호가 바뀌었으면 다르다.
//   상품 ID가 없는 기록(이 결정 전 형식 — 상품 키 글만)은 어떤 지금 품목과도 같지 않다.
// - 보이는 말 다섯: 포장 대기 · 포장 완료 · 포장 다시 확인 · 배송 완료 · 배송 뒤 바뀜.
// - 명령은 범위 줄(엔진 기록과 같은 줄) 안, 범위 어드바이저리 락을 잡은 트랜잭션에서 검사하고 기록한다. 커밋된 뒤에만 성공 응답·실시간 알림.
// - 옵션 방송 (O3, D-O3-10): 품목은 찜의 키(옵션 찜은 변형 키 `<방송>/<번호>#<옵션 글>`, 아니면 상품 키)마다 하나이고 variant(옵션 글 또는 null)·qty(그 키의 확정 찜 수량 합)를 함께 준다.
//   포장 완료 기록의 품목에 수량을 적고(1이면 적지 않아 O3 전 기록과 같은 모양), 키·수량 중 하나라도 다르면 "포장 다시 확인"(배송 뒤 "배송 뒤 바뀜"). 수량이 없는 기록은 1로 읽는다.
// - 포장 라벨: L-9 포장 라벨 데이터(L-4)를 만들어 packages/label 기본 포장 템플릿(50×30, 한 쪽 10개) + 가게 이름으로 그린다(PNG·PDF, L-6).
import {
  currentBuyerOf,
  getBuyer,
  getSettlement,
  listBroadcasts,
  listClaims,
  listProducts,
  listSettlements,
  type ClaimInfo,
  type EngineState,
  type PaymentStatus,
} from '@livejjim/core'
import { buyerText, createLabelPdf, defaultTemplate, encodeLabelPng, renderPackingLabels, type LabelBitmap, type PackingLabelData } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { packingBroadcasts } from './label-data.ts'
import { packingRecords } from './db/schema.ts'
import type { Rejection } from './writer.ts'

// ── 기록과 상태 ──────────────────────────────────────────────────────────

export const PACKING_KINDS = ['PACKED', 'UNPACKED', 'SHIPPED', 'UNSHIPPED'] as const
export type PackingKind = (typeof PACKING_KINDS)[number]

/**
 * 포장 완료 기록의 품목 하나 = (상품 ID, 품목 키) 쌍과 수량 (D-I2-19, O3 D-O3-10). id가 null이면 이 결정 전 형식(상품 키 글만)이다.
 * key = 찜의 키(옵션 찜은 변형 키). qty = 그 키의 확정 찜 수량 합 — 수량을 적지 않은 기록(O3 전)은 1
 */
export interface PackedItem {
  readonly id: string | null
  readonly key: string
  readonly qty: number
}

export interface PackingRecordRow {
  readonly id: number
  readonly buyer: string
  readonly kind: PackingKind
  readonly items: readonly PackedItem[] | null
  readonly invoice: string | null
}

/** 기록으로 정한 상태: WAITING(포장 대기) · PACKED(포장됨, 그때 품목 P) · SHIPPED(배송됨, P·송장) */
export interface PackingState {
  readonly phase: 'WAITING' | 'PACKED' | 'SHIPPED'
  readonly packed: readonly PackedItem[] | null
  readonly invoice: string | null
}

/** 쌍을 견줄 글. 상품 ID가 없는 품목은 어떤 지금 품목(늘 ID가 있다)과도 같지 않다 */
export const pairText = (item: PackedItem): string => (item.id === null ? `\u0000legacy\u0000${item.key}` : JSON.stringify([item.id, item.key, item.qty]))

/** 기록의 수량 상한 (변형 재고 합보다 크다 — 형식 검사용) */
export const PACKED_QTY_MAX = 1_000_000

const isPackedQty = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= PACKED_QTY_MAX

/** 상품 ID 형식 (코어 상품 ID — 기록·백업 검사) */
export const PRODUCT_ID_RE = /^[^\s]{1,128}$/

/**
 * 저장·백업의 품목 값 하나 → 쌍. 형식 { id, key } · { id, key, qty }(O3 — 수량 2 이상), 이 결정 전 형식은 상품 키 글. 형식이 틀리면 null.
 * 수량을 적지 않은 값은 수량 1로 읽는다(D-O3-10)
 */
export function readPackedItem(value: unknown): PackedItem | null {
  if (typeof value === 'string') return PRODUCT_KEY_RE.test(value) ? { id: null, key: value, qty: 1 } : null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (!keys.includes('id') || !keys.includes('key') || !keys.every((k) => k === 'id' || k === 'key' || k === 'qty')) return null
  const { id, key, qty } = value as { id: unknown; key: unknown; qty?: unknown }
  if (typeof id !== 'string' || !PRODUCT_ID_RE.test(id) || typeof key !== 'string' || !ITEM_KEY_RE.test(key)) return null
  if (keys.includes('qty') && !isPackedQty(qty)) return null
  return { id, key, qty: keys.includes('qty') ? (qty as number) : 1 }
}

/** 저장·백업의 품목 값: { id, key }(수량 1)·{ id, key, qty }(수량 2 이상), 상품 ID가 없는 예전 기록은 상품 키 글 그대로 */
export type PackedItemValue = string | { readonly id: string; readonly key: string; readonly qty?: number }

/** 쌍 → 저장·백업의 품목 값 (수량 1은 적지 않는다 — 다육 묶음의 기록은 O3 전과 같은 모양) */
export const packedItemValue = (item: PackedItem): PackedItemValue =>
  item.id === null ? item.key : item.qty === 1 ? { id: item.id, key: item.key } : { id: item.id, key: item.key, qty: item.qty }

const WAITING: PackingState = { phase: 'WAITING', packed: null, invoice: null }

/** 한 구매자 ID의 기록을 차례로 읽는다 (AC-I2-30): 포장 완료 → 포장됨(P), 포장 취소 → 대기, 배송 완료 → 배송됨(P, 송장), 배송 취소 → 포장됨(P) */
export function replayPacking(records: readonly Pick<PackingRecordRow, 'kind' | 'items' | 'invoice'>[]): PackingState {
  let state = WAITING
  for (const record of records) {
    switch (record.kind) {
      case 'PACKED':
        state = { phase: 'PACKED', packed: record.items ?? [], invoice: null }
        break
      case 'UNPACKED':
        state = WAITING
        break
      case 'SHIPPED':
        state = { phase: 'SHIPPED', packed: state.packed ?? [], invoice: record.invoice }
        break
      case 'UNSHIPPED':
        state = { phase: 'PACKED', packed: state.packed ?? [], invoice: null }
        break
    }
  }
  return state
}

/** 보이는 상태 말 다섯 (AC-I2-30, UX-01 — 화면이 그대로 보인다) */
export const PACKING_WORDS = ['포장 대기', '포장 완료', '포장 다시 확인', '배송 완료', '배송 뒤 바뀜'] as const
export type PackingWord = (typeof PACKING_WORDS)[number]

const sameSet = (a: readonly string[], b: ReadonlySet<string>): boolean => new Set(a).size === b.size && a.every((key) => b.has(key))

/** current = 지금 품목 쌍의 견줄 글(pairText) 집합 */
export function packingWord(state: PackingState, current: ReadonlySet<string>): PackingWord {
  if (state.phase === 'WAITING') return '포장 대기'
  const same = sameSet((state.packed ?? []).map(pairText), current)
  if (state.phase === 'PACKED') return same ? '포장 완료' : '포장 다시 확인'
  return same ? '배송 완료' : '배송 뒤 바뀜'
}

/** 판매대장 "배송" 칸 (AC-I2-33): 상태 말, 송장번호가 있는 배송 완료는 `배송 완료 · 송장 <번호>` */
export function ledgerShippingWord(word: PackingWord, invoice: string | null): string {
  return word === '배송 완료' && invoice !== null ? `배송 완료 · 송장 ${invoice}` : word
}

// ── 묶음 보기 ────────────────────────────────────────────────────────────

/** 상품 키 `<방송 ID>/<번호>` 형식 (README 상품 키) */
export const PRODUCT_KEY_RE = /^([^\s/@]+)\/([1-9][0-9]{0,8})$/

/** 품목 키 = 상품 키 또는 변형 키 `<방송 ID>/<번호>#<옵션 글>` (O3 — 옵션 글은 제어 글자 없는 1~200자) */
export const ITEM_KEY_RE = /^([^\s/@]+)\/([1-9][0-9]{0,8})(?:#([^\p{Cc}]{1,200}))?$/u

export interface PackingItem {
  /** 상품 ID (번호를 바꿔도 그대로, D-I2-19) */
  readonly id: string
  readonly key: string
  readonly broadcast: string
  /** 방송 제목 */
  readonly title: string
  readonly no: number
  /** 품종 (빈 품종은 "") */
  readonly name: string
  /** 찜 금액 (그 키의 확정 찜마다 단가 스냅샷 × 수량의 합 — 옵션 없는 수량 1이면 찜 시점 가격 스냅샷) */
  readonly price: number
  /** 옵션 글 (옵션 없는 찜이면 null, O3) */
  readonly variant: string | null
  /** 수량 = 그 키의 확정 찜 수량 합 (O3) */
  readonly qty: number
}

/** 뺄 것: 포장 때의 쌍 — 포장 때 키·번호, 그 상품의 지금 품종 (D-I2-19) */
export interface PackingRemoved {
  /** 상품 ID (이 결정 전 기록이면 null) */
  readonly id: string | null
  /** 포장 때 상품 키 */
  readonly key: string
  readonly broadcast: string
  readonly title: string
  /** 포장 때 번호 */
  readonly no: number
  /** 그 상품의 지금 품종 (상품을 찾지 못하면 "") */
  readonly name: string
}

/** 포장 목록 한 줄 = 묶음 (AC-I2-30·35) */
export interface PackingEntry {
  /** 지금의 구매자 ID */
  readonly buyer: string
  /** 표시 이름 (BUY-01 이름 표기는 화면이 phoneLast4와 함께 만든다) */
  readonly name: string
  readonly phoneLast4: string | null
  /** 정산 묶음 입금 상태 (코어 값 — 화면이 D-092 말로 바꾼다) */
  readonly payment: PaymentStatus
  /** 지금 품목 (방송 선언 순 → 번호 순) */
  readonly items: readonly PackingItem[]
  readonly status: PackingWord
  /** 배송 완료(배송 뒤 바뀜 포함)의 송장번호 (없으면 null) */
  readonly invoice: string | null
  /** 포장 다시 확인·배송 뒤 바뀜: 새로 담을 것(지금 있고 포장 때 없던 쌍 — 지금 번호·품종) */
  readonly add: readonly PackingItem[]
  /** 포장 다시 확인·배송 뒤 바뀜: 뺄 것(포장 때 있고 지금 없는 쌍 — 포장 때 번호, 그 상품의 지금 품종) */
  readonly remove: readonly PackingRemoved[]
}

interface ScopeLookup {
  readonly order: ReadonlyMap<string, number>
  readonly titles: ReadonlyMap<string, string>
  readonly names: ReadonlyMap<string, string>
  /** 상품 키 → 상품 ID, 상품 ID → 지금 품종 */
  readonly ids: ReadonlyMap<string, string>
  readonly namesById: ReadonlyMap<string, string>
  /** 지금의 구매자 → 확정 찜 (코어 조회 순서) */
  readonly confirmed: ReadonlyMap<string, readonly ClaimInfo[]>
  /** 방송 ID → 날짜 */
  readonly dates: ReadonlyMap<string, string>
  /** 상품 키 → 옵션 글 → 변형 순서 */
  readonly variantOrder: ReadonlyMap<string, ReadonlyMap<string, number>>
}

function lookupOf(state: EngineState): ScopeLookup {
  const broadcasts = listBroadcasts(state)
  const names = new Map<string, string>()
  const ids = new Map<string, string>()
  const namesById = new Map<string, string>()
  const variantOrder = new Map<string, Map<string, number>>()
  for (const product of listProducts(state)) {
    names.set(product.key, product.name)
    ids.set(product.key, product.id)
    namesById.set(product.id, product.name)
    if (product.variants.length > 0) variantOrder.set(product.key, new Map(product.variants.map((variant, i) => [variant.text, i])))
  }
  const confirmed = new Map<string, ClaimInfo[]>()
  for (const claim of listClaims(state)) {
    if (claim.status !== 'CONFIRMED') continue
    const list = confirmed.get(claim.currentBuyer)
    if (list === undefined) confirmed.set(claim.currentBuyer, [claim])
    else list.push(claim)
  }
  return {
    order: new Map(broadcasts.map((broadcast, i) => [broadcast.id, i])),
    titles: new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast.title])),
    names,
    ids,
    namesById,
    confirmed,
    dates: new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast.date])),
    variantOrder,
  }
}

/** 품목 키 → 방송·번호·상품 키·옵션 글 */
function splitKey(key: string): { broadcast: string; no: number; product: string; variant: string | null } {
  const match = ITEM_KEY_RE.exec(key)
  if (match === null) return { broadcast: '', no: 0, product: key, variant: null }
  const broadcast = match[1] as string
  return { broadcast, no: Number(match[2]), product: `${broadcast}/${match[2] as string}`, variant: match[3] ?? null }
}

/**
 * 묶음의 지금 품목 (지금의 구매자 buyer, 날짜) — 찜의 키마다 하나, 수량·찜 금액은 그 키의 확정 찜 합 (O3 D-O3-10).
 * 순서: 방송 선언 순 → 번호 → 상품의 변형 순서
 */
function currentItems(lookup: ScopeLookup, buyer: string, date: string): PackingItem[] {
  const byKey = new Map<string, { claim: ClaimInfo; qty: number; amount: number }>()
  for (const claim of lookup.confirmed.get(buyer) ?? []) {
    if (lookup.dates.get(claim.broadcast) !== date) continue
    const amount = claim.amount ?? (claim.price ?? 0) * claim.qty
    const group = byKey.get(claim.key)
    if (group === undefined) byKey.set(claim.key, { claim, qty: claim.qty, amount })
    else {
      group.qty += claim.qty
      group.amount += amount
    }
  }
  const items = [...byKey.entries()].map(([key, { claim, qty, amount }]): PackingItem => ({
    id: lookup.ids.get(claim.product) ?? '',
    key,
    broadcast: claim.broadcast,
    title: lookup.titles.get(claim.broadcast) ?? '',
    no: claim.no,
    name: lookup.names.get(claim.product) ?? '',
    price: amount,
    variant: claim.variant,
    qty,
  }))
  return sortItems(lookup, items)
}

const pairOf = (item: PackingItem): PackedItem => ({ id: item.id === '' ? null : item.id, key: item.key, qty: item.qty })

function variantRank(lookup: ScopeLookup, item: { key: string }): number {
  const { product, variant } = splitKey(item.key)
  if (variant === null) return -1
  return lookup.variantOrder.get(product)?.get(variant) ?? Number.MAX_SAFE_INTEGER
}

function sortItems<T extends { broadcast: string; no: number; key: string }>(lookup: ScopeLookup, items: T[]): T[] {
  return items.sort(
    (a, b) =>
      (lookup.order.get(a.broadcast) ?? Infinity) - (lookup.order.get(b.broadcast) ?? Infinity) ||
      a.no - b.no ||
      variantRank(lookup, a) - variantRank(lookup, b) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}

/** 묶음 하나 (지금의 구매자 X, 날짜) — X의 ID로 적힌 기록만 */
export function packingEntry(state: EngineState, date: string, buyer: string, records: readonly PackingRecordRow[], lookup: ScopeLookup = lookupOf(state)): PackingEntry {
  const settlement = getSettlement(state, buyer, date)
  const info = getBuyer(state, buyer)
  const items = currentItems(lookup, buyer, date)
  const current = new Set(items.map((item) => pairText(pairOf(item))))
  const packing = replayPacking(records.filter((record) => record.buyer === buyer))
  const status = packingWord(packing, current)
  const changed = status === '포장 다시 확인' || status === '배송 뒤 바뀜'
  const packedItems = packing.packed ?? []
  const packed = new Set(packedItems.map(pairText))
  return {
    buyer,
    name: info?.display ?? '',
    phoneLast4: info?.phoneLast4 ?? null,
    payment: settlement.payment,
    items,
    status,
    invoice: packing.phase === 'SHIPPED' ? packing.invoice : null,
    add: changed ? items.filter((item) => !packed.has(pairText(pairOf(item)))) : [],
    remove: changed
      ? sortItems(
          lookup,
          packedItems
            .filter((item) => !current.has(pairText(item)))
            .map((item): PackingRemoved => {
              const { broadcast, no } = splitKey(item.key)
              return { id: item.id, key: item.key, broadcast, title: lookup.titles.get(broadcast) ?? '', no, name: item.id === null ? '' : (lookup.namesById.get(item.id) ?? '') }
            }),
        )
      : [],
  }
}

/**
 * 포장 목록 (AC-I2-30): 그날 품목이 있는 지금의 구매자 묶음 + 품목이 없어도 자기 ID에 포장 기록이 있는 지금의 구매자 묶음.
 * 합쳐진 구매자는 따로 나오지 않는다(그 ID의 기록은 떼어 낼 때까지 보이지 않는다)
 */
export function packingEntries(state: EngineState, date: string, records: readonly PackingRecordRow[]): PackingEntry[] {
  const lookup = lookupOf(state)
  const buyers = new Set<string>()
  for (const settlement of listSettlements(state)) if (settlement.date === date && settlement.items.length > 0) buyers.add(settlement.buyer)
  for (const record of records) {
    if (getBuyer(state, record.buyer) !== null && currentBuyerOf(state, record.buyer) === record.buyer) buyers.add(record.buyer)
  }
  return [...buyers].map((buyer) => packingEntry(state, date, buyer, records, lookup))
}

// ── DB ───────────────────────────────────────────────────────────────────

/** 저장된 품목 JSON → 쌍 목록 (새 형식 { id, key }·예전 형식 상품 키 글, 형식이 틀린 값은 뺀다) */
export function parsePackedItems(text: string): PackedItem[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as unknown[]).flatMap((value) => readPackedItem(value) ?? []) : []
  } catch {
    return []
  }
}

/** 쌍 목록 → 저장할 품목 JSON */
export const packedItemsJson = (items: readonly PackedItem[]): string => JSON.stringify(items.map(packedItemValue))

function toRow(row: { id: number; buyer: string; kind: string; items: string | null; invoice: string | null }): PackingRecordRow {
  const items = row.items === null ? null : parsePackedItems(row.items)
  return { id: row.id, buyer: row.buyer, kind: (PACKING_KINDS as readonly string[]).includes(row.kind) ? (row.kind as PackingKind) : 'UNPACKED', items, invoice: row.invoice }
}

/** 범위의 포장 기록 전부 (기록 순, 판매자 ID 조건). buyer를 주면 그 구매자 ID 것만 */
export async function packingRows(db: Db, sellerId: string, scopeId: string, buyer?: string): Promise<PackingRecordRow[]> {
  const rows = await db
    .select({ id: packingRecords.id, buyer: packingRecords.buyer, kind: packingRecords.kind, items: packingRecords.items, invoice: packingRecords.invoice })
    .from(packingRecords)
    .where(and(eq(packingRecords.sellerId, sellerId), eq(packingRecords.scopeId, scopeId), ...(buyer === undefined ? [] : [eq(packingRecords.buyer, buyer)])))
    .orderBy(asc(packingRecords.id))
  return rows.map(toRow)
}

/** 요청 번호로 적은 포장 기록 (같은 요청 번호 = 처음 결과) */
export async function packingByRequest(db: Db, sellerId: string, requestId: string): Promise<{ date: string; buyer: string } | null> {
  const rows = await db
    .select({ date: packingRecords.date, buyer: packingRecords.buyer })
    .from(packingRecords)
    .where(and(eq(packingRecords.sellerId, sellerId), eq(packingRecords.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

// ── 합치기·떼어 내기 제한 (I2 마지막 감사 RA-I2-009, D-I2-20, AC-I2-31) ────────

export const MERGE_PACKING_MESSAGES = {
  merge: '포장이나 배송을 적은 구매자는 다른 구매자에 합칠 수 없어요. 포장 모드에서 먼저 취소해 주세요.',
  unmerge: '배송을 적은 구매자에게서는 떼어 낼 수 없어요. 포장 모드에서 배송 완료를 먼저 취소해 주세요.',
} as const

/**
 * 실제 범위의 합치기·떼어 내기를 엔진 이벤트로 기록하기 전에(같은 범위 줄·락을 잡은 트랜잭션 안에서) 본다:
 * - 합치기: 합쳐질 구매자 X(from)의 그 날짜 포장 상태가 `포장 대기`가 아니면(포장 완료·포장 다시 확인·배송 완료·배송 뒤 바뀜) 409.
 *   X의 기록은 X ID에만 붙어 있어 합치면 목록에서 사라지고, Y가 X의 품목을 `포장 대기`로 보여 이미 보낸 상품을 또 보낼 수 있다.
 * - 떼어 내기: 떼어 낼 구매자 X가 붙어 있는 지금의 구매자 Y의 상태가 `배송 완료`·`배송 뒤 바뀜`이면 409.
 * 포장 상태가 대기인지·배송됨인지는 기록만으로 정해진다(지금 품목과 견주는 것은 완료·다시 확인을 가를 때뿐). 형식이 틀린 입력은 엔진이 거른다
 */
export async function mergePackingCheck(
  db: Db,
  sellerId: string,
  scopeId: string | null,
  state: EngineState,
  fields: Readonly<Record<string, unknown>>,
): Promise<Rejection | null> {
  if (scopeId === null) return null
  const from = fields['from']
  if (typeof from !== 'string' || from === '') return null
  const refuse = (message: string): Rejection => ({ status: 409, code: 'PACKING_RECORDED', message, problems: [] })
  if (fields['type'] === 'buyer.merge') {
    const phase = replayPacking(await packingRows(db, sellerId, scopeId, from)).phase
    return phase === 'WAITING' ? null : refuse(MERGE_PACKING_MESSAGES.merge)
  }
  if (fields['type'] === 'buyer.unmerge') {
    if (getBuyer(state, from) === null) return null
    const into = currentBuyerOf(state, from)
    if (into === null || into === from) return null
    const phase = replayPacking(await packingRows(db, sellerId, scopeId, into)).phase
    return phase === 'SHIPPED' ? refuse(MERGE_PACKING_MESSAGES.unmerge) : null
  }
  return null
}

// ── 명령 ─────────────────────────────────────────────────────────────────

export const PACKING_ACTIONS = ['pack', 'unpack', 'ship', 'unship'] as const
export type PackingAction = (typeof PACKING_ACTIONS)[number]

export const PACKING_MESSAGES = {
  itemsChanged: '그 사이에 구매 내역이 바뀌었어요. 다시 확인해 주세요.',
  alreadyShipped: '이미 배송 완료로 적었어요. 먼저 배송 완료를 취소해 주세요.',
  noItems: '담을 상품이 없어 포장 완료로 적을 수 없어요.',
  notPacked: '포장 완료로 적은 기록이 없어요.',
  shipBeforePack: '포장 완료 뒤에 배송 완료로 적을 수 있어요.',
  shipChanged: '구매 내역이 바뀌었어요. 다시 포장 확인부터 해 주세요.',
  notShipped: '배송 완료로 적은 기록이 없어요.',
  buyer: '구매자를 다시 확인해 주세요.',
  invoiceFormat: '송장번호는 숫자 8~20자리로 적어 주세요.',
  invoicePhone: '전화번호처럼 보여요. 송장번호를 확인해 주세요.',
} as const

/** 포장 완료가 보낸 품목 하나: 품목 키 글, 또는 { key, qty }(화면이 본 수량 — O3) */
export type SentItem = string | { readonly key: string; readonly qty: number }

const sentKey = (item: SentItem): string => (typeof item === 'string' ? item : item.key)

/** 포장 완료 본문의 items 원소 하나를 읽는다 (형식이 틀리면 null) */
export function readSentItem(value: unknown): SentItem | null {
  if (typeof value === 'string') return ITEM_KEY_RE.test(value) ? value : null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('key') || !keys.includes('qty')) return null
  const { key, qty } = value as { key: unknown; qty: unknown }
  return typeof key === 'string' && ITEM_KEY_RE.test(key) && isPackedQty(qty) ? { key, qty } : null
}

export type PackingDecision =
  | { readonly kind: 'write'; readonly record: { readonly kind: PackingKind; readonly items: readonly PackedItem[] | null; readonly invoice: string | null } }
  | { readonly kind: 'same' }
  | { readonly kind: 'reject'; readonly code: 'PACKING_STATE' | 'ITEMS_CHANGED'; readonly message: string }

/**
 * 명령 판단 (AC-I2-31, D-I2-05): 받는 경우만 기록, 이미 그 상태인 같은 명령은 성공·새 기록 없음, 그 밖은 쉬운 오류.
 * current = 지금 품목 쌍. sentItems는 포장 완료가 보낸 품목(중복 없는 상품 키) — 지금 품목의 키 집합과 같으면 서버가 상품 ID를 붙여
 * 지금 품목 쌍을 기록한다(D-I2-19). invoice는 배송 완료의 송장번호(숫자만 또는 null)
 */
export function decidePacking(state: PackingState, current: readonly PackedItem[], action: PackingAction, sentItems: readonly SentItem[], invoice: string | null): PackingDecision {
  const word = packingWord(state, new Set(current.map(pairText)))
  switch (action) {
    case 'pack': {
      if (state.phase === 'SHIPPED') return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.alreadyShipped }
      if (!sameSet(sentItems.map(sentKey), new Set(current.map((item) => item.key)))) return { kind: 'reject', code: 'ITEMS_CHANGED', message: PACKING_MESSAGES.itemsChanged }
      // 수량을 함께 보냈으면 지금 수량과 같아야 한다 — 화면이 본 수량과 다르면 덜 담을 수 있다 (O3 D-O3-10)
      const qtyOf = new Map(current.map((item) => [item.key, item.qty]))
      if (sentItems.some((item) => typeof item !== 'string' && qtyOf.get(item.key) !== item.qty)) return { kind: 'reject', code: 'ITEMS_CHANGED', message: PACKING_MESSAGES.itemsChanged }
      if (current.length === 0) return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.noItems }
      if (word === '포장 완료') return { kind: 'same' }
      return { kind: 'write', record: { kind: 'PACKED', items: current.map((item) => ({ id: item.id, key: item.key, qty: item.qty })), invoice: null } }
    }
    case 'unpack':
      if (state.phase === 'PACKED') return { kind: 'write', record: { kind: 'UNPACKED', items: null, invoice: null } }
      return { kind: 'reject', code: 'PACKING_STATE', message: state.phase === 'SHIPPED' ? PACKING_MESSAGES.alreadyShipped : PACKING_MESSAGES.notPacked }
    case 'ship':
      if (word === '포장 완료') return { kind: 'write', record: { kind: 'SHIPPED', items: null, invoice } }
      if (word === '배송 완료') return state.invoice === invoice ? { kind: 'same' } : { kind: 'write', record: { kind: 'SHIPPED', items: null, invoice } }
      if (word === '포장 대기') return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.shipBeforePack }
      return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.shipChanged }
    case 'unship':
      if (state.phase === 'SHIPPED') return { kind: 'write', record: { kind: 'UNSHIPPED', items: null, invoice: null } }
      return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.notShipped }
  }
}

/**
 * 송장번호 (AC-I2-31, D-I2-06): 공백·`-`를 뺀 숫자 8~20자리, 저장은 숫자만. 빈 값·없음 = 송장 없음(null).
 * 휴대폰 번호 모양(R-1 글 칸 판단 containsPhoneRun)이면 거절
 */
export function readInvoice(value: unknown, containsPhoneRun: (text: string) => boolean): { ok: true; invoice: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, invoice: null }
  if (typeof value !== 'string') return { ok: false, message: PACKING_MESSAGES.invoiceFormat }
  const digits = value.replace(/[\s-]/g, '')
  if (digits === '') return { ok: true, invoice: null }
  if (!/^[0-9]{8,20}$/.test(digits)) return { ok: false, message: PACKING_MESSAGES.invoiceFormat }
  if (containsPhoneRun(value) || containsPhoneRun(digits)) return { ok: false, message: PACKING_MESSAGES.invoicePhone }
  return { ok: true, invoice: digits }
}

// ── 포장 라벨 (AC-I2-34, L-4·L-6·L-9, D-I2-07) ───────────────────────────

/** 묶음의 L-9 포장 라벨 데이터 (옵션 방송은 변형마다 항목 — label-data.ts packingBroadcasts). 품목이 없으면 null */
export function packingLabelData(state: EngineState, date: string, buyer: string): PackingLabelData | null {
  const settlement = getSettlement(state, buyer, date)
  if (settlement.items.length === 0) return null
  const info = getBuyer(state, buyer)
  return {
    date,
    buyer: info?.kind === 'sms' ? { kind: 'sms' } : { kind: 'youtube', name: info?.display ?? '' },
    broadcasts: packingBroadcasts(state, buyer, date),
    subtotal: settlement.subtotal,
  }
}

export interface PackingLabels {
  readonly pages: readonly LabelBitmap[]
  /** 라벨에 찍힌 구매자 글 (파일 이름용) */
  readonly buyerText: string
}

/** 기본 포장 템플릿(50×30, 한 쪽 10개) + 가게 이름으로 쪽마다 1비트 그림 (오류면 라벨 패키지의 오류) */
export function renderPacking(data: PackingLabelData, shopName: string): { ok: true; labels: PackingLabels } | { ok: false; code: string } {
  const template = { ...defaultTemplate('packing', '50x30'), shopName }
  const rendered = renderPackingLabels(createNodeRenderEnv(), template, data)
  if (!rendered.ok) return { ok: false, code: rendered.error.code }
  return { ok: true, labels: { pages: rendered.pages.map((page) => page.image), buyerText: buyerText(data.buyer) } }
}

export function labelPng(bitmap: LabelBitmap): Uint8Array | null {
  const png = encodeLabelPng(bitmap)
  return png.ok ? png.bytes : null
}

export function labelPdf(bitmaps: readonly LabelBitmap[]): Uint8Array | null {
  const pdf = createLabelPdf(bitmaps)
  return pdf.ok ? pdf.bytes : null
}

/** 묶음마다의 상태 말·송장 (판매대장 배송 칸·정산 조회 — AC-I2-33). 그날 품목이 있는 지금의 구매자 + 자기 ID에 기록이 있는 지금의 구매자 */
export function packingStatusByBuyer(state: EngineState, date: string, records: readonly PackingRecordRow[]): Map<string, { readonly status: PackingWord; readonly invoice: string | null }> {
  const byBuyer = new Map<string, PackingRecordRow[]>()
  for (const record of records) {
    const list = byBuyer.get(record.buyer)
    if (list === undefined) byBuyer.set(record.buyer, [record])
    else list.push(record)
  }
  const out = new Map<string, { status: PackingWord; invoice: string | null }>()
  const lookup = lookupOf(state)
  const add = (buyer: string) => {
    const packing = replayPacking(byBuyer.get(buyer) ?? [])
    const current = new Set(currentItems(lookup, buyer, date).map((item) => pairText(pairOf(item))))
    out.set(buyer, { status: packingWord(packing, current), invoice: packing.phase === 'SHIPPED' ? packing.invoice : null })
  }
  for (const settlement of listSettlements(state)) if (settlement.date === date && settlement.items.length > 0) add(settlement.buyer)
  for (const buyer of byBuyer.keys()) {
    if (out.has(buyer) || getBuyer(state, buyer) === null || currentBuyerOf(state, buyer) !== buyer) continue
    add(buyer)
  }
  return out
}
