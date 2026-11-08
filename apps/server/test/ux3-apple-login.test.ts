// D-UX3-34 Apple 로그인: 환경 변수 넷, .p8 키로 만드는 client_secret(ES256 JWT), 승인 주소(scope 없음·response_mode=query),
// id_token 읽기(iss·aud·exp·sub), 토큰 교환 요청 모양, 서버의 시작·취소·로그인 흐름. 키는 Apple .p8과 같은 형식(PKCS#8 P-256)으로 시험마다 새로 만든다.
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  APPLE_ID_MESSAGE,
  APPLE_ISSUER,
  APPLE_KEY_MESSAGE,
  PROVIDER_ENDPOINTS,
  ProviderError,
  SOCIAL_ENV,
  appleClientSecret,
  authorizeUrl,
  checkSocialSetup,
  fetchProfile,
  halfConfiguredMessage,
  normalizeApplePrivateKey,
  parseAppleIdToken,
  readSocialLoginEnv,
  type AppleKey,
  type SocialLoginSetup,
} from '../src/social/providers.ts'
import { cookieValue, openCallback, resultOf } from './l1-support.ts'
import { ORIGIN, client, newWorld } from './support.ts'

const CLIENT_ID = 'kr.livegenie.signin'
const TEAM_ID = '8UR4Y9DY8H'
const KEY_ID = 'ABC123DEFG'

function makeKey(): { readonly pem: string; readonly publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey }
}

const pemBody = (pem: string): string => pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
}

/** Apple이 주는 id_token 모양 (머리·내용·서명 세 조각) */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ kid: 'W6WcOKB', alg: 'RS256' })}.${part(claims)}.${Buffer.from('signature').toString('base64url')}`
}

const NOW = Date.UTC(2026, 10, 6, 3, 0, 0)
const SUB = '001234.0a1b2c3d4e5f60718293a4b5c6d7e8f9.0312'

describe('D-UX3-34 Apple 환경 변수', () => {
  const key = makeKey()
  const full = {
    [SOCIAL_ENV.apple.id]: CLIENT_ID,
    [SOCIAL_ENV.apple.team]: TEAM_ID,
    [SOCIAL_ENV.apple.key]: KEY_ID,
    [SOCIAL_ENV.apple.secret]: key.pem,
  }

  it('넷 다 있으면 켜진다 — 키는 PEM 그대로·\\n으로 적은 것·가운데 글자 한 줄 모두 받는다', () => {
    for (const written of [key.pem, key.pem.replace(/\n/g, '\\n'), pemBody(key.pem)]) {
      const read = readSocialLoginEnv({ ...full, [SOCIAL_ENV.apple.secret]: written })
      expect(read.ok).toBe(true)
      if (!read.ok) continue
      expect(read.providers.apple?.clientId).toBe(CLIENT_ID)
      expect(read.providers.apple?.clientSecret).toBeNull()
      expect(read.providers.apple?.appleKey).toMatchObject({ teamId: TEAM_ID, keyId: KEY_ID })
      expect(pemBody(read.providers.apple?.appleKey?.privateKey ?? '')).toBe(pemBody(key.pem))
    }
  })

  it('하나도 없으면 꺼지고, 일부만 있으면 서버를 시작하지 않는다 (값은 문장에 넣지 않는다)', () => {
    expect(readSocialLoginEnv({})).toEqual({ ok: true, providers: {} })
    for (const name of Object.keys(full)) {
      const partial = { ...full, [name]: '' }
      const read = readSocialLoginEnv(partial)
      expect(read).toEqual({ ok: false, message: halfConfiguredMessage('apple') })
    }
    expect(halfConfiguredMessage('apple')).not.toContain(CLIENT_ID)
  })

  it('팀 ID·키 ID 모양이 틀리거나 키가 P-256 개인 키가 아니면 멈춘다', () => {
    expect(readSocialLoginEnv({ ...full, [SOCIAL_ENV.apple.team]: 'team' })).toEqual({ ok: false, message: APPLE_ID_MESSAGE })
    expect(readSocialLoginEnv({ ...full, [SOCIAL_ENV.apple.key]: 'abc123defg' })).toEqual({ ok: false, message: APPLE_ID_MESSAGE })
    expect(readSocialLoginEnv({ ...full, [SOCIAL_ENV.apple.secret]: 'not-a-key' })).toEqual({ ok: false, message: APPLE_KEY_MESSAGE })
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(readSocialLoginEnv({ ...full, [SOCIAL_ENV.apple.secret]: rsa })).toEqual({ ok: false, message: APPLE_KEY_MESSAGE })
    expect(normalizeApplePrivateKey('')).toBeNull()
  })

  it('다른 공급자와 함께 켜지고, 설정 확인을 지난다', () => {
    const read = readSocialLoginEnv({ ...full, LIVEJJIM_LOGIN_KAKAO_REST_API_KEY: 'k-key' })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(Object.keys(read.providers).sort()).toEqual(['apple', 'kakao'])
    expect(checkSocialSetup({ providers: read.providers })).toBeNull()
    expect(checkSocialSetup({ providers: { apple: { clientId: CLIENT_ID, clientSecret: null } } })).toBe(halfConfiguredMessage('apple'))
    expect(checkSocialSetup({ providers: { apple: { clientId: CLIENT_ID, clientSecret: null, appleKey: { teamId: TEAM_ID, keyId: KEY_ID, privateKey: 'x' } } } })).toBe(APPLE_KEY_MESSAGE)
  })
})

describe('D-UX3-34 client_secret (ES256 JWT)', () => {
  it('머리 kid·ES256, 내용 iss=팀 ID·sub=Services ID·aud=Apple·5분, 공개 키로 서명이 맞는다', () => {
    const key = makeKey()
    const secret = appleClientSecret(CLIENT_ID, { teamId: TEAM_ID, keyId: KEY_ID, privateKey: key.pem }, NOW)
    const [head, body, signature] = secret.split('.') as [string, string, string]
    expect(decode(head)).toEqual({ alg: 'ES256', kid: KEY_ID })
    const iat = Math.floor(NOW / 1000)
    expect(decode(body)).toEqual({ iss: TEAM_ID, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: CLIENT_ID })
    const raw = Buffer.from(signature, 'base64url')
    expect(raw.length).toBe(64)
    expect(verify('sha256', Buffer.from(`${head}.${body}`, 'ascii'), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true)
    expect(verify('sha256', Buffer.from(`${head}.${body}x`, 'ascii'), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(false)
  })
})

describe('D-UX3-34 승인 주소', () => {
  it('appleid.apple.com, scope·PKCE 없이 response_mode=query', () => {
    const url = new URL(authorizeUrl(PROVIDER_ENDPOINTS.apple, { provider: 'apple', clientId: CLIENT_ID, redirectUri: `${ORIGIN}/api/auth/apple/callback`, state: 'st', challenge: null }))
    expect(`${url.origin}${url.pathname}`).toBe('https://appleid.apple.com/auth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `${ORIGIN}/api/auth/apple/callback`,
      state: 'st',
      response_mode: 'query',
    })
  })
})

describe('D-UX3-34 id_token 읽기', () => {
  const good = { iss: APPLE_ISSUER, aud: CLIENT_ID, exp: NOW / 1000 + 600, iat: NOW / 1000, sub: SUB }

  it('맞으면 sub가 계정 ID (이메일은 있으면)', () => {
    expect(parseAppleIdToken(idToken(good), CLIENT_ID, NOW)).toEqual({ id: SUB, email: null, nickname: null })
    expect(parseAppleIdToken(idToken({ ...good, email: 'abc@privaterelay.appleid.com' }), CLIENT_ID, NOW)?.email).toBe('abc@privaterelay.appleid.com')
  })

  it('발급자·받는 쪽이 다르거나 만료됐거나 sub 모양이 틀리면 null', () => {
    expect(parseAppleIdToken(idToken({ ...good, iss: 'https://evil.example' }), CLIENT_ID, NOW)).toBeNull()
    expect(parseAppleIdToken(idToken({ ...good, aud: 'other.client' }), CLIENT_ID, NOW)).toBeNull()
    expect(parseAppleIdToken(idToken({ ...good, exp: NOW / 1000 - 3600 }), CLIENT_ID, NOW)).toBeNull()
    expect(parseAppleIdToken(idToken({ ...good, sub: 'a b' }), CLIENT_ID, NOW)).toBeNull()
    expect(parseAppleIdToken(idToken({ ...good, sub: undefined }), CLIENT_ID, NOW)).toBeNull()
    expect(parseAppleIdToken('a.b', CLIENT_ID, NOW)).toBeNull()
    expect(parseAppleIdToken(undefined, CLIENT_ID, NOW)).toBeNull()
  })
})

/** Apple 토큰 주소가 받는 요청을 확인하고 그 답을 주는 fetch (서버가 Apple에 보내는 모양 그대로) */
function appleTokenFetch(key: { readonly publicKey: KeyObject }, answer: () => Response, seen: URLSearchParams[], urls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input))
    const form = new URLSearchParams(String(init?.body ?? ''))
    seen.push(form)
    const [head, body, signature] = (form.get('client_secret') ?? '').split('.') as [string, string, string]
    const ok = verify('sha256', Buffer.from(`${head}.${body}`, 'ascii'), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature ?? '', 'base64url'))
    if (!ok) return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 })
    return answer()
  }) as typeof fetch
}

describe('D-UX3-34 토큰 교환', () => {
  const key = makeKey()
  const appleKey: AppleKey = { teamId: TEAM_ID, keyId: KEY_ID, privateKey: key.pem }
  const base = {
    provider: 'apple' as const,
    client: { clientId: CLIENT_ID, clientSecret: null, appleKey },
    endpoints: PROVIDER_ENDPOINTS.apple,
    redirectUri: `${ORIGIN}/api/auth/apple/callback`,
    code: 'c1',
    verifier: null,
    state: 'st',
    timeoutMs: 1000,
    now: NOW,
  }

  it('Apple 토큰 주소에 서명한 client_secret을 보내고 id_token의 sub를 쓴다 (사용자 정보 주소는 부르지 않는다)', async () => {
    const seen: URLSearchParams[] = []
    const urls: string[] = []
    const answer = () => new Response(JSON.stringify({ access_token: 'a', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r', id_token: idToken({ iss: APPLE_ISSUER, aud: CLIENT_ID, exp: NOW / 1000 + 600, iat: NOW / 1000, sub: SUB }) }))
    const profile = await fetchProfile({ ...base, fetch: appleTokenFetch(key, answer, seen, urls) })
    expect(profile).toEqual({ id: SUB, email: null, nickname: null })
    expect(urls).toEqual(['https://appleid.apple.com/auth/token'])
    const form = seen[0] as URLSearchParams
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('client_id')).toBe(CLIENT_ID)
    expect(form.get('code')).toBe('c1')
    expect(form.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/apple/callback`)
    expect(form.has('code_verifier')).toBe(false)
    expect(form.has('state')).toBe(false)
  })

  it('id_token이 없거나 틀리면 모양 오류, invalid_grant는 그대로', async () => {
    const run = (body: unknown, status = 200) => fetchProfile({ ...base, fetch: appleTokenFetch(key, () => new Response(JSON.stringify(body), { status }), [], []) })
    await expect(run({ access_token: 'a' })).rejects.toMatchObject({ step: 'userinfo', kind: 'shape' })
    await expect(run({ access_token: 'a', id_token: idToken({ iss: APPLE_ISSUER, aud: 'other', exp: NOW / 1000 + 600, sub: SUB }) })).rejects.toBeInstanceOf(ProviderError)
    await expect(run({ error: 'invalid_grant' }, 400)).rejects.toMatchObject({ step: 'token', kind: 'invalid_grant' })
  })

  it('키가 없으면 Apple을 부르지 않는다', async () => {
    const urls: string[] = []
    await expect(fetchProfile({ ...base, client: { clientId: CLIENT_ID, clientSecret: null }, fetch: appleTokenFetch(key, () => new Response('{}'), [], urls) })).rejects.toBeInstanceOf(ProviderError)
    expect(urls).toEqual([])
  })
})

describe('D-UX3-34 서버 흐름', () => {
  async function appleWorld(fetchFn?: typeof fetch) {
    const key = makeKey()
    const setup: SocialLoginSetup = { providers: { apple: { clientId: CLIENT_ID, clientSecret: null, appleKey: { teamId: TEAM_ID, keyId: KEY_ID, privateKey: key.pem } } }, ...(fetchFn === undefined ? {} : { fetch: fetchFn }) }
    return { world: await newWorld({ socialLogin: setup }), key }
  }

  it('로그인 화면에 Apple이 보이고, 시작하면 실제 Apple 승인 주소로 간다', async () => {
    const { world } = await appleWorld()
    expect((await client(world, null).get('/api/client-config')).body).toEqual({ loginProviders: ['apple'] })
    const started = await client(world, null).post('/api/auth/start', { provider: 'apple' })
    expect(started.status).toBe(200)
    const url = new URL(started.body.authorizeUrl as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://appleid.apple.com/auth/authorize')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/apple/callback`)
    expect(url.searchParams.get('response_mode')).toBe('query')
    expect(url.searchParams.has('scope')).toBe(false)
    expect(url.searchParams.has('code_challenge')).toBe(false)
  })

  it('Apple 화면에서 취소하면(user_cancelled_authorize) 취소로 돌아온다', async () => {
    const { world } = await appleWorld()
    const started = await client(world, null).post('/api/auth/start', { provider: 'apple' })
    const browser = cookieValue(started.headers, '__Host-lj_oauth') as string
    const state = new URL(started.body.authorizeUrl as string).searchParams.get('state') as string
    const back = await openCallback(world, `${ORIGIN}/api/auth/apple/callback?error=user_cancelled_authorize&state=${state}`, { browser })
    expect(resultOf(back)).toMatchObject({ login: 'CANCELLED', provider: 'apple' })
  })

  it('처음 온 Apple 계정은 가입 표로 간다 (세션 없음)', async () => {
    const holder: { key?: { publicKey: KeyObject } } = {}
    const answer = () => new Response(JSON.stringify({ access_token: 'a', id_token: idToken({ iss: APPLE_ISSUER, aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, sub: SUB }) }))
    const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => appleTokenFetch(holder.key as { publicKey: KeyObject }, answer, [], [])(input, init)) as typeof fetch
    const { world, key } = await appleWorld(fetchFn)
    holder.key = key
    const started = await client(world, null).post('/api/auth/start', { provider: 'apple' })
    const browser = cookieValue(started.headers, '__Host-lj_oauth') as string
    const state = new URL(started.body.authorizeUrl as string).searchParams.get('state') as string
    const back = await openCallback(world, `${ORIGIN}/api/auth/apple/callback?code=c1&state=${state}`, { browser })
    expect(resultOf(back)).toMatchObject({ login: 'SIGNUP', provider: 'apple' })
    expect(cookieValue(back.headers, 'lj_session')).toBeNull()
  })
})
