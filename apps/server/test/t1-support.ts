// T1 택배 서버 시험 도우미: 가짜 택배사(127.0.0.1)를 붙인 서버, 택배 API, 접수할 수 있는 묶음 만들기(판매 → 입금 → 포장 → 배송지 확인).
import { afterAll, expect } from 'vitest'
import { FakeCarrier } from '../src/parcel/fake-carrier.ts'
import type { ServerOptions } from '../src/server.ts'
import { chat, ok, pack } from './i2-support.ts'
import { addSeller, client, createBroadcast, newWorld, rid, writeEvent, type FakeClock, type JsonResponse, type Seller, type TestServer } from './support.ts'

export const D = '2026-10-19'

/** 시험 배송지 (AC-T1-02의 값) */
export const ADDRESS = { name: '홍길동', phone: '010-1234-5678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에' }
/** 시험 보내는 사람 */
export const SENDER = { name: '다육이네', phone: '031-123-4567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' }

/**
 * 비밀값이 글에 남지 않았는지 본다. 숫자·기호로만 된 값(전화번호·우편번호·고객 번호 숫자)은 앞뒤가 영문·숫자가 아닌
 * 곳에 따로 선 것만 본다 — 무작위 UUID·16진 id·암호문(예: 'scp_…-272aac987677')의 글자 사이에 우연히 같은 숫자가
 * 들어 있는 것은 새어 나간 것이 아니다. 값이 JSON 문자열·한글 옆·'-'·공백 옆에 그대로 있으면 잡는다.
 * 한글이 섞인 값·토큰은 그대로 포함 검사한다. 숫자 값은 다섯 자리 이상이어야 한다.
 */
export function expectNoSecret(text: string, secret: string, label = secret): void {
  if (secret.length === 0) throw new Error('빈 비밀값은 볼 수 없다')
  if (!/^[0-9+\- ]+$/.test(secret)) {
    expect(text, label).not.toContain(secret)
    return
  }
  // 네 자리 이하 숫자는 UUID 한 마디('-9876-')와 통째로 같을 수 있어 비밀값으로 쓰지 않는다 — 더 긴 꼴로 본다
  if (secret.replace(/[^0-9]/g, '').length < 5) throw new Error(`숫자 비밀값이 너무 짧다: ${secret.length}자`)
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`(?<![0-9A-Za-z])${escaped}(?![0-9A-Za-z])`).exec(text)
  expect(found === null ? null : text.slice(Math.max(0, found.index - 40), found.index + secret.length + 40), label).toBeNull()
}

export interface ParcelWorld extends TestServer {
  readonly carrier: FakeCarrier
}

const carriers: FakeCarrier[] = []
afterAll(async () => {
  await Promise.all(carriers.splice(0).map((carrier) => carrier.close()))
})

/** 가짜 택배사를 붙인 서버 (어댑터 시간 제한은 시험용으로 짧게) */
export async function parcelWorld(options: { timeoutMs?: number; clock?: FakeClock; overrides?: Partial<Omit<ServerOptions, 'clock'>> } = {}): Promise<ParcelWorld> {
  const carrier = await FakeCarrier.start({ hangMs: 3000 })
  carriers.push(carrier)
  const world = await newWorld({
    parcel: { carriers: { FAKE: carrier.adapter({ timeoutMs: options.timeoutMs ?? 400 }) } },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...options.overrides,
  })
  return { ...world, carrier }
}

/** 택배 API (판매자 세션) */
export function parcelApi(world: TestServer, cookie: string | null) {
  const api = client(world, cookie)
  return {
    settings: () => api.get('/api/parcels/settings'),
    putSettings: (body: Record<string, unknown>) => api.put('/api/parcels/settings', body),
    days: () => api.get('/api/parcels/days'),
    day: (date = D, query = '') => api.get(`/api/parcels/days/${date}${query}`),
    bundle: (buyer: string, date = D) => api.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyer)}`),
    putAddress: (buyer: string, address: unknown, date = D, requestId = rid('pa'), query = '') => api.put(`/api/parcels/days/${date}/address${query}`, { requestId, buyer, address }),
    confirm: (buyer: string, updatedAt: string, date = D, requestId = rid('pc')) => api.post(`/api/parcels/days/${date}/address/confirm`, { requestId, buyer, updatedAt }),
    remove: (buyer: string, date = D, requestId = rid('pd')) => api.post(`/api/parcels/days/${date}/address/delete`, { requestId, buyer }),
    book: (items: unknown[], date = D, requestId = rid('pb'), query = '') => api.post(`/api/parcels/days/${date}/book${query}`, { requestId, items }),
    cancel: (buyer: string, date = D, requestId = rid('px'), query = '') => api.post(`/api/parcels/days/${date}/cancel${query}`, { requestId, buyer }),
    waybill: (buyer: string, date = D) => api.raw(`/api/parcels/days/${date}/waybill.pdf?buyer=${encodeURIComponent(buyer)}`, {}),
    waybills: (date = D) => api.raw(`/api/parcels/days/${date}/waybills.pdf`, {}),
  }
}

export async function expect200(promise: Promise<JsonResponse>): Promise<JsonResponse> {
  const response = await promise
  expect(response.status, response.text).toBe(200)
  return response
}

/** 판매자 + 설정 "택배"(가짜 택배사·보내는 사람) */
export async function parcelSeller(world: TestServer, settings: Record<string, unknown> = { carrier: 'FAKE', sender: SENDER, box: '소' }): Promise<Seller> {
  const seller = await addSeller(world)
  if (Object.keys(settings).length > 0) await expect200(parcelApi(world, seller.cookie).putSettings(settings))
  return seller
}

/** 날짜 하나의 실제 방송에 구매자마다 상품 count개 (채팅 찜) — 방송 ID */
export async function sell(world: TestServer, seller: Seller, buyers: readonly (readonly [string, string, number])[], date = D, options: { rehearsal?: boolean } = {}): Promise<string> {
  const b = (await createBroadcast(world, seller, { date, ...(options.rehearsal === true ? { rehearsal: true } : {}) })).id
  let no = 0
  for (const [ch, nick, count] of buyers) {
    for (let k = 0; k < count; k++) {
      no++
      await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no })
      await chat(world, seller, b, `m${String(no)}-${ch}`, ch, nick, String(no))
    }
  }
  return b
}

interface PackingEntryLike {
  readonly buyer: string
  readonly items: readonly { key: string; qty: number }[]
  readonly status: string
}

/** 그 묶음의 최종 금액 */
export async function totalOf(world: TestServer, seller: Seller, buyer: string, date = D): Promise<number> {
  const day = await client(world, seller.cookie).get(`/api/days/${date}`)
  expect(day.status, day.text).toBe(200)
  const settlement = (day.body.settlements as { buyer: string; date: string; total: number }[]).find((item) => item.buyer === buyer && item.date === date)
  expect(settlement, buyer).toBeDefined()
  return (settlement as { total: number }).total
}

/** 입금 (amount 없으면 최종 금액 전부) */
export async function pay(world: TestServer, seller: Seller, buyer: string, amount?: number, date = D): Promise<void> {
  const value = amount ?? (await totalOf(world, seller, buyer, date))
  const response = await writeEvent(world, seller, { type: 'settlement.payment', buyer, date, amount: value }, date)
  expect(response.status, response.text).toBe(200)
}

/** 포장 완료 */
export async function packAll(world: TestServer, seller: Seller, buyer: string, date = D): Promise<void> {
  const list = await client(world, seller.cookie).get(`/api/days/${date}/packing`)
  expect(list.status, list.text).toBe(200)
  const entry = (list.body.entries as PackingEntryLike[]).find((item) => item.buyer === buyer) as PackingEntryLike
  const response = await pack(world, seller, date, { buyer, action: 'pack', items: entry.items.map((item) => item.key) })
  expect(response.status, response.text).toBe(200)
}

/** 판매자가 배송지를 적는다 (확인함) */
export async function sellerAddress(world: TestServer, seller: Seller, buyer: string, address: Record<string, string> = ADDRESS, date = D): Promise<void> {
  await expect200(parcelApi(world, seller.cookie).putAddress(buyer, address, date))
}

/** 접수할 수 있는 묶음: 입금 완료 → 포장 완료 → 배송지(판매자가 적어 확인함) */
export async function makeReady(world: TestServer, seller: Seller, buyer: string, address: Record<string, string> = ADDRESS, date = D): Promise<void> {
  await pay(world, seller, buyer, undefined, date)
  await packAll(world, seller, buyer, date)
  await sellerAddress(world, seller, buyer, address, date)
}

export interface Row {
  readonly buyer: string
  readonly reason: string | null
  readonly message: string | null
  readonly ready: boolean
  readonly box: string
  readonly qty: number
  readonly parcel: { state: string; invoice: string | null; invoiceText: string | null; status: string | null; checkedAt: string | null; reason: string | null; message: string | null; cancellable: boolean; trackUrl: string | null } | null
}

export async function dayRows(world: TestServer, seller: Seller, date = D): Promise<{ ready: Row[]; excluded: Row[]; booked: Row[]; blocked: { code: string; message: string } | null; body: Record<string, unknown> }> {
  const day = await expect200(parcelApi(world, seller.cookie).day(date))
  return { ready: day.body.ready as Row[], excluded: day.body.excluded as Row[], booked: day.body.booked as Row[], blocked: day.body.blocked as { code: string; message: string } | null, body: day.body }
}

export async function rowOf(world: TestServer, seller: Seller, buyer: string, date = D): Promise<Row> {
  const rows = await dayRows(world, seller, date)
  const row = [...rows.ready, ...rows.excluded, ...rows.booked].find((item) => item.buyer === buyer)
  expect(row, buyer).toBeDefined()
  return row as Row
}

export interface BookResult {
  readonly buyer: string
  readonly ok: boolean
  readonly invoice?: string
  readonly invoiceText?: string
  readonly reason?: string
  readonly message?: string
}

export async function bookOk(world: TestServer, seller: Seller, items: unknown[], date = D, requestId = rid('pb')): Promise<BookResult[]> {
  const response = await expect200(parcelApi(world, seller.cookie).book(items, date, requestId))
  return response.body.results as BookResult[]
}

/** 포장 기록 (DB 행 — 그 구매자) */
export async function packingKinds(world: TestServer, sellerId: string, buyer: string): Promise<{ kind: string; invoice: string | null; account_id: string | null }[]> {
  const rows = await world.database.pglite?.query<{ kind: string; invoice: string | null; account_id: string | null }>('select kind, invoice, account_id from packing_records where seller_id = $1 and buyer = $2 order by id', [sellerId, buyer])
  return rows?.rows ?? []
}

/** 접수 시도 (DB 행 — 그 구매자) */
export async function attempts(world: TestServer, sellerId: string, buyer: string): Promise<{ id: string; state: string; request_key: string; invoice: string | null; reason: string | null; track: string | null; box: string; qty: number }[]> {
  const rows = await world.database.pglite?.query<{ id: string; state: string; request_key: string; invoice: string | null; reason: string | null; track: string | null; box: string; qty: number }>(
    'select id, state, request_key, invoice, reason, track, box, qty from parcels where seller_id = $1 and buyer = $2 order by no',
    [sellerId, buyer],
  )
  return rows?.rows ?? []
}
