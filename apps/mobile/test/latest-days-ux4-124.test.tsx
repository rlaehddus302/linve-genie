// D-UX4-124: 서버 날짜 목록(/api/days)은 오래된 날부터 온다. 앱은 가장 최근 실제 날짜를 먼저 보이고 기본으로 고른다.
// 옛 앱은 첫 줄을 가장 최근으로 여겨, 날짜가 둘 이상이면 주문·포장 탭이 가장 오래된 날로 열렸다(연습 자료로 시뮬레이터에서 찾음).
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { latestFirst } from '../src/lib/latest-days.ts'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { orderRow, ordersView, withOrders } from './order-support.ts'

describe('가장 최근 날짜 먼저 (D-UX4-124)', () => {
  it('리허설은 빼고 날짜 내림차순', () => {
    const days = [
      { date: '2026-11-09', rehearsal: false },
      { date: '2026-11-11', rehearsal: true },
      { date: '2026-11-10', rehearsal: false },
      { date: '2026-11-11', rehearsal: false },
    ]
    expect(latestFirst(days).map((day) => `${day.date}${day.rehearsal ? 'R' : ''}`)).toEqual(['2026-11-11', '2026-11-10', '2026-11-09'])
    // 받은 목록은 건드리지 않는다
    expect(days[0]?.date).toBe('2026-11-09')
  })

  // D-UX4-125 (사용자 지시 2026-11-11 '주문 탭 수정 사항')로 바뀐 기대: 주문 탭에 날짜 캡슐이 없어졌다.
  // 옛 "날짜 캡슐 첫 칸이 가장 최근 날짜, 그 날짜 범위(/api/days/11-11)를 먼저 묻는다" → 새 "날짜를 넘은 주문 목록에서 가장 최근 날짜 줄이 맨 위"
  it('주문 탭은 가장 최근 날짜 주문이 맨 위 — 날짜 목록(/api/days)으로 고르지 않는다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([orderRow({ date: '2026-11-11', buyer: 'u1', name: '김다육' }), orderRow({ date: '2026-11-10', buyer: 'u2', name: '이선인' })]))
    render(w.wrap(<SettleScreen />))
    const list = await screen.findByRole('list', { name: '주문 목록' })
    expect(within(list).getAllByRole('button').map((row) => row.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['11월 11일', '11월 10일'])
    expect(screen.queryAllByRole('button', { name: /^날짜 / })).toHaveLength(0)
    expect(w.server.callsTo('GET', /^\/api\/days(\/[\d-]+)?$/)).toHaveLength(0)
  })

  // 같은 연습 자료에서 찾음: 입금은 끝났지만 배송지가 없는 손님이 받을 돈 순서 때문에 목록 맨 아래로 갔다.
  // D-UX4-125로 바뀐 기대: 옛 "할 일 남은 손님은 다음 할 일 순서(정보 → 확인서 → 입금)로 모은다" — 할 일 묶음은 사용자가 뺐다.
  // → 새 "앱은 받을 돈 순서로 다시 줄 세우지 않고 서버 순서(최근 날짜, 같은 날짜 안에서는 첫 예약이 늦은 손님부터) 그대로"
  it('같은 날짜 안의 줄은 서버 순서 그대로 — 받을 돈으로 다시 줄 세우지 않는다', async () => {
    const w = makeWorld()
    withOrders(w, ordersView([orderRow({ buyer: 'u2', name: '초록손', total: 4_000 }), orderRow({ buyer: 'u1', name: '다육맘', total: 90_000 })]))
    render(w.wrap(<SettleScreen />))
    const list = await screen.findByRole('list', { name: '주문 목록' })
    // D-UX4-126: 줄 이름은 날짜 · 닉네임 · 성함 순 — 성함은 셋째
    expect(within(list).getAllByRole('button').map((row) => row.getAttribute('aria-label')?.split(' · ')[2])).toEqual(['초록손', '다육맘'])
  })
})
