// 감사 채팅 다른 길로 올리기 (D-YT-SEND-01~08) — 공식 Data API(liveChatMessages.insert, 20단위)를 쓰지 않는 세 길의 공통 모양.
// - innertube: YouTube.js(youtubei.js)로 유튜브 웹이 쓰는 내부 API(/youtubei/v1/live_chat/send_message)를 부른다. 로그인 쿠키(봇 계정).
// - browser: 서버의 Chromium(Playwright)이 팝아웃 채팅 칸에 글을 넣고 보낸다. 저장해 둔 로그인 상태(봇 계정).
// - nightbot: Nightbot 공개 API(POST /1/channel/send)에 맡긴다. 보낸 사람은 Nightbot.
// 어느 길이든 발송함 실행기(outbox.ts)의 동의·채널·기한·엔진 상태 확인을 그대로 지난 뒤 "올리기" 한 번만 바꾼다.
// 실패는 ChatSendError의 종류(kind)로만 돌려준다 — 응답 본문·쿠키·토큰은 오류에 담지 않는다.
// 이 길들은 유튜브가 허락한 연동이 아니다(유튜브 약관 자동화 제한 — 비공식 API·브라우저 자동화). 운영자가 판매자를 골라 켤 때만 쓴다(기본 꺼짐).
import type { LogSink } from '../../log.ts'
import type { Timer } from '../timer.ts'

export type ChatSendRouteName = 'innertube' | 'browser' | 'nightbot' | 'official'

/** 어느 방송에 올리나 */
export interface ChatSendTarget {
  /** 유튜브 영상 ID (watch?v=) */
  readonly videoId: string
  /** 방송 채널 ID (UC…) — innertube가 보내기 값(params)에 넣는다 */
  readonly channelId: string
  /** 공식 채팅 ID (needsLiveChatId인 길만 — nightbot의 chatId) */
  readonly liveChatId: string
}

export interface ChatSendResult {
  /** 유튜브 메시지 ID (알면). nightbot은 알 수 없다 */
  readonly messageId: string | null
  /** 실제로 올린 계정의 채널 ID (봇 계정 여럿·공식 넘김 — 없으면 그 길의 authorChannelId) */
  readonly authorChannelId?: string
}

/**
 * 실패 종류.
 * timeout·network: 응답을 모름(올라갔을 수 있다) · unverified: 응답은 받았지만 올라갔는지 모름(추가 확인 요구·화면에 안 보임) ·
 * server: 5xx(올라갔을 수 있다) · rate: 속도 제한(429) · auth: 로그인·토큰을 쓸 수 없음 · ended: 채팅이 끝났거나 꺼짐 · rejected: 그 밖의 거절(올라가지 않았다) ·
 * blocked: 유튜브가 이 서버(IP)를 막음(봇 확인 /sorry·HTML 429) 또는 쓸 수 있는 봇 계정이 없음(올라가지 않았다)
 */
export type ChatSendFailure = 'timeout' | 'network' | 'unverified' | 'server' | 'rate' | 'auth' | 'ended' | 'rejected' | 'blocked'

/** 올라가지 않은 것이 확실한 실패 — 다른 계정·공식 API로 넘겨도 두 번 올라가지 않는다 (D-YT-SEND-12) */
export const NOT_POSTED: ReadonlySet<ChatSendFailure> = new Set<ChatSendFailure>(['auth', 'rate', 'blocked'])

export class ChatSendError extends Error {
  readonly kind: ChatSendFailure
  readonly status: number | null

  constructor(kind: ChatSendFailure, status: number | null = null) {
    super(`chat send ${kind}${status === null ? '' : ` ${String(status)}`}`)
    this.name = 'ChatSendError'
    this.kind = kind
    this.status = status
  }
}

/** HTTP 상태 → 실패 종류 (2xx는 null) */
export function failureOfStatus(status: number): ChatSendFailure | null {
  if (status >= 200 && status < 300) return null
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate'
  if (status >= 500) return 'server'
  return 'rejected'
}

/** fetch·브라우저 오류 → 실패 종류 (이미 ChatSendError면 그대로) */
export function failureOf(error: unknown): ChatSendError {
  if (error instanceof ChatSendError) return error
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return new ChatSendError('timeout')
  return new ChatSendError('network')
}

export interface ChatSender {
  readonly route: ChatSendRouteName
  /** 올리기 전에 공식 채팅 ID가 있어야 하는가 (없으면 발송함이 videos.list 1단위로 받는다) */
  readonly needsLiveChatId: boolean
  /** 이 길로 올린 글의 작성자 채널 ID — 수집기가 우리 감사 글로 거르고(찜으로 읽지 않음) 게시 확인에 쓴다 */
  readonly authorChannelId: string
  /** 글 하나를 올린다. 실패는 ChatSendError로 던진다. signal이 끊기면 멈춘다(timeout) */
  send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult>
  close(): Promise<void>
}

/** 발송함이 판매자마다 묻는 다른 길 */
export interface ChatSendRoute {
  /** 그 판매자의 실시간 채팅 감사를 이 길로 올리면 그 길, 아니면 null(공식) */
  senderFor(sellerId: string): ChatSender | null
  /** 그 판매자의 방송에서 우리 감사 글로 볼 작성자 (다른 길의 작성자 — 봇 계정 모두·공식 넘김 계정) */
  authorsFor(sellerId: string): readonly string[]
  /** 다른 길이 올리지 못했을 때(올라가지 않은 것이 확실할 때만) 넘길 길 (D-YT-SEND-13 — 봇 계정의 공식 API) */
  withFallback(fallback: ChatSender): ChatSendRoute
  /** 계정 쉼·넘김을 운영 로그로 */
  setLog(log: LogSink): void
  close(): Promise<void>
}

/** 여러 계정을 가진 길 (풀) — 모든 작성자를 안다 */
export interface MultiAuthorSender extends ChatSender {
  readonly authorChannelIds: readonly string[]
  setLog?(log: LogSink): void
}

const authorsOf = (sender: ChatSender): readonly string[] => ('authorChannelIds' in sender ? (sender as MultiAuthorSender).authorChannelIds : [sender.authorChannelId])

/**
 * 넘김 (D-YT-SEND-13): 먼저 primary로 올리고, 올라가지 않은 것이 확실한 실패(auth·rate·blocked)일 때만 fallback으로 한 번 더 올린다.
 * 응답을 모르는 실패(timeout·network·unverified·server)는 넘기지 않는다 — 두 번 올라가는 것보다 빠짐이 안전하다(D-Y1-06)
 */
export class FailoverSender implements MultiAuthorSender {
  readonly route: ChatSendRouteName
  readonly needsLiveChatId: boolean
  readonly authorChannelId: string
  readonly authorChannelIds: readonly string[]
  readonly #primary: ChatSender
  readonly #fallback: ChatSender
  #log: LogSink | null = null

  constructor(primary: ChatSender, fallback: ChatSender) {
    this.#primary = primary
    this.#fallback = fallback
    this.route = primary.route
    this.needsLiveChatId = primary.needsLiveChatId
    this.authorChannelId = primary.authorChannelId
    this.authorChannelIds = [...new Set([...authorsOf(primary), ...authorsOf(fallback)])]
  }

  setLog(log: LogSink): void {
    this.#log = log
    ;(this.#primary as MultiAuthorSender).setLog?.(log)
  }

  async send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult> {
    try {
      return await this.#primary.send(target, text, signal)
    } catch (error) {
      if (!(error instanceof ChatSendError) || !NOT_POSTED.has(error.kind)) throw error
      this.#log?.({ level: 'error', code: 'CHAT_SEND_FAILOVER', route: this.#primary.route, errorKind: error.kind })
      const result = await this.#fallback.send(target, text, signal)
      return { ...result, authorChannelId: result.authorChannelId ?? this.#fallback.authorChannelId }
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.#primary.close(), this.#fallback.close()])
  }
}

/** 고른 판매자(또는 모두 — '*')에게만 그 길을 쓴다 */
export function chatSendRoute(sender: ChatSender, sellers: readonly string[] | '*'): ChatSendRoute {
  const chosen = sellers === '*' ? null : new Set(sellers)
  const applies = (sellerId: string) => chosen === null || chosen.has(sellerId)
  return {
    senderFor: (sellerId) => (applies(sellerId) ? sender : null),
    authorsFor: (sellerId) => (applies(sellerId) ? authorsOf(sender) : []),
    withFallback: (fallback) => chatSendRoute(new FailoverSender(sender, fallback), sellers),
    setLog: (log) => (sender as MultiAuthorSender).setLog?.(log),
    close: () => sender.close(),
  }
}

/**
 * 보내기 간격 지키기: 한 길(한 계정·한 토큰)의 보내기를 차례로 줄 세우고, 앞 보내기가 끝난 때부터 gapMs가 지나야 다음을 보낸다.
 * 유튜브 일반 채팅은 30초에 11개까지(유튜브 고객센터) — 자체 계정 길은 3초(30초에 많아야 10개), Nightbot은 5초에 1번(api-docs.nightbot.tv).
 * signal이 끊기면 기다리던 차례를 놓고 timeout으로 던진다
 */
export class Pacer {
  readonly #timer: Timer
  readonly #gapMs: number
  #tail: Promise<void> = Promise.resolve()
  #lastAt = -Infinity

  constructor(timer: Timer, gapMs: number) {
    this.#timer = timer
    this.#gapMs = gapMs
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.#tail
    let release = () => {}
    this.#tail = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previous
      const wait = this.#lastAt + this.#gapMs - this.#timer.now()
      if (wait > 0) await this.#timer.sleep(wait, signal)
      if (signal?.aborted === true) throw new ChatSendError('timeout')
      try {
        return await work()
      } finally {
        this.#lastAt = this.#timer.now()
      }
    } finally {
      release()
    }
  }
}

/** 시간 제한과 바깥 signal을 합친다 */
export function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([timeout, signal])
}
