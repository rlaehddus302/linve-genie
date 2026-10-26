// 실방송 V3 (306번 방송): 가격만 고쳐 말함 · `원`/`번` 뒤 끝말 · 사전 이름
import { describe, expect, it } from 'vitest'
import { NAME_ONLY_FILL_MS, PRICE_ONLY_FIX_MS, nameOnlyFill, prepareVoiceDictionary, priceOnlyFix, readRegistration, readSegments, type NameOnlyInput, type PriceOnlyInput } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const pick = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])

describe('priceOnlyFix — "309번 … 55만 원" 등록 뒤 "50만 원"', () => {
  const base: PriceOnlyInput = {
    wonPrices: [500_000],
    heardNumbers: [],
    correction: false,
    lastRegistered: { no: 309, at: 1_000 },
    lastHeardNo: 309,
    waiting: false,
    product: { price: 550_000, claimCount: 0 },
    now: 1_000 + 5_000,
  }
  it('찜 0이면 바로 고침', () => {
    expect(priceOnlyFix(base)).toEqual({ no: 309, price: 500_000, auto: true })
  })
  it('찜이 있으면 묻기', () => {
    expect(priceOnlyFix({ ...base, product: { price: 550_000, claimCount: 2 } })).toEqual({ no: 309, price: 500_000, auto: false })
  })
  it('30초 경계: 30,000ms면 받고 30,001ms면 받지 않는다', () => {
    expect(priceOnlyFix({ ...base, now: 1_000 + PRICE_ONLY_FIX_MS })?.no).toBe(309)
    expect(priceOnlyFix({ ...base, now: 1_000 + PRICE_ONLY_FIX_MS + 1 })).toBeNull()
    expect(priceOnlyFix({ ...base, now: 999 })).toBeNull()
  })
  it('그 사이 다른 번호가 들렸으면·이 조각에 번호가 있으면·기다리는 번호가 있으면 아니다', () => {
    expect(priceOnlyFix({ ...base, lastHeardNo: 310 })).toBeNull()
    expect(priceOnlyFix({ ...base, lastHeardNo: null })).toBeNull()
    expect(priceOnlyFix({ ...base, heardNumbers: [310] })).toBeNull()
    expect(priceOnlyFix({ ...base, waiting: true })).toBeNull()
  })
  it('가격이 같거나·원 가격이 둘이거나 없거나·정정 낱말이 있거나·상품이 없으면 아니다', () => {
    expect(priceOnlyFix({ ...base, product: { price: 500_000, claimCount: 0 } })).toBeNull()
    expect(priceOnlyFix({ ...base, wonPrices: [500_000, 450_000] })).toBeNull()
    expect(priceOnlyFix({ ...base, wonPrices: [] })).toBeNull()
    expect(priceOnlyFix({ ...base, correction: true })).toBeNull()
    expect(priceOnlyFix({ ...base, product: null })).toBeNull()
    expect(priceOnlyFix({ ...base, lastRegistered: null })).toBeNull()
  })
  it('실방송 글: "50만 원"·"아 50만 원"·"50만 원이요"는 번호 없이 원 가격 하나', () => {
    for (const text of ['50만 원', '아 50만 원', '50만 원이요', '50만 원으로']) {
      const r = readRegistration(text, { dictionary: DICT, final: true, maxNumber: 999 })
      expect(priceOnlyFix({ ...base, wonPrices: r.wonPrices, heardNumbers: r.heardNumbers, correction: r.correction })).toEqual({ no: 309, price: 500_000, auto: true })
    }
  })
})

describe('nameOnlyFill — 등록 뒤 다음 결과에 품종만 (실방송 "346번 … 10 5만 원" 뒤 "황소개구리")', () => {
  const base: NameOnlyInput = { names: ['황소개구리'], heardNumbers: [], wonPrices: [], lastRegistered: { no: 346, at: 0 }, lastHeardNo: 346, product: { name: '' }, now: 4_000 }
  it('빈 품종을 채운다 · 15초 경계', () => {
    expect(nameOnlyFill(base)).toEqual({ no: 346, name: '황소개구리' })
    expect(nameOnlyFill({ ...base, names: ['황소개구리', '황소개구리'] })).toEqual({ no: 346, name: '황소개구리' })
    expect(nameOnlyFill({ ...base, now: NAME_ONLY_FILL_MS })?.no).toBe(346)
    expect(nameOnlyFill({ ...base, now: NAME_ONLY_FILL_MS + 1 })).toBeNull()
  })
  it('덮어쓰지 않고, 이름이 둘이거나 번호·가격이 들렸거나 다른 번호가 끼면 아니다', () => {
    expect(nameOnlyFill({ ...base, product: { name: '청개구리' } })).toBeNull()
    expect(nameOnlyFill({ ...base, names: ['황소개구리', '몽고리색금'] })).toBeNull()
    expect(nameOnlyFill({ ...base, names: [] })).toBeNull()
    expect(nameOnlyFill({ ...base, heardNumbers: [347] })).toBeNull()
    expect(nameOnlyFill({ ...base, wonPrices: [150_000] })).toBeNull()
    expect(nameOnlyFill({ ...base, lastHeardNo: 347 })).toBeNull()
    expect(nameOnlyFill({ ...base, product: null })).toBeNull()
  })
})

describe('`원`·`번` 뒤 끝말 (실방송 312번·309번)', () => {
  it('원까지·원에·원이요·원으로·원부터·원이고요는 닫힌 가격', () => {
    for (const tail of ['원까지', '원에 드려요', '원이요', '원으로', '원부터', '원이고요', '원이구요']) expect(pick(`312번 5만 ${tail}`)).toEqual([[312, 50_000, null]])
    expect(pick('312번 오만원까지')).toEqual([[312, 50_000, null]])
    expect(pick('312번 5만원으로')).toEqual([[312, 50_000, null]])
  })
  it('실방송 "312번 자 수박금 자 ui 5만 원까지 드려볼게요" → 312번 50,000원 수박금', () => {
    expect(pick('312번 자 수박금 자 ui 5만 원까지 드려볼게요')).toEqual([[312, 50_000, '수박금']])
  })
  it('"309번이고요"·"309번이구요"는 번호 표시, "300번부터"·"309번으로"는 아니다', () => {
    expect(pick('자 사용 잘 다녀오세요 자 309번이고요 자 선키스트 백금입니다 자 요 아이 뭐 얼마 얼마가 나셨죠 55만 원')).toEqual([[309, 550_000, '선키스트 백금']])
    expect(pick('309번이구요 55만 원')).toEqual([[309, 550_000, null]])
    expect(pick('300번부터 5만 원')).toEqual([])
    expect(pick('309번으로 5만 원')).toEqual([])
  })
})

describe('사전 이름 (실방송)', () => {
  it('청사과·솔루치아 복륜·선키스트 백금·수박금', () => {
    expect(pick('298번 자 청사과 자 요 아이 40만 원')).toEqual([[298, 400_000, '청사과']])
    expect(pick('311번 자 솔루치아 복륜 자 요 아이는 33만 원')).toEqual([[311, 330_000, '솔루치아 복륜']])
    expect(pick('309번 썬키스트 백금 55만 원')).toEqual([[309, 550_000, '선키스트 백금']])
  })
})
