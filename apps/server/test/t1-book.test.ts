// T1 택배 접수 서버 시험: AC-T1-20·21(가짜 택배사·결과 나누기), AC-T1-22(접수 목록), AC-T1-30~37(한 번에 접수·같은 요청·동시에·일부 실패·멈춘 시도·포장 명령·손으로·취소).
import { describe, expect, it } from 'vitest'
import { productionServerOptions } from '../src/production.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { createServer } from '../src/server.ts'
import { pack } from './i2-support.ts'
import { client, fakeClock, rid } from './support.ts'
import {
  ADDRESS,
  D,
  SENDER,
  attempts,
  bookOk,
  dayRows,
  expect200,
  makeReady,
  packAll,
  packingKinds,
  parcelApi,
  parcelSeller,
  parcelWorld,
  pay,
  rowOf,
  sell,
  sellerAddress,
  totalOf,
  type BookResult,
} from './t1-support.ts'

describe('AC-T1-20 가짜 택배사', () => {
  it('같은 요청 번호면 같은 송장번호, 새 요청 번호면 새 12자리(9로 시작), 취소는 접수됨일 때만, 조회는 시험이 넘긴 상태, 받은 요청을 읽을 수 있다', async () => {
    const world = await parcelWorld()
    const adapter = world.carrier.adapter()
    const request = { requestKey: 'k1', customerNo: null, receiver: { ...ADDRESS, phone: '01012345678' }, sender: SENDER, box: '소' as const, count: 2 }
    const first = await adapter.book(request)
    const again = await adapter.book(request)
    const other = await adapter.book({ ...request, requestKey: 'k2' })
    expect(first).toEqual({ kind: 'BOOKED', invoice: '900000000001' })
    expect(again).toEqual(first)
    expect(other).toEqual({ kind: 'BOOKED', invoice: '900000000002' })
    expect(world.carrier.requests.filter((item) => item.op === 'book').map((item) => item.requestKey)).toEqual(['k1', 'k1', 'k2'])
    expect(world.carrier.bookingCount).toBe(2)
    world.carrier.setStatus('900000000002', 'PICKED_UP')
    expect(await adapter.cancel('900000000002')).toEqual({ kind: 'REFUSED' })
    expect(await adapter.cancel('900000000001')).toEqual({ kind: 'CANCELLED' })
    const tracked = await (adapter.track as NonNullable<typeof adapter.track>)(['900000000001', '900000000002', '999999999999'])
    expect(tracked.ok && [...tracked.items.entries()]).toEqual([['900000000002', 'PICKED_UP']])
    expect(adapter.trackUrl('900000000001')).toBe(`${world.carrier.url}/track/900000000001`)
  })

  it('운영 기동 옵션에는 택배사 어댑터가 없고, 우체국 연동 키가 있어도 쓰지 않고 경고만 남긴다', async () => {
    const world = await parcelWorld()
    const env = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: 'https://app.example.com', LIVEJJIM_EPOST_API_KEY: 'epost-secret-value' }
    const assembled = productionServerOptions(env, world.database)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    expect(assembled.options.parcel).toEqual({ carriers: {} })
    expect(assembled.options.startupWarnings).toEqual(['PARCEL_CARRIER_NOT_READY'])
    const logs: unknown[] = []
    const server = createServer({ ...assembled.options, log: (record) => logs.push(record) })
    expect(server.parcels.available('FAKE')).toBe(false)
    expect(server.parcels.available('EPOST')).toBe(false)
    expect(logs).toContainEqual({ level: 'warn', code: 'PARCEL_CARRIER_NOT_READY' })
    expect(JSON.stringify(logs)).not.toContain('epost-secret-value')
    server.close()
    expect(productionServerOptions({ ...env, LIVEJJIM_EPOST_API_KEY: '' }, world.database)).toMatchObject({ ok: true, options: { parcel: { carriers: {} } } })
  })

  it('운영 기동(가짜 택배사를 붙이지 않은 서버)에서는 가짜 택배를 고를 수 없고 우체국은 준비 중', async () => {
    const world = await parcelWorld({ overrides: { parcel: {} } })
    const seller = await parcelSeller(world, {})
    const api = parcelApi(world, seller.cookie)
    const settings = await expect200(api.settings())
    expect(settings.body.settings).toMatchObject({ carrier: null, carriers: [{ code: 'EPOST', name: '우체국 택배', available: false, note: '준비 중' }] })
    const fake = await api.putSettings({ carrier: 'FAKE' })
    expect(fake.status).toBe(400)
    expect(fake.text).toContain('가짜 택배는 시험 모드에서만 고를 수 있어요.')
    const epost = await api.putSettings({ carrier: 'EPOST' })
    expect(epost.status).toBe(400)
    expect(epost.text).toContain('우체국 택배는 아직 준비 중이에요.')
  })
})

describe('AC-T1-21 어댑터 결과 나누기', () => {
  it('주소 거절 → FAILED/ADDRESS, 그 밖 거절 → FAILED/REJECTED, 응답 없음·500·송장 형식 틀림 → UNKNOWN, 원래 글은 저장하지 않는다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
      ['UC_D', '라온', 1],
      ['UC_E', '마루', 1],
    ])
    await makeReady(world, seller, 'UC_A', { ...ADDRESS, address: '서울 [주소거절] 1' })
    await makeReady(world, seller, 'UC_B', { ...ADDRESS, address: '서울 [접수거절] 1' })
    await makeReady(world, seller, 'UC_C', { ...ADDRESS, address: '서울 [응답없음] 1' })
    await makeReady(world, seller, 'UC_D', { ...ADDRESS, address: '서울 [서버오류] 1' })
    await makeReady(world, seller, 'UC_E', { ...ADDRESS, address: '서울 [송장이상] 1' })
    const results = await bookOk(world, seller, ['UC_A', 'UC_B', 'UC_C', 'UC_D', 'UC_E'].map((buyer) => ({ buyer })))
    expect(results).toEqual([
      { buyer: 'UC_A', ok: false, reason: 'ADDRESS', message: '택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.' },
      { buyer: 'UC_B', ok: false, reason: 'REJECTED', message: '택배사가 접수를 받지 않았어요.' },
      { buyer: 'UC_C', ok: false, reason: 'UNAVAILABLE', message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' },
      { buyer: 'UC_D', ok: false, reason: 'UNAVAILABLE', message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' },
      { buyer: 'UC_E', ok: false, reason: 'UNAVAILABLE', message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' },
    ])
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => [row.state, row.reason])).toEqual([['FAILED', 'ADDRESS']])
    expect((await attempts(world, seller.sellerId, 'UC_C')).map((row) => [row.state, row.reason])).toEqual([['UNKNOWN', 'UNAVAILABLE']])
    // 택배사 원래 글(받은 주소를 되돌려 준 오류 본문)은 DB 어디에도 없다
    const dump = JSON.stringify((await world.database.pglite?.query('select * from parcels'))?.rows)
    expect(dump).not.toContain('받은 주소')
    expect(dump).not.toContain('INV-')
  })
})

describe('AC-T1-22 접수 목록 API', () => {
  it('고를 수 있음·빠짐(이유와 문장)·접수함, 줄마다 이름·품목 수·금액·입금·포장 말, 일괄 순서. 보내는 사람·택배사가 없으면 blocked와 접수 409', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_1', '가가', 1],
      ['UC_2', '나나', 1],
      ['UC_3', '다다', 1],
      ['UC_4', '라라', 1],
      ['UC_5', '마마', 1],
      ['UC_6', '바바', 1],
    ])
    await makeReady(world, seller, 'UC_1')
    // ② 부분 입금
    await pay(world, seller, 'UC_2', 500)
    await packAll(world, seller, 'UC_2')
    await sellerAddress(world, seller, 'UC_2')
    // ③ 포장 대기
    await pay(world, seller, 'UC_3')
    await sellerAddress(world, seller, 'UC_3')
    // ④ 배송지 확인 전 (구매자가 적은 것 — 서비스로 바로)
    await pay(world, seller, 'UC_4')
    await packAll(world, seller, 'UC_4')
    expect((await world.server.parcels.saveFromLink(seller.sellerId, D, 'UC_4', { ...ADDRESS })).kind).toBe('saved')
    // ⑤ 직접 수령
    expect((await client(world, seller.cookie).post(`/api/events?date=${D}`, { requestId: rid('ov'), type: 'settlement.shippingOverride', buyer: 'UC_5', date: D, mode: 'PICKUP' })).status).toBe(200)
    // ⑥ 접수함
    await makeReady(world, seller, 'UC_6')
    expect((await bookOk(world, seller, [{ buyer: 'UC_6' }]))[0]?.ok).toBe(true)

    const rows = await dayRows(world, seller)
    expect(rows.blocked).toBeNull()
    expect(rows.ready.map((row) => [row.buyer, row.box])).toEqual([['UC_1', '소']])
    expect(rows.excluded.map((row) => [row.buyer, row.reason, row.message])).toEqual([
      ['UC_2', 'NOT_PAID', '입금 완료 전이에요'],
      ['UC_3', 'NOT_PACKED', '포장 전이에요'],
      ['UC_4', 'ADDRESS_UNCONFIRMED', '배송지를 확인해 주세요'],
      ['UC_5', 'PICKUP', '직접 수령이에요'],
    ])
    const booked = rows.booked[0]
    expect(booked?.buyer).toBe('UC_6')
    expect(booked?.parcel).toMatchObject({ state: 'BOOKED', invoiceText: '9000-0000-0001', status: '접수됨', cancellable: true })
    expect(typeof booked?.parcel?.checkedAt).toBe('string')
    const one = rows.ready[0] as unknown as Record<string, unknown>
    expect(one).toMatchObject({ name: '가가', itemCount: 1, qty: 1, total: await totalOf(world, seller, 'UC_1'), payment: 'PAID', packing: '포장 완료', address: 'CONFIRMED' })

    // 보내는 사람을 지우면 blocked, 접수 409
    await expect200(parcelApi(world, seller.cookie).putSettings({ sender: null }))
    expect((await dayRows(world, seller)).blocked).toEqual({ code: 'NO_SENDER', message: '보내는 사람 정보를 먼저 적어 주세요.' })
    const refused = await parcelApi(world, seller.cookie).book([{ buyer: 'UC_1' }])
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('보내는 사람 정보를 먼저 적어 주세요.')
    await expect200(parcelApi(world, seller.cookie).putSettings({ carrier: null, sender: SENDER }))
    expect((await dayRows(world, seller)).blocked).toEqual({ code: 'NO_CARRIER', message: '택배사를 먼저 이어 주세요.' })
    expect((await parcelApi(world, seller.cookie).book([{ buyer: 'UC_1' }])).status).toBe(409)
    expect(world.carrier.requests.filter((item) => item.op === 'book')).toHaveLength(1)
  })

  it('날짜 목록에는 실제 범위 날짜만(리허설 없음), 기본 날짜는 고를 수 있는 묶음이 있는 가장 최근 날짜', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]], '2026-10-17')
    await sell(world, seller, [['UC_B', '나래', 1]], '2026-10-18')
    await sell(world, seller, [['UC_C', '다솜', 1]], '2026-10-19', { rehearsal: true })
    await makeReady(world, seller, 'UC_A', ADDRESS, '2026-10-17')
    const days = await expect200(parcelApi(world, seller.cookie).days())
    expect(days.body).toEqual({
      dates: [
        { date: '2026-10-18', ready: 0, booked: 0 },
        { date: '2026-10-17', ready: 1, booked: 0 },
      ],
      selected: '2026-10-17',
    })
    // 리허설 범위: 목록은 404, 쓰기는 409
    expect((await parcelApi(world, seller.cookie).day('2026-10-19', '?rehearsal=true')).status).toBe(404)
    expect((await parcelApi(world, seller.cookie).book([{ buyer: 'UC_C' }], '2026-10-19')).status).toBe(409)
    expect((await parcelApi(world, seller.cookie).putAddress('UC_C', ADDRESS, '2026-10-19')).status).toBe(409)
    expect((await parcelApi(world, seller.cookie).book([{ buyer: 'UC_A' }], '2026-10-17', rid('pb'), '?rehearsal=true')).status).toBe(409)
  })
})

describe('AC-T1-30 한 번에 접수', () => {
  it('묶음마다 시도 하나(PENDING → BOOKED, 서로 다른 무작위 요청 번호), 같은 트랜잭션에 포장 기록 배송 완료 — 판매대장 배송 칸·포장 상태·접수함', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 2],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    for (const buyer of ['UC_A', 'UC_B', 'UC_C']) await makeReady(world, seller, buyer)
    const results = await bookOk(world, seller, [{ buyer: 'UC_A', box: '중' }, { buyer: 'UC_B', box: '극소' }, { buyer: 'UC_C' }])
    expect(results.map((item) => [item.buyer, item.ok])).toEqual([
      ['UC_A', true],
      ['UC_B', true],
      ['UC_C', true],
    ])
    expect(new Set(results.map((item) => item.invoice)).size).toBe(3)
    for (const item of results) {
      expect(item.invoice).toMatch(/^9\d{11}$/)
      expect(item.invoiceText).toBe((item.invoice as string).replace(/(\d{4})(?=\d)/g, '$1-'))
    }
    const keys = new Set<string>()
    for (const buyer of ['UC_A', 'UC_B', 'UC_C']) {
      const rows = await attempts(world, seller.sellerId, buyer)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.state).toBe('BOOKED')
      keys.add(rows[0]?.request_key as string)
      expect(rows[0]?.request_key).not.toContain('010')
      expect(await packingKinds(world, seller.sellerId, buyer)).toEqual([
        { kind: 'PACKED', invoice: null, account_id: seller.accountId },
        { kind: 'SHIPPED', invoice: rows[0]?.invoice, account_id: seller.accountId },
      ])
    }
    expect(keys.size).toBe(3)
    expect((await attempts(world, seller.sellerId, 'UC_A'))[0]).toMatchObject({ box: '중', qty: 2 })
    // 택배사에 보낸 요청: 받는 분 여섯 칸·보내는 사람·상자·물품 N개만 (품종·가격·구매자 ID·닉네임 없음)
    for (const request of world.carrier.requests.filter((item) => item.op === 'book')) {
      const body = request.body as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual(['box', 'count', 'customerNo', 'item', 'receiver', 'requestKey', 'sender'])
      expect(Object.keys(body.receiver as object).sort()).toEqual(['address', 'detail', 'memo', 'name', 'phone', 'zip'])
      const text = JSON.stringify(body)
      expect(text).not.toMatch(/품종|UC_|가람|나래|다솜|1000|2000/)
      expect(body.item).toMatch(/^물품 [12]개$/)
    }
    // 포장 상태·판매대장 배송 칸 재료
    const packing = await client(world, seller.cookie).get(`/api/days/${D}/packing`)
    const entryA = (packing.body.entries as { buyer: string; status: string; invoice: string; parcel: Record<string, unknown> }[]).find((item) => item.buyer === 'UC_A')
    expect(entryA).toMatchObject({ status: '배송 완료', parcel: { status: '접수됨' } })
    const rows = await dayRows(world, seller)
    expect(rows.booked.map((row) => row.buyer).sort()).toEqual(['UC_A', 'UC_B', 'UC_C'])
    expect(rows.ready).toEqual([])
  })

  it('한 번에 201개는 400이고 아무것도 접수하지 않는다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const items = Array.from({ length: 201 }, (_, i) => ({ buyer: i === 0 ? 'UC_A' : `UC_${String(i)}x` }))
    const response = await parcelApi(world, seller.cookie).book(items)
    expect(response.status).toBe(400)
    expect(response.text).toContain('한 번에 200개까지 접수할 수 있어요.')
    expect(world.carrier.requests).toEqual([])
  })
})

describe('AC-T1-31 같은 요청 다시·접수 직전 다시 판단', () => {
  it('같은 화면 요청 번호면 택배사에 새 요청이 가지 않고 처음 결과, 목록 뒤 입금을 되돌린 묶음은 시도 없이 NOT_PAID', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    expect((await dayRows(world, seller)).ready.map((row) => row.buyer)).toEqual(['UC_A', 'UC_B'])
    // 목록을 본 뒤 B의 입금을 일부 되돌린다 (환불 → 부분 입금)
    const refund = await client(world, seller.cookie).post(`/api/events?date=${D}`, { requestId: rid('rf'), type: 'settlement.refund', buyer: 'UC_B', date: D, amount: 100, reason: '되돌림' })
    expect(refund.status, refund.text).toBe(200)
    const requestId = rid('pb')
    const first = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }], D, requestId)
    expect(first).toEqual([
      { buyer: 'UC_A', ok: true, invoice: '900000000001', invoiceText: '9000-0000-0001' },
      { buyer: 'UC_B', ok: false, reason: 'NOT_PAID', message: '입금 완료 전이에요' },
    ])
    expect(await attempts(world, seller.sellerId, 'UC_B')).toEqual([])
    const sent = world.carrier.requests.length
    const again = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }], D, requestId)
    expect(again).toEqual(first)
    expect(world.carrier.requests).toHaveLength(sent)
    // 같은 요청 번호를 다른 날짜·다른 일에 쓰면 409
    expect((await parcelApi(world, seller.cookie).cancel('UC_A', D, requestId)).status).toBe(409)
  })
})

describe('AC-T1-32 두 기기에서 동시에', () => {
  it('서로 다른 화면 요청 번호로 같은 순간 20번 — 택배사가 받은 접수 요청 번호는 하나, 살아 있는 시도 하나, 배송 완료 기록 하나', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const api = parcelApi(world, seller.cookie)
    const all: BookResult[] = []
    for (let round = 0; round < 20; round++) {
      const [pc, phone] = await Promise.all([api.book([{ buyer: 'UC_A' }], D, rid('pc')), api.book([{ buyer: 'UC_A' }], D, rid('ph'))])
      for (const response of [pc, phone]) {
        expect(response.status, response.text).toBe(200)
        all.push(...(response.body.results as BookResult[]))
      }
    }
    const keys = new Set(world.carrier.requests.filter((item) => item.op === 'book').map((item) => item.requestKey))
    expect(keys.size).toBe(1)
    expect(world.carrier.bookingCount).toBe(1)
    const rows = await attempts(world, seller.sellerId, 'UC_A')
    expect(rows.filter((row) => ['PENDING', 'UNKNOWN', 'BOOKED'].includes(row.state))).toHaveLength(1)
    expect((await packingKinds(world, seller.sellerId, 'UC_A')).filter((row) => row.kind === 'SHIPPED')).toHaveLength(1)
    expect(all.filter((item) => item.ok)).toHaveLength(1)
    for (const item of all.filter((result) => !result.ok)) expect(['BOOKING', 'BOOKED']).toContain(item.reason)
  })
})

describe('AC-T1-33 일부 실패와 실패한 것만 다시', () => {
  it('A 접수·B 주소 거절·C 응답 없음(택배사는 실제로 접수) → 실패한 것만 다시: A에는 요청 없음, B는 새 요청 번호, C는 같은 요청 번호로 같은 송장', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B', { ...ADDRESS, address: '없는 동네 [주소거절]' })
    await makeReady(world, seller, 'UC_C', { ...ADDRESS, address: '서울 중구 [접수후응답없음]' })
    const first = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }, { buyer: 'UC_C' }])
    expect(first.map((item) => [item.buyer, item.ok, item.reason ?? item.invoice])).toEqual([
      ['UC_A', true, expect.stringMatching(/^9\d{11}$/)],
      ['UC_B', false, 'ADDRESS'],
      ['UC_C', false, 'UNAVAILABLE'],
    ])
    const invoiceA = first[0]?.invoice
    const keyB = (await attempts(world, seller.sellerId, 'UC_B'))[0]?.request_key
    const keyC = (await attempts(world, seller.sellerId, 'UC_C'))[0]?.request_key
    const cBooked = world.carrier.bookingOf(keyC as string)
    expect(cBooked).not.toBeNull()
    // B의 배송지를 고친다 (FAILED는 살아 있는 시도가 아니라 고칠 수 있다)
    await expect200(parcelApi(world, seller.cookie).putAddress('UC_B', ADDRESS))
    world.carrier.reset()
    const retry = await bookOk(world, seller, [{ buyer: 'UC_B' }, { buyer: 'UC_C' }, { buyer: 'UC_A' }])
    const sentKeys = world.carrier.requests.filter((item) => item.op === 'book').map((item) => item.requestKey)
    expect(sentKeys).toHaveLength(2)
    expect(sentKeys).toContain(keyC)
    expect(sentKeys).not.toContain(keyB)
    expect(retry.find((item) => item.buyer === 'UC_C')).toMatchObject({ ok: true, invoice: cBooked?.invoice })
    expect(retry.find((item) => item.buyer === 'UC_B')).toMatchObject({ ok: true })
    expect(retry.find((item) => item.buyer === 'UC_A')).toMatchObject({ ok: false, reason: 'BOOKED' })
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.invoice)).toEqual([invoiceA])
    expect((await attempts(world, seller.sellerId, 'UC_B')).map((row) => row.state)).toEqual(['FAILED', 'BOOKED'])
    expect((await attempts(world, seller.sellerId, 'UC_C')).map((row) => row.state)).toEqual(['BOOKED'])
  })

  it('어댑터 시간 제한이 지나면 그 묶음은 UNKNOWN이고 다른 묶음은 계속한다', async () => {
    const world = await parcelWorld({ timeoutMs: 200 })
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A', { ...ADDRESS, address: '서울 [응답없음]' })
    await makeReady(world, seller, 'UC_B')
    const results = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }])
    expect(results.map((item) => [item.buyer, item.ok ? 'BOOKED' : item.reason])).toEqual([
      ['UC_A', 'UNAVAILABLE'],
      ['UC_B', 'BOOKED'],
    ])
    expect(world.logs.some((record) => record.code === 'PARCEL_BOOK_UNKNOWN')).toBe(true)
  })
})

describe('AC-T1-34 멈춘 시도', () => {
  it('PENDING이 남으면 2분 전에는 BOOKING(다시 보내지 않음), 2분이 지나면 UNKNOWN으로 보이고 다시 확인은 같은 요청 번호', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    // 서버가 보내다 멈춘 시도: PENDING 행을 직접 만든다 (택배사에는 가지 않았다)
    await world.database.pglite?.query(
      `insert into parcels (id, seller_id, date, buyer, carrier, request_key, state, box, qty, created_at, updated_at) values ('pc_stuck', $1, $2, 'UC_A', 'FAKE', 'lj-stuck', 'PENDING', '소', 1, $3, $3)`,
      [seller.sellerId, D, new Date(clock.now()).toISOString()],
    )
    clock.advance(60_000)
    expect((await rowOf(world, seller, 'UC_A')).reason).toBe('BOOKING')
    expect(await bookOk(world, seller, [{ buyer: 'UC_A' }])).toEqual([{ buyer: 'UC_A', ok: false, reason: 'BOOKING', message: '접수 결과를 기다리고 있어요' }])
    expect(world.carrier.requests).toEqual([])
    clock.advance(61_000)
    const row = await rowOf(world, seller, 'UC_A')
    expect(row.parcel).toMatchObject({ state: 'UNKNOWN', message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' })
    const results = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    expect(results[0]).toMatchObject({ ok: true })
    expect(world.carrier.requests.map((item) => item.requestKey)).toEqual(['lj-stuck'])
  })
})

describe('AC-T1-35·36 포장 명령과 손으로 적는 길', () => {
  it('BOOKED이면 포장 취소·배송 취소·배송 완료(손)는 409이고 기록이 늘지 않는다, 접수가 없는 묶음은 지금과 같다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await bookOk(world, seller, [{ buyer: 'UC_A' }])
    const before = await packingKinds(world, seller.sellerId, 'UC_A')
    for (const body of [{ action: 'unpack' }, { action: 'unship' }, { action: 'ship', invoice: '123456789012' }]) {
      const response = await pack(world, seller, D, { buyer: 'UC_A', ...body })
      expect(response.status, body.action).toBe(409)
      expect(response.text).toContain('택배 접수를 먼저 취소해 주세요.')
    }
    expect(await packingKinds(world, seller.sellerId, 'UC_A')).toEqual(before)
    // 손으로: 택배사 없이 배송 완료·송장번호 → 접수 목록에서 SHIPPED로 빠진다
    await pay(world, seller, 'UC_B')
    await packAll(world, seller, 'UC_B')
    expect((await pack(world, seller, D, { buyer: 'UC_B', action: 'ship', invoice: '5555-6666-7777' })).status).toBe(200)
    await sellerAddress(world, seller, 'UC_B')
    expect(await rowOf(world, seller, 'UC_B')).toMatchObject({ reason: 'SHIPPED', message: '배송 완료로 적혀 있어요' })
  })
})

describe('AC-T1-37 접수 취소', () => {
  it('접수됨이면 택배사 취소 → CANCELLED + 포장 기록 배송 취소(→ 포장 완료), 다시 고를 수 있음, 다시 접수는 새 요청 번호·새 송장, 취소한 운송장은 409', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const [booked] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    const api = parcelApi(world, seller.cookie)
    const cancelled = await expect200(api.cancel('UC_A'))
    expect(cancelled.body.bundle).toMatchObject({ row: { ready: true, packing: '포장 완료', parcel: { state: 'CANCELLED', status: '접수 취소됨' } } })
    expect(world.carrier.statusOf(booked?.invoice as string)).toBe('CANCELLED')
    expect((await packingKinds(world, seller.sellerId, 'UC_A')).map((row) => row.kind)).toEqual(['PACKED', 'SHIPPED', 'UNSHIPPED'])
    const waybill = await api.waybill('UC_A')
    expect(waybill.status).toBe(409)
    expect(await waybill.text()).toContain('접수한 택배가 없어요.')
    const [again] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    expect(again?.ok).toBe(true)
    expect(again?.invoice).not.toBe(booked?.invoice)
    const rows = await attempts(world, seller.sellerId, 'UC_A')
    expect(rows.map((row) => row.state)).toEqual(['CANCELLED', 'BOOKED'])
    expect(rows[0]?.request_key).not.toBe(rows[1]?.request_key)
  })

  it('집하 뒤면 택배사에 보내지 않고 409, 택배사가 거절해도 409, 응답이 없으면 BOOKED 그대로 "취소됐는지 아직 몰라요"', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    const results = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }])
    const invoiceB = results.find((item) => item.buyer === 'UC_B')?.invoice as string
    world.carrier.setStatus(invoiceB, 'PICKED_UP')
    await world.server.parcels.trackOnce()
    world.carrier.reset()
    const api = parcelApi(world, seller.cookie)
    const picked = await api.cancel('UC_B')
    expect(picked.status).toBe(409)
    expect(picked.text).toContain('택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요.')
    expect(world.carrier.requests.filter((item) => item.op === 'cancel')).toEqual([])
    // 택배사가 거절
    world.carrier.failNext('cancel', 'REFUSED')
    const refused = await api.cancel('UC_A')
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('택배사가 이미 가져갔어요.')
    // 응답 없음
    world.carrier.failNext('cancel', 'TIMEOUT')
    const unknown = await api.cancel('UC_A')
    expect(unknown.status).toBe(503)
    expect(unknown.text).toContain('취소됐는지 아직 몰라요. 잠시 뒤 다시 해 주세요.')
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.state)).toEqual(['BOOKED'])
    expect((await attempts(world, seller.sellerId, 'UC_B')).map((row) => row.state)).toEqual(['BOOKED'])
  })
})
