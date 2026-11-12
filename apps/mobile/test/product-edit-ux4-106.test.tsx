// 사용자 지시 2026-11-10:
// D-UX4-105 "상품 목록에서 품종 컬럼 시작 위치를 맞추기" · "상품 꾹 눌렀을때 흰색 영역이 움직이는게 아니라 회색 박스가 움직임 흰색 영역이 통째로 버튼 영역이어야"
// D-UX4-106 "수정할 영역을 눌렀을 때 아래팝업을 하프 화면으로 … 기존값을 플레이스홀더로 두고 입력 시작하면 날라가게 … 키보드 위에 확인 누르면 키보드만 닫기고
//   수정할까요? 묻거나 해당 화면을 내리진 마 … 화면 닫으면 팝업으로 1번 품종a 10,000원에서 ⏎ 2번 품종 b 20,000원으로 바꿀까요? 아니요 / 바꿀게요 … 바뀐부분에 포인트 컬러"
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { EDIT_DONE, EDIT_NO, editLines, editPlan, editQuestion } from '../src/screens/console/ProductEdit.tsx'
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

  it('번호와 금액의 기준 폭이 작은 값과 최대값에서 같고, 남은 칸에는 품종을 가운데에 표시한다', async () => {
    await open(makeWorld({ products: [product(8, { name: '창금', price: 2000 }), product(999, { name: '삼광수박금', price: 10_000_000 })] }))
    for (const [no, name, price] of [[8, '창금', '2,000원'], [999, '삼광수박금', '10,000,000원']] as const) {
      const row = within(screen.getByRole('button', { name: `상품 자세히 — ${no}번` }))
      expect(getComputedStyle(row.getByTestId('product-row-no')).width).toBe('48px')
      expect(getComputedStyle(row.getByTestId('product-row-price')).width).toBe('104px')
      expect(getComputedStyle(row.getByTestId('product-row-name')).flexGrow).toBe('1')
      expect(getComputedStyle(row.getByText(`${no}번`)).textAlign).toBe('center')
      expect(getComputedStyle(row.getByText(name)).textAlign).toBe('center')
      expect(getComputedStyle(row.getByText(price)).textAlign).toBe('right')
    }
  })
})

describe('상품 고치기 반 화면 판 (D-UX4-106)', () => {
  it('팝업 글: 바뀐 조각만 표시, 품종이 둘 다 없으면 뺀다', () => {
    const base = { no: 1, name: '품종a', price: 10_000 }
    const plan = editPlan(base, { no: '2', name: '품종 b', price: '20000' })
    expect(editQuestion(editLines(base, plan))).toBe('1번 품종a 10,000원에서\n2번 품종 b 20,000원으로 바꿀까요?')
    expect(editLines(base, plan).after.map((token) => token.changed)).toEqual([true, true, true])
    const priceOnly = editPlan({ no: 3, name: '', price: 5000 }, { price: '7000', no: '' })
    expect(editQuestion(editLines({ no: 3, name: '', price: 5000 }, priceOnly))).toBe('3번 5,000원에서\n3번 7,000원으로 바꿀까요?')
    expect(editLines({ no: 3, name: '', price: 5000 }, priceOnly).after.map((token) => token.changed)).toEqual([false, true])
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
    // 품종은 휴대폰 키보드 — 빈 칸, 옛 값이 자리 글
    fireEvent.click(within(sheet).getByRole('button', { name: '품종 고치기' }))
    const name = within(sheet).getByLabelText('품종')
    expect((name as HTMLInputElement).value).toBe('')
    expect(name.getAttribute('placeholder')).toBe('핑크프릴')
    fireEvent.change(name, { target: { value: '삼광색금' } })
    expect(within(sheet).queryByText('품종')).toBeNull()
    expect((name as HTMLInputElement).value).toBe('삼광색금')
    expect(within(sheet).getByRole('button', { name: '품종 고치기' }).textContent).toBe('핑크프릴')

    fireEvent.click(within(sheet).getByRole('button', { name: '번호 고치기' }))
    typePad('21')
    expect(within(sheet).getByRole('button', { name: '번호 고치기' }).textContent).toBe('15번')
    fireEvent.click(within(sheet).getByRole('button', { name: EDIT_DONE }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[0]?.body).toMatchObject({ type: 'product.renumber', b: 'b1', from: 15, to: 21 })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '21', priceText: '18000원', name: '삼광색금' })
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

  it('[아니요]면 보내지 않고 닫는다 · 바꾼 것이 없으면 묻지 않고 닫는다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    const detail = await openDetail(world, 15)
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('9000')
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 핑크프릴 12,000원에서\n15번 핑크프릴 9,000원으로 바꿀까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: EDIT_NO }))
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

  it('잘못된 값이면 [확인]·닫기 모두 막고 칸 아래 빨간 글 (100원 미만·이미 있는 번호)', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    expect(screen.getByText('16번은 이미 있어요.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('product-sheet')).toBeTruthy()
  })
})
