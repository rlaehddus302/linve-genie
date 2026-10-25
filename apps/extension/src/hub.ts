// 서비스 워커의 일 (X1 YT-10 AC4~AC7). 크롬 API·서버 부르기를 받아 써서 시험할 수 있게 둔다.
// - 토큰: 팝업에서 코드를 넣으면 /ext/connect로 받아 chrome.storage.local에 둔다. 401이면 지우고 "연결이 끊겼어요".
// - 채팅: content script가 보낸 새 메시지를 Outbox로 묶어 보낸다. 못 보낸 것은 chrome.storage.session에 두어 워커가 다시 떠도 이어 보낸다(D-X1-27).
// - 회차: 영상마다 이어졌는지를 서버에 물어 안다. 모르면 "받는 중"이라 하지 않는다(TE-X1-003).
// - 감사 올리기(선택, AC11~AC17): content script(poster.ts)의 가져가기·결과를 /ext/thanks/*로 넘긴다. 글은 서버가 만든 것만.
// - 팝업 전용 메시지(연결·지우기·회차)는 확장 페이지에서 온 것만, 채팅·상태·감사는 유튜브 채팅 페이지에서 온 것만 받는다(RA-X1-04).
// - 상태: content script가 10초마다(또 탭이 숨거나 보일 때) 보내는 상태를 /ext/status로 넘기고, 아이콘 배지를 바꾼다.
//   상태는 프레임 하나의 마지막 보고가 아니라 지금 영상(회차에 이어진 영상 먼저)의 모든 프레임을 합쳐 정한다 — 시청 페이지 안 채팅과
//   팝아웃이 함께 열려 있어도, 끝난 다른 방송의 채팅 창이 남아 있어도 상태가 왔다 갔다 하지 않게(dev-notes V3 "X1 상태 흔들림").
//   다른 영상 프레임의 보고는 서버로 보내지 않는다. 숨김은 그 영상의 어느 프레임도 HIDDEN_WARN_MS 동안 보이지 않을 때만 경고한다.
// - 출력하지 않는다(console 없음) — 닉네임·본문·토큰이 어디에도 찍히지 않게(AC9).
import { createApi, type Api, type Fetch } from './api.ts'
import type { ChromeLike, MessageSender } from './chrome.ts'
import { Outbox, type OutboxEvent, type OutboxSnapshot, type Timers } from './outbox.ts'
import { isLiveChatPage, type ChatMessage } from './reader.ts'
import { WORDS } from './words.ts'

export const TOKEN_KEY = 'token'
/** chrome.storage.session: 못 보낸 채팅 */
export const QUEUE_KEY = 'queue'

export type ThanksState = 'POST' | 'NONE' | 'OFF' | 'NOT_BOUND' | 'NOT_OWNER' | 'PAUSED'
export type ThanksOutcome = 'POSTED' | 'UNCONFIRMED' | 'NOT_POSTED'

/** 가져가기 답 (content script로) */
export interface TakeReply {
  readonly state: ThanksState
  readonly post: { readonly ids: readonly number[]; readonly text: string; readonly until: string } | null
  /** 다시 물어도 되는 때까지 (밀리초) */
  readonly afterMs: number | null
  readonly message: string | null
}

/** content script → 서비스 워커 */
export type PageMessage =
  | { readonly type: 'chats'; readonly v: string; readonly messages: readonly ChatMessage[] }
  | { readonly type: 'status'; readonly v: string | null; readonly hidden: boolean; readonly read: number; readonly unread: number }
  | { readonly type: 'thanksTake'; readonly v: string; readonly meIsOwner: boolean; readonly owner: string | null }
  | { readonly type: 'thanksResult'; readonly ids: readonly number[]; readonly result: ThanksOutcome }

const PAGE_TYPES = new Set(['chats', 'status', 'thanksTake', 'thanksResult'])
const POPUP_TYPES = new Set(['view', 'connect', 'forget', 'broadcasts', 'bind'])

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
  /** 감사 올리기 경고 (채널 주인 아님·멈춤) — 없으면 null */
  readonly thanks: string | null
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

/** 그 영상의 어느 채팅 프레임도 이만큼 보이지 않으면 "앞으로 꺼내 두세요" (보고 10초 × 3 — 잠깐 다른 탭을 보는 것은 경고하지 않는다) */
export const HIDDEN_WARN_MS = 30_000
/** 이만큼 보고가 없는 프레임은 닫힌 것으로 본다 (뒤로 간 탭은 크롬이 타이머를 1분에 한 번까지 늦춘다 — 1분 + 여유) */
export const FRAME_GONE_MS = 90_000

interface FrameReport {
  readonly v: string | null
  readonly hidden: boolean
  readonly read: number
  readonly unread: number
  readonly at: number
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
  /** 프레임(탭·프레임 번호) → 마지막 보고 */
  readonly #frames = new Map<string, FrameReport>()
  /** 영상('' = 영상을 모름) → 처음 본 때·마지막으로 보인 때 */
  readonly #seen = new Map<string, { first: number; visible: number | null }>()
  readonly #timers: Timers
  readonly #now: () => number
  #hiddenTimer: unknown = null
  /** 영상 → 회차에 이어졌는가 (모르면 없음) */
  readonly #bound = new Map<string, boolean>()
  #thanks: string | null = null
  #persist: Promise<void> = Promise.resolve()
  #ended = new Set<string>()
  #serverState: string | null = null
  #serverMessage: string | null = null
  #failing: string | null = null
  #disconnected = false

  constructor(chrome: ChromeLike, origin: string, fetcher?: Fetch, timers: Timers = browserTimers, now: () => number = () => Date.now()) {
    this.#chrome = chrome
    this.#timers = timers
    this.#now = now
    this.#api = createApi(origin, () => this.#token, fetcher)
    this.#outbox = new Outbox(
      this.#api,
      timers,
      (event) => this.#onOutbox(event),
      (snapshot) => this.#save(snapshot),
    )
    this.#loaded = this.#load()
  }

  async #load(): Promise<void> {
    const stored = await this.#chrome.storage.local.get([TOKEN_KEY])
    const token = stored[TOKEN_KEY]
    this.#token = typeof token === 'string' && token !== '' ? token : null
    const session = await this.#chrome.storage.session.get([QUEUE_KEY]).catch(() => ({}) as Record<string, unknown>)
    const saved = session[QUEUE_KEY]
    if (this.#token === null) {
      if (saved !== undefined) await this.#chrome.storage.session.remove([QUEUE_KEY]).catch(() => undefined)
      return
    }
    if (isRecord(saved) && Array.isArray(saved['items'])) this.#outbox.restore({ items: saved['items'] as OutboxSnapshot['items'], dropped: typeof saved['dropped'] === 'number' ? saved['dropped'] : 0 })
  }

  /** 붙든 채팅을 세션에 둔다 (순서대로 — 앞의 쓰기가 끝난 뒤) */
  #save(snapshot: OutboxSnapshot): void {
    const area = this.#chrome.storage.session
    this.#persist = this.#persist
      .then(() => (snapshot.items.length === 0 && snapshot.dropped === 0 ? area.remove([QUEUE_KEY]) : area.set({ [QUEUE_KEY]: { items: snapshot.items, dropped: snapshot.dropped } })))
      .catch(() => undefined)
  }

  /** 시험용: 세션 쓰기가 끝날 때까지 */
  async saved(): Promise<void> {
    await this.#persist
  }

  get outbox(): Outbox {
    return this.#outbox
  }

  /**
   * 메시지 하나 처리 (content script·팝업). 응답이 없으면 undefined.
   * sender를 주면(서비스 워커) 팝업 전용은 확장 페이지에서, 페이지 메시지는 유튜브 채팅 페이지에서 온 것만 받는다.
   */
  async handle(message: unknown, sender?: MessageSender): Promise<unknown> {
    await this.#loaded
    if (!isRecord(message) || typeof message['type'] !== 'string') return undefined
    if (sender !== undefined && !this.#allowed(message['type'], sender)) return undefined
    const m = message as PageMessage | PopupMessage
    switch (m.type) {
      case 'chats':
        if (this.#video === null) this.#video = m.v
        if (this.#token !== null && !this.#ended.has(m.v)) this.#outbox.add(m.v, m.messages)
        return undefined
      case 'status':
        return this.#status(m, sender)
      case 'thanksTake':
        return this.#take(m)
      case 'thanksResult':
        return this.#result(m)
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

  #allowed(type: string, sender: MessageSender): boolean {
    const url = sender.url ?? ''
    if (POPUP_TYPES.has(type)) return url.startsWith(`chrome-extension://${this.#chrome.runtime.id}/`)
    if (PAGE_TYPES.has(type)) return sender.tab !== undefined && isLiveChatPage(url)
    return false
  }

  view(): HubView {
    const connected = this.#token !== null
    // 이어졌는지 모르면 "받는 중"이라 하지 않는다 (TE-X1-003)
    const notBound = this.#video !== null && this.#bound.get(this.#video) !== true
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
    } else if (this.#hiddenLong(this.#now())) {
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
    if (connected && this.#thanks !== null && light === 'ok') light = 'warn'
    return { connected, video: this.#video, message, light, notBound, dropped: this.#outbox.dropped, hidden: this.#hiddenLong(this.#now()), thanks: connected ? this.#thanks : null }
  }

  async #badge(): Promise<void> {
    const view = this.view()
    const badge = badgeFor(view.light)
    await this.#chrome.action.setBadgeText({ text: badge.text })
    await this.#chrome.action.setBadgeBackgroundColor({ color: badge.color })
    await this.#chrome.action.setTitle({ title: `라이브지니 — ${view.message}` })
  }

  async #status(m: Extract<PageMessage, { type: 'status' }>, sender: MessageSender | undefined): Promise<HubView> {
    const now = this.#now()
    this.#prune(now)
    const vk = m.v ?? ''
    // 그 영상의 프레임이 하나도 없다가 새로 열렸으면 숨김 기다림을 지금부터 센다
    const fresh = ![...this.#frames.values()].some((frame) => (frame.v ?? '') === vk)
    const seen = fresh ? { first: now, visible: null } : (this.#seen.get(vk) ?? { first: now, visible: null })
    if (!m.hidden) seen.visible = now
    this.#seen.set(vk, seen)
    this.#frames.set(frameKey(sender, m.v), { v: m.v, hidden: m.hidden, read: safeCount(m.read), unread: safeCount(m.unread), at: now })
    if (this.#token !== null && m.v !== null && !this.#bound.has(m.v)) await this.#checkBound(m.v)
    this.#video = this.#pick() ?? this.#video
    // 지금 영상이 아닌 프레임(끝난 다른 방송의 채팅 창 등)의 보고는 서버 상태를 바꾸지 않는다
    const current = m.v === null ? this.#video === null : m.v === this.#video
    this.#armHiddenTimer(now)
    if (this.#token !== null && current) {
      const mine = [...this.#frames.values()].filter((frame) => frame.v === m.v)
      const body: Record<string, unknown> = {
        hidden: this.#hiddenLong(now),
        read: mine.reduce((sum, frame) => sum + frame.read, 0),
        unread: mine.reduce((sum, frame) => sum + frame.unread, 0),
        dropped: this.#outbox.dropped,
      }
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

  /** 오래 보고가 없는 프레임을 지운다 */
  #prune(now: number): void {
    for (const [key, frame] of this.#frames) if (now - frame.at > FRAME_GONE_MS) this.#frames.delete(key)
  }

  /**
   * 지금 영상: 열려 있는 프레임의 영상 중 끝나지 않은 것, 회차에 이어진 것 > 모르는 것 > 이어지지 않은 것,
   * 같으면 마지막으로 보인 것, 그다음 마지막 보고. 열린 프레임이 없으면 null (앞의 영상을 그대로 둔다).
   */
  #pick(): string | null {
    let best: { v: string; rank: number; visible: number; at: number } | null = null
    for (const frame of this.#frames.values()) {
      if (frame.v === null || this.#ended.has(frame.v)) continue
      const bound = this.#bound.get(frame.v)
      const rank = bound === true ? 2 : bound === undefined ? 1 : 0
      const visible = this.#seen.get(frame.v)?.visible ?? -1
      const better = best === null || rank > best.rank || (rank === best.rank && (visible > best.visible || (visible === best.visible && frame.at > best.at)))
      if (better) best = { v: frame.v, rank, visible, at: frame.at }
    }
    return best?.v ?? null
  }

  /** 지금 영상의 어느 프레임도 HIDDEN_WARN_MS 넘게 보이지 않았는가 */
  #hiddenLong(now: number): boolean {
    const vk = this.#video ?? ''
    const frames = [...this.#frames.values()].filter((frame) => (frame.v ?? '') === vk && now - frame.at <= FRAME_GONE_MS)
    if (frames.length === 0) return false
    const seen = this.#seen.get(vk)
    if (seen === undefined) return false
    return now - (seen.visible ?? seen.first) >= HIDDEN_WARN_MS
  }

  /** 지금 숨어 있으면, 기다림이 끝나는 때 배지를 다시 본다 (그사이 보고가 없어도 경고가 늦지 않게) */
  #armHiddenTimer(now: number): void {
    if (this.#hiddenTimer !== null) this.#timers.clear(this.#hiddenTimer)
    this.#hiddenTimer = null
    const vk = this.#video ?? ''
    const frames = [...this.#frames.values()].filter((frame) => (frame.v ?? '') === vk)
    const seen = this.#seen.get(vk)
    if (seen === undefined || frames.length === 0 || frames.some((frame) => !frame.hidden)) return
    const due = (seen.visible ?? seen.first) + HIDDEN_WARN_MS - now
    if (due <= 0) return
    this.#hiddenTimer = this.#timers.set(() => {
      this.#hiddenTimer = null
      void this.#badge()
    }, due)
  }

  #onOutbox(event: OutboxEvent): void {
    switch (event.kind) {
      case 'sent':
        this.#failing = null
        this.#bound.set(event.v, true)
        break
      case 'notBound':
        this.#bound.set(event.v, false)
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
    await this.#clear()
  }

  async #forget(): Promise<void> {
    this.#token = null
    this.#disconnected = false
    await this.#clear()
  }

  /** 토큰·못 보낸 채팅(세션)을 지운다 */
  async #clear(): Promise<void> {
    this.#outbox.stop()
    this.#bound.clear()
    this.#thanks = null
    await this.#persist
    await this.#chrome.storage.local.remove([TOKEN_KEY])
    await this.#chrome.storage.session.remove([QUEUE_KEY]).catch(() => undefined)
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
    this.#bound.clear()
    this.#ended.clear()
    await this.#chrome.storage.local.set({ [TOKEN_KEY]: token })
    this.#outbox.resume()
    if (this.#video !== null) await this.#checkBound(this.#video)
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
    this.#bound.set(this.#video, bound !== null)
    await this.#badge()
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
    this.#bound.set(this.#video, true)
    await this.#badge()
    return { ok: true, message: null }
  }

  /** 이 영상이 회차에 이어졌는지 서버에 묻는다 (YT-02로 이어진 영상이면 서버가 이때 잇는다) */
  async #checkBound(v: string): Promise<void> {
    const result = await this.#api.call('GET', `/ext/broadcasts?v=${encodeURIComponent(v)}`)
    if (result.status === 401) {
      await this.#lost()
      return
    }
    if (result.status === 200 && result.body !== null) this.#bound.set(v, choiceOf(result.body['bound']) !== null)
  }

  // ── 감사 올리기 (AC11~AC17) ─────────────────────────────────────────

  async #take(m: Extract<PageMessage, { type: 'thanksTake' }>): Promise<TakeReply> {
    if (this.#token === null) return { state: 'OFF', post: null, afterMs: null, message: null }
    const result = await this.#api.call('POST', '/ext/thanks/take', { v: m.v, meIsOwner: m.meIsOwner === true, owner: m.owner })
    if (result.status === 401) {
      await this.#lost()
      return { state: 'OFF', post: null, afterMs: null, message: null }
    }
    if (result.status !== 200 || result.body === null) {
      return { state: 'NONE', post: null, afterMs: result.retryAfterMs ?? 10_000, message: null }
    }
    const reply = takeReplyOf(result.body)
    const before = this.#thanks
    this.#thanks = reply.state === 'NOT_OWNER' || reply.state === 'PAUSED' ? reply.message : reply.state === 'NONE' || reply.state === 'POST' || reply.state === 'OFF' ? null : this.#thanks
    if (before !== this.#thanks) await this.#badge()
    return reply
  }

  async #result(m: Extract<PageMessage, { type: 'thanksResult' }>): Promise<{ readonly ok: boolean }> {
    if (this.#token === null) return { ok: false }
    const result = await this.#api.call('POST', '/ext/thanks/result', { ids: m.ids, result: m.result })
    if (result.status === 401) await this.#lost()
    return { ok: result.status === 200 }
  }
}

const THANKS_STATES: readonly string[] = ['POST', 'NONE', 'OFF', 'NOT_BOUND', 'NOT_OWNER', 'PAUSED']

/** 서버 답 → 가져가기 답 (모양이 틀리면 "지금 없음") */
export function takeReplyOf(body: Record<string, unknown>): TakeReply {
  const state = typeof body['state'] === 'string' && THANKS_STATES.includes(body['state']) ? (body['state'] as ThanksState) : 'NONE'
  const message = typeof body['message'] === 'string' ? body['message'] : null
  const afterMs = typeof body['afterMs'] === 'number' && Number.isFinite(body['afterMs']) && body['afterMs'] >= 0 ? body['afterMs'] : null
  const raw = body['post']
  if (state === 'POST') {
    if (!isRecord(raw) || typeof raw['text'] !== 'string' || raw['text'] === '' || typeof raw['until'] !== 'string' || !Array.isArray(raw['ids'])) return { state: 'NONE', post: null, afterMs: 10_000, message: null }
    const ids = raw['ids'].filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id))
    if (ids.length === 0 || ids.length !== raw['ids'].length) return { state: 'NONE', post: null, afterMs: 10_000, message: null }
    return { state, post: { ids, text: raw['text'], until: raw['until'] }, afterMs: null, message: null }
  }
  return { state, post: null, afterMs, message }
}

/** 프레임 이름: 탭 번호·프레임 번호 (보낸 곳을 모르면 영상마다 하나) */
function frameKey(sender: MessageSender | undefined, v: string | null): string {
  const tab = sender?.tab?.id
  if (tab === undefined) return `v:${v ?? ''}`
  return `${String(tab)}:${String(sender?.frameId ?? 0)}`
}

const safeCount = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0)

function choiceOf(value: unknown): BroadcastChoice | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null
  return { id: value['id'], date: typeof value['date'] === 'string' ? value['date'] : '', title: typeof value['title'] === 'string' ? value['title'] : '' }
}
