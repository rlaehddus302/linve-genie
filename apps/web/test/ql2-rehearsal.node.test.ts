// @vitest-environment node
// QL2 4회차 스타일 검사 — 휴대폰 리허설 띠 한 줄 문장(D-QL2-13, AC-QL2-01). 한 줄인지·요약 줄이 막대 위인지는 E2E가 잰다
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('리허설 띠 (D-QL2-13)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const at = css.indexOf('.rehearsal-banner-short')
  const outside = css.slice(0, at + 200)
  const block = (() => {
    const start = css.indexOf('@media (max-width: 47.99rem)', at)
    return css.slice(start, css.indexOf('\n}\n', start))
  })()

  it('PC(미디어 밖): 휴대폰 문장은 display:none, 옛 문장은 숨기지 않는다', () => {
    expect(outside).toMatch(/\.rehearsal-banner-short\s*\{\s*display:\s*none;/)
    expect(css.slice(0, css.indexOf('@media (max-width: 47.99rem)', at))).not.toMatch(/\.rehearsal-banner-wide\s*\{[^}]*display:\s*none/)
  })

  it('휴대폰: 옛 문장 display:none·짧은 문장 보임, 여백 0.25rem·줄 높이 1.25까지, 제목의 "리허설" 꼬리표 숨김', () => {
    expect(block).toMatch(/\.rehearsal-banner-wide\s*\{\s*display:\s*none;/)
    expect(block).toMatch(/\.rehearsal-banner-short\s*\{\s*display:\s*inline;/)
    expect(block).toMatch(/\.rehearsal-banner\s*\{[^}]*padding-block:\s*0\.25rem;[^}]*line-height:\s*1\.25;/)
    expect(block).toMatch(/\.console-rehearsal \.console-title \.tag-rehearsal\s*\{\s*display:\s*none;/)
  })

  it('띠는 숨기거나 접지 않고 색·테두리·굵은 글자 그대로', () => {
    const base = /\.rehearsal-banner\s*\{([^}]*)\}/.exec(css)![1]!
    expect(base).toContain('#fff4e5')
    expect(base).toContain('#7a4100')
    expect(base).toContain('font-weight: 700')
    expect(block).not.toMatch(/\.rehearsal-banner\s*\{[^}]*display:\s*none/)
    expect(block).not.toMatch(/\.rehearsal-banner\s*\{[^}]*(white-space:\s*nowrap|overflow:\s*hidden)/)
  })
})
