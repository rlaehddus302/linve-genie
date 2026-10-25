// V3 적대 시험 (test-domain, R-17 8 6 기다리는 번호 D-V3-67, 판매 말투 D-V3-69, 가격 단위 AUTO D-V3-70(R-14 3), 중간 결과 안정 D-V3-71):
// 노리는 것: 60초 경계를 넘긴 번호에 가격을 이어 붙임, 다른 번호를 건너 이어 붙임, 있는 번호·'번' 없는 번호를 기다림, 원 없는 수를 이어 받음,
// 판매 말투 때문에 가격을 놓침·중간 결과에서 품종 없는 꼴을 확정, AUTO 단위 자릿수 경계, 1,000ms 안정 경계·후보가 바뀌었는데 이어 셈.
import { parseAmount } from '@livejjim/core'
import { INTERIM_STABLE_MS, WAITING_MS, interimCandidate, interimFallback, prepareVoiceDictionary, readSegments, stepWaiting, trackInterim, type InterimSeen, type WaitingNumber, type WaitingPiece } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const T = 1_700_000_000_000
const none = (): boolean => false
const piece = (markerNo: number | null, wonPrice: number | null, paired = false): WaitingPiece => ({ markerNo, wonPrice, paired })

describe('D-V3-67 기다리는 번호 (stepWaiting)', () => {
  const w15: WaitingNumber = { no: 15, since: T }

  it('상수: 60,000ms', () => {
    expect(WAITING_MS).toBe(60_000)
  })

  it('"15번"만 들림(상품 없음) → 기다리는 번호가 된다', () => {
    expect(stepWaiting({ waiting: null, now: T, piece: piece(15, null), exists: none })).toEqual({ take: null, card: null, waiting: w15 })
  })

  it('60,000ms에 번호 없는 원 가격 → 이어 받음, 60,001ms → 카드(이어 받지 않음) (R75)', () => {
    expect(stepWaiting({ waiting: w15, now: T + 60_000, piece: piece(null, 20_000), exists: none })).toEqual({ take: { no: 15, price: 20_000 }, card: null, waiting: null })
    const late = stepWaiting({ waiting: w15, now: T + 60_001, piece: piece(null, 20_000), exists: none })
    expect(late.take).toBeNull()
    expect(late.card).toBe(15)
    expect(late.waiting).toBeNull()
  })

  it('다른 N번이 먼저 오면 기다리던 번호는 카드 (R74) — 그 조각이 짝지어 등록돼도', () => {
    const r = stepWaiting({ waiting: w15, now: T + 4000, piece: piece(16, 20_000, true), exists: none })
    expect(r).toEqual({ take: null, card: 15, waiting: null })
    const r2 = stepWaiting({ waiting: w15, now: T + 4000, piece: piece(16, null), exists: none })
    expect([r2.take, r2.card, r2.waiting]).toEqual([null, 15, { no: 16, since: T + 4000 }]) // 16번이 새로 기다림
  })

  it('이미 상품이 있는 번호는 기다리지 않는다 (R79)', () => {
    expect(stepWaiting({ waiting: null, now: T, piece: piece(15, null), exists: (no) => no === 15 })).toEqual({ take: null, card: null, waiting: null })
  })

  it("'번' 없는 번호는 기다리지 않는다 (markerNo null — 원 가격도 없으면 아무것도 아님)", () => {
    expect(stepWaiting({ waiting: null, now: T, piece: piece(null, null), exists: none })).toEqual({ take: null, card: null, waiting: null })
  })

  it("원 확정 가격만 이어 받는다 — 원 없는 수(빠른 꼴)는 wonPrice null이라 이어 받지 않고 계속 기다린다", () => {
    expect(stepWaiting({ waiting: w15, now: T + 1000, piece: piece(null, null), exists: none })).toEqual({ take: null, card: null, waiting: w15 })
  })

  it('같은 번호를 원 가격과 함께 다시 말해 짝지어지면 기다림이 끝난다(카드 없음)', () => {
    expect(stepWaiting({ waiting: w15, now: T + 1000, piece: piece(15, 15_000, true), exists: none })).toEqual({ take: null, card: null, waiting: null })
  })

  it('하나만 기억한다: 기다리는 중 다른 번호만 들리면 전 번호는 카드, 새 번호가 기다림 (R80)', () => {
    let waiting: WaitingNumber | null = null
    const cards: number[] = []
    ;[15, 16, 17, 18].forEach((no, i) => {
      const r = stepWaiting({ waiting, now: T + i * 4000, piece: piece(no, null), exists: none })
      if (r.card !== null) cards.push(r.card)
      waiting = r.waiting
    })
    expect(cards).toEqual([15, 16, 17])
    expect(waiting).toEqual({ no: 18, since: T + 12_000 })
  })

  it('성질: 이어 받는 것은 늘 기다리던 번호 · 그 조각에 N번 없음 · 원 가격 있음 · 60초 안. 카드는 늘 기다리던 번호. 있는 번호는 기다림이 되지 않음', () => {
    fc.assert(
      fc.property(
        fc.option(fc.record({ no: fc.integer({ min: 1, max: 30 }), since: fc.integer({ min: T - 120_000, max: T }) }), { nil: null }),
        fc.integer({ min: 0, max: 130_000 }),
        fc.option(fc.integer({ min: 1, max: 30 }), { nil: null }),
        fc.option(fc.integer({ min: 100, max: 5_000_000 }), { nil: null }),
        fc.boolean(),
        fc.array(fc.integer({ min: 1, max: 30 }), { maxLength: 5 }),
        (waiting, dt, markerNo, wonPrice, paired, existing) => {
          const now = T + dt
          const r = stepWaiting({ waiting, now, piece: piece(markerNo, wonPrice, paired), exists: (no) => existing.includes(no) })
          if (r.take !== null) {
            expect(waiting).not.toBeNull()
            expect(r.take.no).toBe(waiting?.no)
            expect(markerNo).toBeNull()
            expect(r.take.price).toBe(wonPrice)
            expect(now - (waiting as WaitingNumber).since).toBeLessThanOrEqual(WAITING_MS)
            expect(r.waiting).toBeNull()
          }
          if (r.card !== null) expect(r.card).toBe(waiting?.no)
          if (r.waiting !== null && r.waiting !== waiting) {
            expect(r.waiting).toEqual({ no: markerNo, since: now })
            expect(existing).not.toContain(markerNo)
            expect(wonPrice).toBeNull()
          }
          if (waiting !== null && now - waiting.since > WAITING_MS) expect(r.take).toBeNull()
        },
      ),
      { numRuns: 3000 },
    )
  })

  it('넘긴 값을 바꾸지 않고 예외를 던지지 않는다', () => {
    const waiting = Object.freeze({ no: 15, since: T })
    const p = Object.freeze(piece(null, 1000))
    expect(() => stepWaiting({ waiting, now: T + 1, piece: p, exists: () => { throw new Error('x') } })).not.toThrow()
    expect(() => stepWaiting({ waiting: { no: Number.NaN, since: Number.NaN }, now: Number.NaN, piece: piece(15, null), exists: none })).not.toThrow()
  })
})

describe('D-V3-69 판매 말투 (빠른 꼴)', () => {
  const picks = (text: string, final: boolean, priceUnit: 'THOUSAND' | 'AUTO' = 'THOUSAND') => readSegments(text, { dictionary: DICT, final, priceUnit }).picks.map((p) => [p.no, p.name, p.price])
  const TAILS = ['갑니다', '가겠습니다', '갈게요', '가요', '드릴게요', '드려요', '드립니다', '보낼게요', '보냅니다', '보내요', '할게요', '입니다', '이에요', '예요', '요', '까지', '까지요', '가겠습니다요']
  it.each(TAILS)('"150번 180 %s"(최종) → 150번 · 180,000원 (R81)', (tail) => {
    expect(picks(`150번 180 ${tail}`, true)).toEqual([[150, null, 180_000]])
  })
  it.each(['180입니다', '180까지요', '180까지', '180이에요'])('수에 붙은 말투 "150번 %s"(최종) → 180,000원 (R82)', (token) => {
    expect(picks(`150번 ${token}`, true)).toEqual([[150, null, 180_000]])
  })
  // TD-V3-007: R-17 8 판매 말투는 수에 붙은 꼴의 예로 `180이요`를 적었다("180입니다·180까지요·180이요도 그 말투를 뗀 수로 읽는다").
  // 구현은 `180이요`를 읽지 못해 "150번 180이요"의 가격을 놓친다(기다리는 번호 카드로 감).
  it.each(['150번 180이요', '150번 라울 180이요'])('TD-V3-007: "%s"(최종) → 180,000원', (text) => {
    expect(picks(text, true).map(([no, , price]) => [no, price])).toEqual([[150, 180_000]])
  })
  it.each(['150번 180 가', '150번 180 가겠습니다', '150번 180입니다'])('품종 없는 꼴은 중간 결과면 기다림 "%s" (R83)', (text) => {
    expect(picks(text, false)).toEqual([])
  })
  it('품종 있는 꼴은 중간 결과에서도 판매 말투 뒤 군말이면 확정 "150번 라울 180 드릴게요 자" (R84)', () => {
    expect(picks('150번 라울 180 드릴게요 자', false)).toEqual([[150, '라울', 180_000]])
  })
  it.each(['150번 180 개', '150번 180 마리까지', '150번 180 cm요', '150번 180 뿌리'])('말투가 아닌 낱말 "%s" → 가격 아님', (text) => {
    expect(picks(text, true)).toEqual([])
  })
})

describe('D-V3-70 가격 단위 AUTO (R-14 3)', () => {
  const AUTO = { 'price.unit': 'AUTO' } as const
  it.each([
    ['0', 0],
    ['5', 50_000],
    ['25', 250_000],
    ['99', 990_000],
    ['100', 100_000],
    ['180', 180_000],
    ['999', 999_000],
    ['1000', 1_000],
    ['1,000', 1_000],
    ['15000', 15_000],
    ['1.5', 15_000],
    ['99.9', 999_000],
    ['180.5', 180_500],
    ['999.9', 999_900],
    ['6만', 60_000],
    ['5천', 5_000],
    ['18만 원', 180_000],
    ['25원', 25],
    ['180원', 180],
  ])('"%s" → %i원', (text, want) => {
    expect(parseAmount(text, AUTO)).toBe(want)
  })
  it.each(['1000.5', '1.23456', '01', '0500', '10,00'])('"%s" → 읽지 못함', (text) => {
    expect(parseAmount(text, AUTO)).toBeNull()
  })

  it('성질: 단위 없는 수(소수 4자리까지)는 정수부 자릿수로 ×10000·×1000·×1, 원 단위 소수가 남으면 읽지 못함', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), fc.option(fc.integer({ min: 0, max: 9999 }), { nil: null }), (whole, frac) => {
        const fracText = frac === null ? '' : String(frac).padStart(4, '0').replace(/0+$/, '')
        const text = fracText === '' ? String(whole) : `${String(whole)}.${fracText}`
        const factor = whole < 100 ? 10_000 : whole < 1000 ? 1_000 : 1
        // 값 × factor를 정수로: (whole·10^k + f) × factor / 10^k
        const k = fracText.length
        const scaled = (BigInt(whole) * 10n ** BigInt(k) + BigInt(fracText === '' ? 0 : Number(fracText))) * BigInt(factor)
        const want = scaled % 10n ** BigInt(k) === 0n ? Number(scaled / 10n ** BigInt(k)) : null
        expect(parseAmount(text, AUTO), text).toBe(want)
      }),
      { numRuns: 3000 },
    )
  })

  it.each([
    ['150번 180', 150, 180_000], // R85 세 자리 → 천원
    ['육십팔번 이십오', 68, 250_000], // R86 한글 수 25 → 만원
    ['68번 25', 68, 250_000],
    ['68번 9', null, null], // 한 자리 수는 번호도 비움(D-V3-54)
    ['68번 1500', 68, 1_500], // 1000 이상 원 그대로
    ['68번 백팔십', 68, 180_000],
    ['68번 6만', 68, 60_000], // 단위 붙은 말은 적힌 대로
  ] as const)('빠른 꼴 AUTO "%s"(최종) → %s번 · %s원', (text, no, price) => {
    const p = readSegments(text, { dictionary: DICT, final: true, priceUnit: 'AUTO' }).picks
    expect(p.map((x) => [x.no, x.price])).toEqual(no === null ? [] : [[no, price]])
  })
  it('R87 "148번 라울 280 갑니다 자"(중간) → 148번 · 라울 · 280,000원', () => {
    expect(readSegments('148번 라울 280 갑니다 자', { dictionary: DICT, final: false, priceUnit: 'AUTO' }).picks.map((p) => [p.no, p.name, p.price])).toEqual([[148, '라울', 280_000]])
  })
})

describe('D-V3-71 중간 결과 안정 (trackInterim·interimFallback)', () => {
  const opts = { dictionary: DICT, priceUnit: 'THOUSAND' as const }
  it('상수: 1,000ms', () => {
    expect(INTERIM_STABLE_MS).toBe(1_000)
  })
  it('후보: 중간 결과 "148번 280"은 후보, "148번 28만 원"(원 짝 — 이미 확정)·"148번"·"148번 280 개"는 후보 아님', () => {
    expect(interimCandidate('148번 280', opts)).toEqual({ no: 148, price: 280_000, name: null })
    expect(interimCandidate('148번 28만 원', opts)).toBeNull()
    expect(interimCandidate('148번', opts)).toBeNull()
    expect(interimCandidate('148번 280 개', opts)).toBeNull()
  })

  it('R89: 같은 후보가 999ms면 아직, 1,000ms면 확정', () => {
    const c = interimCandidate('148번 280', opts)
    let s = trackInterim([], c, T)
    expect(s.stable).toBeNull()
    s = trackInterim(s.seen, interimCandidate('148번 280', opts), T + 999)
    expect(s.stable).toBeNull()
    s = trackInterim(s.seen, interimCandidate('148번 280', opts), T + 1000)
    expect(s.stable).toMatchObject({ no: 148, price: 280_000 })
  })

  it('R90: 500ms에 "148번 280만"으로 바뀌면 다시 센다 — 1,000ms엔 아무것도, 1,500ms에 2,800,000원 (280,000원 확정 없음)', () => {
    let s = trackInterim([], interimCandidate('148번 280', opts), T)
    s = trackInterim(s.seen, interimCandidate('148번 280만', opts), T + 500)
    // "148번 280만"은 품종 없는 빠른 꼴(단위 붙은 금액) — 후보가 아니면 280,000원 후보도 1,000ms가 되지 않는다
    s = trackInterim(s.seen, interimCandidate('148번 280만', opts), T + 1000)
    expect(s.stable?.price ?? null).not.toBe(280_000)
    s = trackInterim(s.seen, interimCandidate('148번 280만', opts), T + 1500)
    expect(s.stable).toMatchObject({ no: 148, price: 2_800_000 })
  })

  it('후보가 바뀌었다가 돌아와도 처음부터 다시 센다 (280 → 290 → 280)', () => {
    let s = trackInterim([], { no: 148, price: 280_000, name: null }, T)
    s = trackInterim(s.seen, { no: 148, price: 290_000, name: null }, T + 400)
    s = trackInterim(s.seen, { no: 148, price: 280_000, name: null }, T + 800)
    s = trackInterim(s.seen, { no: 148, price: 280_000, name: null }, T + 1500)
    expect(s.stable).toBeNull() // 280,000원은 800ms부터 700ms만 보임
    s = trackInterim(s.seen, { no: 148, price: 280_000, name: null }, T + 1800)
    expect(s.stable).toMatchObject({ price: 280_000 })
  })

  it('R91: 800ms만 보인 후보는 최종에서 사라져도 쓰지 않는다 · R92: 1,200ms 보인 후보는 최종에서 가격이 사라지면 그 후보로', () => {
    const short: InterimSeen[] = [{ no: 148, price: 280_000, name: null, since: T, until: T + 800 }]
    const long: InterimSeen[] = [{ no: 148, price: 280_000, name: null, since: T, until: T + 1200 }]
    const finalPicks = readSegments('148번 자 회장님들 자국 8번 캡처 떠 주시고요 132번', { ...opts, final: true }).picks
    expect(interimFallback(short, finalPicks)).toBeNull()
    expect(interimFallback(long, finalPicks)).toMatchObject({ no: 148, price: 280_000 })
    // 이미 등록한 번호는 쓰지 않는다
    expect(interimFallback(long, finalPicks, [148])).toBeNull()
    // 최종 글에 그 번호의 가격이 있으면(다르더라도) 중간 후보로 등록하지 않는다 — 고침은 R-22
    const withPrice = readSegments('148번 30만 원', { ...opts, final: true }).picks
    expect(interimFallback(long, withPrice)).toBeNull()
  })

  it('성질: stable은 늘 지금 후보이고 처음 본 때부터 1,000ms 이상 같은 후보였다', () => {
    const cand = fc.option(fc.record({ no: fc.constantFrom(148, 149), price: fc.constantFrom(280_000, 2_800_000), name: fc.constant(null) }), { nil: null })
    fc.assert(
      fc.property(fc.array(fc.tuple(cand, fc.integer({ min: 0, max: 700 })), { minLength: 1, maxLength: 12 }), (steps) => {
        let seen: InterimSeen[] = []
        let now = T
        const history: { at: number; c: (typeof steps)[number][0] }[] = []
        for (const [c, dt] of steps) {
          now += dt
          history.push({ at: now, c })
          const r = trackInterim(seen, c, now)
          seen = r.seen
          if (r.stable !== null) {
            expect(c).not.toBeNull()
            expect([r.stable.no, r.stable.price]).toEqual([c?.no, c?.price])
            // 바뀌지 않은 연속 구간(후보 null은 끊지 않음)의 처음부터 지금까지 1,000ms 이상
            let start = now
            for (let i = history.length - 1; i >= 0; i--) {
              const h = history[i] as (typeof history)[number]
              if (h.c === null) continue
              if (h.c.no !== c?.no || h.c.price !== c?.price) break
              start = h.at
            }
            expect(now - start).toBeGreaterThanOrEqual(INTERIM_STABLE_MS)
          }
        }
      }),
      { numRuns: 2000 },
    )
  })
})
