// AC-S05-51 가짜 채팅 생성기, AC-S05-52 시청자로 채팅 보내기 (YT-09 AC2, D-082, R-3, R-4).
// 생성기는 리허설 방송에만, 메시지마다 서버 수집 함수(ingestChat, 조치자 collector)로만 쓴다. 다음 메시지는 시드와 그 시점의 범위 상태로만 정한다.
// 시험은 기다리지 않는 타이머(immediateTimer)·손으로 돌리는 타이머(manualTimer)를 주입한다.
import { applyEvent, containsPhoneRun, getBroadcast, initEngine, listClaims, type ClaimInfo, type EngineEvent } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { ChatMaker, SeededRandom, generatorView, type GeneratorStatus } from '../src/generator.ts'
import {
  addSeller,
  client,
  createBroadcast,
  expectOk,
  immediateTimer,
  manualTimer,
  newWorld,
  rid,
  sseReader,
  startServer,
  waitFor,
  writeEvent,
  type Seller,
  type TestServer,
} from './support.ts'

const DAY = '2026-10-19'

interface MessageRow {
  id: string
  channel: string
  nick: string
  text: string
  owner: boolean
  ignored: boolean
  order: boolean
  cancel: boolean
  orders: number[]
  cancels: number[]
  mentions: number[]
  seq: number
}

function initState() {
  return initEngine({ broadcasts: [], settings: {} })
}

function getBroadcastSettings() {
  const state = applyEvent(initState(), { type: 'broadcast.start', b: 'b1', date: DAY, title: '1부', seq: 1, at: 0 } as EngineEvent).state
  return getBroadcast(state, 'b1')?.settings as NonNullable<ReturnType<typeof getBroadcast>>['settings']
}

const gen = (b: string, action = '') => `/api/broadcasts/${b}/rehearsal/generator${action}`

async function status(world: TestServer, seller: Seller, b: string): Promise<GeneratorStatus> {
  const response = await expectOk(client(world, seller.cookie).get(gen(b)))
  return response.body.generator as GeneratorStatus
}

async function allMessages(world: TestServer, seller: Seller, b: string): Promise<MessageRow[]> {
  const out: MessageRow[] = []
  let after = 0
  for (;;) {
    const page = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/messages?rehearsal=true&b=${b}&after=${String(after)}&limit=500`))
    const rows = page.body.messages as MessageRow[]
    out.push(...rows)
    if (page.body.more !== true) return out
    after = rows.at(-1)?.seq ?? after
  }
}

async function chatEventCount(world: TestServer): Promise<number> {
  const result = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'chat'`)
  return result?.rows[0]?.n ?? 0
}

/** 리허설 방송 + 상품 1~10 (판매 중) */
async function rehearsalWith(world: TestServer, seller: Seller, products = 10): Promise<string> {
  const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
  for (let no = 1; no <= products; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: rehearsal.id, no, name: '구피', price: 1000 * no }))
  return rehearsal.id
}

async function runToEnd(world: TestServer, seller: Seller, b: string, body: Record<string, unknown>): Promise<GeneratorStatus> {
  const started = await expectOk(client(world, seller.cookie).post(gen(b, '/start'), body))
  expect((started.body.generator as GeneratorStatus).running).toBe(true)
  await waitFor(async () => !(await status(world, seller, b)).running, 120_000)
  return status(world, seller, b)
}

describe('AC-S05-51 가짜 채팅 생성기 — 1,000건 (주입 타이머)', () => {
  it('수집기 경로로만 쓰고, 섞는 것이 각각 1번 이상, 주문 번호는 maxNumber 안, 가짜 채널·번호 모양 없음, 같은 ID 사본은 기록되지 않는다', async () => {
    const world = await newWorld({ generatorTimer: immediateTimer })
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.maxNumber': 60 } }))
    const b = await rehearsalWith(world, seller)
    const final = await runToEnd(world, seller, b, { total: 1000, perSecond: 50, seed: 4242 })
    expect(final).toMatchObject({ b, running: false, sent: 1000, total: 1000, perSecond: 50, seed: 4242, failed: 0, stopReason: 'completed' })
    expect(final.duplicates).toBeGreaterThan(0)

    // 기록: 수집기 경로(조치자 collector)로만, 리허설 범위에만, 사본은 기록되지 않는다
    const actors = await world.database.pglite?.query<{ actor: string; rehearsal: boolean; n: number }>(
      `select e.actor, s.rehearsal, count(*)::int as n from events e join scopes s on s.id = e.scope_id where e.type = 'chat' group by e.actor, s.rehearsal`,
    )
    expect(actors?.rows).toEqual([{ actor: 'collector', rehearsal: true, n: 1000 - final.duplicates }])
    expect((await client(world, seller.cookie).get('/api/days')).body).toEqual({ days: [] }) // 실제 범위에는 아무것도 없다
    const messages = await allMessages(world, seller, b)
    expect(messages).toHaveLength(1000 - final.duplicates)
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length)

    const state = (await world.server.writer.read(seller.sellerId, DAY, true)).state
    const maxNumber = getBroadcast(state, b)?.settings['claim.maxNumber'] as number
    expect(maxNumber).toBe(60)
    const registered = new Set(Array.from({ length: 10 }, (_, i) => i + 1))
    const claims = listClaims(state) as ClaimInfo[]

    // 판매 중인 상품 주문 — 여러 표기
    const orders = messages.filter((m) => m.order && !m.owner)
    expect(orders.some((m) => registered.has(m.orders[0] as number))).toBe(true)
    const forms = new Set(orders.map((m) => m.text.replace(/\d+/g, 'N')))
    for (const form of ['N', 'N번', 'N번이요', '찜N']) expect(forms, form).toContain(form)
    // 아직 없는 번호 주문 → 보류 찜
    expect(claims.some((claim) => claim.status === 'PENDING' && !registered.has(claim.no))).toBe(true)
    // 언급·질문
    expect(messages.some((m) => !m.order && !m.cancel && m.mentions.length > 0 && /예뻐요|있나요|어떻게/.test(m.text))).toBe(true)
    expect(messages.some((m) => m.text === '3개 남았나요?')).toBe(true)
    // 시청자 취소
    expect(messages.some((m) => m.cancel && / 취소|번 취소/.test(m.text))).toBe(true)
    // 일반 대화 (번호 없음)
    expect(messages.some((m) => !m.owner && m.mentions.length === 0 && !m.order && !m.cancel && !/\d/.test(m.text))).toBe(true)
    // 같은 채널의 닉네임 바꾸기 / 같은 닉네임·다른 채널
    const nicksByChannel = new Map<string, Set<string>>()
    const channelsByNick = new Map<string, Set<string>>()
    for (const m of messages) {
      if (!nicksByChannel.has(m.channel)) nicksByChannel.set(m.channel, new Set())
      nicksByChannel.get(m.channel)?.add(m.nick)
      if (!channelsByNick.has(m.nick)) channelsByNick.set(m.nick, new Set())
      channelsByNick.get(m.nick)?.add(m.channel)
    }
    expect([...nicksByChannel.values()].some((nicks) => nicks.size > 1)).toBe(true)
    expect([...channelsByNick.entries()].some(([nick, channels]) => nick !== '방송자' && channels.size > 1)).toBe(true)
    // 방송자 본인 채팅 (기본 설정이라 무시)
    expect(messages.some((m) => m.owner && m.ignored)).toBe(true)

    // 주문·취소 번호는 maxNumber 안
    for (const m of messages) for (const no of [...m.orders, ...m.cancels]) expect(no).toBeLessThanOrEqual(maxNumber)
    // 가짜 채널 ID는 유튜브 채널 ID(UC로 시작하는 24자)와 겹치지 않고, 닉네임·본문에 휴대폰 번호 모양이 없다
    for (const m of messages) {
      expect(m.channel).toMatch(/^sim_/)
      expect(m.channel).not.toMatch(/^UC[A-Za-z0-9_-]{22}$/)
      expect(containsPhoneRun(m.nick) || containsPhoneRun(m.text), `${m.nick} ${m.text}`).toBe(false)
    }
    // 로그에 본문·닉네임이 없다
    const logs = JSON.stringify(world.logs)
    for (const m of messages.slice(0, 50)) {
      expect(logs).not.toContain(m.nick)
    }
    expect((await checkReplay(world.database.db, { rehearsal: true }))[0]?.ok).toBe(true)
  }, 180_000)

  it('같은 시드·같은 상태 순서면 같은 메시지 순서다 (다른 서버·다른 방송에서 다시 돌려도)', async () => {
    const run = async () => {
      const world = await newWorld({ generatorTimer: immediateTimer })
      const seller = await addSeller(world)
      const b = await rehearsalWith(world, seller, 5)
      const final = await runToEnd(world, seller, b, { total: 300, perSecond: 50, seed: 777 })
      const messages = await allMessages(world, seller, b)
      world.server.close()
      return { duplicates: final.duplicates, messages: messages.map((m) => [m.id.replace(b, ''), m.channel, m.nick, m.text, m.owner]) }
    }
    const first = await run()
    const second = await run()
    expect(second).toEqual(first)
    expect(first.messages.length).toBeGreaterThan(200)
  }, 120_000)

  it('메시지 만들기는 시드와 보기만으로 정해진다 (순수): 같은 입력이면 같은 결과, 시드가 다르면 다르다', () => {
    const view = { products: [1, 2, 3].map((no) => ({ no, status: 'OPEN' as const })), settings: getBroadcastSettings() }
    const make = (seed: number) => {
      const maker = new ChatMaker('b1', seed, 3)
      return Array.from({ length: 100 }, () => maker.next(view))
    }
    expect(make(1)).toEqual(make(1))
    expect(make(1)).not.toEqual(make(2))
    expect(make(1)[0]?.chat.id).toBe('sim-1-3-0')
    const random = new SeededRandom(9)
    const values = Array.from({ length: 1000 }, () => random.next())
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
    expect(new SeededRandom(9).next()).toBe(values[0])
    expect(generatorView(initState(), 'nope')).toBeNull()
  })
})

describe('AC-S05-51 시작·멈춤·상태 API', () => {
  it('실제 방송·다른 판매자의 방송·없는 방송이면 404이고 아무것도 기록하지 않는다', async () => {
    const world = await newWorld({ generatorTimer: immediateTimer })
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const real = await createBroadcast(world, seller, { date: DAY })
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const before = await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from events')
    for (const [who, b] of [
      [seller, real.id],
      [other, rehearsal.id],
      [seller, 'b_nope'],
    ] as const) {
      const api = client(world, who.cookie)
      expect((await api.post(gen(b, '/start'), { total: 5 })).status).toBe(404)
      expect((await api.post(gen(b, '/stop'), {})).status).toBe(404)
      expect((await api.get(gen(b))).status).toBe(404)
      expect((await api.post(`/api/broadcasts/${b}/rehearsal/chat`, { requestId: rid(), nick: 'a', text: '15' })).status).toBe(404)
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    const after = await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from events')
    expect(after?.rows[0]?.n).toBe(before?.rows[0]?.n)
    expect(world.server.service.generators.running).toBe(0)
  })

  it('범위 밖 설정은 400과 쉬운 문장 (총 개수 1~10,000 · 초당 1~50 · 시드 0 이상), 기본값은 300·1', async () => {
    const world = await newWorld({ generatorTimer: manualTimer() })
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: DAY, rehearsal: true })).id
    const api = client(world, seller.cookie)
    const cases: [Record<string, unknown>, string][] = [
      [{ total: 0 }, 'total'],
      [{ total: 10_001 }, 'total'],
      [{ total: 1.5 }, 'total'],
      [{ total: '300' }, 'total'],
      [{ perSecond: 0 }, 'perSecond'],
      [{ perSecond: 51 }, 'perSecond'],
      [{ seed: -1 }, 'seed'],
      [{ seed: 2 ** 31 }, 'seed'],
      [{ seed: 'abc' }, 'seed'],
      [{ requestId: '한글' }, 'requestId'],
    ]
    for (const [body, field] of cases) {
      const response = await api.post(gen(b, '/start'), body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field }] } })
      expect((response.body.error as { problems: { message: string }[] }).problems[0]?.message).not.toMatch(/[A-Za-z]/)
    }
    expect((await api.post(gen(b, '/start'), { speed: 2 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    const started = await expectOk(api.post(gen(b, '/start'), {}))
    expect(started.body.generator).toMatchObject({ running: true, total: 300, perSecond: 1, sent: 0, duplicates: 0, failed: 0, stopReason: null })
    const seed = (started.body.generator as GeneratorStatus).seed as number
    expect(Number.isSafeInteger(seed) && seed >= 0).toBe(true) // 시드를 적지 않으면 서버가 정해 상태에 보인다
  })

  it('이미 도는 방송에 다시 시작하면 409(하나만 돈다), 같은 요청 번호면 그 상태 200. 멈춘 뒤에는 다시 시작할 수 있다', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: DAY, rehearsal: true })).id
    const api = client(world, seller.cookie)
    const first = await expectOk(api.post(gen(b, '/start'), { requestId: 'gen-1', total: 10, seed: 1 }))
    const again = await expectOk(api.post(gen(b, '/start'), { requestId: 'gen-1', total: 10, seed: 1 }))
    expect(again.body).toEqual(first.body)
    const second = await api.post(gen(b, '/start'), { total: 10 })
    expect(second.status).toBe(409)
    expect(second.body).toEqual({ error: { code: 'GENERATOR_RUNNING', message: '이미 가짜 채팅을 보내는 중이에요. 멈춘 뒤 다시 시작해 주세요.' } })
    // 동시에 둘
    const b2 = (await createBroadcast(world, seller, { date: DAY, rehearsal: true })).id
    const both = await Promise.all([api.post(gen(b2, '/start'), { total: 3 }), api.post(gen(b2, '/start'), { total: 3 })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    expect(world.server.service.generators.running).toBe(2)
    await expectOk(api.post(gen(b, '/stop'), {}))
    const restarted = await expectOk(api.post(gen(b, '/start'), { total: 4, seed: 2 }))
    expect(restarted.body.generator).toMatchObject({ running: true, total: 4, seed: 2, sent: 0, stopReason: null })
    // 멈춘 생성기의 같은 요청 번호 → 그 (멈춘) 상태가 아니라 이미 새로 돌고 있으므로 409가 아닌 같은 번호 확인
    expect((await api.post(gen(b, '/start'), { requestId: 'gen-1' })).status).toBe(409)
  })

  it('초당 개수대로 간격을 둔다 (주입 시계·타이머): 첫 메시지는 바로, 다음은 1000/초당 밀리초 뒤', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 2)
    await expectOk(client(world, seller.cookie).post(gen(b, '/start'), { total: 3, perSecond: 4, seed: 5 }))
    expect(timer.lastDelay).toBe(0)
    const tick = async () => {
      const count = await chatEventCount(world)
      expect(timer.runNext()).toBe(true)
      await waitFor(async () => (await status(world, seller, b)).sent > count || !(await status(world, seller, b)).running)
    }
    await tick()
    expect(timer.lastDelay).toBe(250)
    world.clock.advance(100) // 늦어진 만큼 줄인다
    await tick()
    expect(timer.lastDelay).toBe(400) // 처음 기준 시각 + 250 × 2 − 지금(100 지남)
    await tick()
    expect(await status(world, seller, b)).toMatchObject({ running: false, sent: 3, stopReason: 'completed' })
    expect(timer.pending).toBe(0)
  })
})

describe('AC-S05-51 멈추는 때', () => {
  it('멈춤 요청: 보내던 메시지가 끝난 뒤 응답하고, 그 뒤로는 아무것도 쓰지 않는다', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 2)
    const api = client(world, seller.cookie)
    await expectOk(api.post(gen(b, '/start'), { total: 50, seed: 3 }))
    timer.runNext()
    await waitFor(async () => (await status(world, seller, b)).sent === 1)
    timer.runNext() // 두 번째 메시지가 보내지는 중에 멈춤
    const stopped = await expectOk(api.post(gen(b, '/stop'), {}))
    expect(stopped.body.generator).toMatchObject({ running: false, stopReason: 'stopped' })
    const sent = (stopped.body.generator as GeneratorStatus).sent
    const count = await chatEventCount(world)
    expect(timer.runNext()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await chatEventCount(world)).toBe(count)
    expect((await status(world, seller, b)).sent).toBe(sent)
    // 멈춘 생성기를 또 멈춰도 그대로
    expect((await expectOk(api.post(gen(b, '/stop'), {}))).body.generator).toMatchObject({ stopReason: 'stopped', sent })
    expect((await api.post(gen(b, '/stop'), { x: 1 })).status).toBe(400)
  })

  it('그 방송을 끝내면 멈추고(끝내기 전에), 끝난 방송은 시작할 수 없다(409)', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 2)
    const api = client(world, seller.cookie)
    await expectOk(api.post(gen(b, '/start'), { total: 50, seed: 3 }))
    timer.runNext()
    await waitFor(async () => (await status(world, seller, b)).sent === 1)
    await expectOk(api.post(`/api/broadcasts/${b}/end`, { requestId: rid() }))
    expect(await status(world, seller, b)).toMatchObject({ running: false, stopReason: 'ended', sent: 1 })
    expect(timer.runNext()).toBe(false)
    const events = await world.database.pglite?.query<{ type: string }>(`select type from events order by seq desc limit 1`)
    expect(events?.rows[0]?.type).toBe('broadcast.end') // 끝낸 뒤에 생성기가 쓴 채팅이 없다
    const again = await api.post(gen(b, '/start'), { total: 5 })
    expect(again.status).toBe(409)
    expect(again.body).toEqual({ error: { code: 'BROADCAST_ENDED', message: '끝난 방송이라 가짜 채팅을 보낼 수 없어요.' } })
  })

  it('다른 인스턴스가 방송을 끝내도 다음 메시지 전에 범위 상태를 보고 멈춘다', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const other = startServer(world.database, world.masterKey, { clock: world.clock })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 1)
    await expectOk(client(world, seller.cookie).post(gen(b, '/start'), { total: 50, seed: 3 }))
    await expectOk(client(other, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid() }))
    const count = await chatEventCount(world)
    timer.runNext()
    await waitFor(async () => !(await status(world, seller, b)).running)
    expect(await status(world, seller, b)).toMatchObject({ stopReason: 'ended', sent: 0 })
    expect(await chatEventCount(world)).toBe(count)
  })

  it('서버 종료면 멈추고(shutdown), 다시 시작한 서버는 이어서 하지 않는다 — 상태는 멈춤', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 1)
    await expectOk(client(world, seller.cookie).post(gen(b, '/start'), { total: 50, seed: 3 }))
    world.server.close()
    expect(world.server.service.generators.status(seller.sellerId, b)).toMatchObject({ running: false, stopReason: 'shutdown' })
    expect(timer.runNext()).toBe(false)
    const restarted = startServer(world.database, world.masterKey, { clock: world.clock, generatorTimer: timer })
    expect(await status(restarted, seller, b)).toMatchObject({ running: false, sent: 0 })
    expect(restarted.server.service.generators.running).toBe(0)
  })

  it('저장 실패(save_failed)는 다시 시도하지 않고 다음으로 가며 실패 수를 센다', async () => {
    let failNext = 0
    const world = await newWorld({
      generatorTimer: immediateTimer,
      hooks: {
        beforeCommit: (records) => {
          if (records[0]?.type === 'chat' && failNext > 0) {
            failNext -= 1
            throw new Error('저장 실패 주입')
          }
        },
      },
    })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 2)
    failNext = 3
    const final = await runToEnd(world, seller, b, { total: 20, perSecond: 50, seed: 11 })
    expect(final).toMatchObject({ sent: 20, failed: 3, stopReason: 'completed' })
    expect(await chatEventCount(world)).toBe(20 - 3 - final.duplicates)
  })
})

describe('AC-S05-51 직렬 처리와 알림', () => {
  it('생성기와 판매자의 등록·조치가 섞여도 seq 빈틈·중복이 없고 재생 검사가 일치한다', async () => {
    const world = await newWorld({ generatorTimer: immediateTimer })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 3)
    await expectOk(client(world, seller.cookie).post(gen(b, '/start'), { total: 200, perSecond: 50, seed: 99 }))
    for (let no = 4; no <= 33; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '구피', price: 1000 }))
    await waitFor(async () => !(await status(world, seller, b)).running, 60_000)
    const seqs = (await world.database.pglite?.query<{ seq: number }>(`select seq from events order by seq`))?.rows.map((row) => row.seq) ?? []
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1))
    expect((await checkReplay(world.database.db))[0]?.ok).toBe(true)
  }, 120_000)

  it('시작·보냄·멈춤은 SSE generator 알림으로 온다 (그 판매자에게만)', async () => {
    const timer = manualTimer()
    const world = await newWorld({ generatorTimer: timer })
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await rehearsalWith(world, seller, 1)
    const mine = sseReader(await client(world, seller.cookie).raw('/api/stream', {}))
    const theirs = sseReader(await client(world, other.cookie).raw('/api/stream', {}))
    try {
      await mine.until(() => mine.events.length >= 1)
      await expectOk(client(world, seller.cookie).post(gen(b, '/start'), { total: 5, seed: 1 }))
      timer.runNext()
      await mine.until(() => mine.events.filter((e) => e.event === 'generator').length >= 2)
      await expectOk(client(world, seller.cookie).post(gen(b, '/stop'), {}))
      await mine.until(() => mine.events.filter((e) => e.event === 'generator').some((e) => (JSON.parse(e.data) as GeneratorStatus).stopReason === 'stopped'))
      const notices = mine.events.filter((e) => e.event === 'generator').map((e) => JSON.parse(e.data) as GeneratorStatus & { date: string; rehearsal: boolean })
      expect(notices[0]).toMatchObject({ date: DAY, rehearsal: true, b, running: true, sent: 0, total: 5 })
      expect(notices.at(-1)).toMatchObject({ running: false, stopReason: 'stopped' })
      expect(theirs.events.filter((e) => e.event === 'generator')).toEqual([])
    } finally {
      await mine.cancel()
      await theirs.cancel()
      world.server.close()
    }
  })

  it('화면 이벤트 쓰기 API는 여전히 chat을 받지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: DAY, rehearsal: true })).id
    const response = await writeEvent(world, seller, { type: 'chat', b, id: 'x', ch: 'UC1', nick: 'n', text: '1' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: { problems: [{ field: 'type' }] } })
  })
})

describe('AC-S05-52 시청자로 채팅 보내기', () => {
  const send = (world: TestServer, seller: Seller, b: string, body: Record<string, unknown>) => client(world, seller.cookie).post(`/api/broadcasts/${b}/rehearsal/chat`, body)

  it('서버가 메시지 ID를 만들고 수집 함수 경로로 기록한다(조치자 수집기). 주문·언급 판정을 똑같이 받는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 15)
    const response = await expectOk(send(world, seller, b, { requestId: rid(), nick: '홍길동', text: '15' }))
    expect(response.body).toMatchObject({ date: DAY, rehearsal: true, type: 'chat', changed: true })
    const message = response.body.message as { id: string; channel: string }
    expect(message.id).toMatch(/^simv-[A-Za-z0-9_-]+$/)
    expect(message.channel).toMatch(/^sim_n_[a-z0-9]+$/)
    const history = (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/history?rehearsal=true`))).body.events as { type: string; actor: { kind: string; loginId: string | null } }[]
    expect(history.at(-1)).toMatchObject({ type: 'chat', actor: { kind: 'collector', loginId: null } })
    const [row] = await allMessages(world, seller, b)
    expect(row).toMatchObject({ id: message.id, channel: message.channel, nick: '홍길동', text: '15', order: true, orders: [15] })
  })

  it('같은 요청 번호는 한 번만 기록하고 처음 결과를 돌려준다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 1)
    const body = { requestId: rid(), nick: '홍길동', text: '안녕' }
    const first = await expectOk(send(world, seller, b, body))
    const again = await expectOk(send(world, seller, b, { ...body, text: '다른 글' }))
    expect(again.body).toEqual(first.body)
    expect(await chatEventCount(world)).toBe(1)
  })

  it('채널: 없으면 닉네임마다 같은 가짜 채널, new면 새 가짜 채널, sim_…이면 그대로 (생성기 채널 포함), 그 밖은 400', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 1)
    const channel = async (body: Record<string, unknown>) => ((await expectOk(send(world, seller, b, { requestId: rid(), text: '안녕', ...body }))).body.message as { channel: string }).channel
    const a1 = await channel({ nick: '가' })
    const a2 = await channel({ nick: '가' })
    const other = await channel({ nick: '나' })
    expect(a1).toBe(a2)
    expect(other).not.toBe(a1)
    const fresh1 = await channel({ nick: '가', channel: 'new' })
    const fresh2 = await channel({ nick: '가', channel: 'new' })
    expect(fresh1).toMatch(/^sim_v_/)
    expect(fresh1).not.toBe(fresh2)
    expect(await channel({ nick: '다', channel: 'sim_c3' })).toBe('sim_c3')
    for (const bad of ['UCabcdefghijklmnopqrstuv', 'sms:x', '', 'sim_', 'sim_한글']) {
      const response = await send(world, seller, b, { requestId: rid(), nick: '가', text: '안녕', channel: bad })
      expect(response.status, bad).toBe(400)
      expect(response.body).toMatchObject({ error: { problems: [{ field: 'channel' }] } })
    }
  })

  it('닉네임 1~30자·본문 1~200자(이모지는 한 글자), 휴대폰 번호 검사는 하지 않는다(시청자 값), 요청 번호 없으면 400', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 1)
    const ok = (body: Record<string, unknown>) => expectOk(send(world, seller, b, { requestId: rid(), ...body }))
    const bad = async (body: Record<string, unknown>, field: string) => {
      const response = await send(world, seller, b, { requestId: rid(), ...body })
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field }] } })
    }
    await ok({ nick: 'ㄱ'.repeat(30), text: 'ㄴ'.repeat(200) })
    await ok({ nick: '🐟'.repeat(30), text: '🐠'.repeat(200) })
    await ok({ nick: '010-1234-5678', text: '제 번호 010-9876-5432 예요' })
    await ok({ nick: '줄바꿈', text: '첫 줄\n둘째 줄' })
    await bad({ nick: 'ㄱ'.repeat(31), text: '안녕' }, 'nick')
    await bad({ nick: '', text: '안녕' }, 'nick')
    await bad({ nick: '   ', text: '안녕' }, 'nick')
    await bad({ nick: '가\n나', text: '안녕' }, 'nick')
    await bad({ nick: '가', text: '' }, 'text')
    await bad({ nick: '가', text: 'ㄴ'.repeat(201) }, 'text')
    await bad({ nick: 1, text: '안녕' }, 'nick')
    const unknown = await send(world, seller, b, { requestId: rid(), nick: '가', text: '안녕', id: 'mine' })
    expect(unknown.body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    const missing = await send(world, seller, b, { nick: '가', text: '안녕' })
    expect(missing.status).toBe(400)
    expect(missing.body).toMatchObject({ error: { code: 'INVALID_REQUEST_ID' } })
  })
})

describe('AC-S05-91 리허설 끝까지 비교 방법 (dev-notes "이력으로 코어 재생하기")', () => {
  it('생성기와 판매자 조치가 섞인 리허설 범위의 이력을 코어 applyEvent로 처음부터 재생하면 범위 조회(상품·정산 묶음)와 같다', async () => {
    const world = await newWorld({ generatorTimer: immediateTimer })
    const seller = await addSeller(world)
    const b = await rehearsalWith(world, seller, 5)
    await expectOk(client(world, seller.cookie).post(gen(b, '/start'), { total: 300, perSecond: 50, seed: 31 }))
    for (let no = 6; no <= 15; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '구피', price: 2000 }))
    await waitFor(async () => !(await status(world, seller, b)).running, 60_000)
    await writeEvent(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'sim_c1', reason: '시청자 요청' })
    const events: { type: string; seq: number; at: string; reason: string | null; fields: Record<string, unknown>; failed: boolean }[] = []
    for (let after = 0; ; ) {
      const page = (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/history?rehearsal=true&after=${String(after)}&limit=500`))).body.events as typeof events
      if (page.length === 0) break
      events.push(...page)
      after = page.at(-1)?.seq ?? after
    }
    let state = initState()
    for (const event of events) {
      if (event.failed) continue
      state = applyEvent(state, { type: event.type, seq: event.seq, at: Date.parse(event.at), ...event.fields, ...(event.reason === null ? {} : { reason: event.reason }) } as EngineEvent).state
    }
    const view = (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}?rehearsal=true`))).body
    const { listProducts, listSettlements } = await import('@livejjim/core')
    const { withIsoTimes } = await import('../src/time.ts')
    expect(view.products).toEqual(withIsoTimes(listProducts(state)))
    expect(view.settlements).toEqual(withIsoTimes(listSettlements(state)))
    expect(events.length).toBe(view.seq)
  }, 60_000)
})
