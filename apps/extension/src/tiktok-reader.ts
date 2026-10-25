// 틱톡 라이브 댓글 읽기 (TTX PLT-02 확장 대비책, D-TTX-02~05). 틱톡 content script가 쓴다 — 크롬 API가 없어 가짜 페이지로 시험한다.
// - 읽는 곳: www.tiktok.com/@<판매자 아이디>/live 만. 아이디는 ASCII 소문자로 비교한다(D-TTX-03). 그 밖의 틱톡 화면·다른 사이트는 읽지 않는다.
// - 읽는 법: MutationObserver로 **새로 붙은 일반 댓글 요소만** 읽는다. 관찰을 시작할 때 이미 있던 댓글은 보내지 않는다(D-TTX-05).
// - 필수 값(댓글 ID·숫자 사용자 ID·쓴 사람 아이디·본문)을 못 꺼내면 보내지 않고 "읽지 못함"으로 센다(D-TTX-04). 시각은 보내지 않는다(서버가 받은 순서 — D-TTX-06).
// - 읽기만 한다: 누르기·입력·이벤트 보내기 없음, 틱톡 요청을 가로채거나 부르지 않음, 쿠키를 읽지 않음, 댓글 내용을 남기지(저장·출력) 않는다(D-TTX-01·13).
import {
  TIKTOK_HOST,
  TIKTOK_LIVE_PATH,
  TT_COMMENT,
  TT_COMMENT_ID_ATTR,
  TT_NICKNAME,
  TT_TEXT,
  TT_UNIQUE_ID_ATTR,
  TT_USER_ID_ATTR,
} from './tiktok-selectors.ts'

/** 서버로 보내는 틱톡 댓글 하나 (서버 /ext/tiktok/chats 항목 계약 — ID는 10진 문자열) */
export interface TikTokItem {
  readonly commentId: string
  readonly userId: string
  readonly uniqueId: string
  readonly nickname: string
  readonly text: string
}

/** 화면 종류 (서버 /ext/tiktok/status의 screen) — 내 방송 · 남의 방송 · 그 밖의 틱톡 화면 */
export type TikTokScreen = 'OWN' | 'OTHER' | 'ELSEWHERE'

/** 틱톡 주소 → 라이브 방송 아이디(주소에 적힌 그대로) · 그 밖의 틱톡 화면 · 틱톡이 아님 */
export type TikTokPage = { readonly kind: 'live'; readonly id: string } | { readonly kind: 'elsewhere' } | null

const DECIMAL_ID_RE = /^[1-9][0-9]{0,31}$/
const UNIQUE_ID_MAX = 64
const NICKNAME_MAX = 200
/** 본문은 서버 한도(500자)보다 조금 길게만 보낸다 — 넘는 글은 서버가 TEXT_TOO_LONG으로 버린다(잘라서 다른 글로 만들지 않는다) */
const TEXT_MAX = 600
/** 그 화면에서 기억하는 최근 댓글 ID 수 (D-TTX-05) */
export const TIKTOK_RECENT_IDS = 20_000

function parse(href: string): URL | null {
  try {
    return new URL(href)
  } catch {
    return null
  }
}

export function tiktokPageOf(href: string): TikTokPage {
  const url = parse(href)
  if (url === null || url.protocol !== 'https:' || url.hostname !== TIKTOK_HOST) return null
  const live = TIKTOK_LIVE_PATH.exec(url.pathname)
  if (live?.[1] === undefined) return { kind: 'elsewhere' }
  let id: string
  try {
    id = decodeURIComponent(live[1])
  } catch {
    return { kind: 'elsewhere' }
  }
  return id === '' ? { kind: 'elsewhere' } : { kind: 'live', id }
}

/** www.tiktok.com 화면인가 (서비스 워커가 보낸 곳을 확인할 때) */
export function isTikTokPage(href: string): boolean {
  return tiktokPageOf(href) !== null
}

/** 아이디 비교용: 다듬고 ASCII 글자만 소문자로 (서버와 같은 규칙 — D-TTX-03) */
export function asciiLower(value: string): string {
  return value.trim().replace(/[A-Z]/g, (ch) => ch.toLowerCase())
}

/** 화면 종류: 판매자 아이디가 없으면 내 방송이라고 하지 않는다 */
export function screenOf(page: TikTokPage, sellerId: string | null): TikTokScreen {
  if (page === null || page.kind !== 'live') return 'ELSEWHERE'
  if (sellerId === null || sellerId === '') return 'OTHER'
  return asciiLower(page.id) === asciiLower(sellerId) ? 'OWN' : 'OTHER'
}

/** 코드 포인트 max개까지 */
function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
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

export type TikTokReadResult = { readonly kind: 'comment'; readonly item: TikTokItem } | { readonly kind: 'unread' } | { readonly kind: 'skip' }

/**
 * 요소 하나 읽기. 일반 댓글 요소가 아니면 skip(선물·입장·좋아요·시스템 — 세지도 않는다).
 * 댓글 ID·숫자 사용자 ID(0으로 시작하지 않는 10진 숫자)·쓴 사람 아이디·본문 중 하나라도 없거나 모양이 틀리면 unread. 닉네임은 없어도 된다.
 */
export function readComment(element: Element): TikTokReadResult {
  if (!element.matches(TT_COMMENT)) return { kind: 'skip' }
  const commentId = (element.getAttribute(TT_COMMENT_ID_ATTR) ?? '').trim()
  const userId = (element.getAttribute(TT_USER_ID_ATTR) ?? '').trim()
  const uniqueId = (element.getAttribute(TT_UNIQUE_ID_ATTR) ?? '').trim()
  const body = element.querySelector(TT_TEXT)
  const text = clip((body === null ? '' : textOf(body)).trim(), TEXT_MAX)
  if (!DECIMAL_ID_RE.test(commentId) || !DECIMAL_ID_RE.test(userId) || uniqueId === '' || Array.from(uniqueId).length > UNIQUE_ID_MAX || text === '') return { kind: 'unread' }
  const nickname = clip((element.querySelector(TT_NICKNAME)?.textContent ?? '').trim(), NICKNAME_MAX)
  return { kind: 'comment', item: { commentId, userId, uniqueId, nickname, text } }
}

export interface TikTokCounts {
  /** 읽어 넘긴 수 (켠 뒤 누적) */
  readonly read: number
  /** 읽지 못한 수 (켠 뒤 누적) */
  readonly unread: number
}

export interface TikTokReaderOptions {
  readonly document: Document
  readonly onComments: (items: readonly TikTokItem[]) => void
  /** 변화가 왔을 때 아직 내 방송 화면인가 — 아니면 그 변화는 읽지 않는다(주소가 바뀐 뒤 붙은 댓글 — AC-TTX-07) */
  readonly stillOwn?: () => boolean
}

export class TikTokReader {
  readonly #doc: Document
  readonly #onComments: (items: readonly TikTokItem[]) => void
  readonly #stillOwn: () => boolean
  #before = new WeakSet<Element>()
  readonly #recent: string[] = []
  readonly #recentSet = new Set<string>()
  #observer: MutationObserver | null = null
  #read = 0
  #unread = 0

  constructor(options: TikTokReaderOptions) {
    this.#doc = options.document
    this.#onComments = options.onComments
    this.#stillOwn = options.stillOwn ?? (() => true)
  }

  get counts(): TikTokCounts {
    return { read: this.#read, unread: this.#unread }
  }

  get running(): boolean {
    return this.#observer !== null
  }

  /** 관찰 시작 — 지금 화면에 있는 댓글은 보내지 않는다(그 ID도 기억해 다시 그려져도 보내지 않는다) */
  start(): boolean {
    if (this.#observer !== null) return true
    const view = this.#doc.defaultView
    if (view === null) return false
    this.#before = new WeakSet<Element>()
    for (const element of Array.from(this.#doc.querySelectorAll(TT_COMMENT))) {
      this.#before.add(element)
      const id = (element.getAttribute(TT_COMMENT_ID_ATTR) ?? '').trim()
      if (DECIMAL_ID_RE.test(id)) this.#remember(id)
    }
    this.#observer = new view.MutationObserver((records) => this.#take(records))
    this.#observer.observe(this.#doc.documentElement, { childList: true, subtree: true })
    return true
  }

  /** 관찰을 멈춘다. 아직 넘기지 않은 변화는 버린다 */
  stop(): void {
    this.#observer?.takeRecords()
    this.#observer?.disconnect()
    this.#observer = null
  }

  /** 시험·멈추기 직전: 쌓인 변화를 바로 처리한다 */
  flush(): void {
    const records = this.#observer?.takeRecords() ?? []
    if (records.length > 0) this.#take(records)
  }

  #take(records: readonly MutationRecord[]): void {
    if (!this.#stillOwn()) return
    const found: Element[] = []
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== 1) continue
        const element = node as Element
        if (element.matches(TT_COMMENT)) found.push(element)
        else for (const inner of Array.from(element.querySelectorAll(TT_COMMENT))) found.push(inner)
      }
    }
    const out: TikTokItem[] = []
    for (const element of found) {
      if (this.#before.has(element)) continue
      this.#before.add(element)
      const result = readComment(element)
      if (result.kind === 'unread') this.#unread++
      if (result.kind !== 'comment') continue
      if (this.#recentSet.has(result.item.commentId)) continue
      this.#remember(result.item.commentId)
      this.#read++
      out.push(result.item)
    }
    if (out.length > 0) this.#onComments(out)
  }

  #remember(id: string): void {
    if (this.#recentSet.has(id)) return
    this.#recent.push(id)
    this.#recentSet.add(id)
    if (this.#recent.length > TIKTOK_RECENT_IDS) {
      const old = this.#recent.shift()
      if (old !== undefined) this.#recentSet.delete(old)
    }
  }
}
