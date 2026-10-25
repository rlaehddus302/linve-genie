// AC-V3-06~09 [device]: 같은 번호 카드에 합치기·바로 등록 설정·바로 등록한 덩어리의 할 일·어떤 문자열에도 예외 없음.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MERGE_TOUCHED_REASON,
  canLearnAlias,
  checkVoiceSettings,
  chooseInstantAction,
  createCard,
  decideSameNumber,
  extractVoice,
  guessVariety,
  learnAlias,
  mergeIntoCard,
  mergeSameNumberCards,
  prepareVoiceDictionary,
  readChunk,
  readLearnedAliases,
  readRegistration,
  readSure,
  readyToRegister,
  resolveVoiceSettings,
  resolveQuietMs,
  touchCard,
  type SuggestionCard,
} from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const chunk = (text: string) => readChunk(text, { dictionary: DICT })
const reg = (text: string) => readRegistration(text, { dictionary: DICT, final: true })
const card = (name: string | null, price: number | null, extra: Partial<SuggestionCard> = {}): SuggestionCard => {
  const made = createCard({ id: 'c1', extraction: { no: 15, name, price, confidence: 'LOW' }, text: '', createdAt: 0 })
  if (made === null) throw new Error('카드 없음')
  return { ...made, ...extra }
}

describe('AC-V3-06 mergeIntoCard', () => {
  it('(a) 손대지 않은 카드 + 같은 번호 사전 품종 → 한 장, 품종 바뀜', () => {
    const r = mergeIntoCard(card('핑크프릴', 15000), chunk('15번 핑크문 만오천'), reg('15번 핑크문 만오천'))
    expect(r.card).toMatchObject({ id: 'c1', no: 15, name: '핑크문', price: 15000 })
    expect(r.changed).toBe(true)
    expect(r.autoDue).toBe(false) // 원이 없다
  })
  it('(b) 추측 품종 카드 + 사전 품종 → 사전 품종', () => {
    const r = mergeIntoCard(card('bts', 15000, { nameNeedsCheck: true }), chunk('15번 핑크문 만오천'), reg('15번 핑크문 만오천'))
    expect(r.card.name).toBe('핑크문')
    expect(r.card.nameNeedsCheck).toBe(false)
  })
  it('(c) 사전 품종 카드 + 추측 → 그대로', () => {
    const text = '15번 bts 자 bts 만오천'
    expect(reg(text).guess).toBe('bts')
    const r = mergeIntoCard(card('핑크프릴', 15000), chunk(text), reg(text))
    expect(r.card.name).toBe('핑크프릴')
    expect(r.changed).toBe(false)
  })
  it('(c2) 빈 품종 카드 + 추측 → 그대로 비움 (D-V3-37 — 추측은 후보 단추로만)', () => {
    const text = '15번 bts 자 bts 만오천'
    const r = mergeIntoCard(card(null, 15000), chunk(text), reg(text))
    expect(r.card.name).toBeNull()
    expect(r.changed).toBe(false)
  })
  it('(d) 손댄 카드 → 바뀌지 않고 까닭', () => {
    const touched = touchCard(card('핑크프릴', 15000))
    const r = mergeIntoCard(touched, chunk('15번 핑크문 2만 원'), reg('15번 핑크문 2만 원'))
    expect(r).toEqual({ card: touched, changed: false, autoDue: false, reason: '고치는 중인 카드라 바꾸지 않았어요' })
    expect(MERGE_TOUCHED_REASON).toBe('고치는 중인 카드라 바꾸지 않았어요')
  })
  it("(e) 원 가격이고 번호가 'N번'이면 바로 등록 대상, '번' 없는 번호면 아님", () => {
    expect(mergeIntoCard(card('핑크프릴', null), chunk('15번 만오천 원'), reg('15번 만오천 원'))).toMatchObject({ autoDue: true, card: { price: 15000 } })
    expect(mergeIntoCard(card('핑크프릴', null), chunk('15 만오천 원'), reg('15 만오천 원')).autoDue).toBe(false)
    expect(mergeIntoCard(card('핑크프릴', null), chunk('15번 400만 원'), reg('15번 400만 원')).autoDue).toBe(false)
  })
})

describe('AC-V3-07 바로 등록 설정 voice.autoRegister', () => {
  it('빈 값·틀린 값 → 참, 옛 키는 읽지 않음, 끈 때만 거짓', () => {
    for (const value of [undefined, null, 1, 'x', [], {}, { 'voice.autoRegister': 'false' }, { 'voice.autoRegister': 0 }]) expect(resolveVoiceSettings(value)['voice.autoRegister']).toBe(true)
    expect(resolveVoiceSettings({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 })['voice.autoRegister']).toBe(true)
    expect(checkVoiceSettings({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 })).toEqual([])
    expect(resolveVoiceSettings({ 'voice.autoRegister': false })['voice.autoRegister']).toBe(false)
    expect(checkVoiceSettings({ 'voice.autoRegister': false })).toEqual([])
    expect(checkVoiceSettings({ 'voice.autoRegister': 'no' }).map((p) => p.key)).toEqual(['voice.autoRegister'])
  })
  it('voice.quietMs는 V2 그대로', () => {
    expect(resolveQuietMs({ 'voice.quietMs': 2500 })).toBe(2500)
    expect(resolveQuietMs({ 'voice.quietMs': 2550 })).toBe(1800)
  })
})

describe('AC-V3-08 바로 등록한 덩어리의 할 일', () => {
  it('취소가 들리면 되돌림', () => {
    const text = '15번 라울 만원 취소'
    expect(chooseInstantAction(chunk(text), { registered: [15], registration: reg(text) })).toEqual({ kind: 'undoRegistered', nos: [15] })
  })
  it('다른 N번이 섞이면 알림 (189·139)', () => {
    const text = '189번 빅뱅금 50만 원 139번'
    expect(chooseInstantAction(chunk(text), { registered: [189], registration: reg(text) })).toEqual({
      kind: 'otherNumber',
      no: 189,
      others: [139],
      message: '189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.',
    })
  })
  it('정정으로 덮은 결과 → R-22(sameNumber)', () => {
    const text = '108번 10만원 아니 12만원'
    const reading = chunk(text)
    expect(reading).toMatchObject({ no: 108, price: 120000 })
    expect(chooseInstantAction(reading, { registered: [108], registration: reg(text) })).toEqual({ kind: 'sameNumber', no: 108 })
  })
  it('번호 없는 정정 덩어리·바로 등록 없는 덩어리 → null (V2 할 일 그대로)', () => {
    expect(chooseInstantAction(chunk('아니 12만 원'), { registered: [108], registration: reg('아니 12만 원') })).toBeNull()
    expect(chooseInstantAction(chunk('15번 라울 만원'), { registered: [], registration: reg('15번 라울 만원') })).toBeNull()
  })
})

describe('AC-V3-09 어떤 문자열에도 예외 없음', () => {
  const special = ['', 'x'.repeat(301), '1234567', '원', '😀🌵 15번 만원', '<b>15번</b> 만원', '   ', '\u0000￿']
  const text = fc.oneof(fc.constantFrom(...special), fc.string({ maxLength: 40 }), fc.string({ unit: 'grapheme', maxLength: 40 }))
  it('extractVoice·guessVariety·readSure·decideSameNumber·mergeIntoCard', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(() => extractVoice(input, { dictionary: DICT })).not.toThrow()
        const guess = guessVariety(input)
        if (guess !== null) {
          expect(/[0-9]/.test(guess)).toBe(false)
          expect([...guess].length).toBeGreaterThanOrEqual(2)
          expect([...guess].length).toBeLessThanOrEqual(20)
        }
        expect(() => readSure(input, { dictionary: DICT })).not.toThrow()
        expect(() =>
          decideSameNumber({ heard: { price: null, priceSure: false, name: input, nameFrom: 'DICTIONARY' }, product: { name: input, price: 1000, status: 'OPEN', liveClaims: 0 }, auto: true }),
        ).not.toThrow()
        expect(() => mergeIntoCard(card(null, null), chunk(input), reg(input))).not.toThrow()
      }),
      { numRuns: 1000 },
    )
  })
  it('readSure 모양', () => {
    expect(readSure('189번 빅뱅금 139번 50만 원', { dictionary: DICT })).toMatchObject({ sure: false, no: null, numbers: [189, 139] })
    expect(readSure('15번 라울 삼십 오만 원', { dictionary: DICT })).toMatchObject({ sure: true, no: 15, price: 350000, name: '라울', numberFrom: 'marker' })
    expect(readSure('15번 라울 삼십 오만', { dictionary: DICT }).sure).toBe(false)
  })
})

describe('E2E R48 — 자리가 겹치는 앞 수는 붙여 읽지 않는다 (D-V3-25)', () => {
  it('"108 12만 원 자" → 108번(번 없음) · 120,000원', () => {
    expect(readRegistration('108 12만 원 자', { dictionary: DICT, final: true }).ready).toEqual({ no: 108, price: 120000, name: null, nameNeedsCheck: false, numberFrom: 'bare' })
    expect(chunk('108 12만 원 자')).toMatchObject({ no: 108, price: 120000 })
    expect(extractVoice('170 25만 원')).toMatchObject({ no: 170, price: 250000 })
    // 겹치지 않으면 그대로 합친다
    expect(extractVoice('15번 30 5만 원')).toMatchObject({ no: 15, price: 350000 })
    expect(extractVoice('15번 삼십 오만 원')).toMatchObject({ no: 15, price: 350000 })
    expect(extractVoice('15번 2 만원').price).toBe(20000)
    // 단위만인 토큰(천·백)은 계수가 없어 겹침이 아니다
    expect(extractVoice('15번 2 천 5 백 원').price).toBe(2500)
  })
})

describe('AC-V3-50 배운 별칭은 흔한 말을 배우지 않는다 (D-V3-38)', () => {
  it.each(['보니까', '그런데', '있고요', '한번', '약간', '요거', '3강'])('%s → 배우지 않음', (heard) => {
    expect(canLearnAlias(heard, '보니타')).toBe(false)
    expect(learnAlias([], { heard, name: '보니타', at: 1 })).toEqual([])
  })
  it('선버스 → 선버스트는 그대로 배운다 (AC-V2-09)', () => {
    expect(canLearnAlias('선버스', '선버스트')).toBe(true)
  })
  it('저장소에 있던 흔한 말 별칭은 읽을 때 버리고, 말하면 품종 미입력', () => {
    const stored = [{ heard: '보니까', name: '보니타', usedAt: 5 }, { heard: '선버스', name: '선버스트', usedAt: 3 }]
    const learned = readLearnedAliases(stored)
    expect(learned).toEqual([{ heard: '선버스', name: '선버스트', usedAt: 3 }])
    const dictionary = prepareVoiceDictionary({ learned, base: [{ name: '보니타' }, { name: '라울' }] })
    expect(readyToRegister('15번 보니까 만오천 원', { dictionary })).toEqual({ no: 15, price: 15000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
  })
})

describe('D-V3-37 추측은 등록·합치기에 쓰지 않는다', () => {
  it('확정 읽기 name은 사전 맞춤뿐, 추측은 guess로', () => {
    const r = readRegistration('15번 bts 자 bts 만오천 원', { dictionary: DICT })
    expect(r.ready).toEqual({ no: 15, price: 15000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
    expect(r.guess).toBe('bts')
    expect(readSure('15번 bts 자 bts 만오천 원', { dictionary: DICT })).toMatchObject({ sure: true, name: null, guess: 'bts' })
  })
  it('mergeSameNumberCards는 추측 품종 카드의 품종을 옮기지 않는다', () => {
    const newer = card(null, 15000, { id: 'b' })
    const older = card('bts', null, { id: 'a', nameNeedsCheck: true })
    const merged = mergeSameNumberCards([newer, older])
    expect(merged[0]).toMatchObject({ id: 'b', status: 'OPEN', name: null, price: 15000 })
  })
})
