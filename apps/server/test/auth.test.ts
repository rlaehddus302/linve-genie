// AC-S04-40 로그인·세션, AC-S04-41 요청 보호(CSRF·CORS), AC-S04-42 판매자 격리
import { describe, expect, it } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { LOCK_MS, SESSION_EXTEND_AFTER_MS, SESSION_TTL_MS } from '../src/auth.ts'
import { FAST_COST, ORIGIN, addSeller, client, countRows, createBroadcast, expectOk, login, newWorld, rid, writeEvent, type TestServer } from './support.ts'

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
    expect(await response.json()).toEqual({ seller: { name: '가게 cookieshop' }, loginId: 'cookieshop' })
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
    expect((await client(world, seller.cookie).get('/api/me')).body).toEqual({ seller: { name: '가게 meshop' }, loginId: 'meshop' })
  })

  it('로그인 요청 형식: 아이디·비밀번호가 문자열이 아니거나 모르는 필드면 400', async () => {
    const world = await newWorld()
    const post = (body: unknown) => client(world, null).post('/api/login', body)
    expect((await post({ loginId: 'a' })).status).toBe(400)
    expect((await post({ loginId: 1, password: 'x' })).status).toBe(400)
    expect((await post({ loginId: 'a', password: 'b', remember: true })).status).toBe(400)
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
