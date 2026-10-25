// AC-V3-06~09 [device]: 같은 번호 카드에 합치기·바로 등록 설정·바로 등록한 덩어리의 할 일·어떤 문자열에도 예외 없음.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MERGE_TOUCHED_REASON,
  askFor,
  canLearnAlias,
  chooseAction,
  checkVoiceSettings,
  chooseInstantAction,
  createCard,
  decideSameNumber,
  extractVoice,
  guessVariety,
  isCardWorthy,
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
    // D-V3-64: 가격 크기로 막지 않는다
    expect(mergeIntoCard(card('핑크프릴', null), chunk('15번 400만 원'), reg('15번 400만 원')).autoDue).toBe(true)
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

describe('AC-V3-51 카드는 확정된 번호가 있을 때만 (D-V3-41)', () => {
  const act = (text: string) => chooseAction(chunk(text), { cards: [], now: 0, registration: reg(text) })
  it.each([
    ['어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요', '번호가 여럿 들렸어요: 189·139'], // R7
    ['자 9cm에 이거 25만 원 170', '번호가 가격 뒤에 들렸어요'], // R34
    ['삼광색금 3강 25만 원', '번호를 못 들었어요'], // R35
    ['요 아이는 65만 원까지 자 색감이 이렇게 예쁘게 나왔네요 자 60 어 자', '번호가 가격 뒤에 들렸어요'], // R44
    ['칠만 원', '번호를 못 들었어요'], // R50
    ['핑크문 만원', '번호를 못 들었어요'], // R50
  ])('%s → 카드 없음, 기록 "%s"', (text, reason) => {
    expect(act(text)).toEqual({ kind: 'discard', reason, cancelled: false })
  })
  it('끔 "15번" → 번호만 카드 (문구는 D-V3-44로 V2 그대로)', () => {
    const action = act('15번')
    expect(action).toMatchObject({ kind: 'create', ask: '품종·가격을 말해 주세요', extraction: { no: 15, price: null } })
    expect(askFor({ name: '라울', price: null })).toBe('가격을 말해 주세요')
  })
  it('isCardWorthy는 no ≠ null일 때만', () => {
    expect(isCardWorthy({ no: null, name: '핑크문', price: 10000, confidence: 'LOW' })).toBe(false)
    expect(isCardWorthy({ no: 15, name: null, price: null, confidence: 'LOW' })).toBe(true)
  })
  it('번호 없는 덩어리는 맨 앞 열린 카드 이어 채우기만', () => {
    const open = card(null, null)
    expect(chooseAction(chunk('엘레강스 이만원'), { cards: [open], now: 3000, chunkStartedAt: 2000, registration: reg('엘레강스 이만원') })).toMatchObject({ kind: 'fill', cardId: 'c1' })
  })
})

describe('실방송 화면 사례 — 군말이 낀 창은 사전 이름에 맞추지 않는다', () => {
  const text = '지금 금이 선명하게 안 보여서 그런지 금은 다 있어요 자 그러면 안쪽부터 금은 다 물고 있습니다 청개구리 어 요이 자 얘는 행운의 소장합니다 7만 원'
  it('번호 없음 → 카드 없음 (청개구리는 실방송 7차로 사전에 들어가 말 그대로 맞음)', () => {
    expect(extractVoice(text, { dictionary: DICT })).toEqual({ no: null, name: '청개구리', price: 70000, confidence: 'LOW' })
    expect(chooseAction(chunk(text), { cards: [], now: 0, registration: reg(text) })).toEqual({ kind: 'discard', reason: '번호를 못 들었어요', cancelled: false })
  })
  it("'자' + 다음 낱말 창이 '자보' 같은 사전 이름이 되지 않는다", () => {
    expect(extractVoice('59번 자 보 7만 원', { dictionary: DICT }).name).toBeNull()
    expect(extractVoice('59번 요 자보 7만 원', { dictionary: DICT }).name).toBe('자보')
    expect(extractVoice('59번 얘는 자보 7만 원', { dictionary: DICT }).name).toBe('자보')
  })
})

describe('D-V3-44 켬이면 원 가격 없는 결과는 기억(카드 없음), 끔이면 V2 그대로', () => {
  const on = (text: string, cards: SuggestionCard[] = [], now = 0, chunkStartedAt = 0) =>
    chooseAction(chunk(text), { cards, now, chunkStartedAt, autoRegister: true, registration: reg(text) })
  const off = (text: string, cards: SuggestionCard[] = [], now = 0, chunkStartedAt = 0) => chooseAction(chunk(text), { cards, now, chunkStartedAt, registration: reg(text) })
  it('R25 켬 한 덩어리 "15번 엘레강스 이만원" → 확정 읽기로 바로 등록, 그 전("15번 엘레강스")은 기억', () => {
    expect(on('15번 엘레강스')).toEqual({ kind: 'discard', reason: '가격을 못 들었어요', cancelled: false, remembered: { no: 15, name: '엘레강스', price: null, confidence: 'LOW' } })
    expect(readyToRegister('15번 엘레강스 이만원', { dictionary: DICT })).toMatchObject({ no: 15, name: '엘레강스', price: 20000 })
  })
  it('R51 켬 "15번" 뒤 4초에 "엘레강스 이만원" → 첫 덩어리 기억(버림), 둘째는 이어 채우기 없이 번호를 못 들었어요', () => {
    expect(on('15번')).toMatchObject({ kind: 'discard', reason: '가격을 못 들었어요', remembered: { no: 15 } })
    const open = card(null, null)
    expect(on('엘레강스 이만원', [open], 4000, 4000)).toEqual({ kind: 'discard', reason: '번호를 못 들었어요', cancelled: false })
  })
  it('R52 켬 잡담 "이 10번 …"·원 없는 가격 "15번 핑크프릴 만오천" → 카드 없음, 가격을 못 들었어요', () => {
    expect(on('이 10번 오타 하나 지우신 거예요 아 그런가요')).toMatchObject({ kind: 'discard', reason: '가격을 못 들었어요', remembered: { no: 10 } })
    expect(on('15번 핑크프릴 만오천')).toMatchObject({ kind: 'discard', reason: '가격을 못 들었어요', remembered: { no: 15, price: 15000 } })
  })
  it('R53 끔 "15번" → V2 카드 "품종·가격을 말해 주세요"', () => {
    expect(off('15번')).toMatchObject({ kind: 'create', ask: '품종·가격을 말해 주세요' })
    // 끔은 덩어리 사이 이어 채우기도 V2 그대로
    expect(off('엘레강스 이만원', [card(null, null)], 4000, 4000)).toMatchObject({ kind: 'fill', cardId: 'c1' })
  })
  it('켬이어도 원 가격이 있으면 카드(덩어리 끝 — 바로 등록은 조각 읽기가 이미 했다)', () => {
    expect(on('15번 400만 원')).toMatchObject({ kind: 'create', extraction: { no: 15, price: 4000000 } })
  })
  it('chooseInstantAction은 끔이면 null', () => {
    const text = '15번 라울 만원 취소'
    expect(chooseInstantAction(chunk(text), { registered: [15], registration: reg(text), autoRegister: false })).toBeNull()
  })
})

describe('TD-V3-003 켬에서 원 없는 정정 덩어리는 카드 없음', () => {
  const on = (text: string) => chooseAction(chunk(text), { cards: [], now: 0, autoRegister: true, registration: reg(text) })
  it.each(['15번 만오천 아니 만팔천', '만팔천 말고 15번', '15번 라울 만오천말고 만팔천', '15번 만오천 다시 만팔천'])('%s → 가격을 못 들었어요', (text) => {
    expect(on(text)).toMatchObject({ kind: 'discard', reason: '가격을 못 들었어요' })
  })
  it('15번 만오천원 아니 만팔천원 → 카드 15번 18,000원 그대로', () => {
    expect(on('15번 만오천원 아니 만팔천원')).toMatchObject({ kind: 'create', extraction: { no: 15, price: 18000 } })
  })
})

describe('실방송 7차 품종 (사전 추가 — 사용자 확인 필요)', () => {
  it.each([
    ['89번 녹금 7만 원', '녹금'],
    ['89번 녹색금 7만 원', '녹금'],
    ['89번 록금 7만 원', '녹금'],
    ['92번 빅뱅 6만 원', '빅뱅'],
    ['92번 빅뱅금 6만 원', '빅뱅금'],
    ['92번 빅뱅 금 6만 원', '빅뱅금'],
    ['30번 청개구리 5만 원', '청개구리'],
    ['31번 청수박 5만 원', '청수박'],
    ['32번 로제스타 5만 원', '로제스타수박'],
    ['33번 로제스타수박 5만 원', '로제스타수박'],
  ])('%s → %s', (text, name) => {
    expect(readyToRegister(text, { dictionary: DICT })).toMatchObject({ name })
  })
})
