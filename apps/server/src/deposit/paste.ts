// 은행 거래내역 붙여넣기 읽기 (DEPOSIT_RULES DP-2, D-N3-08, 골든 tests/golden/deposit/paste.json — AC-N3-02).
// 붙여넣은 글(엑셀에서 복사한 표 또는 CSV) 하나 → 입금 줄 목록. 순수 함수: 시계·시간대·언어 설정을 읽지 않고 예외를 던지지 않는다.
// 읽은 값은 글자로만 다룬다(`=`로 시작하는 이름도 수식이 아니다).
import { isRealDate } from './calendar.ts'

/** 머리글 아래에서 읽는 줄 수 상한 (빈 줄은 세지 않는다) */
export const PASTE_ROWS_MAX = 2000
/** 입금 금액 범위 (정수 원) */
export const DEPOSIT_AMOUNT_MAX = 100_000_000
/** 입금자명 길이 상한 (코드 포인트) */
export const DEPOSIT_NAME_MAX = 40

export type PastePrecision = 'second' | 'minute'

export interface PasteRow {
  /** 원래 줄 번호 (1부터) */
  readonly line: number
  /** KST 시각 `YYYY-MM-DDTHH:MM:SS+09:00` (분까지만 있으면 초 00) */
  readonly at: string
  readonly precision: PastePrecision
  readonly amount: number
  /** 이름 칸 값 (앞뒤 공백 뺌, 40자까지). 이름 칸이 없거나 비면 "" */
  readonly name: string
  /** 잔액 칸 값 (금액 모양일 때만, 아니면 null) — 줄 키에만 쓴다 */
  readonly balance: number | null
}

export type PasteResult =
  | {
      readonly rows: readonly PasteRow[]
      readonly skipped: readonly { readonly line: number; readonly why: 'NOT_DEPOSIT' }[]
      readonly unreadable: readonly { readonly line: number; readonly why: 'BAD_AMOUNT' | 'BAD_TIME' }[]
    }
  | { readonly error: 'NO_HEADER' | 'TOO_MANY_ROWS' }

type Role = 'when' | 'time' | 'deposit' | 'trade' | 'kind' | 'name' | 'balance'

/** 칸 이름 (공백을 모두 뺀 뒤 정확히 같아야 한다, 여럿이면 앞 이름) */
const HEADER_NAMES: Readonly<Record<Role, readonly string[]>> = {
  when: ['거래일시', '거래일자', '일시', '일자', '날짜'],
  time: ['거래시간', '시간', '시각'],
  deposit: ['입금액', '입금', '입금금액', '맡기신금액', '받은금액'],
  trade: ['거래금액', '금액'],
  kind: ['구분', '입출금구분', '거래구분', '거래유형'],
  name: ['입금자명', '입금자', '보낸분', '보내는분', '의뢰인', '기재내용', '내용', '적요', '거래내용'],
  balance: ['잔액', '거래후잔액'],
}
const ROLES = Object.keys(HEADER_NAMES) as Role[]

/** 금액 모양: 부호(선택) + 세 자리 쉼표 또는 숫자만 + "원"(선택) */
const AMOUNT_RE = /^([+-]?)((?:\d{1,3}(?:,\d{3})+)|\d+)원?$/
const DATE_RE = /^(\d{4})(?:([-./])(\d{2})\2(\d{2})|(\d{2})(\d{2}))$/
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
const DATE_TIME_RE = /^(\S+?)(?:\s+|T)(\S+)$/

interface Amount {
  readonly sign: '' | '+' | '-'
  readonly value: number
}

function readAmount(text: string): Amount | null {
  const match = AMOUNT_RE.exec(text)
  if (match === null) return null
  const value = Number((match[2] as string).replace(/,/g, ''))
  if (!Number.isSafeInteger(value)) return null
  return { sign: match[1] as Amount['sign'], value }
}

/** 줄 하나 → 칸 (탭이 있으면 탭, 없으면 쉼표 CSV). 칸 값은 앞뒤 공백을 뺀다 */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim())
  const cells: string[] = []
  let cell = ''
  let quoted = false
  let atStart = true
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === ',') {
      cells.push(cell.trim())
      cell = ''
      atStart = true
      continue
    }
    if (char === '"' && atStart && cell.trim() === '') {
      cell = ''
      quoted = true
      atStart = false
      continue
    }
    if (char.trim() !== '') atStart = false
    cell += char
  }
  cells.push(cell.trim())
  return cells
}

const compact = (text: string): string => text.replace(/\s/g, '')

/** 머리글 줄이면 칸 자리 (일시 칸과 입금액·거래금액 칸 중 하나가 있어야 한다) */
function headerOf(cells: readonly string[]): Partial<Record<Role, number>> | null {
  const names = cells.map(compact)
  const columns: Partial<Record<Role, number>> = {}
  for (const role of ROLES) {
    for (const name of HEADER_NAMES[role]) {
      const index = names.indexOf(name)
      if (index >= 0) {
        columns[role] = index
        break
      }
    }
  }
  if (columns.when === undefined || (columns.deposit === undefined && columns.trade === undefined)) return null
  return columns
}

interface ReadTime {
  readonly at: string
  readonly precision: PastePrecision
}

function readDate(text: string): { readonly y: number; readonly m: number; readonly d: number } | null {
  const match = DATE_RE.exec(text)
  if (match === null) return null
  const y = Number(match[1])
  const m = Number(match[3] ?? match[5])
  const d = Number(match[4] ?? match[6])
  return isRealDate(y, m, d) ? { y, m, d } : null
}

function readClock(text: string): { readonly h: number; readonly mi: number; readonly s: number | null } | null {
  const match = TIME_RE.exec(text)
  if (match === null) return null
  const h = Number(match[1])
  const mi = Number(match[2])
  const s = match[3] === undefined ? null : Number(match[3])
  if (h > 23 || mi > 59 || (s !== null && s > 59)) return null
  return { h, mi, s }
}

const two = (value: number): string => String(value).padStart(2, '0')

/** 일시 칸(날짜와 시각, 또는 날짜만)과 시각 칸 → KST 시각. 시각이 없거나 있는 날짜·시각이 아니면 null */
function readTime(when: string, time: string | null): ReadTime | null {
  let date = readDate(when)
  let clock: ReturnType<typeof readClock>
  if (date === null) {
    const parts = DATE_TIME_RE.exec(when)
    if (parts === null) return null
    date = readDate(parts[1] as string)
    clock = readClock(parts[2] as string)
    if (date === null || clock === null) return null
  } else {
    if (time === null || time === '') return null
    clock = readClock(time)
    if (clock === null) return null
  }
  const at = `${String(date.y).padStart(4, '0')}-${two(date.m)}-${two(date.d)}T${two(clock.h)}:${two(clock.mi)}:${two(clock.s ?? 0)}+09:00`
  return { at, precision: clock.s === null ? 'minute' : 'second' }
}

/** 입금인지와 금액 (DP-2 4.1): 입금이면 금액, 아니면 NOT_DEPOSIT, 읽지 못하면 BAD_AMOUNT */
function readDeposit(columns: Partial<Record<Role, number>>, cell: (role: Role) => string | null): number | 'NOT_DEPOSIT' | 'BAD_AMOUNT' {
  let amount: Amount | null
  if (columns.deposit !== undefined) {
    const text = cell('deposit') ?? ''
    if (text === '') return 'NOT_DEPOSIT'
    amount = readAmount(text)
    if (amount !== null && amount.value === 0) return 'NOT_DEPOSIT'
    if (amount === null || amount.sign === '-') return 'BAD_AMOUNT'
  } else if (columns.kind !== undefined) {
    if (!compact(cell('kind') ?? '').endsWith('입금')) return 'NOT_DEPOSIT'
    amount = readAmount(cell('trade') ?? '')
    if (amount === null || amount.sign === '-') return 'BAD_AMOUNT'
  } else {
    amount = readAmount(cell('trade') ?? '')
    if (amount !== null && amount.sign === '-') return 'NOT_DEPOSIT'
    if (amount === null || amount.sign !== '+') return 'BAD_AMOUNT'
  }
  if (amount.value < 1 || amount.value > DEPOSIT_AMOUNT_MAX) return 'BAD_AMOUNT'
  return amount.value
}

/** 붙여넣은 글 → { rows, skipped, unreadable } 또는 { error } (DP-2) */
export function readPaste(text: string): PasteResult {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  const lines = body.split(/\r\n|\n|\r/)
  let headerIndex = -1
  let columns: Partial<Record<Role, number>> | null = null
  for (let i = 0; i < lines.length; i++) {
    columns = headerOf(splitCells(lines[i] as string))
    if (columns !== null) {
      headerIndex = i
      break
    }
  }
  if (columns === null) return { error: 'NO_HEADER' }
  const found = columns
  const below: { readonly line: number; readonly cells: readonly string[] }[] = []
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = splitCells(lines[i] as string)
    if (cells.every((value) => value === '')) continue
    below.push({ line: i + 1, cells })
    if (below.length > PASTE_ROWS_MAX) return { error: 'TOO_MANY_ROWS' }
  }
  const rows: PasteRow[] = []
  const skipped: { line: number; why: 'NOT_DEPOSIT' }[] = []
  const unreadable: { line: number; why: 'BAD_AMOUNT' | 'BAD_TIME' }[] = []
  for (const { line, cells } of below) {
    const cell = (role: Role): string | null => {
      const index = found[role]
      return index === undefined ? null : (cells[index] ?? '')
    }
    const deposit = readDeposit(found, cell)
    if (deposit === 'NOT_DEPOSIT') {
      skipped.push({ line, why: 'NOT_DEPOSIT' })
      continue
    }
    if (deposit === 'BAD_AMOUNT') {
      unreadable.push({ line, why: 'BAD_AMOUNT' })
      continue
    }
    const time = readTime(cell('when') ?? '', cell('time'))
    if (time === null) {
      unreadable.push({ line, why: 'BAD_TIME' })
      continue
    }
    const name = [...(cell('name') ?? '').trim()].slice(0, DEPOSIT_NAME_MAX).join('')
    const balance = readAmount(cell('balance') ?? '')
    rows.push({ line, at: time.at, precision: time.precision, amount: deposit, name, balance: balance === null ? null : balance.sign === '-' ? -balance.value : balance.value })
  }
  return { rows, skipped, unreadable }
}
