// AC-S06b-01 합치기 미리 보기 previewMerge (BUY-03, R-11 "미리 보기", D-100).
// 막히는 다섯 경우와 그 순서, 재고 2, 합쳐진 구매자 아래 따라감, 합쳐진 구매자에게 합치기, 보류끼리 실제 시각순,
// 상태를 바꾸지 않음·결정성, 그리고 "미리 보기 = 실제 buyer.merge"를 작은 무작위 로그로 확인한다(전체 속성 시험은 tests/adversarial/s06b).
import {
  applyEvent,
  getBuyer,
  initEngine,
  listBuyers,
  listClaims,
  previewMerge,
  type EngineEvent,
  type EngineState,
  type MergePreview,
  type SettingsOverride,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { B1, RECEIVED_TIME, T0, chat, host, kst, play, register, sms, type EventInput } from './engine-helpers.ts'

const merge = (from: string, into: string): EventInput => ({ type: 'buyer.merge', from, into, reason: '같은 사람' })
const unmerge = (from: string): EventInput => ({ type: 'buyer.unmerge', from, reason: '잘못 합침' })

/** 상태를 깊게 얼린다 — 미리 보기가 상태를 제자리에서 바꾸면 예외가 난다 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

/** buyer.merge를 실제로 적용한 결과 (막혔는지, DUPLICATE가 된 찜, 합친 뒤 target의 확정 찜) */
function actualMerge(state: EngineState, from: string, into: string, seq = 999): { changed: boolean; duplicates: string[]; target: ReturnType<typeof getBuyer> } {
  const next = applyEvent(state, { seq, at: T0 + seq * 1000, type: 'buyer.merge', from, into, reason: '같은 사람' } as EngineEvent).state
  const before = new Map(listClaims(state).map((claim) => [claim.id, claim.status]))
  const duplicates = listClaims(next)
    .filter((claim) => claim.status === 'DUPLICATE' && before.get(claim.id) !== 'DUPLICATE')
    .map((claim) => claim.id)
  const target = getBuyer(next, getBuyer(next, into)?.current ?? into)
  return { changed: next !== state, duplicates, target }
}

/** 미리 보기와 실제 합치기가 같은지 (AC-S06b-01 "applyEvent의 결과와 같다") */
function expectSameAsMerge(state: EngineState, preview: MergePreview): void {
  const actual = actualMerge(state, preview.from, preview.into)
  expect(actual.changed, `${preview.from} → ${preview.into}: ${String(preview.blocked)}`).toBe(preview.blocked === null)
  if (preview.blocked !== null) return
  expect(actual.duplicates.sort()).toEqual(preview.duplicates.map((d) => d.claim).sort())
  expect(preview.after).toEqual({ items: actual.target?.items, subtotal: actual.target?.subtotal })
  expect(actual.target?.id).toBe(preview.target)
}

describe('AC-S06b-01 막히는 다섯 경우 — 위에서부터 처음 맞는 것', () => {
  // A·B 1번 재고 2에 둘 다 1등, C·D 기록만 있고 C를 D에 합침
  const { state } = play([register(1, { stock: 2 }), chat('A', '1'), chat('B', '1'), chat('C', '안녕'), chat('D', '안녕'), merge('C', 'D')])

  it.each([
    ['모르는 from', 'Z', 'A', 'UNKNOWN_BUYER', 'A'],
    ['모르는 into', 'A', 'Z', 'UNKNOWN_BUYER', null],
    ['둘 다 모름이 같은 ID여도 모르는 구매자가 먼저', 'Z', 'Z', 'UNKNOWN_BUYER', null],
    ['같은 구매자', 'A', 'A', 'SAME_BUYER', 'A'],
    ['합쳐진 구매자를 자기 자신에게 — 같은 구매자가 이미 합쳐짐보다 먼저', 'C', 'C', 'SAME_BUYER', 'D'],
    ['from이 이미 합쳐져 있음', 'C', 'A', 'FROM_MERGED', 'A'],
    ['이미 합쳐진 from이 고리이기도 하면 이미 합쳐짐이 먼저', 'C', 'D', 'FROM_MERGED', 'D'],
    ['고리 — into의 지금의 구매자가 from', 'D', 'C', 'CYCLE', 'D'],
    ['두 사람 모두 1등 (재고 2)', 'A', 'B', 'BOTH_CONFIRMED', 'B'],
  ] as const)('%s: %s → %s = %s', (_name, from, into, blocked, target) => {
    const preview = previewMerge(state, from, into)
    expect(preview).toMatchObject({ from, into, blocked, target, after: null, duplicates: [] })
    expect(preview.bothConfirmed).toEqual(blocked === 'BOTH_CONFIRMED' ? ['b1/1'] : [])
    expectSameAsMerge(state, preview)
  })

  it('모르는 from은 옮길 것이 없다. 아는 from은 막혀도 옮길 쪽을 보인다', () => {
    expect(previewMerge(state, 'Z', 'A').moving).toEqual({ buyers: [], items: [], subtotal: 0 })
    expect(previewMerge(state, 'A', 'B').moving).toEqual({ buyers: ['A'], items: ['b1/1'], subtotal: 10000 })
    // 이미 합쳐진 C: C 자신(아래 없음) — 지금의 구매자 D가 아니다
    expect(previewMerge(state, 'C', 'A').moving).toEqual({ buyers: ['C'], items: [], subtotal: 0 })
    expect(previewMerge(state, 'D', 'A').moving).toEqual({ buyers: ['D', 'C'], items: [], subtotal: 0 })
  })
})

describe('AC-S06b-01 확정 찜이 둘이 되는 상품 목록은 방송 선언 순서·번호 순', () => {
  it('선언 순서가 사전 순과 다른 방송·자릿수가 다른 번호', () => {
    const broadcasts = [
      { id: 'bz', date: '2026-10-18', title: '1부' },
      { id: 'ba', date: '2026-10-18', title: '2부' },
    ]
    const events: EventInput[] = [
      register(10, { b: 'ba', stock: 2 }),
      register(9, { b: 'ba', stock: 2 }),
      register(10, { b: 'bz', stock: 2 }),
      register(9, { b: 'bz', stock: 2 }),
      chat('A', '10 9', { b: 'ba' }),
      chat('A', '10 9', { b: 'bz' }),
      chat('B', '10 9', { b: 'ba' }),
      chat('B', '10 9', { b: 'bz' }),
    ]
    const { state } = play(events, {}, broadcasts)
    const preview = previewMerge(state, 'B', 'A')
    expect(preview.blocked).toBe('BOTH_CONFIRMED')
    expect(preview.bothConfirmed).toEqual(['bz/9', 'bz/10', 'ba/9', 'ba/10'])
    expect(preview.moving.items).toEqual(getBuyer(state, 'B')?.items)
  })

  it('한 상품만 겹쳐도 막히고, 겹치지 않는 확정은 목록에 없다', () => {
    const { state } = play([register(1, { stock: 2 }), register(2), register(3), chat('A', '1 2'), chat('B', '1 3')])
    const preview = previewMerge(state, 'A', 'B')
    expect(preview).toMatchObject({ blocked: 'BOTH_CONFIRMED', bothConfirmed: ['b1/1'], moving: { items: ['b1/1', 'b1/2'], subtotal: 20000 } })
    expectSameAsMerge(state, preview)
  })
})

describe('AC-S06b-01 막히지 않을 때 — 옮길 찜·합친 뒤·중복', () => {
  it('중복은 확정 > 충돌 > 대기(앞 순번) > 보류(판정 순위), 방향과 상관없이 같은 찜이 남는다', () => {
    const { state } = play([
      register(1),
      register(2),
      register(3, { status: 'READY' }),
      chat('Z', '1 2'),
      chat('A', '1'),
      chat('B', '1 2 3'),
      chat('A', '2 3'),
    ])
    // 1번: A 대기 1(c3)·B 대기 2(c4), 2번: B 대기 1(c5)·A 대기 2(c7), 3번: B 보류(c6)·A 보류(c8)
    const forward = previewMerge(state, 'B', 'A')
    const backward = previewMerge(state, 'A', 'B')
    expect(forward.duplicates).toEqual([
      { claim: 'c4', product: 'b1/1', buyer: 'B', status: 'WAITLISTED', keep: 'c3' },
      { claim: 'c7', product: 'b1/2', buyer: 'A', status: 'WAITLISTED', keep: 'c5' },
      { claim: 'c8', product: 'b1/3', buyer: 'A', status: 'PENDING', keep: 'c6' },
    ])
    expect(backward.duplicates).toEqual(forward.duplicates)
    expect(forward).toMatchObject({ blocked: null, target: 'A', bothConfirmed: [], moving: { buyers: ['B'], items: [], subtotal: 0 }, after: { items: [], subtotal: 0 } })
    expect(backward.target).toBe('B')
    expectSameAsMerge(state, forward)
    expectSameAsMerge(state, backward)
  })

  it('확정 찜은 남고 상대의 대기·충돌·보류 찜이 중복 — 합친 뒤 합계는 둘의 합', () => {
    const { state } = play([register(1), register(2, { price: 5000 }), chat('A', '1'), chat('B', '1 2')])
    const preview = previewMerge(state, 'B', 'A')
    expect(preview).toMatchObject({
      blocked: null,
      moving: { buyers: ['B'], items: ['b1/2'], subtotal: 5000 },
      after: { items: ['b1/1', 'b1/2'], subtotal: 15000 },
      duplicates: [{ product: 'b1/1', buyer: 'B', status: 'WAITLISTED', keep: 'c1' }],
    })
    expectSameAsMerge(state, preview)
  })

  it('보류끼리는 실제 시각순 판정 순위 (seq는 B가 앞서도 문자 시각이 이른 X가 남는다)', () => {
    const { state } = play(
      [chat('B', '20', { at: kst(20, 0, 56), publishedAt: kst(20, 0, 56) }), sms('s1', 20, '20:00:40', { memo: '김씨', at: kst(20, 0, 58) })],
      RECEIVED_TIME,
    )
    const preview = previewMerge(state, 'B', 'sms:s1')
    expect(preview.duplicates).toEqual([{ claim: 'c1', product: 'b1/20', buyer: 'B', status: 'PENDING', keep: 'c2' }])
    expect(previewMerge(state, 'sms:s1', 'B').duplicates).toEqual([{ claim: 'c1', product: 'b1/20', buyer: 'B', status: 'PENDING', keep: 'c2' }])
    expectSameAsMerge(state, preview)
  })

  it('합쳐 있던 구매자 아래 전부가 따라간다 (옮길 쪽 = from과 그 아래, 그 아래의 찜도 중복 정리)', () => {
    const { state } = play([register(1), register(2), register(3), chat('Z', '1'), chat('C', '1 3'), chat('B', '2'), merge('C', 'B'), chat('A', '1')])
    // B 아래 C: C 1번 대기 1(c2) · A 1번 대기 2(c5)
    const preview = previewMerge(state, 'B', 'A')
    expect(preview.moving).toEqual({ buyers: ['B', 'C'], items: ['b1/3', 'b1/2'], subtotal: 20000 })
    expect(preview.duplicates).toEqual([{ claim: 'c5', product: 'b1/1', buyer: 'A', status: 'WAITLISTED', keep: 'c2' }])
    expect(preview.after).toEqual({ items: ['b1/3', 'b1/2'], subtotal: 20000 })
    expectSameAsMerge(state, preview)
  })

  it('합쳐진 구매자에게 합치면 그 지금의 구매자로 간다', () => {
    const { state } = play([register(1), register(2), chat('A', '1'), chat('K', '안녕'), merge('K', 'A'), chat('Y', '2')])
    const preview = previewMerge(state, 'Y', 'K')
    expect(preview).toMatchObject({ blocked: null, target: 'A', after: { items: ['b1/1', 'b1/2'], subtotal: 20000 } })
    expectSameAsMerge(state, preview)
  })

  it('찜 없는 구매자끼리 — 옮길 것·중복 없음, 합친 뒤는 남는 쪽 그대로', () => {
    const { state } = play([chat('A', '안녕'), chat('B', '안녕')])
    expect(previewMerge(state, 'A', 'B')).toEqual({
      from: 'A',
      into: 'B',
      blocked: null,
      target: 'B',
      bothConfirmed: [],
      moving: { buyers: ['A'], items: [], subtotal: 0 },
      after: { items: [], subtotal: 0 },
      duplicates: [],
    })
  })

  it('떼어 낸 뒤에는 다시 합칠 수 있다 (떼어 낸 구매자는 이미 합쳐짐이 아니다)', () => {
    const { state } = play([register(1), chat('A', '1'), chat('B', '안녕'), merge('B', 'A'), unmerge('B')])
    expect(previewMerge(state, 'B', 'A')).toMatchObject({ blocked: null, target: 'A', after: { items: ['b1/1'], subtotal: 10000 } })
  })
})

describe('AC-S06b-01 순수 조회 — 상태를 바꾸지 않고, 같은 입력이면 같은 값', () => {
  it('얼린 상태에서도 돌고, 부르기 전후 직렬화가 같고, 두 번 부르면 같다', () => {
    const { state } = play([register(1), register(2), chat('A', '1'), chat('B', '1 2'), sms('s1', 2, '20:00', { phone: '010-1111-2222' })])
    const before = JSON.stringify(state)
    deepFreeze(state)
    const pairs = listBuyers(state).flatMap((a) => listBuyers(state).map((b) => [a.id, b.id] as const))
    for (const [from, into] of pairs) {
      const first = previewMerge(state, from, into)
      expect(previewMerge(state, from, into)).toEqual(first)
    }
    expect(JSON.stringify(state)).toBe(before)
  })

  it('합치기 계획을 판정과 함께 쓴다 — 리듀서와 조회 함수가 같은 R-11 함수를 부른다 (규칙을 두 번 구현하지 않는다)', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = (name: string) => readFile(new URL(`../../src/engine/${name}`, import.meta.url), 'utf8')
    const [reducer, views] = await Promise.all([source('reducer.ts'), source('views.ts')])
    for (const text of [reducer, views]) {
      expect(text).toContain("from './merge.ts'")
      expect(text).toMatch(/planMerge\(/)
      expect(text).not.toMatch(/STATUS_ORDER|CONFLICT: 1/)
    }
  })
})

// ── 미리 보기 = 실제 합치기 (작은 무작위 로그) ─────────────────────────────

const CHANNELS = ['A', 'B', 'C', 'D'] as const
const PHONES = ['010-1111-2222', '010-3333-2222', undefined] as const

type Step =
  | { readonly kind: 'register'; readonly no: number; readonly stock: number; readonly ready: boolean }
  | { readonly kind: 'open'; readonly no: number }
  | { readonly kind: 'chat'; readonly ch: number; readonly nos: readonly number[] }
  | { readonly kind: 'sms'; readonly no: number; readonly phone: number; readonly second: number }
  | { readonly kind: 'cancel'; readonly no: number; readonly ch: number }
  | { readonly kind: 'merge'; readonly from: number; readonly into: number }
  | { readonly kind: 'unmerge'; readonly from: number }

const no = fc.integer({ min: 1, max: 4 })
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('register' as const), no: fc.integer({ min: 3, max: 4 }), stock: fc.integer({ min: 1, max: 2 }), ready: fc.boolean() }),
  fc.record({ kind: fc.constant('open' as const), no }),
  fc.record({ kind: fc.constant('chat' as const), ch: fc.integer({ min: 0, max: 3 }), nos: fc.array(no, { minLength: 1, maxLength: 2 }) }),
  fc.record({ kind: fc.constant('sms' as const), no, phone: fc.integer({ min: 0, max: 2 }), second: fc.integer({ min: 0, max: 59 }) }),
  fc.record({ kind: fc.constant('cancel' as const), no, ch: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ kind: fc.constant('merge' as const), from: fc.integer({ min: 0, max: 7 }), into: fc.integer({ min: 0, max: 7 }) }),
  fc.record({ kind: fc.constant('unmerge' as const), from: fc.integer({ min: 0, max: 7 }) }),
)

/** 알려진 구매자 ID 목록에서 고른다 (구매자 수 + 1로 나눈 나머지 — 마지막 자리는 모르는 구매자) */
const pick = (state: EngineState, index: number): string => {
  const buyers = listBuyers(state)
  return buyers[index % (buyers.length + 1)]?.id ?? 'UC_unknown'
}

function run(stocks: readonly number[], rest: readonly Step[], settings: SettingsOverride): EngineState {
  let state = initEngine({ broadcasts: [B1], settings })
  let refs = 0
  // 상품 1·2를 먼저 등록한다 (재고 1·2). 3·4번은 로그 중간에 등록·공개되어 쌓인 보류 찜을 판정한다
  const steps: Step[] = [...stocks.map((stock, i): Step => ({ kind: 'register', no: i + 1, stock, ready: false })), ...rest]
  steps.forEach((s, i) => {
    const at = T0 + i * 1000
    let event: EventInput
    switch (s.kind) {
      case 'register':
        event = register(s.no, { stock: s.stock, status: s.ready ? 'READY' : 'OPEN' })
        break
      case 'open':
        event = { type: 'product.open', b: 'b1', no: s.no }
        break
      case 'chat':
        event = chat(CHANNELS[s.ch] as string, s.nos.join(' '))
        break
      case 'sms':
        event = sms(`r${String(++refs)}`, s.no, `20:00:${String(s.second).padStart(2, '0')}`, { ...(PHONES[s.phone] === undefined ? {} : { phone: PHONES[s.phone] }) })
        break
      case 'cancel':
        event = host('host.cancel', s.no, pick(state, s.ch))
        break
      case 'merge':
        event = merge(pick(state, s.from), pick(state, s.into))
        break
      case 'unmerge':
        event = unmerge(pick(state, s.from))
        break
    }
    state = applyEvent(state, { at, ...event, seq: i + 1 } as EngineEvent).state
  })
  return state
}

describe('AC-S06b-01 막힘 ⇔ 아무 일도 없음, 막히지 않으면 DUPLICATE·합친 뒤가 실제와 같다 (무작위 로그)', () => {
  it('모든 구매자 쌍과 모르는 구매자', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 2 }), { minLength: 2, maxLength: 2 }), fc.array(step, { minLength: 1, maxLength: 40 }), fc.constantFrom<SettingsOverride>({}, RECEIVED_TIME, { ...RECEIVED_TIME, 'contention.sameMinuteTieBreaker': 'HOST' }), (stocks, steps, settings) => {
        const state = run(stocks, steps, settings)
        const before = JSON.stringify(state)
        const ids = [...listBuyers(state).map((buyer) => buyer.id), 'UC_unknown']
        for (const from of ids) {
          for (const into of ids) {
            const preview = previewMerge(state, from, into)
            expectSameAsMerge(state, preview)
            const known = getBuyer(state, from)
            expect(preview.moving).toEqual(known === null ? { buyers: [], items: [], subtotal: 0 } : { buyers: [from, ...known.merged], items: known.items, subtotal: known.subtotal })
          }
        }
        expect(JSON.stringify(state)).toBe(before)
      }),
      { numRuns: 150 },
    )
  })
})
