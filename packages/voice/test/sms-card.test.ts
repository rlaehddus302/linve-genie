// AC-V1-03·04 문자찜 카드 상태 — 저절로 넣기 조건·기다림 설정·같은 말 중복 막기·열린 카드 수 (가짜 시각, 시계 없음).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SMS_SETTINGS,
  SMS_PROBLEM_MESSAGES,
  addVoiceCard,
  checkSmsAuto,
  checkSmsSettings,
  chooseSmsBuyer,
  closeSmsCard,
  createCard,
  createSmsCard,
  describeSmsCard,
  findSmsRepeat,
  markSmsRepeat,
  openVoiceCardCount,
  pruneSmsCards,
  readSmsSentence,
  reopenSmsCard,
  resolveSmsSettings,
  sendSmsCard,
  smsBlockMessage,
  smsCountdownText,
  smsProductBlock,
  touchCard,
  touchSmsCard,
  type SmsAutoContext,
  type SmsCard,
  type SmsProductView,
  type SmsReading,
  type VoiceCard,
} from '../src/index.ts'

const T0 = 1_760_000_000_000
const read = (text: string): SmsReading => {
  const reading = readSmsSentence(text)
  if (reading === null) throw new Error(`문자찜 문장이 아니다: ${text}`)
  return reading
}
let nextId = 1
const card = (text: string, createdAt = T0, settings?: unknown): SmsCard => createSmsCard({ id: `sms-${String(nextId++)}`, reading: read(text), text, createdAt, settings })
const OPEN: SmsProductView = { state: 'OPEN', waitlistFull: false }
const ctx = (fields: Partial<SmsAutoContext> = {}): SmsAutoContext => ({ now: T0 + 3000, voiceOn: true, dialogOpen: false, product: () => OPEN, timeAfterNow: false, ...fields })

describe('AC-V1-03 설정 — "문자찜도 듣기"(기본 켬)·"문자찜 자동으로 넣기까지(초)"(0~10, 기본 3)', () => {
  it('기본값과 덮어쓰기', () => {
    expect(DEFAULT_SMS_SETTINGS).toEqual({ 'voice.smsListen': true, 'voice.smsAutoSec': 3 })
    expect(resolveSmsSettings()).toEqual(DEFAULT_SMS_SETTINGS)
    expect(resolveSmsSettings({ 'voice.smsListen': false, 'voice.smsAutoSec': 0 })).toEqual({ 'voice.smsListen': false, 'voice.smsAutoSec': 0 })
    expect(resolveSmsSettings({ 'voice.smsAutoSec': 10 })['voice.smsAutoSec']).toBe(10)
  })

  it.each([[-1], [11], [2.5], ['3'], [null], [Number.NaN], [Infinity]])('기다림 %s → 기본 3초', (value) => {
    expect(resolveSmsSettings({ 'voice.smsAutoSec': value })['voice.smsAutoSec']).toBe(3)
    expect(checkSmsSettings({ 'voice.smsAutoSec': value })).toHaveLength(1)
  })

  it.each([['yes'], [1], [null]])('듣기 %s → 기본 켬', (value) => {
    expect(resolveSmsSettings({ 'voice.smsListen': value })['voice.smsListen']).toBe(true)
    expect(checkSmsSettings({ 'voice.smsListen': value })).toHaveLength(1)
  })

  it('깨진 저장값(객체가 아님·배열·모르는 키·getter 예외) → 기본값, 넘긴 객체를 바꾸지 않는다', () => {
    for (const broken of ['{"x":', 42, [], null, undefined]) expect(resolveSmsSettings(broken)).toEqual(DEFAULT_SMS_SETTINGS)
    const hostile = Object.defineProperty({}, 'voice.smsAutoSec', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    expect(resolveSmsSettings(hostile)).toEqual(DEFAULT_SMS_SETTINGS)
    expect(checkSmsSettings({ 'voice.other': 1 })).toEqual([{ key: 'voice.other', message: '모르는 문자찜 설정이에요' }])
    expect(checkSmsSettings('x')).toHaveLength(1)
    expect(checkSmsSettings(DEFAULT_SMS_SETTINGS)).toEqual([])
    const frozen = Object.freeze({ 'voice.smsAutoSec': 5 })
    expect(resolveSmsSettings(frozen)['voice.smsAutoSec']).toBe(5)
  })
})

describe('AC-V1-03 카드 만들기와 저절로 넣기 조건', () => {
  it('주문 하나·문제 없음 → 만든 시각 + 기다림(기본 3초), 0이면 바로', () => {
    expect(card('165번 문자찜 끝자리 1234').autoAt).toBe(T0 + 3000)
    expect(card('165번 문자찜', T0, { 'voice.smsAutoSec': 0 }).autoAt).toBe(T0)
    expect(card('165번 문자찜', T0, { 'voice.smsAutoSec': 99 }).autoAt).toBe(T0 + 3000)
    expect(card('15번 28번 문자찜 끝자리 1234').autoAt).toBeNull()
    expect(card('300번 문자찜 취소').autoAt).toBeNull()
    expect(card('문자찜').autoAt).toBeNull()
  })

  it('기다림 전에는 넣지 않고, 정확히 그 시각부터 넣는다', () => {
    const c = card('165번 문자찜 끝자리 1234')
    expect(checkSmsAuto(c, ctx({ now: T0 + 2999 })).due).toBe(false)
    expect(checkSmsAuto(c, ctx({ now: T0 + 3000 })).due).toBe(true)
    expect(checkSmsAuto(card('165번 문자찜', T0, { 'voice.smsAutoSec': 0 }), ctx({ now: T0 })).due).toBe(true)
  })

  it('N초 뒤 넣어요 (1초마다 줄어듦)', () => {
    const c = card('165번 문자찜')
    expect(smsCountdownText(c, T0)).toBe('3초 뒤 넣어요')
    expect(smsCountdownText(c, T0 + 1)).toBe('3초 뒤 넣어요')
    expect(smsCountdownText(c, T0 + 1000)).toBe('2초 뒤 넣어요')
    expect(smsCountdownText(c, T0 + 2500)).toBe('1초 뒤 넣어요')
    expect(smsCountdownText(touchSmsCard(c), T0)).toBeNull()
  })

  it('번호 둘 이상·손댄 카드·고르기 카드·문제 카드는 저절로 넣지 않는다', () => {
    const late = ctx({ now: T0 + 60_000 })
    expect(checkSmsAuto(card('15번 28번 문자찜'), late).due).toBe(false)
    expect(checkSmsAuto(touchSmsCard(card('15번 문자찜')), late).due).toBe(false)
    expect(checkSmsAuto(chooseSmsBuyer(card('15번 문자찜 끝자리 1234'), [{ buyer: 'b1', display: '문자찜', phoneLast4: '1234' }]), late).due).toBe(false)
    expect(checkSmsAuto(card('15번 문자찜 끝자리 12'), late).due).toBe(false)
    expect(checkSmsAuto(closeSmsCard(card('15번 문자찜')), late).due).toBe(false)
  })

  it('받을 수 있는 상품만: OPEN, 또는 SOLD이고 대기 자리 있음 — 아니면 이유와 함께', () => {
    expect(smsProductBlock(OPEN)).toBeNull()
    expect(smsProductBlock({ state: 'SOLD', waitlistFull: false })).toBeNull()
    expect(smsProductBlock({ state: 'SOLD', waitlistFull: true })).toBe('WAITLIST_FULL')
    for (const state of ['READY', 'HOLD', 'CLOSED'] as const) expect(smsProductBlock({ state, waitlistFull: false })).toBe('NOT_SELLING')
    expect(smsProductBlock(null)).toBe('NO_PRODUCT')
    const c = card('300번 문자찜')
    expect(checkSmsAuto(c, ctx({ product: () => null }))).toEqual({ due: false, card: c, block: { no: 300, block: 'NO_PRODUCT' } })
    expect(checkSmsAuto(c, ctx({ product: () => ({ state: 'SOLD', waitlistFull: false }) })).due).toBe(true)
    expect(checkSmsAuto(c, ctx({ product: () => { throw new Error('x') } })).due).toBe(false)
  })

  it('이유 문장 (acceptance 그대로)', () => {
    expect(smsBlockMessage(300, 'NO_PRODUCT')).toBe('300번 상품이 없어요.')
    expect(smsBlockMessage(300, 'NOT_SELLING')).toBe('300번은 지금 판매 중이 아니에요.')
    expect(smsBlockMessage(300, 'WAITLIST_FULL')).toBe('300번은 대기까지 다 찼어요.')
    expect(SMS_PROBLEM_MESSAGES).toEqual({
      NUMBER_UNCLEAR: '번호를 못 알아들었어요. 다시 말하거나 문자찜 입력에 넣어 주세요.',
      LAST4_UNCLEAR: '끝자리를 못 알아들었어요. 숫자 네 개로 다시 말해 주세요.',
      NAME_UNCLEAR: '이름이 둘이에요. 한 분씩 말해 주세요.',
      TIME_UNCLEAR: '받은 시각을 못 알아들었어요. 시각 없이 다시 말해 주세요.',
      OPTION_UNCLEAR: "상품·옵션을 못 알아들었어요. '반바지 M 2개 문자찜'처럼 다시 말해 주세요.",
      CANCEL: '음성으로는 찜을 취소하지 않아요. 찜 취소는 화면에서 해 주세요.',
    })
  })

  it('말한 시각이 지금보다 늦으면 누르기 카드가 된다(다시 저절로 되지 않음)', () => {
    const c = card('165번 문자찜 2시 15분')
    const checked = checkSmsAuto(c, ctx({ timeAfterNow: true }))
    expect(checked.due).toBe(false)
    expect(checked.card.autoAt).toBeNull()
    expect(checkSmsAuto(checked.card, ctx({ timeAfterNow: false })).due).toBe(false)
  })

  it('창이 열려 있으면 미루고, 닫힌 뒤 다시 본다', () => {
    const c = card('165번 문자찜')
    const deferred = checkSmsAuto(c, ctx({ dialogOpen: true, now: T0 + 5000 }))
    expect(deferred.due).toBe(false)
    expect(deferred.card.autoAt).toBe(T0 + 3000)
    expect(checkSmsAuto(deferred.card, ctx({ now: T0 + 6000 })).due).toBe(true)
  })

  it('음성이 꺼지면 기다림을 멈추고(다시 켜도) 누르면 넣는다', () => {
    const c = card('165번 문자찜')
    const off = checkSmsAuto(c, ctx({ voiceOn: false }))
    expect(off.due).toBe(false)
    expect(off.card.autoAt).toBeNull()
    expect(checkSmsAuto(off.card, ctx({ now: T0 + 9000 })).due).toBe(false)
    expect(sendSmsCard(off.card, { product: () => OPEN }).ok).toBe(true)
  })
})

describe('AC-V1-03 넣기 — 쓰기 칸·두 번 넣지 않음·고르기', () => {
  const product = (): SmsProductView => OPEN

  it('끝자리 → last4, 메모 비움 / 이름 → 메모 이름 / 둘 다 없음 → 메모 확인 필요 / 시각은 그대로 넘긴다', () => {
    expect(sendSmsCard(card('165번 문자찜 끝자리 1234'), { product })).toMatchObject({ ok: true, writes: [{ no: 165, qty: 1, memo: null, last4: '1234', time: null }] })
    expect(sendSmsCard(card('김민지님 165번 문자찜'), { product })).toMatchObject({ ok: true, writes: [{ no: 165, qty: 1, memo: '김민지', time: null }] })
    expect(sendSmsCard(card('165번 문자찜'), { product })).toMatchObject({ ok: true, writes: [{ no: 165, qty: 1, memo: '확인 필요', time: null }] })
    expect(sendSmsCard(card('165번 문자찜 2시 15분 끝자리 1234 김민지님'), { product })).toMatchObject({
      ok: true,
      writes: [{ no: 165, memo: '김민지', last4: '1234', time: '2:15' }],
    })
    const plain = sendSmsCard(card('165번 문자찜'), { product })
    expect(plain.ok && Object.keys(plain.writes[0] as object).sort()).toEqual(['memo', 'no', 'qty', 'time'])
  })

  it('번호 둘 → 주문마다 쓰기 하나', () => {
    const result = sendSmsCard(card('15번 28번 문자찜 끝자리 1234'), { product })
    expect(result.ok && result.writes.map((write) => write.no)).toEqual([15, 28])
  })

  it('옵션 주문은 options·qty를 넘긴다', () => {
    const reading = readSmsSentence('반바지 M 2개 문자찜 끝자리 1234', {
      parseMode: 'OPTIONS',
      catalog: [{ no: 21, name: '반바지', options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] }] }],
      focus: null,
    })
    const c = createSmsCard({ id: 'o', reading: reading as SmsReading, text: '', createdAt: T0 })
    expect(sendSmsCard(c, { product })).toMatchObject({ ok: true, writes: [{ no: 21, options: { 사이즈: 'M' }, qty: 2, last4: '1234', memo: null }] })
    expect(describeSmsCard(c, { productName: (no) => (no === 21 ? '반바지' : null) })).toBe('21번 반바지 M 2개 · 끝자리 1234 · 문자찜')
  })

  it('넣은 카드는 다시 넣지 않는다, 닫은 카드도', () => {
    const sent = sendSmsCard(card('165번 문자찜'), { product })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(sent.card.status).toBe('SENT')
    expect(sendSmsCard(sent.card, { product })).toMatchObject({ ok: false, reason: 'NOT_OPEN' })
    expect(checkSmsAuto(sent.card, ctx({ now: T0 + 60_000 })).due).toBe(false)
    expect(sendSmsCard(closeSmsCard(card('165번 문자찜')), { product })).toMatchObject({ ok: false, reason: 'NOT_OPEN' })
  })

  it('문제 카드·넣을 수 없는 상품은 누르기로도 넣지 않는다, 넣기 직전에 판매 종료면 이유', () => {
    expect(sendSmsCard(card('15번 문자찜 끝자리 12'), { product })).toMatchObject({ ok: false, reason: 'PROBLEM', message: SMS_PROBLEM_MESSAGES.LAST4_UNCLEAR })
    expect(sendSmsCard(card('300번 문자찜'), { product: () => ({ state: 'CLOSED', waitlistFull: false }) })).toMatchObject({
      ok: false,
      reason: 'PRODUCT',
      message: '300번은 지금 판매 중이 아니에요.',
    })
  })

  it('409 → 고르기 카드: 후보를 골라야 넣고, 고른 구매자를 buyer로(last4 없이)', () => {
    const candidates = [
      { buyer: 'b1', display: '문자찜', phoneLast4: '1234' },
      { buyer: 'b2', display: '문자찜', phoneLast4: '1234' },
    ]
    const sent = sendSmsCard(card('165번 문자찜 끝자리 1234'), { product })
    if (!sent.ok) throw new Error('보내기 실패')
    const choosing = chooseSmsBuyer(sent.card, candidates)
    expect(choosing).toMatchObject({ status: 'OPEN', autoAt: null })
    expect(sendSmsCard(choosing, { product })).toMatchObject({ ok: false, reason: 'CHOOSE_BUYER', message: '끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.' })
    expect(sendSmsCard(choosing, { product, buyer: 'b9' })).toMatchObject({ ok: false, reason: 'UNKNOWN_BUYER' })
    const chosen = sendSmsCard(choosing, { product, buyer: 'b2' })
    expect(chosen).toMatchObject({ ok: true, writes: [{ no: 165, buyer: 'b2', memo: null }] })
    expect(chosen.ok && 'last4' in (chosen.writes[0] as object)).toBe(false)
    // 후보가 없는 카드에 buyer를 넘기면 받지 않는다
    expect(sendSmsCard(card('165번 문자찜'), { product, buyer: 'b1' })).toMatchObject({ ok: false, reason: 'UNKNOWN_BUYER' })
    expect(chooseSmsBuyer(closeSmsCard(card('1번 문자찜')), candidates).status).toBe('CLOSED')
  })

  it('보내기 실패 → 다시 열리되 저절로 넣지 않는다', () => {
    const sent = sendSmsCard(card('165번 문자찜'), { product })
    if (!sent.ok) throw new Error('보내기 실패')
    const again = reopenSmsCard(sent.card)
    expect(again).toMatchObject({ status: 'OPEN', touched: true, autoAt: null })
  })
})

describe('AC-V1-03 카드 문장 (VOC-04)', () => {
  it.each([
    ['165번 문자찜 끝자리 1234', '165번 · 끝자리 1234 · 문자찜'],
    ['김민지님 165번 문자찜', '165번 · 김민지님 · 문자찜'],
    ['165번 문자찜', '165번 · 손님 확인 필요 · 문자찜'],
    ['15번 28번 문자찜 끝자리 1234', '15번 · 28번 · 끝자리 1234 · 문자찜 — 넣을까요?'],
    ['165번 문자찜 2시 15분', '165번 · 손님 확인 필요 · 문자찜 · 받은 시각 2:15'],
    ['165번 문자찜 끝자리 1234 김민지님', '165번 · 끝자리 1234 · 김민지님 · 문자찜'],
  ])('%s → %s', (text, want) => {
    expect(describeSmsCard(card(text))).toBe(want)
  })
})

// ── AC-V1-04 같은 말 ─────────────────────────────────────────────────────

describe('AC-V1-04 같은 말 중복 막기 (10초 안 = 차이 ≤ 10,000ms)', () => {
  it('10초 안 같은 주문·같은 구매자 말 → 앞 카드 (넣었거나 닫았어도)', () => {
    const first = card('165번 문자찜 끝자리 1234', T0)
    expect(findSmsRepeat([first], read('165번 문자찜 끝자리 1234'), T0 + 2000)).toBe(first)
    expect(findSmsRepeat([closeSmsCard(first)], read('165번 문자찜이요 끝자리는 1234'), T0 + 9999)?.id).toBe(first.id)
    const sent = sendSmsCard(first, { product: () => OPEN })
    expect(sent.ok && findSmsRepeat([sent.card], read('165번 문자찜 끝자리 1234'), T0 + 10_000)?.id).toBe(first.id)
  })

  it('경계: 10초 정각은 같은 말, 10초 1ms 뒤는 새 카드', () => {
    const first = card('165번 문자찜 끝자리 1234', T0)
    expect(findSmsRepeat([first], read('165번 문자찜 끝자리 1234'), T0 + 10_000)).not.toBeNull()
    expect(findSmsRepeat([first], read('165번 문자찜 끝자리 1234'), T0 + 10_001)).toBeNull()
  })

  it('구매자 말·주문이 다르면 새 카드', () => {
    const first = card('165번 문자찜 끝자리 1234', T0)
    expect(findSmsRepeat([first], read('165번 문자찜 끝자리 5678'), T0 + 1000)).toBeNull()
    expect(findSmsRepeat([first], read('165번 문자찜'), T0 + 1000)).toBeNull()
    expect(findSmsRepeat([first], read('166번 문자찜 끝자리 1234'), T0 + 1000)).toBeNull()
    expect(findSmsRepeat([first], read('165번 문자찜 끝자리 1234 김민지님'), T0 + 1000)).toBeNull()
    const two = card('15번 28번 문자찜', T0)
    expect(findSmsRepeat([two], read('28번 15번 문자찜'), T0 + 1000)).toBeNull()
    expect(findSmsRepeat([two], read('15번 28번 문자찜'), T0 + 1000)).toBe(two)
  })

  it('문제 카드끼리도 같은 규칙, 가장 최근 카드에 표시', () => {
    const a = card('15번 문자찜 끝자리 12', T0)
    const b = card('16번 문자찜 끝자리 99', T0 + 1000)
    expect(findSmsRepeat([a, b], read('17번 문자찜 끝자리 1'), T0 + 2000)?.id).toBe(b.id)
    expect(findSmsRepeat([a], read('15번 문자찜 25시'), T0 + 2000)).toBeNull()
    expect(markSmsRepeat(markSmsRepeat(a)).repeats).toBe(2)
  })

  it('상품 카드는 보지 않고, 10초가 지난 닫힌·넣은 문자찜 카드는 목록에서 뺄 수 있다', () => {
    const product = createCard({ id: 'p', extraction: { no: 165, name: null, price: 1000, confidence: 'LOW' }, text: '165번', createdAt: T0 })
    const closed = closeSmsCard(card('165번 문자찜', T0))
    const open = card('166번 문자찜', T0)
    const cards: VoiceCard[] = [product as VoiceCard, closed, open]
    expect(pruneSmsCards(cards, T0 + 10_000)).toHaveLength(3)
    expect(pruneSmsCards(cards, T0 + 10_001).map((item) => item.id)).toEqual(['p', open.id])
  })
})

// ── 열린 카드 수 (D-204·D-I4-02) ─────────────────────────────────────────

describe('AC-V1-03 열린 카드 수 규칙은 상품 카드와 문자찜 카드를 함께 센다', () => {
  const product = (id: string) => createCard({ id, extraction: { no: 1, name: null, price: 1000, confidence: 'LOW' }, text: '', createdAt: T0 }) as VoiceCard

  it('넷째 카드가 오면 손대지 않은 가장 오래된 카드(기다리는 문자찜 카드 포함)를 닫는다 — 닫힌 카드는 넣지 않는다', () => {
    let cards: VoiceCard[] = []
    const waiting = card('165번 문자찜')
    cards = addVoiceCard(cards, waiting)
    cards = addVoiceCard(cards, product('p1'))
    cards = addVoiceCard(cards, product('p2'))
    cards = addVoiceCard(cards, card('166번 문자찜'))
    expect(openVoiceCardCount(cards)).toBe(3)
    const closed = cards.find((item) => item.id === waiting.id) as SmsCard
    expect(closed.status).toBe('CLOSED')
    expect(checkSmsAuto(closed, ctx({ now: T0 + 60_000 })).due).toBe(false)
  })

  it('손댄 카드·고르기 카드는 닫지 않는다', () => {
    const choosing = chooseSmsBuyer(card('165번 문자찜 끝자리 1234'), [{ buyer: 'b', display: '문자찜', phoneLast4: '1234' }])
    let cards: VoiceCard[] = [choosing, touchCard(product('p0') as never) as VoiceCard]
    cards = addVoiceCard(cards, product('p1'))
    cards = addVoiceCard(cards, product('p2'))
    cards = addVoiceCard(cards, product('p3'))
    expect(cards.find((item) => item.id === choosing.id)?.status).toBe('OPEN')
    expect(cards.find((item) => item.id === 'p0')?.status).toBe('OPEN')
    // 열린 카드 = 새 p3 + 지킨 두 장 (p1·p2가 닫힘) — max(3, 지킨 카드 수 + 1)
    expect(openVoiceCardCount(cards)).toBe(3)
    expect(cards.filter((item) => item.status === 'CLOSED').map((item) => item.id).sort()).toEqual(['p1', 'p2'])
  })
})

// ── 속성 시험: 임의 조작 순서 ────────────────────────────────────────────

describe('AC-V1-03 속성 시험 — 임의 조작 순서', () => {
  const sentences = ['165번 문자찜', '165번 문자찜 끝자리 1234', '15번 28번 문자찜', '300번 문자찜', '15번 문자찜 끝자리 12', '김민지님 7번 문자찜', '7번 문자찜 2시']
  type Op =
    | { readonly op: 'say'; readonly text: string }
    | { readonly op: 'tick'; readonly ms: number }
    | { readonly op: 'skip'; readonly index: number }
    | { readonly op: 'sendNow'; readonly index: number }
    | { readonly op: 'touch'; readonly index: number }
    | { readonly op: 'choose'; readonly index: number }
    | { readonly op: 'dialog'; readonly value: boolean }
    | { readonly op: 'voice'; readonly value: boolean }
    | { readonly op: 'product'; readonly state: SmsProductView['state']; readonly full: boolean }
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.constantFrom(...sentences).map((text) => ({ op: 'say' as const, text })),
    fc.integer({ min: 0, max: 4000 }).map((ms) => ({ op: 'tick' as const, ms })),
    fc.record({ op: fc.constantFrom('skip' as const, 'sendNow' as const, 'touch' as const, 'choose' as const), index: fc.nat(5) }) as fc.Arbitrary<Op>,
    fc.record({ op: fc.constant('dialog' as const), value: fc.boolean() }),
    fc.record({ op: fc.constant('voice' as const), value: fc.boolean() }),
    fc.record({ op: fc.constant('product' as const), state: fc.constantFrom('OPEN' as const, 'SOLD' as const, 'CLOSED' as const, 'HOLD' as const), full: fc.boolean() }),
  )

  it('저절로 넣은 카드는 모든 조건을 만족하고, 어떤 카드도 두 번 넣지 않는다', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), fc.integer({ min: 0, max: 10 }), (ops, sec) => {
        let now = T0
        let cards: VoiceCard[] = []
        let dialogOpen = false
        let voiceOn = true
        let view: SmsProductView = OPEN
        const sentIds: string[] = []
        const sms = (): SmsCard[] => cards.filter((item): item is SmsCard => (item as SmsCard).kind === 'sms')
        const replace = (next: SmsCard): void => {
          cards = cards.map((item) => (item.id === next.id ? next : item))
        }
        const send = (target: SmsCard, buyer?: string): void => {
          const result = sendSmsCard(target, { product: () => view, ...(buyer === undefined ? {} : { buyer }) })
          if (!result.ok) return
          expect(sentIds).not.toContain(target.id)
          sentIds.push(target.id)
          replace(result.card)
        }
        let n = 0
        for (const step of ops) {
          if (step.op === 'say') {
            const reading = read(step.text)
            const repeat = findSmsRepeat(cards, reading, now)
            if (repeat !== null) replace(markSmsRepeat(repeat))
            else cards = addVoiceCard(cards, createSmsCard({ id: `c${String(n++)}`, reading, text: step.text, createdAt: now, settings: { 'voice.smsAutoSec': sec } }))
          } else if (step.op === 'tick') now += step.ms
          else if (step.op === 'dialog') dialogOpen = step.value
          else if (step.op === 'voice') voiceOn = step.value
          else if (step.op === 'product') view = { state: step.state, waitlistFull: step.full }
          else {
            const target = sms()[step.index]
            if (target === undefined) continue
            if (step.op === 'skip') replace(closeSmsCard(target))
            else if (step.op === 'touch') replace(touchSmsCard(target))
            else if (step.op === 'sendNow') send(target)
            else replace(chooseSmsBuyer(target, [{ buyer: 'b', display: '문자찜', phoneLast4: target.reading.last4 }]))
          }
          // 매 조작 뒤 저절로 넣기 검사
          for (const target of sms()) {
            const decision = checkSmsAuto(target, { now, voiceOn, dialogOpen, product: () => view, timeAfterNow: false })
            if (!decision.due) {
              replace(decision.card)
              continue
            }
            expect(target.status).toBe('OPEN')
            expect(target.touched).toBe(false)
            expect(target.candidates).toBeNull()
            expect(target.reading.problem).toBeNull()
            expect(target.reading.orders).toHaveLength(1)
            expect(smsProductBlock(view)).toBeNull()
            expect(voiceOn).toBe(true)
            expect(dialogOpen).toBe(false)
            expect(now).toBeGreaterThanOrEqual(target.createdAt + sec * 1000)
            send(target)
          }
        }
      }),
      { numRuns: 500 },
    )
  })
})
