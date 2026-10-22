// 음성 추출 정확도 측정 (SPEC §8 4단계, HG-4, D-I4-08, AC-I4-03) — 순수 함수 부분.
// 판매자가 녹음을 콘솔 음성으로 들려 "들린 말 기록"에서 옮긴 인식 문장 + 기대값 표(CSV)를 R-17 추출기(골든과 같은 extractVoice)로 채점한다.
// 파일 읽기·쓰기와 종료 코드는 packages/voice/scripts/accuracy.ts(명령)가 한다. 여기는 브라우저·Node 어디서나 돈다(시계·난수·입출력 없음).
// 화면 번들에 들어가지 않게 패키지 첫 입구(index.ts)가 아니라 하위 경로 `@livejjim/voice/accuracy`로 내보낸다.
import { formatWon, normalizeText } from '@livejjim/core'
import { isCardWorthy } from './card.ts'
import { DEFAULT_DICTIONARY } from './default-dictionary.ts'
import { buildDictionary, prepareDictionary } from './dictionary.ts'
import { extractVoice, type VoiceExtraction } from './extract.ts'
import { isAutoReading } from './sms-card.ts'
import { readSmsSentence, type SmsProblem, type SmsReading } from './sms.ts'

/** 첫 줄 열 이름 (정확히 이 순서·글자) */
export const ACCURACY_HEADER: readonly string[] = Object.freeze(['표본', '기대 번호', '기대 가격', '기대 품종', '인식 문장'])
/**
 * 문자찜 줄을 위한 선택 열 (V1, D-V1-11): 기본 다섯 열 뒤에 아무 순서로 0~3개(같은 열 두 번은 안 됨). 없으면 지금 표와 똑같이 읽는다.
 * `종류` = `등록`/`문자찜`(빈칸 = 등록), `기대 끝자리` = 숫자 4개 또는 빈칸(말하지 않음), `기대 이름` = 이름 또는 빈칸(말하지 않음).
 * 문자찜 줄의 `기대 번호`는 번호 목록(띄어 여러 개 — "15 28"), `기대 가격`·`기대 품종`은 보지 않는다.
 */
export const ACCURACY_OPTIONAL_HEADER: readonly string[] = Object.freeze(['종류', '기대 끝자리', '기대 이름'])
export type SampleKind = '등록' | '문자찜'
/** claim.maxNumber 기본값과 범위 (DOMAIN_RULES 설정값 범위) */
export const ACCURACY_DEFAULT_MAX_NUMBER = 999
export const ACCURACY_MAX_NUMBER_LIMIT = 9999
/** 기대 가격 하한 (R-16·R-17과 같다) */
const MIN_PRICE = 100
/** 오류 문장에 보일 값의 최대 글자 수 */
const SHOWN_VALUE_MAX = 20
/** 제어 글자(C0·C1)·줄바꿈·줄 구분자(U+2028·2029)인가 — 오류 문장·보고서 표에서는 공백으로 바꾼다 */
function isControlOrLineBreak(char: string): boolean {
  const code = char.charCodeAt(0)
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
}
/** 제어 글자·줄바꿈을 공백으로 (코드 포인트 단위) */
const flattenControls = (value: string): string => Array.from(value, (char) => (isControlOrLineBreak(char) ? ' ' : char)).join('')

export const ACCURACY_USAGE = [
  '사용법: pnpm --filter @livejjim/voice accuracy <표본 파일> [--dictionary <이름 파일>] [--max-number <1~9999>] [--out <보고서 파일>]',
  '',
  '  표본 파일      UTF-8 CSV. 첫 줄은 정확히 "표본,기대 번호,기대 가격,기대 품종,인식 문장"',
  '                 문자찜 문장도 재려면 뒤에 선택 열 "종류"(등록/문자찜)·"기대 끝자리"·"기대 이름"을 더한다',
  '                 (엑셀은 "CSV UTF-8(쉼표로 분리)"로 저장한다. 예시: packages/voice/samples/accuracy-example.csv,',
  '                  문자찜 예시: packages/voice/samples/accuracy-example-sms.csv)',
  '  --dictionary   판매 이력 이름 파일(UTF-8, 한 줄에 이름 하나). 기본 품종 사전 앞에 붙인다',
  '  --max-number   주문으로 볼 최대 번호(claim.maxNumber). 기본 999',
  '  --out          보고서를 이 파일로도 쓴다(표준 출력에는 늘 쓴다)',
  '',
  '상대 경로는 명령을 실행한 폴더 기준이다.',
].join('\n')

// ── 결과 타입 ────────────────────────────────────────────────────────────

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

export interface CsvRow {
  /** 파일에서 이 줄(레코드)이 시작하는 줄 번호 (첫 줄 = 1, 따옴표 안 줄바꿈도 센다) */
  readonly line: number
  readonly cells: readonly string[]
}

export interface AccuracySample {
  /** 파일에서 이 표본이 시작하는 줄 번호 */
  readonly line: number
  /** 표본 이름 (빈칸이면 "N번째 줄") */
  readonly label: string
  /** 기대 번호 (null = 번호를 말하지 않음 — 뽑지 않아야 맞음) */
  readonly expectedNo: number | null
  /** 기대 가격, 정수 원 (null = 가격을 말하지 않음 — 뽑지 않아야 맞음) */
  readonly expectedPrice: number | null
  /** 기대 품종 (null = 품종은 채점하지 않음) */
  readonly expectedName: string | null
  /** 인식 문장 (그대로 — 추출기가 정규화한다) */
  readonly text: string
  // ── 선택 열이 있는 표에서만 있는 칸 (없는 표는 지금 모양 그대로) ──
  /** 종류 (빈칸 = 등록) */
  readonly kind?: SampleKind
  /** 문자찜 줄의 기대 번호 목록 (빈 목록 = 번호를 말하지 않음 — 넣지 않아야 맞음). 등록 줄은 기대 번호 하나 또는 빈 목록 */
  readonly expectedNos?: readonly number[]
  /** 기대 끝자리 (null = 말하지 않음) */
  readonly expectedLast4?: string | null
  /** 기대 이름 (null = 말하지 않음) */
  readonly expectedPerson?: string | null
}

/** 칸 하나의 채점 결과 (보고서에 그대로 보이는 낱말) */
export type Verdict = '맞음' | '빈칸' | '틀림' | '채점 안 함'

export interface ScoredSample {
  readonly sample: AccuracySample
  readonly extraction: VoiceExtraction
  readonly no: Verdict
  readonly price: Verdict
  readonly name: Verdict
  /** 번호나 가격이 틀림 (기대와 다른 값으로 채움 — 가장 위험) */
  readonly filledWrong: boolean
  /** 확실(HIGH)인데 번호·가격·품종 중 하나라도 틀림 (자동 확정 위험) */
  readonly confidentWrong: boolean
  /** 카드가 만들어지는 결과 (isCardWorthy) */
  readonly cardWorthy: boolean
  // ── 문자찜 (V1, D-V1-11) — 등록 줄은 sms 칸이 모두 "채점 안 함" ──
  readonly kind: SampleKind
  /** 같은 문장의 R-21 결과 (null = 문자찜 문장이 아님) */
  readonly smsReading: SmsReading | null
  readonly smsNo: Verdict
  readonly smsLast4: Verdict
  readonly smsPerson: Verdict
  /** 등록 줄인데 문자찜으로 읽음 (문자찜도 듣기가 켜져 있으면 상품 카드 대신 문자찜 카드가 된다) */
  readonly falseSms: boolean
  /** 문자찜 줄인데 문자찜으로 못 읽음 */
  readonly missedSms: boolean
  /** 저절로 넣을 수 있는 읽기인데(주문 하나·문제 없음) 기대와 다른 번호·끝자리 — 또는 등록 줄인데 저절로 넣을 문자찜 (가장 위험) */
  readonly smsAutoWrong: boolean
}

export interface SmsAccuracySummary {
  /** 문자찜 줄 수 */
  readonly samples: number
  /** 문자찜으로 읽은 문자찜 줄 */
  readonly read: number
  readonly noCorrect: number
  readonly last4Correct: number
  readonly personCorrect: number
  readonly falseSms: number
  readonly missedSms: number
  readonly autoWrong: number
}

export interface AccuracySummary {
  /** 상품 등록 표본 수 (문자찜 줄은 SmsAccuracySummary가 센다 — 선택 열이 없는 표는 모든 표본) */
  readonly samples: number
  readonly noCorrect: number
  readonly priceCorrect: number
  readonly bothCorrect: number
  readonly nameCorrect: number
  /** 품종을 채점한 표본 수 (기대 품종이 빈칸이 아닌 것) */
  readonly nameScored: number
  readonly filledWrong: number
  readonly confidentWrong: number
  readonly cardWorthy: number
}

export interface AccuracyOptions {
  /** claim.maxNumber (1~9999, 기본 999) */
  readonly maxNumber?: number
  /** 판매 이력 이름 (기본 사전 앞에 붙인다) */
  readonly history?: readonly string[]
}

// ── CSV ──────────────────────────────────────────────────────────────────

/** 오류 문장에 넣을 값: 줄바꿈·제어 글자는 공백, 길면 줄인다 */
function shown(value: string): string {
  const flat = [...flattenControls(value)]
  return flat.length > SHOWN_VALUE_MAX ? `${flat.slice(0, SHOWN_VALUE_MAX).join('')}…` : flat.join('')
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/**
 * CSV 읽기 (RFC 4180 + 엑셀): 맨 앞 BOM, 줄 끝 CRLF·LF·CR, 큰따옴표로 감싼 칸 안의 쉼표·줄바꿈·`""`(큰따옴표 하나).
 * 감싸지 않은 칸 가운데의 큰따옴표는 글자 그대로 둔다. 닫는 큰따옴표 뒤에 쉼표·줄 끝이 아닌 글자가 오거나 큰따옴표가 닫히지 않으면 오류.
 * 마지막 줄 끝의 줄바꿈은 빈 줄을 만들지 않는다.
 */
export function parseCsv(input: string): Parsed<CsvRow[]> {
  const text = stripBom(input)
  const rows: CsvRow[] = []
  let line = 1
  let rowLine = 1
  let cells: string[] = []
  let cell = ''
  let i = 0
  const endRow = (): void => {
    cells.push(cell)
    rows.push({ line: rowLine, cells })
    cells = []
    cell = ''
  }
  while (i < text.length) {
    const char = text[i] as string
    if (char === '"' && cell === '') {
      // 감싼 칸
      const quoteLine = line
      i++
      let closed = false
      while (i < text.length) {
        const inner = text[i] as string
        if (inner === '"') {
          if (text[i + 1] === '"') {
            cell += '"'
            i += 2
            continue
          }
          i++
          closed = true
          break
        }
        if (inner === '\r' && text[i + 1] === '\n') {
          cell += '\r\n'
          i += 2
          line++
          continue
        }
        if (inner === '\n' || inner === '\r') line++
        cell += inner
        i++
      }
      if (!closed) return { ok: false, message: `${String(quoteLine)}번째 줄에서 연 큰따옴표가 닫히지 않았어요.` }
      const after = text[i]
      if (after !== undefined && after !== ',' && after !== '\n' && after !== '\r') {
        return { ok: false, message: `${String(line)}번째 줄: 큰따옴표로 감싼 칸 뒤에는 쉼표나 줄바꿈이 와야 해요.` }
      }
      // 감싼 칸이 빈 글이어도 칸이다 — 다음 글자 처리로
      if (after === undefined) break
      if (after === ',') {
        cells.push(cell)
        cell = ''
        i++
        // 바로 다음 칸이 다시 감싼 칸일 수 있다: cell === '' 조건으로 처리된다
        continue
      }
      // 줄 끝
      i += after === '\r' && text[i + 1] === '\n' ? 2 : 1
      endRow()
      line++
      rowLine = line
      continue
    }
    if (char === ',') {
      cells.push(cell)
      cell = ''
      i++
      continue
    }
    if (char === '\n' || char === '\r') {
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1
      endRow()
      line++
      rowLine = line
      continue
    }
    cell += char
    i++
  }
  // 마지막 줄 (끝에 줄바꿈이 없을 때, 또는 감싼 칸으로 끝났을 때)
  if (cell !== '' || cells.length > 0 || (text.length > 0 && !/[\r\n]$/.test(text))) endRow()
  return { ok: true, value: rows }
}

// ── 표본 ─────────────────────────────────────────────────────────────────

const isBlankRow = (cells: readonly string[]): boolean => cells.every((cell) => cell.trim() === '')

function parseExpectedNumber(raw: string, line: number): Parsed<number | null> {
  const value = raw.trim()
  if (value === '') return { ok: true, value: null }
  if (/^[0-9]{1,4}$/.test(value)) {
    const no = Number(value)
    if (no >= 1 && no <= ACCURACY_MAX_NUMBER_LIMIT) return { ok: true, value: no }
  }
  return { ok: false, message: `${String(line)}번째 줄: 기대 번호는 1~9999 정수나 빈칸이어야 해요(적힌 값 "${shown(value)}").` }
}

function parseExpectedPrice(raw: string, line: number): Parsed<number | null> {
  const value = raw.trim()
  if (value === '') return { ok: true, value: null }
  if (/^[0-9]{1,15}$/.test(value) || /^[0-9]{1,3}(?:,[0-9]{3}){1,4}$/.test(value)) {
    const price = Number(value.replaceAll(',', ''))
    if (Number.isSafeInteger(price) && price >= MIN_PRICE) return { ok: true, value: price }
  }
  return { ok: false, message: `${String(line)}번째 줄: 기대 가격은 100 이상 정수(원 — 숫자만 또는 천 단위 쉼표)나 빈칸이어야 해요(적힌 값 "${shown(value)}").` }
}

function parseKind(raw: string, line: number): Parsed<SampleKind> {
  const value = raw.trim()
  if (value === '' || value === '등록') return { ok: true, value: '등록' }
  if (value === '문자찜') return { ok: true, value: '문자찜' }
  return { ok: false, message: `${String(line)}번째 줄: 종류는 "등록"이나 "문자찜"이나 빈칸이어야 해요(적힌 값 "${shown(value)}").` }
}

function parseExpectedLast4(raw: string, line: number): Parsed<string | null> {
  const value = raw.trim()
  if (value === '') return { ok: true, value: null }
  if (/^[0-9]{4}$/.test(value)) return { ok: true, value }
  return { ok: false, message: `${String(line)}번째 줄: 기대 끝자리는 숫자 4개나 빈칸이어야 해요(적힌 값 "${shown(value)}" — 엑셀이 앞의 0을 지웠다면 칸을 글자로 바꿔 주세요).` }
}

/** 문자찜 줄의 기대 번호: 빈칸 또는 1~9999 정수를 띄어 여러 개 (같은 번호는 한 번) */
function parseExpectedNumbers(raw: string, line: number): Parsed<number[]> {
  const value = raw.trim()
  if (value === '') return { ok: true, value: [] }
  const numbers: number[] = []
  for (const part of value.split(/\s+/)) {
    const no = /^[0-9]{1,4}$/.test(part) ? Number(part) : Number.NaN
    if (!(no >= 1 && no <= ACCURACY_MAX_NUMBER_LIMIT)) {
      return { ok: false, message: `${String(line)}번째 줄: 문자찜의 기대 번호는 1~9999 정수(여러 개면 띄어서)나 빈칸이어야 해요(적힌 값 "${shown(value)}").` }
    }
    if (!numbers.includes(no)) numbers.push(no)
  }
  return { ok: true, value: numbers }
}

/** 첫 줄 → 선택 열의 위치 (없는 열은 -1). 기본 다섯 열이 정확하지 않거나 모르는·겹친 열이 있으면 null */
function readHeader(cells: readonly string[]): ReadonlyMap<string, number> | null {
  if (cells.length < ACCURACY_HEADER.length || cells.length > ACCURACY_HEADER.length + ACCURACY_OPTIONAL_HEADER.length) return null
  if (ACCURACY_HEADER.some((name, i) => cells[i] !== name)) return null
  const optional = new Map<string, number>()
  for (let i = ACCURACY_HEADER.length; i < cells.length; i++) {
    const name = cells[i] as string
    if (!ACCURACY_OPTIONAL_HEADER.includes(name) || optional.has(name)) return null
    optional.set(name, i)
  }
  return optional
}

/**
 * 표본 파일(CSV 글) → 표본 목록. 첫 줄은 정확히 ACCURACY_HEADER, 그 뒤에 선택 열(ACCURACY_OPTIONAL_HEADER)이 0~3개. 칸이 모두 빈 줄은 건너뛴다.
 * 선택 열이 없으면 지금 표와 똑같이 읽는다(표본 모양도 같다). 선택 열이 있으면 표본마다 종류·기대 번호 목록·기대 끝자리·기대 이름이 붙는다.
 * 오류(열 이름 다름·칸 수 다름·기대 번호/가격/끝자리·종류 형식·표본 0개)는 쉬운 한국어 한 문장(몇 번째 줄인지 포함).
 */
export function parseAccuracySamples(text: string): Parsed<AccuracySample[]> {
  if (stripBom(text).trim() === '') return { ok: false, message: '표본 파일이 비어 있어요.' }
  const csv = parseCsv(text)
  if (!csv.ok) return csv
  const [header, ...rows] = csv.value
  const optional = header === undefined ? null : readHeader(header.cells)
  if (header === undefined || optional === null) {
    return {
      ok: false,
      message:
        header !== undefined && header.cells.length > ACCURACY_HEADER.length && ACCURACY_HEADER.every((name, i) => header.cells[i] === name) && header.cells.slice(ACCURACY_HEADER.length).some((name) => ACCURACY_OPTIONAL_HEADER.includes(name))
          ? `첫 줄의 열 이름은 "${ACCURACY_HEADER.join(',')}" 뒤에 "${ACCURACY_OPTIONAL_HEADER.join('", "')}" 중 필요한 것만 한 번씩 더해야 해요.`
          : `첫 줄의 열 이름은 정확히 "${ACCURACY_HEADER.join(',')}"이어야 해요.`,
    }
  }
  const width = header.cells.length
  const extended = optional.size > 0
  const cellAt = (cells: readonly string[], name: string): string => {
    const index = optional.get(name)
    return index === undefined ? '' : (cells[index] ?? '')
  }
  const samples: AccuracySample[] = []
  for (const row of rows) {
    if (isBlankRow(row.cells)) continue
    if (row.cells.length !== width) {
      const names = extended ? header.cells.join('·') : '표본·기대 번호·기대 가격·기대 품종·인식 문장'
      return { ok: false, message: `${String(row.line)}번째 줄의 칸이 ${String(row.cells.length)}개예요 — ${String(width)}개(${names})여야 해요.` }
    }
    const [label = '', rawNo = '', rawPrice = '', rawName = '', sentence = ''] = row.cells
    const kind = parseKind(cellAt(row.cells, '종류'), row.line)
    if (!kind.ok) return kind
    const sms = kind.value === '문자찜'
    const nos = sms ? parseExpectedNumbers(rawNo, row.line) : null
    if (nos !== null && !nos.ok) return nos
    const no = sms ? null : parseExpectedNumber(rawNo, row.line)
    if (no !== null && !no.ok) return no
    // 문자찜 줄의 기대 가격·기대 품종은 보지 않는다
    const price = sms ? ({ ok: true, value: null } as const) : parseExpectedPrice(rawPrice, row.line)
    if (!price.ok) return price
    const last4 = parseExpectedLast4(cellAt(row.cells, '기대 끝자리'), row.line)
    if (!last4.ok) return last4
    const name = sms ? '' : normalizeText(rawName)
    const person = normalizeText(cellAt(row.cells, '기대 이름'))
    const expectedNos = nos !== null && nos.ok ? nos.value : no !== null && no.ok && no.value !== null ? [no.value] : []
    const base: AccuracySample = {
      line: row.line,
      label: label.trim() === '' ? `${String(row.line)}번째 줄` : label.trim(),
      expectedNo: no !== null && no.ok ? no.value : expectedNos.length === 1 ? (expectedNos[0] as number) : null,
      expectedPrice: price.value,
      expectedName: name === '' ? null : name,
      text: sentence,
    }
    samples.push(extended ? { ...base, kind: kind.value, expectedNos, expectedLast4: last4.value, expectedPerson: person === '' ? null : person } : base)
  }
  if (samples.length === 0) return { ok: false, message: '표본이 하나도 없어요 — 첫 줄 아래에 표본을 한 줄에 하나씩 적어 주세요.' }
  return { ok: true, value: samples }
}

/** 이름 파일(UTF-8, 한 줄에 이름 하나) → 이름 목록. 맨 앞 BOM 허용, 앞뒤 공백을 지우고 빈 줄은 무시한다 */
export function parseDictionaryLines(text: string): string[] {
  return stripBom(text)
    .split(/\r\n|\n|\r/)
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

// ── 채점 ─────────────────────────────────────────────────────────────────

/** 품종 비교 모양: R-3 정규화 → 공백 지우기 → NFC */
const nameKey = (name: string): string => normalizeText(name).replace(/\s/g, '').normalize('NFC')

function judge<T>(expected: T | null, got: T | null, same: (a: T, b: T) => boolean): Verdict {
  if (got === null) return expected === null ? '맞음' : '빈칸'
  return expected !== null && same(expected, got) ? '맞음' : '틀림'
}

const SKIPPED_SMS = { smsNo: '채점 안 함', smsLast4: '채점 안 함', smsPerson: '채점 안 함' } as const

const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])

/** 문자찜 줄 채점: 번호(목록)·끝자리·이름을 맞음·빈칸·틀림으로 (R-21이 문자찜으로 못 읽었거나 문제가 있으면 넣지 않으므로 빈칸 쪽) */
function scoreSms(sample: AccuracySample, reading: SmsReading | null): Pick<ScoredSample, 'smsNo' | 'smsLast4' | 'smsPerson' | 'missedSms' | 'smsAutoWrong'> {
  const expectedNos = sample.expectedNos ?? []
  const expectedLast4 = sample.expectedLast4 ?? null
  const expectedPerson = sample.expectedPerson ?? null
  const nos = reading === null ? [] : reading.orders.map((order) => order.no)
  const smsNo = judge(expectedNos.length === 0 ? null : expectedNos, nos.length === 0 ? null : nos, sameList)
  const smsLast4 = judge(expectedLast4, reading?.last4 ?? null, (a, b) => a === b)
  const smsPerson = judge(expectedPerson, reading?.name ?? null, (a, b) => nameKey(a) === nameKey(b))
  const auto = reading !== null && isAutoReading(reading)
  return { smsNo, smsLast4, smsPerson, missedSms: reading === null, smsAutoWrong: auto && (!sameList(nos, expectedNos) || reading.last4 !== expectedLast4) }
}

/**
 * 표본 하나를 채점한다. 등록 줄: 추출 결과의 칸마다 맞음·빈칸·틀림(품종은 기대가 빈칸이면 채점 안 함), 그리고 같은 문장을 문자찜으로 읽었는지.
 * 문자찜 줄(V1): R-21 결과로 번호(목록)·끝자리·이름을 채점하고, 등록 칸(번호·가격·품종)은 "채점 안 함".
 * smsReading을 넘기지 않으면 같은 문장을 readSmsSentence(maxNumber 기본 999)로 읽는다.
 */
export function scoreSample(sample: AccuracySample, extraction: VoiceExtraction, smsReading?: SmsReading | null): ScoredSample {
  const reading = smsReading === undefined ? readSmsSentence(sample.text) : smsReading
  const kind: SampleKind = sample.kind ?? '등록'
  if (kind === '문자찜') {
    return {
      sample,
      extraction,
      no: '채점 안 함',
      price: '채점 안 함',
      name: '채점 안 함',
      filledWrong: false,
      confidentWrong: false,
      cardWorthy: false,
      kind,
      smsReading: reading,
      falseSms: false,
      ...scoreSms(sample, reading),
    }
  }
  const no = judge(sample.expectedNo, extraction.no, (a, b) => a === b)
  const price = judge(sample.expectedPrice, extraction.price, (a, b) => a === b)
  const name: Verdict = sample.expectedName === null ? '채점 안 함' : judge(sample.expectedName, extraction.name, (a, b) => nameKey(a) === nameKey(b))
  const filledWrong = no === '틀림' || price === '틀림'
  return {
    sample,
    extraction,
    no,
    price,
    name,
    filledWrong,
    confidentWrong: extraction.confidence === 'HIGH' && (filledWrong || name === '틀림'),
    cardWorthy: isCardWorthy(extraction),
    kind,
    smsReading: reading,
    ...SKIPPED_SMS,
    falseSms: reading !== null,
    missedSms: false,
    // 문자찜이 아닌 말이 저절로 들어가는 문자찜이 된다 — 늘 기대와 다른 넣기
    smsAutoWrong: reading !== null && isAutoReading(reading),
  }
}

/** 표본들을 골든과 같은 추출기로 뽑아 채점한다. 사전 = 이력 이름 + 기본 사전(R-17 5 정리), maxNumber 기본 999. 문자찜은 같은 maxNumber로 R-21 */
export function scoreSamples(samples: readonly AccuracySample[], options: AccuracyOptions = {}): ScoredSample[] {
  const dictionary = prepareDictionary(buildDictionary(options.history ?? [], DEFAULT_DICTIONARY))
  const maxNumber = options.maxNumber ?? ACCURACY_DEFAULT_MAX_NUMBER
  return samples.map((sample) => scoreSample(sample, extractVoice(sample.text, { maxNumber, dictionary }), readSmsSentence(sample.text, { maxNumber })))
}

/** 상품 등록 줄의 요약 (문자찜 줄은 세지 않는다 — summarizeSmsAccuracy) */
export function summarizeAccuracy(scored: readonly ScoredSample[]): AccuracySummary {
  const registration = scored.filter((item) => item.kind === '등록')
  const count = (predicate: (item: ScoredSample) => boolean): number => registration.filter(predicate).length
  return {
    samples: registration.length,
    noCorrect: count((item) => item.no === '맞음'),
    priceCorrect: count((item) => item.price === '맞음'),
    bothCorrect: count((item) => item.no === '맞음' && item.price === '맞음'),
    nameCorrect: count((item) => item.name === '맞음'),
    nameScored: count((item) => item.name !== '채점 안 함'),
    filledWrong: count((item) => item.filledWrong),
    confidentWrong: count((item) => item.confidentWrong),
    cardWorthy: count((item) => item.cardWorthy),
  }
}

/** 문자찜 요약 (D-V1-11): 문자찜 줄의 맞음 수와, 등록 줄까지 본 세 위험 수 */
export function summarizeSmsAccuracy(scored: readonly ScoredSample[]): SmsAccuracySummary {
  const sms = scored.filter((item) => item.kind === '문자찜')
  const count = (items: readonly ScoredSample[], predicate: (item: ScoredSample) => boolean): number => items.filter(predicate).length
  return {
    samples: sms.length,
    read: count(sms, (item) => item.smsReading !== null),
    noCorrect: count(sms, (item) => item.smsNo === '맞음'),
    last4Correct: count(sms, (item) => item.smsLast4 === '맞음'),
    personCorrect: count(sms, (item) => item.smsPerson === '맞음'),
    falseSms: count(scored, (item) => item.falseSms),
    missedSms: count(sms, (item) => item.missedSms),
    autoWrong: count(scored, (item) => item.smsAutoWrong),
  }
}

/** "맞음 수/채점 수 (소수 한 자리 %)" — 정수 계산으로 반올림(0.05 → 위로). 채점 수가 0이면 "0/0 (채점한 표본 없음)" */
export function formatRatio(correct: number, total: number): string {
  if (total <= 0) return `${String(correct)}/${String(total)} (채점한 표본 없음)`
  const tenths = Math.floor((correct * 2000 + total) / (2 * total))
  return `${String(correct)}/${String(total)} (${String(Math.floor(tenths / 10))}.${String(tenths % 10)}%)`
}

// ── 보고서 ───────────────────────────────────────────────────────────────

/** 마크다운 표 칸: 줄바꿈·제어 글자는 공백, `\`·`|`는 escape, HTML 글자는 문자 참조 — 표가 깨지거나 HTML로 그려지지 않게 */
export function tableCell(value: string): string {
  return flattenControls(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`')
}

const showNo = (no: number | null): string => (no === null ? '번호 없음' : `${String(no)}번`)
const showPrice = (price: number | null): string => (price === null ? '가격 없음' : formatWon(price))

export interface ReportMeta {
  /** 표본 파일 이름 (보고서 머리에 보인다 — 경로 대신 파일 이름만 넘긴다) */
  readonly sampleFile: string
  readonly maxNumber: number
  /** 이력 이름 수 (이름 파일에 적힌 줄 수) */
  readonly historyNames: number
}

/** 문자찜을 넣지 않는 까닭 (R-21 문제 — 영어 이름을 보이지 않는다) */
const SMS_PROBLEM_WORDS: Readonly<Record<SmsProblem, string>> = Object.freeze({
  CANCEL: '취소 말',
  LAST4_UNCLEAR: '끝자리를 못 알아들음',
  NAME_UNCLEAR: '이름이 둘',
  TIME_UNCLEAR: '시각을 못 알아들음',
  NUMBER_UNCLEAR: '번호를 못 알아들음',
  OPTION_UNCLEAR: '상품·옵션을 못 알아들음',
})

const showNos = (nos: readonly number[]): string => (nos.length === 0 ? '번호 없음' : nos.map((no) => `${String(no)}번`).join(' '))
const showSmsBuyer = (last4: string | null, person: string | null): string => `${last4 === null ? '끝자리 없음' : `끝자리 ${last4}`} · ${person === null ? '이름 없음' : `${person}님`}`

function showSmsReading(reading: SmsReading | null): string {
  if (reading === null) return '문자찜 아님'
  if (reading.problem !== null) return `넣지 않음(${SMS_PROBLEM_WORDS[reading.problem]})`
  return `${showNos(reading.orders.map((order) => order.no))} · ${showSmsBuyer(reading.last4, reading.name)}`
}

const smsInsertWord = (reading: SmsReading | null): string => (reading === null ? '없음' : reading.problem !== null ? '넣지 않음' : isAutoReading(reading) ? '저절로' : '눌러야')

/** 쉬운 한국어 마크다운 보고서. 영어 상태값(HIGH·LOW·null)을 쓰지 않는다. 문자찜 요약은 늘 보이고(D-V1-11), 문자찜 줄은 따로 된 표에 */
export function renderAccuracyReport(scored: readonly ScoredSample[], summary: AccuracySummary, meta: ReportMeta): string {
  const sms = summarizeSmsAccuracy(scored)
  const registration = scored.filter((item) => item.kind === '등록')
  const smsRows = scored.filter((item) => item.kind === '문자찜')
  const lines: string[] = []
  lines.push('# 음성 추출 정확도 보고서', '')
  lines.push(`- 표본 파일: ${tableCell(meta.sampleFile)}`)
  lines.push(`- 품종 사전: 판매 이력 이름 ${String(meta.historyNames)}개 + 기본 사전 ${String(DEFAULT_DICTIONARY.length)}개`)
  lines.push(`- 최대 번호: ${String(meta.maxNumber)}번`)
  lines.push('')
  lines.push('## 요약', '')
  lines.push(sms.samples === 0 ? `- 표본 수: ${String(summary.samples)}` : `- 표본 수: ${String(scored.length)} (상품 등록 ${String(summary.samples)} · 문자찜 ${String(sms.samples)})`)
  lines.push(`- 번호 맞음: ${formatRatio(summary.noCorrect, summary.samples)}`)
  lines.push(`- 가격 맞음: ${formatRatio(summary.priceCorrect, summary.samples)}`)
  lines.push(`- 번호·가격 둘 다 맞음: ${formatRatio(summary.bothCorrect, summary.samples)}`)
  lines.push(`- 품종 맞음: ${formatRatio(summary.nameCorrect, summary.nameScored)}`)
  lines.push(`- 틀린 값을 채움: ${String(summary.filledWrong)}`)
  lines.push(`- 확실한데 틀림: ${String(summary.confidentWrong)}`)
  lines.push(`- 카드가 만들어진 표본: ${String(summary.cardWorthy)}`)
  lines.push('')
  lines.push('## 문자찜 요약', '')
  lines.push(`- 문자찜 표본 수: ${String(sms.samples)}`)
  lines.push(`- 문자찜 번호 맞음: ${formatRatio(sms.noCorrect, sms.samples)}`)
  lines.push(`- 문자찜 끝자리 맞음: ${formatRatio(sms.last4Correct, sms.samples)}`)
  lines.push(`- 문자찜 이름 맞음: ${formatRatio(sms.personCorrect, sms.samples)}`)
  lines.push(`- 문자찜이 아닌데 문자찜으로 읽음: ${String(sms.falseSms)}`)
  lines.push(`- 문자찜인데 문자찜으로 못 읽음: ${String(sms.missedSms)}`)
  lines.push(`- 다른 번호·끝자리로 저절로 넣을 문장: ${String(sms.autoWrong)}`)
  lines.push('')
  lines.push('## 살펴볼 표본', '')
  const reasons = (item: ScoredSample): string[] =>
    [
      item.filledWrong ? '틀린 값을 채움' : '',
      item.confidentWrong ? '확실한데 틀림' : '',
      item.falseSms ? '문자찜이 아닌데 문자찜으로 읽음' : '',
      item.missedSms ? '문자찜인데 문자찜으로 못 읽음' : '',
      item.smsAutoWrong ? '다른 번호·끝자리로 저절로 넣을 문장' : '',
    ].filter((text) => text !== '')
  const risky = scored.filter((item) => reasons(item).length > 0)
  if (risky.length === 0) lines.push('- 없음 (틀린 값을 채우거나 확실한데 틀린 표본, 문자찜을 잘못 읽은 표본이 없어요)')
  for (const item of risky) {
    lines.push(`- ${tableCell(item.sample.label)} (${String(item.sample.line)}번째 줄): ${reasons(item).join(', ')} — 문장 "${tableCell(item.sample.text)}"`)
  }
  lines.push('')
  lines.push('## 표본별 결과', '')
  lines.push('| 표본 | 인식 문장 | 기대 | 뽑은 값 | 신뢰도 | 번호 | 가격 | 품종 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const item of registration) {
    const { sample, extraction } = item
    const expected = `${showNo(sample.expectedNo)} · ${sample.expectedName ?? '품종 안 적음'} · ${showPrice(sample.expectedPrice)}`
    const got = `${showNo(extraction.no)} · ${extraction.name ?? '품종 없음'} · ${showPrice(extraction.price)}`
    const confidence = extraction.confidence === 'HIGH' ? '확실' : '확인 필요'
    lines.push(`| ${[sample.label, sample.text, expected, got, confidence, item.no, item.price, item.name].map(tableCell).join(' | ')} |`)
  }
  lines.push('')
  lines.push('## 문자찜 표본별 결과', '')
  if (smsRows.length === 0) lines.push('- 없음 (종류가 "문자찜"인 표본이 없어요)')
  else {
    lines.push('| 표본 | 인식 문장 | 기대 | 읽은 값 | 넣기 | 번호 | 끝자리 | 이름 |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const item of smsRows) {
      const { sample } = item
      const expected = `${showNos(sample.expectedNos ?? [])} · ${showSmsBuyer(sample.expectedLast4 ?? null, sample.expectedPerson ?? null)}`
      lines.push(`| ${[sample.label, sample.text, expected, showSmsReading(item.smsReading), smsInsertWord(item.smsReading), item.smsNo, item.smsLast4, item.smsPerson].map(tableCell).join(' | ')} |`)
    }
  }
  lines.push('')
  lines.push('## 읽는 법', '')
  lines.push('- 맞음: 뽑은 값이 기대와 같아요(기대가 빈칸이면 아무것도 뽑지 않아야 맞음).')
  lines.push('- 빈칸: 기대한 값이 있는데 뽑지 못했어요 — 카드에서 방송자가 채워요.')
  lines.push('- 틀림: 기대와 다른 값을 뽑았어요(기대가 빈칸인데 뽑은 것 포함) — 확인 없이 등록되면 판매 사고예요.')
  lines.push('- 채점 안 함: 기대 품종을 적지 않은 표본의 품종이에요.')
  lines.push('- 확실: 번호·품종·가격이 모두 있고 품종이 사전 이름과 같아요 — 자동 등록을 켜면 이 카드만 자동 등록돼요.')
  lines.push('- "틀린 값을 채움"이나 "확실한데 틀림"이 있으면 그 문장을 규칙 담당에게 넘겨 주세요. "확실한데 틀림"이 하나라도 있으면 자동 등록은 꺼 둔 채로 써요.')
  lines.push('- 문자찜 넣기: 저절로 = 기다린 뒤 저절로 들어가는 카드, 눌러야 = "넣기"를 눌러야 하는 카드(번호가 둘 이상), 넣지 않음 = 이유만 보이는 카드.')
  lines.push('- "다른 번호·끝자리로 저절로 넣을 문장"이 하나라도 있으면 문자찜 자동으로 넣기까지(초)를 늘리고, 그 문장을 규칙 담당에게 넘겨 주세요.')
  lines.push('')
  return lines.join('\n')
}

// ── 명령 인자 ────────────────────────────────────────────────────────────

export interface AccuracyArgs {
  readonly samples: string
  readonly dictionary: string | null
  readonly maxNumber: number
  readonly out: string | null
}

const OPTION_NAMES = ['--dictionary', '--max-number', '--out'] as const
type OptionName = (typeof OPTION_NAMES)[number]
const isOptionName = (value: string): value is OptionName => (OPTION_NAMES as readonly string[]).includes(value)

/**
 * 명령 인자 → 설정. 인자가 없으면 usage(사용법을 보이고 종료 코드 1).
 * 선택지는 `--이름 값`·`--이름=값` 둘 다, `--` 뒤는 모두 표본 파일 자리. 모르는 선택지·값 없음·두 번 적음·표본 파일 0개·2개 이상·최대 번호 범위 밖은 오류.
 */
export function parseAccuracyArgs(argv: readonly string[]): { readonly ok: true; readonly value: AccuracyArgs } | { readonly ok: false; readonly message: string; readonly usage: boolean } {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--')) return { ok: false, message: ACCURACY_USAGE, usage: true }
  const fail = (message: string): { ok: false; message: string; usage: false } => ({ ok: false, message, usage: false })
  const values = new Map<OptionName, string>()
  const positional: string[] = []
  let optionsEnded = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (optionsEnded || !arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    if (arg === '--') {
      optionsEnded = true
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    if (!isOptionName(name)) return fail(`모르는 선택지예요: ${shown(name)} (쓸 수 있는 것: ${OPTION_NAMES.join(', ')})`)
    if (values.has(name)) return fail(`${name} 선택지는 한 번만 적어 주세요.`)
    let value: string | undefined
    if (eq !== -1) value = arg.slice(eq + 1)
    else {
      value = argv[i + 1]
      i++
    }
    if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) return fail(`${name} 뒤에 값을 적어 주세요.`)
    values.set(name, value)
  }
  if (positional.length === 0) return fail('표본 파일을 적어 주세요.')
  if (positional.length > 1) return fail(`표본 파일은 하나만 적어 주세요(적힌 것 ${String(positional.length)}개).`)
  let maxNumber = ACCURACY_DEFAULT_MAX_NUMBER
  const rawMax = values.get('--max-number')
  if (rawMax !== undefined) {
    const parsed = /^[0-9]{1,4}$/.test(rawMax) ? Number(rawMax) : Number.NaN
    if (!(parsed >= 1 && parsed <= ACCURACY_MAX_NUMBER_LIMIT)) return fail(`--max-number는 1~9999 정수여야 해요(적힌 값 "${shown(rawMax)}").`)
    maxNumber = parsed
  }
  return {
    ok: true,
    value: { samples: positional[0] as string, dictionary: values.get('--dictionary') ?? null, maxNumber, out: values.get('--out') ?? null },
  }
}
