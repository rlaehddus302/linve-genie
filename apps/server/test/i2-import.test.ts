// AC-I2-51 상품 목록 가져오기 — 미리 보기·등록 (PRD-05, R-18, D-I2-09)
import { listProducts } from '@livejjim/core'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { IMPORT_FILE_MAX_BYTES } from '../src/import-files.ts'
import { chat, ok, post } from './i2-support.ts'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, newWorld, rid, type Seller, type TestServer } from './support.ts'

const preview = (world: TestServer, seller: Seller, b: string, body: Record<string, unknown>) => post(world, seller, `/api/broadcasts/${b}/import/preview`, body)
const register = (world: TestServer, seller: Seller, b: string, rows: unknown, requestId = rid('imp')) => post(world, seller, `/api/broadcasts/${b}/import`, { requestId, rows })
const fileBody = (name: string, bytes: Uint8Array | Buffer) => ({ file: { name, data: Buffer.from(bytes).toString('base64') } })

/** 한국어 윈도우 엑셀이 저장한 CSV처럼 EUC-KR(CP949)로 (한글 음절만 쓰는 시험 글 — 표는 Node의 TextDecoder로 거꾸로 만든다) */
function eucKr(text: string): Uint8Array {
  const decoder = new TextDecoder('euc-kr')
  const table = new Map<string, number[]>()
  for (let lead = 0xb0; lead <= 0xc8; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const char = decoder.decode(new Uint8Array([lead, trail]))
      if ([...char].length === 1 && !table.has(char)) table.set(char, [lead, trail])
    }
  }
  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) as number
    if (code < 0x80) out.push(code)
    else {
      const bytes = table.get(char)
      if (bytes === undefined) throw new Error(`EUC-KR 표에 없는 글자: ${char}`)
      out.push(...bytes)
    }
  }
  return new Uint8Array(out)
}

async function xlsx(rows: unknown[][], extra?: (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('목록')
  rows.forEach((row) => sheet.addRow(row))
  extra?.(sheet, workbook)
  return new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
}

async function setup(options: { rehearsal?: boolean; settings?: Record<string, unknown> } = {}) {
  const world = await newWorld()
  const seller = await addSeller(world)
  if (options.settings !== undefined) expect((await client(world, seller.cookie).patch('/api/settings', { settings: options.settings })).status).toBe(200)
  const b = await createBroadcast(world, seller, { date: '2026-10-19', ...(options.rehearsal === true ? { rehearsal: true } : {}) })
  return { world, seller, b: b.id, date: b.date }
}

describe('AC-I2-51 미리 보기 (기록하지 않는다)', () => {
  it('붙여 넣은 글 → R-18 결과 + 줄마다 원래 줄 글 + 등록할 줄 수·문제 줄 수, 설정 = 그 방송의 스냅샷, 이미 있는 번호 = 그 방송의 지금 상품(판매 종료 포함)', async () => {
    const { world, seller, b } = await setup({ settings: { 'price.unit': 'THOUSAND', 'claim.maxNumber': 50 } })
    await ok(world, seller, { type: 'product.register', b, no: 3, name: '있음', price: 1000 })
    await ok(world, seller, { type: 'product.register', b, no: 4, name: '닫힘', price: 1000 })
    await ok(world, seller, { type: 'product.close', b, no: 4 })
    // 방송을 만든 뒤 설정을 바꿔도 그 방송의 스냅샷(천원 단위·50번까지)을 쓴다
    await client(world, seller.cookie).patch('/api/settings', { settings: { 'price.unit': 'WON', 'claim.maxNumber': 999 } })
    const before = await dumpAllTables(world.database)
    const response = await preview(world, seller, b, { text: '번호\t품종\t가격\n15\t핑크프릴\t10\n3\t라울\t5\n4\t닫힌\t5\n51\t너무 큰 번호\t5\n16\t블루엘프' })
    expect(response.status, response.text).toBe(200)
    expect(response.body).toEqual({
      broadcast: b,
      unit: 'THOUSAND',
      maxNumber: 50,
      error: null,
      header: 1,
      headerCells: ['번호', '품종', '가격'],
      rows: [
        { line: 2, no: 15, name: '핑크프릴', price: 10000, text: '15\t핑크프릴\t10' },
        { line: 3, error: 'EXISTS', text: '3\t라울\t5' },
        { line: 4, error: 'EXISTS', text: '4\t닫힌\t5' },
        { line: 5, error: 'NUMBER_INVALID', text: '51\t너무 큰 번호\t5' },
        { line: 6, error: 'CELLS', text: '16\t블루엘프' },
      ],
      register: 1,
      problems: 4,
    })
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('전체 문제(EMPTY·TOO_MANY)는 줄 결과 없이', async () => {
    const { world, seller, b } = await setup()
    expect((await preview(world, seller, b, { text: '번호,품종,가격' })).body).toMatchObject({ error: 'EMPTY', rows: [], register: 0, problems: 0 })
    const many = Array.from({ length: 501 }, (_, i) => `${String(i + 1)},핑크,10000`).join('\n')
    expect((await preview(world, seller, b, { text: many })).body).toMatchObject({ error: 'TOO_MANY', rows: [] })
  })

  it('파일: EUC-KR CSV(한국어 윈도우 엑셀)·BOM UTF-8 CSV·.txt·.xlsx(첫 시트, 수·수식 계산 값·날짜·빈 칸, 줄 번호 = 행 번호)', async () => {
    const { world, seller, b } = await setup({ settings: { 'price.unit': 'WON' } })
    const euc = await preview(world, seller, b, fileBody('목록.CSV', eucKr('번호,품종,가격\n1,핑크프릴,10000\n2,방울복랑 금,8000')))
    expect(euc.status, euc.text).toBe(200)
    expect(euc.body.rows).toEqual([
      { line: 2, no: 1, name: '핑크프릴', price: 10000, text: '1,핑크프릴,10000' },
      { line: 3, no: 2, name: '방울복랑 금', price: 8000, text: '2,방울복랑 금,8000' },
    ])
    const bom = await preview(world, seller, b, fileBody('list.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('번호,품종,가격\n3,로라,4000', 'utf8')])))
    expect(bom.body).toMatchObject({ header: 1, rows: [{ line: 2, no: 3, name: '로라', price: 4000 }] })
    const txt = await preview(world, seller, b, fileBody('list.txt', Buffer.from('4\t자보\t3000', 'utf8')))
    expect(txt.body.rows).toEqual([{ line: 1, no: 4, name: '자보', price: 3000, text: '4\t자보\t3000' }])
    const book = await xlsx(
      [
        ['번호', '품종', '가격'],
        [10, '핑크프릴', 10000],
        [],
        [11, '라울', 8.5],
        [12, '수식', { formula: '1000*3', result: 3000 }],
        [13, new Date(Date.UTC(2026, 9, 18)), 5000],
        [14, null, 7000],
      ],
      (_sheet, workbook) => {
        const second = workbook.addWorksheet('둘째')
        second.addRow([99, '두 번째 시트', 1000])
      },
    )
    const excel = await preview(world, seller, b, fileBody('목록.xlsx', book))
    expect(excel.status, excel.text).toBe(200)
    expect(excel.body).toMatchObject({ header: 1, headerCells: ['번호', '품종', '가격'] })
    expect(excel.body.rows).toEqual([
      { line: 2, no: 10, name: '핑크프릴', price: 10000, text: '10\t핑크프릴\t10000' },
      { line: 4, error: 'PRICE_INVALID', text: '11\t라울\t8.5' },
      { line: 5, no: 12, name: '수식', price: 3000, text: '12\t수식\t3000' },
      { line: 6, no: 13, name: '2026-10-18', price: 5000, text: '13\t2026-10-18\t5000' },
      { line: 7, no: 14, name: '', price: 7000, text: '14\t\t7000' },
    ])
    // 빈 시트 → EMPTY
    expect((await preview(world, seller, b, fileBody('빈.xlsx', await xlsx([])))).body).toMatchObject({ error: 'EMPTY' })
  })

  it('파일 오류: 2MB 초과, .csv·.txt·.xlsx가 아님, 열리지 않는 .xlsx — 문장 그대로', async () => {
    const { world, seller, b } = await setup()
    const big = await preview(world, seller, b, fileBody('big.csv', new Uint8Array(IMPORT_FILE_MAX_BYTES + 1).fill(0x31)))
    expect(big.status).toBe(413)
    expect(big.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: '파일이 너무 커요(2MB까지).' })
    expect((await preview(world, seller, b, fileBody('list.xls', Buffer.from('a')))).body.error).toMatchObject({ code: 'FILE_TYPE', message: '엑셀(.xlsx)이나 CSV 파일을 골라 주세요.' })
    expect((await preview(world, seller, b, fileBody('list.xlsx', Buffer.from('not a zip')))).body.error).toMatchObject({ code: 'FILE_UNREADABLE', message: '파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.' })
    expect((await preview(world, seller, b, { text: '가'.repeat(200_001) })).status).toBe(413)
    expect((await preview(world, seller, b, { text: '1,a,1000', file: { name: 'a.csv', data: '' } })).status).toBe(400)
    expect((await preview(world, seller, b, {})).status).toBe(400)
    // 2MB 파일(base64 약 2.8MB)도 본문 상한 안이다
    const exact = await preview(world, seller, b, fileBody('ok.csv', new Uint8Array(IMPORT_FILE_MAX_BYTES).fill(0x31)))
    expect(exact.status, exact.text).toBe(200)
  })

  it('끝난 방송 → "끝난 방송에는 상품 목록을 가져올 수 없어요."(미리 보기·등록), 리허설 방송은 된다, 없는 방송·다른 판매자의 방송 → 404', async () => {
    const { world, seller, b } = await setup()
    const other = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    expect((await preview(world, seller, rehearsal.id, { text: '1,핑크,10000' })).status).toBe(200)
    expect((await register(world, seller, rehearsal.id, [{ no: 1, name: '핑크', price: 10000 }])).status).toBe(200)
    expect((await post(world, other, `/api/broadcasts/${b}/import/preview`, { text: '1,핑크,10000' })).status).toBe(404)
    expect((await register(world, other, b, [{ no: 1, name: '핑크', price: 10000 }])).status).toBe(404)
    expect((await preview(world, seller, 'b_nope', { text: '1,핑크,10000' })).status).toBe(404)
    await post(world, seller, `/api/broadcasts/${b}/end`, { requestId: rid('end') })
    for (const response of [await preview(world, seller, b, { text: '1,핑크,10000' }), await register(world, seller, b, [{ no: 1, name: '핑크', price: 10000 }])]) {
      expect(response.status).toBe(409)
      expect(response.body.error).toEqual({ code: 'BROADCAST_ENDED', message: '끝난 방송에는 상품 목록을 가져올 수 없어요.' })
    }
  })
})

describe('AC-I2-51 등록', () => {
  it('미리 보기에서 본 등록할 줄 → 한 트랜잭션에 줄 순서대로 product.register(READY, 조치자 = 로그인 계정), 등록한 수', async () => {
    const { world, seller, b, date } = await setup()
    const shown = (await preview(world, seller, b, { text: '번호,품종,가격\n15,핑크프릴,10\n16,,8.5\n17,라울,1만5천' })).body.rows as { no: number; name: string; price: number }[]
    const rows = shown.map(({ no, name, price }) => ({ no, name, price }))
    const response = await register(world, seller, b, rows)
    expect(response.status, response.text).toBe(200)
    expect(response.body).toMatchObject({ registered: 3 })
    const state = (await world.server.writer.read(seller.sellerId, date)).state
    expect(listProducts(state).map((p) => [p.no, p.name, p.price, p.status, p.stock])).toEqual([
      [15, '핑크프릴', 10000, 'READY', 1],
      [16, '', 8500, 'READY', 1],
      [17, '라울', 15000, 'READY', 1],
    ])
    const history = await client(world, seller.cookie).get(`/api/days/${date}/history`)
    const registers = (history.body.events as { type: string; actor: { kind: string; loginId: string | null } }[]).filter((event) => event.type === 'product.register')
    expect(registers.map((event) => event.actor)).toEqual(Array.from({ length: 3 }, () => ({ kind: 'account', loginId: seller.loginId })))
  })

  it('그 사이 바뀐 것(다른 기기가 같은 번호 등록·가격 50원·범위 밖 번호·목록 안 같은 번호·품종 전화번호)이 하나라도 있으면 아무것도 기록하지 않고 줄마다 문제', async () => {
    const { world, seller, b } = await setup()
    const rows = [
      { no: 1, name: '핑크', price: 10000 },
      { no: 2, name: '라울', price: 5000 },
    ]
    await ok(world, seller, { type: 'product.register', b, no: 2, name: '먼저 등록됨', price: 1000 })
    const events = await countRows(world.database, 'events')
    const changed = await register(world, seller, b, rows)
    expect(changed.status).toBe(409)
    expect(changed.body.error).toEqual({ code: 'IMPORT_CHANGED', message: '그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.', problems: [{ field: 'rows.1', message: '그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.' }] })
    for (const bad of [
      [{ no: 5, name: '싼', price: 50 }],
      [{ no: 1000, name: '큰', price: 1000 }],
      [{ no: 6, name: 'a', price: 1000 }, { no: 6, name: 'b', price: 1000 }],
      [{ no: 7, name: '김 010-1234-5678', price: 1000 }],
    ]) {
      expect((await register(world, seller, b, bad)).status, JSON.stringify(bad)).toBe(409)
    }
    expect(await countRows(world.database, 'events')).toBe(events)
  })

  it('형식이 틀린 줄(정수가 아님·정규화하지 않은 품종·키 더함·0개·501개) → 400, 같은 요청 번호 → 처음 결과(두 번 등록하지 않는다)', async () => {
    const { world, seller, b } = await setup()
    for (const rows of [[], [{ no: 1.5, name: 'a', price: 1000 }], [{ no: 1, name: ' a ', price: 1000 }], [{ no: 1, name: 'a', price: 1000, stock: 2 }], [{ no: 1, name: 'a', price: '1000' }], 'x', Array.from({ length: 501 }, (_, i) => ({ no: i + 1, name: 'a', price: 1000 }))]) {
      expect((await register(world, seller, b, rows)).status).toBe(400)
    }
    const requestId = rid('same')
    const rows = Array.from({ length: 5 }, (_, i) => ({ no: i + 1, name: `품종${String(i)}`, price: 1000 }))
    const first = await register(world, seller, b, rows, requestId)
    const second = await register(world, seller, b, [{ no: 9, name: '다른', price: 1000 }], requestId)
    expect(first.body).toMatchObject({ registered: 5 })
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    const state = (await world.server.writer.read(seller.sellerId, '2026-10-19')).state
    expect(listProducts(state)).toHaveLength(5)
  })

  it('등록한 상품은 공개 전이다: 채팅 찜은 공개 전엔 보류(R-5)이고 공개하면 판정된다', async () => {
    const { world, seller, b, date } = await setup()
    expect((await register(world, seller, b, [{ no: 15, name: '핑크', price: 10000 }])).status).toBe(200)
    await chat(world, seller, b, 'm1', 'UC_A', '홍길동', '15')
    let view = (await client(world, seller.cookie).get(`/api/days/${date}`)).body
    expect((view.claims as { status: string }[]).map((claim) => claim.status)).toEqual(['PENDING'])
    await ok(world, seller, { type: 'product.open', b, no: 15 })
    view = (await client(world, seller.cookie).get(`/api/days/${date}`)).body
    expect((view.claims as { status: string }[]).map((claim) => claim.status)).toEqual(['CONFIRMED'])
  })

  it('성능: 500줄 미리 보기 1초 안, 등록 2초 안', async () => {
    const { world, seller, b } = await setup({ settings: { 'claim.maxNumber': 999 } })
    const text = Array.from({ length: 500 }, (_, i) => `${String(i + 1)}\t품종 ${String(i)}\t${String(1000 + i)}원`).join('\n')
    let started = performance.now()
    const shown = await preview(world, seller, b, { text })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(shown.body.register).toBe(500)
    const rows = (shown.body.rows as { no: number; name: string; price: number }[]).map(({ no, name, price }) => ({ no, name, price }))
    started = performance.now()
    const done = await register(world, seller, b, rows)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(done.body).toMatchObject({ registered: 500 })
  }, 60_000)

  it('로그인 없으면 401, 가져오기 글·파일 내용은 로그에 남지 않는다', async () => {
    const { world, seller, b } = await setup()
    expect((await client(world, null).post(`/api/broadcasts/${b}/import/preview`, { text: '1,a,1000' })).status).toBe(401)
    await preview(world, seller, b, { text: '1,비밀품종,1000\n,,' })
    await preview(world, seller, b, fileBody('x.xlsx', Buffer.from('비밀파일')))
    const { formatLog } = await import('../src/log.ts')
    const logs = world.logs.map(formatLog).join('\n')
    expect(logs).not.toContain('비밀')
  })
})
