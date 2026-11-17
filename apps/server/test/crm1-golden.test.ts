// AC-CRM1-01·02 손님 기록 골든 (tests/golden/regulars/*.json, G-CRM-001~016): 서버의 요약 순수 함수로 돌려 out과 깊은 같음.
// 파일 수 1·사례 수 16(D-PASS-01로 13 → 16)을 고정값으로 단언한다(빠지면 실패). 모르는 키·kind는 읽기 오류. TZ 셋·묶음 거꾸로도 같다. 미구현 허용 장치는 없다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { addDays, customerSummary, isNoPayReason, type CustomerSettings, type SummaryBundle } from '../src/customers/summary.ts'

const FOLDER = fileURLToPath(new URL('../../../tests/golden/regulars', import.meta.url))
const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'today', 'settings', 'bundles', 'out']
const REQUIRED_CASE_KEYS = ['id', 'title', 'refs', 'today', 'settings', 'bundles', 'out']
const SETTINGS_KEYS = ['regularCount', 'regularAmount', 'waitDays']
const BUNDLE_KEYS = ['date', 'buyer', 'items', 'subtotal', 'payment', 'cancels', 'noPay', 'mine']
/** mine은 D-PASS-01에서 더한 칸 — 없으면 0 */
const REQUIRED_BUNDLE_KEYS = ['date', 'buyer', 'items', 'subtotal', 'payment', 'cancels', 'noPay']
const OUT_KEYS = ['purchaseDays', 'purchaseTotal', 'lastPurchase', 'unpaidDays', 'lastUnpaid', 'cancels', 'passes', 'regular', 'caution', 'passWarning']
const PAYMENTS = ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface GoldenCase {
  readonly id: string
  readonly today: string
  readonly settings: CustomerSettings
  readonly bundles: readonly SummaryBundle[]
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

const nonNegInt = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** 골든 파일 하나 읽기 (README "손님 기록 골든" 형식 계약 — 어긋나면 읽기 오류) */
function readGolden(text: string, file: string): GoldenCase[] {
  const root = keysOnly(JSON.parse(text), FILE_KEYS, FILE_KEYS, file)
  if (root.kind !== 'summary') throw new ReadError(`${file}: 모르는 kind`)
  if (!Array.isArray(root.cases)) throw new ReadError(`${file}: cases가 배열이 아니다`)
  return root.cases.map((raw, i) => {
    const where = `${file}#${String(i)}`
    const item = keysOnly(raw, CASE_KEYS, REQUIRED_CASE_KEYS, where)
    if (typeof item.id !== 'string' || !/^G-CRM-\d{3}$/.test(item.id)) throw new ReadError(`${where}: id`)
    if (!Array.isArray(item.refs) || item.refs.length === 0) throw new ReadError(`${where}: refs`)
    if (typeof item.today !== 'string' || !DATE_RE.test(item.today)) throw new ReadError(`${where}: today`)
    const settings = keysOnly(item.settings, SETTINGS_KEYS, SETTINGS_KEYS, `${where}.settings`)
    if (!nonNegInt(settings.regularCount) || !nonNegInt(settings.waitDays) || !(settings.regularAmount === null || nonNegInt(settings.regularAmount))) throw new ReadError(`${where}: settings`)
    if (!Array.isArray(item.bundles)) throw new ReadError(`${where}: bundles`)
    const bundles = item.bundles.map((bundle, j) => {
      const entry = keysOnly(bundle, BUNDLE_KEYS, REQUIRED_BUNDLE_KEYS, `${where}.bundles#${String(j)}`)
      if (typeof entry.date !== 'string' || !DATE_RE.test(entry.date) || typeof entry.buyer !== 'string') throw new ReadError(`${where}: bundle`)
      if (!PAYMENTS.includes(entry.payment as string)) throw new ReadError(`${where}: payment`)
      for (const key of ['items', 'subtotal', 'cancels', 'noPay']) if (!nonNegInt(entry[key])) throw new ReadError(`${where}: ${key}`)
      if (entry.mine !== undefined && !nonNegInt(entry.mine)) throw new ReadError(`${where}: mine`)
      return entry as unknown as SummaryBundle
    })
    const out = keysOnly(item.out, OUT_KEYS, OUT_KEYS, `${where}.out`)
    return { id: item.id, today: item.today, settings: settings as unknown as CustomerSettings, bundles, out }
  })
}

const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.json'))
  .sort()
const cases = files.flatMap((name) => readGolden(readFileSync(join(FOLDER, name), 'utf8'), name))
const originalTz = process.env.TZ

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('AC-CRM1-01 손님 기록 골든', () => {
  it('파일 1개·사례 16개 (고정값, D-PASS-01로 13 → 16), id는 폴더 전체에서 유일', () => {
    expect(files).toEqual(['summary.json'])
    expect(cases).toHaveLength(16)
    expect(new Set(cases.map((item) => item.id)).size).toBe(16)
  })

  for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
    it(`TZ=${tz}: 사례마다 out과 깊은 같음, 묶음을 거꾸로 넣어도 같다`, () => {
      process.env.TZ = tz
      for (const item of cases) {
        expect(customerSummary(item.today, item.settings, item.bundles), item.id).toEqual(item.out)
        expect(customerSummary(item.today, item.settings, [...item.bundles].reverse()), `${item.id} 거꾸로`).toEqual(item.out)
      }
    })
  }

  it('모르는 키·모르는 kind·빠진 칸은 읽기 오류다', () => {
    const base = JSON.parse(readFileSync(join(FOLDER, 'summary.json'), 'utf8')) as { kind: string; about: string; cases: Record<string, unknown>[] }
    const first = base.cases[0] as Record<string, unknown>
    const broken = [
      { ...base, kind: 'other' },
      { ...base, extra: 1 },
      { ...base, cases: [{ ...first, expect: {} }] },
      { ...base, cases: [{ ...first, settings: { regularCount: 3, regularAmount: null, waitDays: 3, typo: 1 } }] },
      { ...base, cases: [{ ...first, out: { ...(first.out as object), unknown: true } }] },
      { ...base, cases: [{ ...first, bundles: [{ date: '2026-10-01', buyer: 'UC_A', items: 1, subtotal: 1, payment: 'REFUNDED', cancels: 0, noPay: 0 }] }] },
      { ...base, cases: [{ ...first, today: undefined }] },
    ]
    for (const value of broken) expect(() => readGolden(JSON.stringify(value), 'broken.json')).toThrow(ReadError)
  })
})

describe('AC-CRM1-02 금액은 정수 원', () => {
  it('33,333원 × 3 = 99,999 (정수), 응답 JSON에 소수점 숫자가 없다', () => {
    const bundles: SummaryBundle[] = ['2026-10-01', '2026-10-08', '2026-10-15'].map((date) => ({ date, buyer: 'UC_A', items: 1, subtotal: 33_333, payment: 'PAID', cancels: 0, noPay: 0 }))
    const out = customerSummary('2026-10-26', { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, bundles)
    expect(out.purchaseTotal).toBe(99_999)
    expect(Number.isSafeInteger(out.purchaseTotal)).toBe(true)
    expect(JSON.stringify(out)).not.toMatch(/\d\.\d/)
    expect(out.regular).toBe(true)
  })
})

describe('달력 날짜 더하기와 사유 읽기 (D-CRM1-04)', () => {
  it('해·달·윤년을 넘는다', () => {
    expect(addDays('2025-12-29', 3)).toBe('2026-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-10-31', 30)).toBe('2026-11-30')
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29')
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01')
  })

  it("공백(전각 공백·탭·줄 나눔)을 모두 뺀 글이 '입금안함'이면 '입금 안 함'", () => {
    for (const reason of ['입금 안 함', ' 입금안함 ', '입금　안\t함', '입금\n안 함']) expect(isNoPayReason(reason), reason).toBe(true)
    for (const reason of ['입금 안 함 (연락 없음)', '입금 안함?', '입금 안 함함', '', null, undefined, 5]) expect(isNoPayReason(reason), String(reason)).toBe(false)
  })
})
