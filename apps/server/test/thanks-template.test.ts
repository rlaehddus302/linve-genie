// 찜 감사 채팅 양식 (D-THANKS-FMT-01): 판매자가 블록으로 정한 양식대로 감사 글이 올라가고, 고치면 자동 정정도 그 양식으로 올라간다.
// 엔진의 감사 문구는 기본 모양 그대로다(기록·재생 대조). 유튜브는 가짜 서버(127.0.0.1)다. 손님 이름은 지어낸 것이다.
import { listEffects } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { client, expectOk, writeEvent } from './support.ts'
import { connectSeller, drive, linkedBroadcast, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
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

const EIGHT_PM = Date.parse('2026-10-19T11:00:00Z')
const LIVE = { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': SELLER_DEFAULTS['thanks.batchWindowSec'], 'thanks.followEdits': SELLER_DEFAULTS['thanks.followEdits'] }
const PATH = '/api/settings/thanks-template'
const MINE = [{ k: 'buyer' }, { k: 'no' }, { k: 'name' }, { k: 'price' }, { k: 'text', t: '찜 확정이에요' }]
const DEFAULT = [{ k: 'no' }, { k: 'name' }, { k: 'price' }, { k: 'buyer' }, { k: 'text', t: '구매 감사합니다' }]

function runner(w: YoutubeWorld) {
  if (w.server.youtube === null) throw new Error('유튜브가 없다')
  return w.server.youtube.outbox
}
const run = (w: YoutubeWorld) => drive(w, runner(w).runOnce())
const tick = (w: YoutubeWorld) => runner(w).runOnce()
async function chat(w: YoutubeWorld, connected: Connected, b: string, id: string, ch: string, nick: string, text: string) {
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b, id, ch, nick, text, publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}
async function product(w: YoutubeWorld, connected: Connected, b: string, no: number, name: string, price: number) {
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b, no, name, price }))
}
async function postThanks(w: YoutubeWorld) {
  await tick(w)
  await w.timer.advance(10_000)
  await run(w)
}
const posted = (w: YoutubeWorld) => w.fake.posted.map((post) => post.text)

describe('D-THANKS-FMT-01 양식 저장', () => {
  it('처음은 기본 양식. 바꾸면 남고, 기본 블록을 보내면 기본으로. 문제 있는 양식은 받지 않는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const api = client(w, connected.seller.cookie)
    expect((await api.get(PATH)).body).toEqual({ blocks: DEFAULT })
    expect((await api.put(PATH, { blocks: MINE })).body).toEqual({ blocks: MINE })
    expect((await api.get(PATH)).body).toEqual({ blocks: MINE })
    const bad = await api.put(PATH, { blocks: [{ k: 'no' }] })
    expect(bad.status).toBe(400)
    expect((bad.body as { error: { message: string } }).error.message).toBe('닉네임 블록은 꼭 있어야 해요.')
    expect((await api.put(PATH, { blocks: MINE, other: 1 })).status).toBe(400)
    expect((await api.get(PATH)).body).toEqual({ blocks: MINE })
    expect((await api.put(PATH, { blocks: DEFAULT })).body).toEqual({ blocks: DEFAULT })
    expect((await client(w, null).get(PATH)).status).toBe(401)
  })
})

describe('D-THANKS-FMT-01 올라가는 감사 글', () => {
  it('양식대로 올라가고, 묶음은 항목을 쉼표로 잇고 마지막 글자 블록 한 번. 엔진 문구는 기본 모양 그대로', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await expectOk(client(w, connected.seller.cookie).put(PATH, { blocks: MINE }))
    await product(w, connected, b.id, 15, '상광', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '라마바', '16')
    await postThanks(w)
    expect(posted(w)).toEqual(['가나다님 15번 상광 10,000원, 라마바님 16번 라울 5,000원 찜 확정이에요'])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date, false)).state
    expect(listEffects(state).filter((effect) => effect.kind === 'POST_THANKS').map((effect) => effect.text)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '16번 라울 5,000원 라마바님 구매 감사합니다'])
  })

  it('끝이 글자 블록이 아니면 끝말 없이 잇는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await expectOk(client(w, connected.seller.cookie).put(PATH, { blocks: [{ k: 'text', t: '축하해요' }, { k: 'no' }, { k: 'buyer' }] }))
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    expect(posted(w)).toEqual(['축하해요 15번 가나다님'])
  })

  it('올라간 뒤 상품을 고치면 앞 글을 지우고 양식대로 고친 글을 올린다. 양식만 바꾼 것으로는 다시 올리지 않는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    const api = client(w, connected.seller.cookie)
    await expectOk(api.put(PATH, { blocks: MINE }))
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    expect(posted(w)).toEqual(['가나다님 15번 상광 10,000원 찜 확정이에요'])
    // 양식만 바꾼다 — 올라간 글은 그대로
    await expectOk(api.put(PATH, { blocks: DEFAULT }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed).toEqual([])
    expect(posted(w)).toHaveLength(1)
    // 값을 고치면 지우고 지금 양식으로 고친 글
    await expectOk(api.put(PATH, { blocks: MINE }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광', price: 5000, applyTo: 'UNPAID_CLAIMS' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
    expect(posted(w)).toEqual(['가나다님 15번 상광 10,000원 찜 확정이에요', '가나다님 15번 성광 5,000원 찜 확정이에요'])
  })
})

describe('D-THANKS-FMT-01 기본 양식은 예전 그대로', () => {
  it('양식을 정하지 않으면 엔진 문구 그대로 올라간다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다'])
  })
})
