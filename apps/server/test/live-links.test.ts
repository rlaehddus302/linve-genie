// N2 플랫폼 공통 연결·라이브 잇기 (AC-N2-01~04·20~24·37, D-N2-02·D-N2-05·D-N2-08·D-N2-12).
import { afterEach, describe, expect, it } from 'vitest'
import { PLATFORM_KEY_MAX, platformCapabilities, platformOfKey, prefixedKey } from '../src/platform.ts'
import { chatEvents, connectedShop, igWorld, linkLive, liveBroadcast, register, sendComments, type IgWorld } from './instagram-support.ts'
import { addSeller, client, rid } from './support.ts'

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})
async function world(options: Parameters<typeof igWorld>[0] = {}): Promise<IgWorld> {
  ig = await igWorld(options)
  return ig
}

describe('AC-N2-01 플랫폼 값과 키 접두어', () => {
  it.each([
    ['ig:6024400000000001', 'INSTAGRAM'],
    ['ig:01012345678', 'INSTAGRAM'],
    ['tt:1', 'TIKTOK'],
    ['sms:s1', null],
    ['UC_A', 'YOUTUBE'],
    ['sim_a1', 'YOUTUBE'],
  ])('%s → %s', (key, platform) => {
    expect(platformOfKey(key)).toBe(platform)
  })

  it('메타가 준 값 그대로 접두어만 붙인다. 비었거나 문자열이 아니거나 256자를 넘으면 null', () => {
    expect(prefixedKey('ig:', '6024400000000001')).toBe('ig:6024400000000001')
    expect(prefixedKey('ig:', ' 00 12 ')).toBe('ig: 00 12 ')
    expect(prefixedKey('ig:', '')).toBeNull()
    expect(prefixedKey('ig:', 12)).toBeNull()
    expect(prefixedKey('ig:', 'x'.repeat(PLATFORM_KEY_MAX - 3))?.length).toBe(256)
    expect(prefixedKey('ig:', 'x'.repeat(PLATFORM_KEY_MAX - 2))).toBeNull()
  })
})

describe('AC-N2-02 플랫폼 능력 조회', () => {
  it('YOUTUBE·INSTAGRAM·TIKTOK의 값과 이유 문장 (로그인 필요)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    expect((await client(w, null).get('/api/platforms')).status).toBe(401)
    const platforms = (await client(w, seller.cookie).get('/api/platforms')).body.platforms
    expect(platforms).toEqual(platformCapabilities({ youtube: false, instagram: true }))
    expect(platforms).toEqual([
      { platform: 'YOUTUBE', ready: false, receivedTime: true, thanks: 'PUBLIC_CHAT', videoComment: true, reasons: { ready: '유튜브 라이브는 아직 이 서버에서 이을 수 없어요.' } },
      {
        platform: 'INSTAGRAM',
        ready: true,
        receivedTime: false,
        thanks: 'DM_PER_COMMENT',
        videoComment: false,
        reasons: { receivedTime: '인스타그램 라이브는 댓글마다의 시각이 없어 실제 시각순으로 판정할 수 없어요.', videoComment: '인스타그램에는 공개 댓글로 감사를 남길 수 없어요.' },
      },
      {
        platform: 'TIKTOK',
        ready: false,
        receivedTime: false,
        thanks: 'NONE',
        videoComment: false,
        reasons: { ready: '틱톡 라이브는 아직 지원하지 않아요.', receivedTime: '틱톡 라이브는 아직 지원하지 않아요.', thanks: '틱톡 라이브는 아직 지원하지 않아요.', videoComment: '틱톡 라이브는 아직 지원하지 않아요.' },
      },
    ])
  })
})

describe('AC-N2-03 한 회차에 플랫폼 하나 — 잇기 공통 규칙', () => {
  it('조회·받지 않는 경우·엔진 이벤트가 아님·같은 요청 번호 한 번', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    expect((await api.get(`/api/broadcasts/${b}/live`)).body.link).toMatchObject({ broadcast: b, platform: null, state: 'NONE', liveId: null })
    const seqBefore = (await api.get('/api/days/2026-10-19')).body.seq
    const requestId = rid('wait')
    const waited = await api.post(`/api/broadcasts/${b}/live/wait`, { requestId, platform: 'INSTAGRAM' })
    expect(waited.status).toBe(200)
    expect(waited.body.link).toMatchObject({ platform: 'INSTAGRAM', state: 'WAITING', liveId: null, actor: { kind: 'account', loginId: seller.loginId }, accountId: account.id, linkedAt: new Date(w.clock.now()).toISOString() })
    // 같은 요청 번호 → 처음 응답, 한 번만
    expect((await api.post(`/api/broadcasts/${b}/live/wait`, { requestId, platform: 'INSTAGRAM' })).body).toEqual(waited.body)
    // 이미 끊지 않은 연결 → ALREADY_LINKED
    const again = await api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('wait'), platform: 'INSTAGRAM' })
    expect(again.status).toBe(409)
    expect(again.body.error).toEqual({ code: 'ALREADY_LINKED', message: '이 방송에는 이미 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.' })
    // 엔진 이벤트가 아니다 — seq 그대로
    expect((await api.get('/api/days/2026-10-19')).body.seq).toBe(seqBefore)
    // 다른 판매자·없는 회차: 404
    const other = await addSeller(w)
    expect((await client(w, other.cookie).get(`/api/broadcasts/${b}/live`)).status).toBe(404)
    expect((await client(w, other.cookie).post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(404)
    expect((await api.post('/api/broadcasts/nope/live/wait', { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(404)
  })

  it('리허설 회차 REHEARSAL, 끝난 회차 ENDED', async () => {
    const w = await world()
    const { seller } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const rehearsal = (await api.post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-19', rehearsal: true })).body.broadcast as { id: string }
    expect((await api.post(`/api/broadcasts/${rehearsal.id}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).body.error).toEqual({ code: 'REHEARSAL', message: '리허설 방송에는 라이브를 이을 수 없어요.' })
    const b = await liveBroadcast(w, seller)
    expect((await api.post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    expect((await api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).body.error).toEqual({ code: 'ENDED', message: '끝난 방송에는 라이브를 이을 수 없어요.' })
  })

  it('같은 회차에 두 요청이 동시에 와도 하나만 받는다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    const results = await Promise.all([
      api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' }),
      api.post(`/api/broadcasts/${b}/live/link`, { requestId: rid('l'), platform: 'INSTAGRAM', liveId: live }),
      api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' }),
    ])
    expect(results.filter((result) => result.status === 200)).toHaveLength(1)
    expect(results.filter((result) => (result.body.error as { code?: string } | undefined)?.code === 'ALREADY_LINKED')).toHaveLength(2)
    const rows = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from live_links where broadcast_id = $1 and state <> 'UNLINKED'`, [b])
    expect(rows?.rows[0]?.n).toBe(1)
  })

  it('DB 유일 제약: 끊지 않은 연결 둘을 직접 넣어도 막는다', async () => {
    const w = await world()
    const { seller } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    const insert = `insert into live_links (seller_id, broadcast_id, platform, state, actor, linked_at, created_at) values ($1, $2, 'INSTAGRAM', 'WAITING', 'server', now(), now())`
    await w.database.pglite?.query(insert, [seller.sellerId, b])
    await expect(w.database.pglite?.query(insert, [seller.sellerId, b])).rejects.toMatchObject({ code: '23505' })
  })
})

describe('AC-N2-04 틱톡 자리', () => {
  it('틱톡 기다리기·잇기 → PLATFORM_NOT_SUPPORTED, 아무것도 저장하지 않고 외부 주소를 부르지 않는다', async () => {
    const w = await world()
    const { seller } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const calls = w.fake.calls.length
    for (const [path, extra] of [
      ['wait', {}],
      ['link', { liveId: '123' }],
    ] as const) {
      const result = await api.post(`/api/broadcasts/${b}/live/${path}`, { requestId: rid('t'), platform: 'TIKTOK', ...extra })
      expect(result.status).toBe(409)
      expect(result.body.error).toEqual({ code: 'PLATFORM_NOT_SUPPORTED', message: '틱톡 라이브는 아직 지원하지 않아요.' })
    }
    expect(w.fake.calls.length).toBe(calls)
    const rows = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from live_links`)
    expect(rows?.rows[0]?.n).toBe(0)
  })
})

describe('AC-N2-20 진행 중 라이브 목록', () => {
  it('진행 중 라이브만(0·1·2개, 끝난 라이브·다른 계정 라이브 빼고), 이어진 회차와 함께', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const other = w.fake.addAccount({ username: 'other.shop' })
    const api = client(w, seller.cookie)
    expect((await api.get('/api/instagram/lives')).body).toEqual({ lives: [] })
    const one = w.fake.startLive(account.id)
    w.fake.startLive(other.id)
    const ended = w.fake.startLive(account.id)
    w.fake.endLive(ended)
    expect((await api.get('/api/instagram/lives')).body.lives).toEqual([{ id: one, startedAt: new Date(w.clock.now()).toISOString(), broadcast: null }])
    const two = w.fake.startLive(account.id)
    const b = await liveBroadcast(w, seller)
    await linkLive(w, seller, b, one)
    expect((await api.get('/api/instagram/lives')).body.lives).toEqual([
      { id: one, startedAt: expect.any(String), broadcast: b },
      { id: two, startedAt: expect.any(String), broadcast: null },
    ])
  })

  it('연결 안 됨·다시 연결 필요면 메타를 부르지 않고 그 상태 코드', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const before = w.fake.count('liveMedia')
    expect((await client(w, seller.cookie).get('/api/instagram/lives')).body.error).toMatchObject({ code: 'NOT_CONNECTED' })
    const shop = await connectedShop(w)
    await w.server.instagram.connections.markReconnect(shop.seller.sellerId)
    expect((await client(w, shop.seller.cookie).get('/api/instagram/lives')).body.error).toMatchObject({ code: 'RECONNECT_NEEDED' })
    expect(w.fake.count('liveMedia')).toBe(before)
  })
})

describe('AC-N2-21 잇기 조건 — 실제 시각순은 막는다', () => {
  it('RECEIVED_TIME 스냅샷 회차 → 거절·연결 없음, 같은 날 ARRIVAL 회차는 이어진다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const live = w.fake.startLive(account.id)
    const received = await liveBroadcast(w, seller, { 'contention.policy': 'RECEIVED_TIME' })
    const message = "인스타그램 라이브는 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요."
    for (const [path, extra] of [
      ['link', { liveId: live }],
      ['wait', {}],
    ] as const) {
      const result = await api.post(`/api/broadcasts/${received}/live/${path}`, { requestId: rid('x'), platform: 'INSTAGRAM', ...extra })
      expect(result.body.error).toEqual({ code: 'RECEIVED_TIME_NOT_ALLOWED', message })
    }
    expect((await api.get(`/api/broadcasts/${received}/live`)).body.link).toMatchObject({ state: 'NONE' })
    const arrival = await liveBroadcast(w, seller, { 'contention.policy': 'ARRIVAL' })
    await linkLive(w, seller, arrival, live)
    expect((await api.get(`/api/broadcasts/${arrival}/live`)).body.link).toMatchObject({ state: 'LINKED', liveId: live, accountId: account.id, actor: { kind: 'account', loginId: seller.loginId } })
  })

  it('진행 중인 내 라이브가 아니면 NOT_LIVE (끝난 라이브·다른 판매자 라이브), 다른 회차에 이어진 라이브는 LIVE_TAKEN', async () => {
    const w = await world()
    const x = await connectedShop(w)
    const y = await connectedShop(w)
    const api = client(w, x.seller.cookie)
    const b1 = await liveBroadcast(w, x.seller)
    const b2 = await liveBroadcast(w, x.seller)
    const yLive = w.fake.startLive(y.account.id)
    const notLive = { code: 'NOT_LIVE', message: '진행 중인 내 인스타그램 라이브만 이을 수 있어요.' }
    expect((await api.post(`/api/broadcasts/${b1}/live/link`, { requestId: rid('l'), platform: 'INSTAGRAM', liveId: yLive })).body.error).toEqual(notLive)
    const done = w.fake.startLive(x.account.id)
    w.fake.endLive(done)
    expect((await api.post(`/api/broadcasts/${b1}/live/link`, { requestId: rid('l'), platform: 'INSTAGRAM', liveId: done })).body.error).toEqual(notLive)
    const live = w.fake.startLive(x.account.id)
    await linkLive(w, x.seller, b1, live)
    expect((await api.post(`/api/broadcasts/${b2}/live/link`, { requestId: rid('l'), platform: 'INSTAGRAM', liveId: live })).body.error).toEqual({ code: 'LIVE_TAKEN', message: '이미 다른 방송에 이어진 인스타그램 라이브예요.' })
  })

  it('동시에 두 회차에 같은 라이브를 이어도 하나만', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const live = w.fake.startLive(account.id)
    const b1 = await liveBroadcast(w, seller)
    const b2 = await liveBroadcast(w, seller)
    const results = await Promise.all([b1, b2].map((b) => api.post(`/api/broadcasts/${b}/live/link`, { requestId: rid('l'), platform: 'INSTAGRAM', liveId: live })))
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  })
})

describe('AC-N2-22 인스타그램 기다리기 — 첫 댓글에 저절로 잇기', () => {
  it('20:00 기다리기 → 20:03 첫 댓글 "15" → 이어지고 그 댓글부터 기록, 15번 1등. 같은 요청의 다음 댓글도', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    await register(w, seller, b, 15, '핑크프릴', 10000)
    w.clock.set(Date.UTC(2026, 9, 19, 11, 0, 0))
    expect((await api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(200)
    expect((await api.get(`/api/broadcasts/${b}/live`)).body.link).toMatchObject({ state: 'WAITING', collection: { state: 'WAITING', message: '인스타그램 라이브를 기다리는 중이에요. 라이브를 시작하면 첫 댓글부터 받아요.' } })
    // 기다리는 동안에도 판매는 평소대로
    expect((await api.post('/api/events', { requestId: rid('sms'), type: 'sms', b, no: 15, received: '19:59' })).status).toBe(200)
    w.clock.set(Date.UTC(2026, 9, 19, 11, 3, 0))
    const live = w.fake.startLive(account.id)
    const sent = await sendComments(w, account, live, [
      { igsid: '6024400000000001', username: 'pink.mom', text: '15' },
      { igsid: '6024400000000002', username: 'dayook', text: '안녕하세요' },
    ])
    expect(sent.status).toBe(200)
    const link = (await api.get(`/api/broadcasts/${b}/live`)).body.link as Record<string, unknown>
    expect(link).toMatchObject({ state: 'LINKED', liveId: live, actor: { kind: 'server', loginId: null }, accountId: account.id, linkedAt: new Date(Date.UTC(2026, 9, 19, 11, 3, 0)).toISOString() })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).toEqual(sent.changes.map((change) => `ig:${(change.value as { id: string }).id}`))
    const view = (await api.get('/api/days/2026-10-19')).body as { products: { key: string; winners: string[]; waitlist: string[] }[] }
    // 문자찜(19:59, 접수순 먼저)이 1등, 인스타 댓글은 대기
    expect(view.products.find((product) => product.key === `${b}/15`)).toMatchObject({ waitlist: ['ig:6024400000000001'] })
  })

  it('기다리는 회차가 둘 이상이면 잇지 않고 기록하지 않으며 MANY_WAITING으로 센다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b1 = await liveBroadcast(w, seller)
    const b2 = await liveBroadcast(w, seller)
    for (const b of [b1, b2]) expect((await api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(200)
    const live = w.fake.startLive(account.id)
    expect((await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '15' }])).status).toBe(200)
    expect(await chatEvents(w, seller.sellerId)).toEqual([])
    expect((await api.get(`/api/broadcasts/${b1}/live`)).body.link).toMatchObject({ state: 'WAITING' })
    const notice = w.published.find((item) => item.data.code === 'MANY_WAITING')?.data
    expect(notice).toMatchObject({ kind: 'NOTICE', code: 'MANY_WAITING', message: '인스타그램을 기다리는 방송이 둘 이상이라 고르지 못했어요. 하나에 이어 주세요.', count: 1 })
    expect((await api.get('/api/instagram/unlinked')).body.lives).toEqual([{ platform: 'INSTAGRAM', liveId: live, count: 1, firstAt: expect.any(String), lastAt: expect.any(String) }])
  })

  it('한 라이브로 1부·2부: b1을 끝낸 뒤의 댓글은 기다리던 b2에 이어지고 b2에만 기록된다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b1 = await liveBroadcast(w, seller)
    const b2 = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b1, live)
    expect((await api.post(`/api/broadcasts/${b2}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(200)
    await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '1부 댓글' }])
    expect((await api.post(`/api/broadcasts/${b1}/end`, { requestId: rid('end') })).status).toBe(200)
    await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '2부 댓글' }])
    const events = await chatEvents(w, seller.sellerId)
    expect(events.map((event) => [event.b, event.text])).toEqual([
      [b1, '1부 댓글'],
      [b2, '2부 댓글'],
    ])
    expect((await api.get(`/api/broadcasts/${b2}/live`)).body.link).toMatchObject({ state: 'LINKED', liveId: live, actor: { kind: 'server' } })
    expect((await api.get(`/api/broadcasts/${b1}/live`)).body.link).toMatchObject({ state: 'LINKED', collection: { state: 'FINISHED', message: '방송을 끝내 댓글 기록을 마쳤어요.' } })
  })
})

describe('AC-N2-23 연결 끊기·다시 잇기', () => {
  it('끊은 뒤의 댓글은 기록하지 않고 세며, 다시 이을 수 있다. 같은 댓글 ID는 두 번 기록되지 않는다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const first = await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '첫 댓글' }])
    const unlinked = await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u') })
    expect(unlinked.status).toBe(200)
    expect(unlinked.body.link).toMatchObject({ state: 'NONE' })
    await sendComments(w, account, live, [{ igsid: '2', username: 'b', text: '끊은 뒤' }])
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['첫 댓글'])
    expect(((await api.get('/api/instagram/unlinked')).body.lives as { count: number }[])[0]?.count).toBe(1)
    await linkLive(w, seller, b, live)
    // 같은 댓글이 다시 와도 두 번 기록되지 않는다
    await w.fake.deliver(async (body, headers) => w.server.app.request('/webhooks/instagram', { method: 'POST', headers: { ...headers }, body }), w.fake.payload([{ accountId: account.id, changes: first.changes }]))
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['첫 댓글'])
    expect((await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u') })).status).toBe(200)
    expect((await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u') })).body.error).toEqual({ code: 'NOT_LINKED', message: '이어진 라이브가 없어요.' })
  })
})

describe('AC-N2-24 이어지지 않은 라이브·끝낸 뒤의 댓글', () => {
  it('20:30:00 b를 끝냄 → 20:30:01 댓글 "15" → b의 기록·찜 그대로, 이어지지 않은 댓글 1, 알림', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    await register(w, seller, b, 15, '핑크프릴', 10000)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    w.clock.set(Date.UTC(2026, 9, 19, 11, 30, 0))
    expect((await api.post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    const before = (await api.get('/api/days/2026-10-19')).body as { seq: number; claims: unknown[] }
    w.clock.set(Date.UTC(2026, 9, 19, 11, 30, 1))
    expect((await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '15' }])).status).toBe(200)
    const after = (await api.get('/api/days/2026-10-19')).body as { seq: number; claims: unknown[] }
    expect(after.seq).toBe(before.seq)
    expect(after.claims).toEqual(before.claims)
    expect((await api.get('/api/instagram/unlinked')).body.lives).toEqual([
      { platform: 'INSTAGRAM', liveId: live, count: 1, firstAt: new Date(Date.UTC(2026, 9, 19, 11, 30, 1)).toISOString(), lastAt: new Date(Date.UTC(2026, 9, 19, 11, 30, 1)).toISOString() },
    ])
    const notices = w.published.filter((item) => item.data.code === 'UNLINKED_COMMENTS')
    expect(notices[0]?.data).toMatchObject({ kind: 'NOTICE', message: '인스타그램 라이브 댓글이 오고 있는데 이어진 방송이 없어요. 방송에 이어 주세요.', count: 1, liveId: live })
  })

  it('이어지지 않은 라이브 알림은 처음 한 번과 그 뒤 1분에 한 번까지, 기록에는 본문·이름·IGSID·댓글 ID가 없다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const live = w.fake.startLive(account.id)
    for (let i = 0; i < 3; i++) await sendComments(w, account, live, [{ igsid: `9${String(i)}`, username: 'secret.name', text: `비밀 본문 ${String(i)}` }])
    expect(w.published.filter((item) => item.data.code === 'UNLINKED_COMMENTS')).toHaveLength(1)
    w.clock.advance(60_000)
    await sendComments(w, account, live, [{ igsid: '93', username: 'secret.name', text: '비밀 본문 3' }])
    const notices = w.published.filter((item) => item.data.code === 'UNLINKED_COMMENTS')
    expect(notices.map((item) => item.data.count)).toEqual([1, 4])
    const dump = await w.database.pglite?.query<{ t: string }>(`select row_to_json(u)::text as t from live_unlinked u where seller_id = $1`, [seller.sellerId])
    const text = JSON.stringify(dump?.rows)
    for (const secret of ['secret.name', '비밀 본문', '"90"']) expect(text).not.toContain(secret)
  })
})

describe('AC-N2-37 수집 상태', () => {
  it('WAITING·LIVE·FINISHED·STOPPED와 수, 상태가 바뀌면 SSE', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    w.clock.set(Date.UTC(2026, 9, 19, 11, 0, 0))
    await sendComments(w, account, live, [
      { igsid: '1', username: 'a', text: '하나' },
      { igsid: '2', username: 'b', text: '둘' },
    ])
    await new Promise((resolve) => setTimeout(resolve, 20))
    const link = (await api.get(`/api/broadcasts/${b}/live`)).body.link as { collection: Record<string, unknown> }
    expect(link.collection).toEqual({ platform: 'INSTAGRAM', state: 'LIVE', message: '댓글을 받는 중', liveId: live, lastCommentAt: new Date(Date.UTC(2026, 9, 19, 11, 0, 0)).toISOString(), comments: 2, late: 0, malformed: 0 })
    const collections = w.published.filter((item) => item.data.kind === 'COLLECTION')
    expect(collections.length).toBeGreaterThan(0)
    expect(((collections.at(-1)?.data.link as { collection: { comments: number } }).collection.comments)).toBe(2)
    // 끊기면 STOPPED
    expect((await api.post('/api/instagram/disconnect', {})).status).toBe(200)
    expect(((await api.get(`/api/broadcasts/${b}/live`)).body.link as { collection: { state: string; message: string } }).collection).toMatchObject({ state: 'STOPPED', message: '인스타그램 연결이 끊겨 댓글을 받지 않아요.' })
    expect((await api.get('/api/live')).body.links).toHaveLength(1)
  })
})
