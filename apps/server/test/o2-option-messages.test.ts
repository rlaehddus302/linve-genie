// D-O2-13 옵션 입력 오류 문장: 코어 checkEvent 문제 → 판매자 문장 (messages-options.ts). 코어 문장의 열쇠말이 바뀌면 여기서 걸린다.
import { checkEvent, initEngine, applyEvent, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { easyProblems } from '../src/messages.ts'
import { OPTION_MESSAGES } from '../src/messages-options.ts'

const AT = Date.UTC(2026, 9, 19, 3, 0, 0)

function world(): EngineState {
  let state = initEngine({ broadcasts: [], settings: {} })
  let seq = 0
  const apply = (event: Record<string, unknown>) => {
    state = applyEvent(state, { ...event, seq: ++seq, at: AT } as unknown as EngineEvent).state
  }
  apply({ type: 'broadcast.start', b: 'opt', date: '2026-10-19', title: '옷', settings: { 'claim.parseMode': 'OPTIONS', 'claim.maxQuantity': 5 } })
  apply({ type: 'broadcast.start', b: 'num', date: '2026-10-19', title: '다육' })
  apply({ type: 'product.register', b: 'opt', no: 1, name: '티', price: 10000, options: [{ name: '색상', choices: [{ label: '흰색' }, { label: '검정' }] }, { name: '크기', choices: [{ label: '대' }, { label: '소' }] }] })
  apply({ type: 'product.register', b: 'opt', no: 2, name: '컵', price: 3000 })
  return state
}

function messagesOf(state: EngineState, event: Record<string, unknown>): { field: string | null; message: string }[] {
  const full = { ...event, seq: 99, at: AT }
  const problems = checkEvent(state, full)
  expect(problems.length, JSON.stringify(event)).toBeGreaterThan(0)
  return easyProblems(problems, full, state).map(({ field, message }) => ({ field, message }))
}

const many = (n: number, prefix = 'c') => Array.from({ length: n }, (_, i) => ({ label: `${prefix}${String(i)}` }))

describe('D-O2-13 옵션 입력 오류 문장 표', () => {
  const state = world()
  const cases: [string, Record<string, unknown>, { field: string | null; message: string }[]][] = [
    ['항목 4개', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [1, 2, 3, 4].map((i) => ({ name: `항목${String(i)}`, choices: [{ label: `x${String(i)}` }] })) }, [{ field: 'options', message: OPTION_MESSAGES.tooManyItems }]],
    ['변형 101개', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: many(11, 'a') }, { name: '나', choices: many(10, 'b') }] }, [{ field: 'options', message: OPTION_MESSAGES.tooManyVariants }]],
    ['선택지 21개', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: many(21) }] }, [{ field: 'options[0].choices', message: OPTION_MESSAGES.choices }]],
    ['항목 이름 11자', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가'.repeat(11), choices: [{ label: 'x' }] }] }, [{ field: 'options[0].name', message: OPTION_MESSAGES.itemName }]],
    ['선택지 이름에 /', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: 'S/M' }] }] }, [{ field: 'options[0].choices[0].label', message: OPTION_MESSAGES.choiceWord }]],
    ['선택지 21자', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: 'x'.repeat(21) }] }] }, [{ field: 'options[0].choices[0].label', message: OPTION_MESSAGES.choiceWord }]],
    ['가격 차이 1.5', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: 'x', price: 1.5 }] }] }, [{ field: 'options[0].choices[0].price', message: OPTION_MESSAGES.choicePrice }]],
    ['가격 차이 1,000,001', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: 'x', price: 1_000_001 }] }] }, [{ field: 'options[0].choices[0].price', message: OPTION_MESSAGES.choicePrice }]],
    ['선택지 별칭 11개', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: 'x', aliases: many(11, 'y').map((c) => c.label) }] }] }, [{ field: 'options[0].choices[0].aliases', message: OPTION_MESSAGES.choiceAliases }]],
    ['항목 이름 겹침', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '색', choices: [{ label: 'x' }] }, { name: '색', choices: [{ label: 'y' }] }] }, [{ field: 'options[1].name', message: OPTION_MESSAGES.duplicate('색') }]],
    ['변형 재고 음수', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: 'x' }] }], stocks: { x: -1 } }, [{ field: 'stocks', message: OPTION_MESSAGES.stockValue }]],
    ['옵션 없는 상품의 변형 재고', { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, stocks: { x: 1 } }, [{ field: 'stocks', message: OPTION_MESSAGES.stocksWithoutOptions }]],
    ['상품 수정 가격으로 단가 0 아래', { type: 'product.update', b: 'opt', no: 1, price: -1 }, [{ field: 'price', message: '가격은 0 이상의 정수(원)로 적어 주세요.' }]],
    ['빠진 항목 둘', { type: 'host.assign', b: 'opt', no: 1, buyer: 'UC1', reason: 'r', options: { 색상: '흰색' } }, [{ field: 'options', message: '크기을(를) 골라 주세요.' }]],
    ['없는 선택지', { type: 'sms', b: 'opt', no: 1, ref: 'r1', received: '12:00', options: { 색상: '빨강', 크기: '대' } }, [{ field: 'options', message: '색상을(를) 골라 주세요.' }]],
    ['옵션 없는 상품에 옵션', { type: 'sms', b: 'opt', no: 2, ref: 'r1', received: '12:00', options: { 색상: '흰색' } }, [{ field: 'options', message: OPTION_MESSAGES.noOptionsProduct }]],
    ['고른 옵션 모양', { type: 'host.cancel', b: 'opt', no: 1, buyer: 'UC1', reason: 'r', options: ['흰색'] }, [{ field: 'options', message: OPTION_MESSAGES.pickShape }]],
    ['수량 상한 5', { type: 'sms', b: 'opt', no: 2, ref: 'r1', received: '12:00', qty: 6 }, [{ field: 'qty', message: '수량은 1부터 5까지예요.' }]],
    ['번호 방송의 고른 옵션', { type: 'host.cancel', b: 'num', no: 1, buyer: 'UC1', reason: 'r', options: { 색상: '흰색' } }, [{ field: 'options', message: OPTION_MESSAGES.notOptionBroadcast }]],
    ['번호 방송의 별칭', { type: 'product.register', b: 'num', no: 1, name: 'a', price: 1, aliases: ['가'] }, [{ field: 'aliases', message: OPTION_MESSAGES.notOptionBroadcast }]],
    ['번호 방송의 지우기', { type: 'host.dismissReview', b: 'num', item: 'm1' }, [{ field: 'type', message: OPTION_MESSAGES.notOptionBroadcast }]],
  ]
  for (const [name, event, expected] of cases) {
    it(name, () => {
      expect(messagesOf(state, event)).toEqual(expected)
    })
  }

  it('문장에 영어 칸 이름·코어 개발 문장이 없다 (모든 문장)', () => {
    const texts = Object.values(OPTION_MESSAGES).map((value) => (typeof value === 'function' ? (value as (x: never) => string)(['사이즈'] as never) : value))
    for (const text of texts) {
      expect(text).not.toMatch(/[A-Za-z]{2,}/)
      expect(text).toMatch(/[.요]$/)
    }
  })

  it('휴대폰 번호처럼 보이는 겹친 말은 문장에 넣지 않는다', () => {
    const event = { type: 'product.register', b: 'opt', no: 9, name: 'a', price: 1, options: [{ name: '가', choices: [{ label: '01012345678' }, { label: '010 1234 5678' }] }] }
    const out = messagesOf(state, event)
    expect(out.map((problem) => problem.message)).not.toContain(OPTION_MESSAGES.duplicate('010 1234 5678'))
    expect(JSON.stringify(out)).not.toMatch(/1234/)
  })
})
