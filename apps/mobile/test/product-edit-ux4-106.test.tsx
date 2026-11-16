import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { EDIT_DONE, editPlan } from '../src/screens/console/ProductEdit.tsx'
import { makeWorld } from './screen-support.tsx'
import { changes, flush, product } from './support.ts'

async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
const followWrites = (world: ReturnType<typeof makeWorld>) => world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

async function openDetail(world: ReturnType<typeof makeWorld>, no: number) {
  await open(world)
  followWrites(world)
  fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: `상품 자세히 — ${String(no)}번` }))
  return screen.findByRole('group', { name: '상품 자세히' })
}

describe('상품 줄 (D-UX4-105)', () => {
  it('누르는 틀이 바깥 — 흰 바탕(줄 전체)이 그 안이라 꾹 누르면 흰 줄이 통째로 들어간다', async () => {
    const world = makeWorld({ products: [product(1, { name: '품종a' }), product(123, { name: '품종b' })] })
    await open(world)
    const row = within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 1번' })
    const fill = within(row).getByTestId('product-row-fill')
    expect(getComputedStyle(fill).backgroundColor).not.toBe('')
    expect(getComputedStyle(fill).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  // D-UX4-197로 바뀐 기대 (사용자 2026-11-16 "라이브 화면에서 상품 목록도 이렇게 만들어달라" — 정산서 상품별 줄과 같은 꼴).
  // 옛(D-UX4-148): "8 · 창금 · 2,000원"을 왼쪽부터 한 줄로 — 품종만 줄어들고 가격은 늘 다 보였다. 이제 왼쪽 "N번" 표 · 가운데 품종 칸(늘어남) · 오른쪽 가격(줄지 않음, 오른쪽 맞춤)
  it('왼쪽 "N번" 표 · 가운데 품종 · 오른쪽 가격 — 고정 칸 없이, 가운데 칸만 늘고 줄며 가격은 늘 다 보인다', async () => {
    await open(makeWorld({ products: [product(8, { name: '창금', price: 2000 }), product(999, { name: '삼광수박금', price: 10_000_000 })] }))
    for (const [no, name, price] of [[8, '창금', '2,000원'], [999, '삼광수박금', '10,000,000원']] as const) {
      const row = within(screen.getByRole('button', { name: `상품 자세히 — ${no}번` }))
      // D-UX4-201: "번" 없이 번호만 (옛 D-UX4-197: "N번" 표)
      expect(row.getByTestId('product-row-no').textContent).toBe(String(no))
      expect(row.getByTestId('product-row-name').textContent).toBe(name)
      expect(row.getByTestId('product-row-price').textContent).toBe(price)
      expect(row.getByTestId('product-row-line').getAttribute('aria-label')).toBe(`${no} · ${name} · ${price}`)
      expect(getComputedStyle(row.getByTestId('product-row-no')).width).not.toBe('48px')
      expect(getComputedStyle(row.getByTestId('product-row-price')).width).not.toBe('104px')
      expect(getComputedStyle(row.getByTestId('product-row-main')).flexGrow).toBe('1')
      expect(getComputedStyle(row.getByTestId('product-row-main')).flexShrink).toBe('1')
      expect(getComputedStyle(row.getByTestId('product-row-price')).flexShrink).toBe('0')
      expect(['', 'left', 'start']).toContain(getComputedStyle(row.getByText(name)).textAlign)
      expect(['right', 'end']).toContain(getComputedStyle(row.getByText(price)).textAlign)
    }
  })

  // D-UX4-201로 바뀐 기대 (사용자 "구분선도 없애고 다 사진1처럼" — 토스 거래 내역): 옛 D-UX4-197은 한 흰 둥근 카드(모서리 20) 안을 1px 선으로 나눴다.
  // 이제 흰 화면에 줄만 — 카드 모서리도 줄 사이 선도 없다
  it('상품 줄은 카드·구분선 없이 흰 화면에 바로 놓인다 (D-UX4-201)', async () => {
    await open(makeWorld({ products: [product(8, { name: '창금', price: 2000 }), product(9, { name: '라울', price: 3000 })] }))
    const list = screen.getByRole('list', { name: '상품 목록' })
    expect(['', '0', '0px']).toContain(getComputedStyle(list).borderTopLeftRadius)
    expect(within(list).getAllByRole('button')).toHaveLength(2)
    // 줄을 감싼 칸마다 줄 하나만 — 사이에 선(1px 칸)이 없다
    for (const slot of Array.from(list.children)) expect(slot.children).toHaveLength(1)
    for (const row of within(list).getAllByRole('button')) expect(['', '0', '0px']).toContain(getComputedStyle(row).borderTopLeftRadius)
    expect(getComputedStyle(screen.getByTestId('console-screen')).backgroundColor).toBe('rgb(255, 255, 255)')
  })
})

describe('상품 고치기 반 화면 판 (D-UX4-106)', () => {
  it('입력값 중 실제로 바뀐 값만 저장 대상으로 남긴다', () => {
    const base = { no: 1, name: '품종a', price: 10_000 }
    expect(editPlan(base, { price: '7000' })).toEqual({ no: null, name: null, price: 7000 })
    // 빈 칸·같은 값은 안 바꿈
    expect(editPlan(base, { no: '1', name: '  ', price: '' })).toEqual({ no: null, name: null, price: null })
  })

  it('번호·품종·가격을 오가며 입력한 후 확인을 한 번 누르면 바로 저장한다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    const detail = await openDetail(world, 15)
    expect(within(detail).getByRole('button', { name: '가격 고치기' }).textContent).toBe('12,000원')
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    const sheet = screen.getByTestId('product-sheet')
    const edit = within(sheet).getByTestId('product-edit')
    // 옛 값은 회색 자리 글 — 입력을 시작하면 사라진다
    expect(within(edit).getByRole('status', { name: '12,000원' })).toBeTruthy()
    typePad('18000')
    expect(within(edit).getByRole('status', { name: '가격 18,000원' })).toBeTruthy()
    // 품종은 현재 이름에서 한 글자만 선택해 바꿀 수 있다
    fireEvent.click(within(sheet).getByRole('button', { name: '품종 고치기' }))
    const name = within(sheet).getByRole<HTMLInputElement>('textbox', { name: '품종' })
    expect(name.value).toBe('핑크프릴')
    name.setSelectionRange(2, 3)
    const corrected = name.value.slice(0, name.selectionStart!) + '브' + name.value.slice(name.selectionEnd!)
    fireEvent.change(name, { target: { value: corrected } })
    expect(within(sheet).queryByText('품종')).toBeNull()
    expect(name.value).toBe('핑크브릴')
    expect(within(sheet).getByRole('button', { name: '품종 고치기' }).textContent).toBe('핑크프릴')

    fireEvent.click(within(sheet).getByRole('button', { name: '번호 고치기' }))
    typePad('21')
    expect(within(sheet).getByRole('button', { name: '번호 고치기' }).textContent).toBe('15번')
    fireEvent.click(within(sheet).getByRole('button', { name: EDIT_DONE }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[0]?.body).toMatchObject({ type: 'product.renumber', b: 'b1', from: 15, to: 21 })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '21', priceText: '18000원', name: '핑크브릴' })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })

  it('품종 입력에서 키보드 완료를 누르면 입력한 품종이 한 번 저장된다', async () => {
    const world = makeWorld({ products: [product(377, { name: '녹근' })] })
    const detail = await openDetail(world, 377)
    fireEvent.click(within(detail).getByRole('button', { name: '품종 고치기' }))
    const input = screen.getByLabelText('품종')
    fireEvent.change(input, { target: { value: '녹금' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
    expect(world.events.map(event => event.body)).toEqual([
      { requestId: expect.any(String), type: 'product.update', b: 'b1', no: 377, name: '녹금' },
    ])
  })

  it('수정 중 닫으면 팝업과 저장 요청 없이 닫히고, 다시 열면 이전 값이 보인다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    const detail = await openDetail(world, 15)
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('9000')
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
    await flush()
    expect(world.events).toHaveLength(0)

    // 다시 열면 처음부터 — 칸만 열었다 닫으면 묻지 않는다
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const again = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(again).getByRole('button', { name: '가격 고치기' }).textContent).toBe('12,000원')
    fireEvent.click(within(again).getByRole('button', { name: '번호 고치기' }))
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('잘못된 값이면 확인에서 오류를 보여 주고 닫으면 버린다 (100원 미만·이미 있는 번호)', async () => {
    const world = makeWorld({ products: [product(15, { price: 12_000 }), product(16)] })
    const detail = await openDetail(world, 15)
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('50')
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    expect(screen.getByText('가격은 100원 이상으로 적어 주세요.')).toBeTruthy()
    expect(screen.getByRole('group', { name: '숫자판' })).toBeTruthy()
    typePad('0')
    fireEvent.click(screen.getByRole('button', { name: '번호 고치기' }))
    typePad('16')
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    expect(screen.getByText('16번은 이미 있어요.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
    expect(world.events).toHaveLength(0)
  })
})
