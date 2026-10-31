// 공개 요금 안내 `/pricing` (PAY2 AC-PAY2-13, SPEC §7 화면 18, BILLING_RULES BL-12, D-PAY-11): 로그인 없이, 서버 공개 요금 입구의 `{ ready, items }`만으로.
// 서버 입구는 dev-server가 같이 만든다 — 여기서는 acceptance 모양대로 가짜 서버로 본다.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { PRICING_NOT_READY, PUBLIC_PRICING_PATH, amountWords, readPublicPricing } from '../src/components/PricingPage.tsx'
import { TERMS } from '../src/lib/billing-words.ts'
import { resetAppTabMemory } from '../src/lib/app-tab.ts'
import { FakeEventSource, FakeServer, apiError, flush } from './support.ts'

const READY = {
  ready: true,
  items: [
    { id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', quantity: null, price: 30000 },
    { id: 'days-5', name: '방송 일권 5일', kind: 'DAYS', quantity: 5, price: 22000 },
  ],
}

let server: FakeServer
let pricing: unknown
let signedIn: boolean

beforeEach(() => {
  window.sessionStorage.clear()
  resetAppTabMemory()
  pricing = READY
  signedIn = false
  server = new FakeServer()
  server
    .on('GET', /^\/api\/me$/, () => (signedIn ? { body: { seller: { name: '구피 가게' }, loginId: 'shop1' } } : apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.')))
    .on('GET', /^\/api\/pricing$/, () => ({ body: pricing }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, billing: { enabled: true, testPayment: true } } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/pricing')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
})

async function openPricing(): Promise<HTMLElement> {
  const view = render(<App />)
  await screen.findByRole('heading', { name: '요금 안내', level: 1 })
  await flush(10)
  return view.container
}

describe('요금 안내 화면 (AC-PAY2-13)', () => {
  it('(1) ready: 표(이름·양·가격 + 부가세 포함)·수단·증빙·자동 갱신 없음·환불 규정·약관 전문·운영 사업자', async () => {
    const container = await openPricing()
    expect(PUBLIC_PRICING_PATH).toBe('/api/pricing')
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
      ['정액제 30일정액제', '30일', '30,000원부가세 포함'],
      ['방송 일권 5일방송 일권', '5일', '22,000원부가세 포함'],
    ])
    const text = container.textContent ?? ''
    for (const line of ['카드·계좌이체', '카드 결제는 카드 매출전표, 계좌이체는 현금영수증(지출증빙)', '자동으로 갱신·결제되지 않아요.', '상호: 틈(TEUM)']) expect(text).toContain(line)
    expect(screen.getByRole('heading', { name: '환불 규정' })).toBeTruthy()
    for (const clause of TERMS) expect(text).toContain(clause.text)
    expect(text).not.toContain(PRICING_NOT_READY)
    // 위 줄은 정책 페이지와 같다 — 로그아웃 상태면 "로그인 화면으로"
    expect(screen.getByRole('link', { name: '로그인 화면으로' }).getAttribute('href')).toBe('/login')
  })

  it.each([
    ['자리 표시·꺼짐', { ready: false, items: [] }],
    ['모양이 다른 응답', { ready: true, items: [{ id: 'x', name: 'x', kind: 'NOPE', price: 1 }] }],
  ])('(2) %s: "요금은 준비 중이에요."와 운영 사업자만 — 표·"원"·약관 없음', async (_name, body) => {
    pricing = body
    const container = await openPricing()
    expect(screen.getByText(PRICING_NOT_READY)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    const text = container.textContent ?? ''
    expect(text).toContain('상호: 틈(TEUM)')
    expect(text).not.toMatch(/\d원/)
    expect(text).not.toContain(TERMS[0]!.text)
  })

  it('입구가 없는 옛 서버(404)도 준비 중', async () => {
    server.on('GET', /^\/api\/pricing$/, () => apiError(404, 'NOT_FOUND', '없어요.'))
    await openPricing()
    expect(screen.getByText(PRICING_NOT_READY)).toBeTruthy()
  })

  it('(3) 로그인한 채 열어도 같은 내용', async () => {
    signedIn = true
    const container = await openPricing()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
    expect(container.textContent).toContain('자동으로 갱신·결제되지 않아요.')
    // 판매자 세션과 상관없는 같은 공개 입구만 부른다 (요금 상태 /api/billing은 부르지 않는다)
    expect(server.callsTo('GET', /^\/api\/billing/)).toHaveLength(0)
  })

  it('(6) 항목 이름이 <img src=x onerror=alert(1)>이면 글자로 보인다', async () => {
    pricing = { ready: true, items: [{ id: 'x', name: '<img src=x onerror=alert(1)>', kind: 'DAYS', quantity: 1, price: 5000 }] }
    const container = await openPricing()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  })
})

describe('"요금 안내" 링크 (AC-PAY2-13 (4))', () => {
  it('소개 화면과 로그인 화면의 정책 링크 줄에 "요금 안내" → /pricing', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    const landing = await screen.findByRole('navigation', { name: '약관' })
    expect(within(landing).getByRole('link', { name: '요금 안내' }).getAttribute('href')).toBe('/pricing')
    cleanup()
    window.history.replaceState(null, '', '/login')
    render(<App />)
    const login = await screen.findByRole('navigation', { name: '약관' })
    expect(within(login).getAllByRole('link').map((link) => link.textContent)).toEqual(['개인정보처리방침', '이용약관', '요금 안내'])
  })
})

describe('읽기 도우미', () => {
  it('응답 읽기·양 낱말', () => {
    expect(readPublicPricing(null)).toEqual({ ready: false, items: [] })
    expect(readPublicPricing({ ready: true, items: 'x' })).toEqual({ ready: false, items: [] })
    expect(readPublicPricing({ ready: true, items: [{ id: 'a', name: 'A', kind: 'ORDERS', quantity: 1.5, price: 1 }] })).toEqual({ ready: false, items: [] })
    expect(readPublicPricing({ ready: true, items: [{ id: 'a', name: 'A', kind: 'ORDERS', quantity: 100, price: 10000 }] }).items).toHaveLength(1)
    expect(amountWords({ kind: 'FLAT_30D', quantity: null })).toBe('30일')
    expect(amountWords({ kind: 'LABELS', quantity: 100 })).toBe('100장')
  })
})
