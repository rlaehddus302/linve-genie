// 실방송 V3 (금화다육 468번, 2026-10-26): 지난 일로 말한 가격은 번호에 붙이지도, 있는 가격을 고치지도 않는다.
// 468번을 "468번 자 UI 5만 원"으로 50,000원 등록한 뒤 2분 뒤 경험담 "… 120만 원까지 팔아 본 적 있어요 …"에서 468번이 1,200,000원으로 고쳐졌다(틀림).
import { describe, expect, it } from 'vitest'
import { listWonLines } from '../src/extract.ts'
import { PAST_PRICE_TAILS, isPastPriceLine, prepareVoiceDictionary, readMarkerCorrection, readRegistration, readSegments, tokenize } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const OPTIONS = { dictionary: DICT, maxNumber: 999 }
const pick = (text: string, final = true) => readSegments(text, { ...OPTIONS, ...(final ? { final: true } : {}) }).picks.map((p) => [p.no, p.price])

/** 실방송 최종 결과 그대로 */
const LIVE_FINAL =
  '언니 좀 일찍 들어오시지 지금 거리가 뭔데 자 468번은 이제 앞으로 핀이 들어오셨습니다 자 저거는 진짜 두 개 다 들어와도 나중에 조금만 진짜 제 말씀 들으시고 자 제가 팔색조 세금을 자 120만 원까지 팔아 본 적 있어요 자 저거는 창세 금이기 때문에 자 포미닛 자 감사합니다 자 5만 원이면 저거 다 잡아가셔도 진짜 득템이에요'
/** 음성 기록에 남은 고친 말 (굳은 중간 글로 넘긴 조각) */
const LIVE_HEARD = '468번은 이제 앞으로 핀이 들어오셨습니다 자 저거는 진짜 두 개 다 들어와도 나중에 조금만 진짜 제 말씀 들으시고 자 제가 팔색조 세금을 자 120만 원까지'
const LIVE_HEAD = '언니 좀 일찍 들어오시지 지금 거리가 뭔데 자 468번은 이제 앞으로 핀이 들어오셨습니다 자 저거는 진짜 두 개 다 들어와도 나중에 조금만 진짜 제 말씀 들으시고 자 제가 팔색조 세금을'

describe('실방송 468번 경험담 "120만 원까지 팔아 본 적 있어요"', () => {
  it('최종 결과: 120만 원은 468번 가격이 아니다 — 고를 조각이 없다(뒤의 "5만 원이면"은 원 가격 줄이 아니라 지금처럼 둠)', () => {
    expect(pick(LIVE_FINAL)).toEqual([])
    expect(pick(LIVE_FINAL, false)).toEqual([])
  })
  it('지시받은 조각 그대로 (… 줄임 없이 이은 글)', () => {
    const text =
      '자 468번은 이제 앞으로 핀이 들어오셨습니다 자 저거는 진짜 두 개 다 들어와도 나중에 조금만 진짜 제 말씀 들으시고 자 제가 팔색조 세금을 자 120만 원까지 팔아 본 적 있어요 자 저거는 창세 금이기 때문에 자 5만 원이면 저거 다 잡아가셔도 진짜 득템이에요'
    expect(pick(text)).toEqual([])
    expect(pick(text, false)).toEqual([])
  })
  it('중간 결과: 경험담 꼴이 붙은 동안은 어느 때에도 120만 원을 고르지 않는다', () => {
    const tails = ['120만 원까지 팔아 본 적 있어요', '120만 원까지 팔아 본 적', '120만 원까지 팔아 본', '120만 원까지 팔아', '120만 원까지 팔', '120만 원까지', '자 120만 원까지 팔아 본 적 있어요 자 저거는']
    for (const tail of tails) {
      expect(pick(`${LIVE_HEAD} 자 ${tail}`, false)).toEqual([])
      expect(pick(`${LIVE_HEAD} 자 ${tail}`, false).some(([, price]) => price === 1_200_000)).toBe(false)
    }
    // 실방송: 크롬이 결과를 둘로 나눠 앞 글이 "원까지"·"원까지 팔아"로 끝났다
    expect(pick(`${LIVE_HEAD} 자 120만 원까지`, false)).toEqual([])
    expect(pick(`${LIVE_HEAD} 자 120만 원까지 팔아`, false)).toEqual([])
  })
  it('읽기(readRegistration)의 원 가격·들린 가격에도 120만 원이 없다', () => {
    const read = readRegistration(LIVE_FINAL, { ...OPTIONS, final: true })
    expect(read.wonPrices).toEqual([])
    expect(read.heardPrices).not.toContain(1_200_000)
    expect(read.heardNumbers).toEqual([468])
  })
  it('굳은 중간 글로 넘어간 조각에 뒤 글이 붙으면 가격이 아니다', () => {
    expect(pick(`${LIVE_HEARD} 팔아 본 적 있어요`)).toEqual([])
    expect(pick(`${LIVE_HEARD} 팔아 본 적`, false)).toEqual([])
  })
})

describe('지난 일·경험을 말하는 꼴', () => {
  it('가격 바로 뒤 경험담 꼴이면 번호에 붙지 않는다', () => {
    for (const text of [
      '15번 120만 원까지 팔아 본 적 있어요',
      '15번 120만 원까지 팔아 봤어요',
      '15번 120만원까지 팔아봤어요',
      '15번 예전에 30만 원에 팔았어요',
      '15번 30만 원에 팔았었어요',
      '15번 30만 원 받아 본 적 있어요',
      '15번 30만 원까지 받아 봤어요',
      '15번 30만 원 본 적 있어요',
      '15번 30만 원 했었어요',
      '15번 30만 원까지 갔었어요',
      '15번 30만 원에 제가 팔아 봤어요',
      '15번 30만 원까지도 팔아 봤어요',
    ]) {
      expect(pick(text)).toEqual([])
      expect(readRegistration(text, { ...OPTIONS, final: true }).wonPrices).toEqual([])
    }
  })
  it('지난 가격 뒤 지금 가격을 말하면 지금 가격만', () => {
    expect(pick('15번 이거 30만 원까지 팔아 봤어요 오늘은 5만 원')).toEqual([[15, 50_000]])
    expect(pick('15번 30만 원에 팔았었는데 자 5만 원')).toEqual([[15, 50_000]])
  })
  it('가격 뒤 번호(가격 뒤 번호 꼴)도 경험담 가격을 쓰지 않는다', () => {
    expect(pick('제가 이거 120만 원까지 팔아 본 적 있어요 자 470번')).toEqual([])
  })
  it('정정 낱말 길(readMarkerCorrection)도 경험담 가격을 쓰지 않는다', () => {
    expect(readMarkerCorrection('65번 아니 120만 원까지 팔아 봤어요', { maxNumber: 999 })).toBeNull()
    expect(readMarkerCorrection('65번 아니 5만 원', { maxNumber: 999 })?.price).toBe(50_000)
  })
  it('지금 가격 말투는 그대로 가격이다 (경험담 꼴이 아님)', () => {
    expect(pick('15번 5만 원에 드릴게요')).toEqual([[15, 50_000]])
    expect(pick('15번 5만 원까지 드릴게요')).toEqual([[15, 50_000]])
    expect(pick('15번 5만 원 팔아 볼게요')).toEqual([[15, 50_000]])
    expect(pick('15번 5만 원 이거 많이 팔아 봤어요')).toEqual([[15, 50_000]])
    expect(pick('15번 5만 원')).toEqual([[15, 50_000]])
    expect(pick('15번 5만 원', false)).toEqual([[15, 50_000]])
    // 덩어리가 끝났으면 "원까지"로 끝나도 가격이다 (뒤 낱말이 없다)
    expect(pick('15번 5만 원까지')).toEqual([[15, 50_000]])
  })
  it('중간 결과에서 "원까지"·"원에" 뒤를 기다리고, 뒤 낱말이 오면 정한다', () => {
    expect(pick('15번 5만 원에', false)).toEqual([])
    expect(pick('15번 5만 원에 드', false)).toEqual([[15, 50_000]])
    expect(pick('15번 5만 원까지 팔', false)).toEqual([])
    expect(pick('15번 5만 원까지 팔아 볼게요', false)).toEqual([[15, 50_000]])
  })
  it('isPastPriceLine: 줄 끝 토큰 위치로 본다 · 이상한 입력은 거짓', () => {
    const tokens = tokenize('120만 원까지 팔아 본 적 있어요') as string[]
    const lines = listWonLines(tokens, { maxNumber: 999, final: true })
    expect(lines).toEqual([])
    expect(isPastPriceLine(tokens, 1)).toBe(true)
    expect(isPastPriceLine(tokens, 0)).toBe(false)
    expect(isPastPriceLine(tokens, 99)).toBe(false)
    expect(isPastPriceLine([], 0)).toBe(false)
    expect(PAST_PRICE_TAILS).toContain('팔아본적')
  })
})
