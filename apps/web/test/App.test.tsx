// 첫 화면 (AC-S00-50): 제목 "라이브찜", 문장 "준비 중이에요.", 영어·개발 용어 없음, 서버 호출 없음.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('첫 화면', () => {
  it('제목(heading) "라이브찜"이 하나 있다', () => {
    render(<App />)
    const headings = screen.getAllByRole('heading')
    expect(headings).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: '라이브찜' })).toBe(headings[0])
  })

  it('문장 "준비 중이에요."가 보인다', () => {
    render(<App />)
    const sentence = screen.getByText('준비 중이에요.')
    expect(sentence.tagName).toBe('P')
  })

  it('화면 전체가 main 영역 안에 있다', () => {
    const { container } = render(<App />)
    const main = screen.getByRole('main')
    expect(main).toBe(container.firstElementChild)
    expect(main.textContent).toBe('라이브찜준비 중이에요.')
  })

  it('보이는 글자에 영어(로마자)가 없다', () => {
    const { container } = render(<App />)
    expect(container.textContent).not.toMatch(/[A-Za-z]/)
    for (const element of container.querySelectorAll('*')) {
      for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
        expect(element.getAttribute(name) ?? '').not.toMatch(/[A-Za-z]/)
      }
    }
  })

  it('고정 폭을 만드는 인라인 스타일이 없다 (375px 폭)', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[style]')).toHaveLength(0)
  })

  it('그리는 동안 서버를 부르지 않는다', () => {
    const fetch = vi.fn()
    const XMLHttpRequest = vi.fn()
    const WebSocket = vi.fn()
    const EventSource = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequest)
    vi.stubGlobal('WebSocket', WebSocket)
    vi.stubGlobal('EventSource', EventSource)

    render(<App />)
    expect(screen.getByRole('heading', { name: '라이브찜' })).toBeDefined()

    expect(fetch).not.toHaveBeenCalled()
    expect(XMLHttpRequest).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
    expect(EventSource).not.toHaveBeenCalled()
  })
})
