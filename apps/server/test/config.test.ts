// PORT 설정 (AC-S00-07, AC-S00-42)
import { describe, expect, it } from 'vitest'
import { DEFAULT_PORT, readPort } from '../src/config.ts'

describe('readPort', () => {
  it('PORT가 없거나 비어 있으면 기본 3000', () => {
    expect(DEFAULT_PORT).toBe(3000)
    expect(readPort({})).toEqual({ ok: true, port: 3000, fromEnv: false })
    expect(readPort({ PORT: '' })).toEqual({ ok: true, port: 3000, fromEnv: false })
  })

  it('1~65535 사이의 10진 정수를 받는다', () => {
    expect(readPort({ PORT: '1' })).toEqual({ ok: true, port: 1, fromEnv: true })
    expect(readPort({ PORT: '8080' })).toEqual({ ok: true, port: 8080, fromEnv: true })
    expect(readPort({ PORT: '65535' })).toEqual({ ok: true, port: 65535, fromEnv: true })
  })

  it('그 밖의 값은 오류이고, 메시지에 받은 값을 넣지 않는다', () => {
    for (const value of ['0', '65536', '99999', '-1', '3000.5', '1e3', '0x50', ' 3000', '3000 ', 'abc', '３０００', '123456']) {
      const setting = readPort({ PORT: value })
      expect(setting.ok, JSON.stringify(value)).toBe(false)
      if (!setting.ok) {
        expect(setting.message).toContain('PORT')
        expect(setting.message).not.toContain(value.trim())
      }
    }
  })

  it('PORT 말고는 읽지 않는다', () => {
    expect(readPort({ HOST: '0.0.0.0', SERVER_PORT: '9999', port: '1234' })).toEqual({ ok: true, port: 3000, fromEnv: false })
  })
})
