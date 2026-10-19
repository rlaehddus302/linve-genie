// 판정 규칙 세부 (AC-S02-10~62). 골든이 고정한 것 밖의 경계와 조합을 규칙 문장대로 확인한다.
import { InvalidEventError, applyEvent, getProduct, listCancelRequests, listClaims, listEffects, listPending, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, B2, T0, chat, host, play, register, type EventInput } from './engine-helpers.ts'

const product = (state: EngineState, no: number, b = 'b1') => {
  const info = getProduct(state, b, no)
  return info === null ? null : { status: info.status, winners: info.winners, waitlist: info.waitlist, awaiting: info.awaitingSuccession }
}
const claimsOf = (state: EngineState) => listClaims(state).map((c) => [c.product, c.buyer, c.status, c.reason])

describe('채팅 → 찜 (AC-S02-10·11·12)', () => {
  it('같은 메시지 ID라도 방송이 다르면 다른 메시지다', () => {
    const { state } = play(
      [register(15), register(15, { b: 'b2', name: '라울', price: 5000 }), chat('UC_A', '15', { id: 'm1' }), chat('UC_B', '15', { id: 'm1', b: 'b2' })],
      {},
      [B1, B2],
    )
    expect(product(state, 15)?.winners).toEqual(['UC_A'])
    expect(product(state, 15, 'b2')?.winners).toEqual(['UC_B'])
  })

  it('재수신은 본문·닉네임이 달라도 구매자 기록·닉네임을 바꾸지 않는다', () => {
    const { state, states } = play([register(15), chat('UC_A', '15', { id: 'm1', nick: '홍길동' }), chat('UC_A', '안녕', { id: 'm1', nick: '바뀐이름' })])
    expect(states[3]).toBe(states[2])
    expect(product(state, 15)?.winners).toEqual(['UC_A'])
  })

  it('무시하는 방송자 메시지는 구매자로 기록하지 않고, 재수신으로도 기록되지 않는다', () => {
    const { state } = play([register(15), chat('UC_OWNER', '15', { id: 'm0', owner: true }), chat('UC_OWNER', '15', { id: 'm0' })])
    expect(listClaims(state)).toEqual([])
    expect(getProduct(state, 'b1', 15)?.winners).toEqual([])
  })

  it('한 메시지의 여러 번호는 나온 순서대로, 같은 사람의 다른 번호는 각각 판정한다', () => {
    const { state } = play([register(15), register(28, { price: 5000 }), chat('UC_A', '28 15 99')])
    expect(claimsOf(state)).toEqual([
      ['b1/28', 'UC_A', 'CONFIRMED', null],
      ['b1/15', 'UC_A', 'CONFIRMED', null],
      ['b1/99', 'UC_A', 'PENDING', 'UNOPENED'],
    ])
  })

  it('차단된 사람의 찜은 번호 기록을 만들지 않는다 (보류도 아님)', () => {
    const { state } = play([{ type: 'host.blockBuyer', buyer: 'UC_X', reason: '장난' }, chat('UC_X', '15')])
    expect(claimsOf(state)).toEqual([['b1/15', 'UC_X', 'REJECTED', 'BLOCKED']])
    expect(listPending(state)).toEqual([])
  })

  it('MULTI IGNORE·maxNumber는 그 방송 설정으로 읽는다', () => {
    const { state } = play([register(15), register(16), chat('UC_A', '15 16')], { 'claim.multiNumber': 'IGNORE' })
    expect(listClaims(state)).toEqual([])
  })
})

describe('R-4 판정표 (AC-S02-20·22)', () => {
  it('대기 한도를 넘으면 품절, 거절된 찜도 찜으로 센다', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '15'), chat('C', '15')], { 'waitlist.max': 1 })
    expect(claimsOf(state)).toEqual([
      ['b1/15', 'A', 'CONFIRMED', null],
      ['b1/15', 'B', 'WAITLISTED', null],
      ['b1/15', 'C', 'REJECTED', 'SOLD_OUT'],
    ])
  })

  it('재고 3: 앞선 3명 확정, 확정버전은 1·2·3', () => {
    const { state } = play([register(15, { stock: 3 }), chat('A', '15'), chat('B', '15'), chat('C', '15'), chat('D', '15')])
    expect(product(state, 15)).toEqual({ status: 'SOLD', winners: ['A', 'B', 'C'], waitlist: ['D'], awaiting: false })
    expect(listEffects(state).filter((e) => e.kind === 'POST_THANKS').map((e) => [e.buyer, e.confirmVersion])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ])
  })
})

describe('상품 명령 (AC-S02-30)', () => {
  it('없는 상품·판매 중 상품 open·READY hold·이미 닫힌 close는 아무 일도 없다 (같은 상태 객체)', () => {
    const base = play([register(15), register(16, { status: 'READY' }), register(17)])
    for (const event of [
      { type: 'product.open', b: 'b1', no: 15 },
      { type: 'product.hold', b: 'b1', no: 16 },
      { type: 'product.open', b: 'b1', no: 99 },
      { type: 'product.close', b: 'b1', no: 99 },
    ] as const) {
      const { states } = play([register(15), register(16, { status: 'READY' }), register(17), event])
      expect(states[4], event.type).toBe(states[3])
      expect(JSON.stringify(states[4])).toBe(JSON.stringify(base.state))
    }
    const closed = play([register(17), { type: 'product.close', b: 'b1', no: 17 }, { type: 'product.close', b: 'b1', no: 17 }])
    expect(closed.states[3]).toBe(closed.states[2])
  })

  it('HOLD 상품은 판매 종료할 수 있고(찜 없음), 대기 찜이 남으면 닫히지 않는다', () => {
    const held = play([register(15), { type: 'product.hold', b: 'b1', no: 15 }, { type: 'product.close', b: 'b1', no: 15 }])
    expect(product(held.state, 15)?.status).toBe('CLOSED')
    const waiting = play([register(15), chat('A', '15'), chat('B', '15'), host('host.cancel', 15, 'A'), { type: 'product.hold', b: 'b1', no: 15 }])
    // A 취소 → B 승계(1등). 확정 찜이 있으면 닫지 않는다
    const after = play([...waitingEvents(), { type: 'product.close', b: 'b1', no: 15 }])
    expect(product(after.state, 15)?.status).toBe('HOLD')
    expect(product(waiting.state, 15)?.winners).toEqual(['B'])
  })

  it('READY 상품을 닫으면 보류 찜이 거절되고, 다시 열면 새 찜만 받는다', () => {
    const { state } = play([
      register(15, { status: 'READY' }),
      chat('A', '15'),
      { type: 'product.close', b: 'b1', no: 15 },
      { type: 'product.open', b: 'b1', no: 15 },
      chat('B', '15'),
    ])
    expect(claimsOf(state)).toEqual([
      ['b1/15', 'A', 'REJECTED', 'NOT_ON_SALE'],
      ['b1/15', 'B', 'CONFIRMED', null],
    ])
  })
})

function waitingEvents(): EventInput[] {
  return [register(15), chat('A', '15'), chat('B', '15'), host('host.cancel', 15, 'A'), { type: 'product.hold', b: 'b1', no: 15 }]
}

describe('보류 찜 (AC-S02-40·41)', () => {
  it('유효 시간 0초: 공개 시각과 같은 밀리초에 온 찜만 판정한다', () => {
    const { state } = play(
      [chat('A', '15', { at: T0 - 1 }), chat('B', '15', { at: T0 }), register(15, { at: T0 })],
      { 'claim.preOpenWindowSec': 0 },
    )
    expect(claimsOf(state)).toEqual([
      ['b1/15', 'A', 'REJECTED', 'EXPIRED'],
      ['b1/15', 'B', 'CONFIRMED', null],
    ])
  })

  it('공개되지 않은 번호의 보류 찜은 다른 번호가 공개되어도 계속 보류', () => {
    const { state } = play([chat('A', '15', { at: T0 }), register(16, { at: T0 + 3_600_000 })])
    expect(listPending(state).map((p) => [p.product, p.buyers])).toEqual([['b1/15', ['A']]])
  })

  it('보류 중 취소 요청을 받은 찜이 공개 순간 확정되면 요청은 남고, 만료되면 사라진다', () => {
    const kept = play([chat('A', '15', { at: T0 }), chat('A', '15 취소', { at: T0 + 1000 }), register(15, { at: T0 + 2000 })])
    expect(listCancelRequests(kept.state).map((r) => [r.product, r.buyer])).toEqual([['b1/15', 'A']])
    const gone = play([chat('A', '15', { at: T0 }), chat('A', '15 취소', { at: T0 + 1000 }), register(15, { at: T0 + 60_000 })])
    expect(listCancelRequests(gone.state)).toEqual([])
    expect(claimsOf(gone.state)).toEqual([['b1/15', 'A', 'REJECTED', 'EXPIRED']])
  })

  it('AUTO 시청자 취소는 보류 찜을 바로 취소한다', () => {
    const { state } = play([chat('A', '15'), chat('A', '15 취소')], { 'cancel.buyerChat': 'AUTO' })
    expect(claimsOf(state)).toEqual([['b1/15', 'A', 'CANCELLED', null]])
    expect(listPending(state)).toEqual([])
  })

  it('공개 순간 차단된 구매자는 없다 — 차단이 보류 찜을 먼저 거절한다', () => {
    const { state } = play([chat('A', '15'), chat('B', '15'), { type: 'host.blockBuyer', buyer: 'A', reason: '장난' }, register(15)])
    expect(product(state, 15)?.winners).toEqual(['B'])
  })
})

describe('취소·승계 (AC-S02-50~53)', () => {
  it('ASK + 재고 2: 한 명 취소하면 표시, 수동 승계로 재고가 차면 표시가 사라진다', () => {
    const settings = { 'cancel.succession': 'ASK' } as const
    const { state, states } = play(
      [register(15, { stock: 2 }), chat('A', '15'), chat('B', '15'), chat('C', '15'), host('host.cancel', 15, 'A'), chat('D', '15'), host('host.promote', 15, 'D')],
      settings,
    )
    expect(product(states[5] as EngineState, 15)).toEqual({ status: 'OPEN', winners: ['B'], waitlist: ['C'], awaiting: true })
    expect(product(states[6] as EngineState, 15)?.waitlist).toEqual(['C', 'D'])
    expect(product(state, 15)).toEqual({ status: 'SOLD', winners: ['B', 'D'], waitlist: ['C'], awaiting: false })
  })

  it('ASK: 대기자가 모두 빠지면(취소·차단) 표시가 사라지고 새 찜은 6번 줄로 확정', () => {
    const { state, states } = play(
      [register(15), chat('A', '15'), chat('B', '15'), host('host.cancel', 15, 'A'), { type: 'host.blockBuyer', buyer: 'B', reason: '장난' }, chat('C', '15')],
      { 'cancel.succession': 'ASK' },
    )
    expect(product(states[4] as EngineState, 15)?.awaiting).toBe(true)
    expect(product(states[5] as EngineState, 15)?.awaiting).toBe(false)
    expect(product(state, 15)?.winners).toEqual(['C'])
  })

  it('ASK: 표시가 있는 동안 HOLD 상품에도 수동 승계가 된다 (HOLD는 새 찜만 막는다)', () => {
    const { state } = play(
      [register(15), chat('A', '15'), chat('B', '15'), { type: 'product.hold', b: 'b1', no: 15 }, host('host.cancel', 15, 'A'), host('host.promote', 15, 'B')],
      { 'cancel.succession': 'ASK' },
    )
    expect(product(state, 15)).toEqual({ status: 'HOLD', winners: ['B'], waitlist: [], awaiting: false })
  })

  it('REOPEN + 재고 3: 남은 1등 둘은 그대로, 대기자만 정리', () => {
    const { state } = play([register(15, { stock: 3 }), chat('A', '15'), chat('B', '15'), chat('C', '15'), chat('D', '15'), host('host.reject', 15, 'B')], {
      'cancel.succession': 'REOPEN',
    })
    expect(product(state, 15)).toEqual({ status: 'OPEN', winners: ['A', 'C'], waitlist: [], awaiting: false })
    expect(claimsOf(state).at(-1)).toEqual(['b1/15', 'D', 'REJECTED', 'WAITLIST_CLEARED'])
  })

  it('보류·대기 찜 무효는 BY_HOST, 승계 없음', () => {
    const { state } = play([chat('P', '15'), register(16), chat('A', '16'), chat('B', '16'), host('host.reject', 15, 'P'), host('host.reject', 16, 'B')])
    expect(claimsOf(state)).toEqual([
      ['b1/15', 'P', 'REJECTED', 'BY_HOST'],
      ['b1/16', 'A', 'CONFIRMED', null],
      ['b1/16', 'B', 'REJECTED', 'BY_HOST'],
    ])
  })
})

describe('시청자 취소 요청 (AC-S02-54)', () => {
  it('요청한 찜이 차단·무효로 끝나면 요청도 사라진다', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '15'), chat('B', '15 취소'), chat('A', '15 취소'), { type: 'host.blockBuyer', buyer: 'B', reason: 'x' }, host('host.reject', 15, 'A')])
    expect(listCancelRequests(state)).toEqual([])
  })

  it('요청을 거절한 뒤 다시 요청하면 새 요청이 생긴다', () => {
    const { state } = play([
      register(15),
      chat('A', '15'),
      chat('A', '15 취소'),
      { type: 'host.dismissCancel', b: 'b1', no: 15, buyer: 'A' },
      chat('A', '15 취소요'),
    ])
    expect(listCancelRequests(state).map((r) => [r.buyer, r.seq])).toEqual([['A', 5]])
  })

  it('AUTO: 잠긴 확정 찜에 이미 요청이 있으면 그대로 하나', () => {
    const { state } = play(
      [register(15), chat('A', '15'), { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A' }, chat('A', '15 취소'), chat('A', '15 취소요')],
      { 'cancel.buyerChat': 'AUTO' },
    )
    expect(listCancelRequests(state).map((r) => [r.buyer, r.seq])).toEqual([['A', 4]])
  })
})

describe('수동 조치 (AC-S02-60~62)', () => {
  it('교체: 빈 자리가 있어도 교체를 적었으면 교체한다 (재고 2)', () => {
    const { state } = play([
      register(15, { stock: 2 }),
      chat('A', '15'),
      chat('X', '안녕'),
      { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r', replace: 'A', replaceTo: 'CANCEL' },
    ])
    expect(product(state, 15)).toEqual({ status: 'OPEN', winners: ['X'], waitlist: [], awaiting: false })
  })

  it('교체(대기로) + 대기 한도 0: 밀려난 1등이 바로 품절', () => {
    const { state } = play(
      [register(15), chat('A', '15'), chat('X', '안녕'), { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' }],
      { 'waitlist.max': 0 },
    )
    expect(claimsOf(state)).toEqual([
      ['b1/15', 'A', 'REJECTED', 'SOLD_OUT'],
      ['b1/15', 'X', 'CONFIRMED', null],
    ])
  })

  it('교체로 대기에 들어간 1등이 나중에 다시 확정되면 새 확정버전의 효과를 받는다', () => {
    const { state } = play([
      register(15),
      chat('A', '15'),
      chat('X', '안녕'),
      { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' },
      host('host.cancel', 15, 'X'),
    ])
    expect(product(state, 15)?.winners).toEqual(['A'])
    expect(listEffects(state).map((e) => [e.buyer, e.kind, e.confirmVersion, e.status])).toEqual([
      ['A', 'PRINT_PRODUCT_LABEL', 1, 'CANCELLED'],
      ['A', 'POST_THANKS', 1, 'CANCELLED'],
      ['X', 'PRINT_PRODUCT_LABEL', 2, 'CANCELLED'],
      ['X', 'POST_THANKS', 2, 'CANCELLED'],
      ['A', 'PRINT_PRODUCT_LABEL', 3, 'PENDING'],
      ['A', 'POST_THANKS', 3, 'PENDING'],
    ])
  })

  // "replace만 적은 조치는 아무 일도 없다"는 D-065(한쪽만은 입력 오류)로 바뀌어 교체했다 (AC-S03b-23·93)
  it('assign: 차단된 구매자에게도 배정할 수 있다(방송자의 명시적 조치), 보류 중인 번호는 아무 일도 없다, replace·replaceTo 한쪽만은 입력 오류', () => {
    const blocked = play([register(15), chat('X', '안녕'), { type: 'host.blockBuyer', buyer: 'X', reason: 'r' }, { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r' }])
    expect(product(blocked.state, 15)?.winners).toEqual(['X'])
    const pending = play([chat('A', '15'), { type: 'host.assign', b: 'b1', no: 15, buyer: 'A', reason: 'r' }])
    expect(pending.states[2]).toBe(pending.states[1])
    const base = play([register(15), chat('A', '15'), chat('X', '안녕')]).state
    for (const half of [{ replace: 'A' }, { replaceTo: 'WAITLIST' }, { replaceTo: 'CANCEL' }]) {
      expect(() => applyEvent(base, { type: 'host.assign', b: 'b1', no: 15, buyer: 'X', reason: 'r', ...half, seq: 9, at: T0 + 9000 } as EngineEvent)).toThrow(InvalidEventError)
    }
  })

  describe('차단 중인 구매자의 찜은 대기에 들어가지 않는다 (D-049, TD-S02-001)', () => {
    const block = (buyer: string): EventInput => ({ type: 'host.blockBuyer', buyer, reason: '장난' })
    const unblock = (buyer: string): EventInput => ({ type: 'host.unblockBuyer', buyer, reason: '풀어 줌' })
    const replace = (buyer: string, winner: string, replaceTo: 'WAITLIST' | 'CANCEL'): EventInput => ({ type: 'host.assign', b: 'b1', no: 15, buyer, reason: 'r', replace: winner, replaceTo })

    it('차단한 1등을 대기로 교체 → 차단 거절, 배정받은 사람이 취소돼도 차단한 사람에게 자동 승계·효과가 없다', () => {
      const { state, emitted } = play([register(15), chat('A', '15'), chat('B', '15'), block('A'), replace('B', 'A', 'WAITLIST'), host('host.cancel', 15, 'B')], { 'waitlist.max': 2 })
      expect(claimsOf(state)).toEqual([
        ['b1/15', 'A', 'REJECTED', 'BLOCKED'],
        ['b1/15', 'B', 'CANCELLED', null],
      ])
      expect(product(state, 15)).toEqual({ status: 'OPEN', winners: [], waitlist: [], awaiting: false })
      // B 취소 때 새로 나온 효과가 없다. A의 효과는 확정버전 1뿐이고 모두 취소
      expect(emitted[5]).toEqual([])
      expect(listEffects(state).filter((e) => e.buyer === 'A').map((e) => [e.kind, e.confirmVersion, e.status])).toEqual([
        ['PRINT_PRODUCT_LABEL', 1, 'CANCELLED'],
        ['POST_THANKS', 1, 'CANCELLED'],
      ])
    })

    it('대기가 꽉 찼을 때 차단한 1등(라벨 출력됨)을 대기로 교체 → 라벨 폐기, 대기자는 그대로(맨 끝 품절 없음)', () => {
      const { state } = play(
        [register(15), chat('A', '15'), chat('B', '15'), chat('C', '15'), chat('D', '안녕'), { type: 'effect.labelPrinted', effectId: 'c1:PRINT_PRODUCT_LABEL:-:1' }, block('A'), replace('D', 'A', 'WAITLIST')],
        { 'waitlist.max': 2 },
      )
      expect(product(state, 15)).toEqual({ status: 'SOLD', winners: ['D'], waitlist: ['B', 'C'], awaiting: false })
      expect(claimsOf(state)).toEqual([
        ['b1/15', 'A', 'REJECTED', 'BLOCKED'],
        ['b1/15', 'B', 'WAITLISTED', null],
        ['b1/15', 'C', 'WAITLISTED', null],
        ['b1/15', 'D', 'CONFIRMED', null],
      ])
      expect(listEffects(state).filter((e) => e.kind === 'VOID_LABEL').map((e) => [e.buyer, e.confirmVersion, e.status])).toEqual([['A', 1, 'PENDING']])
    })

    it('대기 한도 0에서도 차단한 1등은 품절이 아니라 차단 거절', () => {
      const { state } = play([register(15), chat('A', '15'), chat('X', '안녕'), block('A'), replace('X', 'A', 'WAITLIST')], { 'waitlist.max': 0 })
      expect(claimsOf(state)).toEqual([
        ['b1/15', 'A', 'REJECTED', 'BLOCKED'],
        ['b1/15', 'X', 'CONFIRMED', null],
      ])
    })

    it('배정받는 사람의 대기 찜이 빠지고 차단한 1등은 들어가지 않는다 — 다음 대기자가 1순위', () => {
      const { state } = play([register(15), chat('A', '15'), chat('B', '15'), chat('C', '15'), block('A'), replace('C', 'A', 'WAITLIST')], { 'waitlist.max': 2 })
      expect(product(state, 15)).toEqual({ status: 'SOLD', winners: ['C'], waitlist: ['B'], awaiting: false })
    })

    it('차단과 교체의 순서가 바뀌어도 그 찜의 결과는 같다 (교체 뒤 차단 → 차단 거절)', () => {
      const blockThenReplace = play([register(15), chat('A', '15'), chat('X', '안녕'), block('A'), replace('X', 'A', 'WAITLIST')])
      const replaceThenBlock = play([register(15), chat('A', '15'), chat('X', '안녕'), replace('X', 'A', 'WAITLIST'), block('A')])
      expect(claimsOf(replaceThenBlock.state)).toEqual(claimsOf(blockThenReplace.state))
      expect(product(replaceThenBlock.state, 15)).toEqual(product(blockThenReplace.state, 15))
    })

    it('취소로 교체하면 차단 여부와 상관없이 CANCELLED, 차단을 푼 뒤 교체는 평소대로 대기 1순위', () => {
      const cancelled = play([register(15), chat('A', '15'), chat('X', '안녕'), block('A'), replace('X', 'A', 'CANCEL')])
      expect(claimsOf(cancelled.state)).toEqual([
        ['b1/15', 'A', 'CANCELLED', null],
        ['b1/15', 'X', 'CONFIRMED', null],
      ])
      const unblocked = play([register(15), chat('A', '15'), chat('X', '안녕'), block('A'), unblock('A'), replace('X', 'A', 'WAITLIST')])
      expect(product(unblocked.state, 15)).toEqual({ status: 'SOLD', winners: ['X'], waitlist: ['A'], awaiting: false })
    })

    it('배정받는 구매자의 차단 여부는 보지 않는다 — 차단된 사람에게 넘기고 차단 안 된 1등은 대기 1순위', () => {
      const { state } = play([register(15), chat('A', '15'), chat('X', '안녕'), block('X'), replace('X', 'A', 'WAITLIST')])
      expect(product(state, 15)).toEqual({ status: 'SOLD', winners: ['X'], waitlist: ['A'], awaiting: false })
    })
  })

  it('promote: 대기 몇 순위든 지정한 사람, 대기가 아닌 사람·없는 번호는 아무 일도 없다', () => {
    const { state, states } = play([
      register(15),
      chat('A', '15'),
      chat('B', '15'),
      chat('C', '15'),
      host('host.cancel', 15, 'A'),
      host('host.promote', 15, 'A'),
      host('host.promote', 99, 'A'),
    ], { 'cancel.succession': 'ASK' })
    expect(states[6]).toBe(states[5])
    expect(states[7]).toBe(states[6])
    expect(product(state, 15)).toEqual({ status: 'OPEN', winners: [], waitlist: ['B', 'C'], awaiting: true })
  })

  it('confirm: 이미 잠긴 찜·대기 찜은 아무 일도 없다', () => {
    const { states } = play([
      register(15),
      chat('A', '15'),
      chat('B', '15'),
      { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A' },
      { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A' },
      { type: 'host.confirm', b: 'b1', no: 15, buyer: 'B' },
    ])
    expect(states[5]).toBe(states[4])
    expect(states[6]).toBe(states[5])
  })

  it('차단: 여러 방송·번호의 대기·보류 찜을 모두 거절, 이미 차단이면·풀린 사람을 다시 풀면 아무 일도 없다', () => {
    const { state, states } = play(
      [
        register(15),
        register(15, { b: 'b2' }),
        chat('A', '15'),
        chat('A', '15', { b: 'b2' }),
        chat('X', '15'),
        chat('X', '15', { b: 'b2' }),
        chat('X', '16', { b: 'b2' }),
        { type: 'host.blockBuyer', buyer: 'X', reason: 'r' },
        { type: 'host.blockBuyer', buyer: 'X', reason: 'r' },
        { type: 'host.unblockBuyer', buyer: 'X', reason: 'r' },
        { type: 'host.unblockBuyer', buyer: 'X', reason: 'r' },
      ],
      {},
      [B1, B2],
    )
    expect(states[9]).toBe(states[8])
    expect(states[11]).toBe(states[10])
    expect(claimsOf(state).filter(([, buyer]) => buyer === 'X')).toEqual([
      ['b1/15', 'X', 'REJECTED', 'BLOCKED'],
      ['b2/15', 'X', 'REJECTED', 'BLOCKED'],
      ['b2/16', 'X', 'REJECTED', 'BLOCKED'],
    ])
  })

  it('엔진이 모르는 채널도 미리 차단할 수 있다', () => {
    const { state } = play([register(15), { type: 'host.blockBuyer', buyer: 'UC_NEW', reason: 'r' }, chat('UC_NEW', '15')])
    expect(claimsOf(state)).toEqual([['b1/15', 'UC_NEW', 'REJECTED', 'BLOCKED']])
  })
})
