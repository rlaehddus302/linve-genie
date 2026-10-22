// AC-L1-03 시작(승인 주소·state·쿠키), AC-L1-04 돌아오는 주소(검사 순서·한 번만·고정 Location), AC-L1-10 속도 제한·시간 제한 (D-L1-04·D-L1-05, D-I3-12).
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { PROVIDER_TIMEOUT_MS } from '../src/social/providers.ts'
import { STATE_TTL_MS } from '../src/social/service.ts'
import { ORIGIN, addSeller, client, login } from './support.ts'
import { ALL_PROVIDERS, approve, cookieValue, newSocialWorld, openCallback, resultOf, runFlow, startFlow, type SocialWorld } from './l1-support.ts'

const worlds: SocialWorld[] = []
afterAll(async () => {
  for (const world of worlds) await world.fake.close()
})
const world = async (options: Parameters<typeof newSocialWorld>[0] = {}) => {
  const made = await newSocialWorld(options)
  worlds.push(made)
  return made
}
const sessionCount = async (w: SocialWorld) => (await (w.database.pglite as PGlite).query<{ n: number }>(`select count(*)::int as n from sessions`)).rows[0]?.n ?? 0
const ip = (address: string) => ({ incoming: { socket: { remoteAddress: address } } })

describe('AC-L1-03 시작 — 승인 주소·state·쿠키', () => {
  it.each(ALL_PROVIDERS)('%s: 승인 주소의 질의 (돌아오는 주소는 설정한 앱 주소로 — Host·X-Forwarded-Host와 상관없음)', async (provider) => {
    const w = await world()
    const response = await w.server.app.request('/api/auth/start', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Host: 'evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' },
      body: JSON.stringify({ provider }),
    })
    expect(response.status).toBe(200)
    const url = new URL(((await response.json()) as { authorizeUrl: string }).authorizeUrl)
    expect(`${url.origin}${url.pathname}`).toBe(w.fake.endpoints(provider).authUrl)
    const q = url.searchParams
    expect(q.get('response_type')).toBe('code')
    expect(q.get('client_id')).toBe(w.fake.clients[provider].clientId)
    expect(q.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/${provider}/callback`)
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(q.has('include_granted_scopes')).toBe(false)
    expect(q.has('access_type')).toBe(false)
    if (provider === 'google') {
      expect(q.get('scope')).toBe('openid email')
      expect(q.get('prompt')).toBe('select_account')
    } else expect(q.has('scope')).toBe(false)
    if (provider === 'naver') {
      expect(q.has('code_challenge')).toBe(false)
      expect(q.has('code_challenge_method')).toBe(false)
    } else {
      expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(q.get('code_challenge_method')).toBe('S256')
    }
    // 쿠키: __Host- 접두어, 무작위 값, HttpOnly·Secure·SameSite=Lax, Path=/, Domain 없음, 10분 (RA-L1-02)
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith('__Host-lj_oauth=')) ?? ''
    expect(cookie).toMatch(/^__Host-lj_oauth=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/)
    expect(cookie.toLowerCase()).not.toContain('domain=')
    expect(STATE_TTL_MS).toBe(600_000)
    // 서버엔 state·쿠키 값 모두 해시만 (검증 값은 암호화)
    const dump = JSON.stringify((await (w.database.pglite as PGlite).query(`select * from login_states`)).rows)
    expect(dump).not.toContain(q.get('state') as string)
    expect(dump).not.toContain(cookieValue(response.headers, '__Host-lj_oauth') as string)
  })

  it('같은 브라우저의 두 탭: 시작마다 쿠키 값은 새로, 진행 중 state는 새 값에 다시 묶인다 — 옛 값·다른 브라우저의 쿠키로는 통과하지 않는다 (RA-L1-02)', async () => {
    const w = await world()
    const user = w.fake.addUser('kakao')
    const a = await addSeller(w)
    expect((await runFlow(w, 'kakao', user.id, { session: a.cookie })).result.login).toBe('LINKED')
    const first = await startFlow(w, 'kakao')
    const second = await startFlow(w, 'kakao', { browser: first.browser })
    // 들고 온 값을 그대로 다시 내보내지 않는다
    expect(second.browser).not.toBe(first.browser)
    const other = await startFlow(w, 'kakao')
    expect(other.browser).not.toBe(first.browser)
    expect(other.browser).not.toBe(second.browser)
    const firstLocation = approve(w.fake, first.authorizeUrl, user.id)
    // 다른 브라우저의 쿠키로 첫 탭의 돌아오는 주소를 열면 EXPIRED (쓴 표시는 달리지 않는다)
    expect(resultOf(await openCallback(w, firstLocation, { browser: other.browser })).login).toBe('EXPIRED')
    // 옛 값(새로 받기 전 쿠키)으로도 EXPIRED — 다시 묶였다
    expect(resultOf(await openCallback(w, firstLocation, { browser: first.browser })).login).toBe('EXPIRED')
    // 브라우저가 지금 가진 새 값으로는 두 탭 모두 된다
    const okFirst = await openCallback(w, firstLocation, { browser: second.browser })
    expect(resultOf(okFirst).location).toBe(`${ORIGIN}/`)
    expect(cookieValue(okFirst.headers, 'lj_session')).not.toBeNull()
    // 둘째 탭이 아직 진행 중이라 쿠키는 지우지 않는다 (RA-L1-01)
    expect(cookieValue(okFirst.headers, '__Host-lj_oauth')).toBeNull()
    const ok = await openCallback(w, approve(w.fake, second.authorizeUrl, user.id), { browser: second.browser })
    expect(resultOf(ok).location).toBe(`${ORIGIN}/`)
    expect(cookieValue(ok.headers, 'lj_session')).not.toBeNull()
    // 마지막 진행 중 state가 성공했다 — 이제 지운다
    expect(ok.headers.getSetCookie()).toContain('__Host-lj_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  })

  it('두 탭: 카카오 연결 진행 중에 네이버 로그인을 먼저 끝내도 쿠키가 남아 카카오 연결이 끝난다 · 실패한 돌아오기는 쿠키를 지우지 않는다 (RA-L1-01)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const naverUser = w.fake.addUser('naver')
    const kakaoUser = w.fake.addUser('kakao')
    expect((await runFlow(w, 'naver', naverUser.id, { session: seller.cookie })).result.login).toBe('LINKED')
    // 탭 1: 카카오 연결 시작 (로그인된 세션)
    const kakao = await startFlow(w, 'kakao', { session: seller.cookie })
    // 탭 2: 같은 브라우저에서 네이버 로그인 시작 → 쿠키 값이 새로 바뀐다
    const naver = await startFlow(w, 'naver', { browser: kakao.browser })
    expect(naver.browser).not.toBe(kakao.browser)
    // 탭 2에서 취소 한 번 (실패 결과) → 쿠키를 지우지 않는다
    const cancelled = await startFlow(w, 'naver', { browser: naver.browser })
    const cancel = await openCallback(w, approve(w.fake, cancelled.authorizeUrl, null), { browser: cancelled.browser })
    expect(resultOf(cancel).login).toBe('CANCELLED')
    expect(cookieValue(cancel.headers, '__Host-lj_oauth')).toBeNull()
    const browser = cancelled.browser
    // 탭 2: 네이버 로그인 먼저 성공 — 카카오 연결이 진행 중이라 쿠키는 지우지 않는다
    const login = await openCallback(w, approve(w.fake, naver.authorizeUrl, naverUser.id), { browser })
    expect(resultOf(login).location).toBe(`${ORIGIN}/`)
    expect(cookieValue(login.headers, 'lj_session')).not.toBeNull()
    expect(cookieValue(login.headers, '__Host-lj_oauth')).toBeNull()
    // 탭 1: 카카오 연결이 돌아온다 (같은 브라우저 쿠키, 시작한 세션 그대로) → 연결됨, 남은 state가 없으니 이제 지운다
    const link = await openCallback(w, approve(w.fake, kakao.authorizeUrl, kakaoUser.id), { browser, session: seller.cookie })
    expect(resultOf(link)).toMatchObject({ path: '/settings', login: 'LINKED', provider: 'kakao' })
    expect(link.headers.getSetCookie()).toContain('__Host-lj_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  })

  it('연결 시작: 세션 없음 401 · 보조자 403 · 판매자는 그 계정·세션에 묶인 state', async () => {
    const w = await world()
    const seller = await addSeller(w)
    expect((await client(w, null).post('/api/auth/link', { provider: 'google' })).status).toBe(401)
    const made = await client(w, seller.cookie).post('/api/assistants', { name: '보조' })
    const assistant = await login(w, made.body.assistant ? (made.body.assistant as { loginId: string }).loginId : '', made.body.password as string)
    const denied = await client(w, assistant).post('/api/auth/link', { provider: 'google' })
    expect(denied.status).toBe(403)
    expect((denied.body.error as { code: string }).code).toBe('ASSISTANT_FORBIDDEN')
    await startFlow(w, 'google', { session: seller.cookie })
    const rows = (await (w.database.pglite as PGlite).query<{ purpose: string; seller_id: string; account_id: string; session_hash: string | null }>(`select purpose, seller_id, account_id, session_hash from login_states`)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ purpose: 'LINK', seller_id: seller.sellerId, account_id: seller.accountId })
    expect(rows[0]?.session_hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // 간편 로그인 시작은 세션이 필요 없고 판매자를 묶지 않는다
    await startFlow(w, 'google')
    const loginRow = (await (w.database.pglite as PGlite).query<{ seller_id: string | null }>(`select seller_id from login_states where purpose = 'LOGIN'`)).rows
    expect(loginRow).toEqual([{ seller_id: null }])
  })

  it('꺼진·모르는 공급자 404 · 다른 Origin 403 · 모르는 항목 400 · JSON이 아니면 거절', async () => {
    const w = await world({ providers: ['google'] })
    const api = client(w, null)
    expect((await api.post('/api/auth/start', { provider: 'kakao' })).status).toBe(404)
    expect((await api.post('/api/auth/start', { provider: 'apple' })).status).toBe(404)
    expect((await api.post('/api/auth/start', {})).status).toBe(404)
    const extra = await api.post('/api/auth/start', { provider: 'google', next: 'https://evil.example' })
    expect(extra.status).toBe(400)
    expect((extra.body.error as { code: string }).code).toBe('UNKNOWN_FIELD')
    const cross = await w.server.app.request('/api/auth/start', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"provider":"google"}' })
    expect(cross.status).toBe(403)
    const form = await w.server.app.request('/api/auth/start', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'provider=google' })
    expect(form.status).toBe(415)
    expect(cross.headers.getSetCookie()).toEqual([])
  })
})

describe('AC-L1-04 돌아오는 주소 — 검사 순서·한 번만', () => {
  it('취소(access_denied) → CANCELLED, 다른 error → PROVIDER_ERROR — state는 쓴 것으로 표시되고 공급자를 부르지 않는다', async () => {
    const w = await world()
    const started = await startFlow(w, 'kakao')
    const cancelled = await openCallback(w, approve(w.fake, started.authorizeUrl, null), { browser: started.browser })
    expect(resultOf(cancelled)).toMatchObject({ path: '/', login: 'CANCELLED', provider: 'kakao' })
    // 같은 state로 code를 가져와도 EXPIRED (이미 씀)
    const user = w.fake.addUser('kakao')
    expect(resultOf(await openCallback(w, approve(w.fake, started.authorizeUrl, user.id), { browser: started.browser })).login).toBe('EXPIRED')
    const other = await startFlow(w, 'naver')
    const state = new URL(other.authorizeUrl).searchParams.get('state') as string
    expect(resultOf(await openCallback(w, `${ORIGIN}/api/auth/naver/callback?error=server_error&state=${state}`, { browser: other.browser })).login).toBe('PROVIDER_ERROR')
    expect(w.fake.exchanges).toEqual({ google: 0, kakao: 0, naver: 0 })
  })

  it('연결 시작에서 취소하면 설정 화면으로 돌아간다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const started = await startFlow(w, 'google', { session: seller.cookie })
    const response = await openCallback(w, approve(w.fake, started.authorizeUrl, null), { browser: started.browser, session: seller.cookie })
    expect(resultOf(response)).toMatchObject({ path: '/settings', login: 'CANCELLED', provider: 'google' })
  })

  it('state 없음·모름·이미 씀·10분 지남·공급자 다름·쿠키 없음·쿠키 다름 → EXPIRED (공급자를 부르지 않는다)', async () => {
    const w = await world()
    const user = w.fake.addUser('kakao')
    const google = w.fake.addUser('google')
    const cases: [string, () => Promise<Response>][] = []
    const started = await startFlow(w, 'kakao')
    const location = approve(w.fake, started.authorizeUrl, user.id)
    const code = new URL(location).searchParams.get('code') as string
    cases.push(['state 없음', () => openCallback(w, `${ORIGIN}/api/auth/kakao/callback?code=${code}`, { browser: started.browser })])
    cases.push(['state 모름', () => openCallback(w, `${ORIGIN}/api/auth/kakao/callback?code=${code}&state=${'A'.repeat(43)}`, { browser: started.browser })])
    cases.push(['state 바꿈', () => openCallback(w, location.replace(/state=[^&]+/, `state=${'B'.repeat(43)}`), { browser: started.browser })])
    cases.push(['쿠키 없음', () => openCallback(w, location)])
    cases.push(['쿠키 다름', () => openCallback(w, location, { browser: 'C'.repeat(43) })])
    const google1 = await startFlow(w, 'google')
    const googleLocation = approve(w.fake, google1.authorizeUrl, google.id)
    cases.push(['공급자 다름', () => openCallback(w, googleLocation.replace('/api/auth/google/', '/api/auth/kakao/'), { browser: google1.browser })])
    for (const [name, run] of cases) expect(resultOf(await run()).login, name).toBe('EXPIRED')
    expect(w.fake.exchanges).toEqual({ google: 0, kakao: 0, naver: 0 })
    // 원래 짝은 아직 쓸 수 있다 (틀린 시도가 그 state를 쓰지 않았다)
    expect(resultOf(await openCallback(w, location, { browser: started.browser })).login).toBe('NOT_LINKED')
    // 이미 씀
    expect(resultOf(await openCallback(w, location, { browser: started.browser })).login).toBe('EXPIRED')
    // 10분 지남
    const late = await startFlow(w, 'kakao')
    const lateLocation = approve(w.fake, late.authorizeUrl, user.id)
    w.clock.advance(STATE_TTL_MS)
    expect(resultOf(await openCallback(w, lateLocation, { browser: late.browser })).login).toBe('EXPIRED')
    expect(w.fake.exchanges.kakao).toBe(1)
  })

  it('같은 돌아오는 주소를 두 번 열면 두 번째는 EXPIRED — 세션이 하나 더 생기지 않고 공급자를 다시 부르지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const user = w.fake.addUser('google')
    await runFlow(w, 'google', user.id, { session: seller.cookie })
    const started = await startFlow(w, 'google')
    const location = approve(w.fake, started.authorizeUrl, user.id)
    const first = await openCallback(w, location, { browser: started.browser })
    expect(resultOf(first).location).toBe(`${ORIGIN}/`)
    const sessions = await sessionCount(w)
    const exchanges = w.fake.exchanges.google
    const second = await openCallback(w, location, { browser: started.browser })
    expect(resultOf(second).login).toBe('EXPIRED')
    expect(cookieValue(second.headers, 'lj_session')).toBeNull()
    expect(await sessionCount(w)).toBe(sessions)
    expect(w.fake.exchanges.google).toBe(exchanges)
  })

  it('Location은 앱 주소 + 고정 경로 + login·provider뿐 — next·redirect·return_to·Host·X-Forwarded-Host와 상관없다. 머리글 그대로, 실패면 state 쿠키를 지우지 않는다', async () => {
    const w = await world()
    const started = await startFlow(w, 'naver')
    const user = w.fake.addUser('naver')
    const location = approve(w.fake, started.authorizeUrl, user.id)
    const evil = `${location}&next=//evil.example&redirect=https://evil.example&return_to=%2F%2Fevil.example&login=LINKED&provider=google`
    const response = await openCallback(w, evil, { browser: started.browser, headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' } })
    const result = resultOf(response)
    expect(result.location).toBe(`${ORIGIN}/?login=NOT_LINKED&provider=naver`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    // NOT_LINKED(실패)는 쿠키를 지우지 않는다 — Max-Age 만료에 맡긴다 (RA-L1-01)
    expect(cookieValue(response.headers, '__Host-lj_oauth')).toBeNull()
    expect(await response.text()).toBe('')
  })

  it('코드 교환이 실패하면(5xx·invalid_grant·모양 틀림·ID 없음) PROVIDER_ERROR이고 아무것도 생기지 않는다', async () => {
    const w = await world()
    const user = w.fake.addUser('kakao')
    for (const [step, fault] of [
      ['token', { status: 500 }],
      ['token', { status: 400 }],
      ['token', { error: 'invalid_grant' }],
      ['token', { shape: 'not_json' }],
      ['userinfo', { status: 503 }],
      ['userinfo', { shape: 'missing_id' }],
      ['userinfo', { shape: 'not_json' }],
    ] as const) {
      w.fake.failNext('kakao', step, fault)
      const flow = await runFlow(w, 'kakao', user.id)
      expect(flow.result.login, `${step} ${JSON.stringify(fault)}`).toBe('PROVIDER_ERROR')
      expect(flow.session).toBeNull()
    }
    // 네이버는 실패도 200 + { error }
    const naver = w.fake.addUser('naver')
    w.fake.failNext('naver', 'token', { error: 'invalid_grant' })
    expect((await runFlow(w, 'naver', naver.id)).result.login).toBe('PROVIDER_ERROR')
    expect(await sessionCount(w)).toBe(0)
  })

  it('서버가 보내는 코드 교환: 같은 redirect_uri·form 본문·비밀값·(구글·카카오) code_verifier·(네이버) state', async () => {
    const w = await world()
    for (const provider of ALL_PROVIDERS) {
      const user = w.fake.addUser(provider)
      await runFlow(w, provider, user.id)
      const token = w.fake.requests.find((item) => item.provider === provider && item.kind === 'token')
      expect(token?.params, provider).toMatchObject({
        contentType: 'application/x-www-form-urlencoded',
        grant_type: 'authorization_code',
        client_id: w.fake.clients[provider].clientId,
        redirect_uri: `${ORIGIN}/api/auth/${provider}/callback`,
        clientSecretOk: true,
        codeVerifierSent: provider !== 'naver',
        codeVerifierOk: provider !== 'naver',
        stateSent: provider === 'naver',
      })
      expect(w.fake.requests.find((item) => item.provider === provider && item.kind === 'userinfo')?.params).toEqual({ bearer: true })
    }
  })
})

describe('AC-L1-10 속도 제한·시간 제한', () => {
  it('비밀번호 로그인과 같은 IP 한도(10분 20번)를 함께 쓴다 — 15번 + 돌아옴 6번이면 마지막이 RATE_LIMITED, 공급자를 부르지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const user = w.fake.addUser('kakao')
    await runFlow(w, 'kakao', user.id, { session: seller.cookie })
    w.fake.reset()
    const address = '203.0.113.7'
    for (let i = 0; i < 15; i++) {
      const response = await w.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: `nobody${String(i)}`, password: 'wrong-password' }) }, ip(address))
      expect(response.status).toBe(401)
    }
    const results: (string | null)[] = []
    for (let i = 0; i < 6; i++) {
      const started = await startFlow(w, 'kakao')
      const location = new URL(approve(w.fake, started.authorizeUrl, user.id))
      const response = await w.server.app.request(`${location.pathname}${location.search}`, { headers: { Cookie: `__Host-lj_oauth=${started.browser}` } }, ip(address))
      results.push(resultOf(response).login)
    }
    expect(results).toEqual([null, null, null, null, null, 'RATE_LIMITED'])
    expect(w.fake.exchanges.kakao).toBe(5)
    // 그 IP의 비밀번호 로그인도 막힌다 (같은 한도)
    const blocked = await w.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: seller.loginId, password: seller.password }) }, ip(address))
    expect(blocked.status).toBe(429)
    expect(w.server.auth.loginRejections.ip).toBe(2)
  })

  it('RATE_LIMITED Location은 로그인 화면', async () => {
    const w = await world({ loginLimits: { ipMaxAttempts: 1 } })
    const started = await startFlow(w, 'google')
    const location = new URL(`${ORIGIN}/api/auth/google/callback?error=access_denied&state=${new URL(started.authorizeUrl).searchParams.get('state') as string}`)
    await w.server.app.request(`${location.pathname}${location.search}`, {}, ip('198.51.100.1'))
    const limited = await w.server.app.request(`${location.pathname}${location.search}`, {}, ip('198.51.100.1'))
    expect(resultOf(limited).location).toBe(`${ORIGIN}/?login=RATE_LIMITED&provider=google`)
  })

  it('공급자 호출은 비밀번호 확인 동시 한도(scrypt)를 쓰지 않는다', async () => {
    let verifies = 0
    const w = await world({ passwordVerifier: async () => (verifies++, false) })
    const user = w.fake.addUser('naver')
    await runFlow(w, 'naver', user.id)
    expect(verifies).toBe(0)
  })

  it('공급자 호출마다 시간 제한(기본 10초) — 넘으면 PROVIDER_ERROR. 느린 공급자가 다른 API를 막지 않는다', async () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(10_000)
    const w = await world({ timeoutMs: 400 })
    const seller = await addSeller(w)
    const user = w.fake.addUser('google')
    w.fake.failNext('google', 'token', { delayMs: 1500 })
    const started = Date.now()
    expect((await runFlow(w, 'google', user.id)).result.login).toBe('PROVIDER_ERROR')
    expect(Date.now() - started).toBeLessThan(1400)
    w.fake.failNext('google', 'userinfo', { delayMs: 1500 })
    expect((await runFlow(w, 'google', user.id)).result.login).toBe('PROVIDER_ERROR')
    expect(w.logs.filter((record) => record.code === 'SOCIAL_LOGIN' && record.reason === 'PROVIDER_ERROR').map((record) => record.errorKind)).toEqual(['Provider_token_timeout', 'Provider_userinfo_timeout'])
    // 느린 교환(시간 제한 안) 동안 다른 API가 먼저 답한다
    const slow = await world({ timeoutMs: 5000 })
    const other = await addSeller(slow)
    const slowUser = slow.fake.addUser('google')
    slow.fake.failNext('google', 'token', { delayMs: 900 })
    let callbackDone = 0
    const flow = runFlow(slow, 'google', slowUser.id).then((result) => {
      callbackDone = Date.now()
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const me = await client(slow, other.cookie).get('/api/me')
    const meDone = Date.now()
    expect(me.status).toBe(200)
    expect((await flow).result.login).toBe('NOT_LINKED')
    expect(meDone).toBeLessThan(callbackDone)
    expect(seller.loginId).not.toBe(other.loginId)
  })
})
