// 올라간 감사 채팅 손으로 지우기·고쳐 다시 올리기 (D-THANKSFIX-01·02, SPEC YT-04 "올라간 감사 채팅 고치기", DOMAIN_RULES R-13 "게시 뒤 감사 정정").
// 판매자가 앱의 "올라간 감사 채팅" 목록에서 글 하나를 골라 [지우기] 또는 [고쳐 다시 올리기]. 자동 정정(D-RETRO-105)과 같은 실행기가 한다.
// 유튜브는 가짜 서버(127.0.0.1)다 — 실제 youtube.com으로 나가는 요청은 없다(절대 규칙 7). 손님 이름은 지어낸 것이다.
import { afterEach, describe, expect, it } from 'vitest'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { isOurPost } from '../src/youtube/outbox-store.ts'
import { MANUAL_TEXT_MAX, type ThanksPostView } from '../src/youtube/thanks-fix.ts'
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

const EIGHT_PM = Date.parse('2026-10-19T11:00:00Z')
const LIVE = { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': SELLER_DEFAULTS['thanks.batchWindowSec'], 'thanks.followEdits': SELLER_DEFAULTS['thanks.followEdits'] }
const FIRST = '15번 상광 10,000원 가나다님 구매 감사합니다'

function runner(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube.outbox
}
const run = (w: YoutubeWorld) => drive(w, runner(w).runOnce())
const tick = (w: YoutubeWorld) => runner(w).runOnce()
const posted = (w: YoutubeWorld) => w.fake.posted.map((post) => post.text)
const fixes = (w: YoutubeWorld, connected: Connected, b: string) => broadcastFixes(w.database.db, connected.seller.sellerId, b)

/** 판매자 + 이은 방송 + 15번 상광 감사가 올라간 상태 */
async function onePosted(w: YoutubeWorld, settings: Record<string, unknown> = LIVE) {
  const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
  const { b, liveChatId } = await linkedBroadcast(w, connected, { settings })
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 15, name: '상광', price: 10000 }))
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCa', nick: '가나다', text: '15', publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
  await tick(w)
  await w.timer.advance(10_000)
  await run(w)
  expect(posted(w)).toEqual([FIRST])
  return { connected, b, liveChatId }
}

async function list(w: YoutubeWorld, connected: Connected, b: string): Promise<{ live: boolean; posts: ThanksPostView[] }> {
  const response = await client(w, connected.seller.cookie).get(`/api/broadcasts/${b}/thanks-posts`)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body as { live: boolean; posts: ThanksPostView[] }
}

describe('D-THANKSFIX-01 올라간 감사 채팅 목록', () => {
  it('처음 올린 감사가 보이고 지우기·고치기를 할 수 있다. 리허설 방송은 목록이 비어 있다', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    const view = await list(w, connected, b.id)
    expect(view.live).toBe(true)
    expect(view.posts).toEqual([expect.objectContaining({ kind: 'THANKS', text: FIRST, gone: false, busy: false, note: null, canDelete: true, canEdit: true, key: expect.stringMatching(/^outbox:/) })])
    const rehearsal = await createBroadcast(w, connected.seller, { rehearsal: true })
    expect((await list(w, connected, rehearsal.id)).posts).toEqual([])
  })
})

describe('D-THANKSFIX-01 손으로 지우기', () => {
  it('[지우기] → 그 글을 유튜브에서 지우고 아무것도 올리지 않는다. 목록에 "지웠어요", 다시 지울 수 없다', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b, liveChatId } = await onePosted(w)
    const [post] = (await list(w, connected, b.id)).posts
    const response = await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: post?.key })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    // 요청은 줄만 넣는다 — 유튜브는 실행기가 부른다
    expect((response.body.posts as ThanksPostView[])[0]).toMatchObject({ busy: true, note: '지우는 중이에요', canDelete: false })
    await run(w)
    expect(w.fake.removed).toEqual([{ liveChatId, id: w.fake.posted[0]?.id, channel: connected.channel.id }])
    expect(posted(w)).toEqual([FIRST])
    const after = await list(w, connected, b.id)
    expect(after.posts).toEqual([expect.objectContaining({ gone: true, note: '지웠어요', canDelete: false, canEdit: false })])
    const again = await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: post?.key })
    expect(again.status).toBe(409)
    expect((again.body.error as { code: string }).code).toBe('ALREADY_DELETED')
  })

  it('고침 따라가기를 끈 방송이어도 판매자가 누르면 지운다(판매자가 직접 한 일)', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w, { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 10 })
    const [post] = (await list(w, connected, b.id)).posts
    await expectOk(client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: post?.key }))
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
  })

  it('유튜브가 지우기를 받지 않으면(권한 없음) 아무것도 올리지 않고 "직접 지워 주세요"', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    w.fake.fail('liveChatMessages.delete', { status: 403, reason: 'forbidden' })
    const [post] = (await list(w, connected, b.id)).posts
    await expectOk(client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: post?.key }))
    await run(w)
    expect(posted(w)).toEqual([FIRST])
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.manual, fix.state, fix.reason, fix.deleted])).toEqual([[true, 'FAILED', 'NOT_DELETED', false]])
    const [after] = (await list(w, connected, b.id)).posts
    expect(after).toMatchObject({ gone: false, note: '유튜브에서 지우지 못했어요. 유튜브 채팅에서 직접 지워 주세요.', canDelete: true })
  })

  it('라이브 채팅이 끝났으면 거절하고 유튜브에 아무것도 하지 않는다', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b, liveChatId } = await onePosted(w)
    await w.database.pglite?.query(`update youtube_links set chat_ended_at = $1 where live_chat_id = $2`, [new Date(w.timer.now()).toISOString(), liveChatId])
    const view = await list(w, connected, b.id)
    expect(view.live).toBe(false)
    expect(view.posts[0]).toMatchObject({ canDelete: false, canEdit: false })
    const response = await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: view.posts[0]?.key })
    expect(response.status).toBe(409)
    expect((response.body.error as { code: string }).code).toBe('CHAT_ENDED')
    await run(w)
    expect(w.fake.calls('liveChatMessages.delete')).toBe(0)
    expect(await fixes(w, connected, b.id)).toEqual([])
  })

  it('입력 확인: 모르는 글 404, 모르는 칸·빈 열쇠 400, 다른 판매자는 그 글을 못 본다', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    const http = client(w, connected.seller.cookie)
    expect((await http.post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: 'outbox:g999999' })).status).toBe(404)
    expect((await http.post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: 'x' })).status).toBe(400)
    expect((await http.post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: 'fix:1', extra: 1 })).status).toBe(400)
    const other = await connectSeller(w, { publish: 'LIVE_CHAT' })
    expect((await list(w, other, b.id)).posts).toEqual([])
    const [post] = (await list(w, connected, b.id)).posts
    expect((await client(w, other.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: post?.key })).status).toBe(404)
  })
})

describe('D-THANKSFIX-02 손으로 고쳐 다시 올리기', () => {
  it('[고쳐 다시 올리기] → 앞 글을 지우고 고친 글을 올린다. 새 글은 우리 글(찜으로 읽지 않음)이고 목록에서 또 고칠 수 있다', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    const [post] = (await list(w, connected, b.id)).posts
    const text = '15번 성광 10,000원 가나다님 구매 감사합니다'
    const response = await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/repost`, { key: post?.key, text: `  ${text}\n` })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    await run(w)
    expect(w.fake.removed).toHaveLength(1)
    expect(posted(w)).toEqual([FIRST, text])
    const view = await list(w, connected, b.id)
    expect(view.posts.map((item) => [item.kind, item.text, item.gone])).toEqual([
      ['MANUAL', text, false],
      ['THANKS', FIRST, true],
    ])
    expect(await isOurPost(w.database.db, connected.seller.sellerId, b.id, w.fake.posted[1]?.id ?? '', text, new Date(w.timer.now() - 600_000))).toBe(true)
    // 고친 글을 또 지운다
    await expectOk(client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: view.posts[0]?.key }))
    await run(w)
    expect(w.fake.removed.map((item) => item.id)).toEqual([w.fake.posted[0]?.id, w.fake.posted[1]?.id])
    // 손으로 고친 글은 상품 값을 따라 저절로 바뀌지 않는다
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '홍광' }))
    await tick(w)
    await w.timer.advance(30_000)
    await run(w)
    expect(posted(w)).toHaveLength(2)
  })

  it('지우지 못하면 고친 글 앞에 [수정]', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    w.fake.fail('liveChatMessages.delete', { status: 403, reason: 'forbidden' })
    const [post] = (await list(w, connected, b.id)).posts
    await expectOk(client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/repost`, { key: post?.key, text: '15번 성광 10,000원 가나다님 구매 감사합니다' }))
    await run(w)
    expect(posted(w)).toEqual([FIRST, '[수정] 15번 성광 10,000원 가나다님 구매 감사합니다'])
    const view = await list(w, connected, b.id)
    expect(view.posts.map((item) => [item.kind, item.gone, item.note])).toEqual([
      ['MANUAL', false, null],
      ['THANKS', false, '앞 글을 지우지 못해 [수정] 글을 따로 올렸어요'],
    ])
  })

  it('자동 정정을 기다리던 글을 손으로 고치면 자동 정정은 하지 않는다(판매자 글이 이긴다)', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await tick(w)
    const [post] = (await list(w, connected, b.id)).posts
    expect(post).toMatchObject({ note: '상품 정보가 바뀌어 곧 고친 글로 바꿔요', canEdit: true })
    await expectOk(client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/thanks-posts/repost`, { key: post?.key, text: '15번 성광 9,000원 가나다님 구매 감사합니다' }))
    await w.timer.advance(30_000)
    await run(w)
    expect(posted(w)).toEqual([FIRST, '15번 성광 9,000원 가나다님 구매 감사합니다'])
    expect(w.fake.removed).toHaveLength(1)
    expect((await fixes(w, connected, b.id)).map((fix) => [fix.manual, fix.state, fix.reason])).toEqual([
      [false, 'SKIPPED', 'MANUAL'],
      [true, 'DONE', null],
    ])
  })

  it('글 확인: 비었거나 너무 길면 400, 하는 중에 또 누르면 409', async () => {
    const w = await world({ start: EIGHT_PM })
    const { connected, b } = await onePosted(w)
    const http = client(w, connected.seller.cookie)
    const [post] = (await list(w, connected, b.id)).posts
    expect((await http.post(`/api/broadcasts/${b.id}/thanks-posts/repost`, { key: post?.key, text: ' ​ ' })).status).toBe(400)
    expect((await http.post(`/api/broadcasts/${b.id}/thanks-posts/repost`, { key: post?.key, text: '가'.repeat(MANUAL_TEXT_MAX + 1) })).status).toBe(400)
    await expectOk(http.post(`/api/broadcasts/${b.id}/thanks-posts/repost`, { key: post?.key, text: '가'.repeat(MANUAL_TEXT_MAX) }))
    const twice = await http.post(`/api/broadcasts/${b.id}/thanks-posts/delete`, { key: post?.key })
    expect(twice.status).toBe(409)
    expect((twice.body.error as { code: string }).code).toBe('BUSY')
  })
})
