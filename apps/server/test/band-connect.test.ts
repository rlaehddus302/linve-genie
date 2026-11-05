// 밴드 계정 연결 (BND1, AC-BND1-11~15) — 경로 표 OAuth·토큰 받기·다시 연결·끊기·권한·격리. 가짜 밴드 서버.
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, ORIGIN, rid } from './support.ts'
import { approve, bandSeller, bandView, bandWorld, callback, connectBand, guestComment, linkBand, realBroadcast, REDIRECT, tick, type BandWorld } from './band-support.ts'

let w: BandWorld | null = null
afterEach(async () => {
  await w?.close()
  w = null
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

const states = async (w: BandWorld): Promise<number> => (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from band_oauth_states`))?.rows[0]?.n ?? -1

describe('AC-BND1-11 연결 시작', () => {
  it('승인 창 주소: response_type·client_id·redirect_uri(돌아오는 주소/표 — 부호화)·state', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const started = await client(w, seller.cookie).post('/api/band/connect', {})
    expect(started.status).toBe(200)
    const url = new URL(started.body.url as string)
    expect(`${url.origin}${url.pathname}`).toBe(`${w.fake.origin}/oauth2/authorize`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(w.fake.clientId)
    const redirect = url.searchParams.get('redirect_uri') as string
    const state = url.searchParams.get('state') as string
    expect(redirect).toBe(`${REDIRECT}/${state}`)
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(started.body.url as string).toContain(encodeURIComponent(`${REDIRECT}/${state}`))
    // 표 원문은 저장하지 않는다 (해시만)
    const dump = JSON.stringify((await w.database.pglite?.query(`select * from band_oauth_states`))?.rows)
    expect(dump).not.toContain(state)
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('설정이 없으면 409 NOT_CONFIGURED · 로그인 안 함 401 — 아무것도 만들지 않는다', async () => {
    const w = await world({ notConfigured: true })
    const seller = await addSeller(w)
    const refused = await client(w, seller.cookie).post('/api/band/connect', {})
    expect(refused.status).toBe(409)
    expect(refused.body.error).toEqual({ code: 'NOT_CONFIGURED', message: '밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.' })
    expect((await client(w, null).post('/api/band/connect', {})).status).toBe(401)
    expect(await states(w)).toBe(0)
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toEqual({ status: 'NOT_CONFIGURED', message: '밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.', profileName: null, connectedAt: null, chosenBand: null })
  })
})

describe('AC-BND1-12 돌아오기 — 다섯 갈래', () => {
  async function started(w: BandWorld) {
    const seller = await addSeller(w)
    const userKey = w.fake.addUser('다육가게')
    const response = await client(w, seller.cookie).post('/api/band/connect', {})
    return { seller, userKey, url: response.body.url as string }
  }

  it('connected: 토큰·user_key를 받고 저장, 프로필 이름. Basic 인증으로 토큰 요청', async () => {
    const w = await world()
    const { seller, userKey, url } = await started(w)
    w.fake.nextLogin({ decision: 'approve', userKey })
    expect(await callback(w, seller, await approve(w, url))).toBe('connected')
    const view = (await client(w, seller.cookie).get('/api/band')).body
    expect(view.band).toEqual({ status: 'CONNECTED', message: null, profileName: '다육가게', connectedAt: new Date(w.clock.now()).toISOString(), chosenBand: null })
    const text = JSON.stringify(view)
    expect(text).not.toContain(userKey)
    expect(w.fake.calls('token')).toHaveLength(1)
    expect(w.fake.calls('token')[0]?.query).toMatchObject({ grant_type: 'authorization_code' })
  })

  it('denied: code 없음 (밴드에서 거부)', async () => {
    const w = await world()
    const { seller, url } = await started(w)
    w.fake.nextLogin({ decision: 'deny' })
    expect(await callback(w, seller, await approve(w, url))).toBe('denied')
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'NOT_CONNECTED', message: '설정에서 밴드를 먼저 연결해 주세요.' })
    expect(w.fake.calls('token')).toHaveLength(0)
  })

  it('expired: 표를 두 번 쓰기 · 다른 판매자 세션 · 11분 뒤 · 로그인 안 함 · 모르는 표', async () => {
    const w = await world()
    const { seller, userKey, url } = await started(w)
    w.fake.nextLogin({ decision: 'approve', userKey })
    const back = await approve(w, url)
    const other = await addSeller(w)
    // 다른 판매자 세션으로 돌아오기 → expired (그 표는 쓰지 않은 채)
    expect(await callback(w, other, back)).toBe('expired')
    expect(await callback(w, null, back)).toBe('expired')
    expect(await callback(w, seller, back)).toBe('connected')
    expect(await callback(w, seller, back)).toBe('expired')
    expect(await callback(w, seller, '/api/band/callback/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?code=x')).toBe('expired')
    expect(await callback(w, seller, '/api/band/callback/..%2F..%2Fsettings?code=x')).toBe('expired')
    expect(await callback(w, seller, `/api/band/callback/${'A'.repeat(300)}?code=x`)).toBe('expired')
    // 11분 뒤
    const late = await client(w, seller.cookie).post('/api/band/connect', {})
    w.fake.nextLogin({ decision: 'approve', userKey })
    const lateBack = await approve(w, late.body.url as string)
    await w.bclock.advance(11 * 60 * 1000)
    expect(await callback(w, seller, lateBack)).toBe('expired')
    expect(await callback(w, other, `/api/band/callback/x?code=1`)).toBe('expired')
    expect(w.fake.calls('token')).toHaveLength(1)
  })

  it('scope: 세 권한 중 하나라도 없으면 토큰을 저장하지 않는다 · scope 칸이 없으면 검사하지 않고 받는다', async () => {
    const w = await world()
    const { seller, userKey, url } = await started(w)
    w.fake.nextLogin({ decision: 'approve', userKey, scope: 'READ_BAND_AND_USERS_LIST READ_POST' })
    expect(await callback(w, seller, await approve(w, url))).toBe('scope')
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'NOT_CONNECTED' })
    const again = await client(w, seller.cookie).post('/api/band/connect', {})
    w.fake.nextLogin({ decision: 'approve', userKey, scope: null })
    expect(await callback(w, seller, await approve(w, again.body.url as string))).toBe('connected')
  })

  it('failed: 토큰 응답 오류·HTTP 5xx·JSON 아님·10초 넘김·access_token 없음, user_key가 토큰·프로필 둘 다 없음 · code 여러 개', async () => {
    const w = await world({ timeoutMs: 200 })
    const { seller, userKey } = await started(w)
    const once = async (prepare: () => void, mutate?: (path: string) => string): Promise<string> => {
      const response = await client(w, seller.cookie).post('/api/band/connect', {})
      w.fake.nextLogin({ decision: 'approve', userKey })
      const back = await approve(w, response.body.url as string)
      prepare()
      return callback(w, seller, mutate === undefined ? back : mutate(back))
    }
    expect(await once(() => w.fake.fail('token', { tokenError: 'invalid_grant' }))).toBe('failed')
    expect(await once(() => w.fake.fail('token', { http: 500 }))).toBe('failed')
    expect(await once(() => w.fake.fail('token', 'NOT_JSON'))).toBe('failed')
    expect(await once(() => w.fake.fail('token', 'HANG'))).toBe('failed')
    w.fake.releaseHanging()
    expect(await once(() => w.fake.fail('token', 'BAD_SHAPE'))).toBe('failed')
    expect(await once(() => undefined, (path) => `${path}&code=second`)).toBe('failed')
    // user_key가 토큰 응답에 없으면 프로필의 것 (연결됨)
    const response = await client(w, seller.cookie).post('/api/band/connect', {})
    w.fake.nextLogin({ decision: 'approve', userKey, omitUserKey: true })
    expect(await callback(w, seller, await approve(w, response.body.url as string))).toBe('connected')
    // 둘 다 없으면 실패 (프로필도 실패)
    const other = await addSeller(w)
    const started2 = await client(w, other.cookie).post('/api/band/connect', {})
    w.fake.nextLogin({ decision: 'approve', userKey: w.fake.addUser('둘째'), omitUserKey: true })
    const back2 = await approve(w, started2.body.url as string)
    w.fake.fail('profile', 'BAD_SHAPE')
    expect(await callback(w, other, back2)).toBe('failed')
    expect((await client(w, other.cookie).get('/api/band')).body.band).toMatchObject({ status: 'NOT_CONNECTED' })
  })

  it('프로필 실패여도 연결은 성공 (이름 없음)', async () => {
    const w = await world()
    const { seller, userKey, url } = await started(w)
    w.fake.nextLogin({ decision: 'approve', userKey })
    const back = await approve(w, url)
    w.fake.fail('profile', { resultCode: 3000 })
    expect(await callback(w, seller, back)).toBe('connected')
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'CONNECTED', profileName: null })
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('돌아오기 결과는 화면 주소의 ?band=<코드>만 (토큰·code 없음)', async () => {
    const w = await world()
    const { seller, userKey, url } = await started(w)
    w.fake.nextLogin({ decision: 'approve', userKey })
    const back = await approve(w, url)
    const ok = await client(w, seller.cookie).raw(back, { method: 'GET' })
    const location = ok.headers.get('location') as string
    expect(location).toBe(`${ORIGIN}/settings/band?band=connected`)
    expect(ok.headers.get('referrer-policy')).toBe('no-referrer')
  })
})

describe('AC-BND1-13 토큰 만료 시각', () => {
  it('expires_in이 지나면 부르지 않고 RECONNECT_NEEDED', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const userKey = w.fake.addUser('가게')
    const bandKey = w.fake.addBand({ name: '방', members: [userKey] })
    w.fake.nextLogin({ decision: 'approve', userKey, expiresIn: 3600 })
    expect(await connectBand(w, seller)).toBe('connected')
    expect((await client(w, seller.cookie).get('/api/band/bands')).status).toBe(200)
    await w.bclock.advance(3601 * 1000)
    const before = w.fake.requests.length
    const refused = await client(w, seller.cookie).get(`/api/band/posts?band=${bandKey}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toEqual({ code: 'RECONNECT_NEEDED', message: '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.' })
    expect(w.fake.requests.length).toBe(before)
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'RECONNECT_NEEDED', message: '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.' })
  })
})

describe('AC-BND1-14 다시 연결·끊기', () => {
  it('같은 user_key로 다시 연결: 토큰만 바꾸고 멈춘 글 연결을 이어 읽는다', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    w.fake.revoke(userKey)
    await tick(w, 10_000)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'RECONNECT_NEEDED' })
    w.fake.nextLogin({ decision: 'approve', userKey })
    expect(await connectBand(w, seller)).toBe('connected')
    await tick(w, 0)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING' })
  })

  it('다른 user_key로 연결: 열린 밴드 글 연결을 모두 끝내고(계정 바꿈) 기억한 밴드를 지운다', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    expect((await client(w, seller.cookie).get(`/api/band/posts?band=${bandKey}`)).status).toBe(200)
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ chosenBand: bandKey })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    const second = w.fake.addUser('새 계정')
    w.fake.nextLogin({ decision: 'approve', userKey: second })
    expect(await connectBand(w, seller)).toBe('connected')
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'FINISHED', finishReason: 'ACCOUNT_CHANGED', message: '다른 밴드 계정으로 바꿔서 밴드 글 연결을 끝냈어요.' })
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'CONNECTED', chosenBand: null, profileName: '새 계정' })
    const before = w.fake.calls('comments').length
    await tick(w, 30_000)
    expect(w.fake.calls('comments').length).toBe(before)
  })

  it('연결 끊기: 토큰을 지우고 열린 글 연결을 끝낸다. 밴드에 요청 없음. 같은 요청 번호 두 번 = 한 번', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    const before = w.fake.requests.length
    const requestId = rid('disc')
    const first = await client(w, seller.cookie).post('/api/band/disconnect', { requestId })
    expect(first.status).toBe(200)
    expect(first.body.band).toMatchObject({ status: 'NOT_CONNECTED' })
    expect(await client(w, seller.cookie).post('/api/band/disconnect', { requestId })).toMatchObject({ status: 200, body: first.body })
    expect(w.fake.requests.length).toBe(before)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'FINISHED', message: '밴드 연결을 끊어서 밴드 글 연결을 끝냈어요.' })
    const rows = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from band_accounts`)
    expect(rows?.rows[0]?.n).toBe(0)
    await tick(w, 30_000)
    expect(w.fake.requests.length).toBe(before)
  })
})

describe('AC-BND1-15 권한·격리', () => {
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다 — 이 자리의 시험(보조자: 밴드 연결 보기만)도 함께 뺐다

  it('판매자 B는 A의 표·연결·회차를 쓰거나 볼 수 없다 (404·expired)', async () => {
    const w = await world()
    const a = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: a.bandKey, authorUserKey: a.userKey })
    const b = await realBroadcast(w, a.seller)
    const other = await bandSeller(w, { name: '다른 가게' })
    expect((await linkBand(w, other.seller, b, a.bandKey, postKey)).status).toBe(404)
    expect((await client(w, other.seller.cookie).get(`/api/broadcasts/${b}/band`)).status).toBe(404)
    expect((await client(w, other.seller.cookie).post(`/api/broadcasts/${b}/band/notices-seen`, { upTo: 1 })).status).toBe(404)
    expect((await client(w, other.seller.cookie).post(`/api/broadcasts/${b}/band/unlink`, { requestId: rid('x') })).status).toBe(404)
    // A의 표로 B 세션이 돌아오기
    const started = await client(w, a.seller.cookie).post('/api/band/connect', {})
    w.fake.nextLogin({ decision: 'approve', userKey: a.userKey })
    expect(await callback(w, other.seller, await approve(w, started.body.url as string))).toBe('expired')
    // B의 밴드 목록에는 A의 밴드가 없다 — A의 밴드로 글 목록은 400
    expect((await client(w, other.seller.cookie).get(`/api/band/posts?band=${a.bandKey}`)).status).toBe(400)
    guestComment(w, postKey, '1번')
  })
})
