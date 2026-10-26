// QL2 5회차 D-QL2-14 (1) — 휴대폰 현재 상품 요약 줄은 고정 영역 맨 위(제목 바로 아래, 알림 띠 위).
// 아래(알림 펼침·되돌리기 대기·리허설·큰 글씨)가 늘어나도 요약은 제목 밑에 남는다(TE-QL2-006: 맨 끝이던 393 WebKit 150%에서 막대 밑).
// 화면 위치(막대 위 끝보다 위)는 E2E가 잰다(AC-QL2-01). 여기선 문서 차례만 본다. jsdom에는 matchMedia가 없어 휴대폰 모양이다.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { T0, chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { FakeEventSource, fixtureClock, flush } from './support.ts'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
  const engine = new EngineServer([register(15, '핑크프릴', 10000), chat('m1', 'c1', '가', '15'), chat('m2', 'c2', '나', '20'), chat('m3', 'c3', '다', '21')])
  vi.stubGlobal('fetch', engine.server.fetch)
  fixtureClock(T0) // MOB2 D-MOB2-06 — 보류 찜이 막 들어온 방송(알림 띠에 보류 찜 2)
})

afterEach(() => {
  vi.useRealTimers() // MOB2 D-MOB2-06
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

function before(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('휴대폰 요약 줄 자리 (D-QL2-14 (1), AC-QL2-01)', () => {
  it('고정 영역의 첫 자식이고, 알림 띠·빠른 입력보다 앞, 제목보다 뒤', async () => {
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    const quick = await screen.findByLabelText('빠른 입력')
    await flush(10)
    const summary = screen.getByRole('status', { name: '현재 상품 요약' })
    const sticky = summary.closest('.console-sticky')
    expect(sticky).not.toBeNull()
    expect(sticky?.firstElementChild).toBe(summary)
    // 빠른 입력 묶음(알림 띠·빠른 입력·등록하면·되돌리기 띠) 안에는 없다
    expect(summary.closest('.console-sticky-quick')).toBeNull()
    const toggle = screen.getByRole('button', { name: /^알림 \d+ 펼치기$/ })
    expect(before(summary, toggle)).toBe(true)
    expect(before(summary, quick)).toBe(true)
    expect(before(screen.getByRole('heading', { level: 1 }), summary)).toBe(true)
    // 수량 1에 1등 "가" — 판매 완료
    expect(summary.textContent).toBe('15번 핑크프릴 · 판매 완료 · 1등 가 · 대기 0명')
  })

  it('요약 줄은 누르는 기능이 없다 — Tab 차례에 들지 않는다(AC-QL2-02)', async () => {
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    const summary = screen.getByRole('status', { name: '현재 상품 요약' })
    expect(summary.tabIndex).toBe(-1)
    expect(summary.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
  })

  it('PC 폭(48rem 이상)에는 요약 줄이 없다', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    expect(screen.queryByRole('status', { name: '현재 상품 요약' })).toBeNull()
  })
})
