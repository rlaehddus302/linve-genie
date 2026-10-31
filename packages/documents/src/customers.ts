// 손님 엑셀 (CUSTOMER_RULES CR-6, AC-KP1-12·13): 시트 "손님", 누적 큰 순, 기본 9열 + (고를 때만) 연락처 6열.
// 글 칸은 판매대장과 같은 글자 빼기(stripXlsxForbidden) 뒤, 수식으로 읽힐 수 있는 글(`= + - @`로 시작)은 앞에 `'`.
import ExcelJS from 'exceljs'
import { SERVICE_NAME } from './brand.ts'
import { stripXlsxForbidden } from './text.ts'

export const CUSTOMERS_SHEET_NAME = '손님'
export const CUSTOMER_COLUMNS = ['이름', '종류', '누적 구매(원)', '구매 횟수', '마지막 구매일', '미입금 횟수', '단골', '입금 늦음 주의', '메모'] as const
export const CUSTOMER_CONTACT_COLUMNS = ['받는 분', '연락처', '주소', '상세 주소', '우편번호', '장부 보관 끝나는 날'] as const

export interface CustomerXlsxContact {
  readonly recipient?: string
  readonly phone?: string
  readonly address?: string
  readonly addressDetail?: string
  readonly zip?: string
  /** YYYY-MM-DD */
  readonly keepUntil?: string
}

export interface CustomerXlsxRow {
  readonly name: string
  /** 예: "유튜브", "문자 · 끝자리 1234" */
  readonly kind: string
  readonly totalWon: number
  readonly purchaseCount: number
  /** YYYY-MM-DD, 없으면 빈칸 */
  readonly lastPurchaseDate?: string | null
  readonly unpaidCount: number
  readonly regular: boolean
  readonly lateWarning: boolean
  readonly memo?: string | null
  readonly contact?: CustomerXlsxContact | null
}

export interface CustomersXlsxInput {
  /** 받는 날(KST) YYYY-MM-DD — 파일 이름용 */
  readonly date: string
  readonly rows: readonly CustomerXlsxRow[]
  readonly includeContact: boolean
}

export interface CustomersXlsxResult {
  readonly fileName: string
  readonly bytes: Uint8Array
}

/** 수식 막기: 글자 빼기 뒤 `= + - @`로 시작하면 앞에 `'` */
export function safeCustomerText(value: string | null | undefined): string {
  const text = stripXlsxForbidden(value ?? '')
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

const WIDTHS = [20, 22, 14, 10, 14, 12, 8, 14, 30]
const CONTACT_WIDTHS = [14, 16, 36, 20, 10, 18]

export async function buildCustomersXlsx(input: CustomersXlsxInput): Promise<CustomersXlsxResult> {
  const sorted = input.rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.totalWon - a.row.totalWon || a.index - b.index)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = SERVICE_NAME
  const sheet = workbook.addWorksheet(CUSTOMERS_SHEET_NAME, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] })
  const columns = input.includeContact ? [...CUSTOMER_COLUMNS, ...CUSTOMER_CONTACT_COLUMNS] : [...CUSTOMER_COLUMNS]
  ;(input.includeContact ? [...WIDTHS, ...CONTACT_WIDTHS] : WIDTHS).forEach((width, i) => {
    sheet.getColumn(i + 1).width = width
  })
  sheet.addRow(columns).font = { bold: true }
  const mark = (flag: boolean): string => (flag ? '예' : '')
  for (const { row } of sorted) {
    const values: (string | number)[] = [
      safeCustomerText(row.name),
      safeCustomerText(row.kind),
      Math.trunc(row.totalWon),
      Math.trunc(row.purchaseCount),
      safeCustomerText(row.lastPurchaseDate),
      Math.trunc(row.unpaidCount),
      mark(row.regular),
      mark(row.lateWarning),
      safeCustomerText(row.memo),
    ]
    if (input.includeContact) {
      const c = row.contact
      values.push(...[c?.recipient, c?.phone, c?.address, c?.addressDetail, c?.zip, c?.keepUntil].map((v) => safeCustomerText(v)))
    }
    const added = sheet.addRow([])
    values.forEach((value, i) => {
      if (value === '') return
      const cell = added.getCell(i + 1)
      cell.value = value
      if (typeof value === 'number' && i === 2) cell.numFmt = '#,##0'
    })
  }
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer | Uint8Array
  const bytes = buffer instanceof Uint8Array ? new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)) : new Uint8Array(buffer)
  return { fileName: `손님-${input.date}.xlsx`, bytes }
}
