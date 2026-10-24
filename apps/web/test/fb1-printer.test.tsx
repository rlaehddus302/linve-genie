// FB1 프린터 연결 실패 화면 (D-FB1-09, AC-FB1-38·39): 문장 · "다시 연결" · 해볼 일(그 환경에 맞는 것만) · 자세히(쉬운 말만), 라틴 글자 없음.
// 시험 모드 가짜 B1 블루투스(실제 B1 어댑터 + 가짜 기기): 첫 확인 시간 초과 두 번 → 연결하지 못함(한 번 더 해 본 상세), 한 번 → 저절로 다시 이어져 연결됨.
import { createBitmap } from '@livejjim/label'
import { RETRIED_TIMEOUT_DETAIL, TIMEOUT_DETAIL, printerError, type PrinterError } from '@livejjim/printer'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrinterErrorView } from '../src/components/LabelsPage.tsx'
import { PrintStore } from '../src/lib/print-store.ts'
import { connectTips, isAndroid, isWindows, showsConnectTips } from '../src/lib/print-words.ts'
import { PrinterStation, type TestPrinterHandle } from '../src/lib/printer-station.ts'
import { device, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

const TIPS = {
  power: "프린터 전원을 껐다 켠 뒤 '다시 연결'을 눌러 주세요.",
  app: '휴대폰의 NIIMBOT 앱이 프린터에 이어져 있으면 앱을 닫아 주세요. 프린터는 한 기기에만 이어져요.',
  windows: "윈도우 설정 → 블루투스 및 장치에서 B1을 '장치 제거'한 뒤 여기서 '다시 연결'을 눌러 목록에서 B1을 골라 주세요. 윈도우에서 미리 연결(페어링)하지 않아도 돼요.",
  usb: 'USB 선이 있으면 USB 연결로 해 보세요.',
  android: "그래도 안 되면 안드로이드 폰의 크롬에서 라이브지니에 로그인해 프린터를 연결하고 '이 기기에서 출력'을 눌러 주세요. 컴퓨터에서 만든 라벨도 그 폰이 찍어요.",
  // FB1 D-FB1-17: 옛 ⑥ — 어디에도 없어야 한다
  ios: '아이폰·아이패드는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.',
}

/** 허용 라틴 낱말 (AC-FB1-38): B1·NIIMBOT·Marklife·USB·PNG·PDF와 기기·모델 이름 */
function latinWords(text: string, allowed: readonly string[] = []): string[] {
  const ok = new Set(['B1', 'NIIMBOT', 'Marklife', 'USB', 'PNG', 'PDF', ...allowed])
  return (text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => !ok.has(word))
}

afterEach(() => cleanup())

describe('해볼 일 (lib)', () => {
  // FB1 D-FB1-17: ⑥ 뺌, ⑤는 안드로이드가 아닐 때만 (옛 이름 "①②⑤⑥은 늘")
  it('①②는 늘, ③은 윈도우만, ④는 USB 연결이 있을 때만, ⑤는 안드로이드가 아닐 때만 — 차례대로, ⑥(아이폰 줄) 없음', () => {
    expect(connectTips({ windows: false, serial: false })).toEqual([TIPS.power, TIPS.app, TIPS.android])
    expect(connectTips({ windows: true, serial: false })).toEqual([TIPS.power, TIPS.app, TIPS.windows, TIPS.android])
    expect(connectTips({ windows: false, serial: true })).toEqual([TIPS.power, TIPS.app, TIPS.usb, TIPS.android])
    expect(connectTips({ windows: true, serial: true })).toEqual([TIPS.power, TIPS.app, TIPS.windows, TIPS.usb, TIPS.android])
    expect(connectTips({ windows: false, serial: true, android: true })).toEqual([TIPS.power, TIPS.app, TIPS.usb])
    expect(connectTips({ windows: false, serial: false, android: false })).toEqual([TIPS.power, TIPS.app, TIPS.android])
    for (const windows of [true, false]) for (const serial of [true, false]) for (const android of [true, false]) for (const marklife of [true, false]) {
      expect(connectTips({ windows, serial, android, marklife }).join('\n')).not.toContain('아이폰')
    }
    expect(isAndroid('Mozilla/5.0 (Linux; Android 14; SM-S918N) Chrome/130 Mobile')).toBe(true)
    expect(isAndroid('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130')).toBe(false)
    expect(isAndroid('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe(false)
    const marklife = connectTips({ windows: true, serial: false, marklife: true })
    expect(marklife.join('\n')).not.toMatch(/NIIMBOT|B1/)
    expect(marklife[1]).toContain('프린터 앱')
    expect(showsConnectTips('CONNECT_FAILED')).toBe(true)
    expect(showsConnectTips('DISCONNECTED')).toBe(true)
    expect(showsConnectTips('BLUETOOTH_OFF')).toBe(false)
    expect(isWindows('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe(true)
    expect(isWindows('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130')).toBe(false)
  })
})

describe('연결 실패 상자 (AC-FB1-38·39)', () => {
  const withDetail = (error: PrinterError, detail: string): PrinterError => ({ ...error, detail })
  for (const windows of [true, false])
    for (const serial of [true, false]) {
      it(`${windows ? '윈도우' : '맥'} · USB ${serial ? '있음' : '없음'}: 문장·다시 연결·해볼 일 목록, 자세히는 쉬운 말, 라틴 글자 없음`, () => {
        const retry = vi.fn()
        render(<PrinterErrorView error={withDetail(printerError('CONNECT_FAILED'), RETRIED_TIMEOUT_DETAIL)} onRetry={retry} serial={serial} windows={windows} />)
        const box = screen.getByRole('alert')
        expect(within(box).getByText('프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.')).toBeDefined()
        fireEvent.click(within(box).getByRole('button', { name: '다시 연결' }))
        expect(retry).toHaveBeenCalledTimes(1)
        const list = within(box).getByRole('list', { name: '해볼 일' })
        expect(list.tagName).toBe('OL')
        expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(connectTips({ windows, serial }))
        expect(within(list).queryByText(TIPS.windows) !== null).toBe(windows)
        expect(within(list).queryByText(TIPS.usb) !== null).toBe(serial)
        expect(within(box).getByText('자세히')).toBeDefined()
        expect(within(box).getByText(RETRIED_TIMEOUT_DETAIL)).toBeDefined()
        expect(latinWords(box.textContent ?? '')).toEqual([])
      })
    }

  // FB1 D-FB1-18 (b): 차례는 문장 → 해볼 일 → "다시 연결"(하나) → 자세히
  it('차례: 문장 → 해볼 일 → "다시 연결"(하나) → 자세히. 해볼 일이 없는 코드는 "다시 연결"이 문장 바로 아래', () => {
    render(<PrinterErrorView error={withDetail(printerError('CONNECT_FAILED'), TIMEOUT_DETAIL)} onRetry={() => {}} serial windows primary />)
    const box = screen.getByRole('alert')
    const message = within(box).getByText('프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.')
    const list = within(box).getByRole('list', { name: '해볼 일' })
    const buttons = within(box).getAllByRole('button', { name: '다시 연결' })
    expect(buttons).toHaveLength(1)
    const details = within(box).getByText('자세히')
    const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(message, list)).toBe(true)
    expect(follows(list, buttons[0] as Node)).toBe(true)
    expect(follows(buttons[0] as Node, details)).toBe(true)
    cleanup()
    render(<PrinterErrorView error={printerError('PORT_BUSY')} onRetry={() => {}} serial windows primary />)
    const box2 = screen.getByRole('alert')
    expect(within(box2).queryByRole('list')).toBeNull()
    const first = box2.querySelector('p')
    expect(first?.textContent).toBe(printerError('PORT_BUSY').message)
    expect(follows(first as Node, within(box2).getByRole('button'))).toBe(true)
  })

  it('"다시 연결"은 primary면 주 버튼, 아니면 보통 버튼 · 안드로이드면 ⑤ 없음, 맥이면 ⑤ 있음 · 아이폰 줄은 어디에도 없음', () => {
    render(<PrinterErrorView error={printerError('CONNECT_FAILED')} onRetry={() => {}} serial={false} windows={false} android={false} primary />)
    expect(screen.getByRole('button', { name: '다시 연결' }).className).toContain('button-primary')
    expect(screen.getByText(TIPS.android)).toBeDefined()
    expect(screen.queryByText(TIPS.ios)).toBeNull()
    cleanup()
    render(<PrinterErrorView error={printerError('CONNECT_FAILED')} onRetry={() => {}} serial android windows={false} />)
    expect(screen.getByRole('button', { name: '다시 연결' }).className).not.toContain('button-primary')
    expect(screen.queryByText(TIPS.android)).toBeNull()
    expect(screen.queryByText(TIPS.ios)).toBeNull()
  })

  it('끊김에도 같은 목록, 그 밖의 코드엔 목록이 없다, 상세가 없으면 자세히도 없다', () => {
    render(<PrinterErrorView error={printerError('DISCONNECTED')} onRetry={() => {}} serial={false} windows={false} />)
    expect(screen.getByRole('list', { name: '해볼 일' })).toBeDefined()
    expect(screen.queryByText('자세히')).toBeNull()
    cleanup()
    render(<PrinterErrorView error={printerError('BLUETOOTH_OFF')} serial={false} windows={false} />)
    expect(screen.queryByRole('list', { name: '해볼 일' })).toBeNull()
    cleanup()
    render(<PrinterErrorView error={withDetail(printerError('WRONG_MODEL'), '모델: D110')} serial={false} windows />)
    expect(screen.getByText('모델: D110')).toBeDefined()
    expect(latinWords(screen.getByRole('alert').textContent ?? '', ['D110'])).toEqual([])
    cleanup()
    render(<PrinterErrorView error={withDetail(printerError('CONNECT_FAILED'), TIMEOUT_DETAIL)} serial={false} windows={false} />)
    expect(screen.getByText(TIMEOUT_DETAIL)).toBeDefined()
  })
})

// ── 시험 모드 가짜 B1 블루투스 (AC-FB1-40 손잡이) ─────────────────────────

const ME = 'device-me-1234'
let server: FakeServer
let handle: TestPrinterHandle | null
let store: PrintStore | null = null
let station: PrinterStation | null = null

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  handle = null
  server = new FakeServer()
  const current = overview({ queue: queue({ rev: 1, device: device('someone-else-1') }) })
  server
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: true } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
  vi.stubGlobal('fetch', server.fetch)
  FakeEventSource.reset()
})

afterEach(() => {
  station?.stop()
  store?.stop()
  station = null
  store = null
  vi.unstubAllGlobals()
})

async function start(): Promise<PrinterStation> {
  store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  station = new PrinterStation({
    store,
    deviceId: ME,
    detect: () => [],
    render: async () => ({ ok: true, image: createBitmap(384, 240) }),
    renderTest: async () => ({ ok: true, image: createBitmap(384, 240) }),
    requestWakeLock: null,
    today: () => DATE,
    exposeTestHandle: (value) => {
      handle = value
    },
  })
  store.start()
  station.start()
  await flush()
  await vi.waitFor(() => expect(handle).not.toBeNull())
  return station
}

describe('가짜 B1 블루투스 (시험 모드)', () => {
  it('꽂으면 블루투스가 생기고, 두 번 답하지 않으면 연결하지 못함(한 번 더 해 본 상세·고르기 창 한 번), 한 번이면 저절로 다시 이어져 연결됨', async () => {
    const s = await start()
    expect(s.getSnapshot().methods).toEqual([])
    expect(handle?.fakeB1()).toBeNull()
    handle?.useFakeB1()
    expect(s.getSnapshot().methods).toEqual(['bluetooth'])
    handle?.setUnansweredNegotiations(2)
    expect(await s.connect('bluetooth')).toBe(false)
    const error = s.getSnapshot().connectError
    expect(error?.code).toBe('CONNECT_FAILED')
    expect(error?.detail).toBe(RETRIED_TIMEOUT_DETAIL)
    expect(handle?.fakeB1()).toEqual({ requests: 1, connectAttempts: 2, connected: false })
    handle?.setUnansweredNegotiations(1)
    expect(await s.connect('bluetooth')).toBe(true)
    expect(s.getSnapshot().connectError).toBeNull()
    expect(s.getSnapshot().connection).toBe('CONNECTED')
    // "다시 연결"은 다시 고르기부터 (고르기 창 두 번째)
    expect(handle?.fakeB1()).toEqual({ requests: 2, connectAttempts: 4, connected: true })
  }, 10_000)
})
