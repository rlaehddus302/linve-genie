// AC-KP1-17·18 방송 리포트 골든 (tests/golden/report/*.json, G-RPT-KP1-*): 서버 순수 함수 다섯으로 돌려 out과 깊은 같음.
// 파일 5·사례 36을 고정값으로 단언한다(빠지면 실패). 모르는 kind·키·중복 ID는 읽기 오류. TZ 셋에서 같다. 미구현 허용 장치는 없다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { reportBuckets, reportCompare, reportRush, reportSummary, reportVarieties } from '../src/report/rules.ts'

const FOLDER = fileURLToPath(new URL('../../../tests/golden/report', import.meta.url))
const KINDS = ['summary', 'buckets', 'varieties', 'rush', 'compare'] as const
type Kind = (typeof KINDS)[number]
const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'in', 'out']
const REQUIRED_CASE_KEYS = ['id', 'title', 'refs', 'in', 'out']

class ReadError extends Error {}

interface GoldenCase {
  readonly id: string
  readonly kind: Kind
  readonly input: never
  readonly out: unknown
}

function keysOnly(value: unknown, allowed: readonly string[], required: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ReadError(`${where}: 객체가 아니다`)
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ReadError(`${where}: 모르는 키 ${key}`)
  for (const key of required) if (!Object.hasOwn(record, key)) throw new ReadError(`${where}: ${key}가 없다`)
  return record
}

const int = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
const nonNegInt = (value: unknown) => int(value) && (value as number) >= 0
const str = (value: unknown) => typeof value === 'string'

function list(value: unknown, where: string, keys: readonly string[], check: (entry: Record<string, unknown>) => boolean): void {
  if (!Array.isArray(value)) throw new ReadError(`${where}: 배열이 아니다`)
  for (const [i, raw] of value.entries()) {
    const entry = keysOnly(raw, keys, keys, `${where}#${String(i)}`)
    if (!check(entry)) throw new ReadError(`${where}#${String(i)}: 값`)
  }
}

function checkInput(kind: Kind, value: unknown, where: string): void {
  const at = `${where}.in`
  switch (kind) {
    case 'summary': {
      const input = keysOnly(value, ['bundles', 'earlier'], ['bundles', 'earlier'], at)
      list(input.bundles, `${at}.bundles`, ['buyer', 'keys', 'items', 'subtotal', 'final', 'received'], (entry) =>
        str(entry.buyer) && Array.isArray(entry.keys) && entry.keys.every(str) && ['items', 'subtotal', 'final', 'received'].every((key) => nonNegInt(entry[key])))
      if (!Array.isArray(input.earlier) || !input.earlier.every(str)) throw new ReadError(`${at}.earlier`)
      return
    }
    case 'buckets': {
      const input = keysOnly(value, ['claims'], ['claims'], at)
      list(input.claims, `${at}.claims`, ['time', 'qty', 'amount'], (entry) => str(entry.time) && nonNegInt(entry.qty) && nonNegInt(entry.amount))
      return
    }
    case 'varieties': {
      const input = keysOnly(value, ['sales'], ['sales'], at)
      list(input.sales, `${at}.sales`, ['name', 'qty', 'amount'], (entry) => str(entry.name) && nonNegInt(entry.qty) && nonNegInt(entry.amount))
      return
    }
    case 'rush': {
      const input = keysOnly(value, ['products'], ['products'], at)
      list(input.products, `${at}.products`, ['b', 'no', 'name', 'stock', 'opened', 'claims'], (entry) => {
        if (!str(entry.b) || !nonNegInt(entry.no) || !str(entry.name) || !nonNegInt(entry.stock) || !(entry.opened === null || str(entry.opened))) return false
        list(entry.claims, `${at}.products.claims`, ['time', 'buyer'], (claim) => str(claim.time) && str(claim.buyer))
        return true
      })
      return
    }
    case 'compare': {
      const input = keysOnly(value, ['current', 'past'], ['current', 'past'], at)
      const current = keysOnly(input.current, ['sales', 'qty', 'buyers'], ['sales', 'qty', 'buyers'], `${at}.current`)
      if (!['sales', 'qty', 'buyers'].every((key) => nonNegInt(current[key]))) throw new ReadError(`${at}.current`)
      list(input.past, `${at}.past`, ['date', 'sales', 'qty', 'buyers'], (entry) => str(entry.date) && ['sales', 'qty', 'buyers'].every((key) => nonNegInt(entry[key])))
      return
    }
  }
}

/** 골든 파일 하나 읽기 (README "리포트 골든" 형식 계약 — 어긋나면 읽기 오류) */
function readGolden(text: string, file: string): GoldenCase[] {
  const root = keysOnly(JSON.parse(text), FILE_KEYS, FILE_KEYS, file)
  if (!KINDS.includes(root.kind as Kind)) throw new ReadError(`${file}: 모르는 kind`)
  const kind = root.kind as Kind
  if (!Array.isArray(root.cases)) throw new ReadError(`${file}: cases가 배열이 아니다`)
  return root.cases.map((raw, i) => {
    const where = `${file}#${String(i)}`
    const item = keysOnly(raw, CASE_KEYS, REQUIRED_CASE_KEYS, where)
    if (typeof item.id !== 'string' || !/^G-RPT-KP1-\d{3}$/.test(item.id)) throw new ReadError(`${where}: id`)
    if (typeof item.title !== 'string' || !Array.isArray(item.refs) || item.refs.length === 0) throw new ReadError(`${where}: title·refs`)
    if (item.note !== undefined && typeof item.note !== 'string') throw new ReadError(`${where}: note`)
    checkInput(kind, item.in, where)
    return { id: item.id, kind, input: item.in as never, out: item.out }
  })
}

function readAll(texts: readonly { readonly name: string; readonly text: string }[]): GoldenCase[] {
  const cases = texts.flatMap(({ name, text }) => readGolden(text, name))
  const seen = new Set<string>()
  for (const item of cases) {
    if (seen.has(item.id)) throw new ReadError(`중복 ID ${item.id}`)
    seen.add(item.id)
  }
  return cases
}

function run(item: GoldenCase): unknown {
  switch (item.kind) {
    case 'summary':
      return reportSummary(item.input)
    case 'buckets':
      return reportBuckets(item.input)
    case 'varieties':
      return reportVarieties(item.input)
    case 'rush':
      return reportRush(item.input)
    case 'compare':
      return reportCompare(item.input)
  }
}

const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.json'))
  .sort()
const texts = files.map((name) => ({ name, text: readFileSync(join(FOLDER, name), 'utf8') }))
const cases = readAll(texts)
const originalTz = process.env.TZ

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('AC-KP1-17·18 방송 리포트 골든', () => {
  it('파일 5개·사례 36개 (고정값), id는 폴더 전체에서 유일', () => {
    expect(files).toEqual(['buckets.json', 'compare.json', 'rush.json', 'summary.json', 'varieties.json'])
    expect(cases).toHaveLength(36)
    expect(new Set(cases.map((item) => item.id)).size).toBe(36)
    const counts = Object.fromEntries(KINDS.map((kind) => [kind, cases.filter((item) => item.kind === kind).length]))
    expect(counts).toEqual({ summary: 7, buckets: 7, varieties: 9, rush: 7, compare: 6 })
  })

  for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
    it(`TZ=${tz}: 사례마다 out과 깊은 같음`, () => {
      process.env.TZ = tz
      for (const item of cases) expect(run(item), item.id).toEqual(item.out)
    })
  }

  it('summary·buckets·varieties는 입력을 거꾸로 넣어도 같다', () => {
    for (const item of cases) {
      const input = item.input as Record<string, unknown>
      if (item.kind === 'summary') expect(reportSummary({ earlier: input.earlier as string[], bundles: [...(input.bundles as never[])].reverse() }), item.id).toEqual(item.out)
      if (item.kind === 'buckets') expect(reportBuckets({ claims: [...(input.claims as never[])].reverse() }), item.id).toEqual(item.out)
      if (item.kind === 'varieties') expect(reportVarieties({ sales: [...(input.sales as never[])].reverse() }), item.id).toEqual(item.out)
    }
  })

  it('금액은 정수 원 — 결과 JSON에 소수점 숫자가 없다', () => {
    for (const item of cases) expect(JSON.stringify(run(item)), item.id).not.toMatch(/\d\.\d/)
  })

  it('모르는 kind·키·빠진 칸·중복 ID는 읽기 오류다', () => {
    const summary = JSON.parse(texts.find((entry) => entry.name === 'summary.json')?.text ?? '') as { cases: Record<string, unknown>[] } & Record<string, unknown>
    const first = summary.cases[1] as Record<string, unknown>
    const firstIn = first.in as { bundles: Record<string, unknown>[]; earlier: string[] }
    const broken = [
      { ...summary, kind: 'other' },
      { ...summary, extra: 1 },
      { ...summary, cases: [{ ...first, expect: {} }] },
      { ...summary, cases: [{ ...first, in: { ...firstIn, typo: 1 } }] },
      { ...summary, cases: [{ ...first, in: { ...firstIn, bundles: [{ ...firstIn.bundles[0], name: '홍길동' }] } }] },
      { ...summary, cases: [{ ...first, in: { ...firstIn, bundles: [{ ...firstIn.bundles[0], subtotal: 1.5 }] } }] },
      { ...summary, cases: [{ ...first, out: undefined }] },
      { ...summary, cases: [{ ...first, id: 'G-RPT-1' }] },
    ]
    for (const value of broken) expect(() => readGolden(JSON.stringify(value), 'broken.json')).toThrow(ReadError)
    expect(() => readAll([...texts, { name: 'zz.json', text: texts[0]?.text ?? '' }])).toThrow(ReadError)
  })
})
