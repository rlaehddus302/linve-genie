// 앱에서 이용권이 없을 때·앱이 여는 웹 주소 (PAY2 AC-PAY2-02·03, BILLING_RULES BL-11 2·3.1, D-PAY-03·04).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { webUrl } from '../src/api/config.ts'
import { openExternal, openWeb, setWebOpener, WEB_SCREENS } from '../src/lib/open-web.ts'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { NewBroadcastAddressScreen, NewBroadcastCategoryScreen } from '../src/screens/NewBroadcastScreen.tsx'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { WEB_CONNECTIONS } from '../src/screens/settings/ShopExtras.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const nav = () => ({ openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })
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
  it('새 방송 판매 종류는 방송을 만들지 않고 링크 단계로 간다 — 이용권 거절은 링크 단계에서(다음 시험). 홈의 리허설은 한 번 간다', async () => {
    // 옛 기대(D-UX3-09): 유튜브를 주소로 잇지 않는 서버면 종류를 누르는 대로 방송을 만들고 거절 문장. 새 기대(D-UX3-14): 틱톡·밴드도 링크로 이어 늘 링크 단계로 간다
    const world = noPassWorld()
    const newNav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }
    const view = render(world.wrap(<NewBroadcastCategoryScreen nav={newNav} />))
    fireEvent.click(screen.getByRole('button', { name: '다육이' }))
    expect(newNav.openAddress).toHaveBeenCalledWith('succulent')
    expect(world.server.callsTo('POST', /broadcasts/)).toHaveLength(0)
    expect(APP_NO_PASS_MESSAGE).toBe('이용권이 없어 실제 방송을 시작할 수 없어요. 리허설은 언제든 할 수 있어요.')
    view.unmount()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '리허설 해 보기' }))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('r1'))
    expect(world.server.callsTo('POST', /broadcasts/).filter((call) => call.body?.rehearsal === true)).toHaveLength(1)
  })

  it('링크 단계의 [확인]가 거절돼도 같은 앱 문장이다', async () => {
    // 옛 기대: 칸을 닫은 홈에도 같은 문장. 새 기대(D-UX3-09): 새 방송은 쌓인 화면 — 거절 문장은 그 화면(주소 단계)에 보인다
    const world = noPassWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    const newNav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav} />))
    fireEvent.change(await screen.findByLabelText('방송 링크'), { target: { value: 'https://youtu.be/tWnNGwvdN40' } })
    fireEvent.click(await screen.findByRole('button', { name: '확인' }))
    expect(await screen.findByText(APP_NO_PASS_MESSAGE)).toBeTruthy()
    expectNoBillingWords()
    expect(newNav.openConsole).not.toHaveBeenCalled()
  })

  it('다른 거절은 서버 문장 그대로 (400 "시험 거절 문장이에요.") — 유튜브를 잇지 않은 서버에서 틱톡 링크로 (D-UX3-14)', async () => {
    const world = noPassWorld(400, 'INVALID_INPUT', '시험 거절 문장이에요.')
    const newNav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={newNav} />))
    fireEvent.change(await screen.findByLabelText('방송 링크'), { target: { value: 'https://www.tiktok.com/@shop_a/live' } })
    fireEvent.click(await screen.findByRole('button', { name: '확인' }))
    expect(await screen.findByText('시험 거절 문장이에요.')).toBeTruthy()
    expect(screen.queryByText(APP_NO_PASS_MESSAGE)).toBeNull()
    expect(newNav.openConsole).not.toHaveBeenCalled()
  })
})

describe('앱이 여는 라이브지니 주소에 from=app (AC-PAY2-03)', () => {
  it('"웹으로 열기" 항목 모두에 from=app이 붙고, 목록에 요금 화면·요금 안내가 없다', async () => {
    const world = makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    // 옛 기대: 더보기 "웹에서 보기" 줄(구매자·택배·…)마다 from=app. 새 기대(D-APPX-03): 웹 전용 화면을 모두 앱으로 옮겨 그 목록이 비었다 —
    // 남은 웹 열기는 가게 설정 "연결"(바깥 로그인 창을 거치는 것)이고, 거기에도 from=app이 붙는다
    render(world.wrap(<MoreScreen nav={{ openLabels: vi.fn(), openSettings: vi.fn() }} />))
    await screen.findByTestId('more-screen')
    expect(WEB_SCREENS).toEqual([])
    expect(screen.queryByText('웹에서 보기')).toBeNull()
    for (const row of WEB_CONNECTIONS) await openWeb(row.path)
    expect(opened).toEqual(WEB_CONNECTIONS.map((row) => `http://test.local${row.path}?from=app`))
    expect(WEB_CONNECTIONS.map((row) => row.path).join(' ')).not.toMatch(/billing|pricing/)
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
