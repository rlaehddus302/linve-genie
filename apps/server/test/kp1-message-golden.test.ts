// AC-KP1-25 메시지 규칙 골든 (tests/golden/message/*.json, G-MSG-KP1-*): 서버 순수 함수 넷으로 돌려 out과 깊은 같음.
// 파일 4·사례 57을 고정값으로 단언한다(빠지면 실패). 모르는 kind·키·중복 ID는 읽기 오류. TZ 셋에서 같다. 미구현 허용 장치는 없다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { canSendAt, composeMessage, consentStatus, isMessageKind, messageBytes, type ComposeInput, type ConsentRecord, type MessagePrice, type WindowInput } from '../src/messaging/rules.ts'

const FOLDER = fileURLToPath(new URL('../../../tests/golden/message', import.meta.url))
const KINDS = ['bytes', 'compose', 'window', 'consent'] as const
type Kind = (typeof KINDS)[number]
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'in', 'out']
const REQUIRED_CASE_KEYS = ['id', 'title', 'refs', 'in', 'out']
const IN_KEYS: Record<Kind, readonly string[] | null> = {
  bytes: null,
  compose: ['kind', 'shop', 'body', 'optOut', 'recipients'],
  window: ['kind', 'at'],
  consent: ['now', 'records'],
}

class ReadError extends Error {}

interface GoldenCase {
  readonly id: string
  readonly kind: Kind
  readonly price: MessagePrice | null
  readonly input: unknown
  readonly out: unknown
}

function keysOnly(value: unknown, allowed: readonly string[], required: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ReadError(`${where}: 객체가 아니다`)
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ReadError(`${where}: 모르는 키 ${key}`)
  for (const key of required) if (!Object.hasOwn(record, key)) throw new ReadError(`${where}: ${key}가 없다`)
  return record
}

const nonNegInt = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function checkInput(kind: Kind, value: unknown, where: string): void {
  const keys = IN_KEYS[kind]
  if (keys === null) {
    if (typeof value !== 'string') throw new ReadError(`${where}.in: 글이 아니다`)
    return
  }
  const input = keysOnly(value, keys, keys, `${where}.in`)
  if (kind === 'compose') {
    if (!isMessageKind(input.kind) || typeof input.shop !== 'string' || typeof input.body !== 'string' || typeof input.optOut !== 'string' || !nonNegInt(input.recipients)) throw new ReadError(`${where}.in`)
  } else if (kind === 'window') {
    if (!isMessageKind(input.kind) || typeof input.at !== 'string') throw new ReadError(`${where}.in`)
  } else {
    if (typeof input.now !== 'string' || !Array.isArray(input.records)) throw new ReadError(`${where}.in`)
    for (const [j, record] of input.records.entries()) {
      const entry = keysOnly(record, ['type', 'at'], ['type', 'at'], `${where}.in.records#${String(j)}`)
      if (!['AGREE', 'VERIFY', 'WITHDRAW', 'NOTICE'].includes(entry.type as string) || typeof entry.at !== 'string') throw new ReadError(`${where}.in.records#${String(j)}`)
    }
  }
}

/** 골든 파일 하나 읽기 (README "메시지 골든" 형식 계약 — 어긋나면 읽기 오류) */
function readGolden(text: string, file: string): GoldenCase[] {
  const root = JSON.parse(text) as unknown
  if (typeof root !== 'object' || root === null) throw new ReadError(`${file}: 객체가 아니다`)
  const kind = (root as Record<string, unknown>).kind
  if (!KINDS.includes(kind as Kind)) throw new ReadError(`${file}: 모르는 kind`)
  const fileKeys = kind === 'compose' ? ['kind', 'about', 'price', 'cases'] : ['kind', 'about', 'cases']
  const record = keysOnly(root, fileKeys, fileKeys, file)
  let price: MessagePrice | null = null
  if (kind === 'compose') {
    const raw = keysOnly(record.price, ['SMS', 'LMS'], ['SMS', 'LMS'], `${file}.price`)
    if (!nonNegInt(raw.SMS) || !nonNegInt(raw.LMS)) throw new ReadError(`${file}.price`)
    price = raw as unknown as MessagePrice
  }
  if (!Array.isArray(record.cases)) throw new ReadError(`${file}: cases가 배열이 아니다`)
  return record.cases.map((raw, i) => {
    const where = `${file}#${String(i)}`
    const item = keysOnly(raw, CASE_KEYS, REQUIRED_CASE_KEYS, where)
    if (typeof item.id !== 'string' || !/^G-MSG-KP1-\d{3}$/.test(item.id)) throw new ReadError(`${where}: id`)
    if (typeof item.title !== 'string' || !Array.isArray(item.refs) || item.refs.length === 0) throw new ReadError(`${where}: title·refs`)
    if (item.note !== undefined && typeof item.note !== 'string') throw new ReadError(`${where}: note`)
    checkInput(kind as Kind, item.in, where)
    return { id: item.id, kind: kind as Kind, price, input: item.in, out: item.out }
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
    case 'bytes':
      return messageBytes(item.input as string)
    case 'compose':
      return composeMessage(item.input as ComposeInput, item.price as MessagePrice)
    case 'window':
      return canSendAt(item.input as WindowInput)
    case 'consent':
      return consentStatus(item.input as { now: string; records: ConsentRecord[] })
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

describe('AC-KP1-25 메시지 규칙 골든', () => {
  it('파일 4개·사례 57개 (고정값), id는 폴더 전체에서 유일', () => {
    expect(files).toEqual(['bytes.json', 'compose.json', 'consent.json', 'window.json'])
    expect(cases).toHaveLength(57)
    expect(new Set(cases.map((item) => item.id)).size).toBe(57)
    const counts = Object.fromEntries(KINDS.map((kind) => [kind, cases.filter((item) => item.kind === kind).length]))
    expect(counts).toEqual({ bytes: 6, compose: 28, window: 11, consent: 12 })
  })

  for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
    it(`TZ=${tz}: 사례마다 out과 깊은 같음`, () => {
      process.env.TZ = tz
      for (const item of cases) expect(run(item), item.id).toEqual(item.out)
    })
  }

  it('consent: 기록 순서를 뒤섞어도 같다 (시각 순으로 다시 세운다)', () => {
    for (const item of cases.filter((entry) => entry.kind === 'consent')) {
      const input = item.input as { now: string; records: ConsentRecord[] }
      expect(consentStatus({ now: input.now, records: [...input.records].reverse() }), item.id).toEqual(item.out)
    }
  })

  it('모르는 kind·키·빠진 칸·중복 ID는 읽기 오류다', () => {
    const compose = JSON.parse(texts.find((entry) => entry.name === 'compose.json')?.text ?? '') as { cases: Record<string, unknown>[] } & Record<string, unknown>
    const first = compose.cases[0] as Record<string, unknown>
    const broken = [
      { ...compose, kind: 'other' },
      { ...compose, extra: 1 },
      { ...compose, price: { SMS: 20 } },
      { ...compose, cases: [{ ...first, expect: {} }] },
      { ...compose, cases: [{ ...first, in: { ...(first.in as object), typo: 1 } }] },
      { ...compose, cases: [{ ...first, in: { ...(first.in as object), kind: 'MMS' } }] },
      { ...compose, cases: [{ ...first, out: undefined }] },
      { ...compose, cases: [{ ...first, id: 'G-MSG-001' }] },
    ]
    for (const value of broken) expect(() => readGolden(JSON.stringify(value), 'broken.json')).toThrow(ReadError)
    expect(() => readGolden(JSON.stringify({ kind: 'bytes', about: '', cases: [{ id: 'G-MSG-KP1-001', title: 't', refs: ['MR-4'], in: 1, out: 0 }] }), 'b.json')).toThrow(ReadError)
    expect(() => readGolden(JSON.stringify({ kind: 'consent', about: '', cases: [{ id: 'G-MSG-KP1-301', title: 't', refs: ['MR-6'], in: { now: 'x', records: [{ type: 'OPT_IN', at: 'x' }] }, out: {} }] }), 'c.json')).toThrow(ReadError)
    expect(() => readAll([...texts, { name: 'zz.json', text: texts[0]?.text ?? '' }])).toThrow(ReadError)
  })
})

describe('MR-4·MR-5 정수와 경계', () => {
  it('비용은 정수 원 — 받는 사람 수 × 한 건 값', () => {
    const out = composeMessage({ kind: 'RECEIPT_LINK', shop: '초록다육', body: '안녕', optOut: '', recipients: 7 })
    expect(out).toEqual({ text: '[초록다육] 안녕', bytes: 15, type: 'SMS', cost: 140 })
  })

  it('형식이 틀린 시각은 RangeError', () => {
    expect(() => canSendAt({ kind: 'FREE_TEXT', at: '2026-10-31 20:00' })).toThrow(RangeError)
    expect(() => consentStatus({ now: '2026-10-31T00:00:00+09:00', records: [{ type: 'AGREE', at: 'yesterday' }] })).toThrow(RangeError)
  })
})
