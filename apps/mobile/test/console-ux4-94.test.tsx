// 라이브 관리 화면 (D-UX4-94, 사용자 지시 2026-11-10 "섹션 및 섹션 라벨을 없애고 전체 배경을 흰색으로 … 폰트의 색, 크기, 두께, 위치, 상하좌우 여백 등을 사진1 기준으로 … 듣기 섹션 기능(휴대폰 마이크로 듣기, 음성 설정) 지워"):
// 토스 "비밀번호 · 보안"처럼 흰 바탕 · 큰 제목 22 굵게 · 묶음 없이 줄만(17 보통 #4F545E, 화면 끝에서 24, 높이 44), 오른쪽 값 16 · › #90969E.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen, MANAGE_LABEL } from '../src/screens/ConsoleScreen.tsx'
import { PLAIN } from '../src/screens/console/parts.tsx'
import { PALETTE, TYPE } from '../src/ui/kit/tokens.ts'
import { makeWorld } from './screen-support.tsx'
import { flush, product } from './support.ts'

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

async function openManage() {
  const world = makeWorld({ products: [product(15)] })
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openLabels={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  fireEvent.click(screen.getByRole('button', { name: MANAGE_LABEL }))
  return screen.findByRole('dialog', { name: MANAGE_LABEL })
}

describe('라이브 관리 — 흰 바탕 토스 설정 줄 (D-UX4-94)', () => {
  it('흰 바탕 · 맨 위 큰 제목 · 묶음과 묶음 이름이 없다 · 듣기 줄(휴대폰 마이크로 듣기·음성 설정)이 없다', async () => {
    const page = await openManage()
    expect(getComputedStyle(page).backgroundColor).toBe(rgb(PALETTE.light.surface))
    const title = within(page).getByRole('heading', { level: 1, name: MANAGE_LABEL })
    expect(getComputedStyle(title).fontSize).toBe(`${String(TYPE.pageTitle)}px`)
    expect(TYPE.pageTitle).toBe(22)
    expect(within(page).queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(within(page).queryAllByRole('group').filter((group) => group.getAttribute('aria-label') !== null)).toHaveLength(0)
    expect(page.textContent).not.toContain('휴대폰 마이크로')
    expect(page.textContent).not.toContain('음성 설정')
  })

  it('줄 글자는 17 · 보통 · #4F545E, 오른쪽 값은 16, 줄 높이 44, 글자는 화면 끝에서 24', async () => {
    const page = await openManage()
    const row = within(page).getByTestId('dock-choice')
    const label = within(row).getAllByText(/./)[0]!
    expect(getComputedStyle(label).fontSize).toBe('17px')
    expect(getComputedStyle(label).color).toBe(rgb(PLAIN.ink))
    expect(getComputedStyle(row).minHeight).toBe(`${String(PLAIN.row)}px`)
    const style = getComputedStyle(row)
    expect(parseFloat(style.marginLeft) + parseFloat(style.paddingLeft)).toBe(PLAIN.side)
  })
})
