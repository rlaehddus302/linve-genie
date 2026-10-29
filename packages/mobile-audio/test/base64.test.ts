// base64 풀기·묶기 — Node의 Buffer와 같은 결과, 틀린 글은 null.
import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64 } from '../src/index.ts'

describe('base64', () => {
  it('길이 0~5·3,200바이트 모두 Buffer와 같다 (묶기·풀기 왕복)', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 3_199, 3_200]) {
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + length) & 0xff
      const text = encodeBase64(bytes)
      expect(text).toBe(Buffer.from(bytes).toString('base64'))
      expect(decodeBase64(text)).toEqual(bytes)
    }
  })

  it('줄바꿈·공백은 건너뛰고 URL-safe 글자도 받는다', () => {
    expect(decodeBase64('AQID\nBAU=')).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(decodeBase64('-_8=')).toEqual(new Uint8Array(Buffer.from('+/8=', 'base64')))
  })

  it('틀린 글자·틀린 길이·채움 뒤 글자는 null (예외 없음)', () => {
    expect(decodeBase64('***')).toBeNull()
    expect(decodeBase64('A')).toBeNull()
    expect(decodeBase64('AQ=A')).toBeNull()
    expect(decodeBase64('AQ===')).toBeNull()
    expect(decodeBase64('한글')).toBeNull()
  })
})
