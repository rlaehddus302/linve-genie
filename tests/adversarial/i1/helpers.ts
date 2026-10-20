// I1 적대 테스트 공용 도구 (test-domain). s04 harness 위에 출력 API(/api/print/**) 호출을 얹는다.
import { expect } from 'vitest'
import { call, event, harness, rid, startBroadcast, type Harness, type Res } from '../s04/helpers.ts'

export { call, event, harness, rid, startBroadcast, type Harness, type Res }

export const DAY = '2026-10-18'
export const DEV_A = 'device-aaaa-0001'
export const DEV_B = 'device-bbbb-0002'

export interface Job {
  id: string
  date: string
  kind: string
  reason: string
  status: string
  word: string
  voided: boolean
  discard: boolean
  attempts: number
  lastError: { code: string; item: string | null } | null
  label: { key: string; claim: string | null; version: number | null; no: number | null; buyer: { kind: string; name?: string } }
  data: Record<string, unknown> | null
  device: string | null
}

export interface Label {
  key: string
  claim: string | null
  version: number | null
  no: number | null
  state: string
  word: string
  voided: boolean
  discard: number
  reprintNeeded: boolean
  printed: number
  winner: boolean
  data: Record<string, unknown> | null
  canPrint: boolean
  canReprint: boolean
  buyer: { kind: string; name?: string }
}

export interface Overview {
  queue: { rev: number; device: { id: string; name: string } | null; pause: { reason: string; message: string; backlog: boolean } | null; waiting: number; printing: number; discard: number }
  jobs: Job[]
  discard: Job[]
}

export interface Claimed {
  id: string
  date: string
  kind: string
  attempt: string
  data: Record<string, unknown>
  label: Job['label']
  page: number | null
  pages: number | null
}

export function printer(h: Harness, cookie: string) {
  const ok = async (res: Promise<Res>): Promise<Res> => {
    const r = await res
    expect(r.status, r.text).toBe(200)
    return r
  }
  const p = {
    raw: (method: string, path: string, body?: unknown) => call(h.server, cookie, method, path, body),
    overview: async (): Promise<Overview> => (await ok(call(h.server, cookie, 'GET', '/api/print'))).body as unknown as Overview,
    labels: async (date = DAY): Promise<Label[]> => ((await ok(call(h.server, cookie, 'GET', `/api/print/labels?date=${date}`))).body as { labels: Label[] }).labels,
    register: (deviceId: string, name: string, replace?: boolean) => call(h.server, cookie, 'POST', '/api/print/device', { deviceId, name, ...(replace === undefined ? {} : { replace }) }),
    state: (deviceId: string, connected: boolean) => call(h.server, cookie, 'POST', '/api/print/device/state', { deviceId, connected }),
    release: () => call(h.server, cookie, 'POST', '/api/print/device/release', {}),
    pause: () => call(h.server, cookie, 'POST', '/api/print/pause', {}),
    restart: () => call(h.server, cookie, 'POST', '/api/print/restart', {}),
    claim: async (deviceId: string): Promise<{ job: Claimed | null; reason?: string }> =>
      (await ok(call(h.server, cookie, 'POST', '/api/print/claim', { deviceId }))).body as unknown as { job: Claimed | null; reason?: string },
    result: (deviceId: string, attempt: string, ok_: boolean, code?: string, item?: string) =>
      call(h.server, cookie, 'POST', '/api/print/result', ok_ ? { deviceId, attempt, ok: true } : { deviceId, attempt, ok: false, error: { code, ...(item === undefined ? {} : { item }) } }),
    print: (b: string, claim: string, requestId = rid('pl')) => call(h.server, cookie, 'POST', '/api/print/labels/print', { requestId, b, claim }),
    reprint: (b: string, claim: string, version?: number, requestId = rid('rp')) =>
      call(h.server, cookie, 'POST', '/api/print/labels/reprint', { requestId, b, claim, ...(version === undefined ? {} : { version }) }),
    packing: (date: string, buyer: string, requestId = rid('pk')) => call(h.server, cookie, 'POST', '/api/print/packing', { requestId, date, buyer }),
    packingView: (date: string, buyer: string) => call(h.server, cookie, 'GET', `/api/print/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`),
    cancel: (date: string, id: string) => call(h.server, cookie, 'POST', '/api/print/jobs/cancel', { date, id }),
    cancelAll: () => call(h.server, cookie, 'POST', '/api/print/jobs/cancel-all', { confirm: true }),
    discard: (date: string, id: string) => call(h.server, cookie, 'POST', '/api/print/jobs/discard', { date, id }),
    templates: () => call(h.server, cookie, 'GET', '/api/print/templates'),
    saveTemplate: (kind: string, template: unknown, version: number) => call(h.server, cookie, 'PUT', `/api/print/templates/${kind}`, { template, version }),
    /** 출력 기기가 되고 멈춤이면 푼다 */
    async become(deviceId = DEV_A, name = '휴대폰'): Promise<void> {
      await ok(p.register(deviceId, name))
      const o = await p.overview()
      if (o.queue.pause !== null) await ok(p.restart())
    },
    /** 받은 작업을 출력함으로 */
    async printOne(deviceId = DEV_A): Promise<Claimed | null> {
      const c = await p.claim(deviceId)
      if (c.job === null) return null
      await ok(p.result(deviceId, c.job.attempt, true))
      return c.job
    },
  }
  return p
}

let chatN = 0
export async function chat(h: Harness, sellerId: string, b: string, ch: string, nick: string, text: string): Promise<void> {
  const r = await h.server.ingestChat(sellerId, { b, id: `adv-${String(++chatN)}`, ch, nick, text })
  expect(r.status).toBe('recorded')
}

export async function ev(h: Harness, cookie: string, body: Record<string, unknown>, date?: string): Promise<Res> {
  const r = await event(h.server, cookie, body, date)
  expect(r.status, r.text).toBe(200)
  return r
}

export async function labelReports(h: Harness, sellerId: string): Promise<string[]> {
  const rows = (await h.database.pglite?.query<{ body: string }>(`select body from events where type = 'effect.labelPrinted' and seller_id = $1 order by id`, [sellerId]))?.rows ?? []
  return rows.map((r) => (JSON.parse(r.body) as { effectId: string }).effectId)
}
