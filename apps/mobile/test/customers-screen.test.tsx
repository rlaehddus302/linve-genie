// 앱 손님 화면 (D-APPX-01 — 웹 "모든 손님"·손님 자세히와 같은 문구): 꼬리표·정렬 질의, 자세히의 기록 줄·메모 저장·빈 메모는 한 번 묻기, 저장한 배송지 지우기.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CustomerRow } from '@livejjim/web/src/lib/customers.ts'
import { CustomersScreen } from '../src/screens/CustomersScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const row: CustomerRow = {
  id: 'cu1', name: '다육맘', platform: 'YOUTUBE', kindLabel: '유튜브', phoneLast4: null, blocked: false, latestDate: '2026-10-29', latestBuyer: 'u1',
  purchaseDays: 4, purchaseTotal: 152_000, lastPurchase: '2026-10-29', unpaidDays: 1, lastUnpaid: '2026-10-15', cancels: 0, regular: true, caution: true,
}

function world() {
  const w = makeWorld()
  const puts: Record<string, unknown>[] = []
  const posts: string[] = []
  w.server.on('GET', /^\/api\/customers\?/, (call) => ({ body: { today: '2026-11-01', settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, customers: call.path.includes('filter=regular') || call.path.includes('filter=all') ? [row] : [], count: 1, more: false, next: null } }))
  w.server.on('GET', /^\/api\/customers\/cu1$/, () => ({
    body: {
      today: '2026-11-01', customer: row, memo: { text: '포장 꼼꼼히', savedAt: '2026-10-26T03:00:00.000Z' },
      days: [{ date: '2026-10-29', buyer: 'u1', name: '다육맘', subtotal: 38_000, payment: 'PAID', unpaid: false, openable: true }, { date: '2026-10-15', buyer: 'u9', name: '다육맘', subtotal: 12_000, payment: 'UNPAID', unpaid: true, openable: true }],
      more: false, next: null,
      ledger: { ledgerId: 'l1', name: '홍*동', phoneLast4: '5678', keepUntil: '2027-10-29', consentDate: '2026-10-29', linked: [] },
    },
  }))
  w.server.on('PUT', /^\/api\/customers\/cu1\/memo$/, (call) => {
    puts.push(call.body ?? {})
    const text = String(call.body?.['text'] ?? '').trim()
    return { body: { memo: text === '' ? null : { text, savedAt: '2026-11-01T03:00:00.000Z' } } }
  })
  w.server.on('POST', /^\/api\/customers\/cu1\/ledger\/delete$/, (call) => {
    posts.push(call.path)
    return { body: { ledger: null } }
  })
  return { w, puts, posts }
}

describe('CustomersScreen (앱 손님)', () => {
  it('목록 줄: 단골·입금 늦음 주의 꼬리표와 누적, 정렬·거르기는 서버 질의로', async () => {
    const { w } = world()
    render(w.wrap(<CustomersScreen onBack={() => undefined} />))
    expect(await screen.findByRole('button', { name: '다육맘 · 유튜브 · 단골 · 입금 늦음 주의' })).toBeTruthy()
    expect(screen.getByText('누적 152,000원 · 4번 · 마지막 10월 29일(목)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '정렬 최근 산 순' }))
    fireEvent.click(screen.getByRole('button', { name: '거르기 단골만' }))
    await waitFor(() => expect(w.server.callsTo('GET', /^\/api\/customers\?sort=recent&filter=regular&offset=0$/)).toHaveLength(1))
  })

  it('자세히: 기록 줄·날짜별 "미입금으로 셈", 메모 저장, 빈 메모는 한 번 묻고, 저장한 배송지는 묻고 지운다', async () => {
    const { w, puts, posts } = world()
    render(w.wrap(<CustomersScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: /^다육맘/ }))
    // D-UX3-95: 기록·배송지 줄은 이름(왼쪽)·값(오른쪽)으로 나뉘어 보이고, 한 줄 이름(aria-label)은 옛 문장 그대로
    expect(await screen.findByLabelText('누적 구매 152,000원 · 4번')).toBeTruthy()
    expect(screen.getByText('152,000원 · 4번')).toBeTruthy()
    expect(screen.getByLabelText('미입금 1번 · 마지막 10월 15일(목)')).toBeTruthy()
    expect(screen.getByText('미입금으로 셈')).toBeTruthy()
    expect(screen.getByLabelText('받는 분 홍*동')).toBeTruthy()
    expect(screen.getByText('홍*동')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '단골 · 포장 꼼꼼히' } })
    fireEvent.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(await screen.findByText('메모를 저장했어요.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(screen.getByText('메모를 지울까요?')).toBeTruthy()
    expect(puts).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '저장한 배송지 지우기' }))
    fireEvent.click(screen.getAllByRole('button', { name: '지우기' }).at(-1)!)
    await waitFor(() => expect(posts).toEqual(['/api/customers/cu1/ledger/delete']))
    expect(await screen.findByText('저장한 배송지를 지웠어요.')).toBeTruthy()
  })
})
