// 밴드 감사 3회차 (BND1): 회차 끝이 아닌 기록 거절은 다시 시도(D-BND1-22, RA-BND1-09), 막다른 경우 60초 간격·한도 신호 뒤 600초 전체 읽기 멈춤
// (D-BND1-23, RA-BND1-05), 바뀐 것이 있을 때만 연결 알림(D-BND1-24, RA-BND1-08). 가짜 밴드 서버·주입한 시계.
import { afterEach, describe, expect, it } from 'vitest'
import type { PlatformRecordOutcome } from '../src/platform-record.ts'
import { recordPlatformChats } from '../src/platform-record.ts'
import { bandLinkSignature, type BandLinkView } from '../src/band/service.ts'
import { client, rid, type Seller } from './support.ts'
import { DATE, bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, restartBand, tick, type BandWorld, type BandWorldOptions } from './band-support.ts'

let w: BandWorld | null = null
afterEach(async () => {
  await w?.close()
  w = null
})
async function world(options: BandWorldOptions = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

async function opened(w: BandWorld, options: { readonly seller?: Seller; readonly name?: string } = {}) {
  const shop = await bandSeller(w, { ...(options.seller === undefined ? {} : { seller: options.seller }), ...(options.name === undefined ? {} : { name: options.name }) })
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

const RETRYING = '밴드 댓글을 읽지 못해 다시 시도하고 있어요.'
const ENDED = '방송을 끝내서 밴드 댓글을 그만 받았어요.'
/** 연결 알림은 보기를 읽은 뒤 보낸다 — 실제 타이머로 잠깐 기다린다 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 60))

/** 기록을 거절하게 만드는 고리: reject > 0인 동안 댓글이 든 묶음을 code로 거절한다 */
function rejecting(code: string) {
  const state = { reject: 0, attempts: 0 }
  const hooks: BandWorldOptions['hooks'] = {
    record: async (job, next): Promise<PlatformRecordOutcome> => {
      if (job.chats.length > 0) state.attempts += 1
      if (job.chats.length > 0 && state.reject > 0) {
        state.reject -= 1
        return { kind: 'rejected', code }
      }
      return next(job)
    },
  }
  return { state, hooks }
}

describe('D-BND1-22 기록 거절 — 회차 끝일 때만 끝내고 그 밖은 다시 시도 (AC-BND1-23, RA-BND1-09)', () => {
  it('재현: 끝나지 않은 회차에서 회차 끝이 아닌 사유로 한 번 거절 → RETRYING·끝내지 않음, 10초 뒤 다시 시도에서 그 댓글이 chat 1개로 · READING', async () => {
    const { state, hooks } = rejecting('STATE_FORMAT')
    const w = await world({ hooks })
    const { seller, postKey, b } = await opened(w)
    state.reject = 1
    guestComment(w, postKey, '1번 주세요', { name: '김다육' })
    await tick(w, 10_000)
    const view = await bandView(w, seller, b)
    expect(view).toMatchObject({ state: 'RETRYING', message: RETRYING, finishReason: null, rateLimited: false })
    expect(JSON.stringify(view)).not.toContain(ENDED)
    expect(Date.parse(view.retryAt as string) - w.bclock.now()).toBe(10_000)
    expect(await chats(w, seller.sellerId)).toEqual([])
    // 로그는 코드와 거절 코드만 (댓글 글·이름 없음)
    const rejected = w.logs.filter((log) => log.code === 'BAND_RECORD_REJECTED')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: 'STATE_FORMAT', seller: seller.sellerId })
    expect(JSON.stringify(w.logs)).not.toContain('1번 주세요')
    expect(JSON.stringify(w.logs)).not.toContain('김다육')
    expect(w.logs.some((log) => log.code === 'BAND_ENDED_STOPPED')).toBe(false)
    // 다시 시도 (빠른 읽기) — 거절된 댓글은 본 댓글 표에 없으니 다시 넣어 본다
    await tick(w, 10_000)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((chat) => chat.text)).toEqual(['1번 주세요'])
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING', received: 1, failures: 0 })
    // 두 번 넣지 않는다 (빠른·전체 읽기)
    await tick(w, 70_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
  })

  it('거절이 계속되면 다시 시도 간격이 10·20·40·80·160·300초로 늘고(간격 0 고리 없음) 마지막으로 읽은 때는 그대로 — 풀리면 그 댓글이 한 번', async () => {
    const { state, hooks } = rejecting('NOT_SUPPORTED')
    const w = await world({ hooks })
    const { seller, postKey, b } = await opened(w)
    await tick(w, 10_000)
    const readAt = (await bandView(w, seller, b)).lastReadAt
    expect(readAt).not.toBeNull()
    state.reject = 1_000
    guestComment(w, postKey, '2번')
    const waits: number[] = []
    let at = w.bclock.now() + 10_000
    for (let i = 0; i < 6; i += 1) {
      await w.bclock.advance(at - w.bclock.now())
      const view = await bandView(w, seller, b)
      expect(view).toMatchObject({ state: 'RETRYING', message: RETRYING, lastReadAt: readAt })
      const retryAt = Date.parse(view.retryAt as string)
      waits.push(retryAt - w.bclock.now())
      at = retryAt
    }
    expect(waits).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000])
    // 차례마다 기록을 한 번만 해 본다 (쉬지 않고 다시 읽는 고리 없음)
    expect(state.attempts).toBe(6)
    expect(await chats(w, seller.sellerId)).toEqual([])
    // 60초 넘게 RETRYING — 화면 알림 띠 셈(D-BND1-18)은 마지막으로 읽은 때부터
    expect(w.bclock.now() - Date.parse(readAt as string)).toBeGreaterThan(60_000)
    state.reject = 0
    await w.bclock.advance(at - w.bclock.now())
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toEqual(['2번'])
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING' })
  })

  it('거절 코드가 SEALED이면 회차 끝으로 보고 바로 FINISHED(회차 끝) — 그 뒤 요청 0', async () => {
    const { state, hooks } = rejecting('SEALED')
    const w = await world({ hooks })
    const { seller, postKey, b } = await opened(w)
    state.reject = 1
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'FINISHED', finishReason: 'ENDED', message: ENDED })
    expect(w.logs.some((log) => log.code === 'BAND_RECORD_REJECTED')).toBe(false)
    const after = w.fake.requests.length
    await tick(w, 120_000)
    expect(w.fake.requests.length).toBe(after)
  })

  it('platform-record는 거절 코드를 싣는다: 연결 확인 실패 NOT_LINKED · 범위 없음 NOT_FOUND · 끝난 회차 BROADCAST_ENDED', async () => {
    const w = await world()
    const { seller, b } = await opened(w)
    const chat = { id: 'band:x1', ch: 'band:G', nick: '손님', text: '1번', owner: false }
    expect(await recordPlatformChats(w.server.writer, { sellerId: seller.sellerId, date: DATE, b, chats: [chat], guard: async () => false })).toEqual({ kind: 'rejected', code: 'NOT_LINKED' })
    expect(await recordPlatformChats(w.server.writer, { sellerId: seller.sellerId, date: '2020-01-01', b, chats: [chat], guard: async () => true })).toEqual({ kind: 'rejected', code: 'NOT_FOUND' })
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    expect(await recordPlatformChats(w.server.writer, { sellerId: seller.sellerId, date: DATE, b, chats: [chat], guard: async () => true })).toEqual({ kind: 'rejected', code: 'BROADCAST_ENDED' })
  })
})

describe('D-BND1-23 (가) 막다른 경우 — 닿는 읽기가 성공할 때까지 60초 간격 (AC-BND1-30, RA-BND1-05)', () => {
  it('알림이 난 차례 뒤 59초 동안 댓글 목록 요청 0, 60초에 다음 차례 · 120초 요청 ≤ 306 · 새 댓글을 지워 닿으면 그다음 차례는 10초 뒤', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    for (let i = 0; i < 990; i += 1) w.fake.addComment(postKey, { content: '예전', userKey: 'OLD', createdAt: i + 1 })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    const t = w.bclock.now()
    for (let i = 0; i < 20; i += 1) guestComment(w, postKey, `앞 ${String(i)}`, { createdAt: t + i })
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(20)
    const late: string[] = []
    for (let i = 0; i < 1001; i += 1) late.push(guestComment(w, postKey, `뒤 ${String(i)}`, { createdAt: t + 100 + i }))
    // 막다른 차례 (빠른 → 전체 → 빠른, 기록 0, 알림 한 번)
    await tick(w, 10_000)
    expect(((await bandView(w, seller, b)).notices as { items: { kind: string }[] }).items.map((item) => item.kind)).toEqual(['STUCK'])
    const mark = w.fake.calls('comments').length
    await tick(w, 59_000)
    expect(w.fake.calls('comments').length).toBe(mark)
    await tick(w, 1_000)
    expect(w.fake.calls('comments').length).toBeGreaterThan(mark)
    await tick(w, 60_000)
    // 120초 동안: 많아야 2 × (2 × 51 + 51)
    expect(w.fake.calls('comments').length - mark).toBeLessThanOrEqual(2 * (2 * 51 + 51))
    expect(await chats(w, seller.sellerId)).toHaveLength(20)
    expect((await bandView(w, seller, b)).notices).toMatchObject({ total: 1 })
    // 새 댓글을 지우면 빠른 읽기가 본 댓글에 닿는다 → 닿는 읽기 성공 → 다음 차례는 10초 뒤
    for (const key of late) w.fake.dropComment(postKey, key)
    await tick(w, 60_000)
    const readAt = (await bandView(w, seller, b)).lastReadAt
    expect(readAt).toBe(new Date(w.bclock.now()).toISOString())
    const back = w.fake.calls('comments').length
    await tick(w, 9_000)
    expect(w.fake.calls('comments').length).toBe(back)
    await tick(w, 1_000)
    expect(w.fake.calls('comments').length).toBeGreaterThan(back)
  })
})

describe('D-BND1-23 (나) 호출 한도 신호 뒤 600초 동안 전체 읽기 없음 (AC-BND1-53, RA-BND1-05)', () => {
  const fullCalls = (w: BandWorld, userKey: string) => w.fake.callsOfUser(userKey).filter((call) => call.op === 'comments' && call.query['sort'] === '+created_at').length

  /** 판매자 A를 잇고 5초 뒤 B를 잇는다 — A의 차례(10초)가 B(15초)보다 먼저라 A에만 오류를 줄 수 있다 */
  async function two(w: BandWorld) {
    const a = await opened(w)
    await tick(w, 5_000)
    const bb = await opened(w, { name: '둘째 가게' })
    await tick(w, 4_000)
    return { a, bb }
  }

  it('1002: A만 600초 동안 sort=+created_at 0 — A의 빠른 읽기는 계속(새 댓글 기록), B의 전체 읽기는 그대로 60초마다 · 600초 뒤 A의 전체 읽기가 다시', async () => {
    const w = await world()
    const { a, bb } = await two(w)
    const fullA0 = fullCalls(w, a.userKey)
    const fullB0 = fullCalls(w, bb.userKey)
    w.fake.fail('comments', { resultCode: 1002 })
    await tick(w, 1_000)
    expect(await bandView(w, a.seller, a.b)).toMatchObject({ state: 'RETRYING', rateLimited: true })
    expect(await bandView(w, bb.seller, bb.b)).toMatchObject({ state: 'READING' })
    const signal = w.bclock.now()
    // 쉬고(30초) 다시 읽은 뒤 손님 댓글 — 빠른 읽기로 들어온다
    await tick(w, 100_000)
    guestComment(w, a.postKey, '1번')
    await tick(w, 20_000)
    expect((await chats(w, a.seller.sellerId)).map((chat) => chat.text)).toEqual(['1번'])
    await w.bclock.advance(signal + 600_000 - 1 - w.bclock.now())
    expect(fullCalls(w, a.userKey)).toBe(fullA0)
    // B는 60초마다 그대로 (600초에 9번 이상)
    expect(fullCalls(w, bb.userKey) - fullB0).toBeGreaterThanOrEqual(9)
    expect(await bandView(w, a.seller, a.b)).toMatchObject({ state: 'READING' })
    // 600초가 지나면 A의 전체 읽기가 다시 생긴다
    await tick(w, 20_000)
    expect(fullCalls(w, a.userKey)).toBeGreaterThan(fullA0)
  })

  it('1001: 600초 동안 A·B 모두 sort=+created_at 0 · 그 뒤 다시', async () => {
    const w = await world()
    const { a, bb } = await two(w)
    const fullA0 = fullCalls(w, a.userKey)
    const fullB0 = fullCalls(w, bb.userKey)
    w.fake.fail('comments', { resultCode: 1001 })
    await tick(w, 1_000)
    const signal = w.bclock.now()
    await w.bclock.advance(signal + 600_000 - 1 - w.bclock.now())
    expect(fullCalls(w, a.userKey)).toBe(fullA0)
    expect(fullCalls(w, bb.userKey)).toBe(fullB0)
    // 쉼(60초)이 끝난 뒤 빠른 읽기는 돌았다
    expect(w.fake.callsOfUser(bb.userKey).filter((call) => call.op === 'comments').length).toBeGreaterThan(0)
    expect(await bandView(w, a.seller, a.b)).toMatchObject({ state: 'READING' })
    expect(await bandView(w, bb.seller, bb.b)).toMatchObject({ state: 'READING' })
    await tick(w, 20_000)
    expect(fullCalls(w, a.userKey)).toBeGreaterThan(fullA0)
    expect(fullCalls(w, bb.userKey)).toBeGreaterThan(fullB0)
  })

  it('한도 신호 동안 빠른 읽기가 닿지 못하면 전체 읽기 없이 기록 0 · 막다른 경우 알림 한 번 · 60초 간격', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    guestComment(w, postKey, '앞')
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    w.fake.fail('comments', { resultCode: 1003 })
    await tick(w, 10_000)
    const full0 = fullCalls(w, userKey)
    // 쉬는 동안 1,001개가 한꺼번에 — 빠른 읽기는 본 댓글에 닿지 못한다
    const t = w.bclock.now()
    for (let i = 0; i < 1001; i += 1) guestComment(w, postKey, `뒤 ${String(i)}`, { createdAt: t + i })
    await tick(w, 30_000)
    expect(fullCalls(w, userKey)).toBe(full0)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    expect(((await bandView(w, seller, b)).notices as { items: { kind: string }[] }).items.map((item) => item.kind)).toEqual(['STUCK'])
    const mark = w.fake.calls('comments').length
    await tick(w, 59_000)
    expect(w.fake.calls('comments').length).toBe(mark)
    await tick(w, 1_000)
    expect(w.fake.calls('comments').length).toBe(mark + 51)
    expect(fullCalls(w, userKey)).toBe(full0)
    expect(w.logs.filter((log) => log.code === 'BAND_STUCK')).toHaveLength(1)
  })
})

describe('D-BND1-24 바뀐 것이 있을 때만 연결 알림 (AC-BND1-50, RA-BND1-08)', () => {
  const linkPushes = (w: BandWorld, b: string) => w.published.filter((item) => item.data['kind'] === 'LINK' && item.data['broadcast'] === b)

  it('조용한 차례 3번 → 0 · 새 댓글 하나 → 1 · 다시 조용 → 0 · READING→RETRYING → 1(마지막으로 읽은 때가 실림) · 판매자 조작은 늘 보냄', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    await tick(w, 10_000)
    await flush()
    let mark = linkPushes(w, b).length
    for (let i = 0; i < 3; i += 1) await tick(w, 10_000)
    await flush()
    expect(linkPushes(w, b).length - mark).toBe(0)
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    await flush()
    expect(linkPushes(w, b).length - mark).toBe(1)
    expect((linkPushes(w, b).at(-1)?.data['link'] as BandLinkView).received).toBe(1)
    mark = linkPushes(w, b).length
    await tick(w, 10_000)
    await flush()
    expect(linkPushes(w, b).length - mark).toBe(0)
    const readAt = (await bandView(w, seller, b)).lastReadAt
    w.fake.fail('comments', { http: 500 })
    await tick(w, 10_000)
    await flush()
    const pushes = linkPushes(w, b).slice(mark)
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.data['link']).toMatchObject({ state: 'RETRYING', lastReadAt: readAt })
    // 판매자 조작(확인했어요)은 바뀐 것이 없어도 보낸다
    mark = linkPushes(w, b).length
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/band/notices-seen`, { upTo: 0 })).status).toBe(200)
    await flush()
    expect(linkPushes(w, b).length - mark).toBe(1)
  })

  it('서버를 다시 켠 뒤 첫 차례는 보낸다', async () => {
    const w1 = await world()
    const { b } = await opened(w1)
    await tick(w1, 10_000)
    const w2 = await restartBand(w1)
    w = w2
    await w2.server.band.resume()
    await tick(w2, 0)
    await flush()
    expect(linkPushes(w2, b)).toHaveLength(1)
    await tick(w2, 10_000)
    await flush()
    expect(linkPushes(w2, b)).toHaveLength(1)
    await w2.close()
    await w1.fake.close()
    await w1.database.close()
    w = null
  })

  it('비교 값: 시각 칸·쉬는 남은 초만 다르면 같고, 상태·문장·기록 수·뺀 수·알림 수와 번호가 다르면 다르다', () => {
    const base: BandLinkView = {
      broadcast: 'b1',
      platform: 'BAND',
      state: 'READING',
      message: '밴드 댓글을 읽고 있어요.',
      canLink: false,
      blockCode: 'ALREADY_LINKED',
      blockMessage: '이미 이어져 있어요.',
      linkedAt: '2026-10-19T03:00:00.000Z',
      actor: { kind: 'account', loginId: null },
      post: { bandKey: 'B', postKey: 'P', firstLine: '공구 글' },
      lastReadAt: '2026-10-19T03:00:10.000Z',
      received: 1,
      baseline: 0,
      baselineMessage: null,
      skipped: { SELLER: 0, NO_AUTHOR: 0, BAD_COMMENT_KEY: 0, BAD_TIME: 0, NO_TEXT: 0, TEXT_TOO_LONG: 0, DUPLICATE: 0 },
      skipMessages: [],
      failures: 0,
      retryAt: null,
      rateLimited: false,
      finishReason: null,
      notices: { items: [{ id: 1, kind: 'LATE', message: '늦게', at: '2026-10-19T03:00:10.000Z', seen: false }], total: 1, seenUpTo: 0, unseen: 1, unseenEdits: 0 },
    }
    const sig = bandLinkSignature(base)
    expect(bandLinkSignature({ ...base, lastReadAt: null })).toBe(sig)
    expect(bandLinkSignature({ ...base, lastReadAt: '2026-10-19T03:05:00.000Z', retryAt: '2026-10-19T03:06:00.000Z', linkedAt: '2026-10-19T02:00:00.000Z' })).toBe(sig)
    expect(bandLinkSignature({ ...base, notices: { ...base.notices, items: [{ id: 1, kind: 'LATE', message: '늦게', at: '2026-10-19T04:00:00.000Z', seen: false }] } })).toBe(sig)
    const rate = { ...base, state: 'RETRYING' as const, rateLimited: true }
    expect(bandLinkSignature({ ...rate, message: '밴드가 잠시 쉬어 달라고 해서 30초 뒤에 다시 읽어요.' })).toBe(bandLinkSignature({ ...rate, message: '밴드가 잠시 쉬어 달라고 해서 29초 뒤에 다시 읽어요.' }))
    for (const changed of [
      { ...base, state: 'RETRYING' as const },
      { ...base, message: '다른 문장' },
      { ...base, received: 2 },
      { ...base, skipped: { ...base.skipped, NO_AUTHOR: 1 } },
      { ...base, notices: { ...base.notices, unseen: 0 } },
      { ...base, notices: { ...base.notices, total: 2, items: [{ id: 2, kind: 'STUCK' as const, message: '막힘', at: '2026-10-19T03:00:10.000Z', seen: false }, ...base.notices.items] } },
      { ...base, notices: { ...base.notices, seenUpTo: 1 } },
    ]) {
      expect(bandLinkSignature(changed)).not.toBe(sig)
    }
  })
})
