// 라이브지니 서버 부르기 (X1 dev-notes "확장 경로 /ext/**"). 토큰은 Authorization 머리글로만 보내고, 응답·오류를 출력하지 않는다.
export interface ApiResult {
  /** HTTP 상태 (서버에 닿지 못하면 0) */
  readonly status: number
  readonly code: string | null
  readonly message: string | null
  readonly body: Record<string, unknown> | null
  /** 429의 Retry-After (밀리초) */
  readonly retryAfterMs: number | null
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export interface Api {
  call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<ApiResult>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const NETWORK = '라이브지니 서버에 닿지 못했어요. 인터넷 연결을 확인해 주세요.'

export function createApi(origin: string, token: () => string | null, fetcher: Fetch = (input, init) => fetch(input, init)): Api {
  return {
    async call(method, path, body) {
      const headers: Record<string, string> = { Accept: 'application/json' }
      const current = token()
      if (current !== null) headers['Authorization'] = `Bearer ${current}`
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      let response: Response
      try {
        response = await fetcher(`${origin}${path}`, { method, headers, cache: 'no-store', credentials: 'omit', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      } catch {
        return { status: 0, code: 'NETWORK', message: NETWORK, body: null, retryAfterMs: null }
      }
      const payload: unknown = await response.json().catch(() => null)
      const error = isRecord(payload) && isRecord(payload['error']) ? payload['error'] : null
      const retry = Number(response.headers.get('Retry-After'))
      return {
        status: response.status,
        code: error !== null && typeof error['code'] === 'string' ? error['code'] : null,
        message: error !== null && typeof error['message'] === 'string' ? error['message'] : null,
        body: isRecord(payload) ? payload : null,
        retryAfterMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : null,
      }
    },
  }
}
