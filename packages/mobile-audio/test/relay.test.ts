// RN 웹소켓 연결 함수 (VOC-06 연결, D-APP-04·D-APP-05) — 가짜 소켓으로: 주소·머리글, 글 틀만 넘김, 열리기 전 버림, 닫힘·오류 한 번, 비밀 없음.
import { describe, expect, it } from 'vitest'
import { createRelayConnect, defaultWebSocketFactory, tightBuffer, type RelayHandlers } from '../src/index.ts'
import { createFakeSocket, frame, type FakeSocket } from './fakes.ts'

function setup(options: { headers?: Record<string, string> | (() => Record<string, string> | undefined) } = {}) {
  const sockets: FakeSocket[] = []
  const connect = createRelayConnect({
    url: () => `wss://example.invalid/api/voice/stream?broadcastId=b1&device=abcdefgh${sockets.length}`,
    headers: options.headers,
    factory: (url, headers) => {
      const s = createFakeSocket(url, headers)
      sockets.push(s)
      return s
    },
  })
  const events: string[] = []
  const handlers: RelayHandlers = {
    onMessage: (data) => events.push(`message:${String(data)}`),
    onClose: () => events.push('close'),
    onError: () => events.push('error'),
  }
  return { connect, sockets, events, handlers }
}

describe('연결 열기', () => {
  it('열 때마다 주소 함수와 머리글 함수를 부르고 binaryType은 arraybuffer', () => {
    const { connect, sockets, handlers } = setup({ headers: () => ({ Cookie: 'session=abc' }) })
    connect(handlers)
    connect(handlers)
    expect(sockets).toHaveLength(2)
    expect(sockets[0]!.url).toContain('device=abcdefgh0')
    expect(sockets[1]!.url).toContain('device=abcdefgh1')
    expect(sockets[0]!.headers).toEqual({ Cookie: 'session=abc' })
    expect(sockets[0]!.binaryType).toBe('arraybuffer')
  })

  it('머리글이 없으면 undefined로 연다', () => {
    const { connect, sockets, handlers } = setup()
    connect(handlers)
    expect(sockets[0]!.headers).toBeUndefined()
  })
})

describe('보내기 (D-APP-05 끊긴 동안의 소리는 버린다)', () => {
  it('열리기 전·닫힌 뒤의 소리는 보내지 않고, 열린 뒤에는 딱 맞는 ArrayBuffer로 보낸다', () => {
    const { connect, sockets, handlers } = setup()
    const connection = connect(handlers)
    const socket = sockets[0]!
    connection.send(frame())
    expect(socket.sent).toHaveLength(0)
    socket.open()
    const view = new Uint8Array(new ArrayBuffer(4_000), 100, 3_200)
    view.set(frame(3))
    connection.send(view)
    connection.send('{"type":"ping"}')
    expect(socket.sent).toHaveLength(2)
    const sent = socket.sent[0] as ArrayBuffer
    expect(sent).toBeInstanceOf(ArrayBuffer)
    expect(sent.byteLength).toBe(3_200)
    expect(new Uint8Array(sent)).toEqual(frame(3))
    socket.drop()
    connection.send(frame())
    expect(socket.sent).toHaveLength(2)
  })

  it('tightBuffer: 그대로인 것은 복사하지 않고, 어긋난 view만 잘라 낸다', () => {
    const whole = new Uint8Array([1, 2, 3, 4])
    expect(tightBuffer(whole.buffer)).toBe(whole.buffer)
    expect(tightBuffer(whole)).toBe(whole.buffer)
    const part = new Uint8Array(whole.buffer, 1, 2)
    const tight = tightBuffer(part)
    expect(tight).not.toBe(whole.buffer)
    expect(new Uint8Array(tight)).toEqual(new Uint8Array([2, 3]))
  })
})

describe('받기·닫힘', () => {
  it('글 틀만 onMessage로, 이진 틀은 무시', () => {
    const { connect, sockets, handlers, events } = setup()
    connect(handlers)
    const socket = sockets[0]!
    socket.open()
    socket.message('{"type":"ready"}')
    socket.message(new ArrayBuffer(8))
    socket.message('{"type":"result","text":"15번 2만 원","startMs":0,"endMs":1200}')
    expect(events).toEqual(['message:{"type":"ready"}', 'message:{"type":"result","text":"15번 2만 원","startMs":0,"endMs":1200}'])
  })

  it('닫힘은 한 번만 알린다 — 오류 뒤 닫힘이 와도 onError 하나', () => {
    const { connect, sockets, handlers, events } = setup()
    connect(handlers)
    const socket = sockets[0]!
    socket.open()
    socket.fail()
    socket.drop()
    socket.message('{"type":"ready"}')
    expect(events).toEqual(['error'])
  })

  it('엔진이 close()하면 소켓을 닫고 그 뒤 알림은 없다 (판매자가 끈 것은 다시 잇기 대상이 아님)', () => {
    const { connect, sockets, handlers, events } = setup()
    const connection = connect(handlers)
    const socket = sockets[0]!
    socket.open()
    connection.close()
    connection.close()
    expect(socket.closed).toBe(1)
    socket.drop()
    expect(events).toEqual([])
  })
})

describe('기본 소켓 만들기 (기능 감지)', () => {
  it('전역 WebSocket이 없으면 쉬운 문장의 예외', () => {
    const holder = globalThis as { WebSocket?: unknown }
    const saved = holder.WebSocket
    holder.WebSocket = undefined
    try {
      expect(() => defaultWebSocketFactory('wss://example.invalid/x', undefined)).toThrow('이 기기에서는 웹소켓을 쓸 수 없어요')
    } finally {
      holder.WebSocket = saved
    }
  })

  it('전역 WebSocket이 있으면 머리글을 세 번째 인자로 넘긴다 (RN 꼴)', () => {
    const holder = globalThis as { WebSocket?: unknown }
    const saved = holder.WebSocket
    const calls: unknown[][] = []
    holder.WebSocket = class {
      constructor(...args: unknown[]) {
        calls.push(args)
      }
    }
    try {
      defaultWebSocketFactory('wss://example.invalid/x', { Cookie: 'a=b' })
      defaultWebSocketFactory('wss://example.invalid/y', undefined)
      expect(calls).toEqual([
        ['wss://example.invalid/x', null, { headers: { Cookie: 'a=b' } }],
        ['wss://example.invalid/y'],
      ])
    } finally {
      holder.WebSocket = saved
    }
  })
})
