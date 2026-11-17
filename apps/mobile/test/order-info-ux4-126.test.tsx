// D-UX4-126 (사용자 지시 2026-11-11 "주문 상세 화면에서 … 성함, 휴대폰 번호, 주소를 … 모르면 빨간 에러 색깔로 모름 > … 그 영역을 누르면 다음 페이지로 넘어가서
// 우리가 예전에 상품 추가 페이지 만들었던거처럼 똑같이 해당 정보를 입력 받을 수 있게 해줘"): 손님 정보 입력 화면.
// 누른 칸부터 한 번에 하나씩 · 아는 칸은 묻지 않고 위 줄로 · 비어 있는 꼭 받을 칸은 묻는다 · 휴대폰 번호는 앱 숫자판으로 줄표 · 확인 화면 → 배송지 쓰기(PUT).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrderDetailView } from '@livejjim/web/src/api/order-types.ts'
import type { BundleView, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { ADDRESS_EXPIRED, LOCKED_ADDRESS } from '@livejjim/web/src/lib/parcel-words.ts'
import { useScreenSignal } from '../src/lib/screen-signals.ts'
import { ASK_INFO, ASK_SAVE, infoSteps, OrderInfoFlow, OrderInfoScreen, PHONE_CHECK, PHONE_LIMIT, phoneTyping, previousInfoStep, SKIP_DETAIL, typePhone, type OrderInfoField } from '../src/screens/OrderInfoScreen.tsx'
import { charPieces } from '../src/screens/console/ProductAdd.tsx'
import { makeWorld } from './screen-support.tsx'

const DATE = '2026-10-29'
const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

const row = { buyer: 'u1', name: '다육맘', phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'UNPAID', packing: '포장 전', shipping: 'DEFAULT', address: 'NONE', ready: false, reason: null, message: null, box: '60', parcel: null } as unknown as ParcelRow

const bundle = (patch: Partial<BundleView> = {}): BundleView => ({ date: DATE, buyer: 'u1', address: null, locked: false, expired: false, row, ledger: null, ...patch })

const detail = (patch: Partial<OrderDetailView> = {}): OrderDetailView => ({
  date: DATE,
  buyer: 'u1',
  name: null,
  nickname: '다육맘',
  platform: 'YOUTUBE',
  phone: null,
  address: null,
  items: [{ no: 15, name: '핑크프릴', price: 10_000, qty: 1, b: 'b1', options: null }],
  claimedAt: '2026-10-29T11:00:00.000Z',
  itemCount: 1,
  subtotal: 10_000,
  shipping: 4_000,
  shippingRule: { baseFee: 4_000, freeThreshold: 50_000, mode: 'DEFAULT' },
  adjustments: 0,
  total: 14_000,
  received: 0,
  refundDue: 0,
  payment: 'UNPAID',
  history: { count: 0, total: 0, lines: [] },
  ...patch,
})

type Reply = { status?: number; body: unknown }

function world(start: BundleView, order: OrderDetailView, onPut?: (sent: Record<string, unknown>) => Reply | null) {
  const w = makeWorld()
  let current = start
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/bundle\?buyer=u1$/, () => ({ body: { bundle: current } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29\/order\?buyer=u1$/, () => ({ body: order }))
  w.server.on('PUT', /^\/api\/parcels\/days\/2026-10-29\/address$/, (call) => {
    const sent = call.body ?? {}
    const reply = onPut?.(sent) ?? null
    if (reply !== null) return reply
    current = { ...current, address: { ...(sent['address'] as Record<string, string>), source: 'SELLER', confirmed: true, updatedAt: '2026-10-29T13:00:00.000Z' } as BundleView['address'] }
    return { body: { bundle: current } }
  })
  return w
}

function open(w: ReturnType<typeof world>, field: OrderInfoField, onSaved = () => {}) {
  render(w.wrap(<OrderInfoScreen date={DATE} buyer="u1" field={field} onBack={() => {}} onSaved={onSaved} />))
  return screen.findByRole('main', { name: '손님 정보' })
}

const typePad = (keys: readonly string[]) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of keys) fireEvent.click(within(pad).getByRole('button', { name: key }))
}
const next = () => fireEvent.click(screen.getByRole('button', { name: '다음' }))
const doneLines = () => screen.queryAllByRole('button', { name: / 고치기$/ }).map((line) => line.getAttribute('aria-label'))

const spies: ReturnType<typeof vi.spyOn>[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

describe('손님 정보 입력 (D-UX4-126)', () => {
  it('누른 칸(주소)부터 묻고, 아는 성함·휴대폰 번호는 위 줄로 — 상세 주소는 칩으로 넘어가 확인 화면, 저장하면 여섯 칸을 보낸다', async () => {
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => {
      const spy = vi.spyOn(console, name).mockImplementation(() => {})
      spies.push(spy)
      return spy
    })
    const w = world(bundle(), detail({ name: '김다육', phone: '01012345678' }))
    const saved = vi.fn()
    const signal = vi.fn()
    function Listener() {
      useScreenSignal('orders', signal)
      return null
    }
    render(w.wrap(<><Listener /><OrderInfoScreen date={DATE} buyer="u1" field="address" onBack={() => {}} onSaved={saved} /></>))
    const page = await screen.findByRole('main', { name: '손님 정보' })
    const input = await within(page).findByLabelText(ASK_INFO.address)
    expect(doneLines()).toEqual(['성함 김다육 고치기', '휴대폰 번호 010-1234-5678 고치기'])
    // 비어 있으면 [다음]은 흐린 채로 눌리지 않는다
    expect(screen.getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(input, { target: { value: '경상남도 양산시 물금읍 증산리' } })
    next()
    expect(await within(page).findByLabelText(ASK_INFO.detail)).toBeTruthy()
    expect(doneLines()).toEqual(['성함 김다육 고치기', '휴대폰 번호 010-1234-5678 고치기', '주소 경상남도 양산시 물금읍 증산리 고치기'])
    fireEvent.click(within(page).getByRole('button', { name: SKIP_DETAIL }))
    const lines = await within(page).findByTestId('info-confirm-lines')
    expect(Array.from(lines.children).map((line) => line.textContent)).toEqual(['김다육', '010-1234-5678', '경상남도 양산시 물금읍 증산리'])
    expect(within(page).getByTestId('info-confirm').lastElementChild?.textContent).toBe(ASK_SAVE)
    // 확인 화면 단추는 하나
    expect(within(page).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent).filter((name) => name !== '뒤로')).toEqual(['저장하기'])
    fireEvent.click(within(page).getByRole('button', { name: '저장하기' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(signal).toHaveBeenCalled()
    const puts = w.server.callsTo('PUT', /^\/api\/parcels\/days\/2026-10-29\/address$/)
    expect(puts).toHaveLength(1)
    expect(puts[0]?.body).toEqual({ requestId: expect.any(String), buyer: 'u1', address: { name: '김다육', phone: '01012345678', address: '경상남도 양산시 물금읍 증산리', detail: '', zip: '', memo: '' } })
    // 연락처는 어디에도 찍지 않는다
    const printed = JSON.stringify(logged.map((spy) => spy.mock.calls))
    expect(printed).not.toContain('01012345678')
    expect(printed).not.toContain('010-1234-5678')
  })

  it('누른 칸(휴대폰 번호)부터 — 비어 있는 꼭 받을 칸(주소·상세 주소)은 묻고, 아는 성함은 묻지 않는다', async () => {
    const w = world(bundle(), detail({ name: '김다육' }))
    const page = await open(w, 'phone')
    expect(await within(page).findByRole('status', { name: ASK_INFO.phone })).toBeTruthy()
    expect(doneLines()).toEqual(['성함 김다육 고치기'])
    typePad(['0', '1', '0', '1', '2', '3', '4', '5', '6', '7', '8'])
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-1234-5678' })).toBeTruthy()
    next()
    expect(await within(page).findByLabelText(ASK_INFO.address)).toBeTruthy()
    fireEvent.change(within(page).getByLabelText(ASK_INFO.address), { target: { value: '서울 종로구 1' } })
    next()
    fireEvent.change(await within(page).findByLabelText(ASK_INFO.detail), { target: { value: '101호' } })
    next()
    const lines = await within(page).findByTestId('info-confirm-lines')
    expect(Array.from(lines.children).map((line) => line.textContent)).toEqual(['김다육', '010-1234-5678', '서울 종로구 1 101호'])
  })

  it('앞의 비어 있는 꼭 받을 칸도 묻는다(누른 칸 다음에) — 이미 다 알면 바로 확인', () => {
    const empty = { name: '', phone: '', address: '', detail: '' }
    expect(infoSteps('address', empty)).toEqual(['address', 'detail', 'name', 'phone'])
    expect(infoSteps('name', { ...empty, phone: '01012345678' })).toEqual(['name', 'address', 'detail'])
    expect(infoSteps('phone', { name: '김', phone: '010', address: '서울', detail: '' })).toEqual(['phone'])
    // 휴대폰 번호처럼 보이지 않으면 아는 것으로 보지 않는다
    expect(infoSteps('name', { name: '김', phone: '0101', address: '서울', detail: '' })).toEqual(['name', 'phone'])
    expect(previousInfoStep('confirm', ['phone'])).toBe('phone')
    expect(previousInfoStep('phone', ['phone'])).toBeNull()
    expect(previousInfoStep('name', ['address', 'detail', 'name'])).toBe('detail')
  })

  it('휴대폰 번호: 줄표를 넣어 보이고, 11자리를 넘긴 한 자리까지 보이며 빨간 글, 더 치면 받지 않는다', async () => {
    const w = world(bundle(), detail({ name: '김다육' }))
    const page = await open(w, 'phone')
    await within(page).findByRole('status', { name: ASK_INFO.phone })
    // 앞의 0을 떼지 않는다
    typePad(['0', '1', '0'])
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010' })).toBeTruthy()
    typePad(['1', '2', '3', '4'])
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-1234' })).toBeTruthy()
    typePad(['5', '6', '7', '8'])
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-1234-5678' })).toBeTruthy()
    typePad(['9'])
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-1234-56789' })).toBeTruthy()
    expect(within(page).getByText(PHONE_LIMIT)).toBeTruthy()
    expect(screen.getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).toBe('true')
    typePad(['0'])
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-1234-56789' })).toBeTruthy()
    typePad(['지우기'])
    expect(within(page).queryByText(PHONE_LIMIT)).toBeNull()
    // 휴대폰 번호처럼 보이지 않으면 [다음]에서 알린다
    typePad(['지우기', '지우기', '지우기', '지우기', '지우기'])
    next()
    expect(within(page).getByText(PHONE_CHECK)).toBeTruthy()
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-123' })).toBeTruthy()
    // 다시 치면 알림이 없어진다
    typePad(['4'])
    expect(within(page).queryByText(PHONE_CHECK)).toBeNull()
  })

  it('줄표 계산과 숫자판 누름 (순수) — 줄표 조각은 숫자를 넣고 지워도 같은 이름', () => {
    expect(phoneTyping('010')).toBe('010')
    expect(phoneTyping('0101')).toBe('010-1')
    expect(phoneTyping('01012345')).toBe('010-1234-5')
    expect(phoneTyping('0101234567')).toBe('010-123-4567')
    expect(phoneTyping('01012345678')).toBe('010-1234-5678')
    expect(typePhone('', '0')).toBe('0')
    expect(typePhone('0101234567', '00')).toBe('010123456700')
    expect(typePhone('010123456789', '1')).toBeNull()
    expect(typePhone('010', 'back')).toBe('01')
    expect(charPieces('010-1234-5', '').filter((piece) => piece.char === '-').map((piece) => piece.key)).toEqual(['h0', 'h1'])
    expect(charPieces('010-1234-5678', '').filter((piece) => piece.char === '-').map((piece) => piece.key)).toEqual(['h0', 'h1'])
  })

  it('뒤로(머리 ‹)는 앞 단계로, 첫 단계면 닫는다 — 위 줄을 누르면 그 칸으로 가서 고친다', async () => {
    const w = world(bundle(), detail())
    const onBack = vi.fn()
    render(w.wrap(<OrderInfoScreen date={DATE} buyer="u1" field="name" onBack={onBack} onSaved={() => {}} />))
    const page = await screen.findByRole('main', { name: '손님 정보' })
    fireEvent.change(await within(page).findByLabelText(ASK_INFO.name), { target: { value: '김다육' } })
    next()
    await within(page).findByRole('status', { name: ASK_INFO.phone })
    typePad([...'01099998888'])
    next()
    await within(page).findByLabelText(ASK_INFO.address)
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    expect(within(page).getByRole('status', { name: '휴대폰 번호 010-9999-8888' })).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '성함 김다육 고치기' }))
    expect((within(page).getByLabelText(ASK_INFO.name) as HTMLInputElement).value).toBe('김다육')
    expect(onBack).not.toHaveBeenCalled()
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    expect(onBack).toHaveBeenCalledOnce()
    // 밀어서 뒤로·안드로이드 뒤로도 같은 길 (상품 추가와 같은 훅)
    const source = read('src/screens/OrderInfoScreen.tsx')
    expect(source).toContain('useStepBack(stepBack, back, previousInfoStep(step, asked) === null)')
    expect(source).toContain('onBack={() => { if (stepBack.current?.() !== true) onBack() }}')
  })

  it('서버가 칸을 거절하면 그 단계로 돌아가 칸 아래에 알린다', async () => {
    const w = world(bundle({ address: { name: '김다육', phone: '01012345678', address: '서울', detail: '', zip: '', memo: '', source: 'BUYER', confirmed: false, updatedAt: '2026-10-29T12:00:00.000Z' } }), detail(), (sent) => {
      const address = sent['address'] as Record<string, string>
      return address['name'] === '김다육다육' ? { status: 400, body: { error: { code: 'INVALID_ADDRESS', message: '배송지를 확인해 주세요.', problems: [{ field: 'address.name', message: '받는 분 이름을 다시 적어 주세요.' }] } } } : null
    })
    const page = await open(w, 'name')
    const input = await within(page).findByLabelText(ASK_INFO.name)
    // 아는 값으로 채워 있다
    expect((input as HTMLInputElement).value).toBe('김다육')
    fireEvent.change(input, { target: { value: '김다육다육' } })
    next()
    fireEvent.click(await within(page).findByRole('button', { name: '저장하기' }))
    expect(await within(page).findByText('받는 분 이름을 다시 적어 주세요.')).toBeTruthy()
    expect(within(page).getByLabelText(ASK_INFO.name)).toBeTruthy()
    fireEvent.change(within(page).getByLabelText(ASK_INFO.name), { target: { value: '김다육' } })
    expect(within(page).queryByText('받는 분 이름을 다시 적어 주세요.')).toBeNull()
  })

  it('그 사이 바뀌어 거절(409)되면 지금 모습을 다시 받고 [저장하기] 위에 서버 문장', async () => {
    let refused = true
    const w = world(bundle(), detail({ name: '김다육', phone: '01012345678' }), () => {
      if (!refused) return null
      refused = false
      return { status: 409, body: { error: { code: 'CONFLICT', message: '그 사이 배송지가 바뀌었어요. 다시 확인해 주세요.' } } }
    })
    const page = await open(w, 'address')
    fireEvent.change(await within(page).findByLabelText(ASK_INFO.address), { target: { value: '서울' } })
    next()
    fireEvent.click(await within(page).findByRole('button', { name: SKIP_DETAIL }))
    fireEvent.click(await within(page).findByRole('button', { name: '저장하기' }))
    expect(await within(page).findByText('그 사이 배송지가 바뀌었어요. 다시 확인해 주세요.')).toBeTruthy()
    await waitFor(() => expect(w.server.callsTo('GET', /\/bundle\?buyer=u1$/).length).toBeGreaterThan(1))
  })

  it('택배를 접수한 묶음·보관 기간이 지난 날짜는 안내만', async () => {
    const locked = world(bundle({ locked: true }), detail())
    render(locked.wrap(<OrderInfoFlow date={DATE} buyer="u1" field="name" onBack={() => {}} onSaved={() => {}} />))
    expect(await screen.findByText(LOCKED_ADDRESS)).toBeTruthy()
    expect(screen.queryByLabelText(ASK_INFO.name)).toBeNull()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()
  })

  it('보관 기간이 지난 날짜', async () => {
    const expired = world(bundle({ expired: true }), detail())
    render(expired.wrap(<OrderInfoFlow date={DATE} buyer="u1" field="address" onBack={() => {}} onSaved={() => {}} />))
    expect(await screen.findByText(ADDRESS_EXPIRED)).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()
  })

  it('경로: /order-info?date=&buyer=&field= — 칸이 아니면 주문으로', () => {
    const route = read('app/order-info.tsx')
    expect(route).toContain("const FIELDS: readonly OrderInfoField[] = ['name', 'phone', 'address']")
    expect(route).toContain('<Redirect href="/settle" />')
  })
})
