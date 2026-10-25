// 되돌리기 (UX-06, D-083, AC-S05-40·41·42).
// - 방송자 조치(host.* 12종): 누를 때 요청 번호를 만들고, 정한 시간(운영 5초) 뒤에 보낸다. 그 안에 되돌리면 보내지 않는다.
//   여러 개면 각자 자기 시간 뒤에 누른 순서대로 보낸다. 화면을 닫거나 로그인이 풀리면(cancelAll) 기다리던 조치는 보내지 않는다.
// - 떠날지 묻는 동안(pause)은 기다리는 조치의 시계를 멈춘다 — 판매자가 고르기 전에 보내지 않는다. 닫으면(resume) 멈췄던 조치마다
//   대기 시간 전체(운영 5초)를 처음부터 다시 기다린다 — 창을 오래 열어 둔 뒤에도 되돌릴 틈이 남는다(D-103, AC-S06b-42).
//   "보내지 않고 떠나기"(discardWaiting)면 기다리던 조치를 모두 보내지 않는다(같은 화면 안의 이동이어도) (D-083, AC-S06-01).
// - 상품 등록: 바로 기록하고, 5초 동안 "되돌리기"(판매 종료)를 보인다 — 되돌리는 일은 화면이 넘긴 함수가 한다.
// - Ctrl+Z는 가장 최근의 되돌릴 수 있는 것(기다리는 조치 또는 5초 안의 등록)을 되돌린다.
// - 1등 자리를 비운 조치(D-MOB2-04): 화면이 넘긴 outcome이 결과 한 줄을 돌려주면 "보냈어요" 대신 그 줄을 10초 보인다("확인"으로 바로 닫힘).
// - 연결이 돌아오면(D-MOB2-07) resendRetryable이 기록되지 않았음이 확실한 실패(retryable)만 같은 요청 번호로 차례대로 한 번 보낸다.
// 시계·타이머는 주입할 수 있다(화면 단위 시험의 가짜 시계).
import { ApiError, isApiError, newRequestId, withRetry, type RetryOptions } from '../api/client.ts'
import type { WriteResult } from '../api/types.ts'

export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** 운영 값: 방송자 조치는 5초 뒤에 보낸다 (D-083). 서버 /api/client-config가 없거나 읽지 못하면 이 값 */
export const HOST_ACTION_DELAY_MS = 5000
/** 등록 되돌리기를 보이는 시간 (D-083 "5초 안") */
export const REGISTER_UNDO_MS = 5000

/** 끝난 항목을 띠에 남겨 두는 시간 */
const KEEP_DONE_MS = 4000
const KEEP_NOT_APPLIED_MS = 10000
/** 1등 자리를 비운 조치의 결과 한 줄을 보이는 시간 (D-MOB2-04) */
export const KEEP_OUTCOME_MS = 10000

export type ActionStatus = 'waiting' | 'sending' | 'retrying' | 'done' | 'outcome' | 'notApplied' | 'cancelled' | 'failed'

/** 1등 자리를 비운 조치의 결과 한 줄 (D-MOB2-04): 새 1등이면 성공 색, 골라야 하면 주의 색 */
export interface OutcomeLine {
  readonly text: string
  readonly tone: 'success' | 'warning' | 'info'
}
export type RegistrationStatus = 'open' | 'undoing' | 'undone' | 'blocked' | 'failed' | 'expired'

interface ItemBase {
  readonly id: number
  readonly createdAt: number
  readonly deadline: number
}

/** 5초 뒤에 보내는 방송자 조치 */
export interface ActionItem extends ItemBase {
  readonly kind: 'action'
  readonly requestId: string
  /** "15번 홍길동 취소" */
  readonly label: string
  readonly status: ActionStatus
  readonly error: ApiError | null
  readonly result: WriteResult | null
  /** "보내기 전" 표시를 붙일 찜·상품 키 */
  readonly claims: readonly string[]
  readonly products: readonly string[]
  /** 화면이 붙인 표시 (메시지 → 찜의 메시지 ID 등), 없으면 null */
  readonly meta: string | null
  /** 서버가 입력을 거절해 창을 다시 열어 고칠 수 있으면 그 버튼 글자("사유 고치기"), 아니면 null */
  readonly reopenLabel: string | null
  /** 시계가 멈춘 동안(떠날지 묻는 중) 남은 시간(밀리초), 흐르는 중이면 null */
  readonly pausedLeft: number | null
  /** 연결이 돌아와 저절로 다시 보낸 것인가 (D-MOB2-07 — "연결이 돌아와 보냈어요: …") */
  readonly auto: boolean
  /** 1등 자리를 비운 조치의 결과 한 줄 (status 'outcome'일 때, D-MOB2-04) */
  readonly outcome: OutcomeLine | null
}

/** 바로 기록한 등록의 되돌리기 */
export interface RegistrationItem extends ItemBase {
  readonly kind: 'registration'
  readonly no: number
  readonly product: string
  readonly status: RegistrationStatus
  readonly message: string | null
  /** 연결이 돌아와 저절로 다시 보낸 등록인가 (D-MOB2-07 — "연결이 돌아와 보냈어요: 15번을 등록했어요") */
  readonly auto: boolean
}

export type UndoItem = ActionItem | RegistrationItem

/** 서버가 입력을 거절했을 때 창을 다시 열어 고치기 (사유의 휴대폰 번호 등, D-079 ⑥) */
export interface ReopenInput {
  /** 띠의 버튼 글자 ("사유 고치기") */
  readonly label: string
  /** 그 오류면 창을 다시 열 수 있다 */
  readonly accepts: (error: ApiError) => boolean
  /** 친 값과 서버 문장으로 창을 다시 연다 */
  readonly open: (error: ApiError) => void
}

export interface ActionInput {
  readonly label: string
  readonly meta?: string
  readonly claims?: readonly string[]
  readonly products?: readonly string[]
  /** 요청 번호로 보낸다 (재시도도 같은 번호) */
  readonly send: (requestId: string) => Promise<WriteResult>
  /** 보낸 뒤 결과 (changed: false 포함) */
  readonly onResult?: (result: WriteResult) => void
  /** 창을 다시 열어 고칠 수 있는 거절 */
  readonly reopen?: ReopenInput
  /** 다시 보내도 안 되거나 서버가 거절했을 때 (실패한 항목과 함께) */
  readonly onError?: (error: ApiError, item: ActionItem) => void
  /**
   * 적용된(changed) 뒤 결과 한 줄을 만든다 (D-MOB2-04 — 1등 자리를 비운 조치). 화면이 응답 seq까지 따라잡은 뒤 돌려준다.
   * null이면 평소처럼 "보냈어요"
   */
  readonly outcome?: (result: WriteResult) => Promise<OutcomeLine | null>
}

export interface RegistrationInput {
  readonly no: number
  readonly product: string
  /**
   * 되돌리기: 찜이 있으면 'blocked'(보내지 않음), 보냈는데 아무 일도 없었으면 'blocked', 판매 종료됐으면 'undone'.
   * 오류는 던진다.
   */
  readonly undo: () => Promise<'undone' | 'blocked'>
  /** 연결이 돌아와 저절로 다시 보낸 등록 (D-MOB2-07) */
  readonly auto?: boolean
}

export interface UndoQueueOptions {
  readonly delayMs?: number
  readonly registerUndoMs?: number
  readonly timer?: Timer
  readonly now?: () => number
  readonly retry?: RetryOptions
  readonly requestId?: () => string
}

/** 등록 되돌리기 문장 (AC-S05-40) */
export const REGISTER_UNDONE = (no: number) => `${String(no)}번 등록을 되돌렸어요(판매 종료)`
export const REGISTER_BLOCKED = '찜이 들어와서 되돌릴 수 없어요. 고치기로 바로잡아 주세요.'

interface Internal {
  item: UndoItem
  timer: unknown
  input?: ActionInput
  registration?: RegistrationInput
}

export class UndoQueue {
  readonly delayMs: number
  readonly registerUndoMs: number
  readonly #timer: Timer
  readonly #now: () => number
  readonly #retry: RetryOptions
  readonly #requestId: () => string
  readonly #items = new Map<number, Internal>()
  readonly #listeners = new Set<() => void>()
  #snapshot: readonly UndoItem[] = []
  #nextId = 1
  #chain: Promise<void> = Promise.resolve()
  #disposed = false
  /** 떠날지 묻는 중이라 기다리는 조치의 시계가 멈춰 있다 */
  #paused = false

  constructor(options: UndoQueueOptions = {}) {
    this.delayMs = options.delayMs ?? HOST_ACTION_DELAY_MS
    this.registerUndoMs = options.registerUndoMs ?? REGISTER_UNDO_MS
    this.#timer = options.timer ?? realTimer
    this.#now = options.now ?? (() => Date.now())
    this.#retry = options.retry ?? {}
    this.#requestId = options.requestId ?? newRequestId
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): readonly UndoItem[] => this.#snapshot

  #emit(): void {
    this.#snapshot = [...this.#items.values()].map((entry) => entry.item)
    for (const listener of this.#listeners) listener()
  }

  #update(id: number, patch: Partial<ActionItem> | Partial<RegistrationItem>): void {
    const entry = this.#items.get(id)
    if (entry === undefined) return
    entry.item = { ...entry.item, ...patch } as UndoItem
    this.#emit()
  }

  #removeLater(id: number, ms: number): void {
    const entry = this.#items.get(id)
    if (entry === undefined) return
    if (entry.timer !== undefined) this.#timer.clear(entry.timer)
    entry.timer = this.#timer.set(() => {
      this.#items.delete(id)
      this.#emit()
    }, ms)
  }

  /** 방송자 조치를 더한다. 요청 번호는 지금(누를 때) 만든다 */
  add(input: ActionInput): ActionItem {
    if (this.#disposed) throw new Error('되돌리기 목록을 이미 닫았다')
    const now = this.#now()
    const item: ActionItem = {
      kind: 'action',
      id: this.#nextId++,
      createdAt: now,
      deadline: now + this.delayMs,
      requestId: this.#requestId(),
      label: input.label,
      status: 'waiting',
      error: null,
      result: null,
      claims: input.claims ?? [],
      products: input.products ?? [],
      meta: input.meta ?? null,
      reopenLabel: null,
      pausedLeft: this.#paused ? this.delayMs : null,
      auto: false,
      outcome: null,
    }
    const entry: Internal = { item, timer: undefined, input }
    this.#items.set(item.id, entry)
    if (!this.#paused) entry.timer = this.#timer.set(() => this.#fire(item.id), this.delayMs)
    this.#emit()
    return item
  }

  /** 등록 되돌리기를 더한다 (등록이 저장된 뒤) */
  addRegistration(input: RegistrationInput): RegistrationItem {
    if (this.#disposed) throw new Error('되돌리기 목록을 이미 닫았다')
    const now = this.#now()
    const item: RegistrationItem = {
      kind: 'registration',
      id: this.#nextId++,
      createdAt: now,
      deadline: now + this.registerUndoMs,
      no: input.no,
      product: input.product,
      status: 'open',
      message: null,
      auto: input.auto === true,
    }
    const entry: Internal = { item, timer: undefined, registration: input }
    this.#items.set(item.id, entry)
    entry.timer = this.#timer.set(() => {
      const current = this.#items.get(item.id)
      if (current?.item.kind === 'registration' && current.item.status === 'open') {
        this.#items.delete(item.id)
        this.#emit()
      }
    }, this.registerUndoMs)
    this.#emit()
    return item
  }

  #fire(id: number): void {
    const entry = this.#items.get(id)
    if (entry === undefined || entry.item.kind !== 'action' || entry.item.status !== 'waiting' || this.#disposed) return
    entry.timer = undefined
    this.#update(id, { status: 'sending' })
    this.#chain = this.#chain.then(() => this.#send(id))
  }

  async #send(id: number): Promise<void> {
    const entry = this.#items.get(id)
    if (entry === undefined || entry.item.kind !== 'action' || entry.input === undefined) return
    const { input } = entry
    const requestId = entry.item.requestId
    try {
      const result = await withRetry(() => input.send(requestId), {
        ...this.#retry,
        onRetry: (attempt) => {
          this.#update(id, { status: 'retrying' })
          this.#retry.onRetry?.(attempt)
        },
      })
      if (result.changed && input.outcome !== undefined) {
        // 결과 한 줄을 만드는 동안(따라잡기)은 "보내는 중"에 둔다 — "보냈어요"가 잠깐 비치지 않게. 다음 조치를 막지 않는다
        this.#update(id, { status: 'sending', result, error: null })
        input.onResult?.(result)
        void this.#settle(id, input.outcome, result)
        return
      }
      this.#update(id, { status: result.changed ? 'done' : 'notApplied', result, error: null })
      this.#removeLater(id, result.changed ? KEEP_DONE_MS : KEEP_NOT_APPLIED_MS)
      input.onResult?.(result)
    } catch (error) {
      const apiError = isApiError(error) ? error : new ApiError({ status: 0, code: 'UNKNOWN', message: '보내지 못했어요. 다시 보내 주세요.' })
      const reopenLabel = input.reopen !== undefined && input.reopen.accepts(apiError) ? input.reopen.label : null
      this.#update(id, { status: 'failed', error: apiError, reopenLabel })
      const failed = this.#items.get(id)?.item
      if (failed?.kind === 'action') input.onError?.(apiError, failed)
    }
  }

  async #settle(id: number, outcome: (result: WriteResult) => Promise<OutcomeLine | null>, result: WriteResult): Promise<void> {
    const line = await outcome(result).catch(() => null)
    if (this.#disposed || this.#items.get(id) === undefined) return
    if (line === null) {
      this.#update(id, { status: 'done' })
      this.#removeLater(id, KEEP_DONE_MS)
      return
    }
    this.#update(id, { status: 'outcome', outcome: line })
    this.#removeLater(id, KEEP_OUTCOME_MS)
  }

  /**
   * 거절된 조치의 창을 다시 연다(띠의 "사유 고치기" 또는 화면이 바로). 그 항목은 띠에서 지운다 — 고친 뒤 보내면 새 조치가 된다.
   * 열었으면 true
   */
  reopen(id: number): boolean {
    const entry = this.#items.get(id)
    if (entry === undefined || entry.item.kind !== 'action' || entry.item.status !== 'failed' || this.#disposed) return false
    const { error, reopenLabel } = entry.item
    const reopen = entry.input?.reopen
    if (error === null || reopenLabel === null || reopen === undefined) return false
    if (entry.timer !== undefined) this.#timer.clear(entry.timer)
    this.#items.delete(id)
    this.#emit()
    reopen.open(error)
    return true
  }

  /** 기다리는 조치를 보내지 않는다 / 5초 안의 등록을 되돌린다. 되돌렸으면 true */
  undo(id: number): boolean {
    const entry = this.#items.get(id)
    if (entry === undefined) return false
    const item = entry.item
    if (item.kind === 'action') {
      if (item.status !== 'waiting') return false
      if (entry.timer !== undefined) this.#timer.clear(entry.timer)
      entry.timer = undefined
      this.#update(id, { status: 'cancelled' })
      this.#removeLater(id, KEEP_DONE_MS)
      return true
    }
    if (item.status !== 'open' || this.#now() > item.deadline || entry.registration === undefined) return false
    if (entry.timer !== undefined) this.#timer.clear(entry.timer)
    entry.timer = undefined
    this.#update(id, { status: 'undoing' })
    const registration = entry.registration
    void registration.undo().then(
      (outcome) => {
        this.#update(id, { status: outcome, message: outcome === 'undone' ? REGISTER_UNDONE(item.no) : REGISTER_BLOCKED })
        this.#removeLater(id, KEEP_NOT_APPLIED_MS)
      },
      (error: unknown) => {
        this.#update(id, { status: 'failed', message: isApiError(error) ? error.message : '되돌리지 못했어요. 다시 해 주세요.' })
        this.#removeLater(id, KEEP_NOT_APPLIED_MS)
      },
    )
    return true
  }

  /** 가장 최근의 되돌릴 수 있는 것 (Ctrl+Z) */
  latestUndoable(): UndoItem | undefined {
    const now = this.#now()
    let best: UndoItem | undefined
    for (const { item } of this.#items.values()) {
      const undoable = item.kind === 'action' ? item.status === 'waiting' : item.status === 'open' && now <= item.deadline
      if (undoable && (best === undefined || item.createdAt >= best.createdAt)) best = item
    }
    return best
  }

  /** Ctrl+Z: 가장 최근 것을 되돌린다 */
  undoLatest(): UndoItem | undefined {
    const item = this.latestUndoable()
    if (item === undefined) return undefined
    return this.undo(item.id) ? item : undefined
  }

  /** 저장하지 못한 조치를 같은 요청 번호로 다시 보낸다 (판매자가 "다시 보내기"를 누름) */
  resend(id: number): void {
    this.#resend(id, false)
  }

  #resend(id: number, auto: boolean): boolean {
    const entry = this.#items.get(id)
    if (entry === undefined || entry.item.kind !== 'action' || entry.item.status !== 'failed' || this.#disposed) return false
    this.#update(id, { status: 'sending', error: null, reopenLabel: null, auto })
    this.#chain = this.#chain.then(() => this.#send(id))
    return true
  }

  /**
   * 연결이 돌아왔다 (D-MOB2-07): 기록되지 않았음이 확실한 실패(ApiError.retryable)만 누른 차례대로 같은 요청 번호로 한 번 보낸다.
   * 판매자가 "확인"으로 닫은 것·되돌린 것은 목록에 없어 보내지 않는다. 보내는 중인 항목은 실패가 아니라 겹치지 않는다.
   * 다 보낼 때까지 기다린다(다음 종류는 그 뒤에). 보낸 수
   */
  async resendRetryable(): Promise<number> {
    let count = 0
    for (const { item } of [...this.#items.values()].sort((a, b) => a.item.id - b.item.id)) {
      if (item.kind !== 'action' || item.status !== 'failed' || item.error?.retryable !== true) continue
      if (this.#resend(item.id, true)) count++
    }
    await this.#chain
    return count
  }

  /** 끝난 항목을 띠에서 지운다 */
  dismiss(id: number): void {
    const entry = this.#items.get(id)
    if (entry === undefined) return
    if (entry.item.kind === 'action' && (entry.item.status === 'waiting' || entry.item.status === 'sending' || entry.item.status === 'retrying')) return
    if (entry.timer !== undefined) this.#timer.clear(entry.timer)
    this.#items.delete(id)
    this.#emit()
  }

  /**
   * 떠날지 묻는 동안 기다리는 조치의 시계를 멈춘다 — 그동안은 보내지 않는다(판매자가 "보내지 않고 떠나기"를 고를 수 있게, D-083).
   * 등록 되돌리기(이미 기록됨)는 멈추지 않는다.
   */
  pause(): void {
    if (this.#paused || this.#disposed) return
    this.#paused = true
    const now = this.#now()
    for (const entry of this.#items.values()) {
      const item = entry.item
      if (item.kind !== 'action' || item.status !== 'waiting') continue
      if (entry.timer !== undefined) this.#timer.clear(entry.timer)
      entry.timer = undefined
      entry.item = { ...item, pausedLeft: Math.max(0, item.deadline - now) }
    }
    this.#emit()
  }

  /**
   * 묻기를 닫았다(머무르기): 멈췄던 조치마다 대기 시간 전체를 처음부터 다시 기다린다 — 남은 시간이 얼마였든, 창을 얼마나 열었든 (D-103).
   * 되돌리기 띠도 처음 값부터 센다.
   */
  resume(): void {
    if (!this.#paused) return
    this.#paused = false
    if (this.#disposed) return
    const now = this.#now()
    for (const entry of this.#items.values()) {
      const item = entry.item
      if (item.kind !== 'action' || item.pausedLeft === null) continue
      entry.item = { ...item, deadline: now + this.delayMs, pausedLeft: null }
      if (item.status === 'waiting') entry.timer = this.#timer.set(() => this.#fire(item.id), this.delayMs)
    }
    this.#emit()
  }

  /** 떠날지 묻는 중인가 */
  get paused(): boolean {
    return this.#paused
  }

  /**
   * "보내지 않고 떠나기": 기다리던 조치를 모두 보내지 않는다(띠에는 "보내지 않았어요"). 목록은 계속 쓴다 — 같은 화면 안의 이동이면 화면이 내려가지 않는다.
   * 보내지 않은 조치 수
   */
  discardWaiting(): number {
    let count = 0
    for (const entry of [...this.#items.values()]) {
      const item = entry.item
      if (item.kind !== 'action' || item.status !== 'waiting') continue
      if (entry.timer !== undefined) this.#timer.clear(entry.timer)
      entry.timer = undefined
      entry.item = { ...item, pausedLeft: null }
      if (this.undo(item.id)) count++
    }
    this.#paused = false
    this.#emit()
    return count
  }

  /** 기다리는 조치 수 */
  get waitingCount(): number {
    let n = 0
    for (const { item } of this.#items.values()) if (item.kind === 'action' && item.status === 'waiting') n++
    return n
  }

  /**
   * 화면을 닫거나 로그인이 풀렸다: 기다리던 조치는 보내지 않는다(D-083). 그 뒤로는 아무것도 보내지 않는다.
   */
  cancelAll(): void {
    this.#disposed = true
    for (const entry of this.#items.values()) if (entry.timer !== undefined) this.#timer.clear(entry.timer)
    this.#items.clear()
    this.#emit()
  }
}
