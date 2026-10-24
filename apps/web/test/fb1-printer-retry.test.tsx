// FB1 D-FB1-18 (b) (AC-FB1-38 회차 2): 연결 실패 상자의 "다시 연결"은 해볼 일 목록 아래 하나이고 라벨 화면의 주 버튼 —
// 그때 연결 방법 버튼은 모두 보통 버튼(주 버튼은 창 밖에 많아야 하나, AC-N4a-21). 출력 멈춤 띠 조치가 보이면 그것이 주 버튼이고 상자의 "다시 연결"은 보통.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import { device, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

const ME = 'device-me-fb1-0001'
const TEST_METHOD = '시험용 프린터 — 실제로 출력되지 않아요'
const FAILED = '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.'

let server: FakeServer
let current: PrintOverview

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('livejjim.deviceId', ME)
  server = new FakeServer()
  current = overview()
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: true } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { 'print.autoOnConfirm': true } } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openLabels() {
  window.history.replaceState(null, '', '/labels')
  render(<App />)
  await screen.findByRole('heading', { name: '라벨', level: 1 })
  await flush(10)
  await waitFor(() => expect(window.livejjimTestPrinter).toBeDefined())
}

function primaryOutsideDialogs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.button-primary')].filter((el) => el.closest('[role=dialog]') === null).map((el) => el.textContent?.trim() ?? '')
}

async function failOnce() {
  window.livejjimTestPrinter?.setConnectError('CONNECT_FAILED')
  const printer = screen.getByRole('region', { name: '프린터' })
  fireEvent.click(within(printer).getByRole('button', { name: TEST_METHOD }))
  await within(printer).findByText(FAILED)
  return printer
}

describe('연결 실패 상자의 "다시 연결" (D-FB1-18 (b))', () => {
  it('해볼 일 목록 아래 "다시 연결" 하나가 주 버튼, 연결 방법 버튼은 보통 버튼 — 누르면 다시 잇는다', async () => {
    await openLabels()
    expect(primaryOutsideDialogs()).toEqual([TEST_METHOD])
    const printer = await failOnce()
    const box = within(printer).getByRole('alert')
    const retry = within(box).getAllByRole('button', { name: '다시 연결' })
    expect(retry).toHaveLength(1)
    expect(within(printer).getAllByRole('button', { name: '다시 연결' })).toHaveLength(1)
    expect(primaryOutsideDialogs()).toEqual(['다시 연결'])
    expect(within(printer).getByRole('button', { name: TEST_METHOD }).className).toBe('button')
    const list = within(box).getByRole('list', { name: '해볼 일' })
    expect((list.compareDocumentPosition(retry[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
    // 맥·리눅스(jsdom 사용자 에이전트): ⑤ 있음, 옛 ⑥ 없음
    expect(box.textContent).toContain('그래도 안 되면 안드로이드 폰의 크롬에서')
    expect(box.textContent).not.toContain('아이폰')
    window.livejjimTestPrinter?.setConnectError(null)
    fireEvent.click(retry[0] as HTMLElement)
    await waitFor(() => expect(within(printer).getByText('연결됨')).toBeTruthy())
    expect(within(printer).queryByText(FAILED)).toBeNull()
  })

  it('출력 멈춤 띠의 조치가 보이면(쌓인 라벨 "출력 시작") 그것이 주 버튼 — 상자의 "다시 연결"은 보통 버튼', async () => {
    current = overview({ queue: queue({ device: device('other-1'), waiting: 2, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } }) })
    await openLabels()
    expect(primaryOutsideDialogs()).toEqual(['출력 시작'])
    const printer = await failOnce()
    const retry = within(within(printer).getByRole('alert')).getByRole('button', { name: '다시 연결' })
    expect(retry.className).toBe('button')
    expect(primaryOutsideDialogs()).toEqual(['출력 시작'])
  })
})
