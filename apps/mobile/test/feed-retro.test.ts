// 찜 기록 보기 고르기·줄 만들기·찜 조치 방법 (D-RETRO-51~54, 복기 F6·F7 · D-UX4-151~154) — 화면 없이 값만 본다.
// 정렬·글자 크기는 이 휴대폰에 기억하고, 손님별 이름순은 한글 → 영문 → 숫자·기호(D-UX4-153, 한 손님 안은 번호 오름차순).
// 번호별 줄(D-RETRO-50)은 D-UX4-151(사용자 지시 2026-11-16 "상품 탭 [찜 된 것만]으로 통일")로 걷어 그 시험(번호 오름차순·최근순·"+n명" 접기)도 걷었다.
// 찾기는 한 칸에서 번호 또는 닉네임(D-UX4-152), 시각은 초까지(D-UX4-154).
// 올리기·되돌리기는 엔진이 받아 줄 때만 내놓고(R-9), 찜 넣기는 문자찜(sms) 쓰기 — 전화번호 전체는 보내지 않는다.
import { afterEach, describe, expect, it } from 'vitest'
import { BuyerNames } from '../src/lib/derive.ts'
import { FEED_VIEW_DEFAULT, FEED_VIEW_KEY, getFeedView, parseFeedView, resetFeedView, setFeedView, wireFeedView } from '../src/lib/feed-view.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { addSuggestions, addedLine, last4Digits } from '../src/screens/console/ClaimAdd.tsx'
import { raisePlan, smsClaimEvent } from '../src/screens/console/claim-actions.ts'
import { compareNames, feedClock, feedMatches, feedPickable, feedRows, filterFeed, nameCharRank, searchText } from '../src/screens/console/feed-rows.ts'
import { BROADCAST_VIEW, buyer, claim, flush, fullView, product } from './support.ts'

afterEach(() => resetFeedView())

function world(patch: Parameters<typeof fullView>[0]) {
  const data = fromFull(fullView(patch))
  return { data, names: new BuyerNames(data.buyers, data.claims) }
}

describe('찜 기록 보기 기억 (lib/feed-view)', () => {
  // D-UX4-151: 보기(mode)·번호별 정렬(numberSort)을 걷어 정렬·글자 크기만 남는다 — 기대값의 그 두 칸을 뺐다
  it('기본은 지금까지의 모습: 최근순 · 큰 글자', () => {
    expect(getFeedView()).toEqual({ buyerSort: 'recent', size: 'large' })
    expect(FEED_VIEW_DEFAULT).toEqual(getFeedView())
  })

  it('고르면 바로 바뀌고 앱 저장소에 쓴다 — 다시 켜면 되살린다', async () => {
    const saved = new Map<string, string>()
    const store = { getItem: async (key: string) => saved.get(key) ?? null, setItem: async (key: string, value: string) => void saved.set(key, value) }
    await wireFeedView(store)
    setFeedView({ buyerSort: 'name', size: 'small' })
    expect(getFeedView()).toEqual({ buyerSort: 'name', size: 'small' })
    await flush()
    expect(JSON.parse(saved.get(FEED_VIEW_KEY) ?? '')).toEqual({ buyerSort: 'name', size: 'small' })
    resetFeedView()
    expect(getFeedView().buyerSort).toBe('recent')
    await wireFeedView(store)
    expect(getFeedView()).toEqual({ buyerSort: 'name', size: 'small' })
  })

  it('옛 앱이 저장한 번호별 보기(mode·numberSort)는 읽을 때 버리고 나머지는 되살린다 (D-UX4-151)', () => {
    expect(parseFeedView(JSON.stringify({ mode: 'number', buyerSort: 'name', numberSort: 'recent', size: 'small' }))).toEqual({ buyerSort: 'name', size: 'small' })
  })

  it('저장한 값이 깨졌거나 모르는 값이면 그 칸만 기본으로, 저장소가 실패해도 화면은 고른 대로', async () => {
    expect(parseFeedView('{')).toEqual(FEED_VIEW_DEFAULT)
    expect(parseFeedView('[1]')).toEqual(FEED_VIEW_DEFAULT)
    expect(parseFeedView(JSON.stringify({ buyerSort: 'zzz', size: 'small' }))).toEqual({ ...FEED_VIEW_DEFAULT, size: 'small' })
    expect(parseFeedView(JSON.stringify({ buyerSort: 'name', size: 5 }))).toEqual({ ...FEED_VIEW_DEFAULT, buyerSort: 'name' })
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

describe('이름순 한글 먼저 (D-UX4-153 — D-RETRO-51의 글자 번호 순서를 바꿈)', () => {
  it('한글 이름 → 영문 → 숫자·기호, 같은 무리 안은 가나다·알파벳(대소문자 무시) 순 — 문자 손님 "문자-0937"은 한글 무리, 유튜브 아이디 앞 "@"는 보지 않는다', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 's']
    const mixed = world({
      products: [],
      claims: ids.map((id, index) => claim(`c${id}`, index + 1, id, { status: 'PENDING', productId: null })),
      buyers: [buyer('a', 'zeta'), buyer('b', '하늘'), buyer('c', '123상점'), buyer('d', 'Alpha'), buyer('e', '가람'), buyer('f', '★별'), buyer('g', 'beta'), buyer('h', '@나래'), buyer('s', '문자찜', { kind: 'sms', phoneLast4: '0937' })],
    })
    const rows = feedRows(mixed.data, mixed.names, 'b1', undefined, 'name')
    // 옛(글자 번호 순서): 123상점 · @나래 · Alpha · beta · zeta · ★별 · 가람 · 문자-0937 · 하늘
    expect(rows.map((row) => row.buyer)).toEqual(['가람', '@나래', '문자-0937', '하늘', 'Alpha', 'beta', 'zeta', '123상점', '★별'])
  })

  it('이름 견주기: 글자마다 무리(한글 0 · 영문 1 · 숫자 2 · 기호 3)를 먼저, 앞이 같으면 짧은 이름이 앞 — 휴대폰 언어 설정과 상관없다', () => {
    expect(['하', 'ㄱ', 'a', 'Z', 'é', '0', '-', '😀'].map((char) => nameCharRank(char.codePointAt(0)!))).toEqual([0, 0, 1, 1, 1, 2, 3, 3])
    expect(compareNames('홍길동', '홍길동A')).toBeLessThan(0)
    expect(compareNames('홍a', '홍가')).toBeGreaterThan(0)
    expect(compareNames('apple', 'Banana')).toBeLessThan(0)
    expect(compareNames('Ｂｅｔａ', 'alpha')).toBeGreaterThan(0)
    expect(compareNames('가람', '가람')).toBe(0)
    expect(compareNames('나', '가')).toBeGreaterThan(0)
  })
})

describe('찜 기록 찾기 (D-UX4-152)', () => {
  const { data, names } = world({
    products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] }), product(150, { winners: ['u4'], winnerClaims: ['c3'] }), product(7, { winners: ['u3'], winnerClaims: ['c4'] })],
    claims: [
      claim('c1', 15, 'u1', { rankTime: '2026-10-29T11:00:01.000Z' }),
      claim('c2', 15, 'u2', { status: 'WAITLISTED', rankTime: '2026-10-29T11:00:02.000Z' }),
      claim('c3', 150, 'u4', { rankTime: '2026-10-29T11:00:03.000Z' }),
      claim('c4', 7, 'u3', { rankTime: '2026-10-29T11:00:04.000Z' }),
      claim('c5', 88, 's1', { status: 'PENDING', origin: 'sms', productId: null, rankTime: '2026-10-29T11:00:05.000Z' }),
    ],
    buyers: [buyer('u1', '홍길동'), buyer('u2', 'Plant Lover'), buyer('u3', '다육이15'), buyer('u4', '김영희'), buyer('s1', '문자찜', { kind: 'sms', phoneLast4: '0937' })],
  })
  const rows = feedRows(data, names, 'b1')
  const found = (query: string) => filterFeed(rows, query).map((row) => row.buyer)

  it('빈 칸(띄어쓰기만 포함)은 모두 — 차례는 그대로', () => {
    expect(found('')).toEqual(rows.map((row) => row.buyer))
    expect(found('   ')).toEqual(rows.map((row) => row.buyer))
  })

  it('숫자만 치면 그 번호를 찜한 손님(꼭 같은 번호만 — 150번은 아니다)과 닉네임에 그 숫자가 든 손님이 함께, 최근순 차례 그대로', () => {
    expect(found('15')).toEqual(['홍길동', 'Plant Lover', '다육이15'])
    expect(found('150')).toEqual(['김영희'])
    // 앞의 0은 번호에서 보지 않는다(07 = 7번) · 문자 손님 끝 네 자리도 닉네임처럼 찾는다
    expect(found('07')).toEqual(['다육이15'])
    expect(found('0937')).toEqual(['문자-0937'])
    expect(found('88')).toEqual(['문자-0937'])
    expect(found(' 1 5 ')).toEqual(['홍길동', 'Plant Lover', '다육이15'])
  })

  it('글자면 닉네임 부분 일치 — 대소문자·띄어쓰기·넓은 글자는 보지 않는다', () => {
    expect(found('plantlover')).toEqual(['Plant Lover'])
    expect(found('LOVER')).toEqual(['Plant Lover'])
    expect(found('길 동')).toEqual(['홍길동'])
    expect(found('ｐｌａｎｔ')).toEqual(['Plant Lover'])
    expect(found('다육')).toEqual(['다육이15'])
    expect(found('없는손님')).toEqual([])
    // 숫자와 글자가 섞이면 닉네임만 본다 (번호로 읽지 않는다)
    expect(found('15번')).toEqual([])
  })

  it('찾는 글 꼴: NFKC · 소문자 · 띄어쓰기 없음', () => {
    expect(searchText(' Ａ b\tC ')).toBe('abc')
    expect(feedMatches({ buyer: '홍길동', nos: [] }, '')).toBe(true)
    expect(feedMatches({ buyer: '홍길동', nos: [] }, '1')).toBe(false)
  })
})

describe('찜 기록 시각·누르기 (D-UX4-154)', () => {
  it('시각은 한국 시각 초까지 — 읽을 수 없으면 빈 글', () => {
    expect(feedClock(Date.parse('2026-10-29T11:00:09.000Z'))).toBe('20:00:09')
    expect(feedClock(Date.parse('2026-10-29T04:05:42.900Z'))).toBe('13:05:42')
    expect(feedClock(Number.NaN)).toBe('')
  })

  it('손님 줄의 시각은 그 손님이 가장 최근에 찜한 시각 (문자찜은 문자를 받은 시각)', () => {
    const { data, names } = world({
      products: [product(15), product(7)],
      claims: [claim('c1', 15, 'u1', { rankTime: '2026-10-29T04:05:00.000Z' }), claim('c2', 7, 'u1', { origin: 'sms', rankTime: '2026-10-29T04:05:42.000Z', received: '2026-10-29T04:06:01.000Z' })],
      buyers: [buyer('u1', '홍길동')],
    })
    expect(feedClock(feedRows(data, names, 'b1')[0]!.latest)).toBe('13:06:01')
  })

  it('라이브 중: 살아 있는 찜, 또는 끝난 찜이어도 상품이 목록에 있으면 누른다 · 끝난·봉인한 라이브: 상품이 있고 [상품 보기]를 열 수 있을 때만', () => {
    expect(feedPickable({ status: 'PENDING', hasProduct: false }, false, true)).toBe(true)
    expect(feedPickable({ status: 'CANCELLED', hasProduct: true }, false, false)).toBe(true)
    expect(feedPickable({ status: 'CANCELLED', hasProduct: false }, false, true)).toBe(false)
    expect(feedPickable({ status: 'CONFIRMED', hasProduct: true }, true, true)).toBe(true)
    expect(feedPickable({ status: 'CONFIRMED', hasProduct: true }, true, false)).toBe(false)
    expect(feedPickable({ status: 'PENDING', hasProduct: false }, true, true)).toBe(false)
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
