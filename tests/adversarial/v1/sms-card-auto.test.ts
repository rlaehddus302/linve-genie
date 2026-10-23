// V1 적대 시험 (test-domain, AC-V1-03·04): 문자찜 카드 상태(packages/voice)의 저절로 넣기 조건·같은 말 막기를 임의 조작 순서로 공격한다.
// 속성: checkSmsAuto가 due를 내면 그때 조건(열림·주문 하나·문제 없음·손대지 않음·고르기 아님·받을 수 있는 상품·시각 늦지 않음·창 없음·음성 켜짐·기다림 지남)을 모두 만족하고,
// 같은 카드는 두 번 넣지 않으며, 한 번 손대거나(넣지 않기·지금 넣기 밖) 음성을 끄거나 시각 확인·고르기가 된 카드는 다시 저절로 넣지 않는다.
import {
  addVoiceCard,
  checkSmsAuto,
  chooseSmsBuyer,
  closeSmsCard,
  createSmsCard,
  findSmsRepeat,
  openVoiceCardCount,
  reopenSmsCard,
  resolveSmsSettings,
  sendSmsCard,
  stopSmsAuto,
  touchSmsCard,
  type SmsCard,
  type SmsProductView,
  type SmsReading,
  type VoiceCard,
} from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const T0 = Date.UTC(2026, 9, 23, 11, 0, 0)

const readingArb: fc.Arbitrary<SmsReading> = fc.oneof(
  fc.record({
    orders: fc.uniqueArray(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 3 }).map((nos) => nos.map((no) => ({ no, qty: 1 }))),
    last4: fc.constantFrom(null, '1234', '5678'),
    name: fc.constantFrom(null, '김민지'),
    time: fc.constantFrom(null, '2:15'),
    problem: fc.constant(null),
  }),
  fc.constantFrom('CANCEL', 'LAST4_UNCLEAR', 'NAME_UNCLEAR', 'TIME_UNCLEAR', 'NUMBER_UNCLEAR', 'OPTION_UNCLEAR').map(
    (problem): SmsReading => ({ orders: [], last4: null, name: null, time: null, problem: problem as SmsReading['problem'] }),
  ),
)

const viewArb: fc.Arbitrary<SmsProductView | null> = fc.oneof(
  fc.constant(null),
  fc.record({ state: fc.constantFrom('READY', 'OPEN', 'HOLD', 'SOLD', 'CLOSED') as fc.Arbitrary<SmsProductView['state']>, waitlistFull: fc.boolean() }),
)

type Op =
  | { kind: 'check'; dt: number; voiceOn: boolean; dialogOpen: boolean; timeAfterNow: boolean; view: SmsProductView | null }
  | { kind: 'touch' }
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'stop' }
  | { kind: 'choose' }
  | { kind: 'send'; view: SmsProductView | null }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('check' as const), dt: fc.integer({ min: 0, max: 4000 }), voiceOn: fc.boolean(), dialogOpen: fc.boolean(), timeAfterNow: fc.boolean(), view: viewArb }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'touch' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'close' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'reopen' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'stop' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'choose' as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('send' as const), view: viewArb }) },
)

const receivable = (view: SmsProductView | null): boolean => view !== null && (view.state === 'OPEN' || (view.state === 'SOLD' && !view.waitlistFull))

describe('TD-V1-CARD 속성: 저절로 넣는 카드는 조건을 모두 만족하고 두 번 넣지 않는다 (AC-V1-03)', () => {
  it('임의 조작 순서', () => {
    fc.assert(
      fc.property(readingArb, fc.oneof(fc.integer({ min: 0, max: 10 }), fc.constantFrom(-1, 11, 2.5, '3', null)), fc.array(opArb, { maxLength: 25 }), (reading, sec, ops) => {
        let card = createSmsCard({ id: 'c1', reading, text: 't', createdAt: T0, settings: { 'voice.smsAutoSec': sec } })
        const wait = resolveSmsSettings({ 'voice.smsAutoSec': sec })['voice.smsAutoSec']
        // 기다림: 범위 밖·정수 아님은 기본 3초
        expect(wait).toBe(typeof sec === 'number' && Number.isInteger(sec) && sec >= 0 && sec <= 10 ? sec : 3)
        const autoReading = reading.problem === null && reading.orders.length === 1
        expect(card.autoAt).toBe(autoReading ? T0 + wait * 1000 : null)
        let now = T0
        let sends = 0
        /** 한 번이라도 저절로 넣기를 끊는 일이 있었다 */
        let stopped = false
        for (const op of ops) {
          switch (op.kind) {
            case 'check': {
              now += op.dt
              const before = card
              const decision = checkSmsAuto(card, { now, voiceOn: op.voiceOn, dialogOpen: op.dialogOpen, product: () => op.view, timeAfterNow: op.timeAfterNow })
              if (decision.due) {
                expect(before.status).toBe('OPEN')
                expect(autoReading).toBe(true)
                expect(before.touched).toBe(false)
                expect(before.candidates).toBeNull()
                expect(stopped).toBe(false)
                expect(op.voiceOn && !op.dialogOpen && !op.timeAfterNow && receivable(op.view)).toBe(true)
                expect(now).toBeGreaterThanOrEqual(T0 + wait * 1000)
                const sent = sendSmsCard(decision.card, { product: () => op.view })
                expect(sent.ok).toBe(true)
                if (sent.ok) {
                  sends++
                  expect(sent.writes).toHaveLength(1)
                  card = sent.card
                }
              } else {
                card = decision.card
                if (before.status === 'OPEN' && before.autoAt !== null && (!op.voiceOn || op.timeAfterNow)) stopped = true
              }
              break
            }
            case 'touch':
              card = touchSmsCard(card)
              stopped = true
              break
            case 'close':
              card = closeSmsCard(card)
              break
            case 'reopen':
              card = reopenSmsCard(card)
              stopped = true
              break
            case 'stop':
              card = stopSmsAuto(card)
              stopped = true
              break
            case 'choose':
              card = chooseSmsBuyer(card, [{ buyer: 'sms:a', display: '문자찜', phoneLast4: '1234' }, { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234' }])
              stopped = true
              break
            case 'send': {
              const result = sendSmsCard(card, { product: () => op.view })
              if (result.ok) {
                // 누르기로도 문제 카드·넣을 수 없는 상품·고르기 카드는 넣지 않는다
                expect(card.status).toBe('OPEN')
                expect(card.reading.problem).toBeNull()
                expect(card.candidates).toBeNull()
                expect(receivable(op.view)).toBe(true)
                for (const write of result.writes) expect('last4' in write && 'buyer' in write).toBe(false)
                sends++
                stopped = true
              }
              card = result.card
              break
            }
          }
          // 닫힌 카드는 다시 열리지 않는다
          if (card.status === 'CLOSED') {
            expect(checkSmsAuto(card, { now: now + 60_000, voiceOn: true, dialogOpen: false, product: () => ({ state: 'OPEN', waitlistFull: false }), timeAfterNow: false }).due).toBe(false)
            expect(sendSmsCard(card, { product: () => ({ state: 'OPEN', waitlistFull: false }) }).ok).toBe(false)
          }
        }
        // 넣기는 (저절로든 누르기든) 카드 하나에 한 번 — 넣은 카드는 다시 열려야만(보내기 실패·고르기) 또 넣는다
        expect(sends).toBeLessThanOrEqual(1 + ops.filter((op) => op.kind === 'reopen' || op.kind === 'choose').length)
      }),
      { numRuns: 1500 },
    )
  })

  it('저절로 넣은 뒤 같은 카드는 다시 due가 되지 않는다 (아무 문맥에서도)', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ dt: fc.integer({ min: 0, max: 20_000 }), voiceOn: fc.boolean(), dialogOpen: fc.boolean(), timeAfterNow: fc.boolean(), view: viewArb }), { maxLength: 20 }), (checks) => {
        let card = createSmsCard({ id: 'c', reading: { orders: [{ no: 1, qty: 1 }], last4: '1234', name: null, time: null, problem: null }, text: 't', createdAt: T0 })
        let now = T0
        let dues = 0
        for (const check of checks) {
          now += check.dt
          const decision = checkSmsAuto(card, { now, voiceOn: check.voiceOn, dialogOpen: check.dialogOpen, product: () => check.view, timeAfterNow: check.timeAfterNow })
          if (decision.due) {
            dues++
            const sent = sendSmsCard(decision.card, { product: () => check.view })
            expect(sent.ok).toBe(true)
            card = sent.card
          } else card = decision.card
        }
        expect(dues).toBeLessThanOrEqual(1)
      }),
      { numRuns: 1000 },
    )
  })

  it('경계: 기다림이 끝나기 1ms 전은 아님, 정각은 넣기 (0초면 만든 순간)', () => {
    const reading: SmsReading = { orders: [{ no: 1, qty: 1 }], last4: null, name: null, time: null, problem: null }
    const open = () => ({ state: 'OPEN' as const, waitlistFull: false })
    for (const sec of [0, 3, 10]) {
      const card = createSmsCard({ id: 'c', reading, text: 't', createdAt: T0, settings: { 'voice.smsAutoSec': sec } })
      const ctx = (now: number) => ({ now, voiceOn: true, dialogOpen: false, product: open, timeAfterNow: false })
      if (sec > 0) expect(checkSmsAuto(card, ctx(T0 + sec * 1000 - 1)).due).toBe(false)
      expect(checkSmsAuto(card, ctx(T0 + sec * 1000)).due).toBe(true)
    }
  })

  it('1등이 찼고 대기 자리가 있으면 넣고, 대기까지 차면·판매 전·보류·종료·없는 번호는 넣지 않는다 (D-V1-07)', () => {
    const reading: SmsReading = { orders: [{ no: 1, qty: 1 }], last4: null, name: null, time: null, problem: null }
    const card = createSmsCard({ id: 'c', reading, text: 't', createdAt: T0, settings: { 'voice.smsAutoSec': 0 } })
    const run = (view: SmsProductView | null) => checkSmsAuto(card, { now: T0, voiceOn: true, dialogOpen: false, product: () => view, timeAfterNow: false })
    expect(run({ state: 'SOLD', waitlistFull: false }).due).toBe(true)
    for (const view of [null, { state: 'SOLD', waitlistFull: true }, { state: 'READY', waitlistFull: false }, { state: 'HOLD', waitlistFull: false }, { state: 'CLOSED', waitlistFull: false }] as const) {
      const decision = run(view)
      expect(decision.due).toBe(false)
      expect(decision.due === false && decision.block !== null).toBe(true)
    }
    // 상품 조회가 던져도 넣지 않는다 (없는 번호로)
    const throwing = checkSmsAuto(card, {
      now: T0,
      voiceOn: true,
      dialogOpen: false,
      product: () => {
        throw new Error('x')
      },
      timeAfterNow: false,
    })
    expect(throwing.due).toBe(false)
  })
})

describe('TD-V1-CARD 열린 카드 수·같은 말 (D-204·D-I4-02, AC-V1-04)', () => {
  it('열린 카드는 3장을 넘지 않는다 — 손댄 카드·고르기 카드는 닫히지 않는다 (지킬 카드만 남으면 넘을 수 있다)', () => {
    const reading: SmsReading = { orders: [{ no: 1, qty: 1 }], last4: null, name: null, time: null, problem: null }
    fc.assert(
      fc.property(fc.array(fc.constantFrom('plain', 'touched', 'choose'), { minLength: 1, maxLength: 10 }), (kinds) => {
        let cards: VoiceCard[] = []
        kinds.forEach((kind, i) => {
          let card: SmsCard = createSmsCard({ id: `c${String(i)}`, reading, text: 't', createdAt: T0 + i })
          if (kind === 'touched') card = touchSmsCard(card)
          if (kind === 'choose') card = chooseSmsBuyer(card, [{ buyer: 'sms:a', display: 'a', phoneLast4: '1234' }])
          cards = addVoiceCard(cards, card)
          const open = cards.filter((item) => item.status === 'OPEN')
          const guarded = open.filter((item) => item.touched || (item as SmsCard).candidates !== null)
          // 새 카드는 늘 열려 있다
          expect(cards[0]?.status).toBe('OPEN')
          expect(openVoiceCardCount(cards)).toBeLessThanOrEqual(Math.max(3, guarded.length + 1))
          // 지킬 카드는 닫히지 않는다
          for (const item of cards) if (item.touched || (item as SmsCard).candidates !== null) expect(item.status).toBe('OPEN')
        })
      }),
      { numRuns: 500 },
    )
  })

  it('10초 정각은 같은 말, 10,001ms는 새 카드 — 넣었거나 닫은 카드도, 끝자리가 다르면 새 카드', () => {
    const reading: SmsReading = { orders: [{ no: 165, qty: 1 }], last4: '1234', name: null, time: null, problem: null }
    const sent = sendSmsCard(createSmsCard({ id: 'a', reading, text: 't', createdAt: T0 }), { product: () => ({ state: 'OPEN', waitlistFull: false }) })
    expect(sent.ok).toBe(true)
    const closed = closeSmsCard(createSmsCard({ id: 'b', reading: { ...reading, last4: '5678' }, text: 't', createdAt: T0 }))
    const cards: VoiceCard[] = [sent.card, closed]
    expect(findSmsRepeat(cards, reading, T0 + 10_000)?.id).toBe('a')
    expect(findSmsRepeat(cards, reading, T0 + 10_001)).toBeNull()
    expect(findSmsRepeat(cards, { ...reading, last4: '5678' }, T0 + 9_999)?.id).toBe('b')
    expect(findSmsRepeat(cards, { ...reading, last4: '9999' }, T0 + 1)).toBeNull()
    // 이름 있음 ↔ 없음은 다른 구매자 말
    expect(findSmsRepeat(cards, { ...reading, name: '김민지' }, T0 + 1)).toBeNull()
    // 다른 번호는 새 카드
    expect(findSmsRepeat(cards, { ...reading, orders: [{ no: 166, qty: 1 }] }, T0 + 1)).toBeNull()
    // 시계가 뒤로 가면(만든 시각보다 앞) 같은 말로 보지 않는다 — 새 카드를 만들어도 엔진이 같은 끝자리 구매자로 막는다
    expect(findSmsRepeat(cards, reading, T0 - 1)).toBeNull()
  })
})
