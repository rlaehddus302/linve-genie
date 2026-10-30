// 서명 서비스 무료 한도 경보 (CH-20). 가짜 웹캐스트·가짜 시계만 쓴다 — 외부 네트워크 호출 없음.
import { describe, expect, it } from 'vitest'
import {
  createTikTokSignMeter,
  readTikTokSettings,
  readTikTokSignLimit,
  TIKTOK_SIGN_DAILY_LIMIT_DEFAULT,
  TIKTOK_SIGN_MESSAGES,
  TIKTOK_SIGN_WINDOW_MS,
} from '../src/tiktok/index.ts'
import { rig } from './tiktok-support.ts'

describe('CH-20 서명 요청 계량기', () => {
  it('한도의 80%에 닿으면 NEAR, 한도를 넘으면 OVER, 수준이 바뀐 때만 changed', () => {
    const meter = createTikTokSignMeter(10)
    const levels = Array.from({ length: 11 }, (_, i) => meter.record(i))
    expect(levels.map((l) => l.level)).toEqual(['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NEAR', 'NEAR', 'NEAR', 'OVER'])
    expect(levels.filter((l) => l.changed).map((l) => l.level)).toEqual(['NEAR', 'OVER'])
  })

  it('24시간이 지나면 다시 센다', () => {
    const meter = createTikTokSignMeter(5)
    for (let i = 0; i < 6; i++) meter.record(i)
    expect(meter.level(10)).toBe('OVER')
    expect(meter.level(TIKTOK_SIGN_WINDOW_MS + 6)).toBe('OK')
    expect(meter.used(TIKTOK_SIGN_WINDOW_MS + 6)).toBe(0)
  })

  it('한도 설정: 양의 정수만 받고 아니면 보수적인 기본값', () => {
    expect(readTikTokSignLimit('120')).toBe(120)
    for (const bad of [undefined, '', '0', '-3', '1.5', 'abc', '99999999999']) expect(readTikTokSignLimit(bad)).toBe(TIKTOK_SIGN_DAILY_LIMIT_DEFAULT)
    expect(readTikTokSettings({ LIVEJJIM_TIKTOK_SIGN_DAILY_LIMIT: '40' }).signDailyLimit).toBe(40)
    expect(readTikTokSettings({}).signDailyLimit).toBe(TIKTOK_SIGN_DAILY_LIMIT_DEFAULT)
  })

  it('판매자에게 보일 문장은 쉬운 한국어(영문·숫자 없음)', () => {
    for (const text of Object.values(TIKTOK_SIGN_MESSAGES)) expect(text).not.toMatch(/[A-Za-z0-9]/)
  })
})

describe('CH-20 연결 시도마다 세고 경고 로그', () => {
  it('시도가 한도에 가까워지면 NEAR 로그, 넘으면 OVER 로그를 한 번씩만 남기고 연결은 막지 않는다', async () => {
    const meter = createTikTokSignMeter(3)
    const r = rig({ extra: { signMeter: meter } })
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(meter.used(r.clock.now())).toBe(1)
    expect(r.logs.map((l) => l.code)).not.toContain('TIKTOK_SIGN_NEAR_LIMIT')
    // 다시 시작할 때마다 시도 하나
    for (let i = 0; i < 3; i++) {
      r.conn.stop()
      r.conn.start()
      await r.flush()
    }
    const codes = r.logs.map((l) => l.code)
    expect(codes.filter((c) => c === 'TIKTOK_SIGN_NEAR_LIMIT')).toHaveLength(1)
    expect(codes.filter((c) => c === 'TIKTOK_SIGN_OVER_LIMIT')).toHaveLength(1)
    expect(r.conn.status().state).toBe('CONNECTED')
    // 로그에는 수만 있고 아이디·키가 없다
    const text = JSON.stringify(r.logs.filter((l) => String(l.code).startsWith('TIKTOK_SIGN')))
    expect(text).not.toContain('seller_kim')
  })
})
