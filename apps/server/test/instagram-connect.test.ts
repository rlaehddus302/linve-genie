// N2 인스타그램 계정 연결 (AC-N2-10~17, D-N2-06·D-N2-11): 가짜 메타 서버(실제 HTTP)로 승인·거절·권한 빼기·계정 0/1/2개, 구독, 토큰 보관·새로 고침·다시 연결 필요·끊기·설정 없음.
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SCOPES, readInstagramConfig } from '../src/instagram/config.ts'
import { REFRESH_AFTER_MS } from '../src/instagram/connection.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { callback, connectedShop, connectInstagram, igWorld, type IgWorld } from './instagram-support.ts'
import { addSeller, client, login, startServer } from './support.ts'

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})

async function world(options: Parameters<typeof igWorld>[0] = {}): Promise<IgWorld> {
  ig = await igWorld(options)
  return ig
}

/** DB 전체(모든 표의 모든 글 열)에서 문자열 찾기 */
async function dbContains(w: IgWorld, needle: string): Promise<string[]> {
  const pg = w.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  const columns = await pg.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type in ('text', 'character varying')`,
  )
  const found: string[] = []
  for (const column of columns.rows) {
    const hit = await pg.query<{ n: number }>(`select count(*)::int as n from "${column.table_name}" where position($1 in "${column.column_name}") > 0`, [needle])
    if ((hit.rows[0]?.n ?? 0) > 0) found.push(`${column.table_name}.${column.column_name}`)
  }
  return found
}

describe('AC-N2-10 연결 시작 — 승인 주소', () => {
  it('페이스북 로그인(기본): 앱 ID·돌아오는 주소·code·32바이트 이상 state·댓글과 메시지 권한을 함께', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const started = await client(w, seller.cookie).post('/api/instagram/connect', {})
    expect(started.status).toBe(200)
    const url = new URL(started.body.url as string)
    expect(`${url.origin}${url.pathname}`).toBe(`${w.fake.url}/dialog/oauth`)
    expect(url.searchParams.get('client_id')).toBe(w.fake.appId)
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.livejjim.test/api/instagram/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')?.split(',')).toEqual(DEFAULT_SCOPES.FACEBOOK)
    const state = url.searchParams.get('state') ?? ''
    expect(Buffer.from(state, 'base64url').length).toBeGreaterThanOrEqual(32)
    // state 원문은 어디에도 남지 않는다 (해시만)
    expect(await dbContains(w, state)).toEqual([])
    expect(JSON.stringify(w.logs)).not.toContain(state)
  })

  it('인스타그램 로그인 어댑터: 승인 창 주소와 권한이 다르다', async () => {
    const w = await world({ login: 'INSTAGRAM' })
    const seller = await addSeller(w)
    const url = new URL((await client(w, seller.cookie).post('/api/instagram/connect', {})).body.url as string)
    expect(`${url.origin}${url.pathname}`).toBe(`${w.fake.url}/oauth/authorize`)
    expect(url.searchParams.get('scope')?.split(',')).toEqual(['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages'])
  })

  it('Origin이 다르면 403, 로그인이 없으면 401', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const foreign = await w.server.app.request('/api/instagram/connect', { method: 'POST', headers: { Cookie: seller.cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' })
    expect(foreign.status).toBe(403)
    expect((await client(w, null).post('/api/instagram/connect', {})).status).toBe(401)
  })
})

describe('AC-N2-11·12 돌아오기 — 토큰·계정 확인·구독', () => {
  it('계정 하나·모든 권한 → 연결됨, 계정 정보·권한 저장, 그 계정 하나만 구독', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w, { username: 'pink.shop', type: 'MEDIA_CREATOR' })
    const view = (await client(w, seller.cookie).get('/api/instagram')).body.connection as Record<string, unknown>
    expect(view).toEqual({
      configured: true,
      status: 'CONNECTED',
      login: 'FACEBOOK',
      account: { id: account.id, username: 'pink.shop', type: 'CREATOR' },
      permissions: { comments: true, messages: true },
      consent: { on: false, by: null, at: null },
    })
    expect(w.fake.subscriptions).toEqual([{ node: account.pageId, fields: 'live_comments' }])
  })

  it('인스타그램 로그인: 짧은 토큰 → 긴 토큰(60일)·계정 정보, 계정 구독', async () => {
    const w = await world({ login: 'INSTAGRAM' })
    const { seller, account } = await connectedShop(w)
    const view = (await client(w, seller.cookie).get('/api/instagram')).body.connection as Record<string, unknown>
    expect(view.login).toBe('INSTAGRAM')
    expect(view.account).toEqual({ id: account.id, username: account.username, type: 'BUSINESS' })
    expect(w.fake.subscriptions).toEqual([{ node: account.id, fields: 'live_comments' }])
  })

  it('받지 않는 경우: 거절·계정 0개(개인 계정 포함)·2개·댓글 권한 빼기 — 토큰을 저장하지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const a = w.fake.addAccount({ username: 'a.shop' })
    const b = w.fake.addAccount({ username: 'b.shop' })
    const personal = w.fake.addAccount({ username: 'me.personal', type: 'PERSONAL' })
    expect(await connectInstagram(w, seller, { accounts: [a.id], decision: 'deny' })).toBe('DENIED')
    expect(await connectInstagram(w, seller, { accounts: [] })).toBe('NO_ACCOUNT')
    expect(await connectInstagram(w, seller, { accounts: [personal.id] })).toBe('NO_ACCOUNT')
    expect(await connectInstagram(w, seller, { accounts: [a.id, b.id] })).toBe('MANY_ACCOUNTS')
    expect(await connectInstagram(w, seller, { accounts: [a.id], declined: ['instagram_manage_comments'] })).toBe('NO_COMMENT_PERMISSION')
    expect(((await client(w, seller.cookie).get('/api/instagram')).body.connection as { status: string }).status).toBe('NOT_CONNECTED')
    expect(w.fake.subscriptions).toEqual([])
  })

  it('메시지 권한만 빼면 연결되고 메시지 권한 없음으로 저장한다', async () => {
    const w = await world()
    const { seller } = await connectedShop(w, { declined: ['instagram_manage_messages'] })
    expect(((await client(w, seller.cookie).get('/api/instagram')).body.connection as { permissions: unknown }).permissions).toEqual({ comments: true, messages: false })
  })

  it('state: 없음·다름·10분 지남·이미 씀·다른 세션 → STATE_INVALID, 같은 code·state 두 번은 한 번만 처리', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const other = await addSeller(w)
    const account = w.fake.addAccount({ username: 'x.shop' })
    w.fake.setLogin({ accounts: [account.id] })
    const api = client(w, seller.cookie)
    // 없음·다름
    expect(await callback(w, seller.cookie, 'https://api.livejjim.test/api/instagram/callback?code=abc')).toBe('STATE_INVALID')
    expect(await callback(w, seller.cookie, 'https://api.livejjim.test/api/instagram/callback?code=abc&state=nope')).toBe('STATE_INVALID')
    // 다른 세션 (같은 판매자의 다른 로그인 세션도) — state를 쓰지 않는다
    const location = await w.fake.authorize((await api.post('/api/instagram/connect', {})).body.url as string)
    expect(await callback(w, other.cookie, location)).toBe('STATE_INVALID')
    expect(await callback(w, await login(w, seller.loginId, seller.password), location)).toBe('STATE_INVALID')
    expect(await callback(w, null, location)).toBe('STATE_INVALID')
    // 그 세션이면 처리, 같은 것을 다시 오면 이미 씀
    expect(await callback(w, seller.cookie, location)).toBe('CONNECTED')
    const tokenCalls = w.fake.count('token')
    expect(await callback(w, seller.cookie, location)).toBe('STATE_INVALID')
    expect(w.fake.count('token')).toBe(tokenCalls)
    // 10분 지남
    const late = await w.fake.authorize((await api.post('/api/instagram/connect', {})).body.url as string)
    w.clock.advance(10 * 60 * 1000)
    expect(await callback(w, seller.cookie, late)).toBe('STATE_INVALID')
  })

  it('계정 하나는 판매자 하나에만, 판매자는 처음 계정만 (같은 계정이면 다시 연결)', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const other = await addSeller(w)
    expect(await connectInstagram(w, other, { accounts: [account.id] })).toBe('ACCOUNT_TAKEN')
    const second = w.fake.addAccount({ username: 'second.shop' })
    expect(await connectInstagram(w, seller, { accounts: [second.id] })).toBe('OTHER_ACCOUNT')
    expect(await connectInstagram(w, seller, { accounts: [account.id] })).toBe('CONNECTED')
    expect(w.fake.subscriptions.map((item) => item.node)).toEqual([account.pageId, account.pageId])
  })

  it('웹훅 구독이 실패하면 저장하지 않는다 (SUBSCRIBE_FAILED)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const account = w.fake.addAccount({ username: 'sub.fail' })
    w.fake.fail('subscribe', 'SERVER_ERROR')
    expect(await connectInstagram(w, seller, { accounts: [account.id] })).toBe('SUBSCRIBE_FAILED')
    expect(((await client(w, seller.cookie).get('/api/instagram')).body.connection as { status: string }).status).toBe('NOT_CONNECTED')
  })
})

describe('AC-N2-13 토큰 보관', () => {
  it('가짜 서버가 준 토큰 문자열이 DB 어느 글 열에도·응답·로그·SSE에도 없다', async () => {
    const w = await world()
    const { seller } = await connectedShop(w, { consent: true })
    expect(w.fake.issuedTokens.length).toBeGreaterThan(0)
    const view = (await client(w, seller.cookie).get('/api/instagram')).text
    for (const token of w.fake.issuedTokens) {
      expect(await dbContains(w, token)).toEqual([])
      expect(view).not.toContain(token)
      expect(JSON.stringify(w.logs)).not.toContain(token)
      expect(JSON.stringify(w.published)).not.toContain(token)
    }
    expect(JSON.stringify(w.published)).not.toContain(w.fake.appSecret)
  })

  it('마스터 키가 바뀌어 토큰을 풀 수 없으면 서버는 죽지 않고 "다시 연결 필요"로 본다', async () => {
    const w = await world()
    const { seller } = await connectedShop(w)
    w.server.close()
    const restarted = startServer(w.database, generateMasterKey(), { clock: w.clock, instagram: w.fake.settings({ redirectUri: 'https://api.livejjim.test/api/instagram/callback' }), dmAutoRun: false })
    // 판매자 전화번호 키와 별개로 — 인스타그램 토큰만 풀리지 않는다. 라이브 목록을 부르면 다시 연결 필요
    const cookie = seller.cookie
    const lives = await client(restarted, cookie).get('/api/instagram/lives')
    expect(lives.status).toBe(409)
    expect((lives.body.error as { code: string }).code).toBe('RECONNECT_NEEDED')
    expect(((await client(restarted, cookie).get('/api/instagram')).body.connection as { status: string }).status).toBe('RECONNECT_NEEDED')
    restarted.server.close()
  })
})

describe('AC-N2-14 새로 고침·다시 연결 필요', () => {
  it('인스타그램 로그인 긴 토큰: 만료 7일 안·받은 지 24시간 지남 → 메타 호출 전에 새로 고침, 동시 요청에도 한 번', async () => {
    const w = await world({ login: 'INSTAGRAM' })
    const { seller } = await connectedShop(w)
    const api = client(w, seller.cookie)
    expect((await api.get('/api/instagram/lives')).status).toBe(200)
    expect(w.fake.count('refresh')).toBe(0)
    // 60일 토큰: 25시간 뒤엔 만료가 멀어 새로 고치지 않는다
    w.clock.advance(REFRESH_AFTER_MS + 60 * 60 * 1000)
    expect((await api.get('/api/instagram/lives')).status).toBe(200)
    expect(w.fake.count('refresh')).toBe(0)
    // 만료 6일 전 (로그인 세션은 30일이라 다시 로그인한다)
    w.clock.advance(54 * 24 * 60 * 60 * 1000)
    const fresh = client(w, await login(w, seller.loginId, seller.password))
    const results = await Promise.all([fresh.get('/api/instagram/lives'), fresh.get('/api/instagram/lives'), fresh.get('/api/instagram/lives')])
    expect(results.map((result) => result.status)).toEqual([200, 200, 200])
    expect(w.fake.count('refresh')).toBe(1)
  })

  it('페이스북 로그인의 페이지 토큰은 새로 고치지 않는다', async () => {
    const w = await world()
    const { seller } = await connectedShop(w)
    w.clock.advance(59 * 24 * 60 * 60 * 1000)
    expect((await client(w, await login(w, seller.loginId, seller.password)).get('/api/instagram/lives')).status).toBe(200)
    expect(w.fake.count('refresh')).toBe(0)
  })

  it('토큰 무효 → 다시 연결 필요 + SSE, 같은 계정으로 다시 연결하면 연결됨', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    w.fake.invalidateTokens(account.id)
    const lives = await client(w, seller.cookie).get('/api/instagram/lives')
    expect((lives.body.error as { code: string }).code).toBe('RECONNECT_NEEDED')
    await w.server.instagram.dms.settled()
    await new Promise((resolve) => setImmediate(resolve))
    const notices = w.published.filter((item) => item.sellerId === seller.sellerId && item.data.kind === 'CONNECTION').map((item) => (item.data.connection as { status: string }).status)
    expect(notices.at(-1)).toBe('RECONNECT_NEEDED')
    expect(await connectInstagram(w, seller, { accounts: [account.id] })).toBe('CONNECTED')
    expect(((await client(w, seller.cookie).get('/api/instagram')).body.connection as { status: string }).status).toBe('CONNECTED')
  })
})

describe('AC-N2-15·16 상태 조회·끊기', () => {
  it('끊기: 구독 해제·권한 철회를 요청하고(실패해도 계속) 토큰·동의를 지운다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w, { consent: true })
    w.fake.fail('revoke', 'SERVER_ERROR')
    const result = await client(w, seller.cookie).post('/api/instagram/disconnect', {})
    expect(result.status).toBe(200)
    expect(result.body.connection).toEqual({ configured: true, status: 'NOT_CONNECTED', login: null, account: null, permissions: { comments: false, messages: false }, consent: { on: false, by: null, at: null } })
    expect(w.fake.unsubscriptions).toEqual([account.pageId])
    expect(w.fake.count('revoke')).toBe(1)
    const rows = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from ig_connections where seller_id = $1`, [seller.sellerId])
    expect(rows?.rows[0]?.n).toBe(0)
  })

  it('동의: 기본 꺼짐, 켜면 켠 계정·시각, 다시 켜도 그대로, 메시지 권한이 없으면 승인 주소', async () => {
    const w = await world()
    const { seller } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const on = await api.post('/api/instagram/consent', { on: true })
    const consent = (on.body.connection as { consent: { on: boolean; by: string; at: string } }).consent
    expect(consent).toEqual({ on: true, by: seller.loginId, at: new Date(w.clock.now()).toISOString() })
    w.clock.advance(5000)
    const again = await api.post('/api/instagram/consent', { on: true })
    expect((again.body.connection as { consent: unknown }).consent).toEqual(consent)
    expect(((await api.post('/api/instagram/consent', { on: false })).body.connection as { consent: unknown }).consent).toEqual({ on: false, by: null, at: null })

    const other = await connectedShop(w, { declined: ['instagram_manage_messages'] })
    const otherApi = client(w, other.seller.cookie)
    const ask = await otherApi.post('/api/instagram/consent', { on: true })
    expect(ask.body.permissionRequired).toBe(true)
    expect(((ask.body.connection as { consent: { on: boolean } }).consent.on)).toBe(false)
    // 승인을 마치고 돌아와 권한을 받지 못하면 꺼진 그대로, 받으면 켜진다
    expect(await connectInstagram(w, other.seller, { accounts: [other.account.id], declined: ['instagram_manage_messages'] }, 'consent')).toBe('NO_MESSAGE_PERMISSION')
    expect(((await otherApi.get('/api/instagram')).body.connection as { consent: { on: boolean } }).consent.on).toBe(false)
    expect(await connectInstagram(w, other.seller, { accounts: [other.account.id] }, 'consent')).toBe('CONSENT_ON')
    expect(((await otherApi.get('/api/instagram')).body.connection as { consent: { on: boolean }; permissions: unknown }).consent.on).toBe(true)
  })
})

describe('AC-N2-17 설정이 없을 때', () => {
  it('NOT_CONFIGURED·웹훅 503·ready 아니오, 서버는 정상, 다른 기능 그대로', async () => {
    const w = await world({ configured: false })
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const connect = await api.post('/api/instagram/connect', {})
    expect(connect.status).toBe(409)
    expect(connect.body.error).toEqual({ code: 'NOT_CONFIGURED', message: '인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.' })
    expect((await api.post('/api/instagram/consent', { on: true })).body.error).toMatchObject({ code: 'NOT_CONFIGURED' })
    expect((await api.get('/api/instagram/lives')).body.error).toMatchObject({ code: 'NOT_CONFIGURED' })
    expect((await w.server.app.request('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status).toBe(503)
    expect((await w.server.app.request('/webhooks/instagram', { method: 'POST', body: '{}' })).status).toBe(503)
    const platforms = (await api.get('/api/platforms')).body.platforms as { platform: string; ready: boolean }[]
    expect(platforms.find((item) => item.platform === 'INSTAGRAM')?.ready).toBe(false)
    expect((await api.post('/api/broadcasts', { requestId: 'b-1', date: '2026-10-19' })).status).toBe(200)
  })

  it('필수 값 넷 중 하나라도 없으면 설정 없음, 비밀값은 오류 문장에 없다', () => {
    const full = { LIVEJJIM_IG_APP_ID: '1', LIVEJJIM_IG_APP_SECRET: 'sek-123', LIVEJJIM_IG_VERIFY_TOKEN: 'ver-456', LIVEJJIM_IG_REDIRECT_URI: 'https://a.test/api/instagram/callback' }
    expect(readInstagramConfig(full)).toMatchObject({ ok: true, settings: { appId: '1', login: 'FACEBOOK' } })
    for (const key of Object.keys(full)) expect(readInstagramConfig({ ...full, [key]: '' })).toEqual({ ok: true, settings: null })
    const bad = readInstagramConfig({ ...full, LIVEJJIM_IG_LOGIN: 'sek-123' })
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).not.toContain('sek-123')
    expect(readInstagramConfig({ ...full, LIVEJJIM_IG_LOGIN: 'INSTAGRAM' })).toMatchObject({ ok: true, settings: { login: 'INSTAGRAM' } })
  })

  it('비밀 설정값은 설정 조회·연결 상태·플랫폼 조회·로그에 나오지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const texts = [(await api.get('/api/client-config')).text, (await api.get('/api/instagram')).text, (await api.get('/api/platforms')).text, (await api.get('/api/settings')).text, JSON.stringify(w.logs)]
    for (const text of texts) {
      expect(text).not.toContain(w.fake.appSecret)
      expect(text).not.toContain(w.fake.verifyToken)
    }
  })
})
