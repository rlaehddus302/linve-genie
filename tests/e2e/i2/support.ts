// I2 E2E 공용 도우미 (test-e2e). S06b 도우미를 그대로 쓰고 정산 마무리(확인서·판매대장·포장·가져오기·설정)용을 더한다.
// 선택자는 역할·이름 기반 — dev-notes "dev-web 화면 계약"과 acceptance.md의 따옴표 문장.
import { createRequire } from 'node:module'
import { expect, type Download, type Page } from '@playwright/test'
import { openNewBroadcast, postJson, registerApi, smsApi, writeEvent } from '../s06b/support.ts'

export * from '../s06b/support.ts'

export const SHOP_DEFAULT = { name: '시험 가게', bank: '', accountNumber: '', accountHolder: '', accountNote: '' }

/** 가게 설정을 처음 값으로 되돌린다 (다른 시험이 "시험 가게"를 본다) */
export async function resetShop(page: Page): Promise<void> {
  const res = await page.request.put('/api/shop', { data: SHOP_DEFAULT, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
}

export interface PackingItemView { key: string; broadcast: string; title: string; no: number; name: string; price: number }
export interface PackingEntryView { buyer: string; name: string; phoneLast4: string | null; payment: string; items: PackingItemView[]; status: string; invoice: string | null; add: PackingItemView[]; remove: { key: string; no: number }[] }

export async function packingList(page: Page, date: string): Promise<PackingEntryView[]> {
  const res = await page.request.get(`/api/days/${date}/packing`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { entries: PackingEntryView[] }).entries
}

export async function packingCommand(page: Page, date: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  return await postJson(page, `/api/days/${date}/packing`, { requestId: crypto.randomUUID(), ...body })
}

/** 실제 범위 하나: 방송(제목) + 상품 + 문자찜(전화번호마다 한 구매자). 구매자 ID 목록을 전화번호 순으로 돌려준다 */
export async function realDay(
  page: Page,
  opts: { date: string; title?: string; products: { no: number; name: string; price: number }[]; claims: { no: number; phone?: string; memo?: string }[] },
): Promise<{ b: string; buyers: Map<string, string> }> {
  const b = await openNewBroadcast(page, { date: opts.date, rehearsal: false, title: opts.title ?? '1부' })
  for (const p of opts.products) await registerApi(page, b, p.no, p.name, p.price)
  const buyers = new Map<string, string>()
  for (const c of opts.claims) {
    const body = await smsApi(page, { b, no: c.no, ...(c.phone === undefined ? {} : { phone: c.phone }), ...(c.memo === undefined ? {} : { memo: c.memo }) })
    const key = c.phone ?? c.memo ?? String(c.no)
    if (!buyers.has(key)) {
      const view = await (await page.request.get(`/api/days/${opts.date}`)).json() as { claims: { no: number; currentBuyer: string; seq: number }[] }
      const mine = view.claims.filter((x) => x.no === c.no).sort((x, y) => y.seq - x.seq)[0]
      if (mine === undefined) throw new Error(`찜 ${String(c.no)} 없음: ${JSON.stringify(body)}`)
      buyers.set(key, mine.currentBuyer)
    }
  }
  return { b, buyers }
}

export async function pay(page: Page, date: string, buyer: string, amount: number): Promise<void> {
  const res = await writeEvent(page, { type: 'settlement.payment', buyer, date, amount }, { date, rehearsal: false })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** 내려받기 파일의 바이트 */
export async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path()
  const { readFile } = await import('node:fs/promises')
  return await readFile(path)
}

/** PNG 머리의 가로·세로 */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const documentsRequire = createRequire(createRequire(import.meta.url).resolve('@livejjim/documents'))

/** PDF 쪽 수 (문서 패키지와 같은 pdf-lib로 읽는다) */
export async function pdfPages(bytes: Buffer): Promise<number> {
  const { PDFDocument } = documentsRequire('pdf-lib') as { PDFDocument: { load: (bytes: Uint8Array) => Promise<{ getPageCount: () => number }> } }
  return (await PDFDocument.load(bytes)).getPageCount()
}

interface ExcelSheet {
  columnCount: number
  eachRow: (opts: { includeEmpty: boolean }, fn: (row: { getCell: (i: number) => { value: unknown } }) => void) => void
  addRow: (values: unknown[]) => void
}
interface ExcelLib {
  Workbook: new () => { worksheets: ExcelSheet[]; addWorksheet: (name: string) => ExcelSheet; xlsx: { load: (b: Uint8Array) => Promise<unknown>; writeBuffer: () => Promise<ArrayBuffer> } }
}

/** 엑셀 첫 시트의 행(칸 글) — 문서 패키지와 같은 exceljs로 읽는다 */
export async function xlsxRows(bytes: Buffer): Promise<string[][]> {
  const book = new (documentsRequire('exceljs') as ExcelLib).Workbook()
  await book.xlsx.load(bytes)
  const sheet = book.worksheets[0]!
  const out: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    for (let i = 1; i <= sheet.columnCount; i++) {
      const v = row.getCell(i).value
      cells.push(v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    out.push(cells)
  })
  return out
}

/** 엑셀 파일 바이트 만들기 (가져오기 시험용) */
export async function makeXlsx(rows: (string | number | null)[][]): Promise<Buffer> {
  const book = new (documentsRequire('exceljs') as ExcelLib).Workbook()
  const sheet = book.addWorksheet('목록')
  for (const r of rows) sheet.addRow(r)
  return Buffer.from(await book.xlsx.writeBuffer())
}
