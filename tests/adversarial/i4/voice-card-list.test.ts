// I4 적대 테스트 (test-domain): 열린 카드 3장 예외 (AC-I4-02, D-204, D-I4-02, SA-P2-004). 통과한 공격을 회귀로 남긴다.
// 만들기·손대기·확정·닫기·넣기를 임의 순서로 → 열린 카드 수 ≤ max(3, 손댄 열린 카드 수 + 1), 손댄 카드는 넣기로 닫히지 않음, 넣은 카드는 열림,
// 닫히는 것은 손대지 않은 열린 카드 중 가장 오래된 것부터.
import { addCard, closeCard, confirmCard, createCard, openCardCount, replaceCard, touchCard, type SuggestionCard } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const T0 = Date.UTC(2026, 9, 20, 1, 0, 0)
let nextId = 1
function make(no: number | null, at: number): SuggestionCard {
  const card = createCard({
    id: `c${String(nextId++)}`,
    extraction: { no, name: '라울', price: 10000, confidence: no === null ? 'LOW' : 'HIGH' },
    text: '말',
    createdAt: at,
    settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 },
  })
  if (card === null) throw new Error('카드가 생겨야 한다')
  return card
}

type Op = { kind: 'add' } | { kind: 'touch' | 'confirm' | 'close'; pick: number }

describe('AC-I4-02 카드 목록 속성', () => {
  it('임의 순서의 넣기·손대기·확정·닫기', () => {
    const op: fc.Arbitrary<Op> = fc.oneof(
      fc.constant({ kind: 'add' } as Op),
      fc.record({ kind: fc.constantFrom('touch', 'confirm', 'close'), pick: fc.nat(20) }) as fc.Arbitrary<Op>,
    )
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        let cards: SuggestionCard[] = []
        let time = T0
        for (const step of ops) {
          time += 100
          if (step.kind === 'add') {
            const before = cards
            const card = make(time % 3 === 0 ? null : (time / 100) % 999 || 1, time)
            cards = addCard(before, card)
            const touchedOpen = cards.filter((item) => item.status === 'OPEN' && item.touched).length
            expect(cards[0]).toEqual(card)
            expect(cards[0]?.status).toBe('OPEN')
            expect(openCardCount(cards)).toBeLessThanOrEqual(Math.max(3, touchedOpen + 1))
            // 손댄 열린 카드는 닫히지 않는다
            for (const old of before) if (old.status === 'OPEN' && old.touched) expect(cards.find((item) => item.id === old.id)?.status).toBe('OPEN')
            // 닫힌 카드는 손대지 않은 열린 카드 중 가장 오래된 것부터 (닫힌 것보다 오래된 손대지 않은 열린 카드가 남지 않는다)
            const closedNow = before.filter((old) => old.status === 'OPEN' && cards.find((item) => item.id === old.id)?.status === 'CLOSED')
            for (const closed of closedNow) {
              const olderStillOpen = before.filter((old) => old.createdAt < closed.createdAt && old.status === 'OPEN' && !old.touched && cards.find((item) => item.id === old.id)?.status === 'OPEN')
              expect(olderStillOpen).toEqual([])
            }
            // 열린 카드가 3장을 넘으면 손대지 않은 카드는 새 카드 하나뿐이다
            if (openCardCount(cards) > 3) expect(cards.filter((item) => item.status === 'OPEN' && !item.touched).map((item) => item.id)).toEqual([card.id])
            continue
          }
          const open = cards.filter((item) => item.status === 'OPEN')
          const target = open[step.pick % Math.max(1, open.length)]
          if (target === undefined) continue
          if (step.kind === 'touch') cards = replaceCard(cards, touchCard(target))
          else if (step.kind === 'close') cards = replaceCard(cards, closeCard(target))
          else {
            const result = confirmCard(target, { existingNumbers: [] })
            if (result.ok) cards = replaceCard(cards, result.card)
          }
        }
      }),
      { numRuns: 500, seed: 20261020 },
    )
  })

  it('손댄 카드 3장 + 새 카드 → 4장, 이어서 새 카드 → 4장이고 앞의 손대지 않은 새 카드가 닫힘', () => {
    let cards: SuggestionCard[] = []
    for (let i = 0; i < 3; i++) cards = addCard(cards, make(i + 1, T0 + i))
    cards = cards.map(touchCard)
    const a = make(4, T0 + 10)
    cards = addCard(cards, a)
    expect(openCardCount(cards)).toBe(4)
    const b = make(5, T0 + 20)
    cards = addCard(cards, b)
    expect(openCardCount(cards)).toBe(4)
    expect(cards.find((item) => item.id === a.id)?.status).toBe('CLOSED')
    expect(cards[0]?.id).toBe(b.id)
  })
})
