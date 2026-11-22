// 소리 듣기 고르기 (D-RETRO-70~72, 사용자 지시 2026-11-13 "휴대폰 마이크로 들을지 라이브 소리로 바로 할지 설정하게 해 달라"):
// 라이브 관리의 "소리 듣기" 줄 → 고르는 판([휴대폰 마이크] · [라이브 소리]), 고른 값은 서버에(PUT /api/settings/listen-source),
// 방송 화면 음성 창의 작은 표시(누르면 같은 판), 고른 대로 이 휴대폰 마이크가 따른다. 아이폰·갤럭시 같은 코드(플랫폼 분기 없음).
// D-LISTEN-MIC-01 (2026-11-23): 고르기를 없앴다 — 서버는 늘 'mic'. 관리 줄·판의 고르기 시험은 바뀐 기대로(아래 describe 주석).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STREAM_AUDIO_LATE } from '@livejjim/web/src/lib/stream-audio.ts'
import {
  LISTEN_SOURCE_DESCRIPTION, LISTEN_SOURCE_TITLE, ListenSourceStore, listenChoices, listenNow, listenShort, readListenSetting,
  type ListenMic, type ListenSetting,
} from '../src/lib/listen-source.ts'
import { VOICE_CONSENT_LINES } from '../src/lib/words.ts'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import { resetDockChoice } from '../src/lib/dock-choice.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { LISTEN_SOURCE_POLL_MS } from '../src/screens/console/StreamAudio.tsx'
import { makeWorld, type ScreenWorld } from './screen-support.tsx'
import { FakeServer, flush } from './support.ts'

const SOURCE = /^\/api\/settings\/listen-source$/
const STATUS = /^\/api\/broadcasts\/b1\/stream-audio$/
const WATCH = /^\/api\/broadcasts\/b1\/stream-audio\/watch$/
const TICKET = /^\/api\/broadcasts\/b1\/voice-ticket/
const BOTH: ListenSetting = { source: 'mic', streamAvailable: true, streamEnabled: true }
const MIC_OFF: ListenMic = { on: false, kind: 'off', allowed: null }

afterEach(() => { resetDockChoice(); vi.restoreAllMocks() })

describe('지금 듣는 곳 한 문장 (listenNow — 순수 함수)', () => {
  it('이 휴대폰 마이크가 켜져 있으면 마이크가 이긴다 — 듣는 중 · 켜는 중 · 다시 연결하는 중', () => {
    expect(listenNow('mic', { on: true, kind: 'listening', allowed: true }, { phase: 'mic' })).toEqual({ hearing: 'mic', text: '휴대폰 마이크로 듣고 있어요', tone: 'ok', late: null, canMic: false, canRetry: false })
    expect(listenNow('mic', { on: true, kind: 'starting', allowed: true }, { phase: 'listening' })).toMatchObject({ hearing: 'none', text: '휴대폰 마이크를 켜는 중이에요', tone: 'warn' })
    expect(listenNow('mic', { on: true, kind: 'reconnecting', allowed: true }, null)).toMatchObject({ hearing: 'none', text: '휴대폰 마이크를 다시 연결하는 중이에요', tone: 'warn' })
  })

  it('휴대폰 마이크를 골랐는데 마이크가 꺼져 있으면 까닭과 함께 라이브 소리 상태를 말하고 [휴대폰 마이크 켜기]를 보인다', () => {
    expect(listenNow('mic', MIC_OFF, { phase: 'listening' })).toEqual({ hearing: 'stream', text: '마이크가 꺼져 있어 라이브 소리로 듣고 있어요', tone: 'warn', late: null, canMic: true, canRetry: false })
    expect(listenNow('mic', { on: false, kind: 'off', allowed: false }, { phase: 'listening' }).text).toBe('마이크 권한이 없어 라이브 소리로 듣고 있어요')
    expect(listenNow('mic', { on: false, kind: 'stopped', allowed: true }, { phase: 'listening' }).text).toBe('휴대폰 마이크가 멈춰서 라이브 소리로 듣고 있어요')
    expect(listenNow('mic', MIC_OFF, { phase: 'reconnecting' })).toMatchObject({ hearing: 'none', text: '마이크가 꺼져 있어 라이브 소리를 다시 연결하는 중이에요', tone: 'warn', canMic: true })
    expect(listenNow('mic', MIC_OFF, { phase: 'idle' })).toMatchObject({ hearing: 'none', text: '마이크가 꺼져 있어 라이브를 연결하면 라이브 소리로 들어요', canMic: true })
    expect(listenNow('mic', MIC_OFF, { phase: 'stopped' })).toMatchObject({ hearing: 'none', text: '마이크가 꺼져 있어 라이브 소리 듣기가 멈췄어요', tone: 'danger', canMic: true, canRetry: true })
  })

  it('마이크도 꺼져 있고 라이브 소리도 못 들으면 "지금은 듣지 않아요"라고 말한다', () => {
    expect(listenNow('mic', MIC_OFF, { phase: 'off' })).toMatchObject({ hearing: 'none', text: '마이크가 꺼져 있어요. 라이브 소리 듣기가 꺼져 있어요. 지금은 듣지 않아요', tone: 'danger', canMic: true })
    expect(listenNow('mic', MIC_OFF, { phase: 'unsupported' })).toMatchObject({ text: '마이크가 꺼져 있어요. 이 라이브는 소리를 받을 수 없어요. 지금은 듣지 않아요', tone: 'danger' })
    expect(listenNow('mic', { on: false, kind: 'off', allowed: false }, { phase: 'hidden' })).toMatchObject({ text: '마이크 권한이 없어요. 지금은 듣지 않아요', tone: 'danger' })
    expect(listenNow('mic', { on: false, kind: 'stopped', allowed: true }, { phase: 'off' }).text).toBe('휴대폰 마이크가 멈췄어요. 라이브 소리 듣기가 꺼져 있어요. 지금은 듣지 않아요')
  })

  it('라이브 소리를 골랐으면 라이브 소리 상태만 — 듣는 중 · 늦음 · 다시 연결하는 중 · 멈춤 · 못 받음', () => {
    expect(listenNow('stream', MIC_OFF, { phase: 'listening', lagMs: 30_000 })).toEqual({ hearing: 'stream', text: '라이브 소리로 듣고 있어요', tone: 'ok', late: null, canMic: false, canRetry: false })
    expect(listenNow('stream', MIC_OFF, { phase: 'listening', lagMs: 30_001 }).late).toBe(STREAM_AUDIO_LATE)
    expect(listenNow('stream', MIC_OFF, { phase: 'reconnecting' })).toMatchObject({ text: '라이브 소리를 다시 연결하는 중이에요', tone: 'warn', canMic: false })
    expect(listenNow('stream', MIC_OFF, { phase: 'stopped' })).toMatchObject({ text: '라이브 소리 듣기가 멈췄어요', tone: 'danger', canRetry: true, canMic: false })
    expect(listenNow('stream', MIC_OFF, { phase: 'unsupported' })).toMatchObject({ text: '이 라이브는 소리를 받을 수 없어요', tone: 'danger' })
    expect(listenNow('stream', MIC_OFF, { phase: 'idle' })).toMatchObject({ text: '라이브를 연결하면 라이브 소리로 들어요', tone: 'info' })
  })

  it('D-LV1-17 서버 쪽 길이 끊김은 라이브 탓이 아니라고 말하고 [라이브 소리 다시 켜기]를 보인다', () => {
    expect(listenNow('stream', MIC_OFF, { phase: 'unsupported', serverFault: true })).toEqual({ hearing: 'none', text: '서버 문제로 지금 라이브 소리를 받지 못해요. 곧 다시 해 볼게요', tone: 'danger', late: null, canMic: false, canRetry: true })
    expect(listenNow('mic', MIC_OFF, { phase: 'unsupported', serverFault: true })).toMatchObject({ text: '마이크가 꺼져 있어요. 서버 문제로 지금 라이브 소리를 받지 못해요. 지금은 듣지 않아요', tone: 'danger', canMic: true, canRetry: true })
    // 라이브 탓인 못 받음은 그대로 — 다시 켜기를 보이지 않는다
    expect(listenNow('stream', MIC_OFF, { phase: 'unsupported' })).toMatchObject({ text: '이 라이브는 소리를 받을 수 없어요', canRetry: false })
  })

  it('다른 기기의 마이크 · 아직 모름 · 라이브 끝', () => {
    expect(listenNow('stream', MIC_OFF, { phase: 'mic' })).toMatchObject({ hearing: 'otherMic', text: '다른 기기의 마이크로 듣고 있어요', tone: 'ok' })
    expect(listenNow(null, MIC_OFF, null)).toMatchObject({ hearing: 'none', text: '확인하는 중이에요', tone: 'info', canMic: false })
    expect(listenNow('mic', MIC_OFF, { phase: 'ended' })).toMatchObject({ hearing: 'none', text: '라이브가 끝났어요', canMic: false })
  })

  it('화면 문장에 개발 낱말·영어 상태값이 없다 (절대 규칙 6)', () => {
    const texts: string[] = [LISTEN_SOURCE_TITLE, LISTEN_SOURCE_DESCRIPTION, ...listenChoices(BOTH).flatMap((choice) => [choice.label, choice.description]), ...listenChoices({ ...BOTH, streamAvailable: false }).map((choice) => choice.description)]
    for (const source of ['mic', 'stream', null] as const) {
      for (const mic of [MIC_OFF, { on: false, kind: 'stopped', allowed: false }, { on: true, kind: 'starting', allowed: true }, { on: true, kind: 'listening', allowed: true }] as const) {
        for (const phase of ['hidden', 'off', 'idle', 'listening', 'reconnecting', 'stopped', 'unsupported', 'mic', 'ended'] as const) texts.push(listenNow(source, mic, { phase, lagMs: 40_000 }).text)
        texts.push(listenNow(source, mic, null).text)
      }
    }
    for (const text of texts) expect(text, text).not.toMatch(/[A-Za-z]|undefined|null|스트림|마이크로폰|폴링|세션|웹소켓/)
  })

  it('고르는 줄의 설명은 지금 사실인 것만 — 넘어갈 라이브 소리가 없으면 "마이크가 꺼지면…"을 말하지 않는다', () => {
    expect(listenChoices(BOTH)).toEqual([
      { value: 'mic', label: '휴대폰 마이크', description: '이 휴대폰 마이크로 바로 들어요. 라이브 소리보다 빨리 글로 바뀌어요. 마이크가 꺼지면 라이브 소리로 들어요.' },
      { value: 'stream', label: '라이브 소리', description: '라이브로 나간 소리를 서버가 들어요. 앱을 닫아도 들어요. 라이브가 늦게 나가는 만큼 늦어요.' },
    ])
    expect(listenChoices({ ...BOTH, streamEnabled: false })[0]?.description).toBe('이 휴대폰 마이크로 바로 들어요. 라이브 소리보다 빨리 글로 바뀌어요.')
    expect(listenChoices({ ...BOTH, streamAvailable: false }).map((choice) => choice.description)).toEqual(['이 휴대폰 마이크로 바로 들어요. 라이브 소리보다 빨리 글로 바뀌어요.', '지금은 라이브 소리로 들을 수 없어요.'])
    expect(listenChoices(null)[0]?.description).toBe('이 휴대폰 마이크로 바로 들어요. 라이브 소리보다 빨리 글로 바뀌어요.')
  })

  it('음성 창 표시 낱말: 실제로 듣는 쪽, 듣는 쪽이 없으면 고른 쪽, 아무것도 모르면 없음', () => {
    expect(listenShort('mic', listenNow('mic', { on: true, kind: 'listening', allowed: true }, { phase: 'mic' }))).toBe('마이크')
    expect(listenShort('mic', listenNow('mic', MIC_OFF, { phase: 'listening' }))).toBe('라이브')
    expect(listenShort('stream', listenNow('stream', MIC_OFF, { phase: 'mic' }))).toBe('다른 기기')
    expect(listenShort('stream', listenNow('stream', MIC_OFF, { phase: 'reconnecting' }))).toBe('라이브')
    expect(listenShort(null, listenNow(null, MIC_OFF, null))).toBeNull()
  })

  it('서버 응답은 믿지 않고 읽는다', () => {
    expect(readListenSetting({ source: 'stream', streamAvailable: true, streamEnabled: true })).toEqual({ source: 'stream', streamAvailable: true, streamEnabled: true })
    expect(readListenSetting({ source: 'mic' })).toEqual({ source: 'mic', streamAvailable: false, streamEnabled: false })
    for (const body of [null, 'mic', {}, { source: 'web' }, { error: { code: 'NOT_FOUND' } }]) expect(readListenSetting(body)).toBeNull()
  })
})

/** 가짜 서버의 소리 듣기 설정 */
function listenServer(server: FakeServer, first: ListenSetting = BOTH) {
  const state = { setting: first, puts: [] as unknown[], refuse: null as { status: number; message: string } | null, down: false }
  server.on('GET', SOURCE, () => (state.down ? { network: true } : { body: state.setting }))
  server.on('PUT', SOURCE, (call) => {
    state.puts.push(call.body)
    if (state.refuse !== null) return { status: state.refuse.status, body: { error: { code: 'NOT_SUPPORTED', message: state.refuse.message } } }
    const source = call.body?.source === 'stream' ? 'stream' : 'mic'
    state.setting = { ...state.setting, source, ...(source === 'stream' ? { streamEnabled: true } : {}) }
    return { body: state.setting }
  })
  return state
}

describe('고른 듣는 곳 기억 (ListenSourceStore)', () => {
  it('모르면 한 번 읽고, 고르면 서버에 남기고, 못 읽으면 알던 값 그대로, 로그아웃이면 잊는다', async () => {
    const server = new FakeServer()
    server.install()
    const remote = listenServer(server)
    const store = new ListenSourceStore()
    let changes = 0
    store.subscribe(() => { changes++ })
    expect(store.get()).toBeNull()
    expect(await store.known()).toEqual(BOTH)
    expect(server.callsTo('GET', SOURCE)).toHaveLength(1)
    // 아는 값은 다시 묻지 않는다
    expect(await store.known()).toEqual(BOTH)
    expect(server.callsTo('GET', SOURCE)).toHaveLength(1)
    expect(changes).toBe(1)

    expect(await store.choose('stream')).toEqual({ ...BOTH, source: 'stream' })
    expect(remote.puts).toEqual([{ source: 'stream' }])
    expect(store.get()?.source).toBe('stream')
    expect(store.choseHere).toBe(true)

    // 서버에서 바뀌면(웹·다른 기기) 따라가고, 이 기기에서 고른 것이 아니게 된다
    remote.setting = { ...remote.setting, source: 'mic' }
    expect((await store.refresh())?.source).toBe('mic')
    expect(store.choseHere).toBe(false)

    remote.down = true
    expect((await store.refresh())?.source).toBe('mic')
    store.reset()
    expect(store.get()).toBeNull()
    expect(await store.known()).toBeNull()
  })

  it('서버가 거절하면 서버 문장으로, 닿지 못하면 "바꾸지 못했어요"로 알리고 값은 그대로다', async () => {
    const server = new FakeServer()
    server.install()
    const remote = listenServer(server)
    const store = new ListenSourceStore()
    await store.known()
    remote.refuse = { status: 409, message: '지금은 라이브 소리로 들을 수 없어요. 휴대폰 마이크를 골라 주세요.' }
    await expect(store.choose('stream')).rejects.toThrow('지금은 라이브 소리로 들을 수 없어요. 휴대폰 마이크를 골라 주세요.')
    expect(store.get()?.source).toBe('mic')
    server.on('PUT', SOURCE, () => ({ body: { ok: true } }))
    await expect(store.choose('stream')).rejects.toThrow('바꾸지 못했어요. 다시 눌러 주세요.')
    expect(store.get()?.source).toBe('mic')
  })
})

interface Opened { readonly world: ScreenWorld; readonly remote: ReturnType<typeof listenServer>; readonly stream: { phase: string; lagMs?: number } }

/** 방송 화면을 연다 — 서버의 라이브 소리 상태와 소리 듣기 설정을 준다 */
async function openConsole(first: ListenSetting = BOTH, phase = 'listening', before: (world: ScreenWorld) => void = () => undefined): Promise<Opened> {
  const saved = new Map<string, string>()
  configureVoiceStorage({ getItem: async (key) => saved.get(key) ?? null, setItem: async (key, value) => { saved.set(key, value) }, removeItem: async (key) => { saved.delete(key) } })
  const world = makeWorld()
  const stream: { phase: string; lagMs?: number } = { phase }
  world.server.on('GET', STATUS, () => ({ body: { ...stream } }))
  world.server.on('POST', WATCH, () => ({ body: { ...stream } }))
  world.server.on('POST', TICKET, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
  const remote = listenServer(world.server, first)
  before(world)
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  await waitFor(() => expect(world.services.streamKeep.listen.get()).not.toBeNull())
  await waitFor(() => expect(world.server.callsTo('GET', STATUS).length).toBeGreaterThan(0))
  await act(async () => { await flush() })
  return { world, remote, stream }
}

async function openManage(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
  return screen.findByRole('dialog', { name: '라이브 관리' })
}

/** 음성 창 오른쪽 끝 표시를 눌러 판을 연다 (라이브 관리 "소리 듣기" 줄은 없앴다 — D-LISTEN-MIC-01) */
async function openSheet(): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('region', { name: '음성 인식 창' })).getByTestId('listen-source-chip'))
  return screen.findByRole('dialog', { name: LISTEN_SOURCE_TITLE })
}

/** 이 휴대폰 마이크를 켠다 (처음 안내에 예) */
async function micOn(world: ScreenWorld): Promise<void> {
  await act(async () => {
    await world.services.voice.turnOn('b1', '저녁 라이브')
    await world.services.voice.acceptConsent()
    await flush()
  })
  expect(world.services.voice.getView().on).toBe(true)
}
/** 단추가 놓인 줄 (단추마다 같은 폭 칸에 싸여 있다 — ButtonRow) */
const rowOf = (button: HTMLElement): HTMLElement => button.parentElement!.parentElement!
const micStarts = (world: ScreenWorld): number => world.audio.starts.filter((start) => start.capture !== false).length
const nowLine = (sheet: HTMLElement): string => within(sheet).getByRole('status', { name: '지금 듣는 곳' }).textContent ?? ''

// D-LISTEN-MIC-01 (사용자 지시 2026-11-23 "소리 듣기 없애. 그냥 무조건 폰 마이크로 듣는 걸로")으로 바뀐 기대:
// 라이브 관리의 "소리 듣기" 줄과 판의 [휴대폰 마이크]·[라이브 소리] 고르기를 없앴다. 음성 창 표시를 누르면 여는 판은 지금 상태와 필요한 단추만.
// 옛 시험 "[라이브 소리]를 고르면 …"·"라이브 소리 듣기가 꺼져 있을 때 [라이브 소리]를 고르면 …"·"서버가 받아 주지 않으면 …"은 고르기가 없어져 뺐다.
describe('음성 인식 판 — 고르기 없이 휴대폰 마이크 (D-LISTEN-MIC-01)', () => {
  it('라이브 관리에 "소리 듣기" 줄이 없다', async () => {
    await openConsole(BOTH)
    const page = await openManage()
    expect(within(page).queryByTestId('listen-source')).toBeNull()
    expect(page.textContent).not.toContain('소리 듣기')
  })

  it('판: 제목·설명 · 지금 듣는 곳 · 고르기 없음. 마이크가 꺼져 있으면 [휴대폰 마이크 켜기]', async () => {
    const { world } = await openConsole(BOTH)
    expect(world.services.voice.getView().on).toBe(false)
    const sheet = await openSheet()
    expect(LISTEN_SOURCE_TITLE).toBe('음성 인식')
    expect(sheet.textContent).toContain('라이브에서 하는 말을 휴대폰 마이크로 들어요.')
    expect(nowLine(sheet)).toContain('마이크가 꺼져 있어 라이브 소리로 듣고 있어요')
    expect(within(sheet).queryAllByRole('radio')).toHaveLength(0)
    expect(within(within(sheet).getByTestId('sheet-actions')).getAllByRole('button').map((button) => button.textContent)).toEqual(['휴대폰 마이크 켜기'])
  })

  it('마이크 권한이 없으면 "마이크 권한이 없어 …"라고 말한다', async () => {
    const { world } = await openConsole(BOTH)
    Object.assign(world.audio, { canResume: async () => false })
    const sheet = await openSheet()
    await waitFor(() => expect(nowLine(sheet)).toContain('마이크 권한이 없어 라이브 소리로 듣고 있어요'))
  })

  it('[휴대폰 마이크 켜기]: 처음이면 판 안에서 안내 — 왼쪽 [안 켤래요] · 오른쪽 [알겠어요, 켤게요] 한 줄 — 예를 누르면 마이크를 켠다', async () => {
    const { world } = await openConsole(BOTH)
    const sheet = await openSheet()
    const before = micStarts(world)
    await act(async () => { fireEvent.click(within(within(sheet).getByTestId('sheet-actions')).getByRole('button', { name: '휴대폰 마이크 켜기' })); await flush() })
    const guide = await within(sheet).findByRole('group', { name: '음성 안내' })
    for (const line of VOICE_CONSENT_LINES) expect(guide.textContent).toContain(line)
    const buttons = within(within(sheet).getByTestId('sheet-actions')).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['안 켤래요', '알겠어요, 켤게요'])
    // 단추 둘은 위아래가 아니라 좌우 한 줄 (절대 규칙 8)
    expect(getComputedStyle(rowOf(buttons[0]!)).flexDirection).toBe('row')
    expect(rowOf(buttons[0]!)).toBe(rowOf(buttons[1]!))
    expect(micStarts(world)).toBe(before)
    await act(async () => { fireEvent.click(buttons[1]!); await flush() })
    await waitFor(() => expect(micStarts(world)).toBe(before + 1))
    await waitFor(() => expect(nowLine(sheet)).toContain('휴대폰 마이크로 듣고 있어요'))
  })

  it('안내에 [안 켤래요]면 마이크를 켜지 않고 "마이크가 꺼져 있어 …"와 [휴대폰 마이크 켜기]를 보인다', async () => {
    const { world } = await openConsole(BOTH)
    const sheet = await openSheet()
    const before = micStarts(world)
    await act(async () => { fireEvent.click(within(within(sheet).getByTestId('sheet-actions')).getByRole('button', { name: '휴대폰 마이크 켜기' })); await flush() })
    await act(async () => { fireEvent.click(within(await within(sheet).findByTestId('sheet-actions')).getByRole('button', { name: '안 켤래요' })); await flush() })
    expect(micStarts(world)).toBe(before)
    expect(world.services.streamKeep.listen.get()?.source).toBe('mic')
    await waitFor(() => expect(nowLine(sheet)).toContain('마이크가 꺼져 있어 라이브 소리로 듣고 있어요'))
    expect(within(within(sheet).getByTestId('sheet-actions')).getByRole('button', { name: '휴대폰 마이크 켜기' })).toBeTruthy()
  })

  it('라이브 소리 듣기가 멈췄고 마이크도 꺼져 있으면 단추 둘을 좌우 한 줄로 — [라이브 소리 다시 켜기] · [휴대폰 마이크 켜기]', async () => {
    const { world } = await openConsole(BOTH, 'stopped')
    world.server.on('POST', /^\/api\/broadcasts\/b1\/stream-audio\/restart$/, () => ({ body: { phase: 'idle' } }))
    const sheet = await openSheet()
    expect(nowLine(sheet)).toContain('마이크가 꺼져 있어 라이브 소리 듣기가 멈췄어요')
    const buttons = within(within(sheet).getByTestId('sheet-actions')).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['라이브 소리 다시 켜기', '휴대폰 마이크 켜기'])
    expect(getComputedStyle(rowOf(buttons[0]!)).flexDirection).toBe('row')
    expect(rowOf(buttons[0]!)).toBe(rowOf(buttons[1]!))
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(world.server.callsTo('POST', /stream-audio\/restart$/)).toHaveLength(1))
  })

  it('마이크가 꺼진 동안 대신 듣는 라이브 소리가 30초 넘게 늦으면 판에 늦음 한 줄', async () => {
    const { stream } = await openConsole(BOTH)
    stream.lagMs = 45_000
    const sheet = await openSheet()
    await waitFor(() => expect(sheet.textContent).toContain(STREAM_AUDIO_LATE), { timeout: 3_000 })
  })
})

describe('방송 화면 음성 창의 표시 (D-RETRO-72)', () => {
  it('음성 창 오른쪽 끝에 지금 듣는 쪽 낱말 — 누르면 같은 판이 열리고, 펼치는 줄과는 따로 눌린다', async () => {
    const { world } = await openConsole(BOTH)
    const dock = screen.getByRole('region', { name: '음성 인식 창' })
    const chip = within(dock).getByTestId('listen-source-chip')
    expect(chip.textContent).toBe('라이브 ›')
    expect(chip.getAttribute('aria-label')).toBe('음성 인식 · 마이크가 꺼져 있어 라이브 소리로 듣고 있어요')
    // 누르는 칸 안에 누르는 칸을 넣지 않았다
    const expand = within(dock).getByRole('button', { name: '음성 인식 펼치기' })
    expect(expand.contains(chip)).toBe(false)
    fireEvent.click(chip)
    const sheet = await screen.findByRole('dialog', { name: LISTEN_SOURCE_TITLE })
    expect(within(dock).getByRole('button', { name: '음성 인식 펼치기' })).toBeTruthy()
    expect(nowLine(sheet)).toContain('마이크가 꺼져 있어 라이브 소리로 듣고 있어요')
    // 고르기는 없앴다 (D-LISTEN-MIC-01)
    expect(within(sheet).queryAllByRole('radio')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: LISTEN_SOURCE_TITLE })).toBeNull())

    await micOn(world)
    await waitFor(() => expect(within(dock).getByTestId('listen-source-chip').textContent).toBe('마이크 ›'))
    expect(within(dock).getByTestId('listen-source-chip').getAttribute('aria-label')).toBe('음성 인식 · 휴대폰 마이크로 듣고 있어요')
  })

  it('서버가 소리 듣기 설정을 모르면(옛 서버) 고른 값 없이 실제로 듣는 쪽만 표시하고, 음성 창의 펼치기는 예전 그대로다', async () => {
    const world = makeWorld()
    world.server.on('GET', STATUS, () => ({ body: { phase: 'listening' } }))
    world.server.on('POST', WATCH, () => ({ body: { phase: 'listening' } }))
    world.server.on('POST', TICKET, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => { world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }]); await flush() })
    await waitFor(() => expect(world.server.callsTo('GET', SOURCE).length).toBeGreaterThan(0))
    await act(async () => { await flush() })
    const dock = screen.getByRole('region', { name: '음성 인식 창' })
    expect(world.services.streamKeep.listen.get()).toBeNull()
    // 고른 값을 몰라도 서버가 라이브 소리로 듣는 중인 것은 안다 — 까닭("마이크가 꺼져 있어")은 붙이지 않는다
    await waitFor(() => expect(within(dock).getByTestId('listen-source-chip').getAttribute('aria-label')).toBe('음성 인식 · 라이브 소리로 듣고 있어요'))
    expect(within(dock).getByTestId('listen-source-chip').textContent).toBe('라이브 ›')
    fireEvent.click(within(dock).getByRole('button', { name: '음성 인식 펼치기' }))
    expect(await within(dock).findByRole('button', { name: '음성 인식 접기' })).toBeTruthy()
    // 표시를 눌러도 펼친 창은 그대로 — 따로 눌린다
    expect(screen.queryByRole('dialog', { name: LISTEN_SOURCE_TITLE })).toBeNull()
  })
})

describe('고른 대로 이 휴대폰 마이크가 따른다 (D-RETRO-70)', () => {
  it(`웹·다른 기기에서 라이브 소리로 바꾸면 다음 읽기(${String(LISTEN_SOURCE_POLL_MS / 1000)}초마다)에 이 휴대폰 마이크를 끈다`, async () => {
    expect(LISTEN_SOURCE_POLL_MS).toBeLessThanOrEqual(5000)
    const { world, remote } = await openConsole(BOTH, 'mic')
    await micOn(world)
    remote.setting = { ...remote.setting, source: 'stream' }
    await act(async () => { await world.services.streamKeep.listen.refresh(); await flush() })
    await waitFor(() => expect(world.services.voice.getView().on).toBe(false))
    expect(remote.puts).toEqual([])
  })

  it('웹·다른 기기에서 휴대폰 마이크로 바꾸면 안내 창을 띄우지 않고, 이 기기가 켤 수 있을 때만 켜 본다', async () => {
    const { world, remote } = await openConsole({ ...BOTH, source: 'stream' })
    const prefer = vi.spyOn(world.services.voice, 'preferMic')
    remote.setting = { ...remote.setting, source: 'mic' }
    await act(async () => { await world.services.streamKeep.listen.refresh(); await flush() })
    await waitFor(() => expect(prefer).toHaveBeenCalledWith('b1', expect.any(String)))
    expect(world.services.voice.getView().askConsent).toBe(false)
  })

  it('라이브 소리를 골라 두었으면 방송 화면을 열어도 휴대폰 마이크를 저절로 켜지 않는다', async () => {
    let resume: ReturnType<typeof vi.spyOn> | null = null
    const { world } = await openConsole({ ...BOTH, source: 'stream' }, 'listening', (made) => { resume = vi.spyOn(made.services.voice, 'resumeIfConsented') })
    expect(world.server.callsTo('GET', SOURCE).length).toBeGreaterThan(0)
    await act(async () => { await flush(); await flush() })
    expect(resume).not.toBeNull()
    expect(resume).not.toHaveBeenCalled()
    expect(micStarts(world)).toBe(0)
  })

  it('휴대폰 마이크를 골라 두었으면(처음 값) 방송 화면을 열 때 예전처럼 마이크를 켜 본다', async () => {
    let resume: ReturnType<typeof vi.spyOn> | null = null
    await openConsole(BOTH, 'listening', (made) => { resume = vi.spyOn(made.services.voice, 'resumeIfConsented') })
    await waitFor(() => expect(resume).toHaveBeenCalledWith('b1', expect.any(String)))
  })

  it('서버가 설정을 모르면(옛 서버·닿지 않음) 예전처럼 마이크를 켜 본다', async () => {
    const world = makeWorld()
    const resume = vi.spyOn(world.services.voice, 'resumeIfConsented')
    world.server.on('GET', STATUS, () => ({ body: { phase: 'listening' } }))
    world.server.on('POST', WATCH, () => ({ body: { phase: 'listening' } }))
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => { world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }]); await flush() })
    await waitFor(() => expect(resume).toHaveBeenCalledWith('b1', expect.any(String)))
  })
})

describe('아이폰·갤럭시 같은 코드, 네이티브는 그대로', () => {
  it('소리 듣기 코드에 플랫폼 분기가 없다', () => {
    for (const file of ['src/lib/listen-source.ts', 'src/screens/console/ListenSource.tsx']) {
      const text = readFileSync(join(import.meta.dirname, '..', file), 'utf8')
      expect(text, file).not.toMatch(/Platform\.(OS|select)/)
    }
  })
})
