// AC-V3-98·99 확정 아닌 조각 (R-17 8, D-V3-112 천원 단위 작은 빠른 꼴 · D-V3-113 번호가 붙은 가격) — 조각 읽기 단위.
// 카드·묻기(화면)는 apps/web 시험에서 본다.
import { describe, expect, it } from 'vitest'
import { interimCandidate, isSmallQuickNumber, numberInPriceNote, numberInPriceOf, prepareVoiceDictionary, readRegistration, readSegments, type SegmentOptions } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const seg = (text: string, options: SegmentOptions = {}) => readSegments(text, { dictionary: DICT, final: true, ...options })
const one = (text: string, options: SegmentOptions = {}) => {
  const picks = seg(text, options).picks
  expect(picks, text).toHaveLength(1)
  return picks[0] as (typeof picks)[number]
}
const thousand: SegmentOptions = { priceUnit: 'THOUSAND' }

describe('AC-V3-98 천원 단위의 작은 빠른 꼴은 확정 아님 (D-V3-112)', () => {
  it('(1) 천원 단위 "9번입니다 17까지" → 9번 17,000원, 확정 아님(안내 "17,000원으로 들렸어요. 가격을 확인해 주세요")', () => {
    expect(one('9번입니다 17까지', thousand)).toMatchObject({ no: 9, price: 17000, name: null, priceFrom: 'quick', check: { kind: 'SMALL_QUICK', note: '17,000원으로 들렸어요. 가격을 확인해 주세요' } })
  })
  it('(2) 천원 단위 "92번 빅뱅 60"·"92번 60" → 60,000원, 확정 아님 (표 R61·R64)', () => {
    expect(one('92번 빅뱅 60', thousand)).toMatchObject({ no: 92, name: '빅뱅', price: 60000, check: { kind: 'SMALL_QUICK', note: '60,000원으로 들렸어요. 가격을 확인해 주세요' } })
    expect(one('92번 60', thousand)).toMatchObject({ no: 92, name: null, price: 60000, check: { kind: 'SMALL_QUICK', note: '60,000원으로 들렸어요. 가격을 확인해 주세요' } })
    expect(one('92번 저거 60', thousand)).toMatchObject({ no: 92, price: 60000, check: { kind: 'SMALL_QUICK' } })
  })
  it('(3) 천원 단위 "92번 빅뱅 180" → 바로 180,000원 (3자리)', () => {
    const pick = one('92번 빅뱅 180', thousand)
    expect(pick).toMatchObject({ no: 92, name: '빅뱅', price: 180000 })
    expect(pick.check ?? null).toBeNull()
  })
  it('(4) 천원 단위 "68번 이십오" → 25,000원, 확정 아님 (한글 수 R-15 값 25)', () => {
    expect(one('68번 이십오', thousand)).toMatchObject({ no: 68, price: 25000, check: { kind: 'SMALL_QUICK', note: '25,000원으로 들렸어요. 가격을 확인해 주세요' } })
  })
  it('(5) 자동 단위·만원 단위 "92번 빅뱅 60" → 바로 600,000원', () => {
    for (const priceUnit of ['AUTO', 'TEN_THOUSAND'] as const) {
      const pick = one('92번 빅뱅 60', { priceUnit })
      expect(pick, priceUnit).toMatchObject({ no: 92, price: 600000 })
      expect(pick.check ?? null, priceUnit).toBeNull()
    }
  })
  it('(6) 천원 단위 "92번 빅뱅 6만 자" → 바로 60,000원 (단위 붙음)', () => {
    const pick = one('92번 빅뱅 6만 자', thousand)
    expect(pick).toMatchObject({ no: 92, price: 60000 })
    expect(pick.check ?? null).toBeNull()
    expect(isSmallQuickNumber('5천', 'THOUSAND')).toBe(false)
  })
  it('(7) 원 단위 "92번 60" → 지금처럼 조각 없음 (100원 미만)', () => {
    expect(seg('92번 60', { priceUnit: 'WON' }).picks).toEqual([])
  })
  it('원 붙은 말(`17천 원`·`만 칠천 원`)·3자리 이상 숫자는 그대로', () => {
    const won = one('9번 만 칠천 원', thousand)
    expect(won).toMatchObject({ no: 9, price: 17000, priceFrom: 'won' })
    expect(won.check ?? null).toBeNull()
    expect(one('150번 180 가겠습니다', thousand).check ?? null).toBeNull()
    expect(one('150번 1,200', thousand).check ?? null).toBeNull()
  })
  it('수 토큰 판정: 숫자 정수부 0~99·천/만 없는 한글 수 0~99만 작은 수, 천원 단위에서만', () => {
    for (const token of ['17', '99', '4.5', '이십오', '구십구']) expect(isSmallQuickNumber(token, 'THOUSAND'), token).toBe(true)
    for (const token of ['100', '180', '1,200', '백오십', '6만', '오천', '5천']) expect(isSmallQuickNumber(token, 'THOUSAND'), token).toBe(false)
    for (const unit of ['WON', 'AUTO', 'TEN_THOUSAND'] as const) expect(isSmallQuickNumber('17', unit), unit).toBe(false)
  })
  it('중간 결과에서는 후보가 아니다 — 최종 결과에서 카드·묻기로 (D-V3-71 중간 안정 등록을 하지 않음)', () => {
    expect(interimCandidate('92번 빅뱅 60', { dictionary: DICT, priceUnit: 'THOUSAND' })).toBeNull()
    expect(interimCandidate('92번 빅뱅 180', { dictionary: DICT, priceUnit: 'THOUSAND' })).toMatchObject({ no: 92, price: 180000 })
    expect(interimCandidate('92번 빅뱅 60', { dictionary: DICT, priceUnit: 'TEN_THOUSAND' })).toMatchObject({ no: 92, price: 600000 })
  })
})

describe('AC-V3-99 번호가 붙은 가격은 확정 아님 (D-V3-113)', () => {
  const NOTE = '2275만 원으로 들렸어요. 227번 5만 원인지 확인해 주세요'
  it('(1) "자 2275만 원 자 227번이고요" → 227번, 확정 아님(안내)', () => {
    expect(one('자 2275만 원 자 227번이고요')).toMatchObject({ no: 227, price: 22750000, check: { kind: 'NUMBER_IN_PRICE', note: NOTE } })
  })
  it('(2) "227번 2275만 원"(차례 반대) → 같은 안내', () => {
    expect(one('227번 2275만 원')).toMatchObject({ no: 227, price: 22750000, check: { kind: 'NUMBER_IN_PRICE', note: NOTE } })
    // 중간 결과의 짝도 확정 아님으로 표시한다 (화면은 최종까지 기다린다)
    expect(seg('227번 2275만 원', { final: false }).picks).toMatchObject([{ no: 227, check: { kind: 'NUMBER_IN_PRICE', note: NOTE } }])
  })
  it('(3) "15번 150만 원" → 바로 1,500,000원 (300만 원 넘지 않음)', () => {
    const pick = one('15번 150만 원')
    expect(pick).toMatchObject({ no: 15, price: 1500000 })
    expect(pick.check ?? null).toBeNull()
  })
  it('(4) "15번 1505만 원" → 확정 아님(안내 "… 15번 5만 원인지 …")', () => {
    expect(one('15번 1505만 원')).toMatchObject({ no: 15, price: 15050000, check: { kind: 'NUMBER_IN_PRICE', note: '1505만 원으로 들렸어요. 15번 5만 원인지 확인해 주세요' } })
  })
  it('(5) "227번 2000만 원" → 바로 20,000,000원 (번호로 시작하지 않음 — D-V3-64, 크게 바뀜 표시)', () => {
    const pick = one('227번 2000만 원')
    expect(pick).toMatchObject({ no: 227, price: 20000000, bigChange: true })
    expect(pick.check ?? null).toBeNull()
  })
  it('(6) "227번 227만 원" → 바로 2,270,000원 (더 길지 않음)', () => {
    const pick = one('227번 227만 원')
    expect(pick).toMatchObject({ no: 227, price: 2270000 })
    expect(pick.check ?? null).toBeNull()
  })
  it('(8) "227번 이천이백칠십오만 원" → 해당 없음(한글 계수), 바로 22,750,000원', () => {
    const pick = one('227번 이천이백칠십오만 원')
    expect(pick).toMatchObject({ no: 227, price: 22750000 })
    expect(pick.check ?? null).toBeNull()
  })
  it('덩어리 읽기(옛 판단)도 바로 등록하지 않는다 — 막힌 까닭 NUMBER_IN_PRICE', () => {
    const r = readRegistration('227번 2275만 원', { dictionary: DICT, final: true })
    expect(r.ready).toBeNull()
    expect(r.blocked).toBe('NUMBER_IN_PRICE')
    expect(readRegistration('15번 150만 원', { dictionary: DICT, final: true }).ready).toMatchObject({ no: 15, price: 1500000 })
    expect(readRegistration('227번 2000만 원', { dictionary: DICT, final: true }).ready).toMatchObject({ no: 227, price: 20000000 })
  })
  it('(9) "227번 2270만 원" → 확정 아님, 남은 수 0이라 뒤 가격 없는 안내 (D-V3-114 (1))', () => {
    expect(one('227번 2270만 원')).toMatchObject({ no: 227, price: 22700000, check: { kind: 'NUMBER_IN_PRICE', note: '2270만 원으로 들렸어요. 227번 가격을 확인해 주세요' } })
  })
  it('(10)·(11) 다른 덩어리에서 짝지은 번호와 가격도 같은 검사 (D-V3-114 (3)) — 가격을 들은 글로', () => {
    expect(numberInPriceOf(227, '2275만 원', 22750000)).toBe(NOTE)
    expect(numberInPriceOf(227, '자 2275만 원이고요', 22750000, { maxNumber: 999 })).toBe(NOTE)
    expect(numberInPriceOf(227, '2270만 원', 22700000)).toBe('2270만 원으로 들렸어요. 227번 가격을 확인해 주세요')
    // 그 값의 줄이 아니면 보지 않는다
    expect(numberInPriceOf(227, '2275만 원', 50000)).toBeNull()
  })
  it('(12) 기다리는 번호 "15번" 뒤 "150만 원" → 해당 없음 (300만 원 넘지 않음), 한글 계수도 해당 없음', () => {
    expect(numberInPriceOf(15, '150만 원', 1500000)).toBeNull()
    expect(numberInPriceOf(227, '이천이백칠십오만 원', 22750000)).toBeNull()
    expect(numberInPriceOf(227, '2000만 원', 20000000)).toBeNull()
    for (const bad of [null, undefined, 42, '', '   ']) expect(numberInPriceOf(227, bad, 22750000)).toBeNull()
  })
  it('(13) 실방송 "369만원 371번" — "삼육구" 번호가 만원에 붙어 적힘 → 확정 아님 (D-LIVETEST-14)', () => {
    const note = '369만 원으로 들렸어요. 371번 가격을 확인해 주세요'
    expect(one('369만원 371번')).toMatchObject({ no: 371, price: 3690000, check: { kind: 'NUMBER_IN_PRICE', note } })
    expect(readRegistration('369만원 371번', { dictionary: DICT, final: true })).toMatchObject({ ready: null, blocked: 'NUMBER_IN_PRICE' })
    expect(numberInPriceOf(371, '369 만원', 3690000)).toBe(note)
    // 끝자리가 0인 계수(`350만`)·번호와 자릿수가 다른 계수(38번 `605만`)는 분명히 들은 큰 가격 그대로 (D-V3-64)
    expect(numberInPriceOf(371, '350만 원', 3500000)).toBeNull()
    expect(numberInPriceOf(38, '605만 원', 6050000)).toBeNull()
    expect(numberInPriceOf(371, '369만 원', 3000000)).toBeNull()
  })
  it('안내 글: 쉼표 계수·나머지 0', () => {
    expect(numberInPriceNote(227, ['2275만', '원'], 22750000)).toBe(NOTE)
    expect(numberInPriceNote(227, ['2,275만', '원'], 22750000)).toBe(NOTE)
    expect(numberInPriceNote(227, ['2275만원이고요'], 22750000)).toBe(NOTE)
    expect(numberInPriceNote(227, ['2270만', '원'], 22700000)).toBe('2270만 원으로 들렸어요. 227번 가격을 확인해 주세요')
    expect(numberInPriceNote(227, ['2275만', '원'], 3000000)).toBeNull()
    expect(numberInPriceNote(227, ['이천이백칠십오만', '원'], 22750000)).toBeNull()
  })
})
