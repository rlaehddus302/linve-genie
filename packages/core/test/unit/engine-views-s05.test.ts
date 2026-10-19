// S05 코어 조회 함수 둘 (AC-S05-20·80, D-086 — dev-server가 더한 순수 조회).
// listBlocked: 차단 중인 구매자 ID 전부(미리 차단한 채널 포함), ID 사전 순. listMessages: 받은 메시지마다 엔진 기록, seq 순.
// 두 함수는 상태를 읽기만 한다 — 판정·상태 형식·기존 조회가 그대로인지도 본다.
import { applyEvent, initEngine, listBlocked, listBuyers, listMessages, parseChat, type EngineEvent, type EngineState, type SettingsOverride } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { B1, B2, T0, chat, play, register, type EventInput } from './engine-helpers.ts'

const block = (buyer: string): EventInput => ({ type: 'host.blockBuyer', buyer, reason: '장난 찜' })
const unblock = (buyer: string): EventInput => ({ type: 'host.unblockBuyer', buyer, reason: '풀어 줌' })

describe('listBlocked (AC-S05-80)', () => {
  it('빈 상태는 빈 목록', () => {
    expect(listBlocked(initEngine({ broadcasts: [B1], settings: {} }))).toEqual([])
  })

  it('구매자로 기록된 적 없는 미리 차단한 채널도 들어가고, 푼 차단은 빠진다 — ID 사전 순', () => {
    const { state } = play([chat('UCb', '안녕'), block('UCz'), block('UCb'), block('UCa'), block('pre_only'), unblock('UCa'), block('UC_')])
    // 코드 단위 순: 'U'(0x55) < 'p'(0x70), 'C' 다음 '_'(0x5f) < 'b'(0x62) < 'z'
    expect(listBlocked(state)).toEqual(['UC_', 'UCb', 'UCz', 'pre_only'])
    // listBuyers는 기록된 구매자만 안다 — 미리 차단한 채널은 listBlocked에만 있다
    expect(listBuyers(state).map((b) => [b.id, b.blocked])).toEqual([['UCb', true]])
  })

  it('한글·숫자·대소문자 ID도 코드 단위 사전 순이다 (localeCompare 아님)', () => {
    const { state } = play([block('가나'), block('b'), block('B'), block('10'), block('9')])
    expect(listBlocked(state)).toEqual(['10', '9', 'B', 'b', '가나'])
  })

  it('상태를 바꾸지 않고 부를 때마다 새 배열이다', () => {
    const { state } = play([block('UCa')])
    const before = JSON.stringify(state)
    const first = listBlocked(state)
    first.push('바꿈')
    expect(listBlocked(state)).toEqual(['UCa'])
    expect(JSON.stringify(state)).toBe(before)
  })

  it('무작위 차단·풀기 순서에서 마지막 상태와 같다 (모델 비교)', () => {
    const ids = ['UCa', 'UCb', 'UCc', 'x1', '가']
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.constantFrom(...ids)), { maxLength: 30 }), (steps) => {
        const model = new Set<string>()
        const events: EventInput[] = []
        for (const [on, id] of steps) {
          events.push(on ? block(id) : unblock(id))
          if (on) model.add(id)
          else model.delete(id)
        }
        const { state } = play(events)
        expect(listBlocked(state)).toEqual([...model].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      }),
      { numRuns: 60 },
    )
  })
})

describe('listMessages (AC-S05-20)', () => {
  it('빈 상태는 빈 목록', () => {
    expect(listMessages(initEngine({ broadcasts: [B1], settings: {} }))).toEqual([])
  })

  it('메시지마다 방송·ID·채널·seq·at·게시 시각·무시·주문·취소·바꾼 번호, seq 순', () => {
    const { state } = play(
      [
        register(15), // 1
        chat('A', '15', { id: 'm-order' }), // 2
        chat('B', '15번 예뻐요', { id: 'm-mention', publishedAt: T0 - 500 }), // 3
        chat('A', '15 취소', { id: 'm-cancel' }), // 4
        chat('O', '15', { id: 'm-owner', owner: true }), // 5
        chat('C', '안녕하세요', { id: 'm-talk', b: 'b2' }), // 6
        { type: 'host.convertMessage', b: 'b1', msg: 'm-mention', no: 15 }, // 7
        chat('B', '바뀐 본문', { id: 'm-mention' }), // 8 재수신 — 기록이 바뀌지 않는다
      ],
      {},
      [B1, B2],
    )
    expect(listMessages(state)).toEqual([
      { broadcast: 'b1', id: 'm-order', channel: 'A', seq: 2, at: T0 + 1000, publishedAt: T0 + 1000, ignored: false, order: true, cancel: false, converted: [] },
      { broadcast: 'b1', id: 'm-mention', channel: 'B', seq: 3, at: T0 + 2000, publishedAt: T0 - 500, ignored: false, order: false, cancel: false, converted: [15] },
      { broadcast: 'b1', id: 'm-cancel', channel: 'A', seq: 4, at: T0 + 3000, publishedAt: T0 + 3000, ignored: false, order: false, cancel: true, converted: [] },
      { broadcast: 'b1', id: 'm-owner', channel: 'O', seq: 5, at: T0 + 4000, publishedAt: T0 + 4000, ignored: true, order: false, cancel: false, converted: [] },
      { broadcast: 'b2', id: 'm-talk', channel: 'C', seq: 6, at: T0 + 5000, publishedAt: T0 + 5000, ignored: false, order: false, cancel: false, converted: [] },
    ])
  })

  it('방송자 무시를 끈 방송의 방송자 메시지는 주문으로 기록된다 (그 방송의 설정)', () => {
    const { state } = play([register(15), chat('O', '15', { id: 'm1', owner: true })], { 'claim.ignoreOwner': false })
    expect(listMessages(state).map((m) => [m.id, m.ignored, m.order])).toEqual([['m1', false, true]])
  })

  it('메시지 ID·방송 ID에 따옴표·대괄호가 있어도 그대로 돌려준다', () => {
    const odd = '"],["x'
    const { state } = play([chat('A', '안녕', { id: odd, b: 'b1' })])
    expect(listMessages(state).map((m) => [m.broadcast, m.id])).toEqual([['b1', odd]])
  })

  it('돌려준 바꾼 번호 배열을 고쳐도 상태는 그대로다', () => {
    const { state } = play([register(15), chat('B', '15번 예뻐요', { id: 'm1' }), { type: 'host.convertMessage', b: 'b1', msg: 'm1', no: 15 }])
    const before = JSON.stringify(state)
    const [message] = listMessages(state)
    ;(message?.converted as number[]).push(99)
    expect(listMessages(state)[0]?.converted).toEqual([15])
    expect(JSON.stringify(state)).toBe(before)
  })

  it('무작위 채팅에서 주문·취소는 그 방송 설정의 parseChat과 같고 무시한 방송자 메시지는 둘 다 아니다 (STRICT·LOOSE)', () => {
    const words = ['15', '15번', '찜15', '15 취소', '15번 예뻐요', '3개 남았나요?', '1 2', '안녕', '15 1000원', '1000번', '십오번', '15 16 취소', '15번이요']
    fc.assert(
      fc.property(
        fc.constantFrom<SettingsOverride>({}, { 'claim.parseMode': 'LOOSE' }, { 'claim.ignoreOwner': false }, { 'claim.maxNumber': 20, 'claim.multiNumber': 'IGNORE' }),
        fc.array(fc.tuple(fc.constantFrom(...words), fc.boolean(), fc.constantFrom('A', 'B', 'C')), { minLength: 1, maxLength: 25 }),
        (settings, lines) => {
          let state: EngineState = initEngine({ broadcasts: [B1], settings })
          state = applyEvent(state, { type: 'product.register', b: 'b1', no: 15, name: '', price: 10000, seq: 1, at: T0 } as EngineEvent).state
          lines.forEach(([text, owner, ch], i) => {
            state = applyEvent(state, { type: 'chat', b: 'b1', id: `r${String(i)}`, ch, nick: ch, text, owner, seq: i + 2, at: T0 + i } as EngineEvent).state
          })
          const messages = listMessages(state)
          expect(messages.map((m) => m.seq)).toEqual(lines.map((_, i) => i + 2))
          messages.forEach((message, i) => {
            const [text, owner] = lines[i] as [string, boolean, string]
            const ignored = owner && settings['claim.ignoreOwner'] !== false
            const parsed = parseChat(text, settings)
            expect(message.ignored).toBe(ignored)
            expect(message.order).toBe(!ignored && parsed.claims.length > 0)
            expect(message.cancel).toBe(!ignored && parsed.cancels.length > 0)
          })
        },
      ),
      { numRuns: 80 },
    )
  })
})
