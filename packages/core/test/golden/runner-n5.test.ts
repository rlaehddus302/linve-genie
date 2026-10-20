// AC-N5-04 골든 러너: 병렬 트랙 시나리오 ID 형식(G-ENG-<스프린트 ID>-<두 자리>)과 새 상품 검사 키 confirmVersion (README "시나리오 키"·"추가 검사 키", D-N5-14).
// 가짜 코어로 "받는 ID·거절하는 ID", "confirmVersion이 맞으면 통과·다르면 불일치·형식이 틀리면 읽기 오류"를,
// 실제 코어와 실제 골든(22-n5-billing.yaml)으로 "확정 횟수를 틀리게 내는 코어에서 실제로 실패하는지"를 확인한다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { realCore } from './core-adapter.ts'
import { createFakeCore, emptySnapshot } from './fake-core.ts'
import { snapshotIssues } from './snapshot-check.ts'
import { docs, run, scenario } from './test-helpers.ts'
import type { GoldenCore, GoldenSnapshot, ProductView, ScenarioItemResult } from './types.ts'

const readErrorLabels = (text: string): string[] => run(text).readErrors.map((error) => error.label ?? '')

describe('시나리오 ID 형식 (AC-N5-04)', () => {
  it.each(['G-ENG-001', 'G-ENG-999', 'G-ENG-N5-01', 'G-ENG-N5-99', 'G-ENG-N2b-01', 'G-ENG-I1-07', 'G-ENG-A-01', 'G-ENG-ABCDEFGH-10', 'G-ENG-S06b-03'])('받는다: %s', (id) => {
    const report = run(scenario({ id }))
    expect(report.readErrors, JSON.stringify(report.readErrors)).toEqual([])
    expect(report.items.map((item) => (item.kind === 'scenario' ? item.id : ''))).toEqual([id])
  })

  it.each([
    'G-ENG-1',
    'G-ENG-01',
    'G-ENG-0001',
    'G-ENG-N5-1',
    'G-ENG-n5-01',
    'G-ENG-N5-001',
    'G-ENG-N5',
    'G-ENG-N5-',
    'G-ENG-5N-01',
    'G-ENG-ABCDEFGHI-01',
    'G-ENG-N_5-01',
    'G-ENG--01',
    'G-ENG-N5-01 ',
    'g-eng-N5-01',
  ])('읽기 오류: %s', (id) => {
    const report = run(scenario({ id }))
    expect(report.readErrors).toHaveLength(1)
    expect(report.readErrors[0]?.issues.map((issue) => issue.message).join(' ')).toContain('시나리오 ID 형식 오류')
    expect(report.items.filter((item) => item.kind === 'scenario')).toEqual([])
  })

  it('새 형식 ID도 중복이면 읽기 오류', () => {
    expect(readErrorLabels(docs(scenario({ id: 'G-ENG-N5-01' }), scenario({ id: 'G-ENG-N5-01' })))).toEqual(['G-ENG-N5-01'])
  })

  it('허용 목록 패턴 G-ENG-*·G-ENG-N5-*는 새 ID에도 맞는다', () => {
    const golden = docs(scenario({ id: 'G-ENG-N5-01' }), scenario({ id: 'G-ENG-001' }))
    for (const pattern of ['G-ENG-*', 'G-ENG-N5-*']) {
      // 기본 가짜 코어는 엔진 미구현 — 목록에 맞는 시나리오만 미구현(허용)이다
      const report = run(golden, { allowlist: `scenarios: ["${pattern}"]\n`, core: createFakeCore() })
      expect(report.readErrors).toEqual([])
      expect(report.warnings).toEqual([])
      const allowed = report.items.filter((item) => item.kind === 'scenario' && item.status === 'not-implemented' && item.allowed).map((item) => (item.kind === 'scenario' ? item.id : ''))
      expect(allowed.sort()).toEqual(pattern === 'G-ENG-*' ? ['G-ENG-001', 'G-ENG-N5-01'] : ['G-ENG-N5-01'])
    }
  })
})

const PRODUCT: ProductView = { status: 'SOLD', winners: ['UC_A'], waitlist: [], conflict: false, price: 10000, priceHistory: [], confirmVersion: 2 }
const SNAP: GoldenSnapshot = emptySnapshot({ buyerKeys: { UC_A: 'UC_A' }, products: { 'b1/15': PRODUCT, 'b1/16': { ...PRODUCT, status: 'OPEN', winners: [], confirmVersion: 0 } } })
const EVENTS = [{ at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 }]

function runProducts(products: Record<string, unknown>, snapshot: GoldenSnapshot = SNAP): ScenarioItemResult | { readError: string } {
  const report = run(scenario({ events: EVENTS, expect: { products } }), { fake: { snapshot } })
  if (report.readErrors.length > 0) return { readError: report.readErrors.flatMap((error) => error.issues.map((issue) => `${issue.path ?? ''}: ${issue.message}`)).join(' / ') }
  const item = report.items[0]
  if (item?.kind !== 'scenario') throw new Error('시나리오 결과 없음')
  return item
}

const mismatchPaths = (item: ScenarioItemResult): string[] => (item.status === 'mismatch' ? item.problems.map((problem) => problem.path ?? '') : [])

describe('상품 검사 키 confirmVersion (AC-N5-04)', () => {
  it('맞으면 통과 (0 포함)', () => {
    const item = runProducts({ 'b1/15': { confirmVersion: 2 }, 'b1/16': { confirmVersion: 0 } })
    expect('readError' in item ? item.readError : item.status).toBe('pass')
  })

  it('다르면 불일치 — 그 경로를 알린다', () => {
    const item = runProducts({ 'b1/15': { confirmVersion: 1 }, 'b1/16': { confirmVersion: 1 } })
    if ('readError' in item) throw new Error(item.readError)
    expect(item.status).toBe('mismatch')
    expect(mismatchPaths(item)).toEqual(['products.b1/15.confirmVersion', 'products.b1/16.confirmVersion'])
  })

  it('관찰에 확정 횟수가 없는데 기대하면 불일치, 상품이 없으면 불일치', () => {
    const { confirmVersion: _drop, ...without } = PRODUCT
    const noCount = runProducts({ 'b1/15': { confirmVersion: 2 } }, emptySnapshot({ products: { 'b1/15': without } }))
    if ('readError' in noCount) throw new Error(noCount.readError)
    expect(mismatchPaths(noCount)).toEqual(['products.b1/15.confirmVersion'])
    const missing = runProducts({ 'b1/17': { confirmVersion: 0 } })
    if ('readError' in missing) throw new Error(missing.readError)
    expect(mismatchPaths(missing)).toEqual(['products.b1/17.confirmVersion'])
  })

  it.each([
    ['음수', -1],
    ['소수', 1.5],
    ['글자', '1'],
    ['null', null],
    ['목록', [1]],
  ])('정수가 아닌 값·음수는 읽기 오류: %s', (_name, value) => {
    const item = runProducts({ 'b1/15': { confirmVersion: value } })
    expect('readError' in item ? item.readError : '').toContain('products.b1/15.confirmVersion')
  })

  it('관찰 형식: confirmVersion은 없어도 되고, 있으면 0 이상 정수', () => {
    const { confirmVersion: _drop, ...without } = PRODUCT
    expect(snapshotIssues(emptySnapshot({ products: { 'b1/15': without } }))).toEqual([])
    expect(snapshotIssues(emptySnapshot({ products: { 'b1/15': PRODUCT } }))).toEqual([])
    expect(snapshotIssues(emptySnapshot({ products: { 'b1/15': { ...PRODUCT, confirmVersion: -1 } } }))).toEqual(['products.b1/15.confirmVersion: 0 이상 정수여야 한다 (값: -1)'])
  })
})

describe('실제 골든 22-n5-billing.yaml (AC-N5-04)', () => {
  const file = fileURLToPath(new URL('../../../../tests/golden/engine/22-n5-billing.yaml', import.meta.url))
  const text = readFileSync(file, 'utf8')
  const ids = (core: GoldenCore, status: string): string[] =>
    run([{ path: 'engine/22-n5-billing.yaml', text }], { core })
      .items.filter((item) => item.kind === 'scenario' && item.status === status)
      .map((item) => (item.kind === 'scenario' ? item.id : ''))

  it('실제 코어로 둘 다 통과', () => {
    expect(ids(realCore, 'pass')).toEqual(['G-ENG-N5-01', 'G-ENG-N5-02'])
  })

  it('확정 횟수를 1등 수로 내는 코어(취소하면 줄어듦)는 둘 다 불일치', () => {
    const wrong: GoldenCore = {
      ...realCore,
      engine: {
        ...realCore.engine,
        observe: (state) => {
          const snapshot = realCore.engine.observe(state)
          const products = Object.fromEntries(Object.entries(snapshot.products).map(([key, product]) => [key, { ...product, confirmVersion: product.winners.length }]))
          return { ...snapshot, products }
        },
      },
    }
    expect(ids(wrong, 'mismatch')).toEqual(['G-ENG-N5-01', 'G-ENG-N5-02'])
  })
})
