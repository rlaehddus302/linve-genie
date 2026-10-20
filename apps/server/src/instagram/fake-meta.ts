// 가짜 메타 서버 (D-N2-11, AC-N2-70) — 서버 시험과 E2E 서버 기동만 쓴다(운영 기동은 쓰지 않는다).
// 실제 통신 방식(HTTP, 127.0.0.1의 빈 포트)으로 메타 그래프 API의 모양대로 답한다. 실제 어댑터(meta.ts)가 주소만 바꿔 붙는다.
// - OAuth 승인 창(허락·거절·권한 빼기·프로페셔널 계정 0/1/2개), 토큰 교환·긴 토큰·새로 고침, 권한·페이지·계정 정보
// - 웹훅 구독·해제·권한 철회 기록, 진행 중 라이브 만들기·끝내기(live_media)
// - 개인 답장(받은 DM 기록 — 같은 댓글의 두 번째는 "이미 답장" 오류, 끝난 라이브는 "라이브 끝남" 오류), 대화 조회
// - 서명한 웹훅 보내기(묶음·중복·순서 바꾸기·늦은 entry.time·틀린 서명·형식 틀린 변경·다른 필드·두 계정 섞기)
// - 오류 주입(5xx·429·속도 제한·토큰 무효·권한 없음·응답 없음·응답 없이 처리·연결 끊기·지연·조회 실패)
// - 시험이 호출 횟수·받은 요청을 읽는다. E2E·화면 시험은 /_fake/* 조작 주소로 같은 일을 한다(dev-notes N2 "화면에게").
// 오류 코드는 meta.ts ERROR_TABLE과 같다.
import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { instagramSettings, type InstagramEndpoints, type InstagramLogin, type InstagramSettings, type InstagramTimeouts } from './config.ts'
import { ERROR_TABLE } from './meta.ts'

export type FakeAccountType = 'BUSINESS' | 'MEDIA_CREATOR' | 'PERSONAL'

export interface FakeAccount {
  readonly id: string
  readonly username: string
  readonly type: FakeAccountType
  /** 계정이 붙은 페이스북 페이지 */
  readonly pageId: string
}

/** 다음 승인 창에서 사용자가 할 일 */
export interface FakeLoginScenario {
  readonly decision: 'approve' | 'deny'
  /** 허락한 계정 ID (페이스북 로그인: 그 계정이 붙은 페이지들 / 인스타그램 로그인: 첫 계정) */
  readonly accounts: readonly string[]
  /** 빼고 허락한 권한 이름 */
  readonly declined: readonly string[]
}

export type FakeOp = 'token' | 'permissions' | 'accounts' | 'me' | 'subscribe' | 'unsubscribe' | 'revoke' | 'refresh' | 'liveMedia' | 'send' | 'conversation'

/** 오류 주입 (그 호출에 차례로 한 번씩 쓴다) */
export type FakeFault =
  | 'SERVER_ERROR'
  | 'TOO_MANY'
  | 'RATE_LIMIT'
  | 'TOKEN_INVALID'
  | 'NO_PERMISSION'
  | 'LIVE_ENDED'
  | 'ONE_REPLY'
  | 'REJECTED'
  /** 응답 없음 (처리하지 않는다) */
  | 'HANG'
  /** 처리한 뒤 응답 없음 (예: DM은 받지만 답하지 않는다) */
  | 'HANG_AFTER'
  /** 연결 끊기 */
  | 'DROP'
  | { readonly delayMs: number }

export interface FakeDm {
  readonly messageId: string
  readonly accountId: string
  readonly commentId: string
  readonly igsid: string
  readonly text: string
  /** 가짜 서버 시계 (UTC 밀리초) */
  readonly at: number
}

export interface FakeComment {
  readonly id: string
  readonly accountId: string
  readonly liveId: string
  readonly igsid: string
  readonly username: string
  readonly text: string
}

interface TokenInfo {
  readonly kind: 'fb-short' | 'fb-user' | 'page' | 'ig-short' | 'ig'
  readonly accounts: readonly string[]
  readonly scenario: FakeLoginScenario
  readonly scopes: readonly string[]
  readonly login: InstagramLogin
  valid: boolean
}

interface CodeInfo {
  readonly login: InstagramLogin
  readonly redirectUri: string
  readonly scenario: FakeLoginScenario
  readonly scopes: readonly string[]
  used: boolean
}

interface Live {
  readonly id: string
  readonly accountId: string
  readonly startedAt: number
  ended: boolean
}

export interface FakeMetaOptions {
  readonly appId?: string
  readonly appSecret?: string
  readonly verifyToken?: string
  /** 가짜 서버 시계 (DM·라이브 시각 — 시험은 서버와 같은 주입 시계를 넣는다) */
  readonly now?: () => number
  /** 웹훅을 보낼 주소 (E2E — /_fake/comments가 쓴다) */
  readonly webhookUrl?: string
}

/** 웹훅 한 변경 */
export interface FakeChange {
  readonly field?: string
  readonly value: unknown
}

/** 웹훅 한 항목 */
export interface FakeEntry {
  readonly accountId: string
  /** entry.time (초). 없으면 가짜 서버 시계 */
  readonly time?: number
  readonly changes: readonly FakeChange[]
}

/** 웹훅을 받는 쪽 (시험: app.request, E2E: HTTP) */
export type WebhookTarget = (body: string, headers: Readonly<Record<string, string>>) => Promise<Response>

const FB = '/graph/v24.0'
const IG = '/ig/v24.0'

const graphError = (status: number, code: number, subcode?: number, extra: Record<string, unknown> = {}) => ({
  status,
  body: { error: { message: '가짜 메타 오류', type: 'OAuthException', code, ...(subcode === undefined ? {} : { error_subcode: subcode }), fbtrace_id: 'fake', ...extra } },
})

const FAULTS: Readonly<Record<Exclude<FakeFault, 'HANG' | 'HANG_AFTER' | 'DROP' | { delayMs: number }>, { status: number; body: unknown }>> = {
  SERVER_ERROR: graphError(500, 2, undefined, { is_transient: true }),
  TOO_MANY: { status: 429, body: { error: { message: '너무 많은 요청', code: 4 } } },
  RATE_LIMIT: graphError(400, ERROR_TABLE.rateLimit[0]),
  TOKEN_INVALID: graphError(400, ERROR_TABLE.tokenInvalid[0], 463),
  NO_PERMISSION: graphError(403, 10),
  LIVE_ENDED: graphError(400, 10, ERROR_TABLE.liveEndedSubcode),
  ONE_REPLY: graphError(400, 100, ERROR_TABLE.oneReplySubcode),
  REJECTED: graphError(400, 100),
}

const PERMISSION_DEFAULTS: Readonly<Record<InstagramLogin, readonly string[]>> = {
  FACEBOOK: ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'],
  INSTAGRAM: ['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages'],
}

const numericId = (prefix: string) => `${prefix}${String(BigInt(`0x${randomBytes(6).toString('hex')}`)).padStart(15, '0')}`

export class FakeMeta {
  readonly appId: string
  readonly appSecret: string
  readonly verifyToken: string
  readonly #server: Server
  readonly #now: () => number
  #url = ''
  webhookUrl: string | null
  readonly accounts = new Map<string, FakeAccount>()
  #scenario: FakeLoginScenario = { decision: 'approve', accounts: [], declined: [] }
  readonly #codes = new Map<string, CodeInfo>()
  readonly #tokens = new Map<string, TokenInfo>()
  readonly #lives = new Map<string, Live>()
  readonly #comments = new Map<string, FakeComment>()
  readonly #replied = new Set<string>()
  readonly #faults = new Map<FakeOp, FakeFault[]>()
  readonly #hanging = new Set<ServerResponse>()
  /** 받은 요청 (호출 종류·가짜 서버 시각) */
  readonly calls: { readonly op: FakeOp; readonly at: number }[] = []
  readonly subscriptions: { readonly node: string; readonly fields: string }[] = []
  readonly unsubscriptions: string[] = []
  readonly revocations: string[] = []
  readonly dms: FakeDm[] = []
  /** 이 서버가 내준 토큰 전부 (시험: DB·로그에 없는지) */
  readonly issuedTokens: string[] = []

  private constructor(options: FakeMetaOptions) {
    this.appId = options.appId ?? 'fake-app-1001'
    this.appSecret = options.appSecret ?? `fake-secret-${randomBytes(12).toString('hex')}`
    this.verifyToken = options.verifyToken ?? `fake-verify-${randomBytes(12).toString('hex')}`
    this.#now = options.now ?? (() => Date.now())
    this.webhookUrl = options.webhookUrl ?? null
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (!res.headersSent) this.#json(res, 500, { error: { message: '가짜 서버 오류', code: 1 } })
      })
    })
  }

  /** 127.0.0.1의 빈 포트에서 연다 */
  static async start(options: FakeMetaOptions = {}): Promise<FakeMeta> {
    const fake = new FakeMeta(options)
    await new Promise<void>((resolve, reject) => {
      fake.#server.once('error', reject)
      fake.#server.listen(0, '127.0.0.1', () => {
        fake.#server.off('error', reject)
        const address = fake.#server.address()
        if (typeof address === 'object' && address !== null) fake.#url = `http://127.0.0.1:${String(address.port)}`
        resolve()
      })
    })
    return fake
  }

  get url(): string {
    return this.#url
  }

  /** 서버 설정에 넣을 메타 주소 */
  endpoints(): InstagramEndpoints {
    return { graph: `${this.#url}${FB}`, igGraph: `${this.#url}${IG}`, fbDialog: `${this.#url}/dialog/oauth`, igAuthorize: `${this.#url}/oauth/authorize`, igToken: `${this.#url}/ig-token` }
  }

  /** 이 가짜 서버에 붙는 인스타그램 설정 (시험·E2E) */
  settings(input: { readonly redirectUri: string; readonly login?: InstagramLogin; readonly timeouts?: Partial<InstagramTimeouts>; readonly returnPath?: string }): InstagramSettings {
    return instagramSettings({
      appId: this.appId,
      appSecret: this.appSecret,
      verifyToken: this.verifyToken,
      redirectUri: input.redirectUri,
      login: input.login ?? 'FACEBOOK',
      endpoints: this.endpoints(),
      timeouts: { requestMs: 10_000, sendMs: 10_000, confirmMs: 30_000, ...input.timeouts },
      ...(input.returnPath === undefined ? {} : { returnPath: input.returnPath }),
    })
  }

  // ── 시험 조작 ───────────────────────────────────────────────────────────

  addAccount(input: { readonly id?: string; readonly username: string; readonly type?: FakeAccountType; readonly pageId?: string }): FakeAccount {
    const account: FakeAccount = { id: input.id ?? numericId('1784'), username: input.username, type: input.type ?? 'BUSINESS', pageId: input.pageId ?? numericId('1099') }
    this.accounts.set(account.id, account)
    return account
  }

  /** 다음 승인 창의 사용자 선택 */
  setLogin(scenario: Partial<FakeLoginScenario>): void {
    this.#scenario = { decision: 'approve', accounts: [], declined: [], ...scenario }
  }

  /** 승인 창을 열어 사용자 선택대로 돌아오는 주소(Location)를 받는다 */
  async authorize(url: string): Promise<string> {
    const response = await fetch(url, { redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status !== 302 || location === null) throw new Error('가짜 승인 창이 돌려보내지 않았다')
    return location
  }

  /** 오류 주입: 그 호출의 다음 times번에 차례로 */
  fail(op: FakeOp, fault: FakeFault, times = 1): void {
    const list = this.#faults.get(op) ?? []
    for (let i = 0; i < times; i++) list.push(fault)
    this.#faults.set(op, list)
  }

  clearFaults(): void {
    this.#faults.clear()
  }

  /** 그 계정(없으면 전부)의 토큰을 무효로 */
  invalidateTokens(accountId?: string): void {
    for (const info of this.#tokens.values()) if (accountId === undefined || info.accounts.includes(accountId)) info.valid = false
  }

  count(op: FakeOp): number {
    return this.calls.filter((call) => call.op === op).length
  }

  startLive(accountId: string, id: string = numericId('1790')): string {
    this.#lives.set(id, { id, accountId, startedAt: this.#now(), ended: false })
    return id
  }

  endLive(liveId: string): void {
    const live = this.#lives.get(liveId)
    if (live !== undefined) live.ended = true
  }

  /** 라이브 댓글 하나를 만든다 (웹훅 변경 value를 돌려준다) */
  comment(input: { readonly accountId: string; readonly liveId: string; readonly igsid: string; readonly username: string; readonly text: string; readonly id?: string }): FakeChange {
    const comment: FakeComment = { id: input.id ?? numericId('1790'), accountId: input.accountId, liveId: input.liveId, igsid: input.igsid, username: input.username, text: input.text }
    this.#comments.set(comment.id, comment)
    return {
      field: 'live_comments',
      value: { from: { id: comment.igsid, username: comment.username }, media: { id: comment.liveId, media_product_type: 'LIVE' }, id: comment.id, text: comment.text },
    }
  }

  /** 웹훅 본문 (object = instagram) */
  payload(entries: readonly FakeEntry[]): string {
    return JSON.stringify({
      object: 'instagram',
      entry: entries.map((entry) => ({ id: entry.accountId, time: entry.time ?? Math.floor(this.#now() / 1000), changes: entry.changes.map((change) => ({ field: change.field ?? 'live_comments', value: change.value })) })),
    })
  }

  /** X-Hub-Signature-256 (원래 바이트의 HMAC-SHA256) */
  sign(body: string | Uint8Array, secret: string = this.appSecret): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  }

  /** 서명한 웹훅을 보낸다. signature를 주면 그 값(틀린 서명 시험), null이면 헤더 없음 */
  deliver(target: WebhookTarget, body: string, options: { readonly signature?: string | null } = {}): Promise<Response> {
    const signature = options.signature === undefined ? this.sign(body) : options.signature
    return target(body, { 'Content-Type': 'application/json', ...(signature === null ? {} : { 'X-Hub-Signature-256': signature }) })
  }

  /** HTTP로 웹훅을 받는 쪽 (E2E) */
  httpTarget(url: string): WebhookTarget {
    return (body, headers) => fetch(url, { method: 'POST', headers: { ...headers }, body })
  }

  close(): Promise<void> {
    for (const res of this.#hanging) res.socket?.destroy()
    this.#hanging.clear()
    this.#server.closeAllConnections()
    return new Promise((resolve) => this.#server.close(() => resolve()))
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  #json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  async #body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  }

  #issue(info: Omit<TokenInfo, 'valid'>): string {
    const token = `${info.kind}-${randomBytes(18).toString('base64url')}`
    this.#tokens.set(token, { ...info, valid: true })
    this.issuedTokens.push(token)
    return token
  }

  #token(req: IncomingMessage, url: URL): TokenInfo | null {
    const header = req.headers.authorization
    const raw = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : url.searchParams.get('access_token')
    if (raw === null) return null
    const info = this.#tokens.get(raw)
    return info !== undefined && info.valid ? info : null
  }

  /** 오류 주입 적용. 처리했으면(응답했거나 매달아 둠) 'done', 처리한 뒤 매달기면 'after', 아니면 null */
  async #fault(op: FakeOp, res: ServerResponse, req: IncomingMessage): Promise<'done' | 'after' | null> {
    const list = this.#faults.get(op)
    const fault = list?.shift()
    if (fault === undefined) return null
    if (typeof fault === 'object') {
      await new Promise((resolve) => setTimeout(resolve, fault.delayMs))
      return null
    }
    if (fault === 'HANG') {
      this.#hanging.add(res)
      return 'done'
    }
    if (fault === 'HANG_AFTER') return 'after'
    if (fault === 'DROP') {
      req.socket.destroy()
      return 'done'
    }
    const response = FAULTS[fault]
    this.#json(res, response.status, response.body)
    return 'done'
  }

  /** 응답 (처리 뒤 매달기면 답하지 않는다) */
  #reply(res: ServerResponse, mode: 'after' | null, status: number, body: unknown): void {
    if (mode === 'after') {
      this.#hanging.add(res)
      return
    }
    this.#json(res, status, body)
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.#url)
    const method = req.method ?? 'GET'
    const path = url.pathname
    if (path.startsWith('/_fake/')) return this.#control(method, path, req, res)
    if (method === 'GET' && (path === '/dialog/oauth' || path === '/oauth/authorize')) return this.#dialog(path === '/dialog/oauth' ? 'FACEBOOK' : 'INSTAGRAM', url, res)
    if (method === 'POST' && path === '/ig-token') return this.#igCode(req, res)
    const fb = path.startsWith(`${FB}/`)
    const ig = path.startsWith(`${IG}/`)
    if (!fb && !ig) return this.#json(res, 404, graphError(404, 803).body)
    const parts = path.slice((fb ? FB : IG).length + 1).split('/')
    const [first = '', second = ''] = parts
    if (fb && first === 'oauth' && second === 'access_token') return this.#fbToken(url, res, req)
    if (ig && first === 'access_token') return this.#igLong(url, res, req)
    if (ig && first === 'refresh_access_token') return this.#igRefresh(url, res, req)
    if (first === 'me' && second === 'permissions') return method === 'DELETE' ? this.#revoke(req, url, res) : this.#permissions(req, url, res)
    if (fb && first === 'me' && second === 'accounts') return this.#pages(req, url, res)
    if (ig && first === 'me' && parts.length === 1) return this.#me(req, url, res)
    if (second === 'subscribed_apps') return this.#subscribe(method, first, req, url, res)
    if (second === 'live_media' && method === 'GET') return this.#liveMedia(first, req, url, res)
    if (second === 'messages' && method === 'POST') return this.#send(first, req, url, res)
    if (second === 'conversations' && method === 'GET') return this.#conversation(first, req, url, res)
    return this.#json(res, 404, graphError(404, 803).body)
  }

  #record(op: FakeOp): void {
    this.calls.push({ op, at: this.#now() })
  }

  #dialog(login: InstagramLogin, url: URL, res: ServerResponse): void {
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    const state = url.searchParams.get('state') ?? ''
    if (url.searchParams.get('client_id') !== this.appId || redirectUri === '') return this.#json(res, 400, graphError(400, 100).body)
    const target = new URL(redirectUri)
    if (this.#scenario.decision === 'deny') {
      target.searchParams.set('error', 'access_denied')
      target.searchParams.set('error_reason', 'user_denied')
      target.searchParams.set('error_description', 'Permissions error')
    } else {
      const code = randomBytes(24).toString('base64url')
      const scopes = (url.searchParams.get('scope') ?? '').split(',').filter((scope) => scope !== '')
      this.#codes.set(code, { login, redirectUri, scenario: this.#scenario, scopes, used: false })
      target.searchParams.set('code', code)
    }
    target.searchParams.set('state', state)
    res.writeHead(302, { Location: target.toString() })
    res.end()
  }

  #takeCode(code: string | null, login: InstagramLogin, redirectUri: string | null): CodeInfo | null {
    const info = code === null ? undefined : this.#codes.get(code)
    if (info === undefined || info.used || info.login !== login || info.redirectUri !== redirectUri) return null
    info.used = true
    return info
  }

  #granted(info: { readonly scenario: FakeLoginScenario; readonly scopes: readonly string[]; readonly login: InstagramLogin }): string[] {
    const requested = info.scopes.length > 0 ? info.scopes : PERMISSION_DEFAULTS[info.login]
    return requested.filter((scope) => !info.scenario.declined.includes(scope))
  }

  async #fbToken(url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> {
    this.#record('token')
    if ((await this.#fault('token', res, req)) === 'done') return
    if (url.searchParams.get('client_id') !== this.appId || url.searchParams.get('client_secret') !== this.appSecret) return this.#json(res, 400, graphError(400, 101).body)
    if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
      const short = this.#tokens.get(url.searchParams.get('fb_exchange_token') ?? '')
      if (short === undefined || !short.valid || short.kind !== 'fb-short') return this.#json(res, 400, graphError(400, 190).body)
      return this.#json(res, 200, { access_token: this.#issue({ ...short, kind: 'fb-user' }), token_type: 'bearer', expires_in: 5_183_944 })
    }
    const code = this.#takeCode(url.searchParams.get('code'), 'FACEBOOK', url.searchParams.get('redirect_uri'))
    if (code === null) return this.#json(res, 400, graphError(400, 100, 36_009).body)
    const token = this.#issue({ kind: 'fb-short', accounts: code.scenario.accounts, scenario: code.scenario, scopes: code.scopes, login: 'FACEBOOK' })
    this.#json(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3600 })
  }

  async #igCode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.#record('token')
    const form = new URLSearchParams(await this.#body(req))
    if ((await this.#fault('token', res, req)) === 'done') return
    if (form.get('client_id') !== this.appId || form.get('client_secret') !== this.appSecret || form.get('grant_type') !== 'authorization_code') return this.#json(res, 400, graphError(400, 101).body)
    const code = this.#takeCode(form.get('code'), 'INSTAGRAM', form.get('redirect_uri'))
    if (code === null) return this.#json(res, 400, graphError(400, 100, 36_009).body)
    const accounts = code.scenario.accounts.slice(0, 1)
    const token = this.#issue({ kind: 'ig-short', accounts, scenario: code.scenario, scopes: code.scopes, login: 'INSTAGRAM' })
    this.#json(res, 200, { data: [{ access_token: token, user_id: accounts[0] ?? '', permissions: this.#granted({ scenario: code.scenario, scopes: code.scopes, login: 'INSTAGRAM' }).join(',') }] })
  }

  async #igLong(url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> {
    this.#record('token')
    if ((await this.#fault('token', res, req)) === 'done') return
    const short = this.#tokens.get(url.searchParams.get('access_token') ?? '')
    if (url.searchParams.get('client_secret') !== this.appSecret || short === undefined || !short.valid || short.kind !== 'ig-short') return this.#json(res, 400, graphError(400, 190).body)
    this.#json(res, 200, { access_token: this.#issue({ ...short, kind: 'ig' }), token_type: 'bearer', expires_in: 5_184_000 })
  }

  async #igRefresh(url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> {
    this.#record('refresh')
    if ((await this.#fault('refresh', res, req)) === 'done') return
    const current = this.#tokens.get(url.searchParams.get('access_token') ?? '')
    if (current === undefined || !current.valid || current.kind !== 'ig') return this.#json(res, 400, graphError(400, 190).body)
    this.#json(res, 200, { access_token: this.#issue({ ...current, kind: 'ig' }), token_type: 'bearer', expires_in: 5_184_000 })
  }

  async #permissions(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('permissions')
    if ((await this.#fault('permissions', res, req)) === 'done') return
    const token = this.#token(req, url)
    if (token === null) return this.#json(res, 400, graphError(400, 190).body)
    const requested = token.scopes.length > 0 ? token.scopes : PERMISSION_DEFAULTS[token.login]
    this.#json(res, 200, { data: requested.map((permission) => ({ permission, status: token.scenario.declined.includes(permission) ? 'declined' : 'granted' })) })
  }

  async #revoke(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('revoke')
    if ((await this.#fault('revoke', res, req)) === 'done') return
    const token = this.#token(req, url)
    if (token === null) return this.#json(res, 400, graphError(400, 190).body)
    this.revocations.push(...token.accounts)
    this.#json(res, 200, { success: true })
  }

  async #pages(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('accounts')
    if ((await this.#fault('accounts', res, req)) === 'done') return
    const token = this.#token(req, url)
    if (token === null || token.kind !== 'fb-user') return this.#json(res, 400, graphError(400, 190).body)
    const data = token.accounts.flatMap((id) => {
      const account = this.accounts.get(id)
      if (account === undefined) return []
      const pageToken = this.#issue({ kind: 'page', accounts: [account.id], scenario: token.scenario, scopes: token.scopes, login: 'FACEBOOK' })
      return [
        {
          id: account.pageId,
          name: `${account.username} 페이지`,
          access_token: pageToken,
          ...(account.type === 'PERSONAL' ? {} : { instagram_business_account: { id: account.id, username: account.username, account_type: account.type } }),
        },
      ]
    })
    this.#json(res, 200, { data })
  }

  async #me(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('me')
    if ((await this.#fault('me', res, req)) === 'done') return
    const token = this.#token(req, url)
    const account = token === null ? undefined : this.accounts.get(token.accounts[0] ?? '')
    if (token === null || account === undefined) return this.#json(res, 400, graphError(400, 190).body)
    this.#json(res, 200, { id: account.id, user_id: account.id, username: account.username, account_type: account.type })
  }

  /** 토큰이 그 노드(페이지 또는 계정)를 다룰 수 있으면 그 계정 */
  #accountFor(token: TokenInfo | null, node: string): FakeAccount | null {
    if (token === null || (token.kind !== 'page' && token.kind !== 'ig')) return null
    for (const id of token.accounts) {
      const account = this.accounts.get(id)
      if (account !== undefined && (account.id === node || (token.kind === 'page' && account.pageId === node))) return account
    }
    return null
  }

  async #subscribe(method: string, node: string, req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    const op: FakeOp = method === 'DELETE' ? 'unsubscribe' : 'subscribe'
    this.#record(op)
    if ((await this.#fault(op, res, req)) === 'done') return
    const token = this.#token(req, url)
    if (token === null) return this.#json(res, 400, graphError(400, 190).body)
    if (this.#accountFor(token, node) === null) return this.#json(res, 403, graphError(403, 10).body)
    if (op === 'subscribe') this.subscriptions.push({ node, fields: url.searchParams.get('subscribed_fields') ?? '' })
    else this.unsubscriptions.push(node)
    this.#json(res, 200, { success: true })
  }

  async #liveMedia(node: string, req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('liveMedia')
    if ((await this.#fault('liveMedia', res, req)) === 'done') return
    const token = this.#token(req, url)
    if (token === null) return this.#json(res, 400, graphError(400, 190).body)
    const account = this.#accountFor(token, node)
    if (account === null || account.id !== node) return this.#json(res, 403, graphError(403, 10).body)
    const data = [...this.#lives.values()].filter((live) => live.accountId === account.id && !live.ended).map((live) => ({ id: live.id, timestamp: new Date(live.startedAt).toISOString() }))
    this.#json(res, 200, { data })
  }

  async #send(node: string, req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('send')
    const raw = await this.#body(req)
    const mode = await this.#fault('send', res, req)
    if (mode === 'done') return
    const token = this.#token(req, url)
    if (token === null) return this.#reply(res, mode, 400, graphError(400, 190).body)
    const account = this.#accountFor(token, node)
    if (account === null) return this.#reply(res, mode, 403, graphError(403, 10).body)
    let parsed: { recipient?: { comment_id?: unknown }; message?: { text?: unknown } }
    try {
      parsed = JSON.parse(raw) as typeof parsed
    } catch {
      return this.#reply(res, mode, 400, graphError(400, 100).body)
    }
    const commentId = parsed.recipient?.comment_id
    const text = parsed.message?.text
    const comment = typeof commentId === 'string' ? this.#comments.get(commentId) : undefined
    if (comment === undefined || comment.accountId !== account.id || typeof text !== 'string') return this.#reply(res, mode, 400, graphError(400, 100).body)
    if (this.#lives.get(comment.liveId)?.ended !== false) return this.#reply(res, mode, 400, FAULTS.LIVE_ENDED.body)
    if (this.#replied.has(comment.id)) return this.#reply(res, mode, 400, FAULTS.ONE_REPLY.body)
    this.#replied.add(comment.id)
    const dm: FakeDm = { messageId: `m_${randomBytes(12).toString('base64url')}`, accountId: account.id, commentId: comment.id, igsid: comment.igsid, text, at: this.#now() }
    this.dms.push(dm)
    this.#reply(res, mode, 200, { recipient_id: comment.igsid, message_id: dm.messageId })
  }

  async #conversation(node: string, req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    this.#record('conversation')
    if ((await this.#fault('conversation', res, req)) === 'done') return
    const token = this.#token(req, url)
    if (token === null) return this.#json(res, 400, graphError(400, 190).body)
    const account = this.#accountFor(token, node)
    if (account === null) return this.#json(res, 403, graphError(403, 10).body)
    const igsid = url.searchParams.get('user_id') ?? ''
    const messages = this.dms
      .filter((dm) => dm.accountId === account.id && dm.igsid === igsid)
      .map((dm) => ({ id: dm.messageId, message: dm.text, from: { id: account.id, username: account.username }, created_time: new Date(dm.at).toISOString() }))
    this.#json(res, 200, { data: messages.length === 0 ? [] : [{ id: `t_${igsid}`, messages: { data: messages } }] })
  }

  // ── 조작 주소 (E2E·화면 시험) ───────────────────────────────────────────

  async #control(method: string, path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = method === 'POST' ? await this.#body(req) : ''
    let input: Record<string, unknown>
    try {
      input = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>)
    } catch {
      return this.#json(res, 400, { error: 'JSON이 아니다' })
    }
    if (method === 'GET' && path === '/_fake/state') {
      return this.#json(res, 200, { accounts: [...this.accounts.values()], dms: this.dms, subscriptions: this.subscriptions, unsubscriptions: this.unsubscriptions, revocations: this.revocations, calls: this.calls })
    }
    if (method === 'POST' && path === '/_fake/accounts') {
      return this.#json(res, 200, { account: this.addAccount(input as { username: string; id?: string; type?: FakeAccountType; pageId?: string }) })
    }
    if (method === 'POST' && path === '/_fake/login') {
      this.setLogin(input as Partial<FakeLoginScenario>)
      return this.#json(res, 200, { ok: true })
    }
    if (method === 'POST' && path === '/_fake/live') return this.#json(res, 200, { liveId: this.startLive(String(input.accountId ?? '')) })
    const ended = /^\/_fake\/live\/([^/]+)\/end$/.exec(path)
    if (method === 'POST' && ended !== null) {
      this.endLive(decodeURIComponent(ended[1] ?? ''))
      return this.#json(res, 200, { ok: true })
    }
    if (method === 'POST' && path === '/_fake/fault') {
      this.fail(input.op as FakeOp, input.fault as FakeFault, typeof input.times === 'number' ? input.times : 1)
      return this.#json(res, 200, { ok: true })
    }
    if (method === 'POST' && path === '/_fake/invalidate') {
      this.invalidateTokens(typeof input.accountId === 'string' ? input.accountId : undefined)
      return this.#json(res, 200, { ok: true })
    }
    if (method === 'POST' && path === '/_fake/comments') {
      if (this.webhookUrl === null) return this.#json(res, 409, { error: '웹훅 주소가 없다' })
      const accountId = String(input.accountId ?? '')
      const liveId = String(input.liveId ?? '')
      const list = Array.isArray(input.comments) ? (input.comments as { igsid: string; username: string; text: string; id?: string }[]) : []
      const changes = list.map((item) => this.comment({ accountId, liveId, ...item }))
      const body = this.payload([{ accountId, ...(typeof input.time === 'number' ? { time: input.time } : {}), changes }])
      const response = await this.deliver(this.httpTarget(this.webhookUrl), body)
      return this.#json(res, 200, { status: response.status, ids: changes.map((change) => (change.value as { id: string }).id) })
    }
    this.#json(res, 404, { error: '모르는 조작' })
  }
}
