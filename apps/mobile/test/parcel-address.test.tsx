// 앱 배송지 칸·택배 꼬리표·포장 잠금 (D-UX3-35 — 웹 ParcelParts.AddressSection·PackingPage와 같은 규칙·문구).
// 앱 정산 화면엔 배송지 칸이 없어서, 택배 화면 [배송지 보기]가 막다른 길이었다(우편번호를 못 찾아 돌려보낸 주소를 앱에서 못 고침).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BundleView, ParcelBrief, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import type { PackingEntry, Settlement } from '@livejjim/web/src/api/types.ts'
import { PackingScreen } from '../src/screens/PackingScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
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

describe('정산 배송지 칸 (D-UX3-35)', () => {
  it('정산 줄에 택배 꼬리표(포장 목록에서), 택배 화면에서 온 손님은 자세히부터 열린다', async () => {
    const w = world()
    render(w.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const card = await screen.findByLabelText('배송지')
    expect(await within(card).findByText('택배: 택배사가 주소를 찾지 못했어요. 배송지 주소와 우편번호를 확인해 주세요.')).toBeTruthy()
    expect(within(card).getByLabelText('주소 경상남도 양산시 물금읍 증산리')).toBeTruthy()
    expect(within(card).getByLabelText('상세 주소 1034')).toBeTruthy()
    expect(within(card).getByLabelText('연락처 010-1234-5678')).toBeTruthy()
    expect(within(card).getByText('구매자가 적었어요')).toBeTruthy()
    expect(within(card).getByText('확인 전')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '정산 목록으로' }))
    expect(await screen.findByRole('button', { name: '초록손 · 입금 완료 · 최종 14,000원 · 택배: 배송 중 · 9000-0000-0001' })).toBeTruthy()
  })

  it('배송지 확인은 고친 시각과 같이, 고치기는 여섯 칸을 보내고 칸 오류는 칸 옆에', async () => {
    const w = world()
    render(w.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const card = await screen.findByLabelText('배송지')
    const buttons = await within(card).findByRole('group', { name: '배송지 고치기' })
    // 단추는 좌우로만: 부정(지우기) 왼쪽, 긍정(배송지 확인) 오른쪽
    expect(within(buttons).getAllByRole('button').map((b) => b.textContent)).toEqual(['지우기', '고치기', '배송지 확인'])
    fireEvent.click(within(buttons).getByRole('button', { name: '배송지 확인' }))
    expect(await screen.findByText('배송지를 확인했어요.')).toBeTruthy()
    expect(w.server.callsTo('POST', /address\/confirm/)[0]?.body).toEqual({ requestId: expect.any(String), buyer: 'u1', updatedAt: '2026-10-29T12:00:00.000Z' })

    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    fireEvent.change(screen.getByLabelText('우편번호(몰라도 돼요)'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('우편번호는 숫자 5자리로 적어 주세요.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('우편번호(몰라도 돼요)'), { target: { value: '50603' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('배송지를 저장했어요.')).toBeTruthy()
    const puts = w.server.callsTo('PUT', /address$/)
    expect(puts[1]?.body).toEqual({ requestId: expect.any(String), buyer: 'u1', address: { name: '김다육', phone: '01012345678', address: '경상남도 양산시 물금읍 증산리', detail: '1034', zip: '50603', memo: '' } })
    expect(puts[0]?.body?.['requestId']).not.toBe(puts[1]?.body?.['requestId'])
    expect(within(card).getByLabelText('우편번호 50603')).toBeTruthy()
  })

  it('살아 있는 접수가 있으면 고치지 못하고 접수 취소를 먼저 안내, 없으면 [배송지 적기]', async () => {
    const locked = world(bundle({ locked: true, row: row({ parcel: inTransit }) }))
    const { unmount } = render(locked.wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const card = await screen.findByLabelText('배송지')
    expect(await within(card).findByText('택배 접수를 먼저 취소해 주세요.')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: '고치기' })).toBeNull()
    unmount()
    render(world(bundle({ address: null, row: row() })).wrap(<SettleScreen initialDate={DATE} initialBuyer="u1" />))
    const empty = await screen.findByLabelText('배송지')
    expect(await within(empty).findByText('배송지가 없어요')).toBeTruthy()
    fireEvent.click(within(empty).getByRole('button', { name: '배송지 적기' }))
    expect(await screen.findByLabelText('받는 분')).toBeTruthy()
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
