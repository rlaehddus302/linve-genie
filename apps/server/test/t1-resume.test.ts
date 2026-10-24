// TD-T1-002: 요청 번호만 적고(결과 없음) 서버가 멈춘 한 번에 접수를 같은 화면 요청 번호로 다시 보내면
// - 2분(STALE_PENDING_MS) 안에는 지금 시도로 답한다(택배사에 보내지 않음 — 다른 곳에서 처리 중일 수 있다)
// - 2분이 지나면 이어받아 다시 실행한다: 시도 없는 묶음은 지금 다시 판단해 접수, 이미 접수된 묶음은 그 송장번호, 두 번 접수되지 않는다
import { describe, expect, it } from 'vitest'
import { STALE_PENDING_MS } from '../src/parcel/rules.ts'
import { fakeClock, rid, type FakeClock } from './support.ts'
import { D, attempts, bookOk, makeReady, parcelSeller, parcelWorld, rowOf, sell, type ParcelWorld } from './t1-support.ts'
import type { Seller } from './support.ts'

/** 서버가 claimRequest 직후 멈춘 것처럼: 결과 없는 요청 번호 행만 적는다 */
async function strandedRequest(world: ParcelWorld, seller: Seller, clock: FakeClock, targets: unknown[]): Promise<string> {
  const requestId = rid('pb')
  await world.database.pglite?.query(`insert into parcel_requests (seller_id, request_id, date, kind, targets, result, created_at) values ($1, $2, $3, 'BOOK', $4, null, $5)`, [
    seller.sellerId,
    requestId,
    D,
    JSON.stringify(targets),
    new Date(clock.now()).toISOString(),
  ])
  return requestId
}

const bookRequests = (world: ParcelWorld) => world.carrier.requests.filter((item) => item.op === 'book')

describe('TD-T1-002 결과 없이 멈춘 요청 번호', () => {
  it('2분 안에는 기다림, 2분이 지나면 적어 둔 묶음·상자 크기로 다시 실행하고, 그 뒤엔 처음 결과', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const requestId = await strandedRequest(world, seller, clock, [{ buyer: 'UC_A', box: '대' }])
    // 목록은 보낼 수 있다고 보인다
    expect((await rowOf(world, seller, 'UC_A')).ready).toBe(true)
    clock.advance(60_000)
    expect(await bookOk(world, seller, [{ buyer: 'UC_A', box: '대' }], D, requestId)).toEqual([{ buyer: 'UC_A', ok: false, reason: 'BOOKING', message: '접수 결과를 기다리고 있어요' }])
    expect(bookRequests(world)).toEqual([])
    clock.advance(STALE_PENDING_MS)
    const resumed = await bookOk(world, seller, [{ buyer: 'UC_A', box: '대' }], D, requestId)
    expect(resumed).toHaveLength(1)
    expect(resumed[0]).toMatchObject({ buyer: 'UC_A', ok: true })
    expect(bookRequests(world)).toHaveLength(1)
    const rows = await attempts(world, seller.sellerId, 'UC_A')
    expect(rows.map((row) => [row.state, row.box])).toEqual([['BOOKED', '120']]) // FB1 D-FB1-05 옛 낱말 대 → 120
    expect(world.logs.some((record) => record.code === 'PARCEL_BOOK_RESUMED')).toBe(true)
    // 같은 요청 번호 다시: 저장된 결과, 택배사에 새로 가지 않는다
    expect(await bookOk(world, seller, [{ buyer: 'UC_A', box: '대' }], D, requestId)).toEqual(resumed)
    expect(bookRequests(world)).toHaveLength(1)
  })

  it('이미 접수된 묶음은 그 송장번호, 시도 없는 묶음만 접수한다 — 두 번 접수되지 않는다', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    const requestId = await strandedRequest(world, seller, clock, [
      { buyer: 'UC_A', box: null },
      { buyer: 'UC_B', box: '중' },
    ])
    // 멈추기 전에 UC_A는 접수됐다 (다른 요청 번호로 접수해 흉내 낸다)
    const [first] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    expect(first).toMatchObject({ ok: true })
    clock.advance(STALE_PENDING_MS + 1)
    const results = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B', box: '중' }], D, requestId)
    expect(results[0]).toEqual({ buyer: 'UC_A', ok: true, invoice: first?.invoice, invoiceText: first?.invoiceText })
    expect(results[1]).toMatchObject({ buyer: 'UC_B', ok: true })
    expect(bookRequests(world)).toHaveLength(2)
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.state)).toEqual(['BOOKED'])
    expect((await attempts(world, seller.sellerId, 'UC_B')).map((row) => [row.state, row.box])).toEqual([['BOOKED', '100']]) // FB1 D-FB1-05 옛 낱말 중 → 100
  })

  it('이어받을 때도 지금 다시 판단한다 — 접수할 수 없는 묶음(입금 전)은 BOOKING이 아니라 그 이유, 택배사에 가지 않는다', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const requestId = await strandedRequest(world, seller, clock, [{ buyer: 'UC_A', box: null }])
    clock.advance(STALE_PENDING_MS + 1)
    const [result] = await bookOk(world, seller, [{ buyer: 'UC_A' }], D, requestId)
    expect(result).toMatchObject({ buyer: 'UC_A', ok: false, reason: 'NOT_PAID' })
    expect(result?.reason).not.toBe('BOOKING')
    expect(bookRequests(world)).toEqual([])
    expect(await attempts(world, seller.sellerId, 'UC_A')).toEqual([])
  })

  it('UNKNOWN으로 남은 시도는 같은 요청 번호(택배사 접수 키)로 다시 확인한다', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const requestId = await strandedRequest(world, seller, clock, [{ buyer: 'UC_A', box: null }])
    // 보내다 멈춘 시도 (택배사에는 가지 않았다)
    await world.database.pglite?.query(
      `insert into parcels (id, seller_id, date, buyer, carrier, request_key, state, box, qty, created_at, updated_at) values ('pc_stuck', $1, $2, 'UC_A', 'FAKE', 'lj-stuck', 'PENDING', '소', 1, $3, $3)`,
      [seller.sellerId, D, new Date(clock.now()).toISOString()],
    )
    clock.advance(STALE_PENDING_MS + 1)
    const [result] = await bookOk(world, seller, [{ buyer: 'UC_A' }], D, requestId)
    expect(result).toMatchObject({ buyer: 'UC_A', ok: true })
    expect(bookRequests(world).map((item) => item.requestKey)).toEqual(['lj-stuck'])
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.state)).toEqual(['BOOKED'])
  })

  it('두 기기가 함께 다시 보내도 한쪽만 이어받고 택배사에는 한 번만', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const requestId = await strandedRequest(world, seller, clock, [{ buyer: 'UC_A', box: null }])
    clock.advance(STALE_PENDING_MS + 1)
    const [one, two] = await Promise.all([bookOk(world, seller, [{ buyer: 'UC_A' }], D, requestId), bookOk(world, seller, [{ buyer: 'UC_A' }], D, requestId)])
    expect(bookRequests(world)).toHaveLength(1)
    expect(await attempts(world, seller.sellerId, 'UC_A')).toHaveLength(1)
    for (const results of [one, two]) expect(['BOOKING', undefined]).toContain(results?.[0]?.reason)
    expect([one?.[0]?.ok, two?.[0]?.ok]).toContain(true)
  })

  it('예전 모양(구매자 ID 글만)으로 적힌 요청도 이어받고, 상자 크기는 설정값', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const requestId = await strandedRequest(world, seller, clock, ['UC_A'])
    clock.advance(STALE_PENDING_MS + 1)
    expect((await bookOk(world, seller, [{ buyer: 'UC_A' }], D, requestId))[0]).toMatchObject({ ok: true })
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.box)).toEqual(['80']) // FB1 D-FB1-05 기본 80
  })
})
