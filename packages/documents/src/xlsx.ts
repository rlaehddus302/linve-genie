// 엑셀 판매대장 파일 (STL-06, D-208, NFR-06): 시트 하나 "판매대장", 첫 줄 = 열 이름 11개(틀 고정).
// 상품 번호·가격은 수 칸(가격 서식 #,##0), 나머지는 글 칸, 빈 값은 빈 칸. 글 값은 늘 글 칸이다 —
// `=`·`+`·`-`·`@`로 시작하는 닉네임·품종도 수식이 되지 않는다(파일을 연 판매자 PC에서 실행되지 않게).
// I2 (D-I2-03, TD-P2-003): 글 칸에는 엑셀이 받지 않는 글자(제어 글자·U+FFFE·U+FFFF·짝 없는 서로게이트)를 빼고 쓴다 — 한 글자 때문에 파일 전체가 열리지 않으면 대장을 못 쓴다.
import ExcelJS from 'exceljs'
// O3 (D-O3-07): 옵션 방송이 든 대장은 `품종` 뒤에 옵션·수량·단가를 더한 14열 — 수량·단가도 수 칸(단가는 가격 서식).
import { LEDGER_SHEET_NAME, hasOptionColumns, ledgerColumns, ledgerRowValuesWith, type LedgerRow } from './ledger.ts'
import { stripXlsxForbidden } from './text.ts'

const PLAIN = { numbers: new Set([3, 5]), money: new Set([5]), widths: [12, 14, 10, 22, 12, 24, 10, 20, 10, 10, 10] }
const WITH_OPTIONS = { numbers: new Set([3, 6, 7, 8]), money: new Set([7, 8]), widths: [12, 14, 10, 22, 16, 8, 12, 12, 24, 10, 20, 10, 10, 10] }

/**
 * 행 → .xlsx 바이트. options = 옵션 칸을 둘지(buildLedger 결과의 options — 날짜마다 따로 만든 행을 이어 붙였으면 그중 하나라도 옵션이면 true).
 * 넘기지 않으면 행 중 하나라도 옵션 칸이 있으면 둔다
 */
export async function ledgerToXlsx(rows: readonly LedgerRow[], options: boolean = rows.some(hasOptionColumns)): Promise<Uint8Array> {
  const layout = options ? WITH_OPTIONS : PLAIN
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '라이브찜'
  const sheet = workbook.addWorksheet(LEDGER_SHEET_NAME, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] })
  layout.widths.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width
  })
  const header = sheet.addRow([...ledgerColumns(options)])
  header.font = { bold: true }
  for (const row of rows) {
    const values = ledgerRowValuesWith(row, options)
    const added = sheet.addRow([])
    values.forEach((value, i) => {
      const column = i + 1
      if (value === '') return // 빈 값은 빈 칸
      const cell = added.getCell(column)
      if (layout.numbers.has(column) && typeof value === 'number') {
        cell.value = value
        if (layout.money.has(column)) cell.numFmt = '#,##0'
        return
      }
      // 글 값은 글 칸으로만 — 수식 객체로 넣지 않는다. 금지 글자를 빼서 비면 빈 칸
      const text = stripXlsxForbidden(String(value))
      if (text !== '') cell.value = text
    })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = buffer as unknown as ArrayBuffer | Uint8Array
  return bytes instanceof Uint8Array ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : new Uint8Array(bytes)
}
