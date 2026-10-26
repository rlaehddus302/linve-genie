// @vitest-environment node
// QL3R2 스타일 검사 — 줄을 바꾸지 않는 규칙의 옛 브라우저 대체(D-QL3R2-02 (5), AC-QL3R2-13), 짧은 줄 여백(D-QL3R2-02 (3)).
// 화면 모양(높이 40%·잘림 없음)은 E2E가 잰다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** 가장 안쪽 규칙(선택자 { 선언 })들 — 미디어·컨테이너 안도 포함 */
function rules(text: string): { readonly selector: string; readonly body: string }[] {
  const found: { selector: string; body: string }[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' })
  return found
}

describe('text-wrap-mode: nowrap 앞에 white-space: nowrap (AC-QL3R2-13)', () => {
  const nowrap = rules(css).filter((rule) => /text-wrap-mode:\s*nowrap/.test(rule.body))

  it('그런 규칙이 있다 — 요약 한 줄·접힌 띠 글 포함', () => {
    expect(nowrap.length).toBeGreaterThanOrEqual(4)
    expect(nowrap.some((rule) => rule.selector === '.current-summary')).toBe(true)
    expect(nowrap.some((rule) => rule.selector.includes('.alert-item-text'))).toBe(true)
    expect(nowrap.some((rule) => rule.selector.includes('.alert-lead-text'))).toBe(true)
  })

  it('규칙마다 같은 규칙 안, text-wrap-mode보다 앞에 white-space: nowrap', () => {
    for (const rule of nowrap) {
      const white = rule.body.search(/white-space:\s*nowrap/)
      const mode = rule.body.search(/text-wrap-mode:\s*nowrap/)
      expect({ selector: rule.selector, ok: white >= 0 && white < mode }).toEqual({ selector: rule.selector, ok: true })
    }
  })
})

describe('짧은 줄 여백 (D-QL3R2-02 (3))', () => {
  it('위 간격·안쪽 위아래 여백 0.25rem — 누르는 곳 44px은 .button min-height 2.75rem', () => {
    expect(css).toMatch(/\.alert-bar:has\(> \.alert-short-row\)\s*\{[^}]*row-gap:\s*0\.25rem;/)
    expect(css).toMatch(/\.alert-bar:not\(\.alert-bar-open\) > \.alert-short-row\s*\{[^}]*padding-block:\s*0\.25rem;/)
    expect(css).toMatch(/\n\.button\s*\{[^}]*min-height:\s*2\.75rem;/)
  })
})
