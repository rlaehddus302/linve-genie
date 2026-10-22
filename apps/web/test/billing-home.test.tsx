// 홈의 요금 (N5, AC-N5-56·57): 알림 띠와 "요금 화면 열기", 새 방송 칸의 시작 미리 보기(서버 값 그대로), 서버 거절(NO_PASS) 문장, 리허설은 늘,
// 다른 기기의 결제(요금 알림)로 미리 보기가 바뀐다, 요금 기능이 꺼져 있으면 아무것도 없다. 다른 화면(라벨)은 요금을 받지 않는다.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { NO_PASS_MESSAGE } from '../src/lib/billing-words.ts'
import { billingServer, billingStatus, type BillingFake } from './billing-support.ts'
import { DATE, FakeEventSource, apiError, flush } from './support.ts'

let fake: BillingFake

beforeEach(() => {
  window.sessionStorage.clear()
  fake = billingServer()
  vi.stubGlobal('fetch', fake.server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
})

async function openHome(): Promise<void> {
  render(<App />)
  await screen.findByRole('heading', { name: '방송 목록' })
  await flush(10)
}

const DAY_USE = { allowed: true, mode: 'DAY', useDay: true, flatUntil: null, windowUntil: null, days: { before: 1, after: 0 }, orders: null } as const

describe('알림 띠 (AC-N5-57)', () => {
  it('홈 위쪽에 BL-9 1 문장과 "요금 화면 열기" — 누르면 요금 화면', async () => {
    fake.status = billingStatus({ banners: [{ kind: 'FLAT_REMAINING', days: 3, until: '2026-11-19T11:31:00.000Z' }, { kind: 'ORDERS_OVER', count: 2 }], start: DAY_USE })
    await openHome()
    const region = screen.getByRole('region', { name: '요금 알림' })
    expect(within(region).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '정액제가 3일 남았어요 (11/19 20:31까지). 미리 연장하면 남은 기간 뒤에 30일이 이어져요.',
      '주문 건권을 2건 넘게 썼어요. 다음에 사는 주문 건권에서 먼저 빠져요.',
    ])
    fireEvent.click(within(region).getByRole('link', { name: '요금 화면 열기' }))
    expect(await screen.findByRole('heading', { name: '요금', level: 1 })).toBeTruthy()
    expect(window.location.pathname).toBe('/billing')
  })

  it('라벨 화면은 요금을 받지 않는다 (콘솔·문자찜·구매자·정산·라벨에 요금 알림 없음)', async () => {
    fake.server
      .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
      .on('GET', /^\/api\/settings$/, () => ({ body: { settings: {} } }))
    window.history.replaceState(null, '', '/labels')
    render(<App />)
    await screen.findByRole('heading', { name: '라벨', level: 1 })
    await flush(10)
    expect(fake.server.callsTo('GET', /^\/api\/billing/)).toHaveLength(0)
    expect(screen.queryByRole('region', { name: '요금 알림' })).toBeNull()
    FakeEventSource.last.emit('billing', { reason: 'grant' })
    await flush(5)
    expect(fake.server.callsTo('GET', /^\/api\/billing/)).toHaveLength(0)
  })
})

describe('새 방송 시작 미리 보기 (AC-N5-56)', () => {
  it('새 방송 칸(실제 방송)에 서버 미리 보기 문장 — 리허설 시작에는 문장이 없다', async () => {
    fake.status = billingStatus({ start: DAY_USE, banners: [] })
    await openHome()
    expect(screen.queryByText(/방송 일권 1일을 써요/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    const form = screen.getByRole('form', { name: '새 방송' })
    expect(within(form).getByText('방송 일권 1일을 써요 (남은 1일 → 0일). 지금부터 24시간 안에 시작하는 방송은 더 빠지지 않아요.')).toBeTruthy()
  })

  it('이용권이 없으면 BL-4 1.5 문장 + "요금 화면 열기", 그래도 "이 방송 시작하기"는 누를 수 있고 서버가 거절하면 그 문장을 한 번만', async () => {
    fake.server.on('POST', /^\/api\/broadcasts$/, (call) => (call.body?.rehearsal === true ? { body: { broadcast: { id: 'r1', date: DATE, title: '리허설 1', rehearsal: true } } } : apiError(422, 'NO_PASS', NO_PASS_MESSAGE)))
    await openHome()
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    const form = screen.getByRole('form', { name: '새 방송' })
    expect(within(form).getByText(NO_PASS_MESSAGE)).toBeTruthy()
    expect(within(form).getByRole('link', { name: '요금 화면 열기' })).toBeTruthy()
    const start = within(form).getByRole('button', { name: '이 방송 시작하기' }) as HTMLButtonElement
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toContain(NO_PASS_MESSAGE))
    expect(screen.getAllByText(NO_PASS_MESSAGE)).toHaveLength(1)
    expect(window.location.pathname).toBe('/')
    // 미리 보기가 늦었을 수 있다 — 요금 상태를 새로 받는다
    expect(fake.server.callsTo('GET', /^\/api\/billing$/).length).toBeGreaterThan(1)
    // 리허설은 요금과 상관없이 시작된다
    fireEvent.click(screen.getByRole('button', { name: '리허설 해 보기' }))
    await waitFor(() => expect(window.location.pathname).toBe('/broadcasts/r1'))
  })

  it('다른 기기에서 이용권을 사면(요금 알림) 미리 보기가 바뀌고 거절 문장은 거둔다', async () => {
    fake.server.on('POST', /^\/api\/broadcasts$/, () => apiError(422, 'NO_PASS', NO_PASS_MESSAGE))
    await openHome()
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    const form = screen.getByRole('form', { name: '새 방송' })
    fireEvent.click(within(form).getByRole('button', { name: '이 방송 시작하기' }))
    await waitFor(() => expect(within(form).getByRole('alert')).toBeTruthy())
    fake.status = billingStatus({ start: DAY_USE, banners: [] })
    FakeEventSource.last.emit('billing', { reason: 'grant' })
    expect(await within(form).findByText('방송 일권 1일을 써요 (남은 1일 → 0일). 지금부터 24시간 안에 시작하는 방송은 더 빠지지 않아요.')).toBeTruthy()
    expect(screen.queryByText(NO_PASS_MESSAGE)).toBeNull()
    expect(screen.queryByRole('region', { name: '요금 알림' })).toBeNull()
  })

  it('정액 · 열린 창 · 주문 건 문장', async () => {
    const base = { allowed: true, useDay: false, flatUntil: null, windowUntil: null, days: null, orders: null } as const
    fake.status = billingStatus({ start: { ...base, mode: 'ORDERS', orders: 40 }, banners: [] })
    await openHome()
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    expect(screen.getByText('주문 건권으로 시작해요 (남은 40건). 1등이 나온 상품마다 1건씩 빠져요.')).toBeTruthy()
    fake.status = billingStatus({ start: { ...base, mode: 'DAY', windowUntil: '2026-10-21T11:00:00.000Z' }, banners: [] })
    FakeEventSource.last.emit('billing', { reason: 'start' })
    expect(await screen.findByText('방송 일권 24시간 안이에요 (10/21 20:00까지). 더 빠지지 않아요.')).toBeTruthy()
    fake.status = billingStatus({ start: { ...base, mode: 'FLAT', flatUntil: '2026-11-19T11:31:00.000Z' }, banners: [] })
    FakeEventSource.last.emit('billing', { reason: 'grant' })
    expect(await screen.findByText('정액제로 시작해요 (11/19 20:31까지).')).toBeTruthy()
  })

  it('요금 기능이 꺼져 있으면 홈에 미리 보기·알림 띠가 없고 요금 상태를 부르지 않는다', async () => {
    fake.config = { enabled: false, testPayment: false }
    await openHome()
    fireEvent.click(screen.getByRole('button', { name: '새 방송 시작' }))
    expect(screen.queryByRole('status', { name: '새 방송 요금' })).toBeNull()
    expect(screen.queryByRole('region', { name: '요금 알림' })).toBeNull()
    expect(fake.server.callsTo('GET', /^\/api\/billing/)).toHaveLength(0)
  })
})
