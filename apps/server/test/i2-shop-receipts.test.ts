// AC-I2-01 가게 설정, AC-I2-10~12 확인서(데이터·PDF·PNG·전원 PDF), AC-I2-81 개인정보 (서버 경로)
import { buildReceipt, loadDocumentFont, renderReceiptPng, type ReceiptData } from '@livejjim/documents'
import { describe, expect, it } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { documentFont, fileNamePart } from '../src/files.ts'
import { formatLog } from '../src/log.ts'
import { replayGolden, fontBytes, pdfPageTexts } from '../../../packages/documents/test/helpers.ts'
import { SHOP, at, chat, fileNameOf, getFile, kst, ok, putShop, sellG201, sellG202 } from './i2-support.ts'
import { FAST_COST, addSeller, client, countRows, createBroadcast, dumpAllTables, fakeClock, login, newWorld, type Seller } from './support.ts'

const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const early = () => fakeClock(kst('2026-10-17', '09:00:00'))

describe('AC-I2-01 가게 설정 저장·조회', () => {
  it('가게 이름·입금 계좌·안내 문장을 저장하고, 가게 이름은 판매자 이름(로그인 정보·화면 위 이름)이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const initial = (await api.get('/api/shop')).body.shop as Record<string, string>
    expect(initial).toEqual({ name: `가게 ${seller.loginId}`, bank: '', accountNumber: '', accountHolder: '', accountNote: '' })
    const saved = await putShop(world, seller, { name: '  초록다육  ', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로 적어 주세요' })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body.shop).toEqual(SHOP)
    expect((await api.get('/api/shop')).body.shop).toEqual(SHOP)
    expect((await api.get('/api/me')).body.seller).toEqual({ name: '초록다육' })
    // 계좌 없음(셋 다 빈 값) + 안내 문장 0글자
    const none = await putShop(world, seller, { name: '초록다육', bank: '', accountNumber: ' ', accountHolder: '', accountNote: '' })
    expect(none.status, none.text).toBe(200)
  })

  it('계좌 세 칸 중 일부만 적으면 저장하지 않고 쉬운 문장과 칸별 문제', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller)
    const partial = await putShop(world, seller, { ...SHOP, accountHolder: '', bank: '' })
    expect(partial.status).toBe(400)
    expect(partial.body.error).toEqual({
      code: 'INVALID_INPUT',
      message: '은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요.',
      problems: [
        { field: 'bank', message: '은행을 적어 주세요.' },
        { field: 'accountHolder', message: '예금주를 적어 주세요.' },
      ],
    })
    expect((await client(world, seller.cookie).get('/api/shop')).body.shop).toEqual(SHOP)
  })

  it('길이·형식·제어 글자·모르는 칸·문자열이 아닌 값은 저장하지 않는다 (길이는 앞뒤 공백을 지운 뒤 코드 포인트로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const cases: [Record<string, unknown>, string][] = [
      [{ ...SHOP, name: '' }, 'name'],
      [{ ...SHOP, name: '   ' }, 'name'],
      [{ ...SHOP, name: '가'.repeat(31) }, 'name'],
      [{ ...SHOP, bank: '은'.repeat(21) }, 'bank'],
      [{ ...SHOP, accountNumber: '302-ab-11' }, 'accountNumber'],
      [{ ...SHOP, accountNumber: '- -' }, 'accountNumber'],
      [{ ...SHOP, accountNumber: '1'.repeat(31) }, 'accountNumber'],
      [{ ...SHOP, accountHolder: '김'.repeat(21) }, 'accountHolder'],
      [{ ...SHOP, accountNote: '가'.repeat(101) }, 'accountNote'],
      [{ ...SHOP, name: '초록\n다육' }, 'name'],
      [{ ...SHOP, accountNote: '탭\t문장' }, 'accountNote'],
      [{ ...SHOP, bank: '농협\u007F' }, 'bank'],
      [{ ...SHOP, name: 5 }, 'name'],
    ]
    for (const [body, field] of cases) {
      const response = await putShop(world, seller, body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(((response.body.error as { problems: { field: string }[] }).problems).map((p) => p.field)).toContain(field)
    }
    const { accountNote: _note, ...missing } = SHOP
    expect((await putShop(world, seller, missing)).status).toBe(400)
    expect((await putShop(world, seller, { ...SHOP, extra: 1 })).body.error).toMatchObject({ code: 'UNKNOWN_FIELD' })
    // 경계값은 받는다: 30·20·30·20·100글자, 이모지는 한 글자
    expect((await putShop(world, seller, { name: '🌵'.repeat(30), bank: '은'.repeat(20), accountNumber: '1'.repeat(30), accountHolder: '김'.repeat(20), accountNote: '가'.repeat(100) })).status).toBe(200)
  })

  it('SA-I2-006: 계정 만들기가 받은 30글자보다 긴 가게 이름은 고치지 않으면 그대로 저장된다(계좌만 적기) — 다른 이름으로 고치면 1~30글자', async () => {
    const world = await newWorld()
    const longName = '초록다육 다육이 전문 농장 직영 라이브 판매 공식 가게 본점'
    expect([...longName].length).toBeGreaterThan(30)
    const created = await createSellerAccount(world.database.db, Buffer.from(world.masterKey, 'base64'), { shopName: longName, loginId: 'longshop', password: 'correct-horse-1' }, { passwordCost: FAST_COST })
    if (!created.ok) throw new Error(created.message)
    const seller: Seller = { sellerId: created.sellerId, accountId: created.accountId, loginId: 'longshop', password: 'correct-horse-1', cookie: await login(world, 'longshop', 'correct-horse-1') }
    const current = (await client(world, seller.cookie).get('/api/shop')).body.shop as Record<string, string>
    // 이름 그대로 + 계좌 (앞뒤 공백은 지운 뒤 같은지 본다)
    const saved = await putShop(world, seller, { ...current, name: ` ${longName} `, bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매' })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body.shop).toEqual({ name: longName, bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '' })
    // 다른 긴 이름으로 고치면 거절, 30글자 안으로 고치면 저장 — 그 뒤에는 긴 이름으로 돌아가지 못한다
    const other = await putShop(world, seller, { ...SHOP, name: `${longName}2` })
    expect(other.status).toBe(400)
    expect(other.body.error).toMatchObject({ problems: [{ field: 'name', message: '가게 이름은 1~30글자로 적어 주세요.' }] })
    expect((await putShop(world, seller, SHOP)).status).toBe(200)
    expect((await putShop(world, seller, { ...SHOP, name: longName })).status).toBe(400)
    // 빈 이름·제어 글자는 지금 이름과 상관없이 거절
    expect((await putShop(world, seller, { ...SHOP, name: '  ' })).status).toBe(400)
    expect((await putShop(world, seller, { ...SHOP, name: `${SHOP.name}\n` })).status).toBe(400)
  })

  it('휴대폰 번호 검사를 하지 않는다 — 계좌번호 010-1234-5678-90, 안내 문장 문의 010-1234-5678', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const response = await putShop(world, seller, { ...SHOP, accountNumber: '010-1234-5678-90', accountNote: '문의 010-1234-5678' })
    expect(response.status, response.text).toBe(200)
    expect(response.body.shop).toMatchObject({ accountNumber: '010-1234-5678-90', accountNote: '문의 010-1234-5678' })
  })

  it('다른 판매자의 가게 설정은 읽지도 고치지도 못한다, 로그인 없으면 401, 서버 로그에 값이 없다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    await putShop(world, a)
    expect((await client(world, b.cookie).get('/api/shop')).body.shop).toMatchObject({ name: `가게 ${b.loginId}`, bank: '' })
    expect((await client(world, null).get('/api/shop')).status).toBe(401)
    const anonymous = await world.server.app.request('/api/shop', { method: 'PUT', headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' }, body: JSON.stringify(SHOP) })
    expect(anonymous.status).toBe(401)
    expect((await client(world, a.cookie).get('/api/shop')).body.shop).toEqual(SHOP)
    const logs = world.logs.map(formatLog).join('\n')
    for (const value of Object.values(SHOP)) expect(logs).not.toContain(value)
  })

  it('가게 설정을 바꾸면 그 판매자의 실시간 연결에 shop 알림 (값 없이)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const { sseReader } = await import('./support.ts')
    const mine = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } }))
    const theirs = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: other.cookie } }))
    await mine.until(() => mine.events.some((e) => e.event === 'ready'))
    await theirs.until(() => theirs.events.some((e) => e.event === 'ready'))
    await putShop(world, seller)
    await mine.until(() => mine.events.some((e) => e.event === 'shop'))
    expect(mine.events.find((e) => e.event === 'shop')?.data).toBe('{}')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(theirs.events.some((e) => e.event === 'shop')).toBe(false)
    await mine.cancel()
    await theirs.cancel()
  })
})

const G201 = replayGolden('G-ENG-201')
const DOC_SHOP = { name: '초록다육', account: { bank: '농협', number: '302-9988-7766-11', holder: '김판매' }, accountNote: '입금자명은 닉네임으로 적어 주세요' }

function goldenReceipt(buyer: string): ReceiptData {
  const result = buildReceipt({ state: G201, buyer, date: '2026-10-18', shop: DOC_SHOP, rehearsal: false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}

describe('AC-I2-10 한 사람 확인서 — 데이터·PDF·PNG', () => {
  it('G-ENG-201과 같은 판매를 서버로 넣은 범위 · 가게 설정 · 서버 시계 2026-10-18T14:30:00Z → UC_A 확인서 데이터 = AC-P2-20 값', async () => {
    const world = await newWorld({ clock: early() })
    const seller = await addSeller(world)
    await putShop(world, seller)
    const { sms } = await sellG201(world, seller)
    world.clock.set(CREATED)
    const response = await client(world, seller.cookie).get('/api/days/2026-10-18/receipt?buyer=UC_A')
    expect(response.status, response.text).toBe(200)
    expect(response.body).toEqual(goldenReceipt('UC_A'))
    expect(response.body).toMatchObject({ buyerName: '길동이', total: 25000, remaining: 15000, createdAt: '2026년 10월 18일 23:30' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-receipt-created-at')).toBe(String(CREATED))
    // 문자 구매자: 서버가 만든 ref라 구매자 ID는 다르지만 이름·끝자리·금액이 같다 (확인서 데이터에는 구매자 ID가 없다)
    const smsReceipt = await client(world, seller.cookie).get(`/api/days/2026-10-18/receipt?buyer=${encodeURIComponent(sms)}`)
    expect(smsReceipt.body).toEqual(goldenReceipt('sms:s1'))
  })

  it('PDF·PNG: 형식·이름·저장하지 않음, 같은 상태·같은 서버 시각이면 바이트가 같고, PNG = 같은 확인서 데이터로 그린 Node 그림', async () => {
    const world = await newWorld({ clock: early() })
    const seller = await addSeller(world)
    await putShop(world, seller)
    await sellG201(world, seller)
    world.clock.set(CREATED)
    const pdf1 = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipt.pdf?buyer=UC_A')
    const pdf2 = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipt.pdf?buyer=UC_A')
    const png1 = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipt.png?buyer=UC_A')
    const png2 = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipt.png?buyer=UC_A')
    expect(pdf1.status).toBe(200)
    expect(pdf1.headers.get('content-type')).toBe('application/pdf')
    expect(png1.headers.get('content-type')).toBe('image/png')
    for (const file of [pdf1, png1]) expect(file.headers.get('cache-control')).toBe('no-store')
    expect(fileNameOf(pdf1.headers)).toBe('확인서-2026-10-18-길동이.pdf')
    expect(fileNameOf(png1.headers)).toBe('확인서-2026-10-18-길동이.png')
    expect(pdf1.headers.get('content-disposition')).toContain('filename="receipt-2026-10-18.pdf"')
    expect(Buffer.from(pdf1.bytes).equals(Buffer.from(pdf2.bytes))).toBe(true)
    expect(Buffer.from(png1.bytes).equals(Buffer.from(png2.bytes))).toBe(true)
    expect(Buffer.from(png1.bytes).equals(Buffer.from(renderReceiptPng(goldenReceipt('UC_A'), loadDocumentFont(fontBytes()))))).toBe(true)
    const texts = (await pdfPageTexts(pdf1.bytes)).flat().join(' ')
    expect(texts).toContain('길동이')
    expect(texts).toContain('25,000원')
  })

  it('리허설 범위: 제목 "(리허설)"과 이름 앞 "리허설-"', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, b.id, 'r1', 'sim_a', '연습', '1')
    const data = await client(world, seller.cookie).get('/api/days/2026-10-19/receipt?buyer=sim_a&rehearsal=true')
    expect(data.body.title).toBe('구매 내역 확인서 (리허설)')
    const file = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipt.pdf?buyer=sim_a&rehearsal=true')
    expect(fileNameOf(file.headers)).toBe('리허설-확인서-2026-10-19-연습.pdf')
    // 실제 범위에는 그 날짜가 없다
    expect((await client(world, seller.cookie).get('/api/days/2026-10-19/receipt?buyer=sim_a')).status).toBe(404)
  })

  it('품목 없는 묶음·모르는 구매자 → 파일 없이 문장, 없는 날짜·다른 판매자의 범위 → 404, 잘못된 구매자 값 → 400', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-19', '19:00:00')) })
    const seller = await addSeller(world)
    const other = await addSeller(world)
    await sellG202(world, seller)
    const api = client(world, seller.cookie)
    for (const buyer of ['UC_C', 'UC_NOBODY']) {
      for (const path of ['receipt', 'receipt.pdf', 'receipt.png']) {
        const response = await api.get(`/api/days/2026-10-19/${path}?buyer=${buyer}`)
        expect(response.status).toBe(422)
        expect(response.body.error).toEqual({ code: 'NO_ITEMS', message: '구매 내역이 없어 확인서를 만들 수 없어요.' })
      }
    }
    expect((await api.get('/api/days/2026-10-25/receipt?buyer=UC_A')).status).toBe(404)
    expect((await client(world, other.cookie).get('/api/days/2026-10-19/receipt?buyer=UC_A')).status).toBe(404)
    expect((await client(world, other.cookie).get('/api/days/2026-10-19/receipts.pdf')).status).toBe(404)
    expect((await api.get('/api/days/2026-10-19/receipt')).status).toBe(400)
    expect((await api.get('/api/days/2026-10-19/receipt?buyer=010-1234-5678')).status).toBe(400)
    expect((await client(world, null).get('/api/days/2026-10-19/receipt?buyer=UC_A')).status).toBe(401)
  })

  it('내려받기 이름 다듬기: 헤더에 줄바꿈·따옴표·/·\\ 없음, 40글자까지, 비면 구매자', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    const nicks = ['a"b\r\nSet-Cookie: x', '../../x', '가'.repeat(60), '🌵🌵', 'a/b\\c:d*e?f"g<h>i|j k']
    for (const [i, nick] of nicks.entries()) {
      await ok(world, seller, { type: 'product.register', b: b.id, no: i + 1, name: '핑크', price: 1000 })
      await chat(world, seller, b.id, `n${String(i)}`, `UC_${String(i)}`, nick, String(i + 1))
    }
    const names: string[] = []
    for (let i = 0; i < nicks.length; i++) {
      const file = await getFile(world, seller.cookie, `/api/days/2026-10-19/receipt.pdf?buyer=UC_${String(i)}`)
      expect(file.status).toBe(200)
      const header = file.headers.get('content-disposition') ?? ''
      expect(header).not.toMatch(/[\r\n\\/]/)
      expect(header.match(/"/g)).toHaveLength(2) // filename="…" 한 쌍뿐
      names.push(fileNameOf(file.headers))
    }
    expect(names).toEqual(['확인서-2026-10-19-abSet-Cookie_x.pdf', '확인서-2026-10-19-....x.pdf', `확인서-2026-10-19-${'가'.repeat(40)}.pdf`, '확인서-2026-10-19-구매자.pdf', '확인서-2026-10-19-abcdefghij_k.pdf'])
    expect(fileNamePart('  ', documentFont())).toBe('구매자')
  })

  it('요청은 아무것도 기록하지 않는다 (이벤트·발송함·포장 기록 그대로)', async () => {
    const world = await newWorld({ clock: early() })
    const seller = await addSeller(world)
    await sellG201(world, seller)
    const before = await dumpAllTables(world.database)
    const events = await countRows(world.database, 'events')
    for (const path of ['receipt?buyer=UC_A', 'receipt.pdf?buyer=UC_A', 'receipt.png?buyer=UC_A', 'receipts.pdf']) await getFile(world, seller.cookie, `/api/days/2026-10-18/${path}`)
    expect(await countRows(world.database, 'events')).toBe(events)
    expect(await dumpAllTables(world.database)).toBe(before)
  })
})

describe('AC-I2-11·12 전원 확인서 PDF', () => {
  it('G-ENG-202 · 2026-10-19 → 쪽 순서 꽃님·문자찜·새싹·초록이·홍길동, 이름 확인서-2026-10-19-전원.pdf, 품목 없는 묶음 없음', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-19', '19:00:00')) })
    const seller = await addSeller(world)
    await putShop(world, seller)
    await sellG202(world, seller)
    const file = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf')
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('cache-control')).toBe('no-store')
    expect(fileNameOf(file.headers)).toBe('확인서-2026-10-19-전원.pdf')
    const pages = await pdfPageTexts(file.bytes)
    const firsts = pages.filter((page) => page.some((text) => /^1\/\d+$/.test(text)))
    expect(firsts.map((page) => page[page.indexOf('구매자') + 1])).toEqual(['꽃님', '문자찜', '새싹', '초록이', '홍길동'])
    expect(pages.flat().join(' ')).not.toContain('다육맘')
  })

  it('찍힌 이름 순: 가람(UC_A)·🌵가람(UC_B)·나비(UC_C) — 원문 순이 아니다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    for (const [i, [ch, nick]] of [['UC_C', '나비'], ['UC_B', '🌵가람'], ['UC_A', '가람']].entries()) {
      await ok(world, seller, { type: 'product.register', b: b.id, no: i + 1, name: '핑크', price: 1000 })
      await chat(world, seller, b.id, `x${String(i)}`, ch as string, nick as string, String(i + 1))
    }
    const pages = await pdfPageTexts((await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf')).bytes)
    const firsts = pages.filter((page) => page.some((text) => /^1\/\d+$/.test(text)))
    expect(firsts.map((page) => page[page.indexOf('구매자') + 1])).toEqual(['가람', '가람', '나비'])
    // 표 첫 줄(머리 '가격' 다음 = 회차, 그다음 = 번호) — UC_A(3번)·UC_B(2번)·UC_C(1번)
    const order = firsts.map((page) => page[page.indexOf('가격') + 2])
    expect(order).toEqual(['3', '2', '1'])
  })

  it('품목 있는 묶음이 없으면 파일 없이 문장, 리허설이면 리허설- 이름', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    await ok(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크', price: 1000 })
    const empty = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf')
    expect(empty.status).toBe(422)
    expect(empty.json?.error).toEqual({ code: 'NO_ITEMS', message: '그 날짜에 구매 내역이 있는 구매자가 없어요.' })
    const r = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_x', '연습', '1')
    const rehearsal = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf?rehearsal=true')
    expect(fileNameOf(rehearsal.headers)).toBe('리허설-확인서-2026-10-19-전원.pdf')
  })

  it('성능: 구매자 100명(품목 합 500개) 범위의 전원 PDF 응답이 30초 안', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    await world.server.writer.write({
      sellerId: seller.sellerId,
      date: '2026-10-19',
      rehearsal: false,
      createScope: false,
      requestId: null,
      build: () => {
        const drafts = []
        for (let no = 1; no <= 500; no++) {
          drafts.push({ fields: { type: 'product.register', b: b.id, no, name: `품종${String(no % 37)}`, price: 1000 + no * 10 }, actor: { kind: 'server' } as const })
          drafts.push({ fields: { type: 'chat', b: b.id, id: `p${String(no)}`, ch: `UC_${String(Math.floor((no - 1) / 5)).padStart(3, '0')}`, nick: `구매자${String(Math.floor((no - 1) / 5))}`, text: String(no) }, actor: { kind: 'collector' } as const, chat: { b: b.id, id: `p${String(no)}` } })
        }
        return drafts
      },
    })
    const started = performance.now()
    const file = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf')
    const elapsed = performance.now() - started
    expect(file.status).toBe(200)
    expect(file.headers.get('x-receipt-count')).toBe('100')
    expect(elapsed).toBeLessThan(30_000)
  }, 120_000)
})

describe('AC-I2-81 개인정보 — 서버 경로의 확인서', () => {
  it('확인서 데이터·PDF·PNG에 전화번호 전체·전화번호 키·문자찜 ref·sms: 구매자 ID·채널 ID·조정 사유·입금 메모가 없다, 로그에 파일 이름·내용이 없다', async () => {
    const world = await newWorld({ clock: early() })
    const seller = await addSeller(world)
    await putShop(world, seller)
    const { sms } = await sellG201(world, seller)
    at(world, '2026-10-18', '23:00:00')
    await ok(world, seller, { type: 'settlement.payment', buyer: sms, date: '2026-10-18', amount: 1000, memo: '입금메모홍' }, '2026-10-18')
    const ref = sms.slice('sms:'.length)
    const forbidden = ['010-1234-5678', '01012345678', ref, 'sms:', 'UC_A', '단골 할인', '입금메모홍', 'phoneKey']
    for (const buyer of ['UC_A', sms]) {
      const data = await client(world, seller.cookie).get(`/api/days/2026-10-18/receipt?buyer=${encodeURIComponent(buyer)}`)
      for (const secret of forbidden) expect(data.text).not.toContain(secret)
      const pdf = await getFile(world, seller.cookie, `/api/days/2026-10-18/receipt.pdf?buyer=${encodeURIComponent(buyer)}`)
      const text = (await pdfPageTexts(pdf.bytes)).flat().join(' ')
      for (const secret of forbidden) expect(text).not.toContain(secret)
      expect(fileNameOf(pdf.headers)).not.toContain(ref)
    }
    const logs = world.logs.map(formatLog).join('\n')
    expect(logs).not.toContain('확인서')
    expect(logs).not.toContain('길동이')
  })
})
