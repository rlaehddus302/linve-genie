// D-ORDPAY-01 (판매자 요청 2026-11-20 "주문 탭에서 입금이 완료됐는지 체크 표시해 줬으면 좋겠음 (입금 목록 체크박스)"):
// 주문 목록 줄마다 맨 오른쪽 입금 체크 칸 — 다 받음은 체크, 덜 받음은 빈 칸 + "n원 남음", 빈 칸을 누르면 한 번 묻고(아니요 왼쪽·확인했어요 오른쪽)
// 남은 금액만큼 settlement.payment를 적는다(주문 상세 [확인했어요]와 같은 길). 다 받은 줄·30일 지난 날짜는 누를 수 없다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { isPaid, lackWords, SettleScreen } from '../src/screens/SettleScreen.tsx'
import { orderRow, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'

const ROWS = [
  orderRow({ date: '2026-11-11', buyer: 'u1', nickname: '다육맘', total: 31_000, received: 31_000, payment: 'PAID' }),
  orderRow({ date: '2026-11-11', buyer: 'u2', nickname: '초록손', total: 14_000, received: 4_000, payment: 'PARTIAL' }),
  orderRow({ date: '2026-11-10', buyer: 'u3', nickname: '선인장러버', total: 54_000, received: 0, payment: 'UNPAID' }),
  orderRow({ date: '2026-10-01', buyer: 'u4', nickname: '옛손님', total: 9_000, received: 0, payment: 'UNPAID', sealed: true }),
]

describe('주문 목록 입금 체크 (D-ORDPAY-01)', () => {
  it('글자 도움: 다 받음·더 받음만 체크, 덜 받음은 남은 금액', () => {
    expect(isPaid({ payment: 'PAID' })).toBe(true)
    expect(isPaid({ payment: 'OVERPAID' })).toBe(true)
    expect(isPaid({ payment: 'PARTIAL' })).toBe(false)
    expect(lackWords({ payment: 'PARTIAL', total: 14_000, received: 4_000 })).toBe('10,000원 남음')
    expect(lackWords({ payment: 'UNPAID', total: 14_000, received: 0 })).toBeNull()
  })

  it('줄마다 체크 칸: 다 받음은 체크(누를 수 없음), 덜 받음은 빈 칸과 "n원 남음", 30일 지난 날짜는 누를 수 없다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    render(w.wrap(<SettleScreen />))
    const list = await screen.findByRole('list', { name: '주문 목록' })
    const boxes = within(list).getAllByRole('checkbox')
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    expect(boxes[0]!.getAttribute('aria-label')).toBe('다육맘 입금 완료')
    expect(boxes[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(boxes[1]!.getAttribute('aria-label')).toBe('초록손 입금 확인 · 남은 금액 10,000원')
    expect(boxes[1]!.getAttribute('aria-disabled')).not.toBe('true')
    expect(within(list).getByText('10,000원 남음')).toBeTruthy()
    expect(boxes[3]!.getAttribute('aria-disabled')).toBe('true')
    // 줄 단추(상세 열기)는 그대로 — 체크 칸은 단추 목록에 섞이지 않는다
    expect(within(list).getAllByRole('button')).toHaveLength(4)
  })

  it('빈 칸을 누르면 한 번 묻고 [아니요]는 아무것도 적지 않는다, [확인했어요]는 남은 금액만큼 입금을 적는다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView(ROWS))
    render(w.wrap(<SettleScreen />))
    const list = await screen.findByRole('list', { name: '주문 목록' })
    fireEvent.click(within(list).getAllByRole('checkbox')[1]!)
    const dialog = await screen.findByRole('alertdialog', { name: '입금을 확인했나요?' })
    expect(within(dialog).getByText('초록손 · 남은 금액 10,000원을 다 받은 것으로 적어요.')).toBeTruthy()
    // 단추는 좌우로 — 부정 왼쪽, 긍정 오른쪽 (D-UX4-01)
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['아니요', '확인했어요'])
    fireEvent.click(within(dialog).getByRole('button', { name: '아니요' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '입금을 확인했나요?' })).toBeNull())
    expect(w.events).toHaveLength(0)
    fireEvent.click(within(list).getAllByRole('checkbox')[2]!)
    fireEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.body).toMatchObject({ type: 'settlement.payment', buyer: 'u3', date: '2026-11-10', amountText: '54000' })
    expect(w.events[0]!.path).toContain('date=2026-11-10')
  })
})
