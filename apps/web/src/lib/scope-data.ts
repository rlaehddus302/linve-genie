// 범위 조회 결과를 화면이 들고 있는 모양 (AC-S05-61·62, D-085).
// 전체 조회로 시작해 증분 조회를 덮는다: 목록마다 키로 덮고, removed의 키는 지우고, 확인 필요는 덧붙인다.
// 서버가 지키는 성질 "since의 전체 + 증분 = 지금의 전체"를 그대로 따르므로 화면이 판정을 다시 하지 않는다.
// 입금 연결(N3)은 증분이 아니라 범위 전체로 온다 — 증분에 있으면 바꾸고, 없으면 그대로 둔다(정산 묶음이 바뀐 증분에만 온다).
import { DEFAULT_SETTINGS } from '@livejjim/core'
import type { DepositLinkView } from '../api/deposit-types.ts'
import type {
  Attention,
  BroadcastView,
  Buyer,
  CancelRequest,
  Changes,
  Claim,
  Effect,
  FullView,
  PendingSlot,
  Product,
  Settlement,
  ViewItems,
} from '../api/types.ts'

export interface ScopeData {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly broadcasts: ReadonlyMap<string, BroadcastView>
  readonly products: ReadonlyMap<string, Product>
  readonly claims: ReadonlyMap<string, Claim>
  readonly pending: ReadonlyMap<string, PendingSlot>
  readonly buyers: ReadonlyMap<string, Buyer>
  readonly settlements: ReadonlyMap<string, Settlement>
  readonly effects: ReadonlyMap<string, Effect>
  readonly cancelRequests: ReadonlyMap<string, CancelRequest>
  readonly attention: readonly Attention[]
  /** 정산 기록 seq → 입금 연결 (입금 확인이 적은 입금·되돌림 기록, AC-N3-32·47) */
  readonly depositLinks: ReadonlyMap<number, DepositLinkView>
}

type MapLists = Omit<ScopeData, 'date' | 'rehearsal' | 'seq' | 'attention' | 'depositLinks'>
type ListName = keyof MapLists

/** 정산 묶음 키 (구매자, 날짜) */
export const settlementKey = (item: { readonly buyer: string; readonly date: string }): string => JSON.stringify([item.buyer, item.date])

const KEY_OF: { readonly [K in ListName]: (item: ViewItems[K][number]) => string } = {
  broadcasts: (item) => item.id,
  products: (item) => item.key,
  claims: (item) => item.id,
  pending: (item) => item.product,
  buyers: (item) => item.id,
  settlements: (item) => settlementKey(item),
  effects: (item) => item.id,
  cancelRequests: (item) => item.claim,
}

const LIST_NAMES = Object.keys(KEY_OF) as ListName[]

function index<K extends ListName>(name: K, items: ViewItems[K]): Map<string, ViewItems[K][number]> {
  const key = KEY_OF[name] as (item: ViewItems[K][number]) => string
  const map = new Map<string, ViewItems[K][number]>()
  for (const item of items) map.set(key(item), item)
  return map
}

const NO_LINKS: ReadonlyMap<number, DepositLinkView> = new Map()

function indexLinks(links: readonly DepositLinkView[] | undefined): ReadonlyMap<number, DepositLinkView> {
  if (links === undefined || links.length === 0) return NO_LINKS
  return new Map(links.map((link) => [link.seq, link]))
}

/**
 * 봉인한 날짜의 장부(Y1 계약 5)는 조회 결과의 일부 칸만 담는다(판매·확정 상품·구매자·정산). 화면이 같은 모양으로 그리도록
 * 빠진 칸을 "없음"으로 채운다 — 값을 새로 판정하지 않는다(확정 판매만 있고 대기·보류·충돌·취소 요청은 없다).
 */
function sealedComplete(view: FullView): FullView {
  type Loose = Record<string, unknown>
  const loose = (item: unknown): Loose => (typeof item === 'object' && item !== null ? (item as Loose) : {})
  const claims = view.claims.map((raw) => {
    const claim = loose(raw)
    const at = typeof claim.confirmedAt === 'string' ? claim.confirmedAt : (view.sealedAt ?? '')
    return {
      reason: null,
      seq: 0,
      rankTime: at,
      rankMinute: false,
      received: null,
      at,
      locked: true,
      cancelRequested: false,
      reprintNeeded: false,
      priceHistory: [],
      ...claim,
    }
  }) as unknown as FullView['claims']
  const winnersOf = new Map<string, string[]>()
  for (const claim of claims) winnersOf.set(claim.product, [...(winnersOf.get(claim.product) ?? []), claim.id])
  const products = view.products.map((raw) => {
    const product = loose(raw)
    return {
      winners: [],
      winnerClaims: winnersOf.get(String(product.key)) ?? [],
      waitlist: [],
      waitlistClaims: [],
      awaitingSuccession: false,
      conflict: false,
      conflictClaim: null,
      conflictBuyer: null,
      priceHistory: [],
      nameHistory: [],
      confirmVersion: 0,
      ...product,
    }
  }) as unknown as FullView['products']
  const broadcasts = view.broadcasts.map((raw) => {
    const broadcast = loose(raw)
    // 봉인한 장부에는 설정 스냅샷이 없다 — 화면은 판정을 다시 하지 않으므로 라벨 표시만 끈 기본값으로 둔다
    return { settings: { ...DEFAULT_SETTINGS, 'print.autoOnConfirm': false }, ...broadcast }
  }) as unknown as FullView['broadcasts']
  const buyers = view.buyers.map((raw) => ({ merged: [], nameHistory: [], byBroadcast: {}, blocked: false, ...loose(raw) })) as unknown as FullView['buyers']
  return { ...view, claims, products, broadcasts, buyers }
}

export function fromFull(input: FullView): ScopeData {
  const view = input.sealed === true ? sealedComplete(input) : input
  return {
    date: view.date,
    rehearsal: view.rehearsal,
    seq: view.seq,
    broadcasts: index('broadcasts', view.broadcasts),
    products: index('products', view.products),
    claims: index('claims', view.claims),
    pending: index('pending', view.pending),
    buyers: index('buyers', view.buyers),
    settlements: index('settlements', view.settlements),
    effects: index('effects', view.effects),
    cancelRequests: index('cancelRequests', view.cancelRequests),
    attention: [...view.attention],
    depositLinks: indexLinks(view.depositLinks),
  }
}

/**
 * 증분을 덮는다. 바뀐 목록만 새 Map이 된다(나머지는 그대로 — 화면이 바뀌지 않은 부분을 다시 그리지 않는다).
 * changes.since가 data.seq와 다르면 덮지 않는다(호출하는 쪽이 since를 data.seq로 보낸다).
 */
export function applyChanges(data: ScopeData, changes: Changes): ScopeData {
  if (changes.since !== data.seq) throw new Error('증분의 기준 seq가 화면이 아는 seq와 다르다')
  const next: Record<ListName, ReadonlyMap<string, unknown>> = { ...pickLists(data) }
  for (const name of LIST_NAMES) {
    const upserts = changes[name] as readonly unknown[]
    const removed = name === 'settlements' ? changes.removed.settlements.map(settlementKey) : (changes.removed[name] as readonly string[])
    if (upserts.length === 0 && removed.length === 0) continue
    const map = new Map(data[name] as ReadonlyMap<string, unknown>)
    for (const key of removed) map.delete(key)
    const key = KEY_OF[name] as (item: unknown) => string
    for (const item of upserts) map.set(key(item), item)
    next[name] = map
  }
  const seen = new Set(data.attention.map((item) => item.seq))
  const added = changes.attention.filter((item) => !seen.has(item.seq))
  return {
    ...(next as unknown as MapLists),
    date: data.date,
    rehearsal: data.rehearsal,
    seq: changes.seq,
    attention: added.length === 0 ? data.attention : [...data.attention, ...added],
    depositLinks: changes.depositLinks === undefined ? data.depositLinks : indexLinks(changes.depositLinks),
  }
}

function pickLists(data: ScopeData): Record<ListName, ReadonlyMap<string, unknown>> {
  const out = {} as Record<ListName, ReadonlyMap<string, unknown>>
  for (const name of LIST_NAMES) out[name] = data[name] as ReadonlyMap<string, unknown>
  return out
}

/** 시험·비교용: 목록마다 키 순으로 정렬한 항목 */
export function sortedLists(data: ScopeData): Record<ListName, unknown[]> {
  const out = {} as Record<ListName, unknown[]>
  for (const name of LIST_NAMES) {
    out[name] = [...(data[name] as ReadonlyMap<string, unknown>).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, item]) => item)
  }
  return out
}
