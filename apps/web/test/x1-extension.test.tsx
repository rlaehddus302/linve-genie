// X1 크롬 확장 화면 (AC-X1-08·16·17·19, YT-10 AC4·AC7·AC8): 설정 "확장 연결"·코드·다시 만들기·끊기, 콘솔 받는 경로·경고·손 입력 버튼.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectorView, ExtensionView } from '../src/api/types.ts'
import { ExtensionRouteLine, ExtensionSettings, ExtensionWarningBar, useExtension } from '../src/components/ExtensionConnection.tsx'
import { codeWords, EXTENSION_ROUTE, extensionWarning, parseExtensionEvent, routeWords } from '../src/lib/extension.ts'
import { parseRoute, routePath } from '../src/lib/router.ts'
import { FakeEventSource, FakeServer, apiError, type Reply } from './support.ts'

const B = 'b-2026-10-23-1'

function extView(patch: Partial<ExtensionView> = {}): ExtensionView {
  return { connected: false, connectedAt: null, lastUsedAt: null, state: 'NONE', message: null, manual: null, broadcasts: [], statusAt: null, lastChatAt: null, dropped: 0, ...patch }
}

const receiving = (patch: Partial<ExtensionView> = {}) => extView({ connected: true, connectedAt: '2026-10-23T05:00:00.000Z', state: 'RECEIVING', message: '확장으로 받는 중', broadcasts: [B], ...patch })

function collector(status: CollectorView['status']): CollectorView {
  return { status, statusMessage: '받는 중', reason: null, reasonMessage: null, mode: 'STREAM', lastMessageAt: null, recorded: 0, skippedBeforeLink: 0, gap: false, gapMessage: null, restartable: false }
}

describe('lib/extension', () => {
  it('AC-X1-17: 받는 경로 문장', () => {
    expect(routeWords(collector('LIVE'), null, B)).toBe(EXTENSION_ROUTE.OFFICIAL)
    expect(routeWords(null, receiving(), B)).toBe(EXTENSION_ROUTE.EXTENSION)
    expect(routeWords(collector('LIVE'), receiving(), B)).toBe(EXTENSION_ROUTE.BOTH)
    expect(routeWords(collector('STOPPED'), receiving({ broadcasts: ['other'] }), B)).toBeNull()
    expect(routeWords(collector('RETRYING'), receiving({ state: 'STALE' }), B)).toBeNull()
    expect(Object.values(EXTENSION_ROUTE)).toEqual(['공식 연결로 받는 중', '확장으로 받는 중', '공식 연결·확장 둘 다로 받는 중'])
  })

  it('경고 상태·코드 모양·SSE 읽기', () => {
    expect(extensionWarning(receiving({ state: 'STALE' }))).toBe(true)
    expect(extensionWarning(receiving({ state: 'HIDDEN' }))).toBe(true)
    expect(extensionWarning(receiving({ state: 'UNREADABLE' }))).toBe(true)
    expect(extensionWarning(receiving())).toBe(false)
    expect(extensionWarning(extView({ state: 'STALE' }))).toBe(false)
    expect(codeWords('12345678')).toBe('1234 5678')
    expect(parseExtensionEvent(JSON.stringify(receiving()))).toEqual(receiving())
    expect(parseExtensionEvent('{"x":1}')).toBeNull()
    expect(parseExtensionEvent('nope')).toBeNull()
  })

  it('/settings/extension 주소', () => {
    expect(parseRoute('/settings/extension', '')).toMatchObject({ name: 'settings', section: 'extension' })
    expect(routePath({ name: 'settings', section: 'extension' })).toBe('/settings/extension')
  })
})

let server: FakeServer
let view: ExtensionView

beforeEach(() => {
  server = new FakeServer()
  view = extView()
  server
    .on('GET', /^\/api\/extension$/, (): Reply => ({ body: { extension: view } }))
    .on('POST', /^\/api\/extension\/code$/, (): Reply => ({ body: { code: '12345678', expiresAt: new Date(Date.now() + 600_000).toISOString() } }))
    .on('POST', /^\/api\/extension\/renew$/, (): Reply => {
      view = extView()
      return { body: { code: '87654321', expiresAt: new Date(Date.now() + 600_000).toISOString() } }
    })
    .on('POST', /^\/api\/extension\/disconnect$/, (): Reply => {
      view = extView()
      return { body: { extension: view } }
    })
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Settings() {
  const handle = useExtension()
  return <ExtensionSettings handle={handle} />
}

describe('설정 — 확장 연결 (AC-X1-08)', () => {
  // MOB1 D-MOB1-09: 휴대폰 폭 설정의 크롬 확장 칸은 한 줄 안내뿐 — 이 묶음은 PC 폭(지금 그대로)으로 본다
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  })

  it('"확장 연결" → 8자리 코드, 확장이 연결되면 코드를 내리고 알린다', async () => {
    render(<Settings />)
    const connect = await screen.findByRole('button', { name: '확장 연결' })
    expect(screen.getByText('연결된 확장이 없어요.')).toBeTruthy()
    fireEvent.click(connect)
    const code = await screen.findByRole('group', { name: '연결 코드' })
    expect(within(code).getByText('1234 5678')).toBeTruthy()
    expect(within(code).getByText(/10분 안에 한 번만/)).toBeTruthy()
    expect(server.callsTo('POST', /^\/api\/extension\/code$/)[0]?.body).toEqual({})
    // 확장이 코드를 넣으면 서버가 알린다
    act(() => FakeEventSource.last.emit('extension', receiving({ broadcasts: [] })))
    await waitFor(() => expect(screen.queryByRole('group', { name: '연결 코드' })).toBeNull())
    expect(screen.getByText('확장이 연결됐어요.')).toBeTruthy()
    expect(screen.getByText('● 확장이 연결돼 있어요')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 만들기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '끊기' })).toBeTruthy()
  })

  it('10분이 지나면 새 코드를 받으라고 (끝나는 시각에 맞춰 바뀐다)', async () => {
    server.on('POST', /^\/api\/extension\/code$/, (): Reply => ({ body: { code: '12345678', expiresAt: new Date(Date.now() + 150).toISOString() } }))
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: '확장 연결' }))
    expect(await screen.findByText('1234 5678')).toBeTruthy()
    expect(screen.queryByText(/코드 시간이 지났어요/)).toBeNull()
    expect(await screen.findByText(/코드 시간이 지났어요/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '새 코드 받기' })).toBeTruthy()
  })

  it('다시 만들기는 묻고 새 코드를 보인다, 끊기는 묻고 끊는다', async () => {
    view = receiving()
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: '다시 만들기' }))
    const dialog = screen.getByRole('dialog', { name: '확장 연결을 다시 만들까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 만들기' }))
    expect(await screen.findByText('8765 4321')).toBeTruthy()
    expect(server.callsTo('POST', /^\/api\/extension\/renew$/)).toHaveLength(1)

    cleanup()
    view = receiving()
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: '끊기' }))
    const ask = screen.getByRole('dialog', { name: '확장 연결을 끊을까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: '끊기' }))
    expect(await screen.findByText('연결된 확장이 없어요.')).toBeTruthy()
    expect(server.callsTo('POST', /^\/api\/extension\/disconnect$/)).toHaveLength(1)
  })

  it('코드를 받지 못하면 서버 문장', async () => {
    server.on('POST', /^\/api\/extension\/code$/, () => apiError(403, 'FORBIDDEN', '지금은 할 수 없어요.'))
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: '확장 연결' }))
    expect(await screen.findByText('지금은 할 수 없어요.')).toBeTruthy()
  })

  it('U-TTX-02·AC-TTX-33 (3): 확장 칸 설명에 표의 틱톡 문장이 글자 그대로 있고 "서버" 낱말이 없다', async () => {
    render(<Settings />)
    await screen.findByRole('button', { name: '확장 연결' })
    const intro = screen.getByText(/틱톡도 같은 확장으로 받을 수 있어요/).textContent ?? ''
    expect(intro).toContain('틱톡도 같은 확장으로 받을 수 있어요. 틱톡 연결이 막혔을 때 이 크롬에서 내 틱톡 방송 화면을 열어 두면 확장이 댓글을 대신 읽어 보내요.')
    expect(intro).not.toContain('서버')
  })

  it('영어 상태값을 보이지 않는다', async () => {
    view = receiving({ state: 'UNREADABLE', message: '유튜브 화면이 바뀌어 채팅을 읽지 못해요', manual: '주문은 손으로 넣어 주세요', dropped: 3 })
    const { container } = render(<Settings />)
    expect(await screen.findByText('! 유튜브 화면이 바뀌어 채팅을 읽지 못해요')).toBeTruthy()
    expect(container.textContent).not.toMatch(/UNREADABLE|RECEIVING|STALE|HIDDEN|NONE/)
    expect(screen.getByText(/놓친 채팅이 있어요/)).toBeTruthy()
  })
})

describe('콘솔 (AC-X1-16·17)', () => {
  it('경고 한 줄과 손으로 넣기 버튼 (이 방송에 이어진 확장일 때만)', () => {
    const navigate = vi.fn()
    const stale = receiving({ state: 'STALE', message: '확장에서 채팅이 오지 않아요', manual: '주문은 손으로 넣어 주세요' })
    const { rerender } = render(<ExtensionWarningBar view={stale} broadcastId={B} ended={false} navigate={navigate} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('확장에서 채팅이 오지 않아요')
    expect(alert.textContent).toContain('주문은 손으로 넣어 주세요')
    fireEvent.click(within(alert).getByRole('link', { name: '손으로 넣기' }))
    expect(navigate).toHaveBeenCalledWith({ name: 'sms' })
    rerender(<ExtensionWarningBar view={receiving({ state: 'HIDDEN', message: '유튜브 채팅 창을 앞으로 꺼내 두세요', manual: '주문은 손으로 넣어 주세요' })} broadcastId={B} ended={false} navigate={navigate} />)
    expect(screen.getByRole('alert').textContent).toContain('유튜브 채팅 창을 앞으로 꺼내 두세요')
    rerender(<ExtensionWarningBar view={stale} broadcastId="other" ended={false} navigate={navigate} />)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<ExtensionWarningBar view={stale} broadcastId={B} ended navigate={navigate} />)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<ExtensionWarningBar view={receiving()} broadcastId={B} ended={false} navigate={navigate} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('받는 경로 한 줄', () => {
    const { rerender, container } = render(<ExtensionRouteLine collector={collector('LIVE')} view={receiving()} broadcastId={B} />)
    expect(screen.getByRole('group', { name: '채팅 받는 길' }).textContent).toContain('공식 연결·확장 둘 다로 받는 중')
    rerender(<ExtensionRouteLine collector={null} view={receiving()} broadcastId={B} />)
    expect(container.textContent).toContain('확장으로 받는 중')
    rerender(<ExtensionRouteLine collector={collector('LIVE')} view={null} broadcastId={B} />)
    expect(container.textContent).toContain('공식 연결로 받는 중')
    rerender(<ExtensionRouteLine collector={null} view={null} broadcastId={B} />)
    expect(container.textContent).toBe('')
  })
})
