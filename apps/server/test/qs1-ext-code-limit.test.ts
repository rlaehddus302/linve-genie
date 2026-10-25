// QS1 확장 연결 코드 넣기 한도 (SPEC YT-10 AC4 "코드 넣기 한도", D-QS1-06): AC-QS1-14·15의 서버 몫.
// 주소마다 10분에 20번 · 서버 전체 10분에 3,000번 · 판매자가 코드를 만든 주소(믿는 주소, 10분·판매자마다 3개)는 전체 한도를 세지도 막지도 않는다.
// 주소 = TCP 연결 주소(시험은 요청 정보 env.incoming.socket.remoteAddress로 넣는다), 믿는 프록시 수만큼만 X-Forwarded-For를 본다.
import { afterEach, describe, expect, it } from 'vitest'
import { EXT_CODE_GLOBAL_MAX } from '../src/extension/routes.ts'
import { TRUSTED_PER_SELLER, TRUSTED_TTL_MS, TrustedAddresses } from '../src/extension/trusted.ts'
import { IP_MAX_ATTEMPTS, IP_TRACK_MAX, IpLimiter, ipKey } from '../src/login-limit.ts'
import { ORIGIN, addSeller, fakeClock, type Seller } from './support.ts'
import { youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(overrides: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(overrides)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const A = '203.0.113.7'
const B = '203.0.113.200'
const envOf = (address: string | null) => (address === null ? undefined : { incoming: { socket: { remoteAddress: address } } })

/** 판매자 화면에서 "확장 연결" 코드 만들기 (그 주소에서) */
async function issue(w: YoutubeWorld, seller: Seller, address: string | null, path: '/api/extension/code' | '/api/extension/renew' = '/api/extension/code', headers: Record<string, string> = {}): Promise<string> {
  const response = await w.server.app.request(path, { method: 'POST', headers: { Cookie: seller.cookie, Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: '{}' }, envOf(address))
  const text = await response.text()
  expect(response.status, text).toBe(200)
  return (JSON.parse(text) as { code: string }).code
}

/** 확장의 코드 넣기 (POST /ext/connect) */
async function enter(w: YoutubeWorld, address: string | null, code: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const response = await w.server.app.request('/ext/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ code }) }, envOf(address))
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text }
}

/** 형식이 틀린 코드 — 한도에는 세고 DB는 보지 않는다 */
const WRONG = 'x'

/** 믿는 주소가 아닌 주소 150개가 20번씩 = 서버 전체 3,000번을 다 쓴다. 모두 한도 안(400)이어야 한다 */
async function exhaustGlobal(w: YoutubeWorld, prefix = '198.51'): Promise<void> {
  const perAddress = IP_MAX_ATTEMPTS
  const addresses = EXT_CODE_GLOBAL_MAX / perAddress
  for (let i = 0; i < addresses; i += 1) {
    const address = `${prefix}.${String(Math.floor(i / 200))}.${String((i % 200) + 1)}`
    const results = await Promise.all(Array.from({ length: perAddress }, () => enter(w, address, WRONG)))
    for (const result of results) expect(result.status, result.text).toBe(400)
  }
}

describe('AC-QS1-14 확장 연결 코드 넣기 한도 (D-QS1-06)', () => {
  it('(a) 주소마다 10분에 20번 — 21번째는 429 EXT_CODE_LIMITED, 10분이 지나면 다시 받는다', async () => {
    const w = await world()
    for (let i = 0; i < IP_MAX_ATTEMPTS; i += 1) expect((await enter(w, A, WRONG)).status).toBe(400)
    const limited = await enter(w, A, WRONG)
    expect(limited.status).toBe(429)
    expect(limited.body).toMatchObject({ error: { code: 'EXT_CODE_LIMITED' } })
    // 다른 주소는 상관없다
    expect((await enter(w, B, WRONG)).status).toBe(400)
    await w.timer.advance(10 * 60 * 1000 + 1)
    expect((await enter(w, A, WRONG)).status).toBe(400)
  })

  it('(b)(c)(d) 전체 3,000번을 남이 다 써도 코드를 만든 주소는 맞는 코드로 잇는다 — 다른 주소는 맞는 코드여도 429, 믿는 주소의 시도는 전체에 세지 않고 주소 20번에는 센다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const code = await issue(w, seller, A)
    // 믿는 주소에서 틀린 코드 10번 — 전체 3,000번에 세지 않는다
    for (let i = 0; i < 10; i += 1) expect((await enter(w, A, WRONG)).status).toBe(400)
    // 남이 주소 150개로 3,000번 — 모두 받는다(A의 10번이 세였다면 마지막 10번이 429)
    await exhaustGlobal(w)
    // (b) 3,001번째 — 믿는 주소가 아닌 주소 B는 맞는 코드여도 429 (코드는 쓰이지 않는다)
    const other = await enter(w, B, code)
    expect(other.status).toBe(429)
    expect(other.body).toMatchObject({ error: { code: 'EXT_CODE_LIMITED' } })
    // (c) 주소 A에서 S의 맞는 코드 → 200과 토큰 (A의 11번째)
    const ok = await enter(w, A, code)
    expect(ok.status, ok.text).toBe(200)
    expect(typeof ok.body.token).toBe('string')
    // (d) 주소 A의 20번은 그대로 센다: 12~20번째는 받고 21번째는 429
    for (let i = 12; i <= IP_MAX_ATTEMPTS; i += 1) expect((await enter(w, A, WRONG)).status).toBe(400)
    expect((await enter(w, A, WRONG)).status).toBe(429)
  }, 60_000)

  it('(e) 믿는 주소는 코드를 만든 뒤 10분 동안만 — 10분 1초 뒤엔 보통 주소라 전체 한도에 막힌다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await issue(w, seller, A)
    await w.timer.advance(TRUSTED_TTL_MS + 1000)
    await exhaustGlobal(w)
    expect((await enter(w, A, WRONG)).status).toBe(429)
    // 다시 만들기(renew)를 하면 다시 믿는 주소다
    await issue(w, seller, A, '/api/extension/renew')
    expect((await enter(w, A, WRONG)).status).toBe(400)
  }, 60_000)

  it('(f) 믿는 프록시 밖의 X-Forwarded-For 값으로는 믿는 주소가 되지 않는다 — 만들 때와 넣을 때 같은 주소 읽기', async () => {
    const w = await world({ overrides: { trustedProxies: 1 } })
    const seller = await addSeller(w)
    const proxy = '10.0.0.1'
    // 판매자: 프록시가 붙인 오른쪽 값이 A
    await issue(w, seller, proxy, '/api/extension/code', { 'X-Forwarded-For': A })
    await exhaustGlobal(w)
    // 공격자: 왼쪽에 A를 꾸며 넣어도 프록시가 붙인 진짜 주소(오른쪽)로 센다 → 믿는 주소가 아니다
    expect((await enter(w, proxy, WRONG, { 'X-Forwarded-For': `${A}, 192.0.2.9` })).status).toBe(429)
    // 프록시를 거친 진짜 A는 믿는 주소다
    expect((await enter(w, proxy, WRONG, { 'X-Forwarded-For': A })).status).toBe(400)
  }, 60_000)

  it('(f) 믿는 프록시가 0이면 X-Forwarded-For를 보지 않는다 — 머리글로 믿는 주소를 흉내 내지 못한다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await issue(w, seller, A)
    await exhaustGlobal(w)
    expect((await enter(w, B, WRONG, { 'X-Forwarded-For': A })).status).toBe(429)
  }, 60_000)

  it('(g) 연결 주소를 모르면 주소 한도 없이 전체 한도만, 코드를 만들어도 믿는 주소가 생기지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await issue(w, seller, null)
    for (let i = 0; i < IP_MAX_ATTEMPTS + 5; i += 1) expect((await enter(w, null, WRONG)).status).toBe(400)
    expect(w.server.extension.trustedAddresses.countFor(seller.sellerId)).toBe(0)
  })

  it('IPv6는 같은 /64가 한 키 — 코드를 만든 /64 안의 다른 주소도 믿는 주소, IPv4를 담은 IPv6 표기는 IPv4와 같다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await issue(w, seller, '2001:db8:1:2::10')
    await issue(w, seller, '::ffff:192.0.2.44')
    await exhaustGlobal(w)
    expect((await enter(w, '2001:db8:1:2:abcd::99', WRONG)).status).toBe(400)
    expect((await enter(w, '192.0.2.44', WRONG)).status).toBe(400)
    expect((await enter(w, '2001:db8:1:3::10', WRONG)).status).toBe(429)
  }, 60_000)
})

describe('AC-QS1-14 (e) 믿는 주소 보관 (TrustedAddresses)', () => {
  it('판매자마다 최근 3개 — 4번째 다른 주소에서 만들면 가장 오래된 주소가 빠진다. 같은 주소를 다시 만들면 새로 만든 때로 옮긴다', () => {
    let now = 0
    const trusted = new TrustedAddresses(() => now)
    trusted.remember('S', 'a')
    now += 1
    trusted.remember('S', 'b')
    now += 1
    trusted.remember('S', 'c')
    now += 1
    trusted.remember('S', 'a') // a를 가장 새것으로
    now += 1
    trusted.remember('S', 'd') // 가장 오래된 b가 빠진다
    expect(TRUSTED_PER_SELLER).toBe(3)
    expect(trusted.countFor('S')).toBe(3)
    expect(['a', 'b', 'c', 'd'].map((key) => trusted.has(key))).toEqual([true, false, true, true])
  })

  it('10분 동안만 — 10분이 되는 때부터 믿지 않는다. 다른 판매자의 믿는 주소와 섞이지 않는다', () => {
    let now = 1_000_000
    const trusted = new TrustedAddresses(() => now)
    trusted.remember('S', 'a')
    trusted.remember('Q', 'q1')
    trusted.remember('Q', 'q2')
    trusted.remember('Q', 'q3')
    trusted.remember('Q', 'q4')
    // Q가 넷을 만들어도 S의 a는 남는다
    expect(trusted.has('a')).toBe(true)
    expect(trusted.countFor('S')).toBe(1)
    expect(trusted.countFor('Q')).toBe(3)
    now += TRUSTED_TTL_MS - 1
    expect(trusted.has('a')).toBe(true)
    now += 1
    expect(trusted.has('a')).toBe(false)
    expect(trusted.countFor('S')).toBe(0)
  })

  it('한 판매자가 코드를 수십 번 다시 만들어도(주소를 바꿔 가며) 믿는 주소는 3개 이하', async () => {
    const w = await world()
    const seller = await addSeller(w)
    for (let i = 0; i < 30; i += 1) await issue(w, seller, `192.0.2.${String(i + 1)}`, i % 2 === 0 ? '/api/extension/code' : '/api/extension/renew')
    expect(w.server.extension.trustedAddresses.countFor(seller.sellerId)).toBe(3)
    expect(['192.0.2.28', '192.0.2.29', '192.0.2.30', '192.0.2.27'].map((address) => w.server.extension.trustedAddresses.has(ipKey(address)))).toEqual([true, true, true, false])
  })
})

describe('AC-QS1-32 주소 기록 밀어내기로 믿는 주소의 20번을 새로 받지 못한다 (TD-QS1-002, RA-QS1-02, D-QS1-06 (d))', () => {
  it('IpLimiter.allows는 세지도 기록하지도 않는다 — 막힌 주소는 false, 기록에 없는 주소는 true인데 기록이 늘지 않는다', () => {
    const clock = fakeClock()
    const limiter = new IpLimiter(clock, { ipMaxAttempts: 2, ipTrackMax: 3 })
    expect(limiter.allows('a')).toBe(true)
    expect(limiter.size).toBe(0)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.allows('a')).toBe(false)
    for (let i = 0; i < 10; i += 1) expect(limiter.allows(`n${String(i)}`)).toBe(true)
    expect(limiter.size).toBe(1)
    expect(limiter.allows(null)).toBe(true)
  })

  it('전체 한도에 막힌 요청은 주소 기록에 들어가지 않는다 — 전체 3,000번을 다 쓴 뒤 다른 /64 주소 1만 개로 밀어내도 믿는 주소 A의 21번째는 429', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await issue(w, seller, A)
    for (let i = 0; i < IP_MAX_ATTEMPTS; i += 1) expect((await enter(w, A, WRONG)).status).toBe(400)
    expect((await enter(w, A, WRONG)).status).toBe(429)
    let accepted = 0
    for (let i = 0; i < IP_TRACK_MAX; i += 500) {
      const results = await Promise.all(Array.from({ length: 500 }, (_, j) => enter(w, `2001:db8:${(i + j).toString(16)}:1::1`, WRONG)))
      accepted += results.filter((result) => result.status === 400).length
    }
    // 전체 한도까지만 받는다 (A의 시도는 전체에 세지 않았다)
    expect(accepted).toBe(EXT_CODE_GLOBAL_MAX)
    // 10분이 지나지 않았다 — A는 여전히 20번을 다 쓴 주소다
    expect((await enter(w, A, WRONG)).status).toBe(429)
    // 10분이 지나면 다시 받는다 (막힘이 영원하지 않다)
    await w.timer.advance(10 * 60 * 1000 + 1)
    expect((await enter(w, A, WRONG)).status).toBe(400)
  }, 60_000)

  it('주소 한도에 막힌 요청은 전체 한도를 쓰지 않는다 — 막힌 주소 B의 시도 수천 번 뒤에도 다른 주소는 받는다', async () => {
    const w = await world()
    for (let i = 0; i < IP_MAX_ATTEMPTS; i += 1) expect((await enter(w, B, WRONG)).status).toBe(400)
    const blocked = await Promise.all(Array.from({ length: EXT_CODE_GLOBAL_MAX }, () => enter(w, B, WRONG)))
    expect(blocked.every((result) => result.status === 429)).toBe(true)
    expect((await enter(w, A, WRONG)).status).toBe(400)
  }, 60_000)
})

describe('AC-QS1-15 기록하지 않는 것', () => {
  it('믿는 주소는 DB에 없고, 서버 로그에 코드·토큰·주소가 없다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const code = await issue(w, seller, A)
    for (let i = 0; i < IP_MAX_ATTEMPTS; i += 1) await enter(w, B, WRONG)
    expect((await enter(w, B, code)).status).toBe(429)
    const ok = await enter(w, A, code)
    expect(ok.status).toBe(200)
    const token = ok.body.token as string
    const logText = JSON.stringify(w.logs)
    for (const secret of [code, token, A, B, '203.0.113']) expect(logText).not.toContain(secret)
    // DB 어디에도 주소가 없다
    const tables = await w.database.pglite?.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`)
    for (const row of tables?.rows ?? []) {
      const dump = await w.database.pglite?.query<{ t: string }>(`select coalesce(string_agg(x::text, ' '), '') as t from "${row.table_name}" x`)
      expect(dump?.rows[0]?.t ?? '', row.table_name).not.toContain('203.0.113')
    }
  })
})

describe('TE-TTX-004 E2E 기동만 코드 넣기 주소 한도를 넓힌다 (운영 기본값은 그대로)', () => {
  it('extensionCodeLimits로 넓히면 한 주소 30번도 400 — 넓히지 않은 서버는 21번째 429 그대로', async () => {
    const wide = await world({ overrides: { extensionCodeLimits: { ipMaxAttempts: 1_000_000 } } })
    for (let i = 0; i < 30; i += 1) expect((await enter(wide, A, WRONG)).status).toBe(400)
    const plain = await world()
    for (let i = 0; i < IP_MAX_ATTEMPTS; i += 1) expect((await enter(plain, A, WRONG)).status).toBe(400)
    expect((await enter(plain, A, WRONG)).body).toMatchObject({ error: { code: 'EXT_CODE_LIMITED' } })
  })

  it('E2E 기동(src/e2e.ts)이 코드 넣기 주소 한도를 넓힌다 — 운영 기동(src/main.ts)은 넓히지 않는다', async () => {
    const { readFile } = await import('node:fs/promises')
    const e2e = await readFile(new URL('../src/e2e.ts', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    expect(e2e).toContain('extensionCodeLimits: { ipMaxAttempts: 1_000_000 }')
    expect(main).not.toContain('extensionCodeLimits')
  })
})
