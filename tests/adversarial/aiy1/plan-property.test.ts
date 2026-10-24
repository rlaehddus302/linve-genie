// AIY1 적대 시험 (test-domain, CMT-06, D-AIY1-01·03): 출처 판단과 호출 고르기(planAssist)를 속성으로 공격한다.
// - isYoutubeSource: 정확히 'other'·'rehearsal'만 보낼 수 있다. 대소문자·공백·전각·제로폭으로 비튼 값, 빈 값, 아무 문자열은 모두 유튜브 줄
// - planAssist: 유튜브 줄은 보내는 목록에 절대 없고, 유튜브 줄을 지운 목록으로 고른 결과와 똑같다(묶음 수·같은 글 묶기 자리를 차지하지 않는다)
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isYoutubeSource, planAssist, type PlanInput, type PlanItem } from '../../../apps/server/src/assist/rules.ts'

describe('TD-AIY1 출처 판단 isYoutubeSource', () => {
  it('보낼 수 있는 값은 정확히 other·rehearsal 둘뿐', () => {
    expect(isYoutubeSource('other')).toBe(false)
    expect(isYoutubeSource('rehearsal')).toBe(false)
    for (const value of ['youtube', 'extension', '', null, undefined, 'YouTube', 'YOUTUBE', 'OTHER', 'Other', 'REHEARSAL', 'Rehearsal', ' other', 'other ', 'other\n', '​other', 'othe​r', 'ｏｔｈｅｒ', 'rehearsal\u0000', 'instagram', 'tiktok', 'sms']) {
      expect(isYoutubeSource(value), JSON.stringify(value)).toBe(true)
    }
  })

  it('속성: 아무 문자열이든 other·rehearsal가 아니면 유튜브 줄', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 20 }), (value) => {
        expect(isYoutubeSource(value)).toBe(value !== 'other' && value !== 'rehearsal')
      }),
      { numRuns: 500 },
    )
  })
})

const REASONS = ['UNKNOWN_WORD', 'PRODUCT_AMBIGUOUS', 'OPTION_MISSING', 'QTY_INVALID', 'STOCK_SHORT'] as const
const TEXTS = ['반바지 가나다', '반바지 라마바', '21 미듐', '010-1234-5678', '', '  ', '반바지 가나다 ', '22 큰거'] as const

const itemArb = (index: number) =>
  fc.record({
    origin: fc.constantFrom<'chat' | 'sms'>('chat', 'chat', 'chat', 'sms'),
    reason: fc.constantFrom(...REASONS),
    no: fc.constantFrom<number | null>(null, 21, 22),
    rule: fc.boolean(),
    cached: fc.boolean(),
    text: fc.constantFrom(...TEXTS),
    youtube: fc.constantFrom<boolean | undefined>(true, true, false, undefined),
  }).map((item): PlanItem => {
    const { youtube, ...rest } = item
    return { id: `i${String(index)}`, ...rest, ...(youtube === undefined ? {} : { youtube }) }
  })

const itemsArb = fc.integer({ min: 0, max: 30 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => itemArb(i))))

const inputArb = fc.record({
  enabled: fc.boolean(),
  hasKey: fc.boolean(),
  usedToday: fc.integer({ min: 0, max: 3 }),
  dailyLimit: fc.integer({ min: 0, max: 3 }),
  globalUsed: fc.integer({ min: 0, max: 3 }),
  globalLimit: fc.integer({ min: 0, max: 3 }),
  batchMax: fc.integer({ min: 1, max: 5 }),
  items: itemsArb,
})

describe('TD-AIY1 planAssist 유튜브 줄', () => {
  it('속성: 유튜브 줄은 보내지 않고, 유튜브 줄을 지운 목록과 결과가 같다 (자리를 차지하지 않는다)', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const input = raw as unknown as PlanInput
        const { send } = planAssist(input)
        const youtube = new Set(input.items.filter((item) => item.youtube === true).map((item) => item.id))
        for (const id of send) expect(youtube.has(id), id).toBe(false)
        const without = planAssist({ ...input, items: input.items.filter((item) => item.youtube !== true) })
        expect(send).toEqual(without.send)
        expect(send.length).toBeLessThanOrEqual(input.batchMax)
      }),
      { numRuns: 1000 },
    )
  })

  it('속성: youtube 키가 없으면(false와 같다) 기존 A1 결과 그대로', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const input = raw as unknown as PlanInput
        const absent = input.items.map((item) => {
          const { youtube: _youtube, ...rest } = item
          return rest
        })
        const explicit = absent.map((item) => ({ ...item, youtube: false }))
        expect(planAssist({ ...input, items: absent }).send).toEqual(planAssist({ ...input, items: explicit }).send)
      }),
      { numRuns: 300 },
    )
  })
})
