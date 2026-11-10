// D-UX4-102 (사용자 제보 2026-11-10, 아이폰·갤럭시 실기기): 상품 추가 숫자판을 빠르게 누르면 "번"·"원"이 사라지고, 4번째에 숫자가, 5자리에 쉼표가, 7자리에 숫자가 사라졌다.
// 원인 셋: ① 큰 칸이 그리기마다 LayoutAnimation을 다시 걸어, 앞 움직임이 끝나기 전 새 배치가 들어오면 Fabric이 글자 조각의 옛 투명도(0)를 다시 칠했다
// ② 숫자판 키마다 따로 누름(Pressable)을 받아, 앞 손가락을 떼기 전에 다른 키를 누르면 뒤 키는 아예 받지 않았다(누름 주인은 하나뿐)
// ③ 키를 누를 때 그리기 전의 옛 값에 이어 붙여, 다음 그리기 전에 두 번 누르면 앞 숫자가 덮였다.
// jsdom(웹)에서 볼 수 있는 것: 그리기 없이 연달아 누른 것이 모두 들어가는지, 조각 이름이 1→7자리 내내 그대로인지, 손가락 자리 → 키, 소스에 LayoutAnimation이 없는지.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { charPieces, padKeyAt, pieceSpots, typeDigits } from '../src/screens/console/ProductAdd.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

async function openAdd() {
  const world = makeWorld({ products: [] })
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
  return screen.findByRole('dialog', { name: '상품 추가' })
}

/** 다음 그리기 없이 연달아 누른다 — 한 act 안에서는 화면이 다시 그려지지 않아 누름마다 같은(처음) 함수가 불린다 */
function rapid(keys: readonly string[]) {
  const pad = screen.getByRole('group', { name: '숫자판' })
  const buttons = keys.map((key) => within(pad).getByRole('button', { name: key }))
  act(() => {
    for (const button of buttons) fireEvent.click(button)
  })
}

describe('숫자판 빠르게 누르기 (D-UX4-102)', () => {
  it('그리기 전에 연달아 누른 것도 모두 들어가고, 붙임말·쉼표가 그대로 보인다', async () => {
    const page = await openAdd()
    rapid(['1', '5'])
    expect(within(page).getByRole('status', { name: '번호 15번' })).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    rapid([...'1234567'])
    expect(within(page).getByRole('status', { name: '가격 1,234,567원' })).toBeTruthy()
    expect(within(page).getByText('1,234,567원')).toBeTruthy()
    rapid(['지우기', '지우기', '지우기'])
    expect(within(page).getByRole('status', { name: '가격 1,234원' })).toBeTruthy()
    rapid(['00', '0'])
    expect(within(page).getByRole('status', { name: '가격 1,234,000원' })).toBeTruthy()
  })

  it('넘친 한 자리까지만 받고, 그 뒤 연달아 누른 것은 받지 않는다 (D-UX4-61과 같게)', async () => {
    const page = await openAdd()
    rapid(['1', '5'])
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    rapid([...'12345678901'])
    expect(within(page).getByRole('status', { name: '가격 1,234,567,890원' })).toBeTruthy()
  })

  it('누름 하나는 옛 값이 아니라 지금 값에 이어 붙인다 (순수 계산)', () => {
    expect(typeDigits('', '0', 3)).toBe('')
    expect(typeDigits('', '7', 3)).toBe('7')
    expect(typeDigits('12', '00', 9)).toBe('1200')
    expect(typeDigits('123', 'back', 3)).toBe('12')
    expect(typeDigits('', 'back', 3)).toBe('')
    expect(typeDigits('999', '1', 3)).toBe('9991')
    expect(typeDigits('9991', '1', 3)).toBeNull()
  })

  it('1 → 7자리 내내 숫자·쉼표·붙임말 조각 이름이 그대로라 이미 있는 글자는 다시 생기지 않는다', () => {
    const digits = '1234567'
    let before: string[] = []
    for (let count = 1; count <= digits.length; count += 1) {
      const shown = Number(digits.slice(0, count)).toLocaleString('ko-KR')
      const keys = charPieces(shown, '원').map((piece) => piece.key)
      expect(keys.at(-1)).toBe('suffix')
      expect(keys.filter((key) => key === 'suffix')).toHaveLength(1)
      expect(keys.filter((key) => key.startsWith('d'))).toEqual(Array.from({ length: count }, (_, index) => `d${String(index)}`))
      expect(keys.filter((key) => key.startsWith('c'))).toEqual(count >= 7 ? ['c2', 'c1'] : count >= 4 ? ['c1'] : [])
      // 앞 자리의 조각은 모두 남는다(새로 생기는 건 끝 숫자와 새 쉼표뿐)
      for (const key of before) expect(keys).toContain(key)
      before = keys
    }
  })

  it('조각 자리는 앞 글자 폭을 더한 곳 — 폭을 아직 모르면 자리를 정하지 않는다', () => {
    const widths = new Map([['1', 10], ['2', 12], [',', 4], ['원', 20]])
    const spots = pieceSpots(charPieces('1,221', '원'), widths)
    expect(spots).not.toBeNull()
    expect([...(spots?.xs ?? new Map<string, number>()).entries()]).toEqual([['d0', 0], ['c1', 10], ['d1', 14], ['d2', 26], ['d3', 38], ['suffix', 48]])
    expect(spots?.width).toBe(68)
    expect(pieceSpots(charPieces('15', '번'), widths)).toBeNull()
  })

  it('숫자판 손가락 자리 → 키: 줄·칸으로 정하고, 숫자판 밖이면 받지 않는다', () => {
    const width = 375
    expect(padKeyAt(30, 20, width)).toBe('1')
    expect(padKeyAt(width / 2, 20, width)).toBe('2')
    expect(padKeyAt(width - 30, 20, width)).toBe('3')
    expect(padKeyAt(width / 2, 4 + 64 + 10, width)).toBe('5')
    expect(padKeyAt(30, 4 + 64 * 3 + 10, width)).toBe('00')
    expect(padKeyAt(width - 2, 4 + 64 * 3 + 60, width)).toBe('back')
    expect(padKeyAt(2, 1, width)).toBe('1')
    expect(padKeyAt(width / 2, -5, width)).toBeNull()
    expect(padKeyAt(width / 2, 4 + 64 * 4 + 5, width)).toBeNull()
    expect(padKeyAt(-1, 20, width)).toBeNull()
    expect(padKeyAt(30, 20, 0)).toBeNull()
  })

  it('큰 칸은 LayoutAnimation을 쓰지 않고, 숫자판은 손가락마다 따로 받는다 (소스)', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/screens/console/ProductAdd.tsx'), 'utf8')
    // 주석의 옛 이름은 괜찮다 — 가져오기와 부르기가 없어야 한다
    expect(source).not.toMatch(/LayoutAnimation\s*\.\s*\w/)
    expect(source).not.toMatch(/import\s*\{[^}]*\bLayoutAnimation\b[^}]*\}\s*from 'react-native'/)
    expect(source).toContain('onResponderStart')
    expect(source).toContain('changedTouches')
  })
})
