// T1 권한·판매자 나눔·로그: AC-T1-07(보조자 403·다른 판매자 404·리허설·봉인), AC-T1-08(로그·감사 메시지·발송함에 배송지 없음).
import { describe, expect, it } from 'vitest'
import { linkApi, openLink, tokenOf } from './n4b-support.ts'
import { ORIGIN, client, dumpAllTables, login, rid, type Seller, type TestServer } from './support.ts'
import { ADDRESS, D, SENDER, bookOk, expect200, expectNoSecret, makeReady, parcelApi, parcelSeller, parcelWorld, sell } from './t1-support.ts'

async function assistantOf(world: TestServer, seller: Seller): Promise<string> {
  const created = await client(world, seller.cookie).post('/api/assistants', { name: '엄마' })
  expect(created.status, created.text).toBe(200)
  return login(world, (created.body.assistant as { loginId: string }).loginId, created.body.password as string)
}

/** 택배 API 전부 (읽기·쓰기) — 상태 코드 목록 */
async function everyCall(world: TestServer, cookie: string, buyer: string, updatedAt: string): Promise<{ name: string; status: number }[]> {
  const api = parcelApi(world, cookie)
  const raw = client(world, cookie)
  const calls: [string, () => Promise<{ status: number }>][] = [
    ['설정 읽기', () => api.settings()],
    ['설정 쓰기', () => api.putSettings({ box: '대' })],
    ['날짜 목록', () => api.days()],
    ['접수 목록', () => api.day()],
    ['묶음 자세히', () => api.bundle(buyer)],
    ['배송지 쓰기', () => api.putAddress(buyer, { ...ADDRESS, name: '침입' })],
    ['배송지 확인', () => api.confirm(buyer, updatedAt)],
    ['배송지 지우기', () => api.remove(buyer)],
    ['접수', () => api.book([{ buyer }])],
    ['다시 확인', () => api.book([{ buyer }], D, rid('again'))],
    ['취소', () => api.cancel(buyer)],
    ['운송장', async () => api.waybill(buyer)],
    ['운송장 전부', async () => api.waybills()],
    ['없는 경로', () => raw.get('/api/parcels/nothing')],
  ]
  const out: { name: string; status: number }[] = []
  for (const [name, call] of calls) out.push({ name, status: (await call()).status })
  return out
}

describe('AC-T1-07 권한과 판매자 나눔', () => {
  it('보조자는 배송지·접수 목록·접수·다시 확인·취소·운송장·설정 모두 403, 다른 판매자는 S의 날짜·구매자로 모두 404 — 아무것도 바뀌지 않는다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    await bookOk(world, seller, [{ buyer: 'UC_B' }])
    const updatedAt = ((await expect200(parcelApi(world, seller.cookie).bundle('UC_A'))).body.bundle as { address: { updatedAt: string } }).address.updatedAt
    const before = await dumpAllTables(world.database)
    const sentBefore = world.carrier.requests.length

    const helper = await assistantOf(world, seller)
    for (const call of await everyCall(world, helper, 'UC_A', updatedAt)) expect(call.status, call.name).toBe(403)
    for (const call of await everyCall(world, helper, 'UC_B', updatedAt)) expect(call.status, call.name).toBe(403)

    const other = await parcelSeller(world)
    const results = await everyCall(world, other.cookie, 'UC_A', updatedAt)
    for (const call of results) {
      if (['설정 읽기', '설정 쓰기', '날짜 목록'].includes(call.name)) expect(call.status, call.name).toBe(200)
      else expect(call.status, call.name).toBe(404)
    }
    for (const call of await everyCall(world, other.cookie, 'UC_B', updatedAt)) if (!['설정 읽기', '설정 쓰기', '날짜 목록'].includes(call.name)) expect(call.status, call.name).toBe(404)
    // 다른 판매자가 같은 날짜에 자기 방송이 있어도 S의 구매자는 404
    await sell(world, other, [['UC_Z', '제트', 1]])
    for (const call of await everyCall(world, other.cookie, 'UC_A', updatedAt)) if (!['설정 읽기', '설정 쓰기', '날짜 목록', '접수 목록', '운송장 전부'].includes(call.name)) expect(call.status, call.name).toBe(404)
    expect(world.carrier.requests).toHaveLength(sentBefore)
    // 바뀐 것: 다른 판매자 자기 설정·자기 판매만 (S의 행은 그대로)
    const after = await dumpAllTables(world.database)
    const sRows = (dump: string) => dump.split('\n').filter((line) => /^(parcel_addresses|parcels|parcel_requests|packing_records):/.test(line))
    expect(sRows(after).map((line) => line.replaceAll(other.sellerId, ''))).toEqual(sRows(before))
  })

  it('봉인한 날짜는 배송지 쓰기·접수·취소를 409로 거절한다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    await bookOk(world, seller, [{ buyer: 'UC_A' }])
    const scopeId = await world.server.service.scopeId(seller.sellerId, D)
    expect(await world.server.sealer.seal(seller.sellerId, scopeId as string, D)).toBe(true)
    const api = parcelApi(world, seller.cookie)
    for (const response of [await api.putAddress('UC_A', ADDRESS), await api.book([{ buyer: 'UC_A' }]), await api.cancel('UC_A')]) {
      expect(response.status, response.text).toBe(409)
      expect(response.text).toContain('30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.')
    }
    expect((await api.day()).status).toBe(404)
  })
})

describe('AC-T1-08 로그·감사 메시지·발송함에 배송지 없음', () => {
  it('구매자 링크 저장·고치기(틀린 입력 포함)·판매자 고치기·확인·접수(성공·주소 거절·응답 없음)·취소·조회·운송장 뒤 로그·이벤트·발송함·요청 기록 어디에도 배송지·택배사 원래 글·토큰이 없다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    const created = await linkApi(world, seller.cookie).create(D, 'UC_A')
    const token = tokenOf((created.body.link as { url: string }).url)
    const post = (values: Record<string, string>) =>
      world.server.app.request(`/r/${token}/address`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: new URLSearchParams(values).toString() })
    expect((await post({ ...ADDRESS, phone: '010-9876-5432x' })).status).toBe(400)
    expect((await post(ADDRESS)).status).toBe(303)
    expect((await post({ ...ADDRESS, detail: '202동 303호' })).status).toBe(303)
    await openLink(world, `/r/${token}`)
    const api = parcelApi(world, seller.cookie)
    const updatedAt = ((await expect200(api.bundle('UC_A'))).body.bundle as { address: { updatedAt: string } }).address.updatedAt
    await expect200(api.confirm('UC_A', updatedAt))
    await makeReady(world, seller, 'UC_A', { ...ADDRESS, detail: '202동 303호' })
    await makeReady(world, seller, 'UC_B', { ...ADDRESS, name: '김주소', address: '부산 해운대구 [주소거절]' })
    await makeReady(world, seller, 'UC_C', { ...ADDRESS, name: '박응답', address: '대구 [응답없음]' })
    const results = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }, { buyer: 'UC_C' }])
    expect(results.map((item) => item.ok)).toEqual([true, false, false])
    world.carrier.setStatus(results[0]?.invoice as string, 'PICKED_UP')
    await world.server.parcels.trackOnce()
    world.carrier.setStatus(results[0]?.invoice as string, 'ACCEPTED')
    await world.server.parcels.trackOnce()
    expect((await api.waybill('UC_A')).status).toBe(200)
    await expect200(api.cancel('UC_A'))
    await expect200(api.putSettings({ sender: SENDER, customerNo: 'CUST-12345' }))

    const logs = JSON.stringify(world.logs)
    const tables = (await dumpAllTables(world.database))
      .split('\n')
      .filter((line) => /^(events|outbox|parcel_requests|packing_records|parcels|chat_raw|receipt_link_requests):/.test(line))
      .join('\n')
    // 거절된 연락처(010-9876-5432x)는 모든 꼴로 본다 — 네 자리 '9876'만 보면 무작위 UUID(예: '…-272aac987677')와 우연히 겹친다
    const rejectedPhone = ['010-9876-5432', '01098765432', '9876-5432', '98765432']
    const secrets = ['홍길동', '김주소', '박응답', '01012345678', '010-1234-5678', ...rejectedPhone, '세종대로', '해운대구', '202동', '303호', '문 앞에', '04524', '받은 주소', '[주소거절]', '[응답없음]', token, 'CUST-12345', '12345', SENDER.address]
    for (const secret of secrets) {
      expectNoSecret(logs, secret, `로그: ${secret}`)
      expectNoSecret(tables, secret, `표: ${secret}`)
    }
    // 로그에 송장번호도 남기지 않는다
    expect(logs).not.toContain(results[0]?.invoice as string)
  })
})
