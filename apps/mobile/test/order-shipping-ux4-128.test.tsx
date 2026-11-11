// D-UX4-128 (사용자 지시 2026-11-11 "배송비 우리가 만든 키보드로 입력하게 해"): 이 주문 배송비 바꾸기 화면.
// 주문 상세 [배송비 바꾸기] → "이 주문 배송비 바꾸기" → 상품 추가 가격 단계와 같은 큰 칸 + 앱 숫자판 + [저장하기].
// 처음 값은 지금 배송비 · 숫자판으로 고쳐 저장하면 옛 금액 고치기 시트와 같은 이벤트(settlement.shippingOverride FIXED) · 범위 밖이면 빨간 글로 막는다 · 봉인 날짜는 보기만.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { useScreenSignal } from '../src/lib/screen-signals.ts'
import { NOT_APPLIED_SETTLEMENT, SEALED_SETTLEMENT, SHIPPING_RANGE } from '../src/lib/settle.ts'
import { ASK_SHIPPING, OrderShippingFlow, OrderShippingScreen, typeShipping } from '../src/screens/OrderShippingScreen.tsx'
import { orderDetail, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView } from './support.ts'

const DATE = '2026-10-29'

const settlementOf = (patch: Partial<Settlement> = {}): Settlement => ({
  buyer: 'u1',
  date: DATE,
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

function world(setup: { readonly sealed?: boolean; readonly shipping?: number } = {}) {
  const w = makeWorld()
  w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: { ...fullView({ buyers: [buyer('u1', '다육맘')], claims: [claim('c1', 15, 'u1')], settlements: [settlementOf()] }), ...(setup.sealed === true ? { sealed: true } : {}) } }))
  withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ shipping: setup.shipping ?? 4_000 }) } })
  return w
}

const typePad = (keys: readonly string[]) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of keys) fireEvent.click(within(pad).getByRole('button', { name: key }))
}
const saveButton = () => screen.getByRole('button', { name: '저장하기' })
const shown = () => screen.getByRole('status', { name: /^배송비 / }).getAttribute('aria-label')

describe('이 주문 배송비 바꾸기 (D-UX4-128)', () => {
  it('묻는 말 아래 지금 배송비 회색 줄, 큰 칸 처음 값은 지금 배송비', async () => {
    const w = world()
    render(w.wrap(<OrderShippingScreen date={DATE} buyer="u1" onBack={() => {}} onSaved={() => {}} />))
    const page = await screen.findByRole('main', { name: '배송비 바꾸기' })
    expect(await within(page).findByText('지금 배송비 4,000원')).toBeTruthy()
    expect(within(page).getByText(ASK_SHIPPING)).toBeTruthy()
    expect(shown()).toBe('배송비 4,000원')
    expect(saveButton().getAttribute('aria-disabled')).not.toBe('true')
    // 단추는 [저장하기] 하나 + 숫자판
    expect(within(page).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent).filter((name) => name !== '뒤로' && !/^(\d+|00|지우기)$/.test(name ?? ''))).toEqual(['저장하기'])
  })

  it('숫자판으로 고쳐 저장하면 배송비 직접 적기(FIXED) 이벤트를 한 번 쓰고 주문 화면들에 알린 뒤 닫는다', async () => {
    const w = world()
    const saved = vi.fn()
    const signal = vi.fn()
    function Listener() {
      useScreenSignal('orders', signal)
      return null
    }
    render(w.wrap(<><Listener /><OrderShippingFlow date={DATE} buyer="u1" onSaved={saved} /></>))
    await screen.findByText('지금 배송비 4,000원')
    typePad(['지우기', '지우기', '지우기', '지우기'])
    // 비면 묻는 말이 칸에 보이고 [저장하기]는 흐리다
    expect(screen.getByRole('status', { name: ASK_SHIPPING })).toBeTruthy()
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    typePad(['3', '5', '00'])
    expect(shown()).toBe('배송비 3,500원')
    fireEvent.click(saveButton())
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(signal).toHaveBeenCalled()
    expect(w.events).toHaveLength(1)
    expect(w.events[0]?.path).toBe('/api/events?date=2026-10-29')
    expect(w.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'settlement.shippingOverride', buyer: 'u1', date: DATE, mode: 'FIXED', amountText: '3500' })
  })

  it('0원(무료)도 저장된다 — 앞의 0은 하나만 남는다', async () => {
    const w = world()
    const saved = vi.fn()
    render(w.wrap(<OrderShippingFlow date={DATE} buyer="u1" onSaved={saved} />))
    await screen.findByText('지금 배송비 4,000원')
    typePad(['지우기', '지우기', '지우기', '지우기', '0', '00'])
    expect(shown()).toBe('배송비 0원')
    fireEvent.click(saveButton())
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(w.events[0]?.body).toMatchObject({ mode: 'FIXED', amountText: '0' })
  })

  it('범위(1,000,000원)를 넘으면 칸 아래 빨간 글, [저장하기]는 흐리고 쓰지 않는다', async () => {
    const w = world()
    const saved = vi.fn()
    render(w.wrap(<OrderShippingFlow date={DATE} buyer="u1" onSaved={saved} />))
    await screen.findByText('지금 배송비 4,000원')
    typePad(['00', '0'])
    expect(shown()).toBe('배송비 4,000,000원')
    expect(screen.getByText(SHIPPING_RANGE.message)).toBeTruthy()
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(w.events).toHaveLength(0)
    expect(saved).not.toHaveBeenCalled()
    // 한 자리 지우면 범위 안 — 빨간 글이 사라진다
    typePad(['지우기'])
    expect(shown()).toBe('배송비 400,000원')
    expect(screen.queryByText(SHIPPING_RANGE.message)).toBeNull()
  })

  it('적용되지 않았으면 닫지 않고 알린다', async () => {
    const w = world()
    w.server.on('POST', /^\/api\/events/, (call) => {
      w.events.push(call)
      return { body: { date: DATE, rehearsal: false, seq: 6, type: 'settlement.shippingOverride', changed: false, effects: [] } }
    })
    const saved = vi.fn()
    render(w.wrap(<OrderShippingFlow date={DATE} buyer="u1" onSaved={saved} />))
    await screen.findByText('지금 배송비 4,000원')
    fireEvent.click(saveButton())
    expect(await screen.findByText(NOT_APPLIED_SETTLEMENT)).toBeTruthy()
    expect(saved).not.toHaveBeenCalled()
  })

  it('서버가 거절하면 그 말을 보이고 닫지 않는다', async () => {
    const w = world()
    w.server.on('POST', /^\/api\/events/, () => ({ status: 400, body: { error: { code: 'INVALID_INPUT', message: '배송비를 바꿀 수 없는 주문이에요.' } } }))
    const saved = vi.fn()
    render(w.wrap(<OrderShippingFlow date={DATE} buyer="u1" onSaved={saved} />))
    await screen.findByText('지금 배송비 4,000원')
    fireEvent.click(saveButton())
    expect(await screen.findByText('배송비를 바꿀 수 없는 주문이에요.')).toBeTruthy()
    expect(saved).not.toHaveBeenCalled()
  })

  it('30일 지난 날짜(봉인)는 안내만, 숫자판·[저장하기]는 없다', async () => {
    const w = world({ sealed: true })
    render(w.wrap(<OrderShippingFlow date={DATE} buyer="u1" onSaved={() => {}} />))
    expect(await screen.findByText(SEALED_SETTLEMENT)).toBeTruthy()
    expect(screen.queryByRole('group', { name: '숫자판' })).toBeNull()
    expect(screen.queryByRole('button', { name: '저장하기' })).toBeNull()
  })

  it('숫자판 누름 계산: 앞의 0은 떼고 0원은 남기며, 넘친 한 자리 뒤로는 받지 않는다', () => {
    expect(typeShipping('', '0')).toBe('0')
    expect(typeShipping('0', '00')).toBe('0')
    expect(typeShipping('0', '5')).toBe('5')
    expect(typeShipping('4000', 'back')).toBe('400')
    expect(typeShipping('1000000', '0')).toBe('10000000')
    expect(typeShipping('10000000', '0')).toBeNull()
  })
})
