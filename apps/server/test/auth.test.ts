// AC-S04-40 로그인·세션, AC-S04-41 요청 보호(CSRF·CORS), AC-S04-42 판매자 격리
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { Auth, LOCK_AFTER_FAILURES, LOCK_MS, SESSION_EXTEND_AFTER_MS, SESSION_TTL_MS } from '../src/auth.ts'
import type { Db } from '../src/db/database.ts'
import type { LogRecord } from '../src/log.ts'
import { loginLimitKey, loginLimitSecret } from '../src/secrets.ts'
import { FAST_COST, ORIGIN, addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, fakeClock, login, newWorld, rid, startServer, writeEvent, type TestServer } from './support.ts'

const loginRequest = (world: TestServer, loginId: string, password: string) =>
  world.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, password }) })

describe('AC-S04-40 계정 만들기', () => {
  it('판매자·아이디·비밀번호로 만들고 비밀번호는 scrypt 해시로만 저장한다. 가입 API는 없다', async () => {
    const world = await newWorld()
    const created = await createSellerAccount(world.database.db, Buffer.from(world.masterKey, 'base64'), { shopName: '다육 가게', loginId: 'Shop.One', password: 'plain-secret-9' }, { passwordCost: FAST_COST })
    expect(created).toMatchObject({ ok: true, loginId: 'shop.one' })
    const row = (await world.database.pglite?.query<{ password_hash: string; login_id: string }>(`select password_hash, login_id from accounts`))?.rows[0]
    expect(row?.password_hash).toMatch(/^scrypt\$/)
    expect(row?.password_hash).not.toContain('plain-secret-9')
    expect((await world.server.app.request('/api/signup', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    expect((await world.server.app.request('/api/accounts', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    // 같은 아이디·형식이 틀린 값
    for (const input of [
      { shopName: 'x', loginId: 'shop.one', password: 'plain-secret-9' },
      { shopName: '', loginId: 'shop2', password: 'plain-secret-9' },
      { shopName: 'x', loginId: '1abc', password: 'plain-secret-9' },
      { shopName: 'x', loginId: 'ab', password: 'plain-secret-9' },
      { shopName: 'x', loginId: 'shop3', password: 'short' },
    ]) {
      const result = await createSellerAccount(world.database.db, Buffer.from(world.masterKey, 'base64'), input, { passwordCost: FAST_COST })
      expect(result.ok, JSON.stringify(input)).toBe(false)
      if (!result.ok) expect(result.message).not.toContain(input.password)
    }
  })
})

describe('AC-S04-40 로그인·세션', () => {
  it('성공: HttpOnly·Secure·SameSite=Lax·Path=/ 세션 쿠키(무작위 토큰), 서버엔 해시만, 30일', async () => {
    const world = await newWorld()
    const seller = await addSeller(world, 'cookieshop', 'pass-word-11')
    const response = await loginRequest(world, 'CookieShop', 'pass-word-11')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ seller: { name: '가게 cookieshop' }, loginId: 'cookieshop', role: 'SELLER' })
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^lj_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/)
    const token = /lj_session=([^;]+)/.exec(cookie)?.[1] ?? ''
    const rows = (await world.database.pglite?.query<{ token_hash: string; expires_at: Date }>(`select token_hash, expires_at from sessions`))?.rows ?? []
    expect(rows.map((row) => row.token_hash)).not.toContain(token)
    expect(rows.every((row) => row.expires_at.getTime() === world.clock.now() + SESSION_TTL_MS)).toBe(true)
    void seller
  })

  it('실패: 아이디 없음과 비밀번호 틀림이 같은 상태 코드·같은 본문', async () => {
    const world = await newWorld()
    await addSeller(world, 'realshop', 'pass-word-11')
    const wrongPassword = await loginRequest(world, 'realshop', 'pass-word-12')
    const noAccount = await loginRequest(world, 'ghostshop', 'pass-word-11')
    const badFormat = await loginRequest(world, '010-1234-5678', 'pass-word-11')
    expect(wrongPassword.status).toBe(401)
    expect(noAccount.status).toBe(401)
    expect(badFormat.status).toBe(401)
    const body = await wrongPassword.text()
    expect(await noAccount.text()).toBe(body)
    expect(await badFormat.text()).toBe(body)
    expect(wrongPassword.headers.get('set-cookie')).toBeNull()
  })

  it('같은 아이디로 연속 10번 틀리면 15분 동안 받지 않는다(맞는 비밀번호도 429). 이미 로그인한 세션은 그대로, 성공하면 실패 수 0', async () => {
    const world = await newWorld()
    const seller = await addSeller(world, 'lockshop', 'pass-word-11')
    for (let i = 0; i < 9; i++) expect((await loginRequest(world, 'lockshop', 'nope-nope')).status).toBe(401)
    // 9번 틀린 뒤 성공하면 실패 수가 0이 된다
    expect((await loginRequest(world, 'lockshop', 'pass-word-11')).status).toBe(200)
    for (let i = 0; i < 9; i++) expect((await loginRequest(world, 'lockshop', 'nope-nope')).status).toBe(401)
    expect((await loginRequest(world, 'lockshop', 'pass-word-11')).status).toBe(200)
    // 연속 10번
    for (let i = 0; i < 10; i++) expect((await loginRequest(world, 'lockshop', 'nope-nope')).status).toBe(401)
    const locked = await loginRequest(world, 'lockshop', 'pass-word-11')
    expect(locked.status).toBe(429)
    expect(await locked.json()).toEqual({ error: { code: 'LOGIN_LOCKED', message: '로그인을 여러 번 틀려서 잠시 막아 두었어요. 15분 뒤에 다시 해 주세요.' } })
    // 이미 로그인한 세션은 그대로 쓸 수 있다 (방송 중 쫓겨나지 않는다)
    expect((await client(world, seller.cookie).get('/api/me')).status).toBe(200)
    world.clock.advance(LOCK_MS - 1)
    expect((await loginRequest(world, 'lockshop', 'pass-word-11')).status).toBe(429)
    world.clock.advance(1)
    expect((await loginRequest(world, 'lockshop', 'pass-word-11')).status).toBe(200)
  })

  it('없는 아이디도 같은 규칙으로 잠긴다 (잠금으로 아이디가 있는지 알 수 없다)', async () => {
    const world = await newWorld()
    for (let i = 0; i < 10; i++) expect((await loginRequest(world, 'ghostshop', 'x-x-x-x-x')).status).toBe(401)
    expect((await loginRequest(world, 'ghostshop', 'x-x-x-x-x')).status).toBe(429)
    world.clock.advance(LOCK_MS)
    expect((await loginRequest(world, 'ghostshop', 'x-x-x-x-x')).status).toBe(401)
  })

  it('세션은 30일이고 쓰는 동안 연장된다. 만료·위조 토큰은 401', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    world.clock.advance(SESSION_EXTEND_AFTER_MS + 1)
    const extended = await api.get('/api/me')
    expect(extended.status).toBe(200)
    expect(extended.headers.get('set-cookie')).toMatch(/Max-Age=2592000/)
    world.clock.advance(SESSION_TTL_MS - 1000) // 처음 로그인에서 30일이 지났지만 연장됐다
    expect((await api.get('/api/me')).status).toBe(200)
    world.clock.advance(SESSION_TTL_MS + 1) // 마지막 사용에서 30일 넘게
    const expired = await api.get('/api/me')
    expect(expired.status).toBe(401)
    expect(expired.body).toEqual({ error: { code: 'UNAUTHORIZED', message: '로그인이 필요해요.' } })
    for (const cookie of ['lj_session=forged-token-forged-token-forged-token-xx', 'lj_session=', 'lj_session=a;b', 'other=1']) {
      expect((await client(world, cookie).get('/api/me')).status).toBe(401)
    }
  })

  it('로그아웃: 서버에서 세션을 지우고 쿠키를 지운다. 그 토큰으로 다시 요청하면 401', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await login(world, seller.loginId, seller.password)
    const response = await client(world, seller.cookie).post('/api/logout', {})
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBe('lj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
    expect((await client(world, seller.cookie).get('/api/me')).status).toBe(401)
    expect((await client(world, other).get('/api/me')).status).toBe(200)
    expect(await countRows(world.database, 'sessions')).toBe(1)
  })

  it('/api의 로그인·헬스체크 밖 모든 경로는 세션 없이 401 JSON, 내 정보는 판매자 이름·아이디만', async () => {
    const world = await newWorld()
    const seller = await addSeller(world, 'meshop')
    const anonymous = client(world, null)
    for (const path of ['/api/me', '/api/settings', '/api/broadcasts', '/api/days', '/api/days/2026-10-19', '/api/days/2026-10-19/history', '/api/stream', '/api/nothing-here']) {
      const response = await anonymous.get(path)
      expect(response.status, path).toBe(401)
      expect(response.headers.get('content-type')).toBe('application/json')
    }
    for (const path of ['/api/logout', '/api/events', '/api/broadcasts', '/api/broadcasts/x/end']) expect((await anonymous.post(path, { requestId: rid() })).status, path).toBe(401)
    expect((await anonymous.get('/api/health')).body).toEqual({ status: 'ok' })
    expect((await client(world, seller.cookie).get('/api/me')).body).toEqual({ seller: { name: '가게 meshop' }, loginId: 'meshop', role: 'SELLER', assistant: null })
  })

  it('로그인 요청 형식: 아이디·비밀번호가 문자열이 아니거나 모르는 필드면 400', async () => {
    const world = await newWorld()
    const post = (body: unknown) => client(world, null).post('/api/login', body)
    expect((await post({ loginId: 'a' })).status).toBe(400)
    expect((await post({ loginId: 1, password: 'x' })).status).toBe(400)
    expect((await post({ loginId: 'a', password: 'b', remember: true })).status).toBe(400)
  })
})

describe('AC-S04-40 로그인 잠금 — 동시 요청·긴 비밀번호·재시작·정리 (SA-S04-001·002)', () => {
  const statuses = async (world: TestServer, loginId: string, passwords: readonly string[]) =>
    (await Promise.all(passwords.map((password) => loginRequest(world, loginId, password)))).map((response) => response.status)
  const limitRows = async (world: TestServer) =>
    ((await (world.database.pglite as PGlite).query<{ key: string; failures: number; locked_until: Date | null }>(`select key, failures, locked_until from login_limits order by key`)).rows)

  it('틀린 비밀번호 30개를 한꺼번에 보내도 비밀번호는 10번까지만 확인하고 나머지는 429다 (있는 아이디·없는 아이디 같게)', async () => {
    const world = await newWorld()
    await addSeller(world, 'burstshop', 'pass-word-11')
    for (const loginId of ['burstshop', 'burstghost']) {
      const result = await statuses(world, loginId, Array.from({ length: 30 }, (_, i) => `guess-${String(i)}-pw`))
      expect(result.filter((status) => status === 401), loginId).toHaveLength(LOCK_AFTER_FAILURES)
      expect(result.filter((status) => status === 429), loginId).toHaveLength(30 - LOCK_AFTER_FAILURES)
      // 잠긴 뒤엔 맞는 비밀번호도 429
      expect((await loginRequest(world, loginId, 'pass-word-11')).status, loginId).toBe(429)
    }
  })

  it('한꺼번에 보낸 틀린 15개 뒤의 맞는 비밀번호는 429, 틀린 5개 뒤의 맞는 비밀번호는 200이고 그 뒤 실패 수는 확인 중이던 것만 남는다', async () => {
    const world = await newWorld()
    await addSeller(world, 'mixshop', 'pass-word-11')
    const late = await statuses(world, 'mixshop', [...Array.from({ length: 15 }, (_, i) => `guess-${String(i)}-pw`), 'pass-word-11'])
    expect(late.at(-1)).toBe(429)
    world.clock.advance(LOCK_MS)
    const early = await statuses(world, 'mixshop', [...Array.from({ length: 5 }, (_, i) => `guess-${String(i)}-pw`), 'pass-word-11'])
    expect(early).toEqual([401, 401, 401, 401, 401, 200])
    // 차례대로 온 시도라 성공 뒤 남은 실패 수는 0 (행이 없다) — 다시 10번 틀려야 잠긴다
    expect(await limitRows(world)).toEqual([])
    for (let i = 0; i < LOCK_AFTER_FAILURES - 1; i++) expect((await loginRequest(world, 'mixshop', 'nope-nope')).status).toBe(401)
    expect((await loginRequest(world, 'mixshop', 'pass-word-11')).status).toBe(200)
  })

  it('맞는 비밀번호보다 먼저 잡힌 실패는 지워지고, 뒤에 잡힌 실패는 남는다 (차례대로 온 것과 같은 결과)', async () => {
    const world = await newWorld()
    await addSeller(world, 'ordershop', 'pass-word-11')
    // 틀림 3 · 맞음 · 틀림 4 를 한꺼번에: 차례대로였다면 성공 뒤 연속 실패는 4
    const result = await statuses(world, 'ordershop', ['w1-w1-w1', 'w2-w2-w2', 'w3-w3-w3', 'pass-word-11', 'w4-w4-w4', 'w5-w5-w5', 'w6-w6-w6', 'w7-w7-w7'])
    expect(result).toEqual([401, 401, 401, 200, 401, 401, 401, 401])
    const rows = await limitRows(world)
    expect(rows.map((row) => [row.failures, row.locked_until])).toEqual([[4, null]])
    // 6번 더 틀리면 연속 10번 → 잠김
    for (let i = 0; i < 6; i++) expect((await loginRequest(world, 'ordershop', 'nope-nope')).status).toBe(401)
    expect((await loginRequest(world, 'ordershop', 'pass-word-11')).status).toBe(429)
  })

  it('200자를 넘는 비밀번호도 있는 아이디의 실패로 센다 — 있는 아이디와 없는 아이디의 응답이 매번 같다', async () => {
    const world = await newWorld()
    await addSeller(world, 'longshop', 'pass-word-11')
    const sequence = [...Array.from({ length: 9 }, () => 'x'.repeat(201)), 'y'.repeat(5000), 'wrong-password', 'pass-word-11']
    const seen: Record<string, number[]> = { longshop: [], longghost: [] }
    for (const password of sequence) {
      for (const loginId of ['longshop', 'longghost']) {
        const response = await loginRequest(world, loginId, password)
        seen[loginId]?.push(response.status)
      }
    }
    expect(seen.longshop).toEqual([...Array.from({ length: 10 }, () => 401), 429, 429])
    expect(seen.longghost).toEqual(seen.longshop)
    // 잠금이 끝나면 맞는 비밀번호로 들어간다
    world.clock.advance(LOCK_MS)
    expect((await loginRequest(world, 'longshop', 'pass-word-11')).status).toBe(200)
  })

  it('잠금은 DB에 있어 서버를 다시 띄워도(다른 인스턴스) 있는 아이디·없는 아이디 모두 그대로다', async () => {
    const world = await newWorld()
    await addSeller(world, 'restartshop', 'pass-word-11')
    for (const loginId of ['restartshop', 'restartghost']) {
      for (let i = 0; i < LOCK_AFTER_FAILURES; i++) expect((await loginRequest(world, loginId, 'nope-nope')).status).toBe(401)
    }
    const again = startServer(world.database, world.masterKey, { clock: world.clock })
    for (const loginId of ['restartshop', 'restartghost']) expect((await loginRequest(again, loginId, 'pass-word-11')).status, loginId).toBe(429)
    // 9번 틀린 상태도 이어진다
    world.clock.advance(LOCK_MS)
    for (const loginId of ['restartshop', 'restartghost']) {
      for (let i = 0; i < LOCK_AFTER_FAILURES - 1; i++) expect((await loginRequest(world, loginId, 'nope-nope')).status).toBe(401)
    }
    const third = startServer(world.database, world.masterKey, { clock: world.clock })
    for (const loginId of ['restartshop', 'restartghost']) {
      expect((await loginRequest(third, loginId, 'nope-nope')).status, loginId).toBe(401)
      expect((await loginRequest(third, loginId, 'pass-word-11')).status, loginId).toBe(429)
    }
  })

  it('잠긴 동안의 시도는 실패 수를 바꾸지 않고, 잠금이 끝난 뒤 처음 시도부터 1로 다시 센다', async () => {
    const world = await newWorld()
    await addSeller(world, 'windowshop', 'pass-word-11')
    for (let i = 0; i < LOCK_AFTER_FAILURES; i++) await loginRequest(world, 'windowshop', 'nope-nope')
    const lockedRow = await limitRows(world)
    for (let i = 0; i < 5; i++) expect((await loginRequest(world, 'windowshop', 'nope-nope')).status).toBe(429)
    expect(await limitRows(world)).toEqual(lockedRow)
    expect(lockedRow[0]?.locked_until?.getTime()).toBe(world.clock.now() + LOCK_MS)
    world.clock.advance(LOCK_MS)
    expect((await loginRequest(world, 'windowshop', 'nope-nope')).status).toBe(401)
    expect((await limitRows(world)).map((row) => [row.failures, row.locked_until])).toEqual([[1, null]])
  })

  it('시도 수 표에는 아이디 원문이 없다 — 마스터 키에서 나눈 키의 HMAC만 (아이디 칸에 전화번호를 적어도)', async () => {
    const world = await newWorld()
    for (const loginId of ['010-2468-1357', 'PlainShop']) await loginRequest(world, loginId, 'nope-nope')
    const dump = await dumpAllTables(world.database)
    for (const needle of ['010-2468-1357', '01024681357', '2468', 'plainshop', 'PlainShop']) expect(dump, needle).not.toContain(needle)
    const secret = loginLimitSecret(Buffer.from(world.masterKey, 'base64'))
    expect((await limitRows(world)).map((row) => row.key).sort()).toEqual([loginLimitKey(secret, '010-2468-1357'), loginLimitKey(secret, 'plainshop')].sort())
    // 다른 마스터 키면 다른 키 (DB만으로 아이디를 맞춰 볼 수 없다)
    expect(loginLimitKey(loginLimitSecret(Buffer.alloc(32, 7)), 'plainshop')).not.toBe(loginLimitKey(secret, 'plainshop'))
  })

  it('정리: 잠기지 않은 행이 많으면 오래된 것부터 지우되 잠긴 행은 잠금이 끝날 때까지 두고, 있는 아이디·없는 아이디를 가리지 않는다', async () => {
    const world = await newWorld()
    const masterKey = Buffer.from(world.masterKey, 'base64')
    await createSellerAccount(world.database.db, masterKey, { shopName: 'x', loginId: 'pruneshop', password: 'pass-word-11' }, { passwordCost: FAST_COST })
    const clock = fakeClock(world.clock.now())
    const auth = new Auth({ db: world.database.db, clock, limitSecret: loginLimitSecret(masterKey), passwordCost: FAST_COST, pruneEvery: 1, limitKeep: 2 })
    for (let i = 0; i < LOCK_AFTER_FAILURES; i++) expect((await auth.login('lockedghost', 'nope-nope')).kind).toBe('failed')
    clock.advance(1000)
    for (const loginId of ['pruneshop', 'pruneghost']) {
      expect((await auth.login(loginId, 'nope-nope')).kind).toBe('failed')
      clock.advance(1000)
    }
    // 새 아이디 둘이 더 오면 잠기지 않은 행은 최근 2개만 남는다: pruneshop·pruneghost의 실패 1번이 함께 잊힌다
    for (const loginId of ['newer-a', 'newer-b', 'newer-c']) {
      await auth.login(loginId, 'nope-nope')
      clock.advance(1000)
    }
    const secret = loginLimitSecret(masterKey)
    const keys = new Set((await limitRows(world)).map((row) => row.key))
    expect(keys.has(loginLimitKey(secret, 'lockedghost'))).toBe(true)
    expect(keys.has(loginLimitKey(secret, 'pruneshop'))).toBe(keys.has(loginLimitKey(secret, 'pruneghost')))
    expect(keys.has(loginLimitKey(secret, 'pruneshop'))).toBe(false)
    expect((await auth.login('lockedghost', 'nope-nope')).kind).toBe('locked')
    // 잠금이 끝난 행은 정리 때 지운다 (없는 것과 같다 — 다음 시도가 1부터)
    clock.advance(LOCK_MS)
    await auth.login('newer-c', 'nope-nope')
    expect(new Set((await limitRows(world)).map((row) => row.key)).has(loginLimitKey(secret, 'lockedghost'))).toBe(false)
    expect((await auth.login('lockedghost', 'nope-nope')).kind).toBe('failed')
  })

  it('정리하지 못해도 로그인은 계속하고 종류만 기록한다', async () => {
    const world = await newWorld()
    const logs: LogRecord[] = []
    const failingDelete = new Proxy(world.database.db, {
      get(target, property) {
        if (property === 'delete') {
          return () => {
            throw new RangeError('정리 실패 주입')
          }
        }
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    }) as Db
    const auth = new Auth({ db: failingDelete, clock: world.clock, limitSecret: loginLimitSecret(Buffer.from(world.masterKey, 'base64')), passwordCost: FAST_COST, pruneEvery: 1, log: (record) => logs.push(record) })
    expect((await auth.login('someone', 'nope-nope')).kind).toBe('failed')
    expect(logs).toEqual([{ level: 'warn', code: 'LOGIN_PRUNE_FAILED', errorKind: 'RangeError' }])
  })
})

describe('AC-S04-41 요청 보호 (CSRF·CORS)', () => {
  it('상태를 바꾸는 요청의 Origin이 없거나 다르면 403, 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const body = JSON.stringify({ requestId: rid(), type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })
    for (const origin of [undefined, 'https://evil.example', 'null', `${ORIGIN}/`, ORIGIN.replace('https', 'http'), `${ORIGIN}.evil.example`]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await world.server.app.request('/api/events', {
          method,
          headers: { Cookie: seller.cookie, 'Content-Type': 'application/json', ...(origin === undefined ? {} : { Origin: origin }) },
          body,
        })
        expect(response.status, `${method} ${String(origin)}`).toBe(403)
        expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN_ORIGIN', message: '허용하지 않은 곳에서 온 요청이에요.' } })
      }
    }
    // 로그인도 같은 검사 (로그인 CSRF)
    expect((await world.server.app.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: seller.loginId, password: seller.password }) })).status).toBe(403)
    expect(await countRows(world.database, 'events')).toBe(1)
  })

  it('본문이 JSON이 아니면(Content-Type·깨진 JSON·객체 아님) 4xx, 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const valid = JSON.stringify({ requestId: rid(), type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })
    const send = (contentType: string | undefined, body: string) =>
      world.server.app.request('/api/events', { method: 'POST', headers: { Cookie: seller.cookie, Origin: ORIGIN, ...(contentType === undefined ? {} : { 'Content-Type': contentType }) }, body })
    for (const [contentType, body] of [
      [undefined, valid],
      ['text/plain', valid],
      ['application/x-www-form-urlencoded', 'requestId=a&type=product.register'],
      ['multipart/form-data; boundary=x', valid],
      ['application/json', '{"requestId": "a",'],
      ['application/json', '[1,2]'],
      ['application/json', '"text"'],
      ['application/json', 'null'],
      ['application/json', ''],
    ] as const) {
      const response = await send(contentType, body)
      expect(response.status, `${String(contentType)} ${body}`).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('NOT_JSON')
    }
    expect((await send('application/json; charset=utf-8', valid)).status).toBe(200)
    expect(await countRows(world.database, 'events')).toBe(2)
  })

  it('다른 출처를 허용하는 CORS 헤더가 없다 (사전 요청·보통 요청 모두)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const responses = [
      await world.server.app.request('/api/me', { headers: { Cookie: seller.cookie, Origin: 'https://evil.example' } }),
      await world.server.app.request('/api/events', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } }),
      await world.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: seller.loginId, password: seller.password }) }),
      await world.server.app.request('/health', { headers: { Origin: 'https://evil.example' } }),
    ]
    for (const response of responses) {
      for (const [name] of response.headers) expect(name.toLowerCase().startsWith('access-control-'), name).toBe(false)
    }
  })
})

describe('AC-S04-42 판매자 격리', () => {
  it('B의 세션으로 A의 방송·범위·이벤트 쓰기·조회·이력·끝내기를 시도하면 모두 404, A의 데이터는 그대로', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    const aBroadcast = await createBroadcast(world, a)
    await expectOk(writeEvent(world, a, { type: 'product.register', b: aBroadcast.id, no: 1, name: 'A의 상품', price: 1000 }))
    const before = (await client(world, a.cookie).get(`/api/days/${aBroadcast.date}`)).body
    const intruder = client(world, b.cookie)
    const attempts = [
      await intruder.get(`/api/days/${aBroadcast.date}`),
      await intruder.get(`/api/days/${aBroadcast.date}/history`),
      await intruder.post(`/api/broadcasts/${aBroadcast.id}/end`, { requestId: rid() }),
      await intruder.post('/api/events', { requestId: rid(), type: 'product.register', b: aBroadcast.id, no: 2, name: 'x', price: 1 }),
      await intruder.post('/api/events', { requestId: rid(), type: 'sms', b: aBroadcast.id, no: 1 }),
      await intruder.post(`/api/events?date=${aBroadcast.date}`, { requestId: rid(), type: 'host.blockBuyer', buyer: 'UC1', reason: 'x' }),
    ]
    for (const response of attempts) {
      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } })
    }
    // 없는 방송과 같은 응답 (있는지 알 수 없다)
    expect((await intruder.post('/api/broadcasts/b_doesnotexist/end', { requestId: rid() })).body).toEqual(attempts[2]?.body)
    expect((await client(world, a.cookie).get(`/api/days/${aBroadcast.date}`)).body).toEqual(before)
    expect((await intruder.get('/api/broadcasts')).body).toEqual({ broadcasts: [] })
    expect((await intruder.get('/api/days')).body).toEqual({ days: [] })
  })

  it('두 판매자가 같은 요청 번호·메시지 ID·날짜를 써도 서로 영향이 없다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    const ra = await expectOk(client(world, a.cookie).post('/api/broadcasts', { requestId: 'shared-1', date: '2026-10-19' }))
    const rb = await expectOk(client(world, b.cookie).post('/api/broadcasts', { requestId: 'shared-1', date: '2026-10-19' }))
    const ba = (ra.body.broadcast as { id: string }).id
    const bb = (rb.body.broadcast as { id: string }).id
    expect(ba).not.toBe(bb)
    expect(ra.body.seq).toBe(1)
    expect(rb.body.seq).toBe(1)
    await expectOk(client(world, a.cookie).post('/api/events', { requestId: 'shared-2', type: 'product.register', b: ba, no: 1, name: 'a', price: 1 }))
    await expectOk(client(world, b.cookie).post('/api/events', { requestId: 'shared-2', type: 'product.register', b: bb, no: 1, name: 'b', price: 1 }))
    expect(await world.server.ingestChat(a.sellerId, { b: ba, id: 'same-msg', ch: 'UC1', nick: 'n', text: '1' })).toMatchObject({ status: 'recorded' })
    expect(await world.server.ingestChat(b.sellerId, { b: bb, id: 'same-msg', ch: 'UC1', nick: 'n', text: '1' })).toMatchObject({ status: 'recorded' })
    const viewA = (await client(world, a.cookie).get('/api/days/2026-10-19')).body
    const viewB = (await client(world, b.cookie).get('/api/days/2026-10-19')).body
    expect((viewA.products as { name: string }[]).map((p) => p.name)).toEqual(['a'])
    expect((viewB.products as { name: string }[]).map((p) => p.name)).toEqual(['b'])
    expect(viewA.seq).toBe(3)
    expect(viewB.seq).toBe(3)
  })
})
