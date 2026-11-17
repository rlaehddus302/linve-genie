// 손님의 "패스" (D-RETRO-103·113): 번호 없는 "패스"인데 찜이 둘 이상이면 엔진이 그 찜마다 같은 seq의 취소 요청을 건다.
// 방송 화면의 정하기는 그 요청들을 한 장("패스 — ○○")으로 묶어 고른 찜만 취소하고 나머지는 그대로 둔다. 단추는 [취소하지 않기 | 고른 찜 취소].
// 채팅·문자 탭은 그 메시지에 "패스" 꼬리표를 단다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CancelRequest, MessagesView } from '@livejjim/web/src/api/types.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { PASS_CANCEL, PASS_KEEP, passGroup, passWords } from '../src/screens/console/Decisions.tsx'
import { PASS_TAG, chatResult } from '../src/screens/console/LiveTalk.tsx'
import type { ScopeData } from '../src/lib/scope-data.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

const request = (claimId: string, no: number, buyerId: string, seq: number, extra: Partial<CancelRequest> = {}): CancelRequest =>
  ({ product: `b1/${String(no)}`, buyer: buyerId, currentBuyer: buyerId, claim: claimId, chooseVariant: false, choices: [claimId], seq, ...extra }) as CancelRequest

describe('패스 요청 묶음 (passGroup)', () => {
  it('같은 손님·같은 seq의 찜 요청이 둘 이상이면 묶음, 하나면 보통 취소 요청', () => {
    const a = request('c2', 155, 'u2', 20)
    const b = request('c3', 160, 'u2', 20)
    const other = request('c4', 170, 'u9', 20)
    const single = request('c5', 180, 'u2', 21)
    expect(passGroup([a, b, other, single], b)?.map((item) => item.claim)).toEqual(['c2', 'c3'])
    expect(passGroup([a, b, other, single], single)).toBeNull()
    expect(passGroup([a, b, other, single], other)).toBeNull()
    // 변형을 정하지 않은 요청은 묶지 않는다
    expect(passGroup([a, request('x', 160, 'u2', 20, { chooseVariant: true })], a)).toBeNull()
  })
})

describe('채팅·문자 탭의 "패스" 꼬리표', () => {
  const NO_DATA = { claims: new Map() } as unknown as ScopeData
  const message = (fields: Partial<MessagesView['messages'][number]>): MessagesView['messages'][number] => ({
    id: 'm1', broadcast: 'b1', channel: 'u2', nick: '한강', text: '패스', owner: false, seq: 20, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z',
    ignored: false, order: false, cancel: true, orders: [], cancels: [], mentions: [], converted: [], claims: [], failed: false, ...fields,
  })
  it('번호 없는 패스는 "패스", 번호와 함께 쓴 패스는 "155번 취소"', () => {
    expect(chatResult(message({ pass: true }), NO_DATA).map((tag) => tag.word)).toEqual([PASS_TAG])
    expect(chatResult(message({ text: '155 패스', cancels: [155] }), NO_DATA).map((tag) => tag.word)).toEqual(['155번 취소'])
  })
})

describe('정하기: 패스 한 장', () => {
  async function openWith(world: ReturnType<typeof makeWorld>) {
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
  }

  function passWorld() {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
      body: fullView({
        seq: world.seq,
        products: [
          product(155, { status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] }),
          product(160, { status: 'SOLD', winners: ['u2'], winnerClaims: ['c3'] }),
        ],
        claims: [claim('c1', 155, 'u1'), claim('c2', 155, 'u2', { status: 'WAITLISTED', seq: 12 }), claim('c3', 160, 'u2', { seq: 13 })],
        buyers: [buyer('u1', '별빛'), buyer('u2', '한강')],
        cancelRequests: [request('c2', 155, 'u2', 20), request('c3', 160, 'u2', 20)] as never,
      }),
    }))
    world.server.on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 20 } }))
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
    return world
  }

  it('"한강님이 패스라고 썼어요"와 두 찜 — 고른 찜만 취소 승인, 나머지는 요청 무시. 고르기 전에는 취소 단추가 잠겨 있다', async () => {
    const world = passWorld()
    await openWith(world)
    // D-PRINTOFF-01: 알림 문구 "찜 취소 요청 n건"(옛 "취소 요청 n건")
    fireEvent.click(await screen.findByRole('button', { name: '찜 취소 요청 2건' }))
    const card = await screen.findByRole('group', { name: '패스 — 한강' })
    expect(card.textContent).toContain(passWords('한강'))
    // 단추는 좌우: 부정(취소하지 않기) 왼쪽 · 긍정(고른 찜 취소) 오른쪽
    const buttons = within(card).getAllByRole('button').filter((node) => node.getAttribute('aria-label') === PASS_KEEP || node.getAttribute('aria-label') === PASS_CANCEL)
    expect(buttons.map((node) => node.getAttribute('aria-label'))).toEqual([PASS_KEEP, PASS_CANCEL])
    expect(within(card).getByRole('button', { name: PASS_CANCEL }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(card).getByRole('button', { name: /^취소할 찜 155번/ }))
    fireEvent.click(within(card).getByRole('button', { name: PASS_CANCEL }))
    await waitFor(() => expect(world.events.filter((call) => call.body?.type === 'host.approveCancel' || call.body?.type === 'host.dismissCancel')).toHaveLength(2))
    expect(world.events.find((call) => call.body?.type === 'host.approveCancel')?.body).toMatchObject({ b: 'b1', no: 155, buyer: 'u2' })
    expect(world.events.find((call) => call.body?.type === 'host.dismissCancel')?.body).toMatchObject({ b: 'b1', no: 160, buyer: 'u2' })
  })

  it('[취소하지 않기]는 두 요청을 모두 무시한다 — 찜은 그대로', async () => {
    const world = passWorld()
    await openWith(world)
    // D-PRINTOFF-01: 알림 문구 "찜 취소 요청 n건"(옛 "취소 요청 n건")
    fireEvent.click(await screen.findByRole('button', { name: '찜 취소 요청 2건' }))
    const card = await screen.findByRole('group', { name: '패스 — 한강' })
    fireEvent.click(within(card).getByRole('button', { name: PASS_KEEP }))
    await waitFor(() => expect(world.events.filter((call) => call.body?.type === 'host.dismissCancel')).toHaveLength(2))
    expect(world.events.some((call) => call.body?.type === 'host.approveCancel')).toBe(false)
  })
})
