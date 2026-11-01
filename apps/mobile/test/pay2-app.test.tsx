// 앱에서 이용권이 없을 때·앱이 여는 웹 주소 (PAY2 AC-PAY2-02·03, BILLING_RULES BL-11 2·3.1, D-PAY-03·04).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { webUrl } from '../src/api/config.ts'
import { openExternal, openWeb, setWebOpener, WEB_SCREENS } from '../src/lib/open-web.ts'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const nav = () => ({ openConsole: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })
const SERVER_NO_PASS = '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.'

function noPassWorld(status = 422, code = 'NO_PASS', message = SERVER_NO_PASS) {
  const world = makeWorld()
  world.server.on('POST', /^\/api\/broadcasts$/, (call) =>
    call.body?.rehearsal === true
      ? { body: { date: '2026-10-31', rehearsal: true, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'r1', date: '2026-10-31', title: '', rehearsal: true } } }
      : { status, body: { error: { code, message } } },
  )
  return world
}

function expectNoBillingWords() {
  const text = document.body.textContent ?? ''
  for (const word of ['요금 화면', '산 뒤', '결제', '요금']) expect(text, word).not.toContain(word)
  expect(document.querySelectorAll('a')).toHaveLength(0)
}

describe('이용권이 없을 때 앱 문장 (AC-PAY2-02)', () => {
  it('새 방송 칸을 연 채 "이 방송 시작하기"가 NO_PASS로 거절되면 앱 문장만 — 서버 문장·링크·새 버튼 없음. 그 뒤 리허설은 한 번 간다', async () => {
    const world = noPassWorld()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    const buttonsBefore = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
    fireEvent.click(screen.getByRole('button', { name: '이 방송 시작하기' }))
    expect(await screen.findByText(APP_NO_PASS_MESSAGE)).toBeTruthy()
    expect(APP_NO_PASS_MESSAGE).toBe('이용권이 없어 실제 방송을 시작할 수 없어요. 리허설은 언제든 할 수 있어요.')
    expectNoBillingWords()
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(buttonsBefore)
    fireEvent.click(screen.getByRole('button', { name: '리허설 해 보기' }))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('r1'))
    expect(world.server.callsTo('POST', /broadcasts/).filter((call) => call.body?.rehearsal === true)).toHaveLength(1)
  })

  it('칸을 닫은 상태에서도 같은 앱 문장이다', async () => {
    const world = noPassWorld()
    render(world.wrap(<HomeScreen nav={nav()} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    fireEvent.click(screen.getByRole('button', { name: '이 방송 시작하기' }))
    await screen.findByText(APP_NO_PASS_MESSAGE)
    // 옛 기대: "새 방송 시작"을 다시 눌러 칸을 닫음. 새 기대(D-UX2-02): 시작은 시트 — "닫기"로 닫는다
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('button', { name: '이 방송 시작하기' })).toBeNull()
    expect(screen.getByText(APP_NO_PASS_MESSAGE)).toBeTruthy()
    expectNoBillingWords()
  })

  it('다른 거절은 서버 문장 그대로 (400 "시험 거절 문장이에요.")', async () => {
    const world = noPassWorld(400, 'INVALID_INPUT', '시험 거절 문장이에요.')
    render(world.wrap(<HomeScreen nav={nav()} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    fireEvent.click(screen.getByRole('button', { name: '이 방송 시작하기' }))
    expect(await screen.findByText('시험 거절 문장이에요.')).toBeTruthy()
    expect(screen.queryByText(APP_NO_PASS_MESSAGE)).toBeNull()
  })
})

describe('앱이 여는 라이브지니 주소에 from=app (AC-PAY2-03)', () => {
  it('"웹으로 열기" 항목 모두에 from=app이 붙고, 목록에 요금 화면·요금 안내가 없다', async () => {
    const world = makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    // 웹으로 여는 화면 목록은 더보기 탭으로 옮겼다 (D-UX2-02)
    render(world.wrap(<MoreScreen nav={{ openLabels: vi.fn(), openSettings: vi.fn() }} />))
    // 정산은 앱 화면으로 옮겨 웹 목록에서 뺐다 (D-APPX-01·02)
    await screen.findByRole('button', { name: '구매자 — 웹으로 열기' })
    for (const item of WEB_SCREENS) fireEvent.click(screen.getByRole('button', { name: `${item.word} — 웹으로 열기` }))
    expect(opened).toEqual(['/buyers', '/parcels', '/receipts', '/settings', '/sms'].map((path) => `http://test.local${path}?from=app`))
    expect(WEB_SCREENS.map((item) => item.path).join(' ')).not.toMatch(/billing|pricing/)
  })

  it('검색값이 있던 주소는 뒤에 더하고, 이미 붙었으면 한 번만, 라이브지니 밖 주소에는 붙지 않는다', async () => {
    makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    await openWeb('/settlements?date=2026-10-31')
    await openWeb('/settings#band')
    await openExternal(webUrl('/privacy'))
    await openExternal('https://policies.google.com/privacy')
    await openExternal('https://test.local.evil.example/privacy')
    expect(opened).toEqual([
      'http://test.local/settlements?date=2026-10-31&from=app',
      'http://test.local/settings?from=app#band',
      'http://test.local/privacy?from=app',
      'https://policies.google.com/privacy',
      'https://test.local.evil.example/privacy',
    ])
  })

  it('간편 로그인(기기 브라우저)도 from=app', async () => {
    const world = makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    render(world.wrap(<LoginScreen expired={false} onLogin={vi.fn(async () => {})} />))
    fireEvent.click(await screen.findByRole('button', { name: /간편 로그인/ }))
    expect(opened).toEqual(['http://test.local/login?from=app'])
  })
})
