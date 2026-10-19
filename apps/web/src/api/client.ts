// 서버 호출 (AC-S05-63·71·74). 세션은 서버가 준 쿠키로만 다룬다(credentials: 'include') — 화면은 토큰을 읽거나 저장하지 않는다.
// - 오류는 서버의 쉬운 문장(message·problems·hint)을 그대로 담아 던진다. 코드·HTTP 상태는 "자세히"에만 보인다.
// - 세션이 끝나면(401 UNAUTHORIZED) 등록한 처리기를 부른다 → 로그인 화면으로 (AC-S05-01).
// - 쓰기는 누를 때 만든 요청 번호로 보내고, 네트워크 오류·SAVE_FAILED면 같은 요청 번호로 다시 보낸다(최대 3번, 간격을 늘려).
import type { ApiProblem } from './types.ts'

/** 서버에 닿지 못했을 때의 문장 */
export const NETWORK_MESSAGE = '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
/** 서버가 오류 본문 없이 실패했을 때의 문장 */
export const UNKNOWN_MESSAGE = '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'
/** 자동으로 다시 보낸 뒤에도 저장하지 못했을 때 (AC-S05-63) */
export const SAVE_FAILED_MESSAGE = '저장하지 못했어요.'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly problems: readonly ApiProblem[]
  /** 서버에 닿지 못했다(오프라인·연결 끊김) */
  readonly network: boolean
  constructor(input: { status: number; code: string; message: string; problems?: readonly ApiProblem[]; network?: boolean }) {
    super(input.message)
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.code
    this.problems = input.problems ?? []
    this.network = input.network ?? false
  }

  /** 같은 요청 번호로 자동으로 다시 보내도 되는 실패 (기록되지 않았다) */
  get retryable(): boolean {
    return this.network || this.code === 'SAVE_FAILED'
  }

  /** 잠시 뒤 다시 시도하면 되는 실패 (다시 보내기 버튼을 보인다, AC-S05-71) */
  get transient(): boolean {
    return this.retryable || this.code === 'STATE_FORMAT' || this.code === 'INTERNAL_ERROR'
  }

  /** 그 칸의 문제 (없으면 undefined) */
  problemFor(field: string): ApiProblem | undefined {
    return this.problems.find((problem) => problem.field === field)
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

type Listener = () => void
let unauthorizedListener: Listener | null = null

/** 세션이 끝났을 때(어떤 API든 401 UNAUTHORIZED) 부를 처리기 */
export function onUnauthorized(listener: Listener | null): void {
  unauthorizedListener = listener
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function problemsOf(value: unknown): ApiProblem[] {
  if (!Array.isArray(value)) return []
  const out: ApiProblem[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.message !== 'string') continue
    out.push({
      field: typeof item.field === 'string' ? item.field : null,
      message: item.message,
      ...(typeof item.hint === 'string' ? { hint: item.hint } : {}),
    })
  }
  return out
}

/** 서버 오류 본문 → ApiError */
export function errorFromBody(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  return new ApiError({
    status,
    code: error !== null && typeof error.code === 'string' ? error.code : 'UNKNOWN',
    message: error !== null && typeof error.message === 'string' ? error.message : UNKNOWN_MESSAGE,
    problems: error === null ? [] : problemsOf(error.problems),
  })
}

export interface RequestOptions {
  readonly signal?: AbortSignal
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError({ status: 0, code: 'NETWORK', message: NETWORK_MESSAGE, network: true })
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    if (response.ok) throw new ApiError({ status: response.status, code: 'NOT_JSON', message: UNKNOWN_MESSAGE })
  }
  if (response.ok) return payload as T
  const error = errorFromBody(response.status, payload)
  if (response.status === 401 && error.code === 'UNAUTHORIZED') unauthorizedListener?.()
  throw error
}

export function get<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options)
}

export function post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, options)
}

/** 요청 번호: 쓰기 버튼을 누를 때마다 새로 만든다 (서버 형식 영문·숫자·'-' 1~64자) */
export function newRequestId(): string {
  return crypto.randomUUID()
}

/** 자동 재시도 간격 (밀리초). 길이 = 다시 보내는 횟수 (AC-S05-63 "최대 3번, 간격을 늘려") */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000]

export interface RetryOptions {
  readonly delays?: readonly number[]
  readonly sleep?: (ms: number) => Promise<void>
  /** 다시 보내기 전에 부른다 (화면의 "다시 보내는 중" 표시) */
  readonly onRetry?: (attempt: number) => void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 같은 요청으로 다시 보낼 수 있는 실패(네트워크·SAVE_FAILED)면 간격을 늘려 다시 보낸다. 요청 번호는 send가 닫아 둔 같은 값이다 —
 * 서버는 같은 요청 번호를 한 번만 기록한다. 그래도 안 되면 마지막 오류를 던진다.
 */
export async function withRetry<T>(send: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS
  const sleep = options.sleep ?? defaultSleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await send()
    } catch (error) {
      const delay = delays[attempt]
      if (!isApiError(error) || !error.retryable || delay === undefined) throw error
      options.onRetry?.(attempt + 1)
      await sleep(delay)
    }
  }
}

/** 날짜로 범위를 고르는 경로의 리허설 표시 (적지 않으면 실제 범위) */
export function scopeQuery(rehearsal: boolean): string {
  return rehearsal ? 'rehearsal=true' : ''
}

/** 경로 + 질의 */
export function withQuery(path: string, params: Readonly<Record<string, string | number | boolean | undefined>>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? path : `${path}?${text}`
}
