// CRM1 서버 시험 도우미: 날짜마다 방송을 만들어 팔고(채팅·문자찜), 묶음 합계만큼 입금하고, 손님 기록 경로를 부른다.
import { expect } from 'vitest'
import { at, chat, kst, ok } from './i2-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, type JsonResponse, type Seller, type TestServer } from './support.ts'

export { at, chat, kst, ok }

export interface Summary {
  purchaseDays: number
  purchaseTotal: number
  lastPurchase: string | null
  unpaidDays: number
  lastUnpaid: string | null
  cancels: number
  regular: boolean
  caution: boolean
}

export interface Row extends Summary {
  id: string
  name: string
  platform: string | null
  kindLabel: string
  phoneLast4: string | null
  blocked: boolean
  latestDate: string
  latestBuyer: string
}

export interface Member {
  buyer: string
  name: string
  platform: string | null
  kindLabel: string
  phoneLast4: string | null
  customer: string | null
  memo: { text: string; savedAt: string } | null
}

/** 2026-09-28 09:00 KST로 시작하는 세계 (날짜를 고를 때 at으로 시계를 옮긴다 — 시계는 줄지 않게. 세션은 30일이라 그 안에서 쓴다) */
export async function crmWorld(start = kst('2026-09-28', '09:00:00')): Promise<{ world: TestServer; seller: Seller }> {
  const world = await newWorld({ clock: fakeClock(start) })
  const seller = await addSeller(world)
  return { world, seller }
}

let productNo = 0

/** 그 날짜에 방송을 (없으면) 만들고 상품 하나를 그 채널이 찜한다 (1등). 방송 ID를 돌려준다 */
export async function buy(world: TestServer, seller: Seller, date: string, channel: string, nick: string, price: number, b?: string): Promise<{ b: string; no: number }> {
  at(world, date, '20:00:00')
  const broadcast = b ?? (await createBroadcast(world, seller, { date, title: `${date} 방송` })).id
  const no = ++productNo % 900 + 1
  await ok(world, seller, { type: 'product.register', b: broadcast, no, name: `품종${String(no)}`, price })
  await chat(world, seller, broadcast, `m${String(productNo)}-${channel}`, channel, nick, String(no))
  return { b: broadcast, no }
}

/** 그 묶음의 결제 금액(코어 total) 그대로 입금 */
export async function payAll(world: TestServer, seller: Seller, date: string, buyer: string): Promise<void> {
  const view = await expectOk(client(world, seller.cookie).get(`/api/days/${date}`))
  const settlement = (view.body.settlements as { buyer: string; total: number }[]).find((item) => item.buyer === buyer)
  expect(settlement, `${date} ${buyer}`).toBeDefined()
  await ok(world, seller, { type: 'settlement.payment', buyer, date, amount: settlement?.total ?? 0 }, date)
}

export function crm(world: TestServer, seller: Seller) {
  const api = client(world, seller.cookie)
  return {
    api,
    dayList: (date: string, rehearsal = false) => api.get(`/api/days/${date}/customers${rehearsal ? '?rehearsal=true' : ''}`),
    day: (date: string, buyer: string, rehearsal = false) => api.get(`/api/days/${date}/customer?buyer=${encodeURIComponent(buyer)}${rehearsal ? '&rehearsal=true' : ''}`),
    summary: async (date: string, buyer: string): Promise<Summary> => (await expectOk(api.get(`/api/days/${date}/customer?buyer=${encodeURIComponent(buyer)}`))).body.summary as Summary,
    members: async (date: string, buyer: string): Promise<Member[]> => (await expectOk(api.get(`/api/days/${date}/customer?buyer=${encodeURIComponent(buyer)}`))).body.members as Member[],
    list: (query = '') => api.get(`/api/customers${query === '' ? '' : `?${query}`}`),
    rows: async (query = ''): Promise<Row[]> => (await expectOk(api.get(`/api/customers${query === '' ? '' : `?${query}`}`))).body.customers as Row[],
    customer: (id: string, before?: string) => api.get(`/api/customers/${id}${before === undefined ? '' : `?before=${before}`}`),
    memo: (id: string, text: unknown): Promise<JsonResponse> => api.put(`/api/customers/${id}/memo`, { text }),
    settings: () => api.get('/api/customer-settings'),
    saveSettings: (body: unknown) => api.put('/api/customer-settings', body),
  }
}

export async function countOf(world: TestServer, table: string): Promise<number> {
  const rows = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from ${table}`)
  return rows?.rows[0]?.n ?? -1
}
