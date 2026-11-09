// 홈 "오늘 할 일" (APP-01, D-UX2-02): 진행 중 방송은 "방송으로 돌아가기"로 한국어 한 줄과 함께 보이고, 새 방송 시작이 요청 번호와 함께 가며,
// "웹으로 열기"는 더보기 탭에서 기기 브라우저로 연다 (AC4). 할 일 숫자는 포장 목록·라벨 대기열의 서버 값이다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setWebOpener } from '../src/lib/open-web.ts'
import { HomeScreen, broadcastLine } from '../src/screens/HomeScreen.tsx'
import { ConnectionsCard } from '../src/screens/settings/ShopExtras.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const nav = () => ({ openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })

describe('HomeScreen', () => {
  // D-UX3-85로 바뀐 기대 (사용자 지시 2026-11-09 홈 개선): 인사 줄·큰 초록 "방송으로 돌아가기" 카드 → 맨 위 왼쪽 "지금 라이브 중 ›"(채널 프로필 사진 + 빨간 테두리)
  it('방송 중이면 맨 위 왼쪽 "지금 라이브 중"이 그 방송을 열고, 채널 프로필 사진을 받아 보인다. 인사 줄은 없다 (D-UX3-85)', async () => {
    const world = makeWorld()
    // D-UX3-91: 유튜브를 이은 방송은 연결이 살아 있고 수집기가 읽는 중일 때만 라이브
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, platforms: ['youtube'] }] } }))
    world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: { broadcastChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }, collector: { status: 'LIVE' } } }))
    world.server.on('GET', /^\/api\/youtube\/channels\/UCaaaaaaaaaaaaaaaaaaaaaa\/avatar$/, () => ({ body: { avatar: 'https://yt3.ggpht.com/me' } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    expect(broadcastLine(BROADCAST)).toBe('저녁 방송 · 10월 29일 · 진행 중')
    const live = await screen.findByRole('button', { name: '지금 라이브 중' })
    await waitFor(() => expect(world.server.callsTo('GET', /\/avatar$/)).toHaveLength(1))
    expect(screen.queryByText('김다육 사장님, 안녕하세요')).toBeNull()
    expect(screen.getByText('라이브')).toBeTruthy()
    // D-UX4-62 (사용자 지시 2026-11-09 "홈화면 상단 영역은 지금 라이브 중 이걸로 하기로 했잖아"): 홈 머리 줄은 이 줄 그대로 — 서비스 이름은 넣지 않는다
    expect(screen.queryByText('라이브지니')).toBeNull()
    expect(screen.getByTestId('home-screen').firstElementChild?.contains(live)).toBe(true)
    fireEvent.click(live)
    expect(navigation.openConsole).toHaveBeenCalledWith('b1')
  })

  // D-UX3-85로 바뀐 기대: "방송 시작하기" 큰 카드·"새 방송 시작"·"리허설 해 보기" 단추 → 맨 위 왼쪽 "라이브 연결 ›" 하나 (새 방송은 그대로 쌓인 화면, D-UX3-09). D-UX3-92: 이름 "내 라이브 연결"
  it('방송 중이 아니면 "라이브 연결"이 새 방송 화면(쌓인 화면)을 연다 — 새 방송·리허설 단추는 없다 (D-UX3-85)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '내 라이브 연결' }))
    expect(navigation.openNewBroadcast).toHaveBeenCalledTimes(1)
    for (const gone of ['새 방송 시작', '리허설 해 보기', '방송 시작하기']) expect(screen.queryByRole('button', { name: gone })).toBeNull()
    expect(world.server.callsTo('POST', /broadcasts/)).toHaveLength(0)
  })

  // D-UX3-85로 바뀐 기대: 큰 카드 "방송 시작하기"·라벨 뽑기 줄·지난 방송 판 금액 → "라이브 연결", 할 일 다섯 줄(라벨 뽑기 없음), 이름 바뀜(입금 확인하기)
  it('진행 중 방송이 없으면 "라이브 연결"이고, 할 일 숫자는 포장 목록 값이다 (D-UX2-02 → D-UX3-85)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, ended: true, endedAt: '2026-10-29T12:00:00.000Z' }] } }))
    world.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
    const item = (no: number, price: number, qty?: number) => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '저녁 방송', no, name: '핑크프릴', price, ...(qty === undefined ? {} : { qty }) })
    const entry = (buyer: string, payment: string, status: string, items: unknown[]) => ({ buyer, name: buyer, phoneLast4: null, payment, items, status, invoice: null, add: [], remove: [] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: '2026-10-29', seq: 5, entries: [entry('u1', 'UNPAID', '포장 대기', [item(1, 10_000)]), entry('u2', 'PAID', '포장 대기', [item(2, 5_000, 2)]), entry('u3', 'PAID', '포장 완료', [item(3, 7_000)])] } }))
    world.services.labels.start()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    expect(await screen.findByRole('button', { name: '내 라이브 연결' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '입금 확인하기 1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '포장하기 2' }))
    expect(navigation.openPacking).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^라벨 뽑기/ })).toBeNull()
    // 지난 방송은 방송 이력에 › 로 (판 금액 없음)
    // D-UX3-88: "방송 이력" → "내 방송"
    expect(screen.getByRole('group', { name: '내 방송' })).toBeTruthy()
    expect(screen.queryByText('4개 팔림')).toBeNull()
    world.services.labels.stop()
  })

  // D-UX3-85로 바뀐 기대: "다음 할 일" → "오늘 할 일", 이름(고객 정보 받기·주문 확인서 보내기·입금 확인하기·택배 접수하기), 설명·구분선·라벨 뽑기 없음
  it('"오늘 할 일"은 흐름 순서 — 고객 정보 받기 → 주문 확인서 보내기 → 입금 확인하기 → 포장하기 → 택배 접수하기, 설명 없음, 숫자는 택배 목록·영수증 목록 값 (D-UX3-39 → D-UX3-85)', async () => {
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
    expect(await screen.findByRole('button', { name: '택배 접수하기 1' })).toBeTruthy()
    const todo = screen.getByRole('group', { name: '오늘 할 일' })
    const names = [...todo.querySelectorAll('[role="button"]')].map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual(['고객 정보 받기 1', '주문 확인서 보내기 2', '입금 확인하기 1', '포장하기 2', '택배 접수하기 1'])
    for (const sub of ['배송지를 아직 못 받은 손님', '주문 확인서를 아직 안 보낸 손님', '돈을 아직 안 보낸 손님']) expect(screen.queryByText(sub)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '고객 정보 받기 1' }))
    expect(navigation.openSettle).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '택배 접수하기 1' }))
    expect(navigation.openParcels).toHaveBeenCalledWith('2026-10-29')
    fireEvent.click(screen.getByRole('button', { name: '주문 확인서 보내기 2' }))
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

  // D-UX3-85로 바뀐 기대: "방송으로 돌아가기"·"방송 시작하기" → "지금 라이브 중"·"라이브 연결", 리허설은 홈에 보이지 않는다
  it('홈이 다시 보이면 방송 목록을 다시 받는다: 방송을 시작하고 돌아오면 "지금 라이브 중", 끝내고 돌아오면 "라이브 연결". 리허설은 라이브로 보지 않는다 (D-UX2-07 → D-UX3-85)', async () => {
    const world = makeWorld()
    let broadcasts: unknown[] = []
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts } }))
    const navigation = nav()
    const view = render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={0} />))
    expect(await screen.findByRole('button', { name: '내 라이브 연결' })).toBeTruthy()
    broadcasts = [{ ...BROADCAST, id: 'r1', title: '리허설 1', rehearsal: true }]
    view.rerender(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={1} />))
    await waitFor(() => expect(world.server.callsTo('GET', /^\/api\/broadcasts$/).length).toBeGreaterThanOrEqual(2))
    expect(await screen.findByRole('button', { name: '내 라이브 연결' })).toBeTruthy()
    broadcasts = [{ ...BROADCAST, id: 'l1' }]
    view.rerender(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={2} />))
    fireEvent.click(await screen.findByRole('button', { name: '지금 라이브 중' }))
    expect(navigation.openConsole).toHaveBeenCalledWith('l1')
    broadcasts = [{ ...BROADCAST, id: 'l1', ended: true, endedAt: '2026-10-29T12:00:00.000Z' }]
    view.rerender(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" refresh={3} />))
    expect(await screen.findByRole('button', { name: '내 라이브 연결' })).toBeTruthy()
  })

  it('어제 끝내지 않고 둔 유튜브 방송(수집기가 채팅 끝)은 라이브가 아니다 — "라이브 연결" (D-UX3-91)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, platforms: ['youtube'] }] } }))
    world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: { broadcastChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }, collector: { status: 'CHAT_ENDED' } } }))
    render(world.wrap(<HomeScreen nav={nav()} sellerName="김다육" />))
    expect(await screen.findByRole('button', { name: '내 라이브 연결' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '지금 라이브 중' })).toBeNull()
  })

  it('연결을 끊은 유튜브 방송도 라이브가 아니다 (D-UX3-91)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, platforms: ['youtube'] }] } }))
    world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
    render(world.wrap(<HomeScreen nav={nav()} sellerName="김다육" />))
    expect(await screen.findByRole('button', { name: '내 라이브 연결' })).toBeTruthy()
  })
})

