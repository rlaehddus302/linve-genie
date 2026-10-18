// 오류 본문 표 (AC-S00-41)
import { describe, expect, it } from 'vitest'
import { describeError, errorResponse } from '../src/errors.ts'
import { expectJsonError, shapeOf } from './helpers.ts'

describe('describeError', () => {
  it('알려진 4xx는 각자의 코드', () => {
    expect(describeError(400).body.error.code).toBe('BAD_REQUEST')
    expect(describeError(404).body.error.code).toBe('NOT_FOUND')
    expect(describeError(405).body.error.code).toBe('METHOD_NOT_ALLOWED')
    expect(describeError(408).body.error.code).toBe('REQUEST_TIMEOUT')
    expect(describeError(413).body.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(describeError(431).body.error.code).toBe('HEADERS_TOO_LARGE')
  })

  it('모르는 4xx는 상태를 그대로 두고 REQUEST_ERROR', () => {
    for (const status of [401, 403, 409, 418, 422, 429, 499]) {
      expect(describeError(status)).toEqual({ status, body: { error: { code: 'REQUEST_ERROR', message: expect.any(String) } } })
    }
  })

  it('5xx는 상태를 그대로 두고 INTERNAL_ERROR', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(describeError(status)).toEqual({ status, body: { error: { code: 'INTERNAL_ERROR', message: expect.any(String) } } })
    }
  })

  it('오류가 아닌 상태나 잘못된 숫자는 500으로 본다', () => {
    for (const status of [0, 200, 204, 302, 399, 600, 404.5, Number.NaN, Number.POSITIVE_INFINITY, -404]) {
      expect(describeError(status).status, String(status)).toBe(500)
      expect(describeError(status).body.error.code).toBe('INTERNAL_ERROR')
    }
  })

  it('메시지는 모두 영어 없는 한국어 문장', () => {
    for (const status of [400, 404, 405, 408, 413, 431, 418, 500]) {
      const { message } = describeError(status).body.error
      expect(message).toMatch(/[가-힣]/)
      expect(message).not.toMatch(/[A-Za-z]/)
    }
  })
})

describe('errorResponse', () => {
  it('JSON 본문과 Content-Type', async () => {
    expectJsonError(await shapeOf(errorResponse(404)), 404, 'NOT_FOUND')
  })

  it('추가 헤더를 붙이되 Content-Type은 덮어쓰지 못한다', async () => {
    const response = errorResponse(405, { Allow: 'GET, HEAD', 'content-type': 'text/html' })
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expectJsonError(await shapeOf(response), 405, 'METHOD_NOT_ALLOWED')
  })
})
