// 서버 호출 (웹 apps/web/src/api/client.ts와 같은 약속 — 오류 모양·재시도·요청 번호). 세션은 서버 쿠키로만 다룬다(기기 쿠키 저장소,
// credentials: 'include') — 앱은 토큰을 읽거나 저장하지 않는다. 오류 종류(ApiError)·재시도(withRetry)·질의(withQuery)는 웹 것을 그대로 쓴다.
import { ApiError, NETWORK_MESSAGE, UNKNOWN_MESSAGE, errorFromBody } from '@livejjim/web/src/api/client.ts'
import { absoluteUrl, apiConfig, appOrigin } from './config.ts'

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

/**
 * 같이 본 라이브 하나만 보는 중 (D-SHARE-LIVE-04): 지난 라이브의 "같이 봄" 줄을 눌러 연 라이브 화면 동안만 그 방송 ID를 X-Live-View로 보낸다.
 * 서버는 그 요청만 방송 주인 가게의 것으로 처리한다 — 내 가게·홈은 그대로
 */
let liveView: string | null = null
export function setLiveView(broadcastId: string | null): void {
  liveView = broadcastId
}
export function currentLiveView(): string | null {
  return liveView
}
/** 내 정보·로그인·같이 보기 경로에는 붙이지 않는다 */
function viewHeader(path: string): Record<string, string> {
  if (liveView === null || /^\/api\/(me|login|logout|live-join|stream)\b/.test(path)) return {}
  return { 'X-Live-View': liveView }
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await apiConfig().fetch(absoluteUrl(path), {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { Origin: appOrigin() }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...viewHeader(path) },
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

export function del<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('DELETE', path, body, options)
}

/** 서버가 만든 바이트(라벨 그림 등) 받기 — 실패하면 JSON 오류 본문의 쉬운 문장으로 ApiError */
export async function getBytes(path: string, options: RequestOptions = {}): Promise<{ readonly bytes: Uint8Array; readonly type: string }> {
  let response: Response
  try {
    response = await apiConfig().fetch(absoluteUrl(path), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: '*/*', ...viewHeader(path) },
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
