// AC-V3-72 기다리는 번호 (R-17 8 6, D-V3-67) — 순수 함수 단위 시험. 사례 R51·R74·R75·R79·R80.
import { describe, expect, it } from 'vitest'
import { stepWaiting, waitingExpired, type WaitingNumber, type WaitingPiece } from '../src/index.ts'

const numberOnly = (no: number): WaitingPiece => ({ markerNo: no, wonPrice: null, paired: false })
const priceOnly = (price: number): WaitingPiece => ({ markerNo: null, wonPrice: price, paired: false })
const pair = (no: number, price: number): WaitingPiece => ({ markerNo: no, wonPrice: price, paired: true })
const none = new Set<number>()
const step = (waiting: WaitingNumber | null, now: number, piece: WaitingPiece, exists: Set<number> = none) => stepWaiting({ waiting, now, piece, exists: (no) => exists.has(no) })

describe('AC-V3-72 기다리는 번호', () => {
  it('R51 "15번" 뒤 4초에 "엘레강스 이만원" → 15번 20,000원 이어 받음', () => {
    const first = step(null, 0, numberOnly(15))
    expect(first).toEqual({ take: null, card: null, waiting: { no: 15, since: 0 } })
    expect(step(first.waiting, 4000, priceOnly(20000))).toEqual({ take: { no: 15, price: 20000 }, card: null, waiting: null })
  })
  it('60초 경계: 60,000ms면 받고 60,001ms면 카드', () => {
    const waiting = { no: 15, since: 1000 }
    expect(step(waiting, 61000, priceOnly(20000)).take).toEqual({ no: 15, price: 20000 })
    expect(step(waiting, 61001, priceOnly(20000))).toEqual({ take: null, card: 15, waiting: null })
    expect(waitingExpired(waiting, 61000)).toBe(false)
    expect(waitingExpired(waiting, 61001)).toBe(true)
  })
  it('R74 "15번" 뒤 "16번 2만 원" → 15번은 카드, 16번은 조각대로 등록(기다리지 않음)', () => {
    expect(step({ no: 15, since: 0 }, 4000, pair(16, 20000))).toEqual({ take: null, card: 15, waiting: null })
  })
  it('R75 61초 뒤 "이만 원" → 15번 카드, 이어 받지 않음', () => {
    expect(step({ no: 15, since: 0 }, 61000, priceOnly(20000))).toEqual({ take: null, card: 15, waiting: null })
  })
  it('R79 이미 상품이 있는 번호·번 없는 번호는 기다리지 않는다', () => {
    expect(step(null, 0, numberOnly(15), new Set([15]))).toEqual({ take: null, card: null, waiting: null })
    expect(step(null, 0, { markerNo: null, wonPrice: null, paired: false })).toEqual({ take: null, card: null, waiting: null })
  })
  it('원 가격만 이어 받는다 (원 없는 가격·빠른 꼴은 wonPrice null)', () => {
    expect(step({ no: 15, since: 0 }, 1000, { markerNo: null, wonPrice: null, paired: false })).toEqual({ take: null, card: null, waiting: { no: 15, since: 0 } })
  })
  it('R80 "15번"→"16번"→"17번"→"18번" → 15·16·17번 카드, 18번 기다림', () => {
    let waiting: WaitingNumber | null = null
    const cards: number[] = []
    ;[15, 16, 17, 18].forEach((no, i) => {
      const r = step(waiting, i * 2000, numberOnly(no))
      if (r.card !== null) cards.push(r.card)
      waiting = r.waiting
    })
    expect(cards).toEqual([15, 16, 17])
    expect(waiting).toEqual({ no: 18, since: 6000 })
  })
  it('같은 번호를 원 가격과 다시 말하면(짝) 기다림이 끝난다', () => {
    expect(step({ no: 15, since: 0 }, 1000, pair(15, 15000))).toEqual({ take: null, card: null, waiting: null })
  })
})
