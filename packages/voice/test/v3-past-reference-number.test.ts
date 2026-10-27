// AC-V3-95 (R-17 3, D-V3-104 — 실방송 경성 "아까 30 자 … 32만 원 … 2번"): 지난 일 말 뒤의 '번' 없는 수는 번호가 아니다
import { describe, expect, it } from 'vitest'
import { extractVoice, readSegments } from '../src/index.ts'

const read = (text: string) => {
  const result = extractVoice(text, { dictionary: [], maxNumber: 300 })
  return [result.no, result.price]
}
const picks = (text: string) => readSegments(text, { dictionary: [], final: true, maxNumber: 300 }).picks.map((p) => [p.no, p.price])

describe('AC-V3-95 지난 일 말 뒤의 번 없는 수', () => {
  it.each([
    ['아까 30 자 32만 원', [null, 320_000]],
    ['전에 30 32만 원', [null, 320_000]],
    ['저번에 30 32만 원', [null, 320_000]],
    ['예전에 30 32만 원', [null, 320_000]],
    ['지난번에 30 32만 원', [null, 320_000]],
    ['아까 자 30 32만 원', [null, 320_000]],
    ['아까 30번 32만 원', [30, 320_000]],
    ['30 32만 원', [30, 320_000]],
  ])('%s', (text, expected) => {
    expect(read(text)).toEqual(expected)
  })
  it('조각 읽기: "아까 30 자 32만 원"은 번호 조각이 없고 "아까 30번 32만 원"은 30번', () => {
    expect(picks('아까 30 자 32만 원')).toEqual([])
    expect(picks('아까 30번 32만 원')).toEqual([[30, 320_000]])
  })
  it('지난 일 말과 수 사이에 군말 아닌 말이 있으면 그대로 번호 후보: "아까 말한 30 32만 원" → 30번', () => {
    expect(read('아까 말한 30 32만 원')).toEqual([30, 320_000])
  })
})
