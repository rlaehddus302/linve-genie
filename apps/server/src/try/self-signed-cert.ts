// 연습 모드(pnpm try) 휴대폰용 https의 자체 서명 인증서를 Node만으로 만든다(RL1). 운영 기동은 쓰지 않는다.
// 윈도우에는 openssl이 기본으로 없어서, openssl이 없거나 실패하면 이 함수로 만든다(scripts/try/try.mjs).
// 새 의존성 없이 node:crypto의 키 만들기·서명과 아래의 작은 DER(ASN.1) 인코더로 X.509 v3 인증서를 쓴다.
// - 키: ECDSA P-256, 서명: ecdsa-with-SHA256
// - 확장: basicConstraints(CA 아님, 중요)·keyUsage digitalSignature(중요)·extendedKeyUsage serverAuth·subjectAltName(IP·DNS)·subjectKeyIdentifier
// - 기간: notBefore = 지금 - 1시간(휴대폰 시계가 조금 늦어도 되게), notAfter = 지금 + days일
// 시각은 인자로 받는다(시험에서 고정한다). 개인 키는 파일·로그에 남기지 않는다 — 부르는 쪽이 메모리로 https 서버에 넘긴다.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isIPv4 } from 'node:net'

export interface SelfSignedOptions {
  /** 인증서에 넣을 IPv4 주소들 (휴대폰이 여는 같은 와이파이 주소) */
  readonly ips: readonly string[]
  /** 인증서에 넣을 이름들 (기본 localhost) */
  readonly dnsNames?: readonly string[]
  /** 지금 시각 */
  readonly now: Date
  /** 며칠 동안 쓰나 */
  readonly days: number
  /** 인증서 이름 (기본 livejjim-try) */
  readonly commonName?: string
}

export interface SelfSignedCertificate {
  /** PKCS#8 PEM 개인 키 */
  readonly key: string
  /** X.509 PEM 인증서 */
  readonly cert: string
}

// ── 작은 DER 인코더 ─────────────────────────────────────────
const length = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const tlv = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), length(content.length), content])
const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items))
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items))
const octetString = (content: Buffer): Buffer => tlv(0x04, content)
const bitString = (content: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0]), content]))
const utf8String = (text: string): Buffer => tlv(0x0c, Buffer.from(text, 'utf8'))
const explicit = (n: number, content: Buffer): Buffer => tlv(0xa0 | n, content)
const TRUE = Buffer.from([0x01, 0x01, 0xff])

/** 양의 정수 (큰 쪽 바이트 먼저). 맨 앞 비트가 1이면 0을 붙인다 */
const integer = (bytes: Buffer): Buffer => {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0 && ((bytes[start + 1] ?? 0) & 0x80) === 0) start++
  const trimmed = bytes.subarray(start)
  return tlv(0x02, ((trimmed[0] ?? 0) & 0x80) !== 0 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed)
}

const oid = (dotted: string): Buffer => {
  const parts = dotted.split('.').map(Number)
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  const out: number[] = [first * 40 + second]
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f]
    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) chunk.unshift(0x80 | (rest & 0x7f))
    out.push(...chunk)
  }
  return tlv(0x06, Buffer.from(out))
}

/** UTCTime(2049년까지) 또는 GeneralizedTime (RFC 5280 4.1.2.5) */
const time = (date: Date): Buffer => {
  const two = (n: number) => String(n).padStart(2, '0')
  const year = date.getUTCFullYear()
  const rest = `${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`
  return year < 2050 ? tlv(0x17, Buffer.from(`${two(year % 100)}${rest}`, 'ascii')) : tlv(0x18, Buffer.from(`${String(year)}${rest}`, 'ascii'))
}

const extension = (id: string, critical: boolean, value: Buffer): Buffer => (critical ? sequence(oid(id), TRUE, octetString(value)) : sequence(oid(id), octetString(value)))

const ECDSA_WITH_SHA256 = sequence(oid('1.2.840.10045.4.3.2'))
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 자체 서명 서버 인증서와 개인 키 (PEM) */
export function createSelfSignedCertificate(options: SelfSignedOptions): SelfSignedCertificate {
  const dnsNames = options.dnsNames ?? ['localhost']
  if (options.ips.length === 0 && dnsNames.length === 0) throw new Error('인증서에 넣을 주소가 없어요.')
  for (const ip of options.ips) if (!isIPv4(ip)) throw new Error('IPv4 주소만 넣을 수 있어요.')
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 30) throw new Error('기간은 1~30일이에요.')
  const nowMs = options.now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('지금 시각이 올바르지 않아요.')

  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const name = sequence(set(sequence(oid('2.5.4.3'), utf8String(options.commonName ?? 'livejjim-try'))))
  const serial = randomBytes(16)
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40

  const altNames = Buffer.concat([
    ...options.ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
    ...dnsNames.map((dns) => tlv(0x82, Buffer.from(dns, 'ascii'))),
  ])
  const extensions = sequence(
    extension('2.5.29.19', true, sequence()),
    extension('2.5.29.15', true, Buffer.from([0x03, 0x02, 0x07, 0x80])),
    extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.17', false, tlv(0x30, altNames)),
    extension('2.5.29.14', false, octetString(createHash('sha1').update(spki).digest())),
  )

  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    ECDSA_WITH_SHA256,
    name,
    sequence(time(new Date(nowMs - HOUR_MS)), time(new Date(nowMs + options.days * DAY_MS))),
    name,
    spki,
    explicit(3, extensions),
  )
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' })
  const der = sequence(tbs, ECDSA_WITH_SHA256, bitString(signature))
  const lines = der.toString('base64').match(/.{1,64}/g) ?? []
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
  }
}

// ── 같은 와이파이 주소 고르기 ───────────────────────────────
export interface LanInterface {
  readonly address: string
  readonly family: string | number
  readonly internal: boolean
}

/** 와이파이로 보이는 이름 (맥 en0·윈도우 Wi-Fi/무선·리눅스 wlan) */
const WIFI = /^en0$|wi-?fi|wlan|wireless|무선/i
/** 가상·VPN 연결로 보이는 이름 (휴대폰이 닿지 않는 주소) — 뒤로 미룬다 */
const VIRTUAL = /vethernet|virtualbox|vbox|vmware|vmnet|hyper-v|wsl|docker|bridge|utun|tailscale|zerotier|vpn|tap|tun|loopback|npcap|bluetooth|블루투스/i

/**
 * 휴대폰이 이 컴퓨터를 찾을 IPv4 주소들, 그럴듯한 순서로 (와이파이 → 그 밖 → 가상·VPN, 같은 순위는 이름 순).
 * 윈도우에서는 "VirtualBox Host-Only Network"·"vEthernet (WSL)" 같은 가상 연결이 와이파이보다 앞 이름이라 그대로 고르면 휴대폰이 못 연다.
 */
export function lanAddresses(all: Readonly<Record<string, readonly LanInterface[] | undefined>>): string[] {
  const rank = (name: string) => (WIFI.test(name) ? 0 : VIRTUAL.test(name) ? 2 : 1)
  const names = Object.keys(all).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
  const out: string[] = []
  for (const name of names) {
    for (const entry of all[name] ?? []) {
      const ipv4 = entry.family === 'IPv4' || entry.family === 4
      if (ipv4 && !entry.internal && !entry.address.startsWith('169.254.') && !out.includes(entry.address)) out.push(entry.address)
    }
  }
  return out
}
