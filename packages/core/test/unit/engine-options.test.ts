// O1 옵션 방송 엔진 단위 시험 (AC-O1-01·02·04~07·09·13·14·22·26·27·28·30 — 골든이 고정하지 않은 경계)
import {
  StateFormatError,
  applyEvent,
  checkEvent,
  checkInvariants,
  checkSettings,
  formatThanksText,
  getBroadcast,
  getProduct,
  initEngine,
  isInvalidEvent,
  listCancelRequests,
  listClaims,
  listEffects,
  listReviews,
  activeClaimId,
  resolveSettings,
  upgradeState,
  type ClaimRecord,
  type EngineEvent,
  type EngineState,
  type OptionItem,
  type ReviewRecord,
  type SlotRecord,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { pget, pset } from '../../src/engine/pmap.ts'
import { B1, T0, chat, play, type EventInput } from './engine-helpers.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS' } as const
const SIZE: readonly OptionItem[] = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }]
const COLOR_SIZE: readonly OptionItem[] = [
  { name: '색상', choices: [{ label: '흰색' }, { label: '검정색', price: 1000 }] },
  { name: '크기', choices: [{ label: '소형' }, { label: '대형', price: 2000 }] },
]

const shorts = (fields: Record<string, unknown> = {}): EventInput => ({ type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE, ...fields }) as EventInput

/** b1 = STRICT, b2 = OPTIONS 인 엔진 (AC-O1-02) */
function mixed(): EngineState {
  let state = initEngine({ broadcasts: [B1], settings: {} })
  state = applyEvent(state, { seq: 1, at: T0, type: 'broadcast.start', b: 'b2', date: '2026-10-18', title: '옵션', settings: OPTIONS }).state
  state = applyEvent(state, { seq: 2, at: T0, type: 'product.register', b: 'b1', no: 21, name: '다육', price: 10000 }).state
  state = applyEvent(state, { seq: 3, at: T0, type: 'product.register', b: 'b2', no: 21, name: '반바지', price: 10000, options: SIZE }).state
  state = applyEvent(state, { seq: 4, at: T0, type: 'chat', b: 'b2', id: 'm1', ch: 'UC_A', nick: 'A', text: '반바지 예뻐요' }).state
  return state
}

const ev = (fields: Record<string, unknown>): EngineEvent => ({ seq: 99, at: T0 + 99_000, ...fields }) as unknown as EngineEvent

/** checkEvent 문제 필드 (휴대폰 번호 문제는 code) */
const problemsOf = (state: EngineState, fields: Record<string, unknown>): string[] => checkEvent(state, ev(fields)).map((p) => `${p.field ?? '-'}${p.code === undefined ? '' : `:${p.code}`}`)

const claimsOf = (state: EngineState) => listClaims(state).map((c) => ({ key: c.key, buyer: c.buyer, status: c.status, reason: c.reason, qty: c.qty }))

describe('AC-O1-01 설정 값과 범위', () => {
  it('OPTIONS·maxQuantity 1~99는 받고, 0·100·소수·문자열은 문제, OPTIONS + RECEIVED_TIME은 문제', () => {
    expect(resolveSettings({})['claim.parseMode']).toBe('STRICT')
    expect(resolveSettings({})['claim.maxQuantity']).toBe(10)
    for (const ok of [1, 10, 99]) expect(checkSettings({ 'claim.maxQuantity': ok })).toEqual([])
    for (const bad of [0, 100, 1.5, '10']) expect(checkSettings({ 'claim.maxQuantity': bad }).map((p) => p.key)).toEqual(['claim.maxQuantity'])
    for (const mode of ['STRICT', 'LOOSE', 'OPTIONS']) expect(checkSettings({ 'claim.parseMode': mode })).toEqual([])
    expect(checkSettings({ 'claim.parseMode': 'OPTIONS', 'contention.policy': 'RECEIVED_TIME' }).map((p) => p.key)).toEqual(['contention.policy'])
    expect(checkSettings({ 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' })).toEqual([])
    expect(checkSettings({ 'contention.policy': 'RECEIVED_TIME' })).toEqual([])
    expect(() => initEngine({ broadcasts: [B1], settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'RECEIVED_TIME' } })).toThrow(TypeError)
  })
})

describe('AC-O1-02 옵션 방송만의 입력은 다른 방송에서 입력 오류', () => {
  const state = mixed()
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['상품 옵션', { type: 'product.register', no: 30, name: 'x', price: 1, options: SIZE }, {}],
    ['상품 별칭', { type: 'product.register', no: 30, name: 'x', price: 1, aliases: ['엑스'] }, {}],
    ['변형 재고', { type: 'product.update', no: 21, stocks: { M: 2 } }, {}],
    ['수정의 옵션', { type: 'product.update', no: 21, options: SIZE }, {}],
    ['문자찜 수량', { type: 'sms', ref: 's9', no: 21, received: '20:00', qty: 1 }, { options: { 사이즈: 'M' } }],
    ['문자찜 옵션', { type: 'sms', ref: 's9', no: 21, received: '20:00', options: { 사이즈: 'M' } }, {}],
    ['배정 수량', { type: 'host.assign', no: 21, buyer: 'UC_A', reason: 'r', qty: 1 }, { options: { 사이즈: 'M' } }],
    ['조치 옵션', { type: 'host.cancel', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } }, {}],
    ['지금 상품', { type: 'product.focus', no: 21 }, {}],
    ['바로잡기', { type: 'host.resolveReview', item: 'm1', no: 21, qty: 1, options: { 사이즈: 'M' } }, {}],
    ['지우기', { type: 'host.dismissReview', item: 'm1' }, {}],
  ]
  it.each(cases)('%s — STRICT 방송 b1은 입력 오류·상태 그대로, 옵션 방송 b2는 받는다', (_name, fields, extraForB2) => {
    const inB1 = ev({ ...fields, b: 'b1' })
    expect(checkEvent(state, inB1).length).toBeGreaterThan(0)
    let thrown: unknown
    try {
      applyEvent(state, inB1)
    } catch (error) {
      thrown = error
    }
    expect(isInvalidEvent(thrown)).toBe(true)
    expect(checkEvent(state, ev({ ...fields, ...extraForB2, b: 'b2' }))).toEqual([])
  })
})

describe('AC-O1-04·05·06 옵션·별칭·재고의 모양 검사', () => {
  const state = initEngine({ broadcasts: [B1], settings: OPTIONS })
  const reg = (fields: Record<string, unknown>): string[] => problemsOf(state, { type: 'product.register', b: 'b1', no: 1, name: '상품', price: 10000, ...fields })
  const choices = (n: number, prefix = 'c') => Array.from({ length: n }, (_, i) => ({ label: `${prefix}${String(i)}` }))
  const item = (name: string, n = 2, prefix = name) => ({ name, choices: choices(n, prefix) })
  const words = (n: number, length = 1, prefix = 'a') => Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`.padEnd(length, 'x'))

  it('경계값은 받는다', () => {
    expect(reg({ options: [item('a'), item('b'), item('c')] })).toEqual([])
    expect(reg({ options: [{ name: '열글자열글자열글자열', choices: choices(20) }] })).toEqual([])
    expect(reg({ options: [{ name: '라벨', choices: [{ label: 'x'.repeat(20), aliases: words(10, 20) }] }] })).toEqual([])
    expect(reg({ options: [{ name: '가격', choices: [{ label: '싼', price: -1000 }, { label: '비싼', price: 1_000_000 }] }], price: 1000 })).toEqual([])
    expect(reg({ options: [item('a', 10), item('b', 10)] })).toEqual([])
    expect(reg({ aliases: words(10, 20) })).toEqual([])
    expect(reg({ aliases: ['초코'], options: [{ name: '맛', choices: [{ label: '초코' }, { label: '딸기' }] }] })).toEqual([])
  })

  it('밖은 모두 입력 오류', () => {
    expect(reg({ options: [item('a'), item('b'), item('c'), item('d')] })).toEqual(['options'])
    expect(reg({ options: [{ name: '열한글자열한글자열한글', choices: choices(1) }] })).toEqual(['options[0].name'])
    expect(reg({ options: [{ name: ' ', choices: choices(1) }] })).toEqual(['options[0].name'])
    expect(reg({ options: [{ name: '', choices: choices(1) }] })).toEqual(['options[0].name'])
    expect(reg({ options: [item('같은'), item('같은', 2, 'z')] })).toEqual(['options[1].name'])
    expect(reg({ options: [{ name: 'a', choices: [] }] })).toEqual(['options[0].choices'])
    expect(reg({ options: [{ name: 'a', choices: choices(21) }] })).toEqual(['options[0].choices'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'x'.repeat(21) }] }] })).toEqual(['options[0].choices[0].label'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: '흰/검' }, { label: 'b#2' }, { label: 'c\u0007' }] }] })).toEqual([
      'options[0].choices[0].label',
      'options[0].choices[1].label',
      'options[0].choices[2].label',
    ])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'x', aliases: words(11) }] }] })).toEqual(['options[0].choices[0].aliases'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'x', aliases: ['y'.repeat(21)] }] }] })).toEqual(['options[0].choices[0].aliases[0]'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'x', price: 1_000_001 }, { label: 'y', price: -1_000_001 }, { label: 'z', price: 1.5 }] }] })).toEqual([
      'options[0].choices[0].price',
      'options[0].choices[1].price',
      'options[0].choices[2].price',
    ])
    expect(reg({ options: [item('a', 11), item('b', 10)] })).toEqual(['options'])
    expect(reg({ aliases: words(11) })).toEqual(['aliases'])
    expect(reg({ aliases: ['y'.repeat(21)] })).toEqual(['aliases[0]'])
    // 모양이 아닌 값
    expect(reg({ options: 'S/M' })).toEqual(['options'])
    expect(reg({ options: ['S'] })).toEqual(['options[0]'])
    expect(reg({ options: [{ name: 'a', choices: ['S'], extra: 1 }] })).toEqual(['options[0].extra', 'options[0].choices[0]'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'S', color: 'red' }] }] })).toEqual(['options[0].choices[0].color'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'S', aliases: 'small' }] }] })).toEqual(['options[0].choices[0].aliases'])
    expect(reg({ options: [{ name: 7, choices: choices(1) }] })).toEqual(['options[0].name'])
  })

  it('비교 글자 겹침 (AC-O1-05): 17 Pro = 17pro, 다른 항목 사이 M·m, label과 다른 선택지의 별칭', () => {
    expect(reg({ options: [{ name: '기종', choices: [{ label: '17 Pro' }, { label: '17pro' }] }] })).toEqual(['options[0].choices[1].label'])
    expect(reg({ options: [{ name: '색상', choices: [{ label: 'M' }, { label: 'K' }] }, { name: '사이즈', choices: [{ label: 'm' }] }] })).toEqual(['options[1].choices[0].label'])
    expect(reg({ options: [{ name: '사이즈', choices: [{ label: '엠' }, { label: 'M', aliases: ['엠'] }] }] })).toEqual(['options[0].choices[1].aliases[0]'])
  })

  it('휴대폰 번호 (AC-O1-05): 상품 이름·별칭·항목 이름·label·선택지 별칭 — checkEvent만 PHONE_NUMBER, 재생은 처리', () => {
    const phone = '010-1234-5678'
    expect(reg({ name: phone })).toEqual(['name:PHONE_NUMBER'])
    expect(reg({ aliases: [phone] })).toEqual(['aliases[0]:PHONE_NUMBER'])
    expect(reg({ options: [{ name: '0101234', choices: [{ label: '5678' }] }] })).toEqual([])
    expect(reg({ options: [{ name: '0101234567', choices: [{ label: 'S' }] }] })).toEqual(['options[0].name:PHONE_NUMBER'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: phone }] }] })).toEqual(['options[0].choices[0].label:PHONE_NUMBER'])
    expect(reg({ options: [{ name: 'a', choices: [{ label: 'S', aliases: ['01012345678'] }] }] })).toEqual(['options[0].choices[0].aliases[0]:PHONE_NUMBER'])
    const replay = applyEvent(state, ev({ type: 'product.register', b: 'b1', no: 1, name: '상품', price: 1, aliases: [phone] }))
    expect(getProduct(replay.state, 'b1', 1)?.aliases).toEqual([phone])
  })

  it('변형 단가·재고 (AC-O1-06)', () => {
    expect(reg({ price: 1000, options: [{ name: 'a', choices: [{ label: 'x', price: -2000 }] }] })).toEqual(['options'])
    expect(reg({ stock: 0, options: SIZE })).toEqual(['stock'])
    expect(reg({ stocks: { XL: 1 }, options: SIZE })).toEqual(['stocks.XL'])
    expect(reg({ stocks: { M: 1 } })).toEqual(['stocks'])
    expect(reg({ stocks: { M: -1, S: 1.5 }, options: SIZE })).toEqual(['stocks.M', 'stocks.S'])
    expect(reg({ stocks: [1], options: SIZE })).toEqual(['stocks'])
    expect(reg({ stocks: { M: 0 }, options: SIZE })).toEqual([])
    expect(reg({ stocks: { '흰색/대형': 3 }, options: COLOR_SIZE })).toEqual([])
    expect(reg({ stocks: { 대형: 3 }, options: COLOR_SIZE })).toEqual(['stocks.대형'])
  })

  it('수정의 검사: 바꾼 뒤의 변형, 지금 옵션, 단가 0 이상, 없는 상품은 키를 보지 않는다', () => {
    const { state: with21 } = play([shorts({ price: 1000, options: [{ name: '사이즈', choices: [{ label: 'S', price: -500 }, { label: 'M' }] }] })], OPTIONS)
    const upd = (fields: Record<string, unknown>) => problemsOf(with21, { type: 'product.update', b: 'b1', no: 21, ...fields })
    expect(upd({ stocks: { S: 2 } })).toEqual([])
    expect(upd({ stocks: { L: 2 } })).toEqual(['stocks.L'])
    expect(upd({ stocks: { L: 2 }, options: SIZE })).toEqual([])
    expect(upd({ price: 400 })).toEqual(['price'])
    expect(upd({ options: [{ name: '사이즈', choices: [{ label: 'S', price: -1500 }] }] })).toEqual(['options'])
    expect(upd({ aliases: ['바지'] })).toEqual([])
    expect(problemsOf(with21, { type: 'product.update', b: 'b1', no: 99, stocks: { Z: 1 } })).toEqual([])
  })
})

describe('AC-O1-14 문자찜·직접 배정의 옵션·수량 입력 검사', () => {
  const { state } = play([shorts(), { type: 'product.register', b: 'b1', no: 11, name: '과자', price: 2000, stock: 5 } as EventInput, chat('UC_A', '안녕')], OPTIONS)
  it('상품이 있으면 모든 항목, 옵션 없는 상품·없는 상품에는 옵션 없음, 수량 1~maxQuantity', () => {
    const smsEv = (fields: Record<string, unknown>) => problemsOf(state, { type: 'sms', b: 'b1', ref: 's1', received: '20:00', ...fields })
    expect(smsEv({ no: 21, options: { 사이즈: 'M' }, qty: 10 })).toEqual([])
    expect(smsEv({ no: 21 })).toEqual(['options'])
    expect(smsEv({ no: 21, options: { 사이즈: 'XL' } })).toEqual(['options'])
    expect(smsEv({ no: 21, options: { 색상: 'M' } })).toEqual(['options'])
    expect(smsEv({ no: 21, options: 'M' })).toEqual(['options'])
    expect(smsEv({ no: 21, options: { 사이즈: 1 } })).toEqual(['options.사이즈'])
    expect(smsEv({ no: 11, options: { 사이즈: 'M' } })).toEqual(['options'])
    expect(smsEv({ no: 31, options: { 사이즈: 'M' } })).toEqual(['options'])
    expect(smsEv({ no: 31, qty: 3 })).toEqual([])
    expect(smsEv({ no: 11, qty: 0 })).toEqual(['qty'])
    expect(smsEv({ no: 11, qty: 11 })).toEqual(['qty'])
    const assignEv = (fields: Record<string, unknown>) => problemsOf(state, { type: 'host.assign', b: 'b1', buyer: 'UC_A', reason: 'r', ...fields })
    expect(assignEv({ no: 21, options: { 사이즈: 'S' }, qty: 2 })).toEqual([])
    expect(assignEv({ no: 21, qty: 1 })).toEqual(['options'])
    expect(assignEv({ no: 11, qty: 11 })).toEqual(['qty'])
    expect(assignEv({ no: 31 })).toEqual([])
    expect(assignEv({ no: 31, options: { 사이즈: 'S' } })).toEqual(['options'])
    // 찜을 가리키는 조치: 옵션 없는 상품에 options는 입력 오류, 적지 않으면 받는다
    expect(problemsOf(state, { type: 'host.cancel', b: 'b1', no: 11, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'S' } })).toEqual(['options'])
    expect(problemsOf(state, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r' })).toEqual([])
    // 바로잡기: 번호에 상품이 있어야 한다
    expect(problemsOf(state, { type: 'host.resolveReview', b: 'b1', item: 'm1', no: 31, qty: 1 })).toEqual(['no'])
    expect(problemsOf(state, { type: 'host.resolveReview', b: 'b1', item: 'm1', no: 21, qty: 1 })).toEqual(['options'])
    expect(problemsOf(state, { type: 'host.resolveReview', b: 'b1', item: 'm1', no: 11, qty: 11 })).toEqual(['qty'])
    expect(problemsOf(state, { type: 'host.resolveReview', b: 'b1', item: 'm1', no: 11, qty: 1, options: { 사이즈: 'S' } })).toEqual(['options'])
    expect(problemsOf(state, { type: 'host.resolveReview', b: 'b1', item: '', no: 11, qty: 1 })).toEqual(['item'])
  })
})

describe('AC-O1-07 옵션 바꾸기', () => {
  const update = (fields: Record<string, unknown>): EventInput => ({ type: 'product.update', b: 'b1', no: 21, ...fields }) as EventInput

  it('찜이 없으면 전체 바꾸기 — 항목 더하기·빼기, 이름 바꾸기, 별칭, 변형 재고', () => {
    const { state } = play([shorts(), update({ options: COLOR_SIZE, stocks: { '흰색/대형': 4 }, aliases: ['바지'] })], OPTIONS)
    const product = getProduct(state, 'b1', 21)
    expect(product?.variants.map((v) => [v.text, v.stock, v.price])).toEqual([
      ['흰색/소형', 1, 10000],
      ['흰색/대형', 4, 12000],
      ['검정색/소형', 1, 11000],
      ['검정색/대형', 1, 13000],
    ])
    expect(product?.aliases).toEqual(['바지'])
    // 옵션을 모두 없애면 옵션 없는 상품
    const { state: plain } = play([shorts(), update({ options: [] })], OPTIONS)
    expect(getProduct(plain, 'b1', 21)).toMatchObject({ hasOptions: false, variants: [], status: 'OPEN' })
  })

  it('찜이 있으면 더하기·가격 차이·변형 재고만, 나머지는 이벤트 전체가 아무 일도 없다', () => {
    const base = [shorts(), chat('UC_A', '반바지 M')]
    for (const blocked of [
      { options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] }], price: 20000 },
      { options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'Mid' }, { label: 'L' }] }] },
      { options: [{ name: '크기', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] },
      { options: [...SIZE, { name: '색상', choices: [{ label: '흰색' }] }] },
      { options: [{ name: '사이즈', choices: [{ label: 'XS' }, { label: 'S' }, { label: 'M' }, { label: 'L' }] }] },
      // 기존 선택지의 별칭 바꾸기 (AC-O1-07 — 받는 것은 선택지 더하기·가격 차이·변형 재고뿐)
      { options: [{ name: '사이즈', choices: [{ label: 'S', aliases: ['에스'] }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }] },
      { options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'], price: 500 }, { label: 'L' }] }] },
    ]) {
      const before = play(base, OPTIONS).state
      const after = applyEvent(before, ev(update(blocked) as unknown as Record<string, unknown>)).state
      expect(after).toBe(before)
    }
    const { state } = play(
      [...base, update({ options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'], price: 500 }, { label: 'L' }, { label: 'XL', aliases: ['엑스라지'], price: 1000 }] }], stocks: { XL: 0 } })],
      OPTIONS,
    )
    expect(getProduct(state, 'b1', 21)?.variants.map((v) => [v.text, v.stock, v.price, v.status])).toEqual([
      ['S', 1, 10000, 'OPEN'],
      ['M', 1, 10500, 'SOLD'],
      ['L', 1, 10000, 'OPEN'],
      ['XL', 0, 11000, 'SOLD'],
    ])
    // NEW_ONLY라 확정 찜의 단가 스냅샷은 그대로
    expect(listClaims(state)[0]).toMatchObject({ price: 10000, amount: 10000 })
  })

  it('변형 재고를 확정 수량보다 작게 하면 아무 일도 없다. 늘리면 대기 1순위부터, 옵션 상품의 stock은 적지 않은 변형마다', () => {
    const base = [shorts({ stocks: { M: 2 } }), { type: 'sms', b: 'b1', ref: 's1', no: 21, received: '20:00', options: { 사이즈: 'M' }, qty: 2 } as EventInput, chat('UC_A', '반바지 M'), chat('UC_B', '반바지 M')]
    const before = play(base, OPTIONS).state
    expect(applyEvent(before, ev(update({ stocks: { M: 1 } }) as unknown as Record<string, unknown>)).state).toBe(before)
    expect(applyEvent(before, ev(update({ stocks: { M: 2 }, name: '반바지' }) as unknown as Record<string, unknown>)).state).toBe(before)
    const grown = applyEvent(before, ev(update({ stocks: { M: 3 } }) as unknown as Record<string, unknown>)).state
    expect(getProduct(grown, 'b1', 21)?.variants[1]).toMatchObject({ text: 'M', stock: 3, confirmedUnits: 3, winners: ['sms:s1', 'UC_A'], waitlist: ['UC_B'] })
    const all = applyEvent(before, ev(update({ stock: 4 }) as unknown as Record<string, unknown>)).state
    expect(getProduct(all, 'b1', 21)?.variants.map((v) => v.stock)).toEqual([4, 4, 4])
    expect(getProduct(all, 'b1', 21)).toMatchObject({ stock: 4, confirmedUnits: 4 })
    expect(checkInvariants(all)).toEqual([])
  })

  it('UNPAID_CLAIMS: 입금 전 찜의 단가를 그 변형의 새 단가로, 입금된 묶음은 그대로, 다른 변형은 그대로', () => {
    const { state } = play(
      [
        shorts(),
        chat('UC_A', '반바지 M 2개'.replace(' 2개', '')),
        chat('UC_B', '반바지 S'),
        { type: 'settlement.payment', buyer: 'UC_B', date: '2026-10-18', amount: 1000 } as EventInput,
        update({ applyTo: 'UNPAID_CLAIMS', options: [{ name: '사이즈', choices: [{ label: 'S', price: 300 }, { label: 'M', aliases: ['엠'], price: 700 }, { label: 'L' }] }] }),
      ],
      OPTIONS,
    )
    const claims = listClaims(state)
    expect(claims.map((c) => [c.buyer, c.key, c.price])).toEqual([
      ['UC_A', 'b1/21#M', 10700],
      ['UC_B', 'b1/21#S', 10000],
    ])
    expect(claims[0]?.priceHistory.map(({ from, to }) => [from, to])).toEqual([[10000, 10700]])
    expect(checkInvariants(state)).toEqual([])
  })
})

describe('AC-O1-09·13 수량·변형 상태·판매 종료', () => {
  it('승계 결정 필요 변형에 온 수량 2 이상: 남은 수량이 있으면 확인 필요(STOCK_SHORT), 없으면 품절. 수량 1은 대기', () => {
    const settings = { ...OPTIONS, 'cancel.succession': 'ASK' } as const
    const { state } = play(
      [
        { type: 'product.register', b: 'b1', no: 11, name: '과자', price: 2000, stock: 3 } as EventInput,
        chat('UC_A', '과자 3'),
        chat('UC_B', '과자'),
        { type: 'host.cancel', b: 'b1', no: 11, buyer: 'UC_A', reason: 'r' } as EventInput,
        chat('UC_C', '과자 2'),
        chat('UC_D', '과자 1'),
      ],
      settings,
    )
    expect(getProduct(state, 'b1', 11)).toMatchObject({ winners: [], waitlist: ['UC_B', 'UC_D'], awaitingSuccession: true, confirmedUnits: 0 })
    expect(listReviews(state).map((r) => [r.item, r.reason, r.qty])).toEqual([[expect.any(String), 'STOCK_SHORT', 2]])
    // 남은 수량 0인 승계 결정 필요 자리는 없다(남은 수량이 생겨서 표시가 붙는다) — 다 팔린 자리의 수량 2는 품절
    const { state: sold } = play([{ type: 'product.register', b: 'b1', no: 11, name: '과자', price: 2000 } as EventInput, chat('UC_A', '과자'), chat('UC_B', '과자 2')], OPTIONS)
    expect(claimsOf(sold)).toEqual([
      { key: 'b1/11', buyer: 'UC_A', status: 'CONFIRMED', reason: null, qty: 1 },
      { key: 'b1/11', buyer: 'UC_B', status: 'REJECTED', reason: 'SOLD_OUT', qty: 2 },
    ])
  })

  it('판매 중이 아니면 변형 상태 = 상품 상태, close는 어느 변형에도 확정·대기가 없을 때만', () => {
    const { state } = play([shorts({ status: 'READY' })], OPTIONS)
    expect(getProduct(state, 'b1', 21)?.variants.map((v) => v.status)).toEqual(['READY', 'READY', 'READY'])
    const sold = play([shorts(), chat('UC_A', '반바지 L')], OPTIONS).state
    const closing = applyEvent(sold, ev({ type: 'product.close', b: 'b1', no: 21 }))
    expect(closing.state).toBe(sold)
    const cancelled = play([shorts(), chat('UC_A', '반바지 L'), { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r' } as EventInput, { type: 'product.close', b: 'b1', no: 21 } as EventInput], OPTIONS).state
    expect(getProduct(cancelled, 'b1', 21)?.variants.map((v) => v.status)).toEqual(['CLOSED', 'CLOSED', 'CLOSED'])
  })
})

describe('AC-O1-14 직접 배정·문자찜의 옵션·수량', () => {
  const setup = [shorts({ stocks: { M: 3 } }), chat('UC_A', '안녕'), chat('UC_B', '안녕'), chat('UC_C', '반바지 M')]

  it('수량 2 이상 1등의 WAITLIST 교체는 아무 일도 없고, CANCEL 교체로 남은 수량은 승계(D-O1-05)', () => {
    const base = play([...setup, { type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' }, qty: 2 } as EventInput, chat('UC_D', '반바지 M')], OPTIONS).state
    // M: C 1 + A 2 = 3, D 대기
    expect(getProduct(base, 'b1', 21)?.variants[1]).toMatchObject({ confirmedUnits: 3, waitlist: ['UC_D'] })
    const waitlist = applyEvent(base, ev({ type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r', options: { 사이즈: 'M' }, replace: 'UC_A', replaceTo: 'WAITLIST' }))
    expect(waitlist.state).toBe(base)
    const tooMany = applyEvent(base, ev({ type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r', options: { 사이즈: 'M' }, qty: 3, replace: 'UC_A', replaceTo: 'CANCEL' }))
    expect(tooMany.state).toBe(base)
    const replaced = applyEvent(base, ev({ type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r', options: { 사이즈: 'M' }, replace: 'UC_A', replaceTo: 'CANCEL' })).state
    expect(getProduct(replaced, 'b1', 21)?.variants[1]).toMatchObject({ confirmedUnits: 3, winners: ['UC_C', 'UC_B', 'UC_D'], waitlist: [] })
    expect(checkInvariants(replaced)).toEqual([])
  })

  it('대기 중인 구매자에게 배정하면 그 대기 찜이 수량을 받아 확정된다. 빈 자리가 모자라면 아무 일도 없다', () => {
    const full = play([shorts(), chat('UC_A', '반바지 M'), chat('UC_B', '반바지 M')], OPTIONS).state
    expect(applyEvent(full, ev({ type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r', options: { 사이즈: 'M' } })).state).toBe(full)
    const upd = applyEvent(full, ev({ type: 'product.update', b: 'b1', no: 21, stocks: { M: 3 } })).state
    // 재고 늘림으로 B가 이미 확정. 새 구매자 C는 대기 없이 수량 1 배정
    expect(getProduct(upd, 'b1', 21)?.variants[1]).toMatchObject({ winners: ['UC_A', 'UC_B'] })
    const waiting = play([shorts(), chat('UC_A', '반바지 M'), chat('UC_B', '반바지 M'), { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r' } as EventInput], { ...OPTIONS, 'cancel.succession': 'ASK' }).state
    const assigned = applyEvent(waiting, ev({ type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r', options: { 사이즈: 'M' }, qty: 1 })).state
    expect(getProduct(assigned, 'b1', 21)?.variants[1]).toMatchObject({ winners: ['UC_B'], waitlist: [], awaitingSuccession: false })
    expect(claimsOf(assigned).filter((c) => c.buyer === 'UC_B')).toEqual([{ key: 'b1/21#M', buyer: 'UC_B', status: 'CONFIRMED', reason: null, qty: 1 }])
  })

  it('문자찜: 옵션·수량이 맞으면 확정 (감사 문구는 문자찜, 수량 2 이상은 n개), 상품 없는 번호의 수량만 보류', () => {
    const { state } = play(
      [
        shorts({ stocks: { M: 2 } }),
        { type: 'sms', b: 'b1', ref: 's1', no: 21, received: '20:00', options: { 사이즈: 'M' }, qty: 2 } as EventInput,
        { type: 'sms', b: 'b1', ref: 's2', no: 21, received: '20:00', options: { 사이즈: 'M' }, qty: 2 } as EventInput,
      ],
      OPTIONS,
    )
    expect(listEffects(state).find((e) => e.kind === 'POST_THANKS')?.text).toBe('21번 반바지 M 2개 20,000원 문자찜님 구매 감사합니다')
    // s2는 남은 수량 0, 수량 2 → 대기하지 않고 품절
    expect(claimsOf(state)).toEqual([
      { key: 'b1/21#M', buyer: 'sms:s1', status: 'CONFIRMED', reason: null, qty: 2 },
      { key: 'b1/21#M', buyer: 'sms:s2', status: 'REJECTED', reason: 'SOLD_OUT', qty: 2 },
    ])
    expect(listReviews(state)).toEqual([])
    const sold = play([shorts(), { type: 'sms', b: 'b1', ref: 's1', no: 21, received: '20:00', options: { 사이즈: 'S' } } as EventInput, { type: 'sms', b: 'b1', ref: 's2', no: 21, received: '20:00', options: { 사이즈: 'S' }, qty: 2 } as EventInput], OPTIONS).state
    expect(claimsOf(sold).map((c) => c.status)).toEqual(['CONFIRMED', 'REJECTED'])
  })
})

describe('다육 회귀 — 승계는 풀린 수량만큼', () => {
  it('교체 WAITLIST로 빈 자리와 대기가 함께 있을 때 1등 취소는 한 명만 승계한다 (원래 비어 있던 자리는 그대로)', () => {
    const { state } = play([
      { type: 'product.register', b: 'b1', no: 1, name: '다육', price: 1000, stock: 2 } as EventInput,
      chat('UC_X', '안녕'),
      chat('UC_Y', '안녕'),
      chat('UC_A', '1'),
      { type: 'host.assign', b: 'b1', no: 1, buyer: 'UC_X', reason: 'r', replace: 'UC_A', replaceTo: 'WAITLIST' } as EventInput,
      { type: 'host.assign', b: 'b1', no: 1, buyer: 'UC_Y', reason: 'r', replace: 'UC_X', replaceTo: 'WAITLIST' } as EventInput,
      { type: 'host.cancel', b: 'b1', no: 1, buyer: 'UC_Y', reason: 'r' } as EventInput,
    ])
    // 재고 2: Y 확정·X·A 대기·빈 자리 1 → Y 취소로 풀린 1자리만 대기 1순위 X가 채운다
    expect(getProduct(state, 'b1', 1)).toMatchObject({ winners: ['UC_X'], waitlist: ['UC_A'], status: 'OPEN' })
    expect(listClaims(state).map((c) => c.confirmVersion)).toEqual([1, 4, 3])
  })
})

describe('공개 전 찜 (R-19 "공개 전 찜") — 변형 하나뿐인 상품, 수량 모자람, 번호를 바꾼 뒤 남은 변형 찜', () => {
  it('변형이 하나뿐이면 번호만 쓴 찜도 그 변형으로 판정한다. 같은 사람의 같은 변형 찜이 이미 있으면 뒤 찜은 중복', () => {
    const one: readonly OptionItem[] = [{ name: '구성', choices: [{ label: '5켤레' }] }]
    const { state } = play(
      [
        chat('UC_A', '61'),
        { type: 'product.register', b: 'b1', no: 61, name: '양말', price: 3000, stock: 2, status: 'READY', options: one } as EventInput,
        chat('UC_B', '61'),
        chat('UC_B', '양말'),
        { type: 'product.open', b: 'b1', no: 61 } as EventInput,
      ],
      OPTIONS,
    )
    expect(claimsOf(state)).toEqual([
      { key: 'b1/61#5켤레', buyer: 'UC_A', status: 'CONFIRMED', reason: null, qty: 1 },
      { key: 'b1/61#5켤레', buyer: 'UC_B', status: 'CONFIRMED', reason: null, qty: 1 },
    ])
    // 61번 상품 공개 전에는 '61'이 상품 없는 번호의 보류 찜, 등록 뒤 '61'은 변형 하나뿐이라 주문(보류), '양말'은 같은 변형이라 반복
    expect(checkInvariants(state)).toEqual([])
    const { state: dup } = play(
      [chat('UC_A', '61'), { type: 'product.register', b: 'b1', no: 61, name: '양말', price: 3000, status: 'READY', options: one } as EventInput, chat('UC_A', '양말'), { type: 'product.open', b: 'b1', no: 61 } as EventInput],
      OPTIONS,
    )
    expect(claimsOf(dup)).toEqual([
      { key: 'b1/61#5켤레', buyer: 'UC_A', status: 'DUPLICATE', reason: null, qty: 1 },
      { key: 'b1/61#5켤레', buyer: 'UC_A', status: 'CONFIRMED', reason: null, qty: 1 },
    ])
    expect(checkInvariants(dup)).toEqual([])
  })

  it('수량이 남은 수량보다 많은 보류 찜은 공개 때 끝나고 확인 필요(STOCK_SHORT, 읽은 것 셋 다)', () => {
    const { state } = play(
      [
        { type: 'product.register', b: 'b1', no: 11, name: '과자', price: 2000, stock: 2, status: 'READY' } as EventInput,
        chat('UC_A', '과자 3', { id: 'mA' }),
        { type: 'product.open', b: 'b1', no: 11 } as EventInput,
      ],
      OPTIONS,
    )
    expect(claimsOf(state)).toEqual([{ key: 'b1/11', buyer: 'UC_A', status: 'REJECTED', reason: 'SOLD_OUT', qty: 3 }])
    expect(listReviews(state)).toEqual([
      { broadcast: 'b1', item: 'mA', buyer: 'UC_A', currentBuyer: 'UC_A', reason: 'STOCK_SHORT', product: 'b1/11', no: 11, options: null, qty: 3, seq: 2, at: T0 + 1000, origin: 'chat' },
    ])
  })

  it('번호를 바꾼 뒤 그 번호에 남은 변형 보류 찜은 새 상품에 그 변형이 없으면 OPTION_MISSING', () => {
    const { state } = play(
      [
        shorts({ status: 'READY' }),
        chat('UC_A', '반바지 M', { id: 'mA' }),
        { type: 'product.renumber', b: 'b1', from: 21, to: 22 } as EventInput,
        { type: 'product.register', b: 'b1', no: 21, name: '티', price: 5000, options: [{ name: '색', choices: [{ label: '흰' }, { label: '검' }] }] } as EventInput,
      ],
      OPTIONS,
    )
    expect(claimsOf(state)).toEqual([{ key: 'b1/21#M', buyer: 'UC_A', status: 'REJECTED', reason: 'OPTION_MISSING', qty: 1 }])
    expect(listReviews(state).map((r) => [r.item, r.reason, r.product])).toEqual([['mA', 'OPTION_MISSING', 'b1/21']])
    expect(checkInvariants(state)).toEqual([])
  })
})

describe('번호를 바꾼 뒤 남은 변형 보류 찜의 자리 (R-10 1, R-5, R-9 — SA-O1-03)', () => {
  const renumber = (from: number, to: number): EventInput => ({ type: 'product.renumber', b: 'b1', from, to }) as EventInput
  const slotUnits = (state: EngineState, no: number): string[] => (pget(state.slots, `b1/${String(no)}`) as SlotRecord).units.map((unit) => unit.text)

  it('자리는 남되 조회의 변형에는 나오지 않고, 찜이 끝나면 자리도 지워진다', () => {
    const orphan = [shorts({ status: 'READY' }), chat('UC_A', '반바지 M'), chat('UC_A', '반바지 L'), renumber(21, 25)]
    const { state } = play(orphan, OPTIONS)
    expect(slotUnits(state, 21)).toEqual(['M', 'L'])
    expect(slotUnits(state, 25)).toEqual(['S', 'M', 'L'])
    expect(checkInvariants(state)).toEqual([])
    // 새 상품을 21에 등록해도 보류 찜의 자리는 남지만 새 상품의 변형은 새 상품 것만
    const tee = { type: 'product.register', b: 'b1', no: 21, name: '티', price: 5000, status: 'READY', options: [{ name: '색', choices: [{ label: '흰' }, { label: 'M' }] }] } as EventInput
    const { state: again } = play([...orphan, tee], OPTIONS)
    expect(slotUnits(again, 21)).toEqual(['흰', 'M', 'L'])
    expect(getProduct(again, 'b1', 21)?.variants.map((v) => v.text)).toEqual(['흰', 'M'])
    // 상품 수정도 자리를 지우지 않는다
    const { state: updated } = play([...orphan, tee, { type: 'product.update', b: 'b1', no: 21, price: 6000 } as EventInput], OPTIONS)
    expect(slotUnits(updated, 21)).toEqual(['흰', 'M', 'L'])
    // 변형이 둘이라 옵션 없는 취소는 고르는 요청, 고른 취소는 그 찜만 — 남은 찜이 끝나면 자리도 없다
    const cancelled = play([...orphan, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r' } as EventInput], OPTIONS)
    expect(claimsOf(cancelled.state).map((c) => c.status)).toEqual(['PENDING', 'PENDING'])
    const blocked = play([...orphan, { type: 'host.blockBuyer', buyer: 'UC_A', reason: '사유' } as EventInput], OPTIONS)
    expect(claimsOf(blocked.state).map((c) => [c.key, c.status, c.reason])).toEqual([
      ['b1/21#M', 'REJECTED', 'BLOCKED'],
      ['b1/21#L', 'REJECTED', 'BLOCKED'],
    ])
    expect(slotUnits(blocked.state, 21)).toEqual([])
    expect(checkInvariants(blocked.state)).toEqual([])
    // 공개(새 상품에 L이 없다): M은 새 상품의 변형으로 판정, L은 OPTION_MISSING — 끝난 L의 자리는 지워진다
    const { state: opened } = play([...orphan, tee, { type: 'product.open', b: 'b1', no: 21 } as EventInput], OPTIONS)
    expect(claimsOf(opened).map((c) => [c.key, c.status, c.reason])).toEqual([
      ['b1/21#M', 'CONFIRMED', null],
      ['b1/21#L', 'REJECTED', 'OPTION_MISSING'],
    ])
    expect(slotUnits(opened, 21)).toEqual(['흰', 'M'])
    expect(checkInvariants(opened)).toEqual([])
  })

  it('보류 찜이 남은 번호로 다른 상품이 옮겨 와도 그 자리는 남는다', () => {
    const { state } = play(
      [shorts({ status: 'READY' }), chat('UC_A', '반바지 L'), renumber(21, 25), { type: 'product.register', b: 'b1', no: 30, name: '치마', price: 9000, status: 'READY', options: [{ name: '색', choices: [{ label: '빨강' }, { label: '파랑' }] }] } as EventInput, renumber(30, 21)],
      OPTIONS,
    )
    expect(slotUnits(state, 21)).toEqual(['빨강', '파랑', 'L'])
    expect(getProduct(state, 'b1', 21)?.variants.map((v) => v.text)).toEqual(['빨강', '파랑'])
    expect(checkInvariants(state)).toEqual([])
  })
})

describe('남은 변형 보류 찜을 옵션으로 골라 끝내기 (R-5, R-10 1, R-19 "찜을 가리키는 방송자 조치", R-20 8 — SA-O1-03)', () => {
  const renumber = (from: number, to: number): EventInput => ({ type: 'product.renumber', b: 'b1', from, to }) as EventInput
  const orphan = [shorts({ status: 'READY' }), chat('UC_A', '반바지 M'), chat('UC_A', '반바지 L'), renumber(21, 25)]
  const keyed = (state: EngineState) => claimsOf(state).map((c) => [c.key, c.status, c.reason])
  const hostOn = (type: string, options: Record<string, string>, no = 21) =>
    (type === 'host.reopen' ? { type, b: 'b1', no, reason: 'r', options } : { type, b: 'b1', no, buyer: 'UC_A', reason: 'r', options }) as EventInput

  it('상품이 없는 번호: 남은 찜의 옵션과 같으면 받고 그 찜만 끝낸다. 다른 옵션·항목 수가 다르면 지금처럼 입력 오류', () => {
    const { state } = play(orphan, OPTIONS)
    expect(problemsOf(state, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } })).toEqual([])
    expect(problemsOf(state, { type: 'host.reject', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'S' } })).toEqual(['options'])
    expect(problemsOf(state, { type: 'host.reject', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M', 색: '흰' } })).toEqual(['options'])
    expect(problemsOf(state, { type: 'host.reject', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 크기: 'M' } })).toEqual(['options'])
    expect(problemsOf(state, { type: 'host.reject', b: 'b1', no: 22, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } })).toEqual(['options'])
    const rejected = play([...orphan, hostOn('host.reject', { 사이즈: 'L' })], OPTIONS).state
    expect(keyed(rejected)).toEqual([
      ['b1/21#M', 'PENDING', 'UNOPENED'],
      ['b1/21#L', 'REJECTED', 'BY_HOST'],
    ])
    expect(checkInvariants(rejected)).toEqual([])
    // 다른 구매자에게 적으면 아무 일도 없다
    const other = play([...orphan, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r', options: { 사이즈: 'M' } } as EventInput], OPTIONS).state
    expect(keyed(other).map((c) => c[1])).toEqual(['PENDING', 'PENDING'])
    // 찜을 바꾸지 않는 조치(승계 다시 열기·대기 올리기·잠금)는 아무 일도 없다
    for (const type of ['host.reopen', 'host.promote', 'host.confirm', 'host.dismissCancel']) {
      const after = play([...orphan, hostOn(type, { 사이즈: 'M' })], OPTIONS).state
      expect(keyed(after).map((c) => c[1])).toEqual(['PENDING', 'PENDING'])
    }
  })

  it('다른 옵션 상품이 옮겨 온 번호: 그 상품의 옵션이 아니어도 남은 찜의 옵션이면 받는다. 그 상품의 옵션은 그 상품 변형으로', () => {
    const skirt = { type: 'product.register', b: 'b1', no: 30, name: '치마', price: 9000, status: 'READY', options: [{ name: '색', choices: [{ label: '빨강' }, { label: '파랑' }] }] } as EventInput
    const events = [...orphan, skirt, renumber(30, 21)]
    const { state } = play(events, OPTIONS)
    expect(problemsOf(state, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } })).toEqual([])
    expect(problemsOf(state, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 색: '빨강' } })).toEqual([])
    expect(problemsOf(state, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'S' } })).toEqual(['options'])
    const cancelled = play([...events, hostOn('host.cancel', { 사이즈: 'M' }), hostOn('host.cancel', { 색: '빨강' })], OPTIONS).state
    expect(keyed(cancelled)).toEqual([
      ['b1/21#M', 'CANCELLED', null],
      ['b1/21#L', 'PENDING', 'UNOPENED'],
    ])
    expect(checkInvariants(cancelled)).toEqual([])
    // 옵션 없는 상품이 옮겨 와도 같다
    const plain = { type: 'product.register', b: 'b1', no: 30, name: '양말', price: 3000, status: 'READY' } as EventInput
    const plainEvents = [...orphan, plain, renumber(30, 21)]
    expect(problemsOf(play(plainEvents, OPTIONS).state, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'L' } })).toEqual([])
    expect(keyed(play([...plainEvents, hostOn('host.cancel', { 사이즈: 'L' })], OPTIONS).state)).toEqual([
      ['b1/21#M', 'PENDING', 'UNOPENED'],
      ['b1/21#L', 'CANCELLED', null],
    ])
  })

  it('시청자 "21 취소"(AUTO)의 변형 고르는 요청을 옵션으로 승인하면 그 찜만 취소, 요청은 사라진다', () => {
    const auto = { ...OPTIONS, 'cancel.buyerChat': 'AUTO' } as const
    const asked = [...orphan, chat('UC_A', '21 취소')]
    const { state } = play(asked, auto)
    expect(listCancelRequests(state).map((r) => [r.product, r.buyer, r.chooseVariant])).toEqual([['b1/21', 'UC_A', true]])
    expect(problemsOf(state, { type: 'host.approveCancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } })).toEqual([])
    const approved = play([...asked, hostOn('host.approveCancel', { 사이즈: 'M' })], auto).state
    expect(keyed(approved)).toEqual([
      ['b1/21#M', 'CANCELLED', null],
      ['b1/21#L', 'PENDING', 'UNOPENED'],
    ])
    expect(listCancelRequests(approved)).toEqual([])
    expect(checkInvariants(approved)).toEqual([])
  })
})

describe('지금 상품 (R-20 6, D-O1-06)', () => {
  it('없는 번호·HOLD·CLOSED의 focus는 지금 상품을 없애고, 일시 중지·판매 종료도 없앤다. 다른 방송은 따로다', () => {
    const at = (state: EngineState) => getBroadcast(state, 'b1')?.focus ?? null
    const base = [shorts(), { type: 'product.register', b: 'b1', no: 22, name: '티', price: 5000 } as EventInput]
    const { state } = play(base, OPTIONS)
    expect(at(state)).toMatchObject({ product: 'b1/22', no: 22 })
    expect(at(applyEvent(state, ev({ type: 'product.focus', b: 'b1', no: 99 })).state)).toBeNull()
    expect(at(applyEvent(state, ev({ type: 'product.hold', b: 'b1', no: 22 })).state)).toBeNull()
    expect(at(applyEvent(state, ev({ type: 'product.hold', b: 'b1', no: 21 })).state)).toMatchObject({ no: 22 })
    expect(at(applyEvent(state, ev({ type: 'product.close', b: 'b1', no: 22 })).state)).toBeNull()
    const held = applyEvent(state, ev({ type: 'product.hold', b: 'b1', no: 21 })).state
    expect(at(applyEvent(held, ev({ type: 'product.focus', b: 'b1', no: 21 })).state)).toBeNull()
    // 지금 상품이 없는데 없애기는 아무 일도 없다
    const none = applyEvent(state, ev({ type: 'product.focus', b: 'b1', no: 99 })).state
    expect(applyEvent(none, ev({ type: 'product.focus', b: 'b1', no: 98 })).state).toBe(none)
    // STRICT 방송은 지금 상품을 정하지 않는다
    expect(at(play([{ type: 'product.register', b: 'b1', no: 22, name: '티', price: 5000 } as EventInput]).state)).toBeNull()
  })
})

describe('AC-O1-22 바로잡기·지우기', () => {
  const base: EventInput[] = [shorts(), chat('UC_A', '반바지', { id: 'mA' }), chat('UC_B', '반바지', { id: 'mB' })]

  it('차단된 구매자는 REJECTED(BLOCKED) 찜이 생기고 항목이 사라진다', () => {
    const { state } = play([...base, { type: 'host.blockBuyer', buyer: 'UC_A', reason: 'r' } as EventInput, { type: 'host.resolveReview', b: 'b1', item: 'mA', no: 21, qty: 1, options: { 사이즈: 'M' } } as EventInput], OPTIONS)
    expect(claimsOf(state)).toEqual([{ key: 'b1/21#M', buyer: 'UC_A', status: 'REJECTED', reason: 'BLOCKED', qty: 1 }])
    expect(listReviews(state).map((r) => r.item)).toEqual(['mB'])
  })

  it('같은 변형에 활성 찜이 있으면 아무 일도 없다 (항목이 남는다), 수량 1은 대기 자리, 수량 2 이상은 아무 일도 없다', () => {
    const { state } = play([...base, chat('UC_A', '반바지 M')], OPTIONS)
    const resolve = (item: string, qty: number, label = 'M') => ev({ type: 'host.resolveReview', b: 'b1', item, no: 21, qty, options: { 사이즈: label } })
    expect(applyEvent(state, resolve('mA', 1)).state).toBe(state)
    expect(applyEvent(state, resolve('mB', 2)).state).toBe(state)
    const queued = applyEvent(state, resolve('mB', 1)).state
    expect(getProduct(queued, 'b1', 21)?.variants[1]).toMatchObject({ winners: ['UC_A'], waitlist: ['UC_B'] })
    expect(listReviews(queued).map((r) => r.item)).toEqual(['mA'])
    // 앞선 대기자가 있으면 빈 자리여도 확정하지 않는다 — 재고를 늘려 자리를 만든 뒤 순위가 앞선 대기자가 있는지 본다
    const confirmed = applyEvent(state, resolve('mB', 1, 'S')).state
    expect(getProduct(confirmed, 'b1', 21)?.variants[0]).toMatchObject({ winners: ['UC_B'] })
    expect(listEffects(confirmed).at(-1)?.text).toBe('21번 반바지 S 10,000원 UC_B님 구매 감사합니다')
  })

  it('승계 결정 필요 자리: 수량 1은 대기 자리, 수량 2는 아무 일도 없다. 대기한도 넘치면 맨 끝 품절', () => {
    const settings = { ...OPTIONS, 'cancel.succession': 'ASK', 'waitlist.max': 1 } as const
    const { state } = play([...base, chat('UC_C', '반바지 M'), chat('UC_D', '반바지 M'), { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_C', reason: 'r', options: { 사이즈: 'M' } } as EventInput], settings)
    expect(getProduct(state, 'b1', 21)?.variants[1]).toMatchObject({ winners: [], waitlist: ['UC_D'], awaitingSuccession: true })
    const two = applyEvent(state, ev({ type: 'host.resolveReview', b: 'b1', item: 'mA', no: 21, qty: 2, options: { 사이즈: 'M' } }))
    expect(two.state).toBe(state)
    const one = applyEvent(state, ev({ type: 'host.resolveReview', b: 'b1', item: 'mA', no: 21, qty: 1, options: { 사이즈: 'M' } })).state
    // A의 원래 순위(mA)가 D보다 앞선다 → A가 1순위, 한도 1이라 D 품절
    expect(getProduct(one, 'b1', 21)?.variants[1]).toMatchObject({ waitlist: ['UC_A'], awaitingSuccession: true })
    expect(claimsOf(one).find((c) => c.buyer === 'UC_D')).toMatchObject({ status: 'REJECTED', reason: 'SOLD_OUT' })
  })

  it('지우기: 있으면 지우고 없으면 아무 일도 없다', () => {
    const { state } = play([...base, { type: 'host.dismissReview', b: 'b1', item: 'mA' } as EventInput], OPTIONS)
    expect(listReviews(state).map((r) => r.item)).toEqual(['mB'])
    expect(applyEvent(state, ev({ type: 'host.dismissReview', b: 'b1', item: 'mA' })).state).toBe(state)
    expect(applyEvent(state, ev({ type: 'host.resolveReview', b: 'b1', item: 'mA', no: 21, qty: 1, options: { 사이즈: 'M' } })).state).toBe(state)
  })
})

describe('AC-O1-25·26 시청자 취소·찜을 가리키는 방송자 조치의 options', () => {
  const base: EventInput[] = [shorts({ stocks: { M: 2 } }), chat('UC_A', '반바지 M'), chat('UC_A', '반바지 L'), chat('UC_A', '21 취소')]

  it('변형 찜이 둘이면 변형을 정하지 않은 요청 — 조회는 상품 키·choices, 승인은 options로 변형을 고른다', () => {
    const { state } = play(base, OPTIONS)
    const [request] = listCancelRequests(state)
    expect(request).toMatchObject({ product: 'b1/21', buyer: 'UC_A', chooseVariant: true, claim: 'request:b1/21:UC_A' })
    expect(request?.choices).toEqual(listClaims(state).map((c) => c.id))
    // 같은 요청은 하나 — 다시 써도 그대로
    expect(listCancelRequests(play([...base, chat('UC_A', '21 취소')], OPTIONS).state)).toHaveLength(1)
    // options 없이 승인하면 대상이 둘이라 아무 일도 없다
    const noPick = applyEvent(state, ev({ type: 'host.approveCancel', b: 'b1', no: 21, buyer: 'UC_A' }))
    expect(noPick.state).toBe(state)
    const approved = applyEvent(state, ev({ type: 'host.approveCancel', b: 'b1', no: 21, buyer: 'UC_A', options: { 사이즈: 'L' } })).state
    expect(claimsOf(approved).map((c) => [c.key, c.status])).toEqual([
      ['b1/21#M', 'CONFIRMED'],
      ['b1/21#L', 'CANCELLED'],
    ])
    expect(listCancelRequests(approved)).toEqual([])
    const dismissed = applyEvent(state, ev({ type: 'host.dismissCancel', b: 'b1', no: 21, buyer: 'UC_A', options: { 사이즈: 'M' } })).state
    expect(listCancelRequests(dismissed)).toEqual([])
    expect(claimsOf(dismissed).map((c) => c.status)).toEqual(['CONFIRMED', 'CONFIRMED'])
  })

  it('요청한 채널의 그 상품 활성 찜이 모두 끝나면 요청도 사라진다', () => {
    const { state } = play(
      [...base, { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } } as EventInput, { type: 'host.reject', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r' } as EventInput],
      OPTIONS,
    )
    // 첫 취소 뒤 L 하나만 남아 options 없는 무효가 그 찜을 고른다
    expect(claimsOf(state).map((c) => c.status)).toEqual(['CANCELLED', 'REJECTED'])
    expect(listCancelRequests(state)).toEqual([])
  })

  it('options 없는 조치: 활성 찜이 하나면 그 찜, 둘이면 아무 일도 없다. reopen은 options가 있어야 한다', () => {
    const settings = { ...OPTIONS, 'cancel.succession': 'ASK' } as const
    const { state } = play([shorts(), chat('UC_A', '반바지 M'), chat('UC_A', '반바지 L'), chat('UC_B', '반바지 M'), chat('UC_C', '반바지 L')], settings)
    expect(applyEvent(state, ev({ type: 'host.confirm', b: 'b1', no: 21, buyer: 'UC_A' })).state).toBe(state)
    const locked = applyEvent(state, ev({ type: 'host.confirm', b: 'b1', no: 21, buyer: 'UC_A', options: { 사이즈: 'M' } })).state
    expect(listClaims(locked)[0]?.locked).toBe(true)
    const cancelled = applyEvent(state, ev({ type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: { 사이즈: 'M' } })).state
    expect(getProduct(cancelled, 'b1', 21)?.variants[1]).toMatchObject({ awaitingSuccession: true, waitlist: ['UC_B'] })
    expect(applyEvent(cancelled, ev({ type: 'host.reopen', b: 'b1', no: 21, reason: 'r' })).state).toBe(cancelled)
    expect(applyEvent(cancelled, ev({ type: 'host.reopen', b: 'b1', no: 21, reason: 'r', options: { 사이즈: 'L' } })).state).toBe(cancelled)
    const reopened = applyEvent(cancelled, ev({ type: 'host.reopen', b: 'b1', no: 21, reason: 'r', options: { 사이즈: 'M' } })).state
    expect(claimsOf(reopened).find((c) => c.buyer === 'UC_B')).toMatchObject({ status: 'REJECTED', reason: 'WAITLIST_CLEARED' })
    const promoted = applyEvent(cancelled, ev({ type: 'host.promote', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r' })).state
    expect(getProduct(promoted, 'b1', 21)?.variants[1]).toMatchObject({ winners: ['UC_B'], awaitingSuccession: false })
    expect(applyEvent(state, ev({ type: 'host.promote', b: 'b1', no: 21, buyer: 'UC_B', reason: 'r' })).state).toBe(state)
    expect(activeClaimId(state, 'b1', 21, 'UC_A', 'L')).toBe(listClaims(state)[1]?.id)
    expect(activeClaimId(state, 'b1', 21, 'UC_A')).toBeNull()
    expect(activeClaimId(state, 'b1', 99, 'UC_A')).toBeNull()
  })

  it('합치기·떼어 내기: 변형 찜의 활성 표시도 지금의 구매자로 옮긴다, 같은 변형이면 중복', () => {
    const { state } = play(
      [shorts({ stocks: { M: 3 } }), chat('UC_A', '반바지 M'), chat('UC_B', '반바지 M'), chat('UC_B', '반바지 L'), { type: 'product.update', b: 'b1', no: 21, stocks: { M: 1 } } as EventInput],
      OPTIONS,
    )
    expect(checkInvariants(state)).toEqual([])
    // A·B 둘 다 M 확정 → 합치기 막힘
    expect(applyEvent(state, ev({ type: 'buyer.merge', from: 'UC_B', into: 'UC_A', reason: 'r' })).state).toBe(state)
    const { state: two } = play([shorts(), chat('UC_A', '반바지 M'), chat('UC_B', '반바지 M'), chat('UC_B', '반바지 L')], OPTIONS)
    const merged = applyEvent(two, ev({ type: 'buyer.merge', from: 'UC_B', into: 'UC_A', reason: 'r' })).state
    expect(claimsOf(merged).map((c) => [c.key, c.buyer, c.status])).toEqual([
      ['b1/21#M', 'UC_A', 'CONFIRMED'],
      ['b1/21#M', 'UC_B', 'DUPLICATE'],
      ['b1/21#L', 'UC_B', 'CONFIRMED'],
    ])
    expect(checkInvariants(merged)).toEqual([])
    const split = applyEvent(merged, { seq: 100, at: T0 + 100_000, type: 'buyer.unmerge', from: 'UC_B', reason: 'r' }).state
    expect(activeClaimId(split, 'b1', 21, 'UC_B', 'L')).toBe(listClaims(split)[2]?.id)
    expect(checkInvariants(split)).toEqual([])
  })

  it('차단하면 변형 대기 찜도 BLOCKED, 메시지 변환은 확인 필요였던 메시지·옵션 상품에 아무 일도 없다', () => {
    const { state } = play([shorts(), chat('UC_A', '반바지 M'), chat('UC_B', '반바지 M'), chat('UC_C', '반바지', { id: 'mC' }), { type: 'product.register', b: 'b1', no: 11, name: '과자', price: 2000 } as EventInput], OPTIONS)
    const blocked = applyEvent(state, ev({ type: 'host.blockBuyer', buyer: 'UC_B', reason: 'r' })).state
    expect(claimsOf(blocked).find((c) => c.buyer === 'UC_B')).toMatchObject({ status: 'REJECTED', reason: 'BLOCKED' })
    expect(checkInvariants(blocked)).toEqual([])
    expect(applyEvent(state, ev({ type: 'host.convertMessage', b: 'b1', msg: 'mC', no: 11 })).state).toBe(state)
  })
})

describe('AC-O1-27 감사 문구', () => {
  it('옵션 글은 있을 때만, 수량은 2 이상일 때만, 금액은 가격 × 수량', () => {
    expect(formatThanksText({ no: 15, name: '핑크프릴', price: 10000, buyerName: '홍길동' })).toBe('15번 핑크프릴 10,000원 홍길동님 구매 감사합니다')
    expect(formatThanksText({ no: 31, name: '수건', price: 10000, buyerName: '홍길동', optionText: '흰색/대형', qty: 2 })).toBe('31번 수건 흰색/대형 2개 20,000원 홍길동님 구매 감사합니다')
    expect(formatThanksText({ no: 11, name: '', price: 2000, buyerName: 'A', qty: 3 })).toBe('11번 3개 6,000원 A님 구매 감사합니다')
    expect(formatThanksText({ no: 11, name: '과자', price: 2000, buyerName: 'A', optionText: '', qty: 1 })).toBe('11번 과자 2,000원 A님 구매 감사합니다')
    expect(() => formatThanksText({ no: 1, name: 'x', price: 1, buyerName: 'A', qty: 0 })).toThrow(RangeError)
  })
})

describe('AC-O1-28 불변식의 변형·수량 판', () => {
  const { state } = play([shorts({ stocks: { M: 3 } }), chat('UC_A', '반바지 M 2개'), chat('UC_B', '반바지 S'), chat('UC_C', '반바지 S'), chat('UC_D', '반바지 리')], OPTIONS)
  const slot = (s: EngineState): SlotRecord => pget(s.slots, 'b1/21') as SlotRecord
  const withClaim = (s: EngineState, id: string, change: Partial<ClaimRecord>): EngineState => ({ ...s, claims: pset(s.claims, id, { ...(pget(s.claims, id) as ClaimRecord), ...change }) })
  const ids = (s: EngineState) => checkInvariants(s).map((v) => v.id)

  it('만든 상태에는 위반이 없다', () => {
    expect(checkInvariants(state)).toEqual([])
    expect(listReviews(state).map((r) => r.reason)).toEqual(['UNKNOWN_WORD'])
  })

  it('일부러 깬 상태는 그 불변식 이름으로', () => {
    // INV-1: M 확정 수량 2를 4로 (재고 3)
    expect(checkInvariants(withClaim(state, 'c1', { qty: 4 }))).toContainEqual({ id: 'INV-1', message: '상품 b1/21#M: 확정 수량 4 > 재고 3' })
    // INV-O1: 대기 찜의 수량 2
    expect(ids(withClaim(state, 'c3', { qty: 2 }))).toContain('INV-O1')
    // INV-5: 합계 = 단가 × 수량
    expect(ids(withClaim(state, 'c1', { qty: 1 }))).toContain('INV-5')
    // INV-6: 수량이 정수가 아님
    expect(ids(withClaim(state, 'c1', { qty: 1.5 }))).toContain('INV-6')
    // INV-7: 변형 대기 목록
    const units = slot(state).units.map((u) => (u.text === 'S' ? { ...u, waitlist: [] } : u))
    expect(ids({ ...state, slots: pset(state.slots, 'b1/21', { ...slot(state), units }) })).toContain('INV-7')
    // INV-2: 변형 활성 표시가 찜 상태와 다르다, 자리가 없는 변형 찜
    expect(ids({ ...state, slots: pset(state.slots, 'b1/21', { ...slot(state), variantActive: slot(state).active }) })).toContain('INV-2')
    expect(ids(withClaim(state, 'c1', { variant: 'XL' }))).toContain('INV-2')
    // INV-O2: 확인 필요 항목의 구매자·수량
    const reviewKey = JSON.stringify(['b1', listReviews(state)[0]?.item])
    const record = pget(state.reviews, reviewKey) as ReviewRecord
    expect(ids({ ...state, reviews: pset(state.reviews, reviewKey, { ...record, buyer: 'UC_ZZ' }) })).toContain('INV-O2')
    expect(ids({ ...state, reviews: pset(state.reviews, reviewKey, { ...record, qty: -1 }) })).toContain('INV-O2')
  })
})

describe('AC-O1-30 상태 저장 형식', () => {
  const events: EventInput[] = [
    { type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000, stock: 2 } as EventInput,
    chat('UC_A', '15'),
    { type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00' } as EventInput,
    chat('UC_B', '15'),
    { type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_A', reason: 'r' } as EventInput,
  ]

  it('새 상태는 형식 5, JSON으로 왕복해도 이어 쓸 수 있다', () => {
    const { state } = play([shorts(), chat('UC_A', '반바지', { id: 'mA' })], OPTIONS)
    const copy = JSON.parse(JSON.stringify(state)) as EngineState
    expect(copy.format).toBe(5)
    expect(upgradeState(copy)).toBe(copy)
    const next = applyEvent(copy, ev({ type: 'host.resolveReview', b: 'b1', item: 'mA', no: 21, qty: 1, options: { 사이즈: 'M' } })).state
    expect(listClaims(next).map((c) => c.key)).toEqual(['b1/21#M'])
  })

  it('형식 4로 저장한 다육 상태를 바꿔 이어 재생한 결과 = 처음부터 재생한 결과', () => {
    const full = play(events)
    const half = full.states[3] as EngineState
    // 형식 4 상태 흉내: 이번 스프린트에서 더한 칸을 뺀다
    const v4 = JSON.parse(
      JSON.stringify(half, (key, value: unknown) => (['focus', 'units', 'variantActive', 'requests', 'aliases', 'options', 'variants', 'qty', 'qtyWritten', 'variant', 'review', 'reviews'].includes(key) ? undefined : value)),
    ) as Record<string, unknown>
    v4.format = 4
    for (const broadcast of v4.broadcasts as Record<string, Record<string, unknown>>[]) delete (broadcast.settings as Record<string, unknown>)['claim.maxQuantity']
    expect(() => applyEvent(v4 as unknown as EngineState, ev({ type: 'chat', b: 'b1', id: 'x', ch: 'X', nick: 'x', text: '15' }))).toThrow(StateFormatError)
    let state = upgradeState(v4)
    for (let i = 3; i < events.length; i++) state = applyEvent(state, { at: T0 + i * 1000, ...events[i], seq: i + 1 } as EngineEvent).state
    expect(JSON.parse(JSON.stringify(state))).toEqual(JSON.parse(JSON.stringify(full.state)))
  })

  it('형식 3 이하·모르는 값은 StateFormatError', () => {
    const { state } = play([])
    expect(() => upgradeState({ ...state, format: 3 })).toThrow(StateFormatError)
    expect(() => upgradeState(null)).toThrow(StateFormatError)
    expect(() => upgradeState({ ...state, format: 'x' })).toThrow(StateFormatError)
  })
})
