// 진입점 (AC-S00-50): index.html의 본문에 main.tsx가 첫 화면을 붙이고, 그동안 서버를 부르지 않는다.
import { act, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('index.html의 #root에 첫 화면이 뜬다', async () => {
  const fetch = vi.fn()
  const XMLHttpRequest = vi.fn()
  const WebSocket = vi.fn()
  const EventSource = vi.fn()
  vi.stubGlobal('fetch', fetch)
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
  const heading = await screen.findByRole('heading', { level: 1, name: '라이브찜' })
  expect(root?.contains(heading)).toBe(true)
  expect(screen.getByText('준비 중이에요.')).toBeDefined()

  expect(fetch).not.toHaveBeenCalled()
  expect(XMLHttpRequest).not.toHaveBeenCalled()
  expect(WebSocket).not.toHaveBeenCalled()
  expect(EventSource).not.toHaveBeenCalled()
})
