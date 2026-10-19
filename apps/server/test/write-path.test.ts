// 기록 경로: AC-S04-21 방송 만들기·끝내기, AC-S04-22 기록 전 거르기, AC-S04-23 저장 전엔 결과 없음,
// AC-S04-24 엔진이 처리하지 못한 입력, AC-S04-30 발송함
import { DEFAULT_SETTINGS, applyEvent, getBroadcast, initEngine, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { FAILED_INPUT_MESSAGE, REPLAY_SKIPPED_MESSAGE } from '../src/runtime.ts'
import {
  T0,
  addSeller,
  client,
  countRows,
  createBroadcast,
  expectOk,
  fakeClock,
  newWorld,
  rid,
  startServer,
  writeEvent,
  type TestServer,
} from './support.ts'

/** 범위 로그를 처음부터 재생한 상태 (코어만으로) */
async function replayFromDb(world: TestServer, date: string): Promise<{ state: EngineState; rows: { seq: number; type: string; failed: boolean }[] }> {
  const pg = world.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  const result = await pg.query<{ seq: number; type: string; body: string; failed: boolean }>(
    `select e.seq, e.type, e.body, e.failed from events e join scopes s on s.id = e.scope_id where s.date = $1 order by e.seq`,
    [date],
  )
  let state = initEngine({ broadcasts: [], settings: {} })
  for (const row of result.rows) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return { state, rows: result.rows.map(({ seq, type, failed }) => ({ seq, type, failed })) }
}

async function memoryState(world: TestServer, sellerId: string, date: string): Promise<EngineState> {
  return (await world.server.writer.read(sellerId, date)).state
}

describe('AC-S04-21 방송 만들기·끝내기와 엔진 범위', () => {
  it('날짜가 없으면 서버의 KST 오늘, 제목이 없으면 그 날짜의 N번째 방송 "N부"', async () => {
    // 2026-10-18 15:30 UTC = 10/19 00:30 KST
    const world = await newWorld({ clock: fakeClock(Date.UTC(2026, 9, 18, 15, 30)) })
    const seller = await addSeller(world)
    const first = await expectOk(client(world, seller.cookie).post('/api/broadcasts', { requestId: rid() }))
    expect(first.body).toMatchObject({ date: '2026-10-19', seq: 1, type: 'broadcast.start', changed: true, broadcast: { date: '2026-10-19', title: '1부' } })
    const second = await expectOk(client(world, seller.cookie).post('/api/broadcasts', { requestId: rid() }))
    expect(second.body).toMatchObject({ seq: 2, broadcast: { title: '2부' } })
    const named = await expectOk(client(world, seller.cookie).post('/api/broadcasts', { requestId: rid(), date: '2026-10-20', title: '  특별 방송 ' }))
    expect(named.body).toMatchObject({ date: '2026-10-20', seq: 1, broadcast: { title: '특별 방송' } })
  })

  it('방송 ID는 서버가 만든 추측할 수 없는 값이고, broadcast.start에 판매자 설정을 기본값 위에 덮어 푼 모든 키를 적는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'waitlist.max': 2, 'claim.parseMode': 'LOOSE' } }))
    const a = await createBroadcast(world, seller)
    const b = await createBroadcast(world, seller)
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(a.id).not.toBe(b.id)
    const { rows, state } = await replayFromDb(world, a.date)
    expect(rows[0]).toEqual({ seq: 1, type: 'broadcast.start', failed: false })
    const pg = world.database.pglite
    const body = JSON.parse((await pg?.query<{ body: string }>(`select body from events where seq = 1`))?.rows[0]?.body ?? '{}') as { settings: Record<string, unknown> }
    expect(Object.keys(body.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
    expect(body.settings).toEqual({ ...DEFAULT_SETTINGS, 'waitlist.max': 2, 'claim.parseMode': 'LOOSE' })
    expect(getBroadcast(state, a.id)?.settings['waitlist.max']).toBe(2)
  })

  it('범위 상태 = 그 범위 로그를 빈 엔진부터 재생한 결과, seq는 1부터 빈틈없이', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크프릴', price: 10000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '영희', text: '1' })
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received: '12:00' }))
    const { state, rows } = await replayFromDb(world, b.date)
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4])
    expect(await memoryState(world, seller.sellerId, b.date)).toEqual(state)
  })

  it('방송 끝내기: broadcast.end 기록, 이미 끝난 방송이면 상태 그대로·changed false (그래도 기록)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    world.clock.advance(60_000)
    const end = await expectOk(api.post(`/api/broadcasts/${b.id}/end`, { requestId: rid() }))
    expect(end.body).toMatchObject({ seq: 2, type: 'broadcast.end', changed: true })
    const again = await expectOk(api.post(`/api/broadcasts/${b.id}/end`, { requestId: rid() }))
    expect(again.body).toMatchObject({ seq: 3, type: 'broadcast.end', changed: false })
    const list = await api.get('/api/broadcasts')
    expect(list.body.broadcasts).toEqual([{ id: b.id, date: b.date, title: '1부', rehearsal: false, ended: true, endedAt: new Date(T0 + 60_000).toISOString() }])
    const view = await api.get(`/api/days/${b.date}`)
    expect((view.body.broadcasts as { ended: boolean; endedAt: string }[])[0]).toMatchObject({ ended: true, endedAt: new Date(T0 + 60_000).toISOString() })
  })

  it('at은 서버 시계의 UTC 밀리초이고 범위 안에서 줄지 않는다 (시계가 뒤로 가면 직전 값)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    world.clock.advance(5000)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
    world.clock.advance(-60_000)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 2, name: 'b', price: 1 }))
    world.clock.advance(120_000)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 3, name: 'c', price: 1 }))
    const ats = (await world.database.pglite?.query<{ at: number }>(`select at from events order by seq`))?.rows.map((row) => Number(row.at))
    expect(ats).toEqual([T0, T0 + 5000, T0 + 5000, T0 + 65_000])
  })

  it('방송 만들기 입력 검사: 날짜·제목 형식, 모르는 필드, 요청 번호', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    for (const body of [
      { requestId: rid(), date: '2026-02-30' },
      { requestId: rid(), date: 20261019 },
      { requestId: rid(), title: '' },
      { requestId: rid(), title: 'a\u0000b' },
      { requestId: rid(), title: 'x'.repeat(101) },
      { requestId: rid(), title: 3 },
    ]) {
      const response = await api.post('/api/broadcasts', body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    }
    expect((await api.post('/api/broadcasts', { requestId: rid(), settings: {} })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD', problems: [{ field: 'settings' }] } })
    expect((await api.post('/api/broadcasts', {})).status).toBe(400)
    expect((await api.post('/api/broadcasts', { requestId: 'has space' })).body).toMatchObject({ error: { code: 'INVALID_REQUEST_ID' } })
    expect((await api.post('/api/broadcasts', { requestId: 'x'.repeat(65) })).status).toBe(400)
    expect(await countRows(world.database, 'events')).toBe(0)
    expect(await countRows(world.database, 'scopes')).toBe(0)
  })
})

describe('AC-S04-22 기록 전에 거른다', () => {
  it('입력 오류·모르는 종류·미구현 종류는 기록·발송함·상태 변화 없이 4xx, 받은 값은 되돌려 보내지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const before = { events: await countRows(world.database, 'events'), outbox: await countRows(world.database, 'outbox') }
    const state = await memoryState(world, seller.sellerId, b.date)
    const marker = 'ZZMARKER-QX'
    const cases: Record<string, unknown>[] = [
      { type: 'product.register', b: b.id, no: 0, name: marker, price: 1 },
      { type: 'product.register', b: b.id, no: 2, name: marker, price: -5 },
      { type: 'product.update', b: b.id, no: 1, stock: 0, name: marker },
      { type: 'host.cancel', b: b.id, no: 1, buyer: 'UC1', reason: '   ' },
      { type: 'effect.labelPrinted', effectId: marker },
      { type: 'effect.failed', effectId: marker },
      { type: 'chat', b: b.id, id: 'm1', ch: 'UC1', nick: marker, text: '1' },
      { type: 'broadcast.start', b: 'b2', date: '2026-10-19', title: marker },
      { type: 'broadcast.end', b: b.id },
      { type: `${marker}.type` },
      { type: 'sms', b: b.id, no: 1, memo: `${marker} 010-1234-5678` },
    ]
    for (const event of cases) {
      const response = await writeEvent(world, seller, event)
      expect(response.status, JSON.stringify(event)).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
      expect(response.text).not.toContain(marker)
      expect(response.text).not.toContain('010-1234-5678')
      const error = response.body.error as { problems?: { field: string | null; message: string }[]; message: string }
      expect(error.message).toMatch(/[가-힣]/)
      for (const problem of error.problems ?? []) expect(problem.message).toMatch(/[가-힣]/)
    }
    expect(await countRows(world.database, 'events')).toBe(before.events)
    expect(await countRows(world.database, 'outbox')).toBe(before.outbox)
    expect(await memoryState(world, seller.sellerId, b.date)).toBe(state)
  })

  it('입력 오류 응답은 필드 이름과 쉬운 문장을 담는다 (메모의 번호는 D-079 ⑥ 문장 + 전화번호 칸 안내)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const price = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1.5 })
    expect(price.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'price', message: '가격은 0 이상의 정수(원)로 적어 주세요.' }] } })
    const memo = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, memo: '김영희 010 1234 5678' })
    expect(memo.body).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: '입력한 내용을 확인해 주세요.',
        problems: [{ field: 'memo', message: '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.', hint: '전화번호는 전화번호 칸에 적어 주세요.' }],
      },
    })
  })

  it('미구현 설정(MANUAL)이 판매자 설정에 있으면 방송 만들기를 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    // 설정 API는 MANUAL을 막는다 — DB에 직접 넣어 엔진의 미구현 경로를 확인한다
    await world.database.pglite?.query(`update sellers set settings = $1 where id = $2`, [JSON.stringify({ 'settlement.groupBy': 'MANUAL' }), seller.sellerId])
    const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid() })
    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ error: { code: 'NOT_SUPPORTED' } })
    expect(await countRows(world.database, 'events')).toBe(0)
  })

  it('상태 형식 오류(엔진이 StateFormatError)는 기록하지 않고 4xx, 메모리 상태를 버리고 다시 불러온다', async () => {
    const { StateFormatError } = await import('@livejjim/core')
    let throwFormat = false
    const world = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          if (throwFormat) throw new StateFormatError(3, '3')
          return applyEvent(state, event)
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    throwFormat = true
    const response = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ error: { code: 'STATE_FORMAT' } })
    expect(await countRows(world.database, 'events')).toBe(1)
    throwFormat = false
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
  })
})

describe('AC-S04-23 저장이 끝나기 전엔 결과가 나가지 않는다', () => {
  it('커밋 실패 주입: "저장하지 못했어요", 알림·메모리 변화·로그 행 없음, 같은 요청 번호로 다시 보내면 정상', async () => {
    let fail = false
    const world = await newWorld({
      hooks: {
        beforeCommit: () => {
          if (fail) throw new Error('디스크가 가득 찼다')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const notices: unknown[] = []
    const publish = world.server.hub.publish.bind(world.server.hub)
    world.server.hub.publish = (sellerId, items) => {
      notices.push(...items)
      publish(sellerId, items)
    }
    const state = await memoryState(world, seller.sellerId, b.date)
    fail = true
    const requestId = rid('pay')
    const body = { requestId, type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }
    const failed = await client(world, seller.cookie).post('/api/events', body)
    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요. 다시 시도해 주세요.' } })
    expect(notices).toEqual([])
    expect(await memoryState(world, seller.sellerId, b.date)).toBe(state)
    expect(await countRows(world.database, 'events')).toBe(1)
    expect(world.logs.map((log) => log.code)).toContain('SAVE_FAILED')
    fail = false
    const retried = await expectOk(client(world, seller.cookie).post('/api/events', body))
    expect(retried.body).toMatchObject({ seq: 2, changed: true })
    expect(notices).toEqual([{ date: b.date, rehearsal: false, seq: 2, type: 'product.register' }])
  })

  it('커밋 직후 응답 전에 멈춰도(새 인스턴스를 같은 DB로) 그 입력의 결과가 남아 있다', async () => {
    let crash = false
    const world = await newWorld({
      hooks: {
        afterCommit: () => {
          if (crash) throw new Error('프로세스가 멈췄다')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    crash = true
    const response = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 7, name: '살아남음', price: 3000 })
    expect(response.status).toBe(500)
    const fresh = startServer(world.database, world.masterKey)
    const view = await client(fresh, seller.cookie).get(`/api/days/${b.date}`)
    expect((view.body.products as { no: number; name: string }[]).map((p) => [p.no, p.name])).toEqual([[7, '살아남음']])
    // 멈췄던 인스턴스도 다음에 읽을 때 로그에서 따라잡는다
    const old = await client(world, seller.cookie).get(`/api/days/${b.date}`)
    expect(old.body.seq).toBe(2)
  })
})

describe('AC-S04-24 엔진이 처리하지 못한 입력', () => {
  it('실패 표시로 기록(seq 차지), 상태·발송함 그대로, "처리하지 못했어요", 경보, 확인 필요 목록, 다음 입력은 평소대로', async () => {
    let boom = false
    const world = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          if (boom && event.type === 'product.register') throw new RangeError('엔진 버그 010-9999-8888')
          return applyEvent(state, event)
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const state = await memoryState(world, seller.sellerId, b.date)
    boom = true
    const response = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ date: b.date, seq: 2, error: { code: 'PROCESSING_FAILED', message: '처리하지 못했어요. 확인 필요 목록에 남겼어요.' } })
    expect(await memoryState(world, seller.sellerId, b.date)).toBe(state)
    expect(await countRows(world.database, 'outbox')).toBe(0)
    expect(world.logs).toContainEqual({ level: 'error', code: 'ENGINE_FAILED', date: b.date, seq: 2, errorKind: 'RangeError' })
    expect(JSON.stringify(world.logs)).not.toContain('9999')
    const view = await client(world, seller.cookie).get(`/api/days/${b.date}`)
    expect(view.body.attention).toEqual([{ seq: 2, message: FAILED_INPUT_MESSAGE }])
    boom = false
    const next = await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
    expect(next.body).toMatchObject({ seq: 3, changed: true })
    const history = await client(world, seller.cookie).get(`/api/days/${b.date}/history`)
    expect((history.body.events as { seq: number; failed: boolean }[]).map((e) => [e.seq, e.failed])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ])
  })

  it('재시작·재생은 실패 표시된 입력을 건너뛰어 같은 상태가 된다', async () => {
    let boom = true
    const world = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          if (boom && event.type === 'host.blockBuyer') throw new Error('x')
          return applyEvent(state, event)
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UC9', reason: '욕설' }, b.date)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
    boom = false
    const before = await client(world, seller.cookie).get(`/api/days/${b.date}`)
    // 새 인스턴스(진짜 엔진)도 실패 표시를 보고 건너뛴다 — 차단은 걸리지 않는다
    const fresh = startServer(world.database, world.masterKey)
    const after = await client(fresh, seller.cookie).get(`/api/days/${b.date}`)
    expect(after.body).toEqual(before.body)
    expect((after.body.buyers as unknown[]).length).toBe(0)
  })

  it('실패 표시가 없는데 재생에서 오류가 나는 입력도 건너뛰고 경보하며 그 뒤를 계속 재생한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 2, name: 'b', price: 1 }))
    const fresh = startServer(world.database, world.masterKey, {
      engine: {
        applyEvent: (state, event) => {
          if (event.seq === 2) throw new TypeError('새 코드의 버그')
          return applyEvent(state, event)
        },
      },
    })
    const view = await client(fresh, seller.cookie).get(`/api/days/${b.date}`)
    expect((view.body.products as { no: number }[]).map((p) => p.no)).toEqual([2])
    expect(view.body.attention).toEqual([{ seq: 2, message: REPLAY_SKIPPED_MESSAGE }])
    expect(fresh.logs).toContainEqual({ level: 'error', code: 'REPLAY_SKIPPED', date: b.date, seq: 2, errorKind: 'TypeError' })
  })
})

describe('AC-S04-30 발송함', () => {
  it('효과마다 발송함 행 하나 — 내용은 엔진 효과 그대로, 재시작·재생·재전송으로 늘지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크프릴', price: 10000 }))
    const chat = await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '영희', text: '1' })
    expect(chat).toMatchObject({ status: 'recorded', effects: ['c1:PRINT_PRODUCT_LABEL:-:1', 'c1:POST_THANKS:LIVE_CHAT:1'] })
    const rows = await world.database.pglite?.query<{ effect_id: string; seq: number; kind: string; body: string }>(`select effect_id, seq, kind, body from outbox order by id`)
    const state = await memoryState(world, seller.sellerId, b.date)
    expect(rows?.rows.map((row) => row.effect_id)).toEqual(['c1:PRINT_PRODUCT_LABEL:-:1', 'c1:POST_THANKS:LIVE_CHAT:1'])
    expect(rows?.rows.every((row) => row.seq === 3)).toBe(true)
    // 내용 = 엔진 효과 (같은 로그를 코어로 재생해 낸 효과)
    const replayed = applyEvent(
      applyEvent(applyEvent(initEngine({ broadcasts: [], settings: {} }), JSON.parse((await world.database.pglite?.query<{ body: string }>(`select body from events where seq = 1`))?.rows[0]?.body ?? '') as EngineEvent).state, JSON.parse((await world.database.pglite?.query<{ body: string }>(`select body from events where seq = 2`))?.rows[0]?.body ?? '') as EngineEvent).state,
      JSON.parse((await world.database.pglite?.query<{ body: string }>(`select body from events where seq = 3`))?.rows[0]?.body ?? '') as EngineEvent,
    )
    expect(rows?.rows.map((row) => JSON.parse(row.body) as unknown)).toEqual(replayed.effects)
    expect(state).toEqual(replayed.state)
    // 같은 채팅 재수신·재시작·재생
    expect(await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '영희', text: '1' })).toEqual({ status: 'duplicate' })
    const fresh = startServer(world.database, world.masterKey)
    await client(fresh, seller.cookie).get(`/api/days/${b.date}`)
    expect(await countRows(world.database, 'outbox')).toBe(2)
    const effects = (await client(fresh, seller.cookie).get(`/api/days/${b.date}`)).body.effects as { id: string; status: string }[]
    expect(effects.map((effect) => [effect.id, effect.status])).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'PENDING'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'PENDING'],
    ])
  })
})
