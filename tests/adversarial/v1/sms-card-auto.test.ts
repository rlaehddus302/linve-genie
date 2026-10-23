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
  // D-V1-18(TE-V1-005)로 바뀐 기대: 아직 넣지 않았고 넣을 수 있는 문자찜 카드는 열린 카드 수 규칙으로 닫히지 않는다.
  // 닫히는 것은 손대지 않은 상품 카드·이유 카드(R-21 문제·reasons에 든 ID) 중 가장 오래된 것 — 그래서 3장을 넘을 수 있다.
  it('TD-V1-CARD D-V1-18: 넣을 수 있는 문자찜 카드는 넘쳐도 닫히지 않고, 3장을 넘으면 맨 앞 밖의 열린 카드는 모두 지킬 카드다', () => {
    const plain: SmsReading = { orders: [{ no: 1, qty: 1 }], last4: null, name: null, time: null, problem: null }
    const two: SmsReading = {
      orders: [
        { no: 1, qty: 1 },
        { no: 2, qty: 1 },
      ],
      last4: '1234',
      name: null,
      time: null,
      problem: null,
    }
    const problem: SmsReading = { orders: [], last4: null, name: null, time: null, problem: 'NUMBER_UNCLEAR' }
    type Kind = 'sms' | 'smsTwo' | 'smsTouched' | 'smsChoose' | 'smsProblem' | 'smsReason' | 'smsSent' | 'product' | 'productTouched'
    const kindArb = fc.constantFrom<Kind>('sms', 'smsTwo', 'smsTouched', 'smsChoose', 'smsProblem', 'smsReason', 'smsSent', 'product', 'productTouched')
    fc.assert(
      fc.property(fc.array(kindArb, { minLength: 1, maxLength: 12 }), (kinds) => {
        let cards: VoiceCard[] = []
        const reasons = new Set<string>()
        const isGuarded = (card: VoiceCard): boolean => {
          if (card.touched) return true
          if ((card as { kind?: string }).kind !== 'sms') return false
          const sms = card as SmsCard
          return sms.candidates !== null || (sms.status === 'OPEN' && sms.reading.problem === null && sms.reading.orders.length > 0 && !reasons.has(sms.id))
        }
        kinds.forEach((kind, i) => {
          const id = `c${String(i)}`
          let card: VoiceCard
          if (kind === 'product' || kind === 'productTouched') {
            card = { id, no: i + 1, name: null, price: 10000, confidence: 'HIGH', text: 't', createdAt: T0 + i, status: 'OPEN', touched: kind === 'productTouched', autoConfirmAt: null } as VoiceCard
          } else {
            let sms = createSmsCard({ id, reading: kind === 'smsProblem' ? problem : kind === 'smsTwo' ? two : plain, text: 't', createdAt: T0 + i })
            if (kind === 'smsTouched') sms = touchSmsCard(sms)
            if (kind === 'smsChoose') sms = chooseSmsBuyer(sms, [{ buyer: 'sms:a', display: 'a', phoneLast4: '1234' }])
            if (kind === 'smsReason') reasons.add(id)
            if (kind === 'smsSent') {
              const sent = sendSmsCard(sms, { product: () => ({ state: 'OPEN', waitlistFull: false }) })
              if (!sent.ok) throw new Error('보내기 실패')
              sms = sent.card
            }
            card = sms
          }
          const before = new Map(cards.map((item) => [item.id, item.status]))
          cards = addVoiceCard(cards, card, reasons)
          // 새 카드는 늘 맨 앞에 열린 그대로 (넣은 카드는 SENT 그대로)
          expect(cards[0]?.id).toBe(id)
          expect(cards[0]?.status).toBe(kind === 'smsSent' ? 'SENT' : 'OPEN')
          // 지킬 카드는 닫히지 않는다 (D-V1-18)
          for (const item of cards) if (before.get(item.id) === 'OPEN' && isGuarded(item)) expect(item.status, item.id).toBe('OPEN')
          // 넘치면 맨 앞 밖의 열린 카드는 모두 지킬 카드
          const open = cards.filter((item) => item.status === 'OPEN')
          if (openVoiceCardCount(cards) > 3) for (const item of open.slice(1)) if (item.id !== id) expect(isGuarded(item), item.id).toBe(true)
          // 이번에 닫힌 카드보다 오래된(뒤에 있는) 열린 카드는 지킬 카드뿐 — 가장 오래된 것부터 닫는다
          const closedNow = cards.findIndex((item) => before.get(item.id) === 'OPEN' && item.status === 'CLOSED')
          if (closedNow >= 0) for (const item of cards.slice(closedNow + 1)) if (item.status === 'OPEN') expect(isGuarded(item), item.id).toBe(true)
        })
      }),
      { numRuns: 800 },
    )
  })

  it('TD-V1-CARD D-V1-18 예: 기다리는 문자찜 카드 넷 → 넷 다 열림, 이유 카드·손대지 않은 상품 카드가 먼저 닫힌다', () => {
    const at = (no: number, last4: string, i: number) =>
      createSmsCard({ id: `s${String(no)}`, reading: { orders: [{ no, qty: 1 }], last4, name: null, time: null, problem: null }, text: 't', createdAt: T0 + i * 1000 })
    let cards: VoiceCard[] = []
    cards = addVoiceCard(cards, at(165, '1111', 0))
    cards = addVoiceCard(cards, at(166, '2222', 1))
    cards = addVoiceCard(cards, at(167, '3333', 2))
    cards = addVoiceCard(cards, at(168, '4444', 3))
    expect(cards.map((card) => card.status)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OPEN'])
    expect(openVoiceCardCount(cards)).toBe(4)
    // 이유 카드(넣을 수 없는 상품 — reasons) 하나와 손대지 않은 상품 카드 하나를 끼우면 그쪽이 닫힌다
    const reasons = new Set(['r300'])
    const reason = createSmsCard({ id: 'r300', reading: { orders: [{ no: 300, qty: 1 }], last4: '5555', name: null, time: null, problem: null }, text: 't', createdAt: T0 + 4000 })
    const product = { id: 'p', no: 20, name: null, price: 10000, confidence: 'HIGH', text: 't', createdAt: T0 + 5000, status: 'OPEN', touched: false, autoConfirmAt: null } as VoiceCard
    let mixed: VoiceCard[] = addVoiceCard([], reason, reasons)
    mixed = addVoiceCard(mixed, product, reasons)
    for (const [i, no] of [165, 166, 167].entries()) mixed = addVoiceCard(mixed, at(no, String(1111 * (i + 1)), 6 + i), reasons)
    const status = new Map(mixed.map((card) => [card.id, card.status]))
    expect(status.get('r300')).toBe('CLOSED')
    expect(status.get('p')).toBe('CLOSED')
    expect([status.get('s165'), status.get('s166'), status.get('s167')]).toEqual(['OPEN', 'OPEN', 'OPEN'])
  })

  // D-V1-17(TD-V1-003)로 바뀐 기대: 넣지 않고 닫은 카드(CLOSED)는 같은 말 검사에서 보지 않는다 — 옛 기대 'b'(닫은 카드도 같은 말)를 null로
  it('10초 정각은 같은 말, 10,001ms는 새 카드 — 넣은 카드는 보고 넣지 않고 닫은 카드는 안 본다(D-V1-17), 끝자리가 다르면 새 카드', () => {
    const reading: SmsReading = { orders: [{ no: 165, qty: 1 }], last4: '1234', name: null, time: null, problem: null }
    const sent = sendSmsCard(createSmsCard({ id: 'a', reading, text: 't', createdAt: T0 }), { product: () => ({ state: 'OPEN', waitlistFull: false }) })
    expect(sent.ok).toBe(true)
    const closed = closeSmsCard(createSmsCard({ id: 'b', reading: { ...reading, last4: '5678' }, text: 't', createdAt: T0 }))
    const cards: VoiceCard[] = [sent.card, closed]
    expect(findSmsRepeat(cards, reading, T0 + 10_000)?.id).toBe('a')
    expect(findSmsRepeat(cards, reading, T0 + 10_001)).toBeNull()
    expect(findSmsRepeat(cards, { ...reading, last4: '5678' }, T0 + 9_999)).toBeNull()
    expect(findSmsRepeat(cards, { ...reading, last4: '9999' }, T0 + 1)).toBeNull()
    // 이름 있음 ↔ 없음은 다른 구매자 말
    expect(findSmsRepeat(cards, { ...reading, name: '김민지' }, T0 + 1)).toBeNull()
    // 다른 번호는 새 카드
    expect(findSmsRepeat(cards, { ...reading, orders: [{ no: 166, qty: 1 }] }, T0 + 1)).toBeNull()
    // 시계가 뒤로 가면(만든 시각보다 앞) 같은 말로 보지 않는다 — 새 카드를 만들어도 엔진이 같은 끝자리 구매자로 막는다
    expect(findSmsRepeat(cards, reading, T0 - 1)).toBeNull()
  })

  it('TD-V1-CARD D-V1-17: 같은 말 검사는 넣은 카드·열려 있고 넣을 수 있는 카드만 — 이유 카드·닫은 카드·문제 카드는 안 본다', () => {
    const reading: SmsReading = { orders: [{ no: 165, qty: 1 }], last4: '1234', name: null, time: null, problem: null }
    const open = () => ({ state: 'OPEN' as const, waitlistFull: false })
    const waiting = createSmsCard({ id: 'w', reading, text: 't', createdAt: T0 })
    // 기다리는 카드·넣기 누르기(번호 둘)·고르기·손댄 카드는 같은 말
    expect(findSmsRepeat([waiting], reading, T0 + 2000)?.id).toBe('w')
    const twoReading: SmsReading = {
      ...reading,
      orders: [
        { no: 15, qty: 1 },
        { no: 28, qty: 1 },
      ],
    }
    expect(findSmsRepeat([createSmsCard({ id: 't2', reading: twoReading, text: 't', createdAt: T0 })], twoReading, T0 + 2000)?.id).toBe('t2')
    const choose = chooseSmsBuyer(waiting, [{ buyer: 'sms:a', display: 'a', phoneLast4: '1234' }])
    expect(findSmsRepeat([choose], reading, T0 + 2000)?.id).toBe('w')
    expect(findSmsRepeat([touchSmsCard(waiting)], reading, T0 + 2000)?.id).toBe('w')
    // 넣은 카드는 화면에서 닫았어도(SENT 그대로) 같은 말
    const sent = sendSmsCard(waiting, { product: open })
    if (!sent.ok) throw new Error('보내기 실패')
    expect(findSmsRepeat([sent.card], reading, T0 + 10_000)?.id).toBe('w')
    // "넣지 않기"·Esc로 닫은 카드 → 새 카드
    expect(findSmsRepeat([closeSmsCard(waiting)], reading, T0 + 2000)).toBeNull()
    // 이유 카드(부르는 쪽 reasons — 넣을 수 없는 상품·409 VOICE_REPEATED) → 열려 있어도 새 카드
    expect(findSmsRepeat([waiting], reading, T0 + 2000, new Set(['w']))).toBeNull()
    // R-21 문제 카드끼리도 같은 말로 합치지 않는다 (AC-V1-04 예 — 앞 카드의 이유로 합치지 않음)
    const problem: SmsReading = { orders: [], last4: null, name: null, time: null, problem: 'LAST4_UNCLEAR' }
    const problemCard = createSmsCard({ id: 'p', reading: problem, text: 't', createdAt: T0 })
    expect(findSmsRepeat([problemCard], problem, T0 + 1000)).toBeNull()
    // 여럿이면 가장 새 카드 (닫은 새 카드는 건너뛰고 넣은 옛 카드)
    const newerClosed = closeSmsCard(createSmsCard({ id: 'n', reading, text: 't', createdAt: T0 + 3000 }))
    expect(findSmsRepeat([newerClosed, sent.card], reading, T0 + 5000)?.id).toBe('w')
  })
})
