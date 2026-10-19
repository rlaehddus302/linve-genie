// 범위 조회·증분 조회·메시지 조회의 재료 (AC-S04-52, AC-S05-20·61, D-085, D-086).
// - 값은 모두 코어 조회 함수의 결과다(시각 필드만 ISO). 서버는 판정을 다시 하지 않는다.
// - 증분 조회는 두 seq의 상태를 같은 조회 함수로 보고 항목마다 키로 비교한다: "그 seq의 전체 조회 + 증분 = 지금의 전체 조회"가
//   만드는 방식 그대로 성립한다(규칙마다 무엇이 바뀌는지 따로 계산하지 않는다). 값이 같은 항목은 넣지 않는다.
// - 상태 하나의 조회 결과(항목·JSON)는 그 범위 실행 상태의 작은 캐시(범위마다 최근 상태 8개)에 둔다: 지금 상태와 바로 앞 상태를 여러 화면이 같이 쓴다.
//   판매자·범위가 함께 쓰는 캐시는 없다 — 한 판매자의 조회가 다른 판매자의 캐시 항목을 밀어내지 않는다(AC-S06-72, D-096).
import {
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listMessages,
  listPending,
  listProducts,
  listSettlements,
  type ClaimInfo,
  type EngineState,
  type MessageInfo,
} from '@livejjim/core'
import type { AttentionItem, ScopeRuntime } from './runtime.ts'
import { StateCache } from './state-cache.ts'
import { withIsoTimes } from './time.ts'

/** 범위 조회의 항목 목록과 항목 키 (증분 조회는 이 키로 덮고 지운다) */
export const VIEW_LISTS = ['broadcasts', 'products', 'claims', 'pending', 'buyers', 'settlements', 'effects', 'cancelRequests'] as const
export type ViewList = (typeof VIEW_LISTS)[number]

type Item = Readonly<Record<string, unknown>>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 항목 키: 방송 id · 상품 key(`<방송>/<번호>`) · 찜 id · 보류 product · 구매자 id · 정산 [buyer, date] · 효과 id · 취소 요청 claim */
const KEY_OF: Readonly<Record<ViewList, (item: Item) => string>> = {
  broadcasts: (item) => text(item.id),
  products: (item) => text(item.key),
  claims: (item) => text(item.id),
  pending: (item) => text(item.product),
  buyers: (item) => text(item.id),
  settlements: (item) => JSON.stringify([text(item.buyer), text(item.date)]),
  effects: (item) => text(item.id),
  cancelRequests: (item) => text(item.claim),
}

interface Entry {
  readonly item: Item
  readonly json: string
}

export type ViewIndex = Readonly<Record<ViewList, ReadonlyMap<string, Entry>>>

function listsOf(state: EngineState): Record<ViewList, readonly unknown[]> {
  return {
    broadcasts: listBroadcasts(state),
    products: listProducts(state),
    claims: listClaims(state),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state),
  }
}

function buildIndex(state: EngineState): ViewIndex {
  const lists = listsOf(state)
  const index = {} as Record<ViewList, Map<string, Entry>>
  for (const name of VIEW_LISTS) {
    const map = new Map<string, Entry>()
    for (const raw of lists[name]) {
      const item = withIsoTimes(raw) as Item
      map.set(KEY_OF[name](item), { item, json: JSON.stringify(item) })
    }
    index[name] = map
  }
  return index
}

/** 범위마다 두는 보기 계산 캐시 크기 (최근 상태 수) */
export const VIEW_INDEX_CACHE_MAX = 8
export const MESSAGE_LOOKUP_CACHE_MAX = 4

/** 범위 실행 상태 하나의 보기 계산 캐시 (ScopeRuntime.views) */
export interface ViewCaches {
  /** 범위 조회·증분 조회의 항목 색인 */
  readonly index: StateCache<ViewIndex>
  /** 메시지 조회·증분 조회의 메시지 기록 */
  readonly messages: StateCache<MessageLookup>
}

export function newViewCaches(): ViewCaches {
  return { index: new StateCache<ViewIndex>(VIEW_INDEX_CACHE_MAX), messages: new StateCache<MessageLookup>(MESSAGE_LOOKUP_CACHE_MAX) }
}

/** 범위 전체 조회 (GET /api/days/:date) */
export interface FullView {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly broadcasts: readonly Item[]
  readonly products: readonly Item[]
  readonly claims: readonly Item[]
  readonly pending: readonly Item[]
  readonly buyers: readonly Item[]
  readonly settlements: readonly Item[]
  readonly effects: readonly Item[]
  readonly cancelRequests: readonly Item[]
  readonly attention: readonly AttentionItem[]
}

export function fullView(runtime: ScopeRuntime): FullView {
  const index = runtime.views.index.get(runtime.state, buildIndex)
  const items = (name: ViewList): Item[] => [...index[name].values()].map((entry) => entry.item)
  return {
    date: runtime.date,
    rehearsal: runtime.rehearsal,
    seq: runtime.seq,
    broadcasts: items('broadcasts'),
    products: items('products'),
    claims: items('claims'),
    pending: items('pending'),
    buyers: items('buyers'),
    settlements: items('settlements'),
    effects: items('effects'),
    cancelRequests: items('cancelRequests'),
    attention: [...runtime.attention],
  }
}

/** 사라진 정산 묶음의 키 */
export interface SettlementKey {
  readonly buyer: string
  readonly date: string
}

/** 증분 조회 결과 (메시지 기록 갱신은 서비스가 붙인다) */
export interface ChangeSet {
  readonly date: string
  readonly rehearsal: boolean
  readonly since: number
  readonly seq: number
  readonly broadcasts: readonly Item[]
  readonly products: readonly Item[]
  readonly claims: readonly Item[]
  readonly pending: readonly Item[]
  readonly buyers: readonly Item[]
  readonly settlements: readonly Item[]
  readonly effects: readonly Item[]
  readonly cancelRequests: readonly Item[]
  /** since 뒤에 생긴 확인 필요 항목 (확인 필요 목록은 덧붙이기만 한다) */
  readonly attention: readonly AttentionItem[]
  /** since에는 있었는데 지금은 없는 항목의 키 */
  readonly removed: {
    readonly broadcasts: readonly string[]
    readonly products: readonly string[]
    readonly claims: readonly string[]
    readonly pending: readonly string[]
    readonly buyers: readonly string[]
    readonly settlements: readonly SettlementKey[]
    readonly effects: readonly string[]
    readonly cancelRequests: readonly string[]
  }
  /** since 뒤에 기록이 바뀐 이미 받은 메시지 (방송, 메시지 ID) — 메시지 변환 */
  readonly touchedMessages: readonly { readonly b: string; readonly id: string }[]
}

/**
 * since 뒤로 바뀐 것. since가 지금보다 크거나, 기준점 창(최근 seq) 밖이면 null — "전체를 다시 받으세요".
 * since == 지금이면 빈 목록이다
 */
export function changeSet(runtime: ScopeRuntime, since: number): ChangeSet | null {
  if (!Number.isSafeInteger(since) || since < 0 || since > runtime.seq) return null
  const first = runtime.points[0]
  if (first === undefined) return null
  const point = runtime.points[since - first.seq]
  if (point === undefined || point.seq !== since) return null
  const before = runtime.views.index.get(point.state, buildIndex)
  const now = runtime.views.index.get(runtime.state, buildIndex)
  const upserts = {} as Record<ViewList, Item[]>
  const removed = {} as Record<ViewList, string[]>
  for (const name of VIEW_LISTS) {
    const changed: Item[] = []
    for (const [key, entry] of now[name]) {
      const old = before[name].get(key)
      if (old === undefined || old.json !== entry.json) changed.push(entry.item)
    }
    const gone: string[] = []
    for (const key of before[name].keys()) if (!now[name].has(key)) gone.push(key)
    upserts[name] = changed
    removed[name] = gone
  }
  const touched = new Map<string, { b: string; id: string }>()
  for (const later of runtime.points.slice(since - first.seq + 1)) {
    if (later.message !== null) touched.set(JSON.stringify([later.message.b, later.message.id]), later.message)
  }
  return {
    date: runtime.date,
    rehearsal: runtime.rehearsal,
    since,
    seq: runtime.seq,
    ...upserts,
    attention: runtime.attention.slice(point.attention),
    removed: {
      ...removed,
      settlements: removed.settlements.map((key) => {
        const [buyer, date] = JSON.parse(key) as [string, string]
        return { buyer, date }
      }),
    },
    touchedMessages: [...touched.values()],
  }
}

// ── 메시지 (AC-S05-20) ───────────────────────────────────────────────────

export interface MessageLookup {
  /** JSON.stringify([방송, 메시지 ID]) → 엔진의 메시지 기록 */
  readonly byKey: ReadonlyMap<string, MessageInfo>
  /** 메시지 seq → 그 메시지로 생긴 찜 ID (채팅 찜·메시지 변환 찜 — 찜의 순위 재료 seq가 그 메시지의 seq, R-6), 생성 순서 */
  readonly claimsBySeq: ReadonlyMap<number, readonly string[]>
}

function buildMessageLookup(state: EngineState): MessageLookup {
  const byKey = new Map<string, MessageInfo>()
  for (const message of listMessages(state)) byKey.set(JSON.stringify([message.broadcast, message.id]), message)
  const claimsBySeq = new Map<number, string[]>()
  for (const claim of listClaims(state) as ClaimInfo[]) {
    if (claim.origin !== 'chat' && claim.origin !== 'convert') continue
    const list = claimsBySeq.get(claim.seq)
    if (list === undefined) claimsBySeq.set(claim.seq, [claim.id])
    else list.push(claim.id)
  }
  return { byKey, claimsBySeq }
}

/** 그 범위 실행 상태의 캐시로 상태 하나의 메시지 기록을 본다 (state는 그 범위의 지금 상태나 조회가 잡아 둔 상태) */
export function messageLookup(runtime: Pick<ScopeRuntime, 'views'>, state: EngineState): MessageLookup {
  return runtime.views.messages.get(state, buildMessageLookup)
}
