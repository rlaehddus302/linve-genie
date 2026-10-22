// O1 라운드 2 적대 시험 (test-domain): 수정(f65aaa7 leftoverVariant, cb03131 STOCK_SHORT) 뒤의 회귀.
// 1) 번호를 바꾸고 그 번호에 다른 상품을 다시 등록·옮겨 오는 무작위 로그에서, 받은 이벤트는 던지지 않고(INV), 확정·대기 찜은 늘 그 번호 상품의 변형이며,
//    남은 변형 보류 찜은 그 찜의 options로 하나씩 방송자 취소할 수 있다(R-5, R-19 "찜을 가리키는 방송자 조치", TD-O1-002 수정). INV-4.
//    제외: 같은 번호에 같은 구매자의 다른 활성 찜이 있는 "옵션 없는 보류 찜"(상품 키) — R-19 "적지 않았는데 둘 이상이면 아무 일도 없다"라 고를 길이 없다(TD-O1-008, 스펙 확인 필요).
// 2) 공개·번호 변경 때 수량 부족 보류 찜(D-O1-11)은 순위 순서로 판정되고, 뒤의 수량 1 찜은 남은 자리를 받는다.
import fc from 'fast-check'
import { applyEvent, checkEvent, checkInvariants, initEngine, listClaims, listProducts, listReviews, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, T0, play, type Ev } from './helpers.ts'

const SIZE = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }]
const SM = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] }]
const COLOR = [{ name: '색', choices: [{ label: '흰' }, { label: '검정' }] }]
const SCHEMAS = [SIZE, SM, COLOR, null] as const
const NAMES = ['반바지', '치마', '모자', '양말']
const BUYERS = ['A', 'B', 'C', 'D']
const TEXTS = ['반바지 M', '반바지 L', '치마 S', '치마 M', '모자 흰', '21', '21 M', '25 L', 'M', '21 취소', '25 취소', '반바지 M 2개', '양말']
const PICKS = [{ 사이즈: 'S' }, { 사이즈: 'M' }, { 사이즈: 'L' }, { 색: '흰' }, { 색: '검정' }, undefined]
const ACTS = ['host.cancel', 'host.reject', 'host.approveCancel', 'host.dismissCancel', 'host.promote', 'host.confirm']
const ACTIVE = ['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT']

type Raw = { readonly k: string; readonly [x: string]: unknown }
const rawArb: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ k: fc.constant('chat'), b: fc.nat(3), t: fc.nat(TEXTS.length - 1) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('act'), a: fc.nat(ACTS.length - 1), b: fc.nat(3), no: fc.constantFrom(21, 25), p: fc.nat(PICKS.length - 1) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('renumber'), back: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('reg'), no: fc.constantFrom(21, 25), s: fc.nat(3), n: fc.nat(3), ready: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('phase'), no: fc.constantFrom(21, 25), w: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('focus'), no: fc.constantFrom(21, 25) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('block'), b: fc.nat(3), un: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('merge'), f: fc.nat(3), i: fc.nat(3), un: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('update'), no: fc.constantFrom(21, 25), s: fc.nat(3) }) },
)

function eventOf(r: Raw, i: number): Record<string, unknown> {
  const n = (x: unknown) => x as number
  switch (r.k) {
    case 'chat':
      return { type: 'chat', b: 'b1', id: `m${String(i)}`, ch: BUYERS[n(r.b)], nick: '닉', text: TEXTS[n(r.t)] }
    case 'act': {
      const options = PICKS[n(r.p)]
      return { type: ACTS[n(r.a)], b: 'b1', no: r.no, buyer: BUYERS[n(r.b)], reason: '사유', ...(options ? { options } : {}) }
    }
    case 'renumber':
      return r.back ? { type: 'product.renumber', b: 'b1', from: 25, to: 21 } : { type: 'product.renumber', b: 'b1', from: 21, to: 25 }
    case 'reg': {
      const s = SCHEMAS[n(r.s)]
      return { type: 'product.register', b: 'b1', no: r.no, name: NAMES[n(r.n)], price: 10000, ...(s ? { options: s } : {}), ...(r.ready === true ? { status: 'READY' } : {}) }
    }
    case 'phase':
      return { type: ['product.open', 'product.hold', 'product.close'][n(r.w)], b: 'b1', no: r.no }
    case 'focus':
      return { type: 'product.focus', b: 'b1', no: r.no }
    case 'block':
      return { type: r.un === true ? 'host.unblockBuyer' : 'host.blockBuyer', buyer: BUYERS[n(r.b)], reason: '사유' }
    case 'merge':
      return r.un === true ? { type: 'buyer.unmerge', from: BUYERS[n(r.f)], reason: '사유' } : { type: 'buyer.merge', from: BUYERS[n(r.f)], into: BUYERS[n(r.i)], reason: '사유' }
    default: {
      const s = SCHEMAS[n(r.s)]
      return { type: 'product.update', b: 'b1', no: r.no, ...(s ? { options: s } : {}) }
    }
  }
}

const SET = { 'claim.parseMode': 'OPTIONS' as const, 'cancel.buyerChat': 'REQUEST' as const }

describe('O1 라운드 2: 번호를 다시 쓰는 무작위 옵션 방송 (TD-O1-002 수정의 회귀)', () => {
  it('받은 이벤트는 던지지 않고, 확정·대기 찜은 그 번호 상품의 변형, 남은 변형 보류 찜은 options로 하나씩 취소된다, INV-4', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(rawArb, { minLength: 5, maxLength: 40 }), (ready, raws) => {
        let state: EngineState = initEngine({ broadcasts: [B1], settings: SET })
        const log: EngineEvent[] = []
        const push = (fields: Record<string, unknown>) => {
          const event = { seq: log.length + 1, at: T0 + log.length * 1000, ...fields } as unknown as EngineEvent
          if (checkEvent(state, event).length > 0) return
          state = applyEvent(state, event).state
          log.push(event)
          expect(checkInvariants(state)).toEqual([])
        }
        push({ type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE, ...(ready ? { status: 'READY' } : {}) })
        raws.forEach((r, i) => push(eventOf(r, i)))
        const claims = listClaims(state)
        // INV-2(변형 판)
        const seen = new Set<string>()
        for (const c of claims.filter((x) => ACTIVE.includes(x.status))) {
          const key = `${c.currentBuyer}|${c.key}`
          expect(seen.has(key), key).toBe(false)
          seen.add(key)
        }
        // 확정·대기 찜은 그 번호 상품의 변형이다 (남은 자리가 새 상품의 자리처럼 판정되지 않는다)
        const products = new Map(listProducts(state).map((p) => [p.key, p]))
        for (const c of claims.filter((x) => x.status === 'CONFIRMED' || x.status === 'WAITLISTED')) {
          const p = products.get(c.product)
          expect(p, `상품 ${c.id}`).toBeDefined()
          if (p?.hasOptions === true) expect(p.variants.map((v) => v.key), c.id).toContain(c.key)
          else expect(c.key).toBe(c.product)
        }
        // 남은 보류 찜은 하나씩 끝낼 수 있다 (R-5)
        for (const c of claims.filter((x) => x.status === 'PENDING')) {
          if (c.options === null && claims.some((x) => x.id !== c.id && x.no === c.no && x.currentBuyer === c.currentBuyer && ACTIVE.includes(x.status))) continue // TD-O1-008
          const options = c.options === null ? undefined : Object.fromEntries(c.options)
          const cancel = { seq: log.length + 1, at: T0 + log.length * 1000, type: 'host.cancel', b: 'b1', no: c.no, buyer: c.currentBuyer, reason: '사유', ...(options ? { options } : {}) } as unknown as EngineEvent
          expect(checkEvent(state, cancel), `취소 ${c.id} ${c.key}`).toEqual([])
          expect(listClaims(applyEvent(state, cancel).state).find((x) => x.id === c.id)?.status, `취소 ${c.id} ${c.key}`).toBe('CANCELLED')
        }
        // INV-4
        let replayed: EngineState = initEngine({ broadcasts: [B1], settings: SET })
        for (const event of log) replayed = applyEvent(replayed, event).state
        expect(JSON.stringify(replayed)).toBe(JSON.stringify(state))
      }),
      { numRuns: 600, seed: 20261022 },
    )
  })
})

describe('O1 라운드 2: 수량 부족 보류 찜(D-O1-11)의 순위 회귀', () => {
  const sms = (ref: string, qty: number, no = 31): Ev => ({ type: 'sms', b: 'b1', ref, no, received: '20:00', qty })
  const towel = (f: Record<string, unknown> = {}): Ev => ({ type: 'product.register', b: 'b1', no: 31, name: '수건', price: 8000, stock: 2, ...f })
  const rows = (p: ReturnType<typeof play>) => listClaims(p.state).map((c) => [c.buyer, c.qty, c.status, c.reason])

  it('수량 1·3·1(재고 2): 1등 확정, 수량 3은 STOCK_SHORT, 뒤의 수량 1은 남은 자리로 확정', () => {
    const p = play([sms('s1', 1), sms('s2', 3), sms('s3', 1), towel()])
    expect(rows(p)).toEqual([
      ['sms:s1', 1, 'CONFIRMED', null],
      ['sms:s2', 3, 'REJECTED', 'STOCK_SHORT'],
      ['sms:s3', 1, 'CONFIRMED', null],
    ])
    expect(listReviews(p.state).map((r) => [r.item, r.reason, r.qty])).toEqual([['sms:s2', 'STOCK_SHORT', 3]])
    expect(checkInvariants(p.state)).toEqual([])
  })

  it('번호 변경으로 판정: 바뀐 상품의 확정은 RENUMBERED로 풀리고, 들어온 수량 3 보류 찜은 재고 2에서 STOCK_SHORT', () => {
    const p = play([sms('s1', 3, 35), towel(), { type: 'chat', b: 'b1', id: 'r2a', ch: 'A', nick: 'A', text: '31' }, { type: 'product.renumber', b: 'b1', from: 31, to: 35 }])
    expect(rows(p)).toEqual([
      ['sms:s1', 3, 'REJECTED', 'STOCK_SHORT'],
      ['A', 1, 'REJECTED', 'RENUMBERED'],
    ])
    expect(listReviews(p.state).map((r) => [r.item, r.reason, r.no, r.qty])).toEqual([['sms:s1', 'STOCK_SHORT', 35, 3]])
  })

  it('바로잡기 수량이 남은 수량보다 크면 아무 일도 없고 항목이 남는다 (R-20 7)', () => {
    const p = play([sms('s1', 3), towel(), { type: 'host.resolveReview', b: 'b1', item: 'sms:s1', no: 31, qty: 3, reason: '사유' }])
    expect(rows(p)).toEqual([['sms:s1', 3, 'REJECTED', 'STOCK_SHORT']])
    expect(listReviews(p.state).map((r) => r.item)).toEqual(['sms:s1'])
  })
})
