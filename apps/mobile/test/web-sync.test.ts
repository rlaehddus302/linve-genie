// 앱이 따로 든 규칙이 웹과 같은지 (APP-01 AC5 "같은 낱말", D-088): 낱말 표·구매자 이름 표기·알림 수·찜 상태 낱말·증분 덮기·빠른 입력 읽기.
// 웹 모듈은 코어 전체를 불러오므로 시험에서만 견준다(앱 번들에는 들어가지 않는다).
// @vitest-environment node
import * as webWords from '@livejjim/web/src/lib/words.ts'
import * as webDerive from '@livejjim/web/src/lib/derive.ts'
import * as webScope from '@livejjim/web/src/lib/scope-data.ts'
import * as webQuick from '@livejjim/web/src/lib/quick.ts'
import * as webPacking from '@livejjim/web/src/lib/packing.ts'
import { PRINT_ACTION as WEB_PRINT_ACTION, PRINT_ALERT_WORD as WEB_PRINT_ALERT_WORD } from '@livejjim/web/src/lib/print-words.ts'
import { CONNECTION_STATE_NAMES } from '@livejjim/printer'
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import * as words from '../src/lib/words.ts'
import * as derive from '../src/lib/derive.ts'
import * as scope from '../src/lib/scope-data.ts'
import * as quick from '../src/lib/quick.ts'
import * as packing from '../src/lib/packing.ts'
import { buyer, changes, claim, fullView, product } from './support.ts'

describe('낱말 표가 웹과 같다', () => {
  it('상태·알림·라벨·입금·출력 낱말', () => {
    expect(words.PRODUCT_STATUS_WORD).toEqual(webWords.PRODUCT_STATUS_WORD)
    expect(words.REJECT_REASON_WORD).toEqual(webWords.REJECT_REASON_WORD)
    expect(words.ALERT_WORD).toEqual(webWords.ALERT_WORD)
    expect(words.LABEL_WORD).toEqual(webWords.LABEL_WORD)
    expect(words.PAYMENT_WORD).toEqual(webWords.PAYMENT_WORD)
    expect(words.paymentWord('OVERPAID', 5000)).toBe(webWords.paymentWord('OVERPAID', 5000))
    expect(words.PRINT_ACTION).toEqual(WEB_PRINT_ACTION)
    expect(words.PRINT_ALERT_WORD).toEqual(WEB_PRINT_ALERT_WORD)
    expect(words.CONNECTION_STATE_WORD).toEqual(CONNECTION_STATE_NAMES)
    for (const status of ['CONFIRMED', 'PENDING', 'CONFLICT', 'CANCELLED', 'DUPLICATE'] as const) expect(words.claimStatusWord(status, null, null)).toBe(webWords.claimStatusWord(status, null, null))
    expect(words.claimStatusWord('WAITLISTED', null, 2)).toBe(webWords.claimStatusWord('WAITLISTED', null, 2))
    expect(words.claimStatusWord('REJECTED', 'SOLD_OUT', null)).toBe(webWords.claimStatusWord('REJECTED', 'SOLD_OUT', null))
  })

  it('포장 낱말·거르기·순서', () => {
    expect(packing.PACKING_FILTERS).toEqual(webPacking.PACKING_FILTERS)
    expect(packing.PACKING_TONE).toEqual(webPacking.PACKING_TONE)
    expect(packing.packingWords('배송 완료', '123')).toBe(webPacking.packingWords('배송 완료', '123'))
    expect(packing.itemLineWords({ no: 21, name: '반바지', variant: 'L', qty: 2 })).toBe(webPacking.itemLineWords({ no: 21, name: '반바지', variant: 'L' }) + ' 2개')
    expect(packing.NO_SALES).toBe('아직 판매 기록이 없어요.')
  })
})

describe('고르기 규칙이 웹과 같다', () => {
  const view = fullView({
    products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 'u3'], waitlistClaims: ['c2', 'c3'] }), product(16, { conflict: true, conflictClaim: 'c4', conflictBuyer: 'u1' }), product(17, { awaitingSuccession: true })],
    claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 }), claim('c3', 15, 'u3', { status: 'WAITLISTED', seq: 12 }), claim('c4', 16, 'u1', { status: 'CONFLICT' }), claim('c5', 20, 'u2', { status: 'PENDING', reason: 'UNOPENED', productId: null })],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '홍길동'), buyer('u3', '김영희', { kind: 'sms', phoneLast4: '1234' })],
    pending: [{ product: 'b1/20', broadcast: 'b1', no: 20, buyers: ['u2'], claims: ['c5'] }],
    cancelRequests: [],
    attention: [{ seq: 3, message: '확인' }],
  })
  const mine = scope.fromFull(view)
  const theirs = webScope.fromFull(view)

  it('구매자 이름 표기·찜 낱말', () => {
    expect([...derive.buyerLabels(mine.buyers, mine.claims)]).toEqual([...webDerive.buyerLabels(theirs.buyers, theirs.claims)])
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) expect(derive.claimWord(mine, mine.claims.get(id)!)).toBe(webDerive.claimWord(theirs, theirs.claims.get(id)!))
  })

  it('알림 수·상품 자리·보드 순서', () => {
    expect(derive.alertCounts(mine)).toEqual(webDerive.alertCounts(theirs))
    for (const key of mine.products.keys()) expect(derive.productSlots(mine.products.get(key)!)).toEqual(webDerive.productSlots(theirs.products.get(key)!))
    expect(derive.boardProducts(mine, 'b1').map((item) => item.no)).toEqual(webDerive.boardProducts(theirs, 'b1').map((item) => item.no))
    expect(derive.latestProduct(mine, 'b1')?.no).toBe(webDerive.latestProduct(theirs, 'b1')?.no)
  })

  it('증분 덮기 결과가 같다', () => {
    const delta = changes(5, 9, { products: [product(15, { status: 'SOLD' })], claims: [claim('c6', 15, 'u3')], removed: { broadcasts: [], products: [], claims: ['c2'], pending: ['b1/20'], buyers: [], settlements: [], effects: [], cancelRequests: [] }, attention: [{ seq: 3, message: '확인' }, { seq: 8, message: '새 확인' }] })
    const a = scope.applyChanges(mine, delta)
    const b = webScope.applyChanges(theirs, delta)
    const lists = webScope.sortedLists(b)
    expect([...a.products.values()].sort((x, y) => x.key.localeCompare(y.key))).toEqual(lists.products)
    expect([...a.claims.values()].sort((x, y) => x.id.localeCompare(y.id))).toEqual(lists.claims)
    expect([...a.pending.keys()]).toEqual(Object.keys(Object.fromEntries(lists.pending.map((item) => [(item as { product: string }).product, item]))))
    expect(a.attention).toEqual(b.attention)
    expect(a.seq).toBe(b.seq)
    expect(() => scope.applyChanges(mine, changes(4, 9))).toThrow()
  })
})

describe('빠른 입력 읽기가 웹과 같다', () => {
  const settings = quick.quickSettings(DEFAULT_SETTINGS)
  const webSettings = webQuick.quickSettings(DEFAULT_SETTINGS)
  const find = () => undefined
  it('등록·오류·단위 줄', () => {
    for (const line of ['15 핑크프릴 10000', '15 핑크프릴 2만', '15 10', '핑크프릴 10000', '15 핑크프릴', '15 핑크프릴 50', '1000 핑크 10', '']) {
      const a = quick.decideQuickInput(line, settings, find)
      const b = webQuick.decideQuickInput(line, webSettings, find)
      expect(a.kind).toBe(b.kind)
      if (a.kind === 'register' && b.kind === 'register') expect([a.no, a.name, a.price]).toEqual([b.no, b.name, b.price])
      if (a.kind === 'fix' && b.kind === 'fix') expect(a.message).toBe(b.message)
    }
    for (const unit of ['WON', 'THOUSAND', 'TEN_THOUSAND', 'AUTO'] as const) expect(quick.unitLine(unit)).toBe(webQuick.unitLine(unit))
    expect(quick.registerPreview('15 핑크프릴 10', settings, find)).toBe(webQuick.registerPreview('15 핑크프릴 10', webSettings, find))
    expect(quick.editQuestion(15, true)).toBe(webQuick.editQuestion(15, true))
  })
  it('있는 번호는 고치기, 번호만이면 열기', () => {
    const existing = product(15)
    const findExisting = (no: number) => (no === 15 ? existing : undefined)
    expect(quick.decideQuickInput('15 핑크 12000', settings, findExisting).kind).toBe('edit')
    expect(quick.decideQuickInput('15', settings, findExisting).kind).toBe('open')
    expect(quick.decideQuickInput('15', settings, find).kind).toBe('fix')
  })
})
