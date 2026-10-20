// AC-S05-61 증분 조회 (RA-S04-007, NFR-01·04, D-085): GET /api/days/:date/changes?since=a
// - 덮으면 같다: a의 전체 조회 결과에 (a → 지금) 증분을 항목 키로 덮고 사라진 키를 지우면 지금의 전체 조회 결과와 같다. 값이 같은 항목은 넣지 않는다.
// - 응답 크기는 바뀐 양에 비례한다. 줄 수 없는 since(기준점 밖·지금보다 큼)는 410 RESYNC_REQUIRED.
// - 상품 500·채팅 1만 건 범위에서 증분 조회 응답 p99 300ms 이내 — 성능 시험(changes.perf.test.ts, pnpm perf)으로 따로 잰다 (D-902).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fillScope } from '../src/e2e.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, startServer, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'
const LISTS = ['broadcasts', 'products', 'claims', 'pending', 'buyers', 'settlements', 'effects', 'cancelRequests'] as const
type ListName = (typeof LISTS)[number]
type Item = Record<string, unknown>
type View = Record<string, unknown>

/** 계약의 항목 키 (dev-notes "증분 조회") */
function keyOf(name: ListName, item: Item): string {
  switch (name) {
    case 'products':
      return String(item.key)
    case 'pending':
      return String(item.product)
    case 'settlements':
      return JSON.stringify([item.buyer, item.date])
    case 'cancelRequests':
      return String(item.claim)
    default:
      return String(item.id)
  }
}

function removedKey(name: ListName, key: unknown): string {
  if (name === 'settlements') {
    const { buyer, date } = key as { buyer: string; date: string }
    return JSON.stringify([buyer, date])
  }
  return String(key)
}

/** 화면이 하듯 덮는다: 항목 키로 덮고, 사라진 키는 지운다. 확인 필요는 덧붙인다 */
function overlay(full: View, changes: View): Record<string, Map<string, string>> {
  const out: Record<string, Map<string, string>> = {}
  const removed = changes.removed as Record<ListName, unknown[]>
  for (const name of LISTS) {
    const map = new Map((full[name] as Item[]).map((item) => [keyOf(name, item), JSON.stringify(item)]))
    for (const key of removed[name]) map.delete(removedKey(name, key))
    for (const item of changes[name] as Item[]) map.set(keyOf(name, item), JSON.stringify(item))
    out[name] = map
  }
  out.attention = new Map([...(full.attention as Item[]), ...(changes.attention as Item[])].map((item) => [String(item.seq), JSON.stringify(item)]))
  return out
}

function asMaps(full: View): Record<string, Map<string, string>> {
  const out: Record<string, Map<string, string>> = {}
  for (const name of LISTS) out[name] = new Map((full[name] as Item[]).map((item) => [keyOf(name, item), JSON.stringify(item)]))
  out.attention = new Map((full.attention as Item[]).map((item) => [String(item.seq), JSON.stringify(item)]))
  return out
}

const sorted = (map: Map<string, string>) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

function expectCovers(before: View, changes: View, now: View): void {
  const merged = overlay(before, changes)
  const target = asMaps(now)
  for (const name of [...LISTS, 'attention']) expect(sorted(merged[name] as Map<string, string>), name).toEqual(sorted(target[name] as Map<string, string>))
  // 값이 같은 항목은 넣지 않는다 / 사라진 키는 정말 있었다가 없어진 것
  const old = asMaps(before)
  for (const name of LISTS) {
    for (const item of changes[name] as Item[]) expect(old[name]?.get(keyOf(name, item)), `${name} ${keyOf(name, item)} 값이 같은데 들어 있다`).not.toBe(JSON.stringify(item))
    for (const key of (changes.removed as Record<ListName, unknown[]>)[name]) {
      expect(old[name]?.has(removedKey(name, key))).toBe(true)
      expect(target[name]?.has(removedKey(name, key))).toBe(false)
    }
  }
  expect(changes.seq).toBe(now.seq)
}

async function full(world: TestServer, seller: Seller, rehearsal = false): Promise<View> {
  return (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}${rehearsal ? '?rehearsal=true' : ''}`))).body
}

async function changesSince(world: TestServer, seller: Seller, since: number, rehearsal = false): Promise<JsonResponse> {
  return client(world, seller.cookie).get(`/api/days/${DAY}/changes?since=${String(since)}${rehearsal ? '&rehearsal=true' : ''}`)
}

// ── 무작위 이벤트 순서 ───────────────────────────────────────────────────

const CHANNELS = ['UCa', 'UCb', 'UCc', 'UCd']
type Step =
  | { kind: 'register'; no: number; price: number; stock: number }
  | { kind: 'chat'; ch: string; text: string }
  | { kind: 'sms'; no: number; received: string; phone: string | null }
  | { kind: 'host'; type: string; no: number; ch: string }
  | { kind: 'assign'; no: number; ch: string; replace: string | null; replaceTo: 'WAITLIST' | 'CANCEL' }
  | { kind: 'product'; type: 'product.open' | 'product.hold' | 'product.close'; no: number }
  | { kind: 'update'; no: number; price: number; applyTo: 'NEW_ONLY' | 'UNPAID_CLAIMS' }
  | { kind: 'renumber'; from: number; to: number }
  | { kind: 'block'; ch: string; on: boolean }
  | { kind: 'merge'; from: string; into: string }
  | { kind: 'unmerge'; from: string }
  | { kind: 'payment'; ch: string; amount: number }
  | { kind: 'conflict'; no: number; decision: 'KEEP' | 'SWITCH' }
  | { kind: 'convert'; message: number; no: number }
  | { kind: 'reopen'; no: number }
  | { kind: 'checkpoint' }

const no = fc.integer({ min: 1, max: 6 })
const ch = fc.constantFrom(...CHANNELS)
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('register' as const), no, price: fc.constantFrom(1000, 5000, 10000), stock: fc.constantFrom(1, 1, 2) }) },
  {
    weight: 6,
    arbitrary: fc.record({ kind: fc.constant('chat' as const), ch, text: fc.oneof(no.map(String), no.map((n) => `${String(n)} 취소`), no.map((n) => `${String(n)}번 예뻐요`), fc.constant('안녕')) }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('sms' as const), no, received: fc.constantFrom('11:00', '11:59', '12:00:30'), phone: fc.constantFrom(null, '010-1111-2222', '010-3333-4444') }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('host' as const),
      type: fc.constantFrom('host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel'),
      no,
      ch,
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('assign' as const), no, ch, replace: fc.option(ch, { nil: null }), replaceTo: fc.constantFrom('WAITLIST' as const, 'CANCEL' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('product' as const), type: fc.constantFrom('product.open' as const, 'product.hold' as const, 'product.close' as const), no }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('update' as const), no, price: fc.constantFrom(2000, 12000), applyTo: fc.constantFrom('NEW_ONLY' as const, 'UNPAID_CLAIMS' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('renumber' as const), from: no, to: fc.integer({ min: 1, max: 8 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('block' as const), ch, on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('merge' as const), from: ch, into: ch }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('unmerge' as const), from: ch }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('payment' as const), ch, amount: fc.constantFrom(1000, 10000, 30000) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('conflict' as const), no, decision: fc.constantFrom('KEEP' as const, 'SWITCH' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('convert' as const), message: fc.nat(30), no }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('reopen' as const), no }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'checkpoint' as const }) },
)

async function play(world: TestServer, seller: Seller, b: string, step: Step, chats: string[]): Promise<void> {
  const w = (event: Record<string, unknown>, date?: string) => writeEvent(world, seller, event, date)
  switch (step.kind) {
    case 'register':
      await w({ type: 'product.register', b, no: step.no, name: '구피', price: step.price, stock: step.stock })
      return
    case 'chat': {
      const id = `m${String(chats.length)}`
      chats.push(id)
      await world.server.ingestChat(seller.sellerId, { b, id, ch: step.ch, nick: step.ch.toLowerCase(), text: step.text })
      return
    }
    case 'sms':
      await w({ type: 'sms', b, no: step.no, received: step.received, ...(step.phone === null ? {} : { phone: step.phone }) })
      return
    case 'host':
      await w({ type: step.type, b, no: step.no, buyer: step.ch, reason: '사유' })
      return
    case 'assign':
      await w({ type: 'host.assign', b, no: step.no, buyer: step.ch, reason: '사유', ...(step.replace === null ? {} : { replace: step.replace, replaceTo: step.replaceTo }) })
      return
    case 'product':
      await w({ type: step.type, b, no: step.no })
      return
    case 'update':
      await w({ type: 'product.update', b, no: step.no, price: step.price, applyTo: step.applyTo })
      return
    case 'renumber':
      await w({ type: 'product.renumber', b, from: step.from, to: step.to })
      return
    case 'block':
      await w({ type: step.on ? 'host.blockBuyer' : 'host.unblockBuyer', buyer: step.ch, reason: '사유' }, DAY)
      return
    case 'merge':
      await w({ type: 'buyer.merge', from: step.from, into: step.into, reason: '같은 사람' }, DAY)
      return
    case 'unmerge':
      await w({ type: 'buyer.unmerge', from: step.from, reason: '다른 사람' }, DAY)
      return
    case 'payment':
      await w({ type: 'settlement.payment', buyer: step.ch, date: DAY, amount: step.amount }, DAY)
      return
    case 'conflict':
      await w({ type: 'host.resolveConflict', b, no: step.no, decision: step.decision })
      return
    case 'convert':
      if (chats.length > 0) await w({ type: 'host.convertMessage', b, msg: chats[step.message % chats.length], no: step.no })
      return
    case 'reopen':
      await w({ type: 'host.reopen', b, no: step.no, reason: '다시 판매' })
      return
    case 'checkpoint':
      return
  }
}

describe('AC-S05-61 증분 조회 — 덮으면 같다', () => {
  it('무작위 이벤트 순서(등록·채팅·문자찜·조치·차단·충돌·번호 변경·합치기·입금·메시지 변환)에서 어느 기준점이든 전체(a) + 증분(a → 지금) = 전체(지금)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Record<string, unknown>>({}, { 'contention.policy': 'RECEIVED_TIME', 'cancel.succession': 'ASK' }, { 'cancel.buyerChat': 'AUTO', 'waitlist.max': 1 }),
        fc.array(stepArb, { minLength: 5, maxLength: 45 }),
        async (settings, steps) => {
          const world = await newWorld()
          const seller = await addSeller(world)
          await expectOk(client(world, seller.cookie).patch('/api/settings', { settings }))
          const b = await createBroadcast(world, seller, { date: DAY })
          const second = await createBroadcast(world, seller, { date: DAY })
          const chats: string[] = []
          const checkpoints: View[] = [await full(world, seller)]
          for (const [index, step] of steps.entries()) {
            await play(world, seller, index % 7 === 6 ? second.id : b.id, step, chats)
            if (step.kind === 'checkpoint') checkpoints.push(await full(world, seller))
          }
          const now = await full(world, seller)
          for (const before of [...checkpoints, now]) {
            const response = await expectOk(changesSince(world, seller, before.seq as number))
            expectCovers(before, response.body, now)
          }
          world.server.close()
        },
      ),
      { numRuns: 25 },
    )
    // 정답 성질 시험(무작위 25번)이라 시간 기준이 아니다 — 혼자 5초쯤인데 같은 기계에서 다른 검증이 함께 돌면 30초를 넘어 시간 초과로만 실패했다(I2, dev-notes).
    // 단언은 그대로이고 시험 시간 한도만 넉넉히 둔다
  }, 120_000)

  it('since = 지금이면 빈 증분, since = 0이면(새로 만든 범위의 기준점) 전체와 같다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    const now = await full(world, seller)
    const same = await expectOk(changesSince(world, seller, now.seq as number))
    for (const name of LISTS) {
      expect(same.body[name]).toEqual([])
      expect((same.body.removed as Record<string, unknown[]>)[name]).toEqual([])
    }
    expect(same.body).toMatchObject({ date: DAY, rehearsal: false, since: now.seq, seq: now.seq, attention: [], messages: [], messagesMore: false })
    const empty = Object.fromEntries([...LISTS.map((name) => [name, []]), ['attention', []], ['seq', 0]]) as View
    expectCovers(empty, (await expectOk(changesSince(world, seller, 0))).body, now)
  })

  it('지금보다 큰 since·기준점 창 밖의 since는 410 RESYNC_REQUIRED("전체를 다시 받으세요"), 잘못된 since는 400, 없는 범위는 404', async () => {
    const world = await newWorld({ changesWindow: 3 })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (let i = 1; i <= 5; i++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: i, name: 'a', price: 1000 }))
    const resync = { error: { code: 'RESYNC_REQUIRED', message: '바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요.' } }
    const future = await changesSince(world, seller, 7)
    expect(future.status).toBe(410)
    expect(future.body).toEqual(resync)
    const old = await changesSince(world, seller, 2) // 창 3: 기준점은 seq 3·4·5·6
    expect(old.status).toBe(410)
    expect(old.body).toEqual(resync)
    expect((await changesSince(world, seller, 3)).status).toBe(200)
    expect((await client(world, seller.cookie).get(`/api/days/${DAY}/changes`)).status).toBe(400)
    expect((await client(world, seller.cookie).get(`/api/days/${DAY}/changes?since=-1`)).status).toBe(400)
    expect((await client(world, seller.cookie).get(`/api/days/${DAY}/changes?since=1.5`)).status).toBe(400)
    expect((await client(world, seller.cookie).get('/api/days/2026-10-25/changes?since=0')).status).toBe(404)
    expect((await changesSince(world, seller, 0, true)).status).toBe(404) // 리허설 범위는 없다
  })

  it('다시 시작한 인스턴스: 불러온 스냅샷보다 앞선 since는 410, 그 뒤 since는 덮으면 같다', async () => {
    const world = await newWorld({ snapshotEvery: 4 })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (let i = 1; i <= 5; i++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: i, name: 'a', price: 1000 }))
    const atSix = await full(world, seller) // 스냅샷은 seq 4
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    const fresh = startServer(world.database, world.masterKey, { clock: world.clock, snapshotEvery: 4 })
    expect((await changesSince(fresh, seller, 3)).status).toBe(410)
    const now = await full(fresh, seller)
    expectCovers(atSix, (await expectOk(changesSince(fresh, seller, 6))).body, now)
    fresh.server.close()
  })

  it('리허설 범위의 증분은 rehearsal=true로만 (실제 범위와 따로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const before = await full(world, seller, true)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: rehearsal.id, no: 1, name: 'a', price: 1000 }))
    const response = await expectOk(changesSince(world, seller, before.seq as number, true))
    expect(response.body).toMatchObject({ rehearsal: true, since: 1, seq: 2 })
    expectCovers(before, response.body, await full(world, seller, true))
    expect((await changesSince(world, seller, 1)).status).toBe(404) // 실제 범위는 없다
  })

  it('메시지 변환은 이미 받은 메시지의 기록(바꾼 번호·찜)을 messages로 다시 준다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: 'a', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'q1', ch: 'UC1', nick: '홍길동', text: '십오번이요' })
    const before = await full(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'host.convertMessage', b: b.id, msg: 'q1', no: 15 }))
    const response = await expectOk(changesSince(world, seller, before.seq as number))
    const messages = response.body.messages as { id: string; converted: number[]; claims: string[]; seq: number }[]
    expect(messages).toMatchObject([{ id: 'q1', seq: 3, converted: [15], claims: ['c1'] }])
    expect((response.body.claims as { id: string; origin: string }[]).map((claim) => [claim.id, claim.origin])).toEqual([['c1', 'convert']])
  })
})

describe('AC-S05-61 증분 조회의 새 메시지', () => {
  it('since 뒤의 새 메시지를 seq 순으로 함께 주고(최대 200개, 넘으면 messagesMore), 메시지 이어 받기와 같은 항목이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const before = await full(world, seller)
    for (let i = 0; i < 205; i++) await world.server.ingestChat(seller.sellerId, { b: b.id, id: `n${String(i)}`, ch: 'UC1', nick: 'n', text: i % 2 === 0 ? '안녕' : '1' })
    const response = await expectOk(changesSince(world, seller, before.seq as number))
    const messages = response.body.messages as { id: string; seq: number }[]
    expect(messages).toHaveLength(200)
    expect(messages[0]?.id).toBe('n0')
    expect(messages.at(-1)?.id).toBe('n199')
    expect(response.body.messagesMore).toBe(true)
    const follow = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/messages?after=${String(messages.at(-1)?.seq)}`))
    expect((follow.body.messages as { id: string }[]).map((m) => m.id)).toEqual(['n200', 'n201', 'n202', 'n203', 'n204'])
    const same = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/messages?after=${String(before.seq)}&limit=200`))
    expect(same.body.messages).toEqual(messages)
  })
})

describe('AC-S05-61 크기 (상품 500·채팅 1만 건) — 지연 p99는 changes.perf.test.ts', () => {
  it('채팅 1건 뒤의 증분에 바뀌지 않은 상품·찜·지난 채팅이 없고, 응답 크기가 바뀐 양에 비례한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const filled = await fillScope(world.server, seller.sellerId, { date: DAY, products: 500, chats: 10_000, clock: world.clock })
    expect(filled.seq).toBe(10_501)
    const before = await full(world, seller)
    expect((before.products as unknown[]).length).toBe(500)
    const fullBytes = JSON.stringify(before).length

    // 주문이 아닌 채팅 1건: 새 시청자 한 명(구매자) 말고는 바뀐 것이 없다
    await world.server.ingestChat(seller.sellerId, { b: filled.broadcast, id: 'new-talk', ch: 'UCnew', nick: '새 손님', text: '안녕하세요' })
    const talk = await expectOk(changesSince(world, seller, before.seq as number))
    for (const name of LISTS) if (name !== 'buyers') expect(talk.body[name], name).toEqual([])
    expect((talk.body.buyers as { id: string }[]).map((buyer) => buyer.id)).toEqual(['UCnew'])
    expect(talk.text.length).toBeLessThan(3000)
    // 새 메시지는 그 1건뿐이다 — 지난 채팅이 섞이지 않는다
    expect((talk.body.messages as { id: string }[]).map((message) => message.id)).toEqual(['new-talk'])
    expect(talk.body.messagesMore).toBe(false)

    // 주문 채팅 1건: 그 찜과 그 상품(·구매자·정산)만
    const mid = await full(world, seller)
    await world.server.ingestChat(seller.sellerId, { b: filled.broadcast, id: 'new-order', ch: 'UCnew', nick: '새 손님', text: '250' })
    const order = await expectOk(changesSince(world, seller, mid.seq as number))
    expect((order.body.claims as unknown[]).length).toBe(1)
    for (const product of order.body.products as { no: number }[]) expect(product.no).toBe(250)
    expectCovers(mid, order.body, await full(world, seller))
    expect(order.text.length * 50).toBeLessThan(fullBytes)

  }, 180_000)
})
