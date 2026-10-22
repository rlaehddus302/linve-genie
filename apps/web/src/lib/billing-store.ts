// 요금 상태 저장소 (N5, AC-N5-13·51·54~57): 홈·요금 화면이 열린 동안 하나를 연다.
// - 요금 상태(GET /api/billing)를 받고, 실시간 알림 `event: billing`(까닭만 — 부여·회수·결제 주문·방송 일 쓰기·사업자 정보)이 오면 다시 받는다.
//   다른 기기에서 이용권을 사거나 방송 일을 쓰면 1초 안에 미리 보기가 바뀐다(AC-N5-56). 주문 건·라벨 장 쓰기는 알림이 없다 — 화면을 열 때 새로 받는다.
// - 다시 붙으면(ready) 끊긴 사이의 알림을 따라잡을 수 없어 다시 받는다. 화면이 다시 보이면·1분마다도 다시 받는다(창·정액 기간은 시각에 따라 바뀐다).
// - 요금 화면은 결제 내역·쓴 내역도 받는다(첫 장 + "더 보기"로 이어 받기). 다시 받을 때는 첫 장을 새로 받고 이미 이어 받은 뒤쪽은 그대로 둔다.
// - 화면은 이 값을 다시 계산하지 않는다(BL-4 6) — 낱말로만 바꾼다.
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { BillingStatus, ListPage, PaymentItem, UsageItem } from '../api/billing-types.ts'
import type { EventSourceLike } from './stream.ts'

/** 목록 한 장의 개수 (서버 1~100) */
export const BILLING_PAGE_SIZE = 50
/** 화면이 열린 동안 다시 받는 간격 */
export const BILLING_REFRESH_MS = 60_000

export interface ListState<T> {
  readonly items: readonly T[] | null
  readonly next: string | null
  readonly loadingMore: boolean
  readonly error: ApiError | null
}

export interface BillingSnapshot {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly status: BillingStatus | null
  readonly error: ApiError | null
  readonly payments: ListState<PaymentItem>
  readonly usage: ListState<UsageItem>
}

const EMPTY_LIST = { items: null, next: null, loadingMore: false, error: null } as const

export const LOADING_BILLING: BillingSnapshot = { phase: 'loading', status: null, error: null, payments: EMPTY_LIST, usage: EMPTY_LIST }

export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface BillingStoreOptions {
  readonly openStream: () => EventSourceLike
  /** 결제 내역·쓴 내역도 받는다 (요금 화면) */
  readonly lists: boolean
  readonly timer?: Timer
  /** 화면이 다시 보이면 다시 받는다 (기본: 문서의 visibilitychange) */
  readonly watchVisible?: (listener: () => void) => () => void
}

type ListName = 'payments' | 'usage'

const PATHS: Readonly<Record<ListName, string>> = { payments: '/api/billing/payments', usage: '/api/billing/usage' }

function keyOf(item: PaymentItem | UsageItem): string {
  if ('type' in item) return item.type === 'order' ? `o:${item.paymentId}` : `g:${item.grantId}`
  return `u:${String(item.id)}`
}

/**
 * 첫 장을 새로 받았을 때: 새 첫 장 + (이미 이어 받은 뒤쪽 중 새 첫 장의 마지막 뒤에 있던 것). 새 첫 장의 마지막이 예전 목록에 없으면
 * (그사이 새 항목이 한 장 넘게 생겼다) 새 첫 장만 둔다.
 */
export function mergeFirstPage<T extends PaymentItem | UsageItem>(previous: ListState<T>, page: ListPage<T>): { items: readonly T[]; next: string | null } {
  const old = previous.items
  const last = page.items.at(-1)
  if (old === null || last === undefined || old.length <= page.items.length) return { items: page.items, next: page.next }
  const index = old.findIndex((item) => keyOf(item) === keyOf(last))
  if (index < 0) return { items: page.items, next: page.next }
  const fresh = new Set(page.items.map(keyOf))
  const rest = old.slice(index + 1).filter((item) => !fresh.has(keyOf(item)))
  return rest.length === 0 ? { items: page.items, next: page.next } : { items: [...page.items, ...rest], next: previous.next }
}

function parse(event: MessageEvent): unknown {
  try {
    return JSON.parse(String(event.data))
  } catch {
    return null
  }
}

const defaultVisible = (listener: () => void): (() => void) => {
  if (typeof document === 'undefined') return () => {}
  const onChange = () => {
    if (document.visibilityState === 'visible') listener()
  }
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

export class BillingStore {
  readonly #options: BillingStoreOptions
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  readonly #noticeListeners = new Set<(reason: string) => void>()
  #snapshot: BillingSnapshot = LOADING_BILLING
  #stream: EventSourceLike | null = null
  #stopped = false
  #loading = false
  #again = false
  #refresh: unknown = undefined
  #unwatch: (() => void) | null = null

  constructor(options: BillingStoreOptions) {
    this.#options = options
    this.#timer = options.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): BillingSnapshot => this.#snapshot

  /** 요금 알림을 받을 때마다 (까닭) — 화면의 결제 결과 문장을 맞출 때 */
  onNotice(listener: (reason: string) => void): () => void {
    this.#noticeListeners.add(listener)
    return () => this.#noticeListeners.delete(listener)
  }

  #set(patch: Partial<BillingSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  start(): void {
    this.#connect()
    this.#unwatch = (this.#options.watchVisible ?? defaultVisible)(() => void this.reload())
    void this.reload()
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    this.#unwatch?.()
    this.#unwatch = null
    if (this.#refresh !== undefined) this.#timer.clear(this.#refresh)
    this.#refresh = undefined
    this.#listeners.clear()
    this.#noticeListeners.clear()
  }

  #connect(): void {
    const stream = this.#options.openStream()
    this.#stream = stream
    stream.addEventListener('ready', () => {
      if (this.#stream !== stream || this.#snapshot.phase === 'loading') return
      // 끊긴 사이의 요금 알림은 따라잡을 수 없다 — 다시 받는다
      void this.reload()
    })
    stream.addEventListener('billing', (event) => {
      if (this.#stream !== stream) return
      const data = parse(event) as { reason?: unknown } | null
      void this.reload()
      const reason = typeof data?.reason === 'string' ? data.reason : ''
      for (const listener of [...this.#noticeListeners]) listener(reason)
    })
  }

  #schedule(): void {
    if (this.#stopped) return
    if (this.#refresh !== undefined) this.#timer.clear(this.#refresh)
    this.#refresh = this.#timer.set(() => {
      this.#refresh = undefined
      void this.reload()
    }, BILLING_REFRESH_MS)
  }

  /** 요금 상태(요금 화면이면 내역 첫 장까지) 다시 받기. 받는 중에 또 부르면 끝난 뒤 한 번 더 받는다 */
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
        await this.#loadOnce()
      } while (this.#again && !this.#stopped)
    } finally {
      this.#loading = false
      this.#schedule()
    }
  }

  async #loadOnce(): Promise<void> {
    const lists = this.#options.lists
    const [status, payments, usage] = await Promise.allSettled([
      get<BillingStatus>('/api/billing'),
      lists ? get<ListPage<PaymentItem>>(withQuery(PATHS.payments, { limit: BILLING_PAGE_SIZE })) : Promise.resolve(null),
      lists ? get<ListPage<UsageItem>>(withQuery(PATHS.usage, { limit: BILLING_PAGE_SIZE })) : Promise.resolve(null),
    ])
    const patch: { -readonly [K in keyof BillingSnapshot]?: BillingSnapshot[K] } = {}
    if (status.status === 'fulfilled') {
      patch.phase = 'ready'
      patch.status = status.value
      patch.error = null
    } else if (isApiError(status.reason)) {
      // 이미 받은 상태가 있으면 그대로 보이고 오류를 함께 둔다
      patch.phase = this.#snapshot.status === null ? 'error' : 'ready'
      patch.error = status.reason
    } else throw status.reason
    if (lists) {
      patch.payments = this.#merged('payments', payments)
      patch.usage = this.#merged('usage', usage)
    }
    this.#set(patch)
  }

  #merged<T extends PaymentItem | UsageItem>(name: ListName, result: PromiseSettledResult<ListPage<T> | null>): ListState<T> {
    const previous = this.#snapshot[name] as ListState<T>
    if (result.status === 'rejected') {
      if (!isApiError(result.reason)) throw result.reason
      return { ...previous, error: result.reason }
    }
    if (result.value === null) return previous
    const merged = mergeFirstPage(previous, result.value)
    return { items: merged.items, next: merged.next, loadingMore: previous.loadingMore, error: null }
  }

  /** "더 보기": 다음 장을 이어 받는다 */
  async loadMore(name: ListName): Promise<void> {
    const list = this.#snapshot[name]
    if (list.next === null || list.loadingMore || list.items === null) return
    this.#set({ [name]: { ...list, loadingMore: true, error: null } })
    try {
      const page = await get<ListPage<PaymentItem | UsageItem>>(withQuery(PATHS[name], { limit: BILLING_PAGE_SIZE, cursor: list.next }))
      const current = this.#snapshot[name]
      const seen = new Set((current.items ?? []).map(keyOf))
      const items = [...(current.items ?? []), ...page.items.filter((item) => !seen.has(keyOf(item)))]
      this.#set({ [name]: { items, next: page.next, loadingMore: false, error: null } })
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#set({ [name]: { ...this.#snapshot[name], loadingMore: false, error } })
    }
  }
}
