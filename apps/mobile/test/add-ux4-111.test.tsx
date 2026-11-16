// D-UX4-111 (사용자 지시 2026-11-10, 상품 추가 사진 둘):
// - 인풋 넣기 전에는 맨 앞에 커서가 부드럽게(페이드인·아웃) 깜빡인다
// - 00을 눌러 숫자가 넘쳐도 입력된 것을 보여 준다
// - 첫 단계(번호)가 아닌 곳에서 뒤로 가기(머리 ‹·밀어서)는 앞 단계로
// - 번호 입력 후 [다음]을 누른 짧은 순간 가격 칸에 번호가 남아 보였다(사진 1)
// - 품종이 없으면 "-" 대신 아무것도 쓰지 않는다
// - 확인 화면은 번호 → 가격 → 품종, 묻는 말과 상품 줄 사이 여백, 글 묶음은 화면 1/3 높이(사진 2)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ASK_ADD, ASK_NO, ASK_PRICE, CONFIRM_ABOVE, CONFIRM_BELOW, CONFIRM_GAP, previousStep } from '../src/screens/console/ProductAdd.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush, product } from './support.ts'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

async function openAdd(products = [] as ReturnType<typeof product>[]) {
  const world = makeWorld({ products })
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
  return { world, page: await screen.findByRole('dialog', { name: '상품 추가' }) }
}
const typePad = (digits: readonly string[]) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

describe('상품 추가 (D-UX4-111)', () => {
  it('빈 큰 칸은 맨 앞에 글자 자리 표시(서서히 깜빡임)가 있고, 치기 시작하면 없어진다', async () => {
    const { page } = await openAdd()
    expect(within(page).queryByRole('button', { name: '00' })).toBeNull()
    expect(within(page).getByRole('button', { name: '0' })).toBeTruthy()
    const empty = within(page).getByRole('status', { name: ASK_NO })
    const caret = getComputedStyle(within(empty).getByTestId('soft-cursor'))
    expect(caret.position).toBe('absolute')
    expect(caret.left).toBe('0px')
    // 묻는 말보다 앞에
    expect(empty.firstElementChild?.getAttribute('data-testid')).toBe('soft-cursor')
    typePad(['1'])
    expect(within(page).queryByTestId('soft-cursor')).toBeNull()
    // 부드럽게: 뚝 끊기는 깜빡임이 아니라 서서히(사인 곡선) 사라졌다 나타난다
    const source = read('src/screens/console/ProductAdd.tsx')
    expect(source).toContain('easing: Easing.inOut(Easing.sin)')
  })

  it('00으로 자리 수를 넘겨도 친 것을 보여 주고 빨간 글로 알린다', async () => {
    const { page } = await openAdd()
    typePad(['1'])
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad([...'1234567', '00'])
    expect(within(page).getByRole('status', { name: '가격 123,456,700원' })).toBeTruthy()
    typePad(['00'])
    // 9자리를 넘겨도(11자리) 보인다
    expect(within(page).getByRole('status', { name: '가격 12,345,670,000원' })).toBeTruthy()
    expect(within(page).getByText('가격은 9억 9,999만 9,999원까지 적을 수 있어요.')).toBeTruthy()
    // 이미 넘친 뒤에는 더 받지 않는다
    typePad(['5'])
    expect(within(page).getByRole('status', { name: '가격 12,345,670,000원' })).toBeTruthy()
  })

  it('뒤로(머리 ‹)는 첫 단계가 아니면 앞 단계로, 첫 단계면 닫는다 — 앞 단계 값은 남아 있다', async () => {
    const { page } = await openAdd()
    typePad(['1', '1'])
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).getByRole('status', { name: ASK_PRICE })).toBeTruthy()
    // 사진 1: 다음을 누른 뒤 가격 칸에 번호가 남지 않는다 — 단계마다 새 칸
    expect(within(page).queryByRole('status', { name: '번호 11번' })).toBeNull()
    expect(read('src/screens/console/ProductAdd.tsx')).toContain('<BigNumber key={step}')
    typePad(['5', '0', '0', '0'])
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    expect(screen.getByRole('dialog', { name: '상품 추가' })).toBeTruthy()
    expect(within(page).getByRole('status', { name: '번호 11번' })).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
  })

  it('앞 단계: 번호 ← 가격 ← 품종 ← 확인 (품종을 안 물으면 확인 ← 가격)', () => {
    expect(previousStep('no', true)).toBeNull()
    expect(previousStep('price', true)).toBe('no')
    expect(previousStep('name', true)).toBe('price')
    expect(previousStep('confirm', true)).toBe('name')
    expect(previousStep('confirm', false)).toBe('price')
  })

  it('밀어서 뒤로·안드로이드 뒤로·쌓인 경로 머리 ‹도 앞 단계로 (휴대폰 경로 밀기는 첫 단계가 아닐 때 끈다)', () => {
    const source = read('src/screens/console/ProductAdd.tsx')
    expect(source).toContain('useHoldRouteSwipe(!first)')
    expect(source).toContain("BackHandler.addEventListener('hardwareBackPress', () => backNow.current())")
    expect(source).toContain('if (edgeSwipeCloses(g.dx, g.vx, widthNow.current)) backNow.current()')
    expect(read('src/screens/console/StackScreens.tsx')).toContain('onBack={() => { if (stepBack.current?.() !== true) onBack() }}')
  })

  it('확인 화면: 번호 → 가격 → 품종, 묻는 말과 사이 띄움, 글 묶음은 화면 1/3 높이', async () => {
    const { page } = await openAdd()
    typePad(['1', '1'])
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad(['1', '0', '0', '0', '0'])
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    const nameInput = within(page).queryByLabelText('어떤 품종인가요?')
    if (nameInput !== null) {
      fireEvent.change(nameInput, { target: { value: '아름' } })
      fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    }
    const lines = await within(page).findByTestId('add-confirm-lines')
    const expected = nameInput === null ? ['11번', '10,000원'] : ['11번', '10,000원', '아름']
    expect(Array.from(lines.children).map((line) => line.textContent)).toEqual(expected)
    const block = within(page).getByTestId('add-confirm')
    expect(block.lastElementChild?.textContent).toBe(ASK_ADD)
    expect(CONFIRM_GAP).toBe(20)
    expect(read('src/screens/console/ProductAdd.tsx')).toContain("<View testID=\"add-confirm\" style={{ alignItems: 'center', gap: CONFIRM_GAP }}>")
    expect(CONFIRM_BELOW / (CONFIRM_ABOVE + CONFIRM_BELOW)).toBeCloseTo(2 / 3)
  })

  it('품종이 없는 상품은 목록에 "-"를 쓰지 않는다', async () => {
    const world = makeWorld({ products: [product(12, { name: '', price: 1200 })] })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    const row = within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 12번' })
    // D-UX4-201로 바뀐 기대 (사용자 "맨 왼쪽에 '번' 없이 번호만"; 옛 D-UX4-197: "12번" 표, D-UX4-148: "12 · 1,200원"): 왼쪽 번호 "12" · 오른쪽 가격만 — 품종 칸은 비고 "-"도 나눔도 없다
    expect(row.textContent).toBe('121,200원')
    expect(within(row).queryByTestId('product-row-name')).toBeNull()
  })
})
