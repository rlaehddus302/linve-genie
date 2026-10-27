// AC-V3-92 (R-22 4 (가), D-V3-101·106 — 실방송 경성 1번): 오래전 상품은 품종이 함께 바뀌면 정정 낱말로 바로 고치지 않는다
import { describe, expect, it } from 'vitest'
import { PRICE_GATE_MS, decideSameNumber, gateSamePrice, hasPriceCorrection } from '../src/index.ts'

const TEXT = '1번 퍼플이 아니에요 퍼플 2만 원까지'

describe('AC-V3-92 오래전 상품 · 정정 낱말 · 품종 함께', () => {
  it('(1) recent 거짓 + 품종 함께: 정정 낱말이 있어도 한 번 들림은 고치지 않는다 — decideSameNumber는 AUTO_FIX/NOT_RECENT 그대로', () => {
    const decision = decideSameNumber({ heard: { price: 20_000, priceSure: true, name: '퍼플', nameFrom: 'DICTIONARY' }, product: { name: '청사과', price: 330_000, status: 'OPEN', liveClaims: 0 }, auto: true, recent: false })
    expect(decision).toEqual({ action: 'AUTO_FIX', changes: { price: 20_000, name: '퍼플' }, reason: 'NOT_RECENT' })
    expect(hasPriceCorrection(TEXT)).toBe(true)
    const step = gateSamePrice({ current: 330_000, price: 20_000, fragment: 'a', correction: true, history: [], now: 0, recent: false, nameChange: true })
    expect(step.apply).toBe(false)
    expect(step.history.map((item) => item.price)).toEqual([20_000])
  })
  it('(2) 그 뒤 60초 안 다른 조각에서 같은 새 가격을 또 들으면 고친다', () => {
    const first = gateSamePrice({ current: 330_000, price: 20_000, fragment: 'a', correction: true, history: [], now: 0, recent: false, nameChange: true })
    expect(gateSamePrice({ current: 330_000, price: 20_000, fragment: 'b', correction: false, history: first.history, now: PRICE_GATE_MS, recent: false, nameChange: true }).apply).toBe(true)
  })
  it('(3) recent 거짓이어도 가격만이면 정정 낱말로 바로', () => {
    expect(gateSamePrice({ current: 330_000, price: 20_000, fragment: 'a', correction: true, history: [], now: 0, recent: false, nameChange: false }).apply).toBe(true)
    expect(gateSamePrice({ current: 330_000, price: 20_000, fragment: 'a', correction: true, history: [], now: 0, recent: false }).apply).toBe(true)
  })
  it('(4) 고쳐 말함(recent 참)이면 품종이 함께여도 정정 낱말로 바로', () => {
    expect(gateSamePrice({ current: 330_000, price: 20_000, fragment: 'a', correction: true, history: [], now: 0, recent: true, nameChange: true }).apply).toBe(true)
    expect(gateSamePrice({ current: 330_000, price: 20_000, fragment: 'a', correction: true, history: [], now: 0, nameChange: true }).apply).toBe(true)
  })
})
