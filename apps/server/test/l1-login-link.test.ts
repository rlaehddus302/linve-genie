// AC-L1-05 간편 로그인 결과(가입 없음), AC-L1-06 연결 결과, AC-L1-07 목록·끊기·보조자 (D-L1-01~D-L1-03, D-074, SYS-04).
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { sessionCookie } from '../src/auth.ts'
import { ORIGIN, addSeller, client, login, rid, startServer, type Seller } from './support.ts'
import { approve, cookieValue, newSocialWorld, openCallback, resultOf, runFlow, startFlow, type SocialWorld } from './l1-support.ts'

const worlds: SocialWorld[] = []
afterAll(async () => {
  for (const world of worlds) await world.fake.close()
})
const world = async (options: Parameters<typeof newSocialWorld>[0] = {}) => {
  const made = await newSocialWorld(options)
  worlds.push(made)
  return made
}
const pgOf = (w: SocialWorld) => w.database.pglite as PGlite
const counts = async (w: SocialWorld) => {
  const out: Record<string, number> = {}
  for (const table of ['sellers', 'accounts', 'login_links', 'sessions']) out[table] = (await pgOf(w).query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? 0
  return out
}
const linkRows = async (w: SocialWorld) =>
  (await pgOf(w).query<{ seller_id: string; account_id: string; provider: string; provider_user_id: string; label: string; last_login_at: Date | null }>(`select seller_id, account_id, provider, provider_user_id, label, last_login_at from login_links order by id`)).rows
const assistantOf = async (w: SocialWorld, seller: Seller): Promise<string> => {
  const made = await client(w, seller.cookie).post('/api/assistants', { name: '보조' })
  expect(made.status).toBe(200)
  return login(w, (made.body.assistant as { loginId: string }).loginId, made.body.password as string)
}

describe('AC-L1-05 간편 로그인 — 가입 없음', () => {
  it('연결한 카카오 계정으로 로그인하면 A의 세션(쿠키 D-074와 같음·만든 방법 KAKAO)이 생기고 홈으로 간다. 마지막 로그인 시각·가린 이름을 새로 고친다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const k1 = w.fake.addUser('kakao', { nickname: '다육이네' })
    expect((await runFlow(w, 'kakao', k1.id, { session: a.cookie })).result.login).toBe('LINKED')
    expect((await linkRows(w))[0]).toMatchObject({ label: '다***', last_login_at: null })
    w.fake.addUser('kakao', { id: k1.id, email: 'seller.kim@kakao.com', nickname: '다육이네' })
    w.clock.advance(60_000)
    const flow = await runFlow(w, 'kakao', k1.id)
    expect(flow.result.location).toBe(`${ORIGIN}/`)
    const token = cookieValue(flow.response.headers, 'lj_session') as string
    expect(flow.response.headers.getSetCookie()).toContain(sessionCookie(token))
    expect(sessionCookie(token)).toMatch(/HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/)
    const me = await client(w, flow.session).get('/api/me')
    expect(me.body).toMatchObject({ loginId: a.loginId, role: 'SELLER' })
    const methods = (await pgOf(w).query<{ method: string; account_id: string }>(`select method, account_id from sessions where method <> 'PASSWORD'`)).rows
    expect(methods).toEqual([{ method: 'KAKAO', account_id: a.accountId }])
    const row = (await linkRows(w))[0]
    expect(row?.label).toBe('se***@kakao.com')
    expect(row?.last_login_at?.getTime()).toBe(w.clock.now())
    // 판매자 권한이 아이디 로그인과 같다 (보조자 허용 목록 밖 경로도 된다)
    expect((await client(w, flow.session).get('/api/assistants')).status).toBe(200)
    expect((await client(w, flow.session).post('/api/broadcasts', { requestId: rid('bc'), title: '간편 로그인 방송' })).status).toBe(200)
    expect((await client(w, flow.session).get('/api/auth/methods')).status).toBe(200)
  })

  it('어느 판매자에게도 연결되지 않은 계정은 가입 표(SIGNUP, D-UX3-28 — 전에는 NOT_LINKED) — 동의 전에는 계정·판매자·연결·세션 어느 것도 생기지 않는다 (같은 이메일이어도)', async () => {
    const w = await world()
    const a = await addSeller(w)
    const linked = w.fake.addUser('google', { email: 'same@example.com' })
    await runFlow(w, 'google', linked.id, { session: a.cookie })
    const before = await counts(w)
    const sameEmail = w.fake.addUser('google', { email: 'same@example.com' })
    const kakaoSame = w.fake.addUser('kakao', { email: 'same@example.com' })
    for (const [provider, user] of [['google', sameEmail], ['kakao', kakaoSame]] as const) {
      const flow = await runFlow(w, provider, user.id)
      expect(flow.result.location).toBe(`${ORIGIN}/?login=SIGNUP&provider=${provider}`)
      expect(flow.session).toBeNull()
    }
    expect(await counts(w)).toEqual(before)
  })

  it('아이디 잠금(같은 아이디 10번 틀림)이 걸린 계정도 연결한 공급자로는 로그인된다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const user = w.fake.addUser('naver')
    await runFlow(w, 'naver', user.id, { session: a.cookie })
    for (let i = 0; i < 10; i++) await client(w, null).post('/api/login', { loginId: a.loginId, password: 'wrong-password' })
    const locked = await client(w, null).post('/api/login', { loginId: a.loginId, password: a.password })
    expect((locked.body.error as { code: string }).code).toBe('LOGIN_LOCKED')
    const flow = await runFlow(w, 'naver', user.id)
    expect(flow.session).not.toBeNull()
    expect((await client(w, a.cookie).get('/api/me')).status).toBe(200)
  })
})

describe('AC-L1-06 연결 결과', () => {
  it('처음 LINKED → 설정 화면, 다시 연결 LINKED(행 그대로, 가린 이름만), 새 세션을 만들지 않는다, 실시간 알림', async () => {
    const w = await world()
    const a = await addSeller(w)
    const publish = vi.spyOn(w.server.hub, 'publishNamed')
    const user = w.fake.addUser('google', { email: 'first@gmail.com' })
    const sessions = (await counts(w)).sessions
    const first = await runFlow(w, 'google', user.id, { session: a.cookie })
    expect(first.result.location).toBe(`${ORIGIN}/settings?login=LINKED&provider=google`)
    expect(first.session).toBeNull()
    expect((await counts(w)).sessions).toBe(sessions)
    expect(publish).toHaveBeenCalledWith(a.sellerId, 'login', { kind: 'methods' })
    w.fake.addUser('google', { id: user.id, email: 'renamed@gmail.com' })
    expect((await runFlow(w, 'google', user.id, { session: a.cookie })).result.login).toBe('LINKED')
    const rows = await linkRows(w)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ account_id: a.accountId, provider: 'google', label: 're***@gmail.com' })
  })

  it('다른 판매자 B에게 연결된 계정 → LINKED_ELSEWHERE(B 그대로, A에게 없음, B 정보 없음) · 이미 다른 계정 → ALREADY_LINKED', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const taken = w.fake.addUser('kakao')
    await runFlow(w, 'kakao', taken.id, { session: b.cookie })
    const elsewhere = await runFlow(w, 'kakao', taken.id, { session: a.cookie })
    expect(elsewhere.result.location).toBe(`${ORIGIN}/settings?login=LINKED_ELSEWHERE&provider=kakao`)
    expect(elsewhere.result.location).not.toContain(b.loginId)
    expect(await linkRows(w)).toEqual([expect.objectContaining({ seller_id: b.sellerId, provider_user_id: taken.id })])
    const mine = w.fake.addUser('kakao')
    await runFlow(w, 'kakao', mine.id, { session: a.cookie })
    const second = w.fake.addUser('kakao')
    expect((await runFlow(w, 'kakao', second.id, { session: a.cookie })).result.login).toBe('ALREADY_LINKED')
    expect((await linkRows(w)).filter((row) => row.account_id === a.accountId).map((row) => row.provider_user_id)).toEqual([mine.id])
  })

  it('연결 도중 로그아웃·다른 세션 → SESSION_GONE(로그인 화면), 아무것도 생기지 않는다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const user = w.fake.addUser('naver')
    const started = await startFlow(w, 'naver', { session: a.cookie })
    const location = approve(w.fake, started.authorizeUrl, user.id)
    await client(w, a.cookie).post('/api/logout', {})
    const gone = await openCallback(w, location, { browser: started.browser, session: a.cookie })
    expect(resultOf(gone).location).toBe(`${ORIGIN}/?login=SESSION_GONE&provider=naver`)
    // 같은 판매자의 다른 세션으로 돌아와도 (state의 세션과 다름)
    const other = await login(w, a.loginId, a.password)
    const started2 = await startFlow(w, 'naver', { session: other })
    const third = await login(w, a.loginId, a.password)
    expect(resultOf(await openCallback(w, approve(w.fake, started2.authorizeUrl, user.id), { browser: started2.browser, session: third })).login).toBe('SESSION_GONE')
    expect(resultOf(await openCallback(w, approve(w.fake, started2.authorizeUrl, user.id), { browser: started2.browser })).login).toBe('EXPIRED')
    expect(await linkRows(w)).toEqual([])
    expect(w.fake.exchanges.naver).toBe(0)
  })

  it('동시에 두 판매자가 같은 공급자 계정을 연결해도 하나만 된다 (유일 제약)', async () => {
    const w = await world()
    const sellers = await Promise.all([addSeller(w), addSeller(w)])
    const user = w.fake.addUser('google')
    const flows = await Promise.all(sellers.map(async (seller) => {
      const started = await startFlow(w, 'google', { session: seller.cookie })
      return { started, seller, location: approve(w.fake, started.authorizeUrl, user.id) }
    }))
    const results = await Promise.all(flows.map(async (flow) => resultOf(await openCallback(w, flow.location, { browser: flow.started.browser, session: flow.seller.cookie })).login))
    expect([...results].sort()).toEqual(['LINKED', 'LINKED_ELSEWHERE'])
    expect(await linkRows(w)).toHaveLength(1)
  })
})

describe('AC-L1-07 목록·끊기·보조자', () => {
  it('목록은 그 판매자 계정의 것만 — 켜진 공급자 전부, 공급자 계정 ID 없음', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const user = w.fake.addUser('kakao', { id: '9876543210', email: 'ab@kakao.com' })
    await runFlow(w, 'kakao', user.id, { session: b.cookie })
    const mine = await client(w, a.cookie).get('/api/auth/methods')
    expect(mine.body).toEqual({
      loginId: a.loginId,
      providers: [
        { provider: 'kakao', enabled: true, linked: false, label: '', linkedAt: null },
        { provider: 'naver', enabled: true, linked: false, label: '', linkedAt: null },
        { provider: 'google', enabled: true, linked: false, label: '', linkedAt: null },
      ],
    })
    const theirs = await client(w, b.cookie).get('/api/auth/methods')
    expect((theirs.body.providers as unknown[])[0]).toEqual({ provider: 'kakao', enabled: true, linked: true, label: 'a***@kakao.com', linkedAt: new Date(w.clock.now()).toISOString() })
    expect(theirs.text).not.toContain('9876543210')
  })

  it('끊기: 연결 행·그 공급자로 만든 다른 세션을 지운다(지금 세션은 남음 — 그 공급자로 만든 것이어도). 아이디·다른 공급자 세션은 그대로. 실시간 연결을 닫는다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const kakao = w.fake.addUser('kakao')
    const google = w.fake.addUser('google')
    await runFlow(w, 'kakao', kakao.id, { session: a.cookie })
    await runFlow(w, 'google', google.id, { session: a.cookie })
    const viaKakao1 = (await runFlow(w, 'kakao', kakao.id)).session as string
    const viaKakao2 = (await runFlow(w, 'kakao', kakao.id)).session as string
    const viaGoogle = (await runFlow(w, 'google', google.id)).session as string
    const closed = vi.spyOn(w.server.hub, 'closeSession')
    const publish = vi.spyOn(w.server.hub, 'publishNamed')
    const response = await client(w, viaKakao1).post('/api/auth/unlink', { provider: 'kakao' })
    expect(response.status).toBe(200)
    expect((response.body.providers as { provider: string; linked: boolean }[]).map((item) => [item.provider, item.linked])).toEqual([
      ['kakao', false],
      ['naver', false],
      ['google', true],
    ])
    expect((await client(w, viaKakao1).get('/api/me')).status).toBe(200)
    expect((await client(w, viaKakao2).get('/api/me')).status).toBe(401)
    expect((await client(w, viaGoogle).get('/api/me')).status).toBe(200)
    expect((await client(w, a.cookie).get('/api/me')).status).toBe(200)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(a.sellerId, 'login', { kind: 'methods' })
    // 끊은 뒤 그 계정으로 로그인하면 가입 표(SIGNUP — D-UX3-28), 다른 판매자가 새로 연결할 수 있다
    expect((await runFlow(w, 'kakao', kakao.id)).result.login).toBe('SIGNUP')
    const b = await addSeller(w)
    expect((await runFlow(w, 'kakao', kakao.id, { session: b.cookie })).result.login).toBe('LINKED')
  })

  it('TD-L1-001: 로그인이 연결을 찾은 뒤 세션을 넣기 전에 끊기가 끝나면 NOT_LINKED — 끊은 공급자 세션이 남지 않는다', async () => {
    let onFound: (() => Promise<void>) | null = null
    const w = await world({
      providers: ['kakao'],
      socialHooks: {
        beforeLoginSession: async () => {
          const hook = onFound
          onFound = null
          if (hook !== null) await hook()
        },
      },
    })
    const a = await addSeller(w)
    const user = w.fake.addUser('kakao')
    expect((await runFlow(w, 'kakao', user.id, { session: a.cookie })).result.login).toBe('LINKED')
    let unlinkStatus = 0
    onFound = async () => {
      unlinkStatus = (await client(w, a.cookie).post('/api/auth/unlink', { provider: 'kakao' })).status
    }
    const flow = await runFlow(w, 'kakao', user.id)
    expect(unlinkStatus).toBe(200)
    expect(flow.result.location).toBe(`${ORIGIN}/?login=NOT_LINKED&provider=kakao`)
    expect(flow.session).toBeNull()
    expect((await pgOf(w).query<{ n: number }>(`select count(*)::int as n from sessions where method = 'KAKAO'`)).rows[0]?.n).toBe(0)
    expect((await counts(w)).login_links).toBe(0)
  })

  it('연결이 없는 공급자 404 · 모르는 공급자 404 · 남는 수단이 없으면 409 (비밀번호 없는 계정을 직접 만들어)', async () => {
    const w = await world()
    const a = await addSeller(w)
    expect((await client(w, a.cookie).post('/api/auth/unlink', { provider: 'naver' })).status).toBe(404)
    expect((await client(w, a.cookie).post('/api/auth/unlink', { provider: 'apple' })).status).toBe(404)
    expect((await client(w, a.cookie).post('/api/auth/unlink', { provider: 'naver', extra: 1 })).status).toBe(400)
    const user = w.fake.addUser('naver')
    const second = w.fake.addUser('google')
    await runFlow(w, 'naver', user.id, { session: a.cookie })
    await runFlow(w, 'google', second.id, { session: a.cookie })
    await pgOf(w).query(`update accounts set password_hash = '' where id = $1`, [a.accountId])
    // 구글이 남으니 네이버는 끊을 수 있다
    expect((await client(w, a.cookie).post('/api/auth/unlink', { provider: 'naver' })).status).toBe(200)
    const last = await client(w, a.cookie).post('/api/auth/unlink', { provider: 'google' })
    expect(last.status).toBe(409)
    expect(last.body.error).toEqual({ code: 'LOGIN_METHOD_LAST', message: '마지막 로그인 방법은 끊을 수 없어요.' })
    expect((await linkRows(w)).map((row) => row.provider)).toEqual(['google'])
  })

  it('꺼졌지만 연결이 남은 공급자: 목록에 enabled false, 끊기만 200 — 시작·돌아오는 주소는 404', async () => {
    const w = await world()
    const a = await addSeller(w)
    const user = w.fake.addUser('kakao', { email: 'kim@kakao.com' })
    await runFlow(w, 'kakao', user.id, { session: a.cookie })
    const googleOnly = startServer(w.database, w.masterKey, { socialLogin: w.fake.setup({ providers: ['google'] }) })
    const api = client(googleOnly, a.cookie)
    const list = await api.get('/api/auth/methods')
    expect(list.body.providers).toEqual([
      { provider: 'kakao', enabled: false, linked: true, label: 'ki***@kakao.com', linkedAt: expect.any(String) as string },
      { provider: 'google', enabled: true, linked: false, label: '', linkedAt: null },
    ])
    expect((await api.post('/api/auth/link', { provider: 'kakao' })).status).toBe(404)
    expect((await client(googleOnly, null).get('/api/auth/kakao/callback?code=a&state=b')).status).toBe(404)
    expect((await api.post('/api/auth/unlink', { provider: 'naver' })).status).toBe(404)
    expect((await api.post('/api/auth/unlink', { provider: 'kakao' })).status).toBe(200)
  })

  it('보조자: 목록·연결 시작·끊기 403 — 보조자 계정 ID로 넣어 둔 연결 행(손상)으로도 세션이 생기지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const assistant = await assistantOf(w, seller)
    for (const [method, path] of [['GET', '/api/auth/methods'], ['POST', '/api/auth/link'], ['POST', '/api/auth/unlink']] as const) {
      const response = method === 'GET' ? await client(w, assistant).get(path) : await client(w, assistant).post(path, { provider: 'kakao' })
      expect(response.status, path).toBe(403)
      expect((response.body.error as { code: string }).code).toBe('ASSISTANT_FORBIDDEN')
    }
    const assistantId = (await pgOf(w).query<{ id: string }>(`select id from accounts where role = 'ASSISTANT'`)).rows[0]?.id as string
    const user = w.fake.addUser('kakao')
    await pgOf(w).query(`insert into login_links (seller_id, account_id, provider, provider_user_id, linked_at) values ($1, $2, 'kakao', $3, now())`, [seller.sellerId, assistantId, user.id])
    const before = (await counts(w)).sessions
    const flow = await runFlow(w, 'kakao', user.id)
    // 판매자 계정 연결이 없으니 가입 표(D-UX3-28)지만, 동의해도 보조자 계정으로 세션을 만들거나 새 계정을 만들지 않는다
    expect(flow.result.login).toBe('SIGNUP')
    expect(flow.session).toBeNull()
    const ticket = cookieValue(flow.response.headers, '__Host-lj_signup') as string
    const signup = await client(w, `__Host-lj_signup=${ticket}`).post('/api/auth/signup', { agree: true })
    expect(signup.status).toBe(410)
    expect((await counts(w)).sessions).toBe(before)
  })
})
