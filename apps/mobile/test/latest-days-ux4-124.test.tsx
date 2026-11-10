// D-UX4-124: 서버 날짜 목록(/api/days)은 오래된 날부터 온다. 앱은 가장 최근 실제 날짜를 먼저 보이고 기본으로 고른다.
// 옛 앱은 첫 줄을 가장 최근으로 여겨, 날짜가 둘 이상이면 주문·포장 탭이 가장 오래된 날로 열렸다(연습 자료로 시뮬레이터에서 찾음).
import { render, screen, within } from '@testing-library/react'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { latestFirst } from '../src/lib/latest-days.ts'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView } from './support.ts'

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

  it('주문 탭은 서버가 오래된 날부터 줘도 가장 최근 날짜로 연다', async () => {
    const w = makeWorld()
    w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-11-10', rehearsal: false, seq: 3 }, { date: '2026-11-11', rehearsal: false, seq: 7 }] } }))
    const asked: string[] = []
    w.server.on('GET', /^\/api\/days\/2026-11-1[01]$/, (call) => {
      asked.push(call.path)
      return { body: fullView({}) }
    })
    render(w.wrap(<SettleScreen />))
    const pills = await screen.findAllByRole('button', { name: /^날짜 / })
    expect(pills.map((pill) => pill.getAttribute('aria-label'))[0]).toMatch(/11월 11일/)
    await screen.findByRole('button', { name: /11월 10일/ })
    expect(asked[0]).toBe('/api/days/2026-11-11')
  })

  // 같은 연습 자료에서 찾음: 입금은 끝났지만 배송지가 없는 손님(정보 받기)이 받을 돈 순서 때문에 목록 맨 아래로 갔다.
  it('할 일 남은 손님은 다음 할 일 순서(정보 → 확인서 → 입금)로 모은다', async () => {
    const w = makeWorld()
    const DATE = '2026-10-29'
    const s = (id: string, patch: Partial<Settlement>): Settlement => ({ buyer: id, date: DATE, items: ['b1/15'], subtotal: 10_000, shipping: 4_000, shippingOverride: null, adjustments: 0, total: 14_000, received: 0, refundDue: 0, payment: 'UNPAID', records: [], ...patch })
    w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE, rehearsal: false, seq: 5 }] } }))
    w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({
      body: fullView({
        buyers: [buyer('u1', '다육맘'), buyer('u2', '초록손')],
        claims: [claim('c1', 15, 'u1'), claim('c2', 16, 'u2')],
        settlements: [s('u1', {}), s('u2', { received: 14_000, payment: 'PAID' })],
      }),
    }))
    const prow = (id: string, name: string, address: 'NONE' | 'CONFIRMED') => ({ buyer: id, name, phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'UNPAID', packing: '포장 전', shipping: 'NONE', address, ready: false, reason: null, message: null, box: '80', parcel: null })
    w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { date: DATE, seq: 5, blocked: null, carrier: null, box: '80', ready: [], excluded: [prow('u1', '다육맘', 'CONFIRMED'), prow('u2', '초록손', 'NONE')], booked: [] } }))
    const rrow = (id: string, name: string) => ({ buyer: id, name, phoneLast4: null, itemCount: 1, total: 14_000, payment: 'UNPAID', received: 0, remaining: 14_000, link: { buyer: id, status: 'ACTIVE', url: null, expiresAt: null, revokedAt: null } })
    w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers$/, () => ({ body: { date: DATE, rehearsal: false, buyers: [rrow('u1', '다육맘'), rrow('u2', '초록손')] } }))
    render(w.wrap(<SettleScreen />))
    await screen.findByText('손님 2명 중 0명 끝났어요')
    const todo = screen.getByRole('group', { name: '할 일 남은 손님' })
    expect(within(todo).getAllByRole('button').map((row) => row.getAttribute('aria-label')?.split(' · ').slice(0, 2).join(' · '))).toEqual(['초록손 · 정보 받기', '다육맘 · 입금 기다림'])
  })
})
