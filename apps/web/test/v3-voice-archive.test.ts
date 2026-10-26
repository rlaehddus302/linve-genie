// 음성 인식 기록 모아 두기 (V3 D-V3-56) — 기본(연습 켬·운영 끔)과 저장값
import { describe, expect, it } from 'vitest'
import { isPracticeHost, readArchive } from '../src/voice/archive-store.ts'

describe('기록 모아 두기 설정 (D-V3-56)', () => {
  // RA-V3-008: 연습은 이 컴퓨터 주소만 — 같은 와이파이의 사설 주소는 운영처럼 끔
  it('저장값이 없으면 이 컴퓨터 주소는 켬, 사설 주소·운영 주소는 끔', () => {
    expect(readArchive(null, 'localhost')).toBe(true)
    expect(readArchive(null, '127.0.0.1')).toBe(true)
    expect(readArchive(null, 'try.localhost')).toBe(true)
    expect(readArchive(null, '192.168.0.12')).toBe(false)
    expect(readArchive(null, '10.0.0.5')).toBe(false)
    expect(readArchive(null, 'livegenie.kr')).toBe(false)
    expect(readArchive(null, '8.8.8.8')).toBe(false)
  })

  it('저장값이 있으면 그대로', () => {
    expect(readArchive({ 'voice.archive': false }, 'localhost')).toBe(false)
    expect(readArchive({ 'voice.archive': true }, 'livegenie.kr')).toBe(true)
    expect(isPracticeHost('172.32.0.1')).toBe(false)
  })
})
