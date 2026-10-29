// 범위 조회 결과를 화면이 들고 있는 모양 (웹 lib/scope-data.ts와 같은 규칙 — AC-S05-61·62, D-085).
// 전체 조회로 시작해 증분 조회를 덮는다: 목록마다 키로 덮고, removed의 키는 지우고, 확인 필요는 덧붙인다. 화면은 판정을 다시 하지 않는다.
// 웹 것을 그대로 가져오지 않는 까닭: 웹 모듈은 @livejjim/core 전체를 불러온다(봉인 장부 기본값) — 앱 번들에는 판정 코드를 담지 않는다(APP-01 AC3).
// 봉인한 날짜(sealed)는 받은 칸만 들고 `sealed: true`로 표시한다(콘솔은 봉인한 날짜를 고치지 않는다).
import type { Attention, BroadcastView, Buyer, CancelRequest, Changes, Claim, Effect, FullView, PendingSlot, Product, Settlement, ViewItems } from '@livejjim/web/src/api/types.ts'

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
  readonly sealed: boolean
}

type MapLists = Omit<ScopeData, 'date' | 'rehearsal' | 'seq' | 'attention' | 'sealed'>
type ListName = keyof MapLists

/** 정산 묶음 키 (구매자, 날짜) — 웹과 같다 */
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

function index<K extends ListName>(name: K, items: ViewItems[K] | undefined): Map<string, ViewItems[K][number]> {
  const key = KEY_OF[name] as (item: ViewItems[K][number]) => string
  const map = new Map<string, ViewItems[K][number]>()
  for (const item of items ?? []) map.set(key(item), item)
  return map
}

export function fromFull(view: FullView): ScopeData {
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
    attention: [...(view.attention ?? [])],
    sealed: view.sealed === true,
  }
}

/** 증분을 덮는다. 바뀐 목록만 새 Map이 된다. changes.since가 data.seq와 다르면 던진다(부르는 쪽이 since를 data.seq로 보낸다) */
export function applyChanges(data: ScopeData, changes: Changes): ScopeData {
  if (changes.since !== data.seq) throw new Error('증분의 기준 seq가 화면이 아는 seq와 다르다')
  const next: Record<ListName, ReadonlyMap<string, unknown>> = {} as Record<ListName, ReadonlyMap<string, unknown>>
  for (const name of LIST_NAMES) next[name] = data[name] as ReadonlyMap<string, unknown>
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
    sealed: data.sealed,
  }
}
