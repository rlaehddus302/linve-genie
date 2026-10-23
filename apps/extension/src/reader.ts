// 유튜브 라이브 채팅 화면 읽기 (X1 YT-10 AC1·AC2, D-X1-02~05). 확장의 content script가 쓴다 — 여기엔 크롬 API가 없어 가짜 페이지로 시험한다.
// - 읽는 곳: www.youtube.com/live_chat 만(팝아웃·시청 페이지 안 iframe). live_chat_replay(다시 보기)와 다른 페이지는 아무것도 하지 않는다.
// - 읽는 법: 목록을 MutationObserver로 보고 **새로 붙은 일반 채팅 요소만** 읽는다. 관찰을 시작할 때 이미 있던 메시지는 보내지 않는다.
// - 메시지 ID·작성자 채널 ID·게시 시각을 못 꺼내면 보내지 않고 "읽지 못함"으로 센다(D-X1-04·D-X1-28).
// - 읽기는 화면을 바꾸지 않는다: 누르기·입력 없음, 유튜브 내부 요청을 가로채거나 부르지 않는다. 채팅 내용을 남기지(저장·출력) 않는다.
//   감사 글 올리기(선택, AC11~AC17)는 poster.ts가 따로 한다.
import {
  AUTHOR_NAME,
  BRIDGE_EVENT,
  CHANNEL_ATTR,
  LIVE_CHAT_PATH,
  MESSAGE_BODY,
  MESSAGE_ID_ATTR,
  OWNER_MSG_ATTR,
  POSTED_AT_ATTR,
  TEXT_MESSAGE_TAG,
  YOUTUBE_HOST,
} from './selectors.ts'

/** 서버로 보내는 메시지 하나 (서버 /ext/chats 계약) */
export interface ChatMessage {
  readonly id: string
  readonly ch: string
  readonly nick: string
  readonly text: string
  /** 게시 시각 (UTC 밀리초 정수) */
  readonly at: number
  /** 방송자(채널 주인) 표시가 붙은 글 — 서버가 회차 채널과 같을 때만 방송자로 인정한다 (D-X1-29) */
  readonly owner?: true
}

const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/
const MESSAGE_ID_RE = /^[A-Za-z0-9_\-.%=+/:]{1,256}$/
const CHANNEL_RE = /^[A-Za-z0-9_-]{1,64}$/
const NICK_MAX = 200
const TEXT_MAX = 2000

function parse(href: string): URL | null {
  try {
    return new URL(href)
  } catch {
    return null
  }
}

/** 읽을 페이지인가: https://www.youtube.com/live_chat (다시 보기 live_chat_replay·다른 경로·다른 사이트는 아니다) */
export function isLiveChatPage(href: string): boolean {
  const url = parse(href)
  return url !== null && url.protocol === 'https:' && url.hostname === YOUTUBE_HOST && url.pathname.replace(/\/+$/, '') === LIVE_CHAT_PATH
}

/** 주소의 영상 ID: ?v= 또는 /live/<ID>·/watch?v= (없으면 null) */
function videoOf(href: string | null): string | null {
  if (href === null) return null
  const url = parse(href)
  if (url === null || url.hostname !== YOUTUBE_HOST) return null
  const v = url.searchParams.get('v')
  if (v !== null && VIDEO_RE.test(v)) return v
  const live = /^\/live\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)
  return live?.[1] ?? null
}

/** 채팅 페이지의 영상 ID: 채팅 주소의 v=, 없으면(시청 페이지 안 iframe) 바깥 시청 페이지 주소에서 */
export function videoIdOf(chatHref: string, topHref: string | null): string | null {
  return videoOf(chatHref) ?? videoOf(topHref)
}

/** 본문 글자: 글자는 그대로, 이모지 그림은 대체 글자(alt)로 */
function textOf(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) out += child.nodeValue ?? ''
    else if (child.nodeType === 1) {
      const element = child as Element
      out += element.tagName === 'IMG' ? (element.getAttribute('alt') ?? '') : textOf(element)
    }
  }
  return out
}

/** 페이지 쪽 스크립트에게 그 요소의 채널 ID·게시 시각을 붙여 달라고 한다 (같은 문서의 이벤트는 바로 처리된다) */
export function askBridge(element: Element): void {
  element.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { bubbles: true, composed: true }))
}

export type ReadResult = { readonly kind: 'message'; readonly message: ChatMessage } | { readonly kind: 'unread' } | { readonly kind: 'skip' }

/**
 * 요소 하나 읽기. 일반 채팅이 아니면 skip(슈퍼챗·멤버십·시스템 등 — 세지도 않는다).
 * 메시지 ID·작성자 채널 ID·게시 시각이 없거나 모양이 틀리면 unread (게시 시각을 지금 시각으로 채우지 않는다 — D-X1-28). 본문이 비면 skip(주문이 될 수 없다).
 */
export function readMessage(element: Element, _now: () => number, ask: (element: Element) => void = askBridge): ReadResult {
  if (element.tagName !== TEXT_MESSAGE_TAG) return { kind: 'skip' }
  const id = element.getAttribute(MESSAGE_ID_ATTR) ?? ''
  if (!element.hasAttribute(CHANNEL_ATTR)) ask(element)
  const ch = element.getAttribute(CHANNEL_ATTR) ?? ''
  const atRaw = element.getAttribute(POSTED_AT_ATTR)
  const owner = element.getAttribute(OWNER_MSG_ATTR) === '1'
  element.removeAttribute(CHANNEL_ATTR)
  element.removeAttribute(POSTED_AT_ATTR)
  element.removeAttribute(OWNER_MSG_ATTR)
  if (!MESSAGE_ID_RE.test(id) || !CHANNEL_RE.test(ch)) return { kind: 'unread' }
  const parsed = atRaw === null || !/^\d{1,16}$/.test(atRaw) ? Number.NaN : Number(atRaw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { kind: 'unread' }
  const body = element.querySelector(MESSAGE_BODY)
  const text = (body === null ? '' : textOf(body)).trim().slice(0, TEXT_MAX)
  if (text === '') return { kind: 'skip' }
  const nick = (element.querySelector(AUTHOR_NAME)?.textContent ?? '').trim().slice(0, NICK_MAX)
  return { kind: 'message', message: { id, ch, nick, text, at: parsed, ...(owner ? { owner: true as const } : {}) } }
}

export interface ReaderCounts {
  /** 읽어 보낸 수 (켠 뒤 누적) */
  readonly read: number
  /** 읽지 못한 수 (켠 뒤 누적) */
  readonly unread: number
}

export interface ChatReaderOptions {
  readonly document: Document
  readonly onMessages: (messages: readonly ChatMessage[]) => void
  readonly now?: () => number
  readonly ask?: (element: Element) => void
}

/** 같은 메시지 요소가 다시 붙어도 한 번만 (최근 ID 몇 개만 기억 — 서버도 같은 ID는 한 번만 기록한다) */
const RECENT_IDS = 2000

export class ChatReader {
  readonly #doc: Document
  readonly #onMessages: (messages: readonly ChatMessage[]) => void
  readonly #now: () => number
  readonly #ask: (element: Element) => void
  readonly #before = new WeakSet<Element>()
  readonly #recent: string[] = []
  readonly #recentSet = new Set<string>()
  #observer: MutationObserver | null = null
  #read = 0
  #unread = 0

  constructor(options: ChatReaderOptions) {
    this.#doc = options.document
    this.#onMessages = options.onMessages
    this.#now = options.now ?? (() => Date.now())
    this.#ask = options.ask ?? askBridge
  }

  get counts(): ReaderCounts {
    return { read: this.#read, unread: this.#unread }
  }

  get running(): boolean {
    return this.#observer !== null
  }

  /** 관찰 시작. 읽을 페이지가 아니면 아무것도 하지 않고 false */
  start(href: string = this.#doc.location?.href ?? ''): boolean {
    if (this.#observer !== null) return true
    if (!isLiveChatPage(href)) return false
    // 지금 화면에 있는 메시지는 보내지 않는다 (AC2)
    for (const element of Array.from(this.#doc.getElementsByTagName(TEXT_MESSAGE_TAG.toLowerCase()))) this.#before.add(element)
    const view = this.#doc.defaultView
    if (view === null) return false
    this.#observer = new view.MutationObserver((records) => this.#take(records))
    this.#observer.observe(this.#doc.documentElement, { childList: true, subtree: true })
    return true
  }

  stop(): void {
    this.#observer?.disconnect()
    this.#observer = null
  }

  /** 시험·종료 직전: 쌓인 변화를 바로 처리한다 */
  flush(): void {
    const records = this.#observer?.takeRecords() ?? []
    if (records.length > 0) this.#take(records)
  }

  #take(records: readonly MutationRecord[]): void {
    const found: Element[] = []
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== 1) continue
        const element = node as Element
        if (element.tagName === TEXT_MESSAGE_TAG) found.push(element)
        else for (const inner of Array.from(element.getElementsByTagName(TEXT_MESSAGE_TAG.toLowerCase()))) found.push(inner)
      }
    }
    const out: ChatMessage[] = []
    for (const element of found) {
      if (this.#before.has(element)) continue
      this.#before.add(element)
      const result = readMessage(element, this.#now, this.#ask)
      if (result.kind === 'unread') this.#unread++
      if (result.kind !== 'message') continue
      if (this.#recentSet.has(result.message.id)) continue
      this.#remember(result.message.id)
      this.#read++
      out.push(result.message)
    }
    if (out.length > 0) this.#onMessages(out)
  }

  #remember(id: string): void {
    this.#recent.push(id)
    this.#recentSet.add(id)
    if (this.#recent.length > RECENT_IDS) {
      const old = this.#recent.shift()
      if (old !== undefined) this.#recentSet.delete(old)
    }
  }
}
