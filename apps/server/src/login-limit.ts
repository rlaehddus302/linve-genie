// 로그인 경로 속도 제한 (RA-S04-004, SYS-01, NFR-01, D-I3-12, AC-I3-66·67).
// 순서: IP 한도 → 전체 동시 한도 → 아이디 잠금(D-074, auth.ts) → 비밀번호 확인.
// - IP 한도: 같은 IP(IPv6는 앞 64비트)의 로그인 시도가 10분 안에 20번을 넘으면 비밀번호를 확인하지 않고 429. 받은 시도만 센다(막은 시도는 세지 않는다 —
//   막힌 IP는 가장 오래된 시도가 10분을 넘기면 다시 받는다). 기록은 서버 메모리, 1만 IP를 넘으면 가장 오래 안 쓴 것부터 지운다.
// - IP 판단: TCP 연결 주소. 믿는 프록시 수(LIVEJJIM_TRUSTED_PROXIES)가 n이면 X-Forwarded-For의 오른쪽에서 n번째(값이 모자라거나 IP가 아니면 연결 주소).
//   0(기본)이면 머리글을 보지 않는다 — 공격자가 머리글을 바꿔 한도를 피하지 못한다. 연결 주소를 모르면(프로세스 안 요청) IP 한도를 걸지 않는다.
// - 전체 동시 한도: 비밀번호 확인(scrypt)은 서버마다 동시에 4개까지, 기다리는 요청은 32개·10초까지 — 넘으면 확인 없이 429. 방송 중 채팅 판정이
//   로그인 폭주로 늦어지지 않게(이미 로그인한 세션은 상관없다).
// - IP는 로그·응답에 남기지 않는다(셈만 운영 상태에).
import { isIP } from 'node:net'
import type { Clock } from './time.ts'

export const IP_WINDOW_MS = 10 * 60 * 1000
export const IP_MAX_ATTEMPTS = 20
export const IP_TRACK_MAX = 10_000
export const VERIFY_CONCURRENCY = 4
export const VERIFY_QUEUE_MAX = 32
export const VERIFY_QUEUE_WAIT_MS = 10_000

export const LOGIN_RATE_LIMITED_MESSAGE = '로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.'
export const LOGIN_BUSY_MESSAGE = '지금 로그인 요청이 많아요. 잠시 뒤에 다시 해 주세요.'

export interface LoginLimitOptions {
  readonly ipWindowMs?: number
  readonly ipMaxAttempts?: number
  readonly ipTrackMax?: number
  readonly concurrency?: number
  readonly queueMax?: number
  readonly queueWaitMs?: number
}

/** IP 한도의 키: IPv4는 그대로, IPv4를 담은 IPv6(::ffff:a.b.c.d)는 IPv4로, 그 밖의 IPv6는 앞 64비트. IP가 아니면 null */
export function ipKey(address: string): string | null {
  const bare = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const kind = isIP(bare)
  if (kind === 4) return bare
  if (kind !== 6) return null
  const mapped = /^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare) ?? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare)
  if (mapped !== null && isIP(mapped[1] ?? '') === 4) return mapped[1] as string
  const groups = expandIpv6(bare)
  return groups === null ? null : `${groups.slice(0, 4).join(':')}::/64`
}

function expandIpv6(address: string): string[] | null {
  let text = address.toLowerCase()
  // 끝의 IPv4 부분은 두 그룹으로
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (tail !== null) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number]
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', rest] = text.split('::')
  const left = head === '' ? [] : head.split(':')
  const right = rest === undefined || rest === '' ? [] : rest.split(':')
  const missing = 8 - left.length - right.length
  if (rest === undefined ? missing !== 0 : missing < 1) return null
  const groups = [...left, ...Array.from({ length: rest === undefined ? 0 : missing }, () => '0'), ...right]
  return groups.map((group) => (Number.parseInt(group || '0', 16) || 0).toString(16))
}

/** 로그인 시도를 센 주소: 연결 주소, 믿는 프록시가 n개면 X-Forwarded-For의 오른쪽에서 n번째 (모자라거나 IP가 아니면 연결 주소) */
export function clientAddress(connection: string | null, forwardedFor: string | undefined, trustedProxies: number): string | null {
  if (trustedProxies > 0 && forwardedFor !== undefined) {
    const hops = forwardedFor
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop !== '')
    const picked = hops.length >= trustedProxies ? hops[hops.length - trustedProxies] : undefined
    if (picked !== undefined && ipKey(picked) !== null) return picked
  }
  return connection
}

/** IP마다 최근 10분의 받은 시도 시각 */
export class IpLimiter {
  readonly #clock: Clock
  readonly #windowMs: number
  readonly #max: number
  readonly #trackMax: number
  readonly #attempts = new Map<string, number[]>()

  constructor(clock: Clock, options: LoginLimitOptions = {}) {
    this.#clock = clock
    this.#windowMs = options.ipWindowMs ?? IP_WINDOW_MS
    this.#max = options.ipMaxAttempts ?? IP_MAX_ATTEMPTS
    this.#trackMax = options.ipTrackMax ?? IP_TRACK_MAX
  }

  /** 기록 중인 IP 수 (시험·점검) */
  get size(): number {
    return this.#attempts.size
  }

  /** 이 IP의 시도를 받을지 (받으면 센다). 키가 null(연결 주소를 모름)이면 늘 받는다 */
  take(key: string | null): boolean {
    if (key === null) return true
    const now = this.#clock.now()
    const recent = (this.#attempts.get(key) ?? []).filter((at) => at > now - this.#windowMs)
    // 가장 최근에 쓴 것으로 옮긴다 (넘치면 가장 오래 안 쓴 것부터 지운다)
    this.#attempts.delete(key)
    if (recent.length >= this.#max) {
      this.#attempts.set(key, recent)
      return false
    }
    recent.push(now)
    this.#attempts.set(key, recent)
    while (this.#attempts.size > this.#trackMax) {
      const oldest = this.#attempts.keys().next().value
      if (oldest === undefined) break
      this.#attempts.delete(oldest)
    }
    return true
  }
}

/** 비밀번호 확인 동시 한도 (서버마다): 4개까지 돌고 32개·10초까지 기다린다 */
export class VerifyGate {
  readonly #concurrency: number
  readonly #queueMax: number
  readonly #waitMs: number
  #active = 0
  readonly #queue: (() => void)[] = []

  constructor(options: LoginLimitOptions = {}) {
    this.#concurrency = options.concurrency ?? VERIFY_CONCURRENCY
    this.#queueMax = options.queueMax ?? VERIFY_QUEUE_MAX
    this.#waitMs = options.queueWaitMs ?? VERIFY_QUEUE_WAIT_MS
  }

  get active(): number {
    return this.#active
  }

  get waiting(): number {
    return this.#queue.length
  }

  /** 자리를 얻으면 true (끝나면 release), 기다리는 줄이 차거나 10초 안에 차례가 오지 않으면 false */
  acquire(): Promise<boolean> {
    if (this.#active < this.#concurrency) {
      this.#active += 1
      return Promise.resolve(true)
    }
    if (this.#queue.length >= this.#queueMax) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const grant = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        const index = this.#queue.indexOf(grant)
        if (index >= 0) this.#queue.splice(index, 1)
        resolve(false)
      }, this.#waitMs)
      timer.unref?.()
      this.#queue.push(grant)
    })
  }

  release(): void {
    const next = this.#queue.shift()
    // 기다리는 요청에 자리를 그대로 넘긴다 (도는 수는 그대로)
    if (next !== undefined) next()
    else this.#active = Math.max(0, this.#active - 1)
  }
}
