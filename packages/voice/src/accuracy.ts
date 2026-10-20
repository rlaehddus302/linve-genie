// 음성 추출 정확도 측정 (SPEC §8 4단계, HG-4, D-I4-08, AC-I4-03) — 순수 함수 부분.
// 판매자가 녹음을 콘솔 음성으로 들려 "들린 말 기록"에서 옮긴 인식 문장 + 기대값 표(CSV)를 R-17 추출기(골든과 같은 extractVoice)로 채점한다.
// 파일 읽기·쓰기와 종료 코드는 packages/voice/scripts/accuracy.ts(명령)가 한다. 여기는 브라우저·Node 어디서나 돈다(시계·난수·입출력 없음).
// 화면 번들에 들어가지 않게 패키지 첫 입구(index.ts)가 아니라 하위 경로 `@livejjim/voice/accuracy`로 내보낸다.
import { formatWon, normalizeText } from '@livejjim/core'
import { isCardWorthy } from './card.ts'
import { DEFAULT_DICTIONARY } from './default-dictionary.ts'
import { buildDictionary, prepareDictionary } from './dictionary.ts'
import { extractVoice, type VoiceExtraction } from './extract.ts'

/** 첫 줄 열 이름 (정확히 이 순서·글자) */
export const ACCURACY_HEADER: readonly string[] = Object.freeze(['표본', '기대 번호', '기대 가격', '기대 품종', '인식 문장'])
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
  '                 (엑셀은 "CSV UTF-8(쉼표로 분리)"로 저장한다. 예시: packages/voice/samples/accuracy-example.csv)',
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
}

export interface AccuracySummary {
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

/**
 * 표본 파일(CSV 글) → 표본 목록. 첫 줄은 정확히 ACCURACY_HEADER. 칸이 모두 빈 줄은 건너뛴다.
 * 오류(열 이름 다름·칸 수 다름·기대 번호/가격 형식·표본 0개)는 쉬운 한국어 한 문장(몇 번째 줄인지 포함).
 */
export function parseAccuracySamples(text: string): Parsed<AccuracySample[]> {
  if (stripBom(text).trim() === '') return { ok: false, message: '표본 파일이 비어 있어요.' }
  const csv = parseCsv(text)
  if (!csv.ok) return csv
  const [header, ...rows] = csv.value
  if (header === undefined || header.cells.length !== ACCURACY_HEADER.length || header.cells.some((cell, i) => cell !== ACCURACY_HEADER[i])) {
    return { ok: false, message: `첫 줄의 열 이름은 정확히 "${ACCURACY_HEADER.join(',')}"이어야 해요.` }
  }
  const samples: AccuracySample[] = []
  for (const row of rows) {
    if (isBlankRow(row.cells)) continue
    if (row.cells.length !== ACCURACY_HEADER.length) {
      return { ok: false, message: `${String(row.line)}번째 줄의 칸이 ${String(row.cells.length)}개예요 — 5개(표본·기대 번호·기대 가격·기대 품종·인식 문장)여야 해요.` }
    }
    const [label = '', rawNo = '', rawPrice = '', rawName = '', sentence = ''] = row.cells
    const no = parseExpectedNumber(rawNo, row.line)
    if (!no.ok) return no
    const price = parseExpectedPrice(rawPrice, row.line)
    if (!price.ok) return price
    const name = normalizeText(rawName)
    samples.push({
      line: row.line,
      label: label.trim() === '' ? `${String(row.line)}번째 줄` : label.trim(),
      expectedNo: no.value,
      expectedPrice: price.value,
      expectedName: name === '' ? null : name,
      text: sentence,
    })
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

/** 표본 하나를 추출 결과로 채점한다 (칸마다 맞음·빈칸·틀림, 품종은 기대가 빈칸이면 채점 안 함) */
export function scoreSample(sample: AccuracySample, extraction: VoiceExtraction): ScoredSample {
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
  }
}

/** 표본들을 골든과 같은 추출기로 뽑아 채점한다. 사전 = 이력 이름 + 기본 사전(R-17 5 정리), maxNumber 기본 999 */
export function scoreSamples(samples: readonly AccuracySample[], options: AccuracyOptions = {}): ScoredSample[] {
  const dictionary = prepareDictionary(buildDictionary(options.history ?? [], DEFAULT_DICTIONARY))
  const maxNumber = options.maxNumber ?? ACCURACY_DEFAULT_MAX_NUMBER
  return samples.map((sample) => scoreSample(sample, extractVoice(sample.text, { maxNumber, dictionary })))
}

export function summarizeAccuracy(scored: readonly ScoredSample[]): AccuracySummary {
  const count = (predicate: (item: ScoredSample) => boolean): number => scored.filter(predicate).length
  return {
    samples: scored.length,
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

/** 쉬운 한국어 마크다운 보고서. 영어 상태값(HIGH·LOW·null)을 쓰지 않는다 */
export function renderAccuracyReport(scored: readonly ScoredSample[], summary: AccuracySummary, meta: ReportMeta): string {
  const lines: string[] = []
  lines.push('# 음성 추출 정확도 보고서', '')
  lines.push(`- 표본 파일: ${tableCell(meta.sampleFile)}`)
  lines.push(`- 품종 사전: 판매 이력 이름 ${String(meta.historyNames)}개 + 기본 사전 ${String(DEFAULT_DICTIONARY.length)}개`)
  lines.push(`- 최대 번호: ${String(meta.maxNumber)}번`)
  lines.push('')
  lines.push('## 요약', '')
  lines.push(`- 표본 수: ${String(summary.samples)}`)
  lines.push(`- 번호 맞음: ${formatRatio(summary.noCorrect, summary.samples)}`)
  lines.push(`- 가격 맞음: ${formatRatio(summary.priceCorrect, summary.samples)}`)
  lines.push(`- 번호·가격 둘 다 맞음: ${formatRatio(summary.bothCorrect, summary.samples)}`)
  lines.push(`- 품종 맞음: ${formatRatio(summary.nameCorrect, summary.nameScored)}`)
  lines.push(`- 틀린 값을 채움: ${String(summary.filledWrong)}`)
  lines.push(`- 확실한데 틀림: ${String(summary.confidentWrong)}`)
  lines.push(`- 카드가 만들어진 표본: ${String(summary.cardWorthy)}`)
  lines.push('')
  lines.push('## 살펴볼 표본', '')
  const risky = scored.filter((item) => item.filledWrong || item.confidentWrong)
  if (risky.length === 0) lines.push('- 없음 (틀린 값을 채우거나 확실한데 틀린 표본이 없어요)')
  for (const item of risky) {
    const why = [item.filledWrong ? '틀린 값을 채움' : '', item.confidentWrong ? '확실한데 틀림' : ''].filter((text) => text !== '').join(', ')
    lines.push(`- ${tableCell(item.sample.label)} (${String(item.sample.line)}번째 줄): ${why} — 문장 "${tableCell(item.sample.text)}"`)
  }
  lines.push('')
  lines.push('## 표본별 결과', '')
  lines.push('| 표본 | 인식 문장 | 기대 | 뽑은 값 | 신뢰도 | 번호 | 가격 | 품종 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const item of scored) {
    const { sample, extraction } = item
    const expected = `${showNo(sample.expectedNo)} · ${sample.expectedName ?? '품종 안 적음'} · ${showPrice(sample.expectedPrice)}`
    const got = `${showNo(extraction.no)} · ${extraction.name ?? '품종 없음'} · ${showPrice(extraction.price)}`
    const confidence = extraction.confidence === 'HIGH' ? '확실' : '확인 필요'
    lines.push(`| ${[sample.label, sample.text, expected, got, confidence, item.no, item.price, item.name].map(tableCell).join(' | ')} |`)
  }
  lines.push('')
  lines.push('## 읽는 법', '')
  lines.push('- 맞음: 뽑은 값이 기대와 같아요(기대가 빈칸이면 아무것도 뽑지 않아야 맞음).')
  lines.push('- 빈칸: 기대한 값이 있는데 뽑지 못했어요 — 카드에서 방송자가 채워요.')
  lines.push('- 틀림: 기대와 다른 값을 뽑았어요(기대가 빈칸인데 뽑은 것 포함) — 확인 없이 등록되면 판매 사고예요.')
  lines.push('- 채점 안 함: 기대 품종을 적지 않은 표본의 품종이에요.')
  lines.push('- 확실: 번호·품종·가격이 모두 있고 품종이 사전 이름과 같아요 — 자동 등록을 켜면 이 카드만 자동 등록돼요.')
  lines.push('- "틀린 값을 채움"이나 "확실한데 틀림"이 있으면 그 문장을 규칙 담당에게 넘겨 주세요. "확실한데 틀림"이 하나라도 있으면 자동 등록은 꺼 둔 채로 써요.')
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
