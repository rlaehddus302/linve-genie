// AC-S04-22 입력 문제의 쉬운 문장 — 휴대폰 번호 거절은 코어 checkEvent가 붙인 code로만 고른다 (R-1, D-079 ⑥)
import { checkEvent, initEngine, type EngineEvent, type EventProblem } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { easyProblems, fieldMessage, safeFieldName } from '../src/messages.ts'

const PHONE_MESSAGE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

describe('easyProblems — 휴대폰 번호 문제 (AC-S04-22)', () => {
  it('문장은 코어 문제의 code로만 정한다 — 값을 다시 판단하지 않는다', () => {
    // 코어가 번호라고 한 칸: 값이 무엇이든 D-079 ⑥
    const flagged: EventProblem[] = [{ field: 'title', message: 'x', code: 'PHONE_NUMBER' }]
    expect(easyProblems(flagged, { type: 'broadcast.start', title: '번호 아님' })).toEqual([{ field: 'title', message: PHONE_MESSAGE }])
    // 코어가 번호라고 하지 않은 칸: 값이 번호처럼 보여도 그 칸의 보통 문장
    const plain: EventProblem[] = [{ field: 'memo', message: 'x' }]
    expect(easyProblems(plain, { type: 'sms', memo: '010-1234-5678' })).toEqual([{ field: 'memo', message: '메모는 글자로 적어 주세요.' }])
    const buyer: EventProblem[] = [{ field: 'buyer', message: 'x' }]
    expect(easyProblems(buyer, { type: 'host.blockBuyer', buyer: '010-1234-5678' })).toEqual([{ field: 'buyer', message: '구매자를 골라 주세요.' }])
  })

  it('ID 칸은 번호 대신 고를 것을, 문자찜 메모는 전화번호 칸을 덧붙인다. 그 밖의 글 칸은 문장만', () => {
    const cases: readonly (readonly [string, string, string | undefined])[] = [
      ['host.blockBuyer', 'buyer', '전화번호 대신 구매자를 골라 주세요.'],
      ['buyer.merge', 'from', '전화번호 대신 구매자를 골라 주세요.'],
      ['buyer.merge', 'into', '전화번호 대신 합칠 구매자를 골라 주세요.'],
      ['host.assign', 'replace', '전화번호 대신 교체할 1등을 골라 주세요.'],
      ['host.convertMessage', 'msg', '전화번호 대신 메시지를 골라 주세요.'],
      ['sms', 'memo', '전화번호는 전화번호 칸에 적어 주세요.'],
      ['sms', 'ref', undefined],
      ['settlement.payment', 'memo', undefined],
      ['settlement.refund', 'reason', undefined],
      ['broadcast.start', 'title', undefined],
      ['product.register', 'name', undefined],
    ]
    for (const [type, field, hint] of cases) {
      const [problem] = easyProblems([{ field, message: 'x', code: 'PHONE_NUMBER' }], { type })
      expect(problem, `${type}.${field}`).toEqual(hint === undefined ? { field, message: PHONE_MESSAGE } : { field, message: PHONE_MESSAGE, hint })
    }
  })

  it('실제 코어 checkEvent 결과: 구조 문제가 먼저, 번호 문제는 그 칸의 구조 검사를 통과했을 때만 — 필드마다 하나', () => {
    const state = initEngine({ broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }], settings: {} })
    const event = { type: 'product.register', seq: 1, at: 0, b: 'b1', no: 1, name: '구피 010-1234-5678', price: -1 } as unknown as EngineEvent
    const problems = checkEvent(state, event)
    expect(problems.find((problem) => problem.field === 'name')?.code).toBe('PHONE_NUMBER')
    expect(easyProblems(problems, event as unknown as Record<string, unknown>)).toEqual([
      { field: 'price', message: '가격은 0 이상의 정수(원)로 적어 주세요.' },
      { field: 'name', message: PHONE_MESSAGE },
    ])
  })

  it('필드 이름을 되돌려 보낼 수 없어도 번호 문제 문장은 같다 (이름 없이)', () => {
    expect(easyProblems([{ field: '010-1234-5678', message: 'x', code: 'PHONE_NUMBER' }], { type: 'sms' })).toEqual([{ field: null, message: PHONE_MESSAGE }])
    expect(safeFieldName('memo01012345678')).toBeNull()
    expect(fieldMessage(null)).toBe('값을 확인해 주세요.')
  })

  it('문장에는 받은 값·영어가 없다', () => {
    const fields = ['buyer', 'from', 'into', 'replace', 'msg', 'memo', 'ref', 'reason', 'title', 'name']
    for (const field of fields) {
      for (const problem of easyProblems([{ field, message: 'x', code: 'PHONE_NUMBER' }], { type: 'sms', [field]: '010-1234-5678' })) {
        expect(`${problem.message}${problem.hint ?? ''}`).not.toMatch(/[A-Za-z]|1234/)
      }
    }
  })
})
