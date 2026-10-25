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
  decideSameNumber,
  guessVariety,
  readRegistration,
  prepareVoiceDictionary,
  type NameFrom,
  type SameNumberDecision,
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
        // 바로 등록 값의 품종도 같다
        const ready = readRegistration(text, { dictionary: DICT }).ready
        if (ready !== null && ready.nameNeedsCheck) expect(ready.name).toBe(guess)
      }),
      { numRuns: 1500 },
    )
  })

  it.each([
    ['15번 UI는 bts 만원', 'bts'],
    ['15번 요 아이는 bts 만원', 'bts'],
    ['15번 유 아이 bts 만원', 'bts'],
    ['15번 품종은 bts 만원', 'bts'],
    ['15번 이거요 그거는 저것도 bts 만원', 'bts'],
    ['15번 얘가 걔는 bts 만원', 'bts'],
  ])('"%s" → 군말을 지나 %s', (text, guess) => {
    expect(guessVariety(text)).toBe(guess)
  })
})

describe('AC-V3-61 — decideSameNumber 모든 조합', () => {
  const PRODUCT_NAMES = ['', '핑크프릴'] as const
  const HEARD_NAMES = [null, '핑크프릴', '핑크 프릴', 'bts'] as const // 품종 4가지: 없음·같음·공백만 다름·다름
  const FROMS: readonly (NameFrom | null)[] = ['DICTIONARY', 'GUESS', null]
  const STATUSES: readonly SameNumberStatus[] = ['READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED']
  const PRICES = [null, 100_000, 120_000] as const // 없음·같음·다름 (상품 100,000원)

  const all: SameNumberInput[] = []
  for (const price of PRICES)
    for (const priceSure of [true, false])
      for (const name of HEARD_NAMES)
        for (const nameFrom of FROMS)
          for (const productName of PRODUCT_NAMES)
            for (const status of STATUSES)
              for (const liveClaims of [0, 1])
                for (const auto of [true, false]) all.push({ heard: { price, priceSure, name, nameFrom: name === null ? null : nameFrom }, product: { name: productName, price: 100_000, status, liveClaims }, auto })

  /** R-22 문장 그대로 옮긴 기대 */
  function oracle(input: SameNumberInput): SameNumberDecision {
    const { heard, product } = input
    const changes: { price?: number; name?: string } = {}
    if (heard.price !== null && heard.price !== product.price) changes.price = heard.price
    let fillDictionary = false
    if (heard.name !== null && compact(heard.name) !== compact(product.name)) {
      if (compact(product.name) === '') {
        changes.name = heard.name
        fillDictionary = heard.nameFrom === 'DICTIONARY'
      } else if (heard.nameFrom === 'DICTIONARY') changes.name = heard.name
    }
    if (Object.keys(changes).length === 0) return { action: 'IGNORE', changes: {}, reason: null }
    if (!input.auto) return { action: 'ASK', changes, reason: 'NO_AUTO' }
    if (product.status !== 'OPEN' && product.status !== 'SOLD') return { action: 'ASK', changes, reason: 'NOT_OPEN' }
    if (changes.price !== undefined && !heard.priceSure) return { action: 'ASK', changes, reason: 'PRICE_NOT_SURE' }
    if (product.liveClaims > 0 && !(fillDictionary && changes.price === undefined)) return { action: 'ASK', changes, reason: 'CLAIMS' }
    return { action: 'AUTO_FIX', changes, reason: null }
  }

  it(`조합 ${all.length}개가 R-22 문장과 같다`, () => {
    expect(all.length).toBe(2880) // 가격 3 × priceSure 2 × 품종 4 × nameFrom 3 × 상품 품종 2 × 상태 5 × 찜 2 × auto 2 (품종 없음은 nameFrom null로 둔다)
    const wrong = all.map((input) => ({ input, got: decideSameNumber(input), want: oracle(input) })).filter(({ got, want }) => JSON.stringify(got) !== JSON.stringify(want))
    expect(wrong.slice(0, 5)).toEqual([])
  })

  it('바꿀 칸이 없으면 늘 IGNORE · 찜 + 가격 바뀜은 AUTO_FIX 아님 · 추측은 있는 품종을 안 바꿈 · READY/HOLD/CLOSED는 AUTO_FIX 아님', () => {
    for (const input of all) {
      const got = decideSameNumber(input)
      const nothing = (input.heard.price === null || input.heard.price === input.product.price) && (input.heard.name === null || compact(input.heard.name) === compact(input.product.name) || (input.product.name !== '' && input.heard.nameFrom !== 'DICTIONARY'))
      if (nothing) expect(got).toEqual({ action: 'IGNORE', changes: {}, reason: null })
      if (input.product.liveClaims > 0 && got.changes.price !== undefined) expect(got.action).not.toBe('AUTO_FIX')
      if (input.heard.nameFrom !== 'DICTIONARY' && input.product.name !== '') expect(got.changes.name).toBeUndefined()
      if (['READY', 'HOLD', 'CLOSED'].includes(input.product.status)) expect(got.action).not.toBe('AUTO_FIX')
      if (got.action === 'IGNORE' || got.action === 'AUTO_FIX') expect(got.reason).toBeNull()
      else expect(got.reason).not.toBeNull()
      expect(Object.keys(got).sort()).toEqual(['action', 'changes', 'reason'])
    }
  })

  it('넘긴 값을 바꾸지 않는다', () => {
    for (const input of all.slice(0, 200)) {
      const copy = structuredClone(input)
      decideSameNumber(Object.freeze({ ...input, heard: Object.freeze({ ...input.heard }), product: Object.freeze({ ...input.product }) }))
      expect(input).toEqual(copy)
    }
  })

  it('decideForExisting도 같은 규칙: 찜 있는 상품의 가격은 바로 고치지 않고, 추측은 있는 품종을 덮지 않는다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', '핑크프릴'),
        fc.constantFrom(0, 1, 3),
        fc.constantFrom(null, 100_000, 120_000),
        fc.constantFrom(null, '핑크프릴', 'bts'),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<SameNumberStatus>('READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED'),
        (name, claimCount, price, heardName, guessed, auto, status) => {
          const got = decideForExisting({ no: 108, name, price: 100_000, claimCount }, { name: heardName, price, nameNeedsCheck: guessed }, { auto, status })
          if (got.kind === 'AUTO_FIX') {
            expect(claimCount === 0 || got.price === null).toBe(true)
            expect(['OPEN', 'SOLD']).toContain(status)
            expect(auto).toBe(true)
          }
          if (got.kind === 'FILL_NAME') expect([claimCount > 0, name, guessed]).toEqual([true, '', false])
          if (guessed && name !== '' && (got.kind === 'AUTO_FIX' || got.kind === 'ASK' || got.kind === 'FILL_NAME')) expect(got.name).toBeNull()
        },
      ),
      { numRuns: 500 },
    )
  })
})
