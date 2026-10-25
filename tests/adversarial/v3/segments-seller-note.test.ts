// V3 적대 시험 (test-domain, R-17 8 조각·R-23, D-V3-46·47·48·49·51, 사례 R54~R68): 덩어리 조각 소비(readSegments)와 판매자 채팅 품종 글(readSellerNote)을 공격한다.
// 노리는 것: 이어 말한 여러 상품이 엉뚱하게 짝지어짐, 대화 속 '아니'·'다시'가 정정이 됨, 가격 뒤 번호가 중간 결과에서 짝지어짐, 원 없는 수가 가격이 됨,
// 판매자 글이 아닌 모양에서 품종을 배움, 대괄호·₩ 여럿, 품종 글에 태그·이모지.
import { readSegments, readSellerNote, prepareVoiceDictionary, type SegmentOptions } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const seg = (text: string, options: SegmentOptions = {}) => readSegments(text, { dictionary: DICT, final: true, ...options })
const picks = (text: string, options: SegmentOptions = {}) => seg(text, options).picks.map((p) => ({ no: p.no, name: p.name, price: p.price }))

describe('조각 소비 — 사례 표 R54~R68', () => {
  it.each([
    ['R54 이어 말한 두 상품', '93번 청개구리 7만 원 97번 23만 원', [{ no: 93, name: '청개구리', price: 70_000 }, { no: 97, name: null, price: 230_000 }], []],
    ['R55 앞 번호는 가격 없이 버림 + 알림', '93번 청개구리 97번 23만 원', [{ no: 97, name: null, price: 230_000 }], [93]],
    ['R56 번호 없던 앞 가격은 버림', '만 원짜리 아니고요 97번 23만 원', [{ no: 97, name: null, price: 230_000 }], []],
    ['R57 남은 번호는 알림', '108번 10만 원 109번', [{ no: 108, name: null, price: 100_000 }], [109]],
    ['R58 조각 둘', '107번 10만 원 108번 12만 원', [{ no: 107, name: null, price: 100_000 }, { no: 108, name: null, price: 120_000 }], []],
    ['R65 대화 속 아니', '자 55번 갑니다 55번 자 요거 만 원 아니 가격이 좀 있는 거부터 달라니까', [{ no: 55, name: null, price: 10_000 }], []],
    ['R68 대화 속 다시', '자 다시 보여 드릴게요 15번 라울 만 원', [{ no: 15, name: '라울', price: 10_000 }], []],
    ['실제 방송 6 (189·139)', '어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요', [{ no: 139, name: null, price: 500_000 }], [189]],
  ] as const)('%s: "%s"', (_title, text, want, others) => {
    const r = seg(text)
    expect(r.picks.map((p) => ({ no: p.no, name: p.name, price: p.price }))).toEqual(want)
    expect(r.others).toEqual(others)
  })

  it('R59 등록 뒤 같은 덩어리의 원 없는 수(110)는 가격이 아니고 80번은 가격 없음 → 고를 것 없음, 80번 알림만', () => {
    const r = seg('97번 23만 원 자 요거 갑니다 자 110 자 갑니다 요거는 수수료도 안 나오겠네 자 9cm 자 9cm 80번 자요렇게 해주시고요')
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[97, 230_000]])
    expect(r.others).toEqual([80])
    expect(r.tail).toBeNull()
  })

  it.each([
    ['R60', '108번 10만원 아니 12만원', 108, 100_000, 'correction'],
    ['R66', '55번 만 원 아니 만오천 원', 55, 10_000, 'correction'],
    ['R20', '21번 핑크문 만원 취소', 21, 10_000, 'cancel'],
  ] as const)('%s "%s" → %i번 %i원 고르고, 남은 조각이 정정·취소면 그 번호로 tail', (_t, text, no, price, kind) => {
    const r = seg(text)
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[no, price]])
    expect(r.tail?.kind).toBe(kind)
    expect(r.tail?.no).toBe(no)
  })

  it.each([
    ['R61 최종 "92번 빅뱅 60"(천원) → 60,000원', '92번 빅뱅 60', true, [{ no: 92, name: '빅뱅', price: 60_000 }]],
    ['R62 중간 결과 "92번 빅뱅 60"은 기다림', '92번 빅뱅 60', false, []],
    ['R62 이어 "92번 빅뱅 60만 원" → 600,000원', '92번 빅뱅 60만 원', false, [{ no: 92, name: '빅뱅', price: 600_000 }]],
    ['R63 "92번 빅뱅 6만 자" → 60,000원(적힌 대로)', '92번 빅뱅 6만 자', false, [{ no: 92, name: '빅뱅', price: 60_000 }]],
    // D-V3-63: 품종 없는 "N번 수"도 조각 끝 + 최종이면 가격 단위로 확정 (처음 기대 "확정 아님"을 바꿈), 중간 결과면 기다림
    ['R64 품종 없음 "92번 60"(최종)', '92번 60', true, [{ no: 92, name: null, price: 60_000 }]],
    ['R64 군말만 "92번 저거 60"(최종)', '92번 저거 60', true, [{ no: 92, name: null, price: 60_000 }]],
    ['R64 중간 결과 "92번 60"', '92번 60', false, []],
  ] as const)('%s', (_t, text, final, want) => {
    expect(picks(text, { final, priceUnit: 'THOUSAND' })).toEqual(want)
  })

  it('R62 낱말 하나씩 늘려 넣기 "92번 빅뱅 60만 원"(천원): 어느 중간 결과에서도 60,000원을 고르지 않는다', () => {
    const tokens = '92번 빅뱅 60만 원'.split(' ')
    for (let k = 1; k <= tokens.length; k++) {
      for (const p of seg(tokens.slice(0, k).join(' '), { final: k === tokens.length, priceUnit: 'THOUSAND' }).picks) expect(p.price).toBe(600_000)
    }
    const spaced = '92번 빅뱅 60 만 원'.split(' ')
    for (let k = 1; k <= spaced.length; k++) {
      for (const p of seg(spaced.slice(0, k).join(' '), { final: k === spaced.length, priceUnit: 'THOUSAND' }).picks) expect(p.price, spaced.slice(0, k).join(' ')).toBe(600_000)
    }
  })

  it.each([
    ['R69 "육십팔번 이십오"(만원, 최종) → 68번 · 250,000원', '육십팔번 이십오', true, [{ no: 68, name: null, price: 250_000 }]],
    ['R70 중간 결과 "육십팔번 이십오" → 기다림', '육십팔번 이십오', false, []],
    ['R70 이어 "육십팔번 이십오만 원" → 250,000원', '육십팔번 이십오만 원', false, [{ no: 68, name: null, price: 250_000 }]],
    ['R71 뒤 단위 낱말 "68번 25 개" → 가격 아님', '68번 25 개', true, []],
    ['뒤 단위 낱말 "68번 25 마리"·"68번 9 cm"', '68번 25 마리', true, []],
    ['R72 수 뒤 군말만 "68번 이십오 자 요거" → 250,000원', '68번 이십오 자 요거', true, [{ no: 68, name: null, price: 250_000 }]],
    ['R73 한 자리 수 "68번 3" → 번호 비움', '68번 3', true, []],
    ['한 글자 한글 수 "68번 오" → 번호 비움', '68번 오', true, []],
    ['수 뒤에 다른 낱말 "68번 25 뿌리" → 조각 끝 아님', '68번 25 뿌리', true, []],
  ] as const)('D-V3-63 %s', (_t, text, final, want) => {
    expect(picks(text, { final, priceUnit: 'TEN_THOUSAND' })).toEqual(want)
  })

  it('D-V3-63 만원 단위 300만 원 초과 "68번 400"(최종) → 4,000,000원은 막힘(카드 "가격 확인 필요"), 딱 300 = 3,000,000원은 바로', () => {
    const over = seg('68번 400', { priceUnit: 'TEN_THOUSAND' }).picks
    expect(over.map((p) => [p.no, p.price, p.blocked !== null])).toEqual([[68, 4_000_000, true]])
    const edge = seg('68번 300', { priceUnit: 'TEN_THOUSAND' }).picks
    expect(edge.map((p) => [p.no, p.price, p.blocked])).toEqual([[68, 3_000_000, null]])
  })

  it('D-V3-63 낱말 하나씩 늘려 넣기: 품종 없는 "N번 수"는 어느 중간 결과에서도 고르지 않는다', () => {
    for (const text of ['육십팔번 이십오', '68번 25', '자 92번 저거 60', '92번 60 자']) {
      const tokens = text.split(' ')
      for (let k = 1; k <= tokens.length; k++) {
        const quick = seg(tokens.slice(0, k).join(' '), { final: false, priceUnit: 'TEN_THOUSAND' }).picks.filter((p) => p.priceFrom === 'quick' && p.name === null)
        expect(quick, tokens.slice(0, k).join(' ')).toEqual([])
      }
    }
  })

  it('가격 뒤 번호 꼴("10만 원 108번")은 덩어리 끝(final)에서만 짝짓는다 (D-V3-46, 실제 방송 2)', () => {
    expect(picks('10만 원 108번', { final: false })).toEqual([])
    expect(picks('10만 원 108번', { final: true })).toEqual([{ no: 108, name: null, price: 100_000 }])
    expect(picks('자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { final: false })).toEqual([])
    expect(picks('자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { final: true })).toEqual([{ no: 108, name: null, price: 100_000 }])
  })

  // 시청자 번호 섞임 위험: 판매자가 시청자 말을 읽으면 그 번호가 원 가격 바로 앞 N번이 되어 짝지어진다(스펙대로). 앞 번호는 알림(others)으로 반드시 남아야 한다.
  it('위험 사례: "15번 라울 지영님 3번 달래요 만 원" → 스펙대로 3번 · 10,000원이고 15번은 알림에 남는다', () => {
    const r = seg('15번 라울 지영님 3번 달래요 만 원')
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[3, 10_000]])
    expect(r.others).toEqual([15])
  })
  // D-V3-54: `1 5번`은 앞 수와 합쳐 15번 — 같은 번호 되풀이라 15번 · 10,000원 하나 (처음 기대 "고르지 않음"을 바꿈). 자리가 겹치면 비움
  it('"15번 1 5번 만 원" → 15번 · 10,000원, 겹치는 "오 13번 만 원"·"50 13번 만 원" → 고르지 않음', () => {
    expect(picks('15번 1 5번 만 원')).toEqual([{ no: 15, name: null, price: 10_000 }])
    expect(picks('오 13번 만 원')).toEqual([])
    expect(picks('50 13번 만 원')).toEqual([])
  })
})

describe('조각 소비 — 성질', () => {
  const VOCAB = [
    '15번', '16번', '93번', '97번', '108번', '15 번', '일육팔번', '170', '1', '5번', '만 원', '23만 원', '10만원', '7만 원까지', '만오천', '60', '6만', '605만 원', '라울', '청개구리', '빅뱅',
    '자', '요거', '갑니다', '아니', '아니고요', '다시', '말고', '취소', '가격이', '보여', '9cm', '지영님', '달래요', '그런가요',
  ] as const
  it('고른 값: 번호 1..999 · 가격 100원 이상 · 300만 원 넘으면 막힘 표시 · 조각이 겹치지 않고 차례대로 · 원 가격이면 조각 안에 원 토큰, 품종 없는 빠른 꼴은 최종만', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 14 }), fc.boolean(), fc.constantFrom<'WON' | 'THOUSAND'>('WON', 'THOUSAND'), (parts, final, priceUnit) => {
        const r = readSegments(parts.join(' '), { dictionary: DICT, final, priceUnit })
        let last = -1
        for (const p of r.picks) {
          expect(p.no).toBeGreaterThanOrEqual(1)
          expect(p.no).toBeLessThanOrEqual(999)
          expect(p.price).toBeGreaterThanOrEqual(100)
          expect(Number.isSafeInteger(p.price)).toBe(true)
          if (p.price > 3_000_000) expect(p.blocked).not.toBeNull()
          expect(p.start).toBeGreaterThan(last)
          expect(p.end).toBeGreaterThanOrEqual(p.start)
          last = p.end
          const piece = r.tokens.slice(p.start, p.end + 1)
          if (p.priceFrom === 'won') expect(piece.some((t) => /원/.test(t)), piece.join(' ')).toBe(true)
          // 번호는 N번 표시, 아니면 가격 앞의 '번' 없는 번호(R-17 3, `170 25만 원` — D-V3-25 자리 겹침)
          if (p.numberFrom === 'marker') expect(piece.some((t) => /번/.test(t)), `번호 없는 조각: ${piece.join(' ')}`).toBe(true)
          else expect(piece.findIndex((t) => /^[0-9일이삼사오육칠팔구십백천]+$/.test(t))).toBeLessThan(piece.findIndex((t) => /원/.test(t)))
          // D-V3-63: 품종 없는 빠른 꼴은 최종일 때만 (D-V3-48 품종 있는 꼴은 수가 글 끝이 아니면 중간 결과도)
          if (p.priceFrom === 'quick' && p.name === null) expect(final, `중간 결과에서 품종 없는 빠른 꼴: ${piece.join(' ')}`).toBe(true)
        }
        // 중간 결과에서 가격 뒤 번호 꼴은 짝짓지 않는다: 원 토큰보다 번호가 뒤에만 있는 조각은 final일 때만
        if (!final) for (const p of r.picks) {
          const piece = r.tokens.slice(p.start, p.end + 1)
          const firstWon = piece.findIndex((t) => /원/.test(t))
          if (p.priceFrom === 'won' && p.numberFrom === 'marker' && firstWon >= 0) expect(piece.slice(0, firstWon).some((t) => /번/.test(t)), `중간 결과에서 가격 뒤 번호: ${piece.join(' ')}`).toBe(true)
        }
      }),
      { numRuns: 1500 },
    )
  })

  it('어떤 입력에도 예외를 던지지 않는다', () => {
    for (const x of [null, undefined, 3, {}, [], '', '   ', '번 원', 'a'.repeat(5000), '15번 '.repeat(200) + '만 원']) expect(() => readSegments(x, { dictionary: DICT })).not.toThrow()
  })
})

describe('R-23 판매자 채팅 품종 글 (readSellerNote)', () => {
  it.each([
    ['93번🍀[청개구리] ₩70,000 [용용]님 감사합니다🍀', { no: 93, name: '청개구리', price: 70_000 }],
    ['[공지] 93번 [청개구리] ₩70,000', { no: 93, name: '청개구리', price: 70_000 }],
    ['93번[청개구리][녹금] ₩70,000', { no: 93, name: '청개구리', price: 70_000 }], // 번호 뒤 ₩ 앞 첫 대괄호
    ['93번 [ 청개구리 ] ₩ 70,000', { no: 93, name: '청개구리', price: 70_000 }],
    ['９３번 [청개구리] ₩７０,０００', { no: 93, name: '청개구리', price: 70_000 }],
    ['93번 [Pink Frill] ₩70,000', { no: 93, name: 'Pink Frill', price: 70_000 }],
  ])('"%s" → 읽음', (text, want) => {
    expect(readSellerNote(text)).toEqual(want)
  })

  it.each([
    ['₩ 여럿', '93번[청개구리] ₩70,000 ₩5,000'],
    ['다른 번호 둘', '93번 [청개구리] 94번 ₩70,000'],
    ['번째도 숫자번', '93번 [청개구리] ₩70,000 3번째'],
    ['첫 대괄호가 빔', '93번[] [청개구리] ₩70,000'],
    ['품종이 번호 앞', '[청개구리] 93번 ₩70,000'],
    ['품종이 ₩ 뒤 (손님 이름 자리)', '93번 ₩70,000 [청개구리]'],
    ['태그', '93번 [<b>x</b>] ₩70,000'],
    ['이모지 품종', '93번 [청개구리🍀] ₩70,000'],
    ['한 글자', '93번 [청] ₩70,000'],
    ['21글자', '93번 [가나다라마바사아자차카타파하가나다라마바사] ₩70,000'],
    ['100원 미만', '93번 [청개구리] ₩99'],
    ['틀린 쉼표', '93번 [청개구리] ₩70,00'],
    ['소수', '93번 [청개구리] ₩7.5'],
    ['다섯 자리 번호', '12345번 [청개구리] ₩70,000'],
    ['0번', '0번 [청개구리] ₩70,000'],
    ['범위 밖', '1000번 [청개구리] ₩70,000'],
    ['한글 번호', '구십삼번 [청개구리] ₩70,000'],
    ['₩ 없음', '93번 [청개구리] 70,000원'],
    ['아주 큰 수', '93번 [청개구리] ₩9007199254740993'],
    ['손님 글 꼴', '[용용] 93번 주세요 ₩70,000 입금했어요'],
  ])('%s "%s" → null', (_t, text) => {
    expect(readSellerNote(text)).toBeNull()
  })

  // TD-V3-004: R-23 3 가격은 "R-14 3 숫자 형식"이다 — 0이 아닌데 0으로 시작하면 실패(`0500`). 구현은 `₩0500`을 500원으로 읽는다.
  it.each(['93번 [청개구리] ₩0500', '93번 [청개구리] ₩070,000'])('TD-V3-004: "%s" → null (0으로 시작하는 수)', (text) => {
    expect(readSellerNote(text)).toBeNull()
  })

  it('maxNumber 밖 번호는 null', () => {
    expect(readSellerNote('93번 [청개구리] ₩70,000', { maxNumber: 90 })).toBeNull()
    expect(readSellerNote('90번 [청개구리] ₩70,000', { maxNumber: 90 })?.no).toBe(90)
  })

  it('무작위 글: 예외 없음, 결과면 품종은 2~20글자 한글·로마자·공백뿐(이스케이프할 글자 없음), 가격 100원 이상 정수', () => {
    const piece = fc.constantFrom('93번', '94번', '🍀', '[', ']', '[청개구리]', '[<script>]', '₩', '₩70,000', ' ', '님', '감사합니다', '&amp;', '"', "'", '[용용]', '0', '5', ',', '번째', 'Pink', '\n', '\t', '​')
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 16 }), (parts) => {
        const r = readSellerNote(parts.join(''))
        if (r === null) return
        expect(/^[가-힣A-Za-z ]{2,20}$/.test(r.name), r.name).toBe(true)
        expect(r.name).toBe(r.name.trim())
        expect(Number.isSafeInteger(r.price) && r.price >= 100).toBe(true)
        expect(r.no >= 1 && r.no <= 999).toBe(true)
      }),
      { numRuns: 2000 },
    )
    for (const x of [null, undefined, 3, {}, [], 'a'.repeat(100_000)]) expect(() => readSellerNote(x)).not.toThrow()
  })
})
