// AC-L1-31 적대 시험 (test-domain): 간편 로그인(구글·카카오·네이버)을 가짜 OAuth 서버와 함께 띄운 서버에 HTTP로 공격한다.
// 근거: D-L1-02·D-L1-04, SYS-02, AC-L1-03~09. 비밀 표시 값(TOKEN-SENTINEL- 등)은 맨 끝 묶음에서 공격 전부 뒤에 다시 본다.
import { afterAll, describe, expect, it } from 'vitest'
import { formatLog } from '../../../apps/server/src/log.ts'
import type { ProviderId } from '../../../apps/server/src/social/providers.ts'
import { ALL, ORIGIN, addSeller, assistant, client, closeAll, consent, count, counts, dumpAll, flow, l1World, open, outcome, record, rows, start } from './helpers.ts'

afterAll(closeAll)

describe('AC-L1-31 같은 이메일 합치기 없음', () => {
  it.each(ALL)('%s: A의 연결 사용자와 이메일이 같은 다른 계정(다른 ID)은 NOT_LINKED — 아무것도 생기지 않는다', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const mine = w.fake.addUser(provider, {
      email: 'same.owner@example.com',
      nickname: '다육이네',
    })
    expect((await flow(w, provider, mine.id, a.cookie)).login).toBe('LINKED')
    const other = w.fake.addUser(provider, {
      email: 'same.owner@example.com',
      nickname: '다육이네',
    })
    const before = await counts(w)
    const result = await flow(w, provider, other.id)
    expect(result).toMatchObject({
      path: '/',
      login: 'NOT_LINKED',
      provider,
      session: null,
    })
    expect(await counts(w)).toEqual(before)
  })

  it('공급자를 바꿔도(구글에 연결한 이메일 = 카카오 이메일, 같은 숫자 ID까지) 다른 공급자로는 NOT_LINKED', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const google = w.fake.addUser('google', {
      id: '424242424242',
      email: 'shop.owner@gmail.com',
    })
    expect((await flow(w, 'google', google.id, a.cookie)).login).toBe('LINKED')
    // 같은 이메일·같은 계정 번호 글자의 카카오·네이버 계정
    w.fake.addUser('kakao', {
      id: '424242424242',
      email: 'shop.owner@gmail.com',
    })
    w.fake.addUser('naver', {
      id: '424242424242',
      email: 'shop.owner@gmail.com',
    })
    const before = await counts(w)
    expect(await flow(w, 'kakao', '424242424242')).toMatchObject({
      login: 'NOT_LINKED',
      session: null,
    })
    expect(await flow(w, 'naver', '424242424242')).toMatchObject({
      login: 'NOT_LINKED',
      session: null,
    })
    expect(await counts(w)).toEqual(before)
    // 구글로는 여전히 A
    const logged = await flow(w, 'google', google.id)
    expect((await client(w, logged.session).get('/api/me')).body).toMatchObject({ loginId: a.loginId })
  })
})

describe('AC-L1-31 테넌트 격리', () => {
  it('B 세션으로 A의 연결을 보거나·끊거나·바꿀 길이 없다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const k = w.fake.addUser('kakao', { email: 'a.owner@kakao.com' })
    expect((await flow(w, 'kakao', k.id, a.cookie)).login).toBe('LINKED')
    const seenByB = await client(w, b.cookie).get('/api/auth/methods')
    expect(seenByB.status).toBe(200)
    expect(seenByB.body.loginId).toBe(b.loginId)
    expect(seenByB.text).not.toContain('a.')
    expect(seenByB.text).not.toContain(k.id)
    expect((seenByB.body.providers as { provider: string; linked: boolean }[]).every((p) => !p.linked)).toBe(true)
    // B가 카카오 끊기 → B에게 연결이 없으니 404, A 그대로
    expect(
      (
        await client(w, b.cookie).post('/api/auth/unlink', {
          provider: 'kakao',
        })
      ).status,
    ).toBe(404)
    // 몰래 다른 판매자·계정 항목을 붙여도 받지 않는다
    for (const extra of [{ sellerId: a.sellerId }, { accountId: a.accountId }, { loginId: a.loginId }]) {
      expect(
        (
          await client(w, b.cookie).post('/api/auth/unlink', {
            provider: 'kakao',
            ...extra,
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await client(w, b.cookie).post('/api/auth/link', {
            provider: 'kakao',
            ...extra,
          })
        ).status,
      ).toBe(400)
    }
    expect(await count(w, 'login_links', 'account_id = $1', [a.accountId])).toBe(1)
  })

  it('A의 공급자 계정으로 로그인한 세션은 A의 자원만 — B의 방송은 404', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const made = await client(w, b.cookie).post('/api/broadcasts', {
      requestId: 'bc-b-1',
      title: 'B 방송',
    })
    expect(made.status).toBe(200)
    const bBroadcast = JSON.stringify(made.body).match(/"(?:id|broadcastId|b)":"([^"]+)"/)?.[1] as string
    expect(bBroadcast).toBeTruthy()
    const n = w.fake.addUser('naver')
    expect((await flow(w, 'naver', n.id, a.cookie)).login).toBe('LINKED')
    const logged = await flow(w, 'naver', n.id)
    expect(logged.session).not.toBeNull()
    const list = await client(w, logged.session).get('/api/broadcasts')
    expect(list.status).toBe(200)
    expect(list.text).not.toContain(bBroadcast)
    expect((await client(w, logged.session).post(`/api/broadcasts/${bBroadcast}/end`, { requestId: 'end-x' })).status).toBe(404)
  })

  it('A의 연결 시작 state를 B 세션의 브라우저로 돌아오게 하면 EXPIRED(쿠키 없음) 또는 SESSION_GONE(쿠키까지 훔침) — B에게 연결되지 않는다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const attacker = w.fake.addUser('kakao', { nickname: '공격자' })
    // B 브라우저(쿠키 없음)
    const first = await start(w, 'kakao', { session: a.cookie })
    const r1 = outcome(
      await open(w, consent(w, first.authorizeUrl, attacker.id), {
        session: b.cookie,
      }),
    )
    expect(r1.login).toBe('EXPIRED')
    // B 브라우저에 A의 lj_oauth 쿠키까지 있음
    const second = await start(w, 'kakao', { session: a.cookie })
    const r2 = outcome(
      await open(w, consent(w, second.authorizeUrl, attacker.id), {
        session: b.cookie,
        browser: second.browser,
      }),
    )
    expect(r2.login).toBe('SESSION_GONE')
    expect(r2.path).toBe('/')
    expect(await count(w, 'login_links')).toBe(0)
    expect(w.fake.exchanges.kakao).toBe(0)
  })
})

describe('AC-L1-31 이미 연결된 계정 빼앗기 없음', () => {
  it.each(ALL)('%s: B가 A에 연결된 공급자 계정으로 연결 → LINKED_ELSEWHERE, A 그대로, 응답에 A 정보 없음', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const user = w.fake.addUser(provider, { email: 'owner.a@example.com' })
    expect((await flow(w, provider, user.id, a.cookie)).login).toBe('LINKED')
    const before = await rows(w, 'select * from login_links')
    const stolen = await flow(w, provider, user.id, b.cookie)
    expect(stolen).toMatchObject({
      path: '/settings',
      login: 'LINKED_ELSEWHERE',
      provider,
      session: null,
    })
    expect(stolen.params).toEqual(['login', 'provider'])
    expect(stolen.location).not.toContain(a.loginId)
    expect(await rows(w, 'select * from login_links')).toEqual(before)
    const bMethods = await client(w, b.cookie).get('/api/auth/methods')
    expect(bMethods.text).not.toContain(a.loginId)
    expect(bMethods.text).not.toContain('ow***')
  })

  it('동시에 두 판매자가 같은 공급자 계정을 연결해도 하나만 성공 (유일 제약)', async () => {
    const w = await l1World()
    const sellers = await Promise.all([addSeller(w), addSeller(w), addSeller(w), addSeller(w)])
    const user = w.fake.addUser('kakao')
    const starts = await Promise.all(sellers.map((s) => start(w, 'kakao', { session: s.cookie })))
    const locations = starts.map((s) => consent(w, s.authorizeUrl, user.id))
    const results = await Promise.all(
      locations.map(
        async (loc, i) =>
          outcome(
            await open(w, loc, {
              browser: starts[i]?.browser,
              session: sellers[i]?.cookie,
            }),
          ).login,
      ),
    )
    expect(results.filter((r) => r === 'LINKED')).toHaveLength(1)
    expect(results.filter((r) => r === 'LINKED_ELSEWHERE')).toHaveLength(3)
    expect(await count(w, 'login_links')).toBe(1)
  })

  it('한 판매자가 같은 공급자의 두 계정을 동시에 연결해도 하나만 (ALREADY_LINKED)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const u1 = w.fake.addUser('google')
    const u2 = w.fake.addUser('google')
    const s1 = await start(w, 'google', { session: a.cookie })
    const s2 = await start(w, 'google', {
      session: a.cookie,
      browser: s1.browser,
    })
    const l1 = consent(w, s1.authorizeUrl, u1.id)
    const l2 = consent(w, s2.authorizeUrl, u2.id)
    const results = await Promise.all([open(w, l1, { browser: s1.browser, session: a.cookie }), open(w, l2, { browser: s1.browser, session: a.cookie })])
    expect(results.map((r) => outcome(r).login).sort()).toEqual(['ALREADY_LINKED', 'LINKED'])
    expect(await count(w, 'login_links', 'account_id = $1', [a.accountId])).toBe(1)
  })
})

describe('AC-L1-31 로그인 CSRF·연결 CSRF', () => {
  it.each(ALL)('%s: 공격자가 자기 공급자 계정으로 받은 code·state를 판매자 브라우저(쿠키 없음·다른 쿠키)로 열게 해도 로그인되지 않는다', async (provider) => {
    const w = await l1World()
    const victim = await addSeller(w)
    const attacker = await addSeller(w)
    const attackerUser = w.fake.addUser(provider)
    expect((await flow(w, provider, attackerUser.id, attacker.cookie)).login).toBe('LINKED')
    // 공격자 브라우저에서 시작·동의 (돌아오는 주소는 열지 않고 가로챔)
    const evil = await start(w, provider)
    const location = consent(w, evil.authorizeUrl, attackerUser.id)
    // 판매자 브라우저: 쿠키 없음
    const noCookie = outcome(await open(w, location, { session: victim.cookie }))
    expect(noCookie).toMatchObject({ login: 'EXPIRED', session: null })
    // 판매자 브라우저: 자기 lj_oauth 쿠키 (판매자도 다른 시작을 해 둠)
    const own = await start(w, provider)
    const otherCookie = outcome(
      await open(w, location, {
        session: victim.cookie,
        browser: own.browser,
      }),
    )
    expect(otherCookie).toMatchObject({ login: 'EXPIRED', session: null })
    expect(w.fake.exchanges[provider]).toBe(1) // 연결 때 한 번뿐
    // 판매자 브라우저의 세션은 그대로 판매자
    expect((await client(w, victim.cookie).get('/api/me')).body).toMatchObject({ loginId: victim.loginId })
  })

  it('연결 시작 POST가 다른 Origin·Origin 없음이면 403, 폼 본문이면 거절 — state가 생기지 않는다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const send = (headers: Record<string, string>, body: string) =>
      w.server.app.request('/api/auth/link', {
        method: 'POST',
        headers: { Cookie: a.cookie, ...headers },
        body,
      })
    expect(
      (
        await send(
          {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
          },
          '{"provider":"kakao"}',
        )
      ).status,
    ).toBe(403)
    expect((await send({ 'Content-Type': 'application/json' }, '{"provider":"kakao"}')).status).toBe(403)
    expect((await send({ Origin: 'null', 'Content-Type': 'application/json' }, '{"provider":"kakao"}')).status).toBe(403)
    const form = await send({ Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, 'provider=kakao')
    expect(form.status).toBeGreaterThanOrEqual(400)
    expect(form.status).toBeLessThan(500)
    const textPlain = await send({ Origin: ORIGIN, 'Content-Type': 'text/plain' }, '{"provider":"kakao"}')
    expect(textPlain.status).toBeGreaterThanOrEqual(400)
    expect(textPlain.headers.get('set-cookie') ?? '').not.toContain('lj_oauth')
    // 로그인 시작도 같다
    expect(
      (
        await w.server.app.request('/api/auth/start', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
          },
          body: '{"provider":"kakao"}',
        })
      ).status,
    ).toBe(403)
    expect(await count(w, 'login_states')).toBe(0)
  })

  it('판매자 세션 쿠키만 있는 다른 사이트의 GET 돌아오는 주소로 공격자 공급자 계정을 판매자에게 연결할 수 없다', async () => {
    const w = await l1World()
    const victim = await addSeller(w)
    const attacker = await addSeller(w)
    const evilUser = w.fake.addUser('kakao', { nickname: '공격자' })
    // 공격자가 자기 세션으로 연결을 시작하고 동의까지 한 뒤 돌아오는 주소를 판매자에게 보낸다
    const evil = await start(w, 'kakao', { session: attacker.cookie })
    const location = consent(w, evil.authorizeUrl, evilUser.id)
    const r = outcome(
      await open(w, location, {
        session: victim.cookie,
        headers: { Referer: 'https://evil.example/' },
      }),
    )
    expect(r.login).toBe('EXPIRED')
    expect(await count(w, 'login_links')).toBe(0)
    // 공격자 자신의 브라우저로도 이제는 쓸 수 없다? — 쓴 표시가 없으므로 공격자 브라우저로 열면 공격자에게만 연결된다(판매자 아님)
    const own = outcome(
      await open(w, location, {
        session: attacker.cookie,
        browser: evil.browser,
      }),
    )
    expect(own.login).toBe('LINKED')
    expect(await count(w, 'login_links', 'account_id = $1', [victim.accountId])).toBe(0)
  })
})

describe('AC-L1-31 state 동시 사용', () => {
  it.each(ALL)('%s: 같은 돌아오는 주소를 동시에 20번 → 세션 하나, 공급자 교환 한 번', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser(provider)
    expect((await flow(w, provider, user.id, a.cookie)).login).toBe('LINKED')
    w.fake.reset()
    const sessionsBefore = await count(w, 'sessions')
    const started = await start(w, provider)
    const location = consent(w, started.authorizeUrl, user.id)
    const results = await Promise.all(Array.from({ length: 20 }, async () => outcome(await open(w, location, { browser: started.browser }))))
    expect(results.filter((r) => r.session !== null)).toHaveLength(1)
    expect(results.filter((r) => r.login === 'EXPIRED')).toHaveLength(19)
    expect(await count(w, 'sessions')).toBe(sessionsBefore + 1)
    expect(w.fake.exchanges[provider]).toBe(1)
  })

  it('연결 돌아오는 주소를 동시에 20번 → 연결 하나, 교환 한 번, 알림 SESSION_GONE 없음', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('naver')
    const started = await start(w, 'naver', { session: a.cookie })
    const location = consent(w, started.authorizeUrl, user.id)
    const results = await Promise.all(
      Array.from(
        { length: 20 },
        async () =>
          outcome(
            await open(w, location, {
              browser: started.browser,
              session: a.cookie,
            }),
          ).login,
      ),
    )
    expect(results.filter((r) => r === 'LINKED')).toHaveLength(1)
    expect(results.filter((r) => r === 'EXPIRED')).toHaveLength(19)
    expect(w.fake.exchanges.naver).toBe(1)
    expect(await count(w, 'login_links')).toBe(1)
  })
})

describe('AC-L1-31 열린 리디렉션 없음', () => {
  const evil = [
    'next=https://evil.example',
    'redirect=//evil.example',
    'return_to=%2F%2Fevil.example',
    'redirect_uri=https://evil.example/cb',
    'login=LINKED',
    'provider=evil',
    'next=/\\evil.example',
    'next=javascript:alert(1)',
  ]
  const hostHeaders: Record<string, string>[] = [{}, { Host: 'evil.example' }, { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' }, { Forwarded: 'host=evil.example;proto=http' }]

  it.each(ALL)('%s: 성공·실패 어느 쪽이든 Location은 앱 주소 + 고정 경로 + login·provider뿐', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser(provider)
    expect((await flow(w, provider, user.id, a.cookie)).login).toBe('LINKED')
    const locations: ReturnType<typeof outcome>[] = []
    for (const [i, extra] of evil.entries()) {
      const headers = hostHeaders[i % hostHeaders.length] as Record<string, string>
      // 성공 (로그인)
      const s = await start(w, provider)
      const ok = new URL(consent(w, s.authorizeUrl, user.id))
      locations.push(
        outcome(
          await open(w, `${ok.toString()}&${extra}`, {
            browser: s.browser,
            headers,
          }),
        ),
      )
      // 실패 (state 없음·error 주입)
      locations.push(
        outcome(
          await open(w, `${ORIGIN}/api/auth/${provider}/callback?${extra}`, {
            headers,
          }),
        ),
      )
      locations.push(outcome(await open(w, `${ORIGIN}/api/auth/${provider}/callback?error=%3Cscript%3E&${extra}`, { headers })))
      // 연결 쪽
      const l = await start(w, provider, { session: a.cookie })
      locations.push(
        outcome(
          await open(w, `${consent(w, l.authorizeUrl, user.id)}&${extra}`, {
            browser: l.browser,
            session: a.cookie,
            headers,
          }),
        ),
      )
    }
    for (const loc of locations) {
      expect(loc.origin, loc.location).toBe(ORIGIN)
      expect(['/', '/settings']).toContain(loc.path)
      if (loc.login === null) expect(loc.location).toBe(`${ORIGIN}/`)
      else {
        expect(loc.params).toEqual(['login', 'provider'])
        expect(loc.provider).toBe(provider)
        expect(['CANCELLED', 'EXPIRED', 'NOT_LINKED', 'PROVIDER_ERROR', 'RATE_LIMITED', 'LINKED', 'LINKED_ELSEWHERE', 'ALREADY_LINKED', 'SESSION_GONE']).toContain(loc.login)
      }
      expect(loc.location).not.toContain('evil')
    }
  })

  it('승인 주소의 redirect_uri도 Host·X-Forwarded-Host와 상관없이 설정한 앱 주소', async () => {
    const w = await l1World()
    for (const provider of ALL) {
      const response = await record(
        w,
        await w.server.app.request('/api/auth/start', {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            'Content-Type': 'application/json',
            Host: 'evil.example',
            'X-Forwarded-Host': 'evil.example',
            'X-Forwarded-Proto': 'http',
          },
          body: JSON.stringify({ provider }),
        }),
      )
      const url = new URL(((await response.json()) as { authorizeUrl: string }).authorizeUrl)
      expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/${provider}/callback`)
    }
  })
})

describe('AC-L1-31 보조자', () => {
  it('보조자 세션으로 연결 시작·목록·끊기 403 — 아무것도 생기지 않는다', async () => {
    const w = await l1World()
    const seller = await addSeller(w)
    const helper = await assistant(w, seller)
    for (const provider of ALL) {
      expect((await client(w, helper).post('/api/auth/link', { provider })).status).toBe(403)
      expect((await client(w, helper).post('/api/auth/unlink', { provider })).status).toBe(403)
    }
    expect((await client(w, helper).get('/api/auth/methods')).status).toBe(403)
    expect(await count(w, 'login_states')).toBe(0)
  })

  it('보조자 계정 ID로 연결 행을 직접 넣어 두어도(손상) 간편 로그인은 그 보조자 세션을 만들지 않는다', async () => {
    const w = await l1World()
    const seller = await addSeller(w)
    await assistant(w, seller)
    const helperId = String((await rows(w, `select id from accounts where role = 'ASSISTANT'`))[0]?.id)
    for (const provider of ALL) {
      const user = w.fake.addUser(provider)
      await w.pg.query(`insert into login_links (seller_id, account_id, provider, provider_user_id, label, linked_at) values ($1, $2, $3, $4, '', now())`, [
        seller.sellerId,
        helperId,
        provider,
        user.id,
      ])
      const before = await count(w, 'sessions')
      const r = await flow(w, provider, user.id)
      expect(r).toMatchObject({ login: 'NOT_LINKED', session: null })
      expect(await count(w, 'sessions')).toBe(before)
    }
  })

  it('보조자가 로그인 화면에서 간편 로그인을 시작할 수는 있지만 보조자로는 들어오지 못한다', async () => {
    const w = await l1World()
    const seller = await addSeller(w)
    const helper = await assistant(w, seller)
    const user = w.fake.addUser('kakao')
    const r = await flow(w, 'kakao', user.id, null)
    expect(r.login).toBe('NOT_LINKED')
    // 보조자 세션 쿠키를 가진 채 로그인 시작 → 돌아와도 보조자 세션이 판매자로 바뀌지 않는다
    const s = await w.server.app.request('/api/auth/start', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: helper,
      },
      body: '{"provider":"kakao"}',
    })
    expect(s.status).toBe(200)
    expect((await client(w, helper).get('/api/me')).body).toMatchObject({
      role: 'ASSISTANT',
    })
  })
})

describe('AC-L1-31 꺼진 공급자', () => {
  it('켜지지 않은 공급자의 시작·연결·돌아오는 주소·끊기 404 — 남은 연결은 끊기만 200, 목록엔 enabled false', async () => {
    const w = await l1World({ providers: ['google'] })
    const a = await addSeller(w)
    // 꺼진 카카오에 남은 연결 (예전에 켜져 있던 때)
    await w.pg.query(`insert into login_links (seller_id, account_id, provider, provider_user_id, label, linked_at) values ($1, $2, 'kakao', '777', 'ka***', now())`, [a.sellerId, a.accountId])
    for (const provider of ['kakao', 'naver', 'apple', 'GOOGLE', 'google '] as const) {
      expect((await client(w, null).post('/api/auth/start', { provider })).status, provider).toBe(404)
      expect((await client(w, a.cookie).post('/api/auth/link', { provider })).status, provider).toBe(404)
    }
    for (const path of ['/api/auth/kakao/callback?code=x&state=y', '/api/auth/naver/callback', '/api/auth/apple/callback', '/api/auth/GOOGLE/callback', '/api/auth/k%61kao/callback?code=x']) {
      expect((await open(w, `${ORIGIN}${path}`)).status, path).toBe(404)
    }
    expect(
      (
        await client(w, a.cookie).post('/api/auth/unlink', {
          provider: 'naver',
        })
      ).status,
    ).toBe(404)
    const methods = await client(w, a.cookie).get('/api/auth/methods')
    expect(methods.body.providers).toEqual([
      {
        provider: 'kakao',
        enabled: false,
        linked: true,
        label: 'ka***',
        linkedAt: expect.any(String) as string,
      },
      {
        provider: 'google',
        enabled: true,
        linked: false,
        label: '',
        linkedAt: null,
      },
    ])
    expect(
      (
        await client(w, a.cookie).post('/api/auth/unlink', {
          provider: 'kakao',
        })
      ).status,
    ).toBe(200)
    expect(await count(w, 'login_links')).toBe(0)
    // client-config도 켜진 것만
    expect((await client(w, null).get('/api/client-config')).body).toEqual({
      loginProviders: ['google'],
    })
  })

  it('공급자가 하나도 켜지지 않은 서버: /api/auth/** 전부 404, client-config에 항목 없음 (로그인 전은 그대로 401)', async () => {
    const { newWorld } = await import('../../../apps/server/test/support.ts')
    const w = await newWorld()
    const a = await addSeller(w)
    for (const [method, path] of [
      ['POST', '/api/auth/start'],
      ['POST', '/api/auth/link'],
      ['POST', '/api/auth/unlink'],
      ['GET', '/api/auth/methods'],
      ['GET', '/api/auth/kakao/callback'],
      ['GET', '/api/auth'],
    ] as const) {
      const response = method === 'GET' ? await client(w, a.cookie).get(path) : await client(w, a.cookie).post(path, { provider: 'kakao' })
      expect(response.status, path).toBe(404)
    }
    const config = await client(w, a.cookie).get('/api/client-config')
    expect(config.status).toBe(200)
    expect('loginProviders' in config.body).toBe(false)
    expect((await client(w, null).get('/api/client-config')).status).toBe(401)
  })
})

describe('AC-L1-24·AC-L1-12 운영 서버엔 가짜·연습 경로가 없다', () => {
  it('공급자가 켜진 서버에서도 /_try/oauth/**·/_fake/**·가짜 승인 화면 경로는 404', async () => {
    const w = await l1World()
    for (const path of [
      '/_try/oauth/kakao/authorize?client_id=fake-kakao-rest-key',
      '/_try/oauth/google/token',
      '/_fake/users',
      '/_fake/approve',
      '/kakao/authorize',
      '/api/_fake/users',
      '/api/auth/kakao/authorize',
    ]) {
      const get = await w.server.app.request(path)
      expect(get.status, path).toBeGreaterThanOrEqual(400)
      expect([401, 404], path).toContain(get.status)
      const post = await w.server.app.request(path, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: '{"provider":"kakao"}',
      })
      expect([401, 404], path).toContain(post.status)
    }
  })
})

describe('AC-L1-31 결과 문장 주입 — 서버는 주소 글을 되돌려 보내지 않는다', () => {
  it.each(ALL)('%s: ?login=<script>·error=<script>·긴 글·state 자리의 HTML → Location·본문에 그 글이 없다', async (provider) => {
    const w = await l1World()
    const long = 'A'.repeat(10_000)
    const payloads = ['%3Cscript%3Ealert(1)%3C%2Fscript%3E', encodeURIComponent('"><img src=x onerror=alert(1)>'), long, encodeURIComponent('카카오‮로그인​')]
    for (const p of payloads) {
      for (const query of [`login=${p}&provider=${p}`, `error=${p}&error_description=${p}`, `code=${p}&state=${p}`, `error=access_denied&state=${p}`]) {
        const response = await open(w, `${ORIGIN}/api/auth/${provider}/callback?${query}`)
        const r = outcome(response)
        expect(r.params).toEqual(['login', 'provider'])
        expect(r.location.length).toBeLessThan(120)
        expect(r.location).not.toMatch(/script|onerror|AAAA|%E2%80/i)
        expect(await response.text()).toBe('')
      }
    }
  })
})

describe('공급자 계정 ID·이름 모양 공격', () => {
  it.each(ALL)('%s: 모양 밖 공급자 계정 ID(빈 글·공백·한글·256자·경로 글자)는 PROVIDER_ERROR, 아무것도 생기지 않는다', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const before = await counts(w)
    for (const id of [' 123', '12 3', '다육이', 'x'.repeat(256), '../admin', '1;drop', 'a/b', '%00']) {
      w.fake.addUser(provider, { id })
      expect((await flow(w, provider, id, a.cookie)).login, id).toBe('PROVIDER_ERROR')
      expect((await flow(w, provider, id)).login, id).toBe('PROVIDER_ERROR')
    }
    expect(await counts(w)).toEqual({ ...before, sessions: before.sessions })
    // 255자 경계는 된다
    const edge = w.fake.addUser(provider, { id: 'y'.repeat(255) })
    expect((await flow(w, provider, edge.id, a.cookie)).login).toBe('LINKED')
  })

  it('닉네임·이메일의 제어·방향 바꾸기·폭 없는 글자·HTML·아주 긴 글 → 가린 이름은 40자 이하, 제어 글자 없음, 원문 없음', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const cases: {
      provider: ProviderId
      email: string | null
      nickname: string | null
    }[] = [
      {
        provider: 'kakao',
        email: null,
        nickname: '‮​<script>alert(1)</script>다육이네',
      },
      {
        provider: 'naver',
        email: `${'x'.repeat(5000)}@${'d'.repeat(5000)}.com`,
        nickname: null,
      },
      {
        provider: 'google',
        email: '\u0000\u0007seller.kim@gmail.com\r\n',
        nickname: null,
      },
    ]
    for (const c of cases) {
      const user = w.fake.addUser(c.provider, {
        email: c.email,
        nickname: c.nickname,
      })
      expect((await flow(w, c.provider, user.id, a.cookie)).login).toBe('LINKED')
    }
    const labels = (await rows(w, 'select provider, label from login_links order by provider')).map((r) => String(r.label))
    for (const label of labels) {
      expect([...label].length).toBeLessThanOrEqual(40)
      expect(label).not.toMatch(/[\p{Cc}\p{Cf}]/u)
      expect(label).not.toContain('script')
    }
    expect(labels).toContain('se***@gmail.com')
    const dump = await dumpAll(w)
    expect(dump).not.toContain('alert(1)')
    expect(dump).not.toContain('seller.kim')
  })
})

describe('끊기 공격', () => {
  it('끊은 뒤 그 공급자 계정으로 로그인 → NOT_LINKED, 끊기 전 그 공급자 세션은 모두 죽고 다른 판매자가 새로 연결할 수 있다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const user = w.fake.addUser('kakao')
    expect((await flow(w, 'kakao', user.id, a.cookie)).login).toBe('LINKED')
    const phone = await flow(w, 'kakao', user.id)
    const tablet = await flow(w, 'kakao', user.id)
    expect(
      (
        await client(w, a.cookie).post('/api/auth/unlink', {
          provider: 'kakao',
        })
      ).status,
    ).toBe(200)
    expect((await client(w, phone.session).get('/api/me')).status).toBe(401)
    expect((await client(w, tablet.session).get('/api/me')).status).toBe(401)
    expect((await client(w, a.cookie).get('/api/me')).status).toBe(200)
    expect((await flow(w, 'kakao', user.id)).login).toBe('NOT_LINKED')
    expect((await flow(w, 'kakao', user.id, b.cookie)).login).toBe('LINKED')
    // 두 번 끊기 → 404
    expect(
      (
        await client(w, a.cookie).post('/api/auth/unlink', {
          provider: 'kakao',
        })
      ).status,
    ).toBe(404)
  })

  it('동시에 끊기 10번 → 하나만 200, 나머지 404', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('google')
    expect((await flow(w, 'google', user.id, a.cookie)).login).toBe('LINKED')
    const results = await Promise.all(
      Array.from(
        { length: 10 },
        async () =>
          (
            await client(w, a.cookie).post('/api/auth/unlink', {
              provider: 'google',
            })
          ).status,
      ),
    )
    expect(results.filter((s) => s === 200)).toHaveLength(1)
    expect(results.filter((s) => s === 404)).toHaveLength(9)
  })

  it('비밀번호 없는 계정(손상 흉내)에 연결 둘을 동시에 끊어도 마지막 수단은 남는다 (409 하나 이상)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const k = w.fake.addUser('kakao')
    const n = w.fake.addUser('naver')
    expect((await flow(w, 'kakao', k.id, a.cookie)).login).toBe('LINKED')
    expect((await flow(w, 'naver', n.id, a.cookie)).login).toBe('LINKED')
    await w.pg.query(`update accounts set password_hash = '' where id = $1`, [a.accountId])
    const results = await Promise.all(['kakao', 'naver'].map(async (provider) => (await client(w, a.cookie).post('/api/auth/unlink', { provider })).status))
    expect(results.sort()).toEqual([200, 409])
    expect(await count(w, 'login_links', 'account_id = $1', [a.accountId])).toBe(1)
  })
})

describe('AC-L1-31 비밀 누출 없음 (공격 흐름 전부 뒤)', () => {
  it('실패·동시·재사용·CSRF·주입 흐름 뒤 로그·DB 덤프·응답 전체에 토큰·코드·이메일·비밀값 표시가 없고, state 원문은 DB·로그에, 공급자 계정 ID는 연결 표 밖에 없다', async () => {
    const w = await l1World({
      timeoutMs: 300,
      fake: {
        codePrefix: 'CODE-SENTINEL-',
        tokenPrefix: 'TOKEN-SENTINEL-',
        clients: {
          google: {
            clientId: 'fake-google-client',
            clientSecret: 'SECRET-SENTINEL-google',
          },
          kakao: {
            clientId: 'fake-kakao-rest-key',
            clientSecret: 'SECRET-SENTINEL-kakao',
          },
          naver: {
            clientId: 'fake-naver-client',
            clientSecret: 'SECRET-SENTINEL-naver',
          },
        },
      },
    })
    const a = await addSeller(w)
    const b = await addSeller(w)
    const states: string[] = []
    const ids: string[] = []
    for (const provider of ALL) {
      const user = w.fake.addUser(provider, {
        id: `ID-SENTINEL-${provider}`,
        email: `email-sentinel-${provider}@example.com`,
        nickname: 'NICK-SENTINEL',
      })
      ids.push(user.id)
      const other = w.fake.addUser(provider, {
        id: `ID-SENTINEL-other-${provider}`,
        email: `email-sentinel-${provider}@example.com`,
      })
      ids.push(other.id)
      // 연결·로그인·LINKED_ELSEWHERE·NOT_LINKED
      expect((await flow(w, provider, user.id, a.cookie)).login).toBe('LINKED')
      expect((await flow(w, provider, user.id, b.cookie)).login).toBe('LINKED_ELSEWHERE')
      expect((await flow(w, provider, other.id)).login).toBe('NOT_LINKED')
      // 재사용
      const s = await start(w, provider)
      states.push(s.state)
      const location = consent(w, s.authorizeUrl, user.id)
      const firstOpen = outcome(await open(w, location, { browser: s.browser }))
      expect(firstOpen.session).not.toBeNull()
      expect(outcome(await open(w, location, { browser: s.browser })).login).toBe('EXPIRED')
      // 새 state + 옛 코드
      const s2 = await start(w, provider)
      states.push(s2.state)
      const code = new URL(location).searchParams.get('code') as string
      const replay = new URL(consent(w, s2.authorizeUrl, user.id))
      replay.searchParams.set('code', code)
      expect(outcome(await open(w, replay.toString(), { browser: s2.browser })).login).toBe('PROVIDER_ERROR')
      // 동시
      const s3 = await start(w, provider)
      states.push(s3.state)
      const l3 = consent(w, s3.authorizeUrl, user.id)
      await Promise.all(Array.from({ length: 5 }, () => open(w, l3, { browser: s3.browser })))
      // CSRF (다른 브라우저)
      const s4 = await start(w, provider)
      states.push(s4.state)
      expect(
        outcome(
          await open(w, consent(w, s4.authorizeUrl, user.id), {
            session: b.cookie,
          }),
        ).login,
      ).toBe('EXPIRED')
      // 실패들
      for (const fault of [{ status: 500 }, { status: 400 }, { error: 'invalid_grant' as const }, { delayMs: 800 }, { shape: 'not_json' as const }]) {
        w.fake.failNext(provider, 'token', fault)
        const sf = await start(w, provider)
        states.push(sf.state)
        expect(
          outcome(
            await open(w, consent(w, sf.authorizeUrl, user.id), {
              browser: sf.browser,
            }),
          ).login,
        ).toBe('PROVIDER_ERROR')
      }
      for (const fault of [{ status: 401 }, { shape: 'missing_id' as const }, { delayMs: 800 }]) {
        w.fake.failNext(provider, 'userinfo', fault)
        const sf = await start(w, provider)
        states.push(sf.state)
        expect(
          outcome(
            await open(w, consent(w, sf.authorizeUrl, user.id), {
              browser: sf.browser,
            }),
          ).login,
        ).toBe('PROVIDER_ERROR')
      }
      // 목록·화면 설정
      for (const path of ['/api/auth/methods', '/api/me', '/api/client-config']) await record(w, await w.server.app.request(path, { headers: { Cookie: a.cookie } }))
      // 끊기
      expect((await client(w, a.cookie).post('/api/auth/unlink', { provider })).status).toBe(200)
    }
    await new Promise((resolve) => setTimeout(resolve, 900))
    const logs = w.logs.map((entry) => formatLog(entry)).join('\n')
    const dump = await dumpAll(w)
    const seen = w.seen.join('\n')
    for (const sentinel of ['TOKEN-SENTINEL-', 'CODE-SENTINEL-', 'SECRET-SENTINEL-', 'email-sentinel', 'NICK-SENTINEL']) {
      expect(logs, `log ${sentinel}`).not.toContain(sentinel)
      expect(dump, `db ${sentinel}`).not.toContain(sentinel)
      expect(seen, `response ${sentinel}`).not.toContain(sentinel)
    }
    for (const state of states) {
      expect(logs).not.toContain(state)
      expect(dump).not.toContain(state)
    }
    for (const id of ids) {
      expect(logs).not.toContain(id)
      expect(seen).not.toContain(id)
    }
    // 연결 표 밖의 DB에도 공급자 계정 ID가 없다 (끊은 뒤라 연결 표에도 남지 않는다)
    expect(dump).not.toContain('ID-SENTINEL-')
    // 로그엔 공급자 이름·결과 코드·오류 종류만
    for (const entry of w.logs.filter((e) => e.code === 'SOCIAL_LOGIN')) {
      expect(
        Object.keys(entry).every((key) => ['level', 'code', 'provider', 'reason', 'errorKind', 'status', 'count', 'at', 'time'].includes(key)),
        JSON.stringify(Object.keys(entry)),
      ).toBe(true)
    }
  })
})
