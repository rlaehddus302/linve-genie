// 쓰기 조각 (MTU) — 이어 붙이면 원래 바이트, 이상한 MTU는 20바이트.
import { describe, expect, it } from 'vitest'
import { chunkPayloadFor, splitForMtu } from '../src/index.ts'

describe('splitForMtu', () => {
  it('MTU 23 → 20바이트 조각, 185 → 182, 247 → 244; 23 미만·정수 아님은 20', () => {
    expect(chunkPayloadFor(23)).toBe(20)
    expect(chunkPayloadFor(185)).toBe(182)
    expect(chunkPayloadFor(247)).toBe(244)
    expect(chunkPayloadFor(0)).toBe(20)
    expect(chunkPayloadFor(Number.NaN)).toBe(20)
    expect(chunkPayloadFor(23.5)).toBe(20)
  })

  it('나눈 조각을 이어 붙이면 원래 바이트, 빈 입력은 빈 목록', () => {
    const bytes = new Uint8Array(61).map((_, i) => i)
    const chunks = splitForMtu(bytes, 23)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 20, 1])
    expect(new Uint8Array(chunks.flatMap((c) => [...c]))).toEqual(bytes)
    expect(splitForMtu(new Uint8Array(0), 23)).toEqual([])
    expect(splitForMtu(bytes, 247)).toHaveLength(1)
  })
})
