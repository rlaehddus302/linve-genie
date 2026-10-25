// 가짜 밴드 서버 (D-BND1-13, AC-BND1-62·80) — 서버 시험과 E2E 서버 기동만 쓴다(운영 기동은 쓰지 않는다).
// 실제 통신 방식(HTTP, 127.0.0.1의 빈 포트)으로 공식 문서(developers.band.us, 2026-10-26)의 응답 모양대로 답한다. 실제 클라이언트(client.ts)가 주소만 바꿔 붙는다.
// - 승인 창(허락·거부·권한 빼기·user_key 빼기)은 바로 돌아오는 주소로 보낸다. 토큰·내 정보·밴드 목록·글 목록·글 상세·댓글 목록.
// - 시험 조종(메서드 — E2E는 e2e.ts의 /_e2e/band/*가 부른다): 사용자·밴드·글·댓글 더하기, 댓글 지우기·고치기, 오류 코드·HTTP 오류·응답 없음·지연 넣기,
//   쪽 크기, 다음 쪽 값 바꾸기, 토큰 풀기. 받은 요청(방식·경로·토큰)을 모두 남긴다 — 시험이 GET 일곱 개뿐인지 맞댄다.
// - 이 서버도 GET만 받는다(그 밖은 405).
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { bandSettings, type BandSettings } from './config.ts'
import { BAND_REQUESTS, type BandOp } from './endpoints.ts'

export interface FakeBandUser {
  readonly userKey: string
  name: string
}

export interface FakeBandComment {
  readonly commentKey: string | null
  name: string | null
  /** null이면 author에 user_key 칸이 없다 */
  userKey: string | null
  content: unknown
  createdAt: unknown
  /** 그 밖에 덧붙일 칸 (모양 틀린 항목 시험) */
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface FakeBandPost {
  readonly postKey: string
  readonly bandKey: string
  /** null이면 author에 user_key 칸이 없다 */
  readonly authorUserKey: string | null
  readonly authorName: string
  content: string
  readonly createdAt: number
  readonly comments: FakeBandComment[]
}

export interface FakeBandBand {
  readonly bandKey: string
  readonly name: string
  readonly memberCount: number
  readonly members: Set<string>
}

/** 다음 승인 창에서 할 일 */
export interface FakeBandLogin {
  readonly decision: 'approve' | 'deny'
  readonly userKey?: string
  /** 토큰 응답의 scope (null이면 칸 없음, 기본 세 권한) */
  readonly scope?: string | null
  /** 토큰 응답에서 user_key 칸을 뺀다 */
  readonly omitUserKey?: boolean
  /** 토큰 응답의 expires_in (기본 315359999 — 공식 예시) */
  readonly expiresIn?: number | null
}

/** 넣을 오류 (그 요청 이름에 차례로 한 번씩) */
export type FakeBandFault =
  | { readonly resultCode: number }
  | { readonly http: number }
  | { readonly delayMs: number }
  | 'HANG'
  | 'NOT_JSON'
  | 'BAD_SHAPE'
  | { readonly tokenError: string }

export interface FakeBandRequest {
  readonly method: string
  readonly path: string
  readonly op: BandOp | null
  /** 질의의 access_token (토큰 요청이면 null) */
  readonly token: string | null
  readonly query: Readonly<Record<string, string>>
}

interface TokenInfo {
  readonly userKey: string
  valid: boolean
}

interface CodeInfo {
  readonly login: FakeBandLogin
  readonly userKey: string
  used: boolean
}

export const FAKE_BAND_DEFAULT_SCOPE = 'READ_BAND_AND_USERS_LIST READ_POST READ_COMMENT READ_MY_PROFILE'

export interface FakeBandOptions {
  readonly clientId?: string
  readonly clientSecret?: string
  /** 127.0.0.1의 이 포트 (기본 0 = 빈 포트) */
  readonly port?: number
  /** 쪽 크기 (기본 20) */
  readonly pageSize?: number
  /** 가짜 서버 시계 (글·댓글 작성 시각 기본값) */
  readonly now?: () => number
}

type Obj = Record<string, unknown>

const OPS_BY_PATH: ReadonlyMap<string, BandOp> = new Map(Object.entries(BAND_REQUESTS).map(([op, entry]) => [entry.path, op as BandOp]))

export class FakeBand {
  readonly clientId: string
  readonly clientSecret: string
  readonly #server: Server
  readonly #now: () => number
  #port = 0
  pageSize: number
  readonly users = new Map<string, FakeBandUser>()
  readonly bands = new Map<string, FakeBandBand>()
  readonly posts = new Map<string, FakeBandPost>()
  readonly #tokens = new Map<string, TokenInfo>()
  readonly #codes = new Map<string, CodeInfo>()
  readonly #faults = new Map<BandOp, FakeBandFault[]>()
  readonly #delays = new Map<BandOp, number>()
  readonly #hanging = new Set<ServerResponse>()
  #login: FakeBandLogin = { decision: 'approve' }
  #seq = 0
  /** 받은 요청 (차례대로) */
  readonly requests: FakeBandRequest[] = []
  /** 지금 처리 중인 요청 수 · 가장 많았던 수 (토큰별) */
  readonly #inflight = new Map<string, number>()
  readonly maxInflight = new Map<string, number>()
  /** 다음 쪽 값 바꾸기 (시험: 다른 토큰·다른 글·고리) */
  pagingOverride: ((op: BandOp, next: Obj | null) => unknown) | null = null
  /** 기본 사용자 (승인 창이 userKey를 정하지 않았을 때) */
  defaultUser: string | null = null

  private constructor(options: FakeBandOptions) {
    this.clientId = options.clientId ?? 'fake-band-client'
    this.clientSecret = options.clientSecret ?? 'fake-band-secret'
    this.pageSize = options.pageSize ?? 20
    this.#now = options.now ?? (() => Date.now())
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.end()
        }
      })
    })
  }

  static async start(options: FakeBandOptions = {}): Promise<FakeBand> {
    const fake = new FakeBand(options)
    await new Promise<void>((resolve, reject) => {
      fake.#server.once('error', reject)
      fake.#server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
    })
    const address = fake.#server.address()
    fake.#port = typeof address === 'object' && address !== null ? address.port : 0
    return fake
  }

  get origin(): string {
    return `http://127.0.0.1:${String(this.#port)}`
  }

  /** 이 가짜 서버를 부르는 설정 */
  settings(input: { readonly redirectUri: string; readonly timeoutMs?: number }): BandSettings {
    return bandSettings({ clientId: this.clientId, clientSecret: this.clientSecret, redirectUri: input.redirectUri, authUrl: this.origin, apiUrl: this.origin, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) })
  }

  async close(): Promise<void> {
    for (const res of this.#hanging) res.destroy()
    this.#hanging.clear()
    this.#server.closeAllConnections?.()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
  }

  #next(prefix: string): string {
    this.#seq += 1
    return `${prefix}${String(this.#seq).padStart(6, '0')}${randomBytes(4).toString('hex')}`
  }

  // ── 조종 ───────────────────────────────────────────────────────────────

  addUser(name: string, userKey?: string): string {
    const key = userKey ?? this.#next('U')
    this.users.set(key, { userKey: key, name })
    if (this.defaultUser === null) this.defaultUser = key
    return key
  }

  addBand(input: { readonly name: string; readonly members: readonly string[]; readonly bandKey?: string; readonly memberCount?: number }): string {
    const bandKey = input.bandKey ?? this.#next('B')
    this.bands.set(bandKey, { bandKey, name: input.name, memberCount: input.memberCount ?? input.members.length, members: new Set(input.members) })
    return bandKey
  }

  addPost(input: { readonly bandKey: string; readonly authorUserKey: string | null; readonly authorName?: string; readonly content?: string; readonly createdAt?: number; readonly postKey?: string }): string {
    const postKey = input.postKey ?? this.#next('P')
    this.posts.set(postKey, {
      postKey,
      bandKey: input.bandKey,
      authorUserKey: input.authorUserKey,
      authorName: input.authorName ?? (input.authorUserKey === null ? '이름' : (this.users.get(input.authorUserKey)?.name ?? '이름')),
      content: input.content ?? '오늘 공구 글이에요',
      createdAt: input.createdAt ?? this.#now(),
      comments: [],
    })
    return postKey
  }

  /** 댓글 하나 (userKey null이면 user_key 칸 없음, commentKey null이면 comment_key 칸 없음) */
  addComment(
    postKey: string,
    input: { readonly content: unknown; readonly name?: string | null; readonly userKey?: string | null; readonly createdAt?: unknown; readonly commentKey?: string | null; readonly extra?: Readonly<Record<string, unknown>> },
  ): string | null {
    const post = this.#post(postKey)
    const commentKey = input.commentKey === undefined ? this.#next('C') : input.commentKey
    const userKey = input.userKey === undefined ? null : input.userKey
    post.comments.push({
      commentKey,
      name: input.name === undefined ? (userKey === null ? '손님' : (this.users.get(userKey)?.name ?? '손님')) : input.name,
      userKey,
      content: input.content,
      createdAt: input.createdAt === undefined ? this.#now() : input.createdAt,
      ...(input.extra === undefined ? {} : { extra: input.extra }),
    })
    return commentKey
  }

  /** 밴드에서 지운 댓글 (목록에서 빠진다) */
  dropComment(postKey: string, commentKey: string): boolean {
    const post = this.#post(postKey)
    const index = post.comments.findIndex((comment) => comment.commentKey === commentKey)
    if (index < 0) return false
    post.comments.splice(index, 1)
    return true
  }

  editComment(postKey: string, commentKey: string, content: string): boolean {
    const comment = this.#post(postKey).comments.find((item) => item.commentKey === commentKey)
    if (comment === undefined) return false
    comment.content = content
    return true
  }

  #post(postKey: string): FakeBandPost {
    const post = this.posts.get(postKey)
    if (post === undefined) throw new Error('가짜 밴드: 없는 글')
    return post
  }

  /** 다음 승인 창 */
  nextLogin(login: FakeBandLogin): void {
    this.#login = login
  }

  /** 그 사용자의 토큰을 모두 푼다 (밴드 앱에서 연결을 끊음 — 다음 요청은 10401) */
  revoke(userKey: string): void {
    for (const info of this.#tokens.values()) if (info.userKey === userKey) info.valid = false
  }

  /** 시험이 승인 창 없이 토큰을 바로 만든다 */
  issueToken(userKey: string): string {
    const token = this.#next('T')
    this.#tokens.set(token, { userKey, valid: true })
    return token
  }

  /** 그 요청 이름의 다음 times번을 fault로 */
  fail(op: BandOp, fault: FakeBandFault, times = 1): void {
    const list = this.#faults.get(op) ?? []
    for (let i = 0; i < times; i += 1) list.push(fault)
    this.#faults.set(op, list)
  }

  clearFaults(): void {
    this.#faults.clear()
  }

  /** 그 요청 이름의 모든 응답을 ms만큼 늦춘다 (0이면 늦추지 않음) */
  delay(op: BandOp, ms: number): void {
    if (ms <= 0) this.#delays.delete(op)
    else this.#delays.set(op, ms)
  }

  /** 응답하지 않고 붙잡아 둔 요청을 놓는다 (연결 끊기) */
  releaseHanging(): void {
    for (const res of this.#hanging) res.destroy()
    this.#hanging.clear()
  }

  /** 받은 요청 중 그 이름 (토큰을 주면 그 토큰의 것만) */
  calls(op: BandOp, token?: string): FakeBandRequest[] {
    return this.requests.filter((request) => request.op === op && (token === undefined || request.token === token))
  }

  /** 그 사용자의 토큰으로 온 요청 */
  callsOfUser(userKey: string): FakeBandRequest[] {
    return this.requests.filter((request) => request.token !== null && this.#tokens.get(request.token)?.userKey === userKey)
  }

  // ── 응답 ───────────────────────────────────────────────────────────────

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin)
    const query: Record<string, string> = {}
    for (const [key, value] of url.searchParams) query[key] = value
    const op = OPS_BY_PATH.get(url.pathname) ?? null
    const token = op === 'token' || op === 'authorize' ? null : (query['access_token'] ?? null)
    this.requests.push({ method: req.method ?? '', path: url.pathname, op, token, query })
    if (req.method !== 'GET') return this.#json(res, 405, { error: 'method' })
    if (op === null) return this.#json(res, 404, { error: 'path' })
    const counter = token ?? `#${op}`
    this.#inflight.set(counter, (this.#inflight.get(counter) ?? 0) + 1)
    this.maxInflight.set(counter, Math.max(this.maxInflight.get(counter) ?? 0, this.#inflight.get(counter) ?? 0))
    res.on('close', () => this.#inflight.set(counter, Math.max(0, (this.#inflight.get(counter) ?? 1) - 1)))
    const wait = this.#delays.get(op) ?? 0
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    const fault = this.#faults.get(op)?.shift()
    if (fault !== undefined) {
      if (fault === 'HANG') {
        this.#hanging.add(res)
        return
      }
      if (fault === 'NOT_JSON') return this.#raw(res, 200, 'text/html', '<html>점검 중</html>')
      if (fault === 'BAD_SHAPE') return this.#json(res, 200, { result_code: 1, result_data: [] })
      if ('delayMs' in fault) await new Promise((resolve) => setTimeout(resolve, fault.delayMs))
      else if ('resultCode' in fault) return this.#json(res, 200, { result_code: fault.resultCode, result_data: { message: '가짜 오류 PLANTED-BAND-MESSAGE' } })
      else if ('http' in fault) return this.#json(res, fault.http, { result_code: 0, result_data: { message: '가짜 HTTP 오류' } })
      else if ('tokenError' in fault) return this.#json(res, 401, { error: fault.tokenError, error_description: '가짜' })
    }
    switch (op) {
      case 'authorize':
        return this.#authorize(res, query)
      case 'token':
        return this.#token(req, res, query)
      default:
        return this.#api(res, op, token, query)
    }
  }

  #json(res: ServerResponse, status: number, body: unknown): void {
    this.#raw(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
  }

  #raw(res: ServerResponse, status: number, type: string, text: string): void {
    res.statusCode = status
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
  }

  #authorize(res: ServerResponse, query: Readonly<Record<string, string>>): void {
    const redirect = query['redirect_uri']
    if (query['response_type'] !== 'code' || query['client_id'] !== this.clientId || redirect === undefined || !/^https?:\/\//.test(redirect)) return this.#raw(res, 400, 'text/plain; charset=utf-8', '잘못된 요청')
    const login = this.#login
    const target = new URL(redirect)
    if (login.decision === 'deny') {
      target.searchParams.set('error', 'access_denied')
    } else {
      const userKey = login.userKey ?? this.defaultUser
      if (userKey === null) return this.#raw(res, 400, 'text/plain; charset=utf-8', '사용자 없음')
      const code = this.#next('CODE')
      this.#codes.set(code, { login, userKey, used: false })
      target.searchParams.set('code', code)
    }
    res.statusCode = 302
    res.setHeader('Location', target.toString())
    res.end()
  }

  #token(req: IncomingMessage, res: ServerResponse, query: Readonly<Record<string, string>>): void {
    const expected = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`, 'utf8').toString('base64')}`
    if (req.headers.authorization !== expected) return this.#json(res, 401, { error: 'invalid_client' })
    const info = query['grant_type'] === 'authorization_code' ? this.#codes.get(query['code'] ?? '') : undefined
    if (info === undefined || info.used) return this.#json(res, 400, { error: 'invalid_grant' })
    info.used = true
    const token = this.issueToken(info.userKey)
    const body: Obj = { access_token: token, token_type: 'bearer', refresh_token: `R${token}` }
    if (info.login.expiresIn !== null) body['expires_in'] = info.login.expiresIn ?? 315_359_999
    if (info.login.scope !== null) body['scope'] = info.login.scope ?? FAKE_BAND_DEFAULT_SCOPE
    if (info.login.omitUserKey !== true) body['user_key'] = info.userKey
    this.#json(res, 200, body)
  }

  #api(res: ServerResponse, op: BandOp, token: string | null, query: Readonly<Record<string, string>>): void {
    const info = token === null ? undefined : this.#tokens.get(token)
    if (info === undefined || !info.valid) return this.#json(res, 200, { result_code: 10401, result_data: { message: 'invalid access token' } })
    const user = this.users.get(info.userKey)
    const ok = (data: Obj) => this.#json(res, 200, { result_code: 1, result_data: data })
    const noAccess = () => this.#json(res, 200, { result_code: 60102, result_data: { message: 'no access' } })
    if (op === 'profile') return ok({ user_key: info.userKey, profile_image_url: 'http://img.band.us/p.jpg', name: user?.name ?? '이름', is_app_member: true, message_allowed: true })
    if (op === 'bands') {
      const bands = [...this.bands.values()].filter((band) => band.members.has(info.userKey))
      return ok({ bands: bands.map((band) => ({ name: band.name, band_key: band.bandKey, cover: 'http://img.band.us/cover.jpg', member_count: band.memberCount })) })
    }
    const band = this.bands.get(query['band_key'] ?? '')
    if (band === undefined || !band.members.has(info.userKey)) return noAccess()
    if (op === 'posts') {
      const posts = [...this.posts.values()].filter((post) => post.bandKey === band.bandKey).sort((a, b) => b.createdAt - a.createdAt)
      const { page, next } = this.#page(posts, query)
      return ok({ paging: { previous_params: null, next_params: this.#paging(op, next, token as string, band.bandKey, null, query) }, items: page.map((post) => this.#postItem(post)) })
    }
    const post = this.posts.get(query['post_key'] ?? '')
    if (post === undefined || post.bandKey !== band.bandKey) return noAccess()
    if (op === 'post') return ok({ post: this.#postItem(post) })
    // 댓글 목록: sort=+created_at 오래된 순, 그 밖(기본 -created_at) 최신순 — 같은 시각이면 단 차례(최신순은 그 뒤집기)
    const oldest = query['sort'] === '+created_at'
    const ordered = oldest ? [...post.comments] : [...post.comments].reverse()
    const { page, next } = this.#page(ordered, query)
    return ok({ paging: { previous_params: null, next_params: this.#paging(op, next, token as string, band.bandKey, post.postKey, query) }, items: page.map((comment) => this.#commentItem(post, comment)) })
  }

  #page<T>(list: readonly T[], query: Readonly<Record<string, string>>): { page: T[]; next: number | null } {
    const start = /^\d{1,9}$/.test(query['after'] ?? '') ? Number(query['after']) : 0
    const limitRaw = Number(query['limit'])
    const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : this.pageSize
    const page = list.slice(start, start + limit)
    return { page, next: start + limit < list.length ? start + limit : null }
  }

  #paging(op: BandOp, next: number | null, token: string, bandKey: string, postKey: string | null, query: Readonly<Record<string, string>>): unknown {
    // 공식 예시처럼 다음 쪽 값에 토큰·밴드 키·글 키가 함께 온다 (서버는 그 셋을 쓰지 않는다)
    const params: Obj | null =
      next === null
        ? null
        : {
            after: String(next),
            limit: String(this.pageSize),
            access_token: token,
            band_key: bandKey,
            ...(postKey === null ? { locale: query['locale'] ?? 'ko_KR' } : { post_key: postKey }),
          }
    return this.pagingOverride === null ? params : this.pagingOverride(op, params)
  }

  #postItem(post: FakeBandPost): Obj {
    return {
      content: post.content,
      author: { name: post.authorName, description: '', role: 'member', profile_image_url: 'http://img.band.us/p.jpg', ...(post.authorUserKey === null ? {} : { user_key: post.authorUserKey }) },
      post_key: post.postKey,
      comment_count: post.comments.length,
      created_at: post.createdAt,
      photos: [],
      emotion_count: 0,
      latest_comments: [],
      band_key: post.bandKey,
    }
  }

  #commentItem(post: FakeBandPost, comment: FakeBandComment): Obj {
    return {
      band_key: post.bandKey,
      post_key: post.postKey,
      ...(comment.commentKey === null ? {} : { comment_key: comment.commentKey }),
      content: comment.content,
      emotion_count: 0,
      is_audio_comment: false,
      created_at: comment.createdAt,
      author: { name: comment.name, description: '', role: 'member', profile_image_url: 'http://img.band.us/p.jpg', ...(comment.userKey === null ? {} : { user_key: comment.userKey }) },
      photo: null,
      ...(comment.extra ?? {}),
    }
  }
}
