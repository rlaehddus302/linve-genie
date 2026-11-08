// 간편 로그인 창이 돌아오는 주소는 화면 이동이 받지 않는다 (D-UX3-66 — 안드로이드 "Unmatched Route")
import { describe, expect, it } from 'vitest'
import { APP_RETURN, isAuthReturnLink, routeForSystemPath } from '../src/lib/auth-return.ts'
import { redirectSystemPath } from '../app/+native-intent.tsx'

describe('로그인 창 돌아오는 주소', () => {
  it('서버가 보내는 모양과 화면 이동이 보는 모양을 모두 안다', () => {
    expect(APP_RETURN).toBe('livejjim://auth')
    for (const path of [
      'livejjim://auth?ticket=RvKg8OAofaiSpl2AEZlF4DYbrs3dp9BRYHrB33-Rnp0&provider=kakao',
      'livejjim:///auth?ticket=abc&provider=kakao',
      'livejjim://auth?login=CANCELLED&provider=naver',
      'livejjim://auth',
      '/auth?ticket=abc',
      'auth?ticket=abc',
    ]) {
      expect(isAuthReturnLink(path), path).toBe(true)
    }
  })

  it('다른 앱 주소는 그대로 둔다', () => {
    for (const path of ['livejjim://link/b1', '/link/b1', 'livejjim:///settings', '/authors', 'livejjim://authx', '/', 'https://livegenie.kr/auth']) {
      expect(isAuthReturnLink(path), path).toBe(false)
      expect(routeForSystemPath(path, false)).toBe(path)
    }
  })

  it('앱이 떠 있으면 이동하지 않고, 처음 켜질 때는 첫 화면', () => {
    expect(routeForSystemPath('livejjim://auth?ticket=abc', false)).toBeNull()
    expect(routeForSystemPath('livejjim://auth?ticket=abc', true)).toBe('/')
    expect(redirectSystemPath({ path: 'livejjim://auth?ticket=abc&provider=kakao', initial: false })).toBeNull()
    expect(redirectSystemPath({ path: 'livejjim://link/b1', initial: false })).toBe('livejjim://link/b1')
  })
})
