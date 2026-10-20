// 가짜 웹캐스트와 가짜 시계 (D-N2b-1-07, AC-N2b-1-60). 시험과 N2b-2의 E2E가 쓴다. 바깥 네트워크를 쓰지 않는다(포트도 열지 않는다).
// 실제 감싸개와 같은 경계(WebcastClient)를 낸다 — 연결 관리·이벤트 꺼내기·실패 종류 가르기는 실제와 같은 코드가 돈다.
// 이벤트 이름·자료 모양과 실패 값은 tiktok-live-connector 2.1.0을 흉내 낸다(chat = WebcastChatMessage, 실패 = 라이브러리 오류 형 이름).
import type { TikTokClock } from './clock.ts'
import type { TikTokFailureKind } from './failure.ts'
import type { TikTokLibraryOptions } from './settings.ts'
import type { WebcastClient, WebcastFactory } from './webcast.ts'

// ── 가짜 시계 ────────────────────────────────────────────────────────────

interface FakeTimer {
  readonly seq: number
  readonly at: number
  readonly fn: () => void
}

/** 이미 줄 선 마이크로태스크(약속 이어 붙이기)를 모두 돌린다 */
export async function flushTikTokTasks(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** 주입하는 가짜 시계. advance()가 그 사이의 타이머를 시각 순서대로 부르고, 타이머마다 약속 이어 붙이기를 다 돌린다 */
export class FakeTikTokClock implements TikTokClock {
  #now: number
  #seq = 0
  #timers: FakeTimer[] = []

  constructor(start = 0) {
    this.#now = start
  }

  now(): number {
    return this.#now
  }

  setTimer(ms: number, fn: () => void): () => void {
    const timer: FakeTimer = { seq: (this.#seq += 1), at: this.#now + Math.max(0, ms), fn }
    this.#timers.push(timer)
    return () => {
      this.#timers = this.#timers.filter((t) => t !== timer)
    }
  }

  /** 남은 타이머 수 */
  get pendingTimers(): number {
    return this.#timers.length
  }

  async advance(ms: number): Promise<void> {
    await this.advanceTo(this.#now + ms)
  }

  async advanceTo(at: number): Promise<void> {
    await flushTikTokTasks()
    for (;;) {
      let next: FakeTimer | undefined
      for (const t of this.#timers) if (t.at <= at && (next === undefined || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t
      if (next === undefined) break
      const due = next
      this.#timers = this.#timers.filter((t) => t !== due)
      this.#now = Math.max(this.#now, due.at)
      due.fn()
      await flushTikTokTasks()
    }
    this.#now = Math.max(this.#now, at)
    await flushTikTokTasks()
  }
}

// ── 라이브러리 2.1.0 모양의 자료·오류 ───────────────────────────────────────

/** 가짜 댓글의 값 (모두 선택 — 틀린 값도 그대로 싣는다). ID는 문자열·bigint·숫자·protobuf 정수 객체 무엇이든 */
export interface FakeChatFields {
  readonly msgId?: unknown
  readonly userId?: unknown
  readonly uniqueId?: unknown
  readonly nickname?: unknown
  readonly comment?: unknown
  readonly createTime?: unknown
}

/**
 * 라이브러리 2.1.0의 chat 이벤트 자료(WebcastChatMessage)와 같은 모양. 프로필 사진·배지·secUid·팔로우 정보 같은 원본 자료도 싣는다
 * (레코드·상태에 남지 않는지 보려고).
 */
export function fakeChatEvent(fields: FakeChatFields): Record<string, unknown> {
  return {
    common: { method: 'WebcastChatMessage', msgId: fields.msgId, roomId: '7300000000000000001', createTime: fields.createTime, isShowMsg: true },
    user: {
      userId: fields.userId,
      uniqueId: fields.uniqueId,
      nickname: fields.nickname,
      secUid: 'MS4wLjABAAAAfakeSecUid',
      profilePicture: { url: ['https://p16-sign.example.invalid/fake-avatar.webp'] },
      badges: [{ displayType: 1 }],
      followInfo: { followingCount: '10', followerCount: '20', followStatus: '0' },
      bioDescription: 'fake bio',
    },
    comment: fields.comment,
    visibleToSender: false,
    emotes: [],
    contentLanguage: 'ko',
  }
}

/** 라이브러리 오류 형과 같은 이름의 가짜 오류들 (실패 종류는 형 이름·칸으로 갈린다 — failure.ts) */
class UserOfflineError extends Error {}
class SignAPIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignAPIError'
  }
}
class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidResponseError'
  }
}
class FetchIsLiveError extends Error {
  readonly errors: readonly unknown[]
  constructor(errors: readonly unknown[]) {
    super('Failed to retrieve Room ID from all sources.')
    this.errors = errors
  }
}

const httpError = (status: number): Error => Object.assign(new Error(`Request failed with status code ${String(status)}`), { isAxiosError: true, response: { status } })
const netError = (): Error => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET', isAxiosError: true })

/** 실패 종류마다 라이브러리 2.1.0이 내는 것과 같은 모양의 거부 값 */
export function fakeLibraryError(kind: TikTokFailureKind): unknown {
  switch (kind) {
    case 'NOT_LIVE':
      return new UserOfflineError("The requested user isn't online :(")
    case 'USER_NOT_FOUND':
      return new FetchIsLiveError([
        new Error('Failed to extract the LiveRoom object from SIGI_STATE.'),
        new InvalidResponseError('API Error 19881007 (user_not_found)'),
        new Error('Failed to extract Room ID from Euler.'),
      ])
    case 'BLOCKED':
      return new FetchIsLiveError([httpError(403), httpError(429), new Error('Failed to extract Room ID from Euler.')])
    case 'SIGN_FAILED':
      return new SignAPIError('[Sign Error] Unexpected sign server status 500.')
    case 'NETWORK':
      return new FetchIsLiveError([netError(), netError(), netError()])
  }
}

// ── 가짜 웹캐스트 ────────────────────────────────────────────────────────

/** 아이디별 계정: 방송 중·방송 전·없음 */
export type FakeAccountState = 'LIVE' | 'OFFLINE' | 'MISSING'
export type FakeHandleState = 'pending' | 'open' | 'failed' | 'closed'

type Listener = (...args: unknown[]) => void

/** 방송 끝 제어 동작 (라이브러리 ControlAction.CONTROL_ACTION_STREAM_ENDED) */
const STREAM_ENDED_ACTION = 3

/** 연결 손잡이 하나 = 가짜 웹캐스트가 만든 클라이언트 하나. 시험이 이것으로 연결 시도를 끝내고 이벤트를 보낸다 */
export class FakeWebcastHandle {
  readonly uniqueId: string
  readonly options: TikTokLibraryOptions
  /** 만들어진 순서 (0부터) */
  readonly index: number
  #state: FakeHandleState = 'pending'
  #connectCalled = false
  #closedByClient = false
  #disconnectCalls = 0
  #listeners = new Map<string, Listener[]>()
  #settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void } | null = null
  readonly #owner: FakeWebcast

  constructor(owner: FakeWebcast, uniqueId: string, options: TikTokLibraryOptions, index: number) {
    this.#owner = owner
    this.uniqueId = uniqueId
    this.options = options
    this.index = index
  }

  get state(): FakeHandleState {
    return this.#state
  }
  /** connect()가 불렸나 */
  get connectCalled(): boolean {
    return this.#connectCalled
  }
  /** 클라이언트(감싸개)가 닫았나 — 연결 시도 중에 닫은 것도 포함 */
  get closedByClient(): boolean {
    return this.#closedByClient
  }
  /** 닫혔나 (클라이언트가 닫았거나 가짜가 끊었거나) */
  get closed(): boolean {
    return this.#closedByClient || this.#state === 'closed'
  }
  get disconnectCalls(): number {
    return this.#disconnectCalls
  }

  /** 경계 모양 (감싸개가 쓰는 클라이언트) */
  client(): WebcastClient {
    return {
      connect: () => this.#connect(),
      disconnect: () => this.#disconnect(),
      on: (event, listener) => {
        const list = this.#listeners.get(event) ?? []
        list.push(listener)
        this.#listeners.set(event, list)
        return undefined
      },
    }
  }

  #connect(): Promise<unknown> {
    if (this.#connectCalled) return Promise.reject(new Error('Already connecting!'))
    this.#connectCalled = true
    this.#owner.noteAttempt()
    return new Promise<unknown>((resolve, reject) => {
      this.#settle = { resolve, reject }
      const outcome = this.#owner.decide(this.uniqueId)
      if (outcome === 'HOLD') return
      if (outcome === 'SUCCEED') this.succeed()
      else this.fail(outcome)
    })
  }

  #disconnect(): void {
    this.#disconnectCalls += 1
    if (this.#state === 'open') {
      this.#closedByClient = true
      this.#close(1000)
    } else if (this.#state === 'pending' && !this.#closedByClient) {
      // 연결 시도 중에 닫음 = 그 시도를 버림. 나중에 성공해도 열리지 않는다
      this.#closedByClient = true
      this.#owner.noteClose()
    }
  }

  #close(code: number): void {
    this.#state = 'closed'
    this.#owner.noteClose()
    this.#owner.noteOpen(-1)
    queueMicrotask(() => this.emit('disconnected', { code }))
  }

  /** 붙잡은(또는 아직 끝나지 않은) 연결 시도를 성공시킨다. 감싸개가 시도 중에 닫았으면 열리지 않고 연결 약속만 이행한다 */
  succeed(): void {
    if (this.#state !== 'pending' || this.#settle === null) return
    const settle = this.#settle
    this.#settle = null
    if (this.#closedByClient) {
      this.#state = 'closed'
      settle.resolve({ isConnected: false, roomId: '7300000000000000001', roomInfo: null, availableGifts: null })
      return
    }
    // 라이브러리처럼, processInitialData가 false가 아니면 연결 약속을 이행하기 전에 최근 댓글 묶음을 내보낸다
    if (this.options.processInitialData !== false) for (const fields of this.#owner.recent) this.chat(fields)
    this.#state = 'open'
    this.#owner.noteOpen(1)
    const state = { isConnected: true, roomId: '7300000000000000001', roomInfo: { data: { status: 2 } }, availableGifts: null }
    this.emit('connected', state)
    settle.resolve(state)
  }

  /** 붙잡은 연결 시도를 실패시킨다 (라이브러리 2.1.0 모양의 오류로 거부, error 이벤트도 낸다) */
  fail(kind: TikTokFailureKind): void {
    if (this.#state !== 'pending' || this.#settle === null) return
    const settle = this.#settle
    this.#settle = null
    this.#state = 'failed'
    const error = fakeLibraryError(kind)
    this.emit('error', { info: 'Error while connecting', exception: error })
    settle.reject(error)
  }

  /** 이 손잡이로 이벤트를 보낸다 (상태와 상관없이 — 이전 연결 손잡이로 늦게 온 이벤트 흉내도 이것으로) */
  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args)
  }

  /** 라이브러리 모양의 댓글 이벤트 하나 */
  chat(fields: FakeChatFields): void {
    this.emit('chat', fakeChatEvent(fields))
  }

  /** 틱톡 쪽에서 끊김 (열린 연결이면 disconnected, 시도 중이면 NETWORK 실패) */
  drop(): void {
    if (this.#state === 'open') this.#close(1006)
    else this.fail('NETWORK')
  }

  /** 방송 끝: 라이브러리처럼 streamEnd를 내고 연결을 닫는다 */
  endStream(): void {
    this.emit('streamEnd', { action: STREAM_ENDED_ACTION })
    if (this.#state === 'open') this.#close(1000)
  }
}

/** 가짜 웹캐스트 서버. factory를 연결 객체의 webcast로 넘긴다 */
export class FakeWebcast {
  #accounts = new Map<string, FakeAccountState>()
  #failures: TikTokFailureKind[] = []
  #holding = false
  #recent: FakeChatFields[] = []
  #handles: FakeWebcastHandle[] = []
  #attempts = 0
  #open = 0
  #maxOpen = 0
  #closes = 0

  /** 연결 객체에 넘기는 클라이언트 만드는 곳 */
  readonly factory: WebcastFactory = (uniqueId, options) => {
    const handle = new FakeWebcastHandle(this, uniqueId, options, this.#handles.length)
    this.#handles.push(handle)
    return handle.client()
  }

  /** 아이디별 계정 상태 (없는 아이디는 MISSING) */
  account(uniqueId: string, state: FakeAccountState): this {
    this.#accounts.set(uniqueId, state)
    return this
  }

  /** 다음 연결 시도 times번을 이 종류로 실패시킨다 */
  failNext(kind: TikTokFailureKind, times = 1): this {
    for (let i = 0; i < times; i += 1) this.#failures.push(kind)
    return this
  }

  /** 켜면 새 연결 시도에 답하지 않는다 — 손잡이의 succeed()·fail()로 나중에 끝낸다 */
  hold(on = true): this {
    this.#holding = on
    return this
  }

  /** 연결 때 최근 댓글 묶음 (processInitialData가 false가 아닌 연결에만 내보낸다 — 라이브러리와 같다) */
  recentComments(list: readonly FakeChatFields[]): this {
    this.#recent = [...list]
    return this
  }

  get recent(): readonly FakeChatFields[] {
    return this.#recent
  }

  /** @internal 손잡이가 연결 시도 결과를 묻는다 */
  decide(uniqueId: string): 'HOLD' | 'SUCCEED' | TikTokFailureKind {
    const injected = this.#failures.shift()
    if (injected !== undefined) return injected
    if (this.#holding) return 'HOLD'
    const state = this.#accounts.get(uniqueId) ?? 'MISSING'
    if (state === 'MISSING') return 'USER_NOT_FOUND'
    if (state === 'OFFLINE') return 'NOT_LIVE'
    return 'SUCCEED'
  }

  /** @internal */
  noteAttempt(): void {
    this.#attempts += 1
  }
  /** @internal */
  noteOpen(delta: number): void {
    this.#open += delta
    this.#maxOpen = Math.max(this.#maxOpen, this.#open)
  }
  /** @internal */
  noteClose(): void {
    this.#closes += 1
  }

  /** 연결 시도 수 (connect() 부른 수) */
  get attempts(): number {
    return this.#attempts
  }
  /** 만든 클라이언트 수 */
  get created(): number {
    return this.#handles.length
  }
  /** 지금 열린 연결 수 */
  get openCount(): number {
    return this.#open
  }
  /** 동시에 열린 연결 수의 최댓값 */
  get maxOpen(): number {
    return this.#maxOpen
  }
  /** 닫힘 수 (열린 연결 닫힘 + 시도 중에 닫힘) */
  get closes(): number {
    return this.#closes
  }
  get handles(): readonly FakeWebcastHandle[] {
    return [...this.#handles]
  }
  /** 마지막으로 만든 손잡이 */
  get last(): FakeWebcastHandle | undefined {
    return this.#handles.at(-1)
  }
  /** 열린 손잡이들 (아이디를 주면 그 방송만) */
  openHandles(uniqueId?: string): FakeWebcastHandle[] {
    return this.#handles.filter((h) => h.state === 'open' && (uniqueId === undefined || h.uniqueId === uniqueId))
  }
  /** 그 방송에 열린 모든 연결로 같은 댓글을 보낸다 (판매자 둘이 같은 방송에 붙은 경우) */
  broadcast(uniqueId: string, fields: FakeChatFields): void {
    for (const handle of this.openHandles(uniqueId)) handle.chat(fields)
  }
}
