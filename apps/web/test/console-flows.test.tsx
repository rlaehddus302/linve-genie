// 라이브 콘솔 흐름 (S05 수정 라운드 1): 응답이 늦을 때의 빠른 입력(TE-S05-001), 찾은 번호 비우기(UX-S05-001),
// 사유 거절 뒤 다시 고치기(UX-S05-002), 알림 창·조치(AC-S05-30·32·33·34), 알기 쉬운 오류(AC-S05-71).
import { DEFAULT_SETTINGS, type SaleSettings } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attention, CancelRequest, ChatMessage, Claim, FullView, HistoryItem, PendingSlot, Product } from '../src/api/types.ts'
import { onUnauthorized } from '../src/api/client.ts'
import { CancelRequestDialog, PendingDialog } from '../src/components/AlertDialogs.tsx'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { ConsoleContext, type ConsoleApi, type HostActionInput } from '../src/components/console-context.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, broadcastView, emptyChanges, flush, fullView, product, type Reply } from './support.ts'

const PHONE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

/** 가짜 범위: 상품·찜·보류·취소 요청·확인 필요·이력을 들고 seq를 올린다 */
class Model {
  seq = 1
  settings: SaleSettings = { ...DEFAULT_SETTINGS }
  products = new Map<string, Product>()
  claims: Claim[] = []
  pending: PendingSlot[] = []
  cancelRequests: CancelRequest[] = []
  attention: Attention[] = []
  buyers: { id: string; display: string; blocked?: boolean }[] = []
  messages: ChatMessage[] = []
  history: HistoryItem[] = []
  /** 받아 기록한 이벤트 */
  events: Record<string, unknown>[] = []
  /** 보낸 쓰기 전부 (거절 포함): 경로·본문 */
  posts: { path: string; body: Record<string, unknown> }[] = []
  /** 이벤트마다 대신 줄 응답 (null이면 기록) */
  onEvent: ((event: Record<string, unknown>) => Reply | null) | null = null
  gate: Promise<void> | null = null

  view(): FullView {
    return fullView({
      seq: this.seq,
      broadcasts: [broadcastView({ settings: this.settings })],
      products: [...this.products.values()],
      claims: this.claims,
      pending: this.pending,
      cancelRequests: this.cancelRequests,
      attention: this.attention,
      buyers: this.buyers.map((buyer) => ({
        id: buyer.id,
        kind: 'youtube' as const,
        current: buyer.id,
        mergedInto: null,
        merged: [],
        display: buyer.display,
        nameHistory: [buyer.display],
        phoneLast4: null,
        items: [],
        subtotal: 0,
        byBroadcast: {},
        blocked: buyer.blocked === true,
      })),
    })
  }
}

let server: FakeServer
let model: Model

function setupServer(delay = 60) {
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem()] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: delay } }))
    .on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: model.view() }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: model.seq, messages: model.messages, more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/history\\?`), (call) => {
      const query = new URLSearchParams(call.path.split('?')[1])
      const after = Number(query.get('after') ?? 0)
      const limit = Number(query.get('limit') ?? 100)
      const no = query.get('no')
      const events = model.history.filter((item) => item.seq > after && (no === null || item.fields.no === Number(no))).slice(0, limit)
      return { body: { date: DATE, rehearsal: false, events } }
    })
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => {
      const since = Number(match[1])
      const view = model.view()
      return {
        body: {
          ...emptyChanges(since, model.seq),
          products: view.products,
          claims: view.claims,
          buyers: view.buyers,
          pending: view.pending,
          cancelRequests: view.cancelRequests,
          attention: model.attention.filter((item) => item.seq > since),
        },
      }
    })
    .on('POST', /^\/api\/events/, async (call) => {
      if (model.gate !== null) await model.gate
      const event = call.body ?? {}
      model.posts.push({ path: call.path, body: event })
      const reply = model.onEvent?.(event) ?? null
      if (reply !== null) return reply
      model.events.push(event)
      model.seq++
      let changed = true
      if (event.type === 'product.register') {
        const no = Number(event.no)
        changed = !model.products.has(`b1/${String(no)}`)
        if (changed) model.products.set(`b1/${String(no)}`, product(no, { id: `p${String(model.products.size + 1)}`, name: String(event.name), price: Number(event.price) }))
      }
      return { body: { date: DATE, rehearsal: false, seq: model.seq, type: event.type, changed, effects: [] } }
    })
}

beforeEach(() => {
  server = new FakeServer()
  model = new Model()
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openConsole() {
  const utils = render(<ConsolePage broadcastId="b1" shopName="구피 가게" onLogout={() => {}} navigate={() => {}} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush()
  return { ...utils, quick }
}

const enter = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

function gate(): () => void {
  let release: () => void = () => {}
  model.gate = new Promise<void>((resolve) => {
    release = () => {
      model.gate = null
      resolve()
    }
  })
  return () => release()
}

function claim(id: string, buyer: string, status: Claim['status'], patch: Partial<Claim> = {}): Claim {
  return {
    id,
    product: 'b1/15',
    productId: 'p1',
    broadcast: 'b1',
    no: 15,
    buyer,
    currentBuyer: buyer,
    status,
    reason: null,
    origin: 'chat',
    seq: 1,
    rankTime: '2026-10-19T01:00:00.000Z',
    rankMinute: false,
    received: null,
    at: '2026-10-19T01:00:00.000Z',
    price: status === 'CONFIRMED' ? 10000 : null,
    confirmVersion: status === 'CONFIRMED' ? 1 : null,
    locked: false,
    cancelRequested: false,
    reprintNeeded: false,
    priceHistory: [],
    ...patch,
  }
}

function historyItem(seq: number, type: string, fields: Record<string, unknown>, patch: Partial<HistoryItem> = {}): HistoryItem {
  return {
    seq,
    type,
    at: '2026-10-19T01:02:03.000Z',
    receivedAt: '2026-10-19T01:02:03.000Z',
    actor: { kind: 'account', loginId: 'shop1' },
    reason: null,
    fields,
    failed: false,
    ...patch,
  }
}

/** 창 하나만 그릴 때의 콘솔 값 */
function fakeApi(view: FullView): ConsoleApi & { readonly queued: HostActionInput[]; readonly filled: string[] } {
  const data = fromFull(view)
  const queued: HostActionInput[] = []
  const filled: string[] = []
  return {
    b: 'b1',
    date: DATE,
    rehearsal: false,
    ended: false,
    data,
    names: new BuyerNames(data.buyers, data.claims),
    waiting: { claims: new Set(), products: new Set() },
    delayMs: 5000,
    settingsOf: (id) => data.broadcasts.get(id)?.settings ?? null,
    openDialog: () => {},
    closeTop: () => {},
    closeAll: () => {},
    queueHost: (input) => queued.push(input),
    command: () => Promise.reject(new Error('보내지 않는다')),
    fillQuick: (text) => filled.push(text),
    select: () => {},
    queued,
    filled,
  }
}

describe('빠른 입력 — 등록 응답이 늦을 때 (TE-S05-001, AC-S05-10·12)', () => {
  it('Enter 때 칸의 글자를 골라 두어 다음 줄이 이어 붙지 않고, 미룬 줄은 차례대로 — 뒤 줄의 찾기는 앞 줄 등록을 본다', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '51 꽃 1만')
    expect([quick.selectionStart, quick.selectionEnd]).toEqual([0, '51 꽃 1만'.length])
    // 앞 등록 응답 전에 친 줄도 골라 둔다 (다음 글자가 그 뒤에 붙지 않고 바꾼다)
    enter(quick, '52 꽃 1만')
    expect([quick.selectionStart, quick.selectionEnd]).toEqual([0, '52 꽃 1만'.length])
    enter(quick, '52')
    expect([quick.selectionStart, quick.selectionEnd]).toEqual([0, 2])
    await flush()
    expect(model.events).toHaveLength(0)
    release()
    expect(await screen.findByRole('dialog', { name: '52번 자세히' })).toBeDefined()
    expect(screen.queryByText('가격을 알아보지 못했어요. 가격 칸에 적어 주세요.')).toBeNull()
    expect(model.events.map((event) => event.no)).toEqual([51, 52])
    expect(new Set(model.events.map((event) => event.requestId)).size).toBe(2)
    expect(quick.value).toBe('')
  })

  it('미룬 줄이 오류인데 판매자가 벌써 다음 줄을 치고 있으면 고치기 칸만 열고 커서는 빠른 입력칸에 둔다', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '51 꽃 1만')
    enter(quick, '52 꽃')
    fireEvent.change(quick, { target: { value: '53 장' } })
    quick.focus()
    release()
    expect(await screen.findByText('가격을 알아보지 못했어요. 가격 칸에 적어 주세요.')).toBeDefined()
    await flush()
    expect(document.activeElement).toBe(quick)
    expect(quick.value).toBe('53 장')
    expect((screen.getByLabelText('번호') as HTMLInputElement).value).toBe('52')
    expect(model.events.map((event) => event.no)).toEqual([51])
  })

  it('미룬 줄이 오류이고 판매자가 기다리고 있었으면 고칠 칸으로 커서를 보낸다', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '51 꽃 1만')
    enter(quick, '52 꽃')
    release()
    const price = (await screen.findByLabelText('가격')) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(price))
  })
})

describe('같은 번호 줄의 "고칠까요?"가 늦게 날 때 (TE-S05-002, AC-S05-10·13·42)', () => {
  it('판매자가 벌써 다음 줄을 치고 있으면 창을 띄우지 않고 칸 아래에 남긴다 — 치던 줄·커서는 그대로, 다음 줄들은 차례대로 등록', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '61 꽃 1만')
    enter(quick, '61 장미 2만')
    fireEvent.change(quick, { target: { value: '62 꽃' } })
    quick.focus()
    release()
    expect(await screen.findByRole('button', { name: '61 장미 2만 고치기' })).toBeDefined()
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(quick)
    expect(quick.value).toBe('62 꽃')
    expect(screen.getByText('61번이 이미 있어요. 고칠까요? 친 줄: 61 장미 2만')).toBeDefined()
    enter(quick, '62 꽃 1만')
    enter(quick, '63 꽃 1만')
    await waitFor(() => expect(model.events.map((event) => event.no)).toEqual([61, 62, 63]))
    expect(model.events.map((event) => event.type)).toEqual(['product.register', 'product.register', 'product.register'])
    await waitFor(() => expect(quick.value).toBe(''))
    // 칸이 비었을 때 "고치기": 친 줄을 칸으로 옮기고 같은 창 — 아니요면 아무것도 보내지 않고 친 줄은 칸에 남는다(AC-S05-13)
    fireEvent.click(screen.getByRole('button', { name: '61 장미 2만 고치기' }))
    const dialog = await screen.findByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })
    expect(quick.value).toBe('61 장미 2만')
    expect(screen.queryByRole('button', { name: '61 장미 2만 고치기' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '아니요' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(quick))
    expect(quick.value).toBe('61 장미 2만')
    expect(model.events).toHaveLength(3)
  })

  it('다른 줄을 치는 중에 "고치기"를 누르면 그 글자는 두고 창을 연다 — 아니요면 "고칠까요?"가 남고, 예면 바뀐 칸만 고치고 지운다', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '61 꽃 1만')
    enter(quick, '61 장미 2만')
    fireEvent.change(quick, { target: { value: '64 해' } })
    quick.focus()
    release()
    const ask = await screen.findByRole('button', { name: '61 장미 2만 고치기' })
    fireEvent.click(ask)
    const first = await screen.findByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })
    expect(quick.value).toBe('64 해')
    fireEvent.keyDown(within(first).getByRole('button', { name: '아니요' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(quick.value).toBe('64 해')
    fireEvent.click(screen.getByRole('button', { name: '61 장미 2만 고치기' }))
    const second = await screen.findByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })
    fireEvent.click(within(second).getByRole('button', { name: '예' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(model.events.at(-1)).toMatchObject({ type: 'product.update', no: 61, name: '장미', price: 20000 })
    expect(screen.queryByRole('button', { name: '61 장미 2만 고치기' })).toBeNull()
    expect(quick.value).toBe('64 해')
  })

  it('"그대로 두기"는 아무것도 보내지 않고 지운다', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '61 꽃 1만')
    enter(quick, '61 장미 2만')
    fireEvent.change(quick, { target: { value: '6' } })
    quick.focus()
    release()
    fireEvent.click(await screen.findByRole('button', { name: '61 장미 2만 그대로 두기' }))
    expect(screen.queryByRole('button', { name: '61 장미 2만 고치기' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(model.events.map((event) => event.type)).toEqual(['product.register'])
  })

  it('판매 종료된 번호면 다시 팔지를 묻는 문장으로 남긴다', async () => {
    setupServer()
    model.products.set('b1/61', product(61, { status: 'CLOSED' }))
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '60 꽃 1만')
    enter(quick, '61 장미 2만')
    fireEvent.change(quick, { target: { value: '62' } })
    quick.focus()
    release()
    expect(await screen.findByText('61번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요? 친 줄: 61 장미 2만')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('판매자가 기다리고 있었으면(다음 줄을 치지 않음) 바로 "고칠까요?" 창을 연다', async () => {
    setupServer()
    const release = gate()
    const { quick } = await openConsole()
    enter(quick, '61 꽃 1만')
    enter(quick, '61 장미 2만')
    release()
    expect(await screen.findByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '61 장미 2만 고치기' })).toBeNull()
  })

  it('보낸 등록이 다른 기기의 같은 번호 때문에 아무 일도 없었고 그사이 다음 줄을 치는 중이면, 창 대신 "고칠까요?"를 남긴다', async () => {
    setupServer()
    const { quick } = await openConsole()
    model.products.set('b1/51', product(51, { name: '금황', price: 5000 }))
    const release = gate()
    enter(quick, '51 꽃 1만')
    fireEvent.change(quick, { target: { value: '52 꽃' } })
    quick.focus()
    release()
    expect(await screen.findByRole('button', { name: '51 꽃 1만 고치기' })).toBeDefined()
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(quick)
    expect(quick.value).toBe('52 꽃')
  })

  it('보낸 등록이 아무 일도 없었고 판매자가 기다리고 있었으면 바로 "고칠까요?" 창', async () => {
    setupServer()
    const { quick } = await openConsole()
    model.products.set('b1/51', product(51, { name: '금황', price: 5000 }))
    enter(quick, '51 꽃 1만')
    expect(await screen.findByRole('dialog', { name: '51번이 이미 있어요. 고칠까요?' })).toBeDefined()
  })
})

describe('번호 찾기 뒤 다음 줄 (UX-S05-001, AC-S05-12·42)', () => {
  it('번호만 쳐서 자세히를 열면 칸을 비운다 — 창을 닫고 친 다음 줄이 그 번호 뒤에 붙어 엉뚱한 번호로 등록되지 않는다', async () => {
    setupServer()
    model.products.set('b1/1', product(1))
    const { quick } = await openConsole()
    enter(quick, '1')
    const dialog = await screen.findByRole('dialog', { name: '1번 자세히' })
    expect(quick.value).toBe('')
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '닫기' }), { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(quick))
    expect(quick.value).toBe('')
    enter(quick, '7 금황 5000')
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'product.register', no: 7, name: '금황', price: 5000 })
  })
})

describe('사유가 거절되면 (AC-S05-34·71, UX-S05-002, D-079 ⑥)', () => {
  function setupRejection() {
    setupServer(60)
    model.products.set('b1/15', product(15, { winners: ['c1'], winnerClaims: ['k1'] }))
    model.buyers = [{ id: 'c1', display: '홍길동' }]
    model.claims = [claim('k1', 'c1', 'CONFIRMED')]
    model.onEvent = (event) =>
      event.type === 'host.cancel' && String(event.reason).includes('010')
        ? apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'reason', message: PHONE, hint: '사유에서 번호를 빼 주세요.' }])
        : null
  }

  async function submitPhoneReason(quick: HTMLInputElement) {
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    const field = within(reason).getByLabelText('사유')
    fireEvent.change(field, { target: { value: '010-1111-2222 요청' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(quick))
  }

  it('판매자가 치는 중이 아니면 같은 창을 친 사유·서버 문장·hint로 다시 열고, 처음 포커스는 "닫기"(D-087) — 고쳐 보내면 한 번 기록', async () => {
    setupRejection()
    const { quick } = await openConsole()
    await submitPhoneReason(quick)
    const again = await screen.findByRole('dialog', { name: '15번 홍길동 취소' }, { timeout: 2000 })
    await waitFor(() => expect(document.activeElement).toBe(within(again).getByRole('button', { name: '닫기' })))
    const field = within(again).getByLabelText('사유') as HTMLInputElement
    expect(field.value).toBe('010-1111-2222 요청')
    expect(again.textContent).toContain(`${PHONE} 사유에서 번호를 빼 주세요.`)
    expect(screen.queryByRole('button', { name: '15번 홍길동 취소 사유 고치기' })).toBeNull()
    fireEvent.change(field, { target: { value: '시청자 요청' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(model.events).toHaveLength(1), { timeout: 2000 })
    expect(model.events[0]).toMatchObject({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'c1', reason: '시청자 요청' })
    expect(model.posts.filter((post) => post.body.type === 'host.cancel')).toHaveLength(2)
  })

  it('판매자가 빠른 입력칸에 다음 줄을 치는 중이면 창을 띄우지 않고(글자를 빼앗지 않음) 띠에 "사유 고치기" — 누르면 그 창', async () => {
    setupRejection()
    const { quick } = await openConsole()
    await submitPhoneReason(quick)
    fireEvent.change(quick, { target: { value: '5 청옥' } })
    const fix = await screen.findByRole('button', { name: '15번 홍길동 취소 사유 고치기' }, { timeout: 2000 })
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(quick)
    expect(quick.value).toBe('5 청옥')
    expect(screen.getByRole('region', { name: '보내기 전 조치' }).textContent).toContain(PHONE)
    fireEvent.click(fix)
    const again = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    expect((within(again).getByLabelText('사유') as HTMLInputElement).value).toBe('010-1111-2222 요청')
    expect(again.textContent).toContain(PHONE)
    await waitFor(() => expect(document.activeElement).toBe(within(again).getByRole('button', { name: '닫기' })))
    expect(screen.queryByRole('button', { name: '15번 홍길동 취소 사유 고치기' })).toBeNull()
    expect(model.events).toHaveLength(0)
  })
})

describe('알림 창 (AC-S05-30·32·33)', () => {
  it('"확인 필요" 창: 처리하지 못한 입력의 seq·시각(KST)·서버 문장, 처음 포커스 "닫기"', async () => {
    setupServer()
    model.seq = 9
    model.attention = [{ seq: 7, message: '처리하지 못한 입력이에요. 이 입력을 확인해 주세요.' }]
    model.history = [historyItem(7, 'chat', { b: 'b1' }, { at: '2026-10-19T01:02:03.000Z' })]
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '알림' })).getByRole('button', { name: '확인 필요 1' }))
    const dialog = await screen.findByRole('dialog', { name: '확인 필요' })
    await waitFor(() => expect(dialog.textContent).toContain('7번째 입력 · 10:02:03 · 처리하지 못한 입력이에요. 이 입력을 확인해 주세요.'))
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' })))
  })

  it('"보류 찜" 창: 번호마다 수·가장 오래된 찜이 온 지 몇 초, 유효 시간을 넘으면(밀리초로 비교) "지금 등록하면 만료돼요", 번호 넣기, 최근 만료된 찜', () => {
    const t0 = Date.parse('2026-10-19T01:00:00.000Z')
    const at = (ms: number) => new Date(ms).toISOString()
    const view = fullView({
      products: [product(3)],
      pending: [
        { product: 'b1/7', broadcast: 'b1', no: 7, buyers: ['c1', 'c2'], claims: ['k1', 'k2'] },
        { product: 'b1/3', broadcast: 'b1', no: 3, buyers: ['c1'], claims: ['k4'] },
      ],
      claims: [
        claim('k1', 'c1', 'PENDING', { product: 'b1/7', no: 7, at: at(t0) }),
        claim('k2', 'c2', 'PENDING', { product: 'b1/7', no: 7, at: at(t0 + 5000) }),
        claim('k4', 'c1', 'PENDING', { product: 'b1/3', no: 3, at: at(t0) }),
        claim('k3', 'c3', 'REJECTED', { product: 'b1/9', no: 9, reason: 'EXPIRED', seq: 4 }),
      ],
      buyers: fullBuyers(['c1', '홍길동'], ['c2', '김철수'], ['c3', '박영희']),
    })
    const api = fakeApi(view)
    const draw = (now: number) => (
      <ConsoleContext.Provider value={api}>
        <PendingDialog now={now} onClose={() => {}} />
      </ConsoleContext.Provider>
    )
    // 유효 시간(기본 30초) 경계: 정확히 30초 지난 찜은 아직 유효하다(R-5 at ≥ T − 30초)
    const { rerender } = render(draw(t0 + 30_000))
    const dialog = screen.getByRole('dialog', { name: '보류 찜' })
    expect(dialog.textContent).toContain('7번 보류 찜 2개 · 가장 오래된 찜 30초 전')
    expect(dialog.textContent).not.toContain('3번 보류 찜') // 상품이 있는 번호는 세지 않는다
    expect(within(dialog).queryByText('지금 등록하면 만료돼요')).toBeNull()
    // 30.5초: 초로 내리면 30이지만 이미 만료 — 표시가 붙는다
    rerender(draw(t0 + 30_500))
    expect(dialog.textContent).toContain('가장 오래된 찜 30초 전')
    expect(within(dialog).getByText('지금 등록하면 만료돼요')).toBeDefined()
    expect(dialog.textContent).toContain('최근 만료된 찜')
    expect(dialog.textContent).toContain('9번 박영희 · 만료')
    fireEvent.click(within(dialog).getByRole('button', { name: '7번 번호 넣기' }))
    expect(api.filled).toEqual(['7 '])
  })

  it('"취소 요청" 창: 요청한 사람·지금 상태·요청 시각, "2 요청 무시" → 5초 대기 뒤 host.dismissCancel (승인은 보내지 않는다)', async () => {
    setupServer(60)
    model.products.set('b1/15', product(15, { winners: ['c1'], winnerClaims: ['k1'], waitlist: ['c2'], waitlistClaims: ['k2'] }))
    model.buyers = [
      { id: 'c1', display: '홍길동' },
      { id: 'c2', display: '김철수' },
    ]
    model.claims = [claim('k1', 'c1', 'CONFIRMED', { cancelRequested: true }), claim('k2', 'c2', 'WAITLISTED')]
    model.cancelRequests = [{ product: 'b1/15', buyer: 'c1', currentBuyer: 'c1', claim: 'k1', seq: 3 }]
    model.history = [historyItem(3, 'chat', { b: 'b1' }, { at: '2026-10-19T01:00:05.000Z' })]
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '알림' })).getByRole('button', { name: '취소 요청 1' }))
    const dialog = await screen.findByRole('dialog', { name: '취소 요청 — 15번 핑크프릴' })
    expect(dialog.textContent).toContain('홍길동')
    expect(dialog.textContent).toContain('1등')
    expect(dialog.textContent).toContain('승인하면 대기 1순위가 1등이 돼요')
    await waitFor(() => expect(dialog.textContent).toContain('10:00:05'))
    const close = within(dialog).getByRole('button', { name: '닫기' })
    await waitFor(() => expect(document.activeElement).toBe(close))
    fireEvent.keyDown(close, { key: '2' })
    expect(await screen.findByText(/뒤 보내요: 15번 홍길동 취소 요청 무시/)).toBeDefined()
    expect(model.events).toHaveLength(0)
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'host.dismissCancel', b: 'b1', no: 15, buyer: 'c1' })
  })

  it.each([
    ['AUTO', 1, '승인하면 대기 1순위가 1등이 돼요'],
    ['ASK', 1, '승인하면 대기자 중 누구를 1등으로 올릴지 정해야 해요(승계 결정 필요).'],
    ['REOPEN', 2, '승인하면 대기자 2명이 모두 정리되고 다시 판매 중이 돼요.'],
    ['ASK', 0, '승인하면 1등 자리가 비고 다시 판매 중이 돼요.'],
  ] as const)('"취소 요청" 창의 승인 문장은 그 방송의 승계 설정대로: %s · 대기 %i명', (succession, waiting, sentence) => {
    setupServer()
    const waitlist = ['c2', 'c3'].slice(0, waiting)
    const view = fullView({
      broadcasts: [broadcastView({ settings: { ...DEFAULT_SETTINGS, 'cancel.succession': succession } })],
      products: [product(15, { winners: ['c1'], winnerClaims: ['k1'], waitlist, waitlistClaims: waitlist.map((id) => `w${id}`) })],
      claims: [claim('k1', 'c1', 'CONFIRMED', { cancelRequested: true })],
      cancelRequests: [{ product: 'b1/15', buyer: 'c1', currentBuyer: 'c1', claim: 'k1', seq: 3 }],
      buyers: fullBuyers(['c1', '홍길동']),
    })
    render(
      <ConsoleContext.Provider value={fakeApi(view)}>
        <CancelRequestDialog onClose={() => {}} />
      </ConsoleContext.Provider>,
    )
    const dialog = screen.getByRole('dialog', { name: '취소 요청 — 15번 핑크프릴' })
    expect(within(dialog).getByText(sentence)).toBeDefined()
  })

  it('"승계 결정" 창의 "다시 판매(대기자 정리)": 확인 문장 "대기자 n명이 모두 정리돼요", 사유 → 5초 뒤 host.reopen, 조치 기록에 보인다', async () => {
    setupServer(60)
    model.products.set('b1/15', product(15, { status: 'SOLD', awaitingSuccession: true, waitlist: ['c2', 'c3'], waitlistClaims: ['k2', 'k3'] }))
    model.buyers = [
      { id: 'c2', display: '김철수' },
      { id: 'c3', display: '이영희' },
    ]
    model.claims = [claim('k2', 'c2', 'WAITLISTED'), claim('k3', 'c3', 'WAITLISTED')]
    const { quick } = await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '알림' })).getByRole('button', { name: '승계 결정 필요 1' }))
    const dialog = await screen.findByRole('dialog', { name: '승계 결정 — 15번 핑크프릴' })
    expect(within(dialog).getByRole('button', { name: '1 김철수 1등으로' })).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 판매(대기자 정리)' }))
    const reason = await screen.findByRole('dialog', { name: '15번 다시 판매(대기자 정리)' })
    expect(within(reason).getByText('대기자 2명이 모두 정리돼요')).toBeDefined()
    await waitFor(() => expect(document.activeElement).toBe(within(reason).getByRole('button', { name: '닫기' })))
    // 보내기 버튼은 동사 "다시 판매하기", 빠른 사유는 숫자와 함께 (AC-S06-60·63)
    fireEvent.click(within(reason).getByRole('button', { name: '다시 판매하기' }))
    expect(await within(reason).findByText('사유를 적어 주세요.')).toBeDefined()
    fireEvent.click(within(reason).getByRole('button', { name: '1 시청자 요청' }))
    fireEvent.click(within(reason).getByRole('button', { name: '다시 판매하기' }))
    expect(await screen.findByText(/뒤 보내요: 15번 다시 판매\(대기자 정리\)/)).toBeDefined()
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'host.reopen', b: 'b1', no: 15, reason: '시청자 요청' })
    // 조치 기록
    model.history = [historyItem(2, 'host.reopen', { b: 'b1', no: 15 }, { reason: '시청자 요청' })]
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    const log = within(detail).getByRole('region', { name: '조치 기록' })
    await waitFor(() => expect(log.textContent).toContain('다시 판매(대기자 정리)'))
    expect(log.textContent).toContain('시청자 요청')
    expect(log.textContent).toContain('shop1')
    expect(log.textContent).toContain('10:02:03')
  })
})

describe('차단 풀기 (AC-S05-34)', () => {
  it('차단 중인 구매자는 "차단 풀기" → 사유(확인 문장 없음) → 5초 뒤 host.unblockBuyer (방송 필드 없이 날짜 범위로)', async () => {
    setupServer(60)
    model.products.set('b1/15', product(15, { winners: ['c1'], winnerClaims: ['k1'] }))
    model.buyers = [{ id: 'c1', display: '홍길동', blocked: true }]
    model.claims = [claim('k1', 'c1', 'CONFIRMED')]
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect(within(detail).getByText('차단')).toBeDefined()
    expect(within(detail).queryByRole('button', { name: '차단하기' })).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '차단 풀기' }))
    const reason = await screen.findByRole('dialog', { name: '홍길동 차단 풀기' })
    expect(reason.textContent).not.toContain('차단하면')
    fireEvent.click(within(reason).getByRole('button', { name: '3 번호 착오' }))
    fireEvent.click(within(reason).getAllByRole('button', { name: '차단 풀기' }).at(-1) as HTMLElement)
    expect(await screen.findByText(/뒤 보내요: 홍길동 차단 풀기/)).toBeDefined()
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'host.unblockBuyer', buyer: 'c1', reason: '번호 착오' })
    expect(model.events[0]).not.toHaveProperty('b')
    expect(model.posts[0]?.path).toBe(`/api/events?date=${DATE}`)
  })
})

describe('알기 쉬운 오류 (AC-S05-71)', () => {
  it('409 STATE_FORMAT 등록: 서버 문장("잠시 뒤 다시 시도")과 "다시 보내기" — 누르면 같은 요청 번호로 한 번 기록', async () => {
    setupServer()
    let down = true
    model.onEvent = (event) =>
      down && event.type === 'product.register' ? apiError(409, 'STATE_FORMAT', '저장된 상태를 다시 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.') : null
    const { quick } = await openConsole()
    enter(quick, '15 핑크프릴 10000')
    expect(await screen.findByText('저장된 상태를 다시 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.')).toBeDefined()
    expect(screen.getByText('저장하지 못했어요. 다시 보내기를 눌러 주세요: 15 핑크프릴 10000')).toBeDefined()
    expect(document.body.textContent).not.toContain('STATE_FORMAT')
    down = false
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.posts).toHaveLength(2)
    expect(model.posts[1]?.body.requestId).toBe(model.posts[0]?.body.requestId)
    await waitFor(() => expect(quick.value).toBe(''))
    expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
  })

  it('500 INTERNAL_ERROR 방송자 조치: 띠에 서버 문장과 "다시 보내기" — 누르면 같은 요청 번호로 다시 보낸다', async () => {
    setupServer(60)
    model.products.set('b1/15', product(15, { winners: ['c1'], winnerClaims: ['k1'] }))
    model.buyers = [{ id: 'c1', display: '홍길동' }]
    model.claims = [claim('k1', 'c1', 'CONFIRMED')]
    let down = true
    model.onEvent = (event) => (down && event.type === 'host.confirm' ? apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.') : null)
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '확인(잠금)' }))
    const bar = screen.getByRole('region', { name: '보내기 전 조치' })
    await waitFor(() => expect(bar.textContent).toContain('15번 홍길동 확인(잠금) — 서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'), { timeout: 2000 })
    expect(within(bar).queryByRole('button', { name: /사유 고치기/ })).toBeNull()
    down = false
    fireEvent.click(within(bar).getByRole('button', { name: '다시 보내기' }))
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'host.confirm', b: 'b1', no: 15, buyer: 'c1' })
    expect(model.posts[1]?.body.requestId).toBe(model.posts[0]?.body.requestId)
  })

  it('500 PROCESSING_FAILED: 서버 문장을 보이고, 알림을 기다리지 않고 따라잡아 알림 띠에 "확인 필요 1"', async () => {
    setupServer()
    model.onEvent = (event) => {
      if (event.type !== 'product.register') return null
      model.seq++
      model.attention = [...model.attention, { seq: model.seq, message: '처리하지 못한 입력이에요.' }]
      return { status: 500, body: { date: DATE, seq: model.seq, error: { code: 'PROCESSING_FAILED', message: '처리하지 못했어요. 확인 필요 목록에 남겼어요.' } } }
    }
    const { quick } = await openConsole()
    expect(screen.getByText('알림 없음')).toBeDefined()
    enter(quick, '15 핑크프릴 10000')
    expect(await screen.findByText('처리하지 못했어요. 확인 필요 목록에 남겼어요.')).toBeDefined()
    const alerts = screen.getByRole('region', { name: '알림' })
    expect(await within(alerts).findByRole('button', { name: '확인 필요 1' })).toBeDefined()
    expect(FakeEventSource.instances.every((source) => source.readyState !== 1)).toBe(true)
    await act(async () => {
      await flush()
    })
    expect(model.events).toHaveLength(0)
  })
})

function fullBuyers(...pairs: (readonly [string, string])[]): FullView['buyers'] {
  return pairs.map(([id, display]) => ({
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
  }))
}
