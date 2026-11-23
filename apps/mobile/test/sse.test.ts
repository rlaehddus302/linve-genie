// 스트리밍 fetch 위의 SSE (src/api/sse.ts): 줄 나누기 규칙, 열림·끊김, 닫기.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CLOSED, OPEN, SseParser, openEventSource, type SseMessage } from '../src/api/sse.ts'

function streamOf(chunks: readonly string[], options: { readonly hang?: boolean } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (options.hang !== true) controller.close()
    },
  })
}

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

describe('SseParser', () => {
  it('event·data·id 줄을 메시지로 모으고, 여러 data 줄은 줄바꿈으로 잇는다', () => {
    const out: SseMessage[] = []
    const parser = new SseParser((message) => out.push(message))
    parser.push('event: ready\ndata: {"a":1}\n\n: 주석\ndata: 첫 줄\ndata: 둘째 줄\nid: 7\n\n')
    expect(out).toEqual([
      { type: 'ready', data: '{"a":1}', lastEventId: '' },
      { type: 'message', data: '첫 줄\n둘째 줄', lastEventId: '7' },
    ])
  })

  it('조각이 줄 중간에서 끊겨도 이어 붙인다 (\\r\\n도 줄 끝)', () => {
    const out: SseMessage[] = []
    const parser = new SseParser((message) => out.push(message))
    parser.push('event: cha')
    parser.push('nge\r\ndata: {"seq"')
    parser.push(':3}\r\n\r\n')
    expect(out).toEqual([{ type: 'change', data: '{"seq":3}', lastEventId: '' }])
  })
})

describe('openEventSource', () => {
  it('응답 본문을 읽어 알림마다 듣는 쪽을 부르고, 본문이 끝나면 닫힌 연결로 알린다', async () => {
    const fetch = async () => new Response(streamOf(['event: ready\ndata: {"scopes":[]}\n\n', 'event: change\ndata: {"seq":2}\n\n']), { status: 200 })
    const source = openEventSource('http://test.local/api/stream', { fetch })
    const got: string[] = []
    let errors = 0
    source.addEventListener('ready', (event) => got.push(`ready:${event.data}`))
    source.addEventListener('change', (event) => got.push(`change:${event.data}`))
    source.onerror = () => errors++
    await wait()
    expect(got).toEqual(['ready:{"scopes":[]}', 'change:{"seq":2}'])
    expect(source.readyState).toBe(CLOSED)
    expect(errors).toBe(1)
  })

  it('서버에 닿지 못하거나 200이 아니면 닫힌 연결 + onerror', async () => {
    const failing = openEventSource('http://test.local/api/stream', { fetch: async () => { throw new TypeError('Network request failed') } })
    let errors = 0
    failing.onerror = () => errors++
    await wait()
    expect(failing.readyState).toBe(CLOSED)
    expect(errors).toBe(1)
    const unauthorized = openEventSource('http://test.local/api/stream', { fetch: async () => new Response('{}', { status: 401 }) })
    unauthorized.onerror = () => errors++
    await wait()
    expect(unauthorized.readyState).toBe(CLOSED)
    expect(errors).toBe(2)
  })

  it('열린 연결을 close하면 더 받지 않고 onerror도 부르지 않는다', async () => {
    const source = openEventSource('http://test.local/api/stream', { fetch: async () => new Response(streamOf(['event: ready\ndata: {}\n\n'], { hang: true }), { status: 200 }) })
    let errors = 0
    source.onerror = () => errors++
    await wait()
    expect(source.readyState).toBe(OPEN)
    source.close()
    expect(source.readyState).toBe(CLOSED)
    await wait()
    expect(errors).toBe(0)
  })

  it('열린 채 아무 글자도 오지 않으면(죽은 연결) staleMs 뒤 끊김으로 알린다 — 보는 쪽이 다시 연다 (D-SSE-STALL-01)', async () => {
    const source = openEventSource('http://test.local/api/stream', { staleMs: 30, fetch: async () => new Response(streamOf(['event: ready\ndata: {}\n\n'], { hang: true }), { status: 200 }) })
    let errors = 0
    source.onerror = () => errors++
    await wait()
    expect(source.readyState).toBe(OPEN)
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
    expect(source.readyState).toBe(CLOSED)
    expect(errors).toBe(1)
  })

  it('ping 주석이라도 계속 오면 열린 채로 둔다 (D-SSE-STALL-01)', async () => {
    const encoder = new TextEncoder()
    let timer: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: ready\ndata: {}\n\n'))
        timer = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 10)
      },
      cancel() {
        clearInterval(timer)
      },
    })
    const source = openEventSource('http://test.local/api/stream', { staleMs: 40, fetch: async () => new Response(body, { status: 200 }) })
    let errors = 0
    source.onerror = () => errors++
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    expect(source.readyState).toBe(OPEN)
    expect(errors).toBe(0)
    source.close()
    clearInterval(timer)
  })
})
