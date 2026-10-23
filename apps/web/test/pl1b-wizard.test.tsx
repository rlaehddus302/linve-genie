// PL1B 시작 마법사 4/5 "라벨을 쓰지 않아요" (UX-02·RCP-01·L-13 1·2, D-PL1-06, AC-PL1B-16~18): 앱 전체를 그린다.
// 라벨 켜짐이면 연결 칸 아래 보통 버튼과 안내 한 줄, 모르면·꺼짐이면 버튼 없음. 누르면 확인 창 없이 끄기 요청 하나(보내는 동안 이 버튼·"다음" 잠김),
// 성공하면 5/5(제목 포커스·서버 단계 5)·메뉴 "라벨" 사라짐·"이전"은 3/5. 실패하면 4/5에 머물고 문장, 라벨은 켜진 그대로, 다시 누를 수 있다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import type { WizardState } from '../src/api/types.ts'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { overview, queue, templates } from './print-support.ts'
import { FakeEventSource, FakeServer, apiError, flush, youtubeNotConfigured, type Reply } from './support.ts'

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
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1', role: 'SELLER', assistant: null } }))
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
    expect(within(card()).getByText(OFF_NOTE)).toBeTruthy()
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
