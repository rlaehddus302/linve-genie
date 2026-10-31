// 포장 화면 (STL-08, D-UX2-04): 날짜 → 지금 손님 카드(첫 손님) → 체크리스트를 모두 담아야 "포장 끝" → pack 요청(같은 요청 번호) → 상태 낱말이 바뀐다.
// 옛 화면은 구매자 목록에서 한 명을 열어야 체크리스트가 보였고 단추 이름이 "포장 완료"였다 — 새 화면은 첫 손님이 바로 카드로 열리고 단추는 "포장 끝".
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PackingEntry } from '@livejjim/web/src/api/types.ts'
import { PackingScreen } from '../src/screens/PackingScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const entry = (patch: Partial<PackingEntry> = {}): PackingEntry => ({
  buyer: 'u1',
  name: '홍길동',
  phoneLast4: '1234',
  payment: 'PAID',
  items: [
    { key: 'b1/15', broadcast: 'b1', title: '저녁 방송', no: 15, name: '핑크프릴', price: 10_000 },
    { key: 'b1/16', broadcast: 'b1', title: '저녁 방송', no: 16, name: '엘레강스', price: 12_000, qty: 2 },
  ],
  status: '포장 대기',
  invoice: null,
  add: [],
  remove: [],
  ...patch,
})

describe('PackingScreen', () => {
  it('구매자를 열어 모두 담으면 포장 완료가 켜지고, 누르면 pack 요청이 간다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
    let current = entry()
    world.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: '2026-10-29', seq: 5, entries: [current] } }))
    world.server.on('POST', /^\/api\/days\/2026-10-29\/packing$/, (call) => {
      current = entry({ status: '포장 완료' })
      return { body: { date: '2026-10-29', entry: current, recorded: true, sent: call.body } }
    })
    render(world.wrap(<PackingScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByRole('button', { name: '날짜 10월 29일' })).toBeTruthy())
    const card = await screen.findByRole('group', { name: '지금 손님 — 홍길동' })
    expect(card.textContent).toContain('포장 대기')
    expect(card.textContent).toContain('3개')
    expect(card.textContent).toContain('입금 완료')
    await waitFor(() => expect(screen.getByText('0 / 1')).toBeTruthy())
    const checklist = within(card).getByRole('list', { name: '체크리스트' })
    expect(within(checklist).getByRole('button', { name: '담기 — 16번 엘레강스 2개' })).toBeTruthy()
    const packButton = screen.getByRole('button', { name: '포장 끝' })
    expect(packButton.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('모두 담으면 포장 완료를 누를 수 있어요.')).toBeTruthy()
    fireEvent.click(within(checklist).getByRole('button', { name: '담기 — 15번 핑크프릴' }))
    fireEvent.click(within(checklist).getByRole('button', { name: '담기 — 16번 엘레강스 2개' }))
    expect(within(checklist).getByRole('button', { name: '담음 — 15번 핑크프릴' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: '포장 끝' }).getAttribute('aria-disabled')).not.toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: '포장 끝' }))
    await waitFor(() => expect(world.server.callsTo('POST', /packing/).length).toBe(1))
    expect(world.server.callsTo('POST', /packing/)[0]?.body).toEqual({
      requestId: expect.any(String),
      buyer: 'u1',
      action: 'pack',
      items: [
        { key: 'b1/15', qty: 1 },
        { key: 'b1/16', qty: 2 },
      ],
    })
    await waitFor(() => expect(screen.getByText('포장 완료로 적었어요.')).toBeTruthy())
    expect(screen.getByRole('button', { name: '배송 완료' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '포장 완료 되돌리기' })).toBeTruthy()
    // 끝낸 손님 카드는 저절로 넘기지 않는다 — 되돌리기를 바로 누를 수 있게 남고 진행이 1 / 1이 된다
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeTruthy())
  })

  it('걸러 보기: 포장 완료한 구매자는 "포장할 것"에 없고 "포장 완료"에 있다', async () => {
    // 걸러 보기 단추 이름은 "보기: …" (D-UX2-04 — 카드의 "배송 완료" 단추와 헷갈리지 않게)
    const world = makeWorld()
    world.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
    world.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: '2026-10-29', seq: 5, entries: [entry({ status: '포장 완료' }), entry({ buyer: 'u2', name: '김영희', status: '포장 다시 확인' })] } }))
    render(world.wrap(<PackingScreen onBack={() => {}} />))
    const card = await screen.findByRole('group', { name: '지금 손님 — 김영희' })
    expect(card.textContent).toContain('포장 다시 확인')
    expect(screen.queryByText('홍길동')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '보기: 포장 완료' }))
    await waitFor(() => expect(screen.getByRole('group', { name: '지금 손님 — 홍길동' })).toBeTruthy())
    expect(screen.queryByText('김영희')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '보기: 배송 완료' }))
    await waitFor(() => expect(screen.getByText('배송 완료한 구매자가 없어요.')).toBeTruthy())
  })
})
