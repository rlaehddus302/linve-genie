// 구매자 화면 값 (AC-S06-20·21·23, BUY-01 AC2, BUY-03, R-11, D-090·D-091). 실제 코어로 만든 범위 조회에서 고른다.
// 합치기 미리 보기(중복으로 정리될 찜·막는 경우)는 실제 엔진에 buyer.merge를 넣은 결과와 맞대어 본다.
import { describe, expect, it } from 'vitest'
import type { Buyer } from '../src/api/types.ts'
import { buyerList, defaultInto, distinguishWords, planMerge, sameNameCounts, searchBuyers, smsHolder, topicParticle } from '../src/lib/buyers.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { chat, dataOf, register, run, sms, viewOf } from './engine.ts'

const KEY_A = 'phonekey-aaaaaaaaaaaa'
const KEY_B = 'phonekey-bbbbbbbbbbbb'
const label = (b: string, no: number) => (b === 'b1' ? `${String(no)}번` : `2부 ${String(no)}번`)

/** 유튜브 홍길동(UC_hong1234)·김철수, 문자 구매자 둘(뒤 4자리 5678, 메모 김씨 / 전화번호 없음) */
const BASE = [
  register(15, '핑크프릴', 10000),
  register(16, '청보석', 20000),
  register(17, '금황', 5000),
  chat('m1', 'UC_hong1234', '홍길동', '15'), // 홍길동 15 1등
  sms('r1', 15, { phoneKey: KEY_A, phoneLast4: '5678', memo: '김씨' }), // 문자 15 대기 1번
  sms('r2', 16, { phoneKey: KEY_A, phoneLast4: '5678' }), // 같은 번호 → 같은 문자 구매자, 16 1등
  chat('m2', 'UC_hong1234', '홍길동', '16'), // 홍길동 16 대기 1번
  chat('m3', 'UC_kim5555', '김철수', '17'), // 김철수 17 1등
  sms('r3', 20, { phoneKey: KEY_B, phoneLast4: '1111' }), // 상품 없는 번호 → 보류
  chat('m4', 'UC_watch0001', '구경꾼', '안녕하세요'), // 찜 없는 시청자
]

describe('구매자 찾기 (AC-S06-21)', () => {
  const data = dataOf(BASE)

  it('표시 이름·메모 이력(부분 일치, 대소문자·앞뒤 공백 무시)', () => {
    expect(searchBuyers(data.buyers, ' 홍길 ').map((hit) => hit.current.display)).toEqual(['홍길동'])
    expect(searchBuyers(data.buyers, '김씨').map((hit) => hit.current.display)).toEqual(['문자찜(김씨)'])
    expect(searchBuyers(data.buyers, '').length).toBe(0)
  })

  it('숫자 4자리면 뒤 4자리와 채널 ID 끝 4자리도', () => {
    expect(searchBuyers(data.buyers, '5678').map((hit) => hit.current.display)).toEqual(['문자찜(김씨)'])
    expect(searchBuyers(data.buyers, '1234').map((hit) => hit.current.id)).toEqual(['UC_hong1234'])
    expect(searchBuyers(data.buyers, '5555').map((hit) => hit.current.id)).toEqual(['UC_kim5555'])
  })

  it('찜 없는 시청자도 찾는다', () => {
    expect(searchBuyers(data.buyers, '구경').map((hit) => hit.current.display)).toEqual(['구경꾼'])
  })

  it('합쳐진 구매자가 걸리면 지금의 구매자 줄 (걸린 구매자는 matched)', () => {
    const merged = dataOf([...BASE, { type: 'host.cancel', b: 'b1', no: 16, buyer: 'UC_hong1234', reason: '시청자 요청' }, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }])
    const hits = searchBuyers(merged.buyers, '김씨')
    expect(hits.map((hit) => [hit.current.display, hit.matched.display])).toEqual([['홍길동', '문자찜(김씨)']])
  })
})

describe('구매자 목록 (AC-S06-20)', () => {
  const data = dataOf(BASE)

  it('기본은 확정 찜이 있는 지금의 구매자, 이름 순 — 합계·상품 수는 코어 listBuyers 그대로', () => {
    const list = buyerList(data.buyers, { all: false, sort: 'name' })
    expect(list.map((buyer) => [buyer.display, buyer.items.length, buyer.subtotal])).toEqual([
      ['김철수', 1, 5000],
      ['문자찜(김씨)', 1, 20000],
      ['홍길동', 1, 10000],
    ])
  })

  it('"찜 없는 구매자도 보기"는 그날 기록된 지금의 구매자 전부, "합계 큰 순"', () => {
    const all = buyerList(data.buyers, { all: true, sort: 'total' })
    expect(all.map((buyer) => buyer.display)).toEqual(['문자찜(김씨)', '홍길동', '김철수', '구경꾼', '문자찜'])
  })

  it('요청서 3-7: 15번 10,000 + 28번 5,000 + 31번 15,000 → 3개 · 30,000원', () => {
    const three = dataOf([register(15, 'a', 10000), register(28, 'b', 5000), register(31, 'c', 15000), chat('m1', 'c1', '가', '15'), chat('m2', 'c1', '가', '28'), chat('m3', 'c1', '가', '31')])
    const [buyer] = buyerList(three.buyers, { all: false, sort: 'name' })
    expect([buyer?.items.length, buyer?.subtotal]).toEqual([3, 30000])
  })

  it('구분 표시: 같은 닉네임이면 "같은 닉네임 n명"·채널 끝 4자리, 문자 구매자는 "뒤 4자리"', () => {
    const twins = dataOf([register(15, 'a', 10000), chat('m1', 'UC_aaa1111', '하늘', '15'), chat('m2', 'UC_bbb2222', '하늘', '안녕')])
    const counts = sameNameCounts(twins.buyers)
    const [first] = buyerList(twins.buyers, { all: false, sort: 'name' })
    expect(distinguishWords(first as Buyer, counts)).toEqual(['같은 닉네임 2명', '끝 1111'])
    const smsBuyer = data.buyers.get('sms:r1') as Buyer
    expect(distinguishWords(smsBuyer, sameNameCounts(data.buyers))).toEqual(['뒤 4자리 5678'])
  })
})

describe('구매자 이름 표기 하나 (AC-S06b-20, D-098)', () => {
  const nameOf = (events: Record<string, unknown>[]) => {
    const data = dataOf(events)
    const names = new BuyerNames(data.buyers, data.claims)
    return (id: string) => names.name(id)
  }

  it('겹침 없음: 같은 표시 이름이 하나뿐이면 표시 이름 그대로 (유튜브·문자·뒤 4자리가 있어도)', () => {
    const name = nameOf(BASE)
    expect(['UC_hong1234', 'UC_kim5555', 'sms:r1', 'sms:r3'].map(name)).toEqual(['홍길동', '김철수', '문자찜(김씨)', '문자찜'])
    expect(name('없는구매자')).toBe('알 수 없는 구매자')
  })

  it('유튜브: 같은 닉네임 둘이면 "홍길동 · 끝 1234"(채널 ID 끝 4자리)', () => {
    const name = nameOf([register(15, 'a', 10000), chat('m1', 'UC_hong1234', '홍길동', '15'), chat('m2', 'UC_other9876', '홍길동', '안녕')])
    expect([name('UC_hong1234'), name('UC_other9876')]).toEqual(['홍길동 · 끝 1234', '홍길동 · 끝 9876'])
  })

  it('뒤 4자리가 있는 문자 구매자: "문자찜(김씨) · 뒤 4자리 5678"', () => {
    const name = nameOf([register(15, 'a', 10000), sms('rA', 15, { phoneKey: 'phonekey-aaaaaaaaaaaaaaaa', phoneLast4: '5678', memo: '김씨' }), sms('rB', 15, { phoneKey: 'phonekey-bbbbbbbbbbbbbbbb', phoneLast4: '1111', memo: '김씨' })])
    expect([name('sms:rA'), name('sms:rB')]).toEqual(['문자찜(김씨) · 뒤 4자리 5678', '문자찜(김씨) · 뒤 4자리 1111'])
  })

  it('전화번호 없는 문자 구매자: 그 구매자를 만든 문자찜의 받은 시각 "문자 20:01:05", 분까지 적었으면 "문자 20:01" — "번째 문자"·겹친 괄호 없음', () => {
    const name = nameOf([register(15, 'a', 10000), sms('rA', 15, { memo: '김씨', received: '20:01:05' }), sms('rB', 15, { memo: '김씨', received: '20:02' }), sms('rC', 16, { memo: '박씨' })])
    expect([name('sms:rA'), name('sms:rB'), name('sms:rC')]).toEqual(['문자찜(김씨) · 문자 20:01:05', '문자찜(김씨) · 문자 20:02', '문자찜(박씨)'])
    for (const id of ['sms:rA', 'sms:rB']) {
      expect(name(id)).not.toContain('번째 문자')
      expect(name(id)).not.toContain(') (')
      expect(name(id)).not.toContain('rA')
    }
  })

  it('받은 시각까지 같으면 생긴 순서로 둘째부터 " · 2", " · 3"', () => {
    const name = nameOf([register(15, 'a', 10000), sms('rA', 15, { received: '20:01:05' }), sms('rB', 15, { received: '20:01:05' }), sms('rC', 15, { received: '20:01:05' })])
    expect([name('sms:rA'), name('sms:rB'), name('sms:rC')]).toEqual(['문자찜 · 문자 20:01:05', '문자찜 · 문자 20:01:05 · 2', '문자찜 · 문자 20:01:05 · 3'])
  })

  it('받은 시각은 KST 그대로 — 실행 환경 시간대(Pacific/Honolulu)와 상관없다', () => {
    const name = nameOf([register(15, 'a', 10000), sms('rA', 15, { received: '23:59:30' }), sms('rB', 15, { received: '00:00:10' })])
    expect([name('sms:rA'), name('sms:rB')]).toEqual(['문자찜 · 문자 23:59:30', '문자찜 · 문자 00:00:10'])
  })

  it('합쳐진 구매자: 같은 규칙이고 "같은 이름 수"는 지금의 구매자 기준', () => {
    const events = [
      register(15, 'a', 10000),
      register(16, 'b', 20000),
      chat('m1', 'UC_hong1234', '홍길동', '15'),
      chat('m2', 'UC_other9876', '홍길동', '16'),
      chat('m3', 'UC_third5555', '홍길동', '안녕'),
    ]
    // 셋 다 지금의 구매자 — 모두 구분 글자
    expect(['UC_hong1234', 'UC_other9876', 'UC_third5555'].map(nameOf(events))).toEqual(['홍길동 · 끝 1234', '홍길동 · 끝 9876', '홍길동 · 끝 5555'])
    // 하나를 김철수에 합치면 지금의 구매자 중 홍길동은 둘 — 합쳐진 구매자도 같은 이름 수(2)로 구분 글자가 붙는다
    const merged = nameOf([...events, chat('m4', 'UC_kim0001', '김철수', '안녕'), { type: 'buyer.merge', from: 'UC_third5555', into: 'UC_kim0001', reason: '같은 사람' }])
    expect(['UC_hong1234', 'UC_other9876', 'UC_third5555', 'UC_kim0001'].map(merged)).toEqual(['홍길동 · 끝 1234', '홍길동 · 끝 9876', '홍길동 · 끝 5555', '김철수'])
    // 둘을 합쳐 지금의 구매자 홍길동이 하나가 되면 그 이름 그대로 (합쳐진 쪽도)
    const one = nameOf([...events, { type: 'buyer.merge', from: 'UC_other9876', into: 'UC_hong1234', reason: '같은 사람' }, { type: 'buyer.merge', from: 'UC_third5555', into: 'UC_hong1234', reason: '같은 사람' }])
    expect(['UC_hong1234', 'UC_other9876', 'UC_third5555'].map(one)).toEqual(['홍길동', '홍길동', '홍길동'])
  })
})

describe('합치기 미리 보기 (AC-S06-23, D-091) = 실제 엔진 결과', () => {
  it('방향 기본: 하나만 유튜브면 유튜브 쪽이 남고, 아니면 자세히를 연 구매자', () => {
    const data = dataOf(BASE)
    const hong = data.buyers.get('UC_hong1234') as Buyer
    const smsBuyer = data.buyers.get('sms:r1') as Buyer
    const kim = data.buyers.get('UC_kim5555') as Buyer
    expect(defaultInto(smsBuyer, hong).id).toBe('UC_hong1234')
    expect(defaultInto(hong, smsBuyer).id).toBe('UC_hong1234')
    expect(defaultInto(kim, hong).id).toBe('UC_kim5555')
  })

  it('두 사람 모두 활성 찜인 상품: 앞선 쪽(1등 > 대기)이 남고 나머지는 중복 — 미리 보기 문장과 엔진의 DUPLICATE가 같다', () => {
    const { state, seq } = run(BASE)
    const data = fromFull(viewOf(state, seq))
    const names = new BuyerNames(data.buyers, data.claims)
    const plan = planMerge(data, names, 'sms:r1', 'UC_hong1234', label)
    expect(plan?.blocks).toEqual([])
    expect(plan?.duplicates.map((line) => line.text)).toEqual(['15번: 문자찜(김씨)의 대기 1번 찜이 중복으로 정리돼요', '16번: 홍길동의 대기 1번 찜이 중복으로 정리돼요'])
    expect([plan?.movingCount, plan?.movingTotal, plan?.afterTotal]).toEqual([1, 20000, 30000])
    // 실제 합치기
    const after = run([...BASE, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }])
    expect(after.changed).toBe(true)
    const merged = fromFull(viewOf(after.state, after.seq))
    const duplicates = [...merged.claims.values()].filter((claim) => claim.status === 'DUPLICATE').map((claim) => claim.id).sort()
    expect(duplicates).toEqual((plan?.duplicates ?? []).map((line) => line.claim.id).sort())
    expect(merged.buyers.get('UC_hong1234')?.subtotal).toBe(plan?.afterTotal)
  })

  it('두 사람 모두 1등인 상품이 있으면 막는다 → 엔진도 아무 일도 없다 (G-ENG-171)', () => {
    const events = [register(30, '재고둘', 7000), { type: 'product.update', b: 'b1', no: 30, stock: 2 }, chat('m9', 'UC_hong1234', '홍길동', '30'), sms('r9', 30, { phoneKey: KEY_A, phoneLast4: '5678' })]
    const { state, seq } = run([...BASE, ...events])
    const data = fromFull(viewOf(state, seq))
    const plan = planMerge(data, new BuyerNames(data.buyers, data.claims), 'sms:r1', 'UC_hong1234', label)
    expect(plan?.blocks).toEqual([{ kind: 'bothWinners', products: [{ product: 'b1/30', broadcast: 'b1', no: 30, text: '30번에 두 사람 모두 1등이에요. 먼저 한 사람의 찜을 취소해 주세요.' }] }])
    expect(plan?.afterTotal).toBeNull()
    expect(run([...BASE, ...events, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }]).changed).toBe(false)
  })

  it('옮겨 갈 구매자가 이미 합쳐져 있음 / 고리', () => {
    const merged = [...BASE, { type: 'buyer.merge', from: 'sms:r3', into: 'UC_kim5555', reason: '같은 사람' }]
    const data = dataOf(merged)
    const names = new BuyerNames(data.buyers, data.claims)
    expect(planMerge(data, names, 'sms:r3', 'UC_hong1234', label)?.blocks).toEqual([{ kind: 'fromMerged', text: '문자찜은 이미 김철수에 합쳐져 있어요. 먼저 떼어 내 주세요.' }])
    expect(run([...merged, { type: 'buyer.merge', from: 'sms:r3', into: 'UC_hong1234', reason: 'x' }]).changed).toBe(false)
    expect(planMerge(data, names, 'UC_kim5555', 'sms:r3', label)?.blocks).toEqual([{ kind: 'cycle', text: '문자찜은 이미 김철수에 합쳐져 있어요.' }])
    expect(run([...merged, { type: 'buyer.merge', from: 'UC_kim5555', into: 'sms:r3', reason: 'x' }]).changed).toBe(false)
  })

  it('TE-S06-002: 막히면 합친 뒤 합계가 없다 — 이미 남는 쪽에 합쳐진 구매자(합친 금액을 두 번 세지 않는다)·고리·같은 구매자', () => {
    // 김철수에 문자 구매자(sms:r1, 16번 1등 20,000원)를 합쳐 둔 상태: 김철수 합계에 r1의 금액이 이미 들어 있다
    const merged = [...BASE, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_kim5555', reason: '같은 사람' }]
    const data = dataOf(merged)
    const names = new BuyerNames(data.buyers, data.claims)
    const kim = data.buyers.get('UC_kim5555') as Buyer
    expect([kim.subtotal, data.buyers.get('sms:r1')?.subtotal]).toEqual([25000, 20000])
    // 김철수 자세히에서 r1을 고름(남는 쪽 = 김철수): 막힘, 합친 뒤 합계 없음 (예전: 25,000 + 20,000 = 45,000으로 보임)
    const fromMerged = planMerge(data, names, 'sms:r1', 'UC_kim5555', label)
    expect(fromMerged?.blocks.map((block) => block.kind)).toEqual(['fromMerged'])
    expect(fromMerged?.afterTotal).toBeNull()
    expect(run([...merged, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_kim5555', reason: 'x' }]).changed).toBe(false)
    // 방향을 바꾸면 고리 — 남는 쪽(r1의 지금의 구매자)이 곧 김철수
    const cycle = planMerge(data, names, 'UC_kim5555', 'sms:r1', label)
    expect(cycle?.blocks.map((block) => block.kind)).toEqual(['cycle'])
    expect(cycle?.afterTotal).toBeNull()
    expect(planMerge(data, names, 'UC_kim5555', 'UC_kim5555', label)?.afterTotal).toBeNull()
    // 막히지 않으면 엔진의 합친 뒤 합계와 같다
    const open = planMerge(data, names, 'UC_hong1234', 'UC_kim5555', label)
    expect(open?.blocks).toEqual([])
    expect(open?.afterTotal).toBe(25000 + 10000)
    const after = run([...merged, { type: 'buyer.merge', from: 'UC_hong1234', into: 'UC_kim5555', reason: '같은 사람' }])
    expect(after.changed).toBe(true)
    expect(fromFull(viewOf(after.state, after.seq)).buyers.get('UC_kim5555')?.subtotal).toBe(open?.afterTotal)
  })

  it('은/는', () => {
    expect(topicParticle('홍길동')).toBe('은')
    expect(topicParticle('문자찜(김씨)')).toBe('는')
    expect(topicParticle('abc')).toBe('은(는)')
  })
})

describe('찜이 생기지 않은 문자찜이 정한 구매자 (AC-S06-14, TE-S06-001) = 엔진이 찜을 만들지 않은 까닭', () => {
  it('전화번호로 이은 구매자: 엔진이 찜을 만들지 않았으면(같은 사람 반복) 뒤 4자리가 같은 문자 구매자 중 그 상품에 활성 찜이 있는 사람', () => {
    const again = sms('r9', 16, { phoneKey: KEY_A, phoneLast4: '5678' })
    const after = run([...BASE, again])
    const data = fromFull(viewOf(after.state, after.seq))
    // 엔진: 찜을 만들지 않았다 (r9의 찜이 없다)
    expect([...data.claims.values()].some((claim) => claim.seq === after.seq)).toBe(false)
    const holder = smsHolder(data, 'b1/16', null, '5678')
    expect(holder?.buyer).toBe('sms:r1')
    expect(holder?.claim.status).toBe('CONFIRMED')
    // 다른 번호(뒤 4자리 1111)는 16에 찜이 없다
    expect(smsHolder(data, 'b1/16', null, '1111')).toBeUndefined()
    // 전화번호도 지정 구매자도 없으면 정할 것이 없다
    expect(smsHolder(data, 'b1/16', null, null)).toBeUndefined()
  })

  it('지정 구매자: 그 구매자(합쳐져 있으면 지금의 구매자)의 활성 찜', () => {
    const data = dataOf([...BASE, { type: 'buyer.merge', from: 'sms:r3', into: 'UC_kim5555', reason: '같은 사람' }])
    expect(smsHolder(data, 'b1/15', 'UC_hong1234', null)?.claim.currentBuyer).toBe('UC_hong1234')
    expect(smsHolder(data, 'b1/17', 'sms:r3', null)).toMatchObject({ buyer: 'sms:r3', claim: { currentBuyer: 'UC_kim5555' } })
    expect(smsHolder(data, 'b1/16', 'UC_kim5555', null)).toBeUndefined()
  })

  it('같은 뒤 4자리의 문자 구매자 여럿이 한 사람에 합쳐져 있으면 그 지금의 구매자, 서로 다른 사람이면 정하지 않는다', () => {
    const KEY_C = 'phonekey-cccccccccccc'
    const two = [...BASE, sms('r7', 17, { phoneKey: KEY_C, phoneLast4: '5678' })]
    // r1(16 1등)과 r7(17 대기) — 다른 사람, 17에는 r7과 김철수: 뒤 4자리 5678 중 17에 찜이 있는 사람은 r7 하나
    expect(smsHolder(dataOf(two), 'b1/17', null, '5678')?.buyer).toBe('sms:r7')
    // 둘 다 15에 찜 → 누구인지 정하지 않는다
    const both = [...two, sms('r8', 15, { phoneKey: KEY_C, phoneLast4: '5678' })]
    expect(smsHolder(dataOf(both), 'b1/15', null, '5678')).toBeUndefined()
    // r7을 r1에 합치면(같은 사람) 15의 활성 찜은 한 사람(r1의 지금의 구매자) — 문자 구매자가 둘이라 지금의 구매자로
    const merged = dataOf([...both, { type: 'buyer.merge', from: 'sms:r7', into: 'sms:r1', reason: '같은 사람' }])
    expect(smsHolder(merged, 'b1/15', null, '5678')?.buyer).toBe('sms:r1')
  })
})
