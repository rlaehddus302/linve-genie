// 가짜 네이티브 (SMS3) — 시험·에뮬레이터 리허설용. 실제 네이티브(Kotlin·Swift)와 같은 순서로 돈다:
//   허용한 앱인가(아니면 내용을 열지 않음) → 켜져 있나 → 꺼내기(extract.ts) → 거르기(rules.ts) → 두 번 막기(localId) → 대기열 → 보내기(contract.ts)
// 대기열·본 열쇠·설정은 "디스크"(persisted) 칸에 두어 reboot()로 재부팅 뒤 이어받기를 흉내 낸다. 암호화는 흉내 내지 않는다.
// 앱은 명시적으로 넣을 때만 쓴다(Expo Go·모듈 없음에서 가짜 성공으로 바꾸지 않는다).
import { classifyIntakeResponse, ENVELOPE_FIELDS, type NoticeEnvelope } from './contract.ts'
import { extractNotice, shortcutCandidate, type NoticeCandidate, type RawNotice } from './extract.ts'
import { SMS_PACKAGES } from './packages.ts'
import { DEFAULT_FILTER_RULES, matchFilterRule, parseFilterRules, type NoticeFilterRule } from './rules.ts'
import type { NativeEventSubscription, NativeNoticeModuleLike, NativeNoticeState, NoticeAccess, NoticeSendError, NoticeSettingsTarget } from './types.ts'

/** 보내기 한 번 (가짜 HTTP) */
export interface FakeNoticeRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}
/** 서버 답 상태 번호, 연결 실패는 null */
export type FakeNoticeSend = (request: FakeNoticeRequest) => Promise<number | null>

export interface FakeNoticeOptions {
  readonly platform?: 'android' | 'ios' | 'fake'
  readonly now?: () => number
  /** 기본: 받은 것을 sentRequests에 담고 202 */
  readonly send?: FakeNoticeSend
  /** 처음부터 알림 읽기 허용 (기본 true) */
  readonly accessGranted?: boolean
  /** 대기열 최대 (기본 5,000) */
  readonly queueMax?: number
  /** 본 열쇠 기억 수 (기본 5,000) */
  readonly seenMax?: number
}

/** 대기열 한 건 (네이티브는 암호화해 둔다). 기기 번호·sentAtMs는 보낼 때 붙인다 */
interface QueueItem {
  readonly candidate: NoticeCandidate
}

/** 재부팅에도 남는 것 */
interface Persisted {
  enabled: boolean
  enabledAtMs: number
  bankPackages: string[]
  token: { token: string; endpoint: string; deviceId: string } | null
  tokenRejected: boolean
  rules: NoticeFilterRule[] | null
  queue: QueueItem[]
  seen: string[]
  counters: { sent: number; filtered: number; duplicates: number; rejected: number; dropped: number }
  lastQueuedAtMs: number | null
  lastSentAtMs: number | null
  lastError: NoticeSendError | null
}

export interface FakeNoticeNative extends NativeNoticeModuleLike {
  /** 알림이 왔다 (안드로이드 onNotificationPosted). 내용을 열었으면 true, 허용 밖·꺼짐이면 false */
  post(raw: RawNotice): Promise<boolean>
  /** 아이폰 단축어 "라이브지니에 넣기" */
  runShortcut(input: { sender: string; body: string; kind: 'sms' | 'bank' }): Promise<'sent' | 'queued' | 'filtered' | 'duplicate' | 'off' | 'noToken' | 'empty'>
  /** 재부팅: 메모리를 비우고 디스크만 남긴다. connected는 connect() 전까지 false */
  reboot(): void
  /** 시스템이 알림 읽기 서비스를 붙였다 — 떠 있는 알림(activeNotifications)을 다시 훑는다 */
  connect(active?: readonly RawNotice[]): Promise<void>
  setAccess(granted: boolean): void
  setBatteryOptimized(value: boolean | null): void
  /** 허용 밖이라 내용을 열지 않고 버린 건수 */
  readonly unopened: number
  readonly sentRequests: readonly FakeNoticeRequest[]
  readonly sentEnvelopes: readonly NoticeEnvelope[]
  readonly openedSettings: readonly NoticeSettingsTarget[]
  /** 디스크에 남은 대기열 (시험 확인용) */
  readonly queued: readonly NoticeCandidate[]
  readonly listenerCount: number
}

export function createFakeNoticeNative(options: FakeNoticeOptions = {}): FakeNoticeNative {
  const platform = options.platform ?? 'fake'
  const now = options.now ?? (() => 0)
  const queueMax = options.queueMax ?? 5_000
  const seenMax = options.seenMax ?? 5_000
  const sentRequests: FakeNoticeRequest[] = []
  const sentEnvelopes: NoticeEnvelope[] = []
  const openedSettings: NoticeSettingsTarget[] = []
  const send: FakeNoticeSend = options.send ?? (async () => 202)

  const disk: Persisted = {
    enabled: false,
    enabledAtMs: 0,
    bankPackages: [],
    token: null,
    tokenRejected: false,
    rules: null,
    queue: [],
    seen: [],
    counters: { sent: 0, filtered: 0, duplicates: 0, rejected: 0, dropped: 0 },
    lastQueuedAtMs: null,
    lastSentAtMs: null,
    lastError: null,
  }
  let access = options.accessGranted ?? true
  let connected = access && platform !== 'ios'
  let batteryOptimized: boolean | null = platform === 'ios' ? null : false
  let unopened = 0
  let draining: Promise<{ sent: number; stoppedBy: 'NO_TOKEN' | NoticeSendError | null }> | null = null
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
    bankPackages: [...disk.bankPackages],
    batteryOptimized,
    serverRules: disk.rules !== null,
  })
  const emit = (): void => {
    const snapshot = state()
    for (const listener of [...listeners]) listener(snapshot)
  }

  const isAllowed = (packageName: string): boolean =>
    (SMS_PACKAGES as readonly string[]).includes(packageName) || disk.bankPackages.includes(packageName)

  /** 거르기·두 번 막기·대기열 넣기. 넣었으면 'queued' */
  const accept = (candidate: NoticeCandidate): 'queued' | 'filtered' | 'duplicate' | 'dropped' => {
    if (matchFilterRule(disk.rules ?? DEFAULT_FILTER_RULES, candidate) !== null) {
      disk.counters.filtered++
      return 'filtered'
    }
    if (disk.seen.includes(candidate.localId) || disk.queue.some((item) => item.candidate.localId === candidate.localId)) {
      disk.counters.duplicates++
      return 'duplicate'
    }
    if (disk.queue.length >= queueMax) {
      disk.counters.dropped++
      return 'dropped'
    }
    disk.queue.push({ candidate })
    disk.seen.push(candidate.localId)
    if (disk.seen.length > seenMax) disk.seen.splice(0, disk.seen.length - seenMax)
    disk.lastQueuedAtMs = now()
    return 'queued'
  }

  const envelopeOf = (item: QueueItem, deviceId: string): NoticeEnvelope => {
    const c = item.candidate
    const envelope: NoticeEnvelope = {
      kindHint: c.kindHint,
      sourceType: c.sourceType,
      source: c.source,
      body: c.body,
      receivedAtMs: c.receivedAtMs,
      sentAtMs: now(),
      deviceId,
      localId: c.localId,
    }
    // 칸 순서도 약속 순서 그대로
    return Object.fromEntries(ENVELOPE_FIELDS.map((field) => [field, envelope[field]])) as unknown as NoticeEnvelope
  }

  const drainOnce = async (): Promise<{ sent: number; stoppedBy: 'NO_TOKEN' | NoticeSendError | null }> => {
    let sent = 0
    const token = disk.token
    if (token === null) return { sent, stoppedBy: 'NO_TOKEN' }
    if (disk.tokenRejected) return { sent, stoppedBy: 'TOKEN' }
    const ordered = [...disk.queue].sort((a, b) => a.candidate.receivedAtMs - b.candidate.receivedAtMs)
    for (const item of ordered) {
      const envelope = envelopeOf(item, token.deviceId)
      const request: FakeNoticeRequest = {
        url: token.endpoint,
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      }
      let status: number | null
      try {
        status = await send(request)
      } catch {
        status = null
      }
      const action = classifyIntakeResponse(status)
      if (action === 'retry') {
        disk.lastError = status === null ? 'NETWORK' : 'SERVER'
        return { sent, stoppedBy: disk.lastError }
      }
      if (action === 'token') {
        disk.tokenRejected = true
        disk.lastError = 'TOKEN'
        return { sent, stoppedBy: 'TOKEN' }
      }
      disk.queue = disk.queue.filter((q) => q.candidate.localId !== item.candidate.localId)
      if (action === 'rejected') {
        disk.counters.rejected++
      } else {
        sentRequests.push(request)
        sentEnvelopes.push(envelope)
        if (action === 'accepted') {
          disk.counters.sent++
          sent++
        }
        disk.lastSentAtMs = now()
      }
      disk.lastError = null
    }
    return { sent, stoppedBy: null }
  }

  const drain = async (): Promise<{ sent: number; stoppedBy: 'NO_TOKEN' | NoticeSendError | null }> => {
    while (draining !== null) await draining
    draining = drainOnce()
    try {
      return await draining
    } finally {
      draining = null
      emit()
    }
  }

  const receive = async (raw: RawNotice): Promise<boolean> => {
    // 허용 밖 앱은 패키지 이름만 보고 버린다 — 제목·본문을 읽지 않는다
    if (!isAllowed(raw.packageName)) {
      unopened++
      return false
    }
    if (!disk.enabled || !access) return false
    const result = extractNotice(raw, disk.enabledAtMs)
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
    async setAllowedPackages(packages) {
      disk.bankPackages = [...packages]
      emit()
      return state()
    },
    async setToken(token, endpoint, deviceId) {
      disk.token = { token, endpoint, deviceId }
      disk.tokenRejected = false
      if (disk.lastError === 'TOKEN') disk.lastError = null
      emit()
      void drain()
      return state()
    },
    async clearToken() {
      disk.token = null
      emit()
      return state()
    },
    async setFilterRules(rulesJson) {
      if (rulesJson === '') disk.rules = null
      else {
        let parsed: unknown
        try {
          parsed = JSON.parse(rulesJson)
        } catch {
          parsed = null
        }
        // 네이티브도 틀린 글이면 기본 규칙으로 돌아간다
        disk.rules = parseFilterRules(parsed)
      }
      emit()
      return state()
    },
    async flush() {
      const result = await drain()
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
      if (outcome === 'filtered' || outcome === 'duplicate') return outcome
      if (outcome === 'dropped') return 'queued'
      const result = await drain()
      return result.stoppedBy === null ? 'sent' : 'queued'
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
    get unopened() {
      return unopened
    },
    sentRequests,
    sentEnvelopes,
    openedSettings,
    get queued() {
      return disk.queue.map((item) => item.candidate)
    },
    get listenerCount() {
      return listeners.size
    },
  }
  return fake
}
