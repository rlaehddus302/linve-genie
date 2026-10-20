// 범위 자료 저장소 (AC-S05-14·21·30·54·62, AC-S06-40·41, D-075, D-085, D-096).
// 콘솔·문자찜 입력·구매자·정산 화면이 같은 저장소를 쓴다.
// - 처음: (방송으로 열면) 방송 목록에서 그 방송(날짜·리허설인지)을 찾고, 그 범위 전체 조회 한 번 (+ 콘솔이면 그 방송의 최근 메시지만).
// - 그 뒤: SSE `change`(보는 범위, 아는 seq보다 큼)마다 증분 조회 한 번(진행 중이면 모아서 끝난 뒤 한 번 더). 알림마다 전체 조회를 하지 않는다.
// - 끊기면 "다시 연결하는 중"을 보이고 다시 붙는다. 다시 붙으면 `ready`의 seq로 놓친 변경을 증분으로 받고, 리허설이면 생성기 상태도 다시 받는다.
//   서버가 "전체를 다시 받으세요"(410 RESYNC_REQUIRED)면 전체를 다시 받는다.
// - 처음 불러오기·전체 다시 받기·따라잡기가 실패하면(네트워크·5xx) "최신으로 맞추지 못함"(stale)을 보이고 1초부터 두 배씩 최대 30초 간격으로
//   화면이 열린 동안 계속 다시 시도한다. 새 알림이 오면 바로 다시 시도한다. 맞춰지면 stale이 풀린다 (AC-S06-41, RA-S05-004).
// - 유튜브 알림(SSE `youtube`)은 같은 연결로 받아 화면 조각(콘솔 유튜브 칸·감사 메시지 목록)에 넘긴다. 끊겼다 다시 붙으면 그 조각들에
//   "다시 받으세요"를 알린다(AC-I3-92).
// - 봉인한 날짜(전체 조회의 sealed: true)는 증분 조회를 하지 않는다 — 410을 되풀이하지 않는다. 연 채 봉인되면(SSE `youtube` sealed)
//   전체를 한 번 다시 받아 봉인한 장부를 보인다 (AC-I3-41, Y1 계약 5).
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { BroadcastItem, Changes, ChatMessage, FullView, GeneratorStatus, MessagesView, ScopeSeq, YoutubeEvent } from '../api/types.ts'
import { parseYoutubeEvent } from './live-events.ts'
import { applyChanges, fromFull, type ScopeData } from './scope-data.ts'

/** 처음 열 때 받는 최근 메시지 수 (그날 전체를 받지 않는다) */
export const INITIAL_MESSAGES = 100
/** "이전 메시지 보기" 한 번에 받는 수 */
export const OLDER_MESSAGES = 100
/** 화면이 들고 있는 메시지 상한 (넘으면 오래된 것부터 버리고 "이전 메시지 보기"로 다시 받는다) */
export const MAX_MESSAGES = 1500
/** SSE가 아주 닫혔을 때 다시 붙기까지 */
const RECONNECT_MS = 2000
/** 처음 열 때 메시지 조회가 전체 조회보다 앞선 seq였으면 최근 메시지를 다시 받는 횟수 */
const MESSAGES_RELOAD_TRIES = 3
/** 다시 받기 실패 뒤 처음 기다림 (AC-S06-41) */
export const RETRY_START_MS = 1000
/** 다시 받기 실패 뒤 가장 긴 기다림 (AC-S06-41) */
export const RETRY_MAX_MS = 30_000

/** n번째 실패(1부터) 뒤 기다림: 1초부터 두 배씩, 최대 30초 */
export function retryDelayMs(failures: number): number {
  const exponent = Math.max(0, Math.min(failures - 1, 16))
  return Math.min(RETRY_START_MS * 2 ** exponent, RETRY_MAX_MS)
}

export type Connection = 'connecting' | 'open' | 'lost'

export interface ConsoleSnapshot {
  readonly phase: 'loading' | 'ready' | 'missing' | 'error'
  readonly error: ApiError | null
  readonly broadcast: BroadcastItem | null
  readonly data: ScopeData | null
  /** 그 방송의 메시지, seq 오름차순 (메시지를 받지 않는 화면은 빈 목록) */
  readonly messages: readonly ChatMessage[]
  /** 앞에 더 있는지 ("이전 메시지 보기") */
  readonly olderMessages: boolean
  readonly loadingOlder: boolean
  readonly connection: Connection
  readonly generator: GeneratorStatus | null
  /** 화면을 최신으로 맞추지 못해 다시 시도하는 중 (AC-S06-41) */
  readonly stale: boolean
  /** 30일이 지나 봉인한 날짜 (볼 수만 있다, AC-I3-41) */
  readonly sealed: boolean
  /** 봉인한 날짜의 채팅 칸 문장 (서버 sealedMessage) */
  readonly sealedMessage: string | null
}

export interface EventSourceLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  close(): void
}

export interface ScopeKey {
  readonly date: string
  readonly rehearsal: boolean
}

export interface ConsoleStoreOptions {
  /** 방송으로 연다 (콘솔·문자찜 입력): 방송 목록에서 그 방송의 범위를 찾는다 */
  readonly broadcastId?: string
  /** 범위로 연다 (구매자·정산) */
  readonly scope?: ScopeKey
  /** 그 방송의 채팅 메시지를 받는가 (기본: 방송으로 열면 받는다) */
  readonly messages?: boolean
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
  stale: false,
  sealed: false,
  sealedMessage: null,
}

/** 로딩 중 화면이 쓰는 빈 상태 */
export const LOADING_SNAPSHOT: ConsoleSnapshot = EMPTY

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

/** 다시 시도하면 되는 실패 (네트워크·5xx) */
function retryable(error: ApiError): boolean {
  return error.network || error.status >= 500
}

export class ConsoleStore {
  readonly broadcastId: string | null
  readonly #fixedScope: ScopeKey | null
  readonly #withMessages: boolean
  readonly #openStream: (url: string) => EventSourceLike
  readonly #timer: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
  readonly #listeners = new Set<() => void>()
  #snapshot: ConsoleSnapshot = EMPTY
  #stream: EventSourceLike | null = null
  #reconnect: unknown = undefined
  #retry: unknown = undefined
  #unwatch: (() => void) | null = null
  #stopped = false
  #catching = false
  #again = false
  #loading = false
  /** 연속 실패 수 (다시 시도 간격) */
  #failures = 0
  /** 다음 다시 시도는 전체 조회 (410 뒤 전체 다시 받기가 실패) */
  #needFull = false
  /** 전체를 다시 받은 뒤 아직 증분을 한 번도 받지 못했다 (그사이 또 410이면 바로 다시 받지 않고 간격을 둔다 — 끝없이 돌지 않게) */
  #justReloaded = false
  /** SSE가 알려 준 그 범위의 가장 큰 seq */
  #notified = 0
  /** 생성기 상태가 바뀐 횟수 (늦게 온 조회 결과가 새 상태를 덮지 않게) */
  #generatorVersion = 0
  /** 유튜브 알림을 받는 화면 조각 */
  readonly #youtube = new Set<(event: YoutubeEvent) => void>()
  /** 끊겼다 다시 붙었을 때 다시 받을 화면 조각 */
  readonly #reconnected = new Set<() => void>()
  /** 받은 ready 수 (두 번째부터 다시 붙은 것) */
  #readyCount = 0

  constructor(options: ConsoleStoreOptions) {
    if ((options.broadcastId === undefined) === (options.scope === undefined)) throw new Error('방송 또는 범위 하나로 연다')
    this.broadcastId = options.broadcastId ?? null
    this.#fixedScope = options.scope ?? null
    this.#withMessages = options.messages ?? options.broadcastId !== undefined
    this.#openStream = options.openStream ?? ((url) => new EventSource(url, { withCredentials: true }))
    this.#timer = options.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): ConsoleSnapshot => this.#snapshot

  /** 유튜브 알림(SSE `youtube`)을 받는다. 돌려준 함수로 그만 받는다 */
  onYoutube = (listener: (event: YoutubeEvent) => void): (() => void) => {
    this.#youtube.add(listener)
    return () => this.#youtube.delete(listener)
  }

  /** 실시간 연결이 끊겼다 다시 붙으면 부른다 (놓친 유튜브 상태 다시 받기) */
  onReconnect = (listener: () => void): (() => void) => {
    this.#reconnected.add(listener)
    return () => this.#reconnected.delete(listener)
  }

  #set(patch: Partial<ConsoleSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }

  /** 보는 범위 (방송으로 열었으면 방송을 찾은 뒤에 안다) */
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

  /** 방송 찾기 → 전체 조회. 실패하면 다시 시도 (처음 불러오기) */
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
      if (!this.#stopped && this.#stream === null && this.#unwatch === null && this.scope !== null && this.#snapshot.phase !== 'missing') {
        this.#connect()
        this.#watchNetwork()
        if (this.#snapshot.broadcast?.rehearsal === true) void this.#loadGenerator()
      }
    }
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    if (this.#reconnect !== undefined) this.#timer.clear(this.#reconnect)
    if (this.#retry !== undefined) this.#timer.clear(this.#retry)
    this.#unwatch?.()
    this.#listeners.clear()
    this.#youtube.clear()
    this.#reconnected.clear()
  }

  /** 실패 하나: "최신으로 맞추지 못함"을 보이고 간격을 늘려 다시 시도한다 */
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

  /** "지금 다시 불러오기" · 새 알림 (기다리지 않고 바로) */
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

  /** 전체 다시 받기 (410 뒤·다시 시도) */
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

  /**
   * 브라우저가 오프라인이 되면 연결이 끊긴 것으로 보이고(열린 연결이 남아 있어도 받지 못할 수 있다),
   * 다시 온라인이 되면 새로 연결해 ready의 seq로 놓친 변경을 받는다.
   */
  #watchNetwork(): void {
    if (typeof window === 'undefined' || this.#unwatch !== null) return
    const offline = () => {
      this.#stream?.close()
      this.#stream = null
      this.#set({ connection: 'lost' })
    }
    const online = () => {
      if (!this.#stopped) this.#connect()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    this.#unwatch = () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }

  /** 전체 조회 (+ 최근 메시지) (처음·RESYNC_REQUIRED) */
  async #loadAll(): Promise<void> {
    if (!this.#withMessages || this.broadcastId === null) {
      const view = await get<FullView>(this.#path(''))
      const data = fromFull(view)
      this.#set({ phase: 'ready', error: null, data, sealed: view.sealed === true })
      if (this.#notified > data.seq && view.sealed !== true) void this.catchUp()
      return
    }
    const b = this.broadcastId
    const latest = () => get<MessagesView>(this.#path('/messages', { b, limit: INITIAL_MESSAGES }))
    const [view, first] = await Promise.all([get<FullView>(this.#path('')), latest()])
    const data = fromFull(view)
    if (view.sealed === true || first.sealed === true) {
      // 봉인한 날짜: 채팅 내용은 지웠고 증분이 없다 — 따라잡지 않는다
      this.#set({ phase: 'ready', error: null, data, messages: [], olderMessages: false, sealed: true, sealedMessage: first.sealedMessage ?? null })
      return
    }
    // 메시지 조회가 전체 조회보다 앞선 seq에서 끝났으면(그사이 채팅이 들어왔다) 그 사이의 채팅·바뀐 기록은 증분(전체 조회 seq 뒤)으로도
    // "이전 메시지 보기"(가장 오래된 메시지 앞)로도 받을 수 없다 — 전체 조회를 받은 뒤 최근 메시지를 다시 받는다(그 조회의 seq ≥ 전체 조회 seq)
    let messages = first
    for (let tries = 0; messages.seq < data.seq && tries < MESSAGES_RELOAD_TRIES && !this.#stopped; tries++) messages = await latest()
    this.#set({ phase: 'ready', error: null, data, messages: messages.messages, olderMessages: messages.more, sealed: false, sealedMessage: null })
    // 메시지 조회가 본 그 뒤의 변경, 알림으로 알고 있는 것은 증분으로
    if (messages.seq > data.seq || this.#notified > data.seq) void this.catchUp()
  }

  /** 리허설 생성기 상태. 조회하는 사이 generator 알림·시작·멈춤 응답이 오면 그쪽이 더 새것이라 조회 결과를 버린다 */
  async #loadGenerator(): Promise<void> {
    if (this.broadcastId === null) return
    const version = ++this.#generatorVersion
    try {
      const { generator } = await get<{ generator: GeneratorStatus }>(`/api/broadcasts/${this.broadcastId}/rehearsal/generator`)
      if (version === this.#generatorVersion) this.#set({ generator })
    } catch {
      // 상태는 다음 generator 알림이나 다시 붙을 때(ready) 다시 온다
    }
  }

  #setGenerator(generator: GeneratorStatus): void {
    this.#generatorVersion++
    this.#set({ generator })
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
      // 다시 붙음: 유튜브 상태(연결·수집·발송함·사용량·알림)는 seq가 없어 다시 받는다 (AC-I3-92)
      if (++this.#readyCount > 1) for (const listener of [...this.#reconnected]) listener()
      const scope = this.scope
      // 생성기 상태는 seq 없는 알림으로만 오므로, 끊긴 사이의 시작·멈춤·다 보냄은 다시 붙을 때 조회로 받는다
      if (this.#snapshot.broadcast?.rehearsal === true) void this.#loadGenerator()
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
    stream.addEventListener('youtube', (event) => {
      const data = parseYoutubeEvent(event.data)
      if (data === null) return
      // 보는 날짜를 봉인했다: 전체를 한 번 다시 받아 봉인한 장부로 (증분 410을 되풀이하지 않는다, AC-I3-41)
      const scope = this.scope
      if (data.kind === 'sealed' && scope !== null && !scope.rehearsal && data.date === scope.date && !this.#snapshot.sealed) void this.#reload()
      for (const listener of [...this.#youtube]) listener(data)
    })
    stream.addEventListener('generator', (event) => {
      const data = parseData<GeneratorStatus & { b: string }>(event)
      if (data !== null && this.broadcastId !== null && data.b === this.broadcastId) this.#setGenerator(data)
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
    // 봉인한 날짜는 증분이 없다 (410을 되풀이하지 않는다)
    if (this.#snapshot.sealed) return
    // 다시 시도하는 중이면 새 알림에 바로 다시 시도한다 (AC-S06-41)
    if (this.#snapshot.stale) {
      void this.retryNow()
      return
    }
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
    if (data === null || this.#stopped || this.#snapshot.sealed) return
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
    const next = applyChanges(current, changes)
    if (!this.#withMessages || this.broadcastId === null) {
      this.#set({ data: next })
      this.#recovered()
      return
    }
    // 그 방송의 새 메시지와, 이미 들고 있는 메시지의 바뀐 기록(메시지 변환)만 — 들고 있지 않은 옛 메시지를 끼워 넣어 빈틈을 만들지 않는다
    const held = new Set(this.#snapshot.messages.map((message) => message.id))
    const mine = changes.messages.filter((message) => message.broadcast === this.broadcastId && (message.seq > changes.since || held.has(message.id)))
    if (changes.messagesMore) {
      // 새 메시지가 너무 많다: 그사이를 다 받지 않고 최근 것만 다시 받는다(빈틈은 "이전 메시지 보기"로)
      try {
        const latest = await get<MessagesView>(this.#path('/messages', { b: this.broadcastId, limit: INITIAL_MESSAGES }))
        this.#set({ data: next, messages: latest.messages, olderMessages: true })
        this.#recovered()
      } catch (error) {
        if (!isApiError(error)) throw error
        if (error.status !== 401) this.#failed(false)
      }
      return
    }
    let messages = mine.length === 0 ? this.#snapshot.messages : mergeMessages(this.#snapshot.messages, mine)
    let older = this.#snapshot.olderMessages
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(messages.length - MAX_MESSAGES)
      older = true
    }
    this.#set({ data: next, messages, olderMessages: older })
    this.#recovered()
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
    if (this.#snapshot.loadingOlder || this.#snapshot.broadcast === null || this.broadcastId === null) return
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
    this.#setGenerator(generator)
  }
}
