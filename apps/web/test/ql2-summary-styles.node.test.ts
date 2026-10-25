// @vitest-environment node
// QL2 3회차 스타일 검사 — 휴대폰 빈 "등록하면" 줄(D-QL2-11 (2), AC-QL2-01b), 펼친 알림 띠 모양(D-QL2-12 (1), AC-QL2-44 — 폭은 E2E가 잰다)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('휴대폰 스타일 (D-QL2-11 (2)·D-QL2-12 (1))', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const phone = css.slice(css.indexOf('@media (max-width: 47.99rem)'))
  it('빈 "등록하면" 줄은 휴대폰에서만 숨는다 — PC 쪽(미디어 밖)에는 숨기는 줄이 없다', () => {
    expect(phone).toMatch(/\.quick-will-register\[data-empty\]\s*\{\s*display:\s*none;/)
    const outside = css.slice(0, css.indexOf('@media (max-width: 47.99rem)'))
    expect(outside).not.toContain('[data-empty]')
  })

  it('펼친 알림 목록은 위아래 한 줄씩·폭 전체', () => {
    expect(phone).toMatch(/\.alert-bar-open \.alerts-list\s*\{[^}]*flex-direction:\s*column;/)
    expect(phone).toMatch(/\.alert-bar-open \.alerts\s*\{[^}]*flex:\s*1 1 100%;/)
  })
})
