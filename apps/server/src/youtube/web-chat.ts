// 유튜브 웹이 쓰는 내부 채팅 API 읽기 — 순수 함수만 (입출력·시계·난수 없음). YT-11 AC4, D-YT-SRV-04·05.
// - 방송 페이지(watch?v=ID&hl=en) HTML → 상태(진행 중·예정·끝남·라이브 아님·없음·채팅 꺼짐·로그인 없이 못 봄·막힘·모르는 모양), 방송 채널, 제목, 시작 시각.
// - 채팅 페이지(live_chat?v=ID&is_popout=1&hl=en) HTML → 호출 정보(클라이언트 판·키·익명 방문 값 — 페이지가 알려 준 값)와 **전체 채팅**("Live chat") 첫 지점.
//   인기 채팅("Top chat" — 유튜브가 일부를 숨긴 보기)은 쓰지 않는다. 전체 채팅 지점이 없으면 모르는 모양이다.
//   방송 페이지의 짧은 지점은 get_live_chat이 받지 않는다(2026-10-31 실제 확인: 400 INVALID_ARGUMENT).
// - get_live_chat 응답 → 메시지(일반·글 있는 슈퍼챗·글 있는 멤버십)·지운 메시지·한 작성자 글 모두 지움·다음 지점·timeoutMs·끝·읽지 못함 수·모르는 종류 이름.
// - 바깥 글(이름·채팅)은 그대로 돌려준다 — 이름 정리는 기록 경로(ingestYoutubeBatch), 이스케이프는 화면이 한다. 로그는 남기지 않는다.

/** 방송 페이지로 본 상태 */
export type PageState =
  /** 진행 중이고 채팅 칸이 있다 */
  | 'LIVE'
  /** 시작 전(예정) */
  | 'UPCOMING'
  /** 끝났다(다시 보기·녹화 없음 포함) */
  | 'ENDED'
  /** 라이브가 아닌 영상 */
  | 'NOT_LIVE'
  /** 없거나 지웠다 */
  | 'NOT_FOUND'
  /** 진행 중인데 채팅이 꺼져 있다 */
  | 'CHAT_DISABLED'
  /** 로그인 없이 볼 수 없다 (비공개·멤버 전용·연령 제한) */
  | 'NOT_PUBLIC'
  /** 막힘 — 봇 확인·그 밖의 로그인 요구 화면 */
  | 'BLOCKED'
  /** 모르는 모양 (유튜브가 바꿨다) */
  | 'UNKNOWN_SHAPE'

/** get_live_chat 호출에 쓰는 정보 (로그인·쿠키 없음 — 페이지가 알려 준 값, 그 수집기 메모리에서만) */
export interface InnertubeSession {
  /** 없어도 부를 수 있다 (있으면 붙인다) */
  readonly apiKey: string | null
  /** 웹 클라이언트 이름 (페이지 값, 없으면 WEB) */
  readonly clientName: string
  readonly clientVersion: string
  /** 익명 방문 값 (없으면 null) */
  readonly visitorData: string | null
}

export interface WatchPage {
  readonly state: PageState
  readonly videoId: string | null
  /** 방송 채널 ID (영상의 채널) */
  readonly channelId: string | null
  /** 방송 채널 이름 (바깥 글) */
  readonly channelTitle: string | null
  /** 방송 제목 (바깥 글) */
  readonly title: string | null
  /** 실제 시작 시각 밀리초 (진행 중·끝남), 예정이면 예정 시각, 모르면 null */
  readonly startedAt: number | null
}

/** 채팅 페이지로 본 것 */
export interface ChatPage {
  /** OK: 지점·호출 정보가 있다 · NO_CHAT: 채팅 칸이 없다(꺼짐·끝남 — 방송 페이지로 까닭을 본다) · BLOCKED · UNKNOWN_SHAPE(전체 채팅 지점 없음 포함) */
  readonly state: 'OK' | 'NO_CHAT' | 'BLOCKED' | 'UNKNOWN_SHAPE'
  readonly session: InnertubeSession | null
  /** 전체 채팅 첫 지점 (OK일 때만) */
  readonly continuation: string | null
}

/** 메시지 하나 */
export interface InnertubeChat {
  readonly id: string
  /** 작성자 채널 ID (authorExternalChannelId) */
  readonly ch: string
  /** 표시 이름 (바깥 글) */
  readonly nick: string
  /** 글 조각을 이어 붙임 (표준 이모지는 그 글자, 유튜브 전용 이모지는 첫 줄임말 :이름:) */
  readonly text: string
  /** 작성자 배지에 채널 주인 표시가 있을 때만 (운영자·멤버·인증은 시청자) */
  readonly owner: boolean
  /** 게시 시각 밀리초 (timestampUsec ÷ 1000 내림) */
  readonly publishedAt: number
  /** 게시 시각 마이크로초 — 받은 글 그대로 */
  readonly timestampUsec: string
  readonly kind: 'TEXT' | 'SUPER_CHAT' | 'MEMBERSHIP'
}

export type LiveChatParse =
  | {
      readonly kind: 'ok'
      readonly chats: InnertubeChat[]
      /** 지운 메시지 ID */
      readonly deleted: string[]
      /** 글을 모두 지운 작성자 채널 ID (차단·시간 제한 — 어느 쪽인지 모른다) */
      readonly removedAuthors: string[]
      /** 다음 지점 (없으면 null — 끝났는지 방송 페이지로 확인할 일) */
      readonly next: string | null
      /** 다음 호출까지 (유튜브가 정한 값, 없거나 숫자가 아니면 null) */
      readonly timeoutMs: number | null
      /** ID·작성자 채널 ID·게시 시각 중 하나라도 없는 메시지 수 */
      readonly unreadable: number
      /** 채팅 줄 넣기 동작 안의 모르는 항목 종류 이름 (값 없이 이름만, 나온 수만큼) */
      readonly unknown: string[]
    }
  /** 응답에 채팅 내용이 없다 (끝났을 수도, 모양이 바뀌었을 수도 — 방송 페이지로 다시 본다) */
  | { readonly kind: 'no_contents' }
  /** 모르는 모양 (객체가 아님·채팅 묶음 모양이 다름·인기 채팅 보기) */
  | { readonly kind: 'unknown_shape' }

// ── 작은 도우미 ──────────────────────────────────────────────────────────

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const rec = (value: unknown): Record<string, unknown> => record(value) ?? {}
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** 글 묶음(simpleText 또는 runs) → 글 */
export function textOf(value: unknown): string {
  const node = rec(value)
  const simple = str(node.simpleText)
  if (simple !== null) return simple
  let out = ''
  for (const raw of list(node.runs)) {
    const run = rec(raw)
    const text = str(run.text)
    if (text !== null) {
      out += text
      continue
    }
    const emoji = record(run.emoji)
    if (emoji === null) continue
    const shortcut = str(list(emoji.shortcuts)[0])
    // 유튜브 전용(채널·멤버) 이모지는 첫 줄임말, 표준 이모지는 그 글자
    if (emoji.isCustomEmoji === true) out += shortcut ?? ''
    else out += str(emoji.emojiId) ?? shortcut ?? ''
  }
  return out
}

/** 마이크로초 글 → 밀리초 (정수 나눗셈 내림, 소수 없음). 숫자 글이 아니면 null */
export function usecToMs(usec: string | null): number | null {
  if (usec === null || !/^\d{1,19}$/.test(usec)) return null
  const ms = Number(BigInt(usec) / 1000n)
  return Number.isSafeInteger(ms) ? ms : null
}

/** 표시가 스크립트 맨 앞에 있는가 (`<script nonce="…">var ytInitialData = ` — 실제 페이지 2026-10-31 확인) */
const SCRIPT_START = /<script[^<>]*>\s*$/i

/**
 * HTML에서 스크립트 맨 앞의 `marker` 바로 뒤 JSON 객체 하나를 꺼낸다 (문자열 안의 괄호는 세지 않는다). 없거나 깨졌으면 null.
 * 방송 제목·채팅 같은 바깥 글에 같은 표시가 들어 있어도(JSON 문자열 안 — `<`는 <로 나온다) 스크립트 맨 앞이 아니면 건너뛴다.
 * 정규식으로 JSON을 자르지 않는다 — 큰 페이지(1MB 남짓)에서도 한 번 훑는다
 */
export function jsonAfter(html: string, marker: string): Record<string, unknown> | null {
  for (let at = html.indexOf(marker); at >= 0; at = html.indexOf(marker, at + 1)) {
    if (!SCRIPT_START.test(html.slice(Math.max(0, at - 200), at))) continue
    const start = at + marker.length
    if (html[start] !== '{') continue
    return objectAt(html, start)
  }
  return null
}

/** start의 `{`부터 짝이 맞는 `}`까지를 JSON으로 (깨졌으면 null) */
function objectAt(html: string, start: number): Record<string, unknown> | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return record(JSON.parse(html.slice(start, i + 1)))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const cfgString = (html: string, key: string): string | null => {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]{1,512})"`).exec(html)
  return match?.[1] ?? null
}

/** 봇 확인·비정상 트래픽 화면의 표시 (영문 화면 — 페이지는 hl=en으로 부른다) */
const BLOCK_MARKS = ["confirm you're not a bot", 'confirm you’re not a bot', 'unusual traffic from your computer network', 'www.google.com/sorry/']

/** 봇 확인 화면인가 (글에 표시가 있다) */
export function looksBlocked(text: string): boolean {
  const lower = text.toLowerCase()
  return BLOCK_MARKS.some((mark) => lower.includes(mark))
}

// ── 방송 페이지 ──────────────────────────────────────────────────────────

/**
 * 방송 페이지(watch?v=ID&hl=en) HTML → 상태·채널·제목·시작 시각.
 * 비공개·멤버 전용·연령 제한은 NOT_PUBLIC, 봇 확인과 그 밖의 로그인 요구 화면은 BLOCKED, 플레이어 응답이 없거나 모르는 상태 값이면 UNKNOWN_SHAPE
 */
export function parseWatchPage(html: string): WatchPage {
  const make = (state: PageState, extra: Partial<WatchPage> = {}): WatchPage => ({ state, videoId: null, channelId: null, channelTitle: null, title: null, startedAt: null, ...extra })
  const player = jsonAfter(html, 'var ytInitialPlayerResponse = ') ?? jsonAfter(html, 'window["ytInitialPlayerResponse"] = ')
  const playability = rec(player?.playabilityStatus)
  const status = str(playability.status)
  const reason = (str(playability.reason) ?? '').toLowerCase()
  if (player === null || status === null) return make(looksBlocked(html) ? 'BLOCKED' : 'UNKNOWN_SHAPE')
  const data = jsonAfter(html, 'var ytInitialData = ') ?? jsonAfter(html, 'window["ytInitialData"] = ')
  const details = rec(player.videoDetails)
  const broadcast = rec(rec(rec(player.microformat).playerMicroformatRenderer).liveBroadcastDetails)
  const start = Date.parse(str(broadcast.startTimestamp) ?? '')
  const base: Partial<WatchPage> = {
    videoId: str(details.videoId),
    channelId: str(details.channelId),
    channelTitle: str(details.author),
    title: str(details.title),
    startedAt: Number.isFinite(start) ? start : null,
  }
  const ended = str(broadcast.endTimestamp) !== null
  switch (status) {
    case 'OK':
    case 'LIVE_STREAM_OFFLINE':
      break
    case 'ERROR':
      return make('NOT_FOUND', base)
    case 'AGE_CHECK_REQUIRED':
    case 'AGE_VERIFICATION_REQUIRED':
    case 'CONTENT_CHECK_REQUIRED':
      return make('NOT_PUBLIC', base)
    case 'LOGIN_REQUIRED':
      if (reason.includes('bot')) return make('BLOCKED')
      if (reason.includes('private') || reason.includes('age') || reason.includes('inappropriate') || reason.includes('member')) return make('NOT_PUBLIC', base)
      return make('BLOCKED')
    case 'UNPLAYABLE':
      if (reason.includes('member')) return make('NOT_PUBLIC', base)
      if (details.isLiveContent === true && (ended || reason.includes('recording'))) return make('ENDED', base)
      return make('NOT_FOUND', base)
    default:
      return make('UNKNOWN_SHAPE', base)
  }
  if (base.channelId === null || base.channelId === '') return make('UNKNOWN_SHAPE', base)
  const live = details.isLive === true || broadcast.isLiveNow === true
  const upcoming = details.isUpcoming === true || (status === 'LIVE_STREAM_OFFLINE' && !ended)
  const renderer = record(rec(rec(rec(data?.contents).twoColumnWatchNextResults).conversationBar).liveChatRenderer)
  if (upcoming && !live) return make('UPCOMING', base)
  if (!live) return make(details.isLiveContent === true || ended ? 'ENDED' : 'NOT_LIVE', base)
  if (renderer !== null && renderer.isReplay === true) return make('ENDED', base)
  // 진행 중인데 채팅 칸이 없다(채팅 꺼짐 안내만). 초기 데이터 자체가 없으면 모르는 모양
  if (renderer === null) return make(data === null ? 'UNKNOWN_SHAPE' : 'CHAT_DISABLED', base)
  return make('LIVE', base)
}

/** 전체 채팅("Live chat") 지점 — 이름으로 찾고, 없으면 두 항목 이상일 때 마지막(유튜브 웹 순서: Top chat, Live chat). 없으면 null(인기 채팅 지점만 있음) */
function fullChatContinuation(renderer: Record<string, unknown>): string | null {
  const items = list(rec(rec(rec(rec(renderer.header).liveChatHeaderRenderer).viewSelector).sortFilterSubMenuRenderer).subMenuItems).map(rec)
  const pick = items.find((item) => str(item.title) === 'Live chat') ?? (items.length >= 2 ? items[items.length - 1] : undefined)
  const continuation = pick === undefined ? null : str(rec(rec(pick.continuation).reloadContinuationData).continuation)
  return continuation === null || continuation === '' ? null : continuation
}

/**
 * 채팅 페이지(live_chat?v=ID&is_popout=1&hl=en) HTML → 호출 정보와 전체 채팅 첫 지점.
 * 채팅 칸이 없거나 다시 보기면 NO_CHAT, 클라이언트 판·전체 채팅 지점을 찾지 못하면 모르는 모양, 봇 확인 화면이면 막힘
 */
export function parseChatPage(html: string): ChatPage {
  const data = jsonAfter(html, 'window["ytInitialData"] = ') ?? jsonAfter(html, 'var ytInitialData = ')
  if (data === null) return { state: looksBlocked(html) ? 'BLOCKED' : 'UNKNOWN_SHAPE', session: null, continuation: null }
  const clientVersion = cfgString(html, 'INNERTUBE_CLIENT_VERSION') ?? cfgString(html, 'INNERTUBE_CONTEXT_CLIENT_VERSION')
  const session: InnertubeSession | null =
    clientVersion === null
      ? null
      : { apiKey: cfgString(html, 'INNERTUBE_API_KEY'), clientName: cfgString(html, 'INNERTUBE_CLIENT_NAME') ?? 'WEB', clientVersion, visitorData: cfgString(html, 'VISITOR_DATA') }
  const contents = record(data.contents)
  if (contents === null) return { state: 'UNKNOWN_SHAPE', session, continuation: null }
  const renderer = record(contents.liveChatRenderer)
  if (renderer === null || renderer.isReplay === true) return { state: 'NO_CHAT', session, continuation: null }
  const continuation = fullChatContinuation(renderer)
  if (session === null || continuation === null) return { state: 'UNKNOWN_SHAPE', session, continuation: null }
  return { state: 'OK', session, continuation }
}

// ── get_live_chat 응답 ───────────────────────────────────────────────────

/** 기록하지 않지만 아는 항목 (스티커·선물·가입 알림·시스템 글·자리 표시·투표 등) — "모르는 종류"로 세지 않는다 */
const IGNORED_ITEMS: ReadonlySet<string> = new Set([
  'liveChatPaidStickerRenderer',
  'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer',
  'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer',
  'giftMessageViewModel',
  'liveChatViewerEngagementMessageRenderer',
  'liveChatPlaceholderItemRenderer',
  'liveChatModeChangeMessageRenderer',
  'liveChatModerationMessageRenderer',
  'liveChatAutoModMessageRenderer',
  'liveChatDonationAnnouncementRenderer',
  'liveChatPurchasedProductMessageRenderer',
  'liveChatBannerRenderer',
  'liveChatCallForQuestionsRenderer',
  'pollRenderer',
])

const MESSAGE_KINDS: Readonly<Record<string, InnertubeChat['kind']>> = {
  liveChatTextMessageRenderer: 'TEXT',
  liveChatPaidMessageRenderer: 'SUPER_CHAT',
  liveChatMembershipItemRenderer: 'MEMBERSHIP',
}

/** 인기 채팅(유튜브가 걸러 보이는 보기)이라고 응답이 알리는 값 */
const FILTERED_MODE = 'LIVE_CHAT_FILTER_MODE_DEFAULT'

/** 이어 받을 지점: 실시간 지점(invalidation·timed·reload)만. 다시 보기 지점만 있으면 없음 */
function nextOf(continuations: unknown): { next: string | null; timeoutMs: number | null } {
  for (const raw of list(continuations)) {
    const holder = rec(raw)
    for (const key of ['invalidationContinuationData', 'timedContinuationData', 'reloadContinuationData']) {
      const data = record(holder[key])
      const next = data === null ? null : str(data.continuation)
      if (data === null || next === null || next === '') continue
      const timeout = typeof data.timeoutMs === 'number' ? data.timeoutMs : Number.NaN
      return { next, timeoutMs: Number.isFinite(timeout) && timeout >= 0 ? Math.trunc(timeout) : null }
    }
  }
  return { next: null, timeoutMs: null }
}

/**
 * get_live_chat 응답 → 메시지·지움·숨김·다음 지점·timeoutMs·읽지 못함·모르는 종류.
 * - 일반 채팅, 시청자 글이 있는 슈퍼챗·멤버십만 메시지(바꿔 넣기로 온 것도 같다). ID·작성자 채널 ID·게시 시각 중 하나라도 없으면 읽지 못함으로 센다.
 * - 메시지 하나 지움(markChatItemAsDeletedAction·removeChatItemAction) → deleted, 한 작성자 글 모두 지움 → removedAuthors.
 * - 채팅 줄 넣기 동작 안의 모르는 항목 종류는 버리고 이름만 센다. 그 밖의 동작(고정 글·후원 띠·투표 등)은 무시한다.
 * - 응답이 인기 채팅 보기라고 알리면 모르는 모양(전체 채팅이 아님), 채팅 내용이 없으면 no_contents
 */
export function parseLiveChat(json: unknown): LiveChatParse {
  const root = record(json)
  if (root === null) return { kind: 'unknown_shape' }
  const contents = record(root.continuationContents)
  if (contents === null) return root.responseContext !== undefined ? { kind: 'no_contents' } : { kind: 'unknown_shape' }
  const chat = record(contents.liveChatContinuation)
  if (chat === null) return { kind: 'unknown_shape' }
  if (chat.actions !== undefined && !Array.isArray(chat.actions)) return { kind: 'unknown_shape' }
  if (chat.liveChatCurrentFilter === FILTERED_MODE) return { kind: 'unknown_shape' }
  const chats: InnertubeChat[] = []
  const deleted: string[] = []
  const removedAuthors: string[] = []
  const unknown: string[] = []
  let unreadable = 0
  const addItem = (item: Record<string, unknown>) => {
    for (const [type, raw] of Object.entries(item)) {
      const kind = MESSAGE_KINDS[type]
      if (kind === undefined) {
        if (!IGNORED_ITEMS.has(type)) unknown.push(type)
        continue
      }
      const body = rec(raw)
      const text = textOf(body.message)
      // 말없는 슈퍼챗·새 멤버 알림(글 없음)은 기록하지 않는다 — 읽지 못함도 아니다
      if (text.trim() === '') continue
      const id = str(body.id)
      const ch = str(body.authorExternalChannelId)
      const usec = str(body.timestampUsec)
      const publishedAt = usecToMs(usec)
      if (id === null || id === '' || ch === null || ch === '' || usec === null || publishedAt === null) {
        unreadable += 1
        continue
      }
      const badges = list(body.authorBadges).map((badge) => str(rec(rec(rec(badge).liveChatAuthorBadgeRenderer).icon).iconType))
      chats.push({ id, ch, nick: textOf(body.authorName), text, owner: badges.includes('OWNER'), publishedAt, timestampUsec: usec, kind })
    }
  }
  for (const raw of list(chat.actions)) {
    for (const [type, body] of Object.entries(rec(raw))) {
      const node = rec(body)
      switch (type) {
        case 'addChatItemAction':
          addItem(rec(node.item))
          break
        case 'replaceChatItemAction':
          // 자리 표시가 실제 메시지로 바뀜 — 같은 메시지 ID는 기록에서 한 번만
          addItem(rec(node.replacementItem))
          break
        case 'markChatItemAsDeletedAction':
        case 'removeChatItemAction': {
          const target = str(node.targetItemId)
          if (target !== null && target !== '') deleted.push(target)
          break
        }
        case 'markChatItemsByAuthorAsDeletedAction':
        case 'removeChatItemByAuthorAction': {
          const channelId = str(node.externalChannelId)
          if (channelId !== null && channelId !== '') removedAuthors.push(channelId)
          break
        }
        default:
          break
      }
    }
  }
  const { next, timeoutMs } = nextOf(chat.continuations)
  return { kind: 'ok', chats, deleted, removedAuthors, next, timeoutMs, unreadable, unknown }
}
