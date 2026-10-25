// CRM1 손님 기록 화면 (AC-CRM1-11·13~19·21·23·24, D-CRM1-05~D-CRM1-08): 낱말·정렬·거르기·꼬리표·손님 기록 칸·메모·설정 "손님 관리"·콘솔 주의 꼬리표.
// 서버 계약은 harness/sprints/CRM1/dev-notes.md "API" — 가짜 서버가 그 모양으로 답한다.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { Buyer } from '../src/api/types.ts'
import { AllCustomers, forgetCustomerList } from '../src/components/AllCustomers.tsx'
import { BuyersPage } from '../src/components/BuyersPage.tsx'
import { CautionContext, WinnerNames, useConsoleCaution, winnersKey } from '../src/components/caution.tsx'
import { CustomerSettingsSection, customerSettingsBody, settingValue } from '../src/components/CustomerSettings.tsx'
import { SaveBarArea } from '../src/components/SaveBar.tsx'
import { currentSummaryParts, currentSummaryWords } from '../src/lib/current-summary.ts'
import {
  NO_PHONE_MEMO,
  byCumulative,
  customerDate,
  dayLineTags,
  memberLabel,
  memoSavedWords,
  passesFilter,
  summaryLines,
  type CustomerRow,
  type CustomerSummary,
  type DayCustomer,
  type DayCustomersView,
} from '../src/lib/customers.ts'
import type { Route, ScopeRoute } from '../src/lib/router.ts'
import { parseRoute, routePath } from '../src/lib/router.ts'
import type { ScopeData } from '../src/lib/scope-data.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, FakeServer, apiError, flush } from './support.ts'

const SUMMARY_NONE: CustomerSummary = { purchaseDays: 0, purchaseTotal: 0, lastPurchase: null, unpaidDays: 0, lastUnpaid: null, cancels: 0, regular: false, caution: false }

const day = (buyer: string, patch: Partial<CustomerSummary>): DayCustomer => ({ buyer, ...SUMMARY_NONE, ...patch })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  onUnauthorized(null)
  forgetCustomerList()
})

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

// ── 낱말 ──────────────────────────────────────────────────────────────

describe('손님 기록 낱말 (D-CRM1-06, AC-CRM1-15)', () => {
  it('올해면 "10월 15일(목)", 지난해면 연도를 붙인다 — 기준은 서버 today', () => {
    expect(customerDate('2026-10-15', '2026-10-26')).toBe('10월 15일(목)')
    expect(customerDate('2025-12-29', '2026-10-26')).toBe('2025년 12월 29일(월)')
    expect(customerDate('2026-10-22', '2026-01-02')).toBe('10월 22일(목)')
  })

  it('메모 저장 시각은 UTC → KST 날짜 ("10월 26일(월) 저장")', () => {
    expect(memoSavedWords('2026-10-25T15:30:00.000Z', '2026-10-26')).toBe('10월 26일(월) 저장')
    expect(memoSavedWords('2026-10-25T14:59:59.000Z', '2026-10-26')).toBe('10월 25일(일) 저장')
  })

  it('기록 줄: 숫자가 있으면 그대로, 없으면 "아직 입금 완료된 구매 없음"·"미입금 없음"·"취소 0번"', () => {
    const summary: CustomerSummary = { purchaseDays: 3, purchaseTotal: 125_000, lastPurchase: '2026-10-15', unpaidDays: 2, lastUnpaid: '2026-10-22', cancels: 1, regular: true, caution: true }
    expect(summaryLines(summary, '2026-10-26')).toEqual(['누적 구매 125,000원 · 3번', '마지막 구매 10월 15일(목)', '미입금 2번 · 마지막 10월 22일(목)', '취소 1번'])
    expect(summaryLines(SUMMARY_NONE, '2026-10-26')).toEqual(['누적 구매 0원 · 0번', '아직 입금 완료된 구매 없음', '미입금 없음', '취소 0번'])
  })

  it('메모 칸 이름: 플랫폼 손님은 "유튜브 · 다육이맘", 문자 손님은 "문자 · 끝자리 1234"', () => {
    expect(memberLabel({ platform: 'YOUTUBE', kindLabel: '유튜브', name: '다육이맘' })).toBe('유튜브 · 다육이맘')
    expect(memberLabel({ platform: null, kindLabel: '문자 · 끝자리 1234', name: '문자찜(김씨)' })).toBe('문자 · 끝자리 1234')
  })

  it('누적 큰 순 — 같은 금액은 이름 순, 기록 없으면 0원 (AC-CRM1-14 B → C → A → D)', () => {
    const buyer = (id: string, display: string) => ({ id, display }) as unknown as Buyer
    const map = new Map([
      ['A', day('A', { purchaseTotal: 50_000 })],
      ['B', day('B', { purchaseTotal: 120_000, regular: true })],
      ['C', day('C', { purchaseTotal: 50_000 })],
      ['D', day('D', { caution: true })],
    ])
    const list = [buyer('A', '나비'), buyer('D', '라일락'), buyer('B', '다래'), buyer('C', '가람')]
    expect([...list].sort(byCumulative(map)).map((b) => b.id)).toEqual(['B', 'C', 'A', 'D'])
    expect(list.filter((b) => passesFilter(map.get(b.id), 'caution')).map((b) => b.id)).toEqual(['D'])
    expect(list.filter((b) => passesFilter(map.get(b.id), 'regular')).map((b) => b.id)).toEqual(['B'])
    expect(list.filter((b) => passesFilter(map.get(b.id), 'all'))).toHaveLength(4)
    expect(passesFilter(undefined, 'regular')).toBe(false)
  })

  it('요약 줄은 1등 글 바로 뒤에서 나뉘고, 이으면 지금 문장과 같다', () => {
    const input = { no: 15, name: '핑크프릴', status: 'OPEN' as const, winners: '홍길동', waiting: 2 }
    expect(currentSummaryParts(input)).toEqual(['15번 핑크프릴 · 판매 중 · 1등 홍길동', ' · 대기 2명'])
    expect(currentSummaryParts(input).join('')).toBe(currentSummaryWords(input))
  })

  it('주소: "모든 손님" 보기·손님·정렬·거르기가 남고 되읽힌다', () => {
    const route: ScopeRoute = { name: 'buyers', date: DATE, rehearsal: false, view: 'customers', sort: 'recent', filter: 'caution', customer: 'a'.repeat(32) }
    const path = routePath(route)
    expect(path).toContain('view=customers')
    expect(parseRoute('/buyers', path.slice(path.indexOf('?')))).toEqual(route)
    expect(parseRoute('/buyers', '?date=2026-10-19')).toEqual({ name: 'buyers', date: DATE, rehearsal: false })
  })
})

// ── 설정 "손님 관리" ──────────────────────────────────────────────────

describe('설정 "손님 관리" (D-CRM1-05, AC-CRM1-11)', () => {
  it('보낼 값: 숫자(쉼표 허용)는 정수, 아닌 글은 그대로, 금액 칸이 비면 null', () => {
    expect(settingValue('3')).toBe(3)
    expect(settingValue('100,000')).toBe(100_000)
    expect(settingValue('10.5')).toBe('10.5')
    expect(settingValue('')).toBe('')
    expect(customerSettingsBody({ regularCount: '2', regularAmount: '  ', waitDays: '5' })).toEqual({ regularCount: 2, regularAmount: null, waitDays: 5 })
  })

  it('기본값을 보이고, 바꾸면 저장 막대 하나로 PUT — 거절 문장은 칸 아래', async () => {
    const server = new FakeServer()
    let saved = { regularCount: 3, regularAmount: 100_000 as number | null, waitDays: 3 }
    server
      .on('GET', /^\/api\/customer-settings$/, () => ({ body: { settings: saved } }))
      .on('PUT', /^\/api\/customer-settings$/, (call) => {
        const body = call.body ?? {}
        if (body.regularCount === 1) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'regularCount', message: '단골 횟수는 2~99번으로 적어 주세요.' }])
        saved = body as typeof saved
        return { body: { settings: saved } }
      })
    vi.stubGlobal('fetch', server.fetch)
    render(
      <SaveBarArea>
        <section className="settings-section">
          <h2>손님 관리</h2>
          <CustomerSettingsSection />
        </section>
      </SaveBarArea>,
    )
    await flush(5)
    const count = screen.getByLabelText('단골 횟수') as HTMLInputElement
    const amount = screen.getByLabelText('단골 금액') as HTMLInputElement
    const wait = screen.getByLabelText('입금 기다리는 날') as HTMLInputElement
    expect([count.value, amount.value, wait.value]).toEqual(['3', '100,000', '3'])
    expect(screen.getByText('바꾼 칸이 없어요.')).toBeDefined()

    fireEvent.change(count, { target: { value: '1' } })
    expect(screen.getByText('저장하지 않은 칸: 손님 관리')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await flush(5)
    expect(screen.getByText('단골 횟수는 2~99번으로 적어 주세요.')).toBeDefined()
    expect(count.getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(count, { target: { value: '2' } })
    fireEvent.change(amount, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await flush(5)
    expect(server.callsTo('PUT', /customer-settings/).at(-1)?.body).toEqual({ regularCount: 2, regularAmount: null, waitDays: 3 })
    expect(saved).toEqual({ regularCount: 2, regularAmount: null, waitDays: 3 })
    expect(screen.getByText('바꾼 칸이 없어요.')).toBeDefined()
  })
})

// ── 구매자 화면 ──────────────────────────────────────────────────────

const EVENTS = [register(15, '핑크프릴', 10000), register(17, '금황', 5000), register(18, '청보석', 7000), chat('m1', 'UC_hong1234', '홍길동', '15'), chat('m2', 'UC_kim5555', '김철수', '17'), chat('m3', 'UC_lee7777', '이영희', '18')]

interface DayFake {
  customers: readonly DayCustomer[]
  status?: number
}

function Harness({ initial, routes }: { readonly initial: ScopeRoute; readonly routes: Route[] }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'buyers' ? (
    <BuyersPage
      route={route}
      navigate={(next) => {
        routes.push(next)
        setRoute(next)
      }}
    />
  ) : (
    <p>다른 화면</p>
  )
}

async function openBuyers(fake: DayFake, initial: ScopeRoute = { name: 'buyers', date: DATE, rehearsal: false }) {
  const engine = new EngineServer(EVENTS)
  const view = (): DayCustomersView => ({ date: DATE, today: '2026-10-26', settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, customers: fake.customers })
  engine.server.on('GET', new RegExp(`^/api/days/${DATE}/customers$`), () => (fake.status !== undefined ? apiError(fake.status, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.') : { body: view() }))
  vi.stubGlobal('fetch', engine.server.fetch)
  const routes: Route[] = []
  render(<Harness initial={initial} routes={routes} />)
  await flush(10)
  return { engine, routes }
}

const rowsText = () => within(screen.getByRole('list', { name: '구매자' })).getAllByRole('link').map((link) => link.textContent ?? '')

describe('구매자 목록 꼬리표·누적 큰 순·거르기 (AC-CRM1-13·14)', () => {
  it('꼬리표는 글자로("단골"·"입금 늦음 주의"), 누적 큰 순·거르기가 함께 적용된다', async () => {
    await openBuyers({
      customers: [day('UC_hong1234', { purchaseTotal: 50_000, regular: true }), day('UC_kim5555', { purchaseTotal: 120_000, regular: true, caution: true }), day('UC_lee7777', { caution: true })],
    })
    const rows = rowsText()
    expect(rows.find((text) => text.startsWith('홍길동'))).toContain('단골')
    expect(rows.find((text) => text.startsWith('김철수'))).toContain('단골입금 늦음 주의')
    expect(rows.find((text) => text.startsWith('이영희'))).toContain('입금 늦음 주의')
    expect(rows.find((text) => text.startsWith('이영희'))).not.toContain('단골')

    const sortGroup = screen.getByRole('group', { name: '정렬' })
    fireEvent.click(within(sortGroup).getByRole('button', { name: '누적 큰 순' }))
    expect(within(sortGroup).getByRole('button', { name: '누적 큰 순' }).getAttribute('aria-pressed')).toBe('true')
    expect(rowsText().map((text) => text.slice(0, 3))).toEqual(['김철수', '홍길동', '이영희'])

    const filters = screen.getByRole('group', { name: '거르기' })
    fireEvent.click(within(filters).getByRole('button', { name: '입금 늦음 주의만' }))
    expect(rowsText().map((text) => text.slice(0, 3))).toEqual(['김철수', '이영희'])
    fireEvent.click(within(filters).getByRole('button', { name: '단골만' }))
    expect(rowsText().map((text) => text.slice(0, 3))).toEqual(['김철수', '홍길동'])
    fireEvent.click(screen.getByLabelText('찜 없는 구매자도 보기'))
    expect(rowsText().map((text) => text.slice(0, 3))).toEqual(['김철수', '홍길동'])
    fireEvent.click(within(filters).getByRole('button', { name: '모두' }))
    expect(rowsText()).toHaveLength(3)
    // 이름 순·합계 큰 순은 그대로 (그날 합계)
    fireEvent.click(within(sortGroup).getByRole('button', { name: '합계 큰 순' }))
    expect(rowsText()[0]?.startsWith('홍길동')).toBe(true)
  })

  it('손님 기록을 받지 못하면 꼬리표·누적 큰 순 없이 목록은 그대로, 한 줄로 알린다', async () => {
    await openBuyers({ customers: [], status: 500 })
    expect(rowsText()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: '누적 큰 순' })).toBeNull()
    expect(screen.queryByRole('group', { name: '거르기' })).toBeNull()
    expect(screen.getByText('손님 기록을 불러오지 못했어요.')).toBeDefined()
  })

  it('리허설 날짜는 손님 기록을 부르지 않고 꼬리표·정렬·거르기가 없다 (AC-CRM1-06)', async () => {
    const { engine } = await openBuyers({ customers: [day('UC_hong1234', { regular: true })] }, { name: 'buyers', date: DATE, rehearsal: true })
    expect(engine.server.callsTo('GET', /\/customers?(\?|$)/)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '누적 큰 순' })).toBeNull()
    expect(screen.queryByText('단골')).toBeNull()
  })
})

describe('구매자 자세히 "손님 기록" 칸·메모 (AC-CRM1-15·21·23)', () => {
  it('지난 구매 위에 기록 줄·꼬리표·구성원마다 메모 칸, 메모는 글자 그대로(이스케이프), 저장은 바로', async () => {
    const id = 'a'.repeat(32)
    const { engine } = await openBuyers({ customers: [day('UC_hong1234', { purchaseDays: 3, purchaseTotal: 125_000, regular: true })] }, { name: 'buyers', date: DATE, rehearsal: false, buyer: 'UC_hong1234' })
    const memos: string[] = []
    engine.server
      .on('GET', new RegExp(`^/api/days/${DATE}/customer\\?buyer=UC_hong1234$`), () => ({
        body: {
          date: DATE,
          buyer: 'UC_hong1234',
          summary: { purchaseDays: 3, purchaseTotal: 125_000, lastPurchase: '2026-10-15', unpaidDays: 2, lastUnpaid: '2026-10-22', cancels: 1, regular: true, caution: true },
          members: [
            { buyer: 'UC_hong1234', name: '홍길동', platform: 'YOUTUBE', kindLabel: '유튜브', phoneLast4: null, customer: id, memo: { text: '<img src=x onerror=alert(1)>\n둘째 줄', savedAt: '2026-10-25T15:30:00.000Z' } },
            { buyer: 'sms:r1', name: '문자찜', platform: null, kindLabel: '문자 · 끝자리 1234', phoneLast4: '1234', customer: 'b'.repeat(32), memo: null },
            { buyer: 'sms:r2', name: '문자찜(김씨)', platform: null, kindLabel: '문자', phoneLast4: null, customer: null, memo: null },
          ],
        },
      }))
      .on('PUT', /^\/api\/customers\/(a{32}|b{32})\/memo$/, (call) => {
        const text = String(call.body?.text ?? '').trim()
        memos.push(text)
        return { body: { memo: text === '' ? null : { text, savedAt: '2026-10-26T01:00:00.000Z' } } }
      })
    // 자세히를 다시 열어 새 경로로 받게 한다
    fireEvent.click(screen.getByRole('button', { name: '구매자 목록으로' }))
    await flush(3)
    fireEvent.click(within(screen.getByRole('list', { name: '구매자' })).getAllByRole('link').find((link) => link.textContent?.startsWith('홍길동')) as HTMLElement)
    await flush(10)

    const record = screen.getByRole('region', { name: '손님 기록' })
    const past = screen.getByRole('region', { name: '지난 구매' })
    expect(record.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const line of ['누적 구매 125,000원 · 3번', '마지막 구매 10월 15일(목)', '미입금 2번 · 마지막 10월 22일(목)', '취소 1번']) expect(within(record).getByText(line)).toBeDefined()
    expect(within(record).getByText('단골')).toBeDefined()
    expect(within(record).getByText('입금 늦음 주의')).toBeDefined()
    expect(record.textContent).not.toMatch(/PAID|UNPAID|PARTIAL/)

    // 메모: 글자 그대로 (이미지 요소가 생기지 않는다), 저장 날짜
    expect(record.querySelector('img')).toBeNull()
    expect(record.querySelector('.memo-text')?.textContent).toBe('<img src=x onerror=alert(1)>\n둘째 줄')
    expect(within(record).getByText('10월 26일(월) 저장')).toBeDefined()
    expect(within(record).getByRole('heading', { name: '메모 · 유튜브 · 홍길동' })).toBeDefined()
    expect(within(record).getByRole('heading', { name: '메모 · 문자 · 끝자리 1234' })).toBeDefined()
    expect(within(record).getByText(NO_PHONE_MEMO)).toBeDefined()
    expect(within(record).getAllByText(/연락처·주소는 적지 마세요\./)).toHaveLength(2)

    const box = within(record).getByLabelText('메모 — 문자 · 끝자리 1234')
    fireEvent.change(box, { target: { value: '10/8 늦게 입금, 다음엔 선입금 부탁\n둘째 줄' } })
    const before = engine.posts.length
    fireEvent.click(within(record).getByRole('button', { name: '메모 저장 — 문자 · 끝자리 1234' }))
    await flush(5)
    expect(memos).toEqual(['10/8 늦게 입금, 다음엔 선입금 부탁\n둘째 줄'])
    expect(engine.posts.length).toBe(before) // 이벤트가 아니다
    expect(within(record).getByText('메모를 저장했어요.')).toBeDefined()

    // 201글자는 보내지 않고 칸 아래 문장
    fireEvent.change(box, { target: { value: '가'.repeat(201) } })
    expect(within(record).getByText('메모는 200자까지 적을 수 있어요.')).toBeDefined()
    expect((within(record).getByRole('button', { name: '메모 저장 — 문자 · 끝자리 1234' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('리허설 자세히에는 "손님 기록" 칸이 없다', async () => {
    await openBuyers({ customers: [] }, { name: 'buyers', date: DATE, rehearsal: true, buyer: 'UC_hong1234' })
    expect(screen.queryByRole('region', { name: '손님 기록' })).toBeNull()
  })
})

// ── 모든 손님 ────────────────────────────────────────────────────────

const row = (n: number, patch: Partial<CustomerRow> = {}): CustomerRow => ({
  id: n.toString(16).padStart(32, '0'),
  name: `손님${String(n)}`,
  platform: 'YOUTUBE',
  kindLabel: '유튜브',
  phoneLast4: null,
  blocked: false,
  latestDate: '2026-10-22',
  latestBuyer: `UC_${String(n)}`,
  ...SUMMARY_NONE,
  purchaseTotal: 1000 * (30 - n),
  purchaseDays: 1,
  lastPurchase: '2026-10-22',
  ...patch,
})

function CustomersHarness({ initial, routes }: { readonly initial: ScopeRoute; readonly routes: Route[] }) {
  const [route, setRoute] = useState<ScopeRoute>(initial)
  return (
    <AllCustomers
      route={route}
      navigate={(next) => {
        routes.push(next)
        if (next.name === 'buyers' && next.view === 'customers') setRoute(next)
      }}
    />
  )
}

describe('"모든 손님" (AC-CRM1-16·17·24)', () => {
  it('20줄 + 더 보기, 정렬·거르기는 주소로, 줄 → 손님 자세히(날짜 줄·차단 길)', async () => {
    const all = Array.from({ length: 25 }, (_, i) => row(i + 1, i === 0 ? { blocked: true, caution: true, unpaidDays: 1, name: '<b>굵게</b>' } : {}))
    const server = new FakeServer()
    server
      .on('GET', /^\/api\/customers\?/, (call) => {
        const params = new URLSearchParams(call.path.slice(call.path.indexOf('?')))
        const offset = Number(params.get('offset'))
        const page = all.slice(offset, offset + 20)
        const more = offset + 20 < all.length
        return { body: { today: '2026-10-26', settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, customers: page, count: all.length, more, next: more ? offset + 20 : null } }
      })
      .on('GET', new RegExp(`^/api/customers/${all[0]?.id ?? ''}$`), () => ({
        body: {
          today: '2026-10-26',
          customer: all[0],
          memo: null,
          days: [
            { date: '2026-10-26', buyer: 'UC_1', name: '오늘이름', subtotal: 3_000, payment: 'UNPAID', unpaid: false },
            { date: '2026-10-22', buyer: 'UC_1', name: '그날이름', subtotal: 15_000, payment: 'UNPAID', unpaid: true },
            { date: '2025-12-29', buyer: 'UC_1', name: '옛이름', subtotal: 9_000, payment: 'PAID', unpaid: false },
          ],
          more: false,
          next: null,
        },
      }))
    vi.stubGlobal('fetch', server.fetch)
    const routes: Route[] = []
    render(<CustomersHarness initial={{ name: 'buyers', date: DATE, rehearsal: false, view: 'customers' }} routes={routes} />)
    await flush(8)
    const list = () => screen.getByRole('list', { name: '손님' })
    expect(within(list()).getAllByRole('link')).toHaveLength(20)
    const first = within(list()).getAllByRole('link')[0] as HTMLElement
    expect(first.textContent).toContain('<b>굵게</b>')
    expect(first.querySelector('b')).toBeNull()
    expect(first.textContent).toContain('입금 늦음 주의')
    expect(first.textContent).toContain('차단')
    expect(first.textContent).toContain('미입금 1번')
    expect(server.calls[0]?.path).toBe('/api/customers?sort=total&filter=all&offset=0')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (5명 더)' }))
    await flush(5)
    expect(within(list()).getAllByRole('link')).toHaveLength(25)

    fireEvent.click(within(screen.getByRole('group', { name: '정렬' })).getByRole('button', { name: '미입금 많은 순' }))
    await flush(5)
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false, view: 'customers', sort: 'unpaid' })
    expect(server.calls.at(-1)?.path).toBe('/api/customers?sort=unpaid&filter=all&offset=0')

    fireEvent.click(within(list()).getAllByRole('link')[0] as HTMLElement)
    await flush(5)
    expect(routes.at(-1)).toMatchObject({ view: 'customers', customer: all[0]?.id, sort: 'unpaid' })
    const detail = screen.getByRole('region', { name: '손님 자세히' })
    expect(within(detail).queryByRole('button', { name: /차단/ })).toBeNull()
    const path = within(detail).getByRole('link', { name: '가장 최근 날짜(10월 22일)의 구매자 화면에서 차단할 수 있어요' })
    const lines = within(within(detail).getByRole('region', { name: '날짜별 기록' })).getAllByRole('link')
    // 그날 입금 상태 "미입금"과 미입금으로 센 날을 글자로 가른다 (U-CRM1-01)
    expect(lines.map((link) => link.textContent)).toEqual([
      '10월 26일(월)그날 이름 오늘이름상품 합계 3,000원입금 기다리는 중',
      '10월 22일(목)그날 이름 그날이름상품 합계 15,000원미입금으로 셈',
      '2025년 12월 29일(월)그날 이름 옛이름상품 합계 9,000원입금 완료',
    ])
    fireEvent.click(lines[1] as HTMLElement)
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: '2026-10-22', rehearsal: false, buyer: 'UC_1' })
    fireEvent.click(path)
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: '2026-10-22', rehearsal: false, buyer: 'UC_1' })
  })

  it('주소로 바로 연 손님 자세히(목록 기억 없음)도 올해 기준은 응답의 서버 오늘 — 지난해 날짜에 연도 (TE-CRM1-003)', async () => {
    const one = row(1, { lastPurchase: '2025-12-29', latestDate: '2025-12-29' })
    const server = new FakeServer().on('GET', new RegExp(`^/api/customers/${one.id}$`), () => ({
      body: { today: '2026-10-26', customer: one, memo: null, days: [{ date: '2025-12-29', buyer: 'UC_1', name: '옛이름', subtotal: 9_000, payment: 'PAID', unpaid: false }], more: false, next: null },
    }))
    vi.stubGlobal('fetch', server.fetch)
    render(<CustomersHarness initial={{ name: 'buyers', date: DATE, rehearsal: false, view: 'customers', customer: one.id }} routes={[]} />)
    await flush(8)
    const detail = screen.getByRole('region', { name: '손님 자세히' })
    expect(within(detail).getByRole('region', { name: '손님 기록' }).textContent).toContain('마지막 구매 2025년 12월 29일(월)')
    expect(within(within(detail).getByRole('region', { name: '날짜별 기록' })).getByRole('link').textContent).toContain('2025년 12월 29일(월)')
  })

  it('날짜 줄 꼬리표: 센 날은 "미입금으로 셈", 기다리는 날 안은 "입금 기다리는 중" — 같은 글자가 두 뜻으로 쓰이지 않는다 (U-CRM1-01)', () => {
    const words = (payment: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID', unpaid: boolean, subtotal = 5_000) => dayLineTags({ payment, unpaid, subtotal }).map((tag) => tag.text)
    expect(words('UNPAID', true)).toEqual(['미입금으로 셈'])
    expect(words('UNPAID', false)).toEqual(['입금 기다리는 중'])
    expect(words('PARTIAL', true)).toEqual(['부분 입금', '미입금으로 셈'])
    expect(words('PAID', true, 0)).toEqual(['입금 완료', '미입금으로 셈'])
    expect(words('PAID', false)).toEqual(['입금 완료'])
    expect(words('UNPAID', false, 0)).toEqual(['미입금'])
    for (const payment of ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'] as const) for (const unpaid of [true, false]) expect(words(payment, unpaid).filter((text) => text === '미입금')).toEqual([])
  })
})

// ── 콘솔 주의 꼬리표 ──────────────────────────────────────────────────

describe('콘솔 1등 옆 "입금 늦음 주의" (D-CRM1-07, AC-CRM1-18·19)', () => {
  it('주의 손님 이름 뒤에만 작은 꼬리표, 읽기 프로그램엔 "입금 늦음 주의 손님" — 없으면 글자 그대로', () => {
    const names = (id: string) => ({ A: '홍길동', B: '김철수' })[id] ?? id
    const { container, rerender } = render(
      <p>
        1등: <WinnerNames ids={['A', 'B']} nameOf={names} />
      </p>,
    )
    expect(container.textContent).toBe('1등: 홍길동, 김철수')
    rerender(
      <CautionContext.Provider value={(id) => id === 'B'}>
        <p>
          1등: <WinnerNames ids={['A', 'B']} nameOf={names} />
        </p>
      </CautionContext.Provider>,
    )
    expect(container.querySelector('.caution-mark [aria-hidden="true"]')?.textContent).toBe('입금 늦음 주의')
    expect(container.querySelector('.caution-mark .sr-only')?.textContent).toBe('입금 늦음 주의 손님')
    expect(container.querySelector('button')).toBeNull()
  })

  function Probe({ data, rehearsal, onCaution }: { readonly data: ScopeData; readonly rehearsal: boolean; readonly onCaution: (value: boolean) => void }) {
    const caution = useConsoleCaution(data, DATE, rehearsal)
    onCaution(caution('UC_B'))
    return null
  }

  /** 가짜 시계에서 약속(가짜 서버 응답)을 풀어 준다 */
  async function settle() {
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  const scope = (winners: readonly string[]): ScopeData => ({ products: new Map([['b1/15', { winners, variants: [] }]]) }) as unknown as ScopeData

  it('1등이 바뀌면 다시 받되 10초에 한 번까지, 실패하면 꼬리표 없음, 리허설은 부르지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let status = 200
    const server = new FakeServer().on('GET', new RegExp(`^/api/days/${DATE}/customers$`), () =>
      status === 200 ? { body: { date: DATE, today: '2026-10-26', settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, customers: [day('UC_B', { caution: true })] } } : apiError(status, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.'),
    )
    vi.stubGlobal('fetch', server.fetch)
    const seen: boolean[] = []
    const calls = () => server.callsTo('GET', /\/customers$/).length
    const { rerender } = render(<Probe data={scope([])} rehearsal={false} onCaution={(value) => seen.push(value)} />)
    await settle()
    expect(seen.at(-1)).toBe(true)
    expect(calls()).toBe(1)
    expect(winnersKey(scope(['UC_B', 'UC_A']))).toBe('UC_A|UC_B')

    // 연 직후 첫 1등 변화 → 연 때 받은 것은 간격에 세지 않으니 바로 (TE-CRM1-001, "1등이 바뀌면 5초 안에")
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    rerender(<Probe data={scope(['UC_B'])} rehearsal={false} onCaution={(value) => seen.push(value)} />)
    await settle()
    expect(calls()).toBe(2)
    // 그 뒤 또 바뀜 → 10초가 안 지났으니 미뤘다가 한 번
    rerender(<Probe data={scope(['UC_B', 'UC_C'])} rehearsal={false} onCaution={(value) => seen.push(value)} />)
    rerender(<Probe data={scope(['UC_B', 'UC_D'])} rehearsal={false} onCaution={(value) => seen.push(value)} />)
    expect(calls()).toBe(2)
    await act(async () => {
      vi.advanceTimersByTime(9_000)
    })
    await settle()
    expect(calls()).toBe(2)
    status = 500
    await act(async () => {
      vi.advanceTimersByTime(1_100)
    })
    await settle()
    expect(calls()).toBe(3)
    expect(seen.at(-1)).toBe(true) // 실패해도 받은 값 그대로
    // 실패해도 받은 값은 그대로 (오류 띠 없음) — 처음부터 실패면 꼬리표 없음
    cleanup()
    const fresh: boolean[] = []
    render(<Probe data={scope(['UC_B'])} rehearsal={false} onCaution={(value) => fresh.push(value)} />)
    await settle()
    expect(fresh.every((value) => !value)).toBe(true)
    cleanup()
    const before = calls()
    const rehearsalSeen: boolean[] = []
    render(<Probe data={scope(['UC_B'])} rehearsal onCaution={(value) => rehearsalSeen.push(value)} />)
    await settle()
    expect(calls()).toBe(before)
    expect(rehearsalSeen.every((value) => !value)).toBe(true)
  })

  it('방송 자료가 오기 전엔 받지 않고, 자료가 온 뒤 연 때 받은 것은 간격에 세지 않는다 (TE-CRM1-001)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const server = new FakeServer().on('GET', new RegExp(`^/api/days/${DATE}/customers$`), () => ({
      body: { date: DATE, today: '2026-10-26', settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, customers: [day('UC_B', { caution: true })] },
    }))
    vi.stubGlobal('fetch', server.fetch)
    const calls = () => server.callsTo('GET', /\/customers$/).length
    function Late({ data }: { readonly data: ScopeData | null }) {
      useConsoleCaution(data, DATE, false)
      return null
    }
    const { rerender } = render(<Late data={null} />)
    await settle()
    expect(calls()).toBe(0)
    rerender(<Late data={scope([])} />)
    await settle()
    expect(calls()).toBe(1)
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    rerender(<Late data={scope(['UC_B'])} />)
    await settle()
    expect(calls()).toBe(2)
  })
})
