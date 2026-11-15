// 한 번호에 묶어 파는 개수 ("채홍 3개", D-PIECES-01 — 사용자 메모 11-13 "66 채홍 3개인데 개수도 인식해서").
// 지키는 성질: (a) 개수는 표시 칸이다 — 판정·재고·찜 금액이 개수와 상관없다(가격은 묶음 하나의 값) ·
// (b) 1(기본)이면 상품 기록·조회에 칸이 없다(옛 로그 재생 결과 그대로) · (c) 고치기·확정으로 바꾸고, 1로 고치면 칸이 없어진다 ·
// (d) 개수만 고쳐도 뽑은 라벨은 다시 인쇄 필요 · (e) 1~99 정수만 받는다.
import { PIECES_MAX, applyEvent, checkEvent, checkInvariants, getProduct, listClaims, listEffects, type EngineEvent, type EngineState } from '@livejjim/core'
import { piecesPerSale, productTitle, splitPieces } from '@livejjim/core/format'
import { describe, expect, it } from 'vitest'
import { T0, chat, play, register, type EventInput } from './engine-helpers.ts'

const update = (no: number, fields: Partial<{ name: string; price: number; pieces: number }>): EventInput => ({ type: 'product.update', b: 'b1', no, ...fields })
const withPieces = (no: number, pieces: number, fields: Partial<{ name: string; price: number; stock: number }> = {}): EventInput => ({ ...register(no, fields), pieces }) as EventInput
const printed = (claim: string, version = 1): EventInput => ({ type: 'effect.labelPrinted', effectId: `${claim}:PRINT_PRODUCT_LABEL:-:${String(version)}` })
const next = (state: EngineState, event: Record<string, unknown>) => applyEvent(state, { seq: 99, at: T0 + 99_000, ...event } as unknown as EngineEvent)

describe('D-PIECES-01 상품 개수', () => {
  it('(a) 개수 3인 상품도 찜 금액은 상품 가격 그대로이고 재고·판정이 같다', () => {
    const plain = play([register(66, { name: '채홍', price: 20_000 }), chat('A', '66'), chat('B', '66')])
    const three = play([withPieces(66, 3, { name: '채홍', price: 20_000 }), chat('A', '66'), chat('B', '66')])
    expect(getProduct(three.state, 'b1', 66)).toMatchObject({ name: '채홍', price: 20_000, stock: 1, pieces: 3, winners: ['A'], waitlist: ['B'] })
    const claims = (state: EngineState) => listClaims(state).map((c) => [c.buyer, c.status, c.price, c.amount])
    expect(claims(three.state)).toEqual(claims(plain.state))
    expect(claims(three.state)[0]).toEqual(['A', 'CONFIRMED', 20_000, 20_000])
    expect(three.emitted).toEqual(plain.emitted)
    expect(checkInvariants(three.state)).toEqual([])
  })

  it('(b) 개수 1·적지 않은 등록은 상품 기록과 조회에 개수 칸이 없다', () => {
    const { state } = play([register(1), withPieces(2, 1)])
    for (const no of [1, 2]) expect(getProduct(state, 'b1', no)).not.toHaveProperty('pieces')
    // 개수 1을 적은 등록의 상태는 적지 않은 등록의 상태와 같다 (옛 로그 재생 결과 그대로)
    expect(play([withPieces(2, 1)]).state).toEqual(play([register(2)]).state)
  })

  it('(c) 고치기로 개수를 바꾸고 1로 고치면 칸이 없어진다. 같은 값은 아무 일도 없다', () => {
    const { state } = play([register(5, { name: '채홍' })])
    const three = next(state, update(5, { pieces: 3 }))
    expect(getProduct(three.state, 'b1', 5)).toMatchObject({ name: '채홍', pieces: 3 })
    expect(next(three.state, update(5, { pieces: 3 })).state).toBe(three.state)
    expect(next(state, update(5, { pieces: 1 })).state).toBe(state)
    const back = next(three.state, update(5, { pieces: 1 }))
    expect(getProduct(back.state, 'b1', 5)).not.toHaveProperty('pieces')
    const both = next(state, update(5, { name: '라울', pieces: 2 }))
    expect(getProduct(both.state, 'b1', 5)).toMatchObject({ name: '라울', pieces: 2, nameHistory: [{ from: '채홍', to: '라울' }] })
  })

  it('(c) 확인 중 상품은 확정할 때 개수도 정한다', () => {
    const { state } = play([{ type: 'product.register', b: 'b1', no: 7, name: '채홍', price: 10_000, tentative: { by: 'WORKER', reasons: ['NAME_UNSURE'] } } as EventInput, chat('A', '7')])
    const confirmed = next(state, { type: 'product.confirm', b: 'b1', no: 7, pieces: 3 })
    expect(getProduct(confirmed.state, 'b1', 7)).toMatchObject({ status: 'SOLD', pieces: 3, winners: ['A'] })
    expect(getProduct(confirmed.state, 'b1', 7)).not.toHaveProperty('tentative')
  })

  it('(d) 개수만 고쳐도 뽑은 라벨은 다시 인쇄 필요, 효과는 나오지 않는다', () => {
    const { state } = play([register(15, { stock: 2 }), chat('A', '15'), chat('B', '15'), printed('c1')])
    const after = next(state, update(15, { pieces: 3 }))
    expect(listClaims(after.state).map((c) => c.reprintNeeded)).toEqual([true, false])
    expect(after.effects).toEqual([])
    expect(listEffects(after.state).length).toBe(listEffects(state).length)
  })

  it('(e) 개수는 1~99 정수만', () => {
    const { state } = play([register(1)])
    for (const pieces of [0, -1, 1.5, PIECES_MAX + 1, '3']) {
      expect(checkEvent(state, { type: 'product.update', b: 'b1', no: 1, pieces, seq: 9, at: T0 + 9000 }), String(pieces)).toEqual([expect.objectContaining({ field: 'pieces' })])
    }
    for (const type of ['product.register', 'product.update', 'product.confirm']) {
      expect(checkEvent(state, { type, b: 'b1', no: 2, name: '', price: 0, pieces: PIECES_MAX, seq: 9, at: T0 + 9000 }), type).toEqual([])
    }
  })
})

describe('D-PIECES-01 표시 도우미', () => {
  it('productTitle: 2 이상만 품종 뒤에 "n개"', () => {
    expect(productTitle('채홍', 3)).toBe('채홍 3개')
    expect(productTitle(' 채홍 ', 1)).toBe('채홍')
    expect(productTitle('채홍')).toBe('채홍')
    expect(productTitle('', 2)).toBe('2개')
  })
  it('splitPieces: 끝의 "2~99개"만 떼고, 개수만 적은 세트 이름은 그대로', () => {
    expect(splitPieces('채홍 3개')).toEqual({ name: '채홍', pieces: 3 })
    expect(splitPieces('테라로사 색금 12 개')).toEqual({ name: '테라로사 색금', pieces: 12 })
    expect(splitPieces('채홍 1개')).toEqual({ name: '채홍 1개', pieces: null })
    expect(splitPieces('5개')).toEqual({ name: '5개', pieces: null })
    expect(splitPieces('5개 세트')).toEqual({ name: '5개 세트', pieces: null })
    expect(splitPieces('채홍')).toEqual({ name: '채홍', pieces: null })
  })
  it('piecesPerSale: 개수 칸 → 세트 이름 → 1', () => {
    expect(piecesPerSale({ name: '채홍', pieces: 3 })).toBe(3)
    expect(piecesPerSale({ name: '5개 세트' })).toBe(5)
    expect(piecesPerSale({ name: '채홍' })).toBe(1)
  })
})
