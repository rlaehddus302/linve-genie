// A1 순수 함수의 골든 밖 경계 (AC-A1-06·30 응답 공격): 숫자 모양·원형 키·깊은 중첩·큰 답 — 예외 없이 제안 없음
import { describe, expect, it } from 'vitest'
import { similar, validateResponse } from '../src/assist/rules.ts'

const CATALOG = [{ no: 21, name: '반바지', options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'] }, { label: 'L' }] }] }]
const one = (line: string) => validateResponse([{ id: '1', no: 21 }], `{"suggestions":[${line}]}`, CATALOG, 10)['1']

describe('응답 검사의 숫자는 정수 글자만', () => {
  it('1e1·10.0·-0·음수·NaN 모양 글·Infinity 모양 → 제안 없음, 10은 받는다', () => {
    expect(one('{"id":"1","no":21,"options":{"사이즈":"M"},"qty":10}')).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 10 })
    for (const qty of ['1e1', '10.0', '-0', '-1', '"NaN"', '"Infinity"', '1E0', '0.5e1']) expect(one(`{"id":"1","no":21,"options":{"사이즈":"M"},"qty":${qty}}`), qty).toBeNull()
    expect(one('{"id":"1","no":2.1e1,"options":{"사이즈":"M"},"qty":1}')).toBeNull()
  })

  it('constructor·__proto__·toString 키, 깊은 중첩, 큰 답에도 예외가 없다', () => {
    expect(one('{"id":"1","no":21,"options":{"사이즈":"M"},"qty":1,"constructor":{}}')).toBeNull()
    expect(one('{"id":"1","no":21,"options":{"constructor":"M"},"qty":1}')).toBeNull()
    expect(one('{"id":"1","no":21,"options":{"사이즈":"toString"},"qty":1}')).toBeNull()
    expect(validateResponse([{ id: '1' }], '{"__proto__":{"suggestions":[]}}', CATALOG, 10)).toEqual({ '1': null })
    const deep = `{"suggestions":[${'['.repeat(5000)}${']'.repeat(5000)}]}`
    expect(validateResponse([{ id: '1' }], deep, CATALOG, 10)).toEqual({ '1': null })
    const big = `{"suggestions":[${'{"id":"1","no":21,"qty":1},'.repeat(3000)}{"id":"1","no":21,"qty":1}]}`
    expect(validateResponse([{ id: '1' }], big, CATALOG, 10)).toEqual({ '1': null })
    expect(validateResponse([{ id: '1' }], undefined, CATALOG, 10)).toEqual({ '1': null })
    expect(({} as Record<string, unknown>).suggestions).toBeUndefined()
  })
})

describe('비슷함', () => {
  it('빈 덩어리·숫자·한 글자 이름은 비슷하지 않다, 한 자모 차이는 비슷하다', () => {
    expect(similar('', '미디움')).toBe(false)
    expect(similar('4호', '1호')).toBe(false)
    expect(similar('n', 'M')).toBe(false)
    expect(similar('미디엄', '미디움')).toBe(true)
    expect(similar('Mediun', 'medium')).toBe(true)
  })
})
