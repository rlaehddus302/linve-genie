// X1 크롬 확장으로 채팅 읽기 — 서버 (YT-10 AC2~AC9, D-X1-05~13): AC-X1-08~15·19의 서버 몫.
// 연결 코드·토큰(해시로만·끊기·다시 만들기·30일), 묶음·속도 제한·중복 없음, 회차 잇기(자동·고르기·거절), 받는 범위, 다른 경로 중복(ID·3초 규칙),
// 이름 정리·로그에 남기지 않기, 상태 경고(30초·뒤로 간 탭·1분 읽지 못함).
import { afterEach, describe, expect, it } from 'vitest'
import { MERGED_BODY, RAW_JOIN, addSeller, client, createBroadcast, expectOk, login, rid, writeEvent, type Seller } from './support.ts'
import { connectSeller, dumpText, linkedBroadcast, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(): Promise<YoutubeWorld> {
  const created = await youtubeWorld()
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const VIDEO = 'abcdefghijk'
const OTHER_VIDEO = 'zyxwvutsrqp'

interface ExtResponse {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly text: string
  readonly headers: Headers
}

async function ext(w: YoutubeWorld, method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<ExtResponse> {
  const headers: Record<string, string> = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await w.server.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text, headers: response.headers }
}

async function connect(w: YoutubeWorld, seller: Seller): Promise<string> {
  const issued = await client(w, seller.cookie).post('/api/extension/code', {})
  expect(issued.status, issued.text).toBe(200)
  const exchanged = await ext(w, 'POST', '/ext/connect', null, { code: issued.body.code })
  expect(exchanged.status, exchanged.text).toBe(200)
  return exchanged.body.token as string
}

let messageCounter = 0
function chat(w: YoutubeWorld, input: { id?: string; ch?: string; nick?: string; text?: string; at?: number; owner?: true } = {}) {
  return { id: input.id ?? `ext-msg-${String(++messageCounter)}`, ch: input.ch ?? 'UCbuyer0000000000000001', nick: input.nick ?? '구매자', text: input.text ?? '3번', at: input.at ?? w.timer.now(), ...(input.owner === true ? { owner: true as const } : {}) }
}

async function chatRows(w: YoutubeWorld): Promise<{ id: string; source: string; body: Record<string, unknown> }[]> {
  const rows = await w.database.pglite?.query<{ id: string; source: string; body: string }>(
    `select e.chat_message_id as id, e.chat_source as source, ${MERGED_BODY} as body from events e ${RAW_JOIN} where e.type = 'chat' order by e.seq`,
  )
  return (rows?.rows ?? []).map((row) => ({ id: row.id, source: row.source, body: JSON.parse(row.body) as Record<string, unknown> }))
}

/** 판매자 + 오늘 실제 회차 + 확장 토큰 + 그 회차에 이은 영상 VIDEO (고르기) */
async function boundWorld() {
  const w = await world()
  const seller = await addSeller(w)
  const b = await createBroadcast(w, seller)
  const token = await connect(w, seller)
  const bound = await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: b.id })
  expect(bound.status, bound.text).toBe(200)
  return { w, seller, b, token }
}

describe('AC-X1-08 연결 코드 (YT-10 AC4, D-X1-07)', () => {
  it('판매자는 8자리 코드를 받고, 한 번 쓴 코드·10분 지난 코드는 거절된다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const issued = await client(w, seller.cookie).post('/api/extension/code', {})
    expect(issued.status).toBe(200)
    expect(issued.body.code).toMatch(/^\d{8}$/)
    expect(Date.parse(issued.body.expiresAt as string) - w.timer.now()).toBe(10 * 60 * 1000)
    const first = await ext(w, 'POST', '/ext/connect', null, { code: issued.body.code })
    expect(first.status).toBe(200)
    expect(typeof first.body.token).toBe('string')
    const again = await ext(w, 'POST', '/ext/connect', null, { code: issued.body.code })
    expect(again.status).toBe(400)
    expect((again.body.error as { code: string }).code).toBe('EXT_CODE_INVALID')

    const late = await client(w, seller.cookie).post('/api/extension/code', {})
    await w.timer.advance(10 * 60 * 1000)
    const expired = await ext(w, 'POST', '/ext/connect', null, { code: late.body.code })
    expect(expired.status).toBe(400)
    expect((expired.body.error as { message: string }).message).not.toMatch(/[A-Za-z]/)
  })

  it('보조자 세션은 코드를 받을 수 없다(403)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const created = await client(w, seller.cookie).post('/api/assistants', { name: '엄마' })
    expect(created.status, created.text).toBe(200)
    const assistant = await login(w, (created.body.assistant as { loginId: string }).loginId, created.body.password as string)
    const refused = await client(w, assistant).post('/api/extension/code', {})
    expect(refused.status).toBe(403)
    expect((refused.body.error as { code: string }).code).toBe('ASSISTANT_FORBIDDEN')
    expect((await client(w, assistant).post('/api/extension/disconnect', {})).status).toBe(403)
  })

  it('새 코드를 받으면 앞 코드는 쓸 수 없다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const first = await client(w, seller.cookie).post('/api/extension/code', {})
    await client(w, seller.cookie).post('/api/extension/code', {})
    expect((await ext(w, 'POST', '/ext/connect', null, { code: first.body.code })).status).toBe(400)
  })
})

describe('AC-X1-09 확장 토큰 (YT-10 AC4, D-X1-08)', () => {
  it('토큰은 DB에 해시로만 있고, 판매자 API를 부를 수 없다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const token = await connect(w, seller)
    expect(await dumpText(w)).not.toContain(token)
    const asBearer = await w.server.app.request('/api/broadcasts', { headers: { Authorization: `Bearer ${token}` } })
    expect(asBearer.status).toBe(401)
    const asCookie = await w.server.app.request('/api/broadcasts', { headers: { Cookie: `lj_session=${token}` } })
    expect(asCookie.status).toBe(401)
  })

  it('다시 만들기 뒤 앞 토큰은 401, 새 코드로 받은 토큰은 된다. 끊기 뒤 토큰은 401', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const first = await connect(w, seller)
    expect((await ext(w, 'POST', '/ext/status', first, { hidden: false })).status).toBe(200)
    const renewed = await client(w, seller.cookie).post('/api/extension/renew', {})
    expect(renewed.status).toBe(200)
    const old = await ext(w, 'POST', '/ext/status', first, { hidden: false })
    expect(old.status).toBe(401)
    expect((old.body.error as { code: string; message: string }).code).toBe('EXT_DISCONNECTED')
    expect((old.body.error as { message: string }).message).toContain('연결이 끊겼어요')
    const second = (await ext(w, 'POST', '/ext/connect', null, { code: renewed.body.code })).body.token as string
    expect((await ext(w, 'POST', '/ext/status', second, { hidden: false })).status).toBe(200)

    const view = await client(w, seller.cookie).get('/api/extension')
    expect((view.body.extension as { connected: boolean }).connected).toBe(true)
    expect((await client(w, seller.cookie).post('/api/extension/disconnect', {})).status).toBe(200)
    expect((await ext(w, 'POST', '/ext/status', second, { hidden: false })).status).toBe(401)
    expect(((await client(w, seller.cookie).get('/api/extension')).body.extension as { connected: boolean }).connected).toBe(false)
  })

  it('판매자마다 토큰은 하나: 코드를 다시 넣어 새 토큰을 받으면 앞 토큰은 끊긴다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const first = await connect(w, seller)
    const second = await connect(w, seller)
    expect((await ext(w, 'POST', '/ext/status', first, { hidden: false })).status).toBe(401)
    expect((await ext(w, 'POST', '/ext/status', second, { hidden: false })).status).toBe(200)
  })

  it('30일 쓰지 않은 토큰은 끊긴다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const token = await connect(w, seller)
    await w.timer.advance(30 * 24 * 60 * 60 * 1000)
    expect((await ext(w, 'POST', '/ext/status', token, { hidden: false })).status).toBe(401)
  })

  it('토큰이 없거나 모르는 토큰이면 401', async () => {
    const w = await world()
    expect((await ext(w, 'GET', `/ext/broadcasts?v=${VIDEO}`, null)).status).toBe(401)
    expect((await ext(w, 'GET', `/ext/broadcasts?v=${VIDEO}`, 'nottherealtoken')).status).toBe(401)
  })
})

describe('AC-X1-10 묶음·속도 제한·다시 보내기 (YT-10 AC5, D-X1-09)', () => {
  it('51개 묶음은 400이고 아무것도 기록하지 않는다', async () => {
    const { w, token } = await boundWorld()
    const messages = Array.from({ length: 51 }, () => chat(w))
    const response = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages })
    expect(response.status).toBe(400)
    expect(await chatRows(w)).toEqual([])
    const fifty = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: messages.slice(0, 50) })
    expect(fifty.status, fifty.text).toBe(200)
    expect(fifty.body.recorded).toBe(50)
  })

  it('토큰마다 초당 6번째 요청은 429 (Retry-After), 1초 뒤에는 다시 된다', async () => {
    const { w, token } = await boundWorld()
    await w.timer.advance(1000)
    for (let i = 0; i < 5; i++) expect((await ext(w, 'POST', '/ext/status', token, { hidden: false })).status).toBe(200)
    const sixth = await ext(w, 'POST', '/ext/status', token, { hidden: false })
    expect(sixth.status).toBe(429)
    expect((sixth.body.error as { code: string }).code).toBe('EXT_RATE_LIMITED')
    expect(sixth.headers.get('retry-after')).toBe('1')
    await w.timer.advance(1000)
    expect((await ext(w, 'POST', '/ext/status', token, { hidden: false })).status).toBe(200)
  })

  it('분당 600메시지를 넘으면 429', async () => {
    const { w, token } = await boundWorld()
    for (let i = 0; i < 12; i++) {
      await w.timer.advance(1000)
      const sent = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: Array.from({ length: 50 }, () => chat(w)) })
      expect(sent.status, sent.text).toBe(200)
    }
    await w.timer.advance(1000)
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w)] })).status).toBe(429)
  })

  it('같은 묶음을 두 번 보내도 채팅 이벤트는 한 번만', async () => {
    const { w, token } = await boundWorld()
    const messages = [chat(w), chat(w, { text: '4번' })]
    const first = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages })
    expect(first.body.recorded).toBe(2)
    const again = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages })
    expect(again.status).toBe(200)
    expect(again.body.recorded).toBe(0)
    expect(await chatRows(w)).toHaveLength(2)
  })

  it('모르는 필드·잘못된 모양은 400', async () => {
    const { w, token } = await boundWorld()
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [], extra: 1 })).status).toBe(400)
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [{ ...chat(w), superchat: true }] })).status).toBe(400)
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [{ ...chat(w), ch: '' }] })).status).toBe(400)
    expect((await ext(w, 'POST', '/ext/chats', token, { v: 'short', messages: [] })).status).toBe(400)
  })
})

describe('AC-X1-11·12 회차 잇기 (YT-10 AC6, D-X1-10)', () => {
  it('영상이 YT-02로 이어진 회차가 있으면 거기로 자동으로 기록한다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, live } = await linkedBroadcast(w, connected)
    const token = await connect(w, connected.seller)
    const listed = await ext(w, 'GET', `/ext/broadcasts?v=${live.videoId}`, token)
    expect(listed.status).toBe(200)
    expect((listed.body.bound as { id: string }).id).toBe(b.id)
    await w.timer.advance(1000)
    const sent = await ext(w, 'POST', '/ext/chats', token, { v: live.videoId, messages: [chat(w)] })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body).toMatchObject({ recorded: 1, broadcast: b.id })
    expect((await chatRows(w))[0]?.body.b).toBe(b.id)
  })

  it('이어진 회차가 없으면 오늘의 끝나지 않은 실제 회차만 보이고, 고르기 전 보낸 메시지는 기록하지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const open = await createBroadcast(w, seller, { title: '1부' })
    const ended = await createBroadcast(w, seller, { title: '0부' })
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${ended.id}/end`, { requestId: rid('end') })).status).toBe(200)
    await createBroadcast(w, seller, { title: '연습', rehearsal: true })
    await createBroadcast(w, seller, { title: '어제', date: '2026-10-18' })
    const token = await connect(w, seller)
    const listed = await ext(w, 'GET', `/ext/broadcasts?v=${VIDEO}`, token)
    expect(listed.body.bound).toBeNull()
    expect((listed.body.broadcasts as { id: string }[]).map((row) => row.id)).toEqual([open.id])
    const early = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w)] })
    expect(early.status).toBe(409)
    expect((early.body.error as { code: string }).code).toBe('EXT_NOT_BOUND')
    expect(await chatRows(w)).toEqual([])
    // 리허설·끝난 회차는 고를 수 없다
    expect((await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: ended.id })).status).toBe(409)
    expect((await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: open.id })).status).toBe(200)
    await w.timer.advance(1000)
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w)] })).body.recorded).toBe(1)
  })

  it('다른 영상에 이어진 회차·다른 회차에 이어진 영상은 거절하고 기록하지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, live } = await linkedBroadcast(w, connected)
    const free = await createBroadcast(w, connected.seller, { title: '2부' })
    const token = await connect(w, connected.seller)
    const otherVideo = await ext(w, 'POST', '/ext/bind', token, { v: OTHER_VIDEO, broadcast: b.id })
    expect(otherVideo.status).toBe(409)
    expect(otherVideo.body.reason).toBe('OTHER_VIDEO')
    const taken = await ext(w, 'POST', '/ext/bind', token, { v: live.videoId, broadcast: free.id })
    expect(taken.status).toBe(409)
    expect(taken.body.reason).toBe('VIDEO_TAKEN')
    expect(await chatRows(w)).toEqual([])
    // 확장에서 고른 잇기끼리도
    expect((await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: free.id })).status).toBe(200)
    expect((await ext(w, 'POST', '/ext/bind', token, { v: OTHER_VIDEO, broadcast: free.id })).body.reason).toBe('OTHER_VIDEO')
  })

  it('다른 판매자의 회차는 고를 수 없다(404)', async () => {
    const w = await world()
    const one = await addSeller(w)
    const two = await addSeller(w)
    const theirs = await createBroadcast(w, two)
    const token = await connect(w, one)
    expect((await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: theirs.id })).status).toBe(404)
  })
})

describe('AC-X1-13 받는 범위·같은 채팅 이벤트 (YT-10 AC2)', () => {
  it('잇기 전 게시·끝낸 뒤 게시는 기록하지 않고, 끝낸 뒤 10분이 지나면 받지 않는다', async () => {
    const { w, seller, b, token } = await boundWorld()
    const before = chat(w, { at: w.timer.now() - 1 })
    await w.timer.advance(1000)
    const inside = chat(w)
    const sent = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [before, inside] })
    expect(sent.body).toMatchObject({ recorded: 1, skipped: 1 })
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid('end') })).status).toBe(200)
    await w.timer.advance(1000)
    const late = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w), chat(w, { at: w.timer.now() - 1500 })] })
    expect(late.status).toBe(200)
    expect(late.body.recorded).toBe(1)
    await w.timer.advance(10 * 60 * 1000)
    const tooLate = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w, { at: w.timer.now() - 11 * 60 * 1000 + 1 })] })
    expect(tooLate.status).toBe(409)
    expect((tooLate.body.error as { code: string }).code).toBe('EXT_ENDED')
    expect((await chatRows(w)).map((row) => row.id)).toEqual([inside.id, expect.any(String)])
  })

  it('기록은 공식 수집기와 같은 채팅 이벤트이고 경로 표시만 extension이다', async () => {
    const { w, seller, b, token } = await boundWorld()
    await w.timer.advance(1000)
    const message = chat(w, { text: '7번' })
    await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [message] })
    await w.server.service.ingestYoutubeBatch(seller.sellerId, b.id, [{ id: 'official-1', ch: 'UCbuyer0000000000000002', nick: '다른 이', text: '8번', publishedAt: w.timer.now() }])
    const rows = await chatRows(w)
    expect(rows.map((row) => row.source)).toEqual(['extension', 'youtube'])
    expect(Object.keys(rows[0]?.body ?? {}).sort()).toEqual(Object.keys(rows[1]?.body ?? {}).sort())
    expect(rows[0]?.body).toMatchObject({ type: 'chat', b: b.id, id: message.id, ch: message.ch, nick: '구매자', text: '7번', publishedAt: message.at })
    const actors = await w.database.pglite?.query<{ actor: string }>(`select actor from events where type = 'chat'`)
    expect(actors?.rows.map((row) => row.actor)).toEqual(['collector', 'collector'])
  })

  it('D-X1-29: 방송자 표시는 회차 채널(유튜브 연결 채널)과 같을 때만 owner로 기록 — 방송자 무시(기본)로 판매자 글은 찜이 되지 않는다. 다른 채널의 표시는 일반 시청자로 세고, 모양이 틀린 표시는 400', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: false })
    const b = await createBroadcast(w, connected.seller)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 3, name: '핑크', price: 10000 }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 4, name: '라울', price: 10000 }))
    const token = await connect(w, connected.seller)
    expect((await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: b.id })).status).toBe(200)
    await w.timer.advance(1000)
    const seller = chat(w, { ch: connected.channel.id, nick: '판매자', text: '3번', owner: true })
    const forged = chat(w, { ch: 'UCforged000000000000001', nick: '가짜 주인', text: '4번', owner: true })
    const viewer = chat(w, { text: '3번' })
    const sent = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [seller, forged, viewer] })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body).toMatchObject({ recorded: 3, ownerDenied: 1 })
    const rows = await chatRows(w)
    expect(rows.map((row) => row.body.owner)).toEqual([true, undefined, undefined])
    const day = (await client(w, connected.seller.cookie).get(`/api/days/${b.date}`)).body
    const claims = day.claims as { ch?: string; no?: number }[]
    expect(claims).toHaveLength(2)
    expect(JSON.stringify(claims)).not.toContain(connected.channel.id)
    const bad = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [{ ...chat(w), owner: 'yes' }] })
    expect(bad.status).toBe(400)
  })

  it('D-X1-29: 회차 채널을 아직 모르면(유튜브 연결·이은 채널 없음) 방송자 표시를 믿는다', async () => {
    const { w, token } = await boundWorld()
    await w.timer.advance(1000)
    const sent = await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w, { ch: 'UCseller000000000000001', owner: true })] })
    expect(sent.body).toMatchObject({ recorded: 1, ownerDenied: 0 })
    expect((await chatRows(w)).map((row) => row.body.owner)).toEqual([true])
  })

  it('리허설 회차로는 받지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const rehearsal = await createBroadcast(w, seller, { rehearsal: true })
    const token = await connect(w, seller)
    expect((await ext(w, 'POST', '/ext/bind', token, { v: VIDEO, broadcast: rehearsal.id })).status).toBe(409)
  })
})

describe('AC-X1-14·15 두 경로의 중복 없음 (YT-10 AC3, D-X1-06)', () => {
  it('같은 메시지 ID가 공식 다음 확장으로, 확장 다음 공식으로 와도 하나만 — 먼저 온 경로가 남는다', async () => {
    const { w, seller, b, token } = await boundWorld()
    await w.timer.advance(1000)
    const at = w.timer.now()
    await w.server.service.ingestYoutubeBatch(seller.sellerId, b.id, [{ id: 'same-1', ch: 'UCa', nick: '가', text: '1번', publishedAt: at }])
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w, { id: 'same-1', ch: 'UCa', text: '1번', at })] })).body.recorded).toBe(0)
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w, { id: 'same-2', ch: 'UCb', text: '2번', at })] })).body.recorded).toBe(1)
    const official = await w.server.service.ingestYoutubeBatch(seller.sellerId, b.id, [{ id: 'same-2', ch: 'UCb', nick: '나', text: '2번', publishedAt: at }])
    expect(official).toEqual({ status: 'ok', recorded: 0 })
    expect((await chatRows(w)).map((row) => [row.id, row.source])).toEqual([
      ['same-1', 'youtube'],
      ['same-2', 'extension'],
    ])
  })

  it('ID 모양이 달라도 같은 작성자·같은 정리 본문·게시 시각 3초 차이면 하나, 4초면 둘, 다른 작성자면 둘', async () => {
    const { w, seller, b, token } = await boundWorld()
    await w.timer.advance(10_000)
    const at = w.timer.now()
    await w.server.service.ingestYoutubeBatch(seller.sellerId, b.id, [
      { id: 'LCC.official-a', ch: 'UCsame', nick: '가', text: '3번 주세요', publishedAt: at },
      { id: 'LCC.official-b', ch: 'UCsame', nick: '가', text: '5번', publishedAt: at },
      { id: 'LCC.official-c', ch: 'UCone', nick: '다', text: '6번', publishedAt: at },
    ])
    const sent = await ext(w, 'POST', '/ext/chats', token, {
      v: VIDEO,
      messages: [
        chat(w, { id: 'dom-a', ch: 'UCsame', text: ' 3번  주세요 ', at: at + 3000 }),
        chat(w, { id: 'dom-b', ch: 'UCsame', text: '5번', at: at - 4000 }),
        chat(w, { id: 'dom-c', ch: 'UCtwo', text: '6번', at }),
      ],
    })
    expect(sent.body.recorded).toBe(2)
    expect((await chatRows(w)).map((row) => row.id)).toEqual(['LCC.official-a', 'LCC.official-b', 'LCC.official-c', 'dom-b', 'dom-c'])
    // 반대 방향(확장이 먼저)도 같다
    await w.timer.advance(1000)
    const later = w.timer.now()
    await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages: [chat(w, { id: 'dom-d', ch: 'UCsame', text: '9번', at: later })] })
    const official = await w.server.service.ingestYoutubeBatch(seller.sellerId, b.id, [{ id: 'LCC.official-d', ch: 'UCsame', nick: '가', text: '9번', publishedAt: later - 2000 }])
    expect(official).toEqual({ status: 'ok', recorded: 0 })
  })
})

describe('AC-X1-19 개인정보 (YT-10 AC9, D-X1-13)', () => {
  it('닉네임은 YT-03 이름 정리를 거치고, 로그에 닉네임·본문·토큰이 없다', async () => {
    const { w, token } = await boundWorld()
    await w.timer.advance(1000)
    const messages = [chat(w, { nick: '@가\n나', text: '비밀본문 3번' }), chat(w, { nick: '   ', text: '4번' }), chat(w, { nick: '<script>alert(1)</script>' }), chat(w, { nick: 'ㄱ'.repeat(40) })]
    expect((await ext(w, 'POST', '/ext/chats', token, { v: VIDEO, messages })).body.recorded).toBe(4)
    const nicks = (await chatRows(w)).map((row) => row.body.nick)
    expect(nicks).toEqual(['가 나', '시청자', '<script>alert(1)</script>', `${'ㄱ'.repeat(30)}…`])
    const logs = JSON.stringify(w.logs)
    for (const secret of [token, '비밀본문', '가 나', '<script>']) expect(logs).not.toContain(secret)
  })
})

describe('AC-X1-16 상태 경고 (YT-10 AC7, D-X1-11) — 서버 상태 계산', () => {
  async function state(w: YoutubeWorld, seller: Seller) {
    return (await client(w, seller.cookie).get('/api/extension')).body.extension as { state: string; message: string | null; manual: string | null }
  }

  it('받는 중 → 30초 넘게 상태가 없으면 STALE("확장에서 채팅이 오지 않아요" + 손 입력 안내)', async () => {
    const { w, seller, token } = await boundWorld()
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false, read: 0, unread: 0 })
    expect(await state(w, seller)).toMatchObject({ state: 'RECEIVING', message: '확장으로 받는 중', manual: null })
    await w.timer.advance(30_000)
    expect((await state(w, seller)).state).toBe('RECEIVING')
    await w.timer.advance(1)
    expect(await state(w, seller)).toMatchObject({ state: 'STALE', message: '확장에서 채팅이 오지 않아요', manual: '주문은 손으로 넣어 주세요' })
  })

  it('탭이 뒤로 가면 HIDDEN, 읽지 못함만 1분 이어지면 UNREADABLE, 읽으면 다시 받는 중', async () => {
    const { w, seller, token } = await boundWorld()
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: true, read: 0, unread: 0 })
    expect(await state(w, seller)).toMatchObject({ state: 'HIDDEN', message: '유튜브 채팅 창을 앞으로 꺼내 두세요' })
    await w.timer.advance(10_000)
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false, read: 2, unread: 0 })
    await w.timer.advance(10_000)
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false, read: 2, unread: 3 })
    for (let i = 0; i < 5; i++) {
      await w.timer.advance(10_000)
      await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false, read: 2, unread: 4 + i })
    }
    expect((await state(w, seller)).state).toBe('RECEIVING')
    await w.timer.advance(10_000)
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false, read: 2, unread: 10 })
    expect(await state(w, seller)).toMatchObject({ state: 'UNREADABLE', message: '유튜브 화면이 바뀌어 채팅을 읽지 못해요', manual: '주문은 손으로 넣어 주세요' })
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false, read: 3, unread: 10 })
    expect((await state(w, seller)).state).toBe('RECEIVING')
  })

  it('30초가 지나면 서버가 스스로 실시간 알림을 보낸다', async () => {
    const { w, seller, token } = await boundWorld()
    const published: string[] = []
    const original = w.server.hub.publishExtension.bind(w.server.hub)
    w.server.hub.publishExtension = (sellerId, data) => {
      if (sellerId === seller.sellerId) published.push(String(data.state))
      original(sellerId, data)
    }
    await ext(w, 'POST', '/ext/status', token, { v: VIDEO, hidden: false })
    await w.timer.advance(31_000)
    for (let i = 0; i < 50 && !published.includes('STALE'); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(published).toContain('STALE')
  })
})
