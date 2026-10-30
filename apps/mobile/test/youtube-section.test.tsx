// 콘솔 유튜브 (YT-11 AC2·AC5·AC6·AC8, D-YT-SRV-03·06·07·09): 구글 연결 없이 잇기(최근 채널·주소), 처음 잇는 채널 확인,
// "유튜브 방송 · {이름}", "서버 연결로 받는 중", 막힘 바로 경고 + 대비 경로, 다시 받으면 한 줄, 운영자 끔, 거절 문장.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CollectorView, LinkView, LiveBroadcastItem } from '@livejjim/web/src/api/types.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush, product } from './support.ts'

const BLOCKED = '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.'
const OFF = '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'
const NOT_PUBLIC = '로그인 없이 볼 수 있는 방송만 이을 수 있어요. 공개나 일부공개로 바꿔 주세요.'
const RESUMED = '유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.'

const collector = (patch: Partial<CollectorView> = {}): CollectorView => ({
  status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, mode: 'WEB', lastMessageAt: null, recorded: 3, skippedBeforeLink: 0, gap: false, gapMessage: null, restartable: false, ...patch,
})
const linked = (title: string, patch: Partial<CollectorView> = {}): LinkView => ({
  link: { videoId: 'VIDEOKNOWN1', channelId: 'UC_K', broadcastChannelId: 'UC_K', broadcastChannelTitle: title, invited: false, linkedAt: '2026-10-29T10:00:00.000Z', chatEnded: false },
  collector: collector(patch),
})
const item: LiveBroadcastItem = { videoId: 'LIVENOW0001', title: '오늘 경매', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC_K', channelTitle: '다육이네' }

function youtubeWorld(options: { webChat?: { on: boolean } | null; recent?: LiveBroadcastItem[] } = {}) {
  const world = makeWorld({ products: [product(15)] })
  const state = { link: { link: null, collector: null } as LinkView }
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: options.webChat === undefined ? { on: true } : options.webChat, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: state.link }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: options.recent ?? [] } }))
  world.server.on('POST', /^\/api\/broadcasts\/b1\/youtube$/, (call) => {
    if (call.body?.video === 'PRIVATE0001') return { status: 409, body: { error: { code: 'YOUTUBE_NOT_PUBLIC', message: NOT_PUBLIC } } }
    if (call.body?.video === 'NEWCHAN0001' && call.body.confirmInvited !== true) return { status: 409, body: { error: { code: 'INVITED_CONFIRM_NEEDED', message: '처음 잇는 채널이에요. 이 방송이 맞나요?' }, channel: { id: 'UC_N', title: '<b>새채널</b>' } } }
    state.link = linked(call.body?.video === 'NEWCHAN0001' ? '<b>새채널</b>' : '다육이네')
    return { body: state.link }
  })
  return { world, state }
}

async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush(10)
  })
}

const section = () => screen.getByRole('group', { name: '유튜브' })

describe('콘솔 유튜브 (앱)', () => {
  it('구글 연결 없이 최근 채널 [잇기] → "유튜브 방송 · 다육이네"·"서버 연결로 받는 중", 찾기는 칸을 열 때 한 번', async () => {
    const { world } = youtubeWorld({ recent: [item] })
    await open(world)
    const box = await screen.findByRole('group', { name: '최근 이은 채널의 방송' })
    expect(within(box).getByText(/다육이네 · 오늘 경매 · 방송 중/)).toBeTruthy()
    expect(world.server.callsTo('GET', /live-broadcasts/)).toHaveLength(1)
    fireEvent.click(within(box).getByRole('button', { name: '다육이네 · 오늘 경매 잇기' }))
    await waitFor(() => expect(within(section()).getByText('유튜브 방송 · 다육이네')).toBeTruthy())
    expect(section().textContent).toContain('서버 연결로 받는 중')
    expect(section().textContent).not.toMatch(/WEB|LIVE|STREAM/)
    expect(world.server.callsTo('POST', /\/youtube$/)[0]?.body).not.toHaveProperty('confirmInvited')
  })

  it('처음 잇는 채널: 확인 줄 → [맞아요, 잇기]는 확인 표시로 다시 보낸다, 이름은 글자로만', async () => {
    const { world } = youtubeWorld()
    await open(world)
    fireEvent.change(await screen.findByRole('textbox', { name: '주소 붙여넣기' }), { target: { value: 'NEWCHAN0001' } })
    fireEvent.click(screen.getByRole('button', { name: '이 방송에 잇기' }))
    const ask = await screen.findByRole('group', { name: '처음 잇는 채널 확인' })
    expect(ask.textContent).toContain('처음 잇는 채널이에요 (채널: <b>새채널</b>). 이 방송이 맞나요?')
    fireEvent.click(within(ask).getByRole('button', { name: '맞아요, 잇기' }))
    await waitFor(() => expect(within(section()).getByText('유튜브 방송 · <b>새채널</b>')).toBeTruthy())
    expect(document.querySelector('b')).toBeNull()
    expect(world.server.callsTo('POST', /\/youtube$/)[1]?.body).toMatchObject({ video: 'NEWCHAN0001', confirmInvited: true })
  })

  it('비공개 방송은 서버 문장으로 거절', async () => {
    const { world } = youtubeWorld()
    await open(world)
    fireEvent.change(await screen.findByRole('textbox', { name: '주소 붙여넣기' }), { target: { value: 'PRIVATE0001' } })
    fireEvent.click(screen.getByRole('button', { name: '이 방송에 잇기' }))
    await waitFor(() => expect(within(section()).getByRole('alert').textContent).toBe(NOT_PUBLIC))
  })

  it('막힘은 바로 맨 위 경고 + 대비 경로, 다시 받으면 경고를 내리고 "다시 받고 있어요"', async () => {
    const { world, state } = youtubeWorld()
    state.link = linked('다육이네')
    await open(world)
    await waitFor(() => expect(within(section()).getByText('유튜브 방송 · 다육이네')).toBeTruthy())
    const emit = async (patch: Partial<CollectorView>) => {
      state.link = { ...state.link, collector: collector(patch) }
      await act(async () => {
        world.source().emit('youtube', { kind: 'collector', broadcast: 'b1', date: '2026-10-29', collector: collector(patch) })
        await flush(5)
      })
    }
    await emit({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'BLOCKED', reasonMessage: BLOCKED })
    const warning = screen.getByRole('alert', { name: '유튜브 채팅 경고' })
    expect(warning.textContent).toBe(BLOCKED)
    expect(screen.getByText('아래 문자찜 칸이나 음성으로 넣을 수 있어요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '댓글 붙여넣기 (웹으로 열기)' })).toBeTruthy()
    await emit({ status: 'LIVE' })
    expect(screen.queryByRole('alert', { name: '유튜브 채팅 경고' })).toBeNull()
    expect(within(section()).getByText(RESUMED)).toBeTruthy()
    fireEvent.click(within(section()).getByRole('button', { name: '확인했어요' }))
    expect(within(section()).queryByText(RESUMED)).toBeNull()
  })

  it('운영자가 끄면 잇기 칸 대신 안내 — 최근 채널을 찾지 않는다', async () => {
    const { world } = youtubeWorld({ webChat: { on: false } })
    await open(world)
    await waitFor(() => expect(within(section()).getByText(OFF)).toBeTruthy())
    expect(screen.queryByRole('textbox', { name: '주소 붙여넣기' })).toBeNull()
    expect(world.server.callsTo('GET', /live-broadcasts/)).toHaveLength(0)
  })

  it('리허설은 유튜브 요청을 보내지 않는다', async () => {
    const world = makeWorld({ products: [], rehearsal: true })
    await open(world)
    expect(world.server.calls.filter((call) => call.path.includes('youtube'))).toHaveLength(0)
    expect(screen.queryByRole('group', { name: '유튜브' })).toBeNull()
  })
})
