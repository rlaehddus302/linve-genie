// 손님 자세히 다시 짜기 (D-UX4-123, D-UX4-122 주문 탭 흐름의 손님 한 명 판): 이름·입금 상태 → 다음 할 일 카드(할 일 하나) → 금액(값만) → 금액 고치기 줄 → 품목 → 배송지 → 기록.
// 다음 할 일: 정보 받기면 배송지 칸을 그 자리에(아래에 또 두지 않음), 확인서 보내기면 [확인서 문자 보내기](영수증 보내기 화면과 같은 흐름 — 사진 붙여 문자 앱),
// 입금 확인이면 [입금 적기]/[환불 적기], 다 끝났으면 한 줄. 단계를 모르면(택배·영수증 줄 못 받음) 입금만 보고 "다 끝났어요"를 말하지 않는다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BundleView } from '@livejjim/web/src/api/parcel-types.ts'
import type { ReceiptBuyerRow, Settlement } from '@livejjim/web/src/api/types.ts'
import { setNativeModules } from '../src/native/index.ts'
import { shareFile } from '../src/native/share.ts'
import { deviceSms, type SmsImage, type SmsResult } from '../src/native/sms.ts'
import { SettleBuyerScreen } from '../src/screens/SettleDetail.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView } from './support.ts'

const DATE = '2026-10-29'
const KEY = JSON.stringify(['u1', DATE])

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
  /** 택배 줄의 배송지 (없으면 택배·영수증 줄을 주지 않는다 — 단계 모름) */
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

const open = (w: ReturnType<typeof makeWorld>, onOpenReceipts?: () => void) => render(w.wrap(<SettleBuyerScreen date={DATE} settlementKey={KEY} onBack={() => {}} onOpenReceipts={onOpenReceipts} />))
const nextCard = () => screen.findByRole('group', { name: '다음 할 일' })
/** 카드 a가 카드 b보다 위에 있나 */
const above = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('손님 자세히 다음 할 일 (D-UX4-123)', () => {
  it('정보 받기: 배송지를 못 받았다고 말하고 배송지 칸을 다음 할 일 바로 아래(금액 위)에 한 번만 둔다', async () => {
    const { w } = world({ address: 'NONE', sms: { last4: '5678', sentAt: null }, smsReady: true })
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('배송지를 아직 못 받았어요')).toBeTruthy()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    const address = await screen.findByRole('group', { name: '배송지' })
    expect(screen.getAllByRole('group', { name: '배송지' })).toHaveLength(1)
    expect(await within(address).findByRole('button', { name: '배송지 적기' })).toBeTruthy()
    expect(above(card, address)).toBe(true)
    expect(above(address, screen.getByRole('group', { name: '금액' }))).toBe(true)
  })

  it('확인서 보내기: [확인서 문자 보내기]가 그 자리에서 사진을 붙여 문자 앱을 열고, 보내면 다음 단계(입금)로 넘어간다', async () => {
    const opened = fakeSms()
    const { w, posts } = world({ address: 'CONFIRMED', sms: { last4: '5678', sentAt: null }, smsReady: true })
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('확인서를 아직 안 보냈어요')).toBeTruthy()
    const send = await within(card).findByRole('button', { name: '확인서 문자 보내기' })
    await waitFor(() => expect(send.getAttribute('aria-busy')).not.toBe('true'))
    fireEvent.click(send)
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0]).toEqual({ phone: '01012345678', text: '[초록가게] 다육맘님 주문 확인서예요.', image: { bytes: jpg, name: 'receipt-2026-10-29.jpg' } })
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/days/2026-10-29/receipt-sms/prepare', '/api/days/2026-10-29/receipt-sms/sent']))
    expect(posts[1]!.body).toMatchObject({ buyer: 'u1' })
    expect(await screen.findByText('확인서 문자를 보냈어요.')).toBeTruthy()
    // 단계를 다시 받아 다음 할 일이 입금으로
    expect(await within(await nextCard()).findByText('입금 기다림')).toBeTruthy()
    expect(within(await nextCard()).getByRole('button', { name: '입금 적기' })).toBeTruthy()
    // 배송지 칸은 품목 아래 제자리
    expect(above(screen.getByRole('group', { name: '품목' }), screen.getByRole('group', { name: '배송지' }))).toBe(true)
  })

  it('확인서 보내기: 서버가 번호를 모른다(NO_PHONE)고 하면 번호를 묻고, 넣은 번호로 문자 앱을 연다', async () => {
    const opened = fakeSms()
    const { w, posts } = world({ address: 'CONFIRMED', smsReady: true })
    open(w)
    const send = await within(await nextCard()).findByRole('button', { name: '확인서 문자 보내기' })
    await waitFor(() => expect(send.getAttribute('aria-busy')).not.toBe('true'))
    fireEvent.click(send)
    const field = await screen.findByLabelText('손님 휴대폰 번호')
    expect(opened).toHaveLength(0)
    fireEvent.change(field, { target: { value: '010-1234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: '문자 앱 열기' }))
    await waitFor(() => expect(opened).toHaveLength(1), { timeout: 3000 })
    expect(opened[0]!.image).toEqual({ bytes: jpg, name: 'receipt-2026-10-29.jpg' })
    expect(posts[1]!.body).toMatchObject({ buyer: 'u1', phone: '010-1234-5678' })
    await waitFor(() => expect(posts.filter((post) => post.path.endsWith('/sent'))).toHaveLength(1))
  })

  it('확인서 보내기: 이 기기에서 문자를 못 보내면 문자 단추 대신 영수증 보내기 화면을 연다', async () => {
    fakeSms([], false)
    const { w } = world({ address: 'CONFIRMED', sms: { last4: '5678', sentAt: null }, smsReady: true })
    const openReceipts = vi.fn()
    open(w, openReceipts)
    const card = await nextCard()
    fireEvent.click(await within(card).findByRole('button', { name: '영수증 보내기 화면 열기' }))
    expect(openReceipts).toHaveBeenCalledOnce()
    expect(within(card).getByText('이 기기에서는 문자를 보낼 수 없어요. 링크 보내기로 보내 주세요.')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: '확인서 문자 보내기' })).toBeNull()
  })

  it('입금 확인: 남은 금액을 말하고 [입금 적기]는 남은 금액이 미리 들어간다. 금액 카드엔 단추가 없고, 금액 고치기 줄엔 입금 적기가 없다', async () => {
    const { w } = world({ address: 'CONFIRMED', sent: true, settlement: { received: 4_000, payment: 'PARTIAL' } })
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('남은 금액 10,000원')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: '금액' })).queryAllByRole('button')).toHaveLength(0)
    const fixes = screen.getByRole('group', { name: '금액 고치기' })
    expect(within(fixes).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['배송비 바꾸기', '할인·추가', '환불 적기'])
    fireEvent.click(within(card).getByRole('button', { name: '입금 적기' }))
    expect((screen.getByLabelText('입금 금액') as HTMLInputElement).value).toBe('10000')
  })

  it('입금 확인: 돌려줄 돈이 있으면 [환불 적기]', async () => {
    const { w } = world({ address: 'CONFIRMED', sent: true, settlement: { received: 20_000, refundDue: 6_000, payment: 'OVERPAID' } })
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('돌려줄 돈 6,000원')).toBeTruthy()
    expect(within(card).getByRole('button', { name: '환불 적기' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: '금액 고치기' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['입금 적기', '배송비 바꾸기', '할인·추가'])
  })

  it('다 끝남: 단추 없이 한 줄, 금액 고치기 줄은 넷 모두', async () => {
    const { w } = world({ address: 'CONFIRMED', sent: true, settlement: { received: 14_000, payment: 'PAID' } })
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('이 손님은 다 끝났어요')).toBeTruthy()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    const fixes = screen.getByRole('group', { name: '금액 고치기' })
    expect(within(fixes).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['입금 적기', '배송비 바꾸기', '할인·추가', '환불 적기'])
    fireEvent.click(within(fixes).getByRole('button', { name: '배송비 바꾸기' }))
    expect(await screen.findByRole('radiogroup', { name: '배송비' })).toBeTruthy()
  })

  it('단계를 모르면(택배·영수증 줄 못 받음) 입금만 본다 — 입금이 끝났어도 "다 끝났어요"를 말하지 않는다', async () => {
    const { w } = world({ settlement: { received: 14_000, payment: 'PAID' } })
    open(w)
    expect(await screen.findByRole('group', { name: '금액 고치기' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: '다음 할 일' })).toBeNull()
    expect(screen.queryByText('이 손님은 다 끝났어요')).toBeNull()
  })

  it('단계를 모르고 입금이 남았으면 입금을 다음 할 일로', async () => {
    const { w } = world()
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('입금 기다림')).toBeTruthy()
    expect(within(card).getByRole('button', { name: '입금 적기' })).toBeTruthy()
  })

  it('30일 지난 날짜는 다음 할 일에 단추 대신 보기만 한다는 안내, 금액 고치기 줄도 없다', async () => {
    const { w } = world({ address: 'CONFIRMED', sent: true, sealed: true })
    open(w)
    const card = await nextCard()
    expect(await within(card).findByText('30일이 지난 날짜라 보기만 할 수 있어요.')).toBeTruthy()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('group', { name: '금액 고치기' })).toBeNull()
    expect(screen.getAllByText('30일이 지난 날짜라 보기만 할 수 있어요.')).toHaveLength(1)
  })
})
