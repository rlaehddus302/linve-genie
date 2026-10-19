// 라이브 콘솔의 서버 자료 (AC-S05-14·21·30·54·62, D-075, D-085).
// - 처음: 방송 목록에서 그 방송(날짜·리허설인지)을 찾고, 그 범위 전체 조회 한 번 + 그 방송의 최근 메시지만.
// - 그 뒤: SSE `change`(보는 범위, 아는 seq보다 큼)마다 증분 조회 한 번(진행 중이면 모아서 끝난 뒤 한 번 더). 알림마다 전체 조회를 하지 않는다.
// - 끊기면 "다시 연결하는 중"을 보이고 다시 붙는다. 다시 붙으면 `ready`의 seq로 놓친 변경을 증분으로 받는다.
//   서버가 "전체를 다시 받으세요"(410 RESYNC_REQUIRED)면 전체를 다시 받는다.
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { BroadcastItem, Changes, ChatMessage, FullView, GeneratorStatus, MessagesView, ScopeSeq } from '../api/types.ts'
import { applyChanges, fromFull, type ScopeData } from './scope-data.ts'

/** 처음 열 때 받는 최근 메시지 수 (그날 전체를 받지 않는다) */
export const INITIAL_MESSAGES = 100
/** "이전 메시지 보기" 한 번에 받는 수 */
export const OLDER_MESSAGES = 100
/** 화면이 들고 있는 메시지 상한 (넘으면 오래된 것부터 버리고 "이전 메시지 보기"로 다시 받는다) */
export const MAX_MESSAGES = 1500
/** SSE가 아주 닫혔을 때 다시 붙기까지 */
const RECONNECT_MS = 2000

export type Connection = 'connecting' | 'open' | 'lost'

export interface ConsoleSnapshot {
  readonly phase: 'loading' | 'ready' | 'missing' | 'error'
  readonly error: ApiError | null
  readonly broadcast: BroadcastItem | null
  readonly data: ScopeData | null
  /** 그 방송의 메시지, seq 오름차순 */
  readonly messages: readonly ChatMessage[]
  /** 앞에 더 있는지 ("이전 메시지 보기") */
  readonly olderMessages: boolean
  readonly loadingOlder: boolean
  readonly connection: Connection
  readonly generator: GeneratorStatus | null
}

export interface EventSourceLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  close(): void
}

export interface ConsoleStoreOptions {
  readonly broadcastId: string
  readonly openStream?: (url: string) => EventSourceLike
  readonly timer?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
}

const EMPTY: ConsoleSnapshot = {
  phase: 'loading',
  error: null,
  broadcast: null,
  data: null,
  messages: [],
  olderMessages: false,
  loadingOlder: false,
  connection: 'connecting',
  generator: null,
}

function parseData<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(String(event.data)) as T
  } catch {
    return null
  }
}

/** 메시지 합치기: id로 덮고 seq 순 */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return [...current]
  const byId = new Map<string, ChatMessage>()
  for (const message of current) byId.set(message.id, message)
  let appendOnly = true
  const last = current.at(-1)?.seq ?? 0
  for (const message of incoming) {
    if (byId.has(message.id) || message.seq <= last) appendOnly = false
    byId.set(message.id, message)
  }
  if (appendOnly) return [...current, ...incoming.slice().sort((a, b) => a.seq - b.seq)]
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

export class ConsoleStore {
  readonly broadcastId: string
  readonly #openStream: (url: string) => EventSourceLike
  readonly #timer: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
  readonly #listeners = new Set<() => void>()
  #snapshot: ConsoleSnapshot = EMPTY
  #stream: EventSourceLike | null = null
  #reconnect: unknown = undefined
  #stopped = false
  #catching = false
  #again = false
  /** SSE가 알려 준 그 범위의 가장 큰 seq */
  #notified = 0

  constructor(options: ConsoleStoreOptions) {
    this.broadcastId = options.broadcastId
    this.#openStream = options.openStream ?? ((url) => new EventSource(url, { withCredentials: true }))
    this.#timer = options.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): ConsoleSnapshot => this.#snapshot

  #set(patch: Partial<ConsoleSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }

  get #scope(): { date: string; rehearsal: boolean } | null {
    const broadcast = this.#snapshot.broadcast
    return broadcast === null ? null : { date: broadcast.date, rehearsal: broadcast.rehearsal }
  }

  #path(suffix: string, params: Readonly<Record<string, string | number | boolean | undefined>> = {}): string {
    const scope = this.#scope
    if (scope === null) throw new Error('방송을 아직 모른다')
    return withQuery(`/api/days/${scope.date}${suffix}`, { ...params, rehearsal: scope.rehearsal })
  }

  async start(): Promise<void> {
    try {
      const { broadcasts } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
      const broadcast = broadcasts.find((item) => item.id === this.broadcastId) ?? null
      if (broadcast === null) {
        this.#set({ phase: 'missing' })
        return
      }
      this.#set({ broadcast })
      await this.#loadAll()
      if (this.#stopped) return
      this.#connect()
      if (broadcast.rehearsal) void this.#loadGenerator()
    } catch (error) {
      if (isApiError(error)) this.#set({ phase: 'error', error })
      else throw error
    }
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    if (this.#reconnect !== undefined) this.#timer.clear(this.#reconnect)
    this.#listeners.clear()
  }

  /** 전체 조회 + 최근 메시지 (처음·RESYNC_REQUIRED) */
  async #loadAll(): Promise<void> {
    const [view, messages] = await Promise.all([
      get<FullView>(this.#path('')),
      get<MessagesView>(this.#path('/messages', { b: this.broadcastId, limit: INITIAL_MESSAGES })),
    ])
    const data = fromFull(view)
    this.#set({ phase: 'ready', error: null, data, messages: messages.messages, olderMessages: messages.more })
    // 전체 조회와 메시지 조회 사이에 들어온 것, 알림으로 알고 있는 것은 증분으로
    if (messages.seq > data.seq || this.#notified > data.seq) void this.catchUp()
  }

  async #loadGenerator(): Promise<void> {
    try {
      const { generator } = await get<{ generator: GeneratorStatus }>(`/api/broadcasts/${this.broadcastId}/rehearsal/generator`)
      this.#set({ generator })
    } catch {
      // 상태는 다음 generator 알림으로 다시 온다
    }
  }

  #connect(): void {
    if (this.#stopped) return
    this.#stream?.close()
    this.#set({ connection: this.#snapshot.connection === 'lost' ? 'lost' : 'connecting' })
    const stream = this.#openStream('/api/stream')
    this.#stream = stream
    stream.addEventListener('ready', (event) => {
      const data = parseData<{ scopes: ScopeSeq[] }>(event)
      this.#set({ connection: 'open' })
      const scope = this.#scope
      const mine = data?.scopes.find((item) => scope !== null && item.date === scope.date && item.rehearsal === scope.rehearsal)
      if (mine !== undefined) this.#notify(mine.seq)
    })
    stream.addEventListener('change', (event) => {
      const data = parseData<ScopeSeq & { type: string }>(event)
      const scope = this.#scope
      if (data === null || scope === null || data.date !== scope.date || data.rehearsal !== scope.rehearsal) return
      this.#notify(data.seq)
    })
    stream.addEventListener('generator', (event) => {
      const data = parseData<GeneratorStatus & { b: string }>(event)
      if (data !== null && data.b === this.broadcastId) this.#set({ generator: data })
    })
    stream.onerror = () => {
      if (this.#stopped || this.#stream !== stream) return
      this.#set({ connection: 'lost' })
      // 브라우저가 다시 붙지 않는 닫힘(세션 만료 등)이면 세션을 확인하고 새로 연다
      if (stream.readyState === 2) {
        stream.close()
        this.#stream = null
        if (this.#reconnect !== undefined) this.#timer.clear(this.#reconnect)
        this.#reconnect = this.#timer.set(() => {
          this.#reconnect = undefined
          void get('/api/me').then(
            () => this.#connect(),
            () => {
              // 401이면 로그인 화면으로 간다(처리기). 그 밖이면 조금 뒤 다시
              if (!this.#stopped) this.#reconnect = this.#timer.set(() => this.#connect(), RECONNECT_MS)
            },
          )
        }, RECONNECT_MS)
      }
    }
  }

  #notify(seq: number): void {
    if (seq > this.#notified) this.#notified = seq
    const data = this.#snapshot.data
    if (data !== null && seq > data.seq) void this.catchUp()
  }

  /** 아는 seq 뒤의 증분과 새 메시지를 받는다. 진행 중이면 끝난 뒤 한 번 더 */
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
    if (data === null || this.#stopped) return
    let changes: Changes
    try {
      changes = await get<Changes>(this.#path('/changes', { since: data.seq }))
    } catch (error) {
      if (isApiError(error) && error.code === 'RESYNC_REQUIRED') {
        await this.#loadAll()
        return
      }
      // 네트워크가 끊겼으면 다시 붙을 때(ready) 따라잡는다
      return
    }
    const current = this.#snapshot.data
    if (current === null || current.seq !== changes.since) {
      this.#again = true
      return
    }
    const next = applyChanges(current, changes)
    // 그 방송의 새 메시지와, 이미 들고 있는 메시지의 바뀐 기록(메시지 변환)만 — 들고 있지 않은 옛 메시지를 끼워 넣어 빈틈을 만들지 않는다
    const held = new Set(this.#snapshot.messages.map((message) => message.id))
    const mine = changes.messages.filter((message) => message.broadcast === this.broadcastId && (message.seq > changes.since || held.has(message.id)))
    if (changes.messagesMore) {
      // 새 메시지가 너무 많다: 그사이를 다 받지 않고 최근 것만 다시 받는다(빈틈은 "이전 메시지 보기"로)
      const latest = await get<MessagesView>(this.#path('/messages', { b: this.broadcastId, limit: INITIAL_MESSAGES }))
      this.#set({ data: next, messages: latest.messages, olderMessages: true })
      return
    }
    let messages = mine.length === 0 ? this.#snapshot.messages : mergeMessages(this.#snapshot.messages, mine)
    let older = this.#snapshot.olderMessages
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(messages.length - MAX_MESSAGES)
      older = true
    }
    this.#set({ data: next, messages, olderMessages: older })
  }

  /**
   * 쓰기 응답의 seq까지 화면 자료가 따라잡을 때까지 기다린다(증분 조회 한 번). 오래 걸리면(timeoutMs) 그냥 돌아간다 —
   * 알림이 오면 따라잡는다.
   */
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

  /** "이전 메시지 보기" */
  async loadOlder(): Promise<void> {
    const first = this.#snapshot.messages[0]
    if (this.#snapshot.loadingOlder || this.#snapshot.broadcast === null) return
    this.#set({ loadingOlder: true })
    try {
      const view = await get<MessagesView>(
        this.#path('/messages', { b: this.broadcastId, limit: OLDER_MESSAGES, ...(first === undefined ? {} : { before: first.seq }) }),
      )
      this.#set({ messages: mergeMessages(view.messages, this.#snapshot.messages), olderMessages: view.more, loadingOlder: false })
    } catch {
      this.#set({ loadingOlder: false })
    }
  }

  /** 생성기 상태 (시작·멈춤 응답) */
  setGenerator(generator: GeneratorStatus): void {
    this.#set({ generator })
  }
}
