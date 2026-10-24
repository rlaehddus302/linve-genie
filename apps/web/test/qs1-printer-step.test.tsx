// QS1 시작 마법사 프린터 단계의 연결 실패 상자 (AC-QS1-26, D-QS1-07, AC-FB1-38·39 — 빠졌던 시험). 화면 파일은 고치지 않고 그대로 그린다.
// 문장 · list "해볼 일"(①②③④⑤ 차례 — 그 기기에 맞는 것만) · 그 아래 "다시 연결" 하나 · "자세히"는 쉬운 말만 · 허용 밖 라틴 낱말 없음. 끊김도 같은 목록.
import { createBitmap } from '@livejjim/label'
import { RETRIED_TIMEOUT_DETAIL, createFakePrinter, printerError, type ConnectionMethod, type PrinterAdapter, type PrinterErrorCode } from '@livejjim/printer'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrinterStep } from '../src/components/wizard/PrinterStep.tsx'
import { PrintContext } from '../src/components/print-context.tsx'
import { PrintStore } from '../src/lib/print-store.ts'
import { PrinterStation } from '../src/lib/printer-station.ts'
import { overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

const TIPS = {
  power: "프린터 전원을 껐다 켠 뒤 '다시 연결'을 눌러 주세요.",
  app: '휴대폰의 NIIMBOT 앱이 프린터에 이어져 있으면 앱을 닫아 주세요. 프린터는 한 기기에만 이어져요.',
  windows: "윈도우 설정 → 블루투스 및 장치에서 B1을 '장치 제거'한 뒤 여기서 '다시 연결'을 눌러 목록에서 B1을 골라 주세요. 윈도우에서 미리 연결(페어링)하지 않아도 돼요.",
  usb: 'USB 선이 있으면 USB 연결로 해 보세요.',
  android: "그래도 안 되면 안드로이드 폰의 크롬에서 라이브지니에 로그인해 프린터를 연결하고 '이 기기에서 출력'을 눌러 주세요. 컴퓨터에서 만든 라벨도 그 폰이 찍어요.",
}
const CONNECT_FAILED = '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.'
const AGENTS = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
}

/** 허용 라틴 낱말 (AC-FB1-38): B1·NIIMBOT·Marklife·USB·PNG·PDF와 기기·모델 이름 */
function latinWords(text: string): string[] {
  const ok = new Set(['B1', 'NIIMBOT', 'Marklife', 'USB', 'PNG', 'PDF'])
  return (text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => !ok.has(word))
}

/** 늘 정한 오류로 연결에 실패하는 프린터 (자세히 = 쉬운 말 상세) */
function failingAdapter(code: PrinterErrorCode, methods: ConnectionMethod[]): PrinterAdapter {
  const fake = createFakePrinter({ methods })
  return {
    get profile() {
      return fake.profile
    },
    get state() {
      return fake.state
    },
    onStateChange: (listener) => fake.onStateChange(listener),
    availableMethods: () => [...methods],
    connect: async () => ({ ok: false, error: { ...printerError(code), detail: RETRIED_TIMEOUT_DETAIL } }),
    disconnect: () => fake.disconnect(),
    print: (image, options) => fake.print(image, options),
  }
}

let server: FakeServer
let made: { store: PrintStore; station: PrinterStation } | null = null

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  server = new FakeServer()
  server
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: false } }))
    .on('GET', /^\/api\/print$/, () => ({ body: overview({ queue: queue({ rev: 1 }) }) }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
  vi.stubGlobal('fetch', server.fetch)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  made?.station.stop()
  made?.store.stop()
  made = null
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window.navigator, 'userAgent')
})

function useAgent(agent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: agent, configurable: true })
}

async function failedStep(code: PrinterErrorCode, serial: boolean): Promise<HTMLElement> {
  const methods: ConnectionMethod[] = serial ? ['bluetooth', 'serial'] : ['bluetooth']
  const store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  const station = new PrinterStation({
    store,
    deviceId: 'device-me-1234',
    createAdapter: () => failingAdapter(code, methods),
    detect: () => methods,
    render: async () => ({ ok: true, image: createBitmap(384, 240) }),
    renderTest: async () => ({ ok: true, image: createBitmap(384, 240) }),
    requestWakeLock: null,
    today: () => DATE,
  })
  made = { store, station }
  store.start()
  station.start()
  await flush()
  render(
    <PrintContext.Provider value={{ store, station }}>
      <PrinterStep />
    </PrintContext.Provider>,
  )
  await screen.findByRole('group', { name: '연결 방법' })
  await act(async () => {
    await station.connect('bluetooth')
  })
  return await waitFor(() => screen.getByRole('alert'))
}

describe('시작 마법사 프린터 단계 — 연결 실패 상자 (AC-QS1-26)', () => {
  it('연결하지 못함 · 윈도우 · USB 있음: 문장 → 해볼 일 ①②③④⑤ → "다시 연결" 하나 → 자세히(쉬운 말), 라틴 낱말 없음', async () => {
    useAgent(AGENTS.windows)
    const box = await failedStep('CONNECT_FAILED', true)
    const sentence = within(box).getByText(CONNECT_FAILED)
    const list = within(box).getByRole('list', { name: '해볼 일' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([TIPS.power, TIPS.app, TIPS.windows, TIPS.usb, TIPS.android])
    const retries = within(box).getAllByRole('button', { name: '다시 연결' })
    expect(retries).toHaveLength(1)
    const retry = retries[0] as HTMLElement
    const details = within(box).getByText('자세히')
    expect(within(box).getByText(RETRIED_TIMEOUT_DETAIL)).toBeDefined()
    // 차례: 문장 → 해볼 일 → 다시 연결 → 자세히
    expect(sentence.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(retry.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(latinWords(box.textContent ?? '')).toEqual([])
  })

  it('맥 · USB 없음: ③④ 없음 (①②⑤)', async () => {
    useAgent(AGENTS.mac)
    const box = await failedStep('CONNECT_FAILED', false)
    const list = within(box).getByRole('list', { name: '해볼 일' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([TIPS.power, TIPS.app, TIPS.android])
    expect(within(box).getAllByRole('button', { name: '다시 연결' })).toHaveLength(1)
    expect(latinWords(box.textContent ?? '')).toEqual([])
  })

  it('안드로이드 · USB 있음: ⑤ 없음 (①②④)', async () => {
    useAgent(AGENTS.android)
    const box = await failedStep('CONNECT_FAILED', true)
    const list = within(box).getByRole('list', { name: '해볼 일' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([TIPS.power, TIPS.app, TIPS.usb])
    expect(latinWords(box.textContent ?? '')).toEqual([])
  })

  it('끊김도 같은 목록 (윈도우 · USB 있음)', async () => {
    useAgent(AGENTS.windows)
    const box = await failedStep('DISCONNECTED', true)
    expect(within(box).getByText('프린터 연결이 끊겼어요.')).toBeDefined()
    const list = within(box).getByRole('list', { name: '해볼 일' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([TIPS.power, TIPS.app, TIPS.windows, TIPS.usb, TIPS.android])
    expect(within(box).getAllByRole('button', { name: '다시 연결' })).toHaveLength(1)
    expect(latinWords(box.textContent ?? '')).toEqual([])
  })
})
