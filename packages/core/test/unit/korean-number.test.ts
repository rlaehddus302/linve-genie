// R-15 한글 수사 (AC-S01-30). 결과는 1..9999 또는 null.
import { describe, expect, it } from 'vitest'
import { parseKoreanNumber } from '@livejjim/core'
import { nativeReading, sinoBelowMan } from './readings.ts'

describe('AC-S01-30 한글 수사 → 번호', () => {
  it('한자어·고유어·숫자, 뒤에 번(앞 공백 허용)', () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['십오', 15],
      ['십오 번', 15],
      ['십오번', 15],
      ['백이', 102],
      ['구천구백구십구', 9999],
      ['일', 1],
      ['일천', 1000],
      ['일십', 10],
      ['열다섯', 15],
      ['스무', 20],
      ['스물', 20],
      ['스물다섯', 25],
      ['아흔아홉', 99],
      ['일흔일곱', 77],
      ['한', 1],
      ['한 번', 1],
      ['열두', 12],
      ['15번', 15],
      ['015번', 15],
      ['0015', 15],
      ['9999', 9999],
      ['  십오  번 ', 15],
      ['１５번', 15],
    ]
    for (const [input, expected] of cases) expect(parseKoreanNumber(input), input).toBe(expected)
  })

  it('거부', () => {
    const rejected = [
      '영',
      '0',
      '0000',
      '만',
      '10000',
      '00015',
      '일오',
      '오오',
      '십십',
      '백열다섯',
      '십오번 핑크프릴',
      '',
      '번',
      ' 번',
      '십오번번',
      '스무하나',
      '열열',
      '하나둘',
      '2백',
      '십 오',
      '이만',
      '핑크프릴',
      '열다섯개',
      '-15',
      '15.0',
    ]
    for (const input of rejected) expect(parseKoreanNumber(input), input).toBeNull()
  })

  it('속성: 1..9999 전부의 표준 한자어 읽기와 숫자 표기 → 원래 값', () => {
    for (let n = 1; n <= 9999; n++) {
      expect(parseKoreanNumber(sinoBelowMan(n))).toBe(n)
      expect(parseKoreanNumber(`${sinoBelowMan(n)}번`)).toBe(n)
      expect(parseKoreanNumber(String(n))).toBe(n)
      expect(parseKoreanNumber(`${String(n).padStart(4, '0')} 번`)).toBe(n)
    }
  })

  it('속성: 1..99 전부의 고유어 읽기 → 원래 값', () => {
    for (let n = 1; n <= 99; n++) {
      expect(parseKoreanNumber(nativeReading(n)), nativeReading(n)).toBe(n)
      expect(parseKoreanNumber(`${nativeReading(n)} 번`)).toBe(n)
    }
  })
})
