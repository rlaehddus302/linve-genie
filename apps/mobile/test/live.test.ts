// 앱 전체의 실시간 연결 하나 (src/lib/live.ts): 보는 쪽이 여럿이어도 연결은 하나, 늦게 붙은 쪽은 아는 seq로 ready, 끊기면 2초 뒤 다시, 돌아오면 바로.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LiveStream, REOPEN_MS } from '../src/lib/live.ts'
import { FakeClock, FakeEventSource, flush } from './support.ts'

function setup() {
  const sources: FakeEventSource[] = []
  const clock = new FakeClock()
  const stream = new LiveStream({
    url: () => 'http://test.local/api/stream?device=d1',
    create: (url) => {
      const source = new FakeEventSource(url)
      sources.push(source)
      return source
    },
    timer: clock,
  })
  return { sources, clock, stream }
}

describe('LiveStream', () => {
  it('보는 쪽 둘이 연결 하나를 나눠 받고, 늦게 붙은 쪽은 지금까지 아는 seq로 ready를 받는다', async () => {
    const { sources, stream } = setup()
    const a = stream.open()
    const got: string[] = []
    a.addEventListener('change', (event) => got.push(`a:${event.data}`))
    expect(sources.length).toBe(1)
    sources[0]!.open([{ date: '2026-10-29', rehearsal: false, seq: 3 }])
    sources[0]!.emit('change', { date: '2026-10-29', rehearsal: false, seq: 4, type: 'chat' })
    const b = stream.open()
    b.addEventListener('ready', (event) => got.push(`b-ready:${event.data}`))
    b.addEventListener('change', (event) => got.push(`b:${event.data}`))
    await flush()
    expect(sources.length).toBe(1)
    expect(got).toEqual(['a:{"date":"2026-10-29","rehearsal":false,"seq":4,"type":"chat"}', 'b-ready:{"scopes":[{"date":"2026-10-29","rehearsal":false,"seq":4}]}'])
    sources[0]!.emit('change', { date: '2026-10-29', rehearsal: false, seq: 5, type: 'chat' })
    expect(got.at(-1)).toBe('b:{"date":"2026-10-29","rehearsal":false,"seq":5,"type":"chat"}')
    expect(got.at(-2)).toBe('a:{"date":"2026-10-29","rehearsal":false,"seq":5,"type":"chat"}')
  })

  it('끊기면 보는 쪽에 onerror를 주고 2초 뒤 새로 연다 — 앞으로 돌아오면(resume) 기다리지 않고 바로', async () => {
    const { sources, stream, clock } = setup()
    const view = stream.open()
    let errors = 0
    view.onerror = () => errors++
    const states: boolean[] = []
    stream.onConnection((open) => states.push(open))
    sources[0]!.open()
    sources[0]!.fail()
    expect(errors).toBe(1)
    expect(states).toEqual([true, false])
    await clock.advance(REOPEN_MS - 1)
    expect(sources.length).toBe(1)
    await clock.advance(1)
    expect(sources.length).toBe(2)
    sources[1]!.fail()
    stream.resume()
    expect(sources.length).toBe(3)
    // 보는 쪽이 모두 닫히면 연결도 닫고 다시 열지 않는다
    view.close()
    expect(sources[2]!.readyState).toBe(2)
    await clock.advance(REOPEN_MS * 2)
    expect(sources.length).toBe(3)
  })
})
