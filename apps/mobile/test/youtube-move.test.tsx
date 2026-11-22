// D-YT-MOVE-01 (사용자 2026-11-23 "왜 이미 다른 방송에 이어진 유튜브 방송이라고 뜨지?"): 같은 유튜브 라이브가 끝나지 않은 다른 방송에 이어져 있으면
// 오류 글 대신 가운데 팝업 "이 라이브로 옮길까요?" [취소](왼쪽) · [옮기기](오른쪽) — [옮기기]면 move: true로 다시 보내 이 방송에 잇는다.
// 최근 연결한 채널 줄은 다른 라이브에 이어져 있어도 [연결]을 누를 수 있다(누르면 같은 흐름).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { LINK_CONFIRM_ACTION, RECENT_CHANNELS_TITLE, YOUTUBE_MOVE_QUESTION } from '../src/screens/console/YoutubeSection.tsx'
import { makeWorld } from './screen-support.tsx'

const CONNECTION = { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true }

function world() {
  const w = makeWorld({ products: [] })
  let link: Record<string, unknown> | null = null
  w.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: CONNECTION }))
  w.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link, collector: null } }))
  w.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({
    body: {
      broadcasts: [{ videoId: 'MIGANG00001', title: '오늘 방송', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: 'b9', channelId: 'UC_MIGANG', channelTitle: '미강다육' }],
      channels: [{ channelId: 'UC_MIGANG', channelTitle: '미강다육', videoId: 'MIGANG00001' }],
    },
  }))
  w.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ body: { title: '오늘 방송', channelTitle: '미강다육', channelId: 'UC_MIGANG' } }))
  w.server.on('POST', /^\/api\/broadcasts\/b1\/youtube$/, (call) => {
    if (call.body?.move !== true) return { status: 409, body: { error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } } }
    link = { videoId: 'MIGANG00001', channelId: null, broadcastChannelId: 'UC_MIGANG', broadcastChannelTitle: '미강다육', broadcastTitle: '오늘 방송', invited: false, linkedAt: '2026-11-23T12:00:00.000Z', chatEnded: false }
    return { body: { link, collector: { mode: 'WEB', status: 'STARTING', restartable: false } } }
  })
  return w
}

describe('다른 방송에 이어진 유튜브 라이브 옮기기 (D-YT-MOVE-01)', () => {
  it('최근 줄 [연결](다른 라이브에 이어져 있어도 누름) → [연결하기] → 옮길지 묻는 팝업 → [옮기기]면 move로 다시 보내 잇는다', async () => {
    const w = world()
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const box = await screen.findByRole('group', { name: RECENT_CHANNELS_TITLE })
    const [row] = within(box).getAllByTestId('recent-live')
    expect(within(row!).getByTestId('recent-live-sub').textContent).toBe('다른 라이브에 연결돼 있어요')
    const connect = within(row!).getByRole('button', { name: '미강다육 연결' })
    expect(connect.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(connect)
    fireEvent.click(within(await screen.findByTestId('link-confirm')).getByRole('button', { name: LINK_CONFIRM_ACTION }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('이 라이브로 옮길까요?')
    expect(YOUTUBE_MOVE_QUESTION).toBe('다른 라이브에 이 유튜브 라이브가 연결돼 있어요.\n이 라이브로 옮길까요?')
    // 단추는 한 줄: 왼쪽 [취소] · 오른쪽 [옮기기]
    const buttons = within(dialog).getAllByRole('button').map((button) => button.textContent)
    expect(buttons.indexOf('취소')).toBeLessThan(buttons.indexOf('옮기기'))
    fireEvent.click(within(dialog).getByRole('button', { name: '옮기기' }))
    await screen.findByTestId('link-info-page')
    const sent = w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/).map((call) => call.body)
    expect(sent).toHaveLength(2)
    expect(sent[0]).not.toHaveProperty('move')
    expect(sent[1]).toMatchObject({ video: 'MIGANG00001', move: true })
  })

  it('[취소]면 아무것도 옮기지 않고 링크 화면 그대로', async () => {
    const w = world()
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'https://youtu.be/MIGANG00001' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const page = await screen.findByTestId('link-confirm')
    // 라이브 정보를 받은 뒤에 [연결하기]가 켜진다 (D-UX4-121)
    await within(page).findByTestId('live-check-title')
    fireEvent.click(within(page).getByRole('button', { name: LINK_CONFIRM_ACTION }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(await screen.findByRole('textbox', { name: '라이브 링크' })).toBeTruthy()
    expect(w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/)).toHaveLength(1)
  })
})
