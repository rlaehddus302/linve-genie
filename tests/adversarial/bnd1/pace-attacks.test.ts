// BND1 적대 시험 3회차 (test-domain): 감사 3회차 고침(D-BND1-22·23)을 서버 경로로 공격한다.
// - 회차 끝이 아닌 기록 거절이 무작위 코드로 계속될 때: 다시 시도 간격이 0 없이 늘고(10초부터 두 배, 300초 상한), 차례마다 기록 시도 한 번,
//   걸린 타이머는 늘 하나, 끝나지 않음, 풀리면 그 댓글이 정확히 한 번 (fast-check)
// - 거절이 계속되는 동안 회차를 끝내면 FINISHED·그 뒤 요청 0·타이머 0
// - 끝나지 않는 쪽 넘기기로 막힌 동안 120초 요청 수 ≤ 306 (AC-BND1-30)
// - 1001 동안 세 판매자(읽는 중·막다른 경우·다시 시도) 모두 sort=+created_at 0, 600초 안에 다시 오면 그때부터 다시 600초 (AC-BND1-53)
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import '../../../apps/server/test/setup-band-guard.ts'
import type { PlatformRecordOutcome } from '../../../apps/server/src/platform-record.ts'
import { client, rid } from '../../../apps/server/test/support.ts'
import { bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, tick, type BandWorld, type BandWorldOptions } from '../../../apps/server/test/band-support.ts'

const worlds: BandWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})
async function world(options: BandWorldOptions = {}): Promise<BandWorld> {
  const w = await bandWorld(options)
  worlds.push(w)
  return w
}

const RETRYING = '밴드 댓글을 읽지 못해 다시 시도하고 있어요.'
const ENDED = '방송을 끝내서 밴드 댓글을 그만 받았어요.'

async function opened(w: BandWorld, name?: string) {
  const shop = await bandSeller(w, name === undefined ? {} : { name })
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey, content: '공구 글' })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

/** 댓글이 든 묶음 기록을 codes 차례대로 거절하는 고리 (codes가 바닥나면 실제 기록) */
function rejecting() {
  const state = { codes: [] as string[], attempts: 0, forever: null as string | null, only: null as string | null }
  const hooks: BandWorldOptions['hooks'] = {
    record: async (job, next): Promise<PlatformRecordOutcome> => {
      if (job.chats.length === 0 || (state.only !== null && job.sellerId !== state.only)) return next(job)
      state.attempts += 1
      if (state.forever !== null) return { kind: 'rejected', code: state.forever }
      const code = state.codes.shift()
      return code === undefined ? next(job) : { kind: 'rejected', code }
    },
  }
  return { state, hooks }
}

const NOT_ENDED_CODES = ['NOT_FOUND', 'STATE_FORMAT', 'NOT_SUPPORTED', 'NOT_LINKED', 'ENGINE_ERROR', 'BROADCAST_ENDED_X', 'sealed', '']

describe('TD-BND1 회차 끝이 아닌 기록 거절이 계속됨 (AC-BND1-23·52, D-BND1-22)', () => {
  it('무작위 거절 코드 1~8번: 간격 10초부터 두 배·300초 상한(0 없음), 타이머 하나, 차례마다 기록 한 번, 끝나지 않음, 풀리면 그 댓글 한 번 · READING', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...NOT_ENDED_CODES), { minLength: 1, maxLength: 8 }), async (codes) => {
        const { state, hooks } = rejecting()
        const w = await bandWorld({ hooks })
        try {
          const { seller, postKey, b } = await opened(w)
          await tick(w, 10_000)
          const readAt = (await bandView(w, seller, b)).lastReadAt
          state.codes = [...codes]
          guestComment(w, postKey, '3번 주세요', { name: '이다육' })
          let at = w.bclock.now() + 10_000
          const waits: number[] = []
          for (let i = 0; i < codes.length; i += 1) {
            await w.bclock.advance(at - w.bclock.now())
            expect(w.bclock.pendingTimers).toBe(1)
            const view = await bandView(w, seller, b)
            expect(view).toMatchObject({ state: 'RETRYING', message: RETRYING, finishReason: null, lastReadAt: readAt })
            const retryAt = Date.parse(view.retryAt as string)
            waits.push(retryAt - w.bclock.now())
            at = retryAt
          }
          expect(waits).toEqual(codes.map((_, i) => Math.min(10_000 * 2 ** i, 300_000)))
          expect(state.attempts).toBe(codes.length)
          expect(await chats(w, seller.sellerId)).toEqual([])
          const rejected = w.logs.filter((log) => log.code === 'BAND_RECORD_REJECTED')
          expect(rejected.map((log) => log['reason'])).toEqual(codes)
          expect(JSON.stringify(w.logs)).not.toContain('3번 주세요')
          expect(JSON.stringify(w.logs)).not.toContain('이다육')
          // 1ms 전에는 아무것도 하지 않는다 (간격 0 고리 없음)
          const before = w.fake.calls('comments').length
          await w.bclock.advance(at - w.bclock.now() - 1)
          expect(w.fake.calls('comments').length).toBe(before)
          await w.bclock.advance(1)
          await tick(w, 0)
          expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toEqual(['3번 주세요'])
          expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING', received: 1, failures: 0 })
          expect(state.attempts).toBe(codes.length + 1)
          // 빠른·전체 읽기를 더 돌아도 두 번 들어가지 않는다
          await tick(w, 130_000)
          expect(await chats(w, seller.sellerId)).toHaveLength(1)
          expect(w.logs.some((log) => log.code === 'BAND_ENDED_STOPPED')).toBe(false)
        } finally {
          await w.close()
        }
      }),
      { numRuns: 6, seed: 0x0bd3, endOnFailure: true },
    )
  }, 240_000)

  it('거절이 끝없이 계속되면 1시간 동안 기록 시도는 다시 시도 차례 수만큼(10·20·40·80·160 뒤 300초마다) · 걸린 타이머 늘 하나 · 그 사이 회차를 끝내면 FINISHED·요청 0·타이머 0', async () => {
    const { state, hooks } = rejecting()
    const w = await world({ hooks })
    const { seller, postKey, b } = await opened(w)
    await tick(w, 10_000)
    state.forever = 'ENGINE_ERROR'
    guestComment(w, postKey, '1번')
    for (let s = 0; s < 360; s += 1) {
      await tick(w, 10_000)
      expect(w.bclock.pendingTimers).toBe(1)
    }
    // 3600초 안의 다시 시도 차례(댓글 단 뒤 첫 차례 10초, 그 뒤 10·20·40·80·160초, 그다음 300초마다) — 차례마다 한 번
    const expected: number[] = []
    for (let at = 10_000, i = 0; at <= 3_600_000; i += 1) {
      expected.push(at)
      at += Math.min(10_000 * 2 ** i, 300_000)
    }
    expect(expected).toHaveLength(16)
    expect(state.attempts).toBe(expected.length)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'RETRYING', message: RETRYING })
    expect(await chats(w, seller.sellerId)).toEqual([])
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    await w.server.band.idle()
    const after = w.fake.requests.length
    await tick(w, 900_000)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'FINISHED', message: ENDED })
    expect(w.fake.requests.length).toBe(after)
    expect(w.bclock.pendingTimers).toBe(0)
  }, 120_000)
})

describe('TD-BND1 막다른 경우 동안 요청 수 (AC-BND1-30, D-BND1-23 (가))', () => {
  it('끝나지 않는 쪽 넘기기로 막힌 동안: 알림 뒤 120초 받은 댓글 목록 요청 ≤ 306, 600초 동안 차례는 60초마다 하나씩(10번), 알림은 한 번', async () => {
    const w = await world()
    // 기준선 20개(이을 때 있던 것) — 새 댓글 25개는 첫 쪽(20개)에 다 들어가지 않아 빠른 읽기가 본 댓글에 닿으려면 쪽을 넘겨야 한다
    const shop = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey, content: '공구 글' })
    for (let i = 0; i < 20; i += 1) guestComment(w, postKey, `예전 ${String(i)}`, { createdAt: w.bclock.now() - 3_600_000 + i })
    const b = await realBroadcast(w, shop.seller)
    expect((await linkBand(w, shop.seller, b, shop.bandKey, postKey)).status).toBe(200)
    const seller = shop.seller
    let n = 50_000
    w.fake.pagingOverride = (op, next) => (op === 'comments' ? { ...((next as Record<string, unknown> | null) ?? {}), after: String((n += 1)) } : next)
    for (let i = 0; i < 25; i += 1) guestComment(w, postKey, `새 ${String(i)}`, { createdAt: w.bclock.now() - 9_000 + i })
    await tick(w, 10_000)
    expect(w.logs.filter((log) => log.code === 'BAND_STUCK')).toHaveLength(1)
    const mark = w.fake.calls('comments').length
    await tick(w, 120_000)
    expect(w.fake.calls('comments').length - mark).toBeLessThanOrEqual(306)
    // 차례마다 요청이 있는 시각을 모아 60초 간격인지 본다
    const starts: number[] = []
    for (let s = 0; s < 600; s += 1) {
      const before = w.fake.calls('comments').length
      await tick(w, 1_000)
      if (w.fake.calls('comments').length > before) starts.push(w.bclock.now())
    }
    expect(starts).toHaveLength(10)
    for (let i = 1; i < starts.length; i += 1) expect((starts[i] as number) - (starts[i - 1] as number)).toBe(60_000)
    expect(w.logs.filter((log) => log.code === 'BAND_STUCK')).toHaveLength(1)
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    expect(((await bandView(w, seller, b)).notices as { total: number }).total).toBe(1)
    w.fake.pagingOverride = null
  }, 120_000)
})

describe('TD-BND1 앱 호출 한도 1001 (AC-BND1-53, D-BND1-23 (나))', () => {
  const fullCalls = (w: BandWorld, userKey: string) => w.fake.callsOfUser(userKey).filter((call) => call.op === 'comments' && call.query['sort'] === '+created_at').length

  it('세 판매자(읽는 중 · 막다른 경우 · 다시 시도): 1001 뒤 600초 동안 모두 sort=+created_at 0 · 300초 넘어 1001이 다시 오면 그때부터 다시 600초 · 그 뒤 전체 읽기가 다시', async () => {
    const { state, hooks } = rejecting()
    const w = await world({ hooks })
    const a = await opened(w)
    await tick(w, 3_000)
    // s: 기준선 990개 뒤 새 1,001개 — 빠른 읽기는 닿지 못하고 전체 읽기는 1,000개 상한 (막다른 경우)
    const sShop = await bandSeller(w, { name: '둘째 가게' })
    const sPost = w.fake.addPost({ bandKey: sShop.bandKey, authorUserKey: sShop.userKey })
    for (let i = 0; i < 990; i += 1) w.fake.addComment(sPost, { content: '예전', userKey: 'OLD', createdAt: i + 1 })
    const sB = await realBroadcast(w, sShop.seller)
    expect((await linkBand(w, sShop.seller, sB, sShop.bandKey, sPost)).status).toBe(200)
    await tick(w, 3_000)
    const r = await opened(w, '셋째 가게')
    // s에 20개를 먼저 읽힌다 (본 댓글 1,010개 — 전체 읽기 1,000개 상한 안에는 본 댓글뿐)
    const t0 = w.bclock.now()
    for (let i = 0; i < 20; i += 1) guestComment(w, sPost, `앞 ${String(i)}`, { createdAt: t0 + i })
    await tick(w, 10_000)
    expect(await chats(w, sShop.seller.sellerId)).toHaveLength(20)
    const t = w.bclock.now()
    for (let i = 0; i < 1001; i += 1) guestComment(w, sPost, `뒤 ${String(i)}`, { createdAt: t + 100 + i })
    state.only = r.seller.sellerId
    state.forever = 'NOT_FOUND'
    guestComment(w, r.postKey, '거절')
    await tick(w, 20_000)
    expect(((await bandView(w, sShop.seller, sB)).notices as { items: { kind: string }[] }).items.map((item) => item.kind)).toEqual(['STUCK'])
    expect(await bandView(w, r.seller, r.b)).toMatchObject({ state: 'RETRYING' })
    const users = [a.userKey, sShop.userKey, r.userKey]
    const full0 = users.map((u) => fullCalls(w, u))
    /** 1001을 걸고 그 요청이 나간 1초 칸의 앞 끝(신호는 그보다 뒤)을 돌려준다 */
    const signal = async (): Promise<number> => {
      w.fake.fail('comments', { resultCode: 1001 })
      for (let i = 0; i < 400; i += 1) {
        const before = w.fake.calls('comments').length
        const from = w.bclock.now()
        await tick(w, 1_000)
        if (w.fake.calls('comments').length > before) return from
      }
      throw new Error('1001 요청이 나가지 않음')
    }
    const first = await signal()
    await w.bclock.advance(first + 300_000 - w.bclock.now())
    expect(users.map((u) => fullCalls(w, u))).toEqual(full0)
    const second = await signal()
    expect(second - first).toBeGreaterThanOrEqual(300_000)
    // 첫 신호의 600초가 지나도 두 번째 신호 뒤 600초까지는 모두 0
    await w.bclock.advance(second + 600_000 - w.bclock.now())
    expect(users.map((u) => fullCalls(w, u))).toEqual(full0)
    // 그동안 빠른 읽기는 돌았다: a의 새 댓글이 들어온다
    guestComment(w, a.postKey, '1번')
    state.forever = null
    await tick(w, 400_000)
    expect((await chats(w, a.seller.sellerId)).map((chat) => chat.text)).toEqual(['1번'])
    expect((await chats(w, r.seller.sellerId)).map((chat) => chat.text)).toEqual(['거절'])
    const after = users.map((u) => fullCalls(w, u))
    for (let i = 0; i < users.length; i += 1) expect(after[i]).toBeGreaterThan(full0[i] as number)
  }, 240_000)
})
