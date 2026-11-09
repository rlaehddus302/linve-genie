// 시뮬레이터 화면 재기용 연습 로그인 주소 (D-UX4-99): 휴대폰 빌드(EXPO_PUBLIC_TRY_LOGIN 없음)에서는 꺼져 있고, 화면 이동을 하지 않는다
import { describe, expect, it } from 'vitest'
import { TRY_LOGIN_ON, isTryLoginLink, parseTryLogin } from '../src/lib/try-login.ts'
import { routeForSystemPath } from '../src/lib/auth-return.ts'

describe('연습 로그인 주소 (D-UX4-99)', () => {
  it('시험·휴대폰 빌드에서는 꺼져 있다', () => {
    expect(TRY_LOGIN_ON).toBe(false)
  })
  it('livejjim://try-login?id=&pw= 만 읽고, 화면 이동은 하지 않는다', () => {
    expect(parseTryLogin('livejjim://try-login?id=practice&pw=ab-cd')).toEqual({ id: 'practice', pw: 'ab-cd' })
    expect(parseTryLogin('livejjim://try-login?id=practice')).toBeNull()
    expect(parseTryLogin('livejjim://console/b1')).toBeNull()
    expect(isTryLoginLink('/try-login?id=a&pw=b')).toBe(true)
    expect(routeForSystemPath('livejjim://try-login?id=a&pw=b', true)).toBe('/')
    expect(routeForSystemPath('livejjim://try-login?id=a&pw=b', false)).toBeNull()
    expect(routeForSystemPath('/console/b1', false)).toBe('/console/b1')
  })
})
