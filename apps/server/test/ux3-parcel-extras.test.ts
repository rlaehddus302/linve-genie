// 직접 넣은 택배 (D-UX3-38): 방송 판매 기록이 없어도 받는 분을 적어 접수 목록에 넣고, 자동 접수·우체국 직접 접수 송장·접수 취소·운송장·지우기가 같은 규칙으로 된다.
// 엔진 기록·포장 기록과 잇지 않는다(포장 기록 없음). 배송지는 판매자 출처·확인함으로 저장된다.
import { describe, expect, it } from 'vitest'
import { client, rid, type TestServer } from './support.ts'
import { ADDRESS, D, SENDER, attempts, dayRows, expect200, makeReady, packingKinds, parcelApi, parcelSeller, parcelWorld, sell } from './t1-support.ts'

/** 판매 기록이 없는 날짜 */
const E = '2026-10-21'

const putExtra = (world: TestServer, cookie: string, body: Record<string, unknown>, date = E, requestId = rid('pe')) => client(world, cookie).put(`/api/parcels/days/${date}/extra`, { requestId, ...body })
const dropExtra = (world: TestServer, cookie: string, buyer: string, date = E, requestId = rid('pf')) => client(world, cookie).post(`/api/parcels/days/${date}/extra/delete`, { requestId, buyer })

describe('직접 넣은 택배 (D-UX3-38)', () => {
  it('판매 기록이 없는 날짜에 받는 분을 넣으면 그 날짜가 목록에 생기고 "보낼 수 있어요"에 들어간다 — 자동 접수·취소·운송장, 포장 기록 없음', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    // D-UX3-64: 판매 기록도 직접 넣은 택배도 없는 날짜는 404가 아니라 빈 목록
    expect(await dayRows(world, seller, E)).toMatchObject({ ready: [], booked: [], excluded: [] })

    const requestId = rid('pe')
    const made = await putExtra(world, seller.cookie, { address: ADDRESS, qty: 3 }, E, requestId)
    expect(made.status, made.text).toBe(200)
    const bundle = made.body.bundle as { buyer: string; locked: boolean; address: { name: string; phone: string; source: string; confirmed: boolean }; row: Record<string, unknown> }
    expect(bundle.buyer.startsWith('extra:')).toBe(true)
    expect(bundle.address).toMatchObject({ name: '홍길동', phone: '01012345678', source: 'SELLER', confirmed: true })
    expect(bundle.row).toMatchObject({ name: '홍길동', qty: 3, itemCount: 0, ready: true, extra: true, address: 'CONFIRMED' })
    // 같은 요청 번호면 처음 만든 줄의 지금 모습 (두 번 만들지 않는다)
    const again = await putExtra(world, seller.cookie, { address: ADDRESS, qty: 3 }, E, requestId)
    expect((again.body.bundle as { buyer: string }).buyer).toBe(bundle.buyer)

    const days = await expect200(parcelApi(world, seller.cookie).days())
    expect(days.body.dates).toEqual([{ date: E, ready: 1, booked: 0 }])
    expect(days.body.selected).toBe(E)
    const rows = await dayRows(world, seller, E)
    expect(rows.ready.map((row) => row.buyer)).toEqual([bundle.buyer])
    expect(rows.body.seq).toBe(0)

    // 자동 접수 (가짜 택배사) → 접수함, 포장 기록은 없다
    const booked = await expect200(parcelApi(world, seller.cookie).book([{ buyer: bundle.buyer, box: '100' }], E))
    expect(booked.body.results).toMatchObject([{ buyer: bundle.buyer, ok: true }])
    expect(world.carrier.requests).toHaveLength(1)
    expect(world.carrier.requests[0]).toMatchObject({ op: 'book', body: { receiver: { name: '홍길동' }, item: '물품 3개' } })
    expect((await attempts(world, seller.sellerId, bundle.buyer)).map((row) => [row.state, row.qty, row.box])).toEqual([['BOOKED', 3, '100']])
    expect(await packingKinds(world, seller.sellerId, bundle.buyer)).toEqual([])
    const after = await dayRows(world, seller, E)
    expect(after.booked.map((row) => row.buyer)).toEqual([bundle.buyer])
    expect(after.booked[0]?.parcel).toMatchObject({ state: 'BOOKED', cancellable: true })
    expect((await expect200(parcelApi(world, seller.cookie).days())).body.dates).toEqual([{ date: E, ready: 0, booked: 1 }])

    // 접수한 줄은 지울 수 없다(접수 취소가 먼저), 고칠 수도 없다
    expect((await dropExtra(world, seller.cookie, bundle.buyer)).status).toBe(409)
    expect((await putExtra(world, seller.cookie, { buyer: bundle.buyer, address: ADDRESS, qty: 1 })).status).toBe(409)
    // 운송장 PDF (전부·하나)
    const pdf = await parcelApi(world, seller.cookie).waybills(E)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('x-waybill-count')).toBe('1')
    expect((await parcelApi(world, seller.cookie).waybill(bundle.buyer, E)).status).toBe(200)

    // 접수 취소 → 다시 고를 수 있음 → 고치기(물품 수) → 지우기 → 날짜 목록에서 사라진다
    expect((await parcelApi(world, seller.cookie).cancel(bundle.buyer, E)).status).toBe(200)
    expect((await dayRows(world, seller, E)).ready.map((row) => row.buyer)).toEqual([bundle.buyer])
    const edited = await putExtra(world, seller.cookie, { buyer: bundle.buyer, address: { ...ADDRESS, name: '김다육' }, qty: 5 })
    expect(edited.status, edited.text).toBe(200)
    expect((edited.body.bundle as { row: { name: string; qty: number } }).row).toMatchObject({ name: '김다육', qty: 5 })
    const dropped = await dropExtra(world, seller.cookie, bundle.buyer)
    expect(dropped.status, dropped.text).toBe(200)
    expect(dropped.body).toEqual({ buyer: bundle.buyer })
    // D-UX3-64: 판매 기록도 직접 넣은 택배도 없는 날짜는 404가 아니라 빈 목록
    expect(await dayRows(world, seller, E)).toMatchObject({ ready: [], booked: [], excluded: [] })
    expect((await expect200(parcelApi(world, seller.cookie).days())).body.dates).toEqual([])
  })

  it('판매 기록이 있는 날짜에는 묶음 뒤에 붙고, 우체국 직접 접수 송장·자료에도 들어간다. 틀린 입력은 400, 다른 판매자에게는 404', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    await sell(world, seller, [['UC_A', '가람', 2]])
    await makeReady(world, seller, 'UC_A')
    const made = await putExtra(world, seller.cookie, { address: { ...ADDRESS, name: '나래' }, qty: '2' }, D)
    expect(made.status, made.text).toBe(200)
    const extra = (made.body.bundle as { buyer: string }).buyer
    const rows = await dayRows(world, seller, D)
    expect(rows.ready.map((row) => row.buyer)).toEqual(['UC_A', extra])

    const kit = await client(world, seller.cookie).get(`/api/parcels/days/${D}/epost-kit`)
    expect(kit.status, kit.text).toBe(200)
    expect((kit.body.kit as { receivers: { buyer: string; name: string; qty: number }[] }).receivers.map((row) => [row.buyer, row.name, row.qty])).toEqual([
      ['UC_A', '홍길동', 2],
      [extra, '나래', 2],
    ])
    const direct = await client(world, seller.cookie).post(`/api/parcels/days/${D}/direct`, { requestId: rid('pd'), kind: 'COUNTER', items: [{ buyer: extra, invoice: '6070123456789' }] })
    expect(direct.body.results).toEqual([{ buyer: extra, ok: true, invoice: '6070123456789', invoiceText: '6070-1234-5678-9' }])
    expect((await dayRows(world, seller, D)).booked.map((row) => [row.buyer, row.parcel?.state])).toEqual([[extra, 'BOOKED']])
    expect(await packingKinds(world, seller.sellerId, extra)).toEqual([])
    expect(world.carrier.requests).toEqual([])

    const bad = async (body: Record<string, unknown>) => (await putExtra(world, seller.cookie, body, D)).body as { error: { code: string; problems: { field: string; message: string }[] } }
    expect((await bad({ address: ADDRESS, qty: 0 })).error.problems).toEqual([{ field: 'qty', message: '물품 수는 1~999개로 적어 주세요.' }])
    expect((await bad({ address: { ...ADDRESS, name: '' }, qty: 1 })).error.problems[0]?.field).toBe('address.name')
    expect((await bad({ address: ADDRESS, qty: 1, memo: 'x' })).error.code).toBe('UNKNOWN_FIELD')
    expect((await putExtra(world, seller.cookie, { buyer: 'UC_A', address: ADDRESS, qty: 1 }, D)).status).toBe(404)

    const other = await parcelSeller(world)
    expect((await parcelApi(world, other.cookie).bundle(extra, D)).status).toBe(404)
    expect((await dropExtra(world, other.cookie, extra, D)).status).toBe(404)
    expect((await putExtra(world, other.cookie, { buyer: extra, address: ADDRESS, qty: 1 }, D)).status).toBe(404)
    expect((await parcelApi(world, other.cookie).cancel(extra, D)).status).toBe(404)
  })
})
