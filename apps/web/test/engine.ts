// 화면 단위 시험 도우미: 실제 코어로 이벤트를 적용해 서버와 같은 모양의 범위 조회(시각은 ISO)를 만든다.
// 화면이 미리 보이는 값(합치기 미리 보기·정산 미리 보기)을 실제 엔진 결과와 맞대어 보려고 쓴다.
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
  type SettingsOverride,
} from '@livejjim/core'
import type { FullView } from '../src/api/types.ts'
import { fromFull, type ScopeData } from '../src/lib/scope-data.ts'
import { DATE } from './support.ts'

const TIME_KEYS = new Set(['at', 'endedAt', 'rankTime'])

export function iso(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(iso)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, TIME_KEYS.has(key) && typeof item === 'number' ? new Date(item).toISOString() : iso(item)]))
}

export const T0 = Date.parse('2026-10-19T01:00:00.000Z')

export interface Run {
  readonly state: EngineState
  readonly seq: number
  /** 마지막 이벤트가 조회 결과를 바꿨는가 */
  readonly changed: boolean
}

/** 방송 b1(1부)·b2(2부)가 있는 날에 이벤트를 차례로 적용한다 */
export function run(events: readonly Record<string, unknown>[], settings: SettingsOverride = {}): Run {
  let state = initEngine({
    broadcasts: [
      { id: 'b1', date: DATE, title: '1부' },
      { id: 'b2', date: DATE, title: '2부' },
    ],
    settings: { ...settings },
  })
  let changed = false
  events.forEach((event, index) => {
    const before = JSON.stringify(viewOf(state, 0))
    state = applyEvent(state, { ...event, seq: index + 1, at: T0 + index * 1000 } as never).state
    changed = JSON.stringify(viewOf(state, 0)) !== before
  })
  return { state, seq: events.length, changed }
}

export function viewOf(state: EngineState, seq: number): FullView {
  return {
    date: DATE,
    rehearsal: false,
    seq,
    attention: [],
    ...(iso({
      broadcasts: listBroadcasts(state),
      products: listProducts(state),
      claims: listClaims(state),
      pending: listPending(state),
      buyers: listBuyers(state),
      settlements: listSettlements(state),
      effects: listEffects(state),
      cancelRequests: listCancelRequests(state),
    }) as Omit<FullView, 'date' | 'rehearsal' | 'seq' | 'attention'>),
  }
}

export function dataOf(events: readonly Record<string, unknown>[], settings: SettingsOverride = {}): ScopeData {
  const { state, seq } = run(events, settings)
  return fromFull(viewOf(state, seq))
}

/** 이벤트 만들기 */
export const chat = (id: string, ch: string, nick: string, text: string, b = 'b1') => ({ type: 'chat', b, id, ch, nick, text })
export const register = (no: number, name: string, price: number, b = 'b1') => ({ type: 'product.register', b, no, name, price })
export const sms = (ref: string, no: number, patch: Record<string, unknown> = {}, b = 'b1') => ({ type: 'sms', b, ref, no, received: '10:00:00', ...patch })
