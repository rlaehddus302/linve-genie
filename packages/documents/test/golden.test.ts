// 문서 골든 (AC-O3-10 — tests/golden/README.md "문서 골든", D-O3-05~08): tests/golden/documents/*.json의 모든 사례를
// 그 시나리오(engine/*.yaml)를 실제 코어에 재생한 상태로 buildReceipt·buildLedger에 넣어 out과 깊은 같음으로 비교한다.
// 골든 파일은 보호 경로라 고치지 않는다. 파일 수·사례 수는 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { listSmsRefs, type EngineState } from '@livejjim/core'
import { parseGoldenYaml, validateDocument } from '@livejjim/core/golden'
import { describe, expect, it } from 'vitest'
import { buildLedger, buildReceipt, ledgerColumns, ledgerRowValuesWith } from '../src/index.ts'
import { replayGolden } from './helpers.ts'

const GOLDEN_ROOT = join(import.meta.dirname, '..', '..', '..', 'tests', 'golden')
const DOC_DIR = join(GOLDEN_ROOT, 'documents')

const FILE_KEYS = ['kind', 'about', 'cases']
const COMMON_KEYS = ['id', 'title', 'refs', 'note', 'scenario', 'out']
const CASE_KEYS = { receipt: [...COMMON_KEYS, 'date', 'buyer'], ledger: [...COMMON_KEYS, 'from', 'to', 'broadcasts'] } as const
const REQUIRED = { receipt: ['id', 'title', 'refs', 'scenario', 'out', 'date', 'buyer'], ledger: ['id', 'title', 'refs', 'scenario', 'out', 'from', 'to'] } as const
const OUT_KEYS = { receipt: ['lines', 'itemCount', 'subtotal'], ledger: ['columns', 'rows'] } as const
const ERROR_CODES = {
  receipt: ['NO_ITEMS', 'AMOUNT_MISMATCH', 'INVALID_INPUT'],
  ledger: ['INVALID_INPUT', 'PERIOD_INVALID', 'REHEARSAL', 'UNKNOWN_BROADCAST'],
} as const
const LINE_KEYS = ['session', 'no', 'item', 'price']
/** 사례 ID: `G-DOC-<스프린트>-` + 두 자리 */
const CASE_ID = /^G-DOC-[A-Z]\d+[a-z]?(?:-\d+)?-\d{2}$/

type Kind = keyof typeof CASE_KEYS
export interface DocCase {
  readonly id: string
  readonly title: string
  readonly scenario: string
  readonly date?: string
  readonly buyer?: string
  readonly from?: string
  readonly to?: string
  readonly broadcasts?: readonly string[]
  readonly out: Record<string, unknown>
}
interface DocFile {
  readonly file: string
  readonly kind: Kind
  readonly cases: readonly DocCase[]
}

/** 엔진 골든 시나리오 ID → 파일 (engine/*.yaml 모두에서 찾는다) */
function engineScenarios(): Map<string, string> {
  const dir = join(GOLDEN_ROOT, 'engine')
  const found = new Map<string, string>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const parsed = parseGoldenYaml(readFileSync(join(dir, file), 'utf8'))
    if (!parsed.ok) continue
    for (const document of parsed.documents) {
      const result = validateDocument(document.value)
      if (result.ok && result.doc.kind === 'scenario') found.set(result.doc.id, `engine/${file}`)
    }
  }
  return found
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

/** 문서 골든 파일 하나의 형식 검사 (README "문서 골든"). 어기면 읽기 오류로 던진다 */
export function checkDocFile(file: string, raw: unknown, scenarios: ReadonlyMap<string, string>, ids: Set<string>): DocFile {
  const where = `읽기 오류 ${file}`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${where}: 객체가 아니다`)
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) if (!FILE_KEYS.includes(key)) throw new Error(`${where}: 모르는 키 ${key}`)
  for (const key of FILE_KEYS) if (!Object.hasOwn(obj, key)) throw new Error(`${where}: ${key}가 없다`)
  const kind = obj.kind
  if (kind !== 'receipt' && kind !== 'ledger') throw new Error(`${where}: 모르는 kind ${String(kind)}`)
  if (typeof obj.about !== 'string') throw new Error(`${where}: about 형식`)
  if (!Array.isArray(obj.cases) || obj.cases.length === 0) throw new Error(`${where}: cases가 비었다`)
  for (const item of obj.cases as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`${where}: 사례가 객체가 아니다`)
    const c = item as Record<string, unknown>
    const at = `${where} ${String(c.id)}`
    for (const key of Object.keys(c)) if (!(CASE_KEYS[kind] as readonly string[]).includes(key)) throw new Error(`${at}: 모르는 키 ${key}`)
    for (const key of REQUIRED[kind]) if (!Object.hasOwn(c, key)) throw new Error(`${at}: ${key}가 없다`)
    if (typeof c.id !== 'string' || !CASE_ID.test(c.id)) throw new Error(`${at}: id 형식`)
    if (ids.has(c.id)) throw new Error(`${at}: 겹친 id`)
    ids.add(c.id)
    if (typeof c.title !== 'string') throw new Error(`${at}: title 형식`)
    if (!isStringList(c.refs) || c.refs.length === 0) throw new Error(`${at}: refs가 비었다`)
    if (c.note !== undefined && typeof c.note !== 'string') throw new Error(`${at}: note 형식`)
    if (typeof c.scenario !== 'string' || !scenarios.has(c.scenario)) throw new Error(`${at}: 없는 시나리오 ${String(c.scenario)}`)
    if (kind === 'receipt') {
      if (typeof c.date !== 'string' || typeof c.buyer !== 'string') throw new Error(`${at}: date·buyer 형식`)
    } else {
      if (typeof c.from !== 'string' || typeof c.to !== 'string') throw new Error(`${at}: from·to 형식`)
      if (c.broadcasts !== undefined && !isStringList(c.broadcasts)) throw new Error(`${at}: broadcasts 형식`)
    }
    const out = c.out
    if (typeof out !== 'object' || out === null || Array.isArray(out)) throw new Error(`${at}: out 형식`)
    const o = out as Record<string, unknown>
    if ('error' in o) {
      if (Object.keys(o).length !== 1 || !(ERROR_CODES[kind] as readonly string[]).includes(o.error as string)) throw new Error(`${at}: 오류 out 형식`)
      continue
    }
    for (const key of Object.keys(o)) if (!(OUT_KEYS[kind] as readonly string[]).includes(key)) throw new Error(`${at}: 모르는 out 키 ${key}`)
    for (const key of OUT_KEYS[kind]) if (!Object.hasOwn(o, key)) throw new Error(`${at}: out.${key}가 없다`)
    if (kind === 'receipt') {
      if (!Array.isArray(o.lines)) throw new Error(`${at}: out.lines 형식`)
      for (const line of o.lines as unknown[]) {
        if (typeof line !== 'object' || line === null) throw new Error(`${at}: 줄 형식`)
        const keys = Object.keys(line)
        if (keys.length !== LINE_KEYS.length || !LINE_KEYS.every((k) => keys.includes(k))) throw new Error(`${at}: 줄 키 ${keys.join(',')}`)
      }
      if (!Number.isSafeInteger(o.itemCount) || !Number.isSafeInteger(o.subtotal)) throw new Error(`${at}: itemCount·subtotal 형식`)
    } else {
      if (!isStringList(o.columns)) throw new Error(`${at}: out.columns 형식`)
      if (!Array.isArray(o.rows) || !(o.rows as unknown[]).every((row) => Array.isArray(row) && row.length === (o.columns as string[]).length)) throw new Error(`${at}: out.rows 형식`)
    }
  }
  return { file, kind, cases: obj.cases as DocCase[] }
}

function loadGolden(scenarios: ReadonlyMap<string, string>): DocFile[] {
  const ids = new Set<string>()
  return readdirSync(DOC_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => checkDocFile(file, JSON.parse(readFileSync(join(DOC_DIR, file), 'utf8')) as unknown, scenarios, ids))
}

/** 엔진 골든의 구매자 키 → 구매자 ID (코어 어댑터 buyerIdOf와 같은 풀이: `sms:<ref>`는 그 ref의 처음 문자찜이 정한 구매자) */
function buyerIdOf(state: EngineState, key: string): string {
  if (!key.startsWith('sms:')) return key
  return listSmsRefs(state).find((r) => r.ref === key.slice(4))?.buyer ?? key
}

const scenarios = engineScenarios()
const golden = loadGolden(scenarios)
const states = new Map<string, EngineState>()
const stateOf = (id: string): EngineState => {
  let state = states.get(id)
  if (state === undefined) {
    state = replayGolden(id, scenarios.get(id))
    states.set(id, state)
  }
  return state
}

/** 사례 하나를 돌린 결과 (out과 같은 모양) */
function run(kind: Kind, c: DocCase): Record<string, unknown> {
  const state = stateOf(c.scenario)
  if (kind === 'receipt') {
    const result = buildReceipt({ state, date: c.date as string, buyer: buyerIdOf(state, c.buyer as string), rehearsal: false, createdAt: Date.UTC(2026, 9, 25, 14, 0, 0) })
    if (!result.ok) return { error: result.error.code }
    const r = result.receipt
    return { lines: r.lines.map((line) => ({ session: line.session, no: line.no, item: line.name, price: line.priceText })), itemCount: r.itemCount, subtotal: r.subtotal }
  }
  const result = buildLedger({ scopes: [{ state, rehearsal: false }], from: c.from as string, to: c.to as string, ...(c.broadcasts === undefined ? {} : { broadcasts: c.broadcasts }) })
  if (!result.ok) return { error: result.error.code }
  return { columns: [...ledgerColumns(result.options)], rows: result.rows.map((row) => ledgerRowValuesWith(row, result.options)) }
}

describe('문서 골든 (AC-O3-10)', () => {
  it('파일 2개 · 사례 6개(receipt 3 · ledger 3)를 읽는다', () => {
    expect(golden.map((g) => g.file)).toEqual(['ledger.json', 'receipt.json'])
    expect(golden.find((g) => g.file === 'receipt.json')?.cases).toHaveLength(3)
    expect(golden.find((g) => g.file === 'ledger.json')?.cases).toHaveLength(3)
    expect(golden.reduce((n, g) => n + g.cases.length, 0)).toBe(6)
  })

  it('형식을 어긴 골든은 읽기 오류다', () => {
    const good = JSON.parse(readFileSync(join(DOC_DIR, 'receipt.json'), 'utf8')) as { kind: string; about: string; cases: Record<string, unknown>[] }
    const first = good.cases[0] as Record<string, unknown>
    const broken: [string, unknown][] = [
      ['파일의 모르는 키', { ...good, extra: 1 }],
      ['모르는 kind', { ...good, kind: 'invoice' }],
      ['사례의 모르는 키', { ...good, cases: [{ ...first, memo: 'x' }] }],
      ['빠진 키', { ...good, cases: [{ ...first, buyer: undefined }].map((c) => JSON.parse(JSON.stringify(c)) as unknown) }],
      ['id 형식', { ...good, cases: [{ ...first, id: 'G-DOC-1' }] }],
      ['겹친 id', { ...good, cases: [first, first] }],
      ['없는 시나리오', { ...good, cases: [{ ...first, scenario: 'G-ENG-NOPE-01' }] }],
      ['모르는 out 키', { ...good, cases: [{ ...first, out: { ...(first.out as object), total: 1 } }] }],
      ['모르는 오류 코드', { ...good, cases: [{ ...first, out: { error: 'OOPS' } }] }],
      ['줄 키', { ...good, cases: [{ ...first, out: { lines: [{ session: 'a', no: 1, item: 'b' }], itemCount: 1, subtotal: 1 } }] }],
      ['ledger 열 수와 행 길이', { kind: 'ledger', about: '', cases: [{ id: 'G-DOC-O3-99', title: 't', refs: ['x'], scenario: 'G-ENG-O3-01', from: '2026-10-25', to: '2026-10-25', out: { columns: ['a', 'b'], rows: [['x']] } }] }],
    ]
    for (const [title, raw] of broken) expect(() => checkDocFile('broken.json', raw, scenarios, new Set()), title).toThrow(/읽기 오류/)
    expect(() => checkDocFile('receipt.json', good, scenarios, new Set())).not.toThrow()
  })

  for (const g of golden) {
    describe(g.file, () => {
      for (const c of g.cases) it(`${c.id} ${c.title}`, () => expect(run(g.kind, c)).toStrictEqual(c.out))
    })
  }
})
