// 홈 "오늘 할 일" (APP-01, D-UX2-02): 진행 중 방송은 "방송으로 돌아가기"로 한국어 한 줄과 함께 보이고, 새 방송 시작이 요청 번호와 함께 가며,
// "웹으로 열기"는 더보기 탭에서 기기 브라우저로 연다 (AC4). 할 일 숫자는 포장 목록·라벨 대기열의 서버 값이다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setWebOpener } from '../src/lib/open-web.ts'
import { HomeScreen, broadcastLine } from '../src/screens/HomeScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const nav = () => ({ openConsole: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })

describe('HomeScreen', () => {
  it('방송 한 줄과 콘솔 열기', async () => {
    const world = makeWorld()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    expect(broadcastLine(BROADCAST)).toBe('저녁 방송 · 10월 29일 · 진행 중')
    expect(screen.getByText('김다육 사장님, 안녕하세요')).toBeTruthy()
    // 옛 기대: 방송 목록의 "콘솔 열기 — 줄" 단추. 새 기대(D-UX2-02): 진행 중 방송은 큰 초록 카드 "방송으로 돌아가기 — 줄"
    const button = await screen.findByRole('button', { name: `방송으로 돌아가기 — ${broadcastLine(BROADCAST)}` })
    fireEvent.click(button)
    expect(navigation.openConsole).toHaveBeenCalledWith('b1')
  })

  it('새 방송 시작 → 제목 칸 → 이 방송 시작하기가 요청 번호와 함께 가고 콘솔로 간다', async () => {
    const world = makeWorld()
    world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-10-30', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b2', date: '2026-10-30', title: String(call.body?.title ?? ''), rehearsal: false } } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    fireEvent.change(screen.getByLabelText('방송 제목 (비워도 돼요)'), { target: { value: '금요일 방송' } })
    fireEvent.click(screen.getByRole('button', { name: '이 방송 시작하기' }))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('b2'))
    expect(world.server.callsTo('POST', /broadcasts/)[0]?.body).toEqual({ requestId: expect.any(String), title: '금요일 방송' })
  })

  it('진행 중 방송이 없으면 큰 카드가 "방송 시작하기"이고, 할 일 숫자는 포장 목록·라벨 대기열 값이다 (D-UX2-02)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, ended: true, endedAt: '2026-10-29T12:00:00.000Z' }] } }))
    world.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
    const item = (no: number, price: number, qty?: number) => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '저녁 방송', no, name: '핑크프릴', price, ...(qty === undefined ? {} : { qty }) })
    const entry = (buyer: string, payment: string, status: string, items: unknown[]) => ({ buyer, name: buyer, phoneLast4: null, payment, items, status, invoice: null, add: [], remove: [] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: '2026-10-29', seq: 5, entries: [entry('u1', 'UNPAID', '포장 대기', [item(1, 10_000)]), entry('u2', 'PAID', '포장 대기', [item(2, 5_000, 2)]), entry('u3', 'PAID', '포장 완료', [item(3, 7_000)])] } }))
    world.services.labels.start()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    expect(await screen.findByRole('button', { name: '방송 시작하기' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '입금 확인 1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '포장하기 2' }))
    expect(navigation.openPacking).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '라벨 뽑기 0' })).toBeTruthy()
    // 지난 방송: 그 방송 품목 수량 합 4개, 금액 10,000 + 5,000×2 + 7,000 = 27,000원 (정수 원)
    expect(await screen.findByText('4개 팔림')).toBeTruthy()
    expect(screen.getByText('27,000원')).toBeTruthy()
    world.services.labels.stop()
  })

  it('"웹으로 열기"는 앱 안이 아니라 기기 브라우저로 그 서버의 웹 주소를 연다 (APP-01 AC4)', async () => {
    const world = makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    // 옛 기대: 홈 아래 "웹으로 열기" 줄. 새 기대(D-UX2-02): 더보기 탭의 "웹에서 보기"
    render(world.wrap(<MoreScreen nav={{ openLabels: vi.fn(), openSettings: vi.fn() }} />))
    fireEvent.click(await screen.findByRole('button', { name: '정산 — 웹으로 열기' }))
    expect(opened).toEqual(['http://test.local/settlements?from=app'])
  })

  it('홈이 다시 보이면 방송 목록을 다시 받는다: 리허설을 시작하고 돌아오면 "방송으로 돌아가기", 끝내고 돌아오면 "방송 시작하기" (D-UX2-07)', async () => {
    const world = makeWorld()
    let broadcasts: unknown[] = []
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts } }))
    const navigation = nav()
    const view = render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={0} />))
    expect(await screen.findByRole('button', { name: '방송 시작하기' })).toBeTruthy()
    const rehearsal = { ...BROADCAST, id: 'r1', title: '리허설 1', rehearsal: true }
    broadcasts = [rehearsal]
    view.rerender(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={1} />))
    fireEvent.click(await screen.findByRole('button', { name: `방송으로 돌아가기 — ${broadcastLine(rehearsal)}` }))
    expect(navigation.openConsole).toHaveBeenCalledWith('r1')
    broadcasts = [{ ...rehearsal, ended: true, endedAt: '2026-10-29T12:00:00.000Z' }]
    view.rerender(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={2} />))
    expect(await screen.findByRole('button', { name: '방송 시작하기' })).toBeTruthy()
  })

  it('정산 탭은 바로 브라우저로 나가지 않고 "정산은 웹 화면에서 열려요"와 [웹으로 열기]를 보인다 (D-UX2-07)', async () => {
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    render(<SettleScreen />)
    expect(screen.getByText('정산은 웹 화면에서 열려요')).toBeTruthy()
    expect(opened).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '정산 — 웹으로 열기' }))
    expect(opened).toEqual(['http://test.local/settlements?from=app'])
  })
})
