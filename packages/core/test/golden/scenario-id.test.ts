// AC-N2-80 (D-N2-13): 시나리오 ID 형식 계약 — `G-ENG-` + 세 자리, 또는 `G-ENG-<스프린트 ID>-<두 자리>`
// (스프린트 ID = 영문 대문자로 시작하는 영문·숫자 1~8자). 그 밖은 여전히 읽기 오류이고 오류 문장이 두 형식을 말한다.
import { describe, expect, it } from 'vitest'
import { SCENARIO_ID_RE } from './contract.ts'
import { run, scenario } from './test-helpers.ts'

const ACCEPTED = ['G-ENG-001', 'G-ENG-999', 'G-ENG-N2-01', 'G-ENG-Y1-99', 'G-ENG-S06b-10', 'G-ENG-ABCDEFGH-00', 'G-ENG-N-01']
const REJECTED = ['G-ENG-N2-1', 'G-ENG-n2-01', 'G-ENG-N2-001', 'G-ENG-1234', 'G-ENG-N2_01', 'G-ENG-01', 'G-ENG-ABCDEFGHI-01', 'G-ENG-2N-01', 'G-ENG--01', 'g-eng-001', 'G-ENG-N2-01 ']

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
