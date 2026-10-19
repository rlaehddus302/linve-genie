// S00 서버 공격 (AC-S00-40·41·42, F절 "서버": 다른 메서드·없는 경로·잘못된 헤더에서 스택이 노출되지 않는지).
// 앱은 포트 없이(app.request), Node HTTP 계층은 메모리 연결(duplexPair)로, 기동은 실제 자식 프로세스로 공격한다.
import { spawn } from 'node:child_process'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { duplexPair } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createApp, createNodeServer, generateMasterKey } from '@livejjim/server'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT, node } from './helpers.ts'

const SECRET = 'SECRET-토큰-/Users/someone/livejjim/apps/server/src/app.ts:12'
/** 헤더·요청 줄에는 ASCII만 넣을 수 있다 */
const SECRET_ASCII = 'SECRET-token-/Users/someone/livejjim/apps/server/src/app.ts:12'

/** 응답 본문에 나오면 안 되는 것: 스택 줄, 파일 경로, 프레임워크·예외 이름, 비밀값, 영어 문장 */
function expectSafeJsonError(status: number, contentType: string | null, text: string, expectedStatus: number): void {
  expect(status).toBe(expectedStatus)
  expect(contentType).toBe('application/json')
  for (const leak of [/\bat\s+\S+\s+\(/, /\bat\s+(file|node):/, /node_modules/, /\/Users\/|\/home\/|[A-Z]:\\/, /\.(ts|js|mjs|cjs)\b/, /hono/i, /stack/i, /Error\b/, /Exception/, /SECRET/, /undefined/])
    expect(text, `응답에 내부 정보(${leak})가 보인다: ${text}`).not.toMatch(leak)
  const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }
  expect(Object.keys(body)).toEqual(['error'])
  expect(Object.keys(body.error ?? {}).sort()).toEqual(['code', 'message'])
  expect(body.error?.code).toMatch(/^[A-Z_]+$/)
  expect(body.error?.message).toMatch(/[가-힣]/)
  expect(body.error?.message).not.toMatch(/[A-Za-z]/)
}

describe('앱: 헬스체크·없는 경로·다른 메서드 (AC-S00-40·41) — 회귀', () => {
  const app = createApp({ logError: () => undefined })

  it('GET /health → 200, application/json, 본문 정확히 {"status":"ok"} (질의 문자열이 있어도)', async () => {
    for (const path of ['/health', '/health?x=1&y=<script>']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(await res.text()).toBe('{"status":"ok"}')
    }
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('%s /health → 405 JSON, Allow: GET, HEAD', async (method) => {
    const res = await app.request('/health', { method, body: method === 'POST' || method === 'PUT' || method === 'PATCH' ? SECRET : null })
    expectSafeJsonError(res.status, res.headers.get('content-type'), await res.text(), 405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it.each([
    ['한글 경로', '/없는-경로'],
    ['끝 빗금', '/health/'],
    ['대문자', '/HEALTH'],
    ['비슷한 이름', '/healthz'],
    ['하위 경로', '/health/x'],
    ['비밀값 경로', `/${encodeURIComponent(SECRET)}`],
    ['깨진 퍼센트 인코딩', '/%E0%A4%A'],
    ['NUL', '/%00'],
    ['5천 자 경로', `/${'a'.repeat(5000)}`],
    ['스크립트 태그', '/<script>alert(1)</script>'],
  ])('GET %s → 404 JSON, 내부 정보·요청 값 없음', async (_label, path) => {
      const res = await app.request(path, { headers: { 'x-secret': SECRET_ASCII, cookie: `s=${SECRET_ASCII}` } })
      const text = await res.text()
      expectSafeJsonError(res.status, res.headers.get('content-type'), text, 404)
      expect(text).not.toContain('script')
  })

  it('처리기 예외(Error·Error 아닌 값)도 JSON 500이고 메시지·스택을 돌려주지 않는다, 오류는 logError로만 남는다', async () => {
    const logged: unknown[] = []
    const boom = createApp({ logError: (error) => logged.push(error) })
    boom.get('/error', () => {
      throw new Error(SECRET)
    })
    boom.get('/string', () => {
      throw SECRET
    })
    boom.get('/async', async () => {
      await Promise.resolve()
      throw new RangeError(SECRET)
    })
    for (const path of ['/error', '/string', '/async']) {
      const res = await boom.request(path)
      expectSafeJsonError(res.status, res.headers.get('content-type'), await res.text(), 500)
    }
    expect(logged).toHaveLength(3)
  })
})

// ── Node HTTP 계층 (포트 없이) ───────────────────────────────────────────

interface RawResponse {
  readonly status: number
  readonly contentType: string | null
  readonly text: string
  readonly raw: string
}

async function rawRequest(request: string): Promise<RawResponse> {
  const server = createNodeServer({ app: createApp({ logError: () => undefined }), logError: () => undefined })
  const [client, serverSide] = duplexPair()
  server.emit('connection', serverSide)
  const chunks: Buffer[] = []
  client.on('data', (chunk: Buffer) => chunks.push(chunk))
  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('서버가 연결을 닫지 않았다')), 3000)
    const done = (): void => {
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
  const [head = '', ...rest] = raw.split('\r\n\r\n')
  const [statusLine = '', ...headerLines] = head.split('\r\n')
  const contentType = headerLines.find((line) => /^content-type:/i.test(line))?.replace(/^content-type:\s*/i, '') ?? null
  return { status: Number(statusLine.split(' ')[1]), contentType, text: rest.join('\r\n\r\n'), raw }
}

describe('Node HTTP 계층: 잘못된 요청도 JSON, 내부 정보 없음 (AC-S00-41, F절) — 회귀', () => {
  const close = 'Connection: close\r\n'
  it.each([
    ['요청 줄 깨짐', `GARBAGE\r\n\r\n`, 400],
    ['소문자 메서드', `get /health HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 400],
    ['모르는 메서드', `BREW /health HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 400],
    ['Host 없음 (HTTP/1.1)', `GET /health HTTP/1.1\r\n${close}\r\n`, 400],
    ['Host 형식 오류', `GET /health HTTP/1.1\r\nHost: a b/${SECRET_ASCII}\r\n${close}\r\n`, 400],
    ['Host에 한글', `GET /health HTTP/1.1\r\nHost: ${SECRET}\r\n${close}\r\n`, 400],
    ['Host 포트 범위 밖', `GET /health HTTP/1.1\r\nHost: x:99999\r\n${close}\r\n`, 400],
    ['헤더 줄 접기(obs-fold)', `GET /health HTTP/1.1\r\nHost: x\r\nX-A: a\r\n ${SECRET_ASCII}\r\n${close}\r\n`, 400],
    ['헤더 값에 NUL', `GET /health HTTP/1.1\r\nHost: x\r\nX-A: a\u0000${SECRET_ASCII}\r\n${close}\r\n`, 400],
    ['Content-Length와 Transfer-Encoding 함께 (요청 밀반입 형태)', `POST /health HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\nTransfer-Encoding: chunked\r\n${close}\r\n0\r\n\r\n`, 400],
    ['깨진 chunk', `POST /health HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n${close}\r\nzz\r\n`, 400],
    ['너무 긴 주소', `GET /${SECRET_ASCII}${'a'.repeat(20000)} HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 431],
    ['요청 줄에 한글', `GET /${SECRET} HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 400],
    ['너무 큰 헤더', `GET /health HTTP/1.1\r\nHost: x\r\nX-Big: ${'b'.repeat(20000)}\r\n${close}\r\n`, 431],
    ['TRACE /health', `TRACE /health HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 405],
    ['DELETE /health', `DELETE /health HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 405],
    ['없는 경로 + 비밀 헤더', `GET /${encodeURIComponent(SECRET)} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${SECRET_ASCII}\r\n${close}\r\n`, 404],
    ['요청 대상에 / 없음', `GET health HTTP/1.1\r\nHost: x\r\n${close}\r\n`, 400],
  ] as const)('%s → JSON 오류', async (_label, request, status) => {
    const response = await rawRequest(request)
    expectSafeJsonError(response.status, response.contentType, response.text, status)
  })

  it('정상 요청은 그대로 200', async () => {
    const response = await rawRequest(`GET /health HTTP/1.1\r\nHost: localhost\r\n${close}\r\n`)
    expect(response.status).toBe(200)
    expect(response.text).toBe('{"status":"ok"}')
  })
})

// ── 기동 (실제 프로세스) ─────────────────────────────────────────────────

const MAIN = join(ROOT, 'apps', 'server', 'src', 'main.ts')

/** S04부터 서버는 DB 연결 설정·마스터 키·앱 주소가 없으면 시작하지 않는다(AC-S04-20·32) — 기동 회귀는 개발용 파일 PGlite(빈 임시 폴더)로 */
function serverEnv(port: number): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'lj-s00-'))
  dirs.push(dir)
  return { ...process.env, PORT: String(port), LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: 'http://localhost:5173' }
}
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

async function freePort(): Promise<number> {
  const probe = createNetServer()
  await new Promise<void>((resolve) => probe.listen(0, resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

describe('기동 (AC-S00-42) — 회귀', () => {
  it('PORT로 지정한 포트에서 /health가 응답하고, 로그에 PORT 값이 없고, SIGTERM이면 종료 코드 0', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, [MAIN], { cwd: ROOT, env: serverEnv(port), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`서버가 10초 안에 시작하지 않았다:\n${output}`)), 10_000)
        const check = (): void => {
          if (output.includes('시작했어요')) {
            clearTimeout(timer)
            resolve()
          }
        }
        child.stdout.on('data', check)
        child.on('exit', () => {
          clearTimeout(timer)
          reject(new Error(`서버가 바로 끝났다:\n${output}`))
        })
      })
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(await res.text()).toBe('{"status":"ok"}')
      const missing = await fetch(`http://127.0.0.1:${port}/없는-경로`)
      expect(missing.status).toBe(404)
      child.kill('SIGTERM')
      expect(await exited).toBe(0)
      expect(output, '기동·종료 로그에 환경변수 값(PORT)이 찍혔다').not.toContain(String(port))
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 20_000)

  it.each(['abc', '0', '65536', '3000abc', ' 3000', '1e3', '0x50', '３０００', 'sk-live-SECRET-1234'])('잘못된 PORT=%j → 종료 코드 1, 값을 되풀이하지 않는다', (value) => {
    const result = node([MAIN], { PORT: value })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain('PORT')
    if (value.trim().length >= 3) expect(result.stdout + result.stderr).not.toContain(value.trim())
  })

  it('이미 쓰는 포트 → 종료 코드 1, 로그에 포트 번호 없음', async () => {
    const blocker = createNetServer()
    await new Promise<void>((resolve) => blocker.listen(0, resolve))
    const { port } = blocker.address() as AddressInfo
    try {
      const child = spawn(process.execPath, [MAIN], { cwd: ROOT, env: serverEnv(port), stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve(null)
        }, 10_000)
        child.on('exit', (exitCode) => {
          clearTimeout(timer)
          resolve(exitCode)
        })
      })
      expect(code, output).toBe(1)
      expect(output).toContain('이미 쓰고 있는 포트')
      expect(output).not.toContain(String(port))
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  }, 20_000)
})
