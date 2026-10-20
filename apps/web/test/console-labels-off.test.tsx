// 라벨 끄기 모드 — 콘솔·정산 자세히의 포장 라벨 (N4a, LABEL_RULES L-12 9·10, UX-05, D-N4a-05, AC-N4a-14·15·16·18·19·20).
// 꺼져 있으면 보드 라벨 상태·상품 자세히의 라벨·Alt+P 창·알림 "출력 멈춤"·단축키 안내의 Alt+P가 빠지고, 라벨 자리에 "라벨 쓰지 않음" 안내 — 버릴 라벨은 남는다.
// 켬/끔을 모르는 동안에도 라벨 조작을 보이지 않는다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { LabelView, PrintOverview } from '../src/api/print-types.ts'
import type { Claim } from '../src/api/types.ts'
import { ConsolePage, shortcutsWord } from '../src/components/ConsolePage.tsx'
import { PackingLabels } from '../src/components/LabelParts.tsx'
import { PrintProvider } from '../src/components/print-context.tsx'
import { job, labelView, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, flush, fullView, product } from './support.ts'

const OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'
const REFUSED = '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.'

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
  current = overview({ queue: queue({ labelsEnabled: false }) })
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
const sendLabels = (rev: number, enabled: boolean) =>
  act(() => {
    FakeEventSource.last.emit('labels', { rev, enabled, entry: { enabled, at: '2026-10-20T11:31:00.000Z', loginId: 'shop1' } })
  })

describe('콘솔 — 꺼져 있을 때 (AC-N4a-14)', () => {
  it('보드에 라벨 상태가 없고 라벨 상태를 조회하지도 않는다. 상품 자세히의 라벨 자리에는 안내 한 번 — 미리 보기·상태·이력·출력·그림 파일·PDF 없음, 나머지는 그대로', async () => {
    await openConsole()
    await flush(5)
    expect(boardItem().textContent).not.toMatch(/라벨|출력/)
    expect(server.callsTo('GET', /^\/api\/print\/labels/)).toHaveLength(0)
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    const region = within(detail).getByRole('region', { name: '라벨' })
    expect(within(region).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(detail).getAllByText(OFF_NOTE)).toHaveLength(1)
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
    for (const name of ['라벨 출력', '다시 출력', '그림 파일로 저장', '공유', 'PDF로 저장']) expect(within(detail).queryByRole('button', { name })).toBeNull()
    expect(region.textContent).not.toMatch(/라벨 출력됨|출력 ·|휴대폰/)
    // 1등·찜 조치는 그대로
    expect(within(detail).getByRole('region', { name: '1등' })).toBeTruthy()
    expect(within(detail).getAllByRole('button', { name: '찜 취소하기' }).length).toBeGreaterThan(0)
  })

  it('Alt+P는 창을 열지 않고 출력 요청도 보내지 않으며 안내를 알린다(role=status) — 빠른 입력칸 글자 없음·포커스 그대로. 단축키 안내에서 Alt+P가 빠진다', async () => {
    const quick = await openConsole()
    quick.focus()
    const event = new KeyboardEvent('keydown', { key: 'π', code: 'KeyP', altKey: true, bubbles: true, cancelable: true })
    quick.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.getAllByRole('status').some((el) => el.textContent === OFF_NOTE)).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(quick.value).toBe('')
    expect(document.activeElement).toBe(quick)
    expect(server.callsTo('POST', /^\/api\/print\//)).toHaveLength(0)
    const shortcuts = document.querySelector('.shortcuts')?.textContent ?? ''
    expect(shortcuts).toBe(shortcutsWord(false))
    expect(shortcuts).not.toContain('Alt+P')
    expect(shortcutsWord(true)).toContain('Alt+P(⌥P) 라벨 다시 출력')
  })

  it('알림 띠·Alt+1 순서에서 "출력 멈춤"이 빠진다(대기열이 멈춰 있어도) — 버릴 라벨은 남아 Alt+1로 열리고 "버렸어요"(숫자 키)', async () => {
    const discard = job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요' })
    current = overview({ queue: queue({ labelsEnabled: false, discard: 1, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: false } }), discard: [discard] })
    server.on('POST', /^\/api\/print\/jobs\/discard$/, () => ({ body: { job: { ...discard, discard: false, word: '폐기' } } }))
    const quick = await openConsole()
    const strip = screen.getByRole('region', { name: '알림' })
    await waitFor(() => expect(within(strip).getByRole('button', { name: '버릴 라벨 1' })).toBeTruthy())
    expect(within(strip).queryByRole('button', { name: /출력 멈춤/ })).toBeNull()
    fireEvent.keyDown(quick, { key: '1', code: 'Digit1', altKey: true })
    const dialog = await screen.findByRole('dialog', { name: '버릴 라벨' })
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.keyDown(dialog, { key: '1' })
    await waitFor(() => expect(server.callsTo('POST', /^\/api\/print\/jobs\/discard$/)).toHaveLength(1))
    expect(server.callsTo('POST', /^\/api\/print\/jobs\/discard$/)[0]?.body).toEqual({ date: DATE, id: 'd1' })
    // 서버는 모든 기기에 대기열 요약을 알린다
    act(() => {
      FakeEventSource.last.emit('print', { rev: 2, queue: queue({ rev: 2, labelsEnabled: false, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: false } }), jobs: [{ ...discard, discard: false, word: '폐기' }], labels: [] })
    })
    await waitFor(() => expect(within(strip).queryByRole('button', { name: /버릴 라벨/ })).toBeNull())
    expect(within(strip).queryByRole('button', { name: /출력 멈춤/ })).toBeNull()
  })

  it('리허설 콘솔은 라벨 문장이 아예 없다 ("리허설 방송은 라벨을 출력하지 않아요."도 없다)', async () => {
    rehearsal = true
    await openConsole()
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect(within(detail).queryByRole('region', { name: '라벨' })).toBeNull()
    expect(detail.textContent).not.toContain('리허설 방송은 라벨을 출력하지 않아요.')
    expect(detail.textContent).not.toContain(OFF_NOTE)
  })
})

describe('콘솔 — 바뀌면 바로, 모르면 숨김 (AC-N4a-18·19)', () => {
  it('상품 자세히 창이 열린 채 꺼지면 창은 그대로 두고 라벨 부분만 안내로(포커스를 빼앗지 않는다) — 다시 켜면 I1 모습으로 돌아온다', async () => {
    current = overview({ queue: queue({ labelsEnabled: true }) })
    await openConsole()
    await waitFor(() => expect(boardItem().textContent).toContain('라벨 출력됨'))
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    const group = within(within(detail).getByRole('region', { name: '라벨' })).getByRole('group', { name: '1등 우주천사 라벨' })
    expect(within(group).getByRole('button', { name: '다시 출력' })).toBeTruthy()
    const cancel = within(detail).getAllByRole('button', { name: '찜 취소하기' })[0] as HTMLElement
    cancel.focus()
    sendLabels(2, false)
    expect(screen.getByRole('dialog', { name: '15번 자세히' })).toBe(detail)
    expect(within(within(detail).getByRole('region', { name: '라벨' })).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '다시 출력' })).toBeNull()
    expect(document.activeElement).toBe(cancel)
    expect(boardItem().textContent).not.toContain('라벨 출력됨')
    sendLabels(3, true)
    await waitFor(() => expect(within(within(detail).getByRole('region', { name: '라벨' })).getByRole('button', { name: '다시 출력' })).toBeTruthy())
    await waitFor(() => expect(boardItem().textContent).toContain('라벨 출력됨'))
  })

  it('Alt+P 창이 열린 채 꺼지면 창 안은 안내로 바뀐다', async () => {
    current = overview({ queue: queue({ labelsEnabled: true }) })
    const quick = await openConsole()
    await waitFor(() => expect(boardItem().textContent).toContain('라벨 출력됨'))
    fireEvent.keyDown(quick, { key: 'p', code: 'KeyP', altKey: true })
    const dialog = await screen.findByRole('dialog', { name: '라벨 다시 출력' })
    sendLabels(2, false)
    expect(within(dialog).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /출력/ })).toBeNull()
  })

  it('켬/끔 조회가 늦는 동안 보드 라벨 상태·상품 자세히 라벨·Alt+P 창·출력 멈춤이 하나도 보이지 않는다', async () => {
    let release: (() => void) | null = null
    server.on('GET', /^\/api\/print$/, async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { body: current }
    })
    current = overview({ queue: queue({ labelsEnabled: true, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: false } }) })
    const quick = await openConsole()
    expect(boardItem().textContent).not.toMatch(/라벨|출력/)
    expect(within(screen.getByRole('region', { name: '알림' })).queryByRole('button', { name: /출력 멈춤/ })).toBeNull()
    fireEvent.keyDown(quick, { key: 'p', code: 'KeyP', altKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect(within(detail).queryByRole('region', { name: '라벨' })).toBeNull()
    expect(document.querySelector('.shortcuts')?.textContent).not.toContain('Alt+P')
    ;(release as (() => void) | null)?.()
    await waitFor(() => expect(within(detail).getByRole('region', { name: '라벨' })).toBeTruthy())
  })

  it('오래된 화면의 "다시 출력"이 LABELS_OFF로 거절되면 그 문장을 보이고 꺼진 상태로 다시 불러온다 — 다시 보내지 않는다', async () => {
    current = overview({ queue: queue({ labelsEnabled: true }) })
    server.on('POST', /^\/api\/print\/labels\/reprint$/, () => {
      current = overview({ queue: queue({ rev: 2, labelsEnabled: false }) })
      return apiError(409, 'LABELS_OFF', REFUSED)
    })
    await openConsole()
    await waitFor(() => expect(boardItem().textContent).toContain('라벨 출력됨'))
    fireEvent.click(boardItem())
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '다시 출력' }))
    const region = () => within(detail).getByRole('region', { name: '라벨' })
    expect(await within(region()).findByText(REFUSED)).toBeTruthy()
    expect(within(region()).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '다시 출력' })).toBeNull()
    await flush(5)
    expect(server.callsTo('POST', /^\/api\/print\/labels\/reprint$/)).toHaveLength(1)
  })
})

describe('정산 자세히의 포장 라벨 (AC-N4a-15)', () => {
  async function openPacking(rehearsalScope = false) {
    server.on('GET', /^\/api\/print\/packing\?/, () => ({ body: { date: DATE, buyer: 'UC_A', data: null, label: labelView('packing:UC_A', { kind: 'packing' }) } }))
    render(
      <PrintProvider>
        <PackingLabels date={DATE} buyer="UC_A" rehearsal={rehearsalScope} />
      </PrintProvider>,
    )
    await flush(10)
  }

  it('꺼져 있으면 포장 라벨 자리에 안내 — 미리 보기·포장 라벨 출력·PNG·PDF 없음, 포장 라벨 조회도 하지 않는다', async () => {
    await openPacking()
    const region = screen.getByRole('region', { name: '포장 라벨' })
    expect(within(region).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
    expect(server.callsTo('GET', /^\/api\/print\/packing/)).toHaveLength(0)
  })

  it('리허설 범위는 꺼져 있으면 라벨 문장이 없다', async () => {
    await openPacking(true)
    expect(screen.queryByRole('region', { name: '포장 라벨' })).toBeNull()
  })

  it('켜져 있으면 I1 그대로 "포장 라벨 출력"(보통 버튼)', async () => {
    current = overview()
    await openPacking()
    const region = screen.getByRole('region', { name: '포장 라벨' })
    const button = within(region).getByRole('button', { name: '포장 라벨 출력' })
    expect(button.className).toBe('button')
  })

  it('켬/끔을 모르면 비워 둔다', async () => {
    server.on('GET', /^\/api\/print$/, () => new Promise(() => {}))
    await openPacking()
    expect(screen.queryByRole('region', { name: '포장 라벨' })).toBeNull()
    expect(screen.queryByRole('button', { name: '포장 라벨 출력' })).toBeNull()
  })
})
