// AC-N3-20~33: 자동 확인·이름 후보·순서와 마지막 확인·확인 필요 조회·확정·기억한 입금자명·무시·되돌리기·한꺼번에·같은 요청·실시간·처리 기록·정산 조회 연결·묶음 찾기.
// 상태는 서버 기록 경로(코어 재생)로 만들고, 기대값은 코어 조회 함수(getSettlement)와 규칙 문장(DEPOSIT_RULES)으로 정한다.
import { getSettlement } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast, expectOk, rid, sseReader, writeEvent } from './support.ts'
import { DAY, depositApi, depositWorld, deposits, kst, order, pasteText, register, settlementEvents, sms } from './deposit-support.ts'

/** 실제 방송 하나에 15번(10,000원)을 UC_A "다육이맘"이 1등 → 묶음 14,000원 (배송비 4,000) */
async function basicSale(world: Awaited<ReturnType<typeof depositWorld>>, seller: Awaited<ReturnType<typeof addSeller>>) {
  const b = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, b.id, 15)
  await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
  return b
}

describe('AC-N3-20 자동 확인', () => {
  it('확실한 1:1이면 settlement.payment 하나(메모 "자동 입금 확인 · 입금 #1", 적은 이 = 입금 자동 확인)가 적히고 입금 완료가 된다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const pasted = await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이 맘', amount: 14_000 }])))
    expect(pasted.body).toMatchObject({ read: 1, new: 1, auto: 1, review: 0, existing: 0 })
    const events = await settlementEvents(world, seller)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'settlement.payment', actor: { kind: 'deposit', loginId: null }, fields: { buyer: 'UC_A', date: DAY, amount: 14_000, memo: '자동 입금 확인 · 입금 #1' } })
    const state = (await world.server.writer.read(seller.sellerId, DAY)).state
    expect(getSettlement(state, 'UC_A', DAY)).toMatchObject({ total: 14_000, received: 14_000, payment: 'PAID' })
    const [auto] = await deposits(api, 'AUTO_APPLIED')
    expect(auto).toMatchObject({ no: 1, status: 'AUTO_APPLIED', name: '다육이 맘', amount: 14_000, precision: 'second', applied: { date: DAY, buyer: 'UC_A', buyerName: '다육이맘', seq: events[0]?.seq, auto: true } })
    expect(await api.count()).toBe(0)
  })

  it('자동 확인은 받을 때 한 번 — 확인 필요로 남은 입금은 나중에 금액이 맞게 되어도 적히지 않고 조회 사유가 ONE_MATCH다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 10_000 }])))
    expect((await deposits(api))[0]?.review?.reason).toBe('AMOUNT_MISMATCH')
    // 배송비 예외(직접 받기)로 남은 금액이 10,000이 된다
    await expectOk(writeEvent(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_A', date: DAY, mode: 'PICKUP' }, DAY))
    const [item] = await deposits(api)
    expect(item?.status).toBe('REVIEW')
    expect(item?.review).toMatchObject({ reason: 'ONE_MATCH', preselect: { date: DAY, buyer: 'UC_A' } })
    expect(await settlementEvents(world, seller)).toEqual([])
  })

  it('리허설 범위에는 아무것도 적히지 않는다 (리허설 묶음은 후보가 아니다)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await register(world, seller, b.id, 15)
    await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 14_000 }])))
    const [item] = await deposits(api)
    expect(item?.review).toMatchObject({ reason: 'NO_MATCH', suggestions: [], preselect: null })
    expect(await settlementEvents(world, seller, DAY, true)).toEqual([])
  })
})

describe('AC-N3-21 후보 묶음과 이름 후보', () => {
  it('(가) 바뀌기 전 닉네임 (나) 문자찜 메모 (다) 유튜브 구매자에 합친 문자 구매자의 메모 (라) 메모 없는 문자찜은 이름이 아니다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b1 = await createBroadcast(world, seller, { date: DAY, title: '1부' })
    await register(world, seller, b1.id, 1)
    await order(world, seller, b1.id, 'UC_HONG', '홍길동', '1')
    const b2 = await createBroadcast(world, seller, { date: DAY, title: '2부' })
    await register(world, seller, b2.id, 2, 5000)
    await order(world, seller, b2.id, 'UC_HONG', '길동이', '2')
    await register(world, seller, b2.id, 3, 7000)
    const memo = await sms(world, seller, b2.id, 3, '김영희')
    await register(world, seller, b2.id, 4, 8000)
    const merged = await sms(world, seller, b2.id, 4, '박민수')
    await register(world, seller, b2.id, 5, 9000)
    await order(world, seller, b2.id, 'UC_PARK', '선인장러버', '5')
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: merged.body.buyer as string, into: 'UC_PARK', reason: '같은 사람' }, DAY))
    await register(world, seller, b2.id, 6, 3000)
    await sms(world, seller, b2.id, 6)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const text = pasteText([
      { at: '2026-10-19 12:00:30', name: '홍길동', amount: 19_000 }, // 10,000 + 5,000 + 배송비 4,000
      { at: '2026-10-19 12:00:31', name: '김영희', amount: 11_000 },
      { at: '2026-10-19 12:00:32', name: '박민수', amount: 21_000 }, // 8,000 + 9,000 + 4,000 (합친 묶음)
      { at: '2026-10-19 12:00:33', name: '문자찜', amount: 7_000 },
    ])
    expect((await expectOk(api.paste(text))).body).toMatchObject({ new: 4, auto: 3, review: 1 })
    const auto = await deposits(api, 'AUTO_APPLIED')
    expect(auto.map((item) => [item.no, item.applied?.buyer]).sort()).toEqual([
      [1, 'UC_HONG'],
      [2, memo.body.buyer],
      [3, 'UC_PARK'],
    ])
    const [left] = await deposits(api)
    expect(left).toMatchObject({ no: 4, review: { reason: 'NAME_MISMATCH' } })
  })

  it('판매 시각보다 이른 입금·30일보다 오래된 묶음은 후보가 아니다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 11:59:00', name: '다육이맘', amount: 14_000 }])))
    expect((await deposits(api))[0]?.review).toMatchObject({ reason: 'NO_MATCH' })
  })
})

describe('AC-N3-22 순서·동시성·마지막 확인', () => {
  it('같은 묶음에 맞는 두 입금을 동시에 넣어도 자동 확인은 하나이고 과입금이 되지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE', label: '시험' }))).body as { id: string }
    await expectOk(api.testRows(fake.id, [{ key: 't1', at: '2026-10-19T12:00:40+09:00', amount: 14_000, name: '다육이맘' }]))
    await Promise.all([api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 14_000 }])), api.fetch(fake.id)])
    const state = (await world.server.writer.read(seller.sellerId, DAY)).state
    expect(getSettlement(state, 'UC_A', DAY)).toMatchObject({ received: 14_000, payment: 'PAID' })
    expect(await deposits(api, 'AUTO_APPLIED')).toHaveLength(1)
    expect((await deposits(api))[0]?.review?.reason).toBe('POSSIBLE_DUPLICATE')
  })

  it('맞춘 뒤 엔진에 적기 직전에 판매자가 손으로 입금을 적으면 자동 확인을 적지 않고 확인 필요로 둔다', async () => {
    const ref: { seller?: Awaited<ReturnType<typeof addSeller>> } = {}
    const world = await depositWorld({
      deposits: {
        hooks: {
          beforeAuto: async () => {
            await expectOk(writeEvent(world, ref.seller as Awaited<ReturnType<typeof addSeller>>, { type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 4000, memo: '손 입금' }, DAY))
          },
        },
      },
    })
    const seller = await addSeller(world)
    ref.seller = seller
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    expect((await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 14_000 }])))).body).toMatchObject({ auto: 0, review: 1 })
    const events = await settlementEvents(world, seller)
    expect(events.map((event) => event.fields.memo)).toEqual(['손 입금'])
  })

  it('한 번에 받은 입금은 거래 시각 순서로 번호를 붙인다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 11:30:00', name: '나중', amount: 2000 }, { at: '2026-10-19 11:00:00', name: '먼저', amount: 1000 }])))
    const items = await deposits(api)
    expect(items.map((item) => [item.no, item.name])).toEqual([
      [2, '나중'],
      [1, '먼저'],
    ])
  })
})

describe('AC-N3-23 확인 필요 조회', () => {
  it('제안 묶음마다 이름 표기·금액·바뀔 입금 상태·판매 전 입금인지를 보이고, 조회는 아무것도 기록하지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 1)
    await order(world, seller, b.id, 'UC_A1234', '김영희', '1')
    await register(world, seller, b.id, 2, 16_000)
    await order(world, seller, b.id, 'UC_B5678', '김영희', '2')
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '김영희', amount: 14_000 }])))
    const before = await world.server.writer.read(seller.sellerId, DAY)
    const seq = before.seq
    const [item] = await deposits(api)
    expect(item?.review?.reason).toBe('SAME_NAME')
    expect(item?.review?.preselect).toBeNull()
    expect(item?.review?.suggestions).toEqual([
      { date: DAY, buyer: 'UC_A1234', name: '김영희 · 끝 1234', total: 14_000, received: 0, remaining: 14_000, payment: 'UNPAID', refundDue: 0, after: { payment: 'PAID', received: 14_000, refundDue: 0 }, beforeSale: false, canRemember: false },
      { date: DAY, buyer: 'UC_B5678', name: '김영희 · 끝 5678', total: 20_000, received: 0, remaining: 20_000, payment: 'UNPAID', refundDue: 0, after: { payment: 'PARTIAL', received: 14_000, refundDue: 0 }, beforeSale: false, canRemember: false },
    ])
    expect((await world.server.writer.read(seller.sellerId, DAY)).seq).toBe(seq)
    expect(await api.count()).toBe(1)
  })
})

describe('AC-N3-24 확정 · AC-N3-26 무시 · AC-N3-27 되돌리기', () => {
  async function reviewWorld() {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '박민수', amount: 14_000 }])))
    return { world, seller, api }
  }

  it('확정하면 "입금 내역으로 확인 · 입금 #1" 입금(적은 이 = 판매자 계정)이 적히고 확인함이 된다. 같은 요청 번호는 처음 결과', async () => {
    const { world, seller, api } = await reviewWorld()
    const first = await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }, 'same-confirm'))
    expect(first.body).toMatchObject({ deposit: { no: 1, status: 'APPLIED', applied: { date: DAY, buyer: 'UC_A', buyerName: '다육이맘' } } })
    const again = await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }, 'same-confirm'))
    expect(again.body).toEqual(first.body)
    const events = await settlementEvents(world, seller)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actor: { kind: 'account', loginId: seller.loginId }, fields: { buyer: 'UC_A', amount: 14_000, memo: '입금 내역으로 확인 · 입금 #1' } })
    expect((await api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 0 })).body).toMatchObject({ error: { code: 'DEPOSIT_APPLIED', message: '이미 반영한 입금이에요.' } })
  })

  it('본 남은 금액과 다르면 409 BUNDLE_CHANGED, 리허설·없는 묶음은 404 — 아무것도 기록하지 않는다', async () => {
    const { world, seller, api } = await reviewWorld()
    const changed = await api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 10_000 })
    expect(changed.status).toBe(409)
    expect(changed.body).toMatchObject({ error: { code: 'BUNDLE_CHANGED', message: '묶음 금액이 바뀌었어요. 다시 확인해 주세요.' } })
    expect((await api.confirm(1, { date: DAY, buyer: 'UC_NOBODY', remaining: 0 })).status).toBe(404)
    expect((await api.confirm(1, { date: '2026-10-01', buyer: 'UC_A', remaining: 14_000 })).status).toBe(404)
    const r = await createBroadcast(world, seller, { date: '2026-10-18', rehearsal: true })
    await register(world, seller, r.id, 1)
    await order(world, seller, r.id, 'UC_A', '다육이맘', '1')
    expect((await api.confirm(1, { date: '2026-10-18', buyer: 'UC_A', remaining: 14_000 })).status).toBe(404)
    expect(await settlementEvents(world, seller)).toEqual([])
    expect((await deposits(api))[0]?.status).toBe('REVIEW')
  })

  it('무시 → 확정 409 → 다시 확인 필요로 → 확정. 다른 상태의 무시·다시는 409', async () => {
    const { api } = await reviewWorld()
    expect((await expectOk(api.ignore(1))).body).toMatchObject({ deposit: { no: 1, status: 'IGNORED' } })
    expect((await api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 })).body).toMatchObject({ error: { code: 'DEPOSIT_IGNORED', message: '무시한 입금이에요. 다시 확인 필요로 옮긴 뒤 확정해 주세요.' } })
    expect((await api.ignore(1)).status).toBe(409)
    await expectOk(api.reopen(1))
    expect((await api.reopen(1)).status).toBe(409)
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
  })

  it('되돌리면 같은 금액 환불("입금 확인 되돌림 · 입금 #1")이 적히고 확인 필요로 돌아온다. 다시 확정하면 새 입금 기록', async () => {
    const { world, seller, api } = await reviewWorld()
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    const reverted = await expectOk(api.revert(1))
    expect(reverted.body).toMatchObject({ deposit: { no: 1, status: 'REVIEW', applied: null }, refund: { date: DAY } })
    expect((await api.revert(1)).status).toBe(409)
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    const events = await settlementEvents(world, seller)
    expect(events.map((event) => [event.type, event.fields.memo ?? event.reason])).toEqual([
      ['settlement.payment', '입금 내역으로 확인 · 입금 #1'],
      ['settlement.refund', '입금 확인 되돌림 · 입금 #1'],
      ['settlement.payment', '입금 내역으로 확인 · 입금 #1'],
    ])
    expect(getSettlement((await world.server.writer.read(seller.sellerId, DAY)).state, 'UC_A', DAY).received).toBe(14_000)
  })

  it('그 사이 손으로 환불을 적어 받은 금액이 모자라면 되돌리지 않고 409 (R-12가 조용히 넘기지 않게)', async () => {
    const { world, seller, api } = await reviewWorld()
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    await expectOk(writeEvent(world, seller, { type: 'settlement.refund', buyer: 'UC_A', date: DAY, amount: 1000, reason: '부분 환불' }, DAY))
    const response = await api.revert(1)
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ error: { code: 'REFUND_RECORDED', message: '이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.' } })
    expect((await settlementEvents(world, seller)).filter((event) => event.type === 'settlement.refund')).toHaveLength(1)
  })
})

describe('AC-N3-25 기억한 입금자명', () => {
  it('10/17 "김영희"를 "다육이맘" 묶음에 확정·기억 → 10/18 "김영희" 14,000 자동 확인 → 지우면 이름 후보가 아니다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.clock.set(kst('2026-10-17 20:00'))
    const b1 = await createBroadcast(world, seller, { date: '2026-10-17' })
    await register(world, seller, b1.id, 15)
    await order(world, seller, b1.id, 'UC_A', '다육이맘', '15')
    world.clock.set(kst('2026-10-17 21:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-10-17 20:30:00', name: '김영희', amount: 14_000 }])))
    const [item] = await deposits(api)
    expect(item?.review?.suggestions[0]?.canRemember).toBe(true)
    await expectOk(api.confirm(1, { date: '2026-10-17', buyer: 'UC_A', remaining: 14_000, remember: true }))
    const names = (await expectOk(api.names())).body as { names: { id: number; name: string; buyerName: string }[] }
    expect(names.names).toMatchObject([{ name: '김영희', buyerName: '다육이맘' }])
    world.clock.set(kst('2026-10-18 20:00'))
    const b2 = await createBroadcast(world, seller, { date: '2026-10-18' })
    await register(world, seller, b2.id, 3)
    await order(world, seller, b2.id, 'UC_A', '다육이맘', '3')
    world.clock.set(kst('2026-10-18 21:00'))
    expect((await expectOk(api.paste(pasteText([{ at: '2026-10-18 20:30:00', name: '김 영희', amount: 14_000 }])))).body).toMatchObject({ auto: 1 })
    await expectOk(api.forget((names.names[0] as { id: number }).id))
    expect(((await expectOk(api.names())).body as { names: unknown[] }).names).toEqual([])
    world.clock.set(kst('2026-10-18 21:30'))
    const b3 = await createBroadcast(world, seller, { date: '2026-10-18' })
    await register(world, seller, b3.id, 4)
    await order(world, seller, b3.id, 'UC_A', '다육이맘', '4')
    // 10/18 묶음은 이제 10,000 + 10,000 + 4,000 − 받은 14,000 = 남은 10,000
    world.clock.set(kst('2026-10-18 22:00'))
    expect((await expectOk(api.paste(pasteText([{ at: '2026-10-18 21:40:00', name: '김영희', amount: 10_000 }])))).body).toMatchObject({ auto: 0, review: 1 })
  })

  it('문자 구매자에는 기억하지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 1)
    const made = await sms(world, seller, b.id, 1)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '이철수', amount: 14_000 }])))
    expect((await deposits(api))[0]?.review?.suggestions[0]?.canRemember).toBe(false)
    await expectOk(api.confirm(1, { date: DAY, buyer: made.body.buyer as string, remaining: 14_000, remember: true }))
    expect(((await expectOk(api.names())).body as { names: unknown[] }).names).toEqual([])
  })
})

describe('AC-N3-28 한꺼번에 · AC-N3-29 같은 요청', () => {
  it('항목마다 결과를 순서대로, 한 항목의 거절이 다른 항목을 막지 않는다. 같은 입금 두 번은 두 번째가 거절, 같은 요청 번호는 처음 결과', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '갑', amount: 14_000 }, { at: '2026-10-19 12:00:31', name: '을', amount: 3000 }])))
    const items = [
      { no: 1, action: 'confirm', date: DAY, buyer: 'UC_A', remaining: 14_000 },
      { no: 1, action: 'ignore' },
      { no: 2, action: 'confirm' },
      { no: 2, action: 'ignore' },
      { no: 99, action: 'ignore' },
    ]
    const result = await expectOk(api.bulk(items, 'bulk-1'))
    expect((result.body as { results: { no: number; ok: boolean; status?: number; error?: { code: string } }[] }).results.map((item) => [item.no, item.ok, item.status ?? 200, item.error?.code ?? null])).toEqual([
      [1, true, 200, null],
      [1, false, 409, 'DUPLICATE_ITEM'],
      [2, false, 400, 'INVALID_INPUT'],
      [2, true, 200, null],
      [99, false, 404, 'NOT_FOUND'],
    ])
    expect((await expectOk(api.bulk(items, 'bulk-1'))).body).toEqual(result.body)
    expect((await settlementEvents(world, seller)).length).toBe(1)
    expect((await api.bulk([], 'bulk-2')).status).toBe(400)
    expect((await api.bulk(Array.from({ length: 101 }, (_, i) => ({ no: i + 1, action: 'ignore' })), 'bulk-3')).status).toBe(400)
  })

  it('엔진 기록과 입금 상태 저장 사이에 멈췄다가 같은 요청 번호로 다시 보내도 입금 기록은 하나다 (DP-INV-1)', async () => {
    let crash = true
    const world = await depositWorld({
      hooks: {
        afterCommit: (records) => {
          if (crash && records.some((record) => record.type === 'settlement.payment')) {
            crash = false
            throw new Error('응답 전에 멈춤')
          }
        },
      },
    })
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '박민수', amount: 14_000 }])))
    const first = await api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }, 'crash-1')
    expect(first.status).toBe(500)
    const again = await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }, 'crash-1'))
    expect(again.body).toMatchObject({ deposit: { no: 1, status: 'APPLIED' } })
    expect((await settlementEvents(world, seller)).length).toBe(1)
    expect((await deposits(api, 'APPLIED'))[0]?.no).toBe(1)
  })

  it('화면 이벤트 쓰기는 입금 확인의 엔진 요청 번호(dep-)를 받지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    const response = await client(world, seller.cookie).post(`/api/events?date=${DAY}`, { requestId: 'dep-1-pay-1', type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 1 })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: { code: 'INVALID_REQUEST_ID' } })
  })
})

describe('AC-N3-30 실시간 · AC-N3-31 처리 기록 · AC-N3-32 정산 조회의 입금 연결', () => {
  it('입금 저장·처리마다 그 판매자의 연결에 deposit 알림(입금 번호·확인 필요 수, 입금자명 없음)이 가고 다른 판매자에게는 가지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const mine = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } }))
    const theirs = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: other.cookie } }))
    await mine.until(() => mine.events.some((event) => event.event === 'ready'))
    await theirs.until(() => theirs.events.some((event) => event.event === 'ready'))
    const api = depositApi(world, seller)
    world.clock.advance(60_000)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '비밀이름', amount: 5000 }])))
    await mine.until(() => mine.events.some((event) => event.event === 'deposit'))
    const notice = mine.events.find((event) => event.event === 'deposit')
    expect(JSON.parse(notice?.data ?? '{}')).toMatchObject({ deposits: [1], review: 1 })
    expect(notice?.data).not.toContain('비밀이름')
    await expectOk(api.ignore(1))
    await mine.until(() => mine.events.filter((event) => event.event === 'deposit').length >= 2)
    expect(JSON.parse(mine.events.filter((event) => event.event === 'deposit').at(-1)?.data ?? '{}')).toMatchObject({ deposits: [1], review: 0 })
    expect(theirs.events.some((event) => event.event === 'deposit')).toBe(false)
    await mine.cancel()
    await theirs.cancel()
  })

  it('입금 하나 조회에 처리 기록이 시간 순서로 보인다 (누가·언제·무엇)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '박민수', amount: 14_000 }])))
    world.clock.advance(1000)
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    world.clock.advance(1000)
    await expectOk(api.revert(1))
    const detail = (await expectOk(api.detail(1))).body.deposit as { actions: { action: string; actor: { kind: string; loginId: string | null }; date: string | null; buyer: string | null; buyerName: string | null; seq: number | null }[] }
    expect(detail.actions.map((action) => [action.action, action.actor.kind, action.actor.loginId, action.date, action.buyerName])).toEqual([
      ['RECEIVED', 'account', seller.loginId, null, null],
      ['CONFIRM', 'account', seller.loginId, DAY, '다육이맘'],
      ['REVERT', 'account', seller.loginId, DAY, '다육이맘'],
    ])
  })

  it('정산 조회의 입금 확인 기록에 입금 정보가 붙고, 손으로 같은 메모를 적은 입금에는 붙지 않는다. 리허설 범위에는 없다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 1000, memo: '자동 입금 확인 · 입금 #3' }, DAY))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 13_000 }])))
    await expectOk(api.revert(1))
    const view = (await expectOk(api.day(DAY))).body as { depositLinks: { seq: number; kind: string; auto: boolean; reverted: boolean; deposit: { no: number; name: string; source: string } }[] }
    expect(view.depositLinks.map((link) => [link.kind, link.auto, link.reverted, link.deposit.no, link.deposit.name, link.deposit.source])).toEqual([
      ['payment', true, true, 1, '다육이맘', '붙여넣기'],
      ['refund', false, false, 1, '다육이맘', '붙여넣기'],
    ])
    const manual = (await settlementEvents(world, seller)).find((event) => event.fields.memo === '자동 입금 확인 · 입금 #3')
    expect(view.depositLinks.some((link) => link.seq === manual?.seq)).toBe(false)
    const r = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    expect(r.rehearsal).toBe(true)
    expect(((await expectOk(api.day(DAY, true))).body as { depositLinks: unknown[] }).depositLinks).toEqual([])
  })
})

describe('AC-N3-32 증분 조회의 입금 연결', () => {
  it('정산 묶음이 바뀐 증분에만 depositLinks(그 범위 전체)를 담고, 바뀌지 않았으면 담지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const before = (await expectOk(api.day(DAY))).body as { seq: number; depositLinks: unknown[] }
    expect(before.depositLinks).toEqual([])
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 14_000 }])))
    const changed = (await expectOk(api.api.get(`/api/days/${DAY}/changes?since=${String(before.seq)}`))).body as { seq: number; depositLinks?: { kind: string; deposit: { no: number } }[] }
    expect(changed.depositLinks?.map((link) => [link.kind, link.deposit.no])).toEqual([['payment', 1]])
    await register(world, seller, b.id, 16)
    const quiet = (await expectOk(api.api.get(`/api/days/${DAY}/changes?since=${String(changed.seq)}`))).body as { depositLinks?: unknown }
    expect('depositLinks' in quiet).toBe(false)
  })
})

describe('AC-N3-33 묶음 찾기', () => {
  it('찾을 말(이름·메모·뒤 4자리·채널 끝 4자리)과 날짜로 실제 범위 묶음을, 남은 금액이 있는 것 먼저 · 날짜가 늦은 것 순으로 찾는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.clock.set(kst('2026-10-18 20:00'))
    const b1 = await createBroadcast(world, seller, { date: '2026-10-18' })
    await register(world, seller, b1.id, 1)
    await order(world, seller, b1.id, 'UC_KIM9999', '김씨', '1')
    world.clock.set(kst('2026-10-19 11:00'))
    const b2 = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b2.id, 1)
    await order(world, seller, b2.id, 'UC_KIM9999', '김씨', '1')
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC_KIM9999', date: DAY, amount: 14_000 }, DAY))
    await register(world, seller, b2.id, 2)
    await sms(world, seller, b2.id, 2, '김메모', '010-1234-5678')
    const r = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await register(world, seller, r.id, 1)
    await order(world, seller, r.id, 'UC_KIM9999', '김씨', '1')
    world.clock.set(kst('2026-10-19 12:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 11:30:00', name: '아무개', amount: 1 }])))
    const found = (await expectOk(api.bundles(1, '김'))).body as { bundles: { date: string; buyer: string; remaining: number; after: { payment: string; refundDue: number } | null; beforeSale: boolean }[] }
    expect(found.bundles.map((bundle) => [bundle.date, bundle.buyer, bundle.remaining])).toEqual([
      [DAY, expect.stringMatching(/^sms:/), 14_000],
      ['2026-10-18', 'UC_KIM9999', 14_000],
      [DAY, 'UC_KIM9999', 0],
    ])
    expect(found.bundles[2]?.after).toEqual({ payment: 'OVERPAID', received: 14_001, refundDue: 1 })
    expect(found.bundles[0]?.beforeSale).toBe(false)
    expect(found.bundles[1]?.beforeSale).toBe(false)
    const byTail = (await expectOk(api.bundles(1, '9999', '2026-10-18'))).body as { bundles: { buyer: string }[] }
    expect(byTail.bundles.map((bundle) => bundle.buyer)).toEqual(['UC_KIM9999'])
    const byPhone = (await expectOk(api.bundles(1, '5678'))).body as { bundles: { buyer: string }[] }
    expect(byPhone.bundles).toHaveLength(1)
    expect((await api.bundles(999, '김')).status).toBe(404)
  })

  it('판매 시각보다 이른 입금이면 판매 전 입금으로 보인다 (확정은 막지 않는다)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    const api = depositApi(world, seller)
    world.clock.advance(60_000)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 11:00:00', name: '다육이맘', amount: 14_000 }])))
    const found = (await expectOk(api.bundles(1, '다육'))).body as { bundles: { beforeSale: boolean }[] }
    expect(found.bundles[0]?.beforeSale).toBe(true)
    const confirmed = await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    expect(confirmed.body).toMatchObject({ deposit: { status: 'APPLIED', applied: { beforeSale: true } } })
  })
})

describe('목록·자동 확인 중 멈춤', () => {
  it('상태를 쉼표로 여럿 고르면 함께 번호 내림차순 (자동 확인됨·확인함), 이어 받기 before·limit', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:10', name: '다육이맘', amount: 14_000 }, { at: '2026-10-19 12:00:20', name: '갑', amount: 1 }, { at: '2026-10-19 12:00:30', name: '을', amount: 2 }])))
    await expectOk(api.confirm(2, { date: DAY, buyer: 'UC_A', remaining: 0 }))
    const both = (await expectOk(api.list('AUTO_APPLIED,APPLIED'))).body as { deposits: { no: number; status: string }[]; more: boolean }
    expect(both.deposits.map((item) => [item.no, item.status])).toEqual([
      [2, 'APPLIED'],
      [1, 'AUTO_APPLIED'],
    ])
    const page = (await expectOk(api.list('AUTO_APPLIED,APPLIED', '&limit=1&before=2'))).body as { deposits: { no: number }[]; more: boolean }
    expect(page.deposits.map((item) => item.no)).toEqual([1])
    for (const bad of ['REVIEW,REVIEW', 'REVIEW,', 'review']) expect((await api.list(bad)).status).toBe(400)
  })

  it('자동 확인을 적고 응답 전에 멈춰도 받은 입금 요약은 돌아오고, 입금 상태는 적은 기록과 함께 바뀌어 있다', async () => {
    let crash = true
    const world = await depositWorld({
      hooks: {
        afterCommit: (records) => {
          if (crash && records.some((record) => record.type === 'settlement.payment')) {
            crash = false
            throw new Error('응답 전에 멈춤')
          }
        },
      },
    })
    const seller = await addSeller(world)
    await basicSale(world, seller)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:10', name: '다육이맘', amount: 14_000 }])))
    expect((await deposits(api, 'AUTO_APPLIED')).map((item) => item.no)).toEqual([1])
    expect(await settlementEvents(world, seller)).toHaveLength(1)
  })
})

describe('요청 번호·입력 검사', () => {
  it('확정·무시·되돌리기는 요청 번호가 필요하고, 모르는 항목은 400 UNKNOWN_FIELD', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    expect((await api.api.post('/api/deposits/1/ignore', {})).status).toBe(400)
    expect((await api.api.post('/api/deposits/1/ignore', { requestId: rid('x'), extra: 1 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await api.api.post('/api/deposits/1/confirm', { requestId: rid('x'), date: 'x', buyer: '', remaining: 1.5 })).status).toBe(400)
    expect((await api.api.get('/api/deposits/abc')).status).toBe(404)
    expect((await api.list('WRONG')).status).toBe(400)
  })
})
