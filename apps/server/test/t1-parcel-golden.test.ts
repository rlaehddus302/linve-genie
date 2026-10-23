// AC-T1-01·04·23: 택배 골든(tests/golden/parcel/*.json)을 서버의 순수 함수 셋(배송지 읽기 PC-2, 접수할 수 있는지 PC-4, 보내는 사람 읽기 PC-6)으로 돌린다.
// - 파일 수 3·사례 수 55(address 26 · eligibility 21 · sender 8)를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
// - 모르는 kind·모르는 키·중복 ID·ID 형식 오류·표 밖 열거값은 시험 실패(읽기 오류)다. 미구현을 허용하는 장치가 없다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ADDRESS_ERROR_CODES,
  ADDRESS_FIELDS,
  ADDRESS_STATES,
  ELIGIBILITY_REASONS,
  PACKING_WORD_KINDS,
  PARCEL_STATE_KINDS,
  PAYMENT_KINDS,
  SENDER_FIELDS,
  SHIPPING_KINDS,
  parcelEligibility,
  readAddress,
  readSender,
  type EligibilityFacts,
} from '../src/parcel/rules.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/parcel/', import.meta.url))

type Kind = 'address' | 'eligibility' | 'sender'
interface GoldenCase {
  readonly id: string
  readonly title: string
  readonly refs: readonly string[]
  readonly note?: string
  readonly in: Record<string, unknown>
  readonly out: unknown
}
interface GoldenFile {
  readonly file: string
  readonly kind: Kind
  readonly cases: readonly GoldenCase[]
}

const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'in', 'out']
const ELIGIBILITY_KEYS = ['items', 'shipping', 'payment', 'packing', 'parcel', 'address']
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => own.includes(key))
}

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
    if (kind !== 'address' && kind !== 'eligibility' && kind !== 'sender') {
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
      for (const key of Object.keys(raw)) if (!CASE_KEYS.includes(key)) problems.push(`${where}: 모르는 사례 키 '${key}'`)
      for (const key of ['id', 'title', 'refs', 'in', 'out']) if (!Object.hasOwn(raw, key)) problems.push(`${where}: 필수 키 '${key}'가 없다`)
      const id = raw.id
      if (typeof id !== 'string' || !/^G-PCL-T1-\d{2,3}$/.test(id)) problems.push(`${where}: ID 형식 오류`)
      else if (ids.has(id)) problems.push(`${where}: ID 중복 ${id} (처음: ${ids.get(id) ?? ''})`)
      else ids.set(id, where)
      if (typeof raw.title !== 'string') problems.push(`${where}: title이 글이 아니다`)
      if (!Array.isArray(raw.refs) || raw.refs.length === 0) problems.push(`${where}: refs는 1개 이상`)
      if (raw.note !== undefined && typeof raw.note !== 'string') problems.push(`${where}: note가 글이 아니다`)
      const input = raw.in
      const out = raw.out
      if (!isObject(input)) problems.push(`${where}: in이 객체가 아니다`)
      if (!isObject(out)) problems.push(`${where}: out이 객체가 아니다`)
      if (isObject(input) && isObject(out)) {
        if (kind === 'address' || kind === 'sender') {
          // 보내는 사람은 메모 칸이 없는 다섯 칸이고 MEMO_TOO_LONG이 나올 수 없다 (PC-6)
          const fields: readonly string[] = kind === 'address' ? ADDRESS_FIELDS : SENDER_FIELDS
          const codes = kind === 'address' ? ADDRESS_ERROR_CODES : ADDRESS_ERROR_CODES.filter((code) => code !== 'MEMO_TOO_LONG')
          const label = kind === 'address' ? '여섯' : '다섯'
          if (!sameKeys(input, fields) || !fields.every((field) => typeof input[field] === 'string')) problems.push(`${where}: in은 ${label} 칸 글`)
          if (sameKeys(out, ['ok'])) {
            const value = out.ok
            if (!isObject(value) || !sameKeys(value, fields) || !fields.every((field) => typeof value[field] === 'string')) problems.push(`${where}: out.ok는 ${label} 칸 글`)
          } else if (sameKeys(out, ['errors'])) {
            const list = out.errors
            if (!Array.isArray(list) || list.length === 0 || !list.every((code) => (codes as readonly unknown[]).includes(code))) problems.push(`${where}: 표 밖의 오류 코드`)
          } else problems.push(`${where}: out은 { ok } 또는 { errors }`)
        } else {
          if (!sameKeys(input, ELIGIBILITY_KEYS)) problems.push(`${where}: in은 여섯 키`)
          if (!(typeof input.items === 'number' && Number.isInteger(input.items) && input.items >= 0)) problems.push(`${where}: items는 0 이상 정수`)
          const enums: [string, readonly string[]][] = [
            ['shipping', SHIPPING_KINDS],
            ['payment', PAYMENT_KINDS],
            ['packing', PACKING_WORD_KINDS],
            ['parcel', PARCEL_STATE_KINDS],
            ['address', ADDRESS_STATES],
          ]
          for (const [key, allowed] of enums) if (!allowed.includes(input[key] as string)) problems.push(`${where}: 표 밖의 ${key} 값`)
          if (sameKeys(out, ['ready'])) {
            if (out.ready !== true) problems.push(`${where}: ready는 true`)
          } else if (sameKeys(out, ['reason'])) {
            if (!(ELIGIBILITY_REASONS as readonly unknown[]).includes(out.reason)) problems.push(`${where}: 표 밖의 이유`)
          } else problems.push(`${where}: out은 { ready } 또는 { reason }`)
        }
      }
      cases.push(raw as unknown as GoldenCase)
    })
    files.push({ file, kind, cases })
  }
  return { files, problems }
}

function loadGolden(): { files: GoldenFile[]; problems: string[] } {
  const names = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.json')).sort()
  return checkGolden(names.map((file) => ({ file, text: readFileSync(join(GOLDEN_DIR, file), 'utf8') })))
}

const golden = loadGolden()

describe('택배 골든 읽기 (AC-T1-01·04)', () => {
  it('읽기 오류가 없고 파일 수 3·사례 수 55(address 26 · eligibility 21 · sender 8)이다', () => {
    expect(golden.problems).toEqual([])
    expect(readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.json'))).toHaveLength(3)
    expect(golden.files).toHaveLength(3)
    const count = (kind: Kind) => golden.files.filter((file) => file.kind === kind).reduce((sum, file) => sum + file.cases.length, 0)
    expect(count('address')).toBe(26)
    expect(count('eligibility')).toBe(21)
    expect(count('sender')).toBe(8)
    expect(count('address') + count('eligibility') + count('sender')).toBe(55)
  })

  it('검사기가 모르는 kind·모르는 키·중복 ID·ID 형식 오류·표 밖 열거값을 잡는다', () => {
    const base = { name: '홍길동', phone: '010', address: '서울', detail: '', zip: '', memo: '' }
    const facts = { items: 1, shipping: 'NONE', payment: 'PAID', packing: '포장 완료', parcel: 'NONE', address: 'CONFIRMED' }
    const bad = (value: unknown) => checkGolden([{ file: 'x.json', text: JSON.stringify(value) }]).problems
    expect(bad({ kind: 'other', about: '', cases: [] })).not.toEqual([])
    expect(bad({ kind: 'address', about: '', cases: [], extra: 1 })).not.toEqual([])
    expect(bad({ kind: 'address', about: '', cases: [{ id: 'G-PCL-T1-01', title: 't', refs: ['PC-2'], in: base, out: { errors: ['NOPE'] } }] })).not.toEqual([])
    expect(bad({ kind: 'address', about: '', cases: [{ id: 'G-PCL-1', title: 't', refs: ['PC-2'], in: base, out: { errors: ['NAME_EMPTY'] } }] })).not.toEqual([])
    expect(bad({ kind: 'address', about: '', cases: [{ id: 'G-PCL-T1-01', title: 't', refs: ['PC-2'], in: base, out: { errors: ['NAME_EMPTY'] }, extra: 1 }] })).not.toEqual([])
    const one = { id: 'G-PCL-T1-101', title: 't', refs: ['PC-4'], in: facts, out: { ready: true } }
    expect(bad({ kind: 'eligibility', about: '', cases: [one, one] })).not.toEqual([])
    expect(bad({ kind: 'eligibility', about: '', cases: [{ ...one, in: { ...facts, payment: 'paid' } }] })).not.toEqual([])
    expect(bad({ kind: 'eligibility', about: '', cases: [{ ...one, out: { reason: 'LATER' } }] })).not.toEqual([])
    expect(bad({ kind: 'eligibility', about: '', cases: [one] })).toEqual([])
    // 보내는 사람: 메모 칸·MEMO_TOO_LONG은 표 밖, 다섯 칸이면 된다
    const { memo: _memo, ...senderIn } = base
    const sender = { id: 'G-PCL-T1-201', title: 't', refs: ['PC-6'], in: senderIn, out: { errors: ['PHONE_INVALID'] } }
    expect(bad({ kind: 'sender', about: '', cases: [{ ...sender, in: base }] })).not.toEqual([])
    expect(bad({ kind: 'sender', about: '', cases: [{ ...sender, out: { errors: ['MEMO_TOO_LONG'] } }] })).not.toEqual([])
    expect(bad({ kind: 'sender', about: '', cases: [{ ...sender, out: { ok: { ...senderIn, memo: '' } } }] })).not.toEqual([])
    expect(bad({ kind: 'sender', about: '', cases: [sender] })).toEqual([])
  })
})

describe('배송지 읽기 PC-2 (AC-T1-01)', () => {
  const cases = golden.files.filter((file) => file.kind === 'address').flatMap((file) => file.cases)
  for (const item of cases) {
    it(`${item.id} ${item.title}`, () => {
      expect(readAddress(item.in as Record<(typeof ADDRESS_FIELDS)[number], string>)).toEqual(item.out)
    })
  }
})

describe('접수할 수 있는지 PC-4 (AC-T1-04)', () => {
  const cases = golden.files.filter((file) => file.kind === 'eligibility').flatMap((file) => file.cases)
  for (const item of cases) {
    it(`${item.id} ${item.title}`, () => {
      expect(parcelEligibility(item.in as unknown as EligibilityFacts)).toEqual(item.out)
    })
  }
})

describe('보내는 사람 읽기 PC-6 (AC-T1-23, D-T1-16)', () => {
  const cases = golden.files.filter((file) => file.kind === 'sender').flatMap((file) => file.cases)
  for (const item of cases) {
    it(`${item.id} ${item.title}`, () => {
      expect(readSender(item.in as Record<(typeof SENDER_FIELDS)[number], string>)).toEqual(item.out)
    })
  }
})
