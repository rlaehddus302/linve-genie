// L1 간편 로그인 시험 도우미: 가짜 OAuth 서버(127.0.0.1)와 함께 서버를 띄우고, 시작 → 가짜 승인 → 돌아오는 주소를 HTTP 모양 그대로 돈다.
import { expect } from 'vitest'
import { FakeOAuth, type FakeOAuthOptions } from '../src/social/fake-oauth.ts'
import type { ProviderId } from '../src/social/providers.ts'
import type { ServerOptions } from '../src/server.ts'
import { ORIGIN, client, newWorld, type FakeClock, type TestServer } from './support.ts'

export const ALL_PROVIDERS: readonly ProviderId[] = ['google', 'kakao', 'naver']

export interface SocialWorld extends TestServer {
  readonly fake: FakeOAuth
}

export async function newSocialWorld(
  options: { readonly providers?: readonly ProviderId[]; readonly fake?: FakeOAuthOptions; readonly timeoutMs?: number } & Partial<ServerOptions> & { clock?: FakeClock } = {},
): Promise<SocialWorld> {
  const { providers, fake: fakeOptions, timeoutMs, ...overrides } = options
  const chosen = providers ?? ALL_PROVIDERS
  const fake = await FakeOAuth.start({ redirectUris: Object.fromEntries(chosen.map((p) => [p, `${ORIGIN}/api/auth/${p}/callback`])), ...fakeOptions })
  const world = await newWorld({ socialLogin: fake.setup({ providers: chosen, ...(timeoutMs === undefined ? {} : { timeoutMs }) }), ...overrides })
  return { ...world, fake }
}

/** Set-Cookie 머리글들에서 이름=값 */
export function cookieValue(headers: Headers, name: string): string | null {
  for (const line of headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`).exec(line)
    if (match !== null) return match[1] ?? ''
  }
  return null
}

export interface Started {
  readonly authorizeUrl: string
  /** 브라우저 쿠키 (lj_oauth 값) */
  readonly browser: string
}

/** 시작 (로그인이면 세션 없이, 연결이면 그 세션 쿠키로). browser = 이미 가진 lj_oauth 값 */
export async function startFlow(world: TestServer, provider: ProviderId, options: { readonly session?: string; readonly browser?: string } = {}): Promise<Started> {
  const cookies = [options.session, options.browser === undefined ? undefined : `lj_oauth=${options.browser}`].filter((item): item is string => item !== undefined).join('; ')
  const path = options.session === undefined ? '/api/auth/start' : '/api/auth/link'
  const response = await client(world, cookies === '' ? null : cookies).post(path, { provider })
  expect(response.status, response.text).toBe(200)
  const browser = cookieValue(response.headers, 'lj_oauth')
  expect(browser).not.toBeNull()
  return { authorizeUrl: response.body.authorizeUrl as string, browser: browser as string }
}

/** 가짜 승인 화면에서 동의(또는 취소)한 뒤의 돌아오는 주소 */
export function approve(fake: FakeOAuth, authorizeUrl: string, user: string | null): string {
  const decided = fake.decide(authorizeUrl, user === null ? { approve: false } : { approve: true, user })
  if ('error' in decided) throw new Error(`가짜 승인 실패: ${decided.error}`)
  return decided.location
}

/** 돌아오는 주소 열기 (그 브라우저의 쿠키로) */
export async function openCallback(world: TestServer, location: string, cookies: { readonly browser?: string; readonly session?: string; readonly headers?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(location)
  expect(url.origin).toBe(ORIGIN)
  const cookie = [cookies.session, cookies.browser === undefined ? undefined : `lj_oauth=${cookies.browser}`].filter((item): item is string => item !== undefined).join('; ')
  return world.server.app.request(`${url.pathname}${url.search}`, { headers: { ...(cookie === '' ? {} : { Cookie: cookie }), ...cookies.headers } })
}

/** 결과 코드 (Location의 login 매개변수 — 없으면 null) */
export function resultOf(response: Response): { readonly path: string; readonly login: string | null; readonly provider: string | null; readonly location: string } {
  expect(response.status).toBe(302)
  const location = response.headers.get('location') ?? ''
  const url = new URL(location)
  return { path: url.pathname, login: url.searchParams.get('login'), provider: url.searchParams.get('provider'), location }
}

/** 한 번에: 시작 → 동의 → 돌아옴. 세션 쿠키(로그인 성공이면 새 세션)와 결과 */
export async function runFlow(
  world: SocialWorld,
  provider: ProviderId,
  user: string | null,
  options: { readonly session?: string } = {},
): Promise<{ readonly response: Response; readonly result: ReturnType<typeof resultOf>; readonly session: string | null }> {
  const started = await startFlow(world, provider, options)
  const location = approve(world.fake, started.authorizeUrl, user)
  const response = await openCallback(world, location, { browser: started.browser, ...(options.session === undefined ? {} : { session: options.session }) })
  const token = cookieValue(response.headers, 'lj_session')
  return { response, result: resultOf(response), session: token === null ? null : `lj_session=${token}` }
}
