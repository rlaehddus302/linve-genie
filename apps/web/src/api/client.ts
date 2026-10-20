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
  /** 오류 본문의 error 밖 값 (예: 생성기 409의 돌고 있는 방송 ID `broadcast`) */
  readonly details: Readonly<Record<string, unknown>>
  constructor(input: {
    status: number
    code: string
    message: string
    problems?: readonly ApiProblem[]
    network?: boolean
    details?: Readonly<Record<string, unknown>>
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.code
    this.problems = input.problems ?? []
    this.network = input.network ?? false
    this.details = input.details ?? {}
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
  const details: Record<string, unknown> = {}
  if (isRecord(body)) for (const [key, value] of Object.entries(body)) if (key !== 'error') details[key] = value
  return new ApiError({
    status,
    code: error !== null && typeof error.code === 'string' ? error.code : 'UNKNOWN',
    message: error !== null && typeof error.message === 'string' ? error.message : UNKNOWN_MESSAGE,
    problems: error === null ? [] : problemsOf(error.problems),
    details,
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

export function put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PUT', path, body, options)
}

/** 서버가 만든 파일 (확인서·판매대장·포장 라벨·전체 내려받기, I2 D-I2-01) */
export interface FileResponse {
  readonly blob: Blob
  /** 내려받기 이름 (응답 Content-Disposition의 UTF-8 이름 — 없으면 fallback) */
  readonly fileName: string
  readonly type: string
  readonly headers: Headers
}

/**
 * Content-Disposition에서 파일 이름: UTF-8 `filename*`가 먼저, 없으면 따옴표 안 `filename`, 둘 다 없으면 fallback.
 * 경로 글자(`/`·`\`)와 제어 글자는 빼서 이름만 남긴다.
 */
export function fileNameOf(disposition: string | null, fallback: string): string {
  if (disposition === null) return fallback
  let name: string | null = null
  const ext = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)
  if (ext?.[1] !== undefined) {
    try {
      name = decodeURIComponent(ext[1].trim())
    } catch {
      name = null
    }
  }
  if (name === null) name = /filename\s*=\s*"([^"]*)"/i.exec(disposition)?.[1] ?? null
  // 경로 글자·제어 글자를 뺀다 (이름만 남긴다)
  const cleaned = [...(name ?? '')].filter((char) => char !== '/' && char !== '\\' && (char.codePointAt(0) ?? 0) > 0x1f && char !== '\u007f').join('').trim()
  return cleaned === '' ? fallback : cleaned
}

export interface FileRequestOptions extends RequestOptions {
  /** 응답에 이름이 없을 때 쓸 이름 */
  readonly fallbackName?: string
}

/**
 * 파일 받기 (GET). 실패하면 서버 오류 본문(JSON)의 쉬운 문장으로 ApiError를 던진다 — JSON 조회와 같다.
 * 받은 바이트는 그대로 돌려준다(화면이 다시 만들지 않는다 — 공유·저장·미리 보기가 같은 바이트, D-I2-01).
 */
export async function getFile(path: string, options: FileRequestOptions = {}): Promise<FileResponse> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: '*/*' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError({ status: 0, code: 'NETWORK', message: NETWORK_MESSAGE, network: true })
  }
  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    const error = errorFromBody(response.status, payload)
    if (response.status === 401 && error.code === 'UNAUTHORIZED') unauthorizedListener?.()
    throw error
  }
  let blob: Blob
  try {
    blob = await response.blob()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError({ status: 0, code: 'NETWORK', message: NETWORK_MESSAGE, network: true })
  }
  const type = response.headers.get('Content-Type') ?? blob.type
  return { blob, fileName: fileNameOf(response.headers.get('Content-Disposition'), options.fallbackName ?? 'file'), type, headers: response.headers }
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
