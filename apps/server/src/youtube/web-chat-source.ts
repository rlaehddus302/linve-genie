// 유튜브 웹 채팅 원천 (YT-11, D-YT-SRV-01·02·04·06·07·08) — 서버가 로그인 없이 공개 라이브의 전체 채팅을 읽는다(공식 Data API·할당량 없음).
// ChatSource 모양(D-YT-SRV-10): 지점 → 응답 묶음(메시지·지움·숨김)·다음 지점·끝 신호(다음 지점 없음)·다음 부름까지(timeoutMs)·오류.
// 기다리기·이어받기·기록·끝 확인은 수집기(collector.ts)가 한다.
// - 유튜브에 묻는 부분(공개 페이지·채팅 요청 → 응답 글)은 WebTransport 인터페이스 하나 뒤에 있다(AC7) — 맥 미니 일꾼으로 옮길 때 이것만 바꾼다.
//   기본 구현 HttpWebTransport: 사용자 에이전트는 평범한 데스크톱 브라우저 값 하나로 고정, 머리글은 그것과 본문 종류만(쿠키·로그인 없음),
//   요청 하나는 15초 안에 끝나지 않으면 실패, 본문은 8MB까지만 읽는다.
// - 계정·우회 없음(AC1): 로그인·쿠키·구글 토큰을 쓰지 않는다. 프록시·캡차·PO 토큰·지문 꾸미기 없음. 클라이언트 이름·판·익명 방문 값은 채팅 페이지가 알려 준 값을 쓰고
//   그 수집기 메모리에서만 다음 요청에 쓴다(저장·공유 없음 — 이 모듈은 값을 들고 있지 않는다).
// - 실패 종류(AC5): 막힘 BLOCKED(429·403·봇 확인·로그인 요구 화면·확인 페이지로 돌려보냄), 모르는 모양 UNKNOWN_SHAPE(JSON 아님·모양 다름·인기 채팅),
//   지점 거절 REJECTED(400·404), 연결 오류 NETWORK·TIMEOUT·HTTP(5xx 등). 오류에는 종류·HTTP 상태만 — 본문·지점·키는 담지 않는다.
// - 운영자 끄기(AC6): off면 유튜브에 아무 요청도 하지 않고 OFF 오류.
import { looksBlocked, parseChatPage, parseLiveChat, parseWatchPage, type ChatPage, type InnertubeSession, type LiveChatParse, type WatchPage } from './web-chat.ts'
import type { Timer } from './timer.ts'

/** 유튜브 웹 주소 (시험은 가짜 유튜브 웹 서버 주소를 넣는다) */
export const YOUTUBE_WEB_BASE_URL = 'https://www.youtube.com'
/** 평범한 데스크톱 브라우저 값 하나로 고정 */
export const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
/** 요청 하나의 시간 제한 (AC3) */
export const WEB_REQUEST_TIMEOUT_MS = 15_000
/** 응답 본문 상한 (방송 페이지 1.3MB 남짓) */
export const WEB_MAX_BYTES = 8 * 1024 * 1024
/** 다음 부름: 응답의 timeoutMs를 이 범위로 자른다 (AC3) */
export const WEB_MIN_WAIT_MS = 1000
export const WEB_MAX_WAIT_MS = 10_000
/** timeoutMs가 없거나 숫자가 아닐 때 */
export const WEB_DEFAULT_WAIT_MS = 5000
/** 실패 뒤 다시 부르기까지: 연결 오류·5xx·모르는 모양 (5·10·20·30초, 그 뒤 30초씩) */
export const WEB_FAILURE_BACKOFF_MS: readonly number[] = [5000, 10_000, 20_000, 30_000]
/** 막힘 (30·60·120·300초, 그 뒤 300초씩) */
export const WEB_BLOCKED_BACKOFF_MS: readonly number[] = [30_000, 60_000, 120_000, 300_000]

/** 다음 부름까지 (응답의 timeoutMs → 1~10초, 없으면 5초) */
export function nextWaitMs(timeoutMs: number | null): number {
  if (timeoutMs === null || !Number.isFinite(timeoutMs)) return WEB_DEFAULT_WAIT_MS
  return Math.min(WEB_MAX_WAIT_MS, Math.max(WEB_MIN_WAIT_MS, timeoutMs))
}

/** n번째(1부터) 이어진 실패 뒤 기다림 */
export function backoffMs(kind: 'BLOCKED' | 'OTHER', failures: number): number {
  const steps = kind === 'BLOCKED' ? WEB_BLOCKED_BACKOFF_MS : WEB_FAILURE_BACKOFF_MS
  return steps[Math.min(Math.max(failures, 1), steps.length) - 1] as number
}

export type WebChatFailure =
  /** 운영자가 껐다 */
  | 'OFF'
  /** 429·403·봇 확인·로그인 요구 화면 */
  | 'BLOCKED'
  /** 모르는 모양 */
  | 'UNKNOWN_SHAPE'
  /** 지점을 받지 않음 (400·404) */
  | 'REJECTED'
  | 'NETWORK'
  | 'TIMEOUT'
  /** 그 밖의 HTTP 오류 (5xx 등) */
  | 'HTTP'

/** 웹 채팅 오류. 본문·지점·키는 담지 않는다 */
export class WebChatError extends Error {
  readonly kind: WebChatFailure
  readonly status: number | null

  constructor(kind: WebChatFailure, status: number | null = null) {
    super(`youtube web ${kind}${status === null ? '' : ` ${String(status)}`}`)
    this.name = 'WebChatError'
    this.kind = kind
    this.status = status
  }
}

/** 유튜브에 묻는 요청 하나 (경로는 유튜브 웹 주소 아래 — 예: /watch?v=…) */
export interface WebRequest {
  readonly method: 'GET' | 'POST'
  readonly path: string
  /** POST 본문 (JSON 글) */
  readonly body?: string
}

export interface WebResponse {
  readonly status: number
  /** 돌려보낸 뒤의 최종 주소 (모르면 요청 주소) */
  readonly url: string
  readonly text: string
}

/**
 * 유튜브에 묻는 부분 (AC7). 연결이 안 되면 WebChatError(NETWORK), 시간 제한이면 TIMEOUT, 본문이 너무 크면 UNKNOWN_SHAPE를 던진다.
 * 상태 해석(막힘·거절)은 부르는 쪽이 한다 — 다른 구현(맥 미니 일꾼)도 상태·최종 주소·본문 글만 돌려주면 된다
 */
export interface WebTransport {
  request(request: WebRequest, signal?: AbortSignal): Promise<WebResponse>
}

/** 기본 구현: 이 서버에서 바로 HTTP (fetch) */
export class HttpWebTransport implements WebTransport {
  readonly #timer: Timer
  readonly #fetch: typeof fetch | undefined
  readonly #base: string

  constructor(options: { timer: Timer; fetch?: typeof fetch; baseUrl?: string }) {
    this.#timer = options.timer
    this.#fetch = options.fetch
    this.#base = (options.baseUrl ?? YOUTUBE_WEB_BASE_URL).replace(/\/$/, '')
  }

  async request(request: WebRequest, signal?: AbortSignal): Promise<WebResponse> {
    const url = `${this.#base}${request.path}`
    const controller = new AbortController()
    let timedOut = false
    const outer = () => controller.abort()
    if (signal?.aborted === true) controller.abort()
    signal?.addEventListener('abort', outer, { once: true })
    const timer = this.#timer.sleep(WEB_REQUEST_TIMEOUT_MS, controller.signal).then(() => {
      if (!controller.signal.aborted) {
        timedOut = true
        controller.abort()
      }
    })
    try {
      const headers: Record<string, string> = { 'User-Agent': DESKTOP_USER_AGENT, ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) }
      const response = await (this.#fetch ?? fetch)(url, { method: request.method, headers, ...(request.body === undefined ? {} : { body: request.body }), signal: controller.signal })
      const text = await readCapped(response)
      return { status: response.status, url: response.url === '' ? url : response.url, text }
    } catch (error) {
      if (error instanceof WebChatError) throw error
      throw new WebChatError(timedOut ? 'TIMEOUT' : 'NETWORK')
    } finally {
      signal?.removeEventListener('abort', outer)
      if (!controller.signal.aborted) controller.abort()
      await timer
    }
  }
}

/** 응답 하나 (지점 → 묶음) */
export type WebChatPoll = Extract<LiveChatParse, { kind: 'ok' }> | { readonly kind: 'no_contents' }

export interface WebChatSourceOptions {
  readonly transport: WebTransport
  readonly timer: Timer
  /** 운영자 끄기 스위치 (서버 시작 때 한 번 정한다) */
  readonly off?: boolean
}

/** 분당 요청 수를 세는 창 */
const RATE_WINDOW_MS = 60_000

export class WebChatSource {
  readonly #options: WebChatSourceOptions
  /** 최근 1분의 요청 시각 (분당 요청 수 — 운영 상태) */
  #recent: number[] = []

  constructor(options: WebChatSourceOptions) {
    this.#options = options
  }

  /** 운영자가 껐는가 */
  get off(): boolean {
    return this.#options.off === true
  }

  /** 최근 1분 동안 이 서버가 유튜브에 보낸 요청 수 */
  requestsPerMinute(): number {
    const since = this.#options.timer.now() - RATE_WINDOW_MS
    this.#recent = this.#recent.filter((at) => at > since)
    return this.#recent.length
  }

  async #send(request: WebRequest, signal?: AbortSignal): Promise<WebResponse> {
    if (this.off) throw new WebChatError('OFF')
    const now = this.#options.timer.now()
    this.#recent.push(now)
    if (this.#recent.length > 10_000) this.#recent = this.#recent.filter((at) => at > now - RATE_WINDOW_MS)
    const response = await this.#options.transport.request(request, signal)
    if (response.status === 429 || response.status === 403 || blockedRedirect(response.url)) throw new WebChatError('BLOCKED', response.status)
    return response
  }

  async #html(path: string, signal?: AbortSignal): Promise<string | null> {
    const { status, text } = await this.#send({ method: 'GET', path }, signal)
    if (status === 404) return null
    if (status < 200 || status >= 300) throw new WebChatError('HTTP', status)
    return text
  }

  /** 방송 페이지 → 상태·채널·제목·시작 시각 (BLOCKED·UNKNOWN_SHAPE는 상태로 돌려준다) */
  async page(videoId: string, signal?: AbortSignal): Promise<WatchPage> {
    const html = await this.#html(`/watch?v=${encodeURIComponent(videoId)}&hl=en`, signal)
    if (html === null) return { state: 'NOT_FOUND', videoId, channelId: null, channelTitle: null, title: null, startedAt: null }
    return parseWatchPage(html)
  }

  /** 채널의 지금(또는 예정) 공개 방송 — 채널 라이브 주소가 보여 주는 방송 페이지 (최근 채널 찾기, D-YT-SRV-03) */
  async channelLive(channelId: string, signal?: AbortSignal): Promise<WatchPage> {
    const html = await this.#html(`/channel/${encodeURIComponent(channelId)}/live?hl=en`, signal)
    if (html === null) return { state: 'NOT_FOUND', videoId: null, channelId, channelTitle: null, title: null, startedAt: null }
    return parseWatchPage(html)
  }

  /** 채팅 페이지 → 호출 정보·전체 채팅 첫 지점 */
  async chatPage(videoId: string, signal?: AbortSignal): Promise<ChatPage> {
    const html = await this.#html(`/live_chat?v=${encodeURIComponent(videoId)}&is_popout=1&hl=en`, signal)
    if (html === null) return { state: 'NO_CHAT', session: null, continuation: null }
    return parseChatPage(html)
  }

  /**
   * 지점 하나로 get_live_chat (POST). 400·404 → REJECTED, 429·403 → BLOCKED, 그 밖 HTTP 오류 → HTTP, JSON이 아니거나 모양을 모르면 UNKNOWN_SHAPE.
   * 채팅 내용이 없는 응답(no_contents)은 그대로 돌려준다 — 끝났는지 방송 페이지로 다시 볼 일이다
   */
  async poll(session: InnertubeSession, continuation: string, signal?: AbortSignal): Promise<WebChatPoll> {
    const query = `prettyPrint=false${session.apiKey === null ? '' : `&key=${encodeURIComponent(session.apiKey)}`}`
    const client = { clientName: session.clientName, clientVersion: session.clientVersion, hl: 'en', ...(session.visitorData === null ? {} : { visitorData: session.visitorData }) }
    const { status, text } = await this.#send({ method: 'POST', path: `/youtubei/v1/live_chat/get_live_chat?${query}`, body: JSON.stringify({ context: { client }, continuation }) }, signal)
    if (status === 400 || status === 404) throw new WebChatError('REJECTED', status)
    if (status < 200 || status >= 300) throw new WebChatError('HTTP', status)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new WebChatError(looksBlocked(text) ? 'BLOCKED' : 'UNKNOWN_SHAPE', status)
    }
    const parsed = parseLiveChat(json)
    if (parsed.kind === 'unknown_shape') throw new WebChatError('UNKNOWN_SHAPE', status)
    return parsed
  }
}

/** 막힘 화면으로 돌려보냈는가 (구글 /sorry/ · 동의 확인 페이지) */
function blockedRedirect(finalUrl: string): boolean {
  try {
    const url = new URL(finalUrl)
    return url.pathname.startsWith('/sorry') || url.hostname === 'consent.youtube.com' || url.hostname === 'consent.google.com' || url.hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

/** 본문을 상한까지만 읽는다 (넘으면 모르는 모양) */
async function readCapped(response: Response): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let out = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > WEB_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new WebChatError('UNKNOWN_SHAPE', response.status)
      }
      out += decoder.decode(chunk.value, { stream: true })
    }
    return out + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}
