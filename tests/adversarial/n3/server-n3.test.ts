// N3 적대 테스트 (test-domain): 서버 — 입금 확인 흐름을 방송 뒤 실제로 일어나는 순서로 공격한다.
// - 입금이 몰림: 다른 원천에서 같은 입금이 동시에 / 두 서버 인스턴스가 같은 묶음에 맞는 두 입금을 동시에 (AC-N3-22, DP-INV-1)
// - 판매자가 정산 화면에서 손으로 적는 중에 자동 확인이 겹침 (마지막 확인, AC-N3-22)
// - 손 환불 뒤 되돌리기, 합친 구매자의 되돌리기 (AC-N3-27)
// - 리허설·다른 판매자 (DP-INV-3, AC-N3-10·21·24), 받는 기간 경계 (AC-N3-12), 붙여넣기 줄 키 (AC-N3-11)
// - 손 메모 흉내 (AC-N3-32), 이벤트에 입금 정보 없음 (DP-INV-5), 운영 구성에 시험 경로 없음 (AC-N3-17), 비밀값 (AC-N3-16)
import { createServer, FakePopbillTransport } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { call, dumpAll, event, ORIGIN, COST, rid } from '../s04/helpers.ts'
import { checkInv1, DAY, dep, fakeSource, feed, history, idleTimer, immediateTimer, kst, kstIso, n3Harness, ok, sell, views, type N3 } from './helpers.ts'

let h: N3 | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const HOUR = 3_600_000

interface Settlement {
  buyer: string
  date: string
  total: number
  received: number
  payment: string
  records: { kind: string; amount: number; memo: string | null; reason: string | null; seq: number }[]
}
async function settlementOf(h: N3, cookie: string, buyer: string, date = DAY): Promise<Settlement | undefined> {
  const body = (await ok(dep(h.server, cookie).day(date))).body as { settlements: Settlement[] }
  return body.settlements.find((s) => s.buyer === buyer)
}

describe('AC-N3-22 입금이 몰림 — 같은 묶음을 두 입금이 함께 채우지 않는다', () => {
  it('다른 원천 둘이 같은 날·같은 금액·같은 이름 입금을 동시에 받아도 자동 확인은 하나, 묶음은 과입금이 아니다', async () => {
    h = await n3Harness()
    const a = await h.account('rush1')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t += HOUR
    const s1 = await fakeSource(h.server, a.cookie, '국민 1234')
    const s2 = await fakeSource(h.server, a.cookie, '신한 5678')
    const row = (key: string) => ({ key, at: kst('2026-10-18 20:30'), precision: 'second' as const, amount: 14_000, name: '다육이맘' })
    await Promise.all([h.server.deposits.ingest(a.sellerId, s1, [row('x1')]), h.server.deposits.ingest(a.sellerId, s2, [row('x2')])])
    const all = await views(h.server, a.cookie)
    expect(all).toHaveLength(2)
    expect(all.filter((v) => v.status === 'AUTO_APPLIED')).toHaveLength(1)
    const second = all.find((v) => v.status === 'REVIEW')
    expect(second?.review?.reason).toBe('POSSIBLE_DUPLICATE')
    expect((await settlementOf(h, a.cookie, 'UC_A'))?.received).toBe(14_000)
    await checkInv1(h.server, a.cookie, [DAY])
  })

  it('두 서버 인스턴스가 이름이 다른(둘 다 이름 후보) 두 입금을 동시에 받아도 묶음은 한 번만 채운다', async () => {
    h = await n3Harness()
    const a = await h.account('rush2')
    const b = await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '홍길동' }] })
    // 같은 채널이 닉네임을 바꿈 → 이름 후보 "홍길동"·"길동이"
    expect((await h.server.ingestChat(a.sellerId, { b, id: 'nick2', ch: 'UC_A', nick: '길동이', text: '안녕하세요' })).status).toBe('recorded')
    h.clock.t += HOUR
    const s1 = await fakeSource(h.server, a.cookie, '국민 1234')
    const s2 = await fakeSource(h.server, a.cookie, '신한 5678')
    const second = h.restart()
    await Promise.all([
      h.server.deposits.ingest(a.sellerId, s1, [{ key: 'y1', at: kst('2026-10-18 20:30'), precision: 'second', amount: 14_000, name: '홍길동' }]),
      second.deposits.ingest(a.sellerId, s2, [{ key: 'y2', at: kst('2026-10-18 20:31'), precision: 'second', amount: 14_000, name: '길동이' }]),
    ])
    const all = await views(h.server, a.cookie)
    expect(all).toHaveLength(2)
    expect(all.filter((v) => v.status === 'AUTO_APPLIED').length).toBeLessThanOrEqual(1)
    const s = await settlementOf(h, a.cookie, 'UC_A')
    expect(s?.received).toBeLessThanOrEqual(14_000)
    await checkInv1(h.server, a.cookie, [DAY])
  })
})

describe('AC-N3-22 마지막 확인 — 판매자가 손으로 적는 중에 자동 확인이 겹침', () => {
  it('맞추기 뒤·적기 전에 손 입금이 들어오면 자동으로 적지 않고, 같은 묶음 받아 오기의 다음 입금은 지금 상태로 다시 맞춘다', async () => {
    let inject: (() => Promise<void>) | null = null
    h = await n3Harness({ deposits: { hooks: { beforeAuto: async () => { const f = inject; inject = null; if (f !== null) await f() } } } })
    const a = await h.account('late1')
    await sell(h, h.server, a.cookie, a.sellerId, {
      items: [
        { no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' },
        { no: 16, price: 20_000, ch: 'UC_B', nick: '선인장' },
      ],
    })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    const server = h.server
    inject = async () => {
      await ok(event(server, a.cookie, { type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 4000, memo: '배송비만 먼저' }, DAY))
    }
    await feed(h.server, a.cookie, a.sellerId, src, [
      { key: 'z1', at: '2026-10-18 20:30', amount: 14_000, name: '다육이맘' },
      { key: 'z2', at: '2026-10-18 20:31', amount: 24_000, name: '선인장' },
    ])
    const all = await views(h.server, a.cookie)
    const one = all.find((v) => v.no === 1)
    const two = all.find((v) => v.no === 2)
    expect(one?.status).toBe('REVIEW')
    expect(two?.status).toBe('AUTO_APPLIED')
    expect((await settlementOf(h, a.cookie, 'UC_A'))?.received).toBe(4000)
    await checkInv1(h.server, a.cookie, [DAY])
  })
})

describe('AC-N3-27 되돌리기 — 손 환불·합친 구매자', () => {
  it('자동 확인 뒤 판매자가 손으로 환불을 적어 받은 금액이 모자라면 409이고 아무것도 적지 않는다', async () => {
    h = await n3Harness()
    const a = await h.account('rev1')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'r1', at: '2026-10-18 20:30', amount: 14_000, name: '다육이맘' }])
    expect((await views(h.server, a.cookie))[0]?.status).toBe('AUTO_APPLIED')
    await ok(event(h.server, a.cookie, { type: 'settlement.refund', buyer: 'UC_A', date: DAY, amount: 4000, reason: '배송비 돌려줌' }, DAY))
    const before = (await history(h.server, a.cookie)).length
    const res = await dep(h.server, a.cookie).revert(1)
    expect(res.status).toBe(409)
    expect((res.body.error as { message: string }).message).toBe('이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.')
    expect((await history(h.server, a.cookie)).length).toBe(before)
    expect((await views(h.server, a.cookie))[0]?.status).toBe('AUTO_APPLIED')
  })

  it('자동 확인한 구매자를 다른 구매자에 합친 뒤 되돌리면 합친 묶음에서 빠지고 입금은 확인 필요로', async () => {
    h = await n3Harness()
    const a = await h.account('rev2')
    await sell(h, h.server, a.cookie, a.sellerId, {
      items: [
        { no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' },
        { no: 16, price: 20_000, ch: 'UC_B', nick: '다육이맘2' },
      ],
    })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'm1', at: '2026-10-18 20:30', amount: 14_000, name: '다육이맘' }])
    expect((await views(h.server, a.cookie))[0]?.status).toBe('AUTO_APPLIED')
    await ok(event(h.server, a.cookie, { type: 'buyer.merge', from: 'UC_A', into: 'UC_B', reason: '같은 사람' }, DAY))
    expect((await settlementOf(h, a.cookie, 'UC_B'))?.received).toBe(14_000)
    await ok(dep(h.server, a.cookie).revert(1))
    expect((await settlementOf(h, a.cookie, 'UC_B'))?.received).toBe(0)
    expect((await views(h.server, a.cookie))[0]?.status).toBe('REVIEW')
    await checkInv1(h.server, a.cookie, [DAY])
  })
})

describe('AC-N3-21 이름 후보 — 문자 구매자를 유튜브 구매자에 합친 뒤 메모 이름 입금', () => {
  it('합친 묶음(지금의 구매자 = 유튜브)에 자동 확인한다', async () => {
    h = await n3Harness()
    const a = await h.account('memo1')
    const b = await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    await ok(event(h.server, a.cookie, { type: 'product.register', b, no: 16, name: '상품16', price: 5000 }))
    const smsRes = await ok(event(h.server, a.cookie, { type: 'sms', b, no: 16, memo: '김영희' }))
    const x = smsRes.body.buyer as string
    await ok(event(h.server, a.cookie, { type: 'buyer.merge', from: x, into: 'UC_A', reason: '같은 사람' }, DAY))
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    // 합친 묶음: 10,000 + 5,000 + 배송비
    const total = (await settlementOf(h, a.cookie, 'UC_A'))?.total as number
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'k1', at: '2026-10-18 20:30', amount: total, name: '김영희' }])
    const v = (await views(h.server, a.cookie))[0]
    expect(v?.status).toBe('AUTO_APPLIED')
    expect(v?.applied?.buyer).toBe('UC_A')
  })
})

describe('DP-INV-3 리허설 — 후보·확정·찾기 어디에도 없다', () => {
  it('리허설에만 있는 같은 금액·같은 이름 묶음: 자동 확인 없음, 제안 없음, 그 날짜 확정은 404, 찾기에도 없음', async () => {
    h = await n3Harness()
    const a = await h.account('reh1')
    await sell(h, h.server, a.cookie, a.sellerId, { date: '2026-10-17', items: [{ no: 1, price: 1000, ch: 'UC_Z', nick: '다른사람' }] })
    await sell(h, h.server, a.cookie, a.sellerId, { rehearsal: true, items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'h1', at: '2026-10-18 20:30', amount: 14_000, name: '다육이맘' }])
    const v = (await views(h.server, a.cookie))[0]
    expect(v?.status).toBe('REVIEW')
    expect(v?.review?.reason).toBe('NO_MATCH')
    expect(v?.review?.suggestions).toEqual([])
    const res = await dep(h.server, a.cookie).confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 })
    expect(res.status).toBe(404)
    expect(((await ok(dep(h.server, a.cookie).bundles(1, '다육이'))).body.bundles as unknown[]).length).toBe(0)
    expect((await history(h.server, a.cookie, DAY, true)).filter((e) => e.type.startsWith('settlement.'))).toEqual([])
  })
})

describe('AC-N3-10 다른 판매자', () => {
  it('다른 판매자의 입금 번호·원천·묶음으로는 처리·조회·받아 오기가 모두 404이고 아무것도 바뀌지 않는다', async () => {
    h = await n3Harness()
    const a = await h.account('iso.a')
    const b = await h.account('iso.b')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'i1', at: '2026-10-18 20:30', amount: 9_999, name: '다육이맘' }])
    const B = dep(h.server, b.cookie)
    expect((await B.detail(1)).status).toBe(404)
    expect((await B.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 })).status).toBe(404)
    expect((await B.ignore(1)).status).toBe(404)
    expect((await B.bundles(1, '')).status).toBe(404)
    expect((await B.fetch(src)).status).toBe(404)
    expect((await B.patchSource(src, { enabled: false })).status).toBe(404)
    expect((await B.testRows(src, [{ key: 'q', at: kstIso('2026-10-18 20:30'), amount: 1000, name: 'x' }])).status).toBe(404)
    expect(((await ok(B.list())).body.deposits as unknown[]).length).toBe(0)
    // 판매자 B에게 입금이 하나 생겨도 A의 묶음에 확정할 수 없다
    const srcB = await fakeSource(h.server, b.cookie)
    await feed(h.server, b.cookie, b.sellerId, srcB, [{ key: 'i2', at: '2026-10-18 20:30', amount: 14_000, name: '다육이맘' }])
    expect((await B.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 })).status).toBe(404)
    expect((await settlementOf(h, a.cookie, 'UC_A'))?.received).toBe(0)
    expect((await views(h.server, a.cookie))[0]?.status).toBe('REVIEW')
  })
})

describe('AC-N3-12 받는 기간 경계', () => {
  it('오늘 − 30일 00:00:00은 저장, 그 1초 전은 오래된 입금 / 받는 순간 + 5분 정각은 저장, 1초 뒤는 시각이 앞으로인 입금', async () => {
    h = await n3Harness()
    const a = await h.account('edge1')
    const src = await fakeSource(h.server, a.cookie)
    const now = h.clock.t
    const summary = await h.server.deposits.ingest(a.sellerId, src, [
      { key: 'e1', at: kst('2026-09-18 00:00:00'), precision: 'second', amount: 1000, name: 'a' },
      { key: 'e2', at: kst('2026-09-17 23:59:59'), precision: 'second', amount: 1000, name: 'b' },
      { key: 'e3', at: now + 5 * 60_000, precision: 'second', amount: 1000, name: 'c' },
      { key: 'e4', at: now + 5 * 60_000 + 1000, precision: 'second', amount: 1000, name: 'd' },
    ])
    expect(summary?.stored.length).toBe(2)
    expect(summary?.old).toBe(1)
    expect(summary?.future).toBe(1)
    expect((await views(h.server, a.cookie)).map((v) => v.name).sort()).toEqual(['a', 'c'])
  })
})

describe('AC-N3-11 붙여넣기 줄 키', () => {
  const header = '거래일시\t입금자명\t입금액\t잔액'
  it('같은 줄 둘 = 입금 둘 → 그중 하나만 다시 붙여 넣으면 0 → 셋이면 1 / 잔액만 다른 줄은 다른 입금 / 잔액 칸 없는 표는 다른 키', async () => {
    h = await n3Harness()
    const a = await h.account('key1')
    h.clock.t += HOUR
    const D = dep(h.server, a.cookie)
    const line = '2026-10-18 20:30\t김영희\t14,000\t100,000'
    const s1 = await ok(D.paste([header, line, line].join('\n')))
    expect(s1.body.new).toBe(2)
    const s2 = await ok(D.paste([header, line].join('\n')))
    expect(s2.body.new).toBe(0)
    expect(s2.body.existing).toBe(1)
    const s3 = await ok(D.paste([header, line, line, line].join('\n')))
    expect(s3.body.new).toBe(1)
    const s4 = await ok(D.paste([header, '2026-10-18 20:30\t김영희\t14,000\t114,000'].join('\n')))
    expect(s4.body.new).toBe(1)
    // 같은 내역을 이름 정규화만 다르게(공백·전각) 다시 붙여 넣어도 같은 입금이다
    const s5 = await ok(D.paste([header, '2026-10-18 20:30:00\t 김 영희 \t14000원\t100000'].join('\n')))
    expect(s5.body.new).toBe(0)
    // 같은 요청 번호로 다른 글을 다시 보내도 처음 요약 그대로, 아무것도 하지 않는다
    const id = rid('again')
    const first = await ok(D.paste([header, '2026-10-18 20:40\t박철수\t5,000\t1'].join('\n'), id))
    const again = await ok(D.paste([header, '2026-10-18 20:41\t박철수\t6,000\t2'].join('\n'), id))
    expect(again.body).toEqual(first.body)
    expect((await views(h.server, a.cookie)).length).toBe(5)
  })
})

describe('AC-N3-32 손 메모 흉내 · DP-INV-5', () => {
  it('판매자가 손으로 "자동 입금 확인 · 입금 #1"이라고 적은 입금에는 입금 연결이 없다', async () => {
    h = await n3Harness()
    const a = await h.account('memo2')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'w1', at: '2026-10-18 20:30', amount: 1000, name: '아무개' }])
    await ok(event(h.server, a.cookie, { type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 1000, memo: '자동 입금 확인 · 입금 #1' }, DAY))
    const links = (await ok(dep(h.server, a.cookie).day())).body.depositLinks as unknown[]
    expect(links).toEqual([])
  })

  it('입금 확인이 적은 이벤트의 메모·사유에는 입금자명·원천 이름·계좌번호가 없다 (자동·확정·되돌림)', async () => {
    h = await n3Harness()
    const a = await h.account('inv5')
    await sell(h, h.server, a.cookie, a.sellerId, {
      items: [
        { no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' },
        { no: 16, price: 20_000, ch: 'UC_B', nick: '선인장' },
      ],
    })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie, '국민 9876')
    await feed(h.server, a.cookie, a.sellerId, src, [
      { key: 'v1', at: '2026-10-18 20:30', amount: 14_000, name: '다육이맘' },
      { key: 'v2', at: '2026-10-18 20:31', amount: 24_000, name: '홍길순' },
    ])
    await ok(dep(h.server, a.cookie).confirm(2, { date: DAY, buyer: 'UC_B', remaining: 24_000 }))
    await ok(dep(h.server, a.cookie).revert(1))
    const events = (await history(h.server, a.cookie)).filter((e) => e.actor.kind === 'deposit' || /입금 #/.test(String(e.fields['memo'] ?? e.fields['reason'] ?? e.reason ?? '')))
    expect(events.length).toBe(3)
    for (const e of events) {
      const text = JSON.stringify(e)
      for (const secret of ['다육이맘', '홍길순', '국민', '9876', '시험용']) expect(text).not.toContain(secret)
    }
  })
})

describe('AC-N3-17 운영 구성에는 시험 경로가 없다', () => {
  it('testMode 없이 만든 서버: 시험용 입금 넣기 404, 가짜 원천 만들기 400', async () => {
    h = await n3Harness()
    const prod = createServer({ database: h.database, masterKey: h.masterKey, appOrigin: ORIGIN, passwordCost: COST, clock: h.clock, deposits: { popbill: null, timer: idleTimer, waitTimer: immediateTimer } })
    try {
      const a = await h.account('prod1')
      const res = await call(prod, a.cookie, 'POST', '/api/deposits/test/rows', { source: 'dsrc_x', rows: [] })
      expect(res.status).toBe(404)
      const fake = await call(prod, a.cookie, 'POST', '/api/deposits/sources', { kind: 'FAKE', label: '시험' })
      expect(fake.status).toBe(400)
      const popbill = await call(prod, a.cookie, 'POST', '/api/deposits/sources', { kind: 'POPBILL', label: '국민', corpNum: '1234567890', bank: '0004', accountNumber: '12345678901' })
      expect(popbill.status).toBe(409)
      expect((popbill.body.error as { message: string }).message).toBe('계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.')
    } finally {
      prod.close()
    }
  })
})

describe('AC-N3-16 비밀값', () => {
  it('비밀번호 모양 항목은 400 UNKNOWN_FIELD이고 원천이 생기지 않는다 / DB에 계좌번호·사업자번호 평문이 없다 / 응답엔 끝 4자리만', async () => {
    h = await n3Harness()
    const a = await h.account('sec1')
    const D = dep(h.server, a.cookie)
    const base = { kind: 'POPBILL', label: '국민', corpNum: '123-45-67890', bank: '0004', accountNumber: '987654-01-112233' }
    for (const extra of ['accountPassword', 'fastId', 'fastPassword', 'password', 'birthDate']) {
      const res = await D.createSource({ ...base, [extra]: 'secret-777' })
      expect(res.status, extra).toBe(400)
      expect((res.body.error as { code: string }).code).toBe('UNKNOWN_FIELD')
      expect(res.text).not.toContain('secret-777')
    }
    expect(((await ok(D.sources())).body.sources as unknown[]).length).toBe(0)
    const created = await ok(D.createSource(base))
    expect(created.text).not.toContain('1234567890')
    expect(created.text).not.toContain('98765401112233')
    expect(created.body.accountLast4).toBe('2233')
    const patch = await D.patchSource(created.body.id as string, { accountNumber: '111' })
    expect(patch.status).toBe(400)
    const dump = await dumpAll(h.database)
    for (const plain of ['1234567890', '98765401112233', '987654-01-112233', '123-45-67890', 'secret-777']) expect(dump).not.toContain(plain)
    for (const log of h.logs) expect(JSON.stringify(log)).not.toMatch(/1234567890|98765401112233/)
  })
})

describe('AC-N3-28 한꺼번에', () => {
  it('같은 입금 두 번은 두 번째만 거절, 묶음을 고르지 않은 확정은 그 항목만 400, 다른 항목은 처리된다', async () => {
    h = await n3Harness()
    const a = await h.account('bulk1')
    await sell(h, h.server, a.cookie, a.sellerId, {
      items: [
        { no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' },
        { no: 16, price: 20_000, ch: 'UC_B', nick: '선인장' },
      ],
    })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [
      { key: 'b1', at: '2026-10-18 20:30', amount: 14_000, name: '누구' },
      { key: 'b2', at: '2026-10-18 20:31', amount: 24_000, name: '누구2' },
      { key: 'b3', at: '2026-10-18 20:32', amount: 500, name: '누구3' },
    ])
    const res = await ok(
      dep(h.server, a.cookie).bulk([
        { no: 1, action: 'confirm', date: DAY, buyer: 'UC_A', remaining: 14_000 },
        { no: 1, action: 'ignore' },
        { no: 2, action: 'confirm' },
        { no: 3, action: 'ignore' },
      ]),
    )
    const results = res.body.results as { ok: boolean; status?: number }[]
    expect(results.map((r) => r.ok)).toEqual([true, false, false, true])
    expect(results[1]?.status).toBe(409)
    expect(results[2]?.status).toBe(400)
    const all = await views(h.server, a.cookie)
    expect(all.map((v) => [v.no, v.status]).sort()).toEqual([
      [1, 'APPLIED'],
      [2, 'REVIEW'],
      [3, 'IGNORED'],
    ])
    await checkInv1(h.server, a.cookie, [DAY])
  })
})

describe('AC-N3-15 원천 실패는 판매를 멈추지 않는다', () => {
  it('팝빌 전송이 응답하지 않는 동안에도 판매 쓰기는 끝나고, 입금은 생기지 않으며 원천에 오류 문장이 남는다', async () => {
    const popbill = new FakePopbillTransport()
    h = await n3Harness({ deposits: { popbill, callTimeoutMs: 50 } })
    const a = await h.account('hang1')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    const account = { corpNum: '1234567890', bankCode: '0004', accountNumber: '12345678901' }
    popbill.register(account).addRows(account, [{ tid: 't1', trdt: '20261018203000', accIn: '14000', remark1: '다육이맘' }])
    const src = (await ok(dep(h.server, a.cookie).createSource({ kind: 'POPBILL', label: '국민', corpNum: account.corpNum, bank: account.bankCode, accountNumber: account.accountNumber }))).body.id as string
    popbill.fail('search', 'HANG')
    const running = h.server.deposits.runSource(a.sellerId, src)
    const write = await event(h.server, a.cookie, { type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 1000, memo: '손 입금' }, DAY)
    expect(write.status).toBe(200)
    await running
    expect((await views(h.server, a.cookie)).length).toBe(0)
    const source = ((await ok(dep(h.server, a.cookie).sources())).body.sources as { id: string; lastError: string | null }[]).find((s) => s.id === src)
    expect(source?.lastError).toBe('팝빌에 연결하지 못했어요. 잠시 뒤에 다시 받아 올게요.')
  })
})

describe('AC-N3-25 기억한 입금자명', () => {
  it('10/17 확정하며 기억 → 10/18 같은 이름 자동 확인 → 지운 뒤에는 이름 후보가 아니다', async () => {
    h = await n3Harness()
    const a = await h.account('rem1')
    h.clock.t = kst('2026-10-17 20:00')
    await sell(h, h.server, a.cookie, a.sellerId, { date: '2026-10-17', items: [{ no: 1, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t = kst('2026-10-17 21:00')
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'n1', at: '2026-10-17 20:30', amount: 14_000, name: '김영희' }])
    expect((await views(h.server, a.cookie))[0]?.review?.reason).toBe('NAME_MISMATCH')
    await ok(dep(h.server, a.cookie).confirm(1, { date: '2026-10-17', buyer: 'UC_A', remaining: 14_000, remember: true }))
    const names = (await ok(dep(h.server, a.cookie).names())).body.names as { id: number; name: string; buyerName: string }[]
    expect(names.map((n) => [n.name, n.buyerName])).toEqual([['김영희', '다육이맘']])
    h.clock.t = kst('2026-10-18 20:00')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 1, price: 10_000, ch: 'UC_A', nick: '다육이맘' }] })
    h.clock.t = kst('2026-10-18 21:00')
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'n2', at: '2026-10-18 20:30', amount: 14_000, name: '김 영희' }])
    expect((await views(h.server, a.cookie)).find((v) => v.no === 2)?.status).toBe('AUTO_APPLIED')
    // 지우기
    const del = await h.server.app.request(`/api/deposits/names/${String(names[0]?.id)}`, { method: 'DELETE', headers: { Cookie: a.cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })
    expect(del.status).toBe(200)
    await ok(dep(h.server, a.cookie).revert(2))
    const v = (await views(h.server, a.cookie)).find((x) => x.no === 2)
    expect(v?.status).toBe('REVIEW')
    expect(v?.review?.reason).toBe('NAME_MISMATCH')
  })
})

describe('TD-N3-001 입금자명의 NUL 글자 하나가 받아 오기·붙여넣기 전체를 막는다 (AC-N3-13·15)', () => {
  it('TD-N3-001: 계좌조회 응답의 한 줄 입금자명에 NUL(U+0000)이 있어도 나머지 입금은 저장된다', async () => {
    const popbill = new FakePopbillTransport()
    h = await n3Harness({ deposits: { popbill } })
    const a = await h.account('nul1')
    h.clock.t += HOUR
    const account = { corpNum: '1234567890', bankCode: '0004', accountNumber: '12345678901' }
    popbill.register(account).addRows(account, [
      { tid: 't1', trdt: '20261018203000', accIn: '14000', remark1: '김\u0000영희' },
      { tid: 't2', trdt: '20261018203100', accIn: '5000', remark1: '박철수' },
    ])
    const src = (await ok(dep(h.server, a.cookie).createSource({ kind: 'POPBILL', label: '국민', corpNum: account.corpNum, bank: account.bankCode, accountNumber: account.accountNumber }))).body.id as string
    await h.server.deposits.runSource(a.sellerId, src)
    // AC-N3-15: 모양이 틀린 줄은 건너뛰고(원천 오류 "읽지 못한 내역이 있어요") 나머지 줄은 저장한다.
    // 지금은 저장 트랜잭션 전체가 실패해 박철수 5,000원도 저장되지 않고, 다음 주기마다 같은 줄로 다시 실패한다(어제·오늘 범위를 벗어나면 영영 못 받는다).
    const names = (await views(h.server, a.cookie)).map((v) => v.name)
    expect(names).toContain('박철수')
    const source = ((await ok(dep(h.server, a.cookie).sources())).body.sources as { id: string; lastError: string | null }[]).find((s) => s.id === src)
    expect(source?.lastError).not.toBe('받은 내역을 저장하지 못했어요. 잠시 뒤에 다시 받아 올게요.')
  })

  it('TD-N3-001: 붙여넣기 미리 보기가 "새 입금"이라고 한 글을 넣으면 500이 아니고 나머지 줄은 저장된다', async () => {
    h = await n3Harness()
    const a = await h.account('nul2')
    h.clock.t += HOUR
    const D = dep(h.server, a.cookie)
    const text = '거래일시\t입금자명\t입금액\n2026-10-18 20:30\t김\u0000영희\t14,000\n2026-10-18 20:31\t박철수\t5,000'
    const preview = await ok(D.preview(text))
    expect((preview.body.rows as { state: string }[]).map((r) => r.state)).toEqual(['NEW', 'NEW'])
    const res = await D.paste(text)
    expect(res.status, res.text).toBeLessThan(500)
    expect((await views(h.server, a.cookie)).map((v) => v.name)).toContain('박철수')
  })
})

describe('AC-N3-16 계좌 암호문은 판매자·원천에 묶인다 (회귀)', () => {
  it('판매자 A의 계좌 암호문을 판매자 B의 원천 행으로 옮기면 풀리지 않고, B의 받아 오기는 A의 계좌로 팝빌을 부르지 않는다', async () => {
    const popbill = new FakePopbillTransport()
    h = await n3Harness({ deposits: { popbill } })
    const a = await h.account('seal.a')
    const b = await h.account('seal.b')
    const accA = { corpNum: '1111111111', bankCode: '0004', accountNumber: '11112222333' }
    const accB = { corpNum: '2222222222', bankCode: '0088', accountNumber: '99998888777' }
    popbill.register(accA).register(accB)
    const srcA = (await ok(dep(h.server, a.cookie).createSource({ kind: 'POPBILL', label: 'A', corpNum: accA.corpNum, bank: accA.bankCode, accountNumber: accA.accountNumber }))).body.id as string
    const srcB = (await ok(dep(h.server, b.cookie).createSource({ kind: 'POPBILL', label: 'B', corpNum: accB.corpNum, bank: accB.bankCode, accountNumber: accB.accountNumber }))).body.id as string
    const pg = h.database.pglite
    if (pg === null) throw new Error('PGlite')
    await pg.query(`update deposit_sources set account_enc = (select account_enc from deposit_sources where id = $1) where id = $2`, [srcA, srcB])
    const viewB = ((await ok(dep(h.server, b.cookie).sources())).body.sources as { id: string; accountLast4: string | null }[]).find((s) => s.id === srcB)
    expect(viewB?.accountLast4).not.toBe('3333')
    const before = popbill.calls.length
    await h.server.deposits.runSource(b.sellerId, srcB)
    expect(JSON.stringify(popbill.calls.slice(before))).not.toContain(accA.accountNumber)
  })
})

describe('TD-N3-003 입금자명의 짝 없는 서로게이트 글자 하나가 받아 오기·붙여넣기 전체를 막는다 (AC-N3-13·15, TD-N3-001과 같은 종류)', () => {
  // cleanDepositName은 U+0000만 뺀다. 짝 없는 낮은 서로게이트(U+DC00~DFFF, JSON "\udc00" 이스케이프로 그대로 들어온다)가
  // 한글 뒤에 오면 저장 질의(insert into deposits)가 실패해 같은 받아 오기·붙여넣기의 정상 입금까지 저장되지 않는다.
  // (PGlite — 시험·E2E·LIVEJJIM_PGLITE_DIR 기동이 쓰는 DB. schema.ts 머리 주석도 서로게이트를 위험 글자로 적어 두었다.)
  it('TD-N3-003: 계좌조회 응답의 한 줄 입금자명에 짝 없는 서로게이트(U+DC00)가 있어도 나머지 입금은 저장되고 원천이 막히지 않는다', async () => {
    const popbill = new FakePopbillTransport()
    h = await n3Harness({ deposits: { popbill } })
    const a = await h.account('sur1')
    h.clock.t += HOUR
    const account = { corpNum: '1234567890', bankCode: '0004', accountNumber: '12345678901' }
    popbill.register(account).addRows(account, [
      { tid: 't1', trdt: '20261018203000', accIn: '14000', remark1: '김\uDC00영희' },
      { tid: 't2', trdt: '20261018203100', accIn: '5000', remark1: '박철수' },
    ])
    const src = (await ok(dep(h.server, a.cookie).createSource({ kind: 'POPBILL', label: '국민', corpNum: account.corpNum, bank: account.bankCode, accountNumber: account.accountNumber }))).body.id as string
    await h.server.deposits.runSource(a.sellerId, src)
    const names = (await views(h.server, a.cookie)).map((v) => v.name)
    expect(names).toContain('박철수')
    const source = ((await ok(dep(h.server, a.cookie).sources())).body.sources as { id: string; lastError: string | null }[]).find((s) => s.id === src)
    expect(source?.lastError).not.toBe('받은 내역을 저장하지 못했어요. 잠시 뒤에 다시 받아 올게요.')
  })

  it('TD-N3-003: 붙여넣기 미리 보기가 "새 입금"이라고 한 글(이름 칸에 U+DC00)을 넣으면 500이 아니고 미리 보기의 새 입금 수만큼 저장된다', async () => {
    h = await n3Harness()
    const a = await h.account('sur2')
    h.clock.t += HOUR
    const D = dep(h.server, a.cookie)
    const text = '거래일시\t입금자명\t입금액\n2026-10-18 20:30\t김\uDC00영희\t14,000\n2026-10-18 20:31\t박철수\t5,000'
    // 미리 보기가 "새 입금"이라고 한 줄 수 = 넣은 결과의 새 입금 수 (AC-N3-13 — 이름을 다듬든 읽지 못한 줄로 돌리든 둘이 같아야 한다)
    const preview = await ok(D.preview(text))
    const fresh = (preview.body.rows as { state: string }[]).filter((r) => r.state === 'NEW').length
    expect(fresh).toBeGreaterThanOrEqual(1)
    const res = await D.paste(text)
    expect(res.status, res.text).toBe(200)
    expect(res.body.new).toBe(fresh)
    expect((await views(h.server, a.cookie)).map((v) => v.name)).toContain('박철수')
    // 같은 글을 다시 넣으면 새 입금 0건 (미리 보기·줄 키·저장이 같은 이름을 본다)
    const again = await ok(D.paste(text))
    expect(again.body.new).toBe(0)
  })

  it('TD-N3-003: 시험용 입금 넣기(가짜 원천)도 같은 이름 다듬기를 거친다 — 서로게이트 줄이 다른 줄 저장을 막지 않는다', async () => {
    h = await n3Harness()
    const a = await h.account('sur3')
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [
      { key: 'f1', at: '2026-10-18 20:30', amount: 14_000, name: '김\uDC00영희' },
      { key: 'f2', at: '2026-10-18 20:31', amount: 5_000, name: '박철수' },
    ])
    expect((await views(h.server, a.cookie)).map((v) => v.name)).toContain('박철수')
  })
})
