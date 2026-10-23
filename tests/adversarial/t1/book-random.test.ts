// T1 적대 시험 (test-domain): 택배 접수·취소·조회·포장 명령·구매자 양식·판매자 확인을 무작위로 섞고 매 단계 불변식을 본다 (PC-INV-1, AC-T1-30~37).
// 섞는 것: 한 번에 접수(같은 순간 두 기기 포함, 택배사 실패 주입: 주소 거절·그 밖 거절·응답 없음·접수 뒤 응답 없음·500·송장 이상),
// 취소(응답 없음·500·거절 주입), 택배사 집하, 시계 3분 넘기기(멈춘 시도), 포장 취소, 구매자 링크로 배송지 다시 적기, 판매자 배송지 확인.
// 매 단계:
//  - 묶음마다 우리 쪽 살아 있는 시도(PENDING·UNKNOWN·BOOKED) ≤ 1
//  - 택배사 쪽 살아 있는 접수(취소 안 된 것) ≤ 1, 택배사가 접수한 시도는 우리 쪽에서도 살아 있다(FAILED·CANCELLED로 잊지 않는다)
//  - BOOKED ⇔ 포장 기록이 "배송 완료 — 그 송장"
//  - 확인하지 않은 배송지로 택배사에 새 요청 번호가 가지 않는다
// 처음 라운드에서 찾은 반례(같은 요청 번호에 주입한 거절이 듣던 일 — 택배사엔 접수, 우리 기록은 FAILED)는 7a2a9cf에서 고쳤고 이 시험이 다시 본다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { linkApi, tokenOf } from '../../../apps/server/test/n4b-support.ts'
import { ORIGIN, client, fakeClock, rid } from '../../../apps/server/test/support.ts'
import { ADDRESS, D, attempts, makeReady, packingKinds, parcelApi, parcelSeller, parcelWorld, sell } from '../../../apps/server/test/t1-support.ts'
import { replayPacking } from '../../../apps/server/src/packing.ts'

const BUYERS = ['UC_A', 'UC_B', 'UC_C'] as const
type Op =
  | { k: 'book'; who: number[]; fail: string | null; dup: boolean }
  | { k: 'cancel'; who: number; fail: string | null }
  | { k: 'pick'; who: number }
  | { k: 'wait' }
  | { k: 'unpack'; who: number }
  | { k: 'buyerEdit'; who: number }
  | { k: 'confirm'; who: number }

const who = fc.integer({ min: 0, max: 2 })
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      k: fc.constant('book' as const),
      who: fc.uniqueArray(who, { minLength: 1, maxLength: 3 }),
      fail: fc.constantFrom(null, null, 'ADDRESS', 'REJECTED', 'TIMEOUT', 'TIMEOUT_AFTER_BOOK', 'ERROR_500', 'BAD_INVOICE'),
      dup: fc.boolean(),
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ k: fc.constant('cancel' as const), who, fail: fc.constantFrom(null, null, 'TIMEOUT', 'ERROR_500', 'REFUSED') }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant('pick' as const), who }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constant('wait' as const) }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constant('unpack' as const), who }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constant('buyerEdit' as const), who }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constant('confirm' as const), who }), weight: 1 },
)

describe('TD-T1 무작위 접수 열', () => {
  it('어떤 순서로 섞어도 묶음마다 살아 있는 접수는 하나, 택배사와 우리 기록·포장 기록이 맞고, 확인 전 배송지로 새 접수가 가지 않는다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 3, maxLength: 9 }), async (ops) => {
        const clock = fakeClock()
        const world = await parcelWorld({ timeoutMs: 250, clock })
        try {
          const s = await parcelSeller(world)
          await sell(world, s, BUYERS.map((b, i) => [b, `n${String(i)}`, 1] as const))
          const tokens: string[] = []
          for (const b of BUYERS) {
            await makeReady(world, s, b)
            const created = await linkApi(world, s.cookie).create(D, b)
            tokens.push(tokenOf((created.body.link as { url: string }).url))
          }
          const api = parcelApi(world, s.cookie)
          /** 택배사에 이미 간 요청 번호 (다시 확인은 같은 번호라 허용) */
          const seenKeys = new Set<string>()
          for (const op of ops) {
            const confirmedBefore = new Map<string, boolean>()
            for (const b of BUYERS) {
              const bundle = await api.bundle(b)
              confirmedBefore.set(b, (bundle.body.bundle as { address: { confirmed: boolean } | null }).address?.confirmed === true)
            }
            const before = world.carrier.requests.length
            if (op.k === 'book') {
              if (op.fail !== null) world.carrier.failNext('book', op.fail as never)
              const items = op.who.map((i) => ({ buyer: BUYERS[i] as string }))
              await Promise.all((op.dup ? [1, 2] : [1]).map(() => api.book(items)))
            } else if (op.k === 'cancel') {
              if (op.fail !== null) world.carrier.failNext('cancel', op.fail as never)
              await api.cancel(BUYERS[op.who] as string)
            } else if (op.k === 'pick') {
              const rows = await attempts(world, s.sellerId, BUYERS[op.who] as string)
              const invoice = rows.find((r) => r.state === 'BOOKED')?.invoice
              if (invoice) {
                world.carrier.setStatus(invoice, 'PICKED_UP')
                await world.server.parcels.trackOnce()
              }
            } else if (op.k === 'wait') {
              clock.advance(3 * 60 * 1000)
            } else if (op.k === 'unpack') {
              await client(world, s.cookie).post(`/api/days/${D}/packing`, { requestId: rid('pk'), buyer: BUYERS[op.who], action: 'unpack' })
            } else if (op.k === 'buyerEdit') {
              clock.advance(1000)
              await world.server.app.request(`/r/${tokens[op.who] as string}/address`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
                body: new URLSearchParams({ ...ADDRESS, name: `고침${String(clock.now() % 100000)}` }).toString(),
              })
            } else {
              const bundle = await api.bundle(BUYERS[op.who] as string)
              const address = (bundle.body.bundle as { address: { updatedAt: string } | null }).address
              if (address !== null) await api.confirm(BUYERS[op.who] as string, address.updatedAt)
            }
            // 확인 전 배송지로 새 요청 번호가 가지 않는다
            for (const request of world.carrier.requests.slice(before)) {
              if (request.op !== 'book' || request.requestKey === null) continue
              if (!seenKeys.has(request.requestKey)) {
                const body = JSON.stringify(request.body)
                const buyer = BUYERS.find((b) => body.includes(`"${b}"`))
                expect(buyer, '택배사 요청에 구매자 ID가 있다').toBeUndefined()
                const owner = await world.database.pglite?.query<{ buyer: string }>('select buyer from parcels where request_key = $1', [request.requestKey])
                const ownerBuyer = owner?.rows[0]?.buyer as string
                expect(confirmedBefore.get(ownerBuyer), `${ownerBuyer} 확인 전 배송지로 새 접수 ${JSON.stringify(ops)}`).toBe(true)
              }
              seenKeys.add(request.requestKey)
            }
            for (const b of BUYERS) {
              const rows = await attempts(world, s.sellerId, b)
              const live = rows.filter((r) => ['PENDING', 'UNKNOWN', 'BOOKED'].includes(r.state))
              expect(live.length, `${b} 살아 있는 시도 ${JSON.stringify(ops)} ${JSON.stringify(rows)}`).toBeLessThanOrEqual(1)
              const active = rows.filter((r) => {
                const booking = world.carrier.bookingOf(r.request_key)
                return booking !== null && booking.status !== 'CANCELLED'
              })
              expect(active.length, `${b} 택배사 쪽 살아 있는 접수 ${JSON.stringify(ops)} ${JSON.stringify(rows)}`).toBeLessThanOrEqual(1)
              for (const r of active) expect(['PENDING', 'UNKNOWN', 'BOOKED'], `${b} 택배사는 접수했는데 ${r.state} ${JSON.stringify(ops)}`).toContain(r.state)
              const packing = replayPacking((await packingKinds(world, s.sellerId, b)).map((p) => ({ kind: p.kind as never, items: null, invoice: p.invoice })))
              const booked = rows.find((r) => r.state === 'BOOKED')
              if (booked) expect(packing.phase === 'SHIPPED' && packing.invoice === booked.invoice, `${b} 포장 기록 ${JSON.stringify(ops)}`).toBe(true)
              else expect(packing.phase, `${b} 접수 없는데 배송 완료 ${JSON.stringify(ops)} ${JSON.stringify(rows)}`).not.toBe('SHIPPED')
            }
          }
        } finally {
          await world.server.stop()
        }
      }),
      { numRuns: 40, seed: 7 },
    )
  }, 300_000)
})
