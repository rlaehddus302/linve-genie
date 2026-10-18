// AC-S00-23: 결과 상태와 허용 목록 (D-020).
// 허용 목록은 "미구현"만 허용한다. 불일치·읽기 오류·결정성 위반·러너 오류는 목록과 상관없이 실패.
import { describe, expect, it } from 'vitest'
import { patternToRegExp } from './allowlist.ts'
import { createFakeCore, emptySnapshot } from './fake-core.ts'
import { docs, run, scenario, suiteDoc } from './test-helpers.ts'
import type { GoldenCore } from './types.ts'

/** chat 사례 2개 + 시나리오 G-ENG-001·G-ENG-010 */
const GOLDEN = docs(
  suiteDoc('chat', [
    { in: '15', out: { claims: [15] } },
    { in: '15 취소', out: { cancels: [15] } },
  ]),
  scenario({ id: 'G-ENG-001' }),
  scenario({ id: 'G-ENG-010' }),
)
const ALL = 'sprint: S00\nsuites: [chat]\nscenarios: ["G-ENG-*"]\n'

const passing = createFakeCore({
  parser: { chat: (text) => (text === '15' ? { claims: [15], cancels: [], mentions: [] } : { claims: [], cancels: [15], mentions: [] }) },
  snapshot: emptySnapshot(),
})
const mismatching = createFakeCore({ parser: { chat: () => ({ claims: [99], cancels: [], mentions: [] }) }, snapshot: emptySnapshot() })

function withEngine(engine: Partial<GoldenCore['engine']>): GoldenCore {
  return createFakeCore({ snapshot: emptySnapshot(), engine })
}

describe('허용 목록 동작 표 (AC-S00-23)', () => {
  it('목록에 있는 항목이 미구현 → 미구현(허용), 실패 아님', () => {
    const report = run(GOLDEN, { allowlist: ALL })
    expect(report.totals).toMatchObject({ parserCases: 2, scenarios: 2, notImplementedAllowed: 4, notImplementedDisallowed: 0, pass: 0 })
    expect(report.items.every((item) => item.status === 'not-implemented' && item.allowed)).toBe(true)
    expect(report.ok).toBe(true)
    expect(report.allowlist.sprint).toBe('S00')
  })

  it('목록에 없는 항목이 미구현 → 실패 (suite 하나를 빼면 그 사례 수만큼 미구현(불허))', () => {
    const report = run(GOLDEN, { allowlist: 'scenarios: ["G-ENG-*"]\n' })
    expect(report.totals).toMatchObject({ notImplementedAllowed: 2, notImplementedDisallowed: 2 })
    expect(report.items.filter((item) => item.status === 'not-implemented' && !item.allowed).map((item) => item.kind)).toEqual(['parser', 'parser'])
    expect(report.ok).toBe(false)
  })

  it('목록에 있어도 불일치는 실패', () => {
    const report = run(GOLDEN, { allowlist: ALL, core: mismatching })
    expect(report.totals).toMatchObject({ mismatch: 2, notImplementedAllowed: 0, pass: 2 })
    expect(report.ok).toBe(false)
  })

  it('목록에 있어도 읽기 오류는 실패', () => {
    const report = run(docs(GOLDEN, scenario({ id: 'G-ENG-020', expect: { prodcuts: {} } })), { allowlist: ALL })
    expect(report.totals.readError).toBe(1)
    expect(report.ok).toBe(false)
  })

  it('목록에 있어도 결정성 위반은 실패', () => {
    let calls = 0
    const core = withEngine({ start: () => ({ run: calls++ }) })
    const report = run(GOLDEN, { allowlist: ALL, core })
    expect(report.totals.determinism).toBe(2)
    expect(report.ok).toBe(false)
  })

  it('목록에 있어도 러너 오류는 실패', () => {
    const core = withEngine({
      start: () => {
        throw new TypeError('엔진 버그')
      },
    })
    const report = run(GOLDEN, { allowlist: ALL, core })
    expect(report.totals.runnerError).toBe(2)
    expect(report.items.filter((item) => item.kind === 'scenario').map((item) => item.problems[0]?.message)).toEqual([
      '미구현이 아닌 예외: TypeError: 엔진 버그',
      '미구현이 아닌 예외: TypeError: 엔진 버그',
    ])
    expect(report.ok).toBe(false)
  })

  it('목록에 있는데 통과 → 경고("허용 목록에서 빼도 됨"), 실패 아님', () => {
    const report = run(GOLDEN, { allowlist: ALL, core: passing })
    expect(report.totals).toMatchObject({ pass: 4, notImplementedAllowed: 0 })
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual([
      "허용 목록에서 빼도 됨: suite 'chat' (사례 2개 모두 통과)",
      '허용 목록에서 빼도 됨: 시나리오 G-ENG-001 (통과)',
      '허용 목록에서 빼도 됨: 시나리오 G-ENG-010 (통과)',
    ])
  })

  it('suite 일부만 통과하면 그만큼 알려 준다 (목록에서 아직 뺄 수 없음)', () => {
    const notImplemented = createFakeCore()
    const half = createFakeCore({ parser: { chat: (text, settings) => (text === '15' ? { claims: [15] } : notImplemented.parser.chat(text, settings)) } })
    const report = run(GOLDEN, { allowlist: ALL, core: half })
    expect(report.warnings).toEqual(["허용 목록 suite 'chat': 사례 1/2개 통과"])
    expect(report.ok).toBe(true)
  })

  it('목록 파일 없음 → 빈 목록 (모든 미구현이 실패)', () => {
    const report = run(GOLDEN, { allowlist: null })
    expect(report.allowlist.present).toBe(false)
    expect(report.totals).toMatchObject({ notImplementedAllowed: 0, notImplementedDisallowed: 4, readError: 0 })
    expect(report.ok).toBe(false)
  })

  it('주석만 있는 목록 = 빈 목록', () => {
    const report = run(GOLDEN, { allowlist: '# 비었다\n' })
    expect(report.totals).toMatchObject({ notImplementedDisallowed: 4, readError: 0 })
  })
})

describe('허용 목록 읽기 오류 (AC-S00-23)', () => {
  it.each([
    ['맞는 시나리오가 없는 패턴', 'scenarios: ["G-ENG-9*"]\n', "패턴 'G-ENG-9*'에 맞는 시나리오가 없다"],
    ['패턴 오타', 'scenarios: ["G-ENG_*"]\n', '맞는 시나리오가 없다'],
    ['정규식 문자는 글자 그대로 (. 은 아무 글자가 아님)', 'scenarios: ["G.ENG-001"]\n', '맞는 시나리오가 없다'],
    ['? 는 와일드카드가 아님', 'scenarios: ["G-ENG-00?"]\n', '맞는 시나리오가 없다'],
    ['모르는 suite 이름', 'suites: [chatt]\n', '모르는 suite 이름 "chatt"'],
    ['맞는 문서가 없는 suite', 'suites: [amount]\n', "suite 'amount'에 맞는 골든 문서가 없다"],
    ['모르는 키', 'suite: [chat]\n', "모르는 키 'suite'"],
    ['suites가 목록이 아님', 'suites: chat\n', 'suites는 목록이어야 한다'],
    ['scenarios가 목록이 아님', 'scenarios: "G-ENG-*"\n', 'scenarios는 목록이어야 한다'],
    ['빈 패턴', 'scenarios: [""]\n', '빈 문자열이 아닌 문자열'],
    ['문자열이 아닌 패턴', 'scenarios: [1]\n', '빈 문자열이 아닌 문자열'],
    ['패턴 중복', 'scenarios: ["G-ENG-*", "G-ENG-*"]\n', '중복'],
    ['suite 중복', 'suites: [chat, chat]\n', '중복'],
    ['sprint가 문자열이 아님', 'sprint: 0\n', 'sprint는 문자열'],
    ['맵이 아님', '- chat\n', '맵이어야 한다'],
    ['문서가 둘', 'suites: [chat]\n---\nscenarios: ["G-ENG-*"]\n', '문서 하나여야'],
    ['YAML 문법 오류', 'suites: [chat\n', ''],
    ['YAML 1.1 함정: no 는 suite 이름이 아님', 'suites: [no]\n', '모르는 suite 이름 "no"'],
  ])('%s → 읽기 오류', (_name, text, message) => {
    const report = run(GOLDEN, { allowlist: text })
    expect(report.totals.readError).toBe(1)
    const error = report.readErrors[0]
    expect(error?.label).toBe('허용 목록')
    expect(error?.file).toBe('known-unimplemented.yaml')
    expect(error?.issues.map((i) => i.message).join('\n')).toContain(message)
    expect(report.ok).toBe(false)
  })

  it('목록 오류가 있으면 아무것도 허용하지 않는다 (미구현은 모두 불허)', () => {
    const report = run(GOLDEN, { allowlist: 'suites: [chat]\nscenarios: ["G-ENG-9*"]\n' })
    expect(report.totals).toMatchObject({ readError: 1, notImplementedAllowed: 0, notImplementedDisallowed: 4 })
  })
})

describe('골든 문서의 읽기 오류가 허용 목록을 무효로 만들지 않는다 (AC-S00-22 "한 파일의 오류가 다른 파일 결과를 가리지 않는다", TD-S00-002)', () => {
  const chatFile = { path: 'parser/chat.yaml', text: suiteDoc('chat', [{ in: '15', out: { claims: [15] } }]) }
  const engineFile = { path: 'engine/01.yaml', text: scenario({ id: 'G-ENG-001' }) }
  const LIST = 'suites: [chat, amount]\nscenarios: ["G-ENG-*"]\n'
  const statuses = (report: ReturnType<typeof run>) => report.items.map((item) => [item.file, item.status, item.allowed])

  it('suite 문서의 형식 오류: 읽기 오류는 그 파일 하나, 목록의 그 suite는 "골든에 있는 suite"로 본다', () => {
    const amountFile = { path: 'parser/amount.yaml', text: suiteDoc('amount', [{ in: '만원', out: 10000 }], { unitt: 'WON' }) }
    const report = run([amountFile, chatFile, engineFile], { allowlist: LIST })
    expect(report.readErrors.map((e) => e.file)).toEqual(['parser/amount.yaml'])
    expect(statuses(report)).toEqual([
      ['engine/01.yaml', 'not-implemented', true],
      ['parser/chat.yaml', 'not-implemented', true],
    ])
    expect(report.warnings).toEqual([])
    expect(report.ok).toBe(false)
  })

  it('YAML 문법 오류로 파일 전체를 못 읽음: 맞는 문서가 없는 항목은 읽기 오류 대신 확인 보류 경고, 다른 파일의 허용은 그대로', () => {
    const broken = { path: 'parser/amount.yaml', text: 'suite: amount\ncases: [\n' }
    const report = run([broken, chatFile, engineFile], { allowlist: LIST })
    expect(report.readErrors.map((e) => e.file)).toEqual(['parser/amount.yaml'])
    expect(statuses(report)).toEqual([
      ['engine/01.yaml', 'not-implemented', true],
      ['parser/chat.yaml', 'not-implemented', true],
    ])
    expect(report.warnings).toEqual(["허용 목록 suites[1]: suite 'amount'에 맞는 골든 문서가 없다 (읽지 못한 골든 문서가 있어 확인 보류)"])
    expect(report.ok).toBe(false)
  })

  it('suite·id를 알아볼 수 없는 문서가 있으면 맞는 시나리오가 없는 패턴도 확인 보류 (그 패턴은 아무것도 허용하지 않는다)', () => {
    const unknown = { path: 'engine/02.yaml', text: 'idd: G-ENG-900\n' }
    const report = run([engineFile, unknown], { allowlist: 'scenarios: ["G-ENG-001", "G-ENG-900"]\n' })
    expect(report.readErrors.map((e) => e.file)).toEqual(['engine/02.yaml'])
    expect(statuses(report)).toEqual([['engine/01.yaml', 'not-implemented', true]])
    expect(report.warnings).toEqual(["허용 목록 scenarios[1]: 패턴 'G-ENG-900'에 맞는 시나리오가 없다 (읽지 못한 골든 문서가 있어 확인 보류)"])
  })

  it('골든을 모두 읽었으면 맞는 문서가 없는 항목은 그대로 읽기 오류 (회귀)', () => {
    const report = run([chatFile, engineFile], { allowlist: LIST })
    expect(report.readErrors.map((e) => [e.file, e.issues.map((i) => i.message)])).toEqual([
      ['known-unimplemented.yaml', ["suite 'amount'에 맞는 골든 문서가 없다"]],
    ])
    expect(report.totals.notImplementedAllowed).toBe(0)
  })

  it('정체를 아는 문서의 읽기 오류만 있으면 보류하지 않는다 (진짜로 없는 suite는 여전히 읽기 오류)', () => {
    const amountFile = { path: 'parser/amount.yaml', text: suiteDoc('amount', [{ in: '만원', out: 10000 }], { unitt: 'WON' }) }
    const report = run([amountFile, engineFile], { allowlist: 'suites: [amount, chat]\nscenarios: ["G-ENG-*"]\n' })
    expect(report.readErrors.map((e) => e.file)).toEqual(['parser/amount.yaml', 'known-unimplemented.yaml'])
    expect(report.readErrors[1]?.issues.map((i) => i.message)).toEqual(["suite 'chat'에 맞는 골든 문서가 없다"])
  })
})

describe('패턴', () => {
  it.each([
    ['G-ENG-*', 'G-ENG-001', true],
    ['G-ENG-*', 'G-ENG-', true],
    ['G-ENG-0*', 'G-ENG-010', true],
    ['G-ENG-0*', 'G-ENG-100', false],
    ['G-ENG-001', 'G-ENG-001', true],
    ['G-ENG-001', 'G-ENG-0011', false],
    ['*-001', 'G-ENG-001', true],
    ['G.ENG-001', 'GxENG-001', false],
    ['G-ENG-(0|1)*', 'G-ENG-001', false],
  ])('%s ~ %s → %s', (pattern, id, matches) => {
    expect(patternToRegExp(pattern).test(id)).toBe(matches)
  })
})

describe('"미구현"은 코어의 NotImplementedError 하나로만 판단한다', () => {
  it.each([
    ['같은 메시지의 일반 Error', new Error('아직 구현하지 않은 기능: 판정 엔진')],
    ['이름만 흉내 낸 Error', Object.assign(new Error('x'), { name: 'NotImplementedError', feature: 'x' })],
    ['문자열', 'NotImplementedError'],
    ['흉내 낸 객체', { name: 'NotImplementedError', message: '아직 구현하지 않은 기능' }],
  ])('%s → 러너 오류 (허용 목록에 있어도 실패)', (_name, thrown) => {
    const core = withEngine({
      start: () => {
        throw thrown
      },
    })
    const parserCore = createFakeCore({
      parser: {
        chat: () => {
          throw thrown
        },
      },
    })
    const engineReport = run(scenario({ id: 'G-ENG-001' }), { allowlist: 'scenarios: ["G-ENG-*"]\n', core })
    expect(engineReport.items[0]?.status).toBe('runner-error')
    expect(engineReport.ok).toBe(false)
    const parserReport = run(suiteDoc('chat', [{ in: '15', out: {} }]), { allowlist: 'suites: [chat]\n', core: parserCore })
    expect(parserReport.items[0]?.status).toBe('runner-error')
    expect(parserReport.ok).toBe(false)
  })
})
