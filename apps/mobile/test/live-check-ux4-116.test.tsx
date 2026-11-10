// D-UX4-116 (사용자 지시 2026-11-10, "이 라이브가 맞나요?" 팝업 사진): 팝업 안에 라이브 정보를 이쁘게 —
// 맨 위 플랫폼 아이콘·플랫폼명, 그 아래 제목(한 줄 넘어가면 ...), 그 아래 채널 아이콘·채널명.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LINK_CHECK_QUESTION, LiveCheck } from '../src/screens/console/YoutubeSection.tsx'
import { makeWorld } from './screen-support.tsx'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')
const LONG = '미강다육🌻 라이브 11월 10일 신상입고! #에케베리 #국민이 #에오니움 #힐링 #다육식물 #다육이'

describe('잇기 전 확인 팝업의 라이브 정보 (D-UX4-116)', () => {
  it('묻는 말 아래 카드: 플랫폼(아이콘·이름) → 제목 → 채널(사진·이름) 순서', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/youtube\/channels\/UC_MIGANG\/avatar$/, () => ({ body: { avatar: 'https://yt3.example/migang.jpg' } }))
    render(world.wrap(<LiveCheck title={LONG} channel="미강다육🌻" channelId="UC_MIGANG" />))
    expect(LINK_CHECK_QUESTION).toBe('이 라이브가 맞나요?')
    const heading = screen.getByRole('heading', { name: LINK_CHECK_QUESTION })
    const card = screen.getByTestId('live-check')
    const platform = within(card).getByTestId('live-check-platform')
    const title = within(card).getByTestId('live-check-title')
    const channel = within(card).getByTestId('live-check-channel')
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(after(heading, card)).toBe(true)
    expect(after(platform, title)).toBe(true)
    expect(after(title, channel)).toBe(true)
    expect(platform.textContent).toBe('유튜브')
    expect(platform.querySelector('img')).not.toBeNull()
    expect(title.textContent).toBe(LONG)
    expect(channel.textContent).toBe('미강다육🌻')
    // 채널 사진: 미리 보기가 준 채널 ID로 받아 온다
    await screen.findByTestId('live-check-avatar')
    expect(world.server.callsTo('GET', /\/api\/youtube\/channels\/UC_MIGANG\/avatar$/).length).toBeGreaterThan(0)
  })

  it('제목·채널 이름은 한 줄, 넘치면 끝이 ...', () => {
    const world = makeWorld({ products: [] })
    render(world.wrap(<LiveCheck title={LONG} channel="미강다육🌻" channelId={null} />))
    const title = screen.getByTestId('live-check-title')
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(getComputedStyle(title).whiteSpace).toBe('nowrap')
    const name = within(screen.getByTestId('live-check-channel')).getByText('미강다육🌻')
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    // 채널 ID를 모르면 회색 동그라미 그림
    expect(screen.getByTestId('live-check-avatar')).toBeTruthy()
  })

  it('미리 보기가 준 채널 ID를 팝업에 넘기고, 처음 잇는 채널 팝업(제목 없음)은 옛 글 그대로 (소스)', () => {
    const text = read('src/screens/console/YoutubeSection.tsx')
    expect(text).toMatch(/post<\{ title\?: unknown; channelTitle\?: unknown; channelId\?: unknown \}>\('\/api\/youtube\/preview'/)
    expect(text).toMatch(/content=\{shownAsk\.current\?\.title == null \? undefined : <LiveCheck title=\{shownAsk\.current\.title\} channel=\{shownAsk\.current\.name\} channelId=\{shownAsk\.current\.channelId\} \/>\}/)
  })
})
