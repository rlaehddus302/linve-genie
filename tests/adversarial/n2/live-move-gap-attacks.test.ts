// N2 적대 테스트 (test-domain): 옮기기(AC-N2-25)의 60분 간격 규칙과 LIVE_NOT_MOVED (D-N2-17, 수정 라운드 3).
// - (사) 받은 시각 − 마지막 활동 시각 ≤ 3,600,000ms면 옮기고, 넘으면 1ms라도 옮기지 않는다. 마지막 활동 = max(b에 기록한 마지막 인스타 댓글을 받은 시각
//   (지금 옮기며 기록하려는 댓글은 뺀다), 이은 시각·마지막으로 옮긴 시각). 서버 시계만 — entry.time·방송 날짜는 보지 않는다.
// - (바) b 말고 끝나지 않은 실제 회차(리허설 빼고, 날짜 상관없이)가 있으면 옮기지 않는다.
// - (바)·(사)로만 막히면 UNLINKED_COMMENTS 대신 LIVE_NOT_MOVED(reason OTHER_BROADCAST·GAP, 둘 다면 GAP). 그 밖의 조건이 틀리면 그대로 UNLINKED_COMMENTS.
// 서버를 프로세스 안에서 PGlite로 띄우고 가짜 메타 서버(127.0.0.1, 실제 HTTP)·주입한 시계를 쓴다. 네트워크 가드(AC-N2-62).
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { chatEvents, connectedShop, igWorld, linkLive, liveBroadcast, register, sendComments, webhookTarget, type IgWorld, type Shop } from '../../../apps/server/test/instagram-support.ts'
import { addSeller, client, createBroadcast, rid, type Seller } from '../../../apps/server/test/support.ts'

installNetworkGuard()

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})
async function world(): Promise<IgWorld> {
  ig = await igWorld()
  return ig
}

/** 60분 (AC-N2-25 (사)) */
const HOUR = 3_600_000
/** 2026-10-<day> h:m:s.ms KST */
const kst = (day: number, h: number, m: number, s = 0, ms = 0) => Date.UTC(2026, 9, day, h - 9, m, s, ms)
const iso = (ms: number) => new Date(ms).toISOString()

const GAP_MESSAGE = '새 인스타그램 라이브 댓글이 오고 있는데, 방송의 마지막 댓글과 1시간 넘게 떨어져 같은 방송인지 몰라 기록하지 않고 있어요. 이어 갈 방송을 새 라이브에 이어 주세요.'
const OTHER_MESSAGE =
  '새 인스타그램 라이브 댓글이 오고 있는데, 끝나지 않은 방송이 여럿이라 어느 방송에 이을지 몰라 기록하지 않고 있어요. 쓰지 않는 방송은 끝내고, 이어 갈 방송을 새 라이브에 이어 주세요.'

let counter = 0
/** 시험마다 겹치지 않는 댓글 ID (숫자) */
const nextId = () => `1795${String(++counter).padStart(11, '0')}`

interface Moved {
  readonly fromLiveId: string
  readonly movedAt: string
  readonly comments: number
  readonly message: string
}

interface LinkBody {
  readonly state: string
  readonly liveId: string | null
  readonly linkedAt: string | null
  readonly actor: { readonly kind: string } | null
  readonly moved?: Moved | null
}

async function linkOf(w: IgWorld, seller: Seller, b: string): Promise<LinkBody> {
  const response = await client(w, seller.cookie).get(`/api/broadcasts/${b}/live`)
  expect(response.status, response.text).toBe(200)
  return response.body.link as LinkBody
}

async function wait(w: IgWorld, seller: Seller, b: string): Promise<void> {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })
  expect(response.status, response.text).toBe(200)
}

async function end(w: IgWorld, seller: Seller, b: string): Promise<void> {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
  expect(response.status, response.text).toBe(200)
}

async function unlinkedOf(w: IgWorld, seller: Seller): Promise<Record<string, number>> {
  const lives = (await client(w, seller.cookie).get('/api/instagram/unlinked')).body.lives as { liveId: string; count: number }[]
  return Object.fromEntries(lives.map((live) => [live.liveId, live.count]))
}

/** 그 뒤에 보낸 알림 문장 알림 (kind NOTICE) */
function noticesSince(w: IgWorld, from: number): Record<string, unknown>[] {
  return w.published
    .slice(from)
    .map((item) => item.data)
    .filter((data) => data.kind === 'NOTICE')
}

async function chatIdsOf(w: IgWorld, seller: Seller, b: string): Promise<string[]> {
  return (await chatEvents(w, seller.sellerId)).filter((event) => event.b === b).map((event) => event.id as string)
}

async function winners(w: IgWorld, seller: Seller, date: string, key: string): Promise<string[]> {
  const view = (await client(w, seller.cookie).get(`/api/days/${date}`)).body as { products: { key: string; winners: string[] }[] }
  return view.products.find((product) => product.key === key)?.winners ?? []
}

/** at에 그 라이브의 댓글 하나를 보낸다 (entry.time 기본 = 받은 시각). 기록되면 쓰일 메시지 ID(ig:…)를 돌려준다 */
async function commentAt(w: IgWorld, shop: Shop, live: string, at: number, text = '안녕하세요', options: { readonly time?: number; readonly igsid?: string } = {}): Promise<string> {
  w.clock.set(at)
  const id = nextId()
  const sent = await sendComments(
    w,
    shop.account,
    live,
    [
      {
        id,
        igsid: options.igsid ?? `60244${id.slice(-11)}`,
        username: 'viewer.one',
        text,
      },
    ],
    options.time === undefined ? {} : { time: options.time },
  )
  expect(sent.status).toBe(200)
  return `ig:${id}`
}

/** 판매자 하나·회차 b(2026-10-19)를 기다리기로 두고 at에 라이브 M의 첫 댓글로 저절로 잇는다 (조치자 서버) */
async function autoLinkedAt(w: IgWorld, at: number): Promise<Shop & { readonly b: string; readonly m: string; readonly first: string }> {
  w.clock.set(at - 60_000)
  const shop = await connectedShop(w)
  const b = await liveBroadcast(w, shop.seller)
  await wait(w, shop.seller, b)
  const m = w.fake.startLive(shop.account.id)
  const first = await commentAt(w, shop, m, at)
  expect(await linkOf(w, shop.seller, b)).toMatchObject({
    state: 'LINKED',
    liveId: m,
    actor: { kind: 'server' },
    linkedAt: iso(at),
  })
  return { ...shop, b, m, first }
}

/** 옮겨졌는지: b가 M2에 이어지고(이은 시각 = 받은 시각) 그 댓글이 b에 기록, LIVE_MOVED 하나, LIVE_NOT_MOVED·UNLINKED_COMMENTS 없음 */
async function expectMoved(w: IgWorld, seller: Seller, b: string, to: string, at: number, id: string, from: number): Promise<void> {
  expect(await linkOf(w, seller, b)).toMatchObject({
    state: 'LINKED',
    liveId: to,
    linkedAt: iso(at),
    actor: { kind: 'server' },
  })
  expect(await chatIdsOf(w, seller, b)).toContain(id)
  const notices = noticesSince(w, from)
  expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toHaveLength(1)
  expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
}

/** (바)·(사)로 막혔는지: b는 옛 라이브에 그대로, 그 댓글은 기록하지 않고 이어지지 않은 수(M2)를 세며 LIVE_NOT_MOVED(reason)만 */
async function expectNotMoved(
  w: IgWorld,
  seller: Seller,
  b: string,
  stay: string,
  to: string,
  id: string,
  from: number,
  expected: {
    readonly reason: 'GAP' | 'OTHER_BROADCAST'
    readonly count: number
  },
): Promise<void> {
  expect(await linkOf(w, seller, b)).toMatchObject({
    state: 'LINKED',
    liveId: stay,
  })
  expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(id)
  expect((await unlinkedOf(w, seller))[to]).toBe(expected.count)
  const notices = noticesSince(w, from)
  expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
  expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([
    expect.objectContaining({
      code: 'LIVE_NOT_MOVED',
      reason: expected.reason,
      broadcast: b,
      liveId: to,
      count: expected.count,
      message: expected.reason === 'GAP' ? GAP_MESSAGE : OTHER_MESSAGE,
    }),
  ])
}

describe('D-N2-17 60분 간격 — 경계 (마지막 댓글을 받은 시각에서)', () => {
  // 마지막 댓글은 20:00:00.250 — 초 단위로 자르거나 반올림하면 +1ms가 0으로 보인다
  const last = kst(19, 20, 0, 0, 250)
  it.each([
    { label: '60분 − 1ms', offset: -1, moves: true },
    { label: '60분 정각', offset: 0, moves: true },
    { label: '60분 + 1ms', offset: 1, moves: false },
  ])('마지막 댓글 20:00:00.250(KST) → 새 라이브 M2의 늦지 않은 댓글을 $label 뒤에 받음: 옮김 = $moves', async ({ offset, moves }) => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, last, '예뻐요')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = last + HOUR + offset
    const id = await commentAt(w, shop, m2, at, '15')
    if (moves) await expectMoved(w, seller, b, m2, at, id, from)
    else
      await expectNotMoved(w, seller, b, m, m2, id, from, {
        reason: 'GAP',
        count: 1,
      })
  })
})

describe('D-N2-17 자정을 넘긴 방송 — 스펙의 예(23:30:00 → 00:30:00 옮김, 00:30:01 안 옮김)', () => {
  it.each([
    { label: '00:30:00', at: kst(20, 0, 30, 0), moves: true },
    { label: '00:30:01', at: kst(20, 0, 30, 1), moves: false },
  ])(
    '10-19 회차 b의 마지막 댓글 23:30:00(KST), 다시 켠 라이브 M2의 "15"를 다음 날 $label에 받음: 옮김 = $moves — 옮기면 그 댓글은 b의 날짜(2026-10-19) 범위에 기록돼 15번 1등',
    async ({ at, moves }) => {
      const w = await world()
      const shop = await autoLinkedAt(w, kst(19, 23, 0))
      const { seller, b, m } = shop
      await register(w, seller, b, 15, '핑크프릴', 10000)
      await commentAt(w, shop, m, kst(19, 23, 30), '예뻐요')
      w.clock.set(kst(20, 0, 5))
      w.fake.endLive(m)
      const m2 = w.fake.startLive(shop.account.id)
      const from = w.published.length
      const id = await commentAt(w, shop, m2, at, '15', {
        igsid: '6024400000000001',
      })
      if (moves) {
        await expectMoved(w, seller, b, m2, at, id, from)
        expect(await winners(w, seller, '2026-10-19', `${b}/15`)).toEqual(['ig:6024400000000001'])
      } else {
        await expectNotMoved(w, seller, b, m, m2, id, from, {
          reason: 'GAP',
          count: 1,
        })
        expect(await winners(w, seller, '2026-10-19', `${b}/15`)).toEqual([])
      }
    },
  )
})

describe('D-N2-17 마지막 활동 시각 — 무엇을 기준으로 재는가', () => {
  it('서버 시계만 쓴다: 마지막 댓글 20:00:00에서 60분 + 1ms 뒤에 받은 M2 댓글은 entry.time이 30초 일러(늦지 않음, 59분 30초 간격처럼 보여도) 옮기지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const id = await commentAt(w, shop, m2, kst(19, 21, 0, 0, 1), '15', {
      time: Math.floor(kst(19, 20, 59, 30) / 1000),
    })
    await expectNotMoved(w, seller, b, m, m2, id, from, {
      reason: 'GAP',
      count: 1,
    })
  })

  it('막혀 기록하지 않은 M2 댓글은 마지막 활동을 늘리지 않는다 — 21:00:01·21:00:30·21:01:01 모두 GAP(알림은 처음과 1분 뒤 두 번), 기다리면 저절로 옮겨지지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const ids = [await commentAt(w, shop, m2, kst(19, 21, 0, 1), '15'), await commentAt(w, shop, m2, kst(19, 21, 0, 30), '15'), await commentAt(w, shop, m2, kst(19, 21, 1, 1), '16')]
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, expect.stringMatching(/^ig:/)])
    for (const id of ids) expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(id)
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 3 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'UNLINKED_COMMENTS' || data.code === 'LIVE_MOVED')).toEqual([])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED').map((data) => [data.reason, data.count])).toEqual([
      ['GAP', 1],
      ['GAP', 3],
    ])
  })

  it('회차의 다른 활동(상품 등록)은 마지막 활동이 아니다 — 마지막 인스타 댓글 20:00:00, 20:59에 상품을 올려도 21:00:01의 M2 댓글은 옮기지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.clock.set(kst(19, 20, 59))
    await register(w, seller, b, 15, '핑크프릴', 10000)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const id = await commentAt(w, shop, m2, kst(19, 21, 0, 1), '15')
    await expectNotMoved(w, seller, b, m, m2, id, from, {
      reason: 'GAP',
      count: 1,
    })
    expect(await winners(w, seller, '2026-10-19', `${b}/15`)).toEqual([])
  })

  it.each([
    { label: '정각', offset: 0, moves: true },
    { label: '+1ms', offset: 1, moves: false },
  ])(
    '기록한 댓글이 없으면 이은 시각이 기준 — 19:00에 기다리기, 20:00:00.500에 저절로 이었는데 첫 댓글 저장이 실패(500, 메타가 아직 다시 보내지 않음) → M2 댓글 21:00:00.500 $label: 옮김 = $moves (기다리기로 정한 시각 19:00이 기준이 아니다)',
    async ({ offset, moves }) => {
      const w = await world()
      w.clock.set(kst(19, 19, 0))
      const shop = await connectedShop(w)
      const { seller } = shop
      const b = await liveBroadcast(w, seller)
      await wait(w, seller, b)
      const m = w.fake.startLive(shop.account.id)
      // 저장 실패를 흉내 낸다: 그 댓글의 events 기록만 데이터베이스가 거절한다
      const failing = nextId()
      const pg = w.database.pglite
      expect(pg).toBeDefined()
      await pg?.exec(`create function lj_test_fail_insert() returns trigger language plpgsql as $$ begin if new.chat_message_id = 'ig:${failing}' then raise exception 'injected'; end if; return new; end $$;
      create trigger lj_test_fail before insert on events for each row execute function lj_test_fail_insert();`)
      const linkedAt = kst(19, 20, 0, 0, 500)
      w.clock.set(linkedAt)
      const failed = await sendComments(w, shop.account, m, [
        {
          id: failing,
          igsid: '6024400000000009',
          username: 'hello.viewer',
          text: '안녕하세요',
        },
      ])
      expect(failed.status).toBe(500)
      await pg?.exec('drop trigger lj_test_fail on events; drop function lj_test_fail_insert();')
      expect(await linkOf(w, seller, b)).toMatchObject({
        state: 'LINKED',
        liveId: m,
        linkedAt: iso(linkedAt),
        actor: { kind: 'server' },
      })
      expect(await chatIdsOf(w, seller, b)).toEqual([])
      w.fake.endLive(m)
      const m2 = w.fake.startLive(shop.account.id)
      const from = w.published.length
      const at = linkedAt + HOUR + offset
      const id = await commentAt(w, shop, m2, at, '15')
      if (moves) await expectMoved(w, seller, b, m2, at, id, from)
      else
        await expectNotMoved(w, seller, b, m, m2, id, from, {
          reason: 'GAP',
          count: 1,
        })
    },
  )

  it.each([
    { label: '정각', offset: 0, moves: true },
    { label: '+1ms', offset: 1, moves: false },
  ])(
    "⑨' 옮긴 시각이 기준 — 19:10에 저절로 이음, M 마지막 댓글 19:20 → 20:00:00.250에 M → M2로 옮김(그 뒤 M2 댓글 없음) → M3 댓글 21:00:00.250 $label: 옮김 = $moves (처음 이은 시각·옮기기 전 댓글이 기준이 아니다)",
    async ({ offset, moves }) => {
      const w = await world()
      const shop = await autoLinkedAt(w, kst(19, 19, 10))
      const { seller, b, m } = shop
      const before = await commentAt(w, shop, m, kst(19, 19, 20), '예뻐요')
      w.fake.endLive(m)
      const m2 = w.fake.startLive(shop.account.id)
      const movedAt = kst(19, 20, 0, 0, 250)
      const moveId = await commentAt(w, shop, m2, movedAt, '15')
      expect(await linkOf(w, seller, b)).toMatchObject({
        liveId: m2,
        linkedAt: iso(movedAt),
      })
      expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, before, moveId])
      w.fake.endLive(m2)
      const m3 = w.fake.startLive(shop.account.id)
      const from = w.published.length
      const at = movedAt + HOUR + offset
      const id = await commentAt(w, shop, m3, at, '16')
      if (moves) await expectMoved(w, seller, b, m3, at, id, from)
      else
        await expectNotMoved(w, seller, b, m2, m3, id, from, {
          reason: 'GAP',
          count: 1,
        })
    },
  )

  it.each([
    { label: '정각', offset: 0, moves: true },
    { label: '+1ms', offset: 1, moves: false },
  ])(
    '옮긴 뒤 새 라이브에서 받은 댓글이 기준 — 20:00에 M → M2로 옮김, M2 마지막 댓글 20:40:00.250 → M3 댓글 21:40:00.250 $label: 옮김 = $moves (옮긴 시각 20:00이 기준이 아니다)',
    async ({ offset, moves }) => {
      const w = await world()
      const shop = await autoLinkedAt(w, kst(19, 19, 10))
      const { seller, b, m } = shop
      w.fake.endLive(m)
      const m2 = w.fake.startLive(shop.account.id)
      await commentAt(w, shop, m2, kst(19, 20, 0), '15')
      const last = kst(19, 20, 40, 0, 250)
      await commentAt(w, shop, m2, last, '16')
      w.fake.endLive(m2)
      const m3 = w.fake.startLive(shop.account.id)
      const from = w.published.length
      const at = last + HOUR + offset
      const id = await commentAt(w, shop, m3, at, '17')
      if (moves) await expectMoved(w, seller, b, m3, at, id, from)
      else
        await expectNotMoved(w, seller, b, m2, m3, id, from, {
          reason: 'GAP',
          count: 1,
        })
    },
  )
})

describe('D-N2-17 지금 댓글을 빼고 잰다 — 한 웹훅의 여러 댓글·재배달·동시 배달', () => {
  async function prepared(w: IgWorld) {
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    await commentAt(w, shop, shop.m, kst(19, 20, 0), '예뻐요')
    w.fake.endLive(shop.m)
    const m2 = w.fake.startLive(shop.account.id)
    return { ...shop, m2 }
  }

  it('한 웹훅에 M2 댓글 둘, 60분 정각: 첫 댓글이 옮기고 둘째도 b에 기록 — 옮기기 한 번, LIVE_MOVED 한 번. 옮긴 댓글을 61분에 다시 배달하면 아무 일도 없다', async () => {
    const w = await world()
    const { seller, account, b, m2 } = await prepared(w)
    const from = w.published.length
    const at = kst(19, 21, 0)
    w.clock.set(at)
    const [one, two] = [nextId(), nextId()]
    const sent = await sendComments(w, account, m2, [
      { id: one, igsid: '6024400000000101', username: 'a.viewer', text: '15' },
      { id: two, igsid: '6024400000000102', username: 'b.viewer', text: '16' },
    ])
    expect(sent.status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({
      liveId: m2,
      linkedAt: iso(at),
    })
    expect((await chatIdsOf(w, seller, b)).slice(-2)).toEqual([`ig:${one}`, `ig:${two}`])
    expect(noticesSince(w, from).filter((data) => data.code === 'LIVE_MOVED')).toHaveLength(1)
    // 메타가 옮긴 댓글을 1분 뒤 다시 보낸다 — 이미 기록한 댓글이라 세지도 알리지도 않는다
    w.clock.set(at + 61_000)
    const again = w.published.length
    expect((await w.fake.deliver(webhookTarget(w), w.fake.payload([{ accountId: account.id, changes: sent.changes }]))).status).toBe(200)
    expect(await unlinkedOf(w, seller)).toEqual({})
    expect(noticesSince(w, again)).toEqual([])
    expect((await chatEvents(w, seller.sellerId)).filter((event) => event.id === `ig:${one}`)).toHaveLength(1)
  })

  it('한 웹훅에 M2 댓글 둘, 60분 + 1ms: 둘 다 기록하지 않는다(첫 댓글이 마지막 활동이 되지 않는다) — 수 2, LIVE_NOT_MOVED(GAP) 한 번. 막힌 댓글을 다시 배달해도 옮기지 않는다', async () => {
    const w = await world()
    const { seller, account, b, m, m2 } = await prepared(w)
    const from = w.published.length
    const at = kst(19, 21, 0, 0, 1)
    w.clock.set(at)
    const [one, two] = [nextId(), nextId()]
    const sent = await sendComments(w, account, m2, [
      { id: one, igsid: '6024400000000101', username: 'a.viewer', text: '15' },
      { id: two, igsid: '6024400000000102', username: 'b.viewer', text: '16' },
    ])
    expect(sent.status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    const ids = (await chatEvents(w, seller.sellerId)).map((event) => event.id)
    expect(ids).not.toContain(`ig:${one}`)
    expect(ids).not.toContain(`ig:${two}`)
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 2 })
    expect(noticesSince(w, from).filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([
      expect.objectContaining({
        reason: 'GAP',
        broadcast: b,
        liveId: m2,
        count: 1,
      }),
    ])
    // 같은 댓글이 다시 배달된다 (entry.time은 받은 시각 — 늦지 않음)
    w.clock.set(at + 10_000)
    expect((await w.fake.deliver(webhookTarget(w), w.fake.payload([{ accountId: account.id, changes: sent.changes.slice(0, 1) }]))).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(`ig:${one}`)
  })

  it.each([
    { label: '정각', offset: 0, moves: true },
    { label: '+1ms', offset: 1, moves: false },
  ])('동시에 온 두 웹훅(M2 댓글 하나씩), 60분 $label: 옮기기는 많아야 한 번이고 두 댓글은 같은 쪽(둘 다 기록 / 둘 다 기록하지 않음)', async ({ offset, moves }) => {
    const w = await world()
    const { seller, account, b, m, m2 } = await prepared(w)
    const from = w.published.length
    const at = kst(19, 21, 0) + offset
    w.clock.set(at)
    const [one, two] = [nextId(), nextId()]
    const results = await Promise.all([
      sendComments(w, account, m2, [
        {
          id: one,
          igsid: '6024400000000101',
          username: 'a.viewer',
          text: '15',
        },
      ]),
      sendComments(w, account, m2, [
        {
          id: two,
          igsid: '6024400000000102',
          username: 'b.viewer',
          text: '16',
        },
      ]),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    const ids = await chatIdsOf(w, seller, b)
    const notices = noticesSince(w, from)
    if (moves) {
      expect(await linkOf(w, seller, b)).toMatchObject({
        liveId: m2,
        linkedAt: iso(at),
      })
      expect(ids).toEqual(expect.arrayContaining([`ig:${one}`, `ig:${two}`]))
      expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toHaveLength(1)
      expect(await unlinkedOf(w, seller)).toEqual({})
    } else {
      expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
      expect(ids).not.toContain(`ig:${one}`)
      expect(ids).not.toContain(`ig:${two}`)
      expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
      expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 2 })
    }
  })
})

describe('D-N2-17 실제 방송 흐름', () => {
  it('1부·2부를 한 회차로 하며 그 사이 65분 쉼: 2부 라이브 M2의 첫 댓글은 옮기지 않고 LIVE_NOT_MOVED(GAP). 판매자가 끊고 M2에 이으면(LIVE_TAKEN 아님) 그 뒤 댓글부터 기록, 다시 켠 M3는 손으로 이은 연결이라 UNLINKED_COMMENTS', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    const api = client(w, seller.cookie)
    await register(w, seller, b, 15, '2부 핑크프릴', 10000)
    await commentAt(w, shop, m, kst(19, 20, 50), '1부 끝 수고하셨어요')
    w.clock.set(kst(19, 20, 55))
    w.fake.endLive(m)
    // 65분 쉬고 2부 라이브를 켠다
    const m2 = w.fake.startLive(shop.account.id)
    let from = w.published.length
    const blocked = await commentAt(w, shop, m2, kst(19, 21, 55), '15', {
      igsid: '6024400000000001',
    })
    await expectNotMoved(w, seller, b, m, m2, blocked, from, {
      reason: 'GAP',
      count: 1,
    })
    expect(await winners(w, seller, '2026-10-19', `${b}/15`)).toEqual([])
    // 고치는 길: 이어 갈 방송이 b — 끊고 M2에 잇는다. 끊지 않고 이으면 ALREADY_LINKED
    w.clock.set(kst(19, 21, 56))
    expect(
      (
        await api.post(`/api/broadcasts/${b}/live/link`, {
          requestId: rid('link'),
          platform: 'INSTAGRAM',
          liveId: m2,
        })
      ).body.error,
    ).toMatchObject({ code: 'ALREADY_LINKED' })
    expect(
      (
        await api.post(`/api/broadcasts/${b}/live/unlink`, {
          requestId: rid('u'),
        })
      ).status,
    ).toBe(200)
    await linkLive(w, seller, b, m2)
    expect(await linkOf(w, seller, b)).toMatchObject({
      state: 'LINKED',
      liveId: m2,
      actor: { kind: 'account' },
      moved: null,
    })
    const after = await commentAt(w, shop, m2, kst(19, 21, 57), '15', {
      igsid: '6024400000000002',
    })
    expect(await chatIdsOf(w, seller, b)).toContain(after)
    expect(await chatIdsOf(w, seller, b)).not.toContain(blocked)
    expect(await winners(w, seller, '2026-10-19', `${b}/15`)).toEqual(['ig:6024400000000002'])
    // 손으로 이은 연결은 옮기지 않는다 — 다시 켠 라이브는 UNLINKED_COMMENTS (LIVE_NOT_MOVED 아님)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(shop.account.id)
    from = w.published.length
    await commentAt(w, shop, m3, kst(19, 22, 0), '16')
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED' || data.code === 'LIVE_MOVED')).toEqual([])
    expect(notices.find((data) => data.code === 'UNLINKED_COMMENTS')).toMatchObject({ liveId: m3, count: 1 })
  })

  it('⑩ 며칠 전에 끝내지 않은 회차: 10-19 회차 b(저절로 이음) → 10-22 20:00 새 라이브 M2 댓글은 GAP. 오늘 회차 c를 만들면 (바)·(사) 둘 다라 reason GAP, c를 기다리기로 두면 다음 M2 댓글에서 c가 M2에 이어진다(b는 그대로)', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 20, 0))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 30), '예뻐요')
    // b를 끝내지 않은 채 사흘 뒤 같은 계정으로 새 라이브
    w.clock.set(kst(22, 19, 59))
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    let from = w.published.length
    const first = await commentAt(w, shop, m2, kst(22, 20, 0), '15')
    await expectNotMoved(w, seller, b, m, m2, first, from, {
      reason: 'GAP',
      count: 1,
    })
    // 오늘 회차 c를 만든다 (아직 잇지 않음) → (바)도 걸리지만 reason은 GAP
    w.clock.set(kst(22, 20, 1))
    const c = (await createBroadcast(w, seller, { date: '2026-10-22' })).id
    from = w.published.length
    const second = await commentAt(w, shop, m2, kst(22, 20, 2), '15')
    await expectNotMoved(w, seller, b, m, m2, second, from, {
      reason: 'GAP',
      count: 2,
    })
    // c를 기다리기로 두면 AC-N2-22가 먼저 — 다음 M2 댓글에서 c가 M2에 이어진다
    w.clock.set(kst(22, 20, 3))
    await wait(w, seller, c)
    const third = await commentAt(w, shop, m2, kst(22, 20, 4), '15')
    expect(await linkOf(w, seller, c)).toMatchObject({
      state: 'LINKED',
      liveId: m2,
    })
    expect(await chatIdsOf(w, seller, c)).toEqual([third])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await chatIdsOf(w, seller, b)).not.toContain(third)
  })

  it.each([
    { label: '정각', offset: 0, moves: true },
    { label: '+1ms', offset: 1, moves: false },
  ])('리허설 회차만 끝나지 않았으면 (바)가 아니다 — 60분 $label: 옮김 = $moves (막히면 reason GAP, OTHER_BROADCAST 아님)', async ({ offset, moves }) => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.clock.set(kst(19, 20, 10))
    const rehearsal = await createBroadcast(w, seller, {
      date: '2026-10-19',
      rehearsal: true,
    })
    expect(rehearsal.rehearsal).toBe(true)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = kst(19, 21, 0) + offset
    const id = await commentAt(w, shop, m2, at, '15')
    if (moves) await expectMoved(w, seller, b, m2, at, id, from)
    else
      await expectNotMoved(w, seller, b, m, m2, id, from, {
        reason: 'GAP',
        count: 1,
      })
  })

  it('⑪ (바)만이면 OTHER_BROADCAST, 같은 준비에서 60분을 넘기면 GAP — 끝내지 않은 2부 회차 c, 마지막 댓글 20:00:00 → 21:00:00은 OTHER_BROADCAST, 21:00:00.001은 GAP', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.clock.set(kst(19, 20, 30))
    await liveBroadcast(w, seller)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const one = await commentAt(w, shop, m2, kst(19, 21, 0), '15')
    await expectNotMoved(w, seller, b, m, m2, one, from, {
      reason: 'OTHER_BROADCAST',
      count: 1,
    })
    // 1분 간격 알림이라, 이유가 바뀌어도 다음 알림은 1분 뒤에 본다
    const next = w.published.length
    const two = await commentAt(w, shop, m2, kst(19, 21, 1, 0, 1), '15')
    await expectNotMoved(w, seller, b, m, m2, two, next, {
      reason: 'GAP',
      count: 2,
    })
  })

  it('(바)로 막힌 동안의 M2 댓글은 마지막 활동이 아니다 — 마지막 댓글 20:00, 2부 회차 c 때문에 20:30·20:59에 막힘 → 21:00:10에 c를 끝내도 21:00:30의 M2 댓글은 GAP', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.clock.set(kst(19, 20, 20))
    const c = await liveBroadcast(w, seller)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    let from = w.published.length
    const blocked = await commentAt(w, shop, m2, kst(19, 20, 30), '15')
    await expectNotMoved(w, seller, b, m, m2, blocked, from, {
      reason: 'OTHER_BROADCAST',
      count: 1,
    })
    await commentAt(w, shop, m2, kst(19, 20, 59, 0), '16')
    w.clock.set(kst(19, 21, 0, 10))
    await end(w, seller, c)
    from = w.published.length
    const late = await commentAt(w, shop, m2, kst(19, 21, 0, 30), '17')
    await expectNotMoved(w, seller, b, m, m2, late, from, {
      reason: 'GAP',
      count: 3,
    })
  })

  it('동시에 두 라이브의 댓글이 섞여 온다(옛 라이브 M의 늦은 배달): 한 웹훅의 [M, M2, M, M2] — b는 M2로 한 번 옮기고 M2 댓글만 이어 기록, 옮긴 뒤의 M 댓글은 UNLINKED_COMMENTS로 세기만(되돌아가지 않음, LIVE_NOT_MOVED 아님)', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 20, 0))
    const { seller, account, b, m } = shop
    const m2 = w.fake.startLive(account.id)
    const from = w.published.length
    w.clock.set(kst(19, 20, 10))
    const ids = [nextId(), nextId(), nextId(), nextId()] as const
    const mixed = [
      w.fake.comment({
        accountId: account.id,
        liveId: m,
        id: ids[0],
        igsid: '6024400000000201',
        username: 'm.one',
        text: '예뻐요',
      }),
      w.fake.comment({
        accountId: account.id,
        liveId: m2,
        id: ids[1],
        igsid: '6024400000000202',
        username: 'm2.one',
        text: '15',
      }),
      w.fake.comment({
        accountId: account.id,
        liveId: m,
        id: ids[2],
        igsid: '6024400000000203',
        username: 'm.two',
        text: '16',
      }),
      w.fake.comment({
        accountId: account.id,
        liveId: m2,
        id: ids[3],
        igsid: '6024400000000204',
        username: 'm2.two',
        text: '17',
      }),
    ]
    expect((await w.fake.deliver(webhookTarget(w), w.fake.payload([{ accountId: account.id, changes: mixed }]))).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({
      liveId: m2,
      linkedAt: iso(kst(19, 20, 10)),
    })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, `ig:${ids[0]}`, `ig:${ids[1]}`, `ig:${ids[3]}`])
    expect(await unlinkedOf(w, seller)).toEqual({ [m]: 1 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toEqual([expect.objectContaining({ broadcast: b, liveId: m2, count: 2 })])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([])
    expect(notices.find((data) => data.code === 'UNLINKED_COMMENTS')).toMatchObject({ liveId: m, count: 1 })
  })

  it('다른 판매자의 끝나지 않은 회차는 (바)에 세지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 20, 0))
    const { seller, b, m } = shop
    const other = await addSeller(w)
    await liveBroadcast(w, other)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = kst(19, 20, 30)
    const id = await commentAt(w, shop, m2, at, '15')
    await expectMoved(w, seller, b, m2, at, id, from)
  })
})

describe('D-N2-17 LIVE_NOT_MOVED는 (바)·(사)로만 막혔을 때만 — 그 밖의 조건이 틀리면 UNLINKED_COMMENTS', () => {
  async function gapReady(w: IgWorld) {
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    await commentAt(w, shop, shop.m, kst(19, 20, 0), '예뻐요')
    w.fake.endLive(shop.m)
    return shop
  }

  function expectUnlinkedOnly(w: IgWorld, from: number, liveId: string): void {
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED' || data.code === 'LIVE_MOVED')).toEqual([])
    expect(notices.find((data) => data.code === 'UNLINKED_COMMENTS')).toMatchObject({ liveId, count: 1 })
  }

  it('① 늦게 받은 댓글(entry.time 61초 이름) + 60분 넘음 → UNLINKED_COMMENTS', async () => {
    const w = await world()
    const shop = await gapReady(w)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = kst(19, 21, 30)
    await commentAt(w, shop, m2, at, '15', {
      time: Math.floor((at - 61_000) / 1000),
    })
    expect(await linkOf(w, shop.seller, shop.b)).toMatchObject({
      liveId: shop.m,
    })
    expectUnlinkedOnly(w, from, m2)
  })

  it('② entry.time 없음 + 끝나지 않은 다른 회차 → UNLINKED_COMMENTS', async () => {
    const w = await world()
    const shop = await gapReady(w)
    w.clock.set(kst(19, 20, 10))
    await liveBroadcast(w, shop.seller)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    w.clock.set(kst(19, 20, 20))
    const change = w.fake.comment({
      accountId: shop.account.id,
      liveId: m2,
      igsid: '6024400000000301',
      username: 'no.time',
      text: '15',
    })
    const body = JSON.parse(w.fake.payload([{ accountId: shop.account.id, changes: [change] }])) as { entry: Record<string, unknown>[] }
    for (const entry of body.entry) delete entry.time
    expect((await w.fake.deliver(webhookTarget(w), JSON.stringify(body))).status).toBe(200)
    expect(await linkOf(w, shop.seller, shop.b)).toMatchObject({
      liveId: shop.m,
    })
    expectUnlinkedOnly(w, from, m2)
  })

  it('④ 판매자가 손으로 이은 연결 + 60분 넘음 → UNLINKED_COMMENTS', async () => {
    const w = await world()
    w.clock.set(kst(19, 19, 30))
    const shop = await connectedShop(w)
    const b = await liveBroadcast(w, shop.seller)
    const m = w.fake.startLive(shop.account.id)
    await linkLive(w, shop.seller, b, m)
    await commentAt(w, shop, m, kst(19, 20, 0), '예뻐요')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    await commentAt(w, shop, m2, kst(19, 21, 30), '15')
    expect(await linkOf(w, shop.seller, b)).toMatchObject({
      liveId: m,
      actor: { kind: 'account' },
    })
    expectUnlinkedOnly(w, from, m2)
  })

  it('⑤ 조건에 맞는 회차가 둘(둘 다 저절로 이음) → 옮기지 않고 UNLINKED_COMMENTS (OTHER_BROADCAST 아님)', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 20, 0))
    const b2 = await liveBroadcast(w, shop.seller)
    await wait(w, shop.seller, b2)
    const n = w.fake.startLive(shop.account.id)
    await commentAt(w, shop, n, kst(19, 20, 5), '안녕하세요')
    expect(await linkOf(w, shop.seller, b2)).toMatchObject({
      liveId: n,
      actor: { kind: 'server' },
    })
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    await commentAt(w, shop, m2, kst(19, 20, 10), '15')
    expect(await linkOf(w, shop.seller, shop.b)).toMatchObject({
      liveId: shop.m,
    })
    expect(await linkOf(w, shop.seller, b2)).toMatchObject({ liveId: n })
    expectUnlinkedOnly(w, from, m2)
  })

  it('③ 전에 끝난 회차에 이어졌던 라이브 + 60분 넘음 → UNLINKED_COMMENTS', async () => {
    const w = await world()
    const shop = await gapReady(w)
    // 끝난 다른 회차 d가 라이브 old에 이어졌었다 (그 라이브가 다시 댓글을 보낸다)
    w.clock.set(kst(19, 20, 5))
    const d = await liveBroadcast(w, shop.seller)
    const old = w.fake.startLive(shop.account.id)
    await linkLive(w, shop.seller, d, old)
    await end(w, shop.seller, d)
    const from = w.published.length
    await commentAt(w, shop, old, kst(19, 21, 30), '15')
    expect(await linkOf(w, shop.seller, shop.b)).toMatchObject({
      liveId: shop.m,
    })
    expectUnlinkedOnly(w, from, old)
  })
})

describe('RA-N2-006 연결 조회의 moved (AC-N2-03·25)', () => {
  it('두 번 옮기면 마지막 옮기기만, comments는 그 회차에 기록한 인스타 댓글을 모든 라이브에 걸쳐 센다(옮기는 댓글은 빼고) — 연결 목록에도, 회차를 끝낸 뒤에도. 막힌 연결·옮긴 적 없는 연결은 null', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 20, 0))
    const { seller, b, m } = shop
    const api = client(w, seller.cookie)
    expect((await linkOf(w, seller, b)).moved).toBeNull()
    await commentAt(w, shop, m, kst(19, 20, 1), '예뻐요')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const firstMove = kst(19, 20, 10)
    await commentAt(w, shop, m2, firstMove, '15')
    expect((await linkOf(w, seller, b)).moved).toEqual({
      fromLiveId: m,
      movedAt: iso(firstMove),
      comments: 2,
      message: '인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요. 그 전 라이브에서 이 방송에 기록한 댓글 2개를 확인해 주세요.',
    })
    await commentAt(w, shop, m2, kst(19, 20, 20), '16')
    // 다른 회차 c를 만들어 두면 (바)로 막힌다 — 막혀도 moved는 그대로(새 옮기기 아님)
    w.clock.set(kst(19, 20, 25))
    const c = await liveBroadcast(w, seller)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(shop.account.id)
    await commentAt(w, shop, m3, kst(19, 20, 30), '17')
    expect(await linkOf(w, seller, b)).toMatchObject({
      liveId: m2,
      moved: { fromLiveId: m, movedAt: iso(firstMove), comments: 2 },
    })
    expect((await linkOf(w, seller, c)).moved).toBeNull()
    w.clock.set(kst(19, 20, 35))
    await end(w, seller, c)
    const secondMove = kst(19, 20, 40)
    await commentAt(w, shop, m3, secondMove, '18')
    const expected = {
      fromLiveId: m2,
      movedAt: iso(secondMove),
      comments: 4,
      message: '인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요. 그 전 라이브에서 이 방송에 기록한 댓글 4개를 확인해 주세요.',
    }
    expect(await linkOf(w, seller, b)).toMatchObject({
      liveId: m3,
      moved: expected,
    })
    const list = (await api.get('/api/live')).body.links as (LinkBody & {
      broadcast: string
    })[]
    expect(list.find((link) => link.broadcast === b)?.moved).toEqual(expected)
    w.clock.set(kst(19, 21, 0))
    await end(w, seller, b)
    expect((await linkOf(w, seller, b)).moved).toEqual(expected)
  })
})
