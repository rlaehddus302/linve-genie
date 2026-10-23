// V2 적대 시험 (test-domain, AC-V2-11~13·AC-V2-33, D-V2-03): 이어 붙이기 경계를 공격한다.
// 노리는 것: 조용한 시간 정확히 경계, 중간 결과의 재시작, 15초·300글자 끊기, 문자찜 섞임, 다른 번호 끊기의 예외(정정 표시만).
import { createPhraseState, feed, tick, type PhraseOutput, type PhraseState } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { openCards, simulate, view } from './sim.ts'

type In = { text: string; final?: boolean; at: number; flushedAtEnd?: boolean }

/** feed만으로(결과 시각에) + 마지막에 tick(until) 한 번 */
function run(inputs: readonly In[], until: number, quietMs?: number): { at: number; out: PhraseOutput }[] {
  let s: PhraseState = createPhraseState({ quietMs })
  const outs: { at: number; out: PhraseOutput }[] = []
  for (const i of inputs) {
    const step = feed(s, { text: i.text, final: i.final !== false, at: i.at, flushedAtEnd: i.flushedAtEnd })
    s = step.state
    for (const o of step.out) outs.push({ at: i.at, out: o })
  }
  const last = tick(s, until)
  for (const o of last.out) outs.push({ at: until, out: o })
  return outs
}
const texts = (outs: { out: PhraseOutput }[]): string[] => outs.map(({ out }) => (out.kind === 'chunk' ? out.chunk.text : `SMS:${out.sms.text}`))

describe('조용한 시간 경계 (D-V2-03)', () => {
  it('쉼 1799ms는 붙고, 정확히 1800ms는 끊긴다 (쉼 < 1.8초만 한 덩어리)', () => {
    expect(texts(run([{ text: '십오번', at: 0 }, { text: '엘레강스 이만원', at: 1799 }], 10_000))).toEqual(['십오번 엘레강스 이만원'])
    expect(texts(run([{ text: '십오번', at: 0 }, { text: '엘레강스 이만원', at: 1800 }], 10_000))).toEqual(['십오번', '엘레강스 이만원'])
  })

  it('tick은 마지막 결과 + 1799에는 내보내지 않고 + 1800에 내보낸다', () => {
    let s = feed(createPhraseState(), { text: '15번 핑크문 만원', final: true, at: 500 }).state
    const early = tick(s, 2299)
    expect(early.out).toEqual([])
    s = early.state
    const due = tick(s, 2300)
    expect(due.out).toHaveLength(1)
    expect(due.out[0]?.kind === 'chunk' && due.out[0].chunk.endedAt).toBe(2300)
  })

  it('S17 중간 결과가 조용한 시간을 다시 센다 — 1800·3299엔 끊지 않고, 마지막 최종 3000 + 1800 = 4800', () => {
    const r = simulate(
      [
        { text: '28번 핑크', at: 0, final: false },
        { text: '28번 핑크문 만', at: 1500, final: false },
        { text: '28번 핑크문 만원', at: 3000 },
      ],
      6000,
    )
    expect(r.chunks.map((c) => [c.text, c.endedAt])).toEqual([['28번 핑크문 만원', 4800]])
    expect(r.cards.map(view)).toEqual([{ no: 28, name: '핑크문', price: 10_000 }])
  })

  it('최종 뒤 중간 결과(1700)가 오면 그 시각부터 다시 센다 — 1800에 끊지 않음', () => {
    const outs = run([{ text: '십오번', at: 0 }, { text: '엘레', at: 1700, final: false }, { text: '엘레강스 이만원', at: 3400 }], 10_000)
    expect(texts(outs)).toEqual(['십오번 엘레강스 이만원'])
  })

  it('설정 3.0초: 쉼 2500은 붙는다, 범위 밖 quietMs(500·99999·NaN)는 1800으로 읽는다', () => {
    expect(texts(run([{ text: '십오번', at: 0 }, { text: '엘레강스 이만원', at: 2500 }], 20_000, 3000))).toEqual(['십오번 엘레강스 이만원'])
    for (const bad of [500, 99_999, Number.NaN, 1850, '3000']) {
      expect(createPhraseState({ quietMs: bad }).quietMs).toBe(1800)
    }
  })
})

describe('15초·300글자 끊기 (AC-V2-12)', () => {
  it('1초마다 최종 결과 → 15000에 끊긴다(0~14000 조각 15개), 15000 결과는 다음 덩어리', () => {
    const inputs: In[] = Array.from({ length: 20 }, (_, i) => ({ text: `말 ${String(i)}`, at: i * 1000 }))
    const outs = run(inputs, 40_000)
    const chunks = outs.filter((o) => o.out.kind === 'chunk')
    const first = chunks[0]?.out
    expect(first?.kind === 'chunk' && [first.chunk.pieces.length, first.chunk.endedAt, first.chunk.end]).toEqual([15, 15_000, 'max'])
  })

  it('중간 결과만 계속 와도 첫 최종 결과에서 15초면 tick이 끊는다', () => {
    let s = feed(createPhraseState(), { text: '15번 핑크문', final: true, at: 0 }).state
    let emitted: number | null = null
    for (let t = 1000; t <= 16_000 && emitted === null; t += 1000) {
      const fed = feed(s, { text: `만 ${String(t)}`, final: false, at: t })
      if (fed.out.length > 0) emitted = t
      const step = tick(fed.state, t)
      s = step.state
      if (step.out.length > 0) emitted = t
    }
    expect(emitted).toBe(15_000)
  })

  it('모은 글 + 새 결과가 정확히 300글자면 붙고 301글자면 새 결과 앞에서 끊는다', () => {
    const a = '가'.repeat(150)
    const b299 = '나'.repeat(149) // 150 + 1 + 149 = 300
    const b300 = '나'.repeat(150) // 301
    expect(texts(run([{ text: a, at: 0 }, { text: b299, at: 100 }], 5000))).toEqual([`${a} ${b299}`])
    expect(texts(run([{ text: a, at: 0 }, { text: b300, at: 100 }], 5000))).toEqual([a, b300])
  })

  it('이모지(서로게이트 쌍)는 코드 포인트 하나로 센다 — 150 + 1 + 149 이모지 = 300 붙음', () => {
    const a = '😀'.repeat(150)
    const b = '🌵'.repeat(149)
    expect(texts(run([{ text: a, at: 0 }, { text: b, at: 100 }], 5000))).toEqual([`${a} ${b}`])
  })
})

describe('다른 번호·문자찜 끊기 (D-V2-03 a·d)', () => {
  it('S16 다른 번호 27 → 1000에 26번 덩어리 먼저, 카드 둘', () => {
    const r = simulate([{ text: '26번 엘레강스 만원', at: 0 }, { text: '27번 라울 이만원', at: 1000 }], 4000)
    expect(r.cards.map(view).sort((a, b) => (a?.no ?? 0) - (b?.no ?? 0))).toEqual([
      { no: 26, name: '엘레강스', price: 10_000 },
      { no: 27, name: '라울', price: 20_000 },
    ])
  })

  it('같은 번호 다시 말함(15번 … 십오번 핑크문)은 끊지 않는다', () => {
    expect(texts(run([{ text: '15번', at: 0 }, { text: '십오번 핑크문 만원', at: 1000 }], 5000))).toEqual(['15번 십오번 핑크문 만원'])
  })

  // TD-V2-001: 끊지 않는 예외는 정정 표시(D-V2-05: 아니·아니야·아니요·아니고·다시·정정·말고)뿐이다. 취소 낱말은 정정 표시가 아니다.
  // 지금 phrase.ts hasCorrectionMarker가 CANCEL_WORDS도 예외로 쳐서 "27번 … 취소"가 26번 덩어리에 붙고,
  // 덩어리 전체가 (첫 조각 번호 26 + 취소) → 버려져 판매자가 말한 26번 카드가 사라진다.
  it('TD-V2-001: "26번 엘레강스 만원" + "27번 라울 만원 취소"(1000) → 26번 카드는 남는다', () => {
    const r = simulate([{ text: '26번 엘레강스 만원', at: 0 }, { text: '27번 라울 만원 취소', at: 1000 }], 4000)
    expect(r.chunks.map((c) => c.text)).toEqual(['26번 엘레강스 만원', '27번 라울 만원 취소'])
    expect(openCards(r.cards).map(view)).toEqual([{ no: 26, name: '엘레강스', price: 10_000 }])
  })

  it('S21 문자찜 결과는 모은 글을 먼저 내보내고 혼자 나간다(이어 붙지 않음)', () => {
    const outs = run([{ text: '29번 핑크문 만원', at: 0 }, { text: '165번 문자찜 끝자리 1234', at: 1000 }, { text: '만이천원', at: 1500 }], 9000)
    expect(texts(outs)).toEqual(['29번 핑크문 만원', 'SMS:165번 문자찜 끝자리 1234', '만이천원'])
    expect(outs[0]?.at).toBe(1000)
  })

  it('정정 표시가 든 문자찜("아니 165번 문자찜 끝자리 1234")도 이어 붙지 않는다', () => {
    const outs = run([{ text: '29번 핑크문 만원', at: 0 }, { text: '아니 165번 문자찜 끝자리 1234', at: 1000 }], 9000)
    expect(texts(outs)).toEqual(['29번 핑크문 만원', 'SMS:아니 165번 문자찜 끝자리 1234'])
  })

  it('끝에서 넘긴 결과는 바로 덩어리 + 자동 확정 없음', () => {
    const outs = run([{ text: '15번 핑크문', at: 0 }, { text: '만원', at: 500, flushedAtEnd: true }], 9000)
    expect(outs).toHaveLength(1)
    const o = outs[0]?.out
    expect(o?.kind === 'chunk' && [o.chunk.text, o.chunk.noAutoConfirm]).toEqual(['15번 핑크문 만원', true])
  })
})

describe('속성: 모으기는 말을 잃거나 덧붙이지 않는다 (fast-check)', () => {
  const word = fc.constantFrom('15번', '16번', '핑크문', '만원', '이만원', '아니', '말고', '취소', '엘레강스', '문자찜', '끝자리', '1234', '😀', '<b>', '　', '')
  const inputs = fc.array(
    fc.record({ words: fc.array(word, { maxLength: 6 }), gap: fc.integer({ min: 0, max: 5000 }), final: fc.boolean() }),
    { maxLength: 25 },
  )

  it('모든 최종 결과(빈 글 빼고)는 덩어리 또는 문자찜으로 정확히 한 번, 순서대로 나온다', () => {
    fc.assert(
      fc.property(inputs, (list) => {
        let s = createPhraseState()
        let at = 0
        const expected: string[] = []
        const got: string[] = []
        const collect = (out: readonly PhraseOutput[]): void => {
          for (const o of out) {
            if (o.kind === 'sms') got.push(o.sms.text)
            else for (const p of o.chunk.pieces) got.push(p.text)
          }
        }
        for (const item of list) {
          at += item.gap
          const text = item.words.join(' ')
          const step = feed(s, { text, final: item.final, at })
          s = step.state
          collect(step.out)
          if (item.final && text.trim() !== '') expected.push(text)
        }
        collect(tick(s, at + 100_000).out)
        expect(got.map((t) => t.replace(/\s+/gu, ''))).toEqual(expected.map((t) => t.normalize('NFKC').replace(/\s+/gu, '')))
      }),
      { numRuns: 300 },
    )
  })

  it('덩어리 끝 시각은 시작 이후, 300글자 이하(조각 하나가 넘는 경우 빼고), 시작에서 15초 이하로 모인다', () => {
    fc.assert(
      fc.property(inputs, (list) => {
        let s = createPhraseState()
        let at = 0
        const chunks: { startedAt: number; endedAt: number; text: string; n: number; lastPieceAt: number }[] = []
        const collect = (out: readonly PhraseOutput[]): void => {
          for (const o of out) if (o.kind === 'chunk') chunks.push({ startedAt: o.chunk.startedAt, endedAt: o.chunk.endedAt, text: o.chunk.text, n: o.chunk.pieces.length, lastPieceAt: o.chunk.pieces.at(-1)?.at ?? 0 })
        }
        for (const item of list) {
          at += item.gap
          const step = feed(s, { text: item.words.join(' '), final: item.final, at })
          s = step.state
          collect(step.out)
        }
        collect(tick(s, at + 100_000).out)
        for (const c of chunks) {
          expect(c.endedAt).toBeGreaterThanOrEqual(c.startedAt)
          expect(c.lastPieceAt - c.startedAt).toBeLessThan(15_000)
          if (c.n > 1) expect([...c.text].length).toBeLessThanOrEqual(300)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('feed·tick은 넘긴 상태를 바꾸지 않는다(같은 상태 + 같은 입력 = 같은 출력)', () => {
    fc.assert(
      fc.property(inputs, (list) => {
        let s = createPhraseState()
        let at = 0
        for (const item of list) {
          at += item.gap
          const input = { text: item.words.join(' '), final: item.final, at }
          const snapshot = JSON.stringify(s)
          const a = feed(s, input)
          const b = feed(s, input)
          expect(JSON.stringify(s)).toBe(snapshot)
          expect(JSON.stringify(a)).toBe(JSON.stringify(b))
          s = a.state
        }
      }),
      { numRuns: 200 },
    )
  })
})
