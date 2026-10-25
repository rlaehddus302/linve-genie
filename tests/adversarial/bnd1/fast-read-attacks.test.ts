// BND1 적대 시험 2회차 (test-domain): D-BND1-16 "빠른 읽기는 닿았을 때만 기록"·쪽 수 상한·막다른 경우 알림·끝난 회차 고리(RA-BND1-04)를 서버 경로로 공격한다.
// - 무작위 댓글 몰림 × 쪽 크기 × 쪽 중간 5xx × 60초 차례 경계 (fast-check) → 모든 댓글이 정확히 한 번, seq 순서 = 작성 시각 순서
// - 빠른 읽기의 1,000개 상한은 본 댓글까지 센다 — 기준선 5 + 새 1,000개가 한 번에 와도 같은 차례에 모두, 차례대로, 막다른 경우 알림 없음
// - 끝나지 않는 쪽 넘기기(빈 쪽 + 늘 새 after) → 한 차례 요청 상한, STUCK 알림은 닿을 때까지 한 번, 닿은 뒤 다시 막히면 새 알림, 띠 수(unseen)에 든다 (D-BND1-17)
// - 읽기가 밴드 답을 기다리는 동안 회차를 끝냄 → 기록 0, 연결 FINISHED, 그 뒤 요청 0 (AC-BND1-23)
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import '../../../apps/server/test/setup-band-guard.ts'
import { BAND_TIMING } from '../../../apps/server/src/band/service.ts'
import { client, rid } from '../../../apps/server/test/support.ts'
import { bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, tick, type BandWorld } from '../../../apps/server/test/band-support.ts'

const worlds: BandWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})
async function world(): Promise<BandWorld> {
  const w = await bandWorld()
  worlds.push(w)
  return w
}

const STUCK = '밴드 댓글이 너무 많이 한꺼번에 달려 차례대로 읽지 못하고 있어요. 밴드 글에서 직접 확인해 주세요.'

/** 판매자·글·회차를 만들고, 기준선 댓글 baseline개를 단 뒤 잇는다 */
async function opened(w: BandWorld, baseline = 0) {
  const shop = await bandSeller(w)
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey, content: '공구 글' })
  for (let i = 0; i < baseline; i += 1) guestComment(w, postKey, `예전 ${String(i)}`, { createdAt: w.bclock.now() - 3_600_000 + i })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

/** 새 댓글 n개 — 작성 시각이 단 차례대로 늘어난다(묶음 안 1ms씩, 묶음 사이는 시계가 10초 넘게 감). 단 차례의 키 */
function burst(w: BandWorld, postKey: string, n: number): string[] {
  const keys: string[] = []
  const base = w.bclock.now() - 9_000
  for (let i = 0; i < n; i += 1) keys.push(guestComment(w, postKey, `잡담 ${String(i)}`, { createdAt: base + i }))
  return keys
}

/** 기록된 밴드 댓글 키 (seq 차례 — seq가 늘어나는지도 본다) */
async function recordedKeys(w: BandWorld, sellerId: string): Promise<string[]> {
  const rows = await chats(w, sellerId)
  for (let i = 1; i < rows.length; i += 1) expect((rows[i] as { seq: number }).seq).toBeGreaterThan((rows[i - 1] as { seq: number }).seq)
  return rows.map((row) => row.id.split(':').at(-1) as string)
}

type Notices = { items: { kind: string; message: string }[]; total: number; unseen: number }
const noticesOf = async (w: BandWorld, seller: Parameters<typeof bandView>[1], b: string): Promise<Notices> => (await bandView(w, seller, b)).notices as Notices
const stuckCount = (notices: Notices) => notices.items.filter((item) => item.kind === 'STUCK').length

describe('TD-BND1 무작위 몰림 — 빠짐·두 번·순서 (D-BND1-16 모형)', () => {
  it('댓글 몰림(0~260개) × 쪽 크기(5·10·20·50) × 쪽 중간 5xx × 60초 차례 경계: 모든 댓글이 정확히 한 번, seq 순서 = 단 차례, 막다른 경우 알림 없음', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(5, 10, 20, 50),
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.record({ n: fc.integer({ min: 0, max: 260 }), steps: fc.integer({ min: 1, max: 7 }), fails: fc.integer({ min: 0, max: 3 }), failAfter: fc.integer({ min: 0, max: 4 }) }), { minLength: 1, maxLength: 5 }),
        async (pageSize, baseline, rounds) => {
          const w = await bandWorld()
          try {
            w.fake.pageSize = pageSize
            const { seller, postKey, b } = await opened(w, baseline)
            // 모형: 단 차례 (작성 시각이 단 차례대로 늘어나므로 = 작성 시각 순서)
            const expected: string[] = []
            for (const round of rounds) {
              expected.push(...burst(w, postKey, round.n))
              // 쪽 중간(failAfter번 요청 뒤)에서 실패 — 실패한 읽기는 아무것도 넣지 않아야 한다
              if (round.fails > 0) w.fake.fail('comments', { http: 500 }, round.fails, round.failAfter)
              for (let s = 0; s < round.steps; s += 1) await tick(w, 10_000)
            }
            // 회복: 남은 실패를 지우고 다시 시도 시간표를 넘길 만큼 돈다
            w.fake.clearFaults()
            await tick(w, 400_000)
            expect(await recordedKeys(w, seller.sellerId)).toEqual(expected)
            const view = await bandView(w, seller, b)
            expect(view.state).toBe('READING')
            expect(view.received).toBe(expected.length)
            expect(stuckCount(view.notices as Notices)).toBe(0)
          } finally {
            await w.close()
          }
        },
      ),
      { numRuns: 10, seed: 0x0bd1, endOnFailure: true },
    )
  }, 300_000)
})

describe('TD-BND1 빠른 읽기 1,000개 상한 경계 (AC-BND1-30·31, D-BND1-18)', () => {
  it('기준선 0 + 새 1,000개가 한 번에: 빠른 읽기가 마지막 쪽에 닿아(1,000개는 넘지 않음) 한 번에 1,000개를 차례대로 — 못 닿음 로그 없음', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w, 0)
    const keys = burst(w, postKey, 1_000)
    const before = w.fake.calls('comments').length
    await tick(w, 10_000)
    expect(await recordedKeys(w, seller.sellerId)).toEqual(keys)
    expect(w.fake.calls('comments').length - before).toBe(50)
    expect(w.logs.filter((log) => log.code === 'BAND_FAST_UNREACHED')).toHaveLength(0)
    expect(stuckCount(await noticesOf(w, seller, b))).toBe(0)
  }, 60_000)

  it('기준선 5 + 새 1,000개가 한 번에(빠른 읽기는 본 댓글 쪽 직전에 1,000개를 넘음): 같은 차례의 전체 읽기 + 빠른 읽기 한 번 더로 1,000개 모두 차례대로, 막다른 경우 알림 없음', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w, 5)
    const keys = burst(w, postKey, 1_000)
    await tick(w, 10_000)
    expect(await recordedKeys(w, seller.sellerId)).toEqual(keys)
    const notices = await noticesOf(w, seller, b)
    expect(stuckCount(notices)).toBe(0)
    // 한 차례 안에서 끝났으니 다음 읽기들에서 늘지 않는다
    await tick(w, BAND_TIMING.fullMs)
    expect(await recordedKeys(w, seller.sellerId)).toEqual(keys)
  }, 60_000)
})

describe('TD-BND1-002 쪽 넘기기가 끝나지 않는 응답 — 이은 뒤 읽기 차례 (AC-BND1-30·31, D-BND1-16·17)', () => {
  it('빈 쪽과 늘 새 after: 한 차례 요청 ≤ 3 × 60, 기록 0, STUCK 알림 한 번(세 차례 뒤에도) · 띠 수 unseen에 듦 · 회복하면 25개를 차례대로 · 다시 막히면 새 알림', async () => {
    const w = await world()
    // 기준선 20개: 전체 읽기의 첫 쪽(오래된 순)은 본 댓글뿐이라 막혀도 새 댓글이 하나도 기록되지 않는다
    const { seller, postKey, b } = await opened(w, 20)
    let n = 10_000
    const endless = (op: string, next: unknown) => (op === 'comments' ? { ...((next as Record<string, unknown> | null) ?? {}), after: String((n += 1)) } : next)
    const keys = burst(w, postKey, 25)
    w.fake.pagingOverride = endless
    for (let round = 0; round < 3; round += 1) {
      const before = w.fake.calls('comments').length
      await tick(w, 10_000)
      const used = w.fake.calls('comments').length - before
      expect(used).toBeGreaterThan(0)
      expect(used).toBeLessThanOrEqual(3 * (Math.ceil(1_000 / 20) + 10))
    }
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    let notices = await noticesOf(w, seller, b)
    expect(notices.items.filter((item) => item.kind === 'STUCK').map((item) => item.message)).toEqual([STUCK])
    expect(notices.unseen).toBe(1)
    expect(w.logs.filter((log) => log.code === 'BAND_STUCK')).toHaveLength(1)
    // 회복: 다음 차례에 25개 모두, 작성 시각 순서
    w.fake.pagingOverride = null
    await tick(w, 10_000)
    expect(await recordedKeys(w, seller.sellerId)).toEqual(keys)
    expect(stuckCount(await noticesOf(w, seller, b))).toBe(1)
    // 닿은 읽기가 있은 뒤 다시 막히면 그것은 새 막다른 경우 — 알림 하나 더
    burst(w, postKey, 25)
    w.fake.pagingOverride = endless
    await tick(w, 10_000)
    await tick(w, 10_000)
    notices = await noticesOf(w, seller, b)
    expect(stuckCount(notices)).toBe(2)
    expect(notices.unseen).toBe(2)
    w.fake.pagingOverride = null
  }, 120_000)
})

describe('TD-BND1 회차 끝 — 진행 중인 읽기 (AC-BND1-23, RA-BND1-04)', () => {
  it('빠른 읽기가 밴드 답을 기다리는 동안 회차를 끝내면: 늦게 온 답의 댓글은 기록하지 않고, 연결은 FINISHED, 그 뒤 여러 차례에도 밴드 요청 0', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w, 0)
    guestComment(w, postKey, '1번')
    w.fake.delay('comments', 400)
    const before = w.fake.calls('comments').length
    w.bclock.fire(10_000)
    for (let i = 0; i < 200 && w.fake.calls('comments').length === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(w.fake.calls('comments').length).toBe(before + 1)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    await w.server.band.idle()
    w.fake.delay('comments', 0)
    const after = w.fake.calls('comments').length
    guestComment(w, postKey, '2번')
    for (let i = 0; i < 5; i += 1) await tick(w, BAND_TIMING.fullMs)
    expect(await chats(w, seller.sellerId)).toHaveLength(0)
    expect(w.fake.calls('comments').length).toBe(after)
    expect((await bandView(w, seller, b)).state).toBe('FINISHED')
    expect(w.bclock.pendingTimers).toBe(0)
  }, 60_000)
})
