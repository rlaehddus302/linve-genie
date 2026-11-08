// AC-CRM1-21~23·25·27 손님 메모(표지마다·덧붙이기·검사)와 권한(판매자만·다른 판매자 404·로그인 401·no-store)·로그에 메모·표지 없음.
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { MEMO_MAX } from '../src/customers/rules.ts'
import { at, buy, chat, countOf, crm, crmWorld, ok, payAll } from './crm1-support.ts'
import { getFile } from './i2-support.ts'
import { addSeller, client, createBroadcast, expectOk, type Seller, type TestServer } from './support.ts'

async function twoDays(world: TestServer, seller: Seller): Promise<void> {
  await buy(world, seller, '2026-10-08', 'UC_A', '다육이맘', 10_000)
  await payAll(world, seller, '2026-10-08', 'UC_A')
  await buy(world, seller, '2026-10-22', 'UC_A', '다육이맘2', 20_000)
  at(world, '2026-10-26', '12:00:00')
}

describe('AC-CRM1-21 저장·지우기·다른 날짜에서 보임', () => {
  it('10-08 자세히에서 저장한 두 줄 메모가 10-22 자세히·"모든 손님" 자세히에 같고, 빈 글 저장 뒤엔 없다. 메모 표엔 두 줄, 이벤트는 그대로', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await twoDays(world, seller)
    const [member] = await c.members('2026-10-08', 'UC_A')
    expect(member).toMatchObject({ buyer: 'UC_A', kindLabel: '유튜브', platform: 'YOUTUBE', memo: null })
    const id = member?.customer as string
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    const events = await countOf(world, 'events')
    const outbox = await countOf(world, 'outbox')
    const text = '10/8 늦게 입금,\n다음엔 선입금 부탁'
    const saved = await expectOk(c.memo(id, text))
    expect(saved.body).toEqual({ memo: { text, savedAt: new Date(world.clock.now()).toISOString() } })
    expect((await c.members('2026-10-22', 'UC_A'))[0]?.memo?.text).toBe(text)
    expect((await expectOk(c.customer(id))).body.memo).toEqual({ text, savedAt: new Date(world.clock.now()).toISOString() })
    // 손님 자세히에도 서버 오늘(KST) — 화면의 올해 기준 (TE-CRM1-003)
    expect((await expectOk(c.customer(id))).body.today).toBe('2026-10-26')
    world.clock.advance(60_000)
    expect((await expectOk(c.memo(id, '  '))).body).toEqual({ memo: null })
    expect((await c.members('2026-10-08', 'UC_A'))[0]?.memo).toBeNull()
    expect((await expectOk(c.customer(id))).body.memo).toBeNull()
    const rows = await world.database.pglite?.query<{ text: string; account_id: string; seller_id: string }>('select text, account_id, seller_id from customer_memos order by id')
    expect(rows?.rows).toEqual([
      { text, account_id: seller.accountId, seller_id: seller.sellerId },
      { text: '', account_id: seller.accountId, seller_id: seller.sellerId },
    ])
    expect(await countOf(world, 'events')).toBe(events)
    expect(await countOf(world, 'outbox')).toBe(outbox)
  })

  it('두 기기가 잇달아 저장하면 나중 것이 마지막이다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await twoDays(world, seller)
    const id = (await c.members('2026-10-08', 'UC_A'))[0]?.customer as string
    await Promise.all([c.memo(id, '첫 기기'), c.memo(id, '둘째 기기')])
    const last = await world.database.pglite?.query<{ text: string }>('select text from customer_memos order by id desc limit 1')
    expect((await expectOk(c.customer(id))).body.memo).toMatchObject({ text: last?.rows[0]?.text })
  })
})

describe('AC-CRM1-22 메모 검사', () => {
  it('번호 거절(D-079 ⑥ 문장)·201글자 거절·200글자(이모지 섞음) 저장·앞뒤 공백 다듬기·제어 글자 거절 — 거절한 글은 저장·로그 없음', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await twoDays(world, seller)
    const id = (await c.members('2026-10-08', 'UC_A'))[0]?.customer as string
    const reject = async (text: unknown, message: string) => {
      const response = await c.memo(id, text)
      expect(response.status, String(text).slice(0, 20)).toBe(400)
      expect(response.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'text', message }] } })
      if (typeof text === 'string' && text.length > 3) expect(response.text).not.toContain(text)
    }
    await reject('010-1234-5678 연락', '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.')
    await reject('공일공 01012345678', '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.')
    await reject('가'.repeat(201), '메모는 200자까지 적을 수 있어요.')
    await reject('삑\u0007소리', '메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요.')
    await reject('탭\t글', '메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요.')
    await reject('\ud800짝없음', '메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요.')
    await reject(5, '메모는 글자로 보내 주세요.')
    expect(await countOf(world, 'customer_memos')).toBe(0)
    const two = `${'🌵'.repeat(100)}${'다'.repeat(100)}`
    expect([...two].length).toBe(MEMO_MAX)
    expect(two.length).toBeGreaterThan(MEMO_MAX)
    expect((await expectOk(c.memo(id, two))).body.memo).toMatchObject({ text: two })
    expect((await expectOk(c.memo(id, '  가  '))).body.memo).toMatchObject({ text: '가' })
    expect((await expectOk(c.memo(id, '줄\r\n나눔'))).body.memo).toMatchObject({ text: '줄\n나눔' })
    expect((await c.api.put(`/api/customers/${id}/memo`, { text: '가', extra: 1 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    const logs = JSON.stringify(world.logs)
    for (const secret of ['010-1234-5678', '01012345678', '🌵', '삑', '짝없음']) expect(logs).not.toContain(secret)
  })
})

describe('AC-CRM1-23 합친 묶음 — 구성원마다 메모 칸, 글자 그대로', () => {
  it('10-15 UC_A 아래 문자 구매자(끝자리 1234): 칸 둘(유튜브·문자 · 끝자리 1234)·손님 ID 둘, 태그 모양 메모도 글자 그대로 돌려준다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const d15 = await buy(world, seller, '2026-10-15', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'product.register', b: d15.b, no: 600, name: '문자 품종', price: 8000 })
    const r1 = (await ok(world, seller, { type: 'sms', b: d15.b, no: 600, received: '20:00', phone: '010-2222-1234' })).body.buyer as string
    await ok(world, seller, { type: 'buyer.merge', from: r1, into: 'UC_A', reason: '같은 사람' }, '2026-10-15')
    const members = await c.members('2026-10-15', 'UC_A')
    expect(members.map((member) => [member.buyer, member.kindLabel, member.name])).toEqual([
      ['UC_A', '유튜브', '다육이맘'],
      [r1, '문자 · 끝자리 1234', expect.any(String)],
    ])
    expect(members[0]?.customer).not.toBe(members[1]?.customer)
    const evil = '<img src=x onerror=alert(1)>'
    await expectOk(c.memo(members[0]?.customer as string, evil))
    const again = await c.members('2026-10-15', r1)
    expect(again[0]?.memo?.text).toBe(evil)
    expect(again[1]?.memo).toBeNull()
  })
})

describe('AC-CRM1-25 판매자 계정만', () => {
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403·보조자의 날짜 조회에 손님 기록 칸 없음"을 뺐다
  it('S1 200 + no-store, S2는 S1의 날짜·손님·메모 404, 로그인 없으면 401', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await twoDays(world, seller)
    // 리허설·실제 둘 다 있는 S2 (다른 날짜)
    const other = await addSeller(world)
    at(world, '2026-10-26', '13:00:00')
    await createBroadcast(world, other, { date: '2026-10-26' })
    const id = (await c.members('2026-10-08', 'UC_A'))[0]?.customer as string
    const gets = ['/api/customer-settings', '/api/days/2026-10-08/customers', '/api/days/2026-10-08/customer?buyer=UC_A', '/api/customers', `/api/customers/${id}`]
    const puts: [string, unknown][] = [
      ['/api/customer-settings', { regularCount: 3, regularAmount: null, waitDays: 3 }],
      [`/api/customers/${id}/memo`, { text: '남이 쓴 메모' }],
    ]
    for (const path of gets) {
      const mine = await client(world, seller.cookie).get(path)
      expect(mine.status, path).toBe(200)
      expect(mine.headers.get('cache-control'), path).toBe('no-store')
      expect((await client(world, null).get(path)).status, path).toBe(401)
    }
    for (const [path, body] of puts) {
      expect((await client(world, null).put(path, body)).status, path).toBe(401)
    }
    expect(await countOf(world, 'customer_memos')).toBe(0)
    expect(await countOf(world, 'customer_settings')).toBe(0)
    const s2 = crm(world, other)
    expect((await s2.dayList('2026-10-08')).status).toBe(404)
    expect((await s2.day('2026-10-08', 'UC_A')).status).toBe(404)
    expect((await s2.customer(id)).status).toBe(404)
    expect((await s2.memo(id, '남의 메모')).status).toBe(404)
    expect(await countOf(world, 'customer_memos')).toBe(0)
  })
})

describe('AC-CRM1-27 로그에 메모·표지가 없다', () => {
  it('메모 저장·거절, 손님 기록 조회(전화번호 키 표지 포함) 뒤 서버 로그에 메모 글·채널 ID·전화번호 키·번호가 없다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const d = await buy(world, seller, '2026-10-10', 'UC_SECRETCHANNEL', '비밀', 10_000)
    await ok(world, seller, { type: 'product.register', b: d.b, no: 700, name: '문자 품종', price: 8000 })
    const sms = (await ok(world, seller, { type: 'sms', b: d.b, no: 700, received: '20:00', phone: '010-3333-9876' })).body.buyer as string
    await chat(world, seller, d.b, 'x1', 'UC_SECRETCHANNEL', '비밀', '안녕')
    at(world, '2026-10-26', '12:00:00')
    const members = [...(await c.members('2026-10-10', 'UC_SECRETCHANNEL')), ...(await c.members('2026-10-10', sms))]
    for (const member of members) {
      await expectOk(c.memo(member.customer as string, '아주 비밀스러운 메모 글'))
      expect((await c.memo(member.customer as string, '010-3333-9876')).status).toBe(400)
    }
    await expectOk(c.list())
    await expectOk(c.list('q=9876'))
    for (const row of await c.rows()) await expectOk(c.customer(row.id))
    const keys = await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms'`)
    const phoneKey = (JSON.parse(keys?.rows[0]?.body ?? '{}') as { phoneKey?: string }).phoneKey as string
    const logs = JSON.stringify(world.logs)
    for (const secret of ['아주 비밀스러운', 'UC_SECRETCHANNEL', phoneKey, '010-3333-9876', '01033339876']) expect(logs).not.toContain(secret)
  })
})

describe('AC-CRM1-26 구매자에게 가는 것·내보내기에 없다 (서버 쪽 확인)', () => {
  it('입금 늦음 주의·메모 "노쇼 2번"인 손님 — 확인서 데이터·전체 기록 내보내기에 메모·꼬리표 낱말이 없다 (나머지 산출물은 적대 시험)', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-08', 'UC_B', '비', 10_000)
    await buy(world, seller, '2026-10-22', 'UC_B', '비', 20_000)
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-22', 'UC_B')).toMatchObject({ caution: true })
    const id = (await c.members('2026-10-22', 'UC_B'))[0]?.customer as string
    await expectOk(c.memo(id, '노쇼 2번'))
    const receipt = await expectOk(client(world, seller.cookie).get('/api/days/2026-10-22/receipt?buyer=UC_B'))
    const records = await getFile(world, seller.cookie, '/api/export/records.json.gz')
    expect(records.status).toBe(200)
    const exported = gunzipSync(records.bytes).toString('utf8')
    for (const text of [receipt.text, exported]) {
      for (const word of ['노쇼 2번', '입금 늦음 주의', '단골', 'customer_memos', 'caution']) expect(text, word).not.toContain(word)
    }
  })
})
