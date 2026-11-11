// 주문 탭 수정 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항"):
// 맨 위 "주문" 머리·날짜 캡슐 없음 · 맨 위 단추 셋 [고객 정보 받기][정산서 보내기][입금 확인하기] 한 줄 · 흰 바탕 카드 없는 주문 목록(사진1, 토스 거래 내역) ·
// 줄을 누르면 주문 상세(사진2, 토스 상세 내역).
// D-UX4-126 (사용자 지시 2026-11-11 두 번째 수정): 날짜 11.7 · 줄은 닉네임 아래 성함, 모르는 정보는 빨간 "성함 · 휴대폰 번호 · 주소 모름" ·
// 상세 맨 위 플랫폼 아이콘 + 닉네임, 이름표·내용 줄(모르면 빨간 "모름 ›" → 손님 정보 화면) · 표(번호·상품명·가격) 바로 아래 총 개수·배송비·총 금액(왼쪽 "배송비 포함")·예약 날짜 ·
// 작은 회색 단추 [배송비 기준 바꾸기][내보내기] · 받은 금액·남은 금액은 따로 묶음.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addressWords, claimedAtWords, dayWeekdayWords, dotDate, fullDateWeekdayWords, fullDateWords, joinOrders, missingWords, parseOrderKey, phoneDashes, reservedDateWords, shippingNote } from '../src/lib/orders.ts'
import { setNativeModules } from '../src/native/index.ts'
import { OrderDetailScreen } from '../src/screens/OrderDetailScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { orderDetail, orderRow, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'

const ROWS = [
  orderRow({ date: '2026-11-11', buyer: 'u1', name: '김다육', nickname: '다육맘', total: 31_000, itemCount: 3 }),
  orderRow({ date: '2026-11-11', buyer: 'u2', name: null, nickname: '초록손', total: 14_000, itemCount: 1, missing: ['name', 'phone', 'address'] }),
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

  // D-UX4-126: 옛 "성함(없으면 닉네임) 위 · 작은 닉네임(없으면 성함 받기 전)" → 닉네임 위 · 작은 성함 · 빨간 모르는 정보, 날짜 앞 0 없이
  it('줄: 날짜(11.7처럼)는 그 날짜 첫 줄에만, 닉네임과 그 아래 작은 성함, 모르는 정보는 빨간 "… 모름", 오른쪽 총 금액·개수', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    render(w.wrap(<SettleScreen />))
    await screen.findByRole('list', { name: '주문 목록' })
    expect(labels()).toEqual([
      '11월 11일 · 다육맘 · 김다육 · 31,000원 · 3개',
      '11월 11일 · 초록손 · 성함 · 휴대폰 번호 · 주소 모름 · 14,000원 · 1개',
      '11월 10일 · 선인장러버 · 이선인 · 54,000원 · 4개',
    ])
    expect(screen.getAllByText('11.11')).toHaveLength(1)
    expect(screen.getAllByText('11.10')).toHaveLength(1)
    const second = screen.getByRole('button', { name: /초록손/ })
    expect(within(second).queryByText('11.11')).toBeNull()
    const red = within(second).getByText('성함 · 휴대폰 번호 · 주소 모름')
    expect(red.style.color).toBe('rgb(221, 24, 36)')
    expect(within(second).queryByText('성함 받기 전')).toBeNull()
    const first = screen.getByRole('button', { name: /김다육/ })
    expect(within(first).queryByText(/모름/)).toBeNull()
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
    // D-UX4-126: 상세 맨 위 큰 글은 닉네임 (옛: 성함)
    expect(await screen.findByRole('heading', { name: '선인장러버', level: 2 })).toBeTruthy()
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
    expect(screen.getByText('11.3')).toBeTruthy()
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
  // D-UX4-126: 맨 위는 플랫폼 아이콘 + 닉네임, 그 아래 이름표·내용 줄 셋(눌러 고친다). 옛 "배송지 확인·고치기" 글은 없다
  it('손님: 맨 위 플랫폼 아이콘과 닉네임 · 성함 · 휴대폰 번호 010-1234-5678 · 주소 (우편번호) 주소 상세 — 줄을 누르면 그 칸을 고친다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail() } })
    const onEditInfo = vi.fn()
    openDetail(w, { onEditInfo })
    const head = await screen.findByRole('group', { name: '손님' })
    expect(within(head).getByRole('heading', { name: '다육맘', level: 2 })).toBeTruthy()
    expect(within(head).getByLabelText('닉네임 유튜브 다육맘')).toBeTruthy()
    expect(within(head).getByRole('button', { name: '성함 김다육 · 고치기' })).toBeTruthy()
    expect(within(head).getByRole('button', { name: '휴대폰 번호 010-1234-5678 · 고치기' })).toBeTruthy()
    fireEvent.click(within(head).getByRole('button', { name: '주소 (50603) 경상남도 양산시 물금읍 증산리 1034 · 고치기' }))
    expect(onEditInfo).toHaveBeenCalledWith('address')
    expect(within(head).queryByText('배송지 확인·고치기')).toBeNull()
    expect(screen.queryByRole('group', { name: '배송지' })).toBeNull()
    // D-UX4-128 "모름 아닌것들은 > 없애고 오른쪽에 잘 붙여": 아는 값 줄에는 ›가 없다(그래도 눌러 고친다)
    expect(within(head).getByRole('button', { name: '성함 김다육 · 고치기' }).querySelector('svg')).toBeNull()
    // 묶음 사이 굵은 회색 띠 (D-UX4-128: 아래 메뉴 묶음이 없어져 손님 | 주문 | 입금 | 최근 주문 내역 사이 셋)
    expect(screen.getAllByTestId('detail-band').length).toBe(3)
  })

  // D-UX4-126: 옛 "성함 받기 전"·"배송지 받기 전" → 셋 다 빨간 "모름 ›", 누르면 그 칸부터 묻는 손님 정보 화면
  it('모르는 것: 성함·휴대폰 번호·주소 모두 빨간 "모름", 누르면 그 칸, 인스타·문자 손님은 글자 꼬리표', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ name: null, phone: null, address: null, platform: 'INSTAGRAM' }), '2026-10-29|u2': orderDetail({ buyer: 'u2', nickname: '01055556666', platform: 'SMS' }) } })
    const onEditInfo = vi.fn()
    const { unmount } = openDetail(w, { onEditInfo })
    const head = await screen.findByRole('group', { name: '손님' })
    expect(within(head).getByRole('heading', { name: '다육맘', level: 2 })).toBeTruthy()
    expect(within(head).queryByText(/받기 전/)).toBeNull()
    for (const label of ['성함', '휴대폰 번호', '주소']) {
      const row = within(head).getByRole('button', { name: `${label} 모름 · 고치기` })
      expect(within(row).getByText('모름').style.color).toBe('rgb(221, 24, 36)')
    }
    fireEvent.click(within(head).getByRole('button', { name: '휴대폰 번호 모름 · 고치기' }))
    expect(onEditInfo).toHaveBeenCalledWith('phone')
    expect(within(head).getByText('인스타')).toBeTruthy()
    unmount()
    openDetail(w, { buyer: 'u2' })
    const sms = await screen.findByRole('group', { name: '손님' })
    expect(within(sms).getByText('문자')).toBeTruthy()
  })

  // D-UX4-127 (사용자 지시 2026-11-11 "표 컬럼에 개수 추가해주고, 번호와 개수는 중간정렬"): 옛 번호 | 상품명 | 가격, 이름 뒤 ×n → 개수 칸
  it('표: 번호 | 상품명 | 개수 | 가격 — 번호·개수는 가운데, 가격은 그 줄 합', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ items: [{ no: 3, name: '금황', price: 15_000, qty: 1 }, { no: 15, name: '핑크프릴', price: 8_000, qty: 2 }], itemCount: 3, subtotal: 31_000 }) } })
    openDetail(w)
    const table = await screen.findByRole('table', { name: '상품' })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['번호', '상품명', '개수', '가격'])
    expect(rows.slice(1, 3).map((row) => row.getAttribute('aria-label'))).toEqual(['3번 금황 1개 15,000원', '15번 핑크프릴 2개 16,000원'])
    expect(within(rows[2]!).getByText('15').style.textAlign).toBe('center')
    expect(within(rows[2]!).getByText('2').style.textAlign).toBe('center')
    expect(within(table).queryByText(/×2/)).toBeNull()
  })

  // D-UX4-127 (사용자 지시 2026-11-11): 목록 끝 얇은 구분선(띠 아님) → 총합(개수 칸 아래 개수 합 · 가격 칸 아래 가격 합) → 배송비 → 최종 금액.
  // 옛 총 개수·총 금액(왼쪽 "배송비 포함") 줄은 없다. 예약 날짜는 주소 아래(요일까지). 받은·남은 금액은 "입금" 이름표 묶음, 남은 금액이 있으면 빨강.
  // 사용자 말 "총 결제금액"은 앱 글 "결제" 금지(D-PAY-01·AC-PAY2-01)라 "최종 금액"으로 (D-UX4-127 AUTO)
  // D-UX4-128 (사용자 지시 2026-11-11): 무료 기준 글은 따로 빼지 않고 이름표 "배송비(50,000원 이상 구매 시 무료배송)", 단추 [배송비 바꾸기][정산서 보내기],
  // [배송비 바꾸기] → 아래 창 "배송비 기준 바꾸기"(가게 설정) / "이 주문 배송비 바꾸기"(키보드 화면)
  it('금액: 구분선 아래 총합·배송비(이름표 괄호에 무료 기준)·최종 금액, 예약 날짜는 주소 아래, "입금" 묶음 남은 금액 빨강, [배송비 바꾸기]는 둘 중 고르기', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ claimedAt: '2026-10-29T06:42:00.000Z', received: 4_000, payment: 'PARTIAL' }) } })
    const onOpenShopSettings = vi.fn()
    const onEditShipping = vi.fn()
    openDetail(w, { onOpenShopSettings, onEditShipping })
    const table = await screen.findByRole('table', { name: '상품' })
    expect(within(table).getByTestId('table-rule')).toBeTruthy()
    expect(within(table).getAllByRole('row').slice(2).map((row) => row.getAttribute('aria-label'))).toEqual([
      '총합 1개 10,000원',
      '배송비(50,000원 이상 구매 시 무료배송) 4,000원',
      '최종 금액 14,000원',
    ])
    expect(within(table).queryByText('50,000원 이상 구매 시 무료')).toBeNull()
    expect(within(table).queryByText('배송비 포함')).toBeNull()
    const head = screen.getByRole('group', { name: '손님' })
    expect(within(head).getByLabelText('예약 날짜 2026년 10월 29일 목요일')).toBeTruthy()
    // 표와 같은 묶음 — 사이에 회색 띠가 없다
    const order = screen.getByRole('group', { name: '주문' })
    expect(within(order).queryByTestId('detail-band')).toBeNull()
    const paid = screen.getByRole('group', { name: '입금' })
    expect(within(paid).getByRole('heading', { name: '입금' })).toBeTruthy()
    expect(within(paid).getByLabelText('받은 금액 4,000원')).toBeTruthy()
    expect(within(within(paid).getByLabelText('남은 금액 10,000원')).getByText('10,000원').style.color).toBe('rgb(221, 24, 36)')
    expect(within(order).queryByLabelText(/^할인·추가/)).toBeNull()
    expect(within(paid).queryByLabelText(/^돌려줄 돈/)).toBeNull()
    // 단추는 좌우로 — [배송비 바꾸기] 왼쪽, [정산서 보내기] 오른쪽
    expect(within(order).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['배송비 바꾸기', '정산서 보내기'])
    fireEvent.click(within(order).getByRole('button', { name: '배송비 바꾸기' }))
    const choice = await screen.findByTestId('shipping-choice')
    fireEvent.click(within(choice).getByRole('radio', { name: /이 주문 배송비 바꾸기/ }))
    await waitFor(() => expect(onEditShipping).toHaveBeenCalledOnce())
    fireEvent.click(within(order).getByRole('button', { name: '배송비 바꾸기' }))
    fireEvent.click(within(await screen.findByTestId('shipping-choice')).getByRole('radio', { name: /배송비 기준 바꾸기/ }))
    await waitFor(() => expect(onOpenShopSettings).toHaveBeenCalledOnce())
  })

  it('금액: 할인·추가와 돌려줄 돈은 있을 때만, 무료 기준이 없으면 그냥 "배송비", 직접 수령이면 괄호에 그 말, 다 받았으면 남은 금액은 빨강이 아니고 입금 확인 단추도 없다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), {
      details: {
        '2026-10-29|u1': orderDetail({ adjustments: -1_000, total: 13_000, received: 20_000, refundDue: 7_000, payment: 'OVERPAID', shippingRule: { baseFee: 4_000, freeThreshold: null, mode: 'DEFAULT' } }),
        '2026-10-29|u2': orderDetail({ buyer: 'u2', shipping: 0, shippingRule: { baseFee: 4_000, freeThreshold: 50_000, mode: 'PICKUP' } }),
      },
    })
    const { unmount } = openDetail(w)
    const table = await screen.findByRole('table', { name: '상품' })
    expect(within(table).getByLabelText('할인·추가 −1,000원')).toBeTruthy()
    expect(within(table).getByLabelText('최종 금액 13,000원')).toBeTruthy()
    expect(within(table).getByLabelText('배송비 4,000원')).toBeTruthy()
    const paid = screen.getByRole('group', { name: '입금' })
    expect(within(paid).getByLabelText('돌려줄 돈 7,000원')).toBeTruthy()
    expect(within(within(paid).getByLabelText('남은 금액 0원')).getByText('0원').style.color).not.toBe('rgb(221, 24, 36)')
    expect(within(paid).queryByRole('button', { name: '입금을 확인했나요?' })).toBeNull()
    unmount()
    openDetail(w, { buyer: 'u2' })
    expect(within(await screen.findByRole('table', { name: '상품' })).getByLabelText('배송비(직접 수령) 0원')).toBeTruthy()
  })

  // D-UX4-126: [내보내기] → 아래 창 [사진][CSV 파일][엑셀 파일] → 서버 파일을 받아 공유 창
  // D-UX4-128 (사용자 지시 2026-11-11 "내보내기 -> 정산서 보내기 이름 바꾸고, … 고객에게 문자 보내기, 사진으로 저장하기, CSV 파일로 저장하기, 엑셀 파일로 저장하기 버튼 형태 말고 배치해"):
  // 옛 단추 셋 한 줄 → 이름 + › 줄 넷
  it('[정산서 보내기]: 문자·사진·CSV·엑셀 줄 넷, 파일을 고르면 그 파일을 받아 공유 창으로', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail() } })
    const pulled: string[] = []
    w.server.on('GET', /\/(order\.(csv|xlsx)|receipt\.jpg)\?/, (call) => {
      pulled.push(call.path)
      return { bytes: new Uint8Array([1, 2, 3]), contentType: 'application/octet-stream' }
    })
    const shared: { name: string; mime: string }[] = []
    setNativeModules({ shareFile: async (_bytes, name, mime) => void shared.push({ name, mime }) })
    openDetail(w)
    fireEvent.click(await screen.findByRole('button', { name: '정산서 보내기' }))
    const sheet = await screen.findByTestId('order-send')
    expect(within(sheet).getByText('파일에는 휴대폰 번호와 주소를 넣지 않아요.')).toBeTruthy()
    expect(within(sheet).getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((label) => /(보내기|저장하기)$/.test(label ?? ''))).toEqual(['고객에게 문자 보내기', '사진으로 저장하기', 'CSV 파일로 저장하기', '엑셀 파일로 저장하기'])
    fireEvent.click(within(sheet).getByRole('button', { name: '엑셀 파일로 저장하기' }))
    await waitFor(() => expect(shared).toEqual([{ name: 'order-2026-10-29.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]))
    expect(pulled).toEqual(['/api/days/2026-10-29/order.xlsx?buyer=u1'])
    fireEvent.click(await screen.findByRole('button', { name: '정산서 보내기' }))
    fireEvent.click(within(await screen.findByTestId('order-send')).getByRole('button', { name: '사진으로 저장하기' }))
    await waitFor(() => expect(shared).toHaveLength(2))
    expect(pulled[1]).toBe('/api/days/2026-10-29/receipt.jpg?buyer=u1')
    expect(shared[1]).toEqual({ name: 'order-2026-10-29.jpg', mime: 'image/jpeg' })
  })

  // D-UX4-128 (사용자 지시 2026-11-11 "지난 거래 내역 -> 최근 주문 내역. 현재 주문도 1회로 보도록 해줘"): 옛 "지난 거래 내역(지금 주문 빼고)" → 지금 주문을 더해 센다
  it('최근 주문 내역: 지금 주문도 1회로 — 거래 횟수 | 총 금액, 날짜별 줄, 열 수 있는 지난 줄은 그날 상세', async () => {
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
    const past = await screen.findByRole('group', { name: '최근 주문 내역' })
    expect(within(past).getByLabelText('거래 횟수 4회')).toBeTruthy()
    expect(within(past).getByLabelText('총 금액 75,000원')).toBeTruthy()
    expect(within(past).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['10월 29일 목요일', '10월 20일 화요일', '8월 1일 토요일'])
    // 지금 주문 줄은 이 화면이라 누르지 않는다
    expect(within(past).getByLabelText('10월 29일 거래 14,000원 · 1개').getAttribute('role')).not.toBe('button')
    expect(within(past).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['10월 20일 거래 30,000원 · 2개', '10월 20일 거래 9,000원 · 1개'])
    // 봉인 보관만 남은 날은 누를 수 없다
    expect(within(past).getByLabelText('8월 1일 거래 22,000원 · 2개').getAttribute('role')).not.toBe('button')
    fireEvent.click(within(past).getByRole('button', { name: '10월 20일 거래 9,000원 · 1개' }))
    expect(onOpenOrder).toHaveBeenCalledWith('2026-10-20', 'u1b')
    // D-UX4-128 "지난 거래 내역 아래에 있는 메뉴들 다 지워": 확인서·금액 고치기·금액 기록 묶음이 없다
    expect(screen.queryByRole('group', { name: '확인서' })).toBeNull()
    expect(screen.queryByRole('group', { name: '금액 고치기' })).toBeNull()
  })

  // D-UX4-128: 옛 "지난 거래가 없으면 '지난 거래가 없어요'" → 지금 주문이 늘 1회라 빈 글은 없다
  it('다른 주문이 없어도 최근 주문 내역은 지금 주문 1회', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail() } })
    openDetail(w)
    const past = await screen.findByRole('group', { name: '최근 주문 내역' })
    expect(within(past).getByLabelText('거래 횟수 1회')).toBeTruthy()
    expect(within(past).getByLabelText('총 금액 14,000원')).toBeTruthy()
    expect(within(past).queryByText('지난 거래가 없어요')).toBeNull()
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
    // D-UX4-126: 앞 0 없이 (옛 11.03)
    expect(dotDate('2026-11-03')).toBe('11.3')
    expect(dotDate('2026-01-07')).toBe('1.7')
    expect(fullDateWords('2026-11-07')).toBe('2026년 11월 7일')
    // 예약 날짜는 한국 날짜: UTC 11/10 15:30 = 한국 11/11, 모르면 주문 날짜
    // D-UX4-127: 예약 날짜에 요일까지 (사용자 지시 "요일도 추가해줘")
    expect(reservedDateWords('2026-11-10T15:30:00.000Z', '2026-11-10')).toBe('2026년 11월 11일 수요일')
    expect(reservedDateWords(null, '2026-11-07')).toBe('2026년 11월 7일 토요일')
    expect(fullDateWeekdayWords('2026-11-09')).toBe('2026년 11월 9일 월요일')
    expect(missingWords(['address', 'name'])).toBe('성함 · 주소 모름')
    expect(missingWords(['phone'])).toBe('휴대폰 번호 모름')
    expect(missingWords([])).toBeNull()
    expect(dayWeekdayWords('2026-11-11')).toBe('11월 11일 수요일')
    expect(dayWeekdayWords('2026-11-03')).toBe('11월 3일 화요일')
    // 한국 자정 넘김: UTC 11/10 15:30 = 한국 11/11 00:30
    expect(claimedAtWords('2026-11-10T15:30:00.000Z')).toBe('11월 11일 수요일 00:30')
    expect(phoneDashes('01012345678')).toBe('010-1234-5678')
    expect(phoneDashes('0101234567')).toBe('010-123-4567')
    expect(phoneDashes(null)).toBe('모름')
    expect(addressWords({ address: '서울 중구', detail: '', zip: '' })).toBe('서울 중구')
    expect(addressWords(null)).toBe('모름')
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
