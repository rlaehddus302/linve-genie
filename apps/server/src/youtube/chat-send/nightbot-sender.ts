// nightbot 길 (D-YT-SEND-04): Nightbot 공개 API로 판매자 방송 채팅에 글을 올린다. 보낸 사람은 Nightbot이다.
// - POST {base}/1/channel/send, Authorization: Bearer <토큰>(권한 channel_send), 본문 {message, chatId}. chatId = 그 방송의 공식 채팅 ID —
//   비우면 그 채널의 모든 채팅방에 올라가므로 늘 넣는다(needsLiveChatId).
// - 5초에 1번(넘으면 429). 우리 쪽에서 5초 간격을 지킨다. 일일 총량은 문서에 없다.
// - 응답에 메시지 ID가 없다 — 게시됨은 200으로만 안다.
// - 토큰·응답 본문은 로그·오류에 넣지 않는다.
import type { Timer } from '../timer.ts'
import { ChatSendError, Pacer, failureOf, failureOfStatus, withTimeout, type ChatSender, type ChatSendResult, type ChatSendTarget } from './sender.ts'

export const NIGHTBOT_API_BASE = 'https://api.nightbot.tv'
/** 5초에 1번 (api-docs.nightbot.tv) */
export const NIGHTBOT_GAP_MS = 5000
export const NIGHTBOT_TIMEOUT_MS = 10_000
/** Nightbot 메시지 상한 (우리 실시간 채팅 감사는 200자로 나눠 둔다) */
export const NIGHTBOT_MAX_CHARS = 400

export interface NightbotSenderOptions {
  /** Nightbot OAuth 접근 토큰 (channel_send) */
  readonly token: string
  /** Nightbot이 유튜브 채팅에 글을 쓰는 채널 ID (UC…) — 수집기가 우리 감사 글로 거른다 */
  readonly authorChannelId: string
  readonly timer: Timer
  /** API 바탕 주소 (시험은 가짜 서버) */
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly gapMs?: number
  /**
   * 채팅 ID 없이 보내기 허용 (기본 false). Nightbot 문서는 chatId의 모양·얻는 곳을 적지 않는다 — 빼면 그 채널의 모든 채팅방에 올라간다.
   * 실물 시험 명령에서 방송이 하나뿐인 채널에만 쓴다
   */
  readonly allowAllChats?: boolean
}

/** 토큰 파일 → 접근 토큰 (글 그대로, 또는 nightbot-login이 적은 JSON {accessToken}) */
export function nightbotTokenFromFile(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('{')) return text
  const parsed = JSON.parse(text) as { accessToken?: unknown }
  return typeof parsed.accessToken === 'string' ? parsed.accessToken : ''
}

export class NightbotChatSender implements ChatSender {
  readonly route = 'nightbot' as const
  readonly needsLiveChatId = true
  readonly authorChannelId: string
  readonly #options: NightbotSenderOptions
  readonly #pacer: Pacer

  constructor(options: NightbotSenderOptions) {
    if (options.token.trim() === '') throw new Error('nightbot 길에는 토큰이 필요하다')
    this.#options = options
    this.authorChannelId = options.authorChannelId
    this.#pacer = new Pacer(options.timer, options.gapMs ?? NIGHTBOT_GAP_MS)
  }

  async send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult> {
    if (target.liveChatId === '' && this.#options.allowAllChats !== true) throw new ChatSendError('rejected')
    if ([...text].length > NIGHTBOT_MAX_CHARS) throw new ChatSendError('rejected')
    return this.#pacer.run(async () => {
      const requestSignal = withTimeout(this.#options.timeoutMs ?? NIGHTBOT_TIMEOUT_MS, signal)
      let response: Response
      try {
        response = await (this.#options.fetch ?? fetch)(`${this.#options.baseUrl ?? NIGHTBOT_API_BASE}/1/channel/send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.#options.token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(target.liveChatId === '' ? { message: text } : { message: text, chatId: target.liveChatId }),
          signal: requestSignal,
        })
        // 본문은 끝까지 읽어 연결을 돌려준다 (내용은 쓰지 않는다)
        await response.arrayBuffer()
      } catch (error) {
        if (requestSignal.aborted) throw new ChatSendError('timeout')
        throw failureOf(error)
      }
      const failure = failureOfStatus(response.status)
      if (failure !== null) throw new ChatSendError(failure, response.status)
      return { messageId: null }
    }, signal)
  }

  async close(): Promise<void> {}
}
