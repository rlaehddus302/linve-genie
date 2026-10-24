// QS1 적대 시험 (test-domain): 확장 연결 코드 넣기 한도 공격 (AC-QS1-32, D-QS1-06, SPEC YT-10 AC4 "코드 넣기 한도").
// - 위조 X-Forwarded-For(믿는 수 밖)·IPv6 같은 /64·IPv4를 담은 IPv6 표기로 주소 한도를 피하지 못한다(같은 키).
// - 보조자·로그인하지 않은 요청은 코드를 만들 수 없어 믿는 주소를 만들 수 없다. 한 판매자가 수십 번 다시 만들어도 믿는 주소는 3개 이하.
// - 믿는 주소에서 틀린 코드를 맞혀 보면 주소 한도 20번에 막힌다 — 다른 주소를 많이 써서 주소 기록을 밀어내도.
// 주소는 요청 정보(env.incoming.socket.remoteAddress)로 넣는다. 형식이 틀린 코드('x')도 한도에는 센다(DB는 보지 않는다).
import { afterEach, describe, expect, it } from 'vitest'
import { EXT_CODE_GLOBAL_MAX } from '../../../apps/server/src/extension/routes.ts'
import { IP_MAX_ATTEMPTS, IP_TRACK_MAX } from '../../../apps/server/src/login-limit.ts'
import { ORIGIN, addSeller, client, login, type Seller } from '../../../apps/server/test/support.ts'
import { youtubeWorld, type YoutubeWorld } from '../../../apps/server/test/youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(overrides: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(overrides)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const A = '203.0.113.7'
const WRONG = 'x'
const envOf = (address: string | null) => (address === null ? undefined : { incoming: { socket: { remoteAddress: address } } })

async function issue(w: YoutubeWorld, cookie: string, address: string | null, headers: Record<string, string> = {}): Promise<{ status: number; code: string | null }> {
  const response = await w.server.app.request('/api/extension/code', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: '{}' }, envOf(address))
  const text = await response.text()
  return { status: response.status, code: response.status === 200 ? (JSON.parse(text) as { code: string }).code : null }
}

async function enter(w: YoutubeWorld, address: string | null, code: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await w.server.app.request('/ext/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ code }) }, envOf(address))
  await response.text()
  return response.status
}

/** 서버 전체 3,000번을 남의 주소들로 다 쓴다 */
async function exhaustGlobal(w: YoutubeWorld): Promise<void> {
  for (let i = 0; i < EXT_CODE_GLOBAL_MAX / IP_MAX_ATTEMPTS; i += 1) {
    const address = `198.51.${String(Math.floor(i / 200))}.${String((i % 200) + 1)}`
    await Promise.all(Array.from({ length: IP_MAX_ATTEMPTS }, () => enter(w, address, WRONG)))
  }
}

describe('TD-QS1-002 믿는 주소의 주소 한도 20번을 주소 기록 밀어내기로 피한다 (AC-QS1-32, D-QS1-06 (d))', () => {
  it('믿는 주소 A가 20번을 다 쓴 뒤, 공격자가 다른 IPv6 /64 주소 1만 개로 한 번씩 넣어 주소 기록을 밀어내도 A의 21번째는 429다', async () => {
    const w = await world()
    const attacker = await addSeller(w)
    // 공격자도 판매자다: 자기 주소 A에서 코드를 만들어 A를 믿는 주소로 만든다 (전체 3,000번 밖)
    expect((await issue(w, attacker.cookie, A)).status).toBe(200)
    for (let i = 0; i < IP_MAX_ATTEMPTS; i += 1) expect(await enter(w, A, WRONG)).toBe(400)
    expect(await enter(w, A, WRONG)).toBe(429)
    // 다른 /64 주소 IP_TRACK_MAX개에서 한 번씩 (전체 한도에 막혀 429여도 주소 기록에는 남는다)
    for (let i = 0; i < IP_TRACK_MAX; i += 500) {
      await Promise.all(Array.from({ length: 500 }, (_, j) => enter(w, `2001:db8:${(i + j).toString(16)}:1::1`, WRONG)))
    }
    // 10분이 지나지 않았다 — A는 여전히 20번을 다 쓴 주소다
    expect(await enter(w, A, WRONG)).toBe(429)
  }, 60_000)
})

describe('주소 한도를 피하지 못한다 (AC-QS1-32 회귀)', () => {
  it('IPv4를 담은 IPv6 표기·대문자·0 채운 표기·대괄호·영역 표시로 A의 20번을 늘리지 못한다', async () => {
    const w = await world()
    const forms = ['203.0.113.7', '::ffff:203.0.113.7', '::FFFF:203.0.113.7', '0:0:0:0:0:ffff:203.0.113.7', '[::ffff:203.0.113.7]']
    let accepted = 0
    for (let i = 0; i < 40; i += 1) if ((await enter(w, forms[i % forms.length] as string, WRONG)) === 400) accepted += 1
    expect(accepted).toBe(IP_MAX_ATTEMPTS)
  })

  it('같은 /64 안의 여러 주소(0 채움·대문자·끝 그룹만 다름)로 20번을 늘리지 못한다', async () => {
    const w = await world()
    let accepted = 0
    for (let i = 0; i < 40; i += 1) {
      const address = i % 3 === 0 ? `2001:db8:a:b::${(i + 1).toString(16)}` : i % 3 === 1 ? `2001:0DB8:000A:000B:${(i + 1).toString(16)}::1` : `2001:db8:a:b:1:2:3:${(i + 1).toString(16)}%en0`
      if ((await enter(w, address, WRONG)) === 400) accepted += 1
    }
    expect(accepted).toBe(IP_MAX_ATTEMPTS)
  })

  it('믿는 프록시 1개: X-Forwarded-For 왼쪽에 아무 값을 꾸며 넣어도 오른쪽(프록시가 붙인) 주소로 센다', async () => {
    const w = await world({ overrides: { trustedProxies: 1 } })
    let accepted = 0
    for (let i = 0; i < 40; i += 1) if ((await enter(w, '10.0.0.1', WRONG, { 'X-Forwarded-For': `192.0.2.${String(i + 1)}, ${A}` })) === 400) accepted += 1
    expect(accepted).toBe(IP_MAX_ATTEMPTS)
  })

  it('보조자 계정·로그인하지 않은 요청은 코드를 만들지 못해 믿는 주소가 생기지 않는다 — 전체 한도를 다 쓰면 그 주소도 막힌다', async () => {
    const w = await world()
    const seller: Seller = await addSeller(w)
    const helper = await client(w, seller.cookie).post('/api/assistants', { name: '엄마' })
    expect(helper.status).toBe(200)
    const helperCookie = await login(w, (helper.body.assistant as { loginId: string }).loginId, helper.body.password as string)
    const H = '192.0.2.77'
    const N = '192.0.2.78'
    expect((await issue(w, helperCookie, H)).status).toBe(403)
    expect((await issue(w, '', N)).status).toBe(401)
    expect(w.server.extension.trustedAddresses.countFor(seller.sellerId)).toBe(0)
    await exhaustGlobal(w)
    expect(await enter(w, H, WRONG)).toBe(429)
    expect(await enter(w, N, WRONG)).toBe(429)
  }, 60_000)

  it('한 판매자가 같은 주소·다른 주소로 코드를 40번 만들어도 믿는 주소는 3개 이하, 그 밖 주소는 전체 한도에 막힌다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    for (let i = 0; i < 40; i += 1) expect((await issue(w, seller.cookie, `192.0.2.${String((i % 8) + 1)}`)).status).toBe(200)
    expect(w.server.extension.trustedAddresses.countFor(seller.sellerId)).toBeLessThanOrEqual(3)
    await exhaustGlobal(w)
    const open = []
    for (let i = 1; i <= 8; i += 1) open.push((await enter(w, `192.0.2.${String(i)}`, WRONG)) === 400)
    expect(open.filter(Boolean).length).toBeLessThanOrEqual(3)
  }, 60_000)
})
