// @vitest-environment node
// MOB1 스타일 검사 — 누름 모양(D-MOB1-02, AC-MOB1-01), 고르기 칸(D-MOB1-10, AC-MOB1-19), 넘침 막기(D-MOB1-03)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('누름 모양 (AC-MOB1-01)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  /** :hover가 든 선택자마다 감싼 @media 조건 목록 */
  function hoverRules(): { selector: string; media: string[] }[] {
    const out: { selector: string; media: string[] }[] = []
    const stack: (string | null)[] = []
    let buffer = ''
    for (const ch of css) {
      if (ch === '{') {
        const prelude = buffer.trim().replace(/\s+/g, ' ')
        buffer = ''
        if (prelude.startsWith('@')) stack.push(prelude)
        else {
          if (prelude.includes(':hover')) out.push({ selector: prelude, media: stack.filter((item): item is string => item !== null) })
          stack.push(null)
        }
      } else if (ch === '}') {
        stack.pop()
        buffer = ''
      } else buffer += ch
    }
    return out
  }

  it('styles.css의 :hover 선택자는 모두 @media (hover: hover) 안에만 있다 — 블록 밖 0개', () => {
    const found = hoverRules()
    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((rule) => !rule.media.includes('@media (hover: hover)')).map((rule) => rule.selector)).toEqual([])
  })

  it('잠긴 버튼 모양(.button:disabled)은 블록 밖에도 그대로 있다', () => {
    const outside = css.replace(/@media \(hover: hover\) \{[\s\S]*$/, '')
    expect(outside).toMatch(/\.button:disabled \{[^}]*background-color: #e8eaed/)
  })

  it('알림 버튼 올림은 .button 올림보다 센 선택자 — 빨강 #8c1d18·흰 글자, 노랑 #fdeec2·#3d2b00', () => {
    expect(css).toMatch(/\.button\.alert-item:hover:not\(:disabled\) \{\s*color: #ffffff;\s*background-color: #8c1d18;/)
    expect(css).toMatch(/\.button\.alert-item\.alert-soft:hover:not\(:disabled\) \{\s*color: #3d2b00;\s*background-color: #fdeec2;/)
  })
})

