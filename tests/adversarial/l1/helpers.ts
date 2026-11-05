// L1 적대 시험 공용 도구 (test-domain): 가짜 OAuth 서버(127.0.0.1)와 함께 서버(PGlite 메모리)를 띄우고 HTTP 모양 그대로 공격한다.
// 실제 구글·카카오·네이버 주소로 나가는 요청은 막는다(acceptance 공통 전제).
import { expect } from 'vitest'
import { FakeOAuth, type FakeOAuthOptions } from '../../../apps/server/src/social/fake-oauth.ts'
import type { ProviderId, SocialLoginSetup } from '../../../apps/server/src/social/providers.ts'
import { installGoogleBlock } from '../../../apps/server/src/youtube/network-guard.ts'
import { installOutboundGuard } from '../../../apps/server/test/outbound-guard.ts'
import { ORIGIN, addSeller, client, login, newWorld, type Seller, type TestServer } from '../../../apps/server/test/support.ts'
import { cookieValue } from '../../../apps/server/test/l1-support.ts'

installGoogleBlock()
installOutboundGuard('social-login', ['kakao.com', 'naver.com'])

export { ORIGIN, addSeller, client, cookieValue, login, type Seller }
type PGlite = NonNullable<TestServer['database']['pglite']>

export const ALL: readonly ProviderId[] = ['google', 'kakao', 'naver']

/** 확인 쿠키 이름 (792c1c1 계약, RA-L1-02 — 하위 도메인이 덮어쓸 수 없는 __Host- 접두어) */
export const OAUTH_COOKIE = '__Host-lj_oauth'

/** 요청 Cookie 머리글: 세션 + 그 브라우저의 확인 쿠키 + (공격용) 덧붙인 쿠키 글 */
function cookieHeader(session: string | null | undefined, browser: string | undefined, extra: string | undefined): string {
  return [session ?? undefined, browser === undefined ? undefined : `${OAUTH_COOKIE}=${browser}`, extra].filter((x): x is string => x !== undefined && x !== '').join('; ')
}

export interface L1World extends TestServer {
  readonly fake: FakeOAuth
  readonly pg: PGlite
  /** 공격 중 받은 응답 전부 (상태·머리글·본문 — 비밀 누출 검사용) */
  readonly seen: string[]
}

const opened: FakeOAuth[] = []
export async function closeAll(): Promise<void> {
  for (const fake of opened.splice(0)) await fake.close()
}

export async function l1World(
  options: {
    readonly providers?: readonly ProviderId[]
    readonly fake?: FakeOAuthOptions
    readonly timeoutMs?: number
    readonly wrap?: (setup: SocialLoginSetup) => SocialLoginSetup
    readonly hooks?: NonNullable<Parameters<typeof newWorld>[0]>['socialHooks']
  } = {},
): Promise<L1World> {
  const providers = options.providers ?? ALL
  const fake = await FakeOAuth.start({
    redirectUris: Object.fromEntries(ALL.map((p) => [p, `${ORIGIN}/api/auth/${p}/callback`])),
    ...options.fake,
  })
  opened.push(fake)
  const base = fake.setup({
    providers,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  const world = await newWorld({
    socialLogin: options.wrap === undefined ? base : options.wrap(base),
    ...(options.hooks === undefined ? {} : { socialHooks: options.hooks }),
  })
  const pg = world.database.pglite as PGlite
  return { ...world, fake, pg, seen: [] }
}

export async function record(w: L1World, response: Response): Promise<Response> {
  w.seen.push(`${String(response.status)} ${JSON.stringify([...response.headers])} ${await response.clone().text()}`)
  return response
}

/** 시작 (세션이 있으면 연결). browser = 그 브라우저가 이미 가진 __Host-lj_oauth, extraCookie = 덧붙일 쿠키 글(공격용) */
export async function start(
  w: L1World,
  provider: ProviderId,
  options: { readonly session?: string | null; readonly browser?: string; readonly extraCookie?: string } = {},
) {
  const cookie = cookieHeader(options.session, options.browser, options.extraCookie)
  const path = options.session === undefined || options.session === null ? '/api/auth/start' : '/api/auth/link'
  const response = await record(
    w,
    await w.server.app.request(path, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        ...(cookie === '' ? {} : { Cookie: cookie }),
      },
      body: JSON.stringify({ provider }),
    }),
  )
  expect(response.status, await response.clone().text()).toBe(200)
  const body = (await response.json()) as { authorizeUrl: string }
  const browser = cookieValue(response.headers, OAUTH_COOKIE) as string
  expect(browser).toMatch(/^[A-Za-z0-9_-]{43}$/)
  return {
    response,
    authorizeUrl: body.authorizeUrl,
    browser,
    state: new URL(body.authorizeUrl).searchParams.get('state') as string,
  }
}

export function consent(w: L1World, authorizeUrl: string, user: string | null): string {
  const decided = w.fake.decide(authorizeUrl, user === null ? { approve: false } : { approve: true, user })
  if ('error' in decided) throw new Error(`가짜 승인 실패: ${decided.error}`)
  return decided.location
}

export async function open(
  w: L1World,
  location: string,
  cookies: {
    readonly browser?: string | undefined
    readonly session?: string | null | undefined
    readonly headers?: Record<string, string>
    readonly extraCookie?: string
  } = {},
): Promise<Response> {
  const url = new URL(location)
  const cookie = cookieHeader(cookies.session, cookies.browser, cookies.extraCookie)
  return record(
    w,
    await w.server.app.request(`${url.pathname}${url.search}`, {
      headers: {
        ...(cookie === '' ? {} : { Cookie: cookie }),
        ...cookies.headers,
      },
    }),
  )
}

export function outcome(response: Response) {
  expect(response.status).toBe(302)
  const location = response.headers.get('location') ?? ''
  const url = new URL(location)
  const token = cookieValue(response.headers, 'lj_session')
  return {
    location,
    origin: url.origin,
    path: url.pathname,
    params: [...url.searchParams.keys()].sort(),
    login: url.searchParams.get('login'),
    provider: url.searchParams.get('provider'),
    session: token === null || token === '' ? null : `lj_session=${token}`,
  }
}

/** 한 번에: 시작 → 동의(또는 취소) → 같은 브라우저로 돌아옴 */
export async function flow(w: L1World, provider: ProviderId, user: string | null, session?: string | null) {
  const started = await start(w, provider, { session: session ?? null })
  return outcome(
    await open(w, consent(w, started.authorizeUrl, user), {
      browser: started.browser,
      session: session ?? null,
    }),
  )
}

export async function rows(w: L1World, sql: string, params: unknown[] = []) {
  return (await w.pg.query<Record<string, unknown>>(sql, params)).rows
}

export async function count(w: L1World, table: string, where = 'true', params: unknown[] = []): Promise<number> {
  return Number((await rows(w, `select count(*)::int as n from ${table} where ${where}`, params))[0]?.n ?? 0)
}

export async function counts(w: L1World): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const table of ['sellers', 'accounts', 'login_links', 'sessions']) out[table] = await count(w, table)
  return out
}

export async function dumpAll(w: L1World): Promise<string> {
  const tables = await rows(w, `select table_name from information_schema.tables where table_schema = 'public'`)
  let out = ''
  for (const { table_name } of tables) out += JSON.stringify(await rows(w, `select * from "${String(table_name)}"`))
  return out
}

export const ip = (address: string) => ({
  incoming: { socket: { remoteAddress: address } },
})
