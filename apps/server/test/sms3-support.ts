// SMS3 휴대폰 알림 받기 시험 도우미. 포트를 열지 않는다 — app.request로 /api/inbox/messages를 부른다. 시각은 주입 시계(2026-10-31 20:00 KST).
import { listClaims, type ClaimInfo } from '@livejjim/core'
import { expect } from 'vitest'
import { kst } from './deposit-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

export const SMS3_DAY = '2026-10-31'
export const SMS3_T0 = kst('2026-10-31 20:00')

export interface InboxWorld {
  readonly world: TestServer
  readonly seller: Seller
  readonly token: string
}

/** 판매자 하나 + 받기 토큰 (시험 모드 입금 — 주기 없음) */
export async function inboxWorld(options: { rateLimit?: number; world?: TestServer } = {}): Promise<InboxWorld> {
  const world = options.world ?? (await newWorld({ clock: fakeClock(SMS3_T0), deposits: { testMode: true, autoStart: false }, ...(options.rateLimit === undefined ? {} : { inbox: { rateLimit: options.rateLimit } }) }))
  const seller = await addSeller(world)
  const token = await makeToken(world, seller)
  return { world, seller, token }
}

export async function makeToken(world: TestServer, seller: Seller): Promise<string> {
  const made = await expectOk(client(world, seller.cookie).post('/api/inbox/token', {}))
  return made.body.token as string
}

export interface Msg {
  readonly id: string
  readonly channel: 'SMS' | 'APP'
  readonly from: string | null
  readonly title: string | null
  readonly text: string
  readonly receivedAt: string | number | null
}

export const sms = (id: string, from: string | null, text: string, receivedAt: string | number | null = null): Msg => ({ id, channel: 'SMS', from, title: null, text, receivedAt })
export const app = (id: string, from: string, title: string | null, text: string, receivedAt: string | number | null = null): Msg => ({ id, channel: 'APP', from, title, text, receivedAt })

/** 기기 입구로 보낸다 (토큰 null이면 머리글 없음) */
export async function send(world: TestServer, token: string | null, messages: readonly unknown[], device: unknown = '갤럭시 S24'): Promise<JsonResponse> {
  return sendRaw(world, token, JSON.stringify({ device, messages }))
}

export async function sendRaw(world: TestServer, token: string | null, body: string, authorization?: string): Promise<JsonResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authorization !== undefined) headers.Authorization = authorization
  else if (token !== null) headers.Authorization = `Bearer ${token}`
  const response = await world.server.app.request('/api/inbox/messages', { method: 'POST', headers, body })
  const text = await response.text()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    parsed = {}
  }
  return { status: response.status, body: parsed, text, headers: response.headers }
}

/** 상태만 (응답 200을 기대한다) */
export async function statuses(world: TestServer, token: string, messages: readonly unknown[]): Promise<string[]> {
  const response = await send(world, token, messages)
  expect(response.status, response.text).toBe(200)
  return (response.body.results as { id: string; status: string }[]).map((item) => item.status)
}

/** 실제 방송 + 상품들 (가격 10,000원 — 묶음은 배송비 4,000을 더해 14,000원) */
export async function liveSale(world: TestServer, seller: Seller, numbers: readonly number[] = [15], options: { saleMode?: string } = {}): Promise<{ id: string; date: string }> {
  const b = await createBroadcast(world, seller, { date: SMS3_DAY, ...(options.saleMode === undefined ? {} : ({ saleMode: options.saleMode } as Record<string, string>)) })
  for (const no of numbers) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: `상품${String(no)}`, price: 10_000 }))
  return b
}

export async function claimsOf(world: TestServer, seller: Seller, date = SMS3_DAY): Promise<ClaimInfo[]> {
  return listClaims((await world.server.writer.read(seller.sellerId, date, false)).state)
}

export interface CardItem {
  readonly id: string
  readonly b: string
  readonly kind: string
  readonly why: string | null
  readonly numbers: number[]
  readonly memo: string | null
  readonly last4: string | null
  readonly sender: string | null
  readonly text: string
  readonly receivedAt: string
  readonly message: string
}

export async function cards(world: TestServer, seller: Seller, b: string): Promise<CardItem[]> {
  return ((await expectOk(client(world, seller.cookie).get(`/api/inbox/cards?b=${b}`))).body.cards as CardItem[])
}
