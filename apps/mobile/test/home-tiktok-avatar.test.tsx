// D-TT-PHOTO-01 (판매자 보고 2026-11-17 "채널 사진 뜨는 영역에 틱톡 채널 프사는 안 뜸"): 유튜브 채널이 없는 틱톡 라이브는
// 홈 "지금 라이브 중"·채널 사진 자리에 그 방송의 틱톡 프로필 사진(서버가 받아 둔 data: 주소)을 보인다. 모르면 기본 그림.
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { ChannelPhoto, channelAvatarPath } from '../src/ui/ChannelPhoto.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const nav = () => ({ openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

describe('틱톡 프로필 사진 (D-TT-PHOTO-01)', () => {
  it('사진 주소: 유튜브 채널이 있으면 그 채널, 없고 틱톡 방송이면 그 방송의 틱톡 사진, 둘 다 없으면 묻지 않는다', () => {
    expect(channelAvatarPath('UCaaaaaaaaaaaaaaaaaaaaaa', 'b1')).toBe('/api/youtube/channels/UCaaaaaaaaaaaaaaaaaaaaaa/avatar')
    expect(channelAvatarPath(null, 'b 1')).toBe('/api/broadcasts/b%201/tiktok/avatar')
    expect(channelAvatarPath('', null)).toBeNull()
    expect(channelAvatarPath(null)).toBeNull()
  })

  it('틱톡만 이은 라이브 중이면 홈 "지금 라이브 중"에 틱톡 프로필 사진을 받아 보인다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, platforms: ['tiktok'], createdAt: new Date().toISOString() }] } }))
    world.server.on('GET', /^\/api\/broadcasts\/b1\/tiktok\/avatar$/, () => ({ body: { avatar: PHOTO } }))
    render(world.wrap(<HomeScreen nav={nav()} sellerName="김다육" />))
    await screen.findByRole('button', { name: '지금 라이브 중' })
    await waitFor(() => expect(world.server.callsTo('GET', /\/tiktok\/avatar$/)).toHaveLength(1))
    expect(world.server.callsTo('GET', /\/youtube\/channels\//)).toHaveLength(0)
    await waitFor(() => expect(screen.getByTestId('home-live-avatar').innerHTML).toContain(PHOTO))
  })

  it('사진을 모르면(null) 기본 그림 그대로 — 채널 사진 부품도 같다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts\/b9\/tiktok\/avatar$/, () => ({ body: { avatar: null } }))
    render(world.wrap(<ChannelPhoto channelId={null} tiktokBroadcastId="b9" size={24} testID="photo" />))
    await waitFor(() => expect(world.server.callsTo('GET', /\/b9\/tiktok\/avatar$/)).toHaveLength(1))
    expect(screen.getByTestId('photo').innerHTML).not.toContain('data:image')
  })
})
