// 이 기기의 값 (I1, L-11 10, D-I1-06).
// - 기기 ID(출력 기기를 가리는 무작위 값)는 **탭마다** 하나다(sessionStorage — 새로고침해도 같다). 프린터 연결은 탭 안에 있으므로
//   같은 PC의 다른 탭이 출력 기기 행세를 하거나(프린터가 없는데 끊김을 알림) 출력 중인 장을 끊김으로 되돌리지 않게 한다.
//   탭 복제로 같은 ID가 둘이 되면 나중 탭이 새 ID를 쓴다(Web Locks — 지원할 때).
// - 기기 이름·인쇄 농도·연결 방법은 그 기기(브라우저)에 남는다(localStorage).
// - 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등)는 이 페이지 동안만 기억한다.
import { WIDE_QUERY } from './use-wide.ts'

const DEVICE_ID_KEY = 'livejjim.deviceId'
const DEVICE_NAME_KEY = 'livejjim.deviceName'
const DENSITY_KEY = 'livejjim.printDensity'
const ATTEMPT_KEY = 'livejjim.printAttempt'

/** 서버 기기 ID 형식 (영문·숫자·'_'·'-' 8~64자) */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
/** 인쇄 농도 (B1 1~5, 기본 3 — L-7) */
export const DENSITY_MIN = 1
export const DENSITY_MAX = 5
export const DENSITY_DEFAULT = 3
/** 기기 이름 (다듬은 뒤 1~20자 — L-11 10) */
export const DEVICE_NAME_MAX = 20

type Area = 'local' | 'session'
const memory = new Map<string, string>()

function storage(area: Area): Storage {
  return area === 'local' ? window.localStorage : window.sessionStorage
}

function read(key: string, area: Area = 'local'): string | null {
  try {
    const value = storage(area).getItem(key)
    if (value !== null) return value
  } catch {
    // 저장소를 쓸 수 없다
  }
  return memory.get(`${area}:${key}`) ?? null
}

function write(key: string, value: string | null, area: Area = 'local'): void {
  if (value === null) memory.delete(`${area}:${key}`)
  else memory.set(`${area}:${key}`, value)
  try {
    if (value === null) storage(area).removeItem(key)
    else storage(area).setItem(key, value)
  } catch {
    // 이 페이지 동안만 기억한다
  }
}

function randomId(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 이 탭의 기기 ID (처음 부를 때 만든다) */
export function deviceId(): string {
  const saved = read(DEVICE_ID_KEY, 'session')
  if (saved !== null && DEVICE_ID_RE.test(saved)) return saved
  const id = randomId()
  write(DEVICE_ID_KEY, id, 'session')
  return id
}

interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void>): Promise<unknown>
}

/**
 * 기기 ID를 이 탭이 쓴다고 잡는다(Web Locks). 복제한 탭이 이미 잡고 있으면 새 ID를 만든다. 잡은 것은 탭이 닫힐 때까지 둔다.
 * 지원하지 않으면 지금 ID 그대로.
 */
export async function claimDeviceId(): Promise<string> {
  const locks = (globalThis.navigator as (Navigator & { locks?: LockManagerLike }) | undefined)?.locks
  if (locks === undefined || typeof locks.request !== 'function') return deviceId()
  for (let tries = 0; tries < 3; tries++) {
    const id = deviceId()
    const held = await new Promise<boolean>((resolve) => {
      locks
        .request(`livejjim-device-${id}`, { ifAvailable: true }, (lock) => {
          resolve(lock !== null)
          // 잡았으면 탭이 닫힐 때까지 놓지 않는다
          return lock === null ? Promise.resolve() : new Promise<void>(() => {})
        })
        .catch(() => resolve(true))
    })
    if (held) return id
    write(DEVICE_ID_KEY, randomId(), 'session')
  }
  return deviceId()
}

/** 이 페이지의 실시간 연결 주소 (기기 ID를 밝힌다 — 출력 기기의 "연결됨/끊김", L-11 10) */
export function streamUrl(): string {
  return `/api/stream?device=${encodeURIComponent(deviceId())}`
}

/** 지금 화면이 휴대폰 폭인가 (use-wide.ts와 같은 경계 — PC 폭이 아니면 휴대폰) */
function narrowScreen(): boolean {
  try {
    return typeof window.matchMedia === 'function' && !window.matchMedia(WIDE_QUERY).matches
  } catch {
    return false
  }
}

function userAgent(): string {
  try {
    return navigator.userAgent
  } catch {
    return ''
  }
}

/** 휴대폰처럼 보이는 기기인지 (기본 기기 이름) */
export function looksLikePhone(): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(userAgent()) || narrowScreen()
}

/** 기본 기기 이름 네 가지 (MOB1 D-MOB1-13, AC-MOB1-24) */
export const DEFAULT_DEVICE_NAMES = { iphone: '아이폰', android: '안드로이드 폰', phone: '휴대폰', pc: 'PC' } as const

export interface DefaultNameInput {
  readonly userAgent: string
  /** 휴대폰 폭인가 (사용자 에이전트로 모를 때 — looksLikePhone과 같은 규칙) */
  readonly narrow: boolean
  /** 지금 출력 기기가 다른 기기면 그 이름 (없거나 이 기기면 null) */
  readonly otherStation: string | null
}

/**
 * 판매자가 이름을 정하지 않았을 때의 기기 이름 (순수 함수): 아이폰·아이패드 "아이폰", 안드로이드 "안드로이드 폰", 그 밖의 휴대폰 "휴대폰", 아니면 "PC".
 * 다른 출력 기기의 이름이 같으면 뒤에 " 2" — 두 기기가 같은 이름으로 보이지 않게. 결과는 늘 cleanDeviceName을 지난다(1~20자)
 */
export function defaultDeviceName({ userAgent: agent, narrow, otherStation }: DefaultNameInput): string {
  const base = /iPhone|iPad/i.test(agent)
    ? DEFAULT_DEVICE_NAMES.iphone
    : /Android/i.test(agent)
      ? DEFAULT_DEVICE_NAMES.android
      : /Mobile/i.test(agent) || narrow
        ? DEFAULT_DEVICE_NAMES.phone
        : DEFAULT_DEVICE_NAMES.pc
  const other = otherStation === null ? null : cleanDeviceName(otherStation)
  return other === base ? `${base} 2` : base
}

/** 이 기기에서 정해 저장한 이름 (없으면 null) */
export function storedDeviceName(): string | null {
  return read(DEVICE_NAME_KEY)
}

/** 기기 이름: 이 기기에서 정한 이름, 없으면 기본 이름(defaultDeviceName — 다른 출력 기기의 이름과 겹치면 " 2") */
export function savedDeviceName(otherStation: string | null = null): string {
  return storedDeviceName() ?? defaultDeviceName({ userAgent: userAgent(), narrow: narrowScreen(), otherStation })
}

export function saveDeviceName(name: string): void {
  write(DEVICE_NAME_KEY, name)
}

/** 보이지 않는 글자를 빼고 앞뒤 공백을 지운다. 1~20자가 아니면 null (서버와 같은 규칙) */
export function cleanDeviceName(value: string): string | null {
  let kept = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    const invisible =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2060 && code <= 0x2064) || code === 0xfeff
    if (!invisible) kept += char
  }
  const cleaned = kept.trim()
  const length = [...cleaned].length
  return length >= 1 && length <= DEVICE_NAME_MAX ? cleaned : null
}

export function savedDensity(): number {
  const value = Number(read(DENSITY_KEY))
  return Number.isInteger(value) && value >= DENSITY_MIN && value <= DENSITY_MAX ? value : DENSITY_DEFAULT
}

export function saveDensity(density: number): void {
  if (Number.isInteger(density) && density >= DENSITY_MIN && density <= DENSITY_MAX) write(DENSITY_KEY, String(density))
}

/** 출력 중이던 시도 (앱이 출력 중에 닫히면 다음에 열 때 끊김으로 알린다 — 그 장은 대기 맨 앞으로) */
export interface SavedAttempt {
  readonly deviceId: string
  readonly attempt: string
}

export function savedAttempt(): SavedAttempt | null {
  const text = read(ATTEMPT_KEY, 'session')
  if (text === null) return null
  try {
    const value = JSON.parse(text) as Partial<SavedAttempt>
    return typeof value.deviceId === 'string' && typeof value.attempt === 'string' ? { deviceId: value.deviceId, attempt: value.attempt } : null
  } catch {
    return null
  }
}

export function saveAttempt(attempt: SavedAttempt | null): void {
  write(ATTEMPT_KEY, attempt === null ? null : JSON.stringify(attempt), 'session')
}
