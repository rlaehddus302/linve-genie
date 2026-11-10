// D-UX4-116 (사용자 지시 2026-11-10, "이 라이브가 맞나요?" 팝업 사진): 라이브 정보를 이쁘게 —
// 맨 위 플랫폼 아이콘·플랫폼명, 그 아래 제목, 그 아래 채널 아이콘·채널명.
// D-UX4-117 (사용자 지시 2026-11-10 "라이브 확인 팝업 띄우지 말고 별도의 화면으로 … 제목(끊지말고 그냥 다 보여줘)"):
// 옛 기대 팝업 안 묻는 말 "이 라이브가 맞나요?" + 제목 한 줄(…) → 연결 확인 화면의 카드, 묻는 말은 화면 제목, 제목은 자르지 않는다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveCheck } from '../src/screens/console/YoutubeSection.tsx'
import { makeWorld } from './screen-support.tsx'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')
const LONG = '미강다육🌻 라이브 11월 10일 신상입고! #에케베리 #국민이 #에오니움 #힐링 #다육식물 #다육이'

describe('연결할 라이브 정보 카드 (D-UX4-116 → D-UX4-117)', () => {
  it('플랫폼(아이콘·이름) → 제목 → 채널(사진·이름) 순서, 채널 사진은 미리 보기가 준 채널 ID로', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/youtube\/channels\/UC_MIGANG\/avatar$/, () => ({ body: { avatar: 'https://yt3.example/migang.jpg' } }))
    render(world.wrap(<LiveCheck title={LONG} channel="미강다육🌻" channelId="UC_MIGANG" />))
    const card = screen.getByTestId('live-check')
    const platform = within(card).getByTestId('live-check-platform')
    const title = within(card).getByTestId('live-check-title')
    const channel = within(card).getByTestId('live-check-channel')
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(after(platform, title)).toBe(true)
    expect(after(title, channel)).toBe(true)
    expect(platform.textContent).toBe('유튜브')
    expect(platform.querySelector('img')).not.toBeNull()
    expect(title.textContent).toBe(LONG)
    expect(channel.textContent).toBe('미강다육🌻')
    // D-UX4-117: 묻는 말은 카드 안이 아니라 화면 제목 (옛 기대: 카드 위 "이 라이브가 맞나요?")
    expect(card.textContent).not.toContain('이 라이브가 맞나요?')
    await screen.findByTestId('live-check-avatar')
    expect(world.server.callsTo('GET', /\/api\/youtube\/channels\/UC_MIGANG\/avatar$/).length).toBeGreaterThan(0)
  })

  it('제목·채널 이름은 자르지 않고 다 보인다 (D-UX4-117 — 옛 기대 한 줄 …)', () => {
    const world = makeWorld({ products: [] })
    render(world.wrap(<LiveCheck title={LONG} channel="미강다육🌻" channelId={null} />))
    const title = screen.getByTestId('live-check-title')
    expect(getComputedStyle(title).textOverflow).not.toBe('ellipsis')
    expect(getComputedStyle(title).whiteSpace).not.toBe('nowrap')
    const name = within(screen.getByTestId('live-check-channel')).getByText('미강다육🌻')
    expect(getComputedStyle(name).textOverflow).not.toBe('ellipsis')
    // 채널 ID를 모르면 회색 동그라미 그림
    expect(screen.getByTestId('live-check-avatar')).toBeTruthy()
  })

  it('미리 보기가 준 채널 ID를 확인 화면에 넘긴다 (소스)', () => {
    const text = read('src/screens/console/YoutubeSection.tsx')
    expect(text).toMatch(/post<\{ title\?: unknown; channelTitle\?: unknown; channelId\?: unknown \}>\('\/api\/youtube\/preview'/)
    expect(text).toContain('<LiveCheck title={seen.title} channel={seen.name} channelId={seen.channelId} />')
  })
})
