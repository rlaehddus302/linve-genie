// 밴드 Open API 읽기 클라이언트 (D-BND1-01·08·10·14, AC-BND1-32·51·53·60·61). 주소 표(endpoints.ts)의 GET 일곱 개만 부른다.
// - 요청마다 10초(설정) 안에 답이 없으면 실패. 응답의 result_code가 1이 아니거나 HTTP 상태가 2xx가 아니면 실패다.
// - 실패 나누기: 10401·토큰 응답 invalid_token → RECONNECT, 10403·60102·60200·60203·60204 → NO_ACCESS, 1002·1003 → RATE_SELLER,
//   1001 → RATE_APP(서버의 모든 밴드 요청을 60초부터 두 배씩 600초까지 함께 쉰다 — 쉬는 동안 보내지 않는다), 그 밖 → RETRY.
// - 주소·토큰·밴드가 준 message·본문은 로그·오류에 쓰지 않는다. 로그는 정해진 코드와 (요청 이름_결과 코드)만.
import { errorKind, type LogSink } from '../log.ts'
import type { BandSettings } from './config.ts'
import { bandRequestUrl, type BandOp } from './endpoints.ts'

export type BandFailureKind = 'RECONNECT' | 'NO_ACCESS' | 'RATE_SELLER' | 'RATE_APP' | 'RETRY'

export interface BandFailure {
  readonly kind: BandFailureKind
  /** 로그용 코드 (result_code 숫자·HTTP_<상태>·TIMEOUT·NETWORK·NOT_JSON·SHAPE·PAUSED) */
  readonly code: string
}

export type BandResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: BandFailure }

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)

export const BAND_RECONNECT_CODES: readonly number[] = Object.freeze([10401])
export const BAND_NO_ACCESS_CODES: readonly number[] = Object.freeze([10403, 60102, 60200, 60203, 60204])
export const BAND_SELLER_RATE_CODES: readonly number[] = Object.freeze([1002, 1003])
export const BAND_APP_RATE_CODE = 1001

/** result_code → 실패 종류 (공식 문서 "오류 처리" 표에 있는 값만 나눈다 — 모르는 코드는 다시 시도) */
export function classifyBandCode(code: number): BandFailureKind {
  if (BAND_RECONNECT_CODES.includes(code)) return 'RECONNECT'
  if (BAND_NO_ACCESS_CODES.includes(code)) return 'NO_ACCESS'
  if (BAND_SELLER_RATE_CODES.includes(code)) return 'RATE_SELLER'
  if (code === BAND_APP_RATE_CODE) return 'RATE_APP'
  return 'RETRY'
}

/** 앱 전체 한도 쉼 (AC-BND1-53): 60초부터 두 배씩 600초까지 */
export const BAND_APP_PAUSE_FIRST_MS = 60_000
export const BAND_APP_PAUSE_MAX_MS = 600_000

export interface BandClientOptions {
  readonly settings: BandSettings
  readonly now: () => number
  readonly log: LogSink
  /** HTTP 함수 (기본 전역 fetch) */
  readonly fetch?: typeof fetch
  /**
   * 밴드가 호출 한도 신호(1002·1003 → RATE_SELLER, 1001 → RATE_APP)를 줄 때마다 (D-BND1-23 (나) — 부르는 쪽이 전체 읽기를 멈춘다).
   * 이미 쉬는 중이라 보내지 않은 요청(PAUSED)은 신호가 아니다
   */
  readonly onRateSignal?: (kind: 'RATE_SELLER' | 'RATE_APP', sellerId: string | null) => void
}

/** 다음 쪽 값 (D-BND1-08): next_params 중 우리 값으로 채우는 셋은 버리고 나머지 글 값만 */
export const BAND_OWN_PARAMS: readonly string[] = Object.freeze(['access_token', 'band_key', 'post_key'])

export function pagingParams(next: unknown): Record<string, string> | null {
  if (!isObj(next)) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(next)) {
    if (BAND_OWN_PARAMS.includes(key) || !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(key)) continue
    if (typeof value === 'string' && value.length <= 512) out[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value)
  }
  return out
}

type SendOutcome = { readonly status: number; readonly body: unknown } | { readonly failure: BandFailure }

export class BandClient {
  readonly #options: BandClientOptions
  readonly #fetch: typeof fetch
  #pauseUntil = 0
  #pauseMs = 0

  constructor(options: BandClientOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  }

  get settings(): BandSettings {
    return this.#options.settings
  }

  /** 앱 전체 한도로 쉬는 중이면 남은 밀리초 (아니면 0) */
  appPauseRemaining(): number {
    return Math.max(0, this.#pauseUntil - this.#options.now())
  }

  /** 승인 창 주소 (브라우저가 간다 — 서버는 부르지 않는다) */
  authorizeUrl(redirectUri: string, state: string): string {
    const { settings } = this.#options
    return bandRequestUrl(settings, 'authorize', 'GET', { response_type: 'code', client_id: settings.clientId, redirect_uri: redirectUri, state }).toString()
  }

  #fail(op: BandOp, failure: BandFailure, sellerId: string | null, status?: number): { ok: false; failure: BandFailure } {
    if (failure.kind === 'RATE_APP' && failure.code !== 'PAUSED') {
      this.#pauseMs = this.#pauseMs === 0 ? BAND_APP_PAUSE_FIRST_MS : Math.min(BAND_APP_PAUSE_MAX_MS, this.#pauseMs * 2)
      this.#pauseUntil = this.#options.now() + this.#pauseMs
    }
    if ((failure.kind === 'RATE_APP' || failure.kind === 'RATE_SELLER') && failure.code !== 'PAUSED') this.#options.onRateSignal?.(failure.kind, sellerId)
    this.#options.log({
      level: 'warn',
      code: 'BAND_API_FAILED',
      reason: `${op}_${failure.code}`,
      ...(sellerId === null ? {} : { seller: sellerId }),
      ...(status === undefined ? {} : { status }),
    })
    return { ok: false, failure }
  }

  async #send(op: BandOp, query: Readonly<Record<string, string>>, headers: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<SendOutcome> {
    if (signal?.aborted === true) return { failure: { kind: 'RETRY', code: 'ABORTED' } }
    if (this.appPauseRemaining() > 0) return { failure: { kind: 'RATE_APP', code: 'PAUSED' } }
    const url = bandRequestUrl(this.#options.settings, op, 'GET', query)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#options.settings.timeoutMs)
    timer.unref?.()
    // 부르는 쪽이 그만두면(끊기·회차 끝) 기다리지 않고 요청을 닫는다
    const both = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    try {
      const response = await this.#fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: both })
      const text = await response.text()
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return { failure: { kind: 'RETRY', code: response.ok ? 'NOT_JSON' : `HTTP_${String(response.status)}` } }
      }
      return { status: response.status, body }
    } catch {
      const stopped: boolean = signal?.aborted ?? false
      return { failure: { kind: 'RETRY', code: stopped ? 'ABORTED' : controller.signal.aborted ? 'TIMEOUT' : 'NETWORK' } }
    } finally {
      clearTimeout(timer)
    }
  }

  /** API 하나 (토큰은 질의에 싣는다 — 공식 문서) → result_data 객체. signal이 끊기면 ABORTED(다시 시도 종류)로 바로 끝난다 */
  async api(op: Exclude<BandOp, 'authorize' | 'token'>, token: string, query: Readonly<Record<string, string>>, sellerId: string | null, signal?: AbortSignal): Promise<BandResult<Obj>> {
    let sent: SendOutcome
    try {
      sent = await this.#send(op, { ...query, access_token: token }, {}, signal)
    } catch (error) {
      this.#options.log({ level: 'error', code: 'BAND_API_FAILED', reason: `${op}_ERROR`, errorKind: errorKind(error) })
      return { ok: false, failure: { kind: 'RETRY', code: 'ERROR' } }
    }
    if ('failure' in sent) return this.#fail(op, sent.failure, sellerId)
    const body = sent.body
    const code = isObj(body) ? body['result_code'] : undefined
    if (typeof code === 'number' && code !== 1) return this.#fail(op, { kind: classifyBandCode(code), code: Number.isSafeInteger(code) ? String(code) : 'SHAPE' }, sellerId, sent.status)
    if (sent.status < 200 || sent.status > 299) return this.#fail(op, { kind: 'RETRY', code: `HTTP_${String(sent.status)}` }, sellerId, sent.status)
    if (code !== 1 || !isObj(body) || !isObj(body['result_data'])) return this.#fail(op, { kind: 'RETRY', code: 'SHAPE' }, sellerId, sent.status)
    this.#pauseMs = 0
    return { ok: true, data: body['result_data'] }
  }

  /** code → 토큰 응답 객체 (Authorization: Basic base64(client_id:client_secret)) */
  async token(code: string, sellerId: string | null): Promise<BandResult<Obj>> {
    const { clientId, clientSecret } = this.#options.settings
    const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')
    let sent: SendOutcome
    try {
      sent = await this.#send('token', { grant_type: 'authorization_code', code }, { Authorization: `Basic ${basic}` })
    } catch (error) {
      this.#options.log({ level: 'error', code: 'BAND_API_FAILED', reason: 'token_ERROR', errorKind: errorKind(error) })
      return { ok: false, failure: { kind: 'RETRY', code: 'ERROR' } }
    }
    if ('failure' in sent) return this.#fail('token', sent.failure, sellerId)
    const body = sent.body
    if (isObj(body) && body['error'] === 'invalid_token') return this.#fail('token', { kind: 'RECONNECT', code: 'INVALID_TOKEN' }, sellerId, sent.status)
    const resultCode = isObj(body) ? body['result_code'] : undefined
    if (typeof resultCode === 'number' && resultCode !== 1) return this.#fail('token', { kind: classifyBandCode(resultCode), code: Number.isSafeInteger(resultCode) ? String(resultCode) : 'SHAPE' }, sellerId, sent.status)
    if (sent.status < 200 || sent.status > 299 || !isObj(body) || 'error' in body) return this.#fail('token', { kind: 'RETRY', code: `HTTP_${String(sent.status)}` }, sellerId, sent.status)
    this.#pauseMs = 0
    return { ok: true, data: body }
  }
}
