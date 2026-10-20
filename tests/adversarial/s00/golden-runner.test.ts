// S00 골든 러너 공격 (AC-S00-20~28, F절 "러너가 항상 통과하지 않는지"·"허용 목록 우회"·"결정성"·"시간대").
// 개발자 보고를 믿지 않고 프로그램 API(@livejjim/core/golden)와 CLI를 직접 공격한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NotImplementedError } from '@livejjim/core'
import {
  createFakeCore,
  emptySnapshot,
  formatUtcIso,
  listGoldenFiles,
  parseGoldenYaml,
  realCore,
  resolveAt,
  type GoldenCore,
  type GoldenEvent,
  type GoldenSnapshot,
} from '@livejjim/core/golden'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ROOT, allowlistText, node, register, runSources, scenarioText, suiteText } from './helpers.ts'

const CONFIRMED_CLAIM = { product: 'b1/15', buyer: 'X', status: 'CONFIRMED' } as const
const PAYMENT = { at: '20:10:00', type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-18', amount: 1000 }
const ALLOW_ALL_SCENARIOS = allowlistText([], ['G-ENG-*'])

interface EventsState {
  readonly events: readonly GoldenEvent[]
}

/** settlement.payment에서만 "미구현"을 던지는 가짜 엔진 (S02처럼 판정만 구현한 상태를 흉내 낸다) */
function partialEngine(options: {
  readonly snapshot: (events: readonly GoldenEvent[]) => GoldenSnapshot
  readonly hidden?: () => Record<string, unknown>
  readonly invariants?: GoldenCore['engine']['invariants']
}): GoldenCore {
  return createFakeCore({
    snapshot: options.snapshot,
    engine: {
      apply: (state, event) => {
        if (event.type === 'settlement.payment') throw new NotImplementedError('정산(가짜)')
        const events = [...(state as EventsState).events, event]
        return { state: { events, ...(options.hidden?.() ?? {}) }, effects: [] }
      },
      ...(options.invariants ? { invariants: options.invariants } : {}),
    },
  })
}

// ── 지적 ────────────────────────────────────────────────────────────────

describe('TD-S00-001: 나중에 나온 "미구현"이 앞에서 이미 드러난 실패를 허용 목록으로 숨긴다 (AC-S00-23, README "결과 상태")', () => {
  it('TD-S00-001: 중간 검사 불일치 뒤에 미구현 이벤트가 있어도 시나리오는 불일치로 실패한다', () => {
    // events[1] 중간 검사: 찜 0개를 기대하지만 엔진은 상품 등록 뒤 찜 1개를 보고한다 → 불일치.
    // 그 뒤 events[2] 정산 입금에서 엔진이 "미구현"을 던진다. 시나리오는 허용 목록(G-ENG-*)에 있다.
    const core = partialEngine({ snapshot: (events) => emptySnapshot({ claims: events.length > 0 ? [CONFIRMED_CLAIM] : [] }) })
    const text = scenarioText({ events: [register(15), { type: 'assert', expect: { claimCount: 0 } }, PAYMENT] })
    const report = runSources(text, core, ALLOW_ALL_SCENARIOS)
    const item = report.items[0]
    expect(item?.status, '불일치는 허용 목록과 상관없이 항상 실패여야 한다').toBe('mismatch')
    expect(item?.allowed).toBe(false)
    expect(item?.problems).toContainEqual(expect.objectContaining({ where: 'events[1]', path: 'claimCount', expected: 0, actual: 1 }))
    expect(report.totals.mismatch).toBe(1)
    expect(report.totals.notImplementedAllowed).toBe(0)
    expect(report.ok).toBe(false)
  })

  it('TD-S00-001: 불변식 위반 뒤에 미구현 이벤트가 있어도 실패한다', () => {
    const core = partialEngine({
      snapshot: () => emptySnapshot(),
      invariants: () => [{ id: 'INV-1', message: '한 상품을 두 명에게 팔았다' }],
    })
    const text = scenarioText({ events: [register(15), PAYMENT] })
    const report = runSources(text, core, ALLOW_ALL_SCENARIOS)
    expect(report.items[0]?.status).toBe('mismatch')
    expect(report.items[0]?.problems).toContainEqual(expect.objectContaining({ where: 'events[0]', path: '불변식 INV-1' }))
    expect(report.ok).toBe(false)
  })

  it('TD-S00-001: 미구현 이벤트 앞까지의 결정성 위반도 잡는다', () => {
    // 실행할 때마다 늘어나는 숨은 카운터가 events[0] 뒤 상태에 드러난다. events[1]에서 미구현.
    let calls = 0
    const core = partialEngine({ snapshot: () => emptySnapshot(), hidden: () => ({ calls: ++calls }) })
    const text = scenarioText({ events: [register(15), PAYMENT] })
    const report = runSources(text, core, ALLOW_ALL_SCENARIOS)
    expect(report.items[0]?.status, '같은 이벤트 열의 두 실행이 다르면 결정성 위반(항상 실패)').toBe('determinism')
    expect(report.items[0]?.problems[0]?.where).toBe('events[0]')
    expect(report.ok).toBe(false)
  })
})

describe('TD-S00-002: 파서 suite 문서 하나의 읽기 오류가 허용 목록 전체를 무효로 만들어 다른 파일의 결과를 바꾼다 (AC-S00-22)', () => {
  it('TD-S00-002: amount 문서의 형식 오류는 amount 파일의 읽기 오류 하나로 끝나고, chat·엔진 파일의 미구현(허용)은 그대로다', () => {
    // 같은 상황의 엔진 시나리오(형식 오류 문서의 ID도 허용 목록 패턴과 맞는 것으로 본다)와 똑같이 다뤄야 한다.
    const files = [
      { path: 'parser/amount.yaml', text: suiteText('amount', [{ in: '만원', out: 10000 }], { unitt: 'WON' }) },
      { path: 'parser/chat.yaml', text: suiteText('chat', [{ in: '15', out: { claims: [15] } }]) },
      { path: 'engine/01.yaml', text: scenarioText({ events: [register(15)] }) },
    ]
    const report = runSources(files, createFakeCore(), allowlistText(['chat', 'amount'], ['G-ENG-*']))
    expect(report.readErrors.map((e) => e.file), '읽기 오류는 형식이 틀린 amount 파일 하나뿐이어야 한다').toEqual(['parser/amount.yaml'])
    expect(report.items.map((i) => [i.file, i.status, i.allowed])).toEqual([
      ['engine/01.yaml', 'not-implemented', true],
      ['parser/chat.yaml', 'not-implemented', true],
    ])
    expect(report.totals.notImplementedDisallowed).toBe(0)
    expect(report.ok).toBe(false)
  })

  it('비교: 엔진 시나리오 문서의 형식 오류는 이미 그렇게 다룬다 (회귀)', () => {
    const files = [
      { path: 'engine/01.yaml', text: scenarioText({ events: [register(15)] }) },
      { path: 'engine/02.yaml', text: scenarioText({ id: 'G-ENG-902', events: [{ ...register(15), price: -1 }] }) },
      { path: 'parser/chat.yaml', text: suiteText('chat', [{ in: '15', out: { claims: [15] } }]) },
    ]
    const report = runSources(files, createFakeCore(), allowlistText(['chat'], ['G-ENG-901', 'G-ENG-902']))
    expect(report.readErrors.map((e) => e.file)).toEqual(['engine/02.yaml'])
    expect(report.totals.notImplementedDisallowed).toBe(0)
  })
})

describe('TD-S00-006: 정수 필드가 YAML 실수(float)를 정수로 받아들인다 (README 형식 계약 "정수", D-021, CLAUDE.md 규칙 2)', () => {
  const scenarioYaml = (priceLiteral: string): string =>
    [
      'id: G-ENG-950',
      'title: 실수 표기',
      'refs: [R-4]',
      'broadcasts:',
      '  - { id: b1, date: 2026-10-18, title: 1부 }',
      'events:',
      `  - { at: "20:00:00", type: product.register, b: b1, no: 15, name: 핑크프릴, price: ${priceLiteral} }`,
      'expect: {}',
      '',
    ].join('\n')

  it.each([
    ['10.000', '천 단위를 점으로 쓴 1만 원이 10원으로 바뀐다'],
    ['1e4', '지수 표기'],
    ['10000.0', '소수점 표기'],
  ])('TD-S00-006: price: %s (%s) → 읽기 오류', (literal) => {
    const report = runSources(scenarioYaml(literal), createFakeCore({ snapshot: emptySnapshot() }))
    expect(report.totals.readError, `price: ${literal}는 YAML 1.2 core schema에서 실수(!!float)다. 정수 필드에 쓰면 읽기 오류여야 한다`).toBe(1)
    expect(report.readErrors[0]?.issues.map((i) => i.path)).toContain('events[0].price')
    expect(report.ok).toBe(false)
  })

  it('정수 표기는 그대로 통과 (회귀)', () => {
    const report = runSources(scenarioYaml('10000'), createFakeCore({ snapshot: emptySnapshot() }))
    expect(report.totals.readError).toBe(0)
    expect(report.items[0]?.status).toBe('pass')
  })

  it('TD-S00-006: amount suite의 out: 1e4 → 읽기 오류', () => {
    const report = runSources('suite: amount\ncases:\n  - { in: "만원", out: 1e4 }\n', createFakeCore({ parser: { amount: () => 10000 } }))
    expect(report.totals.readError).toBe(1)
    expect(report.ok).toBe(false)
  })
})

// ── 회귀: 러너가 항상 통과하지 않는지 (AC-S00-22·25) ─────────────────────

/** 형식 계약의 어휘를 거의 다 쓰는 정상 시나리오 */
const RICH_EXPECT = {
  products: {
    'b1/15': { status: 'SOLD', winner: 'UC_A', winners: ['UC_A'], waitlist: ['UC_B'], conflict: false, exists: true, price: 10000, priceHistory: [{ from: 10000, to: 12000 }] },
  },
  buyers: { UC_A: { items: ['b1/15'], subtotal: 10000, byBroadcast: { b1: 10000 }, display: '홍길동', nameHistory: ['홍길동'] } },
  settlements: { 'UC_A@2026-10-18': { subtotal: 10000, shipping: 4000, adjustments: 0, total: 14000, refundDue: 0, payment: 'UNPAID' } },
  effects: [{ kind: 'POST_THANKS', target: 'LIVE_CHAT', product: 'b1/15', buyer: 'UC_A', text: '감사', confirmVersion: 1 }],
  effectCounts: { POST_THANKS: 1 },
  pendingEffects: [{ kind: 'PRINT_PRODUCT_LABEL', product: 'b1/15', buyer: 'UC_A' }],
  claims: [{ product: 'b1/15', buyer: 'sms:s1', status: 'REJECTED', reason: 'SOLD_OUT' }],
  pending: { 'b1/16': ['UC_B'] },
  sameBuyer: [['UC_A', 'sms:s1']],
  claimCount: 3,
  cancelRequests: [{ product: 'b1/15', buyer: 'UC_B' }],
}
const RICH_DOC = {
  id: 'G-ENG-900',
  title: '어휘 전부',
  refs: ['R-4'],
  settings: { 'claim.parseMode': 'STRICT', 'cancel.buyerChat': 'OFF', 'shipping.freeThreshold': null, 'print.autoOnConfirm': false },
  broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }],
  events: [
    { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크', price: 10000, stock: 1, status: 'OPEN' },
    { at: '20:00:01', type: 'product.update', b: 'b1', no: 15, price: 12000, applyTo: 'NEW_ONLY' },
    { at: '20:00:02', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15', owner: false, publishedAt: '20:00:01' },
    { at: '20:00:03', type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:01', memo: '메모', phone: '010' },
    { type: 'assert', expect: RICH_EXPECT },
    { at: '20:00:04', type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'KEEP', reason: '확인' },
    { at: '20:00:05', type: 'effect.thanksSent', b: 'b1', no: 15, buyer: 'UC_A', target: 'VIDEO_COMMENT' },
    { at: '20:00:06', type: 'settlement.shippingOverride', buyer: 'UC_A', date: '2026-10-18', mode: 'FIXED', amount: 0 },
  ],
  expect: RICH_EXPECT,
}

type Path = readonly (string | number)[]
/** 사용자 값이 키가 되는 맵(상품·구매자·정산·보류·방송별 합계·효과 종류) — 그 아래 키 이름은 어휘가 아니다 */
const USER_KEYED = new Set(['products', 'buyers', 'settlements', 'pending', 'byBroadcast', 'effectCounts'])

function vocabularyKeyPaths(value: unknown, path: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => vocabularyKeyPaths(item, [...path, i]))
  if (typeof value !== 'object' || value === null) return []
  const parent = path[path.length - 1]
  return Object.entries(value).flatMap(([key, child]) => [
    ...(typeof parent === 'string' && USER_KEYED.has(parent) ? [] : [[...path, key]]),
    ...vocabularyKeyPaths(child, [...path, key]),
  ])
}

/** 키 하나의 이름을 바꾼 사본. 바꾼 이름이 같은 맵에 이미 있으면(예: winner → winners) undefined */
function renameKey(doc: unknown, path: Path, renamed: string): unknown {
  const copy: unknown = structuredClone(doc)
  let parent = copy as Record<string | number, unknown>
  for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<string | number, unknown>
  const key = String(path[path.length - 1])
  if (Object.hasOwn(parent, renamed)) return undefined
  const entries = Object.entries(parent).map(([k, v]): [string, unknown] => (k === key ? [renamed, v] : [k, v]))
  for (const k of Object.keys(parent)) delete parent[k]
  for (const [k, v] of entries) parent[k] = v
  return copy
}

describe('키 오타는 어디에 있든 읽기 오류 (AC-S00-22 범주 2·5·11·12, D-021) — 회귀', () => {
  const okCore = createFakeCore({ snapshot: emptySnapshot() })

  it('정상 문서는 읽기 오류 없이 불러온다 (아래 속성 검사의 전제)', () => {
    const report = runSources(JSON.stringify(RICH_DOC), okCore)
    expect(report.readErrors).toEqual([])
  })

  it('어휘 키 하나를 무작위로 바꾸면(글자 추가·삭제·대소문자·공백) 항상 읽기 오류', () => {
    const paths = vocabularyKeyPaths(RICH_DOC)
    expect(paths.length).toBeGreaterThan(100)
    const mutations: readonly ((key: string) => string)[] = [
      (k) => `${k}s`,
      (k) => k.slice(0, -1),
      (k) => k.slice(1),
      (k) => (k.toUpperCase() === k ? k.toLowerCase() : k.toUpperCase()),
      (k) => ` ${k}`,
      (k) => `${k[1] ?? ''}${k[0] ?? ''}${k.slice(2)}`,
    ]
    fc.assert(
      fc.property(fc.constantFrom(...paths), fc.constantFrom(...mutations), (path, mutate) => {
        const key = String(path[path.length - 1])
        const renamed = mutate(key)
        fc.pre(renamed !== key && renamed !== '')
        const mutated = renameKey(RICH_DOC, path, renamed)
        fc.pre(mutated !== undefined)
        const report = runSources(JSON.stringify(mutated), okCore)
        expect(report.totals.readError, `${path.join('.')} → ${JSON.stringify(renamed)}`).toBe(1)
        expect(report.ok).toBe(false)
      }),
      { numRuns: 300 },
    )
  }, 60_000)

  it.each([
    ['상품 상태 SOLDOUT', ['expect', 'products', 'b1/15', 'status'], 'SOLDOUT'],
    ['찜 상태 소문자', ['expect', 'claims', 0, 'status'], 'rejected'],
    ['거절 사유 오타', ['expect', 'claims', 0, 'reason'], 'SOLDOUT'],
    ['효과 종류 오타', ['expect', 'effects', 0, 'kind'], 'POST_THANK'],
    ['대상 오타', ['expect', 'effects', 0, 'target'], 'LIVECHAT'],
    ['입금 상태 오타', ['expect', 'settlements', 'UC_A@2026-10-18', 'payment'], 'PAID_'],
    ['설정값 소문자', ['settings', 'claim.parseMode'], 'strict'],
    ['YAML 1.1식 불리언 값', ['settings', 'print.autoOnConfirm'], 'no'],
    ['owner: yes', ['events', 2, 'owner'], 'yes'],
    ['이벤트 종류 오타', ['events', 0, 'type'], 'product.registr'],
    ['결정 값 오타', ['events', 5, 'decision'], 'keep'],
    ['상품 키 번호 0', ['expect', 'claims', 0, 'product'], 'b1/0'],
    ['상품 키 선행 0', ['expect', 'claims', 0, 'product'], 'b1/015'],
    ['선언 안 한 방송', ['events', 0, 'b'], 'b9'],
    ['없는 문자찜 구매자', ['expect', 'claims', 0, 'buyer'], 'sms:s9'],
    ['수신 시각 24:00', ['events', 3, 'received'], '24:00'],
    ['오프셋 없는 ISO', ['events', 1, 'at'], '2026-10-18T20:00:01'],
  ] as const)('열거값·형식 오류: %s → 읽기 오류', (_label, path, value) => {
    const doc = structuredClone(RICH_DOC) as unknown as Record<string | number, unknown>
    let parent = doc
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<string | number, unknown>
    parent[path[path.length - 1] as string | number] = value
    const report = runSources(JSON.stringify(doc), okCore)
    expect(report.totals.readError).toBe(1)
    expect(report.ok).toBe(false)
  })

  it('at 역행은 읽기 오류, 자정 뒤 ISO는 정상', () => {
    const back = scenarioText({ events: [register(15, '20:00:01'), register(16, '20:00:00')] })
    expect(runSources(back, okCore).readErrors[0]?.issues[0]?.path).toBe('events[1].at')
    const midnight = scenarioText({ events: [register(15, '23:59:59.999'), register(16, '2026-10-19T00:00:00+09:00')] })
    expect(runSources(midnight, okCore).readErrors).toEqual([])
  })

  it('YAML 1.1 함정: no: 키, OFF·yes·on 값, 날짜는 문자열 그대로 (AC-S00-21)', () => {
    const parsed = parseGoldenYaml('no: 1\na: OFF\nb: yes\nc: on\nd: 2026-10-18\ne: 20:00:00\nf: off\n')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.documents[0]?.value).toEqual({ no: 1, a: 'OFF', b: 'yes', c: 'on', d: '2026-10-18', e: '20:00:00', f: 'off' })
    // OFF가 불리언으로 바뀌면 cancel.buyerChat 값 검사에서 읽기 오류가 난다 → 정상 문서여야 한다
    const doc = [
      'id: G-ENG-951',
      'title: OFF 설정',
      'refs: [R-4]',
      'settings: { cancel.buyerChat: OFF, thanks.videoComment: OFF }',
      'broadcasts: [{ id: b1, date: 2026-10-18, title: 1부 }]',
      'events: [{ at: 20:00:00, type: product.register, b: b1, no: 15, name: 핑크, price: 10000 }]',
      'expect: {}',
    ].join('\n')
    const recorded: unknown[] = []
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: (setup) => {
          recorded.push(setup)
          return { events: [] }
        },
      },
    })
    const report = runSources(doc, core)
    expect(report.readErrors).toEqual([])
    expect(recorded[0]).toEqual({ broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }], settings: { 'cancel.buyerChat': 'OFF', 'thanks.videoComment': 'OFF' } })
  })
})

describe('허용 목록 (AC-S00-23) — 회귀', () => {
  /** 상품 번호로 결과를 고르는 가짜 엔진: 1 통과 · 2 불일치 · 3 미구현 · 4 러너 오류 · 5 결정성 위반 */
  function behaviourCore(): GoldenCore {
    let runs = 0
    return createFakeCore({
      snapshot: (events) => emptySnapshot({ claims: events.some((e) => e.no === 2) ? [CONFIRMED_CLAIM] : [] }),
      engine: {
        start: () => ({ events: [] }),
        apply: (state, event) => {
          if (event.no === 3) throw new NotImplementedError('가짜')
          if (event.no === 4) throw new TypeError('엔진 버그')
          const extra = event.no === 5 ? { run: ++runs } : {}
          return { state: { events: [...(state as EventsState).events, event], ...extra }, effects: [] }
        },
      },
    })
  }

  it('목록에 있어도 미구현·통과가 아닌 결과는 모두 실패 (무작위 조합)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 8 }), (behaviours) => {
        const files = behaviours.map((b, i) => ({
          path: `engine/${String(i).padStart(2, '0')}.yaml`,
          text: scenarioText({ id: `G-ENG-${String(100 + i)}`, events: [register(b)], expect: { claimCount: 0 } }),
        }))
        const report = runSources(files, behaviourCore(), ALLOW_ALL_SCENARIOS)
        const statuses = report.items.map((item) => item.status)
        expect(statuses).toEqual(behaviours.map((b) => ['pass', 'mismatch', 'not-implemented', 'runner-error', 'determinism'][b - 1]))
        expect(report.ok).toBe(behaviours.every((b) => b === 1 || b === 3))
        expect(report.totals.notImplementedAllowed).toBe(behaviours.filter((b) => b === 3).length)
      }),
      { numRuns: 60 },
    )
  })

  it('패턴 오타·모르는 suite·대소문자 다른 패턴은 읽기 오류이고 아무것도 허용하지 않는다', () => {
    const files = [
      { path: 'engine/01.yaml', text: scenarioText({ events: [register(15)] }) },
      { path: 'parser/chat.yaml', text: suiteText('chat', [{ in: '15', out: { claims: [15] } }]) },
    ]
    for (const allowlist of [
      allowlistText(['chat'], ['G-ENG-90*', 'G-ENG-0*']),
      allowlistText(['chatt'], ['G-ENG-*']),
      allowlistText(['chat'], ['g-eng-*']),
      allowlistText(['chat'], ['G-ENG-9?1']),
      JSON.stringify({ suites: ['chat'], scenarios: ['G-ENG-*'], extra: true }),
      JSON.stringify({ suites: 'chat', scenarios: ['G-ENG-*'] }),
    ]) {
      const report = runSources(files, createFakeCore(), allowlist)
      expect(report.readErrors.map((e) => e.label), allowlist).toEqual(['허용 목록'])
      expect(report.totals.notImplementedAllowed, allowlist).toBe(0)
      expect(report.ok).toBe(false)
    }
  })

  it('실제 tests/golden: 허용 목록의 suite 하나를 빼면 그 suite의 미구현 사례 수만큼 미구현(불허)이 늘고 실패한다 (AC-S00-24)', () => {
    const goldenDir = join(ROOT, 'tests', 'golden')
    const files = listGoldenFiles(goldenDir).map((file) => ({ path: file.slice(ROOT.length), text: readFileSync(file, 'utf8') }))
    const allowlistRaw = readFileSync(join(goldenDir, 'known-unimplemented.yaml'), 'utf8')
    const parsed = parseGoldenYaml(allowlistRaw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const allowlist = (parsed.documents[0]?.value ?? {}) as { suites?: string[]; scenarios?: string[] }
    const base = runSources(files, realCore, allowlistRaw)
    for (const suite of allowlist.suites ?? []) {
      const reduced = JSON.stringify({ ...allowlist, suites: (allowlist.suites ?? []).filter((s) => s !== suite) })
      const report = runSources(files, realCore, reduced)
      const notImplemented = base.items.filter((item) => item.kind === 'parser' && item.suite === suite && item.status === 'not-implemented').length
      expect(report.totals.notImplementedDisallowed - base.totals.notImplementedDisallowed, suite).toBe(notImplemented)
      if (notImplemented > 0) expect(report.ok, suite).toBe(false)
    }
  }, 60_000)
})

describe('결정성 (AC-S00-27) — 회귀', () => {
  it('두 번째 실행의 무작위 위치에 숨은 상태가 드러나면 결정성 위반, 위치는 처음 달라진 events[n]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }).filter((kinds) => kinds.includes(false)),
        fc.nat(),
        fc.boolean(),
        (kinds, pick, inEffects) => {
          // false = 이벤트, true = 중간 검사
          let minute = 0
          const events = kinds.map((isAssert, i) => (isAssert ? { type: 'assert', expect: {} } : register(i + 1, `20:${String(minute++).padStart(2, '0')}:00`)))
          const eventIndexes = kinds.flatMap((isAssert, i) => (isAssert ? [] : [i]))
          const target = eventIndexes[pick % eventIndexes.length] ?? 0
          const targetSeq = eventIndexes.indexOf(target) + 1
          let run = 0
          const core = createFakeCore({
            snapshot: emptySnapshot(),
            engine: {
              start: () => {
                run++
                return { events: [] }
              },
              apply: (state, event) => {
                const drift = run === 2 && event.seq === targetSeq
                const next = { events: [...(state as EventsState).events, event.seq], ...(drift && !inEffects ? { drift } : {}) }
                return { state: next, effects: drift && inEffects ? [{ kind: 'NOTIFY' }] : [] }
              },
            },
          })
          const report = runSources(scenarioText({ events }), core)
          expect(report.items[0]?.status).toBe('determinism')
          expect(report.items[0]?.problems[0]?.where).toBe(`events[${target}]`)
          expect(report.ok).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('실행할 때마다 순서가 바뀌는 효과 목록은 결정성 위반 (원소는 같아도)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom('PRINT_PRODUCT_LABEL', 'POST_THANKS', 'NOTIFY', 'VOID_LABEL'), { minLength: 2, maxLength: 4 }), (kinds) => {
        let run = 0
        const core = createFakeCore({
          snapshot: emptySnapshot(),
          engine: {
            start: () => {
              run++
              return { events: [] }
            },
            apply: (state) => ({ state, effects: (run === 1 ? kinds : [...kinds].reverse()).map((kind) => ({ kind })) }),
          },
        })
        const report = runSources(scenarioText({ events: [register(15)] }), core)
        expect(report.items[0]?.status).toBe('determinism')
      }),
      { numRuns: 30 },
    )
  })

  it('엔진이 받은 이벤트·설정을 고쳐도 두 번째 실행은 원래 값으로 시작한다', () => {
    const seen: string[] = []
    const core = createFakeCore({
      snapshot: emptySnapshot(),
      engine: {
        start: (setup) => {
          seen.push(JSON.stringify(setup))
          const broadcast = setup.broadcasts[0] as { title: string }
          broadcast.title = '망가뜨림'
          return { events: [] }
        },
        apply: (state, event) => {
          seen.push(JSON.stringify(event))
          const writable = event as { price?: number }
          writable.price = -1
          return { state, effects: [] }
        },
      },
    })
    const report = runSources(scenarioText({ events: [register(15)] }), core)
    expect(report.items[0]?.status).toBe('pass')
    expect(seen.slice(0, 2)).toEqual(seen.slice(2, 4))
  })
})

describe('시간대 (AC-S00-14·26, D-026) — 회귀', () => {
  const script = [
    "import { resolveAt, formatUtcIso, runGoldenSources, createFakeCore, emptySnapshot } from '@livejjim/core/golden'",
    "const at = (t, d) => { const r = resolveAt(t, d); return r.ok ? formatUtcIso(r.utcMs) : 'ERR' }",
    "const lines = [at('20:00:00', '2026-10-18'), at('20:00:02.1', '2026-10-18'), at('2026-10-19T00:00:10+09:00', undefined), at('00:00:00', '2026-03-08'), at('02:30:00', '2026-11-01'), at('23:59:59.999', '2026-12-31')]",
    'const events = []',
    "const core = createFakeCore({ snapshot: emptySnapshot(), engine: { apply: (s, e) => { events.push(e); return { state: s, effects: [] } } } })",
    "const doc = JSON.stringify({ id: 'G-ENG-901', title: 't', refs: ['R-4'], broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1' }, { id: 'b2', date: '2026-10-19', title: '2' }], events: [",
    "  { at: '20:00:00', type: 'product.register', b: 'b1', no: 1, name: 'x', price: 1 },",
    "  { at: '2026-10-19T00:30:00+09:00', type: 'chat', b: 'b1', id: 'm1', ch: 'UC', nick: 'n', text: '1', publishedAt: '23:59:59.5' },",
    "  { at: '01:00:00', type: 'sms', b: 'b2', ref: 's1', no: 1, received: '00:59' },",
    "], expect: {} })",
    "runGoldenSources({ files: [{ path: 'a.yaml', text: doc }], allowlist: { path: 'k', text: null }, core })",
    "for (const e of events.slice(0, 3)) lines.push(formatUtcIso(e.at) + (e.publishedAt === undefined ? '' : ' ' + formatUtcIso(e.publishedAt)) + (e.received === undefined ? '' : ' ' + e.received))",
    "process.stdout.write(lines.join('\\n') + '\\n')",
  ].join('\n')
  const expected = [
    '2026-10-18T11:00:00.000Z',
    '2026-10-18T11:00:02.100Z',
    '2026-10-18T15:00:10.000Z',
    '2026-03-07T15:00:00.000Z',
    '2026-10-31T17:30:00.000Z',
    '2026-12-31T14:59:59.999Z',
    '2026-10-18T11:00:00.000Z',
    '2026-10-18T15:30:00.000Z 2026-10-18T14:59:59.500Z',
    '2026-10-18T16:00:00.000Z 00:59',
  ]

  it.each(['Asia/Seoul', 'UTC', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Chatham', 'Asia/Kathmandu', 'America/St_Johns', 'Pacific/Kiritimati'])(
    'TZ=%s 자식 프로세스에서 at·publishedAt 변환과 received 원문이 같다',
    (tz) => {
      const result = node(['--input-type=module', '-e', script], { TZ: tz, LANG: 'en_US.UTF-8', LC_ALL: 'C' })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim().split('\n')).toEqual(expected)
    },
  )

  it('resolveAt: 무작위 ISO·짧은 형식이 Date.parse(같은 뜻의 ISO 문자열)와 같은 UTC 밀리초, 없는 날짜·시각·오프셋·4자리 소수는 거부', () => {
    const p2 = (n: number): string => String(n).padStart(2, '0')
    const zone = fc.oneof(
      fc.constant('Z'),
      fc.tuple(fc.constantFrom('+', '-'), fc.integer({ min: 0, max: 24 }), fc.integer({ min: 0, max: 60 })).map(([sign, h, m]) => `${sign}${p2(h)}:${p2(m)}`),
    )
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 0, max: 13 }),
        fc.integer({ min: 0, max: 32 }),
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.option(fc.stringMatching(/^[0-9]{1,4}$/)),
        zone,
        (year, month, day, hour, minute, second, fraction, offset) => {
          const text = `${String(year).padStart(4, '0')}-${p2(month)}-${p2(day)}T${p2(hour)}:${p2(minute)}:${p2(second)}${fraction === null ? '' : `.${fraction}`}${offset}`
          const lastDay = new Date(0)
          lastDay.setUTCFullYear(year, month, 0)
          const valid =
            month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            day <= lastDay.getUTCDate() &&
            hour <= 23 &&
            minute <= 59 &&
            second <= 59 &&
            (fraction === null || fraction.length <= 3) &&
            (offset === 'Z' || (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59))
          const result = resolveAt(text, undefined)
          expect(result.ok, text).toBe(valid)
          if (result.ok) expect(formatUtcIso(result.utcMs), text).toBe(new Date(Date.parse(text)).toISOString())
        },
      ),
      { numRuns: 3000 },
    )
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 1, max: 60_000 }),
        (hour, minute, second, ms, dayNumber) => {
          const base = new Date(dayNumber * 86_400_000).toISOString().slice(0, 10)
          const text = `${p2(hour)}:${p2(minute)}:${p2(second)}.${String(ms).padStart(3, '0')}`
          const result = resolveAt(text, base)
          expect(result.ok && formatUtcIso(result.utcMs), `${base} ${text}`).toBe(new Date(Date.parse(`${base}T${text}+09:00`)).toISOString())
        },
      ),
      { numRuns: 3000 },
    )
  })

  it('적대 단계는 Pacific/Honolulu에서 돈다', () => {
    expect(process.env.TZ).toBe('Pacific/Honolulu')
    expect(new Date(Date.UTC(2026, 9, 18)).getTimezoneOffset()).toBe(600)
  })
})

describe('CLI 우회 없음 (AC-S00-23, AC-S00-27 출력 결정성) — 회귀', () => {
  const CLI = join(ROOT, 'packages', 'core', 'test', 'golden', 'cli.ts')
  const withoutTiming = (out: string): string =>
    out
      .split('\n')
      .filter((line) => !line.startsWith('소요 시간:'))
      .join('\n')

  it('환경변수·작업 폴더·시간대·언어 설정을 바꿔도 출력과 종료 코드가 같다', () => {
    const base = node([CLI])
    expect(base.stdout).toMatch(/^합계: /m)
    expect(base.stdout.trim().split('\n').at(-1)).toMatch(/^소요 시간: \d+ms$/)
    const variants = [
      node([CLI], { TZ: 'Asia/Seoul', LANG: 'en_US.UTF-8', LC_ALL: 'C' }),
      node([CLI], { GOLDEN_DIR: '/tmp', GOLDEN_ALLOWLIST: '/dev/null', ALLOW_ALL: '1', KNOWN_UNIMPLEMENTED: '*', LIVEJJIM_GOLDEN: '/tmp', CI: 'true' }),
      node([CLI], {}, join(ROOT, 'tests')),
    ]
    for (const variant of variants) {
      expect(variant.status).toBe(base.status)
      expect(withoutTiming(variant.stdout)).toBe(withoutTiming(base.stdout))
    }
  }, 120_000)

  it.each([['--allow-all'], ['tests/golden'], ['--', 'x']])('CLI·pnpm 단계·verify는 인자를 거부한다: %s', (...args) => {
    expect(node([CLI, ...args]).status).toBe(2)
    expect(node([join(ROOT, 'scripts', 'verify', 'stage.mjs'), 'golden', ...args]).status).toBe(2)
    expect(node([join(ROOT, 'scripts', 'verify', 'verify.mjs'), ...args]).status).toBe(2)
  })
})
