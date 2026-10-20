// 포장·배송 (STL-08, I2 D-I2-05·D-I2-06·D-I2-07, AC-I2-30~34). 엔진 이벤트가 아니다(DOMAIN_RULES R-1) — 서버가 덧붙이기만 하는 기록으로 상태를 계산한다.
// - 묶음(지금의 구매자 X, 실제 범위 날짜)의 상태는 X의 ID로 적힌 기록만 차례로 읽어 정한다.
// - 품목 = (상품 ID, 상품 키) 쌍 (I2 마지막 감사 TD-I2-005·SA-I2-005, D-I2-19). 지금 품목 = 코어 getSettlement(X, 날짜).items마다 (getProduct().id, 키).
//   포장 완료 기록은 그때 담은 쌍을 남기고, 쌍 집합이 같을 때만 "같다" — 키가 같아도 다른 상품이면, 같은 상품이어도 번호가 바뀌었으면 다르다.
//   상품 ID가 없는 기록(이 결정 전 형식 — 상품 키 글만)은 어떤 지금 품목과도 같지 않다.
// - 보이는 말 다섯: 포장 대기 · 포장 완료 · 포장 다시 확인 · 배송 완료 · 배송 뒤 바뀜.
// - 명령은 범위 줄(엔진 기록과 같은 줄) 안, 범위 어드바이저리 락을 잡은 트랜잭션에서 검사하고 기록한다. 커밋된 뒤에만 성공 응답·실시간 알림.
// - 포장 라벨: L-9 포장 라벨 데이터(L-4)를 만들어 packages/label 기본 포장 템플릿(50×30, 한 쪽 10개) + 가게 이름으로 그린다(PNG·PDF, L-6).
import {
  currentBuyerOf,
  getBuyer,
  getProduct,
  getSettlement,
  listBroadcasts,
  listClaims,
  listProducts,
  listSettlements,
  type EngineState,
  type PaymentStatus,
} from '@livejjim/core'
import { buyerText, createLabelPdf, defaultTemplate, encodeLabelPng, renderPackingLabels, type LabelBitmap, type PackingLabelData } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { packingRecords } from './db/schema.ts'
import type { Rejection } from './writer.ts'

// ── 기록과 상태 ──────────────────────────────────────────────────────────

export const PACKING_KINDS = ['PACKED', 'UNPACKED', 'SHIPPED', 'UNSHIPPED'] as const
export type PackingKind = (typeof PACKING_KINDS)[number]

/** 포장 완료 기록의 품목 하나 = (상품 ID, 상품 키) 쌍 (D-I2-19). id가 null이면 이 결정 전 형식(상품 키 글만)이다 */
export interface PackedItem {
  readonly id: string | null
  readonly key: string
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
export const pairText = (item: PackedItem): string => (item.id === null ? `\u0000legacy\u0000${item.key}` : JSON.stringify([item.id, item.key]))

/** 상품 ID 형식 (코어 상품 ID — 기록·백업 검사) */
export const PRODUCT_ID_RE = /^[^\s]{1,128}$/

/**
 * 저장·백업의 품목 값 하나 → 쌍. 새 형식 { id, key }, 이 결정 전 형식은 상품 키 글. 형식이 틀리면 null
 */
export function readPackedItem(value: unknown): PackedItem | null {
  if (typeof value === 'string') return PRODUCT_KEY_RE.test(value) ? { id: null, key: value } : null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('key')) return null
  const { id, key } = value as { id: unknown; key: unknown }
  if (typeof id !== 'string' || !PRODUCT_ID_RE.test(id) || typeof key !== 'string' || !PRODUCT_KEY_RE.test(key)) return null
  return { id, key }
}

/** 저장·백업의 품목 값: 새 형식 { id, key }, 상품 ID가 없는 예전 기록은 상품 키 글 그대로 */
export type PackedItemValue = string | { readonly id: string; readonly key: string }

/** 쌍 → 저장·백업의 품목 값 */
export const packedItemValue = (item: PackedItem): PackedItemValue => (item.id === null ? item.key : { id: item.id, key: item.key })

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
  /** 찜 시점 가격 스냅샷 */
  readonly price: number
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
  readonly prices: ReadonlyMap<string, ReadonlyMap<string, number>>
}

function lookupOf(state: EngineState): ScopeLookup {
  const broadcasts = listBroadcasts(state)
  const names = new Map<string, string>()
  const ids = new Map<string, string>()
  const namesById = new Map<string, string>()
  for (const product of listProducts(state)) {
    names.set(product.key, product.name)
    ids.set(product.key, product.id)
    namesById.set(product.id, product.name)
  }
  // 확정 찜의 가격 스냅샷: 지금의 구매자 → 상품 키 → 가격
  const prices = new Map<string, Map<string, number>>()
  for (const claim of listClaims(state)) {
    if (claim.status !== 'CONFIRMED' || claim.price === null) continue
    let byKey = prices.get(claim.currentBuyer)
    if (byKey === undefined) prices.set(claim.currentBuyer, (byKey = new Map()))
    byKey.set(claim.product, claim.price)
  }
  return {
    order: new Map(broadcasts.map((broadcast, i) => [broadcast.id, i])),
    titles: new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast.title])),
    names,
    ids,
    namesById,
    prices,
  }
}

function splitKey(key: string): { broadcast: string; no: number } {
  const match = PRODUCT_KEY_RE.exec(key)
  return match === null ? { broadcast: '', no: 0 } : { broadcast: match[1] as string, no: Number(match[2]) }
}

function itemOf(lookup: ScopeLookup, buyer: string, key: string): PackingItem {
  const { broadcast, no } = splitKey(key)
  return { id: lookup.ids.get(key) ?? '', key, broadcast, title: lookup.titles.get(broadcast) ?? '', no, name: lookup.names.get(key) ?? '', price: lookup.prices.get(buyer)?.get(key) ?? 0 }
}

/** 지금 품목 쌍 (지금 품목의 상품 키마다 코어 getProduct().id) — 정산 품목은 늘 있는 상품이다 */
export function currentPairs(state: EngineState, keys: readonly string[]): PackedItem[] {
  return keys.map((key) => {
    const { broadcast, no } = splitKey(key)
    return { id: getProduct(state, broadcast, no)?.id ?? null, key }
  })
}

function sortItems<T extends { broadcast: string; no: number }>(lookup: ScopeLookup, items: T[]): T[] {
  return items.sort((a, b) => (lookup.order.get(a.broadcast) ?? Infinity) - (lookup.order.get(b.broadcast) ?? Infinity) || a.no - b.no)
}

/** 묶음 하나 (지금의 구매자 X, 날짜) — X의 ID로 적힌 기록만 */
export function packingEntry(state: EngineState, date: string, buyer: string, records: readonly PackingRecordRow[], lookup: ScopeLookup = lookupOf(state)): PackingEntry {
  const settlement = getSettlement(state, buyer, date)
  const info = getBuyer(state, buyer)
  const pairs = settlement.items.map((key): PackedItem => ({ id: lookup.ids.get(key) ?? null, key }))
  const current = new Set(pairs.map(pairText))
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
    items: sortItems(lookup, settlement.items.map((key) => itemOf(lookup, buyer, key))),
    status,
    invoice: packing.phase === 'SHIPPED' ? packing.invoice : null,
    add: changed ? sortItems(lookup, pairs.filter((pair) => !packed.has(pairText(pair))).map((pair) => itemOf(lookup, buyer, pair.key))) : [],
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

export type PackingDecision =
  | { readonly kind: 'write'; readonly record: { readonly kind: PackingKind; readonly items: readonly PackedItem[] | null; readonly invoice: string | null } }
  | { readonly kind: 'same' }
  | { readonly kind: 'reject'; readonly code: 'PACKING_STATE' | 'ITEMS_CHANGED'; readonly message: string }

/**
 * 명령 판단 (AC-I2-31, D-I2-05): 받는 경우만 기록, 이미 그 상태인 같은 명령은 성공·새 기록 없음, 그 밖은 쉬운 오류.
 * current = 지금 품목 쌍. sentItems는 포장 완료가 보낸 품목(중복 없는 상품 키) — 지금 품목의 키 집합과 같으면 서버가 상품 ID를 붙여
 * 지금 품목 쌍을 기록한다(D-I2-19). invoice는 배송 완료의 송장번호(숫자만 또는 null)
 */
export function decidePacking(state: PackingState, current: readonly PackedItem[], action: PackingAction, sentItems: readonly string[], invoice: string | null): PackingDecision {
  const word = packingWord(state, new Set(current.map(pairText)))
  switch (action) {
    case 'pack': {
      if (state.phase === 'SHIPPED') return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.alreadyShipped }
      if (!sameSet(sentItems, new Set(current.map((item) => item.key)))) return { kind: 'reject', code: 'ITEMS_CHANGED', message: PACKING_MESSAGES.itemsChanged }
      if (current.length === 0) return { kind: 'reject', code: 'PACKING_STATE', message: PACKING_MESSAGES.noItems }
      if (word === '포장 완료') return { kind: 'same' }
      return { kind: 'write', record: { kind: 'PACKED', items: current.map((item) => ({ id: item.id, key: item.key })), invoice: null } }
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

/** 묶음의 L-9 포장 라벨 데이터. 품목이 없으면 null */
export function packingLabelData(state: EngineState, date: string, buyer: string): PackingLabelData | null {
  const settlement = getSettlement(state, buyer, date)
  if (settlement.items.length === 0) return null
  const info = getBuyer(state, buyer)
  const lookup = lookupOf(state)
  const byBroadcast = new Map<string, number[]>()
  for (const key of settlement.items) {
    const { broadcast, no } = splitKey(key)
    const list = byBroadcast.get(broadcast)
    if (list === undefined) byBroadcast.set(broadcast, [no])
    else list.push(no)
  }
  const broadcasts = [...byBroadcast.entries()]
    .sort(([a], [b]) => (lookup.order.get(a) ?? Infinity) - (lookup.order.get(b) ?? Infinity))
    .map(([id, numbers]) => ({ title: lookup.titles.get(id) ?? '', numbers: [...numbers].sort((x, y) => x - y) }))
  return {
    date,
    buyer: info?.kind === 'sms' ? { kind: 'sms' } : { kind: 'youtube', name: info?.display ?? '' },
    broadcasts,
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
  const add = (buyer: string, items: readonly string[]) => {
    const packing = replayPacking(byBuyer.get(buyer) ?? [])
    out.set(buyer, { status: packingWord(packing, new Set(currentPairs(state, items).map(pairText))), invoice: packing.phase === 'SHIPPED' ? packing.invoice : null })
  }
  for (const settlement of listSettlements(state)) if (settlement.date === date && settlement.items.length > 0) add(settlement.buyer, settlement.items)
  for (const buyer of byBuyer.keys()) {
    if (out.has(buyer) || getBuyer(state, buyer) === null || currentBuyerOf(state, buyer) !== buyer) continue
    add(buyer, getSettlement(state, buyer, date).items)
  }
  return out
}
