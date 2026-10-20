// 라벨 끄기 모드 — 설정 화면·라벨 화면 (N4a, SPEC RCP-01·§7 화면 7·8, LABEL_RULES L-13, D-N4a-05·06,
// AC-N4a-10·11·12·13·16·18·19·20·21). 서버 계약은 harness/sprints/N4a/dev-notes.md "dev-server > 바뀐 계약".
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { LabelSettings, LabelSwitchEntry, PrintOverview } from '../src/api/print-types.ts'
import { setLabelEnv } from '../src/lib/label-env.ts'
import { device, job, jsdomLabelEnv, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, apiError, flush } from './support.ts'

const ME = 'device-me-n4a-0001'
const HELP =
  '끄면 라벨 화면·프린터 연결·자동 출력·다시 출력·포장 라벨 출력·라벨 그림 파일 내려받기가 모두 숨겨져요. 판매 판정과 감사 메시지는 그대로예요. 방송 중에 바꿔도 바꾼 때부터 적용돼요.'
const TURNED_ON = "라벨 기능을 켰어요. 끈 동안 1등이 된 상품의 라벨은 저절로 출력되지 않아요. 필요하면 상품에서 '라벨 출력'을 눌러 주세요."
const OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'
const REFUSED = '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.'

let server: FakeServer
let current: PrintOverview
let settings: LabelSettings
let testPrinter: boolean

const entry = (enabled: boolean, at: string, loginId = 'shop1'): LabelSwitchEntry => ({ enabled, at, loginId })

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('livejjim.deviceId', ME)
  server = new FakeServer()
  current = overview()
  settings = { enabled: true, history: [], waiting: 0, rev: 1 }
  testPrinter = false
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { 'print.autoOnConfirm': true } } }))
    .on('GET', /^\/api\/settings\/labels$/, () => ({ body: settings }))
    .on('PUT', /^\/api\/settings\/labels$/, (call) => {
      const enabled = call.body?.['enabled'] === true
      const changed = enabled !== settings.enabled
      const rev = settings.rev + (changed ? 1 : 0)
      settings = { enabled, history: changed ? [entry(enabled, '2026-10-20T11:31:00.000Z'), ...settings.history] : settings.history, waiting: settings.waiting, rev }
      current = { ...current, queue: { ...current.queue, rev, labelsEnabled: enabled } }
      return { body: { ...settings, changed } }
    })
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openAt(path: string, heading: string): Promise<HTMLElement> {
  window.history.replaceState(null, '', path)
  const view = render(<App />)
  await screen.findByRole('heading', { name: heading, level: 1 })
  await flush(10)
  return view.container
}

/** 창 밖의 주 버튼 글자 (AC-S06b-24 표시 .button-primary) */
function primaryOutsideDialogs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.button-primary')].filter((el) => el.closest('[role=dialog]') === null).map((el) => el.textContent?.trim() ?? '')
}

const labelSection = () => screen.getByRole('region', { name: '라벨' })
const sendLabels = (rev: number, enabled: boolean, changed = entry(enabled, '2026-10-20T12:00:00.000Z', 'helper')) =>
  act(() => {
    FakeEventSource.last.emit('labels', { rev, enabled, entry: changed })
  })

describe('설정 화면과 메뉴 "설정" (AC-N4a-10, AC-I3-44)', () => {
  it('/settings를 주소로 바로 열면 제목 "설정", "라벨" 칸에 지금 상태 글자·보통 버튼 하나·설명 — 그 칸에 주 버튼 없음', async () => {
    await openAt('/settings', '설정')
    const section = labelSection()
    await waitFor(() => expect(within(section).getByText('라벨 기능: 켜짐')).toBeTruthy())
    const button = within(section).getByRole('button', { name: '라벨 끄기' })
    expect(button.className).toBe('button')
    expect(within(section).getAllByRole('button')).toHaveLength(1)
    expect(within(section).getByText(HELP)).toBeTruthy()
    // "라벨" 칸에는 주 버튼이 없다 (다른 칸의 "저장" 등 주 버튼은 I3 설정 화면의 것 — D-N4a-07)
    expect(section.querySelectorAll('.button-primary')).toHaveLength(0)
    expect(screen.getByRole('link', { name: '설정' }).getAttribute('aria-current')).toBe('page')
  })

  it('메뉴 "설정"을 누르면 설정 화면 — "설정"은 메뉴 항목 하나다 (AC-I3-44, D-N4a-07)', async () => {
    await openAt('/', '방송 목록')
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect(screen.getAllByRole('link', { name: '설정' })).toHaveLength(1)
    fireEvent.click(within(menu).getByRole('link', { name: '설정' }))
    expect(await screen.findByRole('heading', { name: '설정', level: 1 })).toBeTruthy()
    expect(window.location.pathname).toBe('/settings')
  })
})

describe('끌 때는 묻고, 켤 때는 바로 알린다 (AC-N4a-11)', () => {
  it('"라벨 끄기" → 확인 창(처음 포커스 "닫기", 대기 N장 문장) — Esc·닫기는 아무것도 보내지 않는다', async () => {
    current = overview({ queue: queue({ waiting: 2 }) })
    settings = { ...settings, waiting: 2 }
    await openAt('/settings', '설정')
    fireEvent.click(await within(labelSection()).findByRole('button', { name: '라벨 끄기' }))
    const dialog = screen.getByRole('dialog', { name: '라벨 기능 끄기' })
    expect(document.activeElement?.textContent).toBe('닫기')
    expect(within(dialog).getByText("출력 대기 중인 라벨 2장은 출력하지 않고 남겨 둬요. 다시 켜면 '출력 시작'을 눌러 이어서 출력할 수 있어요.")).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(labelSection()).getByRole('button', { name: '라벨 끄기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(0)
    expect(within(labelSection()).getByText('라벨 기능: 켜짐')).toBeTruthy()
    // 닫으면 포커스는 누른 버튼으로
    await waitFor(() => expect(document.activeElement?.textContent).toBe('라벨 끄기'))
  })

  it('대기 라벨이 없으면 그 문장이 없다. 숫자 키 1 = 라벨 끄기 → 저장된 뒤에만 "라벨 기능을 껐어요."·"꺼짐", 포커스는 바뀐 버튼 "라벨 켜기"', async () => {
    let release: (() => void) | null = null
    server.on('PUT', /^\/api\/settings\/labels$/, async (call) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      settings = { enabled: call.body?.['enabled'] === true, history: [entry(false, '2026-10-20T11:31:00.000Z')], waiting: 0, rev: 2 }
      return { body: { ...settings, changed: true } }
    })
    await openAt('/settings', '설정')
    fireEvent.click(await within(labelSection()).findByRole('button', { name: '라벨 끄기' }))
    const dialog = screen.getByRole('dialog', { name: '라벨 기능 끄기' })
    expect(within(dialog).queryByText(/출력 대기 중인 라벨/)).toBeNull()
    fireEvent.keyDown(dialog, { key: '1' })
    await waitFor(() => expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(1))
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: false })
    // 저장 전: 상태 그대로, 다시 눌러도 두 번 보내지 않는다
    expect(within(labelSection()).getByText('라벨 기능: 켜짐')).toBeTruthy()
    expect(screen.queryByText('라벨 기능을 껐어요.')).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: '1' })
    await flush()
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(1)
    ;(release as (() => void) | null)?.()
    expect(await screen.findByText('라벨 기능을 껐어요.')).toBeTruthy()
    expect(within(labelSection()).getByText('라벨 기능: 꺼짐')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('라벨 켜기'))
  })

  it('끄기에 실패하면 서버 문장(창 안)과 다시 해 볼 길 — 상태는 그대로 "켜짐"', async () => {
    server.on('PUT', /^\/api\/settings\/labels$/, () => apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'))
    await openAt('/settings', '설정')
    fireEvent.click(await within(labelSection()).findByRole('button', { name: '라벨 끄기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '라벨 끄기' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '라벨 끄기' })).toBeTruthy()
    expect(within(labelSection()).getByText('라벨 기능: 켜짐')).toBeTruthy()
    expect(screen.queryByText('라벨 기능을 껐어요.')).toBeNull()
  })

  it('"라벨 켜기"는 창 없이 보내고, 저장된 뒤 켜기 안내와 "켜짐" — 보내는 동안 버튼은 눌리지 않는다', async () => {
    settings = { enabled: false, history: [entry(false, '2026-10-20T11:00:00.000Z')], waiting: 0, rev: 2 }
    current = overview({ queue: queue({ rev: 2, labelsEnabled: false }) })
    await openAt('/settings', '설정')
    const button = await within(labelSection()).findByRole('button', { name: '라벨 켜기' })
    expect(within(labelSection()).getByText('라벨 기능: 꺼짐')).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(await screen.findByText(TURNED_ON)).toBeTruthy()
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(1)
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: true })
    expect(within(labelSection()).getByText('라벨 기능: 켜짐')).toBeTruthy()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('라벨 끄기'))
    // 켜면 메뉴 "라벨"이 돌아온다
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '라벨' })).toBeTruthy())
  })
})

describe('바꾼 기록 (AC-N4a-12)', () => {
  it('최근 기록이 새것 먼저 "2026-10-20 (화) 20:31 · 라벨 끔 · <로그인 아이디>" (KST, 연도·요일까지), 없으면 "아직 바꾼 기록이 없어요."', async () => {
    await openAt('/settings', '설정')
    expect(await within(labelSection()).findByText('아직 바꾼 기록이 없어요.')).toBeTruthy()
    cleanup()
    settings = {
      enabled: true,
      history: [entry(true, '2026-10-20T11:40:00.000Z', 'shop1'), entry(false, '2026-10-20T11:31:00.000Z', 'shop1'), entry(false, '2026-10-19T15:05:00.000Z', 'helper')],
      waiting: 0,
      rev: 3,
    }
    await openAt('/settings', '설정')
    const list = await within(labelSection()).findByRole('list', { name: '바꾼 기록' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '2026-10-20 (화) 20:40 · 라벨 켬 · shop1',
      '2026-10-20 (화) 20:31 · 라벨 끔 · shop1',
      '2026-10-20 (화) 00:05 · 라벨 끔 · helper',
    ])
  })

  it('다른 기기에서 바꾸면 상태·버튼·바꾼 기록이 실시간 알림으로 바로 바뀐다 — 열린 끄기 창은 닫힌다', async () => {
    await openAt('/settings', '설정')
    fireEvent.click(await within(labelSection()).findByRole('button', { name: '라벨 끄기' }))
    expect(screen.getByRole('dialog', { name: '라벨 기능 끄기' })).toBeTruthy()
    sendLabels(2, false)
    expect(within(labelSection()).getByText('라벨 기능: 꺼짐')).toBeTruthy()
    expect(within(labelSection()).getByRole('button', { name: '라벨 켜기' })).toBeTruthy()
    expect(within(within(labelSection()).getByRole('list', { name: '바꾼 기록' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['2026-10-20 (화) 21:00 · 라벨 끔 · helper'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(0)
  })
})

describe('라벨 화면 — 꺼져 있을 때 (AC-N4a-13·16·19)', () => {
  it('제목 "라벨"과 안내·"설정" 링크만 — 연결 마법사·출력 기기·대기열·이력·라벨 설정·자동 출력·내보내기가 없다. 메뉴 "라벨"·프린터 상태도 없다', async () => {
    current = overview({ queue: queue({ labelsEnabled: false, waiting: 2, device: device('other-1') }), jobs: [job('w1'), job('w2')] })
    const container = await openAt('/labels', '라벨')
    const main = container.querySelector('main') as HTMLElement
    expect(within(main).getByText(OFF_NOTE)).toBeTruthy()
    const link = within(main).getByRole('link', { name: '설정' })
    expect(link.getAttribute('href')).toBe('/settings')
    expect(within(main).getAllByRole('heading').map((h) => h.textContent)).toEqual(['라벨'])
    expect(within(main).queryAllByRole('button')).toHaveLength(0)
    for (const word of ['프린터', '출력 대기열', '출력 이력', '라벨 설정', '내보내기', '자동 출력', '이 기기에서 출력', 'PDF', '그림 파일']) expect(main.textContent).not.toContain(word)
    expect(within(screen.getByRole('navigation', { name: '메뉴' })).queryByRole('link', { name: '라벨' })).toBeNull()
    expect(screen.queryByRole('link', { name: /출력 기기|프린터|출력 멈춤/ })).toBeNull()
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { name: '설정', level: 1 })).toBeTruthy()
  })

  it('버릴 라벨은 꺼져 있어도 남는다: 안내 아래 "버릴 라벨" 절 — "버렸어요"(보통 버튼) 뒤 사라진다', async () => {
    const discard = job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요', device: 'PC', printedAt: '2026-10-19T11:01:00.000Z' })
    current = overview({ queue: queue({ labelsEnabled: false, discard: 1 }), discard: [discard] })
    server.on('POST', /^\/api\/print\/jobs\/discard$/, () => ({ body: { job: { ...discard, discard: false, word: '폐기' } } }))
    await openAt('/labels', '라벨')
    const region = screen.getByRole('region', { name: '버릴 라벨' })
    expect(within(region).getByText('15번 · 우주천사 · 26.10.19 라벨을 버려 주세요')).toBeTruthy()
    const button = within(region).getByRole('button', { name: '버렸어요' })
    expect(button.className).not.toContain('button-primary')
    fireEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('region', { name: '버릴 라벨' })).toBeNull())
    expect(server.callsTo('POST', /^\/api\/print\/jobs\/discard$/)[0]?.body).toEqual({ date: DATE, id: 'd1' })
  })

  it('버릴 라벨이 없으면 그 절이 없다', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    await openAt('/labels', '라벨')
    expect(screen.queryByRole('region', { name: '버릴 라벨' })).toBeNull()
  })

  it('보는 중에 다른 기기에서 끄면 바로 안내로, 다시 켜면 I1 모습 그대로 돌아온다', async () => {
    current = overview({ queue: queue({ device: device('other-1', { name: '휴대폰' }), waiting: 1 }), jobs: [job('w1')] })
    await openAt('/labels', '라벨')
    expect(screen.getByRole('region', { name: '출력 대기열' })).toBeTruthy()
    sendLabels(2, false)
    expect(screen.getByText(OFF_NOTE)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '출력 대기열' })).toBeNull()
    expect(screen.queryByRole('link', { name: /프린터 휴대폰/ })).toBeNull()
    sendLabels(3, true)
    expect(screen.queryByText(OFF_NOTE)).toBeNull()
    for (const name of ['프린터', '출력 대기열', '버릴 라벨', '출력 이력', '라벨 설정', '내보내기']) expect(screen.getByRole('region', { name })).toBeTruthy()
    expect(screen.getByRole('link', { name: '프린터 휴대폰 · 연결됨 · 대기 1장' })).toBeTruthy()
  })
})

describe('모르는 동안에는 숨긴다 (AC-N4a-18)', () => {
  it('켬/끔 조회가 늦는 동안 라벨 화면·메뉴 "라벨"·프린터 상태에 라벨 조작이 하나도 없다', async () => {
    let release: (() => void) | null = null
    server.on('GET', /^\/api\/print$/, async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { body: current }
    })
    current = overview({ queue: queue({ labelsEnabled: false }) })
    const container = await openAt('/labels', '라벨')
    const main = container.querySelector('main') as HTMLElement
    expect(within(main).getByText('불러오는 중…')).toBeTruthy()
    expect(within(main).queryAllByRole('button')).toHaveLength(0)
    expect(within(main).queryByText(OFF_NOTE)).toBeNull()
    expect(within(screen.getByRole('navigation', { name: '메뉴' })).queryByRole('link', { name: '라벨' })).toBeNull()
    expect(screen.queryByRole('link', { name: /출력 기기|프린터/ })).toBeNull()
    ;(release as (() => void) | null)?.()
    expect(await within(main).findByText(OFF_NOTE)).toBeTruthy()
  })

  it('불러오지 못하면 라벨 조작 없이 서버 문장과 "다시 시도"', async () => {
    server.on('GET', /^\/api\/print$/, () => apiError(403, 'FORBIDDEN', '이 기능을 쓸 수 없어요.'))
    const container = await openAt('/labels', '라벨')
    const main = container.querySelector('main') as HTMLElement
    expect(within(main).getByText('이 기능을 쓸 수 없어요.')).toBeTruthy()
    expect(within(main).getAllByRole('button').map((button) => button.textContent)).toEqual(['다시 시도'])
  })
})

describe('오래된 화면이 보낸 라벨 요청 (AC-N4a-20)', () => {
  it('"출력 시작"이 LABELS_OFF로 거절되면 그 문장을 보이고 꺼진 상태로 다시 불러온다 — 다시 보내지 않는다. 다른 화면으로 가면 문장은 지운다', async () => {
    current = overview({ queue: queue({ device: device('other-1'), waiting: 3, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } }) })
    server.on('POST', /^\/api\/print\/restart$/, () => {
      current = overview({ queue: queue({ rev: 2, labelsEnabled: false, device: device('other-1'), waiting: 3, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } }) })
      return apiError(409, 'LABELS_OFF', REFUSED)
    })
    await openAt('/labels', '라벨')
    const before = server.callsTo('GET', /^\/api\/print$/).length
    fireEvent.click(within(screen.getByRole('region', { name: '출력 멈춤' })).getByRole('button', { name: '출력 시작' }))
    expect(await screen.findByText(REFUSED)).toBeTruthy()
    expect(screen.getByText(OFF_NOTE)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '출력 멈춤' })).toBeNull()
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/print$/).length).toBeGreaterThan(before))
    await flush(5)
    expect(server.callsTo('POST', /^\/api\/print\/restart$/)).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('link', { name: '설정' })[0] as HTMLElement)
    await screen.findByRole('heading', { name: '설정', level: 1 })
    fireEvent.click(screen.getByRole('link', { name: '방송' }))
    await screen.findByRole('heading', { name: '방송 목록', level: 1 })
    window.history.pushState(null, '', '/labels')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByText(OFF_NOTE)).toBeTruthy()
    expect(screen.queryByText(REFUSED)).toBeNull()
  })

  it('"라벨 설정 저장"이 LABELS_OFF로 거절돼도 같다 — 그 문장과 꺼진 화면', async () => {
    const env = jsdomLabelEnv()
    setLabelEnv(env)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    try {
      server.on('PUT', /^\/api\/print\/templates\/product$/, () => {
        current = overview({ queue: queue({ rev: 2, labelsEnabled: false }) })
        return apiError(409, 'LABELS_OFF', REFUSED)
      })
      await openAt('/labels', '라벨')
      const editor = screen.getByRole('region', { name: '라벨 설정' })
      fireEvent.change(within(editor).getAllByLabelText('가게 이름')[0] as HTMLInputElement, { target: { value: '다육농장' } })
      const save = within(editor).getAllByRole('button', { name: '라벨 설정 저장' })[0] as HTMLButtonElement
      expect(save.className).not.toContain('button-primary')
      fireEvent.click(save)
      expect(await screen.findByText(REFUSED, {}, { timeout: 5000 })).toBeTruthy()
      expect(screen.getByText(OFF_NOTE)).toBeTruthy()
      expect(screen.queryByRole('region', { name: '라벨 설정' })).toBeNull()
      expect(server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(1)
    } finally {
      setLabelEnv(null)
      getContext.mockRestore()
    }
  })
})

describe('라벨 화면 주 버튼은 지금 할 일 하나 (AC-N4a-21, D-N4a-06)', () => {
  it('(가) 연결 전: 첫 연결 방법 → (가) 연결 직후: "테스트 인쇄" → (나) 테스트 결과 "예": "이 기기에서 출력" — 버렸어요·라벨 설정 저장은 보통 버튼', async () => {
    testPrinter = true
    setLabelEnv(jsdomLabelEnv())
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    onTestFinished(() => {
      setLabelEnv(null)
      getContext.mockRestore()
    })
    const discard = job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요' })
    current = overview({ queue: queue({ discard: 1 }), discard: [discard] })
    await openAt('/labels', '라벨')
    expect(primaryOutsideDialogs()).toEqual(['시험용 프린터 — 실제로 출력되지 않아요'])
    const printer = screen.getByRole('region', { name: '프린터' })
    fireEvent.click(within(printer).getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }))
    await waitFor(() => expect(within(printer).getByText('연결됨')).toBeTruthy())
    expect(primaryOutsideDialogs()).toEqual(['테스트 인쇄'])
    fireEvent.click(within(printer).getByRole('button', { name: '테스트 인쇄' }))
    await waitFor(() => expect(within(printer).getByRole('group', { name: '테스트 인쇄 결과' })).toBeTruthy(), { timeout: 5000 })
    expect(primaryOutsideDialogs()).toEqual(['테스트 인쇄'])
    fireEvent.click(within(printer).getByRole('button', { name: '예' }))
    expect(primaryOutsideDialogs()).toEqual(['이 기기에서 출력'])
  })

  it('(다) 출력 기기가 된 뒤 끊김 멈춤: "다시 연결" 하나 — 연결 방법 버튼은 보통 버튼', async () => {
    testPrinter = true
    window.localStorage.setItem('livejjim.printMethod', 'test')
    current = overview({ queue: queue({ device: device(ME, { name: 'PC', printerConnected: false }), waiting: 1, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } }), jobs: [job('w1')] })
    await openAt('/labels', '라벨')
    expect(primaryOutsideDialogs()).toEqual(['다시 연결'])
    expect(within(screen.getByRole('region', { name: '프린터' })).getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }).className).toBe('button')
  })

  it('쌓인 라벨 멈춤("출력 시작")이 보이면 그것 하나 — 다른 기기의 끊김 멈춤(문장뿐)은 프린터 단계가 주 버튼', async () => {
    testPrinter = true
    current = overview({ queue: queue({ device: device('other-1'), waiting: 2, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } }) })
    await openAt('/labels', '라벨')
    expect(primaryOutsideDialogs()).toEqual(['출력 시작'])
    cleanup()
    current = overview({ queue: queue({ device: device('other-1', { printerConnected: false }), waiting: 2, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } }) })
    await openAt('/labels', '라벨')
    expect(primaryOutsideDialogs()).toEqual(['시험용 프린터 — 실제로 출력되지 않아요'])
  })

  it('(라) 이 기기가 출력 기기이고 멈추지 않았으면 프린터 단계 밖에 주 버튼이 없다 — 버릴 라벨이 있고 라벨 설정을 고치는 중이어도', async () => {
    testPrinter = true
    const discard = job('d1', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요' })
    current = overview({ queue: queue({ device: device(ME, { name: 'PC' }), discard: 1 }), discard: [discard] })
    await openAt('/labels', '라벨')
    const editor = screen.getByRole('region', { name: '라벨 설정' })
    fireEvent.change(within(editor).getAllByLabelText('가게 이름')[0] as HTMLInputElement, { target: { value: '다육농장' } })
    // 이 기기가 출력 기기라 연결 전이어도 프린터 단계에 주 버튼이 없다
    expect(primaryOutsideDialogs()).toEqual([])
  })
})

describe('시작 마법사 3단계 — 라벨 기능을 끈 판매자 (L-13 9, D-N4a-05·07)', () => {
  const STEP = '3/5 프린터 연결'
  beforeEach(() => {
    server.on('GET', /^\/api\/wizard$/, () => ({ body: { wizard: { status: 'IN_PROGRESS', step: 3 } } })).on('PUT', /^\/api\/wizard$/, (call) => ({ body: { wizard: call.body } }))
  })

  it('꺼져 있으면 프린터 연결 칸 대신 "라벨 쓰지 않음" 안내만 — 연결·테스트 인쇄 버튼이 없다', async () => {
    testPrinter = true
    current = overview({ queue: queue({ labelsEnabled: false }) })
    window.history.replaceState(null, '', '/start')
    render(<App />)
    await screen.findByRole('heading', { name: STEP, level: 2 })
    await flush(10)
    expect(screen.getByText(OFF_NOTE)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '프린터' })).toBeNull()
    expect(screen.queryByRole('button', { name: /연결|테스트 인쇄/ })).toBeNull()
  })

  it('켜져 있으면 I1 연결 칸을 그대로 끼운다', async () => {
    testPrinter = true
    window.history.replaceState(null, '', '/start')
    render(<App />)
    await screen.findByRole('heading', { name: STEP, level: 2 })
    await flush(10)
    expect(await screen.findByRole('region', { name: '프린터' })).toBeTruthy()
    expect(screen.queryByText(OFF_NOTE)).toBeNull()
  })
})
