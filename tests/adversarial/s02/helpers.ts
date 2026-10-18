// S02 적대 테스트 공용 도구 (test-domain). 엔진을 import만으로 돌린다(외부 계정·기기 없음).
// packages/core/test/unit/engine-helpers.ts를 참고해 따로 만들었다(제품 테스트 도구에 기대지 않는다).
import {
  applyEvent,
  checkInvariants,
  getBuyer,
  getProduct,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  type EngineEffect,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'

export const B1 = { id: 'b1', date: '2026-10-18', title: '1부' } as const
export const B2 = { id: 'b2', date: '2026-10-18', title: '2부' } as const
/** 2026-10-18 20:00:00 KST */
export const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)

export type Ev = Record<string, unknown> & { type: string; at?: number }

export interface Played {
  readonly state: EngineState
  readonly states: readonly EngineState[]
  readonly emitted: readonly (readonly EngineEffect[])[]
  readonly allEffects: readonly EngineEffect[]
}

/** seq는 1부터, at은 적지 않으면 T0 + i초 */
export function play(events: readonly Ev[], settings: SettingsOverride = {}, broadcasts: readonly { id: string; date: string; title: string }[] = [B1]): Played {
  let state = initEngine({ broadcasts, settings })
  const states = [state]
  const emitted: EngineEffect[][] = []
  events.forEach((event, i) => {
    const result = applyEvent(state, { at: T0 + i * 1000, ...event, seq: i + 1 } as unknown as EngineEvent)
    state = result.state
    states.push(state)
    emitted.push([...result.effects])
  })
  return { state, states, emitted, allEffects: emitted.flat() }
}

/** 이어서 적용 */
export function apply(state: EngineState, event: Ev, seq: number, at = T0 + seq * 1000): { state: EngineState; effects: readonly EngineEffect[] } {
  return applyEvent(state, { at, ...event, seq } as unknown as EngineEvent)
}

export const reg = (no: number, f: Record<string, unknown> = {}): Ev => ({ type: 'product.register', b: 'b1', no, name: '핑크프릴', price: 10000, ...f })
let mid = 0
export const chat = (ch: string, text: string, f: Record<string, unknown> = {}): Ev => ({ type: 'chat', b: 'b1', id: `m${String(++mid)}`, ch, nick: ch, text, ...f })
export const host = (type: string, no: number, buyer: string, f: Record<string, unknown> = {}): Ev => ({ type, b: 'b1', no, buyer, reason: '사유', ...f })
export const block = (buyer: string): Ev => ({ type: 'host.blockBuyer', buyer, reason: '사유' })
export const unblock = (buyer: string): Ev => ({ type: 'host.unblockBuyer', buyer, reason: '사유' })
export const labelPrinted = (effectId: string): Ev => ({ type: 'effect.labelPrinted', effectId })
export const thanksSent = (effectId: string): Ev => ({ type: 'effect.thanksSent', effectId })

/** 조회 함수로 보는 모든 값 */
export function observe(state: EngineState): unknown {
  return {
    products: listProducts(state),
    claims: listClaims(state),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    requests: listCancelRequests(state),
  }
}

export const product = (state: EngineState, no: number, b = 'b1') => getProduct(state, b, no)
export const buyer = (state: EngineState, id: string) => getBuyer(state, id)
export const claimsOf = (state: EngineState, who: string) => listClaims(state).filter((c) => c.buyer === who)
export { checkInvariants, listClaims, listEffects, listCancelRequests, listSettlements, listPending }
