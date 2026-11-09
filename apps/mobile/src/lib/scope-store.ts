// 범위 자료 저장소 (웹 lib/console-store.ts와 같은 프로토콜 — AC-S05-14·21·30·54·62, AC-S06-40·41, D-075, D-085, D-096).
// - 처음: 방송 목록에서 그 방송(날짜·리허설인지)을 찾고 범위 전체 조회 한 번.
// - 그 뒤: 실시간 `change`(보는 범위, 아는 seq보다 큼)마다 증분 조회 한 번(진행 중이면 모아서 끝난 뒤 한 번 더).
// - 끊기면 "다시 연결하는 중"을 보이고(연결은 live.ts가 다시 연다), 다시 붙으면 `ready`의 seq로 놓친 변경을 증분으로 받는다.
//   서버가 "전체를 다시 받으세요"(410 RESYNC_REQUIRED)면 전체를 다시 받는다.
// - 불러오기·따라잡기가 실패하면(네트워크·5xx) "최신으로 맞추지 못함"(stale)을 보이고 1초부터 두 배씩 최대 30초 간격으로 다시 시도한다.
//   새 알림이 오면 바로 다시 시도한다.
// 채팅 메시지는 범위 자료로 받지 않는다 — 방송 화면의 "채팅 보기"가 열릴 때 따로 받는다(D-APPX-03).
import type { BroadcastItem, Changes, FullView, ScopeSeq } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import { CLOSED, type EventSourceLike, type SseMessage } from '../api/sse.ts'
import { realTimer, type Timer } from './live.ts'
import { applyChanges, fromFull, type ScopeData } from './scope-data.ts'

export const RETRY_START_MS = 1000
export const RETRY_MAX_MS = 30_000

export function retryDelayMs(failures: number): number {
  const exponent = Math.max(0, Math.min(failures - 1, 16))
  return Math.min(RETRY_START_MS * 2 ** exponent, RETRY_MAX_MS)
}

export type Connection = 'connecting' | 'open' | 'lost'

export interface ScopeSnapshot {
  readonly phase: 'loading' | 'ready' | 'missing' | 'error'
  readonly error: ApiError | null
  readonly broadcast: BroadcastItem | null
  readonly data: ScopeData | null
  readonly connection: Connection
  readonly stale: boolean
  /** 포장 기록이 바뀐 횟수 (실시간 `packing` — 포장 화면이 다시 받는다). 다시 붙을 때도 는다 */
  readonly packingVersion: number
  /** 다시 붙은 횟수 (처음 ready는 0) */
  readonly reconnects: number
}

export interface ScopeKey {
  readonly date: string
  readonly rehearsal: boolean
}

export interface ScopeStoreOptions {
  readonly broadcastId?: string
  readonly scope?: ScopeKey
  readonly openStream: () => EventSourceLike
  readonly timer?: Timer
  /** 지난번에 본 방송·자료 (D-UX4-83): 있으면 처음부터 그 자료로 그리고, 뒤에서 새로 받아 바꾼다 */
  readonly seed?: { readonly broadcast: BroadcastItem; readonly data: ScopeData } | null
}

const EMPTY: ScopeSnapshot = { phase: 'loading', error: null, broadcast: null, data: null, connection: 'connecting', stale: false, packingVersion: 0, reconnects: 0 }
export const LOADING_SNAPSHOT: ScopeSnapshot = EMPTY

function parseData<T>(event: SseMessage): T | null {
  try {
    return JSON.parse(event.data) as T
  } catch {
    return null
  }
}

const retryable = (error: ApiError): boolean => error.network || error.status >= 500

export class ScopeStore {
  readonly broadcastId: string | null
  readonly #fixedScope: ScopeKey | null
  readonly #openStream: () => EventSourceLike
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  #snapshot: ScopeSnapshot = EMPTY
  #stream: EventSourceLike | null = null
  #retry: unknown = undefined
  #stopped = false
  #catching = false
  #again = false
  #loading = false
  #failures = 0
  #needFull = false
  #justReloaded = false
  #notified = 0
  #readyCount = 0

  constructor(options: ScopeStoreOptions) {
    if ((options.broadcastId === undefined) === (options.scope === undefined)) throw new Error('라이브 또는 범위 하나로 연다')
    this.broadcastId = options.broadcastId ?? null
    this.#fixedScope = options.scope ?? null
    this.#openStream = options.openStream
    this.#timer = options.timer ?? realTimer
    if (options.seed != null) this.#snapshot = { ...EMPTY, phase: 'ready', broadcast: options.seed.broadcast, data: options.seed.data }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): ScopeSnapshot => this.#snapshot

  #set(patch: Partial<ScopeSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  get scope(): ScopeKey | null {
    if (this.#fixedScope !== null) return this.#fixedScope
    const broadcast = this.#snapshot.broadcast
    return broadcast === null ? null : { date: broadcast.date, rehearsal: broadcast.rehearsal }
  }

  #path(suffix: string, params: Readonly<Record<string, string | number | boolean | undefined>> = {}): string {
    const scope = this.scope
    if (scope === null) throw new Error('범위를 아직 모른다')
    return withQuery(`/api/days/${scope.date}${suffix}`, { ...params, rehearsal: scope.rehearsal })
  }

  async start(): Promise<void> {
    await this.#boot()
  }

  async #boot(): Promise<void> {
    if (this.#loading || this.#stopped) return
    this.#loading = true
    try {
      if (this.broadcastId !== null && this.#snapshot.broadcast === null) {
        const { broadcasts } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
        const broadcast = broadcasts.find((item) => item.id === this.broadcastId) ?? null
        if (broadcast === null) {
          this.#set({ phase: 'missing' })
          return
        }
        this.#set({ broadcast })
      }
      await this.#loadAll()
      this.#recovered()
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 401) return
      if (this.#snapshot.data === null && !retryable(error)) {
        this.#set(error.status === 404 ? { phase: 'missing' } : { phase: 'error', error })
        return
      }
      this.#failed(true)
    } finally {
      this.#loading = false
      if (!this.#stopped && this.#stream === null && this.scope !== null && this.#snapshot.phase !== 'missing') this.#connect()
    }
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    if (this.#retry !== undefined) this.#timer.clear(this.#retry)
    this.#listeners.clear()
  }

  #failed(full: boolean): void {
    if (this.#stopped) return
    if (full) this.#needFull = true
    this.#failures++
    this.#set({ stale: true })
    if (this.#retry !== undefined) this.#timer.clear(this.#retry)
    this.#retry = this.#timer.set(() => {
      this.#retry = undefined
      void this.retryNow()
    }, retryDelayMs(this.#failures))
  }

  #recovered(): void {
    this.#failures = 0
    this.#needFull = false
    if (this.#retry !== undefined) {
      this.#timer.clear(this.#retry)
      this.#retry = undefined
    }
    if (this.#snapshot.stale) this.#set({ stale: false })
  }

  retryNow = async (): Promise<void> => {
    if (this.#stopped) return
    if (this.#retry !== undefined) {
      this.#timer.clear(this.#retry)
      this.#retry = undefined
    }
    if (this.#snapshot.data === null) {
      await this.#boot()
      return
    }
    if (this.#needFull) {
      await this.#reload()
      return
    }
    await this.catchUp()
  }

  async #reload(): Promise<void> {
    if (this.#loading || this.#stopped) return
    this.#loading = true
    try {
      await this.#loadAll()
      this.#justReloaded = true
      this.#recovered()
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status !== 401) this.#failed(true)
    } finally {
      this.#loading = false
    }
  }

  async #loadAll(): Promise<void> {
    const view = await get<FullView>(this.#path(''))
    const data = fromFull(view)
    this.#set({ phase: 'ready', error: null, data })
    if (this.#notified > data.seq && !data.sealed) void this.catchUp()
  }

  #connect(): void {
    if (this.#stopped) return
    this.#stream?.close()
    this.#set({ connection: this.#snapshot.connection === 'lost' ? 'lost' : 'connecting' })
    const stream = this.#openStream()
    this.#stream = stream
    stream.addEventListener('ready', (event) => {
      const data = parseData<{ scopes: ScopeSeq[] }>(event)
      this.#readyCount += 1
      const again = this.#readyCount > 1
      if (again) this.#set({ connection: 'open', packingVersion: this.#snapshot.packingVersion + 1, reconnects: this.#snapshot.reconnects + 1 })
      else this.#set({ connection: 'open' })
      const scope = this.scope
      const mine = data?.scopes.find((item) => scope !== null && item.date === scope.date && item.rehearsal === scope.rehearsal)
      if (mine !== undefined) this.#notify(mine.seq)
      else if (this.#snapshot.stale) void this.retryNow()
    })
    stream.addEventListener('change', (event) => {
      const data = parseData<ScopeSeq & { type: string }>(event)
      const scope = this.scope
      if (data === null || scope === null || data.date !== scope.date || data.rehearsal !== scope.rehearsal) return
      this.#notify(data.seq)
    })
    stream.addEventListener('packing', (event) => {
      const data = parseData<{ date: string; buyer: string }>(event)
      const scope = this.scope
      if (data === null || scope === null || scope.rehearsal || data.date !== scope.date) return
      this.#set({ packingVersion: this.#snapshot.packingVersion + 1 })
    })
    stream.onerror = () => {
      if (this.#stopped || this.#stream !== stream) return
      this.#set({ connection: 'lost' })
      if (stream.readyState === CLOSED) {
        // 연결은 live.ts가 다시 연다 — 이 보는 쪽은 그대로 두면 새 ready를 받는다
      }
    }
  }

  #notify(seq: number): void {
    if (seq > this.#notified) this.#notified = seq
    if (this.#snapshot.data?.sealed === true) return
    if (this.#snapshot.stale) {
      void this.retryNow()
      return
    }
    const data = this.#snapshot.data
    if (data !== null && seq > data.seq) void this.catchUp()
  }

  async catchUp(): Promise<void> {
    if (this.#catching) {
      this.#again = true
      return
    }
    this.#catching = true
    try {
      do {
        this.#again = false
        await this.#fetchChanges()
      } while (this.#again && !this.#stopped)
    } finally {
      this.#catching = false
    }
  }

  async #fetchChanges(): Promise<void> {
    const data = this.#snapshot.data
    if (data === null || this.#stopped || data.sealed) return
    let changes: Changes
    try {
      changes = await get<Changes>(this.#path('/changes', { since: data.seq }))
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.code === 'RESYNC_REQUIRED') {
        if (this.#justReloaded) this.#failed(true)
        else await this.#reload()
        return
      }
      if (error.status !== 401) this.#failed(false)
      return
    }
    const current = this.#snapshot.data
    if (current === null || current.seq !== changes.since) {
      this.#again = true
      return
    }
    this.#justReloaded = false
    this.#set({ data: applyChanges(current, changes) })
    this.#recovered()
  }

  /** 쓰기 응답의 seq까지 화면 자료가 따라잡을 때까지 기다린다(증분 조회 한 번). 오래 걸리면 그냥 돌아간다 */
  sync(seq: number, timeoutMs = 3000): Promise<void> {
    const reached = () => this.#stopped || (this.#snapshot.data?.seq ?? 0) >= seq
    if (reached()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const state: { timeout: unknown } = { timeout: undefined }
      const done = () => {
        this.#listeners.delete(check)
        this.#timer.clear(state.timeout)
        resolve()
      }
      const check = () => {
        if (reached()) done()
      }
      this.#listeners.add(check)
      state.timeout = this.#timer.set(done, timeoutMs)
      this.#notify(seq)
    })
  }
}
