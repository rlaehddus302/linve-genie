// 공식 API 넘김 길 (D-YT-SEND-13): 비공식 길이 막혔을 때(서버 IP 막힘·쓸 수 있는 봇 계정 없음) 봇 계정 이름 그대로 공식 Data API로 올린다.
// - 봇 계정의 구글 토큰은 앱의 "봇 판매자" 계정에 기존 유튜브 연결(OAuth, 게시 권한)로 이어 둔다 — 토큰은 다른 판매자처럼 암호화해 저장되고 새로 고침·폐기도 같다.
//   꺼내는 순간 연결 채널이 설정한 봇 채널과 다르면 올리지 않는다(withChannelToken).
// - 공식 채팅 ID는 회차에 적힌 것이 있으면 쓰고, 없으면 봇 토큰으로 videos.list 한 번(1단위) — 영상마다 이 서버 메모리에 기억한다.
// - 할당량은 봇 판매자 몫으로 센다(liveChatMessages.insert 20단위). 프로젝트 하루 1만 단위를 넘으면 quotaExceeded → rate(다시 시도).
// - 보내기 간격 1초(공식 API는 계정당 속도 제한 rateLimitExceeded가 있다).
import { ChannelMismatchError, YoutubeAccessError, type YoutubeConnections } from '../connect.ts'
import { GoogleError, POST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, type GoogleClient } from '../google.ts'
import type { Timer } from '../timer.ts'
import { ChatSendError, Pacer, type ChatSender, type ChatSendResult, type ChatSendTarget } from './sender.ts'

export const OFFICIAL_GAP_MS = 1000

export interface OfficialBotSenderOptions {
  readonly google: GoogleClient
  readonly connections: YoutubeConnections
  /** 봇 계정 구글 연결을 가진 앱 판매자 ID */
  readonly sellerId: string
  /** 봇 계정 채널 ID — 그 판매자의 연결 채널과 같아야 올린다 */
  readonly channelId: string
  readonly timer: Timer
  readonly gapMs?: number
}

/** 공식 API 오류 → 실패 종류 */
export function officialFailure(error: unknown): ChatSendError {
  if (error instanceof ChatSendError) return error
  if (error instanceof ChannelMismatchError || error instanceof YoutubeAccessError) return new ChatSendError('auth')
  if (!(error instanceof GoogleError)) return new ChatSendError('network')
  if (error.kind === 'timeout') return new ChatSendError('timeout')
  if (error.kind === 'network') return new ChatSendError('network')
  const reason = error.reason
  const status = error.status ?? 0
  if (reason === 'liveChatEnded' || reason === 'liveChatDisabled' || reason === 'liveChatNotFound') return new ChatSendError('ended', status)
  if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) return new ChatSendError('rate', status)
  if (reason === 'forbidden' || reason === 'insufficientPermissions' || status === 401) return new ChatSendError('auth', status)
  if (status >= 500) return new ChatSendError('server', status)
  return new ChatSendError('rejected', status)
}

export class OfficialBotSender implements ChatSender {
  readonly route = 'official' as const
  readonly needsLiveChatId = false
  readonly authorChannelId: string
  readonly #options: OfficialBotSenderOptions
  readonly #pacer: Pacer
  readonly #chatIds = new Map<string, string>()

  constructor(options: OfficialBotSenderOptions) {
    this.#options = options
    this.authorChannelId = options.channelId
    this.#pacer = new Pacer(options.timer, options.gapMs ?? OFFICIAL_GAP_MS)
  }

  async send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult> {
    const { google, connections, sellerId, channelId } = this.#options
    return this.#pacer.run(async () => {
      try {
        return await connections.withChannelToken(sellerId, channelId, async (token) => {
          let chatId = target.liveChatId !== '' ? target.liveChatId : (this.#chatIds.get(target.videoId) ?? '')
          if (chatId === '') {
            const body = await google.api({ sellerId, method: 'videos.list', accessToken: token, path: '/videos', query: { part: 'liveStreamingDetails', id: target.videoId }, timeoutMs: REQUEST_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) })
            const items = (Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[]
            const details = (items.find((item) => item.id === target.videoId)?.liveStreamingDetails ?? {}) as Record<string, unknown>
            chatId = typeof details.activeLiveChatId === 'string' ? details.activeLiveChatId : ''
            // 채팅 ID가 없다 — 끝났거나 채팅이 꺼졌다(아무것도 올리지 않았다)
            if (chatId === '') throw new ChatSendError('ended')
            this.#chatIds.set(target.videoId, chatId)
          }
          const body = await google.api({
            sellerId,
            method: 'liveChatMessages.insert',
            accessToken: token,
            httpMethod: 'POST',
            path: '/liveChat/messages',
            query: { part: 'snippet' },
            body: { snippet: { liveChatId: chatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } },
            timeoutMs: POST_TIMEOUT_MS,
            ...(signal === undefined ? {} : { signal }),
          })
          return { messageId: typeof body.id === 'string' && body.id !== '' ? body.id : null, authorChannelId: channelId }
        })
      } catch (error) {
        throw officialFailure(error)
      }
    }, signal)
  }

  async close(): Promise<void> {
    this.#chatIds.clear()
  }
}
