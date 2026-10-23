// 실시간 구독·따라잡기·재연결 (AC-S05-62, D-085): 처음 한 번 전체 조회, 그 뒤 알림마다 증분 조회만.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleStore, INITIAL_MESSAGES, mergeMessages, retryDelayMs } from '../src/lib/console-store.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, emptyChanges, flush, fullView, message, product } from './support.ts'

let server: FakeServer
let changesSeq: number
let store: ConsoleStore | null = null

beforeEach(() => {
  server = new FakeServer()
  changesSeq = 5
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem(), broadcastItem({ id: 'r1', rehearsal: true })] } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: fullView({ seq: 5, products: [product(15)] }) }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 5, messages: [message(3), message(4)], more: true } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => {
      const since = Number(match[1])
      return { body: { ...emptyChanges(since, changesSeq), products: [product(15, { name: '바뀜' })], messages: [message(changesSeq, { id: `n${String(changesSeq)}` })] } }
    })
  vi.stubGlobal('fetch', server.fetch)
  FakeEventSource.reset()
})

afterEach(() => {
  store?.stop()
  store = null
  vi.unstubAllGlobals()
})

async function started(id = 'b1'): Promise<ConsoleStore> {
  store = new ConsoleStore({ broadcastId: id, openStream: (url) => new FakeEventSource(url) })
  await store.start()
  await flush()
  return store
}

const fullCalls = () => server.callsTo('GET', new RegExp(`^/api/days/${DATE}(\\?|$)`)).length
const changeCalls = () => server.callsTo('GET', /\/changes\?/)

describe('처음 열 때', () => {
  it('그 방송을 찾아 범위 전체 조회 한 번 + 그 방송의 최근 메시지만(전체가 아니라)', async () => {
    const s = await started()
    expect(s.getSnapshot()).toMatchObject({ phase: 'ready', olderMessages: true })
    expect(s.getSnapshot().data?.seq).toBe(5)
    expect(fullCalls()).toBe(1)
    const [messages] = server.callsTo('GET', /\/messages\?/)
    expect(messages?.path).toBe(`/api/days/${DATE}/messages?b=b1&limit=${String(INITIAL_MESSAGES)}`)
    expect(FakeEventSource.last.url).toBe('/api/stream')
  })

  it('리허설 방송은 리허설 범위를 명시해서 고른다', async () => {
    await started('r1')
    expect(server.calls.some((call) => call.path === `/api/days/${DATE}?rehearsal=true`)).toBe(true)
    expect(server.calls.some((call) => call.path.startsWith(`/api/days/${DATE}/messages?b=r1&limit=`) && call.path.endsWith('rehearsal=true'))).toBe(true)
  })

  it('메시지 조회가 전체 조회보다 앞선 seq에서 끝났으면(그사이 채팅이 들어옴) 최근 메시지를 다시 받아 빈틈이 없다 (TD-S05-001)', async () => {
    let calls = 0
    server.on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => {
      calls++
      return calls === 1
        ? { body: { date: DATE, rehearsal: false, seq: 3, messages: [message(2), message(3)], more: false } }
        : { body: { date: DATE, rehearsal: false, seq: 5, messages: [message(2), message(3), message(4), message(5)], more: false } }
    })
    const s = await started()
    expect(calls).toBe(2)
    expect(s.getSnapshot().data?.seq).toBe(5)
    expect(s.getSnapshot().messages.map((item) => item.seq)).toEqual([2, 3, 4, 5])
    // 그 뒤 증분은 since=5부터 — 4·5는 이미 있다
    changesSeq = 6
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 6, type: 'chat' })
    await flush()
    expect(s.getSnapshot().messages.map((item) => item.seq)).toEqual([2, 3, 4, 5, 6])
  })

  it('메시지 조회가 전체 조회보다 늦은 seq면 다시 받지 않고 그 뒤를 증분으로 (메시지는 id로 덮는다)', async () => {
    server.on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 6, messages: [message(4), message(6, { id: 'n6' })], more: false } }))
    changesSeq = 6
    const s = await started()
    expect(server.callsTo('GET', /\/messages\?/)).toHaveLength(1)
    expect(changeCalls().map((call) => call.path)).toEqual([`/api/days/${DATE}/changes?since=5`])
    expect(s.getSnapshot().data?.seq).toBe(6)
    expect(s.getSnapshot().messages.map((item) => item.id)).toEqual(['m4', 'n6'])
  })

  it('없는 방송이면 "찾지 못함"', async () => {
    const s = await started('없는방송')
    expect(s.getSnapshot().phase).toBe('missing')
  })
})

describe('알림 → 증분 조회', () => {
  it('보는 범위의 아는 seq보다 큰 change면 since=아는 seq로 증분 한 번, 전체 조회는 다시 하지 않는다', async () => {
    const s = await started()
    changesSeq = 6
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 6, type: 'chat' })
    await flush()
    expect(changeCalls().map((call) => call.path)).toEqual([`/api/days/${DATE}/changes?since=5`])
    expect(fullCalls()).toBe(1)
    expect(s.getSnapshot().data?.seq).toBe(6)
    expect(s.getSnapshot().data?.products.get('b1/15')?.name).toBe('바뀜')
    expect(s.getSnapshot().messages.map((item) => item.id)).toEqual(['m3', 'm4', 'n6'])
  })

  it('아는 seq 이하·다른 범위(리허설·다른 날짜)의 알림은 무시한다', async () => {
    await started()
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 5, type: 'chat' })
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: true, seq: 50, type: 'chat' })
    FakeEventSource.last.emit('change', { date: '2026-10-20', rehearsal: false, seq: 50, type: 'chat' })
    await flush()
    expect(changeCalls()).toHaveLength(0)
  })

  it('조회 중에 온 알림은 모았다가 끝난 뒤 한 번 더 (알림마다 겹쳐 보내지 않는다)', async () => {
    const s = await started()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    server.on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), async (_call, match) => {
      if (first) {
        first = false
        await gate
      }
      const since = Number(match[1])
      return { body: emptyChanges(since, since === 5 ? 6 : 9) }
    })
    for (const seq of [6, 7, 8, 9]) FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq, type: 'chat' })
    await flush()
    expect(changeCalls()).toHaveLength(1)
    release()
    await flush(10)
    expect(changeCalls().map((call) => call.path)).toEqual([`/api/days/${DATE}/changes?since=5`, `/api/days/${DATE}/changes?since=6`])
    expect(s.getSnapshot().data?.seq).toBe(9)
  })

  it('"전체를 다시 받으세요"(410)면 전체를 다시 받는다', async () => {
    const s = await started()
    server.on('GET', /\/changes\?/, () => apiError(410, 'RESYNC_REQUIRED', '바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요.'))
    server.on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: fullView({ seq: 40 }) }))
    server.on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 40, messages: [], more: false } }))
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 40, type: 'chat' })
    await flush(10)
    expect(fullCalls()).toBe(2)
    expect(s.getSnapshot().data?.seq).toBe(40)
  })

  it('새 메시지가 너무 많으면(messagesMore) 최근 메시지만 다시 받고 앞쪽은 "이전 메시지 보기"로', async () => {
    const s = await started()
    server.on('GET', /\/changes\?/, () => ({ body: { ...emptyChanges(5, 900), messagesMore: true } }))
    server.on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 900, messages: [message(899)], more: true } }))
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 900, type: 'chat' })
    await flush(10)
    expect(s.getSnapshot().messages.map((item) => item.seq)).toEqual([899])
    expect(s.getSnapshot().olderMessages).toBe(true)
  })

  it('다른 방송의 메시지는 이 콘솔 채팅에 넣지 않는다', async () => {
    const s = await started()
    server.on('GET', /\/changes\?/, () => ({ body: { ...emptyChanges(5, 7), messages: [message(6, { broadcast: 'b2', id: 'x' }), message(7, { id: 'y' })] } }))
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 7, type: 'chat' })
    await flush()
    expect(s.getSnapshot().messages.map((item) => item.id)).toEqual(['m3', 'm4', 'y'])
  })
})

describe('끊김·다시 붙기', () => {
  it('끊기면 "다시 연결하는 중", 다시 붙어 ready의 seq가 크면 놓친 변경을 증분으로', async () => {
    const s = await started()
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 5 }] })
    expect(s.getSnapshot().connection).toBe('open')
    FakeEventSource.last.fail()
    expect(s.getSnapshot().connection).toBe('lost')
    changesSeq = 12
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: true, seq: 99 }, { date: DATE, rehearsal: false, seq: 12 }] })
    await flush()
    expect(s.getSnapshot().connection).toBe('open')
    expect(changeCalls().map((call) => call.path)).toEqual([`/api/days/${DATE}/changes?since=5`])
    expect(s.getSnapshot().data?.seq).toBe(12)
  })

  it('브라우저가 오프라인이면 끊긴 것으로 보이고, 다시 온라인이면 새로 연결해 ready로 따라잡는다', async () => {
    const s = await started()
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 5 }] })
    window.dispatchEvent(new Event('offline'))
    expect(s.getSnapshot().connection).toBe('lost')
    expect(FakeEventSource.instances[0]?.closed).toBe(true)
    window.dispatchEvent(new Event('online'))
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(s.getSnapshot().connection).toBe('lost')
    changesSeq = 9
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 9 }] })
    await flush()
    expect(s.getSnapshot().connection).toBe('open')
    expect(s.getSnapshot().data?.seq).toBe(9)
  })

  it('따라잡기가 네트워크 오류면 조금 뒤 다시 한다', async () => {
    vi.useFakeTimers()
    try {
      store = new ConsoleStore({ broadcastId: 'b1', openStream: (url) => new FakeEventSource(url) })
      await store.start()
      let down = true
      server.on('GET', /\/changes\?/, () => (down ? { network: true } : { body: emptyChanges(5, 7) }))
      FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 7, type: 'chat' })
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getSnapshot().data?.seq).toBe(5)
      down = false
      await vi.advanceTimersByTimeAsync(2500)
      expect(store.getSnapshot().data?.seq).toBe(7)
    } finally {
      vi.useRealTimers()
    }
  })

  it('브라우저가 다시 붙지 않는 닫힘이면 세션을 확인하고 새 연결을 연다', async () => {
    vi.useFakeTimers()
    try {
      server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'shop1' } }))
      store = new ConsoleStore({ broadcastId: 'b1', openStream: (url) => new FakeEventSource(url) })
      await store.start()
      expect(FakeEventSource.instances).toHaveLength(1)
      FakeEventSource.last.fail(true)
      await vi.advanceTimersByTimeAsync(2500)
      expect(server.callsTo('GET', /^\/api\/me$/)).toHaveLength(1)
      expect(FakeEventSource.instances).toHaveLength(2)
      expect(FakeEventSource.instances[0]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('그 밖', () => {
  it('sync: 쓰기 응답 seq까지 따라잡을 때까지 기다린다', async () => {
    const s = await started()
    changesSeq = 8
    await s.sync(8)
    expect(s.getSnapshot().data?.seq).toBe(8)
  })

  it('이전 메시지 보기: 가장 오래된 메시지 앞을 받는다', async () => {
    const s = await started()
    server.on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), (call) => {
      expect(call.path).toContain('before=3')
      return { body: { date: DATE, rehearsal: false, seq: 5, messages: [message(1), message(2)], more: false } }
    })
    await s.loadOlder()
    expect(s.getSnapshot().messages.map((item) => item.seq)).toEqual([1, 2, 3, 4])
    expect(s.getSnapshot().olderMessages).toBe(false)
  })

  it('generator 알림은 그 방송 것만', async () => {
    const s = await started('r1')
    FakeEventSource.last.emit('generator', { date: DATE, rehearsal: true, b: 'r2', running: true, sent: 1, total: 10, perSecond: 1, seed: 1, duplicates: 0, failed: 0, stopReason: null })
    expect(s.getSnapshot().generator).toBeNull()
    FakeEventSource.last.emit('generator', { date: DATE, rehearsal: true, b: 'r1', running: true, sent: 3, total: 10, perSecond: 1, seed: 1, duplicates: 0, failed: 0, stopReason: null })
    expect(s.getSnapshot().generator?.sent).toBe(3)
  })

  it('다시 붙으면(ready) 리허설 생성기 상태를 다시 받는다 — 끊긴 사이에 멈춘 생성기가 "실행 중"으로 남지 않는다 (TD-S05-002)', async () => {
    const status = (patch: Record<string, unknown>) => ({ b: 'r1', running: true, sent: 1, total: 2, perSecond: 1, seed: 7, duplicates: 0, failed: 0, stopReason: null, ...patch })
    let current = status({})
    server.on('GET', /^\/api\/broadcasts\/r1\/rehearsal\/generator$/, () => ({ body: { generator: current } }))
    const s = await started('r1')
    expect(s.getSnapshot().generator?.running).toBe(true)
    FakeEventSource.last.fail()
    current = status({ running: false, sent: 2, stopReason: 'completed' })
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: true, seq: 5 }] })
    await flush()
    expect(s.getSnapshot().generator).toMatchObject({ running: false, sent: 2, stopReason: 'completed' })
    // 실제 방송은 생성기를 묻지 않는다
    store?.stop()
    server.calls.length = 0
    const real = await started('b1')
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 5 }] })
    await flush()
    expect(server.callsTo('GET', /rehearsal\/generator/)).toHaveLength(0)
    expect(real.getSnapshot().generator).toBeNull()
  })

  it('생성기 상태 조회 중에 온 generator 알림이 더 새것이다 (늦게 온 조회 결과가 덮지 않는다)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hold = false
    server.on('GET', /^\/api\/broadcasts\/r1\/rehearsal\/generator$/, async () => {
      if (hold) await gate
      return { body: { generator: { b: 'r1', running: true, sent: 1, total: 2, perSecond: 1, seed: 7, duplicates: 0, failed: 0, stopReason: null } } }
    })
    const s = await started('r1')
    hold = true
    FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: true, seq: 5 }] })
    FakeEventSource.last.emit('generator', { date: DATE, rehearsal: true, b: 'r1', running: false, sent: 2, total: 2, perSecond: 1, seed: 7, duplicates: 0, failed: 0, stopReason: 'stopped' })
    release()
    await flush()
    expect(s.getSnapshot().generator).toMatchObject({ running: false, stopReason: 'stopped' })
  })

  it('메시지 합치기: id로 덮고 seq 순', () => {
    const merged = mergeMessages([message(1), message(3)], [message(2), message(3, { converted: [15] })])
    expect(merged.map((item) => item.seq)).toEqual([1, 2, 3])
    expect(merged[2]?.converted).toEqual([15])
  })
})

describe('다시 받기 실패 (AC-S06-41, RA-S05-004, D-096)', () => {
  it('간격: 1초부터 두 배씩, 최대 30초', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })

  it('처음 불러오기가 실패하면(5xx) "최신으로 맞추지 못함"을 보이고 1초·2초·4초 뒤 다시, 서버가 응답하면 맞춰지고 안내가 사라진다', async () => {
    vi.useFakeTimers()
    try {
      let down = true
      server.on('GET', new RegExp(`^/api/days/${DATE}$`), () => (down ? apiError(503, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.') : { body: fullView({ seq: 5 }) }))
      store = new ConsoleStore({ broadcastId: 'b1', openStream: (url) => new FakeEventSource(url) })
      await store.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(store.getSnapshot()).toMatchObject({ phase: 'loading', stale: true, data: null })
      expect(fullCalls()).toBe(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(fullCalls()).toBe(2)
      await vi.advanceTimersByTimeAsync(1999)
      expect(fullCalls()).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fullCalls()).toBe(3)
      down = false
      await vi.advanceTimersByTimeAsync(4000)
      expect(fullCalls()).toBe(4)
      expect(store.getSnapshot()).toMatchObject({ phase: 'ready', stale: false })
      expect(store.getSnapshot().data?.seq).toBe(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('410 뒤 전체 다시 받기가 실패해도 멈추지 않고 다시 시도한다 — 새 알림이 오면 기다리지 않고 바로', async () => {
    vi.useFakeTimers()
    try {
      store = new ConsoleStore({ broadcastId: 'b1', openStream: (url) => new FakeEventSource(url) })
      await store.start()
      await vi.advanceTimersByTimeAsync(10)
      // 서버가 보관한 범위 밖(40 앞)은 410, 다시 받은 뒤(40부터)는 증분
      server.on('GET', new RegExp(`/changes\\?since=(\\d+)`), (_call, match) =>
        Number(match[1]) >= 40 ? { body: emptyChanges(Number(match[1]), 41) } : apiError(410, 'RESYNC_REQUIRED', '바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요.'),
      )
      let down = true
      server.on('GET', new RegExp(`^/api/days/${DATE}$`), () => (down ? { network: true } : { body: fullView({ seq: 40, products: [product(15, { name: '맞춤' })] }) }))
      server.on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 40, messages: [], more: false } }))
      FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 40, type: 'chat' })
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getSnapshot().stale).toBe(true)
      expect(store.getSnapshot().data?.seq).toBe(5) // 옛 자료는 그대로 보이고 안내가 붙는다
      const before = fullCalls()
      down = false
      // 1초를 기다리지 않아도 새 알림이 오면 바로 다시 시도한다
      FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 41, type: 'chat' })
      await vi.advanceTimersByTimeAsync(10)
      expect(fullCalls()).toBe(before + 1)
      expect(store.getSnapshot()).toMatchObject({ stale: false })
      expect(store.getSnapshot().data?.products.get('b1/15')?.name).toBe('맞춤')
      expect(store.getSnapshot().data?.seq).toBe(41)
    } finally {
      vi.useRealTimers()
    }
  })

  it('전체를 다시 받은 바로 뒤 또 410이면 바로 다시 받지 않고 간격을 둔다 (끝없이 돌지 않는다)', async () => {
    vi.useFakeTimers()
    try {
      store = new ConsoleStore({ broadcastId: 'b1', openStream: (url) => new FakeEventSource(url) })
      await store.start()
      await vi.advanceTimersByTimeAsync(0)
      server.on('GET', /\/changes\?/, () => apiError(410, 'RESYNC_REQUIRED', '바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요.'))
      const before = fullCalls()
      FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 9, type: 'chat' })
      await vi.advanceTimersByTimeAsync(0)
      expect(fullCalls()).toBe(before + 1)
      expect(store.getSnapshot().stale).toBe(true)
      await vi.advanceTimersByTimeAsync(999)
      expect(fullCalls()).toBe(before + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fullCalls()).toBe(before + 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('다시 붙은 뒤 따라잡기가 계속 실패하면 간격을 늘려 다시 시도하고, "지금 다시 불러오기"는 바로 한다', async () => {
    vi.useFakeTimers()
    try {
      store = new ConsoleStore({ broadcastId: 'b1', openStream: (url) => new FakeEventSource(url) })
      await store.start()
      await vi.advanceTimersByTimeAsync(10)
      let down = true
      server.on('GET', /\/changes\?/, () => (down ? apiError(502, 'UNKNOWN', '서버에 문제가 생겼어요.') : { body: emptyChanges(5, 9) }))
      FakeEventSource.last.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 9 }] })
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getSnapshot().stale).toBe(true)
      expect(changeCalls()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(changeCalls()).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(changeCalls()).toHaveLength(3)
      down = false
      await store.retryNow()
      expect(changeCalls()).toHaveLength(4)
      expect(store.getSnapshot()).toMatchObject({ stale: false })
      expect(store.getSnapshot().data?.seq).toBe(9)
      // 맞춰진 뒤에는 더 시도하지 않는다
      await vi.advanceTimersByTimeAsync(60_000)
      expect(changeCalls()).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('범위로 열기 (구매자·정산, AC-S06-40)', () => {
  it('방송 목록·메시지 없이 그 범위 전체 조회 한 번 + 같은 SSE 증분', async () => {
    store = new ConsoleStore({ scope: { date: DATE, rehearsal: true }, openStream: (url) => new FakeEventSource(url) })
    await store.start()
    await flush()
    expect(server.callsTo('GET', /^\/api\/broadcasts$/)).toHaveLength(0)
    expect(server.callsTo('GET', /\/messages\?/)).toHaveLength(0)
    expect(server.calls.some((call) => call.path === `/api/days/${DATE}?rehearsal=true`)).toBe(true)
    changesSeq = 6
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: true, seq: 6, type: 'sms' })
    FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 60, type: 'sms' })
    await flush()
    expect(changeCalls().map((call) => call.path)).toEqual([`/api/days/${DATE}/changes?since=5&rehearsal=true`])
    expect(store.getSnapshot().data?.seq).toBe(6)
    expect(store.getSnapshot().messages).toEqual([])
  })

  it('택배 알림(parcel, T1 PC-8): 그 실제 날짜의 묶음·택배 설정이면 parcelVersion이 늘고, 다른 날짜면 그대로', async () => {
    store = new ConsoleStore({ scope: { date: DATE, rehearsal: false }, openStream: (url) => new FakeEventSource(url) })
    await store.start()
    await flush()
    const before = store.getSnapshot().parcelVersion
    FakeEventSource.last.emit('parcel', { date: DATE, buyer: 'UC_A' })
    expect(store.getSnapshot().parcelVersion).toBe(before + 1)
    FakeEventSource.last.emit('parcel', { date: '2000-01-01', buyer: 'UC_A' })
    expect(store.getSnapshot().parcelVersion).toBe(before + 1)
    FakeEventSource.last.emit('parcel', { settings: true })
    expect(store.getSnapshot().parcelVersion).toBe(before + 2)
  })

  it('그 날짜 범위가 없으면(404) "찾지 못함"', async () => {
    server.on('GET', new RegExp(`^/api/days/${DATE}$`), () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.'))
    store = new ConsoleStore({ scope: { date: DATE, rehearsal: false }, openStream: (url) => new FakeEventSource(url) })
    await store.start()
    expect(store.getSnapshot().phase).toBe('missing')
  })
})
