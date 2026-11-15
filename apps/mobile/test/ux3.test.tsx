// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 앱 화면 다듬기 (D-UX3-01~06, 사용자 지시 2026-11-03 "토스처럼"): 아래 탭 5개와 좌우 밀림 방향, 누르면 바탕이 진해짐,
// 전체 탭 묶음, 새 방송 쌓인 화면(판매 종류 → 주소 → 만들고 바로 잇기, D-UX3-09·10), 토스 뜬 라벨 입력 칸(D-UX3-08).
// D-UX3-13: 아래 탭은 내용 위에 반투명하게 뜨고, 링크 잇기 단추 이름은 [이 방송에 잇기] → [확인].
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { shortLinkError } from '../src/screens/console/YoutubeSection.tsx'
import { LIVE_PLATFORMS } from '../src/lib/open-app.ts'
import { liveLinkOf } from '../src/lib/live-link.ts'
import { NewBroadcastAddressScreen, NewBroadcastCategoryScreen, SALE_CATEGORIES, categoryBroadcastTitle } from '../src/screens/NewBroadcastScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { TabFrame, tabEnterSide } from '../src/screens/TabFrame.tsx'
import { BACK_ICON, FIELD_LABEL_MS, FIELD_ROW, PALETTE, TABS, TabBar, UnderlineField, pressedFill, useTabBarRoom } from '../src/ui/kit/index.ts'
import { TYPE, WEIGHT } from '../src/ui/kit/tokens.ts'
import { TabIcon } from '../src/ui/kit/tab-icons.tsx'
import { makeWorld } from './screen-support.tsx'

describe('아래 탭 (D-UX3-01·12)', () => {
  it('아이콘은 홈·영수증·상자·사람·세 줄로 서로 다르고, 모두 가로세로가 같은 칸이다 (D-UX3-39 → D-UX3-60: 택배 탭 → 고객 탭)', () => {
    expect(TABS.map((tab) => tab.icon)).toEqual(['home', 'receipt', 'box', 'person', 'menu'])
    const world = makeWorld()
    const { container } = render(world.wrap(<TabBar active="home" onSelect={() => {}} />))
    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs).toHaveLength(5)
    for (const svg of svgs) expect(svg.getAttribute('width')).toBe(svg.getAttribute('height'))
  })

  it('탭은 홈 · 주문 · 택배 · 고객 · 전체 다섯이고 고른 탭만 골라져 있다 (D-UX3-39 → D-UX3-60·61, 사용자 지시 2026-11-07 "포장, 택배 한 탭으로" → "포장 -> 택배로 이름 바꾸고")', () => {
    const world = makeWorld()
    const onSelect = vi.fn()
    render(world.wrap(<TabBar active="settle" onSelect={onSelect} />))
    const tabs = within(screen.getByRole('tablist', { name: '아래 메뉴' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['홈', '주문', '택배', '고객', '전체'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false'])
    fireEvent.click(screen.getByRole('tab', { name: '고객' }))
    expect(onSelect).toHaveBeenCalledWith('customers')
  })

  it('아래 탭은 따로 바탕 띠 없이 내용 위에 뜨고(반투명 흰색), 내용은 탭 높이만큼 아래를 더 비운다 (D-UX3-13)', () => {
    const world = makeWorld()
    function Content() {
      return <span data-testid="room">{String(useTabBarRoom())}</span>
    }
    const { container } = render(world.wrap(
      <TabFrame active="home" go={() => {}}>
        <Content />
      </TabFrame>,
    ))
    expect(Number(screen.getByTestId('room').textContent)).toBeGreaterThan(56)
    const list = screen.getByRole('tablist', { name: '아래 메뉴' })
    const bar = list.parentElement?.parentElement as HTMLElement
    expect(getComputedStyle(bar).position).toBe('absolute')
    expect(PALETTE.light.glass).toMatch(/^rgba\(255, ?255, ?255, ?0\.\d+\)$/)
    // 탭 밖 화면은 더 비우지 않는다
    render(world.wrap(<Content />))
    expect(screen.getAllByTestId('room').at(-1)?.textContent).toBe('0')
    expect(container).toBeTruthy()
  })

  it('집 문 아래·프린터 종이 위로 지나는 선이 없고, 고른 칸은 채우고 안쪽 선만 흰색으로 뒤집는다 (D-UX3-13·44·46·60·63)', () => {
    const world = makeWorld()
    // D-UX3-39: 프린터 아이콘은 막대에 없다(라벨 프린터는 전체 안) — 아이콘 자체는 그대로라 따로 그려 본다
    const { container } = render(world.wrap(<><TabBar active="packing" onSelect={() => {}} /><TabIcon name="printer" color="#000" cut="#fff" /></>))
    const svgs = [...container.querySelectorAll('svg')]
    const [home, , box] = svgs
    const printer = svgs[5]
    // 집은 문 홈이 든 한 줄 모양(따로 그린 문 없음)
    expect(home?.querySelectorAll('path')).toHaveLength(1)
    // D-UX3-44: 문 너비 5.2 (9.4~14.6)
    expect(home?.querySelector('path')?.getAttribute('d')).toContain('H14.6 V16.4')
    // 프린터 몸통은 종이 앞(7~17)에서 끊긴 열린 모양 (D-UX3-15: 첫 줄은 위 받침 — 몸통은 둘째)
    const bodyLine = printer?.querySelectorAll('path')[1]?.getAttribute('d') ?? ''
    expect(bodyLine.startsWith('M7 17.4')).toBe(true)
    expect(bodyLine.endsWith('H17')).toBe(true)
    // D-UX3-63: 테이프는 앞면 윗변 높이(8.4 — 왼쪽 깎인 변 아래 끝과 같은 높이)에서 꺾이고, 사선은 깎인 변과 나란히 윗선까지
    const boxPaths = [...(box?.querySelectorAll('path') ?? [])]
    const bend = 'L10.374 7.538 Q9.4 8.4 9.4 9.7 V13'
    // 고른 상자(택배 탭)는 겉모양을 채우고 테이프 선 자리를 투명하게 뚫는다 — 흰색으로 칠하지 않고, 뚫는 선은 겉선 밖까지 이어진다
    const mask = box?.querySelector('mask')
    expect(mask?.querySelector('path')?.getAttribute('d')).toBe(`M15.649 2.872 ${bend}`)
    const filledBox = boxPaths.find((path) => path.getAttribute('mask') !== null)
    expect(filledBox?.getAttribute('fill')).not.toBe('none')
    expect(filledBox?.getAttribute('mask')).toBe(`url(#${mask?.getAttribute('id') ?? ''})`)
    expect(boxPaths.some((path) => path.getAttribute('stroke') === PALETTE.light.surface)).toBe(false)
    // 고르지 않은 상자는 겉선 + 같은 색 테이프 선(윗선에서 시작)
    render(world.wrap(<TabIcon name="box" color="#111" cut="#fff" />))
    const all = container.ownerDocument.querySelectorAll('svg')
    const plain = [...all.item(all.length - 1).querySelectorAll('path')]
    expect(plain).toHaveLength(2)
    expect(plain[1]?.getAttribute('d')).toBe(`M14.6 3.8 ${bend}`)
    expect(plain[1]?.getAttribute('stroke')).toBe('#111')
    // D-UX3-61: 고객은 머리·목·몸이 붙은 한 덩어리(한 줄 모양)
    render(world.wrap(<TabIcon name="person" color="#111" cut="#fff" />))
    const people = container.ownerDocument.querySelectorAll('svg')
    const person = people.item(people.length - 1)
    expect(person.querySelectorAll('path')).toHaveLength(1)
    expect(person.querySelectorAll('circle')).toHaveLength(0)
    // 모서리는 원호(A)가 아니라 아이폰 연속 곡률 곡선(C) — 집 문 홈만 원호 (D-UX3-15)
    for (const svg of [printer, box]) for (const path of svg?.querySelectorAll('path') ?? []) expect(path.getAttribute('d')).not.toMatch(/A/)
  })

  it('오른쪽 탭으로 가면 오른쪽에서, 왼쪽 탭으로 가면 왼쪽에서 들어온다. 처음·같은 탭은 그대로', () => {
    expect(tabEnterSide('home', 'packing')).toBe(1)
    expect(tabEnterSide('more', 'customers')).toBe(-1)
    expect(tabEnterSide(null, 'home')).toBe(0)
    expect(tabEnterSide('settle', 'settle')).toBe(0)
  })
})

describe('누르는 동안 바탕 (D-UX3-03)', () => {
  it('흐려지지 않고 놓인 바탕보다 진한 색 — 흰 줄·초록 단추·회색 단추·주의 줄 각각', () => {
    const p = PALETTE.light
    expect(pressedFill(p, p.surface)).toBe(p.pressed)
    expect(pressedFill(p, p.primary)).toBe(p.primaryPressed)
    expect(pressedFill(p, p.soft)).toBe(p.softPressed)
    expect(pressedFill(p, p.warnBg)).toBe(p.warnPressed)
    for (const [base, pressed] of [[p.surface, p.pressed], [p.soft, p.softPressed], [p.primary, p.primaryPressed]] as const) expect(luma(pressed)).toBeLessThan(luma(base))
  })
})

describe('전체 탭 (D-UX3-04)', () => {
  it('맨 위에 설정, 화면들은 묶음 이름이 든 카드로, 택배 줄은 없고(아래 탭으로 옮김) 라벨 프린터 줄이 가게 묶음에 있다 (D-UX3-39)', () => {
    const world = makeWorld()
    const openSettings = vi.fn()
    const openApp = vi.fn()
    render(world.wrap(<MoreScreen nav={{ openSettings, openApp }} account="김다육 · kim" onLogout={() => {}} />))
    // 탭 이름과 같은 맨 위 제목은 없다 (D-UX3-41)
    expect(screen.queryByRole('heading', { name: '전체' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(openSettings).toHaveBeenCalled()
    for (const group of ['라이브', '주문·입금', '배송', '가게', '계정']) expect(screen.getByRole('group', { name: group })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: '배송' })).queryByRole('button', { name: '택배' })).toBeNull()
    expect(within(screen.getByRole('group', { name: '가게' })).getByRole('button', { name: '라벨 프린터' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '입금 확인' }))
    expect(openApp).toHaveBeenCalledWith('/deposits')
  })
})

describe('새 라이브: 판매 종류 → 라이브 주소 (D-UX3-09·10)', () => {
  const linkableWorld = () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-11-03', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-03', title: String(call.body?.title ?? ''), rehearsal: false } } }))
    world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube$/, () => ({ body: { link: null, collector: null } }))
    // 잇기 전 미리 보기 (D-UX4-08)
    world.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ body: { title: '오늘의 다육이', channelTitle: '다육이네' } }))
    return world
  }
  /**
   * 잇기 전 확인 (D-UX4-08 — 처음이든 아니든): 제목·채널을 보고 연결.
   * D-UX4-117: 옛 기대 팝업 "연결할 라이브 확인" [맞아요] → 연결 확인 화면 "이 라이브에 연결할까요?" · 라이브 정보 카드 · [연결하기]
   */
  const agree = async () => {
    const confirmPage = await screen.findByTestId('link-confirm')
    expect(within(confirmPage).getByRole('heading', { level: 1 }).textContent).toBe('이 라이브에 연결할까요?')
    // D-UX4-121: 확인 화면으로 바로 넘어오고 라이브 정보는 그 화면에서 받는다 (옛 기대: 넘어올 때 이미 정보가 있음)
    expect((await within(confirmPage).findByTestId('live-check-title')).textContent).toBe('오늘의 다육이')
    expect(within(confirmPage).getByTestId('live-check-channel').textContent).toBe('다육이네')
    fireEvent.click(within(confirmPage).getByRole('button', { name: '연결하기' }))
  }
  /** 링크 화면 맨 아래 [다음] (D-UX4-117 — 옛 [확인]). 확인 화면에서 돌아오면 링크 화면을 새로 그리므로 늘 지금 화면에서 찾는다 */
  const next = () => fireEvent.click(screen.getByRole('button', { name: '다음' }))
  const newNav = () => ({ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() })
  afterEach(() => {
    setClipboardReader(async () => '')
    setClipboardProbe(null)
  })

  it('제목은 판매 종류로 짓는다: 다육이·화분은 종류를 넣고 기타는 날짜·요일만', () => {
    expect(SALE_CATEGORIES.map((item) => item.word)).toEqual(['다육이', '화분', '기타'])
    expect(categoryBroadcastTitle('2026-11-03', 'succulent')).toBe('2026-11-03 화요일 다육이 라이브')
    expect(categoryBroadcastTitle('2026-11-03', 'pot')).toBe('2026-11-03 화요일 화분 라이브')
    expect(categoryBroadcastTitle('2026-11-03', 'other')).toBe('2026-11-03 화요일 라이브')
    expect(categoryBroadcastTitle('2026-11-03', 'nope')).toBe('2026-11-03 화요일 라이브')
  })

  it('"어떤 라이브인가요?"는 판매 종류 단추만 — 제목 칸이 없고, 하나를 누르면 라이브를 만들지 않고 주소 단계로 간다', async () => {
    const world = linkableWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastCategoryScreen nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 라이브' })
    expect(within(page).getByRole('heading', { name: '어떤 라이브인가요?' })).toBeTruthy()
    expect(within(page).queryByRole('textbox')).toBeNull()
    expect(within(screen.getByRole('group', { name: '판매 종류' })).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['다육이', '화분', '기타'])
    fireEvent.click(within(page).getByRole('button', { name: '화분' }))
    await waitFor(() => expect(nav.openAddress).toHaveBeenCalledWith('pot'))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    expect(nav.back).toHaveBeenCalled()
  })

  it('링크 단계: 링크를 넣기 전엔 [확인]가 없고, 넣으면 종류 제목으로 라이브를 만들고 바로 잇는다', async () => {
    const world = linkableWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 라이브' })
    // D-UX4-112: 옛 기대 제목 "라이브 링크를 넣어 주세요" → "연결할 라이브의 링크를\n복사해서 붙여넣어 주세요" (+ 설명)
    // D-UX4-113 (사용자 지시 2026-11-10 토스 "토스인증서" 사진): 제목은 다시 "라이브 링크를 넣어 주세요", 설명 "링크만 알려주시면 복잡한 작업은\n저희가 도와드릴게요"
    expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe('라이브 링크를 넣어 주세요')
    // D-UX4-117 (사용자 지시 2026-11-10 "설명 그냥 지우고 제목 아래에 인풋"): 옛 기대 설명 "링크만 알려주시면 …" → 설명 없음
    expect(within(page).queryByTestId('form-description')).toBeNull()
    const address = await within(page).findByLabelText('라이브 링크')
    expect(within(page).queryByLabelText('라이브 제목')).toBeNull()
    // D-UX4-117: 옛 기대 [확인] → [다음]
    expect(within(page).queryByRole('button', { name: '다음' })).toBeNull()
    expect(within(page).queryByRole('button', { name: '주소 없이 시작' })).toBeNull()
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    next()
    // 확인 화면에서 [연결하기]를 누르기 전엔 방송을 만들지 않는다 (D-UX4-08 → D-UX4-117: 팝업이 아니라 화면)
    await screen.findByTestId('link-confirm')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
    await agree()
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 다육이 라이브$/)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)[0]?.body).toEqual({ requestId: expect.any(String), video: 'https://www.youtube.com/watch?v=tWnNGwvdN40', confirmInvited: true })
  })

  it('링크를 이으면 라이브 화면 전에 라벨 단계로 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고")', async () => {
    const world = linkableWorld()
    const nav = { ...newNav(), openLabelSetup: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 라이브' })
    fireEvent.change(await within(page).findByLabelText('라이브 링크'), { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    next()
    await agree()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  it('라벨 단계에서 뒤로 와도 링크를 다시 이을 수 있다: 같은 링크는 다시 보내지 않고 다음으로, 다른 링크면 먼저 끊고 잇는다 (D-UX3-19 고침)', async () => {
    const world = linkableWorld()
    world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube\/unlink$/, () => ({ body: {} }))
    const nav = { ...newNav(), openLabelSetup: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 라이브' })
    fireEvent.change(await within(page).findByLabelText('라이브 링크'), { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    next()
    await agree()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledTimes(1))
    // 라벨 단계에서 뒤로 오면 연결 확인 화면 그대로 (D-UX4-117) — 같은 링크로 [연결하기]: 방송을 또 만들지 않고, 잇기 요청도 다시 보내지 않는다
    await agree()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledTimes(2))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)).toHaveLength(1)
    // 확인 화면 뒤로 → 링크 화면 (칸에는 넣은 링크가 그대로). 다른 링크로 바꾸면 먼저 이은 것을 끊고 새 링크를 잇는다
    fireEvent.click(within(screen.getByTestId('link-confirm')).getByRole('button', { name: '뒤로' }))
    const address = await screen.findByLabelText('라이브 링크')
    expect((address as HTMLInputElement).value).toBe('https://www.youtube.com/watch?v=tWnNGwvdN40')
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' } })
    next()
    await agree()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledTimes(3))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube\/unlink$/)).toHaveLength(1)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/).map((call) => (call.body as { video: string }).video)).toEqual(['https://www.youtube.com/watch?v=tWnNGwvdN40', 'https://www.youtube.com/watch?v=AAAAAAAAAAA'])
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  // D-UX4-160·162 (사용자 지시 2026-11-16 "그냥 우리 앱 안에서 브라우저 띄워서 해당 라이브 들어간 다음에, 밑에 [이 라이브에요] 버튼을 누르면 자동으로 그 라이브로 연결"):
  // 옛 기대(D-UX3-11) — 유튜브는 앱(없으면 앱 안 브라우저)을 열고, 돌아오면 [붙여넣기] 한 번으로 링크가 들어감, 플랫폼마다 앱 주소·웹 주소(LIVE_PLATFORMS.web).
  // 새 기대 — 고르면 앱 안 브라우저가 뜨고, 라이브 화면에서 [이 라이브예요]를 누르면 브라우저가 닫히고 링크가 칸에 들어가 [다음]과 똑같이 연결 확인 화면으로.
  it('[링크를 모르겠어요] → 유튜브·틱톡·밴드(정식 앱 아이콘). 유튜브는 앱 안 브라우저 → [이 라이브예요] → 링크 칸에 넣고 연결 확인 화면 (D-UX4-160·162)', async () => {
    const world = linkableWorld()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav()} />))
    await screen.findByLabelText('라이브 링크')
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    const platforms = within(screen.getByRole('group', { name: '라이브 플랫폼' })).getAllByRole('button')
    expect(platforms.map((button) => button.getAttribute('aria-label'))).toEqual(['유튜브', '틱톡', '밴드'])
    expect(LIVE_PLATFORMS.map((target) => target.key)).toEqual(['youtube', 'tiktok', 'band'])
    fireEvent.click(screen.getByRole('button', { name: '유튜브' }))
    const browser = await screen.findByRole('dialog', { name: '라이브 찾기' })
    fireEvent.change(within(browser).getByRole('textbox', { name: '주소' }), { target: { value: 'https://m.youtube.com/watch?v=LIVENOW0001&pp=x' } })
    fireEvent.click(within(browser).getByRole('button', { name: '이 라이브예요' }))
    // [다음]을 누른 것과 같다: 연결 확인 화면에서 그 라이브를 미리 본다
    await screen.findByTestId('link-confirm')
    await waitFor(() => expect(world.server.callsTo('POST', /^\/api\/youtube\/preview$/)[0]?.body).toEqual({ video: 'https://www.youtube.com/watch?v=LIVENOW0001' }))
    expect(screen.queryByRole('dialog', { name: '라이브 찾기' })).toBeNull()
    // 링크 칸에 그 링크가 들어 있다 (확인 화면에서 뒤로)
    fireEvent.click(within(screen.getByTestId('link-confirm')).getByRole('button', { name: '뒤로' }))
    expect(((await screen.findByLabelText('라이브 링크')) as HTMLInputElement).value).toBe('https://www.youtube.com/watch?v=LIVENOW0001')
  })

  // D-UX3-14 (사용자 지시 2026-11-03 "왜 틱톡과 밴드는 링크를 통해 못해? 할 수 있게"): 옛 기대 — 틱톡·밴드는 계정 안내와 [이 방송 만들기],
  // 유튜브를 잇지 않는 서버면 종류를 누르는 대로 방송을 만듦. 새 기대 — 세 플랫폼 모두 링크로 잇는다, 종류는 늘 링크 단계로.
  // D-UX4-160: 옛 기대 "틱톡·밴드도 그 앱을 연다(snssdk1233://·bandapp://)" → 틱톡·밴드도 앱 안 브라우저(그 플랫폼 모바일 웹)에서 찾는다.
  it('[링크를 모르겠어요]의 틱톡·밴드도 앱 안 브라우저로 그 플랫폼 웹을 연다 (D-UX3-14 → D-UX4-160)', async () => {
    const world = linkableWorld()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={newNav()} />))
    await screen.findByLabelText('라이브 링크')
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    fireEvent.click(screen.getByRole('button', { name: '틱톡' }))
    let browser = await screen.findByRole('dialog', { name: '라이브 찾기' })
    expect((within(browser).getByRole('textbox', { name: '주소' }) as HTMLInputElement).value).toBe('https://www.tiktok.com/')
    fireEvent.click(within(browser).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '라이브 찾기' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    fireEvent.click(screen.getByRole('button', { name: '밴드' }))
    browser = await screen.findByRole('dialog', { name: '라이브 찾기' })
    expect((within(browser).getByRole('textbox', { name: '주소' }) as HTMLInputElement).value).toBe('https://band.us/')
    expect(screen.queryByText(/가게 계정으로/)).toBeNull()
  })

  it('틱톡 공유 글을 붙여 넣으면 링크만 넣고, [확인]은 종류 제목으로 라이브를 만든 뒤 그 링크로 틱톡을 잇는다. 동의 전이면 안내 → [동의하고 잇기]', async () => {
    const world = linkableWorld()
    let tries = 0
    world.server.on('POST', /^\/api\/broadcasts\/b9\/tiktok\/link-url$/, () => {
      tries += 1
      return tries === 1 ? { status: 409, body: { error: { code: 'NO_CONSENT', message: '틱톡 연결이 꺼져 있어요. 설정에서 안내를 읽고 켜 주세요.' } } } : { body: { link: { state: 'LINKED' } } }
    })
    world.server.on('GET', /^\/api\/tiktok$/, () => ({ body: { tiktok: { notice: { version: 'TT-BETA-1', title: '틱톡 라이브 연결(베타) 안내', lines: ['안내 첫 줄', '안내 둘째 줄'], checkbox: '안내를 읽었고, 위 내용에 동의해요', button: '켜기' } } } }))
    world.server.on('POST', /^\/api\/tiktok\/consent$/, () => ({ body: { tiktok: {} } }))
    setClipboardProbe(async () => true)
    setClipboardReader(async () => '김다육님의 라이브를 보러 오세요! https://vt.tiktok.com/ZSabc123/ 복사해서 틱톡에서 열어 보세요')
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={nav} />))
    const field = (await screen.findByLabelText('라이브 링크')) as HTMLInputElement
    fireEvent.click(await screen.findByRole('button', { name: '붙여넣기' }))
    await waitFor(() => expect(field.value).toBe('https://vt.tiktok.com/ZSabc123/'))
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    expect(await screen.findByText('· 안내 첫 줄')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '안내를 읽었고, 위 내용에 동의해요' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(world.server.callsTo('POST', /^\/api\/tiktok\/consent$/)[0]?.body).toMatchObject({ on: true, version: 'TT-BETA-1' })
    const links = world.server.callsTo('POST', /tiktok\/link-url$/)
    expect(links.map((call) => call.body?.url)).toEqual(['https://vt.tiktok.com/ZSabc123/', 'https://vt.tiktok.com/ZSabc123/'])
    // 방송은 한 번만, 유튜브로는 보내지 않는다
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1)
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/ 화분 라이브$/)
    expect(world.server.callsTo('POST', /\/youtube$/)).toHaveLength(0)
  })

  it('D-UX3-17 다른 라이브에 틱톡이 이어져 있으면 옮길지 묻고, [옮기기]면 move로 다시 보내 잇는다', async () => {
    const world = linkableWorld()
    let tries = 0
    world.server.on('POST', /^\/api\/broadcasts\/b9\/tiktok\/link-url$/, () => {
      tries += 1
      return tries === 1 ? { status: 409, body: { error: { code: 'TIKTOK_ELSEWHERE', message: '다른 라이브에 틱톡이 이어져 있어요. 이 라이브로 옮길까요?' } } } : { body: { link: { state: 'LINKED' } } }
    })
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={nav} />))
    const field = (await screen.findByLabelText('라이브 링크')) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'https://www.tiktok.com/@shop_two/live' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    // D-UX4-112: 옛 기대 "다른 라이브에 틱톡이 이어져 있어요. …" → "… 연결돼 있어요. …" (팝업 글은 앱 문장)
    expect(await screen.findByText('다른 라이브에 틱톡이 연결돼 있어요. 이 라이브로 옮길까요?')).toBeTruthy()
    expect(nav.openConsole).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '옮기기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    const links = world.server.callsTo('POST', /tiktok\/link-url$/)
    expect(links.map((call) => call.body?.move)).toEqual([undefined, true])
    expect(links[1]?.body?.url).toBe('https://www.tiktok.com/@shop_two/live')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1)
  })

  it('밴드 링크는 [확인]하면 내 밴드 글을 보이고, 고른 글로 잇는다 (밴드 공식 방법은 링크로 글을 찾지 못한다)', async () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/band$/, () => ({ body: { band: { status: 'CONNECTED', message: null } } }))
    world.server.on('GET', /^\/api\/band\/bands$/, () => ({ body: { bands: [{ bandKey: 'BANDKEY0001', name: '다육 가게', memberCount: 30 }], chosenBand: null, message: null } }))
    world.server.on('GET', /^\/api\/band\/posts/, () => ({ body: { posts: [{ postKey: 'POSTKEY0001', createdAt: '2026-11-03T01:05:00.000Z', firstLine: '오늘 저녁 라이브 찜 받아요', commentCount: 3 }], page: 1, more: false, cursor: null } }))
    world.server.on('POST', /^\/api\/broadcasts\/b9\/band\/link$/, () => ({ body: { link: {} } }))
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    fireEvent.change(await screen.findByLabelText('라이브 링크'), { target: { value: 'https://band.us/band/12345678/post/42' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    // D-UX4-112: 옛 기대 "오늘 저녁 라이브 찜 받아요 · 11/3 10:05 잇기" → "오늘 저녁 라이브 찜 받아요 · 11/3 10:05 연결"
    fireEvent.click(await screen.findByRole('button', { name: '오늘 저녁 라이브 찜 받아요 · 11/3 10:05 연결' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(world.server.callsTo('POST', /band\/link$/)[0]?.body).toMatchObject({ bandKey: 'BANDKEY0001', postKey: 'POSTKEY0001' })
  })

  it('밴드 계정을 잇지 않았으면 서버 문장, 모르는 링크는 "알 수 없는 링크예요."', async () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/band$/, () => ({ body: { band: { status: 'NOT_CONNECTED', message: '설정에서 밴드를 먼저 연결해 주세요.' } } }))
    render(world.wrap(<NewBroadcastAddressScreen category="other" nav={newNav()} />))
    const field = await screen.findByLabelText('라이브 링크')
    fireEvent.change(field, { target: { value: 'band.us/band/1/post/2' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    expect(await screen.findByText('설정에서 밴드를 먼저 연결해 주세요.')).toBeTruthy()
    fireEvent.change(field, { target: { value: 'https://example.com/live/1' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    expect(await screen.findByText('알 수 없는 링크예요.')).toBeTruthy()
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
  })

  it('유튜브를 주소로 잇지 않는 서버도 종류를 누르면 링크 단계로 (라이브는 [확인] 때 만든다)', () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: false }, oauth: true } }))
    const nav = newNav()
    render(world.wrap(<NewBroadcastCategoryScreen nav={nav} />))
    fireEvent.click(screen.getByRole('button', { name: '기타' }))
    expect(nav.openAddress).toHaveBeenCalledWith('other')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
  })

  it('붙여 넣은 글에서 라이브 링크 찾기: 유튜브·틱톡(짧은 링크 포함)·밴드, 그 밖은 null', () => {
    expect(liveLinkOf('https://youtu.be/abc')).toEqual({ platform: 'youtube', url: 'https://youtu.be/abc' })
    expect(liveLinkOf('https://www.tiktok.com/@shop/live?x=1')).toEqual({ platform: 'tiktok', url: 'https://www.tiktok.com/@shop/live?x=1' })
    expect(liveLinkOf('라이브 보러 와요 https://vm.tiktok.com/ZS1/.')).toEqual({ platform: 'tiktok', url: 'https://vm.tiktok.com/ZS1/' })
    expect(liveLinkOf('[다육 가게] https://band.us/band/1/post/2')).toEqual({ platform: 'band', url: 'https://band.us/band/1/post/2' })
    expect(liveLinkOf('https://example.com/a')).toBeNull()
    expect(liveLinkOf('그냥 글')).toBeNull()
  })
})

describe('입력 칸 (토스 뜬 라벨, D-UX3-08)', () => {
  it('비어 있고 초점이 없으면 라벨이 칸 안(큰 회색 글자), 누르거나 값이 있으면 위로 작게 — 글자 하나가 움직일 뿐 값 줄 높이는 그대로', () => {
    const world = makeWorld()
    function Box() {
      const [value, setValue] = useState('')
      return <UnderlineField label="라이브 링크" value={value} onChangeText={setValue} />
    }
    render(world.wrap(<Box />))
    const input = screen.getByLabelText('라이브 링크') as HTMLInputElement
    const state = () => (screen.queryByTestId('field-label-resting') !== null ? 'resting' : screen.queryByTestId('field-label-floating') !== null ? 'floating' : 'none')
    expect(state()).toBe('resting')
    // 라벨은 칸 안 예시 글(placeholder)이 아니라 따로 움직이는 글자 — 칸 안 예시 글은 비어 있다
    expect(input.getAttribute('placeholder')).toBe('')
    fireEvent.focus(input)
    // D-UX3-53으로 바뀐 기대 (사용자 지시 2026-11-07 "아무것도 입력하지 않았다면 라벨 위치를 아직 필드 안에"): 옛 누르면 위로(floating) → 새 비어 있으면 눌러도 칸 안(resting)
    expect(state()).toBe('resting')
    // D-UX3-54로 바뀐 기대 (사용자 지시 2026-11-07 "아무것도 입력하지 않았을 때 라벨 색깔 … 포인트 컬러가 아니라 그냥 회색 기본 색"): 옛 눌렀으면 초록 → 새 비어 있으면 회색
    const labelColor = () => ((screen.queryByTestId('field-label-resting') ?? screen.getByTestId('field-label-floating')).firstElementChild as HTMLElement).style.color
    expect(labelColor()).toBe('rgb(139, 149, 161)')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(state()).toBe('floating')
    expect(labelColor()).toBe('rgb(31, 122, 77)')
    fireEvent.blur(input)
    expect(state()).toBe('floating')
    // D-UX3-51로 바뀐 기대 (사용자 지시 2026-11-07 토스 사진 비교): 옛 값 줄 52 → 새 40 (토스 칸을 재어)
    expect(FIELD_ROW).toBe(40)
    expect(FIELD_LABEL_MS).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '라이브 링크 지우기' }))
    expect(input.value).toBe('')
    expect(state()).toBe('resting')
  })

  // D-UX3-51로 바뀐 기대 (사용자 지시 2026-11-07 "오류 메시지의 형태"): 옛 "느낌표 + 짧은 문장"(D-UX3-11) → 새 "느낌표 없이 빨간 문장만"(토스)
  it('잘못일 때는 느낌표 그림 + 빨간 짧은 문장, 고치기 시작하면 문장이 사라진다 (D-UX3-11·51·53)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    world.server.on('POST', /^\/api\/broadcasts$/, () => ({ body: { date: '2026-11-03', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-03', title: 't', rehearsal: false } } }))
    // 거절은 잇기 전 미리 보기에서 온다 (D-UX4-08)
    world.server.on('POST', /^\/api\/youtube\/preview$/, (call) =>
      call.body?.video === 'https://youtu.be/NOCHAT00001'
        ? { status: 409, body: { error: { code: 'NO_LIVE_CHAT', message: '이 영상에는 실시간 채팅이 없어요. 라이브 라이브가 시작됐는지, 채팅이 켜져 있는지 확인해 주세요.' } } }
        : { status: 400, body: { error: { code: 'INVALID_VIDEO_URL', message: '유튜브 영상 주소를 알아볼 수 없어요. 주소를 다시 확인해 주세요.' } } },
    )
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={{ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }} />))
    const field = await screen.findByLabelText('라이브 링크')
    fireEvent.change(field, { target: { value: 'https://youtu.be/NOCHAT00001' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('라이브 채팅을 받을 수 없는 라이브예요.')
    // D-UX3-53으로 다시 바뀐 기대 (사용자 지시 2026-11-07 "에러 문구 앞에는 원래 있던 느낌표 원 아이콘을 넣어줘"): 옛 D-UX3-51 느낌표 없음 → 새 앞에 느낌표 그림(장식, 숨김)
    expect(alert.querySelector('[aria-hidden="true"]')).not.toBeNull()
    // D-UX4-121: [다음]은 확인 화면으로 바로 넘어갔다가 거절되면 링크 화면을 새로 그려 돌아온다 — 지금 칸을 다시 찾는다
    fireEvent.change(screen.getByLabelText('라이브 링크'), { target: { value: 'https://youtu.be/NOCHAT0000' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    expect((await screen.findByRole('alert')).textContent).toBe('알 수 없는 링크예요.')
    // D-UX4-112: 옛 기대 "공개 라이브만 이을 수 있어요." → "공개 라이브만 연결할 수 있어요."
    expect(shortLinkError({ code: 'YOUTUBE_NOT_PUBLIC', message: '긴 문장' } as never)).toBe('공개 라이브만 연결할 수 있어요.')
  })

  it('클립보드 글이 유튜브 링크가 아니면 붙여 넣은 뒤 "알 수 없는 링크예요."', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    setClipboardReader(async () => '15 핑크프릴 10')
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={{ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }} />))
    fireEvent.click(await screen.findByRole('button', { name: '붙여넣기' }))
    expect((await screen.findByRole('alert')).textContent).toBe('알 수 없는 링크예요.')
    setClipboardReader(async () => '')
  })

  // D-UX3-51로 바뀐 기대 (사용자 지시 2026-11-07 토스 사진 비교 "입력필드 안 폰트의 두께가 다름 … 뒤로가기 버튼의 크기"): 옛 입력 24·뒤로 26 → 새 입력 22(두께 500)·뒤로 33·제목 22
  // D-UX3-74로 바뀐 기대 (사용자 지시 2026-11-09 "글자 크기 다 줄이셈"): 입력 22 → 20, 제목 22 → 20
  it('입력 글자 20, 뒤로 화살표는 어느 화면이든 33 하나, 제목 20', () => {
    expect(TYPE.input).toBe(20)
    expect(WEIGHT.book).toBe('500')
    expect(TYPE.headline).toBe(20)
    expect(BACK_ICON).toBe(33)
  })
})

function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}

describe('아이폰 모서리 곡률 (D-UX3-15)', () => {
  it('앱의 모든 둥근 모서리(borderRadius)는 아이폰 연속 곡률(borderCurve continuous)과 함께 쓴다', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : []
    })
    const root = join(__dirname, '..')
    const missing: string[] = []
    for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'app'))]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const radii = line.match(/borderRadius:/g)?.length ?? 0
        const curves = line.match(/borderCurve: 'continuous'/g)?.length ?? 0
        if (radii > curves) missing.push(`${file.slice(root.length + 1)}:${String(index + 1)}`)
      })
    }
    expect(missing).toEqual([])
  })
})
