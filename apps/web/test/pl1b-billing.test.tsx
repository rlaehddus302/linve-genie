// PL1B 간이과세자 증빙 (D-PL1-07, BILLING_RULES v0.1.1 BL-8 1·6·BL-9·BL-10 8, AC-PL1B-05·06·07):
// 사업자 정보 칸에 계좌이체 증빙 고르기가 없고, 저장 본문은 현금영수증, 결제 전 안내·증빙 상태·약관 글이 현금영수증 하나로 맞는다.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { TERMS } from '../src/lib/billing-words.ts'
import { BUSINESS, billingServer, billingStatus, order, type BillingFake } from './billing-support.ts'
import { FakeEventSource, apiError, flush } from './support.ts'

let fake: BillingFake

beforeEach(() => {
  window.sessionStorage.clear()
  fake = billingServer()
  vi.stubGlobal('fetch', fake.server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/billing')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
})

async function openBilling(): Promise<void> {
  render(<App />)
  await screen.findByRole('heading', { name: '이용 상태' })
  await flush(10)
}

const form = () => screen.getByRole('form', { name: '사업자 정보' })

describe('사업자 정보 칸 (AC-PL1B-05)', () => {
  it('고치는 칸: 네 칸만, 라디오 0개, 칸 아래 현금영수증 안내 두 줄 — 저장 본문의 증빙은 현금영수증', async () => {
    fake.status = billingStatus({ business: null })
    fake.server.on('PUT', /^\/api\/billing\/business$/, (call) => {
      const saved = { ...BUSINESS, receiptKind: 'CASH_RECEIPT' as const, email: 'shop@example.com' }
      fake.status = billingStatus({ business: saved })
      return { body: { ...saved, sent: call.body } }
    })
    await openBilling()
    expect(within(form()).queryAllByRole('radio')).toHaveLength(0)
    expect(within(form()).queryByRole('group', { name: '계좌이체 증빙' })).toBeNull()
    for (const label of ['사업자등록번호', '상호', '대표자 이름', '증빙 받을 이메일 (선택)']) expect(within(form()).getByLabelText(label)).toBeTruthy()
    expect(within(form()).getAllByRole('textbox').length + within(form()).queryAllByRole('spinbutton').length).toBe(4)
    expect(within(form()).getByText('계좌이체 증빙: 현금영수증(지출증빙)')).toBeTruthy()
    expect(within(form()).getByText('세금계산서는 지금은 발급할 수 없어요. 카드로 결제하면 카드 매출전표가 증빙이에요.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('세금계산서 받을 이메일')

    fireEvent.change(screen.getByLabelText('사업자등록번호'), { target: { value: '123-45-67891' } })
    fireEvent.change(screen.getByLabelText('상호'), { target: { value: '구피 다육' } })
    fireEvent.change(screen.getByLabelText('대표자 이름'), { target: { value: '김시험' } })
    fireEvent.change(screen.getByLabelText('증빙 받을 이메일 (선택)'), { target: { value: 'shop@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(fake.server.callsTo('PUT', /^\/api\/billing\/business$/)).toHaveLength(1))
    const body = fake.server.callsTo('PUT', /^\/api\/billing\/business$/)[0]?.body as Record<string, unknown>
    expect(body.receiptKind === undefined || body.receiptKind === 'CASH_RECEIPT').toBe(true)
    expect(body.receiptKind).not.toBe('TAX_INVOICE')
    expect(await screen.findByText('123-45-*****')).toBeTruthy()
    expect(document.body.textContent).not.toContain('세금계산서 받을 이메일')
  })

  it('보기 칸: "증빙 받을 이메일"·"계좌이체 증빙 — 현금영수증(지출증빙)" — 옛 저장값(세금계산서)이 와도 같다', async () => {
    // billing-support의 BUSINESS는 옛 값 TAX_INVOICE (지금 서버는 CASH_RECEIPT로 준다 — 화면은 어느 쪽이든 같다)
    for (const receiptKind of ['TAX_INVOICE', 'CASH_RECEIPT'] as const) {
      fake.status = billingStatus({ business: { ...BUSINESS, receiptKind, email: 'shop@example.com' } })
      await openBilling()
      const facts = [...document.querySelectorAll('dl.facts > div')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])
      expect(facts).toContainEqual(['증빙 받을 이메일', 'shop@example.com'])
      expect(facts).toContainEqual(['계좌이체 증빙', '현금영수증(지출증빙)'])
      expect(document.body.textContent).not.toContain('세금계산서 받을 이메일')
      fireEvent.click(screen.getByRole('button', { name: '바꾸기' }))
      expect(within(form()).queryAllByRole('radio')).toHaveLength(0)
      cleanup()
    }
  })

  it('서버가 증빙 종류 칸을 거절하면(422) 그 문장을 칸 아래에 보이고 저장된 것처럼 보이지 않는다', async () => {
    fake.status = billingStatus({ business: null })
    fake.server.on('PUT', /^\/api\/billing\/business$/, () =>
      apiError(422, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'receiptKind', message: '세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요.' }]),
    )
    await openBilling()
    fireEvent.change(screen.getByLabelText('사업자등록번호'), { target: { value: '123-45-67891' } })
    fireEvent.change(screen.getByLabelText('상호'), { target: { value: '구피 다육' } })
    fireEvent.change(screen.getByLabelText('대표자 이름'), { target: { value: '김시험' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await within(form()).findByText('세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요.')).toBeTruthy()
    expect(screen.queryByText('123-45-*****')).toBeNull()
  })
})

describe('결제 전 안내·증빙 상태 (AC-PL1B-06)', () => {
  it('계좌이체를 고르면 "현금영수증(지출증빙)을 발행해요." — 옛 문장은 없다, 요금 표 한 줄 그대로', async () => {
    await openBilling()
    expect(screen.getByText('정액제 30일 · 30,000원 (부가세 포함)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '정액제 30일 사기' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('현금영수증(지출증빙)을 발행해요.')).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: '계좌이체' }))
    expect(within(dialog).getByText('현금영수증(지출증빙)을 발행해요.')).toBeTruthy()
    expect(dialog.textContent).not.toContain('세금계산서(또는 현금영수증)를 발행해요.')
    expect(dialog.textContent).not.toContain('27,273')
    expect(dialog.textContent).not.toContain('2,727')
  })

  it('결제 내역: 새 증빙 "현금영수증 발행됨 · TEST-…", 옛 기록 "세금계산서 발행됨 · …" 그대로 — 공급가액·세액은 어디에도 없다', async () => {
    fake.payments = [
      order({ paymentId: 'p_new', itemName: '정액제 30일', kind: 'FLAT_30D', quantity: null, amount: 30000, method: 'TRANSFER', paidMethod: 'TRANSFER', document: { kind: 'CASH_RECEIPT', status: 'ISSUED', approval: 'TEST-9Z8Y', cancel: null } }),
      order({ paymentId: 'p_old', itemName: '주문 건권 100건', amount: 10000, method: 'TRANSFER', paidMethod: 'TRANSFER', document: { kind: 'TAX_INVOICE', status: 'ISSUED', approval: 'TEST-1A2B', cancel: null } }),
    ]
    await openBilling()
    const list = screen.getByRole('list', { name: '결제 내역' })
    expect(within(list).getByText('현금영수증 발행됨 · TEST-9Z8Y')).toBeTruthy()
    expect(within(list).getByText('세금계산서 발행됨 · TEST-1A2B')).toBeTruthy()
    const text = document.body.textContent ?? ''
    for (const hidden of ['공급가액', '세액', '27,273', '2,727', '9,091', '909원']) expect(text).not.toContain(hidden)
  })
})

describe('약관 초안 화면 (AC-PL1B-07, BL-10 — 문서와 글 맞대기는 pl1b-terms.node.test.ts)', () => {
  it('결제 전 확인 창의 "증빙" 항목이 BL-10 8 글 그대로, 세금계산서를 고르는 말·대괄호 메모가 없다', async () => {
    expect(TERMS).toHaveLength(9)
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '정액제 30일 사기' }))
    const dialog = screen.getByRole('dialog')
    const proof = within(dialog).getAllByRole('listitem').find((item) => item.textContent?.startsWith('증빙'))
    expect(proof?.textContent).toBe('증빙 계좌이체로 결제한 이용권은 현금영수증(지출증빙)을 발행한다. 카드 결제는 카드 매출전표가 증빙이다. 회사는 지금 세금계산서를 발행하지 않는다.')
    expect(dialog.textContent).not.toContain('판매자가 고른')
    expect(dialog.textContent).not.toContain('[')
    expect(dialog.textContent).not.toContain('검토')
  })
})
