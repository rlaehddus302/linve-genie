// 밴드 읽기 겹침·잠금·멈추지 않는 다시 시도 (BND1 수정 라운드: TD-BND1-001~003, RA-BND1-01·02) — 가짜 밴드 서버·주입한 시계.
// - 잇기의 글 상세·기준선 읽기는 판매자 공통 잠금을 쥐지 않는다 (그동안 같은 판매자의 끊기·연결 끊기·인스타그램 기록이 막히지 않는다)
// - 같은 요청 번호가 겹쳐 오면 밴드에 한 번만 묻는다
// - 전체 읽기에는 쪽 수 상한이 있다 (빈 쪽 + 늘 새 after)
// - 끊기는 진행 중인 읽기를 닫고, 다음 잇기의 읽기는 그것이 끝난 뒤에
// - DB가 잠깐 안 돼도 다음 읽기는 남는다
// - 같은 고친 글이 다시 보여도 다시 알리지 않는다
import { afterEach, describe, expect, it } from 'vitest'
import { BAND_TIMING } from '../src/band/service.ts'
import { client, rid } from './support.ts'
import { bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, tick, unlinkBand, type BandWorld } from './band-support.ts'

let w: BandWorld | null = null
afterEach(async () => {
  w?.fake.releaseHanging()
  await w?.close()
  w = null
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

async function opened(w: BandWorld) {
  const shop = await bandSeller(w)
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey, content: '공구 글' })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`기다림이 끝나지 않음: ${label}`)
}

describe('RA-BND1-01 잇기는 밴드에 묻는 동안 판매자 잠금을 쥐지 않는다', () => {
  it('기준선 읽기가 밴드에서 멈춘 동안에도 같은 판매자의 밴드 연결 끊기(판매자 잠금)가 바로 끝나고, 잇기는 다시 확인에서 이어지지 않는다', async () => {
    const w = await world()
    const shop = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    const b = await realBroadcast(w, shop.seller)
    w.fake.fail('comments', 'HANG')
    const pending = linkBand(w, shop.seller, b, shop.bandKey, postKey)
    await until(() => w.fake.calls('comments').length === 1, '기준선 요청')
    const started = Date.now()
    const disconnected = await client(w, shop.seller.cookie).post('/api/band/disconnect', { requestId: rid('d') })
    expect(disconnected.status, disconnected.text).toBe(200)
    // 잇기의 밴드 요청(최대 10초)을 기다리지 않았다
    expect(Date.now() - started).toBeLessThan(5_000)
    w.fake.releaseHanging()
    const linked = await pending
    expect(linked.status).not.toBe(200)
    expect((await bandView(w, shop.seller, b)).state).toBe('NONE')
  }, 30_000)

  it('같은 요청 번호로 잇기가 겹쳐 오면 밴드에는 글 상세·기준선을 한 번씩만 묻고 두 응답은 같다', async () => {
    const w = await world()
    const shop = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    guestComment(w, postKey, '예전 댓글')
    const b = await realBroadcast(w, shop.seller)
    w.fake.delay('comments', 200)
    const requestId = rid('same')
    const [r1, r2] = await Promise.all([linkBand(w, shop.seller, b, shop.bandKey, postKey, requestId), linkBand(w, shop.seller, b, shop.bandKey, postKey, requestId)])
    w.fake.delay('comments', 0)
    expect(r1.status, r1.text).toBe(200)
    expect(r2.body).toEqual(r1.body)
    expect(w.fake.calls('post')).toHaveLength(1)
    expect(w.fake.calls('comments')).toHaveLength(1)
  })
})

describe('TD-BND1-002 전체 읽기의 쪽 수 상한', () => {
  it('빈 쪽에 늘 새 after가 와도 기준선 읽기는 상한 쪽 수에서 끝나고 잇기는 "다시 시도" 거절 — 연결은 생기지 않는다', async () => {
    const w = await world()
    const shop = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    const b = await realBroadcast(w, shop.seller)
    let n = 0
    w.fake.pagingOverride = (op, next) => (op === 'comments' ? { ...(next ?? {}), after: `x${String((n += 1))}` } : next)
    const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
    w.fake.pagingOverride = null
    expect(linked.status).toBe(503)
    expect((linked.body.error as { code: string }).code).toBe('UNAVAILABLE')
    // 쪽이 모두 비었으면 20개 쪽으로 본다: ⌈1000 ÷ 20⌉ + 10 = 60쪽
    expect(w.fake.calls('comments')).toHaveLength(Math.ceil(BAND_TIMING.fullMax / 20) + BAND_TIMING.fullSparePages)
    expect(w.logs.some((log) => log.code === 'BAND_PAGING_LIMIT')).toBe(true)
    expect((await bandView(w, shop.seller, b)).state).toBe('NONE')
  })

  it('쪽 크기가 작아도(1개) 1,000개 안의 글은 끝까지 읽는다 — 상한은 본 쪽 크기를 따른다', async () => {
    const w = await world()
    const shop = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    for (let i = 0; i < 120; i += 1) guestComment(w, postKey, `예전 ${String(i)}`, { createdAt: w.bclock.now() - 200_000 + i })
    w.fake.pageSize = 1
    const b = await realBroadcast(w, shop.seller)
    const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
    expect(linked.status, linked.text).toBe(200)
    expect((await bandView(w, shop.seller, b)).baseline).toBe(120)
  })

  it('이은 뒤 끝나지 않는 쪽 넘기기: 빠른·전체 읽기 모두 쪽 수 상한에서 끝나고(한 읽기 ≤ 60쪽) 막다른 경우 알림 한 번, 풀리면 이어 읽는다 (D-BND1-16)', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    let n = 0
    w.fake.pagingOverride = (op, next) => (op === 'comments' ? { ...(next ?? {}), after: `y${String((n += 1))}` } : next)
    const limit = Math.ceil(BAND_TIMING.fullMax / 20) + BAND_TIMING.fullSparePages
    for (let round = 0; round < 3; round += 1) {
      const before = w.fake.calls('comments').length
      if (round === 0) await tick(w, 10_000)
      else {
        // 막다른 경우 알림이 난 뒤에는 닿을 때까지 60초 간격 — 59초 동안 요청 0 (D-BND1-23 (가))
        await tick(w, 59_000)
        expect(w.fake.calls('comments').length).toBe(before)
        await tick(w, 1_000)
      }
      const sorts = w.fake.calls('comments').slice(before).map((call) => call.query['sort'])
      // 첫 차례: 빠른(닿지 못함) → 같은 차례 전체(끝까지 되지 않음) → 빠른 한 번 더(닿지 못함). 60초 뒤 차례는 전체 읽기 차례라 전체 → 빠른. 읽기마다 상한 쪽 수
      const fast = Array<string>(limit).fill('-created_at')
      const full = Array<string>(limit).fill('+created_at')
      expect(sorts).toEqual(round === 0 ? [...fast, ...full, ...fast] : [...full, ...fast])
    }
    const stuck = (await bandView(w, seller, b)).notices as { total: number; items: { kind: string }[] }
    expect(stuck.items.map((item) => item.kind)).toEqual(['STUCK'])
    w.fake.pagingOverride = null
    guestComment(w, postKey, '1번')
    await tick(w, 60_000)
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toContain('1번')
    expect((await bandView(w, seller, b)).state).toBe('READING')
    // 막다른 알림은 그대로 하나, 60초 간격으로 4분 넘게 닿지 못했으니 늦게 읽음 알림이 하나 더 (AC-BND1-54 — 그 사이 달린 1개)
    const after4 = (await bandView(w, seller, b)).notices as { total: number; items: { kind: string; message: string }[] }
    expect(after4.items.map((item) => item.kind)).toEqual(['LATE', 'STUCK'])
    expect(after4.items[0]?.message).toBe('밴드 댓글을 4분 동안 읽지 못했어요. 그 사이 달린 댓글 1개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.')
    // 닿는 읽기가 성공했으니 다음 차례는 다시 10초 뒤
    const after = w.fake.calls('comments').length
    await tick(w, 10_000)
    expect(w.fake.calls('comments').length).toBe(after + 1)
  })
})

describe('TD-BND1-003 끊기·다시 잇기는 진행 중인 읽기와 겹치지 않는다', () => {
  it('늦어진 빠른 읽기 중에 끊으면 그 요청을 닫고, 다른 회차 잇기의 요청은 그 뒤에 — 토큰의 동시 요청은 1', async () => {
    const w = await world()
    const { seller, userKey, bandKey, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번')
    w.fake.fail('comments', 'HANG')
    const before = w.fake.calls('comments').length
    w.bclock.fire(10_000)
    await until(() => w.fake.calls('comments').length === before + 1, '늦은 빠른 읽기')
    const started = Date.now()
    expect((await unlinkBand(w, seller, b)).status).toBe(200)
    const other = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b2 = await realBroadcast(w, seller)
    const linked = await linkBand(w, seller, b2, bandKey, other)
    expect(linked.status, linked.text).toBe(200)
    // 닫았으니 10초 시간 제한을 기다리지 않았다
    expect(Date.now() - started).toBeLessThan(5_000)
    await w.server.band.idle()
    for (const token of new Set(w.fake.callsOfUser(userKey).map((call) => call.token))) expect(w.fake.maxInflight.get(token as string) ?? 0).toBeLessThanOrEqual(1)
    // 끊은 회차에는 아무것도 기록되지 않았다
    expect(await chats(w, seller.sellerId)).toEqual([])
  }, 30_000)
})

describe('RA-BND1-02 DB가 잠깐 안 돼도 다음 읽기는 남는다', () => {
  it('기록 저장 실패 뒤 상태 읽기·쓰기가 두 번 던져도 다시 시도가 걸리고, DB가 돌아오면 댓글을 넣는다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const db = w.database.db as unknown as { transaction: (...args: unknown[]) => unknown; select: (...args: unknown[]) => unknown }
    const transaction = db.transaction.bind(db)
    const select = db.select.bind(db)
    let failTx = 1
    let failSelect = 0
    db.transaction = (...args: unknown[]) => {
      if (failTx > 0) {
        failTx -= 1
        // 기록 트랜잭션이 실패한 바로 뒤 DB 읽기 두 번도 실패
        failSelect = 2
        return Promise.reject(new Error('DB 끊김 주입'))
      }
      return transaction(...args)
    }
    db.select = (...args: unknown[]) => {
      if (failSelect > 0) {
        failSelect -= 1
        throw new Error('DB 끊김 주입')
      }
      return select(...args)
    }
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    expect(failTx).toBe(0)
    expect(w.logs.map((log) => log.code)).toContain('BAND_RETRY_STATE_FAILED')
    expect(w.server.band.readers).toBe(1)
    // 다시 시도 시간표(10·20·40초) 안에 다시 읽어 넣는다
    for (let i = 0; i < 8 && (await chats(w, seller.sellerId)).length === 0; i += 1) await tick(w, 10_000)
    expect(failSelect).toBe(0)
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toEqual(['1번'])
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING', received: 1 })
    // 그 뒤에도 계속 읽는다
    guestComment(w, postKey, '2번')
    await tick(w, 10_000)
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toEqual(['1번', '2번'])
  })
})

describe('TD-BND1-001 고친 글은 새 본문마다 한 번 (AC-BND1-40)', () => {
  it('A→B→C→B→C로 고쳐도 알림은 B·C 둘', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const key = guestComment(w, postKey, '1번', { name: '김다육' })
    await tick(w, 10_000)
    for (const text of ['2번', '3번', '2번', '3번', '1번']) {
      w.fake.editComment(postKey, key, text)
      await tick(w, BAND_TIMING.fullMs)
    }
    const notices = (await bandView(w, seller, b)).notices as { items: { kind: string; message: string }[] }
    expect(notices.items.filter((item) => item.kind === 'EDITED').map((item) => item.message)).toEqual([
      "밴드에서 고친 댓글이에요 — 김다육: '1번' → '3번'. 찜은 처음 글대로예요.",
      "밴드에서 고친 댓글이에요 — 김다육: '1번' → '2번'. 찜은 처음 글대로예요.",
    ])
  })
})
