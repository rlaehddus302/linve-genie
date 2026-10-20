// S06b 적대 테스트 (test-domain): 서버 — 합치기 미리 보기 조회(AC-S06b-10), 문자찜 응답 buyer(AC-S06b-11), 보기 캐시 상한(AC-S06b-12).
// 판매 뒤 장부 정리에서 나올 법한 순서로 공격한다:
// - 두 인스턴스(PC·휴대폰이 다른 서버 인스턴스에 붙음): 한쪽에서 취소한 뒤 다른 쪽 미리 보기가 따라잡은 상태·seq로 답한다
// - 다른 판매자: 그 판매자 구매자 ID를 내 범위에서 물어도 모르는 구매자, 없는 범위·다른 판매자 범위는 같은 404
// - 휴대폰 번호 모양 ID(여러 표기) → 400, 응답·로그·DB 어디에도 번호가 없다
// - 쓰기와 겹친 미리 보기: 응답 seq의 상태로 계산한 값과 같다
// - 문자찜 buyer: 전화번호로 이은 구매자가 유튜브 구매자에 합쳐진 뒤에도 구매자 자신, 떼어 내기·재시작 뒤 재전송도 같다
// - 보기 캐시: 한 판매자가 실제·리허설 범위를 오가며 많이 조회해도 다른 판매자의 캐시가 그대로, 비운 뒤 증분 조회가 같은 값
import { previewMerge } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { call, dumpAll, event, harness, rid, type Harness, type Res } from '../s04/helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const DAY = '2026-10-18'
const path = (from: string, into: string, rehearsal = false, date = DAY): string =>
  `/api/days/${date}/merge-preview?from=${encodeURIComponent(from)}&into=${encodeURIComponent(into)}${rehearsal ? '&rehearsal=true' : ''}`

async function ok(res: Promise<Res> | Res): Promise<Res> {
  const r = await res
  expect(r.status, r.text).toBe(200)
  return r
}

async function broadcast(h: Harness, cookie: string, date: string, rehearsal = false): Promise<string> {
  const res = await ok(call(h.server, cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date, rehearsal }))
  return (res.body.broadcast as { id: string }).id
}

/** G-ENG-174 모양 판매: 18·19번에 A와 문자 구매자 X가 둘 다 1등(재고 2), 16번 B 1등·X 대기 */
async function sale(h: Harness, cookie: string, sellerId: string, rehearsal = false): Promise<{ b: string; x: string }> {
  const b = await broadcast(h, cookie, DAY, rehearsal)
  for (const [no, stock] of [
    [16, 1],
    [18, 2],
    [19, 2],
  ] as const) {
    await ok(event(h.server, cookie, { type: 'product.register', b, no, name: '핑크프릴', price: 1000 * no, stock }, undefined))
  }
  await h.server.ingestChat(sellerId, { b, id: `a-${b}`, ch: 'UC_A', nick: '홍길동', text: '18 19' })
  await h.server.ingestChat(sellerId, { b, id: `b-${b}`, ch: 'UC_B', nick: '영희', text: '16' })
  const first = await ok(event(h.server, cookie, { type: 'sms', b, no: 18, phone: '010-1111-5678', memo: '김씨' }))
  const x = first.body.buyer as string
  await ok(event(h.server, cookie, { type: 'sms', b, no: 19, phone: '010-1111-5678' }))
  await ok(event(h.server, cookie, { type: 'sms', b, no: 16, phone: '010-1111-5678' }))
  return { b, x }
}

describe('AC-S06b-10 합치기 미리 보기 조회 — 공격', () => {
  it('두 인스턴스: 1번 인스턴스에서 막힘을 푼 뒤 2번 인스턴스의 미리 보기는 따라잡은 seq·상태로 답한다', async () => {
    h = await harness()
    const a = await h.account('mp1')
    const { b, x } = await sale(h, a.cookie, a.sellerId)
    const second = h.restart()
    const before = await ok(call(second, a.cookie, 'GET', path(x, 'UC_A')))
    expect((before.body.preview as { blocked: string }).blocked).toBe('BOTH_CONFIRMED')
    // 1번 인스턴스(h.server)에서 한쪽씩 취소
    await ok(event(h.server, a.cookie, { type: 'host.cancel', b, no: 18, buyer: x, reason: '중복' }))
    const last = await ok(event(h.server, a.cookie, { type: 'host.cancel', b, no: 19, buyer: 'UC_A', reason: '중복' }))
    const after = await ok(call(second, a.cookie, 'GET', path(x, 'UC_A')))
    expect(after.body.seq).toBe(last.body.seq)
    const state = (await second.writer.read(a.sellerId, DAY)).state
    expect(after.body.preview).toEqual(previewMerge(state, x, 'UC_A'))
    expect((after.body.preview as { blocked: unknown }).blocked).toBeNull()
    // 2번 인스턴스에서 합치면 미리 본 대로
    const merged = await ok(call(second, a.cookie, 'POST', `/api/events?date=${DAY}`, { requestId: rid('mg'), type: 'buyer.merge', from: x, into: 'UC_A', reason: '같은 사람' }))
    expect(merged.body.changed).toBe(true)
    const view = await ok(call(h.server, a.cookie, 'GET', `/api/days/${DAY}`))
    const dup = (view.body.claims as { id: string; status: string }[]).filter((c) => c.status === 'DUPLICATE').map((c) => c.id)
    expect(dup).toEqual((after.body.preview as { duplicates: { claim: string }[] }).duplicates.map((d) => d.claim))
  })

  it('다른 판매자: 그 판매자의 구매자 ID를 내 범위에서 물으면 모르는 구매자, 그 판매자에게만 있는 날짜는 없는 날짜와 같은 404', async () => {
    h = await harness()
    const a = await h.account('mpa')
    const other = await h.account('mpb')
    await sale(h, other.cookie, other.sellerId)
    const otherX = ((await ok(call(h.server, other.cookie, 'GET', `/api/days/${DAY}`))).body.buyers as { id: string }[]).map((x) => x.id).find((id) => id.startsWith('sms:')) as string
    // a는 같은 날짜에 자기 범위가 있다 (UC_A만 있음)
    const b = await broadcast(h, a.cookie, DAY)
    await h.server.ingestChat(a.sellerId, { b, id: 'z1', ch: 'UC_A', nick: '홍길동', text: '안녕' })
    for (const [from, into] of [
      [otherX, 'UC_A'],
      ['UC_A', otherX],
      ['UC_B', 'UC_A'],
    ] as const) {
      const res = await ok(call(h.server, a.cookie, 'GET', path(from, into)))
      expect((res.body.preview as { blocked: string }).blocked, `${from} → ${into}`).toBe('UNKNOWN_BUYER')
      expect(res.body.preview).toMatchObject({ duplicates: [], after: null, moving: { items: [], subtotal: 0 } })
      expect((res.body.preview as { moving: { buyers: string[] } }).moving.buyers).toEqual(from === 'UC_A' ? ['UC_A'] : [])
    }
    // 다른 판매자만 범위가 있는 날짜(그 판매자 리허설 포함) vs 아무도 없는 날짜 → 같은 응답
    await broadcast(h, other.cookie, '2026-10-19', true)
    const theirs = await call(h.server, a.cookie, 'GET', path(otherX, 'UC_A', true, '2026-10-19'))
    const nobody = await call(h.server, a.cookie, 'GET', path(otherX, 'UC_A', true, '2026-10-21'))
    const dayTheirs = await call(h.server, a.cookie, 'GET', `/api/days/2026-10-19?rehearsal=true`)
    expect(theirs.status).toBe(404)
    expect([theirs.text, theirs.headers.get('content-type')]).toEqual([nobody.text, nobody.headers.get('content-type')])
    expect([theirs.status, theirs.text]).toEqual([dayTheirs.status, dayTheirs.text])
  })

  it('리허설 범위와 실제 범위는 섞이지 않는다: 리허설에만 있는 문자 구매자는 실제 범위에서 모르는 구매자', async () => {
    h = await harness()
    const a = await h.account('mpr')
    const { x: rx } = await sale(h, a.cookie, a.sellerId, true)
    const realB = await broadcast(h, a.cookie, DAY)
    await h.server.ingestChat(a.sellerId, { b: realB, id: 'r1', ch: 'UC_A', nick: '홍길동', text: '안녕' })
    const real = await ok(call(h.server, a.cookie, 'GET', path(rx, 'UC_A')))
    expect(real.body).toMatchObject({ rehearsal: false, preview: { blocked: 'UNKNOWN_BUYER' } })
    const reh = await ok(call(h.server, a.cookie, 'GET', path(rx, 'UC_A', true)))
    expect(reh.body).toMatchObject({ rehearsal: true, preview: { blocked: 'BOTH_CONFIRMED' } })
    expect(real.body.seq).not.toBe(reh.body.seq)
  })

  it('휴대폰 번호 모양 ID(여러 표기)는 400 — 응답·로그·DB에 번호가 없고, 날짜 형식이 틀리면 그보다 먼저 404', async () => {
    h = await harness()
    const a = await h.account('mpp')
    await sale(h, a.cookie, a.sellerId)
    const phones = ['01098765432', '010-9876-5432', '010 9876 5432', '(010)9876-5432', '010.9876.5432']
    for (const phone of phones) {
      for (const [from, into, field] of [
        [phone, 'UC_A', 'from'],
        ['UC_A', phone, 'into'],
      ] as const) {
        const res = await call(h.server, a.cookie, 'GET', path(from, into))
        expect(res.status, `${from} → ${into}`).toBe(400)
        const error = res.body.error as { code: string; problems: { field: string }[] }
        expect(error.code).toBe('INVALID_INPUT')
        expect((error.problems as { field: string }[]).map((p) => p.field)).toEqual([field])
        expect(res.text).not.toMatch(/9876|5432/)
      }
      const both = await call(h.server, a.cookie, 'GET', path(phone, phone))
      expect(((both.body.error as { problems: unknown }).problems as { field: string }[]).map((p) => p.field)).toEqual(['from', 'into'])
      expect(both.text).not.toMatch(/9876|5432/)
      const badDate = await call(h.server, a.cookie, 'GET', path(phone, 'UC_A', false, '2026-13-01'))
      expect(badDate.status).toBe(404)
      expect(badDate.text).not.toMatch(/9876|5432/)
    }
    expect(JSON.stringify(h.logs)).not.toMatch(/9876|5432/)
    expect(await dumpAll(h.database)).not.toMatch(/98765432|9876-5432/)
  })

  it('미리 보기는 아무것도 기록하지 않고 보기 캐시를 가진 범위로 세지 않는다', async () => {
    h = await harness()
    const a = await h.account('mpn')
    const { x } = await sale(h, a.cookie, a.sellerId)
    const before = await dumpAll(h.database)
    const seq = (await h.server.writer.read(a.sellerId, DAY)).seq
    for (let i = 0; i < 5; i++) await ok(call(h.server, a.cookie, 'GET', path(x, 'UC_B')))
    expect(await dumpAll(h.database)).toBe(before)
    expect((await h.server.writer.read(a.sellerId, DAY)).seq).toBe(seq)
    expect(h.server.viewCaches.has(a.sellerId, DAY, false)).toBe(false)
  })

  it('쓰기와 겹친 미리 보기 — 응답마다 그 seq의 상태로 계산한 값과 같다', async () => {
    h = await harness()
    const a = await h.account('mpc')
    const { b, x } = await sale(h, a.cookie, a.sellerId)
    const states = new Map<number, unknown>()
    const remember = async (): Promise<void> => {
      const runtime = await h!.server.writer.read(a.sellerId, DAY)
      states.set(runtime.seq, runtime.state)
    }
    await remember()
    // 채팅이 흐르는 중에 미리 보기를 여러 번 (순서대로 쓰고, 쓰기마다 상태를 기억한다)
    const previews: Promise<Res>[] = []
    for (let i = 0; i < 8; i++) {
      const write = i % 2 === 0 ? h.server.ingestChat(a.sellerId, { b, id: `c${String(i)}`, ch: `UC_${String(i)}`, nick: `손님${String(i)}`, text: '16' }) : event(h.server, a.cookie, { type: 'host.cancel', b, no: 16, buyer: 'UC_B', reason: '취소' })
      previews.push(call(h.server, a.cookie, 'GET', path(x, 'UC_B')))
      await write
      await remember()
      previews.push(call(h.server, a.cookie, 'GET', path('UC_B', x)))
    }
    for (const res of await Promise.all(previews)) {
      expect(res.status).toBe(200)
      const at = res.body.seq as number
      const state = states.get(at)
      expect(state, `seq ${String(at)}의 상태`).toBeDefined()
      const preview = res.body.preview as { from: string; into: string }
      expect(preview).toEqual(previewMerge(state as never, preview.from, preview.into))
    }
  })
})

describe('AC-S06b-11 문자찜 응답 buyer — 공격', () => {
  it('전화번호로 이은 문자 구매자가 유튜브 구매자에 합쳐진 뒤 같은 번호 문자찜의 buyer는 문자 구매자 자신 — 떼어 내기·재시작 뒤 재전송도 같다', async () => {
    h = await harness()
    const a = await h.account('sb1')
    const b = await broadcast(h, a.cookie, DAY)
    for (const no of [15, 16, 17]) await ok(event(h.server, a.cookie, { type: 'product.register', b, no, name: '구피', price: 3000 }))
    await h.server.ingestChat(a.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' })
    const first = await ok(event(h.server, a.cookie, { type: 'sms', b, no: 16, phone: '010-3333-4444', memo: '이씨' }))
    const x = first.body.buyer as string
    expect(x).toMatch(/^sms:[a-z]+$/)
    await ok(event(h.server, a.cookie, { type: 'buyer.merge', from: x, into: 'UC_A', reason: '같은 사람' }, DAY))
    const requestId = rid('sms')
    const body = { requestId, type: 'sms', b, no: 17, phone: '01033334444' }
    const again = await ok(call(h.server, a.cookie, 'POST', '/api/events', body))
    expect(again.body.buyer).toBe(x)
    // 지금의 구매자는 범위 조회의 current
    const view = await ok(call(h.server, a.cookie, 'GET', `/api/days/${DAY}`))
    expect((view.body.buyers as { id: string; current: string }[]).find((y) => y.id === x)?.current).toBe('UC_A')
    // 떼어 낸 뒤 · 다른 인스턴스(재시작)에서 같은 요청 번호 재전송 → 같은 본문
    await ok(event(h.server, a.cookie, { type: 'buyer.unmerge', from: x, reason: '잘못 합침' }, DAY))
    const resent = await ok(call(h.server, a.cookie, 'POST', '/api/events', body))
    const restarted = h.restart()
    const resent2 = await ok(call(restarted, a.cookie, 'POST', '/api/events', { ...body, no: 15 }))
    expect(resent.body).toEqual(again.body)
    expect(resent2.body).toEqual(again.body)
    for (const r of [first, again, resent, resent2]) expect(r.text).not.toMatch(/3333|01033334444/)
    expect(JSON.stringify(h.logs)).not.toMatch(/3333/)
  })

  it('지정 구매자와 전화번호를 함께 적으면 지정 구매자가 buyer, 동시에 같은 요청 번호 두 번이면 두 응답의 buyer가 같다', async () => {
    h = await harness()
    const a = await h.account('sb2')
    const b = await broadcast(h, a.cookie, DAY)
    await ok(event(h.server, a.cookie, { type: 'product.register', b, no: 15, name: '구피', price: 3000 }))
    await h.server.ingestChat(a.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕' })
    const body = { requestId: rid('sms'), type: 'sms', b, no: 15, phone: '010-5555-6666', buyer: 'UC_A' }
    const [one, two] = await Promise.all([
      call(h.server, a.cookie, 'POST', '/api/events', body),
      call(h.server, a.cookie, 'POST', '/api/events', body),
    ])
    expect(one.status, one.text).toBe(200)
    expect(two.status, two.text).toBe(200)
    expect(one.body).toEqual(two.body)
    expect(one.body.buyer).toBe('UC_A')
    const view = await ok(call(h.server, a.cookie, 'GET', `/api/days/${DAY}`))
    expect((view.body.claims as { buyer: string }[]).map((c) => c.buyer)).toEqual(['UC_A'])
  })
})

describe('AC-S06b-12 보기 캐시 상한 — 공격', () => {
  it('한 판매자가 실제·리허설 범위 6개를 오가며 범위·증분·메시지 조회 → 그 판매자 4개, 조용한 판매자 그대로, 비운 범위의 응답·증분은 같은 값', async () => {
    h = await harness()
    const busy = await h.account('vb1')
    const quiet = await h.account('vb2')
    const qb = await broadcast(h, quiet.cookie, DAY)
    await h.server.ingestChat(quiet.sellerId, { b: qb, id: 'q1', ch: 'UC_Q', nick: '조용', text: '안녕' })
    await ok(call(h.server, quiet.cookie, 'GET', `/api/days/${DAY}`))
    const scopes: { date: string; rehearsal: boolean; b: string }[] = []
    for (const [date, rehearsal] of [
      ['2026-10-15', false],
      ['2026-10-15', true],
      ['2026-10-16', false],
      ['2026-10-16', true],
      ['2026-10-17', false],
      ['2026-10-17', true],
    ] as const) {
      const b = await broadcast(h, busy.cookie, date, rehearsal)
      await ok(event(h.server, busy.cookie, { type: 'product.register', b, no: 1, name: '구피', price: 1000 }))
      await h.server.ingestChat(busy.sellerId, { b, id: `m-${b}`, ch: 'UC_1', nick: '영희', text: '1' })
      scopes.push({ date, rehearsal, b })
    }
    const q = (s: { rehearsal: boolean }) => (s.rehearsal ? '?rehearsal=true' : '')
    const qa = (s: { rehearsal: boolean }) => (s.rehearsal ? '&rehearsal=true' : '')
    const first: string[] = []
    for (const s of scopes) {
      first.push((await ok(call(h.server, busy.cookie, 'GET', `/api/days/${s.date}${q(s)}`))).text)
      await ok(call(h.server, busy.cookie, 'GET', `/api/days/${s.date}/changes?since=1${qa(s)}`))
      await ok(call(h.server, busy.cookie, 'GET', `/api/days/${s.date}/messages?limit=50${qa(s)}`))
      expect(h.server.viewCaches.countOf(busy.sellerId)).toBeLessThanOrEqual(4)
    }
    expect(h.server.viewCaches.countOf(busy.sellerId)).toBe(4)
    expect(h.server.viewCaches.has(busy.sellerId, '2026-10-15', false)).toBe(false)
    expect(h.server.viewCaches.has(busy.sellerId, '2026-10-15', true)).toBe(false)
    expect(h.server.viewCaches.has(quiet.sellerId, DAY, false)).toBe(true)
    expect((await h.server.writer.read(quiet.sellerId, DAY)).views.index.size).toBeGreaterThan(0)
    // 비운 범위를 다시: 같은 전체, 증분(since=1)도 비우기 전과 같은 값
    const s0 = scopes[0] as (typeof scopes)[number]
    const changesBefore = await ok(call(h.restart(), busy.cookie, 'GET', `/api/days/${s0.date}/changes?since=1`))
    expect((await ok(call(h.server, busy.cookie, 'GET', `/api/days/${s0.date}`))).text).toBe(first[0])
    const changesAgain = await ok(call(h.server, busy.cookie, 'GET', `/api/days/${s0.date}/changes?since=1`))
    expect(changesAgain.text).toBe(changesBefore.text)
    // 비운 뒤 쓰기 → 증분이 그 쓰기를 담는다
    await ok(event(h.server, busy.cookie, { type: 'product.register', b: s0.b, no: 2, name: '구피2', price: 2000 }))
    const changes = await ok(call(h.server, busy.cookie, 'GET', `/api/days/${s0.date}/changes?since=3`))
    expect(JSON.stringify(changes.body)).toContain('구피2')
  })

  it('10분 지난 범위는 다른 판매자의 조회·쓰기 때 비워지고, 다시 조회하면 같은 응답', async () => {
    h = await harness()
    const a = await h.account('vt1')
    const other = await h.account('vt2')
    const b = await broadcast(h, a.cookie, DAY)
    await h.server.ingestChat(a.sellerId, { b, id: 'm1', ch: 'UC_1', nick: '영희', text: '안녕' })
    const ob = await broadcast(h, other.cookie, DAY)
    const firstView = (await ok(call(h.server, a.cookie, 'GET', `/api/days/${DAY}`))).text
    expect(h.server.viewCaches.has(a.sellerId, DAY)).toBe(true)
    h.clock.t += 10 * 60 * 1000
    await ok(event(h.server, other.cookie, { type: 'product.register', b: ob, no: 1, name: '구피', price: 1000 }))
    expect(h.server.viewCaches.has(a.sellerId, DAY)).toBe(false)
    expect((await h.server.writer.read(a.sellerId, DAY)).views.index.size).toBe(0)
    expect((await ok(call(h.server, a.cookie, 'GET', `/api/days/${DAY}`))).text).toBe(firstView)
  })
})
