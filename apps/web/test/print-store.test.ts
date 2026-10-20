// 출력 기록 저장소 (AC-I1-15·24·30, dev-notes "실시간"): 연결을 먼저 열고 조회, 오래된 판(rev)의 알림은 버리고, 판이 뛰면 다시 받는다.
// 바뀐 작업만 덮는다(대기열 전체를 다시 받지 않는다). 라벨 상태는 보는 날짜만, 그 날짜의 change 알림이면 다시 받는다(재출력 필요).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabelView, PrintOverview } from '../src/api/print-types.ts'
import { PrintStore, mergeActiveJobs, mergeDiscardJobs } from '../src/lib/print-store.ts'
import { device, job, labelView, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

let server: FakeServer
let current: PrintOverview
let store: PrintStore | null = null

beforeEach(() => {
  server = new FakeServer()
  current = overview({ queue: queue({ rev: 5, waiting: 1 }), jobs: [job('j1')] })
  server
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: false } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?date=/, () => ({ body: { date: DATE, labels: [labelView('c1@1', { state: 'PRINTED', word: '라벨 출력됨', printed: 1 })] } }))
  vi.stubGlobal('fetch', server.fetch)
  FakeEventSource.reset()
})

afterEach(() => {
  store?.stop()
  store = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function started(): Promise<PrintStore> {
  store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream?device=dev-1234') })
  store.start()
  await flush()
  return store
}

const printCalls = () => server.callsTo('GET', /^\/api\/print$/).length
const notify = (data: unknown) => FakeEventSource.last.emit('print', data)

describe('목록 덮기', () => {
  it('출력 중 먼저, 새 대기는 맨 끝, 출력 중에서 대기로 돌아온 작업은 대기 맨 앞, 출력함·출력 안 함은 빠진다', () => {
    const list = [job('a', { status: 'PRINTING' }), job('b'), job('c')]
    expect(mergeActiveJobs(list, [job('d')]).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(mergeActiveJobs(list, [job('a', { status: 'WAITING', attempts: 1 })]).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(mergeActiveJobs(list, [job('a', { status: 'DONE' }), job('b', { status: 'PRINTING' })]).map((item) => `${item.id}:${item.status}`)).toEqual(['b:PRINTING', 'c:WAITING'])
    expect(mergeActiveJobs(list, [job('c', { status: 'CANCELLED' })]).map((item) => item.id)).toEqual(['a', 'b'])
    // 같은 ID라도 날짜(범위)가 다르면 다른 작업이다
    expect(mergeActiveJobs([job('a')], [job('a', { date: '2026-10-20' })])).toHaveLength(2)
  })

  it('버릴 라벨: 버릴 라벨이면 더하고 아니면(버렸어요) 뺀다', () => {
    const discard = job('x', { status: 'DONE', voided: true, discard: true, word: '폐기 — 버려 주세요' })
    expect(mergeDiscardJobs([], [discard, job('y')]).map((item) => item.id)).toEqual(['x'])
    expect(mergeDiscardJobs([discard], [{ ...discard, discard: false, word: '폐기' }])).toEqual([])
  })
})

describe('실시간 (AC-I1-15)', () => {
  it('처음: 연결을 먼저 열고(기기 ID를 밝힌 연결) 대기열·라벨 설정·화면 설정을 한 번씩 받는다', async () => {
    const s = await started()
    expect(FakeEventSource.last.url).toBe('/api/stream?device=dev-1234')
    expect(s.getSnapshot()).toMatchObject({ phase: 'ready', config: { testPrinter: false } })
    expect(s.getSnapshot().overview?.queue.rev).toBe(5)
    expect(s.getSnapshot().templates?.product.version).toBe(0)
    expect(printCalls()).toBe(1)
  })

  it('조회보다 오래된 판의 알림은 버리고, 다음 판은 바뀐 작업만 덮는다 — 대기열 전체를 다시 받지 않는다', async () => {
    const s = await started()
    notify({ rev: 4, queue: queue({ rev: 4, waiting: 9 }), jobs: [job('old')], labels: [] })
    expect(s.getSnapshot().overview?.queue.waiting).toBe(1)
    notify({ rev: 6, queue: queue({ rev: 6, waiting: 2 }), jobs: [job('j2')], labels: [] })
    expect(s.getSnapshot().overview?.queue).toMatchObject({ rev: 6, waiting: 2 })
    expect(s.getSnapshot().overview?.jobs.map((item) => item.id)).toEqual(['j1', 'j2'])
    // 같은 판(한 조회 뒤 알림 둘이 같은 요약을 읽음)도 덮는다 — 작업은 다를 수 있다
    notify({ rev: 6, queue: queue({ rev: 6, waiting: 2 }), jobs: [job('j1', { status: 'PRINTING', word: '출력 중' })], labels: [] })
    expect(s.getSnapshot().overview?.jobs.map((item) => `${item.id}:${item.status}`)).toEqual(['j1:PRINTING', 'j2:WAITING'])
    await flush()
    expect(printCalls()).toBe(1)
  })

  it('판이 둘 이상 뛰면(놓쳤을 수 있다) 조금 뒤 전체를 다시 받는다', async () => {
    const s = await started()
    current = overview({ queue: queue({ rev: 9, waiting: 0 }) })
    notify({ rev: 8, queue: queue({ rev: 8 }), jobs: [], labels: [] })
    await vi.waitFor(() => expect(printCalls()).toBe(2), { timeout: 2000 })
    await vi.waitFor(() => expect(s.getSnapshot().overview?.queue.rev).toBe(9))
  })

  it('처음 조회가 끝나기 전에 온 알림은 모아 두었다가 조회 뒤 덮는다', async () => {
    let release: () => void = () => {}
    server.on('GET', /^\/api\/print$/, () => new Promise((resolve) => (release = () => resolve({ body: current }))))
    store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
    store.start()
    await flush()
    notify({ rev: 6, queue: queue({ rev: 6, discard: 1 }), jobs: [job('d1', { status: 'DONE', voided: true, discard: true })], labels: [] })
    expect(store.getSnapshot().overview).toBeNull()
    release()
    await flush()
    expect(store.getSnapshot().overview?.queue).toMatchObject({ rev: 6, discard: 1 })
    expect(store.getSnapshot().overview?.discard.map((item) => item.id)).toEqual(['d1'])
  })

  it('다시 붙으면(ready) 대기열을 다시 받는다 — 끊긴 사이의 알림은 seq가 없다', async () => {
    await started()
    FakeEventSource.last.emit('ready', { scopes: [] })
    await flush()
    expect(printCalls()).toBe(2)
  })

  it('라벨 설정 알림이면 라벨 설정을 다시 받는다', async () => {
    await started()
    notify({ template: { kind: 'product', version: 3 } })
    await flush()
    expect(server.callsTo('GET', /^\/api\/print\/templates$/)).toHaveLength(2)
  })
})

describe('라벨 상태 (AC-I1-12·30)', () => {
  it('보는 날짜만 받고, 알림의 라벨 키는 덮고, 그 날짜(실제 범위)의 change면 다시 받는다 — 리허설·채팅·문자찜 change는 무시', async () => {
    const s = await started()
    const seen = vi.fn()
    const stop = s.watchLabels(DATE, seen)
    await flush()
    expect(s.labelsSnapshot(DATE).labels.get('c1@1')?.word).toBe('라벨 출력됨')
    notify({ rev: 6, queue: queue({ rev: 6 }), jobs: [], labels: [labelView('c1@1', { state: 'REPRINT_NEEDED', word: '재출력 필요' })] })
    expect(s.labelsSnapshot(DATE).labels.get('c1@1')?.word).toBe('재출력 필요')
    const labelCalls = () => server.callsTo('GET', /^\/api\/print\/labels/).length
    expect(labelCalls()).toBe(1)
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: true, seq: 9, type: 'product.update' })
    // 채팅·문자찜은 품종·가격을 바꾸지 않는다 (1등이 바뀌면 작업·폐기가 print 알림으로 온다)
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 8, type: 'chat' })
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 8, type: 'sms' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(labelCalls()).toBe(1)
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 9, type: 'product.update' })
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 10, type: 'product.update' })
    await vi.waitFor(() => expect(labelCalls()).toBe(2), { timeout: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(labelCalls()).toBe(2)
    stop()
    expect(seen).toHaveBeenCalled()
  })

  it('느린 망 (TE-I1-001): 조회를 보낸 뒤 받은 print 알림의 라벨이 늦게 온 응답에 덮이지 않는다 — 다시 받기·처음 받기·오래된 판 알림 모두', async () => {
    // 응답은 보낸 때의 서버 상태(출력 중)이고, 손으로 풀 때까지 오지 않는다
    const pending: (() => void)[] = []
    let state: Partial<LabelView> = { state: 'PRINTING', word: '출력 중', printed: 0 }
    server.on('GET', /^\/api\/print\/labels\?date=/, () => {
      const body = { date: DATE, labels: [labelView('c1@1', state), labelView('c2@1', { state: 'WAITING', word: '라벨 대기' })] }
      return new Promise((resolve) => pending.push(() => resolve({ body })))
    })
    const s = await started()
    const seen = vi.fn()
    s.watchLabels(DATE, seen)
    await flush()
    expect(s.labelsSnapshot(DATE).phase).toBe('loading')
    // 처음 조회가 도는 사이 출력함 알림 — 아직 보일 것이 없어도 기억했다가 응답 위에 덮는다
    notify({ rev: 6, queue: queue({ rev: 6 }), jobs: [], labels: [labelView('c1@1', { state: 'PRINTED', word: '라벨 출력됨', printed: 1 })] })
    pending.shift()?.()
    await vi.waitFor(() => expect(s.labelsSnapshot(DATE).phase).toBe('ready'))
    expect(s.labelsSnapshot(DATE).labels.get('c1@1')?.word).toBe('라벨 출력됨')
    expect(s.labelsSnapshot(DATE).labels.get('c2@1')?.word).toBe('라벨 대기')

    // 조치 뒤 다시 받기: 보낸 뒤 c2가 출력 중 → 출력함 (응답은 보낸 때의 "라벨 대기")
    state = { state: 'PRINTED', word: '라벨 출력됨', printed: 1 }
    s.refreshLabels(DATE)
    await flush()
    notify({ rev: 7, queue: queue({ rev: 7 }), jobs: [], labels: [labelView('c2@1', { state: 'PRINTING', word: '출력 중' })] })
    notify({ rev: 8, queue: queue({ rev: 8 }), jobs: [], labels: [labelView('c2@1', { state: 'PRINTED', word: '라벨 출력됨', printed: 1 })] })
    expect(s.labelsSnapshot(DATE).labels.get('c2@1')?.word).toBe('라벨 출력됨')
    pending.shift()?.()
    await vi.waitFor(() => expect(server.callsTo('GET', /^\/api\/print\/labels/)).toHaveLength(2))
    await flush()
    expect(s.labelsSnapshot(DATE).labels.get('c2@1')?.word).toBe('라벨 출력됨')
    expect(s.labelsSnapshot(DATE).labels.get('c1@1')?.word).toBe('라벨 출력됨')

    // 다음 조회는 그 알림을 다시 덮지 않는다 (응답이 더 새것 — 재출력 필요는 print 알림 없이 바뀐다)
    s.refreshLabels(DATE)
    await flush()
    pending.shift()?.()
    await flush()
    expect(s.labelsSnapshot(DATE).labels.get('c2@1')?.word).toBe('라벨 대기')

    // 대기열은 버리는 오래된 판의 알림이라도 라벨은 덮는다
    notify({ rev: 3, queue: queue({ rev: 3, waiting: 9 }), jobs: [], labels: [labelView('c2@1', { state: 'PRINTED', word: '라벨 출력됨', printed: 1 })] })
    expect(s.getSnapshot().overview?.queue.waiting).not.toBe(9)
    expect(s.labelsSnapshot(DATE).labels.get('c2@1')?.word).toBe('라벨 출력됨')
    expect(seen).toHaveBeenCalled()
  })

  it('보는 화면의 1등 라벨 키가 없으면 한 번 다시 받는다 (자동 출력 끔 — 문자찜·채팅으로 생긴 1등은 print 알림이 없다, AC-I1-31·TE-I1-005) — 키마다 한 번, 처음 조회 전에는 묻지 않는다', async () => {
    let labels: LabelView[] = [labelView('c1@1')]
    server.on('GET', /^\/api\/print\/labels\?date=/, () => ({ body: { date: DATE, labels } }))
    const s = await started()
    const calls = () => server.callsTo('GET', /^\/api\/print\/labels/).length
    // 보지 않는 날짜·처음 조회 전: 아무것도 하지 않는다
    s.ensureLabels(DATE, ['c2@1'])
    s.watchLabels(DATE, () => {})
    s.ensureLabels(DATE, ['c2@1'])
    await vi.waitFor(() => expect(s.labelsSnapshot(DATE).phase).toBe('ready'))
    await flush()
    expect(calls()).toBe(1)
    // 문자찜 기록 change로는 다시 받지 않는다 (채팅마다 다시 받지 않음)
    labels = [labelView('c1@1'), labelView('c2@1', { no: 16 })]
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 4, type: 'sms' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(calls()).toBe(1)
    // 있는 키만이면 다시 받지 않는다
    s.ensureLabels(DATE, ['c1@1'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(calls()).toBe(1)
    // 없는 키 → 한 번 다시 받는다 (같은 키를 거듭 물어도 한 번)
    s.ensureLabels(DATE, ['c1@1', 'c2@1'])
    s.ensureLabels(DATE, ['c2@1'])
    await vi.waitFor(() => expect(s.labelsSnapshot(DATE).labels.has('c2@1')).toBe(true))
    expect(s.labelsSnapshot(DATE).labels.get('c2@1')?.data).not.toBeNull()
    expect(calls()).toBe(2)
    // 다시 받아도 없는 키는 더 묻지 않는다 (서버가 1등으로 보지 않는다 — 거듭 받지 않는다)
    s.ensureLabels(DATE, ['c9@1'])
    await vi.waitFor(() => expect(calls()).toBe(3))
    s.ensureLabels(DATE, ['c9@1'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(calls()).toBe(3)
  })

  it('없는 범위는 missing', async () => {
    server.on('GET', /^\/api\/print\/labels\?date=/, () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } } }))
    const s = await started()
    s.watchLabels('2026-01-01', () => {})
    await flush()
    expect(s.labelsSnapshot('2026-01-01').phase).toBe('missing')
  })
})

describe('조치 응답', () => {
  it('응답의 대기열 요약·작업을 바로 덮는다 (알림을 기다리지 않는다)', async () => {
    server.on('POST', /^\/api\/print\/jobs\/cancel$/, () => ({ body: { job: job('j1', { status: 'CANCELLED', word: '출력 안 함' }) } }))
    server.on('POST', /^\/api\/print\/pause$/, () => ({ body: { queue: queue({ rev: 7, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: false } }) } }))
    const s = await started()
    await s.act('/api/print/jobs/cancel', { date: DATE, id: 'j1' })
    expect(s.getSnapshot().overview?.jobs).toEqual([])
    await s.act('/api/print/pause', {})
    expect(s.getSnapshot().overview?.queue.pause?.message).toBe('출력을 멈췄어요.')
    expect(device('x').name).toBe('PC')
  })
})
