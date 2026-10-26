// A1 화면 (CMT-06, D-A1-01·03·06·07, AC-A1-20~24): 확인 필요 줄의 제안·화면을 열 때 AI 제안 받기 한 번·설정의 "AI 제안" 칸·개인정보처리방침 문단.
import { DEFAULT_SETTINGS, getBuyer, listBroadcasts, listProducts, listReviews, type SaleSettings } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { AssistSettings, Product, ReviewSuggestion } from '../src/api/types.ts'
import { AssistSection, useShowAssist } from '../src/components/AssistSection.tsx'
import { PrivacyPage } from '../src/components/PolicyPages.tsx'
import { ReviewsPage, SUGGESTION_SETTLE_MS } from '../src/components/ReviewsPage.tsx'
import { SettingsPage } from '../src/components/SettingsPage.tsx'
import {
  ASSIST_BUSY_RELOAD_MS,
  ASSIST_BUSY_RELOADS,
  ASSIST_CONSENT,
  ASSIST_FAILED,
  ASSIST_LIMIT,
  ASSIST_LIMIT_UNKNOWN,
  ASSIST_NOTICE,
  ASSIST_OFFER,
  ASSIST_READING,
  ASSIST_UNAVAILABLE,
  suggestionView,
} from '../src/lib/assist.ts'
import { chat, iso } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, FakeServer, apiError, flush } from './support.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const
const SHORTS = { name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }
const shorts = (no = 21, name = '반바지') => ({ type: 'product.register', b: 'b1', no, name, price: 15000, options: [SHORTS], stocks: {} })

/** 개발 용어·영어 상태값 (AC-A1-24) */
const DEV_WORDS = /RULE|LIMIT|DONE|FAILED|BUSY|UNAVAILABLE|token|model|Anthropic API|AI 제안 API|assist/

let engine: EngineServer
const texts = new Map<string, string>()
const suggestions = new Map<string, ReviewSuggestion | null>()
let settings: AssistSettings
let suggestReply: () => { status?: number; body?: unknown; network?: boolean } | Promise<{ status?: number; body?: unknown; network?: boolean }>

function serve(events: Record<string, unknown>[]) {
  texts.clear()
  for (const event of events) if (event.type === 'chat') texts.set(String(event.id), String(event.text))
  engine = new EngineServer(events, { settings: OPTIONS })
  engine.server.on('GET', /^\/api\/reviews/, (call) => {
    const url = new URL(call.path, 'http://x')
    const b = url.searchParams.get('broadcast')
    const state = engine.state
    const reviews = listReviews(state)
      .filter((review) => b === null || review.broadcast === b)
      .map((review) => ({
        ...(iso(review) as object),
        date: DATE,
        rehearsal: false,
        broadcastDate: DATE,
        broadcastTitle: '1부',
        buyerName: getBuyer(state, review.currentBuyer)?.display ?? '',
        text: texts.get(review.item) ?? null,
        received: null,
        phoneLast4: null,
        suggestion: suggestions.get(review.item) ?? null,
      }))
    return {
      body: {
        rehearsal: false,
        reviews,
        products: iso(listProducts(state).filter((product) => b === null || product.broadcast === b)),
        broadcasts: iso(listBroadcasts(state).filter((item) => b === null || item.id === b)),
        scopes: [{ date: DATE, rehearsal: false, seq: engine.seq }],
      },
    }
  })
  engine.server.on('GET', /^\/api\/assist\/settings$/, () => ({ body: settings }))
  engine.server.on('POST', /^\/api\/assist\/suggest$/, () => suggestReply())
  vi.stubGlobal('fetch', engine.server.fetch)
}

const suggestCalls = () => engine.server.callsTo('POST', /^\/api\/assist\/suggest$/)
const reviewCalls = () => engine.server.callsTo('GET', /^\/api\/reviews/)

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
  suggestions.clear()
  settings = { available: true, enabled: false, consentedAt: null, usedToday: 0, dailyLimit: 20 }
  suggestReply = () => ({ body: { result: 'OFF', called: 0 } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openReviews() {
  const navigate = vi.fn()
  const utils = render(<ReviewsPage route={{ name: 'reviews', broadcast: 'b1', rehearsal: false }} navigate={navigate} />)
  await screen.findByRole('list', { name: '확인 필요 목록' })
  await flush(10)
  return { ...utils, navigate }
}

describe('제안 글 (suggestionView — 그 방송의 지금 상품으로 다시 맞춰 본다)', () => {
  const product = {
    key: 'b1/21',
    broadcast: 'b1',
    no: 21,
    name: '반바지',
    options: [
      { name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] },
      { name: '색', choices: [{ label: '검정' }] },
    ],
  } as unknown as Product
  const products = new Map([['b1/21', product]])

  it('"제안: 21번 반바지 M 검정 1개" — 옵션은 상품의 항목 순서로, 출처는 쉬운 말', () => {
    const view = suggestionView({ no: 21, options: { 색: '검정', 사이즈: 'M' }, qty: 1, source: 'RULE' }, 'b1', products, 10)
    expect(view?.words).toBe('제안: 21번 반바지 M 검정 1개')
    expect(view?.source).toBe('비슷한 글자로 찾음')
    expect(suggestionView({ no: 21, options: { 색: '검정', 사이즈: 'M' }, qty: 2, source: 'AI' }, 'b1', products, 10)?.source).toBe('AI가 읽음')
  })

  it('어긋나면 보이지 않는다: 없는 상품·다른 방송·없는 선택지·빠진 항목·모르는 항목·수량 범위 밖', () => {
    const base = { no: 21, options: { 사이즈: 'M', 색: '검정' }, qty: 1, source: 'AI' } as const
    expect(suggestionView(null, 'b1', products, 10)).toBeNull()
    expect(suggestionView(undefined, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, no: 22 }, 'b1', products, 10)).toBeNull()
    expect(suggestionView(base, 'b2', products, 10)).toBeNull()
    expect(suggestionView({ ...base, options: { 사이즈: 'XL', 색: '검정' } }, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, options: { 사이즈: 'M' } }, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, options: { 사이즈: 'M', 색: '검정', 무늬: '꽃' } }, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, options: { 사이즈: 'M', __proto__: '검정' } as unknown as Record<string, string> }, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, qty: 0 }, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, qty: 11 }, 'b1', products, 10)).toBeNull()
    expect(suggestionView({ ...base, qty: 1.5 }, 'b1', products, 10)).toBeNull()
  })
})

describe('확인 필요 줄의 제안 (AC-A1-20)', () => {
  const events = () => [shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 미디엄'), chat('m2', 'UC_b', '김철수', '반바지')]

  it('제안이 있는 줄: 고르기 칸 위에 "제안: 21번 반바지 M 1개"·"비슷한 글자로 찾음"·[이대로 주문]·[고치기], 칸은 미리 채우지 않는다. 없는 줄은 그대로', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'RULE' })
    serve(events())
    await openReviews()
    const first = screen.getByRole('listitem', { name: '1번째 줄' })
    const group = within(first).getByRole('group', { name: '1번째 줄 제안' })
    expect(within(group).getByText('제안: 21번 반바지 M 1개')).toBeDefined()
    expect(within(group).getByText('비슷한 글자로 찾음')).toBeDefined()
    expect(within(group).getByRole('button', { name: '1번째 줄 이대로 주문' })).toBeDefined()
    expect(within(group).getByRole('button', { name: '1번째 줄 고치기' })).toBeDefined()
    // 제안은 고르기 칸보다 앞에 (DOM 순서)
    const select = within(first).getByLabelText('사이즈') as HTMLSelectElement
    expect(group.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(select.value).toBe('')
    const second = screen.getByRole('listitem', { name: '2번째 줄' })
    expect(within(second).queryByRole('group', { name: '2번째 줄 제안' })).toBeNull()
    expect(within(second).queryByText(/제안:/)).toBeNull()
    expect(document.body.textContent).not.toMatch(DEV_WORDS)
  })

  it('AI 제안은 "AI가 읽음"', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: 'L' }, qty: 2, source: 'AI' })
    serve(events())
    await openReviews()
    const group = screen.getByRole('group', { name: '1번째 줄 제안' })
    expect(within(group).getByText('제안: 21번 반바지 L 2개')).toBeDefined()
    expect(within(group).getByText('AI가 읽음')).toBeDefined()
  })

  it('[고치기]는 칸만 제안 값으로 — 요청이 나가지 않는다', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 3, source: 'RULE' })
    serve(events())
    await openReviews()
    const row = screen.getByRole('listitem', { name: '1번째 줄' })
    fireEvent.click(within(row).getByRole('button', { name: '1번째 줄 고치기' }))
    expect((within(row).getByLabelText('상품') as HTMLSelectElement).value).toBe('b1/21')
    expect((within(row).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('M')
    expect((within(row).getByLabelText('수량') as HTMLInputElement).value).toBe('3')
    await flush(10)
    expect(engine.posts).toHaveLength(0)
  })

  it('[이대로 주문]은 바로잡기 하나(번호·옵션·수량 = 제안, 출처 없음) — 두 번 눌러도 하나, 누르는 동안 잠김', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'AI' })
    serve(events())
    await openReviews()
    const row = screen.getByRole('listitem', { name: '1번째 줄' })
    const accept = within(row).getByRole('button', { name: '1번째 줄 이대로 주문' })
    fireEvent.click(accept)
    fireEvent.click(accept)
    expect(engine.posts).toHaveLength(0)
    await waitFor(() => expect(engine.posts).toHaveLength(1), { timeout: 3000 })
    expect(engine.posts[0]).toMatchObject({ type: 'host.resolveReview', b: 'b1', item: 'm1', no: 21, qty: 1, options: { 사이즈: 'M' } })
    expect(engine.posts[0]).not.toHaveProperty('source')
    // 결과 끝에 제안 값 (D-A1-14)
    expect(await screen.findByText('홍길동 · 반바지 미디엄 → 21번 반바지 M 1개 — 1등')).toBeDefined()
    await flush(20)
    expect(engine.posts).toHaveLength(1)
  })

  it('품종·옵션 글은 글자로 보인다 (<b>가 태그가 아니다)', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: '<b>M' }, qty: 1, source: 'RULE' })
    serve([{ ...shorts(21, '<b>반바지'), options: [{ name: '사이즈', choices: [{ label: '<b>M' }, { label: 'L' }] }] }, chat('m1', 'UC_a', '홍길동', '<b>반바지')])
    await openReviews()
    const group = screen.getByRole('group', { name: '1번째 줄 제안' })
    expect(within(group).getByText('제안: 21번 <b>반바지 <b>M 1개')).toBeDefined()
    expect(group.querySelector('b')).toBeNull()
  })
})

describe('제안 줄 다듬기 (D-A1-13·14·15)', () => {
  // M의 별칭 "미디움" — "미디엄"은 한 글자 차이라 O2 후보 "혹시: M?"이 뜬다
  const aliased = { ...shorts(21), options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'] }, { label: 'L' }] }] }
  const pickShorts = (row: HTMLElement) => fireEvent.change(within(row).getByLabelText('상품'), { target: { value: 'b1/21' } })

  it('제안과 같은 선택지를 가리키는 "혹시"는 숨기고([고치기] 뒤에도), 다른 선택지 후보·제안 없는 줄은 그대로', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'RULE' })
    suggestions.set('m2', { no: 21, options: { 사이즈: 'L' }, qty: 1, source: 'AI' })
    serve([aliased, chat('m1', 'UC_a', '홍길동', '반바지 미디엄'), chat('m2', 'UC_b', '김철수', '반바지 미디엄'), chat('m3', 'UC_c', '이영희', '반바지 미디엄')])
    await openReviews()
    const [first, second, third] = [1, 2, 3].map((n) => screen.getByRole('listitem', { name: `${String(n)}번째 줄` }))
    if (first === undefined || second === undefined || third === undefined) throw new Error('줄이 셋이어야 한다')
    for (const row of [first, second, third]) pickShorts(row)
    // 제안(M)과 같은 선택지의 "혹시: M?"은 없다 — [고치기] 뒤에도
    expect(within(first).queryByRole('button', { name: '혹시: M?' })).toBeNull()
    fireEvent.click(within(first).getByRole('button', { name: '1번째 줄 고치기' }))
    expect((within(first).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('M')
    expect(within(first).queryByRole('button', { name: '혹시: M?' })).toBeNull()
    // 제안(L)과 다른 선택지의 후보, 제안 없는 줄의 후보는 O2 그대로
    expect(within(second).getByRole('button', { name: '혹시: M?' })).toBeDefined()
    expect(within(third).getByRole('button', { name: '혹시: M?' })).toBeDefined()
  })

  it('[이대로 주문]의 되돌리기 띠 끝에 "→ 21번 반바지 M 1개", 칸으로 고른 "주문으로"는 그대로', async () => {
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'RULE' })
    serve([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 미디엄'), chat('m2', 'UC_b', '김철수', '반바지')])
    await openReviews()
    fireEvent.click(screen.getByRole('button', { name: '1번째 줄 이대로 주문' }))
    const band = screen.getByRole('region', { name: '보내기 전 조치' })
    expect(band.textContent).toContain('홍길동 "반바지 미디엄" 주문으로 → 21번 반바지 M 1개')
    const second = screen.getByRole('listitem', { name: '2번째 줄' })
    fireEvent.change(within(second).getByLabelText('상품'), { target: { value: 'b1/21' } })
    fireEvent.change(within(second).getByLabelText('사이즈'), { target: { value: 'L' } })
    fireEvent.change(within(second).getByLabelText('수량'), { target: { value: '1' } })
    fireEvent.click(within(second).getByRole('button', { name: '2번째 줄 주문으로' }))
    expect(band.textContent).toContain('김철수 "반바지" 주문으로')
    expect(band.textContent).not.toContain('김철수 "반바지" 주문으로 →')
    expect(await screen.findByText('김철수 · 반바지 — 1등', {}, { timeout: 4000 })).toBeDefined()
  })

  it('다시 읽어 새로 생긴 제안 칸의 [이대로 주문]·[고치기]는 0.5초 동안 아무 일도 없다 — 처음부터 있던 제안은 바로 눌린다', async () => {
    settings = { ...settings, enabled: true, consentedAt: '2026-10-23T01:00:00.000Z' }
    let release: () => void = () => undefined
    suggestReply = () =>
      new Promise((resolve) => {
        release = () => resolve({ body: { result: 'DONE', called: 1 } })
      })
    suggestions.set('m2', { no: 21, options: { 사이즈: 'S' }, qty: 1, source: 'RULE' })
    serve([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 미디엄'), chat('m2', 'UC_b', '김철수', '반바지 스몰')])
    await openReviews()
    const first = screen.getByRole('listitem', { name: '1번째 줄' })
    const second = screen.getByRole('listitem', { name: '2번째 줄' })
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 2, source: 'AI' })
    act(() => release())
    await within(first).findByText('AI가 읽음')
    fireEvent.click(within(first).getByRole('button', { name: '1번째 줄 고치기' }))
    fireEvent.click(within(first).getByRole('button', { name: '1번째 줄 이대로 주문' }))
    await flush(5)
    expect((within(first).getByLabelText('수량') as HTMLInputElement).value).toBe('')
    expect((within(first).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('')
    expect(within(first).queryByText(/뒤 보내요/)).toBeNull()
    // 처음부터 있던 규칙 제안은 바로 눌린다
    fireEvent.click(within(second).getByRole('button', { name: '2번째 줄 고치기' }))
    expect((within(second).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('S')
    await new Promise((resolve) => setTimeout(resolve, SUGGESTION_SETTLE_MS + 50))
    fireEvent.click(within(first).getByRole('button', { name: '1번째 줄 고치기' }))
    expect((within(first).getByLabelText('수량') as HTMLInputElement).value).toBe('2')
    fireEvent.click(within(first).getByRole('button', { name: '1번째 줄 이대로 주문' }))
    expect(within(first).getByText(/뒤 보내요/)).toBeDefined()
    expect(engine.posts).toHaveLength(0)
  })
})

describe('화면을 열 때 AI 제안 받기 한 번 (AC-A1-21)', () => {
  const events = () => [shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 엠사이즈')]

  it('켜져 있으면 "AI가 읽는 중이에요…" → 결과 뒤 사라지고 목록을 한 번 다시 읽는다. 실시간 알림으로 다시 읽어도 더 부르지 않는다', async () => {
    settings = { ...settings, enabled: true, consentedAt: '2026-10-23T01:00:00.000Z' }
    let release: () => void = () => undefined
    suggestReply = () =>
      new Promise((resolve) => {
        release = () => resolve({ body: { result: 'DONE', called: 1 } })
      })
    serve(events())
    await openReviews()
    expect(suggestCalls()).toHaveLength(1)
    expect(suggestCalls()[0]?.body).toEqual({ rehearsal: false, broadcast: 'b1' })
    expect(await screen.findByText(ASSIST_READING)).toBeDefined()
    // 목록·조치는 기다리지 않는다
    expect((screen.getByRole('button', { name: '1번째 줄 주문 아님' }) as HTMLButtonElement).disabled).toBe(false)
    const before = reviewCalls().length
    suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'AI' })
    act(() => release())
    await waitFor(() => expect(screen.queryByText(ASSIST_READING)).toBeNull())
    await waitFor(() => expect(reviewCalls().length).toBe(before + 1))
    expect(await screen.findByText('AI가 읽음')).toBeDefined()
    // 실시간 알림(change) → 목록을 다시 읽어도 AI 제안 받기는 그대로 한 번
    const afterResult = reviewCalls().length
    act(() => {
      for (const stream of FakeEventSource.instances) stream.emit('change', { date: DATE, rehearsal: false, seq: engine.seq + 1, type: 'x' })
    })
    await waitFor(() => expect(reviewCalls().length).toBeGreaterThan(afterResult))
    await flush(20)
    expect(suggestCalls()).toHaveLength(1)
    expect(screen.queryByText(ASSIST_FAILED)).toBeNull()
  })

  it('화면을 떠났다 다시 열면 한 번 더', async () => {
    settings = { ...settings, enabled: true }
    suggestReply = () => ({ body: { result: 'DONE', called: 0 } })
    serve(events())
    const first = await openReviews()
    first.unmount()
    await openReviews()
    expect(suggestCalls()).toHaveLength(2)
  })

  it('상한: "오늘 AI 제안을 다 썼어요(하루 20번). 비슷한 글자로 찾은 제안만 보여요."', async () => {
    settings = { ...settings, enabled: true, usedToday: 20 }
    suggestReply = () => ({ body: { result: 'LIMIT', called: 0 } })
    serve(events())
    await openReviews()
    expect(await screen.findByText(ASSIST_LIMIT(20))).toBeDefined()
    expect(ASSIST_LIMIT(20)).toBe('오늘 AI 제안을 다 썼어요(하루 20번). 비슷한 글자로 찾은 제안만 보여요.')
    expect(document.body.textContent).not.toMatch(DEV_WORDS)
  })

  it('상한인데 설정을 읽지 못하면 상한 숫자를 빼고 — "하루 0번"을 보이지 않는다 (D-A1-17)', async () => {
    settings = { ...settings, enabled: true }
    suggestReply = () => ({ body: { result: 'LIMIT', called: 0 } })
    serve(events())
    engine.server.on('GET', /^\/api\/assist\/settings$/, () => apiError(500, 'INTERNAL', '잠시 뒤에 다시 해 주세요.'))
    await openReviews()
    expect(await screen.findByText(ASSIST_LIMIT_UNKNOWN)).toBeDefined()
    expect(ASSIST_LIMIT_UNKNOWN).toBe('오늘 AI 제안을 다 썼어요. 비슷한 글자로 찾은 제안만 보여요.')
    expect(document.body.textContent).not.toContain('하루 0번')
  })

  it('진행 중(BUSY): 곧바로 한 번, 그 뒤 2초마다 목록만 다시 읽는다 — 많아야 8번, AI 제안 받기는 다시 보내지 않는다 (D-A1-16)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      settings = { ...settings, enabled: true }
      suggestReply = () => ({ body: { result: 'BUSY', called: 0 } })
      serve(events())
      await openReviews()
      await waitFor(() => expect(reviewCalls().length).toBe(2))
      // 다른 기기의 요청이 끝나 제안이 붙었다 → 2초 안에 보인다
      suggestions.set('m1', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'AI' })
      await act(() => vi.advanceTimersByTimeAsync(ASSIST_BUSY_RELOAD_MS))
      await waitFor(() => expect(reviewCalls().length).toBe(3))
      expect(await screen.findByText('AI가 읽음')).toBeDefined()
      await act(() => vi.advanceTimersByTimeAsync(ASSIST_BUSY_RELOAD_MS * (ASSIST_BUSY_RELOADS - 1)))
      await waitFor(() => expect(reviewCalls().length).toBe(2 + ASSIST_BUSY_RELOADS))
      await act(() => vi.advanceTimersByTimeAsync(ASSIST_BUSY_RELOAD_MS * 5))
      await flush(10)
      expect(reviewCalls().length).toBe(2 + ASSIST_BUSY_RELOADS)
      expect(suggestCalls()).toHaveLength(1)
      expect(ASSIST_BUSY_RELOAD_MS * ASSIST_BUSY_RELOADS).toBe(16_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('진행 중(BUSY)에 화면을 떠나면 다시 읽기를 그친다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      settings = { ...settings, enabled: true }
      suggestReply = () => ({ body: { result: 'BUSY', called: 0 } })
      serve(events())
      const utils = await openReviews()
      await waitFor(() => expect(reviewCalls().length).toBe(2))
      utils.unmount()
      await act(() => vi.advanceTimersByTimeAsync(ASSIST_BUSY_RELOAD_MS * ASSIST_BUSY_RELOADS))
      expect(reviewCalls().length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('실패(서버가 FAILED·5xx·연결 실패): "AI 제안을 지금 받지 못했어요. 직접 골라 주세요." — 목록은 그대로', async () => {
    settings = { ...settings, enabled: true }
    for (const reply of [{ body: { result: 'FAILED', called: 1 } }, apiError(500, 'INTERNAL', '잠시 뒤에 다시 해 주세요.'), { network: true }]) {
      suggestReply = () => reply
      serve(events())
      const utils = await openReviews()
      expect(await screen.findByText(ASSIST_FAILED)).toBeDefined()
      expect(screen.getByRole('listitem', { name: '1번째 줄' })).toBeDefined()
      expect(document.body.textContent).not.toMatch(DEV_WORDS)
      utils.unmount()
    }
  })

  it('꺼져 있고 쓸 수 있으면 목록 아래 "설정에서 AI 제안을 켤 수 있어요." → 설정의 AI 제안 칸으로', async () => {
    serve(events())
    const { navigate } = await openReviews()
    const link = await screen.findByRole('link', { name: ASSIST_OFFER })
    expect(link.getAttribute('href')).toBe('/settings/assist')
    expect(screen.queryByText(ASSIST_READING)).toBeNull()
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith({ name: 'settings', section: 'assist' })
  })

  it('키 없는 서버(UNAVAILABLE)·진행 중(BUSY)·보조자(403)는 아무 말도 없다', async () => {
    for (const [reply, available] of [
      [{ body: { result: 'UNAVAILABLE', called: 0 } }, false],
      [{ body: { result: 'BUSY', called: 0 } }, true],
      [apiError(403, 'ASSISTANT_FORBIDDEN', '판매자만 할 수 있어요.'), true],
      [{ body: { result: 'OFF', called: 0 } }, false],
    ] as const) {
      settings = { ...settings, available, enabled: false }
      suggestReply = () => reply
      serve(events())
      const utils = await openReviews()
      await flush(20)
      for (const words of [ASSIST_READING, ASSIST_FAILED, ASSIST_OFFER, '오늘 AI 제안을 다 썼어요']) expect(screen.queryByText(words, { exact: false })).toBeNull()
      utils.unmount()
    }
  })
})

describe('설정의 "AI 제안" 칸 (AC-A1-22)', () => {
  let server: FakeServer
  let sale: SaleSettings
  let exists: boolean
  beforeEach(() => {
    sale = { ...DEFAULT_SETTINGS }
    exists = false
    server = new FakeServer()
    server
      .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1', role: 'SELLER', assistant: null } }))
      .on('GET', /^\/api\/settings$/, () => ({ body: { settings: sale } }))
      .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
      .on('GET', /^\/api\/option-broadcasts\/exists$/, () => ({ body: { exists } }))
      .on('GET', /^\/api\/assist\/settings$/, () => ({ body: settings }))
      .on('PUT', /^\/api\/assist\/settings$/, (call) => {
        const body = call.body ?? {}
        if (body.enabled === true && body.consent !== true) return apiError(400, 'CONSENT_REQUIRED', '동의가 필요해요.')
        if (body.enabled === true && !settings.available) return apiError(409, 'UNAVAILABLE', '지금은 쓸 수 없어요.')
        settings = { ...settings, enabled: body.enabled === true, consentedAt: body.enabled === true ? '2026-10-23T01:00:00.000Z' : null }
        return { body: settings }
      })
    vi.stubGlobal('fetch', server.fetch)
  })

  const openSettings = async (props: { section?: 'assist'; assistant?: boolean } = {}) => {
    render(
      <SettingsPage
        route={{ name: 'settings', ...(props.section === undefined ? {} : { section: props.section }) }}
        navigate={vi.fn()}
        shopName="구피 가게"
        onRenamed={vi.fn()}
        assistant={props.assistant ?? false}
      />,
    )
    await screen.findByRole('region', { name: '판매 규칙' })
    await flush(20)
  }

  it('번호로만 받는 판매자(옵션 방송 없음): 칸이 없고 AI 설정을 묻지도 않는다 (CMT-07)', async () => {
    await openSettings()
    expect(screen.queryByRole('region', { name: 'AI 제안' })).toBeNull()
    expect(server.callsTo('GET', /^\/api\/assist\//).map((call) => call.path)).toEqual([])
    expect(document.body.textContent).not.toContain('AI')
  })

  it('판매 방식이 옵션이거나 옵션 방송 기록이 있으면 보인다', async () => {
    sale = { ...DEFAULT_SETTINGS, ...OPTIONS }
    await openSettings()
    expect(await screen.findByRole('region', { name: 'AI 제안' })).toBeDefined()
    cleanup()
    sale = { ...DEFAULT_SETTINGS }
    exists = true
    await openSettings()
    expect(await screen.findByRole('region', { name: 'AI 제안' })).toBeDefined()
  })

  it('꺼짐: 고지 문장·동의 칸·스위치(동의 전엔 잠김) → 동의하고 켜면 consent와 함께, "켜져 있어요 · 오늘 0번 썼어요 (하루 20번까지)"', async () => {
    sale = { ...DEFAULT_SETTINGS, ...OPTIONS }
    await openSettings()
    const region = await screen.findByRole('region', { name: 'AI 제안' })
    expect(within(region).getByText(ASSIST_NOTICE)).toBeDefined()
    // QL2 D-QL2-05 ② — 유튜브 채팅은 보내지 않는다는 문장을 더함
    expect(ASSIST_NOTICE).toBe('확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 유튜브 채팅은 보내지 않아요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.')
    const toggle = within(region).getByRole('switch', { name: 'AI 제안 받기' }) as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    // 보이는 글은 누르면 될 일, 상태는 따로 (D-A1-18)
    expect(toggle.textContent).toBe('켜기')
    expect(within(region).getByText('꺼져 있어요')).toBeDefined()
    expect(region.textContent).not.toContain('꺼짐')
    expect(toggle.disabled).toBe(true)
    fireEvent.click(toggle)
    expect(server.callsTo('PUT', /assist/)).toHaveLength(0)
    fireEvent.click(within(region).getByRole('checkbox', { name: ASSIST_CONSENT }))
    expect(toggle.disabled).toBe(false)
    fireEvent.click(toggle)
    expect(await within(region).findByText('켜져 있어요 · 오늘 0번 썼어요 (하루 20번까지)')).toBeDefined()
    expect(server.callsTo('PUT', /assist/).map((call) => call.body)).toEqual([{ enabled: true, consent: true }])
    expect(region.textContent).not.toMatch(DEV_WORDS)
  })

  it('켜짐: [끄기]는 확인 창 없이 바로, 다시 켤 때 동의를 다시 받는다', async () => {
    sale = { ...DEFAULT_SETTINGS, ...OPTIONS }
    settings = { ...settings, enabled: true, consentedAt: '2026-10-23T01:00:00.000Z', usedToday: 3 }
    await openSettings({ section: 'assist' })
    const region = await screen.findByRole('region', { name: 'AI 제안' })
    expect(await within(region).findByText('켜져 있어요 · 오늘 3번 썼어요 (하루 20번까지)')).toBeDefined()
    fireEvent.click(within(region).getByRole('button', { name: '끄기' }))
    const toggle = (await within(region).findByRole('switch', { name: 'AI 제안 받기' })) as HTMLButtonElement
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.callsTo('PUT', /assist/).map((call) => call.body)).toEqual([{ enabled: false }])
    expect(toggle.disabled).toBe(true)
    expect((within(region).getByRole('checkbox', { name: ASSIST_CONSENT }) as HTMLInputElement).checked).toBe(false)
  })

  it('서버에 키가 없으면 "지금은 쓸 수 없어요."만 (스위치 없음)', async () => {
    sale = { ...DEFAULT_SETTINGS, ...OPTIONS }
    settings = { ...settings, available: false }
    await openSettings()
    const region = await screen.findByRole('region', { name: 'AI 제안' })
    expect(await within(region).findByText(ASSIST_UNAVAILABLE)).toBeDefined()
    expect(within(region).queryByRole('switch')).toBeNull()
    expect(within(region).queryByRole('checkbox')).toBeNull()
  })

  it('보조자에게는 칸이 없다', async () => {
    sale = { ...DEFAULT_SETTINGS, ...OPTIONS }
    function Probe() {
      return <p>{useShowAssist(true, true) ? '보임' : '안 보임'}</p>
    }
    render(<Probe />)
    expect(screen.getByText('안 보임')).toBeDefined()
    cleanup()
    // 서버가 403이면 칸 안의 내용도 없다
    server.on('GET', /^\/api\/assist\/settings$/, () => apiError(403, 'ASSISTANT_FORBIDDEN', '판매자만 할 수 있어요.'))
    const { container } = render(<AssistSection />)
    await flush(10)
    expect(container.textContent).toBe('')
  })
})

describe('개인정보처리방침의 "AI 제안(선택)" (AC-A1-23)', () => {
  it('켠 경우에만·닉네임·전화번호를 뺀 글과 상품 이름·옵션·Anthropic(미국)·따로 저장하지 않음·언제든 끔, 초안 표시 그대로', () => {
    render(<PrivacyPage />)
    const section = screen.getByRole('region', { name: '14. AI 제안(선택)' })
    const text = section.textContent ?? ''
    for (const words of ['켠 경우에만', '닉네임·전화번호를 뺀', '상품 이름·옵션', 'Anthropic(미국)', '따로 저장하지 않아요', '언제든 끌 수 있어요']) expect(text).toContain(words)
    expect(screen.getByText('초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.')).toBeDefined()
    expect(screen.getByRole('region', { name: '15. 시행일' })).toBeDefined()
  })
})
