// 밴드 글 댓글 흐름 (BND1, AC-BND1-20~22·30·31·33·35·36) — 가짜 밴드 서버·주입한 시계.
import { afterEach, describe, expect, it } from 'vitest'
import { client, writeEvent } from './support.ts'
import { bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, tick, type BandWorld } from './band-support.ts'
import { BAND_TIMING } from '../src/band/service.ts'

let w: BandWorld | null = null
afterEach(async () => {
  await w?.close()
  w = null
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

describe('AC-BND1-20·21 밴드 목록·내 글 목록', () => {
  it('밴드 목록은 이름·키·멤버 수만, 고른 밴드를 기억하고 먼저 둔다. 목록에 없는 밴드는 400', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const other = w.fake.addBand({ name: '두 번째 방', members: [userKey], memberCount: 12 })
    const api = client(w, seller.cookie)
    const listed = await api.get('/api/band/bands')
    expect(listed.status, listed.text).toBe(200)
    expect(listed.body).toEqual({ bands: [{ bandKey, name: '다육 공구방', memberCount: 1 }, { bandKey: other, name: '두 번째 방', memberCount: 12 }], chosenBand: null, message: null })
    expect(listed.text).not.toContain('cover')
    expect((await api.get(`/api/band/posts?band=${other}`)).status).toBe(200)
    expect((await api.get('/api/band/bands')).body).toMatchObject({ bands: [{ bandKey: other }, { bandKey }], chosenBand: other })
    const unknown = await api.get('/api/band/posts?band=NOPE')
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toEqual({ code: 'UNKNOWN_BAND', message: '목록에 없는 밴드예요. 밴드를 다시 골라 주세요.' })
  })

  it('가입한 밴드가 없으면 빈 목록과 문장', async () => {
    const w = await world()
    const { seller, bandKey } = await bandSeller(w)
    w.fake.bands.delete(bandKey)
    expect((await client(w, seller.cookie).get('/api/band/bands')).body).toEqual({ bands: [], chosenBand: null, message: '가입한 밴드가 없어요. 밴드 앱에서 먼저 밴드를 만들어 주세요.' })
  })

  it('내 글만(작성자 user_key가 같은 글), 첫 줄 40자, 더 보기 5쪽까지 — 6쪽째는 400', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    w.fake.pageSize = 2
    const t = w.bclock.now()
    // 최신순: 남의 글·user_key 없는 글·내 글 섞기 (12개 = 6쪽)
    for (let i = 0; i < 12; i += 1) {
      const author = i % 3 === 0 ? 'OTHER' : i % 3 === 1 ? null : userKey
      w.fake.addPost({ bandKey, authorUserKey: author, content: i === 11 ? `<band:hashtag>#공구</band:hashtag> ${'가'.repeat(50)}\n둘째 줄` : `글 ${String(i)}`, createdAt: t - (12 - i) * 1000 })
    }
    const api = client(w, seller.cookie)
    const first = await api.get(`/api/band/posts?band=${bandKey}`)
    expect(first.status, first.text).toBe(200)
    const posts = first.body.posts as { postKey: string; firstLine: string; commentCount: number; createdAt: string }[]
    expect(posts.map((post) => post.firstLine)).toEqual([`#공구 ${'가'.repeat(36)}…`])
    expect(first.body).toMatchObject({ page: 1, more: true })
    let cursor = first.body.cursor as string
    for (let page = 2; page <= 5; page += 1) {
      const next = await api.get(`/api/band/posts?band=${bandKey}&cursor=${cursor}`)
      expect(next.body.page).toBe(page)
      for (const post of next.body.posts as { firstLine: string }[]) expect(post.firstLine).toMatch(/^글 (2|5|8)$/)
      cursor = next.body.cursor as string
    }
    const sixth = await api.get(`/api/band/posts?band=${bandKey}&cursor=${cursor}`)
    expect(sixth.status).toBe(400)
    expect(sixth.body.error).toMatchObject({ code: 'MORE_LIMIT' })
    // 다음 쪽 요청은 우리 토큰·밴드로만 (next_params의 토큰·밴드 키를 그대로 쓰지 않는다)
    for (const call of w.fake.calls('posts')) expect(call.query['band_key']).toBe(bandKey)
  })
})

describe('AC-BND1-22·33 잇기 → 기준선 → 새 댓글이 chat으로', () => {
  it('이을 때 있던 댓글은 기준선, 그 뒤 댓글은 10초 안에 chat (접수순 판정 — "1번이요" 1등 = band:UKEY_A, "1번 2개요"는 언급만)', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey, content: '오늘 공구\n1번 핑크' })
    for (const text of ['어제 1번요', '2번', '3번']) guestComment(w, postKey, text)
    const b = await realBroadcast(w, seller)
    expect((await writeEvent(w, seller, { type: 'product.register', b, no: 1, name: '핑크', price: 10_000, stock: 1, status: 'OPEN' })).status).toBe(200)
    const linked = await linkBand(w, seller, b, bandKey, postKey)
    expect(linked.status, linked.text).toBe(200)
    expect(linked.body.link).toMatchObject({ state: 'READING', message: '밴드 댓글을 읽고 있어요.', baseline: 3, baselineMessage: '이을 때 이미 달려 있던 댓글 3개는 넣지 않았어요.', received: 0, post: { firstLine: '오늘 공구' } })
    expect(await chats(w, seller.sellerId)).toEqual([])
    guestComment(w, postKey, '1번이요', { userKey: 'UKEY_A', name: '김다육' })
    // "1번 2개요"는 파서 골든대로 언급만 — 찜이 없다 (AC-BND1-33)
    guestComment(w, postKey, '1번 2개요', { userKey: 'UKEY_B', name: '이선인' })
    await tick(w, BAND_TIMING.fastMs)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((chat) => ({ ch: chat.ch, nick: chat.nick, text: chat.text }))).toEqual([
      { ch: 'band:UKEY_A', nick: '김다육', text: '1번이요' },
      { ch: 'band:UKEY_B', nick: '이선인', text: '1번 2개요' },
    ])
    expect(recorded[0]?.id).toMatch(new RegExp(`^band:${postKey}:`))
    const view = await bandView(w, seller, b)
    expect(view).toMatchObject({ state: 'READING', received: 2 })
    const board = await client(w, seller.cookie).get(`/api/days/2026-10-19`)
    const product = (board.body.products as { key: string; winners: string[] }[]).find((item) => item.key === `${b}/1`)
    expect(product?.winners).toEqual(['band:UKEY_A'])
  })
})
