// 출력 기록 시험 도우미 (I1). 포트를 열지 않는다 — app.request로 /api/print를 부른다.
import { expect } from 'vitest'
import { ORIGIN, client, expectOk, rid, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

export const DAY = '2026-10-19'
export const DEVICE_A = 'device-aaaa-0001'
export const DEVICE_B = 'device-bbbb-0002'

export interface PrintedJob {
  readonly id: string
  readonly date: string
  readonly kind: string
  readonly reason: string
  readonly status: string
  readonly word: string
  readonly voided: boolean
  readonly discard: boolean
  readonly attempts: number
  readonly lastError: { code: string; item: string | null } | null
  readonly label: { key: string; claim: string | null; version: number | null; broadcast: string | null; no: number | null; buyer: { kind: string; name?: string } }
  readonly data: Record<string, unknown> | null
  readonly device: string | null
  readonly printedAt: string | null
}

export interface Overview {
  readonly queue: {
    rev: number
    device: { id: string; name: string; live: boolean; printerConnected: boolean; releasing: boolean } | null
    pause: { reason: string; message: string; backlog: boolean } | null
    /** 라벨이 안 나가는 가장 최근 까닭 (D-ALERTFLOAT-01) */
    issue: string | null
    waiting: number
    printing: number
    discard: number
    /** 라벨 기능 켬/끔 (N4a) */
    labelsEnabled: boolean
  }
  readonly jobs: PrintedJob[]
  readonly discard: PrintedJob[]
}

export interface ClaimedJob {
  readonly id: string
  readonly date: string
  readonly kind: string
  readonly reason: string
  readonly attempt: string
  readonly data: Record<string, unknown>
  readonly template: Record<string, unknown>
  readonly page: number | null
  readonly pages: number | null
  readonly label: PrintedJob['label']
}

export function printApi(world: TestServer, seller: Seller) {
  const api = client(world, seller.cookie)
  const put = async (path: string, body: unknown): Promise<JsonResponse> => {
    const response = await world.server.app.request(path, {
      method: 'PUT',
      headers: { Cookie: seller.cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text, headers: response.headers }
  }
  return {
    api,
    put,
    overview: async (): Promise<Overview> => (await expectOk(api.get('/api/print'))).body as unknown as Overview,
    labels: async (date = DAY) => (await expectOk(api.get(`/api/print/labels?date=${date}`))).body as unknown as { date: string; labels: Record<string, unknown>[] },
    register: (deviceId: string, name: string, replace?: boolean) => api.post('/api/print/device', { deviceId, name, ...(replace === undefined ? {} : { replace }) }),
    state: (deviceId: string, connected: boolean) => api.post('/api/print/device/state', { deviceId, connected }),
    release: () => api.post('/api/print/device/release', {}),
    pause: () => api.post('/api/print/pause', {}),
    restart: () => api.post('/api/print/restart', {}),
    claim: async (deviceId: string): Promise<{ job: ClaimedJob | null; reason?: string }> =>
      (await expectOk(api.post('/api/print/claim', { deviceId }))).body as unknown as { job: ClaimedJob | null; reason?: string },
    claimRaw: (deviceId: string) => api.post('/api/print/claim', { deviceId }),
    done: async (deviceId: string, attempt: string): Promise<boolean> =>
      ((await expectOk(api.post('/api/print/result', { deviceId, attempt, ok: true }))).body as { recorded: boolean }).recorded,
    fail: async (deviceId: string, attempt: string, code: string, item?: string): Promise<boolean> =>
      ((await expectOk(api.post('/api/print/result', { deviceId, attempt, ok: false, error: { code, ...(item === undefined ? {} : { item }) } }))).body as { recorded: boolean }).recorded,
    print: (b: string, claim: string, requestId = rid('pl')) => api.post('/api/print/labels/print', { requestId, b, claim }),
    reprint: (b: string, claim: string, version?: number, requestId = rid('rp')) => api.post('/api/print/labels/reprint', { requestId, b, claim, ...(version === undefined ? {} : { version }) }),
    packing: (date: string, buyer: string, requestId = rid('pk')) => api.post('/api/print/packing', { requestId, date, buyer }),
    cancel: (date: string, id: string) => api.post('/api/print/jobs/cancel', { date, id }),
    cancelAll: () => api.post('/api/print/jobs/cancel-all', { confirm: true }),
    discard: (date: string, id: string) => api.post('/api/print/jobs/discard', { date, id }),
  }
}

/** 출력 기기로 정하고(쌓인 라벨이면 출력 시작까지) 프린터 연결됨 */
export async function becomeDevice(world: TestServer, seller: Seller, deviceId = DEVICE_A, name = '휴대폰'): Promise<void> {
  const p = printApi(world, seller)
  await expectOk(p.register(deviceId, name))
  const overview = await p.overview()
  if (overview.queue.pause !== null) await expectOk(p.restart())
}

/** 상품 등록 */
export async function register(world: TestServer, seller: Seller, b: string, no: number, name = '구피', price = 10000, stock?: number): Promise<void> {
  await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name, price, ...(stock === undefined ? {} : { stock }) }))
}

let chatCounter = 0
/** 채팅 한 줄 (수집 함수) */
export async function chat(world: TestServer, seller: Seller, b: string, channel: string, nick: string, text: string): Promise<void> {
  const result = await world.server.ingestChat(seller.sellerId, { b, id: `m-${String(++chatCounter)}`, ch: channel, nick, text })
  expect(result.status).toBe('recorded')
}

/** 엔진 이벤트 기록의 effect.labelPrinted 수 */
export async function labelReports(world: TestServer, sellerId?: string): Promise<{ effectId: string }[]> {
  const result = await world.database.pglite?.query<{ body: string }>(
    `select body from events where type = 'effect.labelPrinted'${sellerId === undefined ? '' : ` and seller_id = $1`} order by id`,
    sellerId === undefined ? [] : [sellerId],
  )
  return (result?.rows ?? []).map((row) => JSON.parse(row.body) as { effectId: string })
}

/** 출력 알림이 다 나갈 때까지 */
export async function settled(world: TestServer): Promise<void> {
  await world.server.print.settled()
}
