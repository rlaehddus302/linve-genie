// AC-I2-30 포장·배송 상태 계산, AC-I2-31 명령, AC-I2-32 실시간, AC-I2-33 정산 조회의 포장 상태, AC-I2-34 포장 라벨
import { computePackingText, defaultTemplate } from '@livejjim/label'
import { describe, expect, it } from 'vitest'
import { chat, fileNameOf, getFile, ok, pack, pngHeader, putShop } from './i2-support.ts'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, newWorld, rid, sseReader, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

const D = '2026-10-19'

interface Entry {
  buyer: string
  name: string
  status: string
  invoice: string | null
  payment: string
  items: { id: string; key: string; no: number; name: string; title: string }[]
  add: { id: string; key: string; no: number; name: string; title: string }[]
  remove: { id: string | null; key: string; no: number; name: string; title: string }[]
}

async function entries(world: TestServer, seller: Seller, date = D): Promise<Map<string, Entry>> {
  const response = await client(world, seller.cookie).get(`/api/days/${date}/packing`)
  expect(response.status, response.text).toBe(200)
  return new Map((response.body.entries as Entry[]).map((entry) => [entry.buyer, entry]))
}

const statusOf = async (world: TestServer, seller: Seller, buyer: string) => (await entries(world, seller)).get(buyer)?.status

async function expectOkPack(promise: Promise<JsonResponse>): Promise<Entry> {
  const response = await promise
  expect(response.status, response.text).toBe(200)
  return response.body.entry as Entry
}

describe('AC-I2-30 포장·배송 상태 계산 — 서버 시험으로 고정할 흐름 (실제 범위 하나, 방송 b1)', () => {
  it('1~8: 포장 완료 → 새 1등 → 다시 확인 → 다시 포장·배송 → 취소 승계 → 번호 변경(두 단계) → 합치기·떼어 내기 → 가격·품종 변경 → 같은 번호에 다른 상품', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    const key = (no: number) => `${b}/${String(no)}`
    for (const no of [15, 28, 31, 7]) await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no })
    await chat(world, seller, b, 'a15', 'UC_A', '홍길동', '15')
    await chat(world, seller, b, 'a28', 'UC_A', '홍길동', '28')
    await chat(world, seller, b, 'x28', 'UC_X', '대기손님', '28') // 28번 대기 1순위
    await chat(world, seller, b, 'b7', 'UC_B', '꽃님', '7')

    // 1. UC_A가 15·28번 1등 → 포장 대기 → 포장 완료([b1/15, b1/28]) → 포장 완료
    expect(await statusOf(world, seller, 'UC_A')).toBe('포장 대기')
    const packed = await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(28), key(15)] }))
    expect(packed.status).toBe('포장 완료')
    expect(packed.items.map((item) => item.no)).toEqual([15, 28])

    // 2. 31번에 UC_A가 1등(직접 배정) → 포장 다시 확인(새로 담을 것 31번)
    await ok(world, seller, { type: 'host.assign', b, no: 31, buyer: 'UC_A', reason: '전화 주문' })
    let a = (await entries(world, seller)).get('UC_A') as Entry
    expect(a.status).toBe('포장 다시 확인')
    expect(a.add.map((item) => [item.no, item.name])).toEqual([[31, '품종31']])
    expect(a.remove).toEqual([])

    // 3. 포장 완료([15, 28, 31]) → 포장 완료 → 배송 완료(송장 123456789012) → 배송 완료
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(15), key(28), key(31)] }))).status).toBe('포장 완료')
    const shippedEntry = await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '123456789012' }))
    expect([shippedEntry.status, shippedEntry.invoice]).toEqual(['배송 완료', '123456789012'])

    // 4. 28번 UC_A 찜 취소(승계로 UC_X 1등) → 배송 뒤 바뀜(뺄 것 28번). 이어받은 구매자의 묶음은 포장 대기
    await ok(world, seller, { type: 'host.cancel', b, no: 28, buyer: 'UC_A', reason: '구매자 요청' })
    let all = await entries(world, seller)
    a = all.get('UC_A') as Entry
    expect([a.status, a.invoice]).toEqual(['배송 뒤 바뀜', '123456789012'])
    expect(a.remove.map((item) => [item.key, item.no, item.name])).toEqual([[key(28), 28, '품종28']])
    expect(a.add).toEqual([])
    expect(all.get('UC_X')?.status).toBe('포장 대기')

    // 5. UC_B 7번 포장 완료 뒤 7번을 70번으로 번호 변경 → R-10·D-056대로 UC_B의 7번 찜은 무효 → 포장 다시 확인(뺄 것 7번, 새로 담을 것 없음)
    // 5b. 70번에 UC_B를 직접 배정 → 포장 다시 확인(새로 담을 것 70번 · 뺄 것 7번 — 같은 상품이어도 번호가 바뀌었다) → 포장 완료([70]) → 포장 완료
    //     (AC-I2-30 흐름 5·5b, SA-I2-005·D-I2-19 — 교체)
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_B', action: 'pack', items: [key(7)] }))
    await ok(world, seller, { type: 'product.renumber', b, from: 7, to: 70 })
    let bb = (await entries(world, seller)).get('UC_B') as Entry
    expect(bb.status).toBe('포장 다시 확인')
    expect(bb.add).toEqual([])
    expect(bb.remove.map((item) => [item.no, item.name])).toEqual([[7, '품종7']])
    await ok(world, seller, { type: 'host.assign', b, no: 70, buyer: 'UC_B', reason: '번호 바꾼 뒤 다시 배정' })
    bb = (await entries(world, seller)).get('UC_B') as Entry
    expect(bb.status).toBe('포장 다시 확인')
    expect(bb.add.map((item) => item.no)).toEqual([70])
    expect(bb.remove.map((item) => [item.no, item.name])).toEqual([[7, '품종7']])
    // 같은 상품이다(상품 ID가 같다) — 번호만 바뀌었다
    expect(bb.add[0]?.id).toBe(bb.remove[0]?.id)
    const repacked = await expectOkPack(pack(world, seller, D, { buyer: 'UC_B', action: 'pack', items: [key(70)] }))
    expect([repacked.status, repacked.add, repacked.remove]).toEqual(['포장 완료', [], []])

    // 6. UC_C(포장 완료)에 문자 구매자(품목 있음, 포장 대기)를 합침 → 다시 확인. 떼어 내면 UC_C는 포장 완료, 문자 구매자는 자기 기록대로(포장 대기).
    //    포장을 적은 문자 구매자는 합칠 수 없다(D-I2-20 — 아래 AC-I2-31 시험) — 그래서 여기서는 문자 구매자를 포장하지 않는다(교체)
    await ok(world, seller, { type: 'product.register', b, no: 40, name: '사십', price: 4000 })
    await ok(world, seller, { type: 'product.register', b, no: 41, name: '사십일', price: 4100 })
    await chat(world, seller, b, 'c40', 'UC_C', '초록이', '40')
    const sms = (await ok(world, seller, { type: 'sms', b, no: 41, received: '20:00' })).body.buyer as string
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_C', action: 'pack', items: [key(40)] }))
    await ok(world, seller, { type: 'buyer.merge', from: sms, into: 'UC_C', reason: '같은 사람' }, D)
    all = await entries(world, seller)
    expect(all.get('UC_C')?.status).toBe('포장 다시 확인')
    expect(all.get('UC_C')?.add.map((item) => item.no)).toEqual([41])
    expect(all.has(sms)).toBe(false)
    await ok(world, seller, { type: 'buyer.unmerge', from: sms, reason: '다른 사람' }, D)
    all = await entries(world, seller)
    expect(all.get('UC_C')?.status).toBe('포장 완료')
    expect(all.get(sms)?.status).toBe('포장 대기')

    // 7. UC_A 15번 가격을 입금 전 찜까지 바꿈(UNPAID_CLAIMS) → 상태 그대로(상품 ID·키가 같다). 품종을 바꿔도 그대로. UC_B(포장 완료)도 마찬가지
    await ok(world, seller, { type: 'product.update', b, no: 15, price: 99000, applyTo: 'UNPAID_CLAIMS' })
    expect(await statusOf(world, seller, 'UC_A')).toBe('배송 뒤 바뀜')
    await ok(world, seller, { type: 'product.update', b, no: 70, name: '새품종' })
    expect(await statusOf(world, seller, 'UC_B')).toBe('포장 완료')

    // 8. (TD-I2-005, D-I2-19) UC_D 9번 1등 → 포장 완료([9]) → 9번을 90번으로 번호 변경(UC_D 찜 무효) → 빈 9번에 다른 상품(라울)을 새로 등록하고
    //    UC_D를 직접 배정 → 상품 키 집합은 {b/9}로 포장 때와 같지만 다른 상품이라 포장 다시 확인(새로 담을 것 9번 라울 · 뺄 것 9번 — 그 상품의 지금 품종)
    await ok(world, seller, { type: 'product.register', b, no: 9, name: '핑크프릴', price: 9000 })
    await chat(world, seller, b, 'd9', 'UC_D', '다육손님', '9')
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_D', action: 'pack', items: [key(9)] }))
    await ok(world, seller, { type: 'product.renumber', b, from: 9, to: 90 })
    await ok(world, seller, { type: 'product.register', b, no: 9, name: '라울', price: 9500 })
    await ok(world, seller, { type: 'host.assign', b, no: 9, buyer: 'UC_D', reason: '다른 상품 배정' })
    const d = (await entries(world, seller)).get('UC_D') as Entry
    expect(d.items.map((item) => item.key)).toEqual([key(9)])
    expect(d.status).toBe('포장 다시 확인')
    expect(d.add.map((item) => [item.no, item.name])).toEqual([[9, '라울']])
    expect(d.remove.map((item) => [item.no, item.name])).toEqual([[9, '핑크프릴']])
    expect(d.add[0]?.id).not.toBe(d.remove[0]?.id)
    // 같은 키 목록을 보내 포장 완료하면 서버가 지금 상품 ID를 붙여 기록한다 → 포장 완료
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_D', action: 'pack', items: [key(9)] }))).status).toBe('포장 완료')
  })

  it('포장 목록 = 품목 있는 지금의 구매자 + 품목이 없어도 자기 기록이 있는 구매자(뺄 것을 알리려고), 합쳐진 구매자는 따로 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '1')
    await chat(world, seller, b, 'm2', 'UC_Q', '구경만', '안녕하세요')
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/1`] }))
    await ok(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_A', reason: '취소' })
    const all = await entries(world, seller)
    expect([...all.keys()]).toEqual(['UC_A'])
    expect(all.get('UC_A')).toMatchObject({ status: '포장 다시 확인', items: [], remove: [{ key: `${b}/1`, no: 1 }] })
  })

  it('리허설 범위에는 포장 상태·명령·라벨이 없다(404)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const r = await createBroadcast(world, seller, { date: D, rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    const api = client(world, seller.cookie)
    expect((await api.get(`/api/days/${D}/packing`)).status).toBe(404)
    expect((await api.get(`/api/days/${D}/packing?rehearsal=true`)).status).toBe(404)
    expect((await pack(world, seller, D, { buyer: 'sim_a', action: 'pack', items: [`${r.id}/1`] })).status).toBe(404)
    expect((await api.get(`/api/days/${D}/packing-label?buyer=sim_a&rehearsal=true`)).status).toBe(404)
    // 리허설 날짜 보기에는 포장 칸이 없다
    expect((await api.get(`/api/days/${D}?rehearsal=true`)).body.packing).toBeUndefined()
  })
})

describe('AC-I2-31 포장·배송 명령', () => {
  async function setup() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    for (const no of [1, 2, 3]) await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '1')
    await chat(world, seller, b, 'm2', 'UC_A', '홍길동', '2')
    return { world, seller, b, key: (no: number) => `${b}/${String(no)}` }
  }

  it('받는 경우·거절(지금 상태와 함께)·이미 그 상태인 같은 명령(성공, 새 기록 없음)', async () => {
    const { world, seller, key } = await setup()
    const count = () => world.database.pglite?.query<{ n: number }>('select count(*)::int as n from packing_records').then((r) => r.rows[0]?.n ?? 0)
    const reject = async (body: Record<string, unknown>, code: string, message: string) => {
      const response = await pack(world, seller, D, body)
      expect(response.status, response.text).toBe(409)
      expect(response.body.error).toEqual({ code, message })
      expect(response.body.entry).toBeDefined()
      return response.body.entry as Entry
    }
    // 포장 대기에서: 배송 완료·배송 취소·포장 취소 거절
    await reject({ buyer: 'UC_A', action: 'ship' }, 'PACKING_STATE', '포장 완료 뒤에 배송 완료로 적을 수 있어요.')
    await reject({ buyer: 'UC_A', action: 'unship' }, 'PACKING_STATE', '배송 완료로 적은 기록이 없어요.')
    await reject({ buyer: 'UC_A', action: 'unpack' }, 'PACKING_STATE', '포장 완료로 적은 기록이 없어요.')
    // 보낸 품목 ≠ 지금 품목
    const stale = await reject({ buyer: 'UC_A', action: 'pack', items: [key(1)] }, 'ITEMS_CHANGED', '그 사이에 구매 내역이 바뀌었어요. 다시 확인해 주세요.')
    expect(stale.items.map((item) => item.key)).toEqual([key(1), key(2)])
    await reject({ buyer: 'UC_A', action: 'pack', items: [key(1), key(2), key(3)] }, 'ITEMS_CHANGED', '그 사이에 구매 내역이 바뀌었어요. 다시 확인해 주세요.')
    expect(await count()).toBe(0)
    // 포장 완료, 같은 명령 다시 → 성공·새 기록 없음
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(1), key(2)] }))
    const again = await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(2), key(1)] })
    expect([again.status, again.body.recorded]).toEqual([200, false])
    expect(await count()).toBe(1)
    // 배송 완료(송장 없음) → 같은 송장(없음) 다시 → 새 기록 없음 → 송장 고치기(새 기록)
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship' }))).invoice).toBeNull()
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '' })).body.recorded).toBe(false)
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '1234 5678 9012' }))).invoice).toBe('123456789012')
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '1234-5678-9012' })).body.recorded).toBe(false)
    expect(await count()).toBe(3)
    // 배송 완료에서: 포장 완료·포장 취소 거절
    await reject({ buyer: 'UC_A', action: 'pack', items: [key(1), key(2)] }, 'PACKING_STATE', '이미 배송 완료로 적었어요. 먼저 배송 완료를 취소해 주세요.')
    await reject({ buyer: 'UC_A', action: 'unpack' }, 'PACKING_STATE', '이미 배송 완료로 적었어요. 먼저 배송 완료를 취소해 주세요.')
    // 배송 취소 → 포장 완료 → 포장 취소 → 포장 대기
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'unship' }))).status).toBe('포장 완료')
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'unpack' }))).status).toBe('포장 대기')
    expect(await count()).toBe(5)
  })

  it('포장 다시 확인·배송 뒤 바뀜에서의 배송 완료는 "구매 내역이 바뀌었어요. 다시 포장 확인부터 해 주세요."', async () => {
    const { world, seller, b, key } = await setup()
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(1), key(2)] }))
    await chat(world, seller, b, 'm3', 'UC_A', '홍길동', '3')
    const response = await pack(world, seller, D, { buyer: 'UC_A', action: 'ship' })
    expect(response.body.error).toEqual({ code: 'PACKING_STATE', message: '구매 내역이 바뀌었어요. 다시 포장 확인부터 해 주세요.' })
    // 다시 확인 상태에서 포장 취소는 받는다
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'unpack' }))).status).toBe('포장 대기')
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(1), key(2), key(3)] }))
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '12345678' }))
    await ok(world, seller, { type: 'host.cancel', b, no: 3, buyer: 'UC_A', reason: '취소' })
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '87654321' })).body.error).toMatchObject({ message: '구매 내역이 바뀌었어요. 다시 포장 확인부터 해 주세요.' })
    // 배송 뒤 바뀜에서 배송 취소는 받는다
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'unship' }))).status).toBe('포장 다시 확인')
  })

  it('송장번호: 공백·-를 뺀 숫자 8~20자리, 7·21자리·글자 거절, 휴대폰 번호 모양 거절', async () => {
    const { world, seller, key } = await setup()
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(1), key(2)] }))
    const fmt = '송장번호는 숫자 8~20자리로 적어 주세요.'
    const phone = '전화번호처럼 보여요. 송장번호를 확인해 주세요.'
    for (const [invoice, message] of [['1234567', fmt], ['1'.repeat(21), fmt], ['12a45678', fmt], ['１２３４５６７８', fmt], [12345678, fmt], ['01012345678', phone], ['010-1234-5678', phone]] as const) {
      const response = await pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice })
      expect(response.status, String(invoice)).toBe(400)
      expect(response.body.error).toEqual({ code: 'INVALID_INPUT', message, problems: [{ field: 'invoice', message }] })
    }
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '12345678' }))).invoice).toBe('12345678')
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '9'.repeat(20) }))).invoice).toBe('9'.repeat(20))
  })

  it('같은 요청 번호 = 처음 결과(기록 하나), 기록마다 누가·언제, 엔진 로그·범위 seq·정산 금액을 바꾸지 않는다', async () => {
    const { world, seller, key } = await setup()
    const day = async () => (await client(world, seller.cookie).get(`/api/days/${D}`)).body
    const before = await day()
    const events = await countRows(world.database, 'events')
    const requestId = rid('same')
    const first = await pack(world, seller, D, { requestId, buyer: 'UC_A', action: 'pack', items: [key(1), key(2)] })
    world.clock.advance(5000)
    const second = await pack(world, seller, D, { requestId, buyer: 'UC_A', action: 'unpack' })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((second.body.entry as Entry).status).toBe('포장 완료')
    const rows = await world.database.pglite?.query<{ account_id: string; created_at: Date; request_id: string; kind: string }>('select account_id, created_at, request_id, kind from packing_records')
    expect(rows?.rows).toHaveLength(1)
    expect(rows?.rows[0]).toMatchObject({ account_id: seller.accountId, request_id: requestId, kind: 'PACKED' })
    expect(rows?.rows[0]?.created_at.getTime()).toBe(world.clock.now() - 5000)
    expect(await countRows(world.database, 'events')).toBe(events)
    const after = await day()
    expect(after.seq).toBe(before.seq)
    expect(after.settlements).toEqual(before.settlements)
  })

  it('구매자는 그 날짜의 지금의 구매자여야 한다 (합쳐진 ID·모르는 구매자 → 쉬운 오류), 형식 오류, 다른 판매자 범위 → 404', async () => {
    const { world, seller, key } = await setup()
    const other = await addSeller(world)
    const sms = (await ok(world, seller, { type: 'sms', b: key(1).split('/')[0] as string, no: 3, received: '20:00' })).body.buyer as string
    await ok(world, seller, { type: 'buyer.merge', from: sms, into: 'UC_A', reason: '같은 사람' }, D)
    for (const buyer of [sms, 'UC_NOBODY']) {
      const response = await pack(world, seller, D, { buyer, action: 'unpack' })
      expect(response.status).toBe(400)
      expect(response.body.error).toEqual({ code: 'BUYER_NOT_FOUND', message: '구매자를 다시 확인해 주세요.', problems: [{ field: 'buyer', message: '구매자를 다시 확인해 주세요.' }] })
    }
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: ['bad key'] })).status).toBe(400)
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(1), key(1)] })).status).toBe(400)
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'unpack', items: [] })).body.error).toMatchObject({ code: 'UNKNOWN_FIELD' })
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'fly' })).status).toBe(400)
    expect((await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [], note: 1 })).body.error).toMatchObject({ code: 'UNKNOWN_FIELD' })
    expect((await pack(world, other, D, { buyer: 'UC_A', action: 'unpack' })).status).toBe(404)
    expect((await client(world, other.cookie).get(`/api/days/${D}/packing`)).status).toBe(404)
    expect((await client(world, seller.cookie).post(`/api/days/${D}/packing`, { buyer: 'UC_A', action: 'unpack' })).body.error).toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('두 기기가 동시에 포장 완료·배송 완료 → 기록은 받는 만큼만 (한 줄 처리)', async () => {
    const { world, seller, key } = await setup()
    const results = await Promise.all(Array.from({ length: 6 }, () => pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [key(1), key(2)] })))
    expect(results.map((r) => r.status)).toEqual(Array.from({ length: 6 }, () => 200))
    expect(results.filter((r) => r.body.recorded === true)).toHaveLength(1)
    const ships = await Promise.all(['11111111', '22222222'].map((invoice) => pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice })))
    expect(ships.every((r) => r.status === 200 && r.body.recorded === true)).toBe(true)
    const last = (await entries(world, seller)).get('UC_A') as Entry
    expect(['11111111', '22222222']).toContain(last.invoice)
    const rows = await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from packing_records')
    expect(rows?.rows[0]?.n).toBe(3)
  })
})

describe('AC-I2-31 합치기·떼어 내기 제한 (I2 마지막 감사 RA-I2-009, D-I2-20)', () => {
  const MERGE = '포장이나 배송을 적은 구매자는 다른 구매자에 합칠 수 없어요. 포장 모드에서 먼저 취소해 주세요.'
  const UNMERGE = '배송을 적은 구매자에게서는 떼어 낼 수 없어요. 포장 모드에서 배송 완료를 먼저 취소해 주세요.'

  async function setup() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    for (const no of [1, 2, 3]) await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_Y', '받는사람', '1')
    const x = (await ok(world, seller, { type: 'sms', b, no: 2, received: '20:00' })).body.buyer as string
    return { world, seller, b, x, key: (no: number) => `${b}/${String(no)}` }
  }
  const snapshot = async (world: TestServer, seller: Seller) => ({
    events: await countRows(world.database, 'events'),
    seq: (await client(world, seller.cookie).get(`/api/days/${D}`)).body.seq,
    packing: (await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from packing_records'))?.rows[0]?.n,
  })
  const refused = async (world: TestServer, seller: Seller, event: Record<string, unknown>, message: string) => {
    const before = await snapshot(world, seller)
    const response = await writeEvent(world, seller, event, D)
    expect(response.status, response.text).toBe(409)
    expect(response.body.error).toMatchObject({ code: 'PACKING_RECORDED', message })
    expect(await snapshot(world, seller)).toEqual(before)
  }

  it('합쳐질 X가 포장 완료·포장 다시 확인·배송 완료·배송 뒤 바뀜이면 409(기록 없음) — 포장 취소·배송 취소로 포장 대기가 되면 합칠 수 있다', async () => {
    const { world, seller, b, x, key } = await setup()
    const merge = { type: 'buyer.merge', from: x, into: 'UC_Y', reason: '같은 사람' }
    await expectOkPack(pack(world, seller, D, { buyer: x, action: 'pack', items: [key(2)] }))
    await refused(world, seller, merge, MERGE) // 포장 완료
    await ok(world, seller, { type: 'host.assign', b, no: 3, buyer: x, reason: '전화 주문' })
    expect(await statusOf(world, seller, x)).toBe('포장 다시 확인')
    await refused(world, seller, merge, MERGE)
    await expectOkPack(pack(world, seller, D, { buyer: x, action: 'pack', items: [key(2), key(3)] }))
    await expectOkPack(pack(world, seller, D, { buyer: x, action: 'ship', invoice: '12345678' }))
    await refused(world, seller, merge, MERGE) // 배송 완료
    await ok(world, seller, { type: 'host.cancel', b, no: 3, buyer: x, reason: '취소' })
    expect(await statusOf(world, seller, x)).toBe('배송 뒤 바뀜')
    await refused(world, seller, merge, MERGE)
    await expectOkPack(pack(world, seller, D, { buyer: x, action: 'unship' }))
    await expectOkPack(pack(world, seller, D, { buyer: x, action: 'unpack' }))
    expect(await statusOf(world, seller, x)).toBe('포장 대기')
    await ok(world, seller, merge, D)
  })

  it('포장·배송을 마친 Y 쪽에 합치는 것은 된다(포장 다시 확인·배송 뒤 바뀜), 배송을 마친 Y에서 떼어 내기는 409 — 포장만 한 Y에서는 된다', async () => {
    const { world, seller, x, key } = await setup()
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_Y', action: 'pack', items: [key(1)] }))
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_Y', action: 'ship' }))
    await ok(world, seller, { type: 'buyer.merge', from: x, into: 'UC_Y', reason: '같은 사람' }, D)
    expect(await statusOf(world, seller, 'UC_Y')).toBe('배송 뒤 바뀜')
    const unmerge = { type: 'buyer.unmerge', from: x, reason: '다른 사람' }
    await refused(world, seller, unmerge, UNMERGE)
    // 배송 완료를 취소하면(포장만 한 상태) 떼어 낼 수 있다
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_Y', action: 'unship' }))
    await ok(world, seller, unmerge, D)
    const all = await entries(world, seller)
    expect(all.get('UC_Y')?.status).toBe('포장 완료')
    expect(all.get(x)?.status).toBe('포장 대기')
  })

  it('리허설 범위는 포장이 없어 막지 않는다, 같은 범위 줄에서 검사 — X의 포장 완료와 X 합치기를 동시에 보내도 둘이 함께 남지 않는다', async () => {
    const { world, seller, x, key } = await setup()
    const r = await createBroadcast(world, seller, { date: D, rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '연습', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    await chat(world, seller, r.id, 'r2', 'sim_b', '연습둘', '안녕')
    expect((await writeEvent(world, seller, { type: 'buyer.merge', from: 'sim_a', into: 'sim_b', reason: '연습' }, D, true)).status).toBe(200)
    for (let round = 0; round < 5; round++) {
      const [packed, merged] = await Promise.all([
        pack(world, seller, D, { buyer: x, action: 'pack', items: [key(2)] }),
        writeEvent(world, seller, { type: 'buyer.merge', from: x, into: 'UC_Y', reason: '같은 사람' }, D),
      ])
      const packedOk = packed.status === 200 && packed.body.recorded === true
      const mergedOk = merged.status === 200
      expect(packedOk && mergedOk, `${packed.text} ${merged.text}`).toBe(false)
      expect(packedOk || mergedOk).toBe(true)
      // 처음으로 되돌린다
      if (mergedOk) await ok(world, seller, { type: 'buyer.unmerge', from: x, reason: '되돌림' }, D)
      else await expectOkPack(pack(world, seller, D, { buyer: x, action: 'unpack' }))
    }
  })
})

describe('D-I2-19 포장 기록의 품목 = (상품 ID, 상품 키) 쌍', () => {
  it('포장 완료 기록은 서버가 붙인 상품 ID와 키를 남기고, 상품 ID가 없는 예전 기록은 지금 품목과 같지 않다(포장 다시 확인)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '1')
    const entry = await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/1`] }))
    const id = entry.items[0]?.id as string
    expect(id).toMatch(/\S/)
    const rows = await world.database.pglite?.query<{ items: string }>('select items from packing_records')
    expect(JSON.parse(rows?.rows[0]?.items as string)).toEqual([{ id, key: `${b}/1` }])
    // 이 결정 전 형식(상품 키 글만)으로 바꾸면 같은 키여도 포장 다시 확인 — 뺄 것은 ID 없이 포장 때 번호
    await world.database.pglite?.query(`update packing_records set items = $1`, [JSON.stringify([`${b}/1`])])
    const legacy = (await entries(world, seller)).get('UC_A') as Entry
    expect(legacy.status).toBe('포장 다시 확인')
    expect(legacy.add.map((item) => item.no)).toEqual([1])
    expect(legacy.remove).toEqual([{ id: null, key: `${b}/1`, broadcast: b, title: legacy.items[0]?.title, no: 1, name: '', variant: null, qty: 1 }]) // D-O3-14: 뺄 것에 포장 때 옵션 글·수량 (칸이 늘었다)
    // 다시 포장 완료하면 새 형식으로 남고 포장 완료
    expect((await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/1`] }))).status).toBe('포장 완료')
  })
})

describe('AC-I2-32 포장 상태 실시간 반영', () => {
  it('포장 기록이 저장되면 그 판매자의 다른 연결이 packing 알림({ date, buyer })을 받는다 — 다른 판매자는 받지 않는다, 거절·같은 상태는 알림 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '1')
    const mine = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } }))
    const theirs = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: other.cookie } }))
    await mine.until(() => mine.events.some((e) => e.event === 'ready'))
    await theirs.until(() => theirs.events.some((e) => e.event === 'ready'))
    await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: ['nope/1'] })
    const sent = performance.now()
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/1`] }))
    await mine.until(() => mine.events.some((e) => e.event === 'packing'))
    const notice = mine.events.find((e) => e.event === 'packing')
    expect(JSON.parse(notice?.data ?? '{}')).toEqual({ date: D, buyer: 'UC_A' })
    expect((notice?.receivedAt ?? Infinity) - sent).toBeLessThan(1000)
    await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/1`] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mine.events.filter((e) => e.event === 'packing')).toHaveLength(1)
    expect(theirs.events.some((e) => e.event === 'packing')).toBe(false)
    await mine.cancel()
    await theirs.cancel()
  })
})

describe('AC-I2-33 정산 조회(날짜 보기)의 포장·배송 상태', () => {
  it('실제 범위 날짜 보기에 묶음마다 { buyer, status, invoice }', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '1')
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: [`${b}/1`] }))
    await expectOkPack(pack(world, seller, D, { buyer: 'UC_A', action: 'ship', invoice: '123456789012' }))
    // T1(AC-T1-52): 묶음마다 택배 줄 parcel — 택배 접수가 없으면 null
    expect((await client(world, seller.cookie).get(`/api/days/${D}`)).body.packing).toEqual([{ buyer: 'UC_A', status: '배송 완료', invoice: '123456789012', parcel: null }])
  })
})

describe('AC-I2-34 포장 라벨', () => {
  async function setup(count: number, second = 0) {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller, { name: '초록다육', bank: '', accountNumber: '', accountHolder: '', accountNote: '' })
    const b1 = (await createBroadcast(world, seller, { date: D, title: '1부' })).id
    for (let no = 1; no <= count; no++) {
      await ok(world, seller, { type: 'product.register', b: b1, no, name: `품종${String(no)}`, price: 1000 })
      await chat(world, seller, b1, `a${String(no)}`, 'UC_A', '길동이', String(no))
    }
    if (second > 0) {
      const b2 = (await createBroadcast(world, seller, { date: D, title: '2부' })).id
      for (let no = 1; no <= second; no++) {
        await ok(world, seller, { type: 'product.register', b: b2, no: no + 50, name: `둘${String(no)}`, price: 2000 })
        await chat(world, seller, b2, `b${String(no)}`, 'UC_A', '길동이', String(no + 50))
      }
    }
    return { world, seller, b1 }
  }

  it('라벨 데이터 = L-9 (날짜·구매자·방송 선언 순 번호·상품 합계), 템플릿 = 기본 포장 템플릿 + 가게 이름 — 12개 한 방송 → 2쪽(10개·2개)', async () => {
    const { world, seller } = await setup(12)
    const response = await client(world, seller.cookie).get(`/api/days/${D}/packing-label?buyer=UC_A`)
    expect(response.status, response.text).toBe(200)
    expect(response.body).toEqual({
      date: D,
      buyer: 'UC_A',
      data: { date: D, buyer: { kind: 'youtube', name: '길동이' }, broadcasts: [{ title: '1부', numbers: Array.from({ length: 12 }, (_, i) => i + 1) }], subtotal: 12000 },
      pages: 2,
    })
    const text = computePackingText({ ...defaultTemplate('packing', '50x30'), shopName: '초록다육' }, (response.body as { data: unknown }).data)
    expect(text.ok && text.text.pages.map((page) => page.numbers.length)).toEqual([10, 2])
    expect(text.ok && text.text.common.shop).toBe('초록다육')
    // 체크리스트(포장 목록)와 같은 품목
    const list = (await client(world, seller.cookie).get(`/api/days/${D}/packing`)).body.entries as Entry[]
    expect(list[0]?.items.map((item) => item.no)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  })

  it('PNG = 쪽마다 1비트 384×240점(203dpi), PDF = 모든 쪽, 이름 포장라벨-…, 저장하지 않음·출력 작업 없음', async () => {
    const { world, seller } = await setup(3, 2)
    const before = await dumpAllTables(world.database)
    const json = await client(world, seller.cookie).get(`/api/days/${D}/packing-label?buyer=UC_A`)
    expect(json.body.pages).toBe(2) // 1부 3개·2부 2개 → 방송마다 쪽
    expect((json.body.data as { broadcasts: { title: string }[] }).broadcasts.map((item) => item.title)).toEqual(['1부', '2부'])
    for (const page of [1, 2]) {
      const png = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=${String(page)}`)
      expect(png.status).toBe(200)
      expect(png.headers.get('content-type')).toBe('image/png')
      expect(png.headers.get('cache-control')).toBe('no-store')
      expect(pngHeader(png.bytes)).toEqual({ width: 384, height: 240, bitDepth: 1, colorType: 0 })
      expect(fileNameOf(png.headers)).toBe(`포장라벨-${D}-길동이-${String(page)}of2.png`)
    }
    expect((await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=3`)).status).toBe(400)
    const pdf = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.pdf?buyer=UC_A`)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(fileNameOf(pdf.headers)).toBe(`포장라벨-${D}-길동이.pdf`)
    expect((new TextDecoder('latin1').decode(pdf.bytes).match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(2)
    // 같은 묶음·같은 템플릿이면 같은 바이트 (미리 보기 = 저장 그림)
    const again = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=1`)
    const first = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=UC_A&page=1`)
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true)
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('문자 구매자는 { kind: sms } (찍히는 글은 문자찜 — 메모·전화번호 없음), 품목 없는 묶음은 라벨 없이 문장, 리허설 404', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    const sms = (await ok(world, seller, { type: 'sms', b, no: 1, received: '20:00', memo: '김영희', phone: '010-1234-5678' })).body.buyer as string
    const label = await client(world, seller.cookie).get(`/api/days/${D}/packing-label?buyer=${encodeURIComponent(sms)}`)
    expect((label.body.data as { buyer: unknown }).buyer).toEqual({ kind: 'sms' })
    expect(label.text).not.toContain('김영희')
    expect(label.text).not.toContain('5678')
    const png = await getFile(world, seller.cookie, `/api/days/${D}/packing-label.png?buyer=${encodeURIComponent(sms)}`)
    expect(fileNameOf(png.headers)).toBe(`포장라벨-${D}-문자찜-1of1.png`)
    await chat(world, seller, b, 'q', 'UC_Q', '구경', '안녕')
    const none = await client(world, seller.cookie).get(`/api/days/${D}/packing-label?buyer=UC_Q`)
    expect(none.status).toBe(422)
    expect(none.body.error).toEqual({ code: 'NO_ITEMS', message: '담을 상품이 없어 포장 라벨을 만들 수 없어요.' })
    expect((await client(world, seller.cookie).get(`/api/days/${D}/packing-label?buyer=UC_NOBODY`)).status).toBe(422)
  })
})
