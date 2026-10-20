// 라벨 기능 켬/끔 — 출력 기록 저장소 (N4a, LABEL_RULES L-12, dev-notes "dev-server > 바뀐 계약" 1~3, AC-N4a-02·12·18·20):
// 켬/끔의 원천은 대기열 요약의 labelsEnabled(처음 GET /api/print 한 번), 모르면 null. labels 알림은 바로 덮고, 설정 화면이 보는 동안은 바꾼 기록도 받는다.
// 라벨 요청이 LABELS_OFF로 거절되면 그 문장을 남기고 꺼진 것으로 덮은 뒤 다시 받는다(저절로 다시 보내지 않는다).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabelSettings, LabelSwitchEntry, PrintOverview } from '../src/api/print-types.ts'
import { PrintStore, labelsEnabledOf } from '../src/lib/print-store.ts'
import { overview, queue, templates } from './print-support.ts'
import { FakeEventSource, FakeServer, apiError, flush } from './support.ts'

let server: FakeServer
let current: PrintOverview
let settings: LabelSettings
let store: PrintStore | null = null

const entry = (enabled: boolean, at = '2026-10-20T11:31:00.000Z'): LabelSwitchEntry => ({ enabled, at, loginId: 'shop1' })

beforeEach(() => {
  server = new FakeServer()
  current = overview({ queue: queue({ rev: 5 }) })
  settings = { enabled: true, history: [], waiting: 0, rev: 5 }
  server
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: false } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/settings\/labels$/, () => ({ body: settings }))
  vi.stubGlobal('fetch', server.fetch)
  FakeEventSource.reset()
})

afterEach(() => {
  store?.stop()
  store = null
  vi.unstubAllGlobals()
})

async function started(): Promise<PrintStore> {
  store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream?device=dev-1234') })
  store.start()
  await flush()
  return store
}

const printCalls = () => server.callsTo('GET', /^\/api\/print$/).length

describe('켬/끔 알기 (AC-N4a-02·18)', () => {
  it('처음 GET /api/print 한 번으로 안다 — 조회 전·옛 응답(칸 없음)·불러오지 못함은 모름(null)', async () => {
    expect(labelsEnabledOf({ overview: null })).toBeNull()
    expect(labelsEnabledOf({ overview: { ...overview(), queue: { ...queue(), labelsEnabled: undefined as unknown as boolean } } })).toBeNull()
    current = overview({ queue: queue({ rev: 5, labelsEnabled: false }) })
    const s = await started()
    expect(s.labelsEnabled).toBe(false)
    expect(server.callsTo('GET', /^\/api\/settings\/labels$/)).toHaveLength(0) // 설정 화면이 보지 않으면 바꾼 기록은 받지 않는다
  })

  it('불러오지 못하면 모른다', async () => {
    server.on('GET', /^\/api\/print$/, () => apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.'))
    const s = await started()
    expect(s.labelsEnabled).toBeNull()
  })

  it('labels 알림은 바로 덮고(판도 올린다), 뒤따르는 같은 판의 print 알림도 받는다. 그보다 오래된 판의 늦은 조회는 켬/끔을 되돌리지 않는다', async () => {
    const s = await started()
    expect(s.labelsEnabled).toBe(true)
    FakeEventSource.last.emit('labels', { rev: 6, enabled: false, entry: entry(false) })
    expect(s.labelsEnabled).toBe(false)
    expect(s.queue?.rev).toBe(6)
    FakeEventSource.last.emit('print', { rev: 6, queue: queue({ rev: 6, labelsEnabled: false, waiting: 2 }), jobs: [], labels: [] })
    expect(s.queue?.waiting).toBe(2)
    // 끄기 전에 보낸 조회의 늦은 응답(판 5, 켬)
    current = overview({ queue: queue({ rev: 5, labelsEnabled: true }) })
    await s.reload()
    expect(s.labelsEnabled).toBe(false)
  })

  it('labels 알림의 판이 둘 이상 뛰면 놓친 것을 다시 받는다', async () => {
    const s = await started()
    const before = printCalls()
    current = overview({ queue: queue({ rev: 9, labelsEnabled: false }) })
    FakeEventSource.last.emit('labels', { rev: 9, enabled: false, entry: entry(false) })
    expect(s.labelsEnabled).toBe(false)
    await vi.waitFor(() => expect(printCalls()).toBe(before + 1))
  })
})

describe('LABELS_OFF 거절 (AC-N4a-20)', () => {
  it('오래된 화면의 라벨 요청이 거절되면 그 문장을 남기고 꺼진 것으로 덮은 뒤 다시 받는다 — 같은 요청을 다시 보내지 않는다', async () => {
    const s = await started()
    server.on('POST', /^\/api\/print\/restart$/, () => apiError(409, 'LABELS_OFF', '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.'))
    current = overview({ queue: queue({ rev: 7, labelsEnabled: false }) })
    const before = printCalls()
    await expect(s.act('/api/print/restart', {})).rejects.toMatchObject({ code: 'LABELS_OFF' })
    expect(s.labelsEnabled).toBe(false)
    expect(s.getSnapshot().labelsRefusal).toBe('라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.')
    await vi.waitFor(() => expect(printCalls()).toBe(before + 1))
    expect(server.callsTo('POST', /^\/api\/print\/restart$/)).toHaveLength(1)
    // 다른 화면으로 옮기면 지운다 · 켜지면 지운다
    s.clearRefusal('라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.')
    expect(s.getSnapshot().labelsRefusal).toBeNull()
  })

  it('켜지면 거절 문장은 지난 일이다', async () => {
    const s = await started()
    server.on('POST', /^\/api\/print\/labels\/print$/, () => apiError(409, 'LABELS_OFF', '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.'))
    current = overview({ queue: queue({ rev: 7, labelsEnabled: false }) })
    await expect(s.act('/api/print/labels/print', {})).rejects.toBeTruthy()
    await flush()
    expect(s.getSnapshot().labelsRefusal).not.toBeNull()
    FakeEventSource.last.emit('labels', { rev: 8, enabled: true, entry: entry(true) })
    expect(s.labelsEnabled).toBe(true)
    expect(s.getSnapshot().labelsRefusal).toBeNull()
  })

  it('다른 거절은 켬/끔을 건드리지 않는다', async () => {
    const s = await started()
    server.on('POST', /^\/api\/print\/restart$/, () => apiError(409, 'PRINT_NOT_PAUSED', '출력이 멈추지 않았어요.'))
    await expect(s.act('/api/print/restart', {})).rejects.toBeTruthy()
    expect(s.labelsEnabled).toBe(true)
    expect(s.getSnapshot().labelsRefusal ?? null).toBeNull()
  })

  it('출력 기기의 받기 거절(noteLabelsOff)은 꺼진 것으로 덮지만 문장은 남기지 않는다', async () => {
    const s = await started()
    s.noteLabelsOff()
    expect(s.labelsEnabled).toBe(false)
    expect(s.getSnapshot().labelsRefusal ?? null).toBeNull()
  })
})

describe('설정 화면의 설정·바꾼 기록 (AC-N4a-02·11·12)', () => {
  it('보는 동안만 받고, labels 알림이면 바꾼 기록 맨 앞에 그 줄 — 20줄까지, 오래된 판의 알림은 버린다', async () => {
    settings = { enabled: true, history: Array.from({ length: 20 }, (_, i) => entry(i % 2 === 0, `2026-10-19T0${String(i % 10)}:00:00.000Z`)), waiting: 0, rev: 5 }
    const s = await started()
    const seen = vi.fn()
    const stop = s.watchLabelSettings(seen)
    await vi.waitFor(() => expect(s.labelSettingsSnapshot().phase).toBe('ready'))
    FakeEventSource.last.emit('labels', { rev: 6, enabled: false, entry: entry(false) })
    const after = s.labelSettingsSnapshot().settings
    expect(after?.enabled).toBe(false)
    expect(after?.history).toHaveLength(20)
    expect(after?.history[0]).toEqual(entry(false))
    // 같은 판을 다시 받아도(되풀이) 한 줄만
    FakeEventSource.last.emit('labels', { rev: 6, enabled: false, entry: entry(false) })
    expect(s.labelSettingsSnapshot().settings?.history.filter((item) => item.at === '2026-10-20T11:31:00.000Z')).toHaveLength(1)
    stop()
    expect(s.labelSettingsSnapshot().phase).toBe('loading')
  })

  it('켜기·끄기(PUT)는 저장된 응답으로 설정과 대기열 요약의 켬/끔을 함께 덮는다 — 실패하면 아무것도 바꾸지 않는다', async () => {
    const s = await started()
    s.watchLabelSettings(() => {})
    await vi.waitFor(() => expect(s.labelSettingsSnapshot().phase).toBe('ready'))
    server.on('PUT', /^\/api\/settings\/labels$/, () => apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.'))
    await expect(s.saveLabelsEnabled(false)).rejects.toBeTruthy()
    expect(s.labelsEnabled).toBe(true)
    expect(s.labelSettingsSnapshot().settings?.enabled).toBe(true)
    server.on('PUT', /^\/api\/settings\/labels$/, (call) => ({ body: { enabled: call.body?.['enabled'], history: [entry(false)], waiting: 0, rev: 6, changed: true } }))
    const result = await s.saveLabelsEnabled(false)
    expect(result.changed).toBe(true)
    expect(server.callsTo('PUT', /^\/api\/settings\/labels$/).at(-1)?.body).toEqual({ enabled: false })
    expect(s.labelsEnabled).toBe(false)
    expect(s.labelSettingsSnapshot().settings).toEqual({ enabled: false, history: [entry(false)], waiting: 0, rev: 6 })
  })

  it('조회 중에 온 labels 알림은 조회가 끝난 뒤 한 번 더 받는다 (늦은 응답이 그 줄을 빠뜨리지 않게)', async () => {
    const s = await started()
    let release: (() => void) | null = null
    server.on('GET', /^\/api\/settings\/labels$/, async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { body: settings }
    })
    s.watchLabelSettings(() => {})
    await flush()
    FakeEventSource.last.emit('labels', { rev: 6, enabled: false, entry: entry(false) })
    settings = { enabled: false, history: [entry(false)], waiting: 0, rev: 6 }
    ;(release as (() => void) | null)?.()
    await vi.waitFor(() => expect(server.callsTo('GET', /^\/api\/settings\/labels$/)).toHaveLength(2))
    ;(release as (() => void) | null)?.()
    await vi.waitFor(() => expect(s.labelSettingsSnapshot().settings?.enabled).toBe(false))
  })
})
