// 가짜 구글 → 가짜 유튜브 웹 다리 (시험 도구, YT-11). 가짜 구글(FakeGoogle)로 짠 기존 시험·E2E가 서버 웹 읽기(수집기 방식 WEB) 길로 그대로 돌게 한다.
// - 방송: 가짜 구글에 방송이 생기면 같은 영상 ID·채널 ID·채널 이름·제목·시작 시각으로 가짜 유튜브 웹에도 만들고, 상태가 바뀌면 따라간다
//   (진행 중 → live, 진행 중인데 채팅 없음·꺼짐 → chatOff, 예정 → upcoming, 끝남·채팅 끝 → ended).
// - 채팅: 가짜 구글 채팅에 들어간 줄(시청자 글·슈퍼챗·멤버십·스티커·주인 글·우리 서버가 insert로 올린 감사 글)을 같은 메시지 ID·작성자 채널 ID·이름·게시 시각으로,
//   삭제 알림은 그 메시지 지움으로, 차단 알림은 그 작성자 글 모두 지움으로, 들어간 순서 그대로 넣는다. 투표·채팅 끝 알림은 웹에 줄이 없어 넣지 않는다.
// - 조작 경로: 가짜 구글 서버의 /_fake/web/* (같은 포트 — 다른 프로세스 시험용). 웹만의 상태(비공개 등)·오류·간격은 여기서 바꾼다.
// 가짜 유튜브 웹은 공개 메서드만 쓴다.
import type { FakeBroadcast, FakeChatMessage, FakeGoogle, FakeGoogleChange } from './fake-google.ts'
import type { FakeWebEndpoint, FakeWebFault, FakeWebMessage, FakeWebState, FakeWebVideo, FakeYoutubeWeb } from './fake-youtube-web.ts'

export const FAKE_WEB_ENDPOINTS: readonly FakeWebEndpoint[] = ['watch', 'chatPage', 'poll', 'channelLive']
const WEB_STATES: readonly FakeWebState[] = ['live', 'upcoming', 'ended', 'vod', 'private', 'members', 'age', 'chatOff', 'missing']
const FAULT_KINDS = ['bot', 'shape', 'empty', 'hang', 'reset', 'cut'] as const

export interface FakeWebBridge {
  readonly google: FakeGoogle
  readonly web: FakeYoutubeWeb
  /** 비친 웹 영상 (가짜 구글 방송의 영상 ID) */
  video(videoId: string): FakeWebVideo
  /** 가짜 구글 방송 객체를 직접 고친 뒤(status·title 등) 웹 상태를 다시 맞춘다. 웹에만 준 상태(비공개 등)도 덮어쓴다 */
  sync(): void
  /** 엔드포인트별 부른 수 */
  calls(): Record<FakeWebEndpoint, number>
  /** 따라 듣기와 /_fake/web/* 경로를 거둔다 (가짜 서버들은 닫지 않는다) */
  close(): void
}

/** 방송 상태 → 웹 상태 */
export function webStateOf(broadcast: FakeBroadcast, chatDisabled: boolean, chatEnded: boolean): FakeWebState {
  if (broadcast.status === 'complete' || chatEnded) return 'ended'
  if (broadcast.status === 'upcoming') return 'upcoming'
  return chatDisabled ? 'chatOff' : 'live'
}

/** 채팅 한 줄 → 웹 채팅 줄 (웹에 없는 종류면 null) */
export function webMessageOf(message: FakeChatMessage): FakeWebMessage | null {
  const publishedAt = Date.parse(message.publishedAt)
  const base = {
    id: message.id,
    author: message.authorChannelId,
    name: message.displayName,
    owner: message.isChatOwner,
    moderator: message.isChatModerator,
    ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
  }
  const comment = message.userComment === null ? {} : { text: message.userComment }
  switch (message.type) {
    case 'textMessageEvent':
      return { ...base, type: 'text', text: message.text ?? '' }
    case 'superChatEvent':
      return { ...base, type: 'superChat', ...comment }
    case 'memberMilestoneChatEvent':
      return { ...base, type: 'membership', ...comment }
    // 새 멤버 환영 줄: 웹도 멤버십 항목(글 없음)으로 나온다
    case 'newSponsorEvent':
      return { ...base, type: 'membership' }
    case 'superStickerEvent':
      return { ...base, type: 'sticker' }
    default:
      return null
  }
}

/**
 * 다리를 놓는다. 지금 있는 방송·채팅을 먼저 비추고, 그 뒤 바뀜을 따라간다.
 * control(기본 true)이면 가짜 구글 서버에 /_fake/web/* 조작 경로를 더한다:
 * - POST /_fake/web/fail { endpoint: 'watch'|'chatPage'|'poll'|'channelLive', fault: {status} | {kind:'bot'|'shape'|'empty'|'hang'|'reset'|'cut'}, times? } → { ok }
 * - GET /_fake/web/state → { url, calls: { watch, chatPage, poll, channelLive }, videos?: (videoId 쿼리) { state, actions } }
 * - POST /_fake/web/options { timeoutMs?: number|null, backlogSize?: number } → { ok }
 * - POST /_fake/web/video { videoId, state?, topChatOnly? } → { videoId, state } — 웹에만 주는 상태(비공개·멤버 전용·연령 제한·없음·라이브 아님)
 * - POST /_fake/web/messages { videoId, ...FakeWebMessage } → { id } — 웹에만 나오는 줄(선물·모르는 항목·작성자 없음 등)
 */
export function bridgeFakeWeb(google: FakeGoogle, web: FakeYoutubeWeb, options: { readonly control?: boolean } = {}): FakeWebBridge {
  const known = new Set<string>()
  const applyBroadcast = (change: Extract<FakeGoogleChange, { kind: 'broadcast' }>) => {
    const { broadcast } = change
    const state = webStateOf(broadcast, change.chatDisabled, change.chatEnded)
    const startedAt = Date.parse(broadcast.actualStartTime ?? broadcast.scheduledStartTime ?? '')
    if (!known.has(broadcast.videoId)) {
      known.add(broadcast.videoId)
      web.addVideo({
        videoId: broadcast.videoId,
        channelId: broadcast.channelId,
        channelTitle: change.channelTitle,
        title: broadcast.title,
        state,
        ...(Number.isFinite(startedAt) ? { startedAt } : {}),
      })
      return
    }
    const video = web.video(broadcast.videoId)
    video.state = state
    video.title = broadcast.title
    if (Number.isFinite(startedAt)) video.startedAt = startedAt
  }
  const applyMessage = (videoId: string, message: FakeChatMessage) => {
    if (!known.has(videoId)) return
    if (message.type === 'messageDeletedEvent') {
      if (message.deletedMessageId !== null) web.deleteMessage(videoId, message.deletedMessageId)
      return
    }
    if (message.type === 'userBannedEvent') {
      if (message.bannedChannelId !== null) web.removeAuthor(videoId, message.bannedChannelId)
      return
    }
    const line = webMessageOf(message)
    if (line !== null) web.addMessage(videoId, line)
  }
  const stop = google.observe(
    (change) => {
      if (change.kind === 'broadcast') applyBroadcast(change)
      else applyMessage(change.videoId, change.message)
    },
    { replay: true },
  )
  const calls = () => Object.fromEntries(FAKE_WEB_ENDPOINTS.map((endpoint) => [endpoint, web.calls(endpoint)])) as Record<FakeWebEndpoint, number>
  const control = options.control !== false
  if (control) google.extendControl((method, path, input, query) => webControl(web, calls, method, path, input, query))
  return {
    google,
    web,
    video: (videoId) => web.video(videoId),
    sync() {
      const stopSync = google.observe((change) => {
        if (change.kind === 'broadcast') applyBroadcast(change)
      }, { replay: true })
      stopSync()
    },
    calls,
    close() {
      stop()
      if (control) google.extendControl(null)
    },
  }
}

function webControl(web: FakeYoutubeWeb, calls: () => Record<FakeWebEndpoint, number>, method: string, path: string, input: Record<string, unknown>, query: URLSearchParams): unknown {
  switch (`${method} ${path}`) {
    case 'POST /_fake/web/fail': {
      const endpoint = input.endpoint
      if (!FAKE_WEB_ENDPOINTS.includes(endpoint as FakeWebEndpoint)) throw new Error('endpoint')
      const times = input.times === undefined ? 1 : input.times
      if (typeof times !== 'number' || !Number.isInteger(times) || times < 1 || times > 10_000) throw new Error('times')
      web.fail(endpoint as FakeWebEndpoint, faultOf(input.fault), times)
      return { ok: true }
    }
    case 'GET /_fake/web/state': {
      const videoId = query.get('videoId')
      const video = videoId === null ? null : web.video(videoId)
      return { url: web.url, calls: calls(), ...(video === null ? {} : { video: { videoId: video.videoId, state: video.state, actions: video.actions } }) }
    }
    case 'POST /_fake/web/options':
      if (input.timeoutMs === null || (typeof input.timeoutMs === 'number' && Number.isInteger(input.timeoutMs) && input.timeoutMs >= 0)) web.timeoutMs = input.timeoutMs
      if (typeof input.backlogSize === 'number' && Number.isInteger(input.backlogSize) && input.backlogSize >= 0) web.backlogSize = input.backlogSize
      return { ok: true }
    case 'POST /_fake/web/video': {
      const video = web.video(typeof input.videoId === 'string' ? input.videoId : '')
      if (input.state !== undefined) {
        if (!WEB_STATES.includes(input.state as FakeWebState)) throw new Error('state')
        video.state = input.state as FakeWebState
      }
      if (typeof input.topChatOnly === 'boolean') video.topChatOnly = input.topChatOnly
      return { videoId: video.videoId, state: video.state }
    }
    case 'POST /_fake/web/messages': {
      const { videoId, ...message } = input
      if (typeof videoId !== 'string') throw new Error('videoId')
      return { id: web.addMessage(videoId, message as FakeWebMessage) }
    }
    default:
      return undefined
  }
}

function faultOf(raw: unknown): FakeWebFault {
  if (typeof raw !== 'object' || raw === null) throw new Error('fault')
  const fault = raw as { status?: unknown; kind?: unknown }
  if (typeof fault.status === 'number' && Number.isInteger(fault.status) && fault.status >= 100 && fault.status <= 599) return { status: fault.status }
  if (FAULT_KINDS.includes(fault.kind as (typeof FAULT_KINDS)[number])) return { kind: fault.kind as (typeof FAULT_KINDS)[number] }
  throw new Error('fault')
}
