// 시험의 바깥 연결 막기 장치 (N2b-1, AC-N2b-1-04, D-N2b-1-07). 실제 틱톡·서명 서비스로 나가는 연결은 시험에서 쓰지 않는다.
// 정한 호스트(그 하위 도메인 포함)로 가는 HTTP(S)·웹소켓·TCP 연결 시도를 실제로 나가기 전에 막고 센다.
// - 막는 곳: net.Socket.prototype.connect(TCP·TLS·웹소켓·fetch의 바닥), http(s).request·get(프록시를 거쳐도 목적지 호스트로 본다), 전역 fetch.
// - 장치 여러 개(다른 트랙의 구글 막기 등)를 함께 깔 수 있다: 이름마다 따로 세고, 한 번만 감싸며, 서로를 지우지 않는다.
//   다른 구현이 먼저·나중에 감싸도 지금 함수를 감싸 부르므로 둘 다 동작한다. 되돌리지 않는다(프로세스가 끝날 때까지).
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

/** 틱톡·틱톡 내부 API·틱톡 CDN·서명 서비스(Euler Stream) */
export const TIKTOK_BLOCKED_DOMAINS: readonly string[] = Object.freeze(['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'eulerstream.com'])

export interface OutboundGuard {
  readonly name: string
  /** 지금까지 막은 시도 수 */
  blocked(): number
  /** 막은 시도의 호스트 목록을 돌려주고 센 값을 0으로 */
  reset(): string[]
}

interface GuardEntry {
  readonly name: string
  readonly domains: readonly string[]
  hosts: string[]
}

interface Registry {
  readonly guards: Map<string, GuardEntry>
}

const REGISTRY_KEY = Symbol.for('livejjim.test.outbound-guard')

/** 호스트 이름 다듬기: 소문자, 대괄호·끝 마침표·포트 떼기 */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase()
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined)
  const colon = host.lastIndexOf(':')
  if (colon > 0 && host.indexOf(':') === colon) host = host.slice(0, colon)
  while (host.endsWith('.')) host = host.slice(0, -1)
  return host
}

/** 호스트가 도메인 자체이거나 그 하위 도메인인가 */
export function hostMatches(host: string, domains: readonly string[]): boolean {
  const h = normalizeHost(host)
  return domains.some((domain) => h === domain || h.endsWith(`.${domain}`))
}

function hostOfUrl(value: unknown): string | undefined {
  try {
    if (value instanceof URL) return value.hostname
    if (typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return new URL(value).hostname
  } catch {
    return undefined
  }
  return undefined
}

function pushHost(out: string[], value: unknown): void {
  if (typeof value === 'string' && value !== '') out.push(value)
}

/** http(s).request·get 인자에서 목적지 호스트 후보들 (URL·옵션·Host 머리글·프록시용 절대 경로) */
function requestHosts(args: readonly unknown[]): string[] {
  const out: string[] = []
  for (const arg of args) {
    pushHost(out, hostOfUrl(arg))
    if (typeof arg !== 'object' || arg === null || arg instanceof URL) continue
    const o = arg as Record<string, unknown>
    pushHost(out, o['hostname'])
    pushHost(out, o['host'])
    pushHost(out, o['servername'])
    pushHost(out, hostOfUrl(o['path']))
    const headers = o['headers']
    if (typeof headers === 'object' && headers !== null) {
      for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === 'host') pushHost(out, value)
    }
  }
  return out
}

/** net.Socket#connect 인자에서 호스트 후보들 */
function socketHosts(args: readonly unknown[]): string[] {
  const out: string[] = []
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === 'object' && first !== null) {
    const o = first as Record<string, unknown>
    pushHost(out, o['host'])
    pushHost(out, o['hostname'])
    pushHost(out, o['servername'])
  } else if (typeof first === 'number' || (typeof first === 'string' && /^[0-9]+$/.test(first))) {
    pushHost(out, Array.isArray(args[0]) ? undefined : args[1])
  }
  return out
}

function fetchHosts(input: unknown): string[] {
  const out: string[] = []
  pushHost(out, hostOfUrl(input))
  if (typeof input === 'object' && input !== null && !(input instanceof URL)) pushHost(out, hostOfUrl((input as { url?: unknown }).url))
  return out
}

function blockedError(): Error {
  return Object.assign(new Error('시험에서 바깥 연결을 막았다'), { code: 'ECONNREFUSED' })
}

function registry(): Registry {
  const holder = net as unknown as Record<symbol, Registry | undefined>
  const existing = holder[REGISTRY_KEY]
  if (existing) return existing
  const created: Registry = { guards: new Map() }
  Object.defineProperty(holder, REGISTRY_KEY, { value: created, enumerable: false })
  patch(created)
  return created
}

/** 막을 시도면 그 장치에 세고 true */
function shouldBlock(reg: Registry, hosts: readonly string[]): boolean {
  for (const host of hosts) {
    for (const guard of reg.guards.values()) {
      if (hostMatches(host, guard.domains)) {
        guard.hosts.push(normalizeHost(host))
        return true
      }
    }
  }
  return false
}

type AnyFn = (...args: unknown[]) => unknown

function patch(reg: Registry): void {
  const socketProto = net.Socket.prototype as unknown as { connect: AnyFn; destroy: (error?: Error) => unknown }
  const originalConnect = socketProto.connect
  socketProto.connect = function guardedConnect(this: { destroy: (error?: Error) => unknown }, ...args: unknown[]) {
    if (shouldBlock(reg, socketHosts(args))) {
      process.nextTick(() => this.destroy(blockedError()))
      return this
    }
    return originalConnect.apply(this, args)
  }

  for (const mod of [http, https] as unknown as Array<Record<'request' | 'get', AnyFn>>) {
    for (const key of ['request', 'get'] as const) {
      const original = mod[key]
      mod[key] = function guardedRequest(this: unknown, ...args: unknown[]) {
        if (!shouldBlock(reg, requestHosts(args))) return original.apply(this, args)
        // 소켓을 만들지 않고 다음 차례에 error를 내는 요청을 돌려준다
        const options: Record<string, unknown> = {}
        let callback: unknown
        for (const arg of args) {
          if (typeof arg === 'function') callback = arg
          else if (typeof arg === 'object' && arg !== null && !(arg instanceof URL)) Object.assign(options, arg)
        }
        const blocked = {
          ...options,
          host: 'localhost',
          hostname: 'localhost',
          agent: undefined,
          createConnection: (_opts: unknown, done: (error: Error) => void) => {
            done(blockedError())
            return undefined
          },
        }
        return callback === undefined ? original.call(this, blocked) : original.call(this, blocked, callback)
      }
    }
  }

  const g = globalThis as { fetch?: AnyFn }
  const originalFetch = g.fetch
  if (typeof originalFetch === 'function') {
    g.fetch = function guardedFetch(this: unknown, ...args: unknown[]) {
      if (shouldBlock(reg, fetchHosts(args[0]))) return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: blockedError() }))
      return originalFetch.apply(this, args)
    }
  }
}

/** 장치를 깐다 (같은 이름은 한 번만). 이 프로세스의 모든 바깥 연결 시도에 적용된다 */
export function installOutboundGuard(name: string, domains: readonly string[]): OutboundGuard {
  const reg = registry()
  let entry = reg.guards.get(name)
  if (entry === undefined) {
    entry = { name, domains: domains.map((d) => normalizeHost(d)), hosts: [] }
    reg.guards.set(name, entry)
  }
  const own = entry
  return {
    name,
    blocked: () => own.hosts.length,
    reset: () => own.hosts.splice(0, own.hosts.length),
  }
}
