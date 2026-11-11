// D-UX4-130 (사용자 지시 2026-11-12): 라이브 관리 화면 — "상품 미리 등록 기능 제거해. 라이브 연결 안에 있는 것들 모두 바깥에 있는 라이브 관리 화면으로 꺼내(뎁스 줄이는 의도)
// 라벨 프린트 화면도 마찬가지로 밖으로 빼. 라벨 꾸미기 네이밍도 라벨 디자인으로 수정해. 사진 1(토스), 2(라이브지니) 비교해보면 텍스트 크기, 두께, 간격, 여백이 다르다.
// 토글 버튼 디자인도 똑같이 맞춰라."
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CollectorView, LinkView } from '@livejjim/web/src/api/types.ts'
import { LABEL_ON_HELP_TITLE, LABEL_PRINT_ROWS, LABEL_PRINT_TITLE } from '../src/screens/LabelPrintScreen.tsx'
import { END_LINK_LABEL } from '../src/screens/console/EndBroadcast.tsx'
import { LINK_INFO_ROWS } from '../src/screens/console/LinkInfo.tsx'
import { PLAIN } from '../src/screens/console/parts.tsx'
import { ManageScreen } from '../src/screens/console/StackScreens.tsx'
import { SWITCH } from '../src/ui/kit/layout.tsx'
import { PAGE } from '../src/ui/kit/tokens.ts'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const collector = (): CollectorView => ({
  status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, mode: 'WEB', lastMessageAt: null, recorded: 3, skippedBeforeLink: 0, gap: false, gapMessage: null, restartable: false,
})
const linked = (): LinkView => ({
  link: { videoId: 'VIDEOKNOWN1', channelId: 'UC_K', broadcastChannelId: 'UC_K', broadcastChannelTitle: '다육이네', invited: false, linkedAt: '2026-10-29T10:00:00.000Z', chatEnded: false, broadcastTitle: '오늘 저녁 다육이 경매' },
  collector: collector(),
})
const unlinked = (): LinkView => ({ link: null, collector: null }) as unknown as LinkView

async function openManage(link: LinkView) {
  const world = makeWorld({ products: [] })
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: link }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
  world.server.on('GET', /^\/api\/youtube\/channels\/UC_K\/avatar$/, () => ({ body: { avatar: null } }))
  const steps: string[] = []
  const openStatus = vi.fn()
  const openLink = vi.fn()
  const onEnded = vi.fn()
  render(world.wrap(<ManageScreen broadcastId="b1" onBack={() => {}} openLink={openLink} labels={{ openStep: (step) => steps.push(step), openStatus }} onEnded={onEnded} />))
  await waitFor(() => expect(world.source()).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  const page = await screen.findByRole('main', { name: '라이브 관리' })
  return { world, page, steps, openStatus, openLink, onEnded }
}

describe('라이브 관리를 한 화면으로 (D-UX4-130)', () => {
  it('이은 라이브: 플랫폼·채널·라이브 제목·라이브 바로가기가 라이브 관리에 바로 있고 "라이브 연결 ›" 줄은 없다', async () => {
    const { page } = await openManage(linked())
    await waitFor(() => expect(within(page).getByTestId('link-info-platform')).toBeTruthy())
    expect(within(page).getByTestId('link-info-channel').textContent).toContain('다육이네')
    expect(within(page).getByTestId('link-info-title').textContent).toBe(`${LINK_INFO_ROWS.title}오늘 저녁 다육이 경매`)
    expect(within(page).getByRole('button', { name: LINK_INFO_ROWS.open })).toBeTruthy()
    expect(within(page).queryByRole('button', { name: '라이브 연결' })).toBeNull()
  })

  it('잇지 않은 라이브: "라이브 연결 ›"만 남아 잇는 화면을 연다', async () => {
    const { page, openLink } = await openManage(unlinked())
    fireEvent.click(await within(page).findByRole('button', { name: '라이브 연결' }))
    expect(openLink).toHaveBeenCalledTimes(1)
    expect(within(page).queryByTestId('link-info-platform')).toBeNull()
  })

  it('라벨 줄이 바로 있다: 라벨 뽑기(? 설명) · 프린터 연결 · 라벨 디자인 · 테스트 인쇄 · 출력 상태·농도 — "라벨 프린트 ›"·"상품 미리 등록"은 없다', async () => {
    const { page, steps, openStatus } = await openManage(linked())
    await waitFor(() => expect(within(page).getByRole('switch', { name: `${LABEL_PRINT_ROWS.on} — 켜짐` })).toBeTruthy())
    expect(LABEL_PRINT_ROWS.design).toBe('라벨 디자인')
    const connect = within(page).getByRole('button', { name: LABEL_PRINT_ROWS.connect })
    expect(connect.textContent).toContain('연결 안 됨')
    fireEvent.click(connect)
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_ROWS.design }))
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_ROWS.test }))
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_ROWS.status }))
    expect(steps).toEqual(['connect', 'design', 'test'])
    expect(openStatus).toHaveBeenCalledTimes(1)
    fireEvent.click(within(page).getByRole('button', { name: `${LABEL_PRINT_ROWS.on} 설명 보기` }))
    expect(await screen.findByRole('dialog', { name: LABEL_ON_HELP_TITLE })).toBeTruthy()
    expect(within(page).queryByRole('button', { name: LABEL_PRINT_TITLE })).toBeNull()
    expect(page.textContent).not.toContain('상품 미리 등록')
    expect(page.textContent).not.toContain('라벨 꾸미기')
  })

  it('라이브 연결 끊기는 라이브 관리 맨 아래 빨간 줄 (라이브 연결 안으로 들어가지 않는다)', async () => {
    const { page } = await openManage(linked())
    const end = await within(page).findByRole('button', { name: END_LINK_LABEL })
    const buttons = within(page).getAllByRole('button')
    expect(buttons[buttons.length - 1]).toBe(end)
    // 끊기 줄은 하나뿐 (LinkInfo 안의 끊기 줄과 겹치지 않는다)
    expect(within(page).getAllByRole('button', { name: END_LINK_LABEL })).toHaveLength(1)
  })
})

describe('토스 "비밀번호 · 보안"과 같은 치수 (D-UX4-130 — 같은 휴대폰 사진 두 장을 재어)', () => {
  it('글자 왼쪽 24 · 줄 48 · 켜고 끄는 줄 54 · 제목 위 18 · 제목 아래 24 · 제목 아주 굵게, 뒤로 ‹ 왼쪽 8', () => {
    expect(PLAIN.side).toBe(24)
    expect(PLAIN.row).toBe(48)
    expect(PLAIN.toggleRow).toBe(54)
    expect(PLAIN.titleTop).toBe(18)
    expect(PLAIN.titleBottom).toBe(24)
    expect(PLAIN.titleWeight).toBe('heavy')
    expect(PAGE.backLeft).toBe(8)
  })

  it('스위치 50×30 · 동그라미 23.5 (가장자리 3.25)', () => {
    expect(SWITCH).toEqual({ width: 50, height: 30, knob: 23.5 })
  })
})
