// 서버 호출 (AC-S05-63·71·74): 쿠키 세션(credentials: 'include'), 서버 문장 그대로, 401이면 로그인 화면으로,
// 네트워크 오류·SAVE_FAILED는 같은 요청 번호로 최대 3번 다시 보낸다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, RETRY_DELAYS_MS, get, newRequestId, onUnauthorized, post, withQuery, withRetry } from '../src/api/client.ts'
import { FakeServer, apiError } from './support.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

describe('서버 호출', () => {
  it('쿠키 세션만 쓴다: credentials include, 토큰을 다루지 않는다', async () => {
    const server = new FakeServer().on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'shop1' } }))
    vi.stubGlobal('fetch', server.fetch)
    await get('/api/me')
    expect(server.calls[0]?.credentials).toBe('include')
  })

  it('오류 본문의 문장·문제·hint를 그대로 담는다', async () => {
    const server = new FakeServer().on('POST', /^\/api\/events$/, () =>
      apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'reason', message: '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.', hint: '다음 할 일' }]),
    )
    vi.stubGlobal('fetch', server.fetch)
    const error = await post('/api/events', {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    const apiErr = error as ApiError
    expect(apiErr.message).toBe('입력한 내용을 확인해 주세요.')
    expect(apiErr.status).toBe(400)
    expect(apiErr.problemFor('reason')).toEqual({ field: 'reason', message: '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.', hint: '다음 할 일' })
    expect(apiErr.retryable).toBe(false)
  })

  it('401 UNAUTHORIZED면 처리기를 부르고, LOGIN_FAILED는 부르지 않는다', async () => {
    const listener = vi.fn()
    onUnauthorized(listener)
    const server = new FakeServer()
      .on('GET', /^\/api\/days$/, () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.'))
      .on('POST', /^\/api\/login$/, () => apiError(401, 'LOGIN_FAILED', '아이디나 비밀번호가 맞지 않아요.'))
    vi.stubGlobal('fetch', server.fetch)
    await get('/api/days').catch(() => {})
    expect(listener).toHaveBeenCalledTimes(1)
    await post('/api/login', {}).catch(() => {})
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('네트워크 오류는 쉬운 문장', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = (await get('/api/me').catch((caught: unknown) => caught)) as ApiError
    expect(error.network).toBe(true)
    expect(error.retryable).toBe(true)
    expect(error.message).toBe('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  })
})

describe('같은 요청 번호로 다시 보내기 (AC-S05-63)', () => {
  it('최대 3번, 간격을 늘려', () => {
    expect(RETRY_DELAYS_MS).toHaveLength(3)
    expect([...RETRY_DELAYS_MS]).toEqual([...RETRY_DELAYS_MS].sort((a, b) => a - b))
    expect(new Set(RETRY_DELAYS_MS).size).toBe(3)
  })

  it('네트워크 오류·SAVE_FAILED 뒤 같은 본문(같은 요청 번호)으로 다시 보내 한 번만 기록된다', async () => {
    const recorded = new Set<string>()
    let attempts = 0
    const server = new FakeServer().on('POST', /^\/api\/events$/, (call) => {
      attempts++
      if (attempts === 1) return { network: true }
      if (attempts === 2) return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
      recorded.add(String(call.body?.requestId))
      return { body: { changed: true } }
    })
    vi.stubGlobal('fetch', server.fetch)
    const requestId = newRequestId()
    const sleeps: number[] = []
    await withRetry(() => post('/api/events', { requestId, type: 'product.register' }), { sleep: async (ms) => void sleeps.push(ms) })
    expect(server.calls.map((call) => call.body?.requestId)).toEqual([requestId, requestId, requestId])
    expect(recorded).toEqual(new Set([requestId]))
    expect(sleeps).toEqual(RETRY_DELAYS_MS.slice(0, 2))
  })

  it('그래도 안 되면 마지막 오류를 던진다 (화면은 "저장하지 못했어요. 다시 보내기")', async () => {
    const server = new FakeServer().on('POST', /^\/api\/events$/, () => apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.'))
    vi.stubGlobal('fetch', server.fetch)
    const error = (await withRetry(() => post('/api/events', { requestId: 'r1' }), { sleep: async () => {} }).catch((caught: unknown) => caught)) as ApiError
    expect(error.code).toBe('SAVE_FAILED')
    expect(server.calls).toHaveLength(4)
  })

  it('입력 오류(400)는 다시 보내지 않는다', async () => {
    const server = new FakeServer().on('POST', /^\/api\/events$/, () => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.'))
    vi.stubGlobal('fetch', server.fetch)
    await withRetry(() => post('/api/events', {}), { sleep: async () => {} }).catch(() => {})
    expect(server.calls).toHaveLength(1)
  })

  it('요청 번호는 서버 형식(영문·숫자·_·- 1~64자)이고 누를 때마다 새로', () => {
    const a = newRequestId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(newRequestId()).not.toBe(a)
  })

  it('질의: 리허설이 아니면 적지 않는다', () => {
    expect(withQuery('/api/days/2026-10-19', { rehearsal: false })).toBe('/api/days/2026-10-19')
    expect(withQuery('/api/days/2026-10-19/changes', { since: 3, rehearsal: true })).toBe('/api/days/2026-10-19/changes?since=3&rehearsal=true')
  })
})
