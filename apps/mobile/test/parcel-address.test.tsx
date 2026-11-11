// 앱 배송지 칸·택배 꼬리표·포장 잠금 (D-UX3-35 — 웹 ParcelParts.AddressSection·PackingPage와 같은 규칙·문구).
// 앱 정산 화면엔 배송지 칸이 없어서, 택배 화면 [배송지 보기]가 막다른 길이었다(우편번호를 못 찾아 돌려보낸 주소를 앱에서 못 고침).
// D-UX4-126 (사용자 지시 2026-11-11 "배송지 확인*고치기 이런 글자 다 지워 … 그 영역을 누르면 … 상품 추가 페이지 … 처럼 입력 받을 수 있게"):
// 주문 상세 아래 배송지 칸(꼬리표·여섯 칸·[지우기][고치기][배송지 확인]·창)은 없앴다. 같은 일을 위 손님 묶음 주소 줄이 한다 —
// 택배사가 돌려보낸 까닭·"확인 전"은 주소 아래 작은 글, 고치기·확인은 줄을 눌러 손님 정보 화면에서 저장(판매자가 적은 확인된 배송지), 접수 중이면 누를 수 없다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BundleView, ParcelBrief, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import type { PackingEntry, Settlement } from '@livejjim/web/src/api/types.ts'
import { ASK_INFO } from '../src/screens/OrderInfoScreen.tsx'
import { PackingScreen } from '../src/screens/PackingScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { orderDetail, orderRow, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView } from './support.ts'

const DATE = '2026-10-29'

const settlement = (id: string): Settlement => ({ buyer: id, date: DATE, items: ['b1/15'], subtotal: 10_000, shipping: 4_000, shippingOverride: null, adjustments: 0, total: 14_000, received: 14_000, refundDue: 0, payment: 'PAID', records: [] })

const inTransit = { state: 'BOOKED', carrier: 'EPOST', carrierName: '우체국택배', invoice: '900000000001', invoiceText: '9000-0000-0001', status: '배송 중', checkedAt: null, trackUrl: null, reason: null, message: null, box: '60', qty: 1, bookedAt: '2026-10-29T13:00:00.000Z', cancellable: false } as ParcelBrief
const addressFailed = { ...inTransit, state: 'FAILED', invoice: null, invoiceText: null, status: null, reason: 'ADDRESS', message: '택배사가 주소를 찾지 못했어요. 배송지 주소와 우편번호를 확인해 주세요.', cancellable: false } as ParcelBrief

const row = (patch: Partial<ParcelRow> = {}): ParcelRow =>
  ({ buyer: 'u1', name: '다육맘', phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'PAID', packing: '포장 완료', shipping: 'FIXED', address: 'CONFIRMED', ready: true, reason: null, message: null, box: '60', parcel: null, ...patch }) as ParcelRow

const bundle = (patch: Partial<BundleView> = {}): BundleView => ({
  date: DATE,
  buyer: 'u1',
  address: { name: '김다육', phone: '01012345678', address: '경상남도 양산시 물금읍 증산리', detail: '1034', zip: '', memo: '', source: 'BUYER', confirmed: false, updatedAt: '2026-10-29T12:00:00.000Z' },
  locked: false,
  expired: false,
  row: row({ parcel: addressFailed, ready: false, reason: 'PARCEL_FAILED' } as Partial<ParcelRow>),
  ledger: null,
  ...patch,
})

function world(start: BundleView = bundle()) {
  const w = makeWorld()
  let current = start
  w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE, rehearsal: false, seq: 5 }] } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ buyers: [buyer('u1', '다육맘'), buyer('u2', '초록손')], claims: [claim('c1', 15, 'u1'), claim('c2', 16, 'u2')], settlements: [settlement('u1'), settlement('u2')] }) }))
  // D-UX4-125: 주문 탭 목록·주문 상세 (택배 화면 [배송지 보기]는 주문 상세의 배송지 칸으로 온다)
  withOrders(w, ordersView([orderRow({ buyer: 'u1', nickname: '다육맘' }), orderRow({ buyer: 'u2', name: null, nickname: '초록손' })]), { details: { '2026-10-29|u1': orderDetail({ buyer: 'u1', nickname: '다육맘' }), '2026-10-29|u2': orderDetail({ buyer: 'u2', name: null, nickname: '초록손' }) } })
  w.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: DATE, seq: 5, entries: [{ buyer: 'u2', name: '초록손', parcel: inTransit }] } }))
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/bundle/, () => ({ body: { bundle: current } }))
  w.server.on('POST', /^\/api\/parcels\/days\/2026-10-29\/address\/confirm$/, () => {
    current = { ...current, address: current.address === null ? null : { ...current.address, confirmed: true } }
    return { body: { bundle: current } }
  })
  w.server.on('PUT', /^\/api\/parcels\/days\/2026-10-29\/address$/, (call) => {
    const sent = call.body?.['address'] as Record<string, string>
    if (sent['zip'] === '1234') return { status: 400, body: { error: { code: 'INVALID_ADDRESS', message: '배송지를 확인해 주세요.', problems: [{ field: 'address.zip', message: '우편번호는 숫자 5자리로 적어 주세요.' }] } } }
    current = { ...current, address: { ...sent, source: 'SELLER', confirmed: true, updatedAt: '2026-10-29T13:00:00.000Z' } as BundleView['address'] }
    return { body: { bundle: current } }
  })
  return w
}

describe('주문 상세 주소 줄 (D-UX3-35 → D-UX4-126)', () => {
  // D-UX4-126로 바뀐 기대: 옛 "배송지 칸에 택배 꼬리표·여섯 칸·출처·확인 전" → 주소 줄 아래 작은 빨간 까닭(돌려보낸 까닭이 확인 전보다 먼저)
  it('택배 화면에서 온 손님은 주문 상세부터 열리고 주소 아래 택배사가 돌려보낸 까닭, 뒤로 가면 주문 목록', async () => {
    const w = world()
    render(w.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const head = await screen.findByRole('group', { name: '손님' })
    const reason = '택배사가 주소를 찾지 못했어요. 배송지 주소와 우편번호를 확인해 주세요.'
    const line = await within(head).findByRole('button', { name: `주소 (50603) 경상남도 양산시 물금읍 증산리 1034 · ${reason} · 고치기` })
    expect(within(line).getByText(reason).style.color).toBe('rgb(221, 24, 36)')
    expect(screen.queryByLabelText('배송지')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '주문 목록으로' }))
    expect(await screen.findByRole('button', { name: '10월 29일 · 초록손 · 14,000원 · 1개' })).toBeTruthy()
  })

  // D-UX4-126로 바뀐 기대: 옛 [배송지 확인](POST address/confirm)·[고치기] 창 → 주소 줄을 눌러 손님 정보 화면에서 저장(PUT — 판매자가 적은 확인된 배송지).
  // 주소를 바꾸면 옛 우편번호는 비운다(서버가 새 주소로 찾는다 — 옛 우편번호 때문에 택배가 다시 돌아오지 않게)
  it('손님이 적은 주소는 "확인 전", 줄을 눌러 주소를 고쳐 저장하면 확인된 배송지 — 주소가 바뀌면 옛 우편번호는 비운다', async () => {
    const start = bundle({ row: row() })
    const w = world({ ...start, address: { ...start.address!, zip: '50603' } })
    render(w.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const head = await screen.findByRole('group', { name: '손님' })
    fireEvent.click(await within(head).findByRole('button', { name: /^주소 .* · 확인 전 · 고치기$/ }))
    const input = await screen.findByLabelText(ASK_INFO.address)
    fireEvent.change(input, { target: { value: '경상남도 양산시 물금읍 범어로 12' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    await screen.findByLabelText(ASK_INFO.detail)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.click(await screen.findByRole('button', { name: '저장하기' }))
    await waitFor(() => expect(w.server.callsTo('PUT', /address$/)).toHaveLength(1))
    expect(w.server.callsTo('PUT', /address$/)[0]?.body).toEqual({ requestId: expect.any(String), buyer: 'u1', address: { name: '김다육', phone: '01012345678', address: '경상남도 양산시 물금읍 범어로 12', detail: '1034', zip: '', memo: '' } })
    expect(w.server.callsTo('POST', /address\/confirm/)).toHaveLength(0)
    // 저장하면 상세로 돌아오고, 확인된 배송지라 "확인 전"이 없다
    const back = await screen.findByRole('group', { name: '손님' })
    await waitFor(() => expect(within(back).queryByText('확인 전')).toBeNull())
  })

  // D-UX4-126로 바뀐 기대: 옛 "배송지 칸에 접수 취소 안내 · 없으면 [배송지 적기]" → 접수 중이면 줄을 누를 수 없고, 없으면 빨간 "모름" 줄이 손님 정보 화면을 연다
  it('살아 있는 접수가 있으면 줄을 누를 수 없고, 배송지가 없으면 빨간 "모름" 줄이 손님 정보 화면을 연다', async () => {
    const locked = world(bundle({ locked: true, row: row({ parcel: inTransit }) }))
    const { unmount } = render(locked.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const head = await screen.findByRole('group', { name: '손님' })
    await waitFor(() => expect(within(head).queryAllByRole('button')).toHaveLength(0))
    expect(within(head).getByLabelText(/^주소 /)).toBeTruthy()
    unmount()
    const empty = world(bundle({ address: null, row: row() }))
    withOrders(empty, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ buyer: 'u1', name: null, phone: null, address: null }) } })
    render(empty.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const unknown = await screen.findByRole('group', { name: '손님' })
    fireEvent.click(await within(unknown).findByRole('button', { name: '주소 모름 · 고치기' }))
    expect(await screen.findByLabelText(ASK_INFO.address)).toBeTruthy()
  })
})

describe('포장 화면 택배 잠금 (D-UX3-35)', () => {
  const entry = (patch: Partial<PackingEntry> = {}): PackingEntry => ({ buyer: 'u1', name: '홍길동', phoneLast4: null, payment: 'PAID', items: [{ key: 'b1/15', broadcast: 'b1', title: '저녁 방송', no: 15, name: '핑크프릴', price: 10_000 }], status: '배송 완료', invoice: '900000000001', add: [], remove: [], ...patch })

  it('접수한 묶음은 택배 꼬리표 하나, 배송 완료 되돌리기 대신 까닭과 [택배 화면으로]', async () => {
    const w = makeWorld()
    w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE, rehearsal: false, seq: 5 }] } }))
    w.server.on('GET', /^\/api\/days\/2026-10-29\/packing$/, () => ({ body: { date: DATE, seq: 5, entries: [entry({ parcel: inTransit })] } }))
    const opened: string[] = []
    render(w.wrap(<PackingScreen openParcels={(date) => opened.push(date)} />))
    fireEvent.click(await screen.findByRole('button', { name: '보기: 배송 완료' }))
    const card = await screen.findByRole('group', { name: '지금 손님 — 홍길동' })
    expect(within(card).getByText('택배: 배송 중 · 9000-0000-0001')).toBeTruthy()
    expect(within(card).queryByText(/^배송 완료 · 송장/)).toBeNull()
    expect(within(card).queryByRole('button', { name: '배송 완료 되돌리기' })).toBeNull()
    expect(within(card).getByText(/택배로 접수한 묶음이라 포장·배송 기록은 여기서 바꿀 수 없어요/)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: '택배 화면으로' }))
    await waitFor(() => expect(opened).toEqual([DATE]))
  })
})
