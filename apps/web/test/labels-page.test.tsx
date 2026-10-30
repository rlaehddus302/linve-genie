// 라벨 화면·프린터 상태 (AC-I1-20·21·23·24·27·34·50·60): 메뉴 "라벨", 연결 방법은 이 브라우저에 있는 것만(시험용 프린터는 시험 모드에서만),
// 바로 연결할 수 없는 브라우저 안내, 멈춤 띠의 문장·할 일, 다른 기기에서 보는 출력 기기, 버릴 라벨, 자동 출력 설정, 영어 상태값 없음.
import { bitmapsEqual, defaultTemplate, renderTestLabel } from '@livejjim/label'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import { setLabelEnv } from '../src/lib/label-env.ts'
import { device, job, jsdomLabelEnv, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'
import { menuNav, openMore } from './menu-support.ts'

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
    expect(within(menuNav()).getByRole('button', { name: '더보기' }).getAttribute('aria-current')).toBe('page')
    expect(within(openMore()).getByRole('link', { name: '라벨' }).getAttribute('aria-current')).toBe('page')
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
    expect(within(printer).getByRole('link', { name: '그림 파일로 저장하기' }).getAttribute('href')).toBe('#label-export-files')
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

  it('테스트 인쇄 그림 = renderTestLabel(상품 라벨 설정의 가게 이름·크기, 한국 날짜 오늘) — 점 하나까지 (AC-I1-22, D-I1-06)', async () => {
    // 한국은 이미 10월 20일, UTC·미국은 아직 19일인 때 (실행 환경 시간대가 한국이 아니면 날짜를 잘못 고르는 것도 잡는다)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'))
    const env = jsdomLabelEnv()
    setLabelEnv(env)
    // 미리 보기 캔버스는 jsdom에 그릴 곳이 없다 (LabelImage는 null이면 그리지 않는다)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    try {
      testPrinter = true
      const product = { ...defaultTemplate('product', '50x40'), shopName: '다육농장' }
      server.on('GET', /^\/api\/print\/templates$/, () => ({ body: { ...templates(), product: { template: product, version: 3 } } }))
      const expected = renderTestLabel(env, { shopName: '다육농장', date: '2026-10-20', size: '50x40' })
      expect(expected.ok).toBe(true)
      if (!expected.ok) throw new Error('시험 라벨을 그릴 수 없다')
      // 저장된 크기(50×40)를 B1이 찍으므로 테스트 그림도 그 크기로 받는다 (D-PRN2-27)
      server.on('GET', /^\/api\/print\/test-bitmap\?size=50x40$/, () => ({ body: { width: expected.image.width, height: expected.image.height, data: btoa(Array.from(expected.image.data, (byte) => String.fromCharCode(byte)).join('')) } }))
      await openLabels()
      const printer = screen.getByRole('region', { name: '프린터' })
      fireEvent.click(within(printer).getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }))
      await waitFor(() => expect(within(printer).getByText('연결됨')).toBeTruthy())
      fireEvent.click(within(printer).getByRole('button', { name: '테스트 인쇄' }))
      await waitFor(() => expect(within(printer).getByText('테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?')).toBeTruthy(), { timeout: 5000 })
      const printed = window.livejjimTestPrinter?.printed() ?? []
      expect(printed).toHaveLength(1)
      const got = printed[0]
      expect(got === undefined ? null : { width: got.width, height: got.height }).toEqual({ width: expected.image.width, height: expected.image.height })
      expect(bitmapsEqual({ width: got?.width ?? 0, height: got?.height ?? 0, data: Uint8Array.from(got?.data ?? []) }, expected.image)).toBe(true)
      // 다른 날짜·가게 이름·크기의 테스트 라벨과는 다르다 (비교가 헛돌지 않는다)
      for (const other of [
        { shopName: '다육농장', date: '2026-10-19', size: '50x40' as const },
        { shopName: '', date: '2026-10-20', size: '50x40' as const },
        { shopName: '다육농장', date: '2026-10-20', size: '50x30' as const },
      ]) {
        const wrong = renderTestLabel(env, other)
        expect(wrong.ok && bitmapsEqual({ width: got?.width ?? 0, height: got?.height ?? 0, data: Uint8Array.from(got?.data ?? []) }, wrong.image)).toBe(false)
      }
      // APP2: 서버 그림을 받되 출력 대기열을 받거나 완료시키지는 않는다.
      expect(server.callsTo('GET', /^\/api\/print\/test-bitmap\?size=50x40$/)).toHaveLength(1)
      expect(server.callsTo('POST', /^\/api\/print\/(claim|result)$/)).toHaveLength(0)
    } finally {
      setLabelEnv(null)
      getContext.mockRestore()
      vi.useRealTimers()
    }
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
    // MOB1 D-MOB1-08: 새 문장(괄호 — 조사가 늘 "기기" 뒤)
    expect(screen.getByText("출력 기기('휴대폰')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.")).toBeTruthy()
    expect(document.body.textContent).not.toContain('와 연결이 끊겼어요.')
    const band = screen.getByRole('region', { name: '출력 멈춤' })
    expect(within(band).getByText('프린터 연결이 끊겼어요.')).toBeTruthy()
    expect(within(band).getByText("출력 기기 '휴대폰'에서 다시 연결해 주세요.")).toBeTruthy()
    expect(within(band).queryByRole('button', { name: '다시 연결' })).toBeNull()
    const list = screen.getByRole('list', { name: '대기 작업' })
    // MOB1 D-MOB1-13: 만든 까닭과 상태 낱말 사이 " · "
    expect(list.textContent).toContain('15번 핑크프릴 · 우주천사 · 상품 · 자동 · 작업 대기 · 시도 1번')
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

describe('위 줄 "출력 멈춤" 옆 "다시 연결" (D-WIZ-01, AC-WIZ-04)', () => {
  const ME = 'device-me-wiz-0001'
  const lost = (deviceId: string) =>
    overview({ queue: queue({ device: device(deviceId, { name: 'PC', printerConnected: false }), waiting: 2, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } }), jobs: [job('w1')] })
  const banner = () => screen.getByRole('banner')

  async function openHome(): Promise<void> {
    window.history.replaceState(null, '', '/')
    render(<App />)
    await screen.findByRole('heading', { name: '방송 목록', level: 1 })
    await flush(10)
  }

  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.setItem('livejjim.deviceId', ME)
  })

  it('이 기기가 출력 기기이고 끊김으로 멈췄으면 어느 화면이든 위 줄에 보통 버튼 "다시 연결" — 한 번 누르면 마지막 방법으로 잇고 서버에 알린다', async () => {
    testPrinter = true
    window.localStorage.setItem('livejjim.printMethod', 'test')
    current = lost(ME)
    server.on('POST', /^\/api\/print\/device\/state$/, (call) => {
      current = overview({ queue: queue({ rev: 2, device: device(ME, { name: 'PC', printerConnected: call.body?.['connected'] === true }), waiting: 2 }), jobs: [job('w1')] })
      return { body: { queue: current.queue } }
    })
    await openHome()
    expect(within(banner()).getByRole('link', { name: '출력 멈춤 · 대기 2장' })).toBeTruthy()
    const button = within(banner()).getByRole('button', { name: '다시 연결' })
    expect(button.className).toBe('button')
    fireEvent.click(button)
    await waitFor(() => expect(server.callsTo('POST', /^\/api\/print\/device\/state$/).map((call) => call.body)).toEqual([{ deviceId: ME, connected: true, profileId: 'NIIMBOT_B1' }]))
    // 라벨 화면으로 가지 않는다
    expect(window.location.pathname).toBe('/')
    await waitFor(() => expect(within(banner()).queryByRole('button', { name: '다시 연결' })).toBeNull())
  })

  it('실패하면 위 줄 근처에 오류 문장 한 줄 — 대기열은 그대로', async () => {
    testPrinter = true
    window.localStorage.setItem('livejjim.printMethod', 'test')
    current = lost(ME)
    await openHome()
    window.livejjimTestPrinter?.setConnectError('NOT_SELECTED')
    fireEvent.click(within(banner()).getByRole('button', { name: '다시 연결' }))
    expect(await within(banner()).findByText('프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.')).toBeTruthy()
    expect(within(banner()).getByRole('link', { name: '출력 멈춤 · 대기 2장' })).toBeTruthy()
    expect(server.callsTo('POST', /^\/api\/print\/device\/state$/).filter((call) => call.body?.['connected'] === true)).toHaveLength(0)
  })

  it('다른 기기·이 브라우저에 그 방법이 없음·손으로 푸는 멈춤이면 버튼이 없다 — 상태를 누르면 라벨 화면', async () => {
    testPrinter = true
    window.localStorage.setItem('livejjim.printMethod', 'test')
    current = lost('other-device-1')
    await openHome()
    expect(within(banner()).queryByRole('button', { name: '다시 연결' })).toBeNull()
    cleanup()
    // 마지막 방법이 시험용 프린터인데 시험 모드가 아니다
    testPrinter = false
    current = lost(ME)
    await openHome()
    expect(within(banner()).queryByRole('button', { name: '다시 연결' })).toBeNull()
    cleanup()
    testPrinter = true
    current = overview({ queue: queue({ device: device(ME, { name: 'PC' }), waiting: 2, pause: { reason: 'PRINTER_ERROR', message: '프린터 오류로 멈췄어요.', backlog: false } }) })
    await openHome()
    expect(within(banner()).queryByRole('button', { name: '다시 연결' })).toBeNull()
    fireEvent.click(within(banner()).getByRole('link', { name: '출력 멈춤 · 대기 2장' }))
    expect(await screen.findByRole('heading', { name: '라벨', level: 1 })).toBeTruthy()
  })
})

describe('저장된 라벨 설정 다시 보기 (L-11 13, D-STB-01)', () => {
  const DATE_TOO_NARROW = '날짜 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요.'

  async function openWithProduct(product: object): Promise<HTMLElement> {
    server.on('GET', /^\/api\/print\/templates$/, () => ({ body: { ...templates(), product: { template: product, version: 3 } } }))
    await openLabels()
    return screen.getByRole('region', { name: '라벨 설정' })
  }

  it('저장된 상품 설정이 가장 넓은 날짜(04.04.04)를 못 담으면 열 때 저장 막힘과 같은 문장으로 경고 — 설정은 그대로이고 새로 저장은 막힌다', async () => {
    setLabelEnv(jsdomLabelEnv())
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    try {
      // 옛 기본 날짜 칸(x 292 · 폭 88) — 지금은 26.10.08 같은 날짜가 들어가 출력은 되지만 2034-04-04 같은 날에 멈춘다
      const base = defaultTemplate('product')
      const old = { ...base, items: { ...base.items, date: { ...base.items.date, x: 292, width: 88 } } }
      const editor = await openWithProduct(old)
      const warning = await within(editor).findByRole('note', { name: '저장된 라벨 설정 경고' })
      expect(warning.textContent).toBe(DATE_TOO_NARROW)
      // 서버에 고쳐 보내지 않는다 (그대로 쓴다)
      expect(server.callsTo('PUT', /^\/api\/print\/templates\//)).toHaveLength(0)
      // 새로 저장하는 것은 지금처럼 막힌다 — 같은 문장
      fireEvent.click(within(editor).getAllByRole('button', { name: '라벨 설정 저장' })[0] as HTMLButtonElement)
      await waitFor(() => expect(within(editor).getByRole('alert').textContent).toBe(DATE_TOO_NARROW))
      expect(server.callsTo('PUT', /^\/api\/print\/templates\//)).toHaveLength(0)
    } finally {
      setLabelEnv(null)
      getContext.mockRestore()
    }
  })

  it('기본 설정(날짜 칸 x 290 · 폭 90)이면 경고가 없다', async () => {
    setLabelEnv(jsdomLabelEnv())
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    try {
      const editor = await openWithProduct(defaultTemplate('product'))
      await flush(10)
      expect(within(editor).queryByRole('note', { name: '저장된 라벨 설정 경고' })).toBeNull()
      expect(editor.textContent).not.toContain(DATE_TOO_NARROW)
    } finally {
      setLabelEnv(null)
      getContext.mockRestore()
    }
  })
})
