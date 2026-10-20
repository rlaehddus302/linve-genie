// 앱을 Node HTTP 서버에 연결한다. 여기서는 listen하지 않는다(포트는 main.ts가 연다).
// 앱에 닿기 전에 생기는 오류도 JSON으로 답한다 (AC-S00-41):
// - 요청을 만들 수 없음(잘못된 Host 헤더 등) → 400
// - HTTP 파서 오류(잘못된 요청 줄·헤더, 너무 큰 헤더, 시간 초과) → 400 / 413 / 431 / 408
import { createServer, STATUS_CODES, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { getRequestListener, RequestError } from '@hono/node-server'
import type { Hono } from 'hono'
import { SECURITY_HEADERS, defaultLogError, safeLogger, type ErrorLogger } from './app.ts'
import { describeError, errorResponse, JSON_CONTENT_TYPE } from './errors.ts'

export interface NodeServerOptions {
  readonly app: Pick<Hono, 'fetch'>
  readonly logError?: ErrorLogger
}

export function createNodeServer(options: NodeServerOptions): Server {
  const logError = safeLogger(options.logError ?? defaultLogError)
  const listener = getRequestListener(options.app.fetch, {
    // 앱에 닿기 전의 오류 응답에도 보안 머리글 (AC-I3-71)
    errorHandler: (error) => {
      if (error instanceof RequestError) return errorResponse(400, SECURITY_HEADERS)
      logError(error)
      return errorResponse(500, SECURITY_HEADERS)
    },
  })
  // Host 헤더가 없는 HTTP/1.1 요청을 Node가 본문 없는 400으로 먼저 끊지 않게 한다.
  // 그런 요청은 @hono/node-server가 RequestError로 넘기고, 위 errorHandler가 JSON 400으로 답한다.
  const server = createServer({ requireHostHeader: false }, listener)
  server.on('clientError', handleClientError)
  return server
}

/** Node 기본 동작과 같은 기준으로 상태를 고른다 */
export function clientErrorStatus(code: string | undefined): 400 | 408 | 413 | 431 {
  switch (code) {
    case 'HPE_HEADER_OVERFLOW':
      return 431
    case 'HPE_CHUNK_EXTENSIONS_OVERFLOW':
      return 413
    case 'ERR_HTTP_REQUEST_TIMEOUT':
      return 408
    default:
      return 400
  }
}

/** 소켓에 바로 쓰는 HTTP 오류 응답(연결은 닫는다) */
export function rawErrorResponse(status: number): string {
  const described = describeError(status)
  const json = JSON.stringify(described.body)
  return [
    `HTTP/1.1 ${described.status} ${STATUS_CODES[described.status] ?? ''}`.trimEnd(),
    `Content-Type: ${JSON_CONTENT_TYPE}`,
    `Content-Length: ${Buffer.byteLength(json)}`,
    ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
    'Connection: close',
    '',
    json,
  ].join('\r\n')
}

type ClientSocket = Duplex & { _httpMessage?: { headersSent?: boolean } | null }

export function handleClientError(error: Error & { code?: string }, socket: ClientSocket): void {
  // 이미 응답을 쓰기 시작했으면 덧붙이면 상대가 깨진 응답을 받는다. 그때는 연결만 끊는다.
  if (error.code === 'ECONNRESET' || !socket.writable || socket._httpMessage?.headersSent === true) {
    socket.destroy()
    return
  }
  socket.end(rawErrorResponse(clientErrorStatus(error.code)))
}
