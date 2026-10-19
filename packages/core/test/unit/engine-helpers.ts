// 엔진 단위·속성 테스트 도구 (테스트 파일 아님).
import { applyEvent, initEngine, type DeferredEvent, type EngineEffect, type EngineEvent, type EngineState, type SettingsOverride } from '@livejjim/core'

/** seq·at을 뺀 S02 이벤트 (play가 채운다). S03 이벤트는 테스트에서 따로 만든다 */
type WithoutClock<E> = E extends unknown ? Omit<E, 'seq' | 'at'> : never
export type EventInput = WithoutClock<Exclude<EngineEvent, DeferredEvent>> & { readonly at?: number }

export const B1 = { id: 'b1', date: '2026-10-18', title: '1부' } as const
export const B2 = { id: 'b2', date: '2026-10-18', title: '2부' } as const
/** 2026-10-18 20:00:00 KST */
export const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)

export interface Played {
  readonly state: EngineState
  /** 이벤트마다 새로 나온 효과 */
  readonly emitted: readonly (readonly EngineEffect[])[]
  /** 모든 단계의 상태 (0 = 시작) */
  readonly states: readonly EngineState[]
}

/** 이벤트를 차례로 적용한다. seq는 1부터, at은 적지 않으면 T0 + i초 */
export function play(events: readonly EventInput[], settings: SettingsOverride = {}, broadcasts: readonly { id: string; date: string; title: string }[] = [B1]): Played {
  let state = initEngine({ broadcasts, settings })
  const states = [state]
  const emitted: EngineEffect[][] = []
  events.forEach((event, i) => {
    const result = applyEvent(state, { at: T0 + i * 1000, ...event, seq: i + 1 } as EngineEvent)
    state = result.state
    states.push(state)
    emitted.push([...result.effects])
  })
  return { state, emitted, states }
}

export const register = (no: number, fields: Partial<{ name: string; price: number; stock: number; status: 'OPEN' | 'READY'; b: string; at: number }> = {}): EventInput => ({
  type: 'product.register',
  b: 'b1',
  no,
  name: '핑크프릴',
  price: 10000,
  ...fields,
})

let messageCounter = 0
/** 채팅 한 줄. 메시지 ID를 적지 않으면 새 ID */
export const chat = (ch: string, text: string, fields: Partial<{ id: string; nick: string; b: string; owner: boolean; at: number; publishedAt: number }> = {}): EventInput => ({
  type: 'chat',
  b: 'b1',
  id: `m${String(++messageCounter)}`,
  ch,
  nick: ch,
  text,
  ...fields,
})

export const host = (type: 'host.cancel' | 'host.reject' | 'host.promote', no: number, buyer: string, b = 'b1'): EventInput => ({ type, b, no, buyer, reason: '사유' })

// ── S03 ──────────────────────────────────────────────────────────────────

/** 2026-10-18(방송 날짜)의 KST 시각 → UTC 밀리초. 24시 넘으면 다음 날 */
export const kst = (hour: number, minute = 0, second = 0, ms = 0): number => Date.UTC(2026, 9, 18, hour - 9, minute, second, ms)

/** 문자찜 한 건 */
export const sms = (ref: string, no: number, received: string, fields: Partial<{ memo: string; phone: string; buyer: string; b: string; at: number }> = {}): EventInput => ({
  type: 'sms',
  b: 'b1',
  ref,
  no,
  received,
  ...fields,
})

export const RECEIVED_TIME = { 'contention.policy': 'RECEIVED_TIME' } as const
