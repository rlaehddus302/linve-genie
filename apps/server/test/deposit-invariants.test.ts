// AC-N3-29 (DP-INV-1~4): 무작위 순서의 붙여넣기·받아 오기·확정·무시·다시·되돌리기·한꺼번에·재전송·손 입금 뒤에도
// 입금마다 (그 입금으로 적은 입금 기록 수 − 되돌림 기록 수) ∈ {0, 1}이고 1인 것은 자동 확인됨·확인함뿐이다.
// 리허설 범위에는 입금 확인이 적은 기록이 없고, (판매자, 원천, 외부 키)마다 입금은 하나다. 범위 이벤트 기록을 코어로 재생해 센다.
import type { PGlite } from '@electric-sql/pglite'
import { applyEvent, getSettlement, initEngine, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { addSeller, createBroadcast, writeEvent } from './support.ts'
import { DAY, depositApi, depositWorld, deposits, order, pasteText, register } from './deposit-support.ts'

/** 시드 고정 난수 (LCG) */
function random(seed: number) {
  let state = seed >>> 0
  return {
    next(): number {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 2 ** 32
    },
    int(n: number): number {
      return Math.floor(this.next() * n)
    },
  }
}

const memoNo = (text: unknown): number | null => {
  const match = typeof text === 'string' ? /^(?:자동 입금 확인|입금 내역으로 확인|입금 확인 되돌림) · 입금 #(\d+)$/.exec(text) : null
  return match === null ? null : Number(match[1])
}

describe('무작위 처리 열 뒤의 불변식 (DP-INV-1~4)', () => {
  for (const seed of [11, 23, 37]) {
    it(`시드 ${String(seed)}`, async () => {
      const world = await depositWorld({ deposits: { refetchGapMs: 0 } })
      const seller = await addSeller(world)
      const api = depositApi(world, seller)
      const b = await createBroadcast(world, seller, { date: DAY })
      const buyers = [
        ['UC_A', '다육이맘'],
        ['UC_B', '선인장'],
        ['UC_C', '김영희'],
      ] as const
      for (const [index, [channel, nick]] of buyers.entries()) {
        await register(world, seller, b.id, index + 1, 10_000 + index * 1000)
        await order(world, seller, b.id, channel, nick, String(index + 1))
      }
      const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
      await register(world, seller, rehearsal.id, 1)
      await order(world, seller, rehearsal.id, 'UC_A', '다육이맘', '1')
      world.clock.advance(60_000)
      const fake = (await api.createSource({ kind: 'FAKE' })).body as { id: string }
      const rng = random(seed)
      const names = ['다육이맘', '선인장', '김영희', '모르는사람', '']
      const amounts = [14_000, 15_000, 16_000, 1000, 2000]
      const requests: string[] = []
      // 자동 확인 하나로 시작한다 (UC_A 남은 14,000)
      await api.paste(pasteText([{ at: '2026-10-19 12:00:01', name: '다육이맘', amount: 14_000 }]))
      expect(await deposits(api, 'AUTO_APPLIED')).toHaveLength(1)
      for (let step = 0; step < 50; step++) {
        const op = rng.int(9)
        const no = rng.int(8) + 1
        const buyer = buyers[rng.int(3)]?.[0] as string
        if (op === 0) {
          const rows = Array.from({ length: rng.int(3) + 1 }, () => ({ at: `2026-10-19 12:00:${String(rng.int(60)).padStart(2, '0')}`, name: names[rng.int(5)] as string, amount: amounts[rng.int(5)] as number }))
          await api.paste(pasteText(rows))
        } else if (op === 1) {
          await api.testRows(fake.id, [{ key: `k${String(rng.int(6))}`, at: '2026-10-19T12:00:20+09:00', amount: amounts[rng.int(5)] as number, name: names[rng.int(5)] as string }])
          await api.fetch(fake.id)
        } else if (op === 2 || op === 3) {
          const state = (await world.server.writer.read(seller.sellerId, DAY)).state
          const s = getSettlement(state, buyer, DAY)
          const id = `r-${String(step)}`
          requests.push(id)
          await api.confirm(no, { date: DAY, buyer, remaining: s.total - s.received, remember: rng.int(2) === 0 }, id)
        } else if (op === 4) await api.ignore(no)
        else if (op === 5) await api.reopen(no)
        else if (op === 6) await api.revert(no)
        else if (op === 7) await api.bulk([{ no, action: 'ignore' }, { no: no + 1, action: 'confirm', date: DAY, buyer, remaining: 0 }])
        else if (requests.length > 0) {
          // 재전송 (같은 요청 번호 — 내용이 달라도 처음 결과)
          await api.confirm(no, { date: DAY, buyer, remaining: 0 }, requests[rng.int(requests.length)] as string)
          await writeEvent(world, seller, { type: 'settlement.payment', buyer, date: DAY, amount: 500, memo: '손 입금' }, DAY)
        }
      }
      // 범위 이벤트 기록을 코어로 재생해 센다
      const pg = world.database.pglite as PGlite
      const rows = (await pg.query<{ body: string; rehearsal: boolean; failed: boolean }>(
        `select e.body, s.rehearsal, e.failed from events e join scopes s on s.id = e.scope_id where e.seller_id = $1 order by s.rehearsal, e.seq`,
        [seller.sellerId],
      )).rows
      let state: EngineState = initEngine({ broadcasts: [], settings: {} })
      const net = new Map<number, number>()
      for (const row of rows) {
        const event = JSON.parse(row.body) as EngineEvent & { memo?: string; reason?: string }
        if (row.rehearsal) {
          expect(memoNo(event.memo ?? event.reason), '리허설 범위에 입금 확인 기록').toBeNull()
          continue
        }
        if (row.failed) continue
        const before = state
        state = applyEvent(state, event).state
        const no = memoNo(event.type === 'settlement.payment' ? event.memo : event.type === 'settlement.refund' ? event.reason : undefined)
        if (no !== null && state !== before) net.set(no, (net.get(no) ?? 0) + (event.type === 'settlement.payment' ? 1 : -1))
      }
      const all = [...(await deposits(api, 'REVIEW')), ...(await deposits(api, 'AUTO_APPLIED')), ...(await deposits(api, 'APPLIED')), ...(await deposits(api, 'IGNORED'))]
      for (const item of all) {
        const count = net.get(item.no) ?? 0
        expect([0, 1], `입금 #${String(item.no)}`).toContain(count)
        expect(count === 1, `입금 #${String(item.no)} 상태 ${item.status}`).toBe(item.status === 'AUTO_APPLIED' || item.status === 'APPLIED')
      }
      const keys = (await pg.query<{ n: number }>(`select count(*)::int as n from (select seller_id, source_id, external_key, count(*) c from deposits group by 1, 2, 3 having count(*) > 1) d`)).rows[0]?.n
      expect(keys).toBe(0)
    })
  }
})
