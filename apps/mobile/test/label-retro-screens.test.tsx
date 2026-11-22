// 11월 12일 라이브 복기의 라벨 고침 — 화면 (docs/retro/2026-11-12-improvement-plan.md F1·F3, D-RETRO-40·41·44):
// - 라이브 관리 "라벨·프린터": "라벨 없는 판매 n건 뽑기". 라벨 탭: [대기 중인 라벨 모두 출력하기] (D-PRINTALL-01 — 옛 라이브 관리 "대기 n장 지금 뽑기").
//   프린터가 없으면 [다시 연결] 안내.
// - 출력 내역에서 고쳐 다시 인쇄: "상품 정보도 같이 고칠까요?" — 왼쪽 [이 라벨만] · 오른쪽 [상품도 고치기](가격은 입금 전 찜에도).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LabelView, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { LinkView } from '@livejjim/web/src/api/types.ts'
import { fixPlan } from '../src/lib/label-fix.ts'
import { FIX_AMOUNT_KEPT, FIX_DONE, FIX_DONE_SAME, FIX_LABEL_ONLY, FIX_NUMBER_LABEL_ONLY, FIX_PRICE_LABEL_ONLY, FIX_PRODUCT_TOO, FIX_QUESTION, PRINT_ALL_WAITING, WAITING_NEED_PRINTER, WAITING_RECONNECT, fixDescription, keepReconnectingMessage, missingQueued, missingRowTitle, waitingResult } from '../src/lib/print-words.ts'
import { PrintAllWaiting, liveWaitingCount, missingLabelCount } from '../src/screens/LabelBacklog.tsx'
import { LABEL_PRINT_ROWS, LabelPrintRows } from '../src/screens/LabelPrintScreen.tsx'
import { PrintHistory } from '../src/screens/PrintHistory.tsx'
import { ScopeConsole } from '../src/screens/console/scope.tsx'
import { ManageScreen } from '../src/screens/console/StackScreens.tsx'
import { makeWorld, type ScreenWorld } from './screen-support.tsx'
import { changes, flush } from './support.ts'

const ME = 'app-test'
const DAY = '2026-10-29'
const queueOf = (patch: Partial<QueueSummary> = {}): QueueSummary => ({ rev: 1, device: { id: ME, name: '내 휴대폰', live: true, printerConnected: true, releasing: false, profileId: null }, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true, labelSizes: ['50x30'], ...patch })

const labelOf = (no: number, claim: string, patch: Partial<LabelView> = {}): LabelView => {
  const buyer = { kind: 'youtube', name: '홍길동' } as const
  const data = { no, name: '로라', price: 30000, date: DAY, buyer }
  return { key: `${claim}@1`, claim, version: 1, broadcast: 'b1', no, buyerId: null, buyer, date: DAY, kind: 'product', state: 'NONE', word: '', voided: false, discard: 0, reprintNeeded: false, printed: 0, history: [], winner: true, data, canPrint: true, canReprint: false, ...patch }
}

async function openScope(world: ScreenWorld) {
  await waitFor(() => expect(world.source()).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: DAY, rehearsal: false, seq: world.seq }])
    await flush()
  })
}

async function openManage(world: ScreenWorld) {
  // 앱 뿌리처럼 로그인한 동안 라벨 대기열을 돌린다
  world.services.labels.start()
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } as unknown as LinkView }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
  render(world.wrap(<ManageScreen broadcastId="b1" onBack={() => {}} openLink={() => {}} labels={{ openStep: () => {} }} />))
  await openScope(world)
  const page = await screen.findByRole('main', { name: '라이브 관리' })
  return within(within(page).getByRole('group', { name: '라벨·프린터' }))
}

describe('F1 라이브 관리의 쌓인 라벨 줄', () => {
  it('대기도 라벨 없는 판매도 없으면 줄이 없다', async () => {
    const world = makeWorld({ products: [] })
    const group = await openManage(world)
    await waitFor(() => expect(group.getByRole('button', { name: LABEL_PRINT_ROWS.connect })).toBeTruthy())
    await act(() => flush())
    expect(group.queryByTestId('label-backlog')).toBeNull()
  })

  // D-PRINTALL-01 (사용자 지시 2026-11-17 "대기 중인 라벨은 라벨 탭에서 볼 수 있으니까 거기서 [대기 중인 라벨 모두 출력하기]"): 옛 라이브 관리 "대기 2장 지금 뽑기" 줄을 라벨 탭 단추로 옮김
  it('[대기 중인 라벨 모두 출력하기]: 프린터가 없으면 먼저 [다시 연결]로 안내하고, 이으면 멈춤을 풀고 차례로 뽑는다 · 라이브 관리에는 대기 줄이 없다', async () => {
    const world = makeWorld({ products: [] })
    let summary = queueOf({ rev: 3, waiting: 2, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false }, device: { id: ME, name: '내 휴대폰', live: true, printerConnected: false, releasing: false, profileId: null } })
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary, jobs: [], discard: [], live: true } }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, (call) => {
      if (call.body?.connected === true) summary = queueOf({ rev: summary.rev + 1, waiting: 2 })
      return { body: { queue: summary } }
    })
    world.server.on('POST', /^\/api\/print\/claim$/, () => ({ body: { job: null, reason: 'EMPTY' } }))
    const manage = await openManage(world)
    await waitFor(() => expect(manage.getByRole('button', { name: LABEL_PRINT_ROWS.connect })).toBeTruthy())
    await act(() => flush())
    expect(manage.queryByRole('button', { name: /지금 뽑기/ })).toBeNull()
    render(world.wrap(<PrintAllWaiting />))
    const box = within(await screen.findByTestId('print-all-waiting'))
    const go = box.getByRole('button', { name: PRINT_ALL_WAITING })
    fireEvent.click(go)
    expect((await box.findByText(WAITING_NEED_PRINTER)).closest('[role="alert"]')).toBeTruthy()
    // 다시 연결은 이 묶음에 하나
    const reconnect = box.getByRole('button', { name: WAITING_RECONNECT })
    expect(box.getAllByRole('button', { name: WAITING_RECONNECT })).toHaveLength(1)
    world.ble.restoreRemembered({ method: 'bluetooth', deviceId: 'fake-b1' })
    fireEvent.click(reconnect)
    await waitFor(() => expect(screen.getByTestId('print-all-waiting').textContent).toContain('라벨 2장을 차례로 뽑고 있어요.'))
    expect(box.queryByText(WAITING_NEED_PRINTER)).toBeNull()
    expect(box.queryByRole('button', { name: WAITING_RECONNECT })).toBeNull()
    expect(world.server.callsTo('POST', /device\/state/).at(-1)?.body).toMatchObject({ connected: true })
    expect(world.server.callsTo('POST', /print\/claim/).length).toBeGreaterThan(0)
  })

  it('대기 라벨이 없으면 [대기 중인 라벨 모두 출력하기]가 없다', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueOf(), jobs: [], discard: [], live: true } }))
    world.services.labels.start()
    render(world.wrap(<PrintAllWaiting />))
    await act(() => flush())
    expect(screen.queryByRole('button', { name: PRINT_ALL_WAITING })).toBeNull()
  })

  it('"라벨 없는 판매 n건 뽑기": 이 방송의 라벨 없는 1등 찜 수를 보이고, 누르면 한꺼번에 대기열에 넣는다 (같은 요청 번호로 한 번만)', async () => {
    const world = makeWorld({ products: [] })
    let summary = queueOf({ rev: 2 })
    let labels: LabelView[] = [labelOf(333, 'c1'), labelOf(419, 'c2'), labelOf(372, 'c3'), labelOf(7, 'c4', { canPrint: false, canReprint: true, state: 'PRINTED', word: '라벨 출력됨', printed: 1 }), labelOf(1, 'x1', { broadcast: 'other' })]
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary, jobs: [], discard: [] } }))
    world.server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: DAY, labels } }))
    let fail = true
    world.server.on('POST', /^\/api\/print\/labels\/print-missing$/, () => {
      if (fail) {
        fail = false
        return { status: 409, body: { error: { code: 'REQUEST_ERROR', message: '잠시 뒤 다시 눌러 주세요.' } } }
      }
      labels = labels.map((label) => ({ ...label, canPrint: false }))
      summary = queueOf({ rev: 3, waiting: 3 })
      return { body: { jobs: [{}, {}, {}] } }
    })
    const group = await openManage(world)
    const row = await group.findByRole('button', { name: missingRowTitle(3) })
    fireEvent.click(row)
    expect(await group.findByText('잠시 뒤 다시 눌러 주세요.')).toBeTruthy()
    fireEvent.click(group.getByRole('button', { name: missingRowTitle(3) }))
    // 넣은 뒤 바로 뽑으려 한다 — 프린터가 없으니 [다시 연결]로 안내
    expect(await group.findByText(missingQueued(3))).toBeTruthy()
    expect(group.getByText(WAITING_NEED_PRINTER)).toBeTruthy()
    const sent = world.server.callsTo('POST', /print-missing/).map((call) => call.body)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual({ requestId: sent[1]?.requestId, b: 'b1' })
    // 다 넣었으니 줄이 사라진다 (D-PRINTALL-01: 옛 "대기 줄이 생긴다" — 대기 라벨 뽑기는 라벨 탭으로 옮겼다)
    await waitFor(() => expect(group.queryByRole('button', { name: /라벨 없는 판매/ })).toBeNull())
    expect(group.queryByRole('button', { name: /지금 뽑기/ })).toBeNull()
  })

  // D-MANAGE-01: 출력 내역 줄을 없애 판매자인지를 seller로 바로 넘긴다 (옛: 출력 내역 줄이 있는 화면 = 판매자)
  it('판매자가 아니면 라벨 없는 판매 줄을 보이지 않는다', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: DAY, labels: [labelOf(333, 'c1')] } }))
    world.services.labels.start()
    render(world.wrap(<ScopeConsole broadcastId="b1" waiting={null}>{() => <LabelPrintRows openStep={() => {}} seller={false} />}</ScopeConsole>))
    await openScope(world)
    const group = within(screen.getByTestId('label-print-rows'))
    await waitFor(() => expect(group.getByRole('button', { name: LABEL_PRINT_ROWS.connect })).toBeTruthy())
    await act(() => flush())
    expect(group.queryByRole('button', { name: /라벨 없는 판매/ })).toBeNull()
  })

  it('세는 법·문구', () => {
    expect(missingLabelCount([labelOf(1, 'a'), labelOf(2, 'b', { canPrint: false }), labelOf(3, 'c', { broadcast: 'b2' }), labelOf(4, 'd', { kind: 'packing' })], 'b1')).toBe(1)
    // 라이브 라벨 탭의 출력 단추는 그 라이브의 대기 라벨 수로 보인다 (D-LIVEPRINT-02 — 전체 대기 수에는 끝난 라이브 라벨이 없다)
    expect(liveWaitingCount([labelOf(1, 'a', { state: 'WAITING' }), labelOf(2, 'b', { state: 'PRINTED' }), labelOf(3, 'c', { state: 'WAITING', broadcast: 'b2' }), labelOf(4, 'd', { state: 'WAITING', kind: 'packing' })], 'b1')).toBe(1)
    expect(PRINT_ALL_WAITING).toBe('대기 중인 라벨 모두 출력하기') // D-PRINTALL-01 (옛 waitingRowTitle '대기 2장 지금 뽑기')
    expect(missingRowTitle(6)).toBe('라벨 없는 판매 6건 뽑기')
    expect(missingQueued(0)).toBe('새로 넣을 라벨이 없어요. 이미 다 넣었어요.')
    expect(waitingResult({ kind: 'needPrinter' })).toBeNull()
    expect(waitingResult({ kind: 'other', name: '가게 폰', printing: false })).toEqual({ tone: 'danger', text: "출력 기기('가게 폰')에서 프린터를 다시 연결해 주세요." })
    expect(waitingResult({ kind: 'other', name: '가게 폰', printing: true })?.tone).toBe('success')
    expect(keepReconnectingMessage(9)).toBe('프린터에 다시 연결하고 있어요. 라이브 중에는 연결될 때까지 계속 해 봐요. (9번째)')
    // 화면 문구에 개발 용어·영어 상태값이 없다
    for (const text of [PRINT_ALL_WAITING, missingRowTitle(1), missingQueued(2), WAITING_NEED_PRINTER, FIX_QUESTION, FIX_LABEL_ONLY, FIX_PRODUCT_TOO, FIX_DONE, FIX_DONE_SAME, FIX_AMOUNT_KEPT, FIX_NUMBER_LABEL_ONLY, FIX_PRICE_LABEL_ONLY, keepReconnectingMessage(1), fixDescription({ name: '로라', price: '30,000원' })]) {
      expect(text).not.toMatch(/[A-Za-z]{2,}/)
    }
  })
})

describe('F3 고쳐 다시 뽑기: 상품 정보도 같이 고칠까요?', () => {
  const printed = (patch: Partial<LabelView> = {}): LabelView => {
    const base = labelOf(308, 'c308', { state: 'PRINTED', word: '라벨 출력됨', printed: 1, canPrint: false, canReprint: true })
    return { ...base, history: [{ at: '2026-10-29T04:38:36.000Z', device: '내 휴대폰', jobId: 'j308', data: base.data as never }], ...patch }
  }

  async function openEdit(label: LabelView = printed()) {
    const world = makeWorld({ products: [] })
    let current = label
    world.server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: DAY, labels: [current] } }))
    world.server.on('POST', /^\/api\/print\/labels\/reprint$/, () => ({ body: { jobs: [{}] } }))
    // 쓰기 뒤 따라잡기 (범위 자료가 응답 seq까지 온 뒤에 다음 일을 한다)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (_call, match) => ({ body: changes(Number(match[1]), world.seq) }))
    world.services.labels.start()
    render(world.wrap(<ScopeConsole broadcastId="b1" waiting={null}>{({ broadcast }) => <PrintHistory id="b1" date={broadcast.date} sealed={false} onBack={() => {}} />}</ScopeConsole>))
    await openScope(world)
    fireEvent.click(await screen.findByRole('button', { name: /308번 로라/ }))
    await screen.findByLabelText('품종')
    return { world, setLabel: (next: LabelView) => { current = next } }
  }
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const reprints = (world: ScreenWorld) => world.server.callsTo('POST', /labels\/reprint/).map((call) => call.body)

  it('품종·가격을 고치면 묻는다 — 왼쪽 [이 라벨만] · 오른쪽 [상품도 고치기] 한 줄. [상품도 고치기]면 상품 수정(가격은 입금 전 찜에도)을 먼저 보내고 다시 인쇄한다', async () => {
    const { world, setLabel } = await openEdit()
    // 서버: 상품 수정이 기록되면 그 찜의 금액·품종도 바뀐다 (입금 전 찜)
    world.server.on('POST', /^\/api\/events/, (call) => {
      world.events.push(call)
      world.seq += 1
      setLabel(printed({ data: { no: 308, name: '로라클론', price: 70000, date: DAY, buyer: { kind: 'youtube', name: '홍길동' } } }))
      return { body: { date: DAY, rehearsal: false, seq: world.seq, type: 'product.update', changed: true, effects: [] } }
    })
    type('품종', '로라클론')
    type('가격 (원)', '70000')
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    const dialog = await screen.findByRole('dialog', { name: FIX_QUESTION })
    expect(dialog.textContent).toContain("품종 '로라클론'")
    expect(dialog.textContent).toContain('가격 70,000원')
    expect(dialog.textContent).toContain('가격은 입금 전인 찜에도 적용돼요.')
    // 단추는 좌우 한 줄: 부정 왼쪽 · 긍정 오른쪽 (절대 규칙 8)
    expect(within(within(dialog).getByTestId('sheet-actions')).getAllByRole('button').map((button) => button.textContent)).toEqual([FIX_LABEL_ONLY, FIX_PRODUCT_TOO])
    // 묻는 동안에는 아무것도 보내지 않는다
    expect(world.events).toHaveLength(0)
    expect(reprints(world)).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: FIX_PRODUCT_TOO }))
    expect(await screen.findByText(FIX_DONE)).toBeTruthy()
    expect(world.events.map((call) => call.body)).toEqual([{ requestId: expect.any(String), type: 'product.update', b: 'b1', no: 308, name: '로라클론', price: 70000, applyTo: 'UNPAID_CLAIMS' }])
    expect(reprints(world)).toEqual([{ requestId: expect.any(String), b: 'b1', claim: 'c308', version: 1, edits: { name: '로라클론', price: 70000 } }])
    // 상품 수정이 다시 인쇄보다 먼저 나갔다
    const order = world.server.calls.filter((call) => call.method === 'POST' && /events|reprint/.test(call.path)).map((call) => (call.path.includes('events') ? 'product' : 'print'))
    expect(order).toEqual(['product', 'print'])
    expect(screen.queryByText(FIX_AMOUNT_KEPT)).toBeNull()
  })

  it('[이 라벨만]이면 상품은 그대로 두고 그 라벨만 고쳐 뽑는다', async () => {
    const { world } = await openEdit()
    type('품종', '로라클론')
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    const dialog = await screen.findByRole('dialog', { name: FIX_QUESTION })
    expect(dialog.textContent).not.toContain('입금 전')
    fireEvent.click(within(dialog).getByRole('button', { name: FIX_LABEL_ONLY }))
    expect(await screen.findByText('출력 대기열에 넣었어요.')).toBeTruthy()
    expect(world.events).toHaveLength(0)
    expect(reprints(world)).toEqual([{ requestId: expect.any(String), b: 'b1', claim: 'c308', version: 1, edits: { name: '로라클론' } }])
  })

  it('번호·닉네임만 고쳤으면 묻지 않고 그 라벨만 뽑는다 (상품 번호는 바꾸지 않는다)', async () => {
    const { world } = await openEdit()
    type('번호', '309')
    expect(screen.getByText(FIX_NUMBER_LABEL_ONLY)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    expect(await screen.findByText('출력 대기열에 넣었어요.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: FIX_QUESTION })).toBeNull()
    expect(world.events).toHaveLength(0)
    expect(reprints(world)).toEqual([{ requestId: expect.any(String), b: 'b1', claim: 'c308', version: 1, edits: { no: 309 } }])
  })

  it('상품 수정이 거절되면 인쇄하지 않고 까닭을 보인다 — 다시 누르면 같은 요청 번호로 다시 보낸다', async () => {
    const { world } = await openEdit()
    let reject = true
    const events: unknown[] = []
    world.server.on('POST', /^\/api\/events/, (call) => {
      events.push(call.body)
      if (reject) return { status: 409, body: { error: { code: 'REQUEST_ERROR', message: '끝난 라이브의 상품은 고칠 수 없어요.' } } }
      world.seq += 1
      return { body: { date: DAY, rehearsal: false, seq: world.seq, type: 'product.update', changed: true, effects: [] } }
    })
    expect(events).toHaveLength(0)
    type('가격 (원)', '50000')
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: FIX_QUESTION })).getByRole('button', { name: FIX_PRODUCT_TOO }))
    expect(await screen.findByText('끝난 라이브의 상품은 고칠 수 없어요.')).toBeTruthy()
    expect(reprints(world)).toHaveLength(0)
    reject = false
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: FIX_QUESTION })).getByRole('button', { name: FIX_PRODUCT_TOO }))
    expect(await screen.findByText(FIX_DONE)).toBeTruthy()
    expect(events).toHaveLength(2)
    expect((events[0] as { requestId: string }).requestId).toBe((events[1] as { requestId: string }).requestId)
    expect(reprints(world)).toHaveLength(1)
  })

  it('그 찜의 금액이 그대로면(이미 입금된 찜) 그렇게 알린다 — 라벨에는 고친 가격', async () => {
    // 상품을 고친 뒤에도 그 라벨의 지금 금액은 30,000원 그대로다 (엔진은 입금된 찜의 금액을 바꾸지 않는다)
    const { world, setLabel } = await openEdit()
    type('가격 (원)', '50000')
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: FIX_QUESTION })).getByRole('button', { name: FIX_PRODUCT_TOO }))
    expect(await screen.findByText(FIX_DONE)).toBeTruthy()
    expect(screen.getByText(FIX_AMOUNT_KEPT)).toBeTruthy()
    expect(reprints(world)).toEqual([{ requestId: expect.any(String), b: 'b1', claim: 'c308', version: 1, edits: { price: 50000 } }])
    // 대기열에 들어가 그 라벨이 "다시 인쇄할 수 없는" 상태(라벨 대기)로 바뀌어도 결과와 알림은 남는다
    const loads = world.server.callsTo('GET', /print\/labels/).length
    setLabel(printed({ canReprint: false, state: 'WAITING', word: '라벨 대기' }))
    await act(async () => {
      world.source().emit('print', { rev: 9, queue: queueOf({ rev: 9, waiting: 1 }), jobs: [], labels: [] })
      await flush()
    })
    await waitFor(() => expect(world.server.callsTo('GET', /print\/labels/).length).toBeGreaterThan(loads))
    await act(() => flush())
    expect(screen.getByText(FIX_DONE)).toBeTruthy()
    expect(screen.getByText(FIX_AMOUNT_KEPT)).toBeTruthy()
    expect(screen.queryByLabelText('품종')).toBeNull()
  })

  it('상품이 이미 그 값이면(바뀐 것 없음) 그렇게 말하고 라벨은 뽑는다 — 찜 금액이 그대로인 것도 알린다', async () => {
    // 앞서 상품 가격만 새 찜부터 고쳐 둔 경우: 상품 수정은 바뀐 것이 없고(changed false) 그 찜의 금액은 옛 값 그대로다
    const { world } = await openEdit()
    world.server.on('POST', /^\/api\/events/, (call) => {
      world.events.push(call)
      return { body: { date: DAY, rehearsal: false, seq: world.seq, type: 'product.update', changed: false, effects: [] } }
    })
    type('가격 (원)', '50000')
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 인쇄' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: FIX_QUESTION })).getByRole('button', { name: FIX_PRODUCT_TOO }))
    expect(await screen.findByText(FIX_DONE_SAME)).toBeTruthy()
    expect(screen.getByText(FIX_AMOUNT_KEPT)).toBeTruthy()
    expect(screen.queryByText(FIX_DONE)).toBeNull()
    expect(reprints(world)).toHaveLength(1)
  })

  it('fixPlan: 상품에는 품종·가격만. 수량이 여럿이거나 옵션이 있는 찜의 가격과 번호·닉네임은 라벨에만', () => {
    const data = { no: 308, name: '로라', price: 30000, date: DAY, buyer: { kind: 'youtube', name: '홍길동' } } as const
    expect(fixPlan(data, {})).toEqual({ product: null, priceLabelOnly: false, labelOnly: false })
    expect(fixPlan(data, { name: '로라클론', price: 70000 })).toEqual({ product: { name: '로라클론', price: 70000 }, priceLabelOnly: false, labelOnly: false })
    expect(fixPlan(data, { no: 309, nickname: '길동' })).toEqual({ product: null, priceLabelOnly: false, labelOnly: true })
    expect(fixPlan({ ...data, qty: 2 }, { price: 70000 })).toEqual({ product: null, priceLabelOnly: true, labelOnly: false })
    expect(fixPlan({ ...data, variant: '대' }, { name: '로라클론', price: 70000 })).toEqual({ product: { name: '로라클론' }, priceLabelOnly: true, labelOnly: false })
  })
})
