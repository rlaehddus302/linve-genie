// 서버 호출 (웹 apps/web/src/api/client.ts와 같은 약속 — 오류 모양·재시도·요청 번호). 세션은 서버 쿠키로만 다룬다(기기 쿠키 저장소,
// credentials: 'include') — 앱은 토큰을 읽거나 저장하지 않는다. 오류 종류(ApiError)·재시도(withRetry)·질의(withQuery)는 웹 것을 그대로 쓴다.
import { ApiError, NETWORK_MESSAGE, UNKNOWN_MESSAGE, errorFromBody } from '@livejjim/web/src/api/client.ts'
import { absoluteUrl, apiConfig } from './config.ts'

export { ApiError, NETWORK_MESSAGE, SAVE_FAILED_MESSAGE, UNKNOWN_MESSAGE, errorFromBody, isApiError, withQuery, withRetry, RETRY_DELAYS_MS } from '@livejjim/web/src/api/client.ts'
export type { RetryOptions } from '@livejjim/web/src/api/client.ts'

type Listener = () => void
let unauthorizedListener: Listener | null = null

/** 세션이 끝났을 때(어떤 API든 401 UNAUTHORIZED) 부를 처리기 → 로그인 화면으로 */
export function onUnauthorized(listener: Listener | null): void {
  unauthorizedListener = listener
}

export interface RequestOptions {
  readonly signal?: AbortSignal
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await apiConfig().fetch(absoluteUrl(path), {
      method,
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    if (isAbort(error)) throw error
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

export function patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PATCH', path, body, options)
}

/** 서버가 만든 바이트(라벨 그림 등) 받기 — 실패하면 JSON 오류 본문의 쉬운 문장으로 ApiError */
export async function getBytes(path: string, options: RequestOptions = {}): Promise<{ readonly bytes: Uint8Array; readonly type: string }> {
  let response: Response
  try {
    response = await apiConfig().fetch(absoluteUrl(path), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: '*/*' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    if (isAbort(error)) throw error
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
  const buffer = await response.arrayBuffer()
  return { bytes: new Uint8Array(buffer), type: response.headers.get('Content-Type') ?? 'application/octet-stream' }
}

/** 요청 번호: 쓰기 버튼을 누를 때마다 새로 만든다 (서버 형식 영문·숫자·'-' 1~64자) */
export function newRequestId(): string {
  return apiConfig().newId()
}
