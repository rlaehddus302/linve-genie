// AC-S06b-02 골든 러너 mergePreviews (README "추가 검사 키"·"expect 비교 규칙"의 mergePreviews, D-100).
// 가짜 코어로 필드마다 "맞으면 통과, 하나 바꾸면 불일치"·러너 오류(상태 변경·형식)·미구현·결정성·키 풀이를,
// 실제 코어와 실제 골든(19-s06b-merge-preview.yaml)으로 "틀린 코어에서 실제로 실패하는지"를 확인한다.
import { getBuyer, listClaims, previewMerge, type EngineState } from '@livejjim/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { realCore, toSnapshot } from './core-adapter.ts'
import { emptySnapshot } from './fake-core.ts'
import { mergePreviewIssues, snapshotIssues } from './snapshot-check.ts'
import { B1, run, scenario } from './test-helpers.ts'
import type { GoldenCore, GoldenEvent, GoldenSnapshot, MergePreviewView, ScenarioItemResult } from './types.ts'

const EVENTS = [
  { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
  { at: '20:00:01', type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00' },
  { at: '20:00:02', type: 'sms', b: 'b1', ref: 's2', no: 16, received: '20:00' },
]

/** sms:s1·sms:s2는 같은 문자 구매자(sms:s1)이고 UC_A에 합쳐져 있다 */
const SNAP: GoldenSnapshot = emptySnapshot({
  buyerKeys: { UC_A: 'UC_A', UC_B: 'UC_B', 'sms:s1': 'UC_A', 'sms:s2': 'UC_A' },
  buyerSelf: { UC_A: 'UC_A', UC_B: 'UC_B', 'sms:s1': 'sms:s1', 'sms:s2': 'sms:s1' },
})

const OPEN: MergePreviewView = {
  blocked: null,
  bothConfirmed: [],
  moving: { items: ['b1/15', 'b1/16'], subtotal: 15000 },
  after: { items: ['b1/15', 'b1/16', 'b1/17'], subtotal: 20000 },
  duplicates: [
    { product: 'b1/18', buyer: 'sms:s1', status: 'WAITLISTED' },
    { product: 'b1/19', buyer: 'UC_B', status: 'PENDING' },
  ],
}
const BLOCKED: MergePreviewView = { blocked: 'BOTH_CONFIRMED', bothConfirmed: ['b1/15', 'b1/16'], moving: { items: ['b1/15'], subtotal: 10000 }, after: null, duplicates: [] }

/** from이 UC_B면 합칠 수 있고, 그 밖은 막힌다 */
const preview = (_events: readonly GoldenEvent[], from: string): MergePreviewView => (from === 'UC_B' ? OPEN : BLOCKED)

function runPreviews(items: readonly Record<string, unknown>[], fake: Parameters<typeof run>[1] = {}): ScenarioItemResult {
  const report = run(scenario({ events: EVENTS, expect: { mergePreviews: items } }), { fake: { snapshot: SNAP, mergePreview: preview }, ...fake })
  expect(report.readErrors, JSON.stringify(report.readErrors)).toEqual([])
  const item = report.items[0]
  if (item?.kind !== 'scenario') throw new Error('시나리오 결과 없음')
  return item
}

const O = (fields: Record<string, unknown>): Record<string, unknown> => ({ from: 'UC_B', into: 'UC_A', ...fields })
const X = (fields: Record<string, unknown>): Record<string, unknown> => ({ from: 'UC_A', into: 'UC_B', ...fields })

type Case = readonly [name: string, item: Record<string, unknown>, failPaths: readonly string[] | null]

const CASES: readonly Case[] = [
  ['from·into만 적으면 통과', O({}), null],
  ['모든 필드 같음', O({ blocked: null, bothConfirmed: [], moving: OPEN.moving, after: OPEN.after, duplicates: OPEN.duplicates }), null],
  // blocked
  ['blocked 같음 (막힘)', X({ blocked: 'BOTH_CONFIRMED' }), null],
  ['blocked 다른 이유', X({ blocked: 'CYCLE' }), ['mergePreviews[0].blocked']],
  ['blocked null을 기대했는데 막힘', X({ blocked: null }), ['mergePreviews[0].blocked']],
  ['blocked 이유를 기대했는데 합칠 수 있음', O({ blocked: 'SAME_BUYER' }), ['mergePreviews[0].blocked']],
  // bothConfirmed: 집합
  ['bothConfirmed 순서 무관 통과', X({ bothConfirmed: ['b1/16', 'b1/15'] }), null],
  ['bothConfirmed 하나 빠짐', X({ bothConfirmed: ['b1/15'] }), ['mergePreviews[0].bothConfirmed']],
  ['bothConfirmed [] 인데 있음', X({ bothConfirmed: [] }), ['mergePreviews[0].bothConfirmed']],
  // moving
  ['moving 순서 무관 통과', O({ moving: { items: ['b1/16', 'b1/15'], subtotal: 15000 } }), null],
  ['moving 적은 필드만 (subtotal만)', O({ moving: { subtotal: 15000 } }), null],
  ['moving.items 다름', O({ moving: { items: ['b1/15'] } }), ['mergePreviews[0].moving.items']],
  ['moving.subtotal 1원 다름', O({ moving: { subtotal: 15001 } }), ['mergePreviews[0].moving.subtotal']],
  ['moving 둘 다 다름', O({ moving: { items: [], subtotal: 0 } }), ['mergePreviews[0].moving.items', 'mergePreviews[0].moving.subtotal']],
  // after
  ['after null = 막혀서 없음', X({ after: null }), null],
  ['after null을 기대했는데 있음', O({ after: null }), ['mergePreviews[0].after']],
  ['after를 기대했는데 막혀서 없음', X({ after: { items: [], subtotal: 0 } }), ['mergePreviews[0].after']],
  ['after.items 하나 더', O({ after: { items: ['b1/15', 'b1/16', 'b1/17', 'b1/18'] } }), ['mergePreviews[0].after.items']],
  ['after.subtotal 다름', O({ after: { subtotal: 19000 } }), ['mergePreviews[0].after.subtotal']],
  // duplicates: { product, buyer(구매자 자신), status } 집합
  ['duplicates 순서 무관 통과', O({ duplicates: [...OPEN.duplicates].reverse() }), null],
  ['duplicates 구매자 키를 구매자 자신으로 푼다 (sms:s2 → sms:s1)', O({ duplicates: [{ product: 'b1/18', buyer: 'sms:s2', status: 'WAITLISTED' }, OPEN.duplicates[1]] }), null],
  ['duplicates 구매자를 지금의 구매자(UC_A)로 적으면 불일치', O({ duplicates: [{ product: 'b1/18', buyer: 'UC_A', status: 'WAITLISTED' }, OPEN.duplicates[1]] }), ['mergePreviews[0].duplicates']],
  ['duplicates 상태 다름', O({ duplicates: [{ ...OPEN.duplicates[0], status: 'CONFLICT' }, OPEN.duplicates[1]] }), ['mergePreviews[0].duplicates']],
  ['duplicates 상품 다름', O({ duplicates: [{ ...OPEN.duplicates[0], product: 'b1/17' }, OPEN.duplicates[1]] }), ['mergePreviews[0].duplicates']],
  ['duplicates 하나 빠짐 (전체와 정확히 같아야 한다)', O({ duplicates: [OPEN.duplicates[0]] }), ['mergePreviews[0].duplicates']],
  ['duplicates 같은 항목 두 번은 하나와 다르다', O({ duplicates: [OPEN.duplicates[0], OPEN.duplicates[0], OPEN.duplicates[1]] }), ['mergePreviews[0].duplicates']],
  ['duplicates [] = 없음 (막힘)', X({ duplicates: [] }), null],
  ['duplicates [] 인데 있음', O({ duplicates: [] }), ['mergePreviews[0].duplicates']],
]

describe('AC-S06b-02 mergePreviews 비교 — 필드마다 맞으면 통과, 하나 바꾸면 불일치', () => {
  it.each(CASES)('%s', (_name, entry, failPaths) => {
    const item = runPreviews([entry])
    if (failPaths === null) {
      expect(item.problems).toEqual([])
      expect(item.status).toBe('pass')
      return
    }
    expect(item.status).toBe('mismatch')
    expect(item.problems.map((p) => p.path)).toEqual(failPaths)
    for (const problem of item.problems) {
      expect(problem).toHaveProperty('expected')
      expect(problem).toHaveProperty('actual')
    }
  })

  it('항목마다 따로 비교한다 — 둘째 항목만 틀리면 그 경로', () => {
    const item = runPreviews([O({ blocked: null }), X({ blocked: null })])
    expect(item.problems).toEqual([{ path: 'mergePreviews[1].blocked', expected: null, actual: 'BOTH_CONFIRMED' }])
  })

  it('중간 검사의 미리 보기는 그 시점 상태로 부른다 (위치 events[n])', () => {
    const report = run(
      scenario({
        events: [EVENTS[0], EVENTS[1], { type: 'assert', expect: { mergePreviews: [X({ blocked: 'SAME_BUYER' })] } }, EVENTS[2]],
        expect: { mergePreviews: [X({ blocked: 'BOTH_CONFIRMED' })] },
      }),
      { fake: { snapshot: SNAP, mergePreview: (events) => (events.length < 3 ? { ...BLOCKED, blocked: 'SAME_BUYER' } : BLOCKED) } },
    )
    expect(report.items[0]?.status).toBe('pass')
    const wrong = run(
      scenario({ events: [EVENTS[0], { type: 'assert', expect: { mergePreviews: [X({ blocked: 'CYCLE' })] } }], expect: {} }),
      { fake: { snapshot: SNAP, mergePreview: preview } },
    )
    expect(wrong.items[0]?.problems).toEqual([{ where: 'events[1]', path: 'mergePreviews[0].blocked', expected: 'CYCLE', actual: 'BOTH_CONFIRMED' }])
  })

  it('from·into는 구매자 자신으로 풀어 넘긴다 — 풀리지 않는 키(모르는 채널·구매자를 정하지 않은 ref·없는 ref)는 그대로', () => {
    const calls: [string, string][] = []
    runPreviews([{ from: 'sms:s2', into: 'sms:s1' }, { from: 'UC_Z', into: 'UC_A' }, { from: 'sms:s9', into: 'UC_B' }], {
      fake: {
        snapshot: SNAP,
        mergePreview: (_events, from, into) => {
          calls.push([from, into])
          return BLOCKED
        },
      },
    })
    // 처음 실행과 결정성 검사의 두 번째 실행
    expect(calls).toEqual([
      ['sms:s1', 'sms:s1'],
      ['UC_Z', 'UC_A'],
      ['sms:s9', 'UC_B'],
      ['sms:s1', 'sms:s1'],
      ['UC_Z', 'UC_A'],
      ['sms:s9', 'UC_B'],
    ])
  })
})

describe('AC-S06b-02 러너 — 미구현·상태 변경·형식·결정성', () => {
  it('previewMerge가 없는 코어는 mergePreviews를 적은 시나리오에서 미구현 (허용 목록에 있으면 허용)', () => {
    const report = run(scenario({ events: EVENTS, expect: { mergePreviews: [O({})] } }), { fake: { snapshot: SNAP } })
    expect(report.items[0]?.status).toBe('not-implemented')
    expect(report.items[0]?.problems[0]?.message).toContain('합치기 미리 보기')
    const allowed = run(scenario({ events: EVENTS, expect: { mergePreviews: [O({})] } }), { fake: { snapshot: SNAP }, allowlist: 'sprint: S06b\nscenarios: [G-ENG-901]\n' })
    expect(allowed.totals.notImplementedAllowed).toBe(1)
    // 빈 목록은 부를 것이 없다
    expect(run(scenario({ events: EVENTS, expect: { mergePreviews: [] } }), { fake: { snapshot: SNAP } }).items[0]?.status).toBe('pass')
  })

  it('미리 보기가 넘겨받은 상태를 바꾸면 러너 오류 (중간 검사·마지막 expect 모두)', () => {
    const mutate = (events: readonly GoldenEvent[]): MergePreviewView => {
      ;(events as GoldenEvent[]).push({ seq: 0, at: 0, type: '몰래' })
      return OPEN
    }
    const final = run(scenario({ events: EVENTS, expect: { mergePreviews: [O({})] } }), { fake: { snapshot: SNAP, mergePreview: mutate } }).items[0]
    expect(final?.status).toBe('runner-error')
    expect(final?.problems[0]).toMatchObject({ where: 'expect (최종 비교)' })
    expect(final?.problems[0]?.message).toContain('합치기 미리 보기(mergePreviews[0])가 넘겨받은 상태를 제자리에서 바꿨다')
    const middle = run(scenario({ events: [EVENTS[0], { type: 'assert', expect: { mergePreviews: [O({})] } }], expect: {} }), { fake: { snapshot: SNAP, mergePreview: mutate } }).items[0]
    expect(middle?.status).toBe('runner-error')
    expect(middle?.problems[0]).toMatchObject({ where: 'events[1]' })
  })

  it.each([
    ['열거값 밖의 막힘', { ...OPEN, blocked: 'MERGED' }, 'mergePreviews[0].blocked'],
    ['중복 찜 상태 CONFIRMED', { ...OPEN, duplicates: [{ product: 'b1/18', buyer: 'UC_B', status: 'CONFIRMED' }] }, 'mergePreviews[0].duplicates[0].status'],
    ['정수가 아닌 합계', { ...OPEN, moving: { items: [], subtotal: 1.5 } }, 'mergePreviews[0].moving.subtotal'],
    ['상품 키 형식', { ...OPEN, after: { items: ['15번'], subtotal: 0 } }, 'mergePreviews[0].after.items[0]'],
    ['빠진 키', { blocked: null, bothConfirmed: [], moving: OPEN.moving, after: null }, 'mergePreviews[0]'],
    ['모르는 키', { ...OPEN, target: 'UC_A' }, 'mergePreviews[0].target'],
  ])('미리 보기 결과 형식이 틀리면 러너 오류: %s', (_name, view, path) => {
    const item = run(scenario({ events: EVENTS, expect: { mergePreviews: [O({})] } }), { fake: { snapshot: SNAP, mergePreview: view as unknown as MergePreviewView } }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('합치기 미리 보기 결과 형식 오류')
    expect(item?.problems[0]?.message).toContain(path)
  })

  it('미리 보기 결과도 결정성 검사에 들어간다 — 두 번 실행에서 다르면 결정성 위반', () => {
    let calls = 0
    const item = run(scenario({ events: EVENTS, expect: { mergePreviews: [O({ blocked: null })] } }), {
      fake: { snapshot: SNAP, mergePreview: () => ({ ...OPEN, moving: { items: [], subtotal: ++calls } }) },
    }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('expect (최종 비교) mergePreviews')
  })

  it('관찰 스냅샷의 buyerSelf는 문자열 맵이어야 한다 (있어도 되는 키)', () => {
    expect(snapshotIssues(SNAP)).toEqual([])
    expect(snapshotIssues({ ...SNAP, buyerSelf: { 'sms:s1': 1 } })).toEqual(['buyerSelf.sms:s1: 문자열이어야 한다 (값: 1)'])
    expect(mergePreviewIssues(OPEN)).toEqual([])
    expect(mergePreviewIssues(BLOCKED)).toEqual([])
  })
})

// ── 실제 코어 + 실제 골든: 틀린 코어에서 실제로 실패한다 ─────────────────

describe('S06b 골든: 러너는 R-11 미리 보기를 틀리게 내는 코어에서 실제로 실패한다 (AC-S06b-02)', () => {
  const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../../tests/golden/engine/${name}`, import.meta.url)), 'utf8')
  const files = [{ path: 'engine/19.yaml', text: read('19-s06b-merge-preview.yaml') }]
  const failing = (core: GoldenCore): string[] =>
    run(files, { core })
      .items.filter((item) => item.status !== 'pass')
      .map((item) => `${item.kind === 'scenario' ? item.id : ''}${item.status === 'mismatch' ? '' : `:${item.status}`}`)
  /** 실제 previewMerge 결과를 고쳐 내는 코어 */
  const previewCore = (change: (view: MergePreviewView, state: EngineState, from: string, into: string) => MergePreviewView): GoldenCore => ({
    ...realCore,
    engine: { ...realCore.engine, previewMerge: (state, from, into) => change(realCore.engine.previewMerge?.(state, from, into) as MergePreviewView, state as EngineState, from, into) },
  })

  it('실제 코어는 G-ENG-174·175를 통과한다', () => {
    expect(failing(realCore)).toEqual([])
  })

  it('언제나 합칠 수 있다고 하는 코어 → 둘 다 불일치', () => {
    expect(failing(previewCore((view) => ({ ...view, blocked: null })))).toEqual(['G-ENG-174', 'G-ENG-175'])
  })

  it('고리를 막지 않는 코어 → G-ENG-174 불일치', () => {
    expect(failing(previewCore((view) => (view.blocked === 'CYCLE' ? { ...view, blocked: null } : view)))).toEqual(['G-ENG-174'])
  })

  it('합친 뒤 합계에 옮길 쪽을 빼먹는 코어 → G-ENG-174 불일치 (175는 옮길 확정 찜이 없다)', () => {
    expect(
      failing(
        previewCore((view, state, _from, into) => {
          if (view.after === null) return view
          const target = getBuyer(state, getBuyer(state, into)?.current ?? into)
          return { ...view, after: { items: target?.items ?? [], subtotal: target?.subtotal ?? 0 } }
        }),
      ),
    ).toEqual(['G-ENG-174'])
  })

  it('옮길 쪽을 지금의 구매자 전체로 보는 코어 → G-ENG-174 불일치 (이미 합쳐진 X의 옮길 쪽)', () => {
    expect(
      failing(
        previewCore((view, state, from) => {
          const current = getBuyer(state, getBuyer(state, from)?.current ?? from)
          return current === null ? view : { ...view, moving: { items: current.items, subtotal: current.subtotal } }
        }),
      ),
    ).toEqual(['G-ENG-174'])
  })

  it('중복 찜의 구매자를 지금의 구매자로 내는 코어 → G-ENG-174 불일치', () => {
    expect(failing(previewCore((view, state) => ({ ...view, duplicates: view.duplicates.map((d) => ({ ...d, buyer: getBuyer(state, d.buyer)?.current ?? d.buyer })) })))).toEqual(['G-ENG-174'])
  })

  it('방향을 따라 옮길 쪽 찜을 늘 중복으로 보는 코어 → 둘 다 불일치 (방향을 바꾸면 남는 찜이 달라진다)', () => {
    const core = previewCore((view, state, from, into) => {
      const real = previewMerge(state, from, into)
      if (real.blocked !== null) return view
      const claims = new Map(listClaims(state).map((claim) => [claim.id, claim]))
      const fromTree = new Set(real.moving.buyers)
      return {
        ...view,
        duplicates: real.duplicates.map((d) => {
          const dropped = claims.get(fromTree.has(d.buyer) ? d.claim : d.keep)
          return { product: d.product, buyer: dropped?.buyer ?? d.buyer, status: dropped?.status as MergePreviewView['duplicates'][number]['status'] }
        }),
      }
    })
    expect(failing(core)).toEqual(['G-ENG-174', 'G-ENG-175'])
  })

  it('from·into를 지금의 구매자로 풀어 넘기는 러너·어댑터 → 둘 다 불일치 (이미 합쳐짐이 보이지 않는다)', () => {
    const core: GoldenCore = { ...realCore, engine: { ...realCore.engine, observe: (state) => ({ ...toSnapshot(state as EngineState), buyerSelf: toSnapshot(state as EngineState).buyerKeys }) } }
    expect(failing(core)).toEqual(['G-ENG-174', 'G-ENG-175'])
  })

  it('미리 보기가 상태를 바꾸는 코어 → 러너 오류', () => {
    const core: GoldenCore = {
      ...realCore,
      engine: {
        ...realCore.engine,
        previewMerge: (state, from, into) => {
          ;(state as { counters: { claims: number } }).counters.claims += 0.5
          return realCore.engine.previewMerge?.(state, from, into) as MergePreviewView
        },
      },
    }
    expect(failing(core)).toEqual(['G-ENG-174:runner-error', 'G-ENG-175:runner-error'])
  })

  it('previewMerge가 없는 코어 → 둘 다 미구현 (허용 목록이 비어 있으면 실패)', () => {
    const { previewMerge: _drop, ...engine } = realCore.engine
    const report = run(files, { core: { ...realCore, engine } })
    expect(report.items.map((item) => item.status)).toEqual(['not-implemented', 'not-implemented'])
    expect(report.ok).toBe(false)
  })
})

describe('어댑터: 관찰 스냅샷의 buyerSelf = 구매자 키 → 구매자 자신 (이벤트의 키 풀이 buyerIdOf와 같다)', () => {
  it('합쳐진 문자 구매자의 키는 지금의 구매자가 아니라 자신으로 풀린다', () => {
    const report = run(
      scenario({
        broadcasts: [B1],
        events: [
          { at: '20:00:00', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕' },
          { at: '20:00:01', type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00', phone: '010-1111-2222' },
          { at: '20:00:02', type: 'sms', b: 'b1', ref: 's2', no: 16, received: '20:00', phone: '01011112222' },
          { at: '20:00:03', type: 'buyer.merge', from: 'sms:s2', into: 'UC_A', reason: '같은 사람' },
        ],
        expect: {
          sameBuyer: [['sms:s1', 'sms:s2', 'UC_A']],
          mergePreviews: [
            { from: 'sms:s2', into: 'UC_B', blocked: 'UNKNOWN_BUYER' },
            { from: 'sms:s2', into: 'UC_A', blocked: 'FROM_MERGED' },
            { from: 'UC_A', into: 'sms:s2', blocked: 'CYCLE' },
            { from: 'sms:s1', into: 'sms:s2', blocked: 'SAME_BUYER' },
          ],
        },
      }),
      { core: realCore },
    )
    expect(report.items[0]?.problems).toEqual([])
    expect(report.items[0]?.status).toBe('pass')
  })
})
