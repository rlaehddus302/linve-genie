// D-UX4-112 (사용자 지시 2026-11-10, 라이브 링크 화면 사진 셋):
// - 화면이 왼쪽으로 열리다 갑자기 오른쪽으로 튐 → 원인: 넘어오는 동안 칸이 스스로 초점을 받아 키보드가 올라오고, 키보드 피하는 틀(KeyboardAvoidingView)이
//   앱 전체 다음 그리기에 배치 움직임(LayoutAnimation)을 걸어 넘어오던 화면 틀까지 튀었다 → 칸의 스스로 초점은 넘김이 끝난 뒤에
// - 라이브 링크 화면은 키보드를 띄우지 않는다 · 제목 "연결할 라이브의 링크를\n복사해서 붙여넣어 주세요" + 설명
// - [붙여넣기]는 [링크를 모르겠어요]와 같은 모양으로 칸 밖, 한 줄에
// - 최근 채널 라이브는 늦게 오니 옅게 나타나며 올라오고, "최근 연결한 채널의 라이브가 있어요" · 플랫폼 그림 + 제목(넘치면 끝이 흐려짐) · 채널 사진 + 채널 이름 · [연결]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { LINK_ASK_DESCRIPTION, LINK_ASK_TITLE, RECENT_LIVE_TITLE } from '../src/screens/console/YoutubeSection.tsx'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { FOCUS_AFTER_PUSH_MS } from '../src/ui/kit/inputs.tsx'
import { makeWorld } from './screen-support.tsx'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

function linkWorld(recent: readonly Record<string, unknown>[] = []) {
  const world = makeWorld({ products: [] })
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: recent } }))
  return world
}

afterEach(() => {
  setClipboardReader(async () => '')
  setClipboardProbe(null)
})

describe('라이브 링크 화면 (D-UX4-112)', () => {
  it('제목·설명, 링크 칸은 스스로 초점을 받지 않고 눌러도 키보드가 없다', async () => {
    const world = linkWorld()
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const page = await screen.findByRole('dialog', { name: '라이브 연결' })
    // D-UX4-113 (사용자 지시 2026-11-10 토스 "토스인증서" 사진): 옛 기대 제목 "연결할 라이브의 링크를\n복사해서 붙여넣어 주세요",
    // 설명 "라이브 링크만 알려주시면\n복잡한 전산 업무는 저희가 도와드릴게요" → 아래 둘
    expect(LINK_ASK_TITLE).toBe('라이브 링크를 넣어 주세요')
    expect(LINK_ASK_DESCRIPTION).toBe('링크만 알려주시면 복잡한 작업은\n저희가 도와드릴게요')
    expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe(LINK_ASK_TITLE)
    expect(within(page).getByTestId('form-description').textContent).toBe(LINK_ASK_DESCRIPTION)
    const field = within(page).getByRole('textbox', { name: '라이브 링크' })
    expect(document.activeElement).not.toBe(field)
    const source = read('src/screens/console/YoutubeSection.tsx')
    expect(source).toContain('showSoftInputOnFocus={false}')
    expect(source).not.toMatch(/autoFocus=\{autoFocus\}/)
    expect(read('src/screens/BroadcastLinkScreen.tsx')).not.toContain('autoFocus')
    expect(read('src/screens/NewBroadcastScreen.tsx')).not.toContain('autoFocus: true')
  })

  // D-UX4-113: 옛 기대(D-UX4-112) [링크를 모르겠어요]·[붙여넣기]가 칸 아래 가운데 한 줄 → 토스 사진대로
  // [링크를 모르겠어요]는 설명 바로 아래 왼쪽 칩("자세히 보기" 자리), [붙여넣기]는 칸 바로 아래 왼쪽 칩("… 붙여넣기" 자리), 같은 모양
  it('[링크를 모르겠어요]는 설명 아래 왼쪽 칩, [붙여넣기]는 칸 바로 아래 왼쪽 칩 — 같은 모양', async () => {
    setClipboardProbe(async () => true)
    setClipboardReader(async () => 'https://youtube.com/live/LIVENOW0001')
    const world = linkWorld()
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const page = await screen.findByRole('dialog', { name: '라이브 연결' })
    const unknown = within(page).getByRole('button', { name: '링크를 모르겠어요' })
    const pasteBox = await within(page).findByTestId('link-paste')
    const paste = within(pasteBox).getByRole('button', { name: '붙여넣기' })
    const description = within(page).getByTestId('form-description')
    const field = within(page).getByRole('textbox', { name: '라이브 링크' })
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    // 순서: 설명 → [링크를 모르겠어요] → 링크 칸 → [붙여넣기]
    expect(after(description, unknown)).toBe(true)
    expect(after(unknown, field)).toBe(true)
    expect(after(field, paste)).toBe(true)
    // 같은 회색 칩, 왼쪽 정렬
    expect(getComputedStyle(paste).alignSelf).toBe(getComputedStyle(unknown).alignSelf)
    expect(getComputedStyle(pasteBox).alignItems).toBe('flex-start')
    expect(within(field.parentElement!).queryByRole('button', { name: '붙여넣기' })).toBeNull()
    fireEvent.click(paste)
    await within(page).findByDisplayValue('https://youtube.com/live/LIVENOW0001')
  })

  // D-UX4-113 (토스 계좌 줄 사진): 옛 기대(D-UX4-112) 제목 줄 앞 작은 플랫폼 그림 · 채널 사진 + 채널 이름 → 왼쪽 큰 플랫폼 그림 하나(두 줄 높이) · 굵은 제목 / 회색 채널 이름 · 오른쪽 회색 [연결]
  it('최근 연결한 채널의 라이브: 옅게 나타나며 올라오는 묶음, 플랫폼 그림 · 제목 / 채널 이름 · [연결]', async () => {
    const world = linkWorld([{ videoId: 'LIVENOW0001', title: '아주 긴 라이브 제목이 한 줄을 넘어가면 끝이 흐려져요', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC1', channelTitle: '다육이네' }])
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const box = await screen.findByRole('group', { name: RECENT_LIVE_TITLE })
    expect(RECENT_LIVE_TITLE).toBe('최근 연결한 채널의 라이브가 있어요')
    expect(screen.getByTestId('recent-lives').contains(box)).toBe(true)
    const row = within(box).getByTestId('recent-live')
    expect(within(row).getByTestId('recent-live-title').textContent).toBe('아주 긴 라이브 제목이 한 줄을 넘어가면 끝이 흐려져요')
    expect(within(row).getByTestId('recent-live-channel').textContent).toBe('다육이네')
    expect(within(row).queryByTestId('recent-live-avatar')).toBeNull()
    expect(within(row).getByRole('button', { name: '아주 긴 라이브 제목이 한 줄을 넘어가면 끝이 흐려져요 연결' })).toBeTruthy()
    expect(box.textContent).not.toContain('잇기')
    const source = read('src/screens/console/YoutubeSection.tsx')
    // 한 줄, 말줄임표 대신 끝이 흐려짐 · 카드 없이 화면 여백 그대로
    expect(source).toContain('numberOfLines={1} ellipsizeMode="clip"')
    expect(source).toContain('testID="fade-line-end"')
    expect(source).toContain('<Appear testID="recent-lives">')
    expect(source).not.toContain('<Card label={recentTitle}>')
    // [연결]은 토스 [송금]처럼 옅은 회색 둥근 네모
    expect(source).toContain("backgroundColor: pressed ? p.pressed : p.surfaceAlt, opacity: disabled ? 0.45 : 1")
  })

  it('화면이 넘어오는 동안에는 칸이 스스로 초점을 받지 않는다 — 넘김이 끝난 뒤(휴대폰)', () => {
    const source = read('src/ui/kit/inputs.tsx')
    expect(FOCUS_AFTER_PUSH_MS).toBeGreaterThanOrEqual(500)
    expect(source).toContain('const focusNow = useDeferredAutoFocus(inputRef, autoFocus === true)')
    expect(source).toContain('autoFocus={focusNow}')
  })
})
