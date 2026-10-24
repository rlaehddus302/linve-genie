// FB1 빠른 입력 가격 단위 한 줄·등록 전 미리 보기 (D-FB1-01, AC-FB1-02·03): 해석은 Enter와 같은 함수 — 미리 보기 가격 = 등록 가격.
import { DEFAULT_SETTINGS, parseQuickInput, type SaleSettings } from '@livejjim/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { Product } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { decideQuickInput, fixPricePreview, quickSettings, registerPreview, unitLine } from '../src/lib/quick.ts'
import { DATE, FakeEventSource, FakeServer, broadcastItem, broadcastView, emptyChanges, flush, fullView, product } from './support.ts'

const THOUSAND = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'THOUSAND' })
const WON = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'WON' })
const none = (): Product | undefined => undefined

describe('lib (AC-FB1-02·03)', () => {
  it('단위 한 줄', () => {
    expect(unitLine('THOUSAND')).toBe('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    expect(unitLine('WON')).toBe('가격 단위: 원 — 10000은 10,000원, 2만은 20,000원')
  })

  it('"등록하면: …" — 품종 있음·없음·만 단위, 있는 번호·번호만·오류면 없음', () => {
    expect(registerPreview('15 엘레강스 10', THOUSAND, none)).toBe('등록하면: 15번 엘레강스 10,000원')
    expect(registerPreview('15 엘레강스 2만', THOUSAND, none)).toBe('등록하면: 15번 엘레강스 20,000원')
    expect(registerPreview('15 10', THOUSAND, none)).toBe('등록하면: 15번 10,000원')
    expect(registerPreview('15 엘레강스 2만', WON, none)).toBe('등록하면: 15번 엘레강스 20,000원')
    expect(registerPreview('15 엘레강스 10000', WON, none)).toBe('등록하면: 15번 엘레강스 10,000원')
    expect(registerPreview('15 엘레강스 10', THOUSAND, () => product(15))).toBeNull()
    expect(registerPreview('15', THOUSAND, none)).toBeNull()
    expect(registerPreview('엘레강스 10', THOUSAND, none)).toBeNull()
    expect(registerPreview('15 엘레강스', THOUSAND, none)).toBeNull()
    expect(registerPreview('', THOUSAND, none)).toBeNull()
  })

  it('미리 보기 가격 = 등록 판단 가격 (무작위 줄, 두 단위) — 표시는 원 표기 정수', () => {
    let seed = 7
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const parts = ['15', '7번', '엘레강스', '핑크 프릴', '10', '2만', '1.5만', '10000', '3천', '0', '1만5천', '999', '<b>x</b>', '']
    for (let i = 0; i < 500; i++) {
      const line = Array.from({ length: 1 + next(4) }, () => parts[next(parts.length)]).join(' ')
      for (const settings of [THOUSAND, WON]) {
        const preview = registerPreview(line, settings, none)
        const decision = decideQuickInput(line, settings, none)
        if (decision.kind !== 'register') {
          expect(preview).toBeNull()
          continue
        }
        expect(Number.isInteger(decision.price)).toBe(true)
        expect(preview).toBe(`등록하면: ${String(decision.no)}번 ${decision.name === '' ? '' : `${decision.name} `}${decision.price.toLocaleString('ko-KR')}원`)
        const parsed = parseQuickInput(line, settings)
        expect('error' in parsed ? null : parsed.price).toBe(decision.price)
      }
    }
  })

  it('고치기 칸 가격 옆 "= …원" (읽지 못하면 없음)', () => {
    expect(fixPricePreview('1.5만', THOUSAND)).toBe('= 15,000원')
    expect(fixPricePreview('10', THOUSAND)).toBe('= 10,000원')
    expect(fixPricePreview('10', WON)).toBe('= 10원')
    expect(fixPricePreview('엘레강스', THOUSAND)).toBeNull()
    expect(fixPricePreview('', THOUSAND)).toBeNull()
  })
})

// ── 콘솔 화면 ──────────────────────────────────────────────────────────

let server: FakeServer
let events: Record<string, unknown>[]
let unit: SaleSettings['price.unit']

beforeEach(() => {
  server = new FakeServer()
  events = []
  unit = 'THOUSAND'
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem()] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 60 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: fullView({ seq: 1, products: [product(7)], broadcasts: [broadcastView({ settings: { ...DEFAULT_SETTINGS, 'price.unit': unit } })] }) }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 1, messages: [], more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/history\\?`), () => ({ body: { date: DATE, rehearsal: false, events: [] } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => ({ body: emptyChanges(Number(match[1]), 1) }))
    .on('POST', /^\/api\/events/, (call) => {
      events.push(call.body ?? {})
      return { body: { date: DATE, rehearsal: false, seq: 2, type: call.body?.type, changed: true, effects: [] } }
    })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openConsole() {
  render(<ConsolePage broadcastId="b1" shopName="구피 가게" onLogout={() => {}} navigate={() => {}} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush()
  return quick
}

describe('콘솔 빠른 입력 (AC-FB1-02·03)', () => {
  it('천원 방송: 단위 한 줄, 치는 동안 "등록하면: …", Enter로 보낸 가격 = 미리 보기 가격', async () => {
    const quick = await openConsole()
    expect(await screen.findByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 10' } })
    expect(screen.getByText('등록하면: 15번 엘레강스 10,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 2만' } })
    expect(screen.getByText('등록하면: 15번 엘레강스 20,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 10' } })
    expect(screen.getByText('등록하면: 15번 10,000원')).toBeDefined()
    // 이미 있는 번호(고칠까요)·번호만이면 없다
    fireEvent.change(quick, { target: { value: '7 엘레강스 10' } })
    expect(screen.queryByText(/^등록하면:/)).toBeNull()
    fireEvent.change(quick, { target: { value: '15' } })
    expect(screen.queryByText(/^등록하면:/)).toBeNull()
    fireEvent.change(quick, { target: { value: '15 엘레강스 2만' } })
    fireEvent.keyDown(quick, { key: 'Enter' })
    await waitFor(() => expect(events.some((event) => event.type === 'product.register')).toBe(true))
    expect(events.find((event) => event.type === 'product.register')).toMatchObject({ no: 15, name: '엘레강스', price: 20000 })
  })

  it('원 방송: 단위 한 줄은 그 방송의 값', async () => {
    unit = 'WON'
    const quick = await openConsole()
    expect(await screen.findByText('가격 단위: 원 — 10000은 10,000원, 2만은 20,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 10000' } })
    expect(screen.getByText('등록하면: 15번 엘레강스 10,000원')).toBeDefined()
  })

  it('품종은 글자로만 (HTML로 읽지 않는다), 고치기 칸 가격 옆 "= 15,000원"', async () => {
    const quick = await openConsole()
    fireEvent.change(quick, { target: { value: '15 <img src=x onerror=alert(1)> 10' } })
    expect(screen.getByText('등록하면: 15번 <img src=x onerror=alert(1)> 10,000원')).toBeDefined()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    fireEvent.change(quick, { target: { value: '15 엘레강스' } })
    fireEvent.keyDown(quick, { key: 'Enter' })
    const fix = await screen.findByRole('group', { name: '고치기 칸' })
    const price = fix.querySelectorAll('input')[2] as HTMLInputElement
    fireEvent.change(price, { target: { value: '1.5만' } })
    expect(screen.getByText('= 15,000원')).toBeDefined()
    fireEvent.change(price, { target: { value: '모름' } })
    expect(screen.queryByText(/^= /)).toBeNull()
  })
})

describe('휴대폰 고정 영역 (UX-04 · TE-FB1-001 · U-FB1-01)', () => {
  it('휴대폰 폭: 단위 한 줄은 고정 영역 밖 바로 아래 — 고정 영역 안에는 "등록하면: …"만', async () => {
    const quick = await openConsole()
    const line = await screen.findByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    const sticky = document.querySelector('.console-sticky')!
    expect(sticky.contains(line)).toBe(false)
    expect(sticky.nextElementSibling).toBe(line)
    expect(screen.getAllByText(/^가격 단위: /)).toHaveLength(1)
    fireEvent.change(quick, { target: { value: '15 엘레강스 10' } })
    expect(sticky.contains(screen.getByText('등록하면: 15번 엘레강스 10,000원'))).toBe(true)
  })

  it('PC 폭: 단위 한 줄은 빠른 입력칸 아래(고정 영역 안) — 한 번만', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    await openConsole()
    const line = await screen.findByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    expect(document.querySelector('.console-sticky')!.contains(line)).toBe(true)
    expect(screen.getAllByText(/^가격 단위: /)).toHaveLength(1)
  })
})
