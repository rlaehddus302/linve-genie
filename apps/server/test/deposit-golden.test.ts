// AC-N3-01·02·03·04·05, AC-SMS3-03: 입금 골든(tests/golden/deposit/*.json)을 서버의 순수 함수 넷으로 돌린다.
// - 파일 수 4·사례 수 98(name 10 · paste 14 · match 21 · notice 53 — D-DEP2-12·16·17 G-DEP-248~253까지)를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
// - 모르는 kind·모르는 키·중복 ID·ID 형식 오류는 시험 실패(읽기 오류)다. 미구현을 허용하는 장치가 없다.
// - 결과는 실행 환경 시간대와 상관없다: TZ를 바꿔 두 번씩 돌려 같은지 본다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parseOffsetIso } from '../src/deposit/calendar.ts'
import { matchDeposits, type MatchBundle, type MatchDeposit } from '../src/deposit/match.ts'
import { normalizeDepositName } from '../src/deposit/name.ts'
import { readBankNotice, type NoticeInput } from '../src/deposit/notice.ts'
import { PASTE_ROWS_MAX, readPaste } from '../src/deposit/paste.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/deposit/', import.meta.url))
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url))

type Kind = 'name' | 'paste' | 'match' | 'notice'
interface GoldenCase {
  readonly id: string
  readonly title: string
  readonly refs: readonly string[]
  readonly note?: string
  readonly out: unknown
  readonly [key: string]: unknown
}
interface GoldenFile {
  readonly file: string
  readonly kind: Kind
  readonly cases: readonly GoldenCase[]
}

const FILE_KEYS = ['kind', 'about', 'cases']
const COMMON_KEYS = ['id', 'title', 'refs', 'note', 'out']
const KIND_KEYS: Readonly<Record<Kind, readonly string[]>> = { name: ['in'], paste: ['in'], match: ['bundles', 'earlier', 'incoming'], notice: ['in'] }
const BUNDLE_KEYS = ['key', 'buyer', 'date', 'names', 'total', 'received', 'saleAt']
const DEPOSIT_KEYS = ['no', 'at', 'amount', 'name']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 골든 파일 글을 엄격히 검사한다 (문제가 있으면 문장 목록) */
function checkGolden(sources: readonly { readonly file: string; readonly text: string }[]): { files: GoldenFile[]; problems: string[] } {
  const problems: string[] = []
  const files: GoldenFile[] = []
  const ids = new Map<string, string>()
  for (const { file, text } of sources) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      problems.push(`${file}: JSON이 아니다`)
      continue
    }
    if (!isObject(parsed)) {
      problems.push(`${file}: 객체가 아니다`)
      continue
    }
    for (const key of Object.keys(parsed)) if (!FILE_KEYS.includes(key)) problems.push(`${file}: 모르는 파일 키 '${key}'`)
    const kind = parsed.kind
    if (kind !== 'name' && kind !== 'paste' && kind !== 'match' && kind !== 'notice') {
      problems.push(`${file}: 모르는 kind ${JSON.stringify(kind)}`)
      continue
    }
    if (typeof parsed.about !== 'string') problems.push(`${file}: about이 없다`)
    if (!Array.isArray(parsed.cases)) {
      problems.push(`${file}: cases가 목록이 아니다`)
      continue
    }
    const cases: GoldenCase[] = []
    parsed.cases.forEach((raw: unknown, index: number) => {
      const where = `${file} cases[${String(index)}]`
      if (!isObject(raw)) {
        problems.push(`${where}: 객체가 아니다`)
        return
      }
      for (const key of Object.keys(raw)) if (!COMMON_KEYS.includes(key) && !KIND_KEYS[kind].includes(key)) problems.push(`${where}: 모르는 사례 키 '${key}'`)
      for (const key of ['id', 'title', 'refs', 'out', ...KIND_KEYS[kind]]) if (!Object.hasOwn(raw, key)) problems.push(`${where}: 필수 키 '${key}'가 없다`)
      const id = raw.id
      if (typeof id !== 'string' || !/^G-DEP-\d{3}$/.test(id)) problems.push(`${where}: ID 형식 오류`)
      else if (ids.has(id)) problems.push(`${where}: ID 중복 ${id} (처음: ${ids.get(id) ?? ''})`)
      else ids.set(id, where)
      if (!Array.isArray(raw.refs) || raw.refs.length === 0) problems.push(`${where}: refs는 1개 이상`)
      if (kind === 'match') {
        for (const bundle of Array.isArray(raw.bundles) ? (raw.bundles as unknown[]) : []) {
          if (!isObject(bundle)) problems.push(`${where}: 묶음이 객체가 아니다`)
          else for (const key of Object.keys(bundle)) if (!BUNDLE_KEYS.includes(key)) problems.push(`${where}: 모르는 묶음 키 '${key}'`)
        }
        for (const list of ['earlier', 'incoming']) {
          for (const deposit of Array.isArray(raw[list]) ? (raw[list] as unknown[]) : []) {
            if (!isObject(deposit)) problems.push(`${where}: 입금이 객체가 아니다`)
            else for (const key of Object.keys(deposit)) if (!DEPOSIT_KEYS.includes(key)) problems.push(`${where}: 모르는 입금 키 '${key}'`)
          }
        }
      }
      cases.push(raw as GoldenCase)
    })
    files.push({ file, kind, cases })
  }
  return { files, problems }
}

function loadGolden(): { files: GoldenFile[]; problems: string[] } {
  const names = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.json')).sort()
  return checkGolden(names.map((file) => ({ file, text: readFileSync(join(GOLDEN_DIR, file), 'utf8') })))
}

const ms = (text: unknown): number => {
  const value = parseOffsetIso(String(text))
  if (value === null) throw new Error(`시각 형식 오류: ${String(text)}`)
  return value
}

const toBundles = (raw: unknown): MatchBundle[] =>
  (raw as Record<string, unknown>[]).map((bundle) => ({
    key: bundle.key as string,
    buyer: bundle.buyer as string,
    date: bundle.date as string,
    names: bundle.names as string[],
    total: bundle.total as number,
    received: bundle.received as number,
    saleAt: bundle.saleAt === null ? null : ms(bundle.saleAt),
  }))
const toDeposits = (raw: unknown): MatchDeposit[] =>
  (raw as Record<string, unknown>[]).map((deposit) => ({ no: deposit.no as number, at: ms(deposit.at), amount: deposit.amount as number, name: deposit.name as string }))

/** 사례 하나를 그 kind의 함수로 돌린다 */
function runCase(kind: Kind, item: GoldenCase): unknown {
  if (kind === 'name') return normalizeDepositName(item.in as string)
  if (kind === 'paste') return readPaste(item.in as string)
  if (kind === 'notice') return readBankNotice(item.in as NoticeInput)
  return matchDeposits({ bundles: toBundles(item.bundles), earlier: toDeposits(item.earlier), incoming: toDeposits(item.incoming) })
}

const loaded = loadGolden()
const originalTz = process.env.TZ

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('입금 골든 읽기 (AC-N3-04)', () => {
  it('형식 오류가 없다 — 모르는 kind·키, 중복 ID, ID 형식 오류는 실패', () => {
    expect(loaded.problems).toEqual([])
  })

  it('파일 4 · 사례 98 (name 10 · paste 14 · match 21 · notice 53)', () => {
    expect(loaded.files.length).toBe(4)
    const count = (kind: Kind) => loaded.files.filter((file) => file.kind === kind).reduce((sum, file) => sum + file.cases.length, 0)
    expect({ name: count('name'), paste: count('paste'), match: count('match'), notice: count('notice') }).toEqual({ name: 10, paste: 14, match: 21, notice: 53 })
    expect(loaded.files.reduce((sum, file) => sum + file.cases.length, 0)).toBe(98)
  })

  it('검사기가 모르는 키·kind·중복·ID 형식을 실제로 잡는다', () => {
    const one = (extra: Record<string, unknown> = {}) => ({ id: 'G-DEP-001', title: 't', refs: ['DP-3'], in: '', out: '', ...extra })
    const file = (kind: string, cases: unknown[], extra: Record<string, unknown> = {}) => ({ file: `${kind}.json`, text: JSON.stringify({ kind, about: 'x', cases, ...extra }) })
    const problems = (sources: { file: string; text: string }[]) => checkGolden(sources).problems.join('\n')
    expect(problems([file('name', [one({ extra: 1 })])])).toMatch(/모르는 사례 키 'extra'/)
    expect(problems([file('name', [one(), one()])])).toMatch(/ID 중복 G-DEP-001/)
    expect(problems([file('name', [one({ id: 'G-DEP-1' })])])).toMatch(/ID 형식 오류/)
    expect(problems([file('nmae', [one()])])).toMatch(/모르는 kind/)
    expect(problems([file('name', [one()], { version: 2 })])).toMatch(/모르는 파일 키 'version'/)
    expect(problems([file('name', [{ id: 'G-DEP-002', title: 't', refs: ['x'], in: '' }])])).toMatch(/필수 키 'out'/)
    expect(problems([file('match', [{ id: 'G-DEP-003', title: 't', refs: ['x'], bundles: [{ key: 'k', extra: 1 }], earlier: [{ no: 1, memo: 'x' }], incoming: [], out: [] }])])).toMatch(
      /모르는 묶음 키 'extra'[\s\S]*모르는 입금 키 'memo'/,
    )
    expect(problems([{ file: 'x.json', text: '{' }])).toMatch(/JSON이 아니다/)
    // 두 파일 사이의 중복도 잡는다
    expect(problems([file('name', [one()]), file('paste', [one()])])).toMatch(/ID 중복/)
  })
})

describe('입금 골든 = 서버 순수 함수 (AC-N3-01·02·03, AC-SMS3-03)', () => {
  for (const file of loaded.files) {
    for (const item of file.cases) {
      it(`${item.id} ${item.title}`, () => {
        expect(runCase(file.kind, item)).toEqual(item.out)
      })
    }
  }
})

describe('결정성 — 시계·시간대와 상관없다 (AC-N3-02·05)', () => {
  it('TZ=Pacific/Honolulu·Asia/Seoul·UTC에서 두 번씩 돌려도 결과가 같다', () => {
    const results: string[] = []
    for (const tz of ['Pacific/Honolulu', 'Asia/Seoul', 'UTC']) {
      process.env.TZ = tz
      for (let round = 0; round < 2; round++) {
        results.push(JSON.stringify(loaded.files.map((file) => file.cases.map((item) => runCase(file.kind, item)))))
      }
    }
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe(JSON.stringify(loaded.files.map((file) => file.cases.map((item) => item.out))))
  })

  it('네 순수 함수의 소스는 시계·난수·Intl·localeCompare·실행 환경을 쓰지 않는다', () => {
    for (const file of ['deposit/name.ts', 'deposit/paste.ts', 'deposit/match.ts', 'deposit/calendar.ts', 'deposit/notice.ts']) {
      const code = readFileSync(join(SRC_DIR, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/**'))
        .join('\n')
      expect(code, file).not.toMatch(/\bDate\b|Math\.random|\bIntl\b|localeCompare|toLocale|\bprocess\b|performance|crypto|setTimeout/)
    }
  })

  it('이름 정규화(NFKC)는 name.ts 한 곳에만 있다 — 다른 곳은 normalizeDepositName을 부른다 (AC-N3-01)', () => {
    // 예외 하나: 화면 이름 표기(BUY-01, D-098)의 "같은 모양" 비교(bundles.ts sameLook) — 공백을 한 칸으로 줄일 뿐 지우지 않아 DP-3이 아니다
    // 예외 둘: 은행 알림 읽기(DP-9 2, SMS3)의 알림 글 정규화 — 이름 비교가 아니라 알림 글 전체를 읽기 전에 한 번(NFKC 한 곳)
    const allowed = new Map([
      [join('deposit', 'bundles.ts'), /\.replace\(\/\\s\+\/gu, ' '\)/],
      [join('deposit', 'notice.ts'), /\.normalize\('NFKC'\)/],
    ])
    const offenders: string[] = []
    const callers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts') && !full.endsWith(join('deposit', 'name.ts'))) {
          const text = readFileSync(full, 'utf8')
          const exception = [...allowed].find(([file]) => full.endsWith(file))
          if (/NFKC/.test(text) && (exception === undefined || !exception[1].test(text) || (text.match(/NFKC/g) ?? []).length !== 1)) offenders.push(full)
          if (text.includes('normalizeDepositName(')) callers.push(entry.name)
        }
      }
    }
    walk(SRC_DIR)
    expect(offenders).toEqual([])
    // 맞추기·붙여넣기 줄 키·기억한 입금자명 저장이 같은 함수를 부른다
    expect(callers).toEqual(expect.arrayContaining(['match.ts', 'service.ts']))
  })
})

describe('붙여넣기 줄 수 상한 (AC-N3-02)', () => {
  const header = '거래일시\t입금자\t입금액'
  const row = (i: number) => `2026.10.18 21:${String(i % 60).padStart(2, '0')}:00\t김영희${String(i)}\t${String(1000 + i)}`

  it(`머리글 아래 ${String(PASTE_ROWS_MAX)}줄은 읽는다`, () => {
    const lines = [header, ...Array.from({ length: PASTE_ROWS_MAX }, (_, i) => row(i))]
    const result = readPaste(`${lines.join('\n')}\n`)
    expect('rows' in result && result.rows.length).toBe(PASTE_ROWS_MAX)
  })

  it(`${String(PASTE_ROWS_MAX + 1)}줄이면 TOO_MANY_ROWS이고 아무 줄도 읽지 않는다`, () => {
    const lines = [header, ...Array.from({ length: PASTE_ROWS_MAX + 1 }, (_, i) => row(i))]
    expect(readPaste(lines.join('\n'))).toEqual({ error: 'TOO_MANY_ROWS' })
  })

  it('빈 줄은 줄 수에 세지 않는다', () => {
    const lines = [header, ...Array.from({ length: PASTE_ROWS_MAX }, (_, i) => row(i)), '', '\t\t', '']
    const result = readPaste(lines.join('\r\n'))
    expect('rows' in result && result.rows.length).toBe(PASTE_ROWS_MAX)
  })
})
