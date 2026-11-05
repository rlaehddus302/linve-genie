// AC-I3-47·50·97 가게 이름·시작 마법사 (UX-02, D-I3-09~D-I3-11). 보조자 계정(AC-I3-60~62)은 D-UX3-32로 없앴다.
import { afterEach, describe, expect, it } from 'vitest'
import { ORIGIN, addSeller, client, expectOk, newWorld, type TestServer } from './support.ts'

const worlds: TestServer[] = []
async function world(): Promise<TestServer> {
  const created = await newWorld()
  worlds.push(created)
  return created
}
afterEach(() => {
  for (const item of worlds.splice(0)) item.server.close()
})

// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 AC-I3-60~62(보조자 만들기·권한·지우기) 시험을 뺐다.
// 보조자 관리 경로(/api/assistants)는 이제 없다(404) — 옛 보조자 행이 로그인·세션이 되지 않는 것은 l1-login-link 시험이 본다.

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

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자는 바꿀 수 없다(403)"를 뺐다
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

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('다른 판매자의 상태는 보이지도 바뀌지도 않는다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    await expectOk(client(w, a.cookie).put('/api/wizard', { status: 'DISMISSED' }))
    expect((await client(w, b.cookie).get('/api/wizard')).body).toEqual({ wizard: { status: 'NEW', step: null } })
    expect((await client(w, b.cookie).put('/api/wizard', { status: 'NEW' })).status).toBe(200)
    expect((await client(w, a.cookie).get('/api/wizard')).body).toEqual({ wizard: { status: 'DISMISSED', step: null } })
  })
})

describe('AC-I3-97 새 API의 공통 규칙 (Origin·JSON·모르는 필드·no-store·세션)', () => {
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 보조자 관리 경로를 뺐다 — 그 경로는 이제 404
  it('가게 이름·마법사', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const cases: { path: string; method: 'PUT' | 'POST'; body: Record<string, unknown> }[] = [
      { path: '/api/shop', method: 'PUT', body: { name: '가게' } },
      { path: '/api/wizard', method: 'PUT', body: { status: 'DONE' } },
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
    expect((await client(w, null).get('/api/wizard')).status).toBe(401)
    expect((await client(w, seller.cookie).get('/api/wizard')).headers.get('cache-control')).toBe('no-store')
    // 보조자 관리 경로는 없다
    expect((await client(w, seller.cookie).get('/api/assistants')).status).toBe(404)
    expect((await client(w, seller.cookie).post('/api/assistants', { name: '엄마' })).status).toBe(404)
  })
})
