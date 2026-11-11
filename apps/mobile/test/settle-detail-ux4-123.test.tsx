// 손님 자세히 다시 짜기 (D-UX4-123) → 주문 상세 맨 아래 줄 (D-UX4-125).
// D-UX4-125 (사용자 지시 2026-11-11 '주문 탭 수정 사항')로 바뀐 기대: 옛 "맨 위 다음 할 일 카드 하나(정보 받기 → 배송지 칸 그 자리에, 확인서 보내기 → [확인서 문자 보내기],
// 입금 확인 → [입금 적기]/[환불 적기], 다 끝남 → 한 줄) + 금액 카드 + 금액 고치기 줄(다음 할 일 단추와 겹치는 것은 뺌)"
// → 새 "토스 상세 내역 모양(성함·표·금액·지난 거래) 아래에 배송지 칸 · 확인서 줄 · 금액 고치기 넷(늘 모두)". 다음 할 일 카드는 사용자가 뺐다 —
// 판매자가 하던 일(배송지 적기·확인서 문자·입금·환불)은 그대로 이 화면에서 할 수 있는지를 지킨다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BundleView } from '@livejjim/web/src/api/parcel-types.ts'
import type { ReceiptBuyerRow, Settlement } from '@livejjim/web/src/api/types.ts'
import { setNativeModules } from '../src/native/index.ts'
import { shareFile } from '../src/native/share.ts'
import { deviceSms, type SmsImage, type SmsResult } from '../src/native/sms.ts'
import { OrderDetailScreen } from '../src/screens/OrderDetailScreen.tsx'
import { orderDetail, ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView } from './support.ts'

const DATE = '2026-10-29'

const settlementOf = (patch: Partial<Settlement> = {}): Settlement => ({
  buyer: 'u1',
  date: DATE,
  items: ['b1/15'],
  subtotal: 10_000,
  shipping: 4_000,
  shippingOverride: null,
  adjustments: 0,
  total: 14_000,
  received: 0,
  refundDue: 0,
  payment: 'UNPAID',
  records: [],
  ...patch,
})

const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0x01])

interface Setup {
  readonly settlement?: Partial<Settlement>
  /** 있으면 영수증 줄(문자 칸)을 준다 */
  readonly address?: 'NONE' | 'CONFIRMED'
  readonly sent?: boolean
  readonly sms?: ReceiptBuyerRow['sms']
  readonly smsReady?: boolean
  readonly sealed?: boolean
}

function world(setup: Setup = {}) {
  const w = makeWorld()
  const posts: { path: string; body: Record<string, unknown> | null }[] = []
  let sentAt: string | null = setup.sent === true ? '2026-10-29T13:00:00.000Z' : null
  w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: { ...fullView({ buyers: [buyer('u1', '다육맘')], claims: [claim('c1', 15, 'u1')], settlements: [settlementOf(setup.settlement)] }), ...(setup.sealed === true ? { sealed: true } : {}) } }))
  const bundle: BundleView = { date: DATE, buyer: 'u1', address: null, locked: false, expired: false, row: { buyer: 'u1', name: '다육맘', phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'UNPAID', packing: '포장 전', shipping: 'NONE', address: 'NONE', ready: false, reason: null, message: null, box: '60', parcel: null } as BundleView['row'], ledger: null }
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/bundle/, () => ({ body: { bundle } }))
  const s = settlementOf(setup.settlement)
  withOrders(w, ordersView([]), { details: { '2026-10-29|u1': orderDetail({ buyer: 'u1', name: null, nickname: '다육맘', received: s.received, refundDue: s.refundDue, payment: s.payment }) } })
  if (setup.address !== undefined) {
    const prow = { buyer: 'u1', name: '다육맘', phoneLast4: null, itemCount: 1, qty: 1, total: 14_000, payment: 'UNPAID', packing: '포장 전', shipping: 'NONE', address: setup.address, ready: false, reason: null, message: null, box: '80', parcel: null }
    w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { date: DATE, seq: 5, blocked: null, carrier: null, box: '80', ready: [], excluded: [prow], booked: [] } }))
    w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers$/, () => {
      const sms = setup.sms === undefined ? {} : { sms: setup.sms === null ? null : { ...setup.sms, sentAt: sentAt ?? setup.sms.sentAt } }
      const row = { buyer: 'u1', name: '다육맘', phoneLast4: null, itemCount: 1, total: 14_000, payment: 'UNPAID', received: 0, remaining: 14_000, link: { buyer: 'u1', status: 'NONE', url: null, expiresAt: null, revokedAt: null }, ...sms }
      // 보냄 표시는 문자 칸(sentAt)으로 — 문자 칸이 없는 줄은 링크 상태로 알린다
      const sentRow = sentAt !== null && setup.sms === undefined ? { ...row, link: { ...row.link, status: 'ACTIVE' } } : row
      return { body: { date: DATE, rehearsal: false, ...(setup.smsReady === true ? { smsReady: true } : {}), buyers: [sentRow] } }
    })
  }
  w.server.on('POST', /^\/api\/days\/2026-10-29\/receipt-sms\/prepare/, (call) => {
    posts.push({ path: call.path, body: call.body })
    if (setup.sms?.last4 == null && call.body?.['phone'] === undefined) return { status: 409, body: { error: { code: 'NO_PHONE', message: '이 손님의 휴대폰 번호를 몰라요. 번호를 넣어 주세요.' } } }
    return { body: { sms: { buyer: 'u1', phone: '01012345678', last4: '5678', text: '[초록가게] 다육맘님 주문 확인서예요.' } } }
  })
  w.server.on('POST', /^\/api\/days\/2026-10-29\/receipt-sms\/sent/, (call) => {
    posts.push({ path: call.path, body: call.body })
    sentAt = '2026-10-29T14:00:00.000Z'
    return { body: { sms: { buyer: 'u1', last4: '5678', sentAt } } }
  })
  w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt\.jpg\?buyer=u1$/, () => ({ bytes: jpg, contentType: 'image/jpeg' }))
  return { w, posts }
}

/** 가짜 문자 앱: 연 번호·글·붙인 사진을 적는다 */
function fakeSms(results: SmsResult[] = [], available = true) {
  const opened: { phone: string; text: string; image: SmsImage | undefined }[] = []
  setNativeModules({
    sms: {
      available: async () => available,
      compose: async (phone, text, image) => {
        opened.push({ phone, text, image })
        return results.shift() ?? 'sent'
      },
    },
  })
  return opened
}

afterEach(() => {
  setNativeModules({ shareFile, sms: deviceSms })
})

const open = (w: ReturnType<typeof makeWorld>) => render(w.wrap(<OrderDetailScreen date={DATE} buyer="u1" onBack={() => {}} />))
/** [정산서 보내기] 창의 [고객에게 문자 보내기] 줄 (D-UX4-128 — 옛 상세 맨 아래 "확인서" 묶음의 [확인서 문자 보내기]) */
async function smsRow() {
  fireEvent.click(await screen.findByRole('button', { name: '정산서 보내기' }))
  const row = within(await screen.findByTestId('order-send')).getByRole('button', { name: '고객에게 문자 보내기' })
  await waitFor(() => expect(row.getAttribute('aria-busy')).not.toBe('true'))
  return row
}

describe('주문 상세 맨 아래 줄 (D-UX4-123 → D-UX4-125)', () => {
  // D-UX4-126 (사용자 지시 2026-11-11 "배송지 확인*고치기 이런 글자 다 지워 … 그 영역을 누르면 … 입력 받을 수 있게"):
  // 옛 "아래 배송지 칸 하나([배송지 적기])" → 아래 배송지 칸은 없고, 위 손님 묶음의 주소 줄을 눌러 손님 정보 화면에서 적는다
  it('배송지: 아래 배송지 칸은 없고, 위 손님 묶음 주소 줄을 누르면 손님 정보 화면', async () => {
    const { w } = world({ address: 'NONE', sms: { last4: '5678', sentAt: null }, smsReady: true })
    const onEditInfo = vi.fn()
    render(w.wrap(<OrderDetailScreen date={DATE} buyer="u1" onBack={() => {}} onEditInfo={onEditInfo} />))
    const head = await screen.findByRole('group', { name: '손님' })
    fireEvent.click(within(head).getByRole('button', { name: /^주소 .* · 고치기$/ }))
    expect(onEditInfo).toHaveBeenCalledWith('address')
    expect(screen.queryByRole('group', { name: '배송지' })).toBeNull()
    expect(screen.queryByRole('button', { name: '배송지 적기' })).toBeNull()
  })

  // D-UX4-128 (사용자 지시 2026-11-11 "내보내기 -> 정산서 보내기 … 옵션으로 고객에게 문자 보내기 …", "지난 거래 내역 아래에 있는 메뉴들 다 지워"):
  // 옛 "상세 맨 아래 확인서 묶음 [확인서 문자 보내기]" → 새 "[정산서 보내기] 창의 [고객에게 문자 보내기]" — 같은 흐름(사진 붙여 문자 앱, 보냄 표시)
  it('문자: [정산서 보내기] → [고객에게 문자 보내기]가 창을 닫고 사진을 붙여 문자 앱을 열고 보냄 표시', async () => {
    const opened = fakeSms()
    const { w, posts } = world({ address: 'CONFIRMED', sms: { last4: '5678', sentAt: null }, smsReady: true })
    open(w)
    fireEvent.click(await smsRow())
    await waitFor(() => expect(opened).toHaveLength(1), { timeout: 3000 })
    expect(opened[0]).toEqual({ phone: '01012345678', text: '[초록가게] 다육맘님 주문 확인서예요.', image: { bytes: jpg, name: 'receipt-2026-10-29.jpg' } })
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/days/2026-10-29/receipt-sms/prepare', '/api/days/2026-10-29/receipt-sms/sent']))
    expect(posts[1]!.body).toMatchObject({ buyer: 'u1' })
    expect(await screen.findByText('문자를 보냈어요.')).toBeTruthy()
  })

  it('문자: 서버가 번호를 모른다(NO_PHONE)고 하면 번호를 묻고, 넣은 번호로 문자 앱을 연다', async () => {
    const opened = fakeSms()
    const { w, posts } = world({ address: 'CONFIRMED', smsReady: true })
    open(w)
    fireEvent.click(await smsRow())
    const field = await screen.findByLabelText('손님 휴대폰 번호', {}, { timeout: 3000 })
    expect(opened).toHaveLength(0)
    fireEvent.change(field, { target: { value: '010-1234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: '문자 앱 열기' }))
    await waitFor(() => expect(opened).toHaveLength(1), { timeout: 3000 })
    expect(opened[0]!.image).toEqual({ bytes: jpg, name: 'receipt-2026-10-29.jpg' })
    expect(posts[1]!.body).toMatchObject({ buyer: 'u1', phone: '010-1234-5678' })
    await waitFor(() => expect(posts.filter((post) => post.path.endsWith('/sent'))).toHaveLength(1))
  })

  // D-UX4-128: 옛 "문자 줄 대신 [영수증 보내기 화면 열기]" → 줄은 그대로 두고 흐리게, 아래에 까닭 한 줄
  it('문자: 이 기기에서 문자를 못 보내면 [고객에게 문자 보내기]는 흐리고 까닭이 보인다', async () => {
    fakeSms([], false)
    const { w } = world({ address: 'CONFIRMED', sms: { last4: '5678', sentAt: null }, smsReady: true })
    open(w)
    const row = await smsRow()
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(within(row).getByText('이 휴대폰에서는 문자를 보낼 수 없어요')).toBeTruthy()
  })

  // D-UX4-128 (사용자 지시 "입금 아래에 입금을 확인했나요? 버튼 추가하고 누르면 팝업 띄우고 확인했어요 누르면 남은 금액 없고 다 받은걸로 하기"):
  // 옛 "금액 고치기 넷([입금 적기]는 남은 금액이 미리 든 칸)" → 금액 고치기 메뉴는 사용자가 지웠고, 입금은 [입금을 확인했나요?] 하나
  it('입금: 남은 금액이 있으면 [입금을 확인했나요?] → 팝업 [확인했어요] → 남은 금액만큼 입금을 적는다, 금액 고치기 메뉴는 없다', async () => {
    const { w } = world({ address: 'CONFIRMED', sent: true, settlement: { received: 4_000, payment: 'PARTIAL' } })
    open(w)
    const paid = await screen.findByRole('group', { name: '입금' })
    fireEvent.click(await within(paid).findByRole('button', { name: '입금을 확인했나요?' }))
    fireEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.body).toMatchObject({ type: 'settlement.payment', buyer: 'u1', date: DATE, amountText: '10000' })
    expect(screen.queryByRole('group', { name: '금액 고치기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '환불 적기' })).toBeNull()
  })

  // D-UX4-128: 옛 "30일 지난 날짜는 보기만 한다는 안내 한 번, 금액 고치기·확인서 줄도 없다" → 메뉴가 없어져 안내 줄도 없고,
  // 고칠 수 있는 단추(입금 확인·이 주문 배송비)가 없고 문자 줄은 흐리다
  it('30일 지난 날짜는 입금 확인 단추가 없고, 배송비 바꾸기는 기준 바꾸기만, 문자 줄은 흐리다', async () => {
    fakeSms()
    const { w } = world({ address: 'CONFIRMED', sent: true, sealed: true, sms: { last4: '5678', sentAt: null }, smsReady: true })
    render(w.wrap(<OrderDetailScreen date={DATE} buyer="u1" onBack={() => {}} onOpenShopSettings={() => {}} />))
    const paid = await screen.findByRole('group', { name: '입금' })
    await waitFor(() => expect(within(paid).queryByRole('button', { name: '입금을 확인했나요?' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '배송비 바꾸기' }))
    const choice = await screen.findByTestId('shipping-choice')
    await waitFor(() => expect(within(choice).getAllByRole('radio').map((r) => r.textContent?.includes('이 주문') === true)).toEqual([false]))
    fireEvent.click(screen.getByRole('button', { name: '정산서 보내기' }))
    const row = within(await screen.findByTestId('order-send')).getByRole('button', { name: '고객에게 문자 보내기' })
    await waitFor(() => expect(row.getAttribute('aria-disabled')).toBe('true'))
  })
})
