// 옵션 방송 속성 시험 (INV-1·2·5·7 변형/수량 판, INV-O1·INV-O2, INV-4 결정성 — AC-O1-28·29의 코어 쪽 기본 검사).
// 무작위 로그: 변형 재고 0~3, 수량 1~3, 옵션 댓글·번호 댓글·문자찜·취소·바로잡기·지우기·지금 상품·재고 바꾸기·배정.
import fc from 'fast-check'
import {
  applyEvent,
  checkEvent,
  checkInvariants,
  initEngine,
  listBuyers,
  listClaims,
  listEffects,
  listProducts,
  listReviews,
  listSettlements,
  type EngineEvent,
  type EngineState,
  type OptionItem,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, T0 } from './engine-helpers.ts'

const SIZE: readonly OptionItem[] = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L', price: 500 }] }]
const COLOR: readonly OptionItem[] = [{ name: '색상', choices: [{ label: '흰색' }, { label: '검정색', price: -300 }] }]
const BUYERS = ['UC_A', 'UC_B', 'UC_C', 'UC_D']
const TEXTS = ['반바지 M', '반바지 엠 2개', '반바지 L 3', '반바지', '21', '21 S', '흰색', '검정색 2개', '양말 2', '양말', '11', '21 취소', '11 취소', '반바지 XL', '반바지 S 3개', '흰색 3']

type Raw =
  | { readonly kind: 'chat'; readonly buyer: number; readonly text: number }
  | { readonly kind: 'sms'; readonly no: number; readonly qty: number; readonly pick: number }
  | { readonly kind: 'cancel'; readonly buyer: number; readonly no: number; readonly pick: number }
  | { readonly kind: 'stock'; readonly no: number; readonly pick: number; readonly stock: number }
  | { readonly kind: 'focus'; readonly no: number }
  | { readonly kind: 'resolve'; readonly review: number; readonly qty: number; readonly pick: number }
  | { readonly kind: 'dismiss'; readonly review: number }
  | { readonly kind: 'assign'; readonly buyer: number; readonly no: number; readonly qty: number; readonly pick: number }
  | { readonly kind: 'hold'; readonly no: number }
  | { readonly kind: 'open'; readonly no: number }

const NOS = [21, 31, 11]
const optionsOf = (no: number): readonly OptionItem[] => (no === 21 ? SIZE : no === 31 ? COLOR : [])
const pickOf = (no: number, pick: number): Record<string, string> | undefined => {
  const options = optionsOf(no)
  if (options.length === 0) return undefined
  const item = options[0] as OptionItem
  return { [item.name]: (item.choices[pick % item.choices.length] as { readonly label: string }).label }
}

const rawArb: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('chat' as const), buyer: fc.nat(3), text: fc.nat(TEXTS.length - 1) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('sms' as const), no: fc.nat(2), qty: fc.integer({ min: 1, max: 3 }), pick: fc.nat(5) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('cancel' as const), buyer: fc.nat(3), no: fc.nat(2), pick: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('stock' as const), no: fc.nat(2), pick: fc.nat(5), stock: fc.integer({ min: 0, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('focus' as const), no: fc.nat(3) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('resolve' as const), review: fc.nat(5), qty: fc.integer({ min: 1, max: 3 }), pick: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('dismiss' as const), review: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('assign' as const), buyer: fc.nat(3), no: fc.nat(2), qty: fc.integer({ min: 1, max: 3 }), pick: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('hold' as const), no: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('open' as const), no: fc.nat(2) }) },
)

const scenarioArb = fc.record({
  stocks: fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })),
  waitlist: fc.integer({ min: 0, max: 2 }),
  succession: fc.constantFrom('AUTO' as const, 'ASK' as const, 'REOPEN' as const),
  buyerChat: fc.constantFrom('OFF' as const, 'REQUEST' as const, 'AUTO' as const),
  raws: fc.array(rawArb, { minLength: 10, maxLength: 50 }),
})

type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never

/** 무작위 원료 → 이벤트 (입력 오류가 되는 이벤트는 서버처럼 기록하지 않는다 — checkEvent로 거른다) */
function eventsOf(scenario: Scenario): EngineEvent[] {
  const [s, m, l] = scenario.stocks
  const base: Record<string, unknown>[] = [
    { type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE, stocks: { S: s, M: m, L: l } },
    { type: 'product.register', b: 'b1', no: 31, name: '수건', price: 8000, stock: 2, options: COLOR },
    { type: 'product.register', b: 'b1', no: 11, name: '양말', price: 2000, stock: Math.max(1, s + m) },
  ]
  const raws = scenario.raws.map((raw, i): Record<string, unknown> => {
    switch (raw.kind) {
      case 'chat':
        return { type: 'chat', b: 'b1', id: `m${String(i)}`, ch: BUYERS[raw.buyer] as string, nick: 'n', text: TEXTS[raw.text] as string }
      case 'sms': {
        const no = NOS[raw.no] as number
        const options = pickOf(no, raw.pick)
        return { type: 'sms', b: 'b1', ref: `s${String(i)}`, no, received: '20:00', qty: raw.qty, ...(options === undefined ? {} : { options }) }
      }
      case 'cancel': {
        const no = NOS[raw.no] as number
        const options = raw.pick % 2 === 0 ? undefined : pickOf(no, raw.pick)
        return { type: 'host.cancel', b: 'b1', no, buyer: BUYERS[raw.buyer] as string, reason: 'r', ...(options === undefined ? {} : { options }) }
      }
      case 'stock': {
        const no = NOS[raw.no] as number
        const options = pickOf(no, raw.pick)
        return options === undefined
          ? { type: 'product.update', b: 'b1', no, stock: Math.max(1, raw.stock) }
          : { type: 'product.update', b: 'b1', no, stocks: { [Object.values(options)[0] as string]: raw.stock } }
      }
      case 'focus':
        return { type: 'product.focus', b: 'b1', no: [21, 31, 11, 99][raw.no] as number }
      case 'resolve':
      case 'dismiss': {
        // 앞선 채팅 메시지 중 하나를 고른다 (확인 필요 항목이 된 메시지일 수 있다)
        const chats = scenario.raws.slice(0, i).flatMap((other, j) => (other.kind === 'chat' ? [j] : []))
        const item = `m${String(chats.length === 0 ? i : (chats[chats.length - 1 - (raw.review % chats.length)] as number))}`
        if (raw.kind === 'dismiss') return { type: 'host.dismissReview', b: 'b1', item }
        const no = NOS[raw.pick % 3] as number
        const options = pickOf(no, raw.pick)
        return { type: 'host.resolveReview', b: 'b1', item, no, qty: raw.qty, ...(options === undefined ? {} : { options }) }
      }
      case 'assign': {
        const no = NOS[raw.no] as number
        const options = pickOf(no, raw.pick)
        return { type: 'host.assign', b: 'b1', no, buyer: BUYERS[raw.buyer] as string, reason: 'r', qty: raw.qty, ...(options === undefined ? {} : { options }) }
      }
      case 'hold':
        return { type: 'product.hold', b: 'b1', no: NOS[raw.no] as number }
      case 'open':
        return { type: 'product.open', b: 'b1', no: NOS[raw.no] as number }
    }
  })
  return [...base, ...raws].map((event, i) => ({ seq: i + 1, at: T0 + i * 4000, ...event }) as unknown as EngineEvent)
}

function settingsOf(scenario: Scenario) {
  return { 'claim.parseMode': 'OPTIONS' as const, 'waitlist.max': scenario.waitlist, 'cancel.succession': scenario.succession, 'cancel.buyerChat': scenario.buyerChat }
}

function replay(scenario: Scenario): { readonly states: EngineState[]; readonly effects: unknown[] } {
  let state = initEngine({ broadcasts: [B1], settings: settingsOf(scenario) })
  const states = [state]
  const effects: unknown[] = []
  for (const event of eventsOf(scenario)) {
    if (checkEvent(state, event).length > 0) continue
    const result = applyEvent(state, event)
    state = result.state
    states.push(state)
    effects.push(result.effects)
  }
  return { states, effects }
}

const isMoney = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0

describe('옵션 방송 불변식 속성 (O1)', () => {
  it('모든 이벤트 뒤 한 상태 불변식(변형·수량 판, INV-O1·O2), 금액은 0 이상 정수, 합계 = Σ 단가 × 수량, 같은 로그 → 같은 결과', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const first = replay(scenario)
        for (const state of first.states) {
          expect(checkInvariants(state)).toEqual([])
          for (const product of listProducts(state)) {
            for (const variant of product.variants) {
              expect(variant.confirmedUnits).toBeLessThanOrEqual(variant.stock)
              for (const id of variant.waitlistClaims) expect(listClaims(state).find((c) => c.id === id)?.qty).toBe(1)
            }
          }
          for (const buyer of listBuyers(state)) {
            expect(isMoney(buyer.subtotal)).toBe(true)
            const own = listClaims(state).filter((c) => c.status === 'CONFIRMED' && c.currentBuyer === buyer.current)
            if (buyer.current === buyer.id) expect(buyer.subtotal).toBe(own.reduce((sum, c) => sum + (c.amount as number), 0))
          }
          for (const s of listSettlements(state)) for (const amount of [s.subtotal, s.shipping, s.total, s.received, s.refundDue]) expect(isMoney(amount)).toBe(true)
        }
        // INV-O2: 확인 필요 항목을 모두 지운 상태와 지우기 전의 재고·합계·효과가 같다
        const last = first.states.at(-1) as EngineState
        const cleared = { ...last, reviews: initEngine({ broadcasts: [], settings: {} }).reviews }
        expect(listProducts(cleared)).toEqual(listProducts(last))
        expect(listBuyers(cleared)).toEqual(listBuyers(last))
        expect(listEffects(cleared)).toEqual(listEffects(last))
        expect(listReviews(cleared)).toEqual([])
        // INV-4: 처음부터 다시 돌리면 같다
        const second = replay(scenario)
        expect(JSON.stringify(second.states.at(-1))).toBe(JSON.stringify(last))
        expect(JSON.stringify(second.effects)).toBe(JSON.stringify(first.effects))
      }),
      { numRuns: 150, seed: 20261021 },
    )
  })
})
