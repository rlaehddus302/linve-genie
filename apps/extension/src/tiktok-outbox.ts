// 틱톡 댓글 붙들기·묶어 보내기 (TTX D-TTX-08). 서비스 워커가 쓴다 — 크롬 API 없이 시험한다. 유튜브 대기열(outbox.ts)과 따로다.
// - 1초마다(또는 50개가 차면) 묶음 하나, 요청당 50개까지. **한 번에 한 묶음만** — 앞 응답이 오기 전엔 다음을 보내지 않는다(접수순 = 붙은 순서).
// - 응답 recorded·standby는 둘 다 성공(다시 보내지 않음). 429면 Retry-After만큼, 서버에 닿지 못하거나 5xx면 점점 길게 기다렸다 **같은 순서로** 다시.
// - 401(끊김)이면 모두 버리고 멈춘다. 403 NOT_OWN_LIVE·409(NOT_LINKED·NO_CONSENT·PLATFORM_NOT_READY)·400은 그 묶음을 버린다
//   (다시 보내도 기록되지 않고, 나중에 기록하면 늦게 온 댓글이 순서를 앞지른다 — 팝업에 까닭을 보인다).
// - 500개까지 붙든다. 넘으면 오래된 것부터 버리고 센다("놓친 틱톡 댓글이 있어요"). 팝업 수도 날아가는 묶음 몫은 답으로 정한다(D-TTX-21 (3)):
//   아직 보내지 않은 것은 잘릴 때 바로, 날아가던 것은 답이 429·5xx·닿지 못함일 때만. 화면 떠남은 팝업 수에 넣지 않는다.
// - 붙든 것은 바뀔 때마다 onChange로 알린다 → 서비스 워커가 chrome.storage.session에 두고 다시 뜨면 이어 보낸다. 디스크에는 두지 않는다.
// - 화면을 떠나면(dropTab) 그 탭의 아직 보내지 않은 댓글을 버린다(D-TTX-02).
// - 넘침·화면 떠남으로 버린 수는 서버에 아직 알리지 않은 수로 따로 센다(D-TTX-16) → 다음 틱톡 상태의 `dropped`.
//   서버가 받으면(200) 보낸 만큼 빼고, 못 받으면 남겨 다음 상태에 더한다. 409로 거절한 묶음·끊기·standby는 세지 않는다.
// - 날아가는 묶음(보냈고 답을 기다림)이 떠남·넘침으로 빠지면 다시 보내지 않되 그 자리에서 세지 않고 답으로 정한다(D-TTX-21 (1)):
//   200·409·400 → 세지 않음(서버가 저장했거나 받지 않기로 정함), 429·5xx·닿지 못함 → 그때 뺀 수만큼 센다.
// - 세션 저장소에는 아직 떼어 두지 않은 수만 둔다 — 워커가 상태 알림 도중 멈추면 그 수는 되살리지 않는다(D-TTX-21 (2), 두 번 세면 이중 찜).
import type { Api } from './api.ts'
import type { Timers } from './outbox.ts'
import type { TikTokItem } from './tiktok-reader.ts'

export const TT_BATCH_MAX = 50
export const TT_HOLD_MAX = 500
export const TT_FLUSH_MS = 1000
const BACKOFF_MAX_MS = 30_000
export const TT_CHATS_PATH = '/ext/tiktok/chats'
/** 상태 한 번에 알리는 버린 수 상한 (서버가 10,000 넘으면 400 — 넘으면 나눠 보낸다) */
export const TT_DROPPED_REPORT_MAX = 10_000

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
  /** 서버에 아직 알리지 않았고 상태에 떼어 두지도 않은 버린 수 (알리는 중인 수는 넣지 않는다 — D-TTX-21 (2)) */
  readonly unreported?: number
}

/** 상태에 실어 보내려고 떼어 둔 버린 수 */
export interface TikTokDroppedReport {
  readonly count: number
  readonly epoch: number
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
  #unreported = 0
  #reporting = 0
  /** 지금 날아가는 묶음 (답을 기다림) */
  #flying: ReadonlySet<TikTokHeld> | null = null
  /** 날아가는 묶음 중 떠남·넘침으로 대기열에서 뺀 수 — 답이 429·5xx·닿지 못함이면 그때 서버에 알릴 수로 센다 */
  #flyingGone = 0
  /** #flyingGone 가운데 넘침으로 잘린 수 — 답이 429·5xx·닿지 못함이면 그때 팝업 수(#dropped)에도 더한다(D-TTX-21 (3)) */
  #flyingOverflow = 0
  /** stop()마다 늘린다 — 끊기 전에 떼어 둔 수가 끊은 뒤 되돌아오지 않게 */
  #epoch = 0

  constructor(api: Api, timers: Timers, onEvent: (event: TikTokOutboxEvent) => void, onChange: (snapshot: TikTokOutboxSnapshot) => void = () => undefined) {
    this.#api = api
    this.#timers = timers
    this.#onEvent = onEvent
    this.#onChange = onChange
  }

  snapshot(): TikTokOutboxSnapshot {
    return { items: [...this.#queue], dropped: this.#dropped, unreported: this.#unreported }
  }

  get size(): number {
    return this.#queue.length
  }

  /** 붙들 수 없어 버린 댓글 수 (켠 뒤 누적) */
  get dropped(): number {
    return this.#dropped
  }

  /** 서버에 아직 알리지 않은 버린 수 (알리는 중인 것 포함) */
  get unreported(): number {
    return this.#unreported + this.#reporting
  }

  /** 다음 틱톡 상태에 실을 버린 수를 떼어 둔다 (동시에 두 상태가 가도 같은 수를 두 번 싣지 않는다) */
  takeDropped(): TikTokDroppedReport {
    const count = Math.min(this.#unreported, TT_DROPPED_REPORT_MAX)
    this.#unreported -= count
    this.#reporting += count
    if (count > 0) this.#changed()
    return { count, epoch: this.#epoch }
  }

  /** 상태 요청이 끝났다: 서버가 받았으면(200) 뺀 채로, 아니면 되돌려 다음 상태에 더한다 */
  settleDropped(report: TikTokDroppedReport, accepted: boolean): void {
    if (report.epoch !== this.#epoch || report.count === 0) return
    this.#reporting = Math.max(0, this.#reporting - report.count)
    if (!accepted) this.#unreported += report.count
    this.#changed()
  }

  /** 워커가 다시 떴을 때: 보관해 둔 것을 앞에 두고 이어 보낸다 */
  restore(snapshot: TikTokOutboxSnapshot): void {
    if (this.#stopped) return
    const items = Array.isArray(snapshot.items) ? snapshot.items.filter(isHeld) : []
    this.#queue = [...items, ...this.#queue]
    this.#dropped = Math.max(this.#dropped, Number.isSafeInteger(snapshot.dropped) && snapshot.dropped > 0 ? snapshot.dropped : 0)
    const unreported = snapshot.unreported
    this.#unreported = Math.max(this.#unreported, typeof unreported === 'number' && Number.isSafeInteger(unreported) && unreported > 0 ? unreported : 0)
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
    let gone = 0
    let flying = 0
    this.#queue = this.#queue.filter((held) => {
      if (held.tab !== tab) return true
      if (this.#flying?.has(held) === true) flying += 1
      else gone += 1
      return false
    })
    this.#flyingGone += flying
    this.#unreported += gone
    if (gone + flying > 0) this.#changed()
  }

  /** 끊겼을 때·연결을 지울 때: 모두 버리고 멈춘다 */
  stop(): void {
    this.#stopped = true
    this.#queue = []
    this.#dropped = 0
    this.#unreported = 0
    this.#reporting = 0
    this.#flying = null
    this.#flyingGone = 0
    this.#flyingOverflow = 0
    this.#epoch += 1
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
    if (over <= 0) return
    let gone = 0
    for (const held of this.#queue.splice(0, over)) {
      if (this.#flying?.has(held) === true) {
        this.#flyingGone += 1
        this.#flyingOverflow += 1
      } else gone += 1
    }
    // 아직 보내지 않은 몫만 바로 센다 — 날아가던 몫은 팝업 수도 서버에 알릴 수도 답으로 정한다(D-TTX-21 (1)(3))
    this.#dropped += gone
    this.#unreported += gone
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
    if (this.#sending || this.#stopped) return
    // 다시 보내기 기다림은 이 타이머로 끝난다 — 그동안 화면을 떠나(dropTab) 대기열이 비었어도 풀어야
    // 그 뒤 붙는 댓글을 add가 다시 예약한다 (TD-TTX-001: 풀지 않으면 워커가 다시 뜰 때까지 영영 멈춘다)
    this.#waitUntilRetry = false
    if (this.#queue.length === 0) return
    const first = this.#queue[0]
    if (first === undefined) return
    const batch: TikTokHeld[] = []
    for (const held of this.#queue) {
      if (held.pageId !== first.pageId) break
      batch.push(held)
      if (batch.length >= TT_BATCH_MAX) break
    }
    this.#sending = true
    const epoch = this.#epoch
    this.#flying = new Set(batch)
    this.#flyingGone = 0
    this.#flyingOverflow = 0
    const result = await this.#api.call('POST', TT_CHATS_PATH, { pageId: first.pageId, items: batch.map((held) => held.item) })
    this.#sending = false
    // 그사이 끊었으면(stop) 그 묶음의 뺀 수는 끊기와 함께 지워졌다 — 되살리지 않는다
    const same = epoch === this.#epoch
    if (same) this.#flying = null
    const flyingGone = same ? this.#flyingGone : 0
    const flyingOverflow = same ? this.#flyingOverflow : 0
    if (same) {
      this.#flyingGone = 0
      this.#flyingOverflow = 0
    }
    if (this.#stopped) return
    // 떠남·넘침으로 뺀 날아가던 댓글은 다시 보내지 않는다 — 서버가 받지 못했으면(429·5xx·닿지 못함) 여기서 센다
    const countGone = () => {
      if (flyingGone === 0) return
      this.#unreported += flyingGone
      this.#dropped += flyingOverflow
      this.#changed()
    }
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
      countGone()
      this.#retry(result.retryAfterMs ?? 1000, result.message)
      return
    } else if (result.status >= 400 && result.status < 500 && result.status !== 408) {
      // 고쳐도 받지 않는 묶음 (모양이 틀림 등) — 버린다
      drop()
    } else {
      countGone()
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
