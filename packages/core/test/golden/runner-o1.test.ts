// O1 골든 러너 자체 시험 (AC-O1-31·32·33): 새 어휘마다 받음 1·읽기 오류 1, 틀린 기대값은 실제로 실패한다, 효과 보고의 options.
import { readFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import { applyEvent, initEngine, listEffects, type EngineEvent } from '@livejjim/core'
import { realCore, reportTarget } from './core-adapter.ts'
import { formatReport } from './report.ts'
import { B1, run, scenario } from './test-helpers.ts'
import type { GoldenReport } from './types.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS' } as const
const SIZE = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }]
const shorts = (fields: Record<string, unknown> = {}) => ({ at: '20:00:00', type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE, ...fields })
const chatEv = (at: string, id: string, ch: string, text: string) => ({ at, type: 'chat', b: 'b1', id, ch, nick: ch, text })

const real = (text: string): GoldenReport => run(text, { core: realCore })
const ok = (report: GoldenReport): void => {
  expect(report.ok, formatReport(report)).toBe(true)
}
/** 읽기 오류 하나이고 메시지에 그 말이 있다 */
const readError = (report: GoldenReport, words: string): void => {
  expect(report.totals.readError, formatReport(report)).toBe(1)
  expect(report.readErrors.flatMap((e) => e.issues.map((i) => `${i.path ?? ''} ${i.message}`)).join('\n')).toContain(words)
}

const optionScenario = (events: unknown[], expect: Record<string, unknown> = {}, settings: Record<string, unknown> = OPTIONS) => scenario({ settings, events, expect })

describe('AC-O1-31 러너가 새 어휘를 안다 (받음 1 · 읽기 오류 1)', () => {
  const catalog = [{ no: 11, name: '초코 과자' }, { no: 21, name: '반바지', options: SIZE }]
  const suite = (fields: Record<string, unknown>) => stringify({ suite: 'comment-options', settings: { maxNumber: 999, maxQuantity: 10 }, catalog, focus: null, cases: [{ in: '반바지 M', out: { orders: [{ no: 21, options: { 사이즈: 'M' }, qty: 1 }] } }], ...fields })

  it('comment-options suite: catalog·focus 입력과 out 키', () => {
    ok(real(suite({})))
    ok(real(suite({ focus: { no: 21, ageSec: 0 }, cases: [{ in: '반바지', out: { review: { reason: 'OPTION_MISSING', no: 21 } } }, { in: '안녕', out: {} }] })))
    readError(real(suite({ cases: [{ in: '반바지', out: { review: { reason: 'TYPO', no: 21 } } }] })), 'OPTION_MISSING / OPTION_CONFLICT')
    readError(real(suite({ cases: [{ in: '반바지', out: { reviews: [] } }] })), "모르는 comment-options out 키 'reviews'")
    readError(real(suite({ cases: [{ in: '반바지', out: { review: { reason: 'OPTION_MISSING', note: 'x' } } }] })), "모르는 comment-options 확인 필요 키 'note'")
    readError(real(suite({ cases: [{ in: '반바지', out: { orders: [{ no: 21 }] } }] })), "필수 comment-options 주문 키 'qty'")
    readError(real(suite({ cases: [{ in: '반바지', out: { orders: [{ no: 21, qty: 1 }], mentions: [21] } }] })), '많아야 하나만')
    readError(real(suite({ focus: { no: 99, ageSec: 0 } })), 'catalog에 없는 번호 99')
    readError(real(suite({ focus: { no: 21, ageSec: -1 } })), '0 이상 정수')
    readError(real(suite({ focus: undefined })), "필수 키 'focus'")
    readError(real(suite({ catalog: [{ no: 1, name: 'a' }, { no: 1, name: 'b' }] })), 'catalog의 번호가 겹친다')
    readError(real(suite({ catalog: [{ no: 21, name: '반바지', options: [{ name: '사이즈', choices: [{ label: 'M' }, { label: 'm' }] }] }] })), '비교 글자로 겹친다')
    readError(real(suite({ settings: { maxQuantity: 100 } })), '1 이상 99 이하')
    readError(real(suite({ settings: { parseMode: 'OPTIONS' } })), "suite 'comment-options'에 없는 설정 키 'parseMode'")
    readError(real(stringify({ suite: 'chat', catalog: [], cases: [] })), "모르는 키 'catalog'")
    readError(real(stringify({ suite: 'chat', settings: { parseMode: 'OPTIONS' }, cases: [] })), 'STRICT / LOOSE 중 하나')
  })

  it('설정 OPTIONS·claim.maxQuantity, OPTIONS + RECEIVED_TIME은 읽기 오류', () => {
    ok(real(optionScenario([], {}, { ...OPTIONS, 'claim.maxQuantity': 99 })))
    readError(real(optionScenario([], {}, { ...OPTIONS, 'claim.maxQuantity': 0 })), '1 이상 99 이하')
    readError(real(optionScenario([], {}, { ...OPTIONS, 'contention.policy': 'RECEIVED_TIME' })), 'RECEIVED_TIME과 함께 쓸 수 없다')
    readError(
      real(scenario({ broadcasts: [], events: [{ at: '2026-10-18T20:00:00+09:00', type: 'broadcast.start', b: 'b1', date: '2026-10-18', title: '1부', settings: { ...OPTIONS, 'contention.policy': 'RECEIVED_TIME' } }] })),
      'RECEIVED_TIME과 함께 쓸 수 없다',
    )
  })

  it('옵션 방송만의 필드·이벤트: 옵션 방송이 아닌 방송이면 읽기 오류 (broadcast.start의 설정도 본다)', () => {
    ok(real(optionScenario([shorts({ aliases: ['바지'], stocks: { M: 2 } }), { at: '20:00:01', type: 'product.focus', b: 'b1', no: 21 }])))
    readError(real(scenario({ events: [shorts()] })), 'options은 옵션 방송')
    readError(real(scenario({ events: [{ at: '20:00:01', type: 'product.focus', b: 'b1', no: 21 }] })), 'product.focus은 옵션 방송')
    ok(
      real(
        scenario({
          broadcasts: [],
          events: [{ at: '2026-10-18T20:00:00+09:00', type: 'broadcast.start', b: 'b2', date: '2026-10-18', title: '옵션', settings: OPTIONS }, { ...shorts({ b: 'b2' }), at: '2026-10-18T20:00:01+09:00' }],
        }),
      ),
    )
  })

  it('옵션 항목·변형 재고·고른 옵션·수량은 README대로', () => {
    readError(real(optionScenario([shorts({ options: [{ name: '사이즈', choices: [{ label: 'S/M' }] }] })])), "'/'·'#'")
    readError(real(optionScenario([shorts({ stocks: { XL: 1 } })])), "그 상품의 변형이 아니다 'XL'")
    readError(real(optionScenario([shorts({ options: undefined, stocks: { M: 1 } })])), 'options 없는 상품에는 stocks')
    readError(real(optionScenario([shorts({ price: 1000, options: [{ name: '사이즈', choices: [{ label: 'S', price: -2000 }] }] })])), '변형 단가')
    readError(real(optionScenario([shorts({ aliases: 'x' })])), 'aliases는')
    const smsEv = (fields: Record<string, unknown>) => ({ at: '20:00:05', type: 'sms', b: 'b1', ref: 's1', no: 21, received: '20:00', ...fields })
    ok(real(optionScenario([shorts(), smsEv({ options: { 사이즈: 'M' }, qty: 10 })])))
    readError(real(optionScenario([shorts(), smsEv({ options: { 사이즈: 'M' }, qty: 11 })])), 'qty는 1 이상 10 이하')
    readError(real(optionScenario([shorts(), smsEv({ options: { 색상: 'M' } })])), "그 상품의 항목이 아니다 '색상'")
    readError(real(optionScenario([shorts(), smsEv({ options: { 사이즈: 'XL' } })])), '그 항목의 선택지가 아니다')
    readError(real(optionScenario([shorts(), smsEv({ no: 31, options: { 사이즈: 'M' } })])), '옵션이 있는 상품이 아니다')
    // 번호를 바꾸면 옵션도 새 번호로
    ok(real(optionScenario([shorts(), { at: '20:00:01', type: 'product.renumber', b: 'b1', from: 21, to: 22 }, { at: '20:00:02', type: 'sms', b: 'b1', ref: 's1', no: 22, received: '20:00', options: { 사이즈: 'M' } }])))
  })

  it('host.resolveReview·dismissReview의 item, 효과 보고·방송자 조치의 options', () => {
    const base = [shorts(), chatEv('20:00:05', 'm1', 'UC_A', '반바지')]
    ok(real(optionScenario([...base, { at: '20:00:06', type: 'host.resolveReview', b: 'b1', item: 'm1', no: 21, qty: 1, options: { 사이즈: 'M' } }, { at: '20:00:07', type: 'effect.labelPrinted', b: 'b1', no: 21, buyer: 'UC_A', options: { 사이즈: 'M' } }])))
    readError(real(optionScenario([...base, { at: '20:00:06', type: 'host.dismissReview', b: 'b1', item: 'm9' }])), '시나리오에 없는 채팅 메시지 ID')
    readError(real(optionScenario([...base, { at: '20:00:06', type: 'host.dismissReview', b: 'b1', item: 'sms:s9' }])), "시나리오에 없는 문자찜 'sms:s9'")
    readError(real(optionScenario([...base, { at: '20:00:06', type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_A', reason: 'r', options: 'M' }])), 'options는 항목 이름')
  })

  it('expect 키: variants·reviews·confirmedUnits·claims[].qty', () => {
    const events = [shorts(), chatEv('20:00:05', 'm1', 'UC_A', '반바지 M'), chatEv('20:00:06', 'm2', 'UC_B', '반바지')]
    ok(
      real(
        optionScenario(events, {
          products: { 'b1/21': { status: 'OPEN', confirmedUnits: 1 } },
          variants: { 'b1/21#M': { status: 'SOLD', winner: 'UC_A', winners: ['UC_A'], waitlist: [], stock: 1, confirmedUnits: 1 }, 'b1/21#S': { winner: null } },
          reviews: [{ item: 'm2', reason: 'OPTION_MISSING', buyer: 'UC_B', product: 'b1/21' }],
          claims: [{ product: 'b1/21#M', buyer: 'UC_A', status: 'CONFIRMED', qty: 1 }],
          buyers: { UC_A: { items: ['b1/21#M'], subtotal: 10000 } },
        }),
      ),
    )
    readError(real(optionScenario(events, { variants: { 'b1/21': { status: 'OPEN' } } })), "변형 키 형식 오류 'b1/21'")
    readError(real(optionScenario(events, { variants: { 'b9/21#M': { status: 'OPEN' } } })), "선언하지 않은 방송 'b9'")
    readError(real(optionScenario(events, { variants: { 'b1/21#M': { price: 1 } } })), "모르는 변형 expect 키 'price'")
    readError(real(optionScenario(events, { reviews: [{ item: 'm2', reason: 'OPTION_MISSING', buyer: 'UC_B', note: 'x' }] })), "모르는 확인 필요 expect 키 'note'")
    readError(real(optionScenario(events, { reviews: [{ item: 'm2', reason: 'TYPO', buyer: 'UC_B' }] })), 'STOCK_SHORT')
    readError(real(optionScenario(events, { reviews: [{ item: 'm2', buyer: 'UC_B' }] })), "필수 확인 필요 expect 키 'reason'")
    readError(real(optionScenario(events, { claims: [{ product: 'b1/21#M', buyer: 'UC_A', status: 'CONFIRMED', qty: 0 }] })), '1 이상 정수')
    readError(real(optionScenario(events, { products: { 'b1/21': { confirmedUnits: -1 } } })), '0 이상 정수')
    readError(real(optionScenario(events, { claims: [{ product: 'b1/21#', buyer: 'UC_A', status: 'CONFIRMED' }] })), '변형 키 형식 오류')
    readError(real(optionScenario(events, { claims: [{ product: 'b1/21', buyer: 'UC_A', status: 'REJECTED', reason: 'TYPO' }] })), 'OPTION_MISSING')
  })
})

describe('AC-O1-32 비교 규칙 — 틀린 기대값은 실패한다', () => {
  const golden = (path: string): string => readFileSync(new URL(`../../../../tests/golden/${path}`, import.meta.url), 'utf8')
  const documentOf = (path: string, id: string): string => {
    const found = golden(path)
      .split(/\n---\n/)
      .find((doc) => doc.includes(`id: ${id}\n`))
    if (found === undefined) throw new Error(`${id} 없음`)
    return found
  }

  it('G-ENG-O1-02는 통과하고, B의 subtotal 4001로 바꾼 사본은 불일치', () => {
    const original = documentOf('engine/23-o1-options.yaml', 'G-ENG-O1-02')
    ok(real(original))
    const wrong = original.replace('UC_B: { items: [b1/11], subtotal: 4000 }', 'UC_B: { items: [b1/11], subtotal: 4001 }')
    expect(wrong).not.toBe(original)
    const report = real(wrong)
    expect(report.totals.mismatch).toBe(1)
    expect(formatReport(report)).toContain('buyers.UC_B.subtotal')
  })

  it("comment-options '초코 과자 3'의 qty를 2로 바꾸면 불일치, 적지 않은 review 칸이 실제에 있으면 불일치", () => {
    const text = golden('parser/comment-options.yaml')
    const first = text.split(/\n---\n/)[1] as string
    ok(real(first))
    const wrong = first.replace('{ in: "초코 과자 3", out: { orders: [{ no: 11, qty: 3 }] } }', '{ in: "초코 과자 3", out: { orders: [{ no: 11, qty: 2 }] } }')
    expect(wrong).not.toBe(first)
    expect(real(wrong).totals.mismatch).toBe(1)
    const noOptions = first.replace('{ in: "흰색", out: { review: { reason: OPTION_MISSING, no: 31, options: { 색상: 흰색 } } } }', '{ in: "흰색", out: { review: { reason: OPTION_MISSING, no: 31 } } }')
    expect(noOptions).not.toBe(first)
    expect(real(noOptions).totals.mismatch).toBe(1)
  })

  it('reviews는 전체·순서까지, 적지 않은 칸은 실제에도 없어야, variants는 없는 변형이면 불일치', () => {
    const events = [shorts(), chatEv('20:00:05', 'm1', 'UC_A', '반바지'), chatEv('20:00:06', 'm2', 'UC_B', '반바지 M 20개')]
    const right = [
      { item: 'm1', reason: 'OPTION_MISSING', buyer: 'UC_A', product: 'b1/21' },
      { item: 'm2', reason: 'QTY_INVALID', buyer: 'UC_B', product: 'b1/21', options: { 사이즈: 'M' }, qty: 20 },
    ]
    ok(real(optionScenario(events, { reviews: right })))
    expect(real(optionScenario(events, { reviews: [...right].reverse() })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { reviews: [right[0]] })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { reviews: [right[0], { ...right[1], qty: undefined }] })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { reviews: [{ ...right[0], qty: 1 }, right[1]] })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { reviews: [{ ...right[0], buyer: 'UC_B' }, right[1]] })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { variants: { 'b1/21#XL': { status: 'OPEN' } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { variants: { 'b1/21#M': { status: 'SOLD' } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { variants: { 'b1/21#M': { stock: 2, confirmedUnits: 1 } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { variants: { 'b1/21#M': { winner: 'UC_A' } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { variants: { 'b1/21#M': { winners: ['UC_A'] } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { variants: { 'b1/21#M': { waitlist: ['UC_A'] } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario(events, { products: { 'b1/21': { confirmedUnits: 1 } } })).totals.mismatch).toBe(1)
    expect(real(optionScenario([...events, chatEv('20:00:07', 'm3', 'UC_C', '반바지 S')], { claims: [{ product: 'b1/21#S', buyer: 'UC_C', status: 'CONFIRMED', qty: 2 }] })).totals.mismatch).toBe(1)
    // 풀리지 않는 구매자 키
    expect(real(optionScenario(events, { reviews: [{ ...right[0], buyer: 'UC_Z' }, right[1]], variants: { 'b1/21#M': { winner: 'UC_Z', winners: ['UC_Z'], waitlist: ['UC_Z'] } } })).totals.mismatch).toBe(1)
  })

  it('옵션 상품에 상품 단위 winner·winners·waitlist·conflict를 적으면 러너 오류', () => {
    for (const field of [{ winner: null }, { winners: [] }, { waitlist: [] }, { conflict: false }]) {
      const report = real(optionScenario([shorts()], { products: { 'b1/21': field } }))
      expect(report.totals.runnerError, formatReport(report)).toBe(1)
      expect(formatReport(report)).toContain('variants로 적는다')
    }
    // 옵션 없는 상품에는 지금처럼 적는다
    ok(real(optionScenario([{ at: '20:00:00', type: 'product.register', b: 'b1', no: 11, name: '과자', price: 2000, stock: 3 }], { products: { 'b1/11': { winners: [], waitlist: [], conflict: false, confirmedUnits: 0 } } })))
  })
})

describe('AC-O1-33 효과 보고의 options (코어 어댑터)', () => {
  it('options를 적으면 그 변형 찜의 효과, 적지 않으면 (상품, 구매자)의 가장 최근 효과', () => {
    let state = initEngine({ broadcasts: [B1], settings: OPTIONS })
    const events = [
      { type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE },
      { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: 'A', text: '반바지 M' },
      { type: 'chat', b: 'b1', id: 'm2', ch: 'UC_A', nick: 'A', text: '반바지 L' },
    ]
    events.forEach((event, i) => {
      state = applyEvent(state, { seq: i + 1, at: i, ...event } as unknown as EngineEvent).state
    })
    const labels = listEffects(state).filter((e) => e.kind === 'PRINT_PRODUCT_LABEL')
    const report = (options?: Record<string, string>) => reportTarget(state, { seq: 9, at: 9, type: 'effect.labelPrinted', b: 'b1', no: 21, buyer: 'UC_A', ...(options === undefined ? {} : { options }) })
    expect(report({ 사이즈: 'M' })).toBe(labels[0]?.id)
    expect(report({ 사이즈: 'L' })).toBe(labels[1]?.id)
    expect(report()).toBe(labels[1]?.id)
    expect(report({ 사이즈: 'S' })).toBeUndefined()
  })
})
