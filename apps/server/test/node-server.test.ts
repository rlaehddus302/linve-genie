// Node HTTP 계층까지 거친 응답 (AC-S00-40, AC-S00-41).
// 포트를 열지 않는다: listen하지 않은 서버에 메모리 안의 연결(duplexPair)로 원시 요청 바이트를 보낸다.
import { Server } from 'node:http'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { clientErrorStatus, createNodeServer, handleClientError, rawErrorResponse } from '../src/node-server.ts'
import { expectJsonError, rawRequest } from './helpers.ts'

const listenSpy = vi.spyOn(Server.prototype, 'listen')
const servers: Server[] = []

function makeServer(logError: (error: unknown) => void = () => {}): Server {
  const server = createNodeServer({ app: createApp({ logError }), logError })
  servers.push(server)
  return server
}

afterAll(() => {
  // 이 파일의 어떤 테스트도 포트를 열지 않았다
  expect(listenSpy).not.toHaveBeenCalled()
  for (const server of servers) expect(server.listening).toBe(false)
})

const get = (path: string, extra = '') => `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${extra}\r\n`

describe('정상 요청', () => {
  it('GET /health → 200 application/json {"status":"ok"}', async () => {
    const response = await rawRequest(makeServer(), get('/health'))
    expect(response.status).toBe(200)
    expect(response.contentType).toBe('application/json')
    expect(response.text).toBe('{"status":"ok"}')
  })

  it('HTTP/1.0 요청도 답한다', async () => {
    const response = await rawRequest(makeServer(), 'GET /health HTTP/1.0\r\nHost: localhost:3000\r\n\r\n')
    expect(response.status).toBe(200)
    expect(response.text).toBe('{"status":"ok"}')
  })

  it('Host 없는 HTTP/1.0 요청은 주소를 만들 수 없으므로 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), 'GET /health HTTP/1.0\r\n\r\n'), 400, 'BAD_REQUEST')
  })
})

describe('없는 경로·다른 메서드', () => {
  it(`GET /없는-경로 → 404 JSON`, async () => {
    const response = await rawRequest(makeServer(), get(`/${encodeURIComponent('없는-경로')}`))
    expectJsonError(response, 404, 'NOT_FOUND')
  })

  it('POST /health(본문 있음) → 405 JSON', async () => {
    const body = '{"status": '
    const request = `POST /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`
    const response = await rawRequest(makeServer(), request)
    expectJsonError(response, 405, 'METHOD_NOT_ALLOWED')
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('경로 대신 절대 URL을 보내도 스택 없이 답한다', async () => {
    const response = await rawRequest(makeServer(), 'GET http://evil.example/없는 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expectJsonError(response, response.status, response.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST')
  })
})

describe('잘못된 헤더·요청 (앱에 닿기 전)', () => {
  it('Host 헤더가 없는 HTTP/1.1 → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), 'GET /health HTTP/1.1\r\nConnection: close\r\n\r\n'), 400, 'BAD_REQUEST')
  })

  for (const host of ['exa mple.com', '<script>alert(1)</script>', 'localhost:99999', 'a/b', '[::1', '%00']) {
    it(`잘못된 Host 헤더(${host}) → 400 JSON, 값을 되돌려 주지 않는다`, async () => {
      const response = await rawRequest(makeServer(), `GET /health HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
      expectJsonError(response, 400, 'BAD_REQUEST')
      expect(response.text).not.toContain('script')
    })
  }

  it('헤더 이름에 공백 → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), get('/health', 'Bad Header: x\r\n')), 400, 'BAD_REQUEST')
  })

  it('콜론 없는 헤더 줄 → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), get('/health', 'NoColonHere\r\n')), 400, 'BAD_REQUEST')
  })

  it('헤더 값에 제어 문자 → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), get('/health', 'X-Test: a\u0000b\r\n')), 400, 'BAD_REQUEST')
  })

  it('알 수 없는 메서드 → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), 'FOO /health HTTP/1.1\r\nHost: localhost\r\n\r\n'), 400, 'BAD_REQUEST')
  })

  it('HTTP가 아닌 바이트 → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), '\u0016\u0003\u0001garbage\r\n\r\n'), 400, 'BAD_REQUEST')
  })

  it('Content-Length와 Transfer-Encoding을 함께 보내면(요청 밀반입) → 400 JSON', async () => {
    const request =
      'POST /health HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n'
    expectJsonError(await rawRequest(makeServer(), request), 400, 'BAD_REQUEST')
  })

  it('잘못된 Content-Length → 400 JSON', async () => {
    expectJsonError(await rawRequest(makeServer(), get('/health', 'Content-Length: abc\r\n')), 400, 'BAD_REQUEST')
  })

  it('너무 큰 헤더 → 431 JSON', async () => {
    const response = await rawRequest(makeServer(), get('/health', `X-Big: ${'a'.repeat(20_000)}\r\n`))
    expectJsonError(response, 431, 'HEADERS_TOO_LARGE')
  })
})

describe('앱 호출 자체가 실패할 때', () => {
  it('fetch가 동기로 던지면 500 JSON, 내용은 기록만 한다', async () => {
    const logError = vi.fn()
    const thrown = new Error('비밀 /Users/seller/secret.ts')
    const server = createNodeServer({
      app: {
        fetch: () => {
          throw thrown
        },
      },
      logError,
    })
    servers.push(server)
    const response = await rawRequest(server, get('/health'))
    expectJsonError(response, 500, 'INTERNAL_ERROR')
    expect(logError).toHaveBeenCalledWith(thrown)
  })

  it('기록 함수를 주지 않으면 console.error에 남긴다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const server = createNodeServer({
        app: {
          fetch: () => {
            throw new Error('x')
          },
        },
      })
      servers.push(server)
      expectJsonError(await rawRequest(server, get('/health')), 500, 'INTERNAL_ERROR')
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('clientError 처리', () => {
  it('Node 기본 동작과 같은 상태를 고른다', () => {
    expect(clientErrorStatus('HPE_HEADER_OVERFLOW')).toBe(431)
    expect(clientErrorStatus('HPE_CHUNK_EXTENSIONS_OVERFLOW')).toBe(413)
    expect(clientErrorStatus('ERR_HTTP_REQUEST_TIMEOUT')).toBe(408)
    expect(clientErrorStatus('HPE_INVALID_METHOD')).toBe(400)
    expect(clientErrorStatus(undefined)).toBe(400)
  })

  it('원시 응답: 상태 줄, JSON, 바이트 단위 Content-Length, 연결 닫기', () => {
    for (const status of [400, 408, 413, 431]) {
      const raw = rawErrorResponse(status)
      const [head = '', body = ''] = raw.split('\r\n\r\n')
      expect(head.split('\r\n')[0]).toMatch(new RegExp(`^HTTP/1\\.1 ${status} [A-Z]`))
      expect(head).toContain('Content-Type: application/json')
      expect(head).toContain('Connection: close')
      expect(head).toContain(`Content-Length: ${Buffer.byteLength(body)}`)
      expect(JSON.parse(body)).toEqual({ error: { code: expect.any(String), message: expect.any(String) } })
    }
  })

  function fakeSocket(overrides: { writable?: boolean; headersSent?: boolean } = {}) {
    const socket = new PassThrough() as PassThrough & { _httpMessage?: { headersSent: boolean } }
    if (overrides.writable === false) socket.destroy()
    if (overrides.headersSent !== undefined) socket._httpMessage = { headersSent: overrides.headersSent }
    const written: string[] = []
    socket.on('data', (chunk: Buffer) => written.push(chunk.toString()))
    const end = vi.spyOn(socket, 'end')
    const destroy = vi.spyOn(socket, 'destroy')
    return { socket, written, end, destroy }
  }

  const error = (code?: string) => Object.assign(new Error('parse error'), code === undefined ? {} : { code })

  it('응답을 아직 쓰지 않았으면 JSON 오류를 쓰고 연결을 닫는다', () => {
    const { socket, end, destroy } = fakeSocket()
    handleClientError(error('HPE_HEADER_OVERFLOW'), socket)
    expect(end).toHaveBeenCalledWith(rawErrorResponse(431))
    expect(destroy).not.toHaveBeenCalled()
  })

  it('진행 중인 응답의 헤더를 이미 보냈으면 덧붙이지 않고 연결만 끊는다', () => {
    const { socket, end, destroy } = fakeSocket({ headersSent: true })
    handleClientError(error('HPE_INVALID_CHUNK_SIZE'), socket)
    expect(end).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
  })

  it('진행 중인 응답이 있어도 헤더를 아직 안 보냈으면 JSON 오류를 쓴다', () => {
    const { socket, end } = fakeSocket({ headersSent: false })
    handleClientError(error(), socket)
    expect(end).toHaveBeenCalledWith(rawErrorResponse(400))
  })

  it('연결이 끊긴 경우(ECONNRESET·쓸 수 없음)는 연결만 정리한다', () => {
    const reset = fakeSocket()
    handleClientError(error('ECONNRESET'), reset.socket)
    expect(reset.end).not.toHaveBeenCalled()
    expect(reset.destroy).toHaveBeenCalled()

    const closed = fakeSocket({ writable: false })
    closed.destroy.mockClear()
    handleClientError(error('HPE_INVALID_METHOD'), closed.socket)
    expect(closed.end).not.toHaveBeenCalled()
    expect(closed.destroy).toHaveBeenCalled()
  })
})
