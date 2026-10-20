// 상품 목록 파일 읽기 (PRD-05 세부, I2 D-I2-09, AC-I2-51): .csv·.txt → 글, .xlsx → 첫 시트의 행마다 칸 글 목록.
// - .csv·.txt: UTF-8(맨 앞 BOM 허용)로 읽고, 올바른 UTF-8이 아니면 EUC-KR(CP949 — 한국어 윈도우 엑셀이 저장한 CSV)로 읽는다.
// - .xlsx: 첫 시트의 행마다 칸 값을 글로 — 수 = 쉼표 없는 십진수(10000·8.5), 수식 = 저장된 계산 값, 날짜 = YYYY-MM-DD, 빈 칸 = 빈 글. 줄 번호 = 행 번호.
// - 파일 내용은 로그에 남기지 않는다(AC-I2-81). 2MB를 넘는 파일은 읽지 않는다.
import ExcelJS from 'exceljs'
import type { SheetRow } from './product-import.ts'

export const IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024
export const IMPORT_TEXT_MAX_CHARS = 200_000

export const IMPORT_FILE_MESSAGES = {
  tooLarge: '파일이 너무 커요(2MB까지).',
  type: '엑셀(.xlsx)이나 CSV 파일을 골라 주세요.',
  unreadable: '파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.',
  textTooLong: '붙여 넣은 글이 너무 길어요(200,000글자까지).',
} as const

export type ImportFileKind = 'text' | 'xlsx'

/** 파일 이름의 확장자로 종류를 정한다 (.csv·.txt → 글, .xlsx → 엑셀, 그 밖은 null) */
export function importFileKind(name: string): ImportFileKind | null {
  const lower = name.trim().toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'text'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  return null
}

/** .csv·.txt 바이트 → 글 (UTF-8 — 맨 앞 BOM은 지운다, 올바르지 않으면 EUC-KR) */
export function decodeTextFile(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** 칸 값 → 글 (PRD-05 세부) */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) {
    // 엑셀 날짜는 시간대가 없는 값 — exceljs는 UTC로 만든다
    return Number.isNaN(value.getTime()) ? '' : `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('result' in record || 'formula' in record || 'sharedFormula' in record) return cellText(record.result)
    if (Array.isArray(record.richText)) return (record.richText as { text?: unknown }[]).map((part) => (typeof part.text === 'string' ? part.text : '')).join('')
    if (typeof record.text === 'string') return record.text
    if (typeof record.error === 'string') return record.error
  }
  return ''
}

/** .xlsx 바이트 → 첫 시트의 행 (칸이 없는 행은 빠진다 — 해석기가 빈 줄처럼 건너뛴다). 열리지 않으면 null */
export async function readXlsxRows(bytes: Uint8Array): Promise<SheetRow[] | null> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  } catch {
    return null
  }
  const sheet = workbook.worksheets[0]
  if (sheet === undefined) return []
  const rows: SheetRow[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = []
    for (let column = 1; column <= row.cellCount; column++) cells.push(cellText(row.getCell(column).value))
    rows.push({ line: rowNumber, cells })
  })
  return rows
}
