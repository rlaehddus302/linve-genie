// AC-I3-93 E2E 서버의 시험용 선택: 새 판매자 계정·봉인 시험 날짜·지금 봉인(/_e2e/*), 작은 할당량 예산, 발송함 시간 줄이기, 화면 폴더.
// 시험용 선택은 운영 시작(main)에서 쓸 수 없다 — main이 그 인자·환경변수를 읽지 않는다(코드 검사).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { E2E_NEW_SELLER_PASSWORD, E2E_OUTBOX_TIMING, startE2eServer, type E2eServer } from '../src/e2e.ts'
import { FAST_COST } from './support.ts'

const ORIGIN = 'http://localhost:5173'
const servers: E2eServer[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function started(options: Parameters<typeof startE2eServer>[0] = {}): Promise<{ e2e: E2eServer; base: string }> {
  const e2e = await startE2eServer({ appOrigin: ORIGIN, passwordCost: FAST_COST, ...options })
  servers.push(e2e)
  const { port } = await e2e.listen(0)
  return { e2e, base: `http://127.0.0.1:${String(port)}` }
}

const post = async (base: string, path: string, body: unknown, cookie?: string) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie === undefined ? {} : { Cookie: cookie }) }, body: JSON.stringify(body) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers }
}
const get = async (base: string, path: string, cookie: string) => (await fetch(`${base}${path}`, { headers: { Cookie: cookie } })).json() as Promise<Record<string, unknown>>

async function login(base: string, loginId: string, password: string): Promise<string> {
  const response = await post(base, '/api/login', { loginId, password })
  expect(response.status).toBe(200)
  return /lj_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? ''
}

describe('AC-I3-93 E2E 서버 시험용 선택', () => {
  it('POST /_e2e/sellers: 방송이 하나도 없는 새 판매자 계정(마법사 상태 처음) — 부를 때마다 다른 계정', async () => {
    const { base } = await started()
    const first = await post(base, '/_e2e/sellers', {})
    const second = await post(base, '/_e2e/sellers', {})
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ password: E2E_NEW_SELLER_PASSWORD })
    expect(first.body.loginId).not.toBe(second.body.loginId)
    const cookie = await login(base, first.body.loginId as string, first.body.password as string)
    expect(await get(base, '/api/broadcasts', cookie)).toEqual({ broadcasts: [] })
    expect(await get(base, '/api/wizard', cookie)).toEqual({ wizard: { status: 'NEW', step: null } })
    expect(((await get(base, '/api/me', cookie)).seller as { name: string }).name).toBe(first.body.shopName)
  })

  it('POST /_e2e/dates: 봉인 7일 전 날짜(sealAt이 6일 뒤)·봉인 예정만 있는 날짜·봉인된 날짜, POST /_e2e/seal: 지금 봉인', async () => {
    const { base, e2e } = await started()
    const cookie = await login(base, e2e.account.loginId, e2e.account.password)
    const soon = await post(base, '/_e2e/dates', { loginId: e2e.account.loginId, kind: 'sealSoon' })
    const plain = await post(base, '/_e2e/dates', { loginId: e2e.account.loginId, kind: 'youtube' })
    const sealed = await post(base, '/_e2e/dates', { loginId: e2e.account.loginId, kind: 'sealed' })
    expect([soon.status, plain.status, sealed.status]).toEqual([200, 200, 200])
    expect(sealed.body.sealed).toBe(true)
    const days = (await get(base, '/api/days', cookie)).days as { date: string; sealAt: string | null; sealed: boolean }[]
    const byDate = new Map(days.map((day) => [day.date, day]))
    const soonDay = byDate.get(soon.body.date as string)
    expect(soonDay?.sealed).toBe(false)
    const untilSeal = Date.parse(soonDay?.sealAt ?? '') - Date.now()
    expect(untilSeal).toBeGreaterThan(5 * 24 * 60 * 60 * 1000)
    expect(untilSeal).toBeLessThan(7 * 24 * 60 * 60 * 1000)
    expect(byDate.get(plain.body.date as string)).toMatchObject({ sealed: false })
    expect(byDate.get(plain.body.date as string)?.sealAt).not.toBeNull()
    expect(byDate.get(sealed.body.date as string)).toMatchObject({ sealed: true })
    expect((await get(base, `/api/days/${sealed.body.date as string}`, cookie)).sealed).toBe(true)
    // 지금 봉인
    const now = await post(base, '/_e2e/seal', { loginId: e2e.account.loginId, date: soon.body.date })
    expect(now.body).toEqual({ sealed: true })
    expect((await get(base, `/api/days/${soon.body.date as string}`, cookie)).sealed).toBe(true)
    expect((await post(base, '/_e2e/dates', { loginId: 'nobody', kind: 'sealed' })).status).toBe(400)
    expect((await post(base, '/_e2e/dates', { loginId: e2e.account.loginId, kind: 'other' })).status).toBe(400)
  })

  it('작은 할당량 예산(--youtube-quota-budget)·화면 폴더(--web-dir)·발송함 시간 줄이기(--outbox-fast)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-e2e-web-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>라이브찜</title>')
    const { base, e2e } = await started({ youtube: { port: 0, quotaBudget: 100 }, webDir: dir, outboxFast: true })
    const cookie = await login(base, e2e.account.loginId, e2e.account.password)
    expect(((await get(base, '/api/youtube/quota', cookie)).quota as { budget: number }).budget).toBe(100)
    const page = await fetch(`${base}/settings/youtube`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>라이브찜</title>')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(E2E_OUTBOX_TIMING).toEqual({ postTimeoutMs: 3000, confirmWindowMs: 5000, lookupIntervalMs: 2000, retryBaseMs: 250 })
  })

  it('시험용 선택은 운영 시작(main)에서 쓸 수 없다 — main이 그 인자·환경변수·조작 경로를 읽지 않는다', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    for (const name of ['outboxTiming', 'outboxFast', 'outbox-fast', 'quotaBudget', 'youtube-quota-budget', 'web-dir', '_e2e', 'e2eControl', 'startE2eServer', 'FakeGoogle', 'hostActionDelayMs', 'generatorSpeed', 'passwordVerifier', 'loginLimits', 'readyTimeoutMs', 'dbPing', 'passwordCost']) {
      expect(main, name).not.toContain(name)
    }
    // 서버 앱 자체에는 조작 경로가 없다 (E2E 기동이 앞에 붙인다)
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
    expect(app).not.toContain('/_e2e')
  })
})
