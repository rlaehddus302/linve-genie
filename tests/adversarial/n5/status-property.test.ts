// N5 적대 테스트 (test-domain): 요금 상태 순수 함수의 속성 시험 (AC-N5-01·05, BILLING_RULES BL-2·BL-3·BL-4·BL-7·BL-9 1).
// 규칙서 문장만으로 다시 짠 계산(아래 ref*)과 서버의 billingStatus·billingBanners를 무작위 원장에서 대조한다.
// - (1) 잔량 = 받은 양 − 쓴 수, (2) 사슬은 겹치지 않고 부여 순서이고 각 30×24시간, (3) refundable = 결제·7일 안·쓰지 않음(정의대로),
//   (4) start는 BL-4 순서, (5) 같은 입력 두 번·TZ 셋 = 같은 출력. 알림 띠 다섯 경우(BL-9 1)도 조건 그대로.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { billingBanners, billingStatus, type LedgerGrant, type LedgerUsage, type StatusInput } from '@livejjim/server'

const H = 3_600_000
const D = 24 * H
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0)

type Kind = 'FLAT_30D' | 'DAYS' | 'ORDERS' | 'LABELS'
const QTY: readonly Kind[] = ['DAYS', 'ORDERS', 'LABELS']

// 시각은 한 시간 단위 + 경계(정확히 30일·7일·24시간)가 자주 나오게 고른다
const time = fc.oneof(
  fc.integer({ min: 0, max: 80 * 24 }).map((h) => T0 + h * H),
  fc.constantFrom(T0, T0 + 30 * D, T0 + 7 * D, T0 + D, T0 + 60 * D, T0 + 37 * D),
)

const grantArb = fc.record({
  kind: fc.constantFrom<Kind>('FLAT_30D', 'DAYS', 'ORDERS', 'LABELS'),
  quantity: fc.integer({ min: 1, max: 5 }),
  source: fc.constantFrom<'PAYMENT' | 'OPERATOR'>('PAYMENT', 'OPERATOR'),
  at: time,
  revoked: fc.boolean(),
})

const inputArb = fc
  .record({
    grants: fc.array(grantArb, { maxLength: 7 }),
    // 방송 일 쓴 기록은 겹치지 않게(BL-INV-2) — 시작 시각을 정렬해 24시간 넘게 띄운다
    dayGaps: fc.array(fc.integer({ min: 24, max: 24 * 10 }), { maxLength: 4 }),
    dayStart: fc.integer({ min: 0, max: 40 * 24 }),
    orders: fc.integer({ min: 0, max: 12 }),
    labels: fc.integer({ min: 0, max: 12 }),
    flatStarts: fc.array(time, { maxLength: 4 }),
    now: time,
  })
  .map(({ grants, dayGaps, dayStart, orders, labels, flatStarts, now }) => {
    const ledgerGrants: LedgerGrant[] = grants.map((g, i) => ({
      id: `g${String(i).padStart(2, '0')}`,
      kind: g.kind,
      ...(g.kind === 'FLAT_30D' ? {} : { quantity: g.quantity }),
      source: g.source,
      at: g.at,
      ...(g.revoked ? { revoked: true } : {}),
    }))
    const usage: LedgerUsage[] = []
    let t = T0 + dayStart * H
    for (const gap of dayGaps) {
      usage.push({ kind: 'DAYS', at: t })
      t += gap * H
    }
    // 주문 건·라벨 장은 한 줄씩 (count 없이) 또는 묶어서 — 둘 다 받아야 한다
    for (let i = 0; i < orders; i++) usage.push({ kind: 'ORDERS', at: T0 + i * H })
    if (labels > 0) usage.push({ kind: 'LABELS', at: T0, count: labels })
    const input: StatusInput = { grants: ledgerGrants, usage, flatStarts, now }
    return input
  })

// ── 규칙서 문장으로 다시 짠 계산 ─────────────────────────────────────────

const order = (a: LedgerGrant, b: LedgerGrant) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function refChain(grants: readonly LedgerGrant[]) {
  const links: { grant: string; from: number; until: number }[] = []
  for (const g of grants.filter((x) => x.kind === 'FLAT_30D' && x.revoked !== true).sort(order)) {
    const prev = links.at(-1)
    const from = prev === undefined ? g.at : Math.max(g.at, prev.until)
    links.push({ grant: g.id, from, until: from + 30 * D })
  }
  return links
}

function refUsed(usage: readonly LedgerUsage[], kind: Kind): number {
  return usage.filter((u) => u.kind === kind).reduce((s, u) => s + (u.kind === 'DAYS' ? 1 : (u.count ?? 1)), 0)
}

function ref(input: StatusInput) {
  const { grants, usage, flatStarts, now } = input
  const chain = refChain(grants)
  const cur = chain.find((l) => l.from <= now && now < l.until)
  let until: number | null = null
  if (cur !== undefined) {
    until = cur.until
    let moved = true
    while (moved) {
      moved = false
      const next = chain.find((l) => l.from === until)
      if (next !== undefined) {
        until = next.until
        moved = true
      }
    }
  }
  const live = grants.filter((g) => g.revoked !== true)
  const balances = Object.fromEntries(QTY.map((k) => [k, live.filter((g) => g.kind === k).reduce((s, g) => s + (g.quantity ?? 0), 0) - refUsed(usage, k)])) as Record<
    'DAYS' | 'ORDERS' | 'LABELS',
    number
  >
  const open = usage.filter((u) => u.kind === 'DAYS' && u.at <= now && now < u.at + D)
  const refundable: string[] = []
  for (const g of [...live].sort(order)) {
    if (g.source !== 'PAYMENT' || !(now < g.at + 7 * D)) continue
    if (g.kind === 'FLAT_30D') {
      const link = chain.find((l) => l.grant === g.id)
      if (link !== undefined && flatStarts.every((s) => !(link.from <= s && s < link.until))) refundable.push(g.id)
    } else {
      const before = live.filter((o) => o.kind === g.kind && order(o, g) < 0).reduce((s, o) => s + (o.quantity ?? 0), 0)
      if (refUsed(usage, g.kind) <= before) refundable.push(g.id)
    }
  }
  const start =
    cur !== undefined
      ? { allowed: true, mode: 'FLAT', useDay: false }
      : open.length > 0
        ? { allowed: true, mode: 'DAY', useDay: false }
        : balances.DAYS >= 1
          ? { allowed: true, mode: 'DAY', useDay: true }
          : balances.ORDERS >= 1
            ? { allowed: true, mode: 'ORDERS', useDay: false }
            : { allowed: false, reason: 'NO_PASS' }
  // 알림 띠 (BL-9 1)
  const banners: unknown[] = []
  let ended = false
  if (cur !== undefined && until !== null && until - now <= 7 * D) banners.push({ kind: 'FLAT_REMAINING', days: Math.ceil((until - now) / D), until })
  if (cur === undefined && chain.length > 0) {
    const last = Math.max(...chain.map((l) => l.until))
    if (last <= now && now < last + 7 * D && !start.allowed) {
      banners.push({ kind: 'FLAT_ENDED', at: last })
      ended = true
    }
  }
  if (!ended && !start.allowed) banners.push({ kind: 'NO_PASS' })
  if (balances.ORDERS < 0) banners.push({ kind: 'ORDERS_OVER', count: -balances.ORDERS })
  if (balances.LABELS < 0) banners.push({ kind: 'LABELS_OVER', count: -balances.LABELS })
  return { chain, active: cur !== undefined, until, balances, open, refundable, start, banners }
}

describe('N5 요금 상태 속성 (AC-N5-01·05, BL-2·3·4·7·9)', () => {
  it('무작위 원장: 사슬·잔량·열린 창·환불 가능·시작·알림 띠가 규칙서 문장대로다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const got = billingStatus(input)
        const want = ref(input)
        expect(got.flat.chain).toEqual(want.chain)
        expect(got.flat.active).toBe(want.active)
        expect(got.flat.until).toBe(want.until)
        expect(got.balances).toEqual(want.balances)
        expect(got.window === null).toBe(want.open.length === 0)
        if (got.window !== null) expect(want.open.map((u) => u.at)).toContain(got.window.from)
        expect(got.refundable).toEqual(want.refundable)
        expect(got.start).toEqual(want.start)
        expect(billingBanners(got, input.now)).toEqual(want.banners)
      }),
      { numRuns: 1500 },
    )
  })

  it('사슬은 겹치지 않고 부여 순서이며 각 30×24시간, 회수한 이용권은 빠진다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { chain } = billingStatus(input).flat
        const live = input.grants.filter((g) => g.kind === 'FLAT_30D' && g.revoked !== true)
        expect(chain).toHaveLength(live.length)
        chain.forEach((link, i) => {
          expect(link.until - link.from).toBe(30 * D)
          const g = live.find((x) => x.id === link.grant)
          expect(g).toBeDefined()
          expect(link.from).toBeGreaterThanOrEqual(g?.at ?? 0)
          const prev = chain[i - 1]
          if (prev !== undefined) expect(link.from).toBeGreaterThanOrEqual(prev.until)
        })
      }),
      { numRuns: 500 },
    )
  })

  it('라벨 장권만 있으면 언제나 NO_PASS, 정액 이용 중이면 언제나 FLAT', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), time, (labels, now) => {
        const onlyLabels = billingStatus({ grants: [{ id: 'g1', kind: 'LABELS', quantity: labels, source: 'PAYMENT', at: T0 }], usage: [], flatStarts: [], now })
        expect(onlyLabels.start).toEqual({ allowed: false, reason: 'NO_PASS' })
        const flatNow = billingStatus({
          grants: [
            { id: 'g1', kind: 'FLAT_30D', source: 'OPERATOR', at: now - 1 },
            { id: 'g2', kind: 'DAYS', quantity: 3, source: 'PAYMENT', at: T0 },
          ],
          usage: [],
          flatStarts: [],
          now,
        })
        expect(flatNow.start).toEqual({ allowed: true, mode: 'FLAT', useDay: false })
      }),
    )
  })

  it('결정성: 같은 입력 두 번·입력 배열 순서를 섞어도 같은 출력 (환경 시간대와 상관없다)', () => {
    fc.assert(
      fc.property(inputArb, fc.integer(), (input, seed) => {
        const a = billingStatus(input)
        const b = billingStatus(input)
        expect(b).toEqual(a)
        // 원장을 읽는 순서는 판단을 바꾸지 않는다 (정렬은 시각 다음 ID)
        const rotate = <T>(xs: readonly T[]): T[] => (xs.length === 0 ? [] : [...xs.slice(Math.abs(seed) % xs.length), ...xs.slice(0, Math.abs(seed) % xs.length)])
        const c = billingStatus({ ...input, grants: rotate(input.grants), usage: rotate(input.usage), flatStarts: rotate(input.flatStarts) })
        expect(c).toEqual(a)
      }),
      { numRuns: 300 },
    )
  })
})
