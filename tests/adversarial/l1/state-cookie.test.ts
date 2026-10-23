// 확인 쿠키 계약 공격 (test-domain): 792c1c1에서 바뀐 __Host-lj_oauth(Path=/·Secure·Domain 없음·10분),
// 시작마다 새 값(옛 값의 진행 중 state는 새 값에 다시 묶음), 돌아오는 주소는 성공(로그인 세션·LINKED)이고 남은 state가 없을 때만 지운다.
// 근거: AC-L1-03(두 탭), RA-L1-01(실패 콜백이 다른 탭을 죽이지 않음), RA-L1-02(하위 도메인 덮어쓰기). dev-notes "state·쿠키 방식".
import { afterAll, describe, expect, it } from 'vitest'
import { ALL, OAUTH_COOKIE, addSeller, client, closeAll, consent, count, flow, l1World, open, outcome, start } from './helpers.ts'

afterAll(closeAll)

/** 응답의 확인 쿠키 Set-Cookie 줄들 (접두어 없는 lj_oauth 줄도 함께 잡는다) */
function oauthLines(response: Response): string[] {
  return response.headers.getSetCookie().filter((line) => /^(__Host-)?lj_oauth=/.test(line))
}

function attrs(line: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of line.split(';').slice(1)) {
    const [k, ...v] = part.trim().split('=')
    out.set((k ?? '').toLowerCase(), v.join('='))
  }
  return out
}

function expectHostCookie(line: string, maxAge: string): void {
  const a = attrs(line)
  expect(line.startsWith(`${OAUTH_COOKIE}=`), line).toBe(true)
  expect(a.get('path'), line).toBe('/')
  expect(a.has('secure'), line).toBe(true)
  expect(a.has('httponly'), line).toBe(true)
  expect(a.get('samesite')?.toLowerCase(), line).toBe('lax')
  expect(a.get('max-age'), line).toBe(maxAge)
  expect(a.has('domain'), line).toBe(false)
}

describe('RA-L1-02 확인 쿠키 모양', () => {
  it.each(ALL)('%s: 로그인·연결 시작의 Set-Cookie는 __Host-lj_oauth 하나 (Path=/·Secure·HttpOnly·Lax·Max-Age=600·Domain 없음), 접두어 없는 lj_oauth는 내보내지 않는다', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    for (const s of [await start(w, provider), await start(w, provider, { session: a.cookie })]) {
      const lines = oauthLines(s.response)
      expect(lines).toHaveLength(1)
      expectHostCookie(lines[0] as string, '600')
      expect(s.response.headers.getSetCookie().some((l) => l.startsWith('lj_oauth='))).toBe(false)
    }
  })

  it('지우는 줄도 Path=/·Secure (아니면 브라우저가 __Host- 쿠키 지우기를 버린다)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('kakao')
    const s = await start(w, 'kakao', { session: a.cookie })
    const r = await open(w, consent(w, s.authorizeUrl, user.id), { browser: s.browser, session: a.cookie })
    expect(outcome(r).login).toBe('LINKED')
    const lines = oauthLines(r)
    expect(lines).toHaveLength(1)
    expectHostCookie(lines[0] as string, '0')
    expect((lines[0] as string).startsWith(`${OAUTH_COOKIE}=;`)).toBe(true)
  })
})

describe('RA-L1-02 하위 도메인이 심은 접두어 없는 lj_oauth는 무시', () => {
  it.each(ALL)('%s: 진짜 값을 접두어 없는 lj_oauth로만 보내면 돌아오는 주소는 EXPIRED — 로그인되지 않는다', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser(provider)
    expect((await flow(w, provider, user.id, a.cookie)).login).toBe('LINKED')
    const s = await start(w, provider)
    const location = consent(w, s.authorizeUrl, user.id)
    const r = outcome(await open(w, location, { extraCookie: `lj_oauth=${s.browser}` }))
    expect(r).toMatchObject({ login: 'EXPIRED', session: null })
  })

  it('로그인 CSRF: 공격자가 하위 도메인으로 판매자 브라우저에 자기 값을 lj_oauth로 심어 두고, 판매자가 시작하게 해도 공격자 state가 판매자 쿠키에 묶이지 않는다', async () => {
    const w = await l1World()
    const attacker = await addSeller(w)
    const evilUser = w.fake.addUser('kakao', { nickname: '공격자' })
    expect((await flow(w, 'kakao', evilUser.id, attacker.cookie)).login).toBe('LINKED')
    // 공격자 브라우저에서 로그인 시작·동의 (돌아오는 주소는 가로챔)
    const evil = await start(w, 'kakao')
    const evilLocation = consent(w, evil.authorizeUrl, evilUser.id)
    // 판매자 브라우저(로그아웃 상태)에 접두어 없는 lj_oauth=<공격자 값>이 심어져 있고, 판매자가 네이버 로그인을 시작한다
    const mine = await start(w, 'naver', { extraCookie: `lj_oauth=${evil.browser}` })
    expect(mine.browser).not.toBe(evil.browser)
    // 공격자가 판매자에게 자기 돌아오는 주소를 열게 함 — 판매자 브라우저엔 새 __Host- 값과 심어진 값이 같이 있다
    const r = outcome(await open(w, evilLocation, { browser: mine.browser, extraCookie: `lj_oauth=${evil.browser}` }))
    expect(r).toMatchObject({ login: 'EXPIRED', session: null })
    // 공격자 자기 브라우저에서는 그 state가 그대로 살아 있다 (판매자 시작이 다시 묶어 가지 않았다)
    expect(outcome(await open(w, evilLocation, { browser: evil.browser })).session).not.toBeNull()
  })

  it('같은 요청에 lj_oauth=가짜 와 __Host-lj_oauth=진짜가 함께 와도(어느 순서든) 진짜 쪽으로 판단 — 내 흐름은 끝난다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('google')
    const s = await start(w, 'google', { session: a.cookie, extraCookie: 'lj_oauth=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    const location = consent(w, s.authorizeUrl, user.id)
    const url = new URL(location)
    const r = await w.server.app.request(`${url.pathname}${url.search}`, {
      headers: { Cookie: `lj_oauth=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; ${a.cookie}; ${OAUTH_COOKIE}=${s.browser}; lj_oauth=BBBB` },
    })
    expect(outcome(r).login).toBe('LINKED')
  })
})

describe('시작마다 새 값 (옛 값 재사용 없음)', () => {
  it('같은 브라우저가 연달아 시작하면 매번 다른 값, 요청에 온 값을 그대로 돌려주지 않는다 (공격자가 고른 값 포함)', async () => {
    const w = await l1World()
    const seen = new Set<string>()
    let browser: string | undefined
    for (let i = 0; i < 6; i++) {
      const s = await start(w, ALL[i % 3] as (typeof ALL)[number], browser === undefined ? {} : { browser })
      expect(seen.has(s.browser)).toBe(false)
      seen.add(s.browser)
      browser = s.browser
    }
    const chosen = 'attacker-chosen-value-0123456789abcdefghijk'
    expect(chosen).toHaveLength(43)
    const s = await start(w, 'kakao', { browser: chosen })
    expect(s.browser).not.toBe(chosen)
  })

  it('다시 시작한 뒤 옛 값으로 돌아오면 EXPIRED — 옛 값은 더 이상 그 state를 열지 못한다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('kakao')
    const s1 = await start(w, 'kakao', { session: a.cookie })
    const s2 = await start(w, 'naver', { session: a.cookie, browser: s1.browser })
    expect(s2.browser).not.toBe(s1.browser)
    const r = outcome(await open(w, consent(w, s1.authorizeUrl, user.id), { browser: s1.browser, session: a.cookie }))
    expect(r.login).toBe('EXPIRED')
    expect(await count(w, 'login_links')).toBe(0)
    expect(w.fake.exchanges.kakao).toBe(0)
  })

  it('옛 값을 훔쳐 가진 다른 브라우저가 시작해도 그 옛 값의 진행 중 state를 자기 쪽으로 다시 묶어 가지 못한다(이미 새 값으로 넘어감)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('kakao')
    const s1 = await start(w, 'kakao', { session: a.cookie })
    const s2 = await start(w, 'kakao', { session: a.cookie, browser: s1.browser })
    // 공격자 브라우저: 훔친 옛 값으로 시작
    const thief = await start(w, 'kakao', { browser: s1.browser })
    const location = consent(w, s1.authorizeUrl, user.id)
    expect(outcome(await open(w, location, { browser: thief.browser, session: a.cookie })).login).toBe('EXPIRED')
    // 진짜 브라우저(마지막 값)는 그대로 끝난다
    expect(outcome(await open(w, location, { browser: s2.browser, session: a.cookie })).login).toBe('LINKED')
  })
})

describe('AC-L1-03 두 탭 다시 묶기', () => {
  it('탭1 카카오 연결 시작 → 탭2 네이버 연결 시작(새 값) → 탭2 먼저 LINKED(쿠키 유지) → 탭1도 새 값으로 LINKED(이제 쿠키 지움)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const ku = w.fake.addUser('kakao')
    const nu = w.fake.addUser('naver')
    const t1 = await start(w, 'kakao', { session: a.cookie })
    const t2 = await start(w, 'naver', { session: a.cookie, browser: t1.browser })
    const l1 = consent(w, t1.authorizeUrl, ku.id)
    const l2 = consent(w, t2.authorizeUrl, nu.id)
    const r2 = await open(w, l2, { browser: t2.browser, session: a.cookie })
    expect(outcome(r2).login).toBe('LINKED')
    expect(oauthLines(r2)).toEqual([]) // 탭1이 아직 살아 있다
    const r1 = await open(w, l1, { browser: t2.browser, session: a.cookie })
    expect(outcome(r1).login).toBe('LINKED')
    expect(oauthLines(r1)).toHaveLength(1)
    expectHostCookie(oauthLines(r1)[0] as string, '0')
    expect(await count(w, 'login_links', 'account_id = $1', [a.accountId])).toBe(2)
  })

  it('세 탭(로그인 둘 + 연결 아님): 다른 탭에서 로그인을 먼저 끝내도 남은 탭 로그인이 끝난다, 마지막 성공만 쿠키를 지운다', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const users = { google: w.fake.addUser('google'), kakao: w.fake.addUser('kakao'), naver: w.fake.addUser('naver') }
    for (const p of ALL) expect((await flow(w, p, users[p].id, a.cookie)).login).toBe('LINKED')
    let browser: string | undefined
    const tabs = []
    for (const p of ALL) {
      const s = await start(w, p, browser === undefined ? {} : { browser })
      browser = s.browser
      tabs.push({ p, location: consent(w, s.authorizeUrl, users[p].id) })
    }
    const order = [tabs[1], tabs[0], tabs[2]]
    for (const [i, tab] of order.entries()) {
      const r = await open(w, tab?.location as string, { browser })
      const o = outcome(r)
      expect(o.session, tab?.p).not.toBeNull()
      expect((await client(w, o.session).get('/api/me')).body).toMatchObject({ loginId: a.loginId })
      if (i < 2) expect(oauthLines(r), tab?.p).toEqual([])
      else expectHostCookie(oauthLines(r)[0] as string, '0')
    }
  })

  it('다시 묶을 때 이미 쓴 state는 되살아나지 않는다 (재생 없음)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('kakao')
    expect((await flow(w, 'kakao', user.id, a.cookie)).login).toBe('LINKED')
    const s1 = await start(w, 'kakao')
    const loc = consent(w, s1.authorizeUrl, user.id)
    const pending = await start(w, 'naver', { browser: s1.browser }) // s1이 쿠키를 지우지 않도록 남은 state 하나
    const first = outcome(await open(w, loc, { browser: pending.browser }))
    expect(first.session).not.toBeNull()
    const again = await start(w, 'google', { browser: pending.browser })
    expect(outcome(await open(w, loc, { browser: again.browser }))).toMatchObject({ session: null })
    expect(w.fake.exchanges.kakao).toBe(2) // 연결 1 + 로그인 1
  })
})

describe('RA-L1-01 실패한 돌아오기는 쿠키를 지우지 않는다', () => {
  it.each(ALL)('%s: CANCELLED·PROVIDER_ERROR·EXPIRED·NOT_LINKED·LINKED_ELSEWHERE·ALREADY_LINKED 뒤 Set-Cookie에 확인 쿠키 없음, 다른 탭 흐름은 끝난다', async (provider) => {
    const w = await l1World()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const mine = w.fake.addUser(provider)
    const bUser = w.fake.addUser(provider)
    const stranger = w.fake.addUser(provider)
    expect((await flow(w, provider, bUser.id, b.cookie)).login).toBe('LINKED')

    // 다른 탭: 진행 중인 연결 (끝까지 살아 있어야 한다)
    const keep = await start(w, provider, { session: a.cookie })
    const keepLocation = consent(w, keep.authorizeUrl, mine.id)
    let browser = keep.browser
    const tryOne = async (expected: string, run: (s: Awaited<ReturnType<typeof start>>) => Promise<Response>, session: string | null) => {
      const s = await start(w, provider, { browser, session })
      browser = s.browser
      const r = await run(s)
      expect(outcome(r).login, expected).toBe(expected)
      expect(oauthLines(r), expected).toEqual([])
    }
    await tryOne('CANCELLED', async (s) => open(w, consent(w, s.authorizeUrl, null), { browser, session: null }), null)
    await tryOne(
      'PROVIDER_ERROR',
      async (s) => open(w, `${new URL(s.authorizeUrl).searchParams.get('redirect_uri') as string}?error=server_error&state=${s.state}`, { browser }),
      null,
    )
    // EXPIRED(다른 쿠키로 온 돌아오기): 지우지 않고, 그 state는 진짜 브라우저에서 아직 쓸 수 있다
    await tryOne(
      'EXPIRED',
      async (s) => {
        const loc = consent(w, s.authorizeUrl, stranger.id)
        const r = await open(w, loc, { browser: 'x'.repeat(43) })
        const real = await open(w, loc, { browser })
        expect(outcome(real).login).toBe('NOT_LINKED')
        expect(oauthLines(real)).toEqual([])
        return r
      },
      null,
    )
    await tryOne('NOT_LINKED', async (s) => open(w, consent(w, s.authorizeUrl, stranger.id), { browser }), null)
    await tryOne('LINKED_ELSEWHERE', async (s) => open(w, consent(w, s.authorizeUrl, bUser.id), { browser, session: a.cookie }), a.cookie)
    // 쿠키 없이 온 돌아오기(state 없음)도 지우지 않는다
    const bare = await open(w, `${new URL(keep.authorizeUrl).searchParams.get('redirect_uri') as string}?code=x&state=y`, { browser })
    expect(outcome(bare).login).toBe('EXPIRED')
    expect(oauthLines(bare)).toEqual([])

    // 다른 탭은 마지막 값으로 끝나고, 남은 state가 없으면 지운다
    const done = await open(w, keepLocation, { browser, session: a.cookie })
    expect(outcome(done).login).toBe('LINKED')
    // 실패한 시도들이 남긴 state는 이미 쓴 것이라 남은 것이 아니다 — 지우는 줄이 있어야 한다
    expect(oauthLines(done)).toHaveLength(1)
    expectHostCookie(oauthLines(done)[0] as string, '0')

    // ALREADY_LINKED도 지우지 않는다
    const other = w.fake.addUser(provider)
    const s = await start(w, provider, { session: a.cookie, browser })
    const r = await open(w, consent(w, s.authorizeUrl, other.id), { browser: s.browser, session: a.cookie })
    expect(outcome(r).login).toBe('ALREADY_LINKED')
    expect(oauthLines(r)).toEqual([])
  })

  it('취소한 뒤 같은 탭에서 다시 시작하면 그대로 성공 (쿠키를 지우지 않았어도 새 값)', async () => {
    const w = await l1World()
    const a = await addSeller(w)
    const user = w.fake.addUser('naver')
    const s1 = await start(w, 'naver', { session: a.cookie })
    expect(outcome(await open(w, consent(w, s1.authorizeUrl, null), { browser: s1.browser, session: a.cookie })).login).toBe('CANCELLED')
    const s2 = await start(w, 'naver', { session: a.cookie, browser: s1.browser })
    expect(s2.browser).not.toBe(s1.browser)
    expect(outcome(await open(w, consent(w, s2.authorizeUrl, user.id), { browser: s2.browser, session: a.cookie })).login).toBe('LINKED')
  })
})
