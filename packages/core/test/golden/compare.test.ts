// AC-S00-25: 비교 규칙 — 러너는 틀린 기대에서 실제로 실패한다.
// 가짜 코어로 README 비교 규칙 표의 키마다 "맞는 기대는 통과, 기대 하나를 바꾸면 불일치"를 확인한다.
import { describe, expect, it } from 'vitest'
import { B1, run, scenario, suiteDoc } from './test-helpers.ts'
import type { GoldenSnapshot, ScenarioItemResult } from './types.ts'

const B2 = { id: 'b2', date: '2026-10-19', title: '2부' }
const EVENTS = [
  { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
  { at: '20:00:01', type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00' },
  { at: '20:00:02', type: 'sms', b: 'b1', ref: 's2', no: 15, received: '20:00' },
]

/** 실제 엔진이 보고했다고 칠 관찰 스냅샷 */
const SNAP: GoldenSnapshot = {
  // sms:s1은 UC_H로 합쳐졌다. sms:s2는 풀리지만 구매자 기록이 없다.
  buyerKeys: { UC_A: 'UC_A', UC_B: 'UC_B', UC_C: 'UC_C', UC_H: 'UC_H', 'sms:s1': 'UC_H', 'sms:s2': 'sms:s2' },
  products: {
    'b1/15': { status: 'SOLD', winners: ['UC_A'], waitlist: ['UC_B', 'UC_C'], conflict: false, price: 12000, priceHistory: [{ from: 10000, to: 12000 }] },
    'b1/16': { status: 'SOLD', winners: ['UC_A', 'UC_B'], waitlist: [], conflict: true, price: 3000, priceHistory: [] },
    'b1/17': { status: 'OPEN', winners: [], waitlist: [], conflict: false, price: 5000, priceHistory: [] },
  },
  buyers: {
    UC_A: { display: '길동이', nameHistory: ['홍길동', '길동이'], items: ['b1/15', 'b1/16'], subtotal: 15000, byBroadcast: { b1: 15000 }, phoneLast4: null },
    UC_H: { display: '문자찜', nameHistory: [], items: ['b2/1'], subtotal: 7000, byBroadcast: { b2: 7000 }, phoneLast4: '0000' },
  },
  settlements: {
    'UC_A@2026-10-18': { subtotal: 15000, shipping: 4000, adjustments: -1000, total: 18000, refundDue: 0, payment: 'PARTIAL' },
    'UC_H@2026-10-19': { subtotal: 7000, shipping: 4000, adjustments: 0, total: 11000, refundDue: 0, payment: 'UNPAID' },
  },
  effects: [
    { kind: 'POST_THANKS', status: 'DONE', target: 'LIVE_CHAT', product: 'b1/15', buyer: 'UC_A', text: '15번 핑크프릴 12,000원 길동이님 구매 감사합니다', confirmVersion: 1 },
    { kind: 'PRINT_PRODUCT_LABEL', status: 'PENDING', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 },
    { kind: 'POST_THANKS', status: 'CANCELLED', target: 'LIVE_CHAT', product: 'b1/16', buyer: 'UC_B', confirmVersion: 1 },
    { kind: 'POST_THANKS', status: 'PENDING', target: 'LIVE_CHAT', product: 'b1/16', buyer: 'UC_A', confirmVersion: 2 },
    { kind: 'POST_THANKS', status: 'SKIPPED', target: 'VIDEO_COMMENT', product: 'b1/16', buyer: 'UC_A', confirmVersion: 2 },
  ],
  claims: [
    { product: 'b1/15', buyer: 'UC_A', status: 'CONFIRMED' },
    { product: 'b1/15', buyer: 'UC_B', status: 'WAITLISTED' },
    { product: 'b1/18', buyer: 'UC_C', status: 'REJECTED', reason: 'EXPIRED' },
    { product: 'b1/18', buyer: 'UC_C', status: 'PENDING' },
    { product: 'b2/1', buyer: 'UC_H', status: 'CONFIRMED' },
  ],
  pending: { 'b1/18': ['UC_C', 'UC_B'] },
  cancelRequests: [
    { product: 'b1/15', buyer: 'UC_A' },
    { product: 'b1/16', buyer: 'UC_B' },
  ],
}

function runExpect(expectValue: Record<string, unknown>, snapshot: GoldenSnapshot = SNAP): ScenarioItemResult {
  const report = run(scenario({ broadcasts: [B1, B2], events: EVENTS, expect: expectValue }), { fake: { snapshot } })
  expect(report.readErrors, JSON.stringify(report.readErrors)).toEqual([])
  const item = report.items[0]
  if (item?.kind !== 'scenario') throw new Error('시나리오 결과 없음')
  return item
}

type Case = readonly [name: string, expect: Record<string, unknown>, failPaths: readonly string[] | null]

const P = (key: string, fields: Record<string, unknown>): Record<string, unknown> => ({ products: { [key]: fields } })
const BUY = (key: string, fields: Record<string, unknown>): Record<string, unknown> => ({ buyers: { [key]: fields } })
const ST = (key: string, fields: Record<string, unknown>): Record<string, unknown> => ({ settlements: { [key]: fields } })

const PENDING_OK = [
  { kind: 'PRINT_PRODUCT_LABEL', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 },
  { kind: 'POST_THANKS', target: 'LIVE_CHAT', product: 'b1/16', buyer: 'UC_A', confirmVersion: 2 },
]

const CASES: readonly Case[] = [
  // products.<p>.status
  ['status 같음', P('b1/15', { status: 'SOLD' }), null],
  ['status 다름', P('b1/15', { status: 'OPEN' }), ['products.b1/15.status']],
  // winner
  ['winner 같음', P('b1/15', { winner: 'UC_A' }), null],
  ['winner 다름', P('b1/15', { winner: 'UC_B' }), ['products.b1/15.winner']],
  ['winner null = 확정 없음', P('b1/17', { winner: null }), null],
  ['winner null인데 확정 있음', P('b1/15', { winner: null }), ['products.b1/15.winner']],
  ['winner 하나를 적었는데 확정이 2명', P('b1/16', { winner: 'UC_A' }), ['products.b1/16.winner']],
  ['winner를 적었는데 확정 없음', P('b1/17', { winner: 'UC_A' }), ['products.b1/17.winner']],
  // winners: 순서 무관, 정확히 같음
  ['winners 순서가 달라도 통과', P('b1/16', { winners: ['UC_B', 'UC_A'] }), null],
  ['winners 하나 빠짐', P('b1/16', { winners: ['UC_A'] }), ['products.b1/16.winners']],
  ['winners 다른 사람', P('b1/16', { winners: ['UC_A', 'UC_C'] }), ['products.b1/16.winners']],
  ['winners 중복은 집합이 아님', P('b1/16', { winners: ['UC_A', 'UC_A'] }), ['products.b1/16.winners']],
  // waitlist: 1순위부터 순서대로
  ['waitlist 같음', P('b1/15', { waitlist: ['UC_B', 'UC_C'] }), null],
  ['waitlist 순서 다름', P('b1/15', { waitlist: ['UC_C', 'UC_B'] }), ['products.b1/15.waitlist']],
  ['waitlist 하나 빠짐', P('b1/15', { waitlist: ['UC_B'] }), ['products.b1/15.waitlist']],
  ['waitlist [] = 대기 없음', P('b1/16', { waitlist: [] }), null],
  // conflict
  ['conflict 같음', P('b1/16', { conflict: true }), null],
  ['conflict 다름', P('b1/16', { conflict: false }), ['products.b1/16.conflict']],
  // exists
  ['exists true', P('b1/15', { exists: true }), null],
  ['exists false인데 있음', P('b1/15', { exists: false }), ['products.b1/15.exists']],
  ['exists false', P('b1/99', { exists: false }), null],
  ['exists true인데 없음', P('b1/99', { exists: true }), ['products.b1/99.exists']],
  ['없는 상품의 필드를 적음', P('b1/99', { status: 'OPEN' }), ['products.b1/99.status']],
  // price / priceHistory
  ['price 같음', P('b1/15', { price: 12000 }), null],
  ['price 다름', P('b1/15', { price: 10000 }), ['products.b1/15.price']],
  ['priceHistory 같음', P('b1/15', { priceHistory: [{ from: 10000, to: 12000 }] }), null],
  ['priceHistory 값 다름', P('b1/15', { priceHistory: [{ from: 10000, to: 13000 }] }), ['products.b1/15.priceHistory']],
  ['priceHistory 빈 목록 다름', P('b1/15', { priceHistory: [] }), ['products.b1/15.priceHistory']],
  ['적은 필드만 비교 (빈 상품 expect)', P('b1/15', {}), null],

  // buyers.<키>
  ['items 순서 무관 통과', BUY('UC_A', { items: ['b1/16', 'b1/15'] }), null],
  ['items 하나 빠짐', BUY('UC_A', { items: ['b1/15'] }), ['buyers.UC_A.items']],
  ['items 하나 더 있음', BUY('UC_A', { items: ['b1/15', 'b1/16', 'b1/17'] }), ['buyers.UC_A.items']],
  ['subtotal 같음', BUY('UC_A', { subtotal: 15000 }), null],
  ['subtotal 다름', BUY('UC_A', { subtotal: 15001 }), ['buyers.UC_A.subtotal']],
  ['byBroadcast 같음', BUY('UC_A', { byBroadcast: { b1: 15000 } }), null],
  ['byBroadcast 방송 하나 더', BUY('UC_A', { byBroadcast: { b1: 15000, b2: 0 } }), ['buyers.UC_A.byBroadcast']],
  ['byBroadcast 값 다름', BUY('UC_A', { byBroadcast: { b1: 1 } }), ['buyers.UC_A.byBroadcast']],
  ['display 같음', BUY('UC_A', { display: '길동이' }), null],
  ['display 다름', BUY('UC_A', { display: '홍길동' }), ['buyers.UC_A.display']],
  ['nameHistory 같음', BUY('UC_A', { nameHistory: ['홍길동', '길동이'] }), null],
  ['nameHistory 순서 다름', BUY('UC_A', { nameHistory: ['길동이', '홍길동'] }), ['buyers.UC_A.nameHistory']],
  // phoneLast4 (S03b, D-061): 지금의 구매자 자신의 뒤 4자리, 숫자 4자리 문자열 또는 null
  ['phoneLast4 null 같음', BUY('UC_A', { phoneLast4: null }), null],
  ['phoneLast4 null인데 값을 기대', BUY('UC_A', { phoneLast4: '0000' }), ['buyers.UC_A.phoneLast4']],
  ['phoneLast4 같음 ("0000" — 앞자리 0 유지)', BUY('UC_H', { phoneLast4: '0000' }), null],
  ['phoneLast4 다름', BUY('UC_H', { phoneLast4: '0001' }), ['buyers.UC_H.phoneLast4']],
  ['phoneLast4 값이 있는데 null을 기대', BUY('UC_H', { phoneLast4: null }), ['buyers.UC_H.phoneLast4']],
  ['phoneLast4 — 합친 키는 지금의 구매자 자신의 값', BUY('sms:s1', { phoneLast4: '0000' }), null],
  ['구매자 키 풀기 — 합친 구매자', BUY('sms:s1', { items: ['b2/1'], subtotal: 7000 }), null],
  ['구매자 키 풀기 — 합친 구매자 값 다름', BUY('sms:s1', { subtotal: 0 }), ['buyers.sms:s1.subtotal']],
  ['풀 수 없는 구매자 키', BUY('UC_Z', { subtotal: 0 }), ['buyers.UC_Z']],
  ['풀리지만 구매자 기록 없음', BUY('sms:s2', { subtotal: 0 }), ['buyers.sms:s2']],

  // settlements.<키>@<날짜>
  ['정산 금액·상태 같음', ST('UC_A@2026-10-18', { subtotal: 15000, shipping: 4000, adjustments: -1000, total: 18000, refundDue: 0, payment: 'PARTIAL' }), null],
  ['정산 subtotal 다름', ST('UC_A@2026-10-18', { subtotal: 1 }), ['settlements.UC_A@2026-10-18.subtotal']],
  ['정산 shipping 다름', ST('UC_A@2026-10-18', { shipping: 0 }), ['settlements.UC_A@2026-10-18.shipping']],
  ['정산 adjustments 다름', ST('UC_A@2026-10-18', { adjustments: 0 }), ['settlements.UC_A@2026-10-18.adjustments']],
  ['정산 total 다름', ST('UC_A@2026-10-18', { total: 19000 }), ['settlements.UC_A@2026-10-18.total']],
  ['정산 refundDue 다름', ST('UC_A@2026-10-18', { refundDue: 1000 }), ['settlements.UC_A@2026-10-18.refundDue']],
  ['정산 payment 다름', ST('UC_A@2026-10-18', { payment: 'PAID' }), ['settlements.UC_A@2026-10-18.payment']],
  ['정산 키의 구매자도 풀어서 찾는다', ST('sms:s1@2026-10-19', { total: 11000 }), null],
  ['품목 없는 묶음은 금액 전부 0, UNPAID', ST('UC_A@2026-10-19', { subtotal: 0, shipping: 0, adjustments: 0, total: 0, refundDue: 0, payment: 'UNPAID' }), null],
  ['품목 없는 묶음에 금액을 기대', ST('UC_A@2026-10-19', { total: 4000 }), ['settlements.UC_A@2026-10-19.total']],
  ['품목 없는 묶음에 PAID를 기대', ST('UC_A@2026-10-19', { payment: 'PAID' }), ['settlements.UC_A@2026-10-19.payment']],
  ['정산 키의 구매자를 풀 수 없음', ST('UC_Z@2026-10-18', { total: 0 }), ['settlements.UC_Z@2026-10-18']],

  // effects: 적은 항목마다 서로 다른 효과 하나씩, 실행·취소 여부 무관
  ['effects 모든 필드 같음', { effects: [{ kind: 'POST_THANKS', target: 'LIVE_CHAT', product: 'b1/15', buyer: 'UC_A', text: '15번 핑크프릴 12,000원 길동이님 구매 감사합니다' }] }, null],
  ['effects 적은 필드만 비교', { effects: [{ kind: 'PRINT_PRODUCT_LABEL', product: 'b1/15' }] }, null],
  ['effects 취소된 효과도 센다', { effects: [{ kind: 'POST_THANKS', product: 'b1/16', buyer: 'UC_B' }] }, null],
  ['effects 같은 항목 두 번이면 효과도 두 개 있어야 함', { effects: [{ kind: 'PRINT_PRODUCT_LABEL' }, { kind: 'PRINT_PRODUCT_LABEL' }] }, ['effects[1]']],
  ['effects POST_THANKS 4개 = 실제 4개', { effects: [{ kind: 'POST_THANKS' }, { kind: 'POST_THANKS' }, { kind: 'POST_THANKS' }, { kind: 'POST_THANKS' }] }, null],
  ['effects POST_THANKS 5개 > 실제 4개', { effects: Array.from({ length: 5 }, () => ({ kind: 'POST_THANKS' })) }, ['effects[4]']],
  ['effects 문구 다름', { effects: [{ kind: 'POST_THANKS', product: 'b1/15', text: '15번 핑크프릴 10,000원 길동이님 구매 감사합니다' }] }, ['effects[0]']],
  ['effects 구매자 다름', { effects: [{ kind: 'PRINT_PRODUCT_LABEL', buyer: 'UC_B' }] }, ['effects[0]']],
  ['effects 확정 버전 다름', { effects: [{ kind: 'PRINT_PRODUCT_LABEL', confirmVersion: 2 }] }, ['effects[0]']],
  ['effects 대상 다름', { effects: [{ kind: 'POST_THANKS', product: 'b1/15', target: 'VIDEO_COMMENT' }] }, ['effects[0]']],
  ['effects 서로 다른 효과로 짝짓기 (최대 매칭)', { effects: [{ kind: 'POST_THANKS', product: 'b1/16' }, { kind: 'POST_THANKS', buyer: 'UC_B' }] }, null],

  // effectCounts: 종류별 정확한 개수
  ['effectCounts 같음', { effectCounts: { POST_THANKS: 4, PRINT_PRODUCT_LABEL: 1 } }, null],
  ['effectCounts 0 = 하나도 없음', { effectCounts: { VOID_LABEL: 0, NOTIFY: 0 } }, null],
  ['effectCounts 0을 적었는데 하나 있음', { effectCounts: { PRINT_PRODUCT_LABEL: 0 } }, ['effectCounts.PRINT_PRODUCT_LABEL']],
  ['effectCounts 개수 다름', { effectCounts: { POST_THANKS: 3 } }, ['effectCounts.POST_THANKS']],

  // pendingEffects: 아직 실행 대상인 효과 전체와 정확히 같음
  ['pendingEffects 정확히 같음', { pendingEffects: PENDING_OK }, null],
  ['pendingEffects 순서 무관', { pendingEffects: [...PENDING_OK].reverse() }, null],
  ['pendingEffects 실제에 하나 더 있음', { pendingEffects: [PENDING_OK[0]] }, ['pendingEffects']],
  ['pendingEffects 기대가 하나 더 많음', { pendingEffects: [...PENDING_OK, { kind: 'VOID_LABEL' }] }, ['pendingEffects']],
  ['pendingEffects 확정 버전 다름', { pendingEffects: [PENDING_OK[0], { ...PENDING_OK[1], confirmVersion: 1 }] }, ['pendingEffects']],
  ['pendingEffects [] 인데 실행 대상 있음', { pendingEffects: [] }, ['pendingEffects']],

  // claims: 같은 (상품, 구매자)의 가장 최근 찜
  ['claims 가장 최근 찜으로 판단', { claims: [{ product: 'b1/18', buyer: 'UC_C', status: 'PENDING' }] }, null],
  ['claims 예전 찜 상태를 기대', { claims: [{ product: 'b1/18', buyer: 'UC_C', status: 'REJECTED' }] }, ['claims[0].status']],
  ['claims 사유 비교', { claims: [{ product: 'b1/15', buyer: 'UC_B', status: 'WAITLISTED', reason: 'SOLD_OUT' }] }, ['claims[0].reason']],
  ['claims 사유를 안 적으면 상태만', { claims: [{ product: 'b1/15', buyer: 'UC_B', status: 'WAITLISTED' }] }, null],
  ['claims 찜 없음', { claims: [{ product: 'b1/17', buyer: 'UC_A', status: 'CONFIRMED' }] }, ['claims[0]']],
  ['claims 구매자 키 풀기', { claims: [{ product: 'b2/1', buyer: 'sms:s1', status: 'CONFIRMED' }] }, null],

  // pending: 판정 순위 순서대로 정확히 같음
  ['pending 같음', { pending: { 'b1/18': ['UC_C', 'UC_B'] } }, null],
  ['pending 순서 다름', { pending: { 'b1/18': ['UC_B', 'UC_C'] } }, ['pending.b1/18']],
  ['pending [] = 없음', { pending: { 'b1/19': [] } }, null],
  ['pending 없는데 기대', { pending: { 'b1/19': ['UC_A'] } }, ['pending.b1/19']],

  // sameBuyer
  ['sameBuyer 같은 구매자', { sameBuyer: [['sms:s1', 'UC_H']] }, null],
  ['sameBuyer 다른 구매자', { sameBuyer: [['UC_A', 'UC_B']] }, ['sameBuyer[0]']],
  ['sameBuyer 풀 수 없는 키', { sameBuyer: [['UC_Z', 'UC_Y']] }, ['sameBuyer[0]']],

  // claimCount
  ['claimCount 같음', { claimCount: 5 }, null],
  ['claimCount 다름', { claimCount: 4 }, ['claimCount']],

  // cancelRequests: 처리 대기 요청 전체, 순서 무관
  ['cancelRequests 순서 무관 통과', { cancelRequests: [{ product: 'b1/16', buyer: 'UC_B' }, { product: 'b1/15', buyer: 'UC_A' }] }, null],
  ['cancelRequests 하나 빠짐', { cancelRequests: [{ product: 'b1/15', buyer: 'UC_A' }] }, ['cancelRequests']],
  ['cancelRequests 하나 더', { cancelRequests: [{ product: 'b1/15', buyer: 'UC_A' }, { product: 'b1/16', buyer: 'UC_B' }, { product: 'b1/17', buyer: 'UC_C' }] }, ['cancelRequests']],
  ['cancelRequests [] 인데 요청 있음', { cancelRequests: [] }, ['cancelRequests']],
]

describe('expect 비교 규칙 — 키마다 맞으면 통과, 하나 바꾸면 불일치 (AC-S00-25)', () => {
  it.each(CASES)('%s', (_name, expectValue, failPaths) => {
    const item = runExpect(expectValue)
    if (failPaths === null) {
      expect(item.problems).toEqual([])
      expect(item.status).toBe('pass')
    } else {
      expect(item.status).toBe('mismatch')
      expect(item.problems.map((p) => p.path)).toEqual(failPaths)
      for (const problem of item.problems) {
        expect(problem).toHaveProperty('expected')
        expect(problem).toHaveProperty('actual')
      }
    }
  })

  it('적지 않은 상품·구매자는 검사하지 않는다', () => {
    // 스냅샷에는 b1/16·UC_H 등이 있지만 expect는 b1/15만 적었다
    expect(runExpect(P('b1/15', { winner: 'UC_A' })).status).toBe('pass')
    expect(runExpect({}).status).toBe('pass')
  })

  it('중간 검사만 틀려도 시나리오 실패 (위치 events[n])', () => {
    const report = run(
      scenario({
        broadcasts: [B1, B2],
        events: [...EVENTS, { type: 'assert', expect: P('b1/15', { status: 'OPEN' }) }],
        expect: P('b1/15', { status: 'SOLD' }),
      }),
      { fake: { snapshot: SNAP } },
    )
    const item = report.items[0]
    expect(item?.status).toBe('mismatch')
    expect(item?.problems).toEqual([{ where: 'events[3]', path: 'products.b1/15.status', expected: 'OPEN', actual: 'SOLD' }])
    expect(report.ok).toBe(false)
  })

  it('중간 검사는 그 시점의 상태로 비교한다', () => {
    const opened: GoldenSnapshot = { ...SNAP, products: { 'b1/15': { ...(SNAP.products['b1/15'] as NonNullable<(typeof SNAP.products)['b1/15']>), status: 'OPEN', winners: [] } } }
    const report = run(
      scenario({
        broadcasts: [B1, B2],
        events: [EVENTS[0], { type: 'assert', expect: P('b1/15', { status: 'OPEN', winner: null }) }, EVENTS[1], EVENTS[2]],
        expect: P('b1/15', { status: 'SOLD', winner: 'UC_A' }),
      }),
      { fake: { snapshot: (events) => (events.length < 2 ? opened : SNAP) } },
    )
    expect(report.items[0]?.status).toBe('pass')
  })
})

describe('파서 out 비교 (README "파서 사례 형식")', () => {
  const chatResults: Record<string, unknown> = {
    a: { claims: [15], cancels: [], mentions: [] },
    b: { claims: [15, 28], cancels: [], mentions: [] },
    c: { claims: [], cancels: [], mentions: [] },
    d: { claims: [15] },
    e: '맵 아님',
  }
  const chat = (text: string): unknown => chatResults[text]

  it.each([
    ['없는 키는 빈 배열', 'a', { claims: [15] }, null],
    ['빈 배열을 적어도 같음', 'a', { claims: [15], cancels: [] }, null],
    ['{} = 아무것도 없음', 'c', {}, null],
    ['{}인데 주문 있음', 'a', {}, ['out.claims']],
    ['배열 순서가 다르면 불일치', 'b', { claims: [28, 15] }, ['out.claims']],
    ['실제 결과에 없는 키도 빈 배열', 'd', { claims: [15] }, null],
    ['주문을 언급으로 기대', 'a', { mentions: [15] }, ['out.claims', 'out.mentions']],
    ['결과가 맵이 아님', 'e', {}, ['out']],
  ] as const)('chat: %s', (_name, input, out, failPaths) => {
    const report = run(suiteDoc('chat', [{ in: input, out }]), { fake: { parser: { chat } } })
    const item = report.items[0]
    if (failPaths === null) expect(item?.status).toBe('pass')
    else {
      expect(item?.status).toBe('mismatch')
      expect(item?.problems.map((p) => p.path)).toEqual(failPaths)
    }
  })

  const amountResults: Record<string, unknown> = { zero: 0, nil: null, undef: undefined, ten: 10, text: '10' }
  it.each([
    ['null과 null', 'nil', null, true],
    ['숫자와 숫자', 'ten', 10, true],
    ['0을 null로 기대', 'zero', null, false],
    ['null을 0으로 기대', 'nil', 0, false],
    ['undefined는 null이 아니다', 'undef', null, false],
    ['문자열 "10"은 숫자 10이 아니다', 'text', 10, false],
    ['다른 숫자', 'ten', 100, false],
  ] as const)('amount·korean-number: %s', (_name, input, out, pass) => {
    for (const suite of ['amount', 'korean-number'] as const) {
      if (suite === 'korean-number' && out === 0) continue // korean-number out은 1 이상 (형식 계약)
      const report = run(suiteDoc(suite, [{ in: input, out }]), {
        fake: { parser: { amount: (t) => amountResults[t], koreanNumber: (t) => amountResults[t] } },
      })
      expect(report.readErrors).toEqual([])
      expect(report.items[0]?.status).toBe(pass ? 'pass' : 'mismatch')
    }
  })

  const quickResults: Record<string, unknown> = {
    ok: { no: 15, name: '핑크', price: 10000 },
    extra: { no: 15, name: '핑크', price: 10000, memo: '덤' },
    undef: { error: 'PRICE_MISSING', no: 15, name: '핑크', price: undefined },
    err: { error: 'NUMBER_MISSING' },
  }
  it.each([
    ['정확히 같음', 'ok', { no: 15, name: '핑크', price: 10000 }, null],
    ['out에 없는 키가 실제에 있으면 불일치', 'extra', { no: 15, name: '핑크', price: 10000 }, ['out.memo']],
    ['undefined 값은 없는 키로 본다', 'undef', { error: 'PRICE_MISSING', no: 15, name: '핑크' }, null],
    ['기대한 키가 실제에 없음', 'err', { error: 'NUMBER_MISSING', no: 15 }, ['out.no']],
    ['값 다름', 'ok', { no: 15, name: '핑크', price: 9000 }, ['out.price']],
  ] as const)('quick-input: %s', (_name, input, out, failPaths) => {
    const report = run(suiteDoc('quick-input', [{ in: input, out }]), { fake: { parser: { quickInput: (t) => quickResults[t] } } })
    const item = report.items[0]
    if (failPaths === null) expect(item?.status).toBe('pass')
    else {
      expect(item?.status).toBe('mismatch')
      expect(item?.problems.map((p) => p.path)).toEqual(failPaths)
    }
  })

  it('suite settings는 DOMAIN_RULES 키(점 표기)로 바꿔 넘긴다', () => {
    const seen: unknown[] = []
    run(
      [
        { path: 'a.yaml', text: suiteDoc('chat', [{ in: '15', out: {} }], { parseMode: 'LOOSE', multiNumber: 'FIRST', maxNumber: 50 }) },
        { path: 'b.yaml', text: suiteDoc('quick-input', [{ in: '15', out: { error: 'EMPTY' } }], { unit: 'WON' }) },
        { path: 'c.yaml', text: suiteDoc('amount', [{ in: '15', out: null }]) },
      ],
      {
        fake: {
          parser: {
            chat: (_t, s) => seen.push(s),
            quickInput: (_t, s) => seen.push(s),
            amount: (_t, s) => seen.push(s),
          },
        },
      },
    )
    expect(seen).toEqual([{ 'claim.parseMode': 'LOOSE', 'claim.multiNumber': 'FIRST', 'claim.maxNumber': 50 }, { 'price.unit': 'WON' }, {}])
  })
})
