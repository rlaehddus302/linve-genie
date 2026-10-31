// AC-KP1-12·13 손님 엑셀 (CR-6)
import { describe, expect, it } from 'vitest'
import { CUSTOMER_COLUMNS, CUSTOMER_CONTACT_COLUMNS, buildCustomersXlsx, type CustomerXlsxRow } from '../src/index.ts'
import { readXlsx } from './helpers.ts'

const row = (over: Partial<CustomerXlsxRow>): CustomerXlsxRow => ({ name: '꽃님', kind: '유튜브', totalWon: 1000, purchaseCount: 1, lastPurchaseDate: '2026-10-30', unpaidCount: 0, regular: false, lateWarning: false, memo: '', ...over })
const open = async (input: Parameters<typeof buildCustomersXlsx>[0]) => {
  const result = await buildCustomersXlsx(input)
  const [sheet] = await readXlsx(result.bytes)
  return { result, sheet: sheet! }
}

describe('손님 엑셀', () => {
  it('파일 이름·시트 이름·기본 9열 머리', async () => {
    const { result, sheet } = await open({ date: '2026-10-31', rows: [row({})], includeContact: false })
    expect(result.fileName).toBe('손님-2026-10-31.xlsx')
    expect(sheet.name).toBe('손님')
    expect(sheet.rows[0]!.map((c) => c.value)).toEqual([...CUSTOMER_COLUMNS])
    expect(CUSTOMER_COLUMNS).toHaveLength(9)
  })
  it('연락처 열은 고를 때만, 순서대로', async () => {
    const contact = { recipient: '김영희', phone: '01012345678', address: '서울', addressDetail: '101호', zip: '04524', keepUntil: '2027-10-31' }
    const on = await open({ date: '2026-10-31', rows: [row({ contact })], includeContact: true })
    expect(on.sheet.rows[0]!.map((c) => c.value)).toEqual([...CUSTOMER_COLUMNS, ...CUSTOMER_CONTACT_COLUMNS])
    expect(on.sheet.rows[1]!.slice(9).map((c) => c.value)).toEqual(['김영희', '01012345678', '서울', '101호', '04524', '2027-10-31'])
    const off = await open({ date: '2026-10-31', rows: [row({ contact })], includeContact: false })
    expect(off.sheet.rows[0]).toHaveLength(9)
    expect(off.sheet.rows[1]).toHaveLength(9)
    expect(JSON.stringify(off.sheet.rows)).not.toContain('01012345678')
  })
  it('수식 막기와 제어 글자 빼기', async () => {
    const { sheet } = await open({ date: '2026-10-31', rows: [row({ name: '=1+1', kind: '@SUM', memo: 'a\u0000b\u0001c' }), row({ name: '\t=2', memo: '-x', totalWon: 5 })], includeContact: false })
    expect(sheet.rows[1]!.map((c) => c.value).filter((v) => typeof v === 'string' && v !== '')).toEqual(["'=1+1", "'@SUM", '2026-10-30', 'abc'])
    expect(sheet.rows[2]![0]!.value).toBe("'=2")
    expect(sheet.rows[2]![8]!.value).toBe("'-x")
  })
  it('누적 큰 순, 같으면 입력 순서', async () => {
    const { sheet } = await open({ date: '2026-10-31', rows: [row({ name: 'a', totalWon: 5 }), row({ name: 'b', totalWon: 9 }), row({ name: 'c', totalWon: 5 })], includeContact: false })
    expect(sheet.rows.slice(1).map((r) => r[0]!.value)).toEqual(['b', 'a', 'c'])
  })
  it('금액·횟수는 정수 숫자 칸, 예/빈칸', async () => {
    const { sheet } = await open({ date: '2026-10-31', rows: [row({ totalWon: 125000, purchaseCount: 3, unpaidCount: 2, regular: true, lastPurchaseDate: null })], includeContact: false })
    const r = sheet.rows[1]!
    expect([r[2]!.value, r[3]!.value, r[5]!.value]).toEqual([125000, 3, 2])
    expect(r[2]!.type).toBe('Number')
    expect(r[6]!.value).toBe('예')
    expect(r[4]!.value).toBeNull()
    expect(r[7]!.value).toBeNull()
  })
})
