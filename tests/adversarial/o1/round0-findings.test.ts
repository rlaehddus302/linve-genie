// O1 라운드 0 적대 시험 (test-domain): 재현한 버그(실패 시험)와, 통과했지만 다시 깨지기 쉬운 경계(회귀 시험).
// 지적 ID는 시험 이름에 있다. 기대값은 DOMAIN_RULES R-5·R-8·R-9·R-10·R-19·R-20 문장에서 정했다.
import { listCancelRequests, parseChat, parseOptionComment } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { OPT, act, chat, checkInvariants, getProduct, listClaims, listReviews, play, shorts, type Ev } from './helpers.ts'

const renumber = (from: number, to: number): Ev => ({ type: 'product.renumber', b: 'b1', from, to })
const block = (buyer: string): Ev => ({ type: 'host.blockBuyer', buyer, reason: '사유' })
const claimsOf = (p: ReturnType<typeof play>) => listClaims(p.state).map((c) => [c.key, c.buyer, c.status, c.reason])

/**
 * 공개 전(READY) 옵션 상품에 이름·옵션으로 찜(변형 보류 찜 b1/21#M)이 있는 채로 판매자가 번호를 바꾸면(21 → 25),
 * R-10 1 "번호 a의 보류 찜은 번호 a의 보류 찜으로 그대로 남는다"대로 21번에 변형 M의 보류 찜이 남는다. 그런데 21번에는 이제 상품(변형 자리)이 없다.
 */
const orphan = (): Ev[] => [shorts({ status: 'READY' }), chat('C', '반바지 M'), renumber(21, 25)]

describe('TD-O1-001: 번호를 바꾼 뒤 이전 번호에 남은 변형 보류 찜 — 차단·합치기가 엔진 오류(CorruptStateError)로 실패한다', () => {
  it('차단: C의 보류 찜은 REJECTED(BLOCKED)로 끝나고 오류가 나지 않는다 (R-9 "차단하는 순간 그 구매자의 대기·보류·충돌 찜은 모두 REJECTED(BLOCKED)")', () => {
    const p = play([...orphan(), block('C')])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'REJECTED', 'BLOCKED']])
    expect(checkInvariants(p.state)).toEqual([])
  })

  it('21번에 다른 옵션의 상품을 새로 등록한 뒤 차단해도 오류가 나지 않는다', () => {
    const other: Ev = { type: 'product.register', b: 'b1', no: 21, name: '치마', price: 9000, status: 'READY', options: [{ name: '색', choices: [{ label: '빨강' }, { label: '파랑' }] }] }
    const p = play([...orphan(), other, block('C')])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'REJECTED', 'BLOCKED']])
  })

  it('합치기: 둘 다 그런 보류 찜(같은 변형)을 가진 구매자를 합쳐도 오류가 나지 않고, 뒤 찜이 DUPLICATE가 된다 (R-11 — 앞선 쪽은 판정 순위)', () => {
    const p = play([shorts({ status: 'READY' }), chat('C', '반바지 M'), chat('D', '반바지 M'), renumber(21, 25), { type: 'buyer.merge', from: 'D', into: 'C', reason: '같은 사람' }])
    expect(listClaims(p.state).map((c) => [c.key, c.buyer, c.currentBuyer, c.status])).toEqual([
      ['b1/21#M', 'C', 'C', 'PENDING'],
      ['b1/21#M', 'D', 'C', 'DUPLICATE'],
    ])
    expect(checkInvariants(p.state)).toEqual([])
  })

  it('보류 찜 하나만 옮기는 합치기는 지금도 된다 (회귀)', () => {
    const p = play([...orphan(), chat('D', '안녕'), { type: 'buyer.merge', from: 'C', into: 'D', reason: '같은 사람' }])
    expect(listClaims(p.state).map((c) => [c.key, c.buyer, c.currentBuyer, c.status])).toEqual([['b1/21#M', 'C', 'D', 'PENDING']])
  })
})

describe('TD-O1-002: 번호를 바꾼 뒤 이전 번호에 남은 변형 보류 찜을 방송자·시청자 취소로 끝낼 수 없다', () => {
  // R-5 "보류 찜은 방송자 취소·무효와 시청자 취소(R-8)…로도 끝난다", R-19 "적지 않았는데 그 구매자의 그 상품 활성 찜이 하나뿐이면 그 찜"
  it('host.cancel(옵션 없이): C의 21번 활성 찜은 그 보류 찜 하나뿐이므로 CANCELLED', () => {
    const p = play([...orphan(), act('host.cancel', { no: 21, buyer: 'C' })])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'CANCELLED', null]])
  })

  it('host.reject(옵션 없이): REJECTED(BY_HOST)', () => {
    const p = play([...orphan(), act('host.reject', { no: 21, buyer: 'C' })])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'REJECTED', 'BY_HOST']])
  })

  it('시청자 취소 "21 취소"(cancel.buyerChat=AUTO): 보류 찜은 잠금이 없어 바로 CANCELLED (R-8, R-20 8 — 그 채널의 그 번호 활성 찜이 하나)', () => {
    const p = play([...orphan(), chat('C', '21 취소')], { ...OPT, 'cancel.buyerChat': 'AUTO' })
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'CANCELLED', null]])
  })
})

describe('TD-O1-003: 번호 문법 메시지가 multiNumber=IGNORE·번호 범위 때문에 주문이 아니게 되면, 옵션 해석으로 넘어가 자동 주문이 된다', () => {
  // R-20 2 "메시지 전체가 R-3 STRICT 문법이면 그 결과를 쓴다 — claim.multiNumber·번호 개수 상한·범위 규칙 포함"
  const tee = [{ no: 22, name: '반팔티', options: [{ name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105' }] }] }]
  it.each([
    ['multiNumber=IGNORE', { 'claim.multiNumber': 'IGNORE' as const }],
    ['maxNumber=99 (100은 범위 밖)', { 'claim.maxNumber': 99 }],
  ])('"22 100" (%s) → STRICT 결과 그대로: 주문·확인 필요 없음, 언급은 parseChat과 같다', (_label, settings) => {
    const out = parseOptionComment('22 100', tee, null, settings)
    expect(out).toEqual({ orders: [], cancels: [], mentions: parseChat('22 100', settings).mentions, review: null })
  })

  it('같은 메시지가 기본 설정(ALL·999)에서는 확인 필요 OPTION_MISSING — 설정에 따라 자동 주문이 되면 안 된다 (회귀)', () => {
    expect(parseOptionComment('22 100', tee, null, {}).review).toEqual({ reason: 'OPTION_MISSING', no: 22 })
  })
})

// ── 통과한 공격 중 다시 깨지기 쉬운 것 (회귀) ─────────────────────────────

describe('O1 회귀: 확인 필요 항목과 재수신 (INV-3·INV-12)', () => {
  it('지운 항목·바로잡은 항목의 메시지가 다시 와도 항목이 되살아나지 않고 찜도 생기지 않는다', () => {
    const m1 = chat('A', '반바지')
    const m2 = chat('B', '반바지')
    const p = play([shorts(), m1, m2, act('host.dismissReview', { item: m1.id }), act('host.resolveReview', { item: m2.id, no: 21, qty: 1, options: { 사이즈: 'M' } }), m1, { ...m2, text: '반바지 L' }])
    expect(listReviews(p.state)).toEqual([])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'B', 'CONFIRMED', null]])
  })

  it('같은 출처를 두 번 바로잡으면 두 번째는 아무 일도 없다', () => {
    const m = chat('A', '반바지')
    const p = play([shorts(), m, act('host.resolveReview', { item: m.id, no: 21, qty: 1, options: { 사이즈: 'M' } }), act('host.resolveReview', { item: m.id, no: 21, qty: 1, options: { 사이즈: 'L' } })])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'A', 'CONFIRMED', null]])
  })
})

describe('O1 회귀: 바로잡기는 지금의 구매자로 같은 변형을 본다 (R-11, R-20 7)', () => {
  it('A를 B 아래로 합친 뒤 A의 항목을 B가 이미 가진 변형으로 바로잡으면 아무 일도 없고 항목이 남는다. 다른 변형이면 찜이 생긴다', () => {
    const m = chat('A', '반바지')
    const merged: Ev[] = [shorts(), m, chat('B', '반바지 M'), { type: 'buyer.merge', from: 'A', into: 'B', reason: '같은 사람' }]
    const same = play([...merged, act('host.resolveReview', { item: m.id, no: 21, qty: 1, options: { 사이즈: 'M' } })])
    expect(listReviews(same.state).map((r) => [r.item, r.buyer, r.currentBuyer])).toEqual([[m.id, 'A', 'B']])
    const other = play([...merged, act('host.resolveReview', { item: m.id, no: 21, qty: 1, options: { 사이즈: 'L' } })])
    expect(listClaims(other.state).map((c) => [c.key, c.buyer, c.currentBuyer, c.status])).toEqual([
      ['b1/21#M', 'B', 'B', 'CONFIRMED'],
      ['b1/21#L', 'A', 'B', 'CONFIRMED'],
    ])
  })
})

describe('O1 회귀: 승계 결정 필요(ASK)와 수량', () => {
  const settings = { ...OPT, 'cancel.succession': 'ASK' as const }
  const snack = (stock: number): Ev => ({ type: 'product.register', b: 'b1', no: 11, name: '초코 과자', price: 2000, stock, aliases: ['초코'] })
  it('수량 2 1등을 수량 1 배정으로 교체(CANCEL)하면 남은 1은 승계하지 않고 표시를 남긴다 — 다음 수량 1 찜은 대기', () => {
    const p = play([snack(2), chat('A', '초코 2개'), chat('B', '초코'), chat('D', '안녕'), act('host.assign', { no: 11, buyer: 'D', qty: 1, replace: 'A', replaceTo: 'CANCEL' }), chat('E', '초코')], settings)
    const product = getProduct(p.state, 'b1', 11)
    expect([product?.winners, product?.waitlist, product?.awaitingSuccession, product?.confirmedUnits]).toEqual([['D'], ['B', 'E'], true, 1])
  })

  it('표시가 있는 상품의 바로잡기 수량 1은 원래 순위 자리로 대기한다(앞선 메시지면 기존 대기자 앞)', () => {
    const m = chat('R', '초코 과자 99')
    const p = play([snack(3), m, chat('A', '초코 3개'), chat('B', '초코'), act('host.cancel', { no: 11, buyer: 'A' }), act('host.resolveReview', { item: m.id, no: 11, qty: 1 })], settings)
    expect(getProduct(p.state, 'b1', 11)?.waitlist).toEqual(['R', 'B'])
  })
})

describe('O1 회귀: 시청자 취소 — 변형 둘이면 요청 (R-20 8)', () => {
  it('공개 전 두 변형 보류 찜에 "21 취소"(AUTO) → 바로 취소하지 않고 변형을 고르는 요청 하나', () => {
    const p = play([shorts({ status: 'READY' }), chat('C', '반바지 M'), chat('C', '반바지 L'), chat('C', '21 취소')], { ...OPT, 'cancel.buyerChat': 'AUTO' })
    expect(claimsOf(p).map((c) => c[2])).toEqual(['PENDING', 'PENDING'])
    expect(listCancelRequests(p.state).map((r) => [r.product, r.buyer, r.chooseVariant])).toEqual([['b1/21', 'C', true]])
  })
})
