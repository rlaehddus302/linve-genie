// 실방송 V3 (09:13~09:18): 한 글자 다른 사전 이름 · 값을 묻는 말 뒤의 수 · 가격 되풀이 · 번호 흐름 밖의 '번' 없는 수
import { describe, expect, it } from 'vitest'
import { bareNumberFits, oneSyllableName, prepareVoiceDictionary, readRegistration, readSegments } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const pick = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name, p.numberFrom])

describe('한 글자 다른 사전 이름 (야래양·야래학 → 야래향)', () => {
  it('실방송 글', () => {
    expect(pick('344번 야래양 자 요 아이 13만 원')).toEqual([[344, 130_000, '야래향', 'marker']])
    expect(pick('348번 야래학 자 요 아이는 10만 원')).toEqual([[348, 100_000, '야래향', 'marker']])
    expect(pick('312번입니다 자 수박이 5만 원')).toEqual([[312, 50_000, '수박금', 'marker']])
  })
  it('사전: 황소개구리(청개구리에 먹히지 않음)·몽고리색금(몽골이 색금이고요)', () => {
    expect(pick('346번 자 황소개구리 자 요 아이 10 5만 원')).toEqual([[346, 150_000, '황소개구리', 'marker']])
    expect(pick('93번 청개구리 23만 원')).toEqual([[93, 230_000, '청개구리', 'marker']])
    expect(pick('337번입니다 자 몽골이 색금이고요 자 이모 요거 얼마 갔었죠 10만 원')).toEqual([[337, 100_000, '몽고리색금', 'marker']])
    expect(pick('337번 몽고리 색금 10만 원')).toEqual([[337, 100_000, '몽고리색금', 'marker']])
  })
  it('실방송 333번: "30원"은 가격이 아니고 가격 뒤 번호로 35만 원', () => {
    expect(pick('자 요거는 6.43cm 정도 얘는 30원 자 35만 원 얘는 금발이 너무 잘 나왔죠 자 몽골이 색금입니다 몽골이 색금 333번')).toEqual([[333, 350_000, '몽고리색금', 'marker']])
  })
  it('사전: 적상화(적상화 색상아)·녹비(높비 — 2음절은 적어 둔 들린 모양만)', () => {
    expect(pick('353번 자 적상화 자 요 아이는 30만 원')).toEqual([[353, 300_000, '적상화', 'marker']])
    expect(pick('352번 자 높입니다 높비 자 요 아이는 30만 원')).toEqual([[352, 300_000, '녹비', 'marker']])
    expect(pick('352번 녹 비 30만 원')).toEqual([[352, 300_000, '녹비', 'marker']])
  })
  it('흔한 말은 이름이 되지 않는다', () => {
    expect(pick('312번 그래서 이거는 정말 예쁘죠 5만 원')).toEqual([[312, 50_000, null, 'marker']])
    expect(pick('312번 드릴게요 5만 원')).toEqual([[312, 50_000, null, 'marker']])
  })
  it('두 이름이 똑같이 가까우면 비운다 · 2음절은 보지 않는다', () => {
    expect(oneSyllableName(['가나다'], { dictionary: ['가나라', '가마다'] })).toBeNull()
    expect(oneSyllableName(['가나다'], { dictionary: ['가나라', '바사아'] })).toBe('가나라')
    expect(oneSyllableName(['가나'], { dictionary: ['가라'] })).toBeNull()
    expect(oneSyllableName(['야래양이요'], { dictionary: DICT })).toBe('야래향')
  })
})

describe("'번' 없는 수가 번호가 아닌 때", () => {
  it('값을 묻는 말(얼마…) 바로 뒤 — 실방송 "얼마 드릴까 50 … 10만 원"은 50번이 아니다', () => {
    expect(pick('자 요거 요거는 뭐야 색금이네요 색금 색금 자 요거 얼마 드릴까 50 자 요거 일단 5cm로 해 가지고 10만 원')).toEqual([])
    expect(pick('얼마에 드릴까 168 10만 원')).toEqual([])
    expect(pick('자 168 10만 원')).toEqual([[168, 100_000, null, 'bare']])
  })
  it('바로 뒤 금액의 계수와 같은 수 — 실방송 "너무예쁜데 25 자 25만 원"은 25번이 아니다', () => {
    expect(pick('자 요거 5.5cm요 너무예쁜데 25 자 25만 원')).toEqual([])
    expect(pick('너무 예뻐요 이십오 자 이십오만 원')).toEqual([])
    expect(pick('자 26 25만 원')).toEqual([[26, 250_000, null, 'bare']])
    // 'N번'은 그대로
    expect(pick('25번 25만 원')).toEqual([[25, 250_000, null, 'marker']])
  })
  it('사용자 요구 "13 자 13만원" — 군말만 사이에 둔 같은 수 + 만/천 금액은 가격 되풀이 (번호 없음 = 카드·기다리는 번호도 없음)', () => {
    for (const text of ['13 자 13만원', '13 13만 원', '십삼 자 십삼만 원', '13에 13만 원', '13 어 요 13만 원', '5 자 5천 원']) {
      const s = readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 })
      expect(s.picks).toEqual([])
      expect(s.others).toEqual([])
      expect(readRegistration(text, { dictionary: DICT, final: true, maxNumber: 999 }).heardNumbers).toEqual([])
    }
  })
  it('실방송 "자 적상화 색상아 이거거 30 자 요 아이 30만 원" — 30번이 아니다 (군말 자·요·아이를 건너 가격 되풀이)', () => {
    expect(pick('자 적상화 색상아 이거거 30 자 요 아이 30만 원')).toEqual([])
    expect(pick('353번 자 요 아이는 30만 원')).toEqual([[353, 300_000, null, 'marker']])
    // 같은 조각 뒤쪽 어디든(사이에 다른 수가 없으면) 같은 수의 금액이면 되풀이 (실방송 10:05 — 사용자 요구)
    expect(pick('자 30 정말 너무 예쁜 30만 원')).toEqual([])
    // 사이에 다른 수가 끼면 되풀이로 보지 않는다
    expect(pick('자 30 요거 8 정도 30만 원')).toEqual([])
    expect(pick('자 30 정말 너무 예쁜 31만 원')).toEqual([[30, 310_000, null, 'bare']])
  })
  it('실방송 10:05 "… 15 응 이모 … 착하게 들이라며 자 15만 원"은 15번이 아니고, "390 5번입니다 … 15만 원"만 395번', () => {
    expect(pick('입성 좋습니다 자 요 8cm 나와요 15 응 이모 그렇게밖에 안 한다고요 착하게 들이라며 자 15만 원')).toEqual([])
    expect(pick('390 5번입니다 자 요 아이는 15만 원')).toEqual([[395, 150_000, null, 'marker']])
    expect(pick('입성 좋습니다 자 요 8cm 나와요 15 응 이모 그렇게밖에 안 한다고요 착하게 들이라며 자 15만 원 390 5번입니다 자 요 아이는 15만 원').map((p) => p[0])).toEqual([395])
  })
  it('bareNumberFits: 최근 음성 등록 2개가 모두 ±20 밖이면 맞지 않는다', () => {
    expect(bareNumberFits(50, [312, 349])).toBe(false)
    expect(bareNumberFits(25, [343, 349])).toBe(false)
    expect(bareNumberFits(340, [343, 349])).toBe(true)
    expect(bareNumberFits(50, [349])).toBe(true)
    expect(bareNumberFits(50, [])).toBe(true)
    expect(bareNumberFits(50, [45, 349])).toBe(true)
    expect(bareNumberFits(50, [349, 45])).toBe(true)
  })
})
