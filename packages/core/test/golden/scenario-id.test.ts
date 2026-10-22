// AC-N2-80 (D-N2-13): 시나리오 ID 형식 계약 — `G-ENG-` + 세 자리, 또는 `G-ENG-<스프린트 ID>-<두 자리>`
// (스프린트 ID = 영문 대문자로 시작하는 영문·숫자 1~8자, 뒤에 `-` + 숫자 1~2자리를 한 번 — D-N2b-2-12, AC-N2b-2-90). 그 밖은 여전히 읽기 오류이고 오류 문장이 두 형식을 말한다.
// AC-N3-04 (D-N3-01): 병렬 트랙 N3의 같은 형식 시험 — 합치기(N3 + main)에서 형식은 먼저 합친 D-N2-13(스프린트 ID 1~8자)을 따른다.
//   N3가 거절하던 'G-ENG-N-01'(스프린트 ID 한 자)·'G-ENG-NABCD-01'(다섯 자)은 D-N2-13에서 받는 ID라 받는 예로 옮겼다. 나머지 거절 예·허용 목록·중복 시험은 그대로다.
//   N2b-2 합치기(main 066480c): 형식은 D-N2b-2-12(뒤에 `-` + 숫자 1~2자리 한 번)까지 넓힌 것을 따르고, N3 받는 예·거절 예는 그 형식에서도 그대로 맞다.
import { describe, expect, it } from 'vitest'
import { patternToRegExp } from './allowlist.ts'
import { SCENARIO_ID_RE } from './contract.ts'
import { createFakeCore } from './fake-core.ts'
import { run, scenario } from './test-helpers.ts'

const ACCEPTED = ['G-ENG-001', 'G-ENG-999', 'G-ENG-N2-01', 'G-ENG-Y1-99', 'G-ENG-S06b-10', 'G-ENG-ABCDEFGH-00', 'G-ENG-N-01', 'G-ENG-N2b-2-01', 'G-ENG-N2b-12-99']
const REJECTED = ['G-ENG-N2-1', 'G-ENG-n2-01', 'G-ENG-N2-001', 'G-ENG-1234', 'G-ENG-N2_01', 'G-ENG-01', 'G-ENG-ABCDEFGHI-01', 'G-ENG-2N-01', 'G-ENG--01', 'g-eng-001', 'G-ENG-N2-01 ', 'G-ENG-N2b-2-1', 'G-ENG-N2b-2-3-01', 'G-ENG-N2b-123-01', 'G-ENG-N2b--01', 'G-ENG-N2b-x-01']

describe('시나리오 ID 형식 (AC-N2-80, D-N2-13)', () => {
  for (const id of ACCEPTED) {
    it(`${id}는 받는다`, () => {
      expect(SCENARIO_ID_RE.test(id)).toBe(true)
      const report = run(scenario({ id }))
      expect(report.readErrors).toEqual([])
      expect(report.totals.scenarios).toBe(1)
    })
  }

  for (const id of REJECTED) {
    it(`${JSON.stringify(id)}는 읽기 오류다`, () => {
      expect(SCENARIO_ID_RE.test(id)).toBe(false)
      const report = run(scenario({ id }))
      expect(report.totals.readError).toBe(1)
      expect(report.ok).toBe(false)
      const message = report.readErrors[0]?.issues.find((issue) => issue.message.includes('시나리오 ID 형식 오류'))?.message ?? ''
      expect(message).toContain('G-ENG-세 자리')
      expect(message).toContain('G-ENG-<스프린트 ID>-두 자리')
    })
  }
})

const N3_ACCEPTED = ['G-ENG-001', 'G-ENG-999', 'G-ENG-N3-01', 'G-ENG-N3-99', 'G-ENG-I1-00', 'G-ENG-S06b-12', 'G-ENG-P2-07', 'G-ENG-Ab1-01', 'G-ENG-N-01', 'G-ENG-NABCD-01']
const N3_REJECTED = [
  'G-ENG-1',
  'G-ENG-01',
  'G-ENG-0001',
  'G-ENG-N3-1',
  'G-ENG-n3-01',
  'G-ENG-N3-001',
  'G-ENG-3N-01',
  'G-ENG-N3_01',
  'G-ENG-N3-01 ',
  'G-ENG-Ｎ3-01',
  'g-eng-001',
  'G-ENG-',
]

describe('시나리오 ID 형식 (AC-N3-04)', () => {
  it('받는 예', () => {
    for (const id of N3_ACCEPTED) {
      expect(SCENARIO_ID_RE.test(id), id).toBe(true)
      const report = run(scenario({ id }), { core: createFakeCore() })
      expect(report.readErrors, id).toEqual([])
      expect(report.totals.scenarios, id).toBe(1)
      expect(report.items.map((item) => (item.kind === 'scenario' ? item.id : null)), id).toEqual([id])
    }
  })

  it('거절하는 예는 읽기 오류 (시나리오 ID 형식 오류)', () => {
    for (const id of N3_REJECTED) {
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
