// 틱톡 댓글 붙들기·묶어 보내기 (TTX D-TTX-08). 서비스 워커가 쓴다 — 크롬 API 없이 시험한다. 유튜브 대기열(outbox.ts)과 따로다.
// - 1초마다(또는 50개가 차면) 묶음 하나, 요청당 50개까지. **한 번에 한 묶음만** — 앞 응답이 오기 전엔 다음을 보내지 않는다(접수순 = 붙은 순서).
// - 응답 recorded·standby는 둘 다 성공(다시 보내지 않음). 429면 Retry-After만큼, 서버에 닿지 못하거나 5xx면 점점 길게 기다렸다 **같은 순서로** 다시.
// - 401(끊김)이면 모두 버리고 멈춘다. 403 NOT_OWN_LIVE·409(NOT_LINKED·NO_CONSENT·PLATFORM_NOT_READY)·400은 그 묶음을 버린다
//   (다시 보내도 기록되지 않고, 나중에 기록하면 늦게 온 댓글이 순서를 앞지른다 — 팝업에 까닭을 보인다).
// - 500개까지 붙든다. 넘으면 오래된 것부터 버리고 센다("놓친 틱톡 댓글이 있어요").
// - 붙든 것은 바뀔 때마다 onChange로 알린다 → 서비스 워커가 chrome.storage.session에 두고 다시 뜨면 이어 보낸다. 디스크에는 두지 않는다.
// - 화면을 떠나면(dropTab) 그 탭의 아직 보내지 않은 댓글을 버린다(D-TTX-02).
import type { Api } from './api.ts'
import type { Timers } from './outbox.ts'
import type { TikTokItem } from './tiktok-reader.ts'

export const TT_BATCH_MAX = 50
export const TT_HOLD_MAX = 500
export const TT_FLUSH_MS = 1000
const BACKOFF_MAX_MS = 30_000
export const TT_CHATS_PATH = '/ext/tiktok/chats'

/** 기록 0의 까닭 (서버 응답 코드) */
export type TikTokBlockCode = 'NOT_OWN_LIVE' | 'NOT_LINKED' | 'NO_CONSENT' | 'PLATFORM_NOT_READY' | 'NO_TIKTOK_ID'
const BLOCK_CODES: readonly string[] = ['NOT_OWN_LIVE', 'NOT_LINKED', 'NO_CONSENT', 'PLATFORM_NOT_READY', 'NO_TIKTOK_ID']
export const isBlockCode = (code: unknown): code is TikTokBlockCode => typeof code === 'string' && BLOCK_CODES.includes(code)

export type TikTokOutboxEvent =
  | { readonly kind: 'sent'; readonly result: 'recorded' | 'standby' }
  | { readonly kind: 'blocked'; readonly code: TikTokBlockCode }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'failing'; readonly message: string | null }

export interface TikTokHeld {
  /** 읽은 탭 (모르면 null) */
  readonly tab: number | null
  /** 그 댓글을 읽은 화면 주소의 아이디 (적힌 그대로 — 서버가 다듬어 비교한다) */
  readonly pageId: string
  readonly item: TikTokItem
}

export interface TikTokOutboxSnapshot {
  readonly items: readonly TikTokHeld[]
  readonly dropped: number
}

export class TikTokOutbox {
  readonly #api: Api
  readonly #timers: Timers
  readonly #onEvent: (event: TikTokOutboxEvent) => void
  readonly #onChange: (snapshot: TikTokOutboxSnapshot) => void
  #queue: TikTokHeld[] = []
  #timer: unknown = null
  #sending = false
  #stopped = false
  #backoff = 0
  #waitUntilRetry = false
  #dropped = 0

  constructor(api: Api, timers: Timers, onEvent: (event: TikTokOutboxEvent) => void, onChange: (snapshot: TikTokOutboxSnapshot) => void = () => undefined) {
    this.#api = api
    this.#timers = timers
    this.#onEvent = onEvent
    this.#onChange = onChange
  }

  snapshot(): TikTokOutboxSnapshot {
    return { items: [...this.#queue], dropped: this.#dropped }
  }

  get size(): number {
    return this.#queue.length
  }

  /** 붙들 수 없어 버린 댓글 수 (켠 뒤 누적) */
  get dropped(): number {
    return this.#dropped
  }

  /** 워커가 다시 떴을 때: 보관해 둔 것을 앞에 두고 이어 보낸다 */
  restore(snapshot: TikTokOutboxSnapshot): void {
    if (this.#stopped) return
    const items = Array.isArray(snapshot.items) ? snapshot.items.filter(isHeld) : []
    this.#queue = [...items, ...this.#queue]
    this.#dropped = Math.max(this.#dropped, Number.isSafeInteger(snapshot.dropped) && snapshot.dropped > 0 ? snapshot.dropped : 0)
    this.#trim()
    this.#changed()
    if (this.#queue.length > 0 && !this.#sending && !this.#waitUntilRetry) this.#schedule(this.#queue.length >= TT_BATCH_MAX ? 0 : TT_FLUSH_MS)
  }

  add(tab: number | null, pageId: string, items: readonly TikTokItem[]): void {
    if (this.#stopped || items.length === 0) return
    for (const item of items) this.#queue.push({ tab, pageId, item })
    this.#trim()
    this.#changed()
    if (this.#waitUntilRetry || this.#sending) return
    if (this.#queue.length >= TT_BATCH_MAX) this.#schedule(0)
    else if (this.#timer === null) this.#schedule(TT_FLUSH_MS)
  }

  /** 그 탭이 내 방송 화면을 떠났다: 아직 보내지 않은 그 탭의 댓글을 버린다 */
  dropTab(tab: number | null): void {
    const before = this.#queue.length
    this.#queue = this.#queue.filter((held) => held.tab !== tab)
    if (this.#queue.length !== before) this.#changed()
  }

  /** 끊겼을 때·연결을 지울 때: 모두 버리고 멈춘다 */
  stop(): void {
    this.#stopped = true
    this.#queue = []
    this.#dropped = 0
    if (this.#timer !== null) this.#timers.clear(this.#timer)
    this.#timer = null
    this.#changed()
  }

  resume(): void {
    this.#stopped = false
    this.#backoff = 0
    this.#waitUntilRetry = false
  }

  #trim(): void {
    const over = this.#queue.length - TT_HOLD_MAX
    if (over > 0) {
      this.#queue.splice(0, over)
      this.#dropped += over
    }
  }

  #changed(): void {
    this.#onChange(this.snapshot())
  }

  #schedule(ms: number): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer)
    this.#timer = this.#timers.set(() => {
      this.#timer = null
      void this.flush()
    }, ms)
  }

  /** 지금 한 묶음 보내기 (맨 앞 댓글과 같은 화면 아이디인 것만, 50개까지) */
  async flush(): Promise<void> {
    if (this.#sending || this.#stopped || this.#queue.length === 0) return
    this.#waitUntilRetry = false
    const first = this.#queue[0]
    if (first === undefined) return
    const batch: TikTokHeld[] = []
    for (const held of this.#queue) {
      if (held.pageId !== first.pageId) break
      batch.push(held)
      if (batch.length >= TT_BATCH_MAX) break
    }
    this.#sending = true
    const result = await this.#api.call('POST', TT_CHATS_PATH, { pageId: first.pageId, items: batch.map((held) => held.item) })
    this.#sending = false
    if (this.#stopped) return
    const drop = () => {
      const sent = new Set(batch)
      this.#queue = this.#queue.filter((held) => !sent.has(held))
      this.#changed()
    }
    if (result.status === 200) {
      drop()
      this.#backoff = 0
      this.#onEvent({ kind: 'sent', result: result.body?.['result'] === 'standby' ? 'standby' : 'recorded' })
    } else if (result.status === 401) {
      this.stop()
      this.#onEvent({ kind: 'disconnected' })
      return
    } else if ((result.status === 403 || result.status === 409) && isBlockCode(result.code)) {
      drop()
      this.#onEvent({ kind: 'blocked', code: result.code })
    } else if (result.status === 429) {
      this.#retry(result.retryAfterMs ?? 1000, result.message)
      return
    } else if (result.status >= 400 && result.status < 500 && result.status !== 408) {
      // 고쳐도 받지 않는 묶음 (모양이 틀림 등) — 버린다
      drop()
    } else {
      this.#backoff = Math.min(BACKOFF_MAX_MS, this.#backoff === 0 ? 1000 : this.#backoff * 2)
      this.#retry(this.#backoff, result.message)
      return
    }
    if (this.#queue.length >= TT_BATCH_MAX) this.#schedule(0)
    else if (this.#queue.length > 0) this.#schedule(TT_FLUSH_MS)
  }

  #retry(ms: number, message: string | null): void {
    this.#waitUntilRetry = true
    this.#onEvent({ kind: 'failing', message })
    this.#schedule(ms)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 세션에서 읽은 값이 붙든 것 모양인가 (모양이 틀린 것은 버린다) */
function isHeld(value: unknown): value is TikTokHeld {
  if (!isRecord(value) || typeof value['pageId'] !== 'string' || !isRecord(value['item'])) return false
  if (value['tab'] !== null && typeof value['tab'] !== 'number') return false
  const item = value['item']
  return ['commentId', 'userId', 'uniqueId', 'nickname', 'text'].every((key) => typeof item[key] === 'string')
}
