// checkInvariants (AC-S02-01·91): 망가진 상태마다 해당 불변식 위반을 실제로 알리는지 확인한다.
import { CorruptStateError, applyEvent, checkInvariants, type BuyerRecord, type ClaimRecord, type EngineEvent, type EngineState, type SlotRecord } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { pget, pset } from '../../src/engine/pmap.ts'
import { chat, play, register } from './engine-helpers.ts'

// 15번: A 확정(c1), B 대기(c2), C 대기(c3). 16번: D 보류(c4)
const { state: VALID } = play([register(15), chat('A', '15'), chat('B', '15'), chat('C', '15'), chat('D', '16')])

const slot = (state: EngineState, key: string): SlotRecord => pget(state.slots, key) as SlotRecord
const claim = (state: EngineState, id: string): ClaimRecord => pget(state.claims, id) as ClaimRecord
const withSlot = (state: EngineState, key: string, change: Partial<SlotRecord>): EngineState => ({ ...state, slots: pset(state.slots, key, { ...slot(state, key), ...change }) })
const withClaim = (state: EngineState, id: string, change: Partial<ClaimRecord>): EngineState => ({ ...state, claims: pset(state.claims, id, { ...claim(state, id), ...change }) })
const ids = (state: EngineState) => checkInvariants(state).map((v) => v.id)

describe('checkInvariants', () => {
  it('엔진이 만든 상태에는 위반이 없다', () => {
    expect(checkInvariants(VALID)).toEqual([])
  })

  it('INV-1: 확정 찜 수 > 재고', () => {
    const broken = withClaim(withSlot(VALID, 'b1/15', { winners: ['c1', 'c2'], waitlist: ['c3'] }), 'c2', { status: 'CONFIRMED', price: 10000 })
    const violations = checkInvariants(broken)
    expect(violations).toContainEqual({ id: 'INV-1', message: '상품 b1/15: 확정 2명 > 재고 1' })
  })

  it('INV-1: 확정 목록과 찜 상태가 다르다', () => {
    expect(ids(withSlot(VALID, 'b1/15', { winners: [] }))).toContain('INV-1')
  })

  it('INV-7: 대기 목록에 빈틈·겹침이 있다', () => {
    expect(ids(withSlot(VALID, 'b1/15', { waitlist: ['c2'] }))).toContain('INV-7')
    expect(ids(withSlot(VALID, 'b1/15', { waitlist: ['c2', 'c2', 'c3'] }))).toContain('INV-7')
  })

  it('INV-2: 한 구매자에게 활성 찜이 둘, 보류 목록·활성 표시가 찜 상태와 다르다', () => {
    const twice = withClaim(VALID, 'c3', { buyer: 'B' })
    expect(checkInvariants(twice).map((v) => v.message)).toContain('상품 b1/15: 한 구매자에게 활성 찜이 둘 이상이다')
    expect(checkInvariants(withSlot(VALID, 'b1/16', { pending: [] })).map((v) => v.message)).toContain('상품 b1/16: 보류 목록과 보류 상태인 찜이 다르다')
    expect(checkInvariants(withSlot(VALID, 'b1/15', { active: {} })).map((v) => v.message)).toContain('상품 b1/15: 활성 찜 표시가 찜 상태와 다르다')
    const orphan = withClaim(VALID, 'c4', { key: 'b1/77' })
    expect(checkInvariants(orphan).map((v) => v.message)).toContain('찜 c4: 번호 b1/77 기록 없이 활성이다')
  })

  it('INV-5: 구매자 합계 기록 ≠ 확정 찜 가격 스냅샷의 합', () => {
    const buyer = pget(VALID.buyers, 'A')
    if (buyer === undefined) throw new Error('구매자 A 없음')
    const broken = { ...VALID, buyers: pset(VALID.buyers, 'A', { ...buyer, subtotal: 9999 }) }
    expect(checkInvariants(broken)).toEqual([{ id: 'INV-5', message: '구매자 A: 합계 9999 ≠ 확정 찜 가격 스냅샷의 합 10000' }])
  })

  it('INV-6: 0 이상의 정수가 아닌 금액', () => {
    const product = slot(VALID, 'b1/15').product
    if (product === null) throw new Error('상품 없음')
    expect(ids(withSlot(VALID, 'b1/15', { product: { ...product, price: -1 } }))).toEqual(['INV-6'])
    const fractional = withClaim(VALID, 'c1', { price: 10000.5 })
    expect(ids(fractional)).toContain('INV-6')
    expect(checkInvariants(fractional).map((v) => v.message)).toContain('찜 c1 가격 스냅샷이 0 이상의 정수가 아니다 (값: 10000.5)')
  })

  it('INV-9: 취소·거절된 찜이 확정·대기·보류 목록에 남아 있다', () => {
    const broken = withClaim(VALID, 'c3', { status: 'CANCELLED' })
    expect(checkInvariants(broken).filter((v) => v.id === 'INV-9')).toEqual([{ id: 'INV-9', message: '상품 b1/15: 끝난 찜이 목록에 남아 있다 (c3)' }])
  })

  it('목록에 없는 찜 ID가 있어도 예외 없이 위반으로 알린다', () => {
    const broken = withSlot(VALID, 'b1/15', { winners: ['c1', 'c99'] })
    expect(() => checkInvariants(broken)).not.toThrow()
    expect(ids(broken)).toContain('INV-1')
  })
})

describe('손상된 상태로 판정을 이어 가지 않는다 (CorruptStateError)', () => {
  const apply = (state: EngineState, event: Record<string, unknown>) => applyEvent(state, { seq: 100, at: 0, ...event } as unknown as EngineEvent)

  it('대기 목록이 없는 찜을 가리키면 승계할 때 멈춘다', () => {
    const broken = withSlot(VALID, 'b1/15', { waitlist: ['c99', 'c3'] })
    expect(() => apply(broken, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: 'r' })).toThrow(CorruptStateError)
  })

  it('찜의 주인 구매자 기록이 없으면 멈춘다', () => {
    const buyers = pset(VALID.buyers, 'A', undefined as unknown as BuyerRecord)
    const broken = { ...VALID, buyers: { ...buyers, size: buyers.size } }
    expect(() => apply(broken, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: 'r' })).toThrow('구매자 A가 없다')
  })

  it('찜이 가리키는 효과 기록이 없으면 확정을 풀 때 멈춘다', () => {
    const broken = withClaim(VALID, 'c1', { effects: ['c1:PRINT_PRODUCT_LABEL:-:1', 'c1:LOST:-:1'] })
    expect(() => apply(broken, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: 'r' })).toThrow('효과 c1:LOST:-:1가 없다')
  })
})
