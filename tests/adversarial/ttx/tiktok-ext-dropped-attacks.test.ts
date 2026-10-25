// TTX 적대 시험 (test-domain): 확장 틱톡 상태의 dropped (AC-TTX-32, D-TTX-16) — 서버 쪽.
// 다른 판매자 연결에 넣기(같은 틱톡 아이디 포함 — D-TTX-19), 연결 없는 판매자, 이상한 값(JSON 글자 그대로), 동시 상태,
// 유튜브 상태에 dropped, 끊은 뒤·다시 이은 뒤. 가짜 웹캐스트·가짜 시계 — 실제 틱톡에 붙지 않는다(읽기만, 글쓰기 없음).
import { afterEach, describe, expect, it } from 'vitest'
import { tiktokLinks } from '../../../apps/server/src/db/schema.ts'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { client, waitFor, type Seller } from '../../../apps/server/test/support.ts'
import { linkTiktok, realBroadcast, tiktokSeller, ttWorld, unlinkTiktok, type TtWorld } from '../../../apps/server/test/tiktok-live-support.ts'

installNetworkGuard()

const worlds: TtWorld[] = []
async function world(): Promise<TtWorld> {
  const w = await ttWorld()
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

interface ExtResponse {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly text: string
}

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

async function ext(w: TtWorld, path: string, token: string | null, body?: unknown, step = 250, raw?: string, method: 'GET' | 'POST' = 'POST'): Promise<ExtResponse> {
  if (step > 0) await w.tclock.advance(step)
  const headers: Record<string, string> = { Origin: ORIGIN }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  const response = await w.server.app.request(path, { method, headers, ...(payload === undefined ? {} : { body: payload }) })
  const text = await response.text()
  let parsed: Record<string, unknown>
  try {
    parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
  } catch {
    parsed = {}
  }
  return { status: response.status, body: parsed, text }
}

async function connectExt(w: TtWorld, seller: Seller): Promise<string> {
  const issued = await client(w, seller.cookie).post('/api/extension/code', {})
  expect(issued.status, issued.text).toBe(200)
  const exchanged = await ext(w, '/ext/connect', null, { code: issued.body.code })
  expect(exchanged.status, exchanged.text).toBe(200)
  return exchanged.body.token as string
}

const BASE = { screen: 'OWN', hidden: false, read: 1, unread: 0 }
const status = (w: TtWorld, token: string, dropped?: unknown, step = 250) => ext(w, '/ext/tiktok/status', token, dropped === undefined ? BASE : { ...BASE, dropped }, step)
const rawStatus = (w: TtWorld, token: string, droppedJson: string) => ext(w, '/ext/tiktok/status', token, undefined, 250, `{"screen":"OWN","hidden":false,"read":1,"unread":0,"dropped":${droppedJson}}`)
const linkView = async (w: TtWorld, cookie: string, b: string) =>
  (await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as (Record<string, unknown> & { collection: Record<string, unknown> | null; extension: Record<string, unknown> | null }) | null

/** 모든 틱톡 연결의 저장 실패 수 (연결 id → 수) */
async function saveFailedAll(w: TtWorld): Promise<Map<number, { seller: string; state: string; saveFailed: number }>> {
  const rows = await w.database.db.select().from(tiktokLinks)
  return new Map(rows.map((row) => [row.id, { seller: row.sellerId, state: row.state, saveFailed: row.saveFailed }]))
}
const linkOf = async (w: TtWorld, sellerId: string, b: string) => {
  const rows = (await w.database.db.select().from(tiktokLinks)).filter((row) => row.sellerId === sellerId && row.broadcastId === b)
  expect(rows.length).toBeGreaterThan(0)
  return rows[rows.length - 1]!
}

/** 판매자 + 동의 + 실제 회차 + 틱톡 잇기(서명 실패로 다시 시도 중) + 확장 토큰 */
async function linked(w: TtWorld, tiktokId: string) {
  const { seller } = await tiktokSeller(w, { tiktokId })
  const b = await realBroadcast(w, seller)
  w.webcast.failNext('SIGN_FAILED', 50)
  const r = await linkTiktok(w, seller, b)
  expect(r.status, r.text).toBe(200)
  await waitFor(async () => (await linkView(w, seller.cookie, b))?.collection?.state === 'RETRYING')
  const token = await connectExt(w, seller)
  return { seller, b, token }
}

describe('TTX 적대 — 확장 dropped는 보낸 판매자의 이어진 연결에만 (AC-TTX-32, D-TTX-16·19)', () => {
  it('TD-TTX-R40: 두 판매자가 같은 틱톡 아이디를 넣어도 B의 dropped는 B 연결에만, A의 것은 A에만 — 남의 연결 수는 그대로', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    const b = await linked(w, 'seller_kim') // D-TTX-19: 같은 아이디를 막지 않는다
    expect((await status(w, a.token)).status).toBe(200)
    expect((await status(w, b.token)).status).toBe(200)
    const r1 = await status(w, b.token, 7)
    expect(r1.status, r1.text).toBe(200)
    expect((await linkOf(w, b.seller.sellerId, b.b)).saveFailed).toBe(7)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed, 'B의 dropped가 A 연결에 더해짐').toBe(0)
    expect((await linkView(w, a.seller.cookie, a.b))?.collection).toMatchObject({ saveFailed: 0, missed: false })
    const r2 = await status(w, a.token, 2)
    expect(r2.status, r2.text).toBe(200)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed).toBe(2)
    expect((await linkOf(w, b.seller.sellerId, b.b)).saveFailed).toBe(7)
  })

  it('TD-TTX-R41: 틱톡 연결이 없는 판매자의 dropped는 어디에도 더해지지 않는다 (10,000이어도)', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    await status(w, a.token, 1)
    const { seller: c } = await tiktokSeller(w, { tiktokId: 'seller_kim' }) // 같은 아이디, 연결은 하지 않음
    const cToken = await connectExt(w, c)
    const before = await saveFailedAll(w)
    const r = await status(w, cToken, 10_000)
    expect(r.status, r.text).toBeLessThan(500)
    expect(await saveFailedAll(w)).toEqual(before)
  })

  it('TD-TTX-R42: JSON 글자 그대로의 이상한 값 — 1e400·2^53+1·"0x10"·[3]·{} 는 400이고 수가 바뀌지 않는다 · 1e4·10000.0은 10,000으로 받는다 · -0은 0 · __proto__로 감춘 dropped는 더하지 않는다', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    expect((await status(w, a.token)).status).toBe(200)
    for (const bad of ['1e400', '-1e400', '9007199254740993', '"0x10"', '"1e3"', '[3]', '{"n":3}', '10000.5', '1e5', '-1', 'null', 'true']) {
      const r = await rawStatus(w, a.token, bad)
      expect(r.status, `${bad} ${r.text}`).toBe(400)
      expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed, bad).toBe(0)
    }
    expect((await rawStatus(w, a.token, '-0')).status).toBe(200)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed).toBe(0)
    const big = await rawStatus(w, a.token, '1e4')
    expect(big.status, big.text).toBe(200)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed).toBe(10_000)
    expect((await rawStatus(w, a.token, '10000.0')).status).toBe(200)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed).toBe(20_000)
    // dropped를 프로토타입에 숨겨도 자기 값만 본다
    const hidden = await ext(w, '/ext/tiktok/status', a.token, undefined, 250, '{"screen":"OWN","hidden":false,"read":1,"unread":0,"__proto__":{"dropped":5}}')
    expect(hidden.status, hidden.text).toBeGreaterThanOrEqual(200)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed, '__proto__의 dropped를 더함').toBe(20_000)
  })

  it('TD-TTX-R43: 같은 상태를 동시에 30번 — 받은(200) 요청의 dropped 합만큼 정확히 더한다 (잃거나 두 번 더하지 않음)', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    expect((await status(w, a.token)).status).toBe(200)
    await w.tclock.advance(15_000)
    const replies = await Promise.all(Array.from({ length: 30 }, () => status(w, a.token, 3, 0)))
    const ok = replies.filter((r) => r.status === 200).length
    for (const r of replies) expect([200, 429], r.text).toContain(r.status)
    expect(ok).toBeGreaterThan(0)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed).toBe(ok * 3)
  })

  it('TD-TTX-R44: 유튜브 확장 상태(/ext/status)에 실은 dropped는 틱톡 저장 실패 수에 더하지 않는다', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    expect((await status(w, a.token)).status).toBe(200)
    const yt = await ext(w, '/ext/status', a.token, { v: null, hidden: false, read: 1, unread: 0, dropped: 9 })
    expect(yt.status, yt.text).toBeLessThan(500)
    expect((await linkOf(w, a.seller.sellerId, a.b)).saveFailed).toBe(0)
  })

  it('TD-TTX-R45: 끊은 연결에는 더하지 않고, 다시 이은 새 연결은 0부터 — 그 뒤 dropped는 새 연결에만', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    await status(w, a.token, 4)
    const first = await linkOf(w, a.seller.sellerId, a.b)
    expect(first.saveFailed).toBe(4)
    const un = await unlinkTiktok(w, a.seller, a.b)
    expect(un.status, un.text).toBe(200)
    await status(w, a.token, 5)
    const afterUnlink = await saveFailedAll(w)
    expect(afterUnlink.get(first.id)).toMatchObject({ saveFailed: 4 })
    expect(afterUnlink.get(first.id)?.state).not.toBe('LINKED')
    // 다시 잇기 (다시 연결은 30초에 한 번)
    await w.tclock.advance(31_000)
    w.webcast.failNext('SIGN_FAILED', 50)
    const again = await linkTiktok(w, a.seller, a.b)
    expect(again.status, again.text).toBe(200)
    const second = await linkOf(w, a.seller.sellerId, a.b)
    expect(second.id).not.toBe(first.id)
    expect(second.saveFailed, '끊긴 동안 보낸 dropped가 새 연결로 옮겨짐').toBe(0)
    await status(w, a.token, 6)
    const now = await saveFailedAll(w)
    expect(now.get(second.id)).toMatchObject({ saveFailed: 6 })
    expect(now.get(first.id)).toMatchObject({ saveFailed: 4 })
  })
})
