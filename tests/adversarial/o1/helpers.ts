// O1 적대 시험 공용 도구 (test-domain). 옵션 방송 엔진을 import만으로 돌린다.
import {
  applyEvent,
  checkEvent,
  checkInvariants,
  getProduct,
  initEngine,
  listBuyers,
  listClaims,
  listEffects,
  listProducts,
  listReviews,
  listSettlements,
  type EngineEffect,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'

export const B1 = { id: 'b1', date: '2026-10-25', title: '의류 1부' } as const
export const B2 = { id: 'b2', date: '2026-10-25', title: '다육 2부' } as const
/** 2026-10-25 20:00:00 KST */
export const T0 = Date.UTC(2026, 9, 25, 11, 0, 0)
export const OPT: SettingsOverride = { 'claim.parseMode': 'OPTIONS' }

export type Ev = Record<string, unknown> & { type: string; at?: number }

export interface Played {
  readonly state: EngineState
  readonly states: readonly EngineState[]
  readonly emitted: readonly (readonly EngineEffect[])[]
  readonly allEffects: readonly EngineEffect[]
}

/** seq는 1부터, at은 적지 않으면 T0 + i초. 입력 오류 이벤트는 던진다(서버라면 기록하지 않는다) */
export function play(events: readonly Ev[], settings: SettingsOverride = OPT, broadcasts: readonly { id: string; date: string; title: string }[] = [B1]): Played {
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

/** 상태 위에서 checkEvent 문제 목록 */
export function problems(state: EngineState, event: Ev, seq: number): readonly unknown[] {
  return checkEvent(state, { at: T0 + seq * 1000, ...event, seq } as unknown as EngineEvent)
}

export const SIZE = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }]
export const shorts = (f: Record<string, unknown> = {}): Ev => ({ type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE, ...f })
export const snack = (f: Record<string, unknown> = {}): Ev => ({ type: 'product.register', b: 'b1', no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'], ...f })
let mid = 0
export const chat = (ch: string, text: string, f: Record<string, unknown> = {}): Ev => ({ type: 'chat', b: 'b1', id: `m${String(++mid)}`, ch, nick: ch, text, ...f })
export const act = (type: string, f: Record<string, unknown> = {}): Ev => ({ type, b: 'b1', reason: '사유', ...f })

export const variant = (state: EngineState, key: string) => {
  const [pk] = key.split('#') as [string]
  const [b, no] = pk.split('/') as [string, string]
  return getProduct(state, b, Number(no))?.variants.find((v) => v.key === key) ?? null
}

/** 관찰 가능한 결과 (확인 필요 포함) */
export const observe = (state: EngineState) => ({
  products: listProducts(state),
  claims: listClaims(state),
  buyers: listBuyers(state),
  settlements: listSettlements(state),
  effects: listEffects(state),
  reviews: listReviews(state),
})

export { checkInvariants, listClaims, listEffects, listReviews, listProducts, listBuyers, listSettlements, getProduct }
