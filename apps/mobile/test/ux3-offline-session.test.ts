// 서버가 끊기면 로그인 화면으로 튕기지 않는다 (D-UX3-21): 401만 '로그인 안 됨', 그 밖은 서버에 닿지 못한 것
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { sessionAfterCheckError, type Session } from '../src/services.tsx'

const checking: Session = { state: 'checking' }

describe('로그인 확인 실패 뒤 세션 (D-UX3-21)', () => {
  it('401이면 로그인 화면', () => {
    expect(sessionAfterCheckError(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: '로그인' }), checking)).toEqual({ state: 'out', expired: false })
  })
  it('인터넷이 끊겼거나 서버를 새로 올리는 중(502·503)이면 offline — 로그인이 풀린 게 아니다', () => {
    for (const error of [new ApiError({ status: 0, code: 'NETWORK', message: '끊김', network: true }), new ApiError({ status: 502, code: 'BAD_GATEWAY', message: '서버' }), new ApiError({ status: 503, code: 'UNAVAILABLE', message: '서버' }), new Error('알 수 없음')]) {
      expect(sessionAfterCheckError(error, checking)).toEqual({ state: 'out', expired: false, offline: true })
    }
  })
  it('이미 들어와 있으면 서버가 잠깐 끊겨도 그대로', () => {
    const inside = { state: 'in', me: { loginId: 'shop' } } as unknown as Session
    expect(sessionAfterCheckError(new ApiError({ status: 502, code: 'BAD_GATEWAY', message: '서버' }), inside)).toBe(inside)
  })
})
