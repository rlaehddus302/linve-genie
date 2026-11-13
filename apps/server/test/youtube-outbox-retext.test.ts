// 라이브 복기 2026-11-12 (D-RETRO-01·D-RETRO-02, DOMAIN_RULES R-13 "게시 전 감사 문구"·"묶음 감사" 운영 기본 10초):
// 감사 채팅은 확정 뒤 10초(운영 판매자 기본 묶음 창) 기다렸다 나가고, 그사이 판매자가 고친 품종·찜에 적용한 가격이 게시 글에 들어간다.
// 발송함 행에 적힌 효과(나온 때의 문구)는 기록이라 그대로다 — 재생 대조가 맞아야 한다.
// 둘 다 운영 판매자 기본값(SELLER_DEFAULTS)이다 — 여기서는 같은 값을 판매자 설정으로 넣는다(기본값 자체는 seller-defaults.test.ts).
import { listEffects } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
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

/** 20:00:00 KST */
const EIGHT_PM = Date.parse('2026-10-19T11:00:00Z')
/** 운영 판매자 기본값과 같은 감사 설정: 묶음 창 10초(D-RETRO-01), 게시 전 감사 문구가 고침을 따라감(D-RETRO-02) */
const NO_LABEL = { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': SELLER_DEFAULTS['thanks.batchWindowSec'], 'thanks.followEdits': SELLER_DEFAULTS['thanks.followEdits'] }

function runner(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube.outbox
}
const run = (w: YoutubeWorld) => drive(w, runner(w).runOnce())

interface Row {
  state: string
  reason: string | null
  text: string
  nextAt: string | null
}
async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<Row[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}
async function chat(w: YoutubeWorld, connected: Connected, b: string, id: string, ch: string, nick: string, text: string) {
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b, id, ch, nick, text, publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}
async function product(w: YoutubeWorld, connected: Connected, b: string, no: number, name: string, price: number) {
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b, no, name, price }))
}
/** 발송함 행에 적힌 효과의 문구 (효과가 나온 때의 것) */
async function recordedTexts(w: YoutubeWorld): Promise<(string | null)[]> {
  const found = (await w.database.pglite?.query<{ body: string }>(`select body from outbox where kind = 'POST_THANKS' order by id`))?.rows ?? []
  return found.map((row) => (JSON.parse(row.body) as { text: string | null }).text)
}

describe('D-RETRO-01 감사 묶음 10초 (운영 판매자 기본값)', () => {
  it('묶음 창 10초: 확정 뒤 10초 동안 기다렸다 한 건이 그대로 나간다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    const saved = (await client(w, connected.seller.cookie).get('/api/settings')).body.settings as Record<string, unknown>
    expect(saved['thanks.batchWindowSec']).toBe(10)
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    const confirmedAt = w.timer.now()
    await runner(w).runOnce()
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'WINDOW', nextAt: new Date(confirmedAt + 10_000).toISOString() })
    await w.timer.set(confirmedAt + 9000)
    await runner(w).runOnce()
    expect(w.fake.posted).toHaveLength(0)
    await w.timer.set(confirmedAt + 10_000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'])
    expect((await rows(w, connected, b.date)).map((row) => row.state)).toEqual(['SENT'])
  })

  it('0으로 저장한 판매자는 지금처럼 한 건씩 바로 나간다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'])
  })
})

describe('D-RETRO-02 기다리는 동안 고친 품종·가격이 게시 글에 들어간다', () => {
  it('품종 고침 + 이미 찜한 손님에게도 적용한 가격 고침 → 고친 값으로 게시. 행에 적힌 효과는 나온 때의 문구 그대로(재생 대조 일치), 엔진은 게시 보고로 잠금', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 93, '손돕', 20000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '93')
    await runner(w).runOnce()
    await w.timer.advance(4000)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 93, name: '손톱', price: 10000, applyTo: 'UNPAID_CLAIMS' }))
    await runner(w).runOnce()
    expect(w.fake.posted).toHaveLength(0)
    await w.timer.advance(6000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['93번 손톱 10,000원 홍길동님 구매 감사합니다'])
    const [row] = await rows(w, connected, b.date)
    expect(row).toMatchObject({ state: 'SENT', text: '93번 손톱 10,000원 홍길동님 구매 감사합니다' })
    expect(await recordedTexts(w)).toEqual(['93번 손돕 20,000원 홍길동님 구매 감사합니다'])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(listEffects(state).map((effect) => [effect.kind, effect.status, effect.text])).toEqual([['POST_THANKS', 'DONE', '93번 손톱 10,000원 홍길동님 구매 감사합니다']])
    const [check] = await checkReplay(w.database.db, { sellerId: connected.seller.sellerId, rehearsal: false })
    expect(check).toMatchObject({ ok: true })
  })

  it('새 찜부터(NEW_ONLY) 가격 고침은 찜 금액이 그대로라 게시 글의 금액도 그대로', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 93, '손톱', 20000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '93')
    await runner(w).runOnce()
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 93, price: 10000 }))
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['93번 손톱 20,000원 홍길동님 구매 감사합니다'])
  })

  it('묶음: 창 안의 두 판매 중 하나만 고쳐도 묶음 글에 고친 값이 들어가고, 확정이 풀린 판매는 빠진다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '상광', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await product(w, connected, b.id, 17, '성미인', 8000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '김철수', '16')
    await chat(w, connected, b.id, 'c3', 'UCc', '이영희', '17')
    await runner(w).runOnce()
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 17, buyer: 'UCc', reason: '취소' }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 17, name: '고친 이름' }))
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 성광 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다'])
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.reason])).toEqual([
      ['SENT', null],
      ['SENT', null],
      ['SKIPPED', 'CANCELLED'],
    ])
  })

  it('이미 게시된 뒤에 고치면 다시 올리지 않고 게시된 글도 그대로다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await runner(w).runOnce()
    await w.timer.advance(10_000)
    await run(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광', price: 5000, applyTo: 'UNPAID_CLAIMS' }))
    await w.timer.advance(60_000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 상광 10,000원 홍길동님 구매 감사합니다'])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(listEffects(state).map((effect) => [effect.status, effect.text])).toEqual([['DONE', '15번 상광 10,000원 홍길동님 구매 감사합니다']])
  })

  it('다시 시도: 게시가 실패해 기다리는 동안 고치면 다시 시도하는 글에 고친 값이 들어간다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await runner(w).runOnce()
    w.fake.fail('liveChatMessages.insert', { status: 503 })
    await w.timer.advance(10_000)
    await runner(w).runOnce()
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.reason])).toEqual([['WAITING', 'RETRY']])
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광' }))
    await w.timer.advance(2000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 성광 10,000원 홍길동님 구매 감사합니다'])
  })

  it('고침 따라가기를 켜지 않은 방송(옛 방송)은 기다리는 동안 고쳐도 나온 때의 문구로 게시한다 — 재생 대조 일치', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 10 } })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await runner(w).runOnce()
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광', price: 5000, applyTo: 'UNPAID_CLAIMS' }))
    await w.timer.advance(10_000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 상광 10,000원 홍길동님 구매 감사합니다'])
    const [check] = await checkReplay(w.database.db, { sellerId: connected.seller.sellerId, rehearsal: false })
    expect(check).toMatchObject({ ok: true })
  })

  it('영상 댓글(판매마다)도 올리기 직전의 문구를 쓴다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'VIDEO_COMMENT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'PER_SALE' } })
    await product(w, connected, b.id, 15, '상광', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await expectOk(writeEvent(w, connected.seller, { type: 'product.update', b: b.id, no: 15, name: '성광', price: 7000, applyTo: 'UNPAID_CLAIMS' }))
    await run(w)
    expect(w.fake.comments.map((comment) => comment.text)).toEqual(['15번 성광 7,000원 홍길동님 구매 감사합니다'])
  })
})
