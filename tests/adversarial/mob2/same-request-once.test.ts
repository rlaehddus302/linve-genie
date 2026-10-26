// MOB2 적대 시험 (test-domain) — AC-MOB2-46 · NFR-03 · D-MOB2-07
// 연결이 돌아오면 화면이 못 보낸 쓰기를 "처음 요청 번호 그대로" 다시 보낸다. 서버는 같은 요청 번호를 한 번만 기록해야 한다.
// 서버 + 실제 DB(PGlite, S04 하네스): product.register · host.cancel · product.hold · 문자찜(sms)을
//   (a) 응답을 잃은 뒤 다시 — 같은 인스턴스, 그리고 기록 직후 프로세스가 죽어 새 인스턴스가 받는 경우
//   (b) 서로 겹치게 동시에 둘 — 같은 인스턴스·두 인스턴스
//   (c) 10번 — 동시에 10개(세 인스턴스에 나눠)
// 로 보낸 뒤 이벤트 기록은 하나, outbox(라벨·감사 효과)와 출력 작업·라벨 키도 한 번 보낸 것과 같고, 모든 응답이 첫 응답과 같은 결과(seq·changed·효과)다.
// 같은 요청 번호에 다른 본문이면 지금 규칙(AC-S04-25 — 내용이 달라도 처음 결과, 새 기록 없음) 그대로.
import type { LivejjimServer } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { call, harness, rid, startBroadcast, type Harness, type Res } from '../s04/helpers.ts'

const DAY = '2026-10-18'
const PHONE_A = '010-2222-3456'
const PHONE_B = '010-7777-8888'

type Op = 'product.register' | 'host.cancel' | 'product.hold' | 'sms'
type Mode = 'lost-same' | 'lost-restart' | 'pair-same' | 'pair-two' | 'ten'

interface World {
  readonly h: Harness
  readonly cookie: string
  readonly sellerId: string
  readonly b: string
}

const open: Harness[] = []
afterEach(async () => {
  for (const h of open.splice(0)) await h.close()
})

let chatNo = 0
async function chat(world: World, ch: string): Promise<void> {
  const outcome = await world.h.server.ingestChat(world.sellerId, { b: world.b, id: `mob2m${String(++chatNo)}`, ch, nick: `시청자${ch}`, text: '15' })
  expect(outcome.status).toBe('recorded')
}

const post = (server: LivejjimServer, cookie: string, body: Record<string, unknown>): Promise<Res> => call(server, cookie, 'POST', '/api/events', body)

async function ok(res: Promise<Res> | Res): Promise<Res> {
  const r = await res
  expect(r.status, r.text).toBe(200)
  return r
}

async function claimsOf(world: World): Promise<{ id: string; buyer: string; status: string; reason: string | null; no: number }[]> {
  const r = await ok(call(world.h.server, world.cookie, 'GET', `/api/days/${DAY}`))
  return r.body.claims as { id: string; buyer: string; status: string; reason: string | null; no: number }[]
}

/** 시험할 쓰기 하나와 그 전 상태를 만든다. 쓰기 본문(요청 번호 없음)을 돌려준다 */
async function prepare(op: Op): Promise<{ world: World; body: Record<string, unknown> }> {
  const h = await harness()
  open.push(h)
  const { sellerId, cookie } = await h.account(`mob2${String(open.length)}${String(Date.now() % 100000)}`)
  const b = await startBroadcast(h.server, cookie, DAY)
  const world: World = { h, cookie, sellerId, b }
  const tick = (): void => {
    h.clock.t += 1000
  }
  switch (op) {
    case 'product.register': {
      // 등록하는 순간 보류 찜(문자찜·채팅)이 판정된다 — 그 쓰기 하나가 라벨·감사 효과를 낸다
      await ok(post(h.server, cookie, { requestId: rid('pre'), type: 'sms', b, no: 15, phone: PHONE_A, memo: '김씨' }))
      tick()
      await chat(world, 'UCmob2a')
      tick()
      return { world, body: { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000, stock: 1 } }
    }
    case 'host.cancel': {
      await ok(post(h.server, cookie, { requestId: rid('pre'), type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000, stock: 1 }))
      tick()
      await chat(world, 'UCmob2a')
      tick()
      await chat(world, 'UCmob2b')
      tick()
      const first = (await claimsOf(world)).find((c) => c.status === 'CONFIRMED')
      expect(first).toBeDefined()
      return { world, body: { type: 'host.cancel', b, no: 15, buyer: first?.buyer, reason: '판매자 취소' } }
    }
    case 'product.hold': {
      await ok(post(h.server, cookie, { requestId: rid('pre'), type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000, stock: 2 }))
      tick()
      await chat(world, 'UCmob2a')
      tick()
      return { world, body: { type: 'product.hold', b, no: 15 } }
    }
    case 'sms': {
      await ok(post(h.server, cookie, { requestId: rid('pre'), type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000, stock: 1 }))
      tick()
      return { world, body: { type: 'sms', b, no: 15, phone: PHONE_B, memo: '이씨', received: '20:01' } }
    }
  }
}

interface Counts {
  events: number
  outbox: number
  outboxKinds: string
  printJobs: number
  printLabels: number
}

async function counts(world: World): Promise<Counts> {
  const pg = world.h.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  const one = async (q: string): Promise<number> => Number(((await pg.query<{ n: string | number }>(q)).rows[0] as { n: string | number }).n)
  const kinds = (await pg.query<{ kind: string }>('select kind from outbox order by id')).rows.map((r) => r.kind)
  return {
    events: await one('select count(*) as n from events'),
    outbox: await one('select count(*) as n from outbox'),
    outboxKinds: kinds.join(','),
    printJobs: await one('select count(*) as n from print_jobs'),
    printLabels: await one('select count(*) as n from print_labels'),
  }
}

async function eventsWithRequest(world: World, requestId: string): Promise<number> {
  const pg = world.h.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  return Number(((await pg.query<{ n: string | number }>('select count(*) as n from events where request_id = $1', [requestId])).rows[0] as { n: string | number }).n)
}

/** 같은 요청 번호로 보낸다. 응답 목록(처음 것이 [0]이 아닐 수 있다 — 동시) */
async function send(world: World, mode: Mode, body: Record<string, unknown>, requestId: string): Promise<Res[]> {
  const full = { ...body, requestId }
  const { h, cookie } = world
  switch (mode) {
    case 'lost-same': {
      await ok(post(h.server, cookie, full)) // 응답은 화면에 닿지 않았다(끊김)
      h.clock.t += 7000
      return [await post(h.server, cookie, full)]
    }
    case 'lost-restart': {
      await ok(post(h.server, cookie, full)) // 기록 직후 서버가 죽었다
      h.clock.t += 7000
      const second = h.restart()
      return [await post(second, cookie, full)]
    }
    case 'pair-same':
      return Promise.all([post(h.server, cookie, full), post(h.server, cookie, full)])
    case 'pair-two': {
      const other = h.restart()
      return Promise.all([post(h.server, cookie, full), post(other, cookie, full)])
    }
    case 'ten': {
      const servers = [h.server, h.restart(), h.restart()]
      return Promise.all(Array.from({ length: 10 }, (_, i) => post(servers[i % servers.length] as LivejjimServer, cookie, full)))
    }
  }
}

/** 한 번만 보냈을 때의 증가분 (같은 준비, 다른 DB) */
const soloCache = new Map<Op, { delta: Counts; body: Record<string, unknown> }>()
async function solo(op: Op): Promise<{ delta: Counts; body: Record<string, unknown> }> {
  const cached = soloCache.get(op)
  if (cached !== undefined) return cached
  const { world, body } = await prepare(op)
  const before = await counts(world)
  const res = await ok(post(world.h.server, world.cookie, { ...body, requestId: rid('solo') }))
  const after = await counts(world)
  const value = { delta: diff(before, after), body: res.body }
  soloCache.set(op, value)
  return value
}

function diff(before: Counts, after: Counts): Counts {
  return {
    events: after.events - before.events,
    outbox: after.outbox - before.outbox,
    outboxKinds: after.outboxKinds.slice(before.outboxKinds.length).replace(/^,/, ''),
    printJobs: after.printJobs - before.printJobs,
    printLabels: after.printLabels - before.printLabels,
  }
}

/** 응답 본문에서 비교할 결과 (seq·changed·효과·종류, 문자찜이면 구매자·끝 네 자리) */
const outcomeOf = (r: Res): Record<string, unknown> => {
  const { date, rehearsal, seq, type, changed, effects, buyer, phoneLast4 } = r.body
  return { date, rehearsal, seq, type, changed, effects, buyer, phoneLast4 }
}

const OPS: readonly Op[] = ['product.register', 'host.cancel', 'product.hold', 'sms']
const MODES: readonly Mode[] = ['lost-same', 'lost-restart', 'pair-same', 'pair-two', 'ten']

describe('AC-MOB2-46 같은 요청 번호는 한 번만 기록한다', () => {
  for (const op of OPS) {
    it(`${op}: 한 번 보낸 것의 모양 확인 (효과가 실제로 생기는 준비인지)`, async () => {
      const { delta } = await solo(op)
      expect(delta.events).toBe(1)
      if (op !== 'product.hold') {
        // 1등이 바뀌는 쓰기 — 라벨 효과와 출력 작업이 생겨야 이 시험이 뜻이 있다
        expect(delta.outboxKinds).toContain('PRINT_PRODUCT_LABEL')
        expect(delta.printJobs).toBeGreaterThan(0)
      }
    })

    for (const mode of MODES) {
      it(`${op} × ${mode}: 기록 하나·효과 한 번·응답 모두 같은 결과`, async () => {
        const reference = await solo(op)
        const { world, body } = await prepare(op)
        const before = await counts(world)
        const requestId = rid(`once-${mode}`)
        const responses = await send(world, mode, body, requestId)
        for (const r of responses) expect(r.status, `${mode} ${r.text}`).toBe(200)
        const after = await counts(world)
        const delta = diff(before, after)
        expect(await eventsWithRequest(world, requestId)).toBe(1)
        expect(delta.events, '이벤트 기록').toBe(1)
        expect(delta.outbox, 'outbox(라벨·감사 효과)').toBe(reference.delta.outbox)
        expect(delta.outboxKinds).toBe(reference.delta.outboxKinds)
        expect(delta.printJobs, '출력 작업').toBe(reference.delta.printJobs)
        expect(delta.printLabels, '라벨 키').toBe(reference.delta.printLabels)
        // 모든 응답이 같은 결과 (첫 응답 = 기록한 응답)
        const outcomes = responses.map(outcomeOf)
        for (const o of outcomes) expect(o).toEqual(outcomes[0])
        expect(outcomes[0]?.changed).toBe(reference.body.changed)
        expect((outcomes[0]?.effects as unknown[]).length).toBe((reference.body.effects as unknown[]).length)
        // 기록한 seq의 이벤트가 바로 그 요청의 것
        const history = await ok(call(world.h.server, world.cookie, 'GET', `/api/days/${DAY}`))
        expect(history.body.seq).toBe(outcomes[0]?.seq)
      })
    }

    it(`${op}: 같은 요청 번호에 다른 본문 — 처음 결과 그대로, 새 기록 없음 (AC-S04-25, 이 스프린트 전과 같음)`, async () => {
      const { world, body } = await prepare(op)
      const requestId = rid('reuse')
      const first = await ok(post(world.h.server, world.cookie, { ...body, requestId }))
      const before = await counts(world)
      const changedBody = op === 'sms' ? { ...body, no: 16, memo: '다른 사람' } : op === 'product.register' ? { ...body, price: 99000 } : { ...body, no: 99 }
      const again = await post(world.h.server, world.cookie, { ...changedBody, requestId })
      expect(again.status, again.text).toBe(200)
      expect(outcomeOf(again)).toEqual(outcomeOf(first))
      expect(diff(before, await counts(world))).toEqual({ events: 0, outbox: 0, outboxKinds: '', printJobs: 0, printLabels: 0 })
    })
  }

  it('같은 요청 번호를 실제 범위와 리허설 범위에 동시에 — 판매자 안에서 하나만 기록 (다른 범위 락을 지나도 유일 제약이 막는다)', async () => {
    const { world, body } = await prepare('product.hold')
    const rehearsalB = ((await ok(call(world.h.server, world.cookie, 'POST', '/api/broadcasts', { requestId: rid('rb'), date: DAY, rehearsal: true }))).body.broadcast as { id: string }).id
    await ok(call(world.h.server, world.cookie, 'POST', `/api/events`, { requestId: rid('rpre'), type: 'product.register', b: rehearsalB, no: 15, name: '핑크프릴', price: 10000 }))
    const before = await counts(world)
    const requestId = rid('cross')
    const other = world.h.restart()
    const [real, rehearsal] = await Promise.all([
      post(world.h.server, world.cookie, { ...body, requestId }),
      call(other, world.cookie, 'POST', `/api/events`, { type: 'product.hold', b: rehearsalB, no: 15, requestId }),
    ])
    expect(real.status, real.text).toBe(200)
    expect(rehearsal.status, rehearsal.text).toBe(200)
    expect(outcomeOf(real)).toEqual(outcomeOf(rehearsal))
    expect(await eventsWithRequest(world, requestId)).toBe(1)
    expect(diff(before, await counts(world)).events).toBe(1)
  })
})
