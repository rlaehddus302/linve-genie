// D-UX3-88: 뒤로 옆 화면 제목이 뒤로 화살표와 수평 — Pretendard 한글이 줄 안에서 2~3 낮게 그려져 제목을 2.5 올린다(실기기 사진 재기)
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../src/ui/kit/index.ts'

describe('AppHeader 제목 높이 (D-UX3-88)', () => {
  it('뒤로가 있으면 제목 칸을 2.5 올리고, 없으면 그대로', () => {
    const view = render(<AppHeader title="찜 기록" onBack={vi.fn()} />)
    expect(getComputedStyle(screen.getByRole('heading', { name: '찜 기록' }).parentElement as HTMLElement).transform).toContain('-2.5')
    view.unmount()
    render(<AppHeader title="전체" />)
    expect(getComputedStyle(screen.getByRole('heading', { name: '전체' }).parentElement as HTMLElement).transform).not.toContain('-2.5')
  })
})
