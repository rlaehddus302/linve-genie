// 네트워크 가드 (AC-N2-62, D-N2-11): 서버 시험은 실제 메타 주소로 나가는 연결을 막는다 — 닿으면 그 자리에서 오류이고 그 시험 파일이 실패한다.
// fetch(undici)와 node:net 소켓 연결 둘 다 본다. 가짜 메타 서버(127.0.0.1)는 막지 않는다.
// apps/server/vitest.config.ts의 setupFiles로 모든 서버 시험 파일에 걸린다. 다른 시험(적대 등)은 installNetworkGuard()를 불러 쓴다.
import net from 'node:net'
import { afterAll, expect } from 'vitest'

/** 시험이 닿으면 안 되는 메타 주소 */
export const META_HOSTS: readonly string[] = ['graph.facebook.com', 'graph.instagram.com', 'www.facebook.com', 'api.instagram.com', 'www.instagram.com', 'facebook.com', 'instagram.com']

const isMetaHost = (host: string): boolean => {
  const lower = host.toLowerCase().replace(/\.$/, '')
  return META_HOSTS.some((meta) => lower === meta || lower.endsWith(`.${meta}`)) || lower.endsWith('.facebook.com') || lower.endsWith('.instagram.com') || lower.endsWith('.fbcdn.net')
}

/** 막은 연결 (시험이 읽는다) */
export const blockedConnections: string[] = []

let installed = false

export function installNetworkGuard(): void {
  if (installed) return
  installed = true
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      host = ''
    }
    if (isMetaHost(host)) {
      blockedConnections.push(host)
      return Promise.reject(new Error(`네트워크 가드: 시험이 실제 메타 주소(${host})에 닿으려 했다`))
    }
    return originalFetch(input, init)
  }) as typeof fetch
  const originalConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const first = args[0]
    const host = typeof first === 'object' && first !== null && 'host' in first ? String((first as { host?: unknown }).host ?? '') : typeof args[1] === 'string' ? args[1] : ''
    if (isMetaHost(host)) {
      blockedConnections.push(host)
      throw new Error(`네트워크 가드: 시험이 실제 메타 주소(${host})에 닿으려 했다`)
    }
    return (originalConnect as (...rest: unknown[]) => net.Socket).apply(this, args)
  } as typeof net.Socket.prototype.connect
}

installNetworkGuard()

afterAll(() => {
  expect(blockedConnections, '시험이 실제 메타 주소에 닿으려 했다').toEqual([])
})
