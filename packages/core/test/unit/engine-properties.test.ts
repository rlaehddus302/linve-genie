// AC-S02-93 불변식 속성 테스트 (INV-1~12)와 AC-S02-03 "맞지 않는 명령은 관찰 값을 바꾸지 않는다" 속성.
// fast-check가 S02 범위의 무작위 이벤트 로그를 만들고, 실패하면 가장 짧은 로그로 줄여 시드와 함께 보여 준다.
// 재현: 실패 메시지의 seed·path를 fc.assert 옵션에 넣는다. 아래 "회귀" 블록은 시드를 고정해 항상 같은 로그로 돈다.
import {
  applyEvent,
  checkInvariants,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  type BroadcastInfo,
  type ClaimInfo,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { B1, B2, T0, type EventInput } from './engine-helpers.ts'

// ── 로그 생성 ────────────────────────────────────────────────────────────

const B0919: BroadcastInfo = { id: 'n1', date: '2026-10-19', title: '19일' }
const BUYERS = ['A', 'B', 'C', 'D', 'E'] as const
const NOS = [1, 2, 3] as const

/** 효과 보고는 그 시점 상태의 효과 중 하나를 고른다(취소·완료된 것 포함 → 늦은 보고·중복 보고) */
type ReportStep = { readonly type: 'report'; readonly kind: 'label' | 'thanks'; readonly pick: number; readonly video: boolean }
/** 그 시점의 활성 찜 하나를 골라 조치한다 (무작위 대상만으로는 1등·대기자에 거의 닿지 않는다) */
type PickedAction = 'host.cancel' | 'host.reject' | 'host.promote' | 'host.confirm' | 'host.approveCancel' | 'host.dismissCancel' | 'host.blockBuyer' | 'cancelChat' | 'assignTo' | 'replace'
type PickStep = { readonly type: 'pick'; readonly action: PickedAction; readonly pick: number; readonly other: number; readonly to: 'WAITLIST' | 'CANCEL' }
type Step = EventInput | ReportStep | PickStep
interface Entry {
  readonly step: Step
  /** 앞 이벤트와의 간격(ms) */
  readonly dt: number
}
interface Scenario {
  readonly broadcasts: readonly BroadcastInfo[]
  readonly settings: SettingsOverride
  readonly entries: readonly Entry[]
}

const settingsArb: fc.Arbitrary<SettingsOverride> = fc.record({
  'waitlist.max': fc.integer({ min: 0, max: 3 }),
  'cancel.succession': fc.constantFrom('AUTO', 'ASK', 'REOPEN'),
  'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
  'claim.preOpenWindowSec': fc.integer({ min: 0, max: 60 }),
  'claim.ignoreOwner': fc.boolean(),
  'print.autoOnConfirm': fc.boolean(),
  'thanks.liveChat': fc.boolean(),
  'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE', 'SUMMARY'),
})

function stepArb(bIds: readonly string[]): fc.Arbitrary<Step> {
  const b = fc.constantFrom(...bIds)
  const no = fc.constantFrom(...NOS)
  const buyer = fc.constantFrom(...BUYERS)
  const text = fc.oneof(
    { weight: 5, arbitrary: no.map(String) },
    { weight: 2, arbitrary: fc.tuple(no, no).map(([x, y]) => `${String(x)} ${String(y)}`) },
    { weight: 3, arbitrary: no.map((x) => `${String(x)} 취소`) },
    { weight: 1, arbitrary: no.map((x) => `${String(x)}번 예뻐요`) },
    { weight: 1, arbitrary: fc.constant('안녕하세요') },
  )
  const host = (type: 'host.cancel' | 'host.reject' | 'host.promote') => fc.record({ type: fc.constant(type), b, no, buyer, reason: fc.constant('사유') })
  const hostOptional = (type: 'host.confirm' | 'host.approveCancel' | 'host.dismissCancel') => fc.record({ type: fc.constant(type), b, no, buyer })
  return fc.oneof(
    {
      weight: 1,
      arbitrary: fc.record(
        { type: fc.constant('product.register' as const), b, no, name: fc.constantFrom('', '핑크프릴', ' 라울 '), price: fc.integer({ min: 0, max: 30000 }), stock: fc.integer({ min: 1, max: 3 }), status: fc.constantFrom('OPEN' as const, 'READY' as const) },
        { requiredKeys: ['type', 'b', 'no', 'name', 'price'] },
      ),
    },
    { weight: 2, arbitrary: fc.record({ type: fc.constantFrom('product.open' as const, 'product.hold' as const, 'product.close' as const), b, no }) },
    {
      weight: 12,
      arbitrary: fc.record(
        { type: fc.constant('chat' as const), b, id: fc.integer({ min: 1, max: 40 }).map((n) => `m${String(n)}`), ch: fc.constantFrom(...BUYERS, 'OWNER'), nick: fc.constantFrom('가', '나', '다'), text, owner: fc.boolean() },
        { requiredKeys: ['type', 'b', 'id', 'ch', 'nick', 'text'] },
      ),
    },
    { weight: 3, arbitrary: host('host.cancel') },
    { weight: 1, arbitrary: host('host.reject') },
    { weight: 2, arbitrary: host('host.promote') },
    { weight: 1, arbitrary: hostOptional('host.confirm') },
    { weight: 1, arbitrary: hostOptional('host.approveCancel') },
    { weight: 1, arbitrary: hostOptional('host.dismissCancel') },
    { weight: 2, arbitrary: fc.record({ type: fc.constant('host.reopen' as const), b, no, reason: fc.constant('사유') }) },
    {
      weight: 2,
      arbitrary: fc.oneof(
        fc.record({ type: fc.constant('host.assign' as const), b, no, buyer, reason: fc.constant('사유') }),
        fc.record({ type: fc.constant('host.assign' as const), b, no, buyer, reason: fc.constant('사유'), replace: buyer, replaceTo: fc.constantFrom('WAITLIST' as const, 'CANCEL' as const) }),
      ),
    },
    { weight: 1, arbitrary: fc.record({ type: fc.constantFrom('host.blockBuyer' as const, 'host.unblockBuyer' as const), buyer, reason: fc.constant('사유') }) },
    { weight: 4, arbitrary: fc.record({ type: fc.constant('report' as const), kind: fc.constantFrom('label' as const, 'thanks' as const), pick: fc.nat(), video: fc.boolean() }) },
    {
      weight: 8,
      arbitrary: fc.record({
        type: fc.constant('pick' as const),
        action: fc.constantFrom<PickedAction>('host.cancel', 'host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel', 'host.blockBuyer', 'cancelChat', 'cancelChat', 'assignTo', 'replace', 'replace'),
        pick: fc.nat(),
        other: fc.nat(),
        to: fc.constantFrom('WAITLIST' as const, 'CANCEL' as const),
      }),
    },
  )
}

/** 방송 시작 때 상품을 몇 개 등록해 두고(대부분 판매 중), 그 뒤로 채팅·조치·보고가 섞인다 */
function registrationArb(bIds: readonly string[]): fc.Arbitrary<Step> {
  return fc.record({
    type: fc.constant('product.register' as const),
    b: fc.constantFrom(...bIds, bIds[0] as string),
    no: fc.constantFrom(...NOS),
    name: fc.constantFrom('', '핑크프릴'),
    price: fc.integer({ min: 0, max: 30000 }),
    stock: fc.constantFrom(1, 1, 2, 3),
    status: fc.constantFrom('OPEN' as const, 'OPEN' as const, 'OPEN' as const, 'READY' as const),
  })
}

function makeScenarioArb(settings: fc.Arbitrary<SettingsOverride>): fc.Arbitrary<Scenario> {
  return fc.tuple(fc.constantFrom<readonly BroadcastInfo[]>([B1], [B1], [B1, B2], [B1, B0919]), settings).chain(([broadcasts, chosen]) => {
    const bIds = broadcasts.map((b) => b.id)
    return fc
      .tuple(
        fc.array(registrationArb(bIds), { minLength: 2, maxLength: 6 }),
        fc.array(fc.record({ step: stepArb(bIds), dt: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 3000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 40_000 }) }) }), {
          minLength: 1,
          maxLength: 70,
          size: 'max',
        }),
      )
      .map(([prefix, rest]) => ({ broadcasts, settings: chosen, entries: [...prefix.map((step) => ({ step, dt: 0 })), ...rest] }))
  })
}

const scenarioArb = makeScenarioArb(settingsArb)
/** 승계=묻기(ASK)와 대기 한도 1 이상을 고정한 로그 — "승계 결정 필요" 표시가 생기고 사라지는 길을 자주 지난다 */
const askScenarioArb = makeScenarioArb(settingsArb.map((settings) => ({ ...settings, 'cancel.succession': 'ASK', 'waitlist.max': Math.max(1, settings['waitlist.max'] ?? 1) })))

// ── 실행 ─────────────────────────────────────────────────────────────────

function resolvePick(state: EngineState, step: PickStep, seq: number, at: number): EngineEvent {
  const active = listClaims(state).filter((c) => c.status === 'CONFIRMED' || c.status === 'WAITLISTED' || c.status === 'PENDING')
  const confirmed = active.filter((c) => c.status === 'CONFIRMED')
  const pool = step.other % 2 === 0 && confirmed.length > 0 ? confirmed : active
  const target = pool[step.pick % Math.max(1, pool.length)]
  if (target === undefined) return { type: 'host.reopen', b: 'b1', no: 1, reason: '사유', seq, at }
  const at_ = { b: target.broadcast, no: target.no }
  const buyers = listBuyers(state).map((b) => b.id)
  const other = buyers[step.other % buyers.length] as string
  switch (step.action) {
    case 'cancelChat':
      return { type: 'chat', b: target.broadcast, id: `p${String(seq)}`, ch: target.buyer, nick: '가', text: `${String(target.no)} 취소`, seq, at }
    case 'assignTo':
      return { type: 'host.assign', ...at_, buyer: other, reason: '사유', seq, at }
    case 'replace': {
      const winner = listClaims(state).find((c) => c.product === target.product && c.status === 'CONFIRMED')
      return { type: 'host.assign', ...at_, buyer: other, reason: '사유', replace: winner?.buyer ?? target.buyer, replaceTo: step.to, seq, at }
    }
    case 'host.blockBuyer':
      return { type: 'host.blockBuyer', buyer: target.buyer, reason: '사유', seq, at }
    case 'host.cancel':
    case 'host.reject':
    case 'host.promote':
      return { type: step.action, ...at_, buyer: target.buyer, reason: '사유', seq, at }
    default:
      return { type: step.action, ...at_, buyer: target.buyer, seq, at }
  }
}

function resolve(state: EngineState, step: Step, seq: number, at: number): EngineEvent {
  if (step.type === 'pick') return resolvePick(state, step, seq, at)
  if (step.type !== 'report') return { ...step, seq, at } as EngineEvent
  const kind = step.kind === 'label' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
  const candidates = listEffects(state).filter((e) => e.kind === kind && (kind !== 'POST_THANKS' || e.target === (step.video ? 'VIDEO_COMMENT' : 'LIVE_CHAT')))
  const effectId = candidates.length === 0 ? 'c999:PRINT_PRODUCT_LABEL:-:1' : (candidates[step.pick % candidates.length]?.id as string)
  return { type: step.kind === 'label' ? 'effect.labelPrinted' : 'effect.thanksSent', effectId, seq, at }
}

interface Run {
  readonly states: EngineState[]
  readonly events: EngineEvent[]
  readonly emitted: (readonly string[])[]
}

function runScenario(scenario: Scenario): Run {
  let state = initEngine({ broadcasts: scenario.broadcasts, settings: scenario.settings })
  const states = [state]
  const events: EngineEvent[] = []
  const emitted: (readonly string[])[] = []
  let at = T0
  scenario.entries.forEach((entry, i) => {
    at += entry.dt
    const event = resolve(state, entry.step, i + 1, at)
    const result = applyEvent(state, event)
    state = result.state
    states.push(state)
    events.push(event)
    emitted.push(result.effects.map((e) => e.id))
  })
  return { states, events, emitted }
}

/** 관찰 값 (seq에서 나온 값은 뺀다: 찜의 seq, 취소 요청의 seq) */
function observe(state: EngineState): unknown {
  return {
    products: listProducts(state),
    claims: listClaims(state).map(({ seq: _seq, ...rest }) => rest),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state).map(({ seq: _seq, ...rest }) => rest),
  }
}

const json = (value: unknown): string => JSON.stringify(value)
const byId = (claims: readonly ClaimInfo[]): Map<string, ClaimInfo> => new Map(claims.map((c) => [c.id, c]))
const HOST_RELEASE = new Set(['host.cancel', 'host.reject', 'host.assign', 'host.approveCancel'])

/** 이벤트 하나 앞뒤의 불변식 (INV-1·2·5·6·7·9 + INV-8·10·11, 확정버전, 효과 목록) */
function checkStep(scenario: Scenario, prev: EngineState, event: EngineEvent, next: EngineState, emitted: readonly string[], versions: Map<string, number[]>): void {
  const where = `seq ${String(event.seq)} ${event.type}`
  expect(checkInvariants(next), where).toEqual([])

  const before = byId(listClaims(prev))
  const after = listClaims(next)
  // INV-8·INV-10: 확정에서 풀리는 찜은 그 조치의 대상 하나뿐
  const released = after.filter((c) => before.get(c.id)?.status === 'CONFIRMED' && c.status !== 'CONFIRMED')
  expect(released.length, where).toBeLessThanOrEqual(1)
  for (const claim of released) {
    const was = before.get(claim.id) as ClaimInfo
    const e = event as unknown as Record<string, unknown>
    if (event.type === 'chat') {
      // 방송자가 켠 시청자 자동 취소(잠금 전), 그 찜의 주인이 쓴 취소만
      expect(scenario.settings['cancel.buyerChat'], `${where}: 채팅이 확정을 풀었다`).toBe('AUTO')
      expect(was.locked, `${where}: 잠긴 확정 찜이 시청자 채팅으로 풀렸다 (INV-10)`).toBe(false)
      expect(e.ch).toBe(claim.buyer)
    } else {
      expect(HOST_RELEASE.has(event.type), `${where}: 방송자 조치 없이 확정이 풀렸다 (INV-8)`).toBe(true)
      expect(event.type === 'host.assign' ? e.replace : e.buyer, where).toBe(claim.buyer)
    }
  }

  // D-038: 같은 구매자가 그 번호에 활성 찜이 있으면 새 찜은 생기지 않는다 (4번 줄을 맨 먼저)
  const activeBefore = new Set([...before.values()].filter((c) => c.status === 'CONFIRMED' || c.status === 'WAITLISTED' || c.status === 'PENDING').map((c) => `${c.product}|${c.buyer}`))
  for (const claim of after.filter((c) => !before.has(c.id))) expect(activeBefore.has(`${claim.product}|${claim.buyer}`), `${where}: 같은 사람의 두 번째 찜`).toBe(false)
  // D-040·D-049: 차단 중인 구매자에게는 대기·보류 찜이 없다 (그래서 승계가 차단한 사람을 확정하지 않는다)
  const blocked = new Set(listBuyers(next).filter((b) => b.blocked).map((b) => b.id))
  for (const claim of after) {
    if (claim.status === 'WAITLISTED' || claim.status === 'PENDING') expect(blocked.has(claim.buyer), `${where}: 차단 중인 ${claim.buyer}의 ${claim.status} 찜`).toBe(false)
  }
  // D-041: "승계 결정 필요" 표시는 대기가 있고 빈 자리가 있을 때만 남는다
  for (const product of listProducts(next)) {
    if (product.awaitingSuccession) expect(product.waitlist.length > 0 && product.winners.length < product.stock, `${where}: ${product.key} 표시가 남았다`).toBe(true)
  }

  // 확정버전: 상품마다 확정될 때마다 1부터 빈틈없이 하나씩
  for (const claim of after) {
    const was = before.get(claim.id)
    const newlyConfirmed = claim.status === 'CONFIRMED' && (was?.status !== 'CONFIRMED' || was.confirmVersion !== claim.confirmVersion)
    if (newlyConfirmed) versions.set(claim.product, [...(versions.get(claim.product) ?? []), claim.confirmVersion as number])
  }
  for (const product of listProducts(next)) {
    const seen = versions.get(product.key) ?? []
    expect(seen, `${where}: ${product.key} 확정버전`).toEqual(seen.map((_, i) => i + 1))
    expect(product.confirmVersion).toBe(seen.length)
  }
  // 가격 스냅샷 = 확정 시점 상품 가격 (S02엔 가격 변경이 없다)
  for (const claim of after.filter((c) => c.status === 'CONFIRMED')) {
    expect(claim.price).toBe(listProducts(next).find((p) => p.key === claim.product)?.price)
  }

  // 효과 목록 = 이전 목록 + 이번에 나온 효과 (빠짐·추가 없음), 효과 ID 유일
  const prevEffects = listEffects(prev)
  const nextEffects = listEffects(next)
  expect(nextEffects.map((e) => e.id)).toEqual([...prevEffects.map((e) => e.id), ...emitted])
  expect(new Set(nextEffects.map((e) => e.id)).size).toBe(nextEffects.length)
  // 엔진은 NOTIFY를 내지 않는다
  expect(nextEffects.some((e) => e.kind === 'NOTIFY' || e.kind === 'PRINT_PACKING_LABEL')).toBe(false)
  // INV-11: 실행 완료는 효과마다 최대 1번, 완료는 되돌아가지 않는다. 완료된 효과의 보고는 관찰 값을 바꾸지 않는다
  const prevStatus = new Map(prevEffects.map((e) => [e.id, e.status]))
  const becameDone = nextEffects.filter((e) => e.status === 'DONE' && prevStatus.get(e.id) !== 'DONE')
  expect(becameDone.length).toBeLessThanOrEqual(event.type.startsWith('effect.') ? 1 : 0)
  for (const effect of nextEffects) if (prevStatus.get(effect.id) === 'DONE') expect(effect.status).toBe('DONE')
  if (event.type.startsWith('effect.') && prevStatus.get((event as { effectId: string }).effectId) === 'DONE') {
    expect(json(observe(next)), `${where}: 중복 보고`).toBe(json(observe(prev)))
  }
}

function checkRun(scenario: Scenario): Run {
  const run = runScenario(scenario)
  const versions = new Map<string, number[]>()
  run.events.forEach((event, i) => checkStep(scenario, run.states[i] as EngineState, event, run.states[i + 1] as EngineState, run.emitted[i] as string[], versions))
  return run
}

const PARAMS = { numRuns: 250 } as const

describe('AC-S02-93 불변식 속성 (무작위 S02 로그)', () => {
  it('매 이벤트 뒤 INV-1·2·5·6·7·9, 이벤트 사이 INV-8·10·11, 확정버전·효과 목록', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        checkRun(scenario)
      }),
      PARAMS,
    )
  })

  it('같은 검사, 승계=묻기 로그', () => {
    fc.assert(
      fc.property(askScenarioArb, (scenario) => {
        checkRun(scenario)
      }),
      PARAMS,
    )
  })

  it('INV-4: 처음부터 다시 적용한 상태 = 이어서 적용한 상태, JSON 왕복 뒤 이어서 적용해도 같다', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (scenario, cut) => {
        const first = runScenario(scenario)
        const second = runScenario(scenario)
        expect(second.states.map(json)).toEqual(first.states.map(json))
        const k = cut % (first.events.length + 1)
        let state = JSON.parse(json(first.states[k])) as EngineState
        for (let i = k; i < first.events.length; i++) state = applyEvent(state, first.events[i] as EngineEvent).state
        expect(json(state)).toBe(json(first.states.at(-1)))
      }),
      PARAMS,
    )
  })

  const chatIndexes = (scenario: Scenario): number[] => scenario.entries.flatMap((entry, i) => (entry.step.type === 'chat' ? [i] : []))

  it('INV-3: 아무 위치의 채팅 이벤트를 바로 뒤에 한 번 더 넣어도 관찰 값이 같다', () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => chatIndexes(s).length > 0),
        fc.nat(),
        (scenario, pick) => {
          const indexes = chatIndexes(scenario)
          const i = indexes[pick % indexes.length] as number
          const copy: Entry = { step: scenario.entries[i]?.step as Step, dt: 0 }
          const duplicated = { ...scenario, entries: [...scenario.entries.slice(0, i + 1), copy, ...scenario.entries.slice(i + 1)] }
          const original = runScenario(scenario)
          const withCopy = runScenario(duplicated)
          expect(json(observe(withCopy.states[i + 2] as EngineState))).toBe(json(observe(withCopy.states[i + 1] as EngineState)))
          expect(json(observe(withCopy.states.at(-1) as EngineState))).toBe(json(observe(original.states.at(-1) as EngineState)))
        },
      ),
      PARAMS,
    )
  })

  it('INV-12: 첫 수신 이후 아무 위치들에 사본(본문·닉네임이 달라도)을 끼워 넣어도 관찰 값이 같다', () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => chatIndexes(s).length > 0),
        fc.nat(),
        fc.array(fc.tuple(fc.nat(), fc.constantFrom('15', '1 취소', '안녕', '2'), fc.constantFrom('가', '바뀐닉')), { minLength: 1, maxLength: 4 }),
        (scenario, pick, copies) => {
          const indexes = chatIndexes(scenario)
          const i = indexes[pick % indexes.length] as number
          const source = scenario.entries[i]?.step as EventInput & { type: 'chat' }
          const entries = [...scenario.entries]
          // 뒤에서부터 넣어 앞 위치가 밀리지 않게: 위치는 첫 수신(i) 뒤 i+1 .. 끝
          const positions = copies.map(([n, text, nick]) => ({ at: i + 1 + (n % (scenario.entries.length - i)), text, nick })).sort((a, b) => b.at - a.at)
          for (const { at, text, nick } of positions) entries.splice(at, 0, { step: { ...source, text, nick }, dt: 0 })
          const original = runScenario(scenario)
          const withCopies = runScenario({ ...scenario, entries })
          expect(json(observe(withCopies.states.at(-1) as EngineState))).toBe(json(observe(original.states.at(-1) as EngineState)))
        },
      ),
      PARAMS,
    )
  })
})

// ── AC-S02-03: 맞지 않는 명령 ────────────────────────────────────────────

/** 지금 상태에서 아무것도 바꾸지 않아야 하는 명령들 (형식은 맞지만 상태에 비춰 조건이 안 맞는 것. 형식 오류는 AC-S03-02 입력 오류) */
function invalidCommands(scenario: Scenario, state: EngineState): EventInput[] {
  const out: EventInput[] = [
    { type: 'product.open', b: 'b1', no: 999 },
    { type: 'product.hold', b: 'b1', no: 999 },
    { type: 'product.close', b: 'b1', no: 999 },
    { type: 'host.cancel', b: 'b1', no: 1, buyer: 'NOBODY', reason: 'r' },
    { type: 'host.reject', b: 'b1', no: 2, buyer: 'NOBODY', reason: 'r' },
    { type: 'host.promote', b: 'b1', no: 1, buyer: 'NOBODY', reason: 'r' },
    { type: 'host.confirm', b: 'b1', no: 1, buyer: 'NOBODY' },
    { type: 'host.approveCancel', b: 'b1', no: 1, buyer: 'NOBODY' },
    { type: 'host.dismissCancel', b: 'b1', no: 1, buyer: 'NOBODY' },
    { type: 'host.assign', b: 'b1', no: 1, buyer: 'NOBODY', reason: 'r' },
    { type: 'host.reopen', b: 'b1', no: 999, reason: 'r' },
    { type: 'host.unblockBuyer', buyer: 'NOBODY', reason: 'r' },
    { type: 'effect.labelPrinted', effectId: 'c999:PRINT_PRODUCT_LABEL:-:1' },
  ]
  for (const product of listProducts(state)) {
    const at = { b: product.broadcast, no: product.no }
    out.push({ type: 'product.register', ...at, name: '덮어쓰기', price: 1 })
    if (product.status === 'OPEN' || product.status === 'SOLD') out.push({ type: 'product.open', ...at })
    else out.push({ type: 'product.hold', ...at })
    if (product.winners.length > 0 || product.waitlist.length > 0) out.push({ type: 'product.close', ...at })
    if (!product.awaitingSuccession) out.push({ type: 'host.reopen', ...at, reason: 'r' })
    for (const winner of product.winners) {
      out.push({ type: 'host.promote', ...at, buyer: winner, reason: 'r' })
      out.push({ type: 'host.assign', ...at, buyer: winner, reason: 'r' })
    }
    if (product.winners.length >= product.stock) for (const waiting of product.waitlist) out.push({ type: 'host.promote', ...at, buyer: waiting, reason: 'r' })
  }
  for (const claim of listClaims(state)) {
    if (claim.status === 'CONFIRMED' && claim.locked) out.push({ type: 'host.confirm', b: claim.broadcast, no: claim.no, buyer: claim.buyer })
    if ((claim.status === 'WAITLISTED' || claim.status === 'PENDING') && !claim.cancelRequested) {
      out.push({ type: 'host.approveCancel', b: claim.broadcast, no: claim.no, buyer: claim.buyer })
      out.push({ type: 'host.dismissCancel', b: claim.broadcast, no: claim.no, buyer: claim.buyer })
    }
  }
  for (const effect of listEffects(state)) {
    if (effect.status === 'DONE') out.push({ type: effect.kind === 'POST_THANKS' ? 'effect.thanksSent' : 'effect.labelPrinted', effectId: effect.id })
    if (effect.kind === 'VOID_LABEL') out.push({ type: 'effect.labelPrinted', effectId: effect.id })
  }
  for (const buyer of listBuyers(state)) if (buyer.blocked) out.push({ type: 'host.blockBuyer', buyer: buyer.id, reason: 'r' })
  void scenario
  return out
}

describe('AC-S02-03 무작위 상태에 맞지 않는 명령 → 새 효과 없음, 관찰 값 그대로', () => {
  it('속성', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (scenario, pick) => {
        const run = runScenario(scenario)
        const state = run.states.at(-1) as EngineState
        const commands = invalidCommands(scenario, state)
        const command = commands[pick % commands.length] as EventInput
        const result = applyEvent(state, { at: T0 + 10_000_000, ...command, seq: run.events.length + 1 } as EngineEvent)
        expect(result.effects, json(command)).toEqual([])
        expect(json(observe(result.state)), json(command)).toBe(json(observe(state)))
      }),
      PARAMS,
    )
  })
})

describe('회귀 (시드 고정)', () => {
  it('고정 시드로 같은 로그를 다시 돌린다', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        checkRun(scenario)
      }),
      { seed: 20261019, numRuns: 150 },
    )
  })

  it('손으로 적은 사슬: ASK + 재고 2 + 교체 + 차단 + 늦은 보고', () => {
    const scenario: Scenario = {
      broadcasts: [B1],
      settings: { 'cancel.succession': 'ASK', 'waitlist.max': 1, 'cancel.buyerChat': 'AUTO' },
      entries: [
        { step: { type: 'product.register', b: 'b1', no: 1, name: '핑크', price: 1000, stock: 2 }, dt: 0 },
        { step: { type: 'chat', b: 'b1', id: 'm1', ch: 'A', nick: '가', text: '1' }, dt: 100 },
        { step: { type: 'chat', b: 'b1', id: 'm2', ch: 'B', nick: '나', text: '1' }, dt: 100 },
        { step: { type: 'chat', b: 'b1', id: 'm3', ch: 'C', nick: '다', text: '1' }, dt: 100 },
        { step: { type: 'report', kind: 'label', pick: 0, video: false }, dt: 100 },
        { step: { type: 'chat', b: 'b1', id: 'm4', ch: 'A', nick: '가', text: '1 취소' }, dt: 100 },
        { step: { type: 'host.assign', b: 'b1', no: 1, buyer: 'D', reason: 'r' }, dt: 100 },
        { step: { type: 'chat', b: 'b1', id: 'm5', ch: 'D', nick: '라', text: '안녕' }, dt: 100 },
        { step: { type: 'host.assign', b: 'b1', no: 1, buyer: 'D', reason: 'r', replace: 'B', replaceTo: 'WAITLIST' }, dt: 100 },
        { step: { type: 'host.blockBuyer', buyer: 'C', reason: 'r' }, dt: 100 },
        { step: { type: 'report', kind: 'label', pick: 1, video: false }, dt: 100 },
        { step: { type: 'host.reopen', b: 'b1', no: 1, reason: 'r' }, dt: 100 },
      ],
    }
    // 5: A 라벨 출력 → A 잠금. 6: 잠긴 확정 찜의 AUTO 취소 → 요청. 7: D는 아직 모르는 구매자 → 아무 일도 없음.
    // 9: B를 대기 1순위로 교체 → 대기 [B, C] → 한도 1 → C 품절. 11: 취소된 B 라벨의 늦은 보고 → VOID_LABEL(B, 2). 12: 표시 없음
    const run = checkRun(scenario)
    const last = run.states.at(-1) as EngineState
    expect(listProducts(last).map((p) => [p.winners, p.waitlist, p.awaitingSuccession])).toEqual([[['A', 'D'], ['B'], false]])
    expect(listCancelRequests(last).map((r) => r.buyer)).toEqual(['A'])
    expect(listEffects(last).filter((e) => e.kind === 'VOID_LABEL').map((e) => [e.buyer, e.confirmVersion])).toEqual([['B', 2]])
    expect(listClaims(last).map((c) => [c.buyer, c.status, c.reason])).toEqual([
      ['A', 'CONFIRMED', null],
      ['B', 'WAITLISTED', null],
      ['C', 'REJECTED', 'SOLD_OUT'],
      ['D', 'CONFIRMED', null],
    ])
  })
})
