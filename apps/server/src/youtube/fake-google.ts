// 가짜 구글·유튜브 서버 (AC-Y1-80, D-Y13). 127.0.0.1에서만 연다. 실제 어댑터는 주소만 바꿔 이 서버를 부른다 — 같은 통신 방식(HTTP·JSON·스트림).
// - OAuth: 승인 화면 대신 바로 돌려보내기(허락·거절), 토큰(코드 교환 — PKCE S256 검사), 새로 고침, 폐기.
// - Data API: channels.list · liveBroadcasts.list · videos.list · liveChatMessages.list·insert·streamList · commentThreads.list·insert.
//   응답 모양은 실제 API 문서의 필드 이름을 쓴다(snippet·authorDetails·textMessageDetails·nextPageToken·pollingIntervalMillis·offlineAt …).
// - 시험 조작: 채널·브랜드 채널·방송(진행 중·예정·끝남, 채팅 꺼짐) 만들기, 예정 방송 시작하기, 시청자 메시지·슈퍼챗·멤버십 축하·삭제·차단 넣기, 채팅 끝내기,
//   오류 넣기(5xx·429·rateLimitExceeded·quotaExceeded·응답 없음·게시는 받고 응답 없음·스트림 중간 끊김·pageTokenInvalid·invalid_grant·liveChatEnded),
//   스트림이 응답 하나만 주고 닫히기(streamOnce), 게시한 글을 조회(list)에 늦게 보이기(postsHiddenForMs),
//   지점 없는 요청(list·streamList)은 실제 API처럼 최근 메시지(backlogSize개)부터 주고, 스트림은 연결하면 첫 응답 묶음(새 메시지가 없으면 빈 묶음)을 바로 쓴다,
//   게시된 메시지·댓글·호출 횟수·호출 시각 보기. 우리 채널이 게시한 메시지는 그 채팅에 작성자 = 우리 채널로 다시 나온다(AC-Y1-26).
// - 같은 프로세스의 시험은 메서드로, 다른 프로세스(E2E·화면 시험)는 /_fake/* JSON 경로로 조작한다(dev-notes "화면(I3)에게").
import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

export const FAKE_HOST = '127.0.0.1'

/** 가짜가 세는 호출 종류 (OAuth 포함 — 우리 서버는 OAuth를 할당량으로 세지 않는다) */
export type FakeMethod =
  | 'oauth.auth'
  | 'oauth.token'
  | 'oauth.refresh'
  | 'oauth.revoke'
  | 'channels.list'
  | 'liveBroadcasts.list'
  | 'videos.list'
  | 'liveChatMessages.list'
  | 'liveChatMessages.streamList'
  | 'liveChatMessages.insert'
  | 'commentThreads.list'
  | 'commentThreads.insert'

/** 넣을 수 있는 오류 */
export type FakeFault =
  /** HTTP 오류 (reason은 구글 오류 이유 — 예: quotaExceeded·rateLimitExceeded·liveChatEnded·pageTokenInvalid·invalid_grant) */
  | { readonly status: number; readonly reason?: string }
  /** 응답 없음 (연결을 열어 둔 채 답하지 않는다) */
  | { readonly kind: 'hang' }
  /** 게시는 받아들이고(채팅에 올라감) 응답은 주지 않는다 */
  | { readonly kind: 'acceptHang' }
  /** 스트림: 묶음 중간에 끊는다 (응답 일부를 쓰고 연결을 끊음) */
  | { readonly kind: 'cut' }
  /** 연결을 바로 끊는다 (네트워크 오류) */
  | { readonly kind: 'reset' }

/**
 * 바뀜 알림 (observe — 가짜 유튜브 웹 다리 등 시험 도구가 따라 비춘다). 동기로, 바뀐 순서대로 부른다.
 * broadcast: 방송이 생기거나 상태가 바뀜(시작·채팅 끝·채팅 끔), message: 채팅에 한 줄 들어감(시청자 글·삭제·차단·우리 insert 모두)
 */
export type FakeGoogleChange =
  | {
      readonly kind: 'broadcast'
      readonly broadcast: FakeBroadcast
      /** 방송 채널 이름 (가짜에 없는 채널이면 빈 글 — videos.list와 같음) */
      readonly channelTitle: string
      /** 채팅이 없거나 꺼짐 */
      readonly chatDisabled: boolean
      /** 채팅이 끝남 (endChat) */
      readonly chatEnded: boolean
    }
  | { readonly kind: 'message'; readonly liveChatId: string; readonly videoId: string; readonly message: FakeChatMessage }

export interface FakeChannel {
  readonly id: string
  readonly title: string
  readonly account: string
}

export interface FakeBroadcast {
  readonly videoId: string
  readonly channelId: string
  title: string
  /** live · upcoming · complete */
  status: 'live' | 'upcoming' | 'complete'
  liveChatId: string | null
  scheduledStartTime: string | null
  actualStartTime: string | null
  actualEndTime: string | null
}

export interface FakeChatMessage {
  readonly id: string
  readonly type: string
  readonly publishedAt: string
  readonly authorChannelId: string
  readonly displayName: string
  readonly isChatOwner: boolean
  readonly isChatModerator: boolean
  readonly isChatSponsor: boolean
  readonly text: string | null
  readonly userComment: string | null
  readonly deletedMessageId: string | null
  readonly bannedChannelId: string | null
  readonly bannedDisplayName: string | null
  readonly banType: 'permanent' | 'temporary' | null
  readonly banDurationSeconds: number | null
}

interface Chat {
  readonly id: string
  readonly videoId: string
  readonly channelId: string
  readonly messages: FakeChatMessage[]
  endedAt: string | null
  disabled: boolean
}

interface Grant {
  readonly account: string
  readonly channel: string | null
  readonly scopes: readonly string[]
}

interface AccessToken extends Grant {
  readonly refresh: string | null
  revoked: boolean
}

interface AuthCode extends Grant {
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  used: boolean
}

export interface FakeComment {
  readonly id: string
  readonly videoId: string
  readonly authorChannelId: string
  readonly text: string
  readonly publishedAt: string
}

export interface FakeApproval {
  /** 승인할 구글 계정 (기본: 마지막으로 만든 계정) */
  readonly account?: string
  /** 그 계정에서 고를 채널 (기본: 계정의 첫 채널, 채널이 없으면 null) */
  readonly channel?: string
  /** 거절 (error=access_denied) */
  readonly deny?: boolean
  /** 요청한 권한 중 일부만 허락 (기본: 요청한 것 모두) */
  readonly grant?: readonly string[]
}

export interface FakeOptions {
  /** OAuth 클라이언트 ID·비밀 (기본 fake-client-id·fake-client-secret) */
  readonly clientId?: string
  readonly clientSecret?: string
  /** 게시 시각 기본값의 시계 (기본 실제 시계) */
  readonly now?: () => number
  /** 접근 토큰 유효 시간 (초, 기본 3600) */
  readonly expiresIn?: number
  /** 폴링 응답의 pollingIntervalMillis (기본 1000) */
  readonly pollingIntervalMillis?: number
  /** 한 응답에 담는 메시지 수 (기본 200) */
  readonly pageSize?: number
  /** 지점 없는 요청이 돌려주는 최근 메시지 수 (기본 2000) — 실제 API처럼 채팅 처음부터가 아니라 최근 것부터 준다 (RA-I3-001) */
  readonly backlogSize?: number
  /** 포트 (기본 0 = 빈 포트) */
  readonly port?: number
}

const API = '/youtube/v3'

const id = (prefix: string, bytes = 9) => `${prefix}${randomBytes(bytes).toString('base64url')}`
const json = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}
const googleError = (res: ServerResponse, status: number, reason: string, domain = 'youtube.api') =>
  json(res, status, { error: { code: status, message: reason, errors: [{ message: reason, domain, reason }] } })
const oauthError = (res: ServerResponse, status: number, error: string) => json(res, status, { error, error_description: error })

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** 한 메시지 → 실제 API의 liveChatMessage 리소스 */
function resource(chat: Chat, message: FakeChatMessage): Record<string, unknown> {
  const snippet: Record<string, unknown> = {
    type: message.type,
    liveChatId: chat.id,
    authorChannelId: message.authorChannelId,
    publishedAt: message.publishedAt,
    hasDisplayContent: message.type !== 'messageDeletedEvent',
    displayMessage: message.text ?? message.userComment ?? '',
  }
  if (message.type === 'textMessageEvent') snippet.textMessageDetails = { messageText: message.text ?? '' }
  if (message.type === 'superChatEvent') snippet.superChatDetails = { amountMicros: '1000000000', currency: 'KRW', amountDisplayString: '₩1,000', tier: 1, ...(message.userComment === null ? {} : { userComment: message.userComment }) }
  if (message.type === 'memberMilestoneChatEvent') snippet.memberMilestoneChatDetails = { memberMonth: 3, ...(message.userComment === null ? {} : { userComment: message.userComment }) }
  if (message.type === 'messageDeletedEvent') snippet.messageDeletedDetails = { deletedMessageId: message.deletedMessageId }
  if (message.type === 'userBannedEvent') {
    snippet.userBannedDetails = {
      bannedUserDetails: { channelId: message.bannedChannelId, displayName: message.bannedDisplayName },
      banType: message.banType,
      ...(message.banDurationSeconds === null ? {} : { banDurationSeconds: String(message.banDurationSeconds) }),
    }
  }
  return {
    kind: 'youtube#liveChatMessage',
    id: message.id,
    snippet,
    authorDetails: {
      channelId: message.authorChannelId,
      displayName: message.displayName,
      isChatOwner: message.isChatOwner,
      isChatModerator: message.isChatModerator,
      isChatSponsor: message.isChatSponsor,
      isVerified: false,
    },
  }
}

export class FakeGoogle {
  readonly clientId: string
  readonly clientSecret: string
  readonly #now: () => number
  readonly #expiresIn: number
  readonly #server: Server
  readonly #sockets = new Set<Socket>()
  readonly #events = new EventEmitter()
  #url = ''
  pollingIntervalMillis: number
  pageSize: number
  /** 지점 없는 요청(list·streamList)이 돌려주는 최근 메시지 수 — 채팅이 이보다 길면 앞부분은 지점 없이 볼 수 없다 (실제 API, RA-I3-001) */
  backlogSize: number
  /** 스트림을 열면 새 메시지가 없어도 첫 응답 묶음(빈 items·nextPageToken)을 바로 쓴다 (실제 streamList, 기본 켬 — 끄면 메시지가 올 때까지 묶음 없음, AC-I3-24) */
  streamGreeting = true

  readonly #accounts: string[] = []
  readonly #channels = new Map<string, FakeChannel>()
  readonly #broadcasts = new Map<string, FakeBroadcast>()
  readonly #chats = new Map<string, Chat>()
  readonly #codes = new Map<string, AuthCode>()
  readonly #access = new Map<string, AccessToken>()
  readonly #refresh = new Map<string, Grant & { revoked: boolean }>()
  readonly #faults = new Map<FakeMethod, FakeFault[]>()
  readonly #calls = new Map<FakeMethod, number>()
  readonly comments: FakeComment[] = []
  /** 우리가 게시한(insert로 받은) 메시지 */
  readonly posted: { readonly liveChatId: string; readonly id: string; readonly text: string; readonly authorChannelId: string }[] = []
  /** 채팅을 읽은 기록 (liveChatMessages.list·streamList — 어느 채널의 토큰으로 어느 채팅을 읽었나, INV1 초대 방송 시험) */
  readonly chatReads: { readonly liveChatId: string; readonly channel: string | null }[] = []
  /** 다음 승인 화면의 선택 */
  approval: FakeApproval = {}
  /** 폐기 요청으로 받은 토큰 수 */
  revoked = 0
  /** 지금 열린 스트림 수 (채팅 ID별) */
  readonly openStreams = new Map<string, number>()
  /** 받은 Data API 호출의 종류·시각 (가짜 시계 — 호출 간격 시험, AC-Y1-94) */
  readonly callTimes: { readonly method: FakeMethod; readonly at: number }[] = []
  /** 스트림이 응답 하나(메시지가 없으면 빈 응답)를 주고 바로 정상으로 닫힌다 (AC-Y1-94) */
  streamOnce = false
  /** 우리가 게시한 메시지·댓글을 조회(liveChatMessages.list·commentThreads.list)에 이만큼 늦게 보인다 (밀리초, AC-Y1-96).
   * 폴링 수집기도 list를 쓰므로 그사이 폴링한 수집기는 그 글을 받지 못한다 — 수집기 없는 게시 확인 시험에만 쓴다 */
  postsHiddenForMs = 0
  readonly #insertedAt = new Map<string, number>()
  readonly #holds = new Map<FakeMethod, { readonly count: number; readonly waiting: (() => void)[] }>()
  readonly #observers = new Set<(change: FakeGoogleChange) => void>()
  #controlExtension: ((method: string, path: string, input: Record<string, unknown>, query: URLSearchParams) => unknown) | null = null

  private constructor(options: FakeOptions) {
    this.clientId = options.clientId ?? 'fake-client-id'
    this.clientSecret = options.clientSecret ?? 'fake-client-secret'
    this.#now = options.now ?? (() => Date.now())
    this.#expiresIn = options.expiresIn ?? 3600
    this.pollingIntervalMillis = options.pollingIntervalMillis ?? 1000
    this.pageSize = options.pageSize ?? 200
    this.backlogSize = options.backlogSize ?? 2000
    this.#events.setMaxListeners(0)
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch(() => {
        if (!res.headersSent) googleError(res, 500, 'backendError')
        else res.destroy()
      })
    })
    this.#server.on('connection', (socket: Socket) => {
      this.#sockets.add(socket)
      socket.on('close', () => this.#sockets.delete(socket))
    })
  }

  /** 127.0.0.1의 빈 포트(또는 정한 포트)에서 연다 */
  static async start(options: FakeOptions = {}): Promise<FakeGoogle> {
    const fake = new FakeGoogle(options)
    await new Promise<void>((resolve, reject) => {
      fake.#server.once('error', reject)
      fake.#server.listen(options.port ?? 0, FAKE_HOST, () => resolve())
    })
    const address = fake.#server.address()
    if (typeof address !== 'object' || address === null) throw new Error('가짜 서버 주소를 알 수 없다')
    fake.#url = `http://${FAKE_HOST}:${String(address.port)}`
    return fake
  }

  get url(): string {
    return this.#url
  }

  get port(): number {
    return Number(new URL(this.#url).port)
  }

  /** 우리 서버 설정에 넣을 주소들 */
  endpoints(): { authUrl: string; tokenUrl: string; revokeUrl: string; apiBase: string } {
    return { authUrl: `${this.#url}/o/oauth2/v2/auth`, tokenUrl: `${this.#url}/token`, revokeUrl: `${this.#url}/revoke`, apiBase: `${this.#url}${API}` }
  }

  async close(): Promise<void> {
    this.#events.emit('close')
    for (const socket of this.#sockets) socket.destroy()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
  }

  // ── 시험 조작 ────────────────────────────────────────────────────────

  /** 구글 계정 하나 */
  addAccount(): string {
    const account = id('acct_')
    this.#accounts.push(account)
    return account
  }

  /** 계정의 채널(브랜드 채널 포함) 하나. 채널 ID는 실제처럼 `UC` + 22자 */
  addChannel(account: string, title = '내 채널', channelId?: string): FakeChannel {
    const channel: FakeChannel = { id: channelId ?? `UC${randomBytes(17).toString('base64url').slice(0, 22)}`, title, account }
    this.#channels.set(channel.id, channel)
    return channel
  }

  /** 방송 하나 (영상 ID 11자). 채팅이 꺼져 있으면 liveChatId가 없다 */
  addBroadcast(
    channelId: string,
    options: { title?: string; status?: 'live' | 'upcoming' | 'complete'; chat?: boolean; scheduledStartTime?: string; actualStartTime?: string; videoId?: string } = {},
  ): FakeBroadcast {
    const status = options.status ?? 'live'
    const videoId = options.videoId ?? randomBytes(9).toString('base64url').slice(0, 11)
    const chatId = options.chat === false || status === 'complete' ? null : `chat_${videoId}`
    const broadcast: FakeBroadcast = {
      videoId,
      channelId,
      title: options.title ?? '라이브',
      status,
      liveChatId: chatId,
      scheduledStartTime: options.scheduledStartTime ?? new Date(this.#now()).toISOString(),
      actualStartTime: status === 'upcoming' ? null : (options.actualStartTime ?? new Date(this.#now()).toISOString()),
      actualEndTime: status === 'complete' ? new Date(this.#now()).toISOString() : null,
    }
    this.#broadcasts.set(videoId, broadcast)
    if (chatId !== null) this.#chats.set(chatId, { id: chatId, videoId, channelId, messages: [], endedAt: null, disabled: false })
    this.#broadcastChanged(broadcast)
    return broadcast
  }

  /** 채팅을 끈다 (그 뒤 호출은 liveChatDisabled) */
  disableChat(liveChatId: string): void {
    const chat = this.#chat(liveChatId)
    chat.disabled = true
    this.#events.emit(`chat:${liveChatId}`)
    const broadcast = this.#broadcasts.get(chat.videoId)
    if (broadcast !== undefined) this.#broadcastChanged(broadcast)
  }

  /** 채팅을 끝낸다 (응답에 offlineAt, 그 뒤 호출은 liveChatEnded) */
  endChat(liveChatId: string): void {
    const chat = this.#chat(liveChatId)
    chat.endedAt = new Date(this.#now()).toISOString()
    const broadcast = this.#broadcasts.get(chat.videoId)
    if (broadcast !== undefined) {
      broadcast.status = 'complete'
      broadcast.actualEndTime = chat.endedAt
    }
    this.#events.emit(`chat:${liveChatId}`)
    if (broadcast !== undefined) this.#broadcastChanged(broadcast)
  }

  /** 예정 방송을 시작한다 (진행 중, 실제 시작 시각 = at 또는 지금) — AC-Y1-94 */
  startBroadcast(videoId: string, at?: number): FakeBroadcast {
    const broadcast = this.#broadcasts.get(videoId)
    if (broadcast === undefined) throw new Error('없는 방송')
    broadcast.status = 'live'
    broadcast.actualStartTime = new Date(at ?? this.#now()).toISOString()
    this.#broadcastChanged(broadcast)
    return broadcast
  }

  /**
   * 바뀜을 따라 듣는다 (시험 도구 — 가짜 유튜브 웹 다리). replay면 지금 있는 방송·메시지를 먼저 그 순서대로 알린다. 그만 듣기 함수를 돌려준다.
   * 가짜의 응답·동작은 바꾸지 않는다
   */
  observe(listener: (change: FakeGoogleChange) => void, options: { readonly replay?: boolean } = {}): () => void {
    if (options.replay === true) {
      for (const broadcast of this.#broadcasts.values()) {
        listener(this.#broadcastChange(broadcast))
        const chat = broadcast.liveChatId === null ? undefined : this.#chats.get(broadcast.liveChatId)
        for (const message of chat?.messages ?? []) listener({ kind: 'message', liveChatId: chat?.id ?? '', videoId: broadcast.videoId, message })
      }
    }
    this.#observers.add(listener)
    return () => {
      this.#observers.delete(listener)
    }
  }

  /** /_fake/* 조작 경로를 더한다 (가짜가 모르는 경로만 이 함수로 — undefined를 돌려주면 404, 던지면 400). 시험 도구용, 하나만 */
  extendControl(handler: ((method: string, path: string, input: Record<string, unknown>, query: URLSearchParams) => unknown) | null): void {
    this.#controlExtension = handler
  }

  #broadcastChange(broadcast: FakeBroadcast): FakeGoogleChange {
    const chat = broadcast.liveChatId === null ? undefined : this.#chats.get(broadcast.liveChatId)
    return {
      kind: 'broadcast',
      broadcast,
      channelTitle: this.#channels.get(broadcast.channelId)?.title ?? '',
      chatDisabled: chat === undefined || chat.disabled,
      chatEnded: chat?.endedAt != null,
    }
  }

  #broadcastChanged(broadcast: FakeBroadcast): void {
    if (this.#observers.size === 0) return
    const change = this.#broadcastChange(broadcast)
    for (const listener of [...this.#observers]) listener(change)
  }

  #messageAdded(chat: Chat, message: FakeChatMessage): void {
    for (const listener of [...this.#observers]) listener({ kind: 'message', liveChatId: chat.id, videoId: chat.videoId, message })
  }

  #chat(liveChatId: string): Chat {
    const chat = this.#chats.get(liveChatId)
    if (chat === undefined) throw new Error('없는 채팅')
    return chat
  }

  /** 채팅 메시지 하나를 넣는다 (기본 일반 채팅). 메시지 ID를 돌려준다 */
  addMessage(
    liveChatId: string,
    input: {
      readonly author: string
      readonly name: string
      readonly text?: string
      readonly type?: 'textMessageEvent' | 'superChatEvent' | 'memberMilestoneChatEvent' | 'superStickerEvent' | 'newSponsorEvent' | 'pollEvent' | 'chatEndedEvent'
      readonly userComment?: string
      readonly publishedAt?: string | number
      readonly owner?: boolean
      readonly moderator?: boolean
      readonly sponsor?: boolean
      readonly id?: string
    },
  ): string {
    const chat = this.#chat(liveChatId)
    const message: FakeChatMessage = {
      id: input.id ?? id('msg_', 12),
      type: input.type ?? 'textMessageEvent',
      publishedAt: typeof input.publishedAt === 'string' ? input.publishedAt : new Date(input.publishedAt ?? this.#now()).toISOString(),
      authorChannelId: input.author,
      displayName: input.name,
      isChatOwner: input.owner ?? input.author === chat.channelId,
      isChatModerator: input.moderator ?? false,
      isChatSponsor: input.sponsor ?? false,
      text: (input.type ?? 'textMessageEvent') === 'textMessageEvent' ? (input.text ?? '') : null,
      userComment: input.userComment ?? null,
      deletedMessageId: null,
      bannedChannelId: null,
      bannedDisplayName: null,
      banType: null,
      banDurationSeconds: null,
    }
    chat.messages.push(message)
    this.#events.emit(`chat:${liveChatId}`)
    this.#messageAdded(chat, message)
    return message.id
  }

  /** 메시지 삭제 알림 (messageDeletedEvent) */
  deleteMessage(liveChatId: string, messageId: string): string {
    const chat = this.#chat(liveChatId)
    const target = chat.messages.find((message) => message.id === messageId)
    const event: FakeChatMessage = {
      id: id('del_', 12),
      type: 'messageDeletedEvent',
      publishedAt: new Date(this.#now()).toISOString(),
      authorChannelId: chat.channelId,
      displayName: '운영자',
      isChatOwner: true,
      isChatModerator: false,
      isChatSponsor: false,
      text: null,
      userComment: null,
      deletedMessageId: messageId,
      bannedChannelId: target?.authorChannelId ?? null,
      bannedDisplayName: null,
      banType: null,
      banDurationSeconds: null,
    }
    chat.messages.push(event)
    this.#events.emit(`chat:${liveChatId}`)
    this.#messageAdded(chat, event)
    return event.id
  }

  /** 유튜브 차단 알림 (userBannedEvent) */
  banUser(liveChatId: string, input: { readonly channelId: string; readonly name: string; readonly seconds?: number }): string {
    const chat = this.#chat(liveChatId)
    const event: FakeChatMessage = {
      id: id('ban_', 12),
      type: 'userBannedEvent',
      publishedAt: new Date(this.#now()).toISOString(),
      authorChannelId: chat.channelId,
      displayName: '운영자',
      isChatOwner: true,
      isChatModerator: false,
      isChatSponsor: false,
      text: null,
      userComment: null,
      deletedMessageId: null,
      bannedChannelId: input.channelId,
      bannedDisplayName: input.name,
      banType: input.seconds === undefined ? 'permanent' : 'temporary',
      banDurationSeconds: input.seconds ?? null,
    }
    chat.messages.push(event)
    this.#events.emit(`chat:${liveChatId}`)
    this.#messageAdded(chat, event)
    return event.id
  }

  /** 그 메서드의 다음 호출(들)에 오류를 넣는다 */
  fail(method: FakeMethod, fault: FakeFault, times = 1): void {
    const list = this.#faults.get(method) ?? []
    for (let i = 0; i < times; i++) list.push(fault)
    this.#faults.set(method, list)
  }

  /** 그 메서드의 다음 count번 호출을 모두 도착할 때까지 붙잡았다가 함께 처리한다 (동시 요청 경합 시험, AC-Y1-98) */
  hold(method: FakeMethod, count: number): void {
    this.#holds.set(method, { count, waiting: [] })
  }

  /** 열린 스트림을 모두 끊는다 (네트워크 끊김) */
  dropStreams(): void {
    this.#events.emit('drop')
  }

  /** 넣어 둔 오류를 모두 지운다 */
  clearFaults(): void {
    this.#faults.clear()
  }

  /** 받은 호출 수 (메서드별) */
  calls(method?: FakeMethod): number {
    if (method !== undefined) return this.#calls.get(method) ?? 0
    let total = 0
    for (const count of this.#calls.values()) total += count
    return total
  }

  callCounts(): Record<string, number> {
    return Object.fromEntries(this.#calls)
  }

  resetCalls(): void {
    this.#calls.clear()
  }

  /** 채팅의 메시지 전부 (우리 게시 포함) */
  messages(liveChatId: string): readonly FakeChatMessage[] {
    return this.#chat(liveChatId).messages
  }

  /** 접근 토큰을 무효로 (다음 호출이 401) */
  expireAccessTokens(): void {
    for (const token of this.#access.values()) token.revoked = true
  }

  /** 새로 고침 토큰을 거둔다 (사용자가 권한을 거둠 → invalid_grant) */
  revokeAll(): void {
    for (const token of this.#refresh.values()) token.revoked = true
    for (const token of this.#access.values()) token.revoked = true
  }

  /** 시험이 넣은 토큰 문자열 전부 (데이터베이스·로그에서 찾기) */
  issuedTokens(): string[] {
    return [...this.#access.keys(), ...this.#refresh.keys()]
  }

  /** 발급한 코드 전부 */
  issuedCodes(): string[] {
    return [...this.#codes.keys()]
  }

  // ── 요청 처리 ────────────────────────────────────────────────────────

  #count(method: FakeMethod): void {
    this.#calls.set(method, (this.#calls.get(method) ?? 0) + 1)
    this.callTimes.push({ method, at: this.#now() })
  }

  /** 조회(list)에 아직 보이지 않는 우리 게시물 (postsHiddenForMs) */
  #hidden(id: string): boolean {
    const at = this.#insertedAt.get(id)
    return at !== undefined && this.#now() < at + this.postsHiddenForMs
  }

  #fault(method: FakeMethod): FakeFault | undefined {
    const list = this.#faults.get(method)
    const fault = list?.shift()
    if (list !== undefined && list.length === 0) this.#faults.delete(method)
    return fault
  }

  /** 넣은 오류를 적용한다. 처리했으면 true (응답 없음은 연결을 붙잡아 둔다) */
  #applyFault(fault: FakeFault | undefined, req: IncomingMessage, res: ServerResponse): boolean {
    if (fault === undefined) return false
    if ('status' in fault) {
      if (fault.reason === 'invalid_grant') oauthError(res, fault.status, 'invalid_grant')
      else googleError(res, fault.status, fault.reason ?? (fault.status >= 500 ? 'backendError' : 'badRequest'))
      return true
    }
    if (fault.kind === 'reset') {
      req.socket.destroy()
      return true
    }
    if (fault.kind === 'hang') {
      this.#events.once('close', () => res.destroy())
      return true
    }
    return false
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.#url)
    const path = url.pathname
    if (path.startsWith('/_fake/')) return this.#control(req, res, path, url)
    if (req.method === 'GET' && path === '/o/oauth2/v2/auth') return this.#authorize(res, url)
    if (req.method === 'POST' && path === '/token') return this.#token(req, res)
    if (req.method === 'POST' && path === '/revoke') return this.#revoke(req, res, url)
    if (!path.startsWith(API)) return googleError(res, 404, 'notFound')
    const route = `${req.method ?? ''} ${path.slice(API.length)}`
    const method: FakeMethod | undefined = (
      {
        'GET /channels': 'channels.list',
        'GET /liveBroadcasts': 'liveBroadcasts.list',
        'GET /videos': 'videos.list',
        'GET /liveChat/messages': 'liveChatMessages.list',
        'GET /liveChat/messages/stream': 'liveChatMessages.streamList',
        'POST /liveChat/messages': 'liveChatMessages.insert',
        'GET /commentThreads': 'commentThreads.list',
        'POST /commentThreads': 'commentThreads.insert',
      } as Record<string, FakeMethod>
    )[route]
    if (method === undefined) return googleError(res, 404, 'notFound')
    this.#count(method)
    const hold = this.#holds.get(method)
    if (hold !== undefined) {
      await new Promise<void>((resolve) => {
        hold.waiting.push(resolve)
        if (hold.waiting.length < hold.count) return
        this.#holds.delete(method)
        for (const release of hold.waiting) release()
      })
    }
    const fault = this.#fault(method)
    const token = this.#bearer(req)
    if (fault !== undefined && 'kind' in fault && fault.kind !== 'acceptHang' && fault.kind !== 'cut') {
      this.#applyFault(fault, req, res)
      return
    }
    if (fault !== undefined && 'status' in fault) {
      this.#applyFault(fault, req, res)
      return
    }
    if (token === null) return googleError(res, 401, 'authError', 'global')
    switch (method) {
      case 'channels.list':
        return this.#channelsList(res, token)
      case 'liveBroadcasts.list':
        return this.#broadcastsList(res, token)
      case 'videos.list':
        return this.#videosList(res, url)
      case 'liveChatMessages.list':
        this.chatReads.push({ liveChatId: url.searchParams.get('liveChatId') ?? '', channel: token.channel })
        return this.#chatList(res, url)
      case 'liveChatMessages.streamList':
        this.chatReads.push({ liveChatId: url.searchParams.get('liveChatId') ?? '', channel: token.channel })
        return this.#chatStream(req, res, url, fault)
      case 'liveChatMessages.insert':
        return this.#chatInsert(req, res, token, fault)
      case 'commentThreads.list':
        return this.#commentsList(res, url)
      case 'commentThreads.insert':
        return this.#commentInsert(req, res, token, fault)
      default:
        return googleError(res, 404, 'notFound')
    }
  }

  #bearer(req: IncomingMessage): AccessToken | null {
    const header = req.headers.authorization ?? ''
    const match = /^Bearer (\S+)$/.exec(header)
    const token = match === null ? undefined : this.#access.get(match[1] ?? '')
    return token === undefined || token.revoked ? null : token
  }

  #authorize(res: ServerResponse, url: URL): void {
    this.#count('oauth.auth')
    const redirect = url.searchParams.get('redirect_uri') ?? ''
    const state = url.searchParams.get('state') ?? ''
    if (url.searchParams.get('client_id') !== this.clientId || redirect === '') return oauthError(res, 400, 'invalid_request')
    const back = new URL(redirect)
    if (state !== '') back.searchParams.set('state', state)
    const approval = this.approval
    if (approval.deny === true) {
      back.searchParams.set('error', 'access_denied')
      res.writeHead(302, { Location: back.toString() })
      res.end()
      return
    }
    if (url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256') return oauthError(res, 400, 'invalid_request')
    const challenge = url.searchParams.get('code_challenge') ?? ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return oauthError(res, 400, 'invalid_request')
    const account = approval.account ?? this.#accounts.at(-1) ?? this.addAccount()
    const channel = approval.channel ?? [...this.#channels.values()].find((item) => item.account === account)?.id ?? null
    const requested = (url.searchParams.get('scope') ?? '').split(' ').filter((scope) => scope !== '')
    const previously = url.searchParams.get('include_granted_scopes') === 'true' ? this.#previousScopes(account, channel) : []
    const granted = approval.grant === undefined ? requested : requested.filter((scope) => approval.grant?.includes(scope))
    const code = id('code_', 24)
    this.#codes.set(code, { account, channel, scopes: [...new Set([...previously, ...granted])], clientId: this.clientId, redirectUri: redirect, challenge, used: false })
    back.searchParams.set('code', code)
    res.writeHead(302, { Location: back.toString() })
    res.end()
  }

  #previousScopes(account: string, channel: string | null): string[] {
    const scopes = new Set<string>()
    for (const grant of this.#refresh.values()) if (!grant.revoked && grant.account === account && grant.channel === channel) for (const scope of grant.scopes) scopes.add(scope)
    return [...scopes]
  }

  async #token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req))
    const grantType = form.get('grant_type')
    this.#count(grantType === 'refresh_token' ? 'oauth.refresh' : 'oauth.token')
    const fault = this.#fault(grantType === 'refresh_token' ? 'oauth.refresh' : 'oauth.token')
    if (this.#applyFault(fault, req, res)) return
    if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret) return oauthError(res, 401, 'invalid_client')
    if (grantType === 'authorization_code') {
      const code = this.#codes.get(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      if (code === undefined || code.used || code.redirectUri !== form.get('redirect_uri')) return oauthError(res, 400, 'invalid_grant')
      code.used = true
      const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
      if (verifier.length < 43 || verifier.length > 128 || challenge !== code.challenge) return oauthError(res, 400, 'invalid_grant')
      const refresh = id('fake-rt-', 24)
      this.#refresh.set(refresh, { account: code.account, channel: code.channel, scopes: code.scopes, revoked: false })
      const access = id('fake-at-', 24)
      this.#access.set(access, { account: code.account, channel: code.channel, scopes: code.scopes, refresh, revoked: false })
      return json(res, 200, { access_token: access, expires_in: this.#expiresIn, refresh_token: refresh, scope: code.scopes.join(' '), token_type: 'Bearer' })
    }
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? ''
      const grant = this.#refresh.get(refreshToken)
      if (grant === undefined || grant.revoked) return oauthError(res, 400, 'invalid_grant')
      const access = id('fake-at-', 24)
      this.#access.set(access, { account: grant.account, channel: grant.channel, scopes: grant.scopes, refresh: refreshToken, revoked: false })
      return json(res, 200, { access_token: access, expires_in: this.#expiresIn, scope: grant.scopes.join(' '), token_type: 'Bearer' })
    }
    return oauthError(res, 400, 'unsupported_grant_type')
  }

  async #revoke(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    this.#count('oauth.revoke')
    const fault = this.#fault('oauth.revoke')
    const body = new URLSearchParams(await readBody(req))
    if (this.#applyFault(fault, req, res)) return
    const token = url.searchParams.get('token') ?? body.get('token') ?? ''
    const refresh = this.#refresh.get(token)
    if (refresh !== undefined) {
      refresh.revoked = true
      for (const access of this.#access.values()) if (access.refresh === token) access.revoked = true
    }
    const access = this.#access.get(token)
    if (access !== undefined) access.revoked = true
    this.revoked += 1
    json(res, 200, {})
  }

  #channelsList(res: ServerResponse, token: AccessToken): void {
    const channel = token.channel === null ? undefined : this.#channels.get(token.channel)
    json(res, 200, {
      kind: 'youtube#channelListResponse',
      pageInfo: { totalResults: channel === undefined ? 0 : 1, resultsPerPage: 5 },
      items: channel === undefined ? [] : [{ kind: 'youtube#channel', id: channel.id, snippet: { title: channel.title } }],
    })
  }

  #broadcastsList(res: ServerResponse, token: AccessToken): void {
    const items = [...this.#broadcasts.values()]
      .filter((broadcast) => broadcast.channelId === token.channel)
      .map((broadcast) => ({
        kind: 'youtube#liveBroadcast',
        id: broadcast.videoId,
        snippet: {
          channelId: broadcast.channelId,
          title: broadcast.title,
          scheduledStartTime: broadcast.scheduledStartTime,
          ...(broadcast.actualStartTime === null ? {} : { actualStartTime: broadcast.actualStartTime }),
          ...(broadcast.actualEndTime === null ? {} : { actualEndTime: broadcast.actualEndTime }),
          ...(broadcast.liveChatId === null ? {} : { liveChatId: broadcast.liveChatId }),
        },
        status: { lifeCycleStatus: broadcast.status === 'live' ? 'live' : broadcast.status === 'upcoming' ? 'ready' : 'complete', privacyStatus: 'unlisted' },
      }))
    json(res, 200, { kind: 'youtube#liveBroadcastListResponse', items })
  }

  /** 모르는 영상 ID를 물으면 부른다 — true면 그 사이 방송을 만든 것으로 보고 다시 찾는다 (연습 옮겨 받기 전용, D-LIVETEST-08) */
  onUnknownVideo: ((videoId: string) => boolean) | null = null

  #videosList(res: ServerResponse, url: URL): void {
    const ids = (url.searchParams.get('id') ?? '').split(',')
    for (const videoId of ids) if (!this.#broadcasts.has(videoId) && /^[A-Za-z0-9_-]{11}$/.test(videoId)) this.onUnknownVideo?.(videoId)
    const items = ids.flatMap((videoId) => {
      const broadcast = this.#broadcasts.get(videoId)
      if (broadcast === undefined) return []
      const chat = broadcast.liveChatId === null ? undefined : this.#chats.get(broadcast.liveChatId)
      const active = chat !== undefined && chat.endedAt === null && !chat.disabled && broadcast.status !== 'complete'
      return [
        {
          kind: 'youtube#video',
          id: videoId,
          snippet: {
            channelId: broadcast.channelId,
            // 영상의 채널 이름 (실제 videos.list snippet.channelTitle — 초대 방송 확인 줄, D-PHN-17). 모르는 채널이면 빈 글
            channelTitle: this.#channels.get(broadcast.channelId)?.title ?? '',
            title: broadcast.title,
            liveBroadcastContent: broadcast.status === 'complete' ? 'none' : broadcast.status,
          },
          liveStreamingDetails: {
            scheduledStartTime: broadcast.scheduledStartTime,
            ...(broadcast.actualStartTime === null ? {} : { actualStartTime: broadcast.actualStartTime }),
            ...(broadcast.actualEndTime === null ? {} : { actualEndTime: broadcast.actualEndTime }),
            ...(active ? { activeLiveChatId: chat.id } : {}),
          },
        },
      ]
    })
    json(res, 200, { kind: 'youtube#videoListResponse', items })
  }

  /** 지점(pageToken) → 메시지 위치. 지점이 없으면 최근 backlogSize개의 처음(실제 API — 채팅 처음이 아니다). 형식이 틀리면 null (pageTokenInvalid) */
  #position(chat: Chat, token: string | null): number | null {
    if (token === null || token === '') return Math.max(0, chat.messages.length - Math.max(0, this.backlogSize))
    const match = /^p(\d{1,9})$/.exec(token)
    if (match === null) return null
    const index = Number(match[1])
    return index > chat.messages.length ? null : index
  }

  /** 한 쪽: 요청한 최대 수(maxResults)와 이 서버의 쪽 크기 중 작은 것만큼 (실제 API처럼 최대 수를 따른다, AC-I3-86) */
  #page(chat: Chat, from: number, maxResults?: number): { items: Record<string, unknown>[]; next: number } {
    const size = maxResults === undefined ? this.pageSize : Math.min(this.pageSize, maxResults)
    const slice = chat.messages.slice(from, from + size)
    return { items: slice.map((message) => resource(chat, message)), next: from + slice.length }
  }

  /** 요청의 maxResults (1~2000 정수가 아니면 없음) */
  #maxResults(url: URL): number | undefined {
    const raw = url.searchParams.get('maxResults')
    if (raw === null || !/^\d{1,4}$/.test(raw)) return undefined
    const value = Number(raw)
    return value >= 1 && value <= 2000 ? value : undefined
  }

  #chatGate(res: ServerResponse, url: URL): Chat | null {
    const chat = this.#chats.get(url.searchParams.get('liveChatId') ?? '')
    if (chat === undefined) {
      googleError(res, 404, 'liveChatNotFound', 'youtube.liveChat')
      return null
    }
    if (chat.disabled) {
      googleError(res, 403, 'liveChatDisabled', 'youtube.liveChat')
      return null
    }
    return chat
  }

  #chatList(res: ServerResponse, url: URL): void {
    const chat = this.#chatGate(res, url)
    if (chat === null) return
    const from = this.#position(chat, url.searchParams.get('pageToken'))
    if (from === null) return googleError(res, 400, 'pageTokenInvalid', 'youtube.liveChat')
    const page = this.#page(chat, from, this.#maxResults(url))
    if (chat.endedAt !== null && page.items.length === 0 && from >= chat.messages.length && url.searchParams.get('pageToken') !== null && this.#endedSent.has(`${chat.id}|${String(from)}`)) {
      return googleError(res, 403, 'liveChatEnded', 'youtube.liveChat')
    }
    if (chat.endedAt !== null && page.next >= chat.messages.length) this.#endedSent.add(`${chat.id}|${String(page.next)}`)
    json(res, 200, {
      kind: 'youtube#liveChatMessageListResponse',
      pollingIntervalMillis: this.pollingIntervalMillis,
      nextPageToken: `p${String(page.next)}`,
      ...(chat.endedAt !== null && page.next >= chat.messages.length ? { offlineAt: chat.endedAt } : {}),
      pageInfo: { totalResults: page.items.length, resultsPerPage: this.pageSize },
      items: page.items.filter((item) => !this.#hidden(String(item.id))),
    })
  }

  readonly #endedSent = new Set<string>()

  async #chatStream(req: IncomingMessage, res: ServerResponse, url: URL, fault: FakeFault | undefined): Promise<void> {
    const chat = this.#chatGate(res, url)
    if (chat === null) return
    let position = this.#position(chat, url.searchParams.get('pageToken'))
    if (position === null) return googleError(res, 400, 'pageTokenInvalid', 'youtube.liveChat')
    if (chat.endedAt !== null && position >= chat.messages.length && this.#endedSent.has(`${chat.id}|${String(position)}`)) return googleError(res, 403, 'liveChatEnded', 'youtube.liveChat')
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.flushHeaders()
    this.openStreams.set(chat.id, (this.openStreams.get(chat.id) ?? 0) + 1)
    let closed = false
    const wake = new EventEmitter()
    const notify = () => wake.emit('wake')
    this.#events.on(`chat:${chat.id}`, notify)
    const onClose = () => {
      closed = true
      notify()
    }
    this.#events.once('close', onClose)
    const onDrop = () => {
      req.socket.destroy()
      onClose()
    }
    this.#events.once('drop', onDrop)
    req.on('close', onClose)
    res.on('close', onClose)
    let cut = fault !== undefined && 'kind' in fault && fault.kind === 'cut'
    try {
      res.write('[')
      let first = true
      for (;;) {
        if (closed) break
        if (chat.disabled) break
        if (position < chat.messages.length) {
          const page = this.#page(chat, position)
          const ended = chat.endedAt !== null && page.next >= chat.messages.length
          const body = JSON.stringify({
            kind: 'youtube#liveChatMessageListResponse',
            nextPageToken: `p${String(page.next)}`,
            ...(ended ? { offlineAt: chat.endedAt } : {}),
            items: page.items,
          })
          const piece = `${first ? '' : ',\n'}${body}`
          if (cut) {
            // 묶음 중간에 끊는다: 응답 절반만 쓰고 연결을 끊는다
            res.write(piece.slice(0, Math.max(1, Math.floor(piece.length / 2))))
            req.socket.destroy()
            break
          }
          res.write(piece)
          first = false
          position = page.next
          if (ended) {
            this.#endedSent.add(`${chat.id}|${String(position)}`)
            break
          }
          if (this.streamOnce) break
          // 다음 묶음에서 끊을 수 있게 (시험이 스트림 도중 fail('…streamList', {kind:'cut'})을 넣으면)
          const next = this.#faults.get('liveChatMessages.streamList')?.[0]
          if (next !== undefined && 'kind' in next && next.kind === 'cut') {
            this.#fault('liveChatMessages.streamList')
            cut = true
          }
          await new Promise((resolve) => setImmediate(resolve))
          continue
        }
        if (chat.endedAt !== null) {
          res.write(`${first ? '' : ',\n'}${JSON.stringify({ kind: 'youtube#liveChatMessageListResponse', nextPageToken: `p${String(position)}`, offlineAt: chat.endedAt, items: [] })}`)
          this.#endedSent.add(`${chat.id}|${String(position)}`)
          break
        }
        if (this.streamOnce || (first && this.streamGreeting && !cut)) {
          // 새 메시지가 없다: 연결 직후의 첫 응답은 빈 묶음(실제 streamList), 응답 하나만이면 빈 응답을 주고 닫는다
          res.write(`${first ? '' : ',\n'}${JSON.stringify({ kind: 'youtube#liveChatMessageListResponse', nextPageToken: `p${String(position)}`, items: [] })}`)
          first = false
          if (this.streamOnce) break
          continue
        }
        await new Promise<void>((resolve) => wake.once('wake', () => resolve()))
      }
      if (!closed && !res.destroyed) res.end(']')
    } finally {
      this.#events.off(`chat:${chat.id}`, notify)
      this.#events.off('close', onClose)
      this.#events.off('drop', onDrop)
      this.openStreams.set(chat.id, (this.openStreams.get(chat.id) ?? 1) - 1)
    }
  }

  async #chatInsert(req: IncomingMessage, res: ServerResponse, token: AccessToken, fault: FakeFault | undefined): Promise<void> {
    const body = JSON.parse((await readBody(req)) || '{}') as { snippet?: { liveChatId?: string; type?: string; textMessageDetails?: { messageText?: string } } }
    if (!token.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl')) return googleError(res, 403, 'insufficientPermissions', 'global')
    const chat = this.#chats.get(body.snippet?.liveChatId ?? '')
    if (chat === undefined) return googleError(res, 404, 'liveChatNotFound', 'youtube.liveChat')
    if (chat.disabled) return googleError(res, 403, 'liveChatDisabled', 'youtube.liveChat')
    if (chat.endedAt !== null) return googleError(res, 403, 'liveChatEnded', 'youtube.liveChat')
    const text = body.snippet?.textMessageDetails?.messageText ?? ''
    if (text === '' || [...text].length > 200) return googleError(res, 400, 'messageTextInvalid', 'youtube.liveChat')
    const channel = token.channel ?? ''
    const messageId = this.addMessage(chat.id, { author: channel, name: this.#channels.get(channel)?.title ?? '채널', text, owner: channel === chat.channelId })
    this.posted.push({ liveChatId: chat.id, id: messageId, text, authorChannelId: channel })
    this.#insertedAt.set(messageId, this.#now())
    if (fault !== undefined && 'kind' in fault && fault.kind === 'acceptHang') {
      this.#events.once('close', () => res.destroy())
      return
    }
    const message = chat.messages.find((item) => item.id === messageId) as FakeChatMessage
    json(res, 200, resource(chat, message))
  }

  /** 댓글 목록 (order=time 최신순): 최대 수(maxResults, 기본 20, 1~100)씩 쪽을 나누고 다음 쪽 지점(nextPageToken)을 준다 (AC-I3-86) */
  #commentsList(res: ServerResponse, url: URL): void {
    const videoId = url.searchParams.get('videoId') ?? ''
    const raw = url.searchParams.get('maxResults')
    const size = raw !== null && /^\d{1,3}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 100 ? Number(raw) : 20
    const token = url.searchParams.get('pageToken')
    const match = token === null ? null : /^c(\d{1,9})$/.exec(token)
    if (token !== null && match === null) return googleError(res, 400, 'invalidPageToken', 'youtube.commentThread')
    const from = match === null ? 0 : Number(match[1])
    const all = this.comments.filter((comment) => comment.videoId === videoId && !this.#hidden(comment.id)).reverse()
    const items = all.slice(from, from + size).map((comment) => this.#commentResource(comment))
    const next = from + size < all.length ? `c${String(from + size)}` : null
    json(res, 200, { kind: 'youtube#commentThreadListResponse', ...(next === null ? {} : { nextPageToken: next }), pageInfo: { totalResults: all.length, resultsPerPage: size }, items })
  }

  #commentResource(comment: FakeComment): Record<string, unknown> {
    return {
      kind: 'youtube#commentThread',
      id: comment.id,
      snippet: {
        videoId: comment.videoId,
        topLevelComment: { kind: 'youtube#comment', id: comment.id, snippet: { textOriginal: comment.text, textDisplay: comment.text, authorChannelId: { value: comment.authorChannelId }, publishedAt: comment.publishedAt } },
      },
    }
  }

  async #commentInsert(req: IncomingMessage, res: ServerResponse, token: AccessToken, fault: FakeFault | undefined): Promise<void> {
    const body = JSON.parse((await readBody(req)) || '{}') as { snippet?: { videoId?: string; topLevelComment?: { snippet?: { textOriginal?: string } } } }
    if (!token.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl')) return googleError(res, 403, 'insufficientPermissions', 'global')
    const videoId = body.snippet?.videoId ?? ''
    if (!this.#broadcasts.has(videoId)) return googleError(res, 404, 'videoNotFound', 'youtube.commentThread')
    const text = body.snippet?.topLevelComment?.snippet?.textOriginal ?? ''
    if (text === '' || [...text].length > 10_000) return googleError(res, 400, 'invalidCommentMetadata', 'youtube.commentThread')
    const comment: FakeComment = { id: id('cmt_', 12), videoId, authorChannelId: token.channel ?? '', text, publishedAt: new Date(this.#now()).toISOString() }
    this.comments.push(comment)
    this.#insertedAt.set(comment.id, this.#now())
    if (fault !== undefined && 'kind' in fault && fault.kind === 'acceptHang') {
      this.#events.once('close', () => res.destroy())
      return
    }
    json(res, 200, this.#commentResource(comment))
  }

  // ── 다른 프로세스용 조작 경로 (/_fake/*, JSON) ──────────────────────────

  async #control(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<void> {
    const input = req.method === 'POST' ? (JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>) : {}
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
    try {
      switch (`${req.method ?? ''} ${path}`) {
        case 'POST /_fake/accounts':
          return json(res, 200, { account: this.addAccount() })
        case 'POST /_fake/channels': {
          const account = text('account') ?? this.addAccount()
          return json(res, 200, this.addChannel(account, text('title') ?? '내 채널', text('channelId')))
        }
        case 'POST /_fake/approval':
          this.approval = {
            ...(text('account') === undefined ? {} : { account: text('account') as string }),
            ...(text('channel') === undefined ? {} : { channel: text('channel') as string }),
            ...(input.deny === true ? { deny: true } : {}),
            ...(Array.isArray(input.grant) ? { grant: input.grant as string[] } : {}),
          }
          return json(res, 200, { ok: true })
        case 'POST /_fake/broadcasts': {
          const status = text('status')
          const broadcast = this.addBroadcast(text('channelId') ?? '', {
            ...(text('title') === undefined ? {} : { title: text('title') as string }),
            ...(status === 'live' || status === 'upcoming' || status === 'complete' ? { status } : {}),
            ...(input.chat === false ? { chat: false } : {}),
          })
          return json(res, 200, broadcast)
        }
        case 'POST /_fake/messages': {
          const type = text('type')
          const messageId = this.addMessage(text('liveChatId') ?? '', {
            author: text('author') ?? '',
            name: text('name') ?? '',
            ...(text('text') === undefined ? {} : { text: text('text') as string }),
            ...(type === undefined ? {} : { type: type as 'textMessageEvent' }),
            ...(text('userComment') === undefined ? {} : { userComment: text('userComment') as string }),
            ...(text('publishedAt') === undefined ? {} : { publishedAt: text('publishedAt') as string }),
          })
          return json(res, 200, { id: messageId })
        }
        case 'POST /_fake/delete':
          return json(res, 200, { id: this.deleteMessage(text('liveChatId') ?? '', text('messageId') ?? '') })
        case 'POST /_fake/ban':
          return json(res, 200, {
            id: this.banUser(text('liveChatId') ?? '', { channelId: text('channelId') ?? '', name: text('name') ?? '', ...(typeof input.seconds === 'number' ? { seconds: input.seconds } : {}) }),
          })
        case 'POST /_fake/end-chat':
          this.endChat(text('liveChatId') ?? '')
          return json(res, 200, { ok: true })
        case 'POST /_fake/start-broadcast':
          return json(res, 200, this.startBroadcast(text('videoId') ?? ''))
        case 'POST /_fake/options':
          if (typeof input.pollingIntervalMillis === 'number') this.pollingIntervalMillis = input.pollingIntervalMillis
          if (typeof input.streamOnce === 'boolean') this.streamOnce = input.streamOnce
          if (typeof input.postsHiddenForMs === 'number') this.postsHiddenForMs = input.postsHiddenForMs
          if (typeof input.backlogSize === 'number') this.backlogSize = input.backlogSize
          if (typeof input.streamGreeting === 'boolean') this.streamGreeting = input.streamGreeting
          return json(res, 200, { ok: true })
        case 'POST /_fake/fail': {
          const fault = input.fault as FakeFault
          this.fail(text('method') as FakeMethod, fault, typeof input.times === 'number' ? input.times : 1)
          return json(res, 200, { ok: true })
        }
        case 'POST /_fake/clear-faults':
          this.clearFaults()
          return json(res, 200, { ok: true })
        case 'POST /_fake/drop-streams':
          this.dropStreams()
          return json(res, 200, { ok: true })
        case 'POST /_fake/revoke-all':
          this.revokeAll()
          return json(res, 200, { ok: true })
        case 'GET /_fake/state':
          return json(res, 200, {
            posted: this.posted,
            comments: this.comments,
            calls: this.callCounts(),
            ...(url.searchParams.get('liveChatId') === null ? {} : { messages: this.messages(url.searchParams.get('liveChatId') ?? '') }),
          })
        default: {
          const extended = this.#controlExtension?.(req.method ?? '', path, input, url.searchParams)
          return extended === undefined ? googleError(res, 404, 'notFound') : json(res, 200, extended)
        }
      }
    } catch {
      return googleError(res, 400, 'badRequest')
    }
  }
}
