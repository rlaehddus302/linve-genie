// 게시 뒤 감사 정정 (D-RETRO-105, DOMAIN_RULES R-13 "게시 뒤 감사 정정", SPEC AC5):
// 이미 올라간 실시간 채팅 감사 글의 값(번호·품종·가격·찜한 사람)이 고쳐지면 그 글을 지우고 고친 글을 새로 올린다. 판매자가 켠 실제 운영에서만.
// 유튜브는 가짜 서버(127.0.0.1)다 — 실제 youtube.com으로 나가는 요청은 없다. 손님 이름은 지어낸 것이다.
import { listEffects } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { isOurPost } from '../src/youtube/outbox-store.ts'
import { FIX_PREFIX, fixMessages, thanksTail } from '../src/youtube/thanks-fix.ts'
import { broadcastFixes } from '../src/youtube/thanks-fix-store.ts'
import { client, createBroadcast, expectOk, writeEvent } from './support.ts'
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

/** 20:00:00 KST */
const EIGHT_PM = Date.parse('2026-10-19T11:00:00Z')
/** 운영 판매자 기본값과 같은 감사 설정 — 묶음 창 10초, 고침 따라가기 켬(정정도 이 방송에서만) */
const LIVE = { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': SELLER_DEFAULTS['thanks.batchWindowSec'], 'thanks.followEdits': SELLER_DEFAULTS['thanks.followEdits'] }

function runner(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube.outbox
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
/** 확정 → 묶음 창 10초 → 게시 */
async function postThanks(w: YoutubeWorld) {
  await tick(w)
  await w.timer.advance(10_000)
  await run(w)
}
const posted = (w: YoutubeWorld) => w.fake.posted.map((post) => post.text)
const fixes = (w: YoutubeWorld, connected: Connected, b: string) => broadcastFixes(w.database.db, connected.seller.sellerId, b)

describe('D-RETRO-105 값이 고쳐지면 올라간 감사를 지우고 고친 글을 올린다', () => {
  it('품종·가격(이미 찜한 손님에게도) 고침 → 10초 뒤 앞 글을 지우고 고친 글 하나. 새 글은 우리 글이라 찜으로 읽지 않는다. 엔진·재생 대조는 그대로', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다'])
    const first = w.fake.posted[0]?.id as string
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광', price: 5000, applyTo: 'UNPAID_CLAIMS' }))
    await tick(w)
    // 아직 10초가 지나지 않았다 — 아무것도 지우거나 올리지 않는다
    expect(w.fake.removed).toEqual([])
    expect(posted(w)).toHaveLength(1)
    expect((await fixes(w, connected, b.id)).map((fix) => fix.state)).toEqual(['WAITING'])
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed).toEqual([{ liveChatId, id: first, channel: connected.channel.id }])
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '15번 성광 5,000원 가나다님 구매 감사합니다'])
    const [fix] = await fixes(w, connected, b.id)
    expect(fix).toMatchObject({ state: 'DONE', reason: null, deleted: true, source: expect.stringMatching(/^outbox:/) })
    const second = w.fake.posted[1]?.id as string
    expect(JSON.parse(fix?.newRemoteIds ?? '[]')).toEqual([second])
    // 수집기가 이 글을 보면 우리 글이다 (찜으로 읽지 않는다)
    expect(await isOurPost(w.database.db, connected.seller.sellerId, b.id, second, '15번 성광 5,000원 가나다님 구매 감사합니다', new Date(w.timer.now() - 600_000))).toBe(true)
    expect(await isOurPost(w.database.db, connected.seller.sellerId, b.id, 'other', '15번 성광 5,000원 가나다님 구매 감사합니다', new Date(w.timer.now() - 600_000))).toBe(true)
    // 엔진은 그대로: 게시된 감사 효과는 완료, 새 효과 없음 — 재생 대조 일치
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(listEffects(state).map((effect) => [effect.kind, effect.status, effect.text])).toEqual([['POST_THANKS', 'DONE', '15번 상광 10,000원 가나다님 구매 감사합니다']])
    const [check] = await checkReplay(w.database.db, { sellerId: connected.seller.sellerId, rehearsal: false })
    expect(check).toMatchObject({ ok: true })
    // 더 바뀐 것이 없으면 또 하지 않는다
    await w.timer.advance(60_000)
    await run(w)
    expect(posted(w)).toHaveLength(2)
    expect(w.fake.removed).toHaveLength(1)
  })

  it('연달아 고치면 마지막 고침에서 10초를 기다렸다 한 번만 — 마지막 값으로', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    for (const [name, wait] of [
      ['성광', 4000],
      ['성광금', 4000],
      ['홍광', 4000],
    ] as const) {
      await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name }))
      await tick(w)
      await w.timer.advance(wait)
      await tick(w)
    }
    expect(w.fake.removed).toEqual([])
    expect(posted(w)).toHaveLength(1)
    await w.timer.advance(6000)
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '15번 홍광 10,000원 가나다님 구매 감사합니다'])
    expect((await fixes(w, connected, b.id)).map((fix) => fix.state)).toEqual(['DONE'])
  })

  it('기다리는 동안 처음 값으로 되돌리면 하지 않고, 그 뒤 다시 고치면 그때부터 기다렸다 고친다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '상광' }))
    await tick(w)
    await w.timer.advance(20_000)
    await run(w)
    expect(w.fake.removed).toEqual([])
    expect(posted(w)).toHaveLength(1)
    expect(await fixes(w, connected, b.id)).toEqual([])
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '홍광' }))
    await tick(w)
    await w.timer.advance(9000)
    await tick(w)
    expect(w.fake.removed).toEqual([])
    await w.timer.advance(1000)
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '15번 홍광 10,000원 가나다님 구매 감사합니다'])
  })

  it('고친 글을 또 고치면 고친 글을 지우고 다시 올린다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    const second = w.fake.posted[1]?.id
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, price: 8000, applyTo: 'UNPAID_CLAIMS' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed.map((item) => item.id)).toEqual([w.fake.posted[0]?.id, second])
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '15번 성광 10,000원 가나다님 구매 감사합니다', '15번 성광 8,000원 가나다님 구매 감사합니다'])
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.state, fix.source.split(':')[0]])).toEqual([
      ['DONE', 'outbox'],
      ['DONE', 'fix'],
    ])
  })

  it('묶음 글: 하나만 고쳐도 묶음 글을 지우고 고친 값이 든 묶음 글로 다시 올린다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '라마바', '16')
    await postThanks(w)
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님, 16번 라울 5,000원 라마바님 구매 감사합니다'])
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 16, name: '라울금' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
    expect(posted(w)[1]).toBe('15번 상광 10,000원 가나다님, 16번 라울금 5,000원 라마바님 구매 감사합니다')
  })

  it('찜 취소로 대기자가 당첨: 앞 사람의 감사 글을 지우고, 새로 당첨된 사람의 감사는 평소처럼 나간다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '라마바', '15')
    await postThanks(w)
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다'])
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UCa', reason: '손님 요청' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed.map((item) => item.id)).toEqual([w.fake.posted[0]?.id])
    // 정정은 지우기만 — 새로 당첨된 사람의 감사는 그 효과로 나간다
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '15번 상광 10,000원 라마바님 구매 감사합니다'])
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.state, JSON.parse(fix.sentTexts)])).toEqual([['DONE', []]])
  })
})

describe('D-RETRO-105 지우지 못하면 [수정] 글', () => {
  it('지우기를 유튜브가 받지 않으면(권한 없음) 고친 글 앞에 [수정]', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    w.fake.fail('liveChatMessages.delete', { status: 403, reason: 'forbidden' })
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.removed).toEqual([])
    expect(posted(w)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다', '[수정] 15번 성광 10,000원 가나다님 구매 감사합니다'])
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.state, fix.reason, fix.deleted])).toEqual([['DONE', 'NOT_DELETED', false]])
  })

  it('지우기가 잠깐 안 되면(5xx) 다시 해 보고, 그래도 안 되면 [수정]. 확정이 풀린 감사는 "잘못 올라갔어요"로 알린다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '라마바', '16')
    await postThanks(w)
    w.fake.fail('liveChatMessages.delete', { status: 503 }, 10)
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UCb', reason: '손님 요청' }))
    await tick(w)
    await w.timer.advance(10_000)
    await run(w)
    for (let i = 0; i < 4; i++) {
      await w.timer.advance(10_000)
      await run(w)
    }
    expect(w.fake.calls('liveChatMessages.delete')).toBe(4)
    expect(posted(w)).toEqual([
      '15번 상광 10,000원 가나다님, 16번 라울 5,000원 라마바님 구매 감사합니다',
      '[수정] 15번 상광 10,000원 가나다님 구매 감사합니다',
      '[수정] 앞 글의 16번 라울 5,000원 라마바님 감사는 잘못 올라갔어요',
    ])
  })

  it('[수정] 글 만들기: 앞말까지 200자 안에 들게 나누고, 지웠으면 앞말이 없다', () => {
    const kept = [['e1', '15번 상광 10,000원 가나다님 구매 감사합니다'] as const]
    expect(fixMessages(kept, [], true)).toEqual(['15번 상광 10,000원 가나다님 구매 감사합니다'])
    expect(fixMessages(kept, [], false)).toEqual([`${FIX_PREFIX}15번 상광 10,000원 가나다님 구매 감사합니다`])
    expect(fixMessages([], ['16번 라울 5,000원 라마바님 구매 감사합니다'], true)).toEqual([])
    const many = Array.from({ length: 8 }, (_, index) => [`e${String(index)}`, `${String(index + 10)}번 아주긴품종이름입니다 10,000원 손님이름${String(index)}님 구매 감사합니다`] as const)
    for (const text of fixMessages(many, [], false)) {
      expect(text.startsWith(FIX_PREFIX)).toBe(true)
      expect([...text].length).toBeLessThanOrEqual(200)
    }
  })

  it('이름 뒤 부분 찾기: 이름 이력에서 맞는 것, 없으면 문구 모양, 그것도 아니면 고치지 않는다', () => {
    expect(thanksTail('15번 상광 10,000원 가나 다님 구매 감사합니다', ['가나 다'])).toBe('가나 다님 구매 감사합니다')
    expect(thanksTail('15번 1,000원 특가 10,000원 가나다님 구매 감사합니다', ['새이름'])).toBe('특가 10,000원 가나다님 구매 감사합니다')
    expect(thanksTail('15번 1,000원 특가 10,000원 가나다님 구매 감사합니다', ['가나다', '새이름'])).toBe('가나다님 구매 감사합니다')
    expect(thanksTail('아무 글', ['가나다'])).toBeNull()
  })
})

describe('D-RETRO-105 판매자가 켠 실제 운영에서만', () => {
  it('고침 따라가기를 켜지 않은 방송(옛 방송)은 고쳐도 지우거나 올리지 않는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 10 } })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광', price: 5000, applyTo: 'UNPAID_CLAIMS' }))
    await tick(w)
    await w.timer.advance(30_000)
    await run(w)
    expect(w.fake.removed).toEqual([])
    expect(posted(w)).toHaveLength(1)
    expect(await fixes(w, connected, b.id)).toEqual([])
  })

  it('리허설 범위: 게시된 것처럼 보이는 행이 있어도 정정 줄을 만들지 않고 유튜브에 아무것도 하지 않는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    await linkedBroadcast(w, connected, { settings: LIVE })
    const rehearsal = await createBroadcast(w, connected.seller, { rehearsal: true })
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: rehearsal.id, no: 15, name: '상광', price: 10000 }))
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${rehearsal.id}/rehearsal/chat`, { requestId: 'rv1', nick: '연습', text: '15' })).status).toBe(200)
    // 리허설 행을 게시됨처럼 꾸며도(있어서는 안 될 상태) 실행기는 리허설 행을 보지 않는다
    await w.database.pglite?.query(
      `update outbox set state = 'SENT', target = 'LIVE_CHAT', broadcast_id = $1, group_id = 'gr', sent_text = '15번 상광 10,000원 연습님 구매 감사합니다', remote_id = 'msg_rehearsal', posted_at = $2 where rehearsal = true and kind = 'POST_THANKS'`,
      [rehearsal.id, new Date(w.timer.now()).toISOString()],
    )
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: rehearsal.id, no: 15, name: '성광' }))
    await tick(w)
    await w.timer.advance(30_000)
    await run(w)
    expect(w.fake.removed).toEqual([])
    expect(w.fake.posted).toEqual([])
    expect(w.fake.calls('liveChatMessages.delete')).toBe(0)
    expect(await fixes(w, connected, rehearsal.id)).toEqual([])
  })

  it('실시간 채팅 게시 동의를 끄면 지우지도 올리지도 않는다(하지 못함으로 남김)', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    const off = await client(w, connected.seller.cookie).put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: false })
    expect(off.status, JSON.stringify(off.body)).toBe(200)
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.calls('liveChatMessages.delete')).toBe(0)
    expect(posted(w)).toHaveLength(1)
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.state, fix.reason])).toEqual([['FAILED', 'NO_CONSENT']])
  })

  it('유튜브 채팅이 끝난 뒤에 고치면 정정 줄을 만들지 않는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    await w.database.pglite?.query(`update youtube_links set chat_ended_at = $1 where live_chat_id = $2`, [new Date(w.timer.now()).toISOString(), liveChatId])
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    await w.timer.advance(30_000)
    await run(w)
    expect(w.fake.calls('liveChatMessages.delete')).toBe(0)
    expect(posted(w)).toHaveLength(1)
    expect(await fixes(w, connected, b.id)).toEqual([])
  })

  it('새 글 게시가 응답 없이 끊기면 다시 올리지 않는다(두 번 올라가는 것보다 빠짐이 안전)', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: LIVE })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가나다', '15')
    await postThanks(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    w.fake.fail('liveChatMessages.insert', { kind: 'reset' })
    await w.timer.advance(10_000)
    await run(w)
    await w.timer.advance(60_000)
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(2)
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.state, fix.reason])).toEqual([['FAILED', 'UNCONFIRMED']])
  })
})
