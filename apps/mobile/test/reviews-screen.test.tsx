// 앱 확인 필요 (D-APPX-03 — 웹 ReviewsPage와 같은 규칙·문구): 미리 채움은 읽은 것만(수량 빈 칸 → 주문으로 잠김),
// 상품·옵션·수량을 고르면 대기 뒤 host.resolveReview(줄마다 요청 번호 -1), 되돌리면 보내지 않는다, 제안 [이대로 주문]은 제안 값으로,
// 찜이 생기면 "1등" 결과 줄, 기다리는 조치가 있으면 나가기 전에 묻는다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Product, ReviewItem } from '@livejjim/web/src/api/types.ts'
import { ReviewsScreen } from '../src/screens/ReviewsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const product = {
  key: 'b1/21',
  broadcast: 'b1',
  no: 21,
  name: '반바지',
  price: 10_000,
  stock: 5,
  confirmedUnits: 0,
  status: 'OPEN',
  winners: [],
  waitlist: [],
  aliases: [],
  options: [{ name: '크기', choices: [{ label: 'M' }, { label: 'XL' }] }],
  variants: [
    { text: 'M', remaining: 3, winners: ['u1'], waitlist: [] },
    { text: 'XL', remaining: 2, winners: [], waitlist: [] },
  ],
} as unknown as Product

const review = (item: string, patch: Partial<ReviewItem> = {}): ReviewItem =>
  ({
    broadcast: 'b1',
    item,
    at: '2026-10-29T11:03:00.000Z',
    origin: 'chat',
    reason: 'OPTION_UNCLEAR',
    product: 'b1/21',
    no: 21,
    options: null,
    qty: null,
    currentBuyer: 'u1',
    date: '2026-10-29',
    rehearsal: false,
    broadcastDate: '2026-10-29',
    broadcastTitle: '목요일 다육',
    buyerName: '다육맘',
    text: '21 엠',
    received: null,
    phoneLast4: null,
    suggestion: null,
    ...patch,
  }) as ReviewItem

function world(delay: number) {
  const w = makeWorld()
  let reviews: ReviewItem[] = [review('m1'), review('m2', { buyerName: '초록손', text: '반바지 큰거', suggestion: { no: 21, options: { 크기: 'XL' }, qty: 1, source: 'AI' } })]
  w.server.on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: delay } }))
  w.server.on('GET', /^\/api\/assist\/settings$/, () => ({ body: { available: true, enabled: true, dailyLimit: 50, used: 0 } }))
  w.server.on('POST', /^\/api\/assist\/suggest$/, () => ({ body: { result: 'DONE' } }))
  w.server.on('GET', /^\/api\/reviews/, () => ({ body: { rehearsal: false, reviews, products: [product], broadcasts: [{ id: 'b1', date: '2026-10-29', title: '목요일 다육', settings: { 'claim.maxQuantity': 10 } }], scopes: [] } }))
  w.server.on('POST', /^\/api\/events/, (call) => {
    w.events.push(call)
    reviews = reviews.filter((item) => item.item !== call.body?.['item'])
    return { body: { date: '2026-10-29', rehearsal: false, seq: 9, changed: true } }
  })
  return w
}

describe('ReviewsScreen (앱 확인 필요)', () => {
  it('수량 빈 칸이면 주문으로 잠김 → 옵션·수량을 고르면 대기 뒤 보내고 "1등"을 보인다', async () => {
    const w = world(30)
    render(w.wrap(<ReviewsScreen onBack={() => undefined} />))
    expect(await screen.findByText('21 엠')).toBeTruthy()
    const resolve = screen.getByRole('button', { name: '1번째 줄 주문으로' })
    expect(resolve.getAttribute('aria-disabled') === 'true' || resolve.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '1번째 줄 크기 M (남은 3개)' }))
    fireEvent.change(screen.getAllByLabelText('수량')[0]!, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '1번째 줄 주문으로' }))
    expect(await screen.findByText(/뒤 보내요: 다육맘 "21 엠" 주문으로/)).toBeTruthy()
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.body).toMatchObject({ type: 'host.resolveReview', b: 'b1', item: 'm1', no: 21, qty: 1, options: { 크기: 'M' } })
    expect(String(w.events[0]!.body?.['requestId'])).toMatch(/-1$/)
    expect(await screen.findByText('다육맘 · 21 엠 — 1등')).toBeTruthy()
  })

  it('제안 [이대로 주문]은 제안 값으로, 되돌리면 보내지 않는다 · 기다리는 조치가 있으면 나가기 전에 묻는다', async () => {
    const w = world(60_000)
    const onBack = vi.fn()
    render(w.wrap(<ReviewsScreen onBack={onBack} />))
    expect(await screen.findByText('제안: 21번 반바지 XL 1개')).toBeTruthy()
    expect(screen.getByText('AI가 읽음')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2번째 줄 이대로 주문' }))
    expect(await screen.findByText(/뒤 보내요: 초록손 "반바지 큰거" 주문으로 → 21번 반바지 XL 1개/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(screen.getByText('보내기 전인 조치 1개가 있어요. 지금 나가면 보내지 않아요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '머무르기' }))
    fireEvent.click(screen.getByRole('button', { name: /되돌리기$/ }))
    expect(await screen.findByText(/보내지 않았어요: 초록손/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(w.events).toHaveLength(0)
  })
})
