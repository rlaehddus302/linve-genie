// PL1B 시작 마법사 4/5 "라벨을 쓰지 않아요" (UX-02·RCP-01·L-13 1·2, D-PL1-06, AC-PL1B-16~18): 앱 전체를 그린다.
// 라벨 켜짐이면 연결 칸 아래 보통 버튼과 안내 한 줄, 모르면·꺼짐이면 버튼 없음. 누르면 확인 창 없이 끄기 요청 하나(보내는 동안 이 버튼·"다음" 잠김),
// 성공하면 5/5(제목 포커스·서버 단계 5)·메뉴 "라벨" 사라짐·"이전"은 3/5. 실패하면 4/5에 머물고 문장, 라벨은 켜진 그대로, 다시 누를 수 있다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import type { WizardState } from '../src/api/types.ts'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { LABELS_OFF_DONE } from '../src/components/WizardPage.tsx'
import { NO_LABELS_ACTION } from '../src/components/wizard/PrinterStep.tsx'
import { overview, queue, templates } from './print-support.ts'
import { FakeEventSource, FakeServer, apiError, flush, fullText, youtubeNotConfigured, type Reply } from './support.ts'

const BUTTON = '라벨을 쓰지 않아요'
const HINT = '라벨 없이 팔아요. 설정에서 언제든 다시 켤 수 있어요.'
const OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'

let server: FakeServer
let wizard: WizardState
let current: PrintOverview
let labelsReply: (body: Record<string, unknown>) => Reply | Promise<Reply>

const entry = (enabled: boolean) => ({ enabled, at: '2026-10-20T11:31:00.000Z', loginId: 'shop1' })

beforeEach(() => {
  server = new FakeServer()
  wizard = { status: 'IN_PROGRESS', step: 4 }
  current = overview()
  labelsReply = (body) => {
    const enabled = body.enabled === true
    current = overview({ queue: queue({ rev: 2, labelsEnabled: enabled }) })
    return { body: { enabled, history: [entry(enabled)], waiting: 0, rev: 2, changed: true } }
  }
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  // PC 폭 — 메뉴의 "라벨"이 바로 보인다
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  FakeEventSource.reset()
  window.sessionStorage.clear()
  setTopLevelNavigation(() => {})
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/wizard$/, () => ({ body: { wizard } }))
    .on('PUT', /^\/api\/wizard$/, (call) => {
      wizard = { status: call.body?.status as WizardState['status'], step: (call.body?.step as number | undefined) ?? null }
      return { body: { wizard } }
    })
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: DEFAULT_SETTINGS } }))
    .on('GET', /^\/api\/youtube\/connection$/, (): Reply => youtubeNotConfigured)
    .on('GET', /^\/api\/days(\?rehearsal=true)?$/, () => ({ body: { days: [] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50, testPrinter: false } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('PUT', /^\/api\/settings\/labels$/, (call) => labelsReply(call.body ?? {}))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

async function openWizard(): Promise<void> {
  window.history.replaceState(null, '', '/start')
  render(<App />)
  await screen.findByRole('heading', { name: '4/5 프린터 연결', level: 2 })
  await flush(10)
}

const card = () => screen.getByRole('region', { name: '4/5 프린터 연결' })
const menuLabels = () => within(screen.getByRole('navigation', { name: '메뉴' })).queryByRole('link', { name: '라벨' })
const labelsPuts = () => server.callsTo('PUT', /^\/api\/settings\/labels$/)

describe('보이는 때 (AC-PL1B-16)', () => {
  it('라벨 켜짐: 연결 칸 아래 보통 버튼 "라벨을 쓰지 않아요"와 그 아래 안내 — "나중에 할게요"와 따로', async () => {
    await openWizard()
    const button = await within(card()).findByRole('button', { name: BUTTON })
    expect(button.className).toBe('button')
    const hint = within(card()).getByText(HINT)
    // 버튼 다음에 안내 (문서 순서)
    expect(button.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 연결 칸(이 브라우저의 프린터 연결) 아래
    const here = within(card()).getByText('여기서 바로 연결하고 테스트 인쇄를 해 볼 수도 있어요.')
    expect(here.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(card()).getByRole('button', { name: '나중에 할게요' })).not.toBe(button)
  })

  it('켬/끔을 모르면 버튼 없음("불러오는 중…" 그대로)', async () => {
    server.on('GET', /^\/api\/print$/, () => new Promise<Reply>(() => {}))
    await openWizard()
    expect(within(card()).getByText('불러오는 중…')).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: BUTTON })).toBeNull()
    expect(within(card()).queryByText(HINT)).toBeNull()
  })

  it('꺼짐: "라벨 쓰지 않음" 안내만, 버튼 없음', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    await openWizard()
    expect(within(card()).getByText(fullText(OFF_NOTE))).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: BUTTON })).toBeNull()
    expect(within(card()).queryByText(HINT)).toBeNull()
  })
})

describe('고르면 끄고 다음 단계로 (AC-PL1B-17)', () => {
  it('확인 창 없이 끄기 요청 하나 — 보내는 동안 이 버튼과 "다음" 잠김, 성공하면 5/5(제목 포커스·서버 단계 5), 메뉴 "라벨" 사라짐, "이전"은 3/5', async () => {
    let release: () => void = () => {}
    const reply = labelsReply
    labelsReply = (body) => new Promise<Reply>((resolve) => (release = () => void Promise.resolve(reply(body)).then(resolve)))
    await openWizard()
    expect(menuLabels()).toBeTruthy()
    fireEvent.click(await within(card()).findByRole('button', { name: BUTTON }))
    await flush(3)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(labelsPuts()).toHaveLength(1)
    expect(labelsPuts()[0]?.body).toEqual({ enabled: false })
    expect((within(card()).getByRole('button', { name: BUTTON }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(card()).getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
    release()
    const title = await screen.findByRole('heading', { name: '5/5 리허설 해 보기', level: 2 })
    await waitFor(() => expect(document.activeElement).toBe(title))
    await waitFor(() => expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 5 }))
    expect(labelsPuts()).toHaveLength(1)
    await waitFor(() => expect(menuLabels()).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(await screen.findByRole('heading', { name: '3/5 유튜브 연결', level: 2 })).toBeTruthy()
  })
})

describe('실패하면 그 단계에 머문다 (AC-PL1B-18)', () => {
  it.each([
    ['5xx', (): Reply => apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.'), '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.'],
    ['네트워크 실패', (): Reply => ({ network: true }), '인터넷 연결을 확인하고 다시 눌러 주세요.'],
  ])('%s: 4/5 그대로, 문장, 라벨은 켜진 그대로(메뉴 "라벨"), 버튼이 다시 눌린다', async (_name, fail, sentence) => {
    labelsReply = fail
    await openWizard()
    fireEvent.click(await within(card()).findByRole('button', { name: BUTTON }))
    expect(await within(card()).findByText(sentence)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '4/5 프린터 연결', level: 2 })).toBeTruthy()
    expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 4 })
    expect(menuLabels()).toBeTruthy()
    const button = within(card()).getByRole('button', { name: BUTTON }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect((within(card()).getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(false)
    const before = labelsPuts().length
    fireEvent.click(button)
    await waitFor(() => expect(labelsPuts().length).toBeGreaterThan(before))
  })
})

describe('누르면 무엇이 되는지 · 끈 뒤 알림 (U-PL1B-05)', () => {
  it('버튼 아래 "누르면 라벨을 끄고 다음 단계로 가요." — AC-PL1B-16의 안내 문장도 그대로', async () => {
    await openWizard()
    const button = await within(card()).findByRole('button', { name: BUTTON })
    const action = within(card()).getByText(NO_LABELS_ACTION)
    expect(NO_LABELS_ACTION).toBe('누르면 라벨을 끄고 다음 단계로 가요.')
    expect(button.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(card()).getByText(HINT)).toBeTruthy()
  })

  it('끈 뒤 5/5 위에 "라벨 기능을 껐어요. 설정에서 다시 켤 수 있어요." 한 줄 — 제목 포커스는 그대로', async () => {
    await openWizard()
    fireEvent.click(await within(card()).findByRole('button', { name: BUTTON }))
    const title = await screen.findByRole('heading', { name: '5/5 리허설 해 보기', level: 2 })
    const step = screen.getByRole('region', { name: '5/5 리허설 해 보기' })
    const done = await within(step).findByText(LABELS_OFF_DONE)
    expect(LABELS_OFF_DONE).toBe('라벨 기능을 껐어요. 설정에서 다시 켤 수 있어요.')
    expect(done.getAttribute('role')).toBe('status')
    // 제목 바로 아래(5/5 내용 위)
    expect(title.nextElementSibling).toBe(done)
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('4/5를 거치지 않고(라벨이 이미 꺼짐) 5/5에 오면 그 한 줄이 없다', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    wizard = { status: 'IN_PROGRESS', step: 5 }
    window.history.replaceState(null, '', '/start')
    render(<App />)
    await screen.findByRole('heading', { name: '5/5 리허설 해 보기', level: 2 })
    await flush(10)
    expect(screen.queryByText(LABELS_OFF_DONE)).toBeNull()
  })
})

describe('실패 상자는 버튼 바로 아래, 보이게, 상자 안 "다시 시도" (U-PL1B-04)', () => {
  let scrolled: Element[]
  beforeEach(() => {
    scrolled = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    } as typeof Element.prototype.scrollIntoView
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('5xx: 상자가 버튼 줄 바로 다음, 생기면 단계 버튼 줄과 상자를 보이게 내린다, 상자 안 "다시 시도"로 다시 보내 성공하면 5/5', async () => {
    let fail = true
    const ok = labelsReply
    labelsReply = (body) => (fail ? apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.') : ok(body))
    await openWizard()
    const button = await within(card()).findByRole('button', { name: BUTTON })
    fireEvent.click(button)
    const alert = await within(card()).findByRole('alert', {}, { timeout: 10_000 })
    expect(alert.textContent).toContain('서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.')
    expect(alert.textContent).not.toContain('INTERNAL_ERROR')
    const box = alert.closest('.wizard-no-labels-error')
    expect(box).not.toBeNull()
    // 버튼 줄 바로 다음
    expect(button.parentElement?.nextElementSibling).toBe(box)
    // 보이게 내린다: 단계 버튼 줄 먼저, 마지막은 상자
    const row = card().querySelector('.wizard-buttons')
    expect(scrolled).toContain(row)
    expect(scrolled.at(-1)).toBe(box)
    const before = labelsPuts().length
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '5/5 리허설 해 보기', level: 2 })).toBeTruthy()
    expect(labelsPuts().length).toBe(before + 1)
  }, 20_000)

  it('같은 순간 두 번 눌러도 끄기 요청 하나', async () => {
    let release: () => void = () => {}
    const reply = labelsReply
    labelsReply = (body) => new Promise<Reply>((resolve) => (release = () => void Promise.resolve(reply(body)).then(resolve)))
    await openWizard()
    const button = (await within(card()).findByRole('button', { name: BUTTON })) as HTMLButtonElement
    act(() => {
      button.click()
      button.click()
    })
    await flush(5)
    expect(labelsPuts()).toHaveLength(1)
    release()
    await screen.findByRole('heading', { name: '5/5 리허설 해 보기', level: 2 })
    expect(labelsPuts()).toHaveLength(1)
  })
})

describe('라벨 꺼짐 안내의 "설정" 링크 (U-PL1B-06)', () => {
  it('4/5 꺼짐 안내의 "설정"을 누르면 설정 화면의 라벨 칸 — 제목에 포커스', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    server.on('GET', /^\/api\/settings\/labels$/, () => ({ body: { enabled: false, history: [], waiting: 0, rev: 1 } }))
    await openWizard()
    const sentence = within(card()).getByText(fullText(OFF_NOTE))
    const link = within(sentence).getByRole('link', { name: '설정의 라벨 칸 열기' })
    expect(link.getAttribute('href')).toBe('/settings/labels')
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { name: '설정', level: 1 })).toBeTruthy()
    expect(window.location.pathname).toBe('/settings/labels')
    const title = await screen.findByRole('heading', { name: '라벨', level: 2 })
    await waitFor(() => expect(document.activeElement).toBe(title))
  })
})
