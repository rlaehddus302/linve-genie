// N5 적대 테스트 공용 도구 (test-domain). s04 harness(PGlite·주입 시계·로그 모으기) 위에 요금 기능을 켠 서버(시험 결제 —
// 가짜 결제 서버·가짜 발행기)와 /api/billing 호출을 얹는다.
import { expect } from 'vitest'
import { testBilling, type BillingSetup, type LivejjimServer, type ServerOptions, type TestPayment } from '@livejjim/server'
import { call, harness, rid, type Harness, type Res } from '../s04/helpers.ts'

export { call, rid, type Harness, type Res }

/** 검증 숫자까지 맞는 사업자등록번호 (G-BIL-301) */
export const BIZNO = '123-45-67891'
export const H = 3_600_000
export const D = 24 * H

export interface BillingHarness extends Harness {
  readonly setup: BillingSetup
  readonly test: TestPayment
}

export async function billingHarness(extra: Partial<ServerOptions> = {}, setup: BillingSetup = testBilling()): Promise<BillingHarness> {
  const h = await harness({ billing: setup, ...extra })
  if (setup.test === null) throw new Error('시험 결제가 아니다')
  return Object.assign(h, { setup, test: setup.test })
}

export interface Shop {
  sellerId: string
  cookie: string
  loginId: string
}

export function api(h: Harness, shop: Shop) {
  const s = (): LivejjimServer => h.server
  return {
    status: async (): Promise<Record<string, unknown>> => {
      const r = await call(s(), shop.cookie, 'GET', '/api/billing')
      expect(r.status, r.text).toBe(200)
      return r.body
    },
    business: (extra: Record<string, unknown> = {}) =>
      call(s(), shop.cookie, 'PUT', '/api/billing/business', { requestId: rid('biz'), businessNumber: BIZNO, name: '다육 상회', ceo: '김대표', ...extra }),
    order: (itemId: string, method: 'CARD' | 'TRANSFER' = 'CARD', requestId = rid('ord')) => call(s(), shop.cookie, 'POST', '/api/billing/orders', { requestId, itemId, method, agreed: true }),
    confirm: (paymentId: string, body: Record<string, unknown> = {}) => call(s(), shop.cookie, 'POST', `/api/billing/orders/${paymentId}/confirm`, { requestId: rid('cf'), ...body }),
    refund: (paymentId: string, requestId = rid('rf')) => call(s(), shop.cookie, 'POST', `/api/billing/orders/${paymentId}/refund`, { requestId }),
    payments: (query = '') => call(s(), shop.cookie, 'GET', `/api/billing/payments${query}`),
    usage: (query = '') => call(s(), shop.cookie, 'GET', `/api/billing/usage${query}`),
    start: (body: Record<string, unknown> = {}, requestId = rid('bc')) => call(s(), shop.cookie, 'POST', '/api/broadcasts', { requestId, ...body }),
    end: (b: string) => call(s(), shop.cookie, 'POST', `/api/broadcasts/${b}/end`, { requestId: rid('end') }),
    event: (body: Record<string, unknown>, date?: string) => call(s(), shop.cookie, 'POST', `/api/events${date === undefined ? '' : `?date=${date}`}`, { requestId: rid('ev'), ...body }),
  }
}

/** 사업자 정보를 적고 → 주문 → 가짜 결제 서버에서 완료 → 확인. 결제 ID */
export async function buy(h: BillingHarness, shop: Shop, itemId: string, method: 'CARD' | 'TRANSFER' = 'CARD'): Promise<string> {
  const a = api(h, shop)
  const st = await a.status()
  if (st.business === null) expect((await a.business()).status).toBe(200)
  const created = await a.order(itemId, method)
  expect(created.status, created.text).toBe(200)
  const paymentId = created.body.paymentId as string
  h.test.portone.pay(paymentId, created.body.amount as number, method)
  const confirmed = await a.confirm(paymentId)
  expect(confirmed.status, confirmed.text).toBe(200)
  expect(confirmed.body.result).toBe('GRANT')
  return paymentId
}

export async function rows<T>(h: Harness, sql: string, params: unknown[] = []): Promise<T[]> {
  const pglite = h.database.pglite
  if (pglite === null) throw new Error('PGlite가 아니다')
  return (await pglite.query<T>(sql, params)).rows
}

export async function usageKeys(h: Harness, kind?: string): Promise<string[]> {
  const r = await rows<{ key: string }>(h, `select key from billing_usage ${kind === undefined ? '' : 'where kind = $1'} order by key`, kind === undefined ? [] : [kind])
  return r.map((x) => x.key)
}

/** KST 날짜 (YYYY-MM-DD) */
export const kstDate = (ms: number): string => new Date(ms + 9 * H).toISOString().slice(0, 10)
