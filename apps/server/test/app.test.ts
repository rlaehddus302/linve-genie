// AC-S00-40 헬스체크, AC-S00-41 없는 경로와 오류 응답. 포트를 열지 않고 app.request(...)로 요청한다.
import { HTTPException } from 'hono/http-exception'
import { validator } from 'hono/validator'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { expectJsonError, shapeOf } from './helpers.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('GET /health (AC-S00-40)', () => {
  it('200, Content-Type application/json, 본문은 정확히 {"status":"ok"}', async () => {
    const response = await createApp().request('/health')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe('{"status":"ok"}')
  })

  it('DB·외부 서비스·비밀값이 없는 환경에서도 같은 답을 한다', async () => {
    for (const key of Object.keys(process.env)) vi.stubEnv(key, undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const response = await createApp().request('/health')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"status":"ok"}')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('쿼리 문자열이 붙어도 같은 답을 한다', async () => {
    const response = await createApp().request('/health?verbose=1')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"status":"ok"}')
  })

  it('HEAD는 본문 없이 200', async () => {
    const response = await createApp().request('/health', { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('다른 메서드는 405 JSON과 Allow 헤더', async () => {
    const app = createApp()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await app.request('/health', { method })
      expect(response.headers.get('allow'), method).toBe('GET, HEAD')
      expectJsonError(await shapeOf(response), 405, 'METHOD_NOT_ALLOWED')
    }
  })

  it('깨진 JSON 본문을 보내도 405 JSON이고 파서 메시지가 새지 않는다', async () => {
    const response = await createApp().request('/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"status": ',
    })
    expectJsonError(await shapeOf(response), 405, 'METHOD_NOT_ALLOWED')
  })
})

describe('없는 경로 (AC-S00-41)', () => {
  it('GET /없는-경로 → 404 JSON, 스택·경로·프레임워크 메시지 없음', async () => {
    const response = await createApp().request('/없는-경로')
    const shape = await shapeOf(response)
    expectJsonError(shape, 404, 'NOT_FOUND')
    expect(shape.text).not.toContain('없는-경로')
    expect(shape.text).not.toContain(encodeURIComponent('없는-경로'))
  })

  const paths = [
    '/',
    '/health/',
    '/HEALTH',
    '/health/extra',
    '/healthz',
    '/%E0%A4%A',
    '/..%2f..%2fetc%2fpasswd',
    '/<script>alert(1)</script>',
    '/api/v1/broadcasts',
    `/${'a'.repeat(4000)}`,
  ]
  for (const path of paths) {
    it(`GET ${path.length > 40 ? `${path.slice(0, 40)}…` : path} → 404 JSON, 요청 경로를 되돌려 주지 않는다`, async () => {
      const shape = await shapeOf(await createApp().request(path))
      expectJsonError(shape, 404, 'NOT_FOUND')
      for (const fragment of ['script', 'passwd', 'aaaa', 'broadcasts', 'healthz', 'extra']) expect(shape.text).not.toContain(fragment)
    })
  }

  it('다른 메서드로 없는 경로를 불러도 404 JSON', async () => {
    const app = createApp()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expectJsonError(await shapeOf(await app.request('/없는-경로', { method, body: method === 'POST' ? 'x' : null })), 404, 'NOT_FOUND')
    }
  })

  it('HEAD로 없는 경로를 부르면 본문 없이 404', async () => {
    const response = await createApp().request('/없는-경로', { method: 'HEAD' })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })
})

describe('처리 중 오류 (AC-S00-41)', () => {
  const SECRET = 'PORT=1234 /Users/seller/livejjim/apps/server/src/secret.ts 010-1234-5678'

  it('처리기가 Error를 던지면 500 JSON, 오류 내용은 응답에 없고 기록만 한다', async () => {
    const logError = vi.fn()
    const app = createApp({ logError })
    const thrown = new Error(SECRET)
    app.get('/boom', () => {
      throw thrown
    })
    const shape = await shapeOf(await app.request('/boom'))
    expectJsonError(shape, 500, 'INTERNAL_ERROR')
    expect(shape.text).not.toContain('1234')
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(thrown)
  })

  it('비동기 처리기가 거부돼도 500 JSON', async () => {
    const logError = vi.fn()
    const app = createApp({ logError })
    app.get('/boom', async () => {
      await Promise.resolve()
      throw new TypeError(SECRET)
    })
    expectJsonError(await shapeOf(await app.request('/boom')), 500, 'INTERNAL_ERROR')
    expect(logError).toHaveBeenCalledTimes(1)
  })

  for (const [label, value] of [
    ['문자열', SECRET],
    ['undefined', undefined],
    ['객체', { secret: SECRET }],
    ['숫자', 42],
  ] as const) {
    it(`Error가 아닌 값(${label})을 던져도 500 JSON`, async () => {
      const logError = vi.fn()
      const app = createApp({ logError })
      app.get('/boom', () => {
        throw value
      })
      const shape = await shapeOf(await app.request('/boom'))
      expectJsonError(shape, 500, 'INTERNAL_ERROR')
      expect(shape.text).not.toContain('1234')
      expect(logError).toHaveBeenCalledWith(value)
    })
  }

  it('미들웨어에서 던진 오류도 500 JSON', async () => {
    const app = createApp({ logError: () => {} })
    app.use('/mw/*', () => {
      throw new Error(SECRET)
    })
    app.get('/mw/x', (c) => c.json({ reached: true }))
    expectJsonError(await shapeOf(await app.request('/mw/x')), 500, 'INTERNAL_ERROR')
  })

  it('프레임워크가 만든 400(깨진 JSON)은 상태만 살리고 내부 메시지는 버린다', async () => {
    const logError = vi.fn()
    const app = createApp({ logError })
    app.post(
      '/echo',
      validator('json', (value) => value),
      (c) => c.json({ ok: true }),
    )
    const shape = await shapeOf(
      await app.request('/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken": ' }),
    )
    expectJsonError(shape, 400, 'BAD_REQUEST')
    expect(shape.text).not.toMatch(/Malformed|JSON|body/i)
    expect(logError).not.toHaveBeenCalled()
  })

  it('HTTPException 4xx: 알려진 상태는 그 코드, 모르는 4xx는 REQUEST_ERROR. 메시지·사용자 지정 응답 본문은 버린다', async () => {
    const app = createApp({ logError: () => {} })
    app.get('/e/:status', (c) => {
      const status = Number(c.req.param('status')) as 400
      throw new HTTPException(status, { message: SECRET, res: new Response(SECRET) })
    })
    const cases = [
      [400, 'BAD_REQUEST'],
      [401, 'REQUEST_ERROR'],
      [403, 'REQUEST_ERROR'],
      [404, 'NOT_FOUND'],
      [413, 'PAYLOAD_TOO_LARGE'],
      [418, 'REQUEST_ERROR'],
      [431, 'HEADERS_TOO_LARGE'],
    ] as const
    for (const [status, code] of cases) {
      const shape = await shapeOf(await app.request(`/e/${status}`))
      expectJsonError(shape, status, code)
      expect(shape.text).not.toContain('1234')
    }
  })

  it('HTTPException 5xx는 상태를 살리되 일반 문구로 답하고 기록한다', async () => {
    const logError = vi.fn()
    const app = createApp({ logError })
    app.get('/unavailable', () => {
      throw new HTTPException(503, { message: SECRET })
    })
    const shape = await shapeOf(await app.request('/unavailable'))
    expectJsonError(shape, 503, 'INTERNAL_ERROR')
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('기록 함수가 실패해도 500 JSON 응답은 나간다', async () => {
    const app = createApp({
      logError: () => {
        throw new Error('로그 저장소 고장')
      },
    })
    app.get('/boom', () => {
      throw new Error(SECRET)
    })
    app.get('/boom-value', () => {
      throw SECRET
    })
    expectJsonError(await shapeOf(await app.request('/boom')), 500, 'INTERNAL_ERROR')
    expectJsonError(await shapeOf(await app.request('/boom-value')), 500, 'INTERNAL_ERROR')
  })

  // S04 교체 (D-073, AC-S04-34): 기본 기록은 표준 오류 출력에 남기되, 오류 객체(메시지·스택)는 넘기지 않고 종류 이름만 남긴다.
  // 메시지에는 요청 값·DB 질의 인자(전화번호 키·메모 등)가 들어 있을 수 있다. 약화가 아니라 더 엄격한 기대다.
  it('기본 기록 함수는 표준 오류 출력(console.error)에 남기고, 오류 메시지·스택은 남기지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp()
    const thrown = new TypeError(SECRET)
    app.get('/boom', () => {
      throw thrown
    })
    expectJsonError(await shapeOf(await app.request('/boom')), 500, 'INTERNAL_ERROR')
    expect(consoleError).toHaveBeenCalledTimes(1)
    const args = consoleError.mock.calls[0] ?? []
    expect(args).not.toContain(thrown)
    const line = args.map(String).join(' ')
    expect(line).toContain('TypeError')
    expect(line).not.toContain('1234')
    expect(line).not.toContain('/Users/')
  })
})
