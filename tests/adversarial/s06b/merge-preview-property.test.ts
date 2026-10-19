// S06b 적대 테스트 (test-domain): 합치기 미리 보기 = 실제 합치기 (AC-S06b-03, R-11, INV-2, INV-5, NFR-02, D-100).
// 코어 단위 시험보다 넓은 무작위 로그로 공격한다 — 방송 둘(선언 순서가 사전 순과 반대), 재고 1·2, 채팅·문자찜(뒤 4자리만 같은 두 번호·
// 지정 구매자·전화번호 없음)·취소·거절·올리기·지정·충돌 결정·번호 변경·재고 수정·합치기·떼어 내기를 섞는다.
// 판매 뒤 장부 정리처럼 로그 중간 여러 시점에서 모든 구매자 쌍(모르는 ID·__proto__·같은 ID·합쳐진 구매자·고리 포함)을 본다.
// 미리 보기의 막힘·bothConfirmed·남는 찜은 코어 내부(planMerge)가 아니라 공개 조회(listClaims·getBuyer·getProduct)로 따로 계산한 값과 비교한다.
import {
  applyEvent,
  checkInvariants,
  getBuyer,
  getProduct,
  initEngine,
  listBuyers,
  listClaims,
  previewMerge,
  type ClaimInfo,
  type EngineEvent,
  type EngineState,
  type MergePreview,
  type SettingsOverride,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

/** 2026-10-18 20:00:00 KST */
const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)
/** 선언 순서: bz(1부) 먼저, ba(2부) 다음 — 사전 순과 반대라 정렬 실수를 드러낸다 */
const BROADCASTS = [
  { id: 'bz', date: '2026-10-18', title: '1부' },
  { id: 'ba', date: '2026-10-18', title: '2부' },
] as const
const PLACE: Record<string, number> = { bz: 0, ba: 1 }
const CHANNELS = ['UCa', 'UCb', 'UCc', 'UCd', 'UCe'] as const
/** 뒤 4자리만 같은 두 번호 + 다른 번호 (phoneKey는 번호마다 다른 불투명 키) */
const PHONES = [
  { phoneKey: 'k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', phoneLast4: '5678' },
  { phoneKey: 'k_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2', phoneLast4: '5678' },
  { phoneKey: 'k_cccccccccccccccccccccccccccccc3', phoneLast4: '1234' },
  null,
] as const

type Step =
  | { readonly kind: 'chat'; readonly b: number; readonly ch: number; readonly nos: readonly number[] }
  | { readonly kind: 'sms'; readonly b: number; readonly no: number; readonly phone: number; readonly time: number; readonly second: number; readonly designate: number | null }
  | { readonly kind: 'host'; readonly type: 'host.cancel' | 'host.reject' | 'host.promote' | 'host.confirm'; readonly b: number; readonly no: number; readonly who: number }
  | { readonly kind: 'assign'; readonly b: number; readonly no: number; readonly who: number }
  | { readonly kind: 'resolve'; readonly b: number; readonly no: number; readonly decision: 'KEEP' | 'SWITCH' }
  | { readonly kind: 'open'; readonly b: number; readonly no: number }
  | { readonly kind: 'stock'; readonly b: number; readonly no: number; readonly stock: number }
  | { readonly kind: 'renumber'; readonly b: number; readonly from: number; readonly to: number }
  | { readonly kind: 'merge'; readonly from: number; readonly into: number }
  | { readonly kind: 'unmerge'; readonly from: number }
  | { readonly kind: 'block'; readonly who: number; readonly on: boolean }
  | { readonly kind: 'pay'; readonly who: number }

const bi = fc.integer({ min: 0, max: 1 })
const no = fc.integer({ min: 1, max: 4 })
const who = fc.integer({ min: 0, max: 9 })
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('chat' as const), b: bi, ch: fc.integer({ min: 0, max: 4 }), nos: fc.array(no, { minLength: 1, maxLength: 3 }) }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('sms' as const),
      b: bi,
      no,
      phone: fc.integer({ min: 0, max: 3 }),
      time: fc.integer({ min: 0, max: 2 }),
      second: fc.integer({ min: 0, max: 59 }),
      designate: fc.option(who, { nil: null }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('host' as const), type: fc.constantFrom('host.cancel' as const, 'host.reject' as const, 'host.promote' as const, 'host.confirm' as const), b: bi, no, who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('assign' as const), b: bi, no, who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('resolve' as const), b: bi, no, decision: fc.constantFrom('KEEP' as const, 'SWITCH' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('open' as const), b: bi, no }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('stock' as const), b: bi, no, stock: fc.integer({ min: 1, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('renumber' as const), b: bi, from: no, to: fc.integer({ min: 1, max: 6 }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('merge' as const), from: who, into: who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('unmerge' as const), from: who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('block' as const), who, on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('pay' as const), who }) },
)

const SETTINGS: readonly SettingsOverride[] = [
  {},
  { 'contention.policy': 'RECEIVED_TIME' },
  { 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': 'HOST' },
]

/** 알려진 구매자 중 하나 (없거나 범위를 넘으면 모르는 구매자) */
const pick = (state: EngineState, index: number): string => listBuyers(state)[index]?.id ?? 'UC_unknown'

function eventOf(state: EngineState, s: Step, refs: { n: number }): Record<string, unknown> {
  const b = 'b' in s ? BROADCASTS[s.b]?.id : 'bz'
  switch (s.kind) {
    case 'chat':
      return { type: 'chat', b, id: `m${String(refs.n++)}`, ch: CHANNELS[s.ch], nick: '홍길동', text: s.nos.join(' ') }
    case 'sms': {
      const phone = PHONES[s.phone]
      return {
        type: 'sms',
        b,
        ref: `r${String(refs.n++)}`,
        no: s.no,
        // 초까지(늦게 온 선순위 — 역전·잠금 뒤 충돌), 분까지(HOST 동률 충돌), 방송 전 시각
        received: s.time === 0 ? `20:00:${String(s.second).padStart(2, '0')}` : s.time === 1 ? '20:00' : `19:59:${String(s.second).padStart(2, '0')}`,
        memo: '김씨',
        ...(phone ?? {}),
        ...(s.designate === null ? {} : { buyer: pick(state, s.designate) }),
      }
    }
    case 'host':
      return { type: s.type, b, no: s.no, buyer: pick(state, s.who), reason: '사유' }
    case 'assign':
      return { type: 'host.assign', b, no: s.no, buyer: pick(state, s.who), reason: '지정' }
    case 'resolve':
      return { type: 'host.resolveConflict', b, no: s.no, decision: s.decision, reason: '결정' }
    case 'open':
      return { type: 'product.open', b, no: s.no }
    case 'stock':
      return { type: 'product.update', b, no: s.no, stock: s.stock }
    case 'renumber':
      return { type: 'product.renumber', b, from: s.from, to: s.to }
    case 'merge':
      return { type: 'buyer.merge', from: pick(state, s.from), into: pick(state, s.into), reason: '같은 사람' }
    case 'unmerge':
      return { type: 'buyer.unmerge', from: pick(state, s.from), reason: '잘못 합침' }
    case 'block':
      return { type: s.on ? 'host.blockBuyer' : 'host.unblockBuyer', buyer: pick(state, s.who), reason: '장난 찜' }
    case 'pay':
      // 입금 기록은 확정을 잠근다 (R-7 3) — 늦게 온 선순위 찜이 충돌이 된다
      return { type: 'settlement.payment', buyer: pick(state, s.who), date: '2026-10-18', amount: 1000 }
  }
}

/** 로그를 적용하며 상태 목록을 남긴다. 입력 오류(없는 상품 번호 등)로 거절되는 이벤트는 건너뛴다 */
function run(stocks: readonly number[], ready: readonly boolean[], steps: readonly Step[], settings: SettingsOverride): EngineState[] {
  let state = initEngine({ broadcasts: BROADCASTS, settings })
  const states: EngineState[] = []
  let seq = 0
  const refs = { n: 1 }
  const apply = (event: Record<string, unknown>): void => {
    seq += 1
    try {
      state = applyEvent(state, { seq, at: T0 + seq * 1000, ...event } as unknown as EngineEvent).state
    } catch (error) {
      if ((error as { name?: string }).name !== 'InvalidEventError') throw error
    }
  }
  // 두 방송에 1~4번: 재고 1·2, 일부는 READY(보류 찜이 쌓였다가 공개 때 판정)
  for (const b of ['bz', 'ba']) {
    for (let n = 1; n <= 4; n += 1) {
      const i = (b === 'bz' ? 0 : 4) + n - 1
      apply({ type: 'product.register', b, no: n, name: '핑크프릴', price: 1000 * n + (b === 'ba' ? 500 : 0), stock: stocks[i] ?? 1, status: ready[i] === true ? 'READY' : 'OPEN' })
    }
  }
  for (const s of steps) {
    apply(eventOf(state, s, refs))
    states.push(state)
  }
  return states
}

const placeOf = (key: string): [number, number] => {
  const [b, n] = key.split('/')
  return [PLACE[b as string] ?? 99, Number(n)]
}
const byPlace = (a: string, b: string): number => {
  const [pa, na] = placeOf(a)
  const [pb, nb] = placeOf(b)
  return pa - pb || na - nb
}

const ACTIVE = new Set(['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'])

/** 공개 조회만으로 계산한 기대 막힘 (위에서부터 처음 맞는 것) */
function expectedBlock(state: EngineState, from: string, into: string): { blocked: MergePreview['blocked']; target: string | null; bothConfirmed: string[] } {
  const source = getBuyer(state, from)
  const intoInfo = getBuyer(state, into)
  const target = intoInfo === null ? null : intoInfo.current
  if (source === null || intoInfo === null) return { blocked: 'UNKNOWN_BUYER', target, bothConfirmed: [] }
  if (from === into) return { blocked: 'SAME_BUYER', target, bothConfirmed: [] }
  if (source.mergedInto !== null) return { blocked: 'FROM_MERGED', target, bothConfirmed: [] }
  if (target === from) return { blocked: 'CYCLE', target, bothConfirmed: [] }
  const fromTree = new Set([from, ...source.merged])
  const claims = listClaims(state)
  const both = new Set<string>()
  for (const c of claims) {
    if (c.status !== 'CONFIRMED' || !fromTree.has(c.buyer)) continue
    if (claims.some((o) => o.status === 'CONFIRMED' && o.currentBuyer === target && o.product === c.product)) both.add(c.product)
  }
  const bothConfirmed = [...both].sort(byPlace)
  return { blocked: bothConfirmed.length > 0 ? 'BOTH_CONFIRMED' : null, target, bothConfirmed }
}

/** R-11 "앞선 쪽"의 상태 순서 — 같은 상태면 대기는 순번, 그 밖은 판정 순위(여기서는 비교하지 않음 → 0) */
const RANK: Record<string, number> = { CONFIRMED: 0, CONFLICT: 1, WAITLISTED: 2, PENDING: 3 }
function aheadByStatus(state: EngineState, a: ClaimInfo, b: ClaimInfo): number {
  const byStatus = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)
  if (byStatus !== 0) return byStatus
  if (a.status === 'WAITLISTED') {
    const product = getProduct(state, a.broadcast, a.no)
    const list = product?.waitlistClaims ?? []
    return list.indexOf(a.id) - list.indexOf(b.id)
  }
  return 0
}

function checkPair(state: EngineState, from: string, into: string): void {
  const where = `${from} → ${into}`
  const preview = previewMerge(state, from, into)
  expect(previewMerge(state, from, into), `${where}: 두 번 같다`).toEqual(preview)
  expect(JSON.parse(JSON.stringify(preview)), `${where}: JSON 그대로`).toEqual(preview)
  expect([preview.from, preview.into]).toEqual([from, into])

  // 막힘·target·bothConfirmed — 공개 조회로 따로 계산
  const expected = expectedBlock(state, from, into)
  expect({ blocked: preview.blocked, target: preview.target, bothConfirmed: preview.bothConfirmed }, where).toEqual(expected)

  // moving = 적용 전 from의 조회
  const known = getBuyer(state, from)
  expect(preview.moving, `${where}: moving`).toEqual(known === null ? { buyers: [], items: [], subtotal: 0 } : { buyers: [from, ...known.merged], items: [...known.items], subtotal: known.subtotal })

  // 실제 buyer.merge
  const next = applyEvent(state, { seq: 100_000, at: T0 + 100_000_000, type: 'buyer.merge', from, into, reason: '같은 사람' } as EngineEvent).state
  expect(next !== state, `${where}: 막힘(${String(preview.blocked)}) ⇔ 아무 일도 없음`).toBe(preview.blocked === null)
  if (preview.blocked !== null) {
    expect(preview.after).toBeNull()
    expect(preview.duplicates).toEqual([])
    return
  }
  expect(checkInvariants(next), `${where}: 합친 뒤 불변식`).toEqual([])
  const before = new Map(listClaims(state).map((c) => [c.id, c]))
  const nowDuplicate = listClaims(next)
    .filter((c) => c.status === 'DUPLICATE' && before.get(c.id)?.status !== 'DUPLICATE')
    .map((c) => c.id)
    .sort()
  expect(preview.duplicates.map((d) => d.claim).sort(), `${where}: DUPLICATE가 된 찜`).toEqual(nowDuplicate)
  const target = getBuyer(next, preview.target as string)
  expect(target?.current, `${where}: target은 지금의 구매자`).toBe(preview.target)
  expect(preview.after, `${where}: after`).toEqual({ items: [...(target?.items ?? [])], subtotal: target?.subtotal })

  // duplicates 항목: 적용 전 찜의 상품·구매자 자신·상태, 상품 순, 남는 찜은 합친 뒤 살아 있는 같은 상품의 지금의 구매자 찜
  const products = preview.duplicates.map((d) => d.product)
  expect([...products].sort(byPlace), `${where}: 상품 순`).toEqual(products)
  const after = new Map(listClaims(next).map((c) => [c.id, c]))
  for (const d of preview.duplicates) {
    const was = before.get(d.claim) as ClaimInfo
    expect({ product: d.product, buyer: d.buyer, status: d.status }, `${where}: ${d.claim}`).toEqual({ product: was.product, buyer: was.buyer, status: was.status })
    const kept = after.get(d.keep)
    expect(kept !== undefined && ACTIVE.has(kept.status) && kept.product === d.product && kept.currentBuyer === preview.target, `${where}: 남는 찜 ${d.keep}`).toBe(true)
    const keptBefore = before.get(d.keep) as ClaimInfo
    // 앞선 쪽: 남는 찜이 상태 순서(대기는 순번)로 뒤지지 않는다 — 방향과 상관없다
    expect(aheadByStatus(state, keptBefore, was) <= 0, `${where}: ${d.keep}(${keptBefore.status})가 ${d.claim}(${was.status})보다 앞선다`).toBe(true)
  }
}

describe('AC-S06b-03 미리 보기 = 실제 합치기 (무작위 로그, 여러 시점, 모든 쌍)', () => {
  it('막힘 ⇔ 아무 일도 없음 · DUPLICATE = duplicates · after = 합친 뒤 · moving = 적용 전 · 상태를 바꾸지 않음 · 두 번 같음', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 2 }), { minLength: 8, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        fc.array(step, { minLength: 5, maxLength: 45 }),
        fc.constantFrom(...SETTINGS),
        (stocks, ready, steps, settings) => {
          const states = run(stocks, ready, steps, settings)
          // 시점 셋: 중간 둘과 마지막
          const points = [...new Set([Math.floor(states.length / 3), Math.floor((2 * states.length) / 3), states.length - 1])]
          for (const i of points) {
            const state = states[i] as EngineState
            const serialized = JSON.stringify(state)
            const ids = [...listBuyers(state).map((b) => b.id), 'UC_unknown', '__proto__', 'sms:r999']
            for (const from of ids) for (const into of ids) checkPair(state, from, into)
            expect(JSON.stringify(state), '미리 보기가 상태를 바꾸지 않는다').toBe(serialized)
          }
        },
      ),
      { numRuns: 200 },
    )
  }, 60_000)

  it('미리 본 대로 차례로 합쳐 가도 매 단계 같다 (판매 뒤 장부 정리 — 한 사람을 여러 번에 걸쳐 모은다)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 2 }), { minLength: 8, maxLength: 8 }),
        fc.array(step.filter((s) => s.kind !== 'merge' && s.kind !== 'unmerge' && s.kind !== 'block'), { minLength: 10, maxLength: 40 }),
        fc.array(fc.tuple(who, who), { minLength: 1, maxLength: 8 }),
        fc.constantFrom(...SETTINGS),
        (stocks, steps, merges, settings) => {
          const states = run(stocks, [], steps, settings)
          let state = states[states.length - 1] as EngineState
          let seq = 50_000
          for (const [f, t] of merges) {
            const from = pick(state, f)
            const into = pick(state, t)
            checkPair(state, from, into)
            seq += 1
            state = applyEvent(state, { seq, at: T0 + seq * 1000, type: 'buyer.merge', from, into, reason: '같은 사람' } as EngineEvent).state
          }
        },
      ),
      { numRuns: 80 },
    )
  }, 60_000)
})
