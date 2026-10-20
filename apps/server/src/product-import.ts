// 상품 목록 가져오기 해석 (PRD-05, DOMAIN_RULES R-18, D-I2-09). 붙여 넣은 표 글(엑셀 복사·CSV) → 머리글 줄·줄마다 등록할 값 또는 문제.
// - 순수 함수다: @livejjim/core만 import하고 시계·난수·파일·DB·네트워크를 쓰지 않는다. 넘긴 값을 바꾸지 않는다.
// - 어떤 입력에도 예외를 던지지 않는다(문자열이 아니면 EMPTY). 시간은 입력 길이에 비례한다 — 줄·칸 나누기는 한 번씩 훑고,
//   정규화·금액·휴대폰 번호 판단은 코어 normalizeText·parseAmount·containsPhoneRun을 다시 쓴다(빠른 입력과 결과가 갈라지지 않게).
// - 미리 보기와 등록(그 순간 상태로 다시 검사)이 같은 규칙을 쓴다. 골든 러너(코어 시험 코드)가 이 함수를 상대 경로로 부른다(D-209와 같은 연결).
// - .xlsx는 서버가 첫 시트의 행마다 칸 글 목록을 만들어 parseProductRows에 넘긴다(R-18 2의 정규화·빈 칸 지우기부터 같은 규칙, 줄 번호 = 행 번호).
import { DEFAULT_SETTINGS, containsPhoneRun, normalizeText, parseAmount } from '@livejjim/core'

/** 줄마다의 문제 (R-18 9의 순서) */
export const IMPORT_ROW_ERRORS = ['CELLS', 'NUMBER_INVALID', 'DUPLICATE', 'EXISTS', 'NAME_CONTROL', 'NAME_PHONE', 'PRICE_MISSING', 'PRICE_INVALID', 'PRICE_TOO_LOW'] as const
export type ImportRowError = (typeof IMPORT_ROW_ERRORS)[number]
/** 전체 문제 (R-18 10) */
export type ImportListError = 'EMPTY' | 'TOO_MANY'

export type ImportRow = { readonly line: number; readonly no: number; readonly name: string; readonly price: number } | { readonly line: number; readonly error: ImportRowError }

export type ImportResult = { readonly header: number | null; readonly rows: readonly ImportRow[] } | { readonly error: ImportListError }

export interface ImportSettings {
  /** 그 방송의 설정 스냅샷 price.unit (없거나 틀리면 기본값) */
  readonly unit?: unknown
  /** 그 방송의 설정 스냅샷 claim.maxNumber (정수 1~9999, 없거나 틀리면 기본값) */
  readonly maxNumber?: unknown
  /** 그 방송에 이미 있는 상품 번호 (판매 종료 포함) */
  readonly existing?: unknown
}

/** 상품 줄 상한 (NFR-04 상품 500개) */
export const IMPORT_MAX_ROWS = 500
/** 가격 하한 (R-16 4와 같다) */
const MIN_PRICE = 100
const NUMBER_RE = /^([0-9]{1,4})(?: ?번)?$/
const DIGIT_RE = /[0-9]/
const BOM = '\uFEFF'
// R-18 7 (D-I2-17): 정규화한 품종에 남은 제어 글자 U+0000~U+001F·U+007F~U+009F → NAME_CONTROL
const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/** R-18 7: 품종 칸의 문제 (제어 글자 → 휴대폰 번호 순서, D-I2-17) */
function nameError(name: string): 'NAME_CONTROL' | 'NAME_PHONE' | null {
  if (hasControl(name)) return 'NAME_CONTROL'
  if (containsPhoneRun(name)) return 'NAME_PHONE'
  return null
}

interface ResolvedSettings {
  readonly unit: 'WON' | 'THOUSAND'
  readonly maxNumber: number
  readonly existing: ReadonlySet<number>
}

function resolve(settings: unknown): ResolvedSettings {
  const value = typeof settings === 'object' && settings !== null ? (settings as ImportSettings) : {}
  const read = (key: keyof ImportSettings): unknown => (Object.hasOwn(value, key) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined)
  const unitValue = read('unit')
  const maxValue = read('maxNumber')
  const existingValue = read('existing')
  const unit = unitValue === 'WON' || unitValue === 'THOUSAND' ? unitValue : DEFAULT_SETTINGS['price.unit']
  const maxNumber = typeof maxValue === 'number' && Number.isInteger(maxValue) && maxValue >= 1 && maxValue <= 9999 ? maxValue : DEFAULT_SETTINGS['claim.maxNumber']
  const existing = new Set<number>()
  if (Array.isArray(existingValue)) {
    for (const item of existingValue as unknown[]) if (typeof item === 'number' && Number.isSafeInteger(item)) existing.add(item)
  }
  return { unit, maxNumber, existing }
}

/** 원래 줄 하나 (줄 번호와 글 — 화면 표시용으로도 쓴다) */
export interface SourceLine {
  readonly line: number
  readonly text: string
}

/** R-18 1: 맨 앞 BOM 하나를 지우고 \r\n·\n·\r로 나눈다. 줄 번호는 1부터, 빈 줄도 센다 */
export function splitImportLines(text: string): SourceLine[] {
  const body = text.startsWith(BOM) ? text.slice(1) : text
  const lines: SourceLine[] = []
  let start = 0
  let line = 1
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    if (code !== 0x0a && code !== 0x0d) continue
    lines.push({ line, text: body.slice(start, i) })
    line++
    if (code === 0x0d && body.charCodeAt(i + 1) === 0x0a) i++
    start = i + 1
  }
  lines.push({ line, text: body.slice(start) })
  return lines
}

/**
 * R-18 2 칸 나누기: 탭이 있으면 탭, 없으면 쉼표. `"`로 시작하는 칸은 짝 `"`까지(안의 `""`는 `"` 하나, 나누는 글자도 글자).
 * 닫는 `"` 바로 뒤에는 나누는 글자나 줄 끝만 온다. 닫히지 않거나 뒤에 다른 글자가 오면 null(그 줄은 CELLS).
 * `"`로 시작하지 않는 칸의 `"`는 그냥 글자다. 정규화 전의 글이다
 */
export function splitCells(text: string): string[] | null {
  const sep = text.includes('\t') ? '\t' : ','
  const cells: string[] = []
  let i = 0
  for (;;) {
    if (text[i] === '"') {
      let value = ''
      let j = i + 1
      for (;;) {
        const quote = text.indexOf('"', j)
        if (quote < 0) return null
        value += text.slice(j, quote)
        if (text[quote + 1] === '"') {
          value += '"'
          j = quote + 2
          continue
        }
        j = quote + 1
        break
      }
      cells.push(value)
      if (j === text.length) return cells
      if (text[j] !== sep) return null
      i = j + 1
      continue
    }
    const next = text.indexOf(sep, i)
    if (next < 0) {
      cells.push(text.slice(i))
      return cells
    }
    cells.push(text.slice(i, next))
    i = next + 1
  }
}

/** 해석할 줄 하나: 칸 글 목록(정규화 전) 또는 따옴표 문제(null) */
interface RawRow {
  readonly line: number
  readonly cells: readonly string[] | null
}

/** 칸 정규화 + 넷째 칸부터 빈 칸 지우기 (R-18 2) */
function normalizeCells(cells: readonly string[]): string[] {
  const out: string[] = []
  cells.forEach((cell, index) => {
    const value = normalizeText(typeof cell === 'string' ? cell : '')
    if (index >= 3 && value === '') return
    out.push(value)
  })
  return out
}

/** 줄 목록(건너뛸 줄은 이미 뺐다) → R-18 결과 */
function analyze(rows: readonly RawRow[], settings: ResolvedSettings): ImportResult {
  let header: number | null = null
  let products = rows
  const first = rows[0]
  // R-18 3: 건너뛰지 않은 첫 줄의 첫 칸(정규화한 글)에 숫자가 하나도 없으면 머리글 (따옴표 문제로 나눌 수 없는 줄은 머리글이 아니다)
  if (first !== undefined && first.cells !== null && !DIGIT_RE.test(normalizeText(first.cells[0] ?? ''))) {
    header = first.line
    products = rows.slice(1)
  }
  if (products.length === 0) return { error: 'EMPTY' }
  if (products.length > IMPORT_MAX_ROWS) return { error: 'TOO_MANY' }

  // 1차: 칸·번호
  type Parsed = { readonly line: number; readonly error: 'CELLS' | 'NUMBER_INVALID' } | { readonly line: number; readonly no: number; readonly name: string; readonly price: string }
  const parsed = products.map((row): Parsed => {
    if (row.cells === null) return { line: row.line, error: 'CELLS' }
    const cells = normalizeCells(row.cells)
    if (cells.length !== 3) return { line: row.line, error: 'CELLS' }
    const match = NUMBER_RE.exec(cells[0] as string)
    const no = match === null ? Number.NaN : Number(match[1])
    if (!(no >= 1 && no <= settings.maxNumber)) return { line: row.line, error: 'NUMBER_INVALID' }
    return { line: row.line, no, name: cells[1] as string, price: cells[2] as string }
  })
  // R-18 5: 칸 문제가 없고 번호가 읽힌 줄끼리 같은 번호
  const counts = new Map<number, number>()
  for (const row of parsed) if (!('error' in row)) counts.set(row.no, (counts.get(row.no) ?? 0) + 1)
  const amountSettings = { 'price.unit': settings.unit } as const
  const out: ImportRow[] = parsed.map((row): ImportRow => {
    if ('error' in row) return row
    const { line, no, name } = row
    if ((counts.get(no) ?? 0) > 1) return { line, error: 'DUPLICATE' }
    if (settings.existing.has(no)) return { line, error: 'EXISTS' }
    const nameProblem = nameError(name)
    if (nameProblem !== null) return { line, error: nameProblem }
    if (row.price === '') return { line, error: 'PRICE_MISSING' }
    const price = parseAmount(row.price, amountSettings)
    if (price === null) return { line, error: 'PRICE_INVALID' }
    if (price < MIN_PRICE) return { line, error: 'PRICE_TOO_LOW' }
    return { line, no, name, price }
  })
  return { header, rows: out }
}

/** 공백(R-3 — 탭 포함)만 있는 칸인가 */
const isBlank = (text: string): boolean => normalizeText(text) === ''

/**
 * R-18 1 빈 줄 (D-I2-21): 칸을 나눌 수 있고 정규화한 칸이 모두 빈 줄 — 아무것도 없는 줄, 공백만 있는 줄, `,,`, `"",,`.
 * 따옴표 문제로 칸을 나눌 수 없는 줄(null)은 빈 줄이 아니다(CELLS)
 */
const isBlankCells = (cells: readonly string[] | null): boolean => cells !== null && cells.every(isBlank)

/**
 * 붙여 넣은 글(엑셀 복사 = 탭, 또는 CSV) → R-18 결과. settings = 그 방송의 price.unit·claim.maxNumber와 이미 있는 번호.
 * 문자열이 아니면 EMPTY. 예외를 던지지 않는다
 */
export function parseProductList(text: unknown, settings: ImportSettings = {}): ImportResult {
  try {
    if (typeof text !== 'string') return { error: 'EMPTY' }
    const resolved = resolve(settings)
    // 칸 나누기는 줄 길이에 비례한다 — 빈 줄(D-I2-21)을 가리려면 줄마다 한 번 나눈다. 500줄을 넘으면 그다음 줄은 나누지 않고 끝낸다
    const kept: RawRow[] = []
    for (const source of splitImportLines(text)) {
      const cells = splitCells(source.text)
      if (isBlankCells(cells)) continue
      kept.push({ line: source.line, cells })
      if (kept.length > IMPORT_MAX_ROWS + 1) return { error: 'TOO_MANY' }
    }
    return analyze(kept, resolved)
  } catch {
    // 규칙상 오지 않는 길 — 예외 대신 빈 목록으로 본다
    return { error: 'EMPTY' }
  }
}

/** .xlsx 행 하나: 시트의 행 번호와 칸 글 목록(첫 열부터) */
export interface SheetRow {
  readonly line: number
  readonly cells: readonly string[]
}

/**
 * .xlsx 첫 시트의 행 → R-18 결과 (R-18 2의 정규화·빈 칸 지우기부터 같은 규칙 — 따옴표는 없다. 줄 번호 = 행 번호).
 * 칸이 모두 빈 행은 건너뛴다. 예외를 던지지 않는다
 */
export function parseProductRows(rows: unknown, settings: ImportSettings = {}): ImportResult {
  try {
    if (!Array.isArray(rows)) return { error: 'EMPTY' }
    const resolved = resolve(settings)
    const kept: RawRow[] = []
    for (const row of rows as unknown[]) {
      if (typeof row !== 'object' || row === null) continue
      const { line, cells } = row as { line?: unknown; cells?: unknown }
      if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1 || !Array.isArray(cells)) continue
      const texts = (cells as unknown[]).map((cell) => (typeof cell === 'string' ? cell : ''))
      if (texts.every(isBlank)) continue
      kept.push({ line, cells: texts })
    }
    return analyze(kept, resolved)
  } catch {
    return { error: 'EMPTY' }
  }
}

/** 등록 요청의 줄 하나 (미리 보기에서 본 등록할 값) */
export interface RegisterRow {
  readonly no: number
  readonly name: string
  readonly price: number
}

/**
 * 등록 직전 다시 검사 (R-18 11 — 4~8): 번호 범위, 목록 안 같은 번호, 이미 있는 번호, 품종 제어 글자(D-I2-17)·휴대폰 번호, 가격 100원 이상 정수.
 * 줄마다 문제 하나(없으면 null)를 돌려준다. 값의 형식(정수·정규화한 품종 글)은 부르는 쪽이 먼저 본다
 */
export function recheckRows(rows: readonly RegisterRow[], settings: ImportSettings): (ImportRowError | null)[] {
  const resolved = resolve(settings)
  const counts = new Map<number, number>()
  for (const row of rows) counts.set(row.no, (counts.get(row.no) ?? 0) + 1)
  return rows.map((row) => {
    if (!(Number.isInteger(row.no) && row.no >= 1 && row.no <= resolved.maxNumber)) return 'NUMBER_INVALID'
    if ((counts.get(row.no) ?? 0) > 1) return 'DUPLICATE'
    if (resolved.existing.has(row.no)) return 'EXISTS'
    const nameProblem = nameError(row.name)
    if (nameProblem !== null) return nameProblem
    if (!(Number.isSafeInteger(row.price) && row.price >= MIN_PRICE)) return 'PRICE_TOO_LOW'
    return null
  })
}

/** 등록 요청의 품종 글이 미리 보기 결과 모양(R-3 정규화한 글)인가 */
export function isNormalizedName(name: unknown): name is string {
  return typeof name === 'string' && normalizeText(name) === name
}
