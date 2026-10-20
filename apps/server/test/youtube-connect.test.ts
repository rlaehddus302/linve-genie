// AC-Y1-01~06 구글 연결 (YT-01, DAT-06, D-Y02): 승인 주소, 돌아오기, 토큰 암호화, 새로 고침·다시 연결 필요, 상태 조회, 끊기
import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { generateMasterKey } from '../src/secrets.ts'
import { PUBLISH_SCOPE, READ_SCOPE } from '../src/youtube/google.ts'
import { addSeller, client, expectOk, login, writeEvent } from './support.ts'
import { API_ORIGIN, approve, callback, connectSeller, dumpText, linkedBroadcast, sibling, until, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
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

describe('AC-Y1-01 연결 시작 — 승인 주소', () => {
  it('읽기 권한 하나만, offline, PKCE S256(검증 값 43~128자), state 32바이트 이상, 설정에 고정한 돌아오는 주소', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const response = await client(w, seller.cookie).post('/api/youtube/connection/start', {})
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const url = new URL(response.body.authorizeUrl as string)
    expect(url.origin + url.pathname).toBe(w.fake.endpoints().authUrl)
    expect(url.searchParams.get('client_id')).toBe(w.fake.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(`${API_ORIGIN}/api/youtube/oauth/callback`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(READ_SCOPE)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const state = url.searchParams.get('state') ?? ''
    expect(Buffer.from(state, 'base64url').length).toBeGreaterThanOrEqual(32)
    // state·검증 값은 DB에 원문이 없다 (state는 해시, 검증 값은 암호화)
    const dump = await dumpText(w)
    expect(dump).not.toContain(state)
    // 로그에도 없다
    expect(JSON.stringify(w.logs)).not.toContain(state)
  })

  it('상태를 바꾸는 요청이다: Origin이 다르면 403, JSON이 아니면 415, 모르는 필드는 400, 세션이 없으면 401', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const raw = (init: RequestInit) => w.server.app.request('/api/youtube/connection/start', { method: 'POST', ...init })
    expect((await raw({ headers: { Cookie: seller.cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)
    expect((await raw({ headers: { Cookie: seller.cookie, Origin: 'https://app.livejjim.test', 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await client(w, seller.cookie).post('/api/youtube/connection/start', { scope: 'x' })).status).toBe(400)
    expect((await client(w, null).post('/api/youtube/connection/start', {})).status).toBe(401)
  })
})

describe('AC-Y1-02 돌아오기 — 토큰 받기·채널 확인', () => {
  it('승인하고 돌아오면 채널을 저장하고 화면 주소로 connected (주소에 토큰·code 없음)', async () => {
    const w = await world()
    const { seller, channel } = await connectSeller(w)
    const status = await client(w, seller.cookie).get('/api/youtube/connection')
    expect(status.body.connection).toEqual({
      status: 'CONNECTED',
      channel: { id: channel.id, title: '구피 가게' },
      permissions: { read: true, publish: false },
      consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } },
    })
    // 가짜 구글이 PKCE를 검사했다(코드 교환 성공) — channels.list 한 번
    expect(w.fake.calls('oauth.token')).toBe(1)
    expect(w.fake.calls('channels.list')).toBe(1)
  })

  it('받지 않는 경우: state 없음·다름·10분 지남·이미 씀·다른 세션, 거절, 채널 없음, 다른 판매자의 채널, 처음과 다른 채널', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const start = async () => approve((await api.post('/api/youtube/connection/start', {})).body.authorizeUrl as string)
    const account = w.fake.addAccount()
    const channel = w.fake.addChannel(account, '첫 채널')
    w.fake.approval = { account, channel: channel.id }
    // state 없음·다름
    expect(await callback(w, seller.cookie, '?code=abc')).toBe('STATE_INVALID')
    expect(await callback(w, seller.cookie, '?code=abc&state=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe('STATE_INVALID')
    // 10분 지남
    const late = await start()
    await w.timer.advance(10 * 60 * 1000 + 1)
    expect(await callback(w, seller.cookie, late)).toBe('STATE_INVALID')
    // 다른 세션 (같은 판매자 다른 로그인)
    const otherSession = await login(w, seller.loginId, seller.password)
    const mine = await start()
    expect(await callback(w, otherSession, mine)).toBe('STATE_INVALID')
    // 로그인 없이
    expect(await callback(w, null, mine)).toBe('STATE_INVALID')
    // 그 세션이면 받는다. 같은 code·state로 또 오면 한 번만 처리 (이미 씀)
    expect(await callback(w, seller.cookie, mine)).toBe('connected')
    expect(await callback(w, seller.cookie, mine)).toBe('STATE_INVALID')
    expect(w.fake.calls('oauth.token')).toBe(1)
    // 거절
    w.fake.approval = { deny: true }
    expect(await callback(w, seller.cookie, await start())).toBe('ACCESS_DENIED')
    // 처음과 다른 채널 (브랜드 채널)
    const brand = w.fake.addChannel(account, '브랜드 채널')
    w.fake.approval = { account, channel: brand.id }
    expect(await callback(w, seller.cookie, await start())).toBe('CHANNEL_MISMATCH')
    // 같은 채널이면 받고 토큰만 바꾼다
    w.fake.approval = { account, channel: channel.id }
    expect(await callback(w, seller.cookie, await start())).toBe('connected')
    // 다른 판매자가 이 채널을 연결하려 하면 (다른 판매자를 알리지 않는다)
    const other = await addSeller(w)
    const otherStart = await approve((await client(w, other.cookie).post('/api/youtube/connection/start', {})).body.authorizeUrl as string)
    expect(await callback(w, other.cookie, otherStart)).toBe('CHANNEL_TAKEN')
    // 채널이 없는 구글 계정
    const empty = w.fake.addAccount()
    w.fake.approval = { account: empty }
    const third = await addSeller(w)
    expect(await callback(w, third.cookie, await approve((await client(w, third.cookie).post('/api/youtube/connection/start', {})).body.authorizeUrl as string))).toBe('NO_CHANNEL')
    expect((await client(w, third.cookie).get('/api/youtube/connection')).body.connection).toMatchObject({ status: 'NOT_CONNECTED' })
  })

  it('같은 code·state로 동시에 두 번 와도 토큰 교환은 한 번', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const account = w.fake.addAccount()
    const channel = w.fake.addChannel(account)
    w.fake.approval = { account, channel: channel.id }
    const search = await approve((await client(w, seller.cookie).post('/api/youtube/connection/start', {})).body.authorizeUrl as string)
    const results = await Promise.all([callback(w, seller.cookie, search), callback(w, seller.cookie, search)])
    expect(results.sort()).toEqual(['STATE_INVALID', 'connected'])
    expect(w.fake.calls('oauth.token')).toBe(1)
  })
})

describe('AC-Y1-03 토큰 보관', () => {
  it('토큰 원문은 DB 어디에도 없다. 응답·로그·이벤트 기록에도 없다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    await linkedBroadcast(w, connected)
    const tokens = w.fake.issuedTokens()
    expect(tokens.length).toBeGreaterThan(0)
    const dump = await dumpText(w)
    for (const token of [...tokens, ...w.fake.issuedCodes()]) expect(dump).not.toContain(token)
    const status = await client(w, connected.seller.cookie).get('/api/youtube/connection')
    for (const token of tokens) {
      expect(status.text).not.toContain(token)
      expect(JSON.stringify(w.logs)).not.toContain(token)
    }
  })

  it('마스터 키가 바뀌어 토큰을 풀 수 없으면 죽지 않고 "다시 연결 필요"', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    // 새 마스터 키로 같은 DB에 서버를 다시 띄운다 (판매자 키도 풀리지 않지만 로그인·조회는 된다)
    const other = sibling(w, 'B')
    void other
    const rekeyed = await youtubeWorld({ database: w.database, masterKey: generateMasterKey(), fake: w.fake, timer: w.timer })
    worlds.push({ ...rekeyed, fake: { close: async () => {} } as never })
    const list = await client(rekeyed, connected.seller.cookie).get('/api/youtube/live-broadcasts')
    expect(list.status).toBe(409)
    expect(list.body).toMatchObject({ error: { code: 'YOUTUBE_RECONNECT_NEEDED', message: '유튜브 연결을 다시 해 주세요.' } })
    expect((await client(rekeyed, connected.seller.cookie).get('/api/youtube/connection')).body.connection).toMatchObject({ status: 'RECONNECT_NEEDED' })
  })
})

describe('AC-Y1-04 새로 고침과 "다시 연결 필요"', () => {
  it('만료 60초 안이면 새로 고친다. 동시에 여러 요청이 와도 토큰 요청은 1번', async () => {
    const w = await world()
    const { seller } = await connectSeller(w)
    await w.timer.advance(3600 * 1000 - 30_000)
    const api = client(w, seller.cookie)
    const results = await Promise.all([api.get('/api/youtube/live-broadcasts'), api.get('/api/youtube/live-broadcasts'), api.get('/api/youtube/live-broadcasts')])
    expect(results.map((result) => result.status)).toEqual([200, 200, 200])
    expect(w.fake.calls('oauth.refresh')).toBe(1)
  })

  it('유튜브가 401이면 한 번 새로 고쳐 한 번 더', async () => {
    const w = await world()
    const { seller } = await connectSeller(w)
    w.fake.expireAccessTokens()
    const response = await client(w, seller.cookie).get('/api/youtube/live-broadcasts')
    expect(response.status).toBe(200)
    expect(w.fake.calls('oauth.refresh')).toBe(1)
    expect(w.fake.calls('liveBroadcasts.list')).toBe(2)
  })

  it('invalid_grant면 "다시 연결 필요" — 수집기를 멈추고(상태 문장), 같은 채널로 다시 연결하면 이어서 수집한다. 판매 기록은 그대로', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    const collectors = w.server.youtube?.collectors
    if (collectors === undefined) throw new Error('유튜브가 없다')
    collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCviewer1', name: '영희', text: '안녕' })
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 1)
    // 사용자가 권한을 거둠 → 스트림이 끊겨 다시 열 때 401 → 새로 고침이 invalid_grant
    w.fake.revokeAll()
    w.fake.dropStreams()
    await until(w, async () => ((await client(w, connected.seller.cookie).get('/api/youtube/connection')).body.connection as { status: string }).status === 'RECONNECT_NEEDED', { step: 1000 })
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { status: string }).status === 'STOPPED', { step: 1000 })
    const stopped = (await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector
    expect(stopped).toMatchObject({ status: 'STOPPED', reason: 'RECONNECT', statusMessage: '유튜브 연결을 다시 해 주세요.' })
    const before = (await client(w, connected.seller.cookie).get(`/api/days/${b.date}`)).body
    // 그동안 쓴 채팅
    w.fake.addMessage(liveChatId, { author: 'UCviewer2', name: '철수', text: '반가워요' })
    // 같은 채널로 다시 연결
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    const again = await client(w, connected.seller.cookie).post('/api/youtube/connection/start', {})
    expect(await callback(w, connected.seller.cookie, await approve(again.body.authorizeUrl as string))).toBe('connected')
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 2, { step: 1000 })
    const after = (await client(w, connected.seller.cookie).get(`/api/days/${b.date}`)).body
    expect((after.buyers as unknown[]).length).toBeGreaterThanOrEqual((before.buyers as unknown[]).length)
    await collectors.stop()
  })
})

describe('AC-Y1-06 끊기 — 도는 수집기도 멈춘다', () => {
  it('스트림이 열린 채 도는 수집기가 끊기 뒤 바로 멈추고(열린 스트림 0), 기록한 채팅은 그대로', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    const api = client(w, connected.seller.cookie)
    await until(w, async () => ((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 1, { step: 100 })
    expect(w.fake.openStreams.get(liveChatId)).toBe(1)
    await api.post('/api/youtube/connection/disconnect', {})
    await until(w, async () => ((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { status: string }).status === 'STOPPED', { step: 100 })
    expect((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector).toMatchObject({ status: 'STOPPED', reason: 'NOT_CONNECTED', recorded: 1 })
    await until(w, () => (w.fake.openStreams.get(liveChatId) ?? 0) === 0, { step: 100 })
    // 같은 채널로 다시 연결하면 이어서 수집
    w.fake.addMessage(liveChatId, { author: 'UCb', name: '나', text: '끊긴 동안', publishedAt: w.timer.now() + 1 })
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    expect(await callback(w, connected.seller.cookie, await approve((await api.post('/api/youtube/connection/start', {})).body.authorizeUrl as string))).toBe('connected')
    await until(w, async () => ((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 2, { step: 1000 })
    await w.server.youtube?.collectors.stop()
  })
})

describe('AC-Y1-05·06 상태 조회·끊기', () => {
  it('상태가 바뀌면 그 판매자의 SSE로 알린다 (토큰·만료 시각 없음)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const response = await client(w, seller.cookie).raw('/api/stream', {})
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const read = (async () => {
      for (;;) {
        const chunk = await reader?.read()
        if (chunk === undefined || chunk.done) break
        text += decoder.decode(chunk.value)
        if (text.includes('"kind":"connection"')) break
      }
    })()
    await connectSeller(w, { seller })
    await read
    await reader?.cancel()
    expect(text).toContain('event: youtube')
    expect(text).toContain('"status":"CONNECTED"')
    for (const token of w.fake.issuedTokens()) expect(text).not.toContain(token)
    expect(text).not.toMatch(/expires|access_?token|refresh/i)
  })

  it('끊기: 구글에 폐기 요청(실패해도 계속), 토큰·동의 삭제, NOT_CONNECTED. 끊은 뒤 다른 채널 연결 가능, 이전 채널 방송의 수집은 "내 채널의 방송이 아니에요."', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b } = await linkedBroadcast(w, connected)
    w.fake.fail('oauth.revoke', { status: 500 })
    const api = client(w, connected.seller.cookie)
    const response = await api.post('/api/youtube/connection/disconnect', {})
    expect(response.status).toBe(200)
    expect(response.body.connection).toMatchObject({ status: 'NOT_CONNECTED', channel: null, consent: { liveChat: { enabled: false }, videoComment: { enabled: false } } })
    expect(w.fake.calls('oauth.revoke')).toBe(1)
    const rows = await w.database.db.execute(sql`select count(*)::int as n from youtube_connections`)
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(0)
    // 다른 채널 연결
    const account = w.fake.addAccount()
    const other = w.fake.addChannel(account, '새 채널')
    w.fake.approval = { account, channel: other.id }
    expect(await callback(w, connected.seller.cookie, await approve((await api.post('/api/youtube/connection/start', {})).body.authorizeUrl as string))).toBe('connected')
    await w.server.youtube?.collectors.scan()
    const view = (await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector
    expect(view).toMatchObject({ status: 'STOPPED', reason: 'NOT_MY_CHANNEL', statusMessage: '내 채널의 방송이 아니에요.' })
    expect(PUBLISH_SCOPE).toContain('force-ssl')
  })
})

describe('AC-Y1-04·05·31 다시 연결 뒤 게시 권한과 동의', () => {
  it('동의를 켠 판매자가 "다시 연결 필요" 뒤 같은 채널로 다시 연결하면 게시 권한도 함께 요청한다(include_granted_scopes) — 받으면 동의 그대로, 빼면 동의를 끈다(NO_CONSENT)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const api = client(w, connected.seller.cookie)
    const reconnectNeeded = async () => {
      w.fake.revokeAll()
      w.fake.expireAccessTokens()
      await api.get('/api/youtube/live-broadcasts')
      expect(((await api.get('/api/youtube/connection')).body.connection as { status: string }).status).toBe('RECONNECT_NEEDED')
    }
    await reconnectNeeded()
    // 다시 연결 — 게시 권한까지 요청하고, 받으면 동의가 켜진 그대로 게시 권한도 있다
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    const started = await api.post('/api/youtube/connection/start', {})
    const url = new URL(started.body.authorizeUrl as string)
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([READ_SCOPE, PUBLISH_SCOPE].sort())
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(await callback(w, connected.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    expect((await api.get('/api/youtube/connection')).body.connection).toMatchObject({ status: 'CONNECTED', permissions: { publish: true }, consent: { liveChat: { enabled: true } } })
    // 기다리는 감사가 있는 채로 다시 "다시 연결 필요" → 이번엔 구글 화면에서 게시 권한을 빼고 승인한다
    const { b } = await linkedBroadcast(w, connected, { settings: { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 60 } })
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCa', nick: '가', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    await w.server.youtube?.outbox.runOnce()
    await reconnectNeeded()
    w.fake.approval = { account: connected.account, channel: connected.channel.id, grant: [READ_SCOPE] }
    const again = await api.post('/api/youtube/connection/start', {})
    expect(await callback(w, connected.seller.cookie, await approve(again.body.authorizeUrl as string))).toBe('connected')
    // 켜진 동의는 늘 게시 권한과 함께다 — 권한이 없으면 동의가 꺼지고 기다리던 행은 보내지 못함
    expect((await api.get('/api/youtube/connection')).body.connection).toMatchObject({ status: 'CONNECTED', permissions: { publish: false }, consent: { liveChat: { enabled: false, at: null } } })
    const rows = (await api.get(`/api/days/${b.date}/outbox`)).body.rows as { state: string; reason: string }[]
    expect(rows.map((row) => [row.state, row.reason])).toEqual([['FAILED', 'NO_CONSENT']])
  })

  it('동의도 게시 권한도 없던 연결의 다시 연결은 읽기 권한 하나만 요청한다 (AC-Y1-01)', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const started = await client(w, connected.seller.cookie).post('/api/youtube/connection/start', {})
    const url = new URL(started.body.authorizeUrl as string)
    expect(url.searchParams.get('scope')).toBe(READ_SCOPE)
    expect(url.searchParams.get('include_granted_scopes')).toBeNull()
  })
})
