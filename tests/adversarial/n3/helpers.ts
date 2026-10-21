// N3 적대 테스트 공용 도구 (test-domain). S04 하네스(PGlite·주입 시계·포트 없음) 위에 입금 확인 시험 모드를 켠다.
// 받아 오기 주기 타이머는 아무것도 돌리지 않는다(시험이 server.deposits.ingest/runSource로 직접 부른다).
import { FakePopbillTransport, type LivejjimServer, type ServerOptions } from '@livejjim/server'
import { expect } from 'vitest'
import { call, harness, rid, startBroadcast, event, type Harness, type Res } from '../s04/helpers.ts'

/** 2026-10-18 (S04 하네스 T0 = 이날 20:00 KST) */
export const DAY = '2026-10-18'

export const idleTimer = {
  schedule(): () => void {
    return () => undefined
  },
}
export const immediateTimer = {
  schedule(_ms: number, fn: () => void): () => void {
    const handle = setImmediate(fn)
    return () => clearImmediate(handle)
  },
}

export interface N3 extends Harness {
  readonly popbill: FakePopbillTransport
}

export async function n3Harness(extra: Partial<ServerOptions> = {}): Promise<N3> {
  const popbill = new FakePopbillTransport()
  const h = await harness({
    deposits: { testMode: true, popbill, timer: idleTimer, waitTimer: immediateTimer, popbillPollMs: 1, refetchGapMs: 0, ...(extra.deposits ?? {}) },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'deposits')),
  })
  return Object.assign(h, { popbill })
}

/** KST 'YYYY-MM-DD HH:MM[:SS]' → UTC 밀리초 */
export function kst(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (m === null) throw new Error(text)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 9, Number(m[5]), Number(m[6] ?? '0'))
}
export const kstIso = (text: string): string => {
  const [d, t] = text.split(' ') as [string, string]
  return `${d}T${t.length === 5 ? `${t}:00` : t}+09:00`
}

export async function ok(res: Promise<Res> | Res): Promise<Res> {
  const r = await res
  expect(r.status, r.text).toBe(200)
  return r
}

let msg = 0
/** 판매: 상품 등록 + 유튜브 채팅 주문 (도착 시각 = 하네스 시계) */
export async function sell(h: Harness, server: LivejjimServer, cookie: string, sellerId: string, opts: { date?: string; rehearsal?: boolean; items: { no: number; price: number; ch: string; nick: string }[] }): Promise<string> {
  const date = opts.date ?? DAY
  const res = await ok(call(server, cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date, ...(opts.rehearsal === true ? { rehearsal: true } : {}) }))
  const b = (res.body.broadcast as { id: string }).id
  for (const item of opts.items) {
    await ok(event(server, cookie, { type: 'product.register', b, no: item.no, name: `상품${String(item.no)}`, price: item.price }))
    const outcome = await server.ingestChat(sellerId, { b, id: `n3m${String(++msg)}`, ch: item.ch, nick: item.nick, text: String(item.no) })
    expect(outcome.status).toBe('recorded')
  }
  return b
}
export { startBroadcast }

export function dep(server: LivejjimServer, cookie: string) {
  return {
    list: (status = 'REVIEW') => call(server, cookie, 'GET', `/api/deposits?status=${status}&limit=200`),
    detail: (no: number) => call(server, cookie, 'GET', `/api/deposits/${String(no)}`),
    preview: (text: string) => call(server, cookie, 'POST', '/api/deposits/paste/preview', { text }),
    paste: (text: string, requestId = rid('paste')) => call(server, cookie, 'POST', '/api/deposits/paste', { requestId, text }),
    confirm: (no: number, body: Record<string, unknown>, requestId = rid('cf')) => call(server, cookie, 'POST', `/api/deposits/${String(no)}/confirm`, { requestId, ...body }),
    ignore: (no: number, requestId = rid('ig')) => call(server, cookie, 'POST', `/api/deposits/${String(no)}/ignore`, { requestId }),
    reopen: (no: number, requestId = rid('ro')) => call(server, cookie, 'POST', `/api/deposits/${String(no)}/reopen`, { requestId }),
    revert: (no: number, requestId = rid('rv')) => call(server, cookie, 'POST', `/api/deposits/${String(no)}/revert`, { requestId }),
    bulk: (items: unknown[], requestId = rid('bk')) => call(server, cookie, 'POST', '/api/deposits/bulk', { requestId, items }),
    bundles: (no: number, q = '', date?: string) => call(server, cookie, 'GET', `/api/deposits/${String(no)}/bundles?q=${encodeURIComponent(q)}${date === undefined ? '' : `&date=${date}`}`),
    sources: () => call(server, cookie, 'GET', '/api/deposits/sources'),
    createSource: (body: Record<string, unknown>) => call(server, cookie, 'POST', '/api/deposits/sources', body),
    patchSource: (id: string, body: Record<string, unknown>) => call(server, cookie, 'PATCH', `/api/deposits/sources/${id}`, body),
    fetch: (id: string) => call(server, cookie, 'POST', `/api/deposits/sources/${id}/fetch`, {}),
    names: () => call(server, cookie, 'GET', '/api/deposits/names'),
    testRows: (source: string, rows: unknown[]) => call(server, cookie, 'POST', '/api/deposits/test/rows', { source, rows }),
    day: (date = DAY, rehearsal = false) => call(server, cookie, 'GET', `/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`),
  }
}

export interface View {
  no: number
  status: string
  name: string
  amount: number
  applied: { date: string; buyer: string; seq: number; auto: boolean } | null
  review?: { reason: string; twin: number | null; suggestions: { date: string; buyer: string; remaining: number; beforeSale: boolean; canRemember: boolean }[]; preselect: { date: string; buyer: string } | null }
}

export async function views(server: LivejjimServer, cookie: string, status = 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED'): Promise<View[]> {
  return ((await ok(dep(server, cookie).list(status))).body as { deposits: View[] }).deposits
}

export async function fakeSource(server: LivejjimServer, cookie: string, label = '시험용 입금'): Promise<string> {
  return ((await ok(dep(server, cookie).createSource({ kind: 'FAKE', label }))).body as { id: string }).id
}

/** 가짜 원천으로 입금을 넣고 받아 온다 */
export async function feed(server: LivejjimServer, cookie: string, sellerId: string, source: string, rows: { key: string; at: string; amount: number; name: string }[]): Promise<void> {
  await ok(dep(server, cookie).testRows(source, rows.map((row) => ({ ...row, at: kstIso(row.at) }))))
  await server.deposits.runSource(sellerId, source)
}

export interface HistoryEvent {
  seq: number
  type: string
  actor: { kind: string; loginId: string | null }
  reason: string | null
  fields: Record<string, unknown>
}

export async function history(server: LivejjimServer, cookie: string, date = DAY, rehearsal = false): Promise<HistoryEvent[]> {
  const r = await call(server, cookie, 'GET', `/api/days/${date}/history?limit=500${rehearsal ? '&rehearsal=true' : ''}`)
  if (r.status === 404) return []
  expect(r.status, r.text).toBe(200)
  return (r.body as { events: HistoryEvent[] }).events
}

const MEMO_RE = /^(?:자동 입금 확인|입금 내역으로 확인|입금 확인 되돌림) · 입금 #(\d+)$/
export const depositNoOf = (e: HistoryEvent): number | null => {
  const text = (e.fields['memo'] ?? e.fields['reason'] ?? e.reason) as unknown
  const m = typeof text === 'string' ? MEMO_RE.exec(text) : null
  return m === null ? null : Number(m[1])
}

/** DP-INV-1: 입금마다 (입금 기록 수 − 되돌림 기록 수) ∈ {0,1}, 1이면 자동 확인됨·확인함 */
export async function checkInv1(server: LivejjimServer, cookie: string, dates: readonly string[]): Promise<void> {
  const net = new Map<number, number>()
  for (const date of dates) {
    for (const e of await history(server, cookie, date)) {
      const no = depositNoOf(e)
      if (no === null) continue
      if (e.type === 'settlement.payment') net.set(no, (net.get(no) ?? 0) + 1)
      if (e.type === 'settlement.refund') net.set(no, (net.get(no) ?? 0) - 1)
    }
  }
  const all = await views(server, cookie)
  for (const v of all) {
    const n = net.get(v.no) ?? 0
    expect([0, 1], `입금 #${String(v.no)} 반영 수 ${String(n)}`).toContain(n)
    if (n === 1) expect(['AUTO_APPLIED', 'APPLIED'], `입금 #${String(v.no)}`).toContain(v.status)
    else expect(['REVIEW', 'IGNORED'], `입금 #${String(v.no)}`).toContain(v.status)
  }
}
