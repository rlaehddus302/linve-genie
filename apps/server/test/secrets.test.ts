// AC-S04-32 판매자별 전화번호 키(마스터 키로 암호화), AC-S04-40 비밀번호 해시·세션 토큰
import { describe, expect, it } from 'vitest'
import {
  generateMasterKey,
  hashPassword,
  newSealedSellerKey,
  newSessionToken,
  openSellerKey,
  phoneKeyOf,
  readMasterKey,
  sealSellerKey,
  tokenHash,
  verifyPassword,
} from '../src/secrets.ts'
import { FAST_COST } from './support.ts'

describe('마스터 키 (AC-S04-32)', () => {
  it('32바이트 base64·base64url을 받는다', () => {
    const key = generateMasterKey()
    const read = readMasterKey(key)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.key.length).toBe(32)
    const url = Buffer.from(key, 'base64').toString('base64url')
    expect(readMasterKey(url)).toMatchObject({ ok: true })
  })

  it('없거나 형식·길이가 틀리면 오류이고, 받은 값을 문장에 넣지 않는다', () => {
    const short = Buffer.alloc(16, 7).toString('base64')
    const long = Buffer.alloc(33, 7).toString('base64')
    for (const value of [undefined, '', '   ', 'not base64 at all!', short, long, '한글키']) {
      const read = readMasterKey(value)
      expect(read.ok, String(value)).toBe(false)
      if (!read.ok) {
        expect(read.message).toMatch(/마스터 키/)
        if (value !== undefined && value.trim() !== '') expect(read.message).not.toContain(value.trim())
      }
    }
  })

  it('시험은 시험 안에서 만든 마스터 키를 쓴다 (매번 다른 무작위 값)', () => {
    expect(generateMasterKey()).not.toBe(generateMasterKey())
  })
})

describe('판매자 전화번호 키 (AC-S04-32, D-073)', () => {
  const master = Buffer.from(generateMasterKey(), 'base64')

  it('암호화한 값에 평문 키가 없고, 같은 마스터 키·판매자로만 풀린다', () => {
    const plain = Buffer.alloc(32, 9)
    const sealed = sealSellerKey(master, 'sel_a', plain)
    expect(sealed).not.toContain(plain.toString('base64'))
    expect(sealed).not.toContain(plain.toString('base64url'))
    expect(sealed).not.toContain(plain.toString('hex'))
    expect(openSellerKey(master, 'sel_a', sealed).equals(plain)).toBe(true)
    // 다른 판매자 행으로 옮기면 풀리지 않는다
    expect(() => openSellerKey(master, 'sel_b', sealed)).toThrow()
    // 다른 마스터 키로는 풀리지 않는다
    expect(() => openSellerKey(Buffer.from(generateMasterKey(), 'base64'), 'sel_a', sealed)).toThrow()
    // 손상된 값
    expect(() => openSellerKey(master, 'sel_a', sealed.slice(0, -2) + 'AA')).toThrow()
    expect(() => openSellerKey(master, 'sel_a', 'v2.a.b.c')).toThrow()
  })

  it('판매자를 만들 때마다 32바이트 무작위 키', () => {
    const a = openSellerKey(master, 'sel_a', newSealedSellerKey(master, 'sel_a'))
    const b = openSellerKey(master, 'sel_a', newSealedSellerKey(master, 'sel_a'))
    expect(a.length).toBe(32)
    expect(a.equals(b)).toBe(false)
  })

  it('phoneKey = HMAC-SHA256(판매자 키, 정규화한 번호)의 base64url 43자 — 판매자마다 다르다', () => {
    const keyA = Buffer.alloc(32, 1)
    const keyB = Buffer.alloc(32, 2)
    const a = phoneKeyOf(keyA, '01012345678')
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(phoneKeyOf(keyA, '01012345678')).toBe(a)
    expect(phoneKeyOf(keyB, '01012345678')).not.toBe(a)
    expect(a).not.toContain('5678')
  })
})

describe('비밀번호·세션 토큰 (AC-S04-40)', () => {
  it('scrypt 해시만 저장하고, 맞는 비밀번호만 통과한다', async () => {
    const stored = await hashPassword('correct-horse-1', FAST_COST)
    expect(stored).toMatch(/^scrypt\$/)
    expect(stored).not.toContain('correct-horse-1')
    expect(await verifyPassword('correct-horse-1', stored)).toBe(true)
    expect(await verifyPassword('correct-horse-2', stored)).toBe(false)
    expect(await verifyPassword('correct-horse-1', 'garbage')).toBe(false)
    expect(await verifyPassword('correct-horse-1', 'scrypt$x$8$1$aa$bb')).toBe(false)
    // 같은 비밀번호도 소금이 달라 해시가 다르다
    expect(await hashPassword('correct-horse-1', FAST_COST)).not.toBe(stored)
  })

  it('세션 토큰은 무작위 32바이트, 서버엔 해시만', () => {
    const token = newSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newSessionToken()).not.toBe(token)
    expect(tokenHash(token)).not.toBe(token)
    expect(tokenHash(token)).toBe(tokenHash(token))
  })
})
