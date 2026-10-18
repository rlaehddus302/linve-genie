// @vitest-environment node
// 스타일 검사 (AC-S00-50, AC-S00-51, UX-01)
// - 기본 글자 16px 이상: 모든 font-size 선언이 16px(=1rem, 브라우저 기본값 기준) 이상이다.
// - 외부 글꼴·외부 리소스 없음.
// - 375px 폭에서 가로 스크롤을 만드는 고정 폭이 없다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cssUrls } from './urls.ts'

// Vitest는 CSS를 import하면 내용을 비워 버리므로(?raw 포함) 파일을 직접 읽는다
const stylesCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

const BASE_PX = 16

/** 주석을 뺀 CSS에서 (선택자, 선언 목록)을 꺼낸다. 중첩 규칙(@media 등)이 생기면 이 도우미도 함께 고친다. */
function rules(css: string): { selector: string; declarations: { property: string; value: string }[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = []
    for (const part of (match[2] ?? '').split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      declarations.push({ property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() })
    }
    out.push({ selector: (match[1] ?? '').trim().replace(/\s+/g, ' '), declarations })
  }
  return out
}

/** 글자 크기 값의 최소 px(기본 16px 기준). 모르는 표기는 NaN이라 검사가 실패한다. */
function minFontPx(value: string): number {
  const v = value.trim().toLowerCase()
  const fn = /^(max|min|clamp)\((.*)\)$/.exec(v)
  if (fn) {
    const args = splitArgs(fn[2] ?? '').map(minFontPx)
    if (args.some(Number.isNaN)) return Number.NaN
    if (fn[1] === 'max') return Math.max(...args)
    if (fn[1] === 'min') return Math.min(...args)
    // clamp(최소, 선호, 최대): 아무리 작아도 최소값
    return args.length === 3 ? (args[0] ?? Number.NaN) : Number.NaN
  }
  const m = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em|%)$/.exec(v)
  if (!m) return Number.NaN
  const n = Number(m[1])
  if (m[2] === 'px') return n
  if (m[2] === '%') return (n / 100) * BASE_PX
  return n * BASE_PX
}

function splitArgs(text: string): string[] {
  const args: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      args.push(current)
      current = ''
    } else current += ch
  }
  args.push(current)
  return args
}

const parsed = rules(stylesCss)
const declarations = parsed.flatMap((rule) => rule.declarations.map((d) => ({ ...d, selector: rule.selector })))

describe('styles.css', () => {
  it('규칙을 읽었다 (검사가 빈 목록으로 통과하지 않게)', () => {
    expect(parsed.length).toBeGreaterThan(0)
    expect(declarations.filter((d) => d.property === 'font-size').length).toBeGreaterThanOrEqual(2)
  })

  it('html의 기본 글자는 16px 이상이고, 사용자가 키운 브라우저 글자 크기를 따른다', () => {
    const html = declarations.filter((d) => d.selector === 'html' && d.property === 'font-size')
    expect(html).toHaveLength(1)
    expect(html[0]?.value).toBe('max(100%, 16px)')
  })

  it('body 글자 크기가 정해져 있다', () => {
    expect(declarations.filter((d) => d.selector === 'body' && d.property === 'font-size')).toHaveLength(1)
  })

  it('모든 글자 크기가 16px 이상이다', () => {
    const fontSizes = declarations.filter((d) => d.property === 'font-size' || d.property === 'font')
    for (const d of fontSizes) {
      expect(d.property, `${d.selector}: font 줄임 표기 대신 font-size를 쓴다`).toBe('font-size')
      const px = minFontPx(d.value)
      expect(px, `${d.selector} { font-size: ${d.value} }`).toBeGreaterThanOrEqual(BASE_PX)
    }
  })

  it('외부 글꼴·외부 리소스를 부르지 않는다', () => {
    expect(stylesCss).not.toMatch(/@font-face|@import/i)
    expect(cssUrls(stylesCss)).toEqual([])
  })

  it('375px 폭에서 가로 스크롤을 만드는 고정 폭·줄바꿈 금지가 없다', () => {
    const fixedLength = /(?:^|[\s(,])-?\d*\.?\d+(px|rem|em|ch|ex|pt|pc|cm|mm|in|q|vw)\b/i
    const widthProperties = new Set(['width', 'min-width', 'inline-size', 'min-inline-size', 'flex-basis'])
    for (const d of declarations) {
      if (widthProperties.has(d.property)) expect(d.value, `${d.selector} { ${d.property}: ${d.value} }`).not.toMatch(fixedLength)
      if (d.property === 'white-space') expect(d.value, `${d.selector} { white-space: ${d.value} }`).not.toMatch(/nowrap|pre\b/)
    }
    // 긴 낱말(닉네임 등)도 줄을 바꿔 화면 밖으로 나가지 않는다
    expect(declarations.some((d) => d.selector === 'body' && d.property === 'overflow-wrap' && d.value === 'anywhere')).toBe(true)
  })

  it('폭 제한은 max-width로만 한다', () => {
    const page = declarations.filter((d) => d.selector === '.page')
    expect(page.find((d) => d.property === 'max-width')?.value).toBe('40rem')
    expect(page.some((d) => d.property === 'width')).toBe(false)
  })
})

describe('글자 크기 계산 (테스트 도우미)', () => {
  it.each([
    ['16px', 16],
    ['15px', 15],
    ['1rem', 16],
    ['0.875rem', 14],
    ['.9em', 14.4],
    ['1.125rem', 18],
    ['100%', 16],
    ['87.5%', 14],
    ['max(100%, 16px)', 16],
    ['max(80%, 14px)', 14],
    ['min(2rem, 15px)', 15],
    ['clamp(1rem, 2.5vw, 2rem)', Number.NaN],
    ['clamp(1rem, 1.5rem, 2rem)', 16],
    ['small', Number.NaN],
    ['larger', Number.NaN],
    ['calc(1rem + 1px)', Number.NaN],
  ])('%s → %s', (value, px) => {
    expect(minFontPx(value)).toBe(px)
  })
})
