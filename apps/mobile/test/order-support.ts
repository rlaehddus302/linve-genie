// 주문 탭 시험 도우미 (D-UX4-125): 가짜 서버에 주문 목록(/api/orders)·주문 상세(/api/days/:date/order?buyer=)를 단다.
import type { OrderDetailView, OrderRow, OrdersView } from '@livejjim/web/src/api/order-types.ts'
import type { ScreenWorld } from './screen-support.tsx'

export const orderRow = (patch: Partial<OrderRow> = {}): OrderRow => ({
  date: '2026-10-29',
  buyer: 'u1',
  name: '김다육',
  nickname: '다육맘',
  platform: 'YOUTUBE',
  total: 14_000,
  itemCount: 1,
  firstClaimAt: '2026-10-29T11:00:00.000Z',
  missing: [],
  ...patch,
})

export const orderDetail = (patch: Partial<OrderDetailView> = {}): OrderDetailView => ({
  date: '2026-10-29',
  buyer: 'u1',
  name: '김다육',
  nickname: '다육맘',
  platform: 'YOUTUBE',
  phone: '01012345678',
  address: { address: '경상남도 양산시 물금읍 증산리', detail: '1034', zip: '50603' },
  items: [{ no: 15, name: '핑크프릴', price: 10_000, qty: 1 }],
  claimedAt: '2026-10-29T11:00:00.000Z',
  itemCount: 1,
  subtotal: 10_000,
  shipping: 4_000,
  shippingRule: { baseFee: 4_000, freeThreshold: 50_000, mode: 'DEFAULT' },
  adjustments: 0,
  total: 14_000,
  received: 0,
  refundDue: 0,
  payment: 'UNPAID',
  history: { count: 0, total: 0, lines: [] },
  ...patch,
})

export const ordersView = (orders: readonly OrderRow[], patch: Partial<OrdersView> = {}): OrdersView => ({ today: '2026-10-29', orders, more: false, next: null, ...patch })

/** 주문 목록 첫 쪽(과 ?before= 쪽들)·주문 상세를 단다. details 열쇠는 `날짜|손님` */
export function withOrders(w: ScreenWorld, first: OrdersView, options: { readonly pages?: Readonly<Record<string, OrdersView>>; readonly details?: Readonly<Record<string, OrderDetailView>> } = {}): void {
  w.server.on('GET', /^\/api\/orders(\?before=([\d-]+))?$/, (_call, match) => {
    const before = match[2]
    if (before === undefined) return { body: first }
    const page = options.pages?.[before]
    return page === undefined ? { status: 404, body: { error: { code: 'NOT_FOUND', message: '없는 주소예요.' } } } : { body: page }
  })
  w.server.on('GET', /^\/api\/days\/(\d{4}-\d{2}-\d{2})\/order\?buyer=([^&]+)$/, (_call, match) => {
    const detail = options.details?.[`${match[1] ?? ''}|${decodeURIComponent(match[2] ?? '')}`]
    return detail === undefined ? { status: 404, body: { error: { code: 'NOT_FOUND', message: '그 주문을 찾지 못했어요.' } } } : { body: detail }
  })
}
