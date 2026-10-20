// N2 적대 테스트 (test-domain): 감사 DM·DM 동의 (AC-N2-41·47·48). 가짜 메타 서버(127.0.0.1)·주입한 시계, 실행기는 drain()으로 돌린다.
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { callback, connectedShop, igWorld, linkLive, liveBroadcast, register, sendComments, type IgWorld, type Shop } from '../../../apps/server/test/instagram-support.ts'
import { client } from '../../../apps/server/test/support.ts'

installNetworkGuard()

let ig: IgWorld | null = null
let restoreFetch: (() => void) | null = null
afterEach(async () => {
  restoreFetch?.()
  restoreFetch = null
  await ig?.close()
  ig = null
})

interface RowView {
  readonly id: number
  readonly comment: string | null
  readonly status: string
  readonly reason: string | null
}

async function rows(w: IgWorld, s: Shop): Promise<RowView[]> {
  const response = await client(w, s.seller.cookie).get('/api/instagram/dms?date=2026-10-19')
  expect(response.status).toBe(200)
  return response.body.rows as RowView[]
}

/** 메타로 가는 연결이 거절된다(ECONNREFUSED — 요청이 메타에 닿지 않았다). match에 맞는 요청을 times번 */
function refuseConnections(match: (url: string, method: string) => boolean, times: number): { refused: () => number } {
  const original = globalThis.fetch
  let left = times
  let refused = 0
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (left > 0 && match(url, (init?.method ?? 'GET').toUpperCase())) {
      left -= 1
      refused += 1
      const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED', syscall: 'connect' })
      return Promise.reject(new TypeError('fetch failed', { cause }))
    }
    return original(input, init)
  }) as typeof fetch
  restoreFetch = () => {
    globalThis.fetch = original
  }
  return { refused: () => refused }
}

describe('N2 감사 DM 다시 시도', () => {
  it('TD-N2-002: 보내기 연결이 거절되면(ECONNREFUSED — 메타에 닿지 않음) 네트워크 오류로 다시 시도한다, "보냈는지 모름(UNCONFIRMED)"으로 멈추지 않는다 (AC-N2-47)', async () => {
    ig = await igWorld()
    const w = ig
    const shop = await connectedShop(w, { username: 'my.shop', consent: true })
    const b = await liveBroadcast(w, shop.seller)
    const live = w.fake.startLive(shop.account.id)
    await linkLive(w, shop.seller, b, live)
    await register(w, shop.seller, b, 15, '핑크프릴', 10000)
    // 잠깐 네트워크가 끊겼다: 보내기와 그 뒤 대화 조회가 모두 연결 거절 (요청은 메타에 닿지 않았다)
    const fault = refuseConnections((url) => url.startsWith(w.fake.url) && (url.includes('/messages') || url.includes('/conversations')), 2)
    expect((await sendComments(w, shop.account, live, [{ id: '501', igsid: '6024400000000001', username: 'pink.mom', text: '15' }])).status).toBe(200)
    await w.server.instagram.dms.drain()
    expect(fault.refused()).toBeGreaterThanOrEqual(1)
    expect(w.fake.dms).toEqual([])
    const after = await rows(w, shop)
    expect(after.map((row) => [row.status, row.reason])).toEqual([['WAITING', 'RETRY']])
    // 네트워크가 돌아오면 2초 뒤 다시 보낸다 — DM 1
    w.clock.advance(2000)
    await w.server.instagram.dms.drain()
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['501'])
    expect((await rows(w, shop)).map((row) => row.status)).toEqual(['SENT'])
  })
})

describe('N2 DM 동의와 메시지 권한 다시 묻기', () => {
  it('회귀: 메시지 권한 없이 연결 → 동의 켜기는 승인 주소 → 메시지 권한을 허락하고 돌아오면 그때 켜진다 (AC-N2-41)', async () => {
    ig = await igWorld()
    const w = ig
    const shop = await connectedShop(w, { declined: ['instagram_manage_messages'] })
    const api = client(w, shop.seller.cookie)
    expect(((await api.get('/api/instagram')).body.connection as { permissions: { messages: boolean } }).permissions.messages).toBe(false)
    const asked = await api.post('/api/instagram/consent', { on: true })
    expect(asked.status, asked.text).toBe(200)
    expect(asked.body.permissionRequired).toBe(true)
    expect((asked.body.connection as { consent: { on: boolean } }).consent.on).toBe(false)
    w.fake.setLogin({ decision: 'approve', accounts: [shop.account.id], declined: [] })
    const code = await callback(w, shop.seller.cookie, await w.fake.authorize(asked.body.url as string))
    expect(code).toBe('CONSENT_ON')
    const view = (await api.get('/api/instagram')).body.connection as { status: string; permissions: { comments: boolean; messages: boolean }; consent: { on: boolean } }
    expect(view).toMatchObject({ status: 'CONNECTED', permissions: { comments: true, messages: true }, consent: { on: true } })
  })

  it('회귀: 메시지 권한을 다시 물을 때 댓글 권한을 빼고 허락해도 이미 있던 연결(연결됨·댓글 권한)은 그대로다', async () => {
    ig = await igWorld()
    const w = ig
    const shop = await connectedShop(w, { declined: ['instagram_manage_messages'] })
    const api = client(w, shop.seller.cookie)
    const asked = await api.post('/api/instagram/consent', { on: true })
    w.fake.setLogin({ decision: 'approve', accounts: [shop.account.id], declined: ['instagram_manage_comments'] })
    expect(await callback(w, shop.seller.cookie, await w.fake.authorize(asked.body.url as string))).toBe('NO_COMMENT_PERMISSION')
    const view = (await api.get('/api/instagram')).body.connection as { status: string; permissions: { comments: boolean; messages: boolean }; consent: { on: boolean } }
    expect(view).toMatchObject({ status: 'CONNECTED', permissions: { comments: true, messages: false }, consent: { on: false } })
  })
})
