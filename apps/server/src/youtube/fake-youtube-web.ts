// 가짜 유튜브 웹 서버 (YT-11 AC4, D-YT-SRV-05 — D-Y13 가짜 구글처럼). 127.0.0.1에서만 연다. 서버 웹 읽기 원천은 주소만 바꿔 이 서버를 부른다 — 같은 통신 방식(HTML·JSON POST).
// - 공개 방송 페이지(/watch?v=&hl=en): ytInitialPlayerResponse(재생 상태·영상 정보·라이브 시작/끝)와 ytInitialData(채팅 칸) — 진행 중·예정·끝남·라이브 아님·
//   비공개·멤버 전용·연령 제한·채팅 꺼짐·봇 확인 화면.
// - 채팅 페이지(/live_chat?v=&is_popout=1&hl=en): ytcfg(클라이언트 이름·판·키·익명 방문 값)와 채팅 칸 머리의 Top chat·Live chat 지점(인기 채팅만 있는 페이지도 만든다).
// - get_live_chat(POST /youtubei/v1/live_chat/get_live_chat): 지점 → 그 뒤 동작(채팅 줄 넣기·지움·한 작성자 글 모두 지움)과 다음 지점(timeoutMs), 끝나면 다음 지점 없음.
//   첫 지점(Live chat 다시 불러오기)은 실제처럼 최근 동작부터 준다. 응답 모양은 2026-10-31 실제 응답 녹화본의 필드 이름을 쓴다.
// - 채널 라이브 주소(/channel/<ID>/live?hl=en): 그 채널의 진행 중(없으면 예정) 방송 페이지, 없으면 플레이어 응답이 없는 채널 페이지.
// - 시험 조작: 방송 만들기·상태 바꾸기, 시청자 글·슈퍼챗·멤버십·스티커·모르는 항목 넣기, 지우기·작성자 글 모두 지우기, 오류 넣기(상태·봇 화면·모르는 모양·빈 응답·응답 없음),
//   녹화본 응답 그대로 내기, 호출 수·요청 머리글(쿠키 없음 확인) 보기.
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

export const FAKE_WEB_HOST = '127.0.0.1'
export const FAKE_WEB_CLIENT_VERSION = '2.20261029.01.00'

export type FakeWebEndpoint = 'watch' | 'chatPage' | 'poll' | 'channelLive'

export type FakeWebState = 'live' | 'upcoming' | 'ended' | 'vod' | 'private' | 'members' | 'age' | 'chatOff' | 'missing'

/** 넣을 수 있는 오류 */
export type FakeWebFault =
  /** HTTP 상태 (본문은 짧은 JSON 오류) */
  | { readonly status: number }
  /** 봇 확인 화면 (200 HTML) */
  | { readonly kind: 'bot' }
  /** 200인데 모르는 모양 (JSON이지만 채팅 묶음이 아님) */
  | { readonly kind: 'shape' }
  /** 200인데 채팅 내용 없음 (responseContext만) */
  | { readonly kind: 'empty' }
  /** 응답 없음 (연결을 열어 둔 채 답하지 않는다) */
  | { readonly kind: 'hang' }
  /** 연결을 바로 끊는다 */
  | { readonly kind: 'reset' }

export interface FakeWebVideo {
  readonly videoId: string
  readonly channelId: string
  channelTitle: string
  title: string
  state: FakeWebState
  /** 실제 시작(진행 중) 또는 예정 시각 (밀리초) */
  startedAt: number
  /** 채팅 동작 (넣은 순서) */
  readonly actions: Record<string, unknown>[]
  /** 채팅 페이지에 인기 채팅 지점만 둔다 (전체 채팅 지점 없음) */
  topChatOnly: boolean
}

export interface FakeWebMessage {
  readonly id?: string
  /** 작성자 채널 ID (없으면 빼고 넣는다 — 읽지 못함 시험) */
  readonly author?: string | null
  readonly name?: string
  /** 글 (runs가 있으면 runs) */
  readonly text?: string
  readonly runs?: readonly Record<string, unknown>[]
  /** text(기본) · superChat · membership · sticker · gift · unknown(모르는 항목 종류) */
  readonly type?: 'text' | 'superChat' | 'membership' | 'sticker' | 'gift' | 'unknown'
  readonly owner?: boolean
  readonly moderator?: boolean
  /** 게시 시각 밀리초 (없으면 지금). null이면 timestampUsec을 빼고 넣는다 */
  readonly publishedAt?: number | null
  /** 바꿔 넣기 동작으로 (자리 표시 → 메시지) */
  readonly replace?: boolean
}

interface Continuation {
  readonly videoId: string
  /** 이 지점이 본 동작 수 (reload면 -1 — 최근부터) */
  readonly cursor: number
  readonly filter: 'all' | 'top'
}

const PAGE_CFG = (visitor: string) =>
  `<script>ytcfg.set({"INNERTUBE_API_KEY":"fake-web-key","INNERTUBE_CLIENT_NAME":"WEB","INNERTUBE_CLIENT_VERSION":"${FAKE_WEB_CLIENT_VERSION}","VISITOR_DATA":"${visitor}"});</script>`

export class FakeYoutubeWeb {
  readonly #server: Server
  readonly #sockets = new Set<Socket>()
  readonly #now: () => number
  #url = ''
  readonly #videos = new Map<string, FakeWebVideo>()
  readonly #faults = new Map<FakeWebEndpoint, FakeWebFault[]>()
  readonly #raw = new Map<string, unknown[]>()
  readonly #calls = new Map<FakeWebEndpoint, number[]>()
  /** 받은 요청 머리글 (쿠키·로그인 확인용) */
  readonly requestHeaders: Record<string, string | string[] | undefined>[] = []
  /** 받은 get_live_chat 본문의 클라이언트 값 */
  readonly pollClients: Record<string, unknown>[] = []
  /** 응답에 넣을 timeoutMs (null이면 빼고 넣는다) */
  timeoutMs: number | null = 5000
  /** 첫 지점(다시 불러오기)이 주는 최근 동작 수 */
  backlogSize = 80

  private constructor(now: () => number) {
    this.#now = now
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch(() => {
        if (!res.headersSent) send(res, 500, 'application/json', '{"error":{"code":500}}')
        else res.destroy()
      })
    })
    this.#server.on('connection', (socket: Socket) => {
      this.#sockets.add(socket)
      socket.on('close', () => this.#sockets.delete(socket))
    })
  }

  static async start(options: { now?: () => number } = {}): Promise<FakeYoutubeWeb> {
    const fake = new FakeYoutubeWeb(options.now ?? (() => Date.now()))
    await new Promise<void>((resolve, reject) => {
      fake.#server.once('error', reject)
      fake.#server.listen(0, FAKE_WEB_HOST, () => resolve())
    })
    const address = fake.#server.address()
    if (typeof address !== 'object' || address === null) throw new Error('가짜 서버 주소를 알 수 없다')
    fake.#url = `http://${FAKE_WEB_HOST}:${String(address.port)}`
    return fake
  }

  /** 서버 설정의 유튜브 웹 주소 */
  get url(): string {
    return this.#url
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
  }

  // ── 시험 조작 ────────────────────────────────────────────────────────

  /** 방송 하나 (영상 ID 11자, 채널 ID는 UC + 22자) */
  addVideo(options: { channelId?: string; channelTitle?: string; title?: string; state?: FakeWebState; startedAt?: number; videoId?: string } = {}): FakeWebVideo {
    const video: FakeWebVideo = {
      videoId: options.videoId ?? randomBytes(9).toString('base64url').slice(0, 11),
      channelId: options.channelId ?? `UC${randomBytes(17).toString('base64url').slice(0, 22)}`,
      channelTitle: options.channelTitle ?? '초대 채널',
      title: options.title ?? '라이브',
      state: options.state ?? 'live',
      startedAt: options.startedAt ?? this.#now(),
      actions: [],
      topChatOnly: false,
    }
    this.#videos.set(video.videoId, video)
    return video
  }

  video(videoId: string): FakeWebVideo {
    const video = this.#videos.get(videoId)
    if (video === undefined) throw new Error('없는 가짜 방송')
    return video
  }

  /** 채팅 줄 넣기 (게시 시각 기본 = 지금) — 만든 메시지 ID */
  addMessage(videoId: string, message: FakeWebMessage): string {
    const video = this.video(videoId)
    const id = message.id ?? `Ch${randomBytes(18).toString('base64url')}`
    const type = message.type ?? 'text'
    const at = message.publishedAt === undefined ? this.#now() : message.publishedAt
    const badges: Record<string, unknown>[] = []
    if (message.owner === true) badges.push({ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' }, tooltip: 'Owner', accessibility: { accessibilityData: { label: 'Owner' } } } })
    if (message.moderator === true) badges.push({ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' }, tooltip: 'Moderator', accessibility: { accessibilityData: { label: 'Moderator' } } } })
    const body: Record<string, unknown> = {
      id,
      ...(at === null ? {} : { timestampUsec: `${String(at)}000` }),
      ...(message.author === null ? {} : { authorExternalChannelId: message.author ?? 'UCviewer0000000000000000' }),
      authorName: { simpleText: message.name ?? '시청자' },
      authorPhoto: { thumbnails: [{ url: 'https://example.invalid/a.png', width: 32, height: 32 }] },
      ...(badges.length === 0 ? {} : { authorBadges: badges }),
      contextMenuEndpoint: { liveChatItemContextMenuEndpoint: { params: 'x' } },
      trackingParams: 'x',
    }
    const runs = message.runs ?? (message.text === undefined ? null : [{ text: message.text }])
    if (runs !== null) body.message = { runs }
    let item: Record<string, unknown>
    switch (type) {
      case 'superChat':
        item = { liveChatPaidMessageRenderer: { ...body, purchaseAmountText: { simpleText: '₩10,000' }, headerBackgroundColor: 4278239141 } }
        break
      case 'membership':
        item = { liveChatMembershipItemRenderer: { ...body, headerPrimaryText: { runs: [{ text: 'Member for ' }, { text: '6' }, { text: ' months' }] }, headerSubtext: { simpleText: 'Member' } } }
        break
      case 'sticker':
        item = { liveChatPaidStickerRenderer: { ...body, purchaseAmountText: { simpleText: '₩2,000' } } }
        break
      case 'gift':
        item = { giftMessageViewModel: { id, text: { content: 'sent a gift' }, authorName: { content: message.name ?? '시청자' } } }
        break
      case 'unknown':
        item = { liveChatFutureThingRenderer: { ...body } }
        break
      default:
        item = { liveChatTextMessageRenderer: body }
    }
    video.actions.push(message.replace === true ? { clickTrackingParams: 'x', replaceChatItemAction: { targetItemId: id, replacementItem: item } } : { clickTrackingParams: 'x', addChatItemAction: { item, clientId: 'x' } })
    return id
  }

  /** 메시지 하나 지움 */
  deleteMessage(videoId: string, messageId: string): void {
    this.video(videoId).actions.push({ clickTrackingParams: 'x', removeChatItemAction: { targetItemId: messageId } })
  }

  /** 한 작성자 글 모두 지움 (차단·시간 제한) */
  removeAuthor(videoId: string, channelId: string): void {
    this.video(videoId).actions.push({ clickTrackingParams: 'x', markChatItemsByAuthorAsDeletedAction: { externalChannelId: channelId, deletedStateMessage: { runs: [{ text: '[message deleted]' }] } } })
  }

  /** 오류를 times번 넣는다 (그 종류 요청에) */
  fail(endpoint: FakeWebEndpoint, fault: FakeWebFault, times = 1): void {
    const list = this.#faults.get(endpoint) ?? []
    for (let i = 0; i < times; i++) list.push(fault)
    this.#faults.set(endpoint, list)
  }

  /** 다음 get_live_chat 응답을 이 JSON 그대로 (녹화본 내기) */
  raw(videoId: string, json: unknown): void {
    const list = this.#raw.get(videoId) ?? []
    list.push(json)
    this.#raw.set(videoId, list)
  }

  /** 부른 횟수 */
  calls(endpoint?: FakeWebEndpoint): number {
    if (endpoint !== undefined) return this.#calls.get(endpoint)?.length ?? 0
    let total = 0
    for (const list of this.#calls.values()) total += list.length
    return total
  }

  /** 부른 시각 (가짜 시계) */
  callTimes(endpoint: FakeWebEndpoint): readonly number[] {
    return this.#calls.get(endpoint) ?? []
  }

  // ── 처리 ─────────────────────────────────────────────────────────────

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.#url)
    this.requestHeaders.push({ ...req.headers })
    let endpoint: FakeWebEndpoint
    if (req.method === 'GET' && url.pathname === '/watch') endpoint = 'watch'
    else if (req.method === 'GET' && url.pathname === '/live_chat') endpoint = 'chatPage'
    else if (req.method === 'POST' && url.pathname === '/youtubei/v1/live_chat/get_live_chat') endpoint = 'poll'
    else if (req.method === 'GET' && /^\/channel\/[^/]+\/live$/.test(url.pathname)) endpoint = 'channelLive'
    else {
      send(res, 404, 'text/html', '<html>404</html>')
      return
    }
    const calls = this.#calls.get(endpoint) ?? []
    calls.push(this.#now())
    this.#calls.set(endpoint, calls)
    const body = req.method === 'POST' ? await readBody(req) : ''
    const fault = this.#faults.get(endpoint)?.shift()
    if (fault !== undefined) {
      if ('status' in fault) return send(res, fault.status, 'application/json', `{"error":{"code":${String(fault.status)},"status":"FAKE"}}`)
      if (fault.kind === 'hang') return
      if (fault.kind === 'reset') {
        res.socket?.destroy()
        return
      }
      if (fault.kind === 'bot') return send(res, 200, 'text/html', `<html><body>Sign in to confirm you’re not a bot</body></html>`)
      if (fault.kind === 'shape') return send(res, 200, endpoint === 'poll' ? 'application/json' : 'text/html', endpoint === 'poll' ? '{"somethingNew":{"items":[]}}' : '<html>new layout</html>')
      if (fault.kind === 'empty') return send(res, 200, 'application/json', '{"responseContext":{"serviceTrackingParams":[]}}')
    }
    switch (endpoint) {
      case 'watch':
        return send(res, 200, 'text/html', this.#watchHtml(this.#videos.get(url.searchParams.get('v') ?? '')))
      case 'chatPage':
        return send(res, 200, 'text/html', this.#chatHtml(this.#videos.get(url.searchParams.get('v') ?? '')))
      case 'channelLive': {
        const channelId = decodeURIComponent(url.pathname.split('/')[2] ?? '')
        const videos = [...this.#videos.values()].filter((video) => video.channelId === channelId)
        const pick = videos.find((video) => video.state === 'live') ?? videos.find((video) => video.state === 'upcoming')
        return send(res, 200, 'text/html', pick === undefined ? '<html><script>var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{}}};</script></html>' : this.#watchHtml(pick))
      }
      case 'poll': {
        this.pollClients.push((JSON.parse(body) as { context?: { client?: Record<string, unknown> } }).context?.client ?? {})
        return this.#poll(res, (JSON.parse(body) as { continuation?: unknown }).continuation)
      }
    }
  }

  #poll(res: ServerResponse, raw: unknown): void {
    const continuation = typeof raw === 'string' ? decodeContinuation(raw) : null
    const video = continuation === null ? undefined : this.#videos.get(continuation.videoId)
    if (continuation === null || video === undefined) {
      send(res, 400, 'application/json', '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}')
      return
    }
    const recorded = this.#raw.get(video.videoId)?.shift()
    if (recorded !== undefined) {
      send(res, 200, 'application/json', JSON.stringify(recorded))
      return
    }
    const from = continuation.cursor < 0 ? Math.max(0, video.actions.length - this.backlogSize) : continuation.cursor
    const actions = video.actions.slice(from)
    const ended = video.state !== 'live'
    const chat: Record<string, unknown> = {
      ...(ended
        ? {}
        : { continuations: [{ invalidationContinuationData: { invalidationId: { objectSource: 1056, topic: 'x' }, ...(this.timeoutMs === null ? {} : { timeoutMs: this.timeoutMs }), continuation: encodeContinuation({ videoId: video.videoId, cursor: video.actions.length, filter: continuation.filter }) } }] }),
      ...(actions.length === 0 ? {} : { actions }),
      ...(continuation.cursor < 0 ? { liveChatCurrentFilter: continuation.filter === 'top' ? 'LIVE_CHAT_FILTER_MODE_DEFAULT' : 'LIVE_CHAT_FILTER_MODE_UNFILTERED' } : {}),
    }
    send(res, 200, 'application/json', JSON.stringify({ responseContext: { serviceTrackingParams: [] }, continuationContents: { liveChatContinuation: chat } }))
  }

  #watchHtml(video: FakeWebVideo | undefined): string {
    if (video === undefined || video.state === 'missing') {
      return page({ playabilityStatus: { status: 'ERROR', reason: 'This video is unavailable' } }, { contents: {} })
    }
    const details: Record<string, unknown> = { videoId: video.videoId, title: video.title, channelId: video.channelId, author: video.channelTitle, isLiveContent: video.state !== 'vod' }
    const iso = new Date(video.startedAt).toISOString()
    const microformat = (extra: Record<string, unknown>) => ({ playerMicroformatRenderer: { liveBroadcastDetails: { startTimestamp: iso, ...extra } } })
    const chat = { conversationBar: { liveChatRenderer: { continuations: [{ reloadContinuationData: { continuation: 'short-watch-token' } }], header: {} } } }
    switch (video.state) {
      case 'live':
      case 'chatOff':
        return page(
          { playabilityStatus: { status: 'OK' }, videoDetails: { ...details, isLive: true }, microformat: microformat({ isLiveNow: true }) },
          { contents: { twoColumnWatchNextResults: video.state === 'live' ? chat : { conversationBar: { conversationBarRenderer: { availabilityMessage: { messageRenderer: { text: { runs: [{ text: 'Chat is disabled for this live stream.' }] } } } } } } } },
        )
      case 'upcoming':
        return page(
          { playabilityStatus: { status: 'LIVE_STREAM_OFFLINE', reason: 'This live event will begin soon.' }, videoDetails: { ...details, isUpcoming: true }, microformat: microformat({ isLiveNow: false }) },
          { contents: { twoColumnWatchNextResults: chat } },
        )
      case 'ended':
        return page({ playabilityStatus: { status: 'OK' }, videoDetails: details, microformat: microformat({ isLiveNow: false, endTimestamp: new Date(video.startedAt + 3_600_000).toISOString() }) }, { contents: { twoColumnWatchNextResults: {} } })
      case 'vod':
        return page({ playabilityStatus: { status: 'OK' }, videoDetails: details }, { contents: { twoColumnWatchNextResults: {} } })
      case 'private':
        return page({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'This video is private' } }, { contents: {} })
      case 'members':
        return page({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Join this channel to get access to members-only content like this video, and other exclusive perks.' }, videoDetails: details }, { contents: {} })
      case 'age':
        return page({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' }, videoDetails: details }, { contents: {} })
    }
  }

  #chatHtml(video: FakeWebVideo | undefined): string {
    const visitor = `fake-visitor-${randomBytes(4).toString('hex')}`
    if (video === undefined || video.state !== 'live') {
      return `<html>${PAGE_CFG(visitor)}<script>window["ytInitialData"] = {"contents":{"messageRenderer":{"text":{"runs":[{"text":"Chat is disabled for this live stream."}]}}}};</script></html>`
    }
    const top = encodeContinuation({ videoId: video.videoId, cursor: -1, filter: 'top' })
    const all = encodeContinuation({ videoId: video.videoId, cursor: -1, filter: 'all' })
    const subMenuItems = [{ title: 'Top chat', selected: true, continuation: { reloadContinuationData: { continuation: top } } }, ...(video.topChatOnly ? [] : [{ title: 'Live chat', selected: false, continuation: { reloadContinuationData: { continuation: all } } }])]
    const data = {
      contents: {
        liveChatRenderer: {
          continuations: [{ invalidationContinuationData: { continuation: top, timeoutMs: 10_000 } }],
          actions: video.actions.slice(-20),
          header: { liveChatHeaderRenderer: { viewSelector: { sortFilterSubMenuRenderer: { subMenuItems } } } },
          liveChatCurrentFilter: 'LIVE_CHAT_FILTER_MODE_DEFAULT',
        },
      },
    }
    return `<html>${PAGE_CFG(visitor)}<script>window["ytInitialData"] = ${JSON.stringify(data)};</script></html>`
  }
}

/** 지점: 실제처럼 불투명한 글 (base64url) */
function encodeContinuation(continuation: Continuation): string {
  return Buffer.from(JSON.stringify(continuation)).toString('base64url')
}

function decodeContinuation(raw: string): Continuation | null {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Continuation>
    return typeof value.videoId === 'string' && typeof value.cursor === 'number' && (value.filter === 'all' || value.filter === 'top') ? (value as Continuation) : null
  } catch {
    return null
  }
}

function page(player: Record<string, unknown>, data: Record<string, unknown>): string {
  return `<html><head></head><body><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
