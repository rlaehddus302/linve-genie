// AC-L1-09 비밀 보호 — 토큰·코드·state·ID (D-L1-04, 절대 규칙 7): 표시 값을 쓰는 가짜 공급자로 연결·로그인·실패 흐름을 돈 뒤
// 로그 전체·DB 덤프 전체·API 응답 본문과 머리글(302 Location 포함)에 토큰·코드·이메일 원문·클라이언트 비밀값이 없고, state 원문은 DB·로그에 없으며,
// 공급자 계정 ID는 연결 표 밖에 없다. 동시 사용(같은 돌아오는 주소 20번)도 여기서 본다.
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { formatLog } from '../src/log.ts'
import type { ProviderId } from '../src/social/providers.ts'
import { addSeller, client } from './support.ts'
import { ALL_PROVIDERS, approve, cookieValue, newSocialWorld, openCallback, resultOf, startFlow, type SocialWorld } from './l1-support.ts'
import { dumpText } from './youtube-support.ts'

const worlds: SocialWorld[] = []
afterAll(async () => {
  for (const world of worlds) await world.fake.close()
})

describe('AC-L1-09 비밀 보호', () => {
  it('연결·로그인·실패(교환 실패·5xx·시간 초과·invalid_grant) 뒤 로그·DB·응답에 표시 값이 없다', async () => {
    const w = await newSocialWorld({
      timeoutMs: 300,
      fake: {
        codePrefix: 'CODE-SENTINEL-',
        tokenPrefix: 'TOKEN-SENTINEL-',
        clients: {
          google: { clientId: 'fake-google-client', clientSecret: 'SECRET-SENTINEL-google' },
          kakao: { clientId: 'fake-kakao-rest-key', clientSecret: 'SECRET-SENTINEL-kakao' },
          naver: { clientId: 'fake-naver-client', clientSecret: 'SECRET-SENTINEL-naver' },
        },
      },
    })
    worlds.push(w)
    const seller = await addSeller(w)
    const responses: string[] = []
    const states: string[] = []
    const record = async (response: Response) => {
      responses.push(`${String(response.status)} ${JSON.stringify([...response.headers])} ${await response.clone().text()}`)
      return response
    }
    const flow = async (provider: ProviderId, user: string, session?: string) => {
      const started = await startFlow(w, provider, session === undefined ? {} : { session })
      states.push(new URL(started.authorizeUrl).searchParams.get('state') as string)
      const response = await record(await openCallback(w, approve(w.fake, started.authorizeUrl, user), { browser: started.browser, ...(session === undefined ? {} : { session }) }))
      const token = cookieValue(response.headers, 'lj_session')
      return { result: resultOf(response), session: token === null ? null : `lj_session=${token}` }
    }
    for (const provider of ALL_PROVIDERS) {
      const user = w.fake.addUser(provider, { id: `ID-SENTINEL-${provider}`, email: `email-sentinel-${provider}@example.com`, nickname: 'NICK-SENTINEL' })
      expect((await flow(provider, user.id, seller.cookie)).result.login).toBe('LINKED')
      const logged = await flow(provider, user.id)
      expect(logged.session).not.toBeNull()
      for (const path of ['/api/auth/methods', '/api/me', '/api/client-config']) {
        const response = await client(w, logged.session).get(path)
        responses.push(response.text, JSON.stringify([...response.headers]))
      }
      for (const fault of [{ status: 500 }, { error: 'invalid_grant' as const }, { delayMs: 800 }]) {
        w.fake.failNext(provider, 'token', fault)
        expect((await flow(provider, user.id)).result.login).toBe('PROVIDER_ERROR')
      }
      w.fake.failNext(provider, 'userinfo', { status: 502 })
      expect((await flow(provider, user.id)).result.login).toBe('PROVIDER_ERROR')
      // 연결 안 된 표시 계정·이미 다른 판매자
      const stranger = w.fake.addUser(provider, { id: `ID-SENTINEL-x-${provider}`, email: 'email-sentinel-x@example.com' })
      expect((await flow(provider, stranger.id)).result.login).toBe('SIGNUP')
      const unlink = await client(w, seller.cookie).post('/api/auth/unlink', { provider })
      responses.push(unlink.text)
    }
    const logs = JSON.stringify(w.logs) + w.logs.map((item) => formatLog(item)).join('\n')
    const db = await dumpText(w)
    const api = responses.join('\n')
    for (const sentinel of ['TOKEN-SENTINEL', 'CODE-SENTINEL', 'SECRET-SENTINEL', 'email-sentinel', 'NICK-SENTINEL']) {
      expect(logs, sentinel).not.toContain(sentinel)
      expect(db, sentinel).not.toContain(sentinel)
      expect(api, sentinel).not.toContain(sentinel)
    }
    expect(logs).not.toContain('ID-SENTINEL')
    expect(api).not.toContain('ID-SENTINEL')
    for (const state of states) {
      expect(db).not.toContain(state)
      expect(logs).not.toContain(state)
    }
    // 공급자 계정 ID는 연결 표 밖(다른 표)에 없다 — 끊은 뒤 연결 표에도 남지 않는다
    const pg = w.database.pglite as PGlite
    const tables = (await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`)).rows
    for (const { table_name } of tables) {
      const text = JSON.stringify((await pg.query(`select * from "${table_name}"`)).rows)
      if (table_name !== 'login_links') expect(text, table_name).not.toContain('ID-SENTINEL')
    }
    // 로그에는 공급자 이름·결과 코드·오류 종류만
    for (const item of w.logs.filter((entry) => entry.code === 'SOCIAL_LOGIN')) {
      expect(Object.keys(item).every((key) => ['level', 'code', 'provider', 'reason', 'errorKind', 'status', 'count'].includes(key)), JSON.stringify(item)).toBe(true)
    }
  })
})

describe('AC-L1-04 동시 사용', () => {
  it('같은 돌아오는 주소를 동시에 20번 → 세션 하나, 공급자 교환 한 번', async () => {
    const w = await newSocialWorld()
    worlds.push(w)
    const seller = await addSeller(w)
    const user = w.fake.addUser('kakao')
    const linked = await startFlow(w, 'kakao', { session: seller.cookie })
    await openCallback(w, approve(w.fake, linked.authorizeUrl, user.id), { browser: linked.browser, session: seller.cookie })
    w.fake.reset()
    const pg = w.database.pglite as PGlite
    const before = (await pg.query<{ n: number }>(`select count(*)::int as n from sessions`)).rows[0]?.n ?? 0
    const started = await startFlow(w, 'kakao')
    const location = approve(w.fake, started.authorizeUrl, user.id)
    const results = await Promise.all(Array.from({ length: 20 }, async () => resultOf(await openCallback(w, location, { browser: started.browser })).location))
    expect(results.filter((item) => item.endsWith('/')).length).toBe(1)
    expect(results.filter((item) => item.includes('login=EXPIRED')).length).toBe(19)
    expect(w.fake.exchanges.kakao).toBe(1)
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from sessions`)).rows[0]?.n).toBe(before + 1)
  })
})
