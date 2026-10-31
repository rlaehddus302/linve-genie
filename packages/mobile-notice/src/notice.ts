// 문자찜·입금 알림 받기 — 네이티브 모듈 위의 얇은 JS (SMS3). 네이티브는 넣어 받는다(시험·에뮬레이터는 가짜).
// 입력은 여기서 먼저 검사해 틀린 값이 네이티브에 가지 않게 한다: 받기 토큰·기기 이름·서버 주소(https).
// 네이티브가 넘기는 상태는 모르는 칸·틀린 값을 안전한 쪽(꺼짐·0건·모름)으로 고쳐 앱에 준다.
import { DEVICE_TOKEN_PATTERN, cleanDeviceName, noticeIntakeUrl } from './contract.ts'
import type {
  NativeNoticeModuleLike,
  NativeNoticeState,
  NativeSmsState,
  NoticeAccess,
  NoticeFlushResult,
  NoticeIntake,
  NoticePlatform,
  NoticeSendError,
  NoticeSettingsTarget,
  NoticeState,
  NoticeStateListener,
  NoticeTokenConfig,
  SmsLink,
  SmsLinkState,
} from './types.ts'

/** 잘못된 입력 (화면 문장은 message) */
export class NoticeInputError extends Error {
  readonly code: 'TOKEN' | 'SERVER_URL' | 'DEVICE_NAME'
  constructor(code: NoticeInputError['code'], message: string) {
    super(message)
    this.name = 'NoticeInputError'
    this.code = code
  }
}

const PLATFORMS: readonly NoticePlatform[] = ['android', 'ios', 'fake']
const ACCESS: readonly NoticeAccess[] = ['granted', 'needed', 'shortcut']
const SEND_ERRORS: readonly NoticeSendError[] = ['NETWORK', 'SERVER', 'BUSY', 'TOKEN', 'OFF']
const SETTINGS: readonly NoticeSettingsTarget[] = ['notificationAccess', 'battery', 'app', 'shortcuts']

const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0)
const timeOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null)
const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => list.find((item) => item === value) ?? fallback

/** 네이티브 상태 → 앱 상태 (모르는 값은 안전한 쪽) */
export function normalizeNoticeState(raw: NativeNoticeState | null | undefined): NoticeState {
  const r = raw ?? {}
  const platform = pick(PLATFORMS, r.platform, 'fake')
  const bankApps = Array.isArray(r.bankApps) ? r.bankApps.filter((p): p is string => typeof p === 'string') : []
  return {
    platform,
    enabled: r.enabled === true,
    access: pick(ACCESS, r.access, platform === 'ios' ? 'shortcut' : 'needed'),
    connected: r.connected === true,
    hasToken: r.hasToken === true,
    tokenRejected: r.tokenRejected === true,
    inboxOff: r.inboxOff === true,
    pending: count(r.pending),
    sent: count(r.sent),
    ignored: count(r.ignored),
    filtered: count(r.filtered),
    duplicates: count(r.duplicates),
    rejected: count(r.rejected),
    dropped: count(r.dropped),
    lastQueuedAtMs: timeOrNull(r.lastQueuedAtMs),
    lastSentAtMs: timeOrNull(r.lastSentAtMs),
    lastError: SEND_ERRORS.find((e) => e === r.lastError) ?? null,
    bankApps,
    smsApp: typeof r.smsApp === 'string' && r.smsApp !== '' ? r.smsApp : null,
    batteryOptimized: typeof r.batteryOptimized === 'boolean' ? r.batteryOptimized : null,
    hasFilters: r.hasFilters === true,
  }
}

/** 네이티브 문자 상태 → 앱 상태 (모르는 값은 꺼짐·권한 없음) */
export function normalizeSmsState(raw: NativeSmsState | null | undefined): SmsLinkState {
  const r = raw ?? {}
  const available = r.available === true
  const permission = r.permission === 'granted' ? 'granted' : 'needed'
  const enabled = available && r.enabled === true
  return { available, permission, enabled, active: enabled && permission === 'granted' && r.active === true, lastScanAtMs: timeOrNull(r.lastScanAtMs) }
}

/** 네이티브에 문자 직접 받기 함수가 다 있으면 문자 연동, 아니면 null */
export function createSmsLink(native: NativeNoticeModuleLike): SmsLink | null {
  const { getSmsState, requestSmsPermission, setSmsEnabled } = native
  if (typeof getSmsState !== 'function' || typeof requestSmsPermission !== 'function' || typeof setSmsEnabled !== 'function') return null
  return {
    async getState() {
      return normalizeSmsState(await getSmsState.call(native))
    },
    async requestPermission() {
      try {
        return normalizeSmsState(await requestSmsPermission.call(native))
      } catch {
        return normalizeSmsState(await getSmsState.call(native))
      }
    },
    async setEnabled(on: boolean) {
      return normalizeSmsState(await setSmsEnabled.call(native, on))
    },
  }
}

export function normalizeFlushResult(raw: { readonly sent?: unknown; readonly pending?: unknown; readonly stoppedBy?: unknown } | null | undefined): NoticeFlushResult {
  const stoppedBy = raw?.stoppedBy
  return {
    sent: count(raw?.sent),
    pending: count(raw?.pending),
    stoppedBy: stoppedBy === 'NO_TOKEN' ? 'NO_TOKEN' : (SEND_ERRORS.find((e) => e === stoppedBy) ?? null),
  }
}

/** 네이티브 모듈 → 앱이 쓰는 문자찜·입금 알림 받기 */
export function createNoticeIntake(native: NativeNoticeModuleLike): NoticeIntake {
  const listeners = new Set<NoticeStateListener>()
  let subscription: { remove(): void } | null = null

  const ensureSubscribed = (): void => {
    if (subscription !== null) return
    subscription = native.addListener('state', (event) => {
      const state = normalizeNoticeState(event)
      for (const listener of [...listeners]) listener(state)
    })
  }

  return {
    async start() {
      return normalizeNoticeState(await native.start())
    },
    async stop() {
      return normalizeNoticeState(await native.stop())
    },
    async getState() {
      return normalizeNoticeState(await native.getState())
    },
    addStateListener(listener) {
      listeners.add(listener)
      ensureSubscribed()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && subscription !== null) {
          subscription.remove()
          subscription = null
        }
      }
    },
    async openSettings(target = 'notificationAccess') {
      if (!SETTINGS.includes(target)) return false
      try {
        return (await native.openSettings(target)) === true
      } catch {
        return false
      }
    },
    async setToken(config: NoticeTokenConfig | null) {
      if (config === null) return normalizeNoticeState(await native.clearToken())
      const token = typeof config.token === 'string' ? config.token.trim() : ''
      if (!DEVICE_TOKEN_PATTERN.test(token)) throw new NoticeInputError('TOKEN', '받기 열쇠가 맞지 않아요. 설정에서 복사한 받기 열쇠를 그대로 넣어 주세요.')
      const deviceName = cleanDeviceName(config.deviceName)
      if (deviceName === null) throw new NoticeInputError('DEVICE_NAME', '휴대폰 이름은 1~30자로 넣어 주세요.')
      const endpoint = typeof config.serverUrl === 'string' ? noticeIntakeUrl(config.serverUrl) : null
      if (endpoint === null) throw new NoticeInputError('SERVER_URL', '서버 주소가 안전하지 않아요(https만 써요).')
      return normalizeNoticeState(await native.setToken(token, endpoint, deviceName))
    },
    async flush() {
      return normalizeFlushResult(await native.flush())
    },
    sms: createSmsLink(native),
  }
}
