// 앱에서 연 탭 (PAY2 AC-PAY2-04·05, BILLING_RULES BL-11 3, D-PAY-04): `from=app`으로 연 탭은 그 탭이 닫힐 때까지 요금 메뉴·띠·"요금 화면 열기"·
// "요금 안내" 링크가 없고 `/billing`·`/pricing`은 `/`로. 새로 고침·다른 주소·로그아웃 뒤에도 같고, 다른 탭(새 탭 저장소)·값이 정확히 app이 아닌 주소에는 번지지 않는다.
// 요금 기능이 꺼진 서버는 표시와 상관없이 지금 그대로다.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { APP_NO_PASS_MESSAGE, isAppTab, rememberAppTab, resetAppTabMemory, withFromApp } from '../src/lib/app-tab.ts'
import { NO_PASS_MESSAGE } from '../src/lib/billing-words.ts'
import { billingServer, billingStatus, type BillingFake } from './billing-support.ts'
import { DATE, FakeEventSource, apiError, flush } from './support.ts'

let fake: BillingFake

/** 새 탭: 탭 저장소도 문서 기억도 비어 있다 */
function newTab(path: string): void {
  window.sessionStorage.clear()
  resetAppTabMemory()
  window.history.replaceState(null, '', path)
}

beforeEach(() => {
  fake = billingServer()
  vi.stubGlobal('fetch', fake.server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  newTab('/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
  for (const script of document.querySelectorAll('script')) script.remove()
  newTab('/')
})

function wideScreen(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

async function open(path: string): Promise<void> {
  window.history.replaceState(null, '', path)
  render(<App />)
  await flush(15)
}

/** 화면 어디에도 요금 메뉴·띠·링크·BL-4 1.5 문장이 없다 */
function expectNothingAboutBilling(): void {
  expect(screen.queryByRole('link', { name: '요금' })).toBeNull()
  expect(screen.queryByRole('region', { name: '요금 알림' })).toBeNull()
  expect(screen.queryByRole('link', { name: '요금 화면 열기' })).toBeNull()
  expect(screen.queryByRole('link', { name: '요금 안내' })).toBeNull()
  expect(document.body.textContent ?? '').not.toContain('요금 화면에서')
  expect([...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))).not.toContain('/billing')
}

/** 띠 조건: 이용권 없음 + 정액제가 끝난 지 3일 */
const NO_PASS_STATUS = () =>
  billingStatus({
    flat: { active: false, until: null, endedAt: '2026-10-17T11:00:00.000Z', chain: [] },
    banners: [{ kind: 'FLAT_ENDED', at: '2026-10-17T11:00:00.000Z' }, { kind: 'NO_PASS' }],
  })

describe('앱에서 연 탭 기억 (BL-11 3.2)', () => {
  it('값이 정확히 app일 때만 기억하고, 탭 저장소에 남는다', () => {
    expect(rememberAppTab('?from=APP')).toBe(false)
    expect(rememberAppTab('?from=app2')).toBe(false)
    expect(rememberAppTab('?from=')).toBe(false)
    expect(rememberAppTab('?date=2026-10-31&from=app')).toBe(true)
    resetAppTabMemory()
    expect(isAppTab()).toBe(true)
    window.sessionStorage.clear()
    expect(isAppTab()).toBe(false)
  })

  it('앱이 여는 주소 붙이기: 검색값 뒤에 더하고, 밖 주소는 그대로', () => {
    expect(withFromApp('https://a.example/settlements?date=2026-10-31', 'https://a.example')).toBe('https://a.example/settlements?date=2026-10-31&from=app')
    expect(withFromApp('https://a.example/buyers', 'https://a.example')).toBe('https://a.example/buyers?from=app')
    expect(withFromApp('https://a.example/buyers?from=app', 'https://a.example')).toBe('https://a.example/buyers?from=app')
    expect(withFromApp('https://policies.google.com/privacy', 'https://a.example')).toBe('https://policies.google.com/privacy')
  })
})

describe('요금 기능 켜짐, 이용권 없는 판매자의 앱에서 연 탭 (AC-PAY2-04)', () => {
  beforeEach(() => {
    fake.status = NO_PASS_STATUS()
  })

  it('PC: /settings?from=app — 위 줄에 "요금"이 없다', async () => {
    wideScreen()
    await open('/settings?from=app')
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '입금 확인', '포장', '라벨', '택배', '설정'])
    expectNothingAboutBilling()
  })

  it('휴대폰: "더보기" 목록에 "요금"이 없다', async () => {
    await open('/settings?from=app')
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    fireEvent.click(within(menu).getByRole('button', { name: '더보기' }))
    expect(within(within(menu).getByRole('list')).getAllByRole('link').map((link) => link.textContent)).not.toContain('요금')
  })

  it('홈: 알림 띠가 없고, 새 방송 칸의 이용권 없음은 앱 문장만 — 실제 방송 시작 거절도 앱 문장, "요금 화면 열기" 없음', async () => {
    fake.server.on('POST', /^\/api\/broadcasts$/, (call) => (call.body?.rehearsal === true ? { body: { broadcast: { id: 'r1', date: DATE, title: '리허설 1', rehearsal: true } } } : apiError(422, 'NO_PASS', NO_PASS_MESSAGE)))
    rememberAppTab('?from=app')
    await open('/')
    await screen.findByRole('heading', { name: '방송 목록' })
    expectNothingAboutBilling()
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    const form = screen.getByRole('form', { name: '새 방송' })
    expect(within(form).getByText(APP_NO_PASS_MESSAGE)).toBeTruthy()
    expectNothingAboutBilling()
    fireEvent.click(within(form).getByRole('button', { name: '이 방송 시작하기' }))
    await waitFor(() => expect(fake.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1))
    await flush(10)
    expect(screen.getAllByText(APP_NO_PASS_MESSAGE)).toHaveLength(1)
    expectNothingAboutBilling()
  })

  it.each(['/billing', '/billing?paymentId=x', '/pricing'])('같은 탭에서 %s → 주소가 /, 요금 화면 글 없음, 결제 창 스크립트 없음', async (path) => {
    rememberAppTab('?from=app')
    await open(path)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    await screen.findByRole('heading', { name: '방송 목록' })
    expect(screen.queryByText('이용권 사기')).toBeNull()
    expect(screen.queryByRole('heading', { name: '요금', level: 1 })).toBeNull()
    expect(screen.queryByRole('heading', { name: '요금 안내' })).toBeNull()
    expect(document.querySelectorAll('script')).toHaveLength(0)
    expect(fake.server.callsTo('POST', /^\/api\/billing/)).toHaveLength(0)
    expectNothingAboutBilling()
  })

  it('새로 고침(다시 그림)·표시 없는 /buyers로 옮긴 뒤에도 숨김이 남는다', async () => {
    fake.server.on('GET', /^\/api\/days/, () => ({ body: { days: [] } }))
    wideScreen()
    await open('/settings?from=app')
    cleanup()
    resetAppTabMemory() // 새로 고침: 문서 기억은 사라지고 탭 저장소만 남는다
    await open('/buyers')
    expect(within(screen.getByRole('navigation', { name: '메뉴' })).queryByRole('link', { name: '요금' })).toBeNull()
    cleanup()
    await open('/billing')
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('로그아웃 상태의 그 탭: 소개 화면·로그인 화면에 "요금 안내"가 없다', async () => {
    fake.server.on('GET', /^\/api\/me$/, () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.'))
    await open('/?from=app')
    await screen.findByRole('link', { name: '개인정보처리방침' })
    expect(screen.queryByRole('link', { name: '요금 안내' })).toBeNull()
    cleanup()
    await open('/login')
    await screen.findByRole('link', { name: '개인정보처리방침' })
    expect(screen.queryByRole('link', { name: '요금 안내' })).toBeNull()
  })

  it('정액제 이용 중이면 미리 보기 줄 "정액제로 시작해요 (…까지)."는 그대로 보인다', async () => {
    fake.status = billingStatus({
      flat: { active: true, until: '2026-11-19T11:31:00.000Z', endedAt: null, chain: [] },
      start: { allowed: true, mode: 'FLAT', useDay: false, flatUntil: '2026-11-19T11:31:00.000Z', windowUntil: null, days: null, orders: null },
      banners: [{ kind: 'FLAT_REMAINING', days: 3, until: '2026-11-19T11:31:00.000Z' }],
    })
    rememberAppTab('?from=app')
    await open('/')
    await screen.findByRole('heading', { name: '방송 목록' })
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    expect(within(screen.getByRole('form', { name: '새 방송' })).getByText('정액제로 시작해요 (11/19 20:31까지).')).toBeTruthy()
    expectNothingAboutBilling()
  })
})

describe('숨김이 번지지 않는다 (AC-PAY2-05)', () => {
  beforeEach(() => {
    fake.status = NO_PASS_STATUS()
  })

  it('표시 없이 연 새 탭: 메뉴 "요금"·띠·"요금 화면 열기"·/billing이 그대로', async () => {
    wideScreen()
    await open('/settings?from=app')
    cleanup()
    newTab('/')
    await open('/')
    await screen.findByRole('heading', { name: '방송 목록' })
    expect(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '요금' })).toBeTruthy()
    const region = screen.getByRole('region', { name: '요금 알림' })
    fireEvent.click(within(region).getByRole('link', { name: '요금 화면 열기' }))
    expect(await screen.findByRole('heading', { name: '요금', level: 1 })).toBeTruthy()
    expect(window.location.pathname).toBe('/billing')
  })

  it.each(['?from=APP', '?from=app2', '?from=ap'])('%s는 숨기지 않는다', async (search) => {
    wideScreen()
    await open(`/settings${search}`)
    expect(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '요금' })).toBeTruthy()
  })

  it('요금 기능이 꺼진 서버: from=app이 있든 없든 지금 그대로 (메뉴 없음, /billing은 없는 화면)', async () => {
    fake.config = { enabled: false, testPayment: false }
    wideScreen()
    await open('/billing?from=app')
    expect(await screen.findByRole('heading', { name: '찾을 수 없는 화면이에요.' })).toBeTruthy()
    expect(window.location.pathname).toBe('/billing')
    expect(screen.queryByRole('link', { name: '요금' })).toBeNull()
  })
})
