// 범위 자료: 전체 조회 + 증분 덮기 (AC-S05-61·62, D-085). 실제 코어로 만든 두 상태의 조회 결과에서
// 서버와 같은 방식(키로 비교, 값이 같은 항목은 빼고, 사라진 키)으로 증분을 만들어 덮으면 나중 상태의 전체와 같아야 한다.
import {
  applyEvent,
  initEngine,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  type EngineState,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import type { Changes, FullView } from '../src/api/types.ts'
import { applyChanges, fromFull, settlementKey, sortedLists } from '../src/lib/scope-data.ts'
import { DATE } from './support.ts'

const TIME_KEYS = new Set(['at', 'endedAt', 'rankTime'])
function iso(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(iso)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, TIME_KEYS.has(key) && typeof item === 'number' ? new Date(item).toISOString() : iso(item)]))
}

type Lists = Record<string, Record<string, unknown>[]>
const KEY: Record<string, (item: Record<string, unknown>) => string> = {
  broadcasts: (item) => String(item.id),
  products: (item) => String(item.key),
  claims: (item) => String(item.id),
  pending: (item) => String(item.product),
  buyers: (item) => String(item.id),
  settlements: (item) => settlementKey(item as { buyer: string; date: string }),
  effects: (item) => String(item.id),
  cancelRequests: (item) => String(item.claim),
}

function lists(state: EngineState): Lists {
  return iso({
    broadcasts: listBroadcasts(state),
    products: listProducts(state),
    claims: listClaims(state),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state),
  }) as Lists
}

function full(state: EngineState, seq: number): FullView {
  return { date: DATE, rehearsal: false, seq, attention: [], ...(lists(state) as unknown as Omit<FullView, 'date' | 'rehearsal' | 'seq' | 'attention'>) }
}

/** 서버 증분 조회와 같은 방식 (apps/server views.changeSet) */
function diff(before: EngineState, after: EngineState, since: number, seq: number): Changes {
  const a = lists(before)
  const b = lists(after)
  const out: Record<string, unknown> = { date: DATE, rehearsal: false, since, seq, attention: [], messages: [], messagesMore: false }
  const removed: Record<string, unknown[]> = {}
  for (const name of Object.keys(KEY)) {
    const key = KEY[name] as (item: Record<string, unknown>) => string
    const old = new Map((a[name] ?? []).map((item) => [key(item), JSON.stringify(item)]))
    const now = new Map((b[name] ?? []).map((item) => [key(item), item]))
    out[name] = [...now.entries()].filter(([k, item]) => old.get(k) !== JSON.stringify(item)).map(([, item]) => item)
    removed[name] =
      name === 'settlements'
        ? (a[name] ?? []).filter((item) => !now.has(key(item))).map((item) => ({ buyer: item.buyer, date: item.date }))
        : [...old.keys()].filter((k) => !now.has(k))
  }
  out.removed = removed
  return out as unknown as Changes
}

const T0 = Date.parse('2026-10-19T01:00:00.000Z')

function run(events: Record<string, unknown>[]): EngineState[] {
  let state = initEngine({ broadcasts: [{ id: 'b1', date: DATE, title: '1부' }], settings: {} })
  const states = [state]
  events.forEach((event, index) => {
    state = applyEvent(state, { ...event, seq: index + 1, at: T0 + index * 1000 } as never).state
    states.push(state)
  })
  return states
}

const chat = (id: string, ch: string, nick: string, text: string) => ({ type: 'chat', b: 'b1', id, ch, nick, text })

const EVENTS: Record<string, unknown>[] = [
  chat('m1', 'c1', '가', '15'), // 상품이 없는 번호 → 보류
  { type: 'product.register', b: 'b1', no: 15, name: '핑크', price: 10000 }, // 보류 → 1등
  chat('m2', 'c2', '나', '15번'), // 대기
  chat('m3', 'c3', '다', '16'), // 보류
  chat('m4', 'c1', '가', '15 취소'), // 취소 요청
  { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'c1' }, // 승계: 나 1등
  { type: 'product.update', b: 'b1', no: 15, name: '핑크프릴' },
  { type: 'host.blockBuyer', buyer: 'c3', reason: '장난 찜' }, // 16 보류 풀림(차단)
  { type: 'product.register', b: 'b1', no: 20, name: '', price: 5000 },
  { type: 'product.renumber', b: 'b1', from: 20, to: 21 }, // 20 사라짐
  { type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 1000 },
  { type: 'buyer.merge', from: 'c2', into: 'c1', reason: '같은 사람' }, // 정산 묶음 키 바뀜
]

describe('전체 조회 + 증분 = 지금의 전체', () => {
  const states = run(EVENTS)

  it('모든 (a, b) 쌍에서 덮으면 같다', () => {
    for (let a = 0; a < states.length; a++) {
      for (let b = a; b < states.length; b++) {
        const merged = applyChanges(fromFull(full(states[a] as EngineState, a)), diff(states[a] as EngineState, states[b] as EngineState, a, b))
        expect(merged.seq).toBe(b)
        expect(sortedLists(merged), `${String(a)} → ${String(b)}`).toEqual(sortedLists(fromFull(full(states[b] as EngineState, b))))
      }
    }
  })

  it('사라진 항목(보류가 풀린 번호, 번호 변경 전 번호, 합친 구매자의 정산 묶음)을 지운다', () => {
    const before = fromFull(full(states[7] as EngineState, 7))
    expect(before.pending.has('b1/16')).toBe(true)
    const after = applyChanges(before, diff(states[7] as EngineState, states[12] as EngineState, 7, 12))
    expect(after.pending.has('b1/16')).toBe(false)
    expect(after.products.has('b1/20')).toBe(false)
    expect(after.products.has('b1/21')).toBe(true)
  })

  it('바뀌지 않은 목록은 그대로 둔다(같은 Map) — 화면이 다시 그리지 않게', () => {
    const data = fromFull(full(states[6] as EngineState, 6))
    const next = applyChanges(data, diff(states[6] as EngineState, states[7] as EngineState, 6, 7))
    expect(next.products).not.toBe(data.products)
    expect(next.broadcasts).toBe(data.broadcasts)
    expect(next.cancelRequests).toBe(data.cancelRequests)
  })

  it('확인 필요는 덧붙이기만 하고 같은 seq는 두 번 넣지 않는다', () => {
    const data = fromFull({ ...full(states[0] as EngineState, 0), attention: [{ seq: 1, message: '처리하지 못한 입력이에요. 확인이 필요해요.' }] })
    const changes = { ...diff(states[0] as EngineState, states[1] as EngineState, 0, 1), attention: [{ seq: 1, message: 'x' }, { seq: 2, message: 'y' }] }
    expect(applyChanges(data, changes).attention.map((item) => item.seq)).toEqual([1, 2])
  })

  it('기준 seq가 다르면 덮지 않는다', () => {
    const data = fromFull(full(states[3] as EngineState, 3))
    expect(() => applyChanges(data, diff(states[2] as EngineState, states[4] as EngineState, 2, 4))).toThrow()
  })
})
