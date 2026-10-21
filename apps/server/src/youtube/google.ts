// 구글 OAuth·유튜브 Data API 어댑터 (AC-Y1-01·02·04·20·50·72, D-Y02·D-Y09·D-Y13).
// - 주소는 설정에서 온다(운영은 https만 — 아니면 서버가 시작하지 않는다). 시험은 가짜 서버(127.0.0.1) 주소를 넣는다.
// - 요청-응답 호출에는 모두 시간 제한이 있다(게시 10초, 그 밖 15초). 스트림은 시간 제한으로 끊지 않는다 — 끊김은 연결 오류로 안다.
// - Data API 호출은 보내기 전에 할당량 계량기에 센다(실패·타임아웃이어도 센다). OAuth(토큰·새로 고침·폐기)는 세지 않는다.
// - 오류는 종류(network·timeout·http)·HTTP 상태·구글 오류 이유(quotaExceeded 같은 코드)만 꺼낸다. 응답 본문·토큰은 오류에 담지 않는다.
import type { Timer } from './timer.ts'

export const READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'
export const PUBLISH_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'

/** 게시 요청 시간 제한 (AC-Y1-36) */
export const POST_TIMEOUT_MS = 10_000
/** 그 밖 요청-응답 시간 제한 (AC-Y1-72) */
export const REQUEST_TIMEOUT_MS = 15_000

/** 할당량을 세는 Data API 호출 종류 (AC-Y1-50) */
export type ApiMethod =
  | 'channels.list'
  | 'liveBroadcasts.list'
  | 'videos.list'
  | 'commentThreads.list'
  | 'liveChatMessages.list'
  | 'liveChatMessages.streamList'
  | 'liveChatMessages.insert'
  | 'commentThreads.insert'

/** 비용 표 기본값 (구글 문서 2026-10-20 확인, D-Y09) */
export const DEFAULT_COSTS: Readonly<Record<ApiMethod, number>> = {
  'channels.list': 1,
  'liveBroadcasts.list': 1,
  'videos.list': 1,
  'commentThreads.list': 1,
  'liveChatMessages.list': 5,
  'liveChatMessages.streamList': 5,
  'liveChatMessages.insert': 20,
  'commentThreads.insert': 50,
}

export interface GoogleEndpoints {
  /** 승인 화면 (예: https://accounts.google.com/o/oauth2/v2/auth) */
  readonly authUrl: string
  /** 토큰 (예: https://oauth2.googleapis.com/token) */
  readonly tokenUrl: string
  /** 토큰 폐기 (예: https://oauth2.googleapis.com/revoke) */
  readonly revokeUrl: string
  /** Data API 바탕 주소 (예: https://www.googleapis.com/youtube/v3) */
  readonly apiBase: string
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com/youtube/v3',
}

/** 구글 호출 오류. 값(본문·토큰)은 담지 않는다 */
export class GoogleError extends Error {
  readonly kind: 'network' | 'timeout' | 'http'
  readonly status: number | null
  /** 구글 오류 이유 (예: quotaExceeded·liveChatEnded·invalid_grant). 형식이 다르면 null */
  readonly reason: string | null

  constructor(kind: 'network' | 'timeout' | 'http', status: number | null, reason: string | null) {
    super(`google ${kind}${status === null ? '' : ` ${String(status)}`}${reason === null ? '' : ` ${reason}`}`)
    this.name = 'GoogleError'
    this.kind = kind
    this.status = status
    this.reason = reason
  }
}

const REASON_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** 오류 응답 본문에서 이유 코드만 꺼낸다 (Data API: error.errors[0].reason, OAuth: error) */
function reasonOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const error = (body as Record<string, unknown>).error
  if (typeof error === 'string') return REASON_RE.test(error) ? error : null
  if (typeof error !== 'object' || error === null) return null
  const errors = (error as Record<string, unknown>).errors
  const first = Array.isArray(errors) ? (errors[0] as Record<string, unknown> | undefined) : undefined
  const reason = first?.reason ?? (error as Record<string, unknown>).status
  return typeof reason === 'string' && REASON_RE.test(reason) ? reason : null
}

export interface TokenSet {
  readonly accessToken: string
  readonly refreshToken: string | null
  /** 접근 토큰 유효 시간 (초) */
  readonly expiresIn: number
  /** 받은 권한 (띄어쓰기로 나눈 것) */
  readonly scopes: readonly string[]
}

export interface GoogleClientOptions extends GoogleEndpoints {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly timer: Timer
  /** Data API 호출을 보내기 직전에 센다 (판매자, 호출 종류) */
  readonly meter: (sellerId: string, method: ApiMethod) => Promise<void>
  /** HTTP (기본 전역 fetch — 시험은 막는 장치가 걸린 fetch를 쓴다) */
  readonly fetch?: typeof fetch
}

export interface ApiCall {
  readonly sellerId: string
  readonly method: ApiMethod
  readonly accessToken: string
  readonly httpMethod?: 'GET' | 'POST'
  readonly path: string
  readonly query?: Readonly<Record<string, string | undefined>>
  readonly body?: unknown
  readonly timeoutMs?: number
  /** 끊으면 그 요청을 멈춘다 (서버가 멈출 때) */
  readonly signal?: AbortSignal
}

export class GoogleClient {
  readonly #options: GoogleClientOptions

  constructor(options: GoogleClientOptions) {
    this.#options = options
  }

  get options(): GoogleClientOptions {
    return this.#options
  }

  /** 승인 주소 (AC-Y1-01·31): 클라이언트 ID·돌아오는 주소·code·권한·offline·PKCE S256·state */
  authorizeUrl(input: { scopes: readonly string[]; state: string; challenge: string; incremental: boolean }): string {
    const url = new URL(this.#options.authUrl)
    url.searchParams.set('client_id', this.#options.clientId)
    url.searchParams.set('redirect_uri', this.#options.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', input.scopes.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('code_challenge', input.challenge)
    url.searchParams.set('state', input.state)
    url.searchParams.set('prompt', 'consent')
    if (input.incremental) url.searchParams.set('include_granted_scopes', 'true')
    return url.toString()
  }

  /** 시간 제한이 있는 요청. 응답 JSON(없으면 null)과 상태 */
  async #request(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController()
    let timedOut = false
    const outer = () => controller.abort()
    signal?.addEventListener('abort', outer, { once: true })
    const timer = this.#options.timer.sleep(timeoutMs, controller.signal).then(() => {
      if (!controller.signal.aborted) {
        timedOut = true
        controller.abort()
      }
    })
    try {
      const response = await (this.#options.fetch ?? fetch)(url, { ...init, signal: controller.signal })
      const text = await response.text()
      let body: unknown = null
      try {
        body = text === '' ? null : JSON.parse(text)
      } catch {
        body = null
      }
      return { status: response.status, body }
    } catch {
      throw new GoogleError(timedOut ? 'timeout' : 'network', null, null)
    } finally {
      signal?.removeEventListener('abort', outer)
      if (!controller.signal.aborted) controller.abort()
      await timer
    }
  }

  async #oauth(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const { status, body } = await this.#request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() },
      REQUEST_TIMEOUT_MS,
    )
    if (status < 200 || status >= 300) throw new GoogleError('http', status, reasonOf(body))
    if (typeof body !== 'object' || body === null) throw new GoogleError('http', status, null)
    return body as Record<string, unknown>
  }

  #tokens(body: Record<string, unknown>): TokenSet {
    const access = body.access_token
    const expires = body.expires_in
    if (typeof access !== 'string' || access === '') throw new GoogleError('http', 200, null)
    return {
      accessToken: access,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token !== '' ? body.refresh_token : null,
      expiresIn: typeof expires === 'number' && Number.isFinite(expires) && expires > 0 ? expires : 3600,
      scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter((scope) => scope !== '') : [],
    }
  }

  /** code → 토큰 (PKCE 검증 값과 함께, AC-Y1-02) */
  async exchangeCode(code: string, verifier: string): Promise<TokenSet> {
    const body = await this.#oauth(this.#options.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: this.#options.clientId,
      client_secret: this.#options.clientSecret,
      redirect_uri: this.#options.redirectUri,
    })
    return this.#tokens(body)
  }

  /** 접근 토큰 새로 고침 (AC-Y1-04). invalid_grant면 GoogleError(reason invalid_grant) */
  async refresh(refreshToken: string): Promise<TokenSet> {
    const body = await this.#oauth(this.#options.tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.#options.clientId,
      client_secret: this.#options.clientSecret,
    })
    return this.#tokens(body)
  }

  /** 토큰 폐기 (AC-Y1-06). 실패·타임아웃은 던진다(부르는 쪽이 무시하고 계속) */
  async revoke(token: string): Promise<void> {
    await this.#oauth(this.#options.revokeUrl, { token })
  }

  #apiUrl(path: string, query: Readonly<Record<string, string | undefined>> = {}): string {
    const url = new URL(`${this.#options.apiBase.replace(/\/$/, '')}${path}`)
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value)
    return url.toString()
  }

  /** Data API 요청-응답 호출 (보내기 직전에 센다) */
  async api(call: ApiCall): Promise<Record<string, unknown>> {
    await this.#options.meter(call.sellerId, call.method)
    const { status, body } = await this.#request(
      this.#apiUrl(call.path, call.query),
      {
        method: call.httpMethod ?? 'GET',
        headers: { Authorization: `Bearer ${call.accessToken}`, Accept: 'application/json', ...(call.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      },
      call.timeoutMs ?? REQUEST_TIMEOUT_MS,
      call.signal,
    )
    if (status < 200 || status >= 300) throw new GoogleError('http', status, reasonOf(body))
    if (typeof body !== 'object' || body === null) throw new GoogleError('http', status, null)
    return body as Record<string, unknown>
  }

  /**
   * streamList (AC-Y1-20): 연결을 열고 받은 응답(LiveChatMessageListResponse)을 하나씩 돌려준다. 시간 제한은 없다 — signal로 끊는다.
   * 열 때 한 번 센다(열린 스트림 하나 = 1번). 오류 응답이면 GoogleError, 연결이 끊기면 GoogleError(network)
   */
  async *stream(input: {
    sellerId: string
    accessToken: string
    liveChatId: string
    pageToken: string | null
    signal: AbortSignal
    /**
     * 스트림이 열렸다(응답 머리를 받음, 첫 응답 묶음 전) — 수집기가 다시 열기 간격을 이 때부터 재고, 채팅이 조용해도 "채팅을 받는 중"으로 적는다
     * (AC-Y1-94, AC-I3-24). 던지면 본문을 읽지 않고 그 오류를 던진다
     */
    onOpen?: () => void | Promise<void>
  }): AsyncGenerator<Record<string, unknown>> {
    await this.#options.meter(input.sellerId, 'liveChatMessages.streamList')
    let response: Response
    try {
      response = await (this.#options.fetch ?? fetch)(
        this.#apiUrl('/liveChat/messages/stream', {
          liveChatId: input.liveChatId,
          part: 'snippet,authorDetails',
          maxResults: '2000',
          ...(input.pageToken === null ? {} : { pageToken: input.pageToken }),
        }),
        { headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' }, signal: input.signal },
      )
    } catch {
      throw new GoogleError('network', null, null)
    }
    if (response.status < 200 || response.status >= 300) {
      let body: unknown
      try {
        body = JSON.parse(await response.text())
      } catch {
        body = null
      }
      throw new GoogleError('http', response.status, reasonOf(body))
    }
    try {
      await input.onOpen?.()
    } catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
    if (response.body === null) return
    const splitter = new JsonObjectSplitter()
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    try {
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>
        try {
          chunk = await reader.read()
        } catch {
          if (input.signal.aborted) return
          throw new GoogleError('network', null, null)
        }
        if (chunk.done) break
        for (const object of splitter.push(decoder.decode(chunk.value, { stream: true }))) yield object
      }
      // 끝났는데 덜 받은 객체가 남아 있으면 중간에 끊긴 것
      if (splitter.partial) throw new GoogleError('network', null, null)
    } finally {
      reader.releaseLock()
    }
  }
}

/**
 * 스트림 본문에서 맨 위 JSON 객체를 하나씩 꺼낸다. `[{…},{…}]`(배열을 조금씩 보냄)와 `{…}\n{…}`(이어 붙임) 둘 다 받는다.
 * 문자열 안의 괄호는 세지 않는다
 */
export class JsonObjectSplitter {
  #buffer = ''
  #depth = 0
  #inString = false
  #escape = false
  #start = -1

  /** 덜 받은 객체가 있는지 */
  get partial(): boolean {
    return this.#depth > 0
  }

  push(text: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    const base = this.#buffer.length
    this.#buffer += text
    for (let i = base; i < this.#buffer.length; i++) {
      const c = this.#buffer[i]
      if (this.#inString) {
        if (this.#escape) this.#escape = false
        else if (c === '\\') this.#escape = true
        else if (c === '"') this.#inString = false
        continue
      }
      if (c === '"') {
        if (this.#depth > 0) this.#inString = true
      } else if (c === '{') {
        if (this.#depth === 0) this.#start = i
        this.#depth += 1
      } else if (c === '}') {
        this.#depth -= 1
        if (this.#depth === 0 && this.#start >= 0) {
          const parsed: unknown = JSON.parse(this.#buffer.slice(this.#start, i + 1))
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) out.push(parsed as Record<string, unknown>)
          this.#start = -1
        }
      }
    }
    // 다 쓴 앞부분은 버린다
    if (this.#depth === 0) this.#buffer = ''
    else if (this.#start > 0) {
      this.#buffer = this.#buffer.slice(this.#start)
      this.#start = 0
    }
    return out
  }
}
