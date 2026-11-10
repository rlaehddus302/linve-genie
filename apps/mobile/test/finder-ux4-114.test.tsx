// D-UX4-114 (사용자 지시 2026-11-10, "어디서 라이브하나요?" 판 사진):
// 제목 "어디서 라이브하시나요?" · 설명 "라이브 공유 버튼을 누르고 링크를 복사한 뒤 돌아와 주세요"(한 글자만 다음 줄로 넘지 않게 "누르고" 뒤에서 나눔) · 아래 판에서 스크롤은 할 수 없게.
// D-UX4-115 (사용자 지시 2026-11-10 "라이브 링크 밑에 붙여넣기 버튼 그 위에 링크를 모르겠어요 버튼 스타일 그대로"):
// [붙여넣기]는 모든 기기에서 [링크를 모르겠어요]와 같은 회색 칩 — 아이폰 기본 붙여넣기 단추는 글자 크기·글꼴을 못 바꿔 쓰지 않는다.
// 클립보드를 못 읽으면(아이폰 "붙여넣기 허용 안 함") 아무 일도 없다 — "알 수 없는 링크예요"를 띄우지 않는다.
// 판에 내용이 다 들어가면 스크롤도 튕김도 없다 — 넘칠 때만 스크롤 (모든 아래 판 공통).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FINDER_DESCRIPTION, FINDER_TITLE, PlatformFinder } from '../src/screens/NewBroadcastScreen.tsx'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { makeWorld } from './screen-support.tsx'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

describe('플랫폼 고르기 판 (D-UX4-114)', () => {
  it('제목·설명이 바뀌었고 옛 말은 없다', async () => {
    expect(FINDER_TITLE).toBe('어디서 라이브하시나요?')
    expect(FINDER_DESCRIPTION).toBe('라이브 공유 버튼을 누르고\n링크를 복사한 뒤 돌아와 주세요')
    const world = makeWorld({ products: [] })
    render(world.wrap(<PlatformFinder visible onClose={() => {}} onReturned={() => {}} />))
    const sheet = await screen.findByRole('dialog', { name: FINDER_TITLE })
    expect(within(sheet).getByRole('heading', { name: FINDER_TITLE })).toBeTruthy()
    expect(sheet.textContent).toContain(FINDER_DESCRIPTION)
    expect(sheet.textContent).not.toContain('라이브하나요?')
    expect(sheet.textContent).not.toContain('복사해 돌아오세요')
    // 플랫폼 셋은 그대로
    const group = within(sheet).getByRole('group', { name: '라이브 플랫폼' })
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['유튜브', '틱톡', '밴드'])
  })

  it('아래 판 몸통은 내용이 넘칠 때만 스크롤되고, 튕기거나 끝에서 늘어나지 않는다 (소스)', () => {
    const text = read('src/ui/kit/sheets.tsx')
    const start = text.indexOf('export function BottomSheet(')
    const body = text.slice(start, text.indexOf('\nexport ', start + 1))
    expect(body).toMatch(/const over = contentHeight\.current > viewHeight\.current \+ 1/)
    expect(body).toMatch(/setOverflowing\(over\)/)
    expect(body).toMatch(/scrollEnabled=\{overflowing\}/)
    expect(body).toMatch(/alwaysBounceVertical=\{false\}/)
    expect(body).toMatch(/overScrollMode="never"/)
  })
})

afterEach(() => {
  setClipboardReader(async () => '')
  setClipboardProbe(null)
})

function linkWorld() {
  const world = makeWorld({ products: [] })
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
  return world
}

describe('[붙여넣기]는 [링크를 모르겠어요]와 똑같은 칩 (D-UX4-115)', () => {
  it('앱 시작 때 아이폰 기본 붙여넣기 단추로 바꿔 끼우지 않는다 (소스)', () => {
    const production = read('src/native/production.tsx')
    expect(production).not.toContain('ClipboardPasteButton')
    expect(production).not.toContain('setPasteControl')
    expect(read('src/native/paste.tsx')).toMatch(/<SoftChip label="붙여넣기"/)
  })

  it('두 칩은 같은 모양(바탕·둥글기·안쪽 여백·글)이다', async () => {
    setClipboardProbe(async () => true)
    setClipboardReader(async () => 'https://youtube.com/live/LIVENOW0001')
    render(linkWorld().wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const page = await screen.findByRole('dialog', { name: '라이브 연결' })
    const unknown = within(page).getByRole('button', { name: '링크를 모르겠어요' })
    const paste = await within(page).findByRole('button', { name: '붙여넣기' })
    const look = (button: Element) => {
      const face = getComputedStyle(button.firstElementChild!)
      const text = getComputedStyle(button.querySelector('[dir], div[class] > div, span') ?? button.firstElementChild!)
      return [face.backgroundColor, face.borderTopLeftRadius, face.paddingLeft, face.paddingTop, text.fontSize, text.color]
    }
    expect(look(paste)).toEqual(look(unknown))
  })

  it('클립보드를 못 읽으면(허용 안 함) 칸은 그대로 비고 오류도 없다', async () => {
    setClipboardProbe(async () => true)
    setClipboardReader(async () => '')
    render(linkWorld().wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const page = await screen.findByRole('dialog', { name: '라이브 연결' })
    fireEvent.click(await within(page).findByRole('button', { name: '붙여넣기' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(page.textContent).not.toContain('알 수 없는 링크예요')
    expect((within(page).getByRole('textbox', { name: '라이브 링크' }) as HTMLInputElement).value).toBe('')
  })
})
