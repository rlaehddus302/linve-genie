// AC-L1-01 공급자 설정·켜짐·시작 거부, AC-L1-13 환경 변수 목록 (D-L1-07, SYS-05, D-I3-13): 환경 변수가 없으면 지금과 똑같다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { openPglite } from '../src/db/database.ts'
import { productionServerOptions } from '../src/production.ts'
import { createServer } from '../src/server.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { PROVIDER_ENDPOINTS, SOCIAL_ENV, checkSocialSetup, readSocialLoginEnv } from '../src/social/providers.ts'
import { FakeOAuth } from '../src/social/fake-oauth.ts'
import { ORIGIN, addSeller, client, newWorld } from './support.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const fakes: FakeOAuth[] = []
afterAll(async () => {
  for (const fake of fakes) await fake.close()
})

const FULL = {
  LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID: 'g-id-value',
  LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET: 'g-secret-value',
  LIVEJJIM_LOGIN_KAKAO_REST_API_KEY: 'k-key-value',
  LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET: 'k-secret-value',
  LIVEJJIM_LOGIN_NAVER_CLIENT_ID: 'n-id-value',
  LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET: 'n-secret-value',
}

describe('AC-L1-01 환경 변수 읽기', () => {
  it('하나도 없으면 꺼진다', () => {
    expect(readSocialLoginEnv({})).toEqual({ ok: true, providers: {} })
    expect(readSocialLoginEnv({ LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID: '  ', LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET: '' })).toEqual({ ok: true, providers: {} })
  })

  it('필요한 값이 모두 있는 공급자만 켜진다 (카카오 시크릿은 선택)', () => {
    const all = readSocialLoginEnv(FULL)
    expect(all).toEqual({
      ok: true,
      providers: {
        google: { clientId: 'g-id-value', clientSecret: 'g-secret-value' },
        kakao: { clientId: 'k-key-value', clientSecret: 'k-secret-value' },
        naver: { clientId: 'n-id-value', clientSecret: 'n-secret-value' },
      },
    })
    expect(readSocialLoginEnv({ LIVEJJIM_LOGIN_KAKAO_REST_API_KEY: 'k' })).toEqual({ ok: true, providers: { kakao: { clientId: 'k', clientSecret: null } } })
  })

  it.each([
    ['구글', { LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID: 'g-id-value' }],
    ['구글', { LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET: 'g-secret-value' }],
    ['네이버', { LIVEJJIM_LOGIN_NAVER_CLIENT_ID: 'n-id-value' }],
    ['네이버', { LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET: 'n-secret-value' }],
    ['카카오', { LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET: 'k-secret-value' }],
  ])('%s 설정이 반만 있으면 시작하지 않는다 (값은 문장에 없다)', (name, env) => {
    const result = readSocialLoginEnv(env)
    expect(result).toEqual({ ok: false, message: `${name} 로그인 설정이 반만 적혀 있어요. 둘 다 적거나 둘 다 지워 주세요.` })
    for (const value of Object.values(env)) expect(JSON.stringify(result)).not.toContain(value)
  })

  it('운영 옵션: 반만 적으면 실패, 다 적으면 공급자 ID·비밀값만(주소 바꾸기·http 허용 없음)', async () => {
    const database = await openPglite()
    const base = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: ORIGIN }
    const half = productionServerOptions({ ...base, LIVEJJIM_LOGIN_NAVER_CLIENT_ID: 'n-id-value' }, database)
    expect(half).toEqual({ ok: false, message: '네이버 로그인 설정이 반만 적혀 있어요. 둘 다 적거나 둘 다 지워 주세요.' })
    const full = productionServerOptions({ ...base, ...FULL }, database)
    expect(full.ok).toBe(true)
    if (!full.ok) return
    expect(full.options.socialLogin).toEqual({ providers: readSocialLoginEnv(FULL).ok ? (readSocialLoginEnv(FULL) as { providers: unknown }).providers : null })
    expect(Object.keys(full.options.socialLogin ?? {})).toEqual(['providers'])
    // 주소를 바꾸는 환경 변수가 있어도 읽지 않는다 (그런 설정이 없다)
    const sneaky = productionServerOptions({ ...base, ...FULL, LIVEJJIM_LOGIN_GOOGLE_AUTH_URL: 'http://evil.example/auth' }, database)
    expect(sneaky.ok && Object.keys(sneaky.options.socialLogin ?? {})).toEqual(['providers'])
    const server = createServer(full.options)
    expect(server.social.enabled).toEqual(['kakao', 'naver', 'google'])
    server.close()
    await database.close()
  })

  it('공급자 주소는 고정 https 값이다', () => {
    // D-UX3-34: Apple은 사용자 정보 주소가 없다(빈 글자 — id_token에서 읽는다). 옛 기대: 모든 주소가 https. 새 기대: 빈 Apple 사용자 정보 주소 말고 모두 https
    for (const [provider, endpoints] of Object.entries(PROVIDER_ENDPOINTS))
      for (const [name, url] of Object.entries(endpoints)) if (!(provider === 'apple' && name === 'userInfoUrl')) expect(url.startsWith('https://'), url).toBe(true)
    expect(PROVIDER_ENDPOINTS.apple).toEqual({ authUrl: 'https://appleid.apple.com/auth/authorize', tokenUrl: 'https://appleid.apple.com/auth/token', userInfoUrl: '' })
    expect(PROVIDER_ENDPOINTS.google.authUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(PROVIDER_ENDPOINTS.kakao.tokenUrl).toBe('https://kauth.kakao.com/oauth/token')
    expect(PROVIDER_ENDPOINTS.naver.userInfoUrl).toBe('https://openapi.naver.com/v1/nid/me')
  })

  it('http 공급자 주소는 allowInsecure(시험·연습)일 때만 받는다 — 아니면 서버를 만들지 않는다', async () => {
    const fake = await FakeOAuth.start()
    fakes.push(fake)
    const setup = fake.setup()
    expect(checkSocialSetup(setup)).toBeNull()
    const insecure = { ...setup, allowInsecure: false }
    expect(checkSocialSetup(insecure)).toBe('간편 로그인 공급자 주소는 https://로만 적을 수 있어요.')
    const database = await openPglite()
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: ORIGIN, socialLogin: insecure })).toThrow('https://')
    await database.close()
  })
})

describe('AC-L1-01 client-config · 꺼진 서버는 L1 전과 같다', () => {
  it('공급자가 없으면 client-config에 항목이 없고 /api/auth/**는 세션과 상관없이 404', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    expect((await client(world, seller.cookie).get('/api/client-config')).body).toEqual({ hostActionDelayMs: 5000, testPrinter: false, billing: { enabled: false, testPayment: false } })
    for (const api of [client(world, null), client(world, seller.cookie)]) {
      expect((await api.post('/api/auth/start', { provider: 'kakao' })).status).toBe(404)
      expect((await api.post('/api/auth/link', { provider: 'kakao' })).status).toBe(404)
      expect((await api.get('/api/auth/methods')).status).toBe(404)
      expect((await api.post('/api/auth/unlink', { provider: 'kakao' })).status).toBe(404)
      expect((await api.get('/api/auth/kakao/callback?code=x&state=y')).status).toBe(404)
      expect((await api.get('/api/auth')).status).toBe(404)
    }
  })

  it('켜진 공급자 이름만 카카오·네이버·구글 순 (클라이언트 ID·주소 없음)', async () => {
    const fake = await FakeOAuth.start()
    fakes.push(fake)
    const all = await newWorld({ socialLogin: fake.setup({ providers: ['google', 'naver', 'kakao'] }) })
    // 로그인 전(로그인 화면)에는 켜진 공급자 이름만, 로그인한 뒤에는 기존 항목 + loginProviders
    const body = (await client(all, null).get('/api/client-config')).body
    expect(body).toEqual({ loginProviders: ['kakao', 'naver', 'google'] })
    const seller = await addSeller(all)
    expect((await client(all, seller.cookie).get('/api/client-config')).body).toEqual({
      hostActionDelayMs: 5000,
      testPrinter: false,
      billing: { enabled: false, testPayment: false },
      loginProviders: ['kakao', 'naver', 'google'],
    })
    const text = JSON.stringify(body)
    for (const id of Object.values(fake.clients)) expect(text).not.toContain(id.clientId)
    expect(text).not.toContain(fake.url)
    const one = await newWorld({ socialLogin: fake.setup({ providers: ['google'] }) })
    expect((await client(one, null).get('/api/client-config')).body.loginProviders).toEqual(['google'])
    // 꺼진 공급자의 시작·돌아오는 주소는 404
    expect((await client(one, null).post('/api/auth/start', { provider: 'kakao' })).status).toBe(404)
    expect((await client(one, null).get('/api/auth/kakao/callback?code=x&state=y')).status).toBe(404)
    expect((await client(one, null).get('/api/auth/apple/callback?code=x&state=y')).status).toBe(404)
  })
})

describe('AC-L1-13 환경 변수 목록·배포 문서', () => {
  // D-UX3-34: Apple은 넷(Services ID·팀 ID·키 ID·개인 키) — 옛 기대: 공급자마다 id·secret 둘
  const names = Object.values(SOCIAL_ENV).flatMap((names) => Object.values(names) as string[])

  it('.env.example에 새 변수가 모두 빈 값으로 있다', () => {
    const example = readFileSync(`${ROOT}/.env.example`, 'utf8')
    for (const name of names) expect(example, name).toMatch(new RegExp(`^${name}=$`, 'm'))
  })

  it('docs/DEPLOY.md "간편 로그인 설정" 절: 공급자마다 돌아오는 주소·권한·끄는 법·카카오 비즈 앱·네이버 검수', () => {
    const doc = readFileSync(`${ROOT}/docs/DEPLOY.md`, 'utf8')
    const start = doc.indexOf('간편 로그인 설정')
    expect(start).toBeGreaterThan(-1)
    const section = doc.slice(start)
    for (const name of names) expect(section, name).toContain(`\`${name}\``)
    for (const text of ['/api/auth/google/callback', '/api/auth/kakao/callback', '/api/auth/naver/callback', '/api/auth/apple/callback', 'openid email', '비즈 앱', '검수', '지우']) expect(section, text).toContain(text)
  })
})
