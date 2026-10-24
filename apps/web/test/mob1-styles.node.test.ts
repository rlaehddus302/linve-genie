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


describe('콘솔 위 버튼 줄 (U-MOB1-01)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('콘솔 위 줄이 폭을 재는 칸이고, 줄 폭이 글자 17자 이하(큰 글씨 휴대폰)면 버튼 줄이 두 칸씩 — 칸은 0까지 줄어든다', () => {
    expect(css).toMatch(/\.console-head \{\s*container-type: inline-size;/)
    const block = /@container \(max-width: 17rem\) \{\s*\.console-actions \{([^}]*)\}/.exec(css)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/display: grid;/)
    expect(block![1]).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  })

  it('두 칸으로 줄여도 버튼 높이 44px(.button min-height 2.75rem)를 줄이지 않는다', () => {
    const block = /@container \(max-width: 17rem\) \{\s*\.console-actions \{[^}]*\}\s*\.console-actions > \.button \{([^}]*)\}/.exec(css)
    expect(block).not.toBeNull()
    expect(block![1]).not.toMatch(/min-height|height:|font-size/)
  })
})

describe('빠른 입력 예시 글 줄임 (AC-MOB1-27)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('빠른 입력칸과 예시 글은 칸보다 길면 끝을 "…"로 줄인다', () => {
    expect(css).toMatch(/\n\.quick-input \{[^}]*text-overflow: ellipsis;/)
    expect(css).toMatch(/\n\.quick-input::placeholder \{[^}]*text-overflow: ellipsis;/)
  })
})

describe('휴대폰 아래쪽 확인 창 (D-MOB1-16, AC-MOB1-06)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const block = /@media \(max-width: 47\.99rem\) \{\s*\.backdrop-phone-bottom \{([^}]*)\}\s*\.backdrop-phone-bottom > \.modal \{([^}]*)\}/.exec(css)

  it('휴대폰 폭에서만 — 창 아래 끝을 화면 아래 끝에 붙이고(아래 여백 0), 위 여백 auto라 길면 위가 잘리지 않고 스크롤', () => {
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/padding: 1rem 0 0;/)
    expect(block![2]).toMatch(/margin: auto 0 0;/)
    expect(block![2]).toMatch(/padding-bottom: calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\);/)
    // 바깥(PC 폭)에는 이 이름의 규칙이 없다 — PC는 위쪽 그대로
    const outside = css.replace(block![0], '')
    expect(outside).not.toMatch(/backdrop-phone-bottom/)
  })

  it('공통 창(.backdrop)은 그대로 위쪽 — 다른 창 자리는 바뀌지 않는다', () => {
    expect(css).toMatch(/\n\.backdrop \{[^}]*align-items: flex-start;/)
  })
})
