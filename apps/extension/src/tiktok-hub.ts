// 서비스 워커의 틱톡 몫 (TTX D-TTX-02·03·06~10). 유튜브 몫(hub.ts)과 대기열·상태·속도 한도를 따로 둔다. 토큰은 같다(D-TTX-01).
// - 판매자 틱톡 아이디·보내면 어떻게 되나(기록·대기·막힘)는 서버 GET /ext/tiktok에서 받는다. 틱톡 화면(content script)이 물으면 알려 준다.
// - 댓글: 틱톡 화면이 보낸 새 댓글을 TikTokOutbox로 묶어 보낸다. 못 보낸 것은 chrome.storage.session(틱톡 키 — 유튜브와 따로).
// - 상태: 탭마다 10초마다 오는 상태(화면 종류·뒤로 감·읽은 수·읽지 못한 수)를 모아, 가장 나은 탭 하나의 것을 /ext/tiktok/status로 보낸다
//   (틱톡 탭이 여럿이어도 내 방송 탭이 있으면 그것 — 다른 탭 때문에 "내 방송 화면에 있지 않아요"가 깜빡이지 않게).
// - 출력하지 않는다(console 없음). 팝업에는 정해진 문장만 보인다(영어 코드 없음).
import { NETWORK, type Api } from './api.ts'
import type { StorageArea } from './chrome.ts'
import type { Timers } from './outbox.ts'
import { isBlockCode, TikTokOutbox, type TikTokBlockCode, type TikTokOutboxEvent, type TikTokOutboxSnapshot } from './tiktok-outbox.ts'
import type { TikTokItem, TikTokScreen } from './tiktok-reader.ts'
import { TT_WORDS } from './words.ts'

/** chrome.storage.session: 못 보낸 틱톡 댓글 (유튜브 'queue'와 따로) */
export const TT_QUEUE_KEY = 'ttQueue'
/** 서버에 다시 묻기 전까지 아는 값을 쓰는 시간 */
const INFO_FRESH_MS = 10_000
/** 이만큼 상태가 오지 않은 탭은 닫힌 것으로 본다 (상태는 10초마다) */
const TAB_STALE_MS = 25_000

/** 틱톡 화면 → 서비스 워커 */
export type TikTokPageMessage =
  | { readonly type: 'ttInfo' }
  | { readonly type: 'ttChats'; readonly pageId: string; readonly items: readonly TikTokItem[] }
  | { readonly type: 'ttStatus'; readonly screen: TikTokScreen; readonly hidden: boolean; readonly read: number; readonly unread: number }
  | { readonly type: 'ttLeave' }

export const TT_PAGE_TYPES: ReadonlySet<string> = new Set(['ttInfo', 'ttChats', 'ttStatus', 'ttLeave'])

/** 틱톡 화면에 주는 답 */
export interface TikTokInfoReply {
  /** 라이브지니와 이어졌는가 (아니면 관찰하지 않는다) */
  readonly connected: boolean
  /** 판매자 틱톡 아이디 (소문자) — 없거나 모르면 null */
  readonly tiktokId: string | null
}

type Mode = 'recording' | 'standby' | 'blocked'

interface Info {
  readonly tiktokId: string | null
  readonly mode: Mode
  readonly code: TikTokBlockCode | null
  readonly at: number
}

interface TabState {
  readonly screen: TikTokScreen
  readonly hidden: boolean
  readonly read: number
  readonly unread: number
  readonly at: number
}

export type TikTokLight = 'off' | 'ok' | 'warn' | 'bad'

/** 팝업 틱톡 줄 */
export interface TikTokView {
  readonly message: string
  readonly light: TikTokLight
  /** 놓친 틱톡 댓글 문장 (없으면 null) */
  readonly overflow: string | null
}

export interface TikTokLaneOptions {
  readonly api: Api
  readonly timers: Timers
  readonly session: StorageArea
  readonly now: () => number
  readonly connected: () => boolean
  /** 팝업·배지를 다시 그릴 때 */
  readonly changed: () => void
  /** 401 — 토큰을 지운다 */
  readonly lost: () => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const SCREENS: readonly string[] = ['OWN', 'OTHER', 'ELSEWHERE']
const RANK: Readonly<Record<TikTokScreen, number>> = { OWN: 0, OTHER: 2, ELSEWHERE: 3 }
const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : 0)

export class TikTokLane {
  readonly #o: TikTokLaneOptions
  readonly #outbox: TikTokOutbox
  #persist: Promise<void> = Promise.resolve()
  #info: Info | null = null
  #asking: Promise<void> | null = null
  readonly #tabs = new Map<number | null, TabState>()
  #failing: string | null = null
  #seen = false
  /** 연결 직후 서버가 판매자 틱톡 아이디를 알려 줬다 — 틱톡 화면을 보기 전에도 틱톡 줄을 보인다(D-TTX-17) */
  #offer = false

  constructor(options: TikTokLaneOptions) {
    this.#o = options
    this.#outbox = new TikTokOutbox(
      options.api,
      options.timers,
      (event) => this.#onOutbox(event),
      (snapshot) => this.#save(snapshot),
    )
  }

  get outbox(): TikTokOutbox {
    return this.#outbox
  }

  /** 워커가 다시 떴을 때 (토큰이 있을 때만 이어 보낸다) */
  async load(hasToken: boolean): Promise<void> {
    const session = await this.#o.session.get([TT_QUEUE_KEY]).catch(() => ({}) as Record<string, unknown>)
    const saved = session[TT_QUEUE_KEY]
    if (!hasToken) {
      if (saved !== undefined) await this.#o.session.remove([TT_QUEUE_KEY]).catch(() => undefined)
      return
    }
    if (isRecord(saved) && Array.isArray(saved['items'])) {
      this.#outbox.restore({
        items: saved['items'] as TikTokOutboxSnapshot['items'],
        dropped: typeof saved['dropped'] === 'number' ? saved['dropped'] : 0,
        unreported: typeof saved['unreported'] === 'number' ? saved['unreported'] : 0,
      })
    }
  }

  #save(snapshot: TikTokOutboxSnapshot): void {
    const area = this.#o.session
    this.#persist = this.#persist
      .then(() => {
        const unreported = snapshot.unreported ?? 0
        return snapshot.items.length === 0 && snapshot.dropped === 0 && unreported === 0
          ? area.remove([TT_QUEUE_KEY])
          : area.set({ [TT_QUEUE_KEY]: { items: snapshot.items, dropped: snapshot.dropped, unreported } })
      })
      .catch(() => undefined)
  }

  async saved(): Promise<void> {
    await this.#persist
  }

  /** 끊김·연결 지우기: 대기열·세션·아는 값을 모두 비운다 */
  async stop(): Promise<void> {
    this.#outbox.stop()
    this.#info = null
    this.#failing = null
    this.#offer = false
    await this.#persist
    await this.#o.session.remove([TT_QUEUE_KEY]).catch(() => undefined)
  }

  /** 다시 연결한 뒤 */
  resume(): void {
    this.#info = null
    this.#outbox.resume()
  }

  /** 연결 코드로 이은 직후: 판매자 틱톡 아이디를 한 번 묻는다. 있으면 팝업에 틱톡 줄, 없으면(유튜브만) 줄 없음 */
  async afterConnect(): Promise<void> {
    this.#offer = false
    await this.#ensureInfo().catch(() => undefined)
    this.#offer = this.#o.connected() && this.#info !== null && this.#info.tiktokId !== null
  }

  async handle(message: TikTokPageMessage, tab: number | null): Promise<unknown> {
    this.#seen = true
    switch (message.type) {
      case 'ttInfo':
        await this.#ensureInfo()
        return this.#reply()
      case 'ttChats':
        if (this.#o.connected() && typeof message.pageId === 'string' && message.pageId !== '' && Array.isArray(message.items)) this.#outbox.add(tab, message.pageId, message.items.filter(isItem).map(pickItem))
        return undefined
      case 'ttStatus':
        return this.#status(message, tab)
      case 'ttLeave':
        this.#outbox.dropTab(tab)
        return undefined
      default:
        return undefined
    }
  }

  #reply(): TikTokInfoReply {
    const connected = this.#o.connected()
    return { connected, tiktokId: connected ? (this.#info?.tiktokId ?? null) : null }
  }

  async #ensureInfo(): Promise<void> {
    if (!this.#o.connected()) return
    if (this.#info !== null && this.#o.now() - this.#info.at < INFO_FRESH_MS) return
    this.#asking ??= this.#o.api
      .call('GET', '/ext/tiktok')
      .then(async (result) => {
        if (result.status === 401) await this.#o.lost()
        else if (result.status === 200 && result.body !== null) this.#take(result.body)
      })
      .finally(() => {
        this.#asking = null
      })
    await this.#asking
  }

  /** 서버의 GET /ext/tiktok · status 응답을 받아 둔다 */
  #take(body: Record<string, unknown>): void {
    const id = body['tiktokId']
    const mode = body['mode'] === 'standby' || body['mode'] === 'blocked' ? body['mode'] : 'recording'
    const code = isBlockCode(body['code']) ? body['code'] : null
    this.#info = { tiktokId: typeof id === 'string' && id !== '' ? id : null, mode, code, at: this.#o.now() }
  }

  async #status(m: Extract<TikTokPageMessage, { type: 'ttStatus' }>, tab: number | null): Promise<TikTokInfoReply> {
    const screen = typeof m.screen === 'string' && SCREENS.includes(m.screen) ? m.screen : 'ELSEWHERE'
    this.#tabs.set(tab, { screen, hidden: m.hidden === true, read: count(m.read), unread: count(m.unread), at: this.#o.now() })
    const best = this.#best()
    if (this.#o.connected() && best !== null) {
      // 확장이 버린 댓글 수(넘침·화면 떠남)를 싣는다 — 서버가 저장 실패 알림에 더한다(D-TTX-16). 받은 뒤에만 뺀다
      const report = this.#outbox.takeDropped()
      const result = await this.#o.api.call('POST', '/ext/tiktok/status', { screen: best.screen, hidden: best.hidden, read: best.read, unread: best.unread, dropped: report.count })
      this.#outbox.settleDropped(report, result.status === 200)
      if (result.status === 401) await this.#o.lost()
      else if (result.status === 200 && result.body !== null) this.#take(result.body)
    }
    this.#o.changed()
    return this.#reply()
  }

  /** 살아 있는 탭 중 가장 나은 것: 내 방송(앞) → 내 방송(뒤) → 남의 방송 → 다른 화면 */
  #best(): TabState | null {
    const now = this.#o.now()
    let best: TabState | null = null
    let bestRank = Number.POSITIVE_INFINITY
    for (const [tab, state] of this.#tabs) {
      if (now - state.at > TAB_STALE_MS) {
        this.#tabs.delete(tab)
        continue
      }
      const rank = RANK[state.screen] + (state.screen === 'OWN' && state.hidden ? 1 : 0)
      if (rank < bestRank) {
        best = state
        bestRank = rank
      }
    }
    return best
  }

  #onOutbox(event: TikTokOutboxEvent): void {
    const at = this.#o.now()
    const tiktokId = this.#info?.tiktokId ?? null
    switch (event.kind) {
      case 'sent':
        this.#failing = null
        this.#info = { tiktokId, mode: event.result === 'standby' ? 'standby' : 'recording', code: null, at: this.#info?.at ?? at }
        break
      case 'blocked':
        this.#failing = null
        if (event.code !== 'NOT_OWN_LIVE') this.#info = { tiktokId, mode: 'blocked', code: event.code, at: this.#info?.at ?? at }
        break
      case 'failing':
        this.#failing = event.message ?? NETWORK
        break
      case 'disconnected':
        void this.#o.lost()
        return
    }
    this.#o.changed()
  }

  /** 팝업 틱톡 줄 — 연결 전이면 null. 이 워커가 틱톡 화면을 본 적이 없으면, 연결 직후 판매자 틱톡 아이디를 받았을 때만 안내 줄 */
  view(): TikTokView | null {
    if (!this.#o.connected()) return null
    if (!this.#seen) return this.#offer && this.#info !== null && this.#info.tiktokId !== null ? { message: TT_WORDS.ELSEWHERE_PAGE, light: 'off', overflow: null } : null
    const overflow = this.#outbox.dropped > 0 ? TT_WORDS.OVERFLOW : null
    const line = (message: string, light: TikTokLight): TikTokView => ({ message, light, overflow })
    if (this.#info !== null && this.#info.tiktokId === null) return line(TT_WORDS.NO_TIKTOK_ID, 'warn')
    const best = this.#best()
    if (best === null || best.screen === 'ELSEWHERE') return line(TT_WORDS.ELSEWHERE_PAGE, 'off')
    if (best.screen === 'OTHER') return line(TT_WORDS.NOT_OWN_LIVE, 'warn')
    if (this.#failing !== null) return line(this.#failing, 'warn')
    if (this.#info === null) return line(NETWORK, 'warn')
    if (best.hidden) return line(TT_WORDS.HIDDEN, 'warn')
    if (this.#info.mode === 'standby') return line(TT_WORDS.STANDBY, 'ok')
    if (this.#info.mode === 'blocked') return line(this.#info.code === null ? TT_WORDS.PLATFORM_NOT_READY : TT_WORDS[this.#info.code], 'warn')
    return line(TT_WORDS.RECORDING, 'ok')
  }
}

/** 서버가 받는 다섯 칸만 (그 밖의 칸이 있으면 서버가 묶음 전체를 거절한다) */
const pickItem = (item: TikTokItem): TikTokItem => ({ commentId: item.commentId, userId: item.userId, uniqueId: item.uniqueId, nickname: item.nickname, text: item.text })

function isItem(value: unknown): value is TikTokItem {
  if (!isRecord(value)) return false
  return ['commentId', 'userId', 'uniqueId', 'nickname', 'text'].every((key) => typeof value[key] === 'string')
}
