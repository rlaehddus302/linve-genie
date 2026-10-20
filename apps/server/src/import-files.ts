// 상품 목록 파일 읽기 (PRD-05 세부, I2 D-I2-09, AC-I2-51): .csv·.txt → 글, .xlsx → 첫 시트의 행마다 칸 글 목록.
// - .csv·.txt: UTF-8(맨 앞 BOM 허용)로 읽고, 올바른 UTF-8이 아니면 EUC-KR(CP949 — 한국어 윈도우 엑셀이 저장한 CSV)로 읽는다.
// - .xlsx: 첫 시트의 행마다 칸 값을 글로 — 수 = 쉼표 없는 십진수(10000·8.5), 수식 = 저장된 계산 값, 날짜 = YYYY-MM-DD, 빈 칸 = 빈 글. 줄 번호 = 행 번호.
// - 파일 내용은 로그에 남기지 않는다(AC-I2-81). 2MB를 넘는 파일은 읽지 않는다.
// - .xlsx 칸 글도 붙여 넣은 글과 같은 200,000글자 상한이다(행을 탭 글로 이은 길이 — SA-I2-001): 미리 보기가 받은 목록의 등록 본문이 늘 등록 본문 상한 안에 든다.
// - .xlsx는 판매자가 올린 압축 파일이다(RA-I2-004): 2MB 파일도 풀면 수백 MB가 될 수 있다. 그래서 먼저 zip 목록을 직접 읽고 항목마다 상한을 건 채 풀어 본다
//   (압축을 푼 크기 합·항목 수·시트 수). 넘으면 읽지 않는다. 행은 상품 줄 500을 넘는 것이 확실해지면(빈칸 아닌 행 502개) 더 읽지 않고, 칸은 처음 32칸까지만
//   글로 만든다(그 뒤에 글이 있으면 그중 하나만 — 해석 결과(CELLS)는 같다). 이 읽기는 작업 워커(work-worker.ts)에서 시간·메모리 상한을 걸고 돈다.
import { inflateRawSync } from 'node:zlib'
import { normalizeText } from '@livejjim/core'
import ExcelJS from 'exceljs'
import type { SheetRow } from './product-import.ts'

export const IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024
export const IMPORT_TEXT_MAX_CHARS = 200_000

export const IMPORT_FILE_MESSAGES = {
  tooLarge: '파일이 너무 커요(2MB까지).',
  type: '엑셀(.xlsx)이나 CSV 파일을 골라 주세요.',
  unreadable: '파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.',
  textTooLong: '붙여 넣은 글이 너무 길어요(200,000글자까지).',
  /** .xlsx 칸 글이 200,000글자를 넘음 (SA-I2-001) */
  sheetTooLong: '파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요.',
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

/** 행들을 탭 글로 이은 길이 (코드 포인트 — 붙여 넣은 글의 200,000글자와 같은 셈: 칸 사이 탭·줄 사이 줄바꿈 포함) */
export function sheetTextLength(rows: readonly SheetRow[]): number {
  let length = 0
  for (const row of rows) {
    length += row.cells.length // 칸 사이 탭 (칸 수 - 1) + 줄바꿈 1
    for (const cell of row.cells) {
      length += cell.length
      // 짝을 이룬 서로게이트는 한 글자
      for (let i = 0; i < cell.length - 1; i++) {
        const code = cell.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = cell.charCodeAt(i + 1)
          if (next >= 0xdc00 && next <= 0xdfff) {
            length--
            i++
          }
        }
      }
    }
  }
  return length
}

/** .xlsx 읽기 상한 (RA-I2-004) */
export const XLSX_LIMITS = {
  /** 압축을 푼 크기 합 */
  unzippedBytes: 16 * 1024 * 1024,
  /** zip 항목 수 */
  entries: 2000,
  /** 시트 수 */
  sheets: 64,
  /** 행마다 글로 만드는 칸 수 */
  columns: 32,
  /** 빈칸이 아닌 행을 이만큼 읽으면 멈춘다 (머리글 1 + 상품 줄 500을 넘음 = TOO_MANY가 확실) */
  rows: 502,
} as const

export type XlsxReadResult = { readonly ok: true; readonly rows: SheetRow[] } | { readonly ok: false; readonly reason: 'unreadable' | 'tooLong' | 'tooBig' }

/**
 * zip 목록을 직접 읽어 항목마다 풀어 본다 (중앙 디렉터리 → 로컬 머리 → 저장·deflate만). 압축을 푼 크기 합·항목 수·시트 수가 상한을 넘으면 tooBig,
 * zip이 아니거나 암호·zip64·모르는 압축이면 unreadable. 풀 때 상한을 넘으면 바로 멈춘다(선언된 크기를 믿지 않는다)
 */
export function scanXlsxZip(bytes: Uint8Array, limits: Pick<typeof XLSX_LIMITS, 'unzippedBytes' | 'entries' | 'sheets'> = XLSX_LIMITS): { ok: true } | { ok: false; reason: 'unreadable' | 'tooBig' } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  try {
    // 끝 디렉터리 기록 (주석이 붙을 수 있어 뒤에서 찾는다)
    let eocd = -1
    for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
      if (u32(at) === 0x06054b50) {
        eocd = at
        break
      }
    }
    if (eocd < 0) return { ok: false, reason: 'unreadable' }
    const count = u16(eocd + 10)
    const directoryOffset = u32(eocd + 16)
    if (count === 0xffff || directoryOffset === 0xffffffff) return { ok: false, reason: 'unreadable' }
    if (count > limits.entries) return { ok: false, reason: 'tooBig' }
    let at = directoryOffset
    let budget = limits.unzippedBytes
    let sheets = 0
    for (let index = 0; index < count; index++) {
      if (u32(at) !== 0x02014b50) return { ok: false, reason: 'unreadable' }
      const flags = u16(at + 8)
      const method = u16(at + 10)
      const compressed = u32(at + 20)
      const nameLength = u16(at + 28)
      const extraLength = u16(at + 30)
      const commentLength = u16(at + 32)
      const local = u32(at + 42)
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
      at += 46 + nameLength + extraLength + commentLength
      if ((flags & 0x1) !== 0 || compressed === 0xffffffff || local === 0xffffffff) return { ok: false, reason: 'unreadable' }
      if (/^xl\/worksheets\/[^/]+\.xml$/.test(name) && ++sheets > limits.sheets) return { ok: false, reason: 'tooBig' }
      if (u32(local) !== 0x04034b50) return { ok: false, reason: 'unreadable' }
      const dataStart = local + 30 + u16(local + 26) + u16(local + 28)
      if (dataStart + compressed > bytes.byteLength) return { ok: false, reason: 'unreadable' }
      const data = bytes.subarray(dataStart, dataStart + compressed)
      let size: number
      if (method === 0) size = compressed
      else if (method === 8) {
        try {
          size = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).byteLength
        } catch (error) {
          if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return { ok: false, reason: 'tooBig' }
          return { ok: false, reason: 'unreadable' }
        }
      } else return { ok: false, reason: 'unreadable' }
      budget -= size
      if (budget < 0) return { ok: false, reason: 'tooBig' }
    }
    return { ok: true }
  } catch {
    // 범위를 벗어난 자리(잘린 파일)
    return { ok: false, reason: 'unreadable' }
  }
}

/**
 * .xlsx 바이트 → 첫 시트의 행 (칸이 없는 행은 빠진다 — 해석기가 빈 줄처럼 건너뛴다). 작업 워커에서 부른다.
 * 열리지 않으면 unreadable, 압축을 푼 크기·항목·시트 상한을 넘으면 tooBig, 행을 탭 글로 이은 길이가 200,000글자를 넘으면 tooLong
 */
export async function readXlsxRowsBounded(bytes: Uint8Array): Promise<XlsxReadResult> {
  const scanned = scanXlsxZip(bytes)
  if (!scanned.ok) return scanned
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const sheet = workbook.worksheets[0]
  if (sheet === undefined) return { ok: true, rows: [] }
  const rows: SheetRow[] = []
  let filled = 0
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (filled >= XLSX_LIMITS.rows) return
    const cells: string[] = []
    const last = Math.min(row.cellCount, XLSX_LIMITS.columns)
    for (let column = 1; column <= last; column++) cells.push(cellText(row.getCell(column).value))
    if (row.cellCount > XLSX_LIMITS.columns) {
      // 넷째 칸부터 빈 칸은 지우고 남은 칸 수를 보므로(R-18 2), 상한 뒤 칸은 빈칸이 아닌 것 하나만 있으면 결과가 같다
      let extra: string | null = null
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        if (extra !== null || column <= XLSX_LIMITS.columns) return
        const text = cellText(cell.value)
        if (normalizeText(text) !== '') extra = text
      })
      if (extra !== null) cells.push(extra)
    }
    if (cells.some((cell) => normalizeText(cell) !== '')) filled++
    rows.push({ line: rowNumber, cells })
  })
  if (filled < XLSX_LIMITS.rows && sheetTextLength(rows) > IMPORT_TEXT_MAX_CHARS) return { ok: false, reason: 'tooLong' }
  return { ok: true, rows }
}
