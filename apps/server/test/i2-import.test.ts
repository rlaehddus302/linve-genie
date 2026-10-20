// AC-I2-51 상품 목록 가져오기 — 미리 보기·등록 (PRD-05, R-18, D-I2-09)
import { listProducts } from '@livejjim/core'
import { crc32, deflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { IMPORT_FILE_MAX_BYTES, IMPORT_PREVIEW_BODY_LIMIT_BYTES, IMPORT_REGISTER_BODY_LIMIT_BYTES, XLSX_LIMITS, importRegisterBodyBytes, readXlsxRowsBounded, scanXlsxZip } from '../src/import-files.ts'
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

/** 손으로 만든 zip (저장·deflate) — 압축률이 큰 항목·잘린 파일처럼 엑셀이 만들지 않는 파일을 시험한다 */
function zip(entries: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const body = entry.store === true ? entry.data : deflateRawSync(entry.data)
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.store === true ? 0 : 8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.store === true ? 0 : 8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** 시트 XML(행들)로 .xlsx를 만든다 (엑셀이 여는 가장 작은 꾸러미) + 덧붙일 항목 */
function rawXlsx(sheets: string[], extra: { name: string; data: Buffer }[] = []): Buffer {
  const names = sheets.map((_, i) => `<sheet name="S${String(i + 1)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('')
  const rels = sheets.map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join('')
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`) },
    ...sheets.map((rows, i) => ({ name: `xl/worksheets/sheet${String(i + 1)}.xml`, data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`) })),
    ...extra,
  ])
}
const xmlRow = (r: number, cells: [string, string][]) => `<row r="${String(r)}">${cells.map(([column, value]) => `<c r="${column}${String(r)}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`

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

  it('RA-I2-004: .xlsx는 압축을 푼 크기·시트 수 상한 안에서만 연다 — 2MB 안의 압축 폭탄·시트 수백 개는 쉬운 문장(413), 잘린 zip은 읽지 못함', async () => {
    const { world, seller, b } = await setup()
    const good = rawXlsx([xmlRow(1, [['A', '15'], ['B', '핑크'], ['C', '10000']])])
    expect(scanXlsxZip(good)).toEqual({ ok: true })
    expect((await preview(world, seller, b, fileBody('작은.xlsx', good))).body.rows).toEqual([{ line: 1, no: 15, name: '핑크', price: 10000, text: '15\t핑크\t10000' }])
    // 같은 글자만 반복한 큰 항목: 풀면 64MB, 압축하면 수십 KB
    const bomb = rawXlsx([xmlRow(1, [['A', '15'], ['B', '핑크'], ['C', '10000']])], [{ name: 'xl/media/pad.bin', data: Buffer.alloc(64 * 1024 * 1024, 0x41) }])
    expect(bomb.byteLength).toBeLessThan(IMPORT_FILE_MAX_BYTES)
    expect(scanXlsxZip(bomb)).toEqual({ ok: false, reason: 'tooBig' })
    const tooBig = await preview(world, seller, b, fileBody('폭탄.xlsx', bomb))
    expect(tooBig.status).toBe(413)
    expect(tooBig.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: '파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요.' })
    // 첫 시트가 크면(압축을 푼 시트 XML이 상한을 넘으면) 마찬가지
    const hugeSheet = rawXlsx([`${xmlRow(1, [['A', '1'], ['B', '핑크'], ['C', '1000']])}<!--${'A'.repeat(XLSX_LIMITS.unzippedBytes)}-->`])
    expect(hugeSheet.byteLength).toBeLessThan(IMPORT_FILE_MAX_BYTES)
    expect(scanXlsxZip(hugeSheet)).toEqual({ ok: false, reason: 'tooBig' })
    // 시트 수 상한
    const sheets = rawXlsx(Array.from({ length: XLSX_LIMITS.sheets + 1 }, () => xmlRow(1, [['A', '1']])))
    expect(scanXlsxZip(sheets)).toEqual({ ok: false, reason: 'tooBig' })
    expect((await preview(world, seller, b, fileBody('시트많음.xlsx', sheets))).status).toBe(413)
    // 잘린 zip·zip이 아닌 파일은 읽지 못함
    expect(scanXlsxZip(good.subarray(0, good.byteLength - 30))).toEqual({ ok: false, reason: 'unreadable' })
    const cut = await preview(world, seller, b, fileBody('잘림.xlsx', good.subarray(0, 200)))
    expect(cut.body.error).toMatchObject({ code: 'FILE_UNREADABLE', message: '파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.' })
    // 판정은 그대로 된다 (서버가 멈추거나 죽지 않았다)
    expect((await register(world, seller, b, [{ no: 15, name: '핑크', price: 10000 }])).status).toBe(200)
  }, 120_000)

  it('RA-I2-004: 칸은 32칸까지만 글로 만들고(그 뒤 글은 하나만 — 결과 CELLS는 같다), 상품 줄 500을 넘는 것이 확실하면 더 읽지 않는다(TOO_MANY)', async () => {
    const { world, seller, b } = await setup()
    // 둘째 행: 맨 끝 열(XFD)에 글 — 칸 16384개를 만들지 않고 CELLS
    const wide = rawXlsx([xmlRow(1, [['A', '15'], ['B', '핑크'], ['C', '10000']]) + xmlRow(2, [['A', '16'], ['B', '라울'], ['C', '8000'], ['XFD', '메모']]) + xmlRow(3, [['A', '17'], ['B', '로라'], ['C', '9000']])])
    const read = await readXlsxRowsBounded(wide)
    expect(read.ok && read.rows.map((row) => row.cells.length)).toEqual([3, XLSX_LIMITS.columns + 1, 3])
    const shown = await preview(world, seller, b, fileBody('넓음.xlsx', wide))
    expect((shown.body.rows as { line: number; error?: string }[]).map((row) => [row.line, row.error ?? null])).toEqual([
      [1, null],
      [2, 'CELLS'],
      [3, null],
    ])
    // 1만 행 — 502행만 읽고 TOO_MANY
    const many = rawXlsx([Array.from({ length: 10_000 }, (_, i) => xmlRow(i + 1, [['A', String(i + 1)], ['B', '핑크'], ['C', '1000']])).join('')])
    const manyRead = await readXlsxRowsBounded(many)
    expect(manyRead.ok && manyRead.rows.length).toBe(XLSX_LIMITS.rows)
    expect((await preview(world, seller, b, fileBody('많음.xlsx', many))).body).toMatchObject({ error: 'TOO_MANY', rows: [] })
  }, 120_000)

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

  it('SA-I2-001: 미리 보기가 받은 목록은 늘 등록 본문 상한 안 — 200,000글자를 거의 채운 500줄(품종 글자마다 4바이트)도 등록된다', async () => {
    const { world, seller, b } = await setup({ settings: { 'claim.maxNumber': 999 } })
    // 줄마다 "번호\t품종\t1000" — 품종은 이모지(UTF-8 4바이트) 385글자, 전체 글은 200,000글자 안
    const name = '🌵'.repeat(385)
    const text = Array.from({ length: 500 }, (_, i) => `${String(i + 1)}\t${name}\t1000`).join('\n')
    expect([...text].length).toBeLessThanOrEqual(200_000)
    const shown = await preview(world, seller, b, { text })
    expect(shown.status, shown.text.slice(0, 200)).toBe(200)
    expect([shown.body.register, shown.body.problems]).toEqual([500, 0])
    const rows = (shown.body.rows as { no: number; name: string; price: number }[]).map(({ no, name: n, price }) => ({ no, name: n, price }))
    const body = { requestId: rid('imp'), rows }
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(700_000)
    const done = await post(world, seller, `/api/broadcasts/${b}/import`, body)
    expect(done.status, done.text.slice(0, 200)).toBe(200)
    expect(done.body).toMatchObject({ registered: 500 })
    // 다른 쓰기 경로의 본문 상한(64KB)은 그대로
    const other = await post(world, seller, `/api/broadcasts/${b}/end`, { requestId: rid('end'), pad: 'x'.repeat(70 * 1024) })
    expect(other.status).toBe(413)
  }, 60_000)

  it('SA-I2-007: 2MB 안의 .csv는 글자 수를 따로 세지 않는다 — 품종 JSON이 가장 커지는 파일(EUC-KR로 읽지 못한 바이트 = U+FFFD 3바이트, UTF-8 역슬래시 = 2바이트)도 미리 보기 "500개 등록하기" → 같은 줄 등록', async () => {
    const { world, seller } = await setup({ settings: { 'claim.maxNumber': 999 } })
    const fill = (byte: number): Buffer => {
      const lines: Buffer[] = []
      for (let i = 1; i <= 500; i++) lines.push(Buffer.concat([Buffer.from(`${String(i)},`), Buffer.alloc(4184, byte), Buffer.from(',1000\n')]))
      return Buffer.concat(lines)
    }
    for (const [fileName, bytes, factor] of [
      ['읽지못함.csv', fill(0xff), 3],
      ['역슬래시.txt', fill(0x5c), 2],
    ] as const) {
      expect(bytes.byteLength).toBeLessThanOrEqual(IMPORT_FILE_MAX_BYTES)
      // 파일마다 새 방송 (같은 번호 1~500)
      const b = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
      const shown = await preview(world, seller, b, fileBody(fileName, bytes))
      expect(shown.status, shown.text.slice(0, 200)).toBe(200)
      expect([shown.body.register, shown.body.problems]).toEqual([500, 0])
      const rows = (shown.body.rows as { no: number; name: string; price: number }[]).map(({ no, name, price }) => ({ no, name, price }))
      const body = { requestId: rid('imp'), rows }
      // 등록 본문은 파일 바이트의 2~3배 — 미리 보기가 잰 크기와 같고, 등록 상한 안이다
      const size = Buffer.byteLength(JSON.stringify(body))
      expect(size).toBeGreaterThan(bytes.byteLength * (factor - 0.1))
      expect(size).toBeLessThanOrEqual(importRegisterBodyBytes(rows))
      expect(importRegisterBodyBytes(rows)).toBeLessThanOrEqual(IMPORT_REGISTER_BODY_LIMIT_BYTES)
      const done = await post(world, seller, `/api/broadcasts/${b}/import`, body)
      expect(done.status, done.text.slice(0, 200)).toBe(200)
      expect(done.body).toMatchObject({ registered: 500 })
    }
  }, 120_000)

  it('SA-I2-007: 등록 본문 크기 = 화면이 보내는 { requestId, rows } JSON의 UTF-8 바이트(가장 긴 요청 번호), 상한을 넘는 본문은 할 일을 적은 문장(413)', async () => {
    const samples: { no: number; name: string; price: number }[][] = [
      [],
      [{ no: 1, name: '', price: 100 }],
      [
        { no: 15, name: '핑크"프릴\\ 🌵', price: 10000 },
        { no: 16, name: '라울 금 가́', price: 8000 },
        { no: 999, name: '�'.repeat(10), price: 9_007_199_254_740_991 },
      ],
    ]
    for (const rows of samples) expect(importRegisterBodyBytes(rows)).toBe(Buffer.byteLength(JSON.stringify({ requestId: 'r'.repeat(64), rows })))
    const { world, seller, b } = await setup()
    // 등록 본문 상한을 넘으면 — 미리 보기에서 본 목록이면 생기지 않는다
    const huge = await post(world, seller, `/api/broadcasts/${b}/import`, { requestId: rid('imp'), rows: [{ no: 1, name: '가'.repeat(Math.ceil(IMPORT_REGISTER_BODY_LIMIT_BYTES / 3) + 10), price: 1000 }] })
    expect(huge.status).toBe(413)
    expect(huge.body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: '등록할 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요.' })
    // 미리 보기 본문 상한(3MB)을 넘으면 — 화면은 2MB 넘는 파일을 올리기 전에 막는다
    const big = await preview(world, seller, b, { text: 'x'.repeat(IMPORT_PREVIEW_BODY_LIMIT_BYTES) })
    expect(big.status).toBe(413)
    expect(big.body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: '보낸 내용이 너무 커요. 파일은 2MB까지, 붙여 넣은 글은 200,000글자까지 가져올 수 있어요.' })
  }, 60_000)

  it('SA-I2-001: .xlsx 칸 글도 붙여 넣은 글처럼 200,000글자까지 — 넘으면 쉬운 문장(413), 안이면 미리 보기·등록이 된다', async () => {
    const { world, seller, b } = await setup({ settings: { 'claim.maxNumber': 999 } })
    const long = await preview(world, seller, b, fileBody('긴.xlsx', await xlsx(Array.from({ length: 500 }, (_, i) => [i + 1, '가'.repeat(400), 1000]))))
    expect(long.status).toBe(413)
    expect(long.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: '파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요.' })
    const fits = await preview(world, seller, b, fileBody('맞음.xlsx', await xlsx(Array.from({ length: 500 }, (_, i) => [i + 1, '가'.repeat(380), 1000]))))
    expect(fits.status, fits.text.slice(0, 200)).toBe(200)
    expect(fits.body.register).toBe(500)
    const rows = (fits.body.rows as { no: number; name: string; price: number }[]).map(({ no, name, price }) => ({ no, name, price }))
    expect((await register(world, seller, b, rows)).body).toMatchObject({ registered: 500 })
  }, 60_000)

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
