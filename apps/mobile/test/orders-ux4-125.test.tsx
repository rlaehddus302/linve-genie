// 주문 탭 수정 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항"):
// 맨 위 "주문" 머리·날짜 캡슐 없음 · 맨 위 단추 셋 [고객 정보 받기][정산서 보내기][입금 확인하기] 한 줄 · 흰 바탕 카드 없는 주문 목록(사진1, 토스 거래 내역) ·
// 줄을 누르면 주문 상세(사진2, 토스 상세 내역): 성함·닉네임(플랫폼 아이콘)·휴대폰 번호·주소 / 표(번호·상품 이름·가격) / 예약일시·총 개수·총 금액·배송비 / 지난 거래 내역.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addressWords, claimedAtWords, dayWeekdayWords, dotDate, joinOrders, parseOrderKey, phoneDashes, shippingNote } from '../src/lib/orders.ts'
import { OrderDetailScreen } from '../src/screens/OrderDetailScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { orderDetail, orderRow, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'

const ROWS = [
  orderRow({ date: '2026-11-11', buyer: 'u1', name: '김다육', nickname: '다육맘', total: 31_000, itemCount: 3 }),
  orderRow({ date: '2026-11-11', buyer: 'u2', name: null, nickname: '초록손', total: 14_000, itemCount: 1 }),
  orderRow({ date: '2026-11-10', buyer: 'u3', name: '이선인', nickname: '선인장러버', total: 54_000, itemCount: 4 }),
]

const labels = () => within(screen.getByRole('list', { name: '주문 목록' })).getAllByRole('button').map((row) => row.getAttribute('aria-label'))

describe('주문 목록 (D-UX4-125)', () => {
  it('"주문" 머리·날짜 캡슐이 없고, 맨 위 단추 셋이 한 줄에 있어 각 화면을 연다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    const nav = { openBuyerInfo: vi.fn(), openReceipts: vi.fn(), openDeposits: vi.fn() }
    render(w.wrap(<SettleScreen nav={nav} />))
    await screen.findByRole('list', { name: '주문 목록' })
    expect(screen.queryByRole('heading', { name: '주문', level: 1 })).toBeNull()
    expect(screen.queryAllByRole('button', { name: /^날짜 / })).toHaveLength(0)
    const top = screen.getByRole('group', { name: '주문 할 일' })
    // 단추는 좌우로만 — 한 줄(가로) 묶음 안에 셋
    expect(within(top).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['고객 정보 받기', '정산서 보내기', '입금 확인하기'])
    expect(top.style.flexDirection).toBe('row')
    fireEvent.click(within(top).getByRole('button', { name: '고객 정보 받기' }))
    fireEvent.click(within(top).getByRole('button', { name: '정산서 보내기' }))
    fireEvent.click(within(top).getByRole('button', { name: '입금 확인하기' }))
    expect(nav.openBuyerInfo).toHaveBeenCalledOnce()
    expect(nav.openReceipts).toHaveBeenCalledOnce()
    expect(nav.openDeposits).toHaveBeenCalledOnce()
    // 흰 바탕 (회색 화면 바탕이 아니다)
    expect(screen.getByTestId('settle-screen').style.backgroundColor).toBe('rgb(255, 255, 255)')
  })

  it('줄: 날짜는 그 날짜 첫 줄에만, 성함(없으면 닉네임)과 작은 닉네임(성함 없으면 "성함 받기 전"), 오른쪽 총 금액·개수', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    render(w.wrap(<SettleScreen />))
    await screen.findByRole('list', { name: '주문 목록' })
    expect(labels()).toEqual([
      '11월 11일 · 김다육 · 다육맘 · 31,000원 · 3개',
      '11월 11일 · 초록손 · 성함 받기 전 · 14,000원 · 1개',
      '11월 10일 · 이선인 · 선인장러버 · 54,000원 · 4개',
    ])
    expect(screen.getAllByText('11.11')).toHaveLength(1)
    expect(screen.getAllByText('11.10')).toHaveLength(1)
    const second = screen.getByRole('button', { name: /초록손/ })
    expect(within(second).queryByText('11.11')).toBeNull()
    expect(within(second).getByText('성함 받기 전')).toBeTruthy()
    const first = screen.getByRole('button', { name: /김다육/ })
    expect(within(first).getByText('31,000원')).toBeTruthy()
    expect(within(first).getByText('3개')).toBeTruthy()
  })

  it('줄을 누르면 쌓인 주문 상세를 연다(날짜·손님)', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    const openOrder = vi.fn()
    render(w.wrap(<SettleScreen nav={{ openOrder }} />))
    fireEvent.click(await screen.findByRole('button', { name: /이선인/ }))
    expect(openOrder).toHaveBeenCalledWith('2026-11-10', 'u3')
  })

  it('쌓인 화면이 없으면(시험·웹) 이 화면 안에서 상세로 바꿔 끼우고 뒤로 가면 목록', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS), { details: { '2026-11-10|u3': orderDetail({ date: '2026-11-10', buyer: 'u3', name: '이선인', nickname: '선인장러버' }) } })
    render(w.wrap(<SettleScreen />))
    fireEvent.click(await screen.findByRole('button', { name: /이선인/ }))
    expect(await screen.findByRole('heading', { name: '이선인', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '주문 상세', level: 1 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '주문 목록으로' }))
    expect(await screen.findByRole('list', { name: '주문 목록' })).toBeTruthy()
  })

  it('끝까지 내리면 다음 쪽(?before=)을 이어 붙인다 — 같은 날짜 줄은 한 번만', async () => {
    const w = makeWorld()
    const page2 = ordersView([orderRow({ date: '2026-11-10', buyer: 'u3', name: '이선인', nickname: '선인장러버', total: 54_000, itemCount: 4 }), orderRow({ date: '2026-11-03', buyer: 'u9', name: '박금황', nickname: '금황이', total: 9_000, itemCount: 1 })])
    withOrders(w, ordersView(ROWS, { more: true, next: '2026-11-10' }), { pages: { '2026-11-10': page2 } })
    render(w.wrap(<SettleScreen />))
    await screen.findByRole('list', { name: '주문 목록' })
    expect(w.server.callsTo('GET', /^\/api\/orders\?before=/)).toHaveLength(0)
    fireEvent.scroll(screen.getByTestId('orders-scroll'), { target: { scrollY: 2000 } })
    expect(await screen.findByRole('button', { name: /박금황/ })).toBeTruthy()
    expect(w.server.callsTo('GET', /^\/api\/orders\?before=/).map((call) => call.path)).toEqual(['/api/orders?before=2026-11-10'])
    expect(labels()).toHaveLength(4)
    expect(screen.getByText('11.03')).toBeTruthy()
    // 마지막 쪽(more 없음)이면 더 묻지 않는다
    fireEvent.scroll(screen.getByTestId('orders-scroll'), { target: { scrollY: 4000 } })
    await waitFor(() => expect(w.server.callsTo('GET', /^\/api\/orders\?before=/)).toHaveLength(1))
  })

  it('주문이 없으면 "아직 주문이 없어요"', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]))
    render(w.wrap(<SettleScreen />))
    expect(await screen.findByText('아직 주문이 없어요')).toBeTruthy()
  })

  it('목록을 못 받으면 오류와 다시 불러오기', async () => {
    const broken = makeWorld()
    let fail = true
    broken.server.on('GET', /^\/api\/orders$/, () => (fail ? { status: 500, body: { error: { code: 'INTERNAL', message: '잠시 뒤에 다시 해 주세요.' } } } : { body: ordersView(ROWS) }))
    render(broken.wrap(<SettleScreen />))
    expect(await screen.findByText('잠시 뒤에 다시 해 주세요.')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '지금 다시 불러오기' }))
    expect(await screen.findByRole('list', { name: '주문 목록' })).toBeTruthy()
  })

  it('택배 화면 [배송지 보기]로 온 날짜·손님은 상세부터 연다 (쌓인 화면이면 한 번만)', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    const openOrder = vi.fn()
    const { rerender } = render(w.wrap(<SettleScreen initialDate="2026-11-10" initialBuyer="u3" nav={{ openOrder }} />))
    rerender(w.wrap(<SettleScreen initialDate="2026-11-10" initialBuyer="u3" nav={{ openOrder }} />))
    await screen.findByRole('list', { name: '주문 목록' })
    expect(openOrder.mock.calls).toEqual([['2026-11-10', 'u3']])
  })

  it('확인할 손님 정보 문자가 있으면 [고객 정보 받기]에 작은 점 (옛 정산 탭 위 줄 대신)', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    w.server.on('GET', /^\/api\/buyer-info$/, () => ({ body: { cards: [{ id: 'bi_1', status: 'OPEN' }, { id: 'bi_2', status: 'APPLIED' }], buyers: [] } }))
    render(w.wrap(<SettleScreen nav={{ openBuyerInfo: () => {} }} />))
    expect(await screen.findByRole('button', { name: '고객 정보 받기 · 확인할 문자 1건' })).toBeTruthy()
    expect(screen.getByTestId('top-button-dot')).toBeTruthy()
  })
})

const openDetail = (w: ReturnType<typeof makeWorld>, props: Partial<Parameters<typeof OrderDetailScreen>[0]> = {}) => render(w.wrap(<OrderDetailScreen date="2026-10-29" buyer="u1" onBack={() => {}} {...props} />))

describe('주문 상세 (D-UX4-125)', () => {
  it('손님: 성함 크게 · 플랫폼 아이콘과 닉네임 · 휴대폰 번호 010-1234-5678 · 주소 (우편번호) 주소 상세', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail() } })
    openDetail(w)
    const head = await screen.findByRole('group', { name: '손님' })
    expect(within(head).getByRole('heading', { name: '김다육', level: 2 })).toBeTruthy()
    expect(within(head).getByLabelText('닉네임 유튜브 다육맘')).toBeTruthy()
    expect(within(head).getByLabelText('휴대폰 번호 010-1234-5678')).toBeTruthy()
    expect(within(head).getByLabelText('주소 (50603) 경상남도 양산시 물금읍 증산리 1034')).toBeTruthy()
    expect(within(head).getByRole('button', { name: '배송지 확인·고치기' })).toBeTruthy()
    // 묶음 사이 굵은 회색 띠
    expect(screen.getAllByTestId('detail-band').length).toBeGreaterThanOrEqual(4)
  })

  it('모르는 것: 성함 없으면 닉네임과 "성함 받기 전", 번호 "모름", 배송지 "배송지 받기 전", 인스타·문자 손님은 글자 꼬리표', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ name: null, phone: null, address: null, platform: 'INSTAGRAM' }), '2026-10-29|u2': orderDetail({ buyer: 'u2', nickname: '01055556666', platform: 'SMS' }) } })
    const { unmount } = openDetail(w)
    const head = await screen.findByRole('group', { name: '손님' })
    expect(within(head).getByRole('heading', { name: '다육맘', level: 2 })).toBeTruthy()
    expect(within(head).getByText('성함 받기 전')).toBeTruthy()
    expect(within(head).getByLabelText('휴대폰 번호 모름')).toBeTruthy()
    expect(within(head).getByLabelText('주소 배송지 받기 전')).toBeTruthy()
    expect(within(head).getByText('인스타')).toBeTruthy()
    unmount()
    openDetail(w, { buyer: 'u2' })
    const sms = await screen.findByRole('group', { name: '손님' })
    expect(within(sms).getByText('문자')).toBeTruthy()
  })

  it('표: 번호 | 상품 이름 | 가격 — 둘 이상이면 이름 뒤 ×n, 가격은 그 줄 합', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ items: [{ no: 3, name: '금황', price: 15_000, qty: 1 }, { no: 15, name: '핑크프릴', price: 8_000, qty: 2 }], itemCount: 3, subtotal: 31_000 }) } })
    openDetail(w)
    const table = await screen.findByRole('table', { name: '상품' })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['번호', '상품 이름', '가격'])
    expect(rows.slice(1).map((row) => row.getAttribute('aria-label'))).toEqual(['3번 금황 15,000원', '15번 핑크프릴 ×2 16,000원'])
  })

  it('금액: 예약일시는 한국 시각(요일까지), 총 개수·총 금액, 배송비와 무료 기준, [배송비 기준 바꾸기]는 가게 설정', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ claimedAt: '2026-10-29T06:42:00.000Z', received: 4_000, payment: 'PARTIAL' }) } })
    const onOpenShopSettings = vi.fn()
    openDetail(w, { onOpenShopSettings })
    const money = await screen.findByRole('group', { name: '금액' })
    // 06:42Z = 한국 15:42 (시험은 TZ=Pacific/Honolulu — 기기 시간대와 상관없다)
    expect(within(money).getByLabelText('예약일시 10월 29일 목요일 15:42')).toBeTruthy()
    expect(within(money).getByLabelText('총 개수 1개')).toBeTruthy()
    expect(within(money).getByLabelText('총 금액 14,000원')).toBeTruthy()
    expect(within(money).getByLabelText('배송비 4,000원')).toBeTruthy()
    expect(within(money).getByText('50,000원 이상 구매 시 무료')).toBeTruthy()
    expect(within(money).getByLabelText('받은 금액 4,000원')).toBeTruthy()
    expect(within(money).getByLabelText('남은 금액 10,000원')).toBeTruthy()
    expect(within(money).queryByLabelText(/^할인·추가/)).toBeNull()
    expect(within(money).queryByLabelText(/^돌려줄 돈/)).toBeNull()
    fireEvent.click(within(money).getByRole('button', { name: '배송비 기준 바꾸기' }))
    expect(onOpenShopSettings).toHaveBeenCalledOnce()
  })

  it('금액: 할인·추가와 돌려줄 돈은 있을 때만, 무료 기준이 없으면 기본 배송비, 직접 수령이면 그 말', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), {
      details: {
        '2026-10-29|u1': orderDetail({ adjustments: -1_000, total: 13_000, received: 20_000, refundDue: 7_000, payment: 'OVERPAID', shippingRule: { baseFee: 4_000, freeThreshold: null, mode: 'DEFAULT' } }),
        '2026-10-29|u2': orderDetail({ buyer: 'u2', shipping: 0, shippingRule: { baseFee: 4_000, freeThreshold: 50_000, mode: 'PICKUP' } }),
      },
    })
    const { unmount } = openDetail(w)
    const money = await screen.findByRole('group', { name: '금액' })
    expect(within(money).getByLabelText('할인·추가 −1,000원')).toBeTruthy()
    expect(within(money).getByLabelText('돌려줄 돈 7,000원')).toBeTruthy()
    expect(within(money).getByLabelText('남은 금액 0원')).toBeTruthy()
    expect(within(money).getByText('기본 배송비 4,000원')).toBeTruthy()
    unmount()
    openDetail(w, { buyer: 'u2' })
    expect(within(await screen.findByRole('group', { name: '금액' })).getByText('직접 수령')).toBeTruthy()
  })

  it('지난 거래 내역: 거래 횟수 | 총 금액, 날짜별 줄 — 열 수 있는 줄은 그날 상세', async () => {
    const w = makeWorld()
    const history = {
      count: 3,
      total: 61_000,
      lines: [
        { date: '2026-10-20', buyer: 'u1', total: 30_000, itemCount: 2, openable: true },
        { date: '2026-10-20', buyer: 'u1b', total: 9_000, itemCount: 1, openable: true },
        { date: '2026-08-01', buyer: 'u1', total: 22_000, itemCount: 2, openable: false },
      ],
    }
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ history }) } })
    const onOpenOrder = vi.fn()
    openDetail(w, { onOpenOrder })
    const past = await screen.findByRole('group', { name: '지난 거래 내역' })
    expect(within(past).getByLabelText('거래 횟수 3회')).toBeTruthy()
    expect(within(past).getByLabelText('총 금액 61,000원')).toBeTruthy()
    expect(within(past).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['10월 20일 화요일', '8월 1일 토요일'])
    expect(within(past).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['10월 20일 거래 30,000원 · 2개', '10월 20일 거래 9,000원 · 1개'])
    // 봉인 보관만 남은 날은 누를 수 없다
    expect(within(past).getByLabelText('8월 1일 거래 22,000원 · 2개').getAttribute('role')).not.toBe('button')
    fireEvent.click(within(past).getByRole('button', { name: '10월 20일 거래 9,000원 · 1개' }))
    expect(onOpenOrder).toHaveBeenCalledWith('2026-10-20', 'u1b')
  })

  it('지난 거래가 없으면 "지난 거래가 없어요"', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail() } })
    openDetail(w)
    const past = await screen.findByRole('group', { name: '지난 거래 내역' })
    expect(within(past).getByText('지난 거래가 없어요')).toBeTruthy()
    expect(within(past).queryByLabelText(/^거래 횟수/)).toBeNull()
  })

  it('못 받으면 오류와 다시 불러오기', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]))
    openDetail(w)
    expect(await screen.findByText('그 주문을 찾지 못했어요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '지금 다시 불러오기' })).toBeTruthy()
  })
})

describe('주문 글자 (D-UX4-125)', () => {
  it('날짜·시각은 한국 시각, 번호·주소·배송비 글', () => {
    expect(dotDate('2026-11-11')).toBe('11.11')
    expect(dotDate('2026-11-03')).toBe('11.03')
    expect(dayWeekdayWords('2026-11-11')).toBe('11월 11일 수요일')
    expect(dayWeekdayWords('2026-11-03')).toBe('11월 3일 화요일')
    // 한국 자정 넘김: UTC 11/10 15:30 = 한국 11/11 00:30
    expect(claimedAtWords('2026-11-10T15:30:00.000Z')).toBe('11월 11일 수요일 00:30')
    expect(phoneDashes('01012345678')).toBe('010-1234-5678')
    expect(phoneDashes('0101234567')).toBe('010-123-4567')
    expect(phoneDashes(null)).toBe('모름')
    expect(addressWords({ address: '서울 중구', detail: '', zip: '' })).toBe('서울 중구')
    expect(addressWords(null)).toBe('배송지 받기 전')
    expect(shippingNote({ baseFee: 3_500, freeThreshold: 50_000, mode: 'DEFAULT' })).toBe('50,000원 이상 구매 시 무료')
    expect(shippingNote({ baseFee: 3_500, freeThreshold: null, mode: 'DEFAULT' })).toBe('기본 배송비 3,500원')
    expect(shippingNote({ baseFee: 3_500, freeThreshold: null, mode: 'COMBINED' })).toBe('합배송')
    expect(shippingNote({ baseFee: 3_500, freeThreshold: null, mode: 'FIXED' })).toBe('따로 정한 배송비')
  })

  it('쪽 잇기는 같은 줄을 한 번만, 옛 상세 열쇠(["손님","날짜"])를 읽는다', () => {
    const a = orderRow({ date: '2026-11-10', buyer: 'u1' })
    const b = orderRow({ date: '2026-11-09', buyer: 'u1' })
    expect(joinOrders([[a], [a, b]])).toEqual([a, b])
    expect(parseOrderKey(JSON.stringify(['u1', '2026-10-29']))).toEqual({ buyer: 'u1', date: '2026-10-29' })
    expect(parseOrderKey('u1')).toBeNull()
    expect(parseOrderKey(JSON.stringify(['u1', 'yesterday']))).toBeNull()
  })
})
