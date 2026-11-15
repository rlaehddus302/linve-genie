// 머리 오른쪽 글자 단추 한 벌 (D-UX4-164, 사용자 지시 2026-11-16 "사진 1,2 참고해서 화면 제목 오른쪽에 있는 버튼 스타일을 수정해 (모듈화해서 전역 적용)")
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppHeader, HEADER_BUTTON, HeaderTextButton, NAV } from '../src/ui/kit/index.ts'
import { RADIUS } from '../src/ui/kit/tokens.ts'

const px = (value: string) => Number.parseFloat(value)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('머리 오른쪽 글자 단추 (D-UX4-164)', () => {
  it('둥근 캡슐 높이 34 · 글자 끝은 화면 끝에서 16 · 누르면 0.9배', () => {
    expect(HEADER_BUTTON.radius).toBe(RADIUS.pill)
    expect(HEADER_BUTTON.height).toBe(34)
    expect(HEADER_BUTTON.pressScale).toBe(0.9)
    render(<AppHeader title="라이브" onBack={() => {}} right={<HeaderTextButton label="관리" onPress={() => {}} testID="head-button" />} />)
    const style = getComputedStyle(screen.getByTestId('head-button'))
    expect(px(style.height)).toBe(34)
    // 머리 오른쪽 여백(NAV.right) + 단추 바깥 여백(음수) + 안 여백 = 글자 끝에서 화면 끝까지
    expect(NAV.right + px(style.marginRight) + px(style.paddingRight)).toBe(16)
    expect(NAV.right + px(style.marginRight)).toBe(8)
  })

  it('화면 머리 오른쪽 글자 단추는 모두 HeaderTextButton 하나만 쓴다 (칩 단추를 머리에 두지 않는다)', () => {
    const files = sources(join(import.meta.dirname, '../src')).concat(sources(join(import.meta.dirname, '../app')))
    const offenders = files.filter((file) => /<(AppHeader|NavBar)[^>]*right=\{<(ChipButton|SmallButton|SoftChip)/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
