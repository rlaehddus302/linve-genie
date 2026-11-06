// 앱 안 우체국 화면 (D-UX3-37): 자동 채우기 자료(epost-kit)와 판매자가 인터넷우체국에서 직접 접수한 송장번호 적기(direct).
// 택배사에는 아무것도 보내지 않는다. 송장을 적으면 자동 접수와 같이 접수함·배송 완료가 되고, [접수 취소]는 라이브찜 기록만 지운다.
import { describe, expect, it } from 'vitest'
import { client, rid, type TestServer } from './support.ts'
import { ADDRESS, D, SENDER, attempts, dayRows, makeReady, packingKinds, parcelApi, parcelSeller, parcelWorld, sell } from './t1-support.ts'

const kitOf = (world: TestServer, cookie: string, date = D) => client(world, cookie).get(`/api/parcels/days/${date}/epost-kit`)
const direct = (world: TestServer, cookie: string, body: Record<string, unknown>, date = D) => client(world, cookie).post(`/api/parcels/days/${date}/direct`, { requestId: rid('pd'), ...body })

describe('앱 안 우체국 화면 자료 (D-UX3-37)', () => {
  it('보내는 사람·받는 분 줄(방문접수 파일과 같은 묶음)·파일 — 상태는 바꾸지 않는다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '100' })
    await sell(world, seller, [
      ['UC_A', '가람', 2],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    const response = await kitOf(world, seller.cookie)
    expect(response.status, response.text).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const kit = response.body.kit as { sender: unknown; receivers: unknown[]; file: { name: string; base64: string } }
    expect(kit.sender).toEqual({ ...SENDER, phone: '0311234567' })
    expect(kit.receivers).toEqual([
      { buyer: 'UC_A', name: ADDRESS.name, phone: '01012345678', zip: ADDRESS.zip, address: ADDRESS.address, detail: ADDRESS.detail, memo: ADDRESS.memo, qty: 2, content: '물품 2개', kg: 10, cm: 100 },
    ])
    expect(kit.file.name).toBe(`우체국-방문접수-${D}.xlsx`)
    expect(Buffer.from(kit.file.base64, 'base64').subarray(0, 2).toString()).toBe('PK')
    expect((await dayRows(world, seller)).ready.map((row) => row.buyer)).toEqual(['UC_A'])
    expect(world.carrier.requests).toEqual([])

    const none = await kitOf(world, (await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })).cookie)
    expect(none.status).toBe(404)
  })
})

describe('직접 접수 송장 적기 (D-UX3-37)', () => {
  it('고를 수 있는 묶음에 우체국 송장 → 접수함·배송 완료, 택배사 요청 없음, 같은 요청 번호면 처음 결과', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    const requestId = rid('pd')
    const body = { requestId, kind: 'COUNTER', items: [{ buyer: 'UC_A', invoice: '6070-1234-56789' }, { buyer: 'UC_B', invoice: '6070123456790' }] }
    const first = await client(world, seller.cookie).post(`/api/parcels/days/${D}/direct`, body)
    expect(first.status, first.text).toBe(200)
    expect(first.body.results).toEqual([
      { buyer: 'UC_A', ok: true, invoice: '6070123456789', invoiceText: '6070-1234-5678-9' },
      { buyer: 'UC_B', ok: false, reason: 'NOT_PAID', message: '입금 완료 전이에요' },
    ])
    const again = await client(world, seller.cookie).post(`/api/parcels/days/${D}/direct`, body)
    expect(again.body.results).toEqual(first.body.results)

    const rows = await dayRows(world, seller)
    expect(rows.booked.map((row) => row.buyer)).toEqual(['UC_A'])
    expect(rows.booked[0]?.parcel).toMatchObject({ state: 'BOOKED', invoice: '6070123456789', status: '접수됨', cancellable: true, direct: 'COUNTER' })
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => [row.state, row.request_key.startsWith('direct-counter-'), row.invoice])).toEqual([['BOOKED', true, '6070123456789']])
    expect((await packingKinds(world, seller.sellerId, 'UC_A')).at(-1)).toMatchObject({ kind: 'SHIPPED', invoice: '6070123456789' })
    expect(world.carrier.requests).toEqual([])

    // 접수 취소 = 라이브찜 기록만 (택배사에 보내지 않는다) → 다시 고를 수 있음
    expect((await parcelApi(world, seller.cookie).cancel('UC_A')).status).toBe(200)
    expect(world.carrier.requests).toEqual([])
    expect((await dayRows(world, seller)).ready.map((row) => row.buyer)).toEqual(['UC_A'])
  })

  it('방문접수 표시, 다른 묶음에 적은 송장번호는 그 묶음만 거절, 잘못된 본문은 400', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B', { ...ADDRESS, name: '김다육' })
    const visit = await direct(world, seller.cookie, { kind: 'VISIT', items: [{ buyer: 'UC_A', invoice: '6070123456789' }] })
    expect(visit.body.results).toEqual([{ buyer: 'UC_A', ok: true, invoice: '6070123456789', invoiceText: '6070-1234-5678-9' }])
    expect((await dayRows(world, seller)).booked[0]?.parcel).toMatchObject({ direct: 'VISIT' })
    const used = await direct(world, seller.cookie, { kind: 'VISIT', items: [{ buyer: 'UC_B', invoice: '6070123456789' }] })
    expect(used.body.results).toEqual([{ buyer: 'UC_B', ok: false, reason: 'REJECTED', message: '이미 다른 묶음에 적은 송장번호예요. 다시 확인해 주세요.' }])

    const bad = async (body: Record<string, unknown>) => (await direct(world, seller.cookie, body)).body as { error: { code: string; message: string } }
    expect((await bad({ kind: 'VISIT', items: [{ buyer: 'UC_B', invoice: '1234' }] })).error.message).toBe('우체국 송장번호는 숫자 13자리예요. 다시 확인해 주세요.')
    expect((await bad({ kind: 'VISIT', items: [{ buyer: 'UC_B', invoice: '6070123456790' }, { buyer: 'UC_A', invoice: '6070123456790' }] })).error.message).toBe('같은 송장번호가 두 번 들어 있어요. 다시 확인해 주세요.')
    expect((await bad({ kind: 'MAIL', items: [{ buyer: 'UC_B', invoice: '6070123456790' }] })).error.code).toBe('INVALID_INPUT')
    expect((await bad({ kind: 'VISIT', items: [{ buyer: 'UC_B', invoice: '6070123456790', memo: 'x' }] })).error.code).toBe('INVALID_INPUT')
    expect((await direct(world, seller.cookie, { kind: 'VISIT', items: [{ buyer: 'UC_Z', invoice: '6070123456790' }] })).status).toBe(404)
    expect(world.carrier.requests).toEqual([])
  })
})
