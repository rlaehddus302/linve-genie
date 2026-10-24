// RL1 연습 모드 휴대폰용 https 인증서를 Node만으로 만들기 (윈도우에는 openssl이 기본으로 없다).
// 만든 인증서를 node:crypto X509Certificate로 다시 읽어 주소(SAN)·기간·용도·자체 서명을 보고, 메모리 안의 연결(duplexPair, 포트를 열지 않음)로
// 실제 TLS 연결이 그 주소 이름으로 확인되는지 본다. 같은 와이파이 주소 고르기(윈도우 가상 연결 뒤로)와 스크립트가 이 길로 넘어가는지도 본다.
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { duplexPair } from 'node:stream'
import { TLSSocket, checkServerIdentity, connect } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSelfSignedCertificate, lanAddresses } from '../src/try/self-signed-cert.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const NOW = new Date('2026-10-24T03:00:00.000Z')
const HOUR = 60 * 60 * 1000

/** 서버(이 인증서)와 클라이언트(이 인증서만 믿음)를 메모리 안에서 이어 TLS 연결을 맺는다 */
const handshake = (pair: { key: string; cert: string }, servername: string, host: string): Promise<{ ok: true; protocol: string | null } | { ok: false; message: string }> =>
  new Promise((resolve) => {
    const [clientSide, serverSide] = duplexPair()
    const server = new TLSSocket(serverSide, { isServer: true, key: pair.key, cert: pair.cert })
    server.on('error', () => {})
    const client = connect({
      socket: clientSide,
      ca: pair.cert,
      servername,
      checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
    })
    client.once('secureConnect', () => {
      const protocol = client.getProtocol()
      client.destroy()
      server.destroy()
      resolve({ ok: true, protocol })
    })
    client.once('error', (error) => {
      server.destroy()
      resolve({ ok: false, message: error.message })
    })
  })

describe('RL1 휴대폰용 자체 서명 인증서 (Node만)', () => {
  const pair = createSelfSignedCertificate({ ips: ['192.168.0.10', '10.0.0.7'], now: NOW, days: 2 })
  const x509 = new X509Certificate(pair.cert)

  it('주소는 같은 와이파이 IP들과 localhost다', () => {
    expect(x509.subjectAltName).toBe('IP Address:192.168.0.10, IP Address:10.0.0.7, DNS:localhost')
    expect(x509.checkIP('192.168.0.10')).toBe('192.168.0.10')
    expect(x509.checkIP('10.0.0.7')).toBe('10.0.0.7')
    expect(x509.checkHost('localhost')).toBe('localhost')
    expect(x509.checkIP('192.168.0.11')).toBeUndefined()
    expect(x509.subject).toBe('CN=livejjim-try')
    expect(x509.issuer).toBe('CN=livejjim-try')
  })

  it('기간은 지금 1시간 전부터 2일 뒤까지다', () => {
    expect(x509.validFromDate.toISOString()).toBe(new Date(NOW.getTime() - HOUR).toISOString())
    expect(x509.validToDate.toISOString()).toBe(new Date(NOW.getTime() + 48 * HOUR).toISOString())
  })

  it('서버 인증용이고 CA가 아니며, 키와 짝이 맞고 스스로 서명했다', () => {
    expect(x509.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1'])
    expect(x509.ca).toBe(false)
    expect(x509.checkPrivateKey(createPrivateKey(pair.key))).toBe(true)
    expect(x509.verify(x509.publicKey)).toBe(true)
    expect(x509.publicKey.asymmetricKeyType).toBe('ec')
    expect(x509.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(pair.key).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('실행마다 새 키·새 일련번호다', () => {
    const other = createSelfSignedCertificate({ ips: ['192.168.0.10'], now: NOW, days: 2 })
    const otherX509 = new X509Certificate(other.cert)
    expect(otherX509.serialNumber).not.toBe(x509.serialNumber)
    expect(otherX509.fingerprint256).not.toBe(x509.fingerprint256)
    expect(other.key).not.toBe(pair.key)
  })

  it('이 인증서를 믿는 클라이언트는 그 IP·localhost로 TLS 연결이 되고, 다른 IP는 거절한다', async () => {
    const now = createSelfSignedCertificate({ ips: ['192.168.0.10'], now: new Date(), days: 2 })
    const byIp = await handshake(now, 'localhost', '192.168.0.10')
    expect(byIp).toEqual({ ok: true, protocol: expect.stringMatching(/^TLSv1\.[23]$/) })
    expect((await handshake(now, 'localhost', 'localhost')).ok).toBe(true)
    const wrong = await handshake(now, 'localhost', '192.168.0.99')
    expect(wrong.ok).toBe(false)
  })

  it('기간이 지난 인증서는 TLS 연결에서 거절된다', async () => {
    const old = createSelfSignedCertificate({ ips: ['192.168.0.10'], now: new Date(Date.now() - 3 * 24 * HOUR), days: 2 })
    const result = await handshake(old, 'localhost', '192.168.0.10')
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/expired/i) })
  })

  it('맞지 않는 값은 멈춘다', () => {
    expect(() => createSelfSignedCertificate({ ips: ['fe80::1'], now: NOW, days: 2 })).toThrow('IPv4')
    expect(() => createSelfSignedCertificate({ ips: ['192.168.0.10'], now: NOW, days: 0 })).toThrow('기간')
    expect(() => createSelfSignedCertificate({ ips: ['192.168.0.10'], now: new Date(Number.NaN), days: 2 })).toThrow('시각')
    expect(() => createSelfSignedCertificate({ ips: [], dnsNames: [], now: NOW, days: 2 })).toThrow('주소')
  })

  it('2050년부터의 기간도 읽힌다 (GeneralizedTime)', () => {
    const later = new X509Certificate(createSelfSignedCertificate({ ips: ['192.168.0.10'], now: new Date('2049-12-31T12:00:00.000Z'), days: 2 }).cert)
    expect(later.validToDate.toISOString()).toBe('2050-01-02T12:00:00.000Z')
  })
})

describe('RL1 같은 와이파이 주소 고르기', () => {
  const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal })

  it('윈도우: 가상 연결(VirtualBox·WSL)보다 Wi-Fi가 먼저다', () => {
    expect(
      lanAddresses({
        'VirtualBox Host-Only Network': [v4('192.168.56.1')],
        'vEthernet (WSL)': [v4('172.20.16.1')],
        'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }, v4('192.168.0.23')],
        'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      }),
    ).toEqual(['192.168.0.23', '192.168.56.1', '172.20.16.1'])
  })

  it('맥: en0 먼저, 자동 사설 주소(169.254)·내부 주소는 뺀다', () => {
    expect(lanAddresses({ bridge100: [v4('192.168.2.1')], en7: [v4('169.254.10.2')], en0: [v4('192.168.0.5')], lo0: [v4('127.0.0.1', true)] })).toEqual(['192.168.0.5', '192.168.2.1'])
  })

  it('유선만 있으면 그 주소, 아무것도 없으면 빈 목록', () => {
    expect(lanAddresses({ Ethernet: [v4('10.1.2.3')] })).toEqual(['10.1.2.3'])
    expect(lanAddresses({ lo0: [v4('127.0.0.1', true)] })).toEqual([])
  })
})

describe('RL1 연습 모드 스크립트의 휴대폰 https', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'try', 'try.mjs'), 'utf8')

  it('openssl이 없거나 실패하면 Node로 만든다', () => {
    expect(script).toContain("execFileSync('openssl'")
    expect(script).toContain('return createSelfSignedCertificate({ ips, now: new Date(), days: 2 })')
    expect(script).toContain('lanAddresses(networkInterfaces())')
  })

  it('윈도우 끄기 신호(Ctrl+C·창 닫기·Ctrl+Break)를 받는다', () => {
    expect(script).toContain("['SIGINT', 'SIGHUP', 'SIGBREAK']")
  })
})
