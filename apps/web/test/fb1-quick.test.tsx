// FB1 빠른 입력 가격 단위 한 줄·등록 전 미리 보기 (D-FB1-01, AC-FB1-02·03): 해석은 Enter와 같은 함수 — 미리 보기 가격 = 등록 가격.
// SRV1 (D-APP-23·24): 읽기 함수는 서버 전용 자리(packages/voice-session/src/read)로 옮겼다 — 기대값은 그대로, 서버 읽기 함수를 본다.
import { DEFAULT_SETTINGS, parseQuickInput, type SaleSettings } from '@livejjim/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { Product } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { unitLine } from '../src/lib/quick.ts'
import { decideQuickInput, fixPricePreview, quickSettings, registerPreview } from '../../../packages/voice-session/src/read/index.ts'
import { DATE, FakeEventSource, FakeServer, broadcastItem, broadcastView, emptyChanges, flush, fullView, product } from './support.ts'

const THOUSAND = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'THOUSAND' })
const WON = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'WON' })
const TEN_THOUSAND = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'TEN_THOUSAND' })
const none = (): Product | undefined => undefined

describe('lib (AC-FB1-02·03)', () => {
  it('단위 한 줄', () => {
    expect(unitLine('THOUSAND')).toBe('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    expect(unitLine('WON')).toBe('가격 단위: 원 — 10000은 10,000원, 2만은 20,000원')
    // SA-FB1-02: 만원 방송이 천원 줄을 보이면 안 된다 (D-FB1-11 (6))
    expect(unitLine('TEN_THOUSAND')).toBe('가격 단위: 만원 — 15는 150,000원, 5천은 5,000원')
  })

  it('만원 방송 미리 보기 (D-FB1-11, AC-FB1-02)', () => {
    expect(registerPreview('15 엘레강스 15', TEN_THOUSAND, none)).toBe('등록하면: 15번 엘레강스 150,000원')
    expect(registerPreview('15 엘레강스 15000', TEN_THOUSAND, none)).toBe('등록하면: 15번 엘레강스 15,000원')
    expect(registerPreview('15 엘레강스 5천', TEN_THOUSAND, none)).toBe('등록하면: 15번 엘레강스 5,000원')
    expect(fixPricePreview('14', TEN_THOUSAND)).toBe('= 140,000원')
    expect(fixPricePreview('1.5만', TEN_THOUSAND)).toBe('= 15,000원')
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

  it('미리 보기 가격 = 등록 판단 가격 (무작위 줄, 세 단위) — 표시는 원 표기 정수', () => {
    let seed = 7
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const parts = ['15', '7번', '엘레강스', '핑크 프릴', '10', '2만', '1.5만', '10000', '3천', '0', '1만5천', '999', '<b>x</b>', '']
    for (let i = 0; i < 500; i++) {
      const line = Array.from({ length: 1 + next(4) }, () => parts[next(parts.length)]).join(' ')
      for (const settings of [THOUSAND, WON, TEN_THOUSAND]) {
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

// SRV1 (D-APP-24, 약속 3): 미리 보기는 서버 읽기 입구의 답(마지막 글자 뒤 150ms)이다 — 옛 기대는 친 즉시(getByText) 보였고, 새 기대는 답이 오면(findByText) 같은 글이다.
// 보이는 글·Enter로 보낸 값의 단언은 그대로. 등록 본문은 친 원문(text)이고 가짜 서버가 서버처럼 읽어 events에 엔진 필드로 남긴다.
describe('콘솔 빠른 입력 (AC-FB1-02·03)', () => {
  it('천원 방송: 단위 한 줄, 치는 동안 "등록하면: …", Enter로 보낸 가격 = 미리 보기 가격', async () => {
    const quick = await openConsole()
    expect(await screen.findByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 10' } })
    expect(await screen.findByText('등록하면: 15번 엘레강스 10,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 2만' } })
    expect(await screen.findByText('등록하면: 15번 엘레강스 20,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 10' } })
    expect(await screen.findByText('등록하면: 15번 10,000원')).toBeDefined()
    // 이미 있는 번호(고칠까요)·번호만이면 없다
    fireEvent.change(quick, { target: { value: '7 엘레강스 10' } })
    expect(screen.queryByText(/^등록하면:/)).toBeNull()
    fireEvent.change(quick, { target: { value: '15' } })
    expect(screen.queryByText(/^등록하면:/)).toBeNull()
    fireEvent.change(quick, { target: { value: '15 엘레강스 2만' } })
    fireEvent.keyDown(quick, { key: 'Enter' })
    await waitFor(() => expect(events.some((event) => event.type === 'product.register')).toBe(true))
    expect(events.find((event) => event.type === 'product.register')).toMatchObject({ no: 15, name: '엘레강스', price: 20000 })
    // 보낸 본문은 친 원문 그대로 (AC-SRV1-04)
    expect(server.callsTo('POST', /^\/api\/events/).map((call) => call.body).find((body) => body?.type === 'product.register')).toMatchObject({ type: 'product.register', b: 'b1', text: '15 엘레강스 2만' })
  })

  it('원 방송: 단위 한 줄은 그 방송의 값', async () => {
    unit = 'WON'
    const quick = await openConsole()
    expect(await screen.findByText('가격 단위: 원 — 10000은 10,000원, 2만은 20,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 10000' } })
    expect(await screen.findByText('등록하면: 15번 엘레강스 10,000원')).toBeDefined()
  })

  it('만원 방송: 단위 한 줄은 만원, "등록하면: … 150,000원", Enter로 보낸 가격 = 150000, 고치기 칸 "= 140,000원"', async () => {
    unit = 'TEN_THOUSAND'
    const quick = await openConsole()
    expect(await screen.findByText('가격 단위: 만원 — 15는 150,000원, 5천은 5,000원')).toBeDefined()
    expect(screen.queryByText(/^가격 단위: 천원/)).toBeNull()
    fireEvent.change(quick, { target: { value: '15 엘레강스 15000' } })
    expect(await screen.findByText('등록하면: 15번 엘레강스 15,000원')).toBeDefined()
    fireEvent.change(quick, { target: { value: '15 엘레강스 15' } })
    expect(await screen.findByText('등록하면: 15번 엘레강스 150,000원')).toBeDefined()
    fireEvent.keyDown(quick, { key: 'Enter' })
    await waitFor(() => expect(events.some((event) => event.type === 'product.register')).toBe(true))
    expect(events.find((event) => event.type === 'product.register')).toMatchObject({ no: 15, name: '엘레강스', price: 150000 })
  })

  it('만원 방송: 고치기 칸 가격 옆 "= 140,000원"', async () => {
    unit = 'TEN_THOUSAND'
    const quick = await openConsole()
    fireEvent.change(quick, { target: { value: '16 엘레강스' } })
    fireEvent.keyDown(quick, { key: 'Enter' })
    const fix = await screen.findByRole('group', { name: '고치기 칸' })
    fireEvent.change(fix.querySelectorAll('input')[2] as HTMLInputElement, { target: { value: '14' } })
    expect(await screen.findByText('= 140,000원')).toBeDefined()
  })

  it('품종은 글자로만 (HTML로 읽지 않는다), 고치기 칸 가격 옆 "= 15,000원"', async () => {
    const quick = await openConsole()
    fireEvent.change(quick, { target: { value: '15 <img src=x onerror=alert(1)> 10' } })
    expect(await screen.findByText('등록하면: 15번 <img src=x onerror=alert(1)> 10,000원')).toBeDefined()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    fireEvent.change(quick, { target: { value: '15 엘레강스' } })
    fireEvent.keyDown(quick, { key: 'Enter' })
    const fix = await screen.findByRole('group', { name: '고치기 칸' })
    const price = fix.querySelectorAll('input')[2] as HTMLInputElement
    fireEvent.change(price, { target: { value: '1.5만' } })
    expect(await screen.findByText('= 15,000원')).toBeDefined()
    fireEvent.change(price, { target: { value: '모름' } })
    expect(screen.queryByText(/^= /)).toBeNull()
  })
})

// FB1 D-FB1-18 (a): "등록하면: …" 줄은 늘 있다(빈 글) — 같은 요소, 한 줄 높이 고정은 CSS(.quick-will-register — E2E가 자리를 잰다)
describe('"등록하면" 줄 자리 고정 (AC-FB1-02 회차 2)', () => {
  it('미리 보기가 없을 때도 role=status 줄이 빈 글로 있고, 쳤다 지워도 같은 요소 — 빠른 입력칸 바로 아래 차례도 그대로', async () => {
    const quick = await openConsole()
    const line = () => document.querySelector('.quick-will-register') as HTMLElement
    const first = line()
    expect(first).not.toBeNull()
    expect(first.getAttribute('role')).toBe('status')
    expect(first.textContent).toBe('')
    const siblings = () => [...(first.parentElement?.children ?? [])].map((element) => element.className)
    const before = siblings()
    fireEvent.change(quick, { target: { value: '15 엘레강스 10' } })
    expect(line()).toBe(first)
    await waitFor(() => expect(first.textContent).toBe('등록하면: 15번 엘레강스 10,000원'))
    expect(siblings()).toEqual(before)
    fireEvent.change(quick, { target: { value: '' } })
    expect(line()).toBe(first)
    expect(first.textContent).toBe('')
    expect(siblings()).toEqual(before)
    // 번호만·있는 번호도 빈 글 (요소는 그대로)
    fireEvent.change(quick, { target: { value: '7 엘레강스 10' } })
    expect(line()).toBe(first)
    expect(first.textContent).toBe('')
  })
})

describe('휴대폰 고정 영역 (UX-04 · TE-FB1-001 · U-FB1-01)', () => {
  // FB1 D-FB1-18 (a): 늘 있는 "등록하면" 줄을 고정 영역에 두면 휴대폰 35%를 넘는다(n2b2 layout 293px > 284px) — 고정 영역 바로 아래, 단위 줄 위로
  it('휴대폰 폭: 고정 영역 바로 아래에 "등록하면: …" 줄(늘 있음), 그 아래 단위 한 줄 — 고정 영역 안에는 둘 다 없다', async () => {
    const quick = await openConsole()
    const line = await screen.findByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    const sticky = document.querySelector('.console-sticky')!
    expect(sticky.contains(line)).toBe(false)
    const register = sticky.nextElementSibling as HTMLElement
    expect(register.className).toBe('quick-will-register')
    expect(register.getAttribute('role')).toBe('status')
    expect(register.textContent).toBe('')
    expect(register.nextElementSibling).toBe(line)
    expect(screen.getAllByText(/^가격 단위: /)).toHaveLength(1)
    expect(document.querySelectorAll('.quick-will-register')).toHaveLength(1)
    fireEvent.change(quick, { target: { value: '15 엘레강스 10' } })
    expect(sticky.nextElementSibling).toBe(register)
    await waitFor(() => expect(register.textContent).toBe('등록하면: 15번 엘레강스 10,000원'))
    expect(sticky.contains(register)).toBe(false)
  })

  it('PC 폭: 단위 한 줄은 빠른 입력칸 아래(고정 영역 안) — 한 번만', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    await openConsole()
    const line = await screen.findByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    expect(document.querySelector('.console-sticky')!.contains(line)).toBe(true)
    expect(screen.getAllByText(/^가격 단위: /)).toHaveLength(1)
    // FB1 D-FB1-18 (a): PC는 "등록하면" 줄도 칸 가까이(고정 영역 안), 하나
    expect(document.querySelectorAll('.quick-will-register')).toHaveLength(1)
    expect(document.querySelector('.console-sticky')!.contains(document.querySelector('.quick-will-register'))).toBe(true)
  })
})
