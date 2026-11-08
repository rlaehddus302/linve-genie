// innertube 길 (D-YT-SEND-02): YouTube.js(youtubei.js)의 LiveChat.sendMessage로 유튜브 웹 내부 API(/youtubei/v1/live_chat/send_message, WEB 클라이언트)를 부른다.
// - 로그인: 봇 계정의 유튜브 쿠키 머리글(SAPISID 포함 — YouTube.js가 SAPISIDHASH 인증 머리글을 만든다). OAuth는 TV 클라이언트만 되므로 쓰지 않는다.
// - 영상 정보(getInfo)를 부르지 않는다: 보내기 값(params)은 영상 ID와 방송 채널 ID만으로 만든다 — 플레이어·봇 확인 요청이 없다.
// - 세션은 이 기계에서 만든다(generate_session_locally) — 시작할 때 유튜브에 묻지 않는다.
// - 결과: 채팅 추가(AddChatItemAction)가 있으면 그 메시지 ID로 게시됨. 추가 확인 요구(RunAttestationCommand)만 있거나 아무것도 없으면 "모름"(unverified) —
//   함수가 돌아왔다고 게시됨으로 보지 않는다. 발송함은 다시 올리지 않고 수집기가 본 글로 확인한다.
// - HTTP 상태는 우리 fetch 감싸개가 직접 본다(YouTube.js 오류 글을 해석하지 않는다). 응답 본문·쿠키는 남기지 않는다.
import { Innertube, YT } from 'youtubei.js'
import type { Timer } from '../timer.ts'
import { ChatSendError, Pacer, failureOf, failureOfStatus, withTimeout, type ChatSender, type ChatSendResult, type ChatSendTarget, type LoginState } from './sender.ts'

/** 유튜브 웹 바탕 주소 (YouTube.js 안에 고정 — 시험은 fetch를 가짜 서버로 돌린다) */
export const INNERTUBE_BASE_URL = 'https://www.youtube.com'
/** 보내기 하나의 시간 제한 */
export const INNERTUBE_TIMEOUT_MS = 10_000
/** 보내기 사이 간격 (30초에 많아야 10개) */
export const INNERTUBE_GAP_MS = 3000

export interface InnertubeSenderOptions {
  /** 봇 계정의 유튜브 쿠키 머리글 (SAPISID·SID 등). 로그·오류에 넣지 않는다 */
  readonly cookie: string
  /** 봇 계정 채널 ID (UC…) */
  readonly authorChannelId: string
  readonly timer: Timer
  /** HTTP (기본 전역 fetch — 시험은 가짜 서버로 돌리는 fetch) */
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly gapMs?: number
}

const signedInCheck = /signed in/i

/** 유튜브가 서버(IP)를 막은 응답: 구글 /sorry 봇 확인으로 돌려보냄, 또는 JSON이 아닌(HTML) 429 — 계정 하나의 속도 제한(JSON 429)과 가른다 (D-YT-SEND-12) */
export function isBlockedResponse(response: Pick<Response, 'url' | 'status' | 'headers'>): boolean {
  let path: string
  try {
    path = new URL(response.url).pathname
  } catch {
    path = ''
  }
  if (path.startsWith('/sorry')) return true
  return response.status === 429 && (response.headers.get('content-type') ?? '').includes('text/html')
}

/**
 * Playwright 로그인 상태 JSON → 유튜브 쿠키 머리글 (D-YT-SEND-09). browser 길과 같은 로그인 파일 하나로 innertube 길도 쓴다.
 * youtube.com(과 그 아래)에 붙는 쿠키만, 끝난 쿠키는 뺀다. 값은 돌려주기만 하고 남기지 않는다
 */
export function cookieHeaderFromState(stateJson: string, nowSec: number): string {
  const state = JSON.parse(stateJson) as { cookies?: { name?: unknown; value?: unknown; domain?: unknown; expires?: unknown }[] }
  const pairs: string[] = []
  for (const cookie of state.cookies ?? []) {
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string') continue
    if (!/(^|\.)youtube\.com$/.test(cookie.domain.replace(/^\./, ''))) continue
    if (typeof cookie.expires === 'number' && cookie.expires > 0 && cookie.expires < nowSec) continue
    pairs.push(`${cookie.name}=${cookie.value}`)
  }
  return pairs.join('; ')
}

export class InnertubeChatSender implements ChatSender {
  readonly route = 'innertube' as const
  readonly needsLiveChatId = false
  readonly authorChannelId: string
  readonly #options: InnertubeSenderOptions
  readonly #pacer: Pacer
  #client: Promise<Innertube> | null = null
  /** 지금 보내는 요청의 signal과 마지막 HTTP 상태 (Pacer가 한 번에 하나만 보낸다) */
  #signal: AbortSignal | undefined
  #lastStatus: number | null = null
  /** 마지막 응답이 유튜브의 서버 막음 화면이었나 (/sorry로 돌려보냄·HTML 429) */
  #lastBlocked = false

  constructor(options: InnertubeSenderOptions) {
    if (!/SAPISID=/.test(options.cookie)) throw new Error('innertube 길에는 SAPISID가 든 유튜브 쿠키가 필요하다')
    this.#options = options
    this.authorChannelId = options.authorChannelId
    this.#pacer = new Pacer(options.timer, options.gapMs ?? INNERTUBE_GAP_MS)
  }

  #session(): Promise<Innertube> {
    if (this.#client !== null) return this.#client
    const base = this.#options.fetch ?? fetch
    const guarded = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const response = await base(input, { ...init, ...(this.#signal === undefined ? {} : { signal: this.#signal }) })
      this.#lastStatus = response.status
      this.#lastBlocked = isBlockedResponse(response)
      return response
    }) as typeof fetch
    this.#client = Innertube.create({
      cookie: this.#options.cookie,
      fetch: guarded,
      generate_session_locally: true,
      retrieve_innertube_config: false,
      retrieve_player: false,
      lang: 'ko',
      location: 'KR',
    })
    // 실패한 세션은 버리고 다음에 다시 만든다
    this.#client.catch(() => {
      this.#client = null
    })
    return this.#client
  }

  async send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult> {
    return this.#pacer.run(async () => {
      const requestSignal = withTimeout(this.#options.timeoutMs ?? INNERTUBE_TIMEOUT_MS, signal)
      this.#signal = requestSignal
      this.#lastStatus = null
      this.#lastBlocked = false
      try {
        const client = await this.#session()
        // getInfo 없이 보내기 값만 만든다 (LiveChat은 영상 ID·방송 채널 ID·actions만 쓴다)
        const chat = new YT.LiveChat({ basic_info: { id: target.videoId, channel_id: target.channelId }, actions: client.actions } as unknown as ConstructorParameters<typeof YT.LiveChat>[0])
        const actions = await chat.sendMessage(text)
        const added = actions.find((action) => action.type === 'AddChatItemAction') as { item?: { id?: unknown } } | undefined
        if (added !== undefined) {
          const id = added.item?.id
          return { messageId: typeof id === 'string' && id !== '' ? id : null }
        }
        // 추가 확인(RunAttestationCommand)만 왔다 — 올라갔는지 모른다
        throw new ChatSendError('unverified', this.#lastStatus)
      } catch (error) {
        if (error instanceof ChatSendError) throw error
        if (requestSignal.aborted) throw new ChatSendError('timeout')
        if (this.#lastBlocked) throw new ChatSendError('blocked', this.#lastStatus)
        const status = this.#lastStatus
        if (status !== null) {
          const failure = failureOfStatus(status)
          if (failure !== null) throw new ChatSendError(failure, status)
          // 200인데 채팅 추가가 없는 모양 (Unexpected response) — 유튜브가 받지 않았다
          throw new ChatSendError('rejected', status)
        }
        if (error instanceof Error && signedInCheck.test(error.message)) throw new ChatSendError('auth')
        throw failureOf(error)
      } finally {
        this.#signal = undefined
      }
    }, signal)
  }

  /**
   * 로그인 확인 (D-YT-SEND-22, 읽기만 — 유튜브에 아무것도 쓰지 않는다): 채널 전환기 계정 목록에 고른 계정이 있으면 로그인돼 있다.
   * 실물(2026-11-08): 풀린 쿠키는 200에 계정 없이 온다. 막힘·401·403은 그대로, 그 밖의 실패는 모름(unknown — 쉬게 하지 않는다)
   */
  async checkLogin(signal?: AbortSignal): Promise<LoginState> {
    return this.#pacer.run(async () => {
      const requestSignal = withTimeout(this.#options.timeoutMs ?? INNERTUBE_TIMEOUT_MS, signal)
      this.#signal = requestSignal
      this.#lastStatus = null
      this.#lastBlocked = false
      try {
        const client = await this.#session()
        const accounts = (await client.account.getInfo(true)) as readonly { is_selected?: unknown }[]
        return accounts.some((account) => account.is_selected === true) ? 'ok' : 'auth'
      } catch {
        if (this.#lastBlocked) return 'blocked'
        if (this.#lastStatus === 401 || this.#lastStatus === 403) return 'auth'
        return 'unknown'
      } finally {
        this.#signal = undefined
      }
    }, signal)
  }

  async close(): Promise<void> {
    this.#client = null
  }
}
