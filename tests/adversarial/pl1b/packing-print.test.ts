// PL1B 적대 시험 (test-domain): 포장 모드 "포장 라벨 출력"이 쓰는 POST /api/print/packing (AC-PL1B-91 b·c, AC-PL1B-10·11, D-PL1-05, L-13).
// 서버는 바꾸지 않았다 — 화면이 새로 이 요청을 보내게 되었으니 지금 서버 규칙이 그대로인지 공격한다.
// - 라벨 꺼짐 LABELS_OFF · 리허설 PRINT_REHEARSAL · 다른 판매자의 구매자 404 · 품목 없음 PRINT_NO_ITEMS — 작업·요청 기록이 생기지 않는다
// - 같은 requestId 두 번(차례로·동시에) → 작업 한 묶음. 다른 판매자가 같은 requestId를 써도 남의 작업을 돌려받지 않는다
// - 다른 requestId로 연달아(화면에서 두 번 누름) → 대기 중이면 PRINT_IN_PROGRESS, 동시 10개여도 묶음 하나
// - 품목 12개 → 응답 작업 수 = 쪽수 = 대기열 작업 수
import { afterEach, describe, expect, it } from 'vitest'
import { call, chat, DAY, DEV_A, ev, harness, printer, rid, startBroadcast, type Harness } from '../i1/helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

/** 포장 라벨 작업·라벨 수와 출력 요청 기록 수 (상품 라벨 자동 작업은 세지 않는다) */
async function counts(x: Harness, sellerId?: string): Promise<{ jobs: number; requests: number; labels: number }> {
  const and = sellerId === undefined ? '' : 'and seller_id = $1'
  const params = sellerId === undefined ? [] : [sellerId]
  const q = async (sql: string): Promise<number> => ((await x.database.pglite?.query<{ n: number }>(sql, params))?.rows[0]?.n ?? -1)
  return {
    jobs: await q(`select count(*)::int as n from print_jobs where kind = 'packing' ${and}`),
    requests: await q(`select count(*)::int as n from print_requests where true ${and}`),
    labels: await q(`select count(*)::int as n from print_labels where kind = 'packing' ${and}`),
  }
}

const setLabels = (x: Harness, cookie: string, enabled: boolean) => call(x.server, cookie, 'PUT', '/api/settings/labels', { enabled })

/** 15번(·더 많은 번호)을 UC_A가 이긴 실제 방송 */
async function shop(x: Harness, loginId: string, items = 1): Promise<{ sellerId: string; cookie: string; b: string }> {
  const a = await x.account(loginId)
  const b = await startBroadcast(x.server, a.cookie, DAY)
  for (let no = 1; no <= items; no++) {
    await ev(x, a.cookie, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no })
    await chat(x, a.sellerId, b, 'UC_A', '가', String(no))
  }
  await chat(x, a.sellerId, b, 'UC_LOSE', '나', '1')
  return { sellerId: a.sellerId, cookie: a.cookie, b }
}

interface JobsBody {
  jobs?: { id: string }[]
  error?: { code: string; message: string }
}

describe('포장 라벨 출력 요청 거절 (AC-PL1B-91 b)', () => {
  it('라벨을 끈 판매자: 409 LABELS_OFF, 작업·요청 기록·라벨 0 — 다시 켜면 같은 요청이 된다', async () => {
    h = await harness()
    const a = await shop(h, 'pk-off')
    const p = printer(h, a.cookie)
    expect((await setLabels(h, a.cookie, false)).status).toBe(200)
    const before = await counts(h, a.sellerId)
    const requestId = rid('pk')
    for (let i = 0; i < 2; i++) {
      const r = await p.packing(DAY, 'UC_A', requestId)
      expect(r.status).toBe(409)
      expect((r.body as JobsBody).error?.code).toBe('LABELS_OFF')
    }
    expect(await counts(h, a.sellerId)).toEqual(before)
    expect(before.jobs).toBe(0)
    // 같은 requestId로 켠 뒤 다시: 앞의 거절이 기록되지 않았으니 새로 만든다
    expect((await setLabels(h, a.cookie, true)).status).toBe(200)
    const again = await p.packing(DAY, 'UC_A', requestId)
    expect(again.status, again.text).toBe(200)
    expect((again.body as JobsBody).jobs?.length).toBe(1)
  })

  it('리허설 표시는 PRINT_REHEARSAL, 리허설 방송만 있는 날짜의 구매자는 404 — 작업 0', async () => {
    h = await harness()
    const a = await h.account('pk-reh')
    const r = await call(h.server, a.cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date: DAY, rehearsal: true })
    const b = (r.body.broadcast as { id: string }).id
    await ev(h, a.cookie, { type: 'product.register', b, no: 1, name: 'x', price: 1000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '1')
    const p = printer(h, a.cookie)
    const reh = await p.raw('POST', '/api/print/packing', { requestId: rid('pk'), date: DAY, buyer: 'UC_A', rehearsal: true })
    expect(reh.body).toEqual({ error: { code: 'PRINT_REHEARSAL', message: '리허설 방송은 라벨을 출력하지 않아요.' } })
    expect((await p.packing(DAY, 'UC_A')).status).toBe(404)
    // 라벨을 꺼도 리허설 표시는 리허설 거절(꺼짐보다 앞)
    expect((await setLabels(h, a.cookie, false)).status).toBe(200)
    expect(((await p.raw('POST', '/api/print/packing', { requestId: rid('pk'), date: DAY, buyer: 'UC_A', rehearsal: true })).body as JobsBody).error?.code).toBe('PRINT_REHEARSAL')
    expect(await counts(h, a.sellerId)).toMatchObject({ jobs: 0, requests: 0 })
  })

  it('다른 판매자의 구매자 ID는 404, 진 구매자·없는 구매자는 거절 — 작업 0', async () => {
    h = await harness()
    const a = await shop(h, 'pk-a')
    const x = await h.account('pk-x')
    await startBroadcast(h.server, x.cookie, DAY)
    const px = printer(h, x.cookie)
    for (const buyer of ['UC_A', 'UC_LOSE', 'UC_NOBODY']) expect((await px.packing(DAY, buyer)).status, buyer).toBe(404)
    const pa = printer(h, a.cookie)
    const lose = await pa.packing(DAY, 'UC_LOSE')
    expect(lose.status).toBe(409)
    expect((lose.body as JobsBody).error?.code).toBe('PRINT_NO_ITEMS')
    expect((await pa.packing(DAY, 'UC_NOBODY')).status).toBe(404)
    // 다른 날짜
    expect((await pa.packing('2026-10-19', 'UC_A')).status).toBe(404)
    expect(await counts(h)).toMatchObject({ jobs: 0, requests: 0 })
  })
})

describe('같은 requestId·연달아 누름 (AC-PL1B-91 c, AC-PL1B-11)', () => {
  it('같은 requestId를 차례로 두 번 → 같은 작업 묶음, 대기열 작업은 한 번만', async () => {
    h = await harness()
    const a = await shop(h, 'pk-same')
    const p = printer(h, a.cookie)
    const requestId = rid('pk')
    const first = await p.packing(DAY, 'UC_A', requestId)
    expect(first.status, first.text).toBe(200)
    const second = await p.packing(DAY, 'UC_A', requestId)
    expect(second.status, second.text).toBe(200)
    expect((second.body as JobsBody).jobs?.map((j) => j.id)).toEqual((first.body as JobsBody).jobs?.map((j) => j.id))
    expect((await counts(h, a.sellerId)).jobs).toBe(1)
    expect((await p.overview()).jobs.filter((j) => j.kind === 'packing')).toHaveLength(1)
  })

  it('같은 requestId를 동시에 10번 → 작업 묶음 하나, 모든 응답이 같은 작업', async () => {
    h = await harness()
    const a = await shop(h, 'pk-race')
    const p = printer(h, a.cookie)
    const requestId = rid('pk')
    const all = await Promise.all(Array.from({ length: 10 }, () => p.packing(DAY, 'UC_A', requestId)))
    expect(all.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200))
    const ids = new Set(all.map((r) => JSON.stringify((r.body as JobsBody).jobs?.map((j) => j.id))))
    expect(ids.size).toBe(1)
    expect((await counts(h, a.sellerId)).jobs).toBe(1)
  })

  it('다른 requestId로 동시에 10번(마구 누름) → 묶음 하나, 나머지는 PRINT_IN_PROGRESS; 출력한 뒤 다시 누르면 새 묶음', async () => {
    h = await harness()
    const a = await shop(h, 'pk-mash')
    const p = printer(h, a.cookie)
    const all = await Promise.all(Array.from({ length: 10 }, () => p.packing(DAY, 'UC_A')))
    expect(all.filter((r) => r.status === 200)).toHaveLength(1)
    for (const r of all.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409)
      expect((r.body as JobsBody).error?.code).toBe('PRINT_IN_PROGRESS')
    }
    expect((await counts(h, a.sellerId)).jobs).toBe(1)
    await p.become()
    const kinds: string[] = []
    for (let job = await p.printOne(DEV_A); job !== null; job = await p.printOne(DEV_A)) kinds.push(job.kind)
    expect(kinds.filter((k) => k === 'packing')).toHaveLength(1)
    const next = await p.packing(DAY, 'UC_A')
    expect(next.status, next.text).toBe(200)
    expect((await counts(h, a.sellerId)).jobs).toBe(2)
  })

  it('다른 판매자가 같은 requestId를 써도 남의 작업을 돌려받지 않는다', async () => {
    h = await harness()
    const a = await shop(h, 'pk-ida')
    const x = await shop(h, 'pk-idx')
    const requestId = rid('pk')
    const ra = await printer(h, a.cookie).packing(DAY, 'UC_A', requestId)
    expect(ra.status).toBe(200)
    const rx = await printer(h, x.cookie).packing(DAY, 'UC_A', requestId)
    expect(rx.status, rx.text).toBe(200)
    const aIds = (ra.body as JobsBody).jobs?.map((j) => j.id) ?? []
    const xIds = (rx.body as JobsBody).jobs?.map((j) => j.id) ?? []
    expect(xIds).toHaveLength(1)
    expect(xIds.some((id) => aIds.includes(id))).toBe(false)
    expect((await counts(h, a.sellerId)).jobs).toBe(1)
    expect((await counts(h, x.sellerId)).jobs).toBe(1)
  })

  it('품목 12개: 응답 작업 수 = 대기열 포장 라벨 작업 수 = 쪽수(2 이상), 쪽 번호 1..N', async () => {
    h = await harness()
    const a = await shop(h, 'pk-12', 12)
    const p = printer(h, a.cookie)
    const r = await p.packing(DAY, 'UC_A')
    expect(r.status, r.text).toBe(200)
    const n = (r.body as JobsBody).jobs?.length ?? 0
    expect(n).toBeGreaterThanOrEqual(2)
    const o = await p.overview()
    expect(o.jobs.filter((j) => j.kind === 'packing')).toHaveLength(n)
    await p.become()
    const pages: (number | null)[] = []
    for (;;) {
      const c = await p.claim(DEV_A)
      if (c.job === null) break
      if (c.job.kind === 'packing') {
        pages.push(c.job.page)
        expect(c.job.pages).toBe(n)
      }
      await p.result(DEV_A, c.job.attempt, true)
    }
    expect(pages).toEqual(Array.from({ length: n }, (_, i) => i + 1))
  })
})
