// 묶어 보내기·붙들기·다시 보내기 (YT-10 AC5, D-X1-09, AC-X1-18)
import { describe, expect, it } from 'vitest'
import { BATCH_MAX, FLUSH_MS, HOLD_MAX, Outbox, type OutboxEvent } from '../src/outbox.ts'
import { FakeApi, FakeTimers, fail, message, ok, settle } from './fakes.ts'

const V = 'abcdEFGH123'
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => message(from + i))

function setup() {
  const api = new FakeApi()
  const timers = new FakeTimers()
  const events: OutboxEvent[] = []
  const outbox = new Outbox(api, timers, (event) => events.push(event))
  return { api, timers, events, outbox }
}

describe('Outbox', () => {
  it('1초마다 한 번에 보낸다', async () => {
    const { api, timers, outbox } = setup()
    outbox.add(V, range(1, 3))
    outbox.add(V, range(4, 2))
    expect(api.calls).toHaveLength(0)
    expect(timers.delays()).toEqual([FLUSH_MS])
    await timers.fire()
    expect(api.chatBatches().map((b) => b.length)).toEqual([5])
    expect(api.calls[0]?.body?.['v']).toBe(V)
    expect(outbox.size).toBe(0)
  })

  it('50개가 차면 바로, 한 묶음은 50개까지', async () => {
    const { api, timers, outbox } = setup()
    outbox.add(V, range(1, 120))
    expect(timers.delays()).toEqual([0])
    await timers.fire()
    await timers.fire()
    await timers.fire()
    expect(api.chatBatches().map((b) => b.length)).toEqual([BATCH_MAX, BATCH_MAX, 20])
  })

  it('AC-X1-18: 500개 넘으면 가장 오래된 것부터 버리고 센다', async () => {
    const { api, timers, outbox } = setup()
    api.fallback = fail(0, 'NETWORK', '닿지 못했어요')
    outbox.add(V, range(1, 10))
    await timers.fire()
    outbox.add(V, range(11, HOLD_MAX))
    expect(outbox.size).toBe(HOLD_MAX)
    expect(outbox.dropped).toBe(10)
    api.fallback = ok({ recorded: 50 })
    await timers.fire()
    expect(api.chatBatches().at(-1)?.[0]?.id).toBe(message(11).id)
  })

  it('서버에 닿지 못하면 같은 묶음을 점점 길게 기다렸다 다시 보낸다', async () => {
    const { api, timers, outbox, events } = setup()
    api.replies.push(fail(0, 'NETWORK', '닿지 못했어요'), fail(500, 'SAVE_FAILED', '저장하지 못했어요'))
    outbox.add(V, range(1, 3))
    await timers.fire()
    expect(timers.delays()).toEqual([1000])
    await timers.fire()
    expect(timers.delays()).toEqual([2000])
    await timers.fire()
    const batches = api.chatBatches()
    expect(batches).toHaveLength(3)
    expect(batches[2]).toEqual(batches[0])
    expect(outbox.size).toBe(0)
    expect(events.map((e) => e.kind)).toEqual(['failing', 'failing', 'sent'])
  })

  it('429면 Retry-After만큼 기다린다 (그사이 새 채팅이 와도 먼저 보내지 않는다)', async () => {
    const { api, timers, outbox } = setup()
    api.replies.push(fail(429, 'EXT_RATE_LIMITED', '한꺼번에 너무 많이', 3000))
    outbox.add(V, range(1, 2))
    await timers.fire()
    expect(timers.delays()).toEqual([3000])
    outbox.add(V, range(3, 60))
    expect(timers.delays()).toEqual([3000])
    await timers.fire()
    expect(api.chatBatches().map((b) => b.length)).toEqual([2, 50])
  })

  it('401이면 모두 버리고 멈춘다', async () => {
    const { api, timers, outbox, events } = setup()
    api.replies.push(fail(401, 'EXT_DISCONNECTED'))
    outbox.add(V, range(1, 3))
    await timers.fire()
    expect(events).toEqual([{ kind: 'disconnected' }])
    expect(outbox.size).toBe(0)
    outbox.add(V, range(4, 3))
    expect(outbox.size).toBe(0)
    expect(timers.delays()).toEqual([])
  })

  it('회차를 골라야 함·회차 끝남이면 그 묶음을 버리고 알린다', async () => {
    const { api, timers, outbox, events } = setup()
    api.replies.push(fail(409, 'EXT_NOT_BOUND'), fail(409, 'EXT_ENDED'))
    outbox.add(V, range(1, 3))
    await timers.fire()
    outbox.add(V, range(4, 1))
    await timers.fire()
    expect(events).toEqual([
      { kind: 'notBound', v: V },
      { kind: 'ended', v: V },
    ])
    expect(outbox.size).toBe(0)
  })

  it('영상이 섞이면 영상마다 따로 묶는다', async () => {
    const { api, timers, outbox } = setup()
    outbox.add(V, range(1, 2))
    outbox.add('zzzzYYYY_-1', range(3, 2))
    await timers.fire()
    await settle()
    await timers.fire()
    expect(api.calls.map((c) => c.body?.['v'])).toEqual([V, 'zzzzYYYY_-1'])
  })
})
