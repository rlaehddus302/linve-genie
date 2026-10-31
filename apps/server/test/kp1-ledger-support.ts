// KP1 손님 장부 서버 시험 도우미: 링크 열기·양식 보내기(배송지 + "다음 주문에도"), 장부 표 읽기, 판매자 장부 API.
import type { PGlite } from '@electric-sql/pglite'
import { expect } from 'vitest'
import { kst } from './i2-support.ts'
import { linkApi, openLink, tokenOf } from './n4b-support.ts'
import { ORIGIN, client, fakeClock, rid, type JsonResponse, type Seller, type TestServer } from './support.ts'
import { ADDRESS, D, parcelSeller, parcelWorld, sell, type ParcelWorld } from './t1-support.ts'

export { ADDRESS, D, kst, openLink, parcelSeller, parcelWorld, sell }

/** 시험 시작 시각: D(2026-10-19) 20:00 KST */
export const START = kst(D, '20:00:00')

export async function ledgerWorld(start = START): Promise<{ world: ParcelWorld; seller: Seller }> {
  const world = await parcelWorld({ clock: fakeClock(start) })
  const seller = await parcelSeller(world)
  return { world, seller }
}

export async function linkFor(world: TestServer, seller: Seller, buyer: string, date = D): Promise<string> {
  const created = await linkApi(world, seller.cookie).create(date, buyer)
  expect(created.status, created.text).toBe(200)
  return tokenOf((created.body.link as { url: string }).url)
}

export async function postForm(world: TestServer, path: string, values: Record<string, string> | [string, string][], headers: Record<string, string> = { Origin: ORIGIN }): Promise<{ status: number; headers: Headers; text: string }> {
  const response = await world.server.app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(values).toString(),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

/** 링크에서 배송지 보내기 (keep = "다음 주문에도 이 배송지 쓰기") */
export async function sendAddress(world: TestServer, token: string, keep: boolean, address: Record<string, string> = ADDRESS): Promise<{ status: number; headers: Headers; text: string }> {
  return postForm(world, `/r/${token}/address`, { ...address, ...(keep ? { keep: 'on' } : {}) })
}

/** 링크에서 배송지 + 동의 (303 기대) */
export async function consent(world: TestServer, seller: Seller, buyer: string, date = D, address: Record<string, string> = ADDRESS): Promise<string> {
  const token = await linkFor(world, seller, buyer, date)
  const sent = await sendAddress(world, token, true, address)
  expect(sent.status, sent.text).toBe(303)
  return token
}

export async function rowsOf(world: TestServer, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await (world.database.pglite as PGlite).query<Record<string, unknown>>(sql, params)).rows
}

export const lines = (world: TestServer) => rowsOf(world, 'select * from ledger_lines order by created_at, id')
export const markers = (world: TestServer) => rowsOf(world, 'select seller_id, marker, line_id, source, label_platform, label_name, label_last4 from ledger_markers order by id')
export const consents = (world: TestServer) => rowsOf(world, 'select seller_id, line_id, type, items, wording, months, route, order_date, reason, account_id from ledger_consents order by id')
export const codes = (world: TestServer) => rowsOf(world, 'select * from ledger_codes order by created_at, id')

export function ledgerApi(world: TestServer, cookie: string | null) {
  const api = client(world, cookie)
  return {
    api,
    settings: () => api.get('/api/ledger-settings'),
    saveSettings: (body: unknown) => api.put('/api/ledger-settings', body),
    badges: (date: string, buyers: readonly string[], extra = '') => api.get(`/api/days/${date}/customer-badges?${buyers.map((buyer) => `buyer=${encodeURIComponent(buyer)}`).join('&')}${extra}`),
    bundle: (buyer: string, date = D) => api.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyer)}`),
    confirmLedger: (buyer: string, ledgerId: string, updatedAt: string, date = D, requestId = rid('pl')): Promise<JsonResponse> =>
      api.post(`/api/parcels/days/${date}/address/ledger`, { requestId, buyer, ledgerId, updatedAt }),
    customers: () => api.get('/api/customers'),
    customer: (id: string) => api.get(`/api/customers/${id}`),
    deleteLedger: (id: string, ledgerId: string) => api.post(`/api/customers/${id}/ledger/delete`, { ledgerId }),
    xlsx: (contact?: string) => api.raw(`/api/customers.xlsx${contact === undefined ? '' : `?contact=${contact}`}`, {}),
  }
}

/** 로그 전체 글 (새는 것 찾기) */
export const logText = (world: TestServer) => JSON.stringify(world.logs)
