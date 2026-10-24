// FB1 간편 로그인 이동 (D-FB1-08, AC-FB1-32·33): 남은 값이 있으면 연결 요청 전에 앱이 먼저 묻고, 떠나기로 했으면 브라우저 확인이 다시 뜨지 않는다.
// 5초 안에 페이지가 떠나지 않으면 버튼을 되돌리고 "카카오로 가지 못했어요. 다시 눌러 주세요.".
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { LEAVE_STUCK_MS, goTopLevelWatched, setTopLevelNavigation } from '../src/lib/google-return.ts'
import { stuckMessage } from '../src/lib/social-login.ts'
import { FakeEventSource, FakeServer, flush, youtubeNotConfigured } from './support.ts'

let server: FakeServer
let assigned: string[]

const AUTHORIZE = (p: string) => `http://127.0.0.1:4104/${p}/authorize?state=s1`

beforeEach(() => {
  server = new FakeServer()
  assigned = []
  setTopLevelNavigation((url) => assigned.push(url))
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1', role: 'SELLER', assistant: null } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, loginProviders: ['kakao', 'naver', 'google'] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: DEFAULT_SETTINGS } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/youtube\/connection$/, () => youtubeNotConfigured)
    .on('GET', /^\/api\/assistants$/, () => ({ body: { assistants: [], limit: 5 } }))
    .on('GET', /^\/api\/auth\/methods$/, () => ({
      body: { loginId: 'shop1', providers: (['kakao', 'naver', 'google'] as const).map((provider) => ({ provider, enabled: true, linked: false, label: '', linkedAt: null })) },
    }))
    .on('POST', /^\/api\/auth\/link$/, (call) => ({ body: { authorizeUrl: AUTHORIZE(String(call.body?.provider)) } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/settings')
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

async function openSettings() {
  render(<App />)
  await screen.findByRole('heading', { name: '설정', level: 1 })
  await screen.findByRole('region', { name: '로그인 방법' })
  await flush()
}

const methods = () => screen.getByRole('region', { name: '로그인 방법' })
const linkCalls = () => server.callsTo('POST', /^\/api\/auth\/link$/)
function unloadAsks(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
function changeRule() {
  fireEvent.change(within(screen.getByRole('region', { name: '판매 규칙' })).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '7' } })
}

describe('남은 값이 있으면 앱이 먼저 묻는다 (AC-FB1-32)', () => {
  for (const [provider, name] of [
    ['kakao', '카카오'],
    ['naver', '네이버'],
    ['google', '구글'],
  ] as const) {
    it(`${name}: 요청 전에 앱 창(처음 포커스 "닫기") — 닫기면 요청 없음·버튼 그대로·값 그대로, 떠나기면 요청 → 이동, 브라우저 확인 없음`, async () => {
      await openSettings()
      changeRule()
      expect(unloadAsks()).toBe(true)
      fireEvent.click(within(methods()).getByRole('button', { name: `${name} 연결하기` }))
      let dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
      expect(within(dialog).getByText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')).toBeDefined()
      expect(document.activeElement?.textContent).toBe('닫기')
      expect(linkCalls()).toHaveLength(0)
      fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
      await flush()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(linkCalls()).toHaveLength(0)
      expect(within(methods()).getByRole('button', { name: `${name} 연결하기` }).textContent).toBe('연결하기')
      expect(within(screen.getByRole('region', { name: '판매 규칙' })).getByLabelText('대기 인원 (0이면 대기 없음)')).toHaveProperty('value', '7')
      // Esc도 닫기
      fireEvent.click(within(methods()).getByRole('button', { name: `${name} 연결하기` }))
      dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await flush()
      expect(linkCalls()).toHaveLength(0)
      fireEvent.click(within(methods()).getByRole('button', { name: `${name} 연결하기` }))
      dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
      fireEvent.click(within(dialog).getByRole('button', { name: '저장하지 않고 떠나기' }))
      expect(await within(methods()).findByText(`${name}로 이동하는 중…`)).toBeDefined()
      await waitFor(() => expect(assigned).toEqual([AUTHORIZE(provider)]))
      expect(linkCalls().map((call) => call.body)).toEqual([{ provider }])
      expect(unloadAsks()).toBe(false)
      expect(window.location.pathname).toBe('/settings')
    })
  }
})

describe('못 떠나면 되돌린다 (AC-FB1-33)', () => {
  it('이동을 시작하고 5초 안에 페이지가 떠나지 않으면 버튼이 "연결하기"로, 고른 공급자 이름의 문장(alert), 브라우저 확인은 다시 묻는다', async () => {
    await openSettings()
    changeRule()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(within(methods()).getByRole('button', { name: '네이버 연결하기' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '저장하지 않고 떠나기' }))
    await waitFor(() => expect(assigned).toEqual([AUTHORIZE('naver')]))
    expect(within(methods()).getByText('네이버로 이동하는 중…')).toBeDefined()
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_STUCK_MS - 100)
      await Promise.resolve()
    })
    expect(within(methods()).queryByRole('alert')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(within(methods()).getByRole('alert').textContent).toBe('네이버로 가지 못했어요. 다시 눌러 주세요.')
    const button = within(methods()).getByRole('button', { name: '네이버 연결하기' })
    expect(button.textContent).toBe('연결하기')
    expect(button).toHaveProperty('disabled', false)
    expect(unloadAsks()).toBe(true)
  })

  it('그 전에 페이지가 떠나면(pagehide) 아무 일도 없다', () => {
    vi.useFakeTimers()
    const stuck = vi.fn()
    goTopLevelWatched('http://example.test/a', stuck)
    expect(assigned).toEqual(['http://example.test/a'])
    window.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersByTime(LEAVE_STUCK_MS * 2)
    expect(stuck).not.toHaveBeenCalled()
  })

  it('남은 값이 없어도 막히면 같은 되돌림', async () => {
    await openSettings()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(within(methods()).getByRole('button', { name: '카카오 연결하기' }))
    await waitFor(() => expect(assigned).toEqual([AUTHORIZE('kakao')]))
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_STUCK_MS + 10)
      await Promise.resolve()
    })
    expect(within(methods()).getByRole('alert').textContent).toBe(stuckMessage('kakao'))
  })
})
