// D-RECENT-TT-01 (판매자 보고 2026-11-17 "라이브 링크 넣는 화면에 최근 연결한 채널에 틱톡은 없음"): 최근 연결한 채널 목록에
// 최근 이은 틱톡 계정도 이은 때 차례로 섞어(합쳐 5줄) 보인다 — 줄마다 틱톡 프로필 사진(모르면 틱톡 그림) · 닉네임(모르면 @아이디, D-RECENT-TT-02) · "틱톡" · [연결](라이브 아님이면 없음).
// [연결]은 그 계정의 라이브 주소를 칸에 넣고 [다음]을 누른 것과 같다(틱톡 링크 잇기 — 동의 안내·옮기기 묻기도 그대로). 옛 서버(틱톡 칸 없음)는 전과 같다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { NO_LIVE_NOW, RECENT_CHANNELS_TITLE, RECENT_TIKTOK_SUB, TIKTOK_MOVE_QUESTION, mergeRecent, tiktokLiveUrl } from '../src/screens/console/YoutubeSection.tsx'
import { makeWorld } from './screen-support.tsx'

const CONNECTION = { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true }
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 3, minute)).toISOString()
const live = (videoId: string, channelId: string, channelTitle: string) => ({ videoId, title: '오늘 방송', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId, channelTitle })

function world(tiktok: readonly Record<string, unknown>[] | undefined, channels: readonly Record<string, unknown>[] = []) {
  const w = makeWorld({ products: [] })
  w.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: CONNECTION }))
  w.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
  w.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({
    body: { broadcasts: [live('LIVEVIDEO02', 'UC2', '두째네')], channels, ...(tiktok === undefined ? {} : { tiktok }) },
  }))
  w.server.on('GET', /^\/api\/broadcasts\/b7\/tiktok\/avatar$/, () => ({ body: { avatar: PHOTO } }))
  return w
}
const rowsOf = async () => within(await screen.findByRole('group', { name: RECENT_CHANNELS_TITLE })).findAllByTestId('recent-live')
const names = (rows: readonly HTMLElement[]) => rows.map((row) => within(row).getByTestId('recent-live-channel').textContent)

describe('최근 연결한 채널에 틱톡 계정 (D-RECENT-TT-01)', () => {
  it('섞는 차례: 각자 차례를 지키며 이은 때가 늦은 것이 먼저, 합쳐 5줄 — 유튜브 이은 때를 모르면 유튜브가 먼저', () => {
    const ch = (id: string, minute?: number) => ({ id, ...(minute === undefined ? {} : { linkedAt: at(minute) }) })
    const tt = (id: string, minute: number) => ({ id, linkedAt: at(minute) })
    const merged = mergeRecent([ch('Y1', 50), ch('Y2', 30), ch('Y3', 10)], [tt('T1', 40), tt('T2', 20), tt('T3', 5)])
    expect(merged.map((row) => row.value.id)).toEqual(['Y1', 'T1', 'Y2', 'T2', 'Y3'])
    expect(mergeRecent([ch('Y1'), ch('Y2')], [tt('T1', 40)]).map((row) => row.value.id)).toEqual(['Y1', 'Y2', 'T1'])
    expect(mergeRecent([], [tt('T1', 40)]).map((row) => row.kind)).toEqual(['tiktok'])
    expect(tiktokLiveUrl('shop.two')).toBe('https://www.tiktok.com/@shop.two/live')
  })

  it('유튜브 채널과 틱톡 계정을 이은 때 차례로(5줄까지) — 틱톡 줄은 프로필 사진(모르면 틱톡 그림) · @아이디 · "틱톡" · [연결]', async () => {
    const w = world(
      [
        { tiktokId: 'shop.two', linkedAt: at(40), linkedBroadcast: null, photoBroadcast: 'b7' },
        { tiktokId: 'shop_one', linkedAt: at(20), linkedBroadcast: 'b3', photoBroadcast: null },
        { tiktokId: 'bad id', linkedAt: at(15), linkedBroadcast: null, photoBroadcast: null },
        { tiktokId: 'shop.old', linkedAt: at(1), linkedBroadcast: null, photoBroadcast: null },
      ],
      [
        { channelId: 'UC1', channelTitle: '첫째네', videoId: null, linkedAt: at(50) },
        { channelId: 'UC2', channelTitle: '두째네', videoId: 'LIVEVIDEO02', linkedAt: at(30) },
        { channelId: 'UC3', channelTitle: '셋째네', videoId: null, linkedAt: at(10) },
        { channelId: 'UC4', channelTitle: '넷째네', videoId: null, linkedAt: at(5) },
      ],
    )
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const rows = await rowsOf()
    // 주소로 만들 수 없는 아이디는 뺀다. 6번째부터(넷째네·shop.old)는 보이지 않는다
    expect(names(rows)).toEqual(['첫째네', '@shop.two', '두째네', '@shop_one', '셋째네'])
    expect(within(rows[0]!).getByTestId('recent-live-sub').textContent).toBe(NO_LIVE_NOW)
    expect(within(rows[1]!).getByTestId('recent-live-sub').textContent).toBe(RECENT_TIKTOK_SUB)
    expect(within(rows[3]!).getByTestId('recent-live-sub').textContent).toBe('틱톡 · 다른 라이브에 연결돼 있어요')
    // 사진: 서버가 받아 둔 틱톡 프로필 사진(그 회차의 사진 경로), 볼 회차가 없으면 묻지 않고 틱톡 그림
    await waitFor(() => expect(within(rows[1]!).getByTestId('recent-live-avatar').innerHTML).toContain(PHOTO))
    expect(w.server.callsTo('GET', /\/tiktok\/avatar$/)).toHaveLength(1)
    expect(within(rows[3]!).queryByTestId('recent-tiktok-photo')).toBeNull()
    // 틱톡 줄도 [연결]이 있다 (다른 라이브에 이어져 있어도 — 누르면 옮길지 묻는다)
    expect(within(rows[1]!).getByRole('button', { name: '@shop.two 연결' }).getAttribute('aria-disabled')).not.toBe('true')
    expect(within(rows[3]!).getByRole('button', { name: '@shop_one 연결' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  // D-RECENT-TT-02 (판매자 2026-11-23 "틱톡은 왜 채널 사진이랑 이름 안 가져와?" · "틱톡 라이브 지금 진행 중 아닌데 연결 버튼이 떠 있네?")
  it('서버가 준 닉네임을 이름으로, 틱톡이 라이브 아님이라고 하면 [연결] 없이 "지금 라이브 중이 아니에요" — 모르면(null) 지금처럼 [연결]', async () => {
    const w = world([
      { tiktokId: 'shop.two', linkedAt: at(40), linkedBroadcast: null, photoBroadcast: 'b7', live: false, nickname: '다육이 <b>농장</b>' },
      { tiktokId: 'shop_one', linkedAt: at(30), linkedBroadcast: null, photoBroadcast: null, live: true, nickname: '한별 농원' },
      { tiktokId: 'shop.three', linkedAt: at(20), linkedBroadcast: null, photoBroadcast: null, live: null, nickname: null },
      { tiktokId: 'shop.four', linkedAt: at(10), linkedBroadcast: 'b1', photoBroadcast: null, live: false, nickname: '넷째 농원' },
    ])
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const rows = await rowsOf()
    expect(names(rows)).toEqual(['다육이 <b>농장</b>', '한별 농원', '@shop.three', '넷째 농원'])
    // 닉네임은 글자 그대로
    expect(rows[0]!.querySelector('b')).toBeNull()
    expect(within(rows[0]!).getByTestId('recent-live-sub').textContent).toBe(NO_LIVE_NOW)
    expect(within(rows[0]!).queryByRole('button')).toBeNull()
    expect(within(rows[1]!).getByRole('button', { name: '한별 농원 연결' })).toBeTruthy()
    expect(within(rows[1]!).getByTestId('recent-live-sub').textContent).toBe(RECENT_TIKTOK_SUB)
    expect(within(rows[2]!).getByRole('button', { name: '@shop.three 연결' })).toBeTruthy()
    // 이 라이브에 이어진 계정은 라이브 아님이어도 "이 라이브에 연결돼 있어요" 그대로 (꺼진 [연결])
    expect(within(rows[3]!).getByTestId('recent-live-sub').textContent).toBe('틱톡 · 이 라이브에 연결돼 있어요')
    await waitFor(() => expect(within(rows[0]!).getByTestId('recent-live-avatar').innerHTML).toContain(PHOTO))
  })

  it('[연결]: 그 계정의 라이브 주소를 칸에 넣고 틱톡 링크로 잇는다 — 이으면 방송 화면으로', async () => {
    const w = world([{ tiktokId: 'shop.two', linkedAt: at(40), linkedBroadcast: null, photoBroadcast: null }])
    w.server.on('POST', /^\/api\/broadcasts\/b1\/tiktok\/link-url$/, () => ({ body: { link: { state: 'LINKED' } } }))
    const onBack = vi.fn()
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={onBack} />))
    const [row] = await rowsOf()
    expect(names([row!])).toEqual(['@shop.two'])
    fireEvent.click(within(row!).getByRole('button', { name: '@shop.two 연결' }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(w.server.callsTo('POST', /tiktok\/link-url$/).map((call) => call.body)).toEqual([{ requestId: expect.any(String), url: 'https://www.tiktok.com/@shop.two/live' }])
    // 유튜브 쪽으로는 보내지 않는다
    expect(w.server.callsTo('POST', /\/youtube$/)).toHaveLength(0)
    expect(w.server.callsTo('POST', /\/youtube\/preview$/)).toHaveLength(0)
  })

  it('[연결]에서 동의가 없으면 틱톡 안내 → 동의하면 같은 주소로 다시, 다른 라이브에 이어져 있으면 [옮기기]로 그 주소를 옮긴다', async () => {
    const w = world([{ tiktokId: 'shop.two', linkedAt: at(40), linkedBroadcast: 'b3', photoBroadcast: null }])
    w.server.on('GET', /^\/api\/tiktok$/, () => ({ body: { tiktok: { notice: { version: 'v1', title: '틱톡 안내', lines: ['한 줄'], checkbox: '동의하고 연결' } } } }))
    w.server.on('POST', /^\/api\/tiktok\/consent$/, () => ({ body: { tiktok: {} } }))
    let calls = 0
    w.server.on('POST', /^\/api\/broadcasts\/b1\/tiktok\/link-url$/, (call) => {
      calls += 1
      if (calls === 1) return { status: 409, body: { error: { code: 'NO_CONSENT', message: '동의가 필요해요.' } } }
      if (call.body?.move !== true) return { status: 409, body: { error: { code: 'TIKTOK_ELSEWHERE', message: '다른 라이브에 틱톡이 연결돼 있어요.' } } }
      return { body: { link: { state: 'LINKED' } } }
    })
    const onBack = vi.fn()
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={onBack} />))
    const [row] = await rowsOf()
    fireEvent.click(within(row!).getByRole('button', { name: '@shop.two 연결' }))
    const agree = await screen.findByRole('button', { name: '동의하고 연결' })
    await waitFor(() => expect(agree.getAttribute('aria-disabled')).not.toBe('true'))
    fireEvent.click(agree)
    await screen.findByText(TIKTOK_MOVE_QUESTION.split('\n')[0]!, { exact: false })
    fireEvent.click(screen.getByRole('button', { name: '옮기기' }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    const url = 'https://www.tiktok.com/@shop.two/live'
    expect(w.server.callsTo('POST', /tiktok\/link-url$/).map((call) => ({ url: call.body?.url, move: call.body?.move }))).toEqual([
      { url, move: undefined },
      { url, move: undefined },
      { url, move: true },
    ])
  })

  it('이 라이브에 이미 이어진 틱톡 계정은 [연결]을 누를 수 없다', async () => {
    const w = world([{ tiktokId: 'shop.two', linkedAt: at(40), linkedBroadcast: 'b1', photoBroadcast: null }])
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const [row] = await rowsOf()
    expect(within(row!).getByTestId('recent-live-sub').textContent).toBe('틱톡 · 이 라이브에 연결돼 있어요')
    expect(within(row!).getByRole('button', { name: '@shop.two 연결' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('옛 서버(틱톡 칸 없음)는 유튜브 채널 줄 그대로', async () => {
    const w = world(undefined, [
      { channelId: 'UC1', channelTitle: '첫째네', videoId: null },
      { channelId: 'UC2', channelTitle: '두째네', videoId: 'LIVEVIDEO02' },
    ])
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    expect(names(await rowsOf())).toEqual(['첫째네', '두째네'])
  })
})
