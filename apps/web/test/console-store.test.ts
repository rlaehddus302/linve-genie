// 실시간 구독·따라잡기·재연결 (AC-S05-62, D-085): 처음 한 번 전체 조회, 그 뒤 알림마다 증분 조회만.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleStore, INITIAL_MESSAGES, mergeMessages } from '../src/lib/console-store.ts'
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

  it('메시지 합치기: id로 덮고 seq 순', () => {
    const merged = mergeMessages([message(1), message(3)], [message(2), message(3, { converted: [15] })])
    expect(merged.map((item) => item.seq)).toEqual([1, 2, 3])
    expect(merged[2]?.converted).toEqual([15])
  })
})
