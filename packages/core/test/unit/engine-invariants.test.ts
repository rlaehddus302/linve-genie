// checkInvariants (AC-S02-01·91): 망가진 상태마다 해당 불변식 위반을 실제로 알리는지 확인한다.
import { CorruptStateError, applyEvent, checkInvariants, type BuyerRecord, type ClaimRecord, type EngineEvent, type EngineState, type SlotRecord } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { emptyPMap, pdelete, pget, pset } from '../../src/engine/pmap.ts'
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
    expect(checkInvariants(withSlot(VALID, 'b1/16', { pending: emptyPMap() })).map((v) => v.message)).toContain('상품 b1/16: 보류 목록과 보류 상태인 찜이 다르다')
    expect(checkInvariants(withSlot(VALID, 'b1/15', { active: emptyPMap() })).map((v) => v.message)).toContain('상품 b1/15: 활성 찜 표시가 찜 상태와 다르다')
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

  it('같은 구매자의 보류 찜이 한 번호에 둘이면 공개할 때 멈춘다', () => {
    // 16번: D 보류(c4). 같은 D의 두 번째 보류 찜을 억지로 끼워 넣는다
    const second = { ...claim(VALID, 'c4'), id: 'c9', n: 9 }
    const broken = withSlot({ ...VALID, claims: pset(VALID.claims, 'c9', second) }, 'b1/16', { pending: pset(pset(emptyPMap<true>(), 'c4', true), 'c9', true) })
    expect(() => apply(broken, { type: 'product.register', b: 'b1', no: 16, name: 'x', price: 1 })).toThrow(CorruptStateError)
  })
})

describe('S03 불변식 (AC-S03-92): 충돌·차단·금액·합치기 연결', () => {
  // 15번: A 확정·잠금(c1), s1 충돌(c2) — 실제 시각순
  const { state: CONFLICTED } = play(
    [
      register(15, { at: 1000 }),
      chat('A', '15', { at: 10_000 }),
      { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: 11_000 },
      { type: 'sms', b: 'b1', ref: 's1', no: 15, received: '09:00', at: 20_000 },
    ],
    { 'contention.policy': 'RECEIVED_TIME' },
  )
  const withBuyer = (state: EngineState, id: string, change: Partial<BuyerRecord>): EngineState => ({ ...state, buyers: pset(state.buyers, id, { ...(pget(state.buyers, id) as BuyerRecord), ...change }) })

  it('엔진이 만든 충돌 상태에는 위반이 없다', () => {
    expect(slot(CONFLICTED, 'b1/15').conflict).toBe('c2')
    expect(checkInvariants(CONFLICTED)).toEqual([])
  })

  it('R-7: 충돌 표시와 충돌 찜이 다르다, 충돌 중인데 확정 수 ≠ 재고 — 어긋난 표시의 끝난 찜은 INV-9', () => {
    expect(ids(withSlot(CONFLICTED, 'b1/15', { conflict: null }))).toContain('R-7')
    expect(ids(withSlot(VALID, 'b1/16', { conflict: 'c4' }))).toEqual(expect.arrayContaining(['R-7']))
    const ended = withClaim(withSlot(CONFLICTED, 'b1/15', { conflict: 'c1' }), 'c2', { status: 'CANCELLED' })
    expect(checkInvariants(ended).map((v) => v.id)).toEqual(expect.arrayContaining(['R-7']))
    const short = { ...withSlot(CONFLICTED, 'b1/15', { product: { ...(slot(CONFLICTED, 'b1/15').product as NonNullable<SlotRecord['product']>), stock: 2 } }) }
    expect(checkInvariants(short).map((v) => v.message)).toContain('상품 b1/15: 충돌 중인데 확정 1명 ≠ 재고 2')
  })

  it('INV-7: 길이는 같은데 겹치는 대기 목록', () => {
    expect(ids(withSlot(VALID, 'b1/15', { waitlist: ['c2', 'c2'] }))).toContain('INV-7')
  })

  it('R-9: 차단 중인 구매자의 대기·보류·충돌 찜', () => {
    const blocked = { ...VALID, blocked: pset(VALID.blocked, 'B', true as const) }
    expect(checkInvariants(blocked)).toEqual([{ id: 'R-9', message: '찜 c2: 차단 중인 구매자 B의 WAITLISTED 찜' }])
  })

  it('INV-6: 구매자 합계·조정 합계가 정수가 아니다', () => {
    expect(ids(withBuyer(VALID, 'A', { subtotal: -1 }))).toEqual(expect.arrayContaining(['INV-5', 'INV-6']))
    const ledger = pset(VALID.ledger, JSON.stringify(['A', '2026-10-18']), { buyer: 'A', date: '2026-10-18', entries: [{ kind: 'adjust', amount: 0.5, reason: 'r', seq: 1, at: 0 }] })
    expect(checkInvariants({ ...VALID, ledger }).map((v) => v.message)).toContain('정산 A@2026-10-18 조정 합계가 정수가 아니다 (값: 0.5)')
  })

  it('INV-2: 합친 구매자들의 활성 찜이 한 번호에 둘이면 지금의 구매자 기준으로 잡는다', () => {
    const merged = withBuyer(withBuyer(VALID, 'B', { parent: 'C' }), 'C', { children: ['B'] })
    expect(checkInvariants(merged).map((v) => v.message)).toContain('상품 b1/15: 한 구매자에게 활성 찜이 둘 이상이다')
  })
})

describe('손상된 상태로 판정을 이어 가지 않는다 (S03 경로)', () => {
  const apply = (state: EngineState, event: Record<string, unknown>) => applyEvent(state, { seq: 100, at: 0, ...event } as unknown as EngineEvent)
  const withBuyer = (state: EngineState, id: string, change: Partial<BuyerRecord>): EngineState => ({ ...state, buyers: pset(state.buyers, id, { ...(pget(state.buyers, id) as BuyerRecord), ...change }) })

  it('합치기 연결이 고리면 멈춘다', () => {
    const loop = withBuyer(withBuyer(VALID, 'A', { parent: 'B', children: ['B'] }), 'B', { parent: 'A', children: ['A'] })
    expect(() => apply(loop, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'A', reason: 'r' })).toThrow('고리')
    const childLoop = withBuyer(withBuyer(VALID, 'C', { children: ['D'] }), 'D', { children: ['C'] })
    expect(() => apply(childLoop, { type: 'buyer.merge', from: 'C', into: 'A', reason: 'r' })).toThrow('고리')
  })

  it('찜의 방송이 선언되지 않았으면 정산 묶음을 찾을 때 멈춘다', () => {
    const broken = withClaim(VALID, 'c1', { b: 'b9' })
    expect(() => apply(broken, { type: 'settlement.refund', buyer: 'A', date: '2026-10-18', amount: 1, reason: 'r' })).not.toThrow()
    expect(() => apply(broken, { type: 'chat', b: 'b1', id: 'zz', ch: 'A', nick: 'A', text: '15 취소' })).not.toThrow()
    const auto = { ...broken, settings: { ...broken.settings, 'cancel.buyerChat': 'AUTO' as const } }
    expect(() => apply(auto, { type: 'chat', b: 'b1', id: 'zz', ch: 'A', nick: 'A', text: '15 취소' })).toThrow(CorruptStateError)
  })

  it('목록이 없는 찜을 가리키면 멈춘다 (보류 정렬·대기 자리·1등 비교·상품 수정)', () => {
    const pending = withSlot(VALID, 'b1/16', { pending: pset(slot(VALID, 'b1/16').pending, 'c99', true as const) })
    expect(() => apply(pending, { type: 'product.register', b: 'b1', no: 16, name: 'x', price: 1 })).toThrow('보류 찜 c99가 없다')
    const waiting = withSlot(VALID, 'b1/15', { waitlist: ['c2', 'c99'] })
    expect(() => apply(waiting, { type: 'chat', b: 'b1', id: 'zz', ch: 'E', nick: 'e', text: '15' })).toThrow('대기 찜 c99가 없다')
    const received = { ...VALID, settings: { ...VALID.settings, 'contention.policy': 'RECEIVED_TIME' as const } }
    expect(() => apply(withSlot(received, 'b1/15', { winners: ['c99'] }), { type: 'chat', b: 'b1', id: 'zz', ch: 'E', nick: 'e', text: '15' })).toThrow('확정 찜 c99가 없다')
    const noProduct = withSlot(received, 'b1/15', { winners: [], product: { ...(slot(VALID, 'b1/15').product as NonNullable<SlotRecord['product']>), stock: 0 } })
    expect(() => apply(noProduct, { type: 'chat', b: 'b1', id: 'zz', ch: 'E', nick: 'e', text: '15' })).toThrow('자리가 찼는데 확정 찜이 없다')
    expect(() => apply(withSlot(VALID, 'b1/15', { winners: ['c99'] }), { type: 'product.update', b: 'b1', no: 15, name: 'x' })).toThrow('확정 찜 c99가 없다')
  })

  it('문자 구매자 ID가 이미 있거나, 합칠 때·떼어 낼 때 활성 표시가 어긋나면 멈춘다', () => {
    const taken = { ...VALID, buyers: pset(VALID.buyers, 'sms:s1', { ...(pget(VALID.buyers, 'A') as BuyerRecord), id: 'sms:s1' }) }
    expect(() => apply(taken, { type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00' })).toThrow('이미 있다')
    // E의 15번 대기 찜을 만들고 D와 합친 뒤, D 쪽 활성 표시를 없는 찜으로 바꾼다
    const { state } = play([register(15), chat('A', '15'), chat('B', '15'), chat('D', '15'), chat('E', '안녕')])
    const ghost = withSlot(state, 'b1/15', { active: pset(slot(state, 'b1/15').active, 'E', 'c99') })
    expect(() => apply(ghost, { type: 'buyer.merge', from: 'D', into: 'E', reason: 'r' })).toThrow('활성 찜 c99가 없다')
    const merged = applyEvent(state, { seq: 50, at: 50, type: 'buyer.merge', from: 'D', into: 'E', reason: 'r' }).state
    const stale = withSlot(merged, 'b1/15', { active: pdelete(slot(merged, 'b1/15').active, 'E') })
    expect(() => apply(stale, { type: 'buyer.unmerge', from: 'D', reason: 'r' })).toThrow('활성 표시가 없다')
  })

  it('차단 중인 구매자의 보류 찜(손상)이 공개 순간에 오면 차단 거절로 끝낸다 — 판정을 멈추지 않는다', () => {
    const blocked = { ...VALID, blocked: pset(VALID.blocked, 'D', true as const) }
    const opened = apply(blocked, { type: 'product.register', b: 'b1', no: 16, name: 'x', price: 1 }).state
    expect(claim(opened, 'c4')).toMatchObject({ status: 'REJECTED', reason: 'BLOCKED' })
  })
})
