// 진입점 (AC-S00-50 → AC-S05-01): index.html의 #root에 앱이 붙고, 처음 하는 일은 로그인 확인(GET /api/me) 하나다.
// 로그인하지 않았으면 로그인 화면이 뜬다. 외부 리소스·다른 서버 호출은 없다.
import { act, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'
import { FakeServer, apiError } from './support.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('index.html의 #root에 앱이 뜨고, 로그인하지 않았으면 로그인 화면', async () => {
  const server = new FakeServer().on('GET', /^\/api\/me$/, () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.'))
  const XMLHttpRequest = vi.fn()
  const WebSocket = vi.fn()
  const EventSource = vi.fn()
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('XMLHttpRequest', XMLHttpRequest)
  vi.stubGlobal('WebSocket', WebSocket)
  vi.stubGlobal('EventSource', EventSource)

  // 실제 index.html 본문을 그대로 옮긴다(스크립트 태그는 빼고). #root 이름이 어긋나면 여기서 드러난다.
  const page = new DOMParser().parseFromString(indexHtml, 'text/html')
  for (const script of page.body.querySelectorAll('script')) script.remove()
  document.body.replaceChildren(...[...page.body.childNodes].map((node) => document.importNode(node, true)))

  await act(async () => {
    await import('../src/main.tsx')
  })

  const root = document.getElementById('root')
  expect(root).not.toBeNull()
  const button = await screen.findByRole('button', { name: '로그인' })
  expect(root?.contains(button)).toBe(true)
  expect(screen.getByRole('heading', { level: 1, name: '라이브지니' })).toBeDefined()

  // 처음은 같은 출처의 로그인 확인 (개발 모드 StrictMode는 처음 확인을 두 번 할 수 있다).
  // 로그인 화면이 뜬 뒤에는 간편 로그인 버튼을 정하려고 같은 출처의 화면 설정을 읽는다 (L1 AC-L1-20) — 그 밖의 호출은 없다
  expect(server.calls.length).toBeGreaterThan(0)
  expect(server.calls[0]?.path).toBe('/api/me')
  expect(new Set(server.calls.map((call) => `${call.method} ${call.path}`))).toEqual(new Set(['GET /api/me', 'GET /api/client-config']))
  expect(server.calls.every((call) => call.credentials === 'include')).toBe(true)
  expect(XMLHttpRequest).not.toHaveBeenCalled()
  expect(WebSocket).not.toHaveBeenCalled()
  expect(EventSource).not.toHaveBeenCalled()
})
