// S02 적대 테스트 (test-domain): 무작위 로그로 개발자 속성 테스트가 보지 않는 관계를 본다 (AC-S02-02·53·70·72).
// - 실행 대상(PENDING) 효과는 언제나 지금 확정(확정버전)인 찜의 것이다(VOID_LABEL 제외) — 풀린 확정의 효과가 실행 대상으로 남지 않는다.
// - 확정 찜마다 지금 확정버전의 효과가 설정대로 모두 있고 취소된 것이 없다.
// - "승계 결정 필요" 표시는 ASK에서, 대기가 있고 빈 자리가 있을 때만 남는다.
// - 깊게 얼린 상태로 적용해도 같고, JSON 왕복한 상태로 적용해도 결과(상태·효과)가 같다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { initEngine, listClaims, listEffects, listProducts, type EngineState, type SettingsOverride } from '@livejjim/core'
import { apply, B1, T0, type Ev } from './helpers.ts'

const BUY = ['A', 'B', 'C', 'D'] as const
const NO = [1, 2] as const

const eventArb: fc.Arbitrary<Ev & { pick?: number }> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ type: fc.constant('product.register'), no: fc.constantFrom(...NO), stock: fc.integer({ min: 1, max: 3 }), status: fc.constantFrom('OPEN', 'READY') }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constantFrom('product.open', 'product.hold', 'product.close'), no: fc.constantFrom(...NO) }) },
  { weight: 8, arbitrary: fc.record({ type: fc.constant('chat'), ch: fc.constantFrom(...BUY), text: fc.constantFrom('1', '2', '1 취소', '2 취소', '1 2', '안녕') }) },
  {
    weight: 5,
    arbitrary: fc.record({
      type: fc.constantFrom('host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel', 'host.reopen'),
      no: fc.constantFrom(...NO),
      buyer: fc.constantFrom(...BUY),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant('host.assign'),
      no: fc.constantFrom(...NO),
      buyer: fc.constantFrom(...BUY),
      replace: fc.option(fc.constantFrom(...BUY), { nil: undefined }),
      replaceTo: fc.constantFrom('WAITLIST', 'CANCEL'),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constantFrom('host.blockBuyer', 'host.unblockBuyer'), buyer: fc.constantFrom(...BUY) }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constantFrom('effect.labelPrinted', 'effect.thanksSent'), pick: fc.nat() }) },
)

const settingsArb: fc.Arbitrary<SettingsOverride> = fc.record({
  'waitlist.max': fc.integer({ min: 0, max: 2 }),
  'cancel.succession': fc.constantFrom('AUTO', 'ASK', 'REOPEN'),
  'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
  'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE'),
})

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
}

function problems(state: EngineState, settings: SettingsOverride): string[] {
  const out: string[] = []
  const claims = new Map(listClaims(state).map((c) => [c.id, c]))
  const effects = listEffects(state)
  const perConfirm = 2 + (settings['thanks.videoComment'] === 'PER_SALE' ? 1 : 0)
  for (const e of effects) {
    if (e.kind === 'VOID_LABEL' || e.status !== 'PENDING') continue
    const c = claims.get(e.claim)
    if (c?.status !== 'CONFIRMED' || c.confirmVersion !== e.confirmVersion) out.push(`풀린 확정의 효과가 실행 대상: ${e.id} (찜 ${String(c?.status)} v${String(c?.confirmVersion)})`)
  }
  for (const c of claims.values()) {
    if (c.status !== 'CONFIRMED') continue
    const mine = effects.filter((e) => e.claim === c.id && e.confirmVersion === c.confirmVersion && e.kind !== 'VOID_LABEL')
    if (mine.length !== perConfirm || mine.some((e) => e.status === 'CANCELLED')) out.push(`확정 ${c.id} v${String(c.confirmVersion)}의 효과: ${JSON.stringify(mine.map((e) => [e.id, e.status]))}`)
  }
  for (const p of listProducts(state)) {
    if (p.awaitingSuccession && (p.waitlist.length === 0 || p.winners.length >= p.stock || settings['cancel.succession'] !== 'ASK')) out.push(`남은 승계 표시: ${p.key}`)
  }
  return out
}

describe('S02 무작위 로그', () => {
  it('효과 실행 대상·승계 표시·얼린 입력·JSON 왕복', () => {
    fc.assert(
      fc.property(settingsArb, fc.array(eventArb, { minLength: 10, maxLength: 50 }), (settings, raws) => {
        let state = initEngine({ broadcasts: [B1], settings })
        let m = 0
        raws.forEach((raw, i) => {
          let e: Ev = { ...raw, b: 'b1', reason: '사유' }
          delete e.pick
          if (raw.type === 'product.register') e = { ...e, name: '핑크프릴', price: 1000 }
          if (raw.type === 'chat') e = { ...e, id: `m${String(++m)}`, nick: String(raw.ch) }
          if (raw.type === 'host.assign' && raw.replace === undefined) delete e.replaceTo
          if (raw.type.startsWith('effect.')) {
            const kind = raw.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
            const pool = listEffects(state).filter((x) => x.kind === kind)
            if (pool.length === 0) return
            e = { type: raw.type, effectId: pool[(raw.pick ?? 0) % pool.length]?.id }
          }
          const copy = JSON.parse(JSON.stringify(state)) as EngineState
          deepFreeze(state)
          const result = apply(state, e, i + 1, T0 + i * 1000)
          expect(JSON.stringify(apply(copy, e, i + 1, T0 + i * 1000))).toBe(JSON.stringify(result))
          state = result.state
          expect(problems(state, settings)).toEqual([])
        })
      }),
      { numRuns: 300 },
    )
  })
})
