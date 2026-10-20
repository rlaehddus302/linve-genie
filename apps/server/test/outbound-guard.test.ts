// 바깥 연결 막기 장치 자체 시험 (N2b-1, AC-N2b-1-04). 장치는 시험 준비 파일(setup-outbound-guard.ts)이 모든 서버 시험 파일에 깐다.
// 막는 경로마다(HTTP·HTTPS·TCP·TLS·fetch·웹소켓) 실제로 나가기 전에 막고 세는지 본다. 경로 시험은 결코 풀리지 않는 '.invalid' 도메인을
// 막는 두 번째 장치로 한다 — 장치가 놓치더라도 진짜 바깥 연결이 생기지 않는다. 틱톡 장치 자체는 HTTP 요청 하나로 확인하고 센 값을 되돌린다.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import { hostMatches, installOutboundGuard, normalizeHost, TIKTOK_BLOCKED_DOMAINS } from './outbound-guard.ts'

const tiktok = installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS)
const probe = installOutboundGuard('probe-invalid', ['guard-probe.invalid'])

afterEach(() => {
  probe.reset()
})

/** 'error' 이벤트를 기다려 code를 돌려준다 */
function errorCode(emitter: { once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown }): Promise<string | undefined> {
  return new Promise((resolve) => emitter.once('error', (error) => resolve(error.code)))
}

describe('AC-N2b-1-04 막을 호스트', () => {
  it('틱톡·틱톡 내부 API·CDN·서명 서비스와 그 하위 도메인', () => {
    for (const host of ['tiktok.com', 'www.tiktok.com', 'webcast.tiktok.com', 'WEBCAST16-WS-USEAST1A.TIKTOKV.COM', 'p16-sign.tiktokcdn.com', 'tiktok.eulerstream.com', 'eulerstream.com.', 'www.tiktok.com:443', '[www.tiktok.com]']) {
      expect(hostMatches(host, TIKTOK_BLOCKED_DOMAINS), host).toBe(true)
    }
  })

  it('닮은 호스트는 막지 않는다 (막을 대상이 아니면 그대로 보낸다)', () => {
    for (const host of ['tiktok.com.evil.example', 'nottiktok.com', 'tiktok.co', 'evil.example', 'eulerstream.co', 'localhost', '127.0.0.1', '::1']) {
      expect(hostMatches(host, TIKTOK_BLOCKED_DOMAINS), host).toBe(false)
    }
  })

  it('호스트 다듬기: 소문자·끝 마침표·포트·대괄호', () => {
    expect(normalizeHost(' WWW.TikTok.com. ')).toBe('www.tiktok.com')
    expect(normalizeHost('www.tiktok.com:8443')).toBe('www.tiktok.com')
    expect(normalizeHost('[::1]:443')).toBe('::1')
  })
})

describe('AC-N2b-1-04 막는 경로 — 실제로 나가기 전에 막고 센다', () => {
  it('틱톡 장치: https 요청을 막고 센다 (센 값은 되돌린다)', async () => {
    const before = tiktok.blocked()
    const req = https.get('https://www.tiktok.com/@seller_kim/live')
    expect(await errorCode(req)).toBe('ECONNREFUSED')
    expect(tiktok.blocked()).toBe(before + 1)
    expect(tiktok.reset().slice(before)).toEqual(['www.tiktok.com'])
  })

  it('http 요청 (URL 문자열·옵션 객체·Host 머리글로 프록시를 거치는 요청)', async () => {
    expect(await errorCode(http.get('http://a.guard-probe.invalid/x'))).toBe('ECONNREFUSED')
    expect(await errorCode(http.request({ hostname: 'b.guard-probe.invalid', path: '/' }).end())).toBe('ECONNREFUSED')
    expect(await errorCode(http.request({ host: '127.0.0.1', port: 9, path: 'https://c.guard-probe.invalid/x', headers: { Host: 'c.guard-probe.invalid' } }).end())).toBe('ECONNREFUSED')
    expect(probe.reset()).toEqual(['a.guard-probe.invalid', 'b.guard-probe.invalid', 'c.guard-probe.invalid'])
  })

  it('TCP·TLS 연결 (웹소켓·fetch가 쓰는 바닥)', async () => {
    expect(await errorCode(net.connect({ host: 'd.guard-probe.invalid', port: 443 }))).toBe('ECONNREFUSED')
    expect(await errorCode(net.connect(443, 'e.guard-probe.invalid'))).toBe('ECONNREFUSED')
    expect(await errorCode(tls.connect({ host: 'f.guard-probe.invalid', port: 443, servername: 'f.guard-probe.invalid' }))).toBe('ECONNREFUSED')
    expect(probe.blocked()).toBe(3)
  })

  it('전역 fetch와 웹소켓', async () => {
    await expect(fetch('https://g.guard-probe.invalid/x')).rejects.toThrow('fetch failed')
    const ws = new WebSocket('wss://h.guard-probe.invalid/ws')
    await new Promise<void>((resolve) => ws.addEventListener('error', () => resolve()))
    expect(probe.reset()).toEqual(expect.arrayContaining(['g.guard-probe.invalid', 'h.guard-probe.invalid']))
  })

  it('막을 대상이 아닌 곳은 그대로 보낸다 (닫힌 로컬 포트 → 운영체제의 거절, 세지 않는다)', async () => {
    const before = tiktok.blocked()
    const socket = net.connect({ host: '127.0.0.1', port: 1 })
    expect(await errorCode(socket)).toBe('ECONNREFUSED')
    expect(tiktok.blocked()).toBe(before)
    expect(probe.blocked()).toBe(0)
  })

  it('장치 여러 개가 함께 깔려도 서로를 지우지 않는다 (같은 이름은 한 번만)', async () => {
    const again = installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS)
    const req = http.get('http://i.guard-probe.invalid/')
    expect(await errorCode(req)).toBe('ECONNREFUSED')
    const before = again.blocked()
    const req2 = https.get('https://tiktok.eulerstream.com/webcast/fetch')
    expect(await errorCode(req2)).toBe('ECONNREFUSED')
    expect(tiktok.blocked()).toBe(before + 1)
    expect(probe.blocked()).toBe(1)
    tiktok.reset()
  })
})
