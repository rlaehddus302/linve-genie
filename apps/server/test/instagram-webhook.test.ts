// N2 live_comments 웹훅 (AC-N2-30~36·38·39, D-N2-02~D-N2-04·D-N2-07, G-ENG-N2-01): 확인 요청·원래 바이트 서명·크기·댓글 → chat·중복·순서·기록 뒤 200·버리는 것·늦은 댓글·많은 댓글·판매자 격리.
import { applyEvent, initEngine, listBuyers, listClaims, listEffects, listProducts, type EngineEvent, type EngineState } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { chatEvents, connectedShop, igWorld, linkLive, liveBroadcast, register, sendComments, webhookTarget, type IgWorld } from './instagram-support.ts'
import { MERGED_BODY, RAW_JOIN, client, rid } from './support.ts'

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})
async function world(options: Parameters<typeof igWorld>[0] = {}): Promise<IgWorld> {
  ig = await igWorld(options)
  return ig
}

const post = (w: IgWorld, body: string | Uint8Array, headers: Record<string, string>) => w.server.app.request('/webhooks/instagram', { method: 'POST', headers, body })

/** 기록된 로그를 코어로 다시 재생한 상태 (INV-4) */
async function replay(w: IgWorld, sellerId: string, date = '2026-10-19'): Promise<EngineState> {
  const rows = await w.database.pglite?.query<{ body: string; failed: boolean }>(
    `select ${MERGED_BODY} as body, e.failed from events e join scopes s on s.id = e.scope_id ${RAW_JOIN} where e.seller_id = $1 and s.date = $2 and s.rehearsal = false order by e.seq`,
    [sellerId, date],
  )
  let state = initEngine({ broadcasts: [], settings: {} })
  for (const row of rows?.rows ?? []) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return state
}

async function serverState(w: IgWorld, sellerId: string, date = '2026-10-19'): Promise<EngineState> {
  return (await w.server.writer.read(sellerId, date)).state
}

describe('AC-N2-30 확인 요청 (GET)', () => {
  it('subscribe·확인 토큰 같음 → 200 challenge 그대로(text/plain), 아니면 403 본문 없음, 로그인 필요 없음', async () => {
    const w = await world()
    const ok = await w.server.app.request(`/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(w.fake.verifyToken)}&hub.challenge=1158201444`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('text/plain')
    expect(await ok.text()).toBe('1158201444')
    for (const query of [`hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`, `hub.mode=unsubscribe&hub.verify_token=${encodeURIComponent(w.fake.verifyToken)}&hub.challenge=1`, 'hub.challenge=1']) {
      const denied = await w.server.app.request(`/webhooks/instagram?${query}`)
      expect(denied.status).toBe(403)
      expect(await denied.text()).toBe('')
    }
  })
})

describe('AC-N2-31 서명·크기·경로', () => {
  it('원래 바이트로 서명: 공백·줄바꿈이 섞인 본문도 받는다. 헤더 없음·형식 틀림·값 다름은 401, 아무것도 기록·세지 않는다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const change = w.fake.comment({ accountId: account.id, liveId: live, igsid: '1', username: 'a', text: '하나' })
    const pretty = `{\n  "object": "instagram",\n  "entry": [ { "id": "${account.id}", "time": ${String(Math.floor(w.clock.now() / 1000))},\n "changes": [ ${JSON.stringify(change)} ] } ]\n}\n`
    const good = w.fake.sign(pretty)
    const reserialized = w.fake.sign(JSON.stringify(JSON.parse(pretty)))
    for (const signature of [undefined, 'sha1=' + good.slice(7, 47), good.toUpperCase().replace('SHA256=', 'sha256='), good.slice(0, -1), reserialized, w.fake.sign(pretty, 'other-secret')]) {
      const response = await post(w, pretty, { 'Content-Type': 'application/json', ...(signature === undefined ? {} : { 'X-Hub-Signature-256': signature }) })
      expect(response.status, String(signature)).toBe(401)
      expect(await response.text()).not.toContain('하나')
    }
    // 본문 한 바이트 바꿈
    expect((await post(w, pretty.replace('하나', '하니'), { 'X-Hub-Signature-256': good })).status).toBe(401)
    expect(await chatEvents(w, seller.sellerId)).toEqual([])
    expect((await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from live_unlinked`))?.rows[0]?.n).toBe(0)
    const accepted = await post(w, pretty, { 'X-Hub-Signature-256': good })
    expect(accepted.status).toBe(200)
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['하나'])
  })

  it('1MB 넘으면 413(서명 전), 서명은 맞는데 JSON 아님·빈 본문 400 — 기록 없음, 오류 응답에 본문이 없다', async () => {
    const w = await world()
    const big = `{"object":"instagram","pad":"${'x'.repeat(1024 * 1024)}"}`
    const tooBig = await post(w, big, { 'X-Hub-Signature-256': w.fake.sign(big) })
    expect(tooBig.status).toBe(413)
    const boundary = `{"object":"page","pad":"${'y'.repeat(1024 * 1024 - 26)}"}`
    expect(Buffer.byteLength(boundary)).toBe(1024 * 1024)
    expect((await post(w, boundary, { 'X-Hub-Signature-256': w.fake.sign(boundary) })).status).toBe(200)
    for (const body of ['not json <script>', '']) {
      const response = await post(w, body, { 'X-Hub-Signature-256': w.fake.sign(body) })
      expect(response.status).toBe(400)
      const text = await response.text()
      expect(text).not.toContain('script')
    }
  })

  it('웹훅 주소만 로그인·Origin 검사 밖이다 (Origin이 달라도 서명이 맞으면 받는다)', async () => {
    const w = await world()
    const body = w.fake.payload([])
    expect((await post(w, body, { 'X-Hub-Signature-256': w.fake.sign(body), Origin: 'https://evil.test' })).status).toBe(200)
  })
})

describe('AC-N2-32 댓글 → chat 이벤트 (G-ENG-N2-01)', () => {
  it('ig 접두어 키·username 그대로·owner·publishedAt 없음, 범위 상태가 골든 기대와 같다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w, { username: 'my.shop' })
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const at = (hms: string) => {
      const [h = 0, m = 0, s = 0] = hms.split(':').map(Number)
      w.clock.set(Date.UTC(2026, 9, 19, h - 9, m, s))
    }
    const target = webhookTarget(w)
    const comment = async (id: string, igsid: string, username: string, text: string) => {
      const change = w.fake.comment({ accountId: account.id, liveId: live, igsid, username, text, id })
      const response = await w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes: [change] }]))
      expect(response.status).toBe(200)
    }
    at('20:00:00')
    await register(w, seller, b, 15, '핑크프릴', 10000)
    at('20:00:01')
    await comment('17900000000000001', '6024400000000001', 'pink.mom', '15')
    at('20:00:02')
    await comment('17900000000000002', '6024400000000002', 'dayook_lover', '15번❤️')
    at('20:00:03')
    // 같은 댓글 ID의 재배달 — 본문이 달라도 아무 일도 없다
    await comment('17900000000000001', '6024400000000001', 'pink.mom', '15 취소')
    at('20:00:04')
    // 판매자 계정의 댓글 → owner
    await comment('17900000000000003', account.id, 'my.shop', '15')
    at('20:00:05')
    await comment('17900000000000004', '6024400000000003', 'cactus_kim', '@pink.mom 15번')
    at('20:00:06')
    await comment('17900000000000005', '6024400000000003', 'cactus_kim', '16')
    at('20:00:20')
    await register(w, seller, b, 16, '라울', 5000)
    at('20:00:30')
    await comment('17900000000000006', '6024400000000002', 'dayook.lover2', '16')

    const events = await chatEvents(w, seller.sellerId)
    expect(events.map(({ seq: _seq, at: _at, ...rest }) => rest)).toEqual([
      { type: 'chat', b, id: 'ig:17900000000000001', ch: 'ig:6024400000000001', nick: 'pink.mom', text: '15' },
      { type: 'chat', b, id: 'ig:17900000000000002', ch: 'ig:6024400000000002', nick: 'dayook_lover', text: '15번❤️' },
      { type: 'chat', b, id: 'ig:17900000000000003', ch: `ig:${account.id}`, nick: 'my.shop', text: '15', owner: true },
      { type: 'chat', b, id: 'ig:17900000000000004', ch: 'ig:6024400000000003', nick: 'cactus_kim', text: '@pink.mom 15번' },
      { type: 'chat', b, id: 'ig:17900000000000005', ch: 'ig:6024400000000003', nick: 'cactus_kim', text: '16' },
      { type: 'chat', b, id: 'ig:17900000000000006', ch: 'ig:6024400000000002', nick: 'dayook.lover2', text: '16' },
    ])
    for (const event of events) expect(event).not.toHaveProperty('publishedAt')
    expect(events.map((event) => event.at)).toEqual(['20:00:01', '20:00:02', '20:00:04', '20:00:05', '20:00:06', '20:00:30'].map((hms) => {
      const [h = 0, m = 0, s = 0] = hms.split(':').map(Number)
      return Date.UTC(2026, 9, 19, h - 9, m, s)
    }))

    const state = await serverState(w, seller.sellerId)
    const products = listProducts(state)
    expect(products.find((p) => p.no === 15)).toMatchObject({ status: 'SOLD', winners: ['ig:6024400000000001'], waitlist: ['ig:6024400000000002'] })
    expect(products.find((p) => p.no === 16)).toMatchObject({ status: 'SOLD', winners: ['ig:6024400000000003'], waitlist: ['ig:6024400000000002'] })
    expect(listClaims(state)).toHaveLength(4)
    const buyers = new Map(listBuyers(state).map((buyer) => [buyer.id, buyer]))
    expect(buyers.get('ig:6024400000000001')).toMatchObject({ items: [`${b}/15`], subtotal: 10000, display: 'pink.mom', nameHistory: ['pink.mom'] })
    expect(buyers.get('ig:6024400000000002')).toMatchObject({ items: [], subtotal: 0, display: 'dayook.lover2', nameHistory: ['dayook_lover', 'dayook.lover2'] })
    expect(buyers.get('ig:6024400000000003')).toMatchObject({ items: [`${b}/16`], subtotal: 5000, display: 'cactus_kim' })
    expect(listEffects(state).filter((effect) => effect.kind === 'POST_THANKS').map((effect) => effect.text)).toEqual([
      '15번 핑크프릴 10,000원 pink.mom님 구매 감사합니다',
      '16번 라울 5,000원 cactus_kim님 구매 감사합니다',
    ])
    expect((await api.get('/api/days/2026-10-19')).body.cancelRequests).toEqual([])
  })

  it('username 모양이 아니면 시청자, 대소문자만 다른 판매자 username도 owner', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w, { username: 'My.Shop' })
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    await sendComments(w, account, live, [
      { igsid: '1', username: '한글이름', text: 'a' },
      { igsid: '2', username: 'x'.repeat(31), text: 'b' },
      { igsid: '3', username: 'my.shop', text: 'c' },
    ])
    const events = await chatEvents(w, seller.sellerId)
    expect(events.map((event) => [event.nick, event.owner === true])).toEqual([
      ['시청자', false],
      ['시청자', false],
      ['my.shop', true],
    ])
  })
})

describe('AC-N2-33 중복 배달·묶음·순서', () => {
  it('500개를 묶음 1~50으로, 100개를 다른 요청으로 다시, 두 요청 동시 → ID 집합 같음·중복 0·재생 상태 = 서버 상태', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    for (let no = 1; no <= 20; no++) await register(w, seller, b, no, `상품${String(no)}`, 1000 * no)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const target = webhookTarget(w)
    const all = Array.from({ length: 500 }, (_, i) => w.fake.comment({ accountId: account.id, liveId: live, igsid: String(1000 + (i % 37)), username: `u${String(i % 37)}`, text: i % 3 === 0 ? String((i % 20) + 1) : `말 ${String(i)}`, id: String(900_000 + i) }))
    const batches: (typeof all)[] = []
    for (let i = 0, size = 1; i < all.length; i += size, size = (size % 50) + 1) batches.push(all.slice(i, i + size))
    // 앞 절반은 차례로, 뒤는 두 요청씩 동시에
    const half = Math.floor(batches.length / 2)
    for (const batch of batches.slice(0, half)) expect((await w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes: batch }]))).status).toBe(200)
    const rest = batches.slice(half)
    for (let i = 0; i < rest.length; i += 2) {
      const pair = rest.slice(i, i + 2).map((batch) => w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes: batch }])))
      expect((await Promise.all(pair)).map((response) => response.status)).toEqual(pair.map(() => 200))
    }
    // 100개 다시 (본문을 바꿔도 같다) + 같은 요청 안의 반복
    const again = all.slice(100, 200).map((change) => ({ ...change, value: { ...(change.value as object), text: '바뀐 본문' } }))
    expect((await w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes: [...again, ...again.slice(0, 5)] }]))).status).toBe(200)
    const ids = (await chatEvents(w, seller.sellerId)).map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(all.map((change) => `ig:${(change.value as { id: string }).id}`).sort())
    const replayed = await replay(w, seller.sellerId)
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(await serverState(w, seller.sellerId)))
  })

  it('한 요청 안의 entry·change는 받은 순서대로 기록한다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const make = (text: string) => w.fake.comment({ accountId: account.id, liveId: live, igsid: '5', username: 'e', text })
    const body = w.fake.payload([
      { accountId: account.id, changes: [make('셋'), make('하나')] },
      { accountId: account.id, changes: [make('둘')] },
    ])
    expect((await w.fake.deliver(webhookTarget(w), body)).status).toBe(200)
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['셋', '하나', '둘'])
  })
})

describe('AC-N2-34 기록한 뒤에만 200', () => {
  it('10개 중 6번째에서 저장 실패 → 500 → 같은 본문 다시 → 200, ID 집합 = 10개, 중복 0', async () => {
    let failAt = -1
    let chats = 0
    const w = await world({
      overrides: {
        hooks: {
          beforeCommit: (records) => {
            if (records.some((record) => record.type === 'chat')) {
              chats += 1
              if (chats === failAt) throw new Error('저장 실패 주입')
            }
          },
        },
      },
    })
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const changes = Array.from({ length: 10 }, (_, i) => w.fake.comment({ accountId: account.id, liveId: live, igsid: '7', username: 'g', text: `댓글 ${String(i)}` }))
    const body = w.fake.payload([{ accountId: account.id, changes }])
    failAt = 6
    const failed = await w.fake.deliver(webhookTarget(w), body)
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('댓글')
    expect(await chatEvents(w, seller.sellerId)).toHaveLength(5)
    failAt = -1
    expect((await w.fake.deliver(webhookTarget(w), body)).status).toBe(200)
    const ids = (await chatEvents(w, seller.sellerId)).map((event) => event.id)
    expect(ids).toEqual(changes.map((change) => `ig:${(change.value as { id: string }).id}`))
  })
})

describe('AC-N2-35 다루지 않는 것', () => {
  it('다른 object·field·연결되지 않은 계정은 기록 없이 200, 모양 틀린 변경은 세고 같은 요청의 다른 변경은 평소대로', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const target = webhookTarget(w)
    const good = w.fake.comment({ accountId: account.id, liveId: live, igsid: '1', username: 'a', text: '정상' })
    const page = JSON.stringify({ object: 'page', entry: [{ id: account.id, changes: [good] }] })
    expect((await w.fake.deliver(target, page)).status).toBe(200)
    const stranger = w.fake.addAccount({ username: 'stranger' })
    const malformed = [
      { field: 'live_comments', value: { from: { id: '1' }, media: { id: live }, text: 'id 없음' } },
      { field: 'live_comments', value: { id: '', from: { id: '1' }, media: { id: live }, text: '빈 id' } },
      { field: 'live_comments', value: { id: 5, from: { id: '1' }, media: { id: live }, text: '숫자 id' } },
      { field: 'live_comments', value: { id: 'c1', from: { id: '' }, media: { id: live }, text: '빈 IGSID' } },
      { field: 'live_comments', value: { id: 'c2', from: { id: '1' }, media: {}, text: '미디어 없음' } },
      { field: 'live_comments', value: { id: 'x'.repeat(254), from: { id: '1' }, media: { id: live }, text: '257자' } },
      { field: 'live_comments', value: { id: 'c3', from: { id: '1' }, media: { id: live }, text: 12 } },
    ]
    const body = w.fake.payload([
      { accountId: account.id, changes: [{ field: 'comments', value: (good as { value: unknown }).value }, { field: 'messages', value: {} }, ...malformed, good] },
      { accountId: stranger.id, changes: [w.fake.comment({ accountId: stranger.id, liveId: live, igsid: '2', username: 'b', text: '남의 계정' })] },
    ])
    expect((await w.fake.deliver(target, body)).status).toBe(200)
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['정상'])
    expect((await api.get('/api/instagram/unlinked')).body.malformed).toBe(malformed.length)
    expect(((await api.get(`/api/broadcasts/${b}/live`)).body.link as { collection: { malformed: number } }).collection.malformed).toBe(malformed.length - 1)
    // 접두어 포함 정확히 256자는 받는다
    const edge = w.fake.comment({ accountId: account.id, liveId: live, igsid: '1', username: 'a', text: '256자', id: 'y'.repeat(253) })
    expect((await w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes: [edge] }]))).status).toBe(200)
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['정상', '256자'])
    // 끊은 계정의 댓글은 기록하지 않는다
    expect((await api.post('/api/instagram/disconnect', {})).status).toBe(200)
    await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '끊은 뒤' }])
    expect(await chatEvents(w, seller.sellerId)).toHaveLength(2)
  })
})

describe('AC-N2-36 늦게 받은 댓글', () => {
  it('entry.time이 60초 넘게 이르면 기록하고 세고 알린다(1분에 한 번까지), entry.time은 chat에 없다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const nowSec = Math.floor(w.clock.now() / 1000)
    await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '제때' }], { time: nowSec - 60 })
    await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '늦음1' }], { time: nowSec - 61 })
    await sendComments(w, account, live, [{ igsid: '1', username: 'a', text: '늦음2' }], { time: nowSec - 300 })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['제때', '늦음1', '늦음2'])
    expect(((await api.get(`/api/broadcasts/${b}/live`)).body.link as { collection: { late: number } }).collection.late).toBe(2)
    const notices = w.published.filter((item) => item.data.code === 'LATE_COMMENTS')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.data).toMatchObject({ message: '인스타그램 댓글이 늦게 도착했어요. 순서가 실제와 다를 수 있어요.', broadcast: b })
    for (const event of await chatEvents(w, seller.sellerId)) expect(Object.keys(event).sort()).toEqual(['at', 'b', 'ch', 'id', 'nick', 'seq', 'text', 'type'])
  })
})

describe('AC-N2-38 많은 댓글 (NFR-04)', () => {
  it('1만 건(요청마다 1~100개, 몰림 포함) 빠짐·중복 없이, 재생 상태 = 서버 상태', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    for (let no = 1; no <= 30; no++) await register(w, seller, b, no, `상품${String(no)}`, 500 * no, { stock: 3 })
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const target = webhookTarget(w)
    const total = 10_000
    const ids: string[] = []
    let sent = 0
    let size = 1
    while (sent < total) {
      const count = Math.min(size, total - sent)
      const changes = Array.from({ length: count }, (_, i) => {
        const n = sent + i
        return w.fake.comment({ accountId: account.id, liveId: live, igsid: String(5000 + (n % 211)), username: `viewer${String(n % 211)}`, text: n % 4 === 0 ? String((n % 30) + 1) : `구경 ${String(n)}`, id: String(3_000_000 + n) })
      })
      ids.push(...changes.map((change) => `ig:${(change.value as { id: string }).id}`))
      // 몰림: 50개 묶음 둘을 동시에
      if (count === 50 && sent + 100 <= total) {
        const more = Array.from({ length: 50 }, (_, i) => {
          const n = sent + 50 + i
          return w.fake.comment({ accountId: account.id, liveId: live, igsid: String(5000 + (n % 211)), username: `viewer${String(n % 211)}`, text: `몰림 ${String(n)}`, id: String(3_000_000 + n) })
        })
        ids.push(...more.map((change) => `ig:${(change.value as { id: string }).id}`))
        const responses = await Promise.all([changes, more].map((list) => w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes: list }]))))
        expect(responses.map((response) => response.status)).toEqual([200, 200])
        sent += 100
      } else {
        expect((await w.fake.deliver(target, w.fake.payload([{ accountId: account.id, changes }]))).status).toBe(200)
        sent += count
      }
      size = (size % 100) + 1
    }
    const recorded = (await chatEvents(w, seller.sellerId)).map((event) => event.id as string)
    expect(recorded.length).toBe(total)
    expect(new Set(recorded).size).toBe(total)
    expect([...recorded].sort()).toEqual([...ids].sort())
    expect(JSON.stringify(await replay(w, seller.sellerId))).toBe(JSON.stringify(await serverState(w, seller.sellerId)))
  }, 600_000)
})

describe('AC-N2-39 판매자 격리', () => {
  it('두 계정의 entry가 섞인 요청도 각자 회차에만, 서로의 상태·라이브 연결·수집 상태·수·DM 행을 볼 수 없다', async () => {
    const w = await world()
    const x = await connectedShop(w)
    const y = await connectedShop(w)
    const bx = await liveBroadcast(w, x.seller)
    const by = await liveBroadcast(w, y.seller)
    const lx = w.fake.startLive(x.account.id)
    const ly = w.fake.startLive(y.account.id)
    await linkLive(w, x.seller, bx, lx)
    await linkLive(w, y.seller, by, ly)
    const body = w.fake.payload([
      { accountId: x.account.id, changes: [w.fake.comment({ accountId: x.account.id, liveId: lx, igsid: '1', username: 'a', text: 'X 댓글' })] },
      { accountId: y.account.id, changes: [w.fake.comment({ accountId: y.account.id, liveId: ly, igsid: '2', username: 'b', text: 'Y 댓글' })] },
      // X 계정 entry인데 Y의 라이브 미디어 — X에는 이어진 회차가 없다(세기만)
      { accountId: x.account.id, changes: [w.fake.comment({ accountId: x.account.id, liveId: ly, igsid: '3', username: 'c', text: '섞인 댓글' })] },
    ])
    expect((await w.fake.deliver(webhookTarget(w), body)).status).toBe(200)
    expect((await chatEvents(w, x.seller.sellerId)).map((event) => [event.b, event.text])).toEqual([[bx, 'X 댓글']])
    expect((await chatEvents(w, y.seller.sellerId)).map((event) => [event.b, event.text])).toEqual([[by, 'Y 댓글']])
    const xApi = client(w, x.seller.cookie)
    expect((await xApi.get(`/api/broadcasts/${by}/live`)).status).toBe(404)
    expect((await xApi.get('/api/live')).body.links).toEqual([expect.objectContaining({ broadcast: bx })])
    expect((await xApi.get('/api/instagram/dms?date=2026-10-19')).body.rows).toEqual([])
    expect(((await xApi.get('/api/instagram')).body.connection as { account: { id: string } }).account.id).toBe(x.account.id)
    // X의 회차에 Y의 미디어를 이을 수 없다
    const bx2 = await liveBroadcast(w, x.seller)
    expect((await xApi.post(`/api/broadcasts/${bx2}/live/link`, { requestId: rid('l'), platform: 'INSTAGRAM', liveId: ly })).body.error).toMatchObject({ code: 'NOT_LIVE' })
    expect(((await client(w, y.seller.cookie).get('/api/instagram/unlinked')).body.lives as unknown[]).length).toBe(0)
  })

  it('이미 기록한 댓글을 거르는 것은 판매자 안에서만 — 다른 판매자가 같은 댓글 ID를 기록했어도 내 댓글은 기록한다', async () => {
    const w = await world()
    const x = await connectedShop(w)
    const y = await connectedShop(w)
    const bx = await liveBroadcast(w, x.seller)
    const by = await liveBroadcast(w, y.seller)
    const lx = w.fake.startLive(x.account.id)
    const ly = w.fake.startLive(y.account.id)
    await linkLive(w, x.seller, bx, lx)
    await linkLive(w, y.seller, by, ly)
    expect((await sendComments(w, x.account, lx, [{ id: '8001', igsid: '1', username: 'a', text: 'X 댓글' }])).status).toBe(200)
    expect((await sendComments(w, y.account, ly, [{ id: '8001', igsid: '2', username: 'b', text: 'Y 댓글' }])).status).toBe(200)
    expect((await chatEvents(w, x.seller.sellerId)).map((event) => [event.b, event.id, event.text])).toEqual([[bx, 'ig:8001', 'X 댓글']])
    expect((await chatEvents(w, y.seller.sellerId)).map((event) => [event.b, event.id, event.text])).toEqual([[by, 'ig:8001', 'Y 댓글']])
  })
})
