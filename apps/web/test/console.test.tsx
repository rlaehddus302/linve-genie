// 라이브 콘솔 화면 (AC-S05-10~14·21·22·30·31·40~42·54·70·72·74). 가짜 서버로 콘솔 전체를 그린다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, Claim, Product } from '../src/api/types.ts'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { DATE, FakeEventSource, FakeServer, broadcastItem, emptyChanges, flush, fullView, message, product } from './support.ts'

/** 아주 작은 가짜 범위: 상품·찜·메시지를 들고 seq를 올린다 */
class Model {
  seq = 1
  products = new Map<string, Product>()
  claims: Claim[] = []
  buyers: { id: string; display: string }[] = []
  messages: ChatMessage[] = []
  events: Record<string, unknown>[] = []
  gate: Promise<void> | null = null
  rehearsal = false

  view() {
    return fullView({
      seq: this.seq,
      rehearsal: this.rehearsal,
      products: [...this.products.values()],
      claims: this.claims,
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
        blocked: false,
      })),
    })
  }
}

let server: FakeServer
let model: Model

function setupServer(delay = 60) {
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem({ rehearsal: model.rehearsal })] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: delay } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: model.view() }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: model.rehearsal, seq: model.seq, messages: model.messages, more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/history\\?`), () => ({ body: { date: DATE, rehearsal: false, events: [] } }))
    .on('GET', /^\/api\/broadcasts\/b1\/rehearsal\/generator$/, () => ({
      body: { generator: { running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null } },
    }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => {
      const view = model.view()
      return { body: { ...emptyChanges(Number(match[1]), model.seq), products: view.products, claims: view.claims, buyers: view.buyers } }
    })
    .on('POST', /^\/api\/events/, async (call) => {
      if (model.gate !== null) await model.gate
      const event = call.body ?? {}
      model.events.push(event)
      model.seq++
      let changed = true
      if (event.type === 'product.register') {
        const no = Number(event.no)
        changed = !model.products.has(`b1/${String(no)}`)
        if (changed) model.products.set(`b1/${String(no)}`, product(no, { id: `p${String(model.products.size + 1)}`, name: String(event.name), price: Number(event.price) }))
      }
      if (event.type === 'product.close') {
        const key = `b1/${String(event.no)}`
        const current = model.products.get(key)
        changed = current !== undefined && current.winners.length === 0
        if (current !== undefined && changed) model.products.set(key, { ...current, status: 'CLOSED' })
      }
      return { body: { date: DATE, rehearsal: model.rehearsal, seq: model.seq, type: event.type, changed, effects: [] } }
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

describe('빠른 입력 (AC-S05-10·11·12)', () => {
  it('콘솔을 열면 포커스가 빠른 입력칸에 있다', async () => {
    setupServer()
    const { quick } = await openConsole()
    await waitFor(() => expect(document.activeElement).toBe(quick))
    expect(screen.getByText('알림 없음')).toBeDefined()
  })

  it('등록: 응답 전에는 "등록하는 중…"만, 받은 뒤 칸이 비고 보드·현재 상품에 나타난다. 요청 번호 포함', async () => {
    setupServer()
    let release: () => void = () => {}
    model.gate = new Promise((resolve) => {
      release = resolve
    })
    const { quick } = await openConsole()
    enter(quick, '15 핑크프릴 10000')
    expect(await screen.findByText('등록하는 중…')).toBeDefined()
    expect(quick.value).toBe('15 핑크프릴 10000')
    expect(screen.queryByRole('button', { name: /^15번 핑크프릴/ })).toBeNull()
    model.gate = null
    release()
    await waitFor(() => expect(quick.value).toBe(''))
    const board = screen.getByRole('region', { name: '상품 보드' })
    expect(within(board).getByText('15번')).toBeDefined()
    expect(within(screen.getByRole('region', { name: '현재 상품' })).getByText('15번')).toBeDefined()
    expect(screen.getByText('15번을 등록했어요')).toBeDefined()
    expect(screen.getByRole('button', { name: '15번 등록 되돌리기' })).toBeDefined()
    const [event] = model.events
    expect(event).toMatchObject({ type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 })
    expect(String(event?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('빠르게 연달아 친 줄이 모두 순서대로 한 번씩 등록된다', async () => {
    setupServer()
    const { quick } = await openConsole()
    for (const line of ['1 가 10000', '2 나 1만', '3번 다 만원', '4/라/10', '5 마 15000']) enter(quick, line)
    await waitFor(() => expect(model.events).toHaveLength(5))
    expect(model.events.map((event) => event.no)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(model.events.map((event) => event.requestId)).size).toBe(5)
  })

  it('가격이 없으면 등록하지 않고 고치기 칸을 열어 가격 칸에 커서, Esc면 빠른 입력칸으로', async () => {
    setupServer()
    const { quick } = await openConsole()
    enter(quick, '40 핑크')
    expect(await screen.findByText('가격을 알아보지 못했어요. 가격 칸에 적어 주세요.')).toBeDefined()
    const price = screen.getByLabelText('가격') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(price))
    expect((screen.getByLabelText('번호') as HTMLInputElement).value).toBe('40')
    expect((screen.getByLabelText('품종') as HTMLInputElement).value).toBe('핑크')
    expect(model.events).toHaveLength(0)
    fireEvent.change(price, { target: { value: '1만' } })
    fireEvent.keyDown(price, { key: 'Enter' })
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'product.register', no: 40, name: '핑크', price: 10000 })
    enter(quick, '핑크 10000')
    const no = (await screen.findByLabelText('번호')) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(no))
    fireEvent.keyDown(no, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('번호')).toBeNull())
    expect(document.activeElement).toBe(quick)
  })

  it('치는 동안 그 방송의 상품 번호면 바로 보이고, 번호만 Enter면 상품 자세히', async () => {
    setupServer()
    model.products.set('b1/15', product(15, { winners: ['c1'], winnerClaims: ['k1'], waitlist: ['c2'], waitlistClaims: ['k2'] }))
    model.buyers = [
      { id: 'c1', display: '홍길동' },
      { id: 'c2', display: '김철수' },
    ]
    const { quick } = await openConsole()
    fireEvent.change(quick, { target: { value: '15 핑' } })
    const preview = await screen.findByRole('status', { name: '찾은 상품' })
    expect(preview.textContent).toContain('15번')
    expect(preview.textContent).toContain('1등 홍길동')
    expect(preview.textContent).toContain('대기 1명')
    enter(quick, '15')
    expect(await screen.findByRole('dialog', { name: '15번 자세히' })).toBeDefined()
    expect(model.events).toHaveLength(0)
  })

  it('같은 번호는 등록하지 않고 "15번이 이미 있어요. 고칠까요?" — 아니요면 줄을 그대로 둔다', async () => {
    setupServer()
    model.products.set('b1/15', product(15))
    const { quick } = await openConsole()
    enter(quick, '15 핑크 12000')
    const dialog = await screen.findByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '아니요' })))
    fireEvent.click(within(dialog).getByRole('button', { name: '아니요' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(quick.value).toBe('15 핑크 12000')
    expect(model.events).toHaveLength(0)
  })
})

describe('되돌리기·단축키 (AC-S05-40·41·42)', () => {
  it('등록 뒤 Ctrl+Z(빈 칸)면 판매 종료를 보내고 "15번 등록을 되돌렸어요(판매 종료)"', async () => {
    setupServer()
    const { quick } = await openConsole()
    enter(quick, '15 핑크프릴 10000')
    await waitFor(() => expect(quick.value).toBe(''))
    fireEvent.keyDown(quick, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(await screen.findByText('15번 등록을 되돌렸어요(판매 종료)')).toBeDefined()
    expect(model.events.map((event) => event.type)).toEqual(['product.register', 'product.close'])
  })

  it('글자가 있는 칸 안의 Ctrl+Z는 브라우저 글자 되돌리기 그대로(아무것도 보내지 않음)', async () => {
    setupServer()
    const { quick } = await openConsole()
    enter(quick, '15 핑크프릴 10000')
    await waitFor(() => expect(quick.value).toBe(''))
    fireEvent.change(quick, { target: { value: '16 핑' } })
    fireEvent.keyDown(quick, { key: 'z', code: 'KeyZ', metaKey: true })
    await flush()
    expect(model.events.map((event) => event.type)).toEqual(['product.register'])
  })

  it('충돌: Alt+1로 창, 처음 포커스 "닫기", 숫자 1 → 대기, Ctrl+Z → 보내지 않음. 다시 2 → 정한 시간 뒤 보냄', async () => {
    setupServer(80)
    model.products.set('b1/15', product(15, { conflict: true, conflictClaim: 'k2', conflictBuyer: 'c2', winners: ['c1'], winnerClaims: ['k1'] }))
    model.buyers = [
      { id: 'c1', display: '홍길동' },
      { id: 'c2', display: '김철수' },
    ]
    model.claims = [claim('k1', 'c1', 'CONFIRMED'), claim('k2', 'c2', 'CONFLICT')]
    const { quick } = await openConsole()
    expect(within(screen.getByRole('region', { name: '알림' })).getByRole('button', { name: '충돌 1' })).toBeDefined()
    fireEvent.keyDown(quick, { key: '1', code: 'Digit1', altKey: true })
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('늦게 확인된 앞선 찜이 있어요. 1등을 그대로 둘지 바꿀지 골라 주세요.')
    expect(dialog.textContent).toContain('홍길동 (채팅)')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' })))
    fireEvent.keyDown(document.activeElement as Element, { key: '1' })
    expect(await screen.findByText(/뒤 보내요: 15번 충돌 그대로 유지/)).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(quick))
    fireEvent.keyDown(quick, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(await screen.findByText('보내지 않았어요: 15번 충돌 그대로 유지')).toBeDefined()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(model.events).toHaveLength(0)
    // 다시: 2 바꾸기는 정한 시간 뒤에 같은 요청 번호로 보낸다
    fireEvent.keyDown(quick, { key: '1', code: 'Digit1', altKey: true })
    const again = await screen.findByRole('dialog')
    fireEvent.click(within(again).getByRole('button', { name: '2 바꾸기' }))
    expect(model.events).toHaveLength(0)
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'SWITCH' })
  })

  it('충돌 중인 상품은 직접 배정·교체를 누를 수 없고 "충돌부터 정해 주세요."', async () => {
    setupServer()
    model.products.set('b1/15', product(15, { conflict: true, conflictClaim: 'k2', winners: ['c1'], winnerClaims: ['k1'] }))
    model.buyers = [{ id: 'c1', display: '홍길동' }, { id: 'c2', display: '김철수' }]
    model.claims = [claim('k1', 'c1', 'CONFIRMED'), claim('k2', 'c2', 'CONFLICT')]
    const { quick } = await openConsole()
    enter(quick, '15')
    const dialog = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect((within(dialog).getByRole('button', { name: '직접 배정' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: '다른 사람으로 바꾸기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getAllByText('충돌부터 정해 주세요.').length).toBeGreaterThan(0)
    // 판매 종료는 1등·대기 찜이 있으면 누를 수 없다
    expect((within(dialog).getByRole('button', { name: '판매 종료' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByText('1등·대기 찜을 먼저 정리해 주세요.')).toBeDefined()
  })

  it('사유가 필요한 조치는 사유 없이 보낼 수 없고, 사유를 적으면 "N초 뒤 보내요: 15번 홍길동 취소"', async () => {
    setupServer(5000)
    model.products.set('b1/15', product(15, { winners: ['c1'], winnerClaims: ['k1'] }))
    model.buyers = [{ id: 'c1', display: '홍길동' }]
    model.claims = [claim('k1', 'c1', 'CONFIRMED')]
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '취소' }))
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    await waitFor(() => expect(document.activeElement).toBe(within(reason).getByRole('button', { name: '닫기' })))
    fireEvent.click(within(reason).getAllByRole('button', { name: '취소' }).at(-1) as HTMLElement)
    expect(await within(reason).findByText('사유를 적어 주세요.')).toBeDefined()
    fireEvent.click(within(reason).getByRole('button', { name: '시청자 요청' }))
    fireEvent.click(within(reason).getAllByRole('button', { name: '취소' }).at(-1) as HTMLElement)
    expect(await screen.findByText('5초 뒤 보내요: 15번 홍길동 취소')).toBeDefined()
    expect(screen.getByRole('button', { name: '15번 홍길동 취소 되돌리기' })).toBeDefined()
    expect(within(screen.getByRole('region', { name: '상품 보드' })).getByText('보내기 전')).toBeDefined()
    expect(model.events).toHaveLength(0)
  })
})

describe('채팅 패널 (AC-S05-21·22)', () => {
  it('본문·닉네임은 글자 그대로(HTML로 해석하지 않는다), 시각은 KST', async () => {
    setupServer()
    model.messages = [message(2, { nick: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script> &lt; 15번 예뻐요', mentions: [15], publishedAt: '2026-10-19T00:00:05.000Z' })]
    const { container } = await openConsole()
    const chat = screen.getByRole('region', { name: '채팅' })
    expect(within(chat).getByText('<img src=x onerror=alert(1)>')).toBeDefined()
    expect(chat.textContent).toContain('<script>alert(1)</script> &lt; 15번 예뻐요')
    expect(container.querySelectorAll('img, script')).toHaveLength(0)
    expect(chat.textContent).toContain('09:00:05')
    expect(within(chat).getByText('15').tagName).toBe('MARK')
    expect(within(chat).getByText('언급')).toBeDefined()
  })

  it('"찜으로 바꾸기"는 주문도 취소도 아니고 무시한 방송자 메시지도 아닌 메시지에만', async () => {
    setupServer()
    model.messages = [
      message(2, { id: 'order', text: '15', order: true, orders: [15] }),
      message(3, { id: 'cancel', text: '15 취소', cancel: true, cancels: [15] }),
      message(4, { id: 'owner', text: '15번 예뻐요', owner: true, ignored: true, mentions: [15] }),
      message(5, { id: 'plain', text: '십오번이요' }),
    ]
    await openConsole()
    const rows = within(screen.getByRole('list', { name: '채팅 메시지' })).getAllByRole('listitem')
    expect(rows.map((row) => within(row).queryByRole('button', { name: '찜으로 바꾸기' }) !== null)).toEqual([false, false, false, true])
    expect(rows[0]?.textContent).toContain('주문 15')
    expect(rows[1]?.textContent).toContain('취소 15')
    expect(rows[2]?.textContent).toContain('방송자')
    fireEvent.click(within(rows[3] as HTMLElement).getByRole('button', { name: '찜으로 바꾸기' }))
    const dialog = await screen.findByRole('dialog', { name: '메시지를 찜으로 바꾸기' })
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' })))
    fireEvent.change(within(dialog).getByLabelText('번호'), { target: { value: '15' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '바꾸기' }))
    expect(await screen.findByText(/뒤 보내요: 15번 시청자 메시지를 찜으로/)).toBeDefined()
    await waitFor(() => expect(model.events).toHaveLength(1))
    expect(model.events[0]).toMatchObject({ type: 'host.convertMessage', b: 'b1', msg: 'plain', no: 15 })
  })
})

describe('리허설·화면 말 (AC-S05-54·70)', () => {
  it('리허설 방송은 "리허설 중 — 실제 판매가 아니에요"와 조작판, 실제 방송에는 없다', async () => {
    setupServer()
    model.rehearsal = true
    await openConsole()
    expect(screen.getByText('리허설 중 — 실제 판매가 아니에요')).toBeDefined()
    expect(screen.getByRole('region', { name: '리허설 조작판' })).toBeDefined()
    expect(screen.getByRole('button', { name: '시청자로 보내기' })).toBeDefined()
    cleanup()
    model.rehearsal = false
    await openConsole()
    expect(screen.queryByText('리허설 중 — 실제 판매가 아니에요')).toBeNull()
    expect(screen.queryByRole('region', { name: '리허설 조작판' })).toBeNull()
    expect(screen.queryByRole('button', { name: '시청자로 보내기' })).toBeNull()
  })

  it('엔진 영어 값이 화면에 보이지 않는다', async () => {
    setupServer()
    model.products.set('b1/1', product(1, { status: 'READY' }))
    model.products.set('b1/2', product(2, { status: 'SOLD', winners: ['c1'], winnerClaims: ['k1'], awaitingSuccession: true }))
    model.products.set('b1/3', product(3, { status: 'HOLD', conflict: true }))
    model.products.set('b1/4', product(4, { status: 'CLOSED' }))
    model.buyers = [{ id: 'c1', display: '홍길동' }]
    model.claims = [claim('k1', 'c1', 'CONFIRMED')]
    const { container } = await openConsole()
    const text = container.textContent ?? ''
    for (const word of ['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT', 'SOLD_OUT', 'OPEN', 'READY', 'HOLD', 'CLOSED', 'REJECTED', 'DUPLICATE', 'collector', 'outbox', 'SOLD']) {
      expect(text, word).not.toContain(word)
    }
    for (const word of ['공개 전', '판매 완료', '일시 중지', '판매 종료', '충돌', '승계 결정 필요']) expect(text, word).toContain(word)
  })
})

function claim(id: string, buyer: string, status: Claim['status']): Claim {
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
  }
}

it('화면 소스는 console 로그를 남기지 않는다 (채팅 본문·닉네임·사유·전화번호, AC-S05-74)', () => {
  const sources = import.meta.glob('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  expect(Object.keys(sources).length).toBeGreaterThan(10)
  for (const [file, source] of Object.entries(sources)) expect(source, file).not.toMatch(/\bconsole\s*\./)
})
