// AC-KP1-01 (customers 부분) 손님 장부 골든 (tests/golden/customers/*.json, G-CUS-KP1-*): 서버 순수 함수(customers/ledger-rules.ts)로 돌려 out과 깊은 같음.
// 파일 4개·사례 44개를 고정값으로 단언한다(빠지면 실패). 모르는 kind·키·중복 ID는 읽기 오류. TZ 셋에서 같다. 미구현 허용 장치는 없다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { customerBadge, ledgerDeleteOn, matchLinkCode, showLedgerPrefill } from '../src/customers/ledger-rules.ts'

const FOLDER = fileURLToPath(new URL('../../../tests/golden/customers', import.meta.url))
const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'in', 'out']
const REQUIRED_CASE_KEYS = ['id', 'title', 'refs', 'in', 'out']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = [6, 12, 24, 36]

type Kind = 'retention' | 'code' | 'badge' | 'prefill'

interface GoldenCase {
  readonly file: string
  readonly kind: Kind
  readonly id: string
  readonly in: Record<string, unknown>
  readonly out: Record<string, unknown>
}

class ReadError extends Error {}

function keysOnly(value: unknown, allowed: readonly string[], required: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ReadError(`${where}: 객체가 아니다`)
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ReadError(`${where}: 모르는 키 ${key}`)
  for (const key of required) if (!Object.hasOwn(record, key)) throw new ReadError(`${where}: ${key}가 없다`)
  return record
}

const bool = (value: unknown) => typeof value === 'boolean'
const nonNegInt = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const date = (value: unknown) => typeof value === 'string' && DATE_RE.test(value)

/** kind마다 in·out 모양 */
const SHAPES: Record<Kind, { in: readonly string[]; out: readonly string[]; check: (input: Record<string, unknown>, out: Record<string, unknown>) => boolean }> = {
  retention: {
    in: ['lastOrder', 'consentOrder', 'consentMonths', 'settingMonths'],
    out: ['deleteOn'],
    check: (i, o) => (i.lastOrder === null || date(i.lastOrder)) && date(i.consentOrder) && MONTHS.includes(i.consentMonths as number) && MONTHS.includes(i.settingMonths as number) && date(o.deleteOn),
  },
  code: {
    in: ['text', 'codes'],
    out: ['code'],
    check: (i, o) => typeof i.text === 'string' && Array.isArray(i.codes) && i.codes.every((code) => typeof code === 'string') && (o.code === null || typeof o.code === 'string'),
  },
  badge: {
    in: ['show', 'rehearsal', 'known', 'earlier', 'regular', 'caution', 'purchaseTotal'],
    out: ['text'],
    check: (i, o) => ['show', 'rehearsal', 'known', 'earlier', 'regular', 'caution'].every((key) => bool(i[key])) && nonNegInt(i.purchaseTotal) && (o.text === null || typeof o.text === 'string'),
  },
  prefill: {
    in: ['items', 'shipping', 'saved', 'lines'],
    out: ['ledger'],
    check: (i, o) => nonNegInt(i.items) && ['NONE', 'FIXED', 'PICKUP', 'COMBINED'].includes(i.shipping as string) && ['NONE', 'UNCONFIRMED', 'CONFIRMED'].includes(i.saved as string) && nonNegInt(i.lines) && bool(o.ledger),
  },
}

/** 골든 파일 하나 읽기 (README "손님 장부 골든" 형식 계약 — 어긋나면 읽기 오류) */
function readGolden(text: string, file: string): GoldenCase[] {
  const root = keysOnly(JSON.parse(text), FILE_KEYS, FILE_KEYS, file)
  const kind = root.kind as Kind
  if (typeof root.kind !== 'string' || !Object.hasOwn(SHAPES, root.kind)) throw new ReadError(`${file}: 모르는 kind`)
  if (typeof root.about !== 'string') throw new ReadError(`${file}: about`)
  if (!Array.isArray(root.cases) || root.cases.length === 0) throw new ReadError(`${file}: cases가 배열이 아니다`)
  const shape = SHAPES[kind]
  return root.cases.map((raw, i) => {
    const where = `${file}#${String(i)}`
    const item = keysOnly(raw, CASE_KEYS, REQUIRED_CASE_KEYS, where)
    if (typeof item.id !== 'string' || !/^G-CUS-KP1-\d{3}$/.test(item.id)) throw new ReadError(`${where}: id`)
    if (typeof item.title !== 'string' || item.title === '') throw new ReadError(`${where}: title`)
    if (!Array.isArray(item.refs) || item.refs.length === 0 || !item.refs.every((ref) => typeof ref === 'string')) throw new ReadError(`${where}: refs`)
    if (Object.hasOwn(item, 'note') && typeof item.note !== 'string') throw new ReadError(`${where}: note`)
    const input = keysOnly(item.in, shape.in, shape.in, `${where}.in`)
    const out = keysOnly(item.out, shape.out, shape.out, `${where}.out`)
    if (!shape.check(input, out)) throw new ReadError(`${where}: 값 모양`)
    return { file, kind, id: item.id, in: input, out }
  })
}

/** 폴더 전체 읽기 (ID는 폴더 전체에서 유일) */
function readAll(texts: readonly { name: string; text: string }[]): GoldenCase[] {
  const all = texts.flatMap(({ name, text }) => readGolden(text, name))
  const seen = new Set<string>()
  for (const item of all) {
    if (seen.has(item.id)) throw new ReadError(`${item.id}: 겹치는 ID`)
    seen.add(item.id)
  }
  return all
}

function run(item: GoldenCase): unknown {
  switch (item.kind) {
    case 'retention':
      return ledgerDeleteOn(item.in as unknown as Parameters<typeof ledgerDeleteOn>[0])
    case 'code':
      return matchLinkCode(item.in as unknown as Parameters<typeof matchLinkCode>[0])
    case 'badge':
      return customerBadge(item.in as unknown as Parameters<typeof customerBadge>[0])
    case 'prefill':
      return showLedgerPrefill(item.in as unknown as Parameters<typeof showLedgerPrefill>[0])
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

describe('AC-KP1-01 손님 장부 골든 (customers/)', () => {
  it('파일 4개·사례 44개 (고정값), kind마다 사례 수', () => {
    expect(files).toEqual(['badge.json', 'code.json', 'prefill.json', 'retention.json'])
    expect(cases).toHaveLength(44)
    const count = (kind: Kind) => cases.filter((item) => item.kind === kind).length
    expect([count('retention'), count('code'), count('badge'), count('prefill')]).toEqual([11, 14, 10, 9])
  })

  for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
    it(`TZ=${tz}: 사례마다 out과 깊은 같음`, () => {
      process.env.TZ = tz
      for (const item of cases) expect(run(item), `${item.file} ${item.id}`).toEqual(item.out)
    })
  }

  it('모르는 kind·파일 키·사례 키·in/out 키, 겹치는 ID는 읽기 오류다', () => {
    const base = JSON.parse(texts.find((item) => item.name === 'code.json')?.text ?? '') as { kind: string; about: string; cases: Record<string, unknown>[] }
    const first = base.cases[0] as Record<string, unknown>
    const broken = [
      { ...base, kind: 'other' },
      { ...base, extra: 1 },
      { ...base, cases: [{ ...first, expect: {} }] },
      { ...base, cases: [{ ...first, in: { ...(first.in as object), typo: 1 } }] },
      { ...base, cases: [{ ...first, out: { code: null, more: true } }] },
      { ...base, cases: [{ ...first, out: undefined }] },
      { ...base, cases: [{ ...first, id: 'G-CUS-1' }] },
      { ...base, cases: [{ ...first, in: { text: 5, codes: [] } }] },
    ]
    for (const value of broken) expect(() => readGolden(JSON.stringify(value), 'broken.json')).toThrow(ReadError)
    expect(() => readAll([...texts, { name: 'zz-copy.json', text: JSON.stringify({ ...base, cases: [first] }) }])).toThrow(ReadError)
  })
})
