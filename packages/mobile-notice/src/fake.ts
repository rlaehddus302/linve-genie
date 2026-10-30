// 가짜 네이티브 (SMS3) — 시험·에뮬레이터 리허설용. 실제 네이티브(Kotlin·Swift)와 같은 순서로 돈다:
//   읽을 앱인가(패키지 이름만 — 기본 문자 앱·filters.bankApps, 아니면 내용을 열지 않음) → 켜져 있나 → 꺼내기(extract.ts)
//   → 거르기(문자의 skipWords — rules.ts) → 두 번 막기(id) → 대기열(최대 200, 넘으면 오래된 것부터 버림) → 보내기(contract.ts, 20건씩)
// 대기열·본 id·설정·filters는 "디스크"(persisted) 칸에 두어 reboot()로 재부팅·앱 다시 켜기 뒤 이어받기를 흉내 낸다. 암호화는 흉내 내지 않는다.
// 앱은 명시적으로 넣을 때만 쓴다(Expo Go·모듈 없음에서 가짜 성공으로 바꾸지 않는다).
import {
  INBOX_BATCH_MAX,
  NOTICE_QUEUE_MAX,
  TOO_MANY_WAIT_MS,
  classifyIntakeResponse,
  inboxRequestJson,
  parseInboxResponse,
  type InboxRequest,
  type InboxResultStatus,
} from './contract.ts'
import { extractNotice, shortcutCandidate, type NoticeCandidate, type RawNotice } from './extract.ts'
import { channelForPackage } from './packages.ts'
import { DEFAULT_SKIP_WORDS, skipWordIn, type NoticeFilters } from './rules.ts'
import type { NativeEventSubscription, NativeNoticeModuleLike, NativeNoticeState, NoticeAccess, NoticeSendError, NoticeSettingsTarget } from './types.ts'

/** 보내기 한 번 (가짜 HTTP) */
export interface FakeNoticeRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}
/** 서버 답. 연결 실패는 null */
export type FakeNoticeReply = { readonly status: number; readonly body?: string } | number | null
export type FakeNoticeSend = (request: FakeNoticeRequest) => Promise<FakeNoticeReply>

/** 가짜 서버가 기본으로 주는 filters */
export const FAKE_SERVER_FILTERS: NoticeFilters = Object.freeze({
  skipWords: DEFAULT_SKIP_WORDS,
  bankApps: Object.freeze(['com.kakaobank.channel', 'com.kbstar.kbbank', 'viva.republica.toss']),
})

/** 가짜 서버: 받은 요청의 모든 id를 status로 답하고 filters를 붙인다 */
export function fakeServerReply(requestBody: string, filters: NoticeFilters = FAKE_SERVER_FILTERS, status: (id: string) => InboxResultStatus = () => 'SAVED'): { status: number; body: string } {
  const request = JSON.parse(requestBody) as InboxRequest
  return {
    status: 200,
    body: JSON.stringify({ results: request.messages.map((m) => ({ id: m.id, status: status(m.id) })), filters: { skipWords: [...filters.skipWords], bankApps: [...filters.bankApps] } }),
  }
}

export interface FakeNoticeOptions {
  readonly platform?: 'android' | 'ios' | 'fake'
  readonly now?: () => number
  /** 기본: fakeServerReply(FAKE_SERVER_FILTERS, 모두 SAVED) */
  readonly send?: FakeNoticeSend
  /** 처음부터 알림 읽기 허용 (기본 true) */
  readonly accessGranted?: boolean
  /** 안드로이드 기본 문자 앱 (기본 삼성 메시지, null이면 모름 → SMS_PACKAGES) */
  readonly defaultSmsPackage?: string | null
  /** 대기열 최대 (기본 200) */
  readonly queueMax?: number
  /** 본 id 기억 수 (기본 5,000) */
  readonly seenMax?: number
}

type DrainStop = 'NO_TOKEN' | NoticeSendError | null

/** 재부팅에도 남는 것 */
interface Persisted {
  enabled: boolean
  enabledAtMs: number
  token: { token: string; endpoint: string; deviceName: string } | null
  tokenRejected: boolean
  filters: NoticeFilters | null
  queue: NoticeCandidate[]
  seen: string[]
  counters: { sent: number; ignored: number; filtered: number; duplicates: number; rejected: number; dropped: number }
  lastQueuedAtMs: number | null
  lastSentAtMs: number | null
  lastError: NoticeSendError | null
  /** 429 뒤 이 시각 전에는 보내지 않는다 */
  notBeforeMs: number
}

export interface FakeNoticeNative extends NativeNoticeModuleLike {
  /** 알림이 왔다 (안드로이드 onNotificationPosted). 내용을 열었으면 true, 읽을 앱이 아님·꺼짐이면 false */
  post(raw: RawNotice): Promise<boolean>
  /** 아이폰 단축어 "라이브지니에 문자 보내기" */
  runShortcut(input: { sender: string; body: string }): Promise<'sent' | 'queued' | 'filtered' | 'duplicate' | 'dropped' | 'off' | 'noToken' | 'empty'>
  /** 재부팅·앱 다시 켜기: 메모리를 비우고 디스크만 남긴다. connected는 connect() 전까지 false */
  reboot(): void
  /** 시스템이 알림 읽기 서비스를 붙였다 — 떠 있는 알림(activeNotifications)을 다시 훑는다 */
  connect(active?: readonly RawNotice[]): Promise<void>
  setAccess(granted: boolean): void
  setBatteryOptimized(value: boolean | null): void
  setDefaultSmsPackage(value: string | null): void
  /** 읽을 앱이 아니라 내용을 열지 않고 버린 건수 */
  readonly unopened: number
  readonly sentRequests: readonly FakeNoticeRequest[]
  /** 보낸 요청 본문(읽은 것) — 0건 요청 포함 */
  readonly sentBodies: readonly InboxRequest[]
  readonly openedSettings: readonly NoticeSettingsTarget[]
  /** 디스크에 남은 대기열 (보낼 차례대로) */
  readonly queued: readonly NoticeCandidate[]
  readonly listenerCount: number
}

/** 보낼 차례: 받은 시각, 같으면 id (안드로이드 파일 이름 순서와 같다) */
const byOrder = (a: NoticeCandidate, b: NoticeCandidate): number => a.receivedAt - b.receivedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function createFakeNoticeNative(options: FakeNoticeOptions = {}): FakeNoticeNative {
  const platform = options.platform ?? 'fake'
  const now = options.now ?? (() => 0)
  const queueMax = options.queueMax ?? NOTICE_QUEUE_MAX
  const seenMax = options.seenMax ?? 5_000
  const sentRequests: FakeNoticeRequest[] = []
  const sentBodies: InboxRequest[] = []
  const openedSettings: NoticeSettingsTarget[] = []
  const send: FakeNoticeSend = options.send ?? (async (request) => fakeServerReply(request.body))
  let defaultSmsPackage = options.defaultSmsPackage === undefined ? 'com.samsung.android.messaging' : options.defaultSmsPackage

  const disk: Persisted = {
    enabled: false,
    enabledAtMs: 0,
    token: null,
    tokenRejected: false,
    filters: null,
    queue: [],
    seen: [],
    counters: { sent: 0, ignored: 0, filtered: 0, duplicates: 0, rejected: 0, dropped: 0 },
    lastQueuedAtMs: null,
    lastSentAtMs: null,
    lastError: null,
    notBeforeMs: 0,
  }
  let access = options.accessGranted ?? true
  let connected = access && platform !== 'ios'
  let batteryOptimized: boolean | null = platform === 'ios' ? null : false
  let unopened = 0
  let draining: Promise<{ sent: number; stoppedBy: DrainStop }> | null = null
  const listeners = new Set<(event: NativeNoticeState) => void>()

  const accessValue = (): NoticeAccess => (platform === 'ios' ? 'shortcut' : access ? 'granted' : 'needed')
  const state = (): NativeNoticeState => ({
    platform,
    enabled: disk.enabled,
    access: accessValue(),
    connected: platform !== 'ios' && connected,
    hasToken: disk.token !== null,
    tokenRejected: disk.tokenRejected,
    pending: disk.queue.length,
    ...disk.counters,
    lastQueuedAtMs: disk.lastQueuedAtMs,
    lastSentAtMs: disk.lastSentAtMs,
    lastError: disk.lastError,
    bankApps: platform === 'ios' ? [] : [...(disk.filters?.bankApps ?? [])],
    smsApp: platform === 'ios' ? null : defaultSmsPackage,
    batteryOptimized,
    hasFilters: disk.filters !== null,
  })
  const emit = (): void => {
    const snapshot = state()
    for (const listener of [...listeners]) listener(snapshot)
  }

  /** 거르기·두 번 막기·대기열 넣기 */
  const accept = (candidate: NoticeCandidate): 'queued' | 'filtered' | 'duplicate' | 'dropped' => {
    if (candidate.channel === 'SMS' && skipWordIn(candidate.text, disk.filters) !== null) {
      disk.counters.filtered++
      return 'filtered'
    }
    if (disk.seen.includes(candidate.id) || disk.queue.some((item) => item.id === candidate.id)) {
      disk.counters.duplicates++
      return 'duplicate'
    }
    disk.queue.push(candidate)
    disk.queue.sort(byOrder)
    disk.seen.push(candidate.id)
    if (disk.seen.length > seenMax) disk.seen.splice(0, disk.seen.length - seenMax)
    disk.lastQueuedAtMs = now()
    let outcome: 'queued' | 'dropped' = 'queued'
    while (disk.queue.length > queueMax) {
      const oldest = disk.queue.shift()
      disk.counters.dropped++
      if (oldest?.id === candidate.id) outcome = 'dropped'
    }
    return outcome
  }

  const post = async (messages: readonly NoticeCandidate[]): Promise<{ status: number | null; body: string }> => {
    const token = disk.token
    if (token === null) return { status: null, body: '' }
    const body = inboxRequestJson(token.deviceName, messages)
    const request: FakeNoticeRequest = { url: token.endpoint, headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' }, body }
    sentRequests.push(request)
    sentBodies.push(JSON.parse(body) as InboxRequest)
    let reply: FakeNoticeReply
    try {
      reply = await send(request)
    } catch {
      reply = null
    }
    if (reply === null) return { status: null, body: '' }
    if (typeof reply === 'number') return { status: reply, body: '' }
    return { status: reply.status, body: reply.body ?? '' }
  }

  const drainOnce = async (fetchFilters: boolean): Promise<{ sent: number; stoppedBy: DrainStop }> => {
    let sent = 0
    if (disk.token === null) return { sent, stoppedBy: 'NO_TOKEN' }
    if (disk.tokenRejected) return { sent, stoppedBy: 'TOKEN' }
    if (now() < disk.notBeforeMs) return { sent, stoppedBy: 'BUSY' }
    let single = false
    let askedFilters = false
    for (;;) {
      const batch = disk.queue.slice(0, single ? 1 : INBOX_BATCH_MAX)
      if (batch.length === 0) {
        if (askedFilters || !(fetchFilters || disk.filters === null)) break
        askedFilters = true
      }
      const reply = await post(batch)
      const action = classifyIntakeResponse(reply.status)
      if (action === 'retry') {
        disk.lastError = reply.status === null ? 'NETWORK' : 'SERVER'
        return { sent, stoppedBy: disk.lastError }
      }
      if (action === 'wait') {
        disk.notBeforeMs = now() + TOO_MANY_WAIT_MS
        disk.lastError = 'BUSY'
        return { sent, stoppedBy: 'BUSY' }
      }
      if (action === 'token') {
        disk.tokenRejected = true
        disk.lastError = 'TOKEN'
        return { sent, stoppedBy: 'TOKEN' }
      }
      if (action === 'bad') {
        if (batch.length > 1) {
          single = true
          continue
        }
        if (batch.length === 1) {
          disk.queue = disk.queue.filter((q) => q.id !== batch[0]?.id)
          disk.counters.rejected++
        }
        continue
      }
      const response = parseInboxResponse(reply.body)
      if (response.filters !== null) disk.filters = response.filters
      const ids = new Set(batch.map((m) => m.id))
      disk.queue = disk.queue.filter((q) => !ids.has(q.id))
      for (const m of batch) {
        const status = response.results.get(m.id) ?? 'SAVED'
        if (status === 'DUPLICATE') disk.counters.duplicates++
        else if (status === 'IGNORED') disk.counters.ignored++
        else {
          disk.counters.sent++
          sent++
        }
      }
      if (batch.length > 0) disk.lastSentAtMs = now()
      disk.lastError = null
    }
    disk.lastError = null
    return { sent, stoppedBy: null }
  }

  const drain = async (fetchFilters = false): Promise<{ sent: number; stoppedBy: DrainStop }> => {
    while (draining !== null) await draining
    draining = drainOnce(fetchFilters)
    try {
      return await draining
    } finally {
      draining = null
      emit()
    }
  }

  const receive = async (raw: RawNotice): Promise<boolean> => {
    // 읽을 앱이 아니면 패키지 이름만 보고 버린다 — 제목·본문을 읽지 않는다
    const channel = platform === 'ios' ? null : channelForPackage(raw.packageName, defaultSmsPackage, disk.filters)
    if (channel === null) {
      unopened++
      return false
    }
    if (!disk.enabled || !access) return false
    const result = extractNotice(raw, channel, disk.enabledAtMs)
    let queued = 0
    for (const candidate of result.candidates) if (accept(candidate) === 'queued') queued++
    emit()
    if (queued > 0) await drain()
    return true
  }

  const fake: FakeNoticeNative = {
    async start() {
      if (!disk.enabled) {
        disk.enabled = true
        disk.enabledAtMs = now()
      }
      emit()
      await drain(true)
      return state()
    },
    async stop() {
      disk.enabled = false
      emit()
      return state()
    },
    async getState() {
      return state()
    },
    async openSettings(target) {
      openedSettings.push(target)
      if (platform === 'ios') return target === 'app' || target === 'shortcuts'
      return target !== 'shortcuts'
    },
    async setToken(token, endpoint, deviceName) {
      disk.token = { token, endpoint, deviceName }
      disk.tokenRejected = false
      disk.notBeforeMs = 0
      if (disk.lastError === 'TOKEN') disk.lastError = null
      emit()
      await drain(true)
      return state()
    },
    async clearToken() {
      disk.token = null
      emit()
      return state()
    },
    async flush() {
      const result = await drain(true)
      return { sent: result.sent, pending: disk.queue.length, stoppedBy: result.stoppedBy }
    },
    addListener(_eventName: 'state', listener: (event: NativeNoticeState) => void): NativeEventSubscription {
      listeners.add(listener)
      return {
        remove() {
          listeners.delete(listener)
        },
      }
    },
    post: receive,
    async runShortcut(input) {
      if (!disk.enabled) return 'off'
      if (disk.token === null) return 'noToken'
      const candidate = shortcutCandidate(input, now())
      if (candidate === null) return 'empty'
      const outcome = accept(candidate)
      emit()
      if (outcome !== 'queued') return outcome
      await drain()
      return disk.queue.some((q) => q.id === candidate.id) ? 'queued' : 'sent'
    },
    reboot() {
      connected = false
      unopened = 0
      listeners.clear()
    },
    async connect(active = []) {
      connected = access
      emit()
      for (const raw of active) await receive(raw)
      if (disk.queue.length > 0) await drain()
    },
    setAccess(granted) {
      access = granted
      connected = granted && platform !== 'ios'
      emit()
    },
    setBatteryOptimized(value) {
      batteryOptimized = value
      emit()
    },
    setDefaultSmsPackage(value) {
      defaultSmsPackage = value
      emit()
    },
    get unopened() {
      return unopened
    },
    sentRequests,
    sentBodies,
    openedSettings,
    get queued() {
      return [...disk.queue]
    },
    get listenerCount() {
      return listeners.size
    },
  }
  return fake
}
