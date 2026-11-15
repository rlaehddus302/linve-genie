// 손님의 "패스" (R-3·R-8 "패스", D-RETRO-103·113 — 11-13 방송 13:33 "패스" 한 마디로 대기 1번이 끝까지 남은 일).
// - 번호와 함께("155 패스", "155번 패스요")면 취소 말과 같다 — 번호 취소와 같은 길.
// - 번호 없이 메시지 전체가 "패스"면: 그 손님의 그 방송 살아 있는 찜이 하나뿐일 때만 그 찜을 번호 취소처럼, 둘 이상이면 취소하지 않고 같은 seq의 취소 요청으로 띄운다.
// - "패스트", "이건 패스" 같은 말은 아무 일도 없다.
import { describe, expect, it } from 'vitest'
import { applyEvent, getProduct, isBarePass, listCancelRequests, listClaims, listMessages, parseChat, type EngineEvent, type EngineState } from '@livejjim/core'
import { T0, chat, play, register, type EventInput } from './engine-helpers.ts'

const AUTO = { 'cancel.buyerChat': 'AUTO' } as const
const statusOf = (state: EngineState, buyer: string, no: number): string | undefined => listClaims(state).find((claim) => claim.buyer === buyer && claim.no === no)?.status

describe('채팅 해석: 패스', () => {
  it.each([
    ['155 패스', [155]],
    ['155번 패스', [155]],
    ['155번 패스요', [155]],
    ['155 패스할게요 ㅠㅠ', [155]],
    ['155 패스 할게요', [155]],
    ['155번 패스!', [155]],
  ])('번호와 함께 쓴 "%s"는 취소 %j', (text, cancels) => {
    for (const mode of ['STRICT', 'LOOSE'] as const) expect(parseChat(text, { 'claim.parseMode': mode }), `${text} ${mode}`).toEqual({ claims: [], cancels, mentions: [] })
  })

  it('LOOSE에서 패스 말이 든 메시지는 주문이 아니다 — 옛: "155 패스?"·"155 패스트"가 155번 주문이었다', () => {
    const LOOSE = { 'claim.parseMode': 'LOOSE' } as const
    expect(parseChat('155 패스?', LOOSE)).toEqual({ claims: [], cancels: [], mentions: [155] })
    expect(parseChat('155 패스트', LOOSE)).toEqual({ claims: [], cancels: [], mentions: [155] })
    expect(parseChat('155 패스트', { 'claim.parseMode': 'STRICT' })).toEqual({ claims: [], cancels: [], mentions: [155] })
  })

  it.each(['패스', '패스요', '패스!', '패스 ㅠㅠ', '패스할게요', '패스 할게요', '패스합니다', '  패스  ', '패스😭'])('번호 없는 "%s"는 패스', (text) => {
    expect(isBarePass(text)).toBe(true)
    expect(parseChat(text)).toEqual({ claims: [], cancels: [], mentions: [] })
  })

  it.each(['패스트', '패스트푸드', '이건 패스', '저 패스', '패스하고 15번', '패스?', '패스 🤔', '@별빛 패스', '패스워드', '패스요요', '', '취소', 'pass'])('"%s"는 패스가 아니다', (text) => {
    expect(isBarePass(text)).toBe(false)
  })

  it('문자열이 아닌 값에도 예외 없이 아니다', () => {
    expect(isBarePass(undefined as unknown as string)).toBe(false)
    expect(isBarePass(155 as unknown as string)).toBe(false)
  })
})

describe('판정: 번호와 함께 쓴 패스는 번호 취소와 같다', () => {
  it('AUTO: "155 패스" — 대기 1번이 취소되고 뒤 대기가 당겨진다', () => {
    const { state } = play([register(155), chat('A', '155'), chat('B', '155'), chat('C', '155'), chat('B', '155 패스')], AUTO)
    expect(statusOf(state, 'B', 155)).toBe('CANCELLED')
    expect(getProduct(state, 'b1', 155)?.winners).toEqual(['A'])
    expect(getProduct(state, 'b1', 155)?.waitlist).toEqual(['C'])
  })

  it('REQUEST(기본): "155번 패스요"는 그 찜의 취소 요청', () => {
    const { state } = play([register(155), chat('A', '155'), chat('A', '155번 패스요')])
    expect(statusOf(state, 'A', 155)).toBe('CONFIRMED')
    expect(listCancelRequests(state).map((request) => [request.buyer, request.product])).toEqual([['A', 'b1/155']])
  })
})

describe('판정: 번호 없는 패스', () => {
  it('11-13 사례: 살아 있는 찜이 155번 대기 하나뿐이면 그 대기가 취소된다(AUTO)', () => {
    const { state } = play([register(155), register(160), chat('A', '155'), chat('B', '155'), chat('C', '155'), chat('B', '160'), chat('A', '160'), chat('B', '160 취소'), chat('B', '패스')], AUTO)
    // B의 160번은 이미 취소 — 살아 있는 찜은 155번 대기 하나
    expect(statusOf(state, 'B', 155)).toBe('CANCELLED')
    expect(getProduct(state, 'b1', 155)?.waitlist).toEqual(['C'])
    expect(listCancelRequests(state)).toEqual([])
  })

  it('찜 하나 + REQUEST: 그 찜의 취소 요청 하나(번호 취소와 같다)', () => {
    const { state } = play([register(155), chat('A', '155'), chat('A', '패스')])
    expect(statusOf(state, 'A', 155)).toBe('CONFIRMED')
    expect(listCancelRequests(state).map((request) => request.claim)).toEqual([listClaims(state)[0]?.id])
  })

  it('보류 찜 하나도 살아 있는 찜이다 — 취소된다', () => {
    const { state } = play([chat('A', '155'), chat('A', '패스')], AUTO)
    expect(statusOf(state, 'A', 155)).toBe('CANCELLED')
  })

  it('찜이 둘 이상이면 취소하지 않고, 그 찜마다 같은 seq의 취소 요청만 건다(AUTO여도)', () => {
    const { state } = play([register(155), register(160), chat('A', '155'), chat('B', '155'), chat('B', '160'), chat('B', '패스')], AUTO)
    expect(statusOf(state, 'B', 155)).toBe('WAITLISTED')
    expect(statusOf(state, 'B', 160)).toBe('CONFIRMED')
    const requests = listCancelRequests(state)
    expect(requests.map((request) => request.product).sort()).toEqual(['b1/155', 'b1/160'])
    expect(new Set(requests.map((request) => request.seq))).toEqual(new Set([6]))
    expect(requests.every((request) => request.buyer === 'B' && !request.chooseVariant)).toBe(true)
  })

  it('찜 여럿의 요청 중 하나를 승인하고 나머지는 무시하면 고른 찜만 취소된다', () => {
    const { state } = play([register(155), register(160), chat('A', '155'), chat('B', '155'), chat('B', '160'), chat('B', '패스')], AUTO)
    const approve = applyEvent(state, { seq: 7, at: T0 + 7000, type: 'host.approveCancel', b: 'b1', no: 155, buyer: 'B' } as EngineEvent).state
    const done = applyEvent(approve, { seq: 8, at: T0 + 8000, type: 'host.dismissCancel', b: 'b1', no: 160, buyer: 'B' } as EngineEvent).state
    expect(statusOf(done, 'B', 155)).toBe('CANCELLED')
    expect(statusOf(done, 'B', 160)).toBe('CONFIRMED')
    expect(listCancelRequests(done)).toEqual([])
  })

  it('이미 요청이 걸린 찜의 요청은 그대로 두고(먼저 받은 seq), 아직 없는 찜에만 건다', () => {
    const { state } = play([register(155), register(160), chat('B', '155'), chat('B', '160'), chat('B', '155 취소'), chat('B', '패스')])
    const bySeq = Object.fromEntries(listCancelRequests(state).map((request) => [request.product, request.seq]))
    expect(bySeq).toEqual({ 'b1/155': 5, 'b1/160': 6 })
  })

  it('살아 있는 찜이 없거나 다른 방송에만 있으면 아무 일도 없다', () => {
    const none = play([register(155), chat('A', '155'), chat('B', '패스')], AUTO)
    expect(statusOf(none.state, 'A', 155)).toBe('CONFIRMED')
    expect(listCancelRequests(none.state)).toEqual([])
    const other = play([register(155, { b: 'b2' }), chat('A', '155', { b: 'b2' }), chat('A', '패스')], AUTO, [
      { id: 'b1', date: '2026-10-18', title: '1부' },
      { id: 'b2', date: '2026-10-18', title: '2부' },
    ])
    expect(statusOf(other.state, 'A', 155)).toBe('CONFIRMED')
  })

  it('cancel.buyerChat=OFF면 번호 취소처럼 아무 일도 없다', () => {
    const { state } = play([register(155), chat('A', '155'), chat('A', '패스')], { 'cancel.buyerChat': 'OFF' })
    expect(statusOf(state, 'A', 155)).toBe('CONFIRMED')
    expect(listCancelRequests(state)).toEqual([])
  })

  it('"패스트"·"이건 패스"는 찜이 하나여도 아무 일도 없다', () => {
    for (const text of ['패스트', '이건 패스', '패스?']) {
      const { state } = play([register(155), chat('A', '155'), chat('A', text)], AUTO)
      expect(statusOf(state, 'A', 155), text).toBe('CONFIRMED')
      expect(listCancelRequests(state), text).toEqual([])
    }
  })

  it('패스 메시지는 취소였던 메시지라 어느 번호로도 찜으로 바꾸지 않는다 (D-076)', () => {
    const events: EventInput[] = [register(155), register(160), chat('A', '패스', { id: 'mp' })]
    const { state } = play(events, AUTO)
    expect(listMessages(state).find((message) => message.id === 'mp')?.cancel).toBe(true)
    const converted = applyEvent(state, { seq: 9, at: T0 + 9000, type: 'host.convertMessage', b: 'b1', msg: 'mp', no: 155 } as EngineEvent)
    expect(converted.state).toBe(state)
  })

  it('방송자 본인 메시지(claim.ignoreOwner)의 패스는 무시한다', () => {
    const { state } = play([register(155), chat('A', '155'), chat('A', '패스', { owner: true })], { ...AUTO, 'claim.ignoreOwner': true })
    expect(statusOf(state, 'A', 155)).toBe('CONFIRMED')
  })
})
