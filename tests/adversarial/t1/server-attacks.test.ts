// T1 적대 시험 (test-domain): 택배 서버를 실제 판매자가 할 법한 조작·엇갈림으로 공격한다.
// 가짜 택배사(127.0.0.1)를 붙인 서버(apps/server/test/t1-support.ts)를 쓴다. 지적이 없던 공격은 회귀 시험으로 남긴다.
import { describe, expect, it } from 'vitest'
import { linkApi, openLink, tokenOf } from '../../../apps/server/test/n4b-support.ts'
import { ORIGIN, client, fakeClock, rid, writeEvent } from '../../../apps/server/test/support.ts'
import { ADDRESS, D, attempts, bookOk, dayRows, expect200, makeReady, packingKinds, parcelApi, parcelSeller, parcelWorld, rowOf, sell, sellerAddress } from '../../../apps/server/test/t1-support.ts'

const bookRequests = (world: { carrier: { requests: { op: string; requestKey: string | null; body: unknown }[] } }) => world.carrier.requests.filter((item) => item.op === 'book')

describe('TD-T1 판매자 나눔 — 같은 시청자가 두 가게에서 산다', () => {
  it('같은 채널 ID·같은 날짜라도 가게마다 자기 배송지로 따로 접수되고, 한쪽 조회·취소가 다른 쪽에 번지지 않는다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    const t = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    await sell(world, t, [['UC_A', '가람', 2]])
    await makeReady(world, s, 'UC_A')
    await makeReady(world, t, 'UC_A', { ...ADDRESS, name: '다른분', address: '부산광역시 해운대구 우동 1' })
    const r1 = await bookOk(world, s, [{ buyer: 'UC_A' }])
    expect((await rowOf(world, t, 'UC_A')).ready).toBe(true)
    const r2 = await bookOk(world, t, [{ buyer: 'UC_A' }])
    expect(r1[0]?.ok && r2[0]?.ok).toBe(true)
    expect(r1[0]?.invoice).not.toBe(r2[0]?.invoice)
    const sent = bookRequests(world).map((item) => JSON.stringify(item.body))
    expect(sent).toHaveLength(2)
    expect(sent[0]).toContain('홍길동')
    expect(sent[0]).not.toContain('다른분')
    expect(sent[1]).toContain('다른분')
    expect(sent[1]).toContain('부산광역시')
    world.carrier.setStatus(r1[0]?.invoice as string, 'PICKED_UP')
    await world.server.parcels.trackOnce()
    expect((await rowOf(world, s, 'UC_A')).parcel?.status).toBe('집하')
    expect((await rowOf(world, t, 'UC_A')).parcel?.status).toBe('접수됨')
    // S는 집하라 취소 못 하고, T는 취소된다 — S의 접수는 그대로
    expect((await parcelApi(world, s.cookie).cancel('UC_A')).status).toBe(409)
    await expect200(parcelApi(world, t.cookie).cancel('UC_A'))
    expect((await rowOf(world, s, 'UC_A')).parcel?.state).toBe('BOOKED')
    // T가 S의 날짜 운송장을 달라고 해도 자기 것만 본다 (T는 취소해서 접수 없음)
    expect((await parcelApi(world, t.cookie).waybills()).status).toBe(409)
  })
})

describe('TD-T1 같은 화면 요청 번호 동시에 (AC-T1-31·32)', () => {
  it('같은 요청 번호로 10번 동시에 보내도 택배사에는 묶음마다 한 번, 모든 답이 같다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1], ['UC_B', '나래', 1]])
    await makeReady(world, s, 'UC_A')
    await makeReady(world, s, 'UC_B')
    const id = rid('pb')
    const api = parcelApi(world, s.cookie)
    const all = await Promise.all(Array.from({ length: 10 }, () => api.book([{ buyer: 'UC_A' }, { buyer: 'UC_B' }], D, id)))
    for (const r of all) expect(r.status, r.text).toBe(200)
    const bodies = new Set(all.map((r) => JSON.stringify(r.body)))
    expect(bodies.size).toBe(1)
    expect(bookRequests(world)).toHaveLength(2)
    for (const buyer of ['UC_A', 'UC_B']) expect((await packingKinds(world, s.sellerId, buyer)).filter((p) => p.kind === 'SHIPPED')).toHaveLength(1)
  })

  it('같은 요청 번호를 다른 날짜·다른 명령에 다시 쓰면 아무것도 하지 않고 409', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    await sell(world, s, [['UC_A', '가람', 1]], '2026-10-20')
    await makeReady(world, s, 'UC_A')
    await makeReady(world, s, 'UC_A', ADDRESS, '2026-10-20')
    const id = rid('pb')
    await bookOk(world, s, [{ buyer: 'UC_A' }], D, id)
    const other = await parcelApi(world, s.cookie).book([{ buyer: 'UC_A' }], '2026-10-20', id)
    expect(other.status, other.text).toBe(409)
    const cancel = await parcelApi(world, s.cookie).cancel('UC_A', D, id)
    expect(cancel.status, cancel.text).toBe(409)
    expect(bookRequests(world)).toHaveLength(1)
    expect((await rowOf(world, s, 'UC_A')).parcel?.state).toBe('BOOKED')
    expect((await rowOf(world, s, 'UC_A', '2026-10-20')).ready).toBe(true)
  })
})

describe('TD-T1 접수 결과를 기다리는 동안의 잠금 (PC-3 잠금·PC-5)', () => {
  it('택배사가 답하지 않는 동안 판매자 고치기·지우기·구매자 양식·포장 취소가 모두 409이고 배송지가 그대로다', async () => {
    const world = await parcelWorld({ timeoutMs: 1500 })
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    await makeReady(world, s, 'UC_A')
    const created = await linkApi(world, s.cookie).create(D, 'UC_A')
    const token = tokenOf((created.body.link as { url: string }).url)
    world.carrier.failNext('book', 'TIMEOUT')
    const api = parcelApi(world, s.cookie)
    const pending = api.book([{ buyer: 'UC_A' }])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await api.putAddress('UC_A', { ...ADDRESS, name: '바꿈' })).status).toBe(409)
    const form = await world.server.app.request(`/r/${token}/address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
      body: new URLSearchParams({ ...ADDRESS, name: '바꿈' }).toString(),
    })
    expect(form.status).toBe(409)
    expect((await api.remove('UC_A')).status).toBe(409)
    const unpack = await client(world, s.cookie).post(`/api/days/${D}/packing`, { requestId: rid('pk'), buyer: 'UC_A', action: 'unpack' })
    expect(unpack.status, unpack.text).toBe(409)
    expect((await pending).status).toBe(200)
    const bundle = await expect200(api.bundle('UC_A'))
    expect(bundle.body.bundle).toMatchObject({ address: { name: '홍길동', confirmed: true }, locked: true })
  })
})

describe('TD-T1 구매자 링크 양식 본문 (AC-T1-11)', () => {
  it('길이를 밝히지 않은 큰 본문(64KB × 200)은 한도를 넘는 순간 읽기를 멈추고 400, 저장 없음', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    const created = await linkApi(world, s.cookie).create(D, 'UC_A')
    const token = tokenOf((created.body.link as { url: string }).url)
    let pulled = 0
    const chunk = new TextEncoder().encode('memo=' + 'a'.repeat(64 * 1024))
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        if (pulled > 200) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const request = new Request(`http://localhost/r/${token}/address`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: stream, duplex: 'half' } as RequestInit)
    const response = await world.server.app.request(request)
    expect(response.status).toBe(400)
    expect(pulled).toBeLessThan(10)
    expect((await expect200(parcelApi(world, s.cookie).bundle('UC_A'))).body.bundle).toMatchObject({ address: null })
  })

  it('저장한 쪽은 이름을 이스케이프하고 주소·상세·메모·연락처 전체를 보이지 않는다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    await sellerAddress(world, s, 'UC_A', { ...ADDRESS, name: '<b>x</b>&amp;' })
    const created = await linkApi(world, s.cookie).create(D, 'UC_A')
    const token = tokenOf((created.body.link as { url: string }).url)
    const page = await openLink(world, `/r/${token}`)
    const section = page.text.slice(page.text.indexOf('id="address"'), page.text.indexOf('</section>', page.text.indexOf('id="address"')))
    expect(section).toContain('&lt;b&gt;x&lt;/b&gt;&amp;amp;')
    expect(page.text).not.toContain('<b>x')
    for (const hidden of ['세종대로', '101동', '문 앞에', '01012345678', '010-1234-5678']) expect(section, hidden).not.toContain(hidden)
    expect(section).toContain('5678')
  })
})

describe('TD-T1 취소·다시 접수와 운송장 (AC-T1-37·43)', () => {
  it('A를 취소하고 다시 접수하면 새 송장이고, 전부 PDF는 지금 접수한 것만 센다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1], ['UC_B', '나래', 2]])
    await makeReady(world, s, 'UC_A')
    await makeReady(world, s, 'UC_B')
    const api = parcelApi(world, s.cookie)
    const first = await bookOk(world, s, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }])
    await expect200(api.cancel('UC_A'))
    const afterCancel = await api.waybills()
    expect(afterCancel.status).toBe(200)
    expect(afterCancel.headers.get('x-waybill-count')).toBe('1')
    expect((await api.waybill('UC_A')).status).toBe(409)
    const again = await bookOk(world, s, [{ buyer: 'UC_A' }])
    expect(again[0]?.ok).toBe(true)
    expect(again[0]?.invoice).not.toBe(first[0]?.invoice)
    const keys = bookRequests(world).map((item) => item.requestKey)
    expect(new Set(keys).size).toBe(3)
    const all = await api.waybills()
    expect(all.headers.get('x-waybill-count')).toBe('2')
    expect(all.headers.get('x-waybill-skipped')).toBe('0')
    const rows = await dayRows(world, s)
    expect(rows.booked.map((row) => [row.buyer, row.parcel?.invoice])).toEqual([
      ['UC_A', again[0]?.invoice],
      ['UC_B', first[1]?.invoice],
    ])
  })

  it('같은 묶음 취소를 세 기기에서 동시에 눌러도 "배송 취소" 기록은 하나이고 모두 같은 모습을 받는다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    await makeReady(world, s, 'UC_A')
    await bookOk(world, s, [{ buyer: 'UC_A' }])
    const api = parcelApi(world, s.cookie)
    const all = await Promise.all([api.cancel('UC_A'), api.cancel('UC_A'), api.cancel('UC_A')])
    for (const r of all) expect(r.status, r.text).toBe(200)
    const kinds = (await packingKinds(world, s.sellerId, 'UC_A')).map((p) => p.kind)
    expect(kinds).toEqual(['PACKED', 'SHIPPED', 'UNSHIPPED'])
    expect((await attempts(world, s.sellerId, 'UC_A')).map((a) => a.state)).toEqual(['CANCELLED'])
    expect((await rowOf(world, s, 'UC_A')).ready).toBe(true)
  })

  it('취소를 누른 순간 택배사가 가져갔으면(조회와 엇갈림) 409이고 접수·포장 기록이 그대로다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_A', '가람', 1]])
    await makeReady(world, s, 'UC_A')
    const booked = await bookOk(world, s, [{ buyer: 'UC_A' }])
    world.carrier.setStatus(booked[0]?.invoice as string, 'PICKED_UP')
    const [cancel] = await Promise.all([parcelApi(world, s.cookie).cancel('UC_A'), world.server.parcels.trackOnce()])
    expect(cancel.status, cancel.text).toBe(409)
    expect(cancel.text).toContain('택배사가 이미 가져갔어요.')
    expect((await attempts(world, s.sellerId, 'UC_A')).map((a) => [a.state, a.track])).toEqual([['BOOKED', 'PICKED_UP']])
    expect(world.carrier.statusOf(booked[0]?.invoice as string)).toBe('PICKED_UP')
    expect((await packingKinds(world, s.sellerId, 'UC_A')).map((p) => p.kind)).toEqual(['PACKED', 'SHIPPED'])
  })

  it('다른 날짜의 같은 구매자를 취소해도 이 날짜 접수는 그대로이고 날짜 목록의 수가 맞다', async () => {
    const world = await parcelWorld()
    const s = await parcelSeller(world)
    const E = '2026-10-20'
    await sell(world, s, [['UC_A', '가람', 1]])
    await sell(world, s, [['UC_A', '가람', 1]], E)
    await makeReady(world, s, 'UC_A')
    await makeReady(world, s, 'UC_A', ADDRESS, E)
    await bookOk(world, s, [{ buyer: 'UC_A' }])
    await bookOk(world, s, [{ buyer: 'UC_A' }], E)
    await expect200(parcelApi(world, s.cookie).cancel('UC_A'))
    expect((await rowOf(world, s, 'UC_A', E)).parcel?.state).toBe('BOOKED')
    const days = await expect200(parcelApi(world, s.cookie).days())
    expect(days.body.dates).toEqual([
      { date: E, ready: 0, booked: 1 },
      { date: D, ready: 1, booked: 0 },
    ])
    expect(days.body.selected).toBe(D)
  })
})

describe('TD-T1 접수 결과를 모르는 묶음에 합치기 (D-I2-20·PC-5 다시 확인)', () => {
  it('Y가 "모름"인 동안 X를 Y에 합쳐도 다시 확인은 같은 요청 번호 하나로 가고, 접수 뒤 Y는 "배송 뒤 바뀜"(X 품목은 택배에 없음)으로 알린다', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ timeoutMs: 250, clock })
    const s = await parcelSeller(world)
    await sell(world, s, [['UC_Y', '와이', 1], ['UC_X', '엑스', 2]])
    await makeReady(world, s, 'UC_Y')
    world.carrier.failNext('book', 'TIMEOUT_AFTER_BOOK')
    expect((await bookOk(world, s, [{ buyer: 'UC_Y' }]))[0]).toMatchObject({ ok: false, reason: 'UNAVAILABLE' })
    const merged = await writeEvent(world, s, { type: 'buyer.merge', from: 'UC_X', into: 'UC_Y', reason: '같은 사람' }, D)
    expect(merged.status, merged.text).toBe(200)
    const again = await bookOk(world, s, [{ buyer: 'UC_Y' }])
    expect(again[0]).toMatchObject({ ok: true })
    const keys = bookRequests(world).map((item) => item.requestKey)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(1)
    const row = await rowOf(world, s, 'UC_Y')
    expect(row.parcel).toMatchObject({ state: 'BOOKED', qty: 1 })
    expect(row.qty).toBe(3)
    const packing = await client(world, s.cookie).get(`/api/days/${D}/packing`)
    const entry = (packing.body.entries as { buyer: string; status: string }[]).find((item) => item.buyer === 'UC_Y')
    expect(entry?.status).toBe('배송 뒤 바뀜')
  })
})
