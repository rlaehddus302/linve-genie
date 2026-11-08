// 도메인 옮기기 (D-OPS-DOMAIN): 옛 앱 주소도 Origin 검사에서 받되, 형식이 틀리면 기동하지 않는다
import { describe, expect, it } from 'vitest'
import { originAllowed, readOldAppOrigins } from '../src/config.ts'

describe('옛 앱 주소 (D-OPS-DOMAIN)', () => {
  it('새 주소와 옛 주소만 정확히 받는다', () => {
    const old = ['https://3-34-170-138.sslip.io']
    expect(originAllowed('https://livegenie.kr', 'https://livegenie.kr', old)).toBe(true)
    expect(originAllowed('https://3-34-170-138.sslip.io', 'https://livegenie.kr', old)).toBe(true)
    expect(originAllowed('https://3-34-170-138.sslip.io.evil.com', 'https://livegenie.kr', old)).toBe(false)
    expect(originAllowed('https://evil.com', 'https://livegenie.kr', old)).toBe(false)
    expect(originAllowed(undefined, 'https://livegenie.kr', old)).toBe(false)
    expect(originAllowed('https://3-34-170-138.sslip.io', 'https://livegenie.kr')).toBe(false)
  })
  it('LIVEJJIM_OLD_APP_ORIGINS는 쉼표로 여럿, 비면 없음, 경로가 있으면 거절', () => {
    expect(readOldAppOrigins({})).toEqual({ ok: true, origins: [] })
    expect(readOldAppOrigins({ LIVEJJIM_OLD_APP_ORIGINS: ' https://a.example , https://b.example ' })).toEqual({ ok: true, origins: ['https://a.example', 'https://b.example'] })
    expect(readOldAppOrigins({ LIVEJJIM_OLD_APP_ORIGINS: 'https://a.example/path' }).ok).toBe(false)
  })
})
