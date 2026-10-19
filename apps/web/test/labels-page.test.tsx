// 라벨 화면·프린터 상태 (AC-I1-20·21·23·24·27·34·50·60): 메뉴 "라벨", 연결 방법은 이 브라우저에 있는 것만(시험용 프린터는 시험 모드에서만),
// 바로 연결할 수 없는 브라우저 안내, 멈춤 띠의 문장·할 일, 다른 기기에서 보는 출력 기기, 버릴 라벨, 자동 출력 설정, 영어 상태값 없음.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import { device, job, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

let server: FakeServer
let current: PrintOverview
let testPrinter: boolean

beforeEach(() => {
  window.sessionStorage.clear()
  server = new FakeServer()
  current = overview()
  testPrinter = false
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { 'print.autoOnConfirm': true } } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/labels')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
})

async function openLabels(): Promise<HTMLElement> {
  const view = render(<App />)
  await screen.findByRole('heading', { name: '라벨', level: 1 })
  await flush(10)
  return view.container
}

describe('메뉴·프린터 상태 (AC-I1-20·34)', () => {
  it('메뉴 "라벨"이 지금 화면이고, 위 줄에 프린터 상태가 글자로 — 작업이 없으면 "출력 기기 없음"만', async () => {
    await openLabels()
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect(within(menu).getByRole('link', { name: '라벨' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '출력 기기 없음' }).getAttribute('href')).toBe('/labels')
  })

  it('"프린터 <이름> · 연결됨 · 대기 2장" / 멈췄으면 "출력 멈춤 · 대기 5장"', async () => {
    current = overview({ queue: queue({ device: device('other-device-1', { name: '휴대폰' }), waiting: 2 }) })
    await openLabels()
    expect(screen.getByRole('link', { name: '프린터 휴대폰 · 연결됨 · 대기 2장' })).toBeTruthy()
    FakeEventSource.last.emit('print', { rev: 2, queue: queue({ rev: 2, waiting: 5, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: false } }), jobs: [], labels: [] })
    await waitFor(() => expect(screen.getByRole('link', { name: '출력 멈춤 · 대기 5장' })).toBeTruthy())
  })
})

describe('연결 방법 (AC-I1-21·50)', () => {
  it('바로 연결할 수 없는 브라우저(방법 없음)는 안내와 그림 파일로 저장하는 곳 — 시험 모드가 아니면 시험용 프린터가 없다', async () => {
    await openLabels()
    const printer = screen.getByRole('region', { name: '프린터' })
    expect(within(printer).getByText('이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.')).toBeTruthy()
    expect(within(printer).getByRole('link', { name: '그림 파일로 저장하기' }).getAttribute('href')).toBe('#label-export')
    expect(screen.queryByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' })).toBeNull()
    expect(screen.queryByText('시험용 프린터 조작')).toBeNull()
    expect(window.livejjimTestPrinter).toBeUndefined()
  })

  it('시험 모드면 "시험용 프린터 — 실제로 출력되지 않아요"로 잇고 테스트 인쇄·농도·이 기기에서 출력이 보인다', async () => {
    testPrinter = true
    await openLabels()
    const printer = screen.getByRole('region', { name: '프린터' })
    fireEvent.click(within(printer).getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }))
    await waitFor(() => expect(within(printer).getByText('연결됨')).toBeTruthy())
    expect(within(printer).getByRole('button', { name: '테스트 인쇄' })).toBeTruthy()
    const density = within(printer).getByLabelText('인쇄 농도') as HTMLSelectElement
    expect([...density.options].map((option) => option.value)).toEqual(['1', '2', '3', '4', '5'])
    expect(density.value).toBe('3')
    expect((within(printer).getByLabelText('기기 이름') as HTMLInputElement).value).toBe('PC')
    expect(within(printer).getByRole('button', { name: '이 기기에서 출력' })).toBeTruthy()
    expect(window.livejjimTestPrinter).toBeDefined()
  })
})

describe('출력 기기·멈춤 띠 (AC-I1-09·23·24)', () => {
  it('다른 기기에서: "출력 기기: <이름> · 끊김"과 연결 끊김 문장, 끊김 멈춤이면 그 기기에서 다시 연결하라는 문장', async () => {
    current = overview({
      queue: queue({ device: device('other-device-1', { name: '휴대폰', live: false, printerConnected: false }), waiting: 1, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } }),
      jobs: [job('j1', { attempts: 1, lastError: { code: 'DISCONNECTED', item: null } })],
    })
    await openLabels()
    expect(screen.getByText('출력 기기: 휴대폰 · 끊김')).toBeTruthy()
    expect(screen.getByText("출력 기기 '휴대폰'와 연결이 끊겼어요.")).toBeTruthy()
    const band = screen.getByRole('region', { name: '출력 멈춤' })
    expect(within(band).getByText('프린터 연결이 끊겼어요.')).toBeTruthy()
    expect(within(band).getByText("출력 기기 '휴대폰'에서 다시 연결해 주세요.")).toBeTruthy()
    expect(within(band).queryByRole('button', { name: '다시 연결' })).toBeNull()
    const list = screen.getByRole('list', { name: '대기 작업' })
    expect(list.textContent).toContain('15번 핑크프릴 · 우주천사 · 상품 · 자동 작업 대기 · 시도 1번')
    expect(list.textContent).toContain('마지막 오류: 프린터 연결이 끊겼어요.')
  })

  it('쌓인 라벨: "대기 중인 라벨 N장이 있어요…"와 "출력 시작" = 다시 시작', async () => {
    current = overview({ queue: queue({ device: device('other-device-1'), waiting: 3, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } }) })
    server.on('POST', /^\/api\/print\/restart$/, () => ({ body: { queue: queue({ rev: 2, device: device('other-device-1'), waiting: 3 }) } }))
    await openLabels()
    const band = screen.getByRole('region', { name: '출력 멈춤' })
    expect(within(band).getByText('대기 중인 라벨 3장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요.')).toBeTruthy()
    fireEvent.click(within(band).getByRole('button', { name: '출력 시작' }))
    await waitFor(() => expect(server.callsTo('POST', /^\/api\/print\/restart$/)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('region', { name: '출력 멈춤' })).toBeNull())
  })

  it('끊김 멈춤을 다른 기기에서 다시 시작하면 서버 문장에 출력 기기 이름을 넣는다', async () => {
    current = overview({ queue: queue({ device: device('other-device-1', { name: '휴대폰' }), pause: { reason: 'PRINTER_ERROR', message: '프린터 오류로 멈췄어요.', backlog: false } }) })
    server.on('POST', /^\/api\/print\/restart$/, () => ({ status: 409, body: { error: { code: 'PRINT_RECONNECT_REQUIRED', message: '출력 기기에서 다시 연결해 주세요.' }, device: { name: '휴대폰' } } }))
    await openLabels()
    fireEvent.click(within(screen.getByRole('region', { name: '출력 멈춤' })).getByRole('button', { name: '다시 시작' }))
    expect(await screen.findByText("출력 기기 '휴대폰'에서 다시 연결해 주세요.")).toBeTruthy()
  })
})

describe('버릴 라벨·자동 출력 설정·낱말 (AC-I1-24·27·60)', () => {
  it('"15번 · 우주천사 · 26.10.19 라벨을 버려 주세요" — 버렸어요를 보낸다', async () => {
    current = overview({ queue: queue({ discard: 1 }), discard: [job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요', device: 'PC', printedAt: '2026-10-19T11:01:00.000Z' })] })
    server.on('POST', /^\/api\/print\/jobs\/discard$/, () => ({ body: { job: job('d1', { status: 'DONE', voided: true, discard: false, word: '폐기' }) } }))
    await openLabels()
    const region = screen.getByRole('region', { name: '버릴 라벨' })
    expect(within(region).getByText('15번 · 우주천사 · 26.10.19 라벨을 버려 주세요')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: '버렸어요' }))
    await waitFor(() => expect(within(region).getByText('버릴 라벨이 없어요.')).toBeTruthy())
    expect(server.callsTo('POST', /^\/api\/print\/jobs\/discard$/)[0]?.body).toEqual({ date: DATE, id: 'd1' })
  })

  it('"1등 확정 때 라벨 자동 출력"을 바꾸면 판매 규칙 설정을 바꾸고 "다음에 시작하는 방송부터 적용돼요."', async () => {
    server.on('PATCH', /^\/api\/settings$/, (call) => ({ body: { settings: { 'print.autoOnConfirm': (call.body?.settings as Record<string, unknown>)['print.autoOnConfirm'] } } }))
    await openLabels()
    const box = (await screen.findByLabelText('1등 확정 때 라벨 자동 출력')) as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(true))
    fireEvent.click(box)
    expect(await screen.findByText('다음에 시작하는 방송부터 적용돼요.')).toBeTruthy()
    expect(server.callsTo('PATCH', /^\/api\/settings$/)[0]?.body).toEqual({ settings: { 'print.autoOnConfirm': false } })
    await waitFor(() => expect(box.checked).toBe(false))
  })

  it('화면 어디에도 영어 상태값·코드가 없다', async () => {
    current = overview({
      queue: queue({ device: device('other-device-1'), waiting: 1, printing: 1, discard: 1 }),
      jobs: [job('p1', { status: 'PRINTING', word: '출력 중' }), job('w1', { lastError: { code: 'TIMEOUT', item: null }, attempts: 2 })],
      discard: [job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요' })],
    })
    const container = await openLabels()
    const text = container.textContent ?? ''
    for (const word of ['WAITING', 'PRINTING', 'DONE', 'CANCELLED', 'VOID', 'PRINT_PRODUCT_LABEL', 'DISCONNECTED', 'TIMEOUT', 'SELLER']) expect(text).not.toContain(word)
    expect(text).toContain('프린터가 응답하지 않아요. 프린터 전원과 라벨을 확인한 뒤 다시 시작해 주세요.')
  })
})
