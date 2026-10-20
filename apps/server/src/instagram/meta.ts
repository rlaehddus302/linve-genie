// 메타(인스타그램·페이스북 그래프) HTTP 어댑터 (PLT-01, D-N2-06·D-N2-10·D-N2-11).
// - 로그인 방식 둘(페이스북 로그인 기본·인스타그램 로그인)을 이 어댑터 하나 뒤에 둔다. 주소는 설정에서 읽는다 — 시험은 가짜 메타 서버 주소다.
// - 토큰은 Authorization 헤더로만 보낸다(주소에 넣지 않는다). 앱 시크릿은 토큰 교환 요청에만 쓴다.
// - 이 파일은 어떤 로그도 남기지 않는다. 오류는 분류(MetaFailure)만 돌려준다 — 메타 오류 문장·주소·토큰이 위로 올라가지 않는다.
// - 메타 오류 코드 → 분류 표(ERROR_TABLE)는 2026-10 메타 문서 기준의 기본값이다. 가짜 메타 서버가 같은 코드로 오류를 낸다(AC-N2-47).
import { DEFAULT_TIMEOUTS, PERMISSION_NAMES, type InstagramLogin, type InstagramSettings } from './config.ts'

/** 메타 호출 실패 분류 */
export type MetaFailure = 'TOKEN_INVALID' | 'RETRY' | 'NO_PERMISSION' | 'LIVE_ENDED' | 'ONE_REPLY' | 'REJECTED' | 'TIMEOUT'

export type MetaResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: MetaFailure }

/**
 * 메타 오류 코드 → 분류 (AC-N2-47). HTTP 상태: 429·5xx는 다시 시도. 그래프 오류 객체 { code, error_subcode, is_transient }:
 * - TOKEN_INVALID: code 190·102 (토큰 무효 — 연결을 "다시 연결 필요"로)
 * - LIVE_ENDED: subcode 2018278 (라이브가 끝나 개인 답장 시간이 지남)
 * - ONE_REPLY: subcode 2534023 (그 댓글에 이미 개인 답장을 보냄)
 * - RETRY: code 4·17·32·613 (속도 제한), code 1·2 (일시 오류), is_transient
 * - NO_PERMISSION: code 3·10·200~299 (권한 없음)
 * - 그 밖의 400대: REJECTED
 */
export const ERROR_TABLE = {
  tokenInvalid: [190, 102],
  liveEndedSubcode: 2018278,
  oneReplySubcode: 2534023,
  rateLimit: [4, 17, 32, 613],
  temporary: [1, 2],
  permission: [3, 10],
} as const

export function classifyMetaError(status: number, body: unknown): MetaFailure {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  const code = typeof error?.code === 'number' ? error.code : null
  const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : null
  if (code !== null && (ERROR_TABLE.tokenInvalid as readonly number[]).includes(code)) return 'TOKEN_INVALID'
  if (subcode === ERROR_TABLE.liveEndedSubcode) return 'LIVE_ENDED'
  if (subcode === ERROR_TABLE.oneReplySubcode) return 'ONE_REPLY'
  if (status === 429 || status >= 500) return 'RETRY'
  if (code !== null && ((ERROR_TABLE.rateLimit as readonly number[]).includes(code) || (ERROR_TABLE.temporary as readonly number[]).includes(code))) return 'RETRY'
  if (error?.is_transient === true) return 'RETRY'
  if (code !== null && ((ERROR_TABLE.permission as readonly number[]).includes(code) || (code >= 200 && code <= 299))) return 'NO_PERMISSION'
  return 'REJECTED'
}

/** 연결에 쓰는 토큰 묶음 (암호화해 저장한다) */
export interface MetaTokens {
  /** 페이스북 로그인: 긴 사용자 토큰 (권한 철회에 쓴다) */
  readonly user: string | null
  /** 페이스북 로그인: 계정이 붙은 페이지의 토큰 (API 호출) */
  readonly page: string | null
  /** 인스타그램 로그인: 긴 토큰 (60일, 새로 고친다) */
  readonly ig: string | null
}

/** API를 부를 연결 */
export interface MetaConnection {
  readonly login: InstagramLogin
  readonly accountId: string
  readonly pageId: string | null
  readonly tokens: MetaTokens
}

/** 허락받은 프로페셔널 계정 하나 */
export interface GrantedAccount {
  readonly id: string
  readonly username: string
  /** BUSINESS · CREATOR (메타가 알려 주지 않으면 null) */
  readonly type: 'BUSINESS' | 'CREATOR' | null
  readonly pageId: string | null
  readonly pageToken: string | null
}

/** code를 토큰으로 바꾼 결과 */
export interface Grant {
  readonly login: InstagramLogin
  /** 페이스북 로그인: 긴 사용자 토큰 / 인스타그램 로그인: 긴 토큰 */
  readonly userToken: string | null
  readonly igToken: string | null
  /** 인스타그램 로그인 긴 토큰의 남은 시간 (초) — 만료 시각은 부르는 쪽이 서버 시계로 정한다 */
  readonly expiresIn: number | null
  /** 허락받은 프로페셔널 계정 (개인 계정·계정이 안 붙은 페이지는 빠진다) */
  readonly accounts: readonly GrantedAccount[]
  readonly permissions: { readonly comments: boolean; readonly messages: boolean }
}

export interface ConversationMessage {
  readonly id: string
  readonly text: string
  readonly fromId: string
  /** UTC 밀리초 (읽지 못하면 null) */
  readonly createdAt: number | null
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

interface CallOptions {
  readonly token?: string
  readonly query?: Readonly<Record<string, string>>
  readonly form?: Readonly<Record<string, string>>
  readonly json?: unknown
  readonly timeoutMs: number
}

type CallResult = { readonly kind: 'response'; readonly status: number; readonly body: unknown } | { readonly kind: 'timeout' } | { readonly kind: 'network' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null)

/** 메타 시각 문자열(`+0000` 꼴 포함) → UTC 밀리초 */
export function parseMetaTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(ms) ? ms : null
}

function accountType(value: unknown): GrantedAccount['type'] {
  if (value === 'BUSINESS') return 'BUSINESS'
  if (value === 'CREATOR' || value === 'MEDIA_CREATOR') return 'CREATOR'
  return null
}

/** 그래프 API 호출 어댑터 */
export class MetaClient {
  readonly #settings: InstagramSettings
  readonly #fetch: FetchLike

  constructor(settings: InstagramSettings, fetchImpl?: FetchLike) {
    this.#settings = settings
    this.#fetch = fetchImpl ?? ((input, init) => fetch(input, init))
  }

  get settings(): InstagramSettings {
    return this.#settings
  }

  /** 승인 주소 (AC-N2-10). rerequest: 빠진 권한을 다시 묻는다(DM 동의를 켤 때) */
  authorizeUrl(login: InstagramLogin, state: string, rerequest: boolean): string {
    const s = this.#settings
    const params = new URLSearchParams({ client_id: s.appId, redirect_uri: s.redirectUri, response_type: 'code', state, scope: s.scopes[login].join(',') })
    if (rerequest && login === 'FACEBOOK') params.set('auth_type', 'rerequest')
    return `${login === 'FACEBOOK' ? s.endpoints.fbDialog : s.endpoints.igAuthorize}?${params.toString()}`
  }

  async #call(method: string, url: string, options: CallOptions): Promise<CallResult> {
    const target = new URL(url)
    for (const [key, value] of Object.entries(options.query ?? {})) target.searchParams.set(key, value)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`
    let body: string | undefined
    if (options.form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(options.form as Record<string, string>).toString()
    } else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    }
    try {
      const response = await this.#fetch(target.toString(), { method, headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(options.timeoutMs), redirect: 'manual' })
      const text = await response.text()
      let parsed: unknown = null
      try {
        parsed = text === '' ? null : JSON.parse(text)
      } catch {
        parsed = null
      }
      return { kind: 'response', status: response.status, body: parsed }
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError' ? { kind: 'timeout' } : { kind: 'network' }
    }
  }

  /** 응답 → 결과 (2xx만 성공). 시간 제한·네트워크 오류는 notOk로 */
  async #json(method: string, url: string, options: CallOptions, notOk: MetaFailure = 'RETRY'): Promise<MetaResult<Record<string, unknown>>> {
    const result = await this.#call(method, url, options)
    if (result.kind !== 'response') return { ok: false, failure: result.kind === 'timeout' ? notOk : 'RETRY' }
    if (result.status < 200 || result.status >= 300) return { ok: false, failure: classifyMetaError(result.status, result.body) }
    return { ok: true, value: isRecord(result.body) ? result.body : {} }
  }

  get #timeout(): number {
    return this.#settings.timeouts.requestMs ?? DEFAULT_TIMEOUTS.requestMs
  }

  /** code → 토큰·계정·권한 (AC-N2-11). 로그인 방식마다 단계가 다르다 */
  async grant(login: InstagramLogin, code: string): Promise<MetaResult<Grant>> {
    return login === 'FACEBOOK' ? this.#grantFacebook(code) : this.#grantInstagram(code)
  }

  async #grantFacebook(code: string): Promise<MetaResult<Grant>> {
    const s = this.#settings
    const timeoutMs = this.#timeout
    const short = await this.#json('GET', `${s.endpoints.graph}/oauth/access_token`, { query: { client_id: s.appId, redirect_uri: s.redirectUri, client_secret: s.appSecret, code }, timeoutMs })
    if (!short.ok) return short
    const shortToken = str(short.value.access_token)
    if (shortToken === null) return { ok: false, failure: 'REJECTED' }
    const long = await this.#json('GET', `${s.endpoints.graph}/oauth/access_token`, {
      query: { grant_type: 'fb_exchange_token', client_id: s.appId, client_secret: s.appSecret, fb_exchange_token: shortToken },
      timeoutMs,
    })
    if (!long.ok) return long
    const userToken = str(long.value.access_token)
    if (userToken === null) return { ok: false, failure: 'REJECTED' }
    const permissions = await this.#json('GET', `${s.endpoints.graph}/me/permissions`, { token: userToken, timeoutMs })
    if (!permissions.ok) return permissions
    const granted = new Set<string>()
    for (const item of Array.isArray(permissions.value.data) ? permissions.value.data : []) {
      if (isRecord(item) && item.status === 'granted' && typeof item.permission === 'string') granted.add(item.permission)
    }
    const pages = await this.#json('GET', `${s.endpoints.graph}/me/accounts`, {
      token: userToken,
      query: { fields: 'id,access_token,instagram_business_account{id,username,account_type}', limit: '100' },
      timeoutMs,
    })
    if (!pages.ok) return pages
    const accounts: GrantedAccount[] = []
    for (const page of Array.isArray(pages.value.data) ? pages.value.data : []) {
      if (!isRecord(page) || !isRecord(page.instagram_business_account)) continue
      const ig = page.instagram_business_account
      const id = str(ig.id)
      const pageId = str(page.id)
      const pageToken = str(page.access_token)
      if (id === null || pageId === null || pageToken === null) continue
      accounts.push({ id, username: typeof ig.username === 'string' ? ig.username : '', type: accountType(ig.account_type), pageId, pageToken })
    }
    return {
      ok: true,
      value: {
        login: 'FACEBOOK',
        userToken,
        igToken: null,
        expiresIn: null,
        accounts,
        permissions: { comments: PERMISSION_NAMES.comments.some((name) => granted.has(name)), messages: PERMISSION_NAMES.messages.some((name) => granted.has(name)) },
      },
    }
  }

  async #grantInstagram(code: string): Promise<MetaResult<Grant>> {
    const s = this.#settings
    const timeoutMs = this.#timeout
    const short = await this.#json('POST', s.endpoints.igToken, {
      form: { client_id: s.appId, client_secret: s.appSecret, grant_type: 'authorization_code', redirect_uri: s.redirectUri, code },
      timeoutMs,
    })
    if (!short.ok) return short
    const first = Array.isArray(short.value.data) && isRecord(short.value.data[0]) ? short.value.data[0] : short.value
    const shortToken = str(first.access_token)
    if (shortToken === null) return { ok: false, failure: 'REJECTED' }
    const rawPermissions = first.permissions
    const granted = new Set<string>(
      Array.isArray(rawPermissions) ? rawPermissions.filter((item): item is string => typeof item === 'string') : typeof rawPermissions === 'string' ? rawPermissions.split(',').map((item) => item.trim()) : [],
    )
    const long = await this.#json('GET', `${s.endpoints.igGraph}/access_token`, { query: { grant_type: 'ig_exchange_token', client_secret: s.appSecret, access_token: shortToken }, timeoutMs })
    if (!long.ok) return long
    const igToken = str(long.value.access_token)
    const expiresIn = typeof long.value.expires_in === 'number' ? long.value.expires_in : null
    if (igToken === null) return { ok: false, failure: 'REJECTED' }
    const me = await this.#json('GET', `${s.endpoints.igGraph}/me`, { token: igToken, query: { fields: 'user_id,username,account_type' }, timeoutMs })
    if (!me.ok) return me
    const id = str(me.value.user_id) ?? str(me.value.id)
    const type = accountType(me.value.account_type)
    const accounts: GrantedAccount[] = id === null || type === null ? [] : [{ id, username: typeof me.value.username === 'string' ? me.value.username : '', type, pageId: null, pageToken: null }]
    return {
      ok: true,
      value: {
        login: 'INSTAGRAM',
        userToken: null,
        igToken,
        expiresIn,
        accounts,
        permissions: { comments: PERMISSION_NAMES.comments.some((name) => granted.has(name)), messages: PERMISSION_NAMES.messages.some((name) => granted.has(name)) },
      },
    }
  }

  /** API 기본 주소·호출 토큰·메시지를 보내는 노드 ID */
  #api(conn: MetaConnection): { base: string; token: string | null; node: string } {
    const s = this.#settings
    return conn.login === 'FACEBOOK'
      ? { base: s.endpoints.graph, token: conn.tokens.page, node: conn.pageId ?? conn.accountId }
      : { base: s.endpoints.igGraph, token: conn.tokens.ig, node: conn.accountId }
  }

  /** 웹훅 구독 (AC-N2-12): 페이스북 로그인은 페이지 구독, 인스타그램 로그인은 계정 구독 */
  async subscribe(conn: MetaConnection): Promise<MetaResult<null>> {
    const api = this.#api(conn)
    if (api.token === null) return { ok: false, failure: 'TOKEN_INVALID' }
    const result = await this.#json('POST', `${api.base}/${encodeURIComponent(api.node)}/subscribed_apps`, {
      token: api.token,
      query: { subscribed_fields: this.#settings.subscribedFields.join(',') },
      timeoutMs: this.#timeout,
    })
    if (!result.ok) return result
    return result.value.success === false ? { ok: false, failure: 'REJECTED' } : { ok: true, value: null }
  }

  async unsubscribe(conn: MetaConnection): Promise<MetaResult<null>> {
    const api = this.#api(conn)
    if (api.token === null) return { ok: false, failure: 'TOKEN_INVALID' }
    const result = await this.#json('DELETE', `${api.base}/${encodeURIComponent(api.node)}/subscribed_apps`, { token: api.token, timeoutMs: this.#timeout })
    return result.ok ? { ok: true, value: null } : result
  }

  /** 권한 철회 (끊기, AC-N2-16) */
  async revoke(conn: MetaConnection): Promise<MetaResult<null>> {
    const s = this.#settings
    const token = conn.login === 'FACEBOOK' ? conn.tokens.user : conn.tokens.ig
    if (token === null) return { ok: false, failure: 'TOKEN_INVALID' }
    const base = conn.login === 'FACEBOOK' ? s.endpoints.graph : s.endpoints.igGraph
    const result = await this.#json('DELETE', `${base}/me/permissions`, { token, timeoutMs: this.#timeout })
    return result.ok ? { ok: true, value: null } : result
  }

  /** 인스타그램 로그인 긴 토큰 새로 고침 (AC-N2-14) */
  async refresh(igToken: string): Promise<MetaResult<{ readonly token: string; readonly expiresIn: number | null }>> {
    const result = await this.#json('GET', `${this.#settings.endpoints.igGraph}/refresh_access_token`, { query: { grant_type: 'ig_refresh_token', access_token: igToken }, timeoutMs: this.#timeout })
    if (!result.ok) return result
    const token = str(result.value.access_token)
    if (token === null) return { ok: false, failure: 'REJECTED' }
    const expiresIn = typeof result.value.expires_in === 'number' ? result.value.expires_in : null
    return { ok: true, value: { token, expiresIn } }
  }

  /** 진행 중 라이브 (live_media, AC-N2-20) */
  async liveMedia(conn: MetaConnection): Promise<MetaResult<{ readonly id: string; readonly startedAt: number | null }[]>> {
    const api = this.#api(conn)
    if (api.token === null) return { ok: false, failure: 'TOKEN_INVALID' }
    const result = await this.#json('GET', `${api.base}/${encodeURIComponent(conn.accountId)}/live_media`, { token: api.token, query: { fields: 'id,timestamp' }, timeoutMs: this.#timeout })
    if (!result.ok) return result
    const lives: { id: string; startedAt: number | null }[] = []
    for (const item of Array.isArray(result.value.data) ? result.value.data : []) {
      const id = isRecord(item) ? str(item.id) : null
      if (id !== null && isRecord(item)) lives.push({ id, startedAt: parseMetaTime(item.timestamp) })
    }
    return { ok: true, value: lives }
  }

  /** 개인 답장 (받는 사람 = 댓글 ID, AC-N2-46·47·48). 응답이 없으면(시간 제한·연결 끊김) TIMEOUT */
  async privateReply(conn: MetaConnection, commentId: string, text: string): Promise<MetaResult<string>> {
    const api = this.#api(conn)
    if (api.token === null) return { ok: false, failure: 'TOKEN_INVALID' }
    const result = await this.#call('POST', `${api.base}/${encodeURIComponent(api.node)}/messages`, {
      token: api.token,
      json: { recipient: { comment_id: commentId }, message: { text } },
      timeoutMs: this.#settings.timeouts.sendMs,
    })
    if (result.kind !== 'response') return { ok: false, failure: 'TIMEOUT' }
    if (result.status < 200 || result.status >= 300) return { ok: false, failure: classifyMetaError(result.status, result.body) }
    const id = isRecord(result.body) ? str(result.body.message_id) : null
    return id === null ? { ok: false, failure: 'TIMEOUT' } : { ok: true, value: id }
  }

  /** 그 사람(IGSID)과의 대화 메시지 (타임아웃 확인, AC-N2-48) */
  async conversation(conn: MetaConnection, igsid: string): Promise<MetaResult<ConversationMessage[]>> {
    const api = this.#api(conn)
    if (api.token === null) return { ok: false, failure: 'TOKEN_INVALID' }
    const query: Record<string, string> = { user_id: igsid, fields: 'messages{id,message,from,created_time}' }
    if (conn.login === 'FACEBOOK') query.platform = 'instagram'
    const result = await this.#json('GET', `${api.base}/${encodeURIComponent(api.node)}/conversations`, { token: api.token, query, timeoutMs: this.#settings.timeouts.confirmMs }, 'TIMEOUT')
    if (!result.ok) return result
    const messages: ConversationMessage[] = []
    for (const conversation of Array.isArray(result.value.data) ? result.value.data : []) {
      const list = isRecord(conversation) && isRecord(conversation.messages) && Array.isArray(conversation.messages.data) ? conversation.messages.data : []
      for (const item of list) {
        if (!isRecord(item)) continue
        const id = str(item.id)
        const fromId = isRecord(item.from) ? str(item.from.id) : null
        if (id === null || fromId === null || typeof item.message !== 'string') continue
        messages.push({ id, text: item.message, fromId, createdAt: parseMetaTime(item.created_time) })
      }
    }
    return { ok: true, value: messages }
  }
}
