// R-3 정규화 공용 도구 (R-14 1, R-16 1이 같은 정규화를 쓴다). 공백 집합을 구현과 따로 적은 목록으로 확인한다.
import { describe, expect, it } from 'vitest'
import { normalizeText } from '../../src/parse/text.ts'

/**
 * 공백으로 보는 글자: 탭·줄바꿈 등 제어 공백, 스페이스, NBSP, U+1680, U+2000~U+200A, 줄·문단 구분자, U+202F, U+205F, 전각 공백.
 * U+FEFF(폭 없는 비분리 공백)는 유니코드 White_Space가 아니고 화면에 보이지 않으므로 공백이 아니다(TD-S01-001).
 */
const SPACE_CODE_POINTS: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000,
])

describe('normalizeText (R-3 정규화)', () => {
  it('BMP 모든 글자: 숫자 사이에서 공백 한 칸이 되는 것은 공백 목록뿐이고, 앞뒤에서 지워지는 것도 같다', () => {
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue
      const char = String.fromCharCode(code)
      const isSpace = SPACE_CODE_POINTS.has(code)
      const between = normalizeText(`1${char}5`)
      const around = normalizeText(`${char}15${char}`)
      if (isSpace) {
        expect(between, code.toString(16)).toBe('1 5')
        expect(around, code.toString(16)).toBe('15')
      } else {
        // 공백이 아닌 글자는 그대로 남는다(전각 숫자만 반각으로 바뀐다)
        expect(between, code.toString(16)).not.toBe('1 5')
        expect(around, code.toString(16)).not.toBe('15')
      }
    }
  })

  it('U+FEFF는 어디에 있든 그대로 남는다', () => {
    const zwnbsp = String.fromCodePoint(0xfeff)
    expect(normalizeText(`1${zwnbsp}5`)).toBe(`1${zwnbsp}5`)
    expect(normalizeText(`${zwnbsp}15${zwnbsp}`)).toBe(`${zwnbsp}15${zwnbsp}`)
    expect(normalizeText(` ${zwnbsp} `)).toBe(zwnbsp)
  })

  it('연속 공백 한 칸, 앞뒤 공백 제거, 전각 숫자 반각', () => {
    expect(normalizeText('  15 \t\n 번  ')).toBe('15 번')
    expect(normalizeText('１５　２８')).toBe('15 28')
    expect(normalizeText(' ')).toBe('')
    expect(normalizeText('\t\n')).toBe('')
    expect(normalizeText('')).toBe('')
    expect(normalizeText('15')).toBe('15')
  })
})
