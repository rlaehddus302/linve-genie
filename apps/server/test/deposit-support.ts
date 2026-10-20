// 입금 확인 시험 도우미 (N3). 포트를 열지 않는다 — app.request로 /api/deposits를 부른다. 시각은 주입 시계(T0 = 2026-10-19 12:00 KST).
import { expect } from 'vitest'
import { FakePopbillTransport } from '../src/deposit/popbill-fake.ts'
import type { DepositOptions } from '../src/deposit/service.ts'
import type { ServerOptions } from '../src/server.ts'
import { ORIGIN, client, expectOk, manualTimer, newWorld, rid, writeEvent, type FakeClock, type JsonResponse, type Seller, type TestServer } from './support.ts'

export const DAY = '2026-10-19'
export const KST_HOUR_MS = 3_600_000

/** KST 'YYYY-MM-DD HH:MM[:SS]' → UTC 밀리초 */
export function kst(text: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (match === null) throw new Error(`시각 형식: ${text}`)
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 9, Number(match[5]), Number(match[6] ?? '0'))
}

export interface DepositWorld extends TestServer {
  readonly popbill: FakePopbillTransport
  readonly timer: ReturnType<typeof manualTimer>
}

/** 입금 확인 시험 세계: 시험 모드(가짜 원천)·가짜 팝빌 전송·손으로 돌리는 타이머 */
export async function depositWorld(overrides: Partial<ServerOptions> & { clock?: FakeClock; deposits?: DepositOptions } = {}): Promise<DepositWorld> {
  const popbill = new FakePopbillTransport()
  const timer = manualTimer()
  const world = await newWorld({ ...overrides, deposits: { testMode: true, popbill, timer, popbillPollMs: 1, ...overrides.deposits } })
  return { ...world, popbill, timer }
}

export function depositApi(world: TestServer, seller: Seller) {
  const api = client(world, seller.cookie)
  const del = async (path: string, body: unknown = {}): Promise<JsonResponse> => {
    const response = await world.server.app.request(path, { method: 'DELETE', headers: { Cookie: seller.cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text, headers: response.headers }
  }
  return {
    api,
    del,
    list: (status = 'REVIEW', query = '') => api.get(`/api/deposits?status=${status}${query}`),
    count: async () => ((await expectOk(api.get('/api/deposits/count'))).body as { review: number }).review,
    detail: (no: number) => api.get(`/api/deposits/${String(no)}`),
    preview: (text: string) => api.post('/api/deposits/paste/preview', { text }),
    paste: (text: string, requestId = rid('paste')) => api.post('/api/deposits/paste', { requestId, text }),
    confirm: (no: number, body: Record<string, unknown>, requestId = rid('cf')) => api.post(`/api/deposits/${String(no)}/confirm`, { requestId, ...body }),
    ignore: (no: number, requestId = rid('ig')) => api.post(`/api/deposits/${String(no)}/ignore`, { requestId }),
    reopen: (no: number, requestId = rid('ro')) => api.post(`/api/deposits/${String(no)}/reopen`, { requestId }),
    revert: (no: number, requestId = rid('rv')) => api.post(`/api/deposits/${String(no)}/revert`, { requestId }),
    bulk: (items: unknown[], requestId = rid('bk')) => api.post('/api/deposits/bulk', { requestId, items }),
    bundles: (no: number, q = '', date?: string) => api.get(`/api/deposits/${String(no)}/bundles?q=${encodeURIComponent(q)}${date === undefined ? '' : `&date=${date}`}`),
    sources: () => api.get('/api/deposits/sources'),
    createSource: (body: Record<string, unknown>) => api.post('/api/deposits/sources', body),
    patchSource: (id: string, body: Record<string, unknown>) => api.patch(`/api/deposits/sources/${id}`, body),
    fetch: (id: string) => api.post(`/api/deposits/sources/${id}/fetch`, {}),
    names: () => api.get('/api/deposits/names'),
    forget: (id: number) => del(`/api/deposits/names/${String(id)}`),
    testRows: (source: string, rows: unknown[]) => api.post('/api/deposits/test/rows', { source, rows }),
    day: (date: string, rehearsal = false) => api.get(`/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`),
  }
}

/** 상품 등록 (성공을 기대한다) */
export async function register(world: TestServer, seller: Seller, b: string, no: number, price = 10_000, name = `상품${String(no)}`): Promise<void> {
  await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name, price }))
}

let messageCounter = 0

/** 유튜브 시청자의 주문 채팅 (도착 시각 = 서버 시계) */
export async function order(world: TestServer, seller: Seller, b: string, channel: string, nick: string, text: string): Promise<void> {
  const outcome = await world.server.ingestChat(seller.sellerId, { b, id: `m${String(++messageCounter)}`, ch: channel, nick, text })
  expect(outcome.status).toBe('recorded')
}

/** 문자찜 (메모 선택) */
export async function sms(world: TestServer, seller: Seller, b: string, no: number, memo?: string, phone?: string): Promise<JsonResponse> {
  return expectOk(writeEvent(world, seller, { type: 'sms', b, no, ...(memo === undefined ? {} : { memo }), ...(phone === undefined ? {} : { phone }) }))
}

/** 붙여넣기 표 글 (거래일시·입금자명·입금액) */
export function pasteText(rows: readonly { at: string; name: string; amount: number }[]): string {
  return ['거래일시\t입금자명\t입금액', ...rows.map((row) => `${row.at}\t${row.name}\t${String(row.amount)}`)].join('\n')
}

export interface DepositItem {
  readonly no: number
  readonly status: string
  readonly name: string
  readonly amount: number
  readonly at: string
  readonly precision: string
  readonly source: { id: string; kind: string; label: string }
  readonly applied: { date: string; buyer: string; buyerName: string; seq: number; auto: boolean } | null
  readonly review?: {
    reason: string
    twin: number | null
    suggestions: { date: string; buyer: string; name: string; total: number; received: number; remaining: number; payment: string; refundDue: number; after: { payment: string; received: number; refundDue: number } | null; beforeSale: boolean; canRemember: boolean }[]
    preselect: { date: string; buyer: string } | null
  }
}

export async function deposits(api: ReturnType<typeof depositApi>, status = 'REVIEW'): Promise<DepositItem[]> {
  return ((await expectOk(api.list(status))).body as { deposits: DepositItem[] }).deposits
}

/** 이력에서 정산 기록 (입금 확인이 적은 것 확인용) */
export async function settlementEvents(world: TestServer, seller: Seller, date = DAY, rehearsal = false): Promise<{ seq: number; type: string; actor: { kind: string; loginId: string | null }; reason: string | null; fields: Record<string, unknown> }[]> {
  const response = await client(world, seller.cookie).get(`/api/days/${date}/history?limit=500${rehearsal ? '&rehearsal=true' : ''}`)
  if (response.status === 404) return []
  const events = (response.body as { events: { seq: number; type: string; actor: { kind: string; loginId: string | null }; reason: string | null; fields: Record<string, unknown> }[] }).events
  return events.filter((event) => event.type === 'settlement.payment' || event.type === 'settlement.refund')
}
