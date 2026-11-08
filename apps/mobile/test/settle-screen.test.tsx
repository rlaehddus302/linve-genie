// 앱 정산 화면 (D-APPX-01 — 웹 SettlementsPage와 같은 규칙): 날짜 → 덜 받은 손님 먼저 → 자세히 → 입금 적기(같은 요청 번호, amountText) → 남은 금액과 다르면 한 번 더 묻기.
// 옛 정산 탭은 "정산은 웹 화면에서 열려요"와 [웹으로 열기]만 있었다(D-UX2-07) — 앱 화면으로 옮겼다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
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
  it('덜 받은 손님이 먼저, 요약·걸러 보기, 리허설 날짜는 고르지 않는다', async () => {
    const w = world()
    render(w.wrap(<SettleScreen />))
    const rows = await screen.findAllByRole('button', { name: /최종 14,000원/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['다육맘 · 미입금 · 최종 14,000원 · 남은 금액 14,000원', '초록손 · 입금 완료 · 최종 14,000원'])
    expect(screen.getByText('손님 2명 · 다 받음 1명 · 받을 돈 14,000원')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /날짜 10월 28일/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '입금 완료 1명' }))
    expect(screen.queryByRole('button', { name: /^다육맘/ })).toBeNull()
  })

  it('주문 탭 (D-UX3-39, 제목은 D-UX3-41로 없음): 손님마다 정보 받음·확인서 전 꼬리표, 위에 [확인서 보내기]', async () => {
    const w = world()
    const prow = (buyer: string, address: string) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'PAID', packing: '포장 완료', shipping: 'NONE', address, ready: false, reason: null, message: null, box: '80', parcel: null })
    w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { date: '2026-10-29', seq: 5, blocked: null, carrier: null, box: '80', ready: [], excluded: [prow('u1', 'NONE'), prow('u2', 'CONFIRMED')], booked: [] } }))
    const rrow = (buyer: string, link: string) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, total: 14_000, payment: 'PAID', received: 0, remaining: 0, link: { buyer, status: link, url: null, expiresAt: null, revokedAt: null }, sms: null })
    w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers$/, () => ({ body: { date: '2026-10-29', rehearsal: false, buyers: [rrow('u1', 'NONE'), rrow('u2', 'ACTIVE')] } }))
    const openReceipts = vi.fn()
    render(w.wrap(<SettleScreen nav={{ openReceipts }} />))
    expect(await screen.findByRole('button', { name: '확인서 보내기' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '주문' })).toBeNull()
    expect(await screen.findByText('정보 전')).toBeTruthy()
    expect(screen.getByText('확인서 전')).toBeTruthy()
    expect(screen.getByText('정보 받음')).toBeTruthy()
    expect(screen.getByText('확인서 보냄')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '확인서 보내기' }))
    expect(openReceipts).toHaveBeenCalled()
  })

  it('자세히: 금액·기록(입금 #3 → 입금 번호 3), 입금 적기는 남은 금액이 미리 들어가고 같은 요청 번호로 한 번 보낸다', async () => {
    const w = world()
    render(w.wrap(<SettleScreen />))
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
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
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

describe('ReportScreen (앱 방송 리포트)', () => {
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
    expect(screen.getByText('지난 방송보다 20,000원 많아요')).toBeTruthy()
    expect(screen.getByText('지난 방송과 같아요')).toBeTruthy()
    expect(screen.getByText('3번 금황')).toBeTruthy()
    expect(screen.getByText('열고 30초 안에 8명 · 기다린 손님 3명')).toBeTruthy()
    expect(screen.getByText('20:00~20:10 · 3개 · 15,000원')).toBeTruthy()
  })
})
