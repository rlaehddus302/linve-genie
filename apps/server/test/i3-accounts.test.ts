// AC-I3-47·50·60~62·97 보조자 계정·가게 이름·시작 마법사 (SYS-04, UX-02, D-I3-09~D-I3-11).
// 보조자: 판매자가 만들고(서버가 아이디·비밀번호를 만들어 한 번만 보임, 5명까지) 지운다. 보조자 세션은 허용 목록 밖이 모두 403(기본 거부)이고 아무것도 기록하지 않는다.
import type { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { LOGIN_ID_RE, createSellerAccount } from '../src/accounts.ts'
import { formatLog } from '../src/log.ts'
import {
  ORIGIN,
  addSeller,
  client,
  createBroadcast,
  countRows,
  expectOk,
  login,
  newWorld,
  rid,
  sseReader,
  writeEvent,
  type Seller,
  type TestServer,
} from './support.ts'

const worlds: TestServer[] = []
async function world(): Promise<TestServer> {
  const created = await newWorld()
  worlds.push(created)
  return created
}
afterEach(() => {
  for (const item of worlds.splice(0)) item.server.close()
})

const FORBIDDEN = { error: { code: 'ASSISTANT_FORBIDDEN', message: '보조자 계정으로는 할 수 없는 일이에요.' } }

interface Created {
  readonly assistant: { id: string; name: string; loginId: string; createdAt: string }
  readonly password: string
}

async function createAssistant(w: TestServer, seller: Seller, name = '엄마'): Promise<Created> {
  const response = await client(w, seller.cookie).post('/api/assistants', { name })
  expect(response.status, response.text).toBe(200)
  return response.body as unknown as Created
}

/** 보조자를 만들고 그 계정으로 로그인한 세션 */
async function assistantSession(w: TestServer, seller: Seller, name = '엄마'): Promise<Seller & { id: string }> {
  const created = await createAssistant(w, seller, name)
  const cookie = await login(w, created.assistant.loginId, created.password)
  return { sellerId: seller.sellerId, accountId: created.assistant.id, id: created.assistant.id, loginId: created.assistant.loginId, password: created.password, cookie }
}

const pg = (w: TestServer) => w.database.pglite as PGlite

describe('AC-I3-60 보조자 만들기·목록', () => {
  it('서버가 아이디(LOGIN_ID_RE)·비밀번호(16자 이상, 헷갈리는 글자 없음)를 만들어 그 응답에만 담는다 — DB엔 scrypt 해시만, 목록엔 이름·아이디·만든 때만', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const created = await createAssistant(w, seller, '  엄마  ')
    expect(created.assistant.name).toBe('엄마')
    expect(created.assistant.loginId).toMatch(LOGIN_ID_RE)
    expect(created.password.length).toBeGreaterThanOrEqual(16)
    expect(created.password).not.toMatch(/[0Oo1lI]/)
    expect(created.assistant.createdAt).toBe(new Date(w.clock.now()).toISOString())
    const rows = await pg(w).query<{ password_hash: string; role: string; name: string }>(`select password_hash, role, name from accounts where id = $1`, [created.assistant.id])
    expect(rows.rows[0]?.role).toBe('ASSISTANT')
    expect(rows.rows[0]?.password_hash.startsWith('scrypt$')).toBe(true)
    const dump = JSON.stringify((await pg(w).query(`select * from accounts`)).rows)
    expect(dump).not.toContain(created.password)
    const list = await client(w, seller.cookie).get('/api/assistants')
    expect(list.status).toBe(200)
    expect(list.body).toEqual({ assistants: [{ id: created.assistant.id, name: '엄마', loginId: created.assistant.loginId, createdAt: created.assistant.createdAt }], limit: 5 })
    expect(list.text).not.toContain(created.password)
    expect(list.text).not.toContain('scrypt')
    // 만든 아이디·비밀번호로 로그인된다
    await login(w, created.assistant.loginId, created.password)
  })

  it('비밀번호·아이디는 만들 때마다 다르다 (20번)', async () => {
    const w = await world()
    const sellers = await Promise.all(Array.from({ length: 4 }, () => addSeller(w)))
    const made: Created[] = []
    for (const seller of sellers) for (let i = 0; i < 5; i++) made.push(await createAssistant(w, seller, `보조${String(i)}`))
    expect(new Set(made.map((item) => item.password)).size).toBe(20)
    expect(new Set(made.map((item) => item.assistant.loginId)).size).toBe(20)
  })

  it('판매자마다 5명까지 — 여섯째는 409 ASSISTANT_LIMIT, 동시에 보내도 5명을 넘지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => client(w, seller.cookie).post('/api/assistants', { name: `보조${String(i)}` })))
    expect(results.filter((r) => r.status === 200)).toHaveLength(5)
    const refused = results.filter((r) => r.status === 409)
    expect(refused).toHaveLength(3)
    for (const r of refused) expect(r.body).toEqual({ error: { code: 'ASSISTANT_LIMIT', message: '보조자는 5명까지 만들 수 있어요.' } })
    expect(((await client(w, seller.cookie).get('/api/assistants')).body.assistants as unknown[]).length).toBe(5)
    // 다른 판매자는 따로 센다
    const other = await addSeller(w)
    await createAssistant(w, other)
  })

  it('이름이 틀리면 400 "보조자 이름은 1~20자로 적어 주세요." (빈칸·21자·줄바꿈·제어·방향 바꾸기·폭 없는 글자·글자가 아님)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    for (const name of ['', '   ', '가'.repeat(21), '엄\n마', '엄\u0007마', '엄\u202E마', '엄\u200B마', '엄\u2028마', '엄\u2029마', '엄\uD800마', '엄\uDC00', 3, null]) {
      const response = await api.post('/api/assistants', { name })
      expect(response.status, String(name)).toBe(400)
      expect(response.body).toEqual({ error: { code: 'INVALID_INPUT', message: '보조자 이름은 1~20자로 적어 주세요.', problems: [{ field: 'name', message: '보조자 이름은 1~20자로 적어 주세요.' }] } })
    }
    // 코드 포인트로 센다 (이모지 20개는 된다)
    expect((await api.post('/api/assistants', { name: '😀'.repeat(20) })).status).toBe(200)
    expect(await countRows(w.database, 'sessions')).toBe(1)
  })

  it('다른 판매자의 보조자는 목록에 없고 지우기는 404, 보조자 세션은 이 API를 못 쓴다(403)', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const mine = await createAssistant(w, a)
    expect((await client(w, b.cookie).get('/api/assistants')).body.assistants).toEqual([])
    expect((await client(w, b.cookie).post(`/api/assistants/${mine.assistant.id}/delete`, {})).status).toBe(404)
    expect((await client(w, a.cookie).post('/api/assistants/acc_none/delete', {})).status).toBe(404)
    // 판매자 계정 ID로 지우기도 404 (보조자만 지운다)
    expect((await client(w, a.cookie).post(`/api/assistants/${a.accountId}/delete`, {})).status).toBe(404)
    const helper = await login(w, mine.assistant.loginId, mine.password)
    for (const call of [() => client(w, helper).get('/api/assistants'), () => client(w, helper).post('/api/assistants', { name: '또' }), () => client(w, helper).post(`/api/assistants/${mine.assistant.id}/delete`, {})]) {
      const response = await call()
      expect(response.status).toBe(403)
      expect(response.body).toEqual(FORBIDDEN)
    }
  })

  it('로그에 아이디·비밀번호·이름이 남지 않는다 (D-073)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const created = await createAssistant(w, seller, '비밀이름')
    await login(w, created.assistant.loginId, created.password)
    await client(w, seller.cookie).post(`/api/assistants/${created.assistant.id}/delete`, {})
    const text = w.logs.map((record) => formatLog(record) + JSON.stringify(record)).join('\n')
    for (const value of [created.assistant.loginId, created.password, '비밀이름']) expect(text).not.toContain(value)
  })
})

describe('AC-I3-61 보조자 권한 — 허용 목록 밖은 기본으로 막힘', () => {
  /** 등록된 모든 /api 경로 (중간 처리기 제외), 경로 변수는 예시 값으로 */
  function allRoutes(w: TestServer): { method: string; path: string }[] {
    const seen = new Set<string>()
    const out: { method: string; path: string }[] = []
    for (const route of w.server.app.routes) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) continue
      if (!route.path.startsWith('/api/') || route.path.includes('*')) continue
      const path = route.path.replace(':date', '2026-10-19').replace(/:[A-Za-z]+/g, 'x1')
      const key = `${route.method} ${path}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ method: route.method, path })
    }
    return out
  }
  const ALLOWED = new Set([
    'GET /api/me',
    'GET /api/client-config',
    'GET /api/broadcasts',
    'GET /api/days',
    'GET /api/days/2026-10-19',
    'GET /api/days/2026-10-19/changes',
    'GET /api/stream',
    'POST /api/logout',
    'POST /api/events',
    // N2b-2(D-N2b-2-08, AC-N2b-2-59): 댓글 붙여넣기는 문자찜 입력과 같은 권한 — 보조자도 (실제 회차만). 바꾼 기존 시험(dev-notes)
    'POST /api/broadcasts/x1/paste/preview',
    'POST /api/broadcasts/x1/paste',
    // BND1(AC-BND1-15): 보조자는 회차의 밴드 연결 상태 보기만 된다. 바꾼 기존 시험(BND1 dev-notes)
    'GET /api/broadcasts/x1/band',
  ])
  /** 세션을 강제하지 않는 공개 경로 (로그인·헬스체크) — 보조자 쿠키가 있어도 그대로 */
  const PUBLIC = new Set(['POST /api/login', 'GET /api/health'])

  it('서버에 등록된 모든 경로를 보조자 세션으로 부르면 허용 목록만 403이 아니다 (나중에 더한 경로도 따로 막지 않아도 막힘)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const helper = await assistantSession(w, seller)
    const routes = allRoutes(w)
    expect(routes.length).toBeGreaterThan(30)
    for (const name of ALLOWED) expect(routes.some((route) => `${route.method} ${route.path}` === name), name).toBe(true)
    const before = await countRows(w.database, 'events')
    // 로그아웃은 맨 뒤에 (그 세션이 끝난다)
    routes.sort((x, y) => Number(x.path === '/api/logout') - Number(y.path === '/api/logout'))
    for (const route of routes) {
      const key = `${route.method} ${route.path}`
      if (PUBLIC.has(key)) continue
      // 이벤트 쓰기는 허용 종류(문자찜)로 — 요청 번호가 없어 400 (허용 목록 안이라 403이 아니다)
      const body = route.path === '/api/events' ? '{"type":"sms"}' : '{}'
      const init: RequestInit = route.method === 'GET' ? {} : { method: route.method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body }
      const response = await client(w, helper.cookie).raw(route.path, init)
      if (ALLOWED.has(key)) {
        expect(response.status, key).not.toBe(403)
        await response.body?.cancel()
      } else {
        expect(response.status, key).toBe(403)
        expect(await response.json(), key).toEqual(FORBIDDEN)
      }
    }
    expect(await countRows(w.database, 'events')).toBe(before)
    // 판매자 세션의 같은 경로는 403이 아니다 (회귀)
    for (const route of routes.filter((item) => item.method === 'GET' && item.path !== '/api/stream')) {
      expect((await client(w, seller.cookie).get(route.path)).status, route.path).not.toBe(403)
    }
  })

  it('받는 것: 내 정보(가게 이름 + 역할 보조자), 실제 범위 조회 — 리허설 범위(?rehearsal=true)는 403', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    await createBroadcast(w, seller, { rehearsal: true })
    const helper = await assistantSession(w, seller, '엄마')
    const api = client(w, helper.cookie)
    expect((await api.get('/api/me')).body).toEqual({ seller: { name: `가게 ${seller.loginId}` }, loginId: helper.loginId, role: 'ASSISTANT', assistant: { name: '엄마' } })
    expect((await api.get('/api/days')).status).toBe(200)
    expect((await api.get(`/api/days/${b.date}`)).status).toBe(200)
    expect((await api.get(`/api/days/${b.date}/changes?since=0`)).status).toBe(200)
    expect((await api.get(`/api/days/${b.date}?rehearsal=false`)).status).toBe(200)
    for (const path of ['/api/days?rehearsal=true', `/api/days/${b.date}?rehearsal=true`, `/api/days/${b.date}/changes?since=0&rehearsal=true`]) {
      const response = await api.get(path)
      expect(response.status, path).toBe(403)
      expect(response.body).toEqual(FORBIDDEN)
    }
    const broadcasts = await api.get('/api/broadcasts')
    expect(broadcasts.status).toBe(200)
  })

  it('이벤트: 실제 방송의 문자찜은 되고 조치자는 그 보조자 계정 — 리허설 방송의 문자찜·그 밖의 종류는 403이고 이벤트·요청 번호를 기록하지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    const r = await createBroadcast(w, seller, { rehearsal: true })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: r.id, no: 15, name: '핑크프릴', price: 10000 }))
    const helper = await assistantSession(w, seller)
    const api = client(w, helper.cookie)
    const ok = await api.post('/api/events', { requestId: 'as-sms-1', type: 'sms', b: b.id, no: 15, phone: '010-1234-5678', memo: '엄마가 받음' })
    expect(ok.status, ok.text).toBe(200)
    const actor = await pg(w).query<{ actor: string; account_id: string }>(`select actor, account_id from events where request_id = 'as-sms-1'`)
    expect(actor.rows).toEqual([{ actor: 'account', account_id: helper.id }])
    const before = await countRows(w.database, 'events')
    const refused = [
      { requestId: 'as-x-1', type: 'sms', b: r.id, no: 15, phone: '010-1234-5678' },
      { requestId: 'as-x-2', type: 'host.reject', b: b.id, no: 15, buyer: 'sms:x', reason: '장난' },
      { requestId: 'as-x-3', type: 'product.register', b: b.id, no: 16, name: '라울', price: 5000 },
      { requestId: 'as-x-4', type: 'product.close', b: b.id, no: 15 },
      { requestId: 'as-x-5', type: 'broadcast.end', b: b.id },
      { requestId: 'as-x-6', type: 'chat', b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '15' },
      { type: 'host.blockBuyer', buyer: 'UC1', reason: '장난' },
      { type: 'buyer.merge', from: 'a', into: 'b', reason: 'x' },
    ]
    for (const event of refused) {
      const response = await api.post(`/api/events${'b' in event ? '' : `?date=${b.date}`}`, event)
      expect(response.status, JSON.stringify(event)).toBe(403)
      expect(response.body).toEqual(FORBIDDEN)
    }
    for (const event of [{ requestId: 'as-x-7', type: 'settlement.payment', buyer: 'x', date: b.date, amount: 1000 }]) {
      expect((await api.post(`/api/events?date=${b.date}`, event)).status).toBe(403)
    }
    expect(await countRows(w.database, 'events')).toBe(before)
    // 403이었던 요청 번호는 기록되지 않았다 — 판매자가 같은 번호를 써도 새로 기록된다
    const reuse = await client(w, seller.cookie).post('/api/events', { requestId: 'as-x-3', type: 'product.register', b: b.id, no: 16, name: '라울', price: 5000 })
    expect(reuse.status).toBe(200)
    expect(reuse.body.type).toBe('product.register')
    // 보조자가 판매자의 그 요청 번호를 문자찜으로 보내도 판매자의 결과(상품 등록)를 돌려받지 못한다
    expect((await api.post('/api/events', { requestId: 'as-x-3', type: 'sms', b: b.id, no: 15 })).status).toBe(403)
  })

  it('방송자 취소: 그 번호에서 그 구매자의 지금 찜이 문자찜으로 생긴 찜일 때만 — 채팅 찜·없는 찜은 403(기록 없음), 조치자는 보조자', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000, stock: 2 }))
    const chat = await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'c1', ch: 'UCviewer1', nick: '시청자', text: '15' })
    expect(chat.status).toBe('recorded')
    const helper = await assistantSession(w, seller)
    const api = client(w, helper.cookie)
    const sms = await api.post('/api/events', { requestId: 'as-sms-2', type: 'sms', b: b.id, no: 15, phone: '010-2222-3333' })
    expect(sms.status, sms.text).toBe(200)
    const view = await client(w, seller.cookie).get(`/api/days/${b.date}`)
    const claims = view.body.claims as { buyer: string; origin: string; status: string }[]
    const smsBuyer = claims.find((claim) => claim.origin === 'sms')?.buyer as string
    expect(smsBuyer.startsWith('sms:')).toBe(true)
    const before = await countRows(w.database, 'events')
    // 채팅 찜의 취소 · 찜이 없는 구매자 · 다른 번호
    for (const event of [
      { type: 'host.cancel', b: b.id, no: 15, buyer: 'UCviewer1', reason: '취소' },
      { type: 'host.cancel', b: b.id, no: 15, buyer: 'sms:nobody', reason: '취소' },
      { type: 'host.cancel', b: b.id, no: 16, buyer: smsBuyer, reason: '취소' },
    ]) {
      const response = await api.post('/api/events', { requestId: rid('as-c'), ...event })
      expect(response.status, JSON.stringify(event)).toBe(403)
      expect(response.body).toEqual(FORBIDDEN)
    }
    expect(await countRows(w.database, 'events')).toBe(before)
    const cancelled = await api.post('/api/events', { requestId: 'as-cancel-ok', type: 'host.cancel', b: b.id, no: 15, buyer: smsBuyer, reason: '전화로 취소' })
    expect(cancelled.status, cancelled.text).toBe(200)
    expect(cancelled.body.changed).toBe(true)
    const actor = await pg(w).query<{ account_id: string }>(`select account_id from events where request_id = 'as-cancel-ok'`)
    expect(actor.rows[0]?.account_id).toBe(helper.id)
    // 판매자 세션은 채팅 찜도 취소한다 (회귀)
    expect((await writeEvent(w, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UCviewer1', reason: '취소' })).status).toBe(200)
  })

  it('보조자의 실시간 연결은 범위 변경 알림만 받는다 — 유튜브·리허설 생성기 알림은 판매자 연결에만', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const helper = await assistantSession(w, seller)
    const b = await createBroadcast(w, seller)
    const mine = sseReader(await w.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } }))
    const theirs = sseReader(await w.server.app.request('/api/stream', { headers: { Cookie: helper.cookie } }))
    await mine.until(() => mine.events.some((event) => event.event === 'ready'))
    await theirs.until(() => theirs.events.some((event) => event.event === 'ready'))
    w.server.hub.publishYoutube(seller.sellerId, { kind: 'connection', connection: { channel: { title: '비밀 채널' } } })
    w.server.hub.publishGenerator(seller.sellerId, { date: b.date, rehearsal: true, state: 'running' })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 1, name: '상품', price: 1000 }))
    await mine.until(() => mine.events.some((event) => event.event === 'change'))
    await theirs.until(() => theirs.events.some((event) => event.event === 'change'))
    expect(mine.events.map((event) => event.event)).toEqual(['ready', 'youtube', 'generator', 'change'])
    expect(theirs.events.map((event) => event.event)).toEqual(['ready', 'change'])
    expect(JSON.stringify(theirs.events)).not.toContain('비밀 채널')
    await mine.cancel()
    await theirs.cancel()
  })

  it('보조자 쿠키로 유튜브 돌아오는 주소(세션을 강제하지 않는 경로)도 403', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const helper = await assistantSession(w, seller)
    const response = await client(w, helper.cookie).get('/api/youtube/oauth/callback?code=x&state=y')
    expect(response.status).toBe(403)
    expect(response.body).toEqual(FORBIDDEN)
  })
})

describe('AC-I3-62 보조자 지우기', () => {
  it('지우면 다음 요청 401, 열린 실시간 연결은 1초 안에 닫히고, 로그인도 안 된다 — 남긴 기록(조치자)은 그대로, 같은 아이디는 다시 만들어지지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    const helper = await assistantSession(w, seller)
    const second = await login(w, helper.loginId, helper.password)
    expect((await client(w, helper.cookie).post('/api/events', { requestId: 'del-sms', type: 'sms', b: b.id, no: 15 })).status).toBe(200)
    const stream = await w.server.app.request('/api/stream', { headers: { Cookie: second } })
    expect(stream.status).toBe(200)
    const sse = sseReader(stream)
    await sse.until(() => sse.events.some((event) => event.event === 'ready'))
    const started = Date.now()
    const deleted = await client(w, seller.cookie).post(`/api/assistants/${helper.id}/delete`, {})
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ ok: true })
    await sse.done
    expect(sse.closed).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
    for (const cookie of [helper.cookie, second]) {
      const response = await client(w, cookie).get('/api/me')
      expect(response.status).toBe(401)
    }
    const relogin = await w.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: helper.loginId, password: helper.password }) })
    expect(relogin.status).toBe(401)
    expect(await countRows(w.database, 'sessions')).toBe(1)
    // 기록은 그대로 — 변경 이력의 조치자 아이디도
    const history = await client(w, seller.cookie).get(`/api/days/${b.date}/history`)
    const sms = (history.body.events as { type: string; actor: { kind: string; loginId: string | null } }[]).find((event) => event.type === 'sms')
    expect(sms?.actor).toEqual({ kind: 'account', loginId: helper.loginId })
    expect((await client(w, seller.cookie).get('/api/assistants')).body.assistants).toEqual([])
    // 같은 아이디로 계정을 다시 만들 수 없다 (지운 계정의 아이디도 쓴 것)
    const again = await createSellerAccount(w.database.db, Buffer.from(w.masterKey, 'base64'), { shopName: '다른 가게', loginId: helper.loginId, password: 'another-pass-1' })
    expect(again).toEqual({ ok: false, message: '이미 있는 아이디예요.' })
    // 다시 지우면 404
    expect((await client(w, seller.cookie).post(`/api/assistants/${helper.id}/delete`, {})).status).toBe(404)
    // 지운 뒤에는 6번째까지 다시 만들 수 있다 (지운 보조자는 세지 않는다)
    for (let i = 0; i < 5; i++) await createAssistant(w, seller, `새${String(i)}`)
  })
})

describe('AC-I3-47 가게 이름', () => {
  it('앞뒤 공백을 뺀 1~30자(코드 포인트)면 저장하고 내 정보에 보인다 — 휴대폰 번호 검사는 하지 않는다, 그 판매자 이름만 바뀐다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const api = client(w, a.cookie)
    const saved = await api.put('/api/shop', { name: '  구피네 가게  ' })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body).toEqual({ shop: { name: '구피네 가게' } })
    expect(saved.headers.get('cache-control')).toBe('no-store')
    expect(((await api.get('/api/me')).body.seller as { name: string }).name).toBe('구피네 가게')
    expect(((await client(w, b.cookie).get('/api/me')).body.seller as { name: string }).name).toBe(`가게 ${b.loginId}`)
    expect((await api.put('/api/shop', { name: '구피 010-1234-5678' })).status).toBe(200)
    expect((await api.put('/api/shop', { name: '🐟'.repeat(30) })).status).toBe(200)
    // 가운데의 줄 나눔(U+2028)·문단 나눔(U+2029)도 줄바꿈이고, 짝 없는 서로게이트는 글자가 아니다 (SA-I3-007)
    for (const name of ['', '  ', '가'.repeat(31), '🐟'.repeat(31), '구피\n가게', '구피\t가게', '구피\u202E가게', '구\uFEFF피', '구피\u2028가게', '구피\u2029가게', '구피\uD800가게', '\uDFFF구피', 7, null, ['a']]) {
      const response = await api.put('/api/shop', { name })
      expect(response.status, JSON.stringify(name)).toBe(400)
      expect(response.body).toEqual({ error: { code: 'INVALID_INPUT', message: '가게 이름은 1~30자로 적어 주세요.', problems: [{ field: 'name', message: '가게 이름은 1~30자로 적어 주세요.' }] } })
    }
    expect(((await api.get('/api/me')).body.seller as { name: string }).name).toBe('🐟'.repeat(30))
    // 로그에 이름이 남지 않는다
    expect(w.logs.map((record) => JSON.stringify(record)).join('\n')).not.toContain('구피')
  })

  it('보조자는 바꿀 수 없다(403), 보조자의 내 정보에도 바뀐 가게 이름이 보인다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const helper = await assistantSession(w, seller)
    expect((await client(w, helper.cookie).put('/api/shop', { name: '보조자가 바꿈' })).status).toBe(403)
    await expectOk(client(w, seller.cookie).put('/api/shop', { name: '새 이름' }))
    expect(((await client(w, helper.cookie).get('/api/me')).body.seller as { name: string }).name).toBe('새 이름')
  })
})

describe('AC-I3-50 시작 마법사 상태', () => {
  it('처음 만든 판매자는 NEW — 진행 중(단계)·마침·닫음을 적고 읽는다, 모르는 값은 400', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    expect((await api.get('/api/wizard')).body).toEqual({ wizard: { status: 'NEW', step: null } })
    for (const step of [1, 3, 5]) {
      const saved = await api.put('/api/wizard', { status: 'IN_PROGRESS', step })
      expect(saved.status, saved.text).toBe(200)
      expect(saved.body).toEqual({ wizard: { status: 'IN_PROGRESS', step } })
    }
    expect((await api.get('/api/wizard')).body).toEqual({ wizard: { status: 'IN_PROGRESS', step: 5 } })
    expect((await api.put('/api/wizard', { status: 'DISMISSED' })).body).toEqual({ wizard: { status: 'DISMISSED', step: null } })
    expect((await api.put('/api/wizard', { status: 'DONE', step: null })).body).toEqual({ wizard: { status: 'DONE', step: null } })
    for (const input of [
      { status: 'OPEN' },
      { status: 'IN_PROGRESS' },
      { status: 'IN_PROGRESS', step: 0 },
      { status: 'IN_PROGRESS', step: 6 },
      { status: 'IN_PROGRESS', step: 1.5 },
      { status: 'IN_PROGRESS', step: '2' },
      { status: 'DONE', step: 2 },
      { status: 'done' },
      { step: 1 },
      {},
    ]) {
      const response = await api.put('/api/wizard', input)
      expect(response.status, JSON.stringify(input)).toBe(400)
      expect((response.body.error as { code: string; message: string }).message).toBe('마법사 상태를 확인해 주세요.')
    }
    expect((await api.get('/api/wizard')).body).toEqual({ wizard: { status: 'DONE', step: null } })
  })

  it('다른 판매자의 상태는 보이지도 바뀌지도 않는다, 보조자는 403', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    await expectOk(client(w, a.cookie).put('/api/wizard', { status: 'DISMISSED' }))
    expect((await client(w, b.cookie).get('/api/wizard')).body).toEqual({ wizard: { status: 'NEW', step: null } })
    const helper = await assistantSession(w, a)
    expect((await client(w, helper.cookie).get('/api/wizard')).status).toBe(403)
    expect((await client(w, helper.cookie).put('/api/wizard', { status: 'NEW' })).status).toBe(403)
    expect((await client(w, a.cookie).get('/api/wizard')).body).toEqual({ wizard: { status: 'DISMISSED', step: null } })
  })
})

describe('AC-I3-97 새 API의 공통 규칙 (Origin·JSON·모르는 필드·no-store·세션)', () => {
  it('가게 이름·마법사·보조자 관리', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const cases: { path: string; method: 'PUT' | 'POST'; body: Record<string, unknown> }[] = [
      { path: '/api/shop', method: 'PUT', body: { name: '가게' } },
      { path: '/api/wizard', method: 'PUT', body: { status: 'DONE' } },
      { path: '/api/assistants', method: 'POST', body: { name: '엄마' } },
      { path: '/api/assistants/acc_x/delete', method: 'POST', body: {} },
      { path: '/api/outbox/1/confirm-posted', method: 'POST', body: { requestId: 'cp-97' } },
      { path: '/api/outbox/1/dismiss', method: 'POST', body: {} },
    ]
    for (const item of cases) {
      const send = (headers: Record<string, string>, body: string, cookie: string | null = seller.cookie) =>
        w.server.app.request(item.path, { method: item.method, headers: { ...(cookie === null ? {} : { Cookie: cookie }), ...headers }, body })
      expect((await send({ Origin: 'https://evil.test', 'Content-Type': 'application/json' }, JSON.stringify(item.body))).status, item.path).toBe(403)
      expect((await send({ Origin: ORIGIN, 'Content-Type': 'text/plain' }, JSON.stringify(item.body))).status, item.path).toBe(415)
      expect((await send({ Origin: ORIGIN, 'Content-Type': 'application/json' }, '[1]')).status, item.path).toBe(400)
      const unknown = await send({ Origin: ORIGIN, 'Content-Type': 'application/json' }, JSON.stringify({ ...item.body, extra: 1 }))
      expect(unknown.status, item.path).toBe(400)
      expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_FIELD')
      const anonymous = await send({ Origin: ORIGIN, 'Content-Type': 'application/json' }, JSON.stringify(item.body), null)
      expect(anonymous.status, item.path).toBe(401)
      expect(anonymous.headers.get('cache-control')).toBe('no-store')
    }
    for (const path of ['/api/wizard', '/api/assistants']) {
      expect((await client(w, null).get(path)).status).toBe(401)
      expect((await client(w, seller.cookie).get(path)).headers.get('cache-control')).toBe('no-store')
    }
  })
})
