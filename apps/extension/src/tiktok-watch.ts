// 틱톡 content script의 일 (TTX D-TTX-02·03·09). 틱톡 웹은 한 화면 앱이라 주소가 바뀌어도 페이지를 새로 열지 않는다 —
// 1초마다 주소를 보고, 내 방송 화면(/@<판매자 아이디>/live)일 때만 댓글 관찰을 켠다. 맞지 않게 되면 바로 끄고,
// 서비스 워커에 그 화면의 아직 보내지 않은 댓글을 버리라고 알린다(ttLeave).
// 10초마다(또 탭이 숨거나 보일 때·화면 종류가 바뀔 때) 상태(화면 종류·뒤로 감·읽은 수·읽지 못한 수)를 넘긴다.
import { asciiLower, screenOf, tiktokPageOf, TikTokReader, type TikTokScreen } from './tiktok-reader.ts'
import type { TikTokInfoReply } from './tiktok-hub.ts'

export const TT_CHECK_MS = 1000
export const TT_STATUS_MS = 10_000

export interface IntervalTimers {
  every(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

export interface TikTokWatcherOptions {
  readonly document: Document
  /** 지금 주소 (시험은 가짜 주소) */
  readonly href: () => string
  /** 서비스 워커에 묻기 (답이 없으면 undefined) */
  readonly ask: (message: unknown) => Promise<unknown>
  readonly timers: IntervalTimers
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export class TikTokWatcher {
  readonly #o: TikTokWatcherOptions
  readonly #reader: TikTokReader
  #connected = false
  #sellerId: string | null = null
  /** 관찰 중인 화면의 아이디 (주소에 적힌 그대로) — 관찰 중이 아니면 null */
  #pageId: string | null = null
  #screen: TikTokScreen | null = null
  readonly #handles: unknown[] = []
  readonly #onVisibility = () => void this.status()

  constructor(options: TikTokWatcherOptions) {
    this.#o = options
    this.#reader = new TikTokReader({
      document: options.document,
      onComments: (items) => {
        if (this.#pageId !== null) void this.#o.ask({ type: 'ttChats', pageId: this.#pageId, items })
      },
      stillOwn: () => {
        const own = this.#isOwnNow()
        if (!own) queueMicrotask(() => this.check())
        return own
      },
    })
  }

  get reader(): TikTokReader {
    return this.#reader
  }

  /** 관찰 중인 화면 아이디 (시험용) */
  get observing(): string | null {
    return this.#pageId
  }

  async start(): Promise<void> {
    await this.refresh()
    this.check()
    void this.status()
    this.#handles.push(this.#o.timers.every(() => this.check(), TT_CHECK_MS))
    this.#handles.push(this.#o.timers.every(() => void this.status(), TT_STATUS_MS))
    this.#o.document.addEventListener('visibilitychange', this.#onVisibility)
  }

  stop(): void {
    for (const handle of this.#handles.splice(0)) this.#o.timers.cancel(handle)
    this.#o.document.removeEventListener('visibilitychange', this.#onVisibility)
    this.#leave()
  }

  /** 서비스 워커에게 연결·판매자 아이디를 묻는다 */
  async refresh(): Promise<void> {
    this.#apply(await this.#o.ask({ type: 'ttInfo' }))
  }

  #apply(reply: unknown): void {
    if (!isRecord(reply)) return
    const info = reply as Partial<TikTokInfoReply>
    this.#connected = info.connected === true
    this.#sellerId = typeof info.tiktokId === 'string' && info.tiktokId !== '' ? info.tiktokId : null
  }

  #isOwnNow(): boolean {
    if (this.#pageId === null) return false
    const page = tiktokPageOf(this.#o.href())
    return page !== null && page.kind === 'live' && asciiLower(page.id) === asciiLower(this.#pageId)
  }

  /** 주소를 보고 관찰을 켜거나 끈다 (화면 종류가 바뀌면 상태를 바로 보낸다) */
  check(): void {
    const page = tiktokPageOf(this.#o.href())
    const screen = screenOf(page, this.#sellerId)
    const own = this.#connected && screen === 'OWN' && page !== null && page.kind === 'live'
    if (own) {
      if (this.#pageId === null || asciiLower(this.#pageId) !== asciiLower(page.id)) {
        if (this.#pageId !== null) this.#leave()
        this.#pageId = page.id
        this.#reader.start()
      }
    } else if (this.#pageId !== null) this.#leave()
    if (screen !== this.#screen) {
      const first = this.#screen === null
      this.#screen = screen
      if (!first) void this.status()
    }
  }

  #leave(): void {
    if (this.#pageId === null) return
    this.#reader.stop()
    this.#pageId = null
    void this.#o.ask({ type: 'ttLeave' })
  }

  async status(): Promise<void> {
    const page = tiktokPageOf(this.#o.href())
    const screen = screenOf(page, this.#sellerId)
    const reply = await this.#o.ask({ type: 'ttStatus', screen, hidden: this.#o.document.hidden, ...this.#reader.counts })
    const before = `${String(this.#connected)}:${this.#sellerId ?? ''}`
    this.#apply(reply)
    if (`${String(this.#connected)}:${this.#sellerId ?? ''}` !== before) this.check()
  }
}
