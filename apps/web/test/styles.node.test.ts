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

interface Rule {
  readonly selector: string
  /** 감싼 @media 조건들(바깥부터). 없으면 빈 목록 */
  readonly media: readonly string[]
  readonly declarations: { property: string; value: string }[]
}

/** 주석을 뺀 CSS에서 (선택자, 감싼 @media, 선언 목록)을 꺼낸다. @media 안의 규칙은 그 조건과 함께 남긴다. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  const media: string[] = []
  let buffer = ''
  let selector: string | null = null
  for (const ch of text) {
    if (ch === '{') {
      const prelude = buffer.trim().replace(/\s+/g, ' ')
      buffer = ''
      if (prelude.startsWith('@')) media.push(prelude)
      else selector = prelude
    } else if (ch === '}') {
      if (selector === null) media.pop()
      else {
        const declarations = []
        for (const part of buffer.split(';')) {
          const colon = part.indexOf(':')
          if (colon < 0) continue
          declarations.push({ property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() })
        }
        out.push({ selector, media: [...media], declarations })
        selector = null
      }
      buffer = ''
    } else buffer += ch
  }
  return out
}

/** @media 조건이 375px 폭에서 맞지 않는가 — min-width가 375px보다 크면 휴대폰(375px)에는 닿지 않는다 */
function skipsAt375(media: readonly string[]): boolean {
  return media.some((condition) => {
    const m = /min-width:\s*(\d+(?:\.\d+)?)(px|rem|em)\b/.exec(condition)
    if (!m) return false
    const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * BASE_PX
    return px > 375
  })
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
const declarations = parsed.flatMap((rule) => rule.declarations.map((d) => ({ ...d, selector: rule.selector, media: rule.media })))

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

  it('375px 폭에서 가로 스크롤을 만드는 고정 폭·줄바꿈 금지가 없다 (375px보다 넓은 min-width @media 안의 규칙만 빼고 모두)', () => {
    const fixedLength = /(?:^|[\s(,])-?\d*\.?\d+(px|rem|em|ch|ex|pt|pc|cm|mm|in|q|vw)\b/i
    const widthProperties = new Set(['width', 'min-width', 'inline-size', 'min-inline-size', 'flex-basis'])
    const at375 = declarations.filter((d) => !skipsAt375(d.media))
    expect(at375.length).toBeGreaterThan(declarations.length / 2)
    // QL3R2 D-QL3R2-02 (5): text-wrap-mode: nowrap 규칙의 옛 브라우저 대체 white-space: nowrap만 된다 — 같은 규칙이 넘친 글을 자른다(overflow: hidden)
    const clippedNowrap = (d: (typeof at375)[number]) => {
      const same = at375.filter((other) => other.selector === d.selector && other.media.join('|') === d.media.join('|'))
      return same.some((other) => other.property === 'text-wrap-mode' && other.value === 'nowrap') && same.some((other) => other.property === 'overflow' && other.value === 'hidden')
    }
    for (const d of at375) {
      if (widthProperties.has(d.property)) expect(d.value, `${d.selector} { ${d.property}: ${d.value} }`).not.toMatch(fixedLength)
      if (d.property === 'white-space' && !(d.value === 'nowrap' && clippedNowrap(d))) expect(d.value, `${d.selector} { white-space: ${d.value} }`).not.toMatch(/nowrap|pre\b/) // QL3R2 D-QL3R2-02
    }
    // 긴 낱말(닉네임 등)도 줄을 바꿔 화면 밖으로 나가지 않는다
    expect(declarations.some((d) => d.selector === 'body' && d.property === 'overflow-wrap' && d.value === 'anywhere')).toBe(true)
  })

  it('PC 표: 칸은 띄어쓰기에서만 줄을 바꾸고 금액 칸은 한 줄(표를 그리는 48rem 이상에서) — 금액이 숫자 중간·"원" 앞에서 꺾이지 않는다 (AC-S06b-21, TE-S06b-001)', () => {
    const cells = declarations.find((d) => d.selector === '.list-table th, .list-table td' && d.property === 'overflow-wrap' && d.media.length === 0)
    expect(cells?.value).toBe('normal')
    const amount = declarations.find((d) => d.selector.split(', ').includes('.list-table td.num') && d.property === 'white-space')
    expect(amount?.value).toBe('nowrap')
    expect(amount?.media).toEqual(['@media (min-width: 48rem)'])
    // 긴 닉네임이 들어가는 이름 칸만 아무 데서나 꺾는다
    expect(declarations.find((d) => d.selector === '.list-table .cell-name' && d.property === 'overflow-wrap')?.value).toBe('anywhere')
  })

  it('@media 읽기 (테스트 도우미): 375px보다 넓은 min-width 안의 규칙만 375px 검사에서 빠진다', () => {
    expect(skipsAt375(['@media (min-width: 48rem)'])).toBe(true)
    expect(skipsAt375(['@media (min-width: 48rem) and (max-width: 74.99rem)'])).toBe(true)
    expect(skipsAt375(['@media (min-width: 400px)'])).toBe(true)
    expect(skipsAt375(['@media (min-width: 20rem)'])).toBe(false)
    expect(skipsAt375(['@media (max-width: 47.99rem)'])).toBe(false)
    expect(skipsAt375([])).toBe(false)
    const nested = rules('a { color: red; } @media (min-width: 48rem) { b { white-space: nowrap; } } c { width: 1px; }')
    expect(nested.map((rule) => [rule.selector, rule.media])).toEqual([
      ['a', []],
      ['b', ['@media (min-width: 48rem)']],
      ['c', []],
    ])
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

describe('포장 라벨 출력 결과 문장 아래 여백 (U-PL1B-01)', () => {
  // 문장이 생길 때 scrollIntoView(nearest)로 내린다 — 화면 아래 끝·휴대폰 아래 메뉴 막대(약 55px, 4rem 안) 뒤에 깔리지 않게
  const marginOf = (phone: boolean) =>
    rules(stylesCss)
      .filter((rule) => rule.selector === '.packing-print-result' && (phone ? rule.media.some((m) => m.includes('max-width: 47.99rem')) : rule.media.length === 0))
      .flatMap((rule) => rule.declarations)
      .find((declaration) => declaration.property === 'scroll-margin-bottom')?.value

  it('넓은 화면 1rem, 휴대폰은 메뉴 막대 높이(4rem)보다 큰 5rem + 안전 영역', () => {
    expect(marginOf(false)).toBe('1rem')
    expect(marginOf(true)).toBe('calc(5rem + env(safe-area-inset-bottom))')
  })
})

describe('휴대폰 되돌리기 항목 두 칸 한 줄 (D-QL3R1-12, AC-QL3R1-63)', () => {
  const mobile = (selector: string, property: string) =>
    declarations.find((d) => d.selector === selector && d.property === property && d.media.some((m) => m.includes('max-width: 47.99rem')))?.value
  const pc = (selector: string, property: string) => declarations.find((d) => d.selector === selector && d.property === property && d.media.length === 0)?.value

  it('휴대폰: 왼쪽 글 칸(줄어듦) + 오른쪽 단추 칸, 위아래 안쪽 여백 0, 줄 높이 1.25', () => {
    expect(mobile('.undo-item', 'display')).toBe('grid')
    expect(mobile('.undo-item', 'grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(mobile('.undo-item', 'grid-auto-flow')).toBe('column')
    expect(mobile('.undo-item', 'align-items')).toBe('center')
    expect(mobile('.undo-item', 'padding')).toBe('0 0.5rem')
    expect(mobile('.undo-item', 'line-height')).toBe('1.25')
    expect(mobile('.undo-text', 'display')).toBe('block')
    expect(mobile('.undo-text', 'min-width')).toBe('0')
  })

  it('PC: 글 묶음은 없는 것처럼(예전 한 줄 모양 그대로)', () => {
    expect(pc('.undo-text', 'display')).toBe('contents')
    expect(pc('.undo-item', 'display')).toBe('flex')
    expect(pc('.undo-item', 'padding')).toBe('0.25rem 0.75rem')
  })
})
