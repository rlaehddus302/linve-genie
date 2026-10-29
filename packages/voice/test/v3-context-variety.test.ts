// 앞 말 맥락의 품종 (사용자 요구: "바이칼, 바이칼녹금이라고 했는데 그냥 녹금으로 등록했더라")
import { describe, expect, it } from 'vitest'
import { prepareVoiceDictionary, readSegments, varietiesIn, varietyFromContext } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const pick = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])
const ctx = (name: string | null, context: string[]) => varietyFromContext({ name, context, dictionary: DICT })

describe('긴 이름 먼저 (한 조각 안)', () => {
  it('"바이칼녹금"·"바이칼 녹금"은 녹금이 아니라 바이칼녹금', () => {
    expect(pick('312번 바이칼녹금 5만 원')).toEqual([[312, 50_000, '바이칼녹금']])
    expect(pick('312번 바이칼 녹금 5만 원')).toEqual([[312, 50_000, '바이칼녹금']])
    expect(pick('바이칼 바이칼녹금 이거 예쁘죠 자 312번 녹금 5만 원')).toEqual([[312, 50_000, '바이칼녹금']])
    expect(pick('312번 녹금 5만 원')).toEqual([[312, 50_000, '녹금']])
  })
})

describe('varietiesIn', () => {
  it('글에서 사전 품종을 앞에서부터', () => {
    expect(varietiesIn('바이칼 바이칼녹금 이거 예쁘죠 녹금', { dictionary: DICT })).toEqual(['바이칼녹금', '녹금'])
    expect(varietiesIn('자 요 아이 예쁘죠', { dictionary: DICT })).toEqual([])
    // 끝말 붙은 낱말·같은 이름 되풀이는 따로 센다
    expect(varietiesIn('자 다음은 바이칼녹금 바이칼녹금이에요', { dictionary: DICT })).toEqual(['바이칼녹금', '바이칼녹금'])
    expect(varietiesIn('몰디브 몰디브', { dictionary: DICT })).toEqual(['몰디브', '몰디브'])
    expect(varietiesIn(42 as unknown as string, { dictionary: DICT })).toEqual([])
  })
})

describe('varietyFromContext', () => {
  it('들린 이름(녹금)을 품은 더 긴 이름(바이칼녹금)이 앞 말에 있으면 그것', () => {
    expect(ctx('녹금', ['자 바이칼 바이칼녹금 이거 봐 주세요'])).toBe('바이칼녹금')
    expect(ctx('녹금', ['자 요 아이 예쁘죠'])).toBe('녹금')
    expect(ctx('몰디브', ['바이칼녹금 예쁘죠'])).toBe('몰디브')
  })
  it('이름이 없으면 두 번 이상 들린 이름만 (품은 이름도 셈)', () => {
    expect(ctx(null, ['바이칼녹금 예쁘죠', '바이칼녹금 정말'])).toBe('바이칼녹금')
    expect(ctx(null, ['바이칼녹금 예쁘죠 녹금'])).toBe('바이칼녹금')
    expect(ctx(null, ['바이칼녹금 예쁘죠'])).toBeNull()
    expect(ctx(null, [])).toBeNull()
  })
  it('서로 품지 않는 이름이 같은 점수면 비운다 (틀린 이름보다 빈 이름)', () => {
    expect(ctx(null, ['몰디브 몰디브 청사과 청사과'])).toBeNull()
    expect(ctx(null, ['몰디브 몰디브 몰디브 청사과 청사과'])).toBe('몰디브')
  })
  it('번호도 가격도 없는 덩어리(between)에서 따로 들린 이름은 한 번으로도 (실방송 황소개구리·에스텔색금)', () => {
    expect(varietyFromContext({ name: null, context: [], between: ['자 황소개구리 보세요'], dictionary: DICT })).toBe('황소개구리')
    expect(varietyFromContext({ name: null, context: [], between: ['에스텔 색금이에요'], dictionary: DICT })).toBe('에스텔색금')
    // 앞 상품 가격 뒤의 말(context)은 한 번이면 쓰지 않는다
    expect(varietyFromContext({ name: null, context: ['황소개구리 예쁘죠'], between: [], dictionary: DICT })).toBeNull()
    // 둘이 같은 점수면 비운다
    expect(varietyFromContext({ name: null, context: [], between: ['황소개구리 몽고리색금'], dictionary: DICT })).toBeNull()
  })
  it('깨진 입력에 던지지 않는다', () => {
    expect(varietyFromContext({ name: null, context: null as unknown as string[] })).toBeNull()
    expect(varietyFromContext({ name: '녹금', context: [1 as unknown as string] })).toBe('녹금')
  })
})

describe('잎 모양 말 `환엽`은 품종이 아니다 (실방송 경성다육 44·55번 — 창금·창녹금이 환엽으로 채워짐)', () => {
  it('기본 사전에 환엽이 없다', () => {
    expect(DICT.entries.some((entry) => entry.key === '환엽')).toBe(false)
  })
  it('앞 말의 "환엽에·환엽의"가 맥락 품종이 되지 않는다', () => {
    expect(varietiesIn('자 그리고 얘도 완벽한 색감이죠 넓어 환엽에 안쪽에 밑단에부터', { dictionary: DICT })).toEqual([])
    expect(ctx(null, ['넓어 환엽에 안쪽에', '이렇게 환엽의 나오면서', '환엽이고 진하게'])).toBeNull()
  })
  it('같은 조각 안에서도 품종 칸을 비운다', () => {
    expect(pick('44번 환엽에 38만 원')).toEqual([[44, 380_000, null]])
  })
})
