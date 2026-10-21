// 입금 확인 신호 (N3, AC-N3-40·30). 앱 전체에 하나 — 메뉴의 "입금 확인 3"과 입금 확인 화면이 같은 것을 본다.
// - 확인 필요 수: 처음과 실시간 연결이 다시 붙을 때(ready — 끊긴 사이의 알림은 따라잡을 수 없다) GET /api/deposits/count,
//   그 사이에는 `deposit` 알림의 review로 바로 바꾼다(다른 기기에서 처리해도 1초 안에).
// - 입금 목록·원천은 이 저장소가 들고 있지 않다: 알림마다 판(tick)을 올리고, 보는 화면이 판이 바뀌면 다시 받는다.
//   실제 범위의 기록(change)도 판(scopeTick)을 올린다 — 확인 필요의 사유·제안은 볼 때의 묶음 상태로 다시 계산하기 때문(DP-5).
// - 페이지의 실시간 연결(lib/stream.ts) 하나를 함께 쓴다. 닫힌 연결은 조금 뒤 다시 연다(출력 기록 저장소와 같은 방식).
import { get, isApiError } from '../api/client.ts'
import type { DepositNotice } from '../api/deposit-types.ts'
import type { ScopeSeq } from '../api/types.ts'
import type { EventSourceLike } from './stream.ts'

/** 닫힌 실시간 연결을 다시 열기까지 */
const RECONNECT_MS = 2000

export interface DepositSignal {
  /** 확인 필요 수 (모르면 null — 메뉴에 수를 붙이지 않는다) */
  readonly review: number | null
  /** 입금이 저장·처리됐거나 다시 붙었다 — 입금 목록을 다시 받을 때 */
  readonly tick: number
  /** 원천 상태가 바뀌었다 (원천 목록을 다시 받을 때) */
  readonly sourcesTick: number
  /** 실제 범위에 기록이 생겼다 (확인 필요의 제안을 다시 받을 때) */
  readonly scopeTick: number
}

export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface DepositStoreOptions {
  readonly openStream: () => EventSourceLike
  /** 닫힌 연결을 다시 열기 (공유 연결의 ensure) */
  readonly reconnect?: () => void
  readonly timer?: Timer
}

function parse(event: MessageEvent): unknown {
  try {
    return JSON.parse(String(event.data))
  } catch {
    return null
  }
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const INITIAL_SIGNAL: DepositSignal = { review: null, tick: 0, sourcesTick: 0, scopeTick: 0 }

export class DepositStore {
  readonly #options: DepositStoreOptions
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  #snapshot: DepositSignal = INITIAL_SIGNAL
  #stream: EventSourceLike | null = null
  #reconnect: unknown
  #stopped = false
  /** 수를 받는 중 (그 사이 알림이 오면 늦게 온 응답이 알림의 수를 덮지 않게) */
  #counting = 0

  constructor(options: DepositStoreOptions) {
    this.#options = options
    this.#timer = options.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): DepositSignal => this.#snapshot

  #set(patch: Partial<DepositSignal>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  start(): void {
    this.#connect()
    void this.refreshCount()
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    if (this.#reconnect !== undefined) this.#timer.clear(this.#reconnect)
    this.#listeners.clear()
  }

  /** 확인 필요 수를 다시 받는다 (화면이 처리한 뒤에도 부른다) */
  async refreshCount(): Promise<void> {
    const ticket = ++this.#counting
    try {
      const { review } = await get<{ review: number }>('/api/deposits/count')
      if (ticket === this.#counting && isCount(review)) this.#set({ review })
    } catch (error) {
      if (!isApiError(error)) throw error
      // 수를 모르면 메뉴에 수를 붙이지 않을 뿐이다 (다음 알림·다시 붙을 때 다시)
    }
  }

  /** 처리 응답이 알려 준 확인 필요 수 (목록 응답의 review) */
  setReview(review: number): void {
    if (!isCount(review)) return
    this.#counting++
    this.#set({ review })
  }

  #connect(): void {
    if (this.#stopped) return
    this.#stream?.close()
    const stream = this.#options.openStream()
    this.#stream = stream
    stream.addEventListener('ready', () => {
      if (this.#stream !== stream) return
      // 끊긴 사이의 알림은 따라잡을 수 없다 — 수와 목록을 다시 받는다
      void this.refreshCount()
      this.#set({ tick: this.#snapshot.tick + 1, sourcesTick: this.#snapshot.sourcesTick + 1 })
    })
    stream.addEventListener('deposit', (event) => {
      if (this.#stream !== stream) return
      const data = parse(event) as Partial<DepositNotice> | null
      if (data === null || typeof data !== 'object') return
      const patch: { -readonly [K in keyof DepositSignal]?: DepositSignal[K] } = { tick: this.#snapshot.tick + 1 }
      if (isCount(data.review)) {
        this.#counting++
        patch.review = data.review
      }
      if (Array.isArray(data.sources) && data.sources.length > 0) patch.sourcesTick = this.#snapshot.sourcesTick + 1
      this.#set(patch)
    })
    stream.addEventListener('change', (event) => {
      if (this.#stream !== stream) return
      const data = parse(event) as ScopeSeq | null
      if (data === null || data.rehearsal) return
      this.#set({ scopeTick: this.#snapshot.scopeTick + 1 })
    })
    stream.onerror = () => {
      if (this.#stream !== stream || stream.readyState !== 2) return
      if (this.#reconnect !== undefined) this.#timer.clear(this.#reconnect)
      this.#reconnect = this.#timer.set(() => {
        this.#reconnect = undefined
        this.#options.reconnect?.()
      }, RECONNECT_MS)
    }
  }
}
