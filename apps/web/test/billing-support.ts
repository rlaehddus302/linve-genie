// 요금 화면 시험 도우미 (N5): 요금 상태·내역 모양 (harness/sprints/N5/dev-notes.md "dev-server 바뀐 계약" 2·7·8)과 요금 경로를 단 가짜 서버.
import type { BillingStatus, OrderItem, PaymentItem, PriceItem, UsageItem } from '../src/api/billing-types.ts'
import { overview, templates } from './print-support.ts'
import { DATE, FakeServer } from './support.ts'

/** 서버 시각 2026-10-20 20:00 KST */
export const NOW = '2026-10-20T11:00:00.000Z'

export const ITEMS: readonly PriceItem[] = [
  { id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', quantity: null, price: 30000 },
  { id: 'days-1', name: '방송 일권 1일', kind: 'DAYS', quantity: 1, price: 5000 },
  { id: 'orders-100', name: '주문 건권 100건', kind: 'ORDERS', quantity: 100, price: 10000 },
  { id: 'labels-100', name: '라벨 장권 100장', kind: 'LABELS', quantity: 100, price: 2000 },
]

export const BUSINESS = { masked: '123-45-*****', name: '구피 다육', ceo: '김시험', email: null, receiptKind: 'TAX_INVOICE', complete: true } as const

export function billingStatus(patch: Partial<BillingStatus> = {}): BillingStatus {
  return {
    now: NOW,
    flat: { active: false, until: null, endedAt: null, chain: [] },
    balances: { DAYS: 0, ORDERS: 0, LABELS: 0 },
    window: null,
    start: { allowed: false, reason: 'NO_PASS' },
    banners: [{ kind: 'NO_PASS' }],
    items: ITEMS,
    business: BUSINESS,
    testPayment: true,
    ...patch,
  }
}

export function order(patch: Partial<OrderItem> = {}): OrderItem {
  return {
    type: 'order',
    paymentId: 'pay_1',
    itemId: 'days-1',
    itemName: '방송 일권 1일',
    kind: 'DAYS',
    quantity: 1,
    amount: 5000,
    method: 'CARD',
    paidMethod: null,
    state: 'GRANTED',
    createdAt: '2026-10-20T10:50:00.000Z',
    grantedAt: '2026-10-20T10:51:00.000Z',
    refundedAt: null,
    refundable: false,
    refunding: false,
    document: null,
    ...patch,
  }
}

export interface BillingFake {
  readonly server: FakeServer
  status: BillingStatus
  payments: PaymentItem[]
  usage: UsageItem[]
  config: Record<string, unknown>
}

/** 로그인한 판매자 + 요금 기능 켜짐(시험 결제)인 가짜 서버 */
export function billingServer(): BillingFake {
  const server = new FakeServer()
  const fake: BillingFake = { server, status: billingStatus(), payments: [], usage: [], config: { enabled: true, testPayment: true } }
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: false, billing: fake.config } }))
    .on('GET', /^\/api\/print$/, () => ({ body: overview() }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/billing$/, () => ({ body: fake.status }))
    .on('GET', /^\/api\/billing\/payments/, () => ({ body: { items: fake.payments, next: null } }))
    .on('GET', /^\/api\/billing\/usage/, () => ({ body: { items: fake.usage, next: null } }))
  return fake
}
