import ExcelJS from 'exceljs'
import { stripXlsxForbidden } from '@livejjim/documents'
import type { FullView } from '../../web/src/api/types.ts'
import { fromFull } from '../../web/src/lib/scope-data.ts'
import { BuyerNames } from '../../web/src/lib/derive.ts'
import {
  broadcastSales, joinSales, lineNoWord, orderName, statementAccount, statementColumns, statementRows, statementTotals,
  type StatementInfo, type StatementJoinGroup, type StatementTab,
} from '../../web/src/lib/broadcast-sales.ts'
import { orderCsv } from './orders.ts'

/** 그 날짜 정산서에 줄이 있는 구매자 (확정 찜의 지금의 구매자) — 정산서 손님 합치기(D-STMT-JOIN-01)가 번호를 볼 구매자 */
export function statementBuyersOf(view: FullView): string[] {
  const data = fromFull(view)
  const out = new Set<string>()
  for (const claim of data.claims.values()) if (claim.status === 'CONFIRMED') out.add(claim.currentBuyer)
  return [...out]
}

type Cell = string | number
const NEED = '금액 확인 필요'

async function writeFile(rows: readonly (readonly Cell[])[], format: 'csv' | 'xlsx', sheetName: string, layout: { widths: readonly number[]; head: number; money: number | null; qty: number | null; bold: readonly number[] }) {
  if (format === 'csv') return orderCsv(rows.map(row => row.map(String)))
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: layout.head + 1 }] })
  layout.widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width })
  for (const [index, values] of rows.entries()) {
    const row = sheet.addRow(values.map(v => typeof v === 'string' ? stripXlsxForbidden(v) : v))
    if (index < layout.head) continue
    if (layout.qty !== null) row.getCell(layout.qty).alignment = { horizontal: 'center' }
    if (layout.money !== null) row.getCell(layout.money).numFmt = '#,##0"원"'
    if (layout.bold.includes(index)) row.eachCell(cell => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0E6F5' } }
    })
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** broadcasts: 정산서에 담을 라이브 — 합친 라이브(D-MERGE-LIVE-01)면 묶음의 라이브 모두(그날 시작 순서), 번호 칸은 "1차 12". joins: 한 장으로 보일 구매자 묶음 */
export async function statementFile(view: FullView, broadcasts: string | readonly string[], shop: string, tab: StatementTab, format: 'csv' | 'xlsx', hideSuffix: boolean, joins: readonly StatementJoinGroup[] = []) {
  const data = fromFull(view)
  const sales = joinSales(broadcastSales(data.claims, data.products, broadcasts), joins)
  const names = new BuyerNames(data.buyers, data.claims, hideSuffix)
  const cols = statementColumns(tab)
  const lines = statementRows(sales, tab, id => names.name(id)).map(row => [
    ...(row.no === null ? [] : [row.round ? `${row.round} ${String(row.no)}` : row.no]), row.label, row.money ?? NEED, row.qty,
  ])
  const mode = tab === 'buyers' ? '구매자별' : '상품별'
  const totals = ['총계', ...(tab === 'products' ? [''] : []), sales.total ?? NEED, sales.qty]
  const rows = [['정산 내역서', mode], ['가게명', shop], ['방송 날짜', view.date], cols, ...lines, totals]
  return writeFile(rows, format, mode, { widths: tab === 'products' ? [10, 34, 20, 10] : [34, 20, 10], head: 3, money: cols.length - 1, qty: cols.length, bold: [3, rows.length - 1] })
}

/**
 * 구매자 한 명(합친 정산서면 묶음 하나)의 정산서 파일 (D-STMT-EACH-01): 앱 구매자 정산서·사진과 같은 셈 — 상품 줄 → 상품 금액 → 배송비(받는 설정이면) → 총액 → 입금 안내.
 * buyer는 정산서 줄 키(대표 구매자). 정산서에 없는 구매자면 null. 휴대폰 번호·주소(손님)는 넣지 않는다
 */
export async function buyerStatementFile(view: FullView, broadcasts: string | readonly string[], shop: string, buyer: string, info: StatementInfo, format: 'csv' | 'xlsx', hideSuffix: boolean, joins: readonly StatementJoinGroup[] = []) {
  const data = fromFull(view)
  const sales = joinSales(broadcastSales(data.claims, data.products, broadcasts), joins)
  const order = sales.orders.find(row => row.id === buyer)
  if (order === undefined) return null
  const names = new BuyerNames(data.buyers, data.claims, hideSuffix)
  const { charged, shipping, total } = statementTotals(order.subtotal, info.shipping)
  const account = statementAccount(info)
  const head: Cell[][] = [['정산서', `${orderName(order, id => names.name(id))} 님`], ['가게명', shop], ['방송 날짜', view.date]]
  if (info.hostName.trim() !== '') head.push(['방송 이름', info.hostName.trim()])
  const cols = ['번호', '상품명', '개수', '금액']
  const lines = order.lines.map(line => [lineNoWord(line), [line.name, line.variant].filter(Boolean).join(' '), line.qty, line.amount ?? NEED])
  const money: Cell[][] = [['', '상품 금액', '', order.subtotal ?? NEED]]
  if (charged) money.push(['', '배송비', '', shipping === 0 ? '무료' : (shipping ?? NEED)])
  const totalRow = ['총액', '', order.qty, total ?? NEED]
  const tail: Cell[][] = []
  if (account !== null) tail.push(['입금 계좌', account])
  if (info.phone.trim() !== '') tail.push(['전화번호', info.phone.trim()])
  const rows: Cell[][] = [...head, cols, ...lines, ...money, totalRow, ...tail]
  const colsAt = head.length
  const totalAt = colsAt + 1 + lines.length + money.length
  return writeFile(rows, format, '정산서', { widths: [12, 34, 10, 18], head: colsAt, money: 4, qty: 3, bold: [colsAt, totalAt] })
}
