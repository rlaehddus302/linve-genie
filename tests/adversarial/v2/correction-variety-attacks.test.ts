// V2 적대 시험 (test-domain, AC-V2-04~06·AC-V2-10·AC-V2-19·AC-V2-21·AC-V2-33, D-V2-01·02·05·06·10): 정정·품종 바로잡기를 공격한다.
// 노리는 것: 정정이 엉뚱한 칸·카드를 고침, 흔한 말이 품종으로 채워짐, 낮은 확신인데 자동 확정, 후보 규칙 어김, 예외.
import {
  STOP_WORDS,
  chooseAction,
  prepareVoiceDictionary,
  readChunk,
  splitCorrections,
  varietyCandidates,
  type RecentRegistration,
} from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DICT, openCards, simulate, view } from './sim.ts'

const read = (text: string) => readChunk(text, { dictionary: DICT })
const recentAt = (registeredAt: number, undoUntil: number | null = null): RecentRegistration => ({ id: 'p15', no: 15, name: '핑크문', price: 15_000, registeredAt, undoUntil })
const S1 = () => simulate([{ text: '15번 핑크 문 만오천원', at: 0 }], 1800).cards

describe('정정 (D-V2-05·06)', () => {
  it.each([
    ['15번 핑크문 만오천원 만오천 말고 만팔천', 15, '핑크문', 18_000],
    ['15번 핑크문 만오천원 만오천말고 만팔천', 15, '핑크문', 18_000],
    ['22번 라울 만원 아니 아니 23번', 23, '라울', 10_000],
    ['22번 라울 만원 아니 아니 아니 23번', 23, '라울', 10_000],
    ['24번 핑크문 만원 품종은 루비', 24, '루비', 10_000],
    ['15번 핑크문 만원 아니 다시 만이천원', 15, '핑크문', 12_000],
    ['15번 핑크문 말고 루비 만원', 15, '루비', 10_000],
    ['15번 핑크문 만원 아니요 이만원', 15, '핑크문', 20_000],
    ['15번 핑크문 만원 가격은 이만', 15, '핑크문', 20_000],
    ['15번 핑크문 만원 취소 16번 루비 이만원', 16, '루비', 20_000],
  ])('덩어리 안 정정 "%s" → %i번 · %s · %i원, 자동 확정 없음(LOW)', (text, no, name, price) => {
    const r = read(text)
    expect([r.no, r.name, r.price, r.confidence, r.cancel]).toEqual([no, name, price, 'LOW', false])
  })

  it.each(['21번 핑크문 만원 취소', '21번 핑크문 만원 취소요', '21번 핑크문 만원 아니 만팔천 취소', '21번 핑크문 만원 취소할게요'])('"%s" → 취소(그 덩어리 버림)', (text) => {
    const r = read(text)
    expect(r.cancel).toBe(true)
    expect(chooseAction(r, { cards: [], now: 0 }).kind).toBe('discard')
  })

  it('S5 열린 카드 + "아니 만팔천" → 같은 카드 가격만 18,000, 다른 칸 그대로, 손댄 카드', () => {
    const r = simulate([{ text: '아니 만팔천', at: 3000 }], 4800, { cards: S1() })
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: '핑크문', price: 18_000 }])
    expect(r.cards[0]?.touched).toBe(true)
    expect(r.cards[0]?.autoConfirmAt ?? null).toBeNull()
  })

  it('열린 카드 + "품종은 루비" → 품종만 바뀐다(번호·가격 그대로)', () => {
    const r = simulate([{ text: '품종은 루비', at: 3000 }], 4800, { cards: S1() })
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: '루비', price: 15_000 }])
  })

  it('열린 카드 + "취소 아니 만팔천"(취소 뒤에 칸) → 닫지 않고 가격 18,000으로 고침', () => {
    const r = simulate([{ text: '취소 아니 만팔천', at: 3000 }], 4800, { cards: S1() })
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: '핑크문', price: 18_000 }])
  })

  it('S12 열린 카드 + "취소" → 닫힘, S18 "아니 이거 너무 예쁘죠" → 그대로 + "번호와 가격이 안 들렸어요"', () => {
    expect(openCards(simulate([{ text: '취소', at: 3000 }], 4800, { cards: S1() }).cards)).toEqual([])
    const r = simulate([{ text: '아니 이거 너무 예쁘죠', at: 0 }], 1800, { cards: S1() })
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: '핑크문', price: 15_000 }])
    expect(r.log[0]?.reason).toBe('번호와 가격이 안 들렸어요')
  })

  it('"말고"·"아니"만 / "품종은"만 → 아무 칸도 고치지 않는다', () => {
    for (const text of ['말고', '아니', '아니 아니', '품종은', '가격은', '번호는', '다시']) {
      const r = simulate([{ text, at: 3000 }], 4800, { cards: S1() })
      expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: '핑크문', price: 15_000 }])
    }
  })

  it('S19·S20 등록 상품 60초 경계: 정확히 60000ms 전은 고칠까요, 60001ms 전은 "고칠 카드가 없어요"', () => {
    const now = 100_000
    expect(chooseAction(read('만오천 말고 만팔천'), { cards: [], recent: [recentAt(now - 60_000)], now }).kind).toBe('offer')
    expect(chooseAction(read('만오천 말고 만팔천'), { cards: [], recent: [recentAt(now - 60_001)], now })).toEqual({ kind: 'discard', reason: '고칠 카드가 없어요', cancelled: false })
  })

  it('등록 상품은 저절로 바뀌지 않는다: 고칠까요·번호·되돌릴까요만', () => {
    const now = 10_000
    const kinds = ['아니 만팔천', '품종은 루비', '아니 16번', '번호는 십육', '취소'].map((t) => chooseAction(read(t), { cards: [], recent: [recentAt(now - 3000, now + 1000)], now }).kind)
    expect(kinds).toEqual(['offer', 'offer', 'offerNumber', 'offerNumber', 'offerUndo'])
  })

  it('S15 칸 이름 사전 밖 글: 숫자 든 글·21글자 글은 품종이 되지 않는다', () => {
    expect(read('25번 만원 품종은 하얀 별').name).toBe('하얀 별')
    expect(read('25번 만원 품종은 하얀 별').nameNeedsCheck).toBe(true)
    expect(read('25번 만원 품종은 3호 화분').name).toBeNull()
    expect(read(`25번 만원 품종은 ${'가'.repeat(21)}`).name).toBeNull()
    expect(read(`25번 만원 품종은 ${'가'.repeat(20)}`).name).toBe('가'.repeat(20))
  })

  it('이어 채우기는 빈 칸만: 가격 있는 카드에 "이만원" → 바꾸지 않고 "이미 있는 값과 달라 쓰지 않았어요"', () => {
    const cards = simulate([{ text: '15번 만오천원', at: 0 }], 1800).cards
    const r = simulate([{ text: '이만원', at: 3000 }], 4800, { cards })
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: null, price: 15_000 }])
    expect(r.log[0]?.reason).toBe('이미 있는 값과 달라 쓰지 않았어요')
  })
})

describe('품종 바로잡기 (D-V2-01·02)', () => {
  it.each([
    ['15번 핑크 문 만오천원', '핑크문', 'HIGH'],
    ['16번 블루 엘프 만원', '블루엘프', 'HIGH'],
    ['17번 부루엘프 만원', '블루엘프', 'HIGH'],
    ['18번 라운 만이천원', '라울', 'LOW'],
    ['26번 엘레강스 만원', '엘레강스', 'HIGH'],
    ['26번 엘레간스 만원', '엘레강스', 'HIGH'],
  ])('"%s" → %s (%s)', (text, name, confidence) => {
    const r = read(text)
    expect([r.name, r.confidence]).toEqual([name, confidence])
  })

  it('S9 선버스 → 빈칸, 후보 첫째 선버스트 77, 자동 확정 없음', () => {
    const r = read('19번 선버스 팔천원')
    expect(r.name).toBeNull()
    expect(r.candidates[0]).toMatchObject({ name: '선버스트', score: 77 })
    expect(r.confidence).toBe('LOW')
  })

  it('레드애보니: 후보 첫째 레드에보니 100점, 그러나 R-17 채움은 접기 없이 LOW', () => {
    expect(varietyCandidates('레드애보니', DICT)[0]).toMatchObject({ name: '레드에보니', score: 100 })
    const r = read('15번 레드애보니 만원')
    expect([r.name, r.confidence]).toEqual(['레드에보니', 'LOW'])
  })

  it('막는 낱말(칸 이름·정정 표시 빼고)은 어느 것도 "15번 X 만원"에서 품종이 되지 않는다', () => {
    const markers = new Set(['품종', '가격', '번호', '취소', '아니', '아니요', '다시', '말고', '정정', '문자찜'])
    for (const word of STOP_WORDS.filter((w) => !markers.has(w))) expect([word, read(`15번 ${word} 만원`).name]).toEqual([word, null])
  })

  // TD-V2-002: 칸 이름(`품종`·`품종은`·`이름은`) 조각이 사전에 없으면 나머지 글을 그대로 품종으로 두는데(S15), 막는 낱말·가격 말까지 품종이 된다.
  // "15번 품종 만원" → 품종 "만원"(가격은 빈칸). 막는 목록(D-V2-02)은 "말버릇이 품종 칸에 들어가지 않게" 하려는 것 — 가격 말·말버릇이 라벨에 찍힌다.
  it.each([
    ['15번 품종 만원', '만원'],
    ['15번 만원 품종은 그거', '그거'],
    ['15번 만원 품종은 이거', '이거'],
    ['15번 만원 이름은 천원', '천원'],
  ])('TD-V2-002: "%s" → 품종이 막는 낱말 "%s"가 되지 않는다', (text, word) => {
    expect(read(text).name).not.toBe(word)
  })

  it('흔한 방송 말은 품종으로 채워지지 않는다', () => {
    const words = '예쁜 귀여운 통통해요 요거 애기 한번 보여드릴게요 이뻐요 색감 단풍 화분 포함 무료배송 택배 사장님 언니 고객님 구독 라이브 방송 마감 품절 대기 찜 선착순 엄청 너무 정말 작은 대품 소품 군생 뿌리 엄마 선물 랜덤 세트 묶음'.split(' ')
    for (const word of words) expect([word, read(`15번 ${word} 만원`).name]).toEqual([word, null])
  })

  it('품종에 숫자 수사가 든 이름(천사의눈물·십이지권·칠복수·백모단)은 가격·번호를 망치지 않는다', () => {
    expect(view(simulate([{ text: '15번 천사의눈물 만원', at: 0 }], 1800).cards[0])).toEqual({ no: 15, name: '천사의눈물', price: 10_000 })
    expect([read('15번 십이지권 만원').no, read('15번 십이지권 만원').price]).toEqual([15, 10_000])
    expect([read('15번 칠복수 오천원').no, read('15번 칠복수 오천원').price]).toEqual([15, 5000])
    expect([read('15번 백모단 오천원').no, read('15번 백모단 오천원').price]).toEqual([15, 5000])
  })

  it('배운 별칭이 기본 사전보다 앞: 선버스 → 선버스트 HIGH, 판매 이력이 기본 사전보다 앞', () => {
    const d = prepareVoiceDictionary({ learned: [{ heard: '선버스', name: '선버스트', usedAt: 1 }] })
    const r = readChunk('30번 선버스 팔천원', { dictionary: d })
    expect([r.name, r.confidence]).toEqual(['선버스트', 'HIGH'])
  })

  it('속성: 후보는 3개 이하·점수 정수 60~100·높은 순(같으면 글자 순)·이름당 한 번, 1음절 글엔 후보 없음', () => {
    const syll = fc.constantFrom('핑', '크', '문', '선', '버', '스', '트', '라', '울', '운', '엘', '레', '강', '루', '비', '블', '프', '애', '보', '니')
    fc.assert(
      fc.property(fc.array(fc.array(syll, { minLength: 1, maxLength: 6 }).map((a) => a.join('')), { maxLength: 4 }), (words) => {
        const text = words.join(' ')
        const list = varietyCandidates(text, DICT)
        expect(list.length).toBeLessThanOrEqual(3)
        expect(new Set(list.map((c) => c.name)).size).toBe(list.length)
        for (const c of list) {
          expect(Number.isInteger(c.score)).toBe(true)
          expect(c.score).toBeGreaterThanOrEqual(60)
          expect(c.score).toBeLessThanOrEqual(100)
          expect([...c.heard].length).toBeGreaterThanOrEqual(2)
        }
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1]!
          const b = list[i]!
          expect(a.score > b.score || (a.score === b.score && a.name < b.name)).toBe(true)
        }
        if (words.length === 1 && [...(words[0] as string)].length === 1) expect(list).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})

describe('순수성·정수·예외 없음 (AC-V2-33)', () => {
  const nasty = fc.oneof(
    fc.string({ maxLength: 50 }),
    fc.string({ unit: 'grapheme', maxLength: 40 }),
    fc.constantFrom('', ' ', '말고', '말고말고', '아니 '.repeat(200), '가'.repeat(301), '​15번​ 핑크문 만원', '１５번 핑크문 만원', '15번\t핑크문\n만원', '<script>alert(1)</script> 15번 만원', '15번 핑크문 구억구천구백구십구만원', '999999999999번 핑크문 만원'),
    fc.array(fc.constantFrom('15번', '십오번', '핑크문', '만원', '만오천말고', '아니', '취소', '품종은', '가격은', '번호는', '16', '라운', '선버스', '문자찜', '😀'), { maxLength: 12 }).map((a) => a.join(' ')),
  )

  it('같은 입력 → 같은 출력, 예외 없음, 가격·번호는 정수(또는 null), 넘긴 사전은 그대로', () => {
    const before = DICT.size
    fc.assert(
      fc.property(nasty, (text) => {
        const a = readChunk(text, { dictionary: DICT })
        const b = readChunk(text, { dictionary: DICT })
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
        expect(JSON.stringify(splitCorrections(text, { dictionary: DICT }))).toBe(JSON.stringify(splitCorrections(text, { dictionary: DICT })))
        expect(JSON.stringify(varietyCandidates(text, DICT))).toBe(JSON.stringify(varietyCandidates(text, DICT)))
        for (const v of [a.no, a.price]) if (v !== null) expect(Number.isSafeInteger(v) && v >= 0).toBe(true)
        if (a.no !== null) expect(a.no).toBeLessThanOrEqual(999)
        const action = chooseAction(a, { cards: S1Cards, recent: [recentAt(-1000, 1000)], now: 0 })
        expect(typeof action.kind).toBe('string')
      }),
      { numRuns: 1000 },
    )
    expect(DICT.size).toBe(before)
  })

  it('잘못된 모양의 인자에도 예외 없음', () => {
    for (const bad of [null, undefined, 42, {}, [], Symbol.iterator.toString()]) {
      expect(() => readChunk(bad, { dictionary: bad as never, maxNumber: bad as never })).not.toThrow()
      expect(() => splitCorrections(bad)).not.toThrow()
      expect(() => varietyCandidates(bad, bad)).not.toThrow()
    }
  })
})
const S1Cards = S1()
