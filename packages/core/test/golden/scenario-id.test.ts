// AC-N3-04 (D-N3-01, README "시나리오 키"): 시나리오 ID 형식 — `G-ENG-` + 세 자리, 또는 병렬 트랙의 `G-ENG-<스프린트 ID>-<두 자리>`
// (스프린트 ID = 영문 대문자 하나 뒤 영문·숫자 1~3자). 그 밖은 지금처럼 읽기 오류다. 허용 목록 패턴은 새 ID에도 맞는다.
import { describe, expect, it } from 'vitest'
import { patternToRegExp } from './allowlist.ts'
import { SCENARIO_ID_RE } from './contract.ts'
import { createFakeCore } from './fake-core.ts'
import { run, scenario } from './test-helpers.ts'

const ACCEPTED = ['G-ENG-001', 'G-ENG-999', 'G-ENG-N3-01', 'G-ENG-N3-99', 'G-ENG-I1-00', 'G-ENG-S06b-12', 'G-ENG-P2-07', 'G-ENG-Ab1-01']
const REJECTED = [
  'G-ENG-1',
  'G-ENG-01',
  'G-ENG-0001',
  'G-ENG-N3-1',
  'G-ENG-n3-01',
  'G-ENG-N3-001',
  'G-ENG-N-01',
  'G-ENG-NABCD-01',
  'G-ENG-3N-01',
  'G-ENG-N3_01',
  'G-ENG-N3-01 ',
  'G-ENG-Ｎ3-01',
  'g-eng-001',
  'G-ENG-',
]

describe('시나리오 ID 형식 (AC-N3-04)', () => {
  it('받는 예', () => {
    for (const id of ACCEPTED) {
      expect(SCENARIO_ID_RE.test(id), id).toBe(true)
      const report = run(scenario({ id }), { core: createFakeCore() })
      expect(report.readErrors, id).toEqual([])
      expect(report.totals.scenarios, id).toBe(1)
      expect(report.items.map((item) => (item.kind === 'scenario' ? item.id : null)), id).toEqual([id])
    }
  })

  it('거절하는 예는 읽기 오류 (시나리오 ID 형식 오류)', () => {
    for (const id of REJECTED) {
      expect(SCENARIO_ID_RE.test(id), id).toBe(false)
      const report = run(scenario({ id }), { core: createFakeCore() })
      expect(report.totals.readError, id).toBe(1)
      expect(report.totals.scenarios, id).toBe(0)
      expect(JSON.stringify(report.readErrors), id).toContain('시나리오 ID 형식 오류')
      expect(report.ok, id).toBe(false)
    }
  })

  it('허용 목록 패턴 G-ENG-*·G-ENG-N3-*는 새 ID에도 맞는다 (미구현 허용 판단)', () => {
    expect(patternToRegExp('G-ENG-*').test('G-ENG-N3-01')).toBe(true)
    expect(patternToRegExp('G-ENG-N3-*').test('G-ENG-N3-02')).toBe(true)
    expect(patternToRegExp('G-ENG-N3-*').test('G-ENG-301')).toBe(false)
    // 가짜 코어의 엔진은 미구현이다 — 패턴이 맞으면 미구현(허용), 맞지 않으면 미구현(불허)
    for (const pattern of ['G-ENG-*', 'G-ENG-N3-*']) {
      const report = run(scenario({ id: 'G-ENG-N3-01' }), { allowlist: `scenarios: ["${pattern}"]\n`, core: createFakeCore() })
      expect(report.readErrors, pattern).toEqual([])
      expect(report.totals, pattern).toMatchObject({ scenarios: 1, notImplementedAllowed: 1, notImplementedDisallowed: 0 })
      expect(report.warnings.some((warning) => warning.includes('맞는 시나리오가 없다')), pattern).toBe(false)
    }
    const other = run(scenario({ id: 'G-ENG-N3-01' }), { allowlist: 'scenarios: ["G-ENG-3*"]\n', core: createFakeCore() })
    expect(other.totals).toMatchObject({ notImplementedAllowed: 0, notImplementedDisallowed: 1 })
  })

  it('같은 ID는 형식이 달라도 중복으로 잡는다 (G-ENG-N3-01 두 번)', () => {
    const report = run(`${scenario({ id: 'G-ENG-N3-01' })}---\n${scenario({ id: 'G-ENG-N3-01' })}`, { core: createFakeCore() })
    expect(JSON.stringify(report.readErrors)).toContain('시나리오 ID 중복')
  })
})
