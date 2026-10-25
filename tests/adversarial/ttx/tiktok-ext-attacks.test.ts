// TTX 적대 시험 (test-domain): 크롬 확장으로 틱톡 댓글 받기 (AC-TTX-29, 함께 AC-TTX-12·13·15·16·17·18).
// 다른 판매자 토큰, 화면 아이디 위조, owner 위조, 2^53 넘는 숫자 ID, 사용자 ID 대신 아이디, 시각 칸으로 순서 당기기,
// 같은 묶음 동시에, 직접 연결 받는 중 대량 묶음, 끊기·회차 끝내기와 겹친 묶음, 51개·큰 본문, 같은 상품 동시 몰림.
// 가짜 웹캐스트·주입한 가짜 시계 — 실제 틱톡에 붙지 않는다(읽기만, 글쓰기 없음).
import { listClaims, listProducts } from '@livejjim/core'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { client, rid, waitFor, type Seller } from '../../../apps/server/test/support.ts'
import { chats, connected, DATE, linkTiktok, msgId, realBroadcast, tiktokComment, tiktokSeller, ttWorld, unlinkTiktok, type TtWorld } from '../../../apps/server/test/tiktok-live-support.ts'

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

/** 확장 요청 (raw = 본문 글자 그대로). step = 보내기 전에 가짜 시계를 이만큼 (속도 제한 창을 넘기려고) */
async function ext(w: TtWorld, method: 'GET' | 'POST', path: string, token: string | null, body?: unknown, step = 250, raw?: string): Promise<ExtResponse> {
  if (step > 0) await w.tclock.advance(step)
  const headers: Record<string, string> = { Origin: ORIGIN }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json'
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
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
  const exchanged = await ext(w, 'POST', '/ext/connect', null, { code: issued.body.code })
  expect(exchanged.status, exchanged.text).toBe(200)
  return exchanged.body.token as string
}

let counter = 0
function item(fields: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1
  return { commentId: msgId(), userId: `71020000000000${String(10_000 + counter)}`, uniqueId: `viewer_${String(counter)}`, nickname: '시청자', text: '15', ...fields }
}

const send = (w: TtWorld, token: string, items: unknown[], pageId: unknown = 'seller_kim', step = 250) => ext(w, 'POST', '/ext/tiktok/chats', token, { pageId, items }, step)
const linkView = async (w: TtWorld, cookie: string, b: string) =>
  (await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as Record<string, unknown> & { collection: Record<string, unknown> | null; extension: Record<string, unknown> | null }
const register = async (w: TtWorld, cookie: string, b: string, no: number, stock = 1) => {
  const response = await client(w, cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name: `상품${String(no)}`, price: 10_000, ...(stock === 1 ? {} : { stock }) })
  expect(response.status, response.text).toBe(200)
}
const engineState = async (w: TtWorld, sellerId: string) => (await w.server.writer.read(sellerId, DATE)).state

/** 판매자 + 동의 + 실제 회차 + 틱톡 잇기 + 확장 토큰. 직접 연결은 기본으로 막힘(서명 실패로 다시 시도 중) */
async function linked(w: TtWorld, tiktokId = 'seller_kim', direct: 'blocked' | 'connected' = 'blocked') {
  const { seller } = await tiktokSeller(w, { tiktokId })
  const b = await realBroadcast(w, seller)
  if (direct === 'blocked') w.webcast.failNext('SIGN_FAILED', 50)
  const r = await linkTiktok(w, seller, b)
  expect(r.status, r.text).toBe(200)
  if (direct === 'connected') await connected(w, seller, b)
  else await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
  const token = await connectExt(w, seller)
  return { seller, b, token, tiktokId }
}

/** 직접 연결을 막는다 (서명 실패로 다시 시도 중이 될 때까지) */
async function blockDirect(w: TtWorld, seller: Seller, b: string, tiktokId: string): Promise<void> {
  w.webcast.failNext('SIGN_FAILED', 50)
  w.webcast.openHandles(tiktokId).forEach((handle) => handle.drop())
  await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
}

const activeClaims = (s: Awaited<ReturnType<typeof engineState>>) => listClaims(s).filter((c) => c.status !== 'REJECTED' && c.status !== 'DUPLICATE')

describe('TTX 적대 — 남의 회차·화면 아이디 위조 (D-TTX-03)', () => {
  it('TD-TTX-R01: 다른 판매자 토큰으로 내 화면 아이디를 보내도 내 회차에 들어가지 않는다 — 그 판매자 것만 보고 403/409', async () => {
    const w = await world()
    const a = await linked(w, 'seller_kim')
    // B: 틱톡 연결 없음 → NOT_LINKED가 아니면 안 되고 A의 회차에 기록 0
    const { seller: bSeller } = await tiktokSeller(w, { tiktokId: 'seller_park' })
    const bToken = await connectExt(w, bSeller)
    const r1 = await send(w, bToken, [item()], 'seller_kim')
    expect([403, 409]).toContain(r1.status)
    // B가 자기 회차를 이은 뒤에도 A의 아이디로는 403
    const bb = await realBroadcast(w, bSeller)
    w.webcast.failNext('SIGN_FAILED', 50)
    await linkTiktok(w, bSeller, bb)
    const r2 = await send(w, bToken, [item()], 'seller_kim')
    expect(r2.status).toBe(403)
    expect(r2.body.error).toMatchObject({ code: 'NOT_OWN_LIVE' })
    // B 토큰으로 B 아이디 → B 회차에만
    const r3 = await send(w, bToken, [item({ text: '16' })], 'seller_park')
    expect(r3.status, r3.text).toBe(200)
    expect(r3.body.broadcast).toBe(bb)
    expect(await chats(w, a.seller.sellerId)).toHaveLength(0)
    expect((await chats(w, bSeller.sellerId)).map((c) => c.b)).toEqual([bb])
    // A의 토큰을 B 판매자 쿠키와 섞어 써도 판매자 API는 열리지 않는다
    const mixed = await w.server.app.request(`/api/broadcasts/${a.b}/tiktok`, { headers: { Authorization: `Bearer ${a.token}` } })
    expect([401, 403]).toContain(mixed.status)
  })

  it('TD-TTX-R02: 화면 아이디 변형 — 다듬기·ASCII 대소문자만 같다고 보고, 보이지 않는 글자·전각·켈빈 K·@·경로·배열·객체는 403', async () => {
    const w = await world()
    const { seller, token } = await linked(w)
    const accepted = ['seller_kim', 'SELLER_KIM', ' Seller_Kim ', 'seller_kim\n']
    const refused: unknown[] = [
      '@seller_kim',
      'seller_kim​',
      '​seller_kim',
      'ｓeller_kim',
      'seller_Kim', // 켈빈 기호 K (toLowerCase면 k가 되지만 ASCII만 소문자로)
      'SELLER_KİM',
      'seller_kim/live',
      'seller_kim?x=1',
      'seller_kim ',
      'seller_ki',
      'xseller_kim',
      ['seller_kim'],
      { toString: 'seller_kim' },
      null,
      true,
      0,
    ]
    let expected = 0
    for (const pageId of accepted) {
      const r = await send(w, token, [item()], pageId)
      expect(r.status, JSON.stringify(pageId)).toBe(200)
      expected += 1
    }
    for (const pageId of refused) {
      const r = await send(w, token, [item()], pageId)
      // 'seller_kim ' (끝 공백)은 다듬으면 같다 — 받아도 된다. 그 밖은 모두 403
      if (pageId === 'seller_kim ') {
        expect(r.status).toBe(200)
        expected += 1
        continue
      }
      expect(r.status, JSON.stringify(pageId)).toBe(403)
      expect(r.body.error).toMatchObject({ code: 'NOT_OWN_LIVE' })
    }
    expect(await chats(w, seller.sellerId)).toHaveLength(expected)
  })

  it('TD-TTX-R03: 모르는 칸 위조 — __proto__·constructor·broadcast·sellerId 칸은 묶음 전체 400, 기록 0', async () => {
    const w = await world()
    const { seller, token } = await linked(w)
    const good = JSON.stringify(item())
    const bodies = [
      `{"pageId":"seller_kim","items":[${good}],"__proto__":{"admin":true}}`,
      `{"pageId":"seller_kim","items":[${good}],"broadcast":"b-other"}`,
      `{"pageId":"seller_kim","items":[${good}],"sellerId":"x"}`,
      `{"pageId":"seller_kim","items":[${good},{"commentId":"7302999000000000001","userId":"7101","uniqueId":"v","text":"15","__proto__":{"owner":true}}]}`,
      `{"pageId":"seller_kim","items":[${good},{"commentId":"7302999000000000002","userId":"7101","uniqueId":"v","text":"15","constructor":{}}]}`,
      `{"pageId":"seller_kim","items":[${good},{"commentId":"7302999000000000003","userId":"7101","uniqueId":"v","text":"15","b":"b-other"}]}`,
    ]
    for (const raw of bodies) {
      const r = await ext(w, 'POST', '/ext/tiktok/chats', token, undefined, 250, raw)
      expect(r.status, raw.slice(-60)).toBe(400)
    }
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
  })
})

describe('TTX 적대 — owner·ID 위조 (D-TTX-14, D-TTX-05)', () => {
  it('TD-TTX-R04: owner: true 위조는 무시 — 방송자는 쓴 사람 아이디(다듬고 ASCII 소문자)로만, 비슷한 글자는 방송자가 아니다', async () => {
    const w = await world()
    const { seller, token } = await linked(w)
    const cases: [string, boolean][] = [
      ['viewer_x', false],
      ['seller_kim​', false],
      ['ｓeller_kim', false],
      ['seller_Kim', false],
      ['@seller_kim', false],
      ['SELLER_KIM', true],
      ['  seller_kim\t', true],
    ]
    const items = cases.map(([uniqueId, owner]) => item({ uniqueId, owner: !owner, text: '15' }))
    const r = await send(w, token, items)
    expect(r.status, r.text).toBe(200)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => c.owner === true)).toEqual(cases.map(([, owner]) => owner))
  })

  it('TD-TTX-R05: 2^53 넘는 ID — 숫자로 보내면 버리고(잘린 값으로 합치지 않음), 10진 글자면 그대로 서로 다른 구매자', async () => {
    const w = await world()
    const { seller, b, token } = await linked(w)
    await register(w, seller.cookie, b, 15, 5)
    // 숫자 9007199254740993은 JSON에서 ...992로 바뀐다 — 받으면 다른 사람과 합쳐질 수 있다
    const raw = `{"pageId":"seller_kim","items":[` +
      `{"commentId":9007199254740993,"userId":"7101000000000000001","uniqueId":"v1","text":"15"},` +
      `{"commentId":"7302999100000000001","userId":9007199254740993,"uniqueId":"v2","text":"15"},` +
      `{"commentId":"7302999100000000002","userId":9007199254740995,"uniqueId":"v3","text":"15"},` +
      `{"commentId":"7302999100000000003","userId":"9007199254740993","uniqueId":"v4","text":"15"},` +
      `{"commentId":"7302999100000000004","userId":"9007199254740992","uniqueId":"v5","text":"15"}]}`
    const r = await ext(w, 'POST', '/ext/tiktok/chats', token, undefined, 250, raw)
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ recorded: 2, dropped: 3 })
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => c.ch)).toEqual(['tt:9007199254740993', 'tt:9007199254740992'])
    const s = await engineState(w, seller.sellerId)
    expect(new Set(activeClaims(s).map((c) => c.buyer))).toEqual(new Set(['tt:9007199254740993', 'tt:9007199254740992']))
  })

  it('TD-TTX-R06: 사용자 ID 대신 아이디·이상한 숫자 모양 → 버림(BAD_USER_ID), 찜 0', async () => {
    const w = await world()
    const { seller, b, token } = await linked(w)
    await register(w, seller.cookie, b, 15)
    const bad: unknown[] = ['buyer_a', '@buyer_a', '', ' 7101', '7101 ', '0', '0123', '-1', '1.5', '1e5', '0x1f', '７１０１', 1.5, -3, 0, null, true, [], {}, '1'.repeat(33)]
    const items = bad.map((userId) => item({ userId, uniqueId: 'buyer_a' }))
    const noUser = item({ uniqueId: 'buyer_a' })
    delete noUser.userId
    const r = await send(w, token, [...items, noUser])
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ recorded: 0, dropped: bad.length + 1 })
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    expect(listClaims(await engineState(w, seller.sellerId))).toHaveLength(0)
  })
})

describe('TTX 적대 — 순서·중복 (D-TTX-05·06)', () => {
  it('TD-TTX-R07: 같은 묶음 10개를 동시에 + 일부만 겹친 묶음 — 댓글 ID마다 기록 하나, 응답의 기록 수 합 = 실제 기록 수', async () => {
    const w = await world()
    const { seller, token } = await linked(w)
    const pool = Array.from({ length: 12 }, (_, i) => item({ text: String(15 + (i % 3)) }))
    const batches = [pool.slice(0, 6), pool.slice(0, 6), pool.slice(3, 9), pool.slice(6, 12), pool.slice(0, 12)]
    let total = 0
    for (let round = 0; round < 2; round += 1) {
      await w.tclock.advance(1_100)
      const replies = await Promise.all(batches.map((batch) => send(w, token, batch, 'seller_kim', 0)))
      for (const reply of replies) {
        expect(reply.status, reply.text).toBe(200)
        total += reply.body.recorded as number
      }
    }
    const recorded = await chats(w, seller.sellerId)
    expect(new Set(recorded.map((c) => c.id)).size).toBe(recorded.length)
    expect(recorded).toHaveLength(12)
    expect(total).toBe(12)
  })

  it('TD-TTX-R08: 같은 댓글이 확장(막힌 동안)과 다시 붙은 직접 연결로 동시에 — 같은 ID면 기록 하나', async () => {
    const w = await world()
    const { seller, b, tiktokId } = await linked(w, 'seller_kim', 'connected')
    const token = await connectExt(w, seller)
    await register(w, seller.cookie, b, 15)
    w.webcast.failNext('SIGN_FAILED', 2)
    w.webcast.openHandles(tiktokId).forEach((handle) => handle.drop())
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    const ids = Array.from({ length: 8 }, () => msgId())
    const comment = (i: number) => ({ userId: `710100000000000${String(1000 + i)}`, uniqueId: `v${String(i)}`, text: '15' })
    // 확장 묶음을 띄워 둔 채 직접 연결이 다시 붙고 같은 ID를 받는다 (어느 쪽이 먼저든)
    const extReply = send(w, token, ids.map((commentId, i) => item({ commentId, ...comment(i) })), 'seller_kim', 0)
    await w.tclock.advance(60_000)
    await connected(w, seller, b)
    for (const [i, id] of ids.entries()) w.webcast.broadcast(tiktokId, { msgId: id, userId: comment(i).userId, uniqueId: comment(i).uniqueId, nickname: '시청자', comment: '15' })
    expect((await extReply).status).toBe(200)
    await w.server.tiktok.idle()
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => c.id).sort()).toEqual(ids.map((id) => `tt:${id}`).sort())
    const s = await engineState(w, seller.sellerId)
    expect(listProducts(s).find((p) => p.no === 15)?.winnerClaims).toHaveLength(1)
  })

  it('TD-TTX-R09: 넘어가는 순간 — 같은 시청자의 "15"가 직접 연결·확장으로 다른 ID로 두 번 와도 그 시청자의 찜은 하나, 다음 사람이 1등을 빼앗기지 않는다', async () => {
    const w = await world()
    const { seller, b, tiktokId } = await linked(w, 'seller_kim', 'connected')
    const token = await connectExt(w, seller)
    await register(w, seller.cookie, b, 15)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '에이', comment: '15' })
    // 받는 중에 확장이 같은 댓글(다른 ID)을 보냄 → 대기
    const waiting = await send(w, token, [item({ userId: '7101000000000000001', uniqueId: 'buyer_a', text: '15' })])
    expect(waiting.body).toMatchObject({ result: 'standby' })
    await blockDirect(w, seller, b, tiktokId)
    // 막힌 뒤: A의 같은 댓글(다른 ID) 두 번 + B의 "15"
    const r = await send(w, token, [
      item({ userId: '7101000000000000001', uniqueId: 'buyer_a', text: '15' }),
      item({ userId: '7101000000000000002', uniqueId: 'buyer_b', text: '15' }),
      item({ userId: '7101000000000000001', uniqueId: 'buyer_a', text: '15번' }),
    ])
    expect(r.body).toMatchObject({ result: 'recorded', recorded: 3 })
    const s = await engineState(w, seller.sellerId)
    const product = listProducts(s).find((p) => p.no === 15)
    expect(product?.winners).toEqual(['tt:7101000000000000001'])
    const active = activeClaims(s)
    expect(active.filter((c) => c.buyer === 'tt:7101000000000000001')).toHaveLength(1)
    expect(active.filter((c) => c.buyer === 'tt:7101000000000000002')).toHaveLength(1)
    expect(product?.waitlist).toEqual(['tt:7101000000000000002'])
  })

  it('TD-TTX-R10: 속성 — 시각 칸(postedAt)·owner 칸을 무작위로 넣어도 기록·판정 결과는 그 칸이 없을 때와 같다', async () => {
    const buyers = ['7101000000000000011', '7101000000000000012', '7101000000000000013', '7101000000000000014']
    const arbComment = fc.record({
      buyer: fc.integer({ min: 0, max: buyers.length - 1 }),
      no: fc.constantFrom(15, 16),
      postedAt: fc.option(fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString()), { nil: undefined }),
      owner: fc.option(fc.boolean(), { nil: undefined }),
    })
    const arbBatches = fc.array(fc.array(arbComment, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 4 })
    await fc.assert(
      fc.asyncProperty(arbBatches, async (batches) => {
        const run = async (withNoise: boolean) => {
          const w = await world()
          const { seller, b, token } = await linked(w)
          await register(w, seller.cookie, b, 15)
          await register(w, seller.cookie, b, 16, 2)
          let n = 0
          for (const batch of batches) {
            const items = batch.map((c) => {
              n += 1
              const base: Record<string, unknown> = { commentId: String(7_303_000_000_000_000_000n + BigInt(n)), userId: buyers[c.buyer], uniqueId: `b${String(c.buyer)}`, nickname: `구매자${String(c.buyer)}`, text: String(c.no) }
              if (withNoise && c.postedAt !== undefined) base.postedAt = c.postedAt
              if (withNoise && c.owner !== undefined) base.owner = c.owner
              return base
            })
            const reply = await send(w, token, items)
            expect(reply.status, reply.text).toBe(200)
          }
          const s = await engineState(w, seller.sellerId)
          const result = {
            chats: (await chats(w, seller.sellerId)).map((c) => [c.id, c.ch, c.text, c.owner === true]),
            products: listProducts(s).map((p) => [p.no, p.winners, p.waitlist]),
          }
          await w.close()
          worlds.splice(worlds.indexOf(w), 1)
          return result
        }
        const plain = await run(false)
        const noisy = await run(true)
        expect(noisy).toEqual(plain)
      }),
      { numRuns: 4, seed: 20261026 },
    )
  })
})

describe('TTX 적대 — 직접 연결 받는 중 대량 묶음 (D-TTX-07)', () => {
  it('TD-TTX-R11: 받는 중에 50개 묶음 12번 → 모두 대기, 기록·찜 0, 대기 수 600, 13번째는 429', async () => {
    const w = await world()
    const { seller, b, tiktokId } = await linked(w, 'seller_kim', 'connected')
    void tiktokId
    const token = await connectExt(w, seller)
    await register(w, seller.cookie, b, 15)
    for (let i = 0; i < 12; i += 1) {
      const r = await send(w, token, Array.from({ length: 50 }, () => item({ text: '15' })), 'seller_kim', 1_000)
      expect(r.status, r.text).toBe(200)
      expect(r.body).toMatchObject({ result: 'standby', standby: 50, recorded: 0 })
    }
    expect((await send(w, token, [item()], 'seller_kim', 1_000)).status).toBe(429)
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    expect(listClaims(await engineState(w, seller.sellerId))).toHaveLength(0)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ standby: 600, recorded: 0 })
  })
})

describe('TTX 적대 — 끊기·회차 끝내기와 겹친 묶음', () => {
  it('TD-TTX-R12: 회차를 끝내는 요청과 묶음 여럿을 겹치면 — 기록된 chat은 모두 broadcast.end 앞, 끝낸 뒤 묶음은 409 NOT_LINKED, 팝업 정보도 기록 중이 아님', async () => {
    const w = await world()
    const { seller, b, token } = await linked(w)
    await register(w, seller.cookie, b, 15)
    await w.tclock.advance(1_100)
    const sends = Array.from({ length: 4 }, () => send(w, token, Array.from({ length: 10 }, () => item()), 'seller_kim', 0))
    const end = client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
    const [ended, ...replies] = await Promise.all([end, ...sends])
    expect(ended.status, ended.text).toBe(200)
    const recordedSum = replies.reduce((sum, r) => sum + (r.status === 200 ? (r.body.recorded as number) : 0), 0)
    for (const r of replies) expect([200, 409], r.text).toContain(r.status)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded).toHaveLength(recordedSum)
    const endSeq = (await w.database.pglite?.query<{ seq: number }>(`select seq from events where seller_id = $1 and type = 'broadcast.end'`, [seller.sellerId]))?.rows[0]?.seq as number
    expect(recorded.every((c) => c.seq < endSeq)).toBe(true)
    const after = await send(w, token, [item()], 'seller_kim', 1_100)
    expect(after.status).toBe(409)
    expect(after.body.error).toMatchObject({ code: 'NOT_LINKED' })
    expect((await ext(w, 'GET', '/ext/tiktok', token, undefined, 1_100)).body).toMatchObject({ mode: 'blocked', code: 'NOT_LINKED' })
    expect(await chats(w, seller.sellerId)).toHaveLength(recordedSum)
  })

  it('TD-TTX-R13: 틱톡 끊기·확장 끊기와 묶음을 겹치면 — 답한 기록 수 = 실제 기록 수, 끊은 뒤에는 0', async () => {
    const w = await world()
    const { seller, b, token } = await linked(w)
    await w.tclock.advance(1_100)
    const sends = Array.from({ length: 4 }, () => send(w, token, Array.from({ length: 10 }, () => item()), 'seller_kim', 0))
    const [unlinked, ...replies] = await Promise.all([unlinkTiktok(w, seller, b), ...sends])
    expect(unlinked.status, unlinked.text).toBe(200)
    const sum = replies.reduce((s, r) => s + (r.status === 200 ? (r.body.recorded as number) : 0), 0)
    expect(await chats(w, seller.sellerId)).toHaveLength(sum)
    expect((await send(w, token, [item()], 'seller_kim', 1_100)).status).toBe(409)
    expect(await chats(w, seller.sellerId)).toHaveLength(sum)

    // 다시 이은 뒤 확장 연결 끊기와 겹치기
    const w2 = await world()
    const x = await linked(w2)
    await w2.tclock.advance(1_100)
    const sends2 = Array.from({ length: 4 }, () => send(w2, x.token, Array.from({ length: 10 }, () => item()), 'seller_kim', 0))
    const [off, ...replies2] = await Promise.all([client(w2, x.seller.cookie).post('/api/extension/disconnect', {}), ...sends2])
    expect(off.status, off.text).toBe(200)
    for (const r of replies2) expect([200, 401, 409], r.text).toContain(r.status)
    const sum2 = replies2.reduce((s, r) => s + (r.status === 200 ? (r.body.recorded as number) : 0), 0)
    expect(await chats(w2, x.seller.sellerId)).toHaveLength(sum2)
    expect((await send(w2, x.token, [item()], 'seller_kim', 1_100)).status).toBe(401)
  })
})

describe('TTX 적대 — 큰 묶음·큰 본문', () => {
  it('TD-TTX-R14: 51개 400·빈 목록 400·256KB 넘는 본문 413 — 기록 0', async () => {
    const w = await world()
    const { seller, token } = await linked(w)
    expect((await send(w, token, Array.from({ length: 51 }, () => item()))).status).toBe(400)
    expect((await send(w, token, [])).status).toBe(400)
    expect((await ext(w, 'POST', '/ext/tiktok/chats', token, { pageId: 'seller_kim', items: 'x'.repeat(10) })).status).toBe(400)
    const huge = await send(w, token, [item({ text: '가'.repeat(100_000) })])
    expect(huge.status).toBe(413)
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
  })

  it('TD-TTX-R15: 본문 경계(500자 이모지 받음·501자 버림)·아주 긴 닉네임은 잘려 기록·태그는 글자 그대로', async () => {
    const w = await world()
    const { seller, token } = await linked(w)
    const emoji500 = '🌵'.repeat(500)
    const emoji501 = '🌵'.repeat(501)
    const r = await send(w, token, [
      item({ text: emoji500 }),
      item({ text: emoji501 }),
      item({ text: `15${'​'.repeat(400)}` }),
      item({ nickname: '다'.repeat(20_000), text: '16' }),
      item({ nickname: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script>' }),
    ])
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ recorded: 4, dropped: 1 })
    const recorded = await chats(w, seller.sellerId)
    expect(recorded[0]?.text).toBe(emoji500)
    expect(Array.from(recorded[2]?.nick ?? '').length).toBeLessThanOrEqual(101)
    expect(recorded[3]?.text).toBe('<script>alert(1)</script>')
  })
})

describe('TTX 적대 — 같은 상품 동시 몰림', () => {
  it('TD-TTX-R16: 재고 1 상품에 30명이 묶음 5개로 동시에 → 1등 하나·중복 판매 없음·구매자 섞이지 않음', async () => {
    const w = await world()
    const { seller, b, token } = await linked(w)
    await register(w, seller.cookie, b, 15)
    await w.tclock.advance(1_100)
    const people = Array.from({ length: 30 }, (_, i) => `71015000000000${String(10_000 + i)}`)
    const batches = Array.from({ length: 5 }, (_, k) => people.slice(k * 6, k * 6 + 6).map((userId) => item({ userId, text: '15' })))
    const replies = await Promise.all(batches.map((batch) => send(w, token, batch, 'seller_kim', 0)))
    for (const r of replies) expect(r.status, r.text).toBe(200)
    const s = await engineState(w, seller.sellerId)
    const product = listProducts(s).find((p) => p.no === 15)
    expect(product?.winners).toHaveLength(1)
    // 찜은 사람마다 하나 (대기 명단 상한 밖은 엔진 규칙대로) — 남의 구매자·판매자에 섞이지 않는다
    const claims = listClaims(s).filter((c) => c.no === 15)
    expect(new Set(claims.map((c) => c.buyer))).toEqual(new Set(people.map((p) => `tt:${p}`)))
    expect(claims).toHaveLength(30)
    const all = [...(product?.winners ?? []), ...(product?.waitlist ?? [])]
    expect(new Set(all).size).toBe(all.length)
    // 1등은 가장 먼저 기록된 chat의 사람
    const first = (await chats(w, seller.sellerId))[0]
    expect(product?.winners[0]).toBe(first?.ch)
  })
})
