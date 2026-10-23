// PL1A 웹 (AC-PL1A-18·20, D-PL1-04): 30일이 지나 봉인한 날짜의 포장 모드는 볼 수만 — 포장 목록 응답에 `sealed: true`일 때만.
// 봉인 안 한 날짜(응답에 `sealed` 칸이 없음)는 지금 화면 그대로.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { ParcelBrief } from '../src/api/parcel-types.ts'
import type { PackingEntry, PackingItem } from '../src/api/types.ts'
import { PackingPage, SEALED_VIEW_ONLY } from '../src/components/PackingPage.tsx'
import type { Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

const EVENTS = [
  register(15, '핑크프릴', 10000),
  register(28, '청보석', 5000),
  register(41, '사파이어', 3000),
  register(42, '', 4000),
  chat('m1', 'c1', '가나', '15'),
  chat('m2', 'c1', '가나', '28'),
  chat('m3', 'c2', '다라', '41'),
  chat('m4', 'c3', '마바', '42'),
]

const item = (no: number, name: string, price: number, patch: Partial<PackingItem> = {}): PackingItem => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '', no, name, price, id: `p${String(no)}`, ...patch })

const BOOKED: ParcelBrief = {
  state: 'BOOKED',
  carrier: 'FAKE',
  carrierName: '가짜 택배',
  invoice: '900000000001',
  invoiceText: '9000-0000-0001',
  status: '배송 중',
  checkedAt: null,
  trackUrl: null,
  reason: null,
  message: null,
  box: '소',
  qty: 1,
  bookedAt: null,
  cancellable: true,
}

/** 가나(c1): 포장 대기 · 다라(c2): 포장 완료 · 마바(c3): 배송 완료(송장, 택배 접수) */
function entries(): PackingEntry[] {
  return [
    { buyer: 'c1', name: '가나', phoneLast4: null, payment: 'UNPAID', items: [item(15, '핑크프릴', 10000), item(28, '청보석', 5000, { variant: '큰 것', qty: 2 })], status: '포장 대기', invoice: null, add: [], remove: [] },
    { buyer: 'c2', name: '다라', phoneLast4: null, payment: 'UNPAID', items: [item(41, '사파이어', 3000)], status: '포장 완료', invoice: null, add: [], remove: [] },
    { buyer: 'c3', name: '마바', phoneLast4: null, payment: 'UNPAID', items: [item(42, '', 4000)], status: '배송 완료', invoice: '900000000001', add: [], remove: [], parcel: BOOKED },
  ]
}

function PackingHarness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'packing' ? <PackingPage route={route} navigate={setRoute} /> : null
}

async function open({ sealed, buyer, wide = false }: { readonly sealed: boolean; readonly buyer?: string; readonly wide?: boolean }) {
  if (wide) vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  const engine = new EngineServer(EVENTS)
  engine.server
    .on('GET', new RegExp(`^/api/days/${DATE}/packing$`), () => ({ body: { date: DATE, seq: engine.seq, entries: entries(), ...(sealed ? { sealed: true } : {}) } }))
    .on('POST', new RegExp(`^/api/days/${DATE}/packing$`), () => ({ status: 409, body: { error: { code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' } } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\?`), () => ({ body: { date: DATE, buyer: buyer ?? 'c1', data: {}, pages: 1 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.png\\?`), () => ({ body: {} }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.pdf\\?`), () => ({ body: {} }))
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<PackingHarness initial={{ name: 'packing', date: DATE, ...(buyer === undefined ? {} : { buyer }) }} />)
  await flush(15)
  return engine
}

const checklist = () => screen.getByRole('region', { name: '체크리스트' })
/** 체크리스트 안에 없어야 하는 쓰기 버튼 이름 */
const WRITE_BUTTONS = ['포장 완료', '배송 완료', '배송 완료로 적기', '포장 완료 취소', '배송 완료 취소', '송장번호 고치기']

function expectViewOnly(region: HTMLElement) {
  for (const name of WRITE_BUTTONS) expect(within(region).queryAllByRole('button', { name })).toHaveLength(0)
  expect(within(region).queryAllByRole('checkbox')).toHaveLength(0)
  expect(within(region).queryAllByRole('textbox')).toHaveLength(0)
  expect(within(region).queryByRole('group', { name: '포장·배송' })).toBeNull()
  expect(within(region).queryByText(/담음$/)).toBeNull()
}

describe('봉인 날짜의 포장 모드는 볼 수만 (AC-PL1A-18)', () => {
  it('포장 완료 구매자(휴대폰): 안내 문장(늘 보이는 글, 알림 아님)·품목 줄·상태 말은 보이고 체크 칸·포장/배송·취소 버튼은 없다', async () => {
    const engine = await open({ sealed: true, buyer: 'c2' })
    const region = checklist()
    const notice = within(region).getByText(SEALED_VIEW_ONLY)
    expect(notice.textContent).toBe('30일이 지나 봉인한 날짜예요. 볼 수만 있어요.')
    expect(notice.closest('[role="status"],[role="alert"]')).toBeNull()
    expect(notice.getAttribute('data-tone')).toBe('info')
    // 안내는 품목 줄보다 앞
    const firstItem = within(region).getByText('41번')
    expect(notice.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(region).getByText('사파이어')).toBeDefined()
    expect(within(region).getByText('포장 완료').getAttribute('data-tone')).toBe('success')
    expectViewOnly(region)
    // 포장 라벨 칸의 그림 저장·라벨 PDF는 된다
    const label = within(region).getByRole('region', { name: '포장 라벨' })
    expect((within(label).getByRole('button', { name: '그림 저장' }) as HTMLButtonElement).disabled).toBe(false)
    const pdf = within(label).getByRole('button', { name: '라벨 PDF' }) as HTMLButtonElement
    expect(pdf.disabled).toBe(false)
    fireEvent.click(pdf)
    await flush(5)
    expect(engine.server.callsTo('GET', /\/packing-label\.pdf\?/)).toHaveLength(1)
    expect(engine.server.callsTo('POST', /\/packing$/)).toHaveLength(0)
  })

  it('포장 대기 구매자: 품목 줄(번호·품종·옵션 글·수량)은 보이고 "포장 완료"·담음 수·"모두 담으면" 안내는 없다', async () => {
    await open({ sealed: true, buyer: 'c1' })
    const region = checklist()
    expect(within(region).getByText('15번')).toBeDefined()
    expect(within(region).getByText('핑크프릴')).toBeDefined()
    expect(within(region).getByText('큰 것')).toBeDefined()
    expect(within(region).getByText('2개')).toBeDefined()
    expect(within(region).getByText('포장 대기')).toBeDefined()
    expectViewOnly(region)
    expect(within(region).queryByText('모두 담으면 포장 완료를 누를 수 있어요.')).toBeNull()
  })

  it('배송 완료·택배 접수 구매자: 상태 말·택배 줄은 봉인 전과 같고, 택배 잠금 안내(고치려면 접수를 취소하라)는 없다', async () => {
    await open({ sealed: false, buyer: 'c3' })
    const headerBefore = within(checklist()).getByRole('banner').textContent
    expect(within(checklist()).queryByRole('note')).not.toBeNull()
    cleanup()
    await open({ sealed: true, buyer: 'c3' })
    const region = checklist()
    expect(within(region).getByRole('banner').textContent).toBe(headerBefore)
    expect(within(region).getByText('품종 미입력')).toBeDefined()
    expect(within(region).queryByRole('note')).toBeNull()
    expectViewOnly(region)
  })

  it('넓은 화면: 목록 줄은 봉인 전과 같고 체크리스트만 볼 수만 — 걸러 보기 단추는 그대로 쓴다', async () => {
    await open({ sealed: false, buyer: 'c2', wide: true })
    const list = () => screen.getByRole('region', { name: '포장 목록' })
    fireEvent.click(within(list()).getByRole('button', { name: '전체' }))
    const rowsBefore = within(list()).getAllByRole('link').map((row) => row.textContent)
    cleanup()
    await open({ sealed: true, buyer: 'c2', wide: true })
    fireEvent.click(within(list()).getByRole('button', { name: '전체' }))
    expect(within(list()).getAllByRole('link').map((row) => row.textContent)).toEqual(rowsBefore)
    expect(rowsBefore).toHaveLength(3)
    expectViewOnly(checklist())
    expect(within(checklist()).getByText(SEALED_VIEW_ONLY)).toBeDefined()
  })

  it('목록에서 구매자를 열어도 볼 수만 (휴대폰)', async () => {
    await open({ sealed: true })
    expect(screen.queryByText(SEALED_VIEW_ONLY)).toBeNull()
    const list = screen.getByRole('list', { name: '포장할 구매자' })
    fireEvent.click(within(list).getAllByRole('link')[0] as HTMLElement)
    await act(async () => {
      await flush(10)
    })
    expectViewOnly(checklist())
    expect(within(checklist()).getByText(SEALED_VIEW_ONLY)).toBeDefined()
  })
})

describe('봉인 안 한 날짜는 지금 화면 그대로 (AC-PL1A-20)', () => {
  it('응답에 sealed 칸이 없으면 체크 칸·포장 완료·포장 완료 취소·배송 완료로 적기가 있고 봉인 안내는 없다', async () => {
    await open({ sealed: false, buyer: 'c1' })
    const region = checklist()
    expect(within(region).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(region).getByRole('button', { name: '포장 완료' })).toBeDefined()
    expect(within(region).getByText('0/2 담음')).toBeDefined()
    expect(screen.queryByText(SEALED_VIEW_ONLY)).toBeNull()
    cleanup()
    await open({ sealed: false, buyer: 'c2' })
    expect(within(checklist()).getByRole('button', { name: '배송 완료로 적기' })).toBeDefined()
    expect(within(checklist()).getByRole('button', { name: '포장 완료 취소' })).toBeDefined()
  })
})
