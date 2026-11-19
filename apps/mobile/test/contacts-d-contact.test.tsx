// D-CONTACT-01·02 (사용자 지시 2026-11-20 "같은 번호면 같은 사람인 걸 알게끔 … 같은 사람 정보 입력 두 번 안 하게 … 주소록에서 찾기 버튼 눌러서 편하게 정보 넣기"):
// 손님 정보 [주소록에서 찾기] · 번호를 적으면 같은 번호로 전에 적은 손님의 성함·주소를 빈 칸에 · 주문 상세의 "지난 주문 정보" · 주소록 이름 알아보기.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { OrderDetailView } from '@livejjim/web/src/api/order-types.ts'
import type { BundleView, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { contactAddress, contactName, fillEmpty, mobileDigits, nameIndex, personOf, pickMobile } from '../src/lib/contact-pick.ts'
import type { NativeContacts, PickResult } from '../src/native/contacts.ts'
import { nativeContacts, setNativeModules } from '../src/native/index.ts'
import { OrderDetailScreen, REMEMBERED_INFO, addressBookWords } from '../src/screens/OrderDetailScreen.tsx'
import { ASK_INFO, CONTACT_FILLED, FIND_IN_CONTACTS, KNOWN_CUSTOMER, OrderInfoScreen, contactNameWords, type OrderInfoField } from '../src/screens/OrderInfoScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const DATE = '2026-10-29'
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
  remembered: false,
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

const KNOWN = { name: '김받는', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524' }

function fakeContacts(patch: Partial<NativeContacts> = {}): NativeContacts {
  const previous = nativeContacts()
  const fake: NativeContacts = { available: async () => true, pick: async (): Promise<PickResult> => ({ kind: 'cancelled' }), nameOf: async () => null, ...patch }
  setNativeModules({ contacts: fake })
  onTestFinished(() => setNativeModules({ contacts: previous }))
  return fake
}

function world(order: OrderDetailView, known: Record<string, typeof KNOWN> = {}) {
  const w = makeWorld()
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/bundle\?buyer=u1$/, () => ({ body: { bundle: bundle() } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29\/order\?buyer=u1$/, () => ({ body: order }))
  w.server.on('POST', /^\/api\/contacts\/lookup$/, (call) => ({ body: { contact: known[String((call.body ?? {})['phone'])] ?? null } }))
  w.server.on('PUT', /^\/api\/parcels\/days\/2026-10-29\/address$/, (call) => ({ body: { bundle: bundle({ address: { ...((call.body ?? {})['address'] as Record<string, string>), source: 'SELLER', confirmed: true, updatedAt: '2026-10-29T13:00:00.000Z' } as BundleView['address'] }) } }))
  return w
}

const open = (w: ReturnType<typeof world>, field: OrderInfoField) => {
  render(w.wrap(<OrderInfoScreen date={DATE} buyer="u1" field={field} onBack={() => {}} onSaved={() => {}} />))
  return screen.findByRole('main', { name: '손님 정보' })
}
const typePad = (keys: readonly string[]) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of keys) fireEvent.click(within(pad).getByRole('button', { name: key }))
}
const confirmLines = async (page: HTMLElement) => Array.from((await within(page).findByTestId('info-confirm-lines')).children).map((line) => line.textContent)

describe('주소록 고른 사람 → 손님 정보 값 (D-CONTACT-02)', () => {
  it('휴대폰 번호만 (+82·82도 0으로), 이름은 보이는 이름 또는 성+이름, 주소는 시·도부터 한 줄', () => {
    expect(mobileDigits('010-1234-5678')).toBe('01012345678')
    expect(mobileDigits('+82 10-1234-5678')).toBe('01012345678')
    expect(mobileDigits('821012345678')).toBe('01012345678')
    expect(mobileDigits('02-123-4567')).toBeNull()
    expect(mobileDigits('1588-1234')).toBeNull()
    expect(pickMobile({ phoneNumbers: [{ number: '02-123-4567' }, { number: '010 9999 8888' }] })).toBe('01099998888')
    expect(pickMobile({ phoneNumbers: [{ number: '02-123-4567' }] })).toBe('')
    expect(contactName({ name: ' 홍길동 ' })).toBe('홍길동')
    expect(contactName({ firstName: '길동', lastName: '홍' })).toBe('홍길동')
    expect(contactAddress({ addresses: [{ region: '서울특별시', city: '중구', street: '세종대로 110', postalCode: '04-524' }] })).toEqual({ address: '서울특별시 중구 세종대로 110', zip: '04524' })
    // 길 칸에 주소 전체를 적은 사람
    expect(contactAddress({ addresses: [{ region: '서울특별시', city: '중구', street: '서울특별시 중구 세종대로 110' }] })).toEqual({ address: '서울특별시 중구 세종대로 110', zip: '' })
    expect(contactAddress({})).toEqual({ address: '', zip: '' })
    expect(personOf({ name: '홍길동', phoneNumbers: [{ number: '010-1111-2222' }] })).toEqual({ name: '홍길동', phone: '01011112222', address: '', zip: '' })
  })

  it('번호마다 이름 — 한 번호에 이름이 둘이면 누구인지 몰라 넣지 않는다', () => {
    const names = nameIndex([
      { name: '홍길동', phoneNumbers: [{ number: '010-1111-2222' }] },
      { name: '박다육', phoneNumbers: [{ number: '010-3333-4444' }] },
      { name: '박다육 사장님', phoneNumbers: [{ number: '+82 10-3333-4444' }] },
      { name: '', phoneNumbers: [{ number: '010-5555-6666' }] },
    ])
    expect(names.get('01011112222')).toBe('홍길동')
    expect(names.has('01033334444')).toBe(false)
    expect(names.has('01055556666')).toBe(false)
  })

  it('빈 칸만 채운다 — 판매자가 적은 값은 덮지 않는다', () => {
    const now = { name: '김다육', phone: '', address: '', detail: '' }
    expect(fillEmpty(now, { name: '딴사람', phone: '01011112222', address: '서울 1', detail: '2층' })).toEqual({ next: { name: '김다육', phone: '01011112222', address: '서울 1', detail: '2층' }, filled: ['phone', 'address'] })
    expect(fillEmpty({ ...now, address: '부산', detail: '' }, { address: '서울', detail: '2층' }).filled).toEqual([])
  })
})

describe('손님 정보 [주소록에서 찾기]·같은 번호 손님 (D-CONTACT-01·02)', () => {
  it('주소록 모듈이 없는 앱(옛 앱·웹)에는 단추가 없다', async () => {
    setNativeModules({ contacts: { available: async () => false, pick: async () => ({ kind: 'failed' }), nameOf: async () => null } })
    const previous = nativeContacts()
    onTestFinished(() => setNativeModules({ contacts: previous }))
    const page = await open(world(detail()), 'name')
    await within(page).findByLabelText(ASK_INFO.name)
    expect(within(page).queryByRole('button', { name: FIND_IN_CONTACTS })).toBeNull()
  })

  it('성함 단계에서 고르면 성함·번호를 넣고, 그 번호로 전에 적은 손님의 주소·상세 주소·우편번호까지 채워 바로 확인 화면', async () => {
    const pick = vi.fn(async (): Promise<PickResult> => ({ kind: 'picked', person: { name: '김받는 고객님', phone: '01022223333', address: '', zip: '' } }))
    fakeContacts({ pick })
    const w = world(detail(), { '01022223333': KNOWN })
    const page = await open(w, 'name')
    fireEvent.click(await within(page).findByRole('button', { name: FIND_IN_CONTACTS }))
    expect(await confirmLines(page)).toEqual(['김받는 고객님', '010-2222-3333', '서울특별시 중구 세종대로 110 101동 202호'])
    expect(pick).toHaveBeenCalledOnce()
    // 서버에는 번호만 보낸다 (주소록 전체를 올리지 않는다)
    expect(w.server.callsTo('POST', /^\/api\/contacts\/lookup$/).map((call) => call.body)).toEqual([{ phone: '01022223333' }])
    fireEvent.click(within(page).getByRole('button', { name: '저장하기' }))
    await waitFor(() => expect(w.server.callsTo('PUT', /address$/)).toHaveLength(1))
    expect(w.server.callsTo('PUT', /address$/)[0]?.body).toMatchObject({ address: { name: '김받는 고객님', phone: '01022223333', address: KNOWN.address, detail: KNOWN.detail, zip: '04524' } })
  })

  it('번호를 적고 [다음]: 같은 번호로 전에 적은 손님이면 성함·주소를 채우고 건너뛴다. 모르는 번호면 그대로 묻는다', async () => {
    fakeContacts()
    const w = world(detail(), { '01022223333': KNOWN })
    const page = await open(w, 'phone')
    await within(page).findByRole('status', { name: ASK_INFO.phone })
    typePad(['0', '1', '0', '2', '2', '2', '2', '3', '3', '3', '3'])
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await confirmLines(page)).toEqual(['김받는', '010-2222-3333', '서울특별시 중구 세종대로 110 101동 202호'])
  })

  it('모르는 번호: 주소록에 그 번호가 있으면 번호 아래에 이름을 보이고 빈 성함에 넣는다, 주소는 묻는다', async () => {
    fakeContacts({ nameOf: async (digits) => (digits === '01077778888' ? '이웃집' : null) })
    const w = world(detail())
    const page = await open(w, 'phone')
    await within(page).findByRole('status', { name: ASK_INFO.phone })
    typePad(['0', '1', '0', '7', '7', '7', '7', '8', '8', '8', '8'])
    expect(await within(page).findByText(contactNameWords('이웃집'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await within(page).findByLabelText(ASK_INFO.address)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: / 고치기$/ }).map((line) => line.getAttribute('aria-label'))).toEqual(['성함 이웃집 고치기', '휴대폰 번호 010-7777-8888 고치기'])
    expect(within(page).queryByText(KNOWN_CUSTOMER)).toBeNull()
  })

  it('번호 단계에서 고른 사람: 번호는 고른 값으로 바꾸고, 이미 아는 성함은 덮지 않는다. 허용하지 않으면 안내', async () => {
    let answer: PickResult = { kind: 'denied' }
    fakeContacts({ pick: async () => answer })
    const w = world(detail({ name: '김다육' }))
    const page = await open(w, 'phone')
    fireEvent.click(await within(page).findByRole('button', { name: FIND_IN_CONTACTS }))
    expect(await within(page).findByText(/허용이 필요해요/)).toBeTruthy()
    answer = { kind: 'picked', person: { name: '딴이름', phone: '01012345678', address: '', zip: '' } }
    fireEvent.click(within(page).getByRole('button', { name: FIND_IN_CONTACTS }))
    expect(await within(page).findByLabelText(ASK_INFO.address)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: / 고치기$/ }).map((line) => line.getAttribute('aria-label'))).toEqual(['성함 김다육 고치기', '휴대폰 번호 010-1234-5678 고치기'])
    expect(within(page).getByText(CONTACT_FILLED)).toBeTruthy()
  })
})

describe('주문 상세 (D-CONTACT-01·02)', () => {
  it('같은 손님의 지난 주문 정보면 주소 아래 "지난 주문 정보 · 확인 전", 주소록에 있는 번호면 번호 아래 주소록 이름', async () => {
    fakeContacts({ nameOf: async (digits) => (digits === '01022223333' ? '김받는 단골' : null) })
    const w = world(detail({ name: '김받는', phone: '01022223333', address: { address: KNOWN.address, detail: KNOWN.detail, zip: KNOWN.zip }, remembered: true }))
    render(w.wrap(<OrderDetailScreen date={DATE} buyer="u1" onBack={() => {}} />))
    const page = await screen.findByRole('main', { name: '주문 상세' })
    expect(await within(page).findByText(REMEMBERED_INFO)).toBeTruthy()
    expect(await within(page).findByText(addressBookWords('김받는 단골'))).toBeTruthy()
  })

  it('그날 적은 정보면 표시가 없고, 주소록 이름이 성함과 같으면 다시 적지 않는다', async () => {
    fakeContacts({ nameOf: async () => '김받는' })
    const w = world(detail({ name: '김받는', phone: '01022223333', address: { address: KNOWN.address, detail: '', zip: '' } }))
    render(w.wrap(<OrderDetailScreen date={DATE} buyer="u1" onBack={() => {}} />))
    const page = await screen.findByRole('main', { name: '주문 상세' })
    await within(page).findByText('010-2222-3333')
    expect(within(page).queryByText(REMEMBERED_INFO)).toBeNull()
    expect(within(page).queryByText(addressBookWords('김받는'))).toBeNull()
  })
})
