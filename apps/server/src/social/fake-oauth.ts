// 가짜 OAuth 서버 (L1, D-L1-07, AC-L1-12): 구글·카카오·네이버의 승인 화면·토큰 교환·사용자 정보를 흉내 낸다. 127.0.0.1에서만 연다.
// 실제 어댑터(providers.ts)는 주소만 바꿔 이 서버를 부른다 — 같은 HTTP 모양(승인 주소의 질의, 토큰 교환 application/x-www-form-urlencoded,
// 사용자 정보 Authorization: Bearer, 공급자마다 응답 JSON 모양).
// - 승인 화면(GET /<p>/authorize): 등록한 클라이언트 ID·돌아오는 주소와 글자까지 같아야 한다 — 다르면 돌려보내지 않고 오류 화면만.
//   가짜 사용자를 고르고 "동의하고 계속하기"(code·state를 붙여 돌려보냄) 또는 "취소"(error=access_denied).
// - 토큰 교환(POST /<p>/token): 같은 redirect_uri·클라이언트 비밀값·(구글·카카오) code_verifier(S256) 검증, 코드는 한 번만·짧은 수명(기본 60초) —
//   어기면 invalid_grant(네이버는 실제처럼 200 + { error }).
// - 사용자 정보(GET /<p>/userinfo): 구글 { sub, email } · 카카오 { id, kakao_account: { email, profile: { nickname } } } · 네이버 { resultcode, response: { id, email, nickname } }.
// - 시험 조작(JSON, 다른 프로세스는 HTTP로): POST /_fake/users · GET /_fake/users · POST /_fake/fail · POST /_fake/redirect · GET /_fake/requests ·
//   POST /_fake/approve · POST /_fake/reset. 같은 프로세스의 시험은 메서드로 부른다. 자세한 계약은 harness/sprints/L1/dev-notes.md.
// - 연습 모드(practice): 화면 위에 "연습용 가짜 화면이에요. 실제 카카오가 아니에요."를 보이고 연습 계정 둘(이메일 있음·없음)을 미리 만든다.
//   basePath로 연습 화면과 같은 서버의 연습 전용 경로(/_try/oauth) 밑에 놓을 수 있다(listen 없이 handle만).
import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { Server } from 'node:http'
import { createNodeServer } from '../node-server.ts'
import { PROVIDER_NAMES, isProviderId, type ProviderEndpoints, type ProviderId, type SocialLoginSetup, type SocialProviders } from './providers.ts'

export const FAKE_OAUTH_HOST = '127.0.0.1'
const PROVIDERS: readonly ProviderId[] = ['google', 'kakao', 'naver']

export interface FakeUser {
  readonly provider: ProviderId
  readonly id: string
  readonly email: string | null
  readonly nickname: string | null
}

/** 다음 호출에 넣을 실패 */
export interface FakeFault {
  /** 이 HTTP 상태로 답한다 (4xx·5xx) */
  readonly status?: number
  /** 이만큼 기다린 뒤 답한다 (밀리초) */
  readonly delayMs?: number
  /** invalid_grant로 답한다 (토큰 교환) */
  readonly error?: 'invalid_grant'
  /** 모양이 틀린 응답 (JSON 아님 · ID 없음) */
  readonly shape?: 'not_json' | 'missing_id'
}

export type FakeStep = 'token' | 'userinfo'

export interface FakeRequestRecord {
  readonly provider: ProviderId
  readonly kind: 'authorize' | 'token' | 'userinfo'
  readonly at: number
  /** authorize: 받은 질의 그대로 · token: 받은 항목의 요약(비밀값·코드·검증 값은 맞는지만) · userinfo: Bearer가 있었는지 */
  readonly params: Readonly<Record<string, string | boolean>>
}

export interface FakeOAuthOptions {
  readonly port?: number
  /** 경로 앞머리 (연습 모드 '/_try/oauth') */
  readonly basePath?: string
  readonly practice?: boolean
  /** 등록한 클라이언트 (기본: fake-<p>-client / fake-<p>-secret — 카카오도 비밀값 있음) */
  readonly clients?: Partial<Record<ProviderId, { readonly clientId: string; readonly clientSecret: string | null }>>
  /** 등록한 돌아오는 주소 (공급자마다 하나) */
  readonly redirectUris?: Partial<Record<ProviderId, string>>
  /** 만드는 코드·토큰의 앞머리 (비밀 누출 시험의 표시 값) */
  readonly codePrefix?: string
  readonly tokenPrefix?: string
  /** 코드 수명 (기본 60초) */
  readonly codeTtlMs?: number
}

interface CodeRecord {
  readonly provider: ProviderId
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string | null
  readonly userId: string
  readonly expiresAt: number
  used: boolean
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const subject = (provider: ProviderId) => (provider === 'google' ? '구글이' : `${PROVIDER_NAMES[provider]}가`)

export class FakeOAuth {
  readonly #options: FakeOAuthOptions
  readonly basePath: string
  readonly clients: Record<ProviderId, { clientId: string; clientSecret: string | null }>
  readonly #redirects = new Map<ProviderId, string>()
  readonly #users = new Map<ProviderId, FakeUser[]>()
  readonly #codes = new Map<string, CodeRecord>()
  readonly #tokens = new Map<string, { provider: ProviderId; userId: string }>()
  readonly #faults = new Map<string, { fault: FakeFault; times: number }[]>()
  readonly requests: FakeRequestRecord[] = []
  /** 토큰 교환을 받은 수 (공급자마다) */
  readonly exchanges: Record<ProviderId, number> = { google: 0, kakao: 0, naver: 0 }
  #http: Server | null = null
  #url = ''

  constructor(options: FakeOAuthOptions = {}) {
    this.#options = options
    this.basePath = (options.basePath ?? '').replace(/\/$/, '')
    this.clients = {
      google: { clientId: 'fake-google-client', clientSecret: 'fake-google-secret', ...options.clients?.google },
      kakao: { clientId: 'fake-kakao-rest-key', clientSecret: 'fake-kakao-secret', ...options.clients?.kakao },
      naver: { clientId: 'fake-naver-client', clientSecret: 'fake-naver-secret', ...options.clients?.naver },
    }
    for (const provider of PROVIDERS) {
      const uri = options.redirectUris?.[provider]
      if (uri !== undefined) this.#redirects.set(provider, uri)
      this.#users.set(provider, [])
    }
    if (options.practice === true) {
      for (const provider of PROVIDERS) {
        this.addUser(provider, { email: `practice.one@${provider === 'google' ? 'gmail.com' : provider === 'kakao' ? 'kakao.com' : 'naver.com'}`, nickname: '연습 계정 하나' })
        this.addUser(provider, { email: null, nickname: null })
      }
    }
  }

  /** 127.0.0.1의 그 포트(기본 0 = 빈 포트)에서 연다 */
  static async start(options: FakeOAuthOptions = {}): Promise<FakeOAuth> {
    const fake = new FakeOAuth(options)
    await fake.listen(options.port ?? 0)
    return fake
  }

  async listen(port: number): Promise<void> {
    const http = createNodeServer({ app: { fetch: (request: Request) => this.handle(request) } })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(port, FAKE_OAUTH_HOST, () => {
        http.off('error', reject)
        resolve()
      })
    })
    const address = http.address()
    if (typeof address !== 'object' || address === null) throw new Error('가짜 OAuth 서버 주소를 알 수 없다')
    this.#http = http
    this.#url = `http://${FAKE_OAUTH_HOST}:${String(address.port)}`
  }

  /** 연 주소 (http://127.0.0.1:<포트>) */
  get url(): string {
    return this.#url
  }

  /** 그 주소 밑의 공급자 주소 (base 기본 = 연 주소) */
  endpoints(provider: ProviderId, base: string = this.#url): ProviderEndpoints {
    const root = `${base}${this.basePath}/${provider}`
    return { authUrl: `${root}/authorize`, tokenUrl: `${root}/token`, userInfoUrl: `${root}/userinfo` }
  }

  /**
   * 서버 설정 (createServer의 socialLogin): 등록한 클라이언트와 이 서버의 주소. providers로 켤 공급자를 고른다(기본 셋 다).
   * authBase: 승인 화면 주소의 앞(브라우저가 여는 곳 — 연습 모드는 앱 주소), apiBase: 토큰·사용자 정보 주소의 앞(서버가 부르는 곳)
   */
  setup(options: { readonly providers?: readonly ProviderId[]; readonly authBase?: string; readonly apiBase?: string; readonly timeoutMs?: number } = {}): SocialLoginSetup {
    const chosen = options.providers ?? PROVIDERS
    const providers: { -readonly [K in ProviderId]?: { clientId: string; clientSecret: string | null } } = {}
    const endpoints: { -readonly [K in ProviderId]?: ProviderEndpoints } = {}
    for (const provider of chosen) {
      providers[provider] = { ...this.clients[provider] }
      const api = this.endpoints(provider, options.apiBase ?? this.#url)
      endpoints[provider] = { ...api, authUrl: this.endpoints(provider, options.authBase ?? options.apiBase ?? this.#url).authUrl }
    }
    return { providers: providers as SocialProviders, endpoints, allowInsecure: true, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }
  }

  // ── 시험 조작 ────────────────────────────────────────────────────────

  /** 가짜 사용자 (id 기본: 구글·카카오 숫자, 네이버 영문·숫자) */
  addUser(provider: ProviderId, user: { readonly id?: string; readonly email?: string | null; readonly nickname?: string | null } = {}): FakeUser {
    const id = user.id ?? (provider === 'naver' ? randomBytes(16).toString('base64url') : String(randomInt(1_000_000_000, 2 ** 47)))
    const made: FakeUser = { provider, id, email: user.email ?? null, nickname: user.nickname ?? null }
    const list = this.#users.get(provider) as FakeUser[]
    const index = list.findIndex((item) => item.id === id)
    if (index >= 0) list[index] = made
    else list.push(made)
    return made
  }

  users(provider: ProviderId): readonly FakeUser[] {
    return this.#users.get(provider) ?? []
  }

  /** 다음 times번의 그 단계 호출에 실패를 넣는다 */
  failNext(provider: ProviderId, step: FakeStep, fault: FakeFault, times = 1): void {
    const key = `${provider}/${step}`
    const list = this.#faults.get(key) ?? []
    list.push({ fault, times })
    this.#faults.set(key, list)
  }

  /** 등록한 돌아오는 주소를 바꾼다 */
  registerRedirect(provider: ProviderId, redirectUri: string): void {
    this.#redirects.set(provider, redirectUri)
  }

  registeredRedirect(provider: ProviderId): string | null {
    return this.#redirects.get(provider) ?? null
  }

  /** 받은 요청 기록·넣은 실패를 지운다 (사용자·등록은 그대로) */
  reset(): void {
    this.requests.length = 0
    this.#faults.clear()
    for (const provider of PROVIDERS) this.exchanges[provider] = 0
  }

  #takeFault(provider: ProviderId, step: FakeStep): FakeFault | null {
    const list = this.#faults.get(`${provider}/${step}`)
    const first = list?.[0]
    if (list === undefined || first === undefined) return null
    first.times -= 1
    if (first.times <= 0) list.shift()
    return first.fault
  }

  /** 승인 요청 검사: 맞으면 null, 아니면 오류 이름 */
  #checkAuthorize(provider: ProviderId, query: URLSearchParams): string | null {
    if (query.get('client_id') !== this.clients[provider].clientId) return 'invalid_client'
    const registered = this.#redirects.get(provider)
    if (registered === undefined || query.get('redirect_uri') !== registered) return 'redirect_uri_mismatch'
    if (query.get('response_type') !== 'code') return 'unsupported_response_type'
    if ((query.get('state') ?? '') === '') return 'invalid_request'
    const challenge = query.get('code_challenge')
    if (challenge !== null && query.get('code_challenge_method') !== 'S256') return 'invalid_request'
    return null
  }

  /** 승인 결과의 돌아갈 주소 (같은 프로세스 시험: 화면 없이 동의·취소). 승인 요청이 틀리면 오류 이름 */
  decide(authorizeUrl: string, action: { readonly approve: true; readonly user: string } | { readonly approve: false }): { readonly location: string } | { readonly error: string } {
    let url: URL
    try {
      url = new URL(authorizeUrl, 'http://fake.invalid')
    } catch {
      return { error: 'invalid_request' }
    }
    const match = new RegExp(`^${this.basePath}/(google|kakao|naver)/authorize$`).exec(url.pathname)
    if (match === null) return { error: 'invalid_request' }
    const provider = match[1] as ProviderId
    return this.#decide(provider, url.searchParams, action)
  }

  #decide(provider: ProviderId, query: URLSearchParams, action: { readonly approve: true; readonly user: string } | { readonly approve: false }): { readonly location: string } | { readonly error: string } {
    const problem = this.#checkAuthorize(provider, query)
    if (problem !== null) return { error: problem }
    const back = new URL(query.get('redirect_uri') as string)
    const state = query.get('state') as string
    if (!action.approve) {
      back.searchParams.set('error', 'access_denied')
      if (provider !== 'google') back.searchParams.set('error_description', provider === 'naver' ? 'Canceled By User' : 'User denied access')
      back.searchParams.set('state', state)
      return { location: back.toString() }
    }
    const user = this.users(provider).find((item) => item.id === action.user)
    if (user === undefined) return { error: 'unknown_user' }
    const code = `${this.#options.codePrefix ?? 'fake-code-'}${randomBytes(18).toString('base64url')}`
    this.#codes.set(code, {
      provider,
      clientId: query.get('client_id') as string,
      redirectUri: query.get('redirect_uri') as string,
      challenge: query.get('code_challenge'),
      userId: user.id,
      expiresAt: Date.now() + (this.#options.codeTtlMs ?? 60_000),
      used: false,
    })
    back.searchParams.set('code', code)
    back.searchParams.set('state', state)
    return { location: back.toString() }
  }

  // ── HTTP ────────────────────────────────────────────────────────────

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    let path = url.pathname
    if (this.basePath !== '') {
      if (!path.startsWith(`${this.basePath}/`)) return jsonResponse({ error: 'not_found' }, 404)
      path = path.slice(this.basePath.length)
    }
    if (path.startsWith('/_fake/')) {
      if (this.#options.practice === true) return jsonResponse({ error: 'not_found' }, 404)
      return this.#control(request, path, url)
    }
    const match = /^\/(google|kakao|naver)\/(authorize|token|userinfo)$/.exec(path)
    if (match === null) return jsonResponse({ error: 'not_found' }, 404)
    const provider = match[1] as ProviderId
    const kind = match[2] as 'authorize' | 'token' | 'userinfo'
    if (kind === 'authorize') return this.#authorize(provider, request, url)
    if (kind === 'token') return this.#token(provider, request)
    return this.#userinfo(provider, request)
  }

  async #authorize(provider: ProviderId, request: Request, url: URL): Promise<Response> {
    if (request.method === 'POST') {
      const form = new URLSearchParams(await request.text())
      const action = form.get('_action')
      const query = new URLSearchParams()
      for (const [key, value] of form) if (!key.startsWith('_')) query.set(key, value)
      const decided = this.#decide(provider, query, action === 'approve' ? { approve: true, user: form.get('_user') ?? '' } : { approve: false })
      if ('error' in decided) return this.#errorPage(provider, decided.error)
      return new Response(null, { status: 302, headers: { Location: decided.location, 'Cache-Control': 'no-store' } })
    }
    const query = url.searchParams
    this.requests.push({ provider, kind: 'authorize', at: Date.now(), params: Object.fromEntries(query) })
    const problem = this.#checkAuthorize(provider, query)
    if (problem !== null) return this.#errorPage(provider, problem)
    return this.#consentPage(provider, query)
  }

  #page(provider: ProviderId, body: string, status = 200): Response {
    const banner = this.#options.practice === true ? `<p class="practice" role="note">연습용 가짜 화면이에요. 실제 ${subject(provider)} 아니에요.</p>` : ''
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>가짜 ${PROVIDER_NAMES[provider]} 로그인</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:1rem auto;padding:0 1rem;font-size:16px;line-height:1.5}.practice{background:#fff3cd;border:2px solid #b58100;padding:.75rem;font-weight:700}label{display:block;padding:.75rem;border:1px solid #888;margin:.5rem 0;min-height:44px}button{display:block;width:100%;min-height:48px;font-size:16px;margin:.5rem 0}</style></head>
<body>${banner}<h1>가짜 ${PROVIDER_NAMES[provider]} 로그인</h1>${body}</body></html>`
    return new Response(html, {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
    })
  }

  #errorPage(provider: ProviderId, error: string): Response {
    return this.#page(provider, `<p role="alert" data-error="${escapeHtml(error)}">요청이 올바르지 않아 앱으로 돌려보내지 않았어요. (${escapeHtml(error)})</p>`, 400)
  }

  #consentPage(provider: ProviderId, query: URLSearchParams): Response {
    const hidden = [...query].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('')
    const users = this.users(provider)
    const choices =
      users.length === 0
        ? '<p>고를 수 있는 가짜 사용자가 없어요.</p>'
        : users
            .map((user, index) => {
              const name = user.nickname ?? '닉네임 없음'
              const mail = user.email ?? '이메일 없음'
              return `<label><input type="radio" name="_user" value="${escapeHtml(user.id)}" data-user="${escapeHtml(user.id)}"${index === 0 ? ' checked' : ''}> ${escapeHtml(name)} · ${escapeHtml(mail)} · 번호 ${escapeHtml(user.id)}</label>`
            })
            .join('')
    const body = `<form method="post">${hidden}<fieldset><legend>로그인할 가짜 사용자</legend>${choices}</fieldset>
<button type="submit" name="_action" value="approve">동의하고 계속하기</button><button type="submit" name="_action" value="cancel">취소</button></form>`
    return this.#page(provider, body)
  }

  async #faulted(provider: ProviderId, step: FakeStep): Promise<Response | FakeFault | null> {
    const fault = this.#takeFault(provider, step)
    if (fault === null) return null
    if (fault.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, fault.delayMs))
    if (fault.status !== undefined) return jsonResponse({ error: 'server_error' }, fault.status)
    if (fault.shape === 'not_json') return new Response('<html>oops</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
    return fault
  }

  #grantError(provider: ProviderId, error: string): Response {
    // 네이버는 실패도 200 + { error } (실제 동작)
    if (provider === 'naver') return jsonResponse({ error: error === 'invalid_grant' ? 'invalid_request' : error, error_description: 'no valid data in session' })
    return jsonResponse({ error, error_description: 'Bad Request' }, error === 'invalid_client' ? 401 : 400)
  }

  async #token(provider: ProviderId, request: Request): Promise<Response> {
    if (request.method !== 'POST') return jsonResponse({ error: 'invalid_request' }, 405)
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    const form = new URLSearchParams(await request.text())
    const client = this.clients[provider]
    const record = this.#codes.get(form.get('code') ?? '')
    const verifier = form.get('code_verifier')
    const verifierOk = record !== undefined && record.challenge !== null && verifier !== null && createHash('sha256').update(verifier, 'ascii').digest('base64url') === record.challenge
    this.exchanges[provider] += 1
    this.requests.push({
      provider,
      kind: 'token',
      at: Date.now(),
      params: {
        contentType: contentType ?? '',
        grant_type: form.get('grant_type') ?? '',
        client_id: form.get('client_id') ?? '',
        redirect_uri: form.get('redirect_uri') ?? '',
        clientSecretSent: form.has('client_secret'),
        clientSecretOk: client.clientSecret === null ? !form.has('client_secret') : form.get('client_secret') === client.clientSecret,
        codeVerifierSent: verifier !== null,
        codeVerifierOk: verifierOk,
        stateSent: form.has('state'),
      },
    })
    const faulted = await this.#faulted(provider, 'token')
    if (faulted instanceof Response) return faulted
    if (faulted?.error === 'invalid_grant') return this.#grantError(provider, 'invalid_grant')
    if (contentType !== 'application/x-www-form-urlencoded') return this.#grantError(provider, 'invalid_request')
    if (form.get('grant_type') !== 'authorization_code') return this.#grantError(provider, 'unsupported_grant_type')
    if (form.get('client_id') !== client.clientId) return this.#grantError(provider, 'invalid_client')
    if (client.clientSecret !== null && form.get('client_secret') !== client.clientSecret) return this.#grantError(provider, 'invalid_client')
    if (record === undefined || record.provider !== provider || record.used || record.expiresAt <= Date.now() || record.clientId !== client.clientId) {
      if (record !== undefined) record.used = true
      return this.#grantError(provider, 'invalid_grant')
    }
    // 코드는 한 번만 (맞든 틀리든 처음 쓰면 끝)
    record.used = true
    if (form.get('redirect_uri') !== record.redirectUri) return this.#grantError(provider, provider === 'google' ? 'redirect_uri_mismatch' : 'invalid_grant')
    if (record.challenge !== null && !verifierOk) return this.#grantError(provider, 'invalid_grant')
    const token = `${this.#options.tokenPrefix ?? 'fake-token-'}${randomBytes(18).toString('base64url')}`
    this.#tokens.set(token, { provider, userId: record.userId })
    const body: Record<string, unknown> = { access_token: token, token_type: 'bearer', expires_in: 3599, refresh_token: `${this.#options.tokenPrefix ?? 'fake-token-'}r-${randomBytes(12).toString('base64url')}` }
    if (provider === 'google') {
      body.scope = 'openid https://www.googleapis.com/auth/userinfo.email'
      body.id_token = `${this.#options.tokenPrefix ?? 'fake-token-'}id-${randomBytes(12).toString('base64url')}`
    }
    return jsonResponse(body)
  }

  async #userinfo(provider: ProviderId, request: Request): Promise<Response> {
    const auth = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')
    this.requests.push({ provider, kind: 'userinfo', at: Date.now(), params: { bearer: auth !== null } })
    const faulted = await this.#faulted(provider, 'userinfo')
    if (faulted instanceof Response) return faulted
    const session = auth === null ? undefined : this.#tokens.get(auth[1] as string)
    if (session === undefined || session.provider !== provider) return jsonResponse({ error: 'invalid_token' }, 401)
    const user = this.users(provider).find((item) => item.id === session.userId)
    if (user === undefined) return jsonResponse({ error: 'invalid_token' }, 401)
    const missing = faulted?.shape === 'missing_id'
    if (provider === 'google') return jsonResponse({ ...(missing ? {} : { sub: user.id }), ...(user.email === null ? {} : { email: user.email, email_verified: true }) })
    if (provider === 'kakao') {
      const numeric = /^\d{1,15}$/.test(user.id) ? Number(user.id) : user.id
      return jsonResponse({
        ...(missing ? {} : { id: numeric }),
        connected_at: new Date().toISOString(),
        ...(user.nickname === null ? {} : { properties: { nickname: user.nickname } }),
        kakao_account: {
          ...(user.nickname === null ? {} : { profile_nickname_needs_agreement: false, profile: { nickname: user.nickname } }),
          has_email: user.email !== null,
          ...(user.email === null ? {} : { email: user.email, is_email_valid: true, is_email_verified: true }),
        },
      })
    }
    return jsonResponse({
      resultcode: '00',
      message: 'success',
      response: { ...(missing ? {} : { id: user.id }), ...(user.email === null ? {} : { email: user.email }), ...(user.nickname === null ? {} : { nickname: user.nickname }) },
    })
  }

  async #control(request: Request, path: string, url: URL): Promise<Response> {
    const read = async (): Promise<Record<string, unknown>> => {
      try {
        const parsed: unknown = JSON.parse((await request.text()) || '{}')
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
    if (path === '/_fake/users' && request.method === 'GET') {
      const provider = url.searchParams.get('provider')
      return jsonResponse({ users: isProviderId(provider) ? this.users(provider) : PROVIDERS.flatMap((item) => this.users(item)) })
    }
    if (path === '/_fake/users' && request.method === 'POST') {
      const body = await read()
      if (!isProviderId(body.provider)) return jsonResponse({ error: 'provider' }, 400)
      const id = text(body.id)
      const user = this.addUser(body.provider, { ...(id === null ? {} : { id }), email: text(body.email), nickname: text(body.nickname) })
      return jsonResponse({ user })
    }
    if (path === '/_fake/fail' && request.method === 'POST') {
      const body = await read()
      if (!isProviderId(body.provider) || (body.step !== 'token' && body.step !== 'userinfo')) return jsonResponse({ error: 'input' }, 400)
      const fault: FakeFault = {
        ...(typeof body.status === 'number' ? { status: body.status } : {}),
        ...(typeof body.delayMs === 'number' ? { delayMs: body.delayMs } : {}),
        ...(body.error === 'invalid_grant' ? { error: 'invalid_grant' as const } : {}),
        ...(body.shape === 'not_json' || body.shape === 'missing_id' ? { shape: body.shape } : {}),
      }
      const times = typeof body.times === 'number' && Number.isInteger(body.times) && body.times >= 1 ? body.times : 1
      this.failNext(body.provider, body.step, fault, times)
      return jsonResponse({ ok: true })
    }
    if (path === '/_fake/redirect' && request.method === 'POST') {
      const body = await read()
      const uri = text(body.redirectUri)
      if (!isProviderId(body.provider) || uri === null) return jsonResponse({ error: 'input' }, 400)
      this.registerRedirect(body.provider, uri)
      return jsonResponse({ ok: true })
    }
    if (path === '/_fake/requests' && request.method === 'GET') {
      const provider = url.searchParams.get('provider')
      return jsonResponse({ requests: this.requests.filter((item) => !isProviderId(provider) || item.provider === provider), exchanges: this.exchanges })
    }
    if (path === '/_fake/approve' && request.method === 'POST') {
      const body = await read()
      const authorize = text(body.url)
      if (authorize === null) return jsonResponse({ error: 'input' }, 400)
      const decided = this.decide(authorize, body.action === 'cancel' ? { approve: false } : { approve: true, user: text(body.user) ?? '' })
      return 'error' in decided ? jsonResponse(decided, 400) : jsonResponse(decided)
    }
    if (path === '/_fake/reset' && request.method === 'POST') {
      this.reset()
      return jsonResponse({ ok: true })
    }
    return jsonResponse({ error: 'not_found' }, 404)
  }

  async close(): Promise<void> {
    const http = this.#http
    if (http === null) return
    this.#http = null
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}
