// 요금 화면 (N5, AC-N5-50~55·58·59): 메뉴·주소, 이용 상태, 이용권 사기(약관 체크·결제 창·시험 결제 창·서버 확인), 사업자 정보, 결제 내역·7일 환불, 쓴 내역,
// 실시간 요금 알림, 휴대폰 결제 창이 돌아온 주소, 운영 결제 창(가짜 포트원 SDK — 호출 인자), 영어 상태값 없음.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PortOnePaymentRequest } from '../src/lib/portone.ts'
import { BUSINESS, NOW, billingServer, billingStatus, order, type BillingFake } from './billing-support.ts'
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
  delete window.PortOne
  for (const script of document.querySelectorAll('script')) script.remove()
})

async function openBilling(): Promise<HTMLElement> {
  const view = render(<App />)
  await screen.findByRole('heading', { name: '이용 상태' })
  await flush(10)
  return view.container
}

/** PC 폭(48rem 이상)으로 보이게 */
function wideScreen(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

const dialog = () => screen.getByRole('dialog')

describe('메뉴·주소 (AC-N5-50)', () => {
  // 메뉴 순서는 D-NAV-01: 새 메뉴 "요금"은 PC·휴대폰 더보기 목록 모두 "설정" 바로 앞(AC-NAV-09) — N5 합치기(main 066480c)로 "메뉴 끝" 계약을 교체
  it('PC: 요금 기능이 켜져 있으면 "설정" 바로 앞에 "요금"이 있고 /billing이 요금 화면이다', async () => {
    wideScreen()
    await openBilling()
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    const links = within(menu).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '입금 확인', '포장', '라벨', '요금', '택배', '설정'])
    expect(within(menu).getByRole('link', { name: '요금' }).getAttribute('href')).toBe('/billing')
    expect(within(menu).getByRole('link', { name: '요금' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: '요금', level: 1 })).toBeTruthy()
  })

  it('휴대폰: 막대는 다섯 칸 그대로, "요금"은 더보기 목록의 "설정" 바로 앞 — 요금 화면이면 "더보기"와 "요금"이 지금 위치', async () => {
    await openBilling()
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect([...menu.children].filter((el) => el.matches('a, button')).map((cell) => cell.textContent)).toEqual(['방송', '문자찜', '구매자', '정산', '더보기']) // MOB1 D-MOB1-04
    const more = within(menu).getByRole('button', { name: '더보기' })
    expect(more.getAttribute('aria-current')).toBe('page')
    fireEvent.click(more)
    const list = within(menu).getByRole('list')
    expect(within(list).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['입금 확인', '/deposits'],
      ['포장', '/packing'],
      ['라벨', '/labels'],
      ['요금', '/billing'],
      ['택배', '/parcels'],
      ['설정', '/settings'],
    ])
    expect(within(list).getByRole('link', { name: '요금' }).getAttribute('aria-current')).toBe('page')
  })

  it.each([
    ['꺼짐', { enabled: false, testPayment: false }],
    ['설정 항목이 없는 서버', undefined],
  ])('%s: 메뉴에 "요금"이 없고 /billing은 "찾을 수 없는 화면이에요." — 요금 상태를 부르지 않는다', async (_name, config) => {
    fake.config = config as unknown as Record<string, unknown>
    render(<App />)
    expect(await screen.findByRole('heading', { name: '찾을 수 없는 화면이에요.' })).toBeTruthy()
    // 휴대폰(D-NAV-01): 막대 다섯 칸, 더보기 목록에 "요금"이 없다
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect([...menu.children].filter((el) => el.matches('a, button')).map((cell) => cell.textContent)).toEqual(['방송', '문자찜', '구매자', '정산', '더보기']) // MOB1 D-MOB1-04
    fireEvent.click(within(menu).getByRole('button', { name: '더보기' }))
    expect(within(within(menu).getByRole('list')).getAllByRole('link').map((link) => link.textContent)).toEqual(['입금 확인', '포장', '라벨', '택배', '설정'])
    fireEvent.click(within(menu).getByRole('button', { name: '더보기' }))
    fireEvent.click(screen.getByRole('link', { name: '방송 목록으로' }))
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeTruthy()
    expect(fake.server.callsTo('GET', /^\/api\/billing/)).toHaveLength(0)
  })
})

describe('이용 상태 (AC-N5-51)', () => {
  it('네 칸: 정액제·방송 일권(열린 창)·주문 건권(초과는 낱말)·라벨 장권 — 서버 값 그대로', async () => {
    fake.status = billingStatus({
      flat: { active: true, until: '2026-11-19T11:31:00.000Z', endedAt: null, chain: [] },
      balances: { DAYS: 3, ORDERS: -3, LABELS: 100 },
      window: { from: NOW, until: '2026-10-21T11:00:00.000Z' },
      banners: [{ kind: 'ORDERS_OVER', count: 3 }],
    })
    await openBilling()
    const cells = document.querySelectorAll('.billing-cell')
    expect([...cells].map((cell) => cell.textContent)).toEqual([
      '정액제이용 중 · 11/19 20:31까지',
      '방송 일권남은 3일24시간 사용 중 · 10/21 20:00까지',
      '주문 건권초과 3건',
      '라벨 장권남은 100장',
    ])
    expect(cells[2]?.getAttribute('data-tone')).toBe('warning')
    expect(screen.getByText('주문 건권을 3건 넘게 썼어요. 다음에 사는 주문 건권에서 먼저 빠져요.').getAttribute('data-tone')).toBe('warning')
  })

  it('정액 끝남 · 없음', async () => {
    fake.status = billingStatus({ flat: { active: false, until: null, endedAt: '2026-10-19T11:31:00.000Z', chain: [] } })
    await openBilling()
    expect(document.querySelector('.billing-cell')?.textContent).toBe('정액제끝남 (10/19 20:31)')
  })
})

describe('이용권 사기 (AC-N5-52·58)', () => {
  it('요금 표를 종류별로 "이름 · 금액 (부가세 포함)"과 "사기"로', async () => {
    await openBilling()
    expect(screen.getByText('방송 일권 1일 · 5,000원 (부가세 포함)')).toBeTruthy()
    expect(screen.getByRole('button', { name: '방송 일권 1일 사기' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /사기$/ })).toHaveLength(4)
  })

  it('사업자 정보가 없으면 "사기" 대신 안내와 사업자 정보 칸으로 가는 버튼', async () => {
    fake.status = billingStatus({ business: null })
    await openBilling()
    expect(screen.getByText('결제 전에 사업자 정보를 적어 주세요.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /사기$/ })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '사업자 정보 적기' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('사업자등록번호')))
  })

  it('결제 전 확인 창: 처음 포커스 "닫기", 약관 체크 전엔 "결제하기"를 누를 수 없다, 계좌이체 안내, 초과분 안내, 약관 펼쳐 보기', async () => {
    fake.status = billingStatus({ balances: { DAYS: 0, ORDERS: -2, LABELS: 0 } })
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '주문 건권 100건 사기' }))
    expect(within(dialog()).getByRole('heading', { name: '주문 건권 100건 사기' })).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('닫기')
    expect(within(dialog()).getByText('주문 건권 100건 · 10,000원 (부가세 포함)')).toBeTruthy()
    expect((within(dialog()).getByRole('radio', { name: '카드' }) as HTMLInputElement).checked).toBe(true)
    // D-PL1-07: 간이과세자라 계좌이체 증빙은 현금영수증 하나 — 문장을 바꿨다 (전: "세금계산서(또는 현금영수증)를 발행해요.")
    expect(within(dialog()).queryByText('현금영수증(지출증빙)을 발행해요.')).toBeNull()
    fireEvent.click(within(dialog()).getByRole('radio', { name: '계좌이체' }))
    expect(within(dialog()).getByText('현금영수증(지출증빙)을 발행해요.')).toBeTruthy()
    expect(within(dialog()).getByText('지난 초과 2건이 이번 주문 건권에서 먼저 빠져요(이 이용권은 바로 쓴 것이 되어 7일 환불 대상이 아니에요).')).toBeTruthy()
    expect(within(dialog()).getByText('이용권 약관과 환불 규정 펼쳐 보기')).toBeTruthy()
    const pay = within(dialog()).getByRole('button', { name: '결제하기' }) as HTMLButtonElement
    const agree = within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }) as HTMLInputElement
    expect(agree.checked).toBe(false)
    expect(pay.disabled).toBe(true)
    fireEvent.click(agree)
    expect(pay.disabled).toBe(false)
    fireEvent.click(within(dialog()).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fake.server.callsTo('POST', /^\/api\/billing\/orders$/)).toHaveLength(0)
  })

  it('정액 이용 중에 정액제를 사면 이어지는 기간 안내', async () => {
    fake.status = billingStatus({ flat: { active: true, until: '2026-11-19T11:31:00.000Z', endedAt: null, chain: [] } })
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '정액제 30일 사기' }))
    expect(within(dialog()).getByText('남은 기간(11/19 20:31까지) 뒤에 30일이 이어져요.')).toBeTruthy()
  })

  it('시험 결제: 주문 → 시험 결제 창(처음 포커스 "창 닫기") → "결제 완료(카드)" → 서버 확인 → 서버 문장, 이용 상태를 새로 받는다', async () => {
    fake.server
      .on('POST', /^\/api\/billing\/orders$/, () => ({
        body: { paymentId: 'pay_new', orderName: '방송 일권 1일', amount: 5000, currency: 'KRW', method: 'TRANSFER', itemId: 'days-1', kind: 'DAYS', quantity: 1, testPayment: true, storeId: null, channelKey: null },
      }))
      .on('POST', /^\/api\/billing\/test\/payments\/pay_new$/, () => ({ body: { paymentId: 'pay_new', status: 'PAID' } }))
      .on('POST', /^\/api\/billing\/orders\/pay_new\/confirm$/, () => {
        fake.status = billingStatus({ balances: { DAYS: 1, ORDERS: 0, LABELS: 0 }, banners: [] })
        return { body: { paymentId: 'pay_new', result: 'GRANT', state: 'GRANTED', message: '결제했어요. 방송 일권 1일을 받았어요.', itemName: '방송 일권 1일', amount: 5000 } }
      })
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '방송 일권 1일 사기' }))
    fireEvent.click(within(dialog()).getByRole('radio', { name: '계좌이체' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제하기' }))
    expect(await screen.findByRole('heading', { name: '시험 결제 — 실제로 돈이 나가지 않아요' })).toBeTruthy()
    const orderCall = fake.server.callsTo('POST', /^\/api\/billing\/orders$/)[0]
    expect(orderCall?.body).toEqual({ requestId: expect.any(String) as string, itemId: 'days-1', method: 'TRANSFER', agreed: true })
    expect(document.activeElement?.textContent).toBe('창 닫기')
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['창 닫기', '결제 완료(카드)', '결제 완료(계좌이체)', '결제 실패', '금액을 바꿔 결제'])
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제 완료(카드)' }))
    expect(await screen.findByText('결제했어요. 방송 일권 1일을 받았어요.')).toBeTruthy()
    expect(fake.server.callsTo('POST', /^\/api\/billing\/test\/payments\/pay_new$/)[0]?.body).toMatchObject({ action: 'PAID', method: 'CARD' })
    // 확인 요청에는 요청 번호뿐 (금액·상태를 보내지 않는다)
    expect(Object.keys(fake.server.callsTo('POST', /\/confirm$/)[0]?.body ?? {})).toEqual(['requestId'])
    await waitFor(() => expect(document.querySelectorAll('.billing-cell')[1]?.textContent).toBe('방송 일권남은 1일'))
    expect(screen.getByText('결제했어요. 방송 일권 1일을 받았어요.').closest('[data-tone]')?.getAttribute('data-tone')).toBe('success')
  })

  it('"창 닫기"는 가짜 결제 서버를 부르지 않고 확인만 — 결제 대기면 "다시 확인", 조회 실패도 "다시 확인" → 다시 확인하면 부여', async () => {
    let confirms = 0
    fake.server
      .on('POST', /^\/api\/billing\/orders$/, () => ({
        body: { paymentId: 'pay_w', orderName: '라벨 장권 100장', amount: 2000, currency: 'KRW', method: 'CARD', itemId: 'labels-100', kind: 'LABELS', quantity: 100, testPayment: true, storeId: null, channelKey: null },
      }))
      .on('POST', /^\/api\/billing\/orders\/pay_w\/confirm$/, () => {
        confirms += 1
        if (confirms === 1) return { body: { paymentId: 'pay_w', result: 'WAIT', state: 'PENDING', message: "결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.", itemName: '라벨 장권 100장', amount: 2000 } }
        if (confirms === 2) return { body: { paymentId: 'pay_w', result: 'LOOKUP_FAILED', state: 'PENDING', message: "결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요.", itemName: '라벨 장권 100장', amount: 2000 } }
        return { body: { paymentId: 'pay_w', result: 'GRANT', state: 'GRANTED', message: '결제했어요. 라벨 장권 100장을 받았어요.', itemName: '라벨 장권 100장', amount: 2000 } }
      })
    fake.payments = [order({ paymentId: 'pay_w', itemName: '라벨 장권 100장', amount: 2000, state: 'PENDING', createdAt: NOW, grantedAt: null })]
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '라벨 장권 100장 사기' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제하기' }))
    fireEvent.click(await screen.findByRole('button', { name: '창 닫기' }))
    expect(await screen.findByText("결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.")).toBeTruthy()
    expect(fake.server.callsTo('POST', /^\/api\/billing\/test\//)).toHaveLength(0)
    // "다시 확인"은 한 곳에만 (결과 문장 옆 — 목록의 같은 주문에는 두지 않는다)
    await flush(5)
    expect(screen.getAllByRole('button', { name: /다시 확인/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(await screen.findByText("결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요.")).toBeTruthy()
    expect(screen.getByText("결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요.").closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning')
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(await screen.findByText('결제했어요. 라벨 장권 100장을 받았어요.')).toBeTruthy()
    expect(confirms).toBe(3)
  })

  it('웹훅·다른 기기로 결제 대기 주문이 부여되면(요금 알림) 결과 문장도 바뀐다', async () => {
    fake.server
      .on('POST', /^\/api\/billing\/orders$/, () => ({
        body: { paymentId: 'pay_h', orderName: '방송 일권 1일', amount: 5000, currency: 'KRW', method: 'CARD', itemId: 'days-1', kind: 'DAYS', quantity: 1, testPayment: true, storeId: null, channelKey: null },
      }))
      .on('POST', /^\/api\/billing\/orders\/pay_h\/confirm$/, () => ({
        body: { paymentId: 'pay_h', result: 'WAIT', state: 'PENDING', message: "결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.", itemName: '방송 일권 1일', amount: 5000 },
      }))
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '방송 일권 1일 사기' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제하기' }))
    fireEvent.click(await screen.findByRole('button', { name: '창 닫기' }))
    expect(await screen.findByText("결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.")).toBeTruthy()
    fake.payments = [order({ paymentId: 'pay_h', state: 'GRANTED' })]
    FakeEventSource.last.emit('billing', { reason: 'grant' })
    expect(await screen.findByText('결제했어요. 방송 일권 1일을 받았어요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다시 확인' })).toBeNull()
  })

  it('주문을 만들지 못하면 서버 문장을 창 안에', async () => {
    fake.server.on('POST', /^\/api\/billing\/orders$/, () => apiError(409, 'ITEM_UNAVAILABLE', '지금 살 수 없는 이용권이에요.'))
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '정액제 30일 사기' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제하기' }))
    expect(await within(dialog()).findByText('지금 살 수 없는 이용권이에요.')).toBeTruthy()
  })
})

describe('운영 결제 창 (AC-N5-52 — 가짜 포트원 SDK)', () => {
  const productionOrder = {
    paymentId: 'pay_live_1',
    orderName: '방송 일권 1일',
    amount: 5000,
    currency: 'KRW',
    method: 'TRANSFER',
    itemId: 'days-1',
    kind: 'DAYS',
    quantity: 1,
    testPayment: false,
    storeId: 'store-abc',
    channelKey: 'channel-key-xyz',
  }

  beforeEach(() => {
    fake.config = { enabled: true, testPayment: false, storeId: 'store-abc', channelKey: 'channel-key-xyz' }
    fake.status = billingStatus({ testPayment: false })
    fake.server.on('POST', /^\/api\/billing\/orders$/, () => ({ body: productionOrder }))
  })

  it('요금 화면을 열기만 해서는 외부 스크립트를 부르지 않는다', async () => {
    await openBilling()
    expect(document.querySelectorAll('script[src]')).toHaveLength(0)
  })

  it('"결제하기"에서만 SDK를 부르고 서버 주문 값·공개 값으로 결제 창을 연다 → 창이 실패를 돌려줘도 서버 확인 결과만 보인다', async () => {
    const requests: PortOnePaymentRequest[] = []
    fake.server.on('POST', /^\/api\/billing\/orders\/pay_live_1\/confirm$/, () => ({
      body: { paymentId: 'pay_live_1', result: 'GRANT', state: 'GRANTED', message: '결제했어요. 방송 일권 1일을 받았어요.', itemName: '방송 일권 1일', amount: 5000 },
    }))
    await openBilling()
    window.PortOne = {
      requestPayment: (request) => {
        requests.push(request)
        // 결제 창이 실패라고 돌려줘도 화면은 믿지 않는다
        return Promise.resolve({ code: 'FAILURE_TYPE_PG', message: 'x' })
      },
    }
    fireEvent.click(screen.getByRole('button', { name: '방송 일권 1일 사기' }))
    fireEvent.click(within(dialog()).getByRole('radio', { name: '계좌이체' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }))
    expect(requests).toHaveLength(0)
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제하기' }))
    expect(await screen.findByText('결제했어요. 방송 일권 1일을 받았어요.')).toBeTruthy()
    expect(requests).toEqual([
      {
        storeId: 'store-abc',
        channelKey: 'channel-key-xyz',
        paymentId: 'pay_live_1',
        orderName: '방송 일권 1일',
        totalAmount: 5000,
        currency: 'CURRENCY_KRW',
        payMethod: 'TRANSFER',
        redirectUrl: `${window.location.origin}/billing`,
      },
    ])
    expect(screen.queryByRole('heading', { name: '시험 결제 — 실제로 돈이 나가지 않아요' })).toBeNull()
    expect(fake.server.callsTo('POST', /^\/api\/billing\/test\//)).toHaveLength(0)
  })

  it('SDK를 불러오지 못하면 결제 창을 열지 못했다고 알리고 확인을 요청하지 않는다', async () => {
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '방송 일권 1일 사기' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '결제하기' }))
    // jsdom은 외부 스크립트를 받지 않는다 — 붙인 스크립트에 실패를 알린다
    const script = await waitFor(() => {
      const found = document.querySelector<HTMLScriptElement>('script[src="https://cdn.portone.io/v2/browser-sdk.js"]')
      if (found === null) throw new Error('스크립트가 아직 없다')
      return found
    })
    script.dispatchEvent(new Event('error'))
    expect(await screen.findByText('결제 창을 열지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')).toBeTruthy()
    expect(fake.server.callsTo('POST', /\/confirm$/)).toHaveLength(0)
  })
})

describe('휴대폰 결제 창이 돌아온 주소 (AC-N5-52)', () => {
  it('/billing?paymentId=…의 결제 ID로 확인하고 주소에서 지운다 (쿼리의 다른 값은 쓰지 않는다)', async () => {
    window.history.replaceState(null, '', '/billing?paymentId=pay_m1&code=FAILURE&message=x')
    fake.server.on('POST', /^\/api\/billing\/orders\/pay_m1\/confirm$/, () => ({
      body: { paymentId: 'pay_m1', result: 'GRANT', state: 'GRANTED', message: '결제했어요. 정액제 30일을 받았어요.', itemName: '정액제 30일', amount: 30000 },
    }))
    render(<App />)
    expect(await screen.findByText('결제했어요. 정액제 30일을 받았어요.')).toBeTruthy()
    expect(window.location.pathname + window.location.search).toBe('/billing')
    expect(fake.server.callsTo('POST', /\/confirm$/)).toHaveLength(1)
    expect(fake.server.callsTo('POST', /\/confirm$/)[0]?.body).toEqual({ requestId: expect.any(String) as string })
  })
})

describe('사업자 정보 (AC-N5-53)', () => {
  it('칸·숫자 키패드, 서버 오류 문장은 그 칸 아래, 저장하면 가린 번호 — "바꾸기"는 번호 칸이 비어 있다', async () => {
    fake.status = billingStatus({ business: null })
    let attempts = 0
    fake.server.on('PUT', /^\/api\/billing\/business$/, (call) => {
      attempts += 1
      if (attempts === 1) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'businessNumber', message: '사업자등록번호를 다시 확인해 주세요.' }])
      expect(call.body).toEqual({ requestId: expect.any(String) as string, businessNumber: '123-45-67891', name: '구피 다육', ceo: '김시험', email: '', receiptKind: 'CASH_RECEIPT' })
      fake.status = billingStatus({ business: { ...BUSINESS, receiptKind: 'CASH_RECEIPT' } })
      return { body: { ...BUSINESS, receiptKind: 'CASH_RECEIPT' } }
    })
    await openBilling()
    const number = screen.getByLabelText('사업자등록번호') as HTMLInputElement
    expect(number.inputMode).toBe('numeric')
    fireEvent.change(number, { target: { value: '1234567890' } })
    fireEvent.change(screen.getByLabelText('상호'), { target: { value: '구피 다육' } })
    fireEvent.change(screen.getByLabelText('대표자 이름'), { target: { value: '김시험' } })
    // D-PL1-07: 계좌이체 증빙 고르기(라디오)가 없어졌다 — 늘 현금영수증(지출증빙) (전: 라디오 "현금영수증(지출증빙)"을 눌렀다)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('사업자등록번호를 다시 확인해 주세요.')).toBeTruthy()
    expect(number.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(number, { target: { value: '123-45-67891' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('123-45-*****')).toBeTruthy()
    expect(screen.getByText('현금영수증(지출증빙)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '바꾸기' }))
    expect((screen.getByLabelText('사업자등록번호') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('상호') as HTMLInputElement).value).toBe('구피 다육')
  })
})

describe('결제 내역·7일 환불 (AC-N5-54)', () => {
  it('결제마다 시각·항목·금액·수단·상태 낱말·증빙, 운영자가 준 이용권, 하루 넘은 결제 대기는 접힌다 (휴대폰 카드)', async () => {
    fake.payments = [
      order({ paymentId: 'p_t', itemName: '주문 건권 100건', amount: 10000, method: 'TRANSFER', paidMethod: 'TRANSFER', document: { kind: 'TAX_INVOICE', status: 'ISSUED', approval: 'TEST-1A2B', cancel: null } }),
      order({ paymentId: 'p_m', state: 'MISMATCH_CANCELLED' }),
      { type: 'operator', grantId: 'g1', kind: 'DAYS', quantity: 5, reason: '기존 판매자 보상', at: '2026-10-19T11:00:00.000Z', revoked: false },
      order({ paymentId: 'p_old', state: 'PENDING', createdAt: '2026-10-18T11:00:00.000Z', grantedAt: null }),
    ]
    await openBilling()
    const list = screen.getByRole('list', { name: '결제 내역' })
    const cards = within(list).getAllByRole('listitem').map((item) => item.textContent)
    expect(cards).toEqual([
      '주문 건권 100건 · 10,000원 · 계좌이체10/20 19:50결제 완료세금계산서 발행됨 · TEST-1A2B',
      '방송 일권 1일 · 5,000원 · 카드10/20 19:50금액이 달라 취소함',
      '방송 일권 5일10/19 20:00운영자가 준 이용권 · 기존 판매자 보상',
    ])
    expect(screen.getByText('금액이 달라 취소함').getAttribute('data-tone')).toBe('danger')
    expect(screen.getByText('하루 넘게 결제 대기인 주문 1건 보기')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: '하루 넘게 결제 대기인 주문' })).getByRole('button', { name: '방송 일권 1일 다시 확인' })).toBeTruthy()
  })

  it('PC 폭이면 열 머리가 있는 표', async () => {
    wideScreen()
    fake.payments = [order({ refundable: true })]
    fake.usage = [{ id: 1, kind: 'DAYS', at: NOW, broadcast: { id: 'b1', title: '1부', date: '2026-10-20' }, productNo: null, productName: null, windowUntil: '2026-10-21T11:00:00.000Z' }]
    await openBilling()
    const table = screen.getByRole('table', { name: '결제 내역' })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['시각', '항목', '금액', '수단', '상태', '증빙', '할 일'])
    expect(within(table).getByRole('button', { name: '방송 일권 1일 환불' })).toBeTruthy()
    const usage = screen.getByRole('table', { name: '쓴 내역' })
    expect(within(usage).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['시각', '쓴 것', '방송', '상품', '24시간 창'])
    expect(within(usage).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['10/20 20:00', '방송 일권 1일', '1부(10/20)', '', '10/21 20:00까지'])
  })

  it('서버가 환불할 수 있다고 한 결제에만 "환불" → 확인 창(처음 포커스 "닫기", 두 번째 "환불") → 서버 문장', async () => {
    fake.payments = [order({ paymentId: 'p_ok', refundable: true }), order({ paymentId: 'p_used', itemName: '주문 건권 100건', amount: 10000, refundable: false })]
    fake.server.on('POST', /^\/api\/billing\/orders\/p_ok\/refund$/, (call) => {
      expect(Object.keys(call.body ?? {})).toEqual(['requestId'])
      fake.payments = [order({ paymentId: 'p_ok', state: 'REFUNDED' }), fake.payments[1] as ReturnType<typeof order>]
      return { body: { paymentId: 'p_ok', state: 'REFUNDED', message: '환불했어요. 결제 수단으로 돌려드려요.' } }
    })
    await openBilling()
    expect(screen.getAllByRole('button', { name: /환불$/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '방송 일권 1일 환불' }))
    expect(within(dialog()).getByText("'방송 일권 1일' 결제(5,000원)를 취소하고 이용권을 거둬요. 되돌릴 수 없어요.")).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('닫기')
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['닫기', '환불'])
    fireEvent.click(within(dialog()).getByRole('button', { name: '환불' }))
    expect(await screen.findByText('환불했어요. 결제 수단으로 돌려드려요.')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('환불함').getAttribute('data-tone')).toBe('success'))
    expect(screen.queryAllByRole('button', { name: /환불$/ })).toHaveLength(0)
  })

  it('환불이 거절되면 서버 문장', async () => {
    fake.payments = [order({ paymentId: 'p_ok', refundable: true })]
    fake.server.on('POST', /\/refund$/, () => apiError(409, 'REFUND_NOT_ALLOWED', '이 이용권은 환불할 수 없어요. 결제한 지 7일이 지났거나 이미 쓰기 시작했어요.'))
    await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '방송 일권 1일 환불' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '환불' }))
    expect(await screen.findByText('이 이용권은 환불할 수 없어요. 결제한 지 7일이 지났거나 이미 쓰기 시작했어요.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('쓴 내역 (AC-N5-55)', () => {
  it('최근 것 먼저 한 줄씩, "더 보기"로 이어 받는다', async () => {
    fake.usage = [
      { id: 3, kind: 'LABELS', at: '2026-10-20T11:06:00.000Z', broadcast: { id: 'b1', title: '1부', date: '2026-10-20' }, productNo: 15, productName: null, windowUntil: null },
      { id: 2, kind: 'ORDERS', at: '2026-10-20T11:05:00.000Z', broadcast: { id: 'b1', title: '1부', date: '2026-10-20' }, productNo: 15, productName: '핑크프릴', windowUntil: null },
    ]
    fake.server.on('GET', /^\/api\/billing\/usage\?limit=50$/, () => ({ body: { items: fake.usage, next: 'c1' } }))
    fake.server.on('GET', /^\/api\/billing\/usage\?limit=50&cursor=c1$/, () => ({
      body: { items: [{ id: 1, kind: 'DAYS', at: '2026-10-20T11:00:00.000Z', broadcast: { id: 'b1', title: '1부', date: '2026-10-20' }, productNo: null, productName: null, windowUntil: '2026-10-21T11:00:00.000Z' }], next: null },
    }))
    await openBilling()
    const list = () => within(screen.getByRole('list', { name: '쓴 내역' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(list()).toEqual(['10/20 20:06 · 라벨 1장 · 1부 15번', '10/20 20:05 · 주문 1건 · 1부 15번 핑크프릴'])
    fireEvent.click(screen.getByRole('button', { name: '쓴 내역 더 보기' }))
    await waitFor(() => expect(list()).toHaveLength(3))
    expect(list()[2]).toBe('10/20 20:00 · 방송 일권 1일 · 1부(10/20) · 10/21 20:00까지')
    expect(screen.queryByRole('button', { name: '쓴 내역 더 보기' })).toBeNull()
  })
})

describe('실시간·낱말 (AC-N5-13·59)', () => {
  it('요금 알림이 오면 요금 상태·내역을 새로 받는다', async () => {
    await openBilling()
    const before = fake.server.callsTo('GET', /^\/api\/billing$/).length
    fake.status = billingStatus({ balances: { DAYS: 10, ORDERS: 0, LABELS: 0 }, banners: [] })
    FakeEventSource.last.emit('billing', { reason: 'grant' })
    await waitFor(() => expect(document.querySelectorAll('.billing-cell')[1]?.textContent).toBe('방송 일권남은 10일'))
    expect(fake.server.callsTo('GET', /^\/api\/billing$/).length).toBeGreaterThan(before)
    expect(fake.server.callsTo('GET', /^\/api\/billing\/payments/).length).toBeGreaterThan(1)
  })

  it('보이는 글자·속성에 영어 상태값(개발 용어)이 없다 — 승인 번호(TEST-…)만 예외', async () => {
    fake.status = billingStatus({ banners: [{ kind: 'NO_PASS' }, { kind: 'LABELS_OVER', count: 2 }], balances: { DAYS: 0, ORDERS: 0, LABELS: -2 } })
    fake.payments = [
      order({ state: 'PENDING', grantedAt: null }),
      order({ paymentId: 'p2', state: 'NEEDS_REVIEW', method: 'TRANSFER', document: { kind: 'CASH_RECEIPT', status: 'PENDING', approval: null, cancel: null } }),
      { type: 'operator', grantId: 'g1', kind: 'FLAT_30D', quantity: null, reason: '보상', at: NOW, revoked: true },
    ]
    const container = await openBilling()
    fireEvent.click(screen.getByRole('button', { name: '라벨 장권 100장 사기' }))
    const found: string[] = []
    for (const element of [container, ...document.querySelectorAll('[role=dialog]')]) {
      const text = element.textContent ?? ''
      if (/[A-Za-z]/.test(text)) found.push(text)
      for (const child of element.querySelectorAll('*')) {
        for (const name of ['aria-label', 'title', 'alt', 'placeholder', 'value']) {
          const value = child.getAttribute(name) ?? ''
          if (/[A-Za-z]/.test(value)) found.push(`${name}=${value}`)
        }
      }
    }
    expect(found).toEqual([])
  })
})
