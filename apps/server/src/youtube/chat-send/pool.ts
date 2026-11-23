// 봇 계정 여럿 (D-YT-SEND-12): 계정 하나가 막혀도(SPOF) 감사가 멈추지 않고, 방송끼리는 동시에 올린다.
// - 방송(영상 ID)마다 계정 하나를 붙인다(처음 올릴 때 가장 적게 맡은 쉬지 않는 계정). 한 방송의 작성자가 자꾸 바뀌지 않게 그 뒤로 같은 계정.
//   보내기 간격은 계정마다(각 계정의 Pacer) — 다른 계정이 맡은 방송끼리는 기다리지 않는다.
// - 올라가지 않은 것이 확실한 실패만 다음 계정으로 넘긴다: auth(로그인 풀림 — 10분 쉼), rate(429 — 1분 쉼). 넘기면 그 방송을 새 계정에 붙인다.
//   blocked(유튜브가 서버 IP를 막음)는 계정 문제가 아니므로 모든 계정을 5분 쉬게 하고 blocked로 던진다(공식 API로 넘길 일 — D-YT-SEND-13).
//   거절(rejected — 400, 올라가지 않음)은 다음 계정으로 한 번 더: 다른 계정이 올리면 거절한 계정 탓(실물: 채널 없는 계정)이라 10분 쉬게 하고,
//   모두 거절하면 글 탓이라 아무도 쉬지 않고 rejected (D-YT-SEND-14).
//   응답을 모르는 실패(timeout·network·unverified·server)와 채팅 끝남(ended)은 다른 계정으로 넘기지 않고 그대로 던진다(두 번 올리지 않는다).
// - 쉬지 않는 계정이 없으면 보내지 않고 blocked.
// - 맡은 방송 수는 최근 HOLD_IDLE_MS 안에 올린 방송만 센다 (D-YT-SEND-23, 사용자 "왜 감사채팅 봇 계정이 라이브지니가 아니라 라이브지니-2야?"):
//   끝난 라이브도 그 계정이 맡은 것으로 남아(서버를 다시 켤 때까지) 다음 라이브가 1번 계정이 놀고 있는데도 2번으로 갔다(운영 2026-11-23 — 15:26 끝난 라이브가 1번을 잡아 16:03 라이브가 2번).
//   한동안 올리지 않은 방송은 다른 방송의 계정 고르기에서 빼, 쉬는 1번 계정이 늘 먼저 맡는다. 그 방송 자신은 다시 올릴 때 맡던 계정을 그대로 쓴다(작성자가 바뀌지 않게).
//   채팅이 끝났다(ended)는 답을 받으면 그 방송은 바로 놓는다.
// - 계정 쉼은 운영 로그(CHAT_SEND_ACCOUNT_DOWN, count = 계정 번호 1부터)로 남긴다. 쿠키·채널 ID는 남기지 않는다.
import type { LogSink } from '../../log.ts'
import type { Timer } from '../timer.ts'
import { ChatSendError, type AccountCheck, type ChatSender, type ChatSendResult, type ChatSendRouteName, type ChatSendTarget, type LoginState, type MultiAuthorSender, type RemoveHint } from './sender.ts'

export const AUTH_REST_MS = 10 * 60 * 1000
export const RATE_REST_MS = 60 * 1000
export const BLOCKED_REST_MS = 5 * 60 * 1000
/** 이만큼 올리지 않은 방송은 맡은 방송 수에 넣지 않는다 (D-YT-SEND-23) */
export const HOLD_IDLE_MS = 20 * 60 * 1000

interface Account {
  readonly sender: ChatSender
  readonly number: number
  restUntil: number
}

export class ChatSenderPool implements MultiAuthorSender {
  readonly route: ChatSendRouteName
  readonly needsLiveChatId: boolean
  readonly authorChannelId: string
  readonly authorChannelIds: readonly string[]
  readonly #accounts: Account[]
  readonly #timer: Timer
  /** 영상 ID → 맡은 계정 (메모리 — 서버를 다시 켜면 다시 고른다) */
  readonly #byVideo = new Map<string, Account>()
  /** 영상 ID → 마지막으로 올리려 한 때 (D-YT-SEND-23) */
  readonly #lastAt = new Map<string, number>()
  #log: LogSink | null = null

  constructor(senders: readonly ChatSender[], timer: Timer) {
    const first = senders[0]
    if (first === undefined) throw new Error('봇 계정이 하나도 없다')
    if (senders.some((sender) => sender.route !== first.route)) throw new Error('봇 계정은 모두 같은 길이어야 한다')
    if (new Set(senders.map((sender) => sender.authorChannelId)).size !== senders.length) throw new Error('봇 계정 채널이 겹친다')
    this.#accounts = senders.map((sender, index) => ({ sender, number: index + 1, restUntil: 0 }))
    this.#timer = timer
    this.route = first.route
    this.needsLiveChatId = first.needsLiveChatId
    this.authorChannelId = first.authorChannelId
    this.authorChannelIds = senders.map((sender) => sender.authorChannelId)
  }

  setLog(log: LogSink): void {
    this.#log = log
  }

  /** 지금 쉬지 않는 계정 수 (운영 상태·시험) */
  available(): number {
    const now = this.#timer.now()
    return this.#accounts.filter((account) => account.restUntil <= now).length
  }

  /** 그 방송을 맡은 계정의 채널 ID (시험·운영 상태) */
  assigned(videoId: string): string | null {
    return this.#byVideo.get(videoId)?.sender.authorChannelId ?? null
  }

  #release(videoId: string): void {
    this.#byVideo.delete(videoId)
    this.#lastAt.delete(videoId)
  }

  #rest(account: Account, ms: number, kind: string): void {
    account.restUntil = this.#timer.now() + ms
    for (const [video, holder] of this.#byVideo) if (holder === account) this.#byVideo.delete(video)
    this.#log?.({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: this.route, errorKind: kind, count: account.number })
  }

  /** 이 방송에 쓸 계정 차례: 맡은 계정(쉬지 않으면) → 나머지는 맡은 방송이 적은 순 */
  #order(videoId: string, tried: ReadonlySet<Account>): Account[] {
    const now = this.#timer.now()
    const ready = this.#accounts.filter((account) => account.restUntil <= now && !tried.has(account))
    // 다른 방송은 최근 HOLD_IDLE_MS 안에 올린 것만 센다 — 끝난 라이브가 계정을 잡고 있지 않게 (D-YT-SEND-23)
    const busy = (video: string) => video !== videoId && now - (this.#lastAt.get(video) ?? -Infinity) < HOLD_IDLE_MS
    const load = (account: Account) => [...this.#byVideo].filter(([video, holder]) => holder === account && busy(video)).length
    const held = this.#byVideo.get(videoId)
    const rest = ready.filter((account) => account !== held).sort((a, b) => load(a) - load(b) || a.number - b.number)
    return held !== undefined && ready.includes(held) ? [held, ...rest] : rest
  }

  async send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult> {
    const tried = new Set<Account>()
    // 거절(rejected)한 계정 — 다른 계정이 올리면 그 계정 탓(채널 없음 등)이라 쉬게 한다, 모두 거절하면 글 탓이라 아무도 쉬지 않는다 (D-YT-SEND-14)
    const rejectedBy: Account[] = []
    let rejected: ChatSendError | null = null
    for (;;) {
      const [account] = this.#order(target.videoId, tried)
      if (account === undefined) throw rejected ?? new ChatSendError('blocked')
      tried.add(account)
      // 보내기 전에 붙인다 — 같은 방송의 다음 감사가 같은 계정의 줄에 선다
      this.#byVideo.set(target.videoId, account)
      this.#lastAt.set(target.videoId, this.#timer.now())
      try {
        const result = await account.sender.send(target, text, signal)
        for (const bad of rejectedBy) this.#rest(bad, AUTH_REST_MS, 'rejected')
        // 쉬게 한 계정이 이 방송을 맡고 있었으면 지워졌다 — 올린 계정에 다시 붙인다
        this.#byVideo.set(target.videoId, account)
        return { ...result, authorChannelId: result.authorChannelId ?? account.sender.authorChannelId }
      } catch (error) {
        if (!(error instanceof ChatSendError)) throw error
        if (error.kind === 'rejected') {
          // 400 거절은 올라가지 않았다 — 다른 계정으로 한 번 더 (실물 2026-11-08: 채널이 없는 계정은 send_message가 400 badRequest)
          rejectedBy.push(account)
          rejected = error
          continue
        }
        if (error.kind === 'auth') this.#rest(account, AUTH_REST_MS, error.kind)
        else if (error.kind === 'rate') this.#rest(account, RATE_REST_MS, error.kind)
        else if (error.kind === 'blocked') {
          for (const each of this.#accounts) each.restUntil = this.#timer.now() + BLOCKED_REST_MS
          this.#byVideo.clear()
          this.#log?.({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: this.route, errorKind: 'blocked', count: 0 })
          throw error
        } else {
          // 채팅이 끝난 라이브는 계정을 놓는다 (D-YT-SEND-23)
          if (error.kind === 'ended') this.#release(target.videoId)
          throw error
        }
      }
    }
  }

  /**
   * 지우기 (D-THANKSFIX-03): 그 글을 올린 계정으로만 지운다(남의 글은 지울 수 없다) — 올린 계정을 모르면 그 방송을 맡은 계정.
   * 그 계정에 지우기가 없거나 찾을 수 없으면 rejected(지울 수 없음 — 발송함은 [수정]으로 올린다). 쉬는 계정이어도 지우기는 해 본다(올리기가 아니다)
   */
  async remove(target: ChatSendTarget, messageId: string, signal?: AbortSignal, hint?: RemoveHint): Promise<void> {
    const author = hint?.authorChannelId ?? null
    const account = author !== null ? this.#accounts.find((each) => each.sender.authorChannelId === author) : this.#byVideo.get(target.videoId)
    if (account?.sender.remove === undefined) throw new ChatSendError('rejected')
    await account.sender.remove(target, messageId, signal, hint)
  }

  /**
   * 봇 계정 로그인 확인 (D-YT-SEND-22, 읽기만): 계정마다 차례로. 풀린 계정은 보내기에서 풀린 것과 같이 쉬게 하고 운영 로그(CHAT_SEND_ACCOUNT_DOWN — 운영자 문자 알림),
   * 서버 막힘은 모든 계정을 쉬게 한다. 알 수 없음은 그대로 둔다. 로그인 확인이 없는 계정(browser)은 건너뛴다
   */
  async checkAccounts(): Promise<readonly AccountCheck[]> {
    const results: AccountCheck[] = []
    for (const account of this.#accounts) {
      const sender = account.sender as ChatSender & { checkLogin?: () => Promise<LoginState> }
      if (sender.checkLogin === undefined) continue
      const state = await sender.checkLogin()
      results.push({ number: account.number, state })
      if (state === 'auth') this.#rest(account, AUTH_REST_MS, 'auth')
      else if (state === 'blocked') {
        for (const each of this.#accounts) each.restUntil = this.#timer.now() + BLOCKED_REST_MS
        this.#byVideo.clear()
        this.#log?.({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: this.route, errorKind: 'blocked', count: 0 })
        break
      }
    }
    return results
  }

  async close(): Promise<void> {
    await Promise.all(this.#accounts.map((account) => account.sender.close()))
  }
}
