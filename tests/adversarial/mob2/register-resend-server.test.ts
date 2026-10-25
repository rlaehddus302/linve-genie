// MOB2 적대 시험 (test-domain) — AC-MOB2-40 · D-MOB2-14 · NFR-03 (SA-MOB2-03 · TE-MOB2-006 · RA-MOB2-06)
// 저절로 다시 보내는 빠른 입력 등록은 화면을 미리 보지 않고 처음 요청 번호로 한 번 보내 서버 답으로 판단한다(D-MOB2-14).
// 그 결정이 기대는 서버 성질을 실제 서버 + PGlite로 공격한다:
//   (가) 끊긴 사이 다른 기기가 같은 번호를 먼저 등록 → 다시 보낸 등록은 changed:false, 다른 기기의 15번(청보석 20,000원)·재고·판정 그대로
//   (나) 처음 요청이 기록되고 응답만 잃음 → 다른 기기가 그 뒤 같은 번호를 보내도 changed:false, 다시 보낸 등록은 처음 결과(changed:true·같은 seq)
//   (다) 다시 보내기와 다른 기기 등록이 동시에 → 상품은 하나, changed:true는 정확히 하나, 상품 내용 = 그 쪽 본문
// 어느 경우든 같은 요청 번호의 기록은 많아야 하나, 보류 찜 판정(1등)은 한 번만이다.
import { afterEach, describe, expect, it } from 'vitest'
import { call, harness, rid, startBroadcast, type Harness, type Res } from '../s04/helpers.ts'

const DAY = '2026-10-18'
const open: Harness[] = []
afterEach(async () => {
  for (const h of open.splice(0)) await h.close()
})

interface World {
  readonly h: Harness
  readonly cookie: string
  readonly sellerId: string
  readonly b: string
}

const post = (w: World, body: Record<string, unknown>): Promise<Res> => call(w.h.server, w.cookie, 'POST', '/api/events', body)

async function ok(res: Promise<Res>): Promise<Res> {
  const r = await res
  expect(r.status, r.text).toBe(200)
  return r
}

let n = 0
async function world(): Promise<World> {
  const h = await harness()
  open.push(h)
  const { sellerId, cookie } = await h.account(`mob2rr${String(++n)}${String(Date.now() % 100000)}`)
  const b = await startBroadcast(h.server, cookie, DAY)
  const w = { h, cookie, sellerId, b }
  // 번호 15에 보류 찜 둘(등록하는 순간 판정된다)
  for (const ch of ['UCrr1', 'UCrr2']) {
    const outcome = await h.server.ingestChat(sellerId, { b, id: `rr${ch}${String(n)}`, ch, nick: `시청자${ch}`, text: '15' })
    expect(outcome.status).toBe('recorded')
    h.clock.t += 1000
  }
  return w
}

const MINE = (w: World): Record<string, unknown> => ({ type: 'product.register', b: w.b, no: 15, name: '핑크프릴', price: 10000, stock: 1 })
const OTHER = (w: World): Record<string, unknown> => ({ type: 'product.register', b: w.b, no: 15, name: '청보석', price: 20000, stock: 1 })

interface Day {
  products: { no: number; name: string; price: number; stock: number }[]
  claims: { status: string; reason: string | null; no: number }[]
}
async function day(w: World): Promise<Day> {
  return (await ok(call(w.h.server, w.cookie, 'GET', `/api/days/${DAY}`))).body as unknown as Day
}

async function eventsWith(w: World, requestId: string): Promise<number> {
  const pg = w.h.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  return Number(((await pg.query<{ n: string | number }>('select count(*) as n from events where request_id = $1', [requestId])).rows[0] as { n: string | number }).n)
}

function judged(d: Day): { confirmed: number; waiting: number; pending: number } {
  const on15 = d.claims.filter((c) => c.no === 15)
  return {
    confirmed: on15.filter((c) => c.status === 'CONFIRMED').length,
    waiting: on15.filter((c) => c.status === 'WAITLISTED').length,
    pending: on15.filter((c) => c.status === 'PENDING').length,
  }
}

describe('D-MOB2-14 저절로 다시 보낸 등록 — 서버 답이 진실', () => {
  for (const restart of [false, true]) {
    it(`TE-MOB2-006 (가) 끊긴 사이 다른 기기가 15번을 먼저 등록 → 다시 보낸 등록은 changed:false, 청보석 20,000원 그대로${restart ? ' (서버 다시 켬)' : ''}`, async () => {
      const w = await world()
      const mine = rid('mine')
      // 처음 요청은 서버에 닿지 못했다(끊김). 그 사이 다른 기기가 15번 등록
      const other = await ok(post(w, { ...OTHER(w), requestId: rid('other') }))
      expect(other.body.changed).toBe(true)
      const before = await day(w)
      expect(judged(before).confirmed).toBe(1)
      w.h.clock.t += 7000
      const server = restart ? w.h.restart() : w.h.server
      const again = await ok(call(server, w.cookie, 'POST', '/api/events', { ...MINE(w), requestId: mine }))
      expect(again.body.changed, '이미 있는 번호 — 바꾸지 않았다고 답해야 화면이 한 줄 안내만 낸다').toBe(false)
      const after = await day(w)
      const p15 = after.products.filter((p) => p.no === 15)
      expect(p15).toHaveLength(1)
      expect(p15[0]).toMatchObject({ name: '청보석', price: 20000, stock: 1 })
      expect(judged(after)).toEqual(judged(before))
      expect(await eventsWith(w, mine)).toBeLessThanOrEqual(1)
      // 같은 요청 번호로 또 보내도(다음 연결 회복) 같은 답, 기록 늘지 않음
      const third = await ok(post(w, { ...MINE(w), requestId: mine }))
      expect(third.body.changed).toBe(false)
      expect(await eventsWith(w, mine)).toBeLessThanOrEqual(1)
      expect((await day(w)).products.filter((p) => p.no === 15)[0]).toMatchObject({ name: '청보석', price: 20000 })
    })

    it(`RA-MOB2-06 (나) 응답만 잃은 자기 등록 → 다른 기기의 같은 번호는 changed:false, 다시 보내면 처음 결과(changed:true·같은 seq)${restart ? ' (서버 다시 켬)' : ''}`, async () => {
      const w = await world()
      const mine = rid('mine')
      const first = await ok(post(w, { ...MINE(w), requestId: mine })) // 응답은 화면에 닿지 않았다
      expect(first.body.changed).toBe(true)
      w.h.clock.t += 2000
      const other = await ok(post(w, { ...OTHER(w), requestId: rid('other') }))
      expect(other.body.changed).toBe(false)
      w.h.clock.t += 5000
      const server = restart ? w.h.restart() : w.h.server
      const again = await ok(call(server, w.cookie, 'POST', '/api/events', { ...MINE(w), requestId: mine }))
      expect(again.body.changed, '자기 등록이 이미 기록됐으면 처음 결과 — 화면은 평소 성공처럼').toBe(true)
      expect(again.body.seq).toBe(first.body.seq)
      expect(await eventsWith(w, mine)).toBe(1)
      const d = await day(w)
      expect(d.products.filter((p) => p.no === 15)).toEqual([expect.objectContaining({ name: '핑크프릴', price: 10000 })])
      expect(judged(d)).toEqual({ confirmed: 1, waiting: 1, pending: 0 })
    })
  }

  it('(다) 다시 보내기와 다른 기기 등록이 동시에 (두 인스턴스) — 상품 하나, changed:true 정확히 하나, 내용은 그 쪽 본문, 판정 한 번', async () => {
    for (let round = 0; round < 6; round++) {
      const w = await world()
      const mine = rid('mine')
      const second = w.h.restart()
      const [a, b] = await Promise.all([
        ok(post(w, { ...MINE(w), requestId: mine })),
        ok(call(second, w.cookie, 'POST', '/api/events', { ...OTHER(w), requestId: rid('other') })),
      ])
      const wins = [a, b].filter((r) => r.body.changed === true)
      expect(wins, `round ${String(round)}`).toHaveLength(1)
      const d = await day(w)
      const p15 = d.products.filter((p) => p.no === 15)
      expect(p15).toHaveLength(1)
      expect(p15[0]?.name).toBe(a.body.changed === true ? '핑크프릴' : '청보석')
      expect(judged(d)).toEqual({ confirmed: 1, waiting: 1, pending: 0 })
      // 진 쪽 다시 보내기는 같은 답(changed:false) — 화면은 창 없이 한 줄 안내
      if (a.body.changed !== true) expect((await ok(post(w, { ...MINE(w), requestId: mine }))).body.changed).toBe(false)
      await w.h.close()
      open.splice(open.indexOf(w.h), 1)
    }
  })
})
