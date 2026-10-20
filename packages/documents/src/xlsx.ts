// 엑셀 판매대장 파일 (STL-06, D-208, NFR-06): 시트 하나 "판매대장", 첫 줄 = 열 이름 11개(틀 고정).
// 상품 번호·가격은 수 칸(가격 서식 #,##0), 나머지는 글 칸, 빈 값은 빈 칸. 글 값은 늘 글 칸이다 —
// `=`·`+`·`-`·`@`로 시작하는 닉네임·품종도 수식이 되지 않는다(파일을 연 판매자 PC에서 실행되지 않게).
import ExcelJS from 'exceljs'
import { LEDGER_COLUMNS, LEDGER_SHEET_NAME, ledgerRowValues, type LedgerRow } from './ledger.ts'

const NUMBER_COLUMNS = new Set([3, 5])
const PRICE_COLUMN = 5
const COLUMN_WIDTHS = [12, 14, 10, 22, 12, 24, 10, 20, 10, 10, 10]

/** 행 → .xlsx 바이트 */
export async function ledgerToXlsx(rows: readonly LedgerRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '라이브찜'
  const sheet = workbook.addWorksheet(LEDGER_SHEET_NAME, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] })
  COLUMN_WIDTHS.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width
  })
  const header = sheet.addRow([...LEDGER_COLUMNS])
  header.font = { bold: true }
  for (const row of rows) {
    const values = ledgerRowValues(row)
    const added = sheet.addRow([])
    values.forEach((value, i) => {
      const column = i + 1
      if (value === '') return // 빈 값은 빈 칸
      const cell = added.getCell(column)
      if (NUMBER_COLUMNS.has(column) && typeof value === 'number') {
        cell.value = value
        if (column === PRICE_COLUMN) cell.numFmt = '#,##0'
        return
      }
      // 글 값은 글 칸으로만 — 수식 객체로 넣지 않는다
      cell.value = String(value)
    })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = buffer as unknown as ArrayBuffer | Uint8Array
  return bytes instanceof Uint8Array ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : new Uint8Array(bytes)
}
