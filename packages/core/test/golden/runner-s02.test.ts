// AC-S02-92 골든 러너 보강: 입력 상태 변경 감지(RA-S00-001), 시작 상태 관찰 스냅샷의 결정성(TD-S00-009),
// 관찰 스냅샷 형식·열거값 검사(TD-S00-010). 항목마다 가짜 코어로 "실제로 실패하는지"를 확인한다.
import { describe, expect, it } from 'vitest'
import { createFakeCore, emptySnapshot } from './fake-core.ts'
import { snapshotIssues } from './snapshot-check.ts'
import { run, scenario } from './test-helpers.ts'
import type { GoldenSnapshot } from './types.ts'

const REGISTER = { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 }
const CHAT = { at: '20:00:01', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' }

describe('RA-S00-001: 엔진이 넘겨받은 상태를 제자리에서 바꾸면 러너 오류', () => {
  it('apply가 입력 상태를 고치고 같은 객체를 돌려주면 러너 오류 (위치 events[n])', () => {
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: () => ({ events: [] as unknown[] }),
        apply: (state, event) => {
          ;(state as { events: unknown[] }).events.push(event.seq)
          return { state, effects: [] }
        },
      },
    })
    const item = run(scenario({ events: [REGISTER, CHAT] }), { core }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]).toMatchObject({ where: 'events[0]' })
    expect(item?.problems[0]?.message).toContain('엔진이 넘겨받은 상태를 제자리에서 바꿨다')
  })

  it('새 상태를 돌려주면서 이전 상태의 깊은 곳을 고쳐도 러너 오류', () => {
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: () => ({ inner: { count: 0 } }),
        apply: (state) => {
          const old = state as { inner: { count: number } }
          old.inner.count++
          return { state: { inner: { count: old.inner.count } }, effects: [] }
        },
      },
    })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('제자리에서 바꿨다')
  })

  it('관찰(observe)이 상태를 고쳐도 다음 이벤트 전에 러너 오류', () => {
    const core = createFakeCore({
      engine: {
        start: () => ({ seen: 0 }),
        apply: (state) => ({ state: { ...(state as object) }, effects: [] }),
        observe: (state) => {
          ;(state as { seen: number }).seen++
          return emptySnapshot()
        },
      },
    })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('관찰·불변식 검사 중에 엔진이 상태를 제자리에서 바꿨다')
  })

  it('바뀐 것이 없어 같은 상태 객체를 그대로 돌려주는 것은 정상', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { start: () => ({ a: 1 }), apply: (state) => ({ state, effects: [] }) } })
    expect(run(scenario({ events: [REGISTER, CHAT] }), { core }).items[0]?.status).toBe('pass')
  })
})

describe('TD-S00-009: 결정성 검사의 첫 단계에 시작 상태의 관찰 스냅샷도 넣는다', () => {
  it('상태는 같고 시작 상태의 관찰 스냅샷만 실행마다 다르면 결정성 위반 (위치 시작 상태)', () => {
    let runs = 0
    let observed = 0
    const core = createFakeCore({
      engine: {
        start: () => {
          runs++
          observed = 0
          return { same: true }
        },
        apply: (state) => ({ state, effects: [] }),
        // 시작 상태를 관찰할 때만 실행마다 다른 구매자 키가 섞인다
        observe: () => (observed++ === 0 ? emptySnapshot({ buyerKeys: { [`k${String(runs)}`]: 'x' } }) : emptySnapshot()),
      },
    })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('시작 상태')
  })

  it('이벤트가 없는 시나리오도 시작 상태 관찰로 결정성을 본다', () => {
    let runs = 0
    const core = createFakeCore({
      engine: {
        start: () => {
          runs++
          return {}
        },
        apply: (state) => ({ state, effects: [] }),
        observe: () => emptySnapshot({ claims: runs === 1 ? [] : [{ product: 'b1/15', buyer: 'X', status: 'CONFIRMED' }] }),
      },
    })
    const item = run(scenario(), { core }).items[0]
    expect(item?.status).toBe('determinism')
    expect(item?.problems[0]?.where).toBe('시작 상태')
  })

  it('시작 상태 관찰이 미구현인 코어는 표시만 남기고 관찰이 필요한 지점에서 미구현으로 멈춘다', () => {
    const core = createFakeCore({ snapshot: emptySnapshot(), engine: { observe: createFakeCore().engine.observe } })
    const report = run(scenario({ events: [REGISTER] }), { core, allowlist: 'scenarios: ["G-ENG-901"]\n' })
    expect(report.items[0]).toMatchObject({ status: 'not-implemented', allowed: true, problems: [{ where: 'events[0]' }] })
  })
})

describe('TD-S00-010: 관찰 스냅샷 형식·열거값 검사 — 어기면 러너 오류', () => {
  const effect = { kind: 'VOID_LABEL', status: 'PENDING', product: 'b1/15', buyer: 'UC_A', confirmVersion: 1 } as const

  it('효과 종류 오타는 effectCounts: { VOID_LABEL: 0 }·pendingEffects 부정 검사가 조용히 통과하지 않고 러너 오류', () => {
    const typo = emptySnapshot({ effects: [{ ...effect, kind: 'VOID_LABLE' }] as unknown as GoldenSnapshot['effects'] })
    const golden = scenario({ events: [REGISTER], expect: { effectCounts: { VOID_LABEL: 0 }, pendingEffects: [] } })
    // 같은 기대가 오타 없는 빈 스냅샷에서는 통과한다 (기대 자체는 맞다)
    expect(run(golden, { fake: { snapshot: emptySnapshot() } }).items[0]?.status).toBe('pass')
    const item = run(golden, { fake: { snapshot: typo } }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('effects[0].kind')
  })

  it('효과 상태 오타(PENDNIG)도 러너 오류 — pendingEffects: []가 조용히 통과하지 않는다', () => {
    const typo = emptySnapshot({ effects: [{ ...effect, status: 'PENDNIG' }] as unknown as GoldenSnapshot['effects'] })
    const item = run(scenario({ expect: { pendingEffects: [] } }), { fake: { snapshot: typo } }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('effects[0].status')
  })

  const product = { status: 'SOLD', winners: ['UC_A'], waitlist: [], conflict: false, price: 10000, priceHistory: [] }
  const buyer = { display: '홍길동', nameHistory: ['홍길동'], items: ['b1/15'], subtotal: 10000, byBroadcast: { b1: 10000 }, phoneLast4: null }
  const settlement = { subtotal: 10000, shipping: 4000, adjustments: -1000, total: 13000, refundDue: 0, payment: 'UNPAID' }
  const valid = emptySnapshot({
    buyerKeys: { UC_A: 'UC_A' },
    products: { 'b1/15': product } as GoldenSnapshot['products'],
    buyers: { UC_A: buyer },
    settlements: { 'UC_A@2026-10-18': settlement } as GoldenSnapshot['settlements'],
    effects: [effect, { kind: 'POST_THANKS', status: 'DONE', target: 'LIVE_CHAT', product: 'b1/15', buyer: 'UC_A', text: '감사', confirmVersion: 1 }],
    claims: [{ product: 'b1/16', buyer: 'UC_A', status: 'REJECTED', reason: 'SOLD_OUT' }],
    pending: { 'b1/17': ['UC_B'] },
    cancelRequests: [{ product: 'b1/15', buyer: 'UC_A' }],
  })

  it('형식이 맞는 스냅샷은 문제가 없다 (조정만 음수 가능)', () => {
    expect(snapshotIssues(valid)).toEqual([])
    expect(run(scenario({ events: [REGISTER] }), { fake: { snapshot: valid } }).items[0]?.status).toBe('pass')
  })

  const broken: readonly (readonly [string, (s: Record<string, unknown>) => void, string])[] = [
    ['최상위 모르는 키', (s) => Object.assign(s, { extra: 1 }), '스냅샷.extra: 모르는 키'],
    ['상품 상태 열거값', (s) => ((s.products as Record<string, Record<string, unknown>>)['b1/15'] = { ...product, status: 'SOLDOUT' }), 'products.b1/15.status'],
    ['상품 키 형식', (s) => ((s.products as Record<string, unknown>)['b1-15'] = product), "상품 키 형식 오류 'b1-15'"],
    ['상품 필드 빠짐', (s) => ((s.products as Record<string, unknown>)['b1/15'] = { status: 'SOLD' }), "'winners'가 없다"],
    ['확정 구매자 목록에 문자열 아닌 값', (s) => ((s.products as Record<string, unknown>)['b1/15'] = { ...product, winners: [1] }), 'products.b1/15.winners[0]'],
    ['상품 가격 음수', (s) => ((s.products as Record<string, unknown>)['b1/15'] = { ...product, price: -1 }), 'products.b1/15.price'],
    ['가격 이력 형식', (s) => ((s.products as Record<string, unknown>)['b1/15'] = { ...product, priceHistory: [{ from: 1 }] }), "'to'가 없다"],
    ['충돌 표시가 불리언이 아님', (s) => ((s.products as Record<string, unknown>)['b1/15'] = { ...product, conflict: 'no' }), 'products.b1/15.conflict'],
    ['구매자 합계 실수', (s) => ((s.buyers as Record<string, unknown>).UC_A = { ...buyer, subtotal: 1.5 }), 'buyers.UC_A.subtotal'],
    ['구매자 품목 상품 키 형식', (s) => ((s.buyers as Record<string, unknown>).UC_A = { ...buyer, items: ['15'] }), "상품 키 형식 오류 '15'"],
    ['방송별 합계 음수', (s) => ((s.buyers as Record<string, unknown>).UC_A = { ...buyer, byBroadcast: { b1: -1 } }), 'buyers.UC_A.byBroadcast.b1'],
    ['뒤 4자리 빠짐 (S03b)', (s) => ((s.buyers as Record<string, unknown>).UC_A = { ...buyer, phoneLast4: undefined }), "'phoneLast4'가 없다"],
    ['뒤 4자리가 정수', (s) => ((s.buyers as Record<string, unknown>).UC_A = { ...buyer, phoneLast4: 5678 }), 'buyers.UC_A.phoneLast4'],
    ['뒤 4자리가 전화번호 전체', (s) => ((s.buyers as Record<string, unknown>).UC_A = { ...buyer, phoneLast4: '01012345678' }), 'buyers.UC_A.phoneLast4'],
    ['정산 키 형식', (s) => ((s.settlements as Record<string, unknown>).UC_A = settlement), "정산 키 형식 오류 'UC_A'"],
    ['정산 입금 상태 열거값', (s) => ((s.settlements as Record<string, unknown>)['UC_A@2026-10-18'] = { ...settlement, payment: 'DONE' }), 'payment'],
    ['정산 최종 금액 음수', (s) => ((s.settlements as Record<string, unknown>)['UC_A@2026-10-18'] = { ...settlement, total: -1 }), '.total'],
    ['정산 조정이 정수가 아님', (s) => ((s.settlements as Record<string, unknown>)['UC_A@2026-10-18'] = { ...settlement, adjustments: 0.5 }), '.adjustments'],
    ['효과 대상 열거값', (s) => (s.effects = [{ ...effect, target: 'CHAT' }]), 'effects[0].target'],
    ['효과 확정버전 0', (s) => (s.effects = [{ ...effect, confirmVersion: 0 }]), 'effects[0].confirmVersion'],
    ['효과 모르는 키', (s) => (s.effects = [{ ...effect, confirmVerison: 1 }]), 'effects[0].confirmVerison: 모르는 키'],
    ['효과 상태 빠짐', (s) => (s.effects = [{ kind: 'NOTIFY' }]), "'status'가 없다"],
    ['찜 상태 열거값', (s) => (s.claims = [{ product: 'b1/15', buyer: 'UC_A', status: 'WON' }]), 'claims[0].status'],
    ['찜 사유 열거값', (s) => (s.claims = [{ product: 'b1/15', buyer: 'UC_A', status: 'REJECTED', reason: 'SOLDOUT' }]), 'claims[0].reason'],
    ['찜 상품 키 형식', (s) => (s.claims = [{ product: 15, buyer: 'UC_A', status: 'CONFIRMED' }]), 'claims[0].product'],
    ['보류 목록이 문자열 배열이 아님', (s) => (s.pending = { 'b1/17': 'UC_B' }), 'pending.b1/17'],
    ['취소 요청 형식', (s) => (s.cancelRequests = [{ product: 'b1/15' }]), "'buyer'가 없다"],
    ['구매자 키 값이 문자열이 아님', (s) => (s.buyerKeys = { UC_A: 1 }), 'buyerKeys.UC_A'],
    ['목록 자리에 맵', (s) => (s.effects = {}), 'effects: 목록이어야 한다'],
  ]

  it.each(broken)('%s → 러너 오류', (_name, mutate, message) => {
    const snapshot = structuredClone(valid) as unknown as Record<string, unknown>
    mutate(snapshot)
    expect(snapshotIssues(snapshot).join('\n')).toContain(message)
    const item = run(scenario({ events: [REGISTER] }), { fake: { snapshot: snapshot as unknown as GoldenSnapshot } }).items[0]
    expect(item?.status).toBe('runner-error')
    expect(item?.problems[0]?.message).toContain('관찰 스냅샷 형식 오류')
  })

  it('스냅샷이 맵이 아니면 러너 오류', () => {
    expect(snapshotIssues(null)).toEqual(['스냅샷: 맵이어야 한다 (값: null)'])
    const item = run(scenario(), { fake: { snapshot: [] as unknown as GoldenSnapshot } }).items[0]
    expect(item?.status).toBe('runner-error')
  })

  it('이벤트 뒤 스냅샷의 형식 오류도 그 events[n] 위치로 알린다', () => {
    const core = createFakeCore({
      snapshot: (events) => (events.length === 0 ? emptySnapshot() : ({ ...emptySnapshot(), claims: [{ product: 'b1/15' }] } as unknown as GoldenSnapshot)),
    })
    const item = run(scenario({ events: [REGISTER] }), { core }).items[0]
    expect(item).toMatchObject({ status: 'runner-error', problems: [{ where: 'events[0]' }] })
  })
})
