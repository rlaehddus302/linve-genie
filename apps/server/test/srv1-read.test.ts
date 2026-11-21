// SRV1 읽기는 서버 — 서버 몫 (AC-SRV1-01·02·03·07·08·09·14, D-APP-22~25, APP-05 AC10·AC12·AC13·AC14).
// 서버 읽기 입구(POST /api/broadcasts/:id/read · /api/read)와 원문 쓰기(/api/events의 text·noText·priceText·receivedText·amountText),
// 문자찜 번호 한도(claim.maxNumber), 채팅 이름 언급, 확장 수집의 읽은 필드 거절.
import { readFileSync } from 'node:fs'
import { compareParserOutput, parseGoldenYaml } from '@livejjim/core/golden'
import { listClaims, listProducts } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { PHONE_NUMBER_MESSAGE } from '../src/messages.ts'
import { optionBroadcast } from './a1-support.ts'
import { ORIGIN, addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'
import { chats, msgId, tiktokSeller, ttWorld } from './tiktok-live-support.ts'

const GOLDEN = new URL('../../../tests/golden/parser/', import.meta.url)
type Unit = 'WON' | 'THOUSAND' | 'TEN_THOUSAND' | 'AUTO'

interface GoldenCase {
  readonly in: string
  readonly out: unknown
}
interface GoldenDoc {
  readonly suite: string
  readonly settings?: { readonly unit?: Unit }
  readonly cases: readonly GoldenCase[]
}

function goldenDocs(file: string): GoldenDoc[] {
  const parsed = parseGoldenYaml(readFileSync(new URL(file, GOLDEN), 'utf8'))
  if (!parsed.ok) throw new Error(`골든을 읽지 못했다: ${file}`)
  return parsed.documents.map((doc) => doc.value as GoldenDoc)
}

/** 판매자 + 가격 단위별 방송 (설정을 바꾼 뒤 만든 방송이 그 단위의 스냅샷을 가진다) */
async function unitBroadcasts(world: TestServer, seller: Seller): Promise<Record<Unit, string>> {
  const out: Partial<Record<Unit, string>> = {}
  for (const unit of ['WON', 'THOUSAND', 'TEN_THOUSAND', 'AUTO'] as const) {
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'price.unit': unit } }))
    out[unit] = (await createBroadcast(world, seller, { title: unit })).id
  }
  return out as Record<Unit, string>
}

const read = (world: TestServer, seller: Seller, b: string, kind: string, text: unknown) => client(world, seller.cookie).post(`/api/broadcasts/${b}/read`, { kind, text })

/** 읽기 입구 답 → 코어 parseQuickInput 결과 모양 (골든 비교) */
function quickOut(answer: Record<string, unknown>): Record<string, unknown> {
  if (answer.decision === 'none') return { error: 'EMPTY' }
  if (answer.decision === 'register' || answer.decision === 'edit') return { no: answer.no, name: answer.name, price: answer.price }
  if (answer.decision === 'fix') {
    // 번호 오류는 코어처럼 error만 (칸 채우기 noText·priceText·name은 화면용)
    if (answer.error === 'NUMBER_MISSING' || answer.error === 'NUMBER_INVALID') return { error: answer.error }
    return { error: answer.error, no: answer.no, name: answer.name }
  }
  return { decision: answer.decision }
}

describe('AC-SRV1-01 골든(빠른 입력·금액)을 서버 읽기 입구로 통과 (APP-05 AC10)', () => {
  it('parser/quick-input.yaml — 모든 사례가 기대값과 같다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const broadcasts = await unitBroadcasts(world, seller)
    let count = 0
    for (const doc of goldenDocs('quick-input.yaml')) {
      expect(doc.suite).toBe('quick-input')
      const b = broadcasts[doc.settings?.unit ?? 'THOUSAND']
      for (const item of doc.cases) {
        const response = await read(world, seller, b, 'quick', item.in)
        expect(response.status, response.text).toBe(200)
        const answer = response.body.read as Record<string, unknown>
        expect(compareParserOutput('quick-input', item.out, quickOut(answer)), `${doc.settings?.unit ?? ''} ${JSON.stringify(item.in)}`).toEqual([])
        count++
      }
    }
    expect(count).toBeGreaterThan(70)
  })

  it('parser/amount.yaml — 그 방송 단위의 가격 칸으로 읽은 값이 기대값과 같다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const broadcasts = await unitBroadcasts(world, seller)
    let count = 0
    // 같은 파일의 한글 수 사례(korean-number)는 금액 칸이 아니라 코어 내부 함수라 뺀다
    for (const doc of goldenDocs('amount.yaml').filter((item) => item.suite === 'amount')) {
      const unit = doc.settings?.unit ?? 'THOUSAND'
      for (const item of doc.cases) {
        const response = await read(world, seller, broadcasts[unit], 'price', item.in)
        expect(response.status, response.text).toBe(200)
        expect(compareParserOutput('amount', item.out, (response.body.read as { amount: unknown }).amount), `${unit} ${JSON.stringify(item.in)}`).toEqual([])
        // 원 단위 금액 칸(정산)은 WON 사례와 같다
        if (unit === 'WON') expect((await client(world, seller.cookie).post('/api/read', { kind: 'money', text: item.in })).body.read).toMatchObject({ amount: item.out })
        count++
      }
    }
    expect(count).toBeGreaterThan(150)
  })
})

describe('AC-SRV1-02 빠른 입력 원문 등록 (약속 1·2)', () => {
  it('천원 방송에 원문 `15 핑크프릴 20` → 15번 핑크프릴 20,000원 하나, 같은 요청 번호로 다시 보내도 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    const preview = await read(world, seller, b.id, 'quick', '15 핑크프릴 20')
    expect(preview.body.read).toMatchObject({ kind: 'quick', decision: 'register', no: 15, name: '핑크프릴', price: 20_000, priceWords: '20,000원', preview: '등록하면: 15번 핑크프릴 20,000원', previewNo: 15 })
    const requestId = rid('quick')
    const first = await api.post('/api/events', { requestId, type: 'product.register', b: b.id, text: '15 핑크프릴 20' })
    expect(first.status, first.text).toBe(200)
    const again = await api.post('/api/events', { requestId, type: 'product.register', b: b.id, text: '15 핑크프릴 20' })
    expect(again.status, again.text).toBe(200)
    expect(again.body.seq).toBe(first.body.seq)
    const products = listProducts((await world.server.writer.read(seller.sellerId, b.date)).state)
    expect(products.map(({ no, name, price }) => ({ no, name, price }))).toEqual([{ no: 15, name: '핑크프릴', price: 20_000 }])
    // 원문은 이벤트에 남지 않는다 — 읽은 값만
    expect(await dumpAllTables(world.database)).not.toContain('15 핑크프릴 20"')
  })

  it('같은 번호를 다시 치면 기록하되 바꾸지 않는다(changed:false — D-MOB2-14 (2), 입력 우선 기록), 15번은 그대로 — 물은 뒤 product.update로 같은 원문을 보내면 고친다. 품종 없는 줄은 품종을 두고 가격만', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 20' }))
    const exists = await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 25' })
    expect(exists.status).toBeLessThan(300)
    expect(exists.body).toMatchObject({ changed: false })
    expect(listProducts((await world.server.writer.read(seller.sellerId, b.date)).state)[0]).toMatchObject({ no: 15, price: 20_000 })
    const before = await countRows(world.database, 'events')
    const opened = await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15' })
    expect(opened.status).toBe(409)
    expect(opened.body.error).toMatchObject({ code: 'QUICK_OPEN' })
    expect(await countRows(world.database, 'events')).toBe(before)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.update', b: b.id, text: '15 12' }))
    const [product] = listProducts((await world.server.writer.read(seller.sellerId, b.date)).state)
    expect(product).toMatchObject({ no: 15, name: '핑크프릴', price: 12_000 })
    // 읽기 입구도 같은 판단 (그 번호의 상품이 있다)
    expect((await read(world, seller, b.id, 'quick', '15 엘레강스 9')).body.read).toMatchObject({ decision: 'edit', question: '15번이 이미 있어요. 고칠까요?', preview: null })
  })

  it('읽지 못한 줄은 지금 문장으로 400 QUICK_FIX(고치기 칸 채우기 포함), 기록 없음. 고치기 칸 원문(noText·priceText)도 같은 함수', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    const before = await countRows(world.database, 'events')
    const missing = await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 공짜' })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toMatchObject({ code: 'QUICK_FIX', message: '가격을 알아보지 못했어요. 가격 칸에 적어 주세요.' })
    expect(missing.body.read).toMatchObject({ decision: 'fix', error: 'PRICE_MISSING', focus: 'price', no: 15, name: '핑크프릴 공짜' })
    const range = await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '1000 핑크프릴 10' })
    expect(range.body.error).toMatchObject({ code: 'QUICK_FIX', message: '번호는 1부터 999까지예요. 번호를 확인해 주세요.' })
    expect(range.body.read).toMatchObject({ error: 'NUMBER_INVALID', noText: '1000', name: '핑크프릴', priceText: '10,000원', focus: 'no' })
    expect(await countRows(world.database, 'events')).toBe(before)
    // 고치기 칸: 번호·품종·가격 칸 원문
    const fixPreview = await read(world, seller, b.id, 'fix', { no: '16번', name: '라울', price: '5천' })
    expect(fixPreview.body.read).toMatchObject({ kind: 'fix', decision: 'register', no: 16, name: '라울', price: 5000, pricePreview: '= 5,000원' })
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, noText: '16번', name: '라울', priceText: '5천' }))
    const tooLow = await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, noText: '17', name: '라울', priceText: '10원' })
    expect(tooLow.body.error).toMatchObject({ code: 'QUICK_FIX', message: '가격이 100원보다 적어요. 가격을 확인해 주세요.', problems: [{ field: 'priceText' }] })
    // 같은 칸을 글과 숫자로 함께 보내면 400
    expect((await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '18 a 10', no: 18 })).status).toBe(400)
    expect(listProducts((await world.server.writer.read(seller.sellerId, b.date)).state).map((p) => [p.no, p.price])).toEqual([[16, 5000]])
  })

  it('D-FREEITEM-01 고치기 칸 가격 0원은 이벤트 상품으로 등록한다 — 빠른 입력 한 줄의 0원은 그대로 막는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, noText: '999', name: '이벤트', priceText: '0원' }))
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, noText: '20', name: '라울', priceText: '5천' }))
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.update', b: b.id, noText: '20', priceText: '0원' }))
    const line = await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '21 라울 0원' })
    expect(line.body.error).toMatchObject({ code: 'QUICK_FIX' })
    expect(listProducts((await world.server.writer.read(seller.sellerId, b.date)).state).map((p) => [p.no, p.price]).sort((x, y) => x[0]! - y[0]!)).toEqual([[20, 0], [999, 0]])
  })

  it('다른 판매자의 방송은 읽기·쓰기 모두 404, Origin이 다르면 403, 로그인 없으면 401, 2,000자 넘는 글은 400', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, seller)
    expect((await read(world, other, b.id, 'quick', '15 핑크프릴 20')).status).toBe(404)
    expect((await client(world, other.cookie).post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 20' })).status).toBe(404)
    const foreign = await client(world, seller.cookie).raw(`/api/broadcasts/${b.id}/read`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'quick', text: '15' }) })
    expect(foreign.status).toBe(403)
    expect((await client(world, null).post(`/api/broadcasts/${b.id}/read`, { kind: 'quick', text: '15' })).status).toBe(401)
    expect((await read(world, seller, b.id, 'quick', 'x'.repeat(2001))).status).toBe(400)
    expect((await read(world, seller, b.id, 'quick', 'x'.repeat(2000))).status).toBe(200)
    expect((await read(world, seller, b.id, 'nope', '15')).status).toBe(400)
    expect((await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/read`, { kind: 'quick', text: '15', extra: 1 })).body.error).toMatchObject({ code: 'UNKNOWN_FIELD' })
    // 방송 칸은 방송 없는 입구에서 읽지 않는다
    expect((await client(world, seller.cookie).post('/api/read', { kind: 'quick', text: '15' })).status).toBe(400)
    expect(listProducts((await world.server.writer.read(seller.sellerId, b.date)).state)).toEqual([])
  })
})

describe('AC-SRV1-03 읽기 입구는 저장·로그·이벤트를 남기지 않는다', () => {
  it('표지 글 `15 표지핑크 20`을 모든 칸으로 읽어도 DB·로그·이벤트·백업에 그 글이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const events = await countRows(world.database, 'events')
    const before = (await world.server.writer.read(seller.sellerId, b.date)).seq
    for (const kind of ['quick', 'price', 'received', 'phone']) expect((await read(world, seller, b.id, kind, '15 표지핑크 20')).status).toBe(200)
    expect((await read(world, seller, b.id, 'fix', { no: '15', name: '표지핑크', price: '20' })).status).toBe(200)
    expect((await client(world, seller.cookie).post('/api/read', { kind: 'money', text: '15 표지핑크 20' })).status).toBe(200)
    expect(await countRows(world.database, 'events')).toBe(events)
    expect((await world.server.writer.read(seller.sellerId, b.date)).seq).toBe(before)
    expect(await dumpAllTables(world.database)).not.toContain('표지핑크')
    expect(JSON.stringify(world.logs)).not.toContain('표지핑크')
    const backup = await client(world, seller.cookie).raw('/api/export/records.json.gz', {})
    expect(backup.status).toBe(200)
    const { gunzipSync } = await import('node:zlib')
    expect(gunzipSync(Buffer.from(await backup.arrayBuffer())).toString('utf8')).not.toContain('표지핑크')
  })
})

describe('AC-SRV1-07 문자찜 칸 원문 (APP-05 AC12, ORD-08)', () => {
  it('받은 시각 `3:10`·전화번호 `010-1234-5678` — 미리 보기와 저장값이 같은 서버 답(지금 12:00이면 오늘 15:10), 끝 4자리 5678', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 20' }))
    const received = (await read(world, seller, b.id, 'received', '3:10')).body.read
    expect(received).toMatchObject({ kind: 'received', state: 'ok', value: '15:10', day: '오늘', words: '오늘 15:10', late: true, minute: true })
    expect((await api.post('/api/read', { kind: 'received', text: '3:10' })).body.read).toEqual(received)
    const phone = (await api.post('/api/read', { kind: 'phone', text: '010-1234-5678' })).body.read
    expect(phone).toEqual({ kind: 'phone', empty: false, valid: true, last4: '5678', hasPhone: true, message: null })
    // 정리한 번호는 답에 없다
    expect(JSON.stringify(phone)).not.toContain('01012345678')
    // 지금(12:00)보다 늦은 15:10은 확인 없이 넣지 않는다 (REL1) — 화면은 "이대로 넣을까요?"에 답한 뒤 receivedLateOk: true로 보낸다
    const unconfirmed = await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '15번', receivedText: '3:10', phone: '010-1234-5678' })
    expect(unconfirmed.status).toBe(409)
    expect(unconfirmed.body.received).toEqual({ value: '15:10', day: '오늘' })
    const written = await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '15번', receivedText: '3:10', phone: '010-1234-5678', receivedLateOk: true })
    expect(written.status, written.text).toBe(200)
    expect(written.body.phoneLast4).toBe('5678')
    const claims = listClaims((await world.server.writer.read(seller.sellerId, b.date)).state)
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ no: 15 })
    const rows = await world.database.pglite!.query<{ body: string }>(`select body from events where type = 'sms'`)
    expect(JSON.parse(rows.rows[0]!.body)).toMatchObject({ no: 15, received: '15:10' })
    expect(JSON.parse(rows.rows[0]!.body)).not.toHaveProperty('receivedText')
  })

  it('받은 시각을 읽지 못하면·메모에 전화번호가 있으면 지금 문장으로 400, 기록 없음. 읽지 못한 전화번호는 읽기 입구가 알린다(쓰기는 AC-S04-31 그대로 번호 없이)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 20' }))
    const before = await countRows(world.database, 'events')
    const badTime = await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 15, receivedText: '25:00' })
    expect(badTime.body.error).toMatchObject({ code: 'INVALID_INPUT', problems: [{ field: 'receivedText', message: '받은 시각을 20:01처럼 적어 주세요.' }] })
    expect((await read(world, seller, b.id, 'received', '25:00')).body.read).toMatchObject({ state: 'invalid', message: '받은 시각을 20:01처럼 적어 주세요.' })
    expect((await api.post('/api/read', { kind: 'phone', text: '12345' })).body.read).toMatchObject({ valid: false, last4: null, message: '휴대폰 번호로 읽지 못했어요. 고치거나 지워 주세요.' })
    const memo = await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 15, memo: '연락 010-9999-8888' })
    expect(memo.status).toBe(400)
    expect(memo.body.error).toMatchObject({ problems: [{ field: 'memo', message: PHONE_NUMBER_MESSAGE }] })
    expect((await api.post('/api/read', { kind: 'phone', text: '연락 010-9999-8888' })).body.read).toMatchObject({ hasPhone: true })
    expect(await countRows(world.database, 'events')).toBe(before)
  })

  it('받은 시각 원문이 서버 시계보다 늦으면 화면이 미리 읽지 못했어도 넣지 않고 확인을 묻는다(409, 기록 없음) — receivedLateOk: true면 넣는다 (REL1)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '15 핑크프릴 20' }))
    // 서버 시계 KST 20:00:00
    world.clock.set(Date.parse('2026-10-19T11:00:00Z'))
    const before = await countRows(world.database, 'events')
    const requestId = rid()
    const late = await api.post('/api/events', { requestId, type: 'sms', b: b.id, noText: '15', receivedText: '20:30' })
    expect(late.status).toBe(409)
    expect(late.body.error).toMatchObject({ code: 'RECEIVED_LATE', problems: [{ field: 'receivedText' }] })
    expect(await countRows(world.database, 'events')).toBe(before)
    // 거짓·잘못된 값은 확인으로 보지 않는다
    expect((await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '15', receivedText: '20:30', receivedLateOk: false })).status).toBe(409)
    expect((await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '15', receivedText: '20:30', receivedLateOk: 'yes' })).status).toBe(400)
    expect(await countRows(world.database, 'events')).toBe(before)
    // 이른 시각은 그대로 넣는다
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '15', receivedText: '19:59' }))
    // 확인한 뒤 같은 요청 번호로 다시 보내면 넣는다
    await expectOk(api.post('/api/events', { requestId, type: 'sms', b: b.id, noText: '15', receivedText: '20:30', receivedLateOk: true }))
    const rows = await world.database.pglite!.query<{ body: string }>(`select body from events where type = 'sms' order by seq`)
    expect(rows.rows.map((row) => (JSON.parse(row.body) as { received: string }).received)).toEqual(['19:59', '20:30'])
    expect(rows.rows[1]!.body).not.toContain('receivedLateOk')
  })

  it('문자찜 번호는 그 방송의 번호 한도(claim.maxNumber) 안만 — 숫자 필드·번호 칸 원문 모두, 범위 밖이면 보류 찜을 만들지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.maxNumber': 300 } }))
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    const before = await countRows(world.database, 'events')
    // 안드로이드 실행에서 본 모양: 전화번호가 붙은 긴 숫자
    const long = await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 1012345678 })
    expect(long.status).toBe(400)
    expect(long.body.error).toMatchObject({ problems: [{ field: 'no', message: '번호는 1부터 300까지예요. 번호를 확인해 주세요.' }] })
    expect((await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 301 })).status).toBe(400)
    const text = await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '301' })
    expect(text.body.error).toMatchObject({ problems: [{ field: 'noText', message: '번호는 1부터 300까지예요. 번호를 확인해 주세요.' }] })
    expect((await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, noText: '' })).body.error).toMatchObject({ problems: [{ field: 'noText', message: '상품 번호를 적어 주세요.' }] })
    expect(await countRows(world.database, 'events')).toBe(before)
    expect(listClaims((await world.server.writer.read(seller.sellerId, b.date)).state)).toEqual([])
    // 한도 안의 번호는 상품이 없어도 보류 찜 (지금 규칙 그대로)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 300 }))
    expect(listClaims((await world.server.writer.read(seller.sellerId, b.date)).state)).toHaveLength(1)
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다 — 이 자리의 시험(보조자는 문자찜 칸만 읽기)도 함께 뺐다
})

describe('AC-SRV1-08 정산 금액 원문·메모·사유의 전화번호 (조사 13)', () => {
  it('금액 원문은 원 단위로 읽고, 메모·사유에 전화번호가 있으면 화면 문장(PHONE_IN_TEXT)으로 400 — 아무것도 저장하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    await expectOk(api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, text: '1 핑크프릴 20' }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UCbuyer1', nick: '손님', text: '1번' })
    const buyer = listClaims((await world.server.writer.read(seller.sellerId, b.date)).state)[0]!.buyer
    const before = await countRows(world.database, 'events')
    const payMemo = await api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.payment', buyer, date: b.date, amountText: '2만', memo: '010-1234-5678 입금' })
    expect(payMemo.status).toBe(400)
    expect(payMemo.body.error).toMatchObject({ problems: [{ field: 'memo', message: '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.' }] })
    const refundReason = await api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.refund', buyer, date: b.date, amountText: '1000', reason: '01012345678 요청' })
    expect(refundReason.body.error).toMatchObject({ problems: [{ field: 'reason', message: PHONE_NUMBER_MESSAGE }] })
    const unreadable = await api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.payment', buyer, date: b.date, amountText: '공짜' })
    expect(unreadable.body.error).toMatchObject({ problems: [{ field: 'amountText', message: '금액을 14000처럼 적어 주세요.' }] })
    expect(await countRows(world.database, 'events')).toBe(before)
    await expectOk(api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.payment', buyer, date: b.date, amountText: '1만 4천' }))
    await expectOk(api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.adjust', buyer, date: b.date, amountText: '2,000', amountSign: 'MINUS', reason: '단골 할인' }))
    const rows = await world.database.pglite!.query<{ body: string }>(`select body from events where type like 'settlement.%' order by seq`)
    expect(rows.rows.map((row) => (JSON.parse(row.body) as { amount: number }).amount)).toEqual([14_000, -2_000])
    // 설정 금액 칸도 원문을 원 단위로 (웹 settings-fields와 같다)
    expect((await api.patch('/api/settings', { settings: { 'shipping.baseFee': '4천', 'shipping.freeThreshold': '5만' } })).body.settings).toMatchObject({ 'shipping.baseFee': 4000, 'shipping.freeThreshold': 50_000 })
  })
})

describe('AC-SRV1-09 채팅 이름 언급은 서버가 준다 (APP-05 AC13, 약속 5)', () => {
  it('옵션 방송 15번 "핑크프릴" — "핑크프릴 이뻐요"는 nameMentions 15, 별칭·띄어 쓴 이름도, 두 글자 미만·없는 이름은 언급 아님', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await optionBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 20_000, aliases: ['핑프'] }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 16, name: '가', price: 10_000 }))
    for (const [id, text] of [['m1', '핑크프릴 이뻐요'], ['m2', '핑 프 예쁘다'], ['m3', '가 좋아요'], ['m4', '안녕하세요']] as const) {
      await world.server.ingestChat(seller.sellerId, { b: b.id, id, ch: `UC${id}`, nick: '손님', text })
    }
    const response = await client(world, seller.cookie).get(`/api/days/${b.date}/messages`)
    const items = response.body.messages as { id: string; mentions: number[]; nameMentions: number[] }[]
    expect(Object.fromEntries(items.map((message) => [message.id, message.nameMentions]))).toEqual({ m1: [15], m2: [15], m3: [], m4: [] })
    // 번호 언급(mentions)은 지금 그대로 — 이름 언급은 따로 (AC-O2-24)
    expect(items.every((message) => message.mentions.length === 0)).toBe(true)
  })
})

describe('AC-SRV1-14 확장 수집은 읽은 필드를 받지 않는다 (APP-05 AC14)', () => {
  it('유튜브 확장 묶음 항목에 claimNo 같은 읽은 필드가 있으면 모르는 항목으로 거절하고 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller)
    const issued = await client(world, seller.cookie).post('/api/extension/code', {})
    const headers = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Content-Type': 'application/json' }
    const connected = await world.server.app.request('/ext/connect', { method: 'POST', headers, body: JSON.stringify({ code: issued.body.code }) })
    const { token } = (await connected.json()) as { token: string }
    const before = await countRows(world.database, 'events')
    for (const message of [
      { id: 'x1', ch: 'UCbuyer', nick: '손님', text: '3번', at: world.clock.now(), claimNo: 3 },
      { id: 'x2', ch: 'UCbuyer', nick: '손님', text: '3번', at: world.clock.now(), claims: [{ no: 3 }] },
    ]) {
      const response = await world.server.app.request('/ext/chats', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 'abcdefghijk', messages: [message] }) })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_FIELD')
    }
    expect(await countRows(world.database, 'events')).toBe(before)
  })

  it('틱톡 확장 묶음 항목에 claimNo·no 같은 읽은 필드가 있으면 모르는 항목으로 거절하고 기록하지 않는다', async () => {
    const w = await ttWorld()
    try {
      const { seller } = await tiktokSeller(w, { tiktokId: 'seller_kim' })
      const issued = await client(w, seller.cookie).post('/api/extension/code', {})
      const headers = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Content-Type': 'application/json' }
      const connected = await w.server.app.request('/ext/connect', { method: 'POST', headers, body: JSON.stringify({ code: issued.body.code }) })
      const { token } = (await connected.json()) as { token: string }
      const before = await countRows(w.database, 'events')
      for (const extra of [{ claimNo: 15 }, { no: 15 }, { claims: [{ no: 15 }] }]) {
        const item = { commentId: msgId(), userId: '7101000000000010001', uniqueId: 'buyer_a', nickname: '시청자', text: '15', ...extra }
        const response = await w.server.app.request('/ext/tiktok/chats', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ pageId: 'seller_kim', items: [item] }) })
        expect(response.status).toBe(400)
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_FIELD')
        await w.tclock.advance(250)
      }
      expect(await countRows(w.database, 'events')).toBe(before)
      expect(await chats(w, seller.sellerId)).toEqual([])
    } finally {
      await w.close()
    }
  })

  it('같은 채팅을 공식 연결과 확장으로 넣으면 같은 판정이다 (찜 번호·상태·순서·가격·구매자, 채팅 항목의 주문·언급)', async () => {
    const CHATS = [
      { id: 'p1', ch: 'UCbuyerA000000000000001', nick: '가손님', text: '3번' },
      { id: 'p2', ch: 'UCbuyerB000000000000002', nick: '나손님', text: '3번요' },
      { id: 'p3', ch: 'UCbuyerB000000000000002', nick: '나손님', text: '5' },
      { id: 'p4', ch: 'UCbuyerC000000000000003', nick: '다손님', text: '3번 이쁘다 5번 사고 싶은데 1000원' },
      { id: 'p5', ch: 'UCbuyerA000000000000001', nick: '가손님', text: '5번 취소요' },
    ]
    const judged = async (path: 'official' | 'extension') => {
      const world = await newWorld()
      const seller = await addSeller(world)
      const b = await createBroadcast(world, seller)
      await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 3, name: '핑크프릴', price: 20_000 }))
      await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 5, name: '라울', price: 10_000 }))
      if (path === 'extension') {
        const issued = await client(world, seller.cookie).post('/api/extension/code', {})
        const headers = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Content-Type': 'application/json' }
        const connected = await world.server.app.request('/ext/connect', { method: 'POST', headers, body: JSON.stringify({ code: issued.body.code }) })
        const { token } = (await connected.json()) as { token: string }
        const auth = { ...headers, Authorization: `Bearer ${token}` }
        const bound = await world.server.app.request('/ext/bind', { method: 'POST', headers: auth, body: JSON.stringify({ v: 'abcdefghijk', broadcast: b.id }) })
        expect(bound.status, await bound.text()).toBe(200)
        world.clock.advance(1_000)
        for (const chat of CHATS) {
          world.clock.advance(1_000)
          const sent = await world.server.app.request('/ext/chats', { method: 'POST', headers: auth, body: JSON.stringify({ v: 'abcdefghijk', messages: [{ ...chat, at: world.clock.now() }] }) })
          expect(sent.status, await sent.text()).toBe(200)
        }
      } else {
        world.clock.advance(1_000)
        for (const chat of CHATS) {
          world.clock.advance(1_000)
          await world.server.service.ingestYoutubeBatch(seller.sellerId, b.id, [{ ...chat, publishedAt: world.clock.now() }])
        }
      }
      const state = (await world.server.writer.read(seller.sellerId, b.date)).state
      const buyers: string[] = []
      const who = (buyer: string) => {
        if (!buyers.includes(buyer)) buyers.push(buyer)
        return buyers.indexOf(buyer)
      }
      const claims = listClaims(state).map((claim) => ({ no: claim.no, status: claim.status, origin: claim.origin, price: claim.price, buyer: who(claim.currentBuyer), cancelRequested: claim.cancelRequested }))
      const view = await client(world, seller.cookie).get(`/api/days/${b.date}/messages`)
      const messages = (view.body.messages as { id: string; orders: number[]; cancels: number[]; mentions: number[] }[]).map(({ id, orders, cancels, mentions }) => ({ id, orders, cancels, mentions }))
      return { claims, messages }
    }
    const official = await judged('official')
    const extension = await judged('extension')
    expect(official.claims.length).toBeGreaterThan(0)
    expect(extension).toEqual(official)
  })
})

describe('기존 숫자 필드 요청도 한 판 동안 받는다 (약속 2)', () => {
  it('product.register no·name·price, sms no·received는 그대로 된다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 20_000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 15, received: '11:59' }))
    expect(listClaims((await world.server.writer.read(seller.sellerId, b.date)).state)).toHaveLength(1)
    expect(ORIGIN).toMatch(/^https:/)
  })

  it('product.register 숫자 no도 그 방송의 번호 한도(claim.maxNumber) 밖이면 400 field no, 기록 없음 (D-030·D-089와 같다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const before = await countRows(world.database, 'events')
    const out = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 10_000, name: '핑크프릴', price: 20_000 })
    expect(out.status).toBe(400)
    expect(out.body.error).toMatchObject({ problems: [{ field: 'no', message: expect.stringMatching(/^번호는 1부터 \d+까지예요\. 번호를 확인해 주세요\.$/) }] })
    expect(await countRows(world.database, 'events')).toBe(before)
    expect(listProducts((await world.server.writer.read(seller.sellerId, b.date)).state)).toEqual([])
  })
})
