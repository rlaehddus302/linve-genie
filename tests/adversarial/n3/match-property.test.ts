// N3 적대 테스트 (test-domain): 맞추기 순수 함수(DP-5)의 속성 — acceptance L "맞추기 속성".
// 무작위 묶음·입금 열(실제 방송 뒤 모양: 몇 안 되는 닉네임·메모, 남은 금액과 같은 입금이 흔함, 동명·쌍둥이·판매 전 입금·30일 경계)에서
// (1) 자동 확인은 M이 정확히 하나이고 S ≤ 1이고 쌍둥이가 없을 때뿐 (2) 자동 확인한 묶음은 그 순간 남은 금액 = 입금 금액
// (3) 같은 묶음이 한 열에서 두 번 자동으로 채워지지 않는다(남은 금액이 음수가 되지 않는다) (4) 판매 전·30일 밖·빈 이름은 자동 확인 안 됨
// (5) 제안 5개 이하·중복 없음·미리 고른 묶음은 제안 안 (6) 같은 입력 두 번 = 같은 출력.
// 기대 판정은 규칙 문장(DP-4·DP-5)만으로 이 파일 안에서 따로 계산한다(구현을 보지 않는다).
import { evaluateDeposits, matchDeposits, normalizeDepositName, type MatchBundle, type MatchDeposit } from '@livejjim/server'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DAY_MS = 86_400_000
const KST = 9 * 3_600_000
/** 2026-10-18 00:00 KST */
const BASE = Date.UTC(2026, 9, 17, 15, 0, 0)
const kstDate = (ms: number): string => new Date(Math.floor((ms + KST) / DAY_MS) * DAY_MS).toISOString().slice(0, 10)
const dateOfOffset = (days: number): string => kstDate(BASE + days * DAY_MS)

const NAMES = ['다육이맘', '다육이 맘', 'ＤＡＹＵＫ', 'dayuk', '김영희', '홍길동', '길동이', '', '  ', '선인장']
const AMOUNTS = [10_000, 14_000, 20_000, 24_000, 4000]

const bundleArb = fc.record({
  buyer: fc.constantFrom('UC_A', 'UC_B', 'UC_C', 'sms:1', 'sms:2'),
  day: fc.integer({ min: -35, max: 2 }),
  names: fc.array(fc.constantFrom(...NAMES), { maxLength: 3 }),
  total: fc.constantFrom(...AMOUNTS),
  received: fc.constantFrom(0, 0, 0, 4000, 10_000, 14_000),
  saleMinute: fc.option(fc.integer({ min: 0, max: 24 * 60 }), { nil: null, freq: 6 }),
})

const depositArb = fc.record({
  day: fc.integer({ min: -2, max: 3 }),
  minute: fc.integer({ min: 0, max: 24 * 60 - 1 }),
  amount: fc.constantFrom(...AMOUNTS),
  name: fc.constantFrom(...NAMES),
})

interface Gen {
  bundles: MatchBundle[]
  earlier: MatchDeposit[]
  incoming: MatchDeposit[]
}

const genArb = fc
  .record({
    bundles: fc.array(bundleArb, { maxLength: 8 }),
    earlier: fc.array(depositArb, { maxLength: 3 }),
    incoming: fc.array(depositArb, { minLength: 1, maxLength: 6 }),
  })
  .map(({ bundles, earlier, incoming }): Gen => {
    const seen = new Set<string>()
    const out: MatchBundle[] = []
    for (const b of bundles) {
      const date = dateOfOffset(b.day)
      const key = JSON.stringify([b.buyer, date])
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, buyer: b.buyer, date, names: b.names, total: b.total, received: b.received, saleAt: b.saleMinute === null ? null : BASE + b.day * DAY_MS + b.saleMinute * 60_000 })
    }
    let no = 0
    const mk = (d: { day: number; minute: number; amount: number; name: string }): MatchDeposit => ({ no: ++no, at: BASE + d.day * DAY_MS + d.minute * 60_000, amount: d.amount, name: d.name })
    return { bundles: out, earlier: earlier.map(mk), incoming: incoming.map(mk) }
  })

/** 규칙 문장만으로 따로 계산한 DP-5 판정 */
function oracle(gen: Gen): { no: number; auto: string | null; reason: string | null; suggestions: string[]; preselect: string | null }[] {
  const received = new Map(gen.bundles.map((b) => [b.key, b.received]))
  const before: MatchDeposit[] = [...gen.earlier]
  const out: ReturnType<typeof oracle> = []
  for (const d of gen.incoming) {
    const n = normalizeDepositName(d.name)
    const dd = kstDate(d.at)
    const from = kstDate(Date.parse(`${dd}T00:00:00+09:00`) - 30 * DAY_MS)
    const E = gen.bundles.filter((b) => b.saleAt !== null && b.date >= from && b.date <= dd && b.saleAt <= d.at)
    const named = (b: MatchBundle) => n !== '' && b.names.map(normalizeDepositName).filter((x) => x !== '').includes(n)
    const rem = (b: MatchBundle) => b.total - (received.get(b.key) as number)
    const S = new Set(E.filter(named).map((b) => b.buyer))
    const A = E.filter((b) => rem(b) === d.amount)
    const M = A.filter(named)
    const twin = n !== '' && before.some((o) => o.amount === d.amount && kstDate(o.at) === dd && normalizeDepositName(o.name) === n)
    const order = (x: MatchBundle, y: MatchBundle) => (x.date !== y.date ? (x.date < y.date ? 1 : -1) : x.buyer < y.buyer ? -1 : x.buyer > y.buyer ? 1 : 0)
    const all = [...[...M].sort(order), ...A.filter((b) => !named(b)).sort(order), ...E.filter((b) => named(b) && rem(b) !== d.amount).sort(order)].map((b) => b.key)
    let auto: string | null = null
    let reason: string | null
    if (twin) reason = 'POSSIBLE_DUPLICATE'
    else if (S.size >= 2) reason = 'SAME_NAME'
    else if (M.length === 1) {
      auto = (M[0] as MatchBundle).key
      reason = null
    } else if (M.length >= 2) reason = 'MULTIPLE'
    else if (A.length >= 1) reason = 'NAME_MISMATCH'
    else if (S.size === 1) reason = 'AMOUNT_MISMATCH'
    else reason = 'NO_MATCH'
    if (auto !== null) received.set(auto, (received.get(auto) as number) + d.amount)
    out.push({ no: d.no, auto, reason, suggestions: all.slice(0, 5), preselect: auto ?? (all.length === 1 ? (all[0] as string) : null) })
    before.push(d)
  }
  return out
}

describe('DP-5 맞추기 속성 (fast-check)', () => {
  it('규칙 문장으로 따로 계산한 판정과 같고, (1)~(6) 속성을 지킨다', () => {
    fc.assert(
      fc.property(genArb, (gen) => {
        const got = evaluateDeposits(gen)
        const want = oracle(gen)
        expect(got.map((r) => ({ no: r.no, auto: r.auto, reason: r.reason, suggestions: [...r.suggestions], preselect: r.preselect }))).toEqual(want)
        // (6) 결정성 — 같은 입력 두 번, 입력을 고치지 않는다
        const frozen = JSON.stringify(gen)
        expect(matchDeposits(gen)).toEqual(matchDeposits(gen))
        expect(JSON.stringify(gen)).toBe(frozen)
        // (2)(3) 자동 확인 순간 남은 금액 = 입금 금액, 같은 묶음 두 번 채움 없음 → 자동으로 더한 뒤 남은 금액은 음수가 아니다
        const received = new Map(gen.bundles.map((b) => [b.key, b.received]))
        for (const [i, r] of got.entries()) {
          const d = gen.incoming[i] as MatchDeposit
          if (r.auto !== null) {
            const b = gen.bundles.find((x) => x.key === r.auto) as MatchBundle
            expect(b.total - (received.get(b.key) as number)).toBe(d.amount)
            received.set(b.key, (received.get(b.key) as number) + d.amount)
            expect(b.total - (received.get(b.key) as number)).toBe(0)
            // (4) 판매 전·30일 밖·빈 이름 아님
            expect(normalizeDepositName(d.name)).not.toBe('')
            expect(b.saleAt).not.toBeNull()
            expect(b.saleAt as number).toBeLessThanOrEqual(d.at)
            expect(b.date <= kstDate(d.at)).toBe(true)
          }
          // (5) 제안 5개 이하·중복 없음·미리 고른 묶음은 제안 안
          expect(r.suggestions.length).toBeLessThanOrEqual(5)
          expect(new Set(r.suggestions).size).toBe(r.suggestions.length)
          if (r.preselect !== null) expect(r.suggestions).toContain(r.preselect)
        }
      }),
      { numRuns: 400 },
    )
  })

  it('입금 순서를 바꿔도 같은 묶음은 많아야 한 번 자동으로 채워진다 (몰린 입금)', () => {
    fc.assert(
      fc.property(genArb, fc.integer({ min: 0, max: 1000 }), (gen, seed) => {
        const shuffled = [...gen.incoming].sort((x, y) => ((x.no * 7919 + seed) % 101) - ((y.no * 7919 + seed) % 101))
        for (const order of [gen.incoming, shuffled]) {
          const got = evaluateDeposits({ ...gen, incoming: order })
          const filled = new Map<string, number>()
          for (const [i, r] of got.entries()) if (r.auto !== null) filled.set(r.auto, (filled.get(r.auto) ?? 0) + (order[i] as MatchDeposit).amount)
          for (const [key, sum] of filled) {
            const b = gen.bundles.find((x) => x.key === key) as MatchBundle
            expect(b.received + sum).toBeLessThanOrEqual(b.total)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})
