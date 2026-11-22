// 최근 연결한 채널 5곳 (D-UX4-187, 사용자 2026-11-16 "최근 연결한 채널 라이브 보여주는거 젤 최근 1개만 보여주는걸로 되어있는걸로 보이는데,
// 최근 5군데 채널 다 보여주도록 해. 맨위가 젤 최근으로."): 서버가 준 채널 차례대로, 라이브가 없는 채널도 보인다
import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { NO_LIVE_NOW, RECENT_CHANNELS_TITLE } from '../src/screens/console/YoutubeSection.tsx'
import { makeWorld } from './screen-support.tsx'

it('최근 채널 차례대로(맨 위가 가장 최근) — 라이브면 [연결], 없으면 "지금 라이브 중이 아니에요" (D-RECENT-YT-02 문구)', async () => {
  const world = makeWorld({ products: [] })
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
  const live = (videoId: string, channelId: string, channelTitle: string) => ({ videoId, title: '오늘 방송', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId, channelTitle })
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: {
    broadcasts: [live('LIVEVIDEO02', 'UC2', '두째네'), live('LIVEVIDEO04', 'UC4', '넷째네')],
    channels: [
      { channelId: 'UC1', channelTitle: '첫째네', videoId: null },
      { channelId: 'UC2', channelTitle: '두째네', videoId: 'LIVEVIDEO02' },
      { channelId: 'UC3', channelTitle: '<b>셋째네</b>', videoId: null },
      { channelId: 'UC4', channelTitle: '넷째네', videoId: 'LIVEVIDEO04' },
      { channelId: 'UC5', channelTitle: null, videoId: null },
    ],
  } }))
  render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
  const box = await screen.findByRole('group', { name: RECENT_CHANNELS_TITLE })
  const rows = within(box).getAllByTestId('recent-live')
  expect(rows.map(row => within(row).getByTestId('recent-live-channel').textContent)).toEqual(['첫째네', '두째네', '<b>셋째네</b>', '넷째네', '(이름 없음)'])
  expect(rows.map(row => within(row).queryByRole('button') === null ? NO_LIVE_NOW : 'connect')).toEqual([NO_LIVE_NOW, 'connect', NO_LIVE_NOW, 'connect', NO_LIVE_NOW])
  expect(within(rows[0]!).getByTestId('recent-live-sub').textContent).toBe(NO_LIVE_NOW)
  expect(NO_LIVE_NOW).toBe('지금 라이브 중이 아니에요') // 문구 바뀜 (D-RECENT-YT-02)
  expect(within(rows[1]!).getByRole('button', { name: '두째네 연결' })).toBeTruthy()
  // 닉네임·채널 이름은 글자 그대로
  expect(rows[2]!.querySelector('b')).toBeNull()
})
