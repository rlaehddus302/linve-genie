// AC-L1-12 가짜 OAuth 서버·E2E 기동 (D-L1-07, D-Y13): 실제 어댑터와 같은 HTTP 모양, 돌아오는 주소 정확히 일치, 코드 한 번만, PKCE 검증, 시험 조작.
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { startE2eServer } from '../src/e2e.ts'
import { FakeOAuth } from '../src/social/fake-oauth.ts'
import { fetchProfile, ProviderError } from '../src/social/providers.ts'

const fakes: FakeOAuth[] = []
afterAll(async () => {
  for (const fake of fakes) await fake.close()
})
const REDIRECT = 'https://app.example.test/api/auth/kakao/callback'
const start = async () => {
  const fake = await FakeOAuth.start({ redirectUris: { kakao: REDIRECT, google: 'https://app.example.test/api/auth/google/callback', naver: 'https://app.example.test/api/auth/naver/callback' } })
  fakes.push(fake)
  return fake
}
const authorize = (fake: FakeOAuth, provider: 'kakao' | 'google' | 'naver', extra: Record<string, string> = {}) => {
  const url = new URL(fake.endpoints(provider).authUrl)
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: fake.clients[provider].clientId, redirect_uri: fake.registeredRedirect(provider) ?? '', state: 's'.repeat(43), ...extra })) url.searchParams.set(key, value)
  return url.toString()
}
const verifier = 'v'.repeat(64)
const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
const exchange = (fake: FakeOAuth, provider: 'kakao' | 'google' | 'naver', code: string, overrides: Partial<{ redirectUri: string; verifier: string | null; secret: string | null }> = {}) =>
  fetchProfile({
    provider,
    client: { clientId: fake.clients[provider].clientId, clientSecret: overrides.secret === undefined ? fake.clients[provider].clientSecret : overrides.secret },
    endpoints: fake.endpoints(provider),
    redirectUri: overrides.redirectUri ?? (fake.registeredRedirect(provider) as string),
    code,
    verifier: overrides.verifier === undefined ? verifier : overrides.verifier,
    state: 's'.repeat(43),
    fetch: globalThis.fetch,
    timeoutMs: 2000,
  })
const codeOf = (location: string) => new URL(location).searchParams.get('code') as string

describe('AC-L1-12 가짜 OAuth 서버', () => {
  it('승인 화면: 가짜 사용자 고르기 + 동의·취소, 등록한 돌아오는 주소와 정확히 같지 않으면 돌려보내지 않는다', async () => {
    const fake = await start()
    const user = fake.addUser('kakao', { email: 'a<b>@kakao.com', nickname: '<script>' })
    const page = await fetch(authorize(fake, 'kakao', { code_challenge: challenge, code_challenge_method: 'S256' }))
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('동의하고 계속하기')
    expect(html).toContain('취소')
    expect(html).toContain(`data-user="${user.id}"`)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    // 화면의 버튼(폼 POST)으로 동의 → 돌아오는 주소로 302
    const form = new URLSearchParams(Object.fromEntries(new URL(authorize(fake, 'kakao')).searchParams))
    form.set('_user', user.id)
    form.set('_action', 'approve')
    const approved = await fetch(fake.endpoints('kakao').authUrl, { method: 'POST', body: form, redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(approved.status).toBe(302)
    const back = new URL(approved.headers.get('location') as string)
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('s'.repeat(43))
    form.set('_action', 'cancel')
    const cancelled = await fetch(fake.endpoints('kakao').authUrl, { method: 'POST', body: form, redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(new URL(cancelled.headers.get('location') as string).searchParams.get('error')).toBe('access_denied')
    for (const bad of [{ redirect_uri: `${REDIRECT}/` }, { redirect_uri: 'https://evil.example/api/auth/kakao/callback' }, { client_id: 'other' }] as Record<string, string>[]) {
      const response = await fetch(authorize(fake, 'kakao', bad), { redirect: 'manual' })
      expect(response.status).toBe(400)
      expect(response.headers.get('location')).toBeNull()
      expect(await response.text()).toMatch(/data-error="(redirect_uri_mismatch|invalid_client)"/)
    }
  })

  it('토큰 교환: 코드 한 번만·같은 redirect_uri·비밀값·PKCE 검증 — 어기면 invalid_grant 계열', async () => {
    const fake = await start()
    const user = fake.addUser('kakao', { nickname: '다육' })
    const ok = fake.decide(authorize(fake, 'kakao', { code_challenge: challenge, code_challenge_method: 'S256' }), { approve: true, user: user.id })
    if ('error' in ok) throw new Error(ok.error)
    expect(await exchange(fake, 'kakao', codeOf(ok.location))).toEqual({ id: user.id, email: null, nickname: '다육' })
    // 같은 코드 두 번째
    await expect(exchange(fake, 'kakao', codeOf(ok.location))).rejects.toMatchObject({ step: 'token', kind: 'invalid_grant' })
    const fresh = () => {
      const decided = fake.decide(authorize(fake, 'kakao', { code_challenge: challenge, code_challenge_method: 'S256' }), { approve: true, user: user.id })
      if ('error' in decided) throw new Error(decided.error)
      return codeOf(decided.location)
    }
    await expect(exchange(fake, 'kakao', fresh(), { verifier: 'w'.repeat(64) })).rejects.toBeInstanceOf(ProviderError)
    await expect(exchange(fake, 'kakao', fresh(), { verifier: null })).rejects.toBeInstanceOf(ProviderError)
    await expect(exchange(fake, 'kakao', fresh(), { redirectUri: 'https://app.example.test/other' })).rejects.toBeInstanceOf(ProviderError)
    await expect(exchange(fake, 'kakao', fresh(), { secret: 'wrong' })).rejects.toBeInstanceOf(ProviderError)
    const tokens = fake.requests.filter((item) => item.kind === 'token')
    expect(tokens.every((item) => item.params.contentType === 'application/x-www-form-urlencoded')).toBe(true)
    expect(fake.exchanges.kakao).toBe(6)
  })

  it('코드는 짧은 수명이다', async () => {
    const fake = new FakeOAuth({ redirectUris: { naver: 'https://app.example.test/api/auth/naver/callback' }, codeTtlMs: 1 })
    await fake.listen(0)
    fakes.push(fake)
    const user = fake.addUser('naver')
    const decided = fake.decide(authorize(fake, 'naver'), { approve: true, user: user.id })
    if ('error' in decided) throw new Error(decided.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(exchange(fake, 'naver', codeOf(decided.location), { verifier: null })).rejects.toBeInstanceOf(ProviderError)
  })

  it('사용자 정보 모양: 구글 sub·email · 카카오 id(숫자)·kakao_account · 네이버 response — Authorization: Bearer', async () => {
    const fake = await start()
    for (const provider of ['google', 'kakao', 'naver'] as const) {
      const user = fake.addUser(provider, { email: `x@${provider}.test`, nickname: provider === 'google' ? null : '별명' })
      const decided = fake.decide(authorize(fake, provider, provider === 'naver' ? {} : { code_challenge: challenge, code_challenge_method: 'S256' }), { approve: true, user: user.id })
      if ('error' in decided) throw new Error(decided.error)
      expect(await exchange(fake, provider, codeOf(decided.location), provider === 'naver' ? { verifier: null } : {})).toEqual({ id: user.id, email: `x@${provider}.test`, nickname: provider === 'google' ? null : '별명' })
    }
    expect((await fetch(fake.endpoints('kakao').userInfoUrl)).status).toBe(401)
  })

  it('HTTP 조작 경로: 사용자·실패·돌아오는 주소·받은 요청·화면 없이 동의·지우기', async () => {
    const fake = await start()
    const post = async (path: string, body: unknown) => (await fetch(`${fake.url}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })).json() as Promise<Record<string, unknown>>
    const made = (await post('/_fake/users', { provider: 'google', email: null, nickname: null })).user as { id: string }
    expect(made.id).toMatch(/^\d+$/)
    const users = (await (await fetch(`${fake.url}/_fake/users?provider=google`)).json()) as { users: { id: string }[] }
    expect(users.users.map((item) => item.id)).toEqual([made.id])
    expect(await post('/_fake/fail', { provider: 'google', step: 'token', status: 503 })).toEqual({ ok: true })
    const approved = await post('/_fake/approve', { url: authorize(fake, 'google', { code_challenge: challenge, code_challenge_method: 'S256' }), user: made.id })
    await expect(exchange(fake, 'google', codeOf(approved.location as string))).rejects.toMatchObject({ kind: 'http', status: 503 })
    expect(await post('/_fake/redirect', { provider: 'google', redirectUri: 'https://elsewhere.test/cb' })).toEqual({ ok: true })
    expect((await post('/_fake/approve', { url: authorize(fake, 'google', { redirect_uri: 'https://app.example.test/api/auth/google/callback' }), user: made.id, action: 'cancel' })).error).toBe('redirect_uri_mismatch')
    const requests = (await (await fetch(`${fake.url}/_fake/requests?provider=google`)).json()) as { requests: { kind: string; params: Record<string, unknown> }[]; exchanges: Record<string, number> }
    expect(requests.exchanges.google).toBe(1)
    expect(requests.requests.find((item) => item.kind === 'token')?.params).toMatchObject({ grant_type: 'authorization_code', codeVerifierSent: true, codeVerifierOk: true, clientSecretOk: true })
    expect(await post('/_fake/reset', {})).toEqual({ ok: true })
    expect(fake.requests).toEqual([])
  })

  it('연습 모드: 화면 위 연습 문구·연습 계정 둘(이메일 있음·없음), 조작 경로 없음, 앞머리 경로', async () => {
    const fake = new FakeOAuth({ practice: true, basePath: '/_try/oauth', redirectUris: { kakao: REDIRECT } })
    const users = fake.users('kakao')
    expect(users.map((user) => user.email === null)).toEqual([false, true])
    const url = new URL(fake.endpoints('kakao', 'http://localhost:7700').authUrl)
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: fake.clients.kakao.clientId, redirect_uri: REDIRECT, state: 's'.repeat(43) })) url.searchParams.set(key, value)
    expect(url.pathname).toBe('/_try/oauth/kakao/authorize')
    const page = await fake.handle(new Request(url))
    expect(await page.text()).toContain('연습용 가짜 화면이에요. 실제 카카오가 아니에요.')
    expect((await fake.handle(new Request('http://localhost:7700/_try/oauth/_fake/users'))).status).toBe(404)
    expect((await fake.handle(new Request('http://localhost:7700/kakao/authorize'))).status).toBe(404)
  })
})

describe('AC-L1-12 E2E 기동', () => {
  it('기본은 꺼짐(지금과 같다), social을 주면 가짜 OAuth 서버와 함께 뜨고 그 화면 주소를 등록한다', async () => {
    const off = await startE2eServer({ passwordCost: { N: 2 ** 10, r: 8, p: 1 }, initialBackup: false })
    try {
      expect(off.fakeOAuth).toBeNull()
      expect(off.server.social.enabled).toEqual([])
    } finally {
      await off.close()
    }
    const on = await startE2eServer({ appOrigin: 'http://localhost:5199', social: { providers: ['naver', 'google'] }, passwordCost: { N: 2 ** 10, r: 8, p: 1 }, initialBackup: false })
    try {
      expect(on.fakeOAuth?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(on.server.social.enabled).toEqual(['naver', 'google'])
      expect(on.fakeOAuth?.registeredRedirect('naver')).toBe('http://localhost:5199/api/auth/naver/callback')
      expect(on.fakeOAuth?.registeredRedirect('kakao')).toBeNull()
    } finally {
      await on.close()
    }
  })
})
