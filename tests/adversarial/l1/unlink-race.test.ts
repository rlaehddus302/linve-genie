// TD-L1-001: 끊기와 동시에 끝나는 간편 로그인 (AC-L1-07 "그 계정에서 그 공급자로 만든 세션이 모두 지워진다", "끊은 뒤 그 공급자 계정으로 간편 로그인하면 NOT_LINKED").
// 공급자에서 사용자 정보를 받은 바로 그때 판매자가 [연결 끊기]를 누르면, 돌아오는 주소 처리가 연결 행을 읽은 뒤·세션을 넣기 전에 끊기 거래가 끝난다.
// 끊기는 200(연결 없음·그 공급자 세션 지움)으로 끝났는데, 끊은 공급자 계정으로 만든 새 세션이 30일짜리로 살아 남는다.
// 실제 사고: 카카오 계정을 빼앗긴 판매자가 서둘러 끊어도, 그 순간 공격자가 로그인을 마치면 공격자 세션이 남는다(설정 화면엔 "연결 안 됨").
import { afterAll, describe, expect, it } from 'vitest'
import { addSeller, client, closeAll, consent, count, l1World, open, outcome, start } from './helpers.ts'

afterAll(closeAll)

describe('TD-L1-001 끊기와 겹친 간편 로그인', () => {
  it('TD-L1-001: 사용자 정보를 받은 직후 끊기가 끝나면, 끊은 공급자로 만든 세션이 남지 않는다', async () => {
    let onUserinfo: (() => void) | null = null
    const w = await l1World({
      providers: ['kakao'],
      wrap: (setup) => ({
        ...setup,
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init)
          const hook = onUserinfo
          if (hook === null || !String(input instanceof Request ? input.url : input).endsWith('/userinfo')) return response
          onUserinfo = null
          const text = await response.text()
          hook()
          return new Response(text, {
            status: response.status,
            headers: response.headers,
          })
        },
      }),
    })
    const survivors: string[] = []
    for (let round = 0; round < 3; round++) {
      const seller = await addSeller(w)
      const user = w.fake.addUser('kakao')
      const link = await start(w, 'kakao', { session: seller.cookie })
      expect(
        outcome(
          await open(w, consent(w, link.authorizeUrl, user.id), {
            browser: link.browser,
            session: seller.cookie,
          }),
        ).login,
      ).toBe('LINKED')

      // 다른 기기(공격자)가 카카오로 로그인하는 중
      const attacker = await start(w, 'kakao')
      let unlinked: Promise<number> | null = null
      onUserinfo = () => {
        // 판매자가 설정에서 [연결 끊기]
        unlinked = client(w, seller.cookie)
          .post('/api/auth/unlink', { provider: 'kakao' })
          .then((r) => r.status)
      }
      const result = outcome(
        await open(w, consent(w, attacker.authorizeUrl, user.id), {
          browser: attacker.browser,
        }),
      )
      expect(unlinked).not.toBeNull()
      expect(await (unlinked as unknown as Promise<number>)).toBe(200)
      expect(await count(w, 'login_links', 'account_id = $1', [seller.accountId])).toBe(0)
      if (result.session !== null && (await client(w, result.session).get('/api/me')).status === 200) survivors.push(`round ${String(round)}`)
      expect(await count(w, 'sessions', `account_id = $1 and method = 'KAKAO'`, [seller.accountId]), `round ${String(round)}`).toBe(0)
    }
    expect(survivors).toEqual([])
  })
})
