// 라운드 2: 세션·연결이 공급자 왕복(최대 10초) 도중에 바뀌는 경우 (AC-L1-06·07).
// TD-L1-001 고침의 회귀(끊기와 겹친 로그인, 시험 주입점으로 순서를 고정)와, 같은 계열의 남은 구멍 TD-L1-005(연결 도중 로그아웃).
import { afterAll, describe, expect, it } from 'vitest'
import { addSeller, client, closeAll, consent, count, l1World, open, outcome, start } from './helpers.ts'

afterAll(closeAll)

describe('TD-L1-001 회귀: 끊기와 겹친 로그인 (순서 고정)', () => {
  it('TD-L1-001: 로그인이 연결을 찾은 뒤 끊기가 끝나면 NOT_LINKED, 그 공급자 세션 0', async () => {
    let between: (() => Promise<void>) | null = null
    const w = await l1World({
      providers: ['kakao'],
      hooks: {
        beforeLoginSession: async () => {
          const hook = between
          between = null
          if (hook !== null) await hook()
        },
      },
    })
    const seller = await addSeller(w)
    const user = w.fake.addUser('kakao')
    const link = await start(w, 'kakao', { session: seller.cookie })
    expect(outcome(await open(w, consent(w, link.authorizeUrl, user.id), { browser: link.browser, session: seller.cookie })).login).toBe('LINKED')

    const attacker = await start(w, 'kakao')
    let unlinkStatus = 0
    between = async () => {
      unlinkStatus = (await client(w, seller.cookie).post('/api/auth/unlink', { provider: 'kakao' })).status
    }
    const result = outcome(await open(w, consent(w, attacker.authorizeUrl, user.id), { browser: attacker.browser }))
    expect(unlinkStatus).toBe(200)
    expect(result.login).toBe('NOT_LINKED')
    expect(result.session).toBeNull()
    expect(await count(w, 'sessions', `account_id = $1 and method = 'KAKAO'`, [seller.accountId])).toBe(0)
  })

  it('TD-L1-001: 끊고 곧바로 그 공급자의 다른 계정을 연결해도, 끊은 계정으로 하던 로그인은 NOT_LINKED', async () => {
    let between: (() => Promise<void>) | null = null
    const w = await l1World({
      providers: ['kakao'],
      hooks: {
        beforeLoginSession: async () => {
          const hook = between
          between = null
          if (hook !== null) await hook()
        },
      },
    })
    const seller = await addSeller(w)
    const stolen = w.fake.addUser('kakao')
    const fresh = w.fake.addUser('kakao')
    const first = await start(w, 'kakao', { session: seller.cookie })
    expect(outcome(await open(w, consent(w, first.authorizeUrl, stolen.id), { browser: first.browser, session: seller.cookie })).login).toBe('LINKED')

    const attacker = await start(w, 'kakao')
    between = async () => {
      expect((await client(w, seller.cookie).post('/api/auth/unlink', { provider: 'kakao' })).status).toBe(200)
      const again = await start(w, 'kakao', { session: seller.cookie })
      expect(outcome(await open(w, consent(w, again.authorizeUrl, fresh.id), { browser: again.browser, session: seller.cookie })).login).toBe('LINKED')
    }
    const result = outcome(await open(w, consent(w, attacker.authorizeUrl, stolen.id), { browser: attacker.browser }))
    expect(result.login).toBe('NOT_LINKED')
    expect(await count(w, 'sessions', `account_id = $1 and method = 'KAKAO'`, [seller.accountId])).toBe(0)
    expect(await count(w, 'login_links', 'account_id = $1', [seller.accountId])).toBe(1)
  })

  it('TD-L1-001: 로그인이 먼저 세션을 넣으면 뒤따른 끊기가 그 세션을 지운다 (/api/me 401)', async () => {
    let between: (() => void) | null = null
    let pending: Promise<number> | null = null
    const w = await l1World({
      providers: ['naver'],
      hooks: {
        beforeLoginSession: () => {
          const hook = between
          between = null
          if (hook !== null) hook()
        },
      },
    })
    const seller = await addSeller(w)
    const user = w.fake.addUser('naver')
    const link = await start(w, 'naver', { session: seller.cookie })
    expect(outcome(await open(w, consent(w, link.authorizeUrl, user.id), { browser: link.browser, session: seller.cookie })).login).toBe('LINKED')
    const attacker = await start(w, 'naver')
    between = () => {
      // 기다리지 않는다: 로그인 거래와 끊기 거래가 잠금을 두고 겨룬다
      pending = client(w, seller.cookie)
        .post('/api/auth/unlink', { provider: 'naver' })
        .then((r) => r.status)
    }
    const result = outcome(await open(w, consent(w, attacker.authorizeUrl, user.id), { browser: attacker.browser }))
    expect(pending).not.toBeNull()
    expect(await (pending as unknown as Promise<number>)).toBe(200)
    if (result.session !== null) expect((await client(w, result.session).get('/api/me')).status).toBe(401)
    expect(await count(w, 'sessions', `account_id = $1 and method = 'NAVER'`, [seller.accountId])).toBe(0)
  })
})

describe('TD-L1-005 연결 도중 로그아웃', () => {
  it('TD-L1-005: state 확인 뒤·공급자 왕복 중에 판매자가 로그아웃하면 SESSION_GONE이고 연결이 생기지 않는다 (AC-L1-06)', async () => {
    let between: (() => Promise<void>) | null = null
    const w = await l1World({
      providers: ['kakao'],
      hooks: {
        afterClaim: async () => {
          const hook = between
          between = null
          if (hook !== null) await hook()
        },
      },
    })
    const seller = await addSeller(w)
    const user = w.fake.addUser('kakao')
    const link = await start(w, 'kakao', { session: seller.cookie })
    between = async () => {
      // 공급자 왕복(최대 10초) 동안 판매자가 [로그아웃] (또는 세션을 훔친 쪽이 쓰던 세션이 끝남)
      expect((await client(w, seller.cookie).post('/api/logout', {})).status).toBeLessThan(300)
    }
    const result = outcome(await open(w, consent(w, link.authorizeUrl, user.id), { browser: link.browser, session: seller.cookie }))
    expect(await count(w, 'sessions', 'account_id = $1', [seller.accountId])).toBe(0)
    expect(await count(w, 'login_links', 'account_id = $1', [seller.accountId])).toBe(0)
    expect(result.login).toBe('SESSION_GONE')
  })
})
