// D-REAL-04 우체국 계약소포 regData 암호화: 매뉴얼(2023.12) 예시값 그대로 나와야 한다.
import { describe, expect, it } from 'vitest'
import { epostEncrypt } from '../src/parcel/seed.ts'

describe('우체국 SEED-128 암호화', () => {
  it('매뉴얼 예시: 보안키 1234567890abcdefghijkl, 평문 123abc가나다(UTF-8) → 8522ad534acc61cb88090b7e62c5183b', () => {
    expect(epostEncrypt('1234567890abcdefghijkl', '123abc가나다')).toBe('8522ad534acc61cb88090b7e62c5183b')
  })
  it('16바이트를 넘으면 블록을 이어 붙이고, 0x00으로 채운다', () => {
    const one = epostEncrypt('1234567890abcdefghijkl', 'custNo=0011223344&reqType=1')
    expect(one).toMatch(/^[0-9a-f]{64}$/)
    expect(epostEncrypt('1234567890abcdefghijkl', '0123456789abcdef')).toHaveLength(32)
  })
})
