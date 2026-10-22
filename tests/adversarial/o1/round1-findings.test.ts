// O1 라운드 1 적대 시험 (test-domain): 수정(ba7ef49) 뒤에도 남은 구멍과, 수정이 지킨 경계의 회귀.
// 지적 ID는 시험 이름에 있다. 기대값은 DOMAIN_RULES R-5·R-8·R-19 "수량"(방송자 조치)·R-20 2·8 문장에서 정했다.
import { listCancelRequests, parseChat, parseOptionComment } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { OPT, act, chat, checkInvariants, listClaims, play, problems, shorts, type Ev } from './helpers.ts'

const renumber = (from: number, to: number): Ev => ({ type: 'product.renumber', b: 'b1', from, to })
const claimsOf = (p: ReturnType<typeof play>) => listClaims(p.state).map((c) => [c.key, c.buyer, c.status, c.reason])
const AUTO = { ...OPT, 'cancel.buyerChat': 'AUTO' as const }

/**
 * 공개 전(READY) 옵션 상품에 한 시청자가 두 변형을 이름으로 주문(반바지 M·반바지 L — 보류 찜 둘)한 뒤 판매자가 번호를 바꾸면(21 → 25),
 * R-10 1대로 21번에 C의 변형 보류 찜 둘이 남는다. 라운드 0의 TD-O1-002는 보류 찜이 하나일 때만 고쳐졌다:
 * 둘이면 R-19 "적지 않았는데 둘 이상이면 아무 일도 없다"라서 변형을 options로 골라야 하는데, 21번에 상품이 없다고 options가 입력 오류다.
 * 그래서 판매자가 그 보류 찜을 하나씩 끝낼 방법이 없다(차단만 된다). 시청자 취소 요청도 승인할 수 없다.
 */
const twoOrphans = (): Ev[] => [shorts({ status: 'READY' }), chat('C', '반바지 M'), chat('C', '반바지 L'), renumber(21, 25)]
const M = { 사이즈: 'M' }

describe('TD-O1-002 (라운드 1): 번호를 바꾼 뒤 이전 번호에 같은 구매자의 변형 보류 찜이 둘 남으면 하나씩 끝낼 수 없다', () => {
  it('전제(회귀): 옵션 없이 host.cancel은 활성 찜이 둘이라 아무 일도 없다 (R-19)', () => {
    const p = play([...twoOrphans(), act('host.cancel', { no: 21, buyer: 'C' })])
    expect(claimsOf(p)).toEqual([
      ['b1/21#M', 'C', 'PENDING', 'UNOPENED'],
      ['b1/21#L', 'C', 'PENDING', 'UNOPENED'],
    ])
  })

  it.each([
    ['host.cancel', 'CANCELLED', null],
    ['host.reject', 'REJECTED', 'BY_HOST'],
  ])('%s에 options {사이즈: M}을 적으면 입력 오류가 아니고 M 보류 찜만 끝난다 (R-5 "보류 찜은 방송자 취소·무효로도 끝난다")', (type, status, reason) => {
    const p0 = play(twoOrphans())
    const event = act(type, { no: 21, buyer: 'C', options: M })
    expect(problems(p0.state, event, 5)).toEqual([])
    const p = play([...twoOrphans(), event])
    expect(claimsOf(p)).toEqual([
      ['b1/21#M', 'C', status, reason],
      ['b1/21#L', 'C', 'PENDING', 'UNOPENED'],
    ])
    expect(checkInvariants(p.state)).toEqual([])
  })

  it('시청자 "21 취소"(AUTO)는 변형을 고르는 요청이 되는데(R-20 8), 판매자가 options로 승인할 수 있어야 한다 — 지금은 입력 오류', () => {
    const asked = play([...twoOrphans(), chat('C', '21 취소')], AUTO)
    expect(listCancelRequests(asked.state).map((r) => [r.product, r.buyer, r.chooseVariant])).toEqual([['b1/21', 'C', true]])
    const approve = act('host.approveCancel', { no: 21, buyer: 'C', options: M })
    expect(problems(asked.state, approve, 6)).toEqual([])
    const p = play([...twoOrphans(), chat('C', '21 취소'), approve], AUTO)
    expect(claimsOf(p)).toEqual([
      ['b1/21#M', 'C', 'CANCELLED', null],
      ['b1/21#L', 'C', 'PENDING', 'UNOPENED'],
    ])
  })

  it('회귀: 차단은 둘 다 REJECTED(BLOCKED)로 끝낸다 (TD-O1-001 수정)', () => {
    const p = play([...twoOrphans(), { type: 'host.blockBuyer', buyer: 'C', reason: '사유' }])
    expect(claimsOf(p)).toEqual([
      ['b1/21#M', 'C', 'REJECTED', 'BLOCKED'],
      ['b1/21#L', 'C', 'REJECTED', 'BLOCKED'],
    ])
  })
})

describe('O1 회귀 (라운드 1): 남은 변형 보류 찜의 자리', () => {
  it('번호를 되돌린 뒤 공개하면 같은 변형으로 확정된다 — 남긴 자리가 새 상품의 자리를 가리지 않는다', () => {
    const p = play([shorts({ status: 'READY' }), chat('C', '반바지 M'), renumber(21, 25), renumber(25, 21), { type: 'product.open', b: 'b1', no: 21 }])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'CONFIRMED', null]])
  })

  it('남은 자리가 있는 번호로 다른 옵션 상품을 옮겨 와 공개하면, 그 상품의 변형으로 판정되고 조회 변형 목록에 남은 자리가 나오지 않는다', () => {
    const p = play([shorts({ status: 'READY' }), chat('C', '반바지 M'), renumber(21, 25), shorts({ no: 30, name: '치마', status: 'READY', options: [{ name: '색', choices: [{ label: '빨강' }, { label: '파랑' }] }] }), renumber(30, 21), { type: 'product.open', b: 'b1', no: 21 }])
    expect(claimsOf(p)).toEqual([['b1/21#M', 'C', 'REJECTED', 'OPTION_MISSING']])
    expect(listClaims(p.state).filter((c) => c.status === 'CONFIRMED')).toEqual([])
    expect(checkInvariants(p.state)).toEqual([])
  })
})

describe('O1 회귀 (라운드 1): 번호 문법이면 STRICT 결과 (TD-O1-003 수정)', () => {
  const tee = [{ no: 22, name: '반팔티', options: [{ name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105' }] }] }]
  it.each([
    ['22 1000', {}],
    ['22 100', { 'claim.multiNumber': 'IGNORE' as const }],
    ['22 100', { 'claim.multiNumber': 'FIRST' as const, 'claim.maxNumber': 99 }],
    ['21 22 23 24 25 26 27 28 29 30 31', {}],
  ])('"%s" %o → 주문·확인 필요 없이 parseChat 언급 그대로', (text, settings) => {
    const strict = parseChat(text, settings)
    expect(strict.claims).toEqual([])
    expect(parseOptionComment(text, tee, null, settings)).toEqual({ orders: [], cancels: [], mentions: strict.mentions, review: null })
  })

  it('번호 문법이 아닌 옵션 댓글은 그대로 옵션 해석 (IGNORE여도 "반팔티 100" → 주문)', () => {
    expect(parseOptionComment('반팔티 100', tee, null, { 'claim.multiNumber': 'IGNORE' }).orders).toEqual([{ no: 22, options: { 사이즈: '100' }, qty: 1 }])
  })
})
