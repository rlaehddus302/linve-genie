// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 앱 정산 화면 (D-APPX-01 — 웹 SettlementsPage와 같은 규칙): 날짜 → 덜 받은 손님 먼저 → 자세히 → 입금 적기(같은 요청 번호, amountText) → 남은 금액과 다르면 한 번 더 묻기.
// 옛 정산 탭은 "정산은 웹 화면에서 열려요"와 [웹으로 열기]만 있었다(D-UX2-07) — 앱 화면으로 옮겼다.
// D-UX4-125 (사용자 지시 2026-11-11 '주문 탭 수정 사항')로 바뀐 기대: 날짜 고르기 대신 날짜를 넘은 주문 목록 → 주문 상세 → 맨 아래 금액 고치기.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { OrderDetailScreen } from '../src/screens/OrderDetailScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { ReportScreen } from '../src/screens/ReportScreen.tsx'
import { orderDetail, orderRow, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView } from './support.ts'

const settlement = (id: string, patch: Partial<Settlement> = {}): Settlement => ({
  buyer: id,
  date: '2026-10-29',
  items: ['b1/15'],
  subtotal: 10_000,
  shipping: 4_000,
  shippingOverride: null,
  adjustments: 0,
  total: 14_000,
  received: 0,
  refundDue: 0,
  payment: 'UNPAID',
  records: [],
  ...patch,
})

function world() {
  const w = makeWorld()
  w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }, { date: '2026-10-28', rehearsal: true, seq: 1 }] } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({
    body: fullView({
      buyers: [buyer('u1', '다육맘'), buyer('u2', '초록손')],
      claims: [claim('c1', 15, 'u1'), claim('c2', 16, 'u2')],
      settlements: [settlement('u2', { received: 14_000, payment: 'PAID', records: [{ kind: 'payment', buyer: 'u2', amount: 14_000, mode: null, reason: null, memo: '자동 입금 확인 · 입금 #3', seq: 9, at: '2026-10-29T12:00:00.000Z' }] }), settlement('u1')],
    }),
  }))
  // D-UX4-125: 주문 탭은 날짜를 넘어 최근 주문부터(/api/orders), 상세는 /api/days/:date/order?buyer=
  withOrders(w, ordersView([orderRow({ buyer: 'u1', name: null, nickname: '다육맘' }), orderRow({ buyer: 'u2', name: null, nickname: '초록손' })]), {
    details: {
      '2026-10-29|u1': orderDetail({ buyer: 'u1', name: null, nickname: '다육맘' }),
      '2026-10-29|u2': orderDetail({ buyer: 'u2', name: null, nickname: '초록손', received: 14_000, payment: 'PAID' }),
    },
  })
  return w
}

describe('SettleScreen (앱 주문)', () => {
  // D-UX4-125 (사용자 지시 2026-11-11 '주문 탭 수정 사항')로 바뀐 기대:
  // 옛 "진행 카드(손님 n명 중 m명 끝) + 단계 칸 셋 + 지금 할 일 카드([확인서 보내기]·[포장하러 가기]) + 할 일 남은 손님/끝난 손님(접힘), 리허설 날짜 캡슐 없음"(D-UX4-122)
  // → 새 "날짜 캡슐·머리 없이 맨 위 단추 셋 + 날짜를 넘은 주문 목록(성함·닉네임·총 금액·개수)". 단계 칸·지금 할 일·접기는 사용자가 뺐다 — 확인서·입금은 맨 위 단추로 간다.
  it('주문 목록: 날짜 캡슐 없이 모든 손님 줄, 맨 위 [정산서 보내기]·[입금 확인하기] (D-UX4-125)', async () => {
    const w = world()
    const openReceipts = vi.fn()
    const openDeposits = vi.fn()
    render(w.wrap(<SettleScreen nav={{ openReceipts, openDeposits }} />))
    const list = await screen.findByRole('list', { name: '주문 목록' })
    expect(within(list).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual(['10월 29일 · 다육맘 · 성함 받기 전 · 14,000원 · 1개', '10월 29일 · 초록손 · 성함 받기 전 · 14,000원 · 1개'])
    expect(screen.queryByRole('button', { name: /날짜 10월 28일/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: '주문', level: 1 })).toBeNull()
    // 옛 바로 가기(라이브 리포트)·입금 상태 거르기는 없다
    expect(screen.queryByRole('button', { name: '라이브 리포트' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '정산서 보내기' }))
    fireEvent.click(screen.getByRole('button', { name: '입금 확인하기' }))
    expect(openReceipts).toHaveBeenCalledOnce()
    expect(openDeposits).toHaveBeenCalledOnce()
  })

  it('자세히: 금액 기록(입금 #3 → 입금 번호 3), 입금 적기는 남은 금액이 미리 들어가고 같은 요청 번호로 한 번 보낸다', async () => {
    const w = world()
    render(w.wrap(<SettleScreen />))
    // D-UX4-125로 바뀐 기대: 옛 "끝난 손님 접힌 칸을 펼친 뒤 누른다"(D-UX4-122) → 새 "목록에 모두 있다", 옛 묶음 이름 "기록" → 새 "금액 기록"(상세 맨 아래), 뒤로 "정산 목록으로" → "주문 목록으로"
    fireEvent.click(await screen.findByRole('button', { name: /^10월 29일 · 초록손/ }))
    const records = await screen.findByRole('group', { name: '금액 기록' })
    expect(within(records).getByText(/자동 입금 확인 · 입금 번호 3 · 기록한 때 10\/29 21:00/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '주문 목록으로' }))
    fireEvent.click(await screen.findByRole('button', { name: /^10월 29일 · 다육맘/ }))
    expect(await screen.findByLabelText('남은 금액 14,000원')).toBeTruthy()
    const pay = await screen.findByRole('button', { name: '입금 적기' })
    await waitFor(() => expect(pay.getAttribute('aria-busy')).not.toBe('true'))
    fireEvent.click(pay)
    expect((screen.getByLabelText('입금 금액') as HTMLInputElement).value).toBe('14000')
    fireEvent.click(screen.getByRole('button', { name: '적기' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.path).toBe('/api/events?date=2026-10-29')
    expect(w.events[0]!.body).toMatchObject({ type: 'settlement.payment', buyer: 'u1', date: '2026-10-29', amountText: '14000' })
    expect(await screen.findByText('입금 14,000원을 적었어요.')).toBeTruthy()
  })

  it('남은 금액과 다른 입금은 한 번 더 묻고, 할인은 사유 없이 보내지 않는다', async () => {
    const w = world()
    render(w.wrap(<SettleScreen />))
    fireEvent.click(await screen.findByRole('button', { name: /^10월 29일 · 다육맘/ }))
    const pay = await screen.findByRole('button', { name: '입금 적기' })
    await waitFor(() => expect(pay.getAttribute('aria-busy')).not.toBe('true'))
    fireEvent.click(pay)
    fireEvent.change(screen.getByLabelText('입금 금액'), { target: { value: '140000' } })
    fireEvent.click(screen.getByRole('button', { name: '적기' }))
    expect(await screen.findByText(/남은 금액\(14,000원\)과 달라요. 140,000원으로 적을까요\?/)).toBeTruthy()
    expect(w.events).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '다시 고치기' }))
    // D-UX4-103으로 바뀐 기대 (옛: 입금 적기 아래 창의 [닫기] 단추): 닫기 단추가 없어 바깥(판 닫기)을 눌러 닫는다
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '할인·추가' }))
    fireEvent.change(screen.getByLabelText('할인 금액'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: '적기' }))
    expect(await screen.findByText('사유를 적어 주세요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '사유 단골 할인' }))
    fireEvent.click(screen.getByRole('button', { name: '적기' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.body).toMatchObject({ type: 'settlement.adjust', amountText: '1000', amountSign: 'MINUS', reason: '단골 할인' })
  })
})

describe('ReportScreen (앱 라이브 리포트)', () => {
  it('돈·손님·비교·몰린 상품·품종·시간대를 웹과 같은 문구로', async () => {
    const w = makeWorld()
    w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
    w.server.on('GET', /^\/api\/days\/2026-10-29\/report$/, () => ({
      body: {
        date: '2026-10-29',
        live: false,
        sealed: false,
        summary: { sales: 120_000, qty: 9, received: 100_000, unpaid: 24_000, refund: 0, buyers: 5, unpaidBuyers: 2, newBuyers: 3, returningBuyers: 1, unknownBuyers: 1 },
        compare: { last: { date: '2026-10-22', sales: 100_000, qty: 8, buyers: 5, diff: { sales: 20_000, qty: 1, buyers: 0 } }, recent: null },
        rush: [{ b: 'b1', no: 3, name: '금황', buyers: 8, waiting: 3 }],
        varieties: [{ name: '금황', qty: 4, amount: 60_000 }],
        buckets: [{ start: '2026-10-29 20:00', qty: 3, amount: 15_000 }],
      },
    }))
    render(w.wrap(<ReportScreen onBack={() => undefined} />))
    expect(await screen.findByLabelText('판매 금액 120,000원')).toBeTruthy()
    expect(screen.getByLabelText('다시 온 손님 1명')).toBeTruthy()
    expect(screen.getByText('지난 라이브보다 20,000원 많아요')).toBeTruthy()
    expect(screen.getByText('지난 라이브와 같아요')).toBeTruthy()
    expect(screen.getByText('3번 금황')).toBeTruthy()
    expect(screen.getByText('열고 30초 안에 8명 · 기다린 손님 3명')).toBeTruthy()
    expect(screen.getByText('20:00~20:10 · 3개 · 15,000원')).toBeTruthy()
  })

  // D-UX4-58 (사용자 지시 2026-11-09 "진짜판으로 해야지"): 손님 자세히는 주문 탭 안에서 바꿔 끼우지 않고 진짜 쌓인 화면으로
  // D-UX4-125로 바뀐 기대: 옛 "openBuyer(날짜, 정산 열쇠) · SettleBuyerScreen · 가운데 손님 이름 · 아래 그날 범위 다시 받기"
  // → 새 "openOrder(날짜, 손님) · OrderDetailScreen(가운데 '주문 상세') · 아래 주문 목록(/api/orders) 다시 받기"
  it('경로가 있으면 손님을 누르면 쌓인 화면을 열고, 쌓인 화면에서 기록하면 아래 목록도 다시 받는다', async () => {
    const w = world()
    const opened: string[] = []
    render(w.wrap(<><SettleScreen nav={{ openOrder: (date, buyer) => opened.push(`${date}|${buyer}`) }} /><OrderDetailScreen date="2026-10-29" buyer="u1" onBack={() => {}} /></>))
    const row = await screen.findByRole('button', { name: /^10월 29일 · 다육맘/ })
    fireEvent.click(row)
    expect(opened).toEqual(['2026-10-29|u1'])
    const page = screen.getByTestId('order-detail-screen')
    expect(within(page).getByRole('heading', { name: '주문 상세', level: 1 })).toBeTruthy()
    expect(await within(page).findByRole('heading', { name: '다육맘', level: 2 })).toBeTruthy()
    const reads = w.server.callsTo('GET', /^\/api\/orders$/).length
    const pay = await within(page).findByRole('button', { name: '입금 적기' })
    await waitFor(() => expect(pay.getAttribute('aria-busy')).not.toBe('true'))
    fireEvent.click(pay)
    fireEvent.click(screen.getByRole('button', { name: '적기' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    // 쌓인 화면(상세)과 아래 목록이 둘 다 다시 받는다
    await waitFor(() => expect(w.server.callsTo('GET', /^\/api\/orders$/).length).toBeGreaterThanOrEqual(reads + 1))
    await waitFor(() => expect(w.server.callsTo('GET', /^\/api\/days\/2026-10-29\/order\?buyer=u1$/).length).toBeGreaterThanOrEqual(2))
  })
})
