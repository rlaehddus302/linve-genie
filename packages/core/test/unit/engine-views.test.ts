// 조회 함수 (AC-S02-01·80·81)와 영속 맵.
import {
  activeClaimId,
  getBuyer,
  getProduct,
  getSettlement,
  listBuyers,
  listCancelRequests,
  listClaims,
  listPending,
  listProducts,
  listSettlements,
  productStatus,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { emptyPMap, pdelete, pget, phas, pset, pvalues } from '../../src/engine/pmap.ts'
import { B1, chat, host, play, register } from './engine-helpers.ts'

const B0919 = { id: 'n1', date: '2026-10-19', title: '19일' }

describe('상품·찜·보류 조회', () => {
  const { state } = play(
    [
      register(16, { b: 'n1', price: 3000 }),
      register(15),
      register(2),
      chat('A', '15 2'),
      chat('B', '15'),
      chat('C', '30'),
      chat('A', '1', { b: 'n1' }),
      { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A' },
      chat('B', '15 취소'),
    ],
    {},
    [B1, B0919],
  )

  it('상품은 방송 선언 순서·번호 순, 없는 상품은 null', () => {
    expect(listProducts(state).map((p) => p.key)).toEqual(['b1/2', 'b1/15', 'n1/16'])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ status: 'SOLD', winners: ['A'], waitlist: ['B'], stock: 1, price: 10000, confirmVersion: 1, conflict: false })
    expect(getProduct(state, 'b1', 30)).toBeNull()
    expect(getProduct(state, 'b9', 15)).toBeNull()
  })

  it('찜은 생성 순서, 잠금·취소 요청 표시', () => {
    expect(listClaims(state).map((c) => [c.id, c.product, c.buyer, c.status, c.locked, c.cancelRequested, c.origin])).toEqual([
      ['c1', 'b1/15', 'A', 'CONFIRMED', true, false, 'chat'],
      ['c2', 'b1/2', 'A', 'CONFIRMED', false, false, 'chat'],
      ['c3', 'b1/15', 'B', 'WAITLISTED', false, true, 'chat'],
      ['c4', 'b1/30', 'C', 'PENDING', false, false, 'chat'],
      ['c5', 'n1/1', 'A', 'PENDING', false, false, 'chat'],
    ])
  })

  it('보류는 번호별, 방송 선언 순서', () => {
    expect(listPending(state).map((p) => [p.product, p.buyers, p.claims])).toEqual([
      ['b1/30', ['C'], ['c4']],
      ['n1/1', ['A'], ['c5']],
    ])
  })

  it('취소 요청·활성 찜 ID', () => {
    expect(listCancelRequests(state)).toEqual([{ product: 'b1/15', buyer: 'B', claim: 'c3', seq: 9 }])
    expect(activeClaimId(state, 'b1', 15, 'B')).toBe('c3')
    expect(activeClaimId(state, 'b1', 15, 'Z')).toBeNull()
    expect(activeClaimId(state, 'b1', 77, 'B')).toBeNull()
  })

  it('표시 상태', () => {
    const product = { name: 'x', price: 1, stock: 2, priceHistory: [] }
    expect(productStatus({ ...product, phase: 'SELLING' }, 1)).toBe('OPEN')
    expect(productStatus({ ...product, phase: 'SELLING' }, 2)).toBe('SOLD')
    expect(productStatus({ ...product, phase: 'HOLD' }, 2)).toBe('HOLD')
    expect(productStatus({ ...product, phase: 'READY' }, 0)).toBe('READY')
    expect(productStatus({ ...product, phase: 'CLOSED' }, 0)).toBe('CLOSED')
  })
})

describe('구매자 보기 (AC-S02-80)', () => {
  it('확정 찜만: 품목·합계·방송별·표시 이름·이력·차단 여부', () => {
    const { state } = play(
      [
        register(1, { price: 20000 }),
        register(2, { price: 7000 }),
        register(1, { b: 'n1', price: 5000 }),
        chat('A', '1 2', { nick: '가' }),
        chat('A', '1', { b: 'n1', nick: '가나' }),
        host('host.cancel', 2, 'A'),
        { type: 'host.blockBuyer', buyer: 'A', reason: 'r' },
        chat('B', '3'),
      ],
      {},
      [B1, B0919],
    )
    expect(getBuyer(state, 'A')).toEqual({
      id: 'A',
      display: '가나',
      nameHistory: ['가', '가나'],
      items: ['b1/1', 'n1/1'],
      subtotal: 25000,
      byBroadcast: { b1: 20000, n1: 5000 },
      blocked: true,
    })
    expect(getBuyer(state, 'B')).toMatchObject({ items: [], subtotal: 0, byBroadcast: {}, blocked: false })
    expect(getBuyer(state, 'Z')).toBeNull()
    expect(listBuyers(state).map((b) => b.id)).toEqual(['A', 'B'])
  })
})

describe('기본 정산 묶음 (AC-S02-81)', () => {
  const events = [register(1, { price: 20000 }), register(2, { price: 9999 }), register(1, { b: 'n1', price: 5000 }), chat('A', '1 2'), chat('A', '1', { b: 'n1' }), chat('B', '2')]

  it('무료 기준 경계: 합계 = 기준이면 0, 1원 모자라면 기본 배송비', () => {
    const exact = play(events, { 'shipping.freeThreshold': 29999, 'shipping.baseFee': 3500 }, [B1, B0919]).state
    expect(getSettlement(exact, 'A', '2026-10-18')).toEqual({
      buyer: 'A',
      date: '2026-10-18',
      items: ['b1/1', 'b1/2'],
      subtotal: 29999,
      shipping: 0,
      adjustments: 0,
      total: 29999,
      refundDue: 0,
      payment: 'UNPAID',
    })
    const short = play(events, { 'shipping.freeThreshold': 30000, 'shipping.baseFee': 3500 }, [B1, B0919]).state
    expect(getSettlement(short, 'A', '2026-10-18')).toMatchObject({ subtotal: 29999, shipping: 3500, total: 33499 })
  })

  it('날짜가 다른 방송은 따로 묶고 배송비도 따로, 묶음은 구매자 기록 순서·날짜 순', () => {
    const { state } = play(events, {}, [B1, B0919])
    expect(listSettlements(state).map((s) => [s.buyer, s.date, s.subtotal, s.shipping, s.total])).toEqual([
      ['A', '2026-10-18', 29999, 4000, 33999],
      ['A', '2026-10-19', 5000, 4000, 9000],
    ])
    // B는 2번 대기 → 품목 없음
    expect(getSettlement(state, 'B', '2026-10-18')).toMatchObject({ items: [], subtotal: 0, shipping: 0, total: 0, payment: 'UNPAID' })
    expect(getSettlement(state, 'Z', '2026-10-18')).toMatchObject({ subtotal: 0, shipping: 0, total: 0 })
  })

  it('0원 품목만 있어도 품목이 있으므로 기본 배송비 (무료 기준 없음)', () => {
    const { state } = play([register(1, { price: 0 }), chat('A', '1')])
    expect(getSettlement(state, 'A', '2026-10-18')).toMatchObject({ subtotal: 0, shipping: 4000, total: 4000 })
  })
})

describe('영속 맵 (PMap)', () => {
  it('넣기·읽기·빼기, 넘긴 맵은 바꾸지 않는다', () => {
    const empty = emptyPMap<number>()
    const one = pset(empty, 'a', 1)
    const two = pset(one, 'b', 2)
    const replaced = pset(two, 'a', 10)
    expect([empty.size, one.size, two.size, replaced.size]).toEqual([0, 1, 2, 2])
    expect(pget(one, 'b')).toBeUndefined()
    expect(pget(replaced, 'a')).toBe(10)
    expect(pget(two, 'a')).toBe(1)
    const removed = pdelete(replaced, 'a')
    expect(removed.size).toBe(1)
    expect(phas(removed, 'a')).toBe(false)
    expect(pdelete(removed, 'a')).toBe(removed)
    expect(pdelete(empty, 'x')).toBe(empty)
  })

  it('__proto__·constructor 같은 키도 자기 속성으로만 다룬다', () => {
    const map = pset(pset(emptyPMap<string>(), '__proto__', 'p'), 'constructor', 'c')
    expect(pget(map, '__proto__')).toBe('p')
    expect(pget(map, 'constructor')).toBe('c')
    expect(pget(emptyPMap<string>(), 'constructor')).toBeUndefined()
    expect(pget(emptyPMap<string>(), 'toString')).toBeUndefined()
    const roundTrip = JSON.parse(JSON.stringify(map)) as typeof map
    expect(pget(roundTrip, '__proto__')).toBe('p')
    expect(pvalues(pdelete(map, '__proto__'))).toEqual(['c'])
  })

  it('많은 키: 값을 하나 넣어도 바뀐 경로 밖의 마디는 이전 맵과 공유한다', () => {
    let map = emptyPMap<number>()
    for (let i = 0; i < 5000; i++) map = pset(map, `k${String(i)}`, i)
    expect(map.size).toBe(5000)
    expect(pvalues(map).sort((a, b) => a - b)).toEqual(Array.from({ length: 5000 }, (_, i) => i))
    const next = pset(map, 'new', -1)
    const shared = Object.keys(map.root).filter((key) => next.root[key] === map.root[key]).length
    expect(shared).toBe(Object.keys(map.root).length - 1)
  })
})
