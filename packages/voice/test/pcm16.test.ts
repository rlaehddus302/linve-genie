// AC-APP1-10 (VOC-06 AC2, D-APP-06, D-APP1-09): 16kHz 바꾸기와 3,200바이트 조각
import { describe, expect, it } from 'vitest'
import { PCM_CHUNK_BYTES, Pcm16Resampler, floatToPcm16, mixToMono } from '../src/pcm16.ts'

const sine = (rate: number, seconds: number): Float32Array => {
  const out = new Float32Array(Math.round(rate * seconds))
  for (let index = 0; index < out.length; index++) out[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / rate)
  return out
}

const feed = (rate: number, samples: Float32Array, block = 128): Uint8Array[] => {
  const resampler = new Pcm16Resampler(rate)
  const chunks: Uint8Array[] = []
  for (let start = 0; start < samples.length; start += block) chunks.push(...resampler.push(samples.subarray(start, start + block)))
  return chunks
}

describe('16kHz 바꾸기 (AC-APP1-10)', () => {
  for (const rate of [48_000, 44_100]) {
    it(`${String(rate)}Hz 1초를 128표본씩 넣으면 정확히 조각 10개, 조각마다 3,200바이트`, () => {
      const chunks = feed(rate, sine(rate, 1))
      expect(chunks).toHaveLength(10)
      for (const chunk of chunks) expect(chunk.byteLength).toBe(PCM_CHUNK_BYTES)
    })

    it(`${String(rate)}Hz 1.5초면 조각 15개`, () => {
      expect(feed(rate, sine(rate, 1.5))).toHaveLength(15)
    })
  }

  it('조각 경계를 넘어도 표본 수가 쌓여 틀리지 않는다 (10분)', () => {
    const resampler = new Pcm16Resampler(44_100)
    let count = 0
    const block = sine(44_100, 1)
    for (let second = 0; second < 600; second++) count += resampler.push(block).length
    expect(count).toBe(6_000)
  })

  it('16kHz 입력은 그대로 (같은 값)', () => {
    const input = new Float32Array(1_600).map((_, index) => (index % 100) / 100 - 0.5)
    const [chunk] = new Pcm16Resampler(16_000).push(input)
    const view = new DataView(chunk?.buffer ?? new ArrayBuffer(0))
    expect(view.getInt16(2 * 7, true)).toBe(floatToPcm16(input[7] ?? 0))
  })

  it('48kHz는 세 표본마다 하나를 그대로 고른다 (little-endian)', () => {
    const input = new Float32Array(4_800)
    for (let index = 0; index < input.length; index++) input[index] = index % 3 === 0 ? 0.25 : -0.75
    const [chunk] = new Pcm16Resampler(48_000).push(input)
    expect(chunk?.[0]).toBe(floatToPcm16(0.25) & 0xff)
    expect(chunk?.[1]).toBe((floatToPcm16(0.25) >> 8) & 0xff)
    const view = new DataView(chunk?.buffer ?? new ArrayBuffer(0))
    for (let index = 0; index < 1_600; index++) expect(view.getInt16(index * 2, true)).toBe(8_192)
  })

  it('실수 → 정수: 1.0 → 32,767, -1.0 → -32,767, 1.5 → 32,767, -1.5 → -32,768', () => {
    expect(floatToPcm16(1)).toBe(32_767)
    expect(floatToPcm16(-1)).toBe(-32_767)
    expect(floatToPcm16(1.5)).toBe(32_767)
    expect(floatToPcm16(-1.5)).toBe(-32_768)
    expect(floatToPcm16(0)).toBe(0)
    expect(Object.is(floatToPcm16(-0.000001), 0)).toBe(true)
    expect(floatToPcm16(Number.NaN)).toBe(0)
  })

  it('조각 안의 값도 같은 규칙 (1.5 → 32,767, -1.5 → -32,768)', () => {
    const input = new Float32Array(1_600).fill(1.5)
    input.fill(-1.5, 800)
    const [chunk] = new Pcm16Resampler(16_000).push(input)
    const view = new DataView(chunk?.buffer ?? new ArrayBuffer(0))
    expect(view.getInt16(0, true)).toBe(32_767)
    expect(view.getInt16(1_599 * 2, true)).toBe(-32_768)
  })

  it('reset()은 채우던 조각과 남은 입력을 버린다', () => {
    const resampler = new Pcm16Resampler(48_000)
    expect(resampler.push(new Float32Array(3_000).fill(0.1))).toHaveLength(0)
    expect(resampler.bufferedSamples).toBe(1_000)
    resampler.reset()
    expect(resampler.bufferedSamples).toBe(0)
    expect(resampler.push(new Float32Array(4_800).fill(0.1))).toHaveLength(1)
  })

  it('조각마다 새 버퍼 (보낸 조각을 덮어쓰지 않는다)', () => {
    const chunks = feed(48_000, sine(48_000, 0.3))
    expect(chunks).toHaveLength(3)
    expect(new Set(chunks.map((chunk) => chunk.buffer)).size).toBe(3)
  })

  it('표본률이 이상하면 만들지 않는다', () => {
    expect(() => new Pcm16Resampler(0)).toThrow(RangeError)
    expect(() => new Pcm16Resampler(Number.NaN)).toThrow(RangeError)
  })

  it('여러 채널은 평균해 모노로', () => {
    expect([...mixToMono([new Float32Array([1, 0.5]), new Float32Array([0, -0.5])])]).toEqual([0.5, 0])
    expect(mixToMono([])).toHaveLength(0)
  })
})
