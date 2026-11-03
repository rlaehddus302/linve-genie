// 링크로 틱톡 잇기 (D-UX3-14, 사용자 지시 2026-11-03 "틱톡도 링크로 이을 수 있게"): 방송 링크·짧은 공유 링크 → 아이디 저장 → 잇기.
import { afterEach, describe, expect, it } from 'vitest'
import { fetchShortLinkResolver } from '../src/tiktok/index.ts'
import { addSeller, client, rid } from './support.ts'
import { consentOn, realBroadcast, ttWorld, type TtOptions, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})
const world = async (options: TtOptions = {}) => {
  const w = await ttWorld(options)
  worlds.push(w)
  return w
}
const linkUrl = (w: TtWorld, cookie: string, b: string, url: unknown, requestId = rid('lu')) => client(w, cookie).post(`/api/broadcasts/${b}/tiktok/link-url`, { requestId, url })

describe('링크로 틱톡 잇기 (D-UX3-14)', () => {
  it('방송 링크에서 아이디를 읽어 저장하고 잇는다 — 같은 요청 번호는 처음 응답 그대로', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await consentOn(w, seller)
    w.webcast.account('shop_live', 'LIVE')
    const b = await realBroadcast(w, seller)
    const requestId = rid('lu')
    const linked = await linkUrl(w, seller.cookie, b, 'https://www.tiktok.com/@Shop_Live/live?enter_from_merge=share', requestId)
    expect(linked.status, linked.text).toBe(200)
    expect(((await client(w, seller.cookie).get('/api/tiktok')).body.tiktok as { tiktokId: string }).tiktokId).toBe('shop_live')
    const again = await linkUrl(w, seller.cookie, b, 'https://www.tiktok.com/@shop_live/live', requestId)
    expect(again.status, again.text).toBe(200)
    expect(again.body).toEqual(linked.body)
    // 다른 판매자의 방송은 없는 것처럼
    expect((await linkUrl(w, (await addSeller(w)).cookie, b, 'https://www.tiktok.com/@a_b/live')).status).toBe(404)
  })

  it('짧은 공유 링크는 풀어서 잇는다', async () => {
    const opened: string[] = []
    const w = await world({
      shortLinks: async (url) => {
        opened.push(url)
        return 'https://www.tiktok.com/@shop_short/live?_r=1'
      },
    })
    const seller = await addSeller(w)
    await consentOn(w, seller)
    w.webcast.account('shop_short', 'LIVE')
    const b = await realBroadcast(w, seller)
    const linked = await linkUrl(w, seller.cookie, b, 'https://vt.tiktok.com/ZSgood/')
    expect(linked.status, linked.text).toBe(200)
    expect(opened).toEqual(['https://vt.tiktok.com/ZSgood/'])
    expect(((await client(w, seller.cookie).get('/api/tiktok')).body.tiktok as { tiktokId: string }).tiktokId).toBe('shop_short')
  })

  it('못 풀거나 틱톡 링크가 아니면 "알 수 없는 링크예요." — 아이디도 바꾸지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await consentOn(w, seller)
    const b = await realBroadcast(w, seller)
    for (const url of ['https://example.com/@shop/live', 'https://vt.tiktok.com/ZSbad/', '', 7]) {
      const bad = await linkUrl(w, seller.cookie, b, url)
      expect(bad.status).toBe(400)
      expect(bad.body.error).toEqual({ code: 'INVALID_TIKTOK_LINK', message: '알 수 없는 링크예요.' })
    }
    expect(((await client(w, seller.cookie).get('/api/tiktok')).body.tiktok as { tiktokId: string | null }).tiktokId).toBeNull()
  })

  it('동의를 켜지 않았으면 잇지 않고 NO_CONSENT (화면이 안내를 보이고 동의를 받는다)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller)
    const res = await linkUrl(w, seller.cookie, b, 'https://www.tiktok.com/@shop_nc/live')
    expect(res.status).toBe(409)
    expect((res.body.error as { code: string }).code).toBe('NO_CONSENT')
  })
})

describe('짧은 링크 풀기 (D-UX3-14)', () => {
  const reply = (location: string | null) => new Response(null, { status: location === null ? 200 : 301, headers: location === null ? {} : { location } })

  it('넘겨주는 곳을 따라가 아이디가 든 틱톡 주소를 돌려준다', async () => {
    const seen: string[] = []
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      seen.push(url)
      if (url.startsWith('https://vt.tiktok.com/')) return reply('https://www.tiktok.com/t/ZT123/')
      return reply('/@shop_ok/live?is_from_webapp=1')
    }) as typeof fetch
    expect(await fetchShortLinkResolver(fetcher)('vt.tiktok.com/ZSgood/')).toBe('https://www.tiktok.com/@shop_ok/live?is_from_webapp=1')
    expect(seen).toEqual(['https://vt.tiktok.com/ZSgood/', 'https://www.tiktok.com/t/ZT123/'])
  })

  it('틱톡 밖으로 넘기거나, 넘기지 않거나, 끝없이 넘기면 못 푼 것. 처음부터 틱톡이 아니면 열지도 않는다', async () => {
    expect(await fetchShortLinkResolver((async () => reply('https://evil.example/@a_b/live')) as typeof fetch)('https://vt.tiktok.com/x')).toBeNull()
    expect(await fetchShortLinkResolver((async () => reply(null)) as typeof fetch)('https://vt.tiktok.com/x')).toBeNull()
    let calls = 0
    const loop = (async () => {
      calls += 1
      return reply('https://vm.tiktok.com/again/')
    }) as typeof fetch
    expect(await fetchShortLinkResolver(loop)('https://vt.tiktok.com/x')).toBeNull()
    expect(calls).toBe(4)
    let touched = false
    const never = (async () => {
      touched = true
      return reply(null)
    }) as typeof fetch
    expect(await fetchShortLinkResolver(never)('https://example.com/x')).toBeNull()
    expect(touched).toBe(false)
  })
})
