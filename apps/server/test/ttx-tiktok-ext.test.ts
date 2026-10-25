// TTX 크롬 확장으로 틱톡 댓글 읽기 — 서버 (PLT-02 확장 대비책, D-TTX-01~14): AC-TTX-11~19·23·30의 서버 몫.
// 확장 토큰·묶음 상한·따로 세는 속도 제한, 본인 방송 확인, 같은 거르개·같은 chat, 받는 조건(연결·운영자 스위치·동의),
// 접수순·저장 실패, 중복(같은 묶음·직접 연결과 확장 사이), 직접 연결 우선(대기), 넘어가는 순간, 확장 상태와 연결 보기, 로그.
// 가짜 웹캐스트·주입한 가짜 시계로 돈다 — 실제 틱톡에 붙지 않는다.
import { listClaims, listProducts } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { LogRecord } from '../src/log.ts'
import { EXT_TIKTOK_MESSAGES, EXT_TIKTOK_ROUTES, EXT_TIKTOK_WARNINGS } from '../src/tiktok-live/extension.ts'
import { addSeller, client, rid, waitFor, type Seller } from './support.ts'
import { chats, connected, consentOn, DATE, linkTiktok, logText, msgId, realBroadcast, tiktokComment, tiktokSeller, ttWorld, unlinkTiktok, type TtOptions, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
async function world(options: TtOptions = {}): Promise<TtWorld> {
  const w = await ttWorld(options)
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

/** 확장 요청. step = 보내기 전에 가짜 시계를 이만큼 (속도 제한 창을 넘기려고 — 0이면 그대로) */
async function ext(w: TtWorld, method: 'GET' | 'POST', path: string, token: string | null, body?: unknown, step = 250): Promise<ExtResponse> {
  if (step > 0) await w.tclock.advance(step)
  const headers: Record<string, string> = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await w.server.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text }
}

async function connectExt(w: TtWorld, seller: Seller): Promise<string> {
  const issued = await client(w, seller.cookie).post('/api/extension/code', {})
  expect(issued.status, issued.text).toBe(200)
  const exchanged = await ext(w, 'POST', '/ext/connect', null, { code: issued.body.code })
  expect(exchanged.status, exchanged.text).toBe(200)
  return exchanged.body.token as string
}

let counter = 0
/** 확장 묶음 항목 하나 (기본: 시청자 buyer_a, 본문 "15") */
function item(fields: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1
  return { commentId: msgId(), userId: `71010000000000${String(10_000 + counter)}`, uniqueId: 'buyer_a', nickname: '시청자', text: '15', ...fields }
}

const send = (w: TtWorld, token: string, items: unknown[], pageId: unknown = 'seller_kim', step = 250) => ext(w, 'POST', '/ext/tiktok/chats', token, { pageId, items }, step)
const status = (w: TtWorld, token: string, input: Record<string, unknown> = {}) => ext(w, 'POST', '/ext/tiktok/status', token, { screen: 'OWN', hidden: false, read: 1, unread: 0, ...input })

const register = async (w: TtWorld, cookie: string, b: string, no: number, price = 10_000) => {
  const response = await client(w, cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name: `상품${String(no)}`, price })
  expect(response.status, response.text).toBe(200)
}
const linkView = async (w: TtWorld, cookie: string, b: string) =>
  (await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as Record<string, unknown> & { collection: Record<string, unknown> | null; extension: Record<string, unknown> | null }
const engineState = async (w: TtWorld, sellerId: string) => (await w.server.writer.read(sellerId, DATE)).state

/**
 * 판매자 seller_kim + 동의 + 실제 회차 + 틱톡 잇기 + 확장 토큰. direct = 직접 연결 상태
 * ('blocked' = 서명 실패로 다시 시도 중, 'connected' = 받는 중)
 */
async function linkedWorld(options: { direct?: 'blocked' | 'connected'; world?: TtOptions; logs?: LogRecord[] } = {}) {
  const logs = options.logs
  const w = await world({ ...options.world, ...(logs === undefined ? {} : { overrides: { ...options.world?.overrides, log: (record: LogRecord) => logs.push(record) } }) })
  const { seller, tiktokId } = await tiktokSeller(w, { tiktokId: 'seller_kim' })
  const b = await realBroadcast(w, seller)
  if ((options.direct ?? 'blocked') === 'blocked') w.webcast.failNext('SIGN_FAILED', 9)
  const linked = await linkTiktok(w, seller, b)
  expect(linked.status, linked.text).toBe(200)
  if (options.direct === 'connected') await connected(w, seller, b)
  else await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
  const token = await connectExt(w, seller)
  return { w, seller, b, token, tiktokId }
}

describe('AC-TTX-11 확장 토큰·묶음 상한·따로 세는 속도 제한', () => {
  it('토큰 없음·끊긴 토큰 401, 51개 묶음 400, 50개는 받는다', async () => {
    const { w, seller, token } = await linkedWorld()
    expect((await ext(w, 'POST', '/ext/tiktok/chats', null, { pageId: 'seller_kim', items: [item()] })).status).toBe(401)
    expect((await ext(w, 'GET', '/ext/tiktok', 'not-a-real-token')).status).toBe(401)
    const tooMany = await send(w, token, Array.from({ length: 51 }, () => item()))
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error).toMatchObject({ code: 'INVALID_INPUT' })
    const fifty = await send(w, token, Array.from({ length: 50 }, () => item({ text: '안녕하세요' })))
    expect(fifty.status, fifty.text).toBe(200)
    expect(fifty.body).toMatchObject({ result: 'recorded', recorded: 50 })
    expect(await chats(w, seller.sellerId)).toHaveLength(50)
    await client(w, seller.cookie).post('/api/extension/disconnect', {})
    const after = await send(w, token, [item()])
    expect(after.status).toBe(401)
    expect(after.body.error).toMatchObject({ code: 'EXT_DISCONNECTED' })
    expect(await chats(w, seller.sellerId)).toHaveLength(50)
  })

  it('토큰마다 초당 6번째 틱톡 요청은 429 — 유튜브 경로의 요청 수와 따로 센다', async () => {
    const { w, token } = await linkedWorld()
    await w.tclock.advance(2_000)
    for (let i = 0; i < 5; i += 1) expect((await ext(w, 'GET', '/ext/tiktok', token, undefined, 0)).status).toBe(200)
    const sixth = await ext(w, 'GET', '/ext/tiktok', token, undefined, 0)
    expect(sixth.status).toBe(429)
    expect(sixth.body.error).toMatchObject({ code: 'EXT_RATE_LIMITED' })
    // 같은 순간 유튜브 경로(상태 보내기)는 그대로 받는다
    const youtube = await ext(w, 'POST', '/ext/status', token, { hidden: false }, 0)
    expect(youtube.status, youtube.text).toBe(200)
    // 유튜브 쪽을 다 써도 틱톡은 1초 뒤 다시 받는다
    for (let i = 0; i < 4; i += 1) await ext(w, 'POST', '/ext/status', token, { hidden: false }, 0)
    expect((await ext(w, 'POST', '/ext/status', token, { hidden: false }, 0)).status).toBe(429)
    expect((await ext(w, 'GET', '/ext/tiktok', token, undefined, 1_001)).status).toBe(200)
  })

  it('분당 600댓글을 넘으면 429 (틱톡 줄만)', async () => {
    const { w, token } = await linkedWorld()
    for (let i = 0; i < 12; i += 1) expect((await send(w, token, Array.from({ length: 50 }, () => item({ text: '안녕' })), 'seller_kim', 1_000)).status).toBe(200)
    expect((await send(w, token, [item()], 'seller_kim', 1_000)).status).toBe(429)
    expect((await ext(w, 'POST', '/ext/status', token, { hidden: false }, 0)).status).toBe(200)
  })

  it('확장 토큰으로 판매자 API를 부를 수 없다 (401) · 모르는 칸은 400', async () => {
    const { w, token } = await linkedWorld()
    for (const path of ['/api/products', '/api/broadcasts', '/api/tiktok', '/api/settlements']) {
      const response = await w.server.app.request(path, { headers: { Authorization: `Bearer ${token}` } })
      expect([401, 403], path).toContain(response.status)
    }
    expect((await ext(w, 'POST', '/ext/tiktok/chats', token, { pageId: 'seller_kim', items: [item()], broadcast: 'x' })).status).toBe(400)
    expect((await send(w, token, [{ ...item(), secUid: 'x' }])).body.error).toMatchObject({ code: 'UNKNOWN_FIELD' })
    expect((await ext(w, 'POST', '/ext/tiktok/status', token, { screen: 'MINE', hidden: false })).status).toBe(400)
  })
})

describe('AC-TTX-12 본인 방송 확인 (D-TTX-03)', () => {
  it('화면 아이디가 남의 것이거나 없으면 403 NOT_OWN_LIVE·기록 0, 대소문자만 다르면 받는다', async () => {
    const { w, seller, token } = await linkedWorld()
    for (const pageId of ['other_seller', undefined, '', 12345, 'seller_kim2']) {
      const response = await ext(w, 'POST', '/ext/tiktok/chats', token, { ...(pageId === undefined ? {} : { pageId }), items: [item()] })
      expect(response.status, String(pageId)).toBe(403)
      expect(response.body.error).toMatchObject({ code: 'NOT_OWN_LIVE', message: EXT_TIKTOK_MESSAGES.NOT_OWN_LIVE })
      expect(response.text).not.toContain('other_seller')
    }
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    const ok = await send(w, token, [item()], 'Seller_Kim')
    expect(ok.status, ok.text).toBe(200)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
  })
})

describe('AC-TTX-13 같은 거르개·같은 chat (D-TTX-06·14)', () => {
  it('id tt:<댓글 ID>, ch tt:<사용자 ID>, 이름 정리, 본문 그대로, owner는 아이디로, publishedAt 없음, at = 서버가 받은 시각', async () => {
    const { w, seller, token } = await linkedWorld()
    const viewer = item({ commentId: '7301000000000000101', userId: '7101000000000000101', uniqueId: 'buyer_a', nickname: '@pink.mom', text: ' 15번 ', owner: true, postedAt: '2020-01-01T00:00:00.000Z' })
    const host = item({ commentId: '7301000000000000102', userId: '7101000000000000900', uniqueId: ' Seller_Kim', nickname: '김사장', text: '15번 마감이요', owner: false })
    const before = w.tclock.now()
    const response = await send(w, token, [viewer, host, item({ uniqueId: undefined }), 'not-an-object', item({ userId: 'buyer_a' })])
    expect(response.status, response.text).toBe(200)
    expect(response.body).toMatchObject({ result: 'recorded', recorded: 2, dropped: 3 })
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => [c.id, c.ch, c.nick, c.text, c.owner])).toEqual([
      ['tt:7301000000000000101', 'tt:7101000000000000101', 'pink·mom', ' 15번 ', false],
      ['tt:7301000000000000102', 'tt:7101000000000000900', '김사장', '15번 마감이요', true],
    ])
    for (const c of recorded) expect(c).not.toHaveProperty('publishedAt')
    const rows = await w.database.pglite?.query<{ at: string; actor: string; source: string | null }>(`select at::text as at, actor, chat_source as source from events where seller_id = $1 and type = 'chat' order by seq`, [seller.sellerId])
    for (const row of rows?.rows ?? []) {
      expect(Number(row.at)).toBeGreaterThanOrEqual(before)
      expect(row.actor).toBe('collector')
    }
  })
})

describe('AC-TTX-14 받는 조건 — 연결·운영자 스위치·동의 (D-TTX-06·10)', () => {
  it('연결 없음·끊음·회차 끝냄 → NOT_LINKED, 기록 0', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w, { tiktokId: 'seller_kim' })
    const b = await realBroadcast(w, seller)
    const token = await connectExt(w, seller)
    const none = await send(w, token, [item()])
    expect(none.status).toBe(409)
    expect(none.body.error).toMatchObject({ code: 'NOT_LINKED', message: EXT_TIKTOK_MESSAGES.NOT_LINKED })
    expect((await ext(w, 'GET', '/ext/tiktok', token)).body).toMatchObject({ tiktokId: 'seller_kim', mode: 'blocked', code: 'NOT_LINKED', message: EXT_TIKTOK_MESSAGES.NOT_LINKED, broadcast: null })
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, seller, b)
    expect((await send(w, token, [item()])).status).toBe(200)
    await unlinkTiktok(w, seller, b)
    expect((await send(w, token, [item()])).body.error).toMatchObject({ code: 'NOT_LINKED' })
    const b2 = await realBroadcast(w, seller)
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, seller, b2)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b2}/end`, { requestId: rid('end') })).status).toBe(200)
    expect((await send(w, token, [item()])).body.error).toMatchObject({ code: 'NOT_LINKED' })
    expect((await chats(w, seller.sellerId)).map((c) => c.b)).toEqual([b])
  })

  it('운영자 스위치 꺼짐·라이브러리 환경 변수 → PLATFORM_NOT_READY, 동의 끔·옛 판 → NO_CONSENT', async () => {
    const { w, seller, token } = await linkedWorld()
    const off = await client(w, seller.cookie).post('/api/tiktok/consent', { requestId: rid('tc'), on: false })
    expect(off.status, off.text).toBe(200)
    const noConsent = await send(w, token, [item()])
    expect(noConsent.status).toBe(409)
    expect(noConsent.body.error).toMatchObject({ code: 'NO_CONSENT', message: EXT_TIKTOK_MESSAGES.NO_CONSENT })
    expect(await chats(w, seller.sellerId)).toHaveLength(0)

    const old = await world({ noticeVersion: 'TT-BETA-2' })
    const s2 = await addSeller(old)
    expect((await consentOn(old, s2, 'TT-BETA-1')).status).toBe(409)
    const t2 = await connectExt(old, s2)
    expect((await ext(old, 'GET', '/ext/tiktok', t2)).body).toMatchObject({ mode: 'blocked', code: 'NO_CONSENT' })

    for (const options of [{ beta: 'off' }, { libraryEnv: ['SIGN_API_KEY'] }] as TtOptions[]) {
      const ow = await world(options)
      const s = await addSeller(ow)
      await consentOn(ow, s)
      const t = await connectExt(ow, s)
      const response = await ext(ow, 'POST', '/ext/tiktok/chats', t, { pageId: 'x', items: [item()] })
      expect(response.status).toBe(409)
      expect(response.body.error).toMatchObject({ code: 'PLATFORM_NOT_READY', message: EXT_TIKTOK_MESSAGES.PLATFORM_NOT_READY })
      expect(await chats(ow, s.sellerId)).toHaveLength(0)
    }
  })

  it('확장이 회차를 고르지 않아도 연결 회차에 기록되고, 다른 판매자의 회차에는 어떤 경우에도 들어가지 않는다', async () => {
    const { w, seller, b, token } = await linkedWorld()
    const { seller: other } = await tiktokSeller(w, { tiktokId: 'other_seller' })
    const ob = await realBroadcast(w, other)
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, other, ob)
    // 내 토큰으로 남의 아이디를 화면 아이디로 보내도 → 403 (남의 회차로 가지 않는다)
    expect((await send(w, token, [item()], 'other_seller')).status).toBe(403)
    const mine = await send(w, token, [item({ text: '16' })])
    expect(mine.body).toMatchObject({ result: 'recorded', broadcast: b })
    expect((await chats(w, seller.sellerId)).map((c) => c.b)).toEqual([b])
    expect(await chats(w, other.sellerId)).toHaveLength(0)
  })
})

describe('AC-TTX-15 접수순·입력 우선 기록 (D-TTX-06, D-N2b-2-02)', () => {
  it('묶음 A(15·16) 뒤 묶음 B(17) → seq 15 < 16 < 17. 확장 시각을 거꾸로 넣어도 먼저 기록된 쪽이 1등', async () => {
    const { w, seller, b, token } = await linkedWorld()
    await register(w, seller.cookie, b, 15)
    await register(w, seller.cookie, b, 16)
    await register(w, seller.cookie, b, 17)
    const a = await send(w, token, [
      item({ userId: '7101000000000000001', text: '15', postedAt: '2026-10-19T03:10:00.000Z' }),
      item({ userId: '7101000000000000002', text: '16', postedAt: '2026-10-19T03:09:00.000Z' }),
    ])
    expect(a.status, a.text).toBe(200)
    const bb = await send(w, token, [item({ userId: '7101000000000000003', text: '17', postedAt: '2020-01-01T00:00:00.000Z' })])
    expect(bb.status).toBe(200)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => c.text)).toEqual(['15', '16', '17'])
    expect(recorded[0]!.seq).toBeLessThan(recorded[1]!.seq)
    expect(recorded[1]!.seq).toBeLessThan(recorded[2]!.seq)
    // 같은 상품에 두 사람: 먼저 기록된 쪽이 1등 (늦게 온 쪽이 더 이른 시각을 적어 보내도)
    await send(w, token, [item({ userId: '7101000000000000004', text: '16', postedAt: '2020-01-01T00:00:00.000Z' })])
    const s = await engineState(w, seller.sellerId)
    expect(listProducts(s).find((p) => p.no === 16)?.winnerClaims.map((id) => listClaims(s).find((c) => c.id === id)?.buyer)).toEqual(['tt:7101000000000000002'])
  })

  it('저장이 실패하면 500·기록 0 — 같은 묶음을 다시 보내면 한 번만 기록된다', async () => {
    let failing = true
    const { w, seller, token } = await linkedWorld({
      world: {
        overrides: {
          hooks: {
            beforeCommit: (records) => {
              if (failing && records.some((r) => r.type === 'chat')) throw new Error('DB 끊김 흉내')
            },
          },
        },
      },
    })
    const batch = [item({ text: '15' }), item({ text: '16' })]
    const failed = await send(w, token, batch)
    expect(failed.status).toBe(500)
    expect(failed.body.error).toMatchObject({ code: 'SAVE_FAILED' })
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    failing = false
    expect((await send(w, token, batch)).body).toMatchObject({ result: 'recorded', recorded: 2 })
    expect((await send(w, token, batch)).body).toMatchObject({ result: 'recorded', recorded: 0, duplicates: 2 })
    expect(await chats(w, seller.sellerId)).toHaveLength(2)
  })
})

describe('AC-TTX-16 중복 (D-TTX-05)', () => {
  it('같은 묶음 두 번(차례로·동시에) → chat 한 번', async () => {
    const { w, seller, token } = await linkedWorld()
    const batch = [item(), item({ text: '16' })]
    await send(w, token, batch)
    await send(w, token, batch)
    const again = [item({ text: '17' }), item({ text: '18' })]
    await w.tclock.advance(1_000)
    await Promise.all([send(w, token, again, 'seller_kim', 0), send(w, token, again, 'seller_kim', 0)])
    expect((await chats(w, seller.sellerId)).map((c) => c.text)).toEqual(['15', '16', '17', '18'])
  })

  it('직접 연결이 먼저 기록한 댓글 ID → 확장 기록 0, 확장이 먼저 기록한 ID → 직접 연결 기록 0', async () => {
    const { w, seller, b, token, tiktokId } = await linkedWorld({ direct: 'connected' })
    const first = msgId()
    await tiktokComment(w, tiktokId, { msgId: first, userId: '7101000000000000001', uniqueId: 'buyer_a', comment: '15' })
    // 직접 연결을 막는다 (서명 실패로 다시 시도) — 그 뒤 확장이 같은 ID를 보낸다
    w.webcast.failNext('SIGN_FAILED', 2)
    w.webcast.openHandles(tiktokId).forEach((handle) => handle.drop())
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    const dup = await send(w, token, [item({ commentId: first, userId: '7101000000000000001', text: '15' })])
    expect(dup.body).toMatchObject({ result: 'recorded', recorded: 0, duplicates: 1 })
    const extFirst = msgId()
    expect((await send(w, token, [item({ commentId: extFirst, userId: '7101000000000000002', text: '16' })])).body).toMatchObject({ recorded: 1 })
    // 직접 연결이 다시 받는 중이 되어 같은 ID를 받는다
    await w.tclock.advance(60_000)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { msgId: extFirst, userId: '7101000000000000002', uniqueId: 'buyer_b', comment: '16' })
    expect((await chats(w, seller.sellerId)).map((c) => c.id)).toEqual([`tt:${first}`, `tt:${extFirst}`])
  })
})

describe('AC-TTX-17 직접 연결 우선 — 받는 중이면 대기 (D-TTX-07)', () => {
  it('받는 중이면 standby·기록 0·대기 수 증가, 막히면 기록, 다시 받는 중이면 다시 standby', async () => {
    const { w, seller, b, token, tiktokId } = await linkedWorld({ direct: 'connected' })
    const waiting = await send(w, token, [item(), item({ text: '16' }), 'x'])
    expect(waiting.status, waiting.text).toBe(200)
    expect(waiting.body).toMatchObject({ result: 'standby', recorded: 0, standby: 2, dropped: 1, message: EXT_TIKTOK_MESSAGES.STANDBY })
    expect((await ext(w, 'GET', '/ext/tiktok', token)).body).toMatchObject({ mode: 'standby', code: null })
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ standby: 2, recorded: 0 })

    w.webcast.failNext('SIGN_FAILED', 2)
    w.webcast.openHandles(tiktokId).forEach((handle) => handle.drop())
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    expect((await send(w, token, [item({ text: '17' })])).body).toMatchObject({ result: 'recorded', recorded: 1 })
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ standby: 2, recorded: 1 })

    await w.tclock.advance(60_000)
    await connected(w, seller, b)
    expect((await send(w, token, [item({ text: '18' })])).body).toMatchObject({ result: 'standby', standby: 1 })
    expect((await chats(w, seller.sellerId)).map((c) => c.text)).toEqual(['17'])
  })

  it('잇는 중·방송 전(NOT_LIVE)·멈춤(STOPPED)이면 확장 댓글을 기록한다', async () => {
    // 방송 전: 계정이 OFFLINE
    const w = await world()
    const { seller } = await tiktokSeller(w, { tiktokId: 'seller_kim', account: 'OFFLINE' })
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await waitFor(async () => {
      await w.tclock.advance(0)
      return (await linkView(w, seller.cookie, b)).collection?.reason === 'NOT_LIVE'
    })
    const token = await connectExt(w, seller)
    expect((await send(w, token, [item()])).body).toMatchObject({ result: 'recorded', recorded: 1 })
    // 잇는 중: 답하지 않는 연결
    const w2 = await world()
    const { seller: s2 } = await tiktokSeller(w2, { tiktokId: 'seller_kim' })
    const b2 = await realBroadcast(w2, s2)
    w2.webcast.hold()
    await linkTiktok(w2, s2, b2)
    const t2 = await connectExt(w2, s2)
    expect((await linkView(w2, s2.cookie, b2)).collection?.state).toBe('CONNECTING')
    expect((await send(w2, t2, [item()])).body).toMatchObject({ result: 'recorded', recorded: 1 })
    // 멈춤: 그런 아이디 없음
    const w3 = await world()
    const { seller: s3 } = await tiktokSeller(w3, { tiktokId: 'seller_kim', account: 'MISSING' })
    const b3 = await realBroadcast(w3, s3)
    await linkTiktok(w3, s3, b3)
    await waitFor(async () => {
      await w3.tclock.advance(0)
      return (await linkView(w3, s3.cookie, b3)).collection?.state === 'STOPPED'
    })
    const t3 = await connectExt(w3, s3)
    expect((await send(w3, t3, [item()])).body).toMatchObject({ result: 'recorded', recorded: 1 })
  })
})

describe('AC-TTX-18 넘어가는 순간 (D-TTX-05·07, R-6)', () => {
  it('직접 연결로 기록된 A의 "15" 뒤 막히고, 같은 댓글이 다른 ID로 확장에서 옴 → 상품 15의 A 찜은 하나, 다른 구매자 없음', async () => {
    const { w, seller, b, token, tiktokId } = await linkedWorld({ direct: 'connected' })
    await register(w, seller.cookie, b, 15)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '에이', comment: '15' })
    w.webcast.failNext('SIGN_FAILED', 9)
    w.webcast.openHandles(tiktokId).forEach((handle) => handle.drop())
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    expect((await send(w, token, [item({ userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '에이', text: '15' })])).body).toMatchObject({ recorded: 1 })
    const s = await engineState(w, seller.sellerId)
    expect(await chats(w, seller.sellerId)).toHaveLength(2)
    const claims = listClaims(s).filter((c) => c.status !== 'REJECTED' && c.status !== 'DUPLICATE')
    expect(claims.map((c) => c.buyer)).toEqual(['tt:7101000000000000001'])
    expect(listProducts(s).find((p) => p.no === 15)?.winnerClaims).toHaveLength(1)
  })
})

describe('AC-TTX-19 확장 상태와 연결 보기 (D-TTX-09)', () => {
  it('상태가 한 번도 없으면 없음(받는 길 줄 없음) → 내 방송 화면이면 "확장으로 받는 중" → 30초 넘게 없으면 조용함', async () => {
    const { w, seller, b, token } = await linkedWorld()
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'NONE', active: false, route: null, warning: null, statusAt: null })
    const reply = await status(w, token)
    expect(reply.status, reply.text).toBe(200)
    expect(reply.body).toMatchObject({ tiktokId: 'seller_kim', mode: 'recording', code: null, message: EXT_TIKTOK_MESSAGES.RECORDING, broadcast: b })
    await send(w, token, [item()])
    const view = (await linkView(w, seller.cookie, b)).extension
    expect(view).toMatchObject({ state: 'RECEIVING', active: true, route: EXT_TIKTOK_ROUTES.EXTENSION, warning: null, screen: 'OWN', recorded: 1, standby: 0, unread: 0 })
    expect(typeof view?.statusAt).toBe('string')
    const published = w.published.length
    await w.tclock.advance(31_000)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'STALE', active: false, route: null, warning: EXT_TIKTOK_WARNINGS.STALE })
    // 조용해지는 때를 실시간으로 알린다
    await waitFor(() => w.published.slice(published).some((p) => (p.data.link as { extension?: { state?: string } } | undefined)?.extension?.state === 'STALE'))
  })

  it('뒤로 감·다른 화면·1분 동안 읽지 못함만 → 각 경고, 직접 연결이 받는 중이면 "서버 연결로 받는 중 · 확장은 대기 중"', async () => {
    const { w, seller, b, token } = await linkedWorld()
    await status(w, token, { hidden: true })
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'HIDDEN', active: false, warning: EXT_TIKTOK_WARNINGS.HIDDEN })
    for (const screen of ['OTHER', 'ELSEWHERE']) {
      await status(w, token, { screen })
      expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'ELSEWHERE', screen, warning: EXT_TIKTOK_WARNINGS.ELSEWHERE })
    }
    await status(w, token, { read: 0, unread: 1 })
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'RECEIVING', unread: 1 })
    for (let i = 0; i < 6; i += 1) {
      await w.tclock.advance(10_000)
      await status(w, token, { read: 0, unread: 2 + i })
    }
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'UNREADABLE', active: false, warning: EXT_TIKTOK_WARNINGS.UNREADABLE, unread: 7 })
    await status(w, token, { read: 1, unread: 7 })
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'RECEIVING', active: true })

    const c = await linkedWorld({ direct: 'connected' })
    expect((await linkView(c.w, c.seller.cookie, c.b)).extension).toMatchObject({ state: 'NONE', route: null })
    await status(c.w, c.token)
    expect((await linkView(c.w, c.seller.cookie, c.b)).extension).toMatchObject({ state: 'STANDBY', active: false, route: EXT_TIKTOK_ROUTES.DIRECT_STANDBY, warning: null })
    await c.w.tclock.advance(31_000)
    expect((await linkView(c.w, c.seller.cookie, c.b)).extension).toMatchObject({ state: 'STALE', route: EXT_TIKTOK_ROUTES.DIRECT, warning: null })
  })

  it('동의를 끄면 받는 중이 아니다 · 확장 연결을 끊으면 상태를 비운다(없음)', async () => {
    const { w, seller, b, token } = await linkedWorld()
    await status(w, token)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ active: true })
    await client(w, seller.cookie).post('/api/tiktok/consent', { requestId: rid('tc'), on: false })
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ active: false, route: null })
    expect((await status(w, token)).body).toMatchObject({ mode: 'blocked', code: 'NO_CONSENT' })
    await consentOn(w, seller)
    await client(w, seller.cookie).post('/api/extension/disconnect', {})
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'NONE', statusAt: null, route: null })
  })

  it('연결이 없을 때 보낸 상태는 어디에도 두지 않는다 · 아이디가 없으면 NO_TIKTOK_ID', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await consentOn(w, seller)
    const token = await connectExt(w, seller)
    expect((await status(w, token)).body).toMatchObject({ tiktokId: null, mode: 'blocked', code: 'NO_TIKTOK_ID', message: EXT_TIKTOK_MESSAGES.NO_TIKTOK_ID })
    expect((await send(w, token, [item()])).body.error).toMatchObject({ code: 'NOT_LINKED' })
  })
})

describe('AC-TTX-23 로그에 값이 없다 (D-TTX-13)', () => {
  it('닉네임·본문·아이디·토큰이 로그에 없고, 태그 닉네임은 글자로 기록된다', async () => {
    const logs: LogRecord[] = []
    let failing = true
    const { w, seller, token } = await linkedWorld({
      logs,
      world: { overrides: { hooks: { beforeCommit: (records) => { if (failing && records.some((r) => r.type === 'chat')) throw new Error('x') } } } },
    })
    const evil = item({ uniqueId: 'secret_viewer', nickname: '<img src=x onerror=alert(1)>', text: '비밀본문 15' })
    expect((await send(w, token, [evil])).status).toBe(500)
    failing = false
    await send(w, token, [evil, item({ nickname: '<script>alert(1)</script>', text: '16' })])
    await send(w, token, [item()], 'other_seller')
    const text = logText(logs)
    for (const secret of ['secret_viewer', 'onerror', '<script>', '비밀본문', 'seller_kim', 'other_seller', token]) expect(text, secret).not.toContain(secret)
    expect(logs.some((l) => l.code === 'TTX_SAVE_FAILED')).toBe(true)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => c.nick).every((nick) => typeof nick === 'string')).toBe(true)
  })
})

describe('AC-TTX-30 확장으로 받은 chat = 직접 연결로 받은 chat (D-TTX-12)', () => {
  it('같은 이벤트 모양·같은 출처(other)·같은 조치자 — 경로로 다르지 않다', async () => {
    const { w, seller, b, token, tiktokId } = await linkedWorld({ direct: 'connected' })
    await tiktokComment(w, tiktokId, { userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '에이', comment: '15' })
    w.webcast.failNext('SIGN_FAILED', 9)
    w.webcast.openHandles(tiktokId).forEach((handle) => handle.drop())
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    await send(w, token, [item({ userId: '7101000000000000002', uniqueId: 'buyer_b', nickname: '비', text: '16' })])
    const rows = await w.database.pglite?.query<{ body: string; actor: string; source: string | null; youtube: boolean | null }>(
      `select body, actor, chat_source as source from events where seller_id = $1 and type = 'chat' order by seq`,
      [seller.sellerId],
    )
    expect(rows?.rows).toHaveLength(2)
    const [direct, viaExt] = rows?.rows ?? []
    expect(viaExt?.actor).toBe(direct?.actor)
    expect(viaExt?.source).toBe(direct?.source)
    expect(viaExt?.source).toBe('other')
    expect(Object.keys(JSON.parse(viaExt!.body) as object).sort()).toEqual(Object.keys(JSON.parse(direct!.body) as object).sort())
  })
})
