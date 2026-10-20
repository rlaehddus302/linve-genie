// 콘솔의 라벨 (AC-I1-30·32·33·36): 보드의 라벨 상태는 서버 출력 기록, 알림 띠의 출력 멈춤·버릴 라벨(Alt+1 순서), Alt+P 다시 출력, 리허설은 라벨 없음.
// 실시간 연결은 페이지에 하나다(콘솔 범위 알림과 출력 알림이 같은 연결).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { LabelView, PrintOverview } from '../src/api/print-types.ts'
import type { Claim } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { PrintProvider } from '../src/components/print-context.tsx'
import { job, labelView, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, broadcastItem, flush, fullView, product } from './support.ts'

let server: FakeServer
let current: PrintOverview
let labels: LabelView[]
let rehearsal: boolean

function winner(id: string, buyer: string): Claim {
  return {
    id,
    product: 'b1/15',
    productId: 'p1',
    broadcast: 'b1',
    no: 15,
    buyer,
    currentBuyer: buyer,
    status: 'CONFIRMED',
    reason: null,
    origin: 'chat',
    seq: 2,
    rankTime: '2026-10-19T01:00:00.000Z',
    rankMinute: false,
    received: null,
    at: '2026-10-19T01:00:00.000Z',
    price: 10000,
    confirmVersion: 1,
    locked: true,
    cancelRequested: false,
    reprintNeeded: false,
    priceHistory: [],
  }
}

const buyer = (id: string, display: string) => ({
  id,
  kind: 'youtube' as const,
  current: id,
  mergedInto: null,
  merged: [],
  display,
  nameHistory: [display],
  phoneLast4: null,
  items: [],
  subtotal: 0,
  byBroadcast: {},
  blocked: false,
})

beforeEach(() => {
  window.sessionStorage.clear()
  server = new FakeServer()
  current = overview()
  labels = [labelView('c1@1', { state: 'PRINTED', word: '라벨 출력됨', printed: 1, canPrint: false, canReprint: true, history: [{ at: '2026-10-19T11:01:00.000Z', device: '휴대폰' }] })]
  rehearsal = false
  const view = () =>
    fullView({
      seq: 3,
      rehearsal,
      products: [product(15, { winners: ['UC_A'], winnerClaims: ['c1'], status: 'SOLD' })],
      claims: [winner('c1', 'UC_A')],
      buyers: [buyer('UC_A', '우주천사')],
    })
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem({ rehearsal })] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 60, testPrinter: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: view() }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal, seq: 3, messages: [], more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/history\\?`), () => ({ body: { date: DATE, rehearsal, events: [] } }))
    .on('GET', /^\/api\/broadcasts\/b1\/rehearsal\/generator$/, () => ({ body: { generator: { running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null } } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openConsole(): Promise<HTMLInputElement> {
  render(
    <PrintProvider>
      <ConsolePage broadcastId="b1" navigate={() => {}} />
    </PrintProvider>,
  )
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return quick
}

const boardItem = () => within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: /^15번/ })

describe('보드 라벨 상태 (AC-I1-30)', () => {
  it('1등의 라벨 키 상태를 서버 기록 낱말로 — 알림이 오면 바뀐다. 실시간 연결은 하나', async () => {
    await openConsole()
    await waitFor(() => expect(boardItem().textContent).toContain('라벨 출력됨'))
    expect(FakeEventSource.instances).toHaveLength(1)
    FakeEventSource.last.emit('print', { rev: 2, queue: queue({ rev: 2 }), jobs: [], labels: [labelView('c1@1', { state: 'REPRINT_NEEDED', word: '재출력 필요', printed: 1, canPrint: false, canReprint: true })] })
    await waitFor(() => expect(boardItem().textContent).toContain('재출력 필요'))
    expect(boardItem().textContent).not.toContain('라벨 출력됨')
  })

  it('작업이 없는 1등은 낱말이 없다', async () => {
    labels = [labelView('c1@1')]
    await openConsole()
    await flush(5)
    expect(boardItem().textContent).not.toMatch(/라벨|출력/)
  })

  it('상품 자세히: 라벨 상태에 없는 1등(자동 출력 끔 — 문자찜·채팅으로 생긴 1등은 print 알림이 없다)은 그 날짜를 한 번 다시 받아 그 라벨을 보인다 (AC-I1-31, TE-I1-005)', async () => {
    labels = []
    await openConsole()
    await flush(5)
    const labelCalls = () => server.callsTo('GET', /^\/api\/print\/labels\?/).length
    expect(labelCalls()).toBe(1)
    // 서버는 작업이 없는 지금 1등도 라벨 상태(데이터 포함)로 준다
    labels = [labelView('c1@1')]
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    const group = within(within(detail).getByRole('region', { name: '라벨' })).getByRole('group', { name: '1등 우주천사 라벨' })
    await waitFor(() => expect(within(group).getByText('아직 출력하지 않았어요')).toBeTruthy())
    expect(labelCalls()).toBe(2)
    // 한 번만 (창이 다시 그려져도 거듭 받지 않는다)
    await flush(10)
    expect(labelCalls()).toBe(2)
  })

  it('리허설은 라벨 상태를 보이지 않고 조회하지도 않는다 — 자세히·Alt+P는 "리허설 방송은 라벨을 출력하지 않아요."', async () => {
    rehearsal = true
    const quick = await openConsole()
    await flush(5)
    expect(boardItem().textContent).not.toContain('라벨')
    expect(server.callsTo('GET', /^\/api\/print\/labels/)).toHaveLength(0)
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect(within(within(detail).getByRole('region', { name: '라벨' })).getByText('리허설 방송은 라벨을 출력하지 않아요.')).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '다시 출력' })).toBeNull()
    fireEvent.keyDown(detail, { key: 'Escape' })
    quick.focus()
    fireEvent.keyDown(quick, { key: 'p', code: 'KeyP', altKey: true })
    const dialog = await screen.findByRole('dialog', { name: '라벨 다시 출력' })
    expect(within(dialog).getByText('리허설 방송은 라벨을 출력하지 않아요.')).toBeTruthy()
  })
})

describe('Alt+P (AC-I1-33)', () => {
  it('빠른 입력칸에 글자가 들어가지 않고 창이 열린다: "15번 라벨을 다시 출력할까요? (1등: 우주천사)" — 처음 포커스 닫기, 1 = 다시 출력, 바로 서버 결과', async () => {
    server.on('POST', /^\/api\/print\/labels\/reprint$/, () => ({ body: { jobs: [job('r-abc', { reason: 'reprint' })] } }))
    const quick = await openConsole()
    await waitFor(() => expect(boardItem().textContent).toContain('라벨 출력됨'))
    quick.focus()
    const event = new KeyboardEvent('keydown', { key: 'π', code: 'KeyP', altKey: true, bubbles: true, cancelable: true })
    quick.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(quick.value).toBe('')
    const dialog = await screen.findByRole('dialog', { name: '라벨 다시 출력' })
    expect(within(dialog).getByText('15번 라벨을 다시 출력할까요? (1등: 우주천사)')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.keyDown(dialog, { key: '1' })
    expect(await within(dialog).findByText('다시 출력을 접수했어요.')).toBeTruthy()
    const [call] = server.callsTo('POST', /^\/api\/print\/labels\/reprint$/)
    expect(call?.body).toMatchObject({ b: 'b1', claim: 'c1', version: 1 })
    expect(String(call?.body?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(quick))
  })

  it('라벨 키에 작업이 없으면 "출력할까요?" → 라벨 출력, 서버 거절은 문장 그대로', async () => {
    labels = [labelView('c1@1')]
    server.on('POST', /^\/api\/print\/labels\/print$/, () => ({ status: 409, body: { error: { code: 'PRINT_NOT_WINNER', message: '지금 1등이 아니라 라벨을 출력할 수 없어요.' } } }))
    const quick = await openConsole()
    await flush(5)
    fireEvent.keyDown(quick, { key: 'p', code: 'KeyP', altKey: true })
    const dialog = await screen.findByRole('dialog', { name: '라벨 다시 출력' })
    expect(within(dialog).getByText('15번 라벨을 출력할까요? (1등: 우주천사)')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '1 출력' }))
    expect(await within(dialog).findByText('지금 1등이 아니라 라벨을 출력할 수 없어요.')).toBeTruthy()
  })
})

describe('알림 띠 (AC-I1-32)', () => {
  it('"출력 멈춤 · <까닭 문장>"과 "버릴 라벨 N" — Alt+1은 승계 결정 다음·확인 필요 앞의 순서로 출력 멈춤부터', async () => {
    current = overview({
      queue: queue({ discard: 1, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } }),
      discard: [job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요' })],
    })
    const quick = await openConsole()
    const strip = screen.getByRole('region', { name: '알림' })
    await waitFor(() => expect(within(strip).getByRole('button', { name: '출력 멈춤 · 프린터 연결이 끊겼어요.' })).toBeTruthy())
    expect(within(strip).getByRole('button', { name: '버릴 라벨 1' })).toBeTruthy()
    fireEvent.keyDown(quick, { key: '1', code: 'Digit1', altKey: true })
    const pause = await screen.findByRole('dialog', { name: '출력 멈춤' })
    expect(within(pause).getByText('프린터 연결이 끊겼어요.')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.keyDown(pause, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(quick))
    // 멈춤이 풀리면 버릴 라벨이 다음
    FakeEventSource.last.emit('print', { rev: 2, queue: queue({ rev: 2, discard: 1 }), jobs: [], labels: [] })
    await waitFor(() => expect(within(strip).queryByRole('button', { name: /^출력 멈춤/ })).toBeNull())
    fireEvent.keyDown(quick, { key: '1', code: 'Digit1', altKey: true })
    const discard = await screen.findByRole('dialog', { name: '버릴 라벨' })
    expect(within(discard).getByText('15번 · 우주천사 · 26.10.19 라벨을 버려 주세요')).toBeTruthy()
    expect(within(discard).getByRole('button', { name: '버렸어요' }).getAttribute('data-key')).toBe('1')
  })
})
