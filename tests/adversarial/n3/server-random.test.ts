// N3 적대 테스트 (test-domain): 무작위 처리 열 (acceptance L "무작위 처리 열", AC-N3-22·29, DP-INV-1~4).
// 이틀 치 실제 방송 + 리허설 방송 위에서 받아 오기·붙여넣기(겹침·재붙여넣기)·확정(지금/옛 남은 금액)·무시·다시·되돌리기·한꺼번에·재전송·
// 손 입금·손 환불·배송비 예외·조정·합치기·떼어 내기·두 인스턴스 동시 요청·서버 재시작을 섞는다.
// 끝에 범위 이벤트 기록을 코어로 재생해 본다:
// - DP-INV-1: 입금마다 (입금 기록 − 되돌림 기록) ∈ {0,1}, 1이면 자동 확인됨·확인함
// - DP-INV-2: 자동 입금 확인 기록은 그 기록 직전 묶음 남은 금액 = 입금 금액이고 품목이 있다 (안 받은 돈을 받았다고 적지 않음)
// - DP-INV-3: 리허설 범위에 입금 확인 기록이 없다 · DP-INV-4: (판매자, 원천, 외부 키) 유일
import { applyEvent, getSettlement, initEngine, type EngineEvent, type EngineState } from '@livejjim/core'
import { mergeRaw, type LivejjimServer } from '@livejjim/server'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { call, event, rid } from '../s04/helpers.ts'
import { dep, depositNoOf, fakeSource, kst, kstIso, n3Harness, ok, sell, views, type N3 } from './helpers.ts'

let h: N3 | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const D1 = '2026-10-17'
const D2 = '2026-10-18'
const BUYERS = ['UC_A', 'UC_B', 'UC_C'] as const
const NAMES = ['다육이맘', '선인장', '김영희', '김 영희', '모르는사람', '']
const AMOUNTS = [14_000, 24_000, 9000, 19_000, 1000, 4000]

type Op =
  | { k: 'feed'; date: 0 | 1; minute: number; amount: number; name: number; key: number }
  | { k: 'paste'; rows: { date: 0 | 1; minute: number; amount: number; name: number }[] }
  | { k: 'confirm'; no: number; buyer: number; date: 0 | 1; stale: boolean; remember: boolean }
  | { k: 'ignore' | 'reopen' | 'revert'; no: number }
  | { k: 'bulk'; no: number; buyer: number; date: 0 | 1 }
  | { k: 'replay'; no: number }
  | { k: 'manual'; kind: 'payment' | 'refund' | 'adjust' | 'shipping'; buyer: number; date: 0 | 1; amount: number }
  | { k: 'merge'; from: number; into: number; date: 0 | 1 }
  | { k: 'unmerge'; from: number; date: 0 | 1 }
  | { k: 'restart' }

const dateArb = fc.constantFrom<0 | 1>(0, 1)
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ k: fc.constant('feed' as const), date: dateArb, minute: fc.integer({ min: 0, max: 600 }), amount: fc.constantFrom(...AMOUNTS), name: fc.nat(NAMES.length - 1), key: fc.nat(8) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('paste' as const), rows: fc.array(fc.record({ date: dateArb, minute: fc.integer({ min: 0, max: 600 }), amount: fc.constantFrom(...AMOUNTS), name: fc.nat(NAMES.length - 1) }), { minLength: 1, maxLength: 3 }) }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant('confirm' as const), no: fc.integer({ min: 1, max: 10 }), buyer: fc.nat(2), date: dateArb, stale: fc.boolean(), remember: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constantFrom('ignore' as const, 'reopen' as const, 'revert' as const), no: fc.integer({ min: 1, max: 10 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('bulk' as const), no: fc.integer({ min: 1, max: 10 }), buyer: fc.nat(2), date: dateArb }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('replay' as const), no: fc.integer({ min: 1, max: 10 }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('manual' as const), kind: fc.constantFrom('payment' as const, 'refund' as const, 'adjust' as const, 'shipping' as const), buyer: fc.nat(2), date: dateArb, amount: fc.constantFrom(1000, 4000, 14_000) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('merge' as const), from: fc.nat(2), into: fc.nat(2), date: dateArb }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('unmerge' as const), from: fc.nat(2), date: dateArb }) },
  { weight: 1, arbitrary: fc.constant({ k: 'restart' as const }) },
)

const at = (date: 0 | 1, minute: number): string => {
  const base = kst(date === 0 ? '2026-10-17 21:00' : '2026-10-18 21:00') + minute * 60_000
  const d = new Date(base + 9 * 3_600_000).toISOString()
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`
}

async function remainingOf(server: LivejjimServer, cookie: string, buyer: string, date: string): Promise<number> {
  const r = await call(server, cookie, 'GET', `/api/days/${date}`)
  const s = (r.body as { settlements?: { buyer: string; total: number; received: number }[] }).settlements?.find((x) => x.buyer === buyer)
  return s === undefined ? 0 : s.total - s.received
}

describe('무작위 처리 열 — 두 인스턴스·합치기·손 기록을 섞어도 DP-INV-1~4', () => {
  it('fast-check', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.array(opArb, { minLength: 1, maxLength: 3 }), { minLength: 8, maxLength: 18 }), async (steps) => {
        await h?.close()
        h = await n3Harness()
        const a = await h.account(`rnd${String(Date.now() % 100000)}${String(Math.floor(Math.random() * 1000))}`)
        h.clock.t = kst('2026-10-17 20:00')
        const b1 = await sell(h, h.server, a.cookie, a.sellerId, {
          date: D1,
          items: [
            { no: 1, price: 10_000, ch: 'UC_A', nick: '다육이맘' },
            { no: 2, price: 20_000, ch: 'UC_B', nick: '선인장' },
          ],
        })
        await ok(event(h.server, a.cookie, { type: 'product.register', b: b1, no: 3, name: '상품3', price: 5000 }))
        await ok(event(h.server, a.cookie, { type: 'sms', b: b1, no: 3, memo: '김영희' }))
        h.clock.t = kst('2026-10-18 20:00')
        await sell(h, h.server, a.cookie, a.sellerId, {
          date: D2,
          items: [
            { no: 1, price: 10_000, ch: 'UC_A', nick: '다육이맘' },
            { no: 2, price: 20_000, ch: 'UC_C', nick: '김영희' },
          ],
        })
        await sell(h, h.server, a.cookie, a.sellerId, { date: D2, rehearsal: true, items: [{ no: 1, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
        h.clock.t = kst('2026-10-19 12:00')
        const src = await fakeSource(h.server, a.cookie)
        let servers: [LivejjimServer, LivejjimServer] = [h.server, h.restart()]
        const done: string[] = []
        let pick = 0
        const run = async (op: Op): Promise<void> => {
          const server = servers[pick++ % 2] as LivejjimServer
          const D = dep(server, a.cookie)
          const date = (d: 0 | 1) => (d === 0 ? D1 : D2)
          switch (op.k) {
            case 'feed':
              await D.testRows(src, [{ key: `k${String(op.key)}`, at: kstIso(at(op.date, op.minute)), amount: op.amount, name: NAMES[op.name] as string }])
              await server.deposits.runSource(a.sellerId, src)
              return
            case 'paste':
              await D.paste(['거래일시\t입금자명\t입금액', ...op.rows.map((r) => `${at(r.date, r.minute)}\t${NAMES[r.name] as string}\t${String(r.amount)}`)].join('\n'))
              return
            case 'confirm': {
              const buyer = BUYERS[op.buyer] as string
              const remaining = op.stale ? 14_000 : await remainingOf(server, a.cookie, buyer, date(op.date))
              const id = rid('cf')
              done.push(id)
              await D.confirm(op.no, { date: date(op.date), buyer, remaining, remember: op.remember }, id)
              return
            }
            case 'ignore':
              await D.ignore(op.no)
              return
            case 'reopen':
              await D.reopen(op.no)
              return
            case 'revert':
              await D.revert(op.no)
              return
            case 'bulk': {
              const buyer = BUYERS[op.buyer] as string
              await D.bulk([
                { no: op.no, action: 'confirm', date: date(op.date), buyer, remaining: await remainingOf(server, a.cookie, buyer, date(op.date)) },
                { no: op.no + 1, action: 'ignore' },
                { no: op.no, action: 'ignore' },
              ])
              return
            }
            case 'replay':
              if (done.length > 0) await D.confirm(op.no, { date: D2, buyer: 'UC_A', remaining: 0 }, done[op.no % done.length])
              return
            case 'manual': {
              const buyer = BUYERS[op.buyer] as string
              const body =
                op.kind === 'payment'
                  ? { type: 'settlement.payment', buyer, date: date(op.date), amount: op.amount, memo: '손 입금' }
                  : op.kind === 'refund'
                    ? { type: 'settlement.refund', buyer, date: date(op.date), amount: op.amount, reason: '손 환불' }
                    : op.kind === 'adjust'
                      ? { type: 'settlement.adjust', buyer, date: date(op.date), amount: -op.amount, reason: '할인' }
                      : { type: 'settlement.shippingOverride', buyer, date: date(op.date), mode: 'FREE' }
              await event(server, a.cookie, body, date(op.date))
              return
            }
            case 'merge':
              if (op.from !== op.into) await event(server, a.cookie, { type: 'buyer.merge', from: BUYERS[op.from], into: BUYERS[op.into], reason: '같은 사람' }, date(op.date))
              return
            case 'unmerge':
              await event(server, a.cookie, { type: 'buyer.unmerge', from: BUYERS[op.from], reason: '잘못 합침' }, date(op.date))
              return
            case 'restart':
              servers = [h?.restart() as LivejjimServer, servers[1]]
              return
          }
        }
        for (const step of steps) await Promise.all(step.map((op) => run(op)))

        // 범위 이벤트 기록 재생
        const pg = h.database.pglite
        if (pg === null) throw new Error('PGlite가 아니다')
        const rows = (
          await pg.query<{ body: string; rehearsal: boolean; failed: boolean; date: string; nick: string | null; text: string | null }>(
            // Y1: 채팅 이름·본문은 chat_raw에 따로 있다 — 합쳐 재생한다 (check-replay와 같은 방식)
            `select e.body, s.rehearsal, e.failed, s.date, r.nick, r.text from events e join scopes s on s.id = e.scope_id left join chat_raw r on r.scope_id = e.scope_id and r.seq = e.seq and r.seller_id = e.seller_id where e.seller_id = $1 order by s.rehearsal, s.date, e.seq`,
            [a.sellerId],
          )
        ).rows
        const states = new Map<string, EngineState>()
        const net = new Map<number, number>()
        const all = await views(h.server, a.cookie)
        for (const row of rows) {
          const e = JSON.parse(mergeRaw(row.body, row.nick, row.text)) as EngineEvent & { memo?: string; reason?: string; buyer?: string; date?: string; amount?: number }
          const no = depositNoOf({ seq: 0, type: e.type, actor: { kind: '', loginId: null }, reason: null, fields: e as unknown as Record<string, unknown> })
          if (row.rehearsal) {
            expect(no, 'DP-INV-3 리허설 범위에 입금 확인 기록').toBeNull()
            continue
          }
          if (row.failed) continue
          const before = states.get(row.date) ?? initEngine({ broadcasts: [], settings: {} })
          const after = applyEvent(before, e).state
          states.set(row.date, after)
          if (no === null || after === before) continue
          if (e.type === 'settlement.payment') {
            net.set(no, (net.get(no) ?? 0) + 1)
            if (e.memo?.startsWith('자동 입금 확인')) {
              const s = getSettlement(before, e.buyer as string, e.date as string)
              expect(s.items.length, `DP-INV-2 입금 #${String(no)} 품목 없는 묶음에 자동 확인`).toBeGreaterThan(0)
              expect(s.total - s.received, `DP-INV-2 입금 #${String(no)} 자동 확인 직전 남은 금액`).toBe(e.amount)
              const d = all.find((x) => x.no === no)
              expect(d?.name.replace(/\s/g, ''), `입금 #${String(no)} 빈 이름 자동 확인`).not.toBe('')
            }
          } else if (e.type === 'settlement.refund') net.set(no, (net.get(no) ?? 0) - 1)
        }
        for (const v of all) {
          const n = net.get(v.no) ?? 0
          expect([0, 1], `DP-INV-1 입금 #${String(v.no)} 반영 수 ${String(n)}`).toContain(n)
          expect(n === 1, `DP-INV-1 입금 #${String(v.no)} 상태 ${v.status}`).toBe(v.status === 'AUTO_APPLIED' || v.status === 'APPLIED')
        }
        if (process.env.N3_DEBUG) process.stderr.write(`\n${JSON.stringify(all.map((v) => [v.no, v.status]))} ${JSON.stringify([...net])}`)
        const dup = (await pg.query<{ n: number }>(`select count(*)::int as n from (select 1 from deposits group by seller_id, source_id, external_key having count(*) > 1) d`)).rows[0]?.n
        expect(dup, 'DP-INV-4').toBe(0)
        await h.close()
        h = null
      }),
      { numRuns: Number(process.env.N3_RUNS ?? 6) },
    )
  }, 600_000)
})
