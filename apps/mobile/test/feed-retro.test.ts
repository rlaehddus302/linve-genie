// 찜 기록 보기 고르기·줄 만들기·찜 조치 방법 (D-RETRO-50~54, 복기 F6·F7) — 화면 없이 값만 본다.
// 보기·정렬·글자 크기는 이 휴대폰에 기억하고, 번호별 줄은 번호 오름차순에 찜 → 겹침 → 보류 → 대기(순번) → 끝난 찜, 손님별 이름순은 이름 오름차순(한 손님 안은 번호 오름차순).
// 올리기·되돌리기는 엔진이 받아 줄 때만 내놓고(R-9), 찜 넣기는 문자찜(sms) 쓰기 — 전화번호 전체는 보내지 않는다.
import { afterEach, describe, expect, it } from 'vitest'
import { BuyerNames } from '../src/lib/derive.ts'
import { FEED_VIEW_DEFAULT, FEED_VIEW_KEY, getFeedView, parseFeedView, resetFeedView, setFeedView, wireFeedView } from '../src/lib/feed-view.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { addSuggestions, addedLine, last4Digits } from '../src/screens/console/ClaimAdd.tsx'
import { raisePlan, smsClaimEvent } from '../src/screens/console/claim-actions.ts'
import { NUMBER_CHIP_LIMIT, chipLabel, feedRows, numberRows, shownChips } from '../src/screens/console/feed-rows.ts'
import { BROADCAST_VIEW, buyer, claim, flush, fullView, product } from './support.ts'

afterEach(() => resetFeedView())

function world(patch: Parameters<typeof fullView>[0]) {
  const data = fromFull(fullView(patch))
  return { data, names: new BuyerNames(data.buyers, data.claims) }
}

describe('찜 기록 보기 기억 (lib/feed-view)', () => {
  it('기본은 지금까지의 모습: 손님별 · 최근순 · 큰 글자 (번호별의 기본 정렬은 번호순)', () => {
    expect(getFeedView()).toEqual({ mode: 'buyer', buyerSort: 'recent', numberSort: 'number', size: 'large' })
    expect(FEED_VIEW_DEFAULT).toEqual(getFeedView())
  })

  it('고르면 바로 바뀌고 앱 저장소에 쓴다 — 다시 켜면 되살린다', async () => {
    const saved = new Map<string, string>()
    const store = { getItem: async (key: string) => saved.get(key) ?? null, setItem: async (key: string, value: string) => void saved.set(key, value) }
    await wireFeedView(store)
    setFeedView({ mode: 'number', size: 'small' })
    expect(getFeedView()).toEqual({ mode: 'number', buyerSort: 'recent', numberSort: 'number', size: 'small' })
    await flush()
    expect(JSON.parse(saved.get(FEED_VIEW_KEY) ?? '')).toEqual({ mode: 'number', buyerSort: 'recent', numberSort: 'number', size: 'small' })
    resetFeedView()
    expect(getFeedView().mode).toBe('buyer')
    await wireFeedView(store)
    expect(getFeedView()).toEqual({ mode: 'number', buyerSort: 'recent', numberSort: 'number', size: 'small' })
  })

  it('저장한 값이 깨졌거나 모르는 값이면 그 칸만 기본으로, 저장소가 실패해도 화면은 고른 대로', async () => {
    expect(parseFeedView('{')).toEqual(FEED_VIEW_DEFAULT)
    expect(parseFeedView('[1]')).toEqual(FEED_VIEW_DEFAULT)
    expect(parseFeedView(JSON.stringify({ mode: 'number', buyerSort: 'zzz', size: 5 }))).toEqual({ ...FEED_VIEW_DEFAULT, mode: 'number' })
    await wireFeedView({ getItem: async () => { throw new Error('저장소 없음') }, setItem: async () => { throw new Error('저장소 없음') } })
    setFeedView({ buyerSort: 'name' })
    await flush()
    expect(getFeedView().buyerSort).toBe('name')
  })
})

describe('손님별 줄 정렬 (D-RETRO-51)', () => {
  const { data, names } = world({
    products: [product(15, { winners: ['u1'], winnerClaims: ['c1'] }), product(7, { winners: ['u1'], winnerClaims: ['c3'] }), product(3, { winners: ['u2'], winnerClaims: ['c2'] })],
    claims: [
      claim('c1', 15, 'u1', { rankTime: '2026-10-29T11:00:01.000Z' }),
      claim('c2', 3, 'u2', { rankTime: '2026-10-29T11:00:02.000Z' }),
      claim('c3', 7, 'u1', { rankTime: '2026-10-29T11:00:03.000Z' }),
      claim('c4', 9, 'u3', { status: 'PENDING', productId: null, rankTime: '2026-10-29T11:00:00.000Z' }),
    ],
    buyers: [buyer('u1', '하늘'), buyer('u2', '가람'), buyer('u3', '나래')],
  })

  it('최근순(기본): 가장 최근에 찜한 손님이 맨 아래, 한 손님 안은 찜한 순서 — 지금까지와 같다', () => {
    const rows = feedRows(data, names, 'b1')
    expect(rows.map((row) => row.buyer)).toEqual(['나래', '가람', '하늘'])
    expect(rows[2]?.nos.map((item) => item.no)).toEqual([15, 7])
    expect(feedRows(data, names, 'b1', undefined, 'recent')).toEqual(rows)
  })

  it('이름순: 이름 오름차순(가나다), 한 손님 안의 번호도 오름차순', () => {
    const rows = feedRows(data, names, 'b1', undefined, 'name')
    expect(rows.map((row) => row.buyer)).toEqual(['가람', '나래', '하늘'])
    expect(rows[2]?.nos.map((item) => item.no)).toEqual([7, 15])
  })
})

describe('번호별 줄 (D-RETRO-50)', () => {
  const { data, names } = world({
    products: [
      product(15, { name: '핑크프릴', price: 35_000, winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u3', 'u2'], waitlistClaims: ['c3', 'c2'] }),
      product(7, { name: '', price: 12_000, winners: ['u2'], winnerClaims: ['c5'] }),
    ],
    claims: [
      claim('c1', 15, 'u1', { rankTime: '2026-10-29T11:00:01.000Z' }),
      claim('c2', 15, 'u2', { status: 'WAITLISTED', rankTime: '2026-10-29T11:00:02.000Z' }),
      claim('c3', 15, 'u3', { status: 'WAITLISTED', rankTime: '2026-10-29T11:00:03.000Z' }),
      claim('c4', 15, 's1', { status: 'CANCELLED', origin: 'sms', rankTime: '2026-10-29T11:00:00.000Z' }),
      claim('c5', 7, 'u2', { rankTime: '2026-10-29T11:00:09.000Z' }),
      claim('c6', 88, 's1', { status: 'PENDING', origin: 'sms', productId: null, rankTime: '2026-10-29T11:00:04.000Z' }),
      claim('c7', 7, 'u1', { status: 'DUPLICATE', rankTime: '2026-10-29T11:00:10.000Z' }),
    ],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '이철수'), buyer('s1', '문자찜', { kind: 'sms', phoneLast4: '0937' })],
  })

  it('번호 오름차순으로, 한 줄에 번호·품종·가격과 손님 — 찜 → 대기(순번 순서) → 취소·안 된 찜. 문자 손님은 "문자-끝 4자리", 겹쳐 온 반복 찜은 뺀다', () => {
    const rows = numberRows(data, names, 'b1')
    expect(rows.map((row) => row.no)).toEqual([7, 15, 88])
    expect(rows[1]).toMatchObject({ key: 'b1/15', no: 15, name: '핑크프릴', price: 35_000, keep: 1 })
    // 대기는 받은 순서가 아니라 서버가 준 대기 순번(이철수 1, 김영희 2)
    expect(rows[1]?.chips.map(chipLabel)).toEqual(['홍길동 찜', '이철수 대기 1', '김영희 대기 2', '문자-0937 취소됨'])
    expect(rows[1]?.chips.map((chip) => chip.tone)).toEqual(['win', 'wait', 'wait', 'other'])
    expect(rows[0]?.chips.map(chipLabel)).toEqual(['김영희 찜'])
    // 아직 상품이 없는 번호: 가격 없음, 보류
    expect(rows[2]).toMatchObject({ no: 88, name: '', price: null, keep: 1 })
    expect(rows[2]?.chips.map(chipLabel)).toEqual(['문자-0937 보류'])
    expect(rows[2]?.chips[0]?.hasProduct).toBe(false)
  })

  it('최근순: 가장 최근에 찜이 온 번호가 맨 아래', () => {
    expect(numberRows(data, names, 'b1', 'recent').map((row) => row.no)).toEqual([15, 88, 7])
  })

  it('손님이 많으면 접는다: 찜·겹침·보류는 늘 보이고 나머지는 한도까지, 숨은 수를 알린다 — 펼치면 모두', () => {
    const waits = Array.from({ length: 9 }, (_, index) => `w${String(index + 1)}`)
    const many = world({
      products: [product(20, { stock: 2, winners: ['a', 'b'], winnerClaims: ['ca', 'cb'], waitlist: waits, waitlistClaims: waits.map((id) => `c${id}`) })],
      claims: [claim('ca', 20, 'a'), claim('cb', 20, 'b'), ...waits.map((id) => claim(`c${id}`, 20, id, { status: 'WAITLISTED' }))],
      buyers: [buyer('a', '가'), buyer('b', '나'), ...waits.map((id) => buyer(id, `손님${id}`))],
    })
    const [row] = numberRows(many.data, many.names, 'b1')
    expect(row?.chips).toHaveLength(11)
    expect(row?.keep).toBe(2)
    const folded = shownChips(row!, false)
    expect(folded.shown).toHaveLength(NUMBER_CHIP_LIMIT)
    expect(folded.more).toBe(11 - NUMBER_CHIP_LIMIT)
    expect(folded.shown.slice(0, 2).map((chip) => chip.tone)).toEqual(['win', 'win'])
    expect(shownChips(row!, true)).toMatchObject({ more: 0 })
    expect(shownChips(row!, true).shown).toHaveLength(11)
    // 찜·겹침·보류가 한도보다 많으면 그만큼은 다 보인다
    expect(shownChips({ chips: row!.chips, keep: 8 }, false).shown).toHaveLength(8)
  })
})

describe('찜으로 올리기 · 찜 되돌리기를 내놓는 때 (D-RETRO-53, R-9)', () => {
  const buyers = [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '이철수')]

  it('대기 찜: 자리가 비었으면 승계, 찼고 1등이 한 명이면 그 1등을 내리는 교체', () => {
    const free = world({ products: [product(15, { awaitingSuccession: true, waitlist: ['u2'], waitlistClaims: ['c2'] })], claims: [claim('c2', 15, 'u2', { status: 'WAITLISTED' })], buyers })
    expect(raisePlan(free.data, free.data.claims.get('c2')!)).toEqual({ kind: 'promote', replace: null })
    const full = world({ products: [product(15, { status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })], claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED' })], buyers })
    expect(raisePlan(full.data, full.data.claims.get('c2')!)).toEqual({ kind: 'promote', replace: 'u1' })
    // 살아 있는 1등·보류·겹침 찜은 올릴 것이 없다
    expect(raisePlan(full.data, full.data.claims.get('c1')!)).toBeNull()
  })

  it('취소·안 된 찜: 자리가 비었으면 다시 배정, 찼으면 지금 1등을 대기로 내리는 교체 — 그 손님이 이미 살아 있는 찜이 있으면 없다', () => {
    const free = world({ products: [product(15)], claims: [claim('c1', 15, 'u1', { status: 'CANCELLED' })], buyers })
    expect(raisePlan(free.data, free.data.claims.get('c1')!)).toEqual({ kind: 'restore', replace: null })
    const taken = world({ products: [product(15, { status: 'SOLD', winners: ['u2'], winnerClaims: ['c2'] })], claims: [claim('c1', 15, 'u1', { status: 'REJECTED', reason: 'SOLD_OUT' }), claim('c2', 15, 'u2')], buyers })
    expect(raisePlan(taken.data, taken.data.claims.get('c1')!)).toEqual({ kind: 'restore', replace: 'u2' })
    const again = world({ products: [product(15, { status: 'SOLD', winners: ['u1'], winnerClaims: ['c9'] })], claims: [claim('c1', 15, 'u1', { status: 'CANCELLED' }), claim('c9', 15, 'u1')], buyers })
    expect(raisePlan(again.data, again.data.claims.get('c1')!)).toBeNull()
  })

  it('엔진이 받지 않거나 다른 손님이 밀려나는 경우는 내놓지 않는다: 겹친 상품 · 판매 중이 아님 · 옵션 상품 · 차단한 손님 · 1등이 여럿인 꽉 찬 상품 · 차단한 1등 · 대기 한도가 찬 되돌리기 · 상품 없이 끝난 찜', () => {
    const cancelled = claim('c1', 15, 'u1', { status: 'CANCELLED' })
    const plan = (patch: Parameters<typeof fullView>[0]) => {
      const { data } = world({ claims: [cancelled], buyers, ...patch })
      return raisePlan(data, data.claims.get('c1')!)
    }
    expect(plan({ products: [product(15, { conflict: true })] })).toBeNull()
    expect(plan({ products: [product(15, { status: 'HOLD' })] })).toBeNull()
    expect(plan({ products: [product(15, { status: 'CLOSED' })] })).toBeNull()
    expect(plan({ products: [product(15, { hasOptions: true })] })).toBeNull()
    expect(plan({ products: [product(15)], buyers: [buyer('u1', '홍길동', { blocked: true })] })).toBeNull()
    expect(plan({ products: [product(15, { stock: 2, status: 'SOLD', winners: ['u2', 'u3'], winnerClaims: ['c2', 'c3'] })], claims: [cancelled, claim('c2', 15, 'u2'), claim('c3', 15, 'u3')] })).toBeNull()
    expect(plan({ products: [product(15, { status: 'SOLD', winners: ['u2'], winnerClaims: ['c2'] })], claims: [cancelled, claim('c2', 15, 'u2')], buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희', { blocked: true })] })).toBeNull()
    // 대기 한도 1이 이미 찼다 — 되돌리면 맨 끝 대기 손님이 밀려난다
    expect(plan({
      broadcasts: [{ ...BROADCAST_VIEW, settings: { ...BROADCAST_VIEW.settings, 'waitlist.max': 1 } }],
      products: [product(15, { status: 'SOLD', winners: ['u2'], winnerClaims: ['c2'], waitlist: ['u3'], waitlistClaims: ['c3'] })],
      claims: [cancelled, claim('c2', 15, 'u2'), claim('c3', 15, 'u3', { status: 'WAITLISTED' })],
    })).toBeNull()
    // 상품 없이 끝난 찜 뒤에 같은 번호 상품이 새로 생겼다 — 그 찜이 판정받은 상품이 아니다
    expect(plan({ products: [product(15)], claims: [{ ...cancelled, productId: null }] })).toBeNull()
  })
})

describe('찜 넣기 (D-RETRO-54)', () => {
  it('보내는 쓰기는 문자찜: 이름은 메모, 끝 네 자리는 last4 — 빈 칸은 넣지 않고 전화번호 전체(phone)는 없다. 고른 손님이면 buyer만', () => {
    const target = { broadcast: 'b1', no: 15 }
    expect(smsClaimEvent(target, { name: ' 홍길동 ', last4: '0937', buyer: null })).toEqual({ type: 'sms', b: 'b1', no: 15, memo: '홍길동', last4: '0937' })
    expect(smsClaimEvent(target, { name: '홍길동', last4: '', buyer: null })).toEqual({ type: 'sms', b: 'b1', no: 15, memo: '홍길동' })
    expect(smsClaimEvent(target, { name: '', last4: '0937', buyer: null, newBuyer: true })).toEqual({ type: 'sms', b: 'b1', no: 15, last4: '0937', newBuyer: true })
    expect(smsClaimEvent(target, { name: '홍길동', last4: '0937', buyer: 'u1', newBuyer: true })).toEqual({ type: 'sms', b: 'b1', no: 15, buyer: 'u1' })
  })

  it('끝 네 자리 칸은 숫자 네 개까지만 받는다 (전화번호 전체를 붙여도 앞 네 개만 남는다)', () => {
    expect(last4Digits('09 37')).toBe('0937')
    expect(last4Digits('０９３７')).toBe('0937')
    expect(last4Digits('010-1234-5678')).toBe('0101')
    expect(last4Digits('abc')).toBe('')
  })

  it('이미 있는 손님 후보: 보이는 이름에 적은 글이 들어 있거나 끝 네 자리가 같은 문자 손님 — 그 상품에 이미 찜이 있는 손님·차단한 손님·합쳐진 손님은 뺀다', () => {
    const { data, names } = world({
      products: [product(15, { winners: ['u1'], winnerClaims: ['c1'] })],
      claims: [claim('c1', 15, 'u1')],
      buyers: [buyer('u1', '홍길동'), buyer('u2', '홍길순'), buyer('u3', '홍차', { blocked: true }), buyer('u4', '홍삼', { mergedInto: 'u2', current: 'u2' }), buyer('s1', '문자찜(영희)', { kind: 'sms', phoneLast4: '0937' })],
    })
    const target = data.products.get('b1/15')!
    expect(addSuggestions(data, names, target, '홍', '')).toEqual(['u2'])
    expect(addSuggestions(data, names, target, '', '0937')).toEqual(['s1'])
    expect(addSuggestions(data, names, target, '', '093')).toEqual([])
    expect(addSuggestions(data, names, target, '  ', '')).toEqual([])
  })

  it('넣은 결과 한 줄은 그 쓰기로 생긴 문자찜의 지금 상태 — 찜이 생기지 않았으면 그렇게 알린다', () => {
    const { data, names } = world({
      products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['s1'], waitlistClaims: ['c2'] })],
      claims: [claim('c1', 15, 'u1'), claim('c2', 15, 's1', { status: 'WAITLISTED', origin: 'sms', seq: 21 })],
      buyers: [buyer('u1', '홍길동'), buyer('s1', '문자찜(영희)', { kind: 'sms', phoneLast4: '0937' })],
    })
    expect(addedLine(data, names, 21)).toEqual({ tone: 'success', text: '넣었어요 — 문자-0937 · 대기 1' })
    expect(addedLine(data, names, 22)).toEqual({ tone: 'warning', text: '새 찜이 생기지 않았어요. 이미 찜한 손님인지 확인해 주세요.' })
  })
})
