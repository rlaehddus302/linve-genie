// 테스트 도우미. 포트를 열지 않는다.
import type { Server } from 'node:http'
import { duplexPair } from 'node:stream'
import { expect } from 'vitest'

/** 응답 본문에 나오면 안 되는 내부 정보: 스택 줄, 파일 경로, 의존성·프레임워크 이름, 예외 이름 */
const LEAK_PATTERNS: readonly RegExp[] = [
  /\bat\s+\S+\s+\(/,
  /\bat\s+(file|node):/,
  /node_modules/,
  /\/Users\/|\/home\/|[A-Z]:\\/,
  /\.(ts|js|mjs|cjs)\b/,
  /hono/i,
  /\bstack\b/i,
  /\b\w*Error\b/,
  /Exception/,
  /undefined|null/,
]

export function expectNoInternals(text: string): void {
  for (const pattern of LEAK_PATTERNS) expect(text, `응답에 내부 정보(${pattern})가 보인다: ${text}`).not.toMatch(pattern)
}

export interface ErrorShape {
  readonly status: number
  readonly contentType: string | null
  readonly text: string
}

/** JSON 오류 응답의 모양: {"error":{"code","message"}}, 한국어 메시지, 내부 정보 없음 */
export function expectJsonError(response: ErrorShape, status: number, code: string): void {
  expect(response.status).toBe(status)
  expect(response.contentType).toBe('application/json')
  expectNoInternals(response.text)
  const body: unknown = JSON.parse(response.text)
  expect(body).toEqual({ error: { code, message: expect.any(String) } })
  const message = (body as { error: { message: string } }).error.message
  expect(message).toMatch(/[가-힣]/)
  expect(message).not.toMatch(/[A-Za-z]/)
}

export async function shapeOf(response: Response): Promise<ErrorShape> {
  return { status: response.status, contentType: response.headers.get('content-type'), text: await response.text() }
}

export interface RawResponse {
  readonly raw: string
  readonly status: number
  readonly headers: ReadonlyMap<string, string>
  readonly text: string
  readonly contentType: string | null
}

/**
 * Node HTTP 서버에 메모리 안의 연결로 원시 요청 바이트를 보낸다(listen하지 않는다).
 * 서버가 연결을 닫을 때까지 받은 바이트를 돌려준다. 그래서 요청에는 `Connection: close`를 넣거나
 * HTTP/1.0·잘못된 요청처럼 서버가 스스로 닫는 경우만 쓴다.
 * (보내는 쪽을 먼저 닫으면 Node가 비동기 처리기의 응답을 기다리지 않고 연결을 끊는다.)
 */
export async function rawRequest(server: Server, request: string, timeoutMs = 2000): Promise<RawResponse> {
  const [client, serverSide] = duplexPair()
  server.emit('connection', serverSide)
  const chunks: Buffer[] = []
  client.on('data', (chunk: Buffer) => chunks.push(chunk))
  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`서버가 ${timeoutMs}ms 안에 연결을 닫지 않았다`)), timeoutMs)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    client.on('end', done)
    client.on('close', done)
  })
  client.write(request)
  try {
    await closed
  } finally {
    client.destroy()
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return parseRaw(raw)
}

function parseRaw(raw: string): RawResponse {
  const split = raw.indexOf('\r\n\r\n')
  expect(split, `HTTP 응답이 아니다: ${JSON.stringify(raw)}`).toBeGreaterThan(0)
  const [statusLine = '', ...headerLines] = raw.slice(0, split).split('\r\n')
  const match = /^HTTP\/1\.1 (\d{3})\b/.exec(statusLine)
  expect(match, `상태 줄이 이상하다: ${statusLine}`).not.toBeNull()
  const headers = new Map<string, string>()
  for (const line of headerLines) {
    const colon = line.indexOf(':')
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  const text = raw.slice(split + 4)
  const length = headers.get('content-length')
  if (length !== undefined) expect(Buffer.byteLength(text), 'Content-Length와 본문 길이가 다르다').toBe(Number(length))
  return { raw, status: Number(match?.[1]), headers, text, contentType: headers.get('content-type') ?? null }
}
