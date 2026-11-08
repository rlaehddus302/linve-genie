// 홈 "오늘 할 일" (APP-01, D-UX2-02): 진행 중 방송은 "방송으로 돌아가기"로 한국어 한 줄과 함께 보이고, 새 방송 시작이 요청 번호와 함께 가며,
// "웹으로 열기"는 더보기 탭에서 기기 브라우저로 연다 (AC4). 할 일 숫자는 포장 목록·라벨 대기열의 서버 값이다.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setWebOpener } from '../src/lib/open-web.ts'
import { HomeScreen, broadcastLine } from '../src/screens/HomeScreen.tsx'
import { ConnectionsCard } from '../src/screens/settings/ShopExtras.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const nav = () => ({ openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })

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

  it('새 방송 시작은 새 방송 화면(쌓인 화면)을 연다 — 홈 안에 제목 칸·판이 없다 (D-UX3-09)', async () => {
    const world = makeWorld()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    // 옛 기대(D-UX3-07): 홈 위 전체 화면 판에 빈 "방송 제목" 칸 → [다음]. 새 기대(D-UX3-09): 제목 칸은 없고(판매 종류로 제목을 짓는다) 새 방송은 쌓인 화면 — 밀어서 뒤로 가기
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    expect(navigation.openNewBroadcast).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('방송 제목')).toBeNull()
    expect(world.server.callsTo('POST', /broadcasts/)).toHaveLength(0)
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

  it('방송 뒤 "다음 할 일"은 흐름 순서 — 손님 정보 받기 → 확인서 보내기 → 입금 확인 → 포장하기 → 택배 접수 → 라벨 뽑기, 숫자는 택배 목록·영수증 목록 값 (D-UX3-39)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, ended: true, endedAt: '2026-10-29T12:00:00.000Z' }] } }))
    world.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
    const entry = (buyer: string, payment: string, status: string) => ({ buyer, name: buyer, phoneLast4: null, payment, items: [], status, invoice: null, add: [], remove: [] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: '2026-10-29', seq: 5, entries: [entry('u1', 'UNPAID', '포장 대기'), entry('u2', 'PAID', '포장 대기'), entry('u3', 'PAID', '포장 완료')] } }))
    const prow = (buyer: string, address: string, patch: Record<string, unknown> = {}) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, qty: 1, total: 1000, payment: 'PAID', packing: '포장 완료', shipping: 'NONE', address, ready: address === 'CONFIRMED', reason: null, message: null, box: '80', parcel: null, ...patch })
    world.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { date: '2026-10-29', seq: 5, blocked: null, carrier: null, box: '80', ready: [prow('u3', 'CONFIRMED')], excluded: [prow('u1', 'NONE'), prow('u2', 'NONE', { shipping: 'PICKUP' }), prow('extra:a', 'NONE', { extra: true, itemCount: 0 })], booked: [] } }))
    const rrow = (buyer: string, link: string, sentAt: string | null) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, total: 1000, payment: 'PAID', received: 1000, remaining: 0, link: { buyer, status: link, url: null, expiresAt: null, revokedAt: null }, sms: { last4: null, sentAt } })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers$/, () => ({ body: { date: '2026-10-29', rehearsal: false, buyers: [rrow('u1', 'NONE', null), rrow('u2', 'NONE', null), rrow('u3', 'ACTIVE', null)] } }))
    world.services.labels.start()
    const navigation = { ...nav(), openSettle: vi.fn(), openParcels: vi.fn(), openReceipts: vi.fn() }
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    expect(await screen.findByRole('button', { name: '택배 접수 1' })).toBeTruthy()
    const todo = screen.getByRole('group', { name: '다음 할 일' })
    const names = [...todo.querySelectorAll('[role="button"]')].map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual(['손님 정보 받기 1', '확인서 보내기 2', '입금 확인 1', '포장하기 2', '택배 접수 1', '라벨 뽑기 0'])
    fireEvent.click(screen.getByRole('button', { name: '손님 정보 받기 1' }))
    expect(navigation.openSettle).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '택배 접수 1' }))
    expect(navigation.openParcels).toHaveBeenCalledWith('2026-10-29')
    fireEvent.click(screen.getByRole('button', { name: '확인서 보내기 2' }))
    expect(navigation.openReceipts).toHaveBeenCalled()
    world.services.labels.stop()
  })

  it('"웹으로 열기"는 앱 안이 아니라 기기 브라우저로 그 서버의 웹 주소를 연다 (APP-01 AC4)', async () => {
    const world = makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    // 옛 기대: 홈 아래 "웹으로 열기" 줄 → (D-UX2-02) 더보기 탭의 "웹에서 보기".
    // 새 기대(D-APPX-03): 웹 전용 화면을 모두 앱으로 옮겼다 — 남은 웹 열기는 가게 설정 "연결"(바깥 로그인 창을 거치는 것)
    render(world.wrap(<ConnectionsCard />))
    fireEvent.click(await screen.findByRole('button', { name: '유튜브 연결 — 웹으로 열기' }))
    expect(opened).toEqual(['http://test.local/settings/youtube?from=app'])
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
})
