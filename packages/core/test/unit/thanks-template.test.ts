// 찜 감사 채팅 양식 (D-THANKS-FMT-01): 기본 양식은 엔진 감사 문구와 글자까지 같고, 블록을 옮기거나 글자를 넣으면 그대로 바뀐다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THANKS_TEMPLATE, checkThanksTemplate, formatThanksText, isDefaultThanksTemplate, parseThanksTemplate, renderThanks, thanksTemplateSuffix, type ThanksTemplate } from '@livejjim/core'

describe('찜 감사 채팅 양식', () => {
  it('기본 양식 = formatThanksText (옵션·수량·빈 품종 포함, 아무 값이나)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.string({ maxLength: 12 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.option(fc.constantFrom('흰색/대형', '빨강', ''), { nil: null }),
        fc.integer({ min: 1, max: 99 }),
        (no, name, price, buyerName, optionText, qty) => {
          const values = { no, name, price, buyerName, optionText, qty }
          expect(renderThanks(DEFAULT_THANKS_TEMPLATE, values)).toBe(formatThanksText(values))
        },
      ),
    )
  })

  it('블록 순서·글자 블록 그대로, 빈 블록은 빠진다', () => {
    const template: ThanksTemplate = [{ k: 'buyer' }, { k: 'no' }, { k: 'name' }, { k: 'text', t: '  찜 확정이에요 ' }]
    expect(renderThanks(template, { no: 15, name: '핑크프릴', price: 10_000, buyerName: '홍길동' })).toBe('홍길동님 15번 핑크프릴 찜 확정이에요')
    expect(renderThanks(template, { no: 15, name: ' ', price: 10_000, buyerName: '홍길동', qty: 2 })).toBe('홍길동님 15번 2개 찜 확정이에요')
    expect(renderThanks([{ k: 'no' }, { k: 'price' }, { k: 'buyer' }], { no: 3, name: '라울', price: 8000, buyerName: '꽃', qty: 3 })).toBe('3번 24,000원 꽃님')
  })

  it('검사: 번호·닉네임은 꼭, 값 블록은 한 번씩, 글자는 30자·한 줄', () => {
    expect(checkThanksTemplate(DEFAULT_THANKS_TEMPLATE)).toBeNull()
    expect(checkThanksTemplate([{ k: 'no' }])).toBe('닉네임 블록은 꼭 있어야 해요.')
    expect(checkThanksTemplate([{ k: 'buyer' }])).toBe('번호 블록은 꼭 있어야 해요.')
    expect(checkThanksTemplate([{ k: 'no' }, { k: 'no' }, { k: 'buyer' }])).toBe('번호 블록은 한 번만 넣을 수 있어요.')
    expect(checkThanksTemplate([{ k: 'no' }, { k: 'buyer' }, { k: 'text', t: '가'.repeat(31) }])).toBe('글자 블록은 30자까지 적을 수 있어요.')
    expect(checkThanksTemplate([{ k: 'no' }, { k: 'buyer' }, { k: 'text', t: '가\n나' }])).toBe('글자 블록에는 줄을 바꿀 수 없어요.')
    expect(checkThanksTemplate([{ k: 'no' }, { k: 'buyer', x: 1 }])).toBe('알 수 없는 블록이 있어요.')
    expect(checkThanksTemplate({})).toBe('양식을 만들어 주세요.')
  })

  it('저장 글 읽기: 비었거나 깨졌거나 맞지 않으면 기본 양식', () => {
    expect(isDefaultThanksTemplate(parseThanksTemplate(null))).toBe(true)
    expect(isDefaultThanksTemplate(parseThanksTemplate('{'))).toBe(true)
    expect(isDefaultThanksTemplate(parseThanksTemplate('[{"k":"no"}]'))).toBe(true)
    expect(parseThanksTemplate('[{"k":"buyer"},{"k":"no"},{"k":"text","t":" 감사 "}]')).toEqual([{ k: 'buyer' }, { k: 'no' }, { k: 'text', t: '감사' }])
  })

  it('묶음 끝말: 마지막이 글자 블록이면 그 글자, 아니면 없음', () => {
    expect(thanksTemplateSuffix(DEFAULT_THANKS_TEMPLATE)).toBe(' 구매 감사합니다')
    expect(thanksTemplateSuffix([{ k: 'no' }, { k: 'buyer' }])).toBe('')
  })
})
