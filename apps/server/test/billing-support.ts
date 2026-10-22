// 요금 시험 도우미 (N5). 요금 기능을 켠 서버(시험 결제 — 가짜 결제 서버·가짜 발행기)를 PGlite로 띄운다.
import type { PGlite } from '@electric-sql/pglite'
import { expect } from 'vitest'
import { testBilling, type TestBillingOptions } from '../src/billing/fake.ts'
import type { PassKind } from '../src/billing/rules.ts'
import type { BillingSetup } from '../src/billing/service.ts'
import type { ServerOptions } from '../src/server.ts'
import { client, newWorld, rid, type FakeClock, type JsonResponse, type Seller, type TestServer } from './support.ts'

/** 맞는 사업자등록번호 (검증 숫자까지 맞는 값 — G-BIL-301) */
export const BIZNO = '123-45-67891'

export interface BillingWorld extends TestServer {
  readonly setup: BillingSetup
}

export async function billingWorld(overrides: Partial<ServerOptions> & { clock?: FakeClock } = {}, options: TestBillingOptions = {}): Promise<BillingWorld> {
  const setup = overrides.billing ?? testBilling(options)
  const world = await newWorld({ ...overrides, billing: setup })
  return { ...world, setup }
}

export function fake(world: BillingWorld) {
  const test = world.setup.test
  if (test === null) throw new Error('시험 결제가 아니다')
  return test
}

/** 운영자 이용권 (시험 — at을 줄 수 있다) */
export async function grant(world: TestServer, seller: Seller, kind: PassKind, quantity: number | null = null, at?: number): Promise<string> {
  return world.server.billing.grantByOperator(seller.sellerId, { kind, quantity, reason: '시험', ...(at === undefined ? {} : { at }) })
}

export async function saveBusiness(world: TestServer, seller: Seller, extra: Record<string, unknown> = {}): Promise<JsonResponse> {
  const response = await client(world, seller.cookie).raw('/api/billing/business', {
    method: 'PUT',
    headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: rid('biz'), businessNumber: BIZNO, name: '다육 상회', ceo: '김대표', ...extra }),
  })
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text, headers: response.headers }
}

export async function order(world: TestServer, seller: Seller, itemId: string, method: 'CARD' | 'TRANSFER' = 'CARD', requestId = rid('ord')): Promise<JsonResponse> {
  return client(world, seller.cookie).post('/api/billing/orders', { requestId, itemId, method, agreed: true })
}

export async function confirm(world: TestServer, seller: Seller, paymentId: string): Promise<JsonResponse> {
  return client(world, seller.cookie).post(`/api/billing/orders/${paymentId}/confirm`, { requestId: rid('cf') })
}

/** 사고 결제 완료까지 (사업자 정보가 없으면 먼저 적는다). 결제 ID를 돌려준다 */
export async function buy(world: BillingWorld, seller: Seller, itemId: string, method: 'CARD' | 'TRANSFER' = 'CARD'): Promise<string> {
  const status = await client(world, seller.cookie).get('/api/billing')
  if (status.body.business === null) expect((await saveBusiness(world, seller)).status).toBe(200)
  const created = await order(world, seller, itemId, method)
  expect(created.status, created.text).toBe(200)
  const paymentId = created.body.paymentId as string
  fake(world).portone.pay(paymentId, created.body.amount as number, method)
  const confirmed = await confirm(world, seller, paymentId)
  expect(confirmed.status, confirmed.text).toBe(200)
  expect(confirmed.body.result).toBe('GRANT')
  return paymentId
}

export async function status(world: TestServer, seller: Seller): Promise<Record<string, unknown>> {
  const response = await client(world, seller.cookie).get('/api/billing')
  expect(response.status, response.text).toBe(200)
  return response.body
}

export async function query<T>(world: TestServer, sql: string): Promise<T[]> {
  return (await (world.database.pglite as PGlite).query<T>(sql)).rows
}

export async function usageKeys(world: TestServer, kind?: string): Promise<string[]> {
  const rows = await query<{ key: string }>(world, `select key from billing_usage ${kind === undefined ? '' : `where kind = '${kind}'`} order by key`)
  return rows.map((row) => row.key)
}

/** KST 시각 → UTC 밀리초 */
export const kst = (date: string, time: string): number => Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}+09:00`)
