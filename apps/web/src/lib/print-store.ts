// 출력 기록 저장소 (I1, LABEL_RULES L-11, AC-I1-15·23·24·30·32·34). 앱 전체에 하나 — 로그인한 동안 모든 화면이 같은 것을 본다.
// - 대기열 요약·출력 중·대기 작업·버릴 라벨(GET /api/print)과 라벨 설정(GET /api/print/templates), 화면 설정(시험 모드 신호).
// - 실시간: 페이지의 실시간 연결(lib/stream.ts)의 `print` 알림으로 바뀐 작업·라벨 키만 덮는다. 순서는 연결을 먼저 연 뒤 조회하고,
//   조회보다 오래된 판(rev)의 알림은 버린다. 판이 둘 이상 뛰면(놓쳤을 수 있다) 조금 뒤 전체를 다시 받는다. 다시 붙으면(ready) 다시 받는다.
// - 범위의 라벨 상태(GET /api/print/labels?date=)·포장 라벨(GET /api/print/packing)은 보는 화면이 있는 동안만 받는다.
//   라벨 상태 응답에는 판이 없다 — 조회가 도는 사이 print 알림으로 받은 라벨 키는 응답보다 새것일 수 있으므로 응답 위에 다시 덮는다
//   (느린 망에서 늦게 온 응답이 그사이 받은 "출력함"을 "출력 중"으로 되돌리지 않게, TE-I1-001). 알림의 라벨은 한 연결로 순서대로 오므로
//   대기열 판과 상관없이 온 순서대로 덮는다.
//   "재출력 필요"는 범위 기록(품종·가격·묶음 변경)으로도 바뀌고 그때는 print 알림이 없다 — 그 날짜의 change 알림이 오면 다시 받는다.
//   채팅·문자찜 기록으로는 다시 받지 않는다. 자동 출력을 끈 방송에서 그 기록으로 생긴 1등은 작업이 없어 print 알림도 없으므로,
//   상품 자세히가 1등 라벨 키가 없다고 알릴 때(ensureLabels) 한 번 다시 받는다.
// - 리허설 범위에는 라벨이 없다(D-I1-08) — 조회하지 않는다.
import { get, isApiError, post, withQuery, type ApiError } from '../api/client.ts'
import type { ClientConfig, JobView, LabelView, PackingView, PrintNotice, PrintOverview, QueueSummary, StoredTemplate, Templates } from '../api/print-types.ts'

type QueueNotice = Extract<PrintNotice, { rev: number }>
import type { ScopeSeq } from '../api/types.ts'
import type { EventSourceLike } from './stream.ts'

/** 다시 받기 실패 뒤 처음 기다림 */
const RETRY_START_MS = 1000
const RETRY_MAX_MS = 30_000
/** 판이 뛰었을 때·범위 기록이 바뀌었을 때 다시 받기까지 (알림이 몰려도 한 번) */
const RELOAD_DELAY_MS = 250
/**
 * 라벨 상태(재출력 필요)를 바꾸지 않는 기록 종류 — 채팅·문자찜은 품종·가격을 바꾸지 않고, 그 기록으로 1등이 바뀌면 작업·폐기가 print 알림으로 온다.
 * 방송 중 채팅마다 라벨 상태를 다시 받지 않게 한다(포장 라벨은 묶음이 바뀌므로 모든 기록에 다시 받는다)
 */
const LABEL_QUIET_TYPES: ReadonlySet<string> = new Set(['chat', 'sms', 'effect.labelPrinted'])
/** 닫힌 실시간 연결을 다시 열기까지 */
const RECONNECT_MS = 2000

export type PrintConnection = 'connecting' | 'open' | 'lost'

export interface PrintSnapshot {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly error: ApiError | null
  readonly config: ClientConfig | null
  readonly overview: PrintOverview | null
  readonly templates: Templates | null
  readonly connection: PrintConnection
}

export interface LabelsSnapshot {
  readonly phase: 'loading' | 'ready' | 'missing' | 'error'
  readonly error: ApiError | null
  /** 라벨 키 → 상태 (방송 선언·번호·확정버전 순) */
  readonly labels: ReadonlyMap<string, LabelView>
}

export interface PackingSnapshot {
  readonly phase: 'loading' | 'ready' | 'missing' | 'error'
  readonly error: ApiError | null
  readonly view: PackingView | null
}

export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface PrintStoreOptions {
  readonly openStream: () => EventSourceLike
  /** 닫힌 연결을 다시 열기 (공유 연결의 ensure) */
  readonly reconnect?: () => void
  readonly timer?: Timer
}

const jobKey = (job: { readonly date: string; readonly id: string }): string => `${job.date}|${job.id}`
const isActive = (job: JobView): boolean => job.status === 'WAITING' || job.status === 'PRINTING'

/** 출력 중·대기 작업 목록에 바뀐 작업을 덮는다: 출력 중 먼저, 대기는 순서대로(출력 중에서 대기로 돌아온 작업은 대기 맨 앞) */
export function mergeActiveJobs(current: readonly JobView[], incoming: readonly JobView[]): JobView[] {
  const out = [...current]
  for (const job of incoming) {
    const index = out.findIndex((item) => jobKey(item) === jobKey(job))
    if (index < 0) {
      if (!isActive(job)) continue
      if (job.status === 'PRINTING') out.unshift(job)
      else out.push(job)
      continue
    }
    const previous = out[index] as JobView
    if (!isActive(job)) {
      out.splice(index, 1)
      continue
    }
    if (previous.status === 'PRINTING' && job.status === 'WAITING') {
      // 실패·끊김·출력 기기 바꾸기로 되돌아온 작업은 대기 맨 앞 (L-8 3, L-11 10)
      out.splice(index, 1)
      const firstWaiting = out.findIndex((item) => item.status === 'WAITING')
      out.splice(firstWaiting < 0 ? out.length : firstWaiting, 0, job)
      continue
    }
    out[index] = job
  }
  return [...out.filter((job) => job.status === 'PRINTING'), ...out.filter((job) => job.status === 'WAITING')]
}

/** 버릴 라벨 목록에 바뀐 작업을 덮는다 */
export function mergeDiscardJobs(current: readonly JobView[], incoming: readonly JobView[]): JobView[] {
  const out = [...current]
  for (const job of incoming) {
    const index = out.findIndex((item) => jobKey(item) === jobKey(job))
    if (job.discard) {
      if (index < 0) out.push(job)
      else out[index] = job
    } else if (index >= 0) out.splice(index, 1)
  }
  return out
}

function parse(event: MessageEvent): unknown {
  try {
    return JSON.parse(String(event.data))
  } catch {
    return null
  }
}

const retryable = (error: ApiError): boolean => error.network || error.status >= 500

interface Watched<S> {
  snapshot: S
  readonly listeners: Set<() => void>
  count: number
  loading: boolean
  again: boolean
  reload: unknown
}

interface WatchedLabels extends Watched<LabelsSnapshot> {
  /** 지금 도는 조회를 보낸 뒤 print 알림으로 받은 라벨 (라벨 키 → 상태). 조회가 돌지 않으면 null */
  fresh: Map<string, LabelView> | null
  /** 보는 화면이 없다고 알려 다시 받은 라벨 키 (키마다 한 번만 — 다시 받아도 없으면 더 묻지 않는다) */
  readonly asked: Set<string>
}

const EMPTY_LABELS: LabelsSnapshot = { phase: 'loading', error: null, labels: new Map() }
const EMPTY_PACKING: PackingSnapshot = { phase: 'loading', error: null, view: null }

export class PrintStore {
  readonly #options: PrintStoreOptions
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  #snapshot: PrintSnapshot = { phase: 'loading', error: null, config: null, overview: null, templates: null, connection: 'connecting' }
  #stream: EventSourceLike | null = null
  #stopped = false
  #loading = false
  #again = false
  #failures = 0
  #retry: unknown = undefined
  #reload: unknown = undefined
  #reconnect: unknown = undefined
  /** 처음 조회가 끝나기 전에 온 알림 */
  #buffer: QueueNotice[] = []
  readonly #labels = new Map<string, WatchedLabels>()
  readonly #packing = new Map<string, Watched<PackingSnapshot> & { readonly date: string; readonly buyer: string }>()

  constructor(options: PrintStoreOptions) {
    this.#options = options
    this.#timer = options.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): PrintSnapshot => this.#snapshot

  #set(patch: Partial<PrintSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  get queue(): QueueSummary | null {
    return this.#snapshot.overview?.queue ?? null
  }

  start(): void {
    this.#connect()
    void this.#loadConfig()
    void this.reload()
    void this.reloadTemplates()
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    for (const handle of [this.#retry, this.#reload, this.#reconnect]) if (handle !== undefined) this.#timer.clear(handle)
    for (const entry of [...this.#labels.values(), ...this.#packing.values()]) if (entry.reload !== undefined) this.#timer.clear(entry.reload)
    this.#labels.clear()
    this.#packing.clear()
    this.#listeners.clear()
  }

  // ── 실시간 ─────────────────────────────────────────────────────────────

  #connect(): void {
    if (this.#stopped) return
    this.#stream?.close()
    const stream = this.#options.openStream()
    this.#stream = stream
    stream.addEventListener('ready', () => {
      if (this.#stream !== stream) return
      this.#set({ connection: 'open' })
      // 끊긴 사이의 알림은 seq가 없어 따라잡을 수 없다 — 다시 받는다
      if (this.#snapshot.overview !== null || this.#snapshot.phase === 'error') void this.reload()
      this.#reloadAllWatched()
    })
    stream.addEventListener('print', (event) => {
      if (this.#stream !== stream) return
      const data = parse(event) as PrintNotice | null
      if (data !== null) this.#onNotice(data)
    })
    stream.addEventListener('change', (event) => {
      if (this.#stream !== stream) return
      const data = parse(event) as (ScopeSeq & { type?: string }) | null
      if (data === null || data.rehearsal) return
      this.#onScopeChange(data.date, typeof data.type === 'string' ? data.type : '')
    })
    stream.onerror = () => {
      if (this.#stream !== stream) return
      this.#set({ connection: 'lost' })
      if (stream.readyState === 2) {
        if (this.#reconnect !== undefined) this.#timer.clear(this.#reconnect)
        this.#reconnect = this.#timer.set(() => {
          this.#reconnect = undefined
          this.#options.reconnect?.()
        }, RECONNECT_MS)
      }
    }
  }

  #onNotice(notice: PrintNotice): void {
    if ('template' in notice) {
      void this.reloadTemplates()
      return
    }
    const overview = this.#snapshot.overview
    if (overview === null) this.#buffer.push(notice)
    else this.#applyNotice(overview, notice)
    // 라벨은 대기열 판과 따로 덮는다 (오래된 판이라 대기열은 버려도, 라벨 상태 조회는 그보다 먼저였을 수 있다)
    for (const label of notice.labels) this.#upsertLabel(label)
  }

  #applyNotice(overview: PrintOverview, notice: QueueNotice): void {
    // 조회·앞 알림보다 오래된 판은 이미 반영된 것이다
    if (notice.rev < overview.queue.rev) return
    if (notice.rev > overview.queue.rev + 1) this.#scheduleReload()
    this.#set({
      overview: {
        queue: notice.queue,
        jobs: mergeActiveJobs(overview.jobs, notice.jobs),
        discard: mergeDiscardJobs(overview.discard, notice.jobs),
      },
    })
  }

  /** 서버 응답의 대기열 요약 (조치 뒤 바로 보이게 — 알림도 곧 온다) */
  applyQueue(queue: QueueSummary): void {
    const overview = this.#snapshot.overview
    if (overview === null || queue.rev < overview.queue.rev) return
    this.#set({ overview: { ...overview, queue } })
  }

  /** 서버 응답의 작업 (조치 뒤 바로 보이게) */
  applyJobs(jobs: readonly JobView[]): void {
    const overview = this.#snapshot.overview
    if (overview === null || jobs.length === 0) return
    this.#set({ overview: { ...overview, jobs: mergeActiveJobs(overview.jobs, jobs), discard: mergeDiscardJobs(overview.discard, jobs) } })
  }

  #scheduleReload(): void {
    if (this.#reload !== undefined) return
    this.#reload = this.#timer.set(() => {
      this.#reload = undefined
      void this.reload()
    }, RELOAD_DELAY_MS)
  }

  // ── 조회 ───────────────────────────────────────────────────────────────

  async #loadConfig(): Promise<void> {
    try {
      const config = await get<Partial<ClientConfig>>('/api/client-config')
      this.#set({ config: { hostActionDelayMs: typeof config.hostActionDelayMs === 'number' ? config.hostActionDelayMs : 5000, testPrinter: config.testPrinter === true } })
    } catch {
      // 읽지 못하면 시험 모드가 아니다
      this.#set({ config: { hostActionDelayMs: 5000, testPrinter: false } })
    }
  }

  /** 대기열 전체 다시 받기 (처음·다시 붙음·판이 뜀·다시 시도) */
  async reload(): Promise<void> {
    if (this.#stopped) return
    if (this.#loading) {
      this.#again = true
      return
    }
    this.#loading = true
    try {
      do {
        this.#again = false
        const overview = await get<PrintOverview>('/api/print')
        const current = this.#snapshot.overview
        // 받는 사이 더 새 알림이 왔으면 그쪽을 둔다 (곧 다시 받는다)
        if (current !== null && current.queue.rev > overview.queue.rev) this.#scheduleReload()
        else {
          let next: PrintOverview = overview
          const buffered = this.#buffer
          this.#buffer = []
          for (const notice of buffered) {
            if (notice.rev < next.queue.rev) continue
            next = { queue: notice.queue, jobs: mergeActiveJobs(next.jobs, notice.jobs), discard: mergeDiscardJobs(next.discard, notice.jobs) }
          }
          this.#set({ phase: 'ready', error: null, overview: next })
        }
        this.#failures = 0
        if (this.#retry !== undefined) {
          this.#timer.clear(this.#retry)
          this.#retry = undefined
        }
      } while (this.#again && !this.#stopped)
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 401) return
      if (this.#snapshot.overview === null) this.#set({ phase: 'error', error })
      if (retryable(error)) {
        this.#failures++
        if (this.#retry !== undefined) this.#timer.clear(this.#retry)
        this.#retry = this.#timer.set(
          () => {
            this.#retry = undefined
            void this.reload()
          },
          Math.min(RETRY_START_MS * 2 ** Math.min(this.#failures - 1, 16), RETRY_MAX_MS),
        )
      }
    } finally {
      this.#loading = false
    }
  }

  async reloadTemplates(): Promise<void> {
    try {
      const templates = await get<Templates>('/api/print/templates')
      this.#set({ templates })
    } catch {
      // 다음 알림·다시 붙을 때 다시 받는다
    }
  }

  /** 저장한 템플릿 (저장 응답 — 알림을 기다리지 않고 바로) */
  setTemplate(kind: 'product' | 'packing', stored: StoredTemplate): void {
    const templates = this.#snapshot.templates
    if (templates === null || stored.template.kind !== kind) return
    if (stored.version < templates[kind].version) return
    this.#set({ templates: { ...templates, [kind]: stored } as Templates })
  }

  // ── 조치 ───────────────────────────────────────────────────────────────

  /** 쓰기 하나 (응답에 대기열 요약·작업이 있으면 바로 덮는다) */
  async act<T extends object>(path: string, body: unknown): Promise<T> {
    const result = await post<T>(path, body)
    const record = result as { queue?: QueueSummary; jobs?: JobView[]; job?: JobView }
    if (record.queue !== undefined) this.applyQueue(record.queue)
    if (Array.isArray(record.jobs)) this.applyJobs(record.jobs)
    if (record.job !== undefined && record.job !== null) this.applyJobs([record.job])
    return result
  }

  // ── 범위의 라벨 상태 (보는 화면이 있는 동안) ───────────────────────────

  /** 날짜의 라벨 상태를 본다. 돌려준 함수로 그만 본다 */
  watchLabels(date: string, listener: () => void): () => void {
    let entry = this.#labels.get(date)
    if (entry === undefined) {
      entry = { snapshot: EMPTY_LABELS, listeners: new Set(), count: 0, loading: false, again: false, reload: undefined, fresh: null, asked: new Set() }
      this.#labels.set(date, entry)
      void this.#loadLabels(date)
    }
    entry.count++
    entry.listeners.add(listener)
    const current = entry
    return () => {
      current.listeners.delete(listener)
      current.count--
      if (current.count <= 0) {
        if (current.reload !== undefined) this.#timer.clear(current.reload)
        this.#labels.delete(date)
      }
    }
  }

  labelsSnapshot(date: string): LabelsSnapshot {
    return this.#labels.get(date)?.snapshot ?? EMPTY_LABELS
  }

  async #loadLabels(date: string): Promise<void> {
    const entry = this.#labels.get(date)
    if (entry === undefined || this.#stopped) return
    if (entry.loading) {
      entry.again = true
      return
    }
    entry.loading = true
    try {
      do {
        entry.again = false
        const fresh = new Map<string, LabelView>()
        entry.fresh = fresh
        try {
          const view = await get<{ date: string; labels: LabelView[] }>(withQuery('/api/print/labels', { date }))
          const labels = new Map(view.labels.map((label) => [label.key, label]))
          // 보낸 뒤 받은 알림의 라벨이 응답보다 새것이다 (응답에는 판이 없다)
          for (const [key, label] of fresh) labels.set(key, label)
          entry.snapshot = { phase: 'ready', error: null, labels }
        } catch (error) {
          if (!isApiError(error)) throw error
          if (error.status === 404) entry.snapshot = { phase: 'missing', error: null, labels: new Map() }
          else if (error.status !== 401 && entry.snapshot.phase !== 'ready') entry.snapshot = { phase: 'error', error, labels: new Map() }
        }
        for (const listener of [...entry.listeners]) listener()
      } while (entry.again && !this.#stopped && this.#labels.get(date) === entry)
    } finally {
      entry.loading = false
      entry.fresh = null
    }
  }

  #upsertLabel(label: LabelView): void {
    const entry = this.#labels.get(label.date)
    entry?.fresh?.set(label.key, label)
    if (entry !== undefined && entry.snapshot.phase === 'ready') {
      const labels = new Map(entry.snapshot.labels)
      labels.set(label.key, label)
      entry.snapshot = { ...entry.snapshot, labels }
      for (const listener of [...entry.listeners]) listener()
    }
    if (label.kind === 'packing' && label.buyerId !== null) {
      const packing = this.#packing.get(`${label.date}|${label.buyerId}`)
      if (packing !== undefined) this.#scheduleWatched(packing, () => this.#loadPacking(packing.date, packing.buyer))
    }
  }

  #onScopeChange(date: string, type: string): void {
    const labels = this.#labels.get(date)
    if (labels !== undefined && !LABEL_QUIET_TYPES.has(type)) this.#scheduleWatched(labels, () => this.#loadLabels(date))
    for (const entry of this.#packing.values()) if (entry.date === date) this.#scheduleWatched(entry, () => this.#loadPacking(entry.date, entry.buyer))
  }

  #scheduleWatched(entry: Watched<unknown>, load: () => Promise<void>): void {
    if (entry.reload !== undefined) return
    entry.reload = this.#timer.set(() => {
      entry.reload = undefined
      void load()
    }, RELOAD_DELAY_MS)
  }

  #reloadAllWatched(): void {
    for (const date of this.#labels.keys()) void this.#loadLabels(date)
    for (const entry of this.#packing.values()) void this.#loadPacking(entry.date, entry.buyer)
  }

  /**
   * 보는 화면(상품 자세히)의 1등 라벨 키가 라벨 상태에 없으면 그 날짜를 한 번 다시 받는다 (AC-I1-31).
   * 채팅·문자찜 기록은 라벨 상태를 다시 받지 않는다(1등 변화는 작업·폐기의 print 알림으로 온다) — 그런데 자동 출력을 끈 방송은
   * 새 1등에 작업이 없어 print 알림도 없다. 서버 라벨 상태는 작업이 없는 지금 1등도 담으므로 필요한 때만 다시 받는다(채팅마다가 아니라, NFR-01).
   * 라벨 상태를 아직 받지 못했으면(처음 조회 중·오류) 묻지 않는다 — 처음 조회가 끝나면 화면이 다시 묻는다
   */
  ensureLabels(date: string, keys: readonly string[]): void {
    const entry = this.#labels.get(date)
    if (entry === undefined || entry.snapshot.phase !== 'ready') return
    let missing = false
    for (const key of keys) {
      if (entry.snapshot.labels.has(key) || entry.asked.has(key)) continue
      entry.asked.add(key)
      missing = true
    }
    if (missing) this.#scheduleWatched(entry, () => this.#loadLabels(date))
  }

  /** 그 날짜의 라벨 상태를 바로 다시 받는다 (조치 뒤) */
  refreshLabels(date: string): void {
    if (this.#labels.has(date)) void this.#loadLabels(date)
  }

  // ── 포장 라벨 (정산 자세히) ─────────────────────────────────────────────

  watchPacking(date: string, buyer: string, listener: () => void): () => void {
    const key = `${date}|${buyer}`
    let entry = this.#packing.get(key)
    if (entry === undefined) {
      entry = { snapshot: EMPTY_PACKING, listeners: new Set(), count: 0, loading: false, again: false, reload: undefined, date, buyer }
      this.#packing.set(key, entry)
      void this.#loadPacking(date, buyer)
    }
    entry.count++
    entry.listeners.add(listener)
    const current = entry
    return () => {
      current.listeners.delete(listener)
      current.count--
      if (current.count <= 0) {
        if (current.reload !== undefined) this.#timer.clear(current.reload)
        this.#packing.delete(key)
      }
    }
  }

  packingSnapshot(date: string, buyer: string): PackingSnapshot {
    return this.#packing.get(`${date}|${buyer}`)?.snapshot ?? EMPTY_PACKING
  }

  refreshPacking(date: string, buyer: string): void {
    if (this.#packing.has(`${date}|${buyer}`)) void this.#loadPacking(date, buyer)
  }

  async #loadPacking(date: string, buyer: string): Promise<void> {
    const entry = this.#packing.get(`${date}|${buyer}`)
    if (entry === undefined || this.#stopped) return
    if (entry.loading) {
      entry.again = true
      return
    }
    entry.loading = true
    try {
      do {
        entry.again = false
        try {
          const view = await get<PackingView>(withQuery('/api/print/packing', { date, buyer }))
          entry.snapshot = { phase: 'ready', error: null, view }
        } catch (error) {
          if (!isApiError(error)) throw error
          if (error.status === 404) entry.snapshot = { phase: 'missing', error: null, view: null }
          else if (error.status !== 401 && entry.snapshot.phase !== 'ready') entry.snapshot = { phase: 'error', error, view: null }
        }
        for (const listener of [...entry.listeners]) listener()
      } while (entry.again && !this.#stopped && this.#packing.get(`${date}|${buyer}`) === entry)
    } finally {
      entry.loading = false
    }
  }
}
