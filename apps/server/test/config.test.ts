// 서버 설정: PORT (AC-S00-07, AC-S00-42), DB 연결·앱 주소 (AC-S04-20·41)
import { describe, expect, it } from 'vitest'
import { DEFAULT_PORT, readAppOrigin, readDatabaseSetting, readPort } from '../src/config.ts'

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

// AC-S04-20: 운영 시작에는 DB 연결 설정이 필수 — 없으면 시작하지 않는다(메모리 DB로 조용히 바꾸지 않는다). 값은 문장에 넣지 않는다.
describe('readDatabaseSetting (AC-S04-20)', () => {
  it('DATABASE_URL이면 PostgreSQL, LIVEJJIM_PGLITE_DIR이면 개발용 파일 PGlite', () => {
    expect(readDatabaseSetting({ DATABASE_URL: 'postgres://u:p@h/db' })).toEqual({ ok: true, kind: 'postgres', url: 'postgres://u:p@h/db' })
    expect(readDatabaseSetting({ DATABASE_URL: 'postgresql://h/db' })).toMatchObject({ ok: true, kind: 'postgres' })
    expect(readDatabaseSetting({ LIVEJJIM_PGLITE_DIR: './data/dev' })).toEqual({ ok: true, kind: 'pglite', dir: './data/dev' })
  })

  it('둘 다 없으면 시작하지 않는다 (메모리 DB로 바꾸지 않는다)', () => {
    for (const env of [{}, { DATABASE_URL: '' }, { DATABASE_URL: '  ', LIVEJJIM_PGLITE_DIR: '' }]) {
      const setting = readDatabaseSetting(env)
      expect(setting.ok).toBe(false)
      if (!setting.ok) expect(setting.message).toMatch(/데이터베이스 연결 설정이 없어요/)
    }
  })

  it('형식이 틀리거나 둘 다 적으면 오류이고, 받은 값을 문장에 넣지 않는다', () => {
    const secret = 'mysql://admin:hunter2@db.example/prod'
    const wrong = readDatabaseSetting({ DATABASE_URL: secret })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) {
      expect(wrong.message).not.toContain('hunter2')
      expect(wrong.message).not.toContain('db.example')
    }
    const both = readDatabaseSetting({ DATABASE_URL: 'postgres://a:hunter2@h/d', LIVEJJIM_PGLITE_DIR: '/tmp/x' })
    expect(both.ok).toBe(false)
    if (!both.ok) expect(both.message).not.toContain('hunter2')
  })
})

describe('readAppOrigin (AC-S04-41)', () => {
  it('경로 없는 http(s) 주소만 받는다', () => {
    expect(readAppOrigin({ LIVEJJIM_APP_ORIGIN: 'https://app.livejjim.kr' })).toEqual({ ok: true, origin: 'https://app.livejjim.kr' })
    expect(readAppOrigin({ LIVEJJIM_APP_ORIGIN: 'http://localhost:5173' })).toEqual({ ok: true, origin: 'http://localhost:5173' })
    for (const value of [undefined, '', 'app.livejjim.kr', 'https://app.livejjim.kr/', 'https://a.kr/path', 'ftp://a.kr', '*']) {
      const setting = readAppOrigin(value === undefined ? {} : { LIVEJJIM_APP_ORIGIN: value })
      expect(setting.ok, String(value)).toBe(false)
    }
  })
})
