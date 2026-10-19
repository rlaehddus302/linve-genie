// AC-S04-31 문자찜 입력 경로, AC-S04-32 판매자별 전화번호 키, AC-S04-33 채팅 수집 함수, AC-S04-34 로그·응답에 개인정보·비밀값 없음
import { getBuyer, listBuyers, listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { formatLog } from '../src/log.ts'
import { openSellerKey, phoneKeyOf } from '../src/secrets.ts'
import { FAST_COST, ORIGIN, addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, startServer, writeEvent } from './support.ts'

const PHONE_FORMS = ['010-1234-5678', '01012345678', '010 1234 5678', '０１０-１２３４-５６７８', '(010) 1234-5678']
/** 판매자가 적는 칸(글 칸·ID 칸)의 휴대폰 번호 거절 문장 (R-1, D-079 ⑥, AC-S04-22) */
const PHONE_MESSAGE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AC-S04-31 문자찜 입력 경로', () => {
  it('허용 필드로 새 엔진 이벤트를 만든다: ref는 서버가, received 기본값은 서버 도착 시각의 KST, 전화번호는 키·뒤 4자리로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const response = await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone: '010-1234-5678', memo: '김영희 이모' }))
    expect(response.body).toMatchObject({ type: 'sms', changed: true, phoneLast4: '5678' })
    const row = (await world.database.pglite?.query<{ body: string; sms_ref: string }>(`select body, sms_ref from events where type = 'sms'`))?.rows[0]
    const event = JSON.parse(row?.body ?? '{}') as Record<string, unknown>
    expect(Object.keys(event).sort()).toEqual(['at', 'b', 'memo', 'no', 'phoneKey', 'phoneLast4', 'received', 'ref', 'seq', 'type'])
    expect(event.ref).toMatch(/^[a-z]+$/)
    expect(row?.sms_ref).toBe(event.ref)
    expect(event.received).toBe('12:00:00') // T0 = 12:00 KST
    expect(event.phoneLast4).toBe('5678')
    const sellerRow = (await world.database.pglite?.query<{ phone_key_enc: string }>(`select phone_key_enc from sellers`))?.rows[0]
    const sellerKey = openSellerKey(Buffer.from(world.masterKey, 'base64'), seller.sellerId, sellerRow?.phone_key_enc ?? '')
    expect(event.phoneKey).toBe(phoneKeyOf(sellerKey, '01012345678'))
  })

  it('받은 시각을 null·형식이 틀린 값으로 보내면 기본값으로 바꾸지 않고 입력 오류', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (const received of [null, '', '24:00', 1200]) {
      const response = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received })
      expect(response.status, String(received)).toBe(400)
      expect(response.body).toMatchObject({ error: { problems: [{ field: 'received' }] } })
    }
    expect(await countRows(world.database, 'events')).toBe(1)
  })

  it('전화번호가 휴대폰 번호 모양이 아니면 키·뒤 4자리 둘 다 없고, 응답은 알아보지 못했다고 알린다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (const phone of ['5678', '+82 10-1234-5678', '02-123-4567', '', '없음']) {
      const response = await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone }))
      expect(response.body.phoneLast4, phone).toBeNull()
    }
    const bodies = (await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms'`))?.rows ?? []
    for (const { body } of bodies) {
      expect(body).not.toContain('phoneKey')
      expect(body).not.toContain('phoneLast4')
    }
  })

  it('요청에 모르는 필드(ref·phoneKey·phoneLast4·seq·at 포함)가 있으면 400(필드 이름만), 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (const extra of [{ ref: 'myref' }, { phoneKey: 'k'.repeat(43) }, { phoneLast4: '5678' }, { seq: 9 }, { at: 1 }, { Phone: '010-1234-5678' }, { phone_number: '010-1234-5678' }, { meta: { phone: '010-1234-5678' } }]) {
      const response = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, ...extra })
      expect(response.status, JSON.stringify(extra)).toBe(400)
      expect(response.body).toEqual({ error: { code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: [{ field: Object.keys(extra)[0], message: '받을 수 없는 항목이에요.' }] } })
      expect(response.text).not.toContain('5678')
    }
    // 번호 모양 필드 이름은 이름도 되돌려 보내지 않는다
    const sneaky = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, '010-1234-5678': true })
    expect(sneaky.body).toMatchObject({ error: { code: 'UNKNOWN_FIELD', problems: [{ field: null }] } })
    expect(sneaky.text).not.toContain('5678')
    expect(await countRows(world.database, 'events')).toBe(1)
  })

  it('같은 판매자에서 형식이 다른 같은 번호는 같은 키 → 같은 문자 구매자 (BUY-02)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (let no = 1; no <= PHONE_FORMS.length; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: 'a', price: 1000 }))
    for (const [index, phone] of PHONE_FORMS.entries()) await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: index + 1, received: '12:00', phone }))
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    const buyers = new Set(listClaims(state).map((claim) => claim.buyer))
    expect(buyers.size).toBe(1)
    expect(listBuyers(state)[0]).toMatchObject({ kind: 'sms', phoneLast4: '5678' })
  })

  it('지정 구매자가 그 범위의 엔진이 모르는 구매자면 400 "고른 구매자를 찾지 못했어요", 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const response = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, buyer: 'UC-unknown' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: { code: 'BUYER_NOT_FOUND', message: '고른 구매자를 찾지 못했어요.' } })
    expect(await countRows(world.database, 'events')).toBe(1)
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC-known', nick: 'n', text: '안녕' })
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, buyer: 'UC-known' }))
  })

  it('메모가 번호 모양이면 엔진 입력 오류로 거절', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (const memo of ['010-1234-5678', '김영희 010 1234 5678', '０１０１２３４５６７８']) {
      expect((await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, memo })).status).toBe(400)
    }
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, memo: '101동 1203호' }))
    expect(await countRows(world.database, 'events')).toBe(2)
  })

  it('번호 앞뒤에 다른 숫자가 붙은 메모·국가 번호 메모도 D-079 ⑥ 문장으로 거절하고 전화번호 칸을 덧붙여 안내한다 — 평문 번호가 로그·표시 이름에 남지 않는다 (RA-S04-001)', async () => {
    const world = await newWorld({ snapshotEvery: 2 })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const before = await countRows(world.database, 'events')
    // 국가 번호 표기('+82 10-…')는 D-080으로 번호가 아니다(받는 쪽은 코어 단위 시험 — engine-s04 AC-S04-07). 앞뒤에 숫자가 붙은 번호만 본다
    for (const memo of ['3시 010-8642-5678', '010-8642-5678 2개', '15번 01086425678', '+82 010-8642-5678']) {
      const response = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, memo, phone: '010-9999-8888' })
      expect(response.status, memo).toBe(400)
      expect(response.body, memo).toEqual({
        error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'memo', message: PHONE_MESSAGE, hint: '전화번호는 전화번호 칸에 적어 주세요.' }] },
      })
      expect(response.text, memo).not.toContain('8642-5678')
    }
    expect(await countRows(world.database, 'events')).toBe(before)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, memo: '3시 15번 2개' }))
    const dump = await dumpAllTables(world.database)
    for (const needle of ['8642-5678', '86425678', '01086425678']) expect(dump, needle).not.toContain(needle)
  })

  it('입금 메모·사유·방송 제목·상품 이름에 휴대폰 번호가 있어도 D-079 ⑥ 문장으로 거절한다(덧붙이는 안내 없음) — 기록·DB에 없다 (RA-S04-009·TD-S04-003, DAT-06)', async () => {
    const world = await newWorld({ snapshotEvery: 2 })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const before = await countRows(world.database, 'events')
    const rejected: readonly (readonly [Record<string, unknown>, string])[] = [
      [{ type: 'settlement.payment', buyer: 'UC-A', date: b.date, amount: 1000, memo: '홍길동 010-8642-5678' }, 'memo'],
      [{ type: 'settlement.refund', buyer: 'UC-A', date: b.date, amount: 1000, reason: '3시 010ㅡ8642ㅡ5678 환불' }, 'reason'],
      [{ type: 'host.blockBuyer', buyer: 'UC-A', reason: '010,8642,5678 노쇼' }, 'reason'],
      [{ type: 'product.register', b: b.id, no: 2, name: '니트 010-8642-5678', price: 1000 }, 'name'],
    ]
    for (const [event, field] of rejected) {
      const response = await writeEvent(world, seller, event, event.b === undefined ? b.date : undefined)
      expect(response.status, JSON.stringify(event)).toBe(400)
      expect(response.body, JSON.stringify(event)).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field, message: PHONE_MESSAGE }] } })
      expect(response.text).not.toContain('8642')
    }
    const title = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), title: '문자 주문 010~8642~5678' })
    expect(title.status).toBe(400)
    expect(title.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'title', message: PHONE_MESSAGE }] } })
    expect(await countRows(world.database, 'events')).toBe(before)
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC-A', date: b.date, amount: 1000, memo: '홍길동 10,000원 3시' }, b.date))
    const dump = await dumpAllTables(world.database)
    for (const needle of ['8642', '86425678']) expect(dump, needle).not.toContain(needle)
  })

  it('구매자·메시지 ID 칸에 휴대폰 번호를 적으면 D-079 ⑥ 문장 + 번호 대신 고를 것을 안내하고 기록하지 않는다 — DB에 없다 (SA-S04-006·TD-S04-004)', async () => {
    const world = await newWorld({ snapshotEvery: 2 })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    const before = await countRows(world.database, 'events')
    const PICK_BUYER = '전화번호 대신 구매자를 골라 주세요.'
    const rejected: readonly (readonly [Record<string, unknown>, string, string])[] = [
      [{ type: 'host.blockBuyer', buyer: '010-7531-0001', reason: '노쇼' }, 'buyer', PICK_BUYER],
      [{ type: 'settlement.payment', buyer: '01075310002', date: b.date, amount: 1000 }, 'buyer', PICK_BUYER],
      [{ type: 'buyer.merge', from: '010 7531 0003', into: 'UC1', reason: '같은 사람' }, 'from', PICK_BUYER],
      [{ type: 'buyer.merge', from: 'UC1', into: '010.7531.0004', reason: '같은 사람' }, 'into', '전화번호 대신 합칠 구매자를 골라 주세요.'],
      [{ type: 'buyer.unmerge', from: '(010)7531-0005', reason: '다른 사람' }, 'from', PICK_BUYER],
      [{ type: 'host.assign', b: b.id, no: 1, buyer: 'UC1', replace: '010-7531-0006', replaceTo: 'WAITLIST', reason: '전화 주문' }, 'replace', '전화번호 대신 교체할 1등을 골라 주세요.'],
      [{ type: 'host.convertMessage', b: b.id, msg: '010-7531-0007', no: 1 }, 'msg', '전화번호 대신 메시지를 골라 주세요.'],
      [{ type: 'sms', b: b.id, no: 1, buyer: '010-7531-0008' }, 'buyer', PICK_BUYER],
    ]
    for (const [event, field, hint] of rejected) {
      const response = await writeEvent(world, seller, event, event.b === undefined ? b.date : undefined)
      expect(response.status, JSON.stringify(event)).toBe(400)
      expect(response.body, JSON.stringify(event)).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field, message: PHONE_MESSAGE, hint }] } })
      expect(response.text).not.toContain('7531')
    }
    expect(await countRows(world.database, 'events')).toBe(before)
    // 영문이 섞인 ID는 숫자가 많아도 받는다 (D-079 ④)
    await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UC01099990009abc', reason: '노쇼' }, b.date))
    const dump = await dumpAllTables(world.database)
    for (const needle of ['7531-000', '7531000', '7531 000', '7531.000']) expect(dump, needle).not.toContain(needle)
  })

  it('서버가 만든 ref에는 숫자가 없다 — 바꿔 끼운 생성기가 번호 모양을 내도 다시 만든다', async () => {
    const refs = ['01012345678', 's01012345678', 'r-010-1234-5678-2', 'safe-ref']
    const world = await newWorld({ ids: { smsRef: () => refs.shift() ?? 'fallback' } })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1 }))
    const ref = (await world.database.pglite?.query<{ sms_ref: string }>(`select sms_ref from events where type = 'sms'`))?.rows[0]?.sms_ref
    expect(ref).toBe('safe-ref')
  })
})

describe('AC-S04-32 판매자별 전화번호 키', () => {
  it('판매자를 만들 때 키를 만들어 마스터 키로 암호화해 둔다 — 같은 번호라도 판매자마다 다른 키, 재시작 뒤에도 같은 키', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const bSeller = await addSeller(world)
    const keyOf = async (server: typeof world, seller: typeof a) => {
      const broadcast = await createBroadcast(server, seller)
      await expectOk(writeEvent(server, seller, { type: 'sms', b: broadcast.id, no: 1, phone: '010-9876-5432' }))
      const rows = (await server.database.pglite?.query<{ body: string }>(`select e.body from events e where e.seller_id = $1 and e.type = 'sms' order by e.id desc limit 1`, [seller.sellerId]))?.rows
      return (JSON.parse(rows?.[0]?.body ?? '{}') as { phoneKey: string }).phoneKey
    }
    const keyA = await keyOf(world, a)
    const keyB = await keyOf(world, bSeller)
    expect(keyA).not.toBe(keyB)
    const restarted = startServer(world.database, world.masterKey)
    expect(await keyOf(restarted, a)).toBe(keyA)
    // DB에는 평문 키가 없다
    const sellerRows = (await world.database.pglite?.query<{ id: string; phone_key_enc: string }>(`select id, phone_key_enc from sellers`))?.rows ?? []
    const dump = await dumpAllTables(world.database)
    for (const row of sellerRows) {
      const plain = openSellerKey(Buffer.from(world.masterKey, 'base64'), row.id, row.phone_key_enc)
      for (const encoding of ['base64', 'base64url', 'hex'] as const) expect(dump).not.toContain(plain.toString(encoding))
    }
  })

  it('마스터 키가 없거나 형식이 틀리면 서버를 만들지 않는다 (값은 문장에 없다)', async () => {
    const world = await newWorld()
    for (const key of ['', 'short', Buffer.alloc(16).toString('base64')]) {
      expect(() => startServer(world.database, key)).toThrow(/마스터 키/)
      try {
        startServer(world.database, key)
      } catch (error) {
        if (key !== '') expect(String(error)).not.toContain(key)
      }
    }
  })
})

describe('AC-S04-33 채팅 수집 함수', () => {
  it('허용 필드로 엔진 이벤트를 만들고 같은 기록 경로를 탄다 (조치자 = 수집기). 모르는 필드·모르는 방송은 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    expect(await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '영희', text: '안녕', owner: false, publishedAt: Date.UTC(2026, 9, 19, 2, 59) })).toMatchObject({ status: 'recorded', seq: 2 })
    expect(await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC1', nick: '영희', text: '안녕', phone: '010-1234-5678' })).toMatchObject({ status: 'rejected', problems: [{ field: 'phone' }] })
    expect(await world.server.ingestChat(seller.sellerId, { b: 'b_nope', id: 'm3', ch: 'UC1', nick: '영희', text: '안녕' })).toEqual({ status: 'not_found' })
    expect(await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm4', ch: 'sms:x', nick: '영희', text: '안녕' })).toMatchObject({ status: 'rejected' })
    expect(await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'a\u0000b', ch: 'UC1', nick: 'n', text: 't' })).toMatchObject({ status: 'rejected' })
    expect(await world.server.ingestChat(seller.sellerId, 'not an object')).toMatchObject({ status: 'rejected' })
    // 다른 판매자의 방송에는 넣을 수 없다
    const other = await addSeller(world)
    expect(await world.server.ingestChat(other.sellerId, { b: b.id, id: 'm5', ch: 'UC1', nick: 'n', text: 't' })).toEqual({ status: 'not_found' })
    const rows = (await world.database.pglite?.query<{ actor: string; account_id: string | null; chat_message_id: string }>(`select actor, account_id, chat_message_id from events where type = 'chat'`))?.rows
    expect(rows).toEqual([{ actor: 'collector', account_id: null, chat_message_id: 'm1' }])
  })

  it('브라우저용 공개 API로 채팅을 받지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const response = await writeEvent(world, seller, { type: 'chat', b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    expect(response.status).toBe(400)
    for (const path of ['/api/chat', '/api/chats', '/api/broadcasts/x/chat']) expect((await client(world, seller.cookie).post(path, { requestId: rid() })).status).toBe(404)
  })
})

describe('AC-S04-34 로그·응답에 개인정보·비밀값이 없다', () => {
  it('정상·오류 경로를 모두 거쳐도 표준 출력·표준 오류·로그 함수에 표식 값이 없고, 응답에 키·토큰·해시가 없다', async () => {
    const lines: string[] = []
    const capture =
      (sink: (chunk: string) => void) =>
      (...args: unknown[]) => {
        sink(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message} ${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
      }
    const push = (chunk: string) => lines.push(chunk)
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      push(String(chunk))
      return true
    }) as typeof process.stderr.write)
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(capture(push))

    const M = {
      phone: '010-7777-3141',
      phoneDigits: '01077773141',
      memo: 'MEMO기록표식',
      nick: 'NICK표식',
      chat: 'CHAT본문표식',
      title: 'TITLE표식',
      reason: 'REASON표식',
      login: 'markerlogin',
      password: 'PASSWORD-표식-123',
      shop: 'SHOP표식',
    }
    let boom = false
    let failSave = false
    const { openTestDb } = await import('./support.ts')
    const database = await openTestDb()
    const { generateMasterKey } = await import('../src/secrets.ts')
    const masterKey = generateMasterKey()
    // 로그 함수는 기본값(표준 오류)을 쓴다 — 실제 서버와 같은 경로
    const { createServer } = await import('../src/server.ts')
    const { applyEvent } = await import('@livejjim/core')
    const server = createServer({
      database,
      masterKey,
      appOrigin: ORIGIN,
      passwordCost: FAST_COST,
      engine: {
        applyEvent: (state, event) => {
          if (boom) throw new Error(`엔진 오류 ${M.phone} ${M.memo} ${JSON.stringify(event)}`)
          return applyEvent(state, event)
        },
      },
      hooks: {
        beforeCommit: () => {
          if (failSave) throw new Error(`저장 실패 ${M.memo} ${M.phone}`)
        },
      },
    })
    const world = { server, database, masterKey, clock: { now: () => Date.now(), set: () => {}, advance: () => {} }, logs: [] }
    const created = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName: M.shop, loginId: M.login, password: M.password }, { passwordCost: FAST_COST })
    expect(created.ok).toBe(true)

    const responses: string[] = []
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await server.app.request(path, init)
      const text = await response.text()
      responses.push(`${response.headers.get('set-cookie') ?? ''} ${text}`)
      if (path.startsWith('/api/') && path !== '/api/health') expect(response.headers.get('cache-control'), path).toBe('no-store')
      return { status: response.status, text, headers: response.headers }
    }
    const json = (body: unknown, cookie?: string) => ({
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie === undefined ? {} : { Cookie: cookie }) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

    // 로그인 실패·성공
    await call('/api/login', json({ loginId: M.login, password: `${M.password}x` }))
    await call('/api/login', json({ loginId: `${M.login}zz`, password: M.password }))
    const ok = await call('/api/login', json({ loginId: M.login, password: M.password }))
    const token = /lj_session=([^;]+)/.exec(ok.headers.get('set-cookie') ?? '')?.[1] ?? ''
    const cookie = `lj_session=${token}`
    // 정상 경로
    const bc = await call('/api/broadcasts', json({ requestId: 'p-1', title: M.title }, cookie))
    const b = (JSON.parse(bc.text) as { broadcast: { id: string; date: string } }).broadcast
    await call('/api/events', json({ requestId: 'p-2', type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }, cookie))
    await server.ingestChat(created.ok ? created.sellerId : '', { b: b.id, id: 'chat-1', ch: 'UCM', nick: M.nick, text: `${M.chat} 1` })
    await call('/api/events', json({ requestId: 'p-3', type: 'sms', b: b.id, no: 1, phone: M.phone, memo: M.memo }, cookie))
    await call('/api/events', json({ requestId: 'p-4', type: 'host.cancel', b: b.id, no: 1, buyer: 'UCM', reason: M.reason }, cookie))
    await call(`/api/days/${b.date}`, { headers: { Cookie: cookie } })
    await call(`/api/days/${b.date}/history`, { headers: { Cookie: cookie } })
    await call('/api/broadcasts', { headers: { Cookie: cookie } })
    await call('/api/me', { headers: { Cookie: cookie } })
    // 오류 경로
    await call('/api/events', json({ requestId: 'e-1', type: 'sms', b: b.id, no: 0, phone: M.phone, memo: M.memo }, cookie)) // 입력 오류
    await call('/api/events', json({ requestId: 'e-2', type: 'sms', b: b.id, no: 1, phoneNumber: M.phone, memo: M.memo }, cookie)) // 모르는 필드
    await call('/api/events', json({ requestId: 'e-3', type: 'sms', b: b.id, no: 1, memo: `${M.memo} ${M.phone}` }, cookie)) // 번호 메모
    boom = true
    await call('/api/events', json({ requestId: 'e-4', type: 'sms', b: b.id, no: 1, phone: M.phone, memo: M.memo }, cookie)) // 엔진 예외
    boom = false
    failSave = true
    await call('/api/events', json({ requestId: 'e-5', type: 'sms', b: b.id, no: 1, phone: M.phone, memo: M.memo }, cookie)) // 저장 실패
    failSave = false
    await call('/api/events', json({ requestId: 'p-3', type: 'sms', b: b.id, no: 1, phone: M.phone, memo: M.memo }, cookie)) // 요청 번호 중복
    await call('/api/events', json(`{"requestId":"e-6","memo":"${M.memo}",`, cookie)) // 깨진 JSON
    await call('/api/events', json({ requestId: 'e-7', memo: `${M.memo}${'x'.repeat(70_000)}` }, cookie)) // 너무 큰 본문
    await call('/api/events', json({ requestId: 'e-8', type: 'sms', b: b.id, no: 1, memo: M.memo })) // 세션 없음
    await call('/api/events', { ...json({ requestId: 'e-9', memo: M.memo }, cookie), headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', Cookie: cookie } }) // 다른 출처
    for (let i = 0; i < 11; i++) await call('/api/login', json({ loginId: M.login, password: `wrong-${M.password}` })) // 잠금
    await call('/api/login', json({ loginId: M.login, password: M.password })) // 잠긴 뒤
    await call('/api/logout', json({}, cookie))
    await call('/api/me', { headers: { Cookie: cookie } }) // 로그아웃 뒤
    await server.ingestChat(created.ok ? created.sellerId : '', { b: b.id, id: 'chat-1', ch: 'UCM', nick: M.nick, text: M.chat }) // 채팅 중복

    const sellerKeyRow = (await database.pglite?.query<{ phone_key_enc: string }>(`select phone_key_enc from sellers`))?.rows[0]
    const sellerKey = openSellerKey(Buffer.from(masterKey, 'base64'), created.ok ? created.sellerId : '', sellerKeyRow?.phone_key_enc ?? '')
    const phoneKey = phoneKeyOf(sellerKey, M.phoneDigits)
    const sessionHashes = ((await database.pglite?.query<{ token_hash: string }>(`select token_hash from sessions`))?.rows ?? []).map((row) => row.token_hash)
    const passwordHash = (await database.pglite?.query<{ password_hash: string }>(`select password_hash from accounts`))?.rows[0]?.password_hash ?? ''

    const allLines = lines.join('\n')
    for (const value of [...Object.values(M), '7777-3141', token, masterKey, sellerKey.toString('base64'), sellerKey.toString('base64url'), phoneKey, passwordHash]) {
      expect(allLines, `로그에 ${value}`).not.toContain(value)
    }
    // 로그는 실제로 남았다 (오류 종류·코드만)
    expect(allLines).toContain('code=ENGINE_FAILED')
    expect(allLines).toContain('code=SAVE_FAILED')

    const allResponses = responses.join('\n')
    for (const value of [phoneKey, sellerKey.toString('base64'), sellerKey.toString('base64url'), passwordHash, ...sessionHashes, M.phone, M.phoneDigits]) {
      expect(allResponses, `응답에 ${value}`).not.toContain(value)
    }
    expect(allResponses).not.toContain('phoneKey')
    // 세션 토큰은 쿠키(Set-Cookie)로만
    expect(responses.filter((text) => text.includes(token)).every((text) => text.startsWith(`lj_session=${token}`))).toBe(true)
    void world
  })

  it('요청 본문이 64KB를 넘으면 413, 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const big = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'x'.repeat(66_000), price: 1 })
    expect(big.status).toBe(413)
    expect(big.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await countRows(world.database, 'events')).toBe(1)
    const justUnder = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'x'.repeat(60_000), price: 1 })
    expect(justUnder.status).toBe(200)
  })

  it('로그 한 줄은 코드·날짜·seq·오류 종류만', () => {
    expect(formatLog({ level: 'error', code: 'ENGINE_FAILED', date: '2026-10-19', seq: 3, errorKind: 'TypeError' })).toBe(
      '[server] 엔진이 처리하지 못한 입력을 실패로 표시하고 건너뛰었어요 (code=ENGINE_FAILED date=2026-10-19 seq=3 kind=TypeError)',
    )
  })

  it('구매자 조회는 뒤 4자리만, 이력 조회도 전화번호 키를 뺀다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone: '010-2468-1357' }))
    const view = await client(world, seller.cookie).get(`/api/days/${b.date}`)
    const history = await client(world, seller.cookie).get(`/api/days/${b.date}/history`)
    expect((view.body.buyers as { phoneLast4: string }[])[0]?.phoneLast4).toBe('1357')
    for (const text of [view.text, history.text]) {
      expect(text).not.toContain('phoneKey')
      expect(text).not.toContain('2468')
    }
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(getBuyer(state, listBuyers(state)[0]?.id ?? '')?.phoneLast4).toBe('1357')
  })
})

describe('DB 어디에도 전화번호 원문·정규화한 번호가 없다 (AC-S04-31)', () => {
  it('테이블 전체와 PGlite 데이터 폴더 바이트에서 번호 문자열을 찾지 못한다', async () => {
    const world = await newWorld({ snapshotEvery: 2 })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    for (const phone of PHONE_FORMS) await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone: phone.replace('1234', '8642').replace('１２３４', '８６４２') })
    await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone: '010-8642-5678', memo: '010-8642-5678' }) // 거절됨
    await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone: '010-8642-5678', phoneNumber: '010-8642-5678' }) // 거절됨
    await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid() }))
    const dump = await dumpAllTables(world.database)
    for (const needle of ['01086425678', '010-8642-5678', '8642-5678', '86425678', '1086425678', '010 8642 5678']) expect(dump, needle).not.toContain(needle)
    const blob = await world.database.pglite?.dumpDataDir('none')
    const bytes = Buffer.from(await (blob as Blob).arrayBuffer()).toString('latin1')
    for (const needle of ['01086425678', '010-8642-5678', '86425678']) expect(bytes.includes(needle), needle).toBe(false)
    expect(await countRows(world.database, 'snapshots')).toBeGreaterThan(0)
  })
})
