// 같은 번호 가격 고침 문턱 (실방송 333번: 35만 원 등록 → "33만 원" → "30만 원"을 그대로 고쳤다)
import { describe, expect, it } from 'vitest'
import { PRICE_GATE_MS, gateSamePrice, hasPriceCorrection, type HeardPrice } from '../src/index.ts'

describe('gateSamePrice', () => {
  it('실방송 333번 차례: 33만 원·30만 원을 한 번씩 들어도 35만 원 그대로', () => {
    let history: readonly HeardPrice[] = []
    const t0 = 0
    let step = gateSamePrice({ current: 350_000, price: 330_000, fragment: 'a', correction: hasPriceCorrection('333번 자 요 아이는 33만 원'), history, now: t0 + 2_000 })
    expect(step.apply).toBe(false)
    history = step.history
    step = gateSamePrice({ current: 350_000, price: 300_000, fragment: 'b', correction: hasPriceCorrection('333번 자 요 아이는 30만 원'), history, now: t0 + 14_000 })
    expect(step.apply).toBe(false)
    expect(step.history.map((item) => item.price)).toEqual([330_000, 300_000])
  })
  it('같은 새 가격을 다른 조각에서 60초 안에 두 번 들으면 고친다 — 같은 조각을 다시 읽은 것은 한 번', () => {
    const first = gateSamePrice({ current: 350_000, price: 330_000, fragment: 'a', correction: false, history: [], now: 0 })
    expect(gateSamePrice({ current: 350_000, price: 330_000, fragment: 'a', correction: false, history: first.history, now: 500 }).apply).toBe(false)
    expect(gateSamePrice({ current: 350_000, price: 330_000, fragment: 'b', correction: false, history: first.history, now: PRICE_GATE_MS }).apply).toBe(true)
    expect(gateSamePrice({ current: 350_000, price: 330_000, fragment: 'b', correction: false, history: first.history, now: PRICE_GATE_MS + 1 }).apply).toBe(false)
  })
  it('정정 낱말이 있으면 한 번에 고친다', () => {
    for (const text of ['333번 아니 33만 원', '35만 말고 33만 원', '333번 다시 33만 원', '잘못 말했어요 333번 33만 원', '정정 333번 33만 원', '333번 35만원말고 33만 원']) {
      expect(hasPriceCorrection(text)).toBe(true)
      expect(gateSamePrice({ current: 350_000, price: 330_000, fragment: 'x', correction: hasPriceCorrection(text), history: [], now: 0 }).apply).toBe(true)
    }
    expect(hasPriceCorrection('333번 자 요 아이는 33만 원')).toBe(false)
  })
  it('지금 가격이 다시 들리면 후보를 지운다', () => {
    const first = gateSamePrice({ current: 350_000, price: 330_000, fragment: 'a', correction: false, history: [], now: 0 })
    const same = gateSamePrice({ current: 350_000, price: 350_000, fragment: 'b', correction: false, history: first.history, now: 1_000 })
    expect(same).toEqual({ apply: false, history: [] })
    expect(gateSamePrice({ current: 350_000, price: 330_000, fragment: 'c', correction: false, history: same.history, now: 2_000 }).apply).toBe(false)
  })
  it('깨진 입력에 던지지 않는다', () => {
    expect(gateSamePrice({ current: 1, price: Number.NaN, fragment: 'a', correction: true, history: null as unknown as HeardPrice[], now: 0 }).apply).toBe(false)
    expect(hasPriceCorrection(3 as unknown as string)).toBe(false)
  })
})
