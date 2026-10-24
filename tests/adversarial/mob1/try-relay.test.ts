// MOB1 적대 시험 (test-domain): 연습 모드 휴대폰 https 중계 공격 (AC-MOB1-09, AC-MOB1-89, D-MOB1-06).
// - 연습 전용 가짜 구글 경로(/_try/google/…)는 가짜 구글(127.0.0.1:<가짜 포트>)로만 넘긴다: `..`·`//다른주소`·`@`·`%2F`·절대 주소·다른 포트를 넣어도
//   다른 곳으로 나가는 요청 0개(404 또는 가짜 구글의 같은 경로). 미끼 서버와 TCP 연결 기록으로 센다.
// - Location·authorizeUrl 바꾸기는 정확히 `http://localhost:<포트>/`(가짜 구글은 `http://127.0.0.1:<가짜 포트>/o/oauth2/v2/auth`)로 시작할 때만.
//   무작위 글 1,000개에서 바꾼 결과의 출처는 늘 (원래 출처) 또는 (휴대폰 https 주소).
// - 진짜 구글 모드: 휴대폰 주소의 시작 요청 1,000번(본문·머리글 무작위) → 모두 409, 안쪽 서버의 연결 시작 0번, 구글로 나가는 요청 0개.
// - TD-MOB1-001: 진짜 구글 모드에서 안쪽 서버가 "연결 시작"으로 읽는 다른 모양의 경로(`./`·`x/../`·`%73tart`·`#`·절대 주소)는 중계가 연결 시작으로 알아보지 못해
//   그대로 넘기고, 휴대폰이 실제 구글 승인 주소(accounts.google.com)를 받는다.
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { FAKE_GOOGLE_AUTHORIZE_PATH, FAKE_GOOGLE_PREFIX, TRY_PHONE_YOUTUBE, fakeGoogleTarget, phoneYoutubeMessage, relayAuthorizeUrl, swapOrigin } from '../../../scripts/try/phone-relay.mjs'
import { json, takeDials, tryWorld, type TryWorld } from './helpers.ts'

const worlds: TryWorld[] = []
afterAll(async () => {
  for (const item of worlds) await item.close()
})
async function world(real: boolean): Promise<TryWorld> {
  const item = await tryWorld({ real })
  worlds.push(item)
  return item
}

/** 연결 기록 가운데 허용한 곳(127.0.0.1·localhost의 허용 포트) 밖으로 간 것 */
function strayDials(allowed: readonly number[], mustSee: readonly number[] = []): string[] {
  const all = takeDials()
  // 기록 장치가 실제로 연결을 잡는지(빈 기록으로 통과하지 않게) — 꼭 지나야 하는 포트가 기록에 있어야 한다
  for (const port of mustSee) expect(all.some((dial) => dial.port === port), `연결 기록에 ${String(port)}이 없다`).toBe(true)
  return all
    .filter((dial) => !(['127.0.0.1', 'localhost', '::1'].includes(dial.host) && allowed.includes(dial.port)))
    .map((dial) => `${dial.host}:${String(dial.port)}`)
}

const originOf = (text: string): string | null => {
  try {
    return new URL(text).origin
  } catch {
    return null
  }
}

describe('AC-MOB1-09 연습 전용 가짜 구글 경로는 가짜 구글로만', () => {
  it('조작 경로(`..`·`//다른주소`·`@`·`%2F`·절대 주소·다른 포트·Host 바꾸기)는 404이거나 가짜 구글의 같은 승인 경로 — 미끼·다른 곳 연결 0', async () => {
    const item = await world(false)
    const decoy = `127.0.0.1:${String(item.decoyPort)}`
    const head = `${FAKE_GOOGLE_PREFIX}${FAKE_GOOGLE_AUTHORIZE_PATH}`
    const targets = [
      `${head}/../../../../_fake/approval`,
      `${head}/..%2F..%2Ftoken`,
      `${FAKE_GOOGLE_PREFIX}/..%2F..%2F_fake`,
      `${FAKE_GOOGLE_PREFIX}/%2E%2E/%2E%2E/token`,
      `${FAKE_GOOGLE_PREFIX}//${decoy}${FAKE_GOOGLE_AUTHORIZE_PATH}`,
      `${FAKE_GOOGLE_PREFIX}/@${decoy}${FAKE_GOOGLE_AUTHORIZE_PATH}`,
      `${head}@${decoy}/`,
      `${head}:${String(item.decoyPort)}`,
      `${head}%2F..%2F..%2Ftoken`,
      `${head}%3Fx=1`,
      `${head}\\..\\..\\token`,
      `${head}/`,
      `${head}?x=1@${decoy}/`,
      `${head}?redirect_uri=http://${decoy}/&client_id=nope`,
      `${head}?a=%0d%0aHost:%20${decoy}`,
      `http://${decoy}${head}?x=1`,
      `https://${decoy}${head}`,
      `//${decoy}${head}`,
      `${FAKE_GOOGLE_PREFIX}`,
      `${FAKE_GOOGLE_PREFIX}?u=http://${decoy}/`,
      `${FAKE_GOOGLE_PREFIX}/http://${decoy}/`,
      `${FAKE_GOOGLE_PREFIX}/o/oauth2/v2/token`,
      `${FAKE_GOOGLE_PREFIX}/_fake/approval`,
    ]
    takeDials()
    const authBefore = item.fake.calls('oauth.auth')
    let reachedAuth = 0
    for (const target of targets) {
      for (const method of ['GET', 'POST', 'HEAD', 'OPTIONS']) {
        const reply = await item.raw(`${method} ${target} HTTP/1.1`, method === 'POST' ? { 'content-length': '0' } : {})
        const forwarded = method === 'GET' && fakeGoogleTarget(target) !== null
        if (forwarded) {
          reachedAuth += 1
          // 가짜 구글의 승인 경로에만 닿는다(client_id가 틀리면 가짜 구글이 400)
          expect([302, 400], `${method} ${target}`).toContain(reply.status)
        } else if (target.startsWith(`${FAKE_GOOGLE_PREFIX}`) && (target === FAKE_GOOGLE_PREFIX || target[FAKE_GOOGLE_PREFIX.length] === '/' || target[FAKE_GOOGLE_PREFIX.length] === '?')) {
          expect(reply.status, `${method} ${target}`).toBe(404)
        } else {
          // 연습 전용 경로가 아닌 대상(절대 주소 등)은 안쪽 서버로만 간다 — 어디로 가든 미끼에는 닿지 않는다
          expect(reply.status, `${method} ${target}`).toBeGreaterThan(0)
        }
      }
    }
    // Host 머리글을 미끼로 바꿔도(알 수 없는 휴대폰 주소) 연습 전용 경로는 404, 넘기지 않는다
    for (const host of [decoy, `${decoy}@127.0.0.1`, 'evil.example', `127.0.0.1:${String(item.fake.port)}`]) {
      const reply = await item.raw(`GET ${head}?client_id=${item.fake.clientId}&redirect_uri=http://${decoy}/ HTTP/1.1`, { host })
      expect(reply.status, host).toBe(404)
    }
    expect(item.decoyHits).toEqual([])
    expect(item.fake.calls('oauth.auth') - authBefore).toBe(reachedAuth)
    expect(strayDials([item.phonePort, item.port, item.fake.port], [item.phonePort, item.fake.port])).toEqual([])
  })

  it('무작위 대상 400개(조각 섞기) — 넘기는 것은 fakeGoogleTarget이 허락한 것뿐이고, 닿는 곳은 가짜 구글·안쪽 서버뿐', async () => {
    const item = await world(false)
    const decoy = `127.0.0.1:${String(item.decoyPort)}`
    const pieces = ['/_try/google', '/o/oauth2/v2/auth', '/', '//', '..', '%2F', '%2f', '%2E', '@', decoy, `:${String(item.decoyPort)}`, '?', '#', '&', '=', 'redirect_uri=http://' + decoy + '/', '\\', ';', 'token', '_fake', 'http:', 'https:', '%00', '%0d%0a', 'é', '한']
    const arb = fc.array(fc.constantFrom(...pieces), { minLength: 1, maxLength: 8 }).map((parts) => {
      const text = parts.join('')
      return text.startsWith('/') || /^https?:/.test(text) ? text : `/${text}`
    })
    const samples = fc.sample(arb, { numRuns: 400, seed: 20261025 })
    samples.push(...fc.sample(arb.map((t) => `/_try/google${t}`), { numRuns: 200, seed: 77 }))
    takeDials()
    const before = item.fake.calls()
    let allowed = 0
    for (const target of samples) {
      // 요청 줄 글자는 latin1 바이트로 — 한글은 UTF-8 바이트를 latin1로 보낸다(브라우저가 보내는 퍼센트 인코딩 전 바이트 흉내)
      const line = Buffer.from(target, 'utf8').toString('latin1')
      const reply = await item.raw(`GET ${line} HTTP/1.1`)
      const isPrefix = line === FAKE_GOOGLE_PREFIX || line.startsWith(`${FAKE_GOOGLE_PREFIX}/`) || line.startsWith(`${FAKE_GOOGLE_PREFIX}?`)
      // 400은 Node의 요청 줄 읽기가 처리기 앞에서 막은 것(바이트가 요청 줄에 쓸 수 없는 글자) — 어디로도 넘기지 않는다
      if (isPrefix && fakeGoogleTarget(line) === null) expect([400, 404], line).toContain(reply.status)
      if (isPrefix && fakeGoogleTarget(line) !== null) allowed += 1
    }
    expect(item.decoyHits).toEqual([])
    expect(item.fake.calls() - before).toBe(allowed)
    expect(strayDials([item.phonePort, item.port, item.fake.port], [item.phonePort, item.fake.port])).toEqual([])
  })

  it('fakeGoogleTarget(순수): 결과가 있으면 늘 정확히 `/o/oauth2/v2/auth` 또는 그 뒤 `?…`, 공백·제어 글자 없음 — 무작위 2,000개', () => {
    const arb = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 60 }).map((s) => `${FAKE_GOOGLE_PREFIX}${FAKE_GOOGLE_AUTHORIZE_PATH}${s}`),
      fc.string({ unit: 'binary', maxLength: 60 }).map((s) => `${FAKE_GOOGLE_PREFIX}${s}`),
      fc.string({ unit: 'binary', maxLength: 60 }),
    )
    fc.assert(
      fc.property(arb, (target) => {
        const out = fakeGoogleTarget(target)
        if (out === null) return
        expect(out === FAKE_GOOGLE_AUTHORIZE_PATH || out.startsWith(`${FAKE_GOOGLE_AUTHORIZE_PATH}?`)).toBe(true)
        expect([...out].some((ch) => (ch.codePointAt(0) ?? 0) <= 0x20 || ch === '\u007f' || /\s/u.test(ch))).toBe(false)
        // 넘긴 경로를 가짜 구글 출처에 붙여 읽어도 출처·경로가 그대로
        const url = new URL(out, 'http://127.0.0.1:5123')
        expect(url.origin).toBe('http://127.0.0.1:5123')
        expect(url.pathname).toBe(FAKE_GOOGLE_AUTHORIZE_PATH)
      }),
      { numRuns: 2000, seed: 1025 },
    )
  })
})

describe('AC-MOB1-09 주소 바꾸기는 정확히 그 출처로 시작할 때만', () => {
  const app = 'http://localhost:7700'
  const here = 'https://192.0.2.10:7701'
  const google = 'http://127.0.0.1:5123'
  const prefixes = [
    `${app}/`,
    `${app}`,
    `${app}@evil/`,
    `${app}.evil/`,
    `${app}0/`,
    `${app}:80/`,
    `${app}\\`,
    `${app}%2F`,
    `https://evil/?u=${app}/`,
    'http://localhost:7701/',
    'http://LOCALHOST:7700/',
    'HTTP://localhost:7700/',
    'http://127.0.0.1:7700/',
    `//localhost:7700/`,
    ` ${app}/`,
    `\t${app}/`,
    `${google}${FAKE_GOOGLE_AUTHORIZE_PATH}`,
    `${google}${FAKE_GOOGLE_AUTHORIZE_PATH}?`,
    `${google}${FAKE_GOOGLE_AUTHORIZE_PATH}#`,
    `${google}${FAKE_GOOGLE_AUTHORIZE_PATH}@evil/`,
    `${google}${FAKE_GOOGLE_AUTHORIZE_PATH}/../../token`,
    `${google}@evil${FAKE_GOOGLE_AUTHORIZE_PATH}`,
    'http://127.0.0.1:5124/o/oauth2/v2/auth?',
    'https://accounts.google.com/o/oauth2/v2/auth?',
    '',
  ]
  const tails = fc.oneof(
    fc.string({ maxLength: 40 }),
    fc.string({ unit: 'binary', maxLength: 40 }),
    fc.array(fc.constantFrom('/', '\\', '@', '.', ':', '?', '#', '%2F', 'evil', '//evil.example', '\t', '\n', ' ', '..', 'redirect_uri=http://localhost:7700/'), { maxLength: 8 }).map((p) => p.join('')),
  )
  const texts = fc.tuple(fc.constantFrom(...prefixes), tails).map(([a, b]) => `${a}${b}`)

  it('swapOrigin: 무작위 1,000개 — `<출처>/`로 시작할 때만 바뀌고, 결과 출처는 (원래 출처) 또는 (휴대폰 주소)', () => {
    fc.assert(
      fc.property(texts, (text) => {
        const out = swapOrigin(text, app, here)
        if (text.startsWith(`${app}/`)) expect(out).toBe(`${here}${text.slice(app.length)}`)
        else expect(out).toBe(text)
        const before = originOf(text)
        const after = originOf(out)
        if (after !== null) expect([before, here]).toContain(after)
        if (out !== text) expect(after).toBe(here)
      }),
      { numRuns: 1000, seed: 9 },
    )
  })

  it('relayAuthorizeUrl: 무작위 1,000개 — 바뀌면 출처는 휴대폰 주소이고 경로는 연습 전용 승인 경로, 바뀌지 않으면 글자 그대로', () => {
    fc.assert(
      fc.property(texts, (text) => {
        const out = relayAuthorizeUrl(text, google, here)
        const before = originOf(text)
        const after = originOf(out)
        if (out === text) return
        expect(after).toBe(here)
        expect(after).not.toBe(before)
        const url = new URL(out)
        expect(url.pathname).toBe(`${FAKE_GOOGLE_PREFIX}${FAKE_GOOGLE_AUTHORIZE_PATH}`)
        // 휴대폰 브라우저가 이 주소로 오면 중계는 가짜 구글의 승인 경로로 넘긴다(쿼리 그대로) — 같은 쿼리면 둘이 어긋나지 않는다
        const rest = text.slice(`${google}${FAKE_GOOGLE_AUTHORIZE_PATH}`.length)
        expect(rest === '' || rest.startsWith('?') || rest.startsWith('#')).toBe(true)
      }),
      { numRuns: 1000, seed: 11 },
    )
  })

  it('실제 가짜 구글 승인 주소(무작위 state·scope)를 바꾸면 중계가 그 주소를 가짜 구글 같은 쿼리로 넘긴다', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), (state, scope) => {
        const original = new URL(`${google}${FAKE_GOOGLE_AUTHORIZE_PATH}`)
        original.searchParams.set('client_id', 'fake-client-id')
        original.searchParams.set('redirect_uri', `${app}/api/youtube/oauth/callback`)
        original.searchParams.set('state', state)
        original.searchParams.set('scope', scope)
        const relayed = new URL(relayAuthorizeUrl(original.toString(), google, here))
        expect(relayed.origin).toBe(here)
        const target = fakeGoogleTarget(`${relayed.pathname}${relayed.search}`)
        expect(target).toBe(`${FAKE_GOOGLE_AUTHORIZE_PATH}${original.search}`)
        expect(relayed.searchParams.get('redirect_uri')).toBe(`${app}/api/youtube/oauth/callback`)
      }),
      { numRuns: 300, seed: 13 },
    )
  })
})

describe('AC-MOB1-09 진짜 구글 모드: 휴대폰 주소의 연결 시작은 늘 409', () => {
  it('시작 요청 1,000번(본문·머리글 무작위) → 모두 409 TRY_PHONE_YOUTUBE, 안쪽 서버의 연결 시작 0번, 구글로 나가는 요청 0개', async () => {
    const item = await world(true)
    const cookie = await item.phoneLogin()
    const headerNames = ['content-type', 'x-forwarded-host', 'x-forwarded-proto', 'x-http-method-override', 'x-original-url', 'x-rewrite-url', 'origin', 'referer', 'accept', 'accept-encoding', 'user-agent', 'forwarded', 'x-real-ip', 'cookie']
    const headerValues = ['application/json', 'text/plain', 'GET', 'PUT', '/api/youtube/connection', 'http://localhost', `http://localhost:${String(item.port)}`, item.here, 'https://accounts.google.com', 'gzip, br', 'for=127.0.0.1;host=localhost', cookie, 'lj_session=nope', '', 'iPhone Safari']
    const arb = fc.record({
      headers: fc.dictionary(fc.constantFrom(...headerNames), fc.constantFrom(...headerValues), { maxKeys: 5 }),
      body: fc.oneof(fc.constant(undefined), fc.json({ maxDepth: 2 }), fc.string({ maxLength: 200 }), fc.constant('{}'), fc.constant('{"redirect":"x"}')),
      chunked: fc.boolean(),
      withCookie: fc.boolean(),
      query: fc.constantFrom('', '?', '?x=1', '?redirect_uri=http://localhost/', '?a=%2F..'),
    })
    const cases = fc.sample(arb, { numRuns: 1000, seed: 1000 })
    takeDials()
    const innerStartsBefore = item.inner.filter((line) => line.endsWith('/youtube/connection/start')).length
    const statuses = new Map<number, number>()
    for (const c of cases) {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(c.headers)) if (v !== '' || k !== 'cookie') headers[k] = v
      const options: { cookie?: string; body?: string; headers: Record<string, string>; chunked: boolean } = { headers, chunked: c.chunked }
      if (c.withCookie) options.cookie = cookie
      if (c.body !== undefined) options.body = c.body
      const reply = await item.phone('POST', `/api/youtube/connection/start${c.query}`, options)
      statuses.set(reply.status, (statuses.get(reply.status) ?? 0) + 1)
      if (reply.status !== 409) continue
      expect(json(reply)).toEqual({ error: { code: TRY_PHONE_YOUTUBE, message: phoneYoutubeMessage(item.port) } })
    }
    expect(Object.fromEntries(statuses)).toEqual({ 409: 1000 })
    expect(item.inner.filter((line) => line.endsWith('/youtube/connection/start')).length).toBe(innerStartsBefore)
    // 연결은 휴대폰 https 포트뿐(시험 클라이언트) — 안쪽 서버로도, 다른 곳으로도 가지 않는다
    expect(strayDials([item.phonePort])).toEqual([])
  })

  it('TD-MOB1-001: 안쪽 서버가 연결 시작으로 읽는 다른 모양의 경로도 409 — 휴대폰이 실제 구글 승인 주소를 받지 않는다', async () => {
    const item = await world(true)
    const cookie = await item.phoneLogin()
    const variants = [
      '/api/youtube/connection/./start',
      '/api/youtube/x/../connection/start',
      '/api/youtube/connection/%73tart',
      '/api/youtube/connection/%2e/start',
      `http://localhost:${String(item.port)}/api/youtube/connection/start`,
    ]
    const leaked: string[] = []
    for (const path of variants) {
      const reply = await item.phone('POST', path, { cookie, body: '{}', headers: { 'content-type': 'application/json' } })
      if (reply.status !== 409 || reply.text.includes('accounts.google.com')) leaked.push(`${path} → ${String(reply.status)} ${reply.text.slice(0, 60)}`)
    }
    // `#`이 든 요청 줄(브라우저는 보내지 않지만 안쪽 서버는 조각을 떼고 연결 시작으로 읽는다)
    const raw = await item.raw('POST /api/youtube/connection/start#x HTTP/1.1', { cookie, origin: item.here, 'content-type': 'application/json', 'content-length': '0' })
    if (raw.body.includes('accounts.google.com')) leaked.push(`/api/youtube/connection/start#x → ${String(raw.status)}`)
    expect(leaked).toEqual([])
  })
})
