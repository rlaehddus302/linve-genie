import ExcelJS from 'exceljs'
import { stripXlsxForbidden } from '@livejjim/documents'
import type { FullView } from '../../web/src/api/types.ts'
import { fromFull } from '../../web/src/lib/scope-data.ts'
import { BuyerNames } from '../../web/src/lib/derive.ts'
import { broadcastSales, statementColumns, statementRows, type StatementTab } from '../../web/src/lib/broadcast-sales.ts'
import { orderCsv } from './orders.ts'

export async function statementFile(view: FullView, broadcast: string, shop: string, tab: StatementTab, format: 'csv' | 'xlsx', hideSuffix: boolean) {
  const data = fromFull(view)
  const sales = broadcastSales(data.claims, data.products, broadcast)
  const names = new BuyerNames(data.buyers, data.claims, hideSuffix)
  const cols = statementColumns(tab)
  const lines = statementRows(sales, tab, id => names.name(id)).map(row => [
    ...(row.no === null ? [] : [row.no]), row.label, row.money ?? '금액 확인 필요', row.qty,
  ])
  const mode = tab === 'buyers' ? '구매자별' : '상품별'
  const totals = ['총계', ...(tab === 'products' ? [''] : []), sales.total ?? '금액 확인 필요', sales.qty]
  const rows = [['정산 내역서', mode], ['가게명', shop], ['방송 날짜', view.date], cols, ...lines, totals]
  if (format === 'csv') return orderCsv(rows.map(row => row.map(String)))
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(mode, { views: [{ state: 'frozen', ySplit: 4 }] })
  const widths = tab === 'products' ? [10, 34, 20, 10] : [34, 20, 10]
  widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width })
  for (const [index, values] of rows.entries()) {
    const row = sheet.addRow(values.map(v => typeof v === 'string' ? stripXlsxForbidden(v) : v))
    if (index < 3) continue
    row.getCell(cols.length).alignment = { horizontal: 'center' }
    row.getCell(cols.length - 1).numFmt = '#,##0"원"'
    if (index === 3 || index === rows.length - 1) row.eachCell(cell => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0E6F5' } }
    })
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
