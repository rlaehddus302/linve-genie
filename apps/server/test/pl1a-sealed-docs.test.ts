// PL1A 봉인 날짜의 문서·포장·지난 구매 (D-I2-22 (2)·(3), D-PL1-03, D-PL1-04): AC-PL1A-10~17
// 같은 서버 시각(가짜 시계)으로 봉인 직전에 받은 응답·파일과 봉인 뒤에 받은 것을 비교한다 — 봉인 작업(Sealer)을 실제로 돌린다.
import { rmSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { LEDGER_OPTION_COLUMNS } from '@livejjim/documents'
import { checkReplay } from '../src/check-replay.ts'
import { sha256Hex } from '../src/secrets.ts'
import { LEDGER_FORMAT, readLedger } from '../src/youtube/seal.ts'
import { getFile, kst, pack, post } from './i2-support.ts'
import { A, AFTER_SEAL, B, LOOKER_NICK, LOOKER_TEXT, X, Y, scenario, scopeRowOf, sealA, tempDirs, type Scenario } from './pl1a-support.ts'
import { addSeller, client, createBroadcast, rid, writeEvent, type TestServer } from './support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SEALED_TEXT = '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.'
const UNREADABLE_TEXT = '30일이 지나 봉인한 기록을 읽지 못했어요. 운영자에게 알려 주세요.'

interface Snapshot {
  readonly json: Record<string, unknown>
  readonly files: Record<string, Uint8Array>
}

/** 판매대장 엑셀 → 시트마다 행(셀 값) */
async function sheetRows(bytes: Uint8Array): Promise<Record<string, unknown[][]>> {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const out: Record<string, unknown[][]> = {}
  book.eachSheet((sheet) => {
    const rows: unknown[][] = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows.push(Array.from((row.values as unknown[]).slice(1), (value) => (value === undefined || value === null ? '' : value)))
    })
    out[sheet.name] = rows
  })
  return out
}

/** A의 문서·포장·지난 구매 전부 (같은 시각) */
async function collect(world: TestServer, cookie: string, buyers: readonly string[]): Promise<Snapshot> {
  const api = client(world, cookie)
  const json: Record<string, unknown> = {}
  const files: Record<string, Uint8Array> = {}
  const file = async (name: string, path: string) => {
    const response = await getFile(world, cookie, path)
    expect(response.status, `${name} ${new TextDecoder().decode(response.bytes).slice(0, 200)}`).toBe(200)
    expect(response.bytes.length, name).toBeGreaterThan(0)
    files[name] = response.bytes
  }
  for (const buyer of buyers) {
    const receipt = await api.get(`/api/days/${A}/receipt?buyer=${encodeURIComponent(buyer)}`)
    expect(receipt.status, receipt.text).toBe(200)
    json[`receipt:${buyer}`] = receipt.body
    const label = await api.get(`/api/days/${A}/packing-label?buyer=${encodeURIComponent(buyer)}`)
    expect(label.status, label.text).toBe(200)
    json[`label:${buyer}`] = label.body
    for (let page = 1; page <= (label.body.pages as number); page++) await file(`label.png:${buyer}:${String(page)}`, `/api/days/${A}/packing-label.png?buyer=${encodeURIComponent(buyer)}&page=${String(page)}`)
    await file(`label.pdf:${buyer}`, `/api/days/${A}/packing-label.pdf?buyer=${encodeURIComponent(buyer)}`)
  }
  await file('receipts.pdf', `/api/days/${A}/receipts.pdf`)
  await file('receipts.zip', `/api/days/${A}/receipts.zip`)
  const receiptBuyers = await api.get(`/api/days/${A}/receipt-buyers`)
  expect(receiptBuyers.status, receiptBuyers.text).toBe(200)
  json.receiptBuyers = receiptBuyers.body
  const packing = await api.get(`/api/days/${A}/packing`)
  expect(packing.status, packing.text).toBe(200)
  json.packing = packing.body
  const past = await api.get(`/api/days/${B}/past?buyer=${X}`)
  expect(past.status, past.text).toBe(200)
  json.past = past.body
  await file('ledger:A', `/api/ledger.xlsx?from=${A}&to=${A}`)
  await file('ledger:AB', `/api/ledger.xlsx?from=${A}&to=${B}`)
  await file('ledger:all', `/api/export/ledger.xlsx`)
  return { json, files }
}

async function sealedWorld(): Promise<{ s: Scenario; before: Snapshot; after: Snapshot; buyers: string[] }> {
  const s = await scenario()
  s.world.clock.set(AFTER_SEAL)
  const buyers = [X, Y, s.sms]
  const before = await collect(s.world, s.seller.cookie, buyers)
  await sealA(s.world)
  const after = await collect(s.world, s.seller.cookie, buyers)
  return { s, before, after, buyers }
}

let shared: Promise<Awaited<ReturnType<typeof sealedWorld>>> | null = null
const world = () => (shared ??= sealedWorld())

describe('AC-PL1A-10·13·14 봉인 직전과 같다 — 확인서·포장 목록·포장 라벨·지난 구매', () => {
  it('확인서 데이터(구매자마다)·전원 PDF·그림 묶음·구매자 목록이 봉인 직전과 바이트·JSON이 같다. 옵션 판매의 옵션 글·수량·찜 금액도 같다', async () => {
    const { before, after, buyers } = await world()
    expect((await scopeRowOf((await world()).s.world, (await world()).s.seller, A))?.sealed_at).not.toBeNull()
    for (const buyer of buyers) expect(after.json[`receipt:${buyer}`], buyer).toEqual(before.json[`receipt:${buyer}`])
    expect(after.json.receiptBuyers).toEqual(before.json.receiptBuyers)
    expect(Buffer.from(after.files['receipts.pdf'] as Uint8Array).equals(Buffer.from(before.files['receipts.pdf'] as Uint8Array))).toBe(true)
    expect(Buffer.from(after.files['receipts.zip'] as Uint8Array).equals(Buffer.from(before.files['receipts.zip'] as Uint8Array))).toBe(true)
    // 옵션 판매 (D-O3-12): 품종 칸에 옵션 글·수량, 찜 금액
    const lines = (after.json[`receipt:${Y}`] as { lines: { name: string; price: number }[] }).lines
    expect(lines.map((line) => [line.name, line.price])).toEqual([
      ['반바지 M', 10000],
      ['반팔티 105/검정색 (17,000원 × 2개)', 34000],
    ])
  })

  it('포장 목록(상태 말·송장·품목)·포장 라벨 데이터·PNG 쪽마다·PDF가 같다. 봉인 뒤 포장 목록에만 sealed: true', async () => {
    const { before, after, buyers } = await world()
    const { sealed, ...rest } = after.json.packing as Record<string, unknown>
    expect(sealed).toBe(true)
    expect(Object.hasOwn(before.json.packing as object, 'sealed')).toBe(false)
    expect(rest).toEqual(before.json.packing)
    const status = new Map(((rest.entries as { buyer: string; status: string; invoice: string | null }[]) ?? []).map((entry) => [entry.buyer, [entry.status, entry.invoice]]))
    expect(status.get(X)).toEqual(['배송 완료', '123456789012'])
    expect(status.get(Y)).toEqual(['포장 대기', null])
    for (const buyer of buyers) {
      expect(after.json[`label:${buyer}`], buyer).toEqual(before.json[`label:${buyer}`])
      for (const name of Object.keys(before.files).filter((key) => key.startsWith('label.'))) {
        expect(Buffer.from(after.files[name] as Uint8Array).equals(Buffer.from(before.files[name] as Uint8Array)), name).toBe(true)
      }
    }
  })

  it('B에서 본 X의 지난 구매가 같다 — A의 항목(날짜·상품·금액·입금 상태)이 그대로 있다', async () => {
    const { before, after } = await world()
    expect(after.json.past).toEqual(before.json.past)
    const items = (after.json.past as { items: { date: string; items: unknown[]; total: number; payment: string }[] }).items
    expect(items.map((item) => item.date)).toEqual([A])
    expect(items[0]?.items.length).toBeGreaterThan(0)
  })
})

describe('AC-PL1A-11·12 판매대장 — 봉인 날짜의 "찜 시각"만 빈칸', () => {
  it('그날·기간·전체 판매대장의 시트·열·행 수·행 순서·셀 값이 같다 — A의 행 "찜 시각"만 빈칸, B의 행은 그대로', async () => {
    const { before, after } = await world()
    for (const name of ['ledger:A', 'ledger:AB', 'ledger:all']) {
      const b = await sheetRows(before.files[name] as Uint8Array)
      const a = await sheetRows(after.files[name] as Uint8Array)
      expect(Object.keys(a), name).toEqual(Object.keys(b))
      for (const sheet of Object.keys(b)) {
        const rowsBefore = b[sheet] as unknown[][]
        const rowsAfter = a[sheet] as unknown[][]
        expect(rowsAfter.length, name).toBe(rowsBefore.length)
        const header = rowsBefore[0] as string[]
        // 옵션 방송이 든 대장 — 옵션 열 시트 (D-O3-07)
        expect(header).toEqual([...LEDGER_OPTION_COLUMNS])
        const at = header.indexOf('찜 시각')
        const day = header.indexOf('방송 날짜')
        const status = header.indexOf('상태')
        let sealedRows = 0
        for (let i = 1; i < rowsBefore.length; i++) {
          const rb = rowsBefore[i] as unknown[]
          const ra = rowsAfter[i] as unknown[]
          if (rb[day] === A && rb[status] === '1등') {
            sealedRows++
            expect(rb[at], `${name} ${String(i)}`).not.toBe('')
            expect(ra[at], `${name} ${String(i)}`).toBe('')
            expect([...ra.slice(0, at), ...ra.slice(at + 1)]).toEqual([...rb.slice(0, at), ...rb.slice(at + 1)])
          } else {
            expect(ra, `${name} ${String(i)}`).toEqual(rb)
          }
        }
        expect(sealedRows, name).toBeGreaterThan(3)
      }
    }
  })

  it('새로 봉인한 장부는 livejjim-ledger/2이고, 판매대장 "찜 시각"은 장부의 확정 시각으로 채우지 않는다. /1 장부로 봉인한 날짜도 같은 대장 행(수량 1·찜 금액 = 가격)', async () => {
    const { s } = await world()
    const row = await scopeRowOf(s.world, s.seller, A)
    const ledger = JSON.parse(row?.ledger ?? '{}') as { format: string; sales: { confirmedAt: string | null; qty: number }[] }
    expect(ledger.format).toBe(LEDGER_FORMAT)
    expect(LEDGER_FORMAT).toBe('livejjim-ledger/2')
    expect(ledger.sales.some((sale) => sale.confirmedAt !== null)).toBe(true)
    // /1 장부: 옵션 판매가 없는 다른 판매자의 날짜를 봉인한 뒤 장부를 판 1 모양(판매의 key·variant·options·qty·amount 없음, 상품의 variants 없음)으로 바꾼다
    const other = await addSeller(s.world)
    const day = '2026-09-02'
    s.world.clock.set(kst(day, '20:00:00'))
    const b = await createBroadcast(s.world, other, { date: day, title: '판1' })
    expect((await writeEvent(s.world, other, { type: 'product.register', b: b.id, no: 1, name: '판1상품', price: 4000 })).status).toBe(200)
    s.world.clock.set(kst(day, '20:00:05'))
    expect((await s.world.server.ingestChat(other.sellerId, { b: b.id, id: 'v1', ch: 'UC_V1', nick: '판일손님', text: '1' })).status).toBe('recorded')
    s.world.clock.set(kst('2026-10-02', '00:00:01'))
    expect(await s.world.server.sealer.runOnce()).toBe(1)
    const v1Before = await getFile(s.world, other.cookie, `/api/ledger.xlsx?from=${day}&to=${day}`)
    expect(v1Before.status).toBe(200)
    const stored = await scopeRowOf(s.world, other, day)
    const parsed = JSON.parse(stored?.ledger ?? '{}') as Record<string, unknown>
    const v1 = {
      ...parsed,
      format: 'livejjim-ledger/1',
      sales: (parsed.sales as Record<string, unknown>[]).map(({ key: _k, variant: _v, options: _o, qty: _q, amount: _a, ...rest }) => rest),
      products: (parsed.products as Record<string, unknown>[]).map(({ variants: _v, ...rest }) => rest),
    }
    const text = JSON.stringify(v1)
    expect(readLedger(text)).not.toBeNull()
    await s.world.database.pglite?.query(`update scopes set ledger = $1, ledger_digest = $2 where id = $3`, [text, sha256Hex(text), stored?.id])
    const v1After = await getFile(s.world, other.cookie, `/api/ledger.xlsx?from=${day}&to=${day}`)
    expect(v1After.status, new TextDecoder().decode(v1After.bytes).slice(0, 200)).toBe(200)
    const rows = (await sheetRows(v1After.bytes))['판매대장'] as unknown[][]
    expect(rows).toEqual((await sheetRows(v1Before.bytes))['판매대장'])
    // 옵션 방송이 없는 날짜 — O3 전 11열, 찜 시각 빈칸
    expect(rows[1]).toEqual([day, '판1', 1, '판1상품', 4000, '판일손님', '유튜브', '', '1등', '미입금', '포장 대기'])
  })
})

describe('AC-PL1A-16 봉인 날짜의 쓰기는 409', () => {
  it('포장 완료·포장 취소·배송 완료·배송 취소·포장 라벨 B1 출력·택배 접수·취소·확인서 공유 링크(한 명·전원) → 409 SEALED, 기록·작업·링크·알림 없음. 형식 오류는 먼저 400, 끊기·조회는 받는다', async () => {
    const { s } = await world()
    const { world: w, seller, sms } = s
    const pg = w.database.pglite
    const counts = async () => {
      const q = async (table: string) => (await pg?.query<{ n: number }>(`select count(*)::int as n from ${table} where seller_id = $1`, [seller.sellerId]))?.rows[0]?.n
      return { packing: await q('packing_records'), jobs: await q('print_jobs'), labels: await q('print_labels'), parcels: await q('parcels'), links: await q('receipt_links'), linkRequests: (await pg?.query<{ n: number }>(`select count(*)::int as n from receipt_link_requests where seller_id = $1 and kind <> 'REVOKE'`, [seller.sellerId]))?.rows[0]?.n, printRequests: await q('print_requests') }
    }
    const before = await counts()
    const publish = vi.spyOn(w.server.hub, 'publishNamed')
    const expectSealed = async (label: string, promise: Promise<{ status: number; body: Record<string, unknown>; text: string }>) => {
      const response = await promise
      expect(response.status, `${label} ${response.text}`).toBe(409)
      expect(response.body.error, label).toEqual({ code: 'SEALED', message: SEALED_TEXT })
    }
    await expectSealed('포장 완료(품목)', pack(w, seller, A, { buyer: Y, action: 'pack', items: [{ key: 'x/1', qty: 1 }] }))
    await expectSealed('포장 취소', pack(w, seller, A, { buyer: sms, action: 'unpack' }))
    await expectSealed('배송 완료', pack(w, seller, A, { buyer: sms, action: 'ship', invoice: '998877665544' }))
    await expectSealed('배송 취소', pack(w, seller, A, { buyer: X, action: 'unship' }))
    await expectSealed('B1 출력', post(w, seller, '/api/print/packing', { requestId: rid('pp'), date: A, buyer: X }))
    await expectSealed('택배 접수', post(w, seller, `/api/parcels/days/${A}/book`, { requestId: rid('bk'), items: [{ buyer: Y }] }))
    await expectSealed('택배 취소', post(w, seller, `/api/parcels/days/${A}/cancel`, { requestId: rid('cn'), buyer: X }))
    await expectSealed('링크 한 명', post(w, seller, `/api/days/${A}/receipt-links`, { requestId: rid('ln'), buyer: X }))
    await expectSealed('링크 전원', post(w, seller, `/api/days/${A}/receipt-links/all`, { requestId: rid('la') }))
    // 라벨이 꺼져 있어도 봉인이 먼저
    expect((await client(w, seller.cookie).put('/api/settings/labels', { enabled: false })).status).toBe(200)
    await expectSealed('B1 출력(라벨 꺼짐)', post(w, seller, '/api/print/packing', { requestId: rid('pp'), date: A, buyer: X }))
    expect((await client(w, seller.cookie).put('/api/settings/labels', { enabled: true })).status).toBe(200)
    // 입력 형식 오류는 지금처럼 먼저
    expect((await pack(w, seller, A, { buyer: Y, action: 'nope' })).status).toBe(400)
    expect((await post(w, seller, '/api/print/packing', { requestId: rid('pp'), date: 'x', buyer: X })).status).toBe(400)
    // 끊기·조회는 받는다
    expect((await post(w, seller, `/api/days/${A}/receipt-links/revoke`, { requestId: rid('rv'), buyer: X })).status).toBe(200)
    expect((await client(w, seller.cookie).get(`/api/days/${A}/receipt-links`)).status).toBe(200)
    const afterCounts = await counts()
    expect(JSON.stringify(afterCounts)).toBe(JSON.stringify(before))
    expect(publish.mock.calls.filter((call) => call[1] === 'packing' || call[1] === 'parcel')).toEqual([])
    publish.mockRestore()
    // B(봉인 전)는 지금처럼
    expect((await post(w, seller, `/api/days/${B}/receipt-links`, { requestId: rid('ln'), buyer: X })).status).toBe(200)
  })
})

describe('AC-PL1A-17 봉인 날짜 응답에 원문·번호 키가 없다', () => {
  it('문서·포장·지난 구매의 JSON·PDF 글자·엑셀 셀에 A의 채팅 글·산 적 없는 시청자 이름·전화번호 키·전화번호 전체가 없다. 다른 판매자는 404', async () => {
    const { s, after } = await world()
    const keys = ((await s.world.database.pglite?.query<{ body: string }>(`select body from events where seller_id = $1 and type = 'sms'`, [s.seller.sellerId]))?.rows ?? [])
      .map((row) => (JSON.parse(row.body) as { phoneKey?: string }).phoneKey)
      .filter((key): key is string => typeof key === 'string')
    expect(keys.length).toBeGreaterThan(0)
    const texts: string[] = [JSON.stringify(after.json)]
    for (const name of ['ledger:A', 'ledger:AB', 'ledger:all']) texts.push(JSON.stringify(await sheetRows(after.files[name] as Uint8Array)))
    const { pdfPageTexts } = await import('../../../packages/documents/test/helpers.ts')
    for (const name of Object.keys(after.files).filter((key) => key.endsWith('.pdf') || key.startsWith('label.pdf'))) texts.push(JSON.stringify(await pdfPageTexts(after.files[name] as Uint8Array)))
    const all = texts.join('\n')
    for (const needle of [LOOKER_TEXT, LOOKER_NICK, ...keys, '010-1234-5678', '01012345678']) expect(all, needle).not.toContain(needle)
    const stranger = await addSeller(s.world)
    for (const path of [`/api/days/${A}/receipt?buyer=${X}`, `/api/days/${A}/packing`, `/api/days/${A}/packing-label?buyer=${X}`, `/api/days/${A}/receipts.pdf`]) {
      expect((await client(s.world, stranger.cookie).get(path)).status, path).toBe(404)
    }
  })
})

describe('AC-PL1A-15 읽을 수 없는 장부', () => {
  for (const kind of ['모르는 판', '판 2인데 amount 없음'] as const) {
    it(`${kind}: 문서·대장(그날·기간·전체)·포장 목록·포장 라벨은 500 LEDGER_UNREADABLE, 지난 구매는 A만 빠진다, 판매 쓰기는 그대로`, async () => {
      const s = await scenario()
      s.world.clock.set(AFTER_SEAL)
      await sealA(s.world)
      const row = await scopeRowOf(s.world, s.seller, A)
      const parsed = JSON.parse(row?.ledger ?? '{}') as Record<string, unknown>
      const broken =
        kind === '모르는 판'
          ? { ...parsed, format: 'livejjim-ledger/9' }
          : { ...parsed, sales: (parsed.sales as Record<string, unknown>[]).map(({ amount: _a, ...rest }, i) => (i === 0 ? rest : { ...rest, amount: _a })) }
      const text = JSON.stringify(broken)
      await s.world.database.pglite?.query(`update scopes set ledger = $1, ledger_digest = $2 where id = $3`, [text, sha256Hex(text), row?.id])
      s.world.logs.splice(0)
      const api = client(s.world, s.seller.cookie)
      for (const path of [
        `/api/days/${A}/receipt?buyer=${X}`,
        `/api/days/${A}/receipts.pdf`,
        `/api/days/${A}/receipts.zip`,
        `/api/days/${A}/receipt-buyers`,
        `/api/ledger.xlsx?from=${A}&to=${A}`,
        `/api/ledger.xlsx?from=${A}&to=${B}`,
        `/api/export/ledger.xlsx`,
        `/api/days/${A}/packing`,
        `/api/days/${A}/packing-label?buyer=${X}`,
        `/api/days/${A}/packing-label.pdf?buyer=${X}`,
      ]) {
        const response = await api.get(path)
        expect(response.status, path).toBe(500)
        expect(response.body.error, path).toEqual({ code: 'LEDGER_UNREADABLE', message: UNREADABLE_TEXT })
      }
      const logs = s.world.logs.filter((log) => log.code === 'LEDGER_UNREADABLE')
      expect(logs.length).toBeGreaterThan(0)
      for (const log of logs) expect(log).toEqual({ level: 'error', code: 'LEDGER_UNREADABLE', date: A })
      s.world.logs.splice(0)
      const past = await api.get(`/api/days/${B}/past?buyer=${X}`)
      expect(past.status).toBe(200)
      expect((past.body.items as { date: string }[]).map((item) => item.date)).toEqual([])
      expect(s.world.logs.filter((log) => log.code === 'LEDGER_UNREADABLE')).toEqual([{ level: 'error', code: 'LEDGER_UNREADABLE', date: A }])
      // 판매 쓰기(B의 찜·입금)는 그대로
      expect((await s.world.server.ingestChat(s.seller.sellerId, { b: s.bBroadcast, id: 'b2', ch: 'UC_NEW', nick: '새손님', text: '3' })).status).toBe('recorded')
      expect((await writeEvent(s.world, s.seller, { type: 'settlement.payment', buyer: X, date: B, amount: 1000 }, B)).status).toBe(200)
    })
  }
})

describe('AC-PL1A-20 봉인 안 한 날짜는 그대로', () => {
  it('B의 포장 목록에는 sealed 칸이 없고, 재생 검사가 통과한다(A는 장부 대조)', async () => {
    const { s } = await world()
    const packing = await client(s.world, s.seller.cookie).get(`/api/days/${B}/packing`)
    expect(packing.status).toBe(200)
    expect(Object.hasOwn(packing.body, 'sealed')).toBe(false)
    const checks = await checkReplay(s.world.database.db, { sellerId: s.seller.sellerId })
    expect(checks.map((check) => [check.date, check.rehearsal, check.ok, check.sealed])).toEqual([
      [A, false, true, true],
      [B, false, true, false],
      [B, true, true, false],
    ])
  })
})
