// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 앱 정산 화면 (D-APPX-01 — 웹 SettlementsPage와 같은 규칙): 날짜 → 덜 받은 손님 먼저 → 자세히 → 입금 적기(같은 요청 번호, amountText) → 남은 금액과 다르면 한 번 더 묻기.
// 옛 정산 탭은 "정산은 웹 화면에서 열려요"와 [웹으로 열기]만 있었다(D-UX2-07) — 앱 화면으로 옮겼다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { SettleBuyerScreen, SettleScreen } from '../src/screens/SettleScreen.tsx'
import { ReportScreen } from '../src/screens/ReportScreen.tsx'
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
  return w
}

describe('SettleScreen (앱 정산)', () => {
  // D-UX4-122로 바뀐 기대 (사용자 지시 2026-11-11 "주문 탭 … 정돈되어 있지 않아서" → "이대로 만들어"):
  // 옛 "요약 한 줄(손님 2명 · 다 받음 1명 · 받을 돈) + 입금 상태 거르기(전체·미입금·부분 입금·입금 완료·과입금)"
  // → 새 "진행 카드(손님 n명 중 m명 끝) + 할 일 남은 손님 / 끝난 손님(접힘), 줄마다 다음 할 일 하나"
  it('진행 카드와 할 일 남은 손님·끝난 손님(접힘), 리허설 날짜는 고르지 않는다 (D-UX4-122)', async () => {
    const w = world()
    render(w.wrap(<SettleScreen />))
    expect(await screen.findByText('손님 2명 중 1명 끝났어요')).toBeTruthy()
    const todo = screen.getByRole('group', { name: '할 일 남은 손님' })
    expect(within(todo).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual(['다육맘 · 입금 기다림 · 최종 14,000원 · 남은 금액 14,000원'])
    // 정보·확인서 단계를 모르면(택배·영수증 줄 없음) 그 칸은 "확인 중" — 끝났다고 말하지 않는다
    expect(screen.getByRole('radio', { name: '정보 받기 확인 중' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '입금 확인 1명 남음' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^초록손/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '끝난 손님 1명' }))
    expect(screen.getByRole('button', { name: '초록손 · 입금 완료 · 최종 14,000원' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /날짜 10월 28일/ })).toBeNull()
    // 옛 바로 가기(라이브 리포트)·입금 상태 거르기는 없다
    expect(screen.queryByRole('button', { name: '라이브 리포트' })).toBeNull()
    expect(screen.queryByRole('button', { name: '입금 완료 1명' })).toBeNull()
  })

  // D-UX4-122로 바뀐 기대: 옛 "줄마다 정보 받음·확인서 전 꼬리표 셋, 위에 바로 가기 [확인서 보내기]"
  // → 새 "단계 칸(정보 받기·확인서 보내기·입금 확인) 남은 수, 지금 할 일 카드는 처음 남은 단계 하나와 단추 하나, 줄은 다음 할 일 하나"
  it('주문 탭 단계 (D-UX3-39 → D-UX4-122): 단계 칸 남은 수, 지금 할 일 카드, 칸을 누르면 그 단계 손님만', async () => {
    const w = world()
    const prow = (buyer: string, address: string) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'PAID', packing: '포장 완료', shipping: 'NONE', address, ready: false, reason: null, message: null, box: '80', parcel: null })
    w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { date: '2026-10-29', seq: 5, blocked: null, carrier: null, box: '80', ready: [], excluded: [prow('u1', 'CONFIRMED'), prow('u2', 'CONFIRMED')], booked: [] } }))
    const rrow = (buyer: string, link: string) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, total: 14_000, payment: 'PAID', received: 0, remaining: 0, link: { buyer, status: link, url: null, expiresAt: null, revokedAt: null }, sms: null })
    w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers$/, () => ({ body: { date: '2026-10-29', rehearsal: false, buyers: [rrow('u1', 'NONE'), rrow('u2', 'ACTIVE')] } }))
    const openReceipts = vi.fn()
    render(w.wrap(<SettleScreen nav={{ openReceipts }} />))
    // 옛 기대(D-UX3-41): 탭 제목 없음. 새 기대(D-UX4-59, 사용자 지시 2026-11-09 "홈 화면에 위 영역이 다 똑같지"): 모든 화면과 같은 머리 줄에 "주문"
    expect(screen.getByRole('heading', { name: '주문', level: 1 })).toBeTruthy()
    expect(await screen.findByRole('radio', { name: '확인서 보내기 1명 남음' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '정보 받기 다 끝남' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '입금 확인 1명 남음' })).toBeTruthy()
    // 처음 남은 단계 = 확인서 (정보는 다 받았다)
    const card = screen.getByRole('group', { name: '지금 할 일' })
    expect(within(card).getByText('확인서를 안 보낸 손님 1명')).toBeTruthy()
    // 다육맘의 다음 할 일은 확인서(입금보다 먼저)
    expect(screen.getByRole('button', { name: '다육맘 · 확인서 보내기 · 최종 14,000원 · 남은 금액 14,000원' })).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: '확인서 보내기' }))
    expect(openReceipts).toHaveBeenCalled()
    // 단계 칸을 누르면 그 단계가 남은 손님만, 다시 누르면 모두
    fireEvent.click(screen.getByRole('radio', { name: '입금 확인 1명 남음' }))
    const picked = screen.getByRole('group', { name: '고른 단계 손님' })
    expect(within(picked).getByText('입금 확인 남은 손님 1명')).toBeTruthy()
    expect(within(picked).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual(['다육맘 · 확인서 보내기 · 최종 14,000원 · 남은 금액 14,000원'])
    expect(screen.queryByRole('group', { name: '지금 할 일' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: '입금 확인 1명 남음' }))
    expect(screen.getByRole('group', { name: '할 일 남은 손님' })).toBeTruthy()
  })

  it('다 끝나면 "모두 끝났어요"와 [포장하러 가기], 정보 단계가 먼저면 그 손님만 보는 단추 (D-UX4-122)', async () => {
    const prow = (buyer: string, address: string) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'PAID', packing: '포장 완료', shipping: 'NONE', address, ready: false, reason: null, message: null, box: '80', parcel: null })
    const rrow = (buyer: string) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, total: 14_000, payment: 'PAID', received: 14_000, remaining: 0, link: { buyer, status: 'ACTIVE', url: null, expiresAt: null, revokedAt: null }, sms: null })
    const paidWorld = (u2Address: string) => {
      const w = makeWorld()
      w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
      w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ buyers: [buyer('u1', '다육맘'), buyer('u2', '초록손')], claims: [claim('c1', 15, 'u1'), claim('c2', 16, 'u2')], settlements: [settlement('u1', { received: 14_000, payment: 'PAID' }), settlement('u2', { received: 14_000, payment: 'PAID' })] }) }))
      w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { date: '2026-10-29', seq: 5, blocked: null, carrier: null, box: '80', ready: [], excluded: [prow('u1', 'CONFIRMED'), prow('u2', u2Address)], booked: [] } }))
      w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers$/, () => ({ body: { date: '2026-10-29', rehearsal: false, buyers: [rrow('u1'), rrow('u2')] } }))
      return w
    }
    const openPacking = vi.fn()
    const done = render(paidWorld('CONFIRMED').wrap(<SettleScreen nav={{ openPacking }} />))
    expect(await screen.findByText('손님 2명 모두 끝났어요')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '포장하러 가기' }))
    expect(openPacking).toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: '할 일 남은 손님' })).toBeNull()
    done.unmount()

    render(paidWorld('NONE').wrap(<SettleScreen nav={{ openPacking }} />))
    const card = await screen.findByRole('group', { name: '지금 할 일' })
    expect(await within(card).findByText('배송지를 못 받은 손님 1명')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: '배송지 못 받은 손님 보기' }))
    const picked = screen.getByRole('group', { name: '고른 단계 손님' })
    expect(within(picked).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual(['초록손 · 정보 받기 · 최종 14,000원'])
  })

  it('자세히: 금액·기록(입금 #3 → 입금 번호 3), 입금 적기는 남은 금액이 미리 들어가고 같은 요청 번호로 한 번 보낸다', async () => {
    const w = world()
    render(w.wrap(<SettleScreen />))
    // D-UX4-122로 바뀐 기대: 옛 "다 받은 초록손도 목록에 바로 보임" → 새 "끝난 손님은 접힌 칸 — [끝난 손님 1명]을 펼친 뒤 누른다"
    fireEvent.click(await screen.findByRole('button', { name: '끝난 손님 1명' }))
    fireEvent.click(await screen.findByRole('button', { name: /^초록손/ }))
    expect(screen.getByText(/자동 입금 확인 · 입금 번호 3 · 기록한 때 10\/29 21:00/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '정산 목록으로' }))
    fireEvent.click(await screen.findByRole('button', { name: /^다육맘/ }))
    expect(screen.getByLabelText('남은 금액 14,000원')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '입금 적기' }))
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
    fireEvent.click(await screen.findByRole('button', { name: /^다육맘/ }))
    fireEvent.click(screen.getByRole('button', { name: '입금 적기' }))
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
  it('경로가 있으면 손님을 누르면 쌓인 화면을 열고, 쌓인 화면에서 기록하면 아래 목록도 다시 받는다', async () => {
    const w = world()
    const opened: string[] = []
    render(w.wrap(<><SettleScreen nav={{ openBuyer: (date, key) => opened.push(`${date}|${key}`) }} /><SettleBuyerScreen date="2026-10-29" settlementKey={JSON.stringify(['u1', '2026-10-29'])} onBack={() => {}} /></>))
    // D-UX4-122로 바뀐 기대: 옛 줄 이름 "다육맘 · 미입금 · …" → 새 "다육맘 · 입금 기다림 · …"(줄마다 다음 할 일 하나)
    const row = await screen.findByRole('button', { name: /^다육맘 · 입금 기다림/ })
    fireEvent.click(row)
    expect(opened).toEqual([`2026-10-29|${JSON.stringify(['u1', '2026-10-29'])}`])
    const page = screen.getByTestId('settle-buyer-screen')
    expect(within(page).getByRole('heading', { name: '다육맘', level: 1 })).toBeTruthy()
    const reads = w.server.callsTo('GET', /^\/api\/days\/2026-10-29$/).length
    fireEvent.click(within(page).getByRole('button', { name: '입금 적기' }))
    fireEvent.click(screen.getByRole('button', { name: '적기' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    // 쌓인 화면과 아래 목록이 둘 다 다시 받는다
    await waitFor(() => expect(w.server.callsTo('GET', /^\/api\/days\/2026-10-29$/).length).toBeGreaterThanOrEqual(reads + 2))
  })
})
