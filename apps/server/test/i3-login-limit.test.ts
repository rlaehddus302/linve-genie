// AC-I3-66·67 로그인 경로 속도 제한 (RA-S04-004, SYS-01, NFR-01, D-I3-12).
// 순서: IP 한도(10분 20번) → 전체 동시 한도(확인 4개·기다림 32개·10초) → 아이디 잠금(D-074) → 비밀번호 확인.
// IP = TCP 연결 주소(시험은 요청 정보 env.incoming.socket.remoteAddress로 넣는다). 믿는 프록시 수만큼만 X-Forwarded-For를 본다.
import { afterEach, describe, expect, it } from 'vitest'
import { IpLimiter, VerifyGate, clientAddress, ipKey } from '../src/login-limit.ts'
import { formatLog } from '../src/log.ts'
import { verifyPassword } from '../src/secrets.ts'
import type { ServerOptions } from '../src/server.ts'
import { ORIGIN, addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, writeEvent, type TestServer } from './support.ts'

const worlds: TestServer[] = []
async function world(overrides: Partial<ServerOptions> = {}): Promise<TestServer> {
  const created = await newWorld(overrides)
  worlds.push(created)
  return created
}
afterEach(() => {
  for (const item of worlds.splice(0)) item.server.close()
})

/** 비밀번호 확인 횟수·동시 수를 재는 확인 함수 (delayMs만큼 더 걸린다) */
function countingVerifier(delayMs = 0) {
  const stats = { calls: 0, active: 0, peak: 0 }
  const verify = async (password: string, stored: string) => {
    stats.calls += 1
    stats.active += 1
    stats.peak = Math.max(stats.peak, stats.active)
    try {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return await verifyPassword(password, stored)
    } finally {
      stats.active -= 1
    }
  }
  return { stats, verify }
}

async function loginFrom(w: TestServer, address: string | null, loginId: string, password: string, forwardedFor?: string): Promise<{ status: number; code: string | null; message: string | null }> {
  const env = address === null ? undefined : { incoming: { socket: { remoteAddress: address } } }
  const response = await w.server.app.request(
    '/api/login',
    { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(forwardedFor === undefined ? {} : { 'X-Forwarded-For': forwardedFor }) }, body: JSON.stringify({ loginId, password }) },
    env,
  )
  const body = (await response.json()) as { error?: { code: string; message: string } }
  return { status: response.status, code: body.error?.code ?? null, message: body.error?.message ?? null }
}

const RATE_LIMITED = { status: 429, code: 'LOGIN_RATE_LIMITED', message: '로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.' }

describe('AC-I3-66 같은 IP 한도', () => {
  it('같은 IP의 시도가 10분에 20번을 넘으면 21번째부터 비밀번호를 확인하지 않고(scrypt 0) 429 — 맞는 비밀번호여도, 다른 IP는 영향 없음, 10분 뒤 다시 받는다', async () => {
    const counting = countingVerifier()
    const clock = fakeClock()
    const w = await world({ passwordVerifier: counting.verify, clock })
    const seller = await addSeller(w, 'iplimit', 'pass-word-11')
    for (let i = 0; i < 20; i++) {
      const result = await loginFrom(w, '203.0.113.7', `ghost${String(i)}`, 'nope-nope')
      expect(result.status, String(i)).toBe(401)
    }
    const callsBefore = counting.stats.calls
    expect(await loginFrom(w, '203.0.113.7', 'iplimit', 'pass-word-11')).toEqual(RATE_LIMITED)
    expect(await loginFrom(w, '203.0.113.7', 'ghost-x', 'nope-nope')).toEqual(RATE_LIMITED)
    expect(counting.stats.calls).toBe(callsBefore)
    // 다른 IP는 그대로
    expect((await loginFrom(w, '198.51.100.20', 'iplimit', 'pass-word-11')).status).toBe(200)
    // 10분이 지나면 다시 받는다
    clock.advance(10 * 60 * 1000 - 1)
    expect(await loginFrom(w, '203.0.113.7', 'iplimit', 'pass-word-11')).toEqual(RATE_LIMITED)
    clock.advance(1)
    expect((await loginFrom(w, '203.0.113.7', 'iplimit', 'pass-word-11')).status).toBe(200)
    // 이미 로그인한 세션은 상관없다
    expect((await client(w, seller.cookie).get('/api/me')).status).toBe(200)
    expect(w.server.auth.loginRejections.ip).toBe(3)
  })

  it('믿는 프록시 0(기본)이면 X-Forwarded-For를 보지 않는다 — 머리글을 바꿔도 같은 IP로 센다', async () => {
    const w = await world()
    for (let i = 0; i < 20; i++) expect((await loginFrom(w, '203.0.113.8', `g${String(i)}`, 'nope-nope', `10.0.0.${String(i)}`)).status).toBe(401)
    expect(await loginFrom(w, '203.0.113.8', 'g-last', 'nope-nope', '10.9.9.9')).toEqual(RATE_LIMITED)
  })

  it('믿는 프록시 n이면 X-Forwarded-For의 오른쪽에서 n번째 — 값이 모자라면 연결 주소', async () => {
    const one = await world({ trustedProxies: 1 })
    // 프록시(연결 주소 하나)를 거친 서로 다른 손님 둘: 한쪽이 20번을 써도 다른 쪽은 그대로
    for (let i = 0; i < 20; i++) expect((await loginFrom(one, '10.0.0.1', `a${String(i)}`, 'nope-nope', `1.1.1.1, 192.0.2.10`)).status).toBe(401)
    expect(await loginFrom(one, '10.0.0.1', 'a-x', 'nope-nope', '9.9.9.9, 192.0.2.10')).toEqual(RATE_LIMITED)
    expect((await loginFrom(one, '10.0.0.1', 'b-x', 'nope-nope', '192.0.2.10, 192.0.2.11')).status).toBe(401)
    // 머리글이 없으면 연결 주소로 센다
    for (let i = 0; i < 20; i++) expect((await loginFrom(one, '10.0.0.2', `c${String(i)}`, 'nope-nope')).status).toBe(401)
    expect(await loginFrom(one, '10.0.0.2', 'c-x', 'nope-nope')).toEqual(RATE_LIMITED)
    expect(clientAddress('10.0.0.1', '1.1.1.1, 2.2.2.2, 3.3.3.3', 2)).toBe('2.2.2.2')
    expect(clientAddress('10.0.0.1', '3.3.3.3', 2)).toBe('10.0.0.1')
    expect(clientAddress('10.0.0.1', '1.1.1.1, 2.2.2.2', 0)).toBe('10.0.0.1')
    expect(clientAddress('10.0.0.1', 'not-an-ip', 1)).toBe('10.0.0.1')
    expect(clientAddress(null, undefined, 1)).toBeNull()
  })

  it('IPv6는 앞 64비트로 센다 — IPv4를 담은 IPv6는 IPv4', async () => {
    const w = await world()
    for (let i = 0; i < 20; i++) expect((await loginFrom(w, `2001:db8:1:2::${String(i + 1)}`, `v${String(i)}`, 'nope-nope')).status).toBe(401)
    expect(await loginFrom(w, '2001:db8:1:2:ffff:ffff:ffff:ffff', 'v-x', 'nope-nope')).toEqual(RATE_LIMITED)
    expect((await loginFrom(w, '2001:db8:1:3::1', 'w-x', 'nope-nope')).status).toBe(401)
    expect(ipKey('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe(ipKey('2001:db8:1:2::abcd'))
    expect(ipKey('::ffff:192.0.2.1')).toBe('192.0.2.1')
    expect(ipKey('192.0.2.1')).toBe('192.0.2.1')
    expect(ipKey('fe80::1%en0')).toBe(ipKey('fe80::2'))
    expect(ipKey('garbage')).toBeNull()
  })

  it('아이디 잠금과 함께 돈다: IP 한도가 먼저 — 막힌 시도는 아이디 실패로 세지 않는다', async () => {
    const counting = countingVerifier()
    const w = await world({ passwordVerifier: counting.verify })
    await addSeller(w, 'lockme', 'pass-word-11')
    const statuses: (string | number)[] = []
    for (let i = 0; i < 22; i++) {
      const result = await loginFrom(w, '203.0.113.9', 'lockme', 'wrong-one')
      statuses.push(result.code ?? result.status)
    }
    expect(statuses).toEqual([...Array.from({ length: 10 }, () => 'LOGIN_FAILED'), ...Array.from({ length: 10 }, () => 'LOGIN_LOCKED'), 'LOGIN_RATE_LIMITED', 'LOGIN_RATE_LIMITED'])
    // 잠금은 아이디마다 — 다른 IP에서도 잠겨 있다
    expect((await loginFrom(w, '198.51.100.9', 'lockme', 'pass-word-11')).code).toBe('LOGIN_LOCKED')
  })

  it('기록은 1만 IP까지 — 넘으면 가장 오래 안 쓴 것부터 지운다', () => {
    const clock = fakeClock()
    const limiter = new IpLimiter(clock)
    for (let i = 0; i < 20; i++) expect(limiter.take('first')).toBe(true)
    expect(limiter.take('first')).toBe(false)
    for (let i = 0; i < 10_000; i++) limiter.take(`k${String(i)}`)
    expect(limiter.size).toBe(10_000)
    // 가장 오래 안 쓴 'first'가 지워져 처음부터 다시 센다
    expect(limiter.take('first')).toBe(true)
    expect(limiter.size).toBe(10_000)
    // 연결 주소를 모르면(프로세스 안 요청) 한도를 걸지 않는다
    for (let i = 0; i < 50; i++) expect(limiter.take(null)).toBe(true)
  })

  it('IP는 로그에 남지 않는다', async () => {
    const w = await world()
    for (let i = 0; i < 22; i++) await loginFrom(w, '203.0.113.77', `ghost${String(i)}`, 'nope-nope')
    const text = w.logs.map((record) => `${formatLog(record)} ${JSON.stringify(record)}`).join('\n')
    expect(text).not.toContain('203.0.113.77')
  })
})

describe('AC-I3-67 전체 동시 확인 한도', () => {
  it('서로 다른 IP 100개가 동시에 로그인 → 동시에 도는 확인 ≤ 4, LOGIN_BUSY 1개 이상 — 같은 때 이미 로그인한 세션의 문자찜 쓰기는 429·오류 없이 처리된다', async () => {
    const counting = countingVerifier(40)
    const w = await world({ passwordVerifier: counting.verify })
    const seller = await addSeller(w, 'storm', 'pass-word-11')
    const b = await createBroadcast(w, seller)
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000, stock: 100 }))
    counting.stats.peak = 0
    const logins = Array.from({ length: 100 }, (_, i) => loginFrom(w, `198.18.${String(Math.floor(i / 250))}.${String(i % 250)}`, i % 2 === 0 ? 'storm' : `ghost${String(i)}`, i % 4 === 0 ? 'pass-word-11' : 'nope-nope'))
    const writes = Array.from({ length: 10 }, (_, i) => client(w, seller.cookie).post('/api/events', { requestId: `storm-sms-${String(i)}`, type: 'sms', b: b.id, no: 15 }))
    const [loginResults, writeResults] = await Promise.all([Promise.all(logins), Promise.all(writes)])
    expect(counting.stats.peak).toBeLessThanOrEqual(4)
    expect(counting.stats.peak).toBe(4)
    const busy = loginResults.filter((result) => result.code === 'LOGIN_BUSY')
    expect(busy.length).toBeGreaterThanOrEqual(1)
    for (const result of busy) expect(result).toEqual({ status: 429, code: 'LOGIN_BUSY', message: '지금 로그인 요청이 많아요. 잠시 뒤에 다시 해 주세요.' })
    // 받은 요청은 평소처럼 확인했다 (맞는 비밀번호는 200, 틀린 것은 401)
    expect(loginResults.every((result) => [200, 401, 429].includes(result.status))).toBe(true)
    expect(loginResults.filter((result) => result.status === 200).length).toBeGreaterThan(0)
    for (const result of writeResults) expect(result.status, result.text).toBe(200)
    expect(w.server.auth.loginRejections.busy).toBe(busy.length)
  })

  it('기다리다 차례가 오면 평소처럼 확인하고, 10초(시험은 줄임) 안에 차례가 오지 않으면 확인 없이 LOGIN_BUSY', async () => {
    const counting = countingVerifier(150)
    const w = await world({ passwordVerifier: counting.verify, loginLimits: { queueWaitMs: 60_000 } })
    await addSeller(w, 'patient', 'pass-word-11')
    counting.stats.calls = 0
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => loginFrom(w, `192.0.2.${String(i + 1)}`, 'patient', i === 5 ? 'pass-word-11' : `wrong-${String(i)}`)))
    expect(results.map((result) => result.status)).toEqual([401, 401, 401, 401, 401, 200])
    expect(counting.stats.calls).toBe(6)
    const impatient = await world({ passwordVerifier: countingVerifier(300).verify, loginLimits: { queueWaitMs: 50 } })
    const quick = await Promise.all(Array.from({ length: 6 }, (_, i) => loginFrom(impatient, `192.0.2.${String(i + 10)}`, `nobody${String(i)}`, 'nope-nope')))
    expect(quick.filter((result) => result.code === 'LOGIN_BUSY')).toHaveLength(2)
    expect(quick.filter((result) => result.status === 401)).toHaveLength(4)
  })

  it('자리 넘기기: 기다리는 요청이 있으면 끝난 자리를 바로 넘긴다 (도는 수 4를 넘지 않는다)', async () => {
    const gate = new VerifyGate({ concurrency: 2, queueMax: 1, queueWaitMs: 10_000 })
    expect(await gate.acquire()).toBe(true)
    expect(await gate.acquire()).toBe(true)
    const waiting = gate.acquire()
    expect(await gate.acquire()).toBe(false)
    expect(gate.waiting).toBe(1)
    gate.release()
    expect(await waiting).toBe(true)
    expect(gate.active).toBe(2)
    gate.release()
    gate.release()
    expect(gate.active).toBe(0)
  })
})
