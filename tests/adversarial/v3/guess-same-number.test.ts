// V3 적대 시험 (test-domain, AC-V3-61·AC-V3-63, R-17 7·R-22, D-V3-06·D-V3-07·D-V3-09): 품종 추측과 음성 같은 번호를 공격한다.
// 노리는 것: 군말·막는 낱말·정정·칸 이름(끝말 붙은 꼴·대문자 UI 포함)이 품종 칸에 들어감, 추측이 있는 품종을 덮음,
// 찜이 있는데 가격을 바로 고침, 판매 중이 아닌 상품을 바로 고침, 같은 말인데 카드가 생김.
import {
  CANCEL_WORDS,
  CORRECTION_MARKERS,
  FIELD_NAMES,
  GUESS_FILLERS,
  STOP_WORDS,
  decideForExisting,
  isBigChange,
  decideSameNumber,
  guessVariety,
  readRegistration,
  readSegments,
  prepareVoiceDictionary,
  type NameFrom,
  type SameNumberInput,
  type SameNumberStatus,
} from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()

/** R-17 2 끝말 (V3 — 까지·인데 포함) */
const ENDINGS = ['이에요', '예요', '에요', '입니다', '이요', '이고', '이랑', '하고', '짜리', '에는', '은', '는', '이', '가', '을', '를', '에', '엔', '도', '요', '랑', '까지', '인데']

/** R-17 7 군말 목록 (스펙 문장 그대로 옮김 — 구현 목록을 믿지 않는다) */
const SPEC_FILLERS = (
  '요거 이거 그거 저거 요것 이것 그것 저것 요건 이건 그건 저건 요게 이게 그게 저게 요놈 이놈 얘 쟤 걔 아이 요아이 유아이 그대로 보냅니다 보내요 보내드려요 ' +
  '보내드릴게요 봅니다 봐요 보여요 드려요 드립니다 드릴게요 갑니다 가요 나갑니다 나가요 할게요 해요 합니다 있어요 있습니다 있고요 없어요 들었어요 나왔습니다 ' +
  '남았고요 예쁘게 진짜 정말 완전 너무 엄청 아주 되게 많이 일단 이제 지금 오늘 여기 거기 저기 이렇게 요렇게 그렇게 그러면 그럼 그리고 그래서 네네 예예 자자 ' +
  '여러분 사장님 언니 고객님 다음 다음은 이번 분양 분양합니다'
).split(' ')

const LIST = [...new Set([...SPEC_FILLERS, ...GUESS_FILLERS, ...STOP_WORDS, ...CORRECTION_MARKERS, ...CANCEL_WORDS, ...Object.keys(FIELD_NAMES), 'ui', 'UI', 'Ui'])]
const compact = (text: string) => text.toLowerCase().split(' ').join('')
const LIST_KEYS = new Set(LIST.map(compact))

describe('AC-V3-63 — 품종 추측은 군말·막는 낱말·정정·칸 이름을 내지 않는다', () => {
  it('스펙 군말 목록이 구현 목록에 모두 들어 있다', () => {
    const impl = new Set(GUESS_FILLERS)
    expect(SPEC_FILLERS.filter((word) => !impl.has(word))).toEqual([])
  })

  it('목록 낱말 하나(그대로·끝말 붙임·대문자)를 번호 앞뒤·두 번 되풀이해도 추측이 되지 않는다', () => {
    const misses: string[] = []
    for (const listed of LIST.filter((w) => !w.includes(' '))) {
      for (const form of [listed, listed.toUpperCase(), ...ENDINGS.map((ending) => listed + ending)]) {
        for (const text of [`15번 ${form} 만원`, `${form} 15번 만원`, `자 ${form} 자 ${form} 15번 만원`, `15번 ${form} ${form} 10만 원`, `168 ${form} 25만 원`]) {
          const guess = guessVariety(text)
          if (guess !== null) misses.push(`${text} → ${guess}`)
        }
      }
    }
    expect(misses).toEqual([])
  })

  it('무작위 문장: 추측은 null이거나 목록 낱말이 아니고, 숫자가 없고, 2~20글자다', () => {
    const pieces = fc.constantFrom(...LIST, ...LIST.map((w) => `${w}는`), ...LIST.map((w) => `${w}요`), '15번', '168', '25만 원', '만원', '3강', '9cm에', 'bts', '라울', '요 아이', 'UI는', '유 아이', '자', '어')
    fc.assert(
      fc.property(fc.array(pieces, { minLength: 1, maxLength: 12 }), (parts) => {
        const text = parts.join(' ')
        const guess = guessVariety(text)
        if (guess === null) return
        expect(LIST_KEYS.has(compact(guess)), `${text} → ${guess}`).toBe(false)
        expect(/[0-9]/.test(guess)).toBe(false)
        expect([...guess].length).toBeGreaterThanOrEqual(2)
        expect([...guess].length).toBeLessThanOrEqual(20)
        // D-V3-30: 두 번 이상 나온 낱말만, 풀이말 끝(다 요 죠 네 까 고 게 서 면 데) 모양은 아님
        expect(/[다요죠네까고게서면데]$/.test(guess), `풀이말 끝: ${text} → ${guess}`).toBe(false)
        const times = text.split(' ').filter((t) => t === guess || (t.startsWith(guess) && ENDINGS.includes(t.slice(guess.length)))).length
        expect(times, `한 번만 나온 낱말: ${text} → ${guess}`).toBeGreaterThanOrEqual(2)
        // D-V3-37: 추측은 후보 단추용 — 바로 등록 품종은 사전 맞춤(name)뿐
        const reading = readRegistration(text, { dictionary: DICT, final: true })
        if (reading.ready !== null) expect(reading.ready.name).toBe(reading.extraction.name)
      }),
      { numRuns: 1500 },
    )
  })

  // D-V3-30: 추측은 두 번 이상 나온 후보 낱말 가운데 처음 것 — 군말을 지나 되풀이한 품종을 고른다
  it.each([
    ['15번 UI는 bts 자 bts 만원', 'bts'],
    ['15번 요 아이는 bts 요 아이는 bts는 만원', 'bts'],
    ['15번 유 아이 bts 유 아이 bts 만원', 'bts'],
    ['15번 이거요 그거는 저것도 bts 이거 bts요 만원', 'bts'],
    ['15번 얘가 걔는 bts 얘는 bts 만원', 'bts'],
  ])('"%s" → 군말을 지나 %s', (text, guess) => {
    expect(guessVariety(text)).toBe(guess)
  })

  // D-V3-30: 한 번만 나온 사전 밖 낱말·풀이말 끝 모양은 추측이 아니다 (실제 방송 1·실방송 3차 R44)
  it.each([
    '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요',
    '15번 UI는 bts 만원',
    '15번 품종은 bts 만원',
    '요 아이는 65만 원까지 자 색감이 이렇게 예쁘게 나왔네요 자 60 어 자',
    '15번 나왔네요 자 나왔네요 만원',
    '15번 예쁘고 예쁘고 만원',
    '15번 좋다 좋다 만원',
  ])('"%s" → 추측 없음, 바로 등록 품종도 비움', (text) => {
    expect(guessVariety(text)).toBeNull()
    const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
    if (ready !== null) expect(ready.name).toBeNull()
  })
})

describe('AC-V3-61 — decideSameNumber 모든 조합 (R-22, D-V3-31·32·47·55·57·59·64)', () => {
  // R-22 입력·결과는 스펙 문장 그대로 쓴다 (numberFrom·recent — D-V3-32·59). D-V3-57부터 찜(CLAIMS)·3배·1/3, D-V3-64부터 300만 원(PRICE_JUMP) 묻기는 없다
  type SpecNumberFrom = 'MARKER' | 'BARE'
  type SpecReason = 'NO_AUTO' | 'NUMBER_BARE' | 'NOT_OPEN' | 'PRICE_NOT_SURE' | 'PRICE_JUMP' | 'MAYBE_OTHER' | 'NOT_RECENT'
  interface SpecInput {
    readonly heard: { readonly price: number | null; readonly priceSure: boolean; readonly name: string | null; readonly nameFrom: NameFrom | null; readonly numberFrom: SpecNumberFrom }
    readonly product: { readonly name: string; readonly price: number; readonly status: SameNumberStatus; readonly liveClaims: number }
    readonly auto: boolean
    readonly recent?: boolean
  }
  interface SpecDecision {
    readonly action: 'IGNORE' | 'AUTO_FIX' | 'ASK'
    readonly changes: { readonly price?: number; readonly name?: string }
    readonly reason: SpecReason | null
  }
  const decide = (input: SpecInput): SpecDecision => decideSameNumber(input as unknown as SameNumberInput) as unknown as SpecDecision

  const PRODUCT_NAMES = ['', '핑크프릴'] as const
  const HEARD_NAMES = [null, '핑크프릴', '핑크 프릴', 'bts'] as const // 품종 4가지: 없음·같음·공백만 다름·다름
  const FROMS: readonly (NameFrom | null)[] = ['DICTIONARY', 'GUESS', null]
  const STATUSES: readonly SameNumberStatus[] = ['READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED']
  const NUMBER_FROMS: readonly SpecNumberFrom[] = ['MARKER', 'BARE']
  const RECENTS: readonly (boolean | undefined)[] = [true, false, undefined] // 없으면 참으로 본다
  /** 상품 가격 × 들은 가격 (3배·1/3은 이제 경계가 아님, 300만 원만 — D-V3-55·57) */
  const PRICE_PAIRS: readonly (readonly [number, number | null])[] = [
    [100_000, null],
    [100_000, 100_000],
    [100_000, 120_000],
    [100_000, 300_001],
    [300_000, 99_999],
    [1_500_000, 3_000_000],
    [1_500_000, 3_000_001],
    [650_000, 6_050_000],
  ]

  const all: SpecInput[] = []
  for (const [productPrice, price] of PRICE_PAIRS)
    for (const priceSure of [true, false])
      for (const name of HEARD_NAMES)
        for (const nameFrom of FROMS)
          for (const numberFrom of NUMBER_FROMS)
            for (const productName of PRODUCT_NAMES)
              for (const status of STATUSES)
                for (const liveClaims of [0, 2])
                  for (const auto of [true, false])
                    for (const recent of RECENTS)
                      all.push({ heard: { price, priceSure, name, nameFrom: name === null ? null : nameFrom, numberFrom }, product: { name: productName, price: productPrice, status, liveClaims }, auto, ...(recent === undefined ? {} : { recent }) })

  /** R-22 문장 그대로 옮긴 기대 */
  function oracle(input: SpecInput): SpecDecision {
    const { heard, product } = input
    const recent = input.recent !== false
    const changes: { price?: number; name?: string } = {}
    // 1. 가격은 원까지 확정된(priceSure) 것만 (D-V3-47), 품종은 사전 이름일 때만 (D-V3-31)
    const unsurePrice = heard.price !== null && heard.price !== product.price && !heard.priceSure
    if (heard.price !== null && heard.price !== product.price && heard.priceSure) changes.price = heard.price
    if (heard.nameFrom === 'DICTIONARY' && heard.name !== null && compact(heard.name) !== compact(product.name)) changes.name = heard.name
    // 2.
    if (Object.keys(changes).length === 0) return { action: 'IGNORE', changes: {}, reason: unsurePrice ? 'PRICE_NOT_SURE' : null }
    // 3.
    const ask = (reason: SpecReason): SpecDecision => ({ action: 'ASK', changes, reason })
    if (!input.auto) return ask('NO_AUTO')
    if (heard.numberFrom === 'BARE') return ask('NUMBER_BARE')
    if (product.status !== 'OPEN' && product.status !== 'SOLD') return ask('NOT_OPEN')
    if (!recent && product.liveClaims > 0) return ask('MAYBE_OTHER')
    return { action: 'AUTO_FIX', changes, reason: recent ? null : 'NOT_RECENT' }
  }

  it(`조합 ${all.length}개가 R-22 문장과 같다`, () => {
    expect(all.length).toBe(8 * 2 * 4 * 3 * 2 * 2 * 5 * 2 * 2 * 3)
    const wrong = all.map((input) => ({ input, got: decide(input), want: oracle(input) })).filter(({ got, want }) => JSON.stringify(got) !== JSON.stringify(want))
    expect(wrong.length, JSON.stringify(wrong.slice(0, 3))).toBe(0)
  })

  it('늘 지키는 것: BARE·자동 등록 끔·판매 중 아님은 절대 바로 고치지 않음 · 가격 크기로는 묻지 않음(D-V3-64) · 고쳐 말함 아님 + 찜 있음은 덮어쓰지 않음 · GUESS는 품종을 건드리지 않음 · 확정 안 된 가격은 바꾸지 않음 · CLAIMS는 나오지 않음', () => {
    for (const input of all) {
      const got = decide(input)
      const { heard, product } = input
      if (heard.numberFrom === 'BARE' || !input.auto || !['OPEN', 'SOLD'].includes(product.status)) expect(got.action).not.toBe('AUTO_FIX')
      if (heard.numberFrom === 'MARKER' && input.auto && ['OPEN', 'SOLD'].includes(product.status) && input.recent !== false) expect(got.action).not.toBe('ASK')
      expect(got.reason).not.toBe('PRICE_JUMP')
      if (input.recent === false && product.liveClaims > 0) expect(got.action).not.toBe('AUTO_FIX')
      if (heard.nameFrom !== 'DICTIONARY') expect(got.changes.name).toBeUndefined()
      if (!heard.priceSure) expect(got.changes.price).toBeUndefined()
      expect(got.reason).not.toBe('CLAIMS')
      if (got.action === 'ASK') expect(['NO_AUTO', 'NUMBER_BARE', 'NOT_OPEN', 'MAYBE_OTHER']).toContain(got.reason)
      if (got.action === 'AUTO_FIX') expect([null, 'NOT_RECENT']).toContain(got.reason)
      if (got.action === 'IGNORE') expect([null, 'PRICE_NOT_SURE']).toContain(got.reason)
      expect(Object.keys(got).sort()).toEqual(['action', 'changes', 'reason'])
    }
  })

  it.each([
    ['R45 300만 원 넘는 올림도 바로 고침 (D-V3-64)', { price: 6_050_000, priceSure: true, name: '나왔네', nameFrom: 'GUESS', numberFrom: 'MARKER' }, { name: '설비', price: 650_000, liveClaims: 0 }, true, { action: 'AUTO_FIX', changes: { price: 6_050_000 }, reason: null }],
    ['D-V3-64 찜 있는 상품 300만 원 넘는 고침도 고쳐 말함이면 바로', { price: 5_000_000, priceSure: true, name: null, nameFrom: null, numberFrom: 'MARKER' }, { name: '', price: 30_000, liveClaims: 1 }, true, { action: 'AUTO_FIX', changes: { price: 5_000_000 }, reason: null }],
    ['D-V3-55 62번 1/3 미만 내림도 바로 고침', { price: 20_000, priceSure: true, name: null, nameFrom: null, numberFrom: 'MARKER' }, { name: '', price: 100_000, liveClaims: 0 }, true, { action: 'AUTO_FIX', changes: { price: 20_000 }, reason: null }],
    ['D-V3-57 찜 있어도 고쳐 말함이면 바로 고침', { price: 120_000, priceSure: true, name: null, nameFrom: null, numberFrom: 'MARKER' }, { name: 'bts', price: 100_000, liveClaims: 3 }, true, { action: 'AUTO_FIX', changes: { price: 120_000 }, reason: null }],
    ['D-V3-57 3배 넘는 올림(300만 원 안)도 바로 고침', { price: 300_001, priceSure: true, name: null, nameFrom: null, numberFrom: 'MARKER' }, { name: 'bts', price: 100_000, liveClaims: 0 }, true, { action: 'AUTO_FIX', changes: { price: 300_001 }, reason: null }],
    ['D-V3-59 고쳐 말함 아님 + 찜 0 → 바로 바꿈 NOT_RECENT', { price: 50_000, priceSure: true, name: null, nameFrom: null, numberFrom: 'MARKER' }, { name: '', price: 30_000, liveClaims: 0 }, false, { action: 'AUTO_FIX', changes: { price: 50_000 }, reason: 'NOT_RECENT' }],
    ['D-V3-59 고쳐 말함 아님 + 찜 있음 → MAYBE_OTHER', { price: 50_000, priceSure: true, name: null, nameFrom: null, numberFrom: 'MARKER' }, { name: '', price: 30_000, liveClaims: 2 }, false, { action: 'ASK', changes: { price: 50_000 }, reason: 'MAYBE_OTHER' }],
    ['R48 번 없이 들은 다른 가격', { price: 120_000, priceSure: true, name: null, nameFrom: null, numberFrom: 'BARE' }, { name: 'bts', price: 100_000, liveClaims: 0 }, true, { action: 'ASK', changes: { price: 120_000 }, reason: 'NUMBER_BARE' }],
    ['빈 품종에 추측 → 무시 (D-V3-31)', { price: 100_000, priceSure: true, name: 'bts', nameFrom: 'GUESS', numberFrom: 'MARKER' }, { name: '', price: 100_000, liveClaims: 0 }, true, { action: 'IGNORE', changes: {}, reason: null }],
  ] as const)('%s', (_title, heard, product, recent, want) => {
    expect(decide({ heard, product: { ...product, status: 'OPEN' }, auto: true, recent })).toEqual(want)
  })

  it('넘긴 값을 바꾸지 않는다', () => {
    for (const input of all.slice(0, 200)) {
      const copy = structuredClone(input)
      decide(Object.freeze({ ...input, heard: Object.freeze({ ...input.heard }), product: Object.freeze({ ...input.product }) }))
      expect(input).toEqual(copy)
    }
  })

  it('decideForExisting도 같은 규칙: 번 없는 번호·끔·판매 중 아님·(고쳐 말함 아님 + 찜)은 바로 고치지 않고, 추측은 품종을 건드리지 않으며, 바로 고침의 bigChange는 R-25 크게 바뀜과 정확히 같다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', '핑크프릴'),
        fc.constantFrom(0, 1, 3),
        fc.constantFrom(null, 100_000, 20_000, 33_333, 33_334, 300_000, 300_001, 3_000_001),
        fc.constantFrom(null, '핑크프릴', 'bts'),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<SameNumberStatus>('READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED'),
        fc.constantFrom<'marker' | 'bare'>('marker', 'bare'),
        fc.boolean(),
        (name, claimCount, price, heardName, guessed, auto, status, numberFrom, recent) => {
          const got = decideForExisting({ no: 108, name, price: 100_000, claimCount }, { name: heardName, price, nameNeedsCheck: guessed, numberFrom }, { auto, status, recent })
          if (got.kind === 'AUTO_FIX' || got.kind === 'FILL_NAME') {
            expect(['OPEN', 'SOLD']).toContain(status)
            expect(auto).toBe(true)
            expect(numberFrom).toBe('marker')
            expect(recent || claimCount === 0).toBe(true)
          }
          // R-25 크게 바뀜 (가격 고침): 새 가격 > 300만 원, 새 > 전 × 3, 새 × 3 < 전 — 표시만, 막지 않음
          if (got.kind === 'AUTO_FIX') expect(got.bigChange === true).toBe(got.price !== null && (got.price > 3_000_000 || got.price > 300_000 || got.price * 3 < 100_000))
          if (guessed && got.kind !== 'IGNORE') expect(got.name).toBeNull()
        },
      ),
      { numRuns: 800 },
    )
  })
})

describe('R-25 크게 바뀜 (isBigChange, D-V3-64·65)', () => {
  it.each([
    // 등록 (전 값 없음): 가격 > 3,000,000원
    [null, 3_000_000, false],
    [null, 3_000_001, true],
    [null, 100, false],
    // 가격 고침: 새 > 300만 · 새 > 전 × 3 · 새 × 3 < 전 (정수 비교, 딱 3배·딱 1/3은 아님)
    [100_000, 300_000, false],
    [100_000, 300_001, true],
    [300_000, 100_000, false],
    [300_000, 99_999, true],
    [100_000, 33_334, false],
    [100_000, 33_333, true],
    [2_000_000, 3_000_000, false],
    [2_000_000, 3_000_001, true],
    [5_000_000, 4_000_000, true], // 내림이어도 새 가격이 300만 원 넘음
    [650_000, 6_050_000, true], // R45 육십오만 → 605만
    [100_000, 100_000, false],
  ] as const)('전 %s → 새 %i원: %s', (before, after, want) => {
    expect(isBigChange(before, after)).toBe(want)
  })

  it('성질: 스펙 식과 늘 같다 (0원·큰 수 포함)', () => {
    fc.assert(
      fc.property(fc.option(fc.integer({ min: 0, max: 50_000_000 }), { nil: null }), fc.integer({ min: 0, max: 50_000_000 }), (before, after) => {
        const want = after > 3_000_000 || (before !== null && (after > before * 3 || after * 3 < before))
        expect(isBigChange(before, after)).toBe(want)
      }),
      { numRuns: 3000 },
    )
  })

  it('성질: 어떤 가격도 바로 등록을 막지 않고, 고른 값의 bigChange는 등록 식(> 300만 원)과 정확히 같다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999 }), fc.integer({ min: 1, max: 999 }), (k, no) => {
        const price = k * 100
        const won = `${no}번 ${String(price)}원`
        const ready = readRegistration(won, { dictionary: DICT, final: true }).ready
        expect(ready?.price).toBe(price)
        const picks = readSegments(won, { dictionary: DICT, final: true }).picks
        expect(picks.map((p) => [p.no, p.price, p.blocked, p.bigChange])).toEqual([[no, price, null, price > 3_000_000]])
      }),
      { numRuns: 1000 },
    )
  })
})
