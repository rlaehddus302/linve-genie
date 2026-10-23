// A1 서버 시험 도우미: 가짜 LLM 서버를 붙인 서버, 옵션 방송(상품 21 반바지 S/M[별칭 미디움]/L), 확인 필요 댓글 넣기, AI 켜기.
import { afterEach, expect } from 'vitest'
import { FakeLlm } from '../src/assist/fake-llm.ts'
import type { ServerOptions } from '../src/server.ts'
import { addSeller, client, expectOk, newWorld, rid, writeEvent, type FakeClock, type JsonResponse, type Seller, type TestServer } from './support.ts'

export const SIZES = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'] }, { label: 'L' }] }]

const opened: FakeLlm[] = []
afterEach(async () => {
  for (const fake of opened.splice(0)) await fake.close()
})

export interface AssistWorld {
  readonly world: TestServer
  readonly fake: FakeLlm
  readonly seller: Seller
}

/** 가짜 LLM 서버 + 서버. key: false면 키 없는 서버(가짜 서버는 떠 있지만 서버가 모른다) */
export async function assistWorld(
  options: { readonly key?: boolean; readonly daily?: number; readonly global?: number; readonly timeoutMs?: number; readonly clock?: FakeClock; readonly server?: Partial<Omit<ServerOptions, 'clock'>> } = {},
): Promise<AssistWorld> {
  const fake = await FakeLlm.start()
  opened.push(fake)
  const world = await newWorld({
    ...(options.key === false
      ? {}
      : {
          assist: fake.setup({
            ...(options.daily === undefined ? {} : { dailyLimit: options.daily }),
            ...(options.global === undefined ? {} : { globalLimit: options.global }),
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          }),
        }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...options.server,
  })
  const seller = await addSeller(world)
  return { world, fake, seller }
}

export async function optionBroadcast(world: TestServer, seller: Seller, input: Record<string, unknown> = {}): Promise<{ id: string; date: string; rehearsal: boolean }> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), saleMode: 'OPTIONS', ...input })
  expect(response.status, response.text).toBe(200)
  return response.body.broadcast as { id: string; date: string; rehearsal: boolean }
}

/** 옵션 방송과 상품 21 반바지(가격 15,000원, 재고 S1·M1·L3) */
export async function shortsBroadcast(world: TestServer, seller: Seller, input: Record<string, unknown> = {}): Promise<{ id: string; date: string; rehearsal: boolean }> {
  const b = await optionBroadcast(world, seller, input)
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { S: 1, M: 1, L: 3 } }))
  return b
}

let chatCounter = 0
/** 댓글 하나 (메시지 ID를 돌려준다) */
export async function chat(world: TestServer, seller: Seller, b: string, text: string, nick = '시청자', ch?: string): Promise<string> {
  const id = `m${String(++chatCounter)}`
  const outcome = await world.server.ingestChat(seller.sellerId, { b, id, ch: ch ?? `UC${String(chatCounter).padStart(4, '0')}`, nick, text })
  expect(outcome.status).toBe('recorded')
  return id
}

export const settingsApi = (world: TestServer, seller: Seller) => client(world, seller.cookie)

export async function enableAssist(world: TestServer, seller: Seller): Promise<JsonResponse> {
  return expectOk(client(world, seller.cookie).put('/api/assist/settings', { enabled: true, consent: true }))
}

export async function suggest(world: TestServer, seller: Seller, body: Record<string, unknown> = { rehearsal: false }): Promise<JsonResponse> {
  return client(world, seller.cookie).post('/api/assist/suggest', body)
}

export interface ReviewRow {
  readonly item: string
  readonly text: string | null
  readonly reason: string
  readonly suggestion: Record<string, unknown> | null
}

export async function reviews(world: TestServer, seller: Seller, query = ''): Promise<ReviewRow[]> {
  const response = await expectOk(client(world, seller.cookie).get(`/api/reviews${query}`))
  return response.body.reviews as ReviewRow[]
}

export const byText = (rows: readonly ReviewRow[], text: string): ReviewRow => {
  const row = rows.find((item) => item.text === text)
  if (row === undefined) throw new Error(`항목 없음: ${text}`)
  return row
}

/** 가짜 서버가 받은 요청의 항목 글 */
export function sentTexts(fake: FakeLlm, index: number): string[] {
  const body = fake.requests[index]?.body as { messages?: { content?: string }[] } | undefined
  const content = body?.messages?.[0]?.content ?? '{}'
  return ((JSON.parse(content) as { items?: { text: string }[] }).items ?? []).map((item) => item.text)
}

export async function eventCount(world: TestServer): Promise<number> {
  const rows = await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from events')
  return rows?.rows[0]?.n ?? 0
}
