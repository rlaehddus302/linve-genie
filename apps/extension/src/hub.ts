// 서비스 워커의 일 (X1 YT-10 AC4~AC7). 크롬 API·서버 부르기를 받아 써서 시험할 수 있게 둔다.
// - 토큰: 팝업에서 코드를 넣으면 /ext/connect로 받아 chrome.storage.local에 둔다. 401이면 지우고 "연결이 끊겼어요".
// - 채팅: content script가 보낸 새 메시지를 Outbox로 묶어 보낸다(메모리에만).
// - 상태: content script가 10초마다(또 탭이 숨거나 보일 때) 보내는 상태를 /ext/status로 넘기고, 아이콘 배지를 바꾼다.
// - 출력하지 않는다(console 없음) — 닉네임·본문·토큰이 어디에도 찍히지 않게(AC9).
import { createApi, type Api, type Fetch } from './api.ts'
import type { ChromeLike } from './chrome.ts'
import { Outbox, type OutboxEvent, type Timers } from './outbox.ts'
import type { ChatMessage } from './reader.ts'
import { WORDS } from './words.ts'

export const TOKEN_KEY = 'token'

/** content script → 서비스 워커 */
export type PageMessage =
  | { readonly type: 'chats'; readonly v: string; readonly messages: readonly ChatMessage[] }
  | { readonly type: 'status'; readonly v: string | null; readonly hidden: boolean; readonly read: number; readonly unread: number }

/** 팝업 → 서비스 워커 */
export type PopupMessage =
  | { readonly type: 'view' }
  | { readonly type: 'connect'; readonly code: string }
  | { readonly type: 'forget' }
  | { readonly type: 'broadcasts' }
  | { readonly type: 'bind'; readonly broadcast: string }

export type Light = 'off' | 'ok' | 'warn' | 'bad'

/** 팝업이 보이는 모습 */
export interface HubView {
  readonly connected: boolean
  readonly video: string | null
  /** 지금 상태 한 줄 (쉬운 말) */
  readonly message: string
  readonly light: Light
  readonly notBound: boolean
  readonly dropped: number
  readonly hidden: boolean
}

export interface BroadcastChoice {
  readonly id: string
  readonly date: string
  readonly title: string
}

/** 배지: 받는 중은 초록 "ON", 숨은 탭·회차 고르기는 주황 "!", 끊김·읽지 못함은 빨강 "!" (D-X1-11 — 색과 글자 둘 다) */
export function badgeFor(light: Light): { readonly text: string; readonly color: string } {
  switch (light) {
    case 'ok':
      return { text: 'ON', color: '#1e7d32' }
    case 'warn':
      return { text: '!', color: '#e65100' }
    case 'bad':
      return { text: '!', color: '#c62828' }
    default:
      return { text: '', color: '#757575' }
  }
}

const browserTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export class Hub {
  readonly #chrome: ChromeLike
  readonly #api: Api
  readonly #outbox: Outbox
  #token: string | null = null
  #loaded: Promise<void>
  #video: string | null = null
  #hidden = false
  #notBound = new Set<string>()
  #ended = new Set<string>()
  #serverState: string | null = null
  #serverMessage: string | null = null
  #failing: string | null = null
  #disconnected = false

  constructor(chrome: ChromeLike, origin: string, fetcher?: Fetch, timers: Timers = browserTimers) {
    this.#chrome = chrome
    this.#api = createApi(origin, () => this.#token, fetcher)
    this.#outbox = new Outbox(this.#api, timers, (event) => this.#onOutbox(event))
    this.#loaded = this.#load()
  }

  async #load(): Promise<void> {
    const stored = await this.#chrome.storage.local.get([TOKEN_KEY])
    const token = stored[TOKEN_KEY]
    this.#token = typeof token === 'string' && token !== '' ? token : null
  }

  get outbox(): Outbox {
    return this.#outbox
  }

  /** 메시지 하나 처리 (content script·팝업). 응답이 없으면 undefined */
  async handle(message: unknown): Promise<unknown> {
    await this.#loaded
    if (!isRecord(message) || typeof message['type'] !== 'string') return undefined
    const m = message as PageMessage | PopupMessage
    switch (m.type) {
      case 'chats':
        this.#video = m.v
        if (this.#token !== null && !this.#ended.has(m.v)) this.#outbox.add(m.v, m.messages)
        return undefined
      case 'status':
        return this.#status(m)
      case 'view':
        return this.view()
      case 'connect':
        return this.#connect(m.code)
      case 'forget':
        await this.#forget()
        return this.view()
      case 'broadcasts':
        return this.#broadcasts()
      case 'bind':
        return this.#bind(m.broadcast)
      default:
        return undefined
    }
  }

  view(): HubView {
    const connected = this.#token !== null
    const notBound = this.#video !== null && this.#notBound.has(this.#video)
    let message: string
    let light: Light
    if (!connected) {
      message = this.#disconnected ? WORDS.DISCONNECTED : WORDS.NOT_CONNECTED
      light = this.#disconnected ? 'bad' : 'off'
    } else if (this.#video === null) {
      message = WORDS.NO_CHAT
      light = 'off'
    } else if (this.#ended.has(this.#video)) {
      message = WORDS.ENDED
      light = 'off'
    } else if (notBound) {
      message = WORDS.NOT_BOUND
      light = 'warn'
    } else if (this.#hidden) {
      message = WORDS.HIDDEN
      light = 'warn'
    } else if (this.#serverState === 'UNREADABLE' || this.#serverState === 'STALE') {
      message = this.#serverMessage ?? WORDS.NO_CHAT
      light = 'bad'
    } else if (this.#failing !== null) {
      message = this.#failing
      light = 'warn'
    } else {
      message = WORDS.RECEIVING
      light = 'ok'
    }
    return { connected, video: this.#video, message, light, notBound, dropped: this.#outbox.dropped, hidden: this.#hidden }
  }

  async #badge(): Promise<void> {
    const view = this.view()
    const badge = badgeFor(view.light)
    await this.#chrome.action.setBadgeText({ text: badge.text })
    await this.#chrome.action.setBadgeBackgroundColor({ color: badge.color })
    await this.#chrome.action.setTitle({ title: `라이브지니 — ${view.message}` })
  }

  async #status(m: Extract<PageMessage, { type: 'status' }>): Promise<HubView> {
    if (m.v !== null) this.#video = m.v
    this.#hidden = m.hidden
    if (this.#token !== null) {
      const body: Record<string, unknown> = { hidden: m.hidden, read: m.read, unread: m.unread, dropped: this.#outbox.dropped }
      if (m.v !== null) body['v'] = m.v
      const result = await this.#api.call('POST', '/ext/status', body)
      if (result.status === 401) await this.#lost()
      else if (result.status === 200 && result.body !== null) {
        this.#serverState = typeof result.body['state'] === 'string' ? result.body['state'] : null
        this.#serverMessage = typeof result.body['message'] === 'string' ? result.body['message'] : null
      }
    }
    await this.#badge()
    return this.view()
  }

  #onOutbox(event: OutboxEvent): void {
    switch (event.kind) {
      case 'sent':
        this.#failing = null
        this.#notBound.delete(event.v)
        break
      case 'notBound':
        this.#notBound.add(event.v)
        break
      case 'ended':
        this.#ended.add(event.v)
        break
      case 'failing':
        this.#failing = event.message
        break
      case 'disconnected':
        void this.#lost()
        return
    }
    void this.#badge()
  }

  async #lost(): Promise<void> {
    this.#token = null
    this.#disconnected = true
    this.#outbox.stop()
    await this.#chrome.storage.local.remove([TOKEN_KEY])
    await this.#badge()
  }

  async #forget(): Promise<void> {
    this.#token = null
    this.#disconnected = false
    this.#outbox.stop()
    await this.#chrome.storage.local.remove([TOKEN_KEY])
    await this.#badge()
  }

  async #connect(raw: string): Promise<{ readonly ok: boolean; readonly message: string; readonly view: HubView }> {
    const code = raw.replace(/[\s-]/g, '')
    if (!/^\d{8}$/.test(code)) return { ok: false, message: WORDS.CODE_FORMAT, view: this.view() }
    const result = await this.#api.call('POST', '/ext/connect', { code })
    const token = result.body?.['token']
    if (result.status !== 200 || typeof token !== 'string') return { ok: false, message: result.message ?? WORDS.CODE_FORMAT, view: this.view() }
    this.#token = token
    this.#disconnected = false
    this.#notBound.clear()
    this.#ended.clear()
    await this.#chrome.storage.local.set({ [TOKEN_KEY]: token })
    this.#outbox.resume()
    await this.#badge()
    return { ok: true, message: WORDS.CONNECTED, view: this.view() }
  }

  async #broadcasts(): Promise<{ readonly bound: BroadcastChoice | null; readonly broadcasts: readonly BroadcastChoice[]; readonly message: string | null }> {
    if (this.#token === null || this.#video === null) return { bound: null, broadcasts: [], message: null }
    const result = await this.#api.call('GET', `/ext/broadcasts?v=${encodeURIComponent(this.#video)}`)
    if (result.status === 401) {
      await this.#lost()
      return { bound: null, broadcasts: [], message: WORDS.DISCONNECTED }
    }
    if (result.status !== 200 || result.body === null) return { bound: null, broadcasts: [], message: result.message }
    const bound = choiceOf(result.body['bound'])
    if (bound !== null) {
      this.#notBound.delete(this.#video)
      await this.#badge()
    }
    const list = Array.isArray(result.body['broadcasts']) ? result.body['broadcasts'].map(choiceOf).filter((item): item is BroadcastChoice => item !== null) : []
    return { bound, broadcasts: list, message: null }
  }

  async #bind(broadcast: string): Promise<{ readonly ok: boolean; readonly message: string | null }> {
    if (this.#token === null || this.#video === null) return { ok: false, message: WORDS.NO_CHAT }
    const result = await this.#api.call('POST', '/ext/bind', { v: this.#video, broadcast })
    if (result.status === 401) {
      await this.#lost()
      return { ok: false, message: WORDS.DISCONNECTED }
    }
    if (result.status !== 200) return { ok: false, message: result.message }
    this.#notBound.delete(this.#video)
    await this.#badge()
    return { ok: true, message: null }
  }
}

function choiceOf(value: unknown): BroadcastChoice | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null
  return { id: value['id'], date: typeof value['date'] === 'string' ? value['date'] : '', title: typeof value['title'] === 'string' ? value['title'] : '' }
}
